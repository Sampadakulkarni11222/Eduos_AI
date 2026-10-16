import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { inSchool, OAK, RIVER, seedPerson, actorForRole } from './support/mcpSchool.js';
import { seedFamilySchool, ymdIn } from './support/familySchool.js';
import { SYSTEM_ROLES, RESTRICTED_BY_DEFAULT, PLATFORM_WITHHELD } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { HealthVisit, MedicationPlan, MedicationDose, CareNote, HealthEntry } from '../src/models/health.model.js';
import { MessageOutbox } from '../src/models/messaging.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { DueItem } from '../src/models/dueItem.model.js';
import * as health from '../src/modules/health/health.service.js';

/**
 * The school health room (F14): restricted, encrypted, audited.
 *
 * What these tests hold the module to:
 *   - the health.* keys are restricted: ADMIN and SUPER_ADMIN do not hold them; the
 *     principal holds counts only; teachers hold care notes only; parents their own child
 *   - clinical fields are encrypted at rest (no plain text in the stored row)
 *   - every read of a child's record is audited; refused attempts are too
 *   - parents are told (through the outbox, with no clinical words) for the chosen outcomes
 *   - a dose needs an active plan with the parent's consent; a controlled medicine is
 *     countersigned by a second person
 *   - the class teacher sees only shared, active care notes for their own class
 *   - stock expiry becomes a task
 */

let s;
const inOak = (fn) => inSchool(OAK, fn);
const roleGrants = (key) => buildPermissionMap({ permissions: SYSTEM_ROLES.find((r) => r.key === key).grants });

beforeEach(async () => {
  s = await seedFamilySchool();
  s.people.NURSE = await seedPerson({ roleKey: 'NURSE', roleId: s.roleIds.NURSE, displayName: 'Nurse Joy' });
  s.people.NURSE2 = await seedPerson({ roleKey: 'NURSE', roleId: s.roleIds.NURSE, displayName: 'Nurse Two' });
});

const N = () => s.people.NURSE.actor;
const rahulId = () => String(s.rahul.student._id);
const amanId = () => String(s.aman.student._id);

async function visit(over = {}) {
  return inOak(() => health.recordVisit(N(), {
    studentId: rahulId(), complaint: 'Headache after PE', vitals: { temperatureC: 37.9, pulse: 92 },
    action: 'Paracetamol 250 mg as per plan; rested 30 minutes', outcome: 'REST', ...over,
  }));
}

describe('the permission model', () => {
  it('keeps the health keys from the administrator and the platform, and gives the principal counts only', () => {
    for (const k of ['health.read', 'health.manage', 'health.witness', 'health.carenotes.read']) {
      expect(RESTRICTED_BY_DEFAULT).toContain(k);
      expect(PLATFORM_WITHHELD).toContain(k);
      expect(roleGrants('ADMIN')[k], `ADMIN ${k}`).toBeUndefined();
      expect(roleGrants('SUPER_ADMIN')[k], `SUPER_ADMIN ${k}`).toBeUndefined();
      expect(roleGrants('PRINCIPAL')[k], `PRINCIPAL ${k}`).toBeUndefined();
    }
    expect(roleGrants('PRINCIPAL')['health.summary.read']).toBe('ALL');
    expect(roleGrants('ADMIN')['health.summary.read']).toBe('ALL');
    expect(roleGrants('NURSE')).toMatchObject({ 'health.read': 'ALL', 'health.manage': 'ALL', 'health.witness': 'ALL' });
    expect(roleGrants('PARENT')['health.read']).toBe('OWN');
    expect(roleGrants('PARENT')['health.manage']).toBeUndefined();
    expect(roleGrants('TEACHER')['health.carenotes.read']).toBe('OWN');
    expect(roleGrants('TEACHER')['health.read']).toBeUndefined();
    for (const role of ['STUDENT', 'FINANCE', 'LIBRARIAN', 'WARDEN', 'HR', 'MARKETING', 'COMPLIANCE', 'TRUSTEE', 'ALUMNUS']) {
      const g = roleGrants(role);
      expect(Object.keys(g).filter((k) => k.startsWith('health.') && k !== 'health.summary.read'), role).toEqual([]);
    }
  });

  it('refuses the administrator, principal, teacher and student any child health record', async () => {
    await visit();
    for (const who of ['ADMIN', 'PRINCIPAL', 'TEACHER', 'STUDENT', 'WARDEN']) {
      const a = s.people[who].actor;
      await expect(inOak(() => health.listVisits(a, {})), who).rejects.toMatchObject({ statusCode: 403 });
      await expect(inOak(() => health.medicationLog(a, rahulId())), who).rejects.toMatchObject({ statusCode: 403 });
      await expect(inOak(() => health.healthCard(a, rahulId())), who).rejects.toMatchObject({ statusCode: 403 });
      await expect(inOak(() => health.recordVisit(a, { studentId: rahulId(), complaint: 'x', outcome: 'REST' })), who).rejects.toMatchObject({ statusCode: 403 });
    }
  });
});

describe('visits', () => {
  it('encrypts the clinical detail at rest and lets the nurse read it back', async () => {
    const v = await visit();
    expect(v.refNo).toMatch(/^HV\//);
    expect(v.complaint).toBe('Headache after PE');
    expect(v.vitals.temperatureC).toBe(37.9);
    const raw = await inOak(() => HealthVisit.findById(v.id).lean());
    expect(JSON.stringify(raw)).not.toMatch(/Headache|Paracetamol|37\.9/);
  });

  it('tells the parents for the chosen outcomes only, with no clinical words in the message', async () => {
    await visit({ outcome: 'REST' });
    expect(await inOak(() => MessageOutbox.countDocuments({ templateKey: 'HEALTH_ROOM_UPDATE' }))).toBe(0);
    const sent = await visit({ outcome: 'SENT_HOME' });
    expect(sent.parentNotified.reasons).toEqual(['SENT_HOME']);
    const msgs = await inOak(() => MessageOutbox.find({ templateKey: 'HEALTH_ROOM_UPDATE' }).lean());
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.every((m) => String(m.recipientProfileId) === String(s.people.PARENT.profile._id))).toBe(true);
    expect(JSON.stringify(msgs)).not.toMatch(/Headache|Paracetamol|sent home/i);
    // An injury and a medicine given are triggers by default; the school can turn one off.
    await inOak(() => health.updateSettings(N(), { notifyOn: ['SENT_HOME'] }));
    const injured = await visit({ outcome: 'FIRST_AID', injury: true });
    expect(injured.parentNotified).toBeNull();
    const chosen = await visit({ outcome: 'FIRST_AID', notifyParent: true });
    expect(chosen.parentNotified.reasons).toEqual(['NURSE_CHOSE']);
  });

  it('shows a parent their own child only, and audits each read and each refusal', async () => {
    await visit();
    await inOak(() => health.recordVisit(N(), { studentId: amanId(), complaint: 'Grazed knee', outcome: 'FIRST_AID', injury: true }));
    const mine = await inOak(() => health.listVisits(s.people.PARENT.actor, {}));
    expect(mine.items.map((v) => v.studentName)).toEqual(['Rahul Sharma']);
    expect(JSON.stringify(mine)).not.toMatch(/Grazed knee|Aman/);
    await expect(inOak(() => health.listVisits(s.people.PARENT.actor, { studentId: amanId() }))).rejects.toMatchObject({ statusCode: 404 });
    await expect(inOak(() => health.listVisits(s.people.PARENT3.actor, { studentId: rahulId() }))).rejects.toMatchObject({ statusCode: 404 });
    const reads = await inOak(() => AuditLog.find({ action: 'health.read' }).lean());
    expect(reads.some((r) => String(r.actorProfileId) === String(s.people.PARENT.profile._id))).toBe(true);
    const denied = await inOak(() => AuditLog.find({ action: 'health.access_denied' }).lean());
    expect(denied.map((d) => d.entityId)).toEqual(expect.arrayContaining([amanId(), rahulId()]));
    // The audit row names the fields, never the values.
    expect(JSON.stringify(reads)).not.toMatch(/Headache|Grazed/);
  });

  it('keeps each school\'s health room to itself', async () => {
    await visit();
    const riverNurse = await seedPerson({ roleKey: 'NURSE', roleId: s.roleIds.NURSE, tenantId: RIVER, displayName: 'River nurse' });
    const theirs = await inSchool(RIVER, () => health.listVisits(riverNurse.actor, {}));
    expect(theirs.items).toHaveLength(0);
  });
});

describe('medication plans and the administration record', () => {
  const nursePlan = (over = {}) => inOak(() => health.createPlan(N(), {
    studentId: rahulId(), medicine: { name: 'Salbutamol inhaler', strength: '100 mcg' }, dose: '2 puffs', times: ['12:30'],
    startOn: ymdIn(-1), endOn: ymdIn(30), ...over,
  }));

  it('a plan the nurse drafts waits for the parent\'s consent, and no dose can be given before it', async () => {
    const plan = await nursePlan();
    expect(plan.status).toBe('AWAITING_CONSENT');
    expect(await inOak(() => MessageOutbox.countDocuments({ templateKey: 'HEALTH_CONSENT_REQUEST' }))).toBeGreaterThan(0);
    const noon = new Date(`${ymdIn(0)}T12:35:00+05:30`);
    await expect(inOak(() => health.recordDose(N(), { planId: plan.id, slot: '12:30', status: 'GIVEN' }, { now: noon }))).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    // Another parent cannot consent; the child's parent must upload the prescription.
    await expect(inOak(() => health.consentPlan(s.people.PARENT2.actor, plan.id, { consent: true }))).rejects.toMatchObject({ statusCode: 404 });
    await expect(inOak(() => health.consentPlan(s.people.PARENT.actor, plan.id, { consent: true }))).rejects.toMatchObject({ code: 'PRESCRIPTION_REQUIRED' });
    const ok = await inOak(() => health.consentPlan(s.people.PARENT.actor, plan.id, { consent: true, prescription: { name: 'Prescription.pdf', url: '/uploads/rx-1.pdf' } }));
    expect(ok.status).toBe('ACTIVE');
    const dose = await inOak(() => health.recordDose(N(), { planId: plan.id, slot: '12:30', status: 'GIVEN' }, { now: noon }));
    expect(dose.status).toBe('GIVEN');
    expect(dose.countersign).toBeNull();
    await expect(inOak(() => health.recordDose(N(), { planId: plan.id, slot: '12:30', status: 'GIVEN' }, { now: noon }))).rejects.toMatchObject({ code: 'DOSE_ALREADY_RECORDED' });
    await expect(inOak(() => health.recordDose(N(), { planId: plan.id, slot: '15:00', status: 'GIVEN' }, { now: noon }))).rejects.toMatchObject({ code: 'NOT_A_SCHEDULED_TIME' });
    // The parent sees the log for their child; the stored plan is encrypted.
    const log = await inOak(() => health.medicationLog(s.people.PARENT.actor, rahulId()));
    expect(log.items[0]).toMatchObject({ status: 'GIVEN', medicine: 'Salbutamol inhaler', by: 'Nurse Joy' });
    const raw = await inOak(() => MedicationPlan.findById(plan.id).lean());
    expect(JSON.stringify(raw)).not.toMatch(/Salbutamol|puffs|rx-1/);
  });

  it('a parent creates a plan for their own child with the prescription and consent, never for another child', async () => {
    const body = { medicine: { name: 'Cetirizine' }, dose: '5 ml', times: '13:00', startOn: ymdIn(0), endOn: ymdIn(5), consent: true, prescription: { name: 'note.jpg', url: '/uploads/note.jpg' } };
    const plan = await inOak(() => health.createPlan(s.people.PARENT.actor, { ...body, studentId: rahulId() }));
    expect(plan.status).toBe('ACTIVE');
    expect(plan.consent.byName).toBeTruthy();
    await expect(inOak(() => health.createPlan(s.people.PARENT.actor, { ...body, studentId: amanId() }))).rejects.toMatchObject({ statusCode: 404 });
    await expect(inOak(() => health.createPlan(s.people.PARENT.actor, { ...body, studentId: rahulId(), consent: false }))).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
  });

  it('a controlled medicine is countersigned by a second person, never the one who gave it', async () => {
    const plan = await nursePlan({ controlled: true, medicine: { name: 'Methylphenidate' }, dose: '10 mg', times: ['11:00'] });
    await inOak(() => health.consentPlan(s.people.PARENT.actor, plan.id, { consent: true, prescription: { name: 'rx.pdf', url: '/uploads/rx.pdf' } }));
    const at = new Date(`${ymdIn(0)}T11:05:00+05:30`);
    const dose = await inOak(() => health.recordDose(N(), { planId: plan.id, slot: '11:00', status: 'GIVEN' }, { now: at }));
    expect(dose.countersign).toMatchObject({ required: true, by: null });
    expect((await inOak(() => health.summary(s.people.PRINCIPAL.actor, {}))).medication.awaitingCountersign).toBe(1);
    await expect(inOak(() => health.countersignDose(N(), dose.id))).rejects.toMatchObject({ code: 'SECOND_PERSON_REQUIRED' });
    await expect(inOak(() => health.countersignDose(s.people.TEACHER.actor, dose.id))).rejects.toMatchObject({ statusCode: 403 });
    const done = await inOak(() => health.countersignDose(s.people.NURSE2.actor, dose.id));
    expect(done.countersign.by).toBe('Nurse Two');
    const due = await inOak(() => health.dosesDue(N(), { date: ymdIn(0) }, { now: at }));
    expect(due.items.find((d) => d.planId === plan.id)).toMatchObject({ status: 'GIVEN', awaitingCountersign: false });
  });
});

describe('care notes for the class teacher', () => {
  it('shows the class teacher only shared, active notes for their own class; withdrawing consent hides it', async () => {
    const note = await inOak(() => health.createCareNote(N(), { studentId: rahulId(), text: 'Severe nut allergy: EpiPen in the health room', severity: 'SEVERE' }));
    expect(note.shared).toBe(false);
    // Not shared yet: nothing for the class teacher.
    expect((await inOak(() => health.classCareNotes(s.people.TEACHER.actor))).items).toHaveLength(0);
    await inOak(() => health.setCareNoteConsent(s.people.PARENT.actor, note.id, { share: true }));
    const forTeacher = await inOak(() => health.classCareNotes(s.people.TEACHER.actor));
    expect(forTeacher.items).toEqual([expect.objectContaining({ studentName: 'Rahul Sharma', text: 'Severe nut allergy: EpiPen in the health room', severity: 'SEVERE' })]);
    // Only the note: no visits, plans or record fields.
    expect(Object.keys(forTeacher.items[0]).sort()).toEqual(['className', 'id', 'severity', 'studentId', 'studentName', 'text']);
    // A subject teacher of the same class (T2 teaches Maths in 6 A) and the 6 B class teacher see nothing.
    expect((await inOak(() => health.classCareNotes(s.people.T2.actor))).items).toHaveLength(0);
    expect((await inOak(() => health.classCareNotes(s.people.T3.actor))).items).toHaveLength(0);
    // Another parent cannot change the consent.
    await expect(inOak(() => health.setCareNoteConsent(s.people.PARENT2.actor, note.id, { share: false }))).rejects.toMatchObject({ statusCode: 404 });
    await inOak(() => health.setCareNoteConsent(s.people.PARENT.actor, note.id, { share: false }));
    expect((await inOak(() => health.classCareNotes(s.people.TEACHER.actor))).items).toHaveLength(0);
    expect(await inOak(() => AuditLog.countDocuments({ action: 'health.carenotes.read' }))).toBeGreaterThanOrEqual(3);
    const raw = await inOak(() => CareNote.findById(note.id).lean());
    expect(JSON.stringify(raw)).not.toMatch(/nut allergy/);
  });

  it('a parent may write and share a note themselves; a teacher without the key is refused', async () => {
    await inOak(() => health.createCareNote(s.people.PARENT.actor, { studentId: rahulId(), text: 'Asthma: inhaler in his bag', share: true }));
    expect((await inOak(() => health.classCareNotes(s.people.TEACHER.actor))).items).toHaveLength(1);
    const noKey = { ...s.people.TEACHER.actor, permissions: { ...s.people.TEACHER.actor.permissions } };
    delete noKey.permissions['health.carenotes.read'];
    await expect(inOak(() => health.classCareNotes(noKey))).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('stock, immunisations, screenings and the health card', () => {
  it('turns a stock expiry into a task for the nurse and resolves it when the item is removed', async () => {
    const item = await inOak(() => health.addStock(N(), { name: 'Adrenaline auto-injector', kind: 'MEDICINE', quantity: 2, expiresOn: ymdIn(20), controlled: true }));
    expect(item.expiringSoon).toBe(true);
    const task = await inOak(() => DueItem.findOne({ sourceKey: `health:stock:${item.id}:expiry` }).lean());
    expect(task).toMatchObject({ department: 'HEALTH', status: 'OPEN' });
    expect(String(task.ownerProfileId)).toMatch(/^[a-f0-9]{24}$/);
    await inOak(() => health.updateStock(N(), item.id, { active: false, note: 'Replaced' }));
    expect((await inOak(() => DueItem.findOne({ sourceKey: `health:stock:${item.id}:expiry` }).lean())).status).toBe('DONE');
  });

  it('builds the annual health card from screenings and immunisations, encrypted at rest', async () => {
    await inOak(() => health.addEntry(N(), { studentId: rahulId(), kind: 'SCREENING', heightCm: 140, weightKg: 35, visionLeft: '6/6', visionRight: '6/9', dental: 'No caries' }));
    await inOak(() => health.addEntry(N(), { studentId: rahulId(), kind: 'IMMUNISATION', vaccine: 'Td booster', doseNo: '1', on: ymdIn(-30) }));
    const card = await inOak(() => health.healthCard(s.people.PARENT.actor, rahulId()));
    expect(card.latestScreening).toMatchObject({ heightCm: 140, weightKg: 35, bmi: 17.9, visionRight: '6/9' });
    expect(card.immunisations[0]).toMatchObject({ vaccine: 'Td booster' });
    const raw = await inOak(() => HealthEntry.find({ studentId: s.rahul.student._id }).lean());
    expect(JSON.stringify(raw)).not.toMatch(/Td booster|6\/9|caries/);
    await expect(inOak(() => health.healthCard(s.people.PARENT2.actor, rahulId()))).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('the principal\'s counts', () => {
  it('are counts only: no names, no clinical words', async () => {
    await visit({ outcome: 'SENT_HOME' });
    await inOak(() => health.recordVisit(N(), { studentId: amanId(), complaint: 'Grazed knee', outcome: 'FIRST_AID', injury: true }));
    const out = await inOak(() => health.summary(s.people.PRINCIPAL.actor, {}));
    expect(out.visits.today).toBe(2);
    expect(out.visits.byOutcome).toMatchObject({ SENT_HOME: 1, FIRST_AID: 1 });
    expect(out.visits.injuries).toBe(1);
    expect(JSON.stringify(out)).not.toMatch(/Rahul|Aman|Headache|Grazed|studentId/);
    // A teacher has no counts either.
    await expect(inOak(() => health.summary(s.people.TEACHER.actor, {}))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('a parent reads the family page for their own children only', async () => {
    await visit();
    const fam = await inOak(() => health.family(s.people.PARENT.actor));
    expect(fam.children.map((c) => c.name).sort()).toEqual(['Rahul Sharma', 'Riya Kapoor']);
    const other = await inOak(() => health.family(s.people.PARENT2.actor));
    expect(JSON.stringify(other)).not.toMatch(/Headache/);
    await expect(inOak(() => health.family(N()))).rejects.toMatchObject({ code: 'PARENT_ONLY' });
  });
});

describe('a permission-only actor', () => {
  it('without health keys cannot reach the nurse desk', async () => {
    const admin = actorForRole('ADMIN', { profileId: String(new mongoose.Types.ObjectId()) });
    await expect(inOak(() => health.today(admin))).rejects.toMatchObject({ code: 'HEALTH_RESTRICTED' });
    await expect(inOak(() => health.listStock(admin))).rejects.toMatchObject({ code: 'HEALTH_RESTRICTED' });
    expect(await inOak(() => MedicationDose.countDocuments({}))).toBe(0);
  });
});
