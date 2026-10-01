import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * Seats: what a school has bought, what it may actually use, and the paperwork
 * in between.
 *
 * Four numbers, and the gap between the middle two is the whole feature:
 *
 *   purchased   seats the school has paid the platform for
 *   approved    seats the Super Admin has released for use
 *   used        seats consumed by the school's active profiles (counted live)
 *   available   approved − used
 *
 * Paying moves `purchased`. Only an approval moves `approved`. So a school that
 * has paid for fifty extra seats and not been approved still cannot create a
 * fifty-first user — that is enforced by arithmetic on two separate counters
 * rather than by a rule somebody has to remember to check.
 *
 * All three collections are school-owned (`tenantScoped`), so a School Admin's
 * every read is filtered to their own school by the same plugin that confines
 * students and invoices. The Super Admin runs unscoped and sees the platform.
 */

/**
 * One school's seat balance. Exactly one per school; `tenantId` is the key.
 *
 * Counters are only ever moved with `$inc` against this document, never with a
 * read-modify-write, so two approvals landing at once cannot clobber each
 * other's increment.
 */
const seatAccountSchema = new Schema(
  {
    // Seats paid for: the base purchase plus every extra-seat request that has
    // been settled by the gateway. Says nothing about whether they are usable.
    purchasedSeats: { type: Number, required: true, default: 0, min: 0 },
    // Seats released for use. The only number seat enforcement reads.
    approvedSeats: { type: Number, required: true, default: 0, min: 0 },
    // Bumped by every seat-consuming operation, inside its transaction, BEFORE
    // it counts the seats in use. Two transactions that both write this
    // document cannot both commit — the second gets a write conflict and is
    // retried, and the retry counts the profile the first one created. That is
    // what makes "check, then create the user" atomic when nothing else about
    // the two creations would conflict. See seat.service.js#withSeatReserved.
    // Carries no meaning of its own and is never read.
    reservationVersion: { type: Number, default: 0 },
    notes: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);
// One account per school. Enforced by the database, so a race between two
// callers provisioning the same school ends in a duplicate-key error rather
// than in two accounts each counting half the seats.
seatAccountSchema.index({ tenantId: 1 }, { unique: true });

/**
 * What one school pays for a seat.
 *
 * An append-only chain of versions, not a mutable figure, and that is the whole
 * design: a request records the price it was quoted, and a price a request has
 * already been quoted at must remain readable forever. Raising School A from
 * ₹100 to ₹120 writes a new version and closes the old one — it does not edit
 * the row that priced last month's payment.
 *
 * A school with no version of its own falls back to the platform default (see
 * seat.pricing.js), so schools priced at the standard rate need no record at
 * all and the deployment behaves exactly as it did before per-school pricing.
 *
 * `effectiveFrom`/`effectiveTo` are resolved at read time — no scheduler is
 * involved, and none is needed: "the price in force now" is a query. A version
 * may be dated into the future, which is how a rise agreed today takes effect
 * at the start of next term.
 */
const seatPriceSchema = new Schema(
  {
    unitPricePaise: { type: Number, required: true, min: 1 },
    // ISO 4217, uppercase. Stored per version, because a school repriced into
    // another currency must not have its old versions reinterpreted.
    currency: { type: String, required: true, default: 'INR', uppercase: true, trim: true },

    // INACTIVE is not deletion: the version stays, keeps pricing whatever it
    // priced, and simply stops being resolvable — the school falls back to the
    // platform default until it is reactivated or replaced.
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },

    effectiveFrom: { type: Date, required: true, default: Date.now },
    // null = open-ended. Closed to the next version's start when superseded.
    effectiveTo: { type: Date, default: null },
    supersededByPriceId: { type: Schema.Types.ObjectId, ref: 'SeatPrice', default: null },

    note: { type: String, trim: true, default: null },
    setByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    setByName: { type: String, default: null },
    deactivatedByName: { type: String, default: null },
    deactivatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
// Resolution reads the newest version whose window covers "now".
seatPriceSchema.index({ tenantId: 1, effectiveFrom: -1 });
// Two versions of one school's price cannot begin at the same instant. This is
// what makes concurrent price changes safe: the loser of the race gets a
// duplicate-key error rather than a second live version nobody notices.
seatPriceSchema.index({ tenantId: 1, effectiveFrom: 1 }, { unique: true });

/**
 * A School Admin asking to buy more seats.
 *
 * `status` is the request's own lifecycle and `payment.status` is the money's.
 * They are kept apart because they answer different questions and fail
 * independently: a request can be PENDING_PAYMENT with a FAILED charge behind
 * it, and a PAID request is still worth nothing until a Super Admin decides
 * it.
 *
 *   PENDING_PAYMENT → PAID → APPROVED
 *                          ↘ REJECTED
 *
 * Every price field is written by the server from its own price list. Nothing
 * a client sends reaches them — see seat.pricing.js.
 */
const seatRequestSchema = new Schema(
  {
    seats: { type: Number, required: true, min: 1 },

    // ── What the server decided it costs ───────────────────────────────
    //
    // This block is a SNAPSHOT, not a reference. Everything needed to explain
    // the charge is copied here at the moment of quoting, so a later price
    // change — or a deactivated price version — cannot alter what this request
    // says it cost, and the receipt still reconciles years later.
    unitPricePaise: { type: Number, required: true },
    discountPct: { type: Number, required: true, default: 0 },
    amountPaise: { type: Number, required: true },
    currency: { type: String, required: true, default: 'INR' },
    // The volume-tier list this quote came from. A later change to the tiers
    // must not silently re-price a request that is already out for payment.
    priceListVersion: { type: String, required: true },
    // Which SeatPrice version supplied the unit price, and whether the school
    // had one at all. Kept for reconciliation — the amount above stands on its
    // own, and this says where it came from.
    seatPriceId: { type: Schema.Types.ObjectId, ref: 'SeatPrice', default: null },
    priceSource: { type: String, enum: ['SCHOOL', 'PLATFORM_DEFAULT'], default: 'PLATFORM_DEFAULT' },
    pricedAt: { type: Date, default: Date.now },

    status: {
      type: String,
      enum: ['PENDING_PAYMENT', 'PAID', 'APPROVED', 'REJECTED'],
      default: 'PENDING_PAYMENT',
    },

    payment: {
      status: {
        type: String,
        enum: ['UNPAID', 'INITIATED', 'PAID', 'FAILED'],
        default: 'UNPAID',
      },
      provider: { type: String, default: null },
      mode: { type: String, enum: ['GATEWAY', null], default: null },
      // The gateway's order id — what a webhook matches on, so it is indexed
      // and unique-when-present: two requests can never claim one order.
      gatewayOrderRef: { type: String, default: null },
      gatewayRef: { type: String, default: null },
      receiptNo: { type: String, default: null },
      paidAt: { type: Date, default: null },
      failureReason: { type: String, default: null },
    },

    requestedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    requestedByName: { type: String, default: null },
    reason: { type: String, trim: true, default: null },

    // Decided by the platform, never by the school — see seat.service.js.
    decidedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    decidedByName: { type: String, default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);
seatRequestSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
seatRequestSchema.index({ status: 1, createdAt: -1 });
// One request per gateway order, so two requests can never claim one payment.
//
// A PARTIAL index, not a sparse one. `sparse` skips documents where the field
// is absent — and this field defaults to null, so it is always present. Every
// unpaid request would therefore collide on null with every other, and a school
// could hold exactly one open request across the whole platform. The partial
// filter indexes only the rows that actually carry an order id.
seatRequestSchema.index(
  { 'payment.gatewayOrderRef': 1 },
  { unique: true, partialFilterExpression: { 'payment.gatewayOrderRef': { $type: 'string' } } },
);

/**
 * The seat history: every movement of either counter, with the balances it
 * produced.
 *
 * Written in the same operation as the movement it records, so the ledger and
 * the account cannot disagree. This is the school-facing history; the audit
 * log (utils/auditTrail.js) records the same events for the platform trail,
 * which is a different audience and a different retention.
 */
const seatLedgerEntrySchema = new Schema(
  {
    event: {
      type: String,
      required: true,
      enum: [
        'PURCHASE',              // base seats sold with the school
        'EXTRA_SEATS_PAID',      // an extra-seat request settled
        'EXTRA_SEATS_APPROVED',  // ... and released for use
        'EXTRA_SEATS_REJECTED',  // ... or refused
        'ADJUSTMENT',            // a platform correction
      ],
    },
    purchasedDelta: { type: Number, required: true, default: 0 },
    approvedDelta: { type: Number, required: true, default: 0 },
    purchasedAfter: { type: Number, required: true },
    approvedAfter: { type: Number, required: true },
    requestId: { type: Schema.Types.ObjectId, ref: 'SeatRequest', default: null },
    amountPaise: { type: Number, default: null },
    // The price that applied to this movement, copied from the request. The
    // history is read to answer "what did we pay for those seats?", and an
    // entry that only carried a total would send the reader back to a request
    // whose price may since have been superseded.
    unitPricePaise: { type: Number, default: null },
    currency: { type: String, default: null },
    actorProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    actorName: { type: String, default: null },
    note: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);
seatLedgerEntrySchema.index({ tenantId: 1, createdAt: -1 });

seatPriceSchema.plugin(tenantScoped); // school-owned
export const SeatPrice = model('SeatPrice', seatPriceSchema);
seatAccountSchema.plugin(tenantScoped); // school-owned
export const SeatAccount = model('SeatAccount', seatAccountSchema);
seatRequestSchema.plugin(tenantScoped); // school-owned
export const SeatRequest = model('SeatRequest', seatRequestSchema);
seatLedgerEntrySchema.plugin(tenantScoped); // school-owned
export const SeatLedgerEntry = model('SeatLedgerEntry', seatLedgerEntrySchema);
