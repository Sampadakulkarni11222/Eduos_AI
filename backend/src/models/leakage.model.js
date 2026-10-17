import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

const revenueLeakageFindingSchema = new Schema(
  {
    ruleCode: {
      type: String,
      enum: [
        'UNBILLED_ACTIVE_STUDENT',
        'UNBILLED_HOSTEL_ALLOCATION',
        'UNBILLED_BUS_ENROLLMENT',
        'OVERDUE_NO_FOLLOWUP',
        'UNRECONCILED_PAYMENT',
        'DUPLICATE_PAYMENT_SUSPECTED',
        'HIGH_CONCESSION_ANOMALY',
        'BUDGET_OVERRUN',
      ],
      required: true,
    },
    ruleName: { type: String, required: true },
    category: {
      type: String,
      enum: ['POTENTIAL', 'CONFIRMED'],
      default: 'POTENTIAL',
    },
    severity: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      default: 'MEDIUM',
    },
    estimatedAmountPaise: { type: Number, required: true, default: 0 },
    recoveredAmountPaise: { type: Number, default: 0 },
    evidence: { type: Schema.Types.Mixed, default: {} },
    relatedEntityModel: { type: String, default: null }, // e.g. "Invoice", "Student", "Payment", "HostelAllocation"
    relatedEntityId: { type: Schema.Types.ObjectId, default: null },
    status: {
      type: String,
      enum: ['OPEN', 'UNDER_REVIEW', 'CONFIRMED', 'RESOLVED', 'FALSE_POSITIVE'],
      default: 'OPEN',
    },
    investigationNotes: { type: String, trim: true, default: null },
    investigatedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    investigatedAt: { type: Date, default: null },
    detectedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

revenueLeakageFindingSchema.index({ tenantId: 1, ruleCode: 1, relatedEntityId: 1 });
revenueLeakageFindingSchema.index({ tenantId: 1, status: 1 });

revenueLeakageFindingSchema.plugin(tenantScoped);
export const RevenueLeakageFinding = model('RevenueLeakageFinding', revenueLeakageFindingSchema);
