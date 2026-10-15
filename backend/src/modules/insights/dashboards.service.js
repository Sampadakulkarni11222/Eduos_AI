import mongoose from 'mongoose';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { plural } from '../../utils/plural.js';
import { localDate } from '../../utils/periods.js';
import { featureEnabled } from '../../utils/features.js';
import { getTeacherSectionIds, getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';
import { startOfDayUtc } from '../ops/common.js';
import { ATTENDANCE_SAFE_PCT } from '../risk/risk.service.js';
import { standing } from '../syllabus/syllabus.service.js';
import * as compliance from '../compliance/compliance.service.js';
import { myTrips } from '../fleet/trips.service.js';
import { overview as analyticsOverview } from '../analytics/analytics.service.js';
import { Student, Enrollment } from '../../models/student.model.js';
import { Section, SubjectOffering } from '../../models/academics.model.js';
import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { Assignment, Submission } from '../../models/assignment.model.js';
import { ExamSubject, Mark } from '../../models/exam.model.js';
import { TimetableSlot } from '../../models/timetableSlot.model.js';
import { CourseModule } from '../../models/courseModule.model.js';
import { PtmBooking, ReviewCase } from '../../models/ptm.model.js';
import { CoverAssignment, StaffLeave } from '../../models/staffLeave.model.js';
import { PracticalSession } from '../../models/lab.model.js';
import { Invoice, Payment } from '../../models/fee.model.js';
import { ClubMembership, ClubSession } from '../../models/club.model.js';
import { ShowcaseEntry } from '../../models/showcase.model.js';
import { EcoTeam, EcoActivity } from '../../models/sustainability.model.js';
import { DigestEdition } from '../../models/digest.model.js';
import { BookIssue, Book } from '../../models/library.model.js';
import { HostelRoom, HostelAllocation } from '../../models/hostel.model.js';
import { OutPass } from '../../models/safety.model.js';
import { Lead } from '../../models/lead.model.js';
import { Profile } from '../../models/profile.model.js';
import { Role } from '../../models/role.model.js';

/**
 * Role dashboards: the interactive, per-person half of each home page.
 *
 * The pulse board (pulse.service.js) is the school-wide picture the principal
 * and admin use. This adds a dashboard for the people whose day is about their
 * own classes, their own child or their own work: a teacher's classes, a
 * parent's child (one at a time, with a switcher), a student's own record,
 * and the queue a finance, HR, library, hostel, admissions, compliance or
 * trustee role runs.
 *
 * Scope is decided here, on the server, from the signed-in person:
 *   - a teacher sees only the sections they lead or teach;
 *   - a parent sees only children linked to them, and a child id they are not
 *     linked to is refused, never quietly replaced;
 *   - a student sees only their own record;
 *   - a class average is given only for a class of at least five students on
 *     roll (and, for a test, at least five marks), so an average can never be
 *     read back into one other child's figure. No other child is ever named.
 *
 * Every chart says what it counts (definition), says so when it has no data
 * (emptyText) rather than drawing zeros, and links to the page behind it. A
 * piece that fails is left out and logged, so one bad source never takes the
 * whole dashboard down.
 */

const DAY = 86_400_000;
export const MIN_CLASS_FOR_AVERAGE = 5;
export const MARKS_SAFE_PCT = 40; // the risk module's academic threshold (risk.service.js scores below 40%)
const ATTENDED = ['PRESENT', 'LATE', 'HALF_DAY'];
const DONE = ['SUBMITTED', 'LATE', 'GRADED'];

/** Period choices per dashboard. Money and HR read in months, classes in days. */
const DAY_PERIODS = [{ days: 30, label: '30 days' }, { days: 90, label: 'Term (90 days)' }, { days: 180, label: '6 months' }];
const MONTH_PERIODS = [{ days: 90, label: '3 months' }, { days: 180, label: '6 months' }, { days: 365, label: '12 months' }];

const DAY_FMT = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const MONTH_FMT = new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit', timeZone: 'Asia/Kolkata' });
const WHEN_FMT = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
/** Attendance and cover dates are stored as the local calendar day at UTC midnight, so they are labelled in UTC. */
const dayLabel = (d) => DAY_FMT.format(new Date(d));
const when = (d) => (d ? WHEN_FMT.format(new Date(d)) : '');
const pct1 = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const can = (actor, key, scope = null) => {
  const held = actor.permissions?.[key];
  return Boolean(held) && (!scope || held === scope);
};
const nameOf = (s) => (s ? `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() || 'Student' : 'Student');
const sectionName = (s) => (s ? `${s.gradeId?.name ?? ''} ${s.name ?? ''}`.trim() : '');

async function attempt(name, fn) {
  try {
    return await fn();
  } catch (err) {
    logger.warn(`Dashboard ${name} unavailable: ${err.message}`);
    return null;
  }
}

/**
 * A chart in the pulse board's shape, plus optional extras:
 *   compare   a lighter series on the same axis (class average, expected, last period)
 *   variants  alternative point sets the reader can switch between (each test, each class)
 *   compareNote  why a comparison is not shown
 */
export function chart(key, title, type, points, { unit = 'count', link = null, definition, empty = 'No data yet', compare = null, variants = null, compareNote = null, footnote = null } = {}) {
  const any = (pts) => (pts ?? []).some((p) => p.value !== null && p.value !== 0);
  return {
    key, title, type, unit, link, definition, points,
    compare, variants, compareNote, footnote,
    status: any(points) || (variants ?? []).some((v) => any(v.points)) ? 'OK' : 'EMPTY',
    emptyText: empty,
  };
}

const kpi = (key, label, value, { unit = 'count', detail = null, link = null, tone = 'neutral' } = {}) => ({ key, label, value, unit, detail, link, tone });
const list = (key, title, items, { link = null, empty = 'Nothing here.' } = {}) => ({ key, title, link, items, empty });

// ── periods and buckets ──────────────────────────────────────────────────

function pickPeriod(options, days) {
  const n = Number(days);
  return options.find((o) => o.days === n) ?? options[0];
}

/** Week buckets (7 days each) ending today, oldest first, over local-day dates at UTC midnight. */
export function weekBuckets(days, today = startOfDayUtc()) {
  const n = Math.max(1, Math.ceil(days / 7));
  const end = today.getTime() + DAY; // exclusive
  return Array.from({ length: n }, (_, i) => {
    const start = new Date(end - (n - i) * 7 * DAY);
    return { start, end: new Date(start.getTime() + 7 * DAY), label: dayLabel(start) };
  });
}

/** Month buckets in the school's zone, oldest first. */
function monthBuckets(months, now = new Date()) {
  const { y, m } = localDate(now);
  return Array.from({ length: months }, (_, i) => {
    const k = months - 1 - i;
    const start = new Date(Date.UTC(y, m - 1 - k, 1) - 330 * 60_000);
    const end = new Date(Date.UTC(y, m - k, 1) - 330 * 60_000);
    return { start, end, label: MONTH_FMT.format(new Date(start.getTime() + DAY)) };
  });
}

const inBucket = (buckets, at) => {
  const t = new Date(at).getTime();
  return buckets.findIndex((b) => t >= b.start.getTime() && t < b.end.getTime());
};

/** Whole-day attendance per date for a set of enrollments: [{ _id: date, marked, present }]. */
async function attendanceByDay(enrollmentIds, from) {
  if (!enrollmentIds.length) return [];
  return AttendanceRecord.aggregate([
    { $match: { enrollmentId: { $in: enrollmentIds.map(oid) }, periodNo: null, date: { $gte: from } } },
    { $group: { _id: '$date', marked: { $sum: 1 }, present: { $sum: { $cond: [{ $in: ['$status', ATTENDED] }, 1, 0] } } } },
    { $sort: { _id: 1 } },
  ]);
}

/** Folds daily rows into buckets: a bucket with no register is null, never 0%. */
function foldAttendance(rows, buckets) {
  return buckets.map((b) => {
    const inIt = rows.filter((r) => r._id >= b.start && r._id < b.end);
    const marked = inIt.reduce((s, r) => s + r.marked, 0);
    const present = inIt.reduce((s, r) => s + r.present, 0);
    return { label: b.label, value: pct1(present, marked), marked, present };
  });
}

const ATT_DEFINITION = 'Days attended (present, late or half day) ÷ days the whole-day register was taken. A week with no register is left blank, not counted as 0%.';

// ── shared building blocks for one child (parent and student) ────────────

async function childContext(studentId) {
  const student = await Student.findOne({ _id: studentId, deletedAt: null }).select('firstName lastName').lean();
  if (!student) return null;
  const enrollment = await Enrollment.findOne({ studentId, status: 'ACTIVE' }).sort({ createdAt: -1 })
    .populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } }).lean();
  const sectionId = enrollment?.sectionId?._id ?? null;
  const classmates = sectionId ? await Enrollment.find({ sectionId, status: 'ACTIVE' }).select('_id').lean() : [];
  return {
    student, enrollment, sectionId,
    className: sectionName(enrollment?.sectionId),
    classIds: classmates.map((e) => String(e._id)),
    classSize: classmates.length,
    averageAllowed: classmates.length >= MIN_CLASS_FOR_AVERAGE,
  };
}

const AVERAGE_NOTE = `The class average appears only for classes of at least ${MIN_CLASS_FOR_AVERAGE} students, so it never reveals another child's figures.`;

async function childAttendance(c, period) {
  if (!c.enrollment) return null;
  const buckets = weekBuckets(period.days);
  const from = buckets[0].start;
  const mine = foldAttendance(await attendanceByDay([c.enrollment._id], from), buckets);
  const cls = c.averageAllowed ? foldAttendance(await attendanceByDay(c.classIds, from), buckets) : null;
  const marked = mine.reduce((s, p) => s + p.marked, 0);
  const present = mine.reduce((s, p) => s + p.present, 0);
  const clsMarked = cls ? cls.reduce((s, p) => s + p.marked, 0) : 0;
  const clsPresent = cls ? cls.reduce((s, p) => s + p.present, 0) : 0;
  return {
    pct: pct1(present, marked), marked, present,
    classPct: cls ? pct1(clsPresent, clsMarked) : null,
    chart: chart('attendance', 'Attendance by week', 'line', mine.map((p) => ({ label: `w/c ${p.label}`, value: p.value, detail: p.marked ? `${p.present} of ${plural(p.marked, 'day')}` : 'No register taken' })), {
      unit: 'percent', link: '/attendance', definition: ATT_DEFINITION,
      compare: cls ? { label: 'Class average', points: cls.map((p) => ({ label: `w/c ${p.label}`, value: p.value })) } : null,
      compareNote: cls ? null : AVERAGE_NOTE,
      empty: 'No register has been taken in this period.',
    }),
  };
}

/** The present streak: consecutive registers (most recent first) the child attended. */
async function presentStreak(enrollmentId) {
  const recent = await AttendanceRecord.find({ enrollmentId, periodNo: null }).sort({ date: -1 }).limit(200).select('status').lean();
  let n = 0;
  for (const r of recent) { if (!ATTENDED.includes(r.status)) break; n += 1; }
  return n;
}

async function childMarks(c) {
  if (!c.enrollment) return null;
  const mine = await Mark.find({ enrollmentId: c.enrollment._id, status: 'PUBLISHED', marks: { $ne: null } })
    .populate({ path: 'examSubjectId', select: 'maxMarks examDate examId subjectOfferingId', populate: [{ path: 'examId', select: 'name startsOn' }, { path: 'subjectOfferingId', select: 'subjectId', populate: { path: 'subjectId', select: 'name' } }] })
    .select('marks examSubjectId').lean();
  const rows = mine.filter((m) => m.examSubjectId?.maxMarks).map((m) => ({
    esId: String(m.examSubjectId._id),
    exam: m.examSubjectId.examId?.name ?? 'Test',
    examAt: new Date(m.examSubjectId.examDate ?? m.examSubjectId.examId?.startsOn ?? 0).getTime(),
    subject: m.examSubjectId.subjectOfferingId?.subjectId?.name ?? 'Subject',
    pct: Math.round((m.marks / m.examSubjectId.maxMarks) * 1000) / 10,
    max: m.examSubjectId.maxMarks,
  }));
  // Class averages per test paper, only where the class and the paper are both large enough.
  const classAvg = new Map();
  if (c.averageAllowed && rows.length) {
    const agg = await Mark.aggregate([
      { $match: { examSubjectId: { $in: rows.map((r) => oid(r.esId)) }, enrollmentId: { $in: c.classIds.map(oid) }, status: 'PUBLISHED', marks: { $ne: null } } },
      { $group: { _id: '$examSubjectId', sum: { $sum: '$marks' }, n: { $sum: 1 } } },
    ]);
    for (const a of agg) {
      const r = rows.find((x) => x.esId === String(a._id));
      if (r && a.n >= MIN_CLASS_FOR_AVERAGE) classAvg.set(r.esId, Math.round(((a.sum / a.n) / r.max) * 1000) / 10);
    }
  }
  const avg = (xs) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
  const subjects = [...new Set(rows.map((r) => r.subject))].sort();
  const bySubject = subjects.map((s) => {
    const rs = rows.filter((r) => r.subject === s);
    const cs = rs.map((r) => classAvg.get(r.esId)).filter((v) => v !== undefined);
    return { label: s, value: avg(rs.map((r) => r.pct)), classValue: cs.length === rs.length ? avg(cs) : null, n: rs.length };
  });
  const exams = [...new Map(rows.sort((a, b) => a.examAt - b.examAt).map((r) => [r.exam, r.examAt])).keys()];
  const seriesFor = (filter) => {
    const pts = exams.map((e) => {
      const rs = rows.filter((r) => r.exam === e && filter(r));
      return { label: e, value: avg(rs.map((r) => r.pct)), detail: rs.length ? rs.map((r) => `${r.subject} ${r.pct}%`).join(', ') : 'Not taken' };
    });
    const cmp = exams.map((e) => {
      const rs = rows.filter((r) => r.exam === e && filter(r));
      const cs = rs.map((r) => classAvg.get(r.esId));
      return { label: e, value: rs.length && cs.every((v) => v !== undefined) ? avg(cs) : null };
    });
    return { points: pts, compare: cmp.some((p) => p.value !== null) ? { label: 'Class average', points: cmp } : null };
  };
  const all = seriesFor(() => true);
  const anyClass = bySubject.some((s) => s.classValue !== null);
  return {
    average: avg(rows.map((r) => r.pct)),
    papers: rows.length,
    bySubject: chart('marksBySubject', 'Marks by subject', 'hbar', bySubject.map((s) => ({ label: s.label, value: s.value, detail: `${plural(s.n, 'paper')}${s.classValue !== null ? ` · class average ${s.classValue}%` : ''}`, tone: s.value !== null && s.value < MARKS_SAFE_PCT ? 'bad' : 'neutral' })), {
      unit: 'percent', link: '/performance', definition: 'Average percentage across published test papers this school year, per subject.',
      compare: anyClass ? { label: 'Class average', points: bySubject.map((s) => ({ label: s.label, value: s.classValue })) } : null,
      compareNote: anyClass ? null : AVERAGE_NOTE,
      empty: 'No published marks yet this year.',
    }),
    trend: chart('marksTrend', 'Marks over time', 'line', all.points, {
      unit: 'percent', link: '/performance', definition: 'Average percentage in each test, in the order the tests were held. Pick a subject to see it alone.',
      compare: all.compare, compareNote: all.compare ? null : AVERAGE_NOTE,
      variants: [{ key: 'all', label: 'All subjects', ...all }, ...subjects.map((s) => ({ key: s, label: s, ...seriesFor((r) => r.subject === s) }))],
      empty: 'No published marks yet this year.',
    }),
  };
}

async function childAssignments(c, period, now = new Date()) {
  if (!c.sectionId) return null;
  const offerings = await SubjectOffering.find({ sectionId: c.sectionId }).populate('subjectId', 'name').select('_id subjectId').lean();
  const subjectOf = new Map(offerings.map((o) => [String(o._id), o.subjectId?.name ?? 'Subject']));
  const from = new Date(now.getTime() - period.days * DAY);
  const ahead = new Date(now.getTime() + 14 * DAY);
  const assignments = await Assignment.find({ subjectOfferingId: { $in: offerings.map((o) => o._id) }, deletedAt: null, dueAt: { $gte: from, $lt: ahead } })
    .select('title dueAt subjectOfferingId').sort({ dueAt: 1 }).lean();
  const subs = await Submission.find({ enrollmentId: c.enrollment._id, assignmentId: { $in: assignments.map((a) => a._id) } }).select('assignmentId status submittedAt marks').lean();
  const subOf = new Map(subs.map((s) => [String(s.assignmentId), s]));
  const counts = { onTime: 0, late: 0, missing: 0, upcoming: 0, excused: 0 };
  const due = []; const missing = [];
  for (const a of assignments) {
    const s = subOf.get(String(a._id));
    const subject = subjectOf.get(String(a.subjectOfferingId));
    if (s?.status === 'EXEMPT') counts.excused += 1;
    else if (s && DONE.includes(s.status)) {
      if (s.status === 'LATE' || (s.submittedAt && new Date(s.submittedAt) > new Date(a.dueAt))) counts.late += 1; else counts.onTime += 1;
    } else if (new Date(a.dueAt) < now) { counts.missing += 1; missing.push({ text: a.title, sub: `${subject} · was due ${when(a.dueAt)}`, link: '/assignments', tone: 'bad', badge: 'Missing' }); }
    else { counts.upcoming += 1; due.push({ text: a.title, sub: `${subject} · due ${when(a.dueAt)}`, link: '/assignments', tone: 'warn', badge: 'Due' }); }
  }
  return {
    counts,
    chart: chart('assignments', 'Assignments', 'donut', [
      { label: 'Handed in on time', value: counts.onTime, tone: 'good' },
      { label: 'Handed in late', value: counts.late, tone: 'warn' },
      { label: 'Missing', value: counts.missing, tone: 'bad' },
      { label: 'Due in the next 2 weeks', value: counts.upcoming, tone: 'neutral' },
      ...(counts.excused ? [{ label: 'Excused', value: counts.excused, tone: 'muted' }] : []),
    ], { link: '/assignments', definition: 'Assignments for the class due in this period or the next two weeks, by where the work stands.', empty: 'No assignments were set in this period.' }),
    list: list('assignmentsDue', 'Assignments to do', [...missing, ...due].slice(0, 8), { link: '/assignments', empty: 'Nothing is due or missing.' }),
  };
}

async function childFees(c, now = new Date()) {
  const invoices = await Invoice.find({ enrollmentId: c.enrollment?._id, status: { $ne: 'CANCELLED' }, voidedAt: null }).select('invoiceNo totalPaise paidPaise dueOn status').sort({ dueOn: 1 }).lean();
  let paid = 0; let overdue = 0; let later = 0;
  const items = [];
  for (const i of invoices) {
    paid += i.paidPaise ?? 0;
    const left = Math.max(0, (i.totalPaise ?? 0) - (i.paidPaise ?? 0));
    if (!left) continue;
    const late = new Date(i.dueOn) < now;
    if (late) overdue += left; else later += left;
    items.push({ text: `${i.invoiceNo}: ₹${(left / 100).toLocaleString('en-IN')} to pay`, sub: `${late ? 'was due' : 'due'} ${dayLabel(i.dueOn)}`, link: '/payments', tone: late ? 'bad' : 'warn', badge: late ? 'Overdue' : 'Due' });
  }
  return {
    paid, overdue, later,
    chart: chart('fees', 'Fees this year', 'donut', [
      { label: 'Paid', value: paid, tone: 'good' }, { label: 'Due later', value: later, tone: 'neutral' }, { label: 'Overdue', value: overdue, tone: 'bad' },
    ], { unit: 'paise', link: '/payments', definition: 'Invoices for this child, not cancelled: what is paid, what falls due later and what is past its due date.', empty: 'No invoices have been raised.' }),
    list: list('feesDue', 'Fees to pay', items.slice(0, 6), { link: '/payments', empty: 'Nothing to pay right now.' }),
  };
}

async function childClubs(c, period, now = new Date()) {
  const memberships = await ClubMembership.find({ studentId: c.student._id, status: { $in: ['ACTIVE', 'WAITLISTED', 'AWAITING_CONSENT', 'AWAITING_APPROVAL'] } }).populate('clubId', 'name kind').lean();
  const active = memberships.filter((m) => m.status === 'ACTIVE' && m.clubId);
  const from = new Date(now.getTime() - period.days * DAY);
  const sessions = active.length ? await ClubSession.find({ clubId: { $in: active.map((m) => m.clubId._id) }, status: 'HELD', startsAt: { $gte: from, $lte: now } }).select('clubId attendance').lean() : [];
  const points = active.map((m) => {
    const held = sessions.filter((s) => String(s.clubId) === String(m.clubId._id) && (s.attendance ?? []).some((a) => String(a.studentId) === String(c.student._id)));
    const came = held.filter((s) => s.attendance.find((a) => String(a.studentId) === String(c.student._id))?.status === 'PRESENT').length;
    return { label: m.clubId.name, value: held.length ? pct1(came, held.length) : null, detail: held.length ? `${came} of ${plural(held.length, 'session')}` : 'No sessions recorded yet' };
  });
  return {
    count: active.length,
    chart: chart('clubs', 'Club sessions attended', 'hbar', points, { unit: 'percent', link: '/clubs', definition: 'Sessions marked present ÷ held sessions with a register, for each club this child is a member of.', empty: active.length ? 'No club sessions have been recorded in this period.' : 'Not a member of any club yet.' }),
    list: list('clubs', 'Clubs and teams', memberships.filter((m) => m.clubId).map((m) => ({ text: m.clubId.name, sub: m.status === 'ACTIVE' ? (m.clubId.kind === 'TEAM' ? 'Team member' : 'Member') : m.status.toLowerCase().replace(/_/g, ' '), link: '/clubs', tone: m.status === 'ACTIVE' ? 'good' : 'neutral' })), { link: '/clubs', empty: 'Not in any club yet. Browse the clubs to join one.' }),
  };
}

async function childShowcase(c) {
  const entries = await ShowcaseEntry.find({ studentId: c.student._id, status: 'PUBLISHED' }).sort({ publishedAt: -1 }).limit(6).select('title detail category publishedAt').lean();
  return list('showcase', 'Achievements', entries.map((e) => ({ text: e.title, sub: [e.detail, e.publishedAt ? dayLabel(e.publishedAt) : null].filter(Boolean).join(' · '), link: '/showcase', tone: 'good' })), { link: '/showcase', empty: 'No achievements on the showcase yet.' });
}

async function childBus(actor, studentId) {
  const mine = await myTrips(actor);
  const kid = mine.children.find((k) => k.studentId === String(studentId));
  if (!kid) return null;
  return list('bus', 'Bus today', kid.trips.map((t) => ({
    text: `${t.kindLabel ?? t.title}${t.vehicle ? ` · ${t.vehicle.registrationNo}` : ''}`,
    sub: [t.stop?.name ? `Stop: ${t.stop.name}` : null, t.stop?.plannedAt ? `planned ${when(t.stop.plannedAt)}` : null, String(t.myStatus ?? '').toLowerCase().replace(/_/g, ' ')].filter(Boolean).join(' · '),
    link: '/bus-today', tone: t.status === 'IN_PROGRESS' ? 'good' : 'neutral', badge: String(t.status).toLowerCase().replace(/_/g, ' '),
  })), { link: '/bus-today', empty: 'No bus trip is planned for this child today.' });
}

// ── teacher ──────────────────────────────────────────────────────────────

async function teacherDashboard(actor, period, now = new Date()) {
  const me = actor.profileId;
  const sectionIds = await getTeacherSectionIds(me);
  const [sections, offerings, enrollments] = await Promise.all([
    Section.find({ _id: { $in: sectionIds } }).populate('gradeId', 'name level').select('name gradeId').lean(),
    SubjectOffering.find({ teacherId: me }).populate('subjectId', 'name').select('sectionId subjectId').lean(),
    Enrollment.find({ sectionId: { $in: sectionIds }, status: 'ACTIVE' }).populate('studentId', 'firstName lastName').select('studentId sectionId').lean(),
  ]);
  const label = new Map(sections.map((s) => [String(s._id), sectionName(s)]));
  const offeringLabel = new Map(offerings.map((o) => [String(o._id), `${o.subjectId?.name ?? 'Subject'} · ${label.get(String(o.sectionId)) ?? ''}`.trim()]));
  const enrIds = enrollments.map((e) => String(e._id));
  const bySection = new Map();
  for (const e of enrollments) { const k = String(e.sectionId); if (!bySection.has(k)) bySection.set(k, []); bySection.get(k).push(e); }
  const today = startOfDayUtc(now);
  const charts = []; const lists = []; const kpis = []; const notes = [];

  // Attendance in my classes: daily over 30 days, weekly beyond; a switch per class.
  const att = await attempt('teacher attendance', async () => {
    const daily = period.days <= 30;
    const from = daily ? new Date(today.getTime() - 29 * DAY) : weekBuckets(period.days, today)[0].start;
    const toPoints = (rows) => (daily
      ? rows.map((r) => ({ label: dayLabel(r._id), value: pct1(r.present, r.marked), detail: `${r.present} of ${r.marked} present` }))
      : foldAttendance(rows, weekBuckets(period.days, today)).map((p) => ({ label: `w/c ${p.label}`, value: p.value, detail: p.marked ? `${p.present} of ${p.marked} present` : 'No register taken' })));
    const allRows = await attendanceByDay(enrIds, from);
    const per = await Promise.all([...bySection.entries()].map(async ([sid, es]) => ({ key: sid, label: label.get(sid) ?? 'Class', points: toPoints(await attendanceByDay(es.map((e) => String(e._id)), from)) })));
    const todayRow = allRows.find((r) => r._id.getTime() === today.getTime());
    const marked = allRows.reduce((s, r) => s + r.marked, 0); const present = allRows.reduce((s, r) => s + r.present, 0);
    charts.push(chart('attendance', 'Attendance in my classes', 'line', toPoints(allRows), {
      unit: 'percent', link: '/attendance', definition: ATT_DEFINITION,
      variants: per.length > 1 ? [{ key: 'all', label: 'All my classes', points: toPoints(allRows) }, ...per.sort((a, b) => a.label.localeCompare(b.label))] : null,
      empty: 'No register has been taken in your classes in this period.',
    }));
    return { today: todayRow ? pct1(todayRow.present, todayRow.marked) : null, todayDetail: todayRow ? `${todayRow.present} of ${todayRow.marked} present` : 'Register not taken yet', period: pct1(present, marked) };
  });

  // Submission rate per assignment, most recent ten that have fallen due.
  const subs = await attempt('submissions', async () => {
    const from = new Date(now.getTime() - period.days * DAY);
    const assignments = await Assignment.find({ subjectOfferingId: { $in: offerings.map((o) => o._id) }, deletedAt: null, dueAt: { $gte: from, $lte: now } }).sort({ dueAt: -1 }).limit(10).select('title dueAt subjectOfferingId').lean();
    const agg = assignments.length ? await Submission.aggregate([
      { $match: { assignmentId: { $in: assignments.map((a) => a._id) } } },
      { $group: { _id: { a: '$assignmentId', s: '$status' }, n: { $sum: 1 } } },
    ]) : [];
    const sectionOf = new Map(offerings.map((o) => [String(o._id), String(o.sectionId)]));
    let toGrade = 0;
    const points = assignments.reverse().map((a) => {
      const at = (s) => agg.find((r) => String(r._id.a) === String(a._id) && r._id.s === s)?.n ?? 0;
      const roll = bySection.get(sectionOf.get(String(a.subjectOfferingId)))?.length ?? 0;
      const expected = Math.max(0, roll - at('EXEMPT'));
      const handed = at('SUBMITTED') + at('LATE') + at('GRADED');
      toGrade += at('SUBMITTED') + at('LATE');
      const v = pct1(Math.min(handed, expected), expected);
      return { label: a.title, value: v, detail: `${handed} of ${expected} handed in · ${at('LATE')} late · ${offeringLabel.get(String(a.subjectOfferingId)) ?? ''}`, tone: v === null ? 'neutral' : v < 50 ? 'bad' : v < 80 ? 'warn' : 'good' };
    });
    charts.push(chart('submissions', 'Assignment hand-in rate', 'bar', points, { unit: 'percent', link: '/assignments', definition: 'Handed in (on time, late or graded) ÷ students on roll who were not excused, for each assignment that fell due in this period.', empty: 'No assignment of yours fell due in this period.' }));
    return { toGrade };
  });

  // Marks distribution per test paper (any status: these are the teacher's own papers).
  await attempt('marks distribution', async () => {
    const papers = await ExamSubject.find({ subjectOfferingId: { $in: offerings.map((o) => o._id) } }).populate('examId', 'name startsOn').sort({ examDate: -1, createdAt: -1 }).limit(12).select('examId subjectOfferingId maxMarks examDate').lean();
    const marks = papers.length ? await Mark.find({ examSubjectId: { $in: papers.map((p) => p._id) }, marks: { $ne: null } }).select('examSubjectId marks').lean() : [];
    const BANDS = [['Below 33%', 0, 33, 'bad'], ['33–49%', 33, 50, 'warn'], ['50–64%', 50, 65, 'neutral'], ['65–79%', 65, 80, 'neutral'], ['80–89%', 80, 90, 'good'], ['90% and above', 90, 101, 'good']];
    const variants = papers.map((p) => {
      const ps = marks.filter((m) => String(m.examSubjectId) === String(p._id)).map((m) => (m.marks / (p.maxMarks || 100)) * 100);
      if (!ps.length) return null;
      const avg = Math.round((ps.reduce((s, x) => s + x, 0) / ps.length) * 10) / 10;
      return {
        key: String(p._id), label: `${p.examId?.name ?? 'Test'} · ${offeringLabel.get(String(p.subjectOfferingId)) ?? ''}`,
        points: BANDS.map(([l, lo, hi, tone]) => ({ label: l, value: ps.filter((x) => x >= lo && x < hi).length, tone, detail: `average ${avg}% over ${plural(ps.length, 'student')}` })),
      };
    }).filter(Boolean).slice(0, 6);
    charts.push(chart('marksDistribution', 'Marks distribution', 'bar', variants[0]?.points ?? [], { link: '/exams', definition: 'Number of students in each percentage band, for one test paper you teach. Pick a test to compare.', variants: variants.length ? variants : null, empty: 'No marks have been entered for your tests yet.' }));
  });

  // Students needing attention: the risk module's rules over my classes only (no fee data).
  const attention = await attempt('attention', async () => {
    const since = new Date(today.getTime() - 30 * DAY);
    const [records, published, due] = await Promise.all([
      AttendanceRecord.find({ enrollmentId: { $in: enrIds }, periodNo: null, date: { $gte: since } }).select('enrollmentId status').lean(),
      Mark.find({ enrollmentId: { $in: enrIds }, status: 'PUBLISHED', marks: { $ne: null } }).populate('examSubjectId', 'maxMarks').select('enrollmentId marks examSubjectId').lean(),
      Assignment.find({ subjectOfferingId: { $in: offerings.map((o) => o._id) }, deletedAt: null, dueAt: { $gte: since, $lt: now } }).select('_id subjectOfferingId').lean(),
    ]);
    const done = due.length ? await Submission.find({ assignmentId: { $in: due.map((a) => a._id) }, status: { $in: [...DONE, 'EXEMPT'] } }).select('assignmentId enrollmentId').lean() : [];
    const sectionOf = new Map(offerings.map((o) => [String(o._id), String(o.sectionId)]));
    const out = [];
    const counts = { attendance: 0, marks: 0, work: 0 };
    for (const e of enrollments) {
      const k = String(e._id);
      const reasons = [];
      const rs = records.filter((r) => String(r.enrollmentId) === k);
      const attPct = rs.length >= 5 ? (rs.filter((r) => ATTENDED.includes(r.status)).length / rs.length) * 100 : null;
      if (attPct !== null && attPct < ATTENDANCE_SAFE_PCT) { reasons.push(`attendance ${Math.round(attPct)}% in 30 days`); counts.attendance += 1; }
      const ms = published.filter((m) => String(m.enrollmentId) === k && m.examSubjectId?.maxMarks).map((m) => (m.marks / m.examSubjectId.maxMarks) * 100);
      const avg = ms.length ? ms.reduce((s, x) => s + x, 0) / ms.length : null;
      if (avg !== null && avg < MARKS_SAFE_PCT) { reasons.push(`marks average ${Math.round(avg)}%`); counts.marks += 1; }
      const owed = due.filter((a) => sectionOf.get(String(a.subjectOfferingId)) === String(e.sectionId));
      const missing = owed.filter((a) => !done.some((d) => String(d.assignmentId) === String(a._id) && String(d.enrollmentId) === k)).length;
      if (missing >= 3) { reasons.push(`${missing} assignments not handed in`); counts.work += 1; }
      if (reasons.length) out.push({ text: nameOf(e.studentId), sub: `${label.get(String(e.sectionId)) ?? ''} · ${reasons.join(' · ')}`, link: `/classes?section=${e.sectionId}`, tone: reasons.length > 1 ? 'bad' : 'warn', badge: plural(reasons.length, 'signal'), n: reasons.length });
    }
    out.sort((a, b) => b.n - a.n || a.text.localeCompare(b.text));
    lists.push(list('attention', 'Students needing attention', out.slice(0, 12).map(({ n, ...rest }) => rest), { link: '/classes', empty: 'No student in your classes crosses a warning threshold right now.' }));
    charts.push(chart('attentionReasons', 'Why students need attention', 'hbar', [
      { label: 'Low attendance', value: counts.attendance, tone: 'bad', detail: `below ${ATTENDANCE_SAFE_PCT}% over the last 30 days` },
      { label: 'Low marks', value: counts.marks, tone: 'bad', detail: `published marks averaging below ${MARKS_SAFE_PCT}%` },
      { label: 'Missing work', value: counts.work, tone: 'warn', detail: '3 or more assignments not handed in over 30 days' },
    ], { link: '/classes', definition: `The risk module's rules, applied to your classes: attendance below ${ATTENDANCE_SAFE_PCT}%, marks below ${MARKS_SAFE_PCT}%, or three missed assignments. A student can appear under more than one.`, empty: 'No student in your classes crosses a warning threshold.' }));
    return out.length;
  });

  // Syllabus coverage against where the plan expects each class to be by now.
  const syllabus = await attempt('syllabus', async () => {
    const modules = await CourseModule.find({ subjectOfferingId: { $in: offerings.map((o) => o._id) } }).lean();
    const by = new Map();
    for (const m of modules) { const k = String(m.subjectOfferingId); if (!by.has(k)) by.set(k, []); by.get(k).push(m); }
    let behind = 0; let doneAll = 0; let totalAll = 0;
    const rows = [...by.entries()].map(([k, ms]) => {
      const st = ms.map((m) => ({ m, s: standing(m, now) }));
      const total = st.reduce((s, x) => s + Math.max(1, x.s.topicsTotal), 0);
      const done = st.reduce((s, x) => s + (x.s.topicsTotal ? x.s.topicsDone : (x.m.status === 'COMPLETED' ? 1 : 0)), 0);
      const expected = Math.round(st.reduce((s, x) => s + x.s.expectedPct * Math.max(1, x.s.topicsTotal), 0) / total);
      const cover = Math.round((done / total) * 100);
      doneAll += done; totalAll += total;
      const late = st.filter((x) => ['BEHIND', 'OVERDUE'].includes(x.s.pace)).length;
      if (late) behind += 1;
      return { label: offeringLabel.get(k) ?? 'Subject', value: cover, expected, detail: `${done} of ${plural(total, 'topic')} · plan expects ${expected}%${late ? ` · ${plural(late, 'unit')} behind` : ''}`, tone: late ? 'bad' : 'good' };
    }).sort((a, b) => a.label.localeCompare(b.label));
    charts.push(chart('syllabus', 'Syllabus coverage', 'hbar', rows.map(({ expected, ...p }) => p), {
      unit: 'percent', link: '/syllabus', definition: 'Topics marked taught ÷ topics planned, per subject and class. The lighter mark is where the plan expects you to be today.',
      compare: rows.length ? { label: 'Expected by today', points: rows.map((r) => ({ label: r.label, value: r.expected })) } : null,
      empty: 'No syllabus plan has been entered for your subjects yet.',
    }));
    return { pct: totalAll ? Math.round((doneAll / totalAll) * 100) : null, behind };
  });

  // Today: my periods, my cover duties and my lab sessions.
  await attempt('timetable', async () => {
    const dow = localDate(now).dow === 0 ? 7 : localDate(now).dow;
    const [slots, covers] = await Promise.all([
      TimetableSlot.find({ subjectOfferingId: { $in: offerings.map((o) => o._id) }, dayOfWeek: dow }).sort({ periodNo: 1 }).select('periodNo startTime endTime subjectOfferingId room').lean(),
      (await featureEnabled('staffCover')) ? CoverAssignment.find({ substituteProfileId: me, status: 'CONFIRMED', date: today }).populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } }).lean() : [],
    ]);
    const items = [
      ...slots.map((s) => ({ at: s.startTime, text: `P${s.periodNo} ${s.startTime}–${s.endTime}`, sub: `${offeringLabel.get(String(s.subjectOfferingId)) ?? ''}${s.room ? ` · Room ${s.room}` : ''}`, link: '/timetable', tone: 'neutral', start: s.startTime, end: s.endTime })),
      ...covers.map((c) => ({ at: c.startTime ?? '', text: `P${c.periodNo}${c.startTime ? ` ${c.startTime}–${c.endTime ?? ''}` : ''}`, sub: `Cover · ${sectionName(c.sectionId)}${c.room ? ` · Room ${c.room}` : ''}`, link: '/timetable', tone: 'warn', badge: 'Cover', start: c.startTime, end: c.endTime })),
    ].sort((a, b) => String(a.at).localeCompare(String(b.at))).map(({ at, ...r }) => r);
    lists.push(list('today', 'My timetable today', items, { link: '/timetable', empty: 'No periods on your timetable today.' }));
  });

  const duties = await attempt('cover duties', async () => {
    if (!(await featureEnabled('staffCover'))) return null;
    const rows = await CoverAssignment.find({ substituteProfileId: me, status: 'CONFIRMED', date: { $gte: today, $lt: new Date(today.getTime() + 14 * DAY) } })
      .populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } }).sort({ date: 1, periodNo: 1 }).limit(10).lean();
    lists.push(list('cover', 'Substitute duties', rows.map((c) => ({ text: `${dayLabel(c.date)} · P${c.periodNo}${c.startTime ? ` ${c.startTime}` : ''}`, sub: `${sectionName(c.sectionId)}${c.room ? ` · Room ${c.room}` : ''}`, link: '/timetable', tone: 'warn', badge: 'Cover' })), { link: '/timetable', empty: 'No substitute duties in the next two weeks.' }));
    return rows.length;
  });

  const calls = await attempt('ptm and review calls', async () => {
    if (!(await featureEnabled('ptm'))) return null;
    const [cases, meetings] = await Promise.all([
      ReviewCase.find({ assignedProfileId: me, status: { $ne: 'CLOSED' } }).populate('studentId', 'firstName lastName').sort({ scheduledAt: 1, createdAt: 1 }).limit(8).select('studentId reason priority scheduledAt status').lean(),
      PtmBooking.find({ teacherProfileId: me, startsAt: { $gte: now }, status: { $in: ['BOOKED', 'CHECKED_IN'] } }).populate('studentId', 'firstName lastName').sort({ startsAt: 1 }).limit(8).select('studentId startsAt mode').lean(),
    ]);
    lists.push(list('calls', 'PTM meetings and review calls', [
      ...meetings.map((b) => ({ text: `PTM: ${nameOf(b.studentId)}'s family`, sub: when(b.startsAt), link: '/ptm', tone: 'neutral', badge: 'Meeting' })),
      ...cases.map((r) => ({ text: `Call: ${nameOf(r.studentId)}'s family`, sub: `${String(r.reason).toLowerCase().replace(/_/g, ' ')}${r.scheduledAt ? ` · ${when(r.scheduledAt)}` : ' · not yet scheduled'}`, link: '/review-calls', tone: r.scheduledAt && new Date(r.scheduledAt) < now ? 'bad' : r.priority === 'URGENT' || r.priority === 'HIGH' ? 'warn' : 'neutral', badge: r.scheduledAt && new Date(r.scheduledAt) < now ? 'Overdue' : 'Call' })),
    ], { link: '/ptm', empty: 'No PTM meetings or review calls are waiting on you.' }));
    return meetings.length + cases.length;
  });

  await attempt('lab sessions', async () => {
    if (!(await featureEnabled('labs'))) return;
    const rows = await PracticalSession.find({ teacherProfileId: me, startsAt: { $gte: today, $lt: new Date(today.getTime() + 14 * DAY) }, status: { $nin: ['CANCELLED', 'COMPLETED'] } }).sort({ startsAt: 1 }).limit(8).select('title className startsAt status readiness').lean();
    lists.push(list('labs', 'Lab sessions (next 2 weeks)', rows.map((s) => ({ text: s.title, sub: `${when(s.startsAt)}${s.className ? ` · ${s.className}` : ''}`, link: `/labs?session=${s._id}`, tone: s.status === 'READY' || s.readiness?.ok ? 'good' : s.readiness?.ok === false ? 'bad' : 'neutral', badge: String(s.status).toLowerCase().replace(/_/g, ' ') })), { link: '/labs', empty: 'No lab sessions booked in the next two weeks.' }));
  });

  kpis.push(
    kpi('students', 'Students in my classes', enrollments.length, { detail: plural(sections.length, 'class', 'classes'), link: '/classes' }),
    kpi('today', 'Present today', att?.today ?? null, { unit: 'percent', detail: att?.todayDetail ?? null, link: '/attendance', tone: att?.today != null && att.today < ATTENDANCE_SAFE_PCT ? 'bad' : 'neutral' }),
    kpi('toGrade', 'Work to grade', subs?.toGrade ?? null, { detail: 'handed in, not yet graded', link: '/assignments', tone: subs?.toGrade ? 'warn' : 'good' }),
    kpi('attention', 'Need attention', attention ?? null, { detail: 'by the risk rules', link: '/classes', tone: attention ? 'warn' : 'good' }),
    kpi('syllabus', 'Syllabus covered', syllabus?.pct ?? null, { unit: 'percent', detail: syllabus?.behind ? `${plural(syllabus.behind, 'subject')} behind plan` : 'on plan', link: '/syllabus', tone: syllabus?.behind ? 'warn' : 'neutral' }),
  );
  if (duties != null) kpis.push(kpi('cover', 'Cover duties', duties, { detail: 'next 2 weeks', link: '/timetable', tone: duties ? 'warn' : 'neutral' }));
  if (calls != null) kpis.push(kpi('calls', 'Meetings and calls', calls, { detail: 'waiting on you', link: '/ptm' }));
  if (!sections.length) notes.push('You are not yet linked to a class or subject, so there is nothing to chart. The academic office links teachers to classes.');
  return { view: 'teacher', title: 'My classes', kpis, charts, lists, notes };
}

// ── parent and student ───────────────────────────────────────────────────

async function childDashboard(actor, studentId, period, { viewer }) {
  const c = await childContext(studentId);
  if (!c) throw new AppError('Student not found', 404);
  const kpis = []; const charts = []; const lists = []; const notes = [];
  const parent = viewer === 'parent';

  const att = await attempt('child attendance', () => childAttendance(c, period));
  const streak = await attempt('streak', () => (c.enrollment ? presentStreak(c.enrollment._id) : 0));
  const marks = await attempt('child marks', () => childMarks(c));
  const work = await attempt('child assignments', () => childAssignments(c, period));
  if (att) charts.push(att.chart);
  if (marks) charts.push(marks.trend, marks.bySubject);
  if (work) { charts.push(work.chart); lists.push(work.list); }

  kpis.push(kpi('attendance', 'Attendance', att?.pct ?? null, { unit: 'percent', detail: att ? (att.classPct !== null ? `class average ${att.classPct}%` : `${att.present} of ${plural(att.marked, 'day')}`) : null, link: '/attendance', tone: att?.pct != null && att.pct < ATTENDANCE_SAFE_PCT ? 'bad' : 'good' }));
  kpis.push(kpi('marks', 'Marks average', marks?.average ?? null, { unit: 'percent', detail: marks ? `${plural(marks.papers, 'published paper')}` : null, link: '/performance', tone: marks?.average != null && marks.average < MARKS_SAFE_PCT ? 'bad' : 'neutral' }));
  kpis.push(kpi('due', 'Assignments due', work?.counts.upcoming ?? null, { detail: work?.counts.missing ? `${work.counts.missing} missing` : 'none missing', link: '/assignments', tone: work?.counts.missing ? 'bad' : 'neutral' }));
  if (!parent && streak != null) kpis.push(kpi('streak', 'Present streak', streak, { unit: 'days', detail: 'registers in a row', link: '/attendance', tone: streak >= 10 ? 'good' : 'neutral' }));

  if (parent && can(actor, 'fees.read') && c.enrollment) {
    const fees = await attempt('child fees', () => childFees(c));
    if (fees) {
      charts.push(fees.chart); lists.push(fees.list);
      kpis.push(kpi('fees', 'Fees to pay', fees.overdue + fees.later, { unit: 'paise', detail: fees.overdue ? 'some is overdue' : 'nothing overdue', link: '/payments', tone: fees.overdue ? 'bad' : 'good' }));
    }
  }
  if (await featureEnabled('fleet')) {
    const bus = await attempt('bus', () => childBus(actor, c.student._id));
    if (bus) lists.push(bus);
  }
  if (await featureEnabled('clubs') && can(actor, 'clubs.read')) {
    const clubs = await attempt('clubs', () => childClubs(c, period));
    if (clubs) { charts.push(clubs.chart); lists.push(clubs.list); kpis.push(kpi('clubs', 'Clubs', clubs.count, { detail: 'active memberships', link: '/clubs' })); }
  }
  if (await featureEnabled('showcase')) {
    const sc = await attempt('showcase', () => childShowcase(c));
    if (sc) lists.push(sc);
  }
  if (parent && await featureEnabled('ptm')) {
    const ptm = await attempt('ptm', async () => {
      const rows = await PtmBooking.find({ parentProfileId: actor.profileId, studentId: c.student._id, startsAt: { $gte: new Date() }, status: { $in: ['BOOKED', 'CHECKED_IN'] } }).populate('teacherProfileId', 'displayName').sort({ startsAt: 1 }).limit(5).select('startsAt teacherProfileId mode').lean();
      return list('ptm', 'Upcoming PTM', rows.map((b) => ({ text: `With ${b.teacherProfileId?.displayName ?? 'the teacher'}`, sub: when(b.startsAt), link: '/ptm', tone: 'neutral', badge: 'Booked' })), { link: '/ptm', empty: 'No PTM meeting booked. When a PTM round opens you can book a slot here.' });
    });
    if (ptm) lists.push(ptm);
  }
  if (!parent && await featureEnabled('sustainability')) {
    const eco = await attempt('eco points', async () => {
      if (!c.sectionId) return null;
      const teams = await EcoTeam.find({ sectionId: c.sectionId, active: true }).select('_id name').lean();
      const buckets = monthBuckets(6);
      const acts = teams.length ? await EcoActivity.find({ teamId: { $in: teams.map((t) => t._id) }, status: 'VERIFIED', date: { $gte: buckets[0].start } }).select('points date').lean() : [];
      const total = teams.length ? (await EcoActivity.aggregate([{ $match: { teamId: { $in: teams.map((t) => t._id) }, status: 'VERIFIED' } }, { $group: { _id: null, p: { $sum: '$points' } } }]))[0]?.p ?? 0 : 0;
      kpis.push(kpi('eco', 'Class eco points', teams.length ? total : null, { detail: teams.length ? teams.map((t) => t.name).join(', ') : 'no class eco team', link: '/eco-points', tone: 'good' }));
      return chart('eco', 'Eco points earned by my class', 'bar', buckets.map((b) => {
        const inIt = acts.filter((a) => inBucket([b], a.date) === 0);
        return { label: b.label, value: inIt.reduce((s, a) => s + a.points, 0), detail: plural(inIt.length, 'verified activity', 'verified activities'), tone: 'good' };
      }), { link: '/eco-points', definition: 'Points from your class eco team\'s activities that a teacher has verified, by month.', empty: teams.length ? 'No verified eco activities in the last six months.' : 'Your class has no eco team yet.' });
    });
    if (eco) charts.push(eco);
  }
  if (!parent && await featureEnabled('digest')) {
    const digest = await attempt('digest', async () => {
      const ed = await DigestEdition.findOne({ profileId: actor.profileId }).sort({ day: -1 }).lean();
      const safe = (u) => (/^https?:\/\//i.test(String(u ?? '')) ? u : null);
      return list('digest', 'Digest highlights', (ed?.items ?? []).slice(0, 5).map((i) => ({ text: i.title, sub: [i.sourceTitle, i.interest].filter(Boolean).join(' · '), href: safe(i.link), link: '/digest', tone: 'neutral' })), { link: '/digest', empty: 'No digest yet. Choose your interests on the Digest page.' });
    });
    if (digest) lists.push(digest);
  }
  if (!c.enrollment) notes.push(`${nameOf(c.student)} has no active class enrolment, so attendance, marks and assignments cannot be shown yet.`);
  return {
    view: viewer, title: parent ? `${nameOf(c.student)}'s progress` : 'My progress',
    child: { id: String(c.student._id), name: nameOf(c.student), className: c.className, classSize: c.averageAllowed ? c.classSize : null },
    kpis, charts, lists, notes: [...notes, ...(c.averageAllowed ? [] : [AVERAGE_NOTE])],
  };
}

async function parentDashboard(actor, period, childId) {
  const ids = await getGuardianStudentIds(actor.profileId);
  if (!ids.length) return { view: 'parent', title: 'My children', children: [], kpis: [], charts: [], lists: [], notes: ['No child is linked to your account yet. The school office links parents to their children.'] };
  if (childId && !ids.includes(String(childId))) throw new AppError('That child is not linked to your account.', 403, [], 'CHILD_NOT_LINKED');
  const students = await Student.find({ _id: { $in: ids }, deletedAt: null }).select('firstName lastName').sort({ firstName: 1 }).lean();
  const chosen = String(childId ?? students[0]?._id ?? ids[0]);
  const enrolments = await Enrollment.find({ studentId: { $in: ids }, status: 'ACTIVE' }).populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } }).select('studentId sectionId').lean();
  const children = students.map((s) => ({ id: String(s._id), name: nameOf(s), className: sectionName(enrolments.find((e) => String(e.studentId) === String(s._id))?.sectionId) }));
  const d = await childDashboard(actor, chosen, period, { viewer: 'parent' });
  return { ...d, children };
}

async function studentDashboard(actor, period) {
  const id = await getOwnStudentId(actor.profileId);
  if (!id) return { view: 'student', title: 'My progress', kpis: [], charts: [], lists: [], notes: ['Your login is not yet linked to a student record. Ask the school office.'] };
  return childDashboard(actor, id, period, { viewer: 'student' });
}

// ── staff roles with a queue of their own ────────────────────────────────

async function financeDashboard(actor, period, now = new Date()) {
  if (!can(actor, 'fees.read', 'ALL')) return null;
  const months = Math.round(period.days / 30);
  const buckets = monthBuckets(months, now);
  const [payments, billed, open] = await Promise.all([
    Payment.find({ createdAt: { $gte: buckets[0].start }, status: 'SUCCESS', recordStatus: 'PUBLISHED' }).select('amountPaise createdAt mode').lean(),
    Invoice.find({ dueOn: { $gte: buckets[0].start, $lt: buckets.at(-1).end }, status: { $ne: 'CANCELLED' }, voidedAt: null }).select('totalPaise paidPaise dueOn').lean(),
    Invoice.find({ status: { $ne: 'CANCELLED' }, voidedAt: null, $expr: { $lt: ['$paidPaise', '$totalPaise'] } }).select('totalPaise paidPaise dueOn').lean(),
  ]);
  const sumIn = (rows, field, at, i) => rows.filter((r) => inBucket(buckets, r[at]) === i).reduce((s, r) => s + (r[field] ?? 0), 0);
  const collected = buckets.map((b, i) => ({ label: b.label, value: sumIn(payments, 'amountPaise', 'createdAt', i), detail: plural(payments.filter((p) => inBucket(buckets, p.createdAt) === i).length, 'payment') }));
  const target = buckets.map((b, i) => ({ label: b.label, value: sumIn(billed, 'totalPaise', 'dueOn', i) }));
  const left = (i) => Math.max(0, (i.totalPaise ?? 0) - (i.paidPaise ?? 0));
  const age = (i) => Math.floor((now - new Date(i.dueOn)) / DAY);
  const AGE = [['Not yet due', -Infinity, 0, 'neutral'], ['1–30 days', 0, 31, 'warn'], ['31–60 days', 31, 61, 'warn'], ['61–90 days', 61, 91, 'bad'], ['Over 90 days', 91, Infinity, 'bad']];
  const ageing = AGE.map(([label, lo, hi, tone]) => {
    const rs = open.filter((i) => {
      const late = new Date(i.dueOn) < now;
      if (lo === -Infinity) return !late;
      const d = Math.max(1, age(i));
      return late && d >= Math.max(lo, 1) && d < hi;
    });
    return { label, value: rs.reduce((s, i) => s + left(i), 0), detail: plural(rs.length, 'invoice'), tone };
  });
  const MODES = ['UPI', 'GATEWAY', 'CASH', 'BANK', 'CHEQUE', 'DD'];
  const modes = MODES.map((m) => ({ label: m === 'GATEWAY' ? 'Online gateway' : m === 'DD' ? 'Demand draft' : m.charAt(0) + m.slice(1).toLowerCase(), value: payments.filter((p) => p.mode === m).reduce((s, p) => s + p.amountPaise, 0) })).filter((p) => p.value > 0);
  const totalCollected = collected.reduce((s, p) => s + p.value, 0);
  const totalBilled = billed.reduce((s, i) => s + i.totalPaise, 0);
  const paidOfBilled = billed.reduce((s, i) => s + Math.min(i.paidPaise ?? 0, i.totalPaise), 0);
  const overdue = open.filter((i) => new Date(i.dueOn) < now);
  return {
    view: 'finance', title: 'Collections',
    kpis: [
      kpi('collected', 'Collected', totalCollected, { unit: 'paise', detail: `last ${plural(months, 'month')}`, link: '/payments' }),
      kpi('rate', 'Collection rate', pct1(paidOfBilled, totalBilled), { unit: 'percent', detail: 'of what fell due in the period', link: '/fees', tone: pct1(paidOfBilled, totalBilled) !== null && pct1(paidOfBilled, totalBilled) < 80 ? 'warn' : 'good' }),
      kpi('overdue', 'Overdue', overdue.reduce((s, i) => s + left(i), 0), { unit: 'paise', detail: plural(overdue.length, 'invoice'), link: '/fees', tone: overdue.length ? 'bad' : 'good' }),
      kpi('outstanding', 'Outstanding', open.reduce((s, i) => s + left(i), 0), { unit: 'paise', detail: 'overdue and not yet due', link: '/fees' }),
    ],
    charts: [
      chart('collections', 'Collections against billing', 'bar', collected, { unit: 'paise', link: '/payments', definition: 'Bars: successful, published payments by the month they were recorded. Lighter line: the invoice amounts that fell due that month, the target to collect.', compare: { label: 'Billed (fell due)', points: target }, empty: 'No payments or invoices in this period.' }),
      chart('ageing', 'Outstanding by age', 'ageing', ageing, { unit: 'paise', link: '/fees', definition: 'Unpaid invoice balances, by days past their due date.', empty: 'Nothing is outstanding.' }),
      chart('modes', 'How families paid', 'donut', modes, { unit: 'paise', link: '/payments', definition: 'Collected amounts in the period, by payment mode.', empty: 'No payments in this period.' }),
    ],
    lists: [],
    notes: [],
  };
}

async function hrDashboard(actor, period, now = new Date()) {
  if (!can(actor, 'staffleave.manage', 'ALL') && !can(actor, 'users.read', 'ALL')) return null;
  const roles = await Role.find({ key: { $nin: ['PARENT', 'STUDENT', 'ALUMNUS', 'SUPER_ADMIN'] } }).select('_id key name').lean();
  const head = await Profile.aggregate([
    { $match: { tenantId: actor.tenantId, status: 'ACTIVE', deletedAt: null, roleId: { $in: roles.map((r) => r._id) } } },
    { $group: { _id: '$roleId', n: { $sum: 1 } } },
  ]);
  const headcount = roles.map((r) => ({ label: r.name, value: head.find((h) => String(h._id) === String(r._id))?.n ?? 0 })).filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  const today = startOfDayUtc(now);
  const buckets = weekBuckets(period.days, today);
  const leaves = await StaffLeave.find({ status: { $in: ['APPROVED', 'PENDING'] }, toDate: { $gte: buckets[0].start } }).select('code days fromDate toDate status').lean();
  const approved = leaves.filter((l) => l.status === 'APPROVED');
  const overlapDays = (l, b) => Math.max(0, Math.round((Math.min(new Date(l.toDate).getTime() + DAY, b.end.getTime()) - Math.max(new Date(l.fromDate).getTime(), b.start.getTime())) / DAY));
  const trend = buckets.map((b) => ({ label: `w/c ${b.label}`, value: approved.reduce((s, l) => s + Math.min(overlapDays(l, b), l.days ?? overlapDays(l, b)), 0), detail: plural(approved.filter((l) => overlapDays(l, b) > 0).length, 'leave') }));
  const codes = [...new Set(approved.map((l) => l.code))];
  const byType = codes.map((c) => ({ label: c, value: approved.filter((l) => l.code === c && new Date(l.fromDate) >= buckets[0].start).reduce((s, l) => s + (l.days ?? 0), 0) })).filter((p) => p.value > 0);
  const onLeaveToday = approved.filter((l) => new Date(l.fromDate) <= today && new Date(l.toDate) >= today).length;
  const pending = leaves.filter((l) => l.status === 'PENDING').length;
  const covers = await featureEnabled('staffCover') ? await CoverAssignment.countDocuments({ date: today, status: 'CONFIRMED' }) : null;
  return {
    view: 'hr', title: 'People',
    kpis: [
      kpi('staff', 'Staff on roll', headcount.reduce((s, p) => s + p.value, 0), { detail: plural(headcount.length, 'role'), link: '/organization' }),
      kpi('onLeave', 'On leave today', onLeaveToday, { link: '/staff-leave', tone: onLeaveToday ? 'warn' : 'neutral' }),
      kpi('pending', 'Leave requests waiting', pending, { link: '/staff-leave', tone: pending ? 'warn' : 'good' }),
      ...(covers !== null ? [kpi('covers', 'Cover periods today', covers, { link: '/cover' })] : []),
    ],
    charts: [
      chart('headcount', 'Headcount by role', 'donut', headcount, { link: '/organization', definition: 'Active staff profiles in this school, by role.', empty: 'No staff profiles yet.' }),
      chart('leaveTrend', 'Staff days on leave', 'bar', trend, { link: '/staff-leave', definition: 'Approved leave days falling in each week.', empty: 'No approved leave in this period.' }),
      chart('leaveTypes', 'Leave taken by type', 'hbar', byType, { link: '/staff-leave', definition: 'Approved leave days starting in this period, by leave type.', empty: 'No approved leave in this period.' }),
    ],
    lists: [], notes: [],
  };
}

async function librarianDashboard(actor, period, now = new Date()) {
  if (!can(actor, 'library.read', 'ALL')) return null;
  const buckets = weekBuckets(period.days);
  const [issued, returned, open, titles] = await Promise.all([
    BookIssue.find({ issuedAt: { $gte: buckets[0].start } }).select('issuedAt').lean(),
    BookIssue.find({ returnedAt: { $gte: buckets[0].start } }).select('returnedAt').lean(),
    BookIssue.find({ status: { $ne: 'RETURNED' }, returnedAt: null }).select('dueDate').lean(),
    Book.countDocuments({ deletedAt: null }),
  ]);
  const count = (rows, f, i) => rows.filter((r) => inBucket(buckets, r[f]) === i).length;
  const late = open.filter((r) => new Date(r.dueDate) < now);
  const daysLate = (r) => Math.floor((now - new Date(r.dueDate)) / DAY);
  const AGE = [['1–7 days', 0, 8, 'warn'], ['8–30 days', 8, 31, 'bad'], ['Over 30 days', 31, Infinity, 'bad']];
  return {
    view: 'librarian', title: 'Lending',
    kpis: [
      kpi('onLoan', 'On loan now', open.length, { link: '/books' }),
      kpi('overdue', 'Overdue', late.length, { link: '/books', tone: late.length ? 'bad' : 'good' }),
      kpi('issued', 'Issued in period', issued.length, { link: '/books' }),
      kpi('titles', 'Titles in catalogue', titles, { link: '/books' }),
    ],
    charts: [
      chart('issues', 'Books issued each week', 'line', buckets.map((b, i) => ({ label: `w/c ${b.label}`, value: count(issued, 'issuedAt', i) })), { link: '/books', definition: 'Loans issued per week. The lighter line is books returned in the same week.', compare: { label: 'Returned', points: buckets.map((b, i) => ({ label: `w/c ${b.label}`, value: count(returned, 'returnedAt', i) })) }, empty: 'No books issued in this period.' }),
      chart('overdue', 'Overdue loans by days late', 'ageing', AGE.map(([label, lo, hi, tone]) => ({ label, value: late.filter((r) => daysLate(r) >= lo && daysLate(r) < hi).length, tone })), { link: '/books', definition: 'Books not yet returned, by days past their due date.', empty: 'No loan is overdue.' }),
    ],
    lists: [], notes: [],
  };
}

async function wardenDashboard(actor, period, now = new Date()) {
  if (!can(actor, 'hostel.read', 'ALL')) return null;
  const [rooms, allocs] = await Promise.all([
    HostelRoom.find({ status: { $ne: 'CLOSED' } }).select('block capacity status').lean(),
    HostelAllocation.find({ status: 'ACTIVE' }).select('roomId').populate('roomId', 'block').lean(),
  ]);
  const beds = rooms.filter((r) => r.status === 'ACTIVE').reduce((s, r) => s + r.capacity, 0);
  const maint = rooms.filter((r) => r.status === 'MAINTENANCE').reduce((s, r) => s + r.capacity, 0);
  const used = allocs.length;
  const blocks = [...new Set(rooms.map((r) => r.block || 'Main'))].sort();
  const byBlock = blocks.map((b) => {
    const cap = rooms.filter((r) => (r.block || 'Main') === b && r.status === 'ACTIVE').reduce((s, r) => s + r.capacity, 0);
    const n = allocs.filter((a) => (a.roomId?.block || 'Main') === b).length;
    return { label: b, value: pct1(n, cap), detail: `${n} of ${plural(cap, 'bed')}`, tone: cap && n / cap > 0.95 ? 'warn' : 'neutral' };
  });
  const charts = [
    chart('occupancy', 'Bed occupancy', 'donut', [{ label: 'Occupied', value: used, tone: 'neutral' }, { label: 'Free', value: Math.max(0, beds - used), tone: 'good' }, ...(maint ? [{ label: 'Under maintenance', value: maint, tone: 'muted' }] : [])], { link: '/rooms', definition: 'Beds in active rooms that have a current allocation, against beds free. Rooms under maintenance are shown apart.', empty: 'No hostel rooms set up yet.' }),
    chart('blocks', 'Occupancy by block', 'hbar', byBlock, { unit: 'percent', link: '/rooms', definition: 'Allocated beds ÷ beds in active rooms, per block.', empty: 'No hostel rooms set up yet.' }),
  ];
  const kpis = [
    kpi('occupancy', 'Occupancy', pct1(used, beds), { unit: 'percent', detail: `${used} of ${plural(beds, 'bed')}`, link: '/rooms' }),
  ];
  if (await featureEnabled('hostelOutpass')) {
    const from = new Date(now.getTime() - period.days * DAY);
    const passes = await OutPass.find({ createdAt: { $gte: from } }).select('status late').lean();
    const out = await OutPass.countDocuments({ status: 'OUT' });
    const ST = [['Waiting for parent', 'PENDING_PARENT', 'warn'], ['Waiting for warden', 'PENDING_WARDEN', 'warn'], ['Approved', 'APPROVED', 'good'], ['Out now', 'OUT', 'neutral'], ['Returned', 'RETURNED', 'good'], ['Refused', 'REJECTED', 'bad'], ['Cancelled', 'CANCELLED', 'muted']];
    charts.push(chart('outpass', 'Out-passes in this period', 'bar', ST.map(([label, s, tone]) => ({ label, value: passes.filter((p) => p.status === s).length, tone })), { link: '/outpass', definition: 'Out-pass requests raised in the period, by where they stand now.', empty: 'No out-pass requests in this period.' }));
    kpis.push(kpi('out', 'Out now', out, { link: '/outpass' }), kpi('pendingPass', 'Waiting for you', passes.filter((p) => p.status === 'PENDING_WARDEN').length, { link: '/outpass', tone: 'warn' }), kpi('late', 'Late returns', passes.filter((p) => p.late).length, { detail: 'in the period', link: '/outpass', tone: passes.some((p) => p.late) ? 'bad' : 'good' }));
  }
  return { view: 'warden', title: 'Hostel', kpis, charts, lists: [], notes: [] };
}

async function marketingDashboard(actor, period) {
  if (!can(actor, 'marketing.read')) return null;
  const order = ['NEW', 'CONTACTED', 'TOUR_SCHEDULED', 'APPLICATION', 'ENROLLED'];
  const human = (s) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
  const buckets = weekBuckets(period.days);
  const prevStart = new Date(buckets[0].start.getTime() - buckets.length * 7 * DAY);
  const [stages, recent] = await Promise.all([
    Lead.aggregate([{ $group: { _id: '$stage', n: { $sum: 1 } } }]),
    Lead.find({ createdAt: { $gte: prevStart } }).select('createdAt source stage').lean(),
  ]);
  const at = Object.fromEntries(stages.map((r) => [r._id, r.n]));
  const inPeriod = recent.filter((l) => new Date(l.createdAt) >= buckets[0].start);
  const shift = buckets.length * 7 * DAY;
  const sources = [...new Set(inPeriod.map((l) => l.source || 'OTHER'))].map((s) => ({ label: human(s), value: inPeriod.filter((l) => (l.source || 'OTHER') === s).length })).sort((a, b) => b.value - a.value);
  const enrolled = inPeriod.filter((l) => l.stage === 'ENROLLED').length;
  return {
    view: 'marketing', title: 'Admissions',
    kpis: [
      kpi('enquiries', 'Enquiries', inPeriod.length, { detail: `last ${period.days} days`, link: '/marketing' }),
      kpi('new', 'Not yet contacted', at.NEW ?? 0, { link: '/marketing', tone: (at.NEW ?? 0) > 5 ? 'warn' : 'neutral' }),
      kpi('conversion', 'Enrolled from these', pct1(enrolled, inPeriod.length), { unit: 'percent', detail: `${enrolled} of ${inPeriod.length}`, link: '/admissions' }),
    ],
    charts: [
      chart('enquiries', 'Enquiries each week', 'line', buckets.map((b) => ({ label: `w/c ${b.label}`, value: inPeriod.filter((l) => inBucket([b], l.createdAt) === 0).length })), { link: '/marketing', definition: 'New enquiries recorded each week. The lighter line is the same weeks of the period before.', compare: { label: 'Period before', points: buckets.map((b) => ({ label: `w/c ${b.label}`, value: recent.filter((l) => inBucket([{ start: new Date(b.start.getTime() - shift), end: new Date(b.end.getTime() - shift) }], l.createdAt) === 0).length })) }, empty: 'No enquiries in this period.' }),
      chart('funnel', 'Admissions funnel', 'funnel', order.map((s, i) => ({ label: human(s), value: order.slice(i).reduce((n, k) => n + (at[k] ?? 0), 0) })), { link: '/marketing', definition: 'All enquiries that reached each stage or went beyond it. Lost enquiries are not counted.', empty: 'No enquiries recorded yet.' }),
      chart('sources', 'Where enquiries came from', 'donut', sources, { link: '/marketing', definition: 'Enquiries in the period, by source.', empty: 'No enquiries in this period.' }),
    ],
    lists: [], notes: [],
  };
}

async function complianceDashboard(actor) {
  if (!can(actor, 'compliance.read')) return null;
  const items = await compliance.calendar({ days: 90 });
  const kinds = [...new Set(items.map((i) => i.kind))];
  const human = (s) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
  const overdue = items.filter((i) => i.overdue);
  const soon = items.filter((i) => !i.overdue && new Date(i.renewBy ?? i.date) < new Date(Date.now() + 30 * DAY));
  return {
    view: 'compliance', title: 'Compliance',
    kpis: [
      kpi('overdue', 'Overdue', overdue.length, { link: '/compliance', tone: overdue.length ? 'bad' : 'good' }),
      kpi('soon', 'Due in 30 days', soon.length, { link: '/compliance', tone: soon.length ? 'warn' : 'neutral' }),
      kpi('ahead', 'Due in 90 days', items.length - overdue.length, { link: '/compliance' }),
    ],
    charts: [
      chart('kinds', 'What falls due (90 days)', 'hbar', kinds.map((k) => ({ label: human(k), value: items.filter((i) => i.kind === k).length, detail: `${items.filter((i) => i.kind === k && i.overdue).length} overdue`, tone: items.some((i) => i.kind === k && i.overdue) ? 'bad' : 'neutral' })).sort((a, b) => b.value - a.value), { link: '/compliance', definition: 'Returns, licences, policy reviews, trainings, agreement notice dates and letters due in the next 90 days or already overdue, by kind.', empty: 'Nothing falls due in the next 90 days.' }),
    ],
    lists: [list('overdue', 'Overdue items', overdue.slice(0, 8).map((i) => ({ text: i.title, sub: `${human(i.kind)} · was due ${dayLabel(i.renewBy ?? i.date)}`, link: i.link, tone: 'bad', badge: 'Overdue' })), { link: '/compliance', empty: 'Nothing is overdue.' })],
    notes: [],
  };
}

async function trusteeDashboard(actor) {
  if (!can(actor, 'analytics.workspace.read', 'ALL')) return null;
  const o = await analyticsOverview(actor, 'ALL', { preset: 'month', compare: 'previous', department: 'all' });
  const metrics = o.metrics.filter((m) => m.current?.value !== null).slice(0, 8);
  return {
    view: 'trustee', title: 'Institution health this month',
    kpis: metrics.map((m) => ({
      ...kpi(m.key, m.label, m.current.value, { unit: m.unit === 'days' ? 'days' : m.unit, detail: m.change?.comparable ? `${m.change.pct > 0 ? '+' : ''}${m.change.pct}% on last month` : 'no comparison', link: '/analytics', tone: 'neutral' }),
      spark: m.trend && typeof m.trend === 'object' ? m.trend.points.map((p) => p.value) : null,
    })),
    charts: [], lists: [],
    notes: ['Headline figures from the analytics workspace, this month against last month. Open Analytics for every measure, its definition and the records behind it.'],
  };
}

const STAFF_BUILDERS = {
  FINANCE: financeDashboard, HR: hrDashboard, LIBRARIAN: librarianDashboard, WARDEN: wardenDashboard,
  MARKETING: marketingDashboard, COMPLIANCE: complianceDashboard, TRUSTEE: trusteeDashboard,
};
const MONTHLY = new Set(['FINANCE']);

/**
 * GET /insights/dashboard — the signed-in person's own dashboard.
 * Roles without one (principal and admin, who have the school-wide pulse
 * board; alumni, who have no records here to chart) get view: null.
 */
export async function roleDashboard(actor, { days, child } = {}) {
  const options = MONTHLY.has(actor.roleKey) ? MONTH_PERIODS : DAY_PERIODS;
  const period = pickPeriod(options, days);
  let out = null;
  if (actor.roleKey === 'TEACHER') out = await teacherDashboard(actor, period);
  else if (actor.roleKey === 'PARENT') out = await parentDashboard(actor, period, child ? String(child) : null);
  else if (actor.roleKey === 'STUDENT') out = await studentDashboard(actor, period);
  else if (STAFF_BUILDERS[actor.roleKey]) out = await attempt(`${actor.roleKey} dashboard`, () => STAFF_BUILDERS[actor.roleKey](actor, period));
  if (!out) return { view: null, period: { days: period.days, options }, kpis: [], charts: [], lists: [], notes: [], asOf: new Date().toISOString() };
  return { ...out, period: { days: period.days, options }, asOf: new Date().toISOString() };
}
