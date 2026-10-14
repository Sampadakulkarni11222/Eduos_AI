import crypto from 'node:crypto';
import { Device, DeviceNonce } from '../../models/device.model.js';
import { AppError } from '../../utils/AppError.js';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { runWithTenant } from '../../tenancy/tenantContext.js';

/**
 * Authentication for devices (GPS trackers, card readers, camera adapters).
 *
 * A device sends four headers:
 *   X-Device-Id         its public deviceKey
 *   X-Device-Timestamp  milliseconds since the epoch when it signed
 *   X-Device-Nonce      a random string, never reused
 *   X-Device-Signature  hex HMAC-SHA256(secret, `${timestamp}.${nonce}.${rawBody}`)
 *
 * Refused: an unknown or disabled device, a wrong signature, a timestamp more
 * than five minutes from the server clock (old captures cannot be replayed
 * later) and a nonce already used (cannot be replayed inside the window
 * either). The request then runs inside the device's school, exactly as a
 * signed-in person's request would.
 *
 * Offline buffering is separate: the *signature* must be fresh, but the points
 * or scans in the body may carry older event times.
 */
export const SIGNATURE_WINDOW_MS = 5 * 60_000;

export function signPayload(secret, timestamp, nonce, rawBody = '') {
  return crypto.createHmac('sha256', String(secret)).update(`${timestamp}.${nonce}.${rawBody}`).digest('hex');
}

/** Creates a device secret: returned once to the person registering the device, stored encrypted. */
export function newDeviceSecret() {
  const secret = crypto.randomBytes(32).toString('base64url');
  return { secret, secretEnc: encrypt(secret) };
}

export function newDeviceKey(kind) {
  return `${String(kind).toLowerCase()}_${crypto.randomBytes(9).toString('base64url')}`;
}

/**
 * Verifies a device request (no Express): returns the device or throws a 401.
 * Exposed for tests and for adapters that receive events another way.
 */
export async function verifyDeviceRequest({ headers = {}, rawBody = '' }, { kinds = null, now = Date.now() } = {}) {
  const h = (name) => {
    const v = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  const deviceKey = h('x-device-id');
  const ts = h('x-device-timestamp');
  const nonce = h('x-device-nonce');
  const signature = h('x-device-signature');
  if (!deviceKey || !ts || !nonce || !signature) throw new AppError('Device signature headers are required', 401, [], 'DEVICE_AUTH_REQUIRED');
  const timestamp = Number(ts);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > SIGNATURE_WINDOW_MS) {
    throw new AppError('Device request timestamp is outside the accepted window', 401, [], 'DEVICE_STALE_SIGNATURE');
  }
  if (String(nonce).length < 8 || String(nonce).length > 128) throw new AppError('Device nonce must be 8–128 characters', 401, [], 'DEVICE_BAD_NONCE');

  // No school context yet: the key is unique across schools.
  const device = await Device.findOne({ deviceKey: String(deviceKey) });
  if (!device || device.status !== 'ACTIVE') throw new AppError('Unknown or disabled device', 401, [], 'DEVICE_UNKNOWN');
  if (kinds && !kinds.includes(device.kind)) throw new AppError('This device may not send to this endpoint', 403, [], 'DEVICE_WRONG_KIND');

  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody ?? '');
  const expected = Buffer.from(signPayload(decrypt(device.secretEnc), timestamp, nonce, body), 'hex');
  const given = Buffer.from(String(signature), 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new AppError('Device signature does not match', 401, [], 'DEVICE_BAD_SIGNATURE');
  }

  return runWithTenant(device.tenantId, async () => {
    try {
      await DeviceNonce.create({ deviceId: device._id, nonce: String(nonce), at: new Date(now) });
    } catch (err) {
      if (err?.code === 11000) throw new AppError('This request was already received (replayed nonce)', 401, [], 'DEVICE_REPLAY');
      throw err;
    }
    await Device.updateOne({ _id: device._id }, { $set: { lastSeenAt: new Date(now) } });
    return device;
  });
}

/** Express middleware: authenticates the device and runs the rest of the request in its school. */
export const deviceAuth = (kinds) => (req, _res, next) => {
  verifyDeviceRequest({ headers: req.headers, rawBody: req.rawBody ?? '' }, { kinds })
    .then((device) => {
      req.device = device;
      req.actor = { system: true, profileId: null, displayName: `Device ${device.label}`, roleKey: 'DEVICE', permissions: {}, tenantId: device.tenantId };
      runWithTenant(device.tenantId, () => next());
    })
    .catch(next);
};

/** True when a request carries device headers (for endpoints open to devices and staff). */
export const hasDeviceHeaders = (req) => Boolean(req.headers['x-device-id']);
