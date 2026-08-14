import { LeaveApplication } from '../../models/leaveApplication.model.js';
import { TeacherLeave } from '../../models/teacherLeave.model.js';
import { Student, Enrollment } from '../../models/student.model.js';
import { Notification } from '../../models/notification.model.js';
import { AppError } from '../../utils/AppError.js';

/** Roles treated as staff — they use TeacherLeave instead of LeaveApplication. */
const STAFF_ROLES = new Set(['TEACHER', 'LIBRARIAN', 'WARDEN', 'FINANCE', 'PRINCIPAL']);

function _formatTeacherLeave(leave) {
  return {
    _id: leave._id.toString(),
    id: leave._id.toString(),
    profileId: leave.profileId?.toString() ?? null,
    applicantName: leave.applicantName,
    role: leave.role,
    fromDate: leave.fromDate,
    toDate: leave.toDate,
    reason: leave.reason,
    leaveType: leave.leaveType,
    status: leave.status,
    remarks: leave.remarks ?? null,
    reviewedAt: leave.reviewedAt ?? null,
    createdAt: leave.createdAt,
  };
}

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

export async function apply(actor, { fromDate, toDate, reason, leaveType }) {
  if (!fromDate || !toDate) throw new AppError('fromDate and toDate are required', 400);
  if (!reason || !reason.trim()) throw new AppError('reason is required', 400);

  const from = toUtcMidnight(fromDate);
  const to = toUtcMidnight(toDate);
  if (!from || !to) throw new AppError('Invalid date format — use YYYY-MM-DD', 400);
  if (to < from) throw new AppError('toDate cannot be before fromDate', 400);

  const validLeaveTypes = ['SICK', 'CASUAL', 'PERSONAL', 'DUTY', 'EARNED', 'OTHER'];
  const finalLeaveType = validLeaveTypes.includes(leaveType) ? leaveType : 'CASUAL';

  // Staff roles (teachers, etc.) use TeacherLeave keyed by profileId.
  if (STAFF_ROLES.has(actor.roleKey)) {
    const leave = await TeacherLeave.create({
      profileId: actor.profileId,
      applicantName: actor.displayName ?? actor.email ?? 'Staff',
      role: actor.roleKey,
      fromDate: from,
      toDate: to,
      reason: reason.trim(),
      leaveType: finalLeaveType,
    });
    return _formatTeacherLeave(leave);
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

export async function listMine(actor) {
  if (STAFF_ROLES.has(actor.roleKey)) {
    const leaves = await TeacherLeave.find({ profileId: actor.profileId })
      .sort({ createdAt: -1 })
      .lean();
    return leaves.map(_formatTeacherLeave);
  }

  const enrollmentId = await resolveOwnActiveEnrollmentId(actor);
  return LeaveApplication.find({ enrollmentId }).sort({ createdAt: -1 }).lean();
}

/**
 * List all student leave applications — for warden/admin review.
 */
export async function listAll({ status } = {}) {
  const filter = {};
  if (status) filter.status = status;

  const applications = await LeaveApplication.find(filter)
    .sort({ createdAt: -1 })
    .limit(500)
    .populate({
      path: 'enrollmentId',
      select: 'studentId sectionId rollNo',
      populate: [
        { path: 'studentId', select: 'firstName lastName admissionNo' },
        { path: 'sectionId', select: 'name', populate: { path: 'gradeId', select: 'name' } },
      ],
    })
    .lean();

  return applications.map((a) => {
    const enrollment = a.enrollmentId;
    const student = enrollment?.studentId;
    const section = enrollment?.sectionId;
    const grade = section?.gradeId;
    return {
      id: a._id.toString(),
      _id: a._id.toString(),
      enrollmentId: enrollment?._id?.toString() ?? null,
      studentName: student ? `${student.firstName} ${student.lastName ?? ''}`.trim() : '—',
      admissionNo: student?.admissionNo ?? '—',
      class: grade ? `${grade.name} ${section.name}` : (section?.name ?? '—'),
      fromDate: a.fromDate,
      toDate: a.toDate,
      reason: a.reason,
      status: a.status,
      remarks: a.remarks ?? null,
      reviewedAt: a.reviewedAt ?? null,
      createdAt: a.createdAt,
    };
  });
}

/**
 * Approve or reject a student leave application.
 */
export async function review(id, { status, remarks, reviewerProfileId }) {
  if (!['APPROVED', 'REJECTED'].includes(status)) {
    throw new AppError('status must be APPROVED or REJECTED', 400);
  }
  const application = await LeaveApplication.findById(id);
  if (!application) throw new AppError('Leave application not found', 404);
  if (application.status !== 'PENDING') {
    throw new AppError(`Application is already ${application.status.toLowerCase()}`, 409);
  }
  application.status = status;
  application.remarks = remarks?.trim() ?? null;
  application.reviewedByProfileId = reviewerProfileId ?? null;
  application.reviewedAt = new Date();
  await application.save();
  return {
    id: application._id.toString(),
    _id: application._id.toString(),
    enrollmentId: application.enrollmentId.toString(),
    fromDate: application.fromDate,
    toDate: application.toDate,
    reason: application.reason,
    status: application.status,
    remarks: application.remarks,
    reviewedAt: application.reviewedAt,
    createdAt: application.createdAt,
  };
}

/**
 * List all staff leave applications — for admin/principal review.
 */
export async function listAllStaff({ status } = {}) {
  const filter = {};
  if (status) filter.status = status;
  const leaves = await TeacherLeave.find(filter).sort({ createdAt: -1 }).limit(500).lean();
  return leaves.map(_formatTeacherLeave);
}

/**
 * Approve or reject a staff leave application.
 */
export async function reviewStaff(id, { status, remarks, reviewerProfileId }) {
  if (!['APPROVED', 'REJECTED'].includes(status)) {
    throw new AppError('status must be APPROVED or REJECTED', 400);
  }
  const leave = await TeacherLeave.findById(id);
  if (!leave) throw new AppError('Staff leave application not found', 404);
  if (leave.status !== 'PENDING') {
    throw new AppError(`Application is already ${leave.status.toLowerCase()}`, 409);
  }
  leave.status = status;
  leave.remarks = remarks?.trim() ?? null;
  leave.reviewedByProfileId = reviewerProfileId ?? null;
  leave.reviewedAt = new Date();
  await leave.save();

  // Notify applicant
  try {
    await Notification.create({
      recipientProfileId: leave.profileId,
      type: 'LEAVE',
      title: `Leave Application ${status}`,
      body: `Your leave request for ${leave.fromDate.toISOString().slice(0, 10)} to ${leave.toDate.toISOString().slice(0, 10)} was ${status.toLowerCase()}.${leave.remarks ? ` Remarks: ${leave.remarks}` : ''}`,
      link: '/teacher/leave',
    });
  } catch (_) { /* non-blocking */ }

  return _formatTeacherLeave(leave);
}
