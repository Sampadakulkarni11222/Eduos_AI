import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

const examSchema = new Schema(
  {
    termId: { type: Schema.Types.ObjectId, ref: 'Term', required: true },
    name: { type: String, required: true, trim: true }, // "PT1", "Midterm", "Final"
    startsOn: { type: Date, required: true },
    endsOn: { type: Date, required: true },
  },
  { timestamps: true }
);

const examSubjectSchema = new Schema(
  {
    examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true },
    subjectOfferingId: { type: Schema.Types.ObjectId, ref: 'SubjectOffering', required: true },
    examDate: { type: Date },
    maxMarks: { type: Number, default: 100 },
  },
  { timestamps: true }
);
examSubjectSchema.index({ examId: 1, subjectOfferingId: 1 }, { unique: true });

const markSchema = new Schema(
  {
    examSubjectId: { type: Schema.Types.ObjectId, ref: 'ExamSubject', required: true },
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true },
    marks: { type: Number },
    // Why there is no score: AB (absent) or ML (medical leave). Kept apart
    // from `marks` so "not entered yet" (both null) is never mistaken for an
    // absence, and an absence is never counted as zero in any total.
    absence: { type: String, enum: ['AB', 'ML', null], default: null },
    gradeLabel: { type: String },
    remarks: { type: String },
    status: { type: String, enum: ['DRAFT', 'REVIEW', 'PUBLISHED'], default: 'DRAFT' },
    publishedAt: { type: Date },
    enteredByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true }
);
markSchema.index({ examSubjectId: 1, enrollmentId: 1 }, { unique: true });
// Published-result totals per paper (syllabus overview, analytics) group marks
// by paper; with status and marks in the index that read is answered from the
// index alone instead of fetching every mark document.
markSchema.index({ tenantId: 1, examSubjectId: 1, status: 1, marks: 1 });

examSchema.plugin(tenantScoped); // school-owned
export const Exam = model('Exam', examSchema);
examSubjectSchema.plugin(tenantScoped); // school-owned
export const ExamSubject = model('ExamSubject', examSubjectSchema);
markSchema.plugin(tenantScoped); // school-owned
export const Mark = model('Mark', markSchema);
