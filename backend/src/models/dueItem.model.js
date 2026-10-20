import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry, attachmentEntry } from '../modules/ops/common.js';

/**
 * One thing that is due: a bill, a licence renewal, a service visit, a vehicle
 * check, a lab chemical's expiry, a water test, a PTM follow-up.
 *
 * Every module puts its due dates here (through tasks.service upsertFromSource)
 * so one queue shows a person, a department and the principal what is due,
 * overdue and who owns it. The record it is about stays in its own module;
 * this holds the obligation, its owner and what was done about it.
 */
export const DEPARTMENTS = ['ADMINISTRATION', 'FINANCE', 'ACADEMICS', 'LABS', 'TRANSPORT', 'FACILITIES', 'COMPLIANCE', 'HR', 'HOSTEL', 'LIBRARY', 'ENGAGEMENT', 'SUSTAINABILITY', 'HEALTH', 'IT', 'OTHER'];
export const CATEGORIES = ['BILL', 'LICENCE', 'SERVICE', 'INSPECTION', 'VEHICLE_CHECK', 'LAB_EXPIRY', 'CALIBRATION', 'SANITATION', 'WATER_TEST', 'TRAINING', 'PTM_FOLLOWUP', 'RENEWAL', 'MAINTENANCE', 'OTHER'];
export const SEVERITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'];
export const DUE_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'DONE', 'CANCELLED'];

const dueItemSchema = new Schema(
  {
    refNo: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    department: { type: String, enum: DEPARTMENTS, required: true },
    category: { type: String, enum: CATEGORIES, default: 'OTHER' },
    // The record this is about, so the queue can link to it and a module can update its own item.
    source: {
      entityType: { type: String, default: null },
      entityId: { type: Schema.Types.ObjectId, default: null },
      link: { type: String, default: null },
    },
    // Unique per school: the same source never makes two open items.
    sourceKey: { type: String, default: null },
    ownerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    delegateProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    dueAt: { type: Date, required: true },
    severity: { type: String, enum: SEVERITIES, default: 'NORMAL' },
    // Days before the due date when the owner is reminded; 0 is the day itself.
    leadDays: { type: [Number], default: [30, 7, 1, 0] },
    recurrence: {
      unit: { type: String, enum: ['DAY', 'WEEK', 'MONTH', 'YEAR', null], default: null },
      every: { type: Number, default: null },
    },
    // What it is expected to cost, for the forecast; whole paise.
    amountPaise: { type: Number, default: null },
    currency: { type: String, default: 'INR' },
    status: { type: String, enum: DUE_STATUSES, default: 'OPEN' },
    snoozedUntil: { type: Date, default: null },
    snoozeReason: { type: String, default: null },
    completedAt: { type: Date, default: null },
    completedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    completionNote: { type: String, default: null },
    evidence: { type: [attachmentEntry], default: [] },
    requiresEvidence: { type: Boolean, default: false },
    remindersSent: { type: [{ lead: Number, at: Date }], default: [] },
    escalationLevel: { type: Number, default: 0 },
    escalatedAt: { type: Date, default: null },
    previousId: { type: Schema.Types.ObjectId, ref: 'DueItem', default: null },
    nextId: { type: Schema.Types.ObjectId, ref: 'DueItem', default: null },
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    history: { type: [historyEntry], default: [] },
  },
  { timestamps: true },
);

dueItemSchema.index({ tenantId: 1, status: 1, dueAt: 1 });
dueItemSchema.index({ tenantId: 1, ownerProfileId: 1, status: 1 });
dueItemSchema.index({ tenantId: 1, department: 1, status: 1, dueAt: 1 });
// One open item per source: a module re-announcing the same due date updates it instead of duplicating.
dueItemSchema.index({ tenantId: 1, sourceKey: 1 }, { unique: true, partialFilterExpression: { sourceKey: { $type: 'string' } } });

dueItemSchema.plugin(tenantScoped);
export const DueItem = model('DueItem', dueItemSchema);
