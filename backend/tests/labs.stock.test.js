import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, inSchool, OAK } from './support/mcpSchool.js';
import { Facility } from '../src/models/facility.model.js';
import { LabBatch, LabMovement } from '../src/models/lab.model.js';
import { DueItem } from '../src/models/dueItem.model.js';
import { PurchaseRequest } from '../src/models/finance.model.js';
import * as labs from '../src/modules/labs/labs.service.js';
import { toBase, fromBase } from '../src/modules/labs/units.js';
import { runLabsDue } from '../src/modules/labs/labs.due.js';

/**
 * The lab stock ledger: batches never go below zero even when people issue
 * from the same bottle at the same moment; expired and quarantined batches
 * cannot be issued; disposal needs staff and evidence; hazardous material is
 * not issued to students; and every change is a ledger row that adds up.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
const DAY = 86_400_000;

async function chemistryLab() {
  const admin = s.people.ADMIN.actor;
  return inOak(async () => {
    const room = await Facility.create({ code: '202', name: 'Chemistry Lab', kind: 'LAB', capacity: 30 });
    const lab = await labs.createLab(admin, { facilityId: String(room._id), type: 'SCIENCE_CHEMISTRY', inChargeProfileIds: [String(s.people.TEACHER.profile._id)], safetyChecklist: ['Goggles on', 'Fume hood working'] });
    const acid = await labs.createItem(admin, 'ALL', lab.id, { name: 'Hydrochloric acid 1M', casNo: '7647-01-0', hazardClasses: ['CORROSIVE'], storageGroup: 'ACID', unit: 'mL', minStock: 200 });
    const salt = await labs.createItem(admin, 'ALL', lab.id, { name: 'Sodium chloride', casNo: '7647-14-5', unit: 'g', minStock: 100, reorderQty: 500, estUnitPaise: 50 });
    return { lab, acid, salt };
  });
}

beforeEach(async () => { s = await seedSchool(); });

describe('units', () => {
  it('converts within a dimension and refuses across one', () => {
    expect(toBase(1.5, 'L', 'uL')).toBe(1_500_000);
    expect(toBase(250, 'g', 'mg')).toBe(250_000);
    expect(fromBase(1_500_000, 'mL')).toBe(1500);
    expect(() => toBase(5, 'mL', 'mg')).toThrow(/cannot be converted/);
    expect(() => toBase(0.0001, 'g', 'mg')).toThrow(/finer/);
  });
});

describe('issuing stock', () => {
  it('never takes a batch below zero under concurrent issues, and the ledger adds up', async () => {
    const { lab, salt } = await chemistryLab();
    const teacher = s.people.TEACHER.actor;
    const { batch } = await inOak(() => labs.receive(teacher, 'OWN', salt.id, { quantity: 100, unit: 'g', expiresOn: new Date(Date.now() + 400 * DAY), lotNo: 'L1' }));
    const attempts = await Promise.allSettled(Array.from({ length: 6 }, () => inOak(() => labs.moveOut(teacher, 'OWN', 'ISSUE', { batchId: batch.id, quantity: 30, unit: 'g' }))));
    const won = attempts.filter((a) => a.status === 'fulfilled');
    const lost = attempts.filter((a) => a.status === 'rejected');
    expect(won).toHaveLength(3);
    expect(lost.every((a) => a.reason.code === 'INSUFFICIENT_STOCK')).toBe(true);
    const after = await inOak(() => LabBatch.findById(batch.id).lean());
    expect(after.quantity).toBe(10_000); // 10 g in mg
    const ledger = await inOak(() => LabMovement.find({ batchId: batch.id }).lean());
    expect(ledger.reduce((n, m) => n + m.quantity, 0)).toBe(after.quantity);
    expect(ledger.every((m) => m.balanceAfter >= 0)).toBe(true);
    void lab;
  });

  it('blocks issuing an expired or quarantined batch, and suggests the first-expiring good batch', async () => {
    const { salt } = await chemistryLab();
    const admin = s.people.ADMIN.actor;
    const old = await inOak(() => LabBatch.create({ labId: salt.labId, itemId: salt.id, code: 'LB-OLD', initialQuantity: 50_000, quantity: 50_000, expiresOn: new Date(Date.now() - DAY), status: 'ACTIVE' }));
    await expect(inOak(() => labs.moveOut(admin, 'ALL', 'ISSUE', { code: 'LB-OLD', quantity: 5, unit: 'g' }))).rejects.toMatchObject({ code: 'BATCH_EXPIRED' });
    const soon = (await inOak(() => labs.receive(admin, 'ALL', salt.id, { quantity: 40, unit: 'g', expiresOn: new Date(Date.now() + 30 * DAY) }))).batch;
    const later = (await inOak(() => labs.receive(admin, 'ALL', salt.id, { quantity: 200, unit: 'g', expiresOn: new Date(Date.now() + 300 * DAY) }))).batch;
    await inOak(() => labs.setBatchStatus(admin, 'ALL', later.id, { status: 'QUARANTINED', reason: 'Lid cracked' }));
    await expect(inOak(() => labs.moveOut(admin, 'ALL', 'ISSUE', { batchId: later.id, quantity: 5, unit: 'g' }))).rejects.toMatchObject({ code: 'BATCH_QUARANTINED' });
    await expect(inOak(() => labs.setBatchStatus(admin, 'ALL', String(old._id), { status: 'ACTIVE' }))).rejects.toMatchObject({ code: 'BATCH_EXPIRED' });
    const plan = await inOak(() => labs.suggestFefo(admin, 'ALL', salt.id, { quantity: 60, unit: 'g' }));
    expect(plan.plan.map((p) => p.code)).toEqual([soon.code]);
    expect(plan.shortByDisplay).toBe(20);
    // The expired batch is disposed of by staff, with evidence.
    await expect(inOak(() => labs.moveOut(admin, 'ALL', 'DISPOSED', { code: 'LB-OLD', quantity: 50, unit: 'g', reason: 'Expired' }))).rejects.toMatchObject({ code: 'EVIDENCE_REQUIRED' });
    const studentActor = { ...s.people.STUDENT.actor };
    await expect(inOak(() => labs.moveOut(studentActor, 'ALL', 'DISPOSED', { code: 'LB-OLD', quantity: 50, unit: 'g', reason: 'Expired', evidence: [{ name: 'x', url: '/uploads/x.jpg' }] }))).rejects.toMatchObject({ code: 'STAFF_ONLY' });
    const disposed = await inOak(() => labs.moveOut(admin, 'ALL', 'DISPOSED', { code: 'LB-OLD', quantity: 50, unit: 'g', reason: 'Expired; neutralised and drained per SOP', evidence: [{ name: 'Disposal note', url: '/uploads/disposal.pdf' }] }));
    expect(disposed.batch.status).toBe('DISPOSED');
  });

  it('does not issue hazardous material to a student, and returns no more than was issued', async () => {
    const { acid } = await chemistryLab();
    const teacher = s.people.TEACHER.actor;
    const { batch } = await inOak(() => labs.receive(teacher, 'OWN', acid.id, { quantity: 1, unit: 'L', expiresOn: new Date(Date.now() + 200 * DAY) }));
    await expect(inOak(() => labs.moveOut(teacher, 'OWN', 'ISSUE', { batchId: batch.id, quantity: 50, unit: 'mL', issuedToProfileId: String(s.people.STUDENT.profile._id) }))).rejects.toMatchObject({ code: 'HAZARD_STUDENT' });
    const issued = await inOak(() => labs.moveOut(teacher, 'OWN', 'ISSUE', { batchId: batch.id, quantity: 100, unit: 'mL', issuedToProfileId: String(s.people.TEACHER.profile._id) }));
    await expect(inOak(() => labs.returnStock(teacher, 'OWN', { issueMovementId: issued.movement.id, quantity: 150, unit: 'mL' }))).rejects.toMatchObject({ code: 'RETURN_EXCEEDS_ISSUE' });
    const back = await inOak(() => labs.returnStock(teacher, 'OWN', { issueMovementId: issued.movement.id, quantity: 40, unit: 'mL' }));
    expect(back.batch.quantityDisplay).toBe(940);
    // The ledger cannot be edited.
    await expect(inOak(() => LabMovement.updateOne({ _id: issued.movement.id }, { $set: { quantity: 0 } }))).rejects.toThrow(/append-only/);
  });

  it('keeps other people out of a lab they do not run', async () => {
    const { salt } = await chemistryLab();
    const librarian = { ...s.people.LIBRARIAN.actor };
    await expect(inOak(() => labs.receive(librarian, 'OWN', salt.id, { quantity: 1, unit: 'g', noExpiry: true }))).rejects.toMatchObject({ statusCode: 404 });
    const mine = await inOak(() => labs.listLabs(s.people.TEACHER.actor, 'OWN'));
    expect(mine).toHaveLength(1);
    expect(await inOak(() => labs.listLabs(librarian, 'OWN'))).toHaveLength(0);
  });
});

describe('stocktake, reorder and reminders', () => {
  it('records stocktake differences as adjustments, drafts a purchase request and raises tasks', async () => {
    const { lab, salt } = await chemistryLab();
    const admin = s.people.ADMIN.actor;
    const { batch } = await inOak(() => labs.receive(admin, 'ALL', salt.id, { quantity: 120, unit: 'g', expiresOn: new Date(Date.now() + 20 * DAY) }));
    const take = await inOak(() => labs.stocktake(admin, 'ALL', lab.id, { reason: 'Term-end count', lines: [{ batchId: batch.id, counted: 80, unit: 'g' }] }));
    expect(take.adjusted).toBe(1);
    expect(take.lines[0].deltaDisplay).toBe(-40);
    await expect(inOak(() => labs.stocktake(admin, 'ALL', lab.id, { reason: 'Again', lines: [{ batchId: batch.id, counted: 70, expected: 120, unit: 'g' }] })))
      .resolves.toMatchObject({ adjusted: 0 });
    await inOak(() => runLabsDue());
    const tasks = await inOak(() => DueItem.find({ department: 'LABS' }).lean());
    expect(tasks.some((t) => t.category === 'LAB_EXPIRY')).toBe(true);
    expect(tasks.some((t) => /Reorder Sodium chloride/.test(t.title))).toBe(true);
    const { purchaseRequest } = await inOak(() => labs.reorder(admin, 'ALL', salt.id, {}));
    expect(purchaseRequest.status).toBe('DRAFT');
    const pr = await inOak(() => PurchaseRequest.findById(purchaseRequest.id).lean());
    expect(pr.items[0]).toMatchObject({ qty: 500, unit: 'g' });
    // Running the job again changes nothing.
    await inOak(() => runLabsDue());
    expect(await inOak(() => DueItem.countDocuments({ department: 'LABS' }))).toBe(tasks.length);
  });
});
