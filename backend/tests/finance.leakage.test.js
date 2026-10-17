import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Invoice, InvoiceLine, Payment } from '../src/models/fee.model.js';
import { Enrollment, Student } from '../src/models/student.model.js';
import { HostelRoom, HostelAllocation } from '../src/models/hostel.model.js';
import { RevenueLeakageFinding } from '../src/models/leakage.model.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as leakageService from '../src/modules/fees/leakage.service.js';

const TENANT = 'oakridge';
const inTenant = (fn) => runWithTenant(TENANT, fn);

const actor = {
  profileId: new mongoose.Types.ObjectId().toString(),
  roleKey: 'ADMIN',
  permissions: { 'fees.manage': 'ALL' },
};

describe('Revenue Leakage Detection Engine', () => {
  beforeEach(async () => {
    await inTenant(async () => {
      await RevenueLeakageFinding.deleteMany({});
      await Invoice.deleteMany({});
      await InvoiceLine.deleteMany({});
      await Payment.deleteMany({});
      await Enrollment.deleteMany({});
      await Student.deleteMany({});
      await HostelAllocation.deleteMany({});
      await HostelRoom.deleteMany({});
    });
  });

  it('detects unbilled active students as potential revenue leakage', async () => {
    await inTenant(async () => {
      const student = await Student.create({ admissionNo: 'LEAK-01', firstName: 'Diya' });
      await Enrollment.create({
        studentId: student._id,
        sectionId: new mongoose.Types.ObjectId(),
        academicYearId: new mongoose.Types.ObjectId(),
        status: 'ACTIVE',
      });

      // No invoice created for this enrollment
      const scanResult = await leakageService.runLeakageDetection(actor);
      expect(scanResult.newFindingsCreated).toBeGreaterThanOrEqual(1);

      const findings = await RevenueLeakageFinding.find({ ruleCode: 'UNBILLED_ACTIVE_STUDENT' }).lean();
      expect(findings.length).toBe(1);
      expect(findings[0].category).toBe('POTENTIAL');
      expect(findings[0].status).toBe('OPEN');
      expect(findings[0].estimatedAmountPaise).toBeGreaterThan(0);
    });
  });

  it('detects active hostel allocation without matching hostel line item', async () => {
    await inTenant(async () => {
      const student = await Student.create({ admissionNo: 'LEAK-02', firstName: 'Rohan' });
      const enrollment = await Enrollment.create({
        studentId: student._id,
        sectionId: new mongoose.Types.ObjectId(),
        academicYearId: new mongoose.Types.ObjectId(),
        status: 'ACTIVE',
      });

      // Tuition invoice created, but NO hostel line
      const inv = await Invoice.create({
        enrollmentId: enrollment._id,
        invoiceNo: 'INV-TUI-01',
        totalPaise: 400000,
        paidPaise: 400000,
        dueOn: new Date(),
        status: 'PAID',
      });
      await InvoiceLine.create({
        invoiceId: inv._id,
        description: 'Annual Tuition Fee',
        amountPaise: 400000,
      });

      // Student has active hostel room allocation
      const room = await HostelRoom.create({ roomNo: 'B-201', capacity: 2 });
      await HostelAllocation.create({
        roomId: room._id,
        studentId: student._id,
        status: 'ACTIVE',
      });

      const scanResult = await leakageService.runLeakageDetection(actor);
      expect(scanResult.newFindingsCreated).toBeGreaterThanOrEqual(1);

      const hostelFinding = await RevenueLeakageFinding.findOne({ ruleCode: 'UNBILLED_HOSTEL_ALLOCATION' });
      expect(hostelFinding).toBeTruthy();
      expect(hostelFinding.severity).toBe('HIGH');
    });
  });

  it('transitions investigation status and records recovery without counting twice', async () => {
    await inTenant(async () => {
      const finding = await RevenueLeakageFinding.create({
        ruleCode: 'OVERDUE_NO_FOLLOWUP',
        ruleName: 'Overdue Uncollected Invoice',
        category: 'POTENTIAL',
        severity: 'HIGH',
        estimatedAmountPaise: 1000000,
        status: 'OPEN',
      });

      // Move to CONFIRMED
      const confirmed = await leakageService.updateLeakageStatus(actor, finding._id, {
        status: 'CONFIRMED',
        category: 'CONFIRMED',
        notes: 'Parent reached out and agreed to payment plan',
      });
      expect(confirmed.status).toBe('CONFIRMED');
      expect(confirmed.category).toBe('CONFIRMED');

      // Recover partial amount and resolve
      const resolved = await leakageService.updateLeakageStatus(actor, finding._id, {
        status: 'RESOLVED',
        recoveredAmountPaise: 1000000,
        notes: 'Full recovery collected via RTGS',
      });
      expect(resolved.status).toBe('RESOLVED');
      expect(resolved.recoveredAmountPaise).toBe(1000000);

      // Verify leakage summary aggregates accurately
      const summary = await leakageService.getLeakageSummary();
      expect(summary.recoveredPaise).toBe(1000000);
      expect(summary.resolvedCount).toBe(1);
    });
  });
});
