import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { seedRoles, seedPerson, inSchool, OAK } from './support/mcpSchool.js';
import { Invoice, Payment } from '../src/models/fee.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import * as fees from '../src/modules/fees/fee.service.js';
import * as approvals from '../src/modules/approvals/approval.service.js';

/**
 * F1 (critical): a refund of a payment that was never credited debited the
 * invoice, and the refunded payment could then be approved and credited again
 * (ending REFUNDED + PUBLISHED). Refunds now:
 *   - apply only to a credited (published, successful) payment;
 *   - need a reason, an amount (partial allowed, never more than unrefunded),
 *     a mode and — unless cash — a reference;
 *   - are requested by the refund-permission holder and applied only when the
 *     FEE_REFUND approval is granted by someone else, with an audit entry.
 * And approval credits only a live pending payment, never a refunded one.
 */

const oak = (fn) => inSchool(OAK, fn);
let P;

beforeEach(async () => {
  const roles = await seedRoles();
  P = {};
  for (const key of ['ADMIN', 'FINANCE', 'PRINCIPAL']) P[key] = await seedPerson({ roleKey: key, roleId: roles[key], displayName: `${key} person` });
});

const makeInvoice = (over = {}) => oak(() => Invoice.create({
  enrollmentId: new mongoose.Types.ObjectId(),
  invoiceNo: `INV-${Math.random().toString(36).slice(2, 10)}`,
  totalPaise: 2_000_000,
  paidPaise: 0,
  dueOn: new Date(Date.now() + 30 * 86_400_000),
  ...over,
}));
const pay = (actor, invoiceId, amountPaise) => oak(() => fees.recordPayment(actor, 'ALL', { invoiceId: String(invoiceId), amountPaise, mode: 'CASH' }));
const refund = (actor, paymentId, body) => oak(() => fees.requestRefund(actor, String(paymentId), body));
const decide = (actor, id, action = 'APPROVE', comment) => oak(() => approvals.decide(actor, id, { action, comment }));
const invoiceOf = (id) => oak(() => Invoice.findById(id).lean());
const paymentOf = (id) => oak(() => Payment.findById(id).lean());

describe('F1: refunds only give back money that was credited', () => {
  it('refuses to refund a payment still awaiting approval, and leaves the invoice alone', async () => {
    const inv = await makeInvoice({ paidPaise: 2_000_000, totalPaise: 4_000_000, status: 'PARTIAL' });
    const queued = await pay(P.FINANCE.actor, inv._id, 10_000);
    expect(queued.recordStatus).toBe('PENDING_ADMIN_APPROVAL');

    await expect(refund(P.FINANCE.actor, queued.payment._id, { amountPaise: 10_000, reason: 'Duplicate', mode: 'CASH' }))
      .rejects.toMatchObject({ statusCode: 409, code: 'PAYMENT_NOT_CREDITED' });
    expect((await invoiceOf(inv._id)).paidPaise).toBe(2_000_000);
  });

  it('a refunded payment can never be approved or credited again', async () => {
    const inv = await makeInvoice();
    const queued = await pay(P.FINANCE.actor, inv._id, 10_000);
    // The exact corrupt state the old code produced: still pending, but REFUNDED.
    await oak(() => Payment.updateOne({ _id: queued.payment._id }, { $set: { status: 'REFUNDED' } }));
    await expect(oak(() => fees.approvePayment(P.ADMIN.actor, String(queued.payment._id))))
      .rejects.toMatchObject({ statusCode: 409, code: 'PAYMENT_NOT_APPROVABLE' });
    const stored = await paymentOf(queued.payment._id);
    expect(stored.recordStatus).toBe('PENDING_ADMIN_APPROVAL');
    expect((await invoiceOf(inv._id)).paidPaise).toBe(0);
  });

  it('requires a reason, a valid amount, a mode and (unless cash) a reference', async () => {
    const inv = await makeInvoice();
    const paid = await pay(P.ADMIN.actor, inv._id, 10_000);
    const id = paid.payment._id;
    await expect(refund(P.FINANCE.actor, id, { amountPaise: 1_000, mode: 'CASH' })).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await expect(refund(P.FINANCE.actor, id, { amountPaise: 0, reason: 'x', mode: 'CASH' })).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    await expect(refund(P.FINANCE.actor, id, { amountPaise: 1_000, reason: 'x' })).rejects.toMatchObject({ code: 'REFUND_MODE_REQUIRED' });
    await expect(refund(P.FINANCE.actor, id, { amountPaise: 1_000, reason: 'x', mode: 'BANK' })).rejects.toMatchObject({ code: 'REFUND_REFERENCE_REQUIRED' });
    await expect(refund(P.FINANCE.actor, id, { amountPaise: 10_001, reason: 'x', mode: 'CASH' })).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_PAYMENT' });
    expect((await paymentOf(id)).refundPendingPaise).toBe(0);
  });
});

describe('F1: refund is maker-checker and partial', () => {
  it('moves nothing until approved; then debits exactly the refund, audits it, and caps further refunds', async () => {
    const inv = await makeInvoice({ totalPaise: 10_000, dueOn: new Date(Date.now() - 86_400_000) });
    const paid = await pay(P.ADMIN.actor, inv._id, 10_000);
    const id = paid.payment._id;
    expect((await invoiceOf(inv._id)).status).toBe('PAID');

    const req = await refund(P.FINANCE.actor, id, { amountPaise: 4_000, reason: 'Transport fee charged twice', mode: 'UPI', reference: '123456789012' });
    expect(req.awaitingApproval).toBe(true);
    // Reserved, not paid back.
    expect((await invoiceOf(inv._id)).paidPaise).toBe(10_000);
    expect((await paymentOf(id))).toMatchObject({ refundPendingPaise: 4_000, refundedPaise: 0, status: 'SUCCESS' });
    // A second request while one is open is refused, and gives its reservation back.
    await expect(refund(P.FINANCE.actor, id, { amountPaise: 1_000, reason: 'again', mode: 'CASH' })).rejects.toMatchObject({ code: 'APPROVAL_ALREADY_OPEN' });
    expect((await paymentOf(id)).refundPendingPaise).toBe(4_000);

    // The requester cannot approve their own refund.
    await expect(decide(P.FINANCE.actor, req.approvalRequestId)).rejects.toMatchObject({ statusCode: 403 });
    await decide(P.PRINCIPAL.actor, req.approvalRequestId);

    const afterFirst = await paymentOf(id);
    expect(afterFirst).toMatchObject({ refundedPaise: 4_000, refundPendingPaise: 0, status: 'SUCCESS' });
    expect(afterFirst.refunds[0]).toMatchObject({ status: 'COMPLETED', mode: 'UPI', reference: '123456789012' });
    expect(afterFirst.refunds[0].voucherNo).toMatch(/^RFND\/\d{4}-\d{2}\/\d{6}$/);
    const invAfter = await invoiceOf(inv._id);
    expect(invAfter).toMatchObject({ paidPaise: 6_000, status: 'PARTIAL' });

    const audit = await oak(() => AuditLog.findOne({ action: 'fees.payment.refund', entityId: String(id) }).lean());
    expect(audit).toBeTruthy();
    expect(audit.after).toMatchObject({ amountPaise: 4_000, reason: 'Transport fee charged twice' });

    // Never more than what is left unrefunded.
    await expect(refund(P.FINANCE.actor, id, { amountPaise: 6_001, reason: 'rest', mode: 'CASH' })).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_PAYMENT' });
    const rest = await refund(P.FINANCE.actor, id, { amountPaise: 6_000, reason: 'Withdrawn from transport', mode: 'CASH' });
    await decide(P.PRINCIPAL.actor, rest.approvalRequestId);
    expect((await paymentOf(id))).toMatchObject({ refundedPaise: 10_000, status: 'REFUNDED' });
    // Unpaid and past due: overdue, not forced to PENDING.
    expect(await invoiceOf(inv._id)).toMatchObject({ paidPaise: 0, status: 'OVERDUE' });
    await expect(refund(P.FINANCE.actor, id, { amountPaise: 1, reason: 'x', mode: 'CASH' })).rejects.toMatchObject({ code: 'PAYMENT_NOT_REFUNDABLE' });
  });

  it('a rejected refund releases its reservation and moves no money', async () => {
    const inv = await makeInvoice({ totalPaise: 10_000 });
    const paid = await pay(P.ADMIN.actor, inv._id, 10_000);
    const req = await refund(P.FINANCE.actor, paid.payment._id, { amountPaise: 10_000, reason: 'Parent asked', mode: 'CHEQUE', reference: 'CHQ 001122' });
    await decide(P.PRINCIPAL.actor, req.approvalRequestId, 'REJECT', 'Fees are non-refundable after the term starts');
    const stored = await paymentOf(paid.payment._id);
    expect(stored).toMatchObject({ refundPendingPaise: 0, refundedPaise: 0, status: 'SUCCESS' });
    expect(stored.refunds[0].status).toBe('REJECTED');
    expect((await invoiceOf(inv._id)).paidPaise).toBe(10_000);
  });

  it('a cancelled invoice stays cancelled when one of its payments is refunded', async () => {
    const inv = await makeInvoice({ totalPaise: 10_000 });
    const paid = await pay(P.ADMIN.actor, inv._id, 5_000);
    await oak(() => Invoice.updateOne({ _id: inv._id }, { $set: { status: 'CANCELLED' } }));
    const req = await refund(P.FINANCE.actor, paid.payment._id, { amountPaise: 5_000, reason: 'Invoice cancelled', mode: 'CASH' });
    await decide(P.PRINCIPAL.actor, req.approvalRequestId);
    expect(await invoiceOf(inv._id)).toMatchObject({ paidPaise: 0, status: 'CANCELLED' });
  });
});
