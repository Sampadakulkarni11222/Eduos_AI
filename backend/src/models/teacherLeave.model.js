import { Schema, model } from 'mongoose';

/**
 * TeacherLeave — staff leave applications.
 *
 * Teachers (and other staff roles) are not enrolled in sections, so they
 * can't use the student LeaveApplication model which requires an enrollmentId.
 * This model stores staff leaves keyed by profileId instead.
 */
const teacherLeaveSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    /** Display name captured at submission time so the reviewer sees a name
     *  even if the profile is later deactivated. */
    applicantName: { type: String, required: true, trim: true },
    role: { type: String, required: true }, // e.g. TEACHER, LIBRARIAN
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    reason: { type: String, required: true, trim: true },
    leaveType: {
      type: String,
      enum: ['CASUAL', 'SICK', 'EARNED', 'OTHER'],
      default: 'CASUAL',
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
    },
    reviewedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    reviewedAt: { type: Date, default: null },
    remarks: { type: String, default: null },
  },
  { timestamps: true }
);

teacherLeaveSchema.index({ profileId: 1, createdAt: -1 });
teacherLeaveSchema.index({ status: 1, createdAt: -1 });

export const TeacherLeave = model('TeacherLeave', teacherLeaveSchema);
