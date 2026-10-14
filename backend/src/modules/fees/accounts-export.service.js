import { Invoice, InvoiceLine, Payment, FeeHead } from '../../models/fee.model.js';
import { FeeAdjustment } from '../../models/feeAdjustment.model.js';
import { Bill } from '../../models/bill.model.js';
import { Enrollment, Student } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { periodFromDates, localDate, DEFAULT_TZ } from '../../utils/periods.js';
import { assertObjectId, optionalText, requireProfile } from '../ops/common.js';

/**
 * Accounts export for the school's accountant: vouchers in Tally's XML import
 * format (and the same entries as CSV), and a GST summary of taxable fee lines.
 *
 *   Sales       — each fee invoice raised: Dr the student (receivable), Cr fee
 *                 income per head, Cr output CGST/SGST on taxable lines.
 *   Credit Note — each applied concession, credit note or void: Dr concession
 *                 (or fee income), Cr the student.
 *   Receipt     — each credited fee payment: Dr cash/bank, Cr the student.
 *   Payment     — fee refunds paid out, and bill payments confirmed against
 *                 the bank: Dr the expense (or student), Cr cash/bank.
 *
 * Ledger names are the school's to set (they must exist in Tally, or be
 * created on import). Rates and exemptions are configured per fee head by
 * the school; nothing here decides what is taxable — the accountant does.
 */

export const DEFAULT_LEDGERS = {
  cash: 'Cash', bank: 'Bank Account', receivable: 'Student Fees Receivable', feeIncome: 'Fee Income',
  concession: 'Fee Concessions', cgst: 'Output CGST', sgst: 'Output SGST', billPrefix: '', perHead: true,
};
const BILL_LEDGER = { ELECTRICITY: 'Electricity Charges', WATER: 'Water Charges', INTERNET: 'Internet Charges', PHONE: 'Telephone Charges', GAS: 'Gas Charges', AMC: 'Annual Maintenance Contracts', SOFTWARE: 'Software Subscriptions', RENT: 'Rent', SECURITY: 'Security Services', HOUSEKEEPING: 'Housekeeping Services', WASTE: 'Waste Collection', INSURANCE: 'Insurance', LIFT: 'Lift Maintenance', TRANSPORT: 'Transport Expenses', FUEL: 'Fuel', OTHER: 'Other Expenses' };

function ledgersFrom(query = {}) {
  const out = { ...DEFAULT_LEDGERS };
  for (const k of Object.keys(DEFAULT_LEDGERS)) {
    if (k === 'perHead') { if (query.perHead !== undefined) out.perHead = String(query.perHead) !== 'false'; continue; }
    const v = optionalText(query[`ledger_${k}`], { max: 80 });
    if (v) out[k] = v.replace(/[<>&]/g, '');
  }
  return out;
}

function rangeFrom(query) {
  if (!query.from || !query.to) throw new AppError('Choose a date range (from and to, YYYY-MM-DD).', 400);
  return periodFromDates(String(query.from), String(query.to), { tz: DEFAULT_TZ });
}

const ymd = (d) => { const l = localDate(new Date(d), DEFAULT_TZ); return `${l.y}${String(l.m).padStart(2, '0')}${String(l.d).padStart(2, '0')}`; };
const rupees = (paise) => (paise / 100).toFixed(2);
const isCash = (mode) => String(mode).toUpperCase() === 'CASH';

async function studentNames(enrollmentIds) {
  const enrolments = await Enrollment.find({ _id: { $in: enrollmentIds } }).select('studentId').lean();
  const students = new Map((await Student.find({ _id: { $in: enrolments.map((e) => e.studentId) } }).select('firstName lastName admissionNo').lean()).map((s) => [String(s._id), s]));
  return new Map(enrolments.map((e) => {
    const s = students.get(String(e.studentId));
    return [String(e._id), s ? `${s.firstName} ${s.lastName ?? ''}`.trim() + ` (${s.admissionNo})` : 'Student'];
  }));
}

/** All vouchers for the range, balanced (debits equal credits on each). Amount > 0 is a debit. */
export async function buildVouchers(query = {}) {
  const period = rangeFrom(query);
  const L = ledgersFrom(query);
  const inRange = { $gte: period.start, $lt: period.end };
  const vouchers = [];

  const invoices = await Invoice.find({ createdAt: inRange, $or: [{ status: { $ne: 'CANCELLED' } }, { voidedAt: { $ne: null } }] }).lean();
  const payments = await Payment.find({ recordStatus: 'PUBLISHED', status: { $in: ['SUCCESS', 'REFUNDED'] }, $or: [{ paidOn: inRange }, { paidOn: null, createdAt: inRange }] }).lean();
  const refundRows = await Payment.find({ 'refunds.status': 'COMPLETED', 'refunds.decidedAt': inRange }).lean();
  const adjustments = await FeeAdjustment.find({ status: 'APPLIED', appliedAt: inRange }).lean();
  const invoiceById = new Map((await Invoice.find({ _id: { $in: [...payments, ...refundRows].map((p) => p.invoiceId) } }).select('invoiceNo enrollmentId').lean()).map((i) => [String(i._id), i]));
  const names = await studentNames([...invoices.map((i) => i.enrollmentId), ...[...invoiceById.values()].map((i) => i.enrollmentId), ...adjustments.map((a) => a.enrollmentId).filter(Boolean)]);
  const lines = await InvoiceLine.find({ invoiceId: { $in: invoices.map((i) => i._id) } }).lean();
  const laterOnLine = new Map();
  for (const a of await FeeAdjustment.find({ status: 'APPLIED', kind: 'CONCESSION', lineId: { $in: lines.map((l) => l._id) } }).select('lineId amountPaise').lean()) {
    laterOnLine.set(String(a.lineId), (laterOnLine.get(String(a.lineId)) ?? 0) + a.amountPaise);
  }

  for (const inv of invoices) {
    const party = names.get(String(inv.enrollmentId)) ?? 'Student';
    const entries = [];
    let total = 0;
    for (const l of lines.filter((x) => String(x.invoiceId) === String(inv._id))) {
      const head = L.perHead ? (String(l.description).split(' — ')[0] || L.feeIncome) : L.feeIncome;
      entries.push({ ledger: head, amountPaise: -l.amountPaise });
      total += l.amountPaise;
      const tax = l.taxPaise ?? 0;
      if (tax) {
        const cgst = Math.floor(tax / 2);
        entries.push({ ledger: L.cgst, amountPaise: -cgst }, { ledger: L.sgst, amountPaise: -(tax - cgst) });
        total += tax;
      }
      // A concession written on the line when the invoice was raised (not
      // through a later adjustment, which has its own credit note).
      const initial = (l.concessionPaise ?? 0) - (laterOnLine.get(String(l._id)) ?? 0);
      if (initial > 0) {
        entries.push({ ledger: L.concession, amountPaise: initial });
        total -= initial;
      }
    }
    if (!entries.length) continue;
    entries.unshift({ ledger: party, group: L.receivable, amountPaise: total });
    vouchers.push({ type: 'Sales', date: inv.createdAt, number: inv.invoiceNo, party, narration: `Fee invoice ${inv.invoiceNo}, due ${new Date(inv.dueOn).toISOString().slice(0, 10)}`, entries });
  }
  for (const a of adjustments) {
    const party = names.get(String(a.enrollmentId)) ?? 'Student';
    vouchers.push({ type: 'Credit Note', date: a.appliedAt, number: a.refNo, party, narration: `${a.kind === 'VOID' ? 'Void of' : a.kind === 'CONCESSION' ? `${a.concessionName ?? 'Concession'} on` : 'Credit note on'} invoice ${a.invoiceNo}: ${a.reason}`.slice(0, 250),
      entries: [{ ledger: a.kind === 'CONCESSION' ? L.concession : L.feeIncome, amountPaise: a.amountPaise }, { ledger: party, group: L.receivable, amountPaise: -a.amountPaise }] });
  }
  for (const p of payments) {
    const inv = invoiceById.get(String(p.invoiceId));
    const party = inv ? names.get(String(inv.enrollmentId)) ?? 'Student' : 'Student';
    vouchers.push({ type: 'Receipt', date: p.paidOn ?? p.createdAt, number: p.receiptNo ?? String(p._id), party, narration: `Fee receipt ${p.receiptNo ?? ''} against ${inv?.invoiceNo ?? 'invoice'} by ${p.mode}${p.instrument?.number ? ` ${p.instrument.number}` : ''}`.trim(),
      entries: [{ ledger: isCash(p.mode) ? L.cash : L.bank, amountPaise: p.amountPaise }, { ledger: party, group: L.receivable, amountPaise: -p.amountPaise }] });
  }
  for (const p of refundRows) {
    const inv = invoiceById.get(String(p.invoiceId));
    const party = inv ? names.get(String(inv.enrollmentId)) ?? 'Student' : 'Student';
    for (const r of (p.refunds ?? []).filter((x) => x.status === 'COMPLETED' && x.decidedAt >= period.start && x.decidedAt < period.end)) {
      vouchers.push({ type: 'Payment', date: r.decidedAt, number: r.voucherNo ?? String(r._id), party, narration: `Fee refund on receipt ${p.receiptNo ?? ''}: ${r.reason}`.slice(0, 250),
        entries: [{ ledger: party, group: L.receivable, amountPaise: r.amountPaise }, { ledger: isCash(r.mode) ? L.cash : L.bank, amountPaise: -r.amountPaise }] });
    }
  }
  const bills = await Bill.find({ 'payments.status': 'CONFIRMED', 'payments.paidOn': inRange }).lean();
  for (const b of bills) {
    for (const p of b.payments.filter((x) => x.status === 'CONFIRMED' && x.paidOn >= period.start && x.paidOn < period.end)) {
      vouchers.push({ type: 'Payment', date: p.paidOn, number: `${b.refNo}-${String(p._id).slice(-4)}`, party: b.vendorName ?? null, narration: `${b.category.toLowerCase()} bill ${b.billNo ?? b.refNo}${b.vendorName ? ` to ${b.vendorName}` : ''}; bank ref ${p.bankReference ?? '-'}`,
        entries: [{ ledger: `${L.billPrefix}${BILL_LEDGER[b.category] ?? 'Other Expenses'}`, amountPaise: p.amountPaise }, { ledger: isCash(p.mode) ? L.cash : L.bank, amountPaise: -p.amountPaise }] });
    }
  }
  vouchers.sort((a, b) => new Date(a.date) - new Date(b.date));
  for (const v of vouchers) {
    const sum = v.entries.reduce((n, e) => n + e.amountPaise, 0);
    if (sum !== 0) throw new AppError(`Voucher ${v.number} does not balance (${sum} paise); export stopped.`, 500, [], 'UNBALANCED');
  }
  return { period: { from: period.from, to: period.to }, ledgers: L, vouchers };
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Tally's XML import envelope. Debits are negative with ISDEEMEDPOSITIVE=Yes, as Tally writes them. */
export function toTallyXml({ vouchers }, { company = '' } = {}) {
  const body = vouchers.map((v) => [
    '  <TALLYMESSAGE xmlns:UDF="TallyUDF">',
    `   <VOUCHER VCHTYPE="${esc(v.type)}" ACTION="Create">`,
    `    <DATE>${ymd(v.date)}</DATE>`,
    `    <VOUCHERTYPENAME>${esc(v.type)}</VOUCHERTYPENAME>`,
    `    <VOUCHERNUMBER>${esc(v.number)}</VOUCHERNUMBER>`,
    v.party ? `    <PARTYLEDGERNAME>${esc(v.party)}</PARTYLEDGERNAME>` : null,
    `    <NARRATION>${esc(v.narration)}</NARRATION>`,
    ...v.entries.map((e) => [
      '    <ALLLEDGERENTRIES.LIST>',
      `     <LEDGERNAME>${esc(e.ledger)}</LEDGERNAME>`,
      `     <ISDEEMEDPOSITIVE>${e.amountPaise > 0 ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>`,
      `     <AMOUNT>${rupees(-e.amountPaise)}</AMOUNT>`,
      '    </ALLLEDGERENTRIES.LIST>',
    ].join('\n')),
    '   </VOUCHER>',
    '  </TALLYMESSAGE>',
  ].filter(Boolean).join('\n')).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
 <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>
   <REQUESTDATA>
${body}
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>
`;
}

const csvCell = (v) => {
  const s = String(v ?? '');
  // A leading =,+,-,@ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv({ vouchers }) {
  const rows = [['Date', 'Voucher type', 'Voucher no', 'Party', 'Ledger', 'Under group', 'Debit', 'Credit', 'Narration']];
  for (const v of vouchers) {
    for (const e of v.entries) {
      const d = new Date(v.date);
      const l = localDate(d, DEFAULT_TZ);
      rows.push([`${l.y}-${String(l.m).padStart(2, '0')}-${String(l.d).padStart(2, '0')}`, v.type, v.number, v.party ?? '', e.ledger, e.group ?? '', e.amountPaise > 0 ? rupees(e.amountPaise) : '', e.amountPaise < 0 ? rupees(-e.amountPaise) : '', v.narration]);
    }
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

export async function exportVouchers(actor, query = {}) {
  requireProfile(actor);
  const built = await buildVouchers(query);
  const format = String(query.format ?? 'summary').toLowerCase();
  if (format === 'xml') return { contentType: 'application/xml; charset=utf-8', filename: `tally-vouchers-${built.period.from}-to-${built.period.to}.xml`, body: toTallyXml(built, { company: optionalText(query.company, { max: 120 }) ?? '' }) };
  if (format === 'csv') return { contentType: 'text/csv; charset=utf-8', filename: `vouchers-${built.period.from}-to-${built.period.to}.csv`, body: toCsv(built) };
  const byType = {};
  for (const v of built.vouchers) {
    const t = (byType[v.type] ??= { count: 0, amountPaise: 0 });
    t.count += 1;
    t.amountPaise += v.entries.filter((e) => e.amountPaise > 0).reduce((n, e) => n + e.amountPaise, 0);
  }
  return { json: { period: built.period, ledgers: built.ledgers, byType, count: built.vouchers.length, sample: built.vouchers.slice(0, 20) } };
}

/**
 * GST summary of fee lines that carry a rate (by HSN/SAC and rate), and the
 * total of lines that carry none. CGST/SGST split equally (intra-state); the
 * accountant decides the return treatment. Voided invoices are left out;
 * credit notes on taxable invoices are listed for the accountant to adjust.
 */
export async function gstSummary(actor, query = {}) {
  requireProfile(actor);
  const period = rangeFrom(query);
  const invoices = await Invoice.find({ createdAt: { $gte: period.start, $lt: period.end }, voidedAt: null, status: { $ne: 'CANCELLED' } }).select('_id invoiceNo').lean();
  const lines = await InvoiceLine.find({ invoiceId: { $in: invoices.map((i) => i._id) } }).lean();
  const groups = new Map();
  let untaxed = 0; let untaxedLines = 0;
  for (const l of lines) {
    if (!l.gstRateBp) { untaxed += l.amountPaise; untaxedLines += 1; continue; }
    const key = `${l.hsnSac ?? '—'}|${l.gstRateBp}`;
    const g = groups.get(key) ?? { hsnSac: l.hsnSac ?? null, rateBp: l.gstRateBp, ratePct: l.gstRateBp / 100, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, taxPaise: 0, lines: 0, invoices: new Set() };
    const tax = l.taxPaise ?? Math.round((l.amountPaise * l.gstRateBp) / 10000);
    g.taxablePaise += l.amountPaise; g.taxPaise += tax; g.cgstPaise += Math.floor(tax / 2); g.sgstPaise += tax - Math.floor(tax / 2); g.lines += 1; g.invoices.add(String(l.invoiceId));
    groups.set(key, g);
  }
  const taxedInvoiceIds = new Set([...groups.values()].flatMap((g) => [...g.invoices]));
  const credits = await FeeAdjustment.find({ status: 'APPLIED', appliedAt: { $gte: period.start, $lt: period.end }, invoiceId: { $in: [...taxedInvoiceIds] } }).select('refNo invoiceNo kind amountPaise').lean();
  const rows = [...groups.values()].map((g) => ({ ...g, invoices: g.invoices.size })).sort((a, b) => b.taxablePaise - a.taxablePaise);
  return {
    period: { from: period.from, to: period.to },
    rows,
    totals: rows.reduce((t, r) => ({ taxablePaise: t.taxablePaise + r.taxablePaise, taxPaise: t.taxPaise + r.taxPaise, cgstPaise: t.cgstPaise + r.cgstPaise, sgstPaise: t.sgstPaise + r.sgstPaise }), { taxablePaise: 0, taxPaise: 0, cgstPaise: 0, sgstPaise: 0 }),
    untaxed: { amountPaise: untaxed, lines: untaxedLines, note: 'Lines with no GST rate configured (exempt, nil-rated or not set up). Tuition is commonly exempt; confirm with your accountant.' },
    creditsOnTaxedInvoices: credits.map((c) => ({ refNo: c.refNo, invoiceNo: c.invoiceNo, kind: c.kind, amountPaise: c.amountPaise })),
    disclaimer: 'Prepared from fee lines as configured by the school. Not tax advice; the school\'s accountant decides rates, exemptions and return treatment.',
  };
}

/** Sets a fee head's HSN/SAC and GST rate. New invoices use it; issued invoices keep what they were issued with. */
export async function setFeeHeadTax(actor, id, body = {}) {
  requireProfile(actor);
  const head = await FeeHead.findById(assertObjectId(id));
  if (!head) throw new AppError('Fee head not found', 404);
  if (body.gstRateBp !== undefined) {
    if (body.gstRateBp === null || body.gstRateBp === '') head.gstRateBp = null;
    else {
      const n = Number(body.gstRateBp);
      if (!Number.isInteger(n) || n < 0 || n > 10000) throw new AppError('gstRateBp must be whole basis points (1800 = 18%)', 400);
      head.gstRateBp = n || null;
    }
  }
  if (body.hsnSac !== undefined) {
    const code = optionalText(body.hsnSac, { max: 10 }) || null;
    if (code && !/^\d{4,8}$/.test(code)) throw new AppError('hsnSac should be 4 to 8 digits', 400);
    head.hsnSac = code;
  }
  await head.save();
  return { id: String(head._id), name: head.name, category: head.category, hsnSac: head.hsnSac, gstRateBp: head.gstRateBp };
}

export async function listFeeHeadTax() {
  return (await FeeHead.find({}).sort({ name: 1 }).lean()).map((h) => ({ id: String(h._id), name: h.name, category: h.category, hsnSac: h.hsnSac ?? null, gstRateBp: h.gstRateBp ?? null }));
}
