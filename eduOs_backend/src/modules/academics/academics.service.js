import {
  AcademicYear,
  Term,
  Grade,
  Section,
  Subject,
  SubjectOffering,
} from '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import { getTeacherSectionIds } from '../../utils/scope.js';

// ── Academic Years ──
export const listYears = () => AcademicYear.find().sort({ startsOn: -1 });
export const createYear = (data) => AcademicYear.create(data);

// ── Terms ──
export const listTerms = (academicYearId) =>
  Term.find(academicYearId ? { academicYearId } : {}).sort({ startsOn: 1 });
export const createTerm = (data) => Term.create(data);

// ── Grades ──
export const listGrades = () => Grade.find().sort({ level: 1 });
export const createGrade = (data) => Grade.create(data);

// ── Sections ──
export const listSections = (gradeId) =>
  Section.find(gradeId ? { gradeId } : {}).populate('gradeId classTeacherId').sort({ name: 1 });

/**
 * Returns sections the actor is directly linked to:
 * - TEACHER: sections they are classTeacher of + sections they have offerings in
 * - ALL other roles: all sections (unscoped)
 */
export async function getMySections(actor) {
  if (actor.roleKey === 'TEACHER') {
    const sectionIds = await getTeacherSectionIds(actor.profileId);
    return Section.find({ _id: { $in: sectionIds } }).populate('gradeId classTeacherId').sort({ name: 1 });
  }
  return listSections();
}

/**
 * Returns subject offerings the actor can see:
 * - TEACHER: only their own offerings
 * - ALL other roles: unscoped offerings
 */
export async function getMyOfferings(actor) {
  if (actor.roleKey === 'TEACHER') {
    return SubjectOffering.find({ teacherId: actor.profileId }).populate('sectionId subjectId termId teacherId');
  }
  return listOfferings();
}

export async function createSection(data) {
  const grade = await Grade.findById(data.gradeId);
  if (!grade) throw new AppError('Grade not found', 404);
  return Section.create(data);
}

// ── Subjects ──
export const listSubjects = () => Subject.find().sort({ name: 1 });
export const createSubject = (data) => Subject.create(data);

// ── Subject Offerings ──
export const listOfferings = (filter = {}) =>
  SubjectOffering.find(filter).populate('sectionId subjectId termId teacherId');

export async function createOffering(data) {
  const [section, subject, term] = await Promise.all([
    Section.findById(data.sectionId),
    Subject.findById(data.subjectId),
    Term.findById(data.termId),
  ]);
  if (!section) throw new AppError('Section not found', 404);
  if (!subject) throw new AppError('Subject not found', 404);
  if (!term) throw new AppError('Term not found', 404);
  return SubjectOffering.create(data);
}
