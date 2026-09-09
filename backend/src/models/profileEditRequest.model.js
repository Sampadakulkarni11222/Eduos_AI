import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * A student's request to correct their own profile information.
 *
 * The student never writes to the Student document. They write one of these,
 * carrying the old and the requested value for each field, and only an
 * approval applies it — so the profile itself is only ever changed by someone
 * authorised to change it.
 *
 * Old values are stored alongside the new ones deliberately: a decision taken
 * a week later has to be readable against what the record actually said when
 * the request was raised, not against whatever it says now.
 */
const changeSchema = new Schema(
  {
    field: { type: String, required: true },
    label: { type: String, required: true },
    oldValue: { type: String, default: null },
    newValue: { type: String, default: null },
  },
  { _id: false }
);

const profileEditRequestSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', default: null },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', default: null },

    changes: { type: [changeSchema], required: true },
    note: { type: String, trim: true, default: null },
    documentUrl: { type: String, default: null },
    documentName: { type: String, default: null },

    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    requestedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    requestedAt: { type: Date, default: Date.now },
    reviewedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);
profileEditRequestSchema.index({ studentId: 1, createdAt: -1 });
profileEditRequestSchema.index({ sectionId: 1, status: 1, createdAt: -1 });

profileEditRequestSchema.plugin(tenantScoped); // school-owned
export const ProfileEditRequest = model('ProfileEditRequest', profileEditRequestSchema);
