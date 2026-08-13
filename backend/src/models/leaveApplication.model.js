import { Schema, model } from 'mongoose';

const leaveApplicationSchema = new Schema(
  {
    applicantProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    applicantRole: { type: String, enum: ['STUDENT', 'TEACHER'], default: 'STUDENT' },
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', default: null },
    leaveType: {
      type: String,
      enum: ['SICK', 'CASUAL', 'PERSONAL', 'DUTY', 'OTHER'],
      default: 'CASUAL',
    },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    reason: { type: String, required: true, trim: true },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    reviewedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    reviewedAt: { type: Date, default: null },
    remarks: { type: String, default: null },
  },
  { timestamps: true }
);

leaveApplicationSchema.index({ applicantProfileId: 1, createdAt: -1 });
leaveApplicationSchema.index({ enrollmentId: 1, createdAt: -1 });
leaveApplicationSchema.index({ status: 1, createdAt: -1 });

export const LeaveApplication = model('LeaveApplication', leaveApplicationSchema);
