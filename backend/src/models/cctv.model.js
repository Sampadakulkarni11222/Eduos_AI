import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry } from '../modules/ops/common.js';

/**
 * Live CCTV viewing (optional; the `cctvLive` feature is off by default).
 *
 * EduOS does not talk to cameras. The school runs its own NVR/VMS or a small
 * gateway (MediaMTX, go2rtc) that turns the cameras' RTSP into HLS or WebRTC
 * (WHEP). A school registers that gateway once and each camera's path on it.
 * The browser never receives the gateway address, a camera path or any
 * credential: it gets a short-lived playback token and plays through the
 * EduOS proxy (HLS) or a server-signed WHEP exchange (see modules/cctv).
 *
 * Credentials are held only as AES-GCM ciphertext (utils/crypto) and are never
 * returned by any endpoint.
 */

/** Why a camera is watched live. Anything else is refused. */
export const CCTV_PURPOSES = ['ENTRY_EXIT', 'PERIMETER_SECURITY', 'CORRIDOR_SAFETY', 'TRANSPORT_SAFETY', 'HOSTEL_SAFETY', 'COMMON_AREA_SAFETY', 'ASSET_PROTECTION', 'EVENT_SAFETY'];
/** Where a live camera may point. Toilets, changing rooms, health room and staff private areas are never on this list. */
export const CCTV_LOCATIONS = ['GATE', 'ENTRANCE', 'PERIMETER', 'PARKING', 'BUS_BAY', 'RECEPTION', 'CORRIDOR', 'STAIRCASE', 'GROUND', 'PLAYGROUND', 'CANTEEN', 'HOSTEL_CORRIDOR', 'LIBRARY', 'LAB', 'CLASSROOM', 'LECTURE_HALL', 'AUDITORIUM', 'STORE', 'SERVER_ROOM'];
/**
 * PUBLIC_AREA: gate, parking, perimeter. COMMON_AREA: corridors, grounds,
 * canteen. RESTRICTED_AREA: classrooms, labs, hostel corridors: a reason is
 * always required to watch one, whatever the school setting.
 */
export const CCTV_PRIVACY_CLASSES = ['PUBLIC_AREA', 'COMMON_AREA', 'RESTRICTED_AREA'];
/** HLS (.m3u8) or WebRTC through WHEP. RTSP cannot play in a browser and is refused. */
export const CCTV_STREAM_TYPES = ['WHEP', 'HLS'];
export const CCTV_HEALTH = ['UNKNOWN', 'ONLINE', 'OFFLINE', 'NOT_CONNECTED'];
export const CCTV_GATEWAY_VENDORS = ['MEDIAMTX', 'GO2RTC', 'NVR_VMS', 'OTHER'];
export const CCTV_AUTH_MODES = ['NONE', 'BASIC', 'BEARER'];
export const CCTV_END_REASONS = ['CLOSED', 'TIMEOUT', 'MAX_DURATION', 'ACCESS_REVOKED', 'STREAM_DISABLED', 'FEATURE_OFF'];

const groupGrantSchema = new Schema({
  roleKey: { type: String, required: true, trim: true, uppercase: true },
  groups: [{ type: String, trim: true, lowercase: true }],
}, { _id: false });

const cctvSettingsSchema = new Schema(
  {
    gateway: {
      baseUrl: { type: String, trim: true, default: null },
      vendor: { type: String, enum: CCTV_GATEWAY_VENDORS, default: 'MEDIAMTX' },
      authMode: { type: String, enum: CCTV_AUTH_MODES, default: 'NONE' },
      // AES-GCM ciphertext of { username, password } or { token }. Never returned.
      credentialsEnc: { type: String, default: null },
      connectedAt: { type: Date, default: null },
      lastTestAt: { type: Date, default: null },
      lastTestOk: { type: Boolean, default: null },
      lastTestMessage: { type: String, default: null },
    },
    reasonRequired: { type: Boolean, default: false },
    // Ask "still watching?" after this many minutes without a confirmation.
    idleMinutes: { type: Number, min: 2, max: 30, default: 10 },
    // A single viewing ends after this long; a new one (with its own log entry) can start.
    maxSessionMinutes: { type: Number, min: 5, max: 240, default: 60 },
    // Which camera groups a role holding camera.live.view at OWN scope may watch.
    groupGrants: { type: [groupGrantSchema], default: [] },
    updatedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true }
);

const cctvStreamSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    zone: { type: String, trim: true, default: null },
    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
    locationKind: { type: String, enum: CCTV_LOCATIONS, required: true },
    roomLabel: { type: String, trim: true, default: null },
    purpose: { type: String, enum: CCTV_PURPOSES, required: true },
    // Camera group for per-role grants, e.g. "main-gate", "hostel", "bus-bay".
    group: { type: String, trim: true, lowercase: true, default: 'general' },
    privacyClass: { type: String, enum: CCTV_PRIVACY_CLASSES, default: 'COMMON_AREA' },
    streamType: { type: String, enum: CCTV_STREAM_TYPES, default: 'WHEP' },
    // Path on the school's gateway, relative to its base URL (e.g. "gate-1/whep",
    // "gate-1/index.m3u8"). Never sent to a viewer.
    streamPath: { type: String, trim: true, default: null },
    // Optional per-camera read credentials on the gateway (AES-GCM). Never returned.
    credentialsEnc: { type: String, default: null },
    enabled: { type: Boolean, default: true },
    health: { type: String, enum: CCTV_HEALTH, default: 'UNKNOWN' },
    lastCheckedAt: { type: Date, default: null },
    lastCheckMessage: { type: String, default: null },
    approvalNote: { type: String, default: null },
    approvedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
cctvStreamSchema.index({ tenantId: 1, enabled: 1, zone: 1 });

/** One viewing of one camera by one person: the view log. */
const cctvViewSessionSchema = new Schema(
  {
    streamId: { type: Schema.Types.ObjectId, ref: 'CctvStream', required: true },
    streamName: { type: String, default: null },
    zone: { type: String, default: null },
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    viewerName: { type: String, default: null },
    roleKey: { type: String, default: null },
    reason: { type: String, default: null },
    channel: { type: String, default: 'WEB' },
    startedAt: { type: Date, default: Date.now },
    // Last time the viewer said they were still watching (or the start).
    confirmedAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    endReason: { type: String, enum: [...CCTV_END_REASONS, null], default: null },
    // Binding: SHA-256 of the viewer's address and browser; the token only plays from both.
    ipHash: { type: String, default: null },
    uaHash: { type: String, default: null },
    // WHEP resource on the gateway (server-side only; deleted when the viewing ends).
    whepResourceEnc: { type: String, default: null },
    requests: { type: Number, default: 0 },
  },
  { timestamps: true }
);
cctvViewSessionSchema.index({ tenantId: 1, startedAt: -1 });
cctvViewSessionSchema.index({ tenantId: 1, endedAt: 1 });

cctvSettingsSchema.plugin(tenantScoped);
cctvStreamSchema.plugin(tenantScoped);
cctvViewSessionSchema.plugin(tenantScoped);

export const CctvSettings = model('CctvSettings', cctvSettingsSchema);
export const CctvStream = model('CctvStream', cctvStreamSchema);
export const CctvViewSession = model('CctvViewSession', cctvViewSessionSchema);
