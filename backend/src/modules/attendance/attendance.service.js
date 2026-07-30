import mongoose from 'mongoose';
import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { Enrollment } from '../../models/student.model.js';
import { Section } from '../../models/academics.model.js';
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

export async function getRoster(actor, scope, sectionId, date) {
  if (!sectionId) throw new AppError('sectionId is required', 400);
  if (!date) throw new AppError('date is required', 400);

  const day = parseDateToMidnight(date);
  if (!day) throw new AppError('Invalid date format', 400);

  await assertTeacherOwnsSection(actor, scope, sectionId);

  const section = await Section.findById(sectionId).populate('gradeId');
  if (!section) throw new AppError('Section not found', 404);

  const enrollments = await Enrollment.find({ sectionId, status: 'ACTIVE' })
    .populate('studentId')
    .sort({ rollNo: 1 });

  const records = await AttendanceRecord.find({
    enrollmentId: { $in: enrollments.map((e) => e._id) },
    date: day,
    periodNo: null,
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
    periodNo: null,
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
  return getRoster(actor, 'ALL', sectionId, date);
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

export async function resolveSummaryEnrollmentIds(actor, scope, enrollmentId) {
  if (enrollmentId) return [enrollmentId];

  if (scope === 'OWN' && actor.roleKey === 'PARENT') {
    const studentIds = await getGuardianStudentIds(actor.profileId);
    const enrollments = await Enrollment.find({ studentId: { $in: studentIds } }).select('_id');
    return enrollments.map((e) => e._id.toString());
  }
  if (scope === 'OWN' && actor.roleKey === 'STUDENT') {
    const studentId = await getOwnStudentId(actor.profileId);
    const enrollments = await Enrollment.find({ studentId }).select('_id');
    return enrollments.map((e) => e._id.toString());
  }
  throw new AppError('enrollmentId is required', 400);
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

  // If the query was for a single enrollmentId, return a flat object as expected by frontend
  if (enrollmentId && enrollmentIds.includes(enrollmentId)) {
    const stats = summary[enrollmentId] ?? { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, HALF_DAY: 0 };
    const workingDays = stats.PRESENT + stats.ABSENT + stats.LATE + stats.EXCUSED + stats.HALF_DAY;
    const presentCount = stats.PRESENT + stats.LATE + stats.EXCUSED + (stats.HALF_DAY * 0.5);
    const pctPresent = workingDays > 0 ? Math.round((presentCount / workingDays) * 100) : 0;

    return {
      enrollmentId,
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

/** Resolve a single enrollmentId for actor-scoped endpoints (calendar/trend) — the
 * student/parent's own record when none is given explicitly. */
async function resolveSingleEnrollmentId(actor, scope, enrollmentId) {
  if (enrollmentId) return enrollmentId;
  const ids = await resolveSummaryEnrollmentIds(actor, scope, null);
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
