import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { AcademicYear, SubjectOffering } from '../../models/academics.model.js';
import { Mark, ExamSubject } from '../../models/exam.model.js';
import { Assignment, Submission } from '../../models/assignment.model.js';
import { CoCurricularActivity } from '../../models/coCurricular.model.js';
import { Invoice } from '../../models/fee.model.js';
import { attendanceFigures } from '../attendance/attendance.service.js';
import { currentFor } from '../syllabus/syllabus.service.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { activeEnrollment, classLabel, isGuardianOf, studentLabel, loadStudent, istDay } from './relations.js';

const DAY = 86_400_000;

/**
 * A short, child-specific briefing for a parent meeting or review call:
 * attendance, recent published marks, where each subject's syllabus is,
 * homework completion and co-curricular participation. Fees appear only when
 * the person reading holds fees.read for this child (school-wide, or as the
 * child's own guardian); a teacher without that permission never sees them.
 *
 * Every figure says what it counts. Nothing here is a judgement about the
 * child; it is what the records say, for the adults to talk through.
 */
export async function childBriefing(actor, studentId, { now = new Date(), purpose = 'PTM' } = {}) {
  const student = await loadStudent(studentId);
  const enrol = await activeEnrollment(student._id);
  const year = await AcademicYear.findOne({ isCurrent: true }).select('startsOn name').lean();
  const since = year?.startsOn ?? new Date(now.getTime() - 180 * DAY);
  const out = {
    student: { id: String(student._id), name: studentLabel(student), admissionNo: student.admissionNo, className: classLabel(enrol?.sectionId) },
    asOf: now.toISOString(),
    attendance: null, recentMarks: [], syllabus: [], homework: null, coCurricular: [], fees: null,
    feesShown: false,
  };
  if (!enrol) return out;
  const sectionId = enrol.sectionId?._id ?? enrol.sectionId;

  const [att, marks, offerings, activities] = await Promise.all([
    AttendanceRecord.aggregate([
      // Registers are stored at UTC midnight of the India day, so today counts from just after midnight IST.
      { $match: { enrollmentId: enrol._id, periodNo: null, date: { $gte: since, $lte: istDay(now) } } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
    Mark.find({ enrollmentId: enrol._id, status: 'PUBLISHED' }).sort({ publishedAt: -1 }).limit(8).lean(),
    SubjectOffering.find({ sectionId }).populate('subjectId', 'name').select('subjectId teacherId').lean(),
    CoCurricularActivity.find({ studentId: student._id, status: 'APPROVED', activityDate: { $gte: new Date(now.getTime() - 365 * DAY) } }).sort({ activityDate: -1 }).limit(6).lean(),
  ]);

  const counts = Object.fromEntries(att.map((r) => [r._id, r.n]));
  const figures = attendanceFigures(counts);
  out.attendance = { ...figures, since, definition: 'Whole-day register marks this academic year. Late and excused count as attended, a half day as half. No marks means no percentage.' };

  const examSubjects = await ExamSubject.find({ _id: { $in: marks.map((m) => m.examSubjectId) } }).populate('examId', 'name').populate({ path: 'subjectOfferingId', select: 'subjectId', populate: { path: 'subjectId', select: 'name' } }).lean();
  const esById = new Map(examSubjects.map((e) => [String(e._id), e]));
  out.recentMarks = marks.map((m) => {
    const es = esById.get(String(m.examSubjectId));
    const pct = m.marks !== null && m.marks !== undefined && es?.maxMarks ? Math.round((m.marks / es.maxMarks) * 1000) / 10 : null;
    return { exam: es?.examId?.name ?? null, subject: es?.subjectOfferingId?.subjectId?.name ?? null, marks: m.marks ?? null, maxMarks: es?.maxMarks ?? null, percentage: pct, absence: m.absence ?? null, grade: m.gradeLabel ?? null, publishedAt: m.publishedAt ?? null };
  });

  const current = await currentFor(offerings.map((o) => o._id));
  out.syllabus = offerings.map((o) => {
    const s = current.get(String(o._id));
    return { subject: o.subjectId?.name ?? 'Subject', coveragePct: s?.coveragePct ?? null, health: s?.health ?? 'NO_PLAN', currentModule: s?.current?.title ?? null, pace: s?.current?.pace ?? null };
  }).sort((a, b) => a.subject.localeCompare(b.subject));

  const assignments = await Assignment.find({ subjectOfferingId: { $in: offerings.map((o) => o._id) }, deletedAt: null, dueAt: { $gte: new Date(now.getTime() - 60 * DAY), $lte: now } }).select('_id').lean();
  if (assignments.length) {
    const subs = await Submission.find({ assignmentId: { $in: assignments.map((a) => a._id) }, enrollmentId: enrol._id }).select('status').lean();
    const exempt = subs.filter((s) => s.status === 'EXEMPT').length;
    const done = subs.filter((s) => ['SUBMITTED', 'GRADED', 'LATE'].includes(s.status)).length;
    const late = subs.filter((s) => s.status === 'LATE').length;
    const due = assignments.length - exempt;
    out.homework = { due, submitted: done, late, completionPct: due > 0 ? Math.round((done / due) * 100) : null, definition: 'Homework due in the last 60 days in this class; submitted includes late and graded work.' };
  } else {
    out.homework = { due: 0, submitted: 0, late: 0, completionPct: null, definition: 'No homework was due in the last 60 days.' };
  }

  out.coCurricular = activities.map((a) => ({ name: a.name, category: a.category, level: a.level, achievement: a.achievement ?? null, on: a.activityDate }));

  // Fees: only for someone who may read this child's fees.
  const feeScope = actor?.permissions?.['fees.read'];
  const mayReadFees = feeScope === 'ALL' || (feeScope === 'OWN' && await isGuardianOf(actor.profileId, student._id));
  if (mayReadFees) {
    const invoices = await Invoice.find({ enrollmentId: enrol._id, status: { $ne: 'CANCELLED' } }).select('totalPaise paidPaise status dueOn').lean();
    const open = invoices.filter((i) => i.status !== 'PAID');
    out.fees = {
      outstandingPaise: open.reduce((t, i) => t + Math.max(0, (i.totalPaise ?? 0) - (i.paidPaise ?? 0)), 0),
      overdueInvoices: open.filter((i) => new Date(i.dueOn) < now).length,
      openInvoices: open.length,
    };
    out.feesShown = true;
  }

  await recordAudit({ actor, action: `${purpose.toLowerCase()}.briefing.read`, entityType: 'Student', entityId: student._id, after: { feesShown: out.feesShown } });
  return out;
}
