import * as fees from '../../../fees/fee.service.js';
import * as plans from '../../../fees/plan.service.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import { RISK, objectId, dateStr, rupees, paise, summarise, wrapAgentTool, resolveSectionId, classIdentitySchema } from './_shared.js';

/**
 * Fee and payment tools.
 *
 * Money is the highest-risk surface here, and the fee module's own design says
 * so: `fees.plan.request`, `.review` and `.approve` are three separate
 * permission keys, and Finance deliberately holds the first two and not the
 * third. Nothing in this file collapses that separation — each tool declares
 * the key its operation needs, and the services re-check their own finer
 * rules, so the assistant inherits the segregation of duties.
 *
 * Every schema below mirrors the service it fronts — the manual payment modes
 * are exactly fee.service's PAYMENT_MODES minus GATEWAY (which is the online
 * path, not something staff record by hand), instrument fields are the ones
 * buildInstrument() validates, and payment edits are limited to the fields
 * EDITABLE_PAYMENT_FIELDS allows. A schema that offers the model an option the
 * service refuses is a tool that fails in a user's chat instead of at review.
 */

/** Manual payment modes: fee.service PAYMENT_MODES, less GATEWAY (online-only). */
const MANUAL_MODES = ['CASH', 'CHEQUE', 'DD', 'BANK'];

/** What a payment is taken as when nobody says. See record_payment's schema. */
const DEFAULT_PAYMENT_MODE = 'CASH';

/** The instrument details buildInstrument() requires for CHEQUE, DD and BANK. */
const instrumentSchema = {
  type: 'object',
  description: 'Required for CHEQUE, DD and BANK: number, bankName, instrumentDate and a proofUrl (image or PDF). Not used for CASH.',
  properties: {
    number: { type: 'string', maxLength: 60, description: 'Cheque, DD or transfer reference number' },
    referenceNo: { type: 'string', maxLength: 60 },
    bankName: { type: 'string', maxLength: 120 },
    instrumentDate: dateStr('Date on the cheque, DD or transfer'),
    proofUrl: { type: 'string', maxLength: 500, description: 'Uploaded scan of the instrument' },
    proofName: { type: 'string', maxLength: 160 },
  },
  additionalProperties: false,
};

const installmentSchema = {
  type: 'array',
  minItems: 1,
  maxItems: 24,
  description: 'Installments in due-date order. Their amounts must add up exactly to totalPaise. ONE_TIME has exactly one; PARTIAL and INSTALLMENT at least two.',
  items: {
    type: 'object',
    properties: {
      label: { type: 'string', maxLength: 80 },
      amountPaise: { type: 'integer', minimum: 1, description: 'Whole paise' },
      dueOn: dateStr(),
    },
    required: ['amountPaise', 'dueOn'],
    additionalProperties: false,
  },
};

const asList = (rows) => (Array.isArray(rows) ? rows : (rows?.items ?? []));

/**
 * Resolves an invoice named by id or by invoice number, at the caller's scope.
 *
 * The number is how a person names an invoice ("INV-1042"); the id is how the
 * service does. Resolution goes through the same listInvoices() search the fee
 * screen uses, so a number the caller may not see resolves to nothing.
 */
async function resolveInvoice(ctx, { invoiceId, invoiceNo }) {
  if (invoiceId) {
    const invoice = await fees.getInvoiceDetail(ctx.actor, ctx.scope, invoiceId);
    return { invoiceId: String(invoice.id ?? invoice._id ?? invoiceId), invoiceNo: invoice.invoiceNo };
  }
  if (!invoiceNo) throw new AppError('Which invoice? Give its invoice number.', 400, [], 'AGENT_NEEDS_INPUT');
  const rows = asList(await fees.listInvoices(ctx.actor, ctx.scope, { search: invoiceNo }));
  const exact = rows.find((i) => String(i.invoiceNo).toLowerCase() === String(invoiceNo).toLowerCase());
  if (!exact) throw new AppError(`No invoice numbered "${invoiceNo}".`, 404);
  return { invoiceId: String(exact.id ?? exact._id), invoiceNo: exact.invoiceNo };
}

export const feeTools = {
  get_pending_fees: {
    module: 'Fees',
    resultShape: 'LIST',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'Unpaid and partly paid fee invoices with the amount still owed on each, and the outstanding total. Use for "who has pending fees", "how much is outstanding", and "what are Rahul\'s fees" (pass search). With a search or section the totals cover only what matched; without one they cover everything the caller may see. Staff see the school; a family sees their own. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', maxLength: 80, description: 'One student by name or admission number, or an invoice number' },
        ...classIdentitySchema,
        sectionId: objectId(),
        academicYearId: objectId(),
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Invoices to return, default 25' },
      },
      additionalProperties: false,
    },
    permission: 'fees.read',
    service: 'fee.service.listInvoices() + getSummary()',
    /**
     * Totals follow the filter. An earlier version always reported the whole
     * school's outstanding figure, so "what are Rahul's fees?" listed Rahul's
     * two invoices under a school-wide total — a true number answering a
     * different question. With a search or section the totals are summed from
     * the invoices that matched; only an unfiltered read uses getSummary().
     */
    async run(ctx, args) {
      // A class named in words is resolved to a section at the caller's own
      // scope, by the same helper every class-level tool uses. Without it the
      // class in "outstanding fees for Class 5A" was silently dropped and a
      // school-wide total was presented as the answer to a question about one
      // class -- a true number answering something nobody asked.
      const sectionId = (await resolveSectionId(ctx, args)) ?? args.sectionId ?? null;
      const filtered = Boolean(args.search || sectionId);
      const [invoicesRaw, totals] = await Promise.all([
        fees.listInvoices(ctx.actor, ctx.scope, {
          ...(args.search && { search: args.search }),
          ...(sectionId && { sectionId }),
          ...(args.academicYearId && { academicYearId: args.academicYearId }),
        }),
        filtered ? null : fees.getSummary(ctx.actor, ctx.scope, { ...(args.academicYearId && { academicYearId: args.academicYearId }) }),
      ]);

      const now = new Date();
      // Selection, not a new rule: PAID and CANCELLED are simply not what
      // "pending" means. The statuses are the fee service's own.
      const pending = asList(invoicesRaw)
        .filter((i) => !['PAID', 'CANCELLED'].includes(i.status))
        .map((i) => ({
          invoiceId: String(i.id ?? i._id),
          invoiceNo: i.invoiceNo,
          studentName: i.studentName ?? null,
          class: i.class ?? null,
          status: i.status,
          dueOn: i.dueOn ?? null,
          totalPaise: paise(i.totalPaise),
          paidPaise: paise(i.paidPaise),
          outstandingPaise: paise(i.totalPaise) - paise(i.paidPaise),
        }))
        .sort((a, b) => b.outstandingPaise - a.outstandingPaise);

      const outstanding = filtered
        ? pending.reduce((sum, p) => sum + p.outstandingPaise, 0)
        : totals.pendingPaise;
      const overdue = filtered
        ? pending.filter((p) => p.dueOn && new Date(p.dueOn) < now).reduce((sum, p) => sum + p.outstandingPaise, 0)
        : totals.overduePaise;
      const withDues = new Set(pending.map((p) => p.studentName ?? p.invoiceNo)).size;

      return ok(
        {
          invoices: pending.slice(0, Math.min(Number(args.limit) || 25, 100)),
          invoiceCount: pending.length,
          studentsWithPendingFees: withDues,
          totalOutstandingPaise: outstanding,
          overduePaise: overdue,
          totalsCover: filtered ? 'MATCHED_INVOICES' : (ctx.scope === 'OWN' ? 'OWN' : 'SCHOOL'),
          ...(!filtered && {
            totalBilledPaise: totals.totalBilledPaise,
            totalCollectedPaise: totals.totalCollectedPaise,
            overdueCount: totals.overdueCount,
          }),
        },
        pending.length === 0
          ? { speakKey: 'fees.clear' }
          : {
              speak:
                `${withDues} student(s) have pending fees across ${pending.length} invoice(s), totalling ` +
                `${rupees(outstanding)} (${rupees(overdue)} of it overdue).`,
            },
      );
    },
  },

  get_fee_statistics: {
    module: 'Fees',
    resultShape: 'SUMMARY',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'Fee collection statistics: total billed, total collected, collection percentage, and what is outstanding and overdue. Use for "how much have we collected" and collection-rate questions. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { academicYearId: objectId() },
      additionalProperties: false,
    },
    permission: 'fees.read',
    // The Web finance dashboard that shows billed/collected/collection-rate is
    // behind a school-wide fees.read; a family's fee screen shows their own
    // balance and nothing else. Without this the capability was offered to a
    // student, and answering "what is the fee collection so far" from an
    // OWN-scoped summary produced "0% collection rate" -- a school-shaped
    // answer to a question they may not ask at all. get_fees is their
    // capability, and it stays.
    minScope: 'ALL',
    service: 'fee.service.getSummary()',
    async run(ctx, args) {
      const s = await fees.getSummary(ctx.actor, ctx.scope, { ...(args.academicYearId && { academicYearId: args.academicYearId }) });
      return ok(s, {
        speak:
          `${rupees(s.totalCollectedPaise)} collected of ${rupees(s.totalBilledPaise)} billed ` +
          `(${s.collectionPct}% collection rate). ${rupees(s.pendingPaise)} outstanding across ` +
          `${s.pendingCount} invoice(s), of which ${rupees(s.overduePaise)} is overdue.`,
      });
    },
  },

  get_payment_history: {
    module: 'Fees',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'Fee payments that have been recorded — receipt number, invoice, student, amount, mode, date and verification status. Staff see the school; a family sees only their own settled payments. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', maxLength: 80, description: 'Student name, admission number or receipt/invoice number' },
        invoiceId: objectId(),
        from: dateStr(),
        to: dateStr(),
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    permission: 'fees.read',
    service: 'fee.service.listPayments()',
    async run(ctx, args) {
      const page = await fees.listPayments(ctx.actor, ctx.scope, {
        ...(args.search && { search: args.search }),
        ...(args.invoiceId && { invoiceId: args.invoiceId }),
        ...(args.from && { from: args.from }),
        ...(args.to && { to: args.to }),
        page: 1,
        pageSize: Math.min(Number(args.limit) || 20, 100),
      });
      const items = asList(page).map((p) => ({
        paymentId: String(p.id),
        receiptNo: p.receiptNo,
        invoiceNo: p.invoiceNo,
        studentName: p.studentName,
        class: p.class,
        amountPaise: paise(p.amountPaise),
        mode: p.mode,
        status: p.status,
        recordStatus: p.recordStatus ?? null,
        verificationStatus: p.verificationStatus ?? null,
        paidOn: p.paidOn,
      }));
      const total = items.reduce((sum, p) => sum + p.amountPaise, 0);
      const view = summarise(items, (p) => `${p.studentName} ${rupees(p.amountPaise)} (${p.mode})`);
      return ok(
        { payments: items, returned: items.length, total: page.total ?? items.length, totalAmountPaise: total },
        {
          speak: items.length
            ? `${page.total ?? items.length} payment(s); the ${items.length} shown total ${rupees(total)}: ${view.list}.`
            : 'No payments have been recorded for that.',
        },
      );
    },
  },

  get_invoice: {
    module: 'Fees',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'One fee invoice in full — line items, total, amount paid, status, due date and the payments settled against it. Name it by invoiceId or by its invoice number. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        invoiceId: objectId(),
        invoiceNo: { type: 'string', maxLength: 40, description: 'Alternative to invoiceId, e.g. "INV-1042"' },
      },
      additionalProperties: false,
    },
    permission: 'fees.read',
    service: 'fee.service.getInvoiceDetail()',
    async run(ctx, args) {
      const { invoiceId } = await resolveInvoice(ctx, args);
      const invoice = await fees.getInvoiceDetail(ctx.actor, ctx.scope, invoiceId);
      const outstanding = paise(invoice.totalPaise) - paise(invoice.paidPaise);
      return ok(invoice, {
        speak:
          `Invoice ${invoice.invoiceNo}: ${rupees(invoice.totalPaise)} billed, ${rupees(invoice.paidPaise)} paid, ` +
          `${rupees(outstanding)} outstanding (${invoice.status}).`,
      });
    },
  },

  get_fee_plans: {
    module: 'Fees',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'Installment and part-payment plans, with the approval stage each is at. Use for "which installment plans are waiting for approval". Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['DRAFT', 'PENDING_FINANCE_REVIEW', 'FINANCE_REVIEWED', 'PENDING_ADMIN_APPROVAL', 'APPROVED', 'REJECTED', 'PUBLISHED'],
        },
        studentId: objectId(),
        enrollmentId: objectId(),
        academicYearId: objectId(),
      },
      additionalProperties: false,
    },
    permission: 'fees.read',
    service: 'plan.service.listFeePlans()',
    async run(ctx, args) {
      const items = asList(await plans.listFeePlans(ctx.actor, ctx.scope, args));
      const view = summarise(items, (p) => `${p.studentName ?? p.name ?? p.id} — ${p.status}`);
      return ok(
        { plans: items, count: items.length },
        { speak: items.length ? `${items.length} fee plan(s): ${view.list}.` : 'There are no fee plans matching that.' },
      );
    },
  },

  get_payment_change_requests: {
    module: 'Fees',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'Requests to amend a finalised payment record, with what was asked for and the current decision. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
        paymentId: objectId(),
      },
      additionalProperties: false,
    },
    permission: 'fees.read',
    minScope: 'ALL',
    service: 'fee.service.listPaymentChangeRequests()',
    async run(_ctx, args) {
      const items = asList(await fees.listPaymentChangeRequests(args));
      return ok(
        { requests: items, count: items.length },
        { speak: items.length ? `${items.length} payment change request(s).` : 'There are no payment change requests.' },
      );
    },
  },

  get_fee_structures: {
    module: 'Fees',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'The fee heads and fee structures configured for the school, by academic year and grade. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { academicYearId: objectId(), gradeId: objectId() },
      additionalProperties: false,
    },
    permission: 'fees.read',
    minScope: 'ALL',
    service: 'fee.service.listFeeHeads() + listFeeStructures()',
    async run(_ctx, args) {
      const [heads, structures] = await Promise.all([
        fees.listFeeHeads(),
        fees.listFeeStructures({ academicYearId: args.academicYearId, gradeId: args.gradeId ?? null }),
      ]);
      const headNames = heads.map((h) => h.name).filter(Boolean);
      const headSummary = headNames.length > 0 ? ` (${headNames.slice(0, 5).join(', ')}${headNames.length > 5 ? '…' : ''})` : '';
      const structureNames = structures.map((s) => s.name).filter(Boolean);
      const structureSummary = structureNames.length > 0 ? ` (${structureNames.slice(0, 5).join(', ')}${structureNames.length > 5 ? '…' : ''})` : '';
      return ok(
        { feeHeads: heads, structures, headCount: heads.length, structureCount: structures.length },
        { speak: `${heads.length} fee head(s)${headSummary} and ${structures.length} fee structure(s)${structureSummary} configured.` },
      );
    },
  },

  /* ── Wrapped from agent/tools.js ─────────────────────── */
  get_fees: wrapAgentTool('get_fees', {
    module: 'Fees',
    description:
      "The caller's own outstanding fee balance and payment status. Use get_pending_fees instead when the user asks about students in general or names one. Read-only.",
    service: 'fee.service.getSummary()',
  }),

  get_payment_link: wrapAgentTool('get_payment_link', {
    module: 'Fees',
    description:
      'A link the caller can use to pay their own outstanding invoice online. Returns links only — it never moves money. Read-only.',
    inputSchema: { type: 'object', properties: { invoiceId: objectId() }, additionalProperties: false },
    service: 'fee.service.getPaymentLinks()',
  }),

  /* ── Creates ─────────────────────────────────────────── */
  create_invoice: {
    module: 'Fees',
    operation: 'CREATE',
    risk: RISK.HIGH,
    confirm: true,
    description:
      'Raise one fee invoice against one enrolment, with its line items. The invoice number must be unique; a duplicate is refused. Creates a financial record, so it always needs confirmation. To bill a whole year or grade from the fee structures, use generate_invoices.',
    inputSchema: {
      type: 'object',
      properties: {
        enrollmentId: objectId(),
        invoiceNo: { type: 'string', maxLength: 40 },
        dueOn: dateStr(),
        lines: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: {
            type: 'object',
            properties: {
              description: { type: 'string', maxLength: 200, description: 'What this line charges for, e.g. "Tuition — Term 1"' },
              amountPaise: { type: 'integer', minimum: 1, description: 'Whole paise, not rupees' },
              concessionPaise: { type: 'integer', minimum: 0, description: 'Discount on this line, in paise' },
              feeStructureId: objectId(),
            },
            required: ['description', 'amountPaise'],
            additionalProperties: false,
          },
        },
      },
      // Invoice.invoiceNo and Invoice.dueOn are both required by the model.
      required: ['enrollmentId', 'invoiceNo', 'dueOn', 'lines'],
      additionalProperties: false,
    },
    permission: 'fees.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'fee.service.createInvoice()',
    summarise: (args) => {
      const total = (args.lines ?? []).reduce((s, l) => s + Number(l.amountPaise ?? 0) - Number(l.concessionPaise ?? 0), 0);
      return `Raise invoice ${args.invoiceNo} for ${rupees(total)} against enrolment ${args.enrollmentId}, due ${args.dueOn}`;
    },
    async run(_ctx, args) {
      const invoice = await fees.createInvoice(args);
      return action({
        type: 'invoice_created',
        id: invoice._id ?? invoice.id,
        data: { invoiceId: String(invoice._id ?? invoice.id), invoiceNo: invoice.invoiceNo, totalPaise: invoice.totalPaise },
        speak: `Invoice ${invoice.invoiceNo} raised for ${rupees(invoice.totalPaise)}.`,
      });
    },
  },

  generate_invoices: {
    module: 'Fees',
    operation: 'ACTION',
    risk: RISK.HIGH,
    confirm: true,
    description:
      'Generate invoices in bulk for every active enrolment in an academic year (optionally one grade) from the configured fee structures. Enrolments already billed for a structure are skipped, so running it twice does not bill anyone twice. This bills many families at once, so it needs confirmation — run it with dryRun: true first to see how many invoices it would create, which needs none.',
    inputSchema: {
      type: 'object',
      properties: {
        academicYearId: objectId(),
        gradeId: objectId('Restrict to one grade; omit to bill the whole year'),
        dueOn: dateStr(),
        dryRun: { type: 'boolean', description: 'Count and total without writing anything' },
      },
      required: ['academicYearId'],
      additionalProperties: false,
    },
    permission: 'fees.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'fee.service.generateInvoices()',
    // A dry run writes nothing, so it does not need approval — asking the user
    // to confirm a preview is how confirmation prompts start being ignored.
    confirmWhen: (args) => args.dryRun !== true,
    summarise: (args) =>
      `Generate fee invoices for every active enrolment in academic year ${args.academicYearId}` +
      (args.gradeId ? `, grade ${args.gradeId}` : ' (the whole school)') +
      (args.dueOn ? `, due ${args.dueOn}` : ''),
    async run(_ctx, args) {
      const result = await fees.generateInvoices({
        academicYearId: args.academicYearId,
        gradeId: args.gradeId ?? null,
        dueOn: args.dueOn,
        dryRun: Boolean(args.dryRun),
      });
      return action({
        type: args.dryRun ? 'invoices_previewed' : 'invoices_generated',
        data: { generated: result.generated, skipped: result.skipped, totalPaise: result.totalPaise, dryRun: result.dryRun },
        speak: args.dryRun
          ? `A run would create ${result.generated} invoice(s) totalling ${rupees(result.totalPaise)}, skipping ${result.skipped} already billed.`
          : `${result.generated} invoice(s) generated totalling ${rupees(result.totalPaise)}; ${result.skipped} already billed and skipped.`,
      });
    },
  },

  create_fee_plan: {
    module: 'Fees',
    operation: 'CREATE',
    risk: RISK.HIGH,
    confirm: true,
    description:
      'Draft an installment or part-payment plan for one enrolment. This creates a DRAFT only — it approves and publishes nothing; those are separate, separately-permissioned steps (transition_fee_plan, publish_fee_plan). Installment amounts must add up exactly to totalPaise. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        enrollmentId: objectId(),
        mode: { type: 'string', enum: ['ONE_TIME', 'PARTIAL', 'INSTALLMENT'] },
        totalPaise: { type: 'integer', minimum: 1, description: 'Whole paise' },
        installments: installmentSchema,
        name: { type: 'string', maxLength: 120, description: 'Defaults to "Fee plan"' },
        feeHeadId: objectId('The fee head this plan settles, if one'),
        notes: { type: 'string', maxLength: 1000 },
      },
      required: ['enrollmentId', 'mode', 'totalPaise', 'installments'],
      additionalProperties: false,
    },
    permission: 'fees.plan.request',
    service: 'plan.service.createFeePlan()',
    summarise: (args) =>
      `Draft a ${args.mode} fee plan of ${rupees(args.totalPaise)} for enrolment ${args.enrollmentId} ` +
      `in ${args.installments.length} installment(s)`,
    async run(ctx, args) {
      const plan = await plans.createFeePlan(ctx.actor, args);
      return action({
        type: 'fee_plan_created',
        id: plan._id ?? plan.id,
        data: { planId: String(plan._id ?? plan.id), status: plan.status, totalPaise: plan.totalPaise },
        speak: 'The fee plan has been drafted. It still needs review and approval before it takes effect.',
      });
    },
  },

  /* ── Updates ─────────────────────────────────────────── */
  update_fee_plan: {
    module: 'Fees',
    operation: 'UPDATE',
    risk: RISK.HIGH,
    confirm: true,
    description:
      'Amend a fee plan that is still a draft or came back rejected. A plan under review, approved or published cannot be edited — the service refuses. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        planId: objectId(),
        mode: { type: 'string', enum: ['ONE_TIME', 'PARTIAL', 'INSTALLMENT'] },
        totalPaise: { type: 'integer', minimum: 1 },
        installments: installmentSchema,
        name: { type: 'string', maxLength: 120 },
        feeHeadId: objectId(),
        notes: { type: 'string', maxLength: 1000 },
      },
      required: ['planId'],
      additionalProperties: false,
    },
    permission: 'fees.plan.request',
    service: 'plan.service.updateFeePlan()',
    summarise: (args) => `Amend fee plan ${args.planId}`,
    async run(ctx, args) {
      const { planId, ...body } = args;
      const plan = await plans.updateFeePlan(ctx.actor, planId, body);
      return action({ type: 'fee_plan_updated', id: planId, data: { planId, status: plan?.status }, speak: 'The fee plan has been amended.' });
    },
  },

  update_payment: {
    module: 'Fees',
    operation: 'UPDATE',
    risk: RISK.HIGH,
    confirm: true,
    description:
      'Correct a payment record: its mode, paid-on date, receipt number, notes or instrument details. The amount can only be changed on a rejected payment. Every field changed is individually audited by the fee service, and changing a verified payment needs payment-approval rights. Give a reason. Always needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        paymentId: objectId(),
        amountPaise: { type: 'integer', minimum: 1, description: 'Only on a REJECTED payment' },
        mode: { type: 'string', enum: MANUAL_MODES },
        paidOn: dateStr(),
        receiptNo: { type: 'string', maxLength: 40 },
        notes: { type: 'string', maxLength: 500 },
        instrument: instrumentSchema,
        reason: { type: 'string', maxLength: 500, description: 'Why the record is being corrected — recorded with the change' },
      },
      required: ['paymentId'],
      additionalProperties: false,
    },
    permission: 'fees.payments.approve',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'fee.service.updatePayment()',
    summarise: (args) => {
      const fields = Object.keys(args).filter((k) => !['paymentId', 'reason'].includes(k));
      return `Change ${fields.join(', ')} on payment ${args.paymentId}${args.reason ? ` — "${args.reason}"` : ''}`;
    },
    async run(ctx, args) {
      const { paymentId, instrument, ...rest } = args;
      // The service edits one named field at a time and names instrument
      // fields with a dot ("instrument.number"), so nested input is flattened
      // to exactly the keys EDITABLE_PAYMENT_FIELDS accepts.
      const patch = { ...rest };
      for (const [key, value] of Object.entries(instrument ?? {})) patch[`instrument.${key}`] = value;
      const payment = await fees.updatePayment(ctx.actor, paymentId, patch);
      return action({
        type: 'payment_updated',
        id: paymentId,
        data: { paymentId, changed: Object.keys(patch).filter((k) => k !== 'reason'), recordStatus: payment?.recordStatus ?? null },
        speak: 'The payment record has been corrected.',
      });
    },
  },

  /* ── Actions ─────────────────────────────────────────── */
  record_payment: {
    module: 'Fees',
    operation: 'ACTION',
    risk: RISK.HIGH,
    confirm: true,
    description:
      'Record a fee payment received against an invoice. Name the invoice by its number (e.g. "INV-1042") or id; the amount is in whole paise (₹500 is 50000). Staff only — a family cannot mark its own invoice paid and must use the online payment link. When the person recording cannot approve payments, the payment is saved pending admin approval. CHEQUE, DD and BANK payments need instrument details with a proof URL; CASH needs none. Money moves in the ledger, so this always needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        invoiceId: objectId('Preferred when known'),
        invoiceNo: { type: 'string', maxLength: 40, description: 'Alternative to invoiceId' },
        amountPaise: { type: 'integer', minimum: 1, description: 'Whole paise. ₹500 is 50000.' },
        mode: { type: 'string', enum: MANUAL_MODES, description: 'Cash unless another mode is named' },
        paidOn: dateStr(),
        receiptNo: { type: 'string', maxLength: 40 },
        notes: { type: 'string', maxLength: 500 },
        instrument: instrumentSchema,
      },
      // `mode` is NOT required, and defaults to CASH below.
      //
      // That default is not new -- it has always been applied, but in the
      // pattern rule that parsed the sentence ("mode: MODES[mode] ?? 'CASH'"),
      // which is business behaviour living in the language layer. Any other
      // route to the same tool therefore behaved differently from that one
      // phrasing, and "record a payment of Rs 500 against invoice INV-1042"
      // came back asking for a detail the rules would have filled in.
      //
      // It is safe because nothing is recorded on it alone: the confirmation a
      // person approves names the mode ("Record a Rs 500 CASH payment against
      // invoice INV-1042"), so a default they did not mean is visible before
      // it is accepted, not after.
      required: ['amountPaise'],
      additionalProperties: false,
    },
    permission: 'fees.pay',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'fee.service.recordPayment()',
    summarise: (args, _actor, prepared) =>
      `Record a ${rupees(args.amountPaise)} ${args.mode ?? DEFAULT_PAYMENT_MODE} payment `
      + `against invoice ${prepared?.invoiceNo ?? args.invoiceNo ?? args.invoiceId}`,
    /** Resolves the invoice before the confirmation, so the summary names it and a wrong number fails first. */
    async prepare(ctx, args) {
      return resolveInvoice(ctx, args);
    },
    /**
     * Money on an invoice is the case where "what did it say before" is the
     * question an audit exists to answer: the paid total and status either
     * side of the write.
     */
    async snapshot(ctx, args, prepared) {
      const invoiceId = prepared?.invoiceId ?? args.invoiceId;
      if (!invoiceId) return null;
      const invoice = await fees.getInvoiceDetail(ctx.actor, ctx.scope, invoiceId);
      return {
        invoiceId: String(invoiceId),
        invoiceNo: invoice.invoiceNo,
        status: invoice.status,
        totalPaise: invoice.totalPaise,
        paidPaise: invoice.paidPaise,
        paymentCount: invoice.payments?.length ?? 0,
      };
    },
    async run(ctx, args, prepared) {
      const target = prepared ?? (await resolveInvoice(ctx, args));
      const { invoiceNo: _named, ...rest } = args;
      // recordPayment() returns { payment, receiptNo, recordStatus, ... } on
      // both the direct and the pending-approval path; the row is `.payment`.
      const result = await fees.recordPayment(ctx.actor, ctx.scope, {
        ...rest,
        mode: args.mode ?? DEFAULT_PAYMENT_MODE,
        invoiceId: target.invoiceId,
      });
      const paymentId = String(result.payment._id);
      const pendingApproval = result.recordStatus === 'PENDING_ADMIN_APPROVAL';
      return action({
        type: 'payment_recorded',
        id: paymentId,
        data: {
          paymentId,
          invoiceId: target.invoiceId,
          invoiceNo: target.invoiceNo,
          amountPaise: args.amountPaise,
          recordStatus: result.recordStatus,
          receiptNo: result.receiptNo,
        },
        speak:
          `Recorded ${rupees(args.amountPaise)} against invoice ${target.invoiceNo}` +
          (pendingApproval ? '. It is pending admin approval.' : '.'),
      });
    },
  },

  approve_payment: {
    module: 'Fees',
    operation: 'ACTION',
    risk: RISK.HIGH,
    confirm: true,
    description:
      'Approve a payment that is pending admin approval, making it final and visible to the family. Requires the payment-approval permission, which Finance deliberately does not hold. Needs confirmation. A payment already approved cannot be approved again.',
    inputSchema: { type: 'object', properties: { paymentId: objectId() }, required: ['paymentId'], additionalProperties: false },
    permission: 'fees.payments.approve',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'fee.service.approvePayment()',
    summarise: (args) => `Approve payment ${args.paymentId}, making it final`,
    async run(ctx, args) {
      // approvePayment() returns { payment, invoice, status, paidPaise }.
      const result = await fees.approvePayment(ctx.actor, args.paymentId);
      return action({
        type: 'payment_approved',
        id: args.paymentId,
        data: {
          paymentId: args.paymentId,
          recordStatus: result.payment.recordStatus,
          invoiceStatus: result.status,
          invoicePaidPaise: result.paidPaise,
        },
        speak: 'The payment has been approved and published.',
      });
    },
  },

  reject_payment: {
    module: 'Fees',
    operation: 'ACTION',
    risk: RISK.HIGH,
    confirm: true,
    description: 'Reject a payment awaiting approval. A reason is required and is recorded. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        paymentId: objectId(),
        reason: { type: 'string', minLength: 3, maxLength: 500 },
      },
      required: ['paymentId', 'reason'],
      additionalProperties: false,
    },
    permission: 'fees.payments.approve',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'fee.service.rejectPayment()',
    summarise: (args) => `Reject payment ${args.paymentId} — "${args.reason}"`,
    async run(ctx, args) {
      const payment = await fees.rejectPayment(ctx.actor, args.paymentId, args.reason);
      return action({
        type: 'payment_rejected',
        id: args.paymentId,
        data: { paymentId: args.paymentId, recordStatus: payment?.recordStatus ?? 'REJECTED' },
        speak: 'The payment has been rejected.',
      });
    },
  },

  refund_payment: {
    module: 'Fees',
    operation: 'ACTION',
    risk: RISK.HIGH,
    confirm: true,
    description:
      'Refund a captured payment and deduct it from the invoice. Needs confirmation. The service refuses a second refund of the same payment, so a retry cannot deduct twice.',
    inputSchema: { type: 'object', properties: { paymentId: objectId() }, required: ['paymentId'], additionalProperties: false },
    permission: 'fees.payments.refund',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'fee.service.refundPayment()',
    summarise: (args) => `Refund payment ${args.paymentId} and deduct it from its invoice`,
    async run(_ctx, args) {
      // refundPayment() returns { payment, invoice }.
      const result = await fees.refundPayment(args.paymentId);
      return action({
        type: 'payment_refunded',
        id: args.paymentId,
        data: { paymentId: args.paymentId, status: result.payment.status },
        speak: 'The payment has been refunded.',
      });
    },
  },

  decide_payment_change_request: {
    module: 'Fees',
    operation: 'ACTION',
    risk: RISK.HIGH,
    confirm: true,
    description:
      'Approve or reject a request to amend a finalised payment. Approving applies the requested change. A reason is needed to reject. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        requestId: objectId(),
        approve: { type: 'boolean' },
        reason: { type: 'string', maxLength: 500, description: 'Required when rejecting' },
      },
      required: ['requestId', 'approve'],
      additionalProperties: false,
    },
    permission: 'fees.payments.approve',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'fee.service.decidePaymentChangeRequest()',
    summarise: (args) => `${args.approve ? 'Approve' : 'Reject'} payment change request ${args.requestId}`,
    async run(ctx, args) {
      const result = await fees.decidePaymentChangeRequest(ctx.actor, args.requestId, { approve: args.approve, reason: args.reason });
      return action({
        type: args.approve ? 'payment_change_approved' : 'payment_change_rejected',
        id: args.requestId,
        data: { requestId: args.requestId, status: result?.status ?? null },
        speak: args.approve ? 'The change has been approved and applied.' : 'The change request has been rejected.',
      });
    },
  },

  transition_fee_plan: {
    module: 'Fees',
    operation: 'ACTION',
    risk: RISK.HIGH,
    confirm: true,
    description:
      'Move a fee plan along its approval workflow: submit (draft → finance review), review (finance reviewed), requestApproval (→ admin approval), approve, or reject. Each step needs its own permission — whoever drafts a plan is deliberately not whoever approves it. Rejecting needs a reason. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        planId: objectId(),
        step: { type: 'string', enum: ['submit', 'review', 'requestApproval', 'approve', 'reject'] },
        reason: { type: 'string', maxLength: 500, description: 'Required for reject' },
        note: { type: 'string', maxLength: 500 },
      },
      required: ['planId', 'step'],
      additionalProperties: false,
    },
    // The route gates this on fees.read and plan.service enforces the
    // step-specific permission (request, review or approve), the finer check.
    permission: 'fees.read',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'plan.service.transitionFeePlan()',
    summarise: (args, _actor, prepared) => {
      const verb = {
        submit: 'Submit', review: 'Mark as finance-reviewed', requestApproval: 'Send for admin approval',
        approve: 'Approve', reject: 'Reject',
      }[args.step] ?? args.step;
      return `${verb} fee plan "${prepared?.name ?? args.planId}"` +
        `${prepared ? ` (${prepared.from} → ${prepared.to})` : ''}${args.reason ? ` — "${args.reason}"` : ''}`;
    },
    /**
     * The step's own permission and the plan's state are checked by the
     * service before anyone is asked to confirm, so Finance is told it cannot
     * approve instead of being asked to approve and then refused.
     */
    async prepare(ctx, args) {
      const { plan, rule } = await plans.checkTransition(ctx.actor, args.planId, args.step, { reason: args.reason });
      return { planId: String(plan._id), name: plan.name, from: plan.status, to: rule.to };
    },
    async run(ctx, args) {
      const plan = await plans.transitionFeePlan(ctx.actor, args.planId, args.step, { reason: args.reason, note: args.note });
      return action({
        type: `fee_plan_${args.step}`,
        id: args.planId,
        data: { planId: args.planId, status: plan?.status ?? null },
        speak: `The fee plan is now ${String(plan?.status ?? 'updated').toLowerCase().replace(/_/g, ' ')}.`,
      });
    },
  },

  publish_fee_plan: {
    module: 'Fees',
    operation: 'ACTION',
    risk: RISK.HIGH,
    confirm: true,
    description:
      "Publish an approved fee plan, which raises one invoice per installment — the point at which the family sees it. Requires the plan-approval permission. Installments that already have an invoice are skipped, so publishing twice bills nobody twice. Needs confirmation.",
    inputSchema: { type: 'object', properties: { planId: objectId() }, required: ['planId'], additionalProperties: false },
    permission: 'fees.plan.approve',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'plan.service.publishFeePlan()',
    summarise: (args) => `Publish fee plan ${args.planId}, raising an invoice for each installment`,
    async run(ctx, args) {
      const plan = await plans.publishFeePlan(ctx.actor, args.planId);
      return action({
        type: 'fee_plan_published',
        id: args.planId,
        data: { planId: args.planId, status: plan?.status ?? null },
        speak: 'The fee plan has been published and its invoices raised.',
      });
    },
  },

  /* ── Fee configuration ────────────────────────────────── */

  /**
   * What the school charges. Both write to fee configuration the whole school
   * is billed from, so both are school-wide only and both are confirmed.
   *
   * They front the actor-aware service methods, not the raw model writes that
   * used to sit behind the REST route: the scope check, the field allow-list,
   * the confirmation that every referenced id belongs to THIS school, and the
   * audit entry all live in fee.service, where the route meets them too.
   */

  create_fee_head: {
    module: 'Fees',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description:
      'Add a fee head — the thing a charge is for, such as "Tuition" or "Transport". A fee head is school-wide configuration and every future structure and invoice is billed against it, so it needs confirmation. The name must be one the school does not already use.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', maxLength: 120, description: 'e.g. "Tuition"' },
        category: { type: 'string', maxLength: 40, description: 'Optional grouping, e.g. "TUITION"' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    permission: 'fees.structure.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'fee.service.createFeeHeadForActor()',
    summarise: (args) => `Add the fee head "${args.name}" to this school's fee configuration`,
    // Checked before anyone is asked to confirm, so a name the school already
    // uses is refused rather than offered and then failed.
    async prepare(ctx, args) {
      return { name: await fees.assertFeeHeadNameFree(ctx.scope, args.name) };
    },
    async run(ctx, args) {
      const head = await fees.createFeeHeadForActor(ctx.actor, ctx.scope, {
        name: args.name,
        ...(args.category !== undefined && { category: args.category }),
      });
      return action({
        type: 'fee_head_created',
        id: String(head._id),
        data: { id: String(head._id), name: head.name, category: head.category },
        speak: `The fee head "${head.name}" has been added.`,
      });
    },
  },

  create_fee_structure: {
    module: 'Fees',
    operation: 'CREATE',
    risk: RISK.HIGH,
    confirm: true,
    description:
      'Set what a fee head costs for an academic year, and optionally for one grade only — omit the grade and it applies to every grade. This is what invoices are generated from, so it decides what families are billed and always needs confirmation. Use get_fee_structures for the existing configuration and the fee head id.',
    inputSchema: {
      type: 'object',
      properties: {
        feeHeadId: objectId('From get_fee_structures'),
        academicYearId: objectId('The year this charge applies to'),
        gradeId: objectId('One grade only; omit for every grade'),
        name: { type: 'string', maxLength: 120, description: 'e.g. "Tuition — Term 1"' },
        amountPaise: {
          type: 'integer',
          minimum: 1,
          description: 'The amount in paise, so ₹4,000 is 400000',
        },
        dueOn: dateStr('When it falls due'),
      },
      required: ['feeHeadId', 'academicYearId', 'name', 'amountPaise', 'dueOn'],
      additionalProperties: false,
    },
    permission: 'fees.structure.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'fee.service.createFeeStructureForActor()',
    summarise: (args) =>
      `Charge ${rupees(args.amountPaise)} for "${args.name}"`
      + `${args.gradeId ? ' in one grade' : ' across every grade'}, due ${args.dueOn}`,
    /**
     * The same validation the write performs, run before the prompt: a year or
     * grade belonging to another school, or an amount that is not a whole
     * number of paise above zero, is refused here instead of being confirmed
     * by a person and then failing.
     */
    async prepare(ctx, args) {
      const resolved = await fees.resolveFeeStructureInput(ctx.scope, {
        feeHeadId: args.feeHeadId,
        academicYearId: args.academicYearId,
        ...(args.gradeId && { gradeId: args.gradeId }),
        name: args.name,
        amountPaise: args.amountPaise,
        dueOn: args.dueOn,
      });
      return { feeHead: resolved.feeHeadName, academicYear: resolved.academicYearName };
    },
    async run(ctx, args) {
      const structure = await fees.createFeeStructureForActor(ctx.actor, ctx.scope, {
        feeHeadId: args.feeHeadId,
        academicYearId: args.academicYearId,
        ...(args.gradeId && { gradeId: args.gradeId }),
        name: args.name,
        amountPaise: args.amountPaise,
        dueOn: args.dueOn,
      });
      return action({
        type: 'fee_structure_created',
        id: String(structure._id),
        data: {
          id: String(structure._id),
          name: structure.name,
          amountPaise: structure.amountPaise,
          gradeId: structure.gradeId ? String(structure.gradeId) : null,
          dueOn: structure.dueOn,
        },
        speak: `"${structure.name}" has been set at ${rupees(structure.amountPaise)}.`,
      });
    },
  },
};

/**
 * Deliberately not exposed: payOnline() and verifyCheckout(). Charging a card
 * from a chat message is a different and much worse product, and
 * confirm-before-commit is not a good enough guard for a payment the user
 * never saw itemised. Families get get_payment_link instead.
 */
