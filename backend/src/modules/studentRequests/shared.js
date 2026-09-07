import { Student, Enrollment } from '../../models/student.model.js';
import { Section } from '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import { getClassTeacherSectionIds, getOwnStudentId } from '../../utils/scope.js';

/** Anything the student could paste into a stored field, trimmed and capped. */
export function cleanText(value, max = 500) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

/**
 * Accepts an optional supporting document.
 *
 * Optional in the real sense: no document at all is a valid submission, so an
 * absent, empty or whitespace-only url yields nulls rather than an error. What
 * is rejected is a *present* value that isn't a file this server issued or a
 * plain http(s) link — that check has to live here as well as in the browser,
 * because the browser's copy is advice and this one is the rule.
 */
export function normaliseAttachment({ documentUrl, documentName } = {}) {
  const url = cleanText(documentUrl, 600);
  if (!url) return { documentUrl: null, documentName: null };
  const isStoredUpload = url.startsWith('/uploads/');
  const isHttp = /^https?:\/\//i.test(url);
  if (!isStoredUpload && !isHttp) {
    throw new AppError('Supporting document must be an uploaded file or an http(s) link', 400, [], 'INVALID_ATTACHMENT');
  }
  return { documentUrl: url, documentName: cleanText(documentName, 160) };
}

/** The signed-in student's own record plus their active enrollment context. */
export async function resolveStudentContext(actor) {
  const student = await Student.findOne({ profileId: actor.profileId, deletedAt: null })
    .select('_id firstName lastName dob gender address admissionNo')
    .lean();
  if (!student) throw new AppError('No student record is linked to this account', 404, [], 'STUDENT_NOT_LINKED');

  const enrollment = await Enrollment.findOne({ studentId: student._id, status: 'ACTIVE' })
    .sort({ createdAt: -1 })
    .select('_id sectionId academicYearId')
    .lean();

  return { student, enrollment: enrollment ?? null };
}

/**
 * Narrows a review-queue filter to what an OWN-scoped reviewer may see.
 *
 * A class teacher sees their own sections and nothing else; any other OWN
 * holder sees nothing at all rather than the school's whole queue.
 */
export async function applyReviewScope(actor, scope, filter) {
  if (scope !== 'OWN') return filter;
  if (actor.roleKey !== 'TEACHER') return { ...filter, _id: null };
  const sectionIds = await getClassTeacherSectionIds(actor.profileId);
  return { ...filter, sectionId: { $in: sectionIds } };
}

/** Throws unless this actor is allowed to decide on a request from `sectionId`. */
export async function assertMayReview(actor, scope, sectionId) {
  if (scope !== 'OWN') return;
  if (actor.roleKey !== 'TEACHER') {
    throw new AppError('Only the class teacher may review this request', 403);
  }
  const sectionIds = await getClassTeacherSectionIds(actor.profileId);
  if (!sectionId || !sectionIds.includes(String(sectionId))) {
    throw new AppError('You are not the class teacher for this student', 403, [], 'NOT_CLASS_TEACHER');
  }
}

/**
 * The student whose records a reader may look at.
 *
 * Returns `null` when the reader is unrestricted (school-wide scope), a
 * student id string when they are looking at their own record, and a
 * `{ sectionIds }` marker for a class teacher.
 */
export async function resolveReadTarget(actor, scope, requestedStudentId) {
  if (scope !== 'OWN') return { studentId: requestedStudentId ?? null };

  if (actor.roleKey === 'STUDENT') {
    const ownId = await getOwnStudentId(actor.profileId);
    if (!ownId) throw new AppError('No student record is linked to this account', 404, [], 'STUDENT_NOT_LINKED');
    if (requestedStudentId && String(requestedStudentId) !== ownId) {
      throw new AppError('You may only view your own records', 403);
    }
    return { studentId: ownId };
  }

  if (actor.roleKey === 'TEACHER') {
    const sectionIds = await getClassTeacherSectionIds(actor.profileId);
    const enrollments = await Enrollment.find({ sectionId: { $in: sectionIds }, status: 'ACTIVE' }).select('studentId').lean();
    const allowed = enrollments.map((e) => e.studentId.toString());
    if (requestedStudentId) {
      if (!allowed.includes(String(requestedStudentId))) {
        throw new AppError('This student is not in a class you are the class teacher of', 403);
      }
      return { studentId: String(requestedStudentId) };
    }
    return { studentIds: allowed };
  }

  throw new AppError('You do not have access to these records', 403);
}

/** "Class 5 A" for a section id, used on the review queue rows. */
export async function classLabelFor(sectionId) {
  if (!sectionId) return null;
  const section = await Section.findById(sectionId).populate('gradeId', 'name').lean();
  if (!section) return null;
  return `${section.gradeId?.name ?? ''} ${section.name}`.trim() || null;
}
