import { LabEquipment, LabDevice, LabSoftware } from '../../models/lab.model.js';
import { Asset, Vendor } from '../../models/finance.model.js';
import { AppError } from '../../utils/AppError.js';
import { reportIssue } from '../administration/facility.service.js';
import {
  requireProfile, assertObjectId, pushHistory, cleanAttachments, parseDate, requireText, optionalText, oneOf, dto, asPaise,
} from '../ops/common.js';
import { ownLabIds, labFilter, loadLab, isStaff } from './labs.access.js';
import { nextLabCode } from './labs.service.js';
import { syncEquipmentDue, syncDeviceDue, syncSoftwareDue } from './labs.due.js';
import { logger } from '../../utils/logger.js';

/**
 * Lab instruments, computers and software seats.
 *
 * An instrument or computer the school bought through procurement already has
 * a finance Asset; the lab record links to it (`assetId`) rather than copying
 * it, and takes its warranty date from it when none is given. Nothing here
 * stores a licence key, password or account: software records hold seats,
 * renewal dates and which devices use a seat.
 */

const DAY = 86_400_000;
const safely = (p, what) => p.catch((err) => logger.error(`Lab task sync (${what}) failed: ${err.message}`));
const CREDENTIAL_FIELD = /(licen[cs]e_?key|product_?key|serial_?key|password|passwd|secret|credential|token|api_?key|activation)/i;

function refuseCredentials(body) {
  const bad = Object.keys(body ?? {}).filter((k) => CREDENTIAL_FIELD.test(k));
  if (bad.length) throw new AppError(`Do not store ${bad.join(', ')} here. Keep licence keys and passwords in the school's password manager.`, 400, [], 'NO_CREDENTIALS');
}

async function assetFor(assetId) {
  if (!assetId) return null;
  const a = await Asset.findById(assertObjectId(assetId, 'assetId')).lean();
  if (!a) throw new AppError('Asset not found in the asset register', 404);
  return a;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

// ── Instruments ───────────────────────────────────────────────────────────

function presentEquipment(e, now = new Date()) {
  const out = dto(e);
  out.calibrationOverdue = Boolean(e.calibrationRequired && e.calibrationDueOn && new Date(e.calibrationDueOn) < now);
  out.calibrationDaysLeft = e.calibrationDueOn ? Math.ceil((new Date(e.calibrationDueOn) - now) / DAY) : null;
  out.usable = e.status === 'ACTIVE' && !e.outOfService && !out.calibrationOverdue;
  out.openRepairs = (e.repairs ?? []).filter((r) => !r.closedAt).length;
  return out;
}

function equipmentFields(body, partial = false) {
  const out = {};
  if (!partial || body.name !== undefined) out.name = requireText(body.name, 'name', { max: 160 });
  for (const f of ['serialNo', 'make', 'amcVendorName']) if (body[f] !== undefined) out[f] = optionalText(body[f], { max: 120 }) || null;
  if (body.quantity !== undefined) out.quantity = Math.max(0, Math.min(Number.parseInt(body.quantity, 10) || 0, 10000));
  if (body.calibrationRequired !== undefined) out.calibrationRequired = body.calibrationRequired === true;
  if (body.calibrationIntervalMonths !== undefined) out.calibrationIntervalMonths = Math.max(1, Math.min(Number.parseInt(body.calibrationIntervalMonths, 10) || 12, 120));
  for (const f of ['calibrationDueOn', 'lastCalibratedOn', 'warrantyUntil', 'amcUntil']) if (body[f] !== undefined) out[f] = parseDate(body[f], f);
  if (body.condition !== undefined) out.condition = oneOf(body.condition, ['GOOD', 'FAIR', 'POOR'], 'condition');
  return out;
}

export async function listEquipment(actor, scope, query = {}) {
  requireProfile(actor);
  const ids = await ownLabIds(actor, scope);
  const filter = { ...labFilter(ids), status: query.status === 'all' ? { $in: ['ACTIVE', 'DISPOSED'] } : 'ACTIVE' };
  if (query.labId) {
    if (ids !== null && !ids.includes(String(query.labId))) throw new AppError('Lab not found', 404);
    filter.labId = assertObjectId(query.labId, 'labId');
  }
  return (await LabEquipment.find(filter).sort({ name: 1 }).limit(2000).select('-history').lean()).map((e) => presentEquipment(e));
}

export async function createEquipment(actor, scope, labId, body = {}) {
  refuseCredentials(body);
  const lab = await loadLab(actor, scope, labId);
  const asset = await assetFor(body.assetId);
  const eq = new LabEquipment({
    labId: lab._id, code: await nextLabCode('LE'), assetId: asset?._id ?? null, ...equipmentFields({ name: asset?.description, ...body }),
  });
  if (!eq.warrantyUntil && asset?.warrantyUntil) eq.warrantyUntil = asset.warrantyUntil;
  if (eq.calibrationRequired && !eq.calibrationDueOn && eq.lastCalibratedOn) eq.calibrationDueOn = addMonths(eq.lastCalibratedOn, eq.calibrationIntervalMonths);
  pushHistory(eq, actor, 'CREATED');
  await eq.save();
  if (asset && !asset.facilityId) await Asset.updateOne({ _id: asset._id }, { $set: { facilityId: lab.facilityId } });
  await safely(syncEquipmentDue(eq.toObject(), { lab: lab.toObject() }), 'equipment');
  return presentEquipment(eq.toObject());
}

async function loadEquipment(actor, scope, id) {
  const eq = await LabEquipment.findById(assertObjectId(id));
  if (!eq) throw new AppError('Instrument not found', 404);
  const lab = await loadLab(actor, scope, eq.labId);
  return { eq, lab };
}

export async function updateEquipment(actor, scope, id, body = {}) {
  refuseCredentials(body);
  const { eq, lab } = await loadEquipment(actor, scope, id);
  Object.assign(eq, equipmentFields(body, true));
  if (body.outOfService !== undefined) {
    eq.outOfService = body.outOfService === true;
    eq.outOfServiceReason = eq.outOfService ? requireText(body.outOfServiceReason, 'outOfServiceReason', { max: 300 }) : null;
    pushHistory(eq, actor, eq.outOfService ? 'OUT_OF_SERVICE' : 'BACK_IN_SERVICE', { note: eq.outOfServiceReason });
  } else pushHistory(eq, actor, 'UPDATED');
  if (body.dispose === true) {
    if (!isStaff(actor)) throw new AppError('Disposal is done by staff.', 403, [], 'STAFF_ONLY');
    eq.status = 'DISPOSED';
    pushHistory(eq, actor, 'DISPOSED', { note: requireText(body.disposeReason, 'disposeReason', { max: 500 }) });
  }
  await eq.save();
  await safely(syncEquipmentDue(eq.toObject(), { lab: lab.toObject() }), 'equipment');
  return presentEquipment(eq.toObject());
}

/** A calibration done: certificate recorded, next due date set from it (or from the interval). */
export async function recordCalibration(actor, scope, id, body = {}) {
  const { eq, lab } = await loadEquipment(actor, scope, id);
  const on = parseDate(body.calibratedOn, 'calibratedOn') ?? new Date();
  const validUntil = parseDate(body.validUntil, 'validUntil') ?? addMonths(on, eq.calibrationIntervalMonths || 12);
  const certificateNo = requireText(body.certificateNo, 'certificateNo', { max: 80 });
  const url = optionalText(body.url, { max: 1000 }) || cleanAttachments(body.evidence, actor)[0]?.url || null;
  eq.certificates.push({ number: certificateNo, issuedOn: on, validUntil, by: optionalText(body.by, { max: 160 }) || null, url });
  eq.lastCalibratedOn = on;
  eq.calibrationDueOn = validUntil;
  eq.calibrationRequired = true;
  pushHistory(eq, actor, 'CALIBRATED', { note: `${certificateNo}, valid until ${validUntil.toISOString().slice(0, 10)}` });
  await eq.save();
  await safely(syncEquipmentDue(eq.toObject(), { lab: lab.toObject() }), 'equipment');
  return presentEquipment(eq.toObject());
}

async function repairEntry(actor, lab, subject, body) {
  const entry = {
    issue: requireText(body.issue, 'issue', { max: 500 }), action: optionalText(body.action, { max: 500 }) || null,
    vendorName: optionalText(body.vendorName, { max: 160 }) || null, costPaise: asPaise(body.costPaise ?? 0, 'costPaise'), byProfileId: actor.profileId ?? null,
  };
  if (body.createWorkOrder === true) {
    const wo = await reportIssue(actor, { facilityId: String(lab.facilityId), assetTag: subject.tag ?? subject.code, title: `${subject.name ?? subject.tag}: ${entry.issue}`.slice(0, 160), category: body.workOrderCategory ?? 'IT', priority: body.priority ?? 'NORMAL' });
    entry.workOrderId = wo.id;
  }
  return entry;
}

export async function addEquipmentRepair(actor, scope, id, body = {}) {
  const { eq, lab } = await loadEquipment(actor, scope, id);
  eq.repairs.push(await repairEntry(actor, lab, eq, { workOrderCategory: 'OTHER', ...body }));
  if (body.outOfService !== false) { eq.outOfService = true; eq.outOfServiceReason = `Under repair: ${eq.repairs.at(-1).issue}`.slice(0, 300); }
  pushHistory(eq, actor, 'REPAIR_LOGGED');
  await eq.save();
  return presentEquipment(eq.toObject());
}

export async function closeEquipmentRepair(actor, scope, id, repairId, body = {}) {
  const { eq } = await loadEquipment(actor, scope, id);
  const r = eq.repairs.id(assertObjectId(repairId, 'repairId'));
  if (!r) throw new AppError('Repair not found', 404);
  r.closedAt = new Date();
  r.action = optionalText(body.action, { max: 500 }) || r.action;
  if (body.costPaise !== undefined) r.costPaise = asPaise(body.costPaise, 'costPaise');
  if (!eq.repairs.some((x) => !x.closedAt) && body.backInService !== false) { eq.outOfService = false; eq.outOfServiceReason = null; }
  pushHistory(eq, actor, 'REPAIR_CLOSED');
  await eq.save();
  return presentEquipment(eq.toObject());
}

// ── Computers ─────────────────────────────────────────────────────────────

function deviceFields(body, partial = false) {
  const out = {};
  if (!partial || body.tag !== undefined) out.tag = requireText(body.tag, 'tag', { max: 40 }).toUpperCase();
  for (const f of ['serialNo', 'make', 'os', 'workstationNo']) if (body[f] !== undefined) out[f] = optionalText(body[f], { max: 120 }) || null;
  if (body.kind !== undefined) out.kind = oneOf(body.kind, ['DESKTOP', 'LAPTOP', 'TABLET', 'PRINTER', 'PROJECTOR', 'NETWORK', 'PERIPHERAL', 'OTHER'], 'kind');
  if (body.hardware && typeof body.hardware === 'object') {
    refuseCredentials(body.hardware);
    out.hardware = {
      cpu: optionalText(body.hardware.cpu, { max: 80 }) || null,
      ramGb: Number(body.hardware.ramGb) >= 0 ? Number(body.hardware.ramGb) : null,
      storageGb: Number(body.hardware.storageGb) >= 0 ? Number(body.hardware.storageGb) : null,
      other: optionalText(body.hardware.other, { max: 200 }) || null,
    };
  }
  for (const f of ['warrantyUntil', 'amcUntil']) if (body[f] !== undefined) out[f] = parseDate(body[f], f);
  if (body.status !== undefined) out.status = oneOf(body.status, ['IN_USE', 'SPARE', 'IN_REPAIR'], 'status');
  return out;
}

function presentDevice(d, softwareByDevice = new Map()) {
  const out = dto(d);
  delete out.history;
  out.openRepairs = (d.repairs ?? []).filter((r) => !r.closedAt).length;
  out.software = softwareByDevice.get(String(d._id)) ?? [];
  return out;
}

export async function listDevices(actor, scope, query = {}) {
  requireProfile(actor);
  const ids = await ownLabIds(actor, scope);
  const filter = { ...labFilter(ids) };
  if (query.labId) {
    if (ids !== null && !ids.includes(String(query.labId))) throw new AppError('Lab not found', 404);
    filter.labId = assertObjectId(query.labId, 'labId');
  }
  if (query.status) filter.status = oneOf(query.status, ['IN_USE', 'SPARE', 'IN_REPAIR', 'DECOMMISSIONED'], 'status');
  else filter.status = { $ne: 'DECOMMISSIONED' };
  const devices = await LabDevice.find(filter).sort({ workstationNo: 1, tag: 1 }).limit(3000).lean();
  const sw = await LabSoftware.find({ deviceIds: { $in: devices.map((d) => d._id) } }).select('name deviceIds').lean();
  const byDevice = new Map();
  for (const s of sw) for (const d of s.deviceIds) byDevice.set(String(d), [...(byDevice.get(String(d)) ?? []), s.name]);
  return devices.map((d) => presentDevice(d, byDevice));
}

export async function createDevices(actor, scope, labId, body = {}) {
  const lab = await loadLab(actor, scope, labId);
  const rows = Array.isArray(body.devices) ? body.devices.slice(0, 200) : [body];
  const out = [];
  for (const row of rows) {
    refuseCredentials(row);
    // eslint-disable-next-line no-await-in-loop
    const asset = await assetFor(row.assetId);
    const fields = deviceFields({ tag: asset?.tag, ...row });
    // eslint-disable-next-line no-await-in-loop
    if (await LabDevice.exists({ tag: fields.tag })) throw new AppError(`A device tagged ${fields.tag} is already registered.`, 409, [], 'DUPLICATE_TAG');
    // eslint-disable-next-line no-await-in-loop
    const d = new LabDevice({ labId: lab._id, code: await nextLabCode('LD'), assetId: asset?._id ?? null, ...fields });
    if (!d.warrantyUntil && asset?.warrantyUntil) d.warrantyUntil = asset.warrantyUntil;
    pushHistory(d, actor, 'CREATED');
    // eslint-disable-next-line no-await-in-loop
    await d.save();
    out.push(presentDevice(d.toObject()));
  }
  await safely(syncDeviceDue(lab._id), 'devices');
  return Array.isArray(body.devices) ? out : out[0];
}

async function loadDevice(actor, scope, id) {
  const d = await LabDevice.findById(assertObjectId(id));
  if (!d) throw new AppError('Device not found', 404);
  const lab = await loadLab(actor, scope, d.labId);
  return { d, lab };
}

export async function updateDevice(actor, scope, id, body = {}) {
  refuseCredentials(body);
  const { d, lab } = await loadDevice(actor, scope, id);
  if (d.status === 'DECOMMISSIONED') throw new AppError('This device has been decommissioned.', 409);
  const fields = deviceFields(body, true);
  if (fields.tag && fields.tag !== d.tag && await LabDevice.exists({ tag: fields.tag })) throw new AppError(`A device tagged ${fields.tag} is already registered.`, 409, [], 'DUPLICATE_TAG');
  Object.assign(d, fields);
  pushHistory(d, actor, 'UPDATED');
  await d.save();
  await safely(syncDeviceDue(lab._id), 'devices');
  return presentDevice(d.toObject());
}

export async function addDeviceRepair(actor, scope, id, body = {}) {
  const { d, lab } = await loadDevice(actor, scope, id);
  if (d.status === 'DECOMMISSIONED') throw new AppError('This device has been decommissioned.', 409);
  d.repairs.push(await repairEntry(actor, lab, d, body));
  d.status = 'IN_REPAIR';
  pushHistory(d, actor, 'REPAIR_LOGGED', { note: d.repairs.at(-1).issue });
  await d.save();
  return presentDevice(d.toObject());
}

export async function closeDeviceRepair(actor, scope, id, repairId, body = {}) {
  const { d } = await loadDevice(actor, scope, id);
  const r = d.repairs.id(assertObjectId(repairId, 'repairId'));
  if (!r) throw new AppError('Repair not found', 404);
  r.closedAt = new Date();
  r.action = optionalText(body.action, { max: 500 }) || r.action;
  if (body.costPaise !== undefined) r.costPaise = asPaise(body.costPaise, 'costPaise');
  if (!d.repairs.some((x) => !x.closedAt)) d.status = oneOf(body.status, ['IN_USE', 'SPARE'], 'status', 'IN_USE');
  pushHistory(d, actor, 'REPAIR_CLOSED');
  await d.save();
  return presentDevice(d.toObject());
}

/** Out of service for good: e-waste handler and evidence are required; its software seats are freed. */
export async function decommissionDevice(actor, scope, id, body = {}) {
  if (!isStaff(actor)) throw new AppError('Decommissioning is done by staff.', 403, [], 'STAFF_ONLY');
  const { d, lab } = await loadDevice(actor, scope, id);
  if (d.status === 'DECOMMISSIONED') throw new AppError('Already decommissioned.', 409);
  const evidence = cleanAttachments(body.evidence, actor);
  if (!evidence.length) throw new AppError('Attach the e-waste handover note or certificate.', 400, [], 'EVIDENCE_REQUIRED');
  d.decommission = {
    at: parseDate(body.at, 'at') ?? new Date(), reason: requireText(body.reason, 'reason', { max: 500 }),
    eWasteHandler: requireText(body.eWasteHandler, 'eWasteHandler (authorised recycler)', { max: 160 }),
    certificateNo: optionalText(body.certificateNo, { max: 80 }) || null, evidence, byProfileId: actor.profileId,
  };
  d.status = 'DECOMMISSIONED';
  d.workstationNo = null;
  pushHistory(d, actor, 'DECOMMISSIONED', { note: d.decommission.reason });
  await d.save();
  await LabSoftware.updateMany({ deviceIds: d._id }, { $pull: { deviceIds: d._id } });
  if (d.assetId) await Asset.updateOne({ _id: d.assetId }, { $set: { status: 'DISPOSED' } });
  await safely(syncDeviceDue(lab._id), 'devices');
  return presentDevice(d.toObject());
}

// ── Software and licence seats ────────────────────────────────────────────

function presentSoftware(s, now = new Date()) {
  const out = dto(s);
  delete out.history;
  out.seatsUsed = (s.deviceIds ?? []).length;
  out.seatsFree = s.seatsTotal ? Math.max(0, s.seatsTotal - out.seatsUsed) : null;
  out.renewalDaysLeft = s.renewalOn ? Math.ceil((new Date(s.renewalOn) - now) / DAY) : null;
  out.deviceIds = (s.deviceIds ?? []).map(String);
  return out;
}

function softwareFields(body, partial = false) {
  refuseCredentials(body);
  const out = {};
  if (!partial || body.name !== undefined) out.name = requireText(body.name, 'name', { max: 160 });
  for (const f of ['publisher', 'version', 'vendorName', 'notes']) if (body[f] !== undefined) out[f] = optionalText(body[f], { max: f === 'notes' ? 1000 : 120 }) || null;
  if (body.licenceType !== undefined) out.licenceType = oneOf(body.licenceType, ['FREE', 'OPEN_SOURCE', 'PERPETUAL', 'SUBSCRIPTION', 'EDUCATION_GRANT'], 'licenceType');
  if (body.seatsTotal !== undefined) out.seatsTotal = Math.max(0, Math.min(Number.parseInt(body.seatsTotal, 10) || 0, 100000));
  if (body.renewalOn !== undefined) out.renewalOn = parseDate(body.renewalOn, 'renewalOn');
  if (body.costPaise !== undefined) out.costPaise = asPaise(body.costPaise, 'costPaise');
  if (body.ownerProfileId !== undefined) out.ownerProfileId = body.ownerProfileId ? assertObjectId(body.ownerProfileId, 'ownerProfileId') : null;
  if (body.active !== undefined) out.active = body.active !== false;
  return out;
}

export async function listSoftware(actor, scope, query = {}) {
  requireProfile(actor);
  const ids = await ownLabIds(actor, scope);
  const filter = ids === null ? {} : { labId: { $in: ids } };
  if (query.labId) filter.labId = assertObjectId(query.labId, 'labId');
  if (ids !== null && query.labId && !ids.includes(String(query.labId))) throw new AppError('Lab not found', 404);
  return (await LabSoftware.find(filter).sort({ name: 1 }).limit(1000).lean()).map((s) => presentSoftware(s));
}

export async function createSoftware(actor, scope, body = {}) {
  requireProfile(actor);
  let labId = null;
  if (body.labId) labId = (await loadLab(actor, scope, body.labId))._id;
  else if (scope !== 'ALL') throw new AppError('Choose the lab this software is for.', 400);
  if (body.vendorId && !(await Vendor.exists({ _id: assertObjectId(body.vendorId, 'vendorId') }))) throw new AppError('Vendor not found', 404);
  const s = new LabSoftware({ labId, vendorId: body.vendorId || null, ...softwareFields(body) });
  pushHistory(s, actor, 'CREATED');
  await s.save();
  await safely(syncSoftwareDue(s.toObject()), 'software');
  return presentSoftware(s.toObject());
}

async function loadSoftware(actor, scope, id) {
  const s = await LabSoftware.findById(assertObjectId(id));
  if (!s) throw new AppError('Software not found', 404);
  if (s.labId) await loadLab(actor, scope, s.labId);
  else if (scope !== 'ALL') throw new AppError('Software not found', 404);
  return s;
}

export async function updateSoftware(actor, scope, id, body = {}) {
  const s = await loadSoftware(actor, scope, id);
  const fields = softwareFields(body, true);
  if (fields.seatsTotal !== undefined && fields.seatsTotal > 0 && fields.seatsTotal < s.deviceIds.length) {
    throw new AppError(`${s.deviceIds.length} devices already use a seat; release some before reducing the seats to ${fields.seatsTotal}.`, 409, [], 'SEATS_IN_USE');
  }
  const renewed = fields.renewalOn && s.renewalOn && fields.renewalOn.getTime() !== s.renewalOn.getTime();
  Object.assign(s, fields);
  pushHistory(s, actor, renewed ? 'RENEWED' : 'UPDATED');
  await s.save();
  await safely(syncSoftwareDue(s.toObject()), 'software');
  return presentSoftware(s.toObject());
}

/** Gives a device a seat. Atomic: the seat count is checked in the same update that takes the seat. */
export async function assignSeat(actor, scope, id, body = {}) {
  const s = await loadSoftware(actor, scope, id);
  const deviceId = assertObjectId(body.deviceId, 'deviceId');
  const device = await LabDevice.findById(deviceId).lean();
  if (!device || device.status === 'DECOMMISSIONED') throw new AppError('Device not found', 404);
  if (s.labId && String(device.labId) !== String(s.labId)) throw new AppError('That device is in another lab.', 400);
  const filter = { _id: s._id, deviceIds: { $ne: device._id } };
  if (s.seatsTotal > 0) filter.$expr = { $lt: [{ $size: '$deviceIds' }, '$seatsTotal'] };
  const updated = await LabSoftware.findOneAndUpdate(filter, { $addToSet: { deviceIds: device._id } }, { new: true }).lean();
  if (!updated) {
    const fresh = await LabSoftware.findById(s._id).lean();
    if (fresh.deviceIds.some((d) => String(d) === String(device._id))) return presentSoftware(fresh);
    throw new AppError(`All ${fresh.seatsTotal} seats of ${fresh.name} are in use.`, 409, [], 'NO_SEATS');
  }
  return presentSoftware(updated);
}

export async function releaseSeat(actor, scope, id, body = {}) {
  const s = await loadSoftware(actor, scope, id);
  const updated = await LabSoftware.findOneAndUpdate({ _id: s._id }, { $pull: { deviceIds: assertObjectId(body.deviceId, 'deviceId') } }, { new: true }).lean();
  return presentSoftware(updated);
}

export { presentEquipment };
