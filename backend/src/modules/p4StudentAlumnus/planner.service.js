import { Student, Enrollment, StudentGuardian } from '../../models/student.model.js';
import { Section, Grade, SubjectOffering } from '../../models/academics.model.js';
import { Assignment, Submission } from '../../models/assignment.model.js';
import { ExamSubject, Mark } from '../../models/exam.model.js';
import { Quiz, QuizAttempt } from '../../models/quiz.model.js';
import { CalendarEvent } from '../../models/calendarEvent.model.js';
import { Profile } from '../../models/profile.model.js';
import { AppError } from '../../utils/AppError.js';
import { getGuardianStudentIds } from '../../utils/scope.js';
import { requireProfile, startOfDayUtc } from '../ops/common.js';
import { localDate } from '../../utils/periods.js';

/**
 * A student's planner: what is due, what is coming, and a suggested study
 * plan built only from the school's own records.
 *
 *   due        homework not yet handed in, due in the window (plus overdue)
 *   quizzes    published quizzes for the class not yet attempted
 *   exams      exam papers in the window
 *   events     school calendar in the window (holidays mark days off)
 *   strengths  the student's own published marks, per subject (never anyone else's)
 *   plan       a suggested week: a few study blocks a day sized for the
 *              student's age, each with the reason it was chosen (an exam in
 *              N days, homework due tomorrow, the weakest subject). It is a
 *              suggestion the student can ignore; nothing is booked or sent.
 *   board      for Classes 10 and 12: the details a board registers (name,
 *              date of birth, parents' names, subjects) to check before the
 *              school submits them, with how to ask for a correction.
 *
 * A parent may read the planner of a child linked to them.
 */

const DAY = 86_400_000;
const DONE = ['SUBMITTED', 'LATE', 'GRADED', 'EXEMPT'];

/** Daily study minutes by stage: short for young children, longer near boards. */
export function dailyMinutesFor(gradeNo) {
  if (gradeNo === null || gradeNo === undefined) return 60;
  if (gradeNo <= 2) return 20;
  if (gradeNo <= 5) return 30;
  if (gradeNo <= 8) return 60;
  if (gradeNo <= 10) return 90;
  return 120;
}
export const stageFor = (gradeNo) => (gradeNo === null || gradeNo === undefined ? 'UNKNOWN'
  : gradeNo <= 5 ? 'PRIMARY' : gradeNo <= 8 ? 'MIDDLE' : gradeNo <= 10 ? 'SECONDARY' : 'SENIOR_SECONDARY');

async function contextFor(actor, studentId) {
  requireProfile(actor);
  let student;
  if (actor.roleKey === 'STUDENT') {
    student = await Student.findOne({ profileId: actor.profileId, deletedAt: null }).lean();
  } else if (actor.roleKey === 'PARENT') {
    const ids = await getGuardianStudentIds(actor.profileId);
    const target = studentId ? String(studentId) : ids.length === 1 ? ids[0] : null;
    if (!target) throw new AppError('Choose which child', 400, [], 'CHILD_REQUIRED');
    if (!ids.includes(target)) throw new AppError('No linked child found', 404, [], 'STUDENT_NOT_LINKED');
    student = await Student.findOne({ _id: target, deletedAt: null }).lean();
  } else {
    throw new AppError('The planner is for students and their parents', 403, [], 'ROLE_NOT_PERMITTED');
  }
  if (!student) throw new AppError('No student record is linked to this account', 404, [], 'STUDENT_NOT_LINKED');
  const enrollment = await Enrollment.findOne({ studentId: student._id, status: 'ACTIVE' }).sort({ createdAt: -1 }).lean();
  if (!enrollment) throw new AppError('No current class found for this student', 404, [], 'NO_ENROLLMENT');
  const section = await Section.findById(enrollment.sectionId).lean();
  const grade = section ? await Grade.findById(section.gradeId).lean() : null;
  const m = /(\d{1,2})/.exec(grade?.name ?? '');
  return { student, enrollment, section, grade, gradeNo: m ? Number(m[1]) : null };
}

const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const niceDay = (d) => new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
/** Subjects a study plan does not prescribe practice for. */
export const NON_ACADEMIC = /physical|sport|games|\bart\b|music|dance|yoga|drawing|craft|\bPE\b/i;

export async function getPlanner(actor, { studentId = null, days = 21, now = new Date() } = {}) {
  const ctx = await contextFor(actor, studentId);
  const { student, enrollment, section, grade, gradeNo } = ctx;
  const span = Math.min(Math.max(Number(days) || 21, 7), 60);
  const today = startOfDayUtc(now);
  const until = new Date(today.getTime() + span * DAY - 1);

  const offerings = await SubjectOffering.find({ sectionId: section._id }).populate('subjectId', 'name').lean();
  const offeringIds = offerings.map((o) => o._id);
  const subjectOf = new Map(offerings.map((o) => [String(o._id), o.subjectId?.name ?? 'Subject']));

  const [assignments, examPapers, quizzes, events, marks] = await Promise.all([
    Assignment.find({ subjectOfferingId: { $in: offeringIds }, deletedAt: null, dueAt: { $gte: new Date(today.getTime() - 14 * DAY), $lte: until } }).sort({ dueAt: 1 }).lean(),
    ExamSubject.find({ subjectOfferingId: { $in: offeringIds }, examDate: { $gte: today, $lte: until } }).populate('examId', 'name').sort({ examDate: 1 }).lean(),
    Quiz.find({ sectionId: section._id, status: 'PUBLISHED', deletedAt: null }).select('title subjectOfferingId durationMinutes totalMarks publishedAt').sort({ publishedAt: -1 }).limit(30).lean(),
    CalendarEvent.find({ deletedAt: null, startsAt: { $lte: until }, endsAt: { $gte: today } }).select('title type startsAt endsAt').sort({ startsAt: 1 }).limit(60).lean(),
    Mark.find({ enrollmentId: enrollment._id, status: 'PUBLISHED', marks: { $ne: null } }).populate({ path: 'examSubjectId', select: 'subjectOfferingId maxMarks' }).lean(),
  ]);

  const subs = await Submission.find({ enrollmentId: enrollment._id, assignmentId: { $in: assignments.map((a) => a._id) } }).select('assignmentId status').lean();
  const subBy = new Map(subs.map((s) => [String(s.assignmentId), s.status]));
  const open = assignments.filter((a) => !DONE.includes(subBy.get(String(a._id))));
  const due = open.filter((a) => a.dueAt >= today).map((a) => ({
    id: String(a._id), title: a.title, subject: subjectOf.get(String(a.subjectOfferingId)) ?? null, type: a.type, chapter: a.chapter ?? null,
    dueAt: a.dueAt, daysLeft: Math.round((startOfDayUtc(a.dueAt) - today) / DAY), status: subBy.get(String(a._id)) ?? 'NOT_STARTED',
  }));
  const overdue = open.filter((a) => a.dueAt < today).map((a) => ({
    id: String(a._id), title: a.title, subject: subjectOf.get(String(a.subjectOfferingId)) ?? null, dueAt: a.dueAt, status: subBy.get(String(a._id)) ?? 'NOT_STARTED',
  }));

  const attempts = await QuizAttempt.find({ enrollmentId: enrollment._id, quizId: { $in: quizzes.map((q) => q._id) } }).select('quizId status').lean();
  const tried = new Set(attempts.filter((t) => t.status !== 'IN_PROGRESS').map((t) => String(t.quizId)));
  const openQuizzes = quizzes.filter((q) => !tried.has(String(q._id))).map((q) => ({
    id: String(q._id), title: q.title, subject: subjectOf.get(String(q.subjectOfferingId)) ?? null, durationMinutes: q.durationMinutes, totalMarks: q.totalMarks,
  }));

  const exams = examPapers.map((p) => ({
    exam: p.examId?.name ?? 'Exam', subject: subjectOf.get(String(p.subjectOfferingId)) ?? null, date: p.examDate,
    daysLeft: Math.round((startOfDayUtc(p.examDate) - today) / DAY), maxMarks: p.maxMarks,
  }));

  // The student's own results, per subject.
  const per = new Map();
  for (const mk of marks) {
    const off = mk.examSubjectId?.subjectOfferingId; const max = mk.examSubjectId?.maxMarks || 100;
    if (!off) continue;
    const name = subjectOf.get(String(off));
    if (!name) continue;
    const row = per.get(name) ?? { subject: name, got: 0, max: 0, papers: 0 };
    row.got += Number(mk.marks) || 0; row.max += max; row.papers += 1;
    per.set(name, row);
  }
  const strengths = [...per.values()].map((r) => ({ subject: r.subject, percentage: r.max ? Math.round((r.got / r.max) * 100) : null, papers: r.papers }))
    .sort((a, b) => (a.percentage ?? 101) - (b.percentage ?? 101));
  // Practice goes to academic subjects only (not games, art or music), lowest first:
  // every subject under 60%, topped up with the next lowest to at least two.
  const academic = strengths.filter((x) => x.percentage !== null && !NON_ACADEMIC.test(x.subject));
  const weakest = academic.filter((x) => x.percentage < 60).map((x) => x.subject);
  for (const x of academic) { if (weakest.length >= 2) break; if (!weakest.includes(x.subject)) weakest.push(x.subject); }

  const holidays = events.filter((e) => e.type === 'HOLIDAY');
  const isOff = (d) => {
    const { y, m, d: day } = localDate(d);
    const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
    return dow === 0 || holidays.some((h) => h.startsAt <= new Date(d.getTime() + DAY - 1) && h.endsAt >= d);
  };

  // A parent reads the plan about their child, so it names the child instead of saying "your".
  const forParent = actor?.roleKey === 'PARENT';
  const whose = forParent ? `${student.firstName ?? 'Your child'}’s` : 'your';
  const Whose = forParent ? whose : 'Your';
  const minutes = dailyMinutesFor(gradeNo);
  const block = gradeNo !== null && gradeNo <= 5 ? 15 : gradeNo !== null && gradeNo <= 8 ? 30 : 45;
  const plan = [];
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(today.getTime() + i * DAY);
    const off = isOff(day);
    const blocks = [];
    // 1. Homework due the next day comes first.
    for (const a of due.filter((x) => x.daysLeft === i + 1)) blocks.push({ subject: a.subject, minutes: block, kind: 'HOMEWORK', reason: `“${a.title}” is due ${i === 0 ? 'tomorrow' : `on ${niceDay(a.dueAt)}`}` });
    // 2. Revision for exams within ten days, nearest first.
    for (const e of exams.filter((x) => x.daysLeft > i && x.daysLeft - i <= 10).slice(0, 2)) {
      blocks.push({ subject: e.subject, minutes: block, kind: 'REVISION', reason: `${e.exam} ${e.subject} paper in ${e.daysLeft - i} day${e.daysLeft - i === 1 ? '' : 's'}${weakest.includes(e.subject) ? ` — and ${whose} marks show this subject needs the most work` : ''}` });
    }
    // 3. Fill the rest of the day with practice, rotating through the lowest subjects.
    for (let k = 0; k < weakest.length && blocks.reduce((n, b) => n + b.minutes, 0) + block <= minutes; k += 1) {
      const sub = weakest[(i + k) % weakest.length];
      if (blocks.some((b) => b.subject === sub)) continue;
      const p = strengths.find((x) => x.subject === sub);
      blocks.push({ subject: sub, minutes: block, kind: 'PRACTICE', reason: `${Whose} published marks in ${sub} average ${p?.percentage ?? '—'}%${sub === weakest[0] ? `, ${forParent ? 'the' : 'your'} lowest` : ''}` });
    }
    let used = 0; const fitted = [];
    for (const b of blocks) { if (used + b.minutes > minutes) break; fitted.push(b); used += b.minutes; }
    // A Sunday or holiday keeps only what cannot wait (homework or an exam), as one optional block.
    const kept = off ? fitted.filter((b) => b.kind !== 'PRACTICE').slice(0, 1) : fitted;
    plan.push({ date: ymd(day), dayOff: off, totalMinutes: kept.reduce((n, b) => n + b.minutes, 0), blocks: kept });
  }

  const board = gradeNo === 10 || gradeNo === 12 ? await boardDetails(student, offerings, gradeNo, events) : null;

  return {
    student: { name: [student.firstName, student.lastName].filter(Boolean).join(' '), className: grade ? `${grade.name} ${section.name}`.trim() : null, gradeNo, stage: stageFor(gradeNo) },
    window: { from: ymd(today), to: ymd(until), days: span },
    due, overdue, quizzes: openQuizzes, exams,
    events: events.map((e) => ({ title: e.title, type: e.type, startsAt: e.startsAt, endsAt: e.endsAt })),
    strengths,
    plan: { dailyMinutes: minutes, days: plan, note: forParent ? `A suggestion built from ${whose} homework, exam dates and published marks. Change it together to suit the family; nothing is booked or sent.` : 'A suggestion built from your homework, exam dates and your own published marks. Change it to suit you; nothing is booked or sent.' },
    board,
  };
}

async function boardDetails(student, offerings, gradeNo, events) {
  const links = await StudentGuardian.find({ studentId: student._id }).lean();
  const names = new Map((await Profile.find({ _id: { $in: links.map((l) => l.guardianProfileId) } }).select('displayName').lean()).map((p) => [String(p._id), p.displayName]));
  const parent = (rel) => { const l = links.find((x) => x.relation === rel); return l ? names.get(String(l.guardianProfileId)) ?? null : null; };
  const checks = [
    { key: 'name', label: "Candidate's name", value: [student.firstName, student.lastName].filter(Boolean).join(' ') },
    { key: 'dob', label: 'Date of birth', value: student.dob ? ymd(student.dob) : null },
    { key: 'gender', label: 'Gender', value: student.gender ?? null },
    { key: 'mother', label: "Mother's name", value: parent('MOTHER') },
    { key: 'father', label: "Father's name", value: parent('FATHER') },
    { key: 'guardian', label: "Guardian's name", value: parent('GUARDIAN') },
    { key: 'subjects', label: 'Subjects', value: [...new Set(offerings.map((o) => o.subjectId?.name).filter(Boolean))].join(', ') || null },
  ].filter((c) => c.key !== 'guardian' || c.value);
  const deadlines = events.filter((e) => /board|\bLOC\b|registration|admit card|date ?sheet/i.test(e.title)).map((e) => ({ title: e.title, date: e.startsAt }));
  return {
    exam: `Class ${gradeNo} board examination`,
    checks: checks.map((c) => ({ ...c, missing: !c.value })),
    deadlines,
    guidance: 'The school sends these details to the board in its List of Candidates. Spellings, date of birth, parents\' names and subjects cannot easily be changed later, so check each one now. If anything is wrong or missing, ask for a correction from My Profile (it goes to the school office) and tell your class teacher.',
  };
}
