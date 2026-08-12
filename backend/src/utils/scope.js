import mongoose from 'mongoose';
import { Section, SubjectOffering } from '../models/academics.model.js';
import { Student, StudentGuardian, Enrollment } from '../models/student.model.js';

/**
 * Resolves the section IDs a teacher can act on: sections they are the
 * class teacher of, plus sections they hold a subject offering in.
 */
export async function getTeacherSectionIds(profileId) {
  if (!profileId) return [];
  const pId = mongoose.Types.ObjectId.isValid(profileId)
    ? new mongoose.Types.ObjectId(profileId)
    : profileId;
  const [classSections, offerings] = await Promise.all([
    Section.find({ classTeacherId: { $in: [profileId, pId] } }).select('_id'),
    SubjectOffering.find({ teacherId: { $in: [profileId, pId] } }).select('sectionId'),
  ]);
  const ids = new Set([
    ...classSections.map((s) => s._id?.toString()).filter(Boolean),
    ...offerings.map((o) => o.sectionId?.toString()).filter(Boolean),
  ]);
  return [...ids];
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
