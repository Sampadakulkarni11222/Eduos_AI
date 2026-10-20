import {
  HealthVisit, MedicationPlan, MedicationDose, HealthStock, CareNote, HealthEntry, HealthSettings,
  VISIT_OUTCOMES, NOTIFY_TRIGGERS, DOSE_STATUSES, STOCK_KINDS,
} from '../../models/health.model.js';
import { Student, StudentGuardian, Enrollment } from '../../models/student.model.js';
import { Section } from '../../models/academics.model.js';
import { MedicalRecord } from '../../models/medicalRecord.model.js';
import { AppError } from '../../utils/AppError.js';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { recordPiiRead, recordAudit } from '../../utils/auditTrail.js';
import { getGuardianStudentIds } from '../../utils/scope.js';
import { upsertFromSource, resolveSource } from '../tasks/tasks.service.js';
import { sendOperational } from '../messaging/messaging.service.js';
import {
  nextRef, requireProfile, assertObjectId, pushHistory, parseDate, requireText, optionalText, oneOf,
  profilesWithRoles, escapeRegex, cleanAttachments,
} from '../ops/common.js';
import { activeEnrollment, classLabel, studentLabel, istInstant, istDay, istYmd } from '../ptm/relations.js';
import { logger } from '../../utils/logger.js';

/**
 * The school health room (coverage row F14).
 *
 * Who sees what
 *   health.read / health.manage ALL   the school nurse: every child's visits, plans, doses, stock,
 *                                     immunisations, screenings and care notes
 *   health.read OWN (parent)          their own child's visits, medication plans and log, care notes,
 *                                     immunisations, screenings and health card. Consent to a plan
 *                                     and to sharing a care note is given here too.
 *   health.carenotes.read OWN         the class teacher: the short care notes the parent agreed to
 *                                     share, for the class they are class teacher of. Nothing else.
 *   health.summary.read               counts only: no names, no clinical words
 *   health.witness                    countersign a controlled-medicine dose (a different person)
 *
 * The health.* keys are RESTRICTED_BY_DEFAULT: the administrator does not hold
 * them unless the school grants them, deliberately and audited.
 *
 * Every read that discloses a child's health record is audited
 * (recordPiiRead), naming the child and the endpoint, never the values. Health
 * data never reaches feeds, analytics (beyond the counts here), the map or
 * search: nothing outside this module reads these collections.
 */

const DAY = 86_400_000;
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const FAMILY = ['PARENT', 'STUDENT'];
const OUTCOME_LABEL = {
  RETURNED_TO_CLASS: 'Returned to class', REST: 'Rested in the health room', FIRST_AID: 'First aid given',
  SENT_HOME: 'Sent home', REFERRED: 'Referred to a doctor or hospital',
};
const isFamily = (actor) => FAMILY.includes(actor?.roleKey);
const scopeOf = (actor, key) => actor?.permissions?.[key] ?? null;
const isNurse = (actor) => scopeOf(actor, 'health.manage') === 'ALL';
const dec = (v, fallback = null) => {
  try { return decrypt(v) ?? fallback; } catch (err) { logger.error(`Health record could not be decrypted: ${err.message}`); return fallback; }
};

// ── access ───────────────────────────────────────────────────────────────

async function ownChildren(actor) {
  if (actor?.roleKey !== 'PARENT') return [];
  return (await getGuardianStudentIds(actor.profileId)).map(String);
}

/**
 * The students whose health record this actor may read. ALL → null (any);
 * a parent at OWN → their own children; anyone else → refused.
 */
async function readableStudents(actor) {
  const scope = scopeOf(actor, 'health.read');
  if (scope === 'ALL') return null;
  if (scope === 'OWN' && actor.roleKey === 'PARENT') return ownChildren(actor);
  throw new AppError('Health records are not available to you.', 403, [], 'HEALTH_RESTRICTED');
}

/** Refuses (404, so the child's existence is not confirmed) a student outside the caller's reach; audits the attempt. */
async function assertCanRead(actor, studentId, via) {
  const allowed = await readableStudents(actor);
  if (allowed === null || allowed.includes(String(studentId))) return;
  await recordPiiRead({ actor, action: 'health.access_denied', entityType: 'HealthRecord', entityId: studentId, via, fields: [] });
  throw new AppError('Health record not found', 404);
}

function assertNurse(actor) {
  if (!isNurse(actor)) throw new AppError('Only the school nurse (health.manage) can do this.', 403, [], 'HEALTH_RESTRICTED');
  requireProfile(actor);
}

async function loadStudent(studentId) {
  const s = await Student.findOne({ _id: assertObjectId(studentId, 'studentId'), deletedAt: null }).select('firstName lastName admissionNo').lean();
  if (!s) throw new AppError('Student not found', 404);
  return s;
}

async function studentNames(ids) {
  const unique = [...new Set(ids.map(String))];
  const rows = await Student.find({ _id: { $in: unique } }).select('firstName lastName admissionNo').lean();
  const out = new Map(rows.map((r) => [String(r._id), { name: studentLabel(r), admissionNo: r.admissionNo, className: null }]));
  const enrolments = await Enrollment.find({ studentId: { $in: unique }, status: 'ACTIVE' })
    .populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } }).lean();
  for (const e of enrolments) {
    const row = out.get(String(e.studentId));
    if (row) row.className = classLabel(e.sectionId);
  }
  return out;
}

const audit = (actor, studentId, via, fields, count) => recordPiiRead({ actor, action: 'health.read', entityType: 'HealthRecord', entityId: studentId ?? null, via, fields, count });

async function nurseProfileId() {
  const [nurse] = await profilesWithRoles(['NURSE']);
  return nurse?._id ?? null;
}

// ── settings ─────────────────────────────────────────────────────────────

export async function getSettings() {
  const s = await HealthSettings.findOne({ key: 'default' }).lean();
  return { notifyOn: s?.notifyOn ?? ['SENT_HOME', 'REFERRED', 'INJURY', 'MEDICINE_GIVEN'], expiryLeadDays: s?.expiryLeadDays ?? 30, triggers: NOTIFY_TRIGGERS };
}

export async function updateSettings(actor, body = {}) {
  assertNurse(actor);
  const update = {};
  if (Array.isArray(body.notifyOn)) update.notifyOn = [...new Set(body.notifyOn.map((t) => oneOf(t, NOTIFY_TRIGGERS, 'notifyOn')))];
  if (body.expiryLeadDays !== undefined) {
    const n = Number.parseInt(body.expiryLeadDays, 10);
    if (!Number.isInteger(n) || n < 0 || n > 180) throw new AppError('expiryLeadDays must be 0 to 180', 400);
    update.expiryLeadDays = n;
  }
  update.updatedBy = { profileId: actor.profileId, name: actor.displayName ?? null, at: new Date() };
  await HealthSettings.findOneAndUpdate({ key: 'default' }, { $set: update }, { upsert: true });
  await recordAudit({ actor, action: 'health.settings.update', entityType: 'HealthSettings', entityId: 'default', after: { notifyOn: update.notifyOn, expiryLeadDays: update.expiryLeadDays } });
  return getSettings();
}

// ── visits ───────────────────────────────────────────────────────────────

function cleanVitals(v) {
  if (!v || typeof v !== 'object') return null;
  const num = (x, lo, hi, label) => {
    if (x === undefined || x === null || x === '') return null;
    const n = Number(x);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new AppError(`${label} must be between ${lo} and ${hi}`, 400);
    return n;
  };
  const out = {
    temperatureC: num(v.temperatureC, 30, 45, 'Temperature (°C)'),
    pulse: num(v.pulse, 20, 250, 'Pulse'),
    bpSystolic: num(v.bpSystolic, 50, 250, 'Systolic BP'),
    bpDiastolic: num(v.bpDiastolic, 30, 150, 'Diastolic BP'),
    spo2: num(v.spo2, 50, 100, 'SpO2'),
  };
  return Object.values(out).some((x) => x !== null) ? out : null;
}

function visitView(v, names) {
  const who = names?.get(String(v.studentId));
  return {
    id: String(v._id), refNo: v.refNo, studentId: String(v.studentId), studentName: who?.name ?? null, className: who?.className ?? null,
    arrivedAt: v.arrivedAt, leftAt: v.leftAt, outcome: v.outcome, outcomeLabel: OUTCOME_LABEL[v.outcome],
    injury: Boolean(v.injury), medicineGiven: Boolean(v.medicineGiven),
    complaint: dec(v.complaintEnc), vitals: dec(v.vitalsEnc), action: dec(v.actionEnc),
    attendedBy: v.attendedBy?.name ?? null,
    parentNotified: v.parentNotified?.at ? { at: v.parentNotified.at, reasons: v.parentNotified.reasons } : null,
  };
}

/** Why this visit tells the parents (the school's chosen outcomes), or [] for no message. */
async function notifyReasons(visit, force) {
  const { notifyOn } = await getSettings();
  const reasons = [];
  if (notifyOn.includes(visit.outcome)) reasons.push(visit.outcome);
  if (visit.injury && notifyOn.includes('INJURY')) reasons.push('INJURY');
  if (visit.medicineGiven && notifyOn.includes('MEDICINE_GIVEN')) reasons.push('MEDICINE_GIVEN');
  if (!reasons.length && force) reasons.push('NURSE_CHOSE');
  return reasons;
}

async function tellGuardians(studentId, { templateKey, key, entityType, entityId, requestedBy }) {
  const guardians = (await StudentGuardian.find({ studentId }).select('guardianProfileId').lean()).map((g) => String(g.guardianProfileId));
  if (!guardians.length) return 0;
  // The message says only that there is an update; the page (behind sign-in) holds the detail.
  await sendOperational({ templateKey, recipientProfileIds: guardians, link: '/health', idempotencyKey: key, relatedEntityType: entityType, relatedEntityId: entityId, requestedBy });
  return guardians.length;
}

export async function recordVisit(actor, body = {}, { channel = 'WEB' } = {}) {
  assertNurse(actor);
  const student = await loadStudent(body.studentId);
  const arrivedAt = parseDate(body.arrivedAt, 'arrivedAt') ?? new Date();
  const leftAt = parseDate(body.leftAt, 'leftAt');
  if (leftAt && leftAt < arrivedAt) throw new AppError('The time out is before the time in.', 400);
  const visit = new HealthVisit({
    refNo: await nextRef('HV', arrivedAt),
    studentId: student._id, arrivedAt, leftAt,
    outcome: oneOf(body.outcome, VISIT_OUTCOMES, 'outcome'),
    injury: Boolean(body.injury), medicineGiven: Boolean(body.medicineGiven),
    complaintEnc: encrypt(requireText(body.complaint, 'complaint', { max: 500 })),
    vitalsEnc: encrypt(cleanVitals(body.vitals)),
    actionEnc: encrypt(optionalText(body.action, { max: 1000 }) || null),
    attendedBy: { profileId: actor.profileId, name: actor.displayName ?? null, at: new Date() },
  });
  pushHistory(visit, actor, 'RECORDED', { to: visit.outcome, note: channel === 'WEB' ? null : `via ${channel}` });
  await visit.save();
  const reasons = await notifyReasons(visit, Boolean(body.notifyParent));
  if (reasons.length) {
    const recipients = await tellGuardians(student._id, { templateKey: 'HEALTH_ROOM_UPDATE', key: `health:visit:${visit._id}`, entityType: 'HealthVisit', entityId: visit._id, requestedBy: actor.profileId });
    visit.parentNotified = { at: new Date(), reasons, recipients };
    await visit.save();
  }
  await recordAudit({ actor, action: 'health.visit.recorded', entityType: 'HealthRecord', entityId: String(student._id), after: { visit: visit.refNo, outcome: visit.outcome, notified: reasons.length > 0, channel } });
  return visitView(visit.toObject(), await studentNames([student._id]));
}

export async function updateVisit(actor, id, body = {}) {
  assertNurse(actor);
  const visit = await HealthVisit.findById(assertObjectId(id));
  if (!visit) throw new AppError('Visit not found', 404);
  const before = visit.outcome;
  if (body.leftAt !== undefined) {
    const leftAt = parseDate(body.leftAt, 'leftAt') ?? new Date();
    if (leftAt < visit.arrivedAt) throw new AppError('The time out is before the time in.', 400);
    visit.leftAt = leftAt;
  }
  if (body.outcome !== undefined) visit.outcome = oneOf(body.outcome, VISIT_OUTCOMES, 'outcome');
  if (body.action !== undefined) visit.actionEnc = encrypt(optionalText(body.action, { max: 1000 }) || null);
  if (body.injury !== undefined) visit.injury = Boolean(body.injury);
  if (body.medicineGiven !== undefined) visit.medicineGiven = Boolean(body.medicineGiven);
  pushHistory(visit, actor, 'UPDATED', { from: before, to: visit.outcome });
  await visit.save();
  if (!visit.parentNotified?.at) {
    const reasons = await notifyReasons(visit, Boolean(body.notifyParent));
    if (reasons.length) {
      const recipients = await tellGuardians(visit.studentId, { templateKey: 'HEALTH_ROOM_UPDATE', key: `health:visit:${visit._id}`, entityType: 'HealthVisit', entityId: visit._id, requestedBy: actor.profileId });
      visit.parentNotified = { at: new Date(), reasons, recipients };
      await visit.save();
    }
  }
  await recordAudit({ actor, action: 'health.visit.updated', entityType: 'HealthRecord', entityId: String(visit.studentId), after: { visit: visit.refNo, outcome: visit.outcome } });
  return visitView(visit.toObject(), await studentNames([visit.studentId]));
}

export async function listVisits(actor, query = {}, { via = 'health.visits' } = {}) {
  const allowed = await readableStudents(actor);
  const filter = {};
  if (query.studentId) {
    await assertCanRead(actor, query.studentId, via);
    filter.studentId = assertObjectId(query.studentId, 'studentId');
  } else if (allowed !== null) {
    filter.studentId = { $in: allowed };
  }
  const from = parseDate(query.from, 'from');
  const to = parseDate(query.to, 'to');
  if (from || to) filter.arrivedAt = { ...(from && { $gte: from }), ...(to && { $lte: new Date(to.getTime() + DAY - 1) }) };
  if (query.outcome) filter.outcome = oneOf(query.outcome, VISIT_OUTCOMES, 'outcome');
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 100, 1), 500);
  const rows = await HealthVisit.find(filter).sort({ arrivedAt: -1 }).limit(limit).lean();
  const names = await studentNames(rows.map((r) => r.studentId));
  await audit(actor, query.studentId ?? null, via, ['complaint', 'vitals', 'action'], rows.length);
  return { items: rows.map((r) => visitView(r, names)), total: rows.length };
}

/** The nurse's day: today's visits, the doses due today, and stock that needs attention. */
export async function today(actor, { now = new Date() } = {}) {
  assertNurse(actor);
  const start = new Date(istDay(now).getTime() - 330 * 60_000);
  const visits = await listVisits(actor, { from: start.toISOString() }, { via: 'health.today' });
  const due = await dosesDue(actor, { date: istYmd(now) }, { now, audited: false });
  const stock = await stockAlerts(now);
  return { date: istYmd(now), visits: visits.items, doses: due.items, stock };
}

// ── medication plans ─────────────────────────────────────────────────────

function cleanTimes(times) {
  const list = Array.isArray(times) ? times : String(times ?? '').split(/[,\s]+/);
  const out = [...new Set(list.map((t) => String(t).trim()).filter(Boolean))];
  if (!out.length) throw new AppError('Give at least one time (HH:MM) for the dose.', 400);
  for (const t of out) if (!HM_RE.test(t)) throw new AppError(`"${t}" is not a time as HH:MM.`, 400);
  return out.sort().slice(0, 6);
}

function planView(p, names) {
  const who = names?.get(String(p.studentId));
  const prescription = dec(p.prescriptionEnc);
  return {
    id: String(p._id), refNo: p.refNo, studentId: String(p.studentId), studentName: who?.name ?? null, className: who?.className ?? null,
    medicine: dec(p.medicineEnc, {}), dose: dec(p.doseEnc), instructions: dec(p.instructionsEnc),
    prescription: prescription ? { name: prescription.name, url: prescription.url } : null,
    times: p.times, startOn: istYmd(p.startOn), endOn: istYmd(p.endOn), controlled: Boolean(p.controlled), status: p.status,
    consent: p.consent?.at ? { byName: p.consent.byName, at: p.consent.at } : null,
    createdBy: p.createdBy?.name ?? null, stoppedReason: p.stoppedReason ?? null,
  };
}

/**
 * A medication plan. A parent creates one for their own child with the
 * prescription and their consent (it is active at once); the nurse may draft
 * one, which waits for a parent's consent before any dose is given.
 */
export async function createPlan(actor, body = {}) {
  const family = actor.roleKey === 'PARENT';
  if (!family) assertNurse(actor);
  requireProfile(actor);
  const student = await loadStudent(body.studentId);
  if (family) await assertCanRead(actor, student._id, 'health.plans.create');
  const startOn = istDay(parseDate(body.startOn, 'startOn', { required: true }));
  const endOn = istDay(parseDate(body.endOn, 'endOn', { required: true }));
  if (endOn < startOn) throw new AppError('The plan ends before it starts.', 400);
  if (endOn.getTime() - startOn.getTime() > 366 * DAY) throw new AppError('A plan runs for at most a year; renew it after that.', 400);
  const [prescription] = cleanAttachments(body.prescription ? [body.prescription] : [], actor);
  if (family && !prescription) throw new AppError('Upload the prescription (or the doctor\'s note) with the plan.', 400, [], 'PRESCRIPTION_REQUIRED');
  if (family && body.consent !== true) throw new AppError('Tick the consent for the school to give this medicine.', 400, [], 'CONSENT_REQUIRED');
  const name = requireText(body.medicine?.name ?? body.medicineName, 'medicine name', { max: 120 });
  const plan = new MedicationPlan({
    refNo: await nextRef('MED'),
    studentId: student._id,
    medicineEnc: encrypt({ name, form: optionalText(body.medicine?.form, { max: 40 }) || null, strength: optionalText(body.medicine?.strength, { max: 60 }) || null }),
    doseEnc: encrypt(requireText(body.dose, 'dose', { max: 120 })),
    instructionsEnc: encrypt(optionalText(body.instructions, { max: 500 }) || null),
    prescriptionEnc: encrypt(prescription ? { name: prescription.name, url: prescription.url } : null),
    times: cleanTimes(body.times), startOn, endOn, controlled: Boolean(body.controlled),
    status: family ? 'ACTIVE' : 'AWAITING_CONSENT',
    createdBy: { profileId: actor.profileId, name: actor.displayName ?? null, at: new Date() },
    ...(family && { consent: { byProfileId: actor.profileId, byName: actor.displayName ?? null, at: new Date(), statement: 'I consent to the school giving this medicine as prescribed.' } }),
  });
  pushHistory(plan, actor, family ? 'CREATED_WITH_CONSENT' : 'DRAFTED', { to: plan.status });
  await plan.save();
  if (!family) {
    await tellGuardians(student._id, { templateKey: 'HEALTH_CONSENT_REQUEST', key: `health:plan:${plan._id}:consent`, entityType: 'MedicationPlan', entityId: plan._id, requestedBy: actor.profileId });
  }
  await recordAudit({ actor, action: 'health.plan.created', entityType: 'HealthRecord', entityId: String(student._id), after: { plan: plan.refNo, status: plan.status, controlled: plan.controlled, byRole: actor.roleKey } });
  return planView(plan.toObject(), await studentNames([student._id]));
}

/** A parent consents to a plan the nurse drafted (optionally adding the prescription). */
export async function consentPlan(actor, id, body = {}) {
  if (actor.roleKey !== 'PARENT') throw new AppError('A parent gives consent for their own child.', 403, [], 'PARENT_ONLY');
  const plan = await MedicationPlan.findById(assertObjectId(id));
  if (!plan) throw new AppError('Plan not found', 404);
  await assertCanRead(actor, plan.studentId, 'health.plans.consent');
  if (plan.status !== 'AWAITING_CONSENT') throw new AppError(`This plan is ${plan.status.toLowerCase().replace(/_/g, ' ')}.`, 409, [], 'INVALID_TRANSITION');
  if (body.consent !== true) throw new AppError('Tick the consent to go ahead, or stop the plan instead.', 400, [], 'CONSENT_REQUIRED');
  const [prescription] = cleanAttachments(body.prescription ? [body.prescription] : [], actor);
  if (prescription) plan.prescriptionEnc = encrypt({ name: prescription.name, url: prescription.url });
  if (!dec(plan.prescriptionEnc)) throw new AppError('Upload the prescription (or the doctor\'s note) with your consent.', 400, [], 'PRESCRIPTION_REQUIRED');
  plan.status = 'ACTIVE';
  plan.consent = { byProfileId: actor.profileId, byName: actor.displayName ?? null, at: new Date(), statement: 'I consent to the school giving this medicine as prescribed.' };
  pushHistory(plan, actor, 'CONSENTED', { from: 'AWAITING_CONSENT', to: 'ACTIVE' });
  await plan.save();
  await recordAudit({ actor, action: 'health.plan.consented', entityType: 'HealthRecord', entityId: String(plan.studentId), after: { plan: plan.refNo } });
  return planView(plan.toObject(), await studentNames([plan.studentId]));
}

/** The nurse or the child's parent stops a plan; nothing is deleted. */
export async function stopPlan(actor, id, body = {}) {
  const plan = await MedicationPlan.findById(assertObjectId(id));
  if (!plan) throw new AppError('Plan not found', 404);
  if (actor.roleKey === 'PARENT') await assertCanRead(actor, plan.studentId, 'health.plans.stop');
  else assertNurse(actor);
  if (!['AWAITING_CONSENT', 'ACTIVE'].includes(plan.status)) throw new AppError('This plan has already ended.', 409, [], 'INVALID_TRANSITION');
  const from = plan.status;
  plan.status = 'STOPPED';
  plan.stoppedReason = requireText(body.reason, 'reason', { max: 300 });
  pushHistory(plan, actor, 'STOPPED', { from, to: 'STOPPED', note: plan.stoppedReason });
  await plan.save();
  await recordAudit({ actor, action: 'health.plan.stopped', entityType: 'HealthRecord', entityId: String(plan.studentId), after: { plan: plan.refNo, byRole: actor.roleKey } });
  return planView(plan.toObject(), await studentNames([plan.studentId]));
}

export async function listPlans(actor, query = {}) {
  const allowed = await readableStudents(actor);
  const filter = {};
  if (query.studentId) {
    await assertCanRead(actor, query.studentId, 'health.plans');
    filter.studentId = assertObjectId(query.studentId, 'studentId');
  } else if (allowed !== null) filter.studentId = { $in: allowed };
  if (query.status) filter.status = String(query.status).toUpperCase();
  const rows = await MedicationPlan.find(filter).sort({ createdAt: -1 }).limit(300).lean();
  const names = await studentNames(rows.map((r) => r.studentId));
  await audit(actor, query.studentId ?? null, 'health.plans', ['medicine', 'dose', 'prescription'], rows.length);
  return { items: rows.map((r) => planView(r, names)), total: rows.length };
}

// ── medication administration record ─────────────────────────────────────

function doseView(d, names, plan) {
  const who = names?.get(String(d.studentId));
  return {
    id: String(d._id), planId: String(d.planId), studentId: String(d.studentId), studentName: who?.name ?? null,
    medicine: plan ? dec(plan.medicineEnc, {})?.name ?? null : null,
    scheduledFor: d.scheduledFor, date: istYmd(d.scheduledFor), slot: d.slot, status: d.status, at: d.at,
    by: d.by?.name ?? null, note: dec(d.noteEnc), controlled: Boolean(d.controlled),
    countersign: d.countersign?.required ? { required: true, by: d.countersign.name ?? null, at: d.countersign.at ?? null } : null,
  };
}

/** Every scheduled dose for a day across the active plans, with what has been recorded against each. */
export async function dosesDue(actor, query = {}, { now = new Date(), audited = true } = {}) {
  assertNurse(actor);
  const date = query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : istYmd(now);
  const dayKey = new Date(`${date}T00:00:00Z`);
  const plans = await MedicationPlan.find({ status: 'ACTIVE', startOn: { $lte: dayKey }, endOn: { $gte: dayKey } }).lean();
  const doses = await MedicationDose.find({ planId: { $in: plans.map((p) => p._id) }, scheduledFor: { $gte: istInstant(date, '00:00'), $lte: istInstant(date, '23:59') } }).lean();
  const byKey = new Map(doses.map((d) => [`${d.planId}:${d.slot}`, d]));
  const names = await studentNames(plans.map((p) => p.studentId));
  const items = [];
  for (const p of plans) {
    for (const slot of p.times) {
      const d = byKey.get(`${p._id}:${slot}`);
      const at = istInstant(date, slot);
      items.push({
        planId: String(p._id), planRef: p.refNo, studentId: String(p.studentId), studentName: names.get(String(p.studentId))?.name ?? null,
        className: names.get(String(p.studentId))?.className ?? null,
        medicine: dec(p.medicineEnc, {})?.name ?? null, dose: dec(p.doseEnc), controlled: Boolean(p.controlled), slot, date,
        status: d ? d.status : (at < now ? 'OVERDUE' : 'DUE'),
        doseId: d ? String(d._id) : null, by: d?.by?.name ?? null, at: d?.at ?? null,
        awaitingCountersign: Boolean(d?.countersign?.required && !d?.countersign?.at),
      });
    }
  }
  items.sort((a, b) => a.slot.localeCompare(b.slot) || String(a.studentName).localeCompare(String(b.studentName)));
  if (audited) await audit(actor, null, 'health.doses.due', ['medicine', 'dose'], items.length);
  return { date, items };
}

/**
 * Records one scheduled dose as given, missed or refused. A controlled medicine
 * is marked for a second person's countersignature; until then it shows as
 * "awaiting countersign" on the nurse's list and in the principal's counts.
 */
export async function recordDose(actor, body = {}, { channel = 'WEB', now = new Date() } = {}) {
  assertNurse(actor);
  const plan = await MedicationPlan.findById(assertObjectId(body.planId, 'planId'));
  if (!plan) throw new AppError('Plan not found', 404);
  if (plan.status !== 'ACTIVE') throw new AppError(plan.status === 'AWAITING_CONSENT' ? 'This plan is waiting for the parent\'s consent; no dose can be given yet.' : 'This plan is not active.', 409, [], plan.status === 'AWAITING_CONSENT' ? 'CONSENT_REQUIRED' : 'PLAN_NOT_ACTIVE');
  const slot = String(body.slot ?? '').trim();
  if (!plan.times.includes(slot)) throw new AppError(`This plan has no dose at ${slot || '(no time given)'}; its times are ${plan.times.join(', ')}.`, 400, [], 'NOT_A_SCHEDULED_TIME');
  const date = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : istYmd(now);
  const dayKey = new Date(`${date}T00:00:00Z`);
  if (dayKey < plan.startOn || dayKey > plan.endOn) throw new AppError('That day is outside the plan\'s dates.', 400, [], 'OUTSIDE_PLAN');
  const scheduledFor = istInstant(date, slot);
  if (scheduledFor.getTime() > now.getTime() + 60 * 60_000) throw new AppError('A dose cannot be recorded more than an hour before it is due.', 400, [], 'TOO_EARLY');
  const status = oneOf(body.status, DOSE_STATUSES, 'status');
  try {
    const dose = await MedicationDose.create({
      planId: plan._id, studentId: plan.studentId, scheduledFor, slot, status, at: now,
      by: { profileId: actor.profileId, name: actor.displayName ?? null, at: now },
      noteEnc: encrypt(optionalText(body.note, { max: 500 }) || null),
      controlled: plan.controlled,
      countersign: { required: plan.controlled && status === 'GIVEN' },
      channel,
    });
    await recordAudit({ actor, action: 'health.dose.recorded', entityType: 'HealthRecord', entityId: String(plan.studentId), after: { plan: plan.refNo, slot, date, status, controlled: plan.controlled, channel } });
    return doseView(dose.toObject(), await studentNames([plan.studentId]), plan);
  } catch (err) {
    if (err?.code === 11000) throw new AppError(`The ${slot} dose on ${date} is already recorded.`, 409, [], 'DOSE_ALREADY_RECORDED');
    throw err;
  }
}

/** The second person checks a controlled-medicine dose: never the person who gave it. */
export async function countersignDose(actor, id) {
  requireProfile(actor);
  if (!actor.permissions?.['health.witness'] && !isNurse(actor)) throw new AppError('Countersigning needs health.witness.', 403, [], 'HEALTH_RESTRICTED');
  const dose = await MedicationDose.findById(assertObjectId(id));
  if (!dose) throw new AppError('Dose not found', 404);
  if (!dose.countersign?.required) throw new AppError('This dose does not need a countersignature.', 409, [], 'NOT_REQUIRED');
  if (dose.countersign.at) throw new AppError('This dose is already countersigned.', 409, [], 'ALREADY_COUNTERSIGNED');
  if (String(dose.by?.profileId) === String(actor.profileId)) {
    throw new AppError('A second person countersigns a controlled medicine: not the person who gave it.', 409, [], 'SECOND_PERSON_REQUIRED');
  }
  dose.countersign = { required: true, profileId: actor.profileId, name: actor.displayName ?? null, at: new Date() };
  await dose.save();
  await recordAudit({ actor, action: 'health.dose.countersigned', entityType: 'HealthRecord', entityId: String(dose.studentId), after: { dose: String(dose._id) } });
  const plan = await MedicationPlan.findById(dose.planId).lean();
  return doseView(dose.toObject(), await studentNames([dose.studentId]), plan);
}

/** The medication log for one child (the nurse, or that child's parent). */
export async function medicationLog(actor, studentId, query = {}) {
  await assertCanRead(actor, studentId, 'health.medication.log');
  const filter = { studentId: assertObjectId(studentId, 'studentId') };
  const from = parseDate(query.from, 'from');
  if (from) filter.at = { $gte: from };
  const rows = await MedicationDose.find(filter).sort({ scheduledFor: -1 }).limit(Math.min(Number.parseInt(query.limit, 10) || 100, 500)).lean();
  const plans = new Map((await MedicationPlan.find({ _id: { $in: rows.map((r) => r.planId) } }).lean()).map((p) => [String(p._id), p]));
  const names = await studentNames([studentId]);
  await audit(actor, studentId, 'health.medication.log', ['medicine', 'dose'], rows.length);
  return { studentId: String(studentId), studentName: names.get(String(studentId))?.name ?? null, items: rows.map((r) => doseView(r, names, plans.get(String(r.planId)))) };
}

// ── stock ────────────────────────────────────────────────────────────────

const stockKey = (s) => `health:stock:${s._id}:expiry`;

function stockView(s, now = new Date()) {
  const days = s.expiresOn ? Math.floor((istDay(s.expiresOn) - istDay(now)) / DAY) : null;
  return {
    id: String(s._id), name: s.name, kind: s.kind, batchNo: s.batchNo, quantity: s.quantity, unit: s.unit, reorderLevel: s.reorderLevel,
    expiresOn: s.expiresOn ? istYmd(s.expiresOn) : null, daysToExpiry: days, expired: days !== null && days < 0,
    expiringSoon: days !== null && days >= 0 && days <= 30, low: s.quantity <= s.reorderLevel, location: s.location, controlled: Boolean(s.controlled), active: s.active,
  };
}

/** Keeps the expiry reminder in Tasks in step with the stock row. */
async function syncExpiryTask(s) {
  try {
    if (!s.active || !s.expiresOn || s.quantity <= 0) { await resolveSource(stockKey(s), { note: 'Stock item used up, removed or without an expiry date' }); return; }
    const { expiryLeadDays } = await getSettings();
    await upsertFromSource({
      sourceKey: stockKey(s), title: `Health room stock expires: ${s.name}${s.batchNo ? ` (batch ${s.batchNo})` : ''}`,
      department: 'HEALTH', category: 'LAB_EXPIRY', dueAt: s.expiresOn, ownerProfileId: await nurseProfileId(),
      leadDays: [expiryLeadDays, 7, 1, 0], severity: s.controlled ? 'HIGH' : 'NORMAL',
      source: { entityType: 'HealthStock', entityId: String(s._id), link: '/health?tab=stock' },
      description: 'Replace or dispose of the item before it expires, then update the stock record.',
    });
  } catch (err) {
    logger.error(`Health stock reminder could not be updated: ${err.message}`);
  }
}

export async function listStock(actor, { now = new Date() } = {}) {
  assertNurse(actor);
  const rows = await HealthStock.find({ active: true }).sort({ expiresOn: 1, name: 1 }).lean();
  return { items: rows.map((r) => stockView(r, now)) };
}

async function stockAlerts(now = new Date()) {
  const rows = await HealthStock.find({ active: true }).lean();
  const views = rows.map((r) => stockView(r, now));
  return { expired: views.filter((v) => v.expired).length, expiringSoon: views.filter((v) => v.expiringSoon).length, low: views.filter((v) => v.low).length };
}

function stockFields(body, partial = false) {
  const out = {};
  if (!partial || body.name !== undefined) out.name = requireText(body.name, 'name', { max: 120 });
  if (body.kind !== undefined || !partial) out.kind = oneOf(body.kind, STOCK_KINDS, 'kind', 'FIRST_AID');
  if (body.batchNo !== undefined) out.batchNo = optionalText(body.batchNo, { max: 60 }) || null;
  for (const k of ['quantity', 'reorderLevel']) {
    if (body[k] === undefined) continue;
    const n = Number(body[k]);
    if (!Number.isFinite(n) || n < 0) throw new AppError(`${k} must be zero or more`, 400);
    out[k] = n;
  }
  if (body.unit !== undefined) out.unit = optionalText(body.unit, { max: 30 }) || 'units';
  if (body.expiresOn !== undefined) out.expiresOn = body.expiresOn ? istDay(parseDate(body.expiresOn, 'expiresOn')) : null;
  if (body.location !== undefined) out.location = optionalText(body.location, { max: 80 }) || 'Health room';
  if (body.controlled !== undefined) out.controlled = Boolean(body.controlled);
  return out;
}

export async function addStock(actor, body = {}) {
  assertNurse(actor);
  const s = new HealthStock(stockFields(body));
  pushHistory(s, actor, 'ADDED', { note: `${s.quantity} ${s.unit}` });
  await s.save();
  await syncExpiryTask(s);
  return stockView(s.toObject());
}

export async function updateStock(actor, id, body = {}) {
  assertNurse(actor);
  const s = await HealthStock.findById(assertObjectId(id));
  if (!s) throw new AppError('Stock item not found', 404);
  Object.assign(s, stockFields(body, true));
  if (body.active === false) s.active = false;
  pushHistory(s, actor, body.active === false ? 'REMOVED' : 'UPDATED', { note: optionalText(body.note, { max: 300 }) || `${s.quantity} ${s.unit}` });
  await s.save();
  await syncExpiryTask(s);
  return stockView(s.toObject());
}

// ── care notes (consent-gated, for the class teacher) ────────────────────

function careNoteView(n, names) {
  const who = names?.get(String(n.studentId));
  return {
    id: String(n._id), studentId: String(n.studentId), studentName: who?.name ?? null, className: who?.className ?? null,
    text: dec(n.textEnc), severity: n.severity, shared: Boolean(n.shareConsent?.granted),
    consent: n.shareConsent?.at ? { granted: Boolean(n.shareConsent.granted), byName: n.shareConsent.byName, at: n.shareConsent.at } : null,
    active: n.active, createdBy: n.createdBy?.name ?? null,
  };
}

/** The nurse drafts a care note (shared only once a parent agrees); a parent writes one and chooses to share it. */
export async function createCareNote(actor, body = {}) {
  const family = actor.roleKey === 'PARENT';
  if (!family) assertNurse(actor);
  requireProfile(actor);
  const student = await loadStudent(body.studentId);
  if (family) await assertCanRead(actor, student._id, 'health.carenotes.create');
  const share = family && body.share === true;
  const note = new CareNote({
    studentId: student._id,
    textEnc: encrypt(requireText(body.text, 'text', { max: 160 })),
    severity: oneOf(body.severity, ['INFO', 'IMPORTANT', 'SEVERE'], 'severity', 'IMPORTANT'),
    shareConsent: share ? { granted: true, byProfileId: actor.profileId, byName: actor.displayName ?? null, at: new Date() } : { granted: false },
    createdBy: { profileId: actor.profileId, name: actor.displayName ?? null, at: new Date() },
  });
  pushHistory(note, actor, 'CREATED', { note: share ? 'Shared with the class teacher' : 'Not shared' });
  await note.save();
  if (!family) await tellGuardians(student._id, { templateKey: 'HEALTH_CONSENT_REQUEST', key: `health:carenote:${note._id}:consent`, entityType: 'CareNote', entityId: note._id, requestedBy: actor.profileId });
  await recordAudit({ actor, action: 'health.carenote.created', entityType: 'HealthRecord', entityId: String(student._id), after: { shared: share, byRole: actor.roleKey } });
  return careNoteView(note.toObject(), await studentNames([student._id]));
}

/** A parent shares a care note with the class teacher, or withdraws that consent (hidden at once). */
export async function setCareNoteConsent(actor, id, body = {}) {
  if (actor.roleKey !== 'PARENT') throw new AppError('Only the child\'s parent decides whether a care note is shared.', 403, [], 'PARENT_ONLY');
  const note = await CareNote.findById(assertObjectId(id));
  if (!note) throw new AppError('Care note not found', 404);
  await assertCanRead(actor, note.studentId, 'health.carenotes.consent');
  const granted = body.share === true;
  note.shareConsent = { granted, byProfileId: actor.profileId, byName: actor.displayName ?? null, at: new Date() };
  pushHistory(note, actor, granted ? 'SHARE_CONSENTED' : 'SHARE_WITHDRAWN');
  await note.save();
  await recordAudit({ actor, action: granted ? 'health.carenote.shared' : 'health.carenote.unshared', entityType: 'HealthRecord', entityId: String(note.studentId), after: { note: String(note._id) } });
  return careNoteView(note.toObject(), await studentNames([note.studentId]));
}

export async function retireCareNote(actor, id) {
  const note = await CareNote.findById(assertObjectId(id));
  if (!note) throw new AppError('Care note not found', 404);
  if (actor.roleKey === 'PARENT') await assertCanRead(actor, note.studentId, 'health.carenotes.retire');
  else assertNurse(actor);
  note.active = false;
  pushHistory(note, actor, 'RETIRED');
  await note.save();
  await recordAudit({ actor, action: 'health.carenote.retired', entityType: 'HealthRecord', entityId: String(note.studentId), after: { note: String(note._id) } });
  return careNoteView(note.toObject(), await studentNames([note.studentId]));
}

export async function listCareNotes(actor, query = {}) {
  const allowed = await readableStudents(actor);
  const filter = { active: true };
  if (query.studentId) {
    await assertCanRead(actor, query.studentId, 'health.carenotes');
    filter.studentId = assertObjectId(query.studentId, 'studentId');
  } else if (allowed !== null) filter.studentId = { $in: allowed };
  const rows = await CareNote.find(filter).sort({ createdAt: -1 }).limit(500).lean();
  const names = await studentNames(rows.map((r) => r.studentId));
  await audit(actor, query.studentId ?? null, 'health.carenotes', ['careNote'], rows.length);
  return { items: rows.map((r) => careNoteView(r, names)) };
}

/**
 * The class teacher's view: only the shared, active care notes for children in
 * a section they are CLASS teacher of (a subject teacher sees none), and only
 * the note itself: no visits, no medicine, no record.
 */
export async function classCareNotes(actor) {
  requireProfile(actor);
  if (!scopeOf(actor, 'health.carenotes.read')) throw new AppError('Care notes are not available to you.', 403, [], 'HEALTH_RESTRICTED');
  const sectionFilter = scopeOf(actor, 'health.carenotes.read') === 'ALL' ? {} : { classTeacherId: actor.profileId };
  const sections = await Section.find(sectionFilter).select('_id').lean();
  const enrolments = await Enrollment.find({ sectionId: { $in: sections.map((s) => s._id) }, status: 'ACTIVE' }).select('studentId').lean();
  const studentIds = enrolments.map((e) => e.studentId);
  const rows = await CareNote.find({ studentId: { $in: studentIds }, active: true, 'shareConsent.granted': true }).sort({ severity: -1 }).lean();
  const names = await studentNames(rows.map((r) => r.studentId));
  await recordPiiRead({ actor, action: 'health.carenotes.read', entityType: 'HealthRecord', entityId: null, via: 'health.class-care-notes', fields: ['careNote'], count: rows.length });
  const rank = { SEVERE: 0, IMPORTANT: 1, INFO: 2 };
  return {
    items: rows
      .map((r) => ({ id: String(r._id), studentId: String(r.studentId), studentName: names.get(String(r.studentId))?.name ?? null, className: names.get(String(r.studentId))?.className ?? null, text: dec(r.textEnc), severity: r.severity }))
      .sort((a, b) => rank[a.severity] - rank[b.severity] || String(a.studentName).localeCompare(String(b.studentName))),
  };
}

// ── immunisations and screenings ─────────────────────────────────────────

function academicYearOf(d) {
  const ymd = istYmd(d);
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

function cleanScreening(b = {}) {
  const num = (x, lo, hi, label) => {
    if (x === undefined || x === null || x === '') return null;
    const n = Number(x);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new AppError(`${label} must be between ${lo} and ${hi}`, 400);
    return n;
  };
  const heightCm = num(b.heightCm, 40, 230, 'Height (cm)');
  const weightKg = num(b.weightKg, 5, 200, 'Weight (kg)');
  const out = {
    heightCm, weightKg,
    bmi: heightCm && weightKg ? Math.round((weightKg / ((heightCm / 100) ** 2)) * 10) / 10 : null,
    visionLeft: optionalText(b.visionLeft, { max: 20 }) || null,
    visionRight: optionalText(b.visionRight, { max: 20 }) || null,
    dental: optionalText(b.dental, { max: 200 }) || null,
    hearing: optionalText(b.hearing, { max: 100 }) || null,
    remarks: optionalText(b.remarks, { max: 500 }) || null,
  };
  if (!Object.values(out).some((v) => v !== null)) throw new AppError('Record at least one screening result.', 400);
  return out;
}

export async function addEntry(actor, body = {}) {
  assertNurse(actor);
  const student = await loadStudent(body.studentId);
  const kind = oneOf(body.kind, ['IMMUNISATION', 'SCREENING'], 'kind');
  const on = parseDate(body.on, 'on') ?? new Date();
  const data = kind === 'IMMUNISATION'
    ? { vaccine: requireText(body.vaccine, 'vaccine', { max: 120 }), doseNo: optionalText(body.doseNo, { max: 20 }) || null, givenAt: optionalText(body.givenAt, { max: 120 }) || null, nextDueOn: body.nextDueOn ? istYmd(parseDate(body.nextDueOn, 'nextDueOn')) : null }
    : cleanScreening(body);
  const entry = await HealthEntry.create({
    studentId: student._id, kind, on, academicYear: academicYearOf(on), dataEnc: encrypt(data),
    recordedBy: { profileId: actor.profileId, name: actor.displayName ?? null, at: new Date() },
  });
  await recordAudit({ actor, action: `health.${kind.toLowerCase()}.recorded`, entityType: 'HealthRecord', entityId: String(student._id), after: { entry: String(entry._id) } });
  return { id: String(entry._id), studentId: String(student._id), kind, on: istYmd(on), academicYear: entry.academicYear, data };
}

export async function listEntries(actor, studentId, query = {}) {
  await assertCanRead(actor, studentId, 'health.entries');
  const filter = { studentId: assertObjectId(studentId, 'studentId') };
  if (query.kind) filter.kind = oneOf(query.kind, ['IMMUNISATION', 'SCREENING'], 'kind');
  const rows = await HealthEntry.find(filter).sort({ on: -1 }).limit(200).lean();
  await audit(actor, studentId, 'health.entries', ['immunisations', 'screenings'], rows.length);
  return { items: rows.map((r) => ({ id: String(r._id), kind: r.kind, on: istYmd(r.on), academicYear: r.academicYear, data: dec(r.dataEnc, {}), recordedBy: r.recordedBy?.name ?? null })) };
}

/** The annual health card (CBSE / state health-card style) for one child. */
export async function healthCard(actor, studentId, query = {}) {
  await assertCanRead(actor, studentId, 'health.card');
  const student = await loadStudent(studentId);
  const year = query.academicYear && /^\d{4}-\d{2}$/.test(query.academicYear) ? query.academicYear : academicYearOf(new Date());
  const [entries, record, e] = await Promise.all([
    HealthEntry.find({ studentId: student._id }).sort({ on: -1 }).lean(),
    MedicalRecord.findOne({ studentId: student._id, deletedAt: null }).lean(),
    activeEnrollment(student._id),
  ]);
  const screenings = entries.filter((x) => x.kind === 'SCREENING' && x.academicYear === year).map((x) => ({ on: istYmd(x.on), ...dec(x.dataEnc, {}) }));
  const immunisations = entries.filter((x) => x.kind === 'IMMUNISATION').map((x) => ({ on: istYmd(x.on), ...dec(x.dataEnc, {}) }));
  const allergies = record ? dec(record.allergiesEnc, []) : [];
  await audit(actor, studentId, 'health.card', ['bloodGroup', 'allergies', 'immunisations', 'screenings']);
  return {
    academicYear: year,
    student: { id: String(student._id), name: studentLabel(student), admissionNo: student.admissionNo, className: classLabel(e?.sectionId) },
    bloodGroup: record?.bloodGroup ?? null, allergies: Array.isArray(allergies) ? allergies : [],
    latestScreening: screenings[0] ?? null, screenings, immunisations,
    visitsThisYear: await HealthVisit.countDocuments({ studentId: student._id, arrivedAt: { $gte: new Date(`${year.slice(0, 4)}-04-01T00:00:00+05:30`) } }),
  };
}

// ── family view ──────────────────────────────────────────────────────────

/** A parent's page: for each of their children, visits, plans, the medication log, care notes and the card. */
export async function family(actor) {
  if (actor.roleKey !== 'PARENT') throw new AppError('This page is for parents.', 403, [], 'PARENT_ONLY');
  const ids = await ownChildren(actor);
  const names = await studentNames(ids);
  const children = [];
  for (const id of ids) {
    /* eslint-disable no-await-in-loop */
    const [visits, plans, log, notes] = await Promise.all([
      listVisits(actor, { studentId: id, limit: 30 }, { via: 'health.family' }),
      listPlans(actor, { studentId: id }),
      medicationLog(actor, id, { limit: 50 }),
      listCareNotes(actor, { studentId: id }),
    ]);
    /* eslint-enable no-await-in-loop */
    children.push({ studentId: id, name: names.get(id)?.name ?? null, className: names.get(id)?.className ?? null, visits: visits.items, plans: plans.items, medicationLog: log.items, careNotes: notes.items });
  }
  return { children };
}

// ── counts only ──────────────────────────────────────────────────────────

/**
 * The principal's (and administrator's) view: counts, never a name or a
 * clinical word. These are whole-school operational figures (visits by
 * outcome, plans, missed doses, stock), not per-child figures.
 */
export async function summary(actor, query = {}, { now = new Date() } = {}) {
  if (!scopeOf(actor, 'health.summary.read') && !isNurse(actor)) throw new AppError('Health figures are not available to you.', 403, [], 'HEALTH_RESTRICTED');
  const days = Math.min(Math.max(Number.parseInt(query.days, 10) || 30, 1), 366);
  const since = new Date(now.getTime() - days * DAY);
  const todayStart = new Date(istDay(now).getTime() - 330 * 60_000);
  const [byOutcome, today, injuries, plansActive, plansAwaiting, dosesMissed, awaitingCountersign, stock, careShared] = await Promise.all([
    HealthVisit.aggregate([{ $match: { arrivedAt: { $gte: since } } }, { $group: { _id: '$outcome', n: { $sum: 1 } } }]),
    HealthVisit.countDocuments({ arrivedAt: { $gte: todayStart } }),
    HealthVisit.countDocuments({ arrivedAt: { $gte: since }, injury: true }),
    MedicationPlan.countDocuments({ status: 'ACTIVE' }),
    MedicationPlan.countDocuments({ status: 'AWAITING_CONSENT' }),
    MedicationDose.countDocuments({ at: { $gte: since }, status: { $in: ['MISSED', 'REFUSED'] } }),
    MedicationDose.countDocuments({ 'countersign.required': true, 'countersign.at': null }),
    stockAlerts(now),
    CareNote.countDocuments({ active: true, 'shareConsent.granted': true }),
  ]);
  const outcomes = Object.fromEntries(VISIT_OUTCOMES.map((o) => [o, 0]));
  for (const r of byOutcome) outcomes[r._id] = r.n;
  return {
    periodDays: days,
    visits: { today, inPeriod: Object.values(outcomes).reduce((a, b) => a + b, 0), byOutcome: outcomes, injuries },
    medication: { activePlans: plansActive, awaitingConsent: plansAwaiting, missedOrRefusedInPeriod: dosesMissed, awaitingCountersign },
    stock, careNotesShared: careShared,
  };
}

// ── pickers ──────────────────────────────────────────────────────────────

/** Students by name or admission number, for the nurse's forms (names only). */
export async function findStudents(actor, query = {}) {
  assertNurse(actor);
  const q = String(query.q ?? '').trim();
  if (q.length < 2) return { items: [] };
  // Every word must match a first name, last name or admission number: "Rahul Sharma" finds Rahul Sharma.
  const terms = q.split(/\s+/).filter(Boolean).slice(0, 4).map((t) => new RegExp(escapeRegex(t), 'i'));
  const rows = await Student.find({ deletedAt: null, $and: terms.map((re) => ({ $or: [{ firstName: re }, { lastName: re }, { admissionNo: re }] })) })
    .select('firstName lastName admissionNo').limit(20).lean();
  const names = await studentNames(rows.map((r) => r._id));
  return { items: rows.map((r) => ({ id: String(r._id), name: studentLabel(r), admissionNo: r.admissionNo, className: names.get(String(r._id))?.className ?? null })) };
}

export const _test = { academicYearOf, cleanTimes, isFamily };
