import { PtThread, PtMessage } from '../../models/ptMessage.model.js';
import { Student, StudentGuardian, Enrollment } from '../../models/student.model.js';
import { Profile } from '../../models/profile.model.js';
import { AppError } from '../../utils/AppError.js';
import { getGuardianStudentIds } from '../../utils/scope.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Verify the actor (parent) is linked as a guardian of studentId.
 */
async function assertParentOwnsStudent(parentProfileId, studentId) {
  const link = await StudentGuardian.findOne({ studentId, guardianProfileId: parentProfileId });
  if (!link) throw new AppError('Student not linked to your parent account', 403);
}

/**
 * Verify the actor (teacher) teaches a section that the student is enrolled in.
 */
async function assertTeacherTeachesStudent(teacherProfileId, studentId) {
  const { Section, SubjectOffering } = await import('../../models/academics.model.js');
  const enrollment = await Enrollment.findOne({ studentId, status: 'ACTIVE' }).lean();
  if (!enrollment) throw new AppError('Student has no active enrollment', 404);

  const sectionId = enrollment.sectionId.toString();
  const [classTeacherSection, offering] = await Promise.all([
    Section.findOne({ _id: sectionId, classTeacherId: teacherProfileId }).lean(),
    SubjectOffering.findOne({ sectionId, teacherId: teacherProfileId }).lean(),
  ]);

  if (!classTeacherSection && !offering) {
    throw new AppError('You do not teach this student', 403);
  }
}

function threadDto(thread, myProfileId) {
  return {
    id: thread._id,
    studentId: thread.studentId?._id ?? thread.studentId,
    studentName: thread.studentId
      ? `${thread.studentId.firstName} ${thread.studentId.lastName ?? ''}`.trim()
      : null,
    parentProfileId: thread.parentProfileId?._id ?? thread.parentProfileId,
    parentName: thread.parentProfileId?.displayName ?? null,
    teacherProfileId: thread.teacherProfileId?._id ?? thread.teacherProfileId,
    teacherName: thread.teacherProfileId?.displayName ?? null,
    subject: thread.subject ?? null,
    lastMessageAt: thread.lastMessageAt,
    lastMessageSnippet: thread.lastMessageSnippet,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

function messageDto(msg, myProfileId) {
  return {
    id: msg._id,
    threadId: msg.threadId,
    senderProfileId: msg.senderProfileId?._id ?? msg.senderProfileId,
    senderName: msg.senderProfileId?.displayName ?? null,
    body: msg.body,
    mine: (msg.senderProfileId?._id ?? msg.senderProfileId)?.toString() === myProfileId,
    createdAt: msg.createdAt,
  };
}

// ─── Service functions ───────────────────────────────────────────────────────

/**
 * Parent: list teachers associated with a student's section (class teacher + subject teachers).
 */
export async function listStudentTeachers(actor, studentId) {
  if (!studentId) throw new AppError('studentId is required', 400);

  await assertParentOwnsStudent(actor.profileId, studentId);

  const { Section, SubjectOffering } = await import('../../models/academics.model.js');
  const enrollment = await Enrollment.findOne({ studentId, status: 'ACTIVE' })
    .populate({ path: 'sectionId', populate: { path: 'classTeacherId', select: 'displayName' } })
    .lean();

  if (!enrollment || !enrollment.sectionId) return [];

  const section = enrollment.sectionId;
  const sectionId = section._id;

  const teachersMap = new Map();

  // 1. Class Teacher
  if (section.classTeacherId && section.classTeacherId._id) {
    const ctId = section.classTeacherId._id.toString();
    teachersMap.set(ctId, {
      profileId: ctId,
      displayName: section.classTeacherId.displayName,
      roles: new Set(['Class Teacher']),
    });
  }

  // 2. Subject Teachers
  const offerings = await SubjectOffering.find({ sectionId })
    .populate('teacherId', 'displayName')
    .populate('subjectId', 'name')
    .lean();

  for (const off of offerings) {
    if (off.teacherId && off.teacherId._id) {
      const tId = off.teacherId._id.toString();
      const subjectName = off.subjectId?.name ?? 'Subject';
      if (!teachersMap.has(tId)) {
        teachersMap.set(tId, {
          profileId: tId,
          displayName: off.teacherId.displayName,
          roles: new Set([subjectName]),
        });
      } else {
        teachersMap.get(tId).roles.add(subjectName);
      }
    }
  }

  return Array.from(teachersMap.values()).map((t) => ({
    profileId: t.profileId,
    displayName: t.displayName,
    label: `${t.displayName} (${Array.from(t.roles).join(', ')})`,
  }));
}

/**
 * Parent: start (or retrieve existing) thread with a student's teacher.
 * Returns the thread.
 */
export async function startThread(actor, { studentId, teacherProfileId, subject }) {
  if (!studentId) throw new AppError('studentId is required', 400);

  // Verify parent owns student
  await assertParentOwnsStudent(actor.profileId, studentId);

  const { Section, SubjectOffering } = await import('../../models/academics.model.js');
  const enrollment = await Enrollment.findOne({ studentId, status: 'ACTIVE' })
    .populate({ path: 'sectionId', select: 'classTeacherId' })
    .lean();
  if (!enrollment) throw new AppError('Student has no active enrollment', 404);

  const sectionId = enrollment.sectionId?._id ?? enrollment.sectionId;
  const classTeacherId = enrollment.sectionId?.classTeacherId?.toString();

  let targetTeacherId = teacherProfileId;

  if (targetTeacherId) {
    const isClassTeacher = classTeacherId === targetTeacherId;
    const isSubjectTeacher = await SubjectOffering.exists({ sectionId, teacherId: targetTeacherId });
    if (!isClassTeacher && !isSubjectTeacher) {
      throw new AppError('Selected teacher does not teach this student', 400);
    }
  } else {
    targetTeacherId = classTeacherId;
    if (!targetTeacherId) throw new AppError("This student's class teacher hasn't been assigned yet", 400);
  }

  // Upsert thread
  const thread = await PtThread.findOneAndUpdate(
    { parentProfileId: actor.profileId, teacherProfileId: targetTeacherId, studentId },
    {
      $setOnInsert: {
        parentProfileId: actor.profileId,
        teacherProfileId: targetTeacherId,
        studentId,
        subject: subject?.trim() ?? null,
      },
    },
    { upsert: true, new: true }
  )
    .populate('parentProfileId', 'displayName')
    .populate('teacherProfileId', 'displayName')
    .populate('studentId', 'firstName lastName');

  return threadDto(thread, actor.profileId);
}

/**
 * List threads for the calling actor.
 * PARENT sees threads they are parentProfileId on.
 * TEACHER sees threads they are teacherProfileId on.
 * ADMIN sees all (if granted).
 */
export async function listThreads(actor, scope) {
  const filter = {};
  if (actor.roleKey === 'PARENT') {
    filter.parentProfileId = actor.profileId;
  } else if (actor.roleKey === 'TEACHER') {
    filter.teacherProfileId = actor.profileId;
  } else if (scope !== 'ALL') {
    // Non-parent/teacher with OWN scope can't see any threads
    return [];
  }

  const threads = await PtThread.find(filter)
    .populate('parentProfileId', 'displayName')
    .populate('teacherProfileId', 'displayName')
    .populate('studentId', 'firstName lastName')
    .sort({ lastMessageAt: -1, createdAt: -1 })
    .lean();

  return threads.map((t) => threadDto(t, actor.profileId));
}

/**
 * Get messages in a thread. The caller must be a participant.
 */
export async function getThread(actor, scope, threadId) {
  const thread = await PtThread.findById(threadId)
    .populate('parentProfileId', 'displayName')
    .populate('teacherProfileId', 'displayName')
    .populate('studentId', 'firstName lastName')
    .lean();
  if (!thread) throw new AppError('Thread not found', 404);

  // Access control: must be parent or teacher on this thread (or ALL scope)
  if (scope !== 'ALL') {
    const isParticipant =
      thread.parentProfileId?._id?.toString() === actor.profileId ||
      thread.teacherProfileId?._id?.toString() === actor.profileId;
    if (!isParticipant) throw new AppError('Thread not found', 404);
  }

  const messages = await PtMessage.find({ threadId })
    .populate('senderProfileId', 'displayName')
    .sort({ createdAt: 1 })
    .lean();

  return {
    thread: threadDto(thread, actor.profileId),
    messages: messages.map((m) => messageDto(m, actor.profileId)),
  };
}

/**
 * Send a message to a thread. The caller must be a participant.
 */
export async function sendMessage(actor, { threadId, body }) {
  if (!threadId) throw new AppError('threadId is required', 400);
  if (!body || !body.trim()) throw new AppError('body is required', 400);

  const thread = await PtThread.findById(threadId);
  if (!thread) throw new AppError('Thread not found', 404);

  const isParticipant =
    thread.parentProfileId?.toString() === actor.profileId ||
    thread.teacherProfileId?.toString() === actor.profileId;
  if (!isParticipant) throw new AppError('Thread not found', 404);

  const message = await PtMessage.create({
    threadId,
    senderProfileId: actor.profileId,
    body: body.trim(),
  });

  // Update thread summary
  thread.lastMessageAt = message.createdAt;
  thread.lastMessageSnippet = body.trim().slice(0, 100);
  await thread.save();

  const populated = await PtMessage.findById(message._id)
    .populate('senderProfileId', 'displayName')
    .lean();

  return messageDto(populated, actor.profileId);
}
