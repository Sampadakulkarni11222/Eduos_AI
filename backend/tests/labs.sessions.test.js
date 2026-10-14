import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, inSchool, OAK } from './support/mcpSchool.js';
import { Facility } from '../src/models/facility.model.js';
import { DueItem } from '../src/models/dueItem.model.js';
import * as labs from '../src/modules/labs/labs.service.js';
import * as assets from '../src/modules/labs/labs.assets.js';
import * as sessions from '../src/modules/labs/labs.sessions.js';
import { runLabsDue } from '../src/modules/labs/labs.due.js';

/**
 * Practicals see the real state of the lab: an instrument out of service or
 * overdue for calibration, or stock that will have expired, is a visible
 * problem on the plan. Computer labs: seats cannot be over-assigned, no
 * credentials are stored, and decommissioning needs e-waste evidence.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
const DAY = 86_400_000;

beforeEach(async () => { s = await seedSchool(); });

describe('a practical session', () => {
  it('flags unavailable equipment and stock, needs the safety checks, and records supervised attendance', async () => {
    const admin = s.people.ADMIN.actor;
    const teacher = s.people.TEACHER.actor;
    const { lab, item, meter } = await inOak(async () => {
      const room = await Facility.create({ code: '201', name: 'Physics Lab', kind: 'LAB' });
      const l = await labs.createLab(admin, { facilityId: String(room._id), type: 'SCIENCE_PHYSICS', inChargeProfileIds: [String(s.people.TEACHER.profile._id)], safetyChecklist: ['Mains isolated'] });
      const i = await labs.createItem(admin, 'ALL', l.id, { name: 'Copper wire 22 SWG', kind: 'CONSUMABLE', unit: 'pcs' });
      await labs.receive(admin, 'ALL', i.id, { quantity: 10, unit: 'pcs' });
      const m = await assets.createEquipment(admin, 'ALL', l.id, { name: 'Digital multimeter', quantity: 10, calibrationRequired: true, calibrationDueOn: new Date(Date.now() + 2 * DAY) });
      return { lab: l, item: i, meter: m };
    });
    const plan = await inOak(() => sessions.createSession(teacher, 'OWN', {
      labId: lab.id, title: "Ohm's law", sectionId: String(s.sectionA._id), startsAt: new Date(Date.now() + 5 * DAY),
      items: [{ itemId: item.id, quantity: 20, unit: 'pcs' }], equipment: [{ equipmentId: meter.id, quantity: 10 }],
    }));
    const check = await inOak(() => sessions.checkReadiness(teacher, 'OWN', plan.id));
    expect(check.blocking.map((p) => p.kind).sort()).toEqual(['CALIBRATION_OVERDUE', 'STOCK_SHORT']);
    await inOak(() => sessions.requestPreparation(teacher, 'OWN', plan.id, {}));
    expect(await inOak(() => DueItem.countDocuments({ sourceKey: `lab:session:${plan.id}:prep` }))).toBe(1);
    await expect(inOak(() => sessions.markPrepared(teacher, 'OWN', plan.id, {}))).rejects.toMatchObject({ code: 'NOT_READY' });
    // Fix both: calibrate the meter and receive more wire.
    await inOak(() => assets.recordCalibration(admin, 'ALL', meter.id, { certificateNo: 'CAL-2026-17', validUntil: new Date(Date.now() + 365 * DAY) }));
    await inOak(() => labs.receive(admin, 'ALL', item.id, { quantity: 15, unit: 'pcs' }));
    const ready = await inOak(() => sessions.markPrepared(teacher, 'OWN', plan.id, {}));
    expect(ready.status).toBe('READY');
    // Out of service after preparation is still caught at the next check.
    await inOak(() => assets.addEquipmentRepair(admin, 'ALL', meter.id, { issue: 'Display flickers' }));
    const again = await inOak(() => sessions.checkReadiness(teacher, 'OWN', plan.id));
    expect(again.blocking.map((p) => p.kind)).toEqual(['EQUIPMENT_OUT_OF_SERVICE']);
    await expect(inOak(() => sessions.startSession(teacher, 'OWN', plan.id, { checksDone: [] }))).rejects.toMatchObject({ code: 'SAFETY_CHECKS' });
    const started = await inOak(() => sessions.startSession(teacher, 'OWN', plan.id, { checksDone: ['Mains isolated'] }));
    expect(started.attendance).toHaveLength(3);
    const marked = await inOak(() => sessions.recordAttendance(teacher, 'OWN', plan.id, { presentEnrollmentIds: [String(s.rahul.enrollment._id), String(s.priya.enrollment._id)] }));
    expect(marked.presentCount).toBe(2);
    const done = await inOak(() => sessions.completeSession(teacher, 'OWN', plan.id, { outcomeNote: 'All groups plotted V-I graphs' }));
    expect(done.status).toBe('COMPLETED');
    // An incident is recorded against the session and reaches the lab's people.
    const inc = await inOak(() => sessions.reportIncident(teacher, 'OWN', { labId: lab.id, sessionId: plan.id, kind: 'BREAKAGE', description: 'Rheostat knob snapped' }));
    expect(inc.refNo).toMatch(/^LIN\//);
  });
});

describe('computer lab', () => {
  it('limits software seats, refuses credentials, and needs e-waste evidence to decommission', async () => {
    const admin = s.people.ADMIN.actor;
    const lab = await inOak(async () => {
      const room = await Facility.create({ code: '203', name: 'Computer Lab', kind: 'LAB' });
      return labs.createLab(admin, { facilityId: String(room._id), type: 'COMPUTER' });
    });
    const devices = await inOak(() => assets.createDevices(admin, 'ALL', lab.id, { devices: [1, 2, 3].map((n) => ({ tag: `CL-PC-${n}`, workstationNo: `WS-${n}`, os: 'Ubuntu 24.04', warrantyUntil: new Date(Date.now() + 40 * DAY) })) }));
    expect(devices.every((d) => /^LD-/.test(d.code))).toBe(true);
    await expect(inOak(() => assets.createSoftware(admin, 'ALL', { labId: lab.id, name: 'Office suite', licenceKey: 'ABCD-1234' }))).rejects.toMatchObject({ code: 'NO_CREDENTIALS' });
    const sw = await inOak(() => assets.createSoftware(admin, 'ALL', { labId: lab.id, name: 'Typing tutor', seatsTotal: 2, licenceType: 'SUBSCRIPTION', renewalOn: new Date(Date.now() + 20 * DAY), costPaise: 600000 }));
    const results = await Promise.allSettled(devices.map((d) => inOak(() => assets.assignSeat(admin, 'ALL', sw.id, { deviceId: d.id }))));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(results.find((r) => r.status === 'rejected').reason.code).toBe('NO_SEATS');
    await expect(inOak(() => assets.decommissionDevice(admin, 'ALL', devices[0].id, { reason: 'Motherboard dead', eWasteHandler: 'GreenCycle Recyclers' }))).rejects.toMatchObject({ code: 'EVIDENCE_REQUIRED' });
    const gone = await inOak(() => assets.decommissionDevice(admin, 'ALL', devices[0].id, { reason: 'Motherboard dead', eWasteHandler: 'GreenCycle Recyclers', evidence: [{ name: 'Handover note', url: '/uploads/ewaste.pdf' }] }));
    expect(gone.status).toBe('DECOMMISSIONED');
    const scanned = await inOak(() => labs.resolveCode(admin, 'ALL', 'cl-pc-2'));
    expect(scanned.type).toBe('DEVICE');
    await inOak(() => runLabsDue());
    const renewals = await inOak(() => DueItem.find({ department: 'LABS', category: 'RENEWAL' }).lean());
    expect(renewals.some((t) => /Typing tutor/.test(t.title) && t.amountPaise === 600000)).toBe(true);
    expect(renewals.some((t) => /Warranty ends for 2 devices/.test(t.title))).toBe(true);
  });
});
