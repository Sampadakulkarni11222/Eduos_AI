import { localDate, localMidnight } from '../../utils/periods.js';
import { Assignment, Submission } from '../../models/assignment.model.js';
import { AppError } from '../../utils/AppError.js';
import { isSafeLinkUrl } from '../../utils/validators.js';
import { SubjectOffering } from '../../models/academics.model.js';
import { getTeacherSectionIds, getOwnStudentId, getGuardianStudentIds } from '../../utils/scope.js';
import { Enrollment } from '../../models/student.model.js';
// Registered, not assumed: the list populates the teacher's profile, and
// populate needs the model present even when a caller has imported only the
// assignments module.
import '../../models/profile.model.js';

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
        // Who set the work. Surfaced so a student can search their assignment
        // list by teacher alongside subject and title.
        { path: 'teacherId', select: 'displayName' },
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
      teacher: offering?.teacherId?.displayName ?? null,
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

  // Only the fields a teacher sets, checked; never the body as a whole. Copying
  // `{...data}` let a caller write deletedAt (homework saved as already
  // deleted, invisible to everyone), createdByProfileId or tenant fields.
  const fields = cleanAssignmentFields(data, { creating: true });
  return Assignment.create({ ...fields, subjectOfferingId: offering._id, createdByProfileId: actor.profileId });
}

export const ASSIGNMENT_TYPES = ['HOMEWORK', 'PROJECT', 'WORKSHEET', 'LAB'];
const EDITABLE_FIELDS = ['title', 'description', 'type', 'chapter', 'dueAt', 'maxMarks', 'attachments'];

/** Start of today's calendar day (process-local, see config/env.js) as a UTC instant. */
/** Local midnight today in the school's time zone (not UTC midnight, which is 05:30 in India). */
function startOfToday(now = new Date()) {
  const { y, m, d } = localDate(now);
  return localMidnight(y, m, d);
}

/**
 * The whitelisted, validated fields of a create or edit. On an edit only the
 * fields present are checked and returned.
 */
function cleanAssignmentFields(data = {}, { creating = false } = {}) {
  const out = {};
  for (const key of EDITABLE_FIELDS) {
    if (data?.[key] !== undefined) out[key] = data[key];
  }

  if (creating || out.title !== undefined) {
    const title = typeof out.title === 'string' ? out.title.trim() : '';
    if (!title) throw new AppError('A title is required', 400, [], 'ASSIGNMENT_TITLE_REQUIRED');
    if (title.length > 200) throw new AppError('The title is too long (200 characters at most)', 400);
    out.title = title;
  }
  if (out.description !== undefined && out.description !== null && typeof out.description !== 'string') {
    throw new AppError('The description must be text', 400);
  }
  if (out.chapter !== undefined && out.chapter !== null && typeof out.chapter !== 'string') {
    throw new AppError('The chapter must be text', 400);
  }

  if (creating || out.type !== undefined) {
    const type = String(out.type ?? 'HOMEWORK').trim().toUpperCase();
    if (!ASSIGNMENT_TYPES.includes(type)) {
      throw new AppError(`Type must be one of: ${ASSIGNMENT_TYPES.join(', ')}`, 400, [], 'ASSIGNMENT_TYPE_INVALID');
    }
    out.type = type;
  }

  if (creating || out.dueAt !== undefined) {
    const due = out.dueAt ? new Date(out.dueAt) : null;
    if (!due || Number.isNaN(due.getTime())) {
      throw new AppError('A valid due date is required', 400, [], 'ASSIGNMENT_DUE_INVALID');
    }
    if (due.getTime() < startOfToday().getTime()) {
      throw new AppError('The due date cannot be in the past', 400, [], 'ASSIGNMENT_DUE_PAST');
    }
    out.dueAt = due;
  }

  if (out.maxMarks === '' || out.maxMarks === null) {
    out.maxMarks = null;
  } else if (out.maxMarks !== undefined) {
    const max = Number(out.maxMarks);
    if (!Number.isFinite(max) || max <= 0) {
      throw new AppError('Max marks must be greater than 0', 400, [], 'ASSIGNMENT_MAX_MARKS_INVALID');
    }
    out.maxMarks = max;
  }

  if (out.attachments !== undefined) {
    assertSafeAttachments(out.attachments);
    out.attachments = (Array.isArray(out.attachments) ? out.attachments : [out.attachments])
      .map((a) => (typeof a === 'string' ? a.trim() : a?.fileUrl?.trim?.() ?? ''))
      .filter(Boolean);
  }
  return out;
}

/** The assignment, if this actor may change it: school-wide, or the teacher who set it / teaches the class. */
async function loadOwnedAssignment(actor, scope, id) {
  if (!id || !/^[a-f0-9]{24}$/i.test(String(id))) throw new AppError('Assignment not found', 404);
  const assignment = await Assignment.findOne({ _id: id, deletedAt: null });
  if (!assignment) throw new AppError('Assignment not found', 404);
  if (scope === 'ALL') return assignment;

  const offering = await SubjectOffering.findById(assignment.subjectOfferingId).select('teacherId').lean();
  const mine = String(assignment.createdByProfileId ?? '') === String(actor.profileId)
    || String(offering?.teacherId ?? '') === String(actor.profileId);
  if (!mine) throw new AppError('You can only change homework you set', 403, [], 'NOT_YOUR_ASSIGNMENT');
  return assignment;
}

/** Edit homework: the same whitelist and checks as creating it; the class cannot be changed. */
export async function update(actor, scope, id, data = {}) {
  const assignment = await loadOwnedAssignment(actor, scope, id);
  if (data?.subjectOfferingId !== undefined && String(data.subjectOfferingId) !== String(assignment.subjectOfferingId)) {
    throw new AppError('Homework cannot be moved to another class; withdraw it and set it again', 400);
  }
  const fields = cleanAssignmentFields(data);
  if (Object.keys(fields).length === 0) throw new AppError('Nothing to update', 400);
  Object.assign(assignment, fields);
  await assignment.save();
  return assignment;
}

/** Withdraw homework (soft delete): it leaves every list; submissions are kept. */
export async function remove(actor, scope, id) {
  const assignment = await loadOwnedAssignment(actor, scope, id);
  assignment.deletedAt = new Date();
  await assignment.save();
  return { id: String(assignment._id), deleted: true };
}

/** What the API returns for one assignment -- never the raw document. */
export function toView(a) {
  return {
    id: String(a._id),
    subjectOfferingId: String(a.subjectOfferingId),
    title: a.title,
    description: a.description ?? null,
    type: a.type,
    chapter: a.chapter ?? null,
    dueAt: a.dueAt?.toISOString?.() ?? null,
    maxMarks: a.maxMarks ?? null,
    attachments: a.attachments ?? [],
    seededSubmissions: 0,
  };
}

/**
 * Attachments are rendered as links in other people's portals — a student's
 * work in the teacher's, a teacher's worksheet in every student's — so each
 * must be one of our uploads or an http(s) link, never `javascript:` or the
 * like, which would run as the person who clicks it.
 */
function assertSafeAttachments(attachments) {
  const list = Array.isArray(attachments) ? attachments : [attachments];
  const bad = list
    .map((a) => (typeof a === 'string' ? a.trim() : a?.fileUrl?.trim?.() ?? ''))
    .filter((a) => a && !isSafeLinkUrl(a));
  if (bad.length) {
    throw new AppError(
      'Attachments must be files uploaded here (/uploads/...) or http(s) links',
      400, [], 'INVALID_ATTACHMENT_URL',
    );
  }
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
  assertSafeAttachments(cleanAttachments);

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
