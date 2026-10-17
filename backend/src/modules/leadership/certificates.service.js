import crypto from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DocumentRequest, DocumentType } from '../../models/documentRequest.model.js';
import { Student, StudentGuardian, Enrollment } from '../../models/student.model.js';
import { Invoice } from '../../models/fee.model.js';
import { BookIssue } from '../../models/library.model.js';
import { HostelAllocation } from '../../models/hostel.model.js';
import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { InstitutionProfile } from '../../models/institution.model.js';
import { Upload } from '../../models/upload.model.js';
import { Profile } from '../../models/profile.model.js';
import { IssuedCertificate } from '../../models/issuedCertificate.model.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { ATTENDANCE_STATUSES, attendanceFigures } from '../attendance/attendance.service.js';
import { issue as issueDocument } from '../documentRequests/documentRequest.service.js';
import { assertObjectId, nextRef, optionalText } from '../ops/common.js';
import { renderCertificatePdf } from './pdf.js';
import '../../models/academics.model.js';

/**
 * Certificates from the student record, for the school office.
 *
 * Until now the office typed a transfer certificate in a word processor and
 * uploaded the file to the approved request. Here the office:
 *
 *   1. checks clearance (no-dues): fees outstanding, library books not
 *      returned or fines unpaid, a hostel bed still allotted. A transfer or
 *      leaving certificate is refused while anything is due, unless the
 *      office records a reason to issue anyway (audited, shown on the
 *      register);
 *   2. generates the certificate as a PDF from the record: particulars,
 *      guardians, date of birth in figures and words, first admission, class
 *      last studied, attendance this year, fee position, and the details only
 *      the office knows (reason for leaving, conduct, remarks) which it types
 *      in;
 *   3. the PDF is attached to the request through the existing issue path, so
 *      versions, audit, notification and downloads work as before.
 *
 * Every certificate gets a serial number (TC/2026/0001 style, one series per
 * kind) and a verification code kept in a register of issued certificates.
 * The office signs and seals the printout; EduOS never signs.
 */


const DAY = 86_400_000;
const KINDS = {
  TC: { prefix: 'TC', title: 'Transfer Certificate', needsClearance: true },
  LEAVING: { prefix: 'LC', title: 'School Leaving Certificate', needsClearance: true },
  BONAFIDE: { prefix: 'BC', title: 'Bonafide Certificate', needsClearance: false },
  CHARACTER: { prefix: 'CC', title: 'Character Certificate', needsClearance: false },
  FEE: { prefix: 'FC', title: 'Fee Certificate', needsClearance: false },
  GENERIC: { prefix: 'CERT', title: null, needsClearance: false },
};

export function kindOf(typeName = '') {
  const n = String(typeName).toLowerCase();
  if (/transfer|migration/.test(n)) return 'TC';
  if (/leaving/.test(n)) return 'LEAVING';
  if (/bonafide|bona fide|study|enrol?ment/.test(n)) return 'BONAFIDE';
  if (/character|conduct/.test(n)) return 'CHARACTER';
  if (/fee/.test(n)) return 'FEE';
  return 'GENERIC';
}

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ORD = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
function under100(n) { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`; }
function yearWords(y) {
  if (y >= 2000 && y < 2100) return `two thousand${y % 100 ? ` ${under100(y % 100)}` : ''}`;
  return `${under100(Math.floor(y / 100))} hundred${y % 100 ? ` ${under100(y % 100)}` : ''}`;
}
function ordinal(n) {
  const w = under100(n);
  const parts = w.split('-');
  const last = parts.pop();
  const o = ORD[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return [...parts, o].join('-');
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** 2014-03-07 -> "Seventh March two thousand fourteen" (as written on a TC). */
export function dateInWords(d) {
  if (!d) return null;
  const x = new Date(d);
  const s = `${ordinal(x.getUTCDate())} ${MONTHS[x.getUTCMonth()]} ${yearWords(x.getUTCFullYear())}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' }) : null);
const inr = (p) => `INR ${(Number(p || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

async function loadRequest(id) {
  const r = await DocumentRequest.findById(assertObjectId(id)).lean();
  if (!r) throw new AppError('Document request not found', 404, [], 'DOCUMENT_REQUEST_NOT_FOUND');
  return r;
}

/** The no-dues checks for one student, as of now. */
export async function clearanceFor(studentId) {
  const student = await Student.findById(studentId).select('profileId').lean();
  if (!student) throw new AppError('Student not found', 404);
  const enrolments = await Enrollment.find({ studentId }).select('_id').lean();
  const invoices = await Invoice.find({ enrollmentId: { $in: enrolments.map((e) => e._id) }, status: { $in: ['PENDING', 'PARTIAL', 'OVERDUE'] }, voidedAt: null }).select('invoiceNo totalPaise paidPaise dueOn status').lean();
  const feeDue = invoices.reduce((s, i) => s + Math.max(0, (i.totalPaise ?? 0) - (i.paidPaise ?? 0)), 0);
  const books = student.profileId ? await BookIssue.find({ borrowerProfileId: student.profileId, $or: [{ returnedAt: null, status: { $in: ['ACTIVE', 'OVERDUE'] } }, { fineStatus: 'DUE' }] }).select('borrowerName dueDate returnedAt fineAmount fineStatus').lean() : [];
  const notReturned = books.filter((b) => !b.returnedAt);
  const finesDue = books.filter((b) => b.fineStatus === 'DUE').reduce((s, b) => s + (b.fineAmount ?? 0), 0);
  const bed = await HostelAllocation.findOne({ studentId, status: 'ACTIVE' }).select('_id allottedAt').lean();
  const checks = [
    { key: 'fees', label: 'Fees', status: feeDue > 0 ? 'DUE' : 'CLEAR', detail: feeDue > 0 ? `${inr(feeDue)} outstanding on ${invoices.length} invoice${invoices.length === 1 ? '' : 's'} (${invoices.slice(0, 3).map((i) => i.invoiceNo).join(', ')}${invoices.length > 3 ? '…' : ''})` : 'No fees outstanding', link: '/payments' },
    { key: 'library', label: 'Library', status: notReturned.length || finesDue ? 'DUE' : 'CLEAR', detail: notReturned.length || finesDue ? [notReturned.length ? `${notReturned.length} book${notReturned.length === 1 ? '' : 's'} not returned` : null, finesDue ? `fines of INR ${finesDue} unpaid` : null].filter(Boolean).join('; ') : 'No books out, no fines due', link: '/library' },
    { key: 'hostel', label: 'Hostel', status: bed ? 'DUE' : 'CLEAR', detail: bed ? 'A hostel bed is still allotted; the warden vacates it first' : 'No hostel bed allotted', link: '/hostel' },
  ];
  return { clear: checks.every((c) => c.status === 'CLEAR'), checks, checkedAt: new Date().toISOString() };
}

export async function clearance(actor, requestId) {
  const r = await loadRequest(requestId);
  const kind = kindOf(r.documentTypeName);
  const result = await clearanceFor(r.studentId);
  return { requestId: String(r._id), kind, title: KINDS[kind].title ?? r.documentTypeName, required: KINDS[kind].needsClearance, ...result };
}

async function attendanceThisYear(enrollmentId) {
  if (!enrollmentId) return null;
  const rows = await AttendanceRecord.aggregate([
    { $match: { enrollmentId, periodNo: null, status: { $in: ATTENDANCE_STATUSES } } },
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]);
  const t = {};
  for (const x of rows) t[x._id] = x.n;
  const f = attendanceFigures(t);
  return f.workingDays ? { workingDays: f.workingDays, attended: f.PRESENT + f.LATE + f.EXCUSED + f.HALF_DAY * 0.5, pct: f.pctPresent } : null;
}

/** Everything the certificate needs from the records (the office adds the rest). */
export async function particulars(requestId) {
  const r = await loadRequest(requestId);
  const student = await Student.findById(r.studentId).lean();
  if (!student) throw new AppError('Student not found', 404);
  const guardians = await StudentGuardian.find({ studentId: student._id }).populate('guardianProfileId', 'displayName').lean();
  const nameOf = (rel) => guardians.find((g) => g.relation === rel)?.guardianProfileId?.displayName ?? null;
  const enrolments = await Enrollment.find({ studentId: student._id }).populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } }).populate('academicYearId', 'name startsOn').sort({ createdAt: 1 }).lean();
  const first = enrolments[0] ?? null;
  const current = enrolments.find((e) => String(e._id) === String(r.enrollmentId)) ?? enrolments.find((e) => e.status === 'ACTIVE') ?? enrolments[enrolments.length - 1] ?? null;
  const cls = (e) => (e?.sectionId ? `${e.sectionId.gradeId?.name ?? ''} ${e.sectionId.name ?? ''}`.trim() : null);
  const paid = await Invoice.find({ enrollmentId: { $in: enrolments.map((e) => e._id) }, status: 'PAID' }).sort({ dueOn: -1 }).select('dueOn totalPaise paidPaise createdAt').lean();
  const fyStart = (() => { const n = new Date(); return new Date(Date.UTC(n.getUTCMonth() >= 3 ? n.getUTCFullYear() : n.getUTCFullYear() - 1, 3, 1)); })();
  const paidThisFy = paid.filter((i) => new Date(i.createdAt) >= fyStart).reduce((s, i) => s + (i.paidPaise ?? i.totalPaise ?? 0), 0);
  const inst = await InstitutionProfile.findOne({}).lean();
  const campus = inst?.campuses?.[0];
  const board = inst?.affiliations?.find((a) => a.kind === 'BOARD' && a.status !== 'WITHDRAWN');
  const answers = Object.fromEntries((r.requestData ?? []).map((a) => [a.key, a.value]));
  return {
    request: r, student, answers,
    school: {
      name: inst?.legalName || inst?.displayName || 'School',
      address: campus ? [campus.addressLine, campus.city, campus.state, campus.pincode].filter(Boolean).join(', ') : null,
      affiliation: [board ? `Affiliated to ${board.body}${board.number ? `, affiliation no. ${board.number}` : ''}` : null, campus?.udiseCode ? `UDISE+ ${campus.udiseCode}` : null].filter(Boolean).join(' · ') || null,
    },
    name: `${student.firstName} ${student.lastName ?? ''}`.trim(),
    father: nameOf('FATHER'), mother: nameOf('MOTHER'), guardian: nameOf('GUARDIAN'),
    dob: student.dob ?? null,
    firstAdmission: first ? { on: first.academicYearId?.startsOn ?? first.createdAt, class: cls(first) } : null,
    lastClass: cls(current), academicYear: current?.academicYearId?.name ?? null,
    attendance: await attendanceThisYear(current?._id ?? null),
    feesPaidUpTo: paid[0]?.dueOn ?? null, paidThisFy,
    gender: student.gender ?? null,
  };
}

/** What the office may type in (all optional; sensible defaults where the record is silent). */
function officeFields(body = {}) {
  const t = (k, max = 300) => optionalText(body[k], { max }) || null;
  return {
    reasonForLeaving: t('reasonForLeaving'), conduct: t('conduct', 60), promotion: t('promotion', 200), subjects: t('subjects', 400),
    lastExam: t('lastExam', 200), concession: t('concession', 200), activities: t('activities', 300), purpose: t('purpose', 200), remarks: t('remarks', 500),
    applicationDate: t('applicationDate', 20), leavingDate: t('leavingDate', 20), nationality: t('nationality', 60), category: t('category', 60),
  };
}

function buildContent(kind, p, o, request) {
  const pronoun = /^f/i.test(p.gender ?? '') ? ['She', 'her', 'daughter'] : /^m/i.test(p.gender ?? '') ? ['He', 'his', 'son'] : ['They', 'their', 'ward'];
  const parent = p.father ?? p.mother ?? p.guardian ?? '________';
  if (kind === 'TC' || kind === 'LEAVING') {
    return {
      body: null,
      rows: [
        ['Name of the pupil', p.name],
        ["Mother's name", p.mother ?? '—'],
        ["Father's / guardian's name", p.father ?? p.guardian ?? '—'],
        ['Nationality', o.nationality ?? 'Indian'],
        ['Whether the candidate belongs to SC / ST / OBC', o.category ?? '—'],
        ['Date of first admission in the school, with class', p.firstAdmission ? `${fmt(p.firstAdmission.on)}, ${p.firstAdmission.class ?? '—'}` : '—'],
        ['Date of birth (in figures)', fmt(p.dob) ?? '—'],
        ['Date of birth (in words)', dateInWords(p.dob) ?? '—'],
        ['Class in which the pupil last studied', p.lastClass ?? '—'],
        ['School / board annual examination last taken, with result', o.lastExam ?? '—'],
        ['Whether qualified for promotion to a higher class', o.promotion ?? '—'],
        ['Subjects studied', o.subjects ?? '—'],
        ['Month up to which the pupil has paid school dues', p.feesPaidUpTo ? new Date(p.feesPaidUpTo).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—'],
        ['Any fee concession availed of; if so, its nature', o.concession ?? 'None'],
        ['Total working days / days present (this academic year)', p.attendance ? `${p.attendance.workingDays} / ${p.attendance.attended}` : '—'],
        ['Games played or extra-curricular activities', o.activities ?? '—'],
        ['General conduct', o.conduct ?? 'Good'],
        ['Date of application for the certificate', o.applicationDate ?? fmt(request.createdAt)],
        ['Date on which the pupil left the school', o.leavingDate ?? '—'],
        ['Reason for leaving the school', o.reasonForLeaving ?? '—'],
        ['Any other remarks', o.remarks ?? '—'],
      ],
    };
  }
  if (kind === 'BONAFIDE') {
    return { body: `This is to certify that ${p.name}, ${pronoun[2]} of ${parent}, admission no. ${p.student.admissionNo ?? '—'}, is a bonafide student of this school, studying in ${p.lastClass ?? '—'}${p.academicYear ? ` in the academic year ${p.academicYear}` : ''}. ${pronoun[0]} ${pronoun[0] === 'They' ? 'were' : 'was'} born on ${fmt(p.dob) ?? '—'} (${dateInWords(p.dob) ?? '—'}) as per the school admission register.${o.purpose ? ` This certificate is issued on request for the purpose of ${o.purpose}.` : ''}${o.remarks ? ` ${o.remarks}` : ''}`, rows: [] };
  }
  if (kind === 'CHARACTER') {
    return { body: `This is to certify that ${p.name}, ${pronoun[2]} of ${parent}, admission no. ${p.student.admissionNo ?? '—'}, has been a student of this school${p.firstAdmission ? ` since ${fmt(p.firstAdmission.on)}` : ''} and is at present in ${p.lastClass ?? '—'}. To the best of our knowledge ${pronoun[1]} conduct and character have been ${(o.conduct ?? 'good').toLowerCase()}.${o.remarks ? ` ${o.remarks}` : ''}`, rows: [] };
  }
  if (kind === 'FEE') {
    return { body: `This is to certify that ${p.name}, admission no. ${p.student.admissionNo ?? '—'}, studying in ${p.lastClass ?? '—'}, has paid ${inr(p.paidThisFy)} as school fees in the current financial year, as per the school's fee records.${o.purpose ? ` Issued for the purpose of ${o.purpose}.` : ''}${o.remarks ? ` ${o.remarks}` : ''}`, rows: [] };
  }
  return { body: `This is to certify that ${p.name}, admission no. ${p.student.admissionNo ?? '—'}, is a student of this school in ${p.lastClass ?? '—'}.${o.purpose ? ` Issued for the purpose of ${o.purpose}.` : ''}${o.remarks ? ` ${o.remarks}` : ''}`, rows: [] };
}

/** A preview of what will be printed, without issuing anything. */
export async function preview(actor, requestId, body = {}) {
  const p = await particulars(requestId);
  const kind = kindOf(p.request.documentTypeName);
  const content = buildContent(kind, p, officeFields(body), p.request);
  return { kind, title: KINDS[kind].title ?? p.request.documentTypeName, school: p.school, admissionNo: p.student.admissionNo, ...content, clearance: await clearanceFor(p.student._id), needsClearance: KINDS[kind].needsClearance };
}

/**
 * Generates the certificate and attaches it to the approved request (a new
 * version if one was issued before). Refuses a TC/leaving certificate while
 * dues are open unless overrideReason (10+ characters) is given.
 */
export async function generate(actor, requestId, body = {}) {
  const p = await particulars(requestId);
  const r = p.request;
  if (!['APPROVED', 'READY', 'COMPLETED'].includes(r.status)) {
    throw new AppError('Approve the request first; a certificate is generated for an approved request.', 409, [], 'DOCUMENT_REQUEST_INVALID_TRANSITION');
  }
  const type = await DocumentType.findById(r.documentTypeId).select('allowedFileTypes').lean();
  if (type && !(type.allowedFileTypes ?? []).includes('pdf')) throw new AppError('This document type does not accept PDF files; allow PDF on the type first.', 409, [], 'PDF_NOT_ALLOWED');
  const kind = kindOf(r.documentTypeName);
  const cl = await clearanceFor(p.student._id);
  const overrideReason = optionalText(body.overrideReason, { max: 500 }) || null;
  if (KINDS[kind].needsClearance && !cl.clear) {
    if (!overrideReason || overrideReason.length < 10) {
      throw new AppError(`Dues are open: ${cl.checks.filter((c) => c.status === 'DUE').map((c) => `${c.label.toLowerCase()} (${c.detail})`).join('; ')}. Clear them, or give a reason to issue anyway.`, 409, [], 'DUES_OPEN');
    }
  }
  const content = buildContent(kind, p, officeFields(body), r);
  const serialNo = await nextRef(KINDS[kind].prefix);
  const verificationCode = crypto.randomBytes(5).toString('hex').toUpperCase();
  const me = await Profile.findById(actor.profileId).select('displayName').lean();
  const title = KINDS[kind].title ?? r.documentTypeName;

  // Write the PDF where uploads live and record it as this person's upload,
  // so the request's own issue path (checks, versions, audit, notice) attaches it.
  const root = resolve(process.cwd(), env.UPLOAD_DIR);
  await mkdir(root, { recursive: true });
  const storedName = `cert-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.pdf`;
  const file = resolve(root, storedName);
  await new Promise((ok, fail) => {
    const out = createWriteStream(file);
    out.on('finish', ok); out.on('error', fail);
    renderCertificatePdf(out, { title, serialNo, verificationCode, school: p.school, admissionNo: p.student.admissionNo, issuedAt: new Date(), ...content });
  });
  const size = (await stat(file)).size;
  await Upload.create({ storedName, tenantId: currentTenantId(), uploaderProfileId: actor.profileId, originalName: `${title} ${serialNo.replace(/\//g, '-')}.pdf`, size });
  const issued = await issueDocument(actor, String(r._id), { fileUrl: `/uploads/${storedName}`, remarks: `${title} ${serialNo} generated from the records${overrideReason ? '; issued with dues open (reason recorded)' : ''}.` });
  const version = issued.files?.length ?? issued.versions?.length ?? 1;
  const rec = await IssuedCertificate.create({
    requestId: r._id, studentId: p.student._id, studentName: p.name, admissionNo: p.student.admissionNo ?? null, kind, title, serialNo, verificationCode,
    issuedByProfileId: actor.profileId, issuedByName: me?.displayName ?? null, clearance: cl, overrideReason: KINDS[kind].needsClearance && !cl.clear ? overrideReason : null, version,
  });
  await recordAudit({ actor, action: 'certificate.generate', entityType: 'DocumentRequest', entityId: r._id, after: { serialNo, kind, dues: cl.clear ? 'clear' : 'open', override: Boolean(rec.overrideReason) } });
  return { serialNo, verificationCode, kind, title, clearance: cl, overrideReason: rec.overrideReason, request: issued };
}

/** The register of issued certificates (office), newest first. */
export async function register(query = {}) {
  const filter = {};
  if (query.kind) filter.kind = String(query.kind).toUpperCase();
  const rows = await IssuedCertificate.find(filter).sort({ createdAt: -1 }).limit(Math.min(500, Number(query.limit) || 200)).lean();
  return rows.map((x) => ({ id: String(x._id), serialNo: x.serialNo, kind: x.kind, title: x.title, studentName: x.studentName, admissionNo: x.admissionNo, issuedAt: x.createdAt, issuedBy: x.issuedByName, duesOpen: x.clearance ? !x.clearance.clear : null, overrideReason: x.overrideReason, status: x.status, requestId: String(x.requestId) }));
}

/** Confirms a certificate by its verification code (office staff checking a printout). */
export async function verify(code) {
  const c = String(code ?? '').trim().toUpperCase();
  if (!/^[0-9A-F]{10}$/.test(c)) throw new AppError('A verification code is 10 letters and digits.', 400, [], 'BAD_CODE');
  const x = await IssuedCertificate.findOne({ verificationCode: c }).lean();
  if (!x) return { valid: false, message: 'No certificate with this code was issued by this school.' };
  return { valid: x.status === 'ISSUED', serialNo: x.serialNo, title: x.title, studentName: x.studentName, admissionNo: x.admissionNo, issuedAt: x.createdAt, status: x.status };
}

export const _test = { DAY };
