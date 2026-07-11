import crypto from 'crypto';
import mongoose from 'mongoose';
import { FeeHead, FeeStructure, Invoice, InvoiceLine, Payment } from '../../models/fee.model.js';
import { Enrollment } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';
import { chargeOnline, isOnlinePaymentEnabled, paymentMode } from '../../providers/payment.provider.js';

export const createFeeHead = (data) => FeeHead.create(data);
export const createFeeStructure = (data) => FeeStructure.create(data);

async function resolveEnrollmentIdsForOwn(actor) {
  const studentIds =
    actor.roleKey === 'PARENT'
      ? await getGuardianStudentIds(actor.profileId)
      : [await getOwnStudentId(actor.profileId)].filter(Boolean);
  const enrollments = await Enrollment.find({ studentId: { $in: studentIds } }).select('_id');
  return enrollments.map((e) => e._id.toString());
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
        obj.studentId = student._id;
      }
      if (section) {
        obj.class = grade ? `${grade.name} - ${section.name}` : section.name;
        obj.sectionId = section._id;
      }
      obj.enrollmentId = obj.enrollmentId._id;
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
  const [agg] = await Invoice.aggregate([
    { $match: Object.keys(filter).length ? filter : {} },
    {
      $group: {
        _id: null,
        totalPaise: { $sum: '$totalPaise' },
        paidPaise: { $sum: '$paidPaise' },
        invoiceCount: { $sum: 1 },
        unpaidCount: { $sum: { $cond: [{ $ne: ['$status', 'PAID'] }, 1, 0] } },
      },
    },
  ]);

  const totalPaise = agg?.totalPaise ?? 0;
  const paidPaise = agg?.paidPaise ?? 0;
  const outstandingPaise = totalPaise - paidPaise;
  const unpaidCount = agg?.unpaidCount ?? 0;
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
    unpaidInvoices: unpaidCount
  };
}
