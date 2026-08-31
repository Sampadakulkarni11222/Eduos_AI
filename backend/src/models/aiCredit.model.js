import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * AI credit wallet — one per metered profile.
 *
 * Free allowance and purchased balance are tracked **separately and
 * deliberately**. The free allowance resets every month; purchased credits do
 * not, because a family paid for them and silently expiring them at a month
 * boundary would be taking their money. Spending always draws the free
 * allowance down first for the same reason — never burn what somebody bought
 * while a free credit is still available.
 *
 * `periodKey` is the YYYY-MM the free counter belongs to. Rolling the month is
 * done lazily on read rather than by a scheduled job: a cron that has to run
 * for billing to be correct is a cron whose failure silently overcharges
 * people.
 */
const aiCreditWalletSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true, unique: true, index: true },
    /** YYYY-MM that freeUsed refers to. */
    periodKey: { type: String, required: true },
    /** Free credits consumed in the current period. */
    freeUsed: { type: Number, default: 0, min: 0 },
    /** Purchased credits remaining. Never reset by the period roll. */
    paidBalance: { type: Number, default: 0, min: 0 },
    /** Lifetime counters, for support questions and abuse investigation. */
    lifetimeSpent: { type: Number, default: 0, min: 0 },
    lifetimePurchased: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

aiCreditWalletSchema.plugin(tenantScoped); // school-owned
export const AiCreditWallet = model('AiCreditWallet', aiCreditWalletSchema);

/**
 * A credit top-up.
 *
 * Kept out of the fee ledger on purpose: AI credits are an optional software
 * add-on, and folding them into `Invoice` would put them into statutory fee
 * records, outstanding-dues totals and arrears reports where a school
 * accountant would have to explain them.
 *
 * The order is written **before** the charge is attempted, so a payment that
 * succeeds at the gateway and then fails to record locally leaves a PENDING row
 * to reconcile rather than money with no trace.
 */
const aiCreditOrderSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true, index: true },
    /** Who the credits are for — a parent may top up their child's wallet. */
    beneficiaryProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true, index: true },
    packKey: { type: String, required: true },
    credits: { type: Number, required: true, min: 1 },
    amountPaise: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['PENDING', 'PAID', 'FAILED', 'CANCELLED'], default: 'PENDING', index: true },
    orderNo: { type: String, required: true, unique: true },
    gatewayRef: { type: String, default: null },
    error: { type: String, default: null },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true }
);

aiCreditOrderSchema.plugin(tenantScoped); // school-owned
export const AiCreditOrder = model('AiCreditOrder', aiCreditOrderSchema);
