import { Assignment, Submission } from '../../models/assignment.model.js';
import { AppError } from '../../utils/AppError.js';
import { SubjectOffering } from '../../models/academics.model.js';
import { getTeacherSectionIds, getOwnStudentId } from '../../utils/scope.js';
import { Enrollment } from '../../models/student.model.js';

export async function list(actor, scope, query = {}) {
  const filter = { deletedAt: null };
  if (query.subjectOfferingId) filter.subjectOfferingId = query.subjectOfferingId;

  if (scope === 'OWN' && actor.roleKey === 'TEACHER') {
    const sectionIds = await getTeacherSectionIds(actor.profileId);
    const offerings = await SubjectOffering.find({ sectionId: { $in: sectionIds } }).select('_id');
    filter.subjectOfferingId = { $in: offerings.map((o) => o._id) };
  }
  if (scope === 'OWN' && actor.roleKey === 'STUDENT') {
    const studentId = await getOwnStudentId(actor.profileId);
    const enrollments = await Enrollment.find({ studentId }).select('sectionId');
    const offerings = await SubjectOffering.find({ sectionId: { $in: enrollments.map((e) => e.sectionId) } }).select('_id');
    filter.subjectOfferingId = { $in: offerings.map((o) => o._id) };
  }

  return Assignment.find(filter)
    .populate({ path: 'subjectOfferingId', populate: { path: 'subjectId' } })
    .sort({ dueAt: -1 });
}

export async function create(actor, data) {
  const offering = await SubjectOffering.findById(data.subjectOfferingId);
  if (!offering) throw new AppError('Subject offering not found', 404);
  return Assignment.create({ ...data, createdByProfileId: actor.profileId });
}

export async function gradeSubmission(actor, { assignmentId, enrollmentId, marks, feedback }) {
  const assignment = await Assignment.findOne({ _id: assignmentId, deletedAt: null });
  if (!assignment) throw new AppError('Assignment not found', 404);

  return Submission.findOneAndUpdate(
    { assignmentId, enrollmentId },
    { marks, feedback, status: 'GRADED' },
    { upsert: true, new: true }
  );
}

export const submit = (assignmentId, enrollmentId, attachments = []) =>
  Submission.findOneAndUpdate(
    { assignmentId, enrollmentId },
    { status: 'SUBMITTED', submittedAt: new Date(), attachments },
    { upsert: true, new: true }
  );
