import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * A gateway account has one webhook URL, and two kinds of order arrive on it: a
 * family paying a fee invoice, and a school buying seats. The fee ledger is
 * asked first; only when no fee intent claims the order is it offered to the
 * seat requests.
 *
 * These tests are about that dispatch — that a seat order settles when it
 * arrives, that a fee order is not diverted to the seat path, and that an order
 * belonging to neither is acknowledged rather than retried forever. Signature
 * verification is stubbed here because it is the one thing that must be true
 * *before* any of this runs, and it has its own tests in the provider.
 */

// Hoisted by vitest above the imports below, which is what lets fee.controller
// pick up the stub: it reads verifyWebhookSignature at module load.
vi.mock('../src/providers/payment.provider.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    verifyWebhookSignature: vi.fn(() => true),
    // The gateway is unreachable from a test, and asking it is a second
    // confirmation rather than the mechanism under test.
    fetchGatewayPayment: vi.fn(async (id) => ({ id, captured: true, status: 'captured', amountPaise: null })),
  };
});

const { verifyWebhookSignature, fetchGatewayPayment } = await import('../src/providers/payment.provider.js');
const { razorpayWebhook } = await import('../src/modules/fees/fee.controller.js');
const { SeatRequest, SeatAccount } = await import('../src/models/seat.model.js');
const { Invoice, Payment } = await import('../src/models/fee.model.js');
const { runWithTenant } = await import('../src/tenancy/tenantContext.js');
const { Enrollment } = await import('../src/models/student.model.js');
const seats = await import('../src/modules/seats/seat.service.js');

const OAK = 'oakridge';
const inOak = (fn) => runWithTenant(OAK, fn);

/** A minimal Express response that records what the handler sent. */
function fakeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}

const deliver = async (entity, event = 'payment.captured') => {
  const res = fakeRes();
  await razorpayWebhook(
    { headers: { 'x-razorpay-signature': 'stub' }, rawBody: '{}', ip: '203.0.113.9', body: { event, payload: { payment: { entity } } } },
    res,
    (err) => { if (err) throw err; },
  );
  return res;
};

beforeEach(() => {
  verifyWebhookSignature.mockReturnValue(true);
  fetchGatewayPayment.mockImplementation(async (id) => ({ id, captured: true, status: 'captured', amountPaise: null }));
});

/** A seat request sitting on a gateway order, the way startSeatPayment leaves one. */
async function seatOrder({ seatCount = 10, orderId = 'order_seat_1' } = {}) {
  const request = await inOak(() => seats.createSeatRequest({ profileId: null, displayName: 'Oakridge admin' }, { seats: seatCount }));
  await inOak(() => SeatRequest.updateOne(
    { _id: request.id },
    { $set: { 'payment.gatewayOrderRef': orderId, 'payment.status': 'INITIATED', 'payment.provider': 'razorpay' } },
  ));
  // The gateway will be asked to confirm; it must agree on the amount.
  fetchGatewayPayment.mockImplementation(async (id) => ({
    id, captured: true, status: 'captured', amountPaise: request.amountPaise,
  }));
  return request;
}

describe('a seat order arriving on the fees webhook', () => {
  it('settles the seat request and buys the seats', async () => {
    const request = await seatOrder();

    const res = await deliver({ order_id: 'order_seat_1', id: 'pay_seat_1', amount: request.amountPaise });

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({ handled: true, tenantId: OAK, seats: 10, status: 'PAID' });
    expect((await inOak(() => seats.getSeatRequest(request.id))).status).toBe('PAID');
  });

  it('does not release the seats — that still waits for a Super Admin', async () => {
    const request = await seatOrder();
    await deliver({ order_id: 'order_seat_1', id: 'pay_seat_1', amount: request.amountPaise });

    const account = await inOak(() => SeatAccount.findOne({ tenantId: OAK }).lean());
    expect(account.purchasedSeats).toBe(10);
    expect(account.approvedSeats).toBe(0);
    expect((await inOak(() => seats.getSeatSummary())).availableSeats).toBe(0);
  });

  it('buys the seats once however many times the gateway delivers it', async () => {
    const request = await seatOrder();
    const payload = { order_id: 'order_seat_1', id: 'pay_seat_1', amount: request.amountPaise };

    await deliver(payload);
    const second = await deliver(payload);

    expect(second.body.data).toMatchObject({ handled: true, idempotent: true });
    expect((await inOak(() => SeatAccount.findOne({ tenantId: OAK }).lean())).purchasedSeats).toBe(10);
  });

  it('is refused when the event claims an amount the request was not quoted', async () => {
    const request = await seatOrder();

    const res = await deliver({ order_id: 'order_seat_1', id: 'pay_seat_1', amount: request.amountPaise - 1 });

    expect(res.body.data).toMatchObject({ handled: false, reason: 'AMOUNT_MISMATCH' });
    expect(await inOak(() => SeatAccount.countDocuments({ tenantId: OAK }))).toBe(0);
  });
});

describe('the dispatch keeps the two ledgers apart', () => {
  it('settles a fee order through the fee ledger and never offers it to seats', async () => {
    const enrollmentId = (await inOak(() => Enrollment.create({
      studentId: '6aaa0000000000000000a001', sectionId: '6aaa0000000000000000a002',
      academicYearId: '6aaa0000000000000000a003', status: 'ACTIVE',
    })))._id;
    const invoice = await inOak(() => Invoice.create({
      enrollmentId, invoiceNo: 'INV-7001', dueOn: new Date(), totalPaise: 250000,
    }));
    await inOak(() => Payment.create({
      invoiceId: invoice._id, amountPaise: 250000, mode: 'GATEWAY',
      gatewayOrderRef: 'order_fee_1', status: 'INITIATED',
    }));
    fetchGatewayPayment.mockImplementation(async (id) => ({ id, captured: true, status: 'captured', amountPaise: 250000 }));

    const res = await deliver({ order_id: 'order_fee_1', id: 'pay_fee_1', amount: 250000 });

    expect(res.body.data).toMatchObject({ handled: true, invoiceNo: 'INV-7001', invoiceStatus: 'PAID' });
    // No seat account was touched: the fee ledger claimed the order first.
    expect(await inOak(() => SeatAccount.countDocuments({}))).toBe(0);
  });

  it('acknowledges an order neither ledger knows, rather than failing it', async () => {
    const res = await deliver({ order_id: 'order_from_elsewhere', id: 'pay_x', amount: 100 });

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({ handled: false, reason: 'No matching payment intent' });
  });

  it('refuses an unsigned delivery before looking at either ledger', async () => {
    verifyWebhookSignature.mockReturnValue(false);
    await seatOrder();

    const res = await deliver({ order_id: 'order_seat_1', id: 'pay_seat_1', amount: 500000 });

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect(await inOak(() => SeatAccount.countDocuments({}))).toBe(0);
  });
});
