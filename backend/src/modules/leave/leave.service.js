import { LeaveApplication } from '../../models/leaveApplication.model.js';
import { Student, Enrollment } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { paginate } from '../../utils/paginate.js';

/**
 * Parses a calendar date to UTC midnight, ignoring any time or offset supplied.
 *
 * A leave day is a day on a calendar, not a moment. Accepting a client's
 * timezone offset here is what shifts "15 August" into "14 August 18:30Z" and
 * makes the application appear on the wrong day for everyone else.
 * Returns null for anything unparseable so the caller can reject it.
 */
function toUtcMidnight(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const m = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  // Rejects impossible dates like 2026-02-31, which Date would roll forward.
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

/**
 * Today's calendar day at UTC midnight, on the same scale as toUtcMidnight().
 */
function utcToday() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// The applicant picks a date on *their* calendar, but we compare against the
// server's UTC calendar, and the two disagree by up to a day in either
// direction (UTC-12 .. UTC+14). A student in UTC-5 applying at 20:00 on the
// 14th is picking "14th" while the server has already rolled over to the 15th,
// so a strict `from >= utcToday()` would reject their own today as "the past".
// One day of slack makes that impossible for every timezone on earth, while
// still rejecting anything genuinely historical.
const PAST_DATE_GRACE_DAYS = 1;

async function resolveOwnActiveEnrollmentId(actor) {
  const student = await Student.findOne({ profileId: actor.profileId, deletedAt: null }).select('_id').lean();
  if (!student) throw new AppError('No student record linked to this account', 404);

  const enrollment = await Enrollment.findOne({ studentId: student._id, status: 'ACTIVE' }).select('_id').lean();
  if (!enrollment) throw new AppError('No active enrollment found', 404);

  return enrollment._id.toString();
}

export async function apply(actor, { fromDate, toDate, reason }) {
  if (!fromDate || !toDate) throw new AppError('fromDate and toDate are required', 400);
  if (!reason || !reason.trim()) throw new AppError('reason is required', 400);

  // Normalised to UTC midnight so a leave day is the same calendar day for
  // everyone. `new Date('2026-08-15T00:00:00+05:30')` would otherwise store
  // 14 Aug 18:30Z and the leave would show up on the wrong day.
  const from = toUtcMidnight(fromDate);
  const to = toUtcMidnight(toDate);
  if (!from || !to) throw new AppError('Invalid date format — use YYYY-MM-DD', 400);
  if (to < from) throw new AppError('toDate cannot be before fromDate', 400);

  const earliest = new Date(utcToday().getTime() - PAST_DATE_GRACE_DAYS * 24 * 60 * 60 * 1000);
  if (from < earliest) {
    throw new AppError('Leave cannot be applied for a date in the past', 400, [], 'LEAVE_DATE_IN_PAST');
  }

  const enrollmentId = await resolveOwnActiveEnrollmentId(actor);

  const application = await LeaveApplication.create({
    enrollmentId,
    fromDate: from,
    toDate: to,
    reason: reason.trim(),
  });

  return application;
}

export async function listMine(actor, opts = {}) {
  const enrollmentId = await resolveOwnActiveEnrollmentId(actor);
  const filter = { enrollmentId };
  return paginate(
    LeaveApplication.find(filter).sort({ createdAt: -1 }).lean(),
    LeaveApplication,
    filter,
    { page: opts.page, pageSize: opts.pageSize, label: 'leave.listMine' }
  );
}
