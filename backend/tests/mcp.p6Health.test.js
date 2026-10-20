import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { MCP_TOOLS, mcpToolsFor, confirmableOn, validateMcpRegistry } from '../src/modules/ai/mcp/registry.js';
import { tools as healthP6Tools } from '../src/modules/ai/mcp/tools/p6/health.js';
import { isDecidingToolName } from '../src/modules/ai/mcp/decisions.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { MedicationPlan, CareNote, HealthStock, HealthSettings } from '../src/models/health.model.js';
import { encrypt } from '../src/utils/crypto.js';
import * as health from '../src/modules/health/health.service.js';
import { inSchool, mcp, seedPerson, actorForRole, OAK } from './support/mcpSchool.js';
import { seedFamilySchool, ymdIn } from './support/familySchool.js';

/**
 * Part-6 health tools (tools/p6/health.js): restricted exactly as the Health
 * page is. The nurse, a parent for their own child, the class teacher for the
 * care notes parents agreed to share; nobody else. A parent's consent is
 * approver-confirmed and website-only.
 */
const NAMES = Object.keys(healthP6Tools);
const DECISIONS = ['record_medication_consent_decision', 'record_care_note_sharing_decision'];
let s;
const inOak = (fn) => inSchool(OAK, fn);

async function confirm(actor, name, args, { unchanged } = {}) {
  const proposal = await mcp(OAK, actor, name, args);
  expect(proposal.success, `${name}: ${JSON.stringify(proposal.error)}`).toBe(true);
  expect(proposal.action.status).toBe('confirmation_required');
  if (unchanged) expect(await unchanged()).toBe(true);
  const done = await mcp(OAK, actor, name, {}, { confirmationToken: proposal.action.confirmationToken });
  expect(done.success, `${name}: ${JSON.stringify(done.error)}`).toBe(true);
  return { proposal, done };
}

beforeEach(async () => {
  s = await seedFamilySchool();
  s.people.NURSE = await seedPerson({ roleKey: 'NURSE', roleId: s.roleIds.NURSE, displayName: 'Nurse Joy' });
  s.people.NURSE2 = await seedPerson({ roleKey: 'NURSE', roleId: s.roleIds.NURSE, displayName: 'Nurse Asha' });
});
afterAll(async () => { await resetMcpClient(); });

describe('the contract', () => {
  it('registers closed, non-deciding tools behind the health-room switch; writes confirm; consent is HIGH, stated and web-only', () => {
    expect(NAMES.length).toBe(15);
    for (const n of NAMES) {
      const t = MCP_TOOLS[n];
      expect(t, n).toBeTruthy();
      expect(t.feature, n).toBe('healthRoom');
      expect(t.inputSchema.additionalProperties, n).toBe(false);
      expect(isDecidingToolName(n), n).toBe(false);
      expect(t.permission, n).toMatch(/^health\./);
      if (t.operation === 'GET') expect(n, n).toMatch(/^(get|list|search)_/);
      else {
        expect(t.confirm, n).toBe(true);
        expect(typeof t.summarise, n).toBe('function');
      }
      expect(Boolean(t.approverDecision), n).toBe(DECISIONS.includes(n));
    }
    for (const n of DECISIONS) {
      expect(MCP_TOOLS[n].risk).toBe('HIGH');
      expect(MCP_TOOLS[n].inputSchema.required).toContain('decision');
      expect(confirmableOn(MCP_TOOLS[n], 'WHATSAPP')).toBe(false);
    }
    expect(validateMcpRegistry()).toEqual([]);
  });

  it('shows the nurse, a parent and the class teacher only their part; nobody else sees any', () => {
    const visible = (role) => mcpToolsFor(actorForRole(role)).map((t) => t.name).filter((n) => NAMES.includes(n)).sort();
    // The class teacher's shared care notes stay on the Health page (roleCoverage ledger).
    expect(visible('TEACHER')).toEqual([]);
    expect(visible('PARENT')).toEqual(['add_care_note', 'get_child_health_card', 'get_family_health', 'list_care_notes', 'list_child_health_entries', 'list_child_health_visits', 'list_medication_plans', 'record_care_note_sharing_decision', 'record_medication_consent_decision', 'retire_care_note', 'cancel_medication_plan'].sort());
    const nurse = visible('NURSE');
    expect(nurse).toEqual(expect.arrayContaining(['get_health_room_settings', 'update_health_room_settings', 'add_health_stock', 'create_medication_plan', 'list_medication_plans', 'add_care_note']));
    for (const n of ['get_family_health', 'record_medication_consent_decision', 'record_care_note_sharing_decision']) expect(nurse, n).not.toContain(n);
    for (const role of ['ADMIN', 'PRINCIPAL', 'STUDENT', 'FINANCE', 'HR', 'COMPLIANCE', 'TRUSTEE', 'WARDEN']) expect(visible(role), role).toEqual([]);
  });
});

describe('through the real MCP server', () => {
  it('the nurse drafts a plan for consent; the parent reads it, cannot consent without the prescription, consents once it is there, or declines', async () => {
    const nurse = s.people.NURSE.actor;
    const parent = s.people.PARENT.actor;
    await confirm(nurse, 'create_medication_plan', { studentName: 'Rahul Sharma', medicine: 'Salbutamol', form: 'inhaler', dose: '2 puffs', times: ['11:00'], startOn: ymdIn(0), endOn: ymdIn(10) }, { unchanged: async () => (await inOak(() => MedicationPlan.countDocuments())) === 0 });
    const plan = await inOak(() => MedicationPlan.findOne().lean());
    expect(plan.status).toBe('AWAITING_CONSENT');

    const seen = await mcp(OAK, parent, 'list_medication_plans', { childName: 'Rahul' });
    expect(seen.success, JSON.stringify(seen.error)).toBe(true);
    expect(seen.data.items[0]).toMatchObject({ medicine: 'Salbutamol', status: 'AWAITING_CONSENT', hasPrescription: false });
    const other = await mcp(OAK, s.people.PARENT2.actor, 'list_medication_plans', { childName: 'Rahul' });
    expect(other.success).toBe(false);

    const noRx = await mcp(OAK, parent, 'record_medication_consent_decision', { childName: 'Rahul', medicine: 'Salbutamol', decision: 'GIVE_CONSENT' });
    expect(noRx.success).toBe(false);
    const phone = await mcp(OAK, parent, 'record_medication_consent_decision', { childName: 'Rahul', medicine: 'Salbutamol', decision: 'DECLINE', reason: 'We will give it at home' }, { channel: 'WHATSAPP' });
    expect(phone.success).toBe(false);
    expect(phone.error.details?.reason).toBe('CONFIRM_ON_WEB');

    await inOak(() => MedicationPlan.updateOne({ _id: plan._id }, { $set: { prescriptionEnc: encrypt({ name: 'rx.pdf', url: '/uploads/rx.pdf' }) } }));
    const { proposal } = await confirm(parent, 'record_medication_consent_decision', { childName: 'Rahul', medicine: 'Salbutamol', decision: 'GIVE_CONSENT' });
    expect(proposal.action.summary).toMatch(/consent.*Rahul Sharma.*Salbutamol/);
    expect((await inOak(() => MedicationPlan.findById(plan._id).lean())).status).toBe('ACTIVE');

    await confirm(parent, 'cancel_medication_plan', { childName: 'Rahul', medicine: 'Salbutamol', reason: 'Doctor stopped it' });
    const stopped = await inOak(() => MedicationPlan.findById(plan._id).lean());
    expect(stopped).toMatchObject({ status: 'STOPPED', stoppedReason: 'Doctor stopped it' });
  });

  it('a parent shares a care note with the class teacher and withdraws it', async () => {
    const parent = s.people.PARENT.actor;
    await confirm(parent, 'add_care_note', { childName: 'Rahul', text: 'Peanut allergy: EpiPen in the front pocket', severity: 'SEVERE', share: true });
    await confirm(parent, 'record_care_note_sharing_decision', { childName: 'Rahul', note: 'Peanut', decision: 'STOP_SHARING' });
    const mine = await mcp(OAK, parent, 'list_care_notes', { childName: 'Rahul' });
    expect(mine.data.items[0]).toMatchObject({ sharedWithClassTeacher: false });
    await confirm(parent, 'retire_care_note', { childName: 'Rahul', note: 'Peanut' });
    expect(await inOak(() => CareNote.countDocuments({ active: true }))).toBe(0);
  });

  it('the nurse changes settings and adds stock', async () => {
    const nurse = s.people.NURSE.actor;
    await confirm(nurse, 'update_health_room_settings', { expiryLeadDays: 14 });
    expect((await inOak(() => HealthSettings.findOne({ key: 'default' }).lean())).expiryLeadDays).toBe(14);
    const got = await mcp(OAK, nurse, 'get_health_room_settings', {});
    expect(got.data.expiryLeadDays).toBe(14);

    await confirm(nurse, 'add_health_stock', { name: 'Crepe bandage', kind: 'FIRST_AID', quantity: 12, unit: 'rolls', reorderLevel: 4, expiresOn: ymdIn(200) });
    expect(await inOak(() => HealthStock.countDocuments({ name: 'Crepe bandage' }))).toBe(1);

  });

  it('a parent reads their own child\'s visits, entries, card and family page; other roles are refused', async () => {
    const nurse = s.people.NURSE.actor;
    await inOak(() => health.recordVisit(nurse, { studentId: String(s.rahul.student._id), complaint: 'Headache', outcome: 'REST' }));
    await inOak(() => health.addEntry(nurse, { studentId: String(s.rahul.student._id), kind: 'SCREENING', heightCm: 140, weightKg: 35 }));
    const parent = s.people.PARENT.actor;
    const visits = await mcp(OAK, parent, 'list_child_health_visits', { childName: 'Rahul' });
    expect(visits.success, JSON.stringify(visits.error)).toBe(true);
    expect(visits.data.items[0]).toMatchObject({ complaint: 'Headache' });
    const entries = await mcp(OAK, parent, 'list_child_health_entries', { childName: 'Rahul' });
    expect(entries.data.items[0]).toMatchObject({ kind: 'SCREENING', heightCm: 140 });
    const card = await mcp(OAK, parent, 'get_child_health_card', { childName: 'Rahul' });
    expect(card.success, JSON.stringify(card.error)).toBe(true);
    expect(card.data.visitsThisYear).toBe(1);
    const fam = await mcp(OAK, parent, 'get_family_health', { childName: 'Rahul' });
    expect(fam.data.children[0].visits[0]).toMatchObject({ complaint: 'Headache' });
    const nurseCard = await mcp(OAK, nurse, 'get_child_health_card', { childName: 'Rahul Sharma' });
    expect(nurseCard.success).toBe(true);

    for (const role of ['ADMIN', 'PRINCIPAL', 'TEACHER', 'STUDENT']) {
      const r = await mcp(OAK, s.people[role].actor, 'list_medication_plans', {});
      expect(r.success, role).toBe(false);
      const w = await mcp(OAK, s.people[role].actor, 'add_health_stock', { name: 'x', quantity: 1 });
      expect(w.success, role).toBe(false);
    }
    const stranger = await mcp(OAK, s.people.PARENT3.actor, 'get_child_health_card', { childName: 'Rahul' });
    expect(stranger.success).toBe(false);
  });
});
