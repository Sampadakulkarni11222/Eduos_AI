import { Vacancy, Candidate, ExitCase, VACANCY_STATUSES, CANDIDATE_STAGES, EXIT_KINDS, CLEARANCE_DEPARTMENTS } from '../../models/p4People.model.js';
import { EmployeeCompensation } from '../../models/finance.model.js';
import { VerificationCase } from '../../models/verification.model.js';
import { Profile } from '../../models/profile.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { upsertFromSource, resolveSource } from '../tasks/tasks.service.js';
import * as verification from '../administration/verification.service.js';
import * as payroll from '../finance-ops/payroll.service.js';
import { balanceFor } from '../staff/staffLeave.service.js';
import {
  nextRef, requireProfile, assertObjectId, pushHistory, parseDate, requireText, optionalText, oneOf, escapeRegex,
} from '../ops/common.js';
import { istYmd } from '../ptm/relations.js';

/**
 * HR's recruitment pipeline and staff exits (part 4, HR audit).
 *
 * Recruitment: a vacancy, its candidates moving APPLIED → SCREENED →
 * DEMO_LESSON → INTERVIEW → OFFERED → ACCEPTED → JOINED (or REJECTED /
 * WITHDRAWN), scorecards from each interviewer, an offer letter drafted from
 * the details on file (HR edits and signs; nothing is sent from here), and
 * background verification started from the candidate. A child-facing post
 * cannot be marked JOINED until the verification case is cleared.
 *
 * Exits: the notice period, clearance by each department, the exit interview
 * and the full-and-final estimate (gratuity under the Payment of Gratuity Act
 * 1972, earned-leave encashment, notice-period shortfall, clearance dues).
 * The estimate is a worksheet: HR can put it on a FULL_AND_FINAL payroll run,
 * which then goes through the normal calculate → submit → principal approval.
 * Nothing here pays anyone.
 */

const DAY = 86_400_000;
const STAGE_FLOW = {
  APPLIED: ['SCREENED', 'REJECTED', 'WITHDRAWN'],
  SCREENED: ['DEMO_LESSON', 'INTERVIEW', 'REJECTED', 'WITHDRAWN'],
  DEMO_LESSON: ['INTERVIEW', 'REJECTED', 'WITHDRAWN'],
  INTERVIEW: ['OFFERED', 'DEMO_LESSON', 'REJECTED', 'WITHDRAWN'],
  OFFERED: ['ACCEPTED', 'REJECTED', 'WITHDRAWN'],
  ACCEPTED: ['JOINED', 'WITHDRAWN'],
  JOINED: [], REJECTED: [], WITHDRAWN: [],
};
const RUBRIC = ['subjectKnowledge', 'pedagogy', 'communication', 'classroomManagement', 'childSafeguarding', 'valuesFit'];
const RUBRIC_LABEL = {
  subjectKnowledge: 'Subject knowledge', pedagogy: 'Teaching method', communication: 'Communication',
  classroomManagement: 'Classroom management', childSafeguarding: 'Child safeguarding awareness', valuesFit: 'Values and fit',
};
const inr = (p) => `₹${(Number(p ?? 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const money = (v, label) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new AppError(`${label} is whole paise`, 400);
  return n;
};

// ── vacancies ────────────────────────────────────────────────────────────

const vacancyView = (v, counts = {}) => ({
  id: String(v._id), refNo: v.refNo, title: v.title, department: v.department, subject: v.subject, employmentType: v.employmentType,
  positions: v.positions, childFacing: v.childFacing, qualifications: v.qualifications, salaryBand: v.salaryBand,
  closesOn: v.closesOn ? istYmd(v.closesOn) : null, status: v.status, createdBy: v.createdBy?.name ?? null, createdAt: v.createdAt,
  pipeline: counts, history: v.history ?? [],
});

export async function listVacancies(actor, query = {}) {
  requireProfile(actor);
  const filter = {};
  if (query.status) filter.status = oneOf(query.status, VACANCY_STATUSES, 'status');
  const rows = await Vacancy.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  const agg = await Candidate.aggregate([{ $match: { vacancyId: { $in: rows.map((r) => r._id) } } }, { $group: { _id: { v: '$vacancyId', s: '$stage' }, n: { $sum: 1 } } }]);
  const counts = new Map();
  for (const a of agg) { const k = String(a._id.v); counts.set(k, { ...(counts.get(k) ?? {}), [a._id.s]: a.n }); }
  return { items: rows.map((v) => vacancyView(v, counts.get(String(v._id)) ?? {})) };
}

export async function createVacancy(actor, body = {}) {
  requireProfile(actor);
  const v = new Vacancy({
    refNo: await nextRef('VAC'),
    title: requireText(body.title, 'title', { max: 120 }),
    department: optionalText(body.department, { max: 80 }) || null,
    subject: optionalText(body.subject, { max: 80 }) || null,
    employmentType: oneOf(body.employmentType, ['PERMANENT', 'PROBATION', 'CONTRACT', 'VISITING', 'PART_TIME'], 'employmentType', 'PERMANENT'),
    positions: Math.min(Math.max(Number.parseInt(body.positions, 10) || 1, 1), 50),
    childFacing: body.childFacing !== false,
    qualifications: optionalText(body.qualifications, { max: 500 }) || null,
    salaryBand: optionalText(body.salaryBand, { max: 80 }) || null,
    closesOn: parseDate(body.closesOn, 'closesOn'),
    createdBy: { profileId: actor.profileId, name: actor.displayName ?? null, at: new Date() },
  });
  pushHistory(v, actor, 'OPENED', { to: 'OPEN' });
  await v.save();
  await recordAudit({ actor, action: 'hr.vacancy.created', entityType: 'Vacancy', entityId: String(v._id), after: { refNo: v.refNo, title: v.title } });
  return vacancyView(v.toObject());
}

export async function setVacancyStatus(actor, id, body = {}) {
  requireProfile(actor);
  const v = await Vacancy.findById(assertObjectId(id));
  if (!v) throw new AppError('Vacancy not found', 404);
  const to = oneOf(body.status, VACANCY_STATUSES, 'status');
  const from = v.status;
  v.status = to;
  pushHistory(v, actor, 'STATUS', { from, to, note: optionalText(body.note, { max: 300 }) || null });
  await v.save();
  return vacancyView(v.toObject());
}

// ── candidates ───────────────────────────────────────────────────────────

function candidateView(c, { vacancy = null, verificationStatus = null } = {}) {
  const avg = c.scores?.length ? Math.round((c.scores.reduce((n, s) => n + (s.total ?? 0), 0) / c.scores.length) * 10) / 10 : null;
  return {
    id: String(c._id), refNo: c.refNo, vacancyId: String(c.vacancyId), vacancy: vacancy ? { refNo: vacancy.refNo, title: vacancy.title, childFacing: vacancy.childFacing } : null,
    name: c.name, email: c.email, phone: c.phone, source: c.source, experienceYears: c.experienceYears, qualifications: c.qualifications,
    currentCtcPaise: c.currentCtcPaise, expectedCtcPaise: c.expectedCtcPaise, noticeDays: c.noticeDays,
    stage: c.stage, nextStages: STAGE_FLOW[c.stage] ?? [], averageScore: avg,
    scores: (c.scores ?? []).map((s) => ({ id: String(s._id), by: s.by?.name ?? null, at: s.by?.at ?? null, stage: s.stage, ratings: s.ratings, total: s.total, recommendation: s.recommendation, note: s.note })),
    offer: c.offer?.ctcPaise || c.offer?.letterText ? { ctcPaise: c.offer.ctcPaise, joiningOn: c.offer.joiningOn ? istYmd(c.offer.joiningOn) : null, sentAt: c.offer.sentAt, letterText: c.offer.letterText } : null,
    verificationCaseId: c.verificationCaseId ? String(c.verificationCaseId) : null, verificationStatus,
    rejectionReason: c.rejectionReason, createdAt: c.createdAt, history: c.history ?? [],
  };
}

async function loadCandidate(id) {
  const c = await Candidate.findById(assertObjectId(id));
  if (!c) throw new AppError('Candidate not found', 404);
  return c;
}

export async function listCandidates(actor, query = {}) {
  requireProfile(actor);
  const filter = {};
  if (query.vacancyId) filter.vacancyId = assertObjectId(query.vacancyId, 'vacancyId');
  if (query.stage) filter.stage = oneOf(query.stage, CANDIDATE_STAGES, 'stage');
  if (query.q) filter.name = new RegExp(escapeRegex(String(query.q).slice(0, 60)), 'i');
  const rows = await Candidate.find(filter).sort({ updatedAt: -1 }).limit(500).lean();
  const vacancies = new Map((await Vacancy.find({ _id: { $in: rows.map((r) => r.vacancyId) } }).lean()).map((v) => [String(v._id), v]));
  const cases = new Map((await VerificationCase.find({ _id: { $in: rows.map((r) => r.verificationCaseId).filter(Boolean) } }).select('status').lean()).map((v) => [String(v._id), v.status]));
  return { items: rows.map((c) => candidateView(c, { vacancy: vacancies.get(String(c.vacancyId)), verificationStatus: cases.get(String(c.verificationCaseId)) ?? null })) };
}

export async function getCandidate(actor, id) {
  requireProfile(actor);
  const c = await loadCandidate(id);
  const v = await Vacancy.findById(c.vacancyId).lean();
  const vc = c.verificationCaseId ? await VerificationCase.findById(c.verificationCaseId).select('status').lean() : null;
  return candidateView(c.toObject(), { vacancy: v, verificationStatus: vc?.status ?? null });
}

export async function addCandidate(actor, body = {}) {
  requireProfile(actor);
  const v = await Vacancy.findById(assertObjectId(body.vacancyId, 'vacancyId')).lean();
  if (!v) throw new AppError('Vacancy not found', 404);
  if (v.status !== 'OPEN') throw new AppError(`${v.refNo} is ${v.status.toLowerCase().replace('_', ' ')}; reopen it to add candidates.`, 409);
  const email = optionalText(body.email, { max: 160 }) || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AppError('That email address does not look right.', 400);
  const phone = optionalText(body.phone, { max: 20 }) || null;
  if (email && await Candidate.exists({ vacancyId: v._id, email })) throw new AppError('This candidate has already applied for this vacancy.', 409, [], 'DUPLICATE_CANDIDATE');
  const c = new Candidate({
    refNo: await nextRef('CAN'), vacancyId: v._id,
    name: requireText(body.name, 'name', { max: 120 }), email, phone,
    source: optionalText(body.source, { max: 60 }) || null,
    experienceYears: body.experienceYears === undefined || body.experienceYears === null || body.experienceYears === '' ? null : Math.max(0, Math.min(Number(body.experienceYears) || 0, 50)),
    qualifications: optionalText(body.qualifications, { max: 500 }) || null,
    currentCtcPaise: money(body.currentCtcPaise, 'currentCtcPaise'), expectedCtcPaise: money(body.expectedCtcPaise, 'expectedCtcPaise'),
    noticeDays: body.noticeDays === undefined || body.noticeDays === null || body.noticeDays === '' ? null : Math.max(0, Math.min(Number.parseInt(body.noticeDays, 10) || 0, 365)),
  });
  pushHistory(c, actor, 'APPLIED', { to: 'APPLIED' });
  await c.save();
  await recordAudit({ actor, action: 'hr.candidate.added', entityType: 'Candidate', entityId: String(c._id), after: { refNo: c.refNo, vacancy: v.refNo } });
  return candidateView(c.toObject(), { vacancy: v });
}

export async function moveCandidate(actor, id, body = {}) {
  requireProfile(actor);
  const c = await loadCandidate(id);
  const to = oneOf(body.stage, CANDIDATE_STAGES, 'stage');
  if (!(STAGE_FLOW[c.stage] ?? []).includes(to)) throw new AppError(`A candidate at ${c.stage.toLowerCase()} cannot move to ${to.toLowerCase()}. Next: ${(STAGE_FLOW[c.stage] ?? []).map((s) => s.toLowerCase()).join(', ') || 'none'}.`, 409, [], 'INVALID_TRANSITION');
  const v = await Vacancy.findById(c.vacancyId).lean();
  const note = optionalText(body.note, { max: 500 }) || null;
  if (to === 'REJECTED' && !note) throw new AppError('Give a reason for not taking this candidate forward (it stays on file).', 400);
  if (to === 'OFFERED' && !(c.offer?.ctcPaise > 0)) throw new AppError('Draft the offer (CTC and joining date) before marking the candidate offered.', 400, [], 'OFFER_MISSING');
  if (to === 'JOINED' && v?.childFacing) {
    const vc = c.verificationCaseId ? await VerificationCase.findById(c.verificationCaseId).select('status refNo').lean() : null;
    if (!vc || !['CLEARED', 'CLEARED_WITH_CONDITIONS'].includes(vc.status)) {
      throw new AppError(`This is a child-facing post: background verification must be cleared before the candidate joins${vc ? ` (${vc.refNo} is ${vc.status.toLowerCase().replace(/_/g, ' ')})` : ' (none started yet)'}.`, 409, [], 'VERIFICATION_NOT_CLEARED');
    }
  }
  const from = c.stage;
  c.stage = to;
  if (to === 'REJECTED') c.rejectionReason = note;
  if (to === 'OFFERED' && !c.offer.sentAt) c.offer.sentAt = new Date();
  pushHistory(c, actor, 'STAGE', { from, to, note });
  await c.save();
  if (to === 'ACCEPTED' && c.offer?.joiningOn) {
    await upsertFromSource({
      sourceKey: `hr:joining:${c._id}`, title: `Joining: ${c.name} (${v?.title ?? 'new staff'}) — create account, pay structure and induction`,
      department: 'HR', category: 'OTHER', dueAt: c.offer.joiningOn, leadDays: 7,
      description: 'Create the staff account, the pay structure, policy acknowledgements and the induction plan before the first day.',
    }).catch(() => null);
  }
  if (['JOINED', 'WITHDRAWN', 'REJECTED'].includes(to)) await resolveSource(`hr:joining:${c._id}`).catch(() => null);
  await recordAudit({ actor, action: 'hr.candidate.moved', entityType: 'Candidate', entityId: String(c._id), before: { stage: from }, after: { stage: to } });
  return candidateView(c.toObject(), { vacancy: v });
}

export async function scoreCandidate(actor, id, body = {}) {
  requireProfile(actor);
  const c = await loadCandidate(id);
  if (['REJECTED', 'WITHDRAWN', 'JOINED'].includes(c.stage)) throw new AppError('This candidate is no longer in the pipeline.', 409);
  const ratings = {};
  for (const k of RUBRIC) {
    if (body.ratings?.[k] === undefined || body.ratings?.[k] === null || body.ratings?.[k] === '') continue;
    const n = Number(body.ratings[k]);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new AppError(`${RUBRIC_LABEL[k]} is rated 1 to 5`, 400);
    ratings[k] = n;
  }
  if (!Object.keys(ratings).length) throw new AppError(`Rate at least one of: ${RUBRIC.map((k) => RUBRIC_LABEL[k]).join(', ')} (1 to 5).`, 400);
  if (c.scores.some((s) => String(s.by?.profileId) === String(actor.profileId) && s.stage === (body.stage ?? c.stage))) throw new AppError('You have already scored this candidate at this stage.', 409);
  const vals = Object.values(ratings);
  c.scores.push({
    by: { profileId: actor.profileId, name: actor.displayName ?? null, at: new Date() }, stage: oneOf(body.stage, CANDIDATE_STAGES, 'stage', c.stage),
    ratings, total: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10,
    recommendation: oneOf(body.recommendation, ['STRONG_YES', 'YES', 'MAYBE', 'NO'], 'recommendation', 'MAYBE'),
    note: optionalText(body.note, { max: 1000 }) || null,
  });
  pushHistory(c, actor, 'SCORED', { note: `Average ${c.scores.at(-1).total}/5` });
  await c.save();
  return candidateView(c.toObject());
}

/**
 * Drafts the offer letter from what is on file. It is a draft for HR to edit
 * and sign; the school's own letterhead and terms govern. Nothing is sent.
 */
export async function draftOffer(actor, id, body = {}) {
  requireProfile(actor);
  const c = await loadCandidate(id);
  if (!['INTERVIEW', 'OFFERED', 'DEMO_LESSON', 'SCREENED'].includes(c.stage)) throw new AppError(`An offer is drafted after interview; this candidate is ${c.stage.toLowerCase()}.`, 409);
  const v = await Vacancy.findById(c.vacancyId).lean();
  const ctc = money(body.ctcPaise, 'ctcPaise') ?? c.offer?.ctcPaise;
  if (!ctc) throw new AppError('Give the annual CTC for the offer.', 400);
  const joiningOn = parseDate(body.joiningOn, 'joiningOn') ?? c.offer?.joiningOn;
  if (!joiningOn) throw new AppError('Give the joining date.', 400);
  const probationMonths = Math.min(Math.max(Number.parseInt(body.probationMonths, 10) || 12, 0), 24);
  const school = optionalText(body.schoolName, { max: 160 }) || 'the School';
  const letter = [
    `Date: ${istYmd(new Date())}`, '', `Dear ${c.name},`, '',
    `Subject: Offer of appointment — ${v?.title ?? 'staff position'}${v?.department ? `, ${v.department}` : ''}`, '',
    `We are pleased to offer you the position of ${v?.title ?? 'staff member'} at ${school} on a ${String(v?.employmentType ?? 'PERMANENT').toLowerCase().replace('_', '-')} basis, with effect from ${istYmd(joiningOn)}.`,
    `Your annual cost to the school will be ${inr(ctc)} (about ${inr(Math.round(ctc / 12))} a month), with the break-up, statutory deductions (PF, ESI where applicable, professional tax, TDS) and benefits as set out in the annexure.`,
    probationMonths ? `You will be on probation for ${probationMonths} months, after which your confirmation will be reviewed.` : null,
    v?.childFacing ? 'This offer is subject to satisfactory background verification (identity, education, previous employment, police verification and the child-safety declaration), which must be completed before you start working with children.' : 'This offer is subject to satisfactory background verification.',
    'Please bring your original certificates, identity and address proof, PAN, Aadhaar (to be masked on copies), bank details and your UAN if you have one, on the day of joining.',
    'Kindly sign and return a copy of this letter to confirm your acceptance within seven days.', '',
    'Yours sincerely,', '', '(Authorised signatory)', school,
  ].filter((l) => l !== null).join('\n');
  c.offer = { ...(c.offer?.toObject?.() ?? c.offer ?? {}), ctcPaise: ctc, joiningOn, letterText: letter };
  pushHistory(c, actor, 'OFFER_DRAFTED', { note: `CTC ${inr(ctc)}; joining ${istYmd(joiningOn)}` });
  await c.save();
  return { candidate: candidateView(c.toObject(), { vacancy: v }), letter, note: 'Draft only: check it against the school\'s letterhead and terms, then print and sign. Nothing has been sent.' };
}

/** Starts the background-verification case for a candidate (the existing verification workflow). */
export async function startCandidateVerification(actor, id, body = {}) {
  requireProfile(actor);
  if (actor.permissions?.['verification.manage'] !== 'ALL') throw new AppError('Starting a verification needs verification.manage.', 403);
  const c = await loadCandidate(id);
  if (c.verificationCaseId) throw new AppError('A verification case is already open for this candidate.', 409);
  if (!['INTERVIEW', 'OFFERED', 'ACCEPTED'].includes(c.stage)) throw new AppError('Verification starts once the candidate is at interview or later.', 409);
  const v = await Vacancy.findById(c.vacancyId).lean();
  const subjectType = oneOf(body.subjectType, ['TEACHER', 'STAFF', 'DRIVER', 'ATTENDANT', 'SECURITY'], 'subjectType', v?.subject || /teach/i.test(v?.title ?? '') ? 'TEACHER' : 'STAFF');
  const vc = await verification.initiate(actor, { subjectType, subjectName: c.name, positionTitle: v?.title ?? null, linkedEntity: `Candidate ${c.refNo}`, consent: body.consent });
  c.verificationCaseId = vc.id;
  pushHistory(c, actor, 'VERIFICATION_STARTED', { note: vc.refNo });
  await c.save();
  return { candidate: candidateView(c.toObject(), { vacancy: v, verificationStatus: vc.status }), verification: { id: vc.id, refNo: vc.refNo, status: vc.status } };
}

// ── exits ────────────────────────────────────────────────────────────────

function exitView(x) {
  return {
    id: String(x._id), refNo: x.refNo, profileId: String(x.profileId), name: x.name, kind: x.kind, reason: x.reason,
    noticeOn: istYmd(x.noticeOn), lastWorkingDay: istYmd(x.lastWorkingDay), noticeDaysRequired: x.noticeDaysRequired, noticeWaived: x.noticeWaived,
    noticeServedDays: Math.max(0, Math.round((new Date(x.lastWorkingDay) - new Date(x.noticeOn)) / DAY) + 1),
    clearances: (x.clearances ?? []).map((c) => ({ department: c.department, status: c.status, duesPaise: c.duesPaise, note: c.note, by: c.by?.name ?? null, at: c.by?.at ?? null })),
    clearancesPending: (x.clearances ?? []).filter((c) => c.status === 'PENDING').length,
    exitInterview: x.exitInterview?.at ? { at: x.exitInterview.at, note: x.exitInterview.note } : null,
    settlement: x.settlement, payrollRunId: x.payrollRunId ? String(x.payrollRunId) : null, status: x.status, createdAt: x.createdAt, history: x.history ?? [],
  };
}

async function loadExit(id) {
  const x = await ExitCase.findById(assertObjectId(id));
  if (!x) throw new AppError('Exit case not found', 404);
  return x;
}

export async function listExits(actor, query = {}) {
  requireProfile(actor);
  const filter = query.status ? { status: query.status } : { status: { $nin: ['CLOSED', 'WITHDRAWN'] } };
  if (query.status === 'ALL') delete filter.status;
  const rows = await ExitCase.find(filter).sort({ lastWorkingDay: 1 }).limit(200).lean();
  return { items: rows.map(exitView) };
}

export async function getExit(actor, id) {
  requireProfile(actor);
  return exitView((await loadExit(id)).toObject());
}

export async function startExit(actor, body = {}) {
  requireProfile(actor);
  const profileId = assertObjectId(body.profileId, 'profileId');
  if (String(profileId) === String(actor.profileId)) throw new AppError('Your own exit is handled by another HR person or the principal.', 403, [], 'SELF_EXIT');
  const profile = await Profile.findOne({ _id: profileId, deletedAt: null }).select('displayName').lean();
  if (!profile) throw new AppError('Staff member not found', 404);
  if (await ExitCase.exists({ profileId, status: { $nin: ['CLOSED', 'WITHDRAWN'] } })) throw new AppError('An exit is already open for this person.', 409, [], 'EXIT_OPEN');
  const noticeOn = parseDate(body.noticeOn, 'noticeOn') ?? new Date();
  const lastWorkingDay = parseDate(body.lastWorkingDay, 'lastWorkingDay', { required: true });
  if (lastWorkingDay < noticeOn) throw new AppError('The last working day is before the notice date.', 400);
  const departments = Array.isArray(body.departments) && body.departments.length ? body.departments.map((d) => oneOf(d, CLEARANCE_DEPARTMENTS, 'department')) : ['ACADEMICS', 'LIBRARY', 'IT', 'ACCOUNTS', 'ADMIN'];
  const x = new ExitCase({
    refNo: await nextRef('EXT'), profileId, name: profile.displayName, kind: oneOf(body.kind, EXIT_KINDS, 'kind'),
    reason: optionalText(body.reason, { max: 1000 }) || null, noticeOn, lastWorkingDay,
    noticeDaysRequired: Math.min(Math.max(Number.parseInt(body.noticeDaysRequired, 10) || 30, 0), 180),
    noticeWaived: Boolean(body.noticeWaived),
    clearances: [...new Set(departments)].map((department) => ({ department })),
  });
  pushHistory(x, actor, 'STARTED', { to: 'NOTICE', note: `${x.kind.toLowerCase()}; last working day ${istYmd(lastWorkingDay)}` });
  await x.save();
  await upsertFromSource({
    sourceKey: `hr:exit:${x._id}`, title: `Exit ${x.refNo}: clearances, exit interview and full-and-final for ${x.name}`,
    department: 'HR', category: 'OTHER', dueAt: lastWorkingDay, leadDays: 10,
    description: 'Collect department clearances, hold the exit interview, prepare the full-and-final and issue the relieving and experience letters.',
  }).catch(() => null);
  await recordAudit({ actor, action: 'hr.exit.started', entityType: 'ExitCase', entityId: String(x._id), after: { refNo: x.refNo, kind: x.kind } });
  return exitView(x.toObject());
}

export async function updateClearance(actor, id, body = {}) {
  requireProfile(actor);
  const x = await loadExit(id);
  if (['CLOSED', 'WITHDRAWN'].includes(x.status)) throw new AppError('This exit is closed.', 409);
  const department = oneOf(body.department, CLEARANCE_DEPARTMENTS, 'department');
  let row = x.clearances.find((c) => c.department === department);
  if (!row) { x.clearances.push({ department }); row = x.clearances.at(-1); }
  row.status = oneOf(body.status, ['PENDING', 'CLEARED', 'DUES'], 'status');
  row.duesPaise = row.status === 'DUES' ? (money(body.duesPaise, 'duesPaise') ?? 0) : 0;
  if (row.status === 'DUES' && !row.duesPaise && !body.note) throw new AppError('Say what is due (an amount or a note, e.g. "2 library books").', 400);
  row.note = optionalText(body.note, { max: 300 }) || null;
  row.by = { profileId: actor.profileId, name: actor.displayName ?? null, at: new Date() };
  if (x.status === 'NOTICE') x.status = 'CLEARANCE';
  pushHistory(x, actor, 'CLEARANCE', { note: `${department}: ${row.status.toLowerCase()}${row.duesPaise ? ` ${inr(row.duesPaise)}` : ''}` });
  await x.save();
  return exitView(x.toObject());
}

export async function recordExitInterview(actor, id, body = {}) {
  requireProfile(actor);
  const x = await loadExit(id);
  x.exitInterview = { at: parseDate(body.at, 'at') ?? new Date(), note: requireText(body.note, 'note', { max: 3000 }) };
  pushHistory(x, actor, 'EXIT_INTERVIEW');
  await x.save();
  return exitView(x.toObject());
}

/**
 * The full-and-final worksheet. Wages for gratuity and encashment are basic +
 * DA from the pay structure on file. Gratuity (Payment of Gratuity Act 1972,
 * s.4): 15 days' wages (15/26 of a month) for each completed year of service,
 * a final part-year of more than six months counting as a year; payable after
 * five years' continuous service, or on death or disablement; capped at
 * ₹20,00,000 (the Act's ceiling; a school may pay more under its own scheme).
 */
export async function settlementEstimate(actor, id, body = {}) {
  requireProfile(actor);
  if (actor.permissions?.['payroll.sensitive.read'] !== 'ALL') throw new AppError('The settlement shows pay details; it needs payroll.sensitive.read.', 403, [], 'PAYROLL_SENSITIVE');
  const x = await loadExit(id);
  const comp = await EmployeeCompensation.findOne({ profileId: x.profileId }).lean();
  if (!comp) throw new AppError(`${x.name} has no pay structure on file; add it on the Payroll page first.`, 409, [], 'NO_PAY_STRUCTURE');
  const basicC = comp.components.find((c) => c.code === 'BASIC');
  const daC = comp.components.find((c) => c.code === 'DA');
  const basic = basicC?.value ?? 0;
  const da = daC ? (daC.calc === 'FIXED' ? daC.value : Math.round((basic * daC.value) / 10000)) : 0;
  const wage = basic + da;
  const grossMonthly = comp.components.filter((c) => c.kind === 'EARNING').reduce((n, c) => n + (c.calc === 'FIXED' ? c.value : Math.round((basic * c.value) / 10000)), 0);

  const joined = new Date(comp.joiningDate); const lwd = new Date(x.lastWorkingDay);
  const serviceDays = Math.max(0, Math.round((lwd - joined) / DAY) + 1);
  const fullYears = Math.floor(serviceDays / 365.25);
  const remainderMonths = (serviceDays - fullYears * 365.25) / 30.44;
  const countedYears = fullYears + (remainderMonths > 6 ? 1 : 0);
  const eligible = x.kind === 'DEATH' || serviceDays >= Math.round(5 * 365.25) - 1 || body.disablement === true;
  const cap = money(body.gratuityCapPaise, 'gratuityCapPaise') ?? 2_000_000_00;
  const rawGratuity = eligible ? Math.round((wage * 15 * countedYears) / 26) : 0;
  const gratuity = Math.min(rawGratuity, cap);

  const divisor = [26, 30].includes(Number(body.encashmentDivisor)) ? Number(body.encashmentDivisor) : 26;
  let elDays = body.elDays !== undefined ? Math.max(0, Number(body.elDays) || 0) : null;
  if (elDays === null) {
    const bal = await balanceFor(actor, 'ALL', { profileId: String(x.profileId) }).catch(() => null);
    elDays = bal?.balances?.find((b) => b.code === 'EL')?.available ?? 0;
  }
  const encashment = Math.round((wage * elDays) / divisor);

  const served = Math.max(0, Math.round((lwd - new Date(x.noticeOn)) / DAY) + 1);
  const shortfall = x.kind === 'RESIGNATION' && !x.noticeWaived ? Math.max(0, x.noticeDaysRequired - served) : 0;
  const noticeRecovery = Math.round((grossMonthly * shortfall) / 30);
  const dues = (x.clearances ?? []).reduce((n, c) => n + (c.duesPaise ?? 0), 0);

  const lines = [
    { name: 'Gratuity', amountPaise: gratuity, reason: eligible ? `15/26 × ${inr(wage)} (basic + DA) × ${countedYears} year(s)${rawGratuity > cap ? `, capped at ${inr(cap)}` : ''}` : `Not payable: ${(serviceDays / 365.25).toFixed(1)} years of service (5 needed, except on death or disablement)` },
    { name: 'Leave encashment', amountPaise: encashment, reason: `${elDays} earned-leave day(s) × ${inr(wage)} / ${divisor}` },
    { name: 'Notice period recovery', amountPaise: noticeRecovery ? -noticeRecovery : 0, reason: shortfall ? `${shortfall} day(s) short of ${x.noticeDaysRequired} × ${inr(grossMonthly)} / 30` : 'Notice served or waived' },
    { name: 'Clearance dues', amountPaise: dues ? -dues : 0, reason: dues ? (x.clearances ?? []).filter((c) => c.duesPaise).map((c) => `${c.department.toLowerCase()} ${inr(c.duesPaise)}`).join(', ') : 'None' },
  ];
  const net = lines.reduce((n, l) => n + l.amountPaise, 0);
  const warnings = [];
  if (x.clearances.some((c) => c.status === 'PENDING')) warnings.push(`${x.clearances.filter((c) => c.status === 'PENDING').length} department clearance(s) are still pending; dues may change.`);
  if (!daC) warnings.push('No DA component on the pay structure: wages for gratuity are basic only.');
  if (gratuity > 0) warnings.push('Gratuity above ₹5,00,000 may be taxable beyond the exemption in s.10(10); the school\'s tax adviser computes TDS.');
  warnings.push('Salary for the days worked in the last month is paid in that month\'s regular run (the exit date prorates it).');
  const settlement = {
    computedAt: new Date(), lastWorkingDay: istYmd(lwd), joiningDate: istYmd(joined), serviceYears: Math.round((serviceDays / 365.25) * 10) / 10,
    wagePaise: wage, grossMonthlyPaise: grossMonthly, lines, netPaise: net, warnings,
  };
  x.settlement = settlement;
  if (['NOTICE', 'CLEARANCE'].includes(x.status) && !x.clearances.some((c) => c.status === 'PENDING')) x.status = 'SETTLEMENT';
  pushHistory(x, actor, 'SETTLEMENT_ESTIMATED', { note: `Net ${inr(net)}` });
  await x.save();
  return { exit: exitView(x.toObject()), settlement };
}

/**
 * Puts the last estimate on a FULL_AND_FINAL payroll run (created for the
 * month of the last working day, or an existing draft one), and sets the
 * exit date on the pay structure. The run then follows the normal approval.
 */
export async function sendSettlementToPayroll(actor, id) {
  requireProfile(actor);
  if (actor.permissions?.['payroll.prepare'] !== 'ALL') throw new AppError('Putting a settlement on a payroll run needs payroll.prepare.', 403);
  const x = await loadExit(id);
  if (!x.settlement?.lines) throw new AppError('Work out the settlement estimate first.', 409, [], 'NO_ESTIMATE');
  if (x.clearances.some((c) => c.status === 'PENDING')) throw new AppError('Every department clearance must be in before the settlement goes to payroll.', 409, [], 'CLEARANCE_PENDING');
  if (x.payrollRunId) throw new AppError('This settlement is already on a payroll run.', 409);
  const period = istYmd(x.lastWorkingDay).slice(0, 7);
  const runs = await payroll.listRuns(actor);
  const existing = (Array.isArray(runs) ? runs : runs.items ?? []).find((r) => r.kind === 'FULL_AND_FINAL' && r.period === period && ['DRAFT', 'CALCULATED'].includes(r.status));
  const run = existing ?? await payroll.createRun(actor, { period, kind: 'FULL_AND_FINAL' });
  const adjustments = x.settlement.lines.filter((l) => l.amountPaise !== 0).map((l) => ({ name: l.name, amountPaise: l.amountPaise, reason: `${x.refNo}: ${l.reason}`.slice(0, 300) }));
  await payroll.setInputs(actor, run.id, { inputs: [{ profileId: String(x.profileId), adjustments }] });
  await EmployeeCompensation.updateOne({ profileId: x.profileId }, {
    $set: { exitDate: x.lastWorkingDay },
    $push: { history: { at: new Date(), actorProfileId: actor.profileId, actorName: actor.displayName ?? null, action: 'EXIT_DATE_SET', note: x.refNo } },
  });
  x.payrollRunId = run.id;
  pushHistory(x, actor, 'SENT_TO_PAYROLL', { note: run.refNo });
  await x.save();
  await recordAudit({ actor, action: 'hr.exit.settlement_to_payroll', entityType: 'ExitCase', entityId: String(x._id), after: { run: run.refNo } });
  return { exit: exitView(x.toObject()), run: { id: run.id, refNo: run.refNo, period, status: run.status } };
}

export async function closeExit(actor, id, body = {}) {
  requireProfile(actor);
  const x = await loadExit(id);
  const to = body.withdraw ? 'WITHDRAWN' : 'CLOSED';
  if (to === 'CLOSED' && x.clearances.some((c) => c.status === 'PENDING')) throw new AppError('Clearances are still pending.', 409, [], 'CLEARANCE_PENDING');
  const from = x.status; x.status = to;
  pushHistory(x, actor, to, { from, to, note: optionalText(body.note, { max: 500 }) || null });
  await x.save();
  await resolveSource(`hr:exit:${x._id}`).catch(() => null);
  return exitView(x.toObject());
}

/** Relieving and experience letter drafts (HR edits, prints and signs). */
export async function exitLetters(actor, id, body = {}) {
  requireProfile(actor);
  const x = await loadExit(id);
  const comp = await EmployeeCompensation.findOne({ profileId: x.profileId }).select('designation joiningDate').lean();
  const school = optionalText(body.schoolName, { max: 160 }) || 'the School';
  const role = comp?.designation ?? 'a member of staff';
  const from = comp?.joiningDate ? istYmd(comp.joiningDate) : '(joining date)';
  const relieving = [`Date: ${istYmd(new Date())}`, '', 'TO WHOMSOEVER IT MAY CONCERN', '', `This is to certify that ${x.name} has been relieved from the services of ${school} at the close of working hours on ${istYmd(x.lastWorkingDay)}, ${x.kind === 'RESIGNATION' ? 'consequent to the resignation tendered' : `on ${x.kind.toLowerCase().replace('_', ' ')}`}.`, 'All dues and clearances have been settled as per the school\'s records.', '', '(Authorised signatory)', school].join('\n');
  const experience = [`Date: ${istYmd(new Date())}`, '', 'EXPERIENCE CERTIFICATE', '', `This is to certify that ${x.name} worked with ${school} as ${role} from ${from} to ${istYmd(x.lastWorkingDay)}.`, 'We wish them every success in their future endeavours.', '', '(Authorised signatory)', school].join('\n');
  return { relieving, experience, note: 'Drafts only: edit on the school letterhead, sign and hand over. Issue the relieving letter only after clearances are complete.' };
}

export const _test = { STAGE_FLOW, RUBRIC };
