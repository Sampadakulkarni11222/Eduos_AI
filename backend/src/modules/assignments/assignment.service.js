import { Assignment, Submission } from '../../models/assignment.model.js';
import { AppError } from '../../utils/AppError.js';
import { SubjectOffering } from '../../models/academics.model.js';
import { getTeacherSectionIds, getOwnStudentId, getGuardianStudentIds } from '../../utils/scope.js';
import { Enrollment } from '../../models/student.model.js';

/** Resolve the ACTIVE enrollment ids for the actor's own student(s). */
async function getOwnEnrollmentIds(actor) {
  let studentIds = [];
  if (actor.roleKey === 'STUDENT') {
    const id = await getOwnStudentId(actor.profileId);
    if (id) studentIds = [id];
  } else if (actor.roleKey === 'PARENT') {
    studentIds = await getGuardianStudentIds(actor.profileId);
  }
  if (studentIds.length === 0) return [];
  const enrollments = await Enrollment.find({ studentId: { $in: studentIds }, status: 'ACTIVE' }).select('_id');
  return enrollments.map((e) => e._id);
}

export async function list(actor, scope, query = {}) {
  const filter = { deletedAt: null };
  if (query.subjectOfferingId || query.offeringId) {
    filter.subjectOfferingId = query.subjectOfferingId ?? query.offeringId;
  }

  let ownEnrollmentIds = [];
  if (scope === 'OWN' && actor.roleKey === 'TEACHER') {
    // Scoped to subjects this teacher personally teaches — not every subject
    // in a section they're merely class-teacher of (see timetable.service.js
    // for the same fix).
    const offerings = await SubjectOffering.find({ teacherId: actor.profileId }).select('_id');
    filter.subjectOfferingId = filter.subjectOfferingId ?? { $in: offerings.map((o) => o._id) };
  }
  if (scope === 'OWN' && (actor.roleKey === 'STUDENT' || actor.roleKey === 'PARENT')) {
    ownEnrollmentIds = await getOwnEnrollmentIds(actor);
    const enrollments = await Enrollment.find({ _id: { $in: ownEnrollmentIds } }).select('sectionId');
    const offerings = await SubjectOffering.find({ sectionId: { $in: enrollments.map((e) => e.sectionId) } }).select('_id');
    filter.subjectOfferingId = filter.subjectOfferingId ?? { $in: offerings.map((o) => o._id) };
  }

  const assignments = await Assignment.find(filter)
    .populate({
      path: 'subjectOfferingId',
      populate: [
        { path: 'subjectId', select: 'name' },
        { path: 'sectionId', select: 'name', populate: { path: 'gradeId', select: 'name' } },
      ],
    })
    .sort({ dueAt: -1 })
    .limit(200);

  const assignmentIds = assignments.map((a) => a._id);

  // Submission counts (for staff) and the actor's own submissions (students/parents)
  const [countsAgg, ownSubs] = await Promise.all([
    Submission.aggregate([
      { $match: { assignmentId: { $in: assignmentIds }, status: { $in: ['SUBMITTED', 'LATE', 'GRADED'] } } },
      { $group: { _id: '$assignmentId', count: { $sum: 1 } } },
    ]),
    ownEnrollmentIds.length > 0
      ? Submission.find({ assignmentId: { $in: assignmentIds }, enrollmentId: { $in: ownEnrollmentIds } }).lean()
      : [],
  ]);
  const countMap = Object.fromEntries(countsAgg.map((c) => [c._id.toString(), c.count]));
  const ownSubMap = Object.fromEntries(ownSubs.map((s) => [s.assignmentId.toString(), s]));

  return assignments.map((a) => {
    const offering = a.subjectOfferingId;
    const section = offering?.sectionId;
    const own = ownSubMap[a._id.toString()];
    return {
      id: a._id,
      title: a.title,
      description: a.description ?? null,
      type: a.type,
      chapter: a.chapter ?? null,
      dueAt: a.dueAt?.toISOString() ?? null,
      maxMarks: a.maxMarks ?? null,
      attachments: a.attachments ?? [],
      subject: offering?.subjectId?.name ?? 'Subject',
      subjectId: offering?.subjectId?._id ?? null,
      class: section ? [section.gradeId?.name, section.name].filter(Boolean).join(' - ') : '—',
      gradeId: section?.gradeId?._id ?? null,
      gradeName: section?.gradeId?.name ?? null,
      sectionId: section?._id ?? null,
      sectionName: section?.name ?? null,
      subjectOfferingId: offering?._id ?? null,
      submissionCount: countMap[a._id.toString()] ?? 0,
      mySubmission: own
        ? {
            status: own.status,
            submittedAt: own.submittedAt ?? null,
            marks: own.marks ?? null,
            feedback: own.feedback ?? null,
            attachments: own.attachments ?? [],
          }
        : null,
    };
  });
}

export async function create(actor, scope, data) {
  const offering = await SubjectOffering.findById(data.subjectOfferingId);
  if (!offering) throw new AppError('Subject offering not found', 404);

  // An OWN-scoped actor (a teacher) may only set homework for a class they
  // actually teach. Without this, holding assignments.manage let any teacher
  // create work for any other teacher's section — the existence check above
  // proved the offering was real, not that it was theirs.
  if (scope === 'OWN' && String(offering.teacherId ?? '') !== String(actor.profileId)) {
    throw new AppError('You do not teach this class', 403, [], 'NOT_YOUR_CLASS');
  }

  return Assignment.create({ ...data, createdByProfileId: actor.profileId });
}

export async function gradeSubmission(actor, scope, { assignmentId, enrollmentId, marks, feedback }) {
  const assignment = await Assignment.findOne({ _id: assignmentId, deletedAt: null }).populate({
    path: 'subjectOfferingId',
    select: 'sectionId',
  });
  if (!assignment) throw new AppError('Assignment not found', 404);

  const sectionId = assignment.subjectOfferingId?.sectionId?.toString();

  if (scope === 'OWN' && actor.roleKey === 'TEACHER') {
    const mySections = await getTeacherSectionIds(actor.profileId);
    if (!sectionId || !mySections.includes(sectionId)) {
      throw new AppError('This assignment is not in your classes', 403);
    }
  }

  // The enrollment being graded must actually be in this assignment's section,
  // regardless of scope — prevents grading students from unrelated classes.
  const enrollment = await Enrollment.findById(enrollmentId).select('sectionId');
  if (!enrollment || enrollment.sectionId.toString() !== sectionId) {
    throw new AppError('This student is not enrolled in this assignment\'s class', 400);
  }

  // A grade can only be assigned once real work has been submitted —
  // grading must follow reviewing the submission, never precede it.
  const existing = await Submission.findOne({ assignmentId, enrollmentId });
  if (!existing || existing.status === 'PENDING') {
    throw new AppError('Cannot grade — no submission has been received for this student', 400);
  }

  return Submission.findOneAndUpdate(
    { assignmentId, enrollmentId },
    { marks, feedback, status: 'GRADED' },
    { upsert: false, new: true }
  );
}

/**
 * Submit work for an assignment.
 * Students may only ever submit as themselves — the enrollment is resolved
 * server-side from the actor, never trusted from the request body.
 */
export async function submit(actor, scope, { assignmentId, enrollmentId, attachments = [] }) {
  const assignment = await Assignment.findOne({ _id: assignmentId, deletedAt: null });
  if (!assignment) throw new AppError('Assignment not found', 404);

  // A submission with nothing in it is not a submission. The disabled button in
  // the UI is a courtesy; this is the rule, because the endpoint is reachable
  // without the UI. Blank entries are stripped first so a payload of [""] or
  // ["  "] cannot pass as work.
  const cleanAttachments = (Array.isArray(attachments) ? attachments : [])
    .map((a) => (typeof a === 'string' ? a.trim() : a?.fileUrl?.trim?.() ?? ''))
    .filter(Boolean);

  if (cleanAttachments.length === 0) {
    throw new AppError(
      'Attach a file or paste a link before submitting — an empty submission cannot be accepted.',
      400,
      [],
      'SUBMISSION_EMPTY'
    );
  }

  let targetEnrollmentId = enrollmentId;
  if (scope === 'OWN') {
    const ownIds = await getOwnEnrollmentIds(actor);
    if (ownIds.length === 0) throw new AppError('No active enrollment found for your account', 404);
    targetEnrollmentId = ownIds[0].toString();
  }
  if (!targetEnrollmentId) throw new AppError('enrollmentId is required', 400);

  // The enrollment's section must actually have this assignment's offering.
  const [enrollment, offering] = await Promise.all([
    Enrollment.findById(targetEnrollmentId).select('sectionId'),
    SubjectOffering.findById(assignment.subjectOfferingId).select('sectionId'),
  ]);
  if (!enrollment || !offering || enrollment.sectionId.toString() !== offering.sectionId.toString()) {
    throw new AppError('This assignment does not belong to your class', 403);
  }

  const isLate = assignment.dueAt && new Date() > assignment.dueAt;
  const existing = await Submission.findOne({ assignmentId, enrollmentId: targetEnrollmentId });
  if (existing?.status === 'GRADED') {
    throw new AppError('This submission has already been graded and can no longer be changed', 409);
  }

  return Submission.findOneAndUpdate(
    { assignmentId, enrollmentId: targetEnrollmentId },
    {
      status: isLate ? 'LATE' : 'SUBMITTED',
      submittedAt: new Date(),
      attachments: cleanAttachments,
    },
    { upsert: true, new: true }
  );
}

/** Roster of submissions for one assignment (teacher/grader view). */
export async function listSubmissions(actor, scope, assignmentId) {
  const assignment = await Assignment.findOne({ _id: assignmentId, deletedAt: null }).populate({
    path: 'subjectOfferingId',
    select: 'sectionId teacherId',
  });
  if (!assignment) throw new AppError('Assignment not found', 404);

  const sectionId = assignment.subjectOfferingId?.sectionId;
  if (scope === 'OWN' && actor.roleKey === 'TEACHER') {
    const mySections = await getTeacherSectionIds(actor.profileId);
    if (!mySections.includes(sectionId?.toString())) {
      throw new AppError('This assignment is not in your classes', 403);
    }
  }

  // Everyone enrolled in the section appears in the roster, submitted or not.
  const enrollments = await Enrollment.find({ sectionId, status: 'ACTIVE' })
    .populate({ path: 'studentId', select: 'firstName lastName admissionNo' })
    .select('rollNo studentId')
    .lean();

  const submissions = await Submission.find({ assignmentId }).lean();
  const subMap = Object.fromEntries(submissions.map((s) => [s.enrollmentId.toString(), s]));

  return {
    assignment: {
      id: assignment._id,
      title: assignment.title,
      dueAt: assignment.dueAt?.toISOString() ?? null,
      maxMarks: assignment.maxMarks ?? null,
    },
    rows: enrollments
      .map((e) => {
        const sub = subMap[e._id.toString()];
        const student = e.studentId;
        return {
          enrollmentId: e._id,
          rollNo: e.rollNo ?? null,
          studentName: student ? `${student.firstName} ${student.lastName ?? ''}`.trim() : 'Unknown',
          status: sub?.status ?? 'PENDING',
          submittedAt: sub?.submittedAt ?? null,
          marks: sub?.marks ?? null,
          feedback: sub?.feedback ?? null,
          attachments: sub?.attachments ?? [],
        };
      })
      .sort((a, b) => (a.rollNo ?? 999) - (b.rollNo ?? 999)),
  };
}
