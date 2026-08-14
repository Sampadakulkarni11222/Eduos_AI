import { Schema, model } from 'mongoose';

const leaveApplicationSchema = new Schema(
  {
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true },
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
leaveApplicationSchema.index({ enrollmentId: 1, createdAt: -1 });

export const LeaveApplication = model('LeaveApplication', leaveApplicationSchema);
