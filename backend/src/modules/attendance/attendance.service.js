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

async function resolveSummaryEnrollmentIds(actor, scope, enrollmentId) {
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
