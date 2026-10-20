import { describe, it, expect, beforeEach } from 'vitest';
import { seedTransportSchool, makeVehicle, inOak, today, future, validDocs } from './support/transportSafety.js';
import { Trip, TripAllocation } from '../src/models/fleet.model.js';
import { DueItem } from '../src/models/dueItem.model.js';
import { SafetyAlert, ReleaseLog, PickupAdult } from '../src/models/safety.model.js';
import { StudentGuardian } from '../src/models/student.model.js';
import * as vehicles from '../src/modules/fleet/vehicles.service.js';
import * as trips from '../src/modules/fleet/trips.service.js';
import * as pickup from '../src/modules/safety/pickup.service.js';
import { updateSettings } from '../src/modules/safety/shared.js';
import { requireAnyOf } from '../src/modules/safety/access.js';

/**
 * Vehicles and trips: due dates reach the tasks queue, an unroadworthy vehicle
 * or uncleared crew is refused, the last seat cannot be taken twice, a
 * substitute vehicle must seat everyone, boarding on the wrong bus is caught,
 * a child is handed only to an authorised adult, reconciliation finds anyone
 * unaccounted for, and a parent sees only their own child's trip.
 */
let s;
let admin;
beforeEach(async () => { s = await seedTransportSchool(); admin = s.people.ADMIN.actor; });

async function plannedTrip({ seats = 3, kind = 'MORNING_PICKUP', reg = 'MH12AB1234', attendant } = {}) {
  const v = await makeVehicle(admin, { reg, seats });
  const t = await inOak(() => trips.create(admin, { routeId: String(s.route._id), vehicleId: v.id, date: today(), kind, attendant }));
  return { v, t };
}

describe('vehicles', () => {
  it('puts document, safety-check and service dates into the tasks queue and moves them on renewal', async () => {
    const v = await inOak(() => vehicles.create(admin, {
      registrationNo: 'mh 12 cd 9999', lawfulCapacity: 40, usableSeats: 38,
      documents: [...validDocs(200).filter((d) => d.kind !== 'FITNESS'), { kind: 'FITNESS', validTo: future(10) }],
      safety: { fireExtinguisherDueOn: future(20) }, service: { nextDueOn: future(30) },
    }));
    expect(v.registrationNo).toBe('MH12CD9999');
    expect(v.documents.find((d) => d.kind === 'FITNESS').state).toBe('EXPIRING');
    const items = await inOak(() => DueItem.find({ department: 'TRANSPORT', status: 'OPEN' }).lean());
    expect(items.map((i) => i.category).sort()).toEqual(['RENEWAL', 'RENEWAL', 'RENEWAL', 'RENEWAL', 'SERVICE', 'VEHICLE_CHECK']);
    expect(items.some((i) => /Fitness certificate/.test(i.title))).toBe(true);
    // Renewal: the old fitness item closes, a new one opens for the new date.
    await inOak(() => vehicles.update(admin, v.id, { documents: [...validDocs(200).filter((d) => d.kind !== 'FITNESS'), { kind: 'FITNESS', validTo: future(380) }] }));
    const fitness = await inOak(() => DueItem.find({ title: /Fitness/ }).sort({ createdAt: 1 }).lean());
    expect(fitness.map((f) => f.status)).toEqual(['DONE', 'OPEN']);
    await expect(inOak(() => vehicles.update(admin, v.id, { usableSeats: 45 }))).rejects.toMatchObject({ code: 'OVER_LAWFUL_CAPACITY' });
  });

  it('refuses a trip for a vehicle with an expired permit or one in service', async () => {
    const expired = await makeVehicle(admin, { reg: 'MH01XX0001', docs: [...validDocs().filter((d) => d.kind !== 'PERMIT'), { kind: 'PERMIT', validTo: future(-1) }] });
    await expect(inOak(() => trips.create(admin, { routeId: String(s.route._id), vehicleId: expired.id, date: today(), kind: 'MORNING_PICKUP' }))).rejects.toMatchObject({ code: 'VEHICLE_NOT_ROADWORTHY' });
    const servicing = await makeVehicle(admin, { reg: 'MH01XX0002' });
    await inOak(() => vehicles.setStatus(admin, servicing.id, { status: 'IN_SERVICE', note: 'Brake work' }));
    await expect(inOak(() => trips.create(admin, { routeId: String(s.route._id), vehicleId: servicing.id, date: today(), kind: 'MORNING_PICKUP' }))).rejects.toMatchObject({ code: 'VEHICLE_UNAVAILABLE' });
  });

  it('blocks an uncleared driver when the school policy is BLOCK, and warns when it is WARN', async () => {
    const v = await makeVehicle(admin);
    await inOak(() => updateSettings(admin, { fleet: { unverifiedCrewPolicy: 'BLOCK' } }));
    await expect(inOak(() => trips.create(admin, { routeId: String(s.route._id), vehicleId: v.id, date: today(), kind: 'MORNING_PICKUP', driver: { name: 'Unknown Driver' } }))).rejects.toMatchObject({ code: 'CREW_NOT_CLEARED' });
    await inOak(() => updateSettings(admin, { fleet: { unverifiedCrewPolicy: 'WARN' } }));
    const t = await inOak(() => trips.create(admin, { routeId: String(s.route._id), vehicleId: v.id, date: today(), kind: 'MORNING_PICKUP', driver: { name: 'Unknown Driver' } }));
    expect(t.driver.cleared).toBe(false);
    expect(await inOak(() => SafetyAlert.countDocuments({ kind: 'UNVERIFIED_CREW' }))).toBe(1);
  });
});

describe('seats', () => {
  it('lets only one of two concurrent requests take the last seat', async () => {
    const { t } = await plannedTrip({ seats: 1 });
    const results = await Promise.allSettled([
      inOak(() => trips.allocate(admin, 'ALL', t.id, { studentId: String(s.rahul.student._id) })),
      inOak(() => trips.allocate(admin, 'ALL', t.id, { studentId: String(s.aman.student._id) })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason.code).toBe('TRIP_FULL');
    const trip = await inOak(() => Trip.findById(t.id).lean());
    expect(trip.seatsAllocated).toBe(1);
    expect(await inOak(() => TripAllocation.countDocuments({ tripId: t.id }))).toBe(1);
  });

  it('does not take two seats for a double request for the same child', async () => {
    const { t } = await plannedTrip({ seats: 3 });
    const results = await Promise.allSettled([1, 2].map(() => inOak(() => trips.allocate(admin, 'ALL', t.id, { studentId: String(s.rahul.student._id) }))));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await inOak(() => Trip.findById(t.id).lean())).seatsAllocated).toBe(1);
  });

  it('accepts a substitute vehicle only if it seats everyone allocated', async () => {
    const { t } = await plannedTrip({ seats: 3 });
    const out = await inOak(() => trips.allocateEnrolled(admin, 'ALL', t.id));
    expect(out.allocated).toBe(3);
    const small = await makeVehicle(admin, { reg: 'MH12SM0002', seats: 2 });
    await expect(inOak(() => trips.substituteVehicle(admin, t.id, { vehicleId: small.id, reason: 'Breakdown' }))).rejects.toMatchObject({ code: 'CAPACITY_EXCEEDED' });
    const big = await makeVehicle(admin, { reg: 'MH12BG0003', seats: 30 });
    const swapped = await inOak(() => trips.substituteVehicle(admin, t.id, { vehicleId: big.id, reason: 'Breakdown' }));
    expect(swapped.vehicle.registrationNo).toBe('MH12BG0003');
    expect(swapped.usableSeats).toBe(30);
    expect(swapped.substitutions).toHaveLength(1);
  });

  it('frees a released seat once only', async () => {
    const { t } = await plannedTrip({ seats: 2 });
    const a = await inOak(() => trips.allocate(admin, 'ALL', t.id, { studentId: String(s.rahul.student._id) }));
    await inOak(() => trips.release(admin, 'ALL', t.id, a.id, { reason: 'Parent will drop' }));
    await expect(inOak(() => trips.release(admin, 'ALL', t.id, a.id, {}))).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect((await inOak(() => Trip.findById(t.id).lean())).seatsAllocated).toBe(0);
  });
});

describe('boarding, handover and reconciliation', () => {
  it('raises a wrong-vehicle alert when a child boards a bus they are not allocated to', async () => {
    const { t: mine } = await plannedTrip({ seats: 3 });
    const other = await makeVehicle(admin, { reg: 'MH12OT0009', seats: 3 });
    const t2 = await inOak(() => trips.create(admin, { vehicleId: other.id, date: today(), kind: 'EVENT', title: 'Science fair shuttle' }));
    await inOak(() => trips.allocate(admin, 'ALL', mine.id, { studentId: String(s.rahul.student._id) }));
    await expect(inOak(() => trips.board(admin, 'ALL', t2.id, { studentId: String(s.rahul.student._id) }))).rejects.toMatchObject({ code: 'WRONG_VEHICLE' });
    const alert = await inOak(() => SafetyAlert.findOne({ kind: 'WRONG_VEHICLE' }).lean());
    expect(alert.severity).toBe('CRITICAL');
  });

  it('hands a child only to an authorised adult, flags a restricted one, and returns the child to school otherwise', async () => {
    const { t } = await plannedTrip({ kind: 'AFTERNOON_DROP' });
    await inOak(() => trips.allocateEnrolled(admin, 'ALL', t.id));
    await inOak(() => trips.start(admin, 'ALL', t.id));
    for (const st of [s.rahul, s.priya, s.aman]) await inOak(() => trips.board(admin, 'ALL', t.id, { studentId: String(st.student._id) }));

    // A stranger's name is never enough.
    await expect(inOak(() => trips.handover(admin, 'ALL', t.id, { studentId: String(s.rahul.student._id), receiver: { name: 'Someone' } }))).rejects.toMatchObject({ code: 'NOT_AUTHORISED' });
    // The father (linked guardian) may collect Rahul.
    const ok = await inOak(() => trips.handover(admin, 'ALL', t.id, { studentId: String(s.rahul.student._id), receiver: { guardianProfileId: String(s.people.PARENT.profile._id) }, verification: 'KNOWN_TO_STAFF' }));
    expect(ok.status).toBe('HANDED_OVER');
    const log = await inOak(() => ReleaseLog.findOne({ studentId: s.rahul.student._id }).lean());
    expect(log).toMatchObject({ context: 'BUS_DROP', receivedByKind: 'GUARDIAN' });

    // A restricted adult for Priya is flagged and refused.
    const restricted = await inOak(() => pickup.staffCreate(admin, { studentId: String(s.priya.student._id), kind: 'RESTRICTED', name: 'Restricted Adult', restrictionNote: 'Court order (sample)' }));
    await expect(inOak(() => trips.handover(admin, 'ALL', t.id, { studentId: String(s.priya.student._id), receiver: { pickupAdultId: restricted.id } }))).rejects.toMatchObject({ code: 'CUSTODY_RESTRICTED' });
    expect(await inOak(() => SafetyAlert.countDocuments({ kind: 'CUSTODY_RESTRICTION' }))).toBe(1);
    const back = await inOak(() => trips.handover(admin, 'ALL', t.id, { studentId: String(s.priya.student._id), returnToSchool: true, note: 'Nobody at the stop' }));
    expect(back.status).toBe('RETURNED_TO_SCHOOL');

    // Aman is still on the bus: reconciliation names him; completing needs a note.
    const rec = await inOak(() => trips.reconcile(admin, 'ALL', t.id));
    expect(rec).toMatchObject({ allocated: 3, boarded: 3, handedOver: 1, returnedToSchool: 1 });
    expect(rec.unmatched.map((u) => u.studentName)).toEqual(['Aman Gupta']);
    await expect(inOak(() => trips.complete(admin, 'ALL', t.id, {}))).rejects.toMatchObject({ code: 'UNMATCHED_STUDENTS' });
    const done = await inOak(() => trips.complete(admin, 'ALL', t.id, { note: 'Aman collected at school office by father, logged at gate' }));
    expect(done.status).toBe('COMPLETED');
  });

  it('a time-limited delegate can collect only while the delegation is in date', async () => {
    const { t } = await plannedTrip({ kind: 'AFTERNOON_DROP' });
    await inOak(() => trips.allocate(admin, 'ALL', t.id, { studentId: String(s.rahul.student._id) }));
    await inOak(() => trips.start(admin, 'ALL', t.id));
    await inOak(() => trips.board(admin, 'ALL', t.id, { studentId: String(s.rahul.student._id) }));
    const d = await inOak(() => pickup.staffCreate(admin, { studentId: String(s.rahul.student._id), kind: 'DELEGATE', name: 'Aunt Meera', relationship: 'Aunt', validFrom: new Date(Date.now() - 3600_000), validTo: new Date(Date.now() - 60_000) }));
    await expect(inOak(() => trips.handover(admin, 'ALL', t.id, { studentId: String(s.rahul.student._id), receiver: { pickupAdultId: d.id } }))).rejects.toMatchObject({ code: 'NOT_AUTHORISED' });
    await inOak(() => PickupAdult.updateOne({ _id: d.id }, { $set: { validTo: new Date(Date.now() + 3600_000) } }));
    const ok = await inOak(() => trips.handover(admin, 'ALL', t.id, { studentId: String(s.rahul.student._id), receiver: { pickupAdultId: d.id } }));
    expect(ok.handover.receivedByKind).toBe('DELEGATE');
  });

  it('a guardian without pickup authority cannot receive the child', async () => {
    await inOak(() => StudentGuardian.updateOne({ studentId: s.rahul.student._id }, { $set: { pickupAuthorized: false } }));
    const check = await inOak(() => pickup.checkReceiver(s.rahul.student._id, { guardianProfileId: String(s.people.PARENT.profile._id) }));
    expect(check.ok).toBe(false);
  });
});

describe('who sees what', () => {
  it('a parent sees only their own child\'s trip today; a student only their own', async () => {
    const { t } = await plannedTrip({ seats: 3 });
    await inOak(() => trips.allocateEnrolled(admin, 'ALL', t.id));
    await inOak(() => trips.start(admin, 'ALL', t.id));
    const mine = await inOak(() => trips.myTrips(s.people.PARENT.actor));
    expect(mine.children.map((c) => c.name)).toEqual(['Rahul Sharma']);
    const text = JSON.stringify(mine);
    expect(text).not.toMatch(/Priya|Aman/);
    expect(text).not.toMatch(/driver/i);
    expect(mine.children[0].trips[0].eta.isEstimate).toBe(true);
    const student = await inOak(() => trips.myTrips(s.people.STUDENT.actor));
    expect(student.children.map((c) => c.name)).toEqual(['Priya Verma']);
    // A teacher (not on the trip) has no family view and only OWN trips.
    expect((await inOak(() => trips.myTrips(s.people.TEACHER.actor))).children).toEqual([]);
  });

  it('a teacher on bus duty sees and runs only their own trips; parents cannot reach the staff list', async () => {
    const { t } = await plannedTrip({ seats: 3, attendant: { profileId: String(s.people.TEACHER.profile._id) } });
    const other = await makeVehicle(admin, { reg: 'MH12OT0001', seats: 3 });
    const t2 = await inOak(() => trips.create(admin, { vehicleId: other.id, date: today(), kind: 'EVENT', title: 'Sports day' }));
    const teacher = s.people.TEACHER.actor;
    const list = await inOak(() => trips.list(teacher, 'OWN', {}));
    expect(list.map((x) => x.id)).toEqual([t.id]);
    await expect(inOak(() => trips.get(teacher, 'OWN', t2.id))).rejects.toMatchObject({ statusCode: 404 });
    await expect(inOak(() => trips.allocate(teacher, 'OWN', t2.id, { studentId: String(s.rahul.student._id) }))).rejects.toMatchObject({ statusCode: 404 });
    await inOak(() => trips.allocate(teacher, 'OWN', t.id, { studentId: String(s.rahul.student._id) }));

    const gate = requireAnyOf(['transport.fleet.manage'], ['transport.tracking.read', 'ALL'], ['transport.trips.operate']);
    const reach = (actor) => { try { const req = { actor }; gate(req, {}, () => {}); return req.scope; } catch { return null; } };
    expect(reach(s.people.PARENT.actor)).toBe(null);
    expect(reach(s.people.TEACHER.actor)).toBe('OWN');
    expect(reach(s.people.PRINCIPAL.actor)).toBe('ALL');
  });
});
