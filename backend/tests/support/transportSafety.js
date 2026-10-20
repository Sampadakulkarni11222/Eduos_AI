import crypto from 'node:crypto';
import { seedSchool, seedPerson, inSchool, OAK } from './mcpSchool.js';
import { School } from '../../src/models/school.model.js';
import { TransportRoute, TransportStop, BusEnrollment } from '../../src/models/transport.model.js';
import { setFeatures } from '../../src/utils/features.js';
import { updateSettings, schoolDay } from '../../src/modules/safety/shared.js';
import * as vehicles from '../../src/modules/fleet/vehicles.service.js';
import { signPayload, verifyDeviceRequest } from '../../src/modules/safety/deviceAuth.js';

/**
 * Fixture for the transport and safety suites: the shared MCP school plus a
 * COMPLIANCE officer, the school document (for feature switches), a route
 * with located stops and enrolments, and helpers for vehicles and for signing
 * device requests exactly as a device would. Not a test file.
 */
export const DAY = 86_400_000;
export const inOak = (fn) => inSchool(OAK, fn);

export async function seedTransportSchool({ features = {} } = {}) {
  const s = await seedSchool();
  s.people.COMPLIANCE = await seedPerson({ roleKey: 'COMPLIANCE', roleId: s.roleIds.COMPLIANCE });
  await School.updateOne({ slug: OAK }, { $setOnInsert: { slug: OAK, name: 'Oakridge Academy' } }, { upsert: true });
  await inOak(() => setFeatures({ fleet: true, visitors: true, hostelOutpass: true, ...features }));
  // Most tests use uncleared sample crew; the BLOCK policy has its own test.
  await inOak(() => updateSettings(s.people.ADMIN.actor, { fleet: { unverifiedCrewPolicy: 'WARN' } }));
  const route = await inOak(async () => {
    const r = await TransportRoute.create({ name: 'Route 4', vehicleNo: 'MH12AB1234', driverName: 'Sample Driver' });
    const stops = [];
    const coords = [[18.5200, 73.8560], [18.5300, 73.8600], [18.5400, 73.8650]];
    for (const [i, [lat, lng]] of coords.entries()) {
      // eslint-disable-next-line no-await-in-loop
      stops.push(await TransportStop.create({ routeId: r._id, name: `Stop ${i + 1}`, sequenceNo: i + 1, etaMinutesFromStart: i * 10, lat, lng }));
    }
    for (const [i, st] of [s.rahul, s.priya, s.aman].entries()) {
      // eslint-disable-next-line no-await-in-loop
      await BusEnrollment.create({ studentId: st.student._id, routeId: r._id, stopId: stops[i % stops.length]._id, academicYearId: s.year._id });
    }
    return { route: r, stops };
  });
  return { ...s, ...route };
}

export const future = (days) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

export function validDocs(days = 200) {
  return ['PERMIT', 'INSURANCE', 'FITNESS', 'PUC'].map((kind) => ({ kind, number: `${kind}-1`, validTo: future(days) }));
}

export function makeVehicle(actor, { reg = 'MH12AB1234', seats = 3, lawful = null, docs = validDocs() } = {}) {
  return inOak(() => vehicles.create(actor, { registrationNo: reg, type: 'BUS', lawfulCapacity: lawful ?? Math.max(seats, 1), usableSeats: seats, documents: docs }));
}

export const today = () => schoolDay().toISOString().slice(0, 10);

/** Signs a body as a device would; returns { headers, rawBody }. */
export function signed(deviceKey, secret, body, { timestamp = Date.now(), nonce = crypto.randomBytes(8).toString('hex') } = {}) {
  const rawBody = JSON.stringify(body);
  return {
    rawBody,
    headers: {
      'x-device-id': deviceKey, 'x-device-timestamp': String(timestamp), 'x-device-nonce': nonce,
      'x-device-signature': signPayload(secret, timestamp, nonce, rawBody),
    },
  };
}

/** Authenticates a signed request like the route does, and returns the device (inside its school). */
export async function asDevice(deviceKey, secret, body, opts) {
  const req = signed(deviceKey, secret, body, opts);
  return verifyDeviceRequest(req);
}
