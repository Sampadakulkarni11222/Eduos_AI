// Part-6 coverage tools: finance. See ./_kit.js and ../p6Coverage.js.
import * as fees from '../../../../fees/fee.service.js';
import * as plans from '../../../../fees/plan.service.js';
import * as adjustments from '../../../../fees/adjustment.service.js';
import * as accountsExport from '../../../../fees/accounts-export.service.js';
import * as seatService from '../../../../seats/seat.service.js';
import * as seatPrices from '../../../../seats/seatPrice.service.js';
import * as procurement from '../../../../finance-ops/procurement.service.js';
import * as bills from '../../../../bills/bills.service.js';
import { syncRenewals } from '../../../../bills/renewals.service.js';
import * as collections from '../../../../p4ops/collections.service.js';
import * as scenarios from '../../../../scenarios/scenarios.service.js';
import * as facilities from '../../../../administration/facility.service.js';
import { Invoice } from '../../../../../models/fee.model.js';
import { BILL_CATEGORIES, BILLING_CYCLES } from '../../../../../models/bill.model.js';
import { CONCESSION_KINDS } from '../../../../../models/feeAdjustment.model.js';
import { rupees, resolveStudentId } from '../_shared.js';
import { resolvePayment, resolveFeeHead, resolveProfilesByName } from '../_names.js';
import {
  tool, closed, text, int, num, bool, oneOf, list, dateStr, RISK,
  ask, notFound, pick, listed, shown, did, lower, words, day, paiseOf, need, decisionArg,
} from './_kit.js';

/**
 * Finance routes that had no assistant tool (part 6).
 *
 *   fees           the academic years a caller has fee records for, one year's
 *                  overview, one fee plan in full, one payment's audit trail
 *                  and who a fee reminder would reach before it is sent.
 *   seats          the seat ledger, the school's per-seat price history and one
 *                  extra-seat request.
 *   procurement    figures, vendors (add one; record due diligence as the
 *                  approver's own decision; declare a conflict), one purchase
 *                  request, quotes, submit / cancel, and the purchase-order
 *                  steps (issue the PO, receive goods, book the vendor invoice),
 *                  the asset register.
 *   budgets        submit a draft budget for approval, explain a variance;
 *                  funding proposals (list, draft, submit, move along).
 *   bills          service accounts (list, add, change), bring reminders up to
 *                  date, one bill.
 *   concessions    add and change a concession scheme, one invoice's
 *                  adjustments; voucher summary and fee-head tax set-up.
 *   cash close     the closed days.
 *   scenarios      baseline, projection, comparison and saved scenarios.
 *
 * Left on screen (see the coverage result file): recording, approving,
 * rejecting and refunding fee payments and payment change requests, fee plan
 * publishing, procurement payment approval / initiation / confirmation,
 * recording funding disbursements and utilisation, cash-close verification,
 * payroll, gateway checkout, CSV/PDF downloads and spreadsheet imports, vendor
 * bank details.
 */

const r = (paise) => (paise === null || paise === undefined ? '—' : rupees(paise));

/* ── Fees ─────────────────────────────────────────────────── */

const feeTools = {
  list_fee_academic_years: tool({
    module: 'Fees', operation: 'GET',
    description: 'The academic years the caller has fee records for (a family sees only their own children\'s years), newest first, with how many invoices each holds. Read-only.',
    permission: 'fees.read',
    service: 'fee.service.listPaymentAcademicYears()',
    async run(ctx) {
      const rows = await fees.listPaymentAcademicYears(ctx.actor, ctx.scope);
      return listed(rows, (y) => `${y.name}${y.isCurrent ? ' (current)' : ''}: ${y.invoiceCount} invoice(s)`, { noun: 'academic year' });
    },
  }),

  get_fee_year_statement: tool({
    module: 'Fees', operation: 'GET', resultShape: 'SUMMARY', // one year's account as totals; "how much is pending" is get_pending_fees
    description: 'One academic year\'s fees for the caller in one answer: totals billed, paid and outstanding, the published installment plans, the invoices and the settled payments. A family sees only their own children; the current year when none is named. Read-only.',
    inputSchema: closed({ academicYear: text(20, 'e.g. "2026-27"; default the current year') }),
    permission: 'fees.read',
    service: 'fee.service.getStudentPaymentOverview()',
    async run(ctx, args) {
      let academicYearId;
      if (args.academicYear) {
        const years = await fees.listPaymentAcademicYears(ctx.actor, ctx.scope);
        academicYearId = pick(years, args.academicYear, { label: 'academic year', nameOf: (y) => y.name, refOf: () => null }).id;
      }
      const o = await fees.getStudentPaymentOverview(ctx.actor, ctx.scope, { academicYearId });
      if (!o.academicYearId) return shown(o, 'There are no fee records yet.');
      const s = o.summary ?? {};
      return shown(o, `${o.academicYearName}: ${o.invoices.length} invoice(s), ${o.payments.length} payment(s), ${o.plans.length} plan(s); ${r(s.totalPaise)} billed, ${r(s.paidPaise)} paid, ${r(s.outstandingPaise)} outstanding.`);
    },
  }),

  get_installment_plan_breakdown: tool({
    module: 'Fees', operation: 'GET',
    description: 'One installment / part-payment plan in full: each installment with its due date, invoice and what is paid, and who created, submitted, reviewed, approved or rejected it and when. Name the student (and the plan when they have several). A family sees only their own children\'s published plans. Read-only.',
    // `forStudent`, not studentName: a plan is named by its plan, and a student
    // target would make this detail read the answer to every "show Rahul's
    // fees" (get_pending_fees' question).
    inputSchema: closed({ forStudent: text(80, 'Whose plan, e.g. "Rahul Sharma"'), plan: text(120, 'The plan\'s name, when the student has more than one') }),
    permission: 'fees.read',
    service: 'plan.service.listFeePlans() + getFeePlanDetail()',
    async run(ctx, args) {
      const studentId = args.forStudent ? await resolveStudentId(ctx, { studentName: args.forStudent }) : undefined;
      const rows = await plans.listFeePlans(ctx.actor, ctx.scope, studentId ? { studentId } : {});
      const p = pick(rows, args.plan, { label: 'fee plan', nameOf: (x) => x.name, refOf: () => null, describe: (x) => `"${x.name}" (${words(x.status)})` });
      const d = await plans.getFeePlanDetail(ctx.actor, ctx.scope, p.id);
      return shown(d, `${d.name}${d.studentName ? ` for ${d.studentName}` : ''}: ${r(d.totalPaise)} in ${d.installments.length} installment(s), ${r(d.paidPaise)} paid, ${r(d.remainingPaise)} remaining; ${words(d.status)}.`);
    },
  }),

  get_payment_audit_trail: tool({
    module: 'Fees', operation: 'GET',
    description: 'The full audit trail of one fee payment: who recorded it and in what role, who verified or rejected it and why, every change request and every audited change with before and after. Name it by receipt number or by the invoice it is on. Read-only.',
    inputSchema: closed({ receiptNo: text(40), invoiceNo: text(40, 'e.g. "INV-1001"') }),
    permission: 'fees.read', minScope: 'ALL',
    service: 'fee.service.getPaymentHistory()',
    async run(_ctx, args) {
      const p = await resolvePayment({ receiptNo: args.receiptNo, invoiceNo: args.invoiceNo });
      const h = await fees.getPaymentHistory(p.id);
      return shown(h, `Receipt ${h.receiptNo}, ${r(h.amountPaise)} by ${words(h.mode)}: recorded by ${h.createdBy ?? 'unknown'}${h.approvedBy ? `, verified by ${h.approvedBy}` : ''}${h.rejectedBy ? `, rejected by ${h.rejectedBy} (${h.rejectionReason ?? 'no reason'})` : ''}; ${h.trail.length} audited change(s), ${h.changeRequests.length} change request(s).`);
    },
  }),

  get_reminder_preview: tool({
    module: 'Finance reports', operation: 'GET',
    description: 'Who a fee reminder would reach, before anything is sent: the overdue students chosen by ageing bucket, class or minimum days overdue (families on a fee plan left out unless asked), with the amount and how many have no guardian to message. Sends nothing. Read-only.',
    inputSchema: closed({
      bucket: oneOf(['0-30', '31-60', '61-90', '90+']), className: text(40, 'e.g. "Class 8 B"'),
      minDays: int(1, 365, 'At least this many days overdue'), includePlans: bool('Include families on an approved fee plan'),
    }),
    permission: 'fees.read', minScope: 'ALL',
    service: 'collections.service.reminderPreview()',
    async run(ctx, args) {
      // Guardian profile ids stay on the server, exactly as the route strips them.
      const { guardianIds: _g, ...p } = await collections.reminderPreview(ctx.actor, args);
      return shown(p, p.students ? `${p.students} student(s), ${r(p.amountPaise)} overdue would be reminded${p.withoutGuardian ? `; ${p.withoutGuardian} have no guardian to message` : ''}.` : 'No overdue family matches that choice.');
    },
  }),
};

/* ── Seats ────────────────────────────────────────────────── */

const seatTools = {
  list_seat_purchases: tool({
    module: 'Seats', operation: 'GET',
    description: "This school's seat ledger, newest first: every purchase, approval and correction with the seats before and after, the amount and who made it. Read-only.",
    inputSchema: closed({ limit: int(1, 200, 'Default 50') }),
    permission: 'seats.read', minScope: 'ALL',
    service: 'seat.service.listSeatHistory()',
    async run(_ctx, args) {
      const rows = await seatService.listSeatHistory({ limit: args.limit });
      return listed(rows, (e) => `${day(e.at)} ${words(e.event)} ${e.purchasedDelta >= 0 ? '+' : ''}${e.purchasedDelta} bought / ${e.approvedDelta >= 0 ? '+' : ''}${e.approvedDelta} approved`, { noun: 'seat movement' });
    },
  }),

  list_seat_price_changes: tool({
    module: 'Seats', operation: 'GET',
    description: "Every version of this school's per-seat price, newest first, including superseded and deactivated ones, so an old charge can be explained. Read-only.",
    inputSchema: closed({ limit: int(1, 200, 'Default 50') }),
    permission: 'seats.read', minScope: 'ALL',
    service: 'seatPrice.service.listSeatPrices()',
    async run(_ctx, args) {
      const rows = await seatPrices.listSeatPrices(undefined, { limit: args.limit });
      return listed(rows, (p) => `${r(p.unitPricePaise)} per seat from ${day(p.effectiveFrom)}${p.effectiveTo ? ` to ${day(p.effectiveTo)}` : ''} (${words(p.status)})`, { noun: 'price version', speak: rows.length ? undefined : 'No school-specific seat price has been set; the platform default applies.' });
    },
  }),

  get_seat_request: tool({
    module: 'Seats', operation: 'GET',
    description: "One of this school's extra-seat requests in full: seats, price and discount, amount, payment status and receipt, and the platform's decision. Name it by receipt number or by the number of seats asked for. Read-only.",
    inputSchema: closed({ receiptNo: text(40), seats: int(1, 100000, 'How many seats the request was for') }),
    permission: 'seats.read', minScope: 'ALL',
    service: 'seat.service.listSeatRequests() + getSeatRequest()',
    async run(_ctx, args) {
      let rows = await seatService.listSeatRequests({ limit: 200 });
      if (args.seats) rows = rows.filter((x) => x.seats === args.seats);
      const one = pick(rows, args.receiptNo, { label: 'seat request', nameOf: (x) => `${x.seats} seats`, refOf: (x) => x.receiptNo, describe: (x) => `${x.seats} seats on ${day(x.pricedAt)} (${words(x.status)})` });
      const q = await seatService.getSeatRequest(one.id);
      return shown(q, `${q.seats} seats for ${r(q.amountPaise)}: ${words(q.status)}, payment ${words(q.paymentStatus)}${q.receiptNo ? ` (receipt ${q.receiptNo})` : ''}${q.decidedBy ? `; decided by ${q.decidedBy}` : ''}.`);
    },
  }),
};

/* ── Procurement ──────────────────────────────────────────── */

async function vendorNamed(ctx, name, keep = () => true) {
  const rows = (await procurement.listVendors(ctx.actor)).filter(keep);
  return pick(rows, name, { label: 'vendor', nameOf: (v) => v.name, refOf: (v) => v.gstin, describe: (v) => `${v.name}${v.category ? ` (${v.category})` : ''}` });
}

async function allRequests(ctx, scope, status) {
  const out = [];
  for (let page = 1; page <= 25; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await procurement.listRequests(ctx.actor, scope, { page, pageSize: 200, ...(status && { status }) });
    out.push(...res.items);
    if (page >= res.totalPages) break;
  }
  return out;
}

async function requestNamed(ctx, scope, term, { statuses = null, label = 'purchase request' } = {}) {
  let rows = await allRequests(ctx, scope);
  if (statuses) rows = rows.filter((p) => statuses.includes(p.status));
  return pick(rows, term, { label, nameOf: (p) => p.title, refOf: (p) => p.refNo, describe: (p) => `${p.refNo} ${p.title} (${words(p.status)})` });
}

const manageScope = (ctx) => (ctx.actor?.permissions?.['procurement.manage'] ? 'ALL' : 'OWN');

const vendorInput = {
  name: text(160), category: text(60, 'e.g. "Stationery", "IT", "Transport"'),
  gstin: text(15, '15-character GSTIN'), contactName: text(120), phone: text(20), email: text(120), address: text(500),
};

const procurementTools = {
  get_procurement_stats: tool({
    module: 'Procurement', operation: 'GET',
    description: 'Purchasing at a glance: purchase requests waiting for approval, orders waiting for goods, invoices waiting for payment, and the approved budgets\' planned, committed and spent totals with how many lines are over budget. Read-only.',
    permission: 'procurement.read',
    service: 'procurement.service.stats()',
    async run() {
      const s = await procurement.stats();
      return shown(s, `${s.purchaseRequestsInApproval} request(s) in approval, ${s.ordersAwaitingReceipt} order(s) awaiting goods, ${s.invoicesAwaitingPayment} invoice(s) awaiting payment; budgets ${r(s.budgetActualPaise)} spent and ${r(s.budgetCommittedPaise)} committed of ${r(s.budgetPlannedPaise)}, ${s.linesOverBudget} line(s) over budget.`);
    },
  }),

  list_vendors: tool({
    module: 'Procurement', operation: 'GET',
    description: 'The vendor register: name, category, GSTIN, contact, whether due diligence is done (active, pending or blocked) and the last four digits of the bank account. Declared conflicts are shown only to those who manage purchasing. Read-only.',
    inputSchema: closed({ vendor: text(80, 'Part of the name or category'), status: oneOf(['ACTIVE', 'PENDING_DUE_DILIGENCE', 'BLOCKED']) }),
    permission: 'procurement.read',
    service: 'procurement.service.listVendors()',
    async run(ctx, args) {
      let rows = await procurement.listVendors(ctx.actor);
      if (args.status) rows = rows.filter((v) => v.status === args.status);
      if (args.vendor) rows = rows.filter((v) => lower(`${v.name} ${v.category ?? ''}`).includes(lower(args.vendor)));
      return listed(rows, (v) => `${v.name}${v.category ? ` (${v.category})` : ''} — ${words(v.status)}`, { noun: 'vendor' });
    },
  }),

  create_vendor: tool({
    module: 'Procurement', operation: 'CREATE', risk: RISK.HIGH, affectsOthers: true,
    description: 'For purchasing staff: add a vendor to the register (name, category, GSTIN, contact person, phone, email, address). It starts pending due diligence, so no purchase order can go to it until that is recorded. Bank details are entered on the Procurement page. Confirmed on the website.',
    inputSchema: closed(vendorInput, ['name']),
    permission: 'procurement.manage',
    service: 'procurement.service.createVendor()',
    summarise: (a) => `Add vendor "${a.name}"${a.category ? ` (${a.category})` : ''}${a.gstin ? `, GSTIN ${String(a.gstin).toUpperCase()}` : ''}${a.contactName ? `, contact ${a.contactName}` : ''}${a.phone ? ` ${a.phone}` : ''}. It starts pending due diligence.`,
    async run(ctx, args) {
      const v = await procurement.createVendor(ctx.actor, args);
      return did('vendor_created', v, `Added ${v.name}; record its due diligence before a purchase order can be issued to it.`);
    },
  }),

  record_vendor_due_diligence: tool({
    module: 'Procurement', operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true, approverDecision: true,
    description: "Record the purchasing approver's own due-diligence decision on a vendor: CLEARED (the vendor becomes active and can receive purchase orders) or BLOCKED, with the note of what was checked. Recorded only when the approver states the decision in their own words; never suggested. Confirmed on the website.",
    inputSchema: closed({
      vendor: text(160, 'The vendor\'s name or GSTIN'),
      decision: decisionArg(['CLEARED', 'BLOCKED']),
      note: text(2000, 'What was checked (documents, references, site visit) and the finding'),
      verificationCaseId: text(40),
    }, ['vendor', 'decision', 'note']),
    permission: 'procurement.manage',
    service: 'procurement.service.vendorDueDiligence()',
    async prepare(ctx, args) { const v = await vendorNamed(ctx, args.vendor); return { id: v.id, name: v.name, from: v.status }; },
    summarise: (a, _actor, p) => `Record due diligence on ${p?.name ?? a.vendor}: ${a.decision === 'CLEARED' ? 'cleared (active)' : 'blocked'} — ${a.note}`,
    async run(ctx, args, p) {
      const v = await procurement.vendorDueDiligence(ctx.actor, p.id, { status: args.decision === 'CLEARED' ? 'ACTIVE' : 'BLOCKED', note: args.note, verificationCaseId: args.verificationCaseId });
      return did('vendor_due_diligence_recorded', v, `${v.name} is now ${words(v.status)}.`);
    },
  }),

  declare_vendor_conflict: tool({
    module: 'Procurement', operation: 'ACTION',
    description: 'For any member of staff: declare your own relationship with a vendor (a relative works there, you hold shares ...). You are then kept out of approving purchases from it. Needs confirmation.',
    inputSchema: closed({ vendor: text(160), declaration: text(1000, 'The relationship, in your words') }, ['vendor', 'declaration']),
    permission: 'procurement.request',
    service: 'procurement.service.declareVendorConflict()',
    async prepare(ctx, args) { const v = await vendorNamed(ctx, args.vendor); return { id: v.id, name: v.name }; },
    summarise: (a, _actor, p) => `Declare your relationship with ${p?.name ?? a.vendor}: "${a.declaration}". You will not approve its purchases.`,
    async run(ctx, args, p) {
      await procurement.declareVendorConflict(ctx.actor, p.id, { declaration: args.declaration });
      return did('vendor_conflict_declared', { id: p.id }, `Declared. You will be kept out of approving purchases from ${p.name}.`);
    },
  }),

  get_purchase_request: tool({
    module: 'Procurement', operation: 'GET',
    description: 'One purchase request in full: items, quotes and the one selected, the pre-approval checks, the purchase order, goods received, invoices and their three-way match, payment stage and history. Staff see their own; purchasing sees all. Name it by PR reference or title. Read-only.',
    inputSchema: closed({ request: text(200, 'PR reference (e.g. "PR-000012") or title') }, ['request']),
    permission: 'procurement.read',
    service: 'procurement.service.listRequests() + getRequestById()',
    async run(ctx, args) {
      const p = await requestNamed(ctx, ctx.scope, args.request);
      const d = await procurement.getRequestById(ctx.actor, ctx.scope, p.id);
      return shown(d, `${d.refNo} ${d.title}: ${words(d.status)}, ${r(d.amountPaise)}, ${d.items.length} item(s), ${d.quotes.length} quote(s)${d.po?.number ? `, PO ${d.po.number}` : ''}${d.receivedPct ? `, ${d.receivedPct}% received` : ''}.`);
    },
  }),

  set_purchase_quotes: tool({
    module: 'Procurement', operation: 'UPDATE', risk: RISK.HIGH, affectsOthers: true,
    description: 'Attach the vendor quotes to a draft purchase request (vendor from the register, amount in rupees, valid-till date, a link to the quote) and mark the one to go with. Purchases of ₹50,000 or more need three quotes; choosing other than the lowest needs a note saying why. Replaces the quotes already on it. Confirmed on the website.',
    inputSchema: closed({
      request: text(200, 'PR reference or title'),
      quotes: list(closed({
        vendor: text(160), amountRupees: num(0.01, 1e10), validTill: dateStr('YYYY-MM-DD'), quoteLink: text(1000, 'https link to the quote'), selected: bool('The quote to go with'),
      }, ['vendor', 'amountRupees']), 10),
      selectionNote: text(2000, 'Why the selected quote, when it is not the lowest'),
    }, ['request', 'quotes']),
    permission: 'procurement.request',
    service: 'procurement.service.setQuotes()',
    async prepare(ctx, args) {
      const p = await requestNamed(ctx, manageScope(ctx), args.request, { statuses: ['DRAFT'], label: 'draft purchase request' });
      const vendors = await procurement.listVendors(ctx.actor);
      const quotes = args.quotes.map((q) => {
        const v = pick(vendors, q.vendor, { label: 'vendor', nameOf: (x) => x.name, refOf: (x) => x.gstin });
        return { vendorId: v.id, vendorName: v.name, amountPaise: paiseOf(q.amountRupees, 'quote amount'), validTill: q.validTill, url: q.quoteLink, selected: q.selected === true };
      });
      return { id: p.id, refNo: p.refNo, title: p.title, quotes };
    },
    summarise: (a, _actor, p) => `Set ${p?.quotes?.length ?? a.quotes.length} quote(s) on ${p?.refNo ?? a.request}: ${(p?.quotes ?? []).map((q) => `${q.vendorName} ${r(q.amountPaise)}${q.selected ? ' (selected)' : ''}`).join('; ')}${a.selectionNote ? ` — ${a.selectionNote}` : ''}`,
    async run(ctx, args, p) {
      const out = await procurement.setQuotes(ctx.actor, manageScope(ctx), p.id, { quotes: p.quotes.map(({ vendorName: _n, ...q }) => q), selectionNote: args.selectionNote });
      return did('purchase_quotes_set', out, `${out.refNo} now has ${out.quotes.length} quote(s)${out.selectedQuote ? `; going with ${out.selectedQuote.vendorName}` : ''}.`);
    },
  }),

  transition_purchase_request: tool({
    module: 'Procurement', operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true,
    description: 'Send a draft purchase request of your own for approval (the quote, budget and split-purchase checks run first and travel with it to the approvers), or cancel a request with a reason (purchasing may cancel any; a committed amount is released from the budget). Approving stays with the approvers. Confirmed on the website.',
    inputSchema: closed({ request: text(200, 'PR reference or title'), step: oneOf(['submit', 'cancel']), reason: text(500, 'Required to cancel') }, ['request', 'step']),
    permission: 'procurement.request',
    service: 'procurement.service.submit() / cancel()',
    async prepare(ctx, args) {
      if (args.step === 'cancel' && !args.reason) throw ask('Why is it being cancelled?');
      const p = args.step === 'submit'
        ? await requestNamed(ctx, 'OWN', args.request, { statuses: ['DRAFT'], label: 'draft purchase request of yours' })
        : await requestNamed(ctx, manageScope(ctx), args.request, { statuses: ['DRAFT', 'APPROVED', 'PO_ISSUED'], label: 'purchase request that can be cancelled' });
      return { id: p.id, refNo: p.refNo, title: p.title, amountPaise: p.amountPaise };
    },
    summarise: (a, _actor, p) => (a.step === 'submit'
      ? `Send ${p?.refNo ?? a.request} "${p?.title ?? ''}" (${r(p?.amountPaise)}) for approval`
      : `Cancel ${p?.refNo ?? a.request} "${p?.title ?? ''}" — ${a.reason}`),
    async run(ctx, args, p) {
      const out = args.step === 'submit'
        ? await procurement.submit(ctx.actor, 'OWN', p.id)
        : await procurement.cancel(ctx.actor, manageScope(ctx), p.id, { reason: args.reason });
      return did(`purchase_request_${args.step}`, out, `${out.refNo} is now ${words(out.status)}.${(out.checks ?? []).length ? ` Checks sent with it: ${out.checks.map((c) => c.message).join(' ')}` : ''}`);
    },
  }),

  move_purchase_request: tool({
    module: 'Procurement', operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true,
    description: "For purchasing staff, the purchase-order steps after approval: issue_po (to the selected vendor; one not yet through due diligence needs an override and a reason), receive_goods (quantities received and rejected per item, or everything still due; never by the person who asked for it) or book_invoice (the vendor's invoice number, amount and date; it is matched against the order and the goods accepted). Approving and making the payment stay on the Procurement page. Confirmed on the website.",
    inputSchema: closed({
      request: text(200, 'PR reference, PO number or title'),
      step: oneOf(['issue_po', 'receive_goods', 'book_invoice']),
      overrideDueDiligence: bool('issue_po: issue before the vendor\'s due diligence is done'),
      overrideReason: text(1000, 'issue_po: why, when overriding'),
      lines: list(closed({ item: text(300, 'The item as written on the request'), received: int(0, 1e6), rejected: int(0, 1e6) }, ['item']), 100, 'receive_goods: per item; leave out to receive everything still due'),
      note: text(1000, 'receive_goods: delivery note'),
      vendorInvoiceNo: text(60, 'book_invoice'), amountRupees: num(0.01, 1e10, 'book_invoice'), taxRupees: num(0, 1e10, 'book_invoice'),
      invoiceDate: dateStr('book_invoice: YYYY-MM-DD'), invoiceUrl: text(1000, 'book_invoice: https link to the invoice'),
    }, ['request', 'step']),
    permission: 'procurement.manage',
    service: 'procurement.service.issuePo() / receive() / addInvoice()',
    async prepare(ctx, args) {
      const statuses = { issue_po: ['APPROVED'], receive_goods: ['PO_ISSUED', 'PARTIALLY_RECEIVED'], book_invoice: ['RECEIVED', 'INVOICED'] }[args.step];
      let rows = (await allRequests(ctx, 'ALL')).filter((x) => statuses.includes(x.status));
      const byPo = rows.filter((x) => args.request && lower(x.po?.number) === lower(args.request));
      if (byPo.length === 1) rows = byPo;
      const p = pick(rows, byPo.length === 1 ? null : args.request, { label: `purchase request ready to ${words(args.step)}`, nameOf: (x) => x.title, refOf: (x) => x.refNo, describe: (x) => `${x.refNo} ${x.title} (${words(x.status)})` });
      const base = { id: p.id, refNo: p.refNo, title: p.title, vendor: p.selectedQuote?.vendorName ?? p.po?.vendorName ?? null };
      if (args.step === 'issue_po') {
        if (args.overrideDueDiligence && !args.overrideReason) throw ask('Why is the order issued before the vendor\'s due diligence?');
        return { ...base, amountPaise: p.selectedQuote?.amountPaise ?? null };
      }
      if (args.step === 'receive_goods') {
        const items = (p.items ?? []).map((it, index) => ({ ...it, index }));
        const lines = args.lines?.length
          ? args.lines.map((l) => {
            const it = pick(items, l.item, { label: 'item on this order', nameOf: (x) => x.description, refOf: () => null });
            return { itemIndex: it.index, description: it.description, received: l.received ?? 0, rejected: l.rejected ?? 0 };
          })
          : items.filter((it) => it.qty > (it.receivedQty ?? 0)).map((it) => ({ itemIndex: it.index, description: it.description, received: it.qty - (it.receivedQty ?? 0), rejected: 0 }));
        if (!lines.length) throw ask('Nothing is still due on this order. Which item and how many?');
        return { ...base, lines };
      }
      if (!args.vendorInvoiceNo || !args.amountRupees) throw ask('Give the vendor\'s invoice number and its amount.');
      return { ...base, amountPaise: paiseOf(args.amountRupees, 'amountRupees') };
    },
    summarise: (a, _actor, p) => {
      const ref = `${p?.refNo ?? a.request}${p?.title ? ` "${p.title}"` : ''}`;
      if (a.step === 'issue_po') return `Issue the purchase order for ${ref} to ${p?.vendor ?? 'the selected vendor'}${p?.amountPaise ? ` for ${r(p.amountPaise)}` : ''}${a.overrideDueDiligence ? ` before due diligence — ${a.overrideReason}` : ''}`;
      if (a.step === 'receive_goods') return `Record goods received on ${ref}: ${(p?.lines ?? []).map((l) => `${l.received} ${l.description}${l.rejected ? ` (${l.rejected} rejected)` : ''}`).join('; ')}`;
      return `Book ${p?.vendor ?? 'the vendor'}'s invoice ${String(a.vendorInvoiceNo ?? '').toUpperCase()} for ${r(p?.amountPaise)} on ${ref}; it is matched against the order and the goods accepted`;
    },
    async run(ctx, args, p) {
      let out;
      if (args.step === 'issue_po') out = await procurement.issuePo(ctx.actor, 'ALL', p.id, { overrideDueDiligence: args.overrideDueDiligence === true, overrideReason: args.overrideReason });
      else if (args.step === 'receive_goods') out = await procurement.receive(ctx.actor, 'ALL', p.id, { lines: p.lines.map(({ description: _d, ...l }) => l), note: args.note });
      else {
        out = await procurement.addInvoice(ctx.actor, 'ALL', p.id, {
          vendorInvoiceNo: args.vendorInvoiceNo, amountPaise: p.amountPaise, taxPaise: args.taxRupees ? Math.round(args.taxRupees * 100) : 0, invoiceDate: args.invoiceDate, url: args.invoiceUrl,
        });
      }
      const inv = out.invoices?.at?.(-1);
      const extra = args.step === 'issue_po' ? ` PO ${out.po?.number}.` : args.step === 'book_invoice' ? ` Match: ${words(inv?.matchStatus)}${inv?.matchNote ? ` — ${inv.matchNote}` : ''}.` : ` ${out.receivedPct}% received.`;
      return did(`purchase_${args.step}`, out, `${out.refNo} is now ${words(out.status)}.${extra}`);
    },
  }),

  list_procurement_assets: tool({
    module: 'Procurement', operation: 'GET',
    description: 'The asset register: tag, description, cost, date acquired, vendor, status (in use, in store, under repair, disposed) and warranty. Read-only.',
    inputSchema: closed({ search: text(80, 'Tag or part of the description'), status: oneOf(['IN_USE', 'IN_STORE', 'UNDER_REPAIR', 'DISPOSED']) }),
    permission: 'procurement.read',
    service: 'procurement.service.listAssets()',
    async run(_ctx, args) {
      let rows = await procurement.listAssets();
      if (args.status) rows = rows.filter((a) => a.status === args.status);
      if (args.search) rows = rows.filter((a) => lower(`${a.tag} ${a.description}`).includes(lower(args.search)));
      return listed(rows, (a) => `${a.tag} ${a.description} (${words(a.status ?? 'IN_USE')})`, { noun: 'asset' });
    },
  }),

  update_procurement_asset: tool({
    module: 'Procurement', operation: 'UPDATE', affectsOthers: true,
    description: 'For purchasing staff: change an asset in the register — its status (in use, in store, under repair, disposed), the room or place it is in, the member of staff responsible for it, or its warranty end date. Name it by tag (e.g. "AST-00012") or description. Confirmed on the website.',
    inputSchema: closed({
      asset: text(200, 'Tag or description'), status: oneOf(['IN_USE', 'IN_STORE', 'UNDER_REPAIR', 'DISPOSED']),
      place: text(160, 'Room or facility by name'), custodian: text(120, 'The staff member responsible, by name'), warrantyUntil: dateStr('YYYY-MM-DD'),
    }, ['asset']),
    permission: 'procurement.manage',
    service: 'procurement.service.updateAsset()',
    async prepare(ctx, args) {
      const a = pick(await procurement.listAssets(), args.asset, { label: 'asset', nameOf: (x) => x.description, refOf: (x) => x.tag, describe: (x) => `${x.tag} ${x.description}` });
      const body = {};
      if (args.status) body.status = args.status;
      if (args.warrantyUntil) body.warrantyUntil = args.warrantyUntil;
      let place = null;
      let custodian = null;
      if (args.place) {
        const f = pick(await facilities.listFacilities(ctx.actor, {}), args.place, { label: 'room or facility', nameOf: (x) => x.name, refOf: (x) => x.code });
        body.facilityId = f.id; place = f.name;
      }
      if (args.custodian) {
        [custodian] = await resolveProfilesByName([args.custodian]);
        body.custodianProfileId = custodian.id;
      }
      if (!Object.keys(body).length) throw ask('What should change: status, place, the person responsible or the warranty date?');
      return { id: a.id, tag: a.tag, description: a.description, body, place, custodian: custodian?.name ?? null };
    },
    summarise: (a, _actor, p) => `Update ${p?.tag ?? a.asset} ${p?.description ?? ''}: ${[a.status && `status ${words(a.status)}`, p?.place && `in ${p.place}`, p?.custodian && `responsible ${p.custodian}`, a.warrantyUntil && `warranty until ${a.warrantyUntil}`].filter(Boolean).join(', ')}`,
    async run(_ctx, _args, p) {
      const a = await procurement.updateAsset(p.id, p.body);
      return did('procurement_asset_updated', a, `${a.tag} updated.`);
    },
  }),
};

/* ── Budgets and funding ──────────────────────────────────── */

async function budgetNamed(term, keep = () => true) {
  const rows = (await procurement.listBudgets()).filter(keep);
  return pick(rows, term, { label: 'budget', nameOf: (b) => b.name, refOf: () => null, describe: (b) => `${b.name} ${b.fiscalYear} (${words(b.status)})` });
}

async function fundingNamed(term, keep = () => true, label = 'funding proposal') {
  const rows = (await procurement.listFunding()).filter(keep);
  return pick(rows, term, { label, nameOf: (f) => f.title, refOf: (f) => f.refNo, describe: (f) => `${f.refNo} ${f.title} (${words(f.status)})` });
}

const FUNDING_STEPS = { submit: null, applied: 'APPLIED', sanctioned: 'SANCTIONED', closed: 'CLOSED' };
const FUNDING_FROM = { submit: ['DRAFT'], applied: ['APPROVED'], sanctioned: ['APPROVED', 'APPLIED'], closed: ['APPROVED', 'APPLIED', 'SANCTIONED', 'DISBURSED'] };

const budgetTools = {
  submit_budget: tool({
    module: 'Budgets', operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true,
    description: 'Send a draft budget for approval: it goes to the approvals inbox with every line and its planned amount. The approvers decide; nothing is committed until they do. Confirmed on the website.',
    inputSchema: closed({ budget: text(120, 'The budget\'s name') }, ['budget']),
    permission: 'budget.manage',
    service: 'procurement.service.submitBudget()',
    async prepare(_ctx, args) {
      const b = await budgetNamed(args.budget, (x) => x.status === 'DRAFT');
      return { id: b.id, name: b.name, fiscalYear: b.fiscalYear, lines: b.lines.length, planned: b.totals.planned };
    },
    summarise: (a, _actor, p) => `Send the ${p?.fiscalYear ?? ''} budget "${p?.name ?? a.budget}" (${p?.lines ?? '?'} line(s), ${r(p?.planned)} planned) for approval`,
    async run(ctx, _args, p) {
      const b = await procurement.submitBudget(ctx.actor, p.id);
      return did('budget_submitted', b, `"${b.name}" is now ${words(b.status)}.`);
    },
  }),

  add_budget_variance_note: tool({
    module: 'Budgets', operation: 'CREATE',
    description: 'Write the explanation for a budget line that is over or under plan (why the spend differs), so it travels with the budget report. Name the budget and the line by code or head. Needs confirmation.',
    inputSchema: closed({ budget: text(120), line: text(120, 'Line code (e.g. "LAB-01") or head'), explanation: text(2000) }, ['budget', 'line', 'explanation']),
    permission: 'budget.manage',
    service: 'procurement.service.explainVariance()',
    async prepare(_ctx, args) {
      const b = await budgetNamed(args.budget);
      const l = pick(b.lines, args.line, { label: 'budget line', nameOf: (x) => x.head, refOf: (x) => x.code, describe: (x) => `${x.code} ${x.head}` });
      return { id: b.id, name: b.name, code: l.code, head: l.head, variancePaise: l.variancePaise };
    },
    summarise: (a, _actor, p) => `Explain the variance on ${p?.code ?? a.line} ${p?.head ?? ''} of "${p?.name ?? a.budget}"${p ? ` (${r(p.variancePaise)})` : ''}: "${a.explanation}"`,
    async run(ctx, args, p) {
      const b = await procurement.explainVariance(ctx.actor, p.id, { code: p.code, explanation: args.explanation });
      return did('budget_variance_explained', b, `Saved the explanation on ${p.code}.`);
    },
  }),

  list_funding_proposals: tool({
    module: 'Budgets', operation: 'GET',
    description: 'Funding proposals (loans, grants, donations, CSR, government schemes, internal reserves): amount asked, the offers compared by EMI and total cost, the status, and what has been disbursed and used. Read-only.',
    inputSchema: closed({ status: oneOf(['DRAFT', 'IN_APPROVAL', 'APPROVED', 'REJECTED', 'APPLIED', 'SANCTIONED', 'DISBURSED', 'CLOSED']) }),
    permission: 'funding.read',
    service: 'procurement.service.listFunding()',
    async run(_ctx, args) {
      let rows = await procurement.listFunding();
      if (args.status) rows = rows.filter((f) => f.status === args.status);
      return listed(rows, (f) => `${f.refNo} ${f.title} (${words(f.kind)}, ${r(f.amountRequestedPaise)}, ${words(f.status)})`, { noun: 'funding proposal' });
    },
  }),

  create_funding_proposal: tool({
    module: 'Budgets', operation: 'CREATE', risk: RISK.HIGH, affectsOthers: true,
    description: 'Draft a funding proposal: the kind (loan, grant, donation, CSR, government scheme, internal reserve), title, purpose, amount needed in rupees, whether it is restricted, and the offers to compare (provider, principal, annual interest %, tenure in months, processing fee, covenants; mark the preferred one). EMI and total cost are worked out. It stays a draft until submitted. Confirmed on the website.',
    inputSchema: closed({
      kind: oneOf(['LOAN', 'GRANT', 'DONATION', 'CSR', 'GOVERNMENT_SCHEME', 'INTERNAL_RESERVE']), title: text(200), purpose: text(4000),
      amountRupees: num(1, 1e11), restricted: bool('Restricted to the stated purpose'),
      offers: list(closed({
        provider: text(120), principalRupees: num(1, 1e11, 'Default the amount needed'), annualRatePct: num(0, 60), tenureMonths: int(0, 600),
        processingFeeRupees: num(0, 1e10), covenants: text(2000), selected: bool('The preferred offer'),
      }, ['provider']), 10),
    }, ['kind', 'title', 'amountRupees']),
    permission: 'funding.manage',
    service: 'procurement.service.createFunding()',
    summarise: (a) => `Draft a ${words(a.kind)} proposal "${a.title}" for ${rupees(Math.round(a.amountRupees * 100))}${a.offers?.length ? ` comparing ${a.offers.map((o) => `${o.provider}${o.annualRatePct !== undefined ? ` at ${o.annualRatePct}%` : ''}${o.tenureMonths ? ` over ${o.tenureMonths} months` : ''}${o.selected ? ' (preferred)' : ''}`).join('; ')}` : ''}`,
    async run(ctx, args) {
      const f = await procurement.createFunding(ctx.actor, {
        kind: args.kind, title: args.title, purpose: args.purpose, restricted: args.restricted === true,
        amountRequestedPaise: paiseOf(args.amountRupees, 'amountRupees'),
        offers: (args.offers ?? []).map((o) => ({
          provider: o.provider, principalPaise: o.principalRupees ? Math.round(o.principalRupees * 100) : undefined,
          annualRateBp: Math.round((o.annualRatePct ?? 0) * 100), tenureMonths: o.tenureMonths ?? 0,
          processingFeePaise: Math.round((o.processingFeeRupees ?? 0) * 100), covenants: o.covenants, selected: o.selected === true,
        })),
      });
      return did('funding_proposal_drafted', f, `Drafted ${f.refNo} "${f.title}".${f.offers?.length ? ` ${f.offers.map((o) => `${o.provider}: EMI ${r(o.emiPaise)}, total cost ${r(o.totalCostPaise)}`).join('; ')}.` : ''}`);
    },
  }),

  transition_funding_proposal: tool({
    module: 'Budgets', operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true,
    description: 'Move a funding proposal along: submit a draft for approval (the offers go to the approvers compared by total cost), or, once approved, mark it applied, sanctioned or closed, with a note. Approving stays with the approvers; recording money disbursed or used stays on the Budgets page. Confirmed on the website.',
    inputSchema: closed({ proposal: text(200, 'FND reference or title'), step: oneOf(Object.keys(FUNDING_STEPS)), note: text(1000) }, ['proposal', 'step']),
    permission: 'funding.manage',
    service: 'procurement.service.submitFunding() / updateFunding()',
    async prepare(_ctx, args) {
      const f = await fundingNamed(args.proposal, (x) => FUNDING_FROM[args.step].includes(x.status), `funding proposal that can be ${args.step === 'submit' ? 'submitted' : `marked ${args.step}`}`);
      return { id: f.id, refNo: f.refNo, title: f.title, from: f.status, amountPaise: f.amountRequestedPaise };
    },
    summarise: (a, _actor, p) => `${a.step === 'submit' ? 'Submit for approval' : `Mark ${a.step}`}: ${p?.refNo ?? a.proposal} "${p?.title ?? ''}" (${r(p?.amountPaise)})${a.note ? ` — ${a.note}` : ''}`,
    async run(ctx, args, p) {
      const f = args.step === 'submit'
        ? await procurement.submitFunding(ctx.actor, p.id)
        : await procurement.updateFunding(ctx.actor, p.id, { status: FUNDING_STEPS[args.step], note: args.note });
      return did(`funding_proposal_${args.step}`, f, `${f.refNo} is now ${words(f.status)}.`);
    },
  }),
};

/* ── Bills and service accounts ───────────────────────────── */

const accountInput = {
  category: oneOf(BILL_CATEGORIES), billingCycle: oneOf(BILLING_CYCLES, 'Default monthly'),
  vendorName: text(160), accountNo: text(80, "The provider's consumer / account number"), expectedAmountRupees: num(0, 1e10),
  nextDueOn: dateStr('Next bill due, YYYY-MM-DD'), contractStartsOn: dateStr(), contractEndsOn: dateStr(),
  noticeDays: int(0, 365, 'Notice to give before the contract ends'), autoRenews: bool(), visitsPerYear: int(0, 52, 'AMC visits a year'),
  notes: text(2000),
};

function accountBody(args) {
  const body = {};
  for (const k of ['category', 'billingCycle', 'vendorName', 'accountNo', 'nextDueOn', 'contractStartsOn', 'contractEndsOn', 'noticeDays', 'autoRenews', 'visitsPerYear', 'notes', 'status', 'firstVisitOn']) {
    if (args[k] !== undefined) body[k] = args[k];
  }
  if (args.expectedAmountRupees !== undefined) body.expectedAmountPaise = Math.round(args.expectedAmountRupees * 100);
  return body;
}

const describeAccount = (a) => [a.category && words(a.category), a.vendorName && `from ${a.vendorName}`, a.billingCycle && words(a.billingCycle), a.expectedAmountRupees !== undefined && `about ₹${Number(a.expectedAmountRupees).toLocaleString('en-IN')}`, a.nextDueOn && `next due ${a.nextDueOn}`, a.contractEndsOn && `contract ends ${a.contractEndsOn}`, a.status && `status ${words(a.status)}`].filter(Boolean).join(', ');

const billTools = {
  list_service_accounts: tool({
    module: 'Bills', operation: 'GET', feature: 'bills',
    description: 'The recurring services the school pays for (electricity, water, internet, AMCs, rent, insurance ...): vendor, account number, billing cycle, expected amount, next due date, contract end and notice date, bills on record, last amount and what is outstanding. Read-only.',
    inputSchema: closed({ category: oneOf(BILL_CATEGORIES), status: oneOf(['ACTIVE', 'PAUSED', 'ENDED']), search: text(60) }),
    permission: 'bills.read', minScope: 'ALL',
    service: 'bills.service.listAccounts()',
    async run(ctx, args) {
      const rows = await bills.listAccounts(ctx.actor, { category: args.category, status: args.status, q: args.search });
      return listed(rows, (a) => `${a.name} (${words(a.category)})${a.outstandingPaise ? `, ${r(a.outstandingPaise)} outstanding` : ''}${a.nextDueOn ? `, next due ${day(a.nextDueOn)}` : ''}`, { noun: 'service account' });
    },
  }),

  create_service_account: tool({
    module: 'Bills', operation: 'CREATE', feature: 'bills',
    description: 'Add a recurring service the school pays for: its name, category, vendor, account number, billing cycle, expected amount, next due date, contract dates and notice, and AMC visits a year (with the first visit date). Its expected-bill and visit reminders join the task queue. Needs confirmation.',
    inputSchema: closed({ name: text(160), ...accountInput, firstVisitOn: dateStr('First AMC visit, YYYY-MM-DD') }, ['name', 'category']),
    permission: 'bills.manage', minScope: 'ALL',
    service: 'bills.service.createAccount()',
    summarise: (a) => `Add the service "${a.name}": ${describeAccount(a)}`,
    async run(ctx, args) {
      const a = await bills.createAccount(ctx.actor, { name: args.name, ...accountBody(args) });
      return did('service_account_created', a, `Added ${a.refNo} ${a.name}.`);
    },
  }),

  update_service_account: tool({
    module: 'Bills', operation: 'UPDATE', feature: 'bills',
    description: 'Change a recurring service: vendor, account number, cycle, expected amount, next due date, contract dates and notice, AMC visits, notes, or pause / end it. Name it in words ("electricity", "lift AMC"). Its reminders follow. Needs confirmation.',
    inputSchema: closed({ account: text(160, 'The service, e.g. "electricity"'), rename: text(160), ...accountInput, status: oneOf(['ACTIVE', 'PAUSED', 'ENDED']) }, ['account']),
    permission: 'bills.manage', minScope: 'ALL',
    service: 'bills.service.listAccounts() + updateAccount()',
    async prepare(ctx, args) {
      const a = pick(await bills.listAccounts(ctx.actor, {}), args.account, { label: 'service account', nameOf: (x) => `${x.name} ${x.vendorName ?? ''} ${words(x.category)}`, refOf: (x) => x.refNo, describe: (x) => `${x.name}${x.vendorName ? ` (${x.vendorName})` : ''}` });
      const body = accountBody(args);
      if (args.rename) body.name = args.rename;
      if (!Object.keys(body).length) throw ask('What should change on it?');
      return { id: a.id, name: a.name, body };
    },
    summarise: (a, _actor, p) => `Update the service "${p?.name ?? a.account}": ${[a.rename && `rename to "${a.rename}"`, describeAccount(a)].filter(Boolean).join(', ')}`,
    async run(ctx, _args, p) {
      const a = await bills.updateAccount(ctx.actor, p.id, p.body);
      return did('service_account_updated', a, `${a.name} updated.`);
    },
  }),

  sync_bill_reminders: tool({
    module: 'Bills', operation: 'ACTION', affectsOthers: true, feature: 'bills',
    description: 'Bring every bill, expected-bill, service-visit and renewal reminder in the task queue up to date now (the same as the scheduled run): owners see the tasks that are due. Confirmed on the website.',
    permission: 'bills.manage', minScope: 'ALL',
    service: 'bills.service.runBillsDue() + renewals.service.syncRenewals()',
    summarise: () => 'Bring all bill, service-visit and renewal reminders in the task queue up to date now',
    async run() {
      const out = { bills: await bills.runBillsDue(), renewals: await syncRenewals() };
      return did('bill_reminders_synced', null, `Reminders brought up to date: ${out.bills.bills} bill(s), ${out.bills.accounts} account(s), ${out.bills.visits} visit(s), ${out.renewals?.synced ?? 0} renewal(s).`);
    },
  }),

  get_service_bill: tool({
    module: 'Bills', operation: 'GET', feature: 'bills',
    description: 'One bill in full: the service and account, bill number and date, amount, due date, payments recorded and confirmed, status and its history. Name it by reference ("BIL-000042"), the provider\'s bill number, or the service. Read-only.',
    inputSchema: closed({ billRef: text(40), billNo: text(60), account: text(160, 'The service in words, e.g. "electricity"') }),
    permission: 'bills.read', minScope: 'ALL',
    service: 'bills.service.listBills() + getBill()',
    async run(ctx, args) {
      const rows = [];
      for (let page = 1; page <= 25; page += 1) {
        // eslint-disable-next-line no-await-in-loop
        const res = await bills.listBills(ctx.actor, { page, pageSize: 200 });
        rows.push(...res.items);
        if (rows.length >= res.total || !res.items.length) break;
      }
      let pool = rows;
      if (args.billNo) pool = pool.filter((b) => lower(b.billNo) === lower(args.billNo));
      if (args.account) pool = pool.filter((b) => lower(`${b.accountName ?? ''} ${words(b.category)}`).includes(lower(args.account)));
      const b = pick(pool, args.billRef, { label: 'bill', nameOf: (x) => x.accountName ?? x.category, refOf: (x) => x.refNo, describe: (x) => `${x.refNo} ${x.accountName ?? words(x.category)} ${r(x.amountPaise)} due ${day(x.dueOn)}` });
      const d = await bills.getBill(ctx.actor, b.id);
      return shown(d, `${d.refNo} ${d.account?.name ?? words(d.category)}: ${r(d.amountPaise)} due ${day(d.dueOn)}, ${words(d.status)}${d.outstandingPaise ? `, ${r(d.outstandingPaise)} outstanding` : ''}.`);
    },
  }),
};

/* ── Concessions, accounts export, cash close ─────────────── */

async function feeHeadIdsOf(names = []) {
  const out = [];
  for (const n of names) {
    // eslint-disable-next-line no-await-in-loop
    const h = await resolveFeeHead({ feeHead: n });
    out.push(h);
  }
  return out;
}

const schemeInput = {
  kind: oneOf(CONCESSION_KINDS), method: oneOf(['PERCENT', 'FIXED', 'DISCRETIONARY'], 'PERCENT of the fee, a FIXED amount, or decided per case'),
  percent: num(0, 100, 'For a percentage scheme'), amountRupees: num(0, 1e9, 'For a fixed scheme'),
  feeHeads: list(text(120), 30, 'The fee heads it applies to, by name'), eligibility: text(1000),
};

function schemeBody(args, heads) {
  const body = {};
  for (const k of ['code', 'name', 'kind', 'method', 'eligibility', 'active']) if (args[k] !== undefined) body[k] = args[k];
  if (args.percent !== undefined) body.valueBp = Math.round(args.percent * 100);
  if (args.amountRupees !== undefined) body.amountPaise = Math.round(args.amountRupees * 100);
  if (heads) body.feeHeadIds = heads.map((h) => h.id);
  return body;
}

const describeScheme = (a, heads) => [a.kind && words(a.kind), a.method === 'PERCENT' || a.percent !== undefined ? a.percent !== undefined && `${a.percent}%` : null, a.amountRupees !== undefined && `₹${Number(a.amountRupees).toLocaleString('en-IN')}`, a.method === 'DISCRETIONARY' && 'decided per case', heads?.length && `on ${heads.map((h) => h.name).join(', ')}`, a.eligibility && `eligible: ${a.eligibility}`, a.active === false && 'inactive', a.active === true && 'active'].filter(Boolean).join(', ');

const adjustmentTools = {
  create_concession_scheme: tool({
    module: 'Fees', operation: 'CREATE', risk: RISK.HIGH, affectsOthers: true, feature: 'accountsExport',
    description: 'Add a fee concession scheme the school offers (sibling, staff ward, merit, RTE, need-based, sports ...): a short code, name, how it is worked out (a percentage, a fixed amount, or decided per case), the fee heads it applies to and who is eligible. Individual concessions are then requested against it and approved. Confirmed on the website.',
    inputSchema: closed({ code: { type: 'string', pattern: '^[A-Za-z0-9_-]{2,20}$' }, name: text(120), ...schemeInput }, ['code', 'name', 'kind', 'method']),
    permission: 'fees.concessions.manage', minScope: 'ALL',
    service: 'adjustment.service.createConcessionType()',
    async prepare(_ctx, args) {
      if (args.method === 'PERCENT' && !args.percent) throw ask('What percentage of the fee does it waive?');
      if (args.method === 'FIXED' && !args.amountRupees) throw ask('What fixed amount does it waive?');
      return { heads: await feeHeadIdsOf(args.feeHeads ?? []) };
    },
    summarise: (a, _actor, p) => `Add the concession scheme ${String(a.code).toUpperCase()} "${a.name}": ${describeScheme(a, p?.heads)}`,
    async run(ctx, args, p) {
      const t = await adjustments.createConcessionType(ctx.actor, schemeBody(args, p.heads.length ? p.heads : null));
      return did('concession_scheme_created', t, `Added the ${t.name} scheme (${t.code}).`);
    },
  }),

  update_concession_scheme: tool({
    module: 'Fees', operation: 'UPDATE', risk: RISK.HIGH, affectsOthers: true, feature: 'accountsExport',
    description: 'Change a fee concession scheme: its name, how it is worked out, the percentage or amount, the fee heads, eligibility, or switch it off / on. Concessions already applied are not changed. Confirmed on the website.',
    inputSchema: closed({ scheme: text(120, 'The scheme\'s name or code'), name: text(120), ...schemeInput, active: bool('false to stop offering it') }, ['scheme']),
    permission: 'fees.concessions.manage', minScope: 'ALL',
    service: 'adjustment.service.listConcessionTypes() + updateConcessionType()',
    async prepare(_ctx, args) {
      const t = pick(await adjustments.listConcessionTypes(), args.scheme, { label: 'concession scheme', nameOf: (x) => x.name, refOf: (x) => x.code });
      const heads = args.feeHeads ? await feeHeadIdsOf(args.feeHeads) : null;
      const body = schemeBody({ ...args, code: undefined }, heads);
      if (!Object.keys(body).length) throw ask('What should change on the scheme?');
      return { id: t.id, code: t.code, name: t.name, heads, body };
    },
    summarise: (a, _actor, p) => `Change the ${p?.name ?? a.scheme} concession scheme: ${[a.name && `rename to "${a.name}"`, describeScheme(a, p?.heads)].filter(Boolean).join(', ')}`,
    async run(ctx, _args, p) {
      const t = await adjustments.updateConcessionType(ctx.actor, p.id, p.body);
      return did('concession_scheme_updated', t, `${t.name} updated.`);
    },
  }),

  get_invoice_concession_history: tool({
    module: 'Fees', operation: 'GET', feature: 'accountsExport',
    description: 'One invoice as the concessions screen shows it: its lines with fee heads, every concession, credit note and void on it, what is outstanding, what is already reserved by pending requests and how much can still be adjusted. Read-only.',
    inputSchema: closed({ invoiceNo: text(40, 'e.g. "INV-1001"') }, ['invoiceNo']),
    permission: 'fees.concessions.manage', minScope: 'ALL',
    service: 'adjustment.service.invoiceForAdjustment()',
    async run(ctx, args) {
      const inv = await Invoice.findOne({ invoiceNo: String(args.invoiceNo).trim() }).select('_id').lean()
        ?? await Invoice.findOne({ invoiceNo: String(args.invoiceNo).trim().toUpperCase() }).select('_id').lean();
      if (!inv) throw notFound(`No invoice ${args.invoiceNo}.`);
      const d = await adjustments.invoiceForAdjustment(ctx.actor, String(inv._id));
      return shown(d, `${d.invoice.invoiceNo}: ${r(d.outstandingPaise)} outstanding, ${d.adjustments.length} adjustment(s), ${r(d.reservedPaise)} reserved by pending requests, ${r(d.adjustablePaise)} can still be adjusted.`);
    },
  }),

  get_voucher_summary: tool({
    module: 'Fees', operation: 'GET', feature: 'accountsExport',
    description: 'The accounting vouchers fee receipts, refunds and adjustments make for a period, summarised for the accountant: count and amount by voucher type, the ledgers used and the first vouchers as a sample. The Tally XML / CSV files are downloaded on the Accounts export page. Read-only.',
    inputSchema: closed({ from: dateStr('YYYY-MM-DD'), to: dateStr('YYYY-MM-DD') }, ['from', 'to']),
    permission: 'accounts.export', minScope: 'ALL',
    service: 'accounts-export.service.exportVouchers() (summary)',
    async run(ctx, args) {
      const out = await accountsExport.exportVouchers(ctx.actor, { from: args.from, to: args.to, format: 'summary' });
      const s = out.json;
      return shown(s, `${s.count} voucher(s) from ${args.from} to ${args.to}: ${Object.entries(s.byType).map(([t, v]) => `${words(t)} ${v.count} (${r(v.amountPaise)})`).join('; ') || 'none'}.`);
    },
  }),

  list_gst_rates: tool({
    module: 'Fees', operation: 'GET', feature: 'accountsExport',
    description: 'Each fee head with its GST rate and HSN/SAC code (or none), as used on invoices and the GST summary. Read-only.',
    permission: 'accounts.export', minScope: 'ALL',
    service: 'accounts-export.service.listFeeHeadTax()',
    async run() {
      const rows = await accountsExport.listFeeHeadTax();
      return listed(rows, (h) => `${h.name}: ${h.gstRateBp ? `${h.gstRateBp / 100}% GST${h.hsnSac ? ` (SAC ${h.hsnSac})` : ''}` : 'no GST'}`, { noun: 'fee head' });
    },
  }),

  set_fee_head_tax: tool({
    module: 'Fees', operation: 'UPDATE', risk: RISK.HIGH, affectsOthers: true, feature: 'accountsExport',
    description: 'Set the GST rate (0 for none) and the HSN/SAC code of a fee head; invoices raised from then on carry it. Needs both accounts export and fee structure permission. Confirmed on the website.',
    inputSchema: closed({ feeHead: text(120), gstPercent: num(0, 100, 'e.g. 18; 0 for no GST'), hsnSac: { type: 'string', pattern: '^\\d{4,8}$', description: '4 to 8 digits' } }, ['feeHead']),
    permission: 'accounts.export', minScope: 'ALL',
    guard: (ctx) => need(ctx, 'fees.structure.manage'),
    service: 'accounts-export.service.setFeeHeadTax()',
    async prepare(_ctx, args) {
      if (args.gstPercent === undefined && !args.hsnSac) throw ask('Give the GST rate, the HSN/SAC code, or both.');
      const h = pick(await accountsExport.listFeeHeadTax(), args.feeHead, { label: 'fee head', nameOf: (x) => x.name, refOf: () => null });
      return { id: h.id, name: h.name, before: h.gstRateBp ? `${h.gstRateBp / 100}%` : 'no GST' };
    },
    summarise: (a, _actor, p) => `Set ${p?.name ?? a.feeHead}${a.gstPercent !== undefined ? ` to ${a.gstPercent ? `${a.gstPercent}% GST` : 'no GST'} (was ${p?.before ?? '?'})` : ''}${a.hsnSac ? `, HSN/SAC ${a.hsnSac}` : ''}`,
    async run(ctx, args, p) {
      const h = await accountsExport.setFeeHeadTax(ctx.actor, p.id, { ...(args.gstPercent !== undefined && { gstRateBp: Math.round(args.gstPercent * 100) }), ...(args.hsnSac && { hsnSac: args.hsnSac }) });
      return did('fee_head_tax_set', h, `${h.name}: ${h.gstRateBp ? `${h.gstRateBp / 100}% GST` : 'no GST'}${h.hsnSac ? `, SAC ${h.hsnSac}` : ''}.`);
    },
  }),

  list_cash_closes: tool({
    module: 'Finance reports', operation: 'GET',
    description: 'The cash counter\'s closed days, newest first: cash counted against expected, the variance, receipts, deposit slip, who closed it and whether a second person has checked the count. Read-only.',
    inputSchema: closed({ limit: int(1, 366, 'Days, default 31') }),
    permission: 'fees.read', minScope: 'ALL',
    service: 'collections.service.listCloses()',
    async run(ctx, args) {
      const out = await collections.listCloses(ctx.actor, { limit: args.limit });
      const rows = out.items.map(({ history: _h, ...c }) => c);
      return listed(rows, (c) => `${c.day}: counted ${r(c.countedPaise)} vs ${r(c.expectedCashPaise)} expected${c.variancePaise ? ` (variance ${r(c.variancePaise)})` : ''}, ${words(c.status)}`, { noun: 'closed day' });
    },
  }),
};

/* ── Scenario planning ────────────────────────────────────── */

const RUPEE_KEYS = { feePerStudentRupees: 'feePerStudentPaise', costPerStaffRupees: 'costPerStaffPaise', costPerVehicleRupees: 'costPerVehiclePaise', otherCostsRupees: 'otherCostsPaise' };
const assumptionSchema = closed({
  intake: int(0, 5000, 'New students each year into the first grade'), retentionPct: num(0, 100), lateralPerGrade: int(0, 500),
  feePerStudentRupees: num(0, 1e7, 'Annual fee per student now'), feeIncreasePct: num(-50, 100), concessionPct: num(0, 100), collectionPct: num(0, 100),
  studentsPerTeacher: num(5, 80), extraHiresPerYear: int(0, 200), costPerStaffRupees: num(0, 1e7), salaryIncrementPct: num(-20, 50),
  riderPct: num(0, 100), seatsPerVehicle: int(1, 100), targetLoadPct: num(10, 100), costPerVehicleRupees: num(0, 1e7),
  otherCostsRupees: num(0, 1e9), otherCostsGrowthPct: num(-50, 100),
});

function assumptionsOf(a = {}) {
  const out = {};
  for (const [k, v] of Object.entries(a)) {
    if (v === undefined || v === null) continue;
    if (RUPEE_KEYS[k]) out[RUPEE_KEYS[k]] = Math.round(Number(v) * 100);
    else out[k] = v;
  }
  return out;
}

/** The school-wide monthly payroll total stays out of the answer (payroll is screen-only). */
function noPayroll(d) {
  if (!d?.baseline?.staffing) return d;
  const { monthlyPayrollPaise: _p, ...staffing } = d.baseline.staffing;
  return { ...d, baseline: { ...d.baseline, staffing } };
}

const lastRow = (rows) => rows?.at?.(-1);
const projectionSpeak = (name, rows) => {
  const end = lastRow(rows);
  return end ? `${name}: by ${end.label}, ${end.students} students, ${end.teachersNeeded} teachers, ${end.vehiclesNeeded} vehicles, fees ${r(end.feeRevenuePaise)} against costs ${r(end.totalCostPaise)} (surplus ${r(end.surplusPaise)}). A projection from the assumptions, not a forecast.` : `${name}: no projection.`;
};

async function scenarioNamed(term) {
  return pick(await scenarios.list(), term, { label: 'saved scenario', nameOf: (s) => s.name, refOf: () => null });
}

const scenarioTools = {
  get_scenario_baseline: tool({
    module: 'Budgets', operation: 'GET', feature: 'scenarios',
    description: 'The starting point for what-if planning: students by grade, teachers and other staff, transport riders and vehicles, fee per student, concession and collection rates and the budget, with every default assumption and where it comes from (records or a stated default). Read-only.',
    permission: 'scenarios.read', minScope: 'ALL',
    service: 'scenarios.service.getBaseline()',
    async run() {
      const d = noPayroll(await scenarios.getBaseline());
      const b = d.baseline;
      return shown(d, `Now: ${b.enrolment?.students ?? 0} students, ${b.staffing?.teachers ?? 0} teachers, ${b.transport?.vehicles ?? 0} vehicles. ${d.assumptions.length} assumptions, each with its source.`);
    },
  }),

  get_scenario_projection: tool({
    module: 'Budgets', operation: 'GET', feature: 'scenarios',
    description: 'A what-if projection 1 to 5 years ahead from the current records, with any assumptions changed (intake, retention, fee increase, concessions, collection, staff ratio and cost, transport, other costs). Year by year: students, fee income, teachers and vehicles needed, costs and surplus. Saves nothing. Read-only.',
    inputSchema: closed({ assumptions: assumptionSchema, years: int(1, 5, 'Default 3') }),
    permission: 'scenarios.read', minScope: 'ALL',
    service: 'scenarios.service.preview()',
    async run(_ctx, args) {
      const d = noPayroll(await scenarios.preview({ assumptions: assumptionsOf(args.assumptions), years: args.years }));
      return shown(d, projectionSpeak('Projection', d.rows));
    },
  }),

  get_scenario_comparison: tool({
    module: 'Budgets', operation: 'GET', feature: 'scenarios',
    description: 'Two to four saved scenarios side by side over the same current records: their assumptions and year-by-year results. Read-only.',
    inputSchema: closed({ scenarios: list(text(120), 4, 'The saved scenarios, by name') }, ['scenarios']),
    permission: 'scenarios.read', minScope: 'ALL',
    service: 'scenarios.service.compare()',
    async run(_ctx, args) {
      if ((args.scenarios ?? []).length < 2) throw ask('Which two to four saved scenarios should I compare?');
      const ids = [];
      for (const n of args.scenarios) ids.push((await scenarioNamed(n)).id); // eslint-disable-line no-await-in-loop
      const d = noPayroll(await scenarios.compare(ids.join(',')));
      return shown(d, d.scenarios.map((s) => projectionSpeak(s.name, s.rows)).join(' '));
    },
  }),

  list_budget_scenarios: tool({
    module: 'Budgets', operation: 'GET', feature: 'scenarios',
    description: 'The saved what-if scenarios: name, description, years ahead, who made it, when it was changed and how many assumptions it edits. Read-only.',
    permission: 'scenarios.read', minScope: 'ALL',
    service: 'scenarios.service.list()',
    async run() {
      const rows = await scenarios.list();
      return listed(rows, (s) => `${s.name} (${s.years} year(s), ${s.edited} edited assumption(s))`, { noun: 'scenario' });
    },
  }),

  get_scenario: tool({
    module: 'Budgets', operation: 'GET', feature: 'scenarios',
    description: 'One saved scenario with its assumptions and its year-by-year projection over the current records. Read-only.',
    inputSchema: closed({ scenario: text(120, 'Its name') }, ['scenario']),
    permission: 'scenarios.read', minScope: 'ALL',
    service: 'scenarios.service.get()',
    async run(_ctx, args) {
      const s = await scenarioNamed(args.scenario);
      const d = noPayroll(await scenarios.get(s.id));
      return shown(d, projectionSpeak(d.scenario.name, d.rows));
    },
  }),

  create_scenario: tool({
    module: 'Budgets', operation: 'CREATE', feature: 'scenarios',
    description: 'Save a what-if scenario for leadership: a name, a description, how many years ahead (1 to 5) and the assumptions changed from the defaults. Needs confirmation.',
    inputSchema: closed({ name: text(120), description: text(1000), years: int(1, 5), assumptions: assumptionSchema }, ['name']),
    permission: 'scenarios.manage', minScope: 'ALL',
    service: 'scenarios.service.create()',
    summarise: (a) => `Save the scenario "${a.name}" (${a.years ?? 3} year(s))${Object.keys(a.assumptions ?? {}).length ? ` with ${Object.entries(a.assumptions).map(([k, v]) => `${k} ${v}`).join(', ')}` : ' on the default assumptions'}`,
    async run(ctx, args) {
      const d = await scenarios.create(ctx.actor, { name: args.name, description: args.description, years: args.years, assumptions: assumptionsOf(args.assumptions) });
      return did('scenario_saved', d.scenario, projectionSpeak(`Saved "${d.scenario.name}"`, d.rows));
    },
  }),

  update_scenario: tool({
    module: 'Budgets', operation: 'UPDATE', feature: 'scenarios',
    description: 'Change a saved scenario: rename it, its description, the years ahead, or its assumptions (the ones given replace the edited set). Needs confirmation.',
    inputSchema: closed({ scenario: text(120, 'Its current name'), name: text(120), description: text(1000), years: int(1, 5), assumptions: assumptionSchema }, ['scenario']),
    permission: 'scenarios.manage', minScope: 'ALL',
    service: 'scenarios.service.update()',
    async prepare(_ctx, args) {
      const s = await scenarioNamed(args.scenario);
      if (![args.name, args.description, args.years, args.assumptions].some((v) => v !== undefined)) throw ask('What should change on the scenario?');
      return { id: s.id, name: s.name };
    },
    summarise: (a, _actor, p) => `Change the scenario "${p?.name ?? a.scenario}": ${[a.name && `rename to "${a.name}"`, a.description && 'new description', a.years && `${a.years} year(s)`, a.assumptions && `assumptions ${Object.entries(a.assumptions).map(([k, v]) => `${k} ${v}`).join(', ')}`].filter(Boolean).join('; ')}`,
    async run(ctx, args, p) {
      const d = await scenarios.update(ctx.actor, p.id, { name: args.name, description: args.description, years: args.years, ...(args.assumptions && { assumptions: assumptionsOf(args.assumptions) }) });
      return did('scenario_updated', d.scenario, projectionSpeak(`Updated "${d.scenario.name}"`, d.rows));
    },
  }),

  archive_scenario: tool({
    module: 'Budgets', operation: 'DELETE', feature: 'scenarios',
    description: 'Remove a saved scenario from the list (it is archived, not erased). Needs confirmation.',
    inputSchema: closed({ scenario: text(120, 'Its name') }, ['scenario']),
    permission: 'scenarios.manage', minScope: 'ALL',
    service: 'scenarios.service.archive()',
    async prepare(_ctx, args) { const s = await scenarioNamed(args.scenario); return { id: s.id, name: s.name }; },
    summarise: (a, _actor, p) => `Remove the saved scenario "${p?.name ?? a.scenario}"`,
    async run(_ctx, _args, p) {
      await scenarios.archive(p.id);
      return did('scenario_archived', { id: p.id }, `Removed "${p.name}".`);
    },
  }),
};

export const tools = {
  ...feeTools,
  ...seatTools,
  ...procurementTools,
  ...budgetTools,
  ...billTools,
  ...adjustmentTools,
  ...scenarioTools,
};
