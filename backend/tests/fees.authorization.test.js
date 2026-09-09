import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Invoice, Payment } from '../src/models/fee.model.js';
import { Student, Enrollment } from '../src/models/student.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { requirePermission } from '../src/middleware/permission.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as fees from '../src/modules/fees/fee.service.js';

/**
 * Who may reach finance data, and what they may do with it.
 *
 * The money paths carry two separate controls and both are exercised here: the
 * route guard decides whether the endpoint opens at all, and the service's
 * `scope` argument decides whether a caller sees the school's ledger or only
 * its own invoices.
 */

const roleGrants = new Map(SYSTEM_ROLES.map((r) => [r.key, r.grants]));
const permsOf = (roleKey) => buildPermissionMap({ permissions: roleGrants.get(roleKey) });
const actorFor = (roleKey) => ({
  roleKey,
  profileId: new mongoose.Types.ObjectId().toString(),
  permissions: permsOf(roleKey),
});

/** Runs the real guard for a fee route and reports allow/deny. */
const canReach = (roleKey, permissionKey, minScope) => {
  const req = { actor: actorFor(roleKey) };
  try {
    requirePermission(permissionKey, minScope)(req, {}, () => {});
    return true;
  } catch {
    return false;
  }
};

const OAK = 'oakridge';
const NVMP = 'nvmp';
const inOak = (fn) => runWithTenant(OAK, fn);
const inNvmp = (fn) => runWithTenant(NVMP, fn);

/**
 * Instrument details for the modes that require them.
 *
 * Cheque, DD and bank transfer are refused server-side without a number, a
 * bank, a date and a proof image — and a transfer also without its UTR — so a
 * test recording one has to supply them —
 * which is the point of the rule, and why it is expressed here as data rather
 * than skipped.
 */
const instrumentFor = (mode) => (
  ['CHEQUE', 'DD', 'BANK'].includes(mode)
    ? {
      number: mode === 'BANK' ? 'TXN-99881' : '000123',
      referenceNo: mode === 'BANK' ? 'UTR12345678' : undefined,
      bankName: 'State Bank',
      instrumentDate: '2026-06-10',
      proofUrl: '/uploads/proof-abc.jpg',
      proofName: 'proof.jpg',
    }
    : undefined
);

const seedInvoice = async (amountPaise = 500000) => {
  const student = await Student.create({
    admissionNo: `ADM-${Math.random().toString(36).slice(2, 8)}`, firstName: 'A', lastName: 'Student',
  });
  const enrollment = await Enrollment.create({
    studentId: student._id,
    sectionId: new mongoose.Types.ObjectId(),
    academicYearId: new mongoose.Types.ObjectId(),
    status: 'ACTIVE',
  });
  return Invoice.create({
    invoiceNo: `INV-${Math.random().toString(36).slice(2, 8)}`,
    enrollmentId: enrollment._id, totalPaise: amountPaise, dueOn: new Date(),
  });
};

let oakInvoice;
let nvmpInvoice;

beforeEach(async () => {
  oakInvoice = await inOak(() => seedInvoice());
  nvmpInvoice = await inNvmp(() => seedInvoice());
});

describe('who may reach finance data at all', () => {
  it('a teacher holds no fee permission whatsoever', () => {
    expect(permsOf('TEACHER')['fees.read']).toBeUndefined();
    expect(canReach('TEACHER', 'fees.read')).toBe(false);
    expect(canReach('TEACHER', 'fees.manage')).toBe(false);
    expect(canReach('TEACHER', 'fees.pay')).toBe(false);
  });

  it('the other non-finance roles are refused too', () => {
    for (const roleKey of ['LIBRARIAN', 'WARDEN']) {
      expect(canReach(roleKey, 'fees.read'), roleKey).toBe(false);
      expect(canReach(roleKey, 'fees.manage'), roleKey).toBe(false);
    }
  });

  it('a family may read its own fees but never manage the ledger', () => {
    for (const roleKey of ['STUDENT', 'PARENT']) {
      expect(permsOf(roleKey)['fees.read'], roleKey).toBe('OWN');
      expect(canReach(roleKey, 'fees.manage'), roleKey).toBe(false);
      expect(canReach(roleKey, 'fees.structure.manage'), roleKey).toBe(false);
      expect(canReach(roleKey, 'fees.payments.refund'), roleKey).toBe(false);
      // The school-wide finance views ask for fees.read at ALL scope, which an
      // OWN grant cannot satisfy.
      expect(canReach(roleKey, 'fees.read', 'ALL'), roleKey).toBe(false);
    }
  });

  it('admin, finance and the platform actor reach the school-wide ledger', () => {
    for (const roleKey of ['SUPER_ADMIN', 'ADMIN', 'FINANCE']) {
      expect(canReach(roleKey, 'fees.read', 'ALL'), roleKey).toBe(true);
      expect(canReach(roleKey, 'fees.manage'), roleKey).toBe(true);
    }
  });

  it('finance may record a payment — the role day job', async () => {
    expect(permsOf('FINANCE')['fees.pay']).toBe('ALL');
    expect(canReach('FINANCE', 'fees.pay')).toBe(true);

    const invoice = await inOak(() => seedInvoice(150000));
    const result = await inOak(() => fees.recordPayment(actorFor('FINANCE'), 'ALL', {
      invoiceId: invoice._id.toString(), amountPaise: 150000, mode: 'CASH',
    }));

    // Recorded, but not yet money: Finance holds fees.pay, not
    // fees.payments.approve, so the row waits for an admin and the invoice is
    // untouched until then.
    expect(result.recordStatus).toBe('PENDING_ADMIN_APPROVAL');
    expect((await inOak(() => Invoice.findById(invoice._id).lean())).status).toBe('PENDING');
  });

  it('finance holds neither approval key — that is what the workflow rests on', () => {
    expect(permsOf('FINANCE')['fees.payments.approve']).toBeUndefined();
    expect(permsOf('FINANCE')['fees.plan.approve']).toBeUndefined();
    expect(canReach('FINANCE', 'fees.payments.approve', 'ALL')).toBe(false);
    expect(canReach('FINANCE', 'fees.plan.approve', 'ALL')).toBe(false);
    // But it does hold the two preparation keys.
    expect(canReach('FINANCE', 'fees.plan.request')).toBe(true);
    expect(canReach('FINANCE', 'fees.plan.review')).toBe(true);
  });

  it('an admin holds the approval keys finance does not', () => {
    expect(canReach('ADMIN', 'fees.payments.approve', 'ALL')).toBe(true);
    expect(canReach('ADMIN', 'fees.plan.approve', 'ALL')).toBe(true);
  });

  it('granting it widened nothing else for finance', () => {
    // Still no access to people, marks or medical data.
    for (const key of ['users.manage', 'marks.enter', 'medical.read']) {
      expect(canReach('FINANCE', key), key).toBe(false);
    }
  });

  it('only finance and the platform actor may refund', () => {
    expect(canReach('SUPER_ADMIN', 'fees.payments.refund')).toBe(true);
    expect(canReach('FINANCE', 'fees.payments.refund')).toBe(true);
    expect(canReach('ADMIN', 'fees.payments.refund')).toBe(false);
    expect(canReach('PRINCIPAL', 'fees.payments.refund')).toBe(false);
  });
});

describe('a family cannot write the ledger, only pay it', () => {
  it('recording a manual payment is refused at OWN scope, whatever the mode', async () => {
    for (const mode of ['CASH', 'CHEQUE', 'BANK', 'GATEWAY']) {
      await expect(
        inOak(() => fees.recordPayment(actorFor('STUDENT'), 'OWN', {
          invoiceId: oakInvoice._id.toString(), amountPaise: 100000, mode,
        })),
        mode,
      ).rejects.toThrow(/staff access/i);
    }
  });

  it('the refused attempt leaves the invoice untouched', async () => {
    await inOak(() => fees.recordPayment(actorFor('PARENT'), 'OWN', {
      invoiceId: oakInvoice._id.toString(), amountPaise: 100000, mode: 'CASH',
    })).catch(() => {});

    const after = await inOak(() => Invoice.findById(oakInvoice._id).lean());
    expect(after.paidPaise).toBe(0);
    expect(after.status).not.toBe('PAID');
    expect(await inOak(() => Payment.countDocuments())).toBe(0);
  });

  it('an unknown payment mode is rejected before anything is written', async () => {
    await expect(
      inOak(() => fees.recordPayment(actorFor('ADMIN'), 'ALL', {
        invoiceId: oakInvoice._id.toString(), amountPaise: 100000, mode: 'CRYPTO',
      })),
    ).rejects.toThrow(/mode must be one of/i);

    expect(await inOak(() => Payment.countDocuments())).toBe(0);
  });
});

describe('staff record payments in the configured modes', () => {
  it.each(['CASH', 'CHEQUE', 'DD', 'BANK'])('an admin may record a %s payment', async (mode) => {
    const invoice = await inOak(() => seedInvoice(200000));
    await inOak(() => fees.recordPayment(actorFor('ADMIN'), 'ALL', {
      invoiceId: invoice._id.toString(), amountPaise: 200000, mode, instrument: instrumentFor(mode),
    }));

    const after = await inOak(() => Invoice.findById(invoice._id).lean());
    expect(after.paidPaise).toBe(200000);
    expect(after.status).toBe('PAID');

    const payment = await inOak(() => Payment.findOne({ invoiceId: invoice._id }).lean());
    expect(payment.mode).toBe(mode);
  });
});

describe('school isolation of finance data', () => {
  it('a School Admin summary counts only its own school', async () => {
    const oak = await inOak(() => fees.getSummary(actorFor('ADMIN'), 'ALL'));
    const nvmp = await inNvmp(() => fees.getSummary(actorFor('ADMIN'), 'ALL'));

    expect(oak.invoiceCount).toBe(1);
    expect(nvmp.invoiceCount).toBe(1);
    expect(oak.totalBilledPaise).toBe(500000);
  });

  it('a School Admin cannot read another school invoice by id', async () => {
    expect(await inOak(() => Invoice.findById(nvmpInvoice._id).lean())).toBeNull();
    expect(await inOak(() => Invoice.findById(oakInvoice._id).lean())).not.toBeNull();
  });

  it('a School Admin cannot record a payment against another school invoice', async () => {
    await expect(
      inOak(() => fees.recordPayment(actorFor('ADMIN'), 'ALL', {
        invoiceId: nvmpInvoice._id.toString(), amountPaise: 100000, mode: 'CASH',
      })),
    ).rejects.toThrow(/not found/i);

    const untouched = await inNvmp(() => Invoice.findById(nvmpInvoice._id).lean());
    expect(untouched.paidPaise).toBe(0);
  });

  it('a payment recorded in one school is invisible in the other', async () => {
    await inOak(() => fees.recordPayment(actorFor('ADMIN'), 'ALL', {
      invoiceId: oakInvoice._id.toString(), amountPaise: 100000, mode: 'CASH',
    }));

    expect(await inOak(() => Payment.countDocuments())).toBe(1);
    expect(await inNvmp(() => Payment.countDocuments())).toBe(0);
  });
});

describe('only configured payment methods are advertised', () => {
  it('the summary reports whether online payment is available', async () => {
    const summary = await inOak(() => fees.getSummary(actorFor('ADMIN'), 'ALL'));
    expect(typeof summary.onlinePaymentEnabled).toBe('boolean');
  });

  it('it never leaks the gateway identity or its credentials', async () => {
    const summary = await inOak(() => fees.getSummary(actorFor('PARENT'), 'OWN'));
    const serialised = JSON.stringify(summary).toLowerCase();
    for (const secret of ['razorpay', 'key_id', 'keyid', 'secret', 'provider']) {
      expect(serialised, secret).not.toContain(secret);
    }
  });
});
