import { Invoice } from '../../models/fee.model.js';
import { StudentGuardian } from '../../models/student.model.js';
import { Notification } from '../../models/notification.model.js';
import { ReminderRule, PaymentReminderLog } from '../../models/reminder.model.js';
import '../../models/account.model.js';
import '../../models/profile.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { sendOtpSms, sendOtpEmail } from '../../providers/notification.provider.js';

function moneyRupees(paise) {
  return 'Rs. ' + ((paise || 0) / 100).toLocaleString('en-IN');
}

export async function listReminderRules() {
  return ReminderRule.find().sort({ daysOffset: 1 }).lean();
}

export async function createReminderRule(actor, data) {
  const rule = await ReminderRule.create(data);
  await recordAudit({
    actor,
    action: 'reminder.rule.create',
    entityType: 'ReminderRule',
    entityId: rule._id,
    after: rule.toObject(),
  });
  return rule;
}

export async function listReminderLogs({ invoiceId, page = 1, pageSize = 25 } = {}) {
  const filter = {};
  if (invoiceId) filter.invoiceId = invoiceId;
  const p = Math.max(1, parseInt(page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 25));
  const total = await PaymentReminderLog.countDocuments(filter);
  const items = await PaymentReminderLog.find(filter)
    .populate('invoiceId', 'invoiceNo totalPaise paidPaise dueOn status')
    .sort({ createdAt: -1 })
    .skip((p - 1) * limit)
    .limit(limit)
    .lean();
  return { items, total, page: p, pageSize: limit, totalPages: Math.ceil(total / limit) || 1 };
}

/**
 * Sends a single reminder for an invoice with deduplication
 */
export async function sendInvoiceReminder(actor, { invoiceId, channel = 'IN_APP', stage = 'MANUAL', customMessage = null }) {
  const invoice = await Invoice.findById(invoiceId).populate({
    path: 'enrollmentId',
    populate: { path: 'studentId' },
  });
  if (!invoice) throw new AppError('Invoice not found', 404);
  if (invoice.status === 'PAID' || invoice.status === 'CANCELLED') {
    throw new AppError(`Cannot send reminder for an invoice that is ${invoice.status}`, 400);
  }

  const student = invoice.enrollmentId?.studentId;
  if (!student) throw new AppError('No student associated with this invoice', 400);

  // Find recipient: primary guardian profile or student profile
  const guardian = await StudentGuardian.findOne({ studentId: student._id, isPrimary: true })
    .populate({ path: 'guardianProfileId', populate: { path: 'accountId' } })
    .lean();
  const recipientProfile = guardian?.guardianProfileId || null;
  const phone = recipientProfile?.accountId?.phoneE164 || null;
  const email = recipientProfile?.accountId?.email || null;

  const duePaise = invoice.totalPaise - invoice.paidPaise;
  const title = `Fee Payment Reminder: ${invoice.invoiceNo}`;
  const body = customMessage || `A fee payment of ${moneyRupees(duePaise)} for invoice ${invoice.invoiceNo} is due on ${invoice.dueOn.toLocaleDateString('en-IN')}.`;

  // Check deduplication: avoid sending duplicate automated reminder on same calendar day for same stage & channel
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  if (stage !== 'MANUAL') {
    const existing = await PaymentReminderLog.findOne({
      invoiceId,
      stage,
      channel,
      createdAt: { $gte: todayStart },
      status: { $in: ['DELIVERED', 'QUEUED', 'SIMULATED'] },
    });
    if (existing) {
      return { skipped: true, reason: 'Already reminded today for this stage' };
    }
  }

  let deliveryStatus = 'DELIVERED';
  let failureReason = null;

  try {
    if (channel === 'IN_APP' && recipientProfile?._id) {
      await Notification.create({
        recipientProfileId: recipientProfile._id,
        type: 'FEES',
        title,
        body,
        link: `/parent/payments?invoice=${invoice._id}`,
        meta: { invoiceId: invoice._id, invoiceNo: invoice.invoiceNo },
      });
    } else if (channel === 'SMS' && phone) {
      const res = await sendOtpSms(phone, body);
      deliveryStatus = res.delivered ? 'DELIVERED' : 'SIMULATED';
    } else if (channel === 'EMAIL' && email) {
      const res = await sendOtpEmail(email, body);
      deliveryStatus = res.delivered ? 'DELIVERED' : 'SIMULATED';
    } else if (channel === 'WHATSAPP') {
      deliveryStatus = 'SIMULATED';
    }
  } catch (err) {
    deliveryStatus = 'FAILED';
    failureReason = err.message;
  }

  const log = await PaymentReminderLog.create({
    invoiceId: invoice._id,
    recipientProfileId: recipientProfile?._id ?? null,
    recipientPhone: phone,
    recipientEmail: email,
    channel,
    stage,
    status: deliveryStatus,
    title,
    body,
    failureReason,
    triggeredByProfileId: actor?.profileId ?? null,
  });

  await recordAudit({
    actor,
    action: 'reminder.send',
    entityType: 'Invoice',
    entityId: invoice._id,
    after: { logId: log._id, channel, stage, deliveryStatus },
  });

  return log;
}

/**
 * Automated sweep evaluating active invoices against reminder criteria
 */
export async function runAutomatedReminderSweep(actor) {
  const now = new Date();
  const threeDaysFuture = new Date();
  threeDaysFuture.setDate(now.getDate() + 3);

  // Find pending or overdue invoices
  const pendingInvoices = await Invoice.find({
    status: { $in: ['PENDING', 'PARTIAL', 'OVERDUE'] },
  }).limit(200);

  let sentCount = 0;
  let skippedCount = 0;

  for (const inv of pendingInvoices) {
    const isOverdue = inv.dueOn < now;
    const isDueSoon = inv.dueOn >= now && inv.dueOn <= threeDaysFuture;
    const stage = isOverdue ? 'OVERDUE_FIRST' : isDueSoon ? 'BEFORE_DUE' : null;

    if (!stage) continue;

    const result = await sendInvoiceReminder(actor, {
      invoiceId: inv._id,
      channel: 'IN_APP',
      stage,
    });

    if (result?.skipped) {
      skippedCount++;
    } else {
      sentCount++;
    }
  }

  return { scanned: pendingInvoices.length, sentCount, skippedCount };
}
