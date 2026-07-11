import { Schema, model } from 'mongoose';

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
    gradeLabel: { type: String },
    remarks: { type: String },
    status: { type: String, enum: ['DRAFT', 'REVIEW', 'PUBLISHED'], default: 'DRAFT' },
    publishedAt: { type: Date },
    enteredByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true }
);
markSchema.index({ examSubjectId: 1, enrollmentId: 1 }, { unique: true });

export const Exam = model('Exam', examSchema);
export const ExamSubject = model('ExamSubject', examSubjectSchema);
export const Mark = model('Mark', markSchema);
