import { registerMetric } from '../catalogue.js';
import { PurchaseRequest } from '../../../models/finance.model.js';
import { within, earliest, sum, pct, DAY } from './helpers.js';

/**
 * Procurement: each stage counted on its own date (requested, ordered,
 * received, invoiced, paid), so a purchase is never counted twice as spend.
 */

const prSince = (ctx) => ctx.memo('prSince', () => earliest(PurchaseRequest, 'createdAt'));
const LINK = '/procurement';

registerMetric({
  key: 'procurement.requests', department: 'procurement', label: 'Purchase requests raised', trend: true,
  definition: 'Purchase requests created in the period (drafts included, cancelled excluded), with their estimated value.',
  unit: 'count', kind: 'flow', dateBasis: 'Request creation date', sources: ['PurchaseRequest'], link: LINK, version: 1,
  since: prSince,
  compute: async (ctx) => {
    const rows = await PurchaseRequest.find({ status: { $ne: 'CANCELLED' }, ...within('createdAt', ctx.period) }).select('estimatedTotalPaise').lean();
    return { value: rows.length, records: rows.length, detail: { estimatedPaise: sum(rows, (r) => r.estimatedTotalPaise) } };
  },
});

registerMetric({
  key: 'procurement.approval_days', department: 'procurement', label: 'Average approval turnaround',
  definition: 'For requests approved in the period: average days from the request being created to its approval.',
  numerator: 'Days from creation to approval, summed', denominator: 'Requests approved in the period',
  unit: 'days', kind: 'flow', dateBasis: 'Approval date', sources: ['PurchaseRequest.history'], link: LINK, version: 1,
  since: prSince,
  compute: async (ctx) => {
    const rows = await PurchaseRequest.find({ history: { $elemMatch: { to: 'APPROVED', at: { $gte: ctx.period.start, $lt: ctx.period.end } } } }).select('createdAt history').lean();
    const days = rows.map((r) => {
      const h = r.history.find((x) => x.to === 'APPROVED' && x.at >= ctx.period.start && x.at < ctx.period.end);
      return (new Date(h.at).getTime() - new Date(r.createdAt).getTime()) / DAY;
    });
    return { value: days.length ? Math.round((sum(days, (d) => d) / days.length) * 10) / 10 : null, records: rows.length, note: days.length ? null : 'No requests approved in the period.' };
  },
});

registerMetric({
  key: 'procurement.ordered', department: 'procurement', label: 'Purchase orders issued', headline: true,
  definition: 'Value of purchase orders issued in the period.', unit: 'paise', kind: 'flow', dateBasis: 'Order issue date',
  sources: ['PurchaseRequest.po'], link: LINK, version: 1, since: prSince,
  compute: async (ctx) => {
    const rows = await PurchaseRequest.find(within('po.issuedAt', ctx.period)).select('po.amountPaise').lean();
    return { value: sum(rows, (r) => r.po?.amountPaise), records: rows.length };
  },
});

registerMetric({
  key: 'procurement.received', department: 'procurement', label: 'Deliveries received',
  definition: 'Goods receipts recorded in the period (one per delivery).', unit: 'count', kind: 'flow', dateBasis: 'Receipt date',
  sources: ['PurchaseRequest.receipts'], link: LINK, version: 1, since: prSince,
  compute: async (ctx) => {
    const rows = await PurchaseRequest.find({ receipts: { $elemMatch: { at: { $gte: ctx.period.start, $lt: ctx.period.end } } } }).select('receipts.at').lean();
    const n = sum(rows, (r) => r.receipts.filter((x) => x.at >= ctx.period.start && x.at < ctx.period.end).length);
    return { value: n, records: n };
  },
});

registerMetric({
  key: 'procurement.invoiced', department: 'procurement', label: 'Supplier invoices',
  definition: 'Value of supplier invoices dated in the period (the invoice date, or the date it was recorded when it has none).',
  unit: 'paise', kind: 'flow', dateBasis: 'Supplier invoice date', sources: ['PurchaseRequest.invoices'], link: LINK, version: 1, since: prSince,
  compute: async (ctx) => {
    const p = ctx.period;
    const rows = await PurchaseRequest.find({ $or: [{ invoices: { $elemMatch: { invoiceDate: { $gte: p.start, $lt: p.end } } } }, { invoices: { $elemMatch: { invoiceDate: null, at: { $gte: p.start, $lt: p.end } } } }] }).select('invoices').lean();
    const list = rows.flatMap((r) => r.invoices).filter((i) => { const d = new Date(i.invoiceDate ?? i.at); return d >= p.start && d < p.end; });
    return { value: sum(list, (i) => i.amountPaise), records: list.length, detail: { mismatched: list.filter((i) => i.matchStatus === 'MISMATCH').length } };
  },
});

registerMetric({
  key: 'procurement.paid', department: 'procurement', label: 'Suppliers paid', headline: true,
  definition: 'Supplier payments confirmed by the bank in the period. Initiated but unconfirmed payments are not counted.',
  unit: 'paise', kind: 'flow', dateBasis: 'Payment confirmation date', sources: ['PurchaseRequest.payment'], link: LINK, version: 1, since: prSince,
  compute: async (ctx) => {
    const rows = await PurchaseRequest.find(within('payment.confirmedAt', ctx.period)).select('payment.amountPaise').lean();
    return { value: sum(rows, (r) => r.payment?.amountPaise), records: rows.length };
  },
});

registerMetric({
  key: 'procurement.commitments', department: 'procurement', label: 'Open commitments',
  definition: 'Value of purchase orders issued by the cut-off that had not been paid (bank-confirmed) by then. Shown separately from actual spend.',
  unit: 'paise', kind: 'stock', dateBasis: 'As of the last day of the period', sources: ['PurchaseRequest'], link: LINK, version: 1, since: prSince,
  compute: async (ctx) => {
    const cut = ctx.period.end;
    const rows = await PurchaseRequest.find({ 'po.issuedAt': { $lt: cut }, status: { $ne: 'CANCELLED' }, $or: [{ 'payment.confirmedAt': null }, { 'payment.confirmedAt': { $gte: cut } }] }).select('po.amountPaise').lean();
    return { value: sum(rows, (r) => r.po?.amountPaise), records: rows.length };
  },
});

registerMetric({
  key: 'procurement.vendor_concentration', department: 'procurement', label: 'Largest supplier\'s share of orders',
  definition: 'The share of the period\'s purchase-order value placed with the single largest supplier. High values mean dependence on one supplier.',
  numerator: 'Order value with the largest supplier', denominator: 'All order value in the period',
  unit: 'percent', kind: 'flow', dateBasis: 'Order issue date', sources: ['PurchaseRequest.po'], link: LINK, version: 1, since: prSince,
  compute: async (ctx) => {
    const rows = await PurchaseRequest.find(within('po.issuedAt', ctx.period)).select('po.vendorName po.vendorId po.amountPaise').lean();
    const total = sum(rows, (r) => r.po?.amountPaise);
    const by = new Map();
    for (const r of rows) { const k = r.po?.vendorName ?? String(r.po?.vendorId ?? 'Unknown'); by.set(k, (by.get(k) ?? 0) + (r.po?.amountPaise ?? 0)); }
    const ranked = [...by.entries()].sort((a, b) => b[1] - a[1]);
    return { value: pct(ranked[0]?.[1] ?? 0, total), records: rows.length, detail: { topVendor: ranked[0]?.[0] ?? null, vendors: ranked.length }, breakdown: ranked.slice(0, 5).map(([label, value]) => ({ label, value })), note: total ? null : 'No orders in the period.' };
  },
});

registerMetric({
  key: 'procurement.mismatches', department: 'procurement', label: 'Invoice mismatches',
  definition: 'Supplier invoices recorded in the period that did not match the order and receipt (three-way match).',
  unit: 'count', kind: 'flow', dateBasis: 'Date the invoice was recorded', sources: ['PurchaseRequest.invoices'], link: LINK, version: 1, since: prSince,
  compute: async (ctx) => {
    const rows = await PurchaseRequest.find({ invoices: { $elemMatch: { matchStatus: 'MISMATCH', at: { $gte: ctx.period.start, $lt: ctx.period.end } } } }).select('invoices').lean();
    const n = sum(rows, (r) => r.invoices.filter((i) => i.matchStatus === 'MISMATCH' && i.at >= ctx.period.start && i.at < ctx.period.end).length);
    return { value: n, records: n };
  },
});
