import mongoose from 'mongoose';
import { SafetySettings, SafetyAlert } from '../../models/safety.model.js';
import { Student, StudentGuardian } from '../../models/student.model.js';
import { Role } from '../../models/role.model.js';
import { Profile } from '../../models/profile.model.js';
import { AppError } from '../../utils/AppError.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { logger } from '../../utils/logger.js';
import { sendOperational } from '../messaging/messaging.service.js';
import { dto } from '../ops/common.js';

/**
 * Helpers shared by fleet, checkpoints, visitors/pickup, out-pass and camera.
 */

const IST_MS = 330 * 60_000;

/** The India school day of an instant, as UTC midnight (how trips and check-ins key a day). */
export function schoolDay(at = new Date()) {
  const d = new Date(new Date(at).getTime() + IST_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** A `YYYY-MM-DD` (or anything Date accepts) to the school day; defaults to today. */
export function parseSchoolDay(value) {
  if (value === undefined || value === null || value === '') return schoolDay();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00.000Z`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new AppError('date is not a valid date', 400);
  return schoolDay(d);
}

/** Minutes past midnight in India for an instant. */
export function istMinutes(at = new Date()) {
  const d = new Date(new Date(at).getTime() + IST_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** ISO weekday 1=Mon..7=Sun of the India date. */
export function istWeekday(at = new Date()) {
  const d = new Date(new Date(at).getTime() + IST_MS);
  return d.getUTCDay() === 0 ? 7 : d.getUTCDay();
}

/** The school's safety settings, created with defaults on first read. */
export async function getSettings() {
  const found = await SafetySettings.findOne({}).lean();
  if (found) return found;
  try {
    return (await SafetySettings.create({})).toObject();
  } catch (err) {
    if (err?.code === 11000) return SafetySettings.findOne({}).lean();
    throw err;
  }
}

const NUMERIC_LIMITS = {
  fleet: ['delayMinutes', 'arrivalRadiusMeters', 'offRouteMeters', 'staleMinutes', 'offlineMinutes', 'alertRepeatMinutes', 'defaultSpeedKmh'],
  checkpoints: ['duplicateWindowSeconds'],
  visitors: ['defaultBadgeHours', 'overstayGraceMinutes', 'delegateMaxDays'],
  outpass: ['lateGraceMinutes'],
  camera: ['notifyMinConfidence'],
};
const SECTION_PERMISSION = {
  fleet: 'transport.fleet.manage', checkpoints: 'checkpoints.manage', visitors: 'visitors.manage', outpass: 'hostel.outpass.manage', camera: 'camera.devices.manage',
};

/** Changes settings section by section; each section needs its own manage permission. */
export async function updateSettings(actor, body = {}) {
  const current = await getSettings();
  const $set = {};
  for (const [section, fields] of Object.entries(NUMERIC_LIMITS)) {
    const incoming = body?.[section];
    if (!incoming || typeof incoming !== 'object') continue;
    if (!actor?.permissions?.[SECTION_PERMISSION[section]]) throw new AppError(`Missing permission: ${SECTION_PERMISSION[section]}`, 403);
    for (const f of fields) {
      if (incoming[f] === undefined) continue;
      const n = Number(incoming[f]);
      if (!Number.isFinite(n)) throw new AppError(`${section}.${f} must be a number`, 400);
      $set[`${section}.${f}`] = n;
    }
    if (section === 'fleet' && incoming.unverifiedCrewPolicy !== undefined) {
      const v = String(incoming.unverifiedCrewPolicy).toUpperCase();
      if (!['WARN', 'BLOCK'].includes(v)) throw new AppError('fleet.unverifiedCrewPolicy must be WARN or BLOCK', 400);
      $set['fleet.unverifiedCrewPolicy'] = v;
    }
    if (section === 'checkpoints' && incoming.flagUnauthorisedDeparture !== undefined) $set['checkpoints.flagUnauthorisedDeparture'] = Boolean(incoming.flagUnauthorisedDeparture);
  }
  if (!Object.keys($set).length) return dto(current);
  const updated = await SafetySettings.findOneAndUpdate({ _id: current._id }, { $set }, { new: true, runValidators: true }).lean();
  return dto(updated);
}

/** Active profiles in this school whose role holds a permission key. */
export async function profilesWithPermission(keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  const roles = await Role.find({ permissions: { $elemMatch: { key: { $in: list } } } }).select('_id').lean();
  if (!roles.length) return [];
  const tenantId = currentTenantId();
  return Profile.find({ roleId: { $in: roles.map((r) => r._id) }, status: 'ACTIVE', deletedAt: null, ...(tenantId ? { tenantId } : {}) })
    .select('_id displayName').lean();
}

/** Guardian profile ids of a student. */
export async function guardianProfileIds(studentId) {
  const links = await StudentGuardian.find({ studentId }).select('guardianProfileId').lean();
  return links.map((l) => String(l.guardianProfileId));
}

export const studentName = (s) => (s ? `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() : null);

/**
 * The students an actor may act for on their own account: a student's own
 * record, a parent's linked children. Staff get [] (they use ALL-scope paths).
 */
export async function ownStudentIds(actor) {
  if (!actor?.profileId) return [];
  if (actor.roleKey === 'STUDENT') {
    const s = await Student.findOne({ profileId: actor.profileId, deletedAt: null }).select('_id').lean();
    return s ? [String(s._id)] : [];
  }
  if (actor.roleKey === 'PARENT') {
    const links = await StudentGuardian.find({ guardianProfileId: actor.profileId }).select('studentId').lean();
    return links.map((l) => String(l.studentId));
  }
  return [];
}

/** Loads a student in this school or 404s. */
export async function loadStudent(studentId) {
  if (!studentId || !mongoose.isValidObjectId(String(studentId))) throw new AppError('Invalid studentId', 400);
  const s = await Student.findOne({ _id: studentId, deletedAt: null }).select('_id firstName lastName admissionNo profileId').lean();
  if (!s) throw new AppError('Student not found', 404);
  return s;
}

/**
 * Raises (or refreshes) an operational alert. One alert per dedupeKey: a
 * repeat increments its count instead of adding another, and a resolved one
 * is reopened. Recipients are told once per opening, content kept short.
 * Never throws: an alert failing must not undo the action that raised it.
 */
export async function raiseAlert({
  kind, severity = 'WARNING', department = 'SAFETY', message, studentId = null, tripId = null, vehicleId = null,
  refType = null, refId = null, dedupeKey, notifyPermission = null, notifyProfileIds = [], link = null, now = new Date(),
}) {
  try {
    const prior = await SafetyAlert.findOneAndUpdate(
      { dedupeKey },
      {
        $setOnInsert: { kind, severity, department, studentId, tripId, vehicleId, refType, refId: refId ? String(refId) : null, dedupeKey },
        $set: { message, lastSeenAt: now },
        $inc: { count: 1 },
      },
      { upsert: true, new: false },
    ).lean();
    let opened = !prior;
    if (prior && prior.status === 'RESOLVED') {
      await SafetyAlert.updateOne({ _id: prior._id }, { $set: { status: 'OPEN', resolvedAt: null } });
      opened = true;
    }
    const alert = await SafetyAlert.findOne({ dedupeKey }).lean();
    if (opened) {
      const ids = new Set(notifyProfileIds.map(String));
      if (notifyPermission) for (const p of await profilesWithPermission(notifyPermission)) ids.add(String(p._id));
      if (ids.size) {
        await sendOperational({
          templateKey: 'SAFETY_ALERT', recipientProfileIds: [...ids], variables: { title: message },
          link, idempotencyKey: `safety:${dedupeKey}:${alert.count}`, urgency: severity === 'CRITICAL' ? 'URGENT' : 'NORMAL',
          relatedEntityType: 'SafetyAlert', relatedEntityId: alert._id,
        });
      }
    }
    return { alert: dto(alert), opened };
  } catch (err) {
    logger.error(`Safety alert ${kind} (${dedupeKey}) could not be recorded: ${err.message}`);
    return { alert: null, opened: false };
  }
}

export async function listAlerts(query = {}, { departments = null } = {}) {
  const filter = {};
  if (query.status && query.status !== 'ALL') filter.status = String(query.status).toUpperCase();
  else if (!query.status) filter.status = { $in: ['OPEN', 'ACKNOWLEDGED'] };
  if (departments) filter.department = { $in: departments };
  if (query.kind) filter.kind = String(query.kind).toUpperCase();
  if (query.tripId && mongoose.isValidObjectId(query.tripId)) filter.tripId = query.tripId;
  const rows = await SafetyAlert.find(filter).sort({ lastSeenAt: -1 }).limit(200).lean();
  return rows.map(dto);
}

export async function closeAlert(actor, id, { status = 'RESOLVED', note = null } = {}, { departments = null } = {}) {
  if (!mongoose.isValidObjectId(String(id))) throw new AppError('Invalid id', 400);
  const to = String(status).toUpperCase();
  if (!['ACKNOWLEDGED', 'RESOLVED'].includes(to)) throw new AppError('status must be ACKNOWLEDGED or RESOLVED', 400);
  const a = await SafetyAlert.findOne({ _id: id, ...(departments ? { department: { $in: departments } } : {}) });
  if (!a) throw new AppError('Alert not found', 404);
  a.history.push({ at: new Date(), actorProfileId: actor?.profileId ?? null, actorName: actor?.displayName ?? null, action: to, from: a.status, to, note: note ? String(note).slice(0, 1000) : null });
  a.status = to;
  if (to === 'RESOLVED') { a.resolvedAt = new Date(); a.resolutionNote = note ? String(note).slice(0, 1000) : null; }
  await a.save();
  return dto(a.toObject());
}

/** Great-circle distance in metres. */
export function haversineMeters(a, b) {
  const R = 6_371_000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distance from point p to segment ab, in metres (local flat approximation; fine at city scale). */
export function distanceToSegmentMeters(p, a, b) {
  const kx = 111_320 * Math.cos((p.lat * Math.PI) / 180);
  const ky = 110_540;
  const ax = (a.lng - p.lng) * kx; const ay = (a.lat - p.lat) * ky;
  const bx = (b.lng - p.lng) * kx; const by = (b.lat - p.lat) * ky;
  const dx = bx - ax; const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  const cx = ax + t * dx; const cy = ay + t * dy;
  return Math.sqrt(cx * cx + cy * cy);
}
