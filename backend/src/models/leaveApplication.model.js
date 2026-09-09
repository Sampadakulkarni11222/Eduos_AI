import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

const leaveApplicationSchema = new Schema(
  {
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    reason: { type: String, required: true, trim: true },
    /**
     * Optional supporting document — a medical certificate, most often.
     *
     * Optional in the real sense: an application with no document is a
     * complete application, and nothing downstream requires one. Stored as the
     * /uploads path the upload endpoint returned.
     */
    documentUrl: { type: String, default: null },
    documentName: { type: String, default: null },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    reviewedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    reviewedAt: { type: Date, default: null },
    remarks: { type: String, default: null },
  },
  { timestamps: true }
);
leaveApplicationSchema.index({ enrollmentId: 1, createdAt: -1 });

leaveApplicationSchema.plugin(tenantScoped); // school-owned
export const LeaveApplication = model('LeaveApplication', leaveApplicationSchema);
