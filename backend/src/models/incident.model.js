import { Schema, model } from 'mongoose';

const incidentReportSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', default: null },
    reportedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    date: { type: Date, required: true },
    type: {
      type: String,
      enum: ['BEHAVIOUR', 'BULLYING', 'ATTENDANCE_RELATED', 'PROPERTY_DAMAGE', 'SAFETY', 'OTHER'],
      required: true,
    },
    severity: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH'],
      required: true,
    },
    description: { type: String, required: true, trim: true },
    actionTaken: { type: String, trim: true, default: null },
    status: {
      type: String,
      enum: ['OPEN', 'REVIEWED', 'CLOSED'],
      default: 'OPEN',
    },
    reviewedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

incidentReportSchema.index({ reportedByProfileId: 1, createdAt: -1 });
incidentReportSchema.index({ studentId: 1, createdAt: -1 });
incidentReportSchema.index({ status: 1 });

export const IncidentReport = model('IncidentReport', incidentReportSchema);
