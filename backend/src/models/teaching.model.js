import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry } from '../modules/ops/common.js';

/**
 * A teacher's planning and professional record (part 4, teacher audit):
 *
 *   LessonPlan     one lesson for one class and subject on one day: objectives,
 *                  the 5E flow with minutes, teaching aids, NEP pedagogies,
 *                  differentiation, a competency check and homework. Taught, it
 *                  feeds the syllabus tracker (and optionally a real assignment)
 *                  and keeps the teacher's reflection. A coordinator may leave
 *                  feedback; nobody approves a plan.
 *   BankQuestion   the school's shared question bank: subject, class, chapter,
 *                  question type, marks, cognitive level and whether it is
 *                  competency-based (CBSE asks for about half of a paper).
 *   QuestionPaper  a paper assembled from the bank against a blueprint, with
 *                  the checks a head of department makes before printing.
 *   CpdEntry       hours of professional development a teacher logs (CBSE: at
 *                  least 50 a year, 25 external and 25 in-house); attended
 *                  in-house trainings are counted from the trainings register.
 */

export const PEDAGOGIES = ['EXPERIENTIAL', 'INQUIRY', 'ART_INTEGRATED', 'SPORTS_INTEGRATED', 'TOY_BASED', 'STORYTELLING', 'PEER_LEARNING', 'PROJECT', 'DIGITAL', 'FIELD_VISIT'];
export const PHASES = ['ENGAGE', 'EXPLORE', 'EXPLAIN', 'ELABORATE', 'EVALUATE'];
export const PLAN_STATUSES = ['DRAFT', 'READY', 'TAUGHT'];

const lessonPlanSchema = new Schema(
  {
    teacherId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    subjectOfferingId: { type: Schema.Types.ObjectId, ref: 'SubjectOffering', required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', required: true },
    courseModuleId: { type: Schema.Types.ObjectId, ref: 'CourseModule', default: null },
    date: { type: Date, required: true },
    periodNo: { type: Number, default: null, min: 0, max: 15 },
    durationMinutes: { type: Number, default: 40, min: 10, max: 240 },
    title: { type: String, required: true, trim: true },
    topicIds: [{ type: String }],
    objectives: [{ type: String }],
    learningOutcomes: { type: String, default: null },
    pedagogies: [{ type: String, enum: PEDAGOGIES }],
    materials: { type: String, default: null },
    steps: [{ phase: { type: String, enum: PHASES }, minutes: Number, activity: String, _id: false }],
    differentiation: { type: String, default: null },
    assessment: { type: String, default: null },
    competencyCheck: { type: String, default: null },
    homework: { type: String, default: null },
    status: { type: String, enum: PLAN_STATUSES, default: 'DRAFT' },
    taughtAt: { type: Date, default: null },
    reflection: { type: String, default: null },
    homeworkAssignmentId: { type: Schema.Types.ObjectId, ref: 'Assignment', default: null },
    source: { type: String, enum: ['MANUAL', 'SUGGESTED'], default: 'MANUAL' },
    feedback: [{ at: { type: Date, default: Date.now }, byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' }, byName: String, note: String, _id: false }],
    history: [historyEntry],
  },
  { timestamps: true },
);
lessonPlanSchema.index({ tenantId: 1, teacherId: 1, date: -1 });
lessonPlanSchema.index({ tenantId: 1, subjectOfferingId: 1, date: -1 });

export const QUESTION_TYPES = ['MCQ', 'ASSERTION_REASON', 'VSA', 'SA', 'LA', 'CASE_BASED', 'SOURCE_BASED', 'MAP_DIAGRAM'];
export const BLOOM_LEVELS = ['REMEMBER', 'UNDERSTAND', 'APPLY', 'ANALYSE', 'EVALUATE', 'CREATE'];
export const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'];

const bankQuestionSchema = new Schema(
  {
    subjectId: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
    gradeId: { type: Schema.Types.ObjectId, ref: 'Grade', required: true },
    chapter: { type: String, required: true, trim: true },
    type: { type: String, enum: QUESTION_TYPES, required: true },
    marks: { type: Number, required: true, min: 0.5, max: 20 },
    bloom: { type: String, enum: BLOOM_LEVELS, default: 'UNDERSTAND' },
    competencyBased: { type: Boolean, default: false },
    difficulty: { type: String, enum: DIFFICULTIES, default: 'MEDIUM' },
    text: { type: String, required: true },
    options: [{ text: String, isCorrect: { type: Boolean, default: false }, _id: false }],
    answer: { type: String, default: null },
    markingScheme: { type: String, default: null },
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    createdByName: { type: String, default: null },
    timesUsed: { type: Number, default: 0 },
    lastUsedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
bankQuestionSchema.index({ tenantId: 1, subjectId: 1, gradeId: 1, chapter: 1 });

const paperSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    subjectId: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
    gradeId: { type: Schema.Types.ObjectId, ref: 'Grade', required: true },
    examSubjectId: { type: Schema.Types.ObjectId, ref: 'ExamSubject', default: null },
    durationMinutes: { type: Number, default: 180 },
    targetMarks: { type: Number, default: null },
    competencyTargetPct: { type: Number, default: 50, min: 0, max: 100 },
    instructions: { type: String, default: null },
    sections: [{ title: String, instructions: String, questionIds: [{ type: Schema.Types.ObjectId, ref: 'BankQuestion' }], _id: false }],
    status: { type: String, enum: ['DRAFT', 'FINAL'], default: 'DRAFT' },
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    createdByName: { type: String, default: null },
    history: [historyEntry],
  },
  { timestamps: true },
);
paperSchema.index({ tenantId: 1, subjectId: 1, gradeId: 1, createdAt: -1 });

export const CPD_MODES = ['EXTERNAL', 'IN_HOUSE'];
export const NPST_AREAS = ['CORE_VALUES', 'KNOWLEDGE_PRACTICE', 'PROFESSIONAL_GROWTH'];

const cpdEntrySchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    title: { type: String, required: true, trim: true },
    provider: { type: String, default: null },
    mode: { type: String, enum: CPD_MODES, required: true },
    area: { type: String, enum: NPST_AREAS, required: true },
    hours: { type: Number, required: true, min: 0.5, max: 100 },
    date: { type: Date, required: true },
    online: { type: Boolean, default: false },
    evidenceUrl: { type: String, default: null },
    note: { type: String, default: null },
    // Checked against the certificate by HR or the principal; never by the teacher.
    verifiedAt: { type: Date, default: null },
    verifiedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
cpdEntrySchema.index({ tenantId: 1, profileId: 1, date: -1 });

for (const s of [lessonPlanSchema, bankQuestionSchema, paperSchema, cpdEntrySchema]) s.plugin(tenantScoped);
export const LessonPlan = model('LessonPlan', lessonPlanSchema);
export const BankQuestion = model('BankQuestion', bankQuestionSchema);
export const QuestionPaper = model('QuestionPaper', paperSchema);
export const CpdEntry = model('CpdEntry', cpdEntrySchema);
