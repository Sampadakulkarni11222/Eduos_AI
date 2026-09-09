import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * A co-curricular activity on a student's record, and the request that put it
 * there.
 *
 * One collection rather than two: a request *is* the activity, held in a
 * PENDING state until the class teacher decides. Approving it does not copy a
 * row anywhere — the profile simply reads the APPROVED ones, so an approved
 * record and the request it came from can never drift apart.
 */
const coCurricularActivitySchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    // The enrollment the request was raised under, so a record stays attached
    // to the year (and therefore the class teacher) it belongs to.
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', default: null },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', default: null },
    academicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear', default: null },

    name: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ['SPORTS', 'ARTS', 'MUSIC', 'DANCE', 'DRAMA', 'LITERARY', 'SCIENCE', 'SOCIAL_SERVICE', 'LEADERSHIP', 'CLUB', 'OTHER'],
      default: 'OTHER',
    },
    description: { type: String, trim: true, default: null },
    activityDate: { type: Date, required: true },
    achievement: { type: String, trim: true, default: null },
    level: {
      type: String,
      enum: ['SCHOOL', 'INTER_SCHOOL', 'DISTRICT', 'STATE', 'NATIONAL', 'INTERNATIONAL', 'OTHER'],
      default: 'SCHOOL',
    },
    // Optional supporting document. Stored as the /uploads path returned by the
    // upload endpoint; null when the student submitted without one.
    documentUrl: { type: String, default: null },
    documentName: { type: String, default: null },

    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    requestedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    reviewedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);
coCurricularActivitySchema.index({ studentId: 1, status: 1, activityDate: -1 });
coCurricularActivitySchema.index({ sectionId: 1, status: 1, createdAt: -1 });

coCurricularActivitySchema.plugin(tenantScoped); // school-owned
export const CoCurricularActivity = model('CoCurricularActivity', coCurricularActivitySchema);
