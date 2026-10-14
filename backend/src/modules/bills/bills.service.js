import { ServiceAccount, Bill, ServiceVisit, BILL_CATEGORIES, BILLING_CYCLES, CYCLE_MONTHS } from '../../models/bill.model.js';
import { Vendor } from '../../models/finance.model.js';
import { Contract } from '../../models/administration.model.js';
import { Facility } from '../../models/facility.model.js';
import { DueItem } from '../../models/dueItem.model.js';
import { AppError } from '../../utils/AppError.js';
import { inr } from '../finance-ops/format.js';
import {
  nextRef, requireProfile, assertObjectId, pushHistory, cleanAttachments, parseDate, requireText, optionalText, oneOf, dto, pageArgs, asPaise, profileNames, escapeRegex,
} from '../ops/common.js';
import { syncDue } from './due-sync.js';
import { logger } from '../../utils/logger.js';

/**
 * Recurring bills and services.
 *
 * Money rules: whole paise; a payment someone records is not a settled bill
 * until a different person confirms it against the bank (the same separation
 * procurement and payroll use); an issued bill is never edited away — it is
 * disputed or cancelled with a reason, and its history keeps what it said.
 *
 * Every due date becomes a task in the shared queue: each unpaid bill, each
 * account's next expected bill (recurring), and each scheduled service visit
 * (closed with evidence). Snoozing, escalation and reassignment are the tasks
 * engine's, so a bill reminder behaves like every other reminder.
 */

const DAY = 86_400_000;
const safely = (p, what) => p.catch((err) => logger.error(`Bill task sync (${what}) failed: ${err.message}`));
const HIGH_IMPACT = ['ELECTRICITY', 'WATER', 'INSURANCE', 'INTERNET', 'LIFT'];
const addMonths = (date, n) => { const d = new Date(date); d.setUTCMonth(d.getUTCMonth() + n); return d; };

// ── Accounts ──────────────────────────────────────────────────────────────

async function vendorFields(body) {
  if (body.vendorId) {
    const v = await Vendor.findById(assertObjectId(body.vendorId, 'vendorId')).select('name status').lean();
    if (!v) throw new AppError('Vendor not found', 404);
    return { vendorId: v._id, vendorName: optionalText(body.vendorName, { max: 160 }) || v.name };
  }
  if (body.vendorName !== undefined) return { vendorId: null, vendorName: optionalText(body.vendorName, { max: 160 }) || null };
  return {};
}

async function accountFields(body, partial = false) {
  const out = { ...(await vendorFields(body)) };
  if (!partial || body.name !== undefined) out.name = requireText(body.name, 'name', { max: 160 });
  if (!partial || body.category !== undefined) out.category = oneOf(body.category, BILL_CATEGORIES, 'category');
  if (body.billingCycle !== undefined || !partial) out.billingCycle = oneOf(body.billingCycle, BILLING_CYCLES, 'billingCycle', 'MONTHLY');
  for (const f of ['accountNo', 'campusCode', 'consumptionUnit', 'notes', 'budgetLineCode']) if (body[f] !== undefined) out[f] = optionalText(body[f], { max: f === 'notes' ? 2000 : 80 }) || null;
  if (body.expectedAmountPaise !== undefined) out.expectedAmountPaise = asPaise(body.expectedAmountPaise, 'expectedAmountPaise');
  for (const f of ['nextDueOn', 'contractStartsOn', 'contractEndsOn']) if (body[f] !== undefined) out[f] = parseDate(body[f], f);
  if (body.noticeDays !== undefined) out.noticeDays = Math.max(0, Math.min(Number.parseInt(body.noticeDays, 10) || 0, 365));
  if (body.autoRenews !== undefined) out.autoRenews = body.autoRenews === true;
  if (body.visitsPerYear !== undefined) out.visitsPerYear = Math.max(0, Math.min(Number.parseInt(body.visitsPerYear, 10) || 0, 52));
  if (body.ownerProfileId !== undefined) out.ownerProfileId = body.ownerProfileId ? assertObjectId(body.ownerProfileId, 'ownerProfileId') : null;
  if (body.facilityId !== undefined) {
    out.facilityId = body.facilityId ? assertObjectId(body.facilityId, 'facilityId') : null;
    if (out.facilityId && !(await Facility.exists({ _id: out.facilityId }))) throw new AppError('Facility not found', 404);
  }
  if (body.contractId !== undefined) {
    out.contractId = body.contractId ? assertObjectId(body.contractId, 'contractId') : null;
    if (out.contractId) {
      const c = await Contract.findById(out.contractId).select('startsOn endsOn noticePeriodDays autoRenews').lean();
      if (!c) throw new AppError('Agreement not found', 404);
      out.contractStartsOn = out.contractStartsOn ?? c.startsOn ?? null;
      out.contractEndsOn = out.contractEndsOn ?? c.endsOn ?? null;
      if (body.noticeDays === undefined) out.noticeDays = c.noticePeriodDays ?? 30;
      if (body.autoRenews === undefined) out.autoRenews = c.autoRenews ?? false;
    }
  }
  if (Array.isArray(body.leadDays)) out.leadDays = [...new Set(body.leadDays.map((n) => Number.parseInt(n, 10)).filter((n) => n >= 0 && n <= 120))].sort((a, b) => b - a).slice(0, 6);
  if (body.status !== undefined) out.status = oneOf(body.status, ['ACTIVE', 'PAUSED', 'ENDED'], 'status');
  return out;
}

async function presentAccount(a, extra = {}) {
  const out = dto(a);
  delete out.history;
  const names = await profileNames([a.ownerProfileId]);
  out.ownerName = a.ownerProfileId ? names.get(String(a.ownerProfileId)) ?? null : null;
  out.noticeBy = a.contractEndsOn ? new Date(new Date(a.contractEndsOn).getTime() - (a.noticeDays ?? 0) * DAY) : null;
  return { ...out, ...extra };
}

export async function syncAccountDue(a) {
  const months = CYCLE_MONTHS[a.billingCycle];
  const on = a.status === 'ACTIVE' && a.nextDueOn && months;
  return syncDue(`billacct:${a._id}:expected`, on ? {
    title: `Expected bill: ${a.name}${a.accountNo ? ` (${a.accountNo})` : ''}`, department: 'FINANCE', category: 'BILL', dueAt: a.nextDueOn,
    ownerProfileId: a.ownerProfileId ? String(a.ownerProfileId) : null, amountPaise: a.expectedAmountPaise || null, leadDays: a.leadDays,
    recurrence: { unit: 'MONTH', every: months }, severity: HIGH_IMPACT.includes(a.category) ? 'HIGH' : 'NORMAL',
    description: 'Record the bill when it arrives (Bills → Record bill). A bill that has not arrived by its usual date is worth chasing.',
    source: { entityType: 'ServiceAccount', entityId: a._id, link: `/bills?tab=accounts&id=${a._id}` },
  } : null, { note: 'Bill recorded or account paused' });
}

export async function createAccount(actor, body = {}) {
  requireProfile(actor);
  const a = new ServiceAccount({ refNo: await nextRef('SVC'), ownerProfileId: actor.profileId, ...(await accountFields(body)) });
  pushHistory(a, actor, 'CREATED');
  await a.save();
  await safely(syncAccountDue(a.toObject()), 'account');
  if (a.visitsPerYear && body.firstVisitOn) await scheduleVisit(actor, a, parseDate(body.firstVisitOn, 'firstVisitOn'));
  return presentAccount(a.toObject());
}

export async function updateAccount(actor, id, body = {}) {
  const a = await ServiceAccount.findById(assertObjectId(id));
  if (!a) throw new AppError('Service account not found', 404);
  Object.assign(a, await accountFields(body, true));
  pushHistory(a, actor, 'UPDATED');
  await a.save();
  await safely(syncAccountDue(a.toObject()), 'account');
  return presentAccount(a.toObject());
}

export async function listAccounts(actor, query = {}) {
  requireProfile(actor);
  const filter = {};
  if (query.category) filter.category = oneOf(query.category, BILL_CATEGORIES, 'category');
  if (query.status) filter.status = oneOf(query.status, ['ACTIVE', 'PAUSED', 'ENDED'], 'status');
  if (query.q) filter.$or = ['name', 'vendorName', 'accountNo'].map((f) => ({ [f]: { $regex: escapeRegex(String(query.q).slice(0, 60)), $options: 'i' } }));
  const accounts = await ServiceAccount.find(filter).sort({ category: 1, name: 1 }).limit(1000).select('-history').lean();
  const stats = await Bill.aggregate([
    { $match: { accountId: { $in: accounts.map((a) => a._id) }, status: { $ne: 'CANCELLED' } } },
    { $sort: { billDate: -1 } },
    { $group: { _id: '$accountId', bills: { $sum: 1 }, last: { $first: '$amountPaise' }, lastDate: { $first: '$billDate' }, outstanding: { $sum: { $cond: [{ $in: ['$status', ['PAID']] }, 0, { $subtract: ['$amountPaise', '$confirmedPaidPaise'] }] } } } },
  ]);
  const byId = new Map(stats.map((r) => [String(r._id), r]));
  const nextVisits = await ServiceVisit.find({ accountId: { $in: accounts.map((a) => a._id) }, status: 'SCHEDULED' }).sort({ scheduledOn: 1 }).select('accountId scheduledOn').lean();
  const visitBy = new Map();
  for (const v of nextVisits) if (!visitBy.has(String(v.accountId))) visitBy.set(String(v.accountId), v.scheduledOn);
  const out = [];
  for (const a of accounts) {
    const st = byId.get(String(a._id));
    // eslint-disable-next-line no-await-in-loop
    out.push(await presentAccount(a, { billCount: st?.bills ?? 0, lastAmountPaise: st?.last ?? null, lastBillDate: st?.lastDate ?? null, outstandingPaise: st?.outstanding ?? 0, nextVisitOn: visitBy.get(String(a._id)) ?? null }));
  }
  return out;
}

// ── Bills ─────────────────────────────────────────────────────────────────

function statusOf(b) {
  if (['CANCELLED', 'DISPUTED'].includes(b.status)) return b.status;
  const live = (b.payments ?? []).filter((p) => p.status !== 'REJECTED');
  const confirmed = live.filter((p) => p.status === 'CONFIRMED').reduce((n, p) => n + p.amountPaise, 0);
  const recorded = live.reduce((n, p) => n + p.amountPaise, 0);
  b.confirmedPaidPaise = confirmed;
  b.recordedPaidPaise = recorded;
  if (b.amountPaise > 0 && confirmed >= b.amountPaise) return 'PAID';
  if (b.amountPaise > 0 && recorded >= b.amountPaise) return 'PAYMENT_RECORDED';
  if (recorded > 0) return 'PARTIALLY_PAID';
  return 'DUE';
}

function presentBill(b, now = new Date()) {
  const out = dto(b);
  delete out.history;
  out.outstandingPaise = Math.max(0, b.amountPaise - (b.confirmedPaidPaise ?? 0));
  out.unconfirmedPaise = Math.max(0, (b.recordedPaidPaise ?? 0) - (b.confirmedPaidPaise ?? 0));
  out.overdue = !['PAID', 'CANCELLED'].includes(b.status) && new Date(b.dueOn) < now;
  out.daysToDue = Math.ceil((new Date(b.dueOn) - now) / DAY);
  out.settled = b.status === 'PAID';
  return out;
}

export async function syncBillDue(b, account = null) {
  const a = account ?? await ServiceAccount.findById(b.accountId).lean();
  const open = ['DUE', 'PARTIALLY_PAID', 'PAYMENT_RECORDED', 'DISPUTED'].includes(b.status);
  const outstanding = Math.max(0, b.amountPaise - (b.confirmedPaidPaise ?? 0));
  const label = `${a?.name ?? b.category} bill${b.billNo ? ` ${b.billNo}` : ''}`;
  return syncDue(`bill:${b._id}:pay`, open ? {
    title: b.status === 'PAYMENT_RECORDED' ? `Confirm with the bank: payment of ${label}` : b.status === 'DISPUTED' ? `Resolve dispute: ${label}` : `Pay ${label} (${inr(outstanding)})`,
    department: 'FINANCE', category: 'BILL', dueAt: b.dueOn, ownerProfileId: b.ownerProfileId ? String(b.ownerProfileId) : a?.ownerProfileId ? String(a.ownerProfileId) : null,
    amountPaise: outstanding || null, leadDays: a?.leadDays ?? [7, 3, 0], severity: HIGH_IMPACT.includes(b.category) ? 'HIGH' : 'NORMAL',
    source: { entityType: 'Bill', entityId: b._id, link: `/bills?tab=bills&id=${b._id}` },
  } : null, { note: b.status === 'PAID' ? 'Paid and confirmed' : 'Bill closed' });
}

export async function createBill(actor, body = {}) {
  requireProfile(actor);
  const account = await ServiceAccount.findById(assertObjectId(body.accountId, 'accountId'));
  if (!account) throw new AppError('Service account not found', 404);
  const billDate = parseDate(body.billDate, 'billDate') ?? new Date();
  const dueOn = parseDate(body.dueOn, 'dueOn', { required: true });
  if (dueOn < new Date(billDate.getTime() - DAY)) throw new AppError('The due date is before the bill date.', 400);
  const billNo = optionalText(body.billNo, { max: 60 })?.toUpperCase() || null;
  if (billNo) {
    const dup = await Bill.findOne({ accountId: account._id, billNo, status: { $ne: 'CANCELLED' } }).select('refNo').lean();
    if (dup) throw new AppError(`Bill ${billNo} on this account is already recorded as ${dup.refNo}.`, 409, [], 'DUPLICATE_BILL');
  }
  const units = body.units === undefined || body.units === null || body.units === '' ? null : Number(body.units);
  if (units !== null && (!Number.isFinite(units) || units < 0)) throw new AppError('units must be a non-negative number', 400);
  const b = new Bill({
    refNo: await nextRef('BIL'), accountId: account._id, category: account.category, vendorId: account.vendorId, vendorName: account.vendorName,
    billNo, billDate, dueOn, periodFrom: parseDate(body.periodFrom, 'periodFrom'), periodTo: parseDate(body.periodTo, 'periodTo'),
    amountPaise: asPaise(body.amountPaise, 'amountPaise'), taxPaise: asPaise(body.taxPaise ?? 0, 'taxPaise'),
    units, unitLabel: units !== null ? account.consumptionUnit ?? optionalText(body.unitLabel, { max: 20 }) ?? null : null,
    attachments: cleanAttachments(body.attachments, actor), ownerProfileId: account.ownerProfileId,
    purchaseRequestId: body.purchaseRequestId ? assertObjectId(body.purchaseRequestId, 'purchaseRequestId') : null,
  });
  if (!b.amountPaise) throw new AppError('amountPaise must be more than zero', 400);
  b.status = statusOf(b);
  pushHistory(b, actor, 'RECORDED', { to: b.status });
  await b.save();
  // The account's next expected bill moves on one cycle from this one.
  const months = CYCLE_MONTHS[account.billingCycle];
  if (months && (!account.nextDueOn || dueOn >= new Date(account.nextDueOn.getTime() - 20 * DAY))) {
    account.nextDueOn = addMonths(dueOn, months);
    pushHistory(account, actor, 'NEXT_BILL_EXPECTED', { note: account.nextDueOn.toISOString().slice(0, 10) });
    await account.save();
  }
  await safely(syncBillDue(b.toObject(), account.toObject()), 'bill');
  await safely(syncAccountDue(account.toObject()), 'account');
  return presentBill(b.toObject());
}

async function loadBill(id) {
  const b = await Bill.findById(assertObjectId(id));
  if (!b) throw new AppError('Bill not found', 404);
  return b;
}

/** A payment someone says was made. It does not settle the bill until it is confirmed. */
export async function recordPayment(actor, id, body = {}) {
  requireProfile(actor);
  const b = await loadBill(id);
  if (['CANCELLED', 'PAID'].includes(b.status)) throw new AppError(`This bill is ${b.status.toLowerCase()}.`, 409);
  const amount = asPaise(body.amountPaise, 'amountPaise');
  if (!amount) throw new AppError('amountPaise must be more than zero', 400);
  const live = b.payments.filter((p) => p.status !== 'REJECTED').reduce((n, p) => n + p.amountPaise, 0);
  if (live + amount > b.amountPaise) throw new AppError(`That would pay ${inr(live + amount)} against a bill of ${inr(b.amountPaise)}.`, 409, [], 'OVERPAYMENT');
  b.payments.push({
    amountPaise: amount, mode: oneOf(body.mode, ['BANK', 'UPI', 'CHEQUE', 'CASH', 'CARD', 'AUTO_DEBIT', 'OTHER'], 'mode'),
    reference: optionalText(body.reference, { max: 120 }) || null, paidOn: parseDate(body.paidOn, 'paidOn') ?? new Date(),
    evidence: cleanAttachments(body.evidence, actor), recordedByProfileId: actor.profileId, recordedByName: actor.displayName ?? null,
    note: optionalText(body.note, { max: 500 }) || null,
  });
  const from = b.status;
  b.status = statusOf(b);
  pushHistory(b, actor, 'PAYMENT_RECORDED', { from, to: b.status, note: `${inr(amount)}${b.payments.at(-1).evidence.length ? '' : ' — no evidence attached'}` });
  await b.save();
  await safely(syncBillDue(b.toObject()), 'bill');
  return presentBill(b.toObject());
}

/** A different person confirms (or rejects) a recorded payment against the bank statement. */
export async function confirmPayment(actor, id, paymentId, body = {}) {
  requireProfile(actor);
  const b = await loadBill(id);
  const p = b.payments.id(assertObjectId(paymentId, 'paymentId'));
  if (!p) throw new AppError('Payment not found', 404);
  if (p.status !== 'RECORDED') throw new AppError(`This payment is already ${p.status.toLowerCase()}.`, 409);
  if (String(p.recordedByProfileId) === String(actor.profileId)) throw new AppError('A different person confirms the payment from the bank statement.', 403, [], 'SAME_PERSON');
  const decision = oneOf(body.decision, ['CONFIRM', 'REJECT'], 'decision', 'CONFIRM');
  if (decision === 'CONFIRM') {
    p.status = 'CONFIRMED';
    p.bankReference = requireText(body.bankReference, 'bankReference (UTR / statement line)', { max: 120 });
    p.confirmedAt = new Date();
    p.confirmedByProfileId = actor.profileId;
  } else {
    p.status = 'REJECTED';
    p.note = requireText(body.reason, 'reason', { max: 500 });
    p.confirmedByProfileId = actor.profileId;
    p.confirmedAt = new Date();
  }
  const from = b.status;
  b.status = statusOf(b);
  if (b.status === 'PAID') b.settledAt = new Date();
  pushHistory(b, actor, decision === 'CONFIRM' ? 'PAYMENT_CONFIRMED' : 'PAYMENT_REJECTED', { from, to: b.status, note: decision === 'CONFIRM' ? p.bankReference : p.note });
  await b.save();
  await safely(syncBillDue(b.toObject()), 'bill');
  return presentBill(b.toObject());
}

/** Dispute, withdraw a dispute, or cancel (a wrong bill) — always with a reason; nothing is deleted. */
export async function setBillStatus(actor, id, body = {}) {
  const b = await loadBill(id);
  const action = oneOf(body.action, ['DISPUTE', 'RESOLVE_DISPUTE', 'CANCEL'], 'action');
  const reason = requireText(body.reason, 'reason', { max: 1000 });
  const from = b.status;
  if (action === 'DISPUTE') {
    if (['PAID', 'CANCELLED'].includes(b.status)) throw new AppError(`A ${b.status.toLowerCase()} bill cannot be disputed.`, 409);
    b.status = 'DISPUTED'; b.disputeNote = reason;
  } else if (action === 'RESOLVE_DISPUTE') {
    if (b.status !== 'DISPUTED') throw new AppError('This bill is not disputed.', 409);
    b.status = 'DUE'; b.status = statusOf(b);
    if (body.revisedAmountPaise !== undefined) {
      // A revised bill from the provider: the old amount stays in the history.
      const revised = asPaise(body.revisedAmountPaise, 'revisedAmountPaise');
      if (revised < b.recordedPaidPaise) throw new AppError('The revised amount is less than what has already been paid.', 409);
      pushHistory(b, actor, 'AMOUNT_REVISED', { from: String(b.amountPaise), to: String(revised), note: reason });
      b.amountPaise = revised;
      b.status = statusOf(b);
    }
  } else {
    if (b.payments.some((p) => p.status !== 'REJECTED')) throw new AppError('A bill with payments against it cannot be cancelled; dispute it instead.', 409);
    b.status = 'CANCELLED';
  }
  pushHistory(b, actor, action, { from, to: b.status, note: reason });
  await b.save();
  await safely(syncBillDue(b.toObject()), 'bill');
  return presentBill(b.toObject());
}

export async function listBills(actor, query = {}) {
  requireProfile(actor);
  const filter = {};
  if (query.accountId) filter.accountId = assertObjectId(query.accountId, 'accountId');
  if (query.category) filter.category = oneOf(query.category, BILL_CATEGORIES, 'category');
  if (query.status === 'open') filter.status = { $in: ['DUE', 'PARTIALLY_PAID', 'PAYMENT_RECORDED', 'DISPUTED'] };
  else if (query.status === 'overdue') { filter.status = { $in: ['DUE', 'PARTIALLY_PAID', 'DISPUTED'] }; filter.dueOn = { $lt: new Date() }; }
  else if (query.status === 'unconfirmed') filter['payments.status'] = 'RECORDED';
  else if (query.status) filter.status = oneOf(query.status, ['DUE', 'PARTIALLY_PAID', 'PAYMENT_RECORDED', 'PAID', 'DISPUTED', 'CANCELLED'], 'status');
  const from = parseDate(query.from, 'from');
  const to = parseDate(query.to, 'to');
  if (from || to) filter.billDate = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
  const { page, pageSize, skip } = pageArgs(query);
  const [rows, total] = await Promise.all([Bill.find(filter).sort({ dueOn: query.status === 'open' || query.status === 'overdue' ? 1 : -1 }).skip(skip).limit(pageSize).select('-history').lean(), Bill.countDocuments(filter)]);
  const accounts = new Map((await ServiceAccount.find({ _id: { $in: rows.map((r) => r.accountId) } }).select('name accountNo').lean()).map((a) => [String(a._id), a]));
  const tasks = new Map((await DueItem.find({ 'source.entityType': 'Bill', 'source.entityId': { $in: rows.map((r) => r._id) }, status: { $in: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED'] } }).select('source status snoozeReason snoozedUntil escalationLevel').lean()).map((t) => [String(t.source.entityId), t]));
  return {
    items: rows.map((r) => {
      const t = tasks.get(String(r._id));
      return { ...presentBill(r), accountName: accounts.get(String(r.accountId))?.name ?? null, accountNo: accounts.get(String(r.accountId))?.accountNo ?? null, task: t ? { id: String(t._id), status: t.status, snoozeReason: t.snoozeReason, snoozedUntil: t.snoozedUntil, escalationLevel: t.escalationLevel } : null };
    }),
    total, page, pageSize,
  };
}

export async function getBill(actor, id) {
  requireProfile(actor);
  const b = (await loadBill(id)).toObject();
  const account = await ServiceAccount.findById(b.accountId).select('name accountNo category billingCycle').lean();
  return { ...presentBill(b), history: b.history, account: account ? dto(account) : null };
}

// ── Service visits (AMC) ─────────────────────────────────────────────────

async function syncVisitDue(v, a) {
  const on = v.status === 'SCHEDULED';
  return syncDue(`visit:${v._id}`, on ? {
    title: `Service visit: ${a.name}${a.vendorName ? ` (${a.vendorName})` : ''}`, department: a.category === 'SOFTWARE' ? 'IT' : 'FACILITIES', category: 'SERVICE',
    dueAt: v.scheduledOn, ownerProfileId: a.ownerProfileId ? String(a.ownerProfileId) : null, requiresEvidence: true, leadDays: [7, 1, 0],
    description: 'Close the visit in Bills → Services with the service report or photos; the next visit is scheduled from it.',
    source: { entityType: 'ServiceVisit', entityId: v._id, link: `/bills?tab=services&id=${a._id}` },
  } : null, { note: `Visit ${v.status.toLowerCase()}` });
}

async function scheduleVisit(actor, account, scheduledOn, previous = null) {
  const v = new ServiceVisit({ refNo: await nextRef('SVV'), accountId: account._id, scheduledOn, previousVisitId: previous?._id ?? null });
  pushHistory(v, actor, 'SCHEDULED', { note: scheduledOn.toISOString().slice(0, 10) });
  await v.save();
  await safely(syncVisitDue(v.toObject(), account), 'visit');
  return v;
}

export async function createVisit(actor, accountId, body = {}) {
  const a = await ServiceAccount.findById(assertObjectId(accountId, 'accountId')).lean();
  if (!a) throw new AppError('Service account not found', 404);
  const v = await scheduleVisit(actor, a, parseDate(body.scheduledOn, 'scheduledOn', { required: true }));
  return dto(v.toObject());
}

/** Visit done with evidence; the next visit is scheduled from the account's visits per year. */
export async function completeVisit(actor, id, body = {}) {
  const v = await ServiceVisit.findById(assertObjectId(id));
  if (!v) throw new AppError('Visit not found', 404);
  if (v.status !== 'SCHEDULED') throw new AppError(`This visit is ${v.status.toLowerCase()}.`, 409);
  const a = await ServiceAccount.findById(v.accountId).lean();
  const outcome = oneOf(body.outcome, ['DONE', 'MISSED', 'CANCELLED'], 'outcome', 'DONE');
  if (outcome === 'DONE') {
    const evidence = cleanAttachments(body.evidence, actor);
    if (!evidence.length) throw new AppError('Attach the service report, checklist or photos.', 400, [], 'EVIDENCE_REQUIRED');
    v.evidence.push(...evidence);
    v.doneOn = parseDate(body.doneOn, 'doneOn') ?? new Date();
    v.technician = optionalText(body.technician, { max: 120 }) || null;
    v.findings = optionalText(body.findings, { max: 4000 }) || null;
  } else v.findings = requireText(body.reason, 'reason', { max: 1000 });
  v.status = outcome;
  pushHistory(v, actor, outcome, { from: 'SCHEDULED', to: outcome, note: v.findings });
  let next = null;
  if (outcome !== 'CANCELLED' && a?.visitsPerYear && a.status === 'ACTIVE') {
    const base = outcome === 'DONE' ? v.doneOn : v.scheduledOn;
    const nextOn = outcome === 'MISSED' ? new Date(Date.now() + 7 * DAY) : addMonths(base, Math.max(1, Math.round(12 / a.visitsPerYear)));
    if (!a.contractEndsOn || nextOn <= new Date(a.contractEndsOn)) {
      next = await scheduleVisit(actor, a, nextOn, v);
      v.nextVisitId = next._id;
    }
  }
  await v.save();
  await safely(syncVisitDue(v.toObject(), a), 'visit');
  return { visit: dto(v.toObject()), next: next ? dto(next.toObject()) : null };
}

export async function listVisits(actor, query = {}) {
  requireProfile(actor);
  const filter = {};
  if (query.accountId) filter.accountId = assertObjectId(query.accountId, 'accountId');
  if (query.status) filter.status = oneOf(query.status, ['SCHEDULED', 'DONE', 'MISSED', 'CANCELLED'], 'status');
  const rows = await ServiceVisit.find(filter).sort({ scheduledOn: query.status === 'SCHEDULED' ? 1 : -1 }).limit(500).select('-history').lean();
  const accounts = new Map((await ServiceAccount.find({ _id: { $in: rows.map((r) => r.accountId) } }).select('name vendorName category').lean()).map((a) => [String(a._id), a]));
  return rows.map((r) => ({ ...dto(r), accountName: accounts.get(String(r.accountId))?.name ?? null, vendorName: accounts.get(String(r.accountId))?.vendorName ?? null, overdue: r.status === 'SCHEDULED' && new Date(r.scheduledOn) < new Date() }));
}

/** The daily pass: every open bill, expected bill and scheduled visit has its task. Idempotent. */
export async function runBillsDue() {
  let bills = 0; let accounts = 0; let visits = 0;
  const accts = await ServiceAccount.find({}).lean();
  const byId = new Map(accts.map((a) => [String(a._id), a]));
  for (const a of accts) { await syncAccountDue(a); accounts += 1; } // eslint-disable-line no-await-in-loop
  for (const b of await Bill.find({ status: { $in: ['DUE', 'PARTIALLY_PAID', 'PAYMENT_RECORDED', 'DISPUTED'] } }).lean()) { await syncBillDue(b, byId.get(String(b.accountId))); bills += 1; } // eslint-disable-line no-await-in-loop
  for (const v of await ServiceVisit.find({ status: 'SCHEDULED' }).lean()) { if (byId.get(String(v.accountId))) { await syncVisitDue(v, byId.get(String(v.accountId))); visits += 1; } } // eslint-disable-line no-await-in-loop
  return { bills, accounts, visits };
}
