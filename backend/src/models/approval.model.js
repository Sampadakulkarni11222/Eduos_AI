import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry, attachmentEntry } from '../modules/ops/common.js';

export const APPROVAL_CATEGORIES = [
  'PROCUREMENT', 'PAYMENT', 'BUDGET', 'CAPEX', 'PAYROLL_RUN', 'PAYROLL_EXCEPTION',
  'RECRUITMENT', 'VERIFICATION', 'POLICY', 'REGULATORY_SUBMISSION', 'CONTRACT',
  'EVENT', 'TRAVEL', 'STAFF_LEAVE', 'FEE_CONCESSION', 'FEE_REFUND', 'ACADEMIC_ACTION',
  'PUBLIC_COMMUNICATION', 'CORRESPONDENCE_REPLY', 'FUNDING', 'OTHER',
];

export const APPROVAL_STATUSES = ['PENDING', 'RETURNED', 'APPROVED', 'REJECTED', 'WITHDRAWN'];

const stageSchema = new Schema(
  {
    order: { type: Number, required: true },
    name: { type: String, required: true },
    // Who decides: everyone holding this role in the school (except the
    // requester), or one named person when `approverProfileId` is set.
    approverRole: { type: String, required: true },
    approverProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    status: { type: String, enum: ['WAITING', 'PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'SKIPPED'], default: 'WAITING' },
    decidedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    decidedByName: { type: String, default: null },
    // Set when the decider acted under a delegation, naming whose authority.
    onBehalfOfRole: { type: String, default: null },
    decidedAt: { type: Date, default: null },
    comment: { type: String, default: null },
    startedAt: { type: Date, default: null },
  },
  { _id: false }
);

const approvalRequestSchema = new Schema(
  {
    refNo: { type: String, required: true },
    category: { type: String, enum: APPROVAL_CATEGORIES, required: true },
    title: { type: String, required: true, trim: true },
    summary: { type: String, default: '' },
    department: { type: String, default: null },
    requesterProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    requesterName: { type: String, default: null },
    amountPaise: { type: Number, default: 0, min: 0 },
    priority: { type: String, enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'], default: 'NORMAL' },
    riskLevel: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'LOW' },
    dueAt: { type: Date, default: null },
    policyBasis: { type: String, default: null },
    recommendation: { type: String, default: null },
    attachments: [attachmentEntry],
    // The record this decision is about (a purchase request, payroll run, …).
    entityType: { type: String, default: null },
    entityId: { type: String, default: null },
    // Incremented each time the requester resubmits after a return.
    version: { type: Number, default: 1 },
    changeNote: { type: String, default: null },
    conflictDeclarations: [{
      profileId: { type: Schema.Types.ObjectId, ref: 'Profile' },
      name: String,
      declaration: String,
      at: { type: Date, default: Date.now },
    }],
    stages: [stageSchema],
    currentStage: { type: Number, default: 0 },
    status: { type: String, enum: APPROVAL_STATUSES, default: 'PENDING' },
    escalation: {
      escalated: { type: Boolean, default: false },
      at: { type: Date, default: null },
      toRole: { type: String, default: null },
      reason: { type: String, default: null },
    },
    decidedAt: { type: Date, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
approvalRequestSchema.index({ status: 1, 'stages.approverRole': 1 });
approvalRequestSchema.index({ requesterProfileId: 1, createdAt: -1 });
approvalRequestSchema.index({ entityType: 1, entityId: 1 });
approvalRequestSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });

/**
 * Per-school override of the default stage rules for a category. A stage
 * applies when the request amount is at least `minAmountPaise`.
 */
const approvalPolicySchema = new Schema(
  {
    category: { type: String, enum: APPROVAL_CATEGORIES, required: true },
    stages: [{
      name: { type: String, required: true },
      approverRole: { type: String, required: true },
      minAmountPaise: { type: Number, default: 0 },
    }],
    dueDays: { type: Number, default: 3 },
    note: { type: String, default: null },
    updatedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true }
);
approvalPolicySchema.index({ tenantId: 1, category: 1 }, { unique: true });

/**
 * Temporary delegation of a role's approval authority to a named person —
 * e.g. the principal on leave delegating routine approvals to the vice
 * principal, optionally limited by category and amount.
 */
const delegationSchema = new Schema(
  {
    fromRole: { type: String, required: true },
    fromProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    toProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    toName: { type: String, default: null },
    categories: [{ type: String, enum: APPROVAL_CATEGORIES }],
    maxAmountPaise: { type: Number, default: null },
    startsOn: { type: Date, required: true },
    endsOn: { type: Date, required: true },
    reason: { type: String, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
delegationSchema.index({ toProfileId: 1, endsOn: 1 });

approvalRequestSchema.plugin(tenantScoped);
approvalPolicySchema.plugin(tenantScoped);
delegationSchema.plugin(tenantScoped);
export const ApprovalRequest = model('ApprovalRequest', approvalRequestSchema);
export const ApprovalPolicy = model('ApprovalPolicy', approvalPolicySchema);
export const ApprovalDelegation = model('ApprovalDelegation', delegationSchema);
