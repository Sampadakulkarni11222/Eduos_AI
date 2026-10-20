import { registerMetric } from '../catalogue.js';
import { Invoice, InvoiceLine, Payment } from '../../../models/fee.model.js';
import { Budget, PurchaseRequest, PayrollRun } from '../../../models/finance.model.js';
import { localDate } from '../../../utils/periods.js';
import { within, earliest, sum, pct, asOf, onRollAt, DAY } from './helpers.js';

/**
 * Finance. Billing is counted on the invoice date, cash on the payment date,
 * refunds on the date they were completed; the three are never mixed. Fee
 * records are held in Indian rupees (integer paise) and carry the school's
 * currency; every money figure states it.
 */

/** Receipts that are money actually received: successful (or later refunded) and published. */
const RECEIVED = { status: { $in: ['SUCCESS', 'REFUNDED'] }, recordStatus: 'PUBLISHED' };
const payDate = (p) => new Date(p.paidOn ?? p.createdAt);

async function receipts(ctx, p = ctx.period) {
  return ctx.memo(`pay:${p.from}:${p.to}`, () => Payment.find({
    ...RECEIVED,
    $or: [within('paidOn', p), { paidOn: null, ...within('createdAt', p) }],
  }).select('amountPaise paidOn createdAt invoiceId').lean());
}

async function refunds(ctx, p = ctx.period) {
  return ctx.memo(`ref:${p.from}:${p.to}`, async () => {
    const rows = await Payment.find({ refunds: { $elemMatch: { status: 'COMPLETED', decidedAt: { $gte: p.start, $lt: p.end } } } }).select('refunds').lean();
    return rows.flatMap((r) => r.refunds.filter((x) => x.status === 'COMPLETED' && x.decidedAt >= p.start && x.decidedAt < p.end).map((x) => ({ amountPaise: x.amountPaise, at: x.decidedAt })));
  });
}

const paymentsSince = (ctx) => ctx.memo('paySince', async () => {
  const [a, b] = await Promise.all([earliest(Payment, 'paidOn', RECEIVED), earliest(Payment, 'createdAt', RECEIVED)]);
  return [a, b].filter(Boolean).sort((x, y) => x - y)[0] ?? null;
});
const invoicesSince = (ctx) => ctx.memo('invSince', () => earliest(Invoice, 'createdAt'));

registerMetric({
  key: 'finance.billed', department: 'finance', label: 'Fees billed', trend: true,
  definition: 'Invoices raised in the period (net of concessions on their lines), excluding cancelled invoices. This is billing, not cash.',
  unit: 'paise', kind: 'flow', dateBasis: 'Invoice date (when the invoice was raised)', sources: ['Invoice'], link: '/fees', version: 1,
  since: invoicesSince,
  compute: async (ctx) => {
    const rows = await Invoice.find({ status: { $ne: 'CANCELLED' }, ...within('createdAt', ctx.period) }).select('totalPaise').lean();
    return { value: sum(rows, (r) => r.totalPaise), records: rows.length };
  },
  series: async (ctx, list) => {
    const rows = await Invoice.find({ status: { $ne: 'CANCELLED' }, ...within('createdAt', ctx.period) }).select('totalPaise createdAt').lean();
    return list.map((b) => sum(rows.filter((r) => r.createdAt >= b.start && r.createdAt < b.end), (r) => r.totalPaise));
  },
});

registerMetric({
  key: 'finance.collections_gross', department: 'finance', label: 'Fees received (gross)',
  definition: 'Fee payments received in the period: successful, published receipts by the date the money was paid. A receipt awaiting approval is not counted.',
  unit: 'paise', kind: 'flow', dateBasis: 'Payment date', sources: ['Payment'], link: '/fees', version: 1,
  since: paymentsSince,
  compute: async (ctx) => {
    const rows = await receipts(ctx);
    return { value: sum(rows, (r) => r.amountPaise), records: rows.length };
  },
});

registerMetric({
  key: 'finance.refunds', department: 'finance', label: 'Refunds paid out',
  definition: 'Fee refunds completed in the period, by the date they were completed. Pending refunds are not counted.',
  unit: 'paise', kind: 'flow', dateBasis: 'Refund completion date', sources: ['Payment.refunds'], link: '/fees', version: 1,
  since: paymentsSince,
  compute: async (ctx) => {
    const rows = await refunds(ctx);
    return { value: sum(rows, (r) => r.amountPaise), records: rows.length };
  },
});

registerMetric({
  key: 'finance.net_collections', department: 'finance', label: 'Net fee collections', headline: true, trend: true,
  definition: 'Fees received in the period by payment date, less refunds completed in the period. Cash basis, not billing.',
  numerator: 'Receipts − completed refunds', denominator: null,
  unit: 'paise', kind: 'flow', dateBasis: 'Payment date; refund completion date', sources: ['Payment'], link: '/fees', version: 1,
  since: paymentsSince,
  compute: async (ctx) => {
    const [pay, ref] = await Promise.all([receipts(ctx), refunds(ctx)]);
    const gross = sum(pay, (r) => r.amountPaise);
    const out = sum(ref, (r) => r.amountPaise);
    return { value: gross - out, records: pay.length + ref.length, detail: { grossPaise: gross, refundsPaise: out } };
  },
  series: async (ctx, list) => {
    const [pay, ref] = await Promise.all([receipts(ctx), refunds(ctx)]);
    return list.map((b) => sum(pay.filter((r) => payDate(r) >= b.start && payDate(r) < b.end), (r) => r.amountPaise)
      - sum(ref.filter((r) => r.at >= b.start && r.at < b.end), (r) => r.amountPaise));
  },
});

const AGEING = [['Not yet due', -Infinity, 0], ['1–30 days', 1, 30], ['31–60 days', 31, 60], ['61–90 days', 61, 90], ['Over 90 days', 91, Infinity]];

registerMetric({
  key: 'finance.outstanding', department: 'finance', label: 'Fees outstanding', headline: true,
  definition: 'For every invoice raised by the cut-off and not cancelled: its total less the payments received by the cut-off, plus refunds completed by then; never below zero. Aged by days past the due date at the cut-off.',
  numerator: 'Invoice totals − (receipts − refunds) as of cut-off', denominator: null,
  unit: 'paise', kind: 'stock', dateBasis: 'As of the last day of the period', sources: ['Invoice', 'Payment'], link: '/fees', version: 1,
  since: invoicesSince,
  compute: async (ctx) => {
    const cut = ctx.period.end;
    const invoices = await Invoice.find({ status: { $ne: 'CANCELLED' }, createdAt: { $lt: cut } }).select('totalPaise dueOn').lean();
    if (!invoices.length) return { value: 0, records: 0 };
    const pays = await Payment.find({ invoiceId: { $in: invoices.map((i) => i._id) }, ...RECEIVED }).select('invoiceId amountPaise paidOn createdAt refunds').lean();
    const paid = new Map();
    for (const p of pays) {
      if (payDate(p) >= cut) continue;
      const back = sum((p.refunds ?? []).filter((r) => r.status === 'COMPLETED' && r.decidedAt && r.decidedAt < cut), (r) => r.amountPaise);
      paid.set(String(p.invoiceId), (paid.get(String(p.invoiceId)) ?? 0) + p.amountPaise - back);
    }
    const buckets = AGEING.map(([label]) => ({ label, value: 0 }));
    let total = 0; let open = 0;
    for (const inv of invoices) {
      const due = Math.max(0, inv.totalPaise - (paid.get(String(inv._id)) ?? 0));
      if (!due) continue;
      total += due; open += 1;
      const late = Math.floor((cut.getTime() - new Date(inv.dueOn).getTime()) / DAY);
      const i = AGEING.findIndex(([, lo, hi]) => late >= lo && late <= hi);
      buckets[i < 0 ? 0 : i].value += due;
    }
    return { value: total, records: invoices.length, detail: { invoicesWithBalance: open }, breakdown: buckets };
  },
});

registerMetric({
  key: 'finance.concessions', department: 'finance', label: 'Concessions given',
  definition: 'Concessions on the lines of invoices raised in the period (cancelled invoices excluded). Invoice totals are already net of these.',
  unit: 'paise', kind: 'flow', dateBasis: 'Invoice date', sources: ['InvoiceLine', 'Invoice'], link: '/fees', version: 1,
  since: invoicesSince,
  compute: async (ctx) => {
    const inv = await Invoice.find({ status: { $ne: 'CANCELLED' }, ...within('createdAt', ctx.period) }).select('_id').lean();
    const lines = inv.length ? await InvoiceLine.find({ invoiceId: { $in: inv.map((i) => i._id) }, concessionPaise: { $gt: 0 } }).select('concessionPaise').lean() : [];
    return { value: sum(lines, (l) => l.concessionPaise), records: lines.length };
  },
});

/** The financial year containing an instant, named like budgets are ("2026-27"). */
export function fiscalYearName(at, startMonth = 4, tz) {
  const d = localDate(at, tz);
  const y = d.m >= startMonth ? d.y : d.y - 1;
  return startMonth === 1 ? String(y) : `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

registerMetric({
  key: 'finance.budget_utilisation', department: 'finance', label: 'Budget spent', headline: true, currentOnly: true,
  definition: 'Actual spend divided by the approved budget for the financial year containing the period end. Commitments (orders not yet paid) are shown separately and never added to actual: procurement moves an amount from committed to actual when it is paid, so an order and its invoice are not counted twice.',
  numerator: 'Actual spend (paid)', denominator: 'Planned budget (approved or locked budgets)',
  unit: 'percent', kind: 'stock', dateBasis: 'Running budget totals (current)', sources: ['Budget'], link: '/budgets', version: 1,
  compute: async (ctx) => {
    const fy = fiscalYearName(asOf(ctx.period), ctx.fyStartMonth, ctx.period.tz);
    const budgets = await Budget.find({ fiscalYear: fy, status: { $in: ['APPROVED', 'LOCKED'] } }).select('lines').lean();
    const lines = budgets.flatMap((b) => b.lines ?? []);
    if (!lines.length) return { value: null, records: 0, note: `No approved budget for ${fy}.` };
    const planned = sum(lines, (l) => l.plannedPaise); const actual = sum(lines, (l) => l.actualPaise); const committed = sum(lines, (l) => l.committedPaise);
    return {
      value: pct(actual, planned), records: lines.length,
      detail: { fiscalYear: fy, plannedPaise: planned, actualPaise: actual, committedPaise: committed, availablePaise: planned - actual - committed, variancePaise: actual - planned },
      breakdown: lines.map((l) => ({ label: `${l.code} ${l.head}`, value: l.actualPaise, of: l.plannedPaise, committed: l.committedPaise })),
    };
  },
});

const PAYROLL_DONE = ['APPROVED', 'BANK_FILE_GENERATED', 'PAYMENT_INITIATED', 'PAYMENT_CONFIRMED', 'CLOSED'];

/** Months ("YYYY-MM") whose first day falls inside the period. */
export function monthsIn(p) {
  const out = [];
  let [y, m, d] = p.from.split('-').map(Number);
  if (d !== 1) { m += 1; if (m > 12) { m = 1; y += 1; } }
  const [ty, tm] = p.to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m += 1; if (m > 12) { m = 1; y += 1; } }
  return out;
}

export async function payrollTotals(p) {
  const runs = await PayrollRun.find({ period: { $in: monthsIn(p) }, status: { $in: PAYROLL_DONE } }).select('period totals').lean();
  return { runs: runs.length, grossPaise: sum(runs, (r) => r.totals?.grossPaise), netPaise: sum(runs, (r) => r.totals?.netPaise), employerPaise: sum(runs, (r) => r.totals?.employerContributionsPaise), headcount: Math.max(0, ...runs.map((r) => r.totals?.headcount ?? 0)) };
}

registerMetric({
  key: 'finance.cost_per_student', department: 'finance', label: 'Operating cost per student',
  definition: 'Purchases paid in the period plus gross pay (with employer contributions) of approved payroll months starting in the period, divided by students on roll at the end of the period. Pay is a school total; no individual pay is used or shown.',
  numerator: 'Procurement payments confirmed + approved payroll gross and employer contributions', denominator: 'Students on roll at the period end',
  unit: 'paise', kind: 'flow', dateBasis: 'Payment confirmation date; payroll month', sources: ['PurchaseRequest', 'PayrollRun', 'Enrollment'], link: '/budgets', version: 1,
  since: (ctx) => ctx.memo('costSince', async () => {
    const [a, b] = await Promise.all([earliest(PurchaseRequest, 'payment.confirmedAt'), earliest(PayrollRun, 'createdAt')]);
    return [a, b].filter(Boolean).sort((x, y) => x - y)[0] ?? null;
  }),
  compute: async (ctx) => {
    const [prs, pay, roll] = await Promise.all([
      PurchaseRequest.find(within('payment.confirmedAt', ctx.period)).select('payment.amountPaise').lean(),
      payrollTotals(ctx.period),
      onRollAt(ctx, asOf(ctx.period)),
    ]);
    const spend = sum(prs, (r) => r.payment?.amountPaise) + pay.grossPaise + pay.employerPaise;
    const students = roll.rows.length;
    return {
      value: students ? Math.round(spend / students) : null, records: prs.length + pay.runs,
      detail: { spendPaise: spend, purchasesPaise: sum(prs, (r) => r.payment?.amountPaise), payrollPaise: pay.grossPaise + pay.employerPaise, students },
      note: students ? null : 'No students on roll at the period end.',
    };
  },
});
