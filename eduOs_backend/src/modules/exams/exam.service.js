import { Exam, ExamSubject, Mark } from '../../models/exam.model.js';
import { Enrollment } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { getTeacherSectionIds, getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';

export const createExam = (data) => Exam.create(data);

export async function createExamSubject(data) {
  const exam = await Exam.findById(data.examId);
  if (!exam) throw new AppError('Exam not found', 404);
  return ExamSubject.create(data);
}

export const listExamSubjects = (examId) =>
  ExamSubject.find(examId ? { examId } : {}).populate('examId subjectOfferingId');

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

export async function getMarksGrid(actor, scope, examSubjectId) {
  const filter = { examSubjectId };
  if (scope === 'OWN') {
    const ids = await resolveEnrollmentIdsForOwn(actor);
    filter.enrollmentId = { $in: ids };
  }
  return Mark.find(filter).populate('enrollmentId');
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

  // Get the enrollment to populate student details
  const enrollment = await Enrollment.findById(targetEnrollmentId)
    .populate('studentId')
    .populate({
      path: 'sectionId',
      populate: { path: 'gradeId' }
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

export async function enterMarks(actor, { examSubjectId, entries }) {
  const examSubject = await ExamSubject.findById(examSubjectId);
  if (!examSubject) throw new AppError('Exam subject not found', 404);

  const ops = entries.map(({ enrollmentId, marks, gradeLabel, remarks }) => ({
    updateOne: {
      filter: { examSubjectId, enrollmentId },
      update: { $set: { marks, gradeLabel, remarks, status: 'DRAFT', enteredByProfileId: actor.profileId } },
      upsert: true,
    },
  }));
  if (ops.length === 0) throw new AppError('No mark entries provided', 400);
  await Mark.bulkWrite(ops);
  return Mark.find({ examSubjectId });
}

export async function publishMarks(examSubjectId) {
  const result = await Mark.updateMany(
    { examSubjectId },
    { status: 'PUBLISHED', publishedAt: new Date() }
  );
  return { matched: result.matchedCount, modified: result.modifiedCount };
}
