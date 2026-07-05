import { FeeHead, FeeStructure, Invoice, InvoiceLine, Payment } from '../../models/fee.model.js';
import { Enrollment } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';

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

export async function recordPayment({ invoiceId, amountPaise, mode, gatewayRef, receiptNo }) {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw new AppError('Invoice not found', 404);

  const payment = await Payment.create({ invoiceId, amountPaise, mode, gatewayRef, receiptNo });

  invoice.paidPaise += amountPaise;
  invoice.status = invoice.paidPaise >= invoice.totalPaise ? 'PAID' : 'PARTIAL';
  await invoice.save();

  return { payment, invoice };
}

export async function refundPayment(paymentId) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new AppError('Payment not found', 404);
  if (payment.status === 'REFUNDED') throw new AppError('Payment already refunded', 409);

  const invoice = await Invoice.findById(payment.invoiceId);
  payment.status = 'REFUNDED';
  await payment.save();

  invoice.paidPaise = Math.max(0, invoice.paidPaise - payment.amountPaise);
  invoice.status = invoice.paidPaise === 0 ? 'PENDING' : 'PARTIAL';
  await invoice.save();

  return { payment, invoice };
}

export async function getSummary(actor, scope, query = {}) {
  const filter = {};
  if (scope === 'OWN') {
    const ids = await resolveEnrollmentIdsForOwn(actor);
    filter.enrollmentId = { $in: ids };
  }
  if (query.enrollmentId) filter.enrollmentId = query.enrollmentId;

  const invoices = await Invoice.find(filter);

  let totalPaise = 0;
  let paidPaise = 0;
  let outstandingPaise = 0;
  let unpaidCount = 0;

  for (const inv of invoices) {
    totalPaise += inv.totalPaise;
    paidPaise += inv.paidPaise;
    outstandingPaise += (inv.totalPaise - inv.paidPaise);
    if (inv.status !== 'PAID') {
      unpaidCount += 1;
    }
  }

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
