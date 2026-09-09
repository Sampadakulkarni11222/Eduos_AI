import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Invoice, Payment } from '../src/models/fee.model.js';
import { recordPayment } from '../src/modules/fees/fee.service.js';

/**
 * Covers ISS-001 (non-atomic read-modify-write, no transaction) and ISS-002
 * (no overpayment guard).
 */

/**
 * An actor holding `fees.payments.approve` — an admin. Only such an actor
 * publishes a payment directly, so it is the one these ledger tests use: the
 * atomicity and overpayment behaviour being covered here is the behaviour of
 * the crediting path.
 *
 * A Finance actor (below) takes the approval path instead, which credits
 * nothing until an admin approves. That split is covered in its own describe
 * block at the end of this file.
 */
const STAFF = {
  profileId: new mongoose.Types.ObjectId().toString(),
  roleKey: 'ADMIN',
  permissions: { 'fees.pay': 'ALL', 'fees.payments.approve': 'ALL' },
};

const FINANCE = {
  profileId: new mongoose.Types.ObjectId().toString(),
  roleKey: 'FINANCE',
  permissions: { 'fees.pay': 'ALL' },
};

/** ₹500.00 invoice. Money is in paise throughout. */
const TOTAL = 50_000;

async function makeInvoice(overrides = {}) {
  return Invoice.create({
    enrollmentId: new mongoose.Types.ObjectId(),
    invoiceNo: `INV-${Math.random().toString(36).slice(2, 10)}`,
    totalPaise: TOTAL,
    paidPaise: 0,
    dueOn: new Date(),
    ...overrides,
  });
}

const pay = (invoiceId, amountPaise, extra = {}) =>
  recordPayment(STAFF, 'ALL', { invoiceId: invoiceId.toString(), amountPaise, mode: 'CASH', ...extra });

describe('recordPayment — happy path', () => {
  let invoice;
  beforeEach(async () => { invoice = await makeInvoice(); });

  it('credits the invoice and writes a matching ledger row', async () => {
    const res = await pay(invoice._id, 20_000);

    expect(res.paidPaise).toBe(20_000);
    expect(res.status).toBe('PARTIAL');

    const [stored, payments] = await Promise.all([
      Invoice.findById(invoice._id).lean(),
      Payment.find({ invoiceId: invoice._id }).lean(),
    ]);
    expect(stored.paidPaise).toBe(20_000);
    expect(stored.status).toBe('PARTIAL');
    expect(payments).toHaveLength(1);
    expect(payments[0].amountPaise).toBe(20_000);
  });

  it('marks the invoice PAID once the total is reached', async () => {
    await pay(invoice._id, 30_000);
    const res = await pay(invoice._id, 20_000);

    expect(res.paidPaise).toBe(TOTAL);
    expect(res.status).toBe('PAID');
    expect((await Invoice.findById(invoice._id).lean()).status).toBe('PAID');
  });

  it('generates a receipt number when none is supplied', async () => {
    const res = await pay(invoice._id, 1_000);
    expect(res.receiptNo).toMatch(/^RCPT-[0-9A-F]{8}$/);
  });
});

describe('recordPayment — ISS-001: concurrent payments must not lose each other', () => {
  it('applies every concurrent payment exactly once', async () => {
    const invoice = await makeInvoice();

    // The original code did `invoice.paidPaise += amount` in application
    // memory: both of these read 0 and one write clobbered the other, leaving
    // the invoice showing 25,000 while two 25,000 payment rows existed.
    const results = await Promise.allSettled([pay(invoice._id, 25_000), pay(invoice._id, 25_000)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);

    const stored = await Invoice.findById(invoice._id).lean();
    const payments = await Payment.find({ invoiceId: invoice._id }).lean();
    const ledgerTotal = payments.reduce((sum, p) => sum + p.amountPaise, 0);

    expect(stored.paidPaise).toBe(TOTAL);
    expect(stored.status).toBe('PAID');
    // The invariant that actually matters: the invoice and the ledger agree.
    expect(stored.paidPaise).toBe(ledgerTotal);
  });

  it('keeps invoice and ledger in agreement under heavier contention', async () => {
    const invoice = await makeInvoice({ totalPaise: 100_000 });

    await Promise.allSettled(Array.from({ length: 10 }, () => pay(invoice._id, 10_000)));

    const stored = await Invoice.findById(invoice._id).lean();
    const payments = await Payment.find({ invoiceId: invoice._id }).lean();
    const ledgerTotal = payments.reduce((sum, p) => sum + p.amountPaise, 0);

    expect(stored.paidPaise).toBe(ledgerTotal);
    expect(stored.paidPaise).toBeLessThanOrEqual(stored.totalPaise);
  });
});

describe('recordPayment — ISS-002: overpayment guard', () => {
  it('rejects a payment larger than the invoice total', async () => {
    const invoice = await makeInvoice();
    await expect(pay(invoice._id, TOTAL + 1)).rejects.toMatchObject({
      code: 'PAYMENT_EXCEEDS_BALANCE',
      statusCode: 409,
    });
    const stored = await Invoice.findById(invoice._id).lean();
    expect(stored.paidPaise).toBe(0);
    expect(await Payment.countDocuments({ invoiceId: invoice._id })).toBe(0);
  });

  it('rejects a payment larger than the remaining balance', async () => {
    const invoice = await makeInvoice();
    await pay(invoice._id, 40_000);
    await expect(pay(invoice._id, 20_000)).rejects.toMatchObject({ code: 'PAYMENT_EXCEEDS_BALANCE' });
    expect((await Invoice.findById(invoice._id).lean()).paidPaise).toBe(40_000);
  });

  it('rejects any further payment once fully paid', async () => {
    const invoice = await makeInvoice();
    await pay(invoice._id, TOTAL);
    await expect(pay(invoice._id, 1)).rejects.toThrow(/already fully paid/i);
  });

  it('never lets concurrent payments overshoot the total between them', async () => {
    const invoice = await makeInvoice();

    // Three racing payments of 20,000 against a 50,000 invoice: at most two can
    // be accepted. Nothing may push paidPaise past totalPaise.
    const results = await Promise.allSettled([
      pay(invoice._id, 20_000), pay(invoice._id, 20_000), pay(invoice._id, 20_000),
    ]);
    const accepted = results.filter((r) => r.status === 'fulfilled').length;

    const stored = await Invoice.findById(invoice._id).lean();
    expect(accepted).toBe(2);
    expect(stored.paidPaise).toBe(40_000);
    expect(stored.paidPaise).toBeLessThanOrEqual(TOTAL);
  });
});

describe('recordPayment — input and state validation', () => {
  let invoice;
  beforeEach(async () => { invoice = await makeInvoice(); });

  it.each([
    ['zero', 0],
    ['negative', -100],
    ['fractional paise', 10.5],
    ['not a number', 'abc'],
  ])('rejects a %s amount', async (_label, amount) => {
    await expect(pay(invoice._id, amount)).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  it('rejects an unknown payment mode before writing anything', async () => {
    await expect(
      recordPayment(STAFF, 'ALL', { invoiceId: invoice._id.toString(), amountPaise: 1_000, mode: 'CRYPTO' })
    ).rejects.toMatchObject({ code: 'INVALID_PAYMENT_MODE' });
    expect(await Payment.countDocuments({})).toBe(0);
    expect((await Invoice.findById(invoice._id).lean()).paidPaise).toBe(0);
  });

  it('refuses payment against a cancelled invoice', async () => {
    const cancelled = await makeInvoice({ status: 'CANCELLED' });
    await expect(pay(cancelled._id, 1_000)).rejects.toMatchObject({ code: 'INVOICE_CANCELLED' });
  });

  it('404s for an unknown invoice', async () => {
    await expect(pay(new mongoose.Types.ObjectId(), 1_000)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses OWN scope without reading the invoice', async () => {
    await expect(
      recordPayment({ profileId: 'p1', roleKey: 'PARENT' }, 'OWN', {
        invoiceId: invoice._id.toString(), amountPaise: 1_000, mode: 'CASH',
      })
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await Invoice.findById(invoice._id).lean()).paidPaise).toBe(0);
  });
});
