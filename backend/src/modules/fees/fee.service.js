import crypto from 'crypto';
import mongoose from 'mongoose';
import {
  FeeHead, FeeStructure, Invoice, InvoiceLine, Payment, PaymentChangeRequest,
} from '../../models/fee.model.js';
import { Student, Enrollment } from '../../models/student.model.js';
// Registered here rather than relied on: payment rows populate the profiles
// that recorded and verified them, and populate needs the model present even
// when a caller has imported only the fee module.
import '../../models/profile.model.js';
import { AcademicYear, Section, Grade } from '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';
import {
  chargeOnline,
  createPaymentLink,
  isOnlinePaymentEnabled,
  paymentMode,
  fetchGatewayPayment,
  verifyCheckoutSignature,
} from '../../providers/payment.provider.js';
import { logger } from '../../utils/logger.js';
import { runInTransaction } from '../../utils/transaction.js';
import { rowError } from '../../utils/csvImport.js';

// Mirrors the enum on paymentSchema in models/fee.model.js.
const PAYMENT_MODES = ['GATEWAY', 'CASH', 'CHEQUE', 'DD', 'BANK'];

/**
 * What each manual payment mode has to carry.
 *
 * This table is the backend half of requirement 12: the form asks for these
 * fields, and so does the server, so bypassing the form buys nothing. `label`
 * names the field the way the mode's own paperwork does — a cheque has a
 * cheque number, a transfer has a UTR — which is what makes the rejection
 * message usable by the cashier who triggered it.
 */
const INSTRUMENT_RULES = {
  CHEQUE: { number: 'Cheque number', bankName: 'Bank name', instrumentDate: 'Cheque date', proofUrl: 'Cheque image' },
  DD: { number: 'DD number', bankName: 'Bank name', instrumentDate: 'DD date', proofUrl: 'DD image' },
  // A transfer carries two identifiers, not one: the transaction id the payer
  // reads off their app, and the UTR/reference the bank settles under. A
  // reconciliation done months later matches on the UTR, so recording only the
  // transaction id leaves the payment unmatchable — both are required.
  BANK: {
    number: 'Transaction ID',
    referenceNo: 'Reference ID / UTR',
    bankName: 'Bank name',
    instrumentDate: 'Transfer date',
    proofUrl: 'Transfer proof',
  },
};

// Proof is an image of a physical instrument or a bank receipt. Anything
// executable or unopenable is refused: the extension list is intentionally
// narrower than the upload endpoint's, because this is evidence someone will
// have to read years later.
const PROOF_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'webp'];

/**
 * Whether this actor may make payment information final — publish it, approve
 * someone else's, or edit an already-published record.
 *
 * Derived from the permission map rather than from the role name so that a
 * school which builds its own role gets the same rule. Finance is not granted
 * `fees.payments.approve` (see constants/permissions.js), which is precisely
 * what makes every payment it registers land in the approval queue.
 */
export function canPublishPayments(actor) {
  return Boolean(actor?.permissions?.['fees.payments.approve']);
}

/**
 * Validates the instrument details for a manual payment and returns the
 * subdocument to store. Throws with the specific missing fields named.
 */
export function buildInstrument(mode, instrument = {}) {
  const rules = INSTRUMENT_RULES[mode];
  if (!rules) return null; // CASH and GATEWAY carry no instrument of their own.

  const missing = Object.entries(rules)
    .filter(([field]) => {
      const value = instrument?.[field];
      return value === undefined || value === null || String(value).trim() === '';
    })
    .map(([, label]) => label);

  if (missing.length) {
    throw new AppError(
      `${mode === 'BANK' ? 'Bank transfer' : mode} payments require: ${missing.join(', ')}`,
      400,
      missing,
      'PAYMENT_DETAILS_INCOMPLETE'
    );
  }

  const instrumentDate = new Date(instrument.instrumentDate);
  if (Number.isNaN(instrumentDate.getTime())) {
    throw new AppError(`${rules.instrumentDate} is not a valid date`, 400, [], 'PAYMENT_DETAILS_INCOMPLETE');
  }

  const proofUrl = String(instrument.proofUrl).trim();
  const ext = proofUrl.split('?')[0].split('.').pop()?.toLowerCase();
  if (!ext || !PROOF_EXTENSIONS.includes(ext)) {
    throw new AppError(
      `${rules.proofUrl} must be one of: ${PROOF_EXTENSIONS.join(', ')}`,
      400,
      [],
      'PAYMENT_PROOF_INVALID'
    );
  }

  return {
    number: String(instrument.number).trim(),
    // Required on BANK by the table above; on cheque and DD there is no second
    // number, so it stays null unless the school chose to record one.
    referenceNo: instrument.referenceNo ? String(instrument.referenceNo).trim() : null,
    bankName: String(instrument.bankName).trim(),
    instrumentDate,
    proofUrl,
    proofName: instrument.proofName ? String(instrument.proofName).trim() : null,
  };
}

// The unguarded createFeeHead/createFeeStructure pass-throughs that used to
// live here are gone: nothing called them once the controller moved onto the
// actor-aware versions below, and an exported raw Model.create(data) is a way
// back around the scope check, the field allow-list and the audit entry.

export const listFeeHeads = () => FeeHead.find().sort({ name: 1 }).lean();

export function listFeeStructures({ academicYearId, gradeId } = {}) {
  const filter = {};
  if (academicYearId) filter.academicYearId = academicYearId;
  // A structure with gradeId: null applies to every grade, so a grade filter
  // must include those as well as the ones targeted at this grade.
  if (gradeId) filter.$or = [{ gradeId }, { gradeId: null }];
  return FeeStructure.find(filter)
    .populate('feeHeadId', 'name category')
    .populate('gradeId', 'name')
    .sort({ dueOn: 1 })
    .lean();
}

/**
 * Generates invoices for every active enrollment in scope from the fee
 * structures that apply to it — the "define once, bill the whole class" path.
 * Previously invoices could only be made one at a time or from a CSV, which
 * does not scale past a few students.
 *
 * Idempotency is per fee structure, not per run: a structure already billed to
 * an enrollment is skipped, so re-running after adding a new structure bills
 * only the new one and never double-charges a family. This matters because the
 * natural way to use this endpoint is to re-run it whenever something changes.
 *
 * Pass dryRun to preview totals without writing anything.
 */
export async function generateInvoices({ academicYearId, gradeId = null, dueOn, dryRun = false }) {
  if (!academicYearId) throw new AppError('academicYearId is required', 400);

  const structures = await listFeeStructures({ academicYearId, gradeId });
  if (!structures.length) {
    throw new AppError('No fee structures match that academic year/grade', 404, [], 'NO_FEE_STRUCTURES');
  }

  // Active enrollments for the year being billed. Enrollment carries the
  // section, and the section carries the grade, so a grade filter resolves
  // through sections.
  const enrollmentFilter = { status: 'ACTIVE', academicYearId };
  if (gradeId) {
    const sections = await Section.find({ gradeId }).select('_id').lean();
    enrollmentFilter.sectionId = { $in: sections.map((s) => s._id) };
  }
  const enrollments = await Enrollment.find(enrollmentFilter).select('_id sectionId').lean();
  if (!enrollments.length) {
    throw new AppError('No active enrollments match that grade', 404, [], 'NO_ENROLLMENTS');
  }

  const enrollmentIds = enrollments.map((e) => e._id);
  const structureIds = structures.map((s) => s._id);

  // Which (enrollment, structure) pairs have already been billed?
  const existingInvoices = await Invoice.find({ enrollmentId: { $in: enrollmentIds } }).select('_id enrollmentId').lean();
  const invoiceOwner = new Map(existingInvoices.map((i) => [i._id.toString(), i.enrollmentId.toString()]));
  const existingLines = await InvoiceLine.find({
    invoiceId: { $in: existingInvoices.map((i) => i._id) },
    feeStructureId: { $in: structureIds },
  }).select('invoiceId feeStructureId').lean();

  const alreadyBilled = new Set(
    existingLines.map((l) => `${invoiceOwner.get(l.invoiceId.toString())}:${l.feeStructureId}`)
  );

  const result = { generated: 0, skipped: 0, totalPaise: 0, dryRun, invoices: [] };
  const stamp = Date.now();

  for (const enrollment of enrollments) {
    const due = structures.filter((s) => !alreadyBilled.has(`${enrollment._id}:${s._id}`));
    if (!due.length) {
      result.skipped++;
      continue;
    }

    const lines = due.map((s) => ({
      feeStructureId: s._id,
      description: `${s.feeHeadId?.name ?? 'Fee'} — ${s.name}`,
      amountPaise: s.amountPaise,
    }));
    const totalPaise = lines.reduce((sum, l) => sum + l.amountPaise, 0);

    result.generated++;
    result.totalPaise += totalPaise;

    if (dryRun) continue;

    // Latest due date across the billed structures, unless the caller pinned one.
    const invoiceDueOn = dueOn
      ? new Date(dueOn)
      : due.reduce((latest, s) => (s.dueOn > latest ? s.dueOn : latest), due[0].dueOn);

    const invoice = await createInvoice({
      enrollmentId: enrollment._id,
      invoiceNo: `INV-${stamp}-${result.generated}`,
      dueOn: invoiceDueOn,
      lines,
    });
    result.invoices.push({ invoiceNo: invoice.invoiceNo, enrollmentId: enrollment._id, totalPaise });
  }

  return result;
}

async function resolveEnrollmentIdsForOwn(actor) {
  const studentIds =
    actor.roleKey === 'PARENT'
      ? await getGuardianStudentIds(actor.profileId)
      : [await getOwnStudentId(actor.profileId)].filter(Boolean);
  const enrollments = await Enrollment.find({ studentId: { $in: studentIds } }).select('_id');
  return enrollments.map((e) => e._id.toString());
}

/**
 * Payment links for the caller's own outstanding invoices.
 *
 * Reads only — it hands back links, it never moves money. That separation is
 * the point: the assistant may surface a way to pay, but the decision to pay
 * stays with the human, on a page where they can see what they are paying for.
 *
 * Scoping goes through listInvoices(), so a parent can only ever be handed a
 * link for their own children's invoices.
 */
export async function getPaymentLinks(actor, scope, { invoiceId } = {}) {
  if (!isOnlinePaymentEnabled()) {
    throw new AppError(
      'Online payment is not enabled for this school. Please pay at the school office.',
      501, [], 'PAYMENTS_DISABLED'
    );
  }

  const invoices = await listInvoices(actor, scope, {});
  const outstanding = invoices
    .filter((inv) => (invoiceId ? String(inv.id) === String(invoiceId) : true))
    .filter((inv) => inv.status !== 'PAID' && inv.status !== 'CANCELLED')
    .filter((inv) => (inv.totalPaise ?? 0) - (inv.paidPaise ?? 0) > 0);

  if (invoiceId && !outstanding.length) {
    throw new AppError('That invoice is not outstanding, or is not yours.', 404, [], 'INVOICE_NOT_PAYABLE');
  }

  const portalSlug = actor.roleKey === 'STUDENT' ? 'student' : 'parent';
  const links = [];
  for (const inv of outstanding) {
    const duePaise = (inv.totalPaise ?? 0) - (inv.paidPaise ?? 0);
    const link = await createPaymentLink({
      invoiceId: inv.id,
      invoiceNo: inv.invoiceNo,
      amountPaise: duePaise,
      portalSlug,
    });
    links.push({
      invoiceId: inv.id,
      invoiceNo: inv.invoiceNo,
      studentName: inv.studentName ?? null,
      duePaise,
      dueOn: inv.dueOn,
      status: inv.status,
      url: link.url,
      linkKind: link.kind,
    });
  }

  return {
    totalDuePaise: links.reduce((sum, l) => sum + l.duePaise, 0),
    count: links.length,
    links,
  };
}

/**
 * Lists invoices.
 *
 * Passing `page`/`pageSize` paginates at the database level (skip/limit) and
 * returns `{ items, total, page, pageSize, totalPages }`; without them the
 * plain array shape existing callers rely on is unchanged. `search`
 * (invoice no / student name) and `sectionId` narrow the set server-side, so
 * the browser no longer needs the whole 700-row list to filter it.
 */
export async function listInvoices(actor, scope, query = {}) {
  const filter = {};
  if (query.enrollmentId) filter.enrollmentId = query.enrollmentId;
  if (query.status) filter.status = query.status;

  if (scope === 'OWN') {
    const ids = await resolveEnrollmentIdsForOwn(actor);
    filter.enrollmentId = query.enrollmentId ?? { $in: ids };
  }

  // Student/section/grade/year live on the enrollment, so narrowing by them
  // means resolving to a set of enrollment ids first.
  const enrollmentNarrowing = [];
  if (query.academicYearId) {
    const enrs = await Enrollment.find({ academicYearId: query.academicYearId }).select('_id');
    enrollmentNarrowing.push(enrs.map((e) => e._id.toString()));
  }
  if (query.sectionId) {
    const enrs = await Enrollment.find({ sectionId: query.sectionId }).select('_id');
    enrollmentNarrowing.push(enrs.map((e) => e._id.toString()));
  }
  if (query.studentId) {
    const enrs = await Enrollment.find({ studentId: query.studentId }).select('_id');
    enrollmentNarrowing.push(enrs.map((e) => e._id.toString()));
  }
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), 'i');
    const students = await Student.find({
      $or: [{ firstName: rx }, { lastName: rx }, { admissionNo: rx }], deletedAt: null,
    }).select('_id');
    const enrs = students.length
      ? await Enrollment.find({ studentId: { $in: students.map((s) => s._id) } }).select('_id')
      : [];
    const byInvoiceNo = await Invoice.find({ invoiceNo: rx }).select('_id');
    // invoiceNo OR student match — expressed as an $or so both paths count.
    filter.$and = [
      ...(filter.$and ?? []),
      { $or: [
        { _id: { $in: byInvoiceNo.map((i) => i._id) } },
        { enrollmentId: { $in: enrs.map((e) => e._id) } },
      ] },
    ];
  }
  for (const ids of enrollmentNarrowing) {
    filter.$and = [...(filter.$and ?? []), { enrollmentId: { $in: ids } }];
  }

  const requestedSize = parseInt(query.pageSize, 10);
  const size = Number.isFinite(requestedSize) && requestedSize > 0 ? Math.min(requestedSize, 200) : 0;
  const total = size > 0 ? await Invoice.countDocuments(filter) : 0;
  const totalPages = size > 0 ? Math.max(Math.ceil(total / size), 1) : 1;
  // Clamped so a stale page number returns the last real page, not an empty
  // table — consistent with /users, /students and /risk/scan.
  const pageNo = size > 0 ? Math.min(Math.max(parseInt(query.page, 10) || 1, 1), totalPages) : 1;

  let q = Invoice.find(filter)
    .populate({
      path: 'enrollmentId',
      populate: [
        { path: 'studentId' },
        { path: 'sectionId', populate: { path: 'gradeId' } },
        // The year an invoice belongs to is the year of the enrollment it was
        // raised against — there is no second copy of it to drift.
        { path: 'academicYearId', select: 'name startsOn endsOn isCurrent' },
      ]
    })
    // _id breaks ties: every invoice in a batch can share the same dueOn, and
    // a non-total sort order makes skip/limit return overlapping pages.
    .sort({ dueOn: 1, _id: 1 });
  if (size > 0) q = q.skip((pageNo - 1) * size).limit(size);

  const invoices = await q;

  const mapped = invoices.map(inv => {
    const obj = inv.toObject();
    obj.id = obj._id; // frontend keys on `id`
    if (obj.enrollmentId) {
      const student = obj.enrollmentId.studentId;
      const section = obj.enrollmentId.sectionId;
      const grade = section?.gradeId;

      if (student) {
        obj.studentName = `${student.firstName} ${student.lastName || ''}`.trim();
        obj.studentId = student._id.toString();
      }
      if (section) {
        obj.class = grade ? `${grade.name} - ${section.name}` : section.name;
        obj.sectionId = section._id.toString();
      }
      const year = obj.enrollmentId.academicYearId;
      if (year) {
        obj.academicYearId = year._id.toString();
        obj.academicYearName = year.name;
      }
      obj.enrollmentId = obj.enrollmentId._id.toString();
    }
    return obj;
  });

  if (size === 0) return mapped;
  return { items: mapped, total, page: pageNo, pageSize: size, totalPages };
}

export async function createInvoice({ enrollmentId, invoiceNo, dueOn, lines }) {
  const enrollment = await Enrollment.findById(enrollmentId);
  if (!enrollment) throw new AppError('Enrollment not found', 404);

  const totalPaise = lines.reduce((sum, l) => sum + l.amountPaise - (l.concessionPaise ?? 0), 0);
  const invoice = await Invoice.create({ enrollmentId, invoiceNo, dueOn, totalPaise });
  await InvoiceLine.insertMany(lines.map((l) => ({ ...l, invoiceId: invoice._id })));
  return invoice;
}

/**
 * Bulk-creates one-line invoices from CSV rows: admissionNo, invoiceNo
 * (optional — autogenerated if blank), description, amount (rupees),
 * dueOn (date). Each row goes through the same createInvoice() path as the
 * single-invoice form so validation and totals stay identical.
 */
export async function bulkCreateInvoices(rows) {
  const results = { imported: 0, failed: 0, errors: [] };

  const admissionNos = rows.map((r) => r.admissionno?.trim()).filter(Boolean);
  const students = await Student.find({ admissionNo: { $in: admissionNos }, deletedAt: null }).select('_id admissionNo');
  const studentIdByAdmissionNo = new Map(students.map((s) => [s.admissionNo.toLowerCase(), s._id]));

  const studentIds = students.map((s) => s._id);
  const enrollments = await Enrollment.find({ studentId: { $in: studentIds }, status: 'ACTIVE' }).select('_id studentId');
  const enrollmentIdByStudent = new Map(enrollments.map((e) => [e.studentId.toString(), e._id.toString()]));

  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2; // header is row 1
    const row = rows[i];
    const admissionNo = row.admissionno?.trim();
    const description = row.description?.trim();
    const amount = Number(row.amount);
    const dueOn = row.dueon?.trim();

    if (!admissionNo || !description || !Number.isFinite(amount) || amount <= 0 || !dueOn) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: !admissionNo ? 'admissionNo' : !description ? 'description' : !Number.isFinite(amount) || amount <= 0 ? 'amount' : 'dueOn',
        value: !admissionNo ? row.admissionno : !description ? row.description : row.amount,
        problem: 'is required',
        suggestion: 'every row needs admissionNo, description, a positive amount and a due date',
      }));
      continue;
    }

    const studentId = studentIdByAdmissionNo.get(admissionNo.toLowerCase());
    if (!studentId) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: 'admissionNo',
        value: admissionNo,
        problem: 'does not match any student in this school',
        suggestion: 'check the admission number, or import the student first',
      }));
      continue;
    }

    const enrollmentId = enrollmentIdByStudent.get(studentId.toString());
    if (!enrollmentId) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: 'admissionNo',
        value: admissionNo,
        problem: 'names a student with no active enrolment, so there is no class to bill',
        suggestion: 'enrol the student for the current year, then re-upload this row',
      }));
      continue;
    }

    const parsedDueOn = new Date(dueOn);
    if (isNaN(parsedDueOn.getTime())) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: 'dueOn',
        value: dueOn,
        problem: 'is not a date this can read',
        suggestion: 'use YYYY-MM-DD, e.g. 2026-06-10',
      }));
      continue;
    }

    const invoiceNo = row.invoiceno?.trim() || `INV-${Date.now()}-${rowNo}`;

    try {
      await createInvoice({
        enrollmentId,
        invoiceNo,
        dueOn: parsedDueOn,
        lines: [{ description, amountPaise: Math.round(amount * 100) }],
      });
      results.imported++;
    } catch (err) {
      results.failed++;
      results.errors.push(err.code === 11000
        ? rowError(rowNo, {
          field: 'invoiceNo',
          value: invoiceNo,
          problem: 'already exists',
          suggestion: 'leave the column blank to have one generated, or use an unused number',
        })
        : rowError(rowNo, { problem: err.message }));
    }
  }

  return results;
}

/** Ensure the invoice belongs to the actor's own children/self (OWN scope). */
async function assertInvoiceOwnership(actor, invoice) {
  const ownIds = await resolveEnrollmentIdsForOwn(actor);
  if (!ownIds.includes(invoice.enrollmentId.toString())) {
    throw new AppError('This invoice does not belong to your account', 403);
  }
}

/**
 * Registers a payment on the ledger.
 *
 * Two outcomes, decided by `fees.payments.approve`:
 *
 *  - An actor holding it (Admin) publishes directly, exactly as before: the
 *    invoice is credited in the same atomic statement that guards against
 *    overpayment.
 *  - An actor without it (Finance) creates a PENDING_ADMIN_APPROVAL row that
 *    credits nothing. The money only reaches the invoice — and the student's
 *    view of it — when an admin approves it in approvePayment().
 *
 * That is requirement 4 expressed where it cannot be routed around: not as a
 * hidden button, but as the only path from "keyed in" to "counted".
 */
export async function recordPayment(actor, scope, {
  invoiceId, amountPaise, mode, gatewayRef, receiptNo,
  instrument, paidOn, notes, planId, installmentSeq,
}) {
  // Parents/students (OWN scope) cannot use the manual-ledger path — they can
  // only pay online via payOnline(), never "mark" an invoice as paid. Checked
  // before the invoice is read so an unauthorised caller learns nothing about
  // whether the id exists.
  if (scope === 'OWN') {
    throw new AppError('Manual payment recording requires staff access. Use online payment instead.', 403);
  }

  const amount = Number(amountPaise);
  // Money is held in paise precisely so it is always an integer; a fractional
  // amount here means the caller is passing rupees or a float, and silently
  // storing it would corrupt every total derived from this row.
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new AppError('amountPaise must be a positive whole number of paise', 400, [], 'INVALID_AMOUNT');
  }
  // Validated up front so the common mistake fails before anything is written,
  // leaving the compensating path below for genuinely exceptional failures.
  if (!PAYMENT_MODES.includes(mode)) {
    throw new AppError(`mode must be one of: ${PAYMENT_MODES.join(', ')}`, 400, [], 'INVALID_PAYMENT_MODE');
  }

  // Cheque / DD / bank transfer: the instrument details and their proof image
  // are mandatory, server-side, whatever the form did or did not collect.
  const storedInstrument = buildInstrument(mode, instrument);

  const paidOnDate = paidOn ? new Date(paidOn) : new Date();
  if (Number.isNaN(paidOnDate.getTime())) {
    throw new AppError('paidOn is not a valid date', 400, [], 'INVALID_PAYMENT_DATE');
  }

  const publishes = canPublishPayments(actor);

  if (!publishes) {
    return submitPaymentForApproval(actor, {
      invoiceId,
      amount,
      mode,
      instrument: storedInstrument,
      paidOn: paidOnDate,
      notes,
      planId,
      installmentSeq,
      receiptNo,
    });
  }

  return runInTransaction(async (session) => {
    const opts = session ? { session } : {};

    // One atomic statement replaces what used to be three racy steps. The
    // filter is the overpayment guard (it matches only if the payment fits
    // inside the invoice total), the pipeline increments paidPaise *in the
    // database* rather than in application memory — so two cashiers paying the
    // same invoice at once can no longer lose one of the payments — and status
    // is derived from the committed figure in the same operation.
    const invoice = await Invoice.findOneAndUpdate(
      {
        _id: invoiceId,
        status: { $ne: 'CANCELLED' },
        $expr: { $lte: [{ $add: ['$paidPaise', amount] }, '$totalPaise'] },
      },
      [
        { $set: { paidPaise: { $add: ['$paidPaise', amount] } } },
        { $set: { status: { $cond: [{ $gte: ['$paidPaise', '$totalPaise'] }, 'PAID', 'PARTIAL'] } } },
      ],
      { new: true, ...opts }
    );

    if (!invoice) {
      // Nothing matched. Work out which of the three reasons it was, so the
      // caller gets something actionable instead of a bare "not found".
      const existing = await Invoice.findById(invoiceId).select('totalPaise paidPaise status').lean();
      if (!existing) throw new AppError('Invoice not found', 404);
      if (existing.status === 'CANCELLED') {
        throw new AppError('This invoice has been cancelled', 409, [], 'INVOICE_CANCELLED');
      }
      const outstandingPaise = existing.totalPaise - existing.paidPaise;
      throw new AppError(
        outstandingPaise <= 0
          ? 'This invoice is already fully paid'
          : `Payment of ${amount} paise exceeds the outstanding balance of ${outstandingPaise} paise`,
        409,
        [],
        'PAYMENT_EXCEEDS_BALANCE'
      );
    }

    try {
      const [payment] = await Payment.create(
        [{
          invoiceId,
          amountPaise: amount,
          mode,
          gatewayRef,
          receiptNo: receiptNo ?? `RCPT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          instrument: storedInstrument,
          paidOn: paidOnDate,
          notes: notes ?? null,
          planId: planId ?? null,
          installmentSeq: installmentSeq ?? null,
          recordStatus: 'PUBLISHED',
          createdByProfileId: actor?.profileId ?? null,
          createdByRole: actor?.roleKey ?? null,
          approvedByProfileId: actor?.profileId ?? null,
          approvedAt: new Date(),
        }],
        opts
      );

      await recordAudit({
        actor,
        action: 'fees.payment.publish',
        entityType: 'Payment',
        entityId: payment._id,
        after: {
          invoiceId: String(invoiceId),
          amountPaise: amount,
          mode,
          recordStatus: 'PUBLISHED',
          direct: true,
        },
      });

      return {
        payment,
        invoice,
        receiptNo: payment.receiptNo,
        status: invoice.status,
        recordStatus: 'PUBLISHED',
        paidPaise: invoice.paidPaise,
      };
    } catch (err) {
      // Inside a transaction the throw rolls the increment back for us. On a
      // standalone MongoDB, runInTransaction runs us without a session, so the
      // credit above is already committed and has to be undone by hand —
      // otherwise the invoice shows money with no ledger entry behind it.
      if (!session) {
        await Invoice.updateOne({ _id: invoiceId }, [
          { $set: { paidPaise: { $max: [0, { $subtract: ['$paidPaise', amount] }] } } },
          {
            $set: {
              status: {
                $switch: {
                  branches: [
                    { case: { $gte: ['$paidPaise', '$totalPaise'] }, then: 'PAID' },
                    { case: { $gt: ['$paidPaise', 0] }, then: 'PARTIAL' },
                  ],
                  default: 'PENDING',
                },
              },
            },
          },
        ]);
        logger.error(
          `Payment row failed after crediting invoice ${invoiceId}; rolled the credit back by ${amount} paise: ${err.message}`
        );
      }
      throw err;
    }
  });
}

/**
 * Money already keyed in against an invoice but not yet approved.
 *
 * An aggregate rather than a find-and-sum so the arithmetic stays in the
 * database; the tenant plugin prepends its own $match, so this cannot count
 * another school's payments.
 */
async function pendingCreditPaise(invoiceId) {
  const [agg] = await Payment.aggregate([
    {
      $match: {
        // Aggregation does not cast strings to ObjectIds the way a query does.
        invoiceId: new mongoose.Types.ObjectId(String(invoiceId)),
        recordStatus: 'PENDING_ADMIN_APPROVAL',
      },
    },
    { $group: { _id: null, total: { $sum: '$amountPaise' } } },
  ]);
  return agg?.total ?? 0;
}

/**
 * Files a payment Finance has keyed in, for an admin to approve.
 *
 * Nothing is credited here. The overpayment check still runs, and it counts
 * what is already awaiting approval as well as what is already paid — two
 * cashiers each queueing the full balance would otherwise both be accepted and
 * the second would only fail at approval time, long after the payer left.
 */
async function submitPaymentForApproval(actor, {
  invoiceId, amount, mode, instrument, paidOn, notes, planId, installmentSeq, receiptNo,
}) {
  const invoice = await Invoice.findById(invoiceId).lean();
  if (!invoice) throw new AppError('Invoice not found', 404);
  if (invoice.status === 'CANCELLED') {
    throw new AppError('This invoice has been cancelled', 409, [], 'INVOICE_CANCELLED');
  }

  const queued = await pendingCreditPaise(invoiceId);
  const headroom = invoice.totalPaise - invoice.paidPaise - queued;
  if (amount > headroom) {
    throw new AppError(
      headroom <= 0
        ? 'This invoice is already fully paid or fully covered by payments awaiting approval'
        : `Payment of ${amount} paise exceeds the ${headroom} paise still unpaid and unclaimed on this invoice`,
      409,
      [],
      'PAYMENT_EXCEEDS_BALANCE'
    );
  }

  const payment = await Payment.create({
    invoiceId,
    amountPaise: amount,
    mode,
    instrument,
    paidOn,
    notes: notes ?? null,
    planId: planId ?? null,
    installmentSeq: installmentSeq ?? null,
    receiptNo: receiptNo ?? `RCPT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    recordStatus: 'PENDING_ADMIN_APPROVAL',
    createdByProfileId: actor?.profileId ?? null,
    createdByRole: actor?.roleKey ?? null,
  });

  await recordAudit({
    actor,
    action: 'fees.payment.submit',
    entityType: 'Payment',
    entityId: payment._id,
    after: {
      invoiceId: String(invoiceId),
      amountPaise: amount,
      mode,
      recordStatus: 'PENDING_ADMIN_APPROVAL',
      hasProof: Boolean(instrument?.proofUrl),
    },
  });

  return {
    payment,
    receiptNo: payment.receiptNo,
    recordStatus: 'PENDING_ADMIN_APPROVAL',
    status: invoice.status,
    paidPaise: invoice.paidPaise,
    awaitingApproval: true,
    message: 'Payment recorded and sent for admin approval. It is not counted against the invoice until approved.',
  };
}

/**
 * Admin approval: the single point where a queued payment becomes money.
 *
 * The claim on the payment row is atomic (`recordStatus` must still be
 * pending), so two admins approving the same payment at once credit the
 * invoice once. The invoice update carries the same overpayment guard the
 * direct path uses, because the balance can have moved since submission.
 */
export async function approvePayment(actor, paymentId) {
  const claimed = await Payment.findOneAndUpdate(
    { _id: paymentId, recordStatus: 'PENDING_ADMIN_APPROVAL' },
    {
      $set: {
        recordStatus: 'PUBLISHED',
        approvedByProfileId: actor?.profileId ?? null,
        approvedAt: new Date(),
        rejectedByProfileId: null,
        rejectedAt: null,
        rejectionReason: null,
      },
    },
    { new: true }
  );

  if (!claimed) {
    const existing = await Payment.findById(paymentId).select('recordStatus').lean();
    if (!existing) throw new AppError('Payment not found', 404);
    throw new AppError(
      `This payment is already ${(existing.recordStatus ?? 'PUBLISHED').toLowerCase().replace(/_/g, ' ')}`,
      409,
      [],
      'PAYMENT_NOT_PENDING'
    );
  }

  const invoice = await Invoice.findOneAndUpdate(
    {
      _id: claimed.invoiceId,
      status: { $ne: 'CANCELLED' },
      $expr: { $lte: [{ $add: ['$paidPaise', claimed.amountPaise] }, '$totalPaise'] },
    },
    [
      { $set: { paidPaise: { $add: ['$paidPaise', claimed.amountPaise] } } },
      { $set: { status: { $cond: [{ $gte: ['$paidPaise', '$totalPaise'] }, 'PAID', 'PARTIAL'] } } },
    ],
    { new: true }
  );

  if (!invoice) {
    // The balance moved between submission and approval. Put the payment back
    // in the queue rather than leaving it published against nothing.
    await Payment.updateOne(
      { _id: claimed._id },
      { $set: { recordStatus: 'PENDING_ADMIN_APPROVAL', approvedByProfileId: null, approvedAt: null } }
    );
    throw new AppError(
      'This payment no longer fits the invoice balance — the invoice has been paid or cancelled since it was submitted.',
      409,
      [],
      'PAYMENT_EXCEEDS_BALANCE'
    );
  }

  await recordAudit({
    actor,
    action: 'fees.payment.approve',
    entityType: 'Payment',
    entityId: claimed._id,
    before: { recordStatus: 'PENDING_ADMIN_APPROVAL' },
    after: {
      recordStatus: 'PUBLISHED',
      amountPaise: claimed.amountPaise,
      invoiceId: String(claimed.invoiceId),
      invoiceStatus: invoice.status,
      paidPaise: invoice.paidPaise,
    },
  });

  return { payment: claimed, invoice, status: invoice.status, paidPaise: invoice.paidPaise };
}

/** Admin rejection. Nothing was credited, so nothing has to be reversed. */
export async function rejectPayment(actor, paymentId, reason) {
  if (!reason || !String(reason).trim()) {
    throw new AppError('A reason is required to reject a payment', 400, [], 'REASON_REQUIRED');
  }

  const rejected = await Payment.findOneAndUpdate(
    { _id: paymentId, recordStatus: 'PENDING_ADMIN_APPROVAL' },
    {
      $set: {
        recordStatus: 'REJECTED',
        status: 'FAILED',
        rejectedByProfileId: actor?.profileId ?? null,
        rejectedAt: new Date(),
        rejectionReason: String(reason).trim(),
      },
    },
    { new: true }
  );

  if (!rejected) {
    const existing = await Payment.findById(paymentId).select('recordStatus').lean();
    if (!existing) throw new AppError('Payment not found', 404);
    throw new AppError('Only a payment awaiting approval can be rejected', 409, [], 'PAYMENT_NOT_PENDING');
  }

  await recordAudit({
    actor,
    action: 'fees.payment.reject',
    entityType: 'Payment',
    entityId: rejected._id,
    before: { recordStatus: 'PENDING_ADMIN_APPROVAL' },
    after: { recordStatus: 'REJECTED', reason: rejected.rejectionReason },
  });

  return rejected;
}

/**
 * Direct edit of a payment record — admin only.
 *
 * Finance reaches this same set of fields through a change request; an admin
 * may apply one immediately. Either way the before/after pair is written to
 * the audit trail, which is the only durable record of what a figure used to
 * say.
 */
const EDITABLE_PAYMENT_FIELDS = new Set([
  'amountPaise', 'mode', 'paidOn', 'receiptNo', 'notes',
  'instrument.number', 'instrument.referenceNo', 'instrument.bankName',
  'instrument.instrumentDate', 'instrument.proofUrl', 'instrument.proofName',
]);

function readPaymentField(payment, field) {
  if (field.startsWith('instrument.')) return payment.instrument?.[field.split('.')[1]] ?? null;
  return payment[field] ?? null;
}

/** Coerces a submitted value into the type the field actually stores. */
function coercePaymentField(field, value) {
  if (field === 'amountPaise') {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
      throw new AppError('amountPaise must be a positive whole number of paise', 400, [], 'INVALID_AMOUNT');
    }
    return n;
  }
  if (field === 'mode') {
    if (!PAYMENT_MODES.includes(value)) {
      throw new AppError(`mode must be one of: ${PAYMENT_MODES.join(', ')}`, 400, [], 'INVALID_PAYMENT_MODE');
    }
    return value;
  }
  if (field === 'paidOn' || field === 'instrument.instrumentDate') {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new AppError(`${field} is not a valid date`, 400, [], 'INVALID_PAYMENT_DATE');
    return d;
  }
  return value == null ? null : String(value);
}

/**
 * Applies one field change to a payment, adjusting the invoice when the amount
 * moves. Shared by the admin's direct edit and by an approved change request,
 * so both leave the ledger in the same state.
 */
async function applyPaymentFieldChange(actor, payment, field, rawValue, { action, extra = {} }) {
  if (!EDITABLE_PAYMENT_FIELDS.has(field)) {
    throw new AppError(
      `"${field}" is not an editable payment field. Editable: ${[...EDITABLE_PAYMENT_FIELDS].join(', ')}`,
      400,
      [],
      'FIELD_NOT_EDITABLE'
    );
  }

  const before = readPaymentField(payment, field);
  const value = coercePaymentField(field, rawValue);

  if (field === 'amountPaise' && payment.recordStatus !== 'REJECTED') {
    const delta = value - payment.amountPaise;
    if (delta !== 0 && (payment.recordStatus ?? 'PUBLISHED') === 'PUBLISHED') {
      // Only a published payment is on the invoice, so only that one needs the
      // invoice moved with it — and only if the new figure still fits.
      const invoice = await Invoice.findOneAndUpdate(
        {
          _id: payment.invoiceId,
          status: { $ne: 'CANCELLED' },
          $expr: { $lte: [{ $add: ['$paidPaise', delta] }, '$totalPaise'] },
        },
        [
          { $set: { paidPaise: { $max: [0, { $add: ['$paidPaise', delta] }] } } },
          {
            $set: {
              status: {
                $switch: {
                  branches: [
                    { case: { $gte: ['$paidPaise', '$totalPaise'] }, then: 'PAID' },
                    { case: { $gt: ['$paidPaise', 0] }, then: 'PARTIAL' },
                  ],
                  default: 'PENDING',
                },
              },
            },
          },
        ],
        { new: true }
      );
      if (!invoice) {
        throw new AppError(
          'That amount would take the invoice past its total, or the invoice is cancelled',
          409,
          [],
          'PAYMENT_EXCEEDS_BALANCE'
        );
      }
    }
  }

  if (field.startsWith('instrument.')) {
    payment.instrument = payment.instrument ?? {};
    payment.instrument[field.split('.')[1]] = value;
    payment.markModified('instrument');
  } else {
    payment[field] = value;
  }
  await payment.save();

  await recordAudit({
    actor,
    action,
    entityType: 'Payment',
    entityId: payment._id,
    before: { field, value: before instanceof Date ? before.toISOString() : before },
    after: {
      field,
      value: value instanceof Date ? value.toISOString() : value,
      invoiceId: String(payment.invoiceId),
      ...extra,
    },
  });

  return payment;
}

/** Admin edit of a payment record, one or more fields at a time. */
export async function updatePayment(actor, paymentId, patch = {}) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new AppError('Payment not found', 404);

  // Defence in depth. The route already demands `fees.payments.approve`, but a
  // verified payment is the record a dispute is settled from, so the service
  // refuses to edit one for an actor who could not have verified it in the
  // first place. That way an agent tool, a script or a future route reaching
  // this function directly gets the same answer the API gives.
  if ((payment.recordStatus ?? 'PUBLISHED') === 'PUBLISHED' && !canPublishPayments(actor)) {
    throw new AppError(
      'Changing a verified payment needs payment-approval rights — file a change request instead',
      403,
      [],
      'PAYMENT_VERIFIED_LOCKED'
    );
  }

  const fields = Object.keys(patch).filter((k) => k !== 'reason');
  if (!fields.length) throw new AppError('Nothing to change', 400, [], 'NO_CHANGES');

  for (const field of fields) {
    await applyPaymentFieldChange(actor, payment, field, patch[field], {
      action: 'fees.payment.edit',
      extra: { reason: patch.reason ?? null, byRole: actor?.roleKey ?? null },
    });
  }
  return payment;
}

/**
 * Finance's route to changing a published payment: a request, not an edit.
 *
 * Refused outright while the payment is still pending, because at that point
 * Finance can simply correct the record itself — a change request there would
 * be ceremony with no separation of duties behind it.
 */
export async function createPaymentChangeRequest(actor, { paymentId, field, requestedValue, reason, documentUrl, documentName }) {
  if (!reason || !String(reason).trim()) {
    throw new AppError('A reason is required for a change request', 400, [], 'REASON_REQUIRED');
  }
  if (!EDITABLE_PAYMENT_FIELDS.has(field)) {
    throw new AppError(
      `"${field}" is not an editable payment field. Editable: ${[...EDITABLE_PAYMENT_FIELDS].join(', ')}`,
      400,
      [],
      'FIELD_NOT_EDITABLE'
    );
  }

  const payment = await Payment.findById(paymentId).lean();
  if (!payment) throw new AppError('Payment not found', 404);
  if ((payment.recordStatus ?? 'PUBLISHED') !== 'PUBLISHED') {
    throw new AppError(
      'Only a published payment needs a change request — this one is still awaiting a decision.',
      409,
      [],
      'PAYMENT_NOT_PUBLISHED'
    );
  }

  // Validate now rather than at approval, so Finance finds out immediately.
  coercePaymentField(field, requestedValue);

  const current = readPaymentField(payment, field);
  const request = await PaymentChangeRequest.create({
    paymentId,
    field,
    currentValue: current instanceof Date ? current.toISOString() : current == null ? null : String(current),
    requestedValue: requestedValue == null ? null : String(requestedValue),
    reason: String(reason).trim(),
    documentUrl: documentUrl ?? null,
    documentName: documentName ?? null,
    requestedByProfileId: actor?.profileId ?? null,
    requestedByRole: actor?.roleKey ?? null,
  });

  await recordAudit({
    actor,
    action: 'fees.payment.changeRequest',
    entityType: 'PaymentChangeRequest',
    entityId: request._id,
    before: { field, value: request.currentValue },
    after: { field, value: request.requestedValue, reason: request.reason, paymentId: String(paymentId) },
  });

  return request;
}

export async function listPaymentChangeRequests({ status, paymentId } = {}) {
  const filter = {};
  if (status) filter.status = status;
  if (paymentId) filter.paymentId = paymentId;

  const requests = await PaymentChangeRequest.find(filter)
    .populate({ path: 'requestedByProfileId', select: 'displayName' })
    .populate({ path: 'decidedByProfileId', select: 'displayName' })
    .populate({ path: 'paymentId', select: 'receiptNo amountPaise mode invoiceId recordStatus' })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  return requests.map((r) => ({
    id: r._id.toString(),
    paymentId: r.paymentId?._id?.toString() ?? String(r.paymentId),
    receiptNo: r.paymentId?.receiptNo ?? '—',
    field: r.field,
    currentValue: r.currentValue,
    requestedValue: r.requestedValue,
    reason: r.reason,
    documentUrl: r.documentUrl,
    documentName: r.documentName,
    status: r.status,
    requestedBy: r.requestedByProfileId?.displayName ?? null,
    requestedByRole: r.requestedByRole,
    requestedAt: r.requestedAt ?? r.createdAt,
    decidedBy: r.decidedByProfileId?.displayName ?? null,
    decidedAt: r.decidedAt,
    decisionReason: r.decisionReason,
  }));
}

/** Admin decision on a change request. Approving is what applies the change. */
export async function decidePaymentChangeRequest(actor, requestId, { approve, reason }) {
  const request = await PaymentChangeRequest.findOneAndUpdate(
    { _id: requestId, status: 'PENDING_ADMIN_APPROVAL' },
    {
      $set: {
        status: approve ? 'APPROVED' : 'REJECTED',
        decidedByProfileId: actor?.profileId ?? null,
        decidedAt: new Date(),
        decisionReason: reason ? String(reason).trim() : null,
      },
    },
    { new: true }
  );

  if (!request) {
    const existing = await PaymentChangeRequest.findById(requestId).select('status').lean();
    if (!existing) throw new AppError('Change request not found', 404);
    throw new AppError('This change request has already been decided', 409, [], 'REQUEST_ALREADY_DECIDED');
  }

  if (!approve) {
    if (!reason || !String(reason).trim()) {
      // Put it back: a rejection with no reason is not a decision anyone can act on.
      await PaymentChangeRequest.updateOne(
        { _id: requestId },
        { $set: { status: 'PENDING_ADMIN_APPROVAL', decidedByProfileId: null, decidedAt: null, decisionReason: null } }
      );
      throw new AppError('A reason is required to reject a change request', 400, [], 'REASON_REQUIRED');
    }
    await recordAudit({
      actor,
      action: 'fees.payment.changeRequest.reject',
      entityType: 'PaymentChangeRequest',
      entityId: request._id,
      after: { field: request.field, keptValue: request.currentValue, reason: request.decisionReason },
    });
    return request;
  }

  const payment = await Payment.findById(request.paymentId);
  if (!payment) throw new AppError('The payment this request refers to no longer exists', 404);

  await applyPaymentFieldChange(actor, payment, request.field, request.requestedValue, {
    action: 'fees.payment.changeRequest.approve',
    extra: {
      changeRequestId: String(request._id),
      reason: request.reason,
      requestedByRole: request.requestedByRole,
    },
  });

  return request;
}

/**
 * The provenance of one payment: who created it, who submitted, reviewed,
 * approved or rejected it, and every value that has changed since.
 */
export async function getPaymentHistory(paymentId) {
  const { AuditLog } = await import('../../models/auditLog.model.js');
  const payment = await Payment.findById(paymentId)
    .populate({ path: 'createdByProfileId', select: 'displayName' })
    .populate({ path: 'approvedByProfileId', select: 'displayName' })
    .populate({ path: 'rejectedByProfileId', select: 'displayName' })
    .lean();
  if (!payment) throw new AppError('Payment not found', 404);

  const [entries, changeRequests] = await Promise.all([
    AuditLog.find({ entityType: 'Payment', entityId: String(paymentId) })
      .populate({ path: 'actorProfileId', select: 'displayName' })
      .sort({ createdAt: 1 })
      .lean(),
    listPaymentChangeRequests({ paymentId }),
  ]);

  return {
    id: payment._id.toString(),
    receiptNo: payment.receiptNo ?? '—',
    amountPaise: payment.amountPaise,
    mode: payment.mode,
    recordStatus: payment.recordStatus ?? 'PUBLISHED',
    createdBy: payment.createdByProfileId?.displayName ?? null,
    createdByRole: payment.createdByRole ?? null,
    createdAt: payment.createdAt,
    approvedBy: payment.approvedByProfileId?.displayName ?? null,
    approvedAt: payment.approvedAt,
    rejectedBy: payment.rejectedByProfileId?.displayName ?? null,
    rejectedAt: payment.rejectedAt,
    rejectionReason: payment.rejectionReason,
    changeRequests,
    trail: entries.map((e) => ({
      id: e._id.toString(),
      action: e.action,
      actor: e.actorProfileId?.displayName ?? null,
      before: e.before ?? null,
      after: e.after ?? null,
      at: e.createdAt,
    })),
  };
}

/**
 * Online payment ("Pay Now") through the payment-provider abstraction.
 * OWN-scoped actors may only pay their own invoices; the charge reference
 * from the provider is recorded on the real ledger.
 */
export async function payOnline(actor, scope, { invoiceId, amountPaise }) {
  if (!isOnlinePaymentEnabled()) {
    throw new AppError('Online payments are not enabled for this school yet.', 501, [], 'PAYMENTS_DISABLED');
  }

  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw new AppError('Invoice not found', 404);
  if (scope === 'OWN') await assertInvoiceOwnership(actor, invoice);

  const duePaise = invoice.totalPaise - invoice.paidPaise;
  if (duePaise <= 0) throw new AppError('This invoice is already fully paid', 409);

  const amount = Number(amountPaise ?? duePaise);
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError('amountPaise must be a positive number', 400);
  if (amount > duePaise) throw new AppError('Amount exceeds the outstanding balance', 400);

  const charge = await chargeOnline({ amountPaise: amount, invoiceNo: invoice.invoiceNo, payerProfileId: actor.profileId });

  // Real gateway: an order exists but no money has moved. Record the intent so
  // the webhook has something to match against, and hand the order to the
  // client. The invoice is deliberately left untouched.
  if (charge.requiresClientAction) {
    const pending = await Payment.create({
      invoiceId,
      amountPaise: amount,
      mode: 'GATEWAY',
      gatewayRef: charge.gatewayRef,
      gatewayOrderRef: charge.order.orderId,
      status: 'INITIATED',
    });

    return {
      requiresClientAction: true,
      provider: charge.provider,
      orderId: charge.order.orderId,
      keyId: charge.order.keyId,
      currency: charge.order.currency,
      amountPaise: charge.order.amountPaise,
      paymentIntentId: pending._id,
      invoiceNo: invoice.invoiceNo,
      status: invoice.status,
    };
  }

  if (!charge.captured) {
    throw new AppError(charge.error ?? 'Payment could not be processed', 502, [], charge.code ?? 'PAYMENT_FAILED');
  }

  const payment = await Payment.create({
    invoiceId,
    amountPaise: amount,
    mode: 'GATEWAY',
    gatewayRef: charge.gatewayRef,
    receiptNo: `RCPT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
  });

  invoice.paidPaise += amount;
  invoice.status = invoice.paidPaise >= invoice.totalPaise ? 'PAID' : 'PARTIAL';
  await invoice.save();

  return {
    receiptNo: payment.receiptNo,
    gatewayRef: charge.gatewayRef,
    provider: charge.provider,
    sandbox: charge.provider === 'sandbox',
    status: invoice.status,
    paidPaise: invoice.paidPaise,
  };
}

/**
 * Settles a payment from a gateway webhook that has **already been signature
 * verified** by the controller. Never call this with unverified input.
 *
 * Three things make this safe to expose to the internet:
 *
 *  1. The amount is taken from the payment intent we created, not from the
 *     event — a forged or replayed event cannot inflate what gets credited,
 *     and a mismatch is refused outright rather than reconciled.
 *  2. Settlement is claimed with an atomic status transition, so duplicate
 *     deliveries (which Razorpay does on retry) credit the ledger exactly
 *     once. This matters more than usual here: the local dev database is a
 *     standalone mongod, so multi-document transactions are unavailable.
 *  3. The invoice total is moved with $inc rather than a read-modify-write,
 *     so two invoices settling at once cannot clobber each other.
 */
export async function settleGatewayPayment({ event, orderId, gatewayPaymentId, amountPaise, verifyWithGateway = true }) {
  if (event && event !== 'payment.captured') {
    return { handled: false, reason: `Ignoring unhandled event: ${event}` };
  }
  if (!orderId) return { handled: false, reason: 'Event carried no order id' };

  const intent = await Payment.findOne({ gatewayOrderRef: orderId }).lean()
    ?? await Payment.findOne({ gatewayRef: orderId }).lean();

  if (!intent) {
    // Genuinely possible: a payment made against an order this environment
    // never created (e.g. a webhook from another deployment sharing a secret).
    logger.warn(`Razorpay webhook for unknown order ${orderId} — ignored`);
    return { handled: false, reason: 'No matching payment intent' };
  }

  if (intent.status === 'SUCCESS') {
    return { handled: true, idempotent: true, paymentId: intent._id, reason: 'Already settled' };
  }

  // The event says one amount; we ordered another. Refusing is the only safe
  // move — crediting either figure would be guessing about real money.
  if (Number(amountPaise) !== Number(intent.amountPaise)) {
    logger.error(
      `Razorpay amount mismatch on order ${orderId}: event=${amountPaise} intent=${intent.amountPaise} — refusing to settle`
    );
    await Payment.updateOne({ _id: intent._id }, { $set: { status: 'FAILED' } });
    return { handled: false, reason: 'AMOUNT_MISMATCH', expected: intent.amountPaise, received: Number(amountPaise) };
  }

  // Ask the gateway directly rather than believing the payload. A valid
  // signature proves the message came from Razorpay, not that it is current.
  if (verifyWithGateway && gatewayPaymentId) {
    try {
      const live = await fetchGatewayPayment(gatewayPaymentId);
      if (!live.captured) {
        return { handled: false, reason: `Gateway reports status "${live.status}", not captured` };
      }
      if (Number(live.amountPaise) !== Number(intent.amountPaise)) {
        return { handled: false, reason: 'AMOUNT_MISMATCH_AT_GATEWAY' };
      }
    } catch (err) {
      logger.error(`Could not confirm payment ${gatewayPaymentId} with Razorpay: ${err.message}`);
      return { handled: false, reason: 'GATEWAY_UNREACHABLE' };
    }
  }

  // Atomic claim: only the delivery that flips INITIATED→SUCCESS credits the
  // ledger. Retries find nothing to update and fall through as idempotent.
  const claimed = await Payment.findOneAndUpdate(
    { _id: intent._id, status: 'INITIATED' },
    {
      $set: {
        status: 'SUCCESS',
        gatewayRef: gatewayPaymentId ?? intent.gatewayRef,
        gatewayOrderRef: orderId,
        receiptNo: intent.receiptNo ?? `RCPT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        reconciledAt: new Date(),
      },
    },
    { new: true }
  );

  if (!claimed) {
    return { handled: true, idempotent: true, paymentId: intent._id, reason: 'Concurrent delivery already settled this payment' };
  }

  await Invoice.updateOne({ _id: claimed.invoiceId }, { $inc: { paidPaise: claimed.amountPaise } });

  // Status is derived after the increment so it reflects the committed total.
  const invoice = await Invoice.findById(claimed.invoiceId);
  invoice.status = invoice.paidPaise >= invoice.totalPaise ? 'PAID' : 'PARTIAL';
  await invoice.save();

  logger.info(
    `Razorpay settled ${claimed.amountPaise} paise on invoice ${invoice.invoiceNo} → ${invoice.status} (payment ${gatewayPaymentId})`
  );

  return {
    handled: true,
    paymentId: claimed._id,
    receiptNo: claimed.receiptNo,
    invoiceNo: invoice.invoiceNo,
    invoiceStatus: invoice.status,
    paidPaise: invoice.paidPaise,
    totalPaise: invoice.totalPaise,
  };
}

/**
 * Confirms a checkout the payer just completed in their browser.
 *
 * Razorpay hands the browser back `order_id|payment_id|signature`, signed with
 * the API key secret. This exists so the payer gets an immediate answer rather
 * than staring at a spinner until the webhook lands.
 *
 * It is deliberately NOT a second way to move money. The signature is checked,
 * and then settlement goes through exactly the same settleGatewayPayment() the
 * webhook uses — same amount check against the intent we created, same atomic
 * claim, same confirmation with the gateway. So this racing the webhook is
 * harmless: whichever arrives first settles, the other returns idempotent.
 *
 * A closed browser tab therefore costs nothing; the webhook remains the
 * authority. This is a latency optimisation wearing a seatbelt.
 */
export async function verifyCheckout(actor, scope, { orderId, paymentId, signature }) {
  if (!orderId || !paymentId || !signature) {
    throw new AppError('orderId, paymentId and signature are required', 400);
  }

  if (!verifyCheckoutSignature({ orderId, paymentId, signature })) {
    logger.warn(`Rejected checkout callback with a bad signature for order ${orderId}`);
    throw new AppError('Payment could not be verified', 400, [], 'CHECKOUT_SIGNATURE_INVALID');
  }

  // Ownership: the intent must belong to an invoice this actor may pay.
  const intent = await Payment.findOne({ gatewayOrderRef: orderId });
  if (!intent) throw new AppError('No payment found for that order', 404);
  if (scope === 'OWN') {
    const invoice = await Invoice.findById(intent.invoiceId);
    if (!invoice) throw new AppError('Invoice not found', 404);
    await assertInvoiceOwnership(actor, invoice);
  }

  const result = await settleGatewayPayment({
    event: 'payment.captured',
    orderId,
    gatewayPaymentId: paymentId,
    amountPaise: intent.amountPaise,
  });

  if (!result.handled) {
    throw new AppError(
      result.reason === 'GATEWAY_UNREACHABLE'
        ? 'Your payment is being confirmed. It will appear on your invoice shortly.'
        : 'Payment could not be confirmed.',
      502,
      [],
      result.reason ?? 'PAYMENT_UNCONFIRMED'
    );
  }

  return result;
}

/** Escapes a user-supplied string so it is matched literally inside a $regex. */
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Invoice IDs whose invoice number or student name matches the search text.
 * Both live outside the Payment collection, so they are resolved to a set of
 * invoice IDs first rather than joined in the payments query.
 */
async function invoiceIdsMatchingSearch(search) {
  const rx = new RegExp(escapeRegex(search), 'i');
  const students = await Student.find({
    $or: [{ firstName: rx }, { lastName: rx }, { admissionNo: rx }],
    deletedAt: null,
  }).select('_id');
  const enrollmentIds = students.length
    ? (await Enrollment.find({ studentId: { $in: students.map((s) => s._id) } }).select('_id')).map((e) => e._id)
    : [];
  const invoices = await Invoice.find({
    $or: [{ invoiceNo: rx }, ...(enrollmentIds.length ? [{ enrollmentId: { $in: enrollmentIds } }] : [])],
  }).select('_id');
  return invoices.map((i) => i._id);
}

/**
 * List payment receipts (scoped: parents/students see only their own).
 *
 * Optional `search` (receipt no / invoice no / student), `from`/`to` (receipt
 * date range) and `page`/`pageSize` narrow the list server-side. Passing
 * `page`/`pageSize` returns `{ items, total, page, pageSize, totalPages }`;
 * without them the plain array shape existing callers rely on is unchanged.
 */
export async function listPayments(actor, scope, {
  invoiceId, search, from, to, page, pageSize, academicYearId, recordStatus,
} = {}) {
  const filter = {};
  if (invoiceId) filter.invoiceId = invoiceId;

  if (scope === 'OWN') {
    const ids = await resolveEnrollmentIdsForOwn(actor);
    const invoices = await Invoice.find({ enrollmentId: { $in: ids } }).select('_id');
    const allowed = invoices.map((i) => i._id);
    filter.invoiceId = invoiceId ?? { $in: allowed };
    if (invoiceId && !allowed.some((id) => id.toString() === invoiceId)) {
      throw new AppError('This invoice does not belong to your account', 403);
    }
    // A family sees settled money only. A payment Finance has keyed in but no
    // admin has approved is an internal draft, and showing it would tell a
    // student their fees are paid before anyone has agreed that they are.
    // `$ne` rather than `$eq` so rows written before recordStatus existed
    // (which have no value at all) still count as published.
    filter.recordStatus = { $nin: ['PENDING_ADMIN_APPROVAL', 'REJECTED'] };
  } else if (recordStatus) {
    filter.recordStatus = recordStatus === 'PUBLISHED'
      ? { $nin: ['PENDING_ADMIN_APPROVAL', 'REJECTED'] }
      : recordStatus;
  }

  // Payments belong to the year of the invoice they settle.
  if (academicYearId) {
    const enrs = await Enrollment.find({ academicYearId }).select('_id');
    const yearInvoices = await Invoice.find({ enrollmentId: { $in: enrs.map((e) => e._id) } }).select('_id');
    filter.$and = [...(filter.$and ?? []), { invoiceId: { $in: yearInvoices.map((i) => i._id) } }];
  }

  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    // `to` is a calendar day: include everything up to the end of it.
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  }

  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    const matchedInvoiceIds = await invoiceIdsMatchingSearch(search);
    // Any invoice restriction already in place (own-scope, or an explicit
    // invoiceId) must still hold, so the search goes in as an extra $and clause.
    filter.$and = [
      ...(filter.$and ?? []),
      { $or: [{ receiptNo: rx }, ...(matchedInvoiceIds.length ? [{ invoiceId: { $in: matchedInvoiceIds } }] : [])] },
    ];
  }

  const requestedPageSize = parseInt(pageSize, 10);
  const size = Number.isFinite(requestedPageSize) && requestedPageSize > 0 ? Math.min(requestedPageSize, 200) : 0;
  const paginate = size > 0;
  const total = paginate ? await Payment.countDocuments(filter) : 0;
  const totalPagesCalc = paginate ? Math.max(Math.ceil(total / size), 1) : 1;
  // Clamped like every other paginated list, so a stale page number shows the
  // last page of real receipts instead of an empty table.
  const pageNo = paginate ? Math.min(Math.max(parseInt(page, 10) || 1, 1), totalPagesCalc) : 1;

  const query = Payment.find(filter)
    .populate({ path: 'createdByProfileId', select: 'displayName' })
    .populate({ path: 'approvedByProfileId', select: 'displayName' })
    .populate({ path: 'rejectedByProfileId', select: 'displayName' })
    .populate({
      path: 'invoiceId',
      select: 'invoiceNo enrollmentId',
      populate: {
        path: 'enrollmentId',
        select: 'studentId sectionId',
        populate: [
          { path: 'studentId', select: 'firstName lastName' },
          { path: 'sectionId', select: 'name', populate: { path: 'gradeId', select: 'name' } },
        ],
      },
    })
    .sort({ createdAt: -1, _id: -1 });

  const payments = paginate
    ? await query.skip((pageNo - 1) * size).limit(size).lean()
    : await query.limit(200).lean();

  const items = payments.map((p) => {
    const inv = p.invoiceId;
    const enrollment = inv?.enrollmentId;
    const student = enrollment?.studentId;
    const section = enrollment?.sectionId;
    return {
      id: p._id,
      receiptNo: p.receiptNo ?? '—',
      invoiceNo: inv?.invoiceNo ?? '—',
      studentName: student ? `${student.firstName} ${student.lastName ?? ''}`.trim() : '—',
      class: section ? [section.gradeId?.name, section.name].filter(Boolean).join(' - ') : '—',
      amountPaise: p.amountPaise,
      mode: p.mode,
      status: p.status ?? 'CAPTURED',
      recordStatus: p.recordStatus ?? 'PUBLISHED',
      paidOn: p.paidOn ?? p.createdAt,
      instrument: p.instrument ?? null,
      createdAt: p.createdAt,
      // Who keyed it in and who made it final — the two facts a receipt is
      // useless without when it is questioned later. Sent on the list rather
      // than only on the history dialog so a verified payment says so in place.
      ...verificationOf(p),
    };
  });

  if (!paginate) return items;
  return { items, total, page: pageNo, pageSize: size, totalPages: totalPagesCalc };
}

/**
 * The verification facing of a payment row.
 *
 * `recordStatus` is the stored state machine; `verificationStatus` is the same
 * fact in the vocabulary the finance office and the QA report use. They are
 * derived from one another rather than stored twice, so no row can ever say
 * PUBLISHED in one field and "Pending verification" in the other.
 */
export const VERIFICATION_STATUS = {
  PENDING_ADMIN_APPROVAL: 'PENDING_VERIFICATION',
  PUBLISHED: 'VERIFIED',
  REJECTED: 'REJECTED',
};

const nameOf = (ref) => (ref && typeof ref === 'object' ? ref.displayName ?? null : null);

export function verificationOf(payment) {
  const recordStatus = payment.recordStatus ?? 'PUBLISHED';
  return {
    verificationStatus: VERIFICATION_STATUS[recordStatus] ?? 'VERIFIED',
    recordedBy: nameOf(payment.createdByProfileId),
    recordedByRole: payment.createdByRole ?? null,
    verifiedBy: nameOf(payment.approvedByProfileId),
    verifiedAt: payment.approvedAt ?? null,
    rejectedBy: nameOf(payment.rejectedByProfileId),
    rejectedAt: payment.rejectedAt ?? null,
    rejectionReason: payment.rejectionReason ?? null,
  };
}

/**
 * The academic years this caller actually has fee records for.
 *
 * Populated from the caller's own enrollments rather than from the school's
 * year list: a student who joined in 2025 should not be offered 2019 in a
 * dropdown and then shown an empty page. Ordered newest first so the year a
 * family cares about is the default.
 *
 * This is also why the student portal does not need `academics.read` — that
 * permission would hand a family the school's entire structure to answer a
 * question about their own invoices.
 */
export async function listPaymentAcademicYears(actor, scope) {
  const enrollmentFilter = {};
  if (scope === 'OWN') {
    const studentIds =
      actor.roleKey === 'PARENT'
        ? await getGuardianStudentIds(actor.profileId)
        : [await getOwnStudentId(actor.profileId)].filter(Boolean);
    enrollmentFilter.studentId = { $in: studentIds };
  }

  const enrollments = await Enrollment.find(enrollmentFilter).select('_id academicYearId').lean();
  if (!enrollments.length) return [];

  const yearIds = [...new Set(enrollments.map((e) => String(e.academicYearId)).filter(Boolean))];
  const years = await AcademicYear.find({ _id: { $in: yearIds } }).sort({ startsOn: -1 }).lean();

  // How many invoices sit behind each year, so the picker can say when a year
  // is empty before the student clicks into it.
  const byYear = new Map(yearIds.map((id) => [id, []]));
  for (const e of enrollments) {
    byYear.get(String(e.academicYearId))?.push(e._id);
  }
  const counts = await Promise.all(
    years.map((y) => Invoice.countDocuments({ enrollmentId: { $in: byYear.get(String(y._id)) ?? [] } }))
  );

  return years.map((y, i) => ({
    id: y._id.toString(),
    name: y.name,
    startsOn: y.startsOn,
    endsOn: y.endsOn,
    isCurrent: Boolean(y.isCurrent),
    invoiceCount: counts[i],
  }));
}

/**
 * Everything the student payments page shows for one academic year: the year
 * itself, the totals, the published installment plans, the invoices and the
 * settled payments — all filtered by the same year, in one round trip.
 *
 * Fetching them together is what makes "do not mix payments from different
 * years" a property of the endpoint rather than of four separate calls the
 * page has to keep in step.
 */
export async function getStudentPaymentOverview(actor, scope, { academicYearId } = {}) {
  const years = await listPaymentAcademicYears(actor, scope);
  if (!years.length) {
    return { years: [], academicYearId: null, summary: null, plans: [], invoices: [], payments: [] };
  }

  // Default to the school's current year when the caller has records in it,
  // else the most recent year they do have records in.
  const selected =
    years.find((y) => String(y.id) === String(academicYearId))
    ?? years.find((y) => y.isCurrent)
    ?? years[0];

  // Imported here rather than at the top: plan.service.js calls back into this
  // module (it raises invoices when a plan is published), and a static pair of
  // imports would be a cycle.
  const { listFeePlans } = await import('./plan.service.js');

  const [invoices, payments, plans, summary] = await Promise.all([
    listInvoices(actor, scope, { academicYearId: selected.id }),
    listPayments(actor, scope, { academicYearId: selected.id }),
    listFeePlans(actor, scope, { academicYearId: selected.id }),
    getSummary(actor, scope, { academicYearId: selected.id }),
  ]);

  return {
    years,
    academicYearId: selected.id,
    academicYearName: selected.name,
    summary,
    plans,
    invoices: Array.isArray(invoices) ? invoices : invoices.items,
    payments: Array.isArray(payments) ? payments : payments.items,
  };
}

/**
 * Single invoice with its line items and ordered payment history — backs
 * both the student-facing payment-status timeline and the invoice PDF.
 */
export async function getInvoiceDetail(actor, scope, invoiceId) {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw new AppError('Invoice not found', 404);
  if (scope === 'OWN') await assertInvoiceOwnership(actor, invoice);

  await invoice.populate({
    path: 'enrollmentId',
    populate: [
      { path: 'studentId' },
      { path: 'sectionId', populate: { path: 'gradeId' } },
    ],
  });

  // Same rule as listPayments: a family's timeline shows settled money only,
  // never a record still waiting on an admin.
  const paymentFilter = { invoiceId };
  if (scope === 'OWN') paymentFilter.recordStatus = { $nin: ['PENDING_ADMIN_APPROVAL', 'REJECTED'] };

  const [lines, payments] = await Promise.all([
    InvoiceLine.find({ invoiceId }).sort({ createdAt: 1 }).lean(),
    Payment.find(paymentFilter)
      .populate({ path: 'createdByProfileId', select: 'displayName' })
      .populate({ path: 'approvedByProfileId', select: 'displayName' })
      .populate({ path: 'rejectedByProfileId', select: 'displayName' })
      .sort({ createdAt: 1 })
      .lean(),
  ]);

  const obj = invoice.toObject();
  obj.id = obj._id.toString();
  const enrollment = obj.enrollmentId;
  const student = enrollment?.studentId;
  const section = enrollment?.sectionId;
  const grade = section?.gradeId;
  if (student) {
    obj.studentName = `${student.firstName} ${student.lastName || ''}`.trim();
    obj.studentId = student._id.toString();
  }
  if (section) {
    obj.class = grade ? `${grade.name} - ${section.name}` : section.name;
    obj.sectionId = section._id.toString();
  }
  obj.enrollmentId = enrollment?._id?.toString();

  return {
    ...obj,
    lines: lines.map((l) => ({
      id: l._id.toString(),
      description: l.description,
      amountPaise: l.amountPaise,
      concessionPaise: l.concessionPaise ?? 0,
    })),
    payments: payments.map((p) => ({
      id: p._id.toString(),
      receiptNo: p.receiptNo ?? '—',
      invoiceNo: obj.invoiceNo,
      studentName: obj.studentName ?? '—',
      class: obj.class ?? '—',
      amountPaise: p.amountPaise,
      mode: p.mode,
      status: p.status ?? 'SUCCESS',
      paidOn: p.paidOn ?? p.createdAt,
      // How the money actually arrived — cheque no., transaction id, UTR —
      // beside the row that claims it did.
      instrument: p.instrument ?? null,
      createdAt: p.createdAt,
      ...verificationOf(p),
    })),
  };
}

/** Single payment receipt, ownership-checked — backs the receipt PDF download. */
export async function getPaymentReceipt(actor, scope, paymentId) {
  const payment = await Payment.findById(paymentId)
    .populate({
      path: 'invoiceId',
      select: 'invoiceNo enrollmentId',
      populate: {
        path: 'enrollmentId',
        select: 'studentId sectionId',
        populate: [
          { path: 'studentId', select: 'firstName lastName' },
          { path: 'sectionId', select: 'name', populate: { path: 'gradeId', select: 'name' } },
        ],
      },
    })
    .lean();
  if (!payment) throw new AppError('Payment not found', 404);

  if (scope === 'OWN') {
    const ids = await resolveEnrollmentIdsForOwn(actor);
    const enrollmentId = payment.invoiceId?.enrollmentId?._id?.toString();
    if (!enrollmentId || !ids.includes(enrollmentId)) {
      throw new AppError('This payment does not belong to your account', 403);
    }
  }

  const inv = payment.invoiceId;
  const enrollment = inv?.enrollmentId;
  const student = enrollment?.studentId;
  const section = enrollment?.sectionId;
  return {
    receiptNo: payment.receiptNo ?? '—',
    invoiceNo: inv?.invoiceNo ?? '—',
    studentName: student ? `${student.firstName} ${student.lastName ?? ''}`.trim() : '—',
    class: section ? [section.gradeId?.name, section.name].filter(Boolean).join(' - ') : '—',
    amountPaise: payment.amountPaise,
    mode: payment.mode,
    status: payment.status ?? 'SUCCESS',
    createdAt: payment.createdAt,
  };
}

export async function refundPayment(paymentId) {
  // Atomically flip status only if it isn't already REFUNDED — the DB-level
  // condition ensures two concurrent refund requests can't both "win" the
  // check and double-deduct the invoice below.
  const payment = await Payment.findOneAndUpdate(
    { _id: paymentId, status: { $ne: 'REFUNDED' } },
    { $set: { status: 'REFUNDED' } },
    { new: true }
  );
  if (!payment) {
    const exists = await Payment.exists({ _id: paymentId });
    throw new AppError(exists ? 'Payment already refunded' : 'Payment not found', exists ? 409 : 404);
  }

  // $inc is atomic, so concurrent refunds of different payments on the same
  // invoice can't clobber each other's paidPaise update either.
  const invoice = await Invoice.findByIdAndUpdate(
    payment.invoiceId,
    { $inc: { paidPaise: -payment.amountPaise } },
    { new: true }
  );
  invoice.paidPaise = Math.max(0, invoice.paidPaise);
  invoice.status = invoice.paidPaise === 0 ? 'PENDING' : 'PARTIAL';
  await invoice.save();

  return { payment, invoice };
}

export async function getSummary(actor, scope, query = {}) {
  // Aggregation pipelines do not auto-cast strings → ObjectIds, so cast here.
  const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));
  const filter = {};
  if (scope === 'OWN') {
    const ids = await resolveEnrollmentIdsForOwn(actor);
    filter.enrollmentId = { $in: ids.map(toObjectId) };
  }
  if (query.enrollmentId) filter.enrollmentId = toObjectId(query.enrollmentId);
  // A year-scoped summary has to agree with the year-scoped invoice list under
  // it, so it narrows through the same enrollment→year relation.
  if (query.academicYearId) {
    const enrs = await Enrollment.find({ academicYearId: query.academicYearId }).select('_id').lean();
    const yearIds = enrs.map((e) => e._id);
    filter.enrollmentId = filter.enrollmentId
      ? { $in: yearIds.filter((id) => {
        const allowed = filter.enrollmentId.$in ?? [filter.enrollmentId];
        return allowed.some((a) => String(a) === String(id));
      }) }
      : { $in: yearIds };
  }

  // Aggregate in the DB instead of loading every invoice into memory.
  const now = new Date();
  const [agg] = await Invoice.aggregate([
    { $match: Object.keys(filter).length ? filter : {} },
    {
      $group: {
        _id: null,
        totalPaise: { $sum: '$totalPaise' },
        paidPaise: { $sum: '$paidPaise' },
        invoiceCount: { $sum: 1 },
        unpaidCount: { $sum: { $cond: [{ $ne: ['$status', 'PAID'] }, 1, 0] } },
        overduePaise: {
          $sum: {
            $cond: [
              { $and: [{ $lt: ['$dueOn', now] }, { $not: [{ $in: ['$status', ['PAID', 'CANCELLED']] }] }] },
              { $subtract: ['$totalPaise', '$paidPaise'] },
              0,
            ],
          },
        },
        overdueCount: {
          $sum: {
            $cond: [
              { $and: [{ $lt: ['$dueOn', now] }, { $not: [{ $in: ['$status', ['PAID', 'CANCELLED']] }] }] },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  const totalPaise = agg?.totalPaise ?? 0;
  const paidPaise = agg?.paidPaise ?? 0;
  const outstandingPaise = totalPaise - paidPaise;
  const unpaidCount = agg?.unpaidCount ?? 0;
  const overduePaise = agg?.overduePaise ?? 0;
  const overdueCount = agg?.overdueCount ?? 0;
  const invoices = { length: agg?.invoiceCount ?? 0 };

  const collectionPct = totalPaise > 0 ? Math.round((paidPaise / totalPaise) * 100) : 0;

  // One name per concept, matching the `FeeSummary` type the portals already
  // declare in frontend/src/lib/types.ts.
  //
  // This used to return twenty-five keys — nine spellings of "outstanding"
  // alone — and still not the four the dashboards actually read, so every stat
  // card rendered a dash. The aliases were not a compatibility layer; they were
  // guesses, and having many of them is what let the real names stay missing
  // without anyone noticing. Adding a name here is now a contract change:
  // update types.ts and the consumers with it.
  return {
    totalBilledPaise: totalPaise,
    totalCollectedPaise: paidPaise,
    pendingPaise: outstandingPaise,
    pendingCount: unpaidCount,
    collectionPct,
    overduePaise,
    overdueCount,
    invoiceCount: invoices.length,
    // Whether the online method is actually configured, so a payer is not
    // offered a route that can only fail. Derived from the same
    // PAYMENT_PROVIDER setting payOnline() enforces with — read, never a second
    // copy of the configuration — and it reports availability only, never the
    // gateway's identity or keys.
    onlinePaymentEnabled: isOnlinePaymentEnabled(),
  };
}

/* ── Fee configuration, as an actor ───────────────────────── */

/**
 * The fee heads and structures a school bills from, created safely.
 *
 * These replace raw `Model.create(data)` pass-throughs that took whatever
 * object they were handed, with no actor, no scope, no check that the ids in
 * it belonged to this school, no validation and no audit entry. Authorization
 * for those existed only on the REST route, which is why they could not be
 * exposed to any other caller; they have been removed rather than left as a
 * way around what follows.
 *
 * These are the same writes with the boundary moved into the service, the way
 * document.service.createForActor() does it — so the route, the assistant and
 * any future caller all meet the same rules:
 *
 *   scope       fees.structure.manage is a school-wide configuration
 *               permission. A caller without ALL scope is refused rather than
 *               quietly given a narrower write, because there is no narrower
 *               version of "what this school charges".
 *   fields      an explicit allow-list, so nothing else in the payload reaches
 *               the model — tenantId included, which comes from the request's
 *               own tenant state and never from input.
 *   references  every id is confirmed to resolve INSIDE this school before it
 *               is stored. The tenant plugin scopes the lookups, so an id from
 *               another school simply does not resolve and is refused.
 *   audit       recorded with the acting profile, like every other write.
 */

const FEE_HEAD_FIELDS = ['name', 'category'];
const FEE_STRUCTURE_FIELDS = ['feeHeadId', 'academicYearId', 'gradeId', 'name', 'amountPaise', 'dueOn'];

/** Keeps only the declared fields, so an unknown key cannot reach the model. */
const pick = (data, allowed) => Object.fromEntries(
  Object.entries(data ?? {}).filter(([k]) => allowed.includes(k)),
);

function assertStructureScope(scope) {
  if (scope !== 'ALL') {
    throw new AppError(
      'Fee configuration is school-wide, so it cannot be changed from your own records.',
      403, [], 'FORBIDDEN_SCOPE',
    );
  }
}

const trimmed = (value, field, max) => {
  const text = String(value ?? '').trim();
  if (!text) throw new AppError(`${field} is required`, 400);
  if (text.length > max) throw new AppError(`${field} must be ${max} characters or fewer`, 400);
  return text;
};

/** Creates a fee head — the thing a charge is FOR, e.g. "Tuition". */
export async function createFeeHeadForActor(actor, scope, data = {}) {
  assertStructureScope(scope);
  const input = pick(data, FEE_HEAD_FIELDS);

  const name = trimmed(input.name, 'name', 120);
  const category = input.category === undefined ? undefined : trimmed(input.category, 'category', 40);

  try {
    const head = await FeeHead.create({ name, ...(category !== undefined && { category }) });
    await recordAudit({
      actor,
      action: 'fee_head.create',
      entityType: 'FeeHead',
      entityId: head._id,
      after: { name: head.name, category: head.category },
    });
    return head;
  } catch (err) {
    // (tenantId, name) is unique per school, so a repeat is a conflict rather
    // than a 500.
    if (err?.code === 11000) {
      throw new AppError(`A fee head named "${name}" already exists`, 409, [], 'FEE_HEAD_EXISTS');
    }
    throw err;
  }
}

/**
 * Creates a fee structure — what a fee head costs, for a year and optionally
 * one grade. A structure with no grade applies to every grade.
 */
export async function createFeeStructureForActor(actor, scope, data = {}) {
  const resolved = await resolveFeeStructureInput(scope, data);

  const structure = await FeeStructure.create(resolved.write);

  await recordAudit({
    actor,
    action: 'fee_structure.create',
    entityType: 'FeeStructure',
    entityId: structure._id,
    after: {
      name: structure.name,
      feeHead: resolved.feeHeadName,
      academicYear: resolved.academicYearName,
      gradeId: structure.gradeId ? String(structure.gradeId) : null,
      amountPaise: structure.amountPaise,
      dueOn: structure.dueOn,
    },
  });

  return structure;
}

/**
 * Validates a fee structure and resolves its references, without writing.
 *
 * Separate so that a caller which asks a human to confirm first can refuse an
 * impossible structure BEFORE the prompt: a year or grade from another school,
 * a fractional amount, a date that is not one. Otherwise somebody would be
 * asked to approve a charge that then fails, which is the flaw the document
 * deletion tool avoids the same way.
 */
export async function resolveFeeStructureInput(scope, data = {}) {
  assertStructureScope(scope);
  const input = pick(data, FEE_STRUCTURE_FIELDS);

  const name = trimmed(input.name, 'name', 120);

  const amountPaise = Number(input.amountPaise);
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new AppError('amountPaise must be a whole number of paise above zero', 400);
  }

  const dueOn = new Date(input.dueOn);
  if (!input.dueOn || Number.isNaN(dueOn.getTime())) {
    throw new AppError('dueOn must be a valid date', 400);
  }

  // Each reference is resolved under this request's tenant state, so an id
  // belonging to another school does not resolve and is refused here rather
  // than being stored and billed from later.
  const head = await FeeHead.findById(input.feeHeadId).select('_id name');
  if (!head) throw new AppError('That fee head does not belong to this school', 403, [], 'FEE_HEAD_NOT_IN_SCHOOL');

  const year = await AcademicYear.findById(input.academicYearId).select('_id name');
  if (!year) throw new AppError('That academic year does not belong to this school', 403, [], 'YEAR_NOT_IN_SCHOOL');

  let gradeId = null;
  if (input.gradeId) {
    const grade = await Grade.findById(input.gradeId).select('_id name');
    if (!grade) throw new AppError('That grade does not belong to this school', 403, [], 'GRADE_NOT_IN_SCHOOL');
    gradeId = grade._id;
  }

  return {
    write: { feeHeadId: head._id, academicYearId: year._id, gradeId, name, amountPaise, dueOn },
    feeHeadName: head.name,
    academicYearName: year.name,
  };
}

/** Refuses a fee head name this school already uses, without writing. */
export async function assertFeeHeadNameFree(scope, name) {
  assertStructureScope(scope);
  const wanted = trimmed(name, 'name', 120);
  const existing = await FeeHead.findOne({ name: wanted }).select('_id');
  if (existing) {
    throw new AppError(`A fee head named "${wanted}" already exists`, 409, [], 'FEE_HEAD_EXISTS');
  }
  return wanted;
}
