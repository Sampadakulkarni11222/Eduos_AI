import { open, stat } from 'fs/promises';
import { resolve, sep } from 'path';
import { DocumentType, DocumentRequest } from '../../models/documentRequest.model.js';
import { Upload } from '../../models/upload.model.js';
import { Role } from '../../models/role.model.js';
import { Profile } from '../../models/profile.model.js';
import { Student } from '../../models/student.model.js';
import { Section } from '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import { env } from '../../config/env.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { notify } from '../notifications/notification.service.js';
import { resolveStudentContext } from '../studentRequests/shared.js';
import {
  assertObjectId, optionalText, requiredText, cleanRequestData, cleanRequiredBy, detectFileType, escapeRegex,
} from './documentRequest.validation.js';
import { assertSchoolContext } from './schoolContext.js';
// Registered for populate.
import '../../models/academics.model.js';

/**
 * Student document requests: a student asks for a document of some
 * configured type, the school office reviews, approves or rejects it, uploads
 * the official file, and the student downloads it.
 *
 * The workflow is the same for every document type — nothing here branches
 * on which type a request is for.
 *
 *   PENDING ──► UNDER_REVIEW ──► APPROVED ──► READY ──► COMPLETED
 *      │             │                          ▲  │         │
 *      │             └──► REJECTED              └──┘◄────────┘  (new version)
 *      ├──► REJECTED
 *      ├──► APPROVED (review is optional)
 *      └──► CANCELLED (by the student)
 *
 * READY becomes COMPLETED on the student's first successful download.
 * Replacing the file of a COMPLETED request re-opens it as READY, so the
 * student is told there is a newer version to collect.
 *
 * Every change of status is a single conditional update on the status the
 * transition starts from, so two people acting at once cannot both succeed
 * and a transition that is not allowed simply matches nothing.
 *
 * Isolation: both collections are tenant-scoped, students are confined to
 * their own student record, and issued files are only ever served by this
 * module after those checks — their storage path is never returned.
 */

const ISSUED_STATUSES = ['READY', 'COMPLETED'];
const notFound = () => new AppError('Document request not found', 404, [], 'DOCUMENT_REQUEST_NOT_FOUND');
const uploadDir = () => resolve(process.cwd(), env.UPLOAD_DIR);
const iso = (d) => (d ? new Date(d).toISOString() : null);

/* ── DTOs ────────────────────────────────────────────────────── */

function fileDto(f, { withUploader = false } = {}) {
  return {
    version: f.version,
    fileName: f.originalName ?? `document-v${f.version}`,
    mimeType: f.mimeType,
    size: f.size,
    uploadedAt: iso(f.uploadedAt),
    remarks: f.remarks ?? null,
    ...(withUploader ? { uploadedBy: f.uploadedByProfileId?.displayName ?? null } : {}),
  };
}

/**
 * Built field by field. Notably absent: the stored file name, so no response
 * from this module ever carries an /uploads path that could be signed into a
 * shareable link.
 */
function toDto(r, { admin = false } = {}) {
  const files = r.files ?? [];
  const latest = files.length ? files[files.length - 1] : null;
  const dto = {
    id: String(r._id),
    documentTypeId: String(r.documentTypeId?._id ?? r.documentTypeId),
    documentTypeName: r.documentTypeName,
    status: r.status,
    purpose: r.purpose,
    additionalInformation: r.additionalInformation ?? null,
    requiredBy: r.requiredBy ? new Date(r.requiredBy).toISOString().slice(0, 10) : null,
    requestData: (r.requestData ?? []).map((a) => ({ key: a.key, label: a.label, value: a.value ?? null })),
    requestedAt: iso(r.createdAt),
    reviewedAt: iso(r.reviewedAt),
    approvedAt: iso(r.approvedAt),
    rejectedAt: iso(r.rejectedAt),
    rejectionReason: r.rejectionReason ?? null,
    adminRemarks: r.adminRemarks ?? null,
    cancelledAt: iso(r.cancelledAt),
    issuedAt: iso(r.issuedAt),
    completedAt: iso(r.completedAt),
    document: latest && ISSUED_STATUSES.includes(r.status) ? fileDto(latest) : null,
  };
  if (!admin) return dto;
  return {
    ...dto,
    student: {
      id: String(r.studentId?._id ?? r.studentId),
      name: r.studentName,
      admissionNo: r.admissionNo,
      className: r.className,
    },
    versions: files.map((f) => fileDto(f, { withUploader: true })),
  };
}

/* ── Helpers ─────────────────────────────────────────────────── */

async function studentContext(actor) {
  if (actor.roleKey !== 'STUDENT') throw new AppError('Only students can request documents', 403, [], 'ROLE_NOT_PERMITTED');
  return resolveStudentContext(actor);
}

async function classNameFor(sectionId) {
  if (!sectionId) return null;
  const section = await Section.findById(sectionId).populate({ path: 'gradeId', select: 'name' }).select('name gradeId').lean();
  return section ? [section.gradeId?.name, section.name].filter(Boolean).join(' ') : null;
}

/** The school's admins, for "a new request is waiting" notifications. */
async function schoolAdminProfileIds(tenantId) {
  const role = await Role.findOne({ key: 'ADMIN' }).select('_id').lean();
  if (!role) return [];
  const profiles = await Profile.find({ tenantId, roleId: role._id, deletedAt: null, status: 'ACTIVE' }).select('_id').lean();
  return profiles.map((p) => p._id);
}

async function studentProfileId(studentId) {
  const s = await Student.findById(studentId).select('profileId').lean();
  return s?.profileId ?? null;
}

async function notifyStudent(request, title, body) {
  const profileId = await studentProfileId(request.studentId);
  if (!profileId) return;
  await notify({
    recipientProfileIds: [profileId],
    type: 'SYSTEM',
    title,
    body,
    link: '/student/profile',
    meta: { documentRequestId: String(request._id) },
  });
}

/**
 * Moves a request from one of `from` to a new status, atomically. A request
 * that exists but is in some other status is a 409 that names its status.
 */
async function transition(id, from, set, extraFilter = {}) {
  const updated = await DocumentRequest.findOneAndUpdate(
    { _id: id, status: { $in: from }, ...extraFilter },
    { $set: set },
    { new: true },
  );
  if (updated) return updated;
  const current = await DocumentRequest.findOne({ _id: id, ...extraFilter }).select('status').lean();
  if (!current) throw notFound();
  throw new AppError(
    `This request is ${current.status.toLowerCase().replace('_', ' ')} and cannot be moved to ${String(set.status).toLowerCase().replace('_', ' ')}.`,
    409, [], 'DOCUMENT_REQUEST_INVALID_TRANSITION',
  );
}

/* ── Student ─────────────────────────────────────────────────── */

export async function createRequest(actor, body = {}) {
  const tenantId = assertSchoolContext();
  const ctx = await studentContext(actor);

  const type = await DocumentType.findOne({
    _id: assertObjectId(body.documentTypeId, 'document type'), isActive: true, requestEnabled: true,
  }).lean();
  if (!type) throw new AppError('This document type is not available to request', 404, [], 'DOCUMENT_TYPE_NOT_AVAILABLE');

  const purpose = requiredText(body.purpose, 'Purpose', 500, 'DOCUMENT_REQUEST_PURPOSE_REQUIRED');
  const additionalInformation = optionalText(body.additionalInformation, 'Additional information', 2000);
  const requiredBy = cleanRequiredBy(body.requiredBy);
  const requestData = cleanRequestData(type, body.fields);

  let request;
  try {
    request = await DocumentRequest.create({
      studentId: ctx.student._id,
      enrollmentId: ctx.enrollment?._id ?? null,
      sectionId: ctx.enrollment?.sectionId ?? null,
      documentTypeId: type._id,
      documentTypeName: type.name,
      studentName: `${ctx.student.firstName} ${ctx.student.lastName ?? ''}`.trim(),
      admissionNo: ctx.student.admissionNo ?? null,
      className: await classNameFor(ctx.enrollment?.sectionId),
      status: 'PENDING',
      purpose,
      additionalInformation,
      requiredBy,
      requestData,
      requestedByProfileId: actor.profileId,
    });
  } catch (err) {
    if (err?.code === 11000) {
      throw new AppError(
        `You already have an open request for a ${type.name}. Wait for it to be decided, or cancel it.`,
        409, [], 'DOCUMENT_REQUEST_ALREADY_OPEN',
      );
    }
    throw err;
  }

  await recordAudit({
    actor, action: 'document_request.create', entityType: 'DocumentRequest', entityId: request._id,
    after: { documentType: type.name, status: 'PENDING' },
  });
  await notifyStudent(request, `Your ${type.name} request has been received`, 'The school office will review it shortly.');
  await notify({
    recipientProfileIds: await schoolAdminProfileIds(tenantId),
    type: 'SYSTEM',
    title: `New document request: ${type.name}`,
    body: `${request.studentName}${request.className ? ` (${request.className})` : ''} requested a ${type.name}.`,
    link: '/admin/document-requests',
    meta: { documentRequestId: String(request._id) },
  });
  return toDto(request);
}

export async function listMine(actor) {
  const ctx = await studentContext(actor);
  const requests = await DocumentRequest.find({ studentId: ctx.student._id }).sort({ createdAt: -1 }).limit(200).lean();
  return requests.map((r) => toDto(r));
}

async function loadOwn(actor, id) {
  const ctx = await studentContext(actor);
  const request = await DocumentRequest.findOne({ _id: assertObjectId(id, 'request id'), studentId: ctx.student._id });
  if (!request) throw notFound();
  return { ctx, request };
}

export async function getMine(actor, id) {
  const { request } = await loadOwn(actor, id);
  return toDto(request);
}

export async function cancelMine(actor, id) {
  const { ctx, request } = await loadOwn(actor, id);
  const updated = await transition(request._id, ['PENDING'], { status: 'CANCELLED', cancelledAt: new Date() }, { studentId: ctx.student._id });
  await recordAudit({
    actor, action: 'document_request.cancel', entityType: 'DocumentRequest', entityId: request._id,
    before: { status: request.status }, after: { status: 'CANCELLED' },
  });
  return toDto(updated);
}

/* ── Office (school admin) ───────────────────────────────────── */

export async function listForSchool(query = {}) {
  assertSchoolContext();
  const filter = {};
  if (query.status) {
    const statuses = String(query.status).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    filter.status = { $in: statuses };
  }
  if (query.issued === 'true') filter.status = { $in: ISSUED_STATUSES };
  if (query.documentTypeId) filter.documentTypeId = assertObjectId(query.documentTypeId, 'document type');
  if (query.q && String(query.q).trim()) {
    const re = new RegExp(escapeRegex(String(query.q).trim().slice(0, 100)), 'i');
    filter.$or = [{ studentName: re }, { admissionNo: re }, { documentTypeName: re }];
  }
  const range = {};
  if (query.from && !Number.isNaN(Date.parse(query.from))) range.$gte = new Date(`${query.from}T00:00:00.000Z`);
  if (query.to && !Number.isNaN(Date.parse(query.to))) range.$lte = new Date(`${query.to}T23:59:59.999Z`);
  if (Object.keys(range).length) filter.createdAt = range;

  const requests = await DocumentRequest.find(filter)
    .populate({ path: 'files.uploadedByProfileId', select: 'displayName' })
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();
  return requests.map((r) => toDto(r, { admin: true }));
}

async function loadForSchool(id) {
  assertSchoolContext();
  const request = await DocumentRequest.findById(assertObjectId(id, 'request id'));
  if (!request) throw notFound();
  return request;
}

async function adminDto(request) {
  await request.populate({ path: 'files.uploadedByProfileId', select: 'displayName' });
  return toDto(request, { admin: true });
}

export async function getForSchool(id) {
  return adminDto(await loadForSchool(id));
}

export async function startReview(actor, id) {
  const request = await loadForSchool(id);
  const updated = await transition(request._id, ['PENDING'], {
    status: 'UNDER_REVIEW', reviewedByProfileId: actor.profileId, reviewedAt: new Date(),
  });
  await recordAudit({
    actor, action: 'document_request.review', entityType: 'DocumentRequest', entityId: request._id,
    before: { status: request.status }, after: { status: 'UNDER_REVIEW' },
  });
  await notifyStudent(updated, `Your ${updated.documentTypeName} request is under review`, 'The school office is looking at your request.');
  return adminDto(updated);
}

export async function approve(actor, id, body = {}) {
  const request = await loadForSchool(id);
  const remarks = optionalText(body.remarks, 'Remarks', 1000);
  const now = new Date();
  const updated = await transition(request._id, ['PENDING', 'UNDER_REVIEW'], {
    status: 'APPROVED',
    approvedByProfileId: actor.profileId,
    approvedAt: now,
    // Approving straight from PENDING counts as having reviewed it.
    ...(request.reviewedAt ? {} : { reviewedByProfileId: actor.profileId, reviewedAt: now }),
    ...(remarks ? { adminRemarks: remarks } : {}),
  });
  await recordAudit({
    actor, action: 'document_request.approve', entityType: 'DocumentRequest', entityId: request._id,
    before: { status: request.status }, after: { status: 'APPROVED' },
  });
  await notifyStudent(updated, `Your ${updated.documentTypeName} request has been approved`, 'You will be notified when the document is ready.');
  return adminDto(updated);
}

export async function reject(actor, id, body = {}) {
  const request = await loadForSchool(id);
  const reason = requiredText(body.reason, 'Rejection reason', 1000, 'DOCUMENT_REQUEST_REASON_REQUIRED');
  if (reason.length < 3) throw new AppError('Give a reason the student can act on', 400, [], 'DOCUMENT_REQUEST_REASON_REQUIRED');
  const now = new Date();
  const updated = await transition(request._id, ['PENDING', 'UNDER_REVIEW'], {
    status: 'REJECTED',
    rejectedByProfileId: actor.profileId,
    rejectedAt: now,
    rejectionReason: reason,
    ...(request.reviewedAt ? {} : { reviewedByProfileId: actor.profileId, reviewedAt: now }),
  });
  await recordAudit({
    actor, action: 'document_request.reject', entityType: 'DocumentRequest', entityId: request._id,
    before: { status: request.status }, after: { status: 'REJECTED' },
  });
  await notifyStudent(updated, `Your ${updated.documentTypeName} request was rejected`, `Reason: ${reason}`);
  return adminDto(updated);
}

/**
 * The file an admin uploaded through POST /uploads, checked before it becomes
 * an official document: recorded by the upload service, in this school,
 * uploaded by this admin, present on disk, within the type's size limit, and
 * actually one of the type's allowed formats judged by its bytes.
 */
async function verifyUploadedFile(actor, tenantId, fileUrl, type) {
  const match = /^\/uploads\/([A-Za-z0-9_-][A-Za-z0-9._-]*)$/.exec(String(fileUrl ?? '').trim());
  if (!match || match[1].includes('..')) {
    throw new AppError('Upload the document first, then attach the returned file', 400, [], 'DOCUMENT_FILE_INVALID');
  }
  const storedName = match[1];

  const upload = await Upload.findOne({ storedName }).lean();
  // Another school's file, or one we never recorded, reads the same as missing.
  if (!upload || upload.tenantId !== tenantId) {
    throw new AppError('That file was not uploaded to this school', 404, [], 'DOCUMENT_FILE_NOT_FOUND');
  }
  if (String(upload.uploaderProfileId ?? '') !== String(actor.profileId)) {
    throw new AppError('Attach a file you uploaded yourself', 403, [], 'DOCUMENT_FILE_NOT_YOURS');
  }
  if (await DocumentRequest.exists({ 'files.storedName': storedName })) {
    throw new AppError('That file is already attached to a document request', 409, [], 'DOCUMENT_FILE_IN_USE');
  }

  const root = uploadDir();
  const absolutePath = resolve(root, storedName);
  if (!absolutePath.startsWith(root + sep)) throw new AppError('Invalid file', 400, [], 'DOCUMENT_FILE_INVALID');

  let info;
  try {
    info = await stat(absolutePath);
  } catch {
    throw new AppError('The uploaded file is no longer on the server. Upload it again.', 404, [], 'DOCUMENT_FILE_NOT_FOUND');
  }
  if (!info.isFile() || info.size === 0) throw new AppError('The uploaded file is empty', 400, [], 'DOCUMENT_FILE_INVALID');
  if (info.size > type.maxFileSizeMb * 1024 * 1024) {
    throw new AppError(`This document type accepts files up to ${type.maxFileSizeMb} MB`, 413, [], 'DOCUMENT_FILE_TOO_LARGE');
  }

  const handle = await open(absolutePath, 'r');
  let head;
  try {
    const buf = Buffer.alloc(8);
    const { bytesRead } = await handle.read(buf, 0, 8, 0);
    head = buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
  const detected = detectFileType(head);
  if (!detected || !(type.allowedFileTypes ?? []).includes(detected.type)) {
    throw new AppError(
      `This document type accepts ${(type.allowedFileTypes ?? []).join(', ').toUpperCase()} files; the uploaded file is not one of them.`,
      415, [], 'DOCUMENT_FILE_TYPE_NOT_ALLOWED',
    );
  }

  return { storedName, originalName: upload.originalName ?? null, size: info.size, mimeType: detected.mimeType };
}

/**
 * Attaches the official file. From APPROVED this issues the document
 * (version 1, status READY); from READY or COMPLETED it adds a new version —
 * earlier versions are kept, never overwritten.
 */
export async function issue(actor, id, body = {}) {
  const tenantId = assertSchoolContext();
  const request = await loadForSchool(id);
  if (!['APPROVED', ...ISSUED_STATUSES].includes(request.status)) {
    throw new AppError(
      `This request is ${request.status.toLowerCase().replace('_', ' ')}; a document can only be uploaded once it is approved.`,
      409, [], 'DOCUMENT_REQUEST_INVALID_TRANSITION',
    );
  }
  const type = await DocumentType.findById(request.documentTypeId).lean();
  if (!type) throw new AppError('Document type not found', 404, [], 'DOCUMENT_TYPE_NOT_FOUND');

  const remarks = optionalText(body.remarks, 'Remarks', 1000);
  const file = await verifyUploadedFile(actor, tenantId, body.fileUrl, type);

  const previousCount = request.files.length;
  const replacing = previousCount > 0;
  const now = new Date();
  // Conditional on both the status and the number of versions, so two
  // simultaneous uploads cannot both claim the same version number.
  const updated = await DocumentRequest.findOneAndUpdate(
    { _id: request._id, status: request.status, files: { $size: previousCount } },
    {
      $push: {
        files: {
          version: previousCount + 1,
          ...file,
          uploadedByProfileId: actor.profileId,
          uploadedAt: now,
          remarks,
        },
      },
      $set: {
        status: 'READY',
        issuedAt: now,
        completedAt: null,
        ...(remarks ? { adminRemarks: remarks } : {}),
      },
    },
    { new: true },
  );
  if (!updated) {
    throw new AppError('This request was changed by someone else. Refresh and try again.', 409, [], 'DOCUMENT_REQUEST_CONFLICT');
  }

  await recordAudit({
    actor,
    action: replacing ? 'document_request.replace_document' : 'document_request.upload_document',
    entityType: 'DocumentRequest',
    entityId: request._id,
    before: { status: request.status, version: replacing ? previousCount : null },
    after: { status: 'READY', version: previousCount + 1, fileName: file.originalName, size: file.size, mimeType: file.mimeType },
  });
  await notifyStudent(
    updated,
    replacing ? `An updated ${updated.documentTypeName} is ready` : `Your ${updated.documentTypeName} is ready`,
    'Download it from Document Requests in your profile.',
  );
  return adminDto(updated);
}

/* ── Downloads ───────────────────────────────────────────────── */

async function fileOnDisk(f) {
  const root = uploadDir();
  const absolutePath = resolve(root, f.storedName);
  if (!absolutePath.startsWith(root + sep)) throw notFound();
  try {
    await stat(absolutePath);
  } catch {
    throw new AppError('This document is no longer available. Please contact the school office.', 404, [], 'FILE_NOT_FOUND');
  }
  return absolutePath;
}

const downloadName = (r, f) => {
  const ext = f.mimeType === 'application/pdf' ? 'pdf' : f.mimeType === 'image/png' ? 'png' : 'jpg';
  return `${r.documentTypeName.replace(/[^A-Za-z0-9 _-]/g, '').trim() || 'document'} v${f.version}.${ext}`;
};

/** The student's own latest issued document. */
export async function fileForStudent(actor, id) {
  const { request } = await loadOwn(actor, id);
  if (!ISSUED_STATUSES.includes(request.status) || request.files.length === 0) {
    throw new AppError('This document is not ready yet', 404, [], 'DOCUMENT_NOT_READY');
  }
  const f = request.files[request.files.length - 1];
  return {
    request, version: f.version, absolutePath: await fileOnDisk(f), mimeType: f.mimeType, fileName: downloadName(request, f),
  };
}

/** Any version, for the office. */
export async function fileForSchool(id, version) {
  const request = await loadForSchool(id);
  if (request.files.length === 0) throw new AppError('No document has been uploaded for this request', 404, [], 'DOCUMENT_NOT_READY');
  const wanted = version === undefined || version === null || version === '' ? request.files.length : Number(version);
  const f = request.files.find((x) => x.version === wanted);
  if (!f) throw new AppError('No such version', 404, [], 'DOCUMENT_VERSION_NOT_FOUND');
  return {
    request, version: f.version, absolutePath: await fileOnDisk(f), mimeType: f.mimeType, fileName: downloadName(request, f),
  };
}

/**
 * Records a delivered download. A student's first download of a READY
 * document completes the request; later downloads only add audit entries.
 */
export async function recordDownload(actor, request, version, { byStudent }) {
  if (byStudent && request.status === 'READY') {
    await DocumentRequest.updateOne({ _id: request._id, status: 'READY' }, { $set: { status: 'COMPLETED', completedAt: new Date() } });
  }
  await recordAudit({
    actor, action: 'document_request.download', entityType: 'DocumentRequest', entityId: request._id,
    after: { version, by: byStudent ? 'student' : 'office' },
  });
}

