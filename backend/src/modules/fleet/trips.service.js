import mongoose from 'mongoose';
import { Trip, TripAllocation, Vehicle, TRIP_KINDS } from '../../models/fleet.model.js';
import { TransportRoute, TransportStop, BusEnrollment } from '../../models/transport.model.js';
import { Student } from '../../models/student.model.js';
import { AcademicYear } from '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import { clearanceFor } from '../administration/verification.service.js';
import { sendOperational } from '../messaging/messaging.service.js';
import {
  assertObjectId, dto, nextRef, oneOf, optionalText, pushHistory, requireText,
} from '../ops/common.js';
import {
  getSettings, guardianProfileIds, loadStudent, ownStudentIds, parseSchoolDay, raiseAlert, schoolDay, studentName,
} from '../safety/shared.js';
import { checkReceiver, flagRestriction, writeReleaseLog } from '../safety/pickup.service.js';
import { presentVehicle, positionStatus } from './vehicles.service.js';
import { etaToStop } from './telemetry.service.js';

/**
 * Trips: one run of a route on one date, with seat allocation, boarding,
 * alighting, safe handover at drop and end-of-trip reconciliation.
 *
 * Capacity is enforced ATOMICALLY. A seat is taken by one conditional update
 * on the trip ("seatsAllocated < usableSeats, then +1"); two requests for the
 * last seat cannot both pass it, whichever process they run in. A substitute
 * vehicle is accepted only if it seats everyone already allocated (again one
 * conditional update).
 *
 * Who may act: transport.trips.operate at ALL scope (transport office) on any
 * trip; at OWN scope (a teacher on bus duty) only on trips where they are the
 * attendant (or the driver).
 */
const DAY = 86_400_000;
const LIVE_SEATS = ['ALLOCATED', 'BOARDED', 'ALIGHTED', 'HANDED_OVER', 'RETURNED_TO_SCHOOL', 'NO_SHOW'];
const KIND_LABEL = { MORNING_PICKUP: 'Morning pickup', AFTERNOON_DROP: 'Afternoon drop', EVENT: 'Event trip' };

// ── helpers ──────────────────────────────────────────────────────────────

async function loadTrip(actor, scope, id) {
  const trip = await Trip.findById(assertObjectId(id));
  if (!trip) throw new AppError('Trip not found', 404);
  if (scope !== 'ALL') {
    const mine = [trip.attendant?.profileId, trip.driver?.profileId].filter(Boolean).map(String).includes(String(actor?.profileId));
    if (!mine) throw new AppError('Trip not found', 404);
  }
  return trip;
}

function assertOpen(trip, { allowCompleted = false } = {}) {
  if (trip.status === 'CANCELLED' || (!allowCompleted && trip.status === 'COMPLETED')) {
    throw new AppError(`This trip is ${trip.status.toLowerCase()}.`, 409, [], 'TRIP_CLOSED');
  }
}

/** IST "HH:MM" on a school day → instant. */
function atTime(day, hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? ''));
  if (!m) return null;
  return new Date(day.getTime() + (Number(m[1]) * 60 + Number(m[2]) - 330) * 60_000);
}

/**
 * Checks a driver/attendant's background clearance. With the school's policy
 * at BLOCK an uncleared person cannot be put on a trip; at WARN they can, and
 * the trip records the warning and an alert is raised.
 */
async function crewFrom(input, role, settings) {
  if (!input || (typeof input === 'object' && !input.profileId && !input.name)) return { profileId: null, name: null, phone: null, cleared: null, clearanceNote: null, clearanceCheckedAt: null };
  const profileId = input.profileId ? assertObjectId(input.profileId, `${role}.profileId`) : null;
  const name = optionalText(input.name, { max: 120 }) || null;
  let resolvedName = name;
  if (profileId && !resolvedName) {
    const { Profile } = await import('../../models/profile.model.js');
    const p = await Profile.findOne({ _id: profileId, deletedAt: null }).select('displayName').lean();
    if (!p) throw new AppError(`That ${role} is not a person in this school.`, 404);
    resolvedName = p.displayName;
  }
  const clearance = await clearanceFor(profileId ? { subjectProfileId: profileId } : { subjectName: resolvedName, subjectType: role === 'driver' ? 'DRIVER' : 'ATTENDANT' });
  if (!clearance.cleared && settings.fleet.unverifiedCrewPolicy === 'BLOCK') {
    throw new AppError(`${resolvedName ?? 'This person'} cannot be the ${role}: ${clearance.reason} (school policy blocks uncleared crew).`, 409, [], 'CREW_NOT_CLEARED');
  }
  return {
    profileId, name: resolvedName, phone: optionalText(input.phone, { max: 20 }) || null,
    cleared: Boolean(clearance.cleared), clearanceNote: clearance.cleared ? (clearance.conditions ?? null) : clearance.reason, clearanceCheckedAt: new Date(),
  };
}

async function warnUnclearedCrew(trip) {
  for (const role of ['driver', 'attendant']) {
    const c = trip[role];
    if (c?.name && c.cleared === false) {
      // eslint-disable-next-line no-await-in-loop
      await raiseAlert({
        kind: 'UNVERIFIED_CREW', department: 'TRANSPORT', severity: 'WARNING', tripId: trip._id, vehicleId: trip.vehicleId,
        message: `${trip.refNo}: ${role} ${c.name} has no current clearance (${c.clearanceNote})`,
        dedupeKey: `trip:${trip._id}:crew:${role}:${c.name}`, notifyPermission: 'transport.fleet.manage', link: `/fleet?trip=${trip._id}`,
      });
    }
  }
}

async function roadworthyVehicle(vehicleId) {
  const v = await Vehicle.findById(assertObjectId(vehicleId, 'vehicleId')).lean();
  if (!v) throw new AppError('Vehicle not found', 404);
  if (v.status !== 'ACTIVE') throw new AppError(`${v.registrationNo} is ${v.status.toLowerCase().replace('_', ' ')} and cannot run a trip.`, 409, [], 'VEHICLE_UNAVAILABLE');
  const p = presentVehicle(v);
  if (p.blockingDocuments.length) {
    throw new AppError(`${v.registrationNo} cannot run a trip: ${p.blockingDocuments.join(', ')} missing or expired.`, 409, [], 'VEHICLE_NOT_ROADWORTHY');
  }
  return v;
}

function presentTrip(t) {
  const out = dto(t);
  out.seatsFree = Math.max(0, (t.usableSeats ?? 0) - (t.seatsAllocated ?? 0));
  out.kindLabel = KIND_LABEL[t.kind] ?? t.kind;
  return out;
}

// ── read ─────────────────────────────────────────────────────────────────

export async function list(actor, scope, query = {}) {
  const filter = {};
  if (query.date !== 'ALL') filter.date = parseSchoolDay(query.date);
  if (query.status) filter.status = String(query.status).toUpperCase();
  if (query.vehicleId && mongoose.isValidObjectId(query.vehicleId)) filter.vehicleId = query.vehicleId;
  if (scope !== 'ALL') filter.$or = [{ 'attendant.profileId': actor.profileId }, { 'driver.profileId': actor.profileId }];
  const rows = await Trip.find(filter).sort({ date: -1, kind: 1, refNo: 1 }).limit(200).lean();
  const vehicles = await Vehicle.find({ _id: { $in: rows.map((r) => r.vehicleId) } }).select('registrationNo').lean();
  const reg = new Map(vehicles.map((v) => [String(v._id), v.registrationNo]));
  const counts = await TripAllocation.aggregate([
    { $match: { tripId: { $in: rows.map((r) => r._id) } } },
    { $group: { _id: { t: '$tripId', s: '$status' }, n: { $sum: 1 } } },
  ]);
  const byTrip = new Map();
  for (const c of counts) {
    const k = String(c._id.t);
    const e = byTrip.get(k) ?? {};
    e[c._id.s] = c.n;
    byTrip.set(k, e);
  }
  return rows.map((r) => ({ ...presentTrip(r), registrationNo: reg.get(String(r.vehicleId)) ?? null, counts: byTrip.get(String(r._id)) ?? {}, history: undefined }));
}

export async function get(actor, scope, id) {
  const trip = await loadTrip(actor, scope, id);
  const [allocations, vehicle, settings] = await Promise.all([
    TripAllocation.find({ tripId: trip._id }).sort({ stopName: 1, studentName: 1 }).lean(),
    Vehicle.findById(trip.vehicleId).lean(),
    getSettings(),
  ]);
  const { SafetyAlert } = await import('../../models/safety.model.js');
  const alerts = await SafetyAlert.find({ tripId: trip._id }).sort({ lastSeenAt: -1 }).limit(50).lean();
  const now = new Date();
  const nextStop = [...trip.plannedStops].sort((a, b) => a.sequenceNo - b.sequenceNo).find((s) => !s.arrivedAt) ?? null;
  return {
    ...presentTrip(trip.toObject()),
    vehicle: vehicle ? { id: String(vehicle._id), registrationNo: vehicle.registrationNo, type: vehicle.type, lawfulCapacity: vehicle.lawfulCapacity, usableSeats: vehicle.usableSeats, lastPosition: vehicle.lastPosition, positionStatus: positionStatus(vehicle.lastPosition, settings, now) } : null,
    nextStop: nextStop ? { ...nextStop, eta: etaToStop(trip, vehicle, nextStop, settings, now) } : null,
    allocations: allocations.map(dto),
    alerts: alerts.map(dto),
  };
}

// ── plan ─────────────────────────────────────────────────────────────────

async function plannedStopsFor(routeId, day, kind, startTime) {
  if (!routeId) return [];
  const stops = await TransportStop.find({ routeId }).sort({ sequenceNo: 1 }).lean();
  // Afternoon drop runs the route in reverse.
  const ordered = kind === 'AFTERNOON_DROP' ? [...stops].reverse() : stops;
  const start = atTime(day, startTime);
  const base = ordered.length ? (kind === 'AFTERNOON_DROP' ? ordered[0].etaMinutesFromStart ?? 0 : 0) : 0;
  return ordered.map((s, i) => ({
    stopId: s._id, name: s.name, sequenceNo: i + 1,
    plannedAt: start ? new Date(start.getTime() + Math.abs((s.etaMinutesFromStart ?? 0) - base) * 60_000) : null,
    lat: Number.isFinite(s.lat) ? s.lat : null, lng: Number.isFinite(s.lng) ? s.lng : null,
  }));
}

export async function create(actor, body = {}) {
  const settings = await getSettings();
  const kind = oneOf(body.kind, TRIP_KINDS, 'kind');
  const date = parseSchoolDay(body.date);
  const vehicle = await roadworthyVehicle(body.vehicleId);
  const route = body.routeId ? await TransportRoute.findById(assertObjectId(body.routeId, 'routeId')).lean() : null;
  if (body.routeId && !route) throw new AppError('Route not found', 404);
  if (kind !== 'EVENT' && !route) throw new AppError('A pickup or drop trip needs a route', 400);
  if (route && await Trip.exists({ routeId: route._id, date, kind, status: { $ne: 'CANCELLED' } })) {
    throw new AppError(`A ${KIND_LABEL[kind].toLowerCase()} for ${route.name} on that date already exists.`, 409, [], 'DUPLICATE');
  }
  const startTime = body.startTime ?? (kind === 'AFTERNOON_DROP' ? '14:30' : '07:00');
  const trip = new Trip({
    refNo: await nextRef('TRIP', date),
    routeId: route?._id ?? null, routeName: route?.name ?? null,
    vehicleId: vehicle._id, date, kind,
    title: optionalText(body.title, { max: 160 }) || (route ? `${route.name} — ${KIND_LABEL[kind]}` : requireText(body.title, 'title', { max: 160 })),
    driver: await crewFrom(body.driver ?? (vehicle.defaultDriver?.name || vehicle.defaultDriver?.profileId ? vehicle.defaultDriver : null), 'driver', settings),
    attendant: await crewFrom(body.attendant, 'attendant', settings),
    usableSeats: vehicle.usableSeats,
    plannedStops: Array.isArray(body.plannedStops) && body.plannedStops.length
      ? body.plannedStops.slice(0, 60).map((s, i) => ({ name: requireText(s.name, 'plannedStops.name', { max: 120 }), sequenceNo: i + 1, plannedAt: s.plannedAt ? new Date(s.plannedAt) : atTime(date, s.time), lat: Number.isFinite(Number(s.lat)) ? Number(s.lat) : null, lng: Number.isFinite(Number(s.lng)) ? Number(s.lng) : null }))
      : await plannedStopsFor(route?._id, date, kind, startTime),
  });
  pushHistory(trip, actor, 'PLANNED', { to: 'PLANNED' });
  await trip.save();
  await warnUnclearedCrew(trip);
  return get(actor, 'ALL', trip._id);
}

export async function assignCrew(actor, id, body = {}) {
  const settings = await getSettings();
  const trip = await loadTrip(actor, 'ALL', id);
  assertOpen(trip);
  if (body.driver !== undefined) trip.driver = await crewFrom(body.driver, 'driver', settings);
  if (body.attendant !== undefined) trip.attendant = await crewFrom(body.attendant, 'attendant', settings);
  pushHistory(trip, actor, 'CREW_ASSIGNED', { note: [trip.driver?.name && `driver ${trip.driver.name}`, trip.attendant?.name && `attendant ${trip.attendant.name}`].filter(Boolean).join(', ') });
  await trip.save();
  await warnUnclearedCrew(trip);
  return get(actor, 'ALL', trip._id);
}

/**
 * Puts a different vehicle on the trip. Refused unless it is roadworthy and
 * its usable seats cover everyone already allocated: one conditional update,
 * so an allocation racing the swap cannot slip past the new capacity.
 */
export async function substituteVehicle(actor, id, body = {}) {
  const trip = await loadTrip(actor, 'ALL', id);
  assertOpen(trip);
  const vehicle = await roadworthyVehicle(body.vehicleId);
  if (String(vehicle._id) === String(trip.vehicleId)) throw new AppError('That is already the trip\'s vehicle.', 409);
  const reason = requireText(body.reason, 'reason', { max: 500 });
  const updated = await Trip.findOneAndUpdate(
    { _id: trip._id, status: { $in: ['PLANNED', 'IN_PROGRESS'] }, seatsAllocated: { $lte: vehicle.usableSeats } },
    {
      $set: { vehicleId: vehicle._id, usableSeats: vehicle.usableSeats },
      $push: {
        substitutions: { fromVehicleId: trip.vehicleId, toVehicleId: vehicle._id, at: new Date(), reason, byProfileId: actor?.profileId ?? null },
        history: { at: new Date(), actorProfileId: actor?.profileId ?? null, actorName: actor?.displayName ?? null, action: 'VEHICLE_SUBSTITUTED', note: `${reason} → ${vehicle.registrationNo}` },
      },
    },
    { new: true },
  );
  if (!updated) {
    throw new AppError(`${vehicle.registrationNo} has ${vehicle.usableSeats} usable seats but ${trip.seatsAllocated} students are allocated. Release seats or choose a larger vehicle.`, 409, [], 'CAPACITY_EXCEEDED');
  }
  return get(actor, 'ALL', trip._id);
}

// ── seats ────────────────────────────────────────────────────────────────

/**
 * Allocates one seat. The seat counter moves only if a seat is free (atomic);
 * the allocation row is unique per trip and student, so a double click does
 * not take two seats (the counter is given back).
 */
export async function allocate(actor, scope, id, body = {}) {
  const trip = await loadTrip(actor, scope, id);
  assertOpen(trip);
  const student = await loadStudent(body.studentId);
  const existing = await TripAllocation.findOne({ tripId: trip._id, studentId: student._id });
  if (existing && existing.status !== 'RELEASED') throw new AppError(`${studentName(student)} already has a seat on this trip.`, 409, [], 'ALREADY_ALLOCATED');

  const stop = body.stopId ? trip.plannedStops.find((s) => String(s.stopId) === String(body.stopId) || String(s._id) === String(body.stopId)) : null;
  if (body.stopId && !stop) throw new AppError('That stop is not on this trip.', 400);

  const took = await Trip.findOneAndUpdate(
    { _id: trip._id, status: { $in: ['PLANNED', 'IN_PROGRESS'] }, $expr: { $lt: ['$seatsAllocated', '$usableSeats'] } },
    { $inc: { seatsAllocated: 1 } },
    { new: true },
  );
  if (!took) {
    await raiseAlert({
      kind: 'CAPACITY', department: 'TRANSPORT', severity: 'INFO', tripId: trip._id, vehicleId: trip.vehicleId,
      message: `${trip.refNo} is full (${trip.usableSeats} usable seats); a seat was refused`, dedupeKey: `trip:${trip._id}:full`,
    });
    throw new AppError(`No seat left on this trip (${trip.usableSeats} usable seats).`, 409, [], 'TRIP_FULL');
  }
  try {
    let alloc;
    if (existing) {
      alloc = await TripAllocation.findOneAndUpdate(
        { _id: existing._id, status: 'RELEASED' },
        { $set: { status: 'ALLOCATED', stopId: stop?.stopId ?? existing.stopId, stopName: stop?.name ?? existing.stopName }, $push: { history: { at: new Date(), actorProfileId: actor?.profileId ?? null, actorName: actor?.displayName ?? null, action: 'ALLOCATED', to: 'ALLOCATED' } } },
        { new: true },
      );
      if (!alloc) throw Object.assign(new Error('dup'), { code: 11000 });
    } else {
      alloc = await TripAllocation.create({
        tripId: trip._id, studentId: student._id, studentName: studentName(student),
        stopId: stop?.stopId ?? null, stopName: stop?.name ?? null, status: 'ALLOCATED',
        history: [{ at: new Date(), actorProfileId: actor?.profileId ?? null, actorName: actor?.displayName ?? null, action: 'ALLOCATED', to: 'ALLOCATED', note: body.note ?? null }],
      });
    }
    return dto(alloc.toObject());
  } catch (err) {
    // Give the seat back: the row already existed (a concurrent duplicate).
    await Trip.updateOne({ _id: trip._id, seatsAllocated: { $gt: 0 } }, { $inc: { seatsAllocated: -1 } });
    if (err?.code === 11000) throw new AppError(`${studentName(student)} already has a seat on this trip.`, 409, [], 'ALREADY_ALLOCATED');
    throw err;
  }
}

/** Frees a seat that was allocated but not used (only from ALLOCATED, so a seat is never freed twice). */
export async function release(actor, scope, id, allocationId, body = {}) {
  const trip = await loadTrip(actor, scope, id);
  assertOpen(trip);
  const freed = await TripAllocation.findOneAndUpdate(
    { _id: assertObjectId(allocationId, 'allocationId'), tripId: trip._id, status: 'ALLOCATED' },
    { $set: { status: 'RELEASED' }, $push: { history: { at: new Date(), actorProfileId: actor?.profileId ?? null, actorName: actor?.displayName ?? null, action: 'RELEASED', from: 'ALLOCATED', to: 'RELEASED', note: optionalText(body.reason, { max: 300 }) || null } } },
    { new: true },
  );
  if (!freed) throw new AppError('Only a seat that is allocated and not yet used can be released.', 409, [], 'INVALID_TRANSITION');
  await Trip.updateOne({ _id: trip._id, seatsAllocated: { $gt: 0 } }, { $inc: { seatsAllocated: -1 } });
  return dto(freed.toObject());
}

/** Allocates every student enrolled on the route for this direction, until the trip is full. */
export async function allocateEnrolled(actor, scope, id) {
  const trip = await loadTrip(actor, scope, id);
  assertOpen(trip);
  if (!trip.routeId) throw new AppError('This trip has no route to take enrolments from.', 400);
  const year = await AcademicYear.findOne({ isCurrent: true }).select('_id').lean();
  const directions = trip.kind === 'MORNING_PICKUP' ? ['BOTH', 'PICKUP'] : trip.kind === 'AFTERNOON_DROP' ? ['BOTH', 'DROP'] : ['BOTH', 'PICKUP', 'DROP'];
  const enrolled = await BusEnrollment.find({ routeId: trip.routeId, direction: { $in: directions }, ...(year ? { academicYearId: year._id } : {}) }).lean();
  const out = { allocated: 0, alreadyAllocated: 0, overflow: [] };
  for (const e of enrolled) {
    try {
      // eslint-disable-next-line no-await-in-loop -- each seat is its own atomic claim
      await allocate(actor, scope, trip._id, { studentId: e.studentId, stopId: e.stopId });
      out.allocated += 1;
    } catch (err) {
      if (err?.code === 'ALREADY_ALLOCATED') out.alreadyAllocated += 1;
      else if (err?.code === 'TRIP_FULL') {
        // eslint-disable-next-line no-await-in-loop
        const s = await Student.findById(e.studentId).select('firstName lastName').lean();
        out.overflow.push({ studentId: String(e.studentId), name: studentName(s) });
      } else throw err;
    }
  }
  return out;
}

// ── run ──────────────────────────────────────────────────────────────────

export async function start(actor, scope, id) {
  const trip = await loadTrip(actor, scope, id);
  if (trip.status !== 'PLANNED') throw new AppError(`A ${trip.status.toLowerCase()} trip cannot be started.`, 409, [], 'INVALID_TRANSITION');
  // The vehicle may have broken down or lapsed since planning.
  await roadworthyVehicle(trip.vehicleId);
  pushHistory(trip, actor, 'STARTED', { from: 'PLANNED', to: 'IN_PROGRESS' });
  trip.status = 'IN_PROGRESS';
  trip.startedAt = new Date();
  await trip.save();
  return get(actor, scope, trip._id);
}

export async function cancel(actor, id, body = {}) {
  const trip = await loadTrip(actor, 'ALL', id);
  if (!['PLANNED', 'IN_PROGRESS'].includes(trip.status)) throw new AppError('Only a planned or running trip can be cancelled.', 409, [], 'INVALID_TRANSITION');
  const reason = requireText(body.reason, 'reason', { max: 500 });
  pushHistory(trip, actor, 'CANCELLED', { from: trip.status, to: 'CANCELLED', note: reason });
  trip.status = 'CANCELLED';
  await trip.save();
  // Families of allocated students are told.
  const allocs = await TripAllocation.find({ tripId: trip._id, status: 'ALLOCATED' }).lean();
  for (const a of allocs) {
    // eslint-disable-next-line no-await-in-loop
    const recipients = await guardianProfileIds(a.studentId);
    // eslint-disable-next-line no-await-in-loop
    await sendOperational({ templateKey: 'TRIP_UPDATE', recipientProfileIds: recipients, variables: { studentName: a.studentName, update: `${trip.title} is cancelled (${reason})` }, link: '/bus-today', idempotencyKey: `trip:${trip._id}:cancel:${a.studentId}`, relatedEntityType: 'Trip', relatedEntityId: trip._id });
  }
  return get(actor, 'ALL', trip._id);
}

export async function markStop(actor, scope, id, stopRowId, body = {}) {
  const trip = await loadTrip(actor, scope, id);
  assertOpen(trip);
  const stop = trip.plannedStops.id(assertObjectId(stopRowId, 'stopId'));
  if (!stop) throw new AppError('Stop not found on this trip', 404);
  const what = oneOf(body.event, ['ARRIVED', 'DEPARTED'], 'event');
  if (what === 'ARRIVED') stop.arrivedAt = stop.arrivedAt ?? new Date();
  else { stop.arrivedAt = stop.arrivedAt ?? new Date(); stop.departedAt = new Date(); }
  pushHistory(trip, actor, `STOP_${what}`, { note: stop.name });
  await trip.save();
  return get(actor, scope, trip._id);
}

/** Wrong-vehicle check: is the student allocated to a different running trip today? */
async function otherTripToday(trip, studentId) {
  const sameDay = await Trip.find({ date: trip.date, _id: { $ne: trip._id }, status: { $in: ['PLANNED', 'IN_PROGRESS'] } }).select('_id refNo vehicleId kind').lean();
  if (!sameDay.length) return null;
  const a = await TripAllocation.findOne({ studentId, tripId: { $in: sameDay.map((t) => t._id) }, status: { $in: ['ALLOCATED', 'BOARDED'] } }).lean();
  if (!a) return null;
  const t = sameDay.find((x) => String(x._id) === String(a.tripId));
  const v = await Vehicle.findById(t.vehicleId).select('registrationNo').lean();
  return { trip: t, registrationNo: v?.registrationNo ?? '?' };
}

/**
 * Records a student getting on. From a seat they hold: ALLOCATED → BOARDED.
 * Without a seat on this trip: if they are allocated to another vehicle today
 * it is a WRONG_VEHICLE alert and the boarding is refused; otherwise they are
 * given a free seat (recorded as unplanned) or refused if the trip is full.
 */
export async function board(actor, scope, id, body = {}, { via = 'MANUAL', at = new Date() } = {}) {
  const trip = await loadTrip(actor, scope, id);
  assertOpen(trip);
  const student = await loadStudent(body.studentId);
  let alloc = await TripAllocation.findOne({ tripId: trip._id, studentId: student._id });
  if (!alloc || alloc.status === 'RELEASED') {
    const other = await otherTripToday(trip, student._id);
    if (other) {
      await raiseAlert({
        kind: 'WRONG_VEHICLE', severity: 'CRITICAL', department: 'TRANSPORT', studentId: student._id, tripId: trip._id, vehicleId: trip.vehicleId,
        message: `${studentName(student)} tried to board ${trip.refNo} but is allocated to ${other.registrationNo} (${other.trip.refNo})`,
        dedupeKey: `trip:${trip._id}:wrong:${student._id}`, notifyPermission: 'transport.fleet.manage', link: `/fleet?trip=${trip._id}`, now: at,
      });
      throw new AppError(`Wrong vehicle: ${studentName(student)} is allocated to ${other.registrationNo} today.`, 409, [], 'WRONG_VEHICLE');
    }
    const allocated = await allocate(actor, 'ALL', trip._id, { studentId: student._id, note: 'Unplanned boarding' });
    alloc = await TripAllocation.findById(allocated.id);
  }
  if (alloc.status === 'BOARDED') return dto(alloc.toObject());
  if (!['ALLOCATED', 'NO_SHOW'].includes(alloc.status)) throw new AppError(`${studentName(student)} is already ${alloc.status.toLowerCase().replace('_', ' ')} on this trip.`, 409, [], 'INVALID_TRANSITION');
  const from = alloc.status;
  alloc.status = 'BOARDED';
  alloc.boardedAt = at;
  alloc.boardedVia = via;
  pushHistory(alloc, actor, 'BOARDED', { from, to: 'BOARDED', note: via === 'SCAN' ? 'Card scanned at the door' : null });
  await alloc.save();
  if (trip.status === 'PLANNED' && body.autoStart !== false && via === 'SCAN') {
    await Trip.updateOne({ _id: trip._id, status: 'PLANNED' }, { $set: { status: 'IN_PROGRESS', startedAt: at } });
  }
  return dto(alloc.toObject());
}

export async function alight(actor, scope, id, body = {}, { via = 'MANUAL', at = new Date() } = {}) {
  const trip = await loadTrip(actor, scope, id);
  assertOpen(trip);
  const student = await loadStudent(body.studentId);
  const alloc = await TripAllocation.findOne({ tripId: trip._id, studentId: student._id });
  if (!alloc || alloc.status !== 'BOARDED') {
    await raiseAlert({
      kind: 'UNMATCHED_STUDENT', department: 'TRANSPORT', studentId: student._id, tripId: trip._id, vehicleId: trip.vehicleId,
      message: `${studentName(student)} got off ${trip.refNo} without a recorded boarding`, dedupeKey: `trip:${trip._id}:alight-unmatched:${student._id}`, now: at,
    });
    if (!alloc) throw new AppError(`${studentName(student)} has no seat on this trip.`, 409, [], 'NOT_ON_TRIP');
  }
  const from = alloc.status;
  if (!['BOARDED', 'ALLOCATED'].includes(from)) throw new AppError(`${studentName(student)} is already ${from.toLowerCase().replace('_', ' ')}.`, 409, [], 'INVALID_TRANSITION');
  alloc.status = 'ALIGHTED';
  alloc.alightedAt = at;
  alloc.alightedVia = via;
  pushHistory(alloc, actor, 'ALIGHTED', { from, to: 'ALIGHTED' });
  await alloc.save();
  return dto(alloc.toObject());
}

export async function markNoShow(actor, scope, id, body = {}) {
  const trip = await loadTrip(actor, scope, id);
  assertOpen(trip);
  const alloc = await TripAllocation.findOne({ tripId: trip._id, studentId: assertObjectId(body.studentId, 'studentId'), status: 'ALLOCATED' });
  if (!alloc) throw new AppError('Only an allocated student who has not boarded can be marked as a no-show.', 409, [], 'INVALID_TRANSITION');
  alloc.status = 'NO_SHOW';
  pushHistory(alloc, actor, 'NO_SHOW', { from: 'ALLOCATED', to: 'NO_SHOW', note: optionalText(body.note, { max: 300 }) || null });
  await alloc.save();
  const recipients = await guardianProfileIds(alloc.studentId);
  await sendOperational({ templateKey: 'TRIP_UPDATE', recipientProfileIds: recipients, variables: { studentName: alloc.studentName, update: `was not at the stop for ${trip.title}` }, link: '/bus-today', idempotencyKey: `trip:${trip._id}:noshow:${alloc.studentId}`, relatedEntityType: 'Trip', relatedEntityId: trip._id });
  return dto(alloc.toObject());
}

/**
 * Safe handover at a drop. The child is released only to an authorised adult
 * (a guardian with pickup authority, or an active, in-date delegate) — never
 * to a restricted adult (flagged) or a stranger. If nobody authorised is
 * there, `returnToSchool: true` records the child going back with the bus;
 * guardians are told and an alert is raised.
 */
export async function handover(actor, scope, id, body = {}, now = new Date()) {
  const trip = await loadTrip(actor, scope, id);
  assertOpen(trip);
  if (trip.kind === 'MORNING_PICKUP') throw new AppError('Handover happens on a drop trip; a morning pickup ends at school.', 400);
  const student = await loadStudent(body.studentId);
  const alloc = await TripAllocation.findOne({ tripId: trip._id, studentId: student._id });
  if (!alloc || !['BOARDED', 'ALIGHTED'].includes(alloc.status)) throw new AppError(`${studentName(student)} is not on board this trip.`, 409, [], 'NOT_ON_TRIP');

  if (body.returnToSchool === true) {
    const log = await writeReleaseLog(actor, { student, context: 'BUS_DROP', tripId: trip._id, returnToSchool: true, note: body.note });
    alloc.status = 'RETURNED_TO_SCHOOL';
    alloc.handover = { at: now, releaseLogId: log._id, receivedByKind: 'SCHOOL', receivedByName: 'School' };
    pushHistory(alloc, actor, 'RETURNED_TO_SCHOOL', { to: 'RETURNED_TO_SCHOOL', note: body.note });
    await alloc.save();
    await raiseAlert({
      kind: 'NO_AUTHORISED_ADULT', department: 'TRANSPORT', severity: 'WARNING', studentId: student._id, tripId: trip._id,
      message: `No authorised adult at the stop for ${studentName(student)} (${trip.refNo}); the child is with the school`,
      dedupeKey: `trip:${trip._id}:noadult:${student._id}`, notifyPermission: 'transport.fleet.manage', link: `/fleet?trip=${trip._id}`, now,
    });
    await sendOperational({ templateKey: 'TRIP_UPDATE', recipientProfileIds: await guardianProfileIds(student._id), variables: { studentName: studentName(student), update: 'nobody authorised was at the stop, so your child is safe with the school. Please contact the school office' }, link: '/bus-today', idempotencyKey: `trip:${trip._id}:return:${student._id}`, urgency: 'URGENT', relatedEntityType: 'Trip', relatedEntityId: trip._id });
    return dto(alloc.toObject());
  }

  const check = await checkReceiver(student._id, body.receiver ?? {}, now);
  if (!check.ok) {
    if (check.restricted) await flagRestriction(student, check, 'BUS_DROP', now);
    throw new AppError(`${check.reason} Keep the child on the bus and choose "return to school" if nobody authorised is there.`, 409, [], check.restricted ? 'CUSTODY_RESTRICTED' : 'NOT_AUTHORISED');
  }
  const log = await writeReleaseLog(actor, { student, context: 'BUS_DROP', tripId: trip._id, check, verification: body.verification, note: body.note });
  const from = alloc.status;
  alloc.status = 'HANDED_OVER';
  alloc.alightedAt = alloc.alightedAt ?? now;
  alloc.handover = { at: now, releaseLogId: log._id, receivedByKind: check.kind === 'GUARDIAN' ? 'GUARDIAN' : 'DELEGATE', receivedByName: check.name };
  pushHistory(alloc, actor, 'HANDED_OVER', { from, to: 'HANDED_OVER', note: `Received by ${check.name}` });
  await alloc.save();
  return dto(alloc.toObject());
}

/**
 * End-of-trip reconciliation: enrolled vs allocated vs boarded vs alighted vs
 * released. Anyone not accounted for is listed and raised as an alert.
 */
export async function reconcile(actor, scope, id, now = new Date()) {
  const trip = await loadTrip(actor, scope, id);
  if (trip.status === 'CANCELLED') throw new AppError('A cancelled trip has nothing to reconcile.', 409, [], 'TRIP_CLOSED');
  const allocs = await TripAllocation.find({ tripId: trip._id }).lean();
  const count = (...s) => allocs.filter((a) => s.includes(a.status)).length;
  let enrolled = null;
  if (trip.routeId) {
    const year = await AcademicYear.findOne({ isCurrent: true }).select('_id').lean();
    const directions = trip.kind === 'MORNING_PICKUP' ? ['BOTH', 'PICKUP'] : ['BOTH', 'DROP'];
    enrolled = await BusEnrollment.countDocuments({ routeId: trip.routeId, direction: { $in: directions }, ...(year ? { academicYearId: year._id } : {}) });
  }
  const unmatched = [];
  for (const a of allocs) {
    let issue = null;
    if (a.status === 'ALLOCATED') issue = 'Allocated but never boarded or marked as a no-show';
    else if (a.status === 'BOARDED') issue = trip.kind === 'MORNING_PICKUP' ? 'Boarded but not recorded getting off at school' : 'Boarded but not handed over or returned to school';
    else if (a.status === 'ALIGHTED' && trip.kind !== 'MORNING_PICKUP') issue = 'Got off without a recorded handover to an authorised adult';
    if (issue) unmatched.push({ studentId: a.studentId, studentName: a.studentName, issue });
  }
  trip.reconciliation = {
    at: now, byProfileId: actor?.profileId ?? null, enrolled,
    allocated: allocs.filter((a) => LIVE_SEATS.includes(a.status)).length,
    boarded: count('BOARDED', 'ALIGHTED', 'HANDED_OVER', 'RETURNED_TO_SCHOOL'),
    alighted: count('ALIGHTED', 'HANDED_OVER'),
    handedOver: count('HANDED_OVER'),
    returnedToSchool: count('RETURNED_TO_SCHOOL'),
    noShow: count('NO_SHOW'),
    released: count('RELEASED'),
    unmatched,
  };
  pushHistory(trip, actor, 'RECONCILED', { note: `${unmatched.length} unmatched` });
  await trip.save();
  for (const u of unmatched) {
    // eslint-disable-next-line no-await-in-loop
    await raiseAlert({
      kind: 'UNMATCHED_STUDENT', severity: 'CRITICAL', department: 'TRANSPORT', studentId: u.studentId, tripId: trip._id, vehicleId: trip.vehicleId,
      message: `${trip.refNo}: ${u.studentName} — ${u.issue}`, dedupeKey: `trip:${trip._id}:unmatched:${u.studentId}`,
      notifyPermission: 'transport.fleet.manage', link: `/fleet?trip=${trip._id}`, now,
    });
  }
  return { ...trip.reconciliation, unmatched: unmatched.map((u) => ({ ...u, studentId: String(u.studentId) })) };
}

/** Closes a trip. Reconciles first; with anyone unmatched a note is required. */
export async function complete(actor, scope, id, body = {}) {
  const rec = await reconcile(actor, scope, id);
  const trip = await loadTrip(actor, scope, id);
  if (trip.status !== 'IN_PROGRESS') throw new AppError('Only a running trip can be completed.', 409, [], 'INVALID_TRANSITION');
  if (rec.unmatched.length && !optionalText(body.note, { max: 1000 })) {
    throw new AppError(`${rec.unmatched.length} student(s) are not accounted for. Resolve them, or record what was done in a note.`, 409, [], 'UNMATCHED_STUDENTS');
  }
  pushHistory(trip, actor, 'COMPLETED', { from: 'IN_PROGRESS', to: 'COMPLETED', note: body.note });
  trip.status = 'COMPLETED';
  trip.endedAt = new Date();
  await trip.save();
  return get(actor, scope, trip._id);
}

export async function suppressAlerts(actor, scope, id, body = {}) {
  const trip = await loadTrip(actor, scope, id);
  const minutes = Math.min(Math.max(Number.parseInt(body.minutes, 10) || 30, 5), 240);
  trip.alerts = { suppressUntil: new Date(Date.now() + minutes * 60_000), suppressReason: requireText(body.reason, 'reason', { max: 300 }) };
  pushHistory(trip, actor, 'ALERTS_SUPPRESSED', { note: `${minutes} min: ${trip.alerts.suppressReason}` });
  await trip.save();
  return { suppressUntil: trip.alerts.suppressUntil };
}

// ── scheduled ────────────────────────────────────────────────────────────

/**
 * Delay and GPS-health alerts for running trips (scheduled). A trip whose
 * next stop is overdue by more than the threshold gets one alert per repeat
 * window; a suppressed trip gets none until the suppression ends.
 */
export async function runAlerts({ now = new Date() } = {}) {
  const settings = await getSettings();
  const trips = await Trip.find({ status: 'IN_PROGRESS' }).lean();
  const out = { delays: 0, stale: 0 };
  const windowNo = Math.floor(now.getTime() / (settings.fleet.alertRepeatMinutes * 60_000));
  for (const t of trips) {
    if (t.alerts?.suppressUntil && new Date(t.alerts.suppressUntil) > now) continue;
    const next = [...t.plannedStops].sort((a, b) => a.sequenceNo - b.sequenceNo).find((s) => !s.arrivedAt);
    if (next?.plannedAt && now - new Date(next.plannedAt) > settings.fleet.delayMinutes * 60_000) {
      const late = Math.round((now - new Date(next.plannedAt)) / 60_000);
      // eslint-disable-next-line no-await-in-loop
      const r = await raiseAlert({
        kind: 'TRIP_DELAY', department: 'TRANSPORT', tripId: t._id, vehicleId: t.vehicleId,
        message: `${t.refNo} is about ${late} min behind at ${next.name}`, dedupeKey: `trip:${t._id}:delay:${next._id}:${windowNo}`,
        notifyPermission: 'transport.fleet.manage', link: `/fleet?trip=${t._id}`, now,
      });
      if (r.opened) out.delays += 1;
    }
    // eslint-disable-next-line no-await-in-loop
    const v = await Vehicle.findById(t.vehicleId).select('registrationNo gpsDeviceId lastPosition').lean();
    if (v?.gpsDeviceId) {
      const st = positionStatus(v.lastPosition, settings, now);
      if (st === 'STALE' || st === 'OFFLINE' || st === 'NO_DATA') {
        // eslint-disable-next-line no-await-in-loop
        const r = await raiseAlert({
          kind: st === 'STALE' ? 'GPS_STALE' : 'GPS_OFFLINE', department: 'TRANSPORT', severity: 'INFO', tripId: t._id, vehicleId: t.vehicleId,
          message: `${v.registrationNo}: GPS ${st === 'NO_DATA' ? 'has sent nothing' : st.toLowerCase()} during ${t.refNo}; use manual boarding`,
          dedupeKey: `trip:${t._id}:gps:${st}`, now,
        });
        if (r.opened) out.stale += 1;
      }
    }
  }
  return out;
}

/**
 * Plans the day's pickup and drop trips for every active route that has a
 * registered vehicle (route.vehicleNo = vehicle.registrationNo) and seats the
 * enrolled students. Existing trips are left alone. Returns what happened.
 */
export async function planDay(actor, body = {}) {
  const date = parseSchoolDay(body.date);
  const routes = await TransportRoute.find({ status: 'ACTIVE' }).lean();
  const out = [];
  for (const r of routes) {
    const reg = String(r.vehicleNo ?? '').toUpperCase().replace(/\s+/g, '');
    // eslint-disable-next-line no-await-in-loop
    const v = reg ? await Vehicle.findOne({ registrationNo: reg }).lean() : null;
    if (!v) { out.push({ route: r.name, skipped: 'No registered vehicle matches the route\'s vehicle number' }); continue; }
    for (const kind of ['MORNING_PICKUP', 'AFTERNOON_DROP']) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const trip = await create(actor, { routeId: r._id, vehicleId: v._id, date: date.toISOString().slice(0, 10), kind, driver: r.driverName ? { name: r.driverName, phone: r.driverPhone } : undefined, attendant: body.attendant });
        // eslint-disable-next-line no-await-in-loop
        const seats = await allocateEnrolled(actor, 'ALL', trip.id);
        out.push({ route: r.name, kind, tripId: trip.id, ...seats });
      } catch (err) {
        out.push({ route: r.name, kind, skipped: err.message });
      }
    }
  }
  return out;
}

// ── families ─────────────────────────────────────────────────────────────

/**
 * "My bus today" for a parent (their own children) or a student (themselves).
 * Only the child's own allocation on today's trips: trip status, their stop,
 * an ETA labelled as an estimate, and the bus position while that child's
 * trip is running. Never other children, never the driver's other trips.
 */
export async function myTrips(actor, now = new Date()) {
  const studentIds = await ownStudentIds(actor);
  if (!studentIds.length) return { children: [], note: null };
  const today = schoolDay(now);
  const trips = await Trip.find({ date: today, status: { $ne: 'CANCELLED' } }).select('_id').lean();
  const allocs = await TripAllocation.find({ studentId: { $in: studentIds }, tripId: { $in: trips.map((t) => t._id) }, status: { $ne: 'RELEASED' } }).lean();
  const settings = await getSettings();
  const students = await Student.find({ _id: { $in: studentIds } }).select('_id firstName lastName').lean();
  const children = [];
  for (const s of students) {
    const mine = allocs.filter((a) => String(a.studentId) === String(s._id));
    const rows = [];
    for (const a of mine) {
      // eslint-disable-next-line no-await-in-loop
      const t = await Trip.findById(a.tripId).lean();
      // eslint-disable-next-line no-await-in-loop
      const v = await Vehicle.findById(t.vehicleId).select('registrationNo type lastPosition').lean();
      const stop = t.plannedStops.find((p) => a.stopId && String(p.stopId) === String(a.stopId)) ?? null;
      const live = t.status === 'IN_PROGRESS' && ['ALLOCATED', 'BOARDED'].includes(a.status);
      const pStatus = positionStatus(v?.lastPosition, settings, now);
      rows.push({
        tripId: String(t._id), title: t.title, kind: t.kind, kindLabel: KIND_LABEL[t.kind], status: t.status,
        vehicle: v ? { registrationNo: v.registrationNo, type: v.type } : null,
        attendantName: t.attendant?.name ?? null,
        stop: stop ? { name: stop.name, plannedAt: stop.plannedAt, arrivedAt: stop.arrivedAt } : (a.stopName ? { name: a.stopName } : null),
        myStatus: a.status, boardedAt: a.boardedAt, alightedAt: a.alightedAt,
        handover: a.handover?.at ? { at: a.handover.at, receivedByName: a.handover.receivedByName, receivedByKind: a.handover.receivedByKind } : null,
        eta: live && stop ? etaToStop(t, v, stop, settings, now) : null,
        position: live && v?.lastPosition?.eventAt && pStatus !== 'OFFLINE' ? { lat: v.lastPosition.lat, lng: v.lastPosition.lng, eventAt: v.lastPosition.eventAt } : null,
        positionStatus: live ? pStatus : null,
      });
    }
    children.push({ studentId: String(s._id), name: studentName(s), trips: rows });
  }
  return { children, note: 'Arrival times are estimates. A bus may be delayed by traffic; the school will message you about real changes.' };
}

/** For a checkpoint scan at a bus door: the vehicle's trip today (running first). */
export async function tripForVehicleToday(vehicleId, now = new Date()) {
  const day = schoolDay(now);
  return (await Trip.findOne({ vehicleId, date: day, status: 'IN_PROGRESS' }).lean())
    ?? Trip.findOne({ vehicleId, date: day, status: 'PLANNED' }).sort({ kind: 1 }).lean();
}

export { DAY };
