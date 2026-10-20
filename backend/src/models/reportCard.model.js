import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry } from '../modules/ops/common.js';

/**
 * Term report cards.
 *
 *   ReportCardTemplate  the structure: terms, scholastic components and their weightings,
 *                       co-scholastic areas, discipline, grade scale and the result line
 *   TermReportCard      one student's card for one term, prepared from PUBLISHED marks,
 *                       moderated by the class teacher and then the principal
 *   ReportCardVersion   an immutable published snapshot; a correction publishes a new version
 *                       and older versions are kept
 */
const componentSchema = new Schema({
  key: { type: String, required: true },
  label: { type: String, required: true },
  maxMarks: { type: Number, required: true, min: 0 },
  // EXAM: scaled from the published marks of the exam named examName in this term.
  // MANUAL: entered on the card by the subject teacher (notebook, subject enrichment).
  source: { type: String, enum: ['EXAM', 'MANUAL'], default: 'EXAM' },
  examName: { type: String, default: null },
}, { _id: false });

const templateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    board: { type: String, default: 'CBSE' },
    academicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear', default: null },
    gradeIds: [{ type: Schema.Types.ObjectId, ref: 'Grade' }],
    terms: [{
      key: { type: String, required: true },
      name: { type: String, required: true },
      termId: { type: Schema.Types.ObjectId, ref: 'Term', default: null },
      components: [componentSchema],
      _id: false,
    }],
    coScholasticAreas: [{ key: String, label: String, _id: false }],
    coScholasticGrades: { type: [String], default: ['A', 'B', 'C'] },
    disciplineLabel: { type: String, default: 'Discipline' },
    gradeScale: { type: Schema.Types.Mixed, default: null },
    passPercent: { type: Number, default: 33 },
    resultLines: {
      pass: { type: String, default: 'Passed. Eligible for promotion.' },
      needsSupport: { type: String, default: 'Needs improvement in: {subjects}.' },
      interim: { type: String, default: 'Term result. Final result at the end of the year.' },
    },
    finalTermKey: { type: String, default: null },
    active: { type: Boolean, default: true },
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true },
);
templateSchema.index({ tenantId: 1, name: 1 }, { unique: true });

const cardSchema = new Schema(
  {
    templateId: { type: Schema.Types.ObjectId, ref: 'ReportCardTemplate', required: true },
    termKey: { type: String, required: true },
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', required: true },
    status: { type: String, enum: ['DRAFT', 'CLASS_TEACHER_APPROVED', 'PRINCIPAL_APPROVED', 'PUBLISHED'], default: 'DRAFT' },
    // Computed from published marks plus manual entries; regenerated on demand.
    scholastic: { type: Schema.Types.Mixed, default: [] },
    // Entered by hand: { [subjectOfferingId]: { [componentKey]: number|null } }
    manualMarks: { type: Schema.Types.Mixed, default: {} },
    coScholastic: { type: Schema.Types.Mixed, default: {} },
    discipline: { type: String, default: null },
    classTeacherRemarks: { type: String, default: null },
    attendance: { type: Schema.Types.Mixed, default: null },
    summary: { type: Schema.Types.Mixed, default: null },
    resultLine: { type: String, default: null },
    generatedAt: { type: Date, default: null },
    classTeacherApprovedAt: { type: Date, default: null },
    classTeacherApprovedBy: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    principalApprovedAt: { type: Date, default: null },
    principalApprovedBy: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    publishedVersion: { type: Number, default: 0 },
    publishedAt: { type: Date, default: null },
    history: [historyEntry],
  },
  { timestamps: true, minimize: false },
);
cardSchema.index({ tenantId: 1, templateId: 1, termKey: 1, enrollmentId: 1 }, { unique: true });
cardSchema.index({ tenantId: 1, sectionId: 1, termKey: 1 });
cardSchema.index({ tenantId: 1, studentId: 1 });

const versionSchema = new Schema(
  {
    cardId: { type: Schema.Types.ObjectId, ref: 'TermReportCard', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    version: { type: Number, required: true },
    snapshot: { type: Schema.Types.Mixed, required: true },
    publishedAt: { type: Date, default: Date.now },
    publishedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    correctionNote: { type: String, default: null },
    supersededAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false },
);
versionSchema.index({ tenantId: 1, cardId: 1, version: 1 }, { unique: true });
versionSchema.index({ tenantId: 1, studentId: 1, publishedAt: -1 });

for (const s of [templateSchema, cardSchema, versionSchema]) s.plugin(tenantScoped);
export const ReportCardTemplate = model('ReportCardTemplate', templateSchema);
export const TermReportCard = model('TermReportCard', cardSchema);
export const ReportCardVersion = model('ReportCardVersion', versionSchema);
