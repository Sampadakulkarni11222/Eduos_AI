import { Vehicle, VehicleLog, VEHICLE_TYPES, VEHICLE_DOCUMENTS, VEHICLE_STATUSES } from '../../models/fleet.model.js';
import { Device } from '../../models/device.model.js';
import { AppError } from '../../utils/AppError.js';
import * as tasks from '../tasks/tasks.service.js';
import { getSettings } from '../safety/shared.js';
import {
  assertObjectId, cleanAttachments, dto, oneOf, optionalText, parseDate, pushHistory, requireText, startOfDayUtc,
} from '../ops/common.js';

/**
 * Vehicles: lawful capacity, usable seats, papers with expiry, safety checks,
 * odometer, fuel, service schedule and breakdowns.
 *
 * Every date that falls due becomes an item in the shared tasks queue
 * (department TRANSPORT), so a lapsing permit or an overdue fire-extinguisher
 * check reaches an owner with reminders and escalation. A renewed document
 * closes its old item and opens one for the new date.
 */
const DAY = 86_400_000;
const DOC_LABEL = { PERMIT: 'Permit', INSURANCE: 'Insurance', FITNESS: 'Fitness certificate', PUC: 'Pollution (PUC) certificate', RC: 'Registration certificate', OTHER: 'Document' };

/** Expiry state of a date, for badges. */
export function expiryState(validTo, now = new Date()) {
  if (!validTo) return 'MISSING';
  const days = Math.floor((startOfDayUtc(new Date(validTo)) - startOfDayUtc(now)) / DAY);
  if (days < 0) return 'EXPIRED';
  if (days <= 30) return 'EXPIRING';
  return 'VALID';
}

export function presentVehicle(v, now = new Date(), settings = null) {
  const out = dto(v);
  out.documents = (v.documents ?? []).map((d) => ({ ...d, id: String(d._id), state: expiryState(d.validTo, now), daysLeft: d.validTo ? Math.floor((startOfDayUtc(new Date(d.validTo)) - startOfDayUtc(now)) / DAY) : null }));
  out.safetyState = {
    fireExtinguisher: expiryState(v.safety?.fireExtinguisherDueOn, now),
    firstAid: expiryState(v.safety?.firstAidDueOn, now),
    service: v.service?.nextDueOn ? expiryState(v.service.nextDueOn, now) : 'NOT_SCHEDULED',
  };
  // A vehicle is roadworthy for allocation only with these in date.
  const mandatory = ['PERMIT', 'INSURANCE', 'FITNESS', 'PUC'];
  out.blockingDocuments = mandatory.filter((k) => {
    const d = (v.documents ?? []).filter((x) => x.kind === k).sort((a, b) => new Date(b.validTo ?? 0) - new Date(a.validTo ?? 0))[0];
    return !d || expiryState(d.validTo, now) === 'EXPIRED';
  });
  if (settings && v.lastPosition?.receivedAt) out.positionStatus = positionStatus(v.lastPosition, settings, now);
  delete out.history;
  return out;
}

export function positionStatus(pos, settings, now = new Date()) {
  if (!pos?.eventAt) return 'NO_DATA';
  const ageMin = (now - new Date(pos.eventAt)) / 60_000;
  if (ageMin <= settings.fleet.staleMinutes) return 'LIVE';
  if (ageMin <= settings.fleet.offlineMinutes) return 'STALE';
  return 'OFFLINE';
}

function cleanDocuments(list, actor) {
  if (!Array.isArray(list)) return undefined;
  return list.slice(0, 30).map((d) => ({
    kind: oneOf(d.kind, VEHICLE_DOCUMENTS, 'documents.kind'),
    number: optionalText(d.number, { max: 80 }) ?? null,
    issuedOn: parseDate(d.issuedOn, 'documents.issuedOn'),
    validTo: parseDate(d.validTo, 'documents.validTo'),
    attachments: cleanAttachments(d.attachments, actor),
  }));
}

function vehicleFields(body, actor, { partial = false } = {}) {
  const out = {};
  if (!partial || body.registrationNo !== undefined) out.registrationNo = requireText(body.registrationNo, 'registrationNo', { max: 20 }).toUpperCase().replace(/\s+/g, '');
  if (!partial || body.type !== undefined) out.type = oneOf(body.type, VEHICLE_TYPES, 'type', 'BUS');
  if (body.makeModel !== undefined) out.makeModel = optionalText(body.makeModel, { max: 80 }) || null;
  if (!partial || body.lawfulCapacity !== undefined) {
    const n = Number(body.lawfulCapacity);
    if (!Number.isInteger(n) || n < 1 || n > 100) throw new AppError('lawfulCapacity must be a whole number from 1 to 100 (as on the permit)', 400);
    out.lawfulCapacity = n;
  }
  if (!partial || body.usableSeats !== undefined) {
    const n = body.usableSeats === undefined || body.usableSeats === null || body.usableSeats === '' ? out.lawfulCapacity : Number(body.usableSeats);
    if (!Number.isInteger(n) || n < 0) throw new AppError('usableSeats must be a whole number', 400);
    out.usableSeats = n;
  }
  if (body.ownership !== undefined) out.ownership = oneOf(body.ownership, ['OWNED', 'CONTRACTED'], 'ownership');
  for (const f of ['ownerName', 'contractorName', 'contractorPhone']) if (body[f] !== undefined) out[f] = optionalText(body[f], { max: 120 }) || null;
  const docs = cleanDocuments(body.documents, actor);
  if (docs) out.documents = docs;
  if (body.safety && typeof body.safety === 'object') {
    for (const f of ['fireExtinguisherCheckedOn', 'fireExtinguisherDueOn', 'firstAidCheckedOn', 'firstAidDueOn']) {
      if (body.safety[f] !== undefined) out[`safety.${f}`] = parseDate(body.safety[f], `safety.${f}`);
    }
  }
  if (body.odometerKm !== undefined) {
    const n = Number(body.odometerKm);
    if (!Number.isFinite(n) || n < 0) throw new AppError('odometerKm must be a non-negative number', 400);
    out.odometerKm = n;
  }
  if (body.service && typeof body.service === 'object') {
    for (const f of ['everyKm', 'everyDays', 'lastKm']) if (body.service[f] !== undefined) out[`service.${f}`] = body.service[f] === null || body.service[f] === '' ? null : Math.max(0, Number(body.service[f]) || 0);
    for (const f of ['lastOn', 'nextDueOn']) if (body.service[f] !== undefined) out[`service.${f}`] = parseDate(body.service[f], `service.${f}`);
  }
  if (body.defaultDriver && typeof body.defaultDriver === 'object') {
    out['defaultDriver.profileId'] = body.defaultDriver.profileId ? assertObjectId(body.defaultDriver.profileId, 'defaultDriver.profileId') : null;
    out['defaultDriver.name'] = optionalText(body.defaultDriver.name, { max: 120 }) || null;
    out['defaultDriver.phone'] = optionalText(body.defaultDriver.phone, { max: 20 }) || null;
  }
  return out;
}

function checkSeats(v) {
  if (v.usableSeats > v.lawfulCapacity) throw new AppError(`Usable seats (${v.usableSeats}) cannot exceed the lawful capacity (${v.lawfulCapacity}).`, 400, [], 'OVER_LAWFUL_CAPACITY');
}

/** Puts every due date of a vehicle into the tasks queue; closes items for dates that moved. */
export async function syncDueItems(v) {
  const reg = v.registrationNo;
  const wanted = new Map();
  const add = (key, item) => wanted.set(key, item);
  const latest = new Map();
  for (const d of v.documents ?? []) {
    if (!d.validTo) continue;
    const prev = latest.get(d.kind);
    if (!prev || new Date(d.validTo) > new Date(prev.validTo)) latest.set(d.kind, d);
  }
  for (const [kind, d] of latest) {
    const day = new Date(d.validTo).toISOString().slice(0, 10);
    add(`vehicle:${v._id}:doc:${kind}:${day}`, { title: `${reg}: ${DOC_LABEL[kind]} expires`, category: 'RENEWAL', dueAt: d.validTo, severity: ['PERMIT', 'INSURANCE', 'FITNESS'].includes(kind) ? 'HIGH' : 'NORMAL', leadDays: [30, 15, 7, 1] });
  }
  if (v.safety?.fireExtinguisherDueOn) add(`vehicle:${v._id}:check:FIRE:${new Date(v.safety.fireExtinguisherDueOn).toISOString().slice(0, 10)}`, { title: `${reg}: fire extinguisher check due`, category: 'VEHICLE_CHECK', dueAt: v.safety.fireExtinguisherDueOn, severity: 'HIGH', leadDays: [7, 1] });
  if (v.safety?.firstAidDueOn) add(`vehicle:${v._id}:check:FIRST_AID:${new Date(v.safety.firstAidDueOn).toISOString().slice(0, 10)}`, { title: `${reg}: first-aid kit check due`, category: 'VEHICLE_CHECK', dueAt: v.safety.firstAidDueOn, severity: 'NORMAL', leadDays: [7, 1] });
  if (v.service?.nextDueOn) add(`vehicle:${v._id}:service:${new Date(v.service.nextDueOn).toISOString().slice(0, 10)}`, { title: `${reg}: scheduled service due`, category: 'SERVICE', dueAt: v.service.nextDueOn, severity: 'NORMAL', leadDays: [14, 3] });

  const { DueItem } = await import('../../models/dueItem.model.js');
  const open = await DueItem.find({ sourceKey: { $regex: `^vehicle:${v._id}:` }, status: { $in: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED'] } }).select('sourceKey').lean();
  for (const o of open) {
    // eslint-disable-next-line no-await-in-loop -- a handful per vehicle
    if (!wanted.has(o.sourceKey)) await tasks.resolveSource(o.sourceKey, { note: 'Renewed or rescheduled on the vehicle record' });
  }
  if (v.status === 'RETIRED') return;
  for (const [sourceKey, item] of wanted) {
    // eslint-disable-next-line no-await-in-loop
    await tasks.upsertFromSource({
      sourceKey, department: 'TRANSPORT', ...item,
      source: { entityType: 'Vehicle', entityId: String(v._id), link: `/fleet?vehicle=${v._id}` },
    });
  }
}

export async function list(query = {}) {
  const filter = {};
  if (query.status) filter.status = oneOf(query.status, VEHICLE_STATUSES, 'status');
  const [rows, settings] = await Promise.all([Vehicle.find(filter).sort({ registrationNo: 1 }).lean(), getSettings()]);
  const now = new Date();
  return rows.map((v) => presentVehicle(v, now, settings));
}

export async function get(id) {
  const v = await Vehicle.findById(assertObjectId(id)).lean();
  if (!v) throw new AppError('Vehicle not found', 404);
  const logs = await VehicleLog.find({ vehicleId: v._id }).sort({ at: -1 }).limit(100).lean();
  const out = presentVehicle(v, new Date(), await getSettings());
  out.history = v.history ?? [];
  out.logs = logs.map(dto);
  return out;
}

export async function create(actor, body = {}) {
  const fields = vehicleFields(body, actor);
  checkSeats(fields);
  const v = new Vehicle({});
  for (const [k, val] of Object.entries(fields)) v.set(k, val);
  pushHistory(v, actor, 'CREATED');
  try {
    await v.save();
  } catch (err) {
    if (err?.code === 11000) throw new AppError(`A vehicle ${fields.registrationNo} is already registered.`, 409, [], 'DUPLICATE');
    throw err;
  }
  await syncDueItems(v.toObject());
  return get(v._id);
}

export async function update(actor, id, body = {}) {
  const v = await Vehicle.findById(assertObjectId(id));
  if (!v) throw new AppError('Vehicle not found', 404);
  const fields = vehicleFields(body, actor, { partial: true });
  for (const [k, val] of Object.entries(fields)) v.set(k, val);
  checkSeats(v);
  pushHistory(v, actor, 'UPDATED', { note: Object.keys(fields).join(', ') });
  await v.save();
  await syncDueItems(v.toObject());
  return get(v._id);
}

/** ACTIVE ↔ IN_SERVICE ↔ BREAKDOWN, or RETIRED. A vehicle not ACTIVE cannot be put on a trip. */
export async function setStatus(actor, id, body = {}) {
  const v = await Vehicle.findById(assertObjectId(id));
  if (!v) throw new AppError('Vehicle not found', 404);
  const to = oneOf(body.status, VEHICLE_STATUSES, 'status');
  if (v.status === 'RETIRED') throw new AppError('A retired vehicle cannot be changed.', 409, [], 'INVALID_TRANSITION');
  pushHistory(v, actor, 'STATUS', { from: v.status, to, note: body.note });
  v.status = to;
  v.statusNote = optionalText(body.note, { max: 500 }) || null;
  await v.save();
  if (to === 'RETIRED') await syncDueItems(v.toObject());
  return get(v._id);
}

/**
 * Adds a fuel / service / breakdown / odometer / safety-check entry and keeps
 * the vehicle's own figures in step (odometer only moves forward; a service
 * sets the next due date; a safety check sets the next check date).
 */
export async function addLog(actor, id, body = {}) {
  const v = await Vehicle.findById(assertObjectId(id));
  if (!v) throw new AppError('Vehicle not found', 404);
  const kind = oneOf(body.kind, ['FUEL', 'SERVICE', 'BREAKDOWN', 'ODOMETER', 'SAFETY_CHECK'], 'kind');
  const at = parseDate(body.at, 'at') ?? new Date();
  const odometerKm = body.odometerKm === undefined || body.odometerKm === null || body.odometerKm === '' ? null : Number(body.odometerKm);
  if (odometerKm !== null && (!Number.isFinite(odometerKm) || odometerKm < 0)) throw new AppError('odometerKm must be a non-negative number', 400);
  if (odometerKm !== null && odometerKm < (v.odometerKm ?? 0) && kind !== 'BREAKDOWN') {
    throw new AppError(`The odometer reading (${odometerKm} km) is below the last recorded ${v.odometerKm} km.`, 400, [], 'ODOMETER_BACKWARDS');
  }
  const log = {
    vehicleId: v._id, kind, at, odometerKm,
    litres: kind === 'FUEL' ? Math.max(0, Number(body.litres) || 0) : null,
    amountPaise: body.amountPaise === undefined || body.amountPaise === null || body.amountPaise === '' ? null : Math.max(0, Math.round(Number(body.amountPaise) || 0)),
    vendor: optionalText(body.vendor, { max: 120 }) || null,
    note: optionalText(body.note, { max: 2000 }) || null,
    severity: kind === 'BREAKDOWN' ? oneOf(body.severity, ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'], 'severity', 'NORMAL') : null,
    check: kind === 'SAFETY_CHECK' ? oneOf(body.check, ['FIRE_EXTINGUISHER', 'FIRST_AID'], 'check') : null,
    attachments: cleanAttachments(body.attachments, actor),
    byProfileId: actor?.profileId ?? null, byName: actor?.displayName ?? null,
  };
  if (kind === 'FUEL' && !log.litres) throw new AppError('litres is required for a fuel entry', 400);
  const created = await VehicleLog.create(log);
  if (odometerKm !== null && odometerKm > (v.odometerKm ?? 0)) v.odometerKm = odometerKm;
  if (kind === 'SERVICE') {
    v.service.lastOn = at;
    v.service.lastKm = odometerKm ?? v.odometerKm;
    const next = parseDate(body.nextDueOn, 'nextDueOn') ?? (v.service.everyDays ? new Date(at.getTime() + v.service.everyDays * DAY) : null);
    v.service.nextDueOn = next;
    if (v.status === 'IN_SERVICE' && body.backInService !== false) { pushHistory(v, actor, 'STATUS', { from: v.status, to: 'ACTIVE', note: 'Service completed' }); v.status = 'ACTIVE'; }
  }
  if (kind === 'SAFETY_CHECK') {
    const nextDue = parseDate(body.nextDueOn, 'nextDueOn') ?? new Date(at.getTime() + (log.check === 'FIRST_AID' ? 30 : 90) * DAY);
    if (log.check === 'FIRE_EXTINGUISHER') { v.safety.fireExtinguisherCheckedOn = at; v.safety.fireExtinguisherDueOn = nextDue; }
    else { v.safety.firstAidCheckedOn = at; v.safety.firstAidDueOn = nextDue; }
  }
  if (kind === 'BREAKDOWN' && body.takeOffRoad !== false) {
    pushHistory(v, actor, 'STATUS', { from: v.status, to: 'BREAKDOWN', note: log.note });
    v.status = 'BREAKDOWN';
    v.statusNote = log.note;
  }
  pushHistory(v, actor, `LOG_${kind}`, { note: log.note });
  await v.save();
  await syncDueItems(v.toObject());
  return dto(created.toObject());
}

export async function resolveBreakdown(actor, vehicleId, logId, body = {}) {
  const log = await VehicleLog.findOne({ _id: assertObjectId(logId), vehicleId: assertObjectId(vehicleId, 'vehicleId'), kind: 'BREAKDOWN' });
  if (!log) throw new AppError('Breakdown not found', 404);
  if (log.resolvedAt) throw new AppError('Already resolved', 409, [], 'ALREADY_RESOLVED');
  log.resolvedAt = new Date();
  log.resolutionNote = requireText(body.note, 'note', { max: 2000 });
  await log.save();
  const v = await Vehicle.findById(vehicleId);
  if (v && v.status === 'BREAKDOWN') {
    pushHistory(v, actor, 'STATUS', { from: 'BREAKDOWN', to: 'ACTIVE', note: log.resolutionNote });
    v.status = 'ACTIVE';
    v.statusNote = null;
    await v.save();
  }
  return dto(log.toObject());
}

/** Fuel used and spent per vehicle over a period (litres, paise, km/l where the odometer allows). */
export async function fuelSummary(query = {}) {
  const from = parseDate(query.from, 'from') ?? new Date(Date.now() - 30 * DAY);
  const to = parseDate(query.to, 'to') ?? new Date();
  const rows = await VehicleLog.find({ kind: 'FUEL', at: { $gte: from, $lt: to } }).sort({ at: 1 }).lean();
  const by = new Map();
  for (const r of rows) {
    const k = String(r.vehicleId);
    const e = by.get(k) ?? { vehicleId: k, litres: 0, amountPaise: 0, entries: 0, firstKm: null, lastKm: null };
    e.litres += r.litres ?? 0; e.amountPaise += r.amountPaise ?? 0; e.entries += 1;
    if (r.odometerKm !== null && r.odometerKm !== undefined) { if (e.firstKm === null) e.firstKm = r.odometerKm; e.lastKm = r.odometerKm; }
    by.set(k, e);
  }
  const vehicles = await Vehicle.find({ _id: { $in: [...by.keys()] } }).select('registrationNo').lean();
  const reg = new Map(vehicles.map((v) => [String(v._id), v.registrationNo]));
  return {
    from, to,
    rows: [...by.values()].map((e) => ({
      ...e, registrationNo: reg.get(e.vehicleId) ?? null,
      kmPerLitre: e.firstKm !== null && e.lastKm !== null && e.lastKm > e.firstKm && e.litres ? Math.round(((e.lastKm - e.firstKm) / e.litres) * 10) / 10 : null,
    })),
    note: 'km per litre needs at least two fuel entries with odometer readings; it is not shown otherwise.',
  };
}

/** Links a registered GPS device to a vehicle (one device per vehicle). */
export async function attachGpsDevice(actor, vehicleId, deviceId) {
  const v = await Vehicle.findById(assertObjectId(vehicleId, 'vehicleId'));
  if (!v) throw new AppError('Vehicle not found', 404);
  if (!deviceId) {
    if (v.gpsDeviceId) await Device.updateOne({ _id: v.gpsDeviceId }, { $set: { 'gps.vehicleId': null } });
    v.gpsDeviceId = null;
  } else {
    const d = await Device.findOne({ _id: assertObjectId(deviceId, 'deviceId'), kind: 'GPS' });
    if (!d) throw new AppError('GPS device not found', 404);
    await Vehicle.updateMany({ gpsDeviceId: d._id, _id: { $ne: v._id } }, { $set: { gpsDeviceId: null } });
    d.gps.vehicleId = v._id;
    await d.save();
    v.gpsDeviceId = d._id;
  }
  pushHistory(v, actor, 'GPS_DEVICE', { note: deviceId ? `Device linked` : 'Device unlinked' });
  await v.save();
  return get(v._id);
}
