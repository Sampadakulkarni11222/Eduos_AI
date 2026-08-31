import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

const academicYearSchema = new Schema(
  {
    name: { type: String, required: true, trim: true }, // "2026-27" — unique per school
    startsOn: { type: Date, required: true },
    endsOn: { type: Date, required: true },
    isCurrent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const termSchema = new Schema(
  {
    academicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    name: { type: String, required: true, trim: true }, // "Term 1"
    startsOn: { type: Date, required: true },
    endsOn: { type: Date, required: true },
  },
  { timestamps: true }
);

const gradeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true }, // "Class 5" — unique per school
    level: { type: Number, required: true }, // sort order
  },
  { timestamps: true }
);

const sectionSchema = new Schema(
  {
    gradeId: { type: Schema.Types.ObjectId, ref: 'Grade', required: true },
    name: { type: String, required: true, trim: true }, // "A"
    classTeacherId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    classRepresentativeId: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
  },
  { timestamps: true }
);
academicYearSchema.index({ tenantId: 1, name: 1 }, { unique: true });
gradeSchema.index({ tenantId: 1, name: 1 }, { unique: true });
// gradeId is already school-specific, so this one needs no tenant column.
sectionSchema.index({ gradeId: 1, name: 1 }, { unique: true });

const subjectSchema = new Schema(
  {
    name: { type: String, required: true, trim: true }, // unique per school
    code: { type: String, trim: true },
  },
  { timestamps: true }
);

const subjectOfferingSchema = new Schema(
  {
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', required: true },
    subjectId: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
    termId: { type: Schema.Types.ObjectId, ref: 'Term', required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    // Electives are the only offerings a student may register for themselves;
    // core subjects stay implicit in the section enrollment, as they always
    // have been. See modules/registrations.
    isElective: { type: Boolean, default: false },
    // Seat cap for an elective. null = uncapped. Counted against APPROVED and
    // PENDING registrations so a run on the last seat can't be double-promised.
    capacity: { type: Number, default: null, min: 1 },
  },
  { timestamps: true }
);
subjectSchema.index({ tenantId: 1, name: 1 }, { unique: true });
subjectOfferingSchema.index({ sectionId: 1, subjectId: 1, termId: 1 }, { unique: true });
subjectOfferingSchema.index({ isElective: 1, termId: 1 });

academicYearSchema.plugin(tenantScoped); // school-owned
export const AcademicYear = model('AcademicYear', academicYearSchema);
termSchema.plugin(tenantScoped); // school-owned
export const Term = model('Term', termSchema);
gradeSchema.plugin(tenantScoped); // school-owned
export const Grade = model('Grade', gradeSchema);
sectionSchema.plugin(tenantScoped); // school-owned
export const Section = model('Section', sectionSchema);
subjectSchema.plugin(tenantScoped); // school-owned
export const Subject = model('Subject', subjectSchema);
subjectOfferingSchema.plugin(tenantScoped); // school-owned
export const SubjectOffering = model('SubjectOffering', subjectOfferingSchema);
