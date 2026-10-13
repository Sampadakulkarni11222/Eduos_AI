import { VerificationCase, CHECK_TYPES } from '../../models/verification.model.js';
import { AppError } from '../../utils/AppError.js';
import { notify } from '../notifications/notification.service.js';
import {
  nextRef, requireProfile, assertObjectId, pushHistory, cleanAttachments, parseDate, requireText, optionalText,
  oneOf, dto, profilesWithRoles, startOfDayUtc,
} from '../ops/common.js';

/**
 * Background verification workflow:
 *   INITIATED (consent) → IN_PROGRESS (checks) → HR_REVIEW (recommendation)
 *   → AWAITING_DECISION → CLEARED / CLEARED_WITH_CONDITIONS / NOT_CLEARED (principal)
 *   → EXPIRED when a time-limited check lapses (police verification, licence).
 *
 * The system records what authorised verifiers found. It has no access to
 * criminal databases and never treats an automated search as a clearance.
 */

/** Checks required by default for each kind of person; the school can add or waive (with reason). */
export const DEFAULT_CHECKS = {
  TEACHER: ['IDENTITY', 'ADDRESS', 'EDUCATION', 'EMPLOYMENT', 'REFERENCE', 'POLICE', 'CHILD_SAFETY_DECLARATION'],
  STAFF: ['IDENTITY', 'ADDRESS', 'EMPLOYMENT', 'REFERENCE', 'POLICE', 'CHILD_SAFETY_DECLARATION'],
  DRIVER: ['IDENTITY', 'ADDRESS', 'POLICE', 'DRIVING_LICENCE', 'MEDICAL_FITNESS', 'REFERENCE', 'CHILD_SAFETY_DECLARATION'],
  ATTENDANT: ['IDENTITY', 'ADDRESS', 'POLICE', 'REFERENCE', 'CHILD_SAFETY_DECLARATION'],
  SECURITY: ['IDENTITY', 'ADDRESS', 'POLICE', 'REFERENCE'],
  VENDOR: ['IDENTITY', 'ADDRESS', 'REFERENCE'],
  VOLUNTEER: ['IDENTITY', 'POLICE', 'CHILD_SAFETY_DECLARATION'],
  CONTRACTOR: ['IDENTITY', 'POLICE'],
};
const CLEARED = ['CLEARED', 'CLEARED_WITH_CONDITIONS'];

/** Status-only projection for anyone without verification.manage. */
export function statusOnly(c) {
  return {
    id: String(c._id), refNo: c.refNo, subjectType: c.subjectType, subjectName: c.subjectName,
    subjectProfileId: c.subjectProfileId ? String(c.subjectProfileId) : null,
    positionTitle: c.positionTitle, status: c.status, recheckDueOn: c.recheckDueOn,
    decidedAt: c.decision?.at ?? null, conditions: c.decision?.conditions ?? null,
  };
}

function full(c) {
  const out = dto(c);
  out.checksDone = (c.checks ?? []).filter((x) => ['CLEAR', 'ADVERSE', 'UNABLE_TO_VERIFY'].includes(x.status)).length;
  out.checksRequired = (c.checks ?? []).filter((x) => x.required).length;
  out.adverse = (c.checks ?? []).filter((x) => x.status === 'ADVERSE').length;
  return out;
}

const view = (c, actor) => (actor.permissions?.['verification.manage'] || actor.permissions?.['verification.decide'] ? full(c) : statusOnly(c));

async function load(id) {
  const c = await VerificationCase.findById(assertObjectId(id));
  if (!c) throw new AppError('Verification case not found', 404);
  return c;
}

function setStatus(c, actor, to, note) {
  pushHistory(c, actor, to, { from: c.status, to, note });
  c.status = to;
}

export async function initiate(actor, body = {}) {
  requireProfile(actor);
  const subjectType = oneOf(body.subjectType, Object.keys(DEFAULT_CHECKS), 'subjectType');
  const c = new VerificationCase({
    refNo: await nextRef('BGV'),
    subjectType,
    subjectProfileId: body.subjectProfileId ? assertObjectId(body.subjectProfileId, 'subjectProfileId') : null,
    subjectName: requireText(body.subjectName, 'subjectName', { max: 160 }),
    positionTitle: optionalText(body.positionTitle, { max: 120 }) || null,
    linkedEntity: optionalText(body.linkedEntity, { max: 120 }) || null,
    checks: (Array.isArray(body.checks) && body.checks.length ? body.checks.map((t) => oneOf(t, CHECK_TYPES, 'check type')) : DEFAULT_CHECKS[subjectType]).map((type) => ({ type, required: true })),
  });
  if (body.consent?.obtained) {
    c.consent = { obtained: true, at: parseDate(body.consent.at, 'consent.at') ?? new Date(), evidenceUrl: optionalText(body.consent.evidenceUrl, { max: 1000 }) || null };
  }
  if (subjectType === 'DRIVER' && body.driver) {
    c.driver = {
      licenceNo: optionalText(body.driver.licenceNo, { max: 40 }) || null,
      licenceClass: optionalText(body.driver.licenceClass, { max: 40 }) || null,
      licenceValidTo: parseDate(body.driver.licenceValidTo, 'licenceValidTo'),
      heavyVehicleExperienceYears: body.driver.heavyVehicleExperienceYears === undefined ? null : Number(body.driver.heavyVehicleExperienceYears),
    };
  }
  pushHistory(c, actor, 'INITIATED', { to: 'INITIATED' });
  await c.save();
  return full(c.toObject());
}

/** Record a check's outcome. Checks cannot start before consent is on file. */
export async function recordCheck(actor, id, checkId, body = {}) {
  const c = await load(id);
  if (CLEARED.includes(c.status) || c.status === 'NOT_CLEARED') throw new AppError('This case is decided; open a re-check instead.', 409);
  if (!c.consent?.obtained) throw new AppError('Record the subject\'s consent before running checks.', 409, [], 'CONSENT_REQUIRED');
  const check = c.checks.id(checkId);
  if (!check) throw new AppError('Check not found', 404);
  check.status = oneOf(body.status, ['NOT_STARTED', 'IN_PROGRESS', 'CLEAR', 'ADVERSE', 'UNABLE_TO_VERIFY'], 'status');
  check.provider = optionalText(body.provider, { max: 160 }) || check.provider;
  check.reference = optionalText(body.reference, { max: 120 }) || check.reference;
  check.note = optionalText(body.note, { max: 2000 }) ?? check.note;
  check.expiresOn = body.expiresOn !== undefined ? parseDate(body.expiresOn, 'expiresOn') : check.expiresOn;
  if (Array.isArray(body.evidence)) check.evidence.push(...cleanAttachments(body.evidence, actor));
  if (['CLEAR', 'ADVERSE', 'UNABLE_TO_VERIFY'].includes(check.status)) {
    if (!check.evidence.length && !check.reference) throw new AppError('A completed check needs evidence or a reference number.', 400, [], 'EVIDENCE_REQUIRED');
    check.completedAt = new Date();
    check.verifiedByProfileId = actor.profileId;
  }
  if (body.waive === true) {
    check.required = false;
    check.note = requireText(body.note, 'note (why this check is waived)', { max: 2000 });
  }
  if (c.status === 'INITIATED') setStatus(c, actor, 'IN_PROGRESS');
  pushHistory(c, actor, `CHECK_${check.type}_${check.status}`);
  await c.save();
  return full(c.toObject());
}

export async function recordConsent(actor, id, body = {}) {
  const c = await load(id);
  c.consent = { obtained: true, at: parseDate(body.at, 'at') ?? new Date(), evidenceUrl: requireText(body.evidenceUrl, 'evidenceUrl (signed consent form)', { max: 1000 }) };
  pushHistory(c, actor, 'CONSENT_RECORDED');
  await c.save();
  return full(c.toObject());
}

/** HR's recommendation, once every required check is complete. */
export async function hrReview(actor, id, body = {}) {
  const c = await load(id);
  const open = c.checks.filter((x) => x.required && !['CLEAR', 'ADVERSE', 'UNABLE_TO_VERIFY'].includes(x.status));
  if (open.length) throw new AppError(`${open.length} required check(s) are not complete: ${open.map((x) => x.type).join(', ')}.`, 409, [], 'CHECKS_INCOMPLETE');
  c.hrReview = {
    byProfileId: actor.profileId, at: new Date(),
    recommendation: oneOf(body.recommendation, ['CLEAR', 'CLEAR_WITH_CONDITIONS', 'DO_NOT_CLEAR'], 'recommendation'),
    note: requireText(body.note, 'note', { max: 3000 }),
  };
  setStatus(c, actor, 'AWAITING_DECISION', `HR recommends ${c.hrReview.recommendation}`);
  await c.save();
  const principals = await profilesWithRoles(['PRINCIPAL']);
  await notify({ recipientProfileIds: principals.map((p) => String(p._id)), type: 'SYSTEM', title: `Clearance decision needed: ${c.subjectName}`, body: `${c.refNo} · ${c.subjectType}`, link: `/verification?id=${c._id}` });
  return full(c.toObject());
}

/** The principal's final decision. The person who recorded the HR review cannot also decide. */
export async function decide(actor, id, body = {}) {
  const c = await load(id);
  if (c.status !== 'AWAITING_DECISION') throw new AppError('This case is not awaiting a decision.', 409);
  if (String(c.hrReview?.byProfileId) === String(actor.profileId)) throw new AppError('The HR reviewer cannot also give the final decision.', 403, [], 'SAME_REVIEWER');
  const status = oneOf(body.decision, ['CLEARED', 'CLEARED_WITH_CONDITIONS', 'NOT_CLEARED'], 'decision');
  if (status !== 'NOT_CLEARED' && c.checks.some((x) => x.required && x.status === 'ADVERSE') && !optionalText(body.note)) {
    throw new AppError('A required check is adverse; record your reasoning to clear anyway.', 400, [], 'REASON_REQUIRED');
  }
  c.decision = {
    status, byProfileId: actor.profileId, byName: actor.displayName, at: new Date(),
    conditions: status === 'CLEARED_WITH_CONDITIONS' ? requireText(body.conditions, 'conditions', { max: 2000 }) : null,
    note: optionalText(body.note, { max: 3000 }) || null,
  };
  // The case is due for re-check when the earliest time-limited check lapses.
  const expiries = c.checks.map((x) => x.expiresOn).filter(Boolean);
  if (c.subjectType === 'DRIVER' && c.driver?.licenceValidTo) expiries.push(c.driver.licenceValidTo);
  c.recheckDueOn = expiries.length ? new Date(Math.min(...expiries.map((d) => new Date(d).getTime()))) : null;
  setStatus(c, actor, status, c.decision.note);
  await c.save();
  return full(c.toObject());
}

export async function raiseDispute(actor, id, body = {}) {
  const c = await load(id);
  if (c.status !== 'NOT_CLEARED' && c.status !== 'CLEARED_WITH_CONDITIONS') throw new AppError('Only a decided case can be disputed.', 409);
  c.dispute = { raisedAt: new Date(), note: requireText(body.note, 'note', { max: 3000 }), resolution: null, resolvedAt: null };
  pushHistory(c, actor, 'DISPUTE_RAISED', { note: c.dispute.note });
  await c.save();
  return full(c.toObject());
}

export async function resolveDispute(actor, id, body = {}) {
  const c = await load(id);
  if (!c.dispute?.raisedAt || c.dispute.resolvedAt) throw new AppError('There is no open dispute.', 409);
  c.dispute.resolution = requireText(body.resolution, 'resolution', { max: 3000 });
  c.dispute.resolvedAt = new Date();
  pushHistory(c, actor, 'DISPUTE_RESOLVED', { note: c.dispute.resolution });
  // Changing the outcome is a fresh decision, made through review again.
  if (body.reopen === true) setStatus(c, actor, 'HR_REVIEW', 'Reopened after dispute');
  c.markModified('dispute');
  await c.save();
  return full(c.toObject());
}

/** Marks decided cases whose time-limited checks have lapsed. */
export async function expireLapsed(now = new Date()) {
  const lapsed = await VerificationCase.find({ status: { $in: CLEARED }, recheckDueOn: { $ne: null, $lt: startOfDayUtc(now) } });
  for (const c of lapsed) {
    setStatus(c, { profileId: null, displayName: 'System' }, 'EXPIRED', 'A time-limited check lapsed');
    // eslint-disable-next-line no-await-in-loop
    await c.save();
  }
  return { expired: lapsed.length };
}

export async function list(actor, query = {}) {
  requireProfile(actor);
  await expireLapsed();
  const filter = {};
  if (query.status) filter.status = String(query.status).toUpperCase();
  if (query.subjectType) filter.subjectType = String(query.subjectType).toUpperCase();
  const rows = await VerificationCase.find(filter).sort({ updatedAt: -1 }).limit(500).lean();
  return rows.map((c) => view(c, actor));
}

export async function get(actor, id) {
  requireProfile(actor);
  // A single case read must not show CLEARED after a check has lapsed.
  await expireLapsed();
  return view((await load(id)).toObject(), actor);
}

/**
 * Whether a person may be deployed in a role that needs clearance (a driver on
 * a route, a staff member with children). Used by allocation flows; returns the
 * reason when not. An exception needs the principal and is recorded.
 */
export async function clearanceFor({ subjectProfileId, subjectName, subjectType } = {}, now = new Date()) {
  const filter = subjectProfileId ? { subjectProfileId } : { subjectName, ...(subjectType ? { subjectType } : {}) };
  const c = await VerificationCase.findOne(filter).sort({ updatedAt: -1 }).lean();
  if (!c) return { cleared: false, reason: 'No background verification on record.' };
  if (!CLEARED.includes(c.status)) return { cleared: false, reason: `Verification is ${c.status.toLowerCase().replace(/_/g, ' ')}.`, caseId: String(c._id) };
  if (c.recheckDueOn && new Date(c.recheckDueOn) < startOfDayUtc(now)) return { cleared: false, reason: 'A time-limited check has lapsed; re-verification is due.', caseId: String(c._id) };
  if (c.subjectType === 'DRIVER' && (!c.driver?.licenceValidTo || new Date(c.driver.licenceValidTo) < now)) return { cleared: false, reason: 'Driving licence is expired or not recorded.', caseId: String(c._id) };
  return { cleared: true, conditions: c.decision?.conditions ?? null, caseId: String(c._id) };
}

export async function stats() {
  await expireLapsed();
  const soon = new Date(Date.now() + 30 * 86_400_000);
  const [awaiting, inProgress, notCleared, expired, recheckSoon] = await Promise.all([
    VerificationCase.countDocuments({ status: 'AWAITING_DECISION' }),
    VerificationCase.countDocuments({ status: { $in: ['INITIATED', 'IN_PROGRESS', 'HR_REVIEW'] } }),
    VerificationCase.countDocuments({ status: 'NOT_CLEARED' }),
    VerificationCase.countDocuments({ status: 'EXPIRED' }),
    VerificationCase.countDocuments({ status: { $in: CLEARED }, recheckDueOn: { $ne: null, $lt: soon } }),
  ]);
  return { awaitingDecision: awaiting, inProgress, notCleared, expired, recheckWithin30Days: recheckSoon };
}
