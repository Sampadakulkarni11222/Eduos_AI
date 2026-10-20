import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { MCP_TOOLS, mcpToolsFor, confirmableOn, validateMcpRegistry } from '../src/modules/ai/mcp/registry.js';
import { tools as campusops } from '../src/modules/ai/mcp/tools/p6/campusops.js';
import { isDecidingToolName } from '../src/modules/ai/mcp/decisions.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { Facility } from '../src/models/facility.model.js';
import { Lab, LabBatch, PracticalSession } from '../src/models/lab.model.js';
import { Vehicle, Trip, TripAllocation } from '../src/models/fleet.model.js';
import { TransportRoute } from '../src/models/transport.model.js';
import { PickupAdult, ReleaseLog, Visitor, SafetyAlert, OutPass } from '../src/models/safety.model.js';
import { HostelRoom, HostelAllocation } from '../src/models/hostel.model.js';
import { ReadingChallenge } from '../src/models/supportRoles.model.js';
import * as labs from '../src/modules/labs/labs.service.js';
import * as labSessions from '../src/modules/labs/labs.sessions.js';
import * as visitors from '../src/modules/safety/visitors.service.js';
import * as safety from '../src/modules/safety/shared.js';
import * as desk from '../src/modules/library/library.desk.js';
import { inSchool, mcp, actorForRole, OAK } from './support/mcpSchool.js';
import { seedFamilySchool, ymdIn } from './support/familySchool.js';
import { pinClock } from './support/clock.js';

// Built around "today": runs on a school day (next Wednesday morning IST), not on whatever day CI runs.
pinClock();

/**
 * Part-6 campus-operations tools (tools/p6/campusops.js): labs, fleet and
 * trips, ID cards, visitors' hosts, pickup and the release log, warden
 * out-passes, class check-ins, safety settings, alerts and devices, and the
 * remaining library and hostel reads. Each tool is the route's own service
 * behind the route's own guard; every write is a draft that changes nothing
 * until the same person confirms it.
 */
const NAMES = Object.keys(campusops);
let s;
const inOak = (fn) => inSchool(OAK, fn);

async function confirm(actor, name, args, { unchanged } = {}) {
  const proposal = await mcp(OAK, actor, name, args);
  expect(proposal.success, `${name}: ${JSON.stringify(proposal.error)}`).toBe(true);
  expect(proposal.action.status, name).toBe('confirmation_required');
  if (unchanged) expect(await unchanged()).toBe(true);
  const done = await mcp(OAK, actor, name, {}, { confirmationToken: proposal.action.confirmationToken });
  expect(done.success, `${name}: ${JSON.stringify(done.error)}`).toBe(true);
  return { proposal, done };
}

async function read(actor, name, args = {}) {
  const r = await mcp(OAK, actor, name, args);
  expect(r.success, `${name}: ${JSON.stringify(r.error)}`).toBe(true);
  return r;
}

const papers = (validTo) => ['PERMIT', 'INSURANCE', 'FITNESS', 'PUC'].map((kind) => ({ kind, validTo }));

beforeEach(async () => { s = await seedFamilySchool(); });
afterAll(async () => { await resetMcpClient(); });

describe('the contract', () => {
  it('registers closed, non-deciding tools; writes confirm and summarise; the decision is HIGH, web-only and stated; the boot check passes', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(75);
    for (const n of NAMES) {
      const t = MCP_TOOLS[n];
      expect(t, n).toBeTruthy();
      expect(t.inputSchema.additionalProperties, n).toBe(false);
      expect(isDecidingToolName(n), n).toBe(false);
      expect(t.permission, n).toBeTruthy();
      if (t.operation === 'GET') expect(/^(get|list|search)_/.test(n), n).toBe(true);
      else {
        expect(t.confirm, n).toBe(true);
        expect(typeof t.summarise, n).toBe('function');
      }
    }
    const d = MCP_TOOLS.record_visitor_host_decision;
    expect([d.approverDecision, d.risk, d.affectsOthers]).toEqual([true, 'HIGH', true]);
    expect(d.inputSchema.required).toContain('decision');
    expect(d.inputSchema.properties.decision.default).toBeUndefined();
    expect(validateMcpRegistry()).toEqual([]);
    for (const n of ['cancel_bus_trip', 'record_trip_handover', 'record_pickup_release', 'update_safety_settings', 'manage_trip_seat', 'request_outpass_for_resident']) {
      expect(confirmableOn(MCP_TOOLS[n], 'WHATSAPP'), n).toBe(false);
    }
    for (const n of ['check_in_to_class', 'record_practical_attendance', 'mark_trip_stop', 'update_lab_item']) {
      expect(confirmableOn(MCP_TOOLS[n], 'WHATSAPP'), n).toBe(true);
    }
  });

  it('shows each role only what its screens give it', () => {
    const visible = (role) => mcpToolsFor(actorForRole(role)).map((t) => t.name).filter((n) => NAMES.includes(n));
    const parent = visible('PARENT');
    for (const n of ['create_lab', 'add_vehicle', 'record_pickup_release', 'list_safety_alerts', 'check_in_to_class']) expect(parent, n).not.toContain(n);
    // GET /outpass/:id admits hostel.outpass.request too (requireAnyOf): a guardian reads their own child's pass.
    expect(parent).toContain('get_outpass_record');
    expect(parent).toEqual(expect.arrayContaining(['get_library_rules', 'list_my_reading_challenges']));
    expect(visible('TEACHER')).toEqual(expect.arrayContaining(['move_practical_session', 'manage_trip_seat', 'move_bus_trip', 'check_in_to_class', 'list_my_hosted_visitors']));
    expect(visible('TEACHER')).not.toContain('create_lab');
    expect(visible('PRINCIPAL')).toEqual(expect.arrayContaining(['get_vehicle', 'get_vehicle_track', 'get_class_presence_board', 'record_pickup_release', 'get_outpass_record']));
    expect(visible('WARDEN')).toEqual(expect.arrayContaining(['request_outpass_for_resident', 'get_hostel_room', 'get_hostel_incident', 'get_checkpoint_attendance_suggestions']));
    expect(visible('LIBRARIAN')).toContain('close_reading_challenge');
  });
});

describe('laboratories', () => {
  it('administration sets up a lab and an item; stock is quarantined and a practical runs through its steps', async () => {
    const admin = s.people.ADMIN.actor;
    await inOak(() => Facility.create({ code: 'CHEM-1', name: 'Chemistry Lab', kind: 'LAB' }));
    const rooms = await read(admin, 'list_lab_rooms_without_profile');
    expect(rooms.data.items.map((r) => r.code)).toContain('CHEM-1');
    await confirm(admin, 'create_lab', { room: 'Chemistry Lab', type: 'SCIENCE_CHEMISTRY', safetyChecklist: ['Goggles on'] }, { unchanged: async () => (await inOak(() => Lab.countDocuments())) === 0 });
    await confirm(admin, 'add_lab_item', { labName: 'Chemistry', name: 'Copper sulphate', kind: 'CHEMICAL', unit: 'g', minStock: 100 });
    const item = await inOak(async () => (await labs.listItems(admin, 'ALL', {}))[0]);
    const { batch } = await inOak(() => labs.receive(admin, 'ALL', item.id, { quantity: 500, unit: 'g', expiresOn: ymdIn(200) }));

    const lab = await read(admin, 'get_lab', { labName: 'Chemistry' });
    expect(lab.data.safetyChecklist).toEqual(['Goggles on']);
    await confirm(admin, 'set_lab_batch_status', { batch: batch.code, status: 'QUARANTINED', reason: 'Lid cracked' });
    expect((await inOak(() => LabBatch.findById(batch.id).lean())).status).toBe('QUARANTINED');

    // A teacher who does not run the lab cannot change it; a parent has no lab tools at all.
    const t = await mcp(OAK, s.people.TEACHER.actor, 'update_lab', { labName: 'Chemistry', notes: 'x' });
    expect(t.success).toBe(false);
    const p = await mcp(OAK, s.people.PARENT.actor, 'get_lab', { labName: 'Chemistry' });
    expect(p.success).toBe(false);

    const labDoc = await inOak(() => Lab.findOne().lean());
    const start = new Date(Date.now() + 2 * 86_400_000);
    await inOak(() => labSessions.createSession(admin, 'ALL', { labId: String(labDoc._id), title: 'Crystals', startsAt: start.toISOString() }));
    const ready = await confirm(admin, 'move_practical_session', { session: 'Crystals', step: 'CHECK_READINESS' });
    expect(ready.done.speak ?? JSON.stringify(ready.done)).toMatch(/ready/i);
    const notYet = await mcp(OAK, admin, 'move_practical_session', { session: 'Crystals', step: 'START' });
    expect(notYet.success).toBe(false); // the teacher must say the safety checks are done
    await confirm(admin, 'move_practical_session', { session: 'Crystals', step: 'START', allChecksDone: true });
    await confirm(admin, 'move_practical_session', { session: 'Crystals', step: 'COMPLETE', outcomeNote: 'Good crystals' });
    expect((await inOak(() => PracticalSession.findOne().lean())).status).toBe('COMPLETED');
    const got = await read(admin, 'get_practical_session', { session: 'Crystals' });
    expect(got.data.status).toBe('COMPLETED');
  }, 90_000);
});

describe('fleet and trips', () => {
  it('the transport office registers a vehicle and plans a trip; seats and starts run through the trip tools; cancelling is website-only', async () => {
    const admin = s.people.ADMIN.actor;
    await confirm(admin, 'add_vehicle', { registrationNo: 'KA01AB1234', lawfulCapacity: 30, usableSeats: 28, documents: papers(ymdIn(300)) }, { unchanged: async () => (await inOak(() => Vehicle.countDocuments())) === 0 });
    const v = await read(s.people.PRINCIPAL.actor, 'get_vehicle', { vehicle: 'KA01AB1234' });
    expect([v.data.usableSeats, v.data.cannotRun]).toEqual([28, []]);
    await confirm(admin, 'set_vehicle_status', { vehicle: 'KA01AB1234', status: 'IN_SERVICE', note: 'Oil change' });
    await confirm(admin, 'set_vehicle_status', { vehicle: 'KA01AB1234', status: 'ACTIVE' });

    await inOak(() => TransportRoute.create({ name: 'Route 4', status: 'ACTIVE' }));
    await confirm(admin, 'plan_bus_trip', { kind: 'MORNING_PICKUP', date: ymdIn(0), vehicle: 'KA01AB1234', route: 'Route 4' });
    const trip = await inOak(() => Trip.findOne().lean());
    await confirm(admin, 'manage_trip_seat', { step: 'ALLOCATE', trip: trip.refNo, admissionNo: 'OAK-1' });
    expect(await inOak(() => TripAllocation.countDocuments({ status: 'ALLOCATED' }))).toBe(1);
    const shownTrip = await read(admin, 'get_bus_trip', { trip: trip.refNo });
    expect(shownTrip.data.students.map((x) => x.student)).toEqual(['Rahul Sharma']);
    await confirm(admin, 'move_bus_trip', { step: 'START', trip: 'Route 4' });
    expect((await inOak(() => Trip.findById(trip._id).lean())).status).toBe('IN_PROGRESS');

    // Cancelling messages families: proposed on WhatsApp, it is never confirmable there.
    const wa = await mcp(OAK, admin, 'cancel_bus_trip', { trip: trip.refNo, reason: 'Flooding' }, { channel: 'WHATSAPP' });
    if (wa.success) {
      const yes = await mcp(OAK, admin, 'cancel_bus_trip', {}, { channel: 'WHATSAPP', confirmationToken: wa.action.confirmationToken });
      expect(yes.success).toBe(false);
      expect(yes.error?.details?.reason ?? yes.error?.reason ?? JSON.stringify(yes.error)).toMatch(/CONFIRM_ON_WEB/);
    }
    expect((await inOak(() => Trip.findById(trip._id).lean())).status).toBe('IN_PROGRESS');

    // A teacher not on this trip cannot act on it.
    const t = await mcp(OAK, s.people.TEACHER.actor, 'move_bus_trip', { step: 'RECONCILE', trip: trip.refNo });
    expect(t.success).toBe(false);
  }, 90_000);
});

describe('pickup, visitors and alerts', () => {
  it('the office adds a delegate and releases a child only to someone on the list', async () => {
    const admin = s.people.ADMIN.actor;
    await confirm(admin, 'add_student_pickup_adult', { admissionNo: 'OAK-1', kind: 'DELEGATE', name: 'Sunil Sharma', relationship: 'Uncle', toDate: ymdIn(3) });
    expect(await inOak(() => PickupAdult.countDocuments({ status: 'ACTIVE' }))).toBe(1);
    const list = await read(admin, 'list_student_pickup_adults', { admissionNo: 'OAK-1' });
    expect(list.data.adults.map((a) => a.name)).toEqual(['Sunil Sharma']);
    const stranger = await mcp(OAK, admin, 'record_pickup_release', { admissionNo: 'OAK-1', receiverName: 'Random Person' });
    expect(stranger.success).toBe(false);
    await confirm(admin, 'record_pickup_release', { admissionNo: 'OAK-1', receiverName: 'Sunil Sharma', verification: 'ID_CHECKED' });
    expect(await inOak(() => ReleaseLog.countDocuments())).toBe(1);
    const log = await read(admin, 'list_gate_releases', {});
    expect(log.data.items[0].to).toBe('Sunil Sharma');
    // A teacher holds no visitors.manage.
    expect((await mcp(OAK, s.people.TEACHER.actor, 'list_gate_releases', {})).success).toBe(false);
  }, 60_000);

  it("a host records their own decision on a visitor; alerts are acknowledged and resolved; settings change section by section", async () => {
    const T = s.people.TEACHER.actor;
    await inOak(() => visitors.create(s.people.ADMIN.actor, { name: 'Mr Kumar', purpose: 'Parent meeting', hostProfileId: String(s.people.TEACHER.profile._id) }));
    const hosted = await read(T, 'list_my_hosted_visitors');
    expect(hosted.data.items[0].status).toBe('PENDING_HOST');
    await confirm(T, 'record_visitor_host_decision', { visitor: 'Kumar', decision: 'APPROVED' });
    expect((await inOak(() => Visitor.findOne().lean())).status).toBe('APPROVED');

    await inOak(() => safety.raiseAlert({ kind: 'TRIP_DELAY', department: 'TRANSPORT', message: 'Route 4 is 20 min late', dedupeKey: 'test:delay' }));
    const admin = s.people.ADMIN.actor;
    const alerts = await read(admin, 'list_safety_alerts');
    expect(alerts.data.items.map((a) => a.kind)).toContain('TRIP_DELAY');
    await confirm(admin, 'update_safety_alert', { alert: 'Route 4 late', status: 'RESOLVED', note: 'Arrived' });
    expect((await inOak(() => SafetyAlert.findOne().lean())).status).toBe('RESOLVED');
    expect((await mcp(OAK, s.people.LIBRARIAN.actor, 'list_safety_alerts')).success).toBe(false);

    const W = s.people.WARDEN.actor;
    await confirm(W, 'update_safety_settings', { outpass: { lateGraceMinutes: 20 } });
    expect((await inOak(() => safety.getSettings())).outpass.lateGraceMinutes).toBe(20);
    expect((await mcp(OAK, W, 'update_safety_settings', { fleet: { delayMinutes: 5 } })).success).toBe(false);
  }, 60_000);
});

describe('hostel, library and class check-ins', () => {
  it('the warden raises an out-pass for a resident and reads it and the room', async () => {
    const W = s.people.WARDEN.actor;
    const room = await inOak(() => HostelRoom.create({ roomNo: 'B-12', block: 'B', capacity: 2 }));
    await inOak(() => HostelAllocation.create({ roomId: room._id, studentId: s.rahul.student._id, status: 'ACTIVE' }));
    const r = await read(W, 'get_hostel_room', { roomNo: 'B-12' });
    expect(r.data.occupants).toEqual(['Rahul Sharma']);
    await confirm(W, 'request_outpass_for_resident', { studentName: 'Rahul Sharma', fromDate: ymdIn(2), fromTime: '10:00', toDate: ymdIn(3), toTime: '18:00', reason: 'Family function', destination: 'Home' }, { unchanged: async () => (await inOak(() => OutPass.countDocuments())) === 0 });
    const pass = await read(W, 'get_outpass_record', { studentName: 'Rahul Sharma' });
    expect(pass.data.status).toBe('PENDING_WARDEN');
    await confirm(W, 'cancel_resident_outpass', { studentName: 'Rahul Sharma', note: 'Plans changed' });
    expect((await inOak(() => OutPass.findOne().lean())).status).toBe('CANCELLED');
  }, 60_000);

  it('a student reads the desk rules and their challenges; the librarian closes a challenge; a teacher checks in to class', async () => {
    const rules = await read(s.people.STUDENT.actor, 'get_library_rules');
    expect(rules.data.renewDays).toBe(desk.DESK_RULES.renewDays);
    await inOak(() => desk.createChallenge(s.people.LIBRARIAN.actor, { title: 'Read 3 books', startsOn: ymdIn(-1), endsOn: ymdIn(30), targetBooks: 3 }));
    const mine = await read(s.people.STUDENT.actor, 'list_my_reading_challenges');
    expect(mine.data.items.map((c) => c.title)).toEqual(['Read 3 books']);
    await confirm(s.people.LIBRARIAN.actor, 'close_reading_challenge', { challenge: 'Read 3 books' });
    expect((await inOak(() => ReadingChallenge.findOne().lean())).status).toBe('CLOSED');

    const T = s.people.TEACHER.actor;
    await confirm(T, 'check_in_to_class', { periodNo: 1 });
    const mineIn = await read(T, 'list_my_class_check_ins');
    expect(mineIn.data.items.map((c) => c.period)).toEqual([1]);
    expect((await mcp(OAK, s.people.PARENT.actor, 'check_in_to_class', { periodNo: 1 })).success).toBe(false);
  }, 60_000);
});
