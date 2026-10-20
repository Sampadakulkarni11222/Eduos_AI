import mongoose from 'mongoose';
import { LeavePolicy, LeaveBalance, StaffLeave, StaffAbsence, CoverAssignment, LEAVE_CODES } from '../../models/staffLeave.model.js';
import { CalendarEvent } from '../../models/calendarEvent.model.js';
import { AppError } from '../../utils/AppError.js';
import { runInAmbientTransaction } from '../../utils/transaction.js';
import { sendOperational } from '../messaging/messaging.service.js';
import {
  nextRef, requireProfile, assertObjectId, pushHistory, requireText, optionalText, oneOf, profileNames, profilesWithRoles, cleanAttachments,
} from '../ops/common.js';
import { istDay, istYmd } from '../ptm/relations.js';

/**
 * Staff leave: types with yearly entitlement and carry-forward, balances per
 * person per leave year (April–March), applications with half days, approval
 * by someone holding staffleave.manage (never the applicant), deduction only
 * on approval and restoration when an approved leave is cancelled. Leave
 * without pay (and an unauthorised absence marked as loss of pay) is summed
 * for payroll's LOP input.
 */

const DAY = 86_400_000;
export const STAFF_ROLES = ['ADMIN', 'PRINCIPAL', 'TEACHER', 'FINANCE', 'LIBRARIAN', 'WARDEN', 'HR', 'MARKETING', 'COMPLIANCE'];

/** A CBSE-school-style default set; every number is editable per school. */
export const DEFAULT_POLICIES = [
  { code: 'CL', name: 'Casual leave', yearlyDays: 12, carryForwardMax: 0, allowHalfDay: true, paid: true, tracksBalance: true, note: 'Lapses at the end of the leave year.' },
  { code: 'SL', name: 'Sick leave', yearlyDays: 10, carryForwardMax: 30, allowHalfDay: true, paid: true, tracksBalance: true, documentAfterDays: 3, note: 'A medical certificate is expected for more than 3 days.' },
  { code: 'EL', name: 'Earned leave', yearlyDays: 15, carryForwardMax: 30, allowHalfDay: false, paid: true, tracksBalance: true, note: 'Unused days carry forward up to the cap.' },
  { code: 'ML', name: 'Maternity leave', yearlyDays: 182, carryForwardMax: 0, allowHalfDay: false, paid: true, tracksBalance: true, note: '26 weeks, as the Maternity Benefit Act provides for the first two children.' },
  { code: 'PL', name: 'Paternity leave', yearlyDays: 15, carryForwardMax: 0, allowHalfDay: false, paid: true, tracksBalance: true },
  { code: 'DL', name: 'Duty leave', yearlyDays: 0, carryForwardMax: 0, allowHalfDay: true, paid: true, tracksBalance: false, note: 'School duty away from campus: exam duty, training, a competition.' },
  { code: 'LWP', name: 'Leave without pay', yearlyDays: 0, carryForwardMax: 0, allowHalfDay: true, paid: false, tracksBalance: false, note: 'Counted as loss of pay in payroll.' },
];

/** The leave year a day falls in: April to March, named "2026-27". */
export function leaveYearOf(day) {
  const d = istDay(day);
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function leaveYearRange(leaveYear) {
  const start = Number(String(leaveYear).slice(0, 4));
  if (!Number.isInteger(start)) throw new AppError('leaveYear looks like 2026-27', 400);
  return { from: new Date(Date.UTC(start, 3, 1)), to: new Date(Date.UTC(start + 1, 2, 31)) };
}

const ymdDay = (value, label) => {
  const m = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new AppError(`${label} must be a date like 2026-10-20`, 400);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
};

/** Holidays on the school calendar in a range, as a set of YYYY-MM-DD. */
async function holidaysBetween(from, to) {
  const events = await CalendarEvent.find({ type: 'HOLIDAY', deletedAt: null, startsAt: { $lte: new Date(to.getTime() + DAY) }, endsAt: { $gte: from } }).select('startsAt endsAt').lean();
  const set = new Set();
  for (const e of events) {
    for (let t = istDay(e.startsAt).getTime(); t <= istDay(e.endsAt).getTime(); t += DAY) set.add(new Date(t).toISOString().slice(0, 10));
  }
  return set;
}

/** Working days in [from, to]: every day but Sundays and school holidays. */
export async function workingDaysBetween(from, to) {
  const holidays = await holidaysBetween(from, to);
  const days = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || holidays.has(d.toISOString().slice(0, 10))) continue;
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

export async function policies({ ensure = true } = {}) {
  let rows = await LeavePolicy.find({}).sort({ code: 1 }).lean();
  if (!rows.length && ensure) {
    try { await LeavePolicy.insertMany(DEFAULT_POLICIES.map((p) => ({ ...p }))); } catch (err) { if (err?.code !== 11000) throw err; }
    rows = await LeavePolicy.find({}).lean();
  }
  const order = new Map(LEAVE_CODES.map((c, i) => [c, i]));
  return rows.sort((a, b) => order.get(a.code) - order.get(b.code)).map((p) => ({
    code: p.code, name: p.name, yearlyDays: p.yearlyDays, carryForwardMax: p.carryForwardMax, allowHalfDay: p.allowHalfDay, paid: p.paid,
    tracksBalance: p.tracksBalance, documentAfterDays: p.documentAfterDays ?? null, note: p.note ?? null, active: p.active,
  }));
}

export async function setPolicy(actor, scope, code, body = {}) {
  requireProfile(actor);
  if (scope !== 'ALL') throw new AppError('Only HR or the principal can change leave policies.', 403);
  await policies();
  const c = oneOf(code, LEAVE_CODES, 'code');
  const set = {};
  if (body.name !== undefined) set.name = requireText(body.name, 'name', { max: 80 });
  for (const k of ['yearlyDays', 'carryForwardMax']) {
    if (body[k] !== undefined) {
      const n = Number(body[k]);
      if (!Number.isFinite(n) || n < 0 || n > 366 || (n * 2) % 1 !== 0) throw new AppError(`${k} is a number of days (halves allowed).`, 400);
      set[k] = n;
    }
  }
  for (const k of ['allowHalfDay', 'paid', 'active']) if (typeof body[k] === 'boolean') set[k] = body[k];
  if (body.note !== undefined) set.note = optionalText(body.note, { max: 300 }) || null;
  await LeavePolicy.updateOne({ code: c }, { $set: set });
  return (await policies()).find((p) => p.code === c);
}

async function policyOf(code) {
  await policies();
  const p = await LeavePolicy.findOne({ code }).lean();
  if (!p || !p.active) throw new AppError('That leave type is not offered.', 400, [], 'LEAVE_TYPE_OFF');
  return p;
}

/**
 * Creates the year's balances for every member of staff (idempotent): the
 * policy's entitlement, plus what carries forward from the previous year up to
 * the policy's cap.
 */
export async function initBalances(actor, scope, body = {}) {
  requireProfile(actor);
  if (scope !== 'ALL') throw new AppError('Only HR or the principal can set up balances.', 403);
  const leaveYear = body.leaveYear ?? leaveYearOf(new Date());
  leaveYearRange(leaveYear);
  const start = Number(leaveYear.slice(0, 4));
  const prevYear = `${start - 1}-${String(start % 100).padStart(2, '0')}`;
  const pols = (await policies()).filter((p) => p.tracksBalance && p.active);
  const staff = body.profileIds?.length ? body.profileIds.map((id) => ({ _id: assertObjectId(id, 'profileId') })) : await profilesWithRoles(STAFF_ROLES);
  const prev = await LeaveBalance.find({ leaveYear: prevYear }).lean();
  const prevBy = new Map(prev.map((b) => [`${b.profileId}:${b.code}`, b]));
  let created = 0;
  for (const person of staff) {
    for (const p of pols) {
      const old = prevBy.get(`${person._id}:${p.code}`);
      const carried = old ? Math.min(Math.max(0, old.entitled + old.carriedForward - old.used), p.carryForwardMax) : 0;
      // eslint-disable-next-line no-await-in-loop
      const res = await LeaveBalance.updateOne(
        { profileId: person._id, leaveYear, code: p.code },
        { $setOnInsert: { entitled: p.yearlyDays, carriedForward: carried, used: 0 } },
        { upsert: true },
      );
      created += res.upsertedCount ?? 0;
    }
  }
  return { leaveYear, people: staff.length, created };
}

/** Adjust one balance by hand (a joining-date pro-rata, a correction); always with a reason. */
export async function adjustBalance(actor, scope, body = {}) {
  requireProfile(actor);
  if (scope !== 'ALL') throw new AppError('Only HR or the principal can adjust balances.', 403);
  const profileId = assertObjectId(body.profileId, 'profileId');
  const code = oneOf(body.code, LEAVE_CODES, 'code');
  const leaveYear = body.leaveYear ?? leaveYearOf(new Date());
  const days = Number(body.days);
  if (!Number.isFinite(days) || days === 0 || (days * 2) % 1 !== 0) throw new AppError('days is a non-zero number of days (halves allowed).', 400);
  const reason = requireText(body.reason, 'reason', { max: 300 });
  await LeaveBalance.updateOne({ profileId, leaveYear, code }, { $inc: { entitled: days }, $push: { adjustments: { days, reason, byProfileId: actor.profileId } }, $setOnInsert: { carriedForward: 0, used: 0 } }, { upsert: true });
  return balanceFor(actor, 'ALL', { profileId, leaveYear });
}

/** One person's balances for a leave year, with what is pending. */
export async function balanceFor(actor, scope, query = {}) {
  requireProfile(actor);
  const profileId = scope === 'ALL' && query.profileId ? assertObjectId(query.profileId, 'profileId') : actor.profileId;
  const leaveYear = query.leaveYear ?? leaveYearOf(new Date());
  const [pols, rows, pending] = await Promise.all([
    policies(),
    LeaveBalance.find({ profileId, leaveYear }).lean(),
    StaffLeave.aggregate([{ $match: { profileId: new mongoose.Types.ObjectId(String(profileId)), leaveYear, status: 'PENDING' } }, { $group: { _id: '$code', days: { $sum: '$days' } } }]),
  ]);
  const by = new Map(rows.map((r) => [r.code, r]));
  const pend = new Map(pending.map((p) => [p._id, p.days]));
  return {
    profileId: String(profileId), leaveYear,
    balances: pols.filter((p) => p.active).map((p) => {
      const b = by.get(p.code);
      const entitled = b?.entitled ?? 0; const carried = b?.carriedForward ?? 0; const used = b?.used ?? 0;
      return {
        code: p.code, name: p.name, tracksBalance: p.tracksBalance, paid: p.paid, allowHalfDay: p.allowHalfDay,
        entitled, carriedForward: carried, used, pending: pend.get(p.code) ?? 0,
        available: p.tracksBalance ? entitled + carried - used : null,
        availableAfterPending: p.tracksBalance ? entitled + carried - used - (pend.get(p.code) ?? 0) : null,
        set: Boolean(b) || !p.tracksBalance,
      };
    }),
  };
}

/** Everyone's balances for a year (HR/principal). */
export async function allBalances(actor, scope, query = {}) {
  if (scope !== 'ALL') throw new AppError('Only HR or the principal can see everyone\'s balances.', 403);
  const leaveYear = query.leaveYear ?? leaveYearOf(new Date());
  const rows = await LeaveBalance.find({ leaveYear }).lean();
  const names = await profileNames(rows.map((r) => r.profileId));
  const by = new Map();
  for (const r of rows) {
    const k = String(r.profileId);
    if (!by.has(k)) by.set(k, { profileId: k, name: names.get(k) ?? null, balances: {} });
    by.get(k).balances[r.code] = { entitled: r.entitled, carriedForward: r.carriedForward, used: r.used, available: r.entitled + r.carriedForward - r.used };
  }
  return { leaveYear, people: [...by.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))) };
}

function presentLeave(l, names = new Map()) {
  return {
    id: String(l._id), refNo: l.refNo, profileId: String(l.profileId), name: names.get(String(l.profileId)) ?? null,
    code: l.code, leaveYear: l.leaveYear, fromDate: istYmd(l.fromDate), toDate: istYmd(l.toDate), halfDay: l.halfDay ?? null, days: l.days,
    reason: l.reason, status: l.status, attachments: l.attachments ?? [], decidedAt: l.decidedAt ?? null, decisionNote: l.decisionNote ?? null,
    decidedByName: names.get(String(l.decidedByProfileId)) ?? null, createdAt: l.createdAt, history: l.history ?? [],
  };
}

async function decorate(rows) {
  const names = await profileNames(rows.flatMap((r) => [r.profileId, r.decidedByProfileId]));
  return rows.map((r) => presentLeave(r, names));
}

export async function apply(actor, scope, body = {}) {
  requireProfile(actor);
  const profileId = scope === 'ALL' && body.profileId ? assertObjectId(body.profileId, 'profileId') : actor.profileId;
  const code = oneOf(body.code, LEAVE_CODES, 'code');
  const policy = await policyOf(code);
  const fromDate = ymdDay(body.fromDate, 'fromDate');
  const toDate = ymdDay(body.toDate ?? body.fromDate, 'toDate');
  if (toDate < fromDate) throw new AppError('The leave ends before it starts.', 400, [], 'BAD_DATES');
  if (toDate.getTime() - fromDate.getTime() > 200 * DAY) throw new AppError('Apply for at most 200 days at a time.', 400);
  const leaveYear = leaveYearOf(fromDate);
  if (leaveYearOf(toDate) !== leaveYear) throw new AppError('This leave crosses into the next leave year (1 April). Apply for each year separately.', 400, [], 'CROSSES_LEAVE_YEAR');
  let halfDay = null;
  if (body.halfDay) {
    halfDay = oneOf(body.halfDay, ['FIRST_HALF', 'SECOND_HALF'], 'halfDay');
    if (!policy.allowHalfDay) throw new AppError(`${policy.name} cannot be taken as a half day.`, 400, [], 'NO_HALF_DAY');
    if (fromDate.getTime() !== toDate.getTime()) throw new AppError('A half day is a single day.', 400, [], 'HALF_DAY_RANGE');
  }
  const working = await workingDaysBetween(fromDate, toDate);
  if (!working.length) throw new AppError('Those dates are all Sundays or school holidays.', 400, [], 'NO_WORKING_DAYS');
  const days = halfDay ? 0.5 : working.length;
  const overlap = await StaffLeave.findOne({ profileId, status: { $in: ['PENDING', 'APPROVED'] }, fromDate: { $lte: toDate }, toDate: { $gte: fromDate } }).lean();
  if (overlap && !(overlap.halfDay && halfDay && overlap.halfDay !== halfDay)) throw new AppError(`This overlaps your ${overlap.status.toLowerCase()} leave ${overlap.refNo}.`, 409, [], 'LEAVE_OVERLAP');
  if (policy.tracksBalance) {
    const bal = (await balanceFor(actor, 'ALL', { profileId, leaveYear })).balances.find((b) => b.code === code);
    if (!bal?.set) throw new AppError(`No ${policy.name.toLowerCase()} balance is set up for ${leaveYear}. Ask HR to set up balances.`, 409, [], 'NO_BALANCE');
    if (bal.availableAfterPending < days) throw new AppError(`Not enough ${policy.name.toLowerCase()}: ${bal.availableAfterPending} day(s) left after pending applications, ${days} asked. Choose another type, or leave without pay.`, 409, [], 'INSUFFICIENT_BALANCE');
  }
  const leave = new StaffLeave({
    refNo: await nextRef('LV'), profileId, code, leaveYear, fromDate, toDate, halfDay, days,
    reason: requireText(body.reason, 'reason', { max: 1000 }), attachments: cleanAttachments(body.attachments, actor),
    status: 'PENDING', appliedByProfileId: actor.profileId, history: [],
  });
  pushHistory(leave, actor, 'APPLIED', { to: 'PENDING' });
  await leave.save();
  const deciders = (await profilesWithRoles(['PRINCIPAL', 'HR'])).map((p) => String(p._id)).filter((id) => id !== String(profileId));
  const [name] = (await profileNames([profileId])).values();
  await sendOperational({
    templateKey: 'STAFF_LEAVE_REQUESTED', recipientProfileIds: deciders, channels: [],
    variables: { name: name ?? 'A colleague', days, from: istYmd(fromDate) }, link: `/staff-leave?id=${leave._id}`,
    idempotencyKey: `staffleave:${leave._id}:requested`, relatedEntityType: 'StaffLeave', relatedEntityId: leave._id,
  });
  return (await decorate([leave.toObject()]))[0];
}

export async function list(actor, scope, query = {}) {
  requireProfile(actor);
  const filter = {};
  const view = scope === 'ALL' ? (query.view ?? 'all') : 'mine';
  if (view === 'mine') filter.profileId = actor.profileId;
  else if (query.profileId) filter.profileId = assertObjectId(query.profileId, 'profileId');
  if (query.status) filter.status = oneOf(query.status, ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'], 'status');
  if (query.date) { const d = ymdDay(query.date, 'date'); filter.fromDate = { $lte: d }; filter.toDate = { $gte: d }; }
  const rows = await StaffLeave.find(filter).sort({ status: 1, fromDate: -1 }).limit(300).lean();
  return decorate(rows);
}

async function loadLeave(id) {
  const l = await StaffLeave.findById(assertObjectId(id));
  if (!l) throw new AppError('Leave application not found', 404);
  return l;
}

/**
 * Approve or reject. Approval deducts the balance in the same transaction,
 * and only if enough is left (a conditional update), so two approvals at once
 * cannot take a balance below zero.
 */
export async function decide(actor, scope, id, body = {}) {
  requireProfile(actor);
  if (scope !== 'ALL') throw new AppError('Only HR or the principal can decide staff leave.', 403);
  const action = oneOf(body.action, ['APPROVE', 'REJECT'], 'action');
  const note = optionalText(body.note, { max: 1000 }) || null;
  if (action === 'REJECT' && !note) throw new AppError('Give a reason for rejecting.', 400, [], 'REASON_REQUIRED');
  const leave = await runInAmbientTransaction(async () => {
    const l = await loadLeave(id);
    if (String(l.profileId) === String(actor.profileId)) throw new AppError('You cannot decide your own leave.', 403, [], 'SELF_APPROVAL');
    if (l.status !== 'PENDING') throw new AppError(`This application is ${l.status.toLowerCase()}.`, 409, [], 'LEAVE_DECIDED');
    if (action === 'APPROVE') {
      const policy = await policyOf(l.code);
      if (policy.tracksBalance) {
        const done = await LeaveBalance.findOneAndUpdate(
          { profileId: l.profileId, leaveYear: l.leaveYear, code: l.code, $expr: { $gte: [{ $subtract: [{ $add: ['$entitled', '$carriedForward'] }, '$used'] }, l.days] } },
          { $inc: { used: l.days } }, { new: true },
        );
        if (!done) throw new AppError('Not enough balance left to approve this leave.', 409, [], 'INSUFFICIENT_BALANCE');
      }
    }
    const from = l.status;
    l.status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    l.decidedByProfileId = actor.profileId; l.decidedAt = new Date(); l.decisionNote = note;
    pushHistory(l, actor, l.status, { from, to: l.status, note });
    await l.save();
    return l;
  });
  await sendOperational({
    templateKey: 'STAFF_LEAVE_DECIDED', recipientProfileIds: [String(leave.profileId)], channels: ['EMAIL'],
    variables: { from: istYmd(leave.fromDate), days: leave.days, decision: leave.status }, link: `/staff-leave?id=${leave._id}`,
    idempotencyKey: `staffleave:${leave._id}:decided`, relatedEntityType: 'StaffLeave', relatedEntityId: leave._id,
  });
  return (await decorate([leave.toObject()]))[0];
}

/**
 * Withdraw a pending application, or cancel an approved one (its balance is
 * restored and any cover arranged for the days still ahead is cancelled). The
 * applicant can cancel until the leave starts; HR and the principal any time.
 */
export async function cancel(actor, scope, id, body = {}) {
  requireProfile(actor);
  const reason = requireText(body.reason, 'reason', { max: 500 });
  let coversCancelled = 0;
  const leave = await runInAmbientTransaction(async () => {
    const l = await loadLeave(id);
    const own = String(l.profileId) === String(actor.profileId);
    if (!own && scope !== 'ALL') throw new AppError('Leave application not found', 404);
    if (!['PENDING', 'APPROVED'].includes(l.status)) throw new AppError(`This application is ${l.status.toLowerCase()}.`, 409, [], 'LEAVE_DECIDED');
    if (own && scope !== 'ALL' && l.status === 'APPROVED' && l.fromDate <= istDay(new Date())) throw new AppError('This leave has started. Ask HR to change it.', 409, [], 'LEAVE_STARTED');
    if (l.status === 'APPROVED') {
      const policy = await LeavePolicy.findOne({ code: l.code }).lean();
      if (policy?.tracksBalance !== false) await LeaveBalance.updateOne({ profileId: l.profileId, leaveYear: l.leaveYear, code: l.code }, { $inc: { used: -l.days } });
      const today = istDay(new Date());
      const res = await CoverAssignment.updateMany(
        { absentProfileId: l.profileId, status: 'CONFIRMED', date: { $gte: l.fromDate > today ? l.fromDate : today, $lte: l.toDate } },
        { $set: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'The leave was cancelled' } },
      );
      coversCancelled = res.modifiedCount ?? 0;
    }
    const from = l.status;
    l.status = 'CANCELLED'; l.cancelledAt = new Date();
    pushHistory(l, actor, 'CANCELLED', { from, to: 'CANCELLED', note: reason });
    await l.save();
    return l;
  });
  return { ...(await decorate([leave.toObject()]))[0], coversCancelled };
}

/**
 * Loss-of-pay days per person in a period, in the shape payroll's
 * PUT /payroll/runs/:id/inputs takes ({ inputs: [{ profileId, lopDays }] }):
 * approved leave without pay plus absences marked as loss of pay, counted on
 * working days inside the period.
 */
export async function lopSummary(actor, scope, query = {}) {
  requireProfile(actor);
  if (scope !== 'ALL') throw new AppError('Only HR or the principal can export LOP days.', 403);
  const from = ymdDay(query.from, 'from');
  const to = ymdDay(query.to, 'to');
  if (to < from) throw new AppError('to is before from', 400);
  const unpaid = (await LeavePolicy.find({ paid: false }).select('code').lean()).map((p) => p.code);
  const codes = unpaid.length ? unpaid : ['LWP'];
  const [leaves, absences] = await Promise.all([
    StaffLeave.find({ status: 'APPROVED', code: { $in: codes }, fromDate: { $lte: to }, toDate: { $gte: from } }).lean(),
    StaffAbsence.find({ status: 'ACTIVE', lop: true, date: { $gte: from, $lte: to } }).lean(),
  ]);
  const working = new Set(await workingDaysBetween(from, to));
  const by = new Map();
  const add = (pid, n, src) => { const k = String(pid); const r = by.get(k) ?? { profileId: k, lopDays: 0, sources: [] }; r.lopDays += n; r.sources.push(src); by.set(k, r); };
  for (const l of leaves) {
    if (l.halfDay) { if (working.has(istYmd(l.fromDate))) add(l.profileId, 0.5, l.refNo); continue; }
    let n = 0;
    for (let t = Math.max(l.fromDate.getTime(), from.getTime()); t <= Math.min(l.toDate.getTime(), to.getTime()); t += DAY) if (working.has(new Date(t).toISOString().slice(0, 10))) n += 1;
    if (n) add(l.profileId, n, l.refNo);
  }
  for (const a of absences) if (working.has(istYmd(a.date))) add(a.profileId, a.halfDay ? 0.5 : 1, `absence ${istYmd(a.date)}`);
  const names = await profileNames([...by.keys()]);
  const inputs = [...by.values()].map((r) => ({ ...r, name: names.get(r.profileId) ?? null })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return {
    from: istYmd(from), to: istYmd(to), inputs,
    payrollBody: { inputs: inputs.map((r) => ({ profileId: r.profileId, lopDays: r.lopDays })) },
    definition: 'Loss of pay: approved leave of an unpaid type and absences marked as loss of pay, on working days (not Sundays or school holidays) inside the period. Send payrollBody to PUT /payroll/runs/:id/inputs.',
  };
}
