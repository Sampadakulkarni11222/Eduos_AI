import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry, attachmentEntry } from '../modules/ops/common.js';

/**
 * Recurring bills and service contracts: electricity, water, internet, AMC,
 * software subscriptions, rent, security, housekeeping, waste collection,
 * insurance and the like.
 *
 *   ServiceAccount — what the school pays for again and again (a consumer
 *     number with the electricity board, an AMC with the fire-equipment firm),
 *     with its cycle, expected amount, owner and contract dates.
 *   Bill — one bill on an account: amount, consumption, due date, and the
 *     payments against it. A payment is RECORDED when someone says it was
 *     made and CONFIRMED when a different person matches it to the bank; only
 *     confirmed money settles a bill.
 *   ServiceVisit — a scheduled AMC/service visit, closed with evidence, which
 *     schedules the next one.
 *   BillReview — a person's response to a review flag (explained or
 *     dismissed, with a note). The flags themselves are computed from the
 *     records each time, so they never go stale.
 */

export const BILL_CATEGORIES = ['ELECTRICITY', 'WATER', 'INTERNET', 'PHONE', 'GAS', 'AMC', 'SOFTWARE', 'RENT', 'SECURITY', 'HOUSEKEEPING', 'WASTE', 'INSURANCE', 'LIFT', 'TRANSPORT', 'FUEL', 'OTHER'];
export const BILLING_CYCLES = ['MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'ONE_TIME'];
export const CYCLE_MONTHS = { MONTHLY: 1, BIMONTHLY: 2, QUARTERLY: 3, HALF_YEARLY: 6, ANNUAL: 12, ONE_TIME: null };
export const BILL_STATUSES = ['DUE', 'PARTIALLY_PAID', 'PAYMENT_RECORDED', 'PAID', 'DISPUTED', 'CANCELLED'];

const serviceAccountSchema = new Schema(
  {
    refNo: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, enum: BILL_CATEGORIES, required: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null },
    vendorName: { type: String, default: null },
    // Consumer / account / policy number with the provider. Not a password.
    accountNo: { type: String, default: null, trim: true },
    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
    campusCode: { type: String, default: null },
    billingCycle: { type: String, enum: BILLING_CYCLES, default: 'MONTHLY' },
    expectedAmountPaise: { type: Number, default: 0, min: 0 },
    nextDueOn: { type: Date, default: null },
    consumptionUnit: { type: String, default: null }, // kWh, kL, GB
    ownerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    leadDays: { type: [Number], default: [7, 3, 0] },
    // A service contract or AMC: its period, notice and visits.
    contractId: { type: Schema.Types.ObjectId, ref: 'Contract', default: null },
    contractStartsOn: { type: Date, default: null },
    contractEndsOn: { type: Date, default: null },
    noticeDays: { type: Number, default: 30 },
    autoRenews: { type: Boolean, default: false },
    visitsPerYear: { type: Number, default: 0, min: 0 },
    budgetLineCode: { type: String, default: null },
    status: { type: String, enum: ['ACTIVE', 'PAUSED', 'ENDED'], default: 'ACTIVE' },
    notes: { type: String, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
serviceAccountSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
serviceAccountSchema.index({ status: 1, category: 1 });

const billPaymentSchema = new Schema(
  {
    amountPaise: { type: Number, required: true, min: 1 },
    mode: { type: String, enum: ['BANK', 'UPI', 'CHEQUE', 'CASH', 'CARD', 'AUTO_DEBIT', 'OTHER'], required: true },
    reference: { type: String, default: null },
    paidOn: { type: Date, required: true },
    evidence: [attachmentEntry],
    status: { type: String, enum: ['RECORDED', 'CONFIRMED', 'REJECTED'], default: 'RECORDED' },
    recordedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    recordedByName: { type: String, default: null },
    recordedAt: { type: Date, default: Date.now },
    confirmedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    confirmedAt: { type: Date, default: null },
    // Part 3: confirmed by the person who recorded it, under single-approver mode.
    singleApprover: { type: Boolean, default: false },
    bankReference: { type: String, default: null },
    note: { type: String, default: null },
  },
  { _id: true }
);

const billSchema = new Schema(
  {
    refNo: { type: String, required: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'ServiceAccount', required: true },
    category: { type: String, enum: BILL_CATEGORIES, required: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null },
    vendorName: { type: String, default: null },
    billNo: { type: String, default: null, trim: true, uppercase: true },
    billDate: { type: Date, required: true },
    periodFrom: { type: Date, default: null },
    periodTo: { type: Date, default: null },
    dueOn: { type: Date, required: true },
    amountPaise: { type: Number, required: true, min: 0 },
    taxPaise: { type: Number, default: 0, min: 0 },
    units: { type: Number, default: null, min: 0 },
    unitLabel: { type: String, default: null },
    attachments: [attachmentEntry],
    payments: [billPaymentSchema],
    confirmedPaidPaise: { type: Number, default: 0 },
    recordedPaidPaise: { type: Number, default: 0 },
    status: { type: String, enum: BILL_STATUSES, default: 'DUE' },
    disputeNote: { type: String, default: null },
    settledAt: { type: Date, default: null },
    purchaseRequestId: { type: Schema.Types.ObjectId, ref: 'PurchaseRequest', default: null },
    ownerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
billSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
billSchema.index({ accountId: 1, billDate: -1 });
billSchema.index({ status: 1, dueOn: 1 });
billSchema.index({ vendorName: 1, amountPaise: 1, billDate: 1 });

const serviceVisitSchema = new Schema(
  {
    refNo: { type: String, required: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'ServiceAccount', required: true },
    scheduledOn: { type: Date, required: true },
    status: { type: String, enum: ['SCHEDULED', 'DONE', 'MISSED', 'CANCELLED'], default: 'SCHEDULED' },
    doneOn: { type: Date, default: null },
    technician: { type: String, default: null },
    findings: { type: String, default: null },
    evidence: [attachmentEntry],
    nextVisitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit', default: null },
    previousVisitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit', default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
serviceVisitSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
serviceVisitSchema.index({ accountId: 1, scheduledOn: 1 });

const billReviewSchema = new Schema(
  {
    flagKey: { type: String, required: true },
    code: { type: String, required: true },
    status: { type: String, enum: ['EXPLAINED', 'DISMISSED', 'ESCALATED'], required: true },
    note: { type: String, required: true },
    byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    byName: { type: String, default: null },
    at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
billReviewSchema.index({ tenantId: 1, flagKey: 1 }, { unique: true });

for (const s of [serviceAccountSchema, billSchema, serviceVisitSchema, billReviewSchema]) s.plugin(tenantScoped);

export const ServiceAccount = model('ServiceAccount', serviceAccountSchema);
export const Bill = model('Bill', billSchema);
export const ServiceVisit = model('ServiceVisit', serviceVisitSchema);
export const BillReview = model('BillReview', billReviewSchema);
