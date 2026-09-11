import { Exam, ExamSubject, Mark } from '../../models/exam.model.js';
import { Enrollment, Student, StudentGuardian } from '../../models/student.model.js';
import { SubjectOffering, Term } from '../../models/academics.model.js';
import * as attendanceService from '../attendance/attendance.service.js';
import { AppError } from '../../utils/AppError.js';
import { getTeacherSectionIds, getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';
import { gradeForPercentage, percentage, summarise } from '../../utils/grading.js';
import { notify } from '../notifications/notification.service.js';

/**
 * The term and the subject offering must exist in the acting school. These
 * used to be written against whatever ids arrived, so an exam could be filed
 * under another school's term, or an exam subject point at another school's
 * class — rows that belong to no timetable anyone can see. The lookups go
 * through the tenant-scoped models, so a foreign id is "not found".
 */
export async function createExam(data) {
  const term = await Term.findById(data.termId);
  if (!term) throw new AppError('Term not found', 404);
  return Exam.create(data);
}

export async function createExamSubject(data) {
  const [exam, offering] = await Promise.all([
    Exam.findById(data.examId),
    SubjectOffering.findById(data.subjectOfferingId),
  ]);
  if (!exam) throw new AppError('Exam not found', 404);
  if (!offering) throw new AppError('Subject offering not found', 404);
  return ExamSubject.create(data);
}

export async function listExams(termId) {
  const exams = await Exam.find(termId ? { termId } : {}).sort({ startsOn: -1 }).lean();
  return exams.map((e) => ({ id: e._id, name: e.name, startsOn: e.startsOn, endsOn: e.endsOn }));
}

export async function listExamSubjects(actor, scope, examId) {
  const filter = examId ? { examId } : {};
  if (scope === 'OWN') {
    if (actor.roleKey === 'TEACHER') {
      // Only subjects this teacher personally teaches — matches the write-side
      // check in loadOwnedExamSubject, so nothing shows up here that they'd
      // then be refused when actually entering marks for it.
      const offerings = await SubjectOffering.find({ teacherId: actor.profileId }).select('_id');
      filter.subjectOfferingId = { $in: offerings.map((o) => o._id) };
    } else {
      // Same reasoning as loadOwnedExamSubject: this is the marks-entry
      // picker, so an OWN-scope non-teacher gets nothing rather than the
      // school's full exam/paper listing.
      return [];
    }
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

  // Driven by scope, not by role. The previous form only ran the check for
  // TEACHER, so any other OWN-scope holder of `marks.read` — a student — could
  // pull the whole class marks grid for any paper by supplying its id. Their
  // own results come from getPerformance/getReportCard, which resolve the
  // enrollment from the caller's identity.
  if (scope === 'OWN') {
    if (actor.roleKey !== 'TEACHER') {
      throw new AppError('You are not allowed to view this class marks sheet', 403);
    }
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
      // The term and year come along for the ride so a result can be filed
      // under the year and term it belongs to, which is what the performance
      // history view is built from.
      { path: 'examId', populate: { path: 'termId', populate: { path: 'academicYearId' } } },
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

    const exam = examSubject.examId;
    const term = exam?.termId;
    const year = term?.academicYearId;

    results.push({
      exam: examName,
      examId: exam?._id ? String(exam._id) : null,
      examDate: examSubject.examDate ?? exam?.startsOn ?? null,
      termId: term?._id ? String(term._id) : null,
      termName: term?.name ?? null,
      academicYearId: year?._id ? String(year._id) : null,
      academicYearName: year?.name ?? null,
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

/**
 * Report card for one enrollment: per-subject marks with letter grades, plus
 * totals, percentage and GPA.
 *
 * Deliberately built on getPerformance() rather than querying marks directly —
 * that function already enforces the full ownership model (a parent only their
 * own child, a subject teacher only the subjects they teach in that section),
 * and duplicating that logic here would be the easiest place in this codebase
 * to introduce a data leak.
 *
 * Only PUBLISHED marks are included, inherited from the same source: a report
 * card must never show a draft the teacher is still editing.
 */
export async function getReportCard(actor, scope, { enrollmentId, exam }) {
  const performance = await getPerformance(actor, scope, { enrollmentId });

  const results = exam
    ? performance.results.filter((r) => r.exam?.toLowerCase() === String(exam).toLowerCase())
    : performance.results;

  if (exam && !results.length) {
    throw new AppError(`No published results found for "${exam}"`, 404, [], 'NO_RESULTS_FOR_EXAM');
  }

  const subjects = results.map((r) => {
    const pct = percentage(r.marks, r.maxMarks);
    const band = gradeForPercentage(pct);
    return {
      exam: r.exam,
      subject: r.subject,
      marks: r.marks,
      maxMarks: r.maxMarks,
      percentage: pct,
      grade: band?.label ?? null,
      gradePoints: band?.points ?? null,
      descriptor: band?.descriptor ?? null,
    };
  });

  return {
    student: performance.student,
    exam: exam ?? 'All exams',
    generatedAt: new Date().toISOString(),
    subjects,
    summary: summarise(subjects),
    bestSubject: performance.bestSubject,
    needsSupport: performance.needsSupport,
  };
}

/**
 * Totals, percentage, letter grade and GPA for a set of published results.
 *
 * Shares the school's grade bands with the report card (utils/grading.js), so
 * a term summary and a report card can never disagree about what 82% is
 * called.
 */
function summariseResults(results) {
  const subjects = (results ?? []).map((r) => {
    const pct = percentage(r.marks, r.maxMarks);
    const band = gradeForPercentage(pct);
    return {
      subject: r.subject,
      exam: r.exam,
      marks: r.marks,
      maxMarks: r.maxMarks,
      percentage: pct,
      grade: band?.label ?? null,
      gradePoints: band?.points ?? null,
    };
  });
  return { ...summarise(subjects), subjects };
}

/**
 * Every academic year the student has a record in, each with its terms and the
 * published results filed under them.
 *
 * Built on getPerformance(), one call per enrollment, for the same reason
 * getReportCard() is: that function owns the whole visibility model (a parent
 * only their own child, a subject teacher only the subjects they teach), and a
 * second copy of those rules here would be the easiest place in this codebase
 * to leak a record.
 *
 * A year with no published marks is still returned with an empty result set —
 * "you were in Class 8 and nothing has been published" is a different and more
 * useful answer than the year simply being missing.
 */
export async function getPerformanceHistory(actor, scope, { studentId } = {}) {
  // Whose history: the caller's own when they are the student, otherwise the
  // student named — checked against the same OWN rules as everything else.
  let targetStudentId = studentId ?? null;
  if (scope === 'OWN') {
    if (actor.roleKey === 'STUDENT') {
      const ownId = await getOwnStudentId(actor.profileId);
      if (!ownId) throw new AppError('No student record is linked to this account', 404, [], 'STUDENT_NOT_LINKED');
      if (targetStudentId && String(targetStudentId) !== ownId) {
        throw new AppError('You may only view your own performance', 403);
      }
      targetStudentId = ownId;
    } else if (actor.roleKey === 'PARENT') {
      const childIds = await getGuardianStudentIds(actor.profileId);
      if (!childIds.length) throw new AppError('No student is linked to this account', 404);
      if (targetStudentId && !childIds.includes(String(targetStudentId))) {
        throw new AppError('You do not have access to this student', 403);
      }
      targetStudentId = targetStudentId ?? childIds[0];
    } else if (actor.roleKey === 'TEACHER') {
      if (!targetStudentId) throw new AppError('studentId is required', 400);
      const sectionIds = await getTeacherSectionIds(actor.profileId);
      const inMyClass = await Enrollment.exists({ studentId: targetStudentId, sectionId: { $in: sectionIds } });
      if (!inMyClass) throw new AppError('This student is not in your classes', 403);
    } else {
      throw new AppError('You do not have access to these records', 403);
    }
  }
  if (!targetStudentId) throw new AppError('studentId is required', 400);

  const enrollments = await Enrollment.find({ studentId: targetStudentId })
    .populate({ path: 'sectionId', populate: { path: 'gradeId' } })
    .populate('academicYearId')
    .lean();

  if (!enrollments.length) return { student: null, years: [] };

  // Newest year first, so the current one opens by default.
  enrollments.sort((a, b) => {
    const av = a.academicYearId?.startsOn ? new Date(a.academicYearId.startsOn).getTime() : 0;
    const bv = b.academicYearId?.startsOn ? new Date(b.academicYearId.startsOn).getTime() : 0;
    return bv - av;
  });

  const yearIds = enrollments.map((e) => e.academicYearId?._id).filter(Boolean);
  const terms = await Term.find({ academicYearId: { $in: yearIds } }).sort({ startsOn: 1 }).lean();
  const termsByYear = new Map();
  for (const t of terms) {
    const key = String(t.academicYearId);
    if (!termsByYear.has(key)) termsByYear.set(key, []);
    termsByYear.get(key).push(t);
  }

  let student = null;
  const years = [];

  for (const enrollment of enrollments) {
    const enrollmentId = String(enrollment._id);

    let performance = null;
    try {
      performance = await getPerformance(actor, scope, { enrollmentId });
    } catch {
      // A year this actor may not read is left out rather than failing the
      // whole history.
      continue;
    }
    student = student ?? performance.student;

    let attendance = null;
    try {
      const summary = await attendanceService.getSummary(actor, scope, { enrollmentId });
      attendance = summary && typeof summary.pctPresent === 'number' ? summary : null;
    } catch {
      // Attendance is supporting detail here; its absence must not hide marks.
    }

    const yearDoc = enrollment.academicYearId;
    const results = performance.results ?? [];

    // Group by the term the exam belongs to. Results whose exam has no term
    // (older data) collect under one "Other exams" group rather than vanishing.
    const byTerm = new Map();
    for (const r of results) {
      const key = r.termId ?? 'UNASSIGNED';
      if (!byTerm.has(key)) {
        byTerm.set(key, { termId: r.termId ?? null, name: r.termName ?? 'Other exams', results: [] });
      }
      byTerm.get(key).results.push(r);
    }

    // Every term defined for the year appears, even with nothing published, so
    // "Term 2 has no results yet" is visible rather than looking like Term 2
    // does not exist.
    const yearTerms = (termsByYear.get(String(yearDoc?._id)) ?? []).map((t) => {
      const found = byTerm.get(String(t._id));
      byTerm.delete(String(t._id));
      return {
        termId: String(t._id),
        name: t.name,
        startsOn: t.startsOn,
        endsOn: t.endsOn,
        results: found?.results ?? [],
        summary: summariseResults(found?.results ?? []),
      };
    });
    for (const leftover of byTerm.values()) {
      yearTerms.push({
        termId: leftover.termId,
        name: leftover.name,
        startsOn: null,
        endsOn: null,
        results: leftover.results,
        summary: summariseResults(leftover.results),
      });
    }

    years.push({
      academicYearId: yearDoc?._id ? String(yearDoc._id) : null,
      academicYearName: yearDoc?.name ?? 'Unknown year',
      startsOn: yearDoc?.startsOn ?? null,
      endsOn: yearDoc?.endsOn ?? null,
      isCurrent: Boolean(yearDoc?.isCurrent),
      enrollmentId,
      class: enrollment.sectionId
        ? `${enrollment.sectionId.gradeId?.name ?? ''} ${enrollment.sectionId.name}`.trim()
        : null,
      rollNo: enrollment.rollNo ?? null,
      enrollmentStatus: enrollment.status,
      attendance,
      bestSubject: performance.bestSubject,
      needsSupport: performance.needsSupport,
      summary: summariseResults(results),
      terms: yearTerms,
    });
  }

  return { student, years };
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

  // A score above the paper's maximum (or below zero) is always a data-entry
  // slip, and it silently corrupts every percentage, grade and GPA computed
  // downstream — reject the whole batch so the teacher sees and fixes it.
  const maxMarks = examSubject.maxMarks ?? 100;
  const outOfRange = validEntries.filter(
    (e) => e.marks !== null && e.marks !== undefined && (Number(e.marks) < 0 || Number(e.marks) > maxMarks)
  );
  if (outOfRange.length) {
    throw new AppError(
      `Marks must be between 0 and ${maxMarks} for this paper — ${outOfRange.length} entr${outOfRange.length === 1 ? 'y is' : 'ies are'} outside that range`,
      400,
      outOfRange.map((e) => ({ enrollmentId: String(e.enrollmentId), marks: e.marks })),
      'MARKS_OUT_OF_RANGE'
    );
  }

  // Letter grades are derived from the scale, never taken from the client, so
  // the same score can't carry different grades for different students.
  const ops = validEntries.map(({ enrollmentId, marks, remarks }) => ({
    updateOne: {
      filter: { examSubjectId, enrollmentId },
      update: {
        $set: {
          marks,
          gradeLabel: gradeForPercentage(percentage(marks, maxMarks))?.label ?? null,
          remarks,
          status: 'DRAFT',
          enteredByProfileId: actor.profileId,
        },
      },
      upsert: true,
    },
  }));
  await Mark.bulkWrite(ops);
  return Mark.find({ examSubjectId });
}

export async function publishMarks(actor, scope, examSubjectId) {
  const examSubject = await loadOwnedExamSubject(actor, scope, examSubjectId);

  // Capture who is affected before publishing — afterwards the "not yet
  // published" filter no longer identifies this batch.
  const publishing = await Mark.find({ examSubjectId, status: { $ne: 'PUBLISHED' } }).select('enrollmentId').lean();

  const result = await Mark.updateMany(
    { examSubjectId, status: { $ne: 'PUBLISHED' } },
    { status: 'PUBLISHED', publishedAt: new Date() }
  );

  await notifyMarksPublished(examSubject, publishing.map((m) => m.enrollmentId));

  return { matched: result.matchedCount, modified: result.modifiedCount };
}

/**
 * Tells each affected student and their guardians that a result is out.
 *
 * Notification failures are swallowed by notify() itself: publishing marks is
 * the operation the teacher asked for, and it must not fail or roll back
 * because an inbox write did.
 */
async function notifyMarksPublished(examSubject, enrollmentIds) {
  if (!enrollmentIds.length) return;

  const enrollments = await Enrollment.find({ _id: { $in: enrollmentIds } }).select('studentId').lean();
  const studentIds = enrollments.map((e) => e.studentId);

  const [students, guardianLinks] = await Promise.all([
    Student.find({ _id: { $in: studentIds } }).select('profileId').lean(),
    StudentGuardian.find({ studentId: { $in: studentIds } }).select('guardianProfileId').lean(),
  ]);

  const subjectName = examSubject.subjectOfferingId?.subjectId?.name ?? 'a subject';
  const examName = examSubject.examId?.name ?? 'an exam';

  await notify({
    recipientProfileIds: [
      ...students.map((s) => s.profileId),
      ...guardianLinks.map((g) => g.guardianProfileId),
    ],
    type: 'MARKS',
    title: `${examName} results published`,
    body: `${subjectName} results are now available.`,
    link: '/performance',
    meta: { examSubjectId: examSubject._id },
  });
}
