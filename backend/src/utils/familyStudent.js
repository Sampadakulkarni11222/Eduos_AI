import mongoose from 'mongoose';
import { AppError } from './AppError.js';
import { getGuardianStudentIds, getOwnStudentId } from './scope.js';

/**
 * The student a self-service request is for (book requests, transport
 * requests): a student's own record, or, for a parent, one of their own
 * children named by `studentId` (a parent with one child may leave it out).
 * The id comes from the session (student) or is checked against the
 * guardian links (parent); a parent can never ask for another family's child.
 */
export async function requestingStudentFor(actor, studentId = null) {
  if (actor?.roleKey === 'PARENT') {
    const kids = (await getGuardianStudentIds(actor.profileId)).map(String);
    if (!kids.length) throw new AppError('No child is linked to your account', 404, [], 'STUDENT_NOT_LINKED');
    if (!studentId) {
      if (kids.length === 1) return kids[0];
      throw new AppError('Choose which of your children this is for.', 400, [], 'CHILD_REQUIRED');
    }
    if (!mongoose.isValidObjectId(String(studentId)) || !kids.includes(String(studentId))) {
      throw new AppError('You can only make requests for your own children.', 403, [], 'STUDENT_OUT_OF_SCOPE');
    }
    return String(studentId);
  }
  const own = await getOwnStudentId(actor?.profileId);
  if (!own) throw new AppError('No student record is linked to this account', 404, [], 'STUDENT_NOT_LINKED');
  return own;
}

/**
 * Whose requests a self-service caller may list or withdraw: a student's own,
 * a parent's children (all of them, or the one named, if it is theirs).
 */
export async function familyStudentIds(actor, studentId = null) {
  if (actor?.roleKey === 'PARENT') {
    if (studentId) return [await requestingStudentFor(actor, studentId)];
    const kids = (await getGuardianStudentIds(actor.profileId)).map(String);
    if (!kids.length) throw new AppError('No child is linked to your account', 404, [], 'STUDENT_NOT_LINKED');
    return kids;
  }
  return [await requestingStudentFor(actor)];
}
