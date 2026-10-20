import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry, attachmentEntry } from '../modules/ops/common.js';

/**
 * Background verification of a staff member, teacher, driver, attendant,
 * vendor or volunteer.
 *
 * Checks are performed by an authorised verifier (an agency, the police
 * verification process, a referee) and recorded here with evidence; HR
 * reviews; the principal gives the final institutional decision. PENDING is
 * never CLEARED. Evidence is visible only to verification.manage holders;
 * everyone else who may see the case sees its status.
 */
export const CHECK_TYPES = ['IDENTITY', 'ADDRESS', 'EDUCATION', 'EMPLOYMENT', 'REFERENCE', 'POLICE', 'DRIVING_LICENCE', 'MEDICAL_FITNESS', 'CHILD_SAFETY_DECLARATION', 'OTHER'];
export const VERIFICATION_STATUSES = ['INITIATED', 'IN_PROGRESS', 'HR_REVIEW', 'AWAITING_DECISION', 'CLEARED', 'CLEARED_WITH_CONDITIONS', 'NOT_CLEARED', 'EXPIRED', 'DISPUTED', 'WITHDRAWN'];

const checkSchema = new Schema(
  {
    type: { type: String, enum: CHECK_TYPES, required: true },
    required: { type: Boolean, default: true },
    provider: { type: String, default: null }, // agency / police station / university / referee
    status: { type: String, enum: ['NOT_STARTED', 'IN_PROGRESS', 'CLEAR', 'ADVERSE', 'UNABLE_TO_VERIFY'], default: 'NOT_STARTED' },
    reference: { type: String, default: null },
    completedAt: { type: Date, default: null },
    expiresOn: { type: Date, default: null },
    note: { type: String, default: null },
    evidence: [attachmentEntry],
    verifiedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { _id: true }
);

const verificationCaseSchema = new Schema(
  {
    refNo: { type: String, required: true },
    subjectType: { type: String, enum: ['TEACHER', 'STAFF', 'DRIVER', 'ATTENDANT', 'SECURITY', 'VENDOR', 'VOLUNTEER', 'CONTRACTOR'], required: true },
    subjectProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    subjectName: { type: String, required: true, trim: true },
    positionTitle: { type: String, default: null },
    // For drivers: which route/vehicle they would be allocated to.
    linkedEntity: { type: String, default: null },
    consent: {
      obtained: { type: Boolean, default: false },
      at: { type: Date, default: null },
      evidenceUrl: { type: String, default: null },
    },
    // Driver specifics kept as fields so allocation can be checked automatically.
    driver: {
      licenceNo: { type: String, default: null },
      licenceClass: { type: String, default: null },
      licenceValidTo: { type: Date, default: null },
      heavyVehicleExperienceYears: { type: Number, default: null },
    },
    checks: [checkSchema],
    hrReview: {
      byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      at: { type: Date, default: null },
      recommendation: { type: String, enum: ['CLEAR', 'CLEAR_WITH_CONDITIONS', 'DO_NOT_CLEAR', null], default: null },
      note: { type: String, default: null },
    },
    decision: {
      status: { type: String, enum: ['CLEARED', 'CLEARED_WITH_CONDITIONS', 'NOT_CLEARED', null], default: null },
      byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      byName: { type: String, default: null },
      at: { type: Date, default: null },
      conditions: { type: String, default: null },
      note: { type: String, default: null },
    },
    // The subject can contest a finding; that never overturns the decision by itself.
    dispute: {
      raisedAt: { type: Date, default: null },
      note: { type: String, default: null },
      resolution: { type: String, default: null },
      resolvedAt: { type: Date, default: null },
    },
    status: { type: String, enum: VERIFICATION_STATUSES, default: 'INITIATED' },
    recheckDueOn: { type: Date, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
verificationCaseSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
verificationCaseSchema.index({ subjectProfileId: 1 });
verificationCaseSchema.index({ status: 1, recheckDueOn: 1 });

verificationCaseSchema.plugin(tenantScoped);
export const VerificationCase = model('VerificationCase', verificationCaseSchema);
