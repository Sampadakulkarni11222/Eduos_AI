import mongoose from 'mongoose';
import { Lead, LeadInteraction } from '../../models/lead.model.js';
import { Profile } from '../../models/profile.model.js';
import { buildPermissionMap } from '../../utils/buildPermissionMap.js';
import { tenantFilter } from '../../tenancy/tenantContext.js';
import { Student } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { runInTransaction } from '../../utils/transaction.js';
import { nextSequence } from '../../utils/sequence.js';
import { logger } from '../../utils/logger.js';

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

async function ensureStudentForEnrolledLead(lead, session = null) {
  if (lead.stage !== 'ENROLLED') return;
  const existingStudent = await Student.findOne({ leadId: lead._id }).session(session);
  if (!existingStudent) {
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
        await Student.create([{
          admissionNo,
          firstName,
          lastName,
          leadId: lead._id,
          status: 'ACTIVE',
        }], { session });
        return;
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

export async function createLead(data) {
  // Accept phoneE164 (frontend field name) or phone
  const phone = data.phoneE164 ?? data.phone;

  if (!data.childName || !data.guardianName || !phone) {
    throw new AppError('childName, guardianName, and phone are required', 400);
  }

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

  await ensureStudentForEnrolledLead(lead);

  return { id: lead._id };
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
    const phone = row.phone?.trim();

    if (!childName || !guardianName || !phone) {
      results.failed++;
      results.errors.push({ row: rowNo, error: 'childName, guardianName, and phone are required' });
      continue;
    }

    const source = row.source?.trim().toUpperCase();
    const stage = row.stage?.trim().toUpperCase();
    if (source && !LEAD_SOURCES.has(source)) {
      results.failed++;
      results.errors.push({ row: rowNo, error: `Invalid source "${row.source}"` });
      continue;
    }
    if (stage && !LEAD_STAGES.has(stage)) {
      results.failed++;
      results.errors.push({ row: rowNo, error: `Invalid stage "${row.stage}"` });
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
        results.errors.push({ row: c.rowNo, error: err.message });
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

export async function updateLead({ leadId, stage, notes, assigneeProfileId, nextActionAt, actorProfileId }) {
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

  // Ensure student record exists if lead is ENROLLED
  await ensureStudentForEnrolledLead(lead);

  return toLeadDto(lead);
}

