import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { attachmentEntry } from '../modules/ops/common.js';

/**
 * Competency portfolios (CBSE/NEP-aligned competencies).
 *
 * Evidence that already exists elsewhere (assignments, report-card
 * co-scholastic grades, clubs, fixtures, showcase, lab practicals, eco
 * activities, co-curricular records) is read live from those records and is
 * not copied here. This holds only what the portfolio itself adds:
 *
 *   PortfolioEvidence    evidence a teacher adds by hand (a note, a link, a file)
 *   PortfolioRating      a teacher's rubric level per competency and term:
 *                        DEVELOPING / PROFICIENT / ADVANCED, with a comment.
 *                        No numeric score and nothing about behaviour.
 *   PortfolioReflection  a student's own reflection
 */
export const RUBRIC_LEVELS = ['DEVELOPING', 'PROFICIENT', 'ADVANCED'];

const evidenceSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    competencyKey: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    on: { type: Date, default: Date.now },
    link: { type: String, default: null },
    attachments: [attachmentEntry],
    addedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    addedByName: { type: String, default: null },
  },
  { timestamps: true },
);
evidenceSchema.index({ tenantId: 1, studentId: 1, competencyKey: 1 });

const ratingSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    competencyKey: { type: String, required: true },
    term: { type: String, required: true },
    level: { type: String, enum: RUBRIC_LEVELS, required: true },
    comment: { type: String, default: null },
    ratedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    ratedByName: { type: String, default: null },
    ratedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
ratingSchema.index({ tenantId: 1, studentId: 1, competencyKey: 1, term: 1 }, { unique: true });

const reflectionSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    competencyKey: { type: String, default: null },
    text: { type: String, required: true },
    byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true },
);
reflectionSchema.index({ tenantId: 1, studentId: 1, createdAt: -1 });

for (const s of [evidenceSchema, ratingSchema, reflectionSchema]) s.plugin(tenantScoped);
export const PortfolioEvidence = model('PortfolioEvidence', evidenceSchema);
export const PortfolioRating = model('PortfolioRating', ratingSchema);
export const PortfolioReflection = model('PortfolioReflection', reflectionSchema);
