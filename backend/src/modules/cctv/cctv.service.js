import {
  CctvSettings, CctvStream, CctvViewSession,
  CCTV_PURPOSES, CCTV_LOCATIONS, CCTV_PRIVACY_CLASSES, CCTV_STREAM_TYPES, CCTV_GATEWAY_VENDORS, CCTV_AUTH_MODES,
} from '../../models/cctv.model.js';
import { FORBIDDEN_CAMERA_LOCATIONS } from '../../models/device.model.js';
import { Facility } from '../../models/facility.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { featureEnabled } from '../../utils/features.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { assertObjectId, oneOf, optionalText, pushHistory, requireText } from '../ops/common.js';
import { FORBIDDEN_TEXT } from '../safety/camera.service.js';
import { parseSchoolDay } from '../safety/shared.js';
import { GatewayRefused, assertGatewayBase, gatewayUrl, gatewayRequest, authHeader } from './gateway.js';
import { signToken, encodeRef, decodeRef, hashOf, rewritePlaylist } from './playback.js';

/**
 * Live CCTV viewing (feature `cctvLive`, off by default).
 *
 * Who: `camera.live.view` (restricted by default; the principal and the
 * safety/compliance officer hold it at ALL scope). A school may grant it to
 * another role at OWN scope and choose which camera groups that role sees
 * (warden: hostel corridors; transport: bus bay). Parents, students and
 * alumni are refused here whatever their grants say.
 *
 * What: view-only. No recording, download or snapshot endpoint exists. Every
 * viewing is a CctvViewSession (who, camera, start, end, reason) mirrored in
 * the audit log. A viewing goes idle unless the viewer confirms "still
 * watching?", and ends after the school's maximum length.
 *
 * Where: only cameras registered at allowed places. Toilets, washrooms,
 * changing rooms, dormitories, the health room and staff private areas are
 * refused (the camera pilot's rules plus the live-view additions below).
 */
export const FAMILY_ROLES = ['PARENT', 'STUDENT', 'ALUMNUS'];
export const LIVE_PERMISSION = 'camera.live.view';
export const CCTV_LIMITS = 'View-only live viewing for authorised staff. No recording, download or snapshots; never for parents, students or alumni; never in toilets, changing rooms, dormitories, the health room or staff private areas. Every view is logged.';
const LIVE_FORBIDDEN_KINDS = [...FORBIDDEN_CAMERA_LOCATIONS, 'HEALTH_ROOM', 'SICK_BAY', 'CLINIC', 'STAFF_ROOM', 'STAFF_LOUNGE', 'COUNSELLING_ROOM', 'DORMITORY_ROOM'];
const LIVE_FORBIDDEN_TEXT = /health\s*room|sick\s*bay|infirmar|clinic|medical|nurse|first[-\s]*aid|staff\s*(room|lounge|rest|common|toilet|changing)|counsel|private|bed\s*room|sleeping|dormitor/i;
const FORBIDDEN_FACILITY_KINDS = ['TOILET', 'CLINIC', 'STAFF_ROOM'];
const PRIVACY_BY_LOCATION = {
  GATE: 'PUBLIC_AREA', ENTRANCE: 'PUBLIC_AREA', PERIMETER: 'PUBLIC_AREA', PARKING: 'PUBLIC_AREA', BUS_BAY: 'PUBLIC_AREA', RECEPTION: 'PUBLIC_AREA',
  CLASSROOM: 'RESTRICTED_AREA', LAB: 'RESTRICTED_AREA', LECTURE_HALL: 'RESTRICTED_AREA', HOSTEL_CORRIDOR: 'RESTRICTED_AREA', LIBRARY: 'RESTRICTED_AREA', SERVER_ROOM: 'RESTRICTED_AREA', STORE: 'RESTRICTED_AREA',
};
const GRACE_MS = 60_000;
const MAX_OPEN_VIEWS = 4;
const HLS_QUERY_PASS = ['_HLS_msn', '_HLS_part', '_HLS_skip'];
const SEGMENT_TYPES = ['video/mp2t', 'video/mp4', 'video/iso.segment', 'audio/mp4', 'audio/aac', 'application/octet-stream', 'application/mp4'];

export const SETUP_STEPS = [
  'Run a video gateway on the school network: MediaMTX or go2rtc (free), or use your NVR/VMS\'s own HLS or WebRTC (WHEP) output.',
  'Add each camera\'s RTSP address to the gateway (RTSP cannot play in a browser; the gateway converts it). Turn audio off.',
  'Publish the gateway on an https:// address EduOS can reach (reverse proxy with a valid certificate, or a tunnel), with a read user and password.',
  'In Live CCTV → Setup, enter the gateway address and its read credentials (stored encrypted, never shown again), then Test connection.',
  'Register each camera with its place, purpose, camera group and its path on the gateway (for example gate-1/whep).',
  'Put up CCTV signage at every monitored area and record the approval; see docs/erp-operations/CCTV-SETUP.md.',
];

// ── access ───────────────────────────────────────────────────────────────

/** 'ALL' | 'OWN' | null. Family roles are always null, even if mis-granted. */
export function liveScope(actor) {
  if (!actor?.profileId) return null;
  if (FAMILY_ROLES.includes(actor.roleKey)) return null;
  const s = actor.permissions?.[LIVE_PERMISSION];
  return s === 'ALL' || s === 'OWN' ? s : null;
}

export function canManage(actor) {
  return Boolean(actor?.profileId && !FAMILY_ROLES.includes(actor.roleKey) && actor.permissions?.['camera.devices.manage']);
}

/** The whole view log: a school-wide viewer who also oversees cameras (principal, safety officer). */
export function canSeeFullLog(actor) {
  return liveScope(actor) === 'ALL' && Boolean(actor.permissions?.['camera.events.review'] || actor.permissions?.['camera.devices.manage']);
}

function refuseFamily(actor) {
  if (FAMILY_ROLES.includes(actor?.roleKey)) throw new AppError('Live CCTV is never available to parents, students or alumni.', 403, [], 'FAMILY_REFUSED');
}

export function assertViewer(actor) {
  refuseFamily(actor);
  const scope = liveScope(actor);
  if (!scope) throw new AppError(`Missing permission: ${LIVE_PERMISSION}`, 403, [], 'NO_LIVE_PERMISSION');
  return scope;
}

export function assertManager(actor) {
  refuseFamily(actor);
  if (!canManage(actor)) throw new AppError('Missing permission: camera.devices.manage', 403);
}

/** null = every group; otherwise the groups this role was granted. */
function groupsFor(actor, settings) {
  const scope = liveScope(actor);
  if (scope === 'ALL') return null;
  if (scope !== 'OWN') return [];
  return settings.groupGrants?.find((g) => g.roleKey === actor.roleKey)?.groups ?? [];
}

function mayWatch(actor, settings, stream) {
  if (!liveScope(actor) || !stream?.enabled) return false;
  const groups = groupsFor(actor, settings);
  return groups === null || groups.includes(stream.group);
}

// ── settings ─────────────────────────────────────────────────────────────

export async function getSettings() {
  const found = await CctvSettings.findOne({}).lean();
  if (found) return found;
  try {
    return (await CctvSettings.create({})).toObject();
  } catch (err) {
    if (err?.code === 11000) return CctvSettings.findOne({}).lean();
    throw err;
  }
}

const gatewayConfigured = (s) => Boolean(s?.gateway?.baseUrl);

function gatewayView(s, { manager }) {
  const g = s.gateway ?? {};
  const base = { configured: gatewayConfigured(s), lastTestAt: g.lastTestAt ?? null, lastTestOk: g.lastTestOk ?? null };
  if (!manager) return base;
  return {
    ...base, baseUrl: g.baseUrl ?? null, vendor: g.vendor ?? 'MEDIAMTX', authMode: g.authMode ?? 'NONE',
    hasCredentials: Boolean(g.credentialsEnc), lastTestMessage: g.lastTestMessage ?? null,
  };
}

function settingsView(s, actor) {
  return {
    gateway: gatewayView(s, { manager: canManage(actor) }),
    reasonRequired: Boolean(s.reasonRequired), idleMinutes: s.idleMinutes ?? 10, maxSessionMinutes: s.maxSessionMinutes ?? 60,
    groupGrants: (s.groupGrants ?? []).map((g) => ({ roleKey: g.roleKey, groups: g.groups ?? [] })),
  };
}

export async function readSettings(actor) {
  assertManager(actor);
  return settingsView(await getSettings(), actor);
}

const GROUP_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
function cleanGroup(v, fallback = 'general') {
  const g = String(v ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  if (!g) return fallback;
  if (!GROUP_RE.test(g)) throw new AppError('A camera group is a short name of letters, digits and dashes (e.g. main-gate, hostel, bus-bay).', 400);
  return g;
}

function cleanCredentials(mode, input) {
  if (mode === 'BASIC') {
    const username = optionalText(input?.username, { max: 120 });
    if (!username) return undefined;
    return encrypt({ username, password: String(input?.password ?? '').slice(0, 300) });
  }
  if (mode === 'BEARER') {
    const token = optionalText(input?.token, { max: 2000 });
    return token ? encrypt({ token }) : undefined;
  }
  return null;
}

export async function updateSettings(actor, body = {}) {
  assertManager(actor);
  const current = await getSettings();
  const $set = {};
  const changed = [];
  if (body.gateway && typeof body.gateway === 'object') {
    const g = body.gateway;
    if (g.baseUrl !== undefined) {
      if (g.baseUrl === null || g.baseUrl === '') {
        Object.assign($set, { 'gateway.baseUrl': null, 'gateway.credentialsEnc': null, 'gateway.connectedAt': null, 'gateway.lastTestOk': null });
      } else {
        let u;
        try { u = assertGatewayBase(g.baseUrl); } catch (err) { throw toAppError(err); }
        $set['gateway.baseUrl'] = u.toString();
        if (u.toString() !== current.gateway?.baseUrl) { $set['gateway.lastTestOk'] = null; $set['gateway.lastTestAt'] = null; }
      }
      changed.push('gateway.baseUrl');
    }
    if (g.vendor !== undefined) { $set['gateway.vendor'] = oneOf(g.vendor, CCTV_GATEWAY_VENDORS, 'gateway.vendor'); changed.push('gateway.vendor'); }
    const mode = g.authMode !== undefined ? oneOf(g.authMode, CCTV_AUTH_MODES, 'gateway.authMode') : (current.gateway?.authMode ?? 'NONE');
    if (g.authMode !== undefined) { $set['gateway.authMode'] = mode; changed.push('gateway.authMode'); }
    const enc = cleanCredentials(mode, g);
    if (enc !== undefined && (enc !== null || g.authMode !== undefined)) {
      $set['gateway.credentialsEnc'] = enc;
      changed.push('gateway.credentials');
    }
    if (g.clearCredentials === true) { $set['gateway.credentialsEnc'] = null; changed.push('gateway.credentials'); }
  }
  if (body.reasonRequired !== undefined) {
    if (typeof body.reasonRequired !== 'boolean') throw new AppError('reasonRequired must be true or false', 400);
    $set.reasonRequired = body.reasonRequired; changed.push('reasonRequired');
  }
  for (const [k, lo, hi] of [['idleMinutes', 2, 30], ['maxSessionMinutes', 5, 240]]) {
    if (body[k] === undefined) continue;
    const n = Number(body[k]);
    if (!Number.isInteger(n) || n < lo || n > hi) throw new AppError(`${k} must be a whole number from ${lo} to ${hi}`, 400);
    $set[k] = n; changed.push(k);
  }
  if (body.groupGrants !== undefined) {
    if (!Array.isArray(body.groupGrants) || body.groupGrants.length > 30) throw new AppError('groupGrants must be a list', 400);
    $set.groupGrants = body.groupGrants.map((g) => {
      const roleKey = requireText(g?.roleKey, 'groupGrants.roleKey', { max: 60 }).toUpperCase();
      if (FAMILY_ROLES.includes(roleKey)) throw new AppError('Camera groups cannot be granted to parents, students or alumni.', 422, [], 'FAMILY_REFUSED');
      const groups = [...new Set((Array.isArray(g?.groups) ? g.groups : []).slice(0, 50).map((x) => cleanGroup(x)))];
      return { roleKey, groups };
    });
    changed.push('groupGrants');
  }
  $set.updatedByProfileId = actor.profileId;
  await CctvSettings.updateOne({ _id: current._id }, { $set });
  // Audit names what changed, never a credential.
  await recordAudit({ actor, action: 'cctv.settings.update', entityType: 'CctvSettings', entityId: current._id, after: { changed } });
  return settingsView(await getSettings(), actor);
}

function toAppError(err) {
  if (err instanceof GatewayRefused) return new AppError(err.message, err.statusCode >= 500 ? 502 : err.statusCode, [], err.code);
  return err;
}

const gatewayCreds = (s) => (s.gateway?.credentialsEnc ? safeDecrypt(s.gateway.credentialsEnc) : null);
function safeDecrypt(v) { try { return decrypt(v); } catch { return null; } }

function headersFor(settings, stream) {
  if (stream?.credentialsEnc) {
    const c = safeDecrypt(stream.credentialsEnc);
    return authHeader(c?.token ? 'BEARER' : 'BASIC', c);
  }
  return authHeader(settings.gateway?.authMode ?? 'NONE', gatewayCreds(settings));
}

// ── camera registry ──────────────────────────────────────────────────────

const ORDER = { PUBLIC_AREA: 0, COMMON_AREA: 1, RESTRICTED_AREA: 2 };

function forbidden() {
  return new AppError('Live cameras are never allowed in toilets, washrooms, changing rooms, dormitories, the health room or staff private areas.', 422, [], 'FORBIDDEN_CAMERA_LOCATION');
}

/** Validates a camera for live view. Reuses the camera pilot's forbidden places and adds the live-view ones. */
export async function cleanStream(input = {}, { partial = false, existing = null } = {}) {
  const out = {};
  const texts = [];
  if (!partial || input.name !== undefined) { out.name = requireText(input.name, 'name', { max: 120 }); texts.push(out.name); }
  if (!partial || input.locationKind !== undefined) {
    const kind = String(input.locationKind ?? '').toUpperCase().trim();
    if (LIVE_FORBIDDEN_KINDS.includes(kind)) throw forbidden();
    out.locationKind = oneOf(kind, CCTV_LOCATIONS, 'locationKind');
  }
  if (input.roomLabel !== undefined) { out.roomLabel = optionalText(input.roomLabel, { max: 120 }) || null; texts.push(out.roomLabel ?? ''); }
  if (input.zone !== undefined) { out.zone = optionalText(input.zone, { max: 80 }) || null; texts.push(out.zone ?? ''); }
  if (input.facilityId !== undefined) {
    if (!input.facilityId) out.facilityId = null;
    else {
      const f = await Facility.findById(assertObjectId(input.facilityId, 'facilityId')).select('_id kind name code').lean();
      if (!f) throw new AppError('Facility not found', 404);
      if (FORBIDDEN_FACILITY_KINDS.includes(f.kind)) throw forbidden();
      texts.push(f.name ?? '');
      const kind = out.locationKind ?? existing?.locationKind;
      if (f.kind === 'HOSTEL' && kind !== 'HOSTEL_CORRIDOR') throw new AppError('In a hostel, a live camera may cover only corridors and common entrances (location HOSTEL_CORRIDOR), never rooms.', 422, [], 'FORBIDDEN_CAMERA_LOCATION');
      out.facilityId = f._id;
      if (out.roomLabel === undefined && !existing?.roomLabel) out.roomLabel = f.name ?? null;
    }
  }
  if (texts.some((t) => FORBIDDEN_TEXT.test(t ?? '') || LIVE_FORBIDDEN_TEXT.test(t ?? ''))) throw forbidden();
  if (!partial || input.purpose !== undefined) out.purpose = oneOf(input.purpose, CCTV_PURPOSES, 'purpose');
  if (!partial || input.group !== undefined) out.group = cleanGroup(input.group);
  if (!partial || input.streamType !== undefined) out.streamType = oneOf(input.streamType, CCTV_STREAM_TYPES, 'streamType', 'WHEP');
  const kind = out.locationKind ?? existing?.locationKind;
  if (!partial || input.privacyClass !== undefined || out.locationKind) {
    const derived = PRIVACY_BY_LOCATION[kind] ?? 'COMMON_AREA';
    const given = input.privacyClass ? oneOf(input.privacyClass, CCTV_PRIVACY_CLASSES, 'privacyClass') : (existing?.privacyClass ?? derived);
    // A school may raise a camera's privacy class, never lower it below what its place implies.
    out.privacyClass = ORDER[given] >= ORDER[derived] ? given : derived;
  }
  if (input.streamPath !== undefined) out.streamPath = cleanPath(input.streamPath, out.streamType ?? existing?.streamType ?? 'WHEP');
  if (input.enabled !== undefined) out.enabled = Boolean(input.enabled);
  if (input.credentials !== undefined) {
    if (input.credentials === null) out.credentialsEnc = null;
    else {
      const c = input.credentials;
      const token = optionalText(c?.token, { max: 2000 });
      const username = optionalText(c?.username, { max: 120 });
      if (token) out.credentialsEnc = encrypt({ token });
      else if (username) out.credentialsEnc = encrypt({ username, password: String(c?.password ?? '').slice(0, 300) });
    }
  }
  if (!partial) out.approvalNote = requireText(input.approvalNote, 'approvalNote (who approved this camera for live viewing, and why)', { max: 1000 });
  else if (input.approvalNote !== undefined) out.approvalNote = requireText(input.approvalNote, 'approvalNote', { max: 1000 });
  return out;
}

function cleanPath(raw, streamType) {
  if (raw === null || raw === '') return null;
  const p = String(raw).trim();
  if (/^rtsps?:/i.test(p)) throw new AppError('RTSP cannot play in a browser. Add the camera to your gateway (MediaMTX/go2rtc) and enter the gateway\'s WHEP or HLS path for it, e.g. gate-1/whep.', 400, [], 'RTSP_NOT_PLAYABLE');
  if (/^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith('//')) throw new AppError('Enter the camera\'s path on the gateway (e.g. gate-1/whep), not a full address. The gateway address is set once in Setup.', 400, [], 'PATH_NOT_RELATIVE');
  if (p.length > 300 || !/^[A-Za-z0-9._~\-/?=&%]+$/.test(p) || p.split('/').includes('..')) throw new AppError('The stream path contains characters that are not allowed.', 400);
  if (streamType === 'HLS' && !/\.m3u8(\?|$)/i.test(p)) throw new AppError('An HLS path ends in .m3u8 (e.g. gate-1/index.m3u8).', 400);
  return p.replace(/^\/+/, '');
}

const facilityNames = async (ids) => new Map((await Facility.find({ _id: { $in: ids.filter(Boolean) } }).select('name').lean()).map((f) => [String(f._id), f.name]));

/** What a viewer may know about a camera: never its path, gateway or credentials. */
function viewerStream(s, names, settings) {
  return {
    id: String(s._id), name: s.name, zone: s.zone ?? null, facilityId: s.facilityId ? String(s.facilityId) : null,
    facilityName: s.facilityId ? names.get(String(s.facilityId)) ?? null : null, locationKind: s.locationKind, roomLabel: s.roomLabel ?? null,
    purpose: s.purpose, group: s.group, privacyClass: s.privacyClass, streamType: s.streamType,
    health: gatewayConfigured(settings) ? s.health : 'NOT_CONNECTED', lastCheckedAt: s.lastCheckedAt ?? null,
    reasonRequired: Boolean(settings.reasonRequired) || s.privacyClass === 'RESTRICTED_AREA',
  };
}

function managerStream(s, names, settings) {
  return {
    ...viewerStream(s, names, settings), enabled: s.enabled, streamPath: s.streamPath ?? null, hasCredentials: Boolean(s.credentialsEnc),
    approvalNote: s.approvalNote ?? null, lastCheckMessage: s.lastCheckMessage ?? null, createdAt: s.createdAt, updatedAt: s.updatedAt,
  };
}

/** Cameras the viewer may watch, by zone. */
export async function listStreams(actor) {
  assertViewer(actor);
  const settings = await getSettings();
  const rows = (await CctvStream.find({ enabled: true }).sort({ zone: 1, name: 1 }).lean()).filter((s) => mayWatch(actor, settings, s));
  const names = await facilityNames(rows.map((r) => r.facilityId));
  return rows.map((s) => viewerStream(s, names, settings));
}

export async function manageStreams(actor) {
  assertManager(actor);
  const settings = await getSettings();
  const rows = await CctvStream.find({}).sort({ zone: 1, name: 1 }).lean();
  const names = await facilityNames(rows.map((r) => r.facilityId));
  return rows.map((s) => managerStream(s, names, settings));
}

export async function createStream(actor, body = {}) {
  assertManager(actor);
  const clean = await cleanStream(body);
  const s = new CctvStream({ ...clean, zone: clean.zone ?? null, approvedByProfileId: actor.profileId });
  pushHistory(s, actor, 'REGISTERED');
  await s.save();
  await recordAudit({ actor, action: 'cctv.stream.create', entityType: 'CctvStream', entityId: s._id, after: { name: s.name, locationKind: s.locationKind, purpose: s.purpose, group: s.group } });
  const settings = await getSettings();
  return managerStream(s.toObject(), await facilityNames([s.facilityId]), settings);
}

export async function updateStream(actor, id, body = {}) {
  assertManager(actor);
  const s = await CctvStream.findById(assertObjectId(id));
  if (!s) throw new AppError('Camera not found', 404);
  const clean = await cleanStream(body, { partial: true, existing: s.toObject() });
  Object.assign(s, clean);
  if (clean.streamPath !== undefined) { s.health = 'UNKNOWN'; s.lastCheckedAt = null; }
  pushHistory(s, actor, 'UPDATED', { note: Object.keys(clean).filter((k) => k !== 'credentialsEnc').join(', ') });
  await s.save();
  await recordAudit({ actor, action: 'cctv.stream.update', entityType: 'CctvStream', entityId: s._id, after: { changed: Object.keys(clean).map((k) => (k === 'credentialsEnc' ? 'credentials' : k)) } });
  if (clean.enabled === false) await endOpenFor({ streamId: s._id }, 'STREAM_DISABLED');
  const settings = await getSettings();
  return managerStream(s.toObject(), await facilityNames([s.facilityId]), settings);
}

// ── status ───────────────────────────────────────────────────────────────

export async function status(actor) {
  refuseFamily(actor);
  const scope = liveScope(actor);
  const manager = canManage(actor);
  if (!scope && !manager) throw new AppError(`Missing permission: ${LIVE_PERMISSION}`, 403, [], 'NO_LIVE_PERMISSION');
  const settings = await getSettings();
  return {
    enabled: await featureEnabled('cctvLive'), canView: Boolean(scope), scope, canManage: manager, canSeeLog: canSeeFullLog(actor),
    gateway: gatewayView(settings, { manager }), reasonRequired: Boolean(settings.reasonRequired), idleMinutes: settings.idleMinutes ?? 10,
    maxSessionMinutes: settings.maxSessionMinutes ?? 60, limits: CCTV_LIMITS, setupSteps: SETUP_STEPS,
  };
}

// ── viewing sessions ─────────────────────────────────────────────────────

function idleMs(settings) { return (settings.idleMinutes ?? 10) * 60_000; }
function maxMs(settings) { return (settings.maxSessionMinutes ?? 60) * 60_000; }

function playbackFor(session, stream, now = Date.now()) {
  const { token, expiresAt } = signToken({ sid: session._id, tid: currentTenantId() }, now);
  const sid = String(session._id);
  return {
    sessionId: sid, streamType: stream.streamType, token, tokenExpiresAt: expiresAt,
    // Paths under the API base; the HLS one carries the token for native players.
    playbackPath: stream.streamType === 'HLS' ? `/cctv/play/${sid}/index.m3u8?t=${encodeURIComponent(token)}` : null,
    whepPath: stream.streamType === 'WHEP' ? `/cctv/play/${sid}/whep` : null,
  };
}

/** Starts a viewing: checks access, reason and gateway, logs it, returns a short-lived token. */
export async function startSession(actor, streamId, body = {}, { now = new Date() } = {}) {
  try { assertViewer(actor); } catch (err) {
    await recordAudit({ actor, action: 'cctv.view.refused', entityType: 'CctvStream', entityId: streamId ?? null, after: { code: err.code ?? 'FORBIDDEN' } });
    throw err;
  }
  const settings = await getSettings();
  const stream = await CctvStream.findById(assertObjectId(streamId, 'streamId')).lean();
  if (!stream || !stream.enabled) throw new AppError('Camera not found', 404);
  if (!mayWatch(actor, settings, stream)) {
    await recordAudit({ actor, action: 'cctv.view.refused', entityType: 'CctvStream', entityId: stream._id, after: { code: 'GROUP_NOT_GRANTED' } });
    throw new AppError('This camera is not in a camera group your role may watch.', 403, [], 'GROUP_NOT_GRANTED');
  }
  if (!gatewayConfigured(settings)) throw new AppError('No camera connected: set up your NVR/gateway first (Live CCTV → Setup).', 409, [], 'GATEWAY_NOT_CONFIGURED');
  if (!stream.streamPath) throw new AppError('This camera has no stream path on the gateway yet.', 409, [], 'NO_STREAM_PATH');
  const needReason = Boolean(settings.reasonRequired) || stream.privacyClass === 'RESTRICTED_AREA';
  const reason = optionalText(body.reason, { max: 300 }) || null;
  if (needReason && (!reason || reason.length < 5)) throw new AppError('Say why you are opening this camera (at least a few words).', 400, [], 'REASON_REQUIRED');
  // One open viewing per camera per person; at most a few at once.
  await endOpenFor({ profileId: actor.profileId, streamId: stream._id }, 'CLOSED', now);
  const open = await CctvViewSession.countDocuments({ profileId: actor.profileId, endedAt: null });
  if (open >= MAX_OPEN_VIEWS) throw new AppError(`You already have ${open} cameras open. Close one first.`, 429, [], 'TOO_MANY_VIEWS');
  const session = await CctvViewSession.create({
    streamId: stream._id, streamName: stream.name, zone: stream.zone ?? null, profileId: actor.profileId, viewerName: actor.displayName ?? null,
    roleKey: actor.roleKey ?? null, reason, channel: body.channel === 'ASK_AI' ? 'ASK_AI' : 'WEB', startedAt: now, confirmedAt: now, lastSeenAt: now,
    ipHash: hashOf(actor.ip), uaHash: hashOf(actor.userAgent),
  });
  await recordAudit({ actor, action: 'cctv.view.start', entityType: 'CctvStream', entityId: stream._id, after: { sessionId: String(session._id), camera: stream.name, reason } });
  return {
    ...playbackFor(session, stream, now.getTime()),
    camera: { id: String(stream._id), name: stream.name, zone: stream.zone ?? null },
    watermark: { name: actor.displayName ?? 'Staff', role: actor.roleKey ?? null },
    idleMinutes: settings.idleMinutes ?? 10, confirmBy: new Date(now.getTime() + idleMs(settings)), endsBy: new Date(now.getTime() + maxMs(settings)),
  };
}

async function closeSession(session, endReason, now = new Date(), { actor = null } = {}) {
  const res = await CctvViewSession.updateOne({ _id: session._id, endedAt: null }, { $set: { endedAt: now, endReason } });
  if (!res.modifiedCount) return false;
  if (session.whepResourceEnc) await deleteWhep(session).catch(() => {});
  await recordAudit({
    actor: actor ?? { profileId: session.profileId }, action: 'cctv.view.end', entityType: 'CctvStream', entityId: session.streamId,
    after: { sessionId: String(session._id), camera: session.streamName, endReason, minutes: Math.round((now - new Date(session.startedAt)) / 6000) / 10 },
  });
  return true;
}

async function endOpenFor(filter, endReason, now = new Date()) {
  const rows = await CctvViewSession.find({ ...filter, endedAt: null }).lean();
  for (const r of rows) await closeSession(r, endReason, now); // eslint-disable-line no-await-in-loop
  return rows.length;
}

async function ownSession(actor, id) {
  const session = await CctvViewSession.findById(assertObjectId(id)).lean();
  if (!session || String(session.profileId) !== String(actor?.profileId)) throw new AppError('Viewing not found', 404);
  return session;
}

/**
 * Renews the token (every few minutes) and, with `stillWatching: true`, records
 * that the viewer answered "still watching?". Re-checks access each time.
 */
export async function renewSession(actor, id, body = {}, { now = new Date() } = {}) {
  const session = await ownSession(actor, id);
  if (session.endedAt) throw new AppError('This viewing has ended.', 410, [], 'SESSION_ENDED');
  const settings = await getSettings();
  const stream = await CctvStream.findById(session.streamId).lean();
  if (!liveScope(actor) || !stream || !mayWatch(actor, settings, stream)) {
    await closeSession(session, stream?.enabled === false ? 'STREAM_DISABLED' : 'ACCESS_REVOKED', now, { actor });
    throw new AppError('You can no longer watch this camera.', 403, [], 'ACCESS_REVOKED');
  }
  const t = now.getTime();
  if (t > new Date(session.startedAt).getTime() + maxMs(settings)) {
    await closeSession(session, 'MAX_DURATION', now, { actor });
    throw new AppError('This viewing reached its time limit. Open the camera again to continue.', 410, [], 'MAX_DURATION');
  }
  const idleDeadline = new Date(session.confirmedAt).getTime() + idleMs(settings);
  if (t > idleDeadline + GRACE_MS) {
    await closeSession(session, 'TIMEOUT', now, { actor });
    throw new AppError('The viewing timed out because nobody confirmed "still watching?".', 410, [], 'SESSION_TIMED_OUT');
  }
  const $set = { lastSeenAt: now };
  if (body.stillWatching === true) $set.confirmedAt = now;
  await CctvViewSession.updateOne({ _id: session._id }, { $set });
  const confirmedAt = $set.confirmedAt ?? session.confirmedAt;
  return {
    ...playbackFor(session, stream, t),
    confirmBy: new Date(new Date(confirmedAt).getTime() + idleMs(settings)),
    endsBy: new Date(new Date(session.startedAt).getTime() + maxMs(settings)),
  };
}

export async function endSession(actor, id, { now = new Date() } = {}) {
  const session = await ownSession(actor, id);
  if (!session.endedAt) await closeSession(session, 'CLOSED', now, { actor });
  return { sessionId: String(session._id), ended: true };
}

/** Ends viewings that went idle or ran past the limit (scheduled, and before the log is read). */
export async function sweepSessions({ now = new Date() } = {}) {
  const open = await CctvViewSession.find({ endedAt: null }).lean();
  if (!open.length) return { ended: 0 };
  const settings = await getSettings();
  let ended = 0;
  for (const s of open) {
    const t = now.getTime();
    let why = null;
    if (t > new Date(s.startedAt).getTime() + maxMs(settings)) why = 'MAX_DURATION';
    else if (t > new Date(s.confirmedAt).getTime() + idleMs(settings) + GRACE_MS) why = 'TIMEOUT';
    // eslint-disable-next-line no-await-in-loop
    if (why && await closeSession(s, why, now)) ended += 1;
  }
  return { ended };
}

// ── playback (token-authenticated; called inside the token's school) ────

const playError = (message, status, code) => new AppError(message, status, [], code);

/**
 * Everything a media request needs, or a refusal: the session must be open,
 * bound to the same address and browser, not idle or over time; the camera
 * enabled; the feature on; the gateway configured.
 */
export async function resolvePlayback(sid, { ip, userAgent }, { now = new Date() } = {}) {
  const session = await CctvViewSession.findById(assertObjectId(sid)).lean();
  if (!session) throw playError('Viewing not found', 404, 'SESSION_NOT_FOUND');
  if (session.endedAt) throw playError('This viewing has ended.', 410, 'SESSION_ENDED');
  if (session.ipHash !== hashOf(ip) || session.uaHash !== hashOf(userAgent)) {
    await recordAudit({ actor: { profileId: null, ip }, action: 'cctv.play.refused', entityType: 'CctvViewSession', entityId: session._id, after: { code: 'BINDING_MISMATCH' } });
    throw playError('This playback link belongs to another browser.', 403, 'BINDING_MISMATCH');
  }
  if (!(await featureEnabled('cctvLive'))) { await closeSession(session, 'FEATURE_OFF', now); throw playError('Live CCTV is switched off for this school.', 403, 'FEATURE_OFF'); }
  const settings = await getSettings();
  const t = now.getTime();
  if (t > new Date(session.startedAt).getTime() + maxMs(settings)) { await closeSession(session, 'MAX_DURATION', now); throw playError('This viewing reached its time limit.', 410, 'MAX_DURATION'); }
  if (t > new Date(session.confirmedAt).getTime() + idleMs(settings) + GRACE_MS) { await closeSession(session, 'TIMEOUT', now); throw playError('This viewing timed out.', 410, 'SESSION_TIMED_OUT'); }
  const stream = await CctvStream.findById(session.streamId).lean();
  if (!stream?.enabled) { await closeSession(session, 'STREAM_DISABLED', now); throw playError('This camera has been switched off.', 410, 'STREAM_DISABLED'); }
  if (!gatewayConfigured(settings)) throw playError('No camera gateway is connected.', 409, 'GATEWAY_NOT_CONFIGURED');
  let base;
  try { base = assertGatewayBase(settings.gateway.baseUrl); } catch (err) { throw toAppError(err); }
  return { session, stream, settings, base };
}

/**
 * Proxies one HLS playlist or segment. `ref` null means the camera's own
 * playlist. Playlists are rewritten so every URI is an opaque proxy path.
 */
export async function proxyHls(ctx, { ref = null, query = {}, prefix, tokenInQuery = false, now = new Date() }) {
  const { session, stream, settings, base } = ctx;
  if (stream.streamType !== 'HLS') throw playError('This camera plays over WebRTC.', 400, 'WRONG_STREAM_TYPE');
  let target;
  try {
    if (ref === null) target = gatewayUrl(base, stream.streamPath);
    else {
      const r = decodeRef(ref);
      if (!r || r.s !== String(stream._id)) throw playError('Not a valid media reference.', 400, 'BAD_REF');
      target = gatewayUrl(base, r.u);
    }
  } catch (err) { throw toAppError(err); }
  for (const k of HLS_QUERY_PASS) if (typeof query[k] === 'string' && /^[0-9a-zA-Z]{1,12}$/.test(query[k])) target.searchParams.set(k, query[k]);
  const looksPlaylist = /\.m3u8$/i.test(target.pathname);
  let res;
  try {
    res = await gatewayRequest(base, target, { headers: headersFor(settings, stream), maxBytes: looksPlaylist ? 1_000_000 : 16_000_000, timeoutMs: looksPlaylist ? 6000 : 15000 });
  } catch (err) { throw toAppError(err); }
  CctvViewSession.updateOne({ _id: session._id }, { $set: { lastSeenAt: now }, $inc: { requests: 1 } }).catch(() => {});
  const ctype = String(res.headers['content-type'] ?? '').toLowerCase();
  const isPlaylist = looksPlaylist || ctype.includes('mpegurl') || res.body.subarray(0, 7).toString('utf8') === '#EXTM3U';
  if (isPlaylist) {
    const qs = tokenInQuery ? `?t=${encodeURIComponent(signToken({ sid: session._id, tid: currentTenantId() }, now.getTime()).token)}` : '';
    const text = rewritePlaylist(res.body.toString('utf8'), res.url, (abs) => {
      try { gatewayUrl(base, abs.toString()); } catch { return null; }
      return `${prefix}/${session._id}/r/${encodeRef(stream._id, abs.toString())}${qs}`;
    });
    return { contentType: 'application/vnd.apple.mpegurl', body: Buffer.from(text, 'utf8') };
  }
  const base0 = ctype.split(';')[0].trim();
  return { contentType: SEGMENT_TYPES.includes(base0) ? base0 : 'application/octet-stream', body: res.body };
}

/** Forwards a WHEP offer with the server's credentials and returns only the SDP answer. */
export async function whepOffer(ctx, sdp) {
  const { session, stream, settings, base } = ctx;
  if (stream.streamType !== 'WHEP') throw playError('This camera plays over HLS.', 400, 'WRONG_STREAM_TYPE');
  const offer = String(sdp ?? '');
  if (!offer.startsWith('v=0') || offer.length > 64_000) throw playError('Not a valid WebRTC offer.', 400, 'BAD_SDP');
  if (session.whepResourceEnc) throw playError('This viewing is already connected; open the camera again to reconnect.', 409, 'ALREADY_CONNECTED');
  let res;
  try {
    const target = gatewayUrl(base, stream.streamPath);
    res = await gatewayRequest(base, target, { method: 'POST', headers: { ...headersFor(settings, stream), 'Content-Type': 'application/sdp', Accept: 'application/sdp' }, body: offer, maxBytes: 64_000, timeoutMs: 10000 });
  } catch (err) { throw toAppError(err); }
  const answer = res.body.toString('utf8');
  if (!answer.startsWith('v=0')) throw playError('The gateway did not return a WebRTC answer.', 502, 'BAD_GATEWAY_ANSWER');
  const location = res.headers.location ? String(res.headers.location) : null;
  if (location) {
    try {
      const u = gatewayUrl(base, new URL(location, res.url).toString());
      await CctvViewSession.updateOne({ _id: session._id }, { $set: { whepResourceEnc: encrypt(u.toString()), lastSeenAt: new Date() }, $inc: { requests: 1 } });
    } catch { /* a resource outside the gateway is ignored, never followed */ }
  }
  return { sdp: answer };
}

async function deleteWhep(session) {
  const url = safeDecrypt(session.whepResourceEnc);
  if (!url) return;
  const settings = await getSettings();
  if (!gatewayConfigured(settings)) return;
  const stream = await CctvStream.findById(session.streamId).lean();
  await gatewayRequest(settings.gateway.baseUrl, url, { method: 'DELETE', headers: headersFor(settings, stream), maxBytes: 10_000, timeoutMs: 4000 });
}

// ── health ───────────────────────────────────────────────────────────────

/** Probes each enabled camera on the gateway and records ONLINE / OFFLINE (no video is fetched). */
export async function checkStreams({ now = new Date() } = {}) {
  const settings = await getSettings();
  const rows = await CctvStream.find({ enabled: true }).limit(200);
  if (!gatewayConfigured(settings)) {
    await CctvStream.updateMany({ enabled: true }, { $set: { health: 'NOT_CONNECTED', lastCheckedAt: now, lastCheckMessage: 'No gateway connected' } });
    return { checked: rows.length, online: 0, offline: 0, connected: false };
  }
  let online = 0; let offline = 0;
  for (const s of rows) {
    let health = 'OFFLINE'; let message = null;
    if (!s.streamPath) message = 'No stream path';
    else {
      try {
        if (s.streamType === 'HLS') {
          // eslint-disable-next-line no-await-in-loop
          const r = await gatewayRequest(settings.gateway.baseUrl, gatewayUrl(settings.gateway.baseUrl, s.streamPath), { headers: headersFor(settings, s), maxBytes: 256_000, timeoutMs: 5000 });
          health = r.body.subarray(0, 7).toString('utf8') === '#EXTM3U' ? 'ONLINE' : 'OFFLINE';
          if (health === 'OFFLINE') message = 'The gateway did not return a playlist';
        } else {
          // eslint-disable-next-line no-await-in-loop
          await gatewayRequest(settings.gateway.baseUrl, gatewayUrl(settings.gateway.baseUrl, s.streamPath), { method: 'OPTIONS', headers: headersFor(settings, s), maxBytes: 10_000, timeoutMs: 5000 });
          health = 'ONLINE';
        }
      } catch (err) { message = err?.message ?? 'Unreachable'; }
    }
    if (health === 'ONLINE') online += 1; else offline += 1;
    s.health = health; s.lastCheckedAt = now; s.lastCheckMessage = message;
    await s.save(); // eslint-disable-line no-await-in-loop
  }
  return { checked: rows.length, online, offline, connected: true };
}

/** The scheduled probe: nothing at all for a school that has not switched live CCTV on or has no cameras. */
export async function scheduledHealthCheck({ now = new Date() } = {}) {
  if (!(await featureEnabled('cctvLive'))) return { skipped: 'cctvLive is off' };
  if (!(await CctvStream.exists({ enabled: true }))) return { checked: 0 };
  return checkStreams({ now });
}

/** "Test connection": reaches the gateway, then probes the cameras. */
export async function testGateway(actor, { now = new Date() } = {}) {
  assertManager(actor);
  const settings = await getSettings();
  if (!gatewayConfigured(settings)) throw new AppError('Enter the gateway address first.', 409, [], 'GATEWAY_NOT_CONFIGURED');
  let ok = false; let message;
  try {
    await gatewayRequest(settings.gateway.baseUrl, settings.gateway.baseUrl, { headers: authHeader(settings.gateway.authMode, gatewayCreds(settings)), maxBytes: 200_000, timeoutMs: 6000 });
    ok = true; message = 'The gateway answered.';
  } catch (err) {
    // Any HTTP answer proves the address, TLS and network path work.
    if (['HTTP_STATUS', 'STREAM_NOT_FOUND'].includes(err?.code)) { ok = true; message = 'The gateway answered (its root page is not a stream, which is normal).'; } else message = err?.message ?? 'Could not reach the gateway';
  }
  await CctvSettings.updateOne({ _id: settings._id }, { $set: { 'gateway.lastTestAt': now, 'gateway.lastTestOk': ok, 'gateway.lastTestMessage': message, ...(ok && !settings.gateway.connectedAt ? { 'gateway.connectedAt': now } : {}) } });
  await recordAudit({ actor, action: 'cctv.gateway.test', entityType: 'CctvSettings', entityId: settings._id, after: { ok } });
  const cameras = ok ? await checkStreams({ now }) : null;
  return { ok, message, cameras };
}

// ── view log ─────────────────────────────────────────────────────────────

const IST_MS = 330 * 60_000;

/** The view log for a school day. The principal / safety officer see everyone; others only their own viewings. */
export async function viewLog(actor, query = {}) {
  assertViewer(actor);
  await sweepSessions();
  const day = parseSchoolDay(query.date);
  const from = new Date(day.getTime() - IST_MS);
  const to = new Date(from.getTime() + 86_400_000);
  const filter = { startedAt: { $gte: from, $lt: to } };
  const full = canSeeFullLog(actor);
  if (!full) filter.profileId = actor.profileId;
  if (query.streamId) filter.streamId = assertObjectId(query.streamId, 'streamId');
  const rows = await CctvViewSession.find(filter).sort({ startedAt: -1 }).limit(500).lean();
  return {
    date: day.toISOString().slice(0, 10), scope: full ? 'ALL' : 'OWN',
    items: rows.map((r) => ({
      id: String(r._id), camera: r.streamName, streamId: String(r.streamId), zone: r.zone ?? null, viewer: r.viewerName, role: r.roleKey, reason: r.reason ?? null,
      channel: r.channel, startedAt: r.startedAt, endedAt: r.endedAt ?? null, endReason: r.endReason ?? null, open: !r.endedAt,
      minutes: Math.round(((r.endedAt ? new Date(r.endedAt) : new Date()) - new Date(r.startedAt)) / 6000) / 10,
    })),
  };
}

