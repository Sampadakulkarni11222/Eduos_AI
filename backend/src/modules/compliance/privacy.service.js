import mongoose from 'mongoose';
import { PrivacyRequest, DataBreach, StatutoryCommittee, PRIVACY_KINDS, PRIVACY_STATUSES, BREACH_STATUSES, COMMITTEE_KINDS } from '../../models/supportRoles.model.js';
import { Licence } from '../../models/compliance.model.js';
import { Student } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { nextRef, pushHistory } from '../ops/common.js';
import { upsertFromSource, resolveSource } from '../tasks/tasks.service.js';
import { licenceStatus, trainingCoverage } from './compliance.service.js';

/**
 * Data protection and statutory committees, part 4: what the compliance
 * officer had to keep in spreadsheets.
 *
 *   data requests   DPDP Act 2023 rights of the data principal (s.11-14): access,
 *                   correction, erasure, consent withdrawal, grievance, nomination.
 *                   For a child the parent is the one who asks. Each request gets a
 *                   response date (the school's window, RESPONSE_DAYS) and a task.
 *   breaches        a personal-data breach register with the Board-report clock:
 *                   DPDP Rules 2025 r.7 asks for intimation without delay and a
 *                   detailed report within 72 hours of becoming aware. The register
 *                   records what a person did and when; nothing is sent from here.
 *   committees      POCSO, ICC (POSH), school safety, SMC (RTE s.21), grievance,
 *                   anti-bullying, disaster management: members, constitution and
 *                   review dates, and whether they are displayed as required.
 *   readiness       an evidence-backed checklist (CBSE safety certificates, required
 *                   committees, open requests, breaches past the clock, training
 *                   coverage). It points at records; it does not certify anything.
 *
 * Rules are from the Act and the Rules as notified (14 Nov 2025) with phased
 * commencement; the school should confirm the dates that apply to it.
 */

export const RESPONSE_DAYS = 30;
export const BREACH_REPORT_HOURS = 72;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const actorRef = (a) => ({ profileId: a?.profileId ?? null, name: a?.displayName ?? null });
const oid = (v, label) => {
  if (!v || !mongoose.isValidObjectId(String(v))) throw new AppError(`Invalid ${label}`, 400, [], 'INVALID_ID');
  return String(v);
};
const text = (v, max) => (v === undefined || v === null || v === '' ? null : String(v).trim().slice(0, max));
const when = (v, label) => {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new AppError(`${label} is not a valid date`, 400, [], 'BAD_DATE');
  return d;
};
const KIND_WORDS = { ACCESS: 'access to data', CORRECTION: 'correction', ERASURE: 'erasure', CONSENT_WITHDRAWAL: 'consent withdrawal', GRIEVANCE: 'grievance', NOMINATION: 'nomination' };

/* ── Data principal requests ──────────────────────────────── */

function requestDto(r, now = new Date()) {
  const open = !['COMPLETED', 'DECLINED'].includes(r.status);
  return {
    id: String(r._id), refNo: r.refNo, kind: r.kind, kindLabel: KIND_WORDS[r.kind] ?? r.kind, requesterName: r.requesterName, requesterRelation: r.requesterRelation,
    contact: r.contact, studentId: r.studentId ? String(r.studentId._id ?? r.studentId) : null,
    studentName: r.studentId?.firstName ? `${r.studentId.firstName} ${r.studentId.lastName ?? ''}`.trim() : null,
    details: r.details, receivedAt: r.receivedAt, dueAt: r.dueAt, status: r.status, identityVerified: r.identityVerified, outcome: r.outcome, closedAt: r.closedAt,
    overdue: open && new Date(r.dueAt) < now, daysLeft: open ? Math.ceil((new Date(r.dueAt) - now) / DAY) : null, history: r.history ?? [],
  };
}

export async function createRequest(actor, body = {}) {
  if (!PRIVACY_KINDS.includes(body.kind)) throw new AppError(`kind must be one of ${PRIVACY_KINDS.join(', ')}`, 400);
  const requesterName = text(body.requesterName, 120);
  if (!requesterName) throw new AppError('requesterName is required', 400);
  let studentId = null;
  if (body.studentId) {
    const s = await Student.findOne({ _id: oid(body.studentId, 'student id'), deletedAt: null }).select('_id').lean();
    if (!s) throw new AppError('No student with that id in this school', 404, [], 'STUDENT_NOT_FOUND');
    studentId = s._id;
  }
  const receivedAt = when(body.receivedAt, 'receivedAt') ?? new Date();
  const days = Math.min(Math.max(Number(body.responseDays) || RESPONSE_DAYS, 1), 90);
  const r = new PrivacyRequest({
    refNo: await nextRef('DPR'), kind: body.kind, requesterName, requesterRelation: ['SELF', 'PARENT', 'GUARDIAN', 'NOMINEE'].includes(body.requesterRelation) ? body.requesterRelation : (studentId ? 'PARENT' : 'SELF'),
    contact: text(body.contact, 120), studentId, details: text(body.details, 2000), receivedAt, dueAt: new Date(receivedAt.getTime() + days * DAY),
    ownerProfileId: actor?.profileId ?? null, createdBy: actorRef(actor),
  });
  pushHistory(r, actor, 'RECEIVED');
  await r.save();
  await upsertFromSource({
    sourceKey: `privacy-request:${r._id}`, title: `Respond to data ${KIND_WORDS[r.kind]} request ${r.refNo}`, department: 'COMPLIANCE', severity: r.kind === 'GRIEVANCE' ? 'HIGH' : 'NORMAL',
    dueAt: r.dueAt, ownerProfileId: actor?.profileId ?? null, source: { entityType: 'PrivacyRequest', entityId: r._id, link: '/compliance/data-protection' },
  }).catch(() => {});
  await recordAudit({ actor, action: 'privacy.request.create', entityType: 'PrivacyRequest', entityId: r._id, after: { refNo: r.refNo, kind: r.kind } });
  return requestDto(r.toObject());
}

export async function listRequests({ status = 'OPEN' } = {}) {
  const filter = status === 'OPEN' ? { status: { $in: ['RECEIVED', 'IN_PROGRESS'] } } : (status && status !== 'ALL' ? { status } : {});
  const rows = await PrivacyRequest.find(filter).sort({ dueAt: 1 }).limit(500).populate('studentId', 'firstName lastName').lean();
  return rows.map((r) => requestDto(r));
}

export async function getRequest(id) {
  const r = await PrivacyRequest.findById(oid(id, 'request id')).populate('studentId', 'firstName lastName').lean();
  if (!r) throw new AppError('Request not found', 404);
  return requestDto(r);
}

const REQUEST_FLOW = { RECEIVED: ['IN_PROGRESS', 'COMPLETED', 'DECLINED'], IN_PROGRESS: ['COMPLETED', 'DECLINED'] };

/** Moves a request on. Closing it needs the outcome in words (what was given, corrected or erased, or why not). */
export async function updateRequest(actor, id, { status, identityVerified, outcome, note } = {}) {
  const r = await PrivacyRequest.findById(oid(id, 'request id'));
  if (!r) throw new AppError('Request not found', 404);
  if (identityVerified !== undefined) { r.identityVerified = identityVerified === true; pushHistory(r, actor, identityVerified ? 'IDENTITY_VERIFIED' : 'IDENTITY_UNVERIFIED'); }
  if (status !== undefined && status !== r.status) {
    if (!PRIVACY_STATUSES.includes(status)) throw new AppError(`status must be one of ${PRIVACY_STATUSES.join(', ')}`, 400);
    if (!(REQUEST_FLOW[r.status] ?? []).includes(status)) throw new AppError(`A request cannot move from ${r.status} to ${status}.`, 409, [], 'INVALID_TRANSITION');
    if (['COMPLETED', 'DECLINED'].includes(status)) {
      if (!text(outcome, 2000)) throw new AppError('Write the outcome before closing the request (what was done, or why it was declined).', 400, [], 'OUTCOME_REQUIRED');
      if (status === 'COMPLETED' && !r.identityVerified && identityVerified !== true) throw new AppError("Verify the requester's identity before completing the request.", 409, [], 'IDENTITY_NOT_VERIFIED');
      r.outcome = text(outcome, 2000);
      r.closedAt = new Date();
    }
    pushHistory(r, actor, 'STATUS', { from: r.status, to: status, note: text(note, 300) });
    r.status = status;
  } else if (note) pushHistory(r, actor, 'NOTE', { note: text(note, 300) });
  await r.save();
  if (['COMPLETED', 'DECLINED'].includes(r.status)) await resolveSource(`privacy-request:${r._id}`, { note: `Request ${r.status.toLowerCase()}` }).catch(() => {});
  await recordAudit({ actor, action: 'privacy.request.update', entityType: 'PrivacyRequest', entityId: r._id, after: { status: r.status, identityVerified: r.identityVerified } });
  return requestDto((await PrivacyRequest.findById(r._id).populate('studentId', 'firstName lastName').lean()));
}

/* ── Breaches ─────────────────────────────────────────────── */

function breachDto(b, now = new Date()) {
  const deadline = new Date(new Date(b.discoveredAt).getTime() + BREACH_REPORT_HOURS * HOUR);
  return {
    id: String(b._id), refNo: b.refNo, title: b.title, discoveredAt: b.discoveredAt, description: b.description, dataCategories: b.dataCategories ?? [],
    affectedCount: b.affectedCount, childrenAffected: b.childrenAffected, containment: b.containment, status: b.status,
    boardIntimatedAt: b.boardIntimatedAt, boardReportAt: b.boardReportAt, principalsInformedAt: b.principalsInformedAt,
    reportDeadline: deadline, hoursLeft: b.boardReportAt ? null : Math.round((deadline - now) / HOUR),
    reportOverdue: !b.boardReportAt && now > deadline, history: b.history ?? [],
  };
}

export async function createBreach(actor, body = {}) {
  const title = text(body.title, 200);
  if (!title) throw new AppError('title is required', 400);
  const discoveredAt = when(body.discoveredAt, 'discoveredAt') ?? new Date();
  if (discoveredAt > new Date(Date.now() + 5 * 60_000)) throw new AppError('discoveredAt cannot be in the future', 400);
  const b = new DataBreach({
    refNo: await nextRef('DBR'), title, discoveredAt, description: text(body.description, 4000),
    dataCategories: (Array.isArray(body.dataCategories) ? body.dataCategories : []).map((x) => String(x).slice(0, 60)).slice(0, 20),
    affectedCount: Math.max(0, Math.round(Number(body.affectedCount) || 0)), childrenAffected: body.childrenAffected === true,
    containment: text(body.containment, 2000), createdBy: actorRef(actor),
  });
  pushHistory(b, actor, 'LOGGED');
  await b.save();
  await upsertFromSource({
    sourceKey: `data-breach:${b._id}`, title: `Data breach ${b.refNo}: detailed report to the Data Protection Board within ${BREACH_REPORT_HOURS} hours`, department: 'COMPLIANCE', severity: 'CRITICAL',
    dueAt: new Date(discoveredAt.getTime() + BREACH_REPORT_HOURS * HOUR), ownerProfileId: actor?.profileId ?? null,
    source: { entityType: 'DataBreach', entityId: b._id, link: '/compliance/data-protection?tab=breaches' },
  }).catch(() => {});
  await recordAudit({ actor, action: 'privacy.breach.create', entityType: 'DataBreach', entityId: b._id, after: { refNo: b.refNo, affectedCount: b.affectedCount, childrenAffected: b.childrenAffected } });
  return breachDto(b.toObject());
}

export async function listBreaches({ status } = {}) {
  const rows = await DataBreach.find(status && status !== 'ALL' ? { status } : {}).sort({ discoveredAt: -1 }).limit(200).lean();
  return rows.map((b) => breachDto(b));
}

/** Records what a person did (containment, intimation, report, people told) and moves the status. */
export async function updateBreach(actor, id, body = {}) {
  const b = await DataBreach.findById(oid(id, 'breach id'));
  if (!b) throw new AppError('Breach not found', 404);
  for (const f of ['boardIntimatedAt', 'boardReportAt', 'principalsInformedAt']) {
    if (body[f] !== undefined) { const d = when(body[f], f); if (d && d < b.discoveredAt) throw new AppError(`${f} cannot be before the breach was discovered`, 400); b[f] = d; pushHistory(b, actor, f.toUpperCase()); }
  }
  if (body.containment !== undefined) b.containment = text(body.containment, 2000);
  if (body.affectedCount !== undefined) b.affectedCount = Math.max(0, Math.round(Number(body.affectedCount) || 0));
  if (body.status !== undefined && body.status !== b.status) {
    if (!BREACH_STATUSES.includes(body.status)) throw new AppError(`status must be one of ${BREACH_STATUSES.join(', ')}`, 400);
    if (body.status === 'CLOSED' && !b.boardReportAt) throw new AppError('Record when the detailed report went to the Board before closing.', 409, [], 'REPORT_NOT_RECORDED');
    pushHistory(b, actor, 'STATUS', { from: b.status, to: body.status });
    b.status = body.status;
    if (body.status === 'CLOSED') b.closedAt = new Date();
  }
  await b.save();
  if (b.boardReportAt) await resolveSource(`data-breach:${b._id}`, { note: 'Report to the Board recorded' }).catch(() => {});
  await recordAudit({ actor, action: 'privacy.breach.update', entityType: 'DataBreach', entityId: b._id, after: { status: b.status, boardReportAt: b.boardReportAt } });
  return breachDto(b.toObject());
}

/* ── Statutory committees ─────────────────────────────────── */

export const REQUIRED_COMMITTEES = [
  { kind: 'POCSO', label: 'POCSO / child protection committee', basis: 'CBSE circular on safety of children (2017); POCSO Act 2012' },
  { kind: 'ICC_POSH', label: 'Internal Committee (POSH)', basis: 'POSH Act 2013, s.4' },
  { kind: 'SCHOOL_SAFETY', label: 'School safety committee', basis: 'CBSE safety circulars; NCPCR safety manual' },
  { kind: 'SMC', label: 'School Management Committee', basis: 'RTE Act 2009, s.21 (aided and government schools; good practice for others)' },
  { kind: 'GRIEVANCE', label: 'Grievance redressal committee', basis: 'CBSE Affiliation Bye-Laws; DPDP grievance officer' },
];

function committeeDto(c, now = new Date()) {
  return {
    id: String(c._id), kind: c.kind, name: c.name, members: c.members ?? [], constitutedOn: c.constitutedOn, reviewDueOn: c.reviewDueOn, lastMeetingOn: c.lastMeetingOn,
    displayedOnWebsite: c.displayedOnWebsite, displayedOnNoticeBoard: c.displayedOnNoticeBoard, notes: c.notes,
    reviewOverdue: c.reviewDueOn ? new Date(c.reviewDueOn) < now : false, updatedBy: c.updatedBy?.name ?? null,
  };
}

function committeeFields(body, partial = false) {
  const out = {};
  if (!partial || body.kind !== undefined) { if (!COMMITTEE_KINDS.includes(body.kind)) throw new AppError(`kind must be one of ${COMMITTEE_KINDS.join(', ')}`, 400); out.kind = body.kind; }
  if (!partial || body.name !== undefined) { out.name = text(body.name, 120) ?? REQUIRED_COMMITTEES.find((r) => r.kind === body.kind)?.label; if (!out.name) throw new AppError('name is required', 400); }
  if (body.members !== undefined) out.members = (Array.isArray(body.members) ? body.members : []).slice(0, 30).map((m) => ({ name: text(m?.name, 80), role: text(m?.role, 80), phone: text(m?.phone, 20), external: m?.external === true })).filter((m) => m.name);
  for (const f of ['constitutedOn', 'reviewDueOn', 'lastMeetingOn']) if (body[f] !== undefined) out[f] = when(body[f], f);
  for (const f of ['displayedOnWebsite', 'displayedOnNoticeBoard']) if (body[f] !== undefined) out[f] = body[f] === true;
  if (body.notes !== undefined) out.notes = text(body.notes, 1000);
  return out;
}

export async function saveCommittee(actor, body = {}, id = null) {
  let c;
  if (id) {
    c = await StatutoryCommittee.findById(oid(id, 'committee id'));
    if (!c) throw new AppError('Committee not found', 404);
    Object.assign(c, committeeFields(body, true), { updatedBy: actorRef(actor) });
  } else {
    c = new StatutoryCommittee({ ...committeeFields(body), updatedBy: actorRef(actor) });
    if (!c.reviewDueOn && c.constitutedOn) c.reviewDueOn = new Date(new Date(c.constitutedOn).getTime() + 365 * DAY);
  }
  await c.save();
  if (c.reviewDueOn) {
    await upsertFromSource({ sourceKey: `committee-review:${c._id}`, title: `Review / re-constitute: ${c.name}`, department: 'COMPLIANCE', category: 'OTHER', dueAt: c.reviewDueOn, leadDays: [30, 7], ownerProfileId: actor?.profileId ?? null, source: { entityType: 'StatutoryCommittee', entityId: c._id, link: '/compliance/data-protection?tab=committees' } }).catch(() => {});
  }
  await recordAudit({ actor, action: id ? 'compliance.committee.update' : 'compliance.committee.create', entityType: 'StatutoryCommittee', entityId: c._id, after: { kind: c.kind, members: c.members.length } });
  return committeeDto(c.toObject());
}

export async function listCommittees() {
  const rows = await StatutoryCommittee.find({}).sort({ kind: 1, name: 1 }).lean();
  return rows.map((c) => committeeDto(c));
}

/* ── Readiness check ──────────────────────────────────────── */

const CERTS = [
  { key: 'FIRE', label: 'Fire safety certificate', match: /fire/i },
  { key: 'BUILDING', label: 'Building safety certificate', match: /building|structur/i },
  { key: 'WATER', label: 'Safe drinking water certificate', match: /water/i },
  { key: 'HEALTH', label: 'Health and sanitation certificate', match: /sanitation|hygiene|health/i },
  { key: 'AFFILIATION', label: 'Board affiliation (current extension)', match: /affiliation/i },
];

/**
 * Each item says what was checked, what was found and where to act. "OK" means
 * a record exists and is in date, not that the school is compliant: the
 * officer judges that.
 */
export async function readiness({ now = new Date() } = {}) {
  const [licences, committees, openRequests, breaches, coverage] = await Promise.all([
    Licence.find({}).select('title kind expiresOn renewalLeadDays').lean(),
    StatutoryCommittee.find({}).lean(),
    PrivacyRequest.find({ status: { $in: ['RECEIVED', 'IN_PROGRESS'] } }).select('refNo dueAt kind').lean(),
    DataBreach.find({ status: { $ne: 'CLOSED' } }).lean(),
    trainingCoverage().catch(() => []),
  ]);
  const items = [];
  for (const c of CERTS) {
    const found = licences.filter((l) => c.match.test(l.title ?? ''));
    const best = found.map((l) => ({ l, s: licenceStatus(l, now) })).sort((a, b) => (a.s === 'VALID' ? -1 : 1) - (b.s === 'VALID' ? -1 : 1))[0];
    items.push({
      area: 'Certificates', item: c.label,
      state: !best ? 'MISSING' : best.s === 'EXPIRED' ? 'ACTION' : best.s === 'EXPIRING' ? 'SOON' : 'OK',
      evidence: best ? `${best.l.title}${best.l.expiresOn ? `, expires ${new Date(best.l.expiresOn).toISOString().slice(0, 10)}` : ''}` : 'No licence or certificate with this name is on file',
      where: '/compliance/compliance?tab=licences',
    });
  }
  for (const req of REQUIRED_COMMITTEES) {
    const c = committees.find((x) => x.kind === req.kind);
    const problems = [];
    if (c && !(c.members ?? []).length) problems.push('no members listed');
    if (c && c.reviewDueOn && new Date(c.reviewDueOn) < now) problems.push('review overdue');
    if (c && !c.displayedOnWebsite && ['POCSO', 'ICC_POSH', 'GRIEVANCE'].includes(req.kind)) problems.push('not marked as displayed on the website');
    items.push({ area: 'Committees', item: req.label, state: !c ? 'MISSING' : problems.length ? 'ACTION' : 'OK', evidence: c ? `${c.members?.length ?? 0} member(s)${problems.length ? `; ${problems.join(', ')}` : ''}` : `Not recorded (${req.basis})`, where: '/compliance/data-protection?tab=committees' });
  }
  const overdueReq = openRequests.filter((r) => new Date(r.dueAt) < now);
  items.push({ area: 'Data protection', item: 'Data principal requests answered in time', state: overdueReq.length ? 'ACTION' : 'OK', evidence: `${openRequests.length} open, ${overdueReq.length} past the response date${overdueReq.length ? ` (${overdueReq.map((r) => r.refNo).join(', ')})` : ''}`, where: '/compliance/data-protection' });
  const lateBreaches = breaches.filter((b) => !b.boardReportAt && now - new Date(b.discoveredAt) > BREACH_REPORT_HOURS * HOUR);
  items.push({ area: 'Data protection', item: `Breaches reported to the Board within ${BREACH_REPORT_HOURS} hours`, state: lateBreaches.length ? 'ACTION' : breaches.length ? 'SOON' : 'OK', evidence: breaches.length ? `${breaches.length} open breach(es); ${lateBreaches.length} past the clock without a report recorded` : 'No open breach', where: '/compliance/data-protection?tab=breaches' });
  for (const t of coverage) {
    items.push({ area: 'Training', item: `${t.topic} training coverage`, state: t.pct === null ? 'MISSING' : t.pct >= 90 ? 'OK' : t.pct >= 60 ? 'SOON' : 'ACTION', evidence: `${t.covered} of ${t.staff} staff in the last ${t.windowMonths} months (${t.pct ?? 0}%)`, where: '/compliance/trainings' });
  }
  const tally = items.reduce((m, i) => ({ ...m, [i.state]: (m[i.state] ?? 0) + 1 }), {});
  return { checkedAt: now, tally, items, note: 'Each line points at a record. OK means a record exists and is in date; the compliance officer decides whether the school is compliant.' };
}

export async function overview({ now = new Date() } = {}) {
  const [requests, breaches, committees, ready] = await Promise.all([listRequests({ status: 'OPEN' }), listBreaches({}), listCommittees(), readiness({ now })]);
  return {
    openRequests: requests.length, overdueRequests: requests.filter((r) => r.overdue).length,
    openBreaches: breaches.filter((b) => b.status !== 'CLOSED').length, breachesPastClock: breaches.filter((b) => b.reportOverdue && b.status !== 'CLOSED').length,
    committees: committees.length, committeesReviewOverdue: committees.filter((c) => c.reviewOverdue).length,
    readiness: ready.tally,
  };
}
