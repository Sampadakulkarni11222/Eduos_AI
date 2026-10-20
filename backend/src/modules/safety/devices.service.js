import { Device, DEVICE_KINDS, CHECKPOINT_POINTS } from '../../models/device.model.js';
import { Vehicle } from '../../models/fleet.model.js';
import { AppError } from '../../utils/AppError.js';
import { assertObjectId, dto, oneOf, optionalText, pushHistory, requireText } from '../ops/common.js';
import { newDeviceKey, newDeviceSecret } from './deviceAuth.js';
import { cleanCameraConfig } from './camera.service.js';

/**
 * The device registry: GPS trackers (transport.fleet.manage), card readers
 * (checkpoints.manage) and camera adapters (camera.devices.manage). The secret
 * is shown once, at registration or rotation; afterwards only its rotation date.
 */
export const KIND_PERMISSION = { GPS: 'transport.fleet.manage', CHECKPOINT: 'checkpoints.manage', CAMERA: 'camera.devices.manage' };

function present(d) {
  const { secretEnc: _secret, ...rest } = dto(d);
  return rest;
}

function assertMay(actor, kind) {
  if (!actor?.permissions?.[KIND_PERMISSION[kind]]) throw new AppError(`Missing permission: ${KIND_PERMISSION[kind]}`, 403);
}

export async function list(actor, query = {}) {
  const kinds = DEVICE_KINDS.filter((k) => actor?.permissions?.[KIND_PERMISSION[k]]);
  const wanted = query.kind ? [oneOf(query.kind, DEVICE_KINDS, 'kind')].filter((k) => kinds.includes(k)) : kinds;
  const rows = await Device.find({ kind: { $in: wanted } }).sort({ kind: 1, label: 1 }).lean();
  return rows.map(present);
}

export async function create(actor, body = {}) {
  const kind = oneOf(body.kind, DEVICE_KINDS, 'kind');
  assertMay(actor, kind);
  const { secret, secretEnc } = newDeviceSecret();
  const d = new Device({ deviceKey: newDeviceKey(kind), kind, label: requireText(body.label, 'label', { max: 120 }), secretEnc, provider: optionalText(body.provider, { max: 60 }) || 'generic-http' });
  if (kind === 'GPS' && body.vehicleId) {
    const v = await Vehicle.findById(assertObjectId(body.vehicleId, 'vehicleId'));
    if (!v) throw new AppError('Vehicle not found', 404);
    d.gps.vehicleId = v._id;
  }
  if (kind === 'CHECKPOINT') {
    const point = oneOf(body.point ?? body.checkpoint?.point, CHECKPOINT_POINTS, 'point');
    d.checkpoint = {
      point, locationLabel: optionalText(body.locationLabel ?? body.checkpoint?.locationLabel, { max: 120 }) || null,
      vehicleId: ['BUS_BOARD', 'BUS_ALIGHT'].includes(point) ? assertObjectId(body.vehicleId ?? body.checkpoint?.vehicleId, 'vehicleId') : null,
      facilityId: null,
    };
  }
  if (kind === 'CAMERA') d.camera = await cleanCameraConfig(body.camera ?? body, actor);
  pushHistory(d, actor, 'REGISTERED');
  await d.save();
  if (kind === 'GPS' && d.gps.vehicleId) {
    await Vehicle.updateOne({ _id: d.gps.vehicleId }, { $set: { gpsDeviceId: d._id } });
  }
  return { ...present(d.toObject()), secret, secretNote: 'Copy this secret into the device now. It will not be shown again.' };
}

export async function rotateSecret(actor, id) {
  const d = await Device.findById(assertObjectId(id));
  if (!d) throw new AppError('Device not found', 404);
  assertMay(actor, d.kind);
  const { secret, secretEnc } = newDeviceSecret();
  d.secretEnc = secretEnc;
  d.secretRotatedAt = new Date();
  pushHistory(d, actor, 'SECRET_ROTATED');
  await d.save();
  return { ...present(d.toObject()), secret, secretNote: 'The old secret stops working now. Copy this one into the device.' };
}

export async function setStatus(actor, id, body = {}) {
  const d = await Device.findById(assertObjectId(id));
  if (!d) throw new AppError('Device not found', 404);
  assertMay(actor, d.kind);
  const to = oneOf(body.status, ['ACTIVE', 'DISABLED'], 'status');
  pushHistory(d, actor, to, { from: d.status, to, note: body.note });
  d.status = to;
  await d.save();
  return present(d.toObject());
}
