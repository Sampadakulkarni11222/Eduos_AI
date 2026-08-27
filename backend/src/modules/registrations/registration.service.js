import { SubjectRegistration } from '../../models/subjectRegistration.model.js';
import { SubjectOffering } from '../../models/academics.model.js';
import { Student, Enrollment } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { getTeacherSectionIds } from '../../utils/scope.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { paginate, mapPage } from '../../utils/paginate.js';
import { notify } from '../notifications/notification.service.js';

// Seats are held by both APPROVED and PENDING requests. Counting only APPROVED
// would let staff approve a queue of pending requests straight past the cap.
const SEAT_HOLDING = ['PENDING', 'APPROVED'];

const toDto = (reg, { offering } = {}) => {
  const off = offering ?? reg.subjectOfferingId;
  return {
    id: reg._id.toString(),
    status: reg.status,
    studentId: reg.studentId?._id?.toString() ?? reg.studentId?.toString(),
    studentName: reg.studentId?.firstName
      ? `${reg.studentId.firstName} ${reg.studentId.lastName ?? ''}`.trim()
      : null,
    admissionNo: reg.studentId?.admissionNo ?? null,
    subjectOfferingId: off?._id?.toString() ?? off?.toString() ?? null,
    subjectName: off?.subjectId?.name ?? null,
    subjectCode: off?.subjectId?.code ?? null,
    termName: off?.termId?.name ?? null,
    teacherName: off?.teacherId?.displayName ?? null,
    decisionNote: reg.decisionNote ?? null,
    decidedAt: reg.decidedAt ?? null,
    decidedBy: reg.decidedByProfileId?.displayName ?? null,
    requestedAt: reg.createdAt,
  };
};

/** The student's own record + active enrollment, or a clear error saying which is missing. */
async function resolveStudentContext(actor) {
  const student = await Student.findOne({ profileId: actor.profileId, deletedAt: null }).select('_id').lean();
  if (!student) throw new AppError('No student record is linked to this account', 404, [], 'STUDENT_NOT_LINKED');

  const enrollment = await Enrollment.findOne({ studentId: student._id, status: 'ACTIVE' })
    .select('sectionId academicYearId')
    .lean();
  if (!enrollment) {
    throw new AppError(
      'You are not enrolled in a class yet — contact the school office.',
      404, [], 'NO_ACTIVE_ENROLLMENT'
    );
  }
  return { studentId: student._id, enrollment };
}

/** Seats taken per offering, as a Map keyed by offering id string. */
async function seatsTakenByOffering(offeringIds) {
  const rows = await SubjectRegistration.aggregate([
    { $match: { subjectOfferingId: { $in: offeringIds }, status: { $in: SEAT_HOLDING } } },
    { $group: { _id: '$subjectOfferingId', taken: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.taken]));
}

/**
 * The elective catalogue for the signed-in student: every elective offered to
 * their section, with seat availability and their own current status on each.
 */
export async function listAvailable(actor) {
  const { studentId, enrollment } = await resolveStudentContext(actor);

  const offerings = await SubjectOffering.find({ sectionId: enrollment.sectionId, isElective: true })
    .populate('subjectId', 'name code')
    .populate('termId', 'name startsOn endsOn')
    .populate('teacherId', 'displayName')
    .lean();

  const offeringIds = offerings.map((o) => o._id);
  const [taken, mine] = await Promise.all([
    seatsTakenByOffering(offeringIds),
    SubjectRegistration.find({ studentId, subjectOfferingId: { $in: offeringIds } })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  // Newest first, so a re-application supersedes an older rejected row.
  const myLatest = new Map();
  for (const r of mine) {
    const key = r.subjectOfferingId.toString();
    if (!myLatest.has(key)) myLatest.set(key, r);
  }

  return offerings.map((o) => {
    const id = o._id.toString();
    const seatsTaken = taken.get(id) ?? 0;
    const mineOnThis = myLatest.get(id) ?? null;
    const holdsSeat = !!mineOnThis && SEAT_HOLDING.includes(mineOnThis.status);
    return {
      subjectOfferingId: id,
      subjectName: o.subjectId?.name ?? 'Unknown subject',
      subjectCode: o.subjectId?.code ?? null,
      termName: o.termId?.name ?? null,
      teacherName: o.teacherId?.displayName ?? null,
      capacity: o.capacity ?? null,
      seatsTaken,
      seatsLeft: o.capacity == null ? null : Math.max(o.capacity - seatsTaken, 0),
      // A student already holding a seat is never "full" from their own point
      // of view — otherwise their own approved elective reads as unavailable.
      isFull: o.capacity != null && seatsTaken >= o.capacity && !holdsSeat,
      myRegistrationId: mineOnThis?._id?.toString() ?? null,
      myStatus: mineOnThis?.status ?? null,
      myDecisionNote: mineOnThis?.decisionNote ?? null,
    };
  });
}

/** Every registration the signed-in student has made, newest first. */
export async function listMine(actor) {
  const { studentId } = await resolveStudentContext(actor);
  const regs = await SubjectRegistration.find({ studentId })
    .sort({ createdAt: -1 })
    .populate({
      path: 'subjectOfferingId',
      populate: [
        { path: 'subjectId', select: 'name code' },
        { path: 'termId', select: 'name' },
        { path: 'teacherId', select: 'displayName' },
      ],
    })
    .populate('decidedByProfileId', 'displayName');
  return regs.map((r) => toDto(r));
}

/** Student registers for an elective. Lands as PENDING for staff to decide. */
export async function register(actor, subjectOfferingId) {
  const { studentId, enrollment } = await resolveStudentContext(actor);

  const offering = await SubjectOffering.findById(subjectOfferingId)
    .populate('subjectId', 'name code')
    .populate('termId', 'name endsOn');
  if (!offering) throw new AppError('Subject offering not found', 404);

  if (!offering.isElective) {
    throw new AppError(
      'This subject is part of your core timetable and does not need registering.',
      400, [], 'NOT_AN_ELECTIVE'
    );
  }
  // Registering for another section's elective would put the student in a class
  // that isn't on their timetable.
  if (offering.sectionId.toString() !== enrollment.sectionId.toString()) {
    throw new AppError('This elective is not offered to your class', 403, [], 'OFFERING_NOT_FOR_YOUR_CLASS');
  }
  if (offering.termId?.endsOn && offering.termId.endsOn < new Date()) {
    throw new AppError('Registration for this term has closed', 400, [], 'TERM_CLOSED');
  }

  const existing = await SubjectRegistration.findOne({
    studentId,
    subjectOfferingId,
    status: { $in: SEAT_HOLDING },
  });
  if (existing) {
    throw new AppError(
      existing.status === 'APPROVED'
        ? 'You are already registered for this elective'
        : 'You already have a pending request for this elective',
      409, [], 'ALREADY_REGISTERED'
    );
  }

  if (offering.capacity != null) {
    const taken = await SubjectRegistration.countDocuments({
      subjectOfferingId,
      status: { $in: SEAT_HOLDING },
    });
    if (taken >= offering.capacity) throw new AppError('This elective is full', 409, [], 'ELECTIVE_FULL');
  }

  let reg;
  try {
    reg = await SubjectRegistration.create({
      studentId,
      subjectOfferingId,
      academicYearId: enrollment.academicYearId,
      status: 'PENDING',
    });
  } catch (err) {
    // Two rapid submissions race past the findOne above; the partial unique
    // index is what actually settles it, so translate its error rather than
    // surfacing a 500.
    if (err?.code === 11000) {
      throw new AppError('You already have a request for this elective', 409, [], 'ALREADY_REGISTERED');
    }
    throw err;
  }

  await recordAudit({
    actor,
    action: 'subject_registration.request',
    entityType: 'SubjectRegistration',
    entityId: reg._id,
    after: {
      subject: offering.subjectId?.name ?? null,
      term: offering.termId?.name ?? null,
      status: 'PENDING',
    },
  });

  return toDto(reg, { offering });
}

/** Student cancels their own request, or drops an elective they were given. */
export async function withdraw(actor, registrationId) {
  const { studentId } = await resolveStudentContext(actor);

  const reg = await SubjectRegistration.findOne({ _id: registrationId, studentId });
  if (!reg) throw new AppError('Registration not found', 404);
  if (!SEAT_HOLDING.includes(reg.status)) {
    throw new AppError(`This request was already ${reg.status.toLowerCase()}`, 400, [], 'NOT_WITHDRAWABLE');
  }

  const previous = reg.status;
  reg.status = 'WITHDRAWN';
  await reg.save();

  await recordAudit({
    actor,
    action: 'subject_registration.withdraw',
    entityType: 'SubjectRegistration',
    entityId: reg._id,
    before: { status: previous },
    after: { status: 'WITHDRAWN' },
  });

  return toDto(reg);
}

/**
 * Staff review queue. At OWN scope a teacher sees only requests for electives
 * in sections they teach — the same narrowing the rest of the app applies.
 */
export async function listForReview(actor, scope, { status = 'PENDING', ...opts } = {}) {
  const filter = {};
  if (status && status !== 'ALL') filter.status = status;

  if (scope === 'OWN') {
    const sectionIds = await getTeacherSectionIds(actor.profileId);
    const offerings = await SubjectOffering.find({
      sectionId: { $in: sectionIds },
      isElective: true,
    }).select('_id');
    filter.subjectOfferingId = { $in: offerings.map((o) => o._id) };
  }

  // Was a bare .limit(200), which silently dropped everything past the 200th
  // request with no way for the caller to reach the rest.
  const page = await paginate(
    SubjectRegistration.find(filter)
      .sort({ createdAt: -1 })
      .populate('studentId', 'firstName lastName admissionNo')
      .populate({
        path: 'subjectOfferingId',
        populate: [
          { path: 'subjectId', select: 'name code' },
          { path: 'termId', select: 'name' },
          { path: 'teacherId', select: 'displayName' },
        ],
      })
      .populate('decidedByProfileId', 'displayName'),
    SubjectRegistration,
    filter,
    { page: opts.page, pageSize: opts.pageSize, label: 'registrations.listForReview' }
  );

  return mapPage(page, (r) => toDto(r));
}

/** Staff approves or rejects a pending request. */
export async function decide(actor, scope, registrationId, { status, note = null }) {
  if (!['APPROVED', 'REJECTED'].includes(status)) {
    throw new AppError('status must be APPROVED or REJECTED', 400);
  }

  const reg = await SubjectRegistration.findById(registrationId).populate({
    path: 'subjectOfferingId',
    populate: { path: 'subjectId', select: 'name code' },
  });
  if (!reg) throw new AppError('Registration not found', 404);
  if (reg.status !== 'PENDING') {
    throw new AppError(`This request was already ${reg.status.toLowerCase()}`, 409, [], 'ALREADY_DECIDED');
  }

  const offering = reg.subjectOfferingId;
  if (scope === 'OWN') {
    const sectionIds = await getTeacherSectionIds(actor.profileId);
    if (!sectionIds.includes(offering.sectionId.toString())) {
      throw new AppError('This elective is not in a class you teach', 403);
    }
  }

  // Re-check the cap at decision time. The seat was held while pending, but the
  // cap may have been lowered since, and approving past it would overfill the room.
  if (status === 'APPROVED' && offering.capacity != null) {
    const approved = await SubjectRegistration.countDocuments({
      subjectOfferingId: offering._id,
      status: 'APPROVED',
    });
    if (approved >= offering.capacity) {
      throw new AppError('This elective is already full — reject or free a seat first', 409, [], 'ELECTIVE_FULL');
    }
  }

  reg.status = status;
  reg.decidedByProfileId = actor.profileId;
  reg.decidedAt = new Date();
  reg.decisionNote = note ? String(note).trim().slice(0, 500) : null;
  await reg.save();

  await recordAudit({
    actor,
    action: `subject_registration.${status.toLowerCase()}`,
    entityType: 'SubjectRegistration',
    entityId: reg._id,
    before: { status: 'PENDING' },
    after: { status, subject: offering.subjectId?.name ?? null, note: reg.decisionNote },
  });

  // Tell the student. Without this the decision only exists in the audit trail
  // and on a page they have to remember to revisit.
  const student = await Student.findById(reg.studentId).select('profileId').lean();
  if (student?.profileId) {
    const subjectName = offering.subjectId?.name ?? 'your elective';
    await notify({
      recipientProfileIds: [student.profileId],
      type: 'REGISTRATION',
      title: status === 'APPROVED'
        ? `You are registered for ${subjectName}`
        : `Your request for ${subjectName} was not approved`,
      body: reg.decisionNote ?? undefined,
      link: '/student/subjects',
      meta: { registrationId: reg._id.toString(), status },
    });
  }

  return toDto(reg);
}
