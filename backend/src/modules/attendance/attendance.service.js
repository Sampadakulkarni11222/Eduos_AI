import mongoose from 'mongoose';
import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { Enrollment } from '../../models/student.model.js';
import { Section } from '../../models/academics.model.js';
// Registered, not assumed: the roster populates the class teacher's and the
// subject teacher's profiles, and populate needs the model present even when a
// caller has imported only the attendance module.
import '../../models/profile.model.js';
import { TimetableSlot } from '../../models/timetableSlot.model.js';
import { AppError } from '../../utils/AppError.js';
import { getTeacherSectionIds, getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';
import { rowError } from '../../utils/csvImport.js';

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

/**
 * Gate for section-wide attendance data (a whole class roster).
 *
 * This used to return early for anyone who was not a TEACHER, which meant the
 * OWN-scope check silently did nothing for every other narrow role: a student
 * holding `attendance.read: OWN` could read any section's roster — 60 other
 * students' names and attendance — just by supplying a sectionId.
 *
 * The gate is now driven by scope, not by role. ALL-scope roles (admin,
 * principal, owner) are unrestricted as before; a teacher must own the
 * section; and any other OWN-scope caller is refused, because a class roster
 * is a staff view. Students and parents read their own attendance through
 * /attendance/summary, /calendar and /trend, which resolve the enrollment
 * from the caller's identity (see resolveSummaryEnrollmentIds).
 */
async function assertSectionAccess(actor, scope, sectionId) {
  // Only an explicit school-wide grant is unrestricted. Testing `!== 'OWN'`
  // meant any other value — including an absent scope, which is what a role
  // holding no attendance.mark at all resolves to — read as unrestricted and
  // skipped every check below.
  if (scope === 'ALL') return;

  if (actor.roleKey === 'TEACHER') {
    const sectionIds = await getTeacherSectionIds(actor.profileId);
    if (!sectionIds.includes(String(sectionId))) {
      throw new AppError('You do not teach this section', 403);
    }
    return;
  }

  throw new AppError('You are not allowed to view this section roster', 403);
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

  await assertSectionAccess(actor, scope, sectionId);

  const section = await Section.findById(sectionId).populate('gradeId').populate('classTeacherId', 'displayName');
  if (!section) throw new AppError('Section not found', 404);

  const enrollments = await Enrollment.find({ sectionId, status: 'ACTIVE' })
    .populate('studentId')
    .sort({ rollNo: 1 });

  // getUTCDay(): 0=Sun..6=Sat; the timetable uses 1=Mon..7=Sun.
  const dow = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
  const slots = await TimetableSlot.find({ sectionId, dayOfWeek: dow })
    .populate({
      path: 'subjectOfferingId',
      populate: [
        { path: 'subjectId', select: 'name' },
        { path: 'teacherId', select: 'displayName' },
      ],
    })
    .sort({ periodNo: 1 });

  const isClassTeacher = String(section.classTeacherId?._id ?? section.classTeacherId ?? '') === String(actor?.profileId ?? '');

  // Each period says who teaches it and whether *this* caller may mark it, so
  // the composer can offer a subject teacher exactly their own periods rather
  // than showing them the whole day and failing at save time.
  const periods = slots
    .filter((s) => s.subjectOfferingId?.subjectId?.name)
    .map((s) => {
      const offering = s.subjectOfferingId;
      const teacher = offering.teacherId;
      const mine = String(teacher?._id ?? teacher ?? '') === String(actor?.profileId ?? '');
      return {
        periodNo: s.periodNo,
        subject: offering.subjectId.name,
        subjectId: offering.subjectId._id ? String(offering.subjectId._id) : null,
        subjectTeacher: teacher?.displayName ?? null,
        startTime: s.startTime ?? null,
        endTime: s.endTime ?? null,
        canMark: scope === 'ALL' || mine || isClassTeacher,
      };
    });

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

  const chosen = period === null ? null : periods.find((p) => p.periodNo === period) ?? null;

  return {
    section: {
      id: section._id.toString(),
      name: `${section.gradeId?.name ?? ''} ${section.name}`.trim(),
      // Named so the teacher can see whose register they are looking at.
      grade: section.gradeId?.name ?? null,
      sectionName: section.name,
      classTeacher: section.classTeacherId?.displayName ?? null,
    },
    date,
    periodNo: period,
    subject: chosen?.subject ?? null,
    subjectTeacher: chosen?.subjectTeacher ?? null,
    // Whole-day marking is the class teacher's; a subject teacher marks periods.
    canMarkWholeDay: scope === 'ALL' || isClassTeacher,
    canMark: period === null ? (scope === 'ALL' || isClassTeacher) : (chosen?.canMark ?? false),
    periods,
    roster,
  };
}

/**
 * Which slot of the day a teacher may mark, not merely which section.
 *
 * Marking used to check the section alone, so any teacher who took *one*
 * subject in a class could mark that class's whole-day register — the class
 * teacher's job — and could equally mark a colleague's period. Both are the
 * same defect: the section is too coarse a unit to authorize a register on.
 *
 *   - whole day (`periodNo` null) belongs to the class teacher, who is the
 *     person accountable for the day's roll;
 *   - a period belongs to whoever teaches the offering timetabled in it.
 *
 * A school-wide grant is unaffected, and so is the class teacher, who reaches
 * their own periods through the second rule anyway.
 */
async function assertMarkAccess(actor, scope, sectionId, periodNo, day) {
  if (scope === 'ALL') return;

  if (actor?.roleKey !== 'TEACHER') {
    throw new AppError('You are not allowed to mark this register', 403);
  }

  const sectionIds = await getTeacherSectionIds(actor.profileId);
  if (!sectionIds.includes(String(sectionId))) {
    throw new AppError('You do not teach this section', 403);
  }

  const section = await Section.findById(sectionId).select('classTeacherId').lean();
  const isClassTeacher = String(section?.classTeacherId ?? '') === String(actor.profileId);

  if (periodNo === null || periodNo === undefined) {
    if (!isClassTeacher) {
      throw new AppError(
        'Whole-day attendance is the class teacher\'s register. Choose the period you teach instead.',
        403,
        [],
        'NOT_CLASS_TEACHER',
      );
    }
    return;
  }

  // getUTCDay(): 0=Sun..6=Sat; the timetable uses 1=Mon..7=Sun.
  const dow = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
  const slot = await TimetableSlot.findOne({ sectionId, dayOfWeek: dow, periodNo })
    .populate({ path: 'subjectOfferingId', select: 'teacherId subjectId' })
    .lean();

  if (!slot) {
    throw new AppError(
      `Period ${periodNo} is not timetabled for this section on that day.`,
      400, [], 'PERIOD_NOT_SCHEDULED',
    );
  }

  const teachesIt = String(slot.subjectOfferingId?.teacherId ?? '') === String(actor.profileId);
  // The class teacher keeps the register for their own class in every period —
  // they cover absences and they answer for the day's roll either way.
  if (!teachesIt && !isClassTeacher) {
    throw new AppError('You do not teach the subject timetabled in that period', 403, [], 'NOT_SUBJECT_TEACHER');
  }
}

export async function markAttendance(actor, scope, { date, periodNo = null, records, entries, sectionId }) {
  if (!sectionId) throw new AppError('sectionId is required', 400);
  if (!date) throw new AppError('date is required', 400);

  const day = parseDateToMidnight(date);
  if (!day) throw new AppError('Invalid date format', 400);

  // The caller's real scope, not a hardcoded 'OWN'. A school-wide grant is
  // unrestricted; a teacher is checked against the exact slot being marked —
  // their own period, or their own class's day if they are its class teacher.
  await assertMarkAccess(actor, scope, sectionId, periodNo, day);

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
export async function markAttendanceBulk(actor, scope, { date, periodNo = null, sectionId, rows }) {
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
      errors.push(rowError(rowNo, {
        field: admissionNo ? 'admissionNo' : 'rollNo',
        value: admissionNo || rollNo,
        problem: 'does not match an active student in this section',
        suggestion: 'check the student is enrolled in the section you chose, and that the number is spelt as it is on the roll',
      }));
      return;
    }
    if (!VALID_STATUSES.has(status)) {
      errors.push(rowError(rowNo, {
        field: 'status',
        value: row.status,
        problem: 'is not a status the register accepts',
        suggestion: `use one of: ${[...VALID_STATUSES].join(', ')}`,
      }));
      return;
    }

    records.push({ enrollmentId, status, note: row.note?.trim() || undefined });
  });

  if (records.length === 0) {
    throw new AppError('No valid attendance rows found in the file', 400, errors.map((e) => `Row ${e.row}: ${e.error}`));
  }

  const roster = await markAttendance(actor, scope, { date, periodNo, sectionId, records });
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
/**
 * Day-level attendance counts across the acting school for one date.
 *
 * Exists because there was no way to answer "how many students are absent
 * today?" -- getSummary() is built around a set of enrollments and demands an
 * enrollmentId at ALL scope, which is the right shape for "this person's
 * attendance" and the wrong one for "the school's morning".
 *
 * No scoping argument, deliberately: AttendanceRecord is tenantScoped, so the
 * aggregate is confined to the acting school by the plugin. Authorization is
 * the caller's job -- the agent tool that fronts this declares
 * attendance.read at ALL scope, and the REST layer would use requirePermission
 * the same way.
 *
 * Counts day-level marks only (periodNo: null), matching how the teacher
 * dashboard reports "today", so a school marking per-period attendance does
 * not report one pupil absent six times.
 */
export async function getDailyAbsenceSummary({ date } = {}) {
  // Local Y/M/D fed into Date.UTC, matching parseDateToMidnight's convention:
  // a stored UTC-midnight Date represents an abstract calendar day, not a real
  // UTC instant. Deriving "today" from toISOString() would take the server's
  // UTC calendar date instead, so east of Greenwich every register marked
  // after local midnight but before UTC midnight would be counted against the
  // wrong day -- and in India that is the entire school morning.
  const now = new Date();
  const day = date
    ? parseDateToMidnight(date)
    : new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const next = new Date(day.getTime() + 24 * 60 * 60 * 1000);

  const rows = await AttendanceRecord.aggregate([
    { $match: { date: { $gte: day, $lt: next }, periodNo: null } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, HALF_DAY: 0 };
  for (const row of rows) counts[row._id] = row.count;

  const marked = Object.values(counts).reduce((a, b) => a + b, 0);

  return {
    date: day.toISOString().slice(0, 10),
    marked,
    ...counts,
    // Of those actually marked -- not of the roll. A register that is half
    // taken must not be reported as though the missing half were present.
    pctPresent: marked > 0 ? Math.round((counts.PRESENT / marked) * 100) : null,
  };
}

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

/**
 * Lecture-by-lecture attendance for one enrollment over a date range.
 *
 * Only rows that were actually captured per period (`periodNo != null`) count
 * as a lecture — a day-level record says nothing about any individual class,
 * and inventing seven lectures out of one daily mark would be presenting a
 * guess as a register. Each record is matched to the timetable slot for its
 * weekday and period, which is where the subject, room and clock times come
 * from; a record with no matching slot is still returned, labelled by its
 * period number alone, so an absence is never silently dropped.
 */
export async function getLectureAttendance(actor, scope, { enrollmentId, month, from, to } = {}) {
  const targetId = await resolveSingleEnrollmentId(actor, scope, enrollmentId);

  const enrollment = await Enrollment.findById(targetId).select('sectionId');
  if (!enrollment) throw new AppError('Enrollment not found', 404);

  let dateFrom = from ? parseDateToMidnight(from) : null;
  // `to` names a calendar day, and records are stored at that day's midnight,
  // so the bound covers the whole of it — otherwise a from/to range on a
  // single day matches nothing.
  let dateTo = to ? parseDateToMidnight(to) : null;
  if (dateTo) dateTo = new Date(dateTo.getTime() + 24 * 60 * 60 * 1000 - 1);
  if (month && !dateFrom && !dateTo) {
    const [y, m] = month.split('-');
    dateFrom = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
    dateTo = new Date(Date.UTC(Number(y), Number(m), 0, 23, 59, 59, 999));
  }

  const slots = await TimetableSlot.find({ sectionId: enrollment.sectionId }).populate({
    path: 'subjectOfferingId',
    populate: [
      { path: 'subjectId', select: 'name' },
      { path: 'teacherId', select: 'displayName' },
    ],
  });
  const slotByKey = new Map(slots.map((sl) => [`${sl.dayOfWeek}:${sl.periodNo}`, sl]));

  const match = { enrollmentId: new mongoose.Types.ObjectId(String(targetId)), periodNo: { $ne: null } };
  if (dateFrom || dateTo) {
    match.date = {};
    if (dateFrom) match.date.$gte = dateFrom;
    if (dateTo) match.date.$lte = dateTo;
  }

  const records = await AttendanceRecord.find(match)
    .select('date periodNo status note')
    .sort({ date: -1, periodNo: 1 })
    .limit(500)
    .lean();

  const lectures = records.map((rec) => {
    // getUTCDay(): 0=Sun..6=Sat; the timetable uses 1=Mon..7=Sun.
    const dow = rec.date.getUTCDay() === 0 ? 7 : rec.date.getUTCDay();
    const slot = slotByKey.get(`${dow}:${rec.periodNo}`);
    return {
      id: String(rec._id),
      date: rec.date.toISOString().slice(0, 10),
      dayOfWeek: dow,
      periodNo: rec.periodNo,
      subject: slot?.subjectOfferingId?.subjectId?.name ?? null,
      teacher: slot?.subjectOfferingId?.teacherId?.displayName ?? null,
      startTime: slot?.startTime ?? null,
      endTime: slot?.endTime ?? null,
      room: slot?.room ?? null,
      status: rec.status,
      note: rec.note ?? null,
    };
  });

  const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, HALF_DAY: 0 };
  for (const l of lectures) counts[l.status] = (counts[l.status] ?? 0) + 1;
  const attended = counts.PRESENT + counts.LATE;

  return {
    enrollmentId: String(targetId),
    from: dateFrom ? dateFrom.toISOString().slice(0, 10) : null,
    to: dateTo ? dateTo.toISOString().slice(0, 10) : null,
    totalLectures: lectures.length,
    counts,
    pctPresent: lectures.length > 0 ? Math.round((attended / lectures.length) * 100) : null,
    lectures,
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
