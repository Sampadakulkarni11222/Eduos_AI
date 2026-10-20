import { describe, it, expect, beforeEach } from 'vitest';
import { seedTransportSchool, makeVehicle, inOak, today, signed, asDevice } from './support/transportSafety.js';
import { Vehicle, TelemetryPoint, Trip } from '../src/models/fleet.model.js';
import { SafetyAlert } from '../src/models/safety.model.js';
import * as devices from '../src/modules/safety/devices.service.js';
import * as trips from '../src/modules/fleet/trips.service.js';
import * as telemetry from '../src/modules/fleet/telemetry.service.js';
import { verifyDeviceRequest } from '../src/modules/safety/deviceAuth.js';
import { setFeatures } from '../src/utils/features.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';

/**
 * GPS ingestion: only correctly signed, fresh, never-replayed requests from a
 * registered device are accepted; resent fixes are counted once; a buffered
 * batch arriving late never moves the bus backwards; a silent tracker goes
 * stale then offline; ETA is labelled an estimate; switching the feature off
 * stops ingestion.
 */
let s; let admin; let vehicle; let device;
beforeEach(async () => {
  s = await seedTransportSchool({ features: { gpsTracking: true } });
  admin = s.people.ADMIN.actor;
  vehicle = await makeVehicle(admin, { seats: 3 });
  device = await inOak(() => devices.create(admin, { kind: 'GPS', label: 'Tracker bus 4 (sample)', vehicleId: vehicle.id }));
});

const ingest = async (body, opts) => {
  const d = await asDevice(device.deviceKey, device.secret, body, opts);
  return runWithTenant(d.tenantId, () => telemetry.ingest(d, body));
};
const pt = (seq, minutesAgo, lat = 18.52, lng = 73.856, speedKmh = 24) => ({ seq, eventAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(), lat, lng, speedKmh });

describe('device authentication', () => {
  it('shows the secret once and accepts a correctly signed request', async () => {
    expect(device.secret).toBeTruthy();
    const listed = await inOak(() => devices.list(admin, { kind: 'GPS' }));
    expect(JSON.stringify(listed)).not.toContain(device.secret);
    const out = await ingest({ points: [pt(1, 0)] });
    expect(out).toMatchObject({ accepted: 1, duplicates: 0, vehicleLinked: true });
  });

  it('refuses a wrong signature, a stale timestamp, a replayed nonce, an unknown or disabled device', async () => {
    const body = { points: [pt(1, 0)] };
    const good = signed(device.deviceKey, device.secret, body, { nonce: 'nonce-fixed-1' });
    await expect(verifyDeviceRequest({ ...good, rawBody: JSON.stringify({ points: [pt(2, 0)] }) })).rejects.toMatchObject({ code: 'DEVICE_BAD_SIGNATURE' });
    await expect(verifyDeviceRequest(signed(device.deviceKey, 'wrong-secret', body))).rejects.toMatchObject({ code: 'DEVICE_BAD_SIGNATURE' });
    await expect(verifyDeviceRequest(signed(device.deviceKey, device.secret, body, { timestamp: Date.now() - 10 * 60_000 }))).rejects.toMatchObject({ code: 'DEVICE_STALE_SIGNATURE' });
    await verifyDeviceRequest(good);
    await expect(verifyDeviceRequest(good)).rejects.toMatchObject({ code: 'DEVICE_REPLAY' });
    await expect(verifyDeviceRequest(signed('gps_unknown', device.secret, body))).rejects.toMatchObject({ code: 'DEVICE_UNKNOWN' });
    await inOak(() => devices.setStatus(admin, device.id, { status: 'DISABLED' }));
    await expect(verifyDeviceRequest(signed(device.deviceKey, device.secret, body))).rejects.toMatchObject({ code: 'DEVICE_UNKNOWN' });
  });

  it('a GPS device cannot post as a camera or card reader', async () => {
    await expect(verifyDeviceRequest(signed(device.deviceKey, device.secret, {}), { kinds: ['CAMERA'] })).rejects.toMatchObject({ code: 'DEVICE_WRONG_KIND' });
  });
});

describe('ingestion', () => {
  it('dedupes by device and sequence, accepts a buffered batch, and keeps the latest position forward-only', async () => {
    await ingest({ points: [pt(10, 1, 18.53, 73.86)] });
    const again = await ingest({ points: [pt(10, 1, 18.53, 73.86), pt(11, 0, 18.531, 73.861)] });
    expect(again).toMatchObject({ accepted: 1, duplicates: 1 });
    // A late, buffered batch from 20 minutes ago.
    const late = await ingest({ points: [pt(3, 22, 18.50, 73.80), pt(4, 21, 18.501, 73.801)] });
    expect(late).toMatchObject({ accepted: 2, buffered: 2 });
    const v = await inOak(() => Vehicle.findById(vehicle.id).lean());
    expect(v.lastPosition.lat).toBeCloseTo(18.531);
    const p = await inOak(() => TelemetryPoint.findOne({ seq: 3 }).lean());
    expect(p.buffered).toBe(true);
    expect(p.receivedAt.getTime()).toBeGreaterThan(p.eventAt.getTime());
    expect(await inOak(() => TelemetryPoint.countDocuments({}))).toBe(4);
  });

  it('rejects malformed and future points without failing the batch', async () => {
    const out = await ingest({ points: [{ seq: 1, eventAt: new Date(Date.now() + 3600_000).toISOString(), lat: 1, lng: 1 }, { seq: 'x', lat: 1, lng: 1 }, { seq: 2, eventAt: new Date().toISOString(), lat: 200, lng: 1 }, pt(3, 0)] });
    expect(out.accepted).toBe(1);
    expect(out.rejected).toHaveLength(3);
  });

  it('labels positions LIVE, STALE then OFFLINE, and the ETA as an estimate', async () => {
    // Starts at 00:00 India time, so its stops are always due before the checks below, whatever the clock.
    const t = await inOak(() => trips.create(admin, { routeId: String(s.route._id), vehicleId: vehicle.id, date: today(), kind: 'MORNING_PICKUP', startTime: '00:00' }));
    await inOak(() => trips.start(admin, 'ALL', t.id));
    // Near stop 1 → arrival recorded by geofence.
    await ingest({ points: [pt(1, 0, 18.5201, 73.8561)] });
    const trip = await inOak(() => Trip.findById(t.id).lean());
    expect(trip.plannedStops[0].arrivedAt).toBeTruthy();
    const live = await inOak(() => telemetry.livePositions());
    expect(live.vehicles[0].positionStatus).toBe('LIVE');
    const v = await inOak(() => Vehicle.findById(vehicle.id).lean());
    const next = trip.plannedStops[1];
    const eta = telemetry.etaToStop(trip, v, next, { fleet: { staleMinutes: 5, offlineMinutes: 30, defaultSpeedKmh: 20 } });
    expect(eta).toMatchObject({ method: 'GPS_ESTIMATE', isEstimate: true });
    const later = (m) => new Date(Date.now() + m * 60_000);
    expect((await inOak(() => telemetry.livePositions(later(10)))).vehicles[0].positionStatus).toBe('STALE');
    expect((await inOak(() => telemetry.livePositions(later(45)))).vehicles[0].positionStatus).toBe('OFFLINE');
    // The scheduled pass raises a GPS health alert once, and a delay alert.
    await inOak(() => trips.runAlerts({ now: later(45) }));
    await inOak(() => trips.runAlerts({ now: later(46) }));
    expect(await inOak(() => SafetyAlert.countDocuments({ kind: 'GPS_OFFLINE' }))).toBe(1);
    expect(await inOak(() => SafetyAlert.countDocuments({ kind: 'TRIP_DELAY' }))).toBeGreaterThanOrEqual(1);
  });

  it('suppresses delay alerts while a suppression is in force', async () => {
    const t = await inOak(() => trips.create(admin, { routeId: String(s.route._id), vehicleId: vehicle.id, date: today(), kind: 'MORNING_PICKUP', startTime: '00:00' }));
    await inOak(() => trips.start(admin, 'ALL', t.id));
    await inOak(() => trips.suppressAlerts(admin, 'ALL', t.id, { minutes: 60, reason: 'Road closed, diversion agreed' }));
    await inOak(() => trips.runAlerts({ now: new Date() }));
    expect(await inOak(() => SafetyAlert.countDocuments({ kind: 'TRIP_DELAY' }))).toBe(0);
  });

  it('refuses ingestion when the school has GPS tracking switched off', async () => {
    await inOak(() => setFeatures({ gpsTracking: false }));
    await expect(ingest({ points: [pt(1, 0)] })).rejects.toMatchObject({ code: 'FEATURE_OFF' });
  });
});
