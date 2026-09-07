import { ProfileEditRequest } from '../../models/profileEditRequest.model.js';
import { Student } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { notify } from '../notifications/notification.service.js';
import {
  applyReviewScope, assertMayReview, classLabelFor, cleanText,
  normaliseAttachment, resolveReadTarget, resolveStudentContext,
} from './shared.js';

/**
 * The profile fields a student may ask to have corrected.
 *
 * An allow-list, not a deny-list: admission number, class, roll number and
 * enrolment status are the school's own record of who this person is, and a
 * request form must not be able to reach them even by accident. Everything
 * outside this map is dropped before anything is written.
 */
const EDITABLE_FIELDS = {
  firstName: { label: 'First name', max: 80, required: true },
  lastName: { label: 'Last name', max: 80 },
  dob: { label: 'Date of birth', type: 'date' },
  gender: { label: 'Gender', max: 40 },
  address: { label: 'Address', max: 500 },
};

export const EDITABLE_FIELD_LIST = Object.entries(EDITABLE_FIELDS).map(([field, cfg]) => ({
  field,
  label: cfg.label,
  type: cfg.type ?? 'text',
  required: Boolean(cfg.required),
}));

const toDto = (doc, extra = {}) => ({
  id: doc._id.toString(),
  studentId: doc.studentId?._id?.toString() ?? doc.studentId?.toString() ?? null,
  studentName: doc.studentId?.firstName
    ? `${doc.studentId.firstName} ${doc.studentId.lastName ?? ''}`.trim()
    : null,
  admissionNo: doc.studentId?.admissionNo ?? null,
  changes: (doc.changes ?? []).map((c) => ({
    field: c.field, label: c.label, oldValue: c.oldValue ?? null, newValue: c.newValue ?? null,
  })),
  note: doc.note ?? null,
  documentUrl: doc.documentUrl ?? null,
  documentName: doc.documentName ?? null,
  status: doc.status,
  rejectionReason: doc.rejectionReason ?? null,
  requestedAt: (doc.requestedAt ?? doc.createdAt)?.toISOString() ?? null,
  reviewedBy: doc.reviewedByProfileId?.displayName ?? null,
  reviewedAt: doc.reviewedAt ? doc.reviewedAt.toISOString() : null,
  ...extra,
});

/** Renders a stored value the same way both sides of the diff are compared. */
function currentValue(student, field) {
  const raw = student[field];
  if (raw == null || raw === '') return null;
  if (EDITABLE_FIELDS[field]?.type === 'date') {
    const d = raw instanceof Date ? raw : new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return String(raw);
}

/** Parses a submitted value for one field, or throws if it is not usable. */
function parseValue(field, value) {
  const cfg = EDITABLE_FIELDS[field];
  if (cfg.type === 'date') {
    const text = cleanText(value, 40);
    if (!text) return null;
    const m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) throw new AppError(`${cfg.label} must be a date in YYYY-MM-DD form`, 400);
    const [, y, mo, d] = m.map(Number);
    const parsed = new Date(Date.UTC(y, mo - 1, d));
    if (parsed.getUTCMonth() !== mo - 1 || parsed.getUTCDate() !== d) {
      throw new AppError(`${cfg.label} is not a real date`, 400);
    }
    if (parsed > new Date()) throw new AppError(`${cfg.label} cannot be in the future`, 400);
    return parsed.toISOString().slice(0, 10);
  }
  return cleanText(value, cfg.max ?? 200);
}

/**
 * Student submits a correction request.
 *
 * Only fields that actually differ from the record are stored: submitting the
 * form unchanged is a no-op the reviewer never sees, and the stored diff is
 * exactly what a decision applies.
 */
export async function request(actor, body = {}) {
  const { student, enrollment } = await resolveStudentContext(actor);

  const pending = await ProfileEditRequest.findOne({ studentId: student._id, status: 'PENDING' }).lean();
  if (pending) {
    throw new AppError(
      'You already have a profile edit request awaiting review. Withdraw it before raising another.',
      409, [], 'REQUEST_PENDING'
    );
  }

  const submitted = body.changes ?? body.fields ?? {};
  const changes = [];
  for (const [field, cfg] of Object.entries(EDITABLE_FIELDS)) {
    if (!(field in submitted)) continue;
    const newValue = parseValue(field, submitted[field]);
    if (cfg.required && !newValue) throw new AppError(`${cfg.label} cannot be emptied`, 400);
    const oldValue = currentValue(student, field);
    if ((newValue ?? '') === (oldValue ?? '')) continue;
    changes.push({ field, label: cfg.label, oldValue, newValue });
  }

  if (changes.length === 0) {
    throw new AppError('Nothing has been changed — edit a field before submitting.', 400, [], 'NO_CHANGES');
  }

  const attachment = normaliseAttachment(body);

  const created = await ProfileEditRequest.create({
    studentId: student._id,
    enrollmentId: enrollment?._id ?? null,
    sectionId: enrollment?.sectionId ?? null,
    changes,
    note: cleanText(body.note, 1000),
    ...attachment,
    status: 'PENDING',
    requestedByProfileId: actor.profileId,
    requestedAt: new Date(),
  });

  await recordAudit({
    actor,
    action: 'profile_edit.requested',
    entityType: 'ProfileEditRequest',
    entityId: created._id,
    after: { fields: changes.map((c) => c.field), status: 'PENDING' },
  });

  return toDto(created);
}

export async function listMine(actor, scope, { studentId } = {}) {
  const target = await resolveReadTarget(actor, scope, studentId);
  const filter = {};
  if (target.studentId) filter.studentId = target.studentId;
  else if (target.studentIds) filter.studentId = { $in: target.studentIds };

  const rows = await ProfileEditRequest.find(filter)
    .sort({ createdAt: -1 })
    .populate('studentId', 'firstName lastName admissionNo')
    .populate('reviewedByProfileId', 'displayName')
    .limit(100);

  return rows.map((r) => toDto(r));
}

export async function listForReview(actor, scope, { status = 'PENDING' } = {}) {
  let filter = {};
  if (status && status !== 'ALL') filter.status = status;
  filter = await applyReviewScope(actor, scope, filter);

  const rows = await ProfileEditRequest.find(filter)
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

/**
 * Class teacher decides. Approval is the only path by which any of this
 * reaches the Student document, and it writes exactly the stored diff — not
 * whatever the client last sent.
 */
export async function decide(actor, scope, id, { status, rejectionReason } = {}) {
  if (!['APPROVED', 'REJECTED'].includes(status)) {
    throw new AppError('status must be APPROVED or REJECTED', 400);
  }

  const doc = await ProfileEditRequest.findById(id);
  if (!doc) throw new AppError('Request not found', 404);
  if (doc.status !== 'PENDING') {
    throw new AppError(`This request was already ${doc.status.toLowerCase()}`, 409, [], 'ALREADY_DECIDED');
  }

  await assertMayReview(actor, scope, doc.sectionId);

  const reason = cleanText(rejectionReason, 500);
  if (status === 'REJECTED' && !reason) {
    throw new AppError('A reason is required when rejecting a request', 400, [], 'REASON_REQUIRED');
  }

  const student = await Student.findById(doc.studentId);
  if (!student) throw new AppError('Student record not found', 404);

  const before = {};
  const after = {};
  if (status === 'APPROVED') {
    for (const change of doc.changes) {
      const cfg = EDITABLE_FIELDS[change.field];
      if (!cfg) continue; // the allow-list may have narrowed since the request
      before[change.field] = currentValue(student, change.field);
      if (cfg.type === 'date') {
        student[change.field] = change.newValue ? new Date(`${change.newValue}T00:00:00.000Z`) : null;
      } else {
        student[change.field] = change.newValue ?? null;
      }
      after[change.field] = change.newValue ?? null;
    }
    await student.save();
  }

  doc.status = status;
  doc.reviewedByProfileId = actor.profileId;
  doc.reviewedAt = new Date();
  doc.rejectionReason = status === 'REJECTED' ? reason : null;
  await doc.save();

  await recordAudit({
    actor,
    action: `profile_edit.${status.toLowerCase()}`,
    entityType: 'ProfileEditRequest',
    entityId: doc._id,
    before: status === 'APPROVED' ? before : { status: 'PENDING' },
    after: status === 'APPROVED' ? after : { status, reason: doc.rejectionReason },
  });

  if (student.profileId) {
    await notify({
      recipientProfileIds: [student.profileId],
      type: 'PROFILE_EDIT',
      title: status === 'APPROVED'
        ? 'Your profile changes were approved'
        : 'Your profile edit request was not approved',
      body: doc.rejectionReason ?? undefined,
      link: '/student/profile',
      meta: { requestId: doc._id.toString(), status },
    });
  }

  return toDto(doc);
}

export async function withdraw(actor, id) {
  const { student } = await resolveStudentContext(actor);
  const doc = await ProfileEditRequest.findById(id);
  if (!doc || String(doc.studentId) !== String(student._id)) throw new AppError('Request not found', 404);
  if (doc.status !== 'PENDING') {
    throw new AppError('Only a pending request can be withdrawn', 409, [], 'ALREADY_DECIDED');
  }
  await doc.deleteOne();
}
