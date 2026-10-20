import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, inSchool, OAK } from './support/mcpSchool.js';
import { Facility } from '../src/models/facility.model.js';
import { Lab, PracticalSession, LabIncident } from '../src/models/lab.model.js';
import { Vehicle, Trip } from '../src/models/fleet.model.js';
import { Visitor, OutPass } from '../src/models/safety.model.js';
import { CoverAssignment } from '../src/models/staffLeave.model.js';
import { DueItem } from '../src/models/dueItem.model.js';
import { campusLayers, layerAccess, loadOptional, resetOptional, adaptClubs, adaptGreenery } from '../src/modules/campus/layers.service.js';
import { schoolDay } from '../src/modules/safety/shared.js';
import { istDay } from '../src/modules/ptm/relations.js';

/**
 * The campus map's operational layers come from each module's own records and
 * reach only readers whose permissions allow the underlying read. Families get
 * none of them; the gate is two counts; nothing names a visitor or a child.
 */
let s;
let labA;
let labB;
const inOak = (fn) => inSchool(OAK, fn);
const DAY = 86_400_000;
const NOW = () => new Date();
const VISITOR_NAME = 'Mr Confidential Visitor';
const INCIDENT_TEXT = 'Acid splashed on a bench';

beforeEach(async () => {
  resetOptional();
  s = await seedSchool();
  const T = s.people.TEACHER.profile._id;
  const P = s.people.PRINCIPAL.profile._id;
  const now = NOW();
  await inOak(async () => {
    await Facility.create({ code: 'GATE1', name: 'Main Gate', kind: 'GATE' });
    await Facility.create({ code: 'BAY', name: 'Bus Bay', kind: 'TRANSPORT_BAY' });
    await Facility.create({ code: 'G01', name: 'Room G01', kind: 'CLASSROOM', sectionId: s.sectionA._id });
    const roomA = await Facility.create({ code: 'L1', name: 'Chemistry Lab', kind: 'LAB' });
    const roomB = await Facility.create({ code: 'L2', name: 'Computer Lab', kind: 'LAB' });
    labA = await Lab.create({ facilityId: roomA._id, name: 'Chemistry Lab', type: 'SCIENCE_CHEMISTRY', code: 'LAB-1', inChargeProfileIds: [T] });
    labB = await Lab.create({ facilityId: roomB._id, name: 'Computer Lab', type: 'COMPUTER', code: 'LAB-2', inChargeProfileIds: [P] });
    await PracticalSession.create({ refNo: 'PS-1', labId: labA._id, title: 'Titration', subject: 'Chemistry', className: 'Class 6 A', startsAt: new Date(now - 10 * 60_000), endsAt: new Date(now.getTime() + 30 * 60_000), teacherProfileId: T, status: 'IN_PROGRESS' });
    await LabIncident.create({ refNo: 'LI-1', labId: labA._id, kind: 'SPILL', description: INCIDENT_TEXT, peopleInvolved: 'Rahul Sharma', reportedByProfileId: T });
    const bus = await Vehicle.create({ registrationNo: 'MH12AB1234', type: 'BUS', lawfulCapacity: 40, usableSeats: 36, documents: [{ kind: 'INSURANCE', validTo: new Date(now.getTime() + 10 * DAY) }, { kind: 'PERMIT', validTo: new Date(now.getTime() + 300 * DAY) }] });
    await Trip.create({ refNo: 'TR-1', vehicleId: bus._id, date: schoolDay(now), kind: 'AFTERNOON_DROP', usableSeats: 36, seatsAllocated: 28, routeName: 'Route 1' });
    await Visitor.create({ refNo: 'V-1', name: VISITOR_NAME, purpose: 'Meeting', status: 'CHECKED_IN' });
    await Visitor.create({ refNo: 'V-2', name: 'Someone else', purpose: 'Meeting', status: 'CHECKED_OUT' });
    await OutPass.create({ refNo: 'OP-1', studentId: s.rahul.student._id, studentName: 'Rahul Sharma', requestedByProfileId: s.people.PARENT.profile._id, fromAt: new Date(now - DAY), toAt: new Date(now.getTime() + DAY), reason: 'Family function', destination: 'Home', status: 'OUT' });
    await CoverAssignment.create({ date: istDay(now), sectionId: s.sectionA._id, periodNo: 3, startTime: '00:00', endTime: '23:59', absentProfileId: P, substituteProfileId: T });
    await DueItem.create({ refNo: 'D-1', title: 'Electricity bill', department: 'FINANCE', dueAt: new Date(now - 2 * DAY) });
    await DueItem.create({ refNo: 'D-2', title: 'Bus insurance', department: 'TRANSPORT', dueAt: new Date(now.getTime() + 3 * DAY), ownerProfileId: T });
    await DueItem.create({ refNo: 'D-3', title: 'First-aid audit', department: 'HEALTH', dueAt: new Date(now - DAY) });
  });
});

const layersAs = (who) => inOak(() => campusLayers(s.people[who].actor, { now: NOW() }));

describe('who gets which layer', () => {
  it('gives the administrator every operational layer, from the owning modules', async () => {
    const out = await layersAs('ADMIN');
    expect(out.layers).toMatchObject({ labs: true, transport: true, cover: true, tasks: true, gate: true });
    expect(out.unavailable).toEqual([]);
    const chem = out.labs.find((l) => l.name === 'Chemistry Lab');
    expect(chem).toMatchObject({ openIncidents: 1, practicalNow: { title: 'Titration', className: 'Class 6 A' } });
    expect(chem.facilityId).toBeTruthy();
    expect(out.labs).toHaveLength(2);
    expect(out.transport.vehicles[0]).toMatchObject({ registrationNo: 'MH12AB1234', positionStatus: 'NO_DATA', trips: [{ seatsUsed: 28, capacity: 36 }] });
    expect(out.transport.vehicles[0].documentsDue.map((d) => d.kind)).toContain('INSURANCE');
    expect(out.transport.facilityId).toBeTruthy();
    expect(out.cover.now[0]).toMatchObject({ room: 'Room G01', className: 'Class 6 A', label: 'TEACHER user covering for PRINCIPAL user' });
    expect(out.gate).toMatchObject({ visitorsOnSite: 1, studentsOutOnPass: 1 });
    expect(out.tasks.byDepartment.find((r) => r.department === 'FINANCE')).toMatchObject({ mapDepartment: 'FINANCE', overdue: 1 });
    expect(out.tasks.byDepartment.find((r) => r.department === 'TRANSPORT')).toMatchObject({ dueThisWeek: 1 });
  });

  it('never puts visitor names, children, incident details or health items on the map', async () => {
    const text = JSON.stringify(await layersAs('ADMIN'));
    for (const banned of [VISITOR_NAME, 'Someone else', 'Rahul Sharma', INCIDENT_TEXT, 'Family function', 'First-aid audit']) expect(text).not.toContain(banned);
    expect(text).not.toContain('"HEALTH"');
  });

  it('scopes a teacher to the labs they run and their own tasks; no transport or gate', async () => {
    const out = await layersAs('TEACHER');
    expect(out.layers).toMatchObject({ labs: true, transport: false, gate: false, cover: true, tasks: true });
    expect(out.transport).toBeUndefined();
    expect(out.gate).toBeUndefined();
    expect(out.labs.map((l) => l.name)).toEqual(['Chemistry Lab']);
    expect(out.tasks.scope).toBe('OWN');
    // Only the item they own.
    expect(out.tasks.byDepartment.map((r) => r.department)).toEqual(['TRANSPORT']);
    expect(out.tasks.overdue).toBe(0);
  });

  it('gives the warden the out-pass count but not visitors', async () => {
    const out = await layersAs('WARDEN');
    expect(out.layers.gate).toBe(true);
    expect(out.gate).toMatchObject({ visitorsOnSite: null, studentsOutOnPass: 1 });
    expect(out.layers.labs).toBe(false);
  });

  it('gives students and parents none of the operational layers', async () => {
    for (const who of ['PARENT', 'STUDENT']) {
      // eslint-disable-next-line no-await-in-loop
      const out = await layersAs(who);
      expect(Object.values(out.layers).every((v) => v === false)).toBe(true);
      for (const k of ['labs', 'transport', 'cover', 'tasks', 'gate', 'activities', 'greenery']) expect(out[k]).toBeUndefined();
    }
    expect(Object.values(layerAccess({ roleKey: 'PARENT', permissions: { 'labs.read': 'ALL', 'tasks.read': 'ALL' } })).some(Boolean)).toBe(false);
  });

  it('keeps a layer off when the school switches its module off', async () => {
    const { School } = await import('../src/models/school.model.js');
    await School.create({ slug: OAK, name: 'Oakridge Academy', features: { labs: false, fleet: false } }).catch(() => School.updateOne({ slug: OAK }, { $set: { 'features.labs': false, 'features.fleet': false } }));
    const out = await layersAs('ADMIN');
    expect(out.layers.labs).toBe(false);
    expect(out.layers.transport).toBe(false);
    expect(out.labs).toBeUndefined();
  });
});

describe('sports, arts and greenery', () => {
  it('reports a module that is not installed as unavailable instead of failing', async () => {
    expect(await loadOptional('missing', ['../nowhere/none.service.js'], 'clubsActivityFor')).toBeNull();
    const out = await layersAs('ADMIN');
    // Present (from the clubs module) or explicitly unavailable; never an error for the map.
    expect(out.unavailable).not.toContain('activities');
    if (out.activities && !out.activities.available) expect(out.activities.note).toMatch(/not installed/);
    for (const row of out.activities?.items ?? []) for (const k of Object.keys(row)) expect(k).not.toMatch(/student|child|name$/i);
  });

  it('a lab the reader does not run shows its practical but not its counts', async () => {
    await inOak(() => PracticalSession.create({ refNo: 'PS-2', labId: labB._id, title: 'Spreadsheets', startsAt: new Date(Date.now() - 5 * 60_000), endsAt: new Date(Date.now() + 40 * 60_000), teacherProfileId: s.people.TEACHER.profile._id, status: 'IN_PROGRESS' }));
    const out = await layersAs('TEACHER');
    const comp = out.labs.find((l) => l.name === 'Computer Lab');
    expect(comp).toMatchObject({ practicalNow: { title: 'Spreadsheets' }, openIncidents: null, lowStock: null });
  });

  it('keeps only venue, time and activity from club sessions, and counts from green zones', () => {
    const now = new Date('2026-10-15T09:00:00Z');
    const clubs = adaptClubs([{ sessionId: 's1', clubName: 'Football', category: 'SPORT', activity: 'Football', startsAt: '2026-10-15T08:30:00Z', endsAt: '2026-10-15T09:30:00Z', status: 'PLANNED', venue: { facilityId: 'f1', code: 'GRD', name: 'Main Ground', kind: 'GROUND' }, attendees: [{ name: 'Rahul Sharma' }], studentName: 'Rahul Sharma' }], now);
    expect(clubs.items[0]).toMatchObject({ title: 'Football', facilityId: 'f1', venue: 'Main Ground', label: 'Now', startTime: '14:00' });
    expect(JSON.stringify(clubs)).not.toContain('Rahul');
    expect(clubs.totals).toEqual({ sessionsToday: 1, now: 1 });
    const green = adaptGreenery({ zones: [{ id: 'z1', name: 'Herb garden', kind: 'GARDEN', facilityId: null, plants: { planted: 20, alive: 18 }, openSanitationTasks: 1, overdueSanitationTasks: 0 }], recentActivity: [{ label: 'Planted by Riya Kapoor' }], openSanitationTasks: [{ id: 't', overdue: true }] });
    expect(green.items[0]).toMatchObject({ title: 'Herb garden', value: 18, unit: 'of 20 plants alive', count: 1 });
    expect(green.totals).toMatchObject({ zones: 1, plantsAlive: 18, sanitationOpen: 1, sanitationOverdue: 1 });
    expect(JSON.stringify(green)).not.toContain('Riya');
  });
});
