import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry, attachmentEntry } from '../modules/ops/common.js';

/**
 * Accreditation preparation: one cycle per framework (NAAC, NBA, a board
 * inspection, or the institution's own), broken into criteria, each holding
 * the evidence items the institution must be able to show.
 *
 * The system holds the checklist, the owners and the proof. It does not score
 * the institution, predict a grade or submit anything to an agency: a cycle is
 * marked submitted only when a person records that it was.
 */
const evidenceItemSchema = new Schema({
  metric: { type: String, required: true, trim: true },
  ownerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  ownerName: { type: String, default: null },
  dueOn: { type: Date, default: null },
  // READY means the evidence is attached and a person has said it is complete.
  status: { type: String, enum: ['NOT_STARTED', 'IN_PROGRESS', 'READY', 'NOT_APPLICABLE'], default: 'NOT_STARTED' },
  note: { type: String, default: null },
  evidence: [attachmentEntry],
  updatedAt: { type: Date, default: Date.now },
});

const criterionSchema = new Schema({
  code: { type: String, required: true, trim: true },
  title: { type: String, required: true, trim: true },
  items: [evidenceItemSchema],
});

const accreditationCycleSchema = new Schema(
  {
    refNo: { type: String, required: true },
    framework: { type: String, enum: ['NAAC', 'NBA', 'BOARD_INSPECTION', 'CUSTOM'], required: true },
    title: { type: String, required: true, trim: true },
    programme: { type: String, default: null }, // NBA accredits a programme, not the institution
    targetDate: { type: Date, default: null },
    status: { type: String, enum: ['PREPARING', 'SUBMITTED', 'CLOSED'], default: 'PREPARING' },
    // The criteria headings come from a starting template; the institution must
    // check them against the agency's current manual before relying on them.
    templateVerified: { type: Boolean, default: false },
    templateNote: { type: String, default: null },
    criteria: [criterionSchema],
    submission: { at: { type: Date, default: null }, reference: { type: String, default: null }, evidence: [attachmentEntry] },
    outcome: { type: String, default: null },
    history: [historyEntry],
  },
  { timestamps: true },
);
accreditationCycleSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });

accreditationCycleSchema.plugin(tenantScoped);
export const AccreditationCycle = model('AccreditationCycle', accreditationCycleSchema);
