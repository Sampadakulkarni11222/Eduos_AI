import { AcademicYear, SubjectOffering } from '../../../../models/academics.model.js';
import { Enrollment, Student } from '../../../../models/student.model.js';
import { Profile } from '../../../../models/profile.model.js';
import { AttendanceRecord } from '../../../../models/attendanceRecord.model.js';
import { ExamSubject, Mark } from '../../../../models/exam.model.js';
import { Assignment, Submission } from '../../../../models/assignment.model.js';
import { TermReportCard, ReportCardTemplate } from '../../../../models/reportCard.model.js';
import { ClubMembership, ClubSession } from '../../../../models/club.model.js';
import { attendanceFigures, ATTENDANCE_STATUSES } from '../../../attendance/attendance.service.js';
import { getTeacherSectionIds, getGuardianStudentIds } from '../../../../utils/scope.js';
import { AppError } from '../../../../utils/AppError.js';
import { tenantFilter } from '../../../../tenancy/tenantContext.js';
import { ok } from '../protocol.js';
import {
  RISK, studentIdentitySchema, resolveStudentId,
} from './_shared.js';
import { scorePerformance, CLASS_AVERAGE_MIN, VERSION as PERFORMANCE_VERSION } from '../metrics/studentPerformance.js';
import { formatPercent } from '../../agent/present.js';

/**
 * Part 7 (multi-ask, performance, validation): the reads the multi-part
 * questions and the open follow-ups needed.
 *
 *   get_student_performance  the deterministic performance score (metric
 *                            definition: mcp/metrics/studentPerformance.js)
 *   get_enrolment_details        a student's class, roll number and class teacher
 *                            ("who is Rahul's class teacher?", "her class?")
 *   count_staff              staff accounts only -- never parents, students or
 *                            former students ("how many staff are there?")

 * ("Who scored the highest?" is the class marks sheet with the names said:
 * get_class_marks { scorers: true }; families are told the policy instead.)
 *
 * All read-only. Every student is resolved at the caller's own students.read
 * scope (resolveStudentId), so a parent reaches only their own children and a
 * teacher only the pupils of the classes they teach; nothing here widens what
 * a screen would show the same person.
 */

const DAY = 86_400_000;
const STAFF_EXCLUDED_ROLES = new Set(['STUDENT', 'PARENT', 'ALUMNUS']);
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const classLabel = (section) => (section ? `${section.gradeId?.name ?? ''} ${section.name ?? ''}`.trim() : null);

/**
 * The student a per-student read is about, at the caller's scope, with the
 * active enrolment and the class. Nobody named: the student themselves, or a
 * parent's only child; a parent of two is asked which child.
 */
async function theStudent(ctx, args) {
  const studentId = await resolveStudentId(ctx, args ?? {});
  if (!studentId) {
    if (ctx.actor?.roleKey === 'PARENT') {
      const children = await getGuardianStudentIds(ctx.actor.profileId);
      if (children.length > 1) throw new AppError("Which child? Tell me your child's name.", 400, [], 'AGENT_NEEDS_INPUT');
    }
    throw new AppError('Which student? Give a name or admission number.', 400, [], 'AGENT_NEEDS_INPUT');
  }
  const enrollment = await Enrollment.findOne({ studentId, status: 'ACTIVE' })
    .populate({ path: 'sectionId', populate: [{ path: 'gradeId' }, { path: 'classTeacherId', select: 'displayName' }] })
    .lean();
  if (!enrollment) throw new AppError('That student has no active enrolment.', 404, [], 'NOT_FOUND');
  // A teacher reaches only the pupils of the classes they teach (the same line
  // every OWN-scoped class read draws). students.read OWN already says so;
  // checked again because this read gathers several modules at once.
  if (ctx.actor?.roleKey === 'TEACHER' && ctx.scope !== 'ALL') {
    const mine = await getTeacherSectionIds(ctx.actor.profileId);
    if (!mine.includes(String(enrollment.sectionId?._id))) {
      throw new AppError('You can see this only for students you teach.', 403, [], 'AGENT_FORBIDDEN_SCOPE');
    }
  }
  const student = await Student.findById(studentId).select('firstName lastName admissionNo').lean();
  return {
    studentId: String(studentId),
    enrollment,
    name: `${student?.firstName ?? ''} ${student?.lastName ?? ''}`.trim() || 'The student',
    section: enrollment.sectionId,
    className: classLabel(enrollment.sectionId),
  };
}

/** The period: from/to when given, else the current academic year so far. */
async function periodOf(args) {
  const today = new Date();
  const to = args.to ? new Date(`${args.to}T23:59:59.999Z`) : today;
  let from = args.from ? new Date(`${args.from}T00:00:00.000Z`) : null;
  if (!from) {
    const year = await AcademicYear.findOne({ isCurrent: true }).lean() ?? await AcademicYear.findOne().sort({ startsOn: -1 }).lean();
    from = year?.startsOn ? new Date(year.startsOn) : new Date(today.getTime() - 180 * DAY);
  }
  if (to < from) throw new AppError('The end date cannot be before the start date.', 400, [], 'AGENT_NEEDS_INPUT');
  return { from, to, label: { from: iso(from), to: iso(to) } };
}

async function gatherPerformance(ctx, who, period) {
  const enrollmentId = who.enrollment._id;
  const sectionId = who.section?._id;
  const inRange = { $gte: period.from, $lte: period.to };

  // Attendance: day-level marks, counted as the attendance module counts.
  const attRows = await AttendanceRecord.aggregate([
    { $match: { enrollmentId, periodNo: null, status: { $in: ATTENDANCE_STATUSES }, date: inRange } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const attendance = attendanceFigures(Object.fromEntries(attRows.map((r) => [r._id, r.count])));

  // Papers set for the class in the period, and the student's published marks on them.
  const offerings = await SubjectOffering.find({ sectionId }).select('_id subjectId').populate('subjectId', 'name').lean();
  const offeringIds = offerings.map((o) => o._id);
  const papers = await ExamSubject.find({ subjectOfferingId: { $in: offeringIds } })
    .populate('examId', 'name startsOn').populate({ path: 'subjectOfferingId', select: 'subjectId', populate: { path: 'subjectId', select: 'name' } }).lean();
  const dateOf = (p) => p.examDate ?? p.examId?.startsOn ?? null;
  const inPeriod = papers.filter((p) => { const d = dateOf(p); return d && new Date(d) >= period.from && new Date(d) <= period.to; });
  const marks = await Mark.find({ examSubjectId: { $in: inPeriod.map((p) => p._id) }, status: 'PUBLISHED' }).lean();
  const classEnrollments = await Enrollment.find({ sectionId, status: 'ACTIVE' }).select('_id').lean();
  const classIds = new Set(classEnrollments.map((e) => String(e._id)));
  const assessments = [];
  for (const p of inPeriod) {
    const own = marks.find((m) => String(m.examSubjectId) === String(p._id) && String(m.enrollmentId) === String(enrollmentId));
    if (!own || typeof own.marks !== 'number') continue;
    const peers = marks.filter((m) => String(m.examSubjectId) === String(p._id) && classIds.has(String(m.enrollmentId)) && typeof m.marks === 'number');
    const maxMarks = p.maxMarks ?? 100;
    const classAverage = peers.length >= CLASS_AVERAGE_MIN
      ? Math.round((peers.reduce((a, m) => a + m.marks, 0) / (peers.length * maxMarks)) * 10_000) / 100
      : null;
    assessments.push({
      exam: p.examId?.name ?? 'Test', subject: p.subjectOfferingId?.subjectId?.name ?? 'Subject', date: iso(dateOf(p)),
      marks: own.marks, maxMarks, classAverage, classMarked: peers.length,
    });
  }

  // Assignments: due in the period up to now (or submitted early), exempt ones left out.
  const now = new Date();
  const assignments = await Assignment.find({ subjectOfferingId: { $in: offeringIds }, deletedAt: null, dueAt: { $gte: period.from } }).select('_id dueAt').lean();
  const subs = await Submission.find({ enrollmentId, assignmentId: { $in: assignments.map((a) => a._id) } }).lean();
  const subOf = new Map(subs.map((s) => [String(s.assignmentId), s]));
  const tally = { due: 0, submitted: 0, onTime: 0, late: 0, upcoming: 0 };
  for (const a of assignments) {
    const s = subOf.get(String(a._id));
    if (s?.status === 'EXEMPT') continue;
    const handedIn = s && ['SUBMITTED', 'LATE', 'GRADED'].includes(s.status);
    if (new Date(a.dueAt) > now && !handedIn) { tally.upcoming += 1; continue; }
    if (new Date(a.dueAt) > period.to && !handedIn) continue;
    tally.due += 1;
    if (handedIn) {
      tally.submitted += 1;
      const onTime = s.status !== 'LATE' && (!s.submittedAt || new Date(s.submittedAt) <= new Date(a.dueAt));
      if (onTime) tally.onTime += 1; else tally.late += 1;
    }
  }

  // Co-scholastic grades: the latest PUBLISHED report card only. The
  // discipline grade is deliberately not read (no behaviour scores).
  const card = await TermReportCard.findOne({ enrollmentId, status: 'PUBLISHED' }).sort({ publishedAt: -1, updatedAt: -1 }).lean();
  let coScholastic = null;
  if (card && card.coScholastic && Object.keys(card.coScholastic).length) {
    const tpl = await ReportCardTemplate.findById(card.templateId).lean();
    const labelOf = new Map((tpl?.coScholasticAreas ?? []).map((a) => [a.key, a.label]));
    coScholastic = {
      scale: tpl?.coScholasticGrades ?? ['A', 'B', 'C'],
      grades: Object.entries(card.coScholastic).filter(([, g]) => g).map(([k, g]) => ({ area: labelOf.get(k) ?? k, grade: String(g) })),
    };
  }

  // Clubs: sessions held in the period whose register lists the student.
  const memberships = await ClubMembership.countDocuments({ studentId: who.studentId, status: 'ACTIVE' });
  const sessions = await ClubSession.find({ status: 'HELD', startsAt: inRange, 'attendance.studentId': who.studentId }).select('attendance').lean();
  let held = 0;
  let attended = 0;
  for (const s of sessions) {
    const row = s.attendance.find((r) => String(r.studentId) === who.studentId);
    if (!row || row.status === 'EXCUSED') continue;
    held += 1;
    if (row.status === 'PRESENT') attended += 1;
  }

  return {
    period: period.label,
    attendance: attendance.workingDays ? attendance : null,
    assessments,
    papersSet: inPeriod.length,
    assignments: tally,
    coScholastic,
    clubs: { memberships, held, attended },
  };
}

/** Subject-wise trend: each subject's latest paper against its previous one, with the class average where shown. */
function subjectTrend(assessments) {
  const bySubject = new Map();
  for (const a of [...assessments].sort((x, y) => String(x.date ?? '').localeCompare(String(y.date ?? '')))) {
    if (!bySubject.has(a.subject)) bySubject.set(a.subject, []);
    bySubject.get(a.subject).push(a);
  }
  return [...bySubject.entries()].map(([subject, list]) => {
    const pct = (a) => Math.round((a.marks / a.maxMarks) * 10_000) / 100;
    const cur = list.at(-1);
    const prev = list.length > 1 ? list.at(-2) : null;
    return {
      subject,
      current: { exam: cur.exam, percent: pct(cur) },
      previous: prev ? { exam: prev.exam, percent: pct(prev) } : null,
      change: prev ? Math.round((pct(cur) - pct(prev)) * 100) / 100 : null,
      classAverage: cur.classAverage,
      classAverageNote: cur.classAverage == null ? `not shown (fewer than ${CLASS_AVERAGE_MIN} classmates with a mark)` : null,
    };
  });
}

export const p7MultiTools = {
  get_student_performance: {
    module: 'Exams',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "A student's overall PERFORMANCE SCORE with its band, calculated by a fixed, versioned formula from attendance %, marks (and their trend against the previous test, subject-wise, with the class average where at least 5 classmates have marks), assignment completion and on-time rate, consistency across tests, co-scholastic grades and club participation -- whatever is recorded; components with no data are left out and the weights re-normalised. Returns each component's value and weight, the period, the data coverage, how it is calculated, and links to the records. Use for \"Rahul's performance\", \"performance score\", \"how is my child performing\". A parent: their own child; a teacher: a student they teach. Read-only.",
    inputSchema: {
      type: 'object',
      properties: {
        ...studentIdentitySchema,
        from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Start of the period (default: the start of the academic year)' },
        to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'End of the period (default: today)' },
      },
      additionalProperties: false,
    },
    permission: 'marks.read',
    service: 'metrics/studentPerformance.scorePerformance() over attendance, published marks, assignments, published report cards and club registers',
    async run(ctx, args) {
      const who = await theStudent(ctx, args);
      const period = await periodOf(args);
      const input = await gatherPerformance(ctx, who, period);
      const score = scorePerformance(input);
      const subjects = subjectTrend(input.assessments);
      const data = {
        student: { name: who.name, class: who.className },
        ...score,
        subjects,
        evidence: score.components.filter((c) => c.included).map((c) => ({ label: c.label, link: c.link })),
        link: '/exams',
      };
      const o = score.overall;
      if (o.score == null) {
        return ok(data, {
          speak: `There isn't enough recorded for ${who.name} yet to calculate a performance score (${score.excluded.map((e) => e.label.toLowerCase()).join(', ')}: nothing recorded in ${period.label.from} to ${period.label.to}).`,
        });
      }
      const rows = score.components.map((c) => (c.included
        ? { label: `${c.label} (weight ${c.weightPct}%)`, detail: `${c.value} — score ${c.score}${c.detail ? ` · ${c.detail}` : ''}` }
        : { label: `${c.label}`, detail: `not included — ${c.excluded}` }));
      const trend = subjects.map((s) => `${s.subject}: ${s.current.exam} ${formatPercent(s.current.percent)}`
        + (s.previous ? ` (previous ${s.previous.exam} ${formatPercent(s.previous.percent)}, ${s.change >= 0 ? '+' : ''}${s.change} points)` : '')
        + (s.classAverage != null ? `, class average ${formatPercent(s.classAverage)}` : ''));
      return ok(data, {
        speak: `${who.name}'s performance score is ${o.score} out of 100 (${o.band}), from ${period.label.from} to ${period.label.to}.`,
        view: {
          type: 'list.numbered',
          intro: `**${who.name}${who.className ? ` (${who.className})` : ''} — performance score ${o.score}/100 · ${o.band}**\nPeriod ${period.label.from} to ${period.label.to} · metric v${PERFORMANCE_VERSION}`,
          items: rows,
          outro: [
            trend.length ? `**Subjects:** ${trend.join('; ')}.` : null,
            `**Data coverage:** ${score.coverage.tests}; ${score.coverage.attendance}; ${score.coverage.assignments}.`,
            `_${score.weighting.note}_`,
            `**How it's calculated:** ${score.howCalculated.join(' ')}`,
          ].filter(Boolean).join('\n\n'),
        },
      });
    },
  },

  get_enrolment_details: {
    module: 'Students',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "A student's class (grade and section), roll number and class teacher's name. Use for \"who is Rahul's class teacher\", \"which class is Riya in\", \"her class?\", \"my child's class teacher\". A parent: their own children; a teacher: their own pupils. Read-only.",
    inputSchema: { type: 'object', properties: { ...studentIdentitySchema }, additionalProperties: false },
    permission: 'students.read',
    service: 'Enrollment (active) + Section.classTeacherId for a student at the caller\'s scope',
    async run(ctx, args) {
      const who = await theStudent(ctx, args);
      const teacher = who.section?.classTeacherId?.displayName ?? null;
      const data = {
        studentName: who.name,
        class: who.className,
        rollNo: who.enrollment.rollNo ?? null,
        classTeacher: teacher,
        link: '/students',
      };
      return ok(data, {
        speak: `${who.name} is in ${who.className ?? 'no class yet'}${data.rollNo != null ? `, roll number ${data.rollNo}` : ''}. `
          + (teacher ? `The class teacher is ${teacher}.` : 'No class teacher is assigned to that class yet.'),
      });
    },
  },

  count_staff: {
    module: 'Users',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'How many STAFF accounts the school has, by role -- counting only staff (teachers, administrators, office, finance, library, hostel, health and so on), never parents, students or former students. Use for "how many staff are there", "staff strength", "number of employees". Read-only.',
    inputSchema: {
      type: 'object',
      properties: { includeInactive: { type: 'boolean', description: 'Count inactive staff accounts too (default: active only)' } },
      additionalProperties: false,
    },
    permission: 'users.read',
    minScope: 'ALL',
    service: 'Profile (this school) grouped by role, excluding STUDENT, PARENT and ALUMNUS',
    async run(_ctx, args) {
      // Profiles are platform-wide (one person may work in two schools), so the
      // acting school is filtered explicitly, as the Users screen does.
      const scope = tenantFilter();
      const profiles = await Profile.find({ ...scope, deletedAt: null, ...(args.includeInactive ? {} : { status: 'ACTIVE' }) })
        .select('roleId status').populate('roleId', 'key name').lean();
      const byRole = new Map();
      for (const p of profiles) {
        const key = p.roleId?.key;
        if (!key || STAFF_EXCLUDED_ROLES.has(key)) continue;
        const label = p.roleId?.name ?? key;
        byRole.set(label, (byRole.get(label) ?? 0) + 1);
      }
      const roles = [...byRole.entries()].map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count || a.role.localeCompare(b.role));
      const total = roles.reduce((a, r) => a + r.count, 0);
      return ok({ total, roles, active: !args.includeInactive, link: '/users' }, {
        speak: total
          ? `${total} ${args.includeInactive ? '' : 'active '}staff account(s): ${roles.map((r) => `${r.role} ${r.count}`).join(', ')}. Parents, students and former students are not counted.`
          : 'There are no staff accounts yet.',
      });
    },
  },
};

