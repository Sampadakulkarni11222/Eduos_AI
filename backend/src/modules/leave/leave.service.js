import { LeaveApplication } from '../../models/leaveApplication.model.js';
import { Student, Enrollment } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';

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

  const enrollmentId = await resolveOwnActiveEnrollmentId(actor);

  const application = await LeaveApplication.create({
    enrollmentId,
    fromDate: from,
    toDate: to,
    reason: reason.trim(),
  });

  return application;
}

export async function listMine(actor) {
  const enrollmentId = await resolveOwnActiveEnrollmentId(actor);
  return LeaveApplication.find({ enrollmentId }).sort({ createdAt: -1 }).lean();
}

export async function review(actor, id, { status, remarks } = {}) {
  if (!['APPROVED', 'REJECTED'].includes(status)) {
    throw new AppError('status must be APPROVED or REJECTED', 400);
  }
  const app = await LeaveApplication.findById(id);
  if (!app) throw new AppError('Leave application not found', 404);
  app.status = status;
  app.reviewedByProfileId = actor.profileId ?? null;
  app.reviewedAt = new Date();
  if (remarks) app.remarks = String(remarks).trim();
  await app.save();
  return app;
}
