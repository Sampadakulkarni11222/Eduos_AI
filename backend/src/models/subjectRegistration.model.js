import { Schema, model } from 'mongoose';

/**
 * A student's request to take an elective subject offering.
 *
 * Distinct from Enrollment: Enrollment puts a student in a *section* for a
 * year and implicitly gives them that section's core subjects. This records the
 * one thing the student chooses for themselves, and it is a request rather than
 * a fact until staff decide on it.
 */
const subjectRegistrationSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    subjectOfferingId: { type: Schema.Types.ObjectId, ref: 'SubjectOffering', required: true },
    // Denormalised from the enrollment at request time so a registration stays
    // attributable to the year it was made in even after the student moves on.
    academicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'],
      default: 'PENDING',
    },
    // Kept for the audit story: who decided, when, and why.
    decidedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

// One live request per student per offering. Partial rather than plain unique:
// a student whose request was rejected or who withdrew should be able to apply
// again, but must not hold two open requests for the same elective at once.
subjectRegistrationSchema.index(
  { studentId: 1, subjectOfferingId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['PENDING', 'APPROVED'] } } }
);
subjectRegistrationSchema.index({ subjectOfferingId: 1, status: 1 }); // seat counts
subjectRegistrationSchema.index({ status: 1, createdAt: -1 }); // staff review queue

export const SubjectRegistration = model('SubjectRegistration', subjectRegistrationSchema);
