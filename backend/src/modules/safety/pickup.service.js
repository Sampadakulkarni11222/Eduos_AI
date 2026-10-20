import mongoose from 'mongoose';
import { PickupAdult, ReleaseLog, Visitor, OutPass } from '../../models/safety.model.js';
import { StudentGuardian, Student, Enrollment } from '../../models/student.model.js';
import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { Profile } from '../../models/profile.model.js';
import { AppError } from '../../utils/AppError.js';
import { generateOtp, hashOtp, compareOtp } from '../../utils/otp.js';
import { sendOtpSms } from '../../providers/notification.provider.js';
import { recordAudit } from '../../utils/auditTrail.js';
import {
  assertObjectId, dto, oneOf, optionalText, parseDate, pushHistory, requireText,
} from '../ops/common.js';
import { getSettings, loadStudent, ownStudentIds, raiseAlert, schoolDay, studentName, guardianProfileIds } from './shared.js';

/**
 * Who may collect a child, and the record of who did.
 *
 *   Guardians linked to the student with pickupAuthorized (student.model.js).
 *   AUTHORISED adults: standing permission, added by the office.
 *   DELEGATES: time-limited, requested by a guardian and confirmed with a
 *     one-time code sent to the guardian's phone, or entered by the office.
 *   RESTRICTED adults: must not receive the child (a custody order). They are
 *     flagged at release, even if they are a linked guardian.
 *
 * A child is released only to one of the above, never to a name typed in at
 * the gate. If nobody authorised is present the child stays with (or returns
 * to) the school, and that is recorded too.
 */
const OTP_TTL_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const RECEIVER_KINDS = ['AUTHORISED', 'DELEGATE', 'RESTRICTED'];

function present(p, { forStaff = true } = {}) {
  const out = dto(p);
  delete out.otpHash;
  delete out.otpAttempts;
  if (!forStaff) delete out.restrictionNote;
  out.validNow = p.status === 'ACTIVE' && (!p.validFrom || new Date(p.validFrom) <= new Date()) && (!p.validTo || new Date(p.validTo) >= new Date());
  return out;
}

async function assertGuardianOf(actor, studentId) {
  const ids = await ownStudentIds(actor);
  if (actor.roleKey !== 'PARENT' || !ids.includes(String(studentId))) throw new AppError('Student not found', 404);
}

/** Everyone who may (or must not) collect a student, for staff at release time. */
export async function adultsForStudent(studentId, now = new Date()) {
  const s = await loadStudent(studentId);
  const [links, adults] = await Promise.all([
    StudentGuardian.find({ studentId: s._id }).lean(),
    PickupAdult.find({ studentId: s._id, status: { $in: ['ACTIVE', 'PENDING_OTP'] } }).sort({ kind: 1, createdAt: -1 }).lean(),
  ]);
  const profiles = await Profile.find({ _id: { $in: links.map((l) => l.guardianProfileId) } }).select('_id displayName').lean();
  const nameOf = new Map(profiles.map((p) => [String(p._id), p.displayName]));
  const restrictedGuardians = new Set(adults.filter((a) => a.kind === 'RESTRICTED' && a.guardianProfileId && a.status === 'ACTIVE').map((a) => String(a.guardianProfileId)));
  return {
    student: { id: String(s._id), name: studentName(s), admissionNo: s.admissionNo },
    guardians: links.map((l) => ({
      guardianProfileId: String(l.guardianProfileId), name: nameOf.get(String(l.guardianProfileId)) ?? 'Guardian', relation: l.relation,
      pickupAuthorized: l.pickupAuthorized !== false && !restrictedGuardians.has(String(l.guardianProfileId)),
      restricted: restrictedGuardians.has(String(l.guardianProfileId)),
    })),
    adults: adults.map((a) => present(a, { forStaff: true })).map((a) => ({ ...a, validNow: a.kind === 'RESTRICTED' ? a.status === 'ACTIVE' : a.validNow })),
    asOf: now,
  };
}

/**
 * Decides whether `receiver` may collect the student now.
 * receiver: { guardianProfileId } | { pickupAdultId } | { name } (a name is only
 * checked against restrictions; it is never enough to release).
 * Returns { ok, kind, name, guardianProfileId, pickupAdultId, restricted, reason }.
 */
export async function checkReceiver(studentId, receiver = {}, now = new Date()) {
  const restrictions = await PickupAdult.find({ studentId, kind: 'RESTRICTED', status: 'ACTIVE' }).lean();
  const restrictedBy = (pred) => restrictions.find(pred);
  if (receiver.guardianProfileId) {
    const gid = assertObjectId(receiver.guardianProfileId, 'guardianProfileId');
    const link = await StudentGuardian.findOne({ studentId, guardianProfileId: gid }).lean();
    const profile = await Profile.findById(gid).select('displayName').lean();
    const name = profile?.displayName ?? 'Guardian';
    const r = restrictedBy((x) => String(x.guardianProfileId) === gid);
    if (r) return { ok: false, restricted: true, name, guardianProfileId: gid, restrictionId: String(r._id), reason: 'This adult is under a custody restriction for this child.' };
    if (!link) return { ok: false, name, reason: 'This person is not a guardian of this child.' };
    if (link.pickupAuthorized === false) return { ok: false, name, reason: 'This guardian is not authorised to collect the child.' };
    return { ok: true, kind: 'GUARDIAN', name, guardianProfileId: gid };
  }
  if (receiver.pickupAdultId) {
    const a = await PickupAdult.findOne({ _id: assertObjectId(receiver.pickupAdultId, 'pickupAdultId'), studentId }).lean();
    if (!a) return { ok: false, reason: 'This adult is not on the child\'s pickup list.' };
    if (a.kind === 'RESTRICTED') return { ok: false, restricted: true, name: a.name, pickupAdultId: String(a._id), restrictionId: String(a._id), reason: 'This adult is under a custody restriction for this child.' };
    const nameRestricted = restrictedBy((x) => x.name && a.name && x.name.trim().toLowerCase() === a.name.trim().toLowerCase());
    if (nameRestricted) return { ok: false, restricted: true, name: a.name, pickupAdultId: String(a._id), restrictionId: String(nameRestricted._id), reason: 'This name matches a custody restriction for this child. Check with the office.' };
    if (a.status !== 'ACTIVE') return { ok: false, name: a.name, reason: a.status === 'PENDING_OTP' ? 'This delegation was never confirmed by the guardian.' : `This authorisation is ${a.status.toLowerCase()}.` };
    if (a.validFrom && new Date(a.validFrom) > now) return { ok: false, name: a.name, reason: `This delegation starts on ${new Date(a.validFrom).toISOString().slice(0, 10)}.` };
    if (a.validTo && new Date(a.validTo) < now) return { ok: false, name: a.name, reason: 'This delegation has expired.' };
    return { ok: true, kind: a.kind === 'DELEGATE' ? 'DELEGATE' : 'AUTHORISED', name: a.name, pickupAdultId: String(a._id) };
  }
  if (receiver.name) {
    const n = String(receiver.name).trim().toLowerCase();
    const r = restrictedBy((x) => x.name && x.name.trim().toLowerCase() === n);
    if (r) return { ok: false, restricted: true, name: receiver.name, restrictionId: String(r._id), reason: 'This name matches a custody restriction for this child.' };
    return { ok: false, name: receiver.name, reason: 'Only a guardian or an adult on the child\'s pickup list can collect the child. Keep the child with the school and call the guardian.' };
  }
  return { ok: false, reason: 'Say who is collecting the child.' };
}

/** Writes the release record. Used by the gate and by the bus drop handover. */
export async function writeReleaseLog(actor, { student, context, tripId = null, check, verification = 'ID_CHECKED', note = null, returnToSchool = false }) {
  const log = await ReleaseLog.create({
    studentId: student._id, studentName: studentName(student), context, tripId,
    receivedByKind: returnToSchool ? 'SCHOOL' : check.kind,
    guardianProfileId: returnToSchool ? null : check.guardianProfileId ?? null,
    pickupAdultId: returnToSchool ? null : check.pickupAdultId ?? null,
    receivedByName: returnToSchool ? 'Kept with / returned to the school' : check.name,
    verification: returnToSchool ? 'NOT_APPLICABLE' : oneOf(verification, ['ID_CHECKED', 'OTP', 'KNOWN_TO_STAFF', 'PHOTO_MATCHED'], 'verification', 'ID_CHECKED'),
    note: optionalText(note, { max: 1000 }) || null,
    recordedByProfileId: actor?.profileId ?? null, recordedByName: actor?.displayName ?? null,
  });
  await recordAudit({ actor, action: 'pickup.release', entityType: 'ReleaseLog', entityId: log._id, after: { context, receivedByKind: log.receivedByKind } });
  return log;
}

/** Raised when a restricted adult tries to collect a child. */
export async function flagRestriction(student, check, context, now = new Date()) {
  await raiseAlert({
    kind: 'CUSTODY_RESTRICTION', severity: 'CRITICAL', department: 'GATE', studentId: student._id,
    message: `Custody restriction: an attempt to collect ${studentName(student)} (${context === 'BUS_DROP' ? 'bus drop' : 'gate'}) was stopped`,
    dedupeKey: `custody:${student._id}:${check.restrictionId}:${schoolDay(now).toISOString().slice(0, 10)}`,
    notifyPermission: ['visitors.manage', 'safeguarding.manage'], link: `/gate?tab=pickup&student=${student._id}`, now,
  });
}

/** Release at the gate (visitors.manage). */
export async function release(actor, body = {}, now = new Date()) {
  const student = await loadStudent(body.studentId);
  const check = await checkReceiver(student._id, body.receiver ?? {}, now);
  if (!check.ok) {
    if (check.restricted) await flagRestriction(student, check, 'GATE', now);
    throw new AppError(check.reason, 409, [], check.restricted ? 'CUSTODY_RESTRICTED' : 'NOT_AUTHORISED');
  }
  const log = await writeReleaseLog(actor, { student, context: body.context === 'HOSTEL' ? 'HOSTEL' : 'GATE', check, verification: body.verification, note: body.note });
  return dto(log.toObject());
}

export async function releaseLog(query = {}) {
  const filter = {};
  if (query.studentId && mongoose.isValidObjectId(query.studentId)) filter.studentId = query.studentId;
  const day = query.date ? schoolDay(new Date(`${query.date}T06:30:00.000Z`)) : null;
  if (day) filter.at = { $gte: new Date(day.getTime() - 330 * 60_000), $lt: new Date(day.getTime() + 86_400_000 - 330 * 60_000) };
  const rows = await ReleaseLog.find(filter).sort({ at: -1 }).limit(300).lean();
  return rows.map(dto);
}

// ── Staff management of the list ─────────────────────────────────────────

export async function listForStudentStaff(studentId) {
  return adultsForStudent(studentId);
}

export async function staffCreate(actor, body = {}) {
  const student = await loadStudent(body.studentId);
  const kind = oneOf(body.kind, RECEIVER_KINDS, 'kind');
  const settings = await getSettings();
  const a = new PickupAdult({
    studentId: student._id, kind,
    name: requireText(body.name, 'name', { max: 120 }),
    relationship: optionalText(body.relationship, { max: 60 }) || null,
    phone: optionalText(body.phone, { max: 20 }) || null,
    photoUrl: optionalText(body.photoUrl, { max: 500 }) || null,
    guardianProfileId: body.guardianProfileId ? assertObjectId(body.guardianProfileId, 'guardianProfileId') : null,
    validFrom: parseDate(body.validFrom, 'validFrom'),
    validTo: parseDate(body.validTo, 'validTo'),
    status: 'ACTIVE', createdVia: 'OFFICE', createdByProfileId: actor.profileId,
    restrictionNote: kind === 'RESTRICTED' ? requireText(body.restrictionNote, 'restrictionNote (the order or instruction this rests on)', { max: 2000 }) : null,
  });
  if (kind === 'DELEGATE') {
    if (!a.validTo) throw new AppError('A delegation needs an end date (validTo).', 400);
    const maxMs = settings.visitors.delegateMaxDays * 86_400_000;
    if (a.validTo - (a.validFrom ?? new Date()) > maxMs) throw new AppError(`A delegation can last at most ${settings.visitors.delegateMaxDays} days.`, 400, [], 'TOO_LONG');
  }
  if (a.validFrom && a.validTo && a.validTo < a.validFrom) throw new AppError('validTo is before validFrom', 400);
  if (kind === 'RESTRICTED' && a.guardianProfileId) {
    // Recorded as a change to the guardian link, so it is auditable.
    await recordAudit({ actor, action: 'guardian.pickup.restricted', entityType: 'StudentGuardian', entityId: `${student._id}:${a.guardianProfileId}` });
  }
  pushHistory(a, actor, 'CREATED', { to: a.status, note: kind === 'RESTRICTED' ? 'Custody restriction recorded' : null });
  await a.save();
  return present(a.toObject());
}

export async function revoke(actor, id, body = {}, { asGuardian = false } = {}) {
  const a = await PickupAdult.findById(assertObjectId(id));
  if (!a) throw new AppError('Not found', 404);
  if (asGuardian) {
    await assertGuardianOf(actor, a.studentId);
    if (a.kind === 'RESTRICTED') throw new AppError('Not found', 404);
  }
  if (['REVOKED', 'EXPIRED'].includes(a.status)) throw new AppError('Already ended', 409, [], 'INVALID_TRANSITION');
  pushHistory(a, actor, 'REVOKED', { from: a.status, to: 'REVOKED', note: body.note });
  a.status = 'REVOKED';
  await a.save();
  return present(a.toObject(), { forStaff: !asGuardian });
}

/** A guardian's pickup records for their own children (no restrictions). */
export async function guardianList(actor) {
  const ids = await ownStudentIds(actor);
  if (actor.roleKey !== 'PARENT') throw new AppError('Only a guardian can manage pickup delegates', 403);
  const [students, rows, links] = await Promise.all([
    Student.find({ _id: { $in: ids } }).select('_id firstName lastName').lean(),
    PickupAdult.find({ studentId: { $in: ids }, kind: { $in: ['AUTHORISED', 'DELEGATE'] }, status: { $in: ['PENDING_OTP', 'ACTIVE'] } }).sort({ createdAt: -1 }).lean(),
    ReleaseLog.find({ studentId: { $in: ids } }).sort({ at: -1 }).limit(20).lean(),
  ]);
  return {
    children: students.map((s) => ({ id: String(s._id), name: studentName(s) })),
    adults: rows.map((r) => present(r, { forStaff: false })),
    recentReleases: links.map((l) => ({ id: String(l._id), studentId: String(l.studentId), studentName: l.studentName, context: l.context, receivedByKind: l.receivedByKind, receivedByName: l.receivedByName, at: l.at })),
  };
}

/** A guardian asks to let someone collect their child for a while; confirmed with a code. */
export async function guardianRequest(actor, body = {}) {
  const student = await loadStudent(body.studentId);
  await assertGuardianOf(actor, student._id);
  const settings = await getSettings();
  const validFrom = parseDate(body.validFrom, 'validFrom') ?? new Date();
  const validTo = parseDate(body.validTo, 'validTo', { required: true });
  if (validTo <= validFrom) throw new AppError('The delegation must end after it starts.', 400);
  if (validTo - validFrom > settings.visitors.delegateMaxDays * 86_400_000) throw new AppError(`A delegation can last at most ${settings.visitors.delegateMaxDays} days.`, 400, [], 'TOO_LONG');
  const code = generateOtp();
  const a = new PickupAdult({
    studentId: student._id, kind: 'DELEGATE',
    name: requireText(body.name, 'name', { max: 120 }),
    relationship: requireText(body.relationship, 'relationship', { max: 60 }),
    phone: optionalText(body.phone, { max: 20 }) || null,
    photoUrl: optionalText(body.photoUrl, { max: 500 }) || null,
    validFrom, validTo, status: 'PENDING_OTP', createdVia: 'GUARDIAN_OTP', createdByProfileId: actor.profileId,
    otpHash: await hashOtp(code), otpExpiresAt: new Date(Date.now() + OTP_TTL_MS), otpAttempts: 0,
  });
  pushHistory(a, actor, 'REQUESTED', { to: 'PENDING_OTP' });
  await a.save();
  const delivery = actor.phone ? await sendOtpSms(actor.phone, code) : { delivered: false };
  return {
    ...present(a.toObject(), { forStaff: false }),
    codeSent: Boolean(delivery?.delivered),
    // Only when the SMS provider is the local console (development); never in production.
    ...(delivery?.devOtp ? { devOtp: delivery.devOtp } : {}),
  };
}

export async function guardianConfirm(actor, id, body = {}) {
  const a = await PickupAdult.findById(assertObjectId(id));
  if (!a) throw new AppError('Not found', 404);
  await assertGuardianOf(actor, a.studentId);
  if (a.status !== 'PENDING_OTP') throw new AppError('This delegation is not waiting for a code.', 409, [], 'INVALID_TRANSITION');
  if (!a.otpExpiresAt || a.otpExpiresAt < new Date()) throw new AppError('The code has expired. Ask again.', 410, [], 'OTP_EXPIRED');
  if (a.otpAttempts >= OTP_MAX_ATTEMPTS) throw new AppError('Too many wrong codes. Ask again.', 429, [], 'OTP_LOCKED');
  const ok = await compareOtp(String(body.code ?? ''), a.otpHash);
  if (!ok) {
    a.otpAttempts += 1;
    await a.save();
    throw new AppError('That code is not right.', 400, [], 'OTP_WRONG');
  }
  a.status = 'ACTIVE';
  a.otpHash = null;
  a.otpExpiresAt = null;
  pushHistory(a, actor, 'CONFIRMED', { from: 'PENDING_OTP', to: 'ACTIVE', note: 'Confirmed with a one-time code' });
  await a.save();
  return present(a.toObject(), { forStaff: false });
}

/** Ends delegations past their date (scheduled). */
export async function expireDelegations(now = new Date()) {
  const r = await PickupAdult.updateMany({ kind: 'DELEGATE', status: 'ACTIVE', validTo: { $lt: now } }, { $set: { status: 'EXPIRED' } });
  const p = await PickupAdult.updateMany({ status: 'PENDING_OTP', otpExpiresAt: { $lt: new Date(now.getTime() - 86_400_000) } }, { $set: { status: 'EXPIRED' } });
  return { expired: r.modifiedCount ?? 0, unconfirmedExpired: p.modifiedCount ?? 0 };
}

// ── Emergency roster ─────────────────────────────────────────────────────

/**
 * Who is on campus now, as far as the records say: students marked present
 * (or late) in today's register who have not been released at the gate or
 * signed out on an out-pass, plus visitors checked in and not out. It is a
 * roster to account for people, not a location tracker; the note says so.
 */
export async function emergencyRoster(now = new Date()) {
  const day = schoolDay(now);
  const marks = await AttendanceRecord.find({ date: day, periodNo: null, status: { $in: ['PRESENT', 'LATE', 'HALF_DAY'] } }).select('enrollmentId status').lean();
  const enrolments = await Enrollment.find({ _id: { $in: marks.map((m) => m.enrollmentId) } }).populate('sectionId', 'name gradeId').select('studentId sectionId rollNo').lean();
  const studentIds = enrolments.map((e) => e.studentId);
  const dayStart = new Date(day.getTime() - 330 * 60_000);
  const [students, released, outs, visitors] = await Promise.all([
    Student.find({ _id: { $in: studentIds } }).select('_id firstName lastName admissionNo').lean(),
    ReleaseLog.find({ studentId: { $in: studentIds }, at: { $gte: dayStart }, receivedByKind: { $ne: 'SCHOOL' } }).select('studentId at receivedByName').lean(),
    OutPass.find({ studentId: { $in: studentIds }, status: 'OUT' }).select('studentId').lean(),
    Visitor.find({ status: 'CHECKED_IN' }).select('name kind organisation location hostName checkedInAt badge').lean(),
  ]);
  const gone = new Set([...released.map((r) => String(r.studentId)), ...outs.map((o) => String(o.studentId))]);
  const byId = new Map(students.map((s) => [String(s._id), s]));
  const rows = enrolments
    .filter((e) => !gone.has(String(e.studentId)))
    .map((e) => ({ studentId: String(e.studentId), name: studentName(byId.get(String(e.studentId))), admissionNo: byId.get(String(e.studentId))?.admissionNo ?? null, section: e.sectionId?.name ?? null, rollNo: e.rollNo ?? null }))
    .sort((a, b) => String(a.section).localeCompare(String(b.section)) || (a.rollNo ?? 0) - (b.rollNo ?? 0));
  return {
    asOf: now,
    students: rows,
    releasedToday: released.length,
    onOutPass: outs.length,
    visitors: visitors.map((v) => ({ id: String(v._id), name: v.name, kind: v.kind, organisation: v.organisation, location: v.location, host: v.hostName, checkedInAt: v.checkedInAt, badge: v.badge?.number ?? null })),
    note: 'From today\'s register, gate releases, out-passes and visitor check-ins. Students whose register is not yet marked are not listed. A checkpoint scan is not proof of where someone is now: account for everyone in person.',
  };
}

export function rosterCsv(r) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Type', 'Name', 'Admission no / organisation', 'Section / host', 'Roll / location', 'Since'].map(esc).join(',')];
  for (const s of r.students) lines.push(['STUDENT', s.name, s.admissionNo, s.section, s.rollNo, ''].map(esc).join(','));
  for (const v of r.visitors) lines.push([v.kind, v.name, v.organisation, v.host, v.location, v.checkedInAt ? new Date(v.checkedInAt).toISOString() : ''].map(esc).join(','));
  lines.push('');
  lines.push(esc(`As of ${new Date(r.asOf).toISOString()}. ${r.note}`));
  return lines.join('\r\n');
}

export { guardianProfileIds };
