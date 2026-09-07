import { Section, SubjectOffering } from '../models/academics.model.js';
import { Student, StudentGuardian, Enrollment } from '../models/student.model.js';

/**
 * Resolves the section IDs a teacher can act on: sections they are the
 * class teacher of, plus sections they hold a subject offering in.
 */
export async function getTeacherSectionIds(profileId) {
  const [classSections, offerings] = await Promise.all([
    Section.find({ classTeacherId: profileId }).select('_id'),
    SubjectOffering.find({ teacherId: profileId }).select('sectionId'),
  ]);
  const ids = new Set([
    ...classSections.map((s) => s._id.toString()),
    ...offerings.map((o) => o.sectionId.toString()),
  ]);
  return [...ids];
}

/**
 * Sections a teacher is the *class teacher* of — a strict subset of
 * getTeacherSectionIds(), which also counts sections they merely hold a
 * subject in.
 *
 * Approving a student's profile correction or their co-curricular record is a
 * class-teacher duty, not something every subject teacher who happens to take
 * that room may do, so those queues resolve their scope through this.
 */
export async function getClassTeacherSectionIds(profileId) {
  const sections = await Section.find({ classTeacherId: profileId }).select('_id');
  return sections.map((s) => s._id.toString());
}

/** Resolves the student IDs linked to a parent/guardian profile. */
export async function getGuardianStudentIds(profileId) {
  const links = await StudentGuardian.find({ guardianProfileId: profileId }).select('studentId');
  return links.map((l) => l.studentId.toString());
}

/** Resolves the student's own record ID from their login profile ID. */
export async function getOwnStudentId(profileId) {
  const student = await Student.findOne({ profileId }).select('_id');
  return student?._id?.toString() ?? null;
}

/** Resolves enrollment IDs for a given list of student IDs (active enrollments). */
export async function getEnrollmentIdsForStudents(studentIds) {
  const enrollments = await Enrollment.find({ studentId: { $in: studentIds } }).select('_id');
  return enrollments.map((e) => e._id.toString());
}
