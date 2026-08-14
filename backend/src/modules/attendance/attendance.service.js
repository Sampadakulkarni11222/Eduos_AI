import mongoose from 'mongoose';
import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { Enrollment } from '../../models/student.model.js';
import { Section } from '../../models/academics.model.js';
import { TimetableSlot } from '../../models/timetableSlot.model.js';
import { AppError } from '../../utils/AppError.js';
import { getTeacherSectionIds, getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';

export function parseDateToMidnight(dateStr) {
  if (!dateStr) return null;
  const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [_, y, m, d] = match;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function assertTeacherOwnsSection(actor, scope, sectionId) {
  if (scope !== 'OWN' || actor.roleKey !== 'TEACHER') return;
  const sectionIds = await getTeacherSectionIds(actor.profileId);
  if (!sectionIds.includes(sectionId)) {
    throw new AppError('You do not teach this section', 403);
  }
}

/**
 * Roster for a section on a date, optionally for one timetabled period.
 *
 * `periodNo` null means whole-day attendance, which is all this used to
 * support — the roster hardcoded `periodNo: null`, so even though marking
 * accepted a period, there was no way to read one back and no way for a
 * teacher to mark one. That is why every attendance record in the system is
 * day-level, and in turn why per-subject attendance could only ever be
 * inferred (see getSubjectWiseSummary).
 *
 * The response also lists the periods timetabled for that weekday, so the
 * caller can offer the choice without a second request.
 */
export async function getRoster(actor, scope, sectionId, date, periodNo = null) {
  if (!sectionId) throw new AppError('sectionId is required', 400);
  if (!date) throw new AppError('date is required', 400);

  const day = parseDateToMidnight(date);
  if (!day) throw new AppError('Invalid date format', 400);

  const period = periodNo === null || periodNo === undefined || periodNo === '' ? null : Number(periodNo);
  if (period !== null && !Number.isInteger(period)) throw new AppError('periodNo must be a whole number', 400);

  await assertTeacherOwnsSection(actor, scope, sectionId);

  const section = await Section.findById(sectionId).populate('gradeId');
  if (!section) throw new AppError('Section not found', 404);

  const enrollments = await Enrollment.find({ sectionId, status: 'ACTIVE' })
    .populate('studentId')
    .sort({ rollNo: 1 });

  // getUTCDay(): 0=Sun..6=Sat; the timetable uses 1=Mon..7=Sun.
  const dow = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
  const slots = await TimetableSlot.find({ sectionId, dayOfWeek: dow })
    .populate({ path: 'subjectOfferingId', populate: { path: 'subjectId', select: 'name' } })
    .sort({ periodNo: 1 });

  const periods = slots
    .filter((s) => s.subjectOfferingId?.subjectId?.name)
    .map((s) => ({
      periodNo: s.periodNo,
      subject: s.subjectOfferingId.subjectId.name,
      startTime: s.startTime ?? null,
      endTime: s.endTime ?? null,
    }));

  if (period !== null && !periods.some((p) => p.periodNo === period)) {
    throw new AppError(`Period ${period} is not timetabled for this section on that day.`, 400, [], 'PERIOD_NOT_SCHEDULED');
  }

  const records = await AttendanceRecord.find({
    enrollmentId: { $in: enrollments.map((e) => e._id) },
    date: day,
    periodNo: period,
  });
  const recordByEnrollment = new Map(records.map((r) => [r.enrollmentId.toString(), r]));

  const roster = enrollments.map((e) => ({
    enrollmentId: e._id.toString(),
    rollNo: e.rollNo ?? null,
    studentName: e.studentId ? `${e.studentId.firstName} ${e.studentId.lastName || ''}`.trim() : 'Unknown',
    status: recordByEnrollment.get(e._id.toString())?.status ?? null,
    note: recordByEnrollment.get(e._id.toString())?.note ?? null,
  }));

  return {
    section: {
      id: section._id.toString(),
      name: `${section.gradeId?.name ?? ''} ${section.name}`.trim(),
    },
    date,
    periodNo: period,
    subject: period === null ? null : periods.find((p) => p.periodNo === period)?.subject ?? null,
    periods,
    roster,
  };
}

export async function markAttendance(actor, { date, periodNo = null, records, entries, sectionId }) {
  if (!sectionId) throw new AppError('sectionId is required', 400);
  if (!date) throw new AppError('date is required', 400);

  const day = parseDateToMidnight(date);
  if (!day) throw new AppError('Invalid date format', 400);

  await assertTeacherOwnsSection(actor, 'OWN', sectionId);

  const items = records || entries || [];
  if (items.length === 0) throw new AppError('No attendance records provided', 400);

  // Every enrollmentId must actually belong to the authorized sectionId —
  // otherwise a caller could smuggle in enrollmentIds from other sections.
  const requestedIds = [...new Set(items.map((i) => i.enrollmentId?.toString()))];
  const validEnrollments = await Enrollment.find({ _id: { $in: requestedIds }, sectionId }).select('_id');
  const validIds = new Set(validEnrollments.map((e) => e._id.toString()));
  const invalidIds = requestedIds.filter((id) => !validIds.has(id));
  if (invalidIds.length > 0) {
    throw new AppError('One or more students do not belong to this section', 403);
  }

  // Validate status
  for (const item of items) {
    if (!item.status || !VALID_STATUSES.has(item.status.toUpperCase())) {
      throw new AppError(`Invalid status "${item.status ?? ''}"`, 400);
    }
  }

  const ops = items.map(({ enrollmentId, status, note }) => ({
    updateOne: {
      filter: { enrollmentId, date: day, periodNo },
      update: {
        $set: { status: status.toUpperCase(), note, source: 'WEB', markedByProfileId: actor.profileId },
      },
      upsert: true,
    },
  }));

  await AttendanceRecord.bulkWrite(ops);
  // Same period back, so the caller sees what it just wrote rather than the
  // whole-day roster.
  return getRoster(actor, 'ALL', sectionId, date, periodNo);
}

const VALID_STATUSES = new Set(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'HALF_DAY']);

/**
 * Raw attendance rows already recorded for a section on a date.
 *
 * Read-only and unscoped by design: it backs the agent's before/after audit
 * snapshot, which runs *after* markAttendance's own ownership check has
 * authorized the same section. It is not exposed over HTTP.
 */
export async function findExisting(sectionId, date, periodNo = null) {
  const day = parseDateToMidnight(date);
  if (!sectionId || !day) return [];

  const enrollments = await Enrollment.find({ sectionId }).select('_id');
  return AttendanceRecord.find({
    enrollmentId: { $in: enrollments.map((e) => e._id) },
    date: day,
    periodNo,
  })
    .select('enrollmentId status')
    .lean();
}

/**
 * Bulk-marks attendance for a section from parsed CSV rows (admissionNo or
 * rollNo + status). Rows are resolved to enrollmentIds strictly within the
 * given sectionId's active roster, then handed to markAttendance() so the
 * same ownership + cross-section checks apply as the single-roster path.
 */
export async function markAttendanceBulk(actor, { date, periodNo = null, sectionId, rows }) {
  if (!sectionId) throw new AppError('sectionId is required', 400);

  const enrollments = await Enrollment.find({ sectionId, status: 'ACTIVE' })
    .populate({ path: 'studentId', select: 'admissionNo' })
    .select('rollNo studentId');

  const byAdmissionNo = new Map();
  const byRollNo = new Map();
  for (const e of enrollments) {
    if (e.studentId?.admissionNo) byAdmissionNo.set(e.studentId.admissionNo.toLowerCase(), e._id.toString());
    if (e.rollNo != null) byRollNo.set(String(e.rollNo), e._id.toString());
  }

  const records = [];
  const errors = [];
  rows.forEach((row, idx) => {
    const rowNo = idx + 2; // header is row 1
    const admissionNo = row.admissionno?.trim();
    const rollNo = row.rollno?.trim();
    const status = row.status?.trim().toUpperCase();

    const enrollmentId =
      (admissionNo && byAdmissionNo.get(admissionNo.toLowerCase())) || (rollNo && byRollNo.get(rollNo));
    if (!enrollmentId) {
      errors.push({ row: rowNo, error: 'No matching active student in this section (check admissionNo/rollNo)' });
      return;
    }
    if (!VALID_STATUSES.has(status)) {
      errors.push({ row: rowNo, error: `Invalid status "${row.status ?? ''}"` });
      return;
    }

    records.push({ enrollmentId, status, note: row.note?.trim() || undefined });
  });

  if (records.length === 0) {
    throw new AppError('No valid attendance rows found in the file', 400, errors.map((e) => `Row ${e.row}: ${e.error}`));
  }

  const roster = await markAttendance(actor, { date, periodNo, sectionId, records });
  return { ...roster, imported: records.length, failed: errors.length, errors };
}

/** Every enrollment an OWN-scoped actor is entitled to see. */
async function ownEnrollmentIds(actor) {
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
  if (actor.roleKey === 'TEACHER') {
    // A teacher's own scope is the sections they teach, so their pupils'
    // attendance is legitimately theirs to read.
    const sectionIds = await getTeacherSectionIds(actor.profileId);
    const enrollments = await Enrollment.find({ sectionId: { $in: sectionIds }, status: 'ACTIVE' }).select('_id');
    return enrollments.map((e) => e._id.toString());
  }
  return [];
}

/**
 * Resolves which enrollments a request may read.
 *
 * This used to begin `if (enrollmentId) return [enrollmentId]`, which meant a
 * caller-supplied id skipped every ownership check below it. Any signed-in
 * student could read another child's attendance summary, calendar, trend and
 * per-subject breakdown by passing their enrollment id — the response even
 * echoed the id back, confirming it had queried the other record. Enrollment
 * ids are handed out freely elsewhere in the API, so this needed no guessing.
 *
 * An explicit id is now checked against what the actor is entitled to rather
 * than taken as proof of entitlement. ALL-scoped staff may still name any
 * enrollment; that is what the scope means.
 */
export async function resolveSummaryEnrollmentIds(actor, scope, enrollmentId) {
  if (scope !== 'OWN') {
    if (enrollmentId) return [String(enrollmentId)];
    throw new AppError('enrollmentId is required', 400);
  }

  const allowed = await ownEnrollmentIds(actor);

  if (enrollmentId) {
    if (!allowed.includes(String(enrollmentId))) {
      // 404 rather than 403: confirming an id exists but is someone else's is
      // itself a disclosure, and enumeration is the natural next step.
      throw new AppError('Enrollment not found', 404, [], 'ENROLLMENT_NOT_FOUND');
    }
    return [String(enrollmentId)];
  }

  if (allowed.length === 0) throw new AppError('No enrollment found for this account', 404);
  return allowed;
}

export async function getSummary(actor, scope, { enrollmentId, from, to, month }) {
  const enrollmentIds = await resolveSummaryEnrollmentIds(actor, scope, enrollmentId);

  let dateFrom = from ? parseDateToMidnight(from) : null;
  let dateTo = to ? parseDateToMidnight(to) : null;

  if (month && !dateFrom && !dateTo) {
    const [yearStr, monthStr] = month.split('-');
    const year = parseInt(yearStr);
    const monthIdx = parseInt(monthStr) - 1;
    dateFrom = new Date(Date.UTC(year, monthIdx, 1));
    dateTo = new Date(Date.UTC(year, monthIdx + 1, 0, 23, 59, 59, 999));
  }

  const match = { enrollmentId: { $in: enrollmentIds.map((id) => new mongoose.Types.ObjectId(id)) } };
  if (dateFrom || dateTo) {
    match.date = {};
    if (dateFrom) match.date.$gte = dateFrom;
    if (dateTo) match.date.$lte = dateTo;
  }

  const rows = await AttendanceRecord.aggregate([
    { $match: match },
    { $group: { _id: { enrollmentId: '$enrollmentId', status: '$status' }, count: { $sum: 1 } } },
  ]);

  const summary = {};
  for (const row of rows) {
    const key = row._id.enrollmentId.toString();
    summary[key] ??= { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, HALF_DAY: 0 };
    summary[key][row._id.status] = row.count;
  }

  // Flat object (with pctPresent) whenever the query resolves to exactly one
  // enrollment — not only when the caller named it explicitly.
  //
  // A student asking "what's my attendance percentage?" passes no
  // enrollmentId, so this used to fall through to the keyed map below, and
  // every caller that looked for `pctPresent` found undefined. That is why the
  // assistant answered "No attendance has been recorded yet" for a student who
  // had eight records.
  const singleId = enrollmentId && enrollmentIds.includes(enrollmentId)
    ? enrollmentId
    : (enrollmentIds.length === 1 ? enrollmentIds[0] : null);

  if (singleId) {
    const stats = summary[singleId] ?? { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, HALF_DAY: 0 };
    const workingDays = stats.PRESENT + stats.ABSENT + stats.LATE + stats.EXCUSED + stats.HALF_DAY;
    const presentCount = stats.PRESENT + stats.LATE + stats.EXCUSED + (stats.HALF_DAY * 0.5);
    const pctPresent = workingDays > 0 ? Math.round((presentCount / workingDays) * 100) : 0;

    return {
      enrollmentId: singleId,
      yearMonth: month || 'custom',
      PRESENT: stats.PRESENT,
      ABSENT: stats.ABSENT,
      LATE: stats.LATE,
      EXCUSED: stats.EXCUSED,
      HALF_DAY: stats.HALF_DAY,
      workingDays,
      pctPresent,
    };
  }

  return summary;
}

/**
 * Per-subject attendance, grouped by subject offering.
 *
 * Two sources, and the difference is reported rather than hidden:
 *
 *   PERIOD — a record carries a periodNo, so the timetable says exactly which
 *     subject that period was. This is a true per-subject figure.
 *   DAY    — the record is day-level (periodNo null), the only kind this
 *     deployment currently captures. The day's status is attributed to each
 *     subject scheduled that weekday.
 *
 * The DAY case is why every subject used to read 75%: when a subject is on the
 * timetable every weekday, its denominator is every marked day, so it restates
 * the overall percentage. That is now visible in `basis` and `derived` instead
 * of being presented as a per-subject fact — and subjects that are NOT
 * scheduled daily now differ, because each is counted only on the days it is
 * actually taught.
 */
export async function getSubjectWiseSummary(actor, scope, { enrollmentId, month, from, to } = {}) {
  const targetId = await resolveSingleEnrollmentId(actor, scope, enrollmentId);

  const enrollment = await Enrollment.findById(targetId).select('sectionId');
  if (!enrollment) throw new AppError('Enrollment not found', 404);

  let dateFrom = from ? parseDateToMidnight(from) : null;
  let dateTo = to ? parseDateToMidnight(to) : null;
  if (month && !dateFrom && !dateTo) {
    const [y, m] = month.split('-');
    dateFrom = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
    dateTo = new Date(Date.UTC(Number(y), Number(m), 0, 23, 59, 59, 999));
  }

  const slots = await TimetableSlot.find({ sectionId: enrollment.sectionId }).populate({
    path: 'subjectOfferingId',
    populate: { path: 'subjectId', select: 'name' },
  });

  // (dayOfWeek, periodNo) → offering, plus which subjects run on each weekday.
  const byDowPeriod = new Map();
  const subjectsByDow = new Map();
  for (const slot of slots) {
    const offering = slot.subjectOfferingId;
    const name = offering?.subjectId?.name;
    if (!name) continue; // breaks and free periods have no offering
    byDowPeriod.set(`${slot.dayOfWeek}:${slot.periodNo}`, offering);
    if (!subjectsByDow.has(slot.dayOfWeek)) subjectsByDow.set(slot.dayOfWeek, new Map());
    subjectsByDow.get(slot.dayOfWeek).set(String(offering._id), offering);
  }

  const match = { enrollmentId: new mongoose.Types.ObjectId(String(targetId)) };
  if (dateFrom || dateTo) {
    match.date = {};
    if (dateFrom) match.date.$gte = dateFrom;
    if (dateTo) match.date.$lte = dateTo;
  }
  const records = await AttendanceRecord.find(match).select('date periodNo status').lean();

  const buckets = new Map(); // offeringId → tally
  const tallyFor = (offering) => {
    const key = String(offering._id);
    if (!buckets.has(key)) {
      buckets.set(key, {
        subjectOfferingId: key,
        subject: offering.subjectId?.name ?? 'Subject',
        subjectId: offering.subjectId?._id ? String(offering.subjectId._id) : null,
        present: 0, absent: 0, leave: 0, totalSessions: 0, periodBacked: 0,
      });
    }
    return buckets.get(key);
  };

  const applyStatus = (bucket, status, fromPeriod) => {
    bucket.totalSessions++;
    if (fromPeriod) bucket.periodBacked++;
    if (status === 'PRESENT' || status === 'LATE') bucket.present++;
    else if (status === 'ABSENT') bucket.absent++;
    else bucket.leave++; // EXCUSED / HALF_DAY
  };

  for (const rec of records) {
    // getUTCDay(): 0=Sun..6=Sat; the timetable uses 1=Mon..7=Sun.
    const dow = rec.date.getUTCDay() === 0 ? 7 : rec.date.getUTCDay();

    if (rec.periodNo != null) {
      const offering = byDowPeriod.get(`${dow}:${rec.periodNo}`);
      if (offering) applyStatus(tallyFor(offering), rec.status, true);
      continue;
    }

    for (const offering of (subjectsByDow.get(dow) ?? new Map()).values()) {
      applyStatus(tallyFor(offering), rec.status, false);
    }
  }

  const subjects = [...buckets.values()]
    .map((b) => ({
      ...b,
      pctPresent: b.totalSessions > 0 ? Math.round((b.present / b.totalSessions) * 100) : null,
      // True only when every session counted came from a real period record.
      derived: b.periodBacked < b.totalSessions,
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject));

  const anyPeriod = subjects.some((s) => s.periodBacked > 0);
  const allPeriod = subjects.length > 0 && subjects.every((s) => s.periodBacked === s.totalSessions);

  return {
    enrollmentId: String(targetId),
    yearMonth: month ?? 'custom',
    basis: allPeriod ? 'PERIOD' : anyPeriod ? 'MIXED' : 'DAY',
    subjects,
  };
}

/** Resolve a single enrollmentId for actor-scoped endpoints (calendar/trend) — the
 * student/parent's own record when none is given explicitly. */
async function resolveSingleEnrollmentId(actor, scope, enrollmentId) {
  // Goes through the same ownership check rather than trusting the id — this
  // is the resolver behind the calendar, trend and subject-wise endpoints, and
  // it previously returned whatever id it was handed.
  const ids = await resolveSummaryEnrollmentIds(actor, scope, enrollmentId);
  if (ids.length === 0) throw new AppError('No enrollment found for this account', 404);
  return ids[0];
}

export async function getCalendar(actor, scope, { enrollmentId, month }) {
  const targetId = await resolveSingleEnrollmentId(actor, scope, enrollmentId);
  if (!month) throw new AppError('month is required', 400);

  const [yearStr, monthStr] = month.split('-');
  const year = parseInt(yearStr, 10);
  const monthIdx = parseInt(monthStr, 10) - 1;
  const dateFrom = new Date(Date.UTC(year, monthIdx, 1));
  const dateTo = new Date(Date.UTC(year, monthIdx + 1, 0, 23, 59, 59, 999));

  const records = await AttendanceRecord.find({
    enrollmentId: targetId,
    periodNo: null,
    date: { $gte: dateFrom, $lte: dateTo },
  }).select('date status').sort({ date: 1 }).lean();

  return {
    enrollmentId: targetId,
    month,
    days: records.map((r) => ({ date: r.date.toISOString().slice(0, 10), status: r.status })),
  };
}

export async function getTrend(actor, scope, { enrollmentId, months }) {
  const targetId = await resolveSingleEnrollmentId(actor, scope, enrollmentId);
  const n = Math.min(Math.max(parseInt(months, 10) || 6, 1), 12);

  // Local Y/M feed Date.UTC — matching parseDateToMidnight's convention (a stored
  // UTC-midnight Date represents an abstract calendar day, not a real UTC instant).
  // Using getUTC* on `now` here would drift "current month" by the server's UTC offset.
  const now = new Date();
  const rangeStart = new Date(Date.UTC(now.getFullYear(), now.getMonth() - (n - 1), 1));

  const rows = await AttendanceRecord.aggregate([
    {
      $match: {
        enrollmentId: new mongoose.Types.ObjectId(targetId),
        periodNo: null,
        date: { $gte: rangeStart },
      },
    },
    {
      $group: {
        _id: { ym: { $dateToString: { format: '%Y-%m', date: '$date' } }, status: '$status' },
        count: { $sum: 1 },
      },
    },
  ]);

  const byMonth = new Map();
  for (const row of rows) {
    const ym = row._id.ym;
    if (!byMonth.has(ym)) byMonth.set(ym, { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, HALF_DAY: 0 });
    byMonth.get(ym)[row._id.status] = row.count;
  }

  const points = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - i, 1));
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const stats = byMonth.get(ym) ?? { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, HALF_DAY: 0 };
    const workingDays = stats.PRESENT + stats.ABSENT + stats.LATE + stats.EXCUSED + stats.HALF_DAY;
    const presentCount = stats.PRESENT + stats.LATE + stats.EXCUSED + stats.HALF_DAY * 0.5;
    const pctPresent = workingDays > 0 ? Math.round((presentCount / workingDays) * 100) : 0;
    points.push({ month: ym, pctPresent, presentDays: stats.PRESENT + stats.LATE, workingDays });
  }
  return points;
}
