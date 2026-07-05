import { Schema, model } from 'mongoose';

const assignmentSchema = new Schema(
  {
    subjectOfferingId: { type: Schema.Types.ObjectId, ref: 'SubjectOffering', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String },
    type: { type: String, default: 'HOMEWORK' }, // HOMEWORK | PROJECT | WORKSHEET | LAB
    dueAt: { type: Date, required: true },
    maxMarks: { type: Number },
    attachments: { type: [String], default: [] },
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
assignmentSchema.index({ subjectOfferingId: 1, dueAt: 1 });

const submissionSchema = new Schema(
  {
    assignmentId: { type: Schema.Types.ObjectId, ref: 'Assignment', required: true },
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true },
    status: { type: String, enum: ['PENDING', 'SUBMITTED', 'LATE', 'GRADED', 'EXEMPT'], default: 'PENDING' },
    submittedAt: { type: Date },
    marks: { type: Number },
    feedback: { type: String },
    attachments: { type: [String], default: [] },
  },
  { timestamps: true }
);
submissionSchema.index({ assignmentId: 1, enrollmentId: 1 }, { unique: true });

export const Assignment = model('Assignment', assignmentSchema);
export const Submission = model('Submission', submissionSchema);
