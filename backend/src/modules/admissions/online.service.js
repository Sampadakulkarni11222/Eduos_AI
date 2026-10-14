import { createHash, randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { School } from '../../models/school.model.js';
import { Grade } from '../../models/academics.model.js';
import { Lead, LeadInteraction } from '../../models/lead.model.js';
import { Upload } from '../../models/upload.model.js';
import { OnlineApplication } from '../../models/onlineApplication.model.js';
import { MessageOutbox } from '../../models/messaging.model.js';
import { AppError } from '../../utils/AppError.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { isValidPhone } from '../../utils/validators.js';
import { generateOtp, hashOtp, compareOtp } from '../../utils/otp.js';
import { featureEnabled } from '../../utils/features.js';
import { sendOtpSms, sendEmail } from '../../providers/notification.provider.js';
import { ALLOWED_EXTENSIONS, sanitizeFilename } from '../uploads/upload.routes.js';
import { createLead } from './admission.service.js';
import { sendOperational, TEMPLATES } from '../messaging/messaging.service.js';
import { nextRef, profilesWithRoles, dto, pageArgs } from '../ops/common.js';

/**
 * The public online admission form.
 *
 * Unauthenticated, per school (`/public/admissions/<school>/...`). A
 * submission creates a Lead in the admissions CRM at stage NEW with source WEB
 * and an OnlineApplication holding what the family sent, and answers with a
 * reference number. No fee is taken here. The family can later see their own
 * application's status with the reference number plus a one-time code sent to
 * the phone number on the application (the sign-in code machinery: same
 * generator, bcrypt hash, expiry and attempt limit).
 *
 * Abuse controls: an IP rate limit on every route (online.routes.js), a
 * honeypot field, an optional CAPTCHA verifier hook, strict input types (only
 * strings are accepted, so no query operators reach a filter), and uploads
 * restricted to PDF/JPEG/PNG with a size cap and a content check.
 */

export const DOC_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png'];
export const DOC_KINDS = ['BIRTH_CERTIFICATE', 'PHOTO', 'ADDRESS_PROOF', 'PREVIOUS_REPORT', 'TRANSFER_CERTIFICATE', 'OTHER'];
export const MAX_DOCS = 5;
export const maxDocBytes = () => Number(process.env.ADMISSION_UPLOAD_MAX_BYTES) || 2 * 1024 * 1024;
const REF_RE = /^APP\/\d{4}\/\d{4,}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const OTP_PER_WINDOW = 5;
const OTP_WINDOW_MS = 15 * 60_000;

/** The stage a family sees, in plain words. Internal notes never leave the CRM. */
export const PUBLIC_STATUS = {
  NEW: 'Received', CONTACTED: 'Being reviewed', TOUR_SCHEDULED: 'Visit scheduled', APPLICATION: 'Application in progress',
  ENROLLED: 'Admission confirmed', LOST: 'Closed',
};

// ── CAPTCHA hook ───────────────────────────────────────────────────────
// No CAPTCHA provider is wired in. A deployment that adds one (Turnstile,
// hCaptcha, reCAPTCHA) registers a verifier here at boot; the form then
// requires a token and the server checks it before anything is written.
let captchaVerifier = null;
export function setCaptchaVerifier(fn) { captchaVerifier = typeof fn === 'function' ? fn : null; }
export const captchaRequired = () => Boolean(captchaVerifier);

const str = (value, label, { max = 200, required = false } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) throw new AppError(`${label} is required`, 400, [], 'VALIDATION');
    return null;
  }
  if (typeof value !== 'string') throw new AppError(`${label} must be text`, 400, [], 'VALIDATION');
  const t = value.trim();
  if (required && !t) throw new AppError(`${label} is required`, 400, [], 'VALIDATION');
  if (t.length > max) throw new AppError(`${label} must be at most ${max} characters`, 400, [], 'VALIDATION');
  // Control characters have no place in a name or an address.
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  return t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '') || null;
};

const normalisePhone = (raw) => {
  if (typeof raw !== 'string') return null;
  const compact = raw.trim().replace(/[\s().-]/g, '');
  return isValidPhone(compact) ? compact : null;
};
const last10 = (p) => String(p ?? '').replace(/\D/g, '').slice(-10);
const maskPhone = (p) => (p ? `${String(p).slice(0, 3)}••••${String(p).slice(-3)}` : null);
export const hashAddress = (ip) => (ip ? createHash('sha256').update(`admission:${ip}`).digest('hex').slice(0, 24) : null);

/** The school behind a public URL, or 404 (same answer for unknown, suspended or switched off). */
export async function resolvePublicSchool(slugRaw) {
  const slug = String(slugRaw ?? '').trim().toLowerCase();
  if (!SLUG_RE.test(slug)) throw new AppError('This admission form is not available.', 404, [], 'FORM_NOT_FOUND');
  const school = await School.findOne({ slug, status: 'ACTIVE' }).select('slug name').lean();
  if (!school || !(await featureEnabled('onlineAdmission', slug))) throw new AppError('This admission form is not available.', 404, [], 'FORM_NOT_FOUND');
  return school;
}

export async function formConfig(school) {
  const grades = await Grade.find({}).sort({ level: 1 }).select('name').lean();
  return {
    school: { slug: school.slug, name: school.name },
    grades: grades.map((g) => g.name),
    documentKinds: DOC_KINDS,
    files: { extensions: DOC_EXTENSIONS, maxBytes: maxDocBytes(), maxFiles: MAX_DOCS },
    captcha: { required: captchaRequired(), siteKey: process.env.ADMISSION_CAPTCHA_SITE_KEY || null },
    feePayment: false,
    notice: 'No fee is collected through this form. The school will contact you about next steps.',
  };
}

/** Content check: the bytes must be what the extension says. */
function sniff(buf, ext) {
  if (ext === 'pdf') return buf.subarray(0, 5).toString('latin1') === '%PDF-';
  if (ext === 'png') return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (ext === 'jpg' || ext === 'jpeg') return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  return false;
}

/**
 * Stores one document for an application that has not been submitted yet.
 * Same filename rule and allowed-type list as POST /uploads, narrowed to
 * documents and photos, with a smaller cap and a content check.
 */
export async function storeDocument(school, { rawName, body }) {
  if (!rawName) throw new AppError('x-filename header is required', 400, [], 'INVALID_FILENAME');
  if (!Buffer.isBuffer(body) || body.length === 0) throw new AppError('Send the file bytes as the request body', 400, [], 'EMPTY_FILE');
  if (body.length > maxDocBytes()) throw new AppError(`Each file can be at most ${Math.round(maxDocBytes() / 1024 / 1024)} MB`, 413, [], 'FILE_TOO_LARGE');
  let decoded;
  try { decoded = decodeURIComponent(String(rawName)); } catch { throw new AppError('x-filename is not a valid filename', 400, [], 'INVALID_FILENAME'); }
  const filename = sanitizeFilename(decoded);
  const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
  if (!ALLOWED_EXTENSIONS.has(ext) || !DOC_EXTENSIONS.includes(ext)) throw new AppError('Upload a PDF, JPG or PNG file', 415, [], 'UPLOAD_TYPE_NOT_ALLOWED');
  if (!sniff(body, ext)) throw new AppError('That file\'s contents do not match its type', 415, [], 'UPLOAD_CONTENT_MISMATCH');
  const dir = resolve(process.cwd(), env.UPLOAD_DIR);
  await mkdir(dir, { recursive: true });
  const stored = `${randomUUID()}-${filename}`;
  await writeFile(join(dir, stored), body);
  await Upload.create({ storedName: stored, tenantId: school.slug, uploaderProfileId: null, originalName: filename, size: body.length });
  return { fileToken: stored, name: filename, size: body.length };
}

async function resolveDocuments(school, list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new AppError('documents must be a list', 400, [], 'VALIDATION');
  if (list.length > MAX_DOCS) throw new AppError(`Attach at most ${MAX_DOCS} documents`, 400, [], 'TOO_MANY_FILES');
  const out = [];
  for (const d of list) {
    const token = str(d?.fileToken, 'fileToken', { max: 200, required: true });
    // eslint-disable-next-line no-await-in-loop
    const up = await Upload.findOne({ storedName: token, tenantId: school.slug, uploaderProfileId: null, createdAt: { $gte: new Date(Date.now() - 6 * 3600_000) } }).lean();
    // eslint-disable-next-line no-await-in-loop
    const taken = up ? await OnlineApplication.exists({ 'documents.storedName': token }) : null;
    if (!up || taken) throw new AppError('One of the documents was not found. Upload it again.', 400, [], 'DOCUMENT_NOT_FOUND');
    const kind = typeof d.kind === 'string' && DOC_KINDS.includes(d.kind.toUpperCase()) ? d.kind.toUpperCase() : 'OTHER';
    out.push({ kind, name: up.originalName ?? 'document', storedName: up.storedName, size: up.size });
  }
  return out;
}

/** Writes the applicant's acknowledgement to the outbox. Applicants have no account, so the row has no recipient profile. */
async function acknowledge(app, school) {
  const variables = { ref: app.refNo, school: school.name, child: app.childName };
  const preview = TEMPLATES.ADMISSION_ACK.text(variables);
  const rows = [];
  // SMS: no general-purpose SMS sender is configured for messages other than sign-in codes, so this is recorded honestly as simulated.
  rows.push({ channel: 'SMS', recipientMasked: maskPhone(app.phone), status: 'SIMULATED', statusReason: 'No SMS channel is configured for acknowledgements; nothing was sent' });
  if (app.email) {
    const out = await sendEmail({ to: app.email, subject: TEMPLATES.ADMISSION_ACK.subject(variables), text: preview });
    rows.push({
      channel: 'EMAIL', recipientMasked: String(app.email).replace(/^(.).*(@.*)$/, '$1***$2'),
      status: out.sent ? 'SENT' : out.simulated ? 'SIMULATED' : 'FAILED', statusReason: out.sent ? null : out.simulated ? 'Email is not configured; nothing was sent' : out.error ?? null,
      providerMessageId: out.id ?? null,
    });
  }
  const results = [];
  for (const r of rows) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await MessageOutbox.create({
        ...r, templateKey: 'ADMISSION_ACK', category: 'UTILITY', recipientProfileId: null, variables, preview, idempotencyKey: `admission-ack:${app.refNo}`,
        relatedEntityType: 'OnlineApplication', relatedEntityId: String(app._id), attempts: r.status === 'SIMULATED' ? 0 : 1,
        statusHistory: [{ status: 'QUEUED', at: new Date() }, { status: r.status, at: new Date(), detail: r.statusReason ?? undefined }],
      });
    } catch (err) { if (err?.code !== 11000) logger.error(`Admission acknowledgement outbox write failed: ${err.message}`); }
    results.push({ channel: r.channel, status: r.status });
  }
  return results;
}

export async function submitApplication(school, body = {}, { ip = null } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('Send the form as JSON', 400, [], 'VALIDATION');
  // Honeypot: a field people never see. Anything in it means a script filled the form.
  if (body.website !== undefined && body.website !== null && body.website !== '') throw new AppError('This form could not be accepted.', 400, [], 'REJECTED');
  if (captchaVerifier) {
    const okCaptcha = await captchaVerifier({ token: typeof body.captchaToken === 'string' ? body.captchaToken : null, ip });
    if (!okCaptcha) throw new AppError('Please complete the check that you are not a robot.', 400, [], 'CAPTCHA_FAILED');
  }
  const childName = str(body.childName, 'Child\'s name', { max: 120, required: true });
  const guardianName = str(body.guardianName, 'Parent or guardian\'s name', { max: 120, required: true });
  const phone = normalisePhone(body.phone);
  if (!phone) throw new AppError('Give a valid phone number, e.g. +919876543210 or a 10-digit number', 400, [], 'INVALID_PHONE');
  const email = str(body.email, 'Email', { max: 160 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('Give a valid email address', 400, [], 'INVALID_EMAIL');
  const gradeApplying = str(body.gradeApplying, 'Class applying for', { max: 60, required: true });
  const dobRaw = str(body.dateOfBirth, 'Date of birth', { max: 10 });
  let dateOfBirth = null;
  if (dobRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dobRaw) || Number.isNaN(new Date(dobRaw).getTime())) throw new AppError('Date of birth must be a date like 2019-06-15', 400, [], 'VALIDATION');
    dateOfBirth = new Date(`${dobRaw}T00:00:00.000Z`);
    if (dateOfBirth > new Date()) throw new AppError('Date of birth cannot be in the future', 400, [], 'VALIDATION');
  }
  if (body.consent !== true) throw new AppError('Please agree that the school may contact you about this application.', 400, [], 'CONSENT_REQUIRED');
  const documents = await resolveDocuments(school, body.documents);

  const refNo = await nextRef('APP');
  const lead = await createLead({ childName, guardianName, phone, email, gradeApplying, source: 'WEB', stage: 'NEW', notes: `Online application ${refNo}` });
  await Lead.updateOne({ _id: lead.id }, { $set: {
    sourceDetail: 'online-admission-form', academicYear: str(body.academicYear, 'Academic year', { max: 20 }),
    contactConsent: { given: true, channels: ['SMS', ...(email ? ['EMAIL'] : [])], at: new Date(), withdrawnAt: null },
  } });
  const app = await OnlineApplication.create({
    refNo, leadId: lead.id, childName, dateOfBirth, gender: str(body.gender, 'Gender', { max: 20 }), gradeApplying,
    academicYear: str(body.academicYear, 'Academic year', { max: 20 }), previousSchool: str(body.previousSchool, 'Previous school', { max: 160 }),
    guardianName, relation: str(body.relation, 'Relation', { max: 40 }), phone, email, address: str(body.address, 'Address', { max: 500 }),
    message: str(body.message, 'Message', { max: 2000 }), contactConsent: true, documents, submittedFrom: hashAddress(ip),
  });
  await LeadInteraction.create({ leadId: lead.id, type: 'NOTE', body: `Online application ${refNo} received with ${documents.length} document(s).` });
  const acknowledgement = await acknowledge(app, school);
  // The admissions team hears about it in the app (and on WhatsApp when that is set up and they opted in).
  try {
    const staff = await profilesWithRoles(['MARKETING', 'ADMIN']);
    await sendOperational({
      templateKey: 'ADMISSION_RECEIVED', recipientProfileIds: staff.map((p) => p._id), variables: { ref: refNo, child: childName, grade: gradeApplying },
      link: '/marketing/online-applications', idempotencyKey: `admission-received:${refNo}`, relatedEntityType: 'OnlineApplication', relatedEntityId: app._id,
    });
  } catch (err) { logger.error(`Admission staff notice failed: ${err.message}`); }
  return {
    refNo, status: PUBLIC_STATUS.NEW, acknowledgement,
    message: `Application received. Your reference number is ${refNo}. Keep it to check your status.`,
  };
}

// ── status check by reference + phone OTP ──────────────────────────────

const GENERIC_SENT = 'If the reference number and phone number match an application, a code has been sent to that phone.';
const NOT_MATCHED = () => new AppError('The reference number, phone number or code is not right.', 401, [], 'NOT_MATCHED');

function refFrom(raw) {
  const ref = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (!REF_RE.test(ref)) throw new AppError('Enter the reference number exactly as given, e.g. APP/2026/0012', 400, [], 'VALIDATION');
  return ref;
}

async function matching(refRaw, phoneRaw) {
  const refNo = refFrom(refRaw);
  const phone = normalisePhone(phoneRaw);
  if (!phone) throw new AppError('Give the phone number used on the application', 400, [], 'INVALID_PHONE');
  const app = await OnlineApplication.findOne({ refNo });
  if (!app || last10(app.phone) !== last10(phone)) return null;
  return app;
}

export async function requestStatusCode(body = {}) {
  const app = await matching(body?.refNo, body?.phone);
  if (!app) return { message: GENERIC_SENT };
  const now = Date.now();
  const recent = (app.otp?.issued ?? []).filter((d) => now - new Date(d).getTime() < OTP_WINDOW_MS);
  if (recent.length >= OTP_PER_WINDOW) throw new AppError('Too many codes requested. Please wait a few minutes before trying again.', 429, [], 'OTP_THROTTLED');
  const code = generateOtp();
  app.otp = { codeHash: await hashOtp(code), expiresAt: new Date(now + env.OTP_TTL_MINUTES * 60_000), attempts: 0, issued: [...recent, new Date(now)] };
  await app.save();
  const { delivered, devOtp } = await sendOtpSms(app.phone, code);
  if (!delivered) throw new AppError('Codes cannot be sent by SMS right now. Please contact the school office with your reference number.', 503, [], 'OTP_DELIVERY_UNAVAILABLE');
  return { message: GENERIC_SENT, ...(devOtp ? { devOtp } : {}) };
}

export async function checkStatus(body = {}) {
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!/^\d{6}$/.test(code)) throw new AppError('Enter the 6-digit code', 400, [], 'VALIDATION');
  const app = await matching(body?.refNo, body?.phone);
  if (!app || !app.otp?.codeHash) throw NOT_MATCHED();
  if (new Date(app.otp.expiresAt) < new Date()) throw new AppError('That code has expired. Request a new one.', 401, [], 'OTP_EXPIRED');
  if (app.otp.attempts >= env.OTP_MAX_ATTEMPTS) throw new AppError('Too many attempts. Request a new code.', 429, [], 'OTP_LOCKED');
  if (!(await compareOtp(code, app.otp.codeHash))) {
    app.otp.attempts += 1;
    await app.save();
    throw NOT_MATCHED();
  }
  app.otp.codeHash = null; // one use
  app.lastViewedAt = new Date();
  await app.save();
  const lead = await Lead.findById(app.leadId).select('stage updatedAt').lean();
  const stage = lead?.stage ?? 'NEW';
  // Only the family's own application, and only what they gave plus a plain status. No CRM notes, no assignee.
  return {
    refNo: app.refNo, childName: app.childName, gradeApplying: app.gradeApplying, submittedAt: app.createdAt,
    status: PUBLIC_STATUS[stage] ?? 'Received', stage, updatedAt: lead?.updatedAt ?? app.updatedAt,
    documents: app.documents.map((d) => ({ kind: d.kind, name: d.name })),
  };
}

// ── staff side ─────────────────────────────────────────────────────────

function staffDto(app, lead) {
  const out = dto(app);
  delete out.otp; delete out.submittedFrom;
  out.documents = (app.documents ?? []).map((d) => ({ kind: d.kind, name: d.name, size: d.size, url: `/uploads/${d.storedName}` }));
  out.stage = lead?.stage ?? null;
  out.publicStatus = PUBLIC_STATUS[lead?.stage] ?? null;
  return out;
}

export async function listApplications(query = {}) {
  const { page, pageSize, skip } = pageArgs(query);
  const [rows, total] = await Promise.all([
    OnlineApplication.find({}).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    OnlineApplication.countDocuments({}),
  ]);
  const leads = new Map((await Lead.find({ _id: { $in: rows.map((r) => r.leadId) } }).select('stage').lean()).map((l) => [String(l._id), l]));
  return { items: rows.map((r) => staffDto(r, leads.get(String(r.leadId)))), total, page, pageSize };
}

export async function getApplication(id) {
  const app = await OnlineApplication.findById(id).lean();
  if (!app) throw new AppError('Application not found', 404);
  const lead = await Lead.findById(app.leadId).select('stage').lean();
  return staffDto(app, lead);
}
