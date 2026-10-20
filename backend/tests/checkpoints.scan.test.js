import { describe, it, expect, beforeEach } from 'vitest';
import { seedTransportSchool, makeVehicle, inOak, today, asDevice } from './support/transportSafety.js';
import { CheckpointEvent, SafetyAlert, IdCard } from '../src/models/safety.model.js';
import { TripAllocation } from '../src/models/fleet.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import * as checkpoints from '../src/modules/safety/checkpoints.service.js';
import * as devices from '../src/modules/safety/devices.service.js';
import * as trips from '../src/modules/fleet/trips.service.js';
import * as pickup from '../src/modules/safety/pickup.service.js';
import { schoolDay } from '../src/modules/safety/shared.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';

/**
 * ID checkpoints: a repeated scan is counted once, a lost or revoked card is
 * refused and alerted, a replacement keeps the history, a gate departure with
 * no release is flagged, a bus-door scan records boarding, a parent sees only
 * their own child's checkpoints, and gate scans only suggest attendance.
 */
let s; let admin; let staff;
beforeEach(async () => {
  s = await seedTransportSchool({ features: { idCheckpoints: true } });
  admin = s.people.ADMIN.actor;
  staff = { actor: admin };
});

const issue = (st) => inOak(() => checkpoints.issueCard(admin, { studentId: String(st.student._id), code: `QR-${st.student.admissionNo}` }));

describe('cards and scans', () => {
  it('ignores a repeat scan inside the window and a resent device scan id', async () => {
    const card = await issue(s.rahul);
    const first = await inOak(() => checkpoints.scan(staff, { code: card.code, point: 'GATE_IN' }));
    expect(first.result).toBe('ACCEPTED');
    const again = await inOak(() => checkpoints.scan(staff, { code: card.code, point: 'GATE_IN' }));
    expect(again).toMatchObject({ result: 'DUPLICATE_IGNORED', duplicate: true });

    const reader = await inOak(() => devices.create(admin, { kind: 'CHECKPOINT', label: 'Library reader', point: 'LIBRARY' }));
    const scanBody = { scans: [{ code: card.code, scanId: 'r-1' }] };
    const d = await asDevice(reader.deviceKey, reader.secret, scanBody);
    const b1 = await runWithTenant(d.tenantId, () => checkpoints.scan({ device: d }, scanBody));
    const d2 = await asDevice(reader.deviceKey, reader.secret, scanBody);
    const b2 = await runWithTenant(d2.tenantId, () => checkpoints.scan({ device: d2 }, scanBody));
    expect(b1.accepted).toBe(1);
    expect(b2).toMatchObject({ accepted: 0, duplicates: 1 });
    expect(await inOak(() => CheckpointEvent.countDocuments({ result: 'ACCEPTED' }))).toBe(2);
  });

  it('refuses a lost card with an alert, and a replacement keeps the history', async () => {
    const card = await issue(s.rahul);
    await expect(inOak(() => checkpoints.issueCard(admin, { studentId: String(s.rahul.student._id) }))).rejects.toMatchObject({ code: 'ACTIVE_CARD_EXISTS' });
    await inOak(() => checkpoints.blockCard(admin, card.id, { status: 'LOST', reason: 'Lost on the bus' }));
    const r = await inOak(() => checkpoints.scan(staff, { code: card.code, point: 'GATE_IN' }));
    expect(r.result).toBe('REJECTED_REVOKED');
    expect(await inOak(() => SafetyAlert.countDocuments({ kind: 'REVOKED_CARD_USED' }))).toBe(1);
    const { card: fresh, old } = await inOak(() => checkpoints.replaceCard(admin, card.id, { reason: 'Lost card replaced' }));
    expect(old.status).toBe('REPLACED');
    expect(String(fresh.replacesCardId)).toBe(card.id);
    expect((await inOak(() => checkpoints.scan(staff, { code: fresh.code, point: 'GATE_IN' }))).result).toBe('ACCEPTED');
    const hist = await inOak(() => checkpoints.cardHistory(fresh.id));
    expect(hist.cards).toHaveLength(2);
    expect(hist.events.map((e) => e.result).sort()).toEqual(['ACCEPTED', 'REJECTED_REVOKED']);
    expect((await inOak(() => checkpoints.scan(staff, { code: 'NOPE', point: 'GATE_IN' }))).result).toBe('REJECTED_UNKNOWN');
  });

  it('flags a gate departure without a release, but not after an authorised release', async () => {
    const rahul = await issue(s.rahul);
    const aman = await issue(s.aman);
    const out = await inOak(() => checkpoints.scan(staff, { code: aman.code, point: 'GATE_OUT' }));
    expect(out.flags).toContain('NO_AUTHORISED_PICKUP');
    expect(await inOak(() => SafetyAlert.countDocuments({ kind: 'UNAUTHORISED_DEPARTURE' }))).toBe(1);
    await inOak(() => pickup.release(admin, { studentId: String(s.rahul.student._id), receiver: { guardianProfileId: String(s.people.PARENT.profile._id) } }));
    const ok = await inOak(() => checkpoints.scan(staff, { code: rahul.code, point: 'GATE_OUT' }));
    expect(ok.flags).toEqual([]);
  });

  it('records boarding from a bus-door reader on the vehicle\'s trip', async () => {
    const v = await makeVehicle(admin, { seats: 3 });
    const t = await inOak(() => trips.create(admin, { routeId: String(s.route._id), vehicleId: v.id, date: today(), kind: 'MORNING_PICKUP' }));
    await inOak(() => trips.allocate(admin, 'ALL', t.id, { studentId: String(s.rahul.student._id) }));
    const card = await issue(s.rahul);
    const door = await inOak(() => devices.create(admin, { kind: 'CHECKPOINT', label: 'Bus 4 door', point: 'BUS_BOARD', vehicleId: v.id }));
    const body = { code: card.code, scanId: 'door-1' };
    const d = await asDevice(door.deviceKey, door.secret, body);
    const r = await runWithTenant(d.tenantId, () => checkpoints.scan({ device: d }, body));
    expect(r.result).toBe('ACCEPTED');
    const alloc = await inOak(() => TripAllocation.findOne({ tripId: t.id, studentId: s.rahul.student._id }).lean());
    expect(alloc).toMatchObject({ status: 'BOARDED', boardedVia: 'SCAN' });
  });
});

describe('who sees what', () => {
  it('a parent sees only their own child\'s gate and bus checkpoints, with the disclaimer', async () => {
    for (const st of [s.rahul, s.priya]) {
      const c = await issue(st);
      await inOak(() => checkpoints.scan(staff, { code: c.code, point: 'GATE_IN' }));
    }
    const mine = await inOak(() => checkpoints.myChildren(s.people.PARENT.actor, {}));
    expect(mine.children.map((c) => c.name)).toEqual(['Rahul Sharma']);
    expect(mine.children[0].events).toHaveLength(1);
    expect(JSON.stringify(mine)).not.toContain('Priya');
    expect(mine.disclaimer).toMatch(/not proof/);
  });

  it('suggests attendance from gate scans and never writes the register', async () => {
    const day = schoolDay();
    await inOak(() => AttendanceRecord.deleteMany({}));
    await inOak(() => AttendanceRecord.create({ enrollmentId: s.rahul.enrollment._id, date: day, periodNo: null, status: 'ABSENT' }));
    for (const st of [s.rahul, s.aman]) {
      const c = await issue(st);
      await inOak(() => checkpoints.scan(staff, { code: c.code, point: 'GATE_IN' }));
    }
    const before = await inOak(() => AttendanceRecord.find({}).lean());
    const sug = await inOak(() => checkpoints.attendanceSuggestions({ sectionId: String(s.sectionA._id) }));
    const by = Object.fromEntries(sug.rows.map((r) => [r.name, r.suggestion]));
    expect(by['Rahul Sharma']).toBe('CHECK_MARKED_ABSENT_BUT_SCANNED_IN');
    expect(by['Aman Gupta']).toBe('SUGGEST_PRESENT');
    const after = await inOak(() => AttendanceRecord.find({}).lean());
    expect(after).toEqual(before);
    expect(await inOak(() => IdCard.countDocuments({}))).toBe(2);
  });
});
