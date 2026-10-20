import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { Enrollment, Student } from '../../models/student.model.js';
import { Section, SubjectOffering } from '../../models/academics.model.js';
import { TimetableSlot } from '../../models/timetableSlot.model.js';
import { Profile } from '../../models/profile.model.js';
import { Role } from '../../models/role.model.js';
import { StaffLeave, CoverAssignment } from '../../models/staffLeave.model.js';
import { AppError } from '../../utils/AppError.js';
import { ATTENDANCE_STATUSES, attendanceFigures, getClassWiseSummary } from '../attendance/attendance.service.js';
import { workingDaysBetween } from '../staff/staffLeave.service.js';
import { schoolCalendar } from '../analytics/analytics.service.js';
import '../../models/academics.model.js';

/**
 * The principal's academic oversight, built from records the school already
 * keeps (registers, timetable, cover, staff leave). Two views:
 *
 *   attendanceOverview  every class over a period, today's registers not yet
 *                       taken, the school's day-by-day figure, and the students
 *                       below the attendance threshold (CBSE examination bye-law
 *                       13: 75% for board-exam eligibility; the threshold is a
 *                       query parameter so a state board school can change it)
 *   teacherWorkload     periods a week per teacher from the timetable, classes
 *                       and subjects, class-teacher duty, cover taken in the last
 *                       30 days and leave this year, with flags above a cap
 *
 * Counting rules match the attendance module: day-level marks only
 * (periodNo null), real statuses only, and no percentage (null) where nothing
 * was marked, never 0%. Every model here is tenant-scoped.
 */

const DAY = 86_400_000;
const iso = (d) => d.toISOString().slice(0, 10);
const ymdIn = (now, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const asDay = (s) => {
  const m = String(s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new AppError(`Dates look like 2026-10-16 (got "${s}")`, 400, [], 'BAD_DATE');
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
};
const className = (s) => `${s.gradeId?.name ?? ''} ${s.name ?? ''}`.trim() || 'Class';
const byClass = (a, b) => (a.level ?? 99) - (b.level ?? 99) || String(a.class).localeCompare(String(b.class), 'en', { numeric: true });

/** Today in the school's time zone, as a stored calendar day (UTC midnight). */
export async function schoolToday(now = new Date()) {
  const { tz } = await schoolCalendar();
  return asDay(ymdIn(now, tz ?? 'Asia/Kolkata'));
}

export async function attendanceOverview(actor, query = {}, now = new Date()) {
  const today = await schoolToday(now);
  const to = query.to ? asDay(query.to) : today;
  const from = query.from ? asDay(query.from) : new Date(to.getTime() - 29 * DAY);
  if (from > to) throw new AppError('The start date is after the end date.', 400, [], 'BAD_RANGE');
  if ((to - from) / DAY > 400) throw new AppError('Choose a period of at most 400 days.', 400, [], 'RANGE_TOO_LONG');
  const threshold = Math.min(100, Math.max(1, Number(query.threshold) || 75));

  const classWise = await getClassWiseSummary(actor, 'ALL', { from: iso(from), to: iso(to) }, now);
  const classes = classWise.classes.map((c) => ({ ...c, belowThreshold: c.pctPresent !== null && c.pctPresent < threshold })).sort(byClass);

  // Today's registers: which classes with pupils have no day-level mark yet.
  const workingToday = (await workingDaysBetween(today, today)).length === 1;
  const sections = await Section.find({}).select('_id name gradeId classTeacherId').populate('gradeId', 'name level').populate('classTeacherId', 'displayName').lean();
  const enrolments = await Enrollment.find({ status: 'ACTIVE', sectionId: { $in: sections.map((s) => s._id) } }).select('_id sectionId studentId').lean();
  const pupils = new Map();
  for (const e of enrolments) pupils.set(String(e.sectionId), (pupils.get(String(e.sectionId)) ?? 0) + 1);
  const markedToday = await AttendanceRecord.aggregate([
    { $match: { date: { $gte: today, $lt: new Date(today.getTime() + DAY) }, periodNo: null, status: { $in: ATTENDANCE_STATUSES }, enrollmentId: { $in: enrolments.map((e) => e._id) } } },
    { $group: { _id: '$enrollmentId' } },
  ]);
  const sectionOfEnrolment = new Map(enrolments.map((e) => [String(e._id), String(e.sectionId)]));
  const markedPerSection = new Map();
  for (const r of markedToday) { const s = sectionOfEnrolment.get(String(r._id)); markedPerSection.set(s, (markedPerSection.get(s) ?? 0) + 1); }
  const registers = sections.filter((s) => pupils.get(String(s._id))).map((s) => ({
    sectionId: String(s._id), class: className(s), level: s.gradeId?.level ?? null,
    classTeacher: s.classTeacherId?.displayName ?? null,
    students: pupils.get(String(s._id)), marked: markedPerSection.get(String(s._id)) ?? 0,
  })).sort(byClass);
  const notMarked = registers.filter((r) => r.marked === 0);
  const partlyMarked = registers.filter((r) => r.marked > 0 && r.marked < r.students);

  // Day by day, the school as a whole.
  const daily = await AttendanceRecord.aggregate([
    { $match: { date: { $gte: from, $lt: new Date(to.getTime() + DAY) }, periodNo: null, status: { $in: ATTENDANCE_STATUSES }, enrollmentId: { $in: enrolments.map((e) => e._id) } } },
    { $group: { _id: { d: '$date', s: '$status' }, n: { $sum: 1 } } },
  ]);
  const perDay = new Map();
  for (const r of daily) { const k = iso(r._id.d); const t = perDay.get(k) ?? {}; t[r._id.s] = (t[r._id.s] ?? 0) + r.n; perDay.set(k, t); }
  const trend = [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, t]) => {
    const f = attendanceFigures(t);
    return { date, marked: f.workingDays, pctPresent: f.pctPresent, absent: t.ABSENT ?? 0 };
  });

  // Students below the threshold over the period (with enough marks to judge).
  const perStudent = await AttendanceRecord.aggregate([
    { $match: { date: { $gte: from, $lt: new Date(to.getTime() + DAY) }, periodNo: null, status: { $in: ATTENDANCE_STATUSES }, enrollmentId: { $in: enrolments.map((e) => e._id) } } },
    { $group: { _id: { e: '$enrollmentId', s: '$status' }, n: { $sum: 1 } } },
  ]);
  const tallies = new Map();
  for (const r of perStudent) { const k = String(r._id.e); const t = tallies.get(k) ?? {}; t[r._id.s] = r.n; tallies.set(k, t); }
  const minMarks = Math.max(3, Math.min(10, Math.round(trend.length / 3)));
  const low = [];
  for (const [enrollmentId, t] of tallies) {
    const f = attendanceFigures(t);
    if (f.pctPresent === null || f.workingDays < minMarks || f.pctPresent >= threshold) continue;
    low.push({ enrollmentId, pctPresent: f.pctPresent, daysMarked: f.workingDays, absent: t.ABSENT ?? 0 });
  }
  low.sort((a, b) => a.pctPresent - b.pctPresent);
  const lowTop = low.slice(0, 100);
  const enrolmentById = new Map(enrolments.map((e) => [String(e._id), e]));
  const students = await Student.find({ _id: { $in: lowTop.map((l) => enrolmentById.get(l.enrollmentId)?.studentId).filter(Boolean) } }).select('firstName lastName admissionNo').lean();
  const studentById = new Map(students.map((s) => [String(s._id), s]));
  const sectionById = new Map(sections.map((s) => [String(s._id), s]));
  const belowThreshold = lowTop.map((l) => {
    const e = enrolmentById.get(l.enrollmentId);
    const st = studentById.get(String(e?.studentId));
    return { ...l, studentId: String(e?.studentId ?? ''), name: st ? `${st.firstName} ${st.lastName ?? ''}`.trim() : 'Student', admissionNo: st?.admissionNo ?? null, class: className(sectionById.get(String(e?.sectionId)) ?? {}) };
  });

  return {
    period: { from: iso(from), to: iso(to), days: trend.length },
    threshold,
    overall: classWise.overall,
    classes,
    today: { date: iso(today), schoolDay: workingToday, registers: registers.length, notMarked, partlyMarked },
    trend,
    belowThreshold, belowThresholdTotal: low.length, minMarksConsidered: minMarks,
    basis: `Whole-day registers only. Present, late and excused count as attended, a half day as half. Students need at least ${minMarks} marked days in the period to be listed. The ${threshold}% line follows the CBSE examination bye-laws for board-exam eligibility.`,
  };
}

/**
 * Teaching load per teacher from the timetable. A slot counts for the teacher
 * of its subject offering; break slots (no offering) count for nobody.
 */
export async function teacherWorkload(actor, query = {}, now = new Date()) {
  const cap = Math.min(48, Math.max(10, Number(query.cap) || 30));
  const role = await Role.findOne({ key: 'TEACHER' }).select('_id').lean();
  const teachers = role ? await Profile.find({ roleId: role._id, status: 'ACTIVE', deletedAt: null }).select('_id displayName').lean() : [];
  const offerings = await SubjectOffering.find({ teacherId: { $ne: null } }).select('_id teacherId sectionId subjectId').populate('subjectId', 'name').lean();
  const offeringById = new Map(offerings.map((o) => [String(o._id), o]));
  const slots = await TimetableSlot.find({ subjectOfferingId: { $ne: null } }).select('subjectOfferingId dayOfWeek periodNo startTime sectionId').lean();
  const sections = await Section.find({}).select('_id name gradeId classTeacherId').populate('gradeId', 'name level').lean();
  const sectionById = new Map(sections.map((s) => [String(s._id), s]));

  const today = await schoolToday(now);
  const since = new Date(today.getTime() - 29 * DAY);
  const yearStart = new Date(Date.UTC(today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1, 3, 1));
  const [covers, leaves] = await Promise.all([
    CoverAssignment.aggregate([{ $match: { status: 'CONFIRMED', date: { $gte: since, $lte: today } } }, { $group: { _id: '$substituteProfileId', n: { $sum: 1 } } }]),
    StaffLeave.aggregate([{ $match: { status: 'APPROVED', fromDate: { $gte: yearStart } } }, { $group: { _id: '$profileId', days: { $sum: '$days' } } }]),
  ]);
  const coverBy = new Map(covers.map((c) => [String(c._id), c.n]));
  const leaveBy = new Map(leaves.map((l) => [String(l._id), l.days]));

  const rows = teachers.map((t) => {
    const id = String(t._id);
    const mySlots = slots.filter((s) => String(offeringById.get(String(s.subjectOfferingId))?.teacherId ?? '') === id);
    const perDay = [1, 2, 3, 4, 5, 6].map((d) => mySlots.filter((s) => s.dayOfWeek === d).length);
    const myOfferings = offerings.filter((o) => String(o.teacherId) === id);
    const sectionIds = [...new Set(myOfferings.map((o) => String(o.sectionId)))];
    const subjects = [...new Set(myOfferings.map((o) => o.subjectId?.name).filter(Boolean))].sort();
    const classTeacherOf = sections.filter((s) => String(s.classTeacherId ?? '') === id).map(className);
    const periodsPerWeek = mySlots.length;
    // The same teacher timetabled in two classes at the same time: a clash the timetable should not hold.
    const at = new Map();
    for (const sl of mySlots) { const k = `${sl.dayOfWeek}|${sl.startTime ?? `period ${sl.periodNo}`}`; at.set(k, [...(at.get(k) ?? []), sl]); }
    const clashes = [...at.entries()].filter(([, list]) => list.length > 1).map(([k, list]) => {
      const [dow, when] = k.split('|');
      return { day: ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][Number(dow)], at: when, classes: list.map((x) => className(sectionById.get(String(x.sectionId)) ?? {})) };
    });
    const flags = [];
    if (clashes.length) flags.push('CLASH');
    if (periodsPerWeek > cap) flags.push('OVER_CAP');
    if (!periodsPerWeek) flags.push('NO_PERIODS');
    if (Math.max(...perDay) >= 7) flags.push('HEAVY_DAY');
    if ((coverBy.get(id) ?? 0) >= 6) flags.push('MANY_COVERS');
    return {
      profileId: id, name: t.displayName, periodsPerWeek, perDay, maxInADay: Math.max(...perDay),
      sections: sectionIds.length, classes: sectionIds.map((s) => className(sectionById.get(s) ?? {})).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
      subjects, classTeacherOf, coversLast30Days: coverBy.get(id) ?? 0, leaveDaysThisYear: leaveBy.get(id) ?? 0, flags,
      clashes: clashes.slice(0, 20), clashCount: clashes.length,
    };
  }).sort((a, b) => b.periodsPerWeek - a.periodsPerWeek || a.name.localeCompare(b.name));

  const loads = rows.map((r) => r.periodsPerWeek).filter((n) => n > 0);
  const unassigned = slots.length - rows.reduce((s, r) => s + r.periodsPerWeek, 0);
  return {
    cap, teachers: rows,
    summary: {
      teachers: rows.length, averagePeriods: loads.length ? Math.round((loads.reduce((a, b) => a + b, 0) / loads.length) * 10) / 10 : null,
      overCap: rows.filter((r) => r.flags.includes('OVER_CAP')).length, withoutPeriods: rows.filter((r) => r.flags.includes('NO_PERIODS')).length,
      periodsWithoutTeacher: Math.max(0, unassigned), classTeachers: rows.filter((r) => r.classTeacherOf.length).length,
      withClashes: rows.filter((r) => r.clashCount > 0).length,
    },
    basis: `Periods a week are the timetable slots of each teacher's subjects (Monday to Saturday). Cover counts confirmed substitutions in the last 30 days; leave counts approved leave since 1 April. The cap of ${cap} periods a week can be changed.`,
  };
}
