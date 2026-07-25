import { Exam, ExamSubject, Mark } from '../../models/exam.model.js';
import { Enrollment } from '../../models/student.model.js';
import { SubjectOffering } from '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import { getTeacherSectionIds, getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';

export const createExam = (data) => Exam.create(data);

export async function createExamSubject(data) {
  const exam = await Exam.findById(data.examId);
  if (!exam) throw new AppError('Exam not found', 404);
  return ExamSubject.create(data);
}

export async function listExams(termId) {
  const exams = await Exam.find(termId ? { termId } : {}).sort({ startsOn: -1 }).lean();
  return exams.map((e) => ({ id: e._id, name: e.name, startsOn: e.startsOn, endsOn: e.endsOn }));
}

export async function listExamSubjects(actor, scope, examId) {
  const filter = examId ? { examId } : {};
  if (scope === 'OWN' && actor.roleKey === 'TEACHER') {
    // Only subjects this teacher personally teaches — matches the write-side
    // check in loadOwnedExamSubject, so nothing shows up here that they'd
    // then be refused when actually entering marks for it.
    const offerings = await SubjectOffering.find({ teacherId: actor.profileId }).select('_id');
    filter.subjectOfferingId = { $in: offerings.map((o) => o._id) };
  }
  const examSubjects = await ExamSubject.find(filter)
    .populate([
      { path: 'examId' },
      { path: 'subjectOfferingId', populate: [{ path: 'subjectId' }, { path: 'sectionId', populate: { path: 'gradeId' } }] },
    ])
    .lean();

  return examSubjects.map((es) => ({
    id: es._id,
    examId: es.examId?._id ?? null,
    examName: es.examId?.name ?? 'Exam',
    subject: es.subjectOfferingId?.subjectId?.name ?? 'Subject',
    class: es.subjectOfferingId?.sectionId
      ? `${es.subjectOfferingId.sectionId.gradeId?.name ?? ''} ${es.subjectOfferingId.sectionId.name}`.trim()
      : 'Unknown',
    maxMarks: es.maxMarks ?? 100,
    examDate: es.examDate ?? null,
  }));
}

async function resolveEnrollmentIdsForOwn(actor) {
  if (actor.roleKey === 'TEACHER') {
    const sectionIds = await getTeacherSectionIds(actor.profileId);
    const enrollments = await Enrollment.find({ sectionId: { $in: sectionIds } }).select('_id');
    return enrollments.map((e) => e._id.toString());
  }
  if (actor.roleKey === 'PARENT') {
    const studentIds = await getGuardianStudentIds(actor.profileId);
    const enrollments = await Enrollment.find({ studentId: { $in: studentIds } }).select('_id');
    return enrollments.map((e) => e._id.toString());
  }
  if (actor.roleKey === 'STUDENT') {
    const studentId = await getOwnStudentId(actor.profileId);
    const enrollments = await Enrollment.find({ studentId }).select('_id');
    return enrollments.map((e) => e._id.toString());
  }
  return [];
}

/**
 * Loads an exam subject with its class/subject context and, for a
 * TEACHER acting OWN-scoped, verifies they are the teacher on that specific
 * subject offering. Throws 404/403 otherwise. Shared by the roster and
 * marks-entry endpoints so a teacher can never read or write marks for a
 * subject someone else teaches — being that section's class teacher grants
 * broader read access to performance (see getPerformance) but not write
 * access to another teacher's marks.
 */
async function loadOwnedExamSubject(actor, scope, examSubjectId) {
  const examSubject = await ExamSubject.findById(examSubjectId).populate([
    { path: 'examId' },
    { path: 'subjectOfferingId', populate: [{ path: 'subjectId' }, { path: 'sectionId', populate: { path: 'gradeId' } }] },
  ]);
  if (!examSubject) throw new AppError('Exam subject not found', 404);

  if (scope === 'OWN' && actor.roleKey === 'TEACHER') {
    const teacherId = examSubject.subjectOfferingId?.teacherId;
    if (!teacherId || teacherId.toString() !== actor.profileId) {
      throw new AppError('You do not teach this subject for this class', 403);
    }
  }
  return examSubject;
}

/** Full class roster for an exam subject — every enrolled student, marked or not (teacher/grader view). */
export async function getMarksGrid(actor, scope, examSubjectId) {
  const examSubject = await loadOwnedExamSubject(actor, scope, examSubjectId);
  const sectionId = examSubject.subjectOfferingId?.sectionId?._id;

  const enrollments = await Enrollment.find({ sectionId, status: 'ACTIVE' })
    .populate({ path: 'studentId', select: 'firstName lastName admissionNo' })
    .select('rollNo studentId')
    .lean();

  const marks = await Mark.find({ examSubjectId }).lean();
  const markMap = Object.fromEntries(marks.map((m) => [m.enrollmentId.toString(), m]));

  return {
    examSubject: {
      id: examSubject._id,
      examName: examSubject.examId?.name ?? 'Exam',
      subject: examSubject.subjectOfferingId?.subjectId?.name ?? 'Subject',
      class: examSubject.subjectOfferingId?.sectionId
        ? `${examSubject.subjectOfferingId.sectionId.gradeId?.name ?? ''} ${examSubject.subjectOfferingId.sectionId.name}`.trim()
        : 'Unknown',
      maxMarks: examSubject.maxMarks ?? 100,
    },
    rows: enrollments.map((e) => {
      const m = markMap[e._id.toString()];
      const student = e.studentId;
      return {
        enrollmentId: e._id,
        rollNo: e.rollNo ?? null,
        studentName: student ? `${student.firstName} ${student.lastName ?? ''}`.trim() : 'Unknown',
        marks: m?.marks ?? null,
        gradeLabel: m?.gradeLabel ?? null,
        remarks: m?.remarks ?? null,
        status: m?.status ?? 'PENDING',
      };
    }),
  };
}

export async function getPerformance(actor, scope, { enrollmentId }) {
  const filter = {};

  // If enrollmentId is not specified, resolve from scope if OWN
  let targetEnrollmentId = enrollmentId;
  if (!targetEnrollmentId) {
    if (scope === 'OWN') {
      const ids = await resolveEnrollmentIdsForOwn(actor);
      if (ids.length > 0) {
        targetEnrollmentId = ids[0];
      }
    }
  }

  if (!targetEnrollmentId) {
    throw new AppError('enrollmentId is required', 400);
  }

  // Get the enrollment to populate student details
  const enrollment = await Enrollment.findById(targetEnrollmentId)
    .populate('studentId')
    .populate({
      path: 'sectionId',
      populate: { path: 'gradeId' }
    });
  if (!enrollment) throw new AppError('Enrollment not found', 404);

  // A caller passing an arbitrary enrollmentId must still be checked against
  // OWN scope explicitly — the resolveEnrollmentIdsForOwn() call above only
  // runs when enrollmentId is omitted, so without this a teacher/parent could
  // read any student's full results just by supplying any enrollment id.
  let restrictToOfferingIds = null; // null = no subject restriction (full access)
  if (scope === 'OWN') {
    if (actor.roleKey === 'TEACHER') {
      const mySectionIds = await getTeacherSectionIds(actor.profileId);
      const sectionId = enrollment.sectionId?._id?.toString();
      if (!sectionId || !mySectionIds.includes(sectionId)) {
        throw new AppError('This student is not in your classes', 403);
      }
      const isClassTeacher = enrollment.sectionId?.classTeacherId?.toString() === actor.profileId;
      if (!isClassTeacher) {
        // Subject teacher (not this section's class teacher) — only see the
        // subject(s) they actually teach here, not the whole student record.
        const myOfferings = await SubjectOffering.find({ sectionId, teacherId: actor.profileId }).select('_id');
        restrictToOfferingIds = myOfferings.map((o) => o._id.toString());
      }
    } else {
      const ownedIds = await resolveEnrollmentIdsForOwn(actor);
      if (!ownedIds.includes(targetEnrollmentId)) {
        throw new AppError('You do not have access to this student', 403);
      }
    }
  }

  filter.enrollmentId = targetEnrollmentId;
  filter.status = 'PUBLISHED';

  // Find marks and populate all relations needed to build the DTO
  const marks = await Mark.find(filter).populate({
    path: 'examSubjectId',
    populate: [
      { path: 'examId' },
      {
        path: 'subjectOfferingId',
        populate: [{ path: 'subjectId' }, { path: 'sectionId', populate: { path: 'gradeId' } }]
      }
    ]
  });

  const studentName = enrollment?.studentId
    ? `${enrollment.studentId.firstName} ${enrollment.studentId.lastName || ''}`.trim()
    : 'Unknown';

  const className = enrollment?.sectionId
    ? `${enrollment.sectionId.gradeId?.name ?? ''} ${enrollment.sectionId.name}`.trim()
    : 'Unknown';

  // Calculate results and stats
  const results = [];
  let totalPct = 0;
  let validResultsCount = 0;
  let bestSubject = null;
  let needsSupport = null;

  for (const m of marks) {
    const examSubject = m.examSubjectId;
    if (!examSubject) continue;
    if (restrictToOfferingIds && !restrictToOfferingIds.includes(examSubject.subjectOfferingId?._id?.toString())) {
      continue; // subject-only teacher for this section — hide subjects they don't teach
    }

    const examName = examSubject.examId?.name || 'Exam';
    const subjectName = examSubject.subjectOfferingId?.subjectId?.name || 'Subject';
    const marksObtained = m.marks ?? null;
    const maxMarks = examSubject.maxMarks || 100;
    const pct = marksObtained !== null ? Math.round((marksObtained / maxMarks) * 100) : null;

    results.push({
      exam: examName,
      subject: subjectName,
      marks: marksObtained,
      maxMarks,
      pct,
    });

    if (pct !== null) {
      totalPct += pct;
      validResultsCount++;

      if (!bestSubject || pct > (bestSubject.pct ?? -1)) {
        bestSubject = { subject: subjectName, pct };
      }
      if (!needsSupport || pct < (needsSupport.pct ?? 101)) {
        needsSupport = { subject: subjectName, pct };
      }
    }
  }

  const overallAvgPct = validResultsCount > 0 ? Math.round(totalPct / validResultsCount) : null;

  return {
    student: { name: studentName, class: className },
    overallAvgPct,
    bestSubject,
    needsSupport,
    results,
  };
}

export async function enterMarks(actor, scope, { examSubjectId, entries }) {
  const examSubject = await loadOwnedExamSubject(actor, scope, examSubjectId);
  const sectionId = examSubject.subjectOfferingId?.sectionId?._id;

  // Never trust the client's enrollmentId list outright — an entry may only
  // reference a student actually enrolled in this exam subject's section.
  const enrolled = await Enrollment.find({ sectionId, status: 'ACTIVE' }).select('_id');
  const allowedIds = new Set(enrolled.map((e) => e._id.toString()));

  // Published marks are locked — re-entering must never silently downgrade
  // a published result back to DRAFT (a resubmitted stale form, or the
  // client simply not filtering, must not be able to undo a publish).
  const published = await Mark.find({ examSubjectId, status: 'PUBLISHED' }).select('enrollmentId');
  const publishedIds = new Set(published.map((m) => m.enrollmentId.toString()));

  const validEntries = entries.filter((e) => allowedIds.has(String(e.enrollmentId)) && !publishedIds.has(String(e.enrollmentId)));
  if (validEntries.length === 0) throw new AppError('No valid mark entries for this class', 400);

  const ops = validEntries.map(({ enrollmentId, marks, gradeLabel, remarks }) => ({
    updateOne: {
      filter: { examSubjectId, enrollmentId },
      update: { $set: { marks, gradeLabel, remarks, status: 'DRAFT', enteredByProfileId: actor.profileId } },
      upsert: true,
    },
  }));
  await Mark.bulkWrite(ops);
  return Mark.find({ examSubjectId });
}

export async function publishMarks(actor, scope, examSubjectId) {
  await loadOwnedExamSubject(actor, scope, examSubjectId);
  const result = await Mark.updateMany(
    { examSubjectId, status: { $ne: 'PUBLISHED' } },
    { status: 'PUBLISHED', publishedAt: new Date() }
  );
  return { matched: result.matchedCount, modified: result.modifiedCount };
}
