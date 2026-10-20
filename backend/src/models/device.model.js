import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry } from '../modules/ops/common.js';

/**
 * A device that talks to EduOS on its own: a GPS tracker in a bus, an ID card
 * reader at a gate or bus door, or a camera's provider adapter.
 *
 * Devices do not sign in as people. Each has a public `deviceKey` and a
 * per-device secret (held encrypted, because the server has to recompute the
 * HMAC) and signs every request: HMAC-SHA256 over `timestamp.nonce.body`
 * (see modules/safety/deviceAuth.js). The key is unique across all schools so
 * a request can be routed to its school before any school context exists.
 *
 * Registering a device does not connect anything by itself; it only lets a
 * correctly signed request in.
 */
export const DEVICE_KINDS = ['GPS', 'CHECKPOINT', 'CAMERA'];
export const CHECKPOINT_POINTS = ['GATE_IN', 'GATE_OUT', 'BUS_BOARD', 'BUS_ALIGHT', 'LAB', 'LIBRARY'];

/** Camera purposes a school may approve. Anything else is refused. */
export const CAMERA_PURPOSES = ['UNATTENDED_CLASSROOM_CHECK', 'CORRIDOR_SAFETY'];
/** Where a camera of each purpose may point. */
export const CAMERA_LOCATIONS = {
  UNATTENDED_CLASSROOM_CHECK: ['CLASSROOM', 'LAB', 'LECTURE_HALL', 'LIBRARY'],
  CORRIDOR_SAFETY: ['CORRIDOR', 'STAIRCASE', 'ENTRANCE', 'GROUND', 'CANTEEN'],
};
/** Never a camera here, whatever anyone approves. */
export const FORBIDDEN_CAMERA_LOCATIONS = ['TOILET', 'WASHROOM', 'CHANGING_ROOM', 'BATHROOM', 'SHOWER', 'DORMITORY', 'MEDICAL_ROOM'];

const deviceSchema = new Schema(
  {
    deviceKey: { type: String, required: true, trim: true },
    kind: { type: String, enum: DEVICE_KINDS, required: true },
    label: { type: String, required: true, trim: true },
    // AES-GCM ciphertext of the shared secret (utils/crypto). Never returned after creation.
    secretEnc: { type: String, required: true },
    secretRotatedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['ACTIVE', 'DISABLED'], default: 'ACTIVE' },
    provider: { type: String, trim: true, default: null }, // adapter name, e.g. "generic-http", "simulator"
    lastSeenAt: { type: Date, default: null },
    gps: {
      vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', default: null },
    },
    checkpoint: {
      point: { type: String, enum: [...CHECKPOINT_POINTS, null], default: null },
      locationLabel: { type: String, trim: true, default: null },
      vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', default: null },
      facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
    },
    camera: {
      purpose: { type: String, enum: [...CAMERA_PURPOSES, null], default: null },
      locationKind: { type: String, default: null },
      facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
      roomLabel: { type: String, trim: true, default: null },
      retentionDays: { type: Number, min: 1, max: 30, default: 7 },
      approvedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      approvedAt: { type: Date, default: null },
      approvalNote: { type: String, default: null },
      health: { type: String, enum: ['ONLINE', 'OFFLINE', 'UNKNOWN'], default: 'UNKNOWN' },
      lastHeartbeatAt: { type: Date, default: null },
    },
    history: [historyEntry],
  },
  { timestamps: true }
);
// Global, not per school: a signed request names only its device.
deviceSchema.index({ deviceKey: 1 }, { unique: true });
deviceSchema.index({ tenantId: 1, kind: 1 });

/** A nonce a device has used; a second use inside the window is a replay. */
const deviceNonceSchema = new Schema({
  deviceId: { type: Schema.Types.ObjectId, ref: 'Device', required: true },
  nonce: { type: String, required: true },
  at: { type: Date, default: Date.now },
});
deviceNonceSchema.index({ deviceId: 1, nonce: 1 }, { unique: true });
deviceNonceSchema.index({ at: 1 }, { expireAfterSeconds: 3600 });

deviceSchema.plugin(tenantScoped); // school-owned
export const Device = model('Device', deviceSchema);
deviceNonceSchema.plugin(tenantScoped);
export const DeviceNonce = model('DeviceNonce', deviceNonceSchema);
