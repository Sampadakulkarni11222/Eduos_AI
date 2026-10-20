import mongoose from 'mongoose';
import { Lead, LeadInteraction } from '../../models/lead.model.js';
import { Profile } from '../../models/profile.model.js';
import { buildPermissionMap } from '../../utils/buildPermissionMap.js';
import { tenantFilter } from '../../tenancy/tenantContext.js';
import { Student, Enrollment } from '../../models/student.model.js';
import { Section, AcademicYear } from '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import { runInTransaction } from '../../utils/transaction.js';
import { nextSequence } from '../../utils/sequence.js';
import { logger } from '../../utils/logger.js';
import { rowError } from '../../utils/csvImport.js';
import { isValidPhone } from '../../utils/validators.js';

// Helper: map a raw Lead doc to the DTO the frontend expects
function toLeadDto(lead) {
  const raw = lead.toObject ? lead.toObject() : lead;
  return {
    id: raw._id,
    childName: raw.childName,
    guardianName: raw.guardianName,
    phone: raw.phone,
    email: raw.email,
    gradeApplying: raw.gradeApplying,
    source: raw.source,
    stage: raw.stage,
    notes: raw.notes,
    nextActionAt: raw.nextActionAt,
    assigneeProfileId: raw.assigneeProfileId,
    createdAt: raw.createdAt,
  };
}

export async function getPipeline() {
  // The assignee is populated so a board can tell an available lead from one
  // already owned — the two the CRM works in terms of. It was dropped from
  // this DTO (the lead drawer resolves it separately), which left the pipeline
  // unable to distinguish them at all. Scoped to the acting school by the
  // tenant plugin on Lead, as every read here is.
  const leads = await Lead.find()
    .populate('assigneeProfileId', 'displayName')
    .sort({ createdAt: -1 })
    .lean();

  const STAGES = ['NEW', 'CONTACTED', 'TOUR_SCHEDULED', 'APPLICATION', 'ENROLLED', 'LOST'];

  // Group leads by stage into arrays matching frontend Pipeline type
  const byStage = Object.fromEntries(STAGES.map((s) => [s, []]));

  leads.forEach((lead) => {
    const stage = lead.stage || 'NEW';
    if (byStage[stage]) {
      byStage[stage].push({
        id: lead._id,
        childName: lead.childName,
        guardianName: lead.guardianName,
        phone: lead.phone,
        gradeApplying: lead.gradeApplying,
        source: lead.source,
        stage: lead.stage,
        notes: lead.notes,
        nextActionAt: lead.nextActionAt,
        assigneeProfileId: lead.assigneeProfileId?._id ?? null,
        assigneeName: lead.assigneeProfileId?.displayName ?? null,
        createdAt: lead.createdAt,
      });
    }
  });

  return { stages: STAGES, byStage };
}


/**
 * One lead with its recorded interaction history (stage changes, notes),
 * newest first — backs the CRM's lead detail panel.
 */
export async function getLeadById(leadId) {
  const lead = await Lead.findById(leadId)
    .populate('assigneeProfileId', 'displayName')
    .lean();
  if (!lead) throw new AppError('Lead not found', 404);

  const interactions = await LeadInteraction.find({ leadId })
    .populate('authorProfileId', 'displayName')
    .sort({ createdAt: -1 })
    .lean();

  return {
    ...toLeadDto(lead),
    assigneeName: lead.assigneeProfileId?.displayName ?? null,
    assigneeProfileId: lead.assigneeProfileId?._id ?? lead.assigneeProfileId ?? null,
    updatedAt: lead.updatedAt ?? null,
    interactions: interactions.map((i) => ({
      id: i._id,
      type: i.type,
      body: i.body,
      authorName: i.authorProfileId?.displayName ?? null,
      createdAt: i.createdAt,
    })),
  };
}

const ADMISSION_NO_ATTEMPTS = 5;

/**
 * Allocates the next admission number for the current year, e.g. "ADM-2026-0042".
 *
 * Replaces a `countDocuments()`-derived number, which raced between concurrent
 * admissions, cost a full collection scan each time, and went backwards
 * whenever a student was removed. See utils/sequence.js.
 */
async function nextAdmissionNo(session = null) {
  const year = new Date().getFullYear();
  const seq = await nextSequence(`admissionNo:${year}`, {
    session,
    // First use on an existing database continues from the highest number
    // already issued this year rather than restarting at 1. Zero-padding to a
    // fixed width makes these lexically sortable, so a reverse sort finds the
    // highest without parsing every row.
    seedWith: async () => {
      // Built by concatenation, not a template literal: `\d` inside a template
      // literal collapses to a plain "d" and the pattern silently matches
      // nothing, which would seed the counter at 0 and collide with every
      // number already issued.
      const highest = await Student.findOne({ admissionNo: new RegExp('^ADM-' + year + '-\\d+$') })
        .sort({ admissionNo: -1 })
        .select('admissionNo')
        .session(session)
        .lean();
      const parsed = highest ? Number.parseInt(highest.admissionNo.split('-').pop(), 10) : 0;
      return Number.isFinite(parsed) ? parsed : 0;
    },
  });
  return `ADM-${year}-${String(seq).padStart(4, '0')}`;
}

/**
 * Where an enrolled lead's child is placed: the section (class) they join and
 * the current academic year. Null when no section was named.
 */
async function resolvePlacement(sectionId, session = null) {
  if (sectionId === undefined || sectionId === null || sectionId === '') return null;
  if (!mongoose.isValidObjectId(sectionId)) throw new AppError('sectionId is not a valid id', 400, [], 'INVALID_SECTION');
  const section = await Section.findById(sectionId).session(session).lean();
  if (!section) throw new AppError('That class section does not exist in this school', 404, [], 'SECTION_NOT_FOUND');
  const year = await AcademicYear.findOne({ isCurrent: true }).session(session).lean();
  if (!year) throw new AppError('Set the current academic year before enrolling into a class', 409, [], 'NO_CURRENT_YEAR');
  return { sectionId: section._id, academicYearId: year._id };
}

/** Puts a lead-created student into their class for the year and makes them ACTIVE. */
async function placeStudent(student, placement, session = null) {
  const existing = await Enrollment.findOne({ studentId: student._id, academicYearId: placement.academicYearId }).session(session);
  if (existing) {
    existing.sectionId = placement.sectionId;
    existing.status = 'ACTIVE';
    await existing.save({ session });
  } else {
    // The roll-number index is unique on (section, year, rollNo) and a missing
    // rollNo indexes as null, so every enrolment takes the next free number.
    for (let attempt = 0; ; attempt++) {
      const last = await Enrollment.findOne({ sectionId: placement.sectionId, academicYearId: placement.academicYearId, rollNo: { $ne: null } })
        .sort({ rollNo: -1 }).select('rollNo').session(session).lean();
      try {
        await Enrollment.create([{ studentId: student._id, ...placement, rollNo: (last?.rollNo ?? 0) + 1, status: 'ACTIVE' }], { session });
        break;
      } catch (err) {
        if (err?.code !== 11000 || !err.keyPattern?.rollNo || attempt >= 4) throw err;
      }
    }
  }
  if (student.status !== 'ACTIVE') {
    student.status = 'ACTIVE';
    await student.save({ session });
  }
}

/**
 * The student record behind an ENROLLED lead.
 *
 * Moving a lead to ENROLLED used to create an ACTIVE student with no class,
 * guardian or fee -- a child "on roll" who appeared on no register -- and
 * moving the lead to LOST afterwards left them active. Now:
 *  - with a sectionId, the student is created (or re-activated) ACTIVE and
 *    enrolled in that section for the current academic year;
 *  - without one, the record is created INACTIVE: the admission number is
 *    reserved and the child is not counted on any roll until somebody places
 *    them (the same call again with a sectionId, or the student screens).
 * Returns { studentId, needsPlacement }, or null when the lead is not ENROLLED.
 */
async function ensureStudentForEnrolledLead(lead, session = null, { sectionId } = {}) {
  if (lead.stage !== 'ENROLLED') return null;
  const placement = await resolvePlacement(sectionId, session);
  const existingStudent = await Student.findOne({ leadId: lead._id }).session(session);
  if (existingStudent) {
    if (placement) await placeStudent(existingStudent, placement, session);
    const placed = await Enrollment.exists({ studentId: existingStudent._id, status: 'ACTIVE' }).session(session);
    return { studentId: existingStudent._id, needsPlacement: !placed || existingStudent.status !== 'ACTIVE' };
  }
  {
    const nameParts = lead.childName.trim().split(/\s+/);
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ') || '';

    // Retried only to absorb a collision with a hand-entered admission number;
    // the counter advances on every call, so each attempt uses a fresh value
    // and the loop converges immediately rather than re-testing the same one.
    let lastErr = null;
    for (let attempt = 0; attempt < ADMISSION_NO_ATTEMPTS; attempt++) {
      const admissionNo = await nextAdmissionNo(session);
      try {
        const [student] = await Student.create([{
          admissionNo,
          firstName,
          lastName,
          leadId: lead._id,
          status: placement ? 'ACTIVE' : 'INACTIVE',
        }], { session });
        if (placement) await placeStudent(student, placement, session);
        return { studentId: student._id, needsPlacement: !placement };
      } catch (err) {
        if (err?.code !== 11000) throw err;
        lastErr = err;
      }
    }
    // The old code fell out of its retry loop and created the student with a
    // number it already knew was taken, surfacing as an unhandled duplicate-key
    // 500. Fail with something the caller can act on instead.
    logger.error(
      `Admission number allocation failed after ${ADMISSION_NO_ATTEMPTS} attempts for lead ${lead._id}: ${lastErr?.message}`
    );
    throw new AppError(
      'Could not allocate an admission number. Check for manually assigned numbers that clash with the sequence.',
      409, [], 'ADMISSION_NO_UNAVAILABLE'
    );
  }
}

/**
 * A lead that leaves ENROLLED (lost, or moved back a stage) takes the student
 * record it created off the roll: the record goes INACTIVE and any active
 * enrolment is withdrawn. Nothing is deleted -- the admission number stays
 * reserved and the history stays readable.
 */
async function deactivateStudentForLead(lead, session = null) {
  const student = await Student.findOne({ leadId: lead._id }).session(session);
  if (!student) return;
  await Enrollment.updateMany({ studentId: student._id, status: 'ACTIVE' }, { $set: { status: 'WITHDRAWN' } }).session(session);
  if (student.status !== 'INACTIVE') {
    student.status = 'INACTIVE';
    await student.save({ session });
  }
}

/** Other enquiries with the same phone number (last 10 digits). */
async function sameNumberLeads(phone, excludeId = null) {
  const last10 = String(phone ?? '').replace(/\D/g, '').slice(-10);
  if (last10.length < 10) return [];
  const rows = await Lead.find({ phone: { $regex: last10 + '$' }, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })
    .select('childName guardianName stage createdAt').sort({ createdAt: 1 }).limit(10).lean();
  return rows.map((r) => ({ id: r._id, childName: r.childName, guardianName: r.guardianName, stage: r.stage, createdAt: r.createdAt }));
}

const PHONE_RULE = 'phone must be a valid number, e.g. +919876543210 or a 10-digit local number';

/**
 * A lead's contact number in the form it is stored, or null when it is not a
 * phone number. Presence alone used to be enough — the New Lead form pre-fills
 * "+91", so an untouched field created a lead with no way to reach the family.
 * The spaces, dashes, dots and brackets people type are dropped, then the
 * app's one phone rule (utils/validators.js, also used at sign-in) applies.
 */
function leadPhone(raw) {
  if (typeof raw !== 'string') return null;
  const compact = raw.trim().replace(/[\s().-]/g, '');
  return isValidPhone(compact) ? compact : null;
}

export async function createLead(data) {
  // Accept phoneE164 (frontend field name) or phone
  const rawPhone = data.phoneE164 ?? data.phone;

  if (!data.childName || !data.guardianName || !rawPhone) {
    throw new AppError('childName, guardianName, and phone are required', 400);
  }
  const phone = leadPhone(rawPhone);
  if (!phone) throw new AppError(PHONE_RULE, 400, [], 'INVALID_PHONE');

  // A family enquiring twice (or for a sibling) is common, so a repeat number
  // is not refused -- but it is no longer accepted silently either: the new
  // lead carries a note naming the earlier enquiries, and the response flags
  // them so the counsellor can merge by hand.
  const possibleDuplicates = await sameNumberLeads(phone);

  const lead = await Lead.create({
    childName: data.childName,
    guardianName: data.guardianName,
    phone,
    email: data.email ?? null,
    gradeApplying: data.gradeApplying ?? null,
    source: data.source ?? 'WALK_IN',
    stage: data.stage ?? 'NEW',
    notes: data.notes ?? null,
  });

  if (possibleDuplicates.length) {
    await LeadInteraction.create({
      leadId: lead._id,
      type: 'NOTE',
      body: `Possible duplicate: same phone as ${possibleDuplicates.map((d) => `${d.childName} (${d.stage.toLowerCase()})`).join(', ')}. Merge if it is the same family and child.`,
      authorProfileId: data.actorProfileId ?? null,
    });
  }

  const enrolment = await ensureStudentForEnrolledLead(lead, null, { sectionId: data.sectionId });

  return {
    id: lead._id,
    possibleDuplicate: possibleDuplicates.length > 0,
    possibleDuplicates,
    ...(enrolment ? { studentId: enrolment.studentId, needsPlacement: enrolment.needsPlacement } : {}),
  };
}

const LEAD_SOURCES = new Set(['WHATSAPP', 'WEB', 'WALK_IN', 'REFERRAL']);
const LEAD_STAGES = new Set(['NEW', 'CONTACTED', 'TOUR_SCHEDULED', 'APPLICATION', 'ENROLLED', 'LOST']);

/**
 * Bulk-imports leads from parsed CSV rows. Each row is validated and
 * inserted independently so one bad row doesn't sink the whole batch —
 * the caller gets back a per-row success/failure report.
 */
export async function bulkCreateLeads(rows) {
  const results = { imported: 0, failed: 0, errors: [] };
  const validRows = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2; // header is row 1
    const row = rows[i];
    const childName = row.childname?.trim();
    const guardianName = row.guardianname?.trim();
    const phone = leadPhone(row.phone);

    if (!childName || !guardianName || !row.phone?.trim()) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: !row.childname ? 'childName' : !row.guardianname ? 'guardianName' : 'phone',
        problem: 'is required',
        suggestion: 'every lead needs the child, the guardian and a contact number',
      }));
      continue;
    }
    if (!phone) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: 'phone',
        value: row.phone,
        problem: 'is not a valid phone number',
        suggestion: 'use +<country code><number>, e.g. +919876543210, or a 10-digit local number',
      }));
      continue;
    }

    const source = row.source?.trim().toUpperCase();
    const stage = row.stage?.trim().toUpperCase();
    if (source && !LEAD_SOURCES.has(source)) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: 'source',
        value: row.source,
        problem: 'is not a source this CRM knows',
        suggestion: 'check the template for the accepted values',
      }));
      continue;
    }
    if (stage && !LEAD_STAGES.has(stage)) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: 'stage',
        value: row.stage,
        problem: 'is not a pipeline stage',
        suggestion: 'check the template for the accepted values',
      }));
      continue;
    }

    validRows.push({
      rowNo,
      doc: {
        childName,
        guardianName,
        phone,
        email: row.email?.trim() || null,
        gradeApplying: row.gradeapplying?.trim() || null,
        source: source || 'WALK_IN',
        stage: stage || 'NEW',
        notes: row.notes?.trim() || null,
      }
    });
  }

  // Chunk and insert
  const CHUNK_SIZE = 100;
  for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
    const chunk = validRows.slice(i, i + CHUNK_SIZE);
    try {
      await runInTransaction(async (session) => {
        const docsToInsert = chunk.map(c => c.doc);
        const createdLeads = await Lead.insertMany(docsToInsert, { session });
        for (const lead of createdLeads) {
          await ensureStudentForEnrolledLead(lead, session);
        }
      });
      results.imported += chunk.length;
    } catch (err) {
      results.failed += chunk.length;
      chunk.forEach(c => {
        results.errors.push(rowError(c.rowNo, { problem: err.message }));
      });
    }
  }

  return results;
}

/**
 * Checks that a lead may be handed to this profile.
 *
 * The assignee used to be written straight through from the request body, so
 * a lead could be assigned to a profile in a *different school* (Profile is
 * not tenant-scoped — sign-in has to see across schools), or to someone with
 * no CRM access at all, such as a teacher or a parent. Either way the lead
 * left the pipeline of everyone who could act on it.
 *
 * Returns the id to store, or null when the assignment is being cleared.
 */
async function resolveAssignee(assigneeProfileId) {
  if (assigneeProfileId === null || assigneeProfileId === '') return null;
  if (!mongoose.isValidObjectId(assigneeProfileId)) {
    throw new AppError('That user cannot be assigned leads', 403, [], 'INVALID_ASSIGNEE');
  }

  const profile = await Profile.findOne({
    ...tenantFilter(), _id: assigneeProfileId, status: 'ACTIVE', deletedAt: null,
  }).populate('roleId');

  // Same message whether the profile belongs to another school, is inactive or
  // does not exist, so the error cannot be used to probe who is on the platform.
  if (!profile || !buildPermissionMap(profile.roleId)['admissions.manage']) {
    throw new AppError('That user cannot be assigned leads', 403, [], 'INVALID_ASSIGNEE');
  }
  return profile._id;
}

export async function updateLead({ leadId, stage, notes, assigneeProfileId, nextActionAt, actorProfileId, sectionId }) {
  const lead = await Lead.findById(leadId);
  if (!lead) throw new AppError('Lead not found', 404);

  const previousStage = lead.stage;
  if (stage !== undefined) {
    // The same enum the CSV importer validates against. Without this any string
    // was stored, and getPipeline() groups into fixed buckets — so a lead given
    // an unknown stage silently vanished from the board it lives on.
    if (!LEAD_STAGES.has(stage)) {
      throw new AppError(
        `stage must be one of: ${[...LEAD_STAGES].join(', ')}`,
        400, [], 'INVALID_LEAD_STAGE',
      );
    }
    lead.stage = stage;
  }
  if (notes !== undefined) lead.notes = notes;
  if (assigneeProfileId !== undefined) lead.assigneeProfileId = await resolveAssignee(assigneeProfileId);
  if (nextActionAt !== undefined) lead.nextActionAt = nextActionAt;
  await lead.save();

  if (stage && stage !== previousStage) {
    await LeadInteraction.create({
      leadId,
      type: 'STAGE_CHANGE',
      body: `${previousStage} → ${stage}`,
      authorProfileId: actorProfileId,
    });
  }

  // ENROLLED: the student record exists (placed in a class when sectionId is
  // given). Leaving ENROLLED: the record it created goes off the roll.
  const enrolment = await ensureStudentForEnrolledLead(lead, null, { sectionId });
  if (previousStage === 'ENROLLED' && lead.stage !== 'ENROLLED') await deactivateStudentForLead(lead);

  return {
    ...toLeadDto(lead),
    ...(enrolment ? { studentId: enrolment.studentId, needsPlacement: enrolment.needsPlacement } : {}),
  };
}

