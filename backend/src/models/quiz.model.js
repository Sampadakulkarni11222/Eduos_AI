import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * An MCQ quiz a teacher sets for one of their subject offerings.
 *
 * The offering is the teacher-class-subject assignment the rest of the ERP
 * already uses (assignments, exams, attendance), so "may this teacher set a
 * quiz here" and "may this student see it" are answered by the same records
 * that answer those questions everywhere else. sectionId/subjectId are
 * denormalised from it so lists can filter without a join.
 *
 * Questions and their options are embedded: they are only ever read and
 * written through their quiz, and one document makes "publish only when every
 * question is complete" a check on one record rather than three collections.
 */
const quizOptionSchema = new Schema({
  text: { type: String, required: true, trim: true },
  order: { type: Number, required: true },
  isCorrect: { type: Boolean, default: false },
});

const quizQuestionSchema = new Schema({
  text: { type: String, required: true, trim: true },
  marks: { type: Number, required: true, min: 0.5, default: 1 },
  order: { type: Number, required: true },
  options: { type: [quizOptionSchema], default: [] },
});

const quizSchema = new Schema(
  {
    subjectOfferingId: { type: Schema.Types.ObjectId, ref: 'SubjectOffering', required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', required: true },
    subjectId: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
    // The teacher who owns the quiz. Only they (or a school-wide manager) may change it.
    teacherId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    // null = untimed.
    durationMinutes: { type: Number, default: null, min: 1 },
    status: { type: String, enum: ['DRAFT', 'PUBLISHED'], default: 'DRAFT' },
    publishedAt: { type: Date, default: null },
    questions: { type: [quizQuestionSchema], default: [] },
    // Kept in step with the questions on every save; never taken from a request.
    totalMarks: { type: Number, default: 0 },
    deletedAt: { type: Date, default: null },
  },
  // Every save is checked against the version it was loaded at, so two
  // teachers' tabs editing the same quiz cannot silently overwrite each other.
  { timestamps: true, optimisticConcurrency: true }
);
quizSchema.index({ teacherId: 1, createdAt: -1 });
quizSchema.index({ sectionId: 1, status: 1 });

quizSchema.pre('validate', function computeTotalMarks(next) {
  const total = (this.questions ?? []).reduce((sum, q) => sum + (Number(q.marks) || 0), 0);
  this.totalMarks = Math.round(total * 100) / 100;
  next();
});

/**
 * One student's go at a quiz, graded on the server when it is submitted.
 *
 * `answers` records what was chosen and what it earned, so the result can be
 * shown again later without re-grading against questions that may since have
 * changed.
 */
const quizAnswerSchema = new Schema(
  {
    questionId: { type: Schema.Types.ObjectId, required: true },
    selectedOptionId: { type: Schema.Types.ObjectId, default: null },
    isCorrect: { type: Boolean, default: false },
    marksAwarded: { type: Number, default: 0 },
  },
  { _id: false }
);

const quizAttemptSchema = new Schema(
  {
    quizId: { type: Schema.Types.ObjectId, ref: 'Quiz', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true },
    // LATE = submitted after the quiz's time limit had run out.
    status: { type: String, enum: ['IN_PROGRESS', 'SUBMITTED', 'LATE'], default: 'IN_PROGRESS' },
    startedAt: { type: Date, required: true },
    submittedAt: { type: Date, default: null },
    score: { type: Number, default: 0 },
    totalMarks: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    wrongCount: { type: Number, default: 0 },
    unansweredCount: { type: Number, default: 0 },
    answers: { type: [quizAnswerSchema], default: [] },
  },
  { timestamps: true }
);
// One attempt per student per quiz, enforced by the database rather than by a
// read-then-write that two simultaneous submits could both pass.
quizAttemptSchema.index({ quizId: 1, studentId: 1 }, { unique: true });
quizAttemptSchema.index({ studentId: 1, submittedAt: -1 });

quizSchema.plugin(tenantScoped); // school-owned
export const Quiz = model('Quiz', quizSchema);
quizAttemptSchema.plugin(tenantScoped); // school-owned
export const QuizAttempt = model('QuizAttempt', quizAttemptSchema);
