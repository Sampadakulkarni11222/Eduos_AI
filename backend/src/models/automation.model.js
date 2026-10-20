import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * Part 7 automations.
 *
 * AutomationSetting   a school's choice for one catalogued automation (on/off,
 *                     the hour it runs, who it reaches). A school with no row
 *                     for an automation gets the catalogue default
 *                     (modules/automations/automations.catalogue.js).
 * PersonalAutomation  a person's own scheduled reminder or report, set up in
 *                     Ask AI ("remind me every Friday to submit lesson plans")
 *                     or on the Automations page. It only ever reaches the
 *                     person who made it.
 * AutomationOptIn     a person's opt-in (or opt-out) for an automation that
 *                     needs one: birthday greetings, the weekly parent digest.
 * AutomationDraft     a record an automation prepared on someone's behalf (a
 *                     purchase request for low stock, a cover suggestion). It
 *                     is only a draft: a person opens it and confirms or
 *                     dismisses it; nothing is written in the module for them.
 */

const settingSchema = new Schema(
  {
    key: { type: String, required: true },
    enabled: { type: Boolean, required: true },
    hour: { type: Number, min: 0, max: 23, default: null },
    weekday: { type: Number, min: 0, max: 6, default: null },
    audience: { type: [String], default: undefined },
    updatedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    history: [{ at: { type: Date, default: Date.now }, byProfileId: Schema.Types.ObjectId, change: Schema.Types.Mixed }],
  },
  { timestamps: true, versionKey: false },
);
settingSchema.plugin(tenantScoped);
settingSchema.index({ tenantId: 1, key: 1 }, { unique: true });

export const PERSONAL_KINDS = ['REMINDER', 'REPORT'];
export const PERSONAL_FREQUENCIES = ['ONCE', 'DAILY', 'WEEKDAYS', 'WEEKLY', 'MONTHLY'];

const personalSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    kind: { type: String, enum: PERSONAL_KINDS, required: true },
    // REMINDER: what to remind about. REPORT: the label of the report.
    text: { type: String, required: true, maxlength: 300 },
    reportKey: { type: String, default: null },
    schedule: {
      frequency: { type: String, enum: PERSONAL_FREQUENCIES, required: true },
      // 0 = Sunday ... 6 = Saturday (WEEKLY).
      weekdays: { type: [Number], default: undefined },
      dayOfMonth: { type: Number, min: 1, max: 28, default: null },
      hour: { type: Number, min: 0, max: 23, required: true },
      minute: { type: Number, min: 0, max: 59, default: 0 },
      onDate: { type: String, default: null }, // YYYY-MM-DD for ONCE
    },
    active: { type: Boolean, default: true },
    nextRunAt: { type: Date, default: null },
    lastRunAt: { type: Date, default: null },
    runs: { type: Number, default: 0 },
    createdVia: { type: String, enum: ['ASK_AI', 'WHATSAPP', 'WEB'], default: 'WEB' },
    stoppedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);
personalSchema.plugin(tenantScoped);
personalSchema.index({ tenantId: 1, profileId: 1, active: 1 });
personalSchema.index({ tenantId: 1, active: 1, nextRunAt: 1 });

const optInSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    key: { type: String, required: true },
    enabled: { type: Boolean, required: true },
  },
  { timestamps: true, versionKey: false },
);
optInSchema.plugin(tenantScoped);
optInSchema.index({ tenantId: 1, profileId: 1, key: 1 }, { unique: true });

const draftSchema = new Schema(
  {
    automationKey: { type: String, required: true },
    // One draft per source fact (e.g. `low-stock:<itemId>:<yyyy-mm>`).
    sourceKey: { type: String, required: true },
    title: { type: String, required: true, maxlength: 300 },
    detail: { type: Schema.Types.Mixed, default: {} },
    link: { type: String, default: null },
    ownerProfileIds: [{ type: Schema.Types.ObjectId, ref: 'Profile' }],
    status: { type: String, enum: ['DRAFT', 'CONFIRMED', 'DISMISSED'], default: 'DRAFT' },
    decidedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);
draftSchema.plugin(tenantScoped);
draftSchema.index({ tenantId: 1, sourceKey: 1 }, { unique: true });
draftSchema.index({ tenantId: 1, status: 1, automationKey: 1 });

export const AutomationSetting = model('AutomationSetting', settingSchema);
export const PersonalAutomation = model('PersonalAutomation', personalSchema);
export const AutomationOptIn = model('AutomationOptIn', optInSchema);
export const AutomationDraft = model('AutomationDraft', draftSchema);

/**
 * One run of one school automation for one period (a day, or a week), so two
 * server processes, or a scheduled run and a retried tick, never both run it.
 * Kept apart from JobRun (the scheduler's own windows); platform data, keyed by
 * school, kept a month for diagnosis.
 */
const runSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    automation: { type: String, required: true },
    tenantId: { type: String, required: true },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
    ok: { type: Boolean, default: null },
    manual: { type: Boolean, default: false },
    result: { type: Schema.Types.Mixed, default: null },
  },
  { versionKey: false },
);
runSchema.index({ startedAt: 1 }, { expireAfterSeconds: 30 * 86_400 });
runSchema.index({ automation: 1, tenantId: 1, startedAt: -1 });
export const AutomationRun = model('AutomationRun', runSchema);
