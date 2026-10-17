import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Invoice } from '../src/models/fee.model.js';
import { Enrollment, Student, StudentGuardian } from '../src/models/student.model.js';
import { Profile } from '../src/models/profile.model.js';
import { Notification } from '../src/models/notification.model.js';
import { PaymentReminderLog, ReminderRule } from '../src/models/reminder.model.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as reminderService from '../src/modules/fees/reminder.service.js';

const TENANT = 'oakridge';
const inTenant = (fn) => runWithTenant(TENANT, fn);

const actor = {
  profileId: new mongoose.Types.ObjectId().toString(),
  roleKey: 'ADMIN',
  permissions: { 'fees.manage': 'ALL' },
};

describe('Automated Bill Reminders & Deduplication', () => {
  let invoice;
  let guardianProfile;

  beforeEach(async () => {
    await inTenant(async () => {
      await PaymentReminderLog.deleteMany({});
      await ReminderRule.deleteMany({});
      await Notification.deleteMany({});
      await Invoice.deleteMany({});
      await Student.deleteMany({});
      await StudentGuardian.deleteMany({});
      await Profile.deleteMany({});

      guardianProfile = await Profile.create({
        displayName: 'Priya Sharma (Parent)',
        status: 'ACTIVE',
        accountId: new mongoose.Types.ObjectId(),
        roleId: new mongoose.Types.ObjectId(),
      });

      const student = await Student.create({
        admissionNo: 'ADM-REM-01',
        firstName: 'Vivaan',
      });

      await StudentGuardian.create({
        studentId: student._id,
        guardianProfileId: guardianProfile._id,
        relation: 'MOTHER',
        isPrimary: true,
      });

      const enrollment = await Enrollment.create({
        studentId: student._id,
        sectionId: new mongoose.Types.ObjectId(),
        academicYearId: new mongoose.Types.ObjectId(),
      });

      invoice = await Invoice.create({
        enrollmentId: enrollment._id,
        invoiceNo: 'INV-REM-101',
        totalPaise: 450000,
        paidPaise: 0,
        dueOn: new Date('2026-11-15'),
        status: 'PENDING',
      });
    });
  });

  it('sends in-app notification reminder and logs delivery', async () => {
    await inTenant(async () => {
      const log = await reminderService.sendInvoiceReminder(actor, {
        invoiceId: invoice._id,
        channel: 'IN_APP',
        stage: 'MANUAL',
      });

      expect(log.status).toBe('DELIVERED');
      expect(log.channel).toBe('IN_APP');

      const notif = await Notification.findOne({ recipientProfileId: guardianProfile._id });
      expect(notif).toBeTruthy();
      expect(notif.type).toBe('FEES');
      expect(notif.title).toContain('INV-REM-101');
    });
  });

  it('deduplicates automated reminders for the same invoice, stage, and channel on the same day', async () => {
    await inTenant(async () => {
      // First automated reminder
      const first = await reminderService.sendInvoiceReminder(actor, {
        invoiceId: invoice._id,
        channel: 'IN_APP',
        stage: 'BEFORE_DUE',
      });
      expect(first.skipped).toBeFalsy();

      // Immediate second automated reminder for same stage
      const second = await reminderService.sendInvoiceReminder(actor, {
        invoiceId: invoice._id,
        channel: 'IN_APP',
        stage: 'BEFORE_DUE',
      });
      expect(second.skipped).toBe(true);
      expect(second.reason).toContain('Already reminded today');
    });
  });

  it('allows manual resend regardless of automated deduplication', async () => {
    await inTenant(async () => {
      await reminderService.sendInvoiceReminder(actor, {
        invoiceId: invoice._id,
        channel: 'IN_APP',
        stage: 'BEFORE_DUE',
      });

      // Manual resend
      const manual = await reminderService.sendInvoiceReminder(actor, {
        invoiceId: invoice._id,
        channel: 'IN_APP',
        stage: 'MANUAL',
      });
      expect(manual.skipped).toBeFalsy();
      expect(manual.stage).toBe('MANUAL');
    });
  });
});
