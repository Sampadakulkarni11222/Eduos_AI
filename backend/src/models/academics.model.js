import { Schema, model } from 'mongoose';

const academicYearSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true }, // "2026-27"
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
    name: { type: String, required: true, unique: true, trim: true }, // "Class 5"
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
sectionSchema.index({ gradeId: 1, name: 1 }, { unique: true });

const subjectSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
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
subjectOfferingSchema.index({ sectionId: 1, subjectId: 1, termId: 1 }, { unique: true });
subjectOfferingSchema.index({ isElective: 1, termId: 1 });

export const AcademicYear = model('AcademicYear', academicYearSchema);
export const Term = model('Term', termSchema);
export const Grade = model('Grade', gradeSchema);
export const Section = model('Section', sectionSchema);
export const Subject = model('Subject', subjectSchema);
export const SubjectOffering = model('SubjectOffering', subjectOfferingSchema);
