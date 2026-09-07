import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { readFileSync } from 'node:fs';
import { Invoice, Payment, FeePlan, PaymentChangeRequest } from '../src/models/fee.model.js';
import { Student, Enrollment } from '../src/models/student.model.js';
import { AcademicYear } from '../src/models/academics.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import * as fees from '../src/modules/fees/fee.service.js';
import * as plans from '../src/modules/fees/plan.service.js';

/**
 * The separation of duties on the money paths.
 *
 * Two claims are under test and they are the ones the feature exists for:
 * Finance can prepare but not finalize, and an installment plan bills nobody
 * until an admin has published it. Both are checked at the service layer,
 * below any UI, because that is the layer an attacker or a mistaken script
 * reaches.
 */

const actor = (roleKey, permissions) => ({
  roleKey,
  profileId: new mongoose.Types.ObjectId().toString(),
  permissions,
});

const FINANCE = actor('FINANCE', {
  'fees.pay': 'ALL', 'fees.manage': 'ALL', 'fees.read': 'ALL',
  'fees.plan.request': 'ALL', 'fees.plan.review': 'ALL',
});
const ADMIN = actor('ADMIN', {
  'fees.pay': 'ALL', 'fees.manage': 'ALL', 'fees.read': 'ALL',
  'fees.plan.request': 'ALL', 'fees.plan.review': 'ALL',
  'fees.plan.approve': 'ALL', 'fees.payments.approve': 'ALL',
});

const CHEQUE = {
  number: '000123',
  bankName: 'State Bank',
  instrumentDate: '2026-06-10',
  proofUrl: '/uploads/cheque-1.jpg',
  proofName: 'cheque.jpg',
};

let year;
let enrollment;
let student;
let studentProfileId;

/** A student actor wired to the seeded student the way a real session is. */
const familyActor = () => ({
  roleKey: 'STUDENT',
  profileId: studentProfileId.toString(),
  permissions: { 'fees.read': 'OWN' },
});

async function seedInvoice(totalPaise = 100_000) {
  return Invoice.create({
    invoiceNo: `INV-${Math.random().toString(36).slice(2, 10)}`,
    enrollmentId: enrollment._id,
    totalPaise,
    dueOn: new Date('2026-07-01'),
  });
}

beforeEach(async () => {
  year = await AcademicYear.create({
    name: '2026-27', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31'), isCurrent: true,
  });
  studentProfileId = new mongoose.Types.ObjectId();
  student = await Student.create({
    admissionNo: `ADM-${Math.random().toString(36).slice(2, 8)}`,
    firstName: 'Diya',
    lastName: 'Sharma',
    // OWN scope resolves profile → student, so the link has to exist for the
    // family-facing assertions to mean anything.
    profileId: studentProfileId,
  });
  enrollment = await Enrollment.create({
    studentId: student._id,
    sectionId: new mongoose.Types.ObjectId(),
    academicYearId: year._id,
    status: 'ACTIVE',
  });
});

describe('finance registers payments but cannot finalize them', () => {
  it('a payment finance records is queued, and credits nothing', async () => {
    const invoice = await seedInvoice();
    const res = await fees.recordPayment(FINANCE, 'ALL', {
      invoiceId: invoice._id.toString(), amountPaise: 40_000, mode: 'CASH',
    });

    expect(res.recordStatus).toBe('PENDING_ADMIN_APPROVAL');
    expect(res.awaitingApproval).toBe(true);

    const stored = await Invoice.findById(invoice._id).lean();
    expect(stored.paidPaise).toBe(0);
    expect(stored.status).toBe('PENDING');
  });

  it('an admin approval is what credits the invoice', async () => {
    const invoice = await seedInvoice();
    const { payment } = await fees.recordPayment(FINANCE, 'ALL', {
      invoiceId: invoice._id.toString(), amountPaise: 100_000, mode: 'CASH',
    });

    await fees.approvePayment(ADMIN, payment._id);

    const stored = await Invoice.findById(invoice._id).lean();
    expect(stored.paidPaise).toBe(100_000);
    expect(stored.status).toBe('PAID');
    expect((await Payment.findById(payment._id).lean()).recordStatus).toBe('PUBLISHED');
  });

  it('approving twice credits the invoice once', async () => {
    const invoice = await seedInvoice();
    const { payment } = await fees.recordPayment(FINANCE, 'ALL', {
      invoiceId: invoice._id.toString(), amountPaise: 50_000, mode: 'CASH',
    });

    await fees.approvePayment(ADMIN, payment._id);
    await expect(fees.approvePayment(ADMIN, payment._id)).rejects.toMatchObject({ code: 'PAYMENT_NOT_PENDING' });

    expect((await Invoice.findById(invoice._id).lean()).paidPaise).toBe(50_000);
  });

  it('a rejected payment never reaches the invoice', async () => {
    const invoice = await seedInvoice();
    const { payment } = await fees.recordPayment(FINANCE, 'ALL', {
      invoiceId: invoice._id.toString(), amountPaise: 50_000, mode: 'CASH',
    });

    await fees.rejectPayment(ADMIN, payment._id, 'Cash never reached the office');

    const stored = await Invoice.findById(invoice._id).lean();
    expect(stored.paidPaise).toBe(0);
    const after = await Payment.findById(payment._id).lean();
    expect(after.recordStatus).toBe('REJECTED');
    expect(after.rejectionReason).toMatch(/never reached/i);
  });

  it('rejecting without a reason is refused', async () => {
    const invoice = await seedInvoice();
    const { payment } = await fees.recordPayment(FINANCE, 'ALL', {
      invoiceId: invoice._id.toString(), amountPaise: 10_000, mode: 'CASH',
    });
    await expect(fees.rejectPayment(ADMIN, payment._id, '  ')).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });

  it('queued payments count against the balance, so the invoice cannot be double-claimed', async () => {
    const invoice = await seedInvoice(100_000);
    await fees.recordPayment(FINANCE, 'ALL', {
      invoiceId: invoice._id.toString(), amountPaise: 100_000, mode: 'CASH',
    });

    await expect(
      fees.recordPayment(FINANCE, 'ALL', { invoiceId: invoice._id.toString(), amountPaise: 1, mode: 'CASH' })
    ).rejects.toMatchObject({ code: 'PAYMENT_EXCEEDS_BALANCE' });
  });

  it('an admin recording directly still publishes immediately', async () => {
    const invoice = await seedInvoice();
    const res = await fees.recordPayment(ADMIN, 'ALL', {
      invoiceId: invoice._id.toString(), amountPaise: 100_000, mode: 'CASH',
    });
    expect(res.recordStatus).toBe('PUBLISHED');
    expect((await Invoice.findById(invoice._id).lean()).status).toBe('PAID');
  });
});

describe('payment method validation is enforced by the server', () => {
  it.each([
    ['CHEQUE', /Cheque number.*Bank name.*Cheque date.*Cheque image/s],
    ['DD', /DD number.*Bank name.*DD date.*DD image/s],
    ['BANK', /Transaction.*Bank name.*Transfer date.*Transfer proof/s],
  ])('%s is refused with no instrument details at all', async (mode, pattern) => {
    const invoice = await seedInvoice();
    await expect(
      fees.recordPayment(FINANCE, 'ALL', { invoiceId: invoice._id.toString(), amountPaise: 10_000, mode })
    ).rejects.toMatchObject({ code: 'PAYMENT_DETAILS_INCOMPLETE' });

    await expect(
      fees.recordPayment(FINANCE, 'ALL', { invoiceId: invoice._id.toString(), amountPaise: 10_000, mode })
    ).rejects.toThrow(pattern);
    expect(await Payment.countDocuments()).toBe(0);
  });

  it.each(['number', 'bankName', 'instrumentDate', 'proofUrl'])(
    'a cheque missing only %s is still refused',
    async (field) => {
      const invoice = await seedInvoice();
      const instrument = { ...CHEQUE, [field]: '' };
      await expect(
        fees.recordPayment(FINANCE, 'ALL', {
          invoiceId: invoice._id.toString(), amountPaise: 10_000, mode: 'CHEQUE', instrument,
        })
      ).rejects.toMatchObject({ code: 'PAYMENT_DETAILS_INCOMPLETE' });
      expect(await Payment.countDocuments()).toBe(0);
    }
  );

  it('a proof file of the wrong type is refused', async () => {
    const invoice = await seedInvoice();
    await expect(
      fees.recordPayment(FINANCE, 'ALL', {
        invoiceId: invoice._id.toString(),
        amountPaise: 10_000,
        mode: 'CHEQUE',
        instrument: { ...CHEQUE, proofUrl: '/uploads/cheque.exe' },
      })
    ).rejects.toMatchObject({ code: 'PAYMENT_PROOF_INVALID' });
  });

  it('a complete cheque is accepted and its details are stored', async () => {
    const invoice = await seedInvoice();
    const { payment } = await fees.recordPayment(FINANCE, 'ALL', {
      invoiceId: invoice._id.toString(), amountPaise: 10_000, mode: 'CHEQUE', instrument: CHEQUE, paidOn: '2026-06-12',
    });

    const stored = await Payment.findById(payment._id).lean();
    expect(stored.instrument.number).toBe('000123');
    expect(stored.instrument.bankName).toBe('State Bank');
    expect(stored.instrument.proofUrl).toBe('/uploads/cheque-1.jpg');
    expect(new Date(stored.paidOn).toISOString().slice(0, 10)).toBe('2026-06-12');
  });

  it('cash needs no instrument', async () => {
    const invoice = await seedInvoice();
    const res = await fees.recordPayment(FINANCE, 'ALL', {
      invoiceId: invoice._id.toString(), amountPaise: 10_000, mode: 'CASH',
    });
    expect(res.payment.instrument).toBeFalsy();
  });
});

describe('a family sees approved money only', () => {
  it('a queued payment is invisible at OWN scope and visible to staff', async () => {
    const invoice = await seedInvoice();
    await fees.recordPayment(FINANCE, 'ALL', {
      invoiceId: invoice._id.toString(), amountPaise: 40_000, mode: 'CASH',
    });

    const family = familyActor();

    const staffView = await fees.listPayments(ADMIN, 'ALL', {});
    expect(staffView).toHaveLength(1);
    expect(staffView[0].recordStatus).toBe('PENDING_ADMIN_APPROVAL');

    const ownView = await fees.listPayments(family, 'OWN', {});
    expect(ownView).toHaveLength(0);
  });
});

describe('finance cannot edit a published payment, only ask', () => {
  let payment;
  beforeEach(async () => {
    const invoice = await seedInvoice();
    const res = await fees.recordPayment(ADMIN, 'ALL', {
      invoiceId: invoice._id.toString(), amountPaise: 40_000, mode: 'CASH',
    });
    payment = res.payment;
  });

  it('a change request records both values and changes nothing yet', async () => {
    const request = await fees.createPaymentChangeRequest(FINANCE, {
      paymentId: payment._id.toString(),
      field: 'amountPaise',
      requestedValue: 30_000,
      reason: 'Counted wrong at the desk',
    });

    expect(request.status).toBe('PENDING_ADMIN_APPROVAL');
    expect(Number(request.currentValue)).toBe(40_000);
    expect((await Payment.findById(payment._id).lean()).amountPaise).toBe(40_000);
  });

  it('admin approval applies the change and moves the invoice with it', async () => {
    const request = await fees.createPaymentChangeRequest(FINANCE, {
      paymentId: payment._id.toString(),
      field: 'amountPaise',
      requestedValue: 30_000,
      reason: 'Counted wrong at the desk',
    });

    await fees.decidePaymentChangeRequest(ADMIN, request._id, { approve: true });

    expect((await Payment.findById(payment._id).lean()).amountPaise).toBe(30_000);
    expect((await Invoice.findById(payment.invoiceId).lean()).paidPaise).toBe(30_000);
    expect((await PaymentChangeRequest.findById(request._id).lean()).status).toBe('APPROVED');
  });

  it('a rejected change keeps the original value and its reason', async () => {
    const request = await fees.createPaymentChangeRequest(FINANCE, {
      paymentId: payment._id.toString(), field: 'amountPaise', requestedValue: 30_000, reason: 'typo',
    });

    await fees.decidePaymentChangeRequest(ADMIN, request._id, { approve: false, reason: 'Receipt says 400' });

    expect((await Payment.findById(payment._id).lean()).amountPaise).toBe(40_000);
    const after = await PaymentChangeRequest.findById(request._id).lean();
    expect(after.status).toBe('REJECTED');
    expect(after.decisionReason).toBe('Receipt says 400');
  });

  it('a field nobody may change is refused', async () => {
    await expect(
      fees.createPaymentChangeRequest(FINANCE, {
        paymentId: payment._id.toString(), field: 'invoiceId', requestedValue: 'x', reason: 'because',
      })
    ).rejects.toMatchObject({ code: 'FIELD_NOT_EDITABLE' });
  });

  it('a change request with no reason is refused', async () => {
    await expect(
      fees.createPaymentChangeRequest(FINANCE, {
        paymentId: payment._id.toString(), field: 'notes', requestedValue: 'x', reason: '   ',
      })
    ).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });

  it('every decision leaves an audit entry naming the old and new value', async () => {
    const request = await fees.createPaymentChangeRequest(FINANCE, {
      paymentId: payment._id.toString(), field: 'notes', requestedValue: 'Cleared 12 June', reason: 'bank confirmed',
    });
    await fees.decidePaymentChangeRequest(ADMIN, request._id, { approve: true });

    const entries = await AuditLog.find({ entityType: 'Payment', entityId: String(payment._id) }).lean();
    const applied = entries.find((e) => e.action === 'fees.payment.changeRequest.approve');
    expect(applied).toBeTruthy();
    expect(applied.before.value).toBeNull();
    expect(applied.after.value).toBe('Cleared 12 June');
    expect(applied.after.reason).toBe('bank confirmed');
  });
});

describe('installment plans bill nobody until they are published', () => {
  const draft = (over = {}) => ({
    enrollmentId: enrollment._id.toString(),
    name: 'Tuition 2026-27',
    mode: 'INSTALLMENT',
    totalPaise: 120_000,
    installments: [
      { amountPaise: 40_000, dueOn: '2026-06-10' },
      { amountPaise: 40_000, dueOn: '2026-08-10' },
      { amountPaise: 40_000, dueOn: '2026-10-10' },
    ],
    ...over,
  });

  it('installments that do not add up to the total are refused', async () => {
    await expect(
      plans.createFeePlan(FINANCE, draft({ totalPaise: 130_000 }))
    ).rejects.toMatchObject({ code: 'INSTALLMENT_TOTAL_MISMATCH' });
    expect(await FeePlan.countDocuments()).toBe(0);
  });

  it('a one-time plan must have exactly one installment', async () => {
    await expect(
      plans.createFeePlan(FINANCE, draft({ mode: 'ONE_TIME' }))
    ).rejects.toMatchObject({ code: 'INVALID_INSTALLMENTS' });
  });

  it('out-of-order due dates are refused', async () => {
    await expect(
      plans.createFeePlan(FINANCE, draft({
        installments: [
          { amountPaise: 60_000, dueOn: '2026-10-10' },
          { amountPaise: 60_000, dueOn: '2026-06-10' },
        ],
      }))
    ).rejects.toMatchObject({ code: 'INVALID_INSTALLMENTS' });
  });

  it('walks the full workflow and only then raises invoices', async () => {
    const plan = await plans.createFeePlan(FINANCE, draft());
    expect(plan.status).toBe('DRAFT');
    expect(await Invoice.countDocuments()).toBe(0);

    await plans.transitionFeePlan(FINANCE, plan._id, 'submit');
    await plans.transitionFeePlan(FINANCE, plan._id, 'review', { note: 'Schedule looks right' });
    await plans.transitionFeePlan(FINANCE, plan._id, 'requestApproval');

    // Still nothing billed, and finance cannot take the last step.
    expect(await Invoice.countDocuments()).toBe(0);
    await expect(plans.transitionFeePlan(FINANCE, plan._id, 'approve'))
      .rejects.toMatchObject({ code: 'MISSING_PERMISSION' });
    await expect(plans.publishFeePlan(FINANCE, plan._id))
      .rejects.toMatchObject({ code: 'MISSING_PERMISSION' });

    await plans.transitionFeePlan(ADMIN, plan._id, 'approve');
    const { invoicesRaised } = await plans.publishFeePlan(ADMIN, plan._id);

    expect(invoicesRaised).toHaveLength(3);
    const invoices = await Invoice.find({ planId: plan._id }).sort({ installmentSeq: 1 }).lean();
    expect(invoices.map((i) => i.totalPaise)).toEqual([40_000, 40_000, 40_000]);
    expect((await FeePlan.findById(plan._id).lean()).status).toBe('PUBLISHED');
  });

  it('publishing twice does not bill twice', async () => {
    const plan = await plans.createFeePlan(ADMIN, draft());
    await plans.transitionFeePlan(ADMIN, plan._id, 'submit');
    await plans.transitionFeePlan(ADMIN, plan._id, 'review');
    await plans.transitionFeePlan(ADMIN, plan._id, 'requestApproval');
    await plans.transitionFeePlan(ADMIN, plan._id, 'approve');

    await plans.publishFeePlan(ADMIN, plan._id);
    const second = await plans.publishFeePlan(ADMIN, plan._id);

    expect(second.invoicesRaised).toHaveLength(0);
    expect(await Invoice.countDocuments({ planId: plan._id })).toBe(3);
  });

  it('a step cannot be skipped', async () => {
    const plan = await plans.createFeePlan(ADMIN, draft());
    await expect(plans.transitionFeePlan(ADMIN, plan._id, 'approve'))
      .rejects.toMatchObject({ code: 'INVALID_PLAN_TRANSITION' });
    await expect(plans.publishFeePlan(ADMIN, plan._id))
      .rejects.toMatchObject({ code: 'PLAN_NOT_APPROVED' });
  });

  it('a rejected plan does not become active', async () => {
    const plan = await plans.createFeePlan(FINANCE, draft());
    await plans.transitionFeePlan(FINANCE, plan._id, 'submit');
    await plans.transitionFeePlan(FINANCE, plan._id, 'review');
    await plans.transitionFeePlan(FINANCE, plan._id, 'requestApproval');
    await plans.transitionFeePlan(ADMIN, plan._id, 'reject', { reason: 'Schedule ends after the year does' });

    const after = await FeePlan.findById(plan._id).lean();
    expect(after.status).toBe('REJECTED');
    expect(after.rejectionReason).toMatch(/ends after/i);
    expect(await Invoice.countDocuments()).toBe(0);
  });

  it('a student sees published plans only', async () => {
    const family = familyActor();

    const plan = await plans.createFeePlan(ADMIN, draft());
    expect(await plans.listFeePlans(family, 'OWN', {})).toHaveLength(0);

    await plans.transitionFeePlan(ADMIN, plan._id, 'submit');
    await plans.transitionFeePlan(ADMIN, plan._id, 'review');
    await plans.transitionFeePlan(ADMIN, plan._id, 'requestApproval');
    await plans.transitionFeePlan(ADMIN, plan._id, 'approve');
    expect(await plans.listFeePlans(family, 'OWN', {})).toHaveLength(0);

    await plans.publishFeePlan(ADMIN, plan._id);
    const visible = await plans.listFeePlans(family, 'OWN', {});
    expect(visible).toHaveLength(1);
    // Populated refs must still serialise as usable ids, not "[object Object]".
    expect(visible[0].academicYearId).toBe(String(year._id));
    expect(visible[0].academicYearName).toBe('2026-27');
    expect(visible[0].studentId).toBe(String(student._id));
    expect(visible[0].installments).toHaveLength(3);
    expect(visible[0].installments[0].status).toBe('OVERDUE');
    expect(visible[0].remainingPaise).toBe(120_000);
  });
});

describe('year-scoped retrieval never mixes academic years', () => {
  it('each year returns only its own invoices and payments', async () => {
    const lastYear = await AcademicYear.create({
      name: '2025-26', startsOn: new Date('2025-04-01'), endsOn: new Date('2026-03-31'),
    });
    const oldEnrollment = await Enrollment.create({
      studentId: student._id,
      sectionId: new mongoose.Types.ObjectId(),
      academicYearId: lastYear._id,
      status: 'TRANSFERRED',
    });

    const thisYearInvoice = await seedInvoice(100_000);
    await Invoice.create({
      invoiceNo: 'INV-OLD-1', enrollmentId: oldEnrollment._id, totalPaise: 70_000, dueOn: new Date('2025-07-01'),
    });

    await fees.recordPayment(ADMIN, 'ALL', {
      invoiceId: thisYearInvoice._id.toString(), amountPaise: 100_000, mode: 'CASH',
    });

    const family = familyActor();

    const years = await fees.listPaymentAcademicYears(family, 'OWN');
    expect(years.map((y) => y.name)).toEqual(['2026-27', '2025-26']);
    expect(years[0].invoiceCount).toBe(1);

    const current = await fees.getStudentPaymentOverview(family, 'OWN', {});
    expect(current.academicYearName).toBe('2026-27');
    expect(current.invoices).toHaveLength(1);
    expect(current.payments).toHaveLength(1);
    expect(current.summary.totalBilledPaise).toBe(100_000);

    const previous = await fees.getStudentPaymentOverview(family, 'OWN', { academicYearId: lastYear._id.toString() });
    expect(previous.academicYearName).toBe('2025-26');
    expect(previous.invoices).toHaveLength(1);
    expect(previous.invoices[0].invoiceNo).toBe('INV-OLD-1');
    expect(previous.payments).toHaveLength(0);
    expect(previous.summary.totalBilledPaise).toBe(70_000);
  });
});

describe('the routes are guarded by the keys the workflow depends on', () => {
  // The house pattern: assert against the route file itself, so a guard that
  // is loosened later fails here rather than in production. Paired with the
  // requirePermission tests in fees.authorization.test.js, which prove FINANCE
  // cannot satisfy these keys, this pins both halves of the rule.
  // Several registrations wrap across lines, so the file is read with runs of
  // whitespace collapsed and matched as one string.
  // Several registrations wrap across lines, so the file is read with every
  // run of whitespace removed and matched as one string.
  const routes = readFileSync(new URL('../src/modules/fees/fee.routes.js', import.meta.url), 'utf8')
    .replace(/\s+/g, '');

  it.each([
    ["router.post('/payments/:id/approve'", 'fees.payments.approve'],
    ["router.post('/payments/:id/reject'", 'fees.payments.approve'],
    ["router.patch('/payments/:id'", 'fees.payments.approve'],
    ["router.post('/payments/change-requests/:id/decide'", 'fees.payments.approve'],
    ["router.post('/plans/:id/publish'", 'fees.plan.approve'],
    ["router.post('/plans'", 'fees.plan.request'],
  ])('%s is guarded by %s at school-wide scope', (registration, key) => {
    const needle = registration.replace(/\s+/g, '');
    const at = routes.indexOf(needle);
    expect(at, `no route registration found for ${registration}`).toBeGreaterThan(-1);
    // The guard must be the next argument in that registration, not merely
    // present somewhere later in the file.
    expect(routes.slice(at, at + needle.length + 60))
      .toContain(`requirePermission('${key}','ALL')`);
  });
});
