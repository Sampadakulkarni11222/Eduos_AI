import { LeaveApplication } from '../../models/leaveApplication.model.js';
import { Student, Enrollment } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';

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

  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) throw new AppError('Invalid date format', 400);
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
