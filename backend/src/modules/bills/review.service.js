import { Bill, BillReview, ServiceAccount, BILL_CATEGORIES } from '../../models/bill.model.js';
import { PurchaseRequest } from '../../models/finance.model.js';
import { AppError } from '../../utils/AppError.js';
import { inr } from '../finance-ops/format.js';
import { resolvePeriod, comparisonPeriod, buckets, change } from '../../utils/periods.js';
import { requireProfile, requireText, oneOf, dto } from '../ops/common.js';

/**
 * The review queue and the cost dashboard.
 *
 * Review flags are explainable observations for a person to look at — an
 * amount well above the account's usual bill, two bills that look like the
 * same bill, a jump in consumption, a bill past due, a payment recorded
 * without evidence, a supplier invoice that did not match its order. They are
 * never accusations: each flag states the rule and the numbers that triggered
 * it, and a reviewer records an explanation or dismisses it with a note.
 * Flags are recomputed from the records each time; only the reviews persist.
 */

const DAY = 86_400_000;
export const REVIEW_RULES = {
  lookback: 6, // bills used for the average
  minHistory: 3, // fewer than this: no average to compare with
  amountAbovePct: 25,
  consumptionAbovePct: 30,
  duplicateWindowDays: 10,
  unconfirmedDays: 7,
};

const pct = (a, b) => Math.round(((a - b) / b) * 1000) / 10;

export async function reviewFlags({ now = new Date(), rules = REVIEW_RULES } = {}) {
  const flags = [];
  const since = new Date(now.getTime() - 400 * DAY);
  const bills = await Bill.find({ status: { $ne: 'CANCELLED' }, billDate: { $gte: since } }).sort({ billDate: 1 }).select('-history').lean();
  const accounts = new Map((await ServiceAccount.find({ _id: { $in: [...new Set(bills.map((b) => String(b.accountId)))] } }).select('name accountNo').lean()).map((a) => [String(a._id), a]));
  const label = (b) => `${accounts.get(String(b.accountId))?.name ?? b.category} ${b.refNo}${b.billNo ? ` (bill ${b.billNo})` : ''}`;
  const byAccount = new Map();
  for (const b of bills) byAccount.set(String(b.accountId), [...(byAccount.get(String(b.accountId)) ?? []), b]);

  for (const list of byAccount.values()) {
    list.forEach((b, i) => {
      const prior = list.slice(Math.max(0, i - rules.lookback), i);
      if (prior.length >= rules.minHistory) {
        const avg = Math.round(prior.reduce((n, p) => n + p.amountPaise, 0) / prior.length);
        if (avg > 0 && b.amountPaise > avg * (1 + rules.amountAbovePct / 100)) {
          flags.push({ code: 'AMOUNT_ABOVE_AVERAGE', severity: b.amountPaise > avg * 2 ? 'HIGH' : 'MEDIUM', entityType: 'Bill', entityId: String(b._id), amountPaise: b.amountPaise, at: b.billDate,
            title: `${label(b)} is ${pct(b.amountPaise, avg)}% above its usual amount`,
            explanation: `${inr(b.amountPaise)} against an average of ${inr(avg)} over the previous ${prior.length} bills (rule: more than ${rules.amountAbovePct}% above). Check the tariff, the period covered and any arrears.` });
        }
        const withUnits = prior.filter((p) => p.units !== null && p.units !== undefined);
        if (b.units !== null && b.units !== undefined && withUnits.length >= rules.minHistory) {
          const avgU = withUnits.reduce((n, p) => n + p.units, 0) / withUnits.length;
          if (avgU > 0 && b.units > avgU * (1 + rules.consumptionAbovePct / 100)) {
            flags.push({ code: 'CONSUMPTION_SPIKE', severity: 'MEDIUM', entityType: 'Bill', entityId: String(b._id), amountPaise: b.amountPaise, at: b.billDate,
              title: `${label(b)}: consumption ${pct(b.units, avgU)}% above usual`,
              explanation: `${b.units} ${b.unitLabel ?? 'units'} against an average of ${Math.round(avgU * 10) / 10} over the previous ${withUnits.length} bills (rule: more than ${rules.consumptionAbovePct}% above). Possible leak, meter fault, longer period or genuine extra use.` });
          }
        }
      }
    });
  }

  // Duplicate candidates: same vendor (or account), same amount, dates close together.
  for (let i = 0; i < bills.length; i += 1) {
    for (let j = i + 1; j < bills.length; j += 1) {
      const a = bills[i]; const b = bills[j];
      if (new Date(b.billDate) - new Date(a.billDate) > rules.duplicateWindowDays * DAY) break;
      const sameParty = String(a.accountId) === String(b.accountId) || (a.vendorName && a.vendorName === b.vendorName);
      if (sameParty && a.amountPaise === b.amountPaise) {
        flags.push({ code: 'DUPLICATE_CANDIDATE', severity: 'HIGH', entityType: 'Bill', entityId: String(b._id), relatedId: String(a._id), amountPaise: b.amountPaise, at: b.billDate,
          title: `${label(b)} may repeat ${label(a)}`,
          explanation: `Same ${String(a.accountId) === String(b.accountId) ? 'account' : 'vendor'}, same amount (${inr(b.amountPaise)}), bill dates ${Math.round(Math.abs(new Date(b.billDate) - new Date(a.billDate)) / DAY)} day(s) apart (rule: within ${rules.duplicateWindowDays} days). Confirm they cover different periods before paying both.` });
      }
    }
  }

  for (const b of bills) {
    const outstanding = b.amountPaise - (b.confirmedPaidPaise ?? 0);
    if (['DUE', 'PARTIALLY_PAID', 'DISPUTED'].includes(b.status) && new Date(b.dueOn) < now) {
      const days = Math.floor((now - new Date(b.dueOn)) / DAY);
      flags.push({ code: 'UNPAID_PAST_DUE', severity: days > 15 ? 'HIGH' : 'MEDIUM', entityType: 'Bill', entityId: String(b._id), amountPaise: outstanding, at: b.dueOn,
        title: `${label(b)} is ${days} day(s) past due`, explanation: `${inr(outstanding)} outstanding; due ${new Date(b.dueOn).toISOString().slice(0, 10)}. Late fees or disconnection may apply.` });
    }
    for (const p of b.payments ?? []) {
      if (p.status === 'REJECTED') continue;
      if (!(p.evidence ?? []).length) {
        flags.push({ code: 'PAYMENT_WITHOUT_EVIDENCE', severity: 'LOW', entityType: 'Bill', entityId: String(b._id), paymentId: String(p._id), amountPaise: p.amountPaise, at: p.recordedAt,
          title: `Payment of ${inr(p.amountPaise)} on ${label(b)} has no evidence`, explanation: `Recorded by ${p.recordedByName ?? 'someone'} on ${new Date(p.recordedAt).toISOString().slice(0, 10)} with no receipt or bank screenshot attached.` });
      }
      if (p.status === 'RECORDED' && now - new Date(p.recordedAt) > rules.unconfirmedDays * DAY) {
        flags.push({ code: 'PAYMENT_UNCONFIRMED', severity: 'MEDIUM', entityType: 'Bill', entityId: String(b._id), paymentId: String(p._id), amountPaise: p.amountPaise, at: p.recordedAt,
          title: `Payment on ${label(b)} not yet confirmed against the bank`, explanation: `Recorded ${Math.floor((now - new Date(p.recordedAt)) / DAY)} days ago (rule: more than ${rules.unconfirmedDays}). The bill is not settled until a second person confirms it.` });
      }
    }
  }

  // Supplier invoices from procurement that did not match their order.
  const mismatched = await PurchaseRequest.find({ 'invoices.matchStatus': 'MISMATCH', status: { $nin: ['PAID', 'CLOSED', 'CANCELLED'] } }).select('refNo title invoices po.vendorName').lean();
  for (const pr of mismatched) {
    for (const inv of pr.invoices.filter((x) => x.matchStatus === 'MISMATCH')) {
      flags.push({ code: 'VENDOR_INVOICE_MISMATCH', severity: 'MEDIUM', entityType: 'PurchaseRequest', entityId: String(pr._id), amountPaise: inv.amountPaise, at: inv.at, invoiceNo: inv.vendorInvoiceNo,
        title: `${pr.refNo}: invoice ${inv.vendorInvoiceNo} from ${pr.po?.vendorName ?? 'vendor'} does not match the order`, explanation: inv.matchNote ?? 'Invoice value differs from the accepted goods at the order prices.' });
    }
  }
  // The same supplier invoice entered both as a bill and in procurement would be counted twice.
  const billNos = bills.filter((b) => b.billNo && b.vendorName).map((b) => b.billNo);
  if (billNos.length) {
    const prs = await PurchaseRequest.find({ 'invoices.vendorInvoiceNo': { $in: billNos } }).select('refNo invoices po.vendorName').lean();
    for (const pr of prs) {
      for (const b of bills.filter((x) => x.billNo && pr.invoices.some((i) => i.vendorInvoiceNo === x.billNo) && (pr.po?.vendorName ?? '') === x.vendorName)) {
        flags.push({ code: 'BILL_ALSO_IN_PROCUREMENT', severity: 'HIGH', entityType: 'Bill', entityId: String(b._id), relatedId: String(pr._id), amountPaise: b.amountPaise, at: b.billDate,
          title: `${label(b)} is also booked on ${pr.refNo}`, explanation: `Invoice ${b.billNo} from ${b.vendorName} appears both as a bill and as a procurement invoice; paying both would pay it twice.` });
      }
    }
  }

  for (const f of flags) f.key = `${f.code}:${f.entityId}${f.paymentId ? `:${f.paymentId}` : ''}${f.relatedId ? `:${f.relatedId}` : ''}${f.invoiceNo ? `:${f.invoiceNo}` : ''}`;
  return flags;
}

export async function reviewQueue(actor, query = {}) {
  requireProfile(actor);
  const flags = await reviewFlags();
  const reviews = new Map((await BillReview.find({ flagKey: { $in: flags.map((f) => f.key) } }).lean()).map((r) => [r.flagKey, r]));
  let out = flags.map((f) => ({ ...f, review: reviews.get(f.key) ? dto(reviews.get(f.key)) : null }));
  const show = query.show ?? 'open';
  if (show === 'open') out = out.filter((f) => !f.review || f.review.status === 'ESCALATED');
  else if (show === 'reviewed') out = out.filter((f) => f.review);
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  out.sort((a, b) => rank[a.severity] - rank[b.severity] || new Date(b.at) - new Date(a.at));
  const counts = {};
  for (const f of flags) counts[f.code] = (counts[f.code] ?? 0) + 1;
  return { items: out, counts, rules: REVIEW_RULES, note: 'Flags are prompts to check a record, not findings. Each states the rule and the numbers that raised it.' };
}

export async function reviewFlag(actor, body = {}) {
  requireProfile(actor);
  const key = requireText(body.flagKey, 'flagKey', { max: 300 });
  const flag = (await reviewFlags()).find((f) => f.key === key);
  if (!flag) throw new AppError('That flag is no longer raised.', 404, [], 'FLAG_GONE');
  const status = oneOf(body.status, ['EXPLAINED', 'DISMISSED', 'ESCALATED'], 'status');
  const note = requireText(body.note, 'note', { max: 2000 });
  const doc = await BillReview.findOneAndUpdate(
    { flagKey: key },
    { $set: { code: flag.code, status, note, byProfileId: actor.profileId, byName: actor.displayName ?? null, at: new Date() } },
    { upsert: true, new: true },
  ).lean();
  return dto(doc);
}

// ── Dashboard ─────────────────────────────────────────────────────────────

/**
 * Bills by category and month for a period, with the comparison period.
 * Counts bills by bill date. Purchases through procurement are not included
 * (they are reported there), so nothing is counted twice; a bill linked to a
 * purchase request is shown separately.
 */
export async function dashboard(actor, query = {}) {
  requireProfile(actor);
  const period = resolvePeriod({ preset: query.preset ?? 'financialYear', from: query.from, to: query.to });
  const compare = comparisonPeriod(period, { mode: query.compare ?? 'lastYear' });
  const sum = async (p) => {
    if (!p) return [];
    return Bill.aggregate([
      { $match: { status: { $ne: 'CANCELLED' }, billDate: { $gte: p.start, $lt: p.end } } },
      { $group: { _id: '$category', amountPaise: { $sum: '$amountPaise' }, confirmedPaidPaise: { $sum: '$confirmedPaidPaise' }, units: { $sum: { $ifNull: ['$units', 0] } }, bills: { $sum: 1 }, viaProcurement: { $sum: { $cond: [{ $ne: ['$purchaseRequestId', null] }, '$amountPaise', 0] } } } },
    ]);
  };
  const [cur, prev] = await Promise.all([sum(period), sum(compare)]);
  const prevBy = new Map(prev.map((r) => [r._id, r]));
  const byCategory = BILL_CATEGORIES.map((c) => {
    const r = cur.find((x) => x._id === c);
    const p = prevBy.get(c);
    if (!r && !p) return null;
    return { category: c, amountPaise: r?.amountPaise ?? 0, bills: r?.bills ?? 0, units: r?.units ?? 0, confirmedPaidPaise: r?.confirmedPaidPaise ?? 0, viaProcurementPaise: r?.viaProcurement ?? 0, previousPaise: p?.amountPaise ?? null, change: change(r?.amountPaise ?? 0, p ? p.amountPaise : null) };
  }).filter(Boolean);
  const months = buckets(period, 'month');
  const monthly = await Bill.aggregate([
    { $match: { status: { $ne: 'CANCELLED' }, billDate: { $gte: period.start, $lt: period.end } } },
    { $project: { category: 1, amountPaise: 1, units: 1, billDate: 1 } },
  ]);
  const series = months.map((m) => {
    const rows = monthly.filter((b) => b.billDate >= m.start && b.billDate < m.end);
    const cats = {};
    for (const b of rows) cats[b.category] = (cats[b.category] ?? 0) + b.amountPaise;
    return { label: m.label, from: m.from, to: m.to, totalPaise: rows.reduce((n, b) => n + b.amountPaise, 0), byCategory: cats };
  });
  const open = await Bill.aggregate([
    { $match: { status: { $in: ['DUE', 'PARTIALLY_PAID', 'PAYMENT_RECORDED', 'DISPUTED'] } } },
    { $group: { _id: null, outstandingPaise: { $sum: { $subtract: ['$amountPaise', '$confirmedPaidPaise'] } }, overdue: { $sum: { $cond: [{ $lt: ['$dueOn', new Date()] }, 1, 0] } }, count: { $sum: 1 } } },
  ]);
  const total = byCategory.reduce((n, r) => n + r.amountPaise, 0);
  const prevTotal = compare ? byCategory.reduce((n, r) => n + (r.previousPaise ?? 0), 0) : null;
  return {
    period: { from: period.from, to: period.to, label: period.label }, comparison: compare ? { from: compare.from, to: compare.to, label: compare.label } : null,
    totalPaise: total, previousTotalPaise: prevTotal, change: change(total, prev.length ? prevTotal : null), byCategory, series,
    open: { outstandingPaise: open[0]?.outstandingPaise ?? 0, overdue: open[0]?.overdue ?? 0, count: open[0]?.count ?? 0 },
    definitions: {
      amount: 'Sum of bill amounts (tax included) by bill date; cancelled bills excluded.',
      paid: 'Only payments confirmed against the bank count as paid.',
      scope: 'Recurring bills only. Purchases through procurement are reported in Procurement; bills linked to a purchase request are shown separately so nothing is counted twice.',
    },
  };
}
