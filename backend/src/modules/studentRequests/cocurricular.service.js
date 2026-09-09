import { CoCurricularActivity } from '../../models/coCurricular.model.js';
import { Student } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { notify } from '../notifications/notification.service.js';
import {
  applyReviewScope, assertMayReview, classLabelFor, cleanText,
  normaliseAttachment, resolveReadTarget, resolveStudentContext,
} from './shared.js';

const CATEGORIES = ['SPORTS', 'ARTS', 'MUSIC', 'DANCE', 'DRAMA', 'LITERARY', 'SCIENCE', 'SOCIAL_SERVICE', 'LEADERSHIP', 'CLUB', 'OTHER'];
const LEVELS = ['SCHOOL', 'INTER_SCHOOL', 'DISTRICT', 'STATE', 'NATIONAL', 'INTERNATIONAL', 'OTHER'];

const toDto = (doc, extra = {}) => ({
  id: doc._id.toString(),
  studentId: doc.studentId?._id?.toString() ?? doc.studentId?.toString() ?? null,
  studentName: doc.studentId?.firstName
    ? `${doc.studentId.firstName} ${doc.studentId.lastName ?? ''}`.trim()
    : null,
  admissionNo: doc.studentId?.admissionNo ?? null,
  name: doc.name,
  category: doc.category,
  description: doc.description ?? null,
  activityDate: doc.activityDate ? doc.activityDate.toISOString() : null,
  achievement: doc.achievement ?? null,
  level: doc.level,
  documentUrl: doc.documentUrl ?? null,
  documentName: doc.documentName ?? null,
  status: doc.status,
  rejectionReason: doc.rejectionReason ?? null,
  reviewedBy: doc.reviewedByProfileId?.displayName ?? null,
  reviewedAt: doc.reviewedAt ? doc.reviewedAt.toISOString() : null,
  requestedAt: doc.createdAt ? doc.createdAt.toISOString() : null,
  ...extra,
});

/**
 * A calendar date, parsed at UTC midnight.
 *
 * An activity happened on a day, not at an instant; letting the browser's
 * offset through would file a 15 August prize-giving under the 14th for
 * anyone east of Greenwich.
 */
function toUtcMidnight(value) {
  const m = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

/** Student raises a request. It is never created already-approved. */
export async function request(actor, body = {}) {
  const { student, enrollment } = await resolveStudentContext(actor);

  const name = cleanText(body.name, 160);
  if (!name) throw new AppError('Activity name is required', 400);

  const activityDate = toUtcMidnight(body.activityDate ?? body.date);
  if (!activityDate) throw new AppError('A valid activity date (YYYY-MM-DD) is required', 400);
  // A record of something that has not happened yet is not an achievement.
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (activityDate > tomorrow) throw new AppError('Activity date cannot be in the future', 400);

  const category = CATEGORIES.includes(body.category) ? body.category : 'OTHER';
  const level = LEVELS.includes(body.level) ? body.level : 'SCHOOL';
  const attachment = normaliseAttachment(body);

  const created = await CoCurricularActivity.create({
    studentId: student._id,
    enrollmentId: enrollment?._id ?? null,
    sectionId: enrollment?.sectionId ?? null,
    academicYearId: enrollment?.academicYearId ?? null,
    name,
    category,
    level,
    description: cleanText(body.description, 2000),
    achievement: cleanText(body.achievement, 500),
    activityDate,
    ...attachment,
    status: 'PENDING',
    requestedByProfileId: actor.profileId,
  });

  await recordAudit({
    actor,
    action: 'cocurricular.requested',
    entityType: 'CoCurricularActivity',
    entityId: created._id,
    after: { name, category, status: 'PENDING' },
  });

  return toDto(created);
}

/**
 * The activities on a student's record.
 *
 * Every state is returned by default for the student themselves — they need to
 * see their own pending and rejected requests, not only what got through.
 */
export async function listForStudent(actor, scope, { studentId, status } = {}) {
  const target = await resolveReadTarget(actor, scope, studentId);

  const filter = {};
  if (target.studentId) filter.studentId = target.studentId;
  else if (target.studentIds) filter.studentId = { $in: target.studentIds };
  if (status && status !== 'ALL') filter.status = status;

  const rows = await CoCurricularActivity.find(filter)
    .sort({ activityDate: -1, createdAt: -1 })
    .populate('studentId', 'firstName lastName admissionNo')
    .populate('reviewedByProfileId', 'displayName')
    .limit(300);

  return rows.map((r) => toDto(r));
}

/** The class teacher's review queue. */
export async function listForReview(actor, scope, { status = 'PENDING' } = {}) {
  let filter = {};
  if (status && status !== 'ALL') filter.status = status;
  filter = await applyReviewScope(actor, scope, filter);

  const rows = await CoCurricularActivity.find(filter)
    .sort({ createdAt: -1 })
    .populate('studentId', 'firstName lastName admissionNo')
    .populate('reviewedByProfileId', 'displayName')
    .limit(300);

  const classLabels = new Map();
  const out = [];
  for (const r of rows) {
    const key = String(r.sectionId ?? '');
    if (!classLabels.has(key)) classLabels.set(key, await classLabelFor(r.sectionId));
    out.push(toDto(r, { class: classLabels.get(key) }));
  }
  return out;
}

/** Class teacher approves or rejects. Approval is what puts it on the profile. */
export async function decide(actor, scope, id, { status, rejectionReason } = {}) {
  if (!['APPROVED', 'REJECTED'].includes(status)) {
    throw new AppError('status must be APPROVED or REJECTED', 400);
  }

  const doc = await CoCurricularActivity.findById(id);
  if (!doc) throw new AppError('Request not found', 404);
  if (doc.status !== 'PENDING') {
    throw new AppError(`This request was already ${doc.status.toLowerCase()}`, 409, [], 'ALREADY_DECIDED');
  }

  await assertMayReview(actor, scope, doc.sectionId);

  const reason = cleanText(rejectionReason, 500);
  if (status === 'REJECTED' && !reason) {
    throw new AppError('A reason is required when rejecting a request', 400, [], 'REASON_REQUIRED');
  }

  doc.status = status;
  doc.reviewedByProfileId = actor.profileId;
  doc.reviewedAt = new Date();
  doc.rejectionReason = status === 'REJECTED' ? reason : null;
  await doc.save();

  await recordAudit({
    actor,
    action: `cocurricular.${status.toLowerCase()}`,
    entityType: 'CoCurricularActivity',
    entityId: doc._id,
    before: { status: 'PENDING' },
    after: { status, reason: doc.rejectionReason },
  });

  const student = await Student.findById(doc.studentId).select('profileId').lean();
  if (student?.profileId) {
    await notify({
      recipientProfileIds: [student.profileId],
      type: 'COCURRICULAR',
      title: status === 'APPROVED'
        ? `"${doc.name}" was added to your profile`
        : `Your request for "${doc.name}" was not approved`,
      body: doc.rejectionReason ?? undefined,
      link: '/student/profile',
      meta: { activityId: doc._id.toString(), status },
    });
  }

  return toDto(doc);
}

/** A student may take back a request that has not been decided yet. */
export async function withdraw(actor, id) {
  const { student } = await resolveStudentContext(actor);
  const doc = await CoCurricularActivity.findById(id);
  if (!doc || String(doc.studentId) !== String(student._id)) throw new AppError('Request not found', 404);
  if (doc.status !== 'PENDING') {
    throw new AppError('Only a pending request can be withdrawn', 409, [], 'ALREADY_DECIDED');
  }
  await doc.deleteOne();
}
