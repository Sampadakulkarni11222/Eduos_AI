import { Invoice, InvoiceLine, Payment, FeeStructure, FeeHead, FeePlan } from '../../models/fee.model.js';
import { Enrollment, Student, StudentGuardian } from '../../models/student.model.js';
import { CashClose, DENOMINATIONS } from '../../models/p4People.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { periodFromDates, localDate, DEFAULT_TZ } from '../../utils/periods.js';
import { sendOperational } from '../messaging/messaging.service.js';
import { assertObjectId, optionalText, profileNames, pushHistory, requireProfile } from '../ops/common.js';
import { classLabel, studentLabel, istYmd, istHm } from '../ptm/relations.js';
import { plural } from '../../utils/plural.js';

/**
 * The bursar's reports (part 4, finance audit). Everything here is computed on
 * the server from the same rows the Payments page and the Tally export use, so
 * the numbers agree:
 *
 *   collectionReport   receipts for a date range by day, mode, cashier, fee head
 *                      and class, with refunds and what is still awaiting approval
 *   dayBookCsv         the receipt register for the range, one row per receipt
 *   ageing             overdue fees per student in 0-30 / 31-60 / 61-90 / 90+ day buckets
 *   anomalies          rows an auditor would ask about, each with its evidence
 *   cash close         the counter's day-end count against the system's cash
 *   sendReminders      the FEE_REMINDER message to the families chosen (confirmed by a person)
 *
 * "Collected" means what the ledger credits: a payment that is PUBLISHED and
 * SUCCESS or (later) REFUNDED, dated by when the money changed hands (paidOn,
 * else when it was keyed in). CANCELLED invoices are never counted as billed.
 */

const DAY = 86_400_000;
const MODES = ['CASH', 'UPI', 'BANK', 'CHEQUE', 'DD', 'GATEWAY'];
const MODE_LABEL = { CASH: 'Cash', UPI: 'UPI', BANK: 'Bank transfer', CHEQUE: 'Cheque', DD: 'Demand draft', GATEWAY: 'Online (gateway)' };
const BUCKETS = [
  { key: '0-30', min: 1, max: 30 }, { key: '31-60', min: 31, max: 60 },
  { key: '61-90', min: 61, max: 90 }, { key: '90+', min: 91, max: Infinity },
];
const inr = (p) => `₹${(Number(p ?? 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  // A cell starting with = + - @ would run as a formula in Excel.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n');

function rangeOf(query = {}) {
  const today = istYmd(new Date());
  const from = query.from ? String(query.from) : `${today.slice(0, 8)}01`;
  const to = query.to ? String(query.to) : today;
  const p = periodFromDates(from, to, { tz: DEFAULT_TZ });
  if (p.days > 400) throw new AppError('Choose a range of at most 400 days.', 400, [], 'RANGE_TOO_LONG');
  return p;
}

const dayOf = (d) => istYmd(d);
const whenPaid = (p) => p.paidOn ?? p.createdAt;

/** Student, admission number and class for a set of enrolments. */
async function enrolmentInfo(enrollmentIds) {
  const ids = [...new Set(enrollmentIds.filter(Boolean).map(String))];
  const rows = await Enrollment.find({ _id: { $in: ids } })
    .populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } }).select('studentId sectionId').lean();
  const students = new Map((await Student.find({ _id: { $in: rows.map((r) => r.studentId) } }).select('firstName lastName admissionNo').lean()).map((s) => [String(s._id), s]));
  return new Map(rows.map((e) => {
    const s = students.get(String(e.studentId));
    return [String(e._id), { studentId: String(e.studentId), name: studentLabel(s), admissionNo: s?.admissionNo ?? null, className: classLabel(e.sectionId) ?? 'Unassigned' }];
  }));
}

async function paymentsIn(period, extra = {}) {
  const inRange = { $gte: period.start, $lt: period.end };
  return Payment.find({ ...extra, $or: [{ paidOn: inRange }, { paidOn: null, createdAt: inRange }] }).lean();
}

const credited = (p) => p.recordStatus === 'PUBLISHED' && ['SUCCESS', 'REFUNDED'].includes(p.status);

/** Fee-head share of each invoice, so a receipt can be shown head-wise (pro rata to the invoice's lines). */
async function headShares(invoiceIds) {
  const lines = await InvoiceLine.find({ invoiceId: { $in: invoiceIds } }).select('invoiceId feeStructureId description amountPaise concessionPaise taxPaise').lean();
  const structures = new Map((await FeeStructure.find({ _id: { $in: lines.map((l) => l.feeStructureId).filter(Boolean) } }).select('feeHeadId').lean()).map((s) => [String(s._id), String(s.feeHeadId)]));
  const heads = new Map((await FeeHead.find().select('name').lean()).map((h) => [String(h._id), h.name]));
  const byInvoice = new Map();
  for (const l of lines) {
    const head = heads.get(structures.get(String(l.feeStructureId))) ?? l.description ?? 'Other';
    const amt = Math.max(0, (l.amountPaise ?? 0) - (l.concessionPaise ?? 0) + (l.taxPaise ?? 0));
    const m = byInvoice.get(String(l.invoiceId)) ?? new Map();
    m.set(head, (m.get(head) ?? 0) + amt);
    byInvoice.set(String(l.invoiceId), m);
  }
  return byInvoice;
}

function add(map, key, amount, label = key) {
  const row = map.get(key) ?? { key, label, count: 0, amountPaise: 0 };
  row.count += 1; row.amountPaise += amount;
  map.set(key, row);
}

export async function collectionReport(actor, query = {}) {
  requireProfile(actor);
  const period = rangeOf(query);
  const rows = await paymentsIn(period);
  const ok = rows.filter(credited);
  const pending = rows.filter((p) => p.recordStatus === 'PENDING_ADMIN_APPROVAL');
  const invoices = new Map((await Invoice.find({ _id: { $in: ok.map((p) => p.invoiceId) } }).select('enrollmentId invoiceNo').lean()).map((i) => [String(i._id), i]));
  const info = await enrolmentInfo([...invoices.values()].map((i) => i.enrollmentId));
  const cashiers = await profileNames(ok.map((p) => p.createdByProfileId));
  const shares = await headShares([...invoices.keys()]);

  const byMode = new Map(); const byDay = new Map(); const byCashier = new Map(); const byClass = new Map(); const byHead = new Map();
  let total = 0;
  for (const p of ok) {
    total += p.amountPaise;
    add(byMode, p.mode, p.amountPaise, MODE_LABEL[p.mode] ?? p.mode);
    add(byDay, dayOf(whenPaid(p)), p.amountPaise);
    const cashier = p.mode === 'GATEWAY' ? 'Online (no cashier)' : (cashiers.get(String(p.createdByProfileId)) ?? 'Not recorded');
    add(byCashier, cashier, p.amountPaise);
    const inv = invoices.get(String(p.invoiceId));
    add(byClass, info.get(String(inv?.enrollmentId))?.className ?? 'Unassigned', p.amountPaise);
    const share = shares.get(String(p.invoiceId));
    const whole = share ? [...share.values()].reduce((a, b) => a + b, 0) : 0;
    if (!share || !whole) { add(byHead, 'Unallocated', p.amountPaise); continue; }
    // Largest-remainder split so the head-wise column adds up to the receipt exactly.
    let left = p.amountPaise; const entries = [...share.entries()];
    entries.forEach(([head, amt], i) => {
      const part = i === entries.length - 1 ? left : Math.floor((p.amountPaise * amt) / whole);
      left -= part;
      const row = byHead.get(head) ?? { key: head, label: head, count: 0, amountPaise: 0 };
      row.count += 1; row.amountPaise += part; byHead.set(head, row);
    });
  }
  const refunds = [];
  for (const p of await Payment.find({ 'refunds.status': 'COMPLETED', 'refunds.decidedAt': { $gte: period.start, $lt: period.end } }).lean()) {
    for (const r of p.refunds ?? []) {
      if (r.status === 'COMPLETED' && r.decidedAt >= period.start && r.decidedAt < period.end) refunds.push({ receiptNo: p.receiptNo ?? null, voucherNo: r.voucherNo, amountPaise: r.amountPaise, mode: r.mode, on: dayOf(r.decidedAt), reason: r.reason });
    }
  }
  const refundTotal = refunds.reduce((n, r) => n + r.amountPaise, 0);
  const sorted = (m) => [...m.values()].sort((a, b) => b.amountPaise - a.amountPaise);
  return {
    range: { from: period.from, to: period.to, days: period.days },
    totals: { receipts: ok.length, collectedPaise: total, refundsPaise: refundTotal, netPaise: total - refundTotal },
    pendingApproval: { count: pending.length, amountPaise: pending.reduce((n, p) => n + p.amountPaise, 0) },
    byMode: MODES.map((m) => byMode.get(m) ?? { key: m, label: MODE_LABEL[m], count: 0, amountPaise: 0 }).filter((r) => r.count),
    byDay: [...byDay.values()].sort((a, b) => a.key.localeCompare(b.key)),
    byCashier: sorted(byCashier),
    byHead: sorted(byHead),
    byClass: sorted(byClass),
    refunds,
    notes: [
      'Collected = payments credited to the ledger (published), dated by when the money was received.',
      'Fee-head amounts split each receipt pro rata over its invoice lines (after concession, with tax).',
      pending.length ? `${plural(pending.length, 'payment')} of ${inr(pending.reduce((n, p) => n + p.amountPaise, 0))} ${pending.length === 1 ? 'is' : 'are'} awaiting approval and are not counted yet.` : null,
    ].filter(Boolean),
  };
}

/** The receipt register (day book) for the range, as CSV. */
export async function dayBookCsv(actor, query = {}) {
  requireProfile(actor);
  const period = rangeOf(query);
  const rows = (await paymentsIn(period)).filter((p) => p.recordStatus !== 'REJECTED' && p.status !== 'FAILED' && p.status !== 'INITIATED')
    .sort((a, b) => whenPaid(a) - whenPaid(b));
  const invoices = new Map((await Invoice.find({ _id: { $in: rows.map((p) => p.invoiceId) } }).select('enrollmentId invoiceNo').lean()).map((i) => [String(i._id), i]));
  const info = await enrolmentInfo([...invoices.values()].map((i) => i.enrollmentId));
  const cashiers = await profileNames(rows.map((p) => p.createdByProfileId));
  const out = [['Date', 'Time', 'Receipt no', 'Student', 'Admission no', 'Class', 'Invoice no', 'Mode', 'Reference / UTR / cheque', 'Amount (Rs)', 'Ledger status', 'Recorded by']];
  for (const p of rows) {
    const inv = invoices.get(String(p.invoiceId)); const s = info.get(String(inv?.enrollmentId));
    out.push([dayOf(whenPaid(p)), istHm(whenPaid(p)), p.receiptNo ?? '', s?.name ?? '', s?.admissionNo ?? '', s?.className ?? '', inv?.invoiceNo ?? '', MODE_LABEL[p.mode] ?? p.mode,
      p.instrument?.referenceNo ?? p.instrument?.number ?? p.gatewayRef ?? '', (p.amountPaise / 100).toFixed(2),
      p.recordStatus === 'PUBLISHED' ? (p.status === 'REFUNDED' ? 'Refunded' : 'Credited') : 'Awaiting approval', cashiers.get(String(p.createdByProfileId)) ?? (p.mode === 'GATEWAY' ? 'Online' : '')]);
  }
  await recordAudit({ actor, action: 'fees.daybook.exported', entityType: 'Payment', entityId: null, after: { from: period.from, to: period.to, rows: rows.length } });
  return { filename: `day-book-${period.from}-to-${period.to}.csv`, csv: toCsv(out) };
}

// ── ageing and reminders ─────────────────────────────────────────────────

const bucketOf = (days) => BUCKETS.find((b) => days >= b.min && days <= b.max)?.key ?? null;

export async function ageing(actor, query = {}) {
  requireProfile(actor);
  const asOf = query.asOf ? periodFromDates(String(query.asOf), String(query.asOf)).end : new Date();
  const asOfDay = istYmd(new Date(asOf.getTime() - 1));
  const open = await Invoice.find({ status: { $nin: ['PAID', 'CANCELLED'] }, dueOn: { $lt: asOf } }).select('enrollmentId invoiceNo totalPaise paidPaise dueOn').lean();
  const byEnrolment = new Map();
  for (const inv of open) {
    const due = (inv.totalPaise ?? 0) - (inv.paidPaise ?? 0);
    if (due <= 0) continue;
    const days = Math.max(1, Math.floor((asOf - new Date(inv.dueOn)) / DAY));
    const row = byEnrolment.get(String(inv.enrollmentId)) ?? { enrollmentId: String(inv.enrollmentId), invoices: [], outstandingPaise: 0, oldestDue: null, daysOverdue: 0 };
    row.invoices.push({ invoiceNo: inv.invoiceNo, duePaise: due, dueOn: istYmd(inv.dueOn), daysOverdue: days });
    row.outstandingPaise += due;
    if (days > row.daysOverdue) { row.daysOverdue = days; row.oldestDue = istYmd(inv.dueOn); }
    byEnrolment.set(String(inv.enrollmentId), row);
  }
  const info = await enrolmentInfo([...byEnrolment.keys()]);
  const enrolIds = [...byEnrolment.keys()];
  const plans = new Set((await FeePlan.find({ enrollmentId: { $in: enrolIds }, status: { $in: ['APPROVED', 'PUBLISHED'] } }).select('enrollmentId').lean()).map((p) => String(p.enrollmentId)));
  // Last credited payment per enrolment: the "has this family paid anything lately" column.
  const allInvoices = await Invoice.find({ enrollmentId: { $in: enrolIds } }).select('_id enrollmentId').lean();
  const invToEnrol = new Map(allInvoices.map((i) => [String(i._id), String(i.enrollmentId)]));
  const lastPaid = new Map();
  for (const p of await Payment.find({ invoiceId: { $in: allInvoices.map((i) => i._id) }, recordStatus: 'PUBLISHED', status: 'SUCCESS' }).select('invoiceId paidOn createdAt').lean()) {
    const e = invToEnrol.get(String(p.invoiceId)); const at = whenPaid(p);
    if (!lastPaid.has(e) || lastPaid.get(e) < at) lastPaid.set(e, at);
  }
  let rows = [...byEnrolment.values()].map((r) => ({
    ...r, ...info.get(r.enrollmentId), bucket: bucketOf(r.daysOverdue), onPlan: plans.has(r.enrollmentId),
    lastPaidOn: lastPaid.has(r.enrollmentId) ? istYmd(lastPaid.get(r.enrollmentId)) : null,
  }));
  if (query.bucket) rows = rows.filter((r) => r.bucket === query.bucket);
  if (query.className) rows = rows.filter((r) => String(r.className).toLowerCase() === String(query.className).toLowerCase());
  rows.sort((a, b) => b.daysOverdue - a.daysOverdue || b.outstandingPaise - a.outstandingPaise);
  const buckets = BUCKETS.map((b) => {
    const inB = rows.filter((r) => r.bucket === b.key);
    return { key: b.key, students: inB.length, amountPaise: inB.reduce((n, r) => n + r.outstandingPaise, 0) };
  });
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 200, 1), 2000);
  return {
    asOf: asOfDay, buckets,
    totals: { students: rows.length, amountPaise: rows.reduce((n, r) => n + r.outstandingPaise, 0) },
    items: rows.slice(0, limit), total: rows.length,
  };
}

export async function ageingCsv(actor, query = {}) {
  const a = await ageing(actor, { ...query, limit: 2000 });
  const out = [['Student', 'Admission no', 'Class', 'Outstanding (Rs)', 'Oldest due', 'Days overdue', 'Bucket', 'Invoices', 'On a fee plan', 'Last paid on']];
  for (const r of a.items) out.push([r.name, r.admissionNo, r.className, (r.outstandingPaise / 100).toFixed(2), r.oldestDue, r.daysOverdue, r.bucket, r.invoices.map((i) => i.invoiceNo).join(' '), r.onPlan ? 'Yes' : 'No', r.lastPaidOn ?? '']);
  await recordAudit({ actor, action: 'fees.ageing.exported', entityType: 'Invoice', entityId: null, after: { asOf: a.asOf, rows: a.items.length } });
  return { filename: `fee-ageing-${a.asOf}.csv`, csv: toCsv(out) };
}

/**
 * Who a reminder would go to, without sending: the overdue students chosen
 * (by bucket, class or names) and the guardians on file. Families on an
 * approved fee plan are left out unless asked for, and so are students
 * reminded in the last 7 days (the message is idempotent per week).
 */
export async function reminderPreview(actor, body = {}) {
  const a = await ageing(actor, { bucket: body.bucket, className: body.className, limit: 2000 });
  let rows = a.items;
  if (Array.isArray(body.studentIds) && body.studentIds.length) {
    const want = new Set(body.studentIds.map((id) => assertObjectId(id, 'studentIds')));
    rows = rows.filter((r) => want.has(r.studentId));
  }
  if (Number(body.minDays) > 0) rows = rows.filter((r) => r.daysOverdue >= Number(body.minDays));
  if (!body.includePlans) rows = rows.filter((r) => !r.onPlan);
  rows = rows.slice(0, 500);
  const guardians = await StudentGuardian.find({ studentId: { $in: rows.map((r) => r.studentId) } }).select('studentId guardianProfileId').lean();
  const byStudent = new Map();
  for (const g of guardians) byStudent.set(String(g.studentId), [...(byStudent.get(String(g.studentId)) ?? []), String(g.guardianProfileId)]);
  const items = rows.map((r) => ({ studentId: r.studentId, name: r.name, className: r.className, outstandingPaise: r.outstandingPaise, oldestDue: r.oldestDue, daysOverdue: r.daysOverdue, guardians: (byStudent.get(r.studentId) ?? []).length }));
  return {
    asOf: a.asOf, students: items.length, withoutGuardian: items.filter((i) => !i.guardians).length,
    amountPaise: items.reduce((n, i) => n + i.outstandingPaise, 0), items,
    message: 'A fee payment is due on <oldest due date>. Please check the Payments page in EduOS.',
    guardianIds: byStudent,
  };
}

const weekKey = (d = new Date()) => { const l = localDate(d); const t = Date.UTC(l.y, l.m - 1, l.d); return `${l.y}-w${Math.floor((t - Date.UTC(l.y, 0, 1)) / (7 * DAY))}`; };

export async function sendReminders(actor, body = {}) {
  requireProfile(actor);
  const preview = await reminderPreview(actor, body);
  if (body.dryRun) { const { guardianIds: _g, ...rest } = preview; return { ...rest, sent: 0, dryRun: true }; }
  if (!preview.items.length) throw new AppError('No overdue family matches that choice.', 404, [], 'NOTHING_TO_SEND');
  let sent = 0;
  const week = weekKey();
  for (const s of preview.items) {
    const ids = preview.guardianIds.get(s.studentId) ?? [];
    if (!ids.length) continue;
    // eslint-disable-next-line no-await-in-loop
    await sendOperational({
      templateKey: 'FEE_REMINDER', recipientProfileIds: ids, variables: { dueOn: s.oldestDue }, link: '/payments',
      idempotencyKey: `fee:reminder:${s.studentId}:${week}`, relatedEntityType: 'Student', relatedEntityId: s.studentId, requestedBy: actor.profileId,
    });
    sent += 1;
  }
  await recordAudit({ actor, action: 'fees.reminders.sent', entityType: 'Invoice', entityId: null, after: { families: sent, bucket: body.bucket ?? null, className: body.className ?? null } });
  return { asOf: preview.asOf, students: preview.items.length, sent, skippedNoGuardian: preview.withoutGuardian, amountPaise: preview.amountPaise };
}

// ── anomalies ────────────────────────────────────────────────────────────

/**
 * Rows an auditor would ask about. Each flag names its rule and lists the
 * evidence; none of them says anything is wrong, only that it is worth a look.
 */
export async function anomalies(actor, query = {}) {
  requireProfile(actor);
  const period = rangeOf(query);
  const rows = (await paymentsIn(period)).filter((p) => p.recordStatus !== 'REJECTED' && p.status !== 'FAILED' && p.status !== 'INITIATED');
  const invoices = new Map((await Invoice.find({ _id: { $in: rows.map((p) => p.invoiceId) } }).select('enrollmentId invoiceNo').lean()).map((i) => [String(i._id), i]));
  const info = await enrolmentInfo([...invoices.values()].map((i) => i.enrollmentId));
  const cashiers = await profileNames(rows.map((p) => p.createdByProfileId));
  const ev = (p, extra = {}) => {
    const inv = invoices.get(String(p.invoiceId));
    return { paymentId: String(p._id), receiptNo: p.receiptNo ?? null, student: info.get(String(inv?.enrollmentId))?.name ?? null, invoiceNo: inv?.invoiceNo ?? null, mode: p.mode, amountPaise: p.amountPaise, on: dayOf(whenPaid(p)), at: istHm(whenPaid(p)), recordedBy: cashiers.get(String(p.createdByProfileId)) ?? null, ...extra };
  };
  const flags = [];
  const push = (rule, title, why, evidence) => { if (evidence.length) flags.push({ rule, title, why, count: evidence.length, evidence: evidence.slice(0, 50) }); };

  // 1. The same instrument reference used on more than one receipt.
  const byRef = new Map();
  for (const p of rows) {
    const ref = String(p.instrument?.referenceNo ?? p.instrument?.number ?? '').trim();
    if (!ref || p.mode === 'CASH') continue;
    const key = `${p.mode}:${ref.toUpperCase()}`;
    byRef.set(key, [...(byRef.get(key) ?? []), p]);
  }
  push('DUPLICATE_REFERENCE', 'Same UTR / cheque number on more than one receipt', 'One bank transaction can only pay once; a repeated reference is usually a double entry.',
    [...byRef.entries()].filter(([, ps]) => ps.length > 1).flatMap(([key, ps]) => ps.map((p) => ev(p, { reference: key.split(':').slice(1).join(':') }))));

  // 2. s.269ST: cash of ₹2 lakh or more from one family in a day (the payment carries the warning).
  push('CASH_269ST', 'Cash at or above ₹2,00,000 from one family in a day', 'Income-tax Act s.269ST: a penalty equal to the amount may apply to the school.',
    rows.filter((p) => (p.warnings ?? []).some((w) => String(w).startsWith('CASH_LIMIT_269ST'))).map((p) => ev(p)));

  // 3. Counter receipts keyed outside office hours (before 07:00 or after 19:00) or on a Sunday.
  push('OUT_OF_HOURS', 'Counter receipt keyed outside office hours or on a Sunday', 'Counter money keyed late at night or on a holiday is worth matching to the cash book.',
    rows.filter((p) => p.mode !== 'GATEWAY').filter((p) => {
      const hm = istHm(p.createdAt); const dow = localDate(new Date(p.createdAt)).dow;
      return hm < '07:00' || hm >= '19:00' || dow === 0;
    }).map((p) => ev(p, { keyedAt: `${dayOf(p.createdAt)} ${istHm(p.createdAt)}` })));

  // 4. Back-dated entries: keyed more than 3 days after the date the money was received.
  push('BACKDATED', 'Receipt keyed more than 3 days after the money was received', 'Late entries break the day book and the cash close for that day.',
    rows.filter((p) => p.paidOn && (new Date(p.createdAt) - new Date(p.paidOn)) > 3 * DAY).map((p) => ev(p, { keyedOn: dayOf(p.createdAt), lagDays: Math.floor((new Date(p.createdAt) - new Date(p.paidOn)) / DAY) })));

  // 5. Round-figure cash of ₹50,000 or more (a common pattern behind unreceipted collections).
  push('LARGE_ROUND_CASH', 'Large round-figure cash receipts (₹50,000 or more)', 'Not wrong in itself; large cash is the first thing a statutory auditor samples.',
    rows.filter((p) => p.mode === 'CASH' && p.amountPaise >= 5_000_000 && p.amountPaise % 100_000 === 0).map((p) => ev(p)));

  // 6. Receipts dated on a day whose cash was already closed, keyed after the close.
  const closes = new Map((await CashClose.find({ day: { $gte: period.from, $lte: period.to } }).lean()).map((c) => [c.day, c]));
  push('AFTER_CLOSE', 'Cash receipt keyed after that day was closed', 'The closed count no longer matches the system; re-open the count or explain it.',
    rows.filter((p) => p.mode === 'CASH').filter((p) => { const c = closes.get(dayOf(whenPaid(p))); return c && new Date(p.createdAt) > new Date(c.createdAt); }).map((p) => ev(p)));

  return { range: { from: period.from, to: period.to }, checked: rows.length, flags, note: 'Flags are prompts to look, with the rows behind each; they are not findings. Nothing is changed.' };
}

// ── cash close ───────────────────────────────────────────────────────────

function closeView(c, extra = {}) {
  return {
    id: String(c._id), day: c.day, status: c.status, counts: c.counts, countedPaise: c.countedPaise, openingFloatPaise: c.openingFloatPaise,
    expectedCashPaise: c.expectedCashPaise, cashRefundsPaise: c.cashRefundsPaise, variancePaise: c.variancePaise, receiptCount: c.receiptCount,
    nonCash: c.nonCash, depositSlipNo: c.depositSlipNo, note: c.note,
    closedBy: c.closedBy?.name ?? null, closedAt: c.closedBy?.at ?? null, checkedBy: c.checkedBy?.name ?? null, checkedAt: c.checkedBy?.at ?? null,
    history: c.history ?? [], ...extra,
  };
}

/** What the system says the counter should hold for a day: cash received less cash refunds, and the other modes for the record. */
export async function expectedForDay(actor, day) {
  requireProfile(actor);
  const d = day ? String(day) : istYmd(new Date());
  const period = periodFromDates(d, d);
  const rows = (await paymentsIn(period)).filter((p) => p.recordStatus !== 'REJECTED' && ['SUCCESS', 'REFUNDED'].includes(p.status));
  const cash = rows.filter((p) => p.mode === 'CASH');
  const nonCash = {};
  for (const p of rows.filter((x) => x.mode !== 'CASH')) {
    const r = nonCash[p.mode] ?? { count: 0, amountPaise: 0 }; r.count += 1; r.amountPaise += p.amountPaise; nonCash[p.mode] = r;
  }
  let cashRefunds = 0;
  for (const p of await Payment.find({ 'refunds.status': 'COMPLETED', 'refunds.decidedAt': { $gte: period.start, $lt: period.end } }).lean()) {
    for (const r of p.refunds ?? []) if (r.status === 'COMPLETED' && r.mode === 'CASH' && r.decidedAt >= period.start && r.decidedAt < period.end) cashRefunds += r.amountPaise;
  }
  const cashIn = cash.reduce((n, p) => n + p.amountPaise, 0);
  return {
    day: d, cashReceipts: cash.length, cashInPaise: cashIn, cashRefundsPaise: cashRefunds, expectedCashPaise: cashIn - cashRefunds,
    awaitingApproval: cash.filter((p) => p.recordStatus === 'PENDING_ADMIN_APPROVAL').length,
    nonCash, denominations: DENOMINATIONS, existing: await CashClose.findOne({ day: d }).lean().then((c) => (c ? closeView(c) : null)),
  };
}

export async function closeDay(actor, body = {}) {
  requireProfile(actor);
  const exp = await expectedForDay(actor, body.day);
  if (exp.existing) throw new AppError(`The cash for ${exp.day} is already closed (by ${exp.existing.closedBy ?? 'someone'}).`, 409, [], 'ALREADY_CLOSED');
  if (exp.day > istYmd(new Date())) throw new AppError('You cannot close a day that has not happened yet.', 400);
  const counts = [];
  for (const c of Array.isArray(body.counts) ? body.counts : []) {
    const den = Number(c.denominationPaise); const n = Number(c.count);
    if (!DENOMINATIONS.includes(den)) throw new AppError(`Unknown note or coin: ${den / 100}`, 400);
    if (!Number.isInteger(n) || n < 0 || n > 100000) throw new AppError('Counts are whole numbers.', 400);
    if (n) counts.push({ denominationPaise: den, count: n });
  }
  const opening = Math.max(0, Number(body.openingFloatPaise) || 0);
  const counted = counts.reduce((s, c) => s + c.denominationPaise * c.count, 0);
  const variance = counted - opening - exp.expectedCashPaise;
  const note = optionalText(body.note, { max: 1000 }) || null;
  if (variance !== 0 && !note) throw new AppError(`The count is ${variance > 0 ? 'over' : 'short'} by ${inr(Math.abs(variance))}. Add a note explaining the difference before closing.`, 400, [], 'VARIANCE_NEEDS_NOTE');
  const doc = new CashClose({
    day: exp.day, counts, countedPaise: counted, openingFloatPaise: opening, expectedCashPaise: exp.expectedCashPaise, cashRefundsPaise: exp.cashRefundsPaise,
    variancePaise: variance, receiptCount: exp.cashReceipts, nonCash: exp.nonCash, depositSlipNo: optionalText(body.depositSlipNo, { max: 60 }) || null, note,
    closedBy: { profileId: actor.profileId, name: actor.displayName ?? null, at: new Date() },
  });
  pushHistory(doc, actor, 'CLOSED', { to: 'CLOSED', note: variance ? `Variance ${inr(variance)}` : 'Balanced' });
  await doc.save();
  await recordAudit({ actor, action: 'fees.cash.closed', entityType: 'CashClose', entityId: String(doc._id), after: { day: doc.day, counted, expected: exp.expectedCashPaise, variance } });
  return closeView(doc.toObject());
}

/** A second person (who holds payment approval) checks the count. The closer cannot check their own. */
export async function checkClose(actor, id, body = {}) {
  requireProfile(actor);
  const doc = await CashClose.findById(assertObjectId(id));
  if (!doc) throw new AppError('Cash close not found', 404);
  if (doc.status === 'CHECKED') throw new AppError('Already checked.', 409);
  if (String(doc.closedBy?.profileId) === String(actor.profileId)) throw new AppError('A second person checks the count; you closed this day.', 403, [], 'SECOND_PERSON_REQUIRED');
  doc.status = 'CHECKED';
  doc.checkedBy = { profileId: actor.profileId, name: actor.displayName ?? null, at: new Date() };
  pushHistory(doc, actor, 'CHECKED', { from: 'CLOSED', to: 'CHECKED', note: optionalText(body.note, { max: 500 }) || null });
  await doc.save();
  await recordAudit({ actor, action: 'fees.cash.checked', entityType: 'CashClose', entityId: String(doc._id), after: { day: doc.day } });
  return closeView(doc.toObject());
}

export async function listCloses(actor, query = {}) {
  requireProfile(actor);
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 31, 1), 366);
  const rows = await CashClose.find().sort({ day: -1 }).limit(limit).lean();
  return { items: rows.map((c) => closeView(c)) };
}

export const _test = { bucketOf, csvCell, weekKey };
