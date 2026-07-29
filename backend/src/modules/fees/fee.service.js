import crypto from 'crypto';
import mongoose from 'mongoose';
import { FeeHead, FeeStructure, Invoice, InvoiceLine, Payment } from '../../models/fee.model.js';
import { Student, Enrollment } from '../../models/student.model.js';
import { Section } from '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import { getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';
import { chargeOnline, createPaymentLink, isOnlinePaymentEnabled, paymentMode } from '../../providers/payment.provider.js';

export const createFeeHead = (data) => FeeHead.create(data);
export const createFeeStructure = (data) => FeeStructure.create(data);

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

export async function listInvoices(actor, scope, query = {}) {
  const filter = {};
  if (query.enrollmentId) filter.enrollmentId = query.enrollmentId;
  if (query.status) filter.status = query.status;

  if (scope === 'OWN') {
    const ids = await resolveEnrollmentIdsForOwn(actor);
    filter.enrollmentId = query.enrollmentId ?? { $in: ids };
  }

  const invoices = await Invoice.find(filter)
    .populate({
      path: 'enrollmentId',
      populate: [
        { path: 'studentId' },
        { path: 'sectionId', populate: { path: 'gradeId' } }
      ]
    })
    .sort({ dueOn: 1 });

  return invoices.map(inv => {
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
      obj.enrollmentId = obj.enrollmentId._id.toString();
    }
    return obj;
  });
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
      results.errors.push({ row: rowNo, error: 'admissionNo, description, a positive amount, and dueOn are required' });
      continue;
    }

    const studentId = studentIdByAdmissionNo.get(admissionNo.toLowerCase());
    if (!studentId) {
      results.failed++;
      results.errors.push({ row: rowNo, error: `No student found with admissionNo "${admissionNo}"` });
      continue;
    }

    const enrollmentId = enrollmentIdByStudent.get(studentId.toString());
    if (!enrollmentId) {
      results.failed++;
      results.errors.push({ row: rowNo, error: `Student "${admissionNo}" has no active enrollment` });
      continue;
    }

    const parsedDueOn = new Date(dueOn);
    if (isNaN(parsedDueOn.getTime())) {
      results.failed++;
      results.errors.push({ row: rowNo, error: `Invalid dueOn date "${dueOn}"` });
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
      results.errors.push({ row: rowNo, error: err.code === 11000 ? `Invoice number "${invoiceNo}" already exists` : err.message });
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

export async function recordPayment(actor, scope, { invoiceId, amountPaise, mode, gatewayRef, receiptNo }) {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw new AppError('Invoice not found', 404);

  // Parents/students (OWN scope) cannot use the manual-ledger path — they can
  // only pay online via payOnline(), never "mark" an invoice as paid.
  if (scope === 'OWN') {
    throw new AppError('Manual payment recording requires staff access. Use online payment instead.', 403);
  }

  const amount = Number(amountPaise);
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError('amountPaise must be a positive number', 400);

  const payment = await Payment.create({
    invoiceId,
    amountPaise: amount,
    mode,
    gatewayRef,
    receiptNo: receiptNo ?? `RCPT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
  });

  invoice.paidPaise += amount;
  invoice.status = invoice.paidPaise >= invoice.totalPaise ? 'PAID' : 'PARTIAL';
  await invoice.save();

  return { payment, invoice, receiptNo: payment.receiptNo, status: invoice.status, paidPaise: invoice.paidPaise };
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

/** List payment receipts (scoped: parents/students see only their own). */
export async function listPayments(actor, scope, { invoiceId } = {}) {
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
  }

  const payments = await Payment.find(filter)
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
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  return payments.map((p) => {
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
      createdAt: p.createdAt,
    };
  });
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

  const [lines, payments] = await Promise.all([
    InvoiceLine.find({ invoiceId }).sort({ createdAt: 1 }).lean(),
    Payment.find({ invoiceId }).sort({ createdAt: 1 }).lean(),
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
      createdAt: p.createdAt,
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

  const total = totalPaise / 100;
  const paid = paidPaise / 100;
  const outstanding = outstandingPaise / 100;
  const collectionRate = total > 0 ? Math.round((paid / total) * 100) : 0;

  return {
    totalPaise,
    paidPaise,
    outstandingPaise,
    invoiceCount: invoices.length,
    total,
    paid,
    outstanding,
    totalAmount: total,
    paidAmount: paid,
    outstandingAmount: outstanding,
    billedTarget: total,
    billedTargetPaise: totalPaise,
    realizedRevenue: paid,
    realizedRevenuePaise: paidPaise,
    outstandingBalance: outstanding,
    outstandingBalances: outstanding,
    outstandingBalancePaise: outstandingPaise,
    collectionRate,
    collectionRatePercentage: collectionRate,
    unpaidCount,
    pendingCount: unpaidCount,
    outstandingCount: unpaidCount,
    unpaidInvoices: unpaidCount,
    overduePaise,
    overdueCount,
  };
}
