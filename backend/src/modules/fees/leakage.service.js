import { Invoice, InvoiceLine, Payment } from '../../models/fee.model.js';
import { Enrollment } from '../../models/student.model.js';
import { HostelAllocation } from '../../models/hostel.model.js';
import { BusEnrollment } from '../../models/transport.model.js';
import { RevenueLeakageFinding } from '../../models/leakage.model.js';
import { Budget, Expense } from '../../models/expense.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';

export async function runLeakageDetection(actor) {
  const findings = [];
  const now = new Date();

  // 1. UNBILLED_ACTIVE_STUDENT: Active enrollment with 0 invoices raised
  const activeEnrollments = await Enrollment.find({ status: 'ACTIVE' }).select('_id studentId academicYearId').lean();
  const billedEnrollmentIds = await Invoice.distinct('enrollmentId');
  const billedSet = new Set(billedEnrollmentIds.map(String));

  for (const enr of activeEnrollments) {
    if (!billedSet.has(String(enr._id))) {
      findings.push({
        ruleCode: 'UNBILLED_ACTIVE_STUDENT',
        ruleName: 'Active Student Without Invoices',
        category: 'POTENTIAL',
        severity: 'HIGH',
        estimatedAmountPaise: 5000000, // Estimated Rs. 50,000 standard tuition baseline
        relatedEntityModel: 'Enrollment',
        relatedEntityId: enr._id,
        evidence: { studentId: enr.studentId, academicYearId: enr.academicYearId },
      });
    }
  }

  // 2. UNBILLED_HOSTEL_ALLOCATION: Active hostel allocation without matching hostel fee line
  const activeHostelAllocations = await HostelAllocation.find({ status: 'ACTIVE' }).lean();
  for (const alloc of activeHostelAllocations) {
    const studentEnrollment = await Enrollment.findOne({ studentId: alloc.studentId, status: 'ACTIVE' }).select('_id').lean();
    if (studentEnrollment) {
      const studentInvoices = await Invoice.find({ enrollmentId: studentEnrollment._id }).select('_id').lean();
      const invoiceIds = studentInvoices.map((i) => i._id);
      const hasHostelLine = await InvoiceLine.exists({
        invoiceId: { $in: invoiceIds },
        description: { $regex: /hostel/i },
      });
      if (!hasHostelLine) {
        findings.push({
          ruleCode: 'UNBILLED_HOSTEL_ALLOCATION',
          ruleName: 'Active Hostel Allocation Without Hostel Fee Line',
          category: 'POTENTIAL',
          severity: 'HIGH',
          estimatedAmountPaise: 2500000, // Rs. 25,000
          relatedEntityModel: 'HostelAllocation',
          relatedEntityId: alloc._id,
          evidence: { studentId: alloc.studentId, roomId: alloc.roomId },
        });
      }
    }
  }

  // 3. UNBILLED_BUS_ENROLLMENT: Bus enrollment without matching transport fee line
  const activeBusEnrollments = await BusEnrollment.find().lean();
  for (const bus of activeBusEnrollments) {
    const studentEnrollment = await Enrollment.findOne({ studentId: bus.studentId, status: 'ACTIVE' }).select('_id').lean();
    if (studentEnrollment) {
      const studentInvoices = await Invoice.find({ enrollmentId: studentEnrollment._id }).select('_id').lean();
      const invoiceIds = studentInvoices.map((i) => i._id);
      const hasBusLine = await InvoiceLine.exists({
        invoiceId: { $in: invoiceIds },
        description: { $regex: /transport|bus/i },
      });
      if (!hasBusLine) {
        findings.push({
          ruleCode: 'UNBILLED_BUS_ENROLLMENT',
          ruleName: 'Active Bus Enrollment Without Transport Fee Line',
          category: 'POTENTIAL',
          severity: 'MEDIUM',
          estimatedAmountPaise: 1500000, // Rs. 15,000
          relatedEntityModel: 'BusEnrollment',
          relatedEntityId: bus._id,
          evidence: { studentId: bus.studentId, routeId: bus.routeId },
        });
      }
    }
  }

  // 4. OVERDUE_NO_FOLLOWUP: Invoices overdue > 60 days with 0 collection
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(now.getDate() - 60);
  const severeOverdue = await Invoice.find({
    status: { $in: ['PENDING', 'OVERDUE'] },
    paidPaise: 0,
    dueOn: { $lt: sixtyDaysAgo },
  }).limit(50).lean();

  for (const inv of severeOverdue) {
    findings.push({
      ruleCode: 'OVERDUE_NO_FOLLOWUP',
      ruleName: 'Severely Overdue Uncollected Invoice (>60 Days)',
      category: 'POTENTIAL',
      severity: 'HIGH',
      estimatedAmountPaise: inv.totalPaise,
      relatedEntityModel: 'Invoice',
      relatedEntityId: inv._id,
      evidence: { invoiceNo: inv.invoiceNo, dueOn: inv.dueOn, totalPaise: inv.totalPaise },
    });
  }

  // 5. UNRECONCILED_PAYMENT: Non-gateway payment pending admin approval > 14 days
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(now.getDate() - 14);
  const stalePendingPayments = await Payment.find({
    recordStatus: 'PENDING_ADMIN_APPROVAL',
    createdAt: { $lt: fourteenDaysAgo },
  }).limit(50).lean();

  for (const p of stalePendingPayments) {
    findings.push({
      ruleCode: 'UNRECONCILED_PAYMENT',
      ruleName: 'Unreconciled / Unapproved Payment > 14 Days',
      category: 'POTENTIAL',
      severity: 'MEDIUM',
      estimatedAmountPaise: p.amountPaise,
      relatedEntityModel: 'Payment',
      relatedEntityId: p._id,
      evidence: { receiptNo: p.receiptNo, amountPaise: p.amountPaise, mode: p.mode, createdAt: p.createdAt },
    });
  }

  // 6. HIGH_CONCESSION_ANOMALY: Concession > 50% of line item
  const highConcessionLines = await InvoiceLine.find({
    $expr: { $gt: ['$concessionPaise', { $multiply: ['$amountPaise', 0.5] }] },
  }).limit(50).lean();

  for (const line of highConcessionLines) {
    findings.push({
      ruleCode: 'HIGH_CONCESSION_ANOMALY',
      ruleName: 'High Concession / Waiver Exceeding 50% of Fee',
      category: 'POTENTIAL',
      severity: 'MEDIUM',
      estimatedAmountPaise: line.concessionPaise,
      relatedEntityModel: 'Invoice',
      relatedEntityId: line.invoiceId,
      evidence: {
        description: line.description,
        amountPaise: line.amountPaise,
        concessionPaise: line.concessionPaise,
      },
    });
  }

  // 7. BUDGET_OVERRUN: Check if any expense category exceeds budget
  const budgets = await Budget.find().populate('categoryId').lean();
  for (const b of budgets) {
    const catId = b.categoryId?._id || b.categoryId;
    const [spentAgg] = await Expense.aggregate([
      { $match: { categoryId: catId, status: { $ne: 'CANCELLED' } } },
      { $group: { _id: null, totalSpent: { $sum: '$amountPaise' } } },
    ]);
    const totalSpent = spentAgg?.totalSpent || 0;
    if (totalSpent > b.allocatedPaise && b.allocatedPaise > 0) {
      findings.push({
        ruleCode: 'BUDGET_OVERRUN',
        ruleName: `Budget Overrun in ${b.categoryId?.name || 'Category'}`,
        category: 'CONFIRMED',
        severity: 'HIGH',
        estimatedAmountPaise: totalSpent - b.allocatedPaise,
        relatedEntityModel: 'Budget',
        relatedEntityId: b._id,
        evidence: {
          allocatedPaise: b.allocatedPaise,
          totalSpentPaise: totalSpent,
          overrunPaise: totalSpent - b.allocatedPaise,
        },
      });
    }
  }

  // Deduplicate and insert or update findings
  let createdCount = 0;
  for (const f of findings) {
    const existing = await RevenueLeakageFinding.findOne({
      ruleCode: f.ruleCode,
      relatedEntityId: f.relatedEntityId,
    });
    if (!existing) {
      await RevenueLeakageFinding.create(f);
      createdCount++;
    }
  }

  await recordAudit({
    actor,
    action: 'leakage.scan',
    after: { evaluatedCount: findings.length, newlyCreated: createdCount },
  });

  return { totalEvaluated: findings.length, newFindingsCreated: createdCount };
}

export async function listLeakageFindings({ status, severity, category, page = 1, pageSize = 25 } = {}) {
  const filter = {};
  if (status) filter.status = status;
  if (severity) filter.severity = severity;
  if (category) filter.category = category;

  const p = Math.max(1, parseInt(page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 25));
  const total = await RevenueLeakageFinding.countDocuments(filter);
  const items = await RevenueLeakageFinding.find(filter)
    .populate('investigatedByProfileId', 'displayName')
    .sort({ detectedAt: -1, severity: 1 })
    .skip((p - 1) * limit)
    .limit(limit)
    .lean();

  return { items, total, page: p, pageSize: limit, totalPages: Math.ceil(total / limit) || 1 };
}

export async function getLeakageSummary() {
  const [counts] = await RevenueLeakageFinding.aggregate([
    {
      $group: {
        _id: null,
        potentialPaise: {
          $sum: { $cond: [{ $and: [{ $eq: ['$category', 'POTENTIAL'] }, { $in: ['$status', ['OPEN', 'UNDER_REVIEW']] }] }, '$estimatedAmountPaise', 0] },
        },
        confirmedPaise: {
          $sum: { $cond: [{ $and: [{ $eq: ['$category', 'CONFIRMED'] }, { $in: ['$status', ['OPEN', 'UNDER_REVIEW', 'CONFIRMED']] }] }, '$estimatedAmountPaise', 0] },
        },
        recoveredPaise: { $sum: '$recoveredAmountPaise' },
        openCount: { $sum: { $cond: [{ $in: ['$status', ['OPEN', 'UNDER_REVIEW']] }, 1, 0] } },
        confirmedCount: { $sum: { $cond: [{ $eq: ['$status', 'CONFIRMED'] }, 1, 0] } },
        resolvedCount: { $sum: { $cond: [{ $eq: ['$status', 'RESOLVED'] }, 1, 0] } },
      },
    },
  ]);

  return {
    potentialPaise: counts?.potentialPaise || 0,
    confirmedPaise: counts?.confirmedPaise || 0,
    recoveredPaise: counts?.recoveredPaise || 0,
    openCount: counts?.openCount || 0,
    confirmedCount: counts?.confirmedCount || 0,
    resolvedCount: counts?.resolvedCount || 0,
  };
}

export async function updateLeakageStatus(actor, findingId, { status, category, recoveredAmountPaise, notes }) {
  const finding = await RevenueLeakageFinding.findById(findingId);
  if (!finding) throw new AppError('Finding not found', 404);

  const before = finding.toObject();

  if (status) {
    if (!['OPEN', 'UNDER_REVIEW', 'CONFIRMED', 'RESOLVED', 'FALSE_POSITIVE'].includes(status)) {
      throw new AppError('Invalid investigation status', 400);
    }
    finding.status = status;
  }
  if (category) {
    if (!['POTENTIAL', 'CONFIRMED'].includes(category)) {
      throw new AppError('Invalid category', 400);
    }
    finding.category = category;
  }
  if (recoveredAmountPaise !== undefined) {
    const rec = Number(recoveredAmountPaise);
    if (!Number.isFinite(rec) || rec < 0) throw new AppError('recoveredAmountPaise must be non-negative', 400);
    finding.recoveredAmountPaise = rec;
  }
  if (notes !== undefined) finding.investigationNotes = notes;

  finding.investigatedByProfileId = actor?.profileId;
  finding.investigatedAt = new Date();
  await finding.save();

  await recordAudit({
    actor,
    action: 'leakage.investigate',
    entityType: 'RevenueLeakageFinding',
    entityId: finding._id,
    before: { status: before.status, category: before.category, recovered: before.recoveredAmountPaise },
    after: { status: finding.status, category: finding.category, recovered: finding.recoveredAmountPaise },
  });

  return finding;
}
