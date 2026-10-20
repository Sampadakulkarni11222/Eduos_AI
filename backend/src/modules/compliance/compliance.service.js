import crypto from 'node:crypto';
import {
  ComplianceObligation, RegulatoryReturn, Licence, Policy, PolicyAcknowledgement, TrainingSession,
  RegulatoryNotice, NoticeSource,
} from '../../models/compliance.model.js';
import { Enrollment, Student } from '../../models/student.model.js';
import { Section, Grade } from '../../models/academics.model.js';
import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { Facility } from '../../models/facility.model.js';
import { Contract, Correspondence } from '../../models/administration.model.js';
import { InstitutionProfile } from '../../models/institution.model.js';
import { Role } from '../../models/role.model.js';
import { Profile } from '../../models/profile.model.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { AppError } from '../../utils/AppError.js';
import { buildPermissionMap } from '../../utils/buildPermissionMap.js';
import { logger } from '../../utils/logger.js';
import { createRequest, registerApprovalHandler } from '../approvals/approval.service.js';
import { notify } from '../notifications/notification.service.js';
import { sendOperational } from '../messaging/messaging.service.js';
import { candidateListData, disclosureData } from './documents.service.js';
import {
  nextRef, requireProfile, assertObjectId, assertTransition, pushHistory, cleanAttachments, asPaise,
  parseDate, requireText, optionalText, oneOf, dto, startOfDayUtc, profilesWithRoles,
} from '../ops/common.js';

/**
 * Compliance centre.
 *
 * The rule throughout: the system tracks obligations, deadlines and evidence;
 * people decide what applies. A catalogue item starts UNDER_REVIEW, a notice
 * changes nothing until a reviewer decides it applies, a return is not
 * "submitted" without an acknowledgement, and a licence's status comes from its
 * dates, never from a checkbox.
 */

// ── Obligation catalogue ──────────────────────────────────────────────────
// Each item cites the source register (docs/research/regulatory-source-register.md).
// They are suggestions to review, not determinations of law.
export const CATALOGUE = [
  { code: 'POCSO-REPORTING', title: 'Mandatory reporting of child sexual abuse (POCSO s.19/21) — designated officer and reporting procedure in place', authority: 'Government of India (POCSO Act 2012)', category: 'POLICY', institutionTypes: ['SCHOOL', 'COLLEGE'], frequency: 'EVENT_DRIVEN', sourceRef: 'REG-001', ownerRole: 'COMPLIANCE' },
  { code: 'POCSO-TRAINING', title: 'Child protection / POCSO awareness for all staff in contact with children', authority: 'MWCD (POCSO Rules 2020, rule 3) / NCPCR', category: 'TRAINING', institutionTypes: ['SCHOOL', 'COLLEGE'], frequency: 'ANNUAL', sourceRef: 'REG-003', ownerRole: 'COMPLIANCE' },
  { code: 'STAFF-POLICE-VERIFICATION', title: 'Police / background verification of staff, drivers and attendants before deployment', authority: 'CBSE Circular 19/2017; NCPCR Safety Manual 2021', category: 'OTHER', institutionTypes: ['SCHOOL'], frequency: 'EVENT_DRIVEN', sourceRef: 'REG-005', ownerRole: 'HR' },
  { code: 'POSH-IC', title: 'Internal Committee under the POSH Act constituted and displayed', authority: 'Government of India (POSH Act 2013)', category: 'COMMITTEE', institutionTypes: ['SCHOOL', 'COLLEGE'], frequency: 'ONE_TIME', sourceRef: 'REG-010', ownerRole: 'COMPLIANCE' },
  { code: 'POSH-ANNUAL-REPORT', title: 'POSH Internal Committee annual report to employer and District Officer', authority: 'Government of India (POSH Act 2013 s.21)', category: 'RETURN', institutionTypes: ['SCHOOL', 'COLLEGE'], frequency: 'ANNUAL', dueRule: 'Each calendar year, in the form and time prescribed by the Rules', sourceRef: 'REG-010', ownerRole: 'COMPLIANCE' },
  { code: 'ANTI-RAGGING-COMMITTEE', title: 'Anti-Ragging Committee and Squad constituted', authority: 'UGC Anti-Ragging Regulations 2009', category: 'COMMITTEE', institutionTypes: ['COLLEGE'], frequency: 'ANNUAL', sourceRef: 'REG-011', ownerRole: 'COMPLIANCE' },
  { code: 'ANTI-RAGGING-UNDERTAKING', title: 'Anti-ragging undertakings from every student and parent at admission and each academic year', authority: 'UGC Anti-Ragging Regulations (2nd amendment)', category: 'OTHER', institutionTypes: ['COLLEGE'], frequency: 'ANNUAL', sourceRef: 'REG-011', ownerRole: 'ADMIN' },
  { code: 'CBSE-PUBLIC-DISCLOSURE', title: 'Mandatory public disclosure on the school website kept current', authority: 'CBSE Affiliation Bye-Laws 2018', category: 'DISCLOSURE', institutionTypes: ['SCHOOL'], frequency: 'ANNUAL', sourceRef: 'REG-020', ownerRole: 'ADMIN' },
  { code: 'FIRE-SAFETY-CERT', title: 'Valid fire safety certificate', authority: 'CBSE affiliation conditions / local fire authority', category: 'LICENCE', institutionTypes: ['SCHOOL', 'COLLEGE'], frequency: 'EVENT_DRIVEN', sourceRef: 'REG-021', ownerRole: 'ADMIN' },
  { code: 'BUILDING-SAFETY-CERT', title: 'Valid building safety certificate', authority: 'CBSE affiliation conditions / local authority', category: 'LICENCE', institutionTypes: ['SCHOOL', 'COLLEGE'], frequency: 'EVENT_DRIVEN', sourceRef: 'REG-021', ownerRole: 'ADMIN' },
  { code: 'WATER-SANITATION-CERT', title: 'Safe drinking water and sanitation certificate', authority: 'CBSE affiliation conditions / local health authority', category: 'LICENCE', institutionTypes: ['SCHOOL'], frequency: 'EVENT_DRIVEN', sourceRef: 'REG-021', ownerRole: 'ADMIN' },
  { code: 'UDISE-PLUS', title: 'UDISE+ annual school data', authority: 'Ministry of Education (UDISE+)', category: 'RETURN', institutionTypes: ['SCHOOL'], frequency: 'ANNUAL', dueRule: 'Annual cycle announced by the state/UT; reference date 31 March from 2022-23 (verify each cycle)', sourceRef: 'REG-022', ownerRole: 'ADMIN' },
  { code: 'AISHE', title: 'AISHE annual higher-education survey', authority: 'Ministry of Education (AISHE)', category: 'RETURN', institutionTypes: ['COLLEGE'], frequency: 'ANNUAL', sourceRef: 'REG-023', ownerRole: 'ADMIN' },
  { code: 'TRANSPORT-SAFETY', title: 'School transport safety norms (driver licence/experience, speed limiting, attendant) reviewed', authority: 'CBSE transport circular 2012 / NCPCR manual', category: 'INSPECTION', institutionTypes: ['SCHOOL'], frequency: 'ANNUAL', sourceRef: 'REG-006', ownerRole: 'ADMIN' },
  { code: 'DPDP-CONSENT', title: 'Verifiable parental consent for processing children\'s personal data (phasing in under DPDP Rules 2025)', authority: 'MeitY (DPDP Act 2023, Rules 2025)', category: 'POLICY', institutionTypes: ['SCHOOL', 'COLLEGE'], frequency: 'ONE_TIME', sourceRef: 'DPD-002', ownerRole: 'COMPLIANCE' },
];

export async function seedCatalogue(actor, institutionType = 'SCHOOL') {
  const types = institutionType === 'COMBINED' ? ['SCHOOL', 'COLLEGE'] : [institutionType];
  let added = 0;
  for (const item of CATALOGUE.filter((c) => c.institutionTypes.some((t) => types.includes(t)))) {
    // eslint-disable-next-line no-await-in-loop
    const r = await ComplianceObligation.updateOne({ code: item.code }, { $setOnInsert: { ...item, applicability: 'UNDER_REVIEW' } }, { upsert: true });
    added += r.upsertedCount ?? 0;
  }
  return { added, total: await ComplianceObligation.countDocuments({}) };
}

export async function listObligations(query = {}) {
  const filter = {};
  if (query.applicability) filter.applicability = String(query.applicability).toUpperCase();
  if (query.category) filter.category = String(query.category).toUpperCase();
  const rows = await ComplianceObligation.find(filter).sort({ applicability: 1, nextDueOn: 1, code: 1 }).lean();
  return rows.map(dto);
}

export async function createObligation(body = {}) {
  const doc = await ComplianceObligation.create({
    code: requireText(body.code, 'code', { max: 40 }).toUpperCase(),
    title: requireText(body.title, 'title', { max: 300 }),
    authority: requireText(body.authority, 'authority', { max: 200 }),
    category: oneOf(body.category, ['RETURN', 'LICENCE', 'POLICY', 'TRAINING', 'DISCLOSURE', 'COMMITTEE', 'INSPECTION', 'OTHER'], 'category'),
    institutionTypes: Array.isArray(body.institutionTypes) ? body.institutionTypes.map((t) => oneOf(t, ['SCHOOL', 'COLLEGE'], 'institutionTypes')) : ['SCHOOL'],
    frequency: oneOf(body.frequency, ['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'EVENT_DRIVEN'], 'frequency', 'ANNUAL'),
    dueRule: optionalText(body.dueRule, { max: 300 }) || null,
    nextDueOn: parseDate(body.nextDueOn, 'nextDueOn'),
    sourceRef: optionalText(body.sourceRef, { max: 40 }) || null,
    sourceUrl: optionalText(body.sourceUrl, { max: 500 }) || null,
    ownerRole: optionalText(body.ownerRole, { max: 30 }) || 'ADMIN',
  }).catch((err) => { if (err?.code === 11000) throw new AppError('An obligation with that code exists', 409); throw err; });
  return dto(doc);
}

/** A person decides whether an obligation applies here, and records why. */
export async function reviewObligation(actor, id, body = {}) {
  const doc = await ComplianceObligation.findById(assertObjectId(id));
  if (!doc) throw new AppError('Obligation not found', 404);
  if (body.applicability !== undefined) {
    doc.applicability = oneOf(body.applicability, ['UNDER_REVIEW', 'APPLICABLE', 'NOT_APPLICABLE'], 'applicability');
    doc.applicabilityNote = requireText(body.note, 'note (why it does or does not apply)', { max: 2000 });
    doc.reviewedByProfileId = actor.profileId;
    doc.reviewedAt = new Date();
  }
  if (body.nextDueOn !== undefined) doc.nextDueOn = parseDate(body.nextDueOn, 'nextDueOn');
  if (body.ownerProfileId !== undefined) doc.ownerProfileId = body.ownerProfileId ? assertObjectId(body.ownerProfileId) : null;
  if (body.active !== undefined) doc.active = body.active !== false;
  await doc.save();
  return dto(doc);
}

// ── Regulatory returns ───────────────────────────────────────────────────

const RETURN_MACHINE = {
  DRAFT: ['IN_REVIEW'],
  IN_REVIEW: ['DRAFT', 'APPROVED_FOR_SUBMISSION'],
  APPROVED_FOR_SUBMISSION: ['SUBMITTED', 'DRAFT'],
  SUBMITTED: ['ACCEPTED', 'REJECTED'],
  REJECTED: ['RESUBMISSION_REQUIRED'],
  RESUBMISSION_REQUIRED: ['DRAFT'],
  ACCEPTED: [],
};
export const RETURN_TEMPLATES = {
  UDISE_PLUS_PROFILE: { title: 'UDISE+ school profile figures', authority: 'Ministry of Education (UDISE+)' },
  AISHE_PROFILE: { title: 'AISHE institution profile figures', authority: 'Ministry of Education (AISHE)' },
  MONTHLY_ATTENDANCE: { title: 'Monthly attendance return', authority: 'As required by board / department' },
  STAFF_STRENGTH: { title: 'Staff strength statement', authority: 'As required by board / department' },
  BOARD_CANDIDATE_LIST: { title: 'List of candidates for the board examination', authority: 'Examining board (e.g. CBSE, CISCE, State Board)' },
  MANDATORY_DISCLOSURE: { title: 'Mandatory public disclosure', authority: 'Affiliating board (published on the school website)' },
  CUSTOM: { title: 'Custom return', authority: 'Specify' },
};

async function enrolmentByGradeGender() {
  const enrolments = await Enrollment.find({ status: 'ACTIVE' }).select('studentId sectionId').lean();
  const sections = await Section.find({ _id: { $in: [...new Set(enrolments.map((e) => String(e.sectionId)))] } }).select('gradeId name').lean();
  const grades = await Grade.find({ _id: { $in: [...new Set(sections.map((s) => String(s.gradeId)))] } }).select('name level').lean();
  const students = await Student.find({ _id: { $in: enrolments.map((e) => e.studentId) } }).select('gender').lean();
  const gender = new Map(students.map((s) => [String(s._id), String(s.gender ?? '').toUpperCase()]));
  const gradeOfSection = new Map(sections.map((s) => [String(s._id), String(s.gradeId)]));
  const gradeById = new Map(grades.map((g) => [String(g._id), g]));
  const rows = new Map();
  let unknownGender = 0;
  for (const e of enrolments) {
    const g = gradeById.get(gradeOfSection.get(String(e.sectionId)));
    const key = g?.name ?? 'Unassigned';
    if (!rows.has(key)) rows.set(key, { grade: key, level: g?.level ?? 999, boys: 0, girls: 0, other: 0, unknown: 0, total: 0 });
    const r = rows.get(key);
    const sx = gender.get(String(e.studentId));
    if (['M', 'MALE', 'BOY'].includes(sx)) r.boys += 1;
    else if (['F', 'FEMALE', 'GIRL'].includes(sx)) r.girls += 1;
    else if (sx && sx !== 'UNDEFINED' && sx !== 'NULL') r.other += 1;
    else { r.unknown += 1; unknownGender += 1; }
    r.total += 1;
  }
  return { rows: [...rows.values()].sort((a, b) => a.level - b.level), unknownGender, total: enrolments.length };
}

async function staffCounts() {
  const roles = await Role.find({ key: { $in: ['PRINCIPAL', 'TEACHER', 'ADMIN', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'LIBRARIAN', 'WARDEN'] } }).select('_id key').lean();
  const tenantId = currentTenantId();
  const counts = await Profile.aggregate([
    { $match: { roleId: { $in: roles.map((r) => r._id) }, status: 'ACTIVE', deletedAt: null, ...(tenantId ? { tenantId } : {}) } },
    { $group: { _id: '$roleId', n: { $sum: 1 } } },
  ]);
  const keyOf = new Map(roles.map((r) => [String(r._id), r.key]));
  const out = {};
  for (const c of counts) out[keyOf.get(String(c._id))] = c.n;
  return out;
}

/**
 * Builds a return's figures from ERP records, with the validation a reviewer
 * needs to see before anything goes to an authority. Every figure says where
 * it came from.
 */
export async function generateData(template, period) {
  const validation = [];
  const profile = await InstitutionProfile.findOne({}).lean();
  if (template === 'UDISE_PLUS_PROFILE' || template === 'AISHE_PROFILE') {
    const codeField = template === 'UDISE_PLUS_PROFILE' ? 'udiseCode' : 'aisheCode';
    const campuses = (profile?.campuses ?? []).map((c) => ({ code: c.code, name: c.name, [codeField]: c[codeField] ?? null }));
    if (!campuses.some((c) => c[codeField])) validation.push({ level: 'ERROR', field: codeField, message: `No ${template === 'UDISE_PLUS_PROFILE' ? 'UDISE+' : 'AISHE'} code is recorded on any campus (Institution profile).` });
    const enrol = await enrolmentByGradeGender();
    if (enrol.unknownGender) validation.push({ level: 'WARNING', field: 'gender', message: `${enrol.unknownGender} enrolled students have no gender recorded.` });
    if (!enrol.total) validation.push({ level: 'ERROR', field: 'enrolment', message: 'No active enrolments found.' });
    const staff = await staffCounts();
    const rooms = await Facility.countDocuments({ kind: { $in: ['CLASSROOM', 'LECTURE_HALL'] } });
    const labs = await Facility.countDocuments({ kind: 'LAB' });
    const sample = await Facility.exists({ sampleLayout: true });
    if (sample) validation.push({ level: 'WARNING', field: 'infrastructure', message: 'Facility counts include a SAMPLE layout, not a surveyed one. Replace with real facilities before using these figures.' });
    return {
      data: {
        period, institution: profile?.legalName ?? profile?.displayName ?? null, campuses,
        enrolment: enrol.rows, totalEnrolment: enrol.total,
        teachingStaff: (staff.TEACHER ?? 0) + (staff.PRINCIPAL ?? 0),
        nonTeachingStaff: Object.entries(staff).filter(([k]) => !['TEACHER', 'PRINCIPAL'].includes(k)).reduce((n, [, v]) => n + v, 0),
        classrooms: rooms, laboratories: labs,
        sources: {
          enrolment: 'Active enrolments × student gender (Students module)',
          staff: 'Active staff profiles by role (Users)',
          infrastructure: 'Facilities register',
        },
      },
      validation,
    };
  }
  if (template === 'MONTHLY_ATTENDANCE') {
    if (!/^\d{4}-\d{2}$/.test(period)) throw new AppError('period must be YYYY-MM for a monthly attendance return', 400);
    const [y, m] = period.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1));
    const rows = await AttendanceRecord.aggregate([
      { $match: { date: { $gte: from, $lt: to }, periodNo: null } },
      { $lookup: { from: 'enrollments', localField: 'enrollmentId', foreignField: '_id', as: 'en' } },
      { $unwind: '$en' },
      { $group: { _id: '$en.sectionId', days: { $addToSet: '$date' }, present: { $sum: { $cond: [{ $in: ['$status', ['PRESENT', 'LATE']] }, 1, 0] } }, absent: { $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] } }, marked: { $sum: 1 } } },
    ]);
    const sections = await Section.find({ _id: { $in: rows.map((r) => r._id) } }).populate('gradeId', 'name').lean();
    const name = new Map(sections.map((s) => [String(s._id), `${s.gradeId?.name ?? ''} ${s.name}`.trim()]));
    const allSections = await Section.countDocuments({});
    const table = rows.map((r) => ({ section: name.get(String(r._id)) ?? String(r._id), workingDaysMarked: r.days.length, present: r.present, absent: r.absent, marks: r.marked, attendancePct: r.marked ? Math.round((r.present / r.marked) * 1000) / 10 : null }))
      .sort((a, b) => a.section.localeCompare(b.section));
    if (!table.length) validation.push({ level: 'ERROR', field: 'attendance', message: `No whole-day attendance is recorded for ${period}.` });
    if (table.length < allSections) validation.push({ level: 'WARNING', field: 'coverage', message: `${allSections - table.length} section(s) have no whole-day attendance for ${period}.` });
    const maxDays = Math.max(0, ...table.map((t) => t.workingDaysMarked));
    for (const t of table) if (t.workingDaysMarked < maxDays) validation.push({ level: 'WARNING', field: t.section, message: `${t.section}: ${t.workingDaysMarked} of ${maxDays} days marked.` });
    return { data: { period, sections: table, sources: { attendance: 'Whole-day attendance records (period-level excluded)' } }, validation };
  }
  if (template === 'BOARD_CANDIDATE_LIST') return candidateListData(period);
  if (template === 'MANDATORY_DISCLOSURE') return disclosureData();
  if (template === 'STAFF_STRENGTH') {
    const staff = await staffCounts();
    return { data: { period, byRole: staff, total: Object.values(staff).reduce((a, b) => a + b, 0), sources: { staff: 'Active staff profiles by role' } }, validation };
  }
  return { data: { period, figures: {} }, validation: [{ level: 'WARNING', field: 'figures', message: 'Custom return: enter the figures manually.' }] };
}

function presentReturn(r) {
  const out = dto(r);
  out.errors = (out.validation ?? []).filter((v) => v.level === 'ERROR').length;
  out.warnings = (out.validation ?? []).filter((v) => v.level === 'WARNING').length;
  out.isOverdue = out.dueOn && !['SUBMITTED', 'ACCEPTED'].includes(out.status) && new Date(out.dueOn) < startOfDayUtc();
  return out;
}

function moveReturn(r, actor, to, note) {
  assertTransition(RETURN_MACHINE, r.status, to, 'return');
  pushHistory(r, actor, to, { from: r.status, to, note });
  r.status = to;
}

export async function createReturn(actor, body = {}) {
  requireProfile(actor);
  const template = oneOf(body.template, Object.keys(RETURN_TEMPLATES), 'template');
  const period = requireText(body.period, 'period', { max: 20 });
  const { data, validation } = await generateData(template, period);
  const r = new RegulatoryReturn({
    refNo: await nextRef('RET'),
    obligationId: body.obligationId ? assertObjectId(body.obligationId) : null,
    template,
    title: optionalText(body.title, { max: 200 }) || `${RETURN_TEMPLATES[template].title} · ${period}`,
    authority: optionalText(body.authority, { max: 200 }) || RETURN_TEMPLATES[template].authority,
    period, dueOn: parseDate(body.dueOn, 'dueOn'), preparerProfileId: actor.profileId,
    data, validation, generatedAt: new Date(),
  });
  pushHistory(r, actor, 'GENERATED', { to: 'DRAFT', note: `${validation.length} validation finding(s)` });
  await r.save();
  return presentReturn(r.toObject());
}

async function loadReturn(id) {
  const r = await RegulatoryReturn.findById(assertObjectId(id));
  if (!r) throw new AppError('Return not found', 404);
  return r;
}

export async function regenerateReturn(actor, id) {
  const r = await loadReturn(id);
  if (r.status !== 'DRAFT') throw new AppError('Only a draft return can be regenerated.', 409);
  const { data, validation } = await generateData(r.template, r.period);
  r.data = data; r.validation = validation; r.generatedAt = new Date();
  pushHistory(r, actor, 'REGENERATED', { note: `${validation.length} validation finding(s)` });
  r.markModified('data');
  await r.save();
  return presentReturn(r.toObject());
}

/** Manual corrections to figures (custom returns, or a reviewer's adjustment) — logged. */
export async function editReturnData(actor, id, body = {}) {
  const r = await loadReturn(id);
  if (r.status !== 'DRAFT') throw new AppError('Only a draft return can be edited.', 409);
  if (!body.data || typeof body.data !== 'object') throw new AppError('data is required', 400);
  const note = requireText(body.note, 'note (what was changed and why)', { max: 1000 });
  r.data = { ...r.data, ...body.data, manualEdits: [...(r.data?.manualEdits ?? []), { at: new Date(), by: actor.displayName, note }] };
  pushHistory(r, actor, 'DATA_EDITED', { note });
  r.markModified('data');
  await r.save();
  return presentReturn(r.toObject());
}

/**
 * A reviewer has to be able to review: an active person in this school who
 * holds compliance.manage, and not the preparer. Naming anyone else used to
 * park the return with somebody who could never act on it.
 */
async function assertReviewer(profileId, r) {
  const id = assertObjectId(profileId, 'reviewerProfileId');
  if (String(id) === String(r.preparerProfileId)) throw new AppError('The preparer cannot review their own return.', 403, [], 'SELF_REVIEW');
  const tenantId = currentTenantId();
  const profile = await Profile.findOne({ _id: id, status: 'ACTIVE', deletedAt: null, ...(tenantId ? { tenantId } : {}) }).populate('roleId');
  if (!profile || !buildPermissionMap(profile.roleId)['compliance.manage']) {
    throw new AppError('The reviewer must be a member of staff who manages compliance.', 400, [], 'INVALID_REVIEWER');
  }
  return id;
}

export async function sendReturnForReview(actor, id, body = {}) {
  const r = await loadReturn(id);
  if (r.validation.some((v) => v.level === 'ERROR') && body.acknowledgeErrors !== true) {
    throw new AppError('This return has validation errors. Fix them, or acknowledge them explicitly.', 409, [], 'RETURN_HAS_ERRORS');
  }
  r.reviewerProfileId = body.reviewerProfileId ? await assertReviewer(body.reviewerProfileId, r) : r.reviewerProfileId;
  moveReturn(r, actor, 'IN_REVIEW', body.note);
  await r.save();
  if (r.reviewerProfileId) await notify({ recipientProfileIds: [String(r.reviewerProfileId)], type: 'SYSTEM', title: `Return to review: ${r.title}`, body: r.refNo, link: `/compliance?tab=returns&id=${r._id}` });
  return presentReturn(r.toObject());
}

/** Reviewer sends back, or asks the principal to approve it for submission. */
export async function reviewReturn(actor, id, body = {}) {
  const r = await loadReturn(id);
  if (r.status !== 'IN_REVIEW') throw new AppError('This return is not in review.', 409);
  if (String(r.preparerProfileId) === String(actor.profileId)) throw new AppError('The preparer cannot review their own return.', 403, [], 'SELF_REVIEW');
  // The route needs compliance.manage (it used to need only compliance.read,
  // so a trustee could push a return to the principal). When a reviewer was
  // named, only that person reviews.
  if (r.reviewerProfileId && String(r.reviewerProfileId) !== String(actor.profileId)) {
    throw new AppError('Only the reviewer this return was sent to can review it.', 403, [], 'NOT_THE_REVIEWER');
  }
  const decision = oneOf(body.decision, ['RETURN', 'REQUEST_APPROVAL'], 'decision');
  if (decision === 'RETURN') {
    moveReturn(r, actor, 'DRAFT', requireText(body.note, 'note', { max: 1000 }));
    r.reviewerProfileId = actor.profileId;
    await r.save();
    return presentReturn(r.toObject());
  }
  r.reviewerProfileId = actor.profileId;
  pushHistory(r, actor, 'REVIEWED', { note: body.note });
  await r.save();
  const req = await createRequest(actor, {
    category: 'REGULATORY_SUBMISSION', title: `Submit ${r.title} to ${r.authority}`,
    summary: `${r.refNo}. Reviewed by ${actor.displayName}. ${r.validation.length} validation finding(s).`,
    dueAt: r.dueOn ? new Date(Math.max(Date.now() + 3600_000, r.dueOn.getTime() - 2 * 86_400_000)).toISOString() : undefined,
    priority: r.dueOn && r.dueOn.getTime() - Date.now() < 3 * 86_400_000 ? 'URGENT' : 'NORMAL',
  }, { entityType: 'RegulatoryReturn', entityId: r._id });
  r.approvalRequestId = req.id;
  await r.save();
  return presentReturn(r.toObject());
}

registerApprovalHandler('RegulatoryReturn', {
  async onApproved(req, actor) { const r = await RegulatoryReturn.findById(req.entityId); if (!r) return; moveReturn(r, actor, 'APPROVED_FOR_SUBMISSION'); await r.save(); },
  async onRejected(req, actor) { const r = await RegulatoryReturn.findById(req.entityId); if (!r) return; moveReturn(r, actor, 'DRAFT', req.stages[req.currentStage]?.comment); r.approvalRequestId = null; await r.save(); },
  async onReturned(req, actor) { const r = await RegulatoryReturn.findById(req.entityId); if (!r) return; moveReturn(r, actor, 'DRAFT', req.stages[req.currentStage]?.comment); r.approvalRequestId = null; await r.save(); },
});

/**
 * Records that the return was actually submitted to the authority. Requires
 * evidence: the portal's acknowledgement number or a receipt. There is no
 * integration with authority portals; submission is done by a person.
 */
export async function recordSubmission(actor, id, body = {}) {
  const r = await loadReturn(id);
  if (r.status !== 'APPROVED_FOR_SUBMISSION') throw new AppError('A return must be approved for submission first.', 409, [], 'NOT_APPROVED');
  const ackNo = optionalText(body.acknowledgementNo, { max: 120 }) || null;
  const receiptUrl = optionalText(body.receiptUrl, { max: 1000 }) || null;
  if (!ackNo && !receiptUrl) throw new AppError('Record the acknowledgement number or upload the receipt — a generated file is not a filing.', 400, [], 'EVIDENCE_REQUIRED');
  r.submission = {
    method: oneOf(body.method, ['PORTAL_MANUAL', 'EMAIL', 'POST', 'HAND', 'API'], 'method'),
    at: parseDate(body.at, 'at') ?? new Date(), byProfileId: actor.profileId, acknowledgementNo: ackNo, receiptUrl,
  };
  r.attempts += 1;
  if (receiptUrl) r.attachments.push({ name: 'Submission receipt', url: receiptUrl, kind: 'RECEIPT', addedByProfileId: actor.profileId });
  moveReturn(r, actor, 'SUBMITTED', ackNo ? `Ack ${ackNo}` : 'Receipt attached');
  await r.save();
  return presentReturn(r.toObject());
}

export async function recordOutcome(actor, id, body = {}) {
  const r = await loadReturn(id);
  const outcome = oneOf(body.outcome, ['ACCEPTED', 'REJECTED'], 'outcome');
  r.authorityResponse = optionalText(body.response, { max: 4000 }) || null;
  if (outcome === 'REJECTED' && !r.authorityResponse) throw new AppError('Record what the authority said.', 400);
  moveReturn(r, actor, outcome, r.authorityResponse);
  if (outcome === 'REJECTED') moveReturn(r, actor, 'RESUBMISSION_REQUIRED');
  await r.save();
  return presentReturn(r.toObject());
}

export async function reopenForResubmission(actor, id) {
  const r = await loadReturn(id);
  moveReturn(r, actor, 'DRAFT', 'Reopened for resubmission');
  r.approvalRequestId = null;
  await r.save();
  return regenerateReturn(actor, id);
}

export async function listReturns(query = {}) {
  const filter = {};
  if (query.status) filter.status = String(query.status).toUpperCase();
  const rows = await RegulatoryReturn.find(filter).sort({ dueOn: 1, createdAt: -1 }).limit(300).select('-history').lean();
  return rows.map(presentReturn);
}

export async function getReturn(id) {
  return presentReturn((await loadReturn(id)).toObject());
}

/** CSV of a return's tabular figures, for assisted manual entry on a portal. */
export async function exportReturnCsv(id) {
  const r = await loadReturn(id);
  const table = r.data?.candidates ?? r.data?.enrolment ?? r.data?.sections ?? (r.data?.byRole ? Object.entries(r.data.byRole).map(([role, count]) => ({ role, count })) : []);
  if (!table.length) return `refNo,period\n${r.refNo},${r.period}\n`;
  const cols = Object.keys(table[0]);
  const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [`# ${r.refNo} ${r.title} — generated ${r.generatedAt?.toISOString() ?? ''}; status ${r.status}. Not a filing.`, cols.join(','), ...table.map((row) => cols.map((c) => esc(row[c])).join(','))].join('\n');
}

// ── Licences & certificates ───────────────────────────────────────────────

export function licenceStatus(l, now = new Date()) {
  if (!l.expiresOn) return 'NO_EXPIRY';
  const days = Math.round((startOfDayUtc(new Date(l.expiresOn)) - startOfDayUtc(now)) / 86_400_000);
  if (days < 0) return 'EXPIRED';
  if (days <= (l.renewalLeadDays ?? 60)) return 'EXPIRING';
  return 'VALID';
}

function presentLicence(l) {
  const out = dto(l);
  out.status = licenceStatus(l);
  out.daysToExpiry = l.expiresOn ? Math.round((startOfDayUtc(new Date(l.expiresOn)) - startOfDayUtc()) / 86_400_000) : null;
  return out;
}

const LICENCE_KINDS = ['RECOGNITION', 'AFFILIATION', 'NOC', 'CERTIFICATE', 'REGISTRATION', 'INSURANCE', 'VEHICLE', 'SOFTWARE_SUBSCRIPTION', 'OTHER'];

function licenceFields(body, actor, partial = false) {
  const out = {};
  if (!partial || body.kind !== undefined) out.kind = oneOf(body.kind, LICENCE_KINDS, 'kind');
  if (!partial || body.title !== undefined) out.title = requireText(body.title, 'title', { max: 200 });
  for (const f of ['issuer', 'number', 'campusCode', 'notes', 'linkedEntity', 'sourceRef']) if (body[f] !== undefined) out[f] = optionalText(body[f], { max: 500 }) || null;
  for (const f of ['issuedOn', 'validFrom', 'expiresOn']) if (body[f] !== undefined) out[f] = parseDate(body[f], f);
  if (body.renewalLeadDays !== undefined) out.renewalLeadDays = Math.max(0, Math.min(Number.parseInt(body.renewalLeadDays, 10) || 60, 730));
  if (body.renewalCostPaise !== undefined) out.renewalCostPaise = asPaise(body.renewalCostPaise, 'renewalCostPaise');
  if (body.renewalStatus !== undefined) out.renewalStatus = body.renewalStatus ? oneOf(body.renewalStatus, ['NOT_STARTED', 'IN_PROGRESS', 'APPLIED', 'RENEWED'], 'renewalStatus') : null;
  if (body.publicDisclosure !== undefined) out.publicDisclosure = body.publicDisclosure === true;
  if (body.ownerProfileId !== undefined) out.ownerProfileId = body.ownerProfileId ? assertObjectId(body.ownerProfileId) : null;
  if (Array.isArray(body.evidence)) out.evidence = cleanAttachments(body.evidence, actor);
  return out;
}

export async function createLicence(actor, body = {}) {
  const l = new Licence({ ...licenceFields(body, actor), ownerProfileId: body.ownerProfileId ? assertObjectId(body.ownerProfileId) : actor.profileId });
  pushHistory(l, actor, 'CREATED');
  await l.save();
  return presentLicence(l.toObject());
}

export async function updateLicence(actor, id, body = {}) {
  const l = await Licence.findById(assertObjectId(id));
  if (!l) throw new AppError('Licence not found', 404);
  const fields = licenceFields(body, actor, true);
  if (fields.evidence) { l.evidence.push(...fields.evidence); delete fields.evidence; }
  // Renewing means new dates; the old period stays in history.
  if (fields.expiresOn && l.expiresOn && fields.expiresOn.getTime() !== l.expiresOn.getTime()) {
    pushHistory(l, actor, 'RENEWED', { note: `Expiry ${l.expiresOn.toISOString().slice(0, 10)} → ${fields.expiresOn.toISOString().slice(0, 10)}` });
    fields.renewalStatus = fields.renewalStatus ?? 'RENEWED';
  } else pushHistory(l, actor, 'UPDATED');
  Object.assign(l, fields);
  await l.save();
  return presentLicence(l.toObject());
}

export async function listLicences(query = {}) {
  const filter = {};
  if (query.kind) filter.kind = String(query.kind).toUpperCase();
  const rows = await Licence.find(filter).sort({ expiresOn: 1 }).limit(1000).select('-history').lean();
  const out = rows.map(presentLicence);
  return query.status ? out.filter((l) => l.status === String(query.status).toUpperCase()) : out;
}

// ── Policies ─────────────────────────────────────────────────────────────

const POLICY_CATEGORIES = ['SAFEGUARDING', 'POSH', 'ANTI_RAGGING', 'ACADEMIC', 'EXAMINATION', 'HR', 'FINANCE', 'IT_DATA', 'TRANSPORT', 'SAFETY', 'ADMISSION', 'CONDUCT', 'OTHER'];
const AUDIENCE_ROLES = ['ADMIN', 'PRINCIPAL', 'TEACHER', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'LIBRARIAN', 'WARDEN', 'TRUSTEE', 'PARENT', 'STUDENT'];

function presentPolicy(p) {
  const out = dto(p);
  out.current = (out.versions ?? []).find((v) => v.version === out.currentVersion) ?? null;
  out.pendingVersion = (out.versions ?? []).find((v) => ['DRAFT', 'AWAITING_APPROVAL'].includes(v.status)) ?? null;
  out.reviewOverdue = out.nextReviewOn ? new Date(out.nextReviewOn) < startOfDayUtc() : false;
  return out;
}

export async function createPolicy(actor, body = {}) {
  const p = new Policy({
    code: requireText(body.code, 'code', { max: 30 }).toUpperCase(),
    title: requireText(body.title, 'title', { max: 200 }),
    category: oneOf(body.category, POLICY_CATEGORIES, 'category'),
    audienceRoles: Array.isArray(body.audienceRoles) ? body.audienceRoles.map((r) => oneOf(r, AUDIENCE_ROLES, 'audienceRoles')) : [],
    requiresAcknowledgement: body.requiresAcknowledgement === true,
    reviewEveryMonths: Math.max(1, Math.min(Number.parseInt(body.reviewEveryMonths, 10) || 12, 60)),
    ownerProfileId: actor.profileId,
    sourceRefs: Array.isArray(body.sourceRefs) ? body.sourceRefs.map((s) => String(s).slice(0, 40)).slice(0, 20) : [],
    versions: [{ version: 1, summary: optionalText(body.summary, { max: 2000 }) || null, body: optionalText(body.body, { max: 50000 }) || null, documentUrl: optionalText(body.documentUrl, { max: 1000 }) || null, status: 'DRAFT', createdByProfileId: actor.profileId }],
  });
  pushHistory(p, actor, 'CREATED');
  try { await p.save(); } catch (err) { if (err?.code === 11000) throw new AppError('A policy with that code exists', 409); throw err; }
  return presentPolicy(p.toObject());
}

export async function draftPolicyVersion(actor, id, body = {}) {
  const p = await Policy.findById(assertObjectId(id));
  if (!p) throw new AppError('Policy not found', 404);
  if (p.versions.some((v) => ['DRAFT', 'AWAITING_APPROVAL'].includes(v.status))) {
    const draft = p.versions.find((v) => v.status === 'DRAFT');
    if (!draft) throw new AppError('A version is already with the approver.', 409);
    draft.summary = optionalText(body.summary, { max: 2000 }) ?? draft.summary;
    draft.body = optionalText(body.body, { max: 50000 }) ?? draft.body;
    draft.documentUrl = optionalText(body.documentUrl, { max: 1000 }) ?? draft.documentUrl;
  } else {
    p.versions.push({ version: (p.versions.at(-1)?.version ?? 0) + 1, summary: optionalText(body.summary, { max: 2000 }) || null, body: optionalText(body.body, { max: 50000 }) || null, documentUrl: optionalText(body.documentUrl, { max: 1000 }) || null, status: 'DRAFT', createdByProfileId: actor.profileId });
  }
  p.markModified('versions');
  await p.save();
  return presentPolicy(p.toObject());
}

export async function submitPolicy(actor, id, body = {}) {
  const p = await Policy.findById(assertObjectId(id));
  if (!p) throw new AppError('Policy not found', 404);
  const draft = p.versions.find((v) => v.status === 'DRAFT');
  if (!draft) throw new AppError('There is no draft version to submit.', 409);
  if (!draft.body && !draft.documentUrl) throw new AppError('Add the policy text or document first.', 400);
  draft.status = 'AWAITING_APPROVAL';
  draft.effectiveFrom = parseDate(body.effectiveFrom, 'effectiveFrom') ?? new Date();
  const req = await createRequest(actor, {
    category: 'POLICY', title: `Policy ${p.code} v${draft.version}: ${p.title}`,
    summary: draft.summary ?? '', attachments: draft.documentUrl ? [{ name: `${p.code} v${draft.version}`, url: draft.documentUrl }] : [],
  }, { entityType: 'Policy', entityId: `${p._id}:${draft.version}` });
  draft.approvalRequestId = req.id;
  pushHistory(p, actor, `SUBMITTED v${draft.version}`);
  p.markModified('versions');
  await p.save();
  return presentPolicy(p.toObject());
}

async function policyVersion(req) {
  const [id, version] = String(req.entityId).split(':');
  const p = await Policy.findById(id);
  return { p, v: p?.versions.find((x) => x.version === Number(version)) };
}

registerApprovalHandler('Policy', {
  async onApproved(req, actor) {
    const { p, v } = await policyVersion(req);
    if (!p || !v) return;
    for (const other of p.versions) if (other.status === 'APPROVED') other.status = 'SUPERSEDED';
    v.status = 'APPROVED'; v.approvedAt = new Date();
    p.currentVersion = v.version;
    const from = v.effectiveFrom ?? new Date();
    p.nextReviewOn = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + p.reviewEveryMonths, from.getUTCDate()));
    pushHistory(p, actor, `APPROVED v${v.version}`);
    p.markModified('versions');
    await p.save();
    if (p.requiresAcknowledgement && p.audienceRoles.length) {
      const people = await profilesWithRoles(p.audienceRoles);
      await notify({ recipientProfileIds: people.map((x) => String(x._id)), type: 'SYSTEM', title: `Please read and acknowledge: ${p.title}`, body: `Version ${v.version}`, link: '/policies' });
    }
  },
  async onRejected(req) { const { p, v } = await policyVersion(req); if (!p || !v) return; v.status = 'REJECTED'; p.markModified('versions'); await p.save(); },
  async onReturned(req) { const { p, v } = await policyVersion(req); if (!p || !v) return; v.status = 'DRAFT'; p.markModified('versions'); await p.save(); },
});

export async function listPolicies() {
  const rows = await Policy.find({}).sort({ code: 1 }).select('-history').lean();
  const acks = await PolicyAcknowledgement.aggregate([{ $group: { _id: { policyId: '$policyId', version: '$version' }, n: { $sum: 1 } } }]);
  const ackCount = new Map(acks.map((a) => [`${a._id.policyId}:${a._id.version}`, a.n]));
  const audienceSize = new Map();
  for (const p of rows) {
    if (!p.requiresAcknowledgement) continue;
    const key = p.audienceRoles.slice().sort().join(',');
    // eslint-disable-next-line no-await-in-loop
    if (!audienceSize.has(key)) audienceSize.set(key, (await profilesWithRoles(p.audienceRoles)).length);
  }
  return rows.map((p) => ({
    ...presentPolicy(p),
    acknowledgements: p.currentVersion ? (ackCount.get(`${p._id}:${p.currentVersion}`) ?? 0) : 0,
    audienceSize: p.requiresAcknowledgement ? audienceSize.get(p.audienceRoles.slice().sort().join(',')) ?? 0 : null,
  }));
}

export async function getPolicy(id) {
  const p = await Policy.findById(assertObjectId(id)).lean();
  if (!p) throw new AppError('Policy not found', 404);
  return presentPolicy(p);
}

/** Approved policies addressed to the caller's role, with their own acknowledgement state. */
export async function myPolicies(actor) {
  requireProfile(actor);
  const rows = await Policy.find({ currentVersion: { $ne: null }, audienceRoles: actor.roleKey }).lean();
  const acks = await PolicyAcknowledgement.find({ profileId: actor.profileId }).lean();
  const done = new Set(acks.map((a) => `${a.policyId}:${a.version}`));
  return rows.map((p) => {
    const cur = p.versions.find((v) => v.version === p.currentVersion);
    return { id: String(p._id), code: p.code, title: p.title, category: p.category, version: p.currentVersion, summary: cur?.summary, body: cur?.body, documentUrl: cur?.documentUrl, effectiveFrom: cur?.effectiveFrom, requiresAcknowledgement: p.requiresAcknowledgement, acknowledged: done.has(`${p._id}:${p.currentVersion}`) };
  });
}

export async function acknowledgePolicy(actor, id) {
  requireProfile(actor);
  const p = await Policy.findById(assertObjectId(id)).lean();
  if (!p || !p.currentVersion || !p.audienceRoles.includes(actor.roleKey)) throw new AppError('Policy not found', 404);
  await PolicyAcknowledgement.updateOne({ policyId: p._id, version: p.currentVersion, profileId: actor.profileId }, { $setOnInsert: { at: new Date() } }, { upsert: true });
  return { acknowledged: true, version: p.currentVersion };
}

// ── Trainings ────────────────────────────────────────────────────────────

const AUDIENCE_TO_ROLES = {
  ALL_STAFF: ['PRINCIPAL', 'ADMIN', 'TEACHER', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'LIBRARIAN', 'WARDEN'],
  TEACHING_STAFF: ['PRINCIPAL', 'TEACHER'],
  NON_TEACHING_STAFF: ['ADMIN', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'LIBRARIAN', 'WARDEN'],
  DRIVERS_ATTENDANTS: [],
  STUDENTS: [],
  PARENTS: [],
  CUSTOM: [],
};
const TOPICS = ['POCSO_CHILD_PROTECTION', 'POSH', 'ANTI_RAGGING', 'FIRE_SAFETY', 'FIRST_AID', 'EMERGENCY_DRILL', 'TRANSPORT_SAFETY', 'CYBER_SAFETY', 'DATA_PROTECTION', 'INDUCTION', 'ACADEMIC', 'OTHER'];

function presentTraining(t) {
  const out = dto(t);
  const p = out.participants ?? [];
  out.invited = p.length;
  out.attended = p.filter((x) => x.status === 'ATTENDED').length;
  out.acknowledged = p.filter((x) => x.acknowledgedAt).length;
  return out;
}

/** "Tue 15 Dec, 10:00 am" in the school's time (IST), for notifications. */
export function istDateTime(d) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(d));
}

export async function scheduleTraining(actor, body = {}) {
  const audience = oneOf(body.audience, Object.keys(AUDIENCE_TO_ROLES), 'audience');
  const t = new TrainingSession({
    refNo: await nextRef('TRN'),
    topic: oneOf(body.topic, TOPICS, 'topic'),
    title: requireText(body.title, 'title', { max: 200 }),
    audience, audienceNote: optionalText(body.audienceNote, { max: 300 }) || null,
    mandatory: body.mandatory === true, basis: optionalText(body.basis, { max: 300 }) || null,
    scheduledAt: parseDate(body.scheduledAt, 'scheduledAt', { required: true }),
    durationMinutes: Math.max(10, Math.min(Number.parseInt(body.durationMinutes, 10) || 60, 600)),
    facilitator: optionalText(body.facilitator, { max: 160 }) || null,
    location: optionalText(body.location, { max: 160 }) || null,
    recurrenceMonths: body.recurrenceMonths ? Math.max(1, Math.min(Number(body.recurrenceMonths), 60)) : null,
    materials: cleanAttachments(body.materials, actor),
  });
  const roles = AUDIENCE_TO_ROLES[audience];
  if (roles.length) {
    const people = await profilesWithRoles(roles);
    t.participants = people.map((p) => ({ profileId: p._id, name: p.displayName, status: 'INVITED' }));
  }
  if (Array.isArray(body.participantProfileIds)) {
    const extra = await Profile.find({ _id: { $in: body.participantProfileIds.map((x) => assertObjectId(x)) } }).select('_id displayName').lean();
    for (const p of extra) if (!t.participants.some((x) => String(x.profileId) === String(p._id))) t.participants.push({ profileId: p._id, name: p.displayName });
  }
  pushHistory(t, actor, 'SCHEDULED');
  await t.save();
  if (t.participants.length) {
    await notify({ recipientProfileIds: t.participants.map((p) => String(p.profileId)), type: 'SYSTEM', title: `${t.mandatory ? 'Mandatory training' : 'Training'}: ${t.title}`, body: istDateTime(t.scheduledAt), link: '/trainings' });
  }
  return presentTraining(t.toObject());
}

export async function recordTrainingAttendance(actor, id, body = {}) {
  const t = await TrainingSession.findById(assertObjectId(id));
  if (!t) throw new AppError('Training not found', 404);
  if (t.status === 'CANCELLED') throw new AppError('This training was cancelled.', 409);
  // A completed training is a record of what happened: it cannot then be
  // cancelled, which used to erase it from coverage.
  if (body.cancel === true && t.status === 'COMPLETED') {
    throw new AppError('A completed training cannot be cancelled.', 409, [], 'TRAINING_COMPLETED');
  }
  // Nobody attends, misses or completes a session that has not started yet.
  const notYetHeld = t.scheduledAt && t.scheduledAt.getTime() > Date.now();
  const attendanceRows = Array.isArray(body.attendance) ? body.attendance : [];
  if (notYetHeld && (body.complete === true || attendanceRows.some((row) => ['ATTENDED', 'ABSENT'].includes(String(row?.status).toUpperCase())))) {
    throw new AppError(`This training is scheduled for ${istDateTime(t.scheduledAt)}; record attendance or complete it after it has been held.`, 409, [], 'TRAINING_NOT_HELD');
  }
  for (const row of attendanceRows) {
    const p = t.participants.find((x) => String(x.profileId) === String(row.profileId));
    if (!p) continue;
    p.status = oneOf(row.status, ['INVITED', 'ATTENDED', 'ABSENT', 'EXEMPT'], 'status');
    if (row.assessmentScore !== undefined) p.assessmentScore = row.assessmentScore === null ? null : Math.max(0, Math.min(Number(row.assessmentScore), 100));
  }
  if (body.groupAttendance !== undefined) t.groupAttendance = Math.max(0, Number.parseInt(body.groupAttendance, 10) || 0);
  if (Array.isArray(body.evidence)) t.evidence.push(...cleanAttachments(body.evidence, actor));
  if (body.complete === true) {
    if (!t.evidence.length && !body.notes) throw new AppError('Attach evidence (attendance sheet, photos) or notes before completing.', 400, [], 'EVIDENCE_REQUIRED');
    t.status = 'COMPLETED';
    pushHistory(t, actor, 'COMPLETED');
  }
  if (body.cancel === true) { t.status = 'CANCELLED'; pushHistory(t, actor, 'CANCELLED', { note: body.notes }); }
  if (body.notes !== undefined) t.notes = optionalText(body.notes, { max: 4000 }) || null;
  t.markModified('participants');
  await t.save();
  return presentTraining(t.toObject());
}

export async function listTrainings(query = {}) {
  const filter = {};
  if (query.topic) filter.topic = String(query.topic).toUpperCase();
  if (query.status) filter.status = String(query.status).toUpperCase();
  const rows = await TrainingSession.find(filter).sort({ scheduledAt: -1 }).limit(300).select('-history').lean();
  return rows.map(presentTraining);
}

export async function myTrainings(actor) {
  requireProfile(actor);
  const rows = await TrainingSession.find({ 'participants.profileId': actor.profileId }).sort({ scheduledAt: -1 }).limit(100).lean();
  return rows.map((t) => {
    const me = t.participants.find((p) => String(p.profileId) === String(actor.profileId));
    return { id: String(t._id), refNo: t.refNo, title: t.title, topic: t.topic, mandatory: t.mandatory, scheduledAt: t.scheduledAt, location: t.location, status: t.status, myStatus: me?.status, acknowledgedAt: me?.acknowledgedAt, materials: t.materials };
  });
}

export async function acknowledgeTraining(actor, id) {
  const t = await TrainingSession.findOne({ _id: assertObjectId(id), 'participants.profileId': actor.profileId });
  if (!t) throw new AppError('Training not found', 404);
  const me = t.participants.find((p) => String(p.profileId) === String(actor.profileId));
  me.acknowledgedAt = me.acknowledgedAt ?? new Date();
  t.markModified('participants');
  await t.save();
  return { acknowledged: true };
}

/**
 * For each mandatory topic: of the current staff who should have it, how many
 * attended a completed session within its recurrence window.
 */
export async function trainingCoverage() {
  const sessions = await TrainingSession.find({ mandatory: true, status: 'COMPLETED' }).lean();
  const topics = [...new Set(sessions.map((s) => s.topic))];
  const out = [];
  for (const topic of topics) {
    const ofTopic = sessions.filter((s) => s.topic === topic);
    const months = Math.max(...ofTopic.map((s) => s.recurrenceMonths ?? 12));
    const since = new Date(Date.now() - months * 30.44 * 86_400_000);
    const trained = new Set(ofTopic.filter((s) => s.scheduledAt >= since).flatMap((s) => s.participants.filter((p) => p.status === 'ATTENDED').map((p) => String(p.profileId))));
    const roles = AUDIENCE_TO_ROLES[ofTopic[0].audience]?.length ? AUDIENCE_TO_ROLES[ofTopic[0].audience] : AUDIENCE_TO_ROLES.ALL_STAFF;
    // eslint-disable-next-line no-await-in-loop
    const staff = await profilesWithRoles(roles);
    const covered = staff.filter((p) => trained.has(String(p._id))).length;
    out.push({ topic, windowMonths: months, staff: staff.length, covered, pct: staff.length ? Math.round((covered / staff.length) * 100) : null, untrained: staff.filter((p) => !trained.has(String(p._id))).map((p) => ({ profileId: String(p._id), name: p.displayName })).slice(0, 200) });
  }
  return out;
}

// ── Notices (board / state / district / university) ───────────────────────

const NOTICE_SOURCES = ['CBSE', 'CISCE', 'STATE_BOARD', 'STATE_EDUCATION_DEPT', 'DISTRICT_COLLECTOR', 'DISTRICT_EDUCATION_OFFICE', 'MINISTRY', 'UGC', 'AICTE', 'UNIVERSITY', 'NCPCR_SCPCR', 'COURT', 'OTHER'];

export async function createNotice(actor, body = {}) {
  const n = new RegulatoryNotice({
    refNo: await nextRef('NTC'),
    source: oneOf(body.source, NOTICE_SOURCES, 'source'),
    jurisdiction: optionalText(body.jurisdiction, { max: 120 }) || null,
    title: requireText(body.title, 'title', { max: 300 }),
    theirReference: optionalText(body.theirReference, { max: 120 }) || null,
    url: optionalText(body.url, { max: 1000 }) || null,
    documentUrl: optionalText(body.documentUrl, { max: 1000 }) || null,
    receivedVia: oneOf(body.receivedVia, ['MANUAL', 'EMAIL', 'SOURCE_CHECK', 'CORRESPONDENCE'], 'receivedVia', 'MANUAL'),
    publishedOn: parseDate(body.publishedOn, 'publishedOn'),
    effectiveOn: parseDate(body.effectiveOn, 'effectiveOn'),
    summary: optionalText(body.summary, { max: 10000 }) ?? '',
    correspondenceId: body.correspondenceId ? assertObjectId(body.correspondenceId) : null,
  });
  pushHistory(n, actor, 'RECEIVED', { to: 'NEW' });
  await n.save();
  const officers = await profilesWithRoles(['COMPLIANCE', 'PRINCIPAL']);
  await notify({ recipientProfileIds: officers.map((p) => String(p._id)).filter((x) => x !== String(actor?.profileId)), type: 'SYSTEM', title: `New notice to review: ${n.title}`, body: `${n.source}${n.jurisdiction ? ` · ${n.jurisdiction}` : ''}`, link: `/compliance?tab=notices&id=${n._id}` });
  return dto(n);
}

/**
 * The reviewer's decision. A notice never changes a policy or obligation by
 * itself; a decision of APPLICABLE comes with the actions that follow from it.
 */
export async function decideNotice(actor, id, body = {}) {
  const n = await RegulatoryNotice.findById(assertObjectId(id));
  if (!n) throw new AppError('Notice not found', 404);
  if (body.authenticity) {
    n.authenticity = oneOf(body.authenticity, ['UNVERIFIED', 'VERIFIED', 'SUSPECT'], 'authenticity');
    n.authenticityNote = optionalText(body.authenticityNote, { max: 500 }) || null;
    pushHistory(n, actor, `AUTHENTICITY_${n.authenticity}`, { note: n.authenticityNote });
    if (n.status === 'NEW') n.status = 'UNDER_REVIEW';
  }
  if (body.applicability) {
    const decision = oneOf(body.applicability, ['APPLICABLE', 'NOT_APPLICABLE'], 'applicability');
    if (decision === 'APPLICABLE' && n.authenticity !== 'VERIFIED') throw new AppError('Verify the notice is genuine before deciding it applies.', 409, [], 'UNVERIFIED_NOTICE');
    n.decision = { byProfileId: actor.profileId, byName: actor.displayName, at: new Date(), rationale: requireText(body.rationale, 'rationale', { max: 3000 }) };
    pushHistory(n, actor, decision, { from: n.status, to: decision, note: n.decision.rationale });
    n.status = decision;
  }
  if (Array.isArray(body.actions)) {
    if (n.status !== 'APPLICABLE' && n.status !== 'ACTIONED') throw new AppError('Actions follow a decision that the notice applies.', 409);
    n.actions = body.actions.slice(0, 50).map((a) => ({
      title: requireText(a.title, 'action title', { max: 300 }), ownerProfileId: a.ownerProfileId ? assertObjectId(a.ownerProfileId) : null,
      dueOn: parseDate(a.dueOn, 'action dueOn'), done: a.done === true, linkedType: a.linkedType ? String(a.linkedType).slice(0, 40) : null, linkedId: a.linkedId ? String(a.linkedId).slice(0, 60) : null,
    }));
    const owners = n.actions.filter((a) => a.ownerProfileId && !a.done).map((a) => String(a.ownerProfileId));
    if (owners.length) await notify({ recipientProfileIds: owners, type: 'SYSTEM', title: `Action from notice: ${n.title}`, body: n.refNo, link: `/compliance?tab=notices&id=${n._id}` });
    if (n.actions.length && n.actions.every((a) => a.done)) { pushHistory(n, actor, 'ACTIONED'); n.status = 'ACTIONED'; }
  }
  await n.save();
  return dto(n);
}

export async function listNotices(query = {}) {
  const filter = {};
  if (query.status) filter.status = String(query.status).toUpperCase();
  const rows = await RegulatoryNotice.find(filter).sort({ createdAt: -1 }).limit(300).select('-history').lean();
  return rows.map(dto);
}

export async function listNoticeSources() {
  return (await NoticeSource.find({}).sort({ name: 1 }).lean()).map(dto);
}

export async function addNoticeSource(body = {}) {
  const url = requireText(body.url, 'url', { max: 1000 });
  if (!/^https:\/\//i.test(url)) throw new AppError('Only https:// sources can be watched.', 400);
  return dto(await NoticeSource.create({
    name: requireText(body.name, 'name', { max: 160 }), url,
    source: oneOf(body.source, NOTICE_SOURCES, 'source'), jurisdiction: optionalText(body.jurisdiction, { max: 120 }) || null,
  }));
}

let fetchPage = async (url) => {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'EduOS-NoticeWatch/1.0 (+change detection only)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return text.slice(0, 2_000_000);
};
export function setNoticeFetcherForTests(fn) { fetchPage = fn; }

/**
 * Checks a watched official page for change. This is change detection on a
 * page the institution chose, not a feed: a change creates a NEW, UNVERIFIED
 * notice pointing at the page, for a person to read and decide on. A failure
 * is recorded as such, never as "no new notices".
 */
export async function checkNoticeSource(actor, id) {
  const src = await NoticeSource.findById(assertObjectId(id));
  if (!src) throw new AppError('Source not found', 404);
  let created = null;
  try {
    const body = await fetchPage(src.url);
    // Strip scripts and whitespace so trivial markup churn does not count as a change.
    const normalised = body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/\s+/g, ' ');
    const hash = crypto.createHash('sha256').update(normalised).digest('hex');
    const changed = Boolean(src.contentHash) && src.contentHash !== hash;
    src.lastStatus = !src.contentHash ? 'UNCHANGED' : changed ? 'CHANGED' : 'UNCHANGED';
    src.contentHash = hash;
    src.lastError = null;
    if (changed) {
      created = await createNotice(actor, { source: src.source, jurisdiction: src.jurisdiction, title: `Page changed: ${src.name}`, url: src.url, receivedVia: 'SOURCE_CHECK', summary: 'The watched page changed since the last check. Open it, identify the new notice, and record its details here.' });
    }
  } catch (err) {
    src.lastStatus = 'FAILED';
    src.lastError = String(err.message).slice(0, 300);
    logger.warn(`Notice source check failed (${src.url}): ${err.message}`);
  }
  src.lastCheckedAt = new Date();
  await src.save();
  return { source: dto(src), notice: created };
}

// ── Calendar & overview ──────────────────────────────────────────────────

/**
 * Reminds the compliance officer and administrators of dated items that fall
 * due within `withinDays`, or are already overdue. Once per item per week, so
 * a daily run does not nag. Letters are left to the correspondence reminders,
 * which go to each letter's own owner.
 */
export async function sendDeadlineReminders(actor, { withinDays = 14, now = new Date() } = {}) {
  const items = (await calendar({ days: withinDays })).filter((i) => i.kind !== 'CORRESPONDENCE');
  if (!items.length) return { itemsDue: 0, messages: 0 };
  const who = (await profilesWithRoles(['COMPLIANCE', 'ADMIN'])).map((p) => String(p._id));
  const week = Math.floor(now.getTime() / (7 * 86_400_000));
  let messages = 0;
  for (const i of items) {
    // eslint-disable-next-line no-await-in-loop
    const r = await sendOperational({
      templateKey: 'DEADLINE_REMINDER', recipientProfileIds: who,
      variables: { title: `${i.title}${i.overdue ? ' (overdue)' : ''}`.slice(0, 120), dueOn: new Date(i.renewBy ?? i.date).toISOString().slice(0, 10) },
      link: i.link, idempotencyKey: `compliance-due:${i.kind}:${i.id}:${week}`,
      relatedEntityType: i.kind, relatedEntityId: i.id, requestedBy: actor?.profileId ?? null,
    });
    messages += r.filter((x) => !x.duplicate).length;
  }
  return { itemsDue: items.length, messages };
}

/** Every dated compliance item in one list, soonest first. */
export async function calendar({ days = 120 } = {}) {
  const now = startOfDayUtc();
  const until = new Date(now.getTime() + days * 86_400_000);
  const [obligations, returns, licences, policies, trainings, contracts, letters] = await Promise.all([
    ComplianceObligation.find({ active: true, applicability: { $ne: 'NOT_APPLICABLE' }, nextDueOn: { $ne: null, $lte: until } }).lean(),
    RegulatoryReturn.find({ status: { $nin: ['ACCEPTED', 'SUBMITTED'] }, dueOn: { $ne: null, $lte: until } }).lean(),
    Licence.find({ expiresOn: { $ne: null } }).lean(),
    Policy.find({ nextReviewOn: { $ne: null, $lte: until } }).lean(),
    TrainingSession.find({ status: 'SCHEDULED', scheduledAt: { $lte: until } }).lean(),
    Contract.find({ status: { $in: ['ACTIVE', 'EXECUTED'] }, endsOn: { $ne: null } }).lean(),
    Correspondence.find({ status: { $nin: ['CLOSED', 'NO_ACTION'] }, dueOn: { $ne: null, $lte: until } }).select('refNo subject dueOn').lean(),
  ]);
  const items = [
    ...obligations.map((o) => ({ kind: 'OBLIGATION', id: String(o._id), title: o.title, date: o.nextDueOn, status: o.applicability, link: '/compliance?tab=obligations' })),
    ...returns.map((r) => ({ kind: 'RETURN', id: String(r._id), title: r.title, date: r.dueOn, status: r.status, link: `/compliance?tab=returns&id=${r._id}` })),
    ...licences.map((l) => ({ kind: 'LICENCE', id: String(l._id), title: `${l.title} expires`, date: l.expiresOn, renewBy: new Date(l.expiresOn.getTime() - (l.renewalLeadDays ?? 60) * 86_400_000), status: licenceStatus(l), link: '/compliance?tab=licences' }))
      .filter((l) => l.renewBy <= until),
    ...policies.map((p) => ({ kind: 'POLICY_REVIEW', id: String(p._id), title: `Review policy ${p.code}`, date: p.nextReviewOn, status: 'REVIEW', link: '/compliance?tab=policies' })),
    ...trainings.map((t) => ({ kind: 'TRAINING', id: String(t._id), title: t.title, date: t.scheduledAt, status: t.mandatory ? 'MANDATORY' : 'SCHEDULED', link: '/compliance?tab=trainings' })),
    ...contracts.map((c) => ({ kind: 'AGREEMENT', id: String(c._id), title: `Notice deadline: ${c.title}`, date: new Date(c.endsOn.getTime() - (c.noticePeriodDays ?? 30) * 86_400_000), status: c.status, link: '/contracts' }))
      .filter((c) => c.date <= until),
    ...letters.map((l) => ({ kind: 'CORRESPONDENCE', id: String(l._id), title: `${l.refNo} ${l.subject}`, date: l.dueOn, status: 'DUE', link: `/correspondence?id=${l._id}` })),
  ].map((i) => ({ ...i, overdue: new Date(i.renewBy ?? i.date) < now }))
    .sort((a, b) => new Date(a.renewBy ?? a.date) - new Date(b.renewBy ?? b.date));
  return items;
}

export async function overview() {
  const [obligations, underReview, returnsOpen, returnsOverdue, licences, noticesNew, policiesReview] = await Promise.all([
    ComplianceObligation.countDocuments({ active: true, applicability: 'APPLICABLE' }),
    ComplianceObligation.countDocuments({ applicability: 'UNDER_REVIEW' }),
    RegulatoryReturn.countDocuments({ status: { $nin: ['ACCEPTED'] } }),
    RegulatoryReturn.countDocuments({ status: { $nin: ['ACCEPTED', 'SUBMITTED'] }, dueOn: { $lt: startOfDayUtc() } }),
    Licence.find({}).select('expiresOn renewalLeadDays').lean(),
    RegulatoryNotice.countDocuments({ status: { $in: ['NEW', 'UNDER_REVIEW'] } }),
    Policy.countDocuments({ nextReviewOn: { $lt: startOfDayUtc() } }),
  ]);
  const ls = licences.map((l) => licenceStatus(l));
  return {
    applicableObligations: obligations, obligationsUnderReview: underReview,
    returnsOpen, returnsOverdue,
    licencesExpired: ls.filter((s) => s === 'EXPIRED').length, licencesExpiring: ls.filter((s) => s === 'EXPIRING').length,
    noticesToReview: noticesNew, policiesReviewOverdue: policiesReview,
    trainingCoverage: await trainingCoverage(),
  };
}
