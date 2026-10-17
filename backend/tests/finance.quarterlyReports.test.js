import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Invoice, InvoiceLine, Payment } from '../src/models/fee.model.js';
import { Enrollment, Student } from '../src/models/student.model.js';
import { Expense } from '../src/models/expense.model.js';
import { QuarterlyFinancialReport } from '../src/models/financialReport.model.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as reportService from '../src/modules/fees/financialReport.service.js';

const TENANT = 'oakridge';
const inTenant = (fn) => runWithTenant(TENANT, fn);

const actor = {
  profileId: new mongoose.Types.ObjectId().toString(),
  roleKey: 'ADMIN',
  permissions: { 'fees.manage': 'ALL', 'fees.read': 'ALL' },
};

describe('Quarterly Financial Report Aggregation & Math Accuracy', () => {
  beforeEach(async () => {
    await inTenant(async () => {
      await QuarterlyFinancialReport.deleteMany({});
      await Invoice.deleteMany({});
      await InvoiceLine.deleteMany({});
      await Payment.deleteMany({});
      await Expense.deleteMany({});
      await Enrollment.deleteMany({});
      await Student.deleteMany({});

      const student = await Student.create({ admissionNo: 'STU-Q-01', firstName: 'Kavya' });
      const enrollment = await Enrollment.create({
        studentId: student._id,
        sectionId: new mongoose.Types.ObjectId(),
        academicYearId: new mongoose.Types.ObjectId(),
      });

      // Invoice billed in Q1 2026 (e.g. May 15, 2026)
      const inv = await Invoice.create({
        enrollmentId: enrollment._id,
        invoiceNo: 'INV-Q1-01',
        totalPaise: 1000000, // Rs. 10,000
        paidPaise: 700000,   // Rs. 7,000
        dueOn: new Date('2026-06-01'),
        status: 'PARTIAL',
        createdAt: new Date('2026-05-15'),
      });

      // Payment in Q1 2026
      await Payment.create({
        invoiceId: inv._id,
        amountPaise: 700000,
        mode: 'BANK',
        status: 'SUCCESS',
        recordStatus: 'PUBLISHED',
        createdAt: new Date('2026-05-20'),
      });

      // Expense in Q1 2026
      await Expense.create({
        categoryId: new mongoose.Types.ObjectId(),
        title: 'Classroom Projector Repair',
        amountPaise: 200000, // Rs. 2,000
        expenseDate: new Date('2026-05-25'),
        status: 'PAID',
      });
    });
  });

  it('aggregates quarterly totals, collection rate, and net operating margin correctly', async () => {
    await inTenant(async () => {
      const report = await reportService.generateQuarterlyReport(actor, {
        year: 2026,
        quarter: 'Q1',
      });

      expect(report.year).toBe(2026);
      expect(report.quarter).toBe('Q1');
      expect(report.metrics.totalBilledPaise).toBe(1000000);
      expect(report.metrics.totalCollectedPaise).toBe(700000);
      expect(report.metrics.totalExpensesPaise).toBe(200000);
      expect(report.metrics.netOperatingMarginPaise).toBe(500000); // 700000 - 200000
      expect(report.metrics.collectionRatePct).toBe(70); // 70%
    });
  });

  it('records distribution history and updates report state to DISTRIBUTED', async () => {
    await inTenant(async () => {
      const report = await reportService.generateQuarterlyReport(actor, {
        year: 2026,
        quarter: 'Q1',
      });

      const dist = await reportService.distributeReport(actor, report._id, {
        recipientEmails: ['principal@oakridge.edu', 'board@oakridge.edu'],
      });

      expect(dist.distributedCount).toBe(2);

      const updated = await QuarterlyFinancialReport.findById(report._id);
      expect(updated.status).toBe('DISTRIBUTED');
      expect(updated.distributionHistory.length).toBe(2);
    });
  });
});
