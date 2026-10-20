import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * A quarterly decision report: a frozen snapshot of the catalogue's figures
 * for one quarter, with the metric version they were computed under.
 *
 * Reports are never rewritten. A regeneration is a new version with its own
 * figures; the earlier one stays readable, so a corrected report is visibly a
 * correction. (quarterKey, version) is the logical key: the scheduled job
 * creates version 1 once per school and quarter.
 */
export const REPORT_STATUSES = ['GENERATING', 'GENERATED', 'FAILED'];

const quarterlyReportSchema = new Schema(
  {
    quarterKey: { type: String, required: true }, // e.g. "FY2026-27-Q2"
    label: { type: String, required: true }, // e.g. "Q2 2026-27 (1 Jul – 30 Sep 2026)"
    period: { from: String, to: String, start: Date, end: Date, tz: String },
    version: { type: Number, required: true, min: 1 },
    catalogueVersion: { type: String, default: null },
    status: { type: String, enum: REPORT_STATUSES, default: 'GENERATING' },
    trigger: { type: String, enum: ['SCHEDULED', 'MANUAL'], default: 'SCHEDULED' },
    reason: { type: String, default: null },
    requestedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    startedAt: { type: Date, default: Date.now },
    generatedAt: { type: Date, default: null },
    error: { type: String, default: null },
    // The deterministic figures: { sections, summary, budgetVariance, renewalForecast, achievements, decisions, missing }.
    figures: { type: Schema.Types.Mixed, default: null },
    supersedesId: { type: Schema.Types.ObjectId, ref: 'QuarterlyReport', default: null },
  },
  { timestamps: true },
);
quarterlyReportSchema.index({ tenantId: 1, quarterKey: 1, version: 1 }, { unique: true });
quarterlyReportSchema.index({ tenantId: 1, createdAt: -1 });

/**
 * One recipient of one report version: a durable delivery record. A SENT row
 * is never sent again; a FAILED one is retried; a recipient who lost the
 * authority before delivery is REVOKED instead of sent.
 */
export const DELIVERY_STATUSES = ['QUEUED', 'SENDING', 'SENT', 'FAILED', 'REVOKED'];

const quarterlyDeliverySchema = new Schema(
  {
    reportId: { type: Schema.Types.ObjectId, ref: 'QuarterlyReport', required: true },
    recipientProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    recipientName: { type: String, default: null },
    roleKey: { type: String, default: null },
    sections: { type: [String], default: [] },
    status: { type: String, enum: DELIVERY_STATUSES, default: 'QUEUED' },
    attempts: { type: Number, default: 0 },
    claimedAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    channels: { type: [{ channel: String, status: String, at: Date }], default: [] },
  },
  { timestamps: true },
);
quarterlyDeliverySchema.index({ reportId: 1, recipientProfileId: 1 }, { unique: true });
quarterlyDeliverySchema.index({ tenantId: 1, status: 1 });

quarterlyReportSchema.plugin(tenantScoped);
quarterlyDeliverySchema.plugin(tenantScoped);
export const QuarterlyReport = model('QuarterlyReport', quarterlyReportSchema);
export const QuarterlyDelivery = model('QuarterlyDelivery', quarterlyDeliverySchema);
