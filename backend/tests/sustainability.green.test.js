import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, seedPerson, inSchool, OAK, RIVER } from './support/mcpSchool.js';
import { DueItem } from '../src/models/dueItem.model.js';
import { EcoTeam, Plant } from '../src/models/sustainability.model.js';
import * as svc from '../src/modules/sustainability/sustainability.service.js';
import * as sanitation from '../src/modules/sustainability/sustainability.sanitation.js';
import { buildPack, packCsv, PACK_DISCLAIMER } from '../src/modules/sustainability/sustainability.packs.js';
import { sustainabilityFor } from '../src/modules/sustainability/sustainability.map.js';
import { metric as getMetric } from '../src/modules/analytics/catalogue.js';
import '../src/modules/analytics/metrics/index.js';
import * as tasks from '../src/modules/tasks/tasks.service.js';

/**
 * Sustainability: survival checks need photo evidence; hazardous waste leaves
 * only with a vendor receipt; eco points exist only once someone other than
 * the logger has verified the activity; sanitation duties run through the
 * tasks engine; evidence packs support a submission and never claim to file it.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
const photo = [{ name: 'photo.jpg', url: '/uploads/photo.jpg' }];
const DAY = 86_400_000;

beforeEach(async () => {
  s = await seedSchool();
  s.people.COMPLIANCE = await seedPerson({ roleKey: 'COMPLIANCE', roleId: s.roleIds.COMPLIANCE });
});

async function classTeam() {
  return inOak(() => svc.createTeam(s.people.ADMIN.actor, { kind: 'CLASS', name: 'Class 6 A', sectionId: String(s.sectionA._id) }));
}

describe('trees and plants', () => {
  it('needs photo evidence for a survival check and reports survival against planted', async () => {
    const admin = s.people.ADMIN.actor;
    const team = await classTeam();
    const zone = await inOak(() => svc.createZone(admin, { name: 'East garden', kind: 'GARDEN' }));
    const neem = await inOak(() => svc.createPlant(s.people.TEACHER.actor, 'OWN', { species: 'Azadirachta indica', commonName: 'Neem', zoneId: zone.id, plantedOn: '2026-07-01', plantedByTeamId: team.id, count: 4 }));
    const tulsi = await inOak(() => svc.createPlant(admin, 'ALL', { species: 'Ocimum tenuiflorum', kind: 'HERB', zoneId: zone.id, plantedOn: '2026-07-02', count: 1 }));
    expect(neem.code).toMatch(/^TRE\//);
    await expect(inOak(() => svc.recordPlantCheck(admin, 'ALL', tulsi.id, { status: 'DEAD' }))).rejects.toMatchObject({ code: 'EVIDENCE_REQUIRED' });
    await inOak(() => svc.recordPlantCheck(admin, 'ALL', tulsi.id, { status: 'DEAD', evidence: photo }));
    // A teacher checks only their own class's plantings.
    await expect(inOak(() => svc.recordPlantCheck(s.people.TEACHER.actor, 'OWN', tulsi.id, { status: 'ALIVE', evidence: photo }))).rejects.toMatchObject({ statusCode: 404 });
    const checked = await inOak(() => svc.recordPlantCheck(s.people.TEACHER.actor, 'OWN', neem.id, { status: 'ALIVE', evidence: photo, note: 'All four healthy' }));
    expect(checked.checks).toHaveLength(1);
    const f = await inOak(() => svc.figures(svc.periodFrom({ preset: 'year' })));
    expect(f.trees).toMatchObject({ planted: 5, alive: 4, survivalPct: 80 });
  });
});

describe('waste', () => {
  it('records weights by stream and refuses hazardous handover without a vendor receipt', async () => {
    const admin = s.people.ADMIN.actor;
    const today = new Date();
    await inOak(() => svc.createWaste(admin, { date: today, stream: 'WET', weightKg: 12.5, destination: 'COMPOST' }));
    await inOak(() => svc.createWaste(admin, { date: today, stream: 'DRY', weightKg: 7.5, segregated: false, vendorName: 'City Recyclers' }));
    await expect(inOak(() => svc.createWaste(admin, { date: today, stream: 'E_WASTE', weightKg: 3, vendorName: 'GreenCycle' }))).rejects.toMatchObject({ code: 'RECEIPT_REQUIRED' });
    const ew = await inOak(() => svc.createWaste(admin, { date: today, stream: 'E_WASTE', weightKg: 3, vendorName: 'GreenCycle', receiptNo: 'GC-2026-118' }));
    expect(ew.refNo).toMatch(/^WST\//);
    const f = await inOak(() => svc.figures(svc.periodFrom({ preset: 'month' })));
    expect(f.waste.totalKg).toBe(23);
    expect(f.waste.byStreamKg).toMatchObject({ WET: 12.5, DRY: 7.5, E_WASTE: 3 });
    expect(f.waste.segregationPct).toBe(67.4);
    expect(f.waste.compostedKg).toBe(12.5);
    // 23 kg over the four pupils on roll.
    expect(f.waste.perStudentKg).toBe(5.75);
  });
});

describe('eco points', () => {
  it('counts only verified activities, never self-verified, and keeps a teacher to their own teams', async () => {
    const teacher = s.people.TEACHER.actor;
    const team = await classTeam();
    const otherTeam = await inOak(() => svc.createTeam(s.people.ADMIN.actor, { kind: 'CLUB', name: 'Eco club' }));
    await expect(inOak(() => svc.logActivity(teacher, 'OWN', { teamId: otherTeam.id, title: 'Litter walk', date: new Date() }))).rejects.toMatchObject({ statusCode: 404 });
    const act = await inOak(() => svc.logActivity(teacher, 'OWN', { teamId: team.id, title: 'Plastic-free lunch week', category: 'LIFE_ACTION', lifeTheme: 'SAY_NO_TO_SINGLE_USE_PLASTIC', date: new Date(), participants: 32, evidence: photo }));
    expect(act.status).toBe('SUBMITTED');
    expect((await inOak(() => svc.ecoPoints(s.people.STUDENT.actor))).schoolPoints).toBe(0);
    // The teacher holds verify at OWN for their class, but cannot verify what they logged.
    await expect(inOak(() => svc.decideActivity(teacher, 'OWN', act.id, { decision: 'VERIFY' }))).rejects.toMatchObject({ code: 'SELF_VERIFY' });
    const done = await inOak(() => svc.decideActivity(s.people.COMPLIANCE.actor, 'ALL', act.id, { decision: 'VERIFY', points: 12 }));
    expect(done).toMatchObject({ status: 'VERIFIED', points: 12 });
    await expect(inOak(() => svc.decideActivity(s.people.ADMIN.actor, 'ALL', act.id, { decision: 'VERIFY' }))).rejects.toMatchObject({ code: 'ALREADY_DECIDED' });
    const board = await inOak(() => svc.ecoPoints(s.people.STUDENT.actor));
    expect(board.schoolPoints).toBe(12);
    const mine = board.teams.find((t) => t.mine);
    expect(mine).toMatchObject({ name: 'Class 6 A', points: 12 });
    // The board names teams and points only: no pupils, no evidence links.
    expect(JSON.stringify(board)).not.toMatch(/uploads|Priya|Rahul/);
    // Students and parents do not reach the staff registers.
    await expect(inOak(() => svc.listWaste(s.people.PARENT.actor))).rejects.toMatchObject({ code: 'STAFF_ONLY' });
    // Another school sees nothing of Oakridge's teams.
    expect(await inSchool(RIVER, () => EcoTeam.countDocuments({}))).toBe(0);
  });

  it('rejecting needs a reason and earns nothing', async () => {
    const team = await classTeam();
    const act = await inOak(() => svc.logActivity(s.people.TEACHER.actor, 'OWN', { teamId: team.id, title: 'Poster', date: new Date() }));
    await expect(inOak(() => svc.decideActivity(s.people.ADMIN.actor, 'ALL', act.id, { decision: 'REJECT' }))).rejects.toMatchObject({ statusCode: 400 });
    const r = await inOak(() => svc.decideActivity(s.people.ADMIN.actor, 'ALL', act.id, { decision: 'REJECT', note: 'Duplicate of last week' }));
    expect(r).toMatchObject({ status: 'REJECTED', points: 0 });
  });
});

describe('sanitation duties through the tasks engine', () => {
  it('announces each occurrence as a task with evidence, closes it on a check and announces the next', async () => {
    const admin = s.people.ADMIN.actor;
    const zone = await inOak(() => svc.createZone(admin, { name: 'Block A toilets', kind: 'TOILET_BLOCK' }));
    const duty = await inOak(() => sanitation.createDuty(admin, { kind: 'TOILET_CLEANING', title: 'Clean Block A girls\' toilets', zoneId: zone.id, ownerProfileId: String(s.people.WARDEN.profile._id), firstDueAt: new Date(Date.now() + DAY) }));
    const first = await inOak(() => DueItem.findOne({ sourceKey: sanitation.occurrenceKey({ _id: duty.id, nextDueAt: duty.nextDueAt }) }).lean());
    expect(first).toMatchObject({ department: 'SUSTAINABILITY', category: 'SANITATION', requiresEvidence: true, status: 'OPEN' });
    expect(String(first.ownerProfileId)).toBe(String(s.people.WARDEN.profile._id));
    // Someone who does not own the duty (and holds manage only at OWN) cannot record its check.
    await expect(inOak(() => sanitation.recordCheck(s.people.TEACHER.actor, 'OWN', duty.id, { itemsDone: duty.checklist, evidence: photo }))).rejects.toMatchObject({ statusCode: 404 });
    await expect(inOak(() => sanitation.recordCheck(admin, 'ALL', duty.id, { itemsDone: duty.checklist }))).rejects.toMatchObject({ code: 'EVIDENCE_REQUIRED' });
    await expect(inOak(() => sanitation.recordCheck(admin, 'ALL', duty.id, { itemsDone: duty.checklist.slice(1), evidence: photo }))).rejects.toMatchObject({ code: 'NOTE_REQUIRED' });
    const { duty: after } = await inOak(() => sanitation.recordCheck(admin, 'ALL', duty.id, { itemsDone: duty.checklist, evidence: photo }));
    expect((await inOak(() => DueItem.findById(first._id).lean())).status).toBe('DONE');
    expect(new Date(after.nextDueAt).getTime()).toBeGreaterThan(new Date(duty.nextDueAt).getTime());
    expect(after.openTask).not.toBeNull();
    // Completing the task from the Tasks screen counts as a check at the next sync.
    const second = await inOak(() => DueItem.findOne({ sourceKey: sanitation.occurrenceKey({ _id: duty.id, nextDueAt: after.nextDueAt }) }).lean());
    await inOak(() => tasks.complete(admin, 'ALL', String(second._id), { evidence: photo }));
    const sync = await inOak(() => sanitation.syncDuties());
    expect(sync.advanced).toBe(1);
    expect(await inOak(() => sanitation.listChecks(admin, duty.id))).toHaveLength(2);
    const map = await inOak(() => sustainabilityFor());
    expect(map.zones[0]).toMatchObject({ name: 'Block A toilets', openSanitationTasks: 1 });
    expect(map.openSanitationTasks).toHaveLength(1);
  });

  it('raises a restock task when a pad dispenser falls to its reorder level', async () => {
    const admin = s.people.ADMIN.actor;
    const duty = await inOak(() => sanitation.createDuty(admin, { kind: 'PAD_DISPENSER', title: 'Pad dispenser, Block B', stockLevel: 40, reorderLevel: 10 }));
    await inOak(() => sanitation.recordCheck(admin, 'ALL', duty.id, { itemsDone: duty.checklist, evidence: photo, stockAfter: 8 }));
    const restock = await inOak(() => DueItem.findOne({ sourceKey: `sanitation:${duty.id}:restock` }).lean());
    expect(restock).toMatchObject({ status: 'OPEN', severity: 'HIGH' });
  });
});

describe('evidence packs and analytics', () => {
  it('compiles packs as evidence to support a submission, labels unknown fields generically, and never claims to file', async () => {
    const admin = s.people.ADMIN.actor;
    await inOak(() => svc.recordMeter(admin, { kind: 'WATER', period: new Date().toISOString().slice(0, 7), startReading: 100, endReading: 160, evidence: [{ name: 'Water bill', url: '/uploads/water.pdf' }] }));
    await inOak(() => svc.recordMeter(admin, { kind: 'ELECTRICITY', period: new Date().toISOString().slice(0, 7), quantity: 1200 }));
    await inOak(() => svc.createWaste(admin, { date: new Date(), stream: 'HAZARDOUS_LAB', weightKg: 1.2, vendorName: 'SafeChem', receipts: [{ name: 'Manifest', url: '/uploads/manifest.pdf' }] }));
    for (const key of ['shvr', 'cse', 'life']) {
      // eslint-disable-next-line no-await-in-loop
      const pack = await inOak(() => buildPack(admin, key, { preset: 'year' }));
      expect(pack.disclaimer).toBe(PACK_DISCLAIMER);
      expect(pack.disclaimer).toMatch(/^Evidence to support your submission/);
      expect(pack.fieldsNote).toMatch(/not encoded/);
      expect(JSON.stringify(pack)).not.toMatch(/submitted to|filed with|has been submitted/i);
    }
    const cse = await inOak(() => buildPack(admin, 'cse', { preset: 'year' }));
    expect(cse.sections.map((x) => x.title)).toEqual(['Air', 'Energy', 'Food', 'Land', 'Water', 'Waste']);
    expect(cse.sections.find((x) => x.key === 'air').gaps[0]).toMatch(/does not record/);
    expect(cse.sections.find((x) => x.key === 'waste').evidence.map((e) => e.url)).toContain('/uploads/manifest.pdf');
    const life = await inOak(() => buildPack(admin, 'life', { preset: 'year' }));
    expect(life.sections).toHaveLength(7);
    const { csv } = await inOak(() => packCsv(admin, 'shvr', { preset: 'year' }));
    expect(csv).toMatch(/Evidence to support your submission/);
    // Pupils on roll: 4. 60 kL water and 1200 kWh this month.
    const ctx = { period: svc.periodFrom({ preset: 'month' }), memo: (_k, fn) => fn(), scope: { all: true } };
    expect((await inOak(() => getMetric('facilities.water_per_student').compute(ctx))).value).toBe(15000);
    expect((await inOak(() => getMetric('facilities.energy_per_student').compute(ctx))).value).toBe(300);
    expect((await inOak(() => getMetric('facilities.tree_survival').compute(ctx))).value).toBeNull();
    // Packs are staff-only.
    await expect(inOak(() => buildPack(s.people.STUDENT.actor, 'shvr'))).rejects.toMatchObject({ code: 'STAFF_ONLY' });
    expect(await inOak(() => Plant.countDocuments({}))).toBe(0);
  });
});
