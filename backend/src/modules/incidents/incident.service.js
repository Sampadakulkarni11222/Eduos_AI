import { IncidentReport } from '../../models/incident.model.js';
import { Student, Enrollment } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';

const ALLOWED_TYPES = ['BEHAVIOUR', 'BULLYING', 'ATTENDANCE_RELATED', 'PROPERTY_DAMAGE', 'SAFETY', 'OTHER'];
const ALLOWED_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'];
const ALLOWED_STATUSES = ['OPEN', 'REVIEWED', 'CLOSED'];

function toUtcMidnight(value) {
  const m = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

/**
 * Create a new incident report.
 * The reporter is always the authenticated profile; only the provided studentId
 * is taken from the request body.
 */
export async function createIncident(actor, { studentId, date, type, severity, description, actionTaken }) {
  if (!studentId) throw new AppError('studentId is required', 400);
  if (!date) throw new AppError('date is required', 400);
  if (!type || !ALLOWED_TYPES.includes(type))
    throw new AppError(`type must be one of: ${ALLOWED_TYPES.join(', ')}`, 400);
  if (!severity || !ALLOWED_SEVERITIES.includes(severity))
    throw new AppError(`severity must be one of: ${ALLOWED_SEVERITIES.join(', ')}`, 400);
  if (!description || !description.trim()) throw new AppError('description is required', 400);

  const parsedDate = toUtcMidnight(date);
  if (!parsedDate) throw new AppError('Invalid date format — use YYYY-MM-DD', 400);

  // Verify student exists and is not deleted
  const student = await Student.findOne({ _id: studentId, deletedAt: null }).select('_id').lean();
  if (!student) throw new AppError('Student not found', 404);

  // Resolve the student's active enrollment (for section context) — optional but useful
  const enrollment = await Enrollment.findOne({ studentId: student._id, status: 'ACTIVE' })
    .select('_id')
    .lean();

  const report = await IncidentReport.create({
    studentId: student._id,
    enrollmentId: enrollment?._id ?? null,
    reportedByProfileId: actor.profileId,
    date: parsedDate,
    type,
    severity,
    description: description.trim(),
    actionTaken: actionTaken?.trim() ?? null,
  });

  return toDto(report);
}

/**
 * List incident reports.
 * OWN scope: only reports filed by the authenticated profile.
 * ALL scope: all reports (with optional studentId filter).
 */
export async function listIncidents(actor, scope, { studentId, status } = {}) {
  const filter = {};

  if (scope === 'OWN') {
    filter.reportedByProfileId = actor.profileId;
  }

  if (studentId) filter.studentId = studentId;
  if (status && ALLOWED_STATUSES.includes(status)) filter.status = status;

  const reports = await IncidentReport.find(filter)
    .populate({ path: 'studentId', select: 'firstName lastName admissionNo' })
    .populate({ path: 'reportedByProfileId', select: 'displayName' })
    .populate({ path: 'reviewedByProfileId', select: 'displayName' })
    .sort({ createdAt: -1 })
    .lean();

  return reports.map(toDto);
}

/**
 * Update an incident report's status, actionTaken, or reviewedBy.
 * Only callers with ALL scope (admin, principal) may do this.
 */
export async function updateIncident(actor, id, { status, actionTaken }) {
  const report = await IncidentReport.findById(id);
  if (!report) throw new AppError('Incident report not found', 404);

  if (status !== undefined) {
    if (!ALLOWED_STATUSES.includes(status))
      throw new AppError(`status must be one of: ${ALLOWED_STATUSES.join(', ')}`, 400);
    report.status = status;
  }

  if (actionTaken !== undefined) {
    report.actionTaken = actionTaken?.trim() ?? null;
  }

  if (status === 'REVIEWED' || status === 'CLOSED') {
    report.reviewedByProfileId = actor.profileId;
    report.reviewedAt = new Date();
  }

  await report.save();
  return toDto(report);
}

function toDto(r) {
  const student = r.studentId;
  const reporter = r.reportedByProfileId;
  const reviewer = r.reviewedByProfileId;

  return {
    id: r._id,
    studentId: student?._id ?? r.studentId,
    studentName: student ? `${student.firstName} ${student.lastName ?? ''}`.trim() : null,
    admissionNo: student?.admissionNo ?? null,
    reportedByProfileId: reporter?._id ?? r.reportedByProfileId,
    reportedByName: reporter?.displayName ?? null,
    date: r.date,
    type: r.type,
    severity: r.severity,
    description: r.description,
    actionTaken: r.actionTaken ?? null,
    status: r.status,
    reviewedByProfileId: reviewer?._id ?? r.reviewedByProfileId,
    reviewedByName: reviewer?.displayName ?? null,
    reviewedAt: r.reviewedAt ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
