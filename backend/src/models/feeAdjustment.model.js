import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry, attachmentEntry } from '../modules/ops/common.js';

/**
 * Fee concessions and controlled invoice adjustments.
 *
 *   ConcessionType — a scheme the school offers (sibling, staff ward, merit,
 *     RTE, need-based): percent or fixed, optionally limited to fee heads.
 *     Need-based concessions are discretionary: the amount is decided per
 *     case and always goes to approval with its justification.
 *   FeeAdjustment — one request to change what an issued invoice asks for:
 *     a CONCESSION, a CREDIT_NOTE (a correction in the family's favour) or a
 *     VOID (the invoice should not have been raised). It is applied only once
 *     approved, records the invoice total before and after, and never deletes
 *     or rewrites the issued invoice or its lines.
 */

export const CONCESSION_KINDS = ['SIBLING', 'STAFF_WARD', 'MERIT', 'RTE', 'NEED_BASED', 'SPORTS', 'OTHER'];
export const ADJUSTMENT_KINDS = ['CONCESSION', 'CREDIT_NOTE', 'VOID'];
export const ADJUSTMENT_STATUSES = ['PENDING_APPROVAL', 'APPLIED', 'REJECTED', 'WITHDRAWN'];

const concessionTypeSchema = new Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: CONCESSION_KINDS, required: true },
    method: { type: String, enum: ['PERCENT', 'FIXED', 'DISCRETIONARY'], required: true },
    valueBp: { type: Number, default: null, min: 0, max: 10000 }, // PERCENT: 2500 = 25%
    amountPaise: { type: Number, default: null, min: 0 }, // FIXED: per invoice
    // Empty = every head on the invoice.
    feeHeadIds: [{ type: Schema.Types.ObjectId, ref: 'FeeHead' }],
    eligibility: { type: String, default: null }, // what has to be shown, in words
    active: { type: Boolean, default: true },
    history: [historyEntry],
  },
  { timestamps: true }
);
concessionTypeSchema.index({ tenantId: 1, code: 1 }, { unique: true });

const feeAdjustmentSchema = new Schema(
  {
    refNo: { type: String, required: true },
    kind: { type: String, enum: ADJUSTMENT_KINDS, required: true },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true },
    invoiceNo: { type: String, default: null },
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', default: null },
    concessionTypeId: { type: Schema.Types.ObjectId, ref: 'ConcessionType', default: null },
    concessionName: { type: String, default: null },
    // The line the amount is recorded against (concessionPaise), when one applies.
    lineId: { type: Schema.Types.ObjectId, ref: 'InvoiceLine', default: null },
    amountPaise: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true },
    evidence: [attachmentEntry],
    status: { type: String, enum: ADJUSTMENT_STATUSES, default: 'PENDING_APPROVAL' },
    approvalRequestId: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest', default: null },
    requestedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    requestedByName: { type: String, default: null },
    appliedAt: { type: Date, default: null },
    beforeTotalPaise: { type: Number, default: null },
    afterTotalPaise: { type: Number, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
feeAdjustmentSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
feeAdjustmentSchema.index({ invoiceId: 1, status: 1 });

concessionTypeSchema.plugin(tenantScoped);
feeAdjustmentSchema.plugin(tenantScoped);
export const ConcessionType = model('ConcessionType', concessionTypeSchema);
export const FeeAdjustment = model('FeeAdjustment', feeAdjustmentSchema);
