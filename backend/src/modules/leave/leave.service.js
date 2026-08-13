import { LeaveApplication } from '../../models/leaveApplication.model.js';
import { Student, Enrollment } from '../../models/student.model.js';
import { Notification } from '../../models/notification.model.js';
import { AppError } from '../../utils/AppError.js';

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

export async function apply(actor, { leaveType, fromDate, toDate, reason }) {
  if (!fromDate || !toDate) throw new AppError('fromDate and toDate are required', 400);
  if (!reason || !reason.trim()) throw new AppError('reason is required', 400);

  const from = toUtcMidnight(fromDate);
  const to = toUtcMidnight(toDate);
  if (!from || !to) throw new AppError('Invalid date format — use YYYY-MM-DD', 400);
  if (to < from) throw new AppError('toDate cannot be before fromDate', 400);

  const validLeaveTypes = ['SICK', 'CASUAL', 'PERSONAL', 'DUTY', 'OTHER'];
  const finalLeaveType = validLeaveTypes.includes(leaveType) ? leaveType : 'CASUAL';

  let enrollmentId = null;
  let applicantRole = 'TEACHER';

  if (actor.roleKey === 'STUDENT' || actor.roleKey === 'PARENT') {
    applicantRole = 'STUDENT';
    const student = await Student.findOne({ profileId: actor.profileId, deletedAt: null }).select('_id').lean();
    if (student) {
      const enrollment = await Enrollment.findOne({ studentId: student._id, status: 'ACTIVE' }).select('_id').lean();
      if (enrollment) enrollmentId = enrollment._id;
    }
  }

  const application = await LeaveApplication.create({
    applicantProfileId: actor.profileId,
    applicantRole,
    enrollmentId,
    leaveType: finalLeaveType,
    fromDate: from,
    toDate: to,
    reason: reason.trim(),
  });

  return dto(application);
}

export async function listMine(actor) {
  const filter = {
    $or: [{ applicantProfileId: actor.profileId }],
  };

  const student = await Student.findOne({ profileId: actor.profileId, deletedAt: null }).select('_id').lean();
  if (student) {
    const enrollments = await Enrollment.find({ studentId: student._id }).select('_id').lean();
    if (enrollments.length) {
      filter.$or.push({ enrollmentId: { $in: enrollments.map((e) => e._id) } });
    }
  }

  const apps = await LeaveApplication.find(filter)
    .populate('reviewedByProfileId', 'displayName')
    .sort({ createdAt: -1 })
    .lean();

  return apps.map(dto);
}
export async function listAll(actor, scope, query = {}) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.role) filter.applicantRole = query.role;

  const apps = await LeaveApplication.find(filter)
    .populate('applicantProfileId', 'displayName')
    .populate({
      path: 'enrollmentId',
      populate: [
        { path: 'studentId', select: 'firstName lastName admissionNo' },
        { path: 'sectionId', populate: { path: 'gradeId', select: 'name' } },
      ],
    })
    .populate('reviewedByProfileId', 'displayName')
    .sort({ createdAt: -1 })
    .lean();

  return apps.map(dto);
}

export async function review(actor, id, { status, remarks }) {
  if (!['APPROVED', 'REJECTED'].includes(status)) {
    throw new AppError('status must be APPROVED or REJECTED', 400);
  }

  const application = await LeaveApplication.findById(id);
  if (!application) throw new AppError('Leave application not found', 404);

  if (application.applicantProfileId?.toString() === actor.profileId) {
    throw new AppError('You cannot review your own leave application', 403);
  }

  if (application.status !== 'PENDING') {
    throw new AppError(`Leave application has already been ${application.status.toLowerCase()}`, 400);
  }

  application.status = status;
  application.reviewedByProfileId = actor.profileId;
  application.reviewedAt = new Date();
  application.remarks = remarks?.trim() ?? null;
  await application.save();

  if (application.applicantProfileId) {
    try {
      await Notification.create({
        recipientProfileId: application.applicantProfileId,
        type: 'LEAVE',
        title: `Leave Application ${status}`,
        body: `Your leave request for ${application.fromDate.toISOString().slice(0, 10)} to ${application.toDate.toISOString().slice(0, 10)} was ${status.toLowerCase()}.${application.remarks ? ` Remarks: ${application.remarks}` : ''}`,
        link: application.applicantRole === 'TEACHER' ? '/teacher/leave' : '/student/attendance',
      });
    } catch (e) {
      // Ignore notification creation error
    }
  }

  const updated = await LeaveApplication.findById(id)
    .populate('applicantProfileId', 'displayName')
    .populate('reviewedByProfileId', 'displayName')
    .lean();

  return dto(updated);
}

function dto(app) {
  const student = app.enrollmentId?.studentId;
  const section = app.enrollmentId?.sectionId;
  const className = section
    ? `${section.gradeId?.name ?? ''} ${section.name ?? ''}`.trim()
    : null;

  const studentName = student ? `${student.firstName} ${student.lastName ?? ''}`.trim() : null;
  const applicantName = app.applicantProfileId?.displayName ?? studentName ?? 'Applicant';

  return {
    id: app._id,
    applicantProfileId: app.applicantProfileId?._id ?? app.applicantProfileId ?? null,
    applicantName,
    applicantRole: app.applicantRole ?? 'STUDENT',
    enrollmentId: app.enrollmentId?._id ?? app.enrollmentId ?? null,
    studentName,
    class: className,
    leaveType: app.leaveType ?? 'CASUAL',
    fromDate: app.fromDate,
    toDate: app.toDate,
    reason: app.reason,
    status: app.status,
    reviewedByProfileId: app.reviewedByProfileId?._id ?? app.reviewedByProfileId ?? null,
    reviewedByName: app.reviewedByProfileId?.displayName ?? null,
    reviewedAt: app.reviewedAt,
    remarks: app.remarks ?? null,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  };
}
