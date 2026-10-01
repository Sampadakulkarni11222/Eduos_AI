import crypto from 'crypto';
import { SeatAccount, SeatRequest, SeatLedgerEntry } from '../../models/seat.model.js';
import { Profile } from '../../models/profile.model.js';
import { School } from '../../models/school.model.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { runInAmbientTransaction, runInTransaction } from '../../utils/transaction.js';
import { currentTenantId, tenantFilter, runWithTenant } from '../../tenancy/tenantContext.js';
import {
  chargeOnline,
  isOnlinePaymentEnabled,
  fetchGatewayPayment,
  verifyCheckoutSignature,
} from '../../providers/payment.provider.js';
import { env } from '../../config/env.js';
import { quoteSeats } from './seat.pricing.js';
import { resolveSeatPrice, seatPriceList } from './seatPrice.service.js';

/**
 * Seat management, and the approval a school's extra seats have to pass.
 *
 * The flow this file implements, end to end:
 *
 *   purchase -> approved -> used -> available
 *     -> School Admin asks for extra seats
 *     -> the SERVER prices them
 *     -> payment
 *     -> the gateway confirms it
 *     -> the request becomes PAID
 *     -> a Super Admin approves or rejects
 *     -> only an approval makes the seats usable
 *
 * Two rules do most of the work, and both are structural rather than advisory:
 *
 *  1. Payment increments `purchasedSeats`; approval increments `approvedSeats`;
 *     enforcement reads `approvedSeats` alone. A paid-but-unapproved request
 *     therefore cannot let anybody in, however the code around it is called.
 *  2. Every price is produced by seat.pricing.js from the seat count stored on
 *     the request. No amount from a client is read, anywhere in this file.
 *
 * Tenancy is the plugin's, not this file's: SeatAccount, SeatRequest and
 * SeatLedgerEntry are all `tenantScoped`, so a School Admin's every query here
 * is confined to their own school by the same mechanism that confines students
 * and invoices. The platform's cross-school reads run unscoped, and every
 * platform *write* re-enters the target school's context explicitly with
 * runWithTenant(), so a decision can never be recorded against the wrong one.
 */

const SEAT_REQUEST_OPEN = ['PENDING_PAYMENT', 'PAID'];
const SEAT_REQUEST_STATUSES = ['PENDING_PAYMENT', 'PAID', 'APPROVED', 'REJECTED'];

/** The school this call is acting on, or a 400 telling the caller to name one. */
function actingSchool() {
  const tenantId = currentTenantId();
  if (!tenantId) {
    throw new AppError(
      'Name the school to act on — a platform-level call must choose one.',
      400, [], 'SCHOOL_REQUIRED',
    );
  }
  return tenantId;
}

/**
 * The seat account for a school, created on first use.
 *
 * Upserted rather than read-then-created: two movements arriving together would
 * otherwise both find nothing and both insert. The unique index on `tenantId`
 * is the backstop, and `$setOnInsert` leaves an existing balance untouched.
 *
 * Called only from moveSeats() — that is, only when seats actually move. Reads
 * must NOT provision: a school with no account is unlimited, so creating one
 * behind a screen that merely *looked* at the seat page would silently cap that
 * school at zero seats and stop it creating users.
 */
async function accountFor(tenantId, session = null) {
  // `session` is not optional in practice: inside a transaction this write must
  // join it. A non-session write to a document the open transaction also
  // touches conflicts with it, and `withTransaction` retries a conflict — so the
  // retry re-runs the same unsessioned write and conflicts again, forever.
  const options = session ? { upsert: true, session } : { upsert: true };
  await SeatAccount.updateOne(
    { tenantId },
    { $setOnInsert: { tenantId, purchasedSeats: 0, approvedSeats: 0 } },
    options,
  );
  return SeatAccount.findOne({ tenantId })
    .session(session ?? null)
    .lean();
}

/**
 * Seats currently in use.
 *
 * A seat is a person who can sign in to the school: one active, non-deleted
 * profile. Counted live from the profiles rather than kept as a third counter,
 * because a counter that must be decremented on every deletion, transfer and
 * soft-delete is a counter that eventually disagrees with reality — and a
 * school locked out by a stale number is a support call, not a bug report.
 */
export async function usedSeats() {
  return Profile.countDocuments({ ...tenantFilter(), status: 'ACTIVE', deletedAt: null });
}

const summaryOf = (tenantId, account, used, pending) => {
  const approved = account?.approvedSeats ?? 0;
  const purchased = account?.purchasedSeats ?? 0;
  return {
    tenantId,
    purchasedSeats: purchased,
    approvedSeats: approved,
    usedSeats: used,
    // Never negative: a school whose staff outgrew a later-reduced approval is
    // at zero available, not at "-3 available".
    availableSeats: Math.max(approved - used, 0),
    // Paid for, not yet released. This is the number that makes the difference
    // between purchased and approved legible on a screen.
    awaitingApprovalSeats: Math.max(purchased - approved, 0),
    pendingRequestCount: pending.count,
    pendingRequestSeats: pending.seats,
    provisioned: Boolean(account),
    updatedAt: account?.updatedAt ?? null,
  };
};

async function pendingTotals() {
  const [row] = await SeatRequest.aggregate([
    { $match: { status: { $in: SEAT_REQUEST_OPEN } } },
    { $group: { _id: null, count: { $sum: 1 }, seats: { $sum: '$seats' } } },
  ]);
  return { count: row?.count ?? 0, seats: row?.seats ?? 0 };
}

/** The acting school's seat position. What the School Admin's summary shows. */
export async function getSeatSummary() {
  const tenantId = actingSchool();
  const [account, used, pending] = await Promise.all([
    SeatAccount.findOne({ tenantId }).lean(),
    usedSeats(),
    pendingTotals(),
  ]);
  // The price list is this school's own rate when the platform has priced it
  // specifically — the same rate a request will be quoted at, from the same
  // resolver, so the screen and the charge cannot disagree.
  return { ...summaryOf(tenantId, account, used, pending), priceList: await seatPriceList(tenantId) };
}

/**
 * Every school's seat position — the Super Admin's seat management page.
 *
 * Each school's counts run inside that school's own tenant context, so the
 * profile count is produced by exactly the query its School Admin would run.
 */
export async function listSchoolSeatSummaries() {
  const schools = await School.find().sort({ slug: 1 }).lean();
  return Promise.all(
    schools.map(async (school) =>
      runWithTenant(school.slug, async () => {
        const [account, used, pending, rate] = await Promise.all([
          SeatAccount.findOne({ tenantId: school.slug }).lean(),
          usedSeats(),
          pendingTotals(),
          resolveSeatPrice(school.slug),
        ]);
        return {
          ...summaryOf(school.slug, account, used, pending),
          tenantName: school.name,
          status: school.status,
          unitPricePaise: rate.unitPricePaise,
          currency: rate.currency,
          priceSource: rate.source,
        };
      }),
    ),
  );
}

/* ── Seat history ─────────────────────────────────────────── */

const ledgerDto = (e) => ({
  id: e._id.toString(),
  tenantId: e.tenantId,
  event: e.event,
  purchasedDelta: e.purchasedDelta,
  approvedDelta: e.approvedDelta,
  purchasedAfter: e.purchasedAfter,
  approvedAfter: e.approvedAfter,
  amountPaise: e.amountPaise ?? null,
  unitPricePaise: e.unitPricePaise ?? null,
  currency: e.currency ?? null,
  requestId: e.requestId ? e.requestId.toString() : null,
  actor: e.actorName ?? null,
  note: e.note ?? null,
  at: e.createdAt,
});

/**
 * The seat history for whichever school is in context.
 *
 * Tenant-scoped like everything else here: a School Admin gets their own
 * school's history and cannot ask for another's, because the plugin rewrites
 * the query before it runs.
 */
export async function listSeatHistory({ limit } = {}) {
  const requested = Number(limit);
  const take = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 200) : 50;
  const rows = await SeatLedgerEntry.find().sort({ createdAt: -1 }).limit(take).lean();
  return rows.map(ledgerDto);
}

/**
 * Moves the counters and records the movement in one step.
 *
 * `$inc` rather than a read-modify-write, so concurrent movements add up
 * instead of overwriting one another, and the ledger row is written from the
 * *returned* document — the balances it reports are the ones the increment
 * actually produced, not the ones the caller expected.
 */
async function moveSeats({
  tenantId, purchasedDelta = 0, approvedDelta = 0, event,
  requestId = null, amountPaise = null, unitPricePaise = null, currency = null,
  actor = null, note = null, session = null,
}) {
  await accountFor(tenantId, session);
  // A negative movement carries its own floor in the filter, so the check and
  // the decrement are one atomic operation. Checking the balance first and then
  // decrementing let two concurrent corrections both pass the check and take
  // the school below zero; with the floor here, the second finds no document.
  const floor = {};
  if (purchasedDelta < 0) floor.purchasedSeats = { $gte: -purchasedDelta };
  if (approvedDelta < 0) floor.approvedSeats = { $gte: -approvedDelta };
  const account = await SeatAccount.findOneAndUpdate(
    { tenantId, ...floor },
    { $inc: { purchasedSeats: purchasedDelta, approvedSeats: approvedDelta } },
    { new: true, ...(session ? { session } : {}) },
  );
  if (!account) {
    throw new AppError('That correction would take the school below zero seats', 400, [], 'SEAT_BALANCE_NEGATIVE');
  }

  const [entry] = await SeatLedgerEntry.create(
    [{
      tenantId,
      event,
      purchasedDelta,
      approvedDelta,
      purchasedAfter: account.purchasedSeats,
      approvedAfter: account.approvedSeats,
      requestId,
      amountPaise,
      unitPricePaise,
      currency,
      actorProfileId: actor?.profileId ?? null,
      actorName: actor?.displayName ?? null,
      note,
    }],
    session ? { session } : {},
  );

  return { account, entry };
}

/**
 * Sells a school its base seats, or corrects a balance.
 *
 * The platform's own act, not the school's: these seats are purchased and
 * approved in one movement, because the person performing it is the person who
 * would otherwise have approved them. `seats` may be negative to correct an
 * overcount.
 */
export async function grantSeats(actor, slug, { seats, note, event = 'PURCHASE' } = {}) {
  const school = await School.findOne({ slug: String(slug ?? '').trim().toLowerCase() }).lean();
  if (!school) throw new AppError(`No school with id "${slug}"`, 404, [], 'SCHOOL_NOT_FOUND');

  const delta = Number(seats);
  if (!Number.isInteger(delta) || delta === 0) {
    throw new AppError('seats must be a non-zero whole number', 400, [], 'INVALID_SEAT_COUNT');
  }
  if (!['PURCHASE', 'ADJUSTMENT'].includes(event)) {
    throw new AppError('event must be PURCHASE or ADJUSTMENT', 400);
  }

  const current = await runWithTenant(school.slug, () => accountFor(school.slug));
  if (current.approvedSeats + delta < 0 || current.purchasedSeats + delta < 0) {
    throw new AppError('That correction would take the school below zero seats', 400, [], 'SEAT_BALANCE_NEGATIVE');
  }

  const { account } = await runWithTenant(school.slug, () =>
    moveSeats({
      tenantId: school.slug, purchasedDelta: delta, approvedDelta: delta,
      event, actor, note: note ?? null,
    }),
  );

  await recordAudit({
    actor,
    action: `seats.${event === 'PURCHASE' ? 'purchased' : 'adjusted'}`,
    entityType: 'SeatAccount',
    entityId: school.slug,
    before: { purchasedSeats: current.purchasedSeats, approvedSeats: current.approvedSeats },
    after: {
      purchasedSeats: account.purchasedSeats, approvedSeats: account.approvedSeats,
      seats: delta, note: note ?? null,
    },
  });

  return runWithTenant(school.slug, async () => {
    const [used, pending] = await Promise.all([usedSeats(), pendingTotals()]);
    return { ...summaryOf(school.slug, account.toObject(), used, pending), tenantName: school.name };
  });
}

/* ── Enforcement ──────────────────────────────────────────── */

/**
 * Refuses to let a school exceed the seats it has been *approved* for.
 *
 * Called from user creation. Deliberately silent for a school with no seat
 * account: seats are a commercial arrangement, and a deployment that has never
 * sold any must keep working exactly as it did rather than locking every
 * school out the moment this file ships. Once a school has an account, the
 * limit is real.
 */
export async function assertSeatAvailable({ seats = 1 } = {}) {
  const tenantId = currentTenantId();
  if (!tenantId) return; // seeds, migrations, platform-level work

  const account = await SeatAccount.findOne({ tenantId }).lean();
  if (!account) return;
  await refuseUnlessSeatsFree(account, seats);
}

/** Throws NO_SEATS_AVAILABLE unless `seats` more fit inside the approved seats. */
async function refuseUnlessSeatsFree(account, seats) {
  const used = await usedSeats();
  if (account.approvedSeats - used < seats) {
    throw new AppError(
      `This school has no seats left: ${used} of ${account.approvedSeats} approved seats are in use. ` +
        (account.purchasedSeats > account.approvedSeats
          ? 'Extra seats have been paid for and are waiting for platform approval.'
          : 'Request extra seats to add more people.'),
      409, [], 'NO_SEATS_AVAILABLE',
    );
  }
}

/**
 * Runs `consume` — the creation of whatever occupies a seat — only if a seat is
 * free, and makes the check and the creation one atomic step.
 *
 * Why a check on its own is not enough: seats in use are COUNTED from profiles
 * rather than kept as a counter, so there is no single document a creation
 * changes that a condition could guard. Two creations for the last seat each
 * counted the same profiles, each found one seat free, and each created a user.
 *
 * The fix is a transaction that begins by writing the school's SeatAccount:
 *
 *   1. bump `reservationVersion` on the account   (takes the document)
 *   2. count the seats in use                      (reads after taking it)
 *   3. refuse, or run `consume`                    (creates the profile)
 *   4. commit
 *
 * MongoDB lets only one open transaction write a document. A second creation
 * reaching step 1 while the first is open gets a write conflict, and a conflict
 * is a transient error, so the whole callback is retried — starting a fresh
 * snapshot that includes the first creation's committed profile. Its count at
 * step 2 is therefore one higher, and it is refused cleanly with
 * NO_SEATS_AVAILABLE. Exactly one creation takes the last seat, whatever the
 * timing.
 *
 * Every Mongoose operation inside `consume` joins the same transaction (see
 * runInAmbientTransaction), so a failure anywhere in it — a duplicate phone, a
 * duplicate admission number — rolls back the account and profile it had
 * already written, and nothing is left occupying a seat.
 *
 * Unchanged from before:
 *   - a caller with no school (seeds, platform work) runs `consume` directly;
 *   - a school with no seat account is unlimited: step 1 finds no document and
 *     step 2 is skipped, though `consume` still runs transactionally;
 *   - purchased, approved and the payment and approval paths are untouched —
 *     `reservationVersion` is the only field this writes.
 */
export async function withSeatReserved(consume, { seats = 1 } = {}) {
  const tenantId = currentTenantId();
  if (!tenantId) return consume();

  return runInAmbientTransaction(async () => {
    const account = await SeatAccount.findOneAndUpdate(
      { tenantId },
      { $inc: { reservationVersion: 1 } },
      { new: true },
    ).lean();
    if (account) await refuseUnlessSeatsFree(account, seats);
    return consume();
  });
}

/* ── Requests ─────────────────────────────────────────────── */

const requestDto = (r) => ({
  id: r._id.toString(),
  tenantId: r.tenantId,
  seats: r.seats,
  unitPricePaise: r.unitPricePaise,
  discountPct: r.discountPct,
  amountPaise: r.amountPaise,
  currency: r.currency,
  priceListVersion: r.priceListVersion,
  seatPriceId: r.seatPriceId ? r.seatPriceId.toString() : null,
  priceSource: r.priceSource ?? 'PLATFORM_DEFAULT',
  pricedAt: r.pricedAt ?? r.createdAt,
  status: r.status,
  paymentStatus: r.payment?.status ?? 'UNPAID',
  paymentProvider: r.payment?.provider ?? null,
  gatewayOrderRef: r.payment?.gatewayOrderRef ?? null,
  gatewayRef: r.payment?.gatewayRef ?? null,
  receiptNo: r.payment?.receiptNo ?? null,
  paidAt: r.payment?.paidAt ?? null,
  paymentFailureReason: r.payment?.failureReason ?? null,
  requestedBy: r.requestedByName ?? null,
  requestedByProfileId: r.requestedByProfileId ? r.requestedByProfileId.toString() : null,
  reason: r.reason ?? null,
  decidedBy: r.decidedByName ?? null,
  decidedAt: r.decidedAt ?? null,
  decisionNote: r.decisionNote ?? null,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/**
 * Raises an extra-seat request for the acting school.
 *
 * The caller sends a seat count and nothing else that matters: the amount, the
 * unit price and the discount are all computed here, from this school's own
 * per-seat price. A body carrying `amountPaise` is not rejected for form's sake
 * — it is simply never read, which is the stronger guarantee.
 *
 * The rate is resolved once, here, and every figure it produces is written onto
 * the request. From this moment the request carries its own price: repricing
 * the school, or deactivating the very version used, changes nothing about what
 * this request costs.
 */
export async function createSeatRequest(actor, { seats, reason } = {}) {
  const tenantId = actingSchool();
  const rate = await resolveSeatPrice(tenantId);
  const quote = quoteSeats(seats, rate);
  const note = reason === undefined || reason === null ? null : String(reason).trim().slice(0, 500) || null;

  const request = await SeatRequest.create({
    tenantId,
    seats: quote.seats,
    unitPricePaise: quote.unitPricePaise,
    discountPct: quote.discountPct,
    amountPaise: quote.amountPaise,
    currency: quote.currency,
    priceListVersion: quote.priceListVersion,
    seatPriceId: rate.seatPriceId,
    priceSource: rate.source,
    pricedAt: new Date(),
    status: 'PENDING_PAYMENT',
    payment: { status: 'UNPAID' },
    requestedByProfileId: actor?.profileId ?? null,
    requestedByName: actor?.displayName ?? null,
    reason: note,
  });

  await recordAudit({
    actor,
    action: 'seats.request.created',
    entityType: 'SeatRequest',
    entityId: request._id,
    after: {
      tenantId, seats: quote.seats, amountPaise: quote.amountPaise, status: 'PENDING_PAYMENT',
      unitPricePaise: quote.unitPricePaise, currency: quote.currency, priceSource: rate.source,
    },
  });

  return requestDto(request.toObject());
}

/** One request, confined to whatever school the caller is acting in. */
export async function getSeatRequest(requestId) {
  const request = await SeatRequest.findById(requestId).lean();
  if (!request) throw new AppError('Seat request not found', 404, [], 'SEAT_REQUEST_NOT_FOUND');
  return requestDto(request);
}

/**
 * Seat requests, newest first.
 *
 * A School Admin sees their own school's, because the plugin filters the query.
 * A Super Admin running unscoped sees the platform's, and may narrow it with
 * `tenantId` — a filter on a list they already hold, not a way for anybody else
 * to reach another school.
 */
export async function listSeatRequests({ status, tenantId, limit } = {}) {
  const filter = {};
  if (status) {
    const wanted = String(status).trim().toUpperCase();
    if (!SEAT_REQUEST_STATUSES.includes(wanted)) {
      throw new AppError(`status must be one of ${SEAT_REQUEST_STATUSES.join(', ')}`, 400);
    }
    filter.status = wanted;
  }
  // Honoured only where the caller is already unscoped; for a school-level
  // actor the plugin has pinned tenantId and will not let this widen it.
  if (tenantId && !currentTenantId()) filter.tenantId = String(tenantId).trim().toLowerCase();

  const requested = Number(limit);
  const take = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 200) : 100;

  const rows = await SeatRequest.find(filter).sort({ createdAt: -1 }).limit(take).lean();
  return rows.map(requestDto);
}

/* ── Payment ──────────────────────────────────────────────── */

const receipt = () => `SEAT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

/**
 * Starts payment for a seat request.
 *
 * The amount handed to the gateway is the one stored on the request, and it is
 * re-derived from the stored seat count first — so a stored amount that no
 * longer follows from the seat count is refused rather than charged. Nothing
 * from the request body is read here at all.
 *
 * Asking twice does not create two orders: an order already attached to a
 * still-unpaid request is handed back as it stands, so an abandoned checkout
 * leaves one intent rather than one per click.
 */
export async function startSeatPayment(actor, requestId) {
  if (!isOnlinePaymentEnabled()) {
    throw new AppError('Online payments are not enabled on this deployment.', 501, [], 'PAYMENTS_DISABLED');
  }

  const request = await SeatRequest.findById(requestId);
  if (!request) throw new AppError('Seat request not found', 404, [], 'SEAT_REQUEST_NOT_FOUND');
  if (request.status === 'APPROVED' || request.status === 'REJECTED') {
    throw new AppError('This request has already been decided', 409, [], 'SEAT_REQUEST_DECIDED');
  }
  if (request.status === 'PAID') {
    throw new AppError('This request has already been paid for', 409, [], 'SEAT_REQUEST_ALREADY_PAID');
  }

  // Re-derived from the request's OWN snapshot — its seat count at its own
  // quoted unit price — not from whatever the school is priced at today. A
  // request is charged what it was quoted: repricing the school between the
  // request and the payment must not change the figure the admin agreed to, and
  // must not block the payment either. What this does catch is a stored amount
  // that its own seats and unit price cannot produce, which is tampering or
  // corruption rather than a price change.
  const quote = quoteSeats(request.seats, {
    unitPricePaise: request.unitPricePaise,
    currency: request.currency,
  });
  if (quote.amountPaise !== request.amountPaise) {
    logger.error(
      `Seat request ${request._id} has an amount its own snapshot does not produce ` +
        `(${request.seats} × ${request.unitPricePaise} → ${quote.amountPaise}, stored ${request.amountPaise}) — refusing to charge`,
    );
    throw new AppError('This request could not be priced. Raise it again.', 409, [], 'SEAT_PRICE_MISMATCH');
  }
  const amountPaise = request.amountPaise;

  if (request.payment?.gatewayOrderRef && request.payment.status === 'INITIATED') {
    return {
      requiresClientAction: true,
      requestId: request._id.toString(),
      provider: request.payment.provider,
      orderId: request.payment.gatewayOrderRef,
      keyId: env.RAZORPAY_KEY_ID,
      currency: request.currency,
      amountPaise,
      seats: request.seats,
      reused: true,
    };
  }

  const charge = await chargeOnline({
    amountPaise,
    // The snapshot's currency, so a school priced in its own money is billed in
    // it rather than in whatever the deployment defaults to.
    currency: request.currency,
    invoiceNo: `SEATS-${request._id.toString().slice(-8).toUpperCase()}`,
    payerProfileId: actor?.profileId,
  });

  if (charge.requiresClientAction) {
    request.payment.status = 'INITIATED';
    request.payment.provider = charge.provider;
    request.payment.mode = 'GATEWAY';
    request.payment.gatewayOrderRef = charge.order.orderId;
    request.payment.gatewayRef = charge.gatewayRef;
    await request.save();

    await recordAudit({
      actor,
      action: 'seats.request.payment.initiated',
      entityType: 'SeatRequest',
      entityId: request._id,
      after: {
        orderId: charge.order.orderId, amountPaise, currency: request.currency,
        unitPricePaise: request.unitPricePaise, provider: charge.provider,
      },
    });

    return {
      requiresClientAction: true,
      requestId: request._id.toString(),
      provider: charge.provider,
      orderId: charge.order.orderId,
      keyId: charge.order.keyId,
      currency: charge.order.currency,
      amountPaise: charge.order.amountPaise,
      seats: request.seats,
    };
  }

  if (!charge.captured) {
    request.payment.status = 'FAILED';
    request.payment.provider = charge.provider ?? null;
    request.payment.failureReason = charge.error ?? 'Payment could not be processed';
    await request.save();
    throw new AppError(charge.error ?? 'Payment could not be processed', 502, [], charge.code ?? 'PAYMENT_FAILED');
  }

  // The sandbox captures synchronously. It still settles through the same
  // function the webhook uses, so the sandbox path cannot acquire a shortcut
  // the real one does not have — including the claim that makes it idempotent.
  request.payment.status = 'INITIATED';
  request.payment.provider = charge.provider;
  request.payment.mode = 'GATEWAY';
  request.payment.gatewayOrderRef = charge.gatewayRef;
  await request.save();

  const settled = await settleSeatPayment({
    event: 'payment.captured',
    orderId: charge.gatewayRef,
    gatewayPaymentId: charge.gatewayRef,
    amountPaise,
    verifyWithGateway: false,
    actor,
  });
  if (!settled.handled) {
    throw new AppError('Payment could not be confirmed', 502, [], settled.reason ?? 'PAYMENT_UNCONFIRMED');
  }

  return {
    requiresClientAction: false,
    requestId: request._id.toString(),
    provider: charge.provider,
    sandbox: charge.provider === 'sandbox',
    receiptNo: settled.receiptNo,
    amountPaise,
    seats: request.seats,
    status: 'PAID',
  };
}

/**
 * Settles a seat payment the gateway has confirmed.
 *
 * Signature verification happens in the controller, before this is reached;
 * never call it with unverified input. Three things make repeated delivery
 * safe, and they are the same three the fee ledger relies on:
 *
 *  1. The amount is taken from the request we created, and a payload claiming a
 *     different one is refused rather than reconciled.
 *  2. PENDING_PAYMENT -> PAID is claimed atomically, so only one delivery ever
 *     moves the counter. A retry finds nothing to claim and says so.
 *  3. The seat counters move with `$inc`, so two schools settling at once
 *     cannot overwrite each other.
 *
 * And the thing deliberately NOT here: no approval, and no change to
 * `approvedSeats`. Money buys seats; it does not release them.
 */
export async function settleSeatPayment({
  event, orderId, gatewayPaymentId, amountPaise, verifyWithGateway = true, actor = null,
}) {
  if (event && event !== 'payment.captured') {
    return { handled: false, reason: `Ignoring unhandled event: ${event}` };
  }
  if (!orderId) return { handled: false, reason: 'Event carried no order id' };

  const request = await SeatRequest.findOne({ 'payment.gatewayOrderRef': orderId }).lean();
  if (!request) return { handled: false, reason: 'No matching seat request' };

  if (request.status !== 'PENDING_PAYMENT') {
    return {
      handled: true, idempotent: true, requestId: request._id.toString(),
      status: request.status, receiptNo: request.payment?.receiptNo ?? null,
      reason: 'Already settled',
    };
  }

  if (Number(amountPaise) !== Number(request.amountPaise)) {
    logger.error(
      `Seat payment amount mismatch on order ${orderId}: event=${amountPaise} request=${request.amountPaise} — refusing to settle`,
    );
    await SeatRequest.updateOne(
      { _id: request._id },
      { $set: { 'payment.status': 'FAILED', 'payment.failureReason': 'Amount did not match the order' } },
    );
    return { handled: false, reason: 'AMOUNT_MISMATCH', expected: request.amountPaise, received: Number(amountPaise) };
  }

  if (verifyWithGateway && gatewayPaymentId) {
    try {
      const live = await fetchGatewayPayment(gatewayPaymentId);
      if (!live.captured) return { handled: false, reason: `Gateway reports status "${live.status}", not captured` };
      if (Number(live.amountPaise) !== Number(request.amountPaise)) {
        return { handled: false, reason: 'AMOUNT_MISMATCH_AT_GATEWAY' };
      }
    } catch (err) {
      logger.error(`Could not confirm seat payment ${gatewayPaymentId}: ${err.message}`);
      return { handled: false, reason: 'GATEWAY_UNREACHABLE' };
    }
  }

  const receiptNo = request.payment?.receiptNo ?? receipt();
  // The claim and the counter movement commit together, as the decision's do.
  // Separately, a failure between them left the request PAID with no purchased
  // seats behind it — and every retry then saw "already settled" and moved
  // nothing, so the seats were lost for good. In one transaction, a failure
  // rolls the claim back and the gateway's retry settles it properly.
  const claimed = await runInTransaction(async (session) => {
    // Only the delivery that flips PENDING_PAYMENT -> PAID moves the purchased
    // counter; every other delivery finds nothing to claim.
    const won = await SeatRequest.findOneAndUpdate(
      { _id: request._id, status: 'PENDING_PAYMENT' },
      {
        $set: {
          status: 'PAID',
          'payment.status': 'PAID',
          'payment.gatewayRef': gatewayPaymentId ?? request.payment?.gatewayRef ?? null,
          'payment.gatewayOrderRef': orderId,
          'payment.receiptNo': receiptNo,
          'payment.paidAt': new Date(),
          'payment.failureReason': null,
        },
      },
      { new: true, ...(session ? { session } : {}) },
    );
    if (!won) return null;

    // Purchased, not approved. The seats are now the school's property and
    // still unusable, which is exactly the state this feature exists to represent.
    await runWithTenant(won.tenantId, () =>
      moveSeats({
        tenantId: won.tenantId,
        purchasedDelta: won.seats,
        approvedDelta: 0,
        event: 'EXTRA_SEATS_PAID',
        requestId: won._id,
        amountPaise: won.amountPaise,
        unitPricePaise: won.unitPricePaise,
        currency: won.currency,
        actor,
        note: `Payment ${receiptNo} received; awaiting platform approval`,
        session,
      }),
    );
    return won;
  });

  if (!claimed) {
    return {
      handled: true, idempotent: true, requestId: request._id.toString(),
      reason: 'Concurrent delivery already settled this request',
    };
  }

  await recordAudit({
    actor,
    action: 'seats.request.paid',
    entityType: 'SeatRequest',
    entityId: claimed._id,
    before: { status: 'PENDING_PAYMENT', paymentStatus: request.payment?.status ?? 'UNPAID' },
    after: {
      tenantId: claimed.tenantId, status: 'PAID', paymentStatus: 'PAID',
      seats: claimed.seats, amountPaise: claimed.amountPaise, receiptNo,
      unitPricePaise: claimed.unitPricePaise, currency: claimed.currency,
      gatewayRef: gatewayPaymentId ?? null,
    },
    channel: actor ? 'WEB' : 'SYSTEM',
  });

  logger.info(`Seat payment settled: ${claimed.seats} seats for ${claimed.tenantId} (${receiptNo}) — awaiting approval`);

  return {
    handled: true,
    requestId: claimed._id.toString(),
    tenantId: claimed.tenantId,
    seats: claimed.seats,
    amountPaise: claimed.amountPaise,
    receiptNo,
    status: 'PAID',
  };
}

/**
 * Confirms a checkout the payer just completed in the browser.
 *
 * A latency shortcut, not a second way to pay: the Checkout signature is
 * verified and then settlement runs through settleSeatPayment(), with the same
 * amount check and the same atomic claim. Racing the webhook is therefore
 * harmless — one settles, the other reports itself idempotent.
 */
export async function verifySeatCheckout(actor, { orderId, paymentId, signature } = {}) {
  if (!orderId || !paymentId || !signature) {
    throw new AppError('orderId, paymentId and signature are required', 400);
  }
  if (!verifyCheckoutSignature({ orderId, paymentId, signature })) {
    logger.warn(`Rejected seat checkout callback with a bad signature for order ${orderId}`);
    throw new AppError('Payment could not be verified', 400, [], 'CHECKOUT_SIGNATURE_INVALID');
  }

  // Runs in the caller's tenant context, so a School Admin can only confirm an
  // order belonging to a request of their own school.
  const request = await SeatRequest.findOne({ 'payment.gatewayOrderRef': orderId }).lean();
  if (!request) throw new AppError('No seat request found for that order', 404, [], 'SEAT_REQUEST_NOT_FOUND');

  const result = await settleSeatPayment({
    event: 'payment.captured',
    orderId,
    gatewayPaymentId: paymentId,
    amountPaise: request.amountPaise,
    actor,
  });

  if (!result.handled) {
    throw new AppError(
      result.reason === 'GATEWAY_UNREACHABLE'
        ? 'Your payment is being confirmed. The request will show as paid shortly.'
        : 'Payment could not be confirmed.',
      502, [], result.reason ?? 'PAYMENT_UNCONFIRMED',
    );
  }
  return result;
}

/* ── The decision ─────────────────────────────────────────── */

/**
 * The Super Admin's decision on a paid request.
 *
 * Everything this feature promises meets here, so each rule is checked rather
 * than assumed:
 *
 *   unpaid            refused — 409. Approval cannot precede payment.
 *   already decided   refused — 409, and the atomic claim means two
 *                     simultaneous approvals produce one approval and one 409,
 *                     never two allocations of the same seats.
 *   own school        refused — 403. The permission is Super-Admin-only, but a
 *                     platform account that also holds a profile in the school
 *                     would otherwise be deciding its own request, and
 *                     separation of duties should not rest on nobody having
 *                     done that.
 *
 * Only the approval branch touches `approvedSeats`, and it does so in the same
 * transaction as the status change, so a school can never end up with released
 * seats and an undecided request.
 */
export async function decideSeatRequest(actor, requestId, { decision, note } = {}) {
  const verdict = String(decision ?? '').trim().toUpperCase();
  if (!['APPROVED', 'REJECTED'].includes(verdict)) {
    throw new AppError('decision must be APPROVED or REJECTED', 400, [], 'INVALID_DECISION');
  }
  const decisionNote = note === undefined || note === null ? null : String(note).trim().slice(0, 500) || null;

  const request = await SeatRequest.findById(requestId).lean();
  if (!request) throw new AppError('Seat request not found', 404, [], 'SEAT_REQUEST_NOT_FOUND');

  // Two ways to be the school that raised it: belonging to it, and — for a
  // platform administrator — having opened it, which is what `actingSchoolId`
  // records (see middleware/auth.js). Deciding is a platform act, so it has to
  // be made from outside the school, not from inside its console.
  const actingAs = [actor?.tenantId, actor?.actingSchoolId].filter(Boolean).map(String);
  if (actingAs.includes(String(request.tenantId))) {
    throw new AppError(
      'A seat request cannot be decided by the school that raised it. Leave the school view and decide it from the platform console.',
      403, [], 'SEAT_SELF_APPROVAL',
    );
  }
  if (request.status === 'APPROVED' || request.status === 'REJECTED') {
    throw new AppError(`This request was already ${request.status.toLowerCase()}`, 409, [], 'SEAT_REQUEST_DECIDED');
  }
  if (request.status !== 'PAID') {
    throw new AppError(
      'This request has not been paid for yet, so it cannot be approved or rejected.',
      409, [], 'SEAT_REQUEST_UNPAID',
    );
  }

  const decided = await runInTransaction(async (session) => {
    // The claim: PAID -> APPROVED/REJECTED, once. A second decision arriving at
    // the same moment finds no PAID request and gets null.
    const claimed = await SeatRequest.findOneAndUpdate(
      { _id: request._id, status: 'PAID' },
      {
        $set: {
          status: verdict,
          decidedByProfileId: actor?.profileId ?? null,
          decidedByName: actor?.displayName ?? null,
          decidedAt: new Date(),
          decisionNote,
        },
      },
      { new: true, ...(session ? { session } : {}) },
    );
    if (!claimed) return null;

    await runWithTenant(claimed.tenantId, () =>
      moveSeats({
        tenantId: claimed.tenantId,
        // A rejection changes no balance. The seats stay purchased and
        // unusable, and the ledger says why — silently un-purchasing paid seats
        // would record a refund that has not happened.
        purchasedDelta: 0,
        approvedDelta: verdict === 'APPROVED' ? claimed.seats : 0,
        event: verdict === 'APPROVED' ? 'EXTRA_SEATS_APPROVED' : 'EXTRA_SEATS_REJECTED',
        requestId: claimed._id,
        amountPaise: claimed.amountPaise,
        unitPricePaise: claimed.unitPricePaise,
        currency: claimed.currency,
        actor,
        note: decisionNote,
        session,
      }),
    );

    return claimed;
  });

  if (!decided) {
    throw new AppError('This request was decided by someone else a moment ago', 409, [], 'SEAT_REQUEST_DECIDED');
  }

  await recordAudit({
    actor,
    action: `seats.request.${verdict.toLowerCase()}`,
    entityType: 'SeatRequest',
    entityId: decided._id,
    before: { status: 'PAID' },
    after: {
      tenantId: decided.tenantId,
      status: verdict,
      seats: decided.seats,
      amountPaise: decided.amountPaise,
      note: decisionNote,
    },
  });

  logger.info(`Seat request ${decided._id} ${verdict.toLowerCase()} for ${decided.tenantId} (${decided.seats} seats)`);

  return requestDto(decided.toObject());
}
