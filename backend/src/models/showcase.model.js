import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry } from '../modules/ops/common.js';

/**
 * The achievement and top-ranker showcase.
 *
 *   ShowcaseSetting  one per school: the rank cut-off (only ranks 1..cutoff
 *                    are ever drafted, published or shown)
 *   ShowcaseEdition  a set of entries published together ("Term 1, 2026-27")
 *   ShowcaseEntry    one child and one honour: a rank from published exam
 *                    results, or an achievement (sports, arts, olympiad)
 *
 * An entry is drafted, reviewed by a second person, and published with its
 * edition; at that moment the child's media consent, the cut-off and the
 * results it came from are checked again, and an entry that fails is left out
 * (EXCLUDED, with the reason) rather than published. Reads check consent
 * again, so a consent withdrawn later hides the entry straight away.
 */

const settingSchema = new Schema(
  {
    rankCutoff: { type: Number, default: 3, min: 1, max: 10 },
    updatedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true }
);

const editionSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    periodLabel: { type: String, default: null },
    description: { type: String, default: '' },
    status: { type: String, enum: ['DRAFT', 'PUBLISHED', 'WITHDRAWN'], default: 'DRAFT' },
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    publishedAt: { type: Date, default: null },
    publishedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    withdrawnAt: { type: Date, default: null },
    withdrawReason: { type: String, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
editionSchema.index({ status: 1, publishedAt: -1 });

export const ENTRY_CATEGORIES = ['ACADEMIC', 'SPORTS', 'ARTS', 'OLYMPIAD', 'SERVICE', 'OTHER'];
export const ENTRY_STATUSES = ['DRAFT', 'REVIEWED', 'PUBLISHED', 'EXCLUDED', 'WITHDRAWN'];

const entrySchema = new Schema(
  {
    editionId: { type: Schema.Types.ObjectId, ref: 'ShowcaseEdition', required: true },
    kind: { type: String, enum: ['RANK', 'ACHIEVEMENT'], required: true },
    category: { type: String, enum: ENTRY_CATEGORIES, required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    title: { type: String, required: true, trim: true },
    detail: { type: String, default: null },
    level: { type: String, default: null },
    // RANK entries: where the rank came from. The percentage is kept for the
    // audit of the tie rule and is never shown on the showcase.
    rank: { type: Number, default: null, min: 1 },
    rankScope: { type: String, enum: ['SECTION', 'GRADE', null], default: null },
    examId: { type: Schema.Types.ObjectId, ref: 'Exam', default: null },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', default: null },
    gradeId: { type: Schema.Types.ObjectId, ref: 'Grade', default: null },
    percentage: { type: Number, default: null },
    source: {
      type: { type: String, enum: ['EXAM', 'COCURRICULAR', 'FIXTURE', 'MANUAL'], default: 'MANUAL' },
      id: { type: Schema.Types.ObjectId, default: null },
    },
    status: { type: String, enum: ENTRY_STATUSES, default: 'DRAFT' },
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    reviewedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    reviewedAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    excludedReason: { type: String, default: null },
    withdrawnAt: { type: Date, default: null },
    withdrawReason: { type: String, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
entrySchema.index({ editionId: 1, status: 1 });
entrySchema.index({ studentId: 1, status: 1 });

for (const s of [settingSchema, editionSchema, entrySchema]) s.plugin(tenantScoped);

export const ShowcaseSetting = model('ShowcaseSetting', settingSchema);
export const ShowcaseEdition = model('ShowcaseEdition', editionSchema);
export const ShowcaseEntry = model('ShowcaseEntry', entrySchema);
