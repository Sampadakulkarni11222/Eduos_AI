import { describe, it, expect, beforeEach } from 'vitest';
import { seedRoles, seedPerson, inSchool, OAK } from './support/mcpSchool.js';
import { Invoice, InvoiceLine, Payment } from '../src/models/fee.model.js';
import { Student, StudentGuardian, Enrollment } from '../src/models/student.model.js';
import { AcademicYear, Grade, Section } from '../src/models/academics.model.js';
import { Profile } from '../src/models/profile.model.js';
import * as fees from '../src/modules/fees/fee.service.js';
import { receiptContent } from '../src/utils/receiptPdf.js';
import { amountInWords, financialYear, inr } from '../src/modules/finance-ops/format.js';

/**
 * F10 receipt numbers, F18 receipt content, F19 UPI, F20 s.269ST, F9 summary.
 */

const oak = (fn) => inSchool(OAK, fn);
let P; let world;

let roll = 0;
async function makeStudent(name, admissionNo, guardianProfileId) {
  const student = await Student.create({ admissionNo, firstName: name, lastName: 'Sharma' });
  const enrollment = await Enrollment.create({ studentId: student._id, sectionId: world.section._id, academicYearId: world.year._id, rollNo: ++roll });
  if (guardianProfileId) await StudentGuardian.create({ studentId: student._id, guardianProfileId, relation: 'FATHER' });
  return { student, enrollment };
}

async function makeInvoice(enrollmentId, totalPaise = 5_000_000, lines = [{ description: 'Tuition — Term 1', amountPaise: totalPaise }]) {
  const inv = await Invoice.create({ enrollmentId, invoiceNo: `INV-${Math.random().toString(36).slice(2, 9)}`, totalPaise, dueOn: new Date(Date.now() + 86_400_000) });
  await InvoiceLine.insertMany(lines.map((l) => ({ ...l, invoiceId: inv._id })));
  return inv;
}

beforeEach(async () => {
  const roles = await seedRoles();
  P = {};
  for (const key of ['ADMIN', 'FINANCE', 'PARENT']) P[key] = await seedPerson({ roleKey: key, roleId: roles[key], displayName: `${key} person` });
  world = await oak(async () => {
    const year = await AcademicYear.create({ name: '2026-27', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31'), isCurrent: true });
    const grade = await Grade.create({ name: 'Class 5', level: 5 });
    const section = await Section.create({ gradeId: grade._id, name: 'A' });
    return { year, grade, section };
  });
  world.a = await oak(() => makeStudent('Rahul', 'OAK-0101', P.PARENT.actor.profileId));
  world.b = await oak(() => makeStudent('Riya', 'OAK-0102', P.PARENT.actor.profileId));
});

const pay = (actor, invoiceId, amountPaise, extra = {}) =>
  oak(() => fees.recordPayment(actor, 'ALL', { invoiceId: String(invoiceId), amountPaise, mode: 'CASH', ...extra }));

describe('F10: receipt numbers are a gap-free series per financial year', () => {
  it('numbers credited payments consecutively; a queued payment gets its number only when approved; a rejected one never does', async () => {
    const inv = await oak(() => makeInvoice(world.a.enrollment._id));
    const fy = financialYear();
    const first = await pay(P.ADMIN.actor, inv._id, 1_000);
    const second = await pay(P.ADMIN.actor, inv._id, 1_000);
    expect(first.receiptNo).toBe(`RCPT/${fy}/000001`);
    expect(second.receiptNo).toBe(`RCPT/${fy}/000002`);

    const rejected = await pay(P.FINANCE.actor, inv._id, 1_000);
    expect(rejected.receiptNo).toBeNull();
    await oak(() => fees.rejectPayment(P.ADMIN.actor, String(rejected.payment._id), 'Wrong invoice'));

    const queued = await pay(P.FINANCE.actor, inv._id, 1_000, { receiptNo: 'Counterfoil 77' });
    expect(queued.receiptNo).toBeNull();
    const approved = await oak(() => fees.approvePayment(P.ADMIN.actor, String(queued.payment._id)));
    expect(approved.payment.receiptNo).toBe(`RCPT/${fy}/000003`);
    const stored = await oak(() => Payment.findById(queued.payment._id).lean());
    // The office's own paper number is kept, but it is not the receipt number.
    expect(stored).toMatchObject({ receiptNo: `RCPT/${fy}/000003`, counterfoilNo: 'Counterfoil 77' });
  });

  it('a receipt number is unique within a school', async () => {
    await oak(() => Payment.init());
    const inv = await oak(() => makeInvoice(world.a.enrollment._id));
    await oak(() => Payment.create({ invoiceId: inv._id, amountPaise: 100, mode: 'CASH', receiptNo: 'RCPT/2026-27/000999' }));
    await expect(oak(() => Payment.create({ invoiceId: inv._id, amountPaise: 100, mode: 'CASH', receiptNo: 'RCPT/2026-27/000999' })))
      .rejects.toMatchObject({ code: 11000 });
    // Rows without a number (queued payments, old rows) do not collide.
    await oak(() => Payment.create({ invoiceId: inv._id, amountPaise: 100, mode: 'CASH' }));
    await oak(() => Payment.create({ invoiceId: inv._id, amountPaise: 100, mode: 'CASH' }));
  });

  it('the financial year turns over on 1 April, India time', () => {
    expect(financialYear(new Date('2027-03-31T18:00:00Z'))).toBe('2026-27'); // 23:30 IST 31 Mar
    expect(financialYear(new Date('2027-03-31T18:31:00Z'))).toBe('2027-28'); // 00:01 IST 1 Apr
  });
});

describe('F18: the receipt says what an Indian fee receipt has to', () => {
  it('shows the bank UTR (not the receipt number), fee heads, balance, year, admission no., cashier and the amount in words', async () => {
    await oak(() => Profile.updateOne({ _id: P.ADMIN.actor.profileId }, { $set: { displayName: 'Meena Iyer' } }));
    const inv = await oak(() => makeInvoice(world.a.enrollment._id, 5_000_000, [
      { description: 'Tuition — Term 1', amountPaise: 4_000_000 },
      { description: 'Transport — Term 1', amountPaise: 1_200_000, concessionPaise: 200_000 },
    ]));
    const paid = await pay(P.ADMIN.actor, inv._id, 1_234_567, {
      mode: 'BANK',
      instrument: { number: 'TXN-55', referenceNo: 'UTR998877', bankName: 'SBI', instrumentDate: '2026-10-10', proofUrl: '/uploads/p.pdf' },
    });
    const receipt = await oak(() => fees.getPaymentReceipt(P.ADMIN.actor, 'ALL', String(paid.payment._id)));
    expect(receipt).toMatchObject({
      transactionRef: 'UTR998877', admissionNo: 'OAK-0101', academicYear: '2026-27', receivedBy: 'Meena Iyer',
      balanceDuePaise: 5_000_000 - 1_234_567,
    });
    const c = receiptContent(receipt);
    const details = Object.fromEntries(c.details);
    expect(details['UTR / Reference']).toBe('UTR998877');
    expect(details['Admission No.']).toBe('OAK-0101');
    expect(details['Academic Year']).toBe('2026-27');
    expect(c.heads).toEqual([['Tuition — Term 1', 'INR 40,000.00'], ['Transport — Term 1', 'INR 10,000.00']]);
    expect(Object.fromEntries(c.totals)['Balance Due']).toBe('INR 37,654.33');
    expect(c.amountInWords).toBe('Rupees Twelve Thousand Three Hundred Forty Five and Sixty Seven Paise Only');
    expect(c.receivedBy).toBe('Meena Iyer');
    // With a ₹-capable font the symbol is used; never "Rs.".
    expect(receiptContent(receipt, { rupeeGlyph: true }).totals[0][1]).toBe('₹12,345.67');
  });

  it('a cash receipt is signed by the cashier, not "system-generated"', async () => {
    const inv = await oak(() => makeInvoice(world.a.enrollment._id));
    const paid = await pay(P.ADMIN.actor, inv._id, 50_000);
    const c = receiptContent(await oak(() => fees.getPaymentReceipt(P.ADMIN.actor, 'ALL', String(paid.payment._id))));
    expect(c.footer).toBeNull();
    expect(c.receivedBy).toBeTruthy();
    expect(JSON.stringify(c)).not.toMatch(/does not require a signature/);
  });

  it('amounts in words use the Indian system', () => {
    expect(amountInWords(117_680_000)).toBe('Rupees Eleven Lakh Seventy Six Thousand Eight Hundred Only');
    expect(amountInWords(1_000_000_000)).toBe('Rupees One Crore Only');
    expect(amountInWords(5)).toBe('Rupees Zero and Five Paise Only');
    expect(inr(117_680_000)).toBe('₹11,76,800.00');
  });
});

describe('F19: UPI at the counter', () => {
  it('is accepted with its 12-digit UTR and refused without one', async () => {
    const inv = await oak(() => makeInvoice(world.a.enrollment._id));
    await expect(pay(P.ADMIN.actor, inv._id, 10_000, { mode: 'UPI', instrument: { number: '12345' } }))
      .rejects.toMatchObject({ code: 'PAYMENT_DETAILS_INCOMPLETE' });
    const ok = await pay(P.ADMIN.actor, inv._id, 10_000, { mode: 'UPI', instrument: { number: '4321 0987 6543' } });
    const stored = await oak(() => Payment.findById(ok.payment._id).lean());
    expect(stored).toMatchObject({ mode: 'UPI', instrument: { number: '432109876543' } });
    const receipt = await oak(() => fees.getPaymentReceipt(P.ADMIN.actor, 'ALL', String(ok.payment._id)));
    expect(receipt.transactionRef).toBe('432109876543');
  });
});

describe('F20: s.269ST cash limit', () => {
  it('warns (does not block) when one family pays ₹2,00,000 or more in cash in a day, across siblings, and records it', async () => {
    const invA = await oak(() => makeInvoice(world.a.enrollment._id, 30_000_000));
    const invB = await oak(() => makeInvoice(world.b.enrollment._id, 30_000_000));
    const first = await pay(P.ADMIN.actor, invA._id, 15_000_000);
    expect(first.warnings).toEqual([]);
    // UPI is not cash and does not count.
    await pay(P.ADMIN.actor, invB._id, 10_000_000, { mode: 'UPI', instrument: { number: '111122223333' } });
    const second = await pay(P.ADMIN.actor, invB._id, 5_000_000);
    expect(second.recordStatus).toBe('PUBLISHED');
    expect(second.warnings).toHaveLength(1);
    expect(second.warnings[0]).toMatch(/CASH_LIMIT_269ST/);
    expect(second.warnings[0]).toMatch(/₹2,00,000\.00/);
    const stored = await oak(() => Payment.findById(second.payment._id).lean());
    expect(stored.warnings[0]).toMatch(/269ST/);
  });

  it('counts only the same India-time day', async () => {
    const inv = await oak(() => makeInvoice(world.a.enrollment._id, 30_000_000));
    await pay(P.ADMIN.actor, inv._id, 15_000_000, { paidOn: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    const today = await pay(P.ADMIN.actor, inv._id, 15_000_000);
    expect(today.warnings).toEqual([]);
  });
});

describe('F9: fee summary ignores cancelled invoices', () => {
  it('does not count a cancelled invoice as billed or unpaid', async () => {
    const live = await oak(() => makeInvoice(world.a.enrollment._id, 100_000));
    await oak(() => makeInvoice(world.b.enrollment._id, 900_000).then((i) => Invoice.updateOne({ _id: i._id }, { $set: { status: 'CANCELLED' } })));
    await pay(P.ADMIN.actor, live._id, 50_000);
    const s = await oak(() => fees.getSummary(P.ADMIN.actor, 'ALL', {}));
    expect(s).toMatchObject({ totalBilledPaise: 100_000, totalCollectedPaise: 50_000, pendingCount: 1, invoiceCount: 1, collectionPct: 50 });
  });
});
