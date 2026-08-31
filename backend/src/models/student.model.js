import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

const studentSchema = new Schema(
  {
    admissionNo: { type: String, required: true, trim: true }, // unique per school
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, trim: true },
    dob: { type: Date },
    gender: { type: String },
    address: { type: String, trim: true },
    photoUrl: { type: String },
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null }, // student's own login profile, powers OWN scope
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', default: null },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
    deletedAt: { type: Date, default: null },
    // Set once personal data has been irreversibly erased. Distinct from
    // deletedAt: a record can be withdrawn (soft-deleted) while its PII is
    // still held, which is the state this flag exists to end.
    anonymisedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
studentSchema.index({ tenantId: 1, admissionNo: 1 }, { unique: true });
studentSchema.index({ lastName: 1, firstName: 1 });

const studentGuardianSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    guardianProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    relation: { type: String, enum: ['FATHER', 'MOTHER', 'GUARDIAN'], required: true },
    isPrimary: { type: Boolean, default: false },
    pickupAuthorized: { type: Boolean, default: true },
  },
  { timestamps: true }
);
studentGuardianSchema.index({ studentId: 1, guardianProfileId: 1 }, { unique: true });

const enrollmentSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', required: true },
    academicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    rollNo: { type: Number },
    status: {
      type: String,
      enum: ['ACTIVE', 'TRANSFERRED', 'WITHDRAWN', 'GRADUATED'],
      default: 'ACTIVE',
    },
  },
  { timestamps: true }
);
enrollmentSchema.index({ studentId: 1, academicYearId: 1 }, { unique: true });
enrollmentSchema.index({ sectionId: 1 });
// Prevent two students in the same section+year from sharing a roll number.
// sparse:true allows multiple NULL rollNo values (unassigned students).
enrollmentSchema.index({ sectionId: 1, academicYearId: 1, rollNo: 1 }, { unique: true, sparse: true });

studentSchema.plugin(tenantScoped); // school-owned
export const Student = model('Student', studentSchema);
studentGuardianSchema.plugin(tenantScoped); // school-owned
export const StudentGuardian = model('StudentGuardian', studentGuardianSchema);
enrollmentSchema.plugin(tenantScoped); // school-owned
export const Enrollment = model('Enrollment', enrollmentSchema);
