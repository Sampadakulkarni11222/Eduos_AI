import { Invoice, InvoiceLine, Payment } from '../../models/fee.model.js';
import { Expense } from '../../models/expense.model.js';
import { RevenueLeakageFinding } from '../../models/leakage.model.js';
import { QuarterlyFinancialReport } from '../../models/financialReport.model.js';
import '../../models/academics.model.js';
import '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { sendOtpEmail } from '../../providers/notification.provider.js';

export function getQuarterDates(year, quarter) {
  const y = parseInt(year, 10);
  switch (quarter) {
    case 'Q1': // Apr 1 - Jun 30 (standard fiscal quarter)
      return { start: new Date(Date.UTC(y, 3, 1)), end: new Date(Date.UTC(y, 5, 30, 23, 59, 59, 999)) };
    case 'Q2': // Jul 1 - Sep 30
      return { start: new Date(Date.UTC(y, 6, 1)), end: new Date(Date.UTC(y, 8, 30, 23, 59, 59, 999)) };
    case 'Q3': // Oct 1 - Dec 31
      return { start: new Date(Date.UTC(y, 9, 1)), end: new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999)) };
    case 'Q4': // Jan 1 - Mar 31
      return { start: new Date(Date.UTC(y, 0, 1)), end: new Date(Date.UTC(y, 2, 31, 23, 59, 59, 999)) };
    default:
      throw new AppError('Quarter must be one of Q1, Q2, Q3, Q4', 400);
  }
}

export async function generateQuarterlyReport(actor, { year, quarter, executiveSummary = null }) {
  const { start, end } = getQuarterDates(year, quarter);

  // 1. Opening receivables: Invoices issued before 'start' that were still unpaid as of 'start'
  const priorInvoices = await Invoice.find({
    createdAt: { $lt: start },
    status: { $ne: 'CANCELLED' },
  }).select('_id totalPaise').lean();

  const priorPayments = await Payment.aggregate([
    { $match: { createdAt: { $lt: start }, status: 'SUCCESS', recordStatus: 'PUBLISHED' } },
    { $group: { _id: null, total: { $sum: '$amountPaise' } } },
  ]);
  const priorBilled = priorInvoices.reduce((acc, i) => acc + i.totalPaise, 0);
  const priorPaid = priorPayments[0]?.total || 0;
  const openingReceivablesPaise = Math.max(0, priorBilled - priorPaid);

  // 2. Quarter billing
  const quarterInvoices = await Invoice.find({
    createdAt: { $gte: start, $lte: end },
    status: { $ne: 'CANCELLED' },
  }).populate({
    path: 'enrollmentId',
    populate: { path: 'sectionId', populate: { path: 'gradeId' } },
  }).lean();

  const totalBilledPaise = quarterInvoices.reduce((acc, i) => acc + i.totalPaise, 0);

  // 3. Quarter collections
  const quarterPaymentsAgg = await Payment.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
        status: 'SUCCESS',
        recordStatus: 'PUBLISHED',
      },
    },
    { $group: { _id: null, total: { $sum: '$amountPaise' } } },
  ]);
  const totalCollectedPaise = quarterPaymentsAgg[0]?.total || 0;

  // 4. Concessions & Waivers in quarter
  const quarterInvoiceIds = quarterInvoices.map((i) => i._id);
  const concessionsAgg = await InvoiceLine.aggregate([
    { $match: { invoiceId: { $in: quarterInvoiceIds } } },
    { $group: { _id: null, totalConcessions: { $sum: '$concessionPaise' } } },
  ]);
  const totalConcessionsPaise = concessionsAgg[0]?.totalConcessions || 0;

  // 5. Refunds issued in quarter
  const refundsAgg = await Payment.aggregate([
    { $match: { createdAt: { $gte: start, $lte: end }, status: 'REFUNDED' } },
    { $group: { _id: null, totalRefunds: { $sum: '$amountPaise' } } },
  ]);
  const totalRefundsPaise = refundsAgg[0]?.totalRefunds || 0;

  // 6. Expenses in quarter
  const expensesAgg = await Expense.aggregate([
    { $match: { expenseDate: { $gte: start, $lte: end }, status: { $ne: 'CANCELLED' } } },
    { $group: { _id: null, totalExpenses: { $sum: '$amountPaise' } } },
  ]);
  const totalExpensesPaise = expensesAgg[0]?.totalExpenses || 0;

  // 7. Unreconciled payments
  const unreconciledAgg = await Payment.aggregate([
    { $match: { createdAt: { $gte: start, $lte: end }, recordStatus: 'PENDING_ADMIN_APPROVAL' } },
    { $group: { _id: null, total: { $sum: '$amountPaise' } } },
  ]);
  const unreconciledPaymentsPaise = unreconciledAgg[0]?.total || 0;

  // 8. Leakage metrics
  const leakageAgg = await RevenueLeakageFinding.aggregate([
    { $match: { detectedAt: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: null,
        potential: { $sum: { $cond: [{ $eq: ['$category', 'POTENTIAL'] }, '$estimatedAmountPaise', 0] } },
        confirmed: { $sum: { $cond: [{ $eq: ['$category', 'CONFIRMED'] }, '$estimatedAmountPaise', 0] } },
        recovered: { $sum: '$recoveredAmountPaise' },
      },
    },
  ]);
  const potentialLeakagePaise = leakageAgg[0]?.potential || 0;
  const confirmedLeakagePaise = leakageAgg[0]?.confirmed || 0;
  const recoveredLeakagePaise = leakageAgg[0]?.recovered || 0;

  // 9. Closing receivables & collection rate
  const closingReceivablesPaise = Math.max(0, openingReceivablesPaise + totalBilledPaise - totalCollectedPaise - totalConcessionsPaise);
  const collectionRatePct = totalBilledPaise > 0 ? Math.round((totalCollectedPaise / totalBilledPaise) * 100) : 0;
  const netOperatingMarginPaise = totalCollectedPaise - totalExpensesPaise;

  // 10. Ageing buckets for current outstanding invoices as of end of quarter
  const now = end;
  const dayMs = 24 * 60 * 60 * 1000;
  const outstandingInvoices = await Invoice.find({
    status: { $in: ['PENDING', 'PARTIAL', 'OVERDUE'] },
    createdAt: { $lte: end },
  }).lean();

  let currentPaise = 0;
  let thirtyToSixtyPaise = 0;
  let sixtyToNinetyPaise = 0;
  let aboveNinetyPaise = 0;

  for (const inv of outstandingInvoices) {
    const balance = Math.max(0, inv.totalPaise - inv.paidPaise);
    if (balance <= 0) continue;
    const diffDays = Math.floor((now - new Date(inv.dueOn)) / dayMs);
    if (diffDays <= 30) {
      currentPaise += balance;
    } else if (diffDays <= 60) {
      thirtyToSixtyPaise += balance;
    } else if (diffDays <= 90) {
      sixtyToNinetyPaise += balance;
    } else {
      aboveNinetyPaise += balance;
    }
  }

  // 11. Segment performance (group by Grade/Class)
  const segmentMap = new Map();
  for (const inv of quarterInvoices) {
    const sec = inv.enrollmentId?.sectionId;
    const grade = sec?.gradeId;
    const segName = grade ? `${grade.name} - ${sec.name}` : 'General';
    if (!segmentMap.has(segName)) {
      segmentMap.set(segName, { segmentName: segName, billedPaise: 0, collectedPaise: 0, pendingPaise: 0 });
    }
    const entry = segmentMap.get(segName);
    entry.billedPaise += inv.totalPaise;
    entry.collectedPaise += inv.paidPaise;
    entry.pendingPaise += Math.max(0, inv.totalPaise - inv.paidPaise);
  }
  const segmentPerformance = Array.from(segmentMap.values());

  const summary = executiveSummary || `Quarterly financial report for ${quarter} ${year}. Total billed: Rs. ${(totalBilledPaise / 100).toLocaleString('en-IN')}, Total collected: Rs. ${(totalCollectedPaise / 100).toLocaleString('en-IN')} (${collectionRatePct}% collection rate). Net Operating Margin: Rs. ${(netOperatingMarginPaise / 100).toLocaleString('en-IN')}.`;

  const report = await QuarterlyFinancialReport.findOneAndUpdate(
    { year: parseInt(year, 10), quarter },
    {
      $set: {
        periodStart: start,
        periodEnd: end,
        metrics: {
          openingReceivablesPaise,
          closingReceivablesPaise,
          totalBilledPaise,
          totalCollectedPaise,
          collectionRatePct,
          totalExpensesPaise,
          netOperatingMarginPaise,
          totalConcessionsPaise,
          totalRefundsPaise,
          unreconciledPaymentsPaise,
          potentialLeakagePaise,
          confirmedLeakagePaise,
          recoveredLeakagePaise,
        },
        ageingBuckets: {
          currentPaise,
          thirtyToSixtyPaise,
          sixtyToNinetyPaise,
          aboveNinetyPaise,
        },
        segmentPerformance,
        executiveSummary: summary,
        generatedByProfileId: actor?.profileId,
      },
    },
    { new: true, upsert: true }
  );

  await recordAudit({
    actor,
    action: 'financialReport.generate',
    entityType: 'QuarterlyFinancialReport',
    entityId: report._id,
    after: { year, quarter, collectionRatePct, netOperatingMarginPaise },
  });

  return report;
}

export async function listQuarterlyReports() {
  return QuarterlyFinancialReport.find()
    .sort({ year: -1, quarter: -1 })
    .populate('generatedByProfileId', 'displayName')
    .lean();
}

export async function getQuarterlyReportById(id) {
  const report = await QuarterlyFinancialReport.findById(id)
    .populate('generatedByProfileId', 'displayName')
    .lean();
  if (!report) throw new AppError('Quarterly report not found', 404);
  return report;
}

export async function distributeReport(actor, reportId, { recipientEmails }) {
  if (!Array.isArray(recipientEmails) || !recipientEmails.length) {
    throw new AppError('recipientEmails list is required', 400);
  }
  const report = await QuarterlyFinancialReport.findById(reportId);
  if (!report) throw new AppError('Quarterly report not found', 404);

  const deliveryOutcomes = [];
  for (const email of recipientEmails) {
    const trimmed = String(email).trim().toLowerCase();
    if (!trimmed.includes('@')) continue;
    let status = 'DELIVERED';
    try {
      await sendOtpEmail(trimmed, `Quarterly Financial Report for ${report.quarter} ${report.year} has been generated. Summary: ${report.executiveSummary}`);
    } catch {
      status = 'FAILED';
    }
    report.distributionHistory.push({ recipientEmail: trimmed, deliveryStatus: status });
    deliveryOutcomes.push({ email: trimmed, status });
  }

  report.status = 'DISTRIBUTED';
  await report.save();

  await recordAudit({
    actor,
    action: 'financialReport.distribute',
    entityType: 'QuarterlyFinancialReport',
    entityId: report._id,
    after: { recipientsCount: deliveryOutcomes.length },
  });

  return { distributedCount: deliveryOutcomes.length, outcomes: deliveryOutcomes };
}
