import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry } from '../modules/ops/common.js';

/**
 * The school health room (coverage row F14), built beside the encrypted
 * medical record (medicalRecord.model.js), never inside it.
 *
 * Every clinical detail is encrypted at the application layer with the same
 * util the medical record uses (utils/crypto.js): the complaint, the vitals,
 * what was done, the medicine and its dose, the prescription file, care-note
 * text, vaccine names and screening results. Stored in the clear are only the
 * keys needed to find and count rows: the student, timestamps, an outcome
 * code and yes/no flags. Those are what the principal's counts are made of,
 * and none of them carries a name or a clinical word.
 *
 * Reads go through modules/health only; each read of a child's record is
 * audited there (recordPiiRead).
 */

export const VISIT_OUTCOMES = ['RETURNED_TO_CLASS', 'REST', 'FIRST_AID', 'SENT_HOME', 'REFERRED'];
export const NOTIFY_TRIGGERS = ['SENT_HOME', 'REFERRED', 'INJURY', 'MEDICINE_GIVEN'];
export const PLAN_STATUSES = ['AWAITING_CONSENT', 'ACTIVE', 'ENDED', 'STOPPED'];
export const DOSE_STATUSES = ['GIVEN', 'MISSED', 'REFUSED'];
export const STOCK_KINDS = ['FIRST_AID', 'MEDICINE', 'EQUIPMENT'];
export const ENTRY_KINDS = ['IMMUNISATION', 'SCREENING'];

const actorRef = {
  profileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  name: { type: String, default: null },
  at: { type: Date, default: null },
};

/** One visit to the health room. */
const visitSchema = new Schema(
  {
    refNo: { type: String, required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    arrivedAt: { type: Date, required: true },
    leftAt: { type: Date, default: null },
    outcome: { type: String, enum: VISIT_OUTCOMES, required: true },
    injury: { type: Boolean, default: false },
    medicineGiven: { type: Boolean, default: false },
    complaintEnc: { type: String, required: true }, // encrypted string
    vitalsEnc: { type: String, default: null }, // encrypted { temperatureC, pulse, bpSystolic, bpDiastolic, spo2 }
    actionEnc: { type: String, default: null }, // encrypted string: what was done
    attendedBy: actorRef,
    parentNotified: {
      at: { type: Date, default: null },
      reasons: { type: [String], default: [] },
      recipients: { type: Number, default: 0 },
    },
    history: [historyEntry],
  },
  { timestamps: true },
);
visitSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
visitSchema.index({ tenantId: 1, studentId: 1, arrivedAt: -1 });
visitSchema.index({ tenantId: 1, arrivedAt: -1 });
visitSchema.plugin(tenantScoped);
export const HealthVisit = model('HealthVisit', visitSchema);

/** A course of medicine the school gives during the day, with the family's consent. */
const planSchema = new Schema(
  {
    refNo: { type: String, required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    medicineEnc: { type: String, required: true }, // encrypted { name, form, strength }
    doseEnc: { type: String, required: true }, // encrypted string, e.g. "5 ml"
    instructionsEnc: { type: String, default: null }, // encrypted string
    prescriptionEnc: { type: String, default: null }, // encrypted { name, url } (an /uploads path)
    times: { type: [String], default: [] }, // HH:MM school time
    startOn: { type: Date, required: true },
    endOn: { type: Date, required: true },
    controlled: { type: Boolean, default: false },
    status: { type: String, enum: PLAN_STATUSES, default: 'AWAITING_CONSENT' },
    consent: {
      byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      byName: { type: String, default: null },
      at: { type: Date, default: null },
      statement: { type: String, default: null },
    },
    createdBy: actorRef,
    stoppedReason: { type: String, default: null },
    history: [historyEntry],
  },
  { timestamps: true },
);
planSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
planSchema.index({ tenantId: 1, studentId: 1, status: 1 });
planSchema.plugin(tenantScoped);
export const MedicationPlan = model('MedicationPlan', planSchema);

/**
 * The medication administration record: one row per scheduled dose that was
 * given, missed or refused. A controlled medicine needs a second person's
 * countersignature (health.witness) before the row counts as checked.
 */
const doseSchema = new Schema(
  {
    planId: { type: Schema.Types.ObjectId, ref: 'MedicationPlan', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    scheduledFor: { type: Date, required: true },
    slot: { type: String, default: null }, // HH:MM from the plan
    status: { type: String, enum: DOSE_STATUSES, required: true },
    at: { type: Date, required: true },
    by: actorRef,
    noteEnc: { type: String, default: null },
    controlled: { type: Boolean, default: false },
    countersign: {
      required: { type: Boolean, default: false },
      profileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      name: { type: String, default: null },
      at: { type: Date, default: null },
    },
    channel: { type: String, default: 'WEB' },
  },
  { timestamps: true },
);
doseSchema.index({ tenantId: 1, planId: 1, scheduledFor: 1 }, { unique: true });
doseSchema.index({ tenantId: 1, studentId: 1, at: -1 });
doseSchema.plugin(tenantScoped);
export const MedicationDose = model('MedicationDose', doseSchema);

/** The health room's own first-aid and medicine stock. Not personal data. */
const stockSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: STOCK_KINDS, default: 'FIRST_AID' },
    batchNo: { type: String, default: null },
    quantity: { type: Number, default: 0, min: 0 },
    unit: { type: String, default: 'units' },
    reorderLevel: { type: Number, default: 0, min: 0 },
    expiresOn: { type: Date, default: null },
    location: { type: String, default: 'Health room' },
    controlled: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    history: [historyEntry],
  },
  { timestamps: true },
);
stockSchema.index({ tenantId: 1, active: 1, expiresOn: 1 });
stockSchema.plugin(tenantScoped);
export const HealthStock = model('HealthStock', stockSchema);

/**
 * A short care note for the class teacher ("Severe nut allergy: EpiPen in the
 * health room"). Shown to the class teacher only while the family's consent to
 * share it stands; withdrawing consent hides it at once.
 */
const careNoteSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    textEnc: { type: String, required: true }, // encrypted string, at most 160 characters
    severity: { type: String, enum: ['INFO', 'IMPORTANT', 'SEVERE'], default: 'IMPORTANT' },
    shareConsent: {
      granted: { type: Boolean, default: false },
      byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      byName: { type: String, default: null },
      at: { type: Date, default: null },
    },
    createdBy: actorRef,
    active: { type: Boolean, default: true },
    history: [historyEntry],
  },
  { timestamps: true },
);
careNoteSchema.index({ tenantId: 1, studentId: 1, active: 1 });
careNoteSchema.plugin(tenantScoped);
export const CareNote = model('CareNote', careNoteSchema);

/** An immunisation or an annual screening (height, weight, vision, dental) for the health card. */
const entrySchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    kind: { type: String, enum: ENTRY_KINDS, required: true },
    on: { type: Date, required: true },
    academicYear: { type: String, default: null }, // e.g. 2026-27
    dataEnc: { type: String, required: true }, // encrypted object (vaccine/dose, or the screening figures)
    recordedBy: actorRef,
  },
  { timestamps: true },
);
entrySchema.index({ tenantId: 1, studentId: 1, kind: 1, on: -1 });
entrySchema.plugin(tenantScoped);
export const HealthEntry = model('HealthEntry', entrySchema);

/** The school's health-room settings: which outcomes tell the parents. One per school. */
const settingsSchema = new Schema(
  {
    key: { type: String, default: 'default' },
    notifyOn: { type: [String], default: ['SENT_HOME', 'REFERRED', 'INJURY', 'MEDICINE_GIVEN'] },
    expiryLeadDays: { type: Number, default: 30 },
    updatedBy: actorRef,
  },
  { timestamps: true },
);
settingsSchema.index({ tenantId: 1, key: 1 }, { unique: true });
settingsSchema.plugin(tenantScoped);
export const HealthSettings = model('HealthSettings', settingsSchema);
