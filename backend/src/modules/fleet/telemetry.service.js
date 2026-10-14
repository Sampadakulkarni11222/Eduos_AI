import { Vehicle, Trip, TelemetryPoint } from '../../models/fleet.model.js';
import { AppError } from '../../utils/AppError.js';
import { featureEnabled } from '../../utils/features.js';
import { getSettings, haversineMeters, distanceToSegmentMeters, raiseAlert, schoolDay } from '../safety/shared.js';
import { positionStatus } from './vehicles.service.js';

/**
 * GPS ingestion, provider-neutral.
 *
 * A device posts a batch of fixes (it may have buffered them while offline).
 * Each fix carries the device's own sequence number and the time it was taken
 * (eventAt); the server adds the time it arrived (receivedAt). A fix already
 * received (same device and sequence) is counted as a duplicate and ignored.
 * The vehicle's latest position only moves forward in event time, so a
 * buffered batch arriving late never drags the bus backwards on the map.
 *
 * ETA is an ESTIMATE: straight-line distance to the stop divided by the
 * recent speed (or the school's default speed). Every ETA says so.
 */
const MAX_POINTS = 500;
const FUTURE_TOLERANCE_MS = 2 * 60_000;
const MAX_AGE_MS = 7 * 86_400_000;

function cleanPoint(p) {
  const seq = Number(p?.seq);
  const lat = Number(p?.lat);
  const lng = Number(p?.lng);
  const eventAt = new Date(typeof p?.eventAt === 'number' ? p.eventAt : String(p?.eventAt ?? ''));
  if (!Number.isInteger(seq) || seq < 0) return { error: 'seq must be a non-negative integer' };
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) return { error: 'lat/lng out of range' };
  if (Number.isNaN(eventAt.getTime())) return { error: 'eventAt is not a valid time' };
  const speed = p?.speedKmh === undefined || p?.speedKmh === null ? null : Number(p.speedKmh);
  const heading = p?.heading === undefined || p?.heading === null ? null : Number(p.heading);
  return {
    seq, lat, lng, eventAt,
    speedKmh: Number.isFinite(speed) && speed >= 0 && speed < 200 ? speed : null,
    heading: Number.isFinite(heading) ? ((heading % 360) + 360) % 360 : null,
  };
}

/** The trip a vehicle is running now (in progress first, then today's planned). */
export async function activeTripFor(vehicleId, now = new Date()) {
  return (await Trip.findOne({ vehicleId, status: 'IN_PROGRESS' }).sort({ startedAt: -1 }).lean())
    ?? null;
}

export async function ingest(device, body = {}, now = new Date()) {
  if (!(await featureEnabled('gpsTracking'))) throw new AppError('Live bus location from GPS devices is switched off for this school.', 403, [], 'FEATURE_OFF');
  const points = Array.isArray(body?.points) ? body.points : body?.seq !== undefined ? [body] : null;
  if (!points || !points.length) throw new AppError('Send { points: [{ seq, eventAt, lat, lng, speedKmh? }] }', 400);
  if (points.length > MAX_POINTS) throw new AppError(`At most ${MAX_POINTS} points per request`, 413);
  const vehicleId = device.gps?.vehicleId ?? null;
  const trip = vehicleId ? await activeTripFor(vehicleId, now) : null;

  const result = { accepted: 0, duplicates: 0, rejected: [], buffered: 0 };
  const accepted = [];
  for (const [i, raw] of points.entries()) {
    const p = cleanPoint(raw);
    if (p.error) { result.rejected.push({ index: i, reason: p.error }); continue; }
    if (p.eventAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) { result.rejected.push({ index: i, reason: 'eventAt is in the future' }); continue; }
    if (now.getTime() - p.eventAt.getTime() > MAX_AGE_MS) { result.rejected.push({ index: i, reason: 'eventAt is older than 7 days' }); continue; }
    const buffered = now.getTime() - p.eventAt.getTime() > 2 * 60_000;
    try {
      // eslint-disable-next-line no-await-in-loop -- per-point unique index is the dedupe
      await TelemetryPoint.create({ deviceId: device._id, vehicleId, tripId: trip?._id ?? null, ...p, receivedAt: now, buffered });
      result.accepted += 1;
      if (buffered) result.buffered += 1;
      accepted.push(p);
    } catch (err) {
      if (err?.code === 11000) { result.duplicates += 1; continue; }
      throw err;
    }
  }

  if (vehicleId && accepted.length) {
    const latest = accepted.reduce((a, b) => (b.eventAt > a.eventAt ? b : a));
    // Forward-only in event time.
    await Vehicle.updateOne(
      { _id: vehicleId, $or: [{ 'lastPosition.eventAt': null }, { 'lastPosition.eventAt': { $lt: latest.eventAt } }] },
      { $set: { lastPosition: { lat: latest.lat, lng: latest.lng, speedKmh: latest.speedKmh, heading: latest.heading, eventAt: latest.eventAt, receivedAt: now } } },
    );
    if (trip) await applyToTrip(trip, accepted.sort((a, b) => a.eventAt - b.eventAt), now);
  }
  result.vehicleLinked = Boolean(vehicleId);
  result.tripId = trip ? String(trip._id) : null;
  return result;
}

/** Marks stops arrived (geofence) and raises an off-route alert, from accepted fixes in time order. */
async function applyToTrip(trip, points, now) {
  const settings = await getSettings();
  const radius = settings.fleet.arrivalRadiusMeters;
  const stops = [...trip.plannedStops].sort((a, b) => a.sequenceNo - b.sequenceNo);
  const updates = {};
  for (const p of points) {
    for (const s of stops) {
      if (s.arrivedAt || updates[String(s._id)] || s.lat === null || s.lng === null || s.lat === undefined) continue;
      if (haversineMeters(p, { lat: s.lat, lng: s.lng }) <= radius) updates[String(s._id)] = p.eventAt;
    }
  }
  for (const [stopId, at] of Object.entries(updates)) {
    // eslint-disable-next-line no-await-in-loop
    await Trip.updateOne({ _id: trip._id, 'plannedStops._id': stopId, 'plannedStops.arrivedAt': null }, { $set: { 'plannedStops.$.arrivedAt': at } });
  }
  // Off route: farther than the threshold from every leg of the planned path.
  const located = stops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  const last = points[points.length - 1];
  if (located.length >= 2 && !(trip.alerts?.suppressUntil && new Date(trip.alerts.suppressUntil) > now)) {
    let min = Infinity;
    for (let i = 0; i < located.length - 1; i += 1) min = Math.min(min, distanceToSegmentMeters(last, located[i], located[i + 1]));
    if (min > settings.fleet.offRouteMeters) {
      await raiseAlert({
        kind: 'OFF_ROUTE', department: 'TRANSPORT', severity: 'WARNING', tripId: trip._id, vehicleId: trip.vehicleId,
        message: `Trip ${trip.refNo} is about ${Math.round(min)} m from its planned route`,
        dedupeKey: `trip:${trip._id}:offroute:${Math.floor(now.getTime() / (settings.fleet.alertRepeatMinutes * 60_000))}`,
        notifyPermission: 'transport.fleet.manage', link: `/fleet?trip=${trip._id}`, now,
      });
    }
  }
}

/**
 * ETA to a stop on a trip. Labelled with how it was worked out:
 *   GPS_ESTIMATE — straight-line distance / speed from the last fix;
 *   TIMETABLE    — the stop's planned time (no fresh GPS);
 *   ARRIVED      — the stop was reached.
 */
export function etaToStop(trip, vehicle, stop, settings, now = new Date()) {
  if (!stop) return null;
  if (stop.arrivedAt) return { method: 'ARRIVED', at: stop.arrivedAt, minutes: 0, isEstimate: false, label: 'Reached the stop' };
  const pos = vehicle?.lastPosition;
  const status = positionStatus(pos, settings, now);
  if (trip.status === 'IN_PROGRESS' && pos?.lat !== null && pos?.lat !== undefined && status === 'LIVE' && Number.isFinite(stop.lat) && Number.isFinite(stop.lng)) {
    const meters = haversineMeters({ lat: pos.lat, lng: pos.lng }, { lat: stop.lat, lng: stop.lng });
    const speed = pos.speedKmh && pos.speedKmh >= 5 ? pos.speedKmh : settings.fleet.defaultSpeedKmh;
    const minutes = Math.max(1, Math.round((meters / 1000 / speed) * 60));
    return { method: 'GPS_ESTIMATE', at: new Date(now.getTime() + minutes * 60_000), minutes, isEstimate: true, distanceMeters: Math.round(meters), label: 'Estimate from straight-line distance and recent speed' };
  }
  if (stop.plannedAt) {
    return { method: 'TIMETABLE', at: stop.plannedAt, minutes: Math.round((new Date(stop.plannedAt) - now) / 60_000), isEstimate: true, label: status === 'NO_DATA' ? 'Planned time (no live location)' : `Planned time (location ${status.toLowerCase()})` };
  }
  return null;
}

/** Latest positions of every vehicle with a fix, for the live board (staff). */
export async function livePositions(now = new Date()) {
  const settings = await getSettings();
  const vehicles = await Vehicle.find({ status: { $ne: 'RETIRED' } }).select('registrationNo type status lastPosition gpsDeviceId').lean();
  const today = schoolDay(now);
  const trips = await Trip.find({ date: today, status: { $in: ['PLANNED', 'IN_PROGRESS'] } }).select('vehicleId refNo kind status routeName').lean();
  const tripBy = new Map();
  for (const t of trips) if (!tripBy.has(String(t.vehicleId)) || t.status === 'IN_PROGRESS') tripBy.set(String(t.vehicleId), t);
  return {
    asOf: now,
    staleAfterMinutes: settings.fleet.staleMinutes,
    offlineAfterMinutes: settings.fleet.offlineMinutes,
    vehicles: vehicles.map((v) => {
      const t = tripBy.get(String(v._id));
      return {
        id: String(v._id), registrationNo: v.registrationNo, type: v.type, vehicleStatus: v.status, hasGps: Boolean(v.gpsDeviceId),
        position: v.lastPosition?.eventAt ? { lat: v.lastPosition.lat, lng: v.lastPosition.lng, speedKmh: v.lastPosition.speedKmh, heading: v.lastPosition.heading, eventAt: v.lastPosition.eventAt, receivedAt: v.lastPosition.receivedAt } : null,
        positionStatus: positionStatus(v.lastPosition, settings, now),
        lastSeenMinutes: v.lastPosition?.eventAt ? Math.round((now - new Date(v.lastPosition.eventAt)) / 60_000) : null,
        trip: t ? { id: String(t._id), refNo: t.refNo, kind: t.kind, status: t.status, routeName: t.routeName } : null,
      };
    }),
  };
}

/** Recent track of a vehicle (staff only), newest last. */
export async function track(vehicleId, { minutes = 120 } = {}, now = new Date()) {
  const since = new Date(now.getTime() - Math.min(Math.max(Number(minutes) || 120, 5), 24 * 60) * 60_000);
  const rows = await TelemetryPoint.find({ vehicleId, eventAt: { $gte: since } }).sort({ eventAt: 1 }).limit(2000).select('lat lng speedKmh eventAt receivedAt buffered seq').lean();
  return rows.map(({ _id, ...r }) => r);
}
