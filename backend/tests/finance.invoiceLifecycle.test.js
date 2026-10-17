import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Invoice } from '../src/models/fee.model.js';
import { Enrollment, Student } from '../src/models/student.model.js';
import { AcademicYear, Grade, Section } from '../src/models/academics.model.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as fees from '../src/modules/fees/fee.service.js';

const TENANT = 'oakridge';
const inTenant = (fn) => runWithTenant(TENANT, fn);

const actor = {
  profileId: new mongoose.Types.ObjectId().toString(),
  roleKey: 'ADMIN',
  permissions: { 'fees.manage': 'ALL', 'fees.read': 'ALL' },
};

describe('Extended Invoice Lifecycle & Integrity', () => {
  let enrollment;

  beforeEach(async () => {
    await inTenant(async () => {
      await Invoice.deleteMany({});
      await Enrollment.deleteMany({});
      await Student.deleteMany({});

      const student = await Student.create({
        admissionNo: 'ADM-FIN-01',
        firstName: 'Aarav',
        lastName: 'Sharma',
      });
      const year = await AcademicYear.create({
        name: '2026-27',
        startsOn: new Date('2026-04-01'),
        endsOn: new Date('2027-03-31'),
      });
      const grade = await Grade.create({ name: 'Grade 10', level: 10 });
      const section = await Section.create({ name: 'A', gradeId: grade._id });

      enrollment = await Enrollment.create({
        studentId: student._id,
        sectionId: section._id,
        academicYearId: year._id,
      });
    });
  });

  it('cancels an unpaid invoice and records cancellation metadata', async () => {
    await inTenant(async () => {
      const inv = await Invoice.create({
        enrollmentId: enrollment._id,
        invoiceNo: 'INV-TEST-001',
        totalPaise: 500000,
        paidPaise: 0,
        dueOn: new Date('2026-11-01'),
        status: 'PENDING',
      });

      const cancelled = await fees.cancelInvoice(actor, inv._id, 'Duplicate invoice requested by parent');
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.cancellationReason).toBe('Duplicate invoice requested by parent');
      expect(cancelled.cancelledAt).toBeInstanceOf(Date);
    });
  });

  it('refuses to cancel an invoice with paid balance', async () => {
    await inTenant(async () => {
      const inv = await Invoice.create({
        enrollmentId: enrollment._id,
        invoiceNo: 'INV-TEST-002',
        totalPaise: 500000,
        paidPaise: 200000,
        dueOn: new Date('2026-11-01'),
        status: 'PARTIAL',
      });

      await expect(
        fees.cancelInvoice(actor, inv._id, 'Student withdrawn')
      ).rejects.toThrow('Cannot cancel an invoice with recorded payments');
    });
  });

  it('marks an invoice as disputed and resolves it back to appropriate status', async () => {
    await inTenant(async () => {
      const inv = await Invoice.create({
        enrollmentId: enrollment._id,
        invoiceNo: 'INV-TEST-003',
        totalPaise: 500000,
        paidPaise: 0,
        dueOn: new Date('2026-12-01'),
        status: 'PENDING',
      });

      // Dispute
      const disputed = await fees.disputeInvoice(actor, inv._id, {
        dispute: true,
        reason: 'Fee concession not applied on tuition line',
      });
      expect(disputed.status).toBe('DISPUTED');
      expect(disputed.disputeReason).toBe('Fee concession not applied on tuition line');

      // Resolve dispute
      const resolved = await fees.disputeInvoice(actor, inv._id, { dispute: false });
      expect(resolved.status).toBe('PENDING');
      expect(resolved.disputeResolvedAt).toBeInstanceOf(Date);
    });
  });
});
