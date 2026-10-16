import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { MCP_TOOLS, mcpToolsFor, confirmableOn, validateMcpRegistry } from '../src/modules/ai/mcp/registry.js';
import { healthTools } from '../src/modules/ai/mcp/tools/p3Health.js';
import { isDecidingToolName } from '../src/modules/ai/mcp/decisions.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { HealthVisit, MedicationDose } from '../src/models/health.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import * as health from '../src/modules/health/health.service.js';
import { inSchool, mcp, seedPerson, actorForRole, OAK } from './support/mcpSchool.js';
import { seedFamilySchool, ymdIn } from './support/familySchool.js';

/**
 * Health-room tools for the assistant (tools/p3Health.js): only the nurse and a
 * parent for their own child, read-mostly, every write confirmed, the dose web-only.
 */
const NAMES = Object.keys(healthTools);
let s;
const inOak = (fn) => inSchool(OAK, fn);

beforeEach(async () => {
  s = await seedFamilySchool();
  s.people.NURSE = await seedPerson({ roleKey: 'NURSE', roleId: s.roleIds.NURSE, displayName: 'Nurse Joy' });
});
afterAll(async () => { await resetMcpClient(); });

describe('the health tools keep the contract', () => {
  it('are four, registered, closed, never deciding, and the boot check passes', () => {
    expect(NAMES.sort()).toEqual(['get_child_medication_log', 'get_health_visits_today', 'log_health_visit', 'log_medicine_dose']);
    for (const n of NAMES) {
      expect(MCP_TOOLS[n], n).toBeTruthy();
      expect(MCP_TOOLS[n].inputSchema.additionalProperties, n).toBe(false);
      expect(isDecidingToolName(n), n).toBe(false);
    }
    expect(validateMcpRegistry()).toEqual([]);
    expect(MCP_TOOLS.log_health_visit.confirm).toBe(true);
    expect(MCP_TOOLS.log_medicine_dose.confirm).toBe(true);
    expect(confirmableOn(MCP_TOOLS.log_medicine_dose, 'WHATSAPP')).toBe(false);
  });

  it('are shown to the nurse (all four) and a parent (the log only); nobody else', () => {
    const visible = (role) => mcpToolsFor(actorForRole(role)).map((t) => t.name).filter((n) => NAMES.includes(n)).sort();
    expect(visible('NURSE')).toEqual([...NAMES].sort());
    expect(visible('PARENT')).toEqual(['get_child_medication_log']);
    for (const role of ['ADMIN', 'PRINCIPAL', 'TEACHER', 'STUDENT', 'WARDEN', 'FINANCE', 'HR', 'COMPLIANCE', 'TRUSTEE']) {
      expect(visible(role), role).toEqual([]);
    }
  });
});

describe('through the real MCP server', () => {
  it('the nurse records a visit only after confirming the draft, and reads today', async () => {
    const nurse = s.people.NURSE.actor;
    const proposal = await mcp(OAK, nurse, 'log_health_visit', { studentName: 'Rahul Sharma', complaint: 'Nosebleed in assembly', outcome: 'FIRST_AID' });
    expect(proposal.success, JSON.stringify(proposal.error)).toBe(true);
    expect(proposal.action.status).toBe('confirmation_required');
    expect(proposal.action.summary).toMatch(/Rahul Sharma.*Nosebleed in assembly.*first aid/);
    expect(await inOak(() => HealthVisit.countDocuments())).toBe(0);
    const done = await mcp(OAK, nurse, 'log_health_visit', {}, { confirmationToken: proposal.action.confirmationToken });
    expect(done.success, JSON.stringify(done.error)).toBe(true);
    expect(await inOak(() => HealthVisit.countDocuments())).toBe(1);
    const t = await mcp(OAK, nurse, 'get_health_visits_today', {});
    expect(t.success).toBe(true);
    expect(t.data.visits[0]).toMatchObject({ student: 'Rahul Sharma', complaint: 'Nosebleed in assembly' });
    expect(await inOak(() => AuditLog.countDocuments({ action: 'health.read' }))).toBeGreaterThan(0);
  });

  it('the dose is drafted on the website, refused on WhatsApp, and recorded once confirmed', async () => {
    const nurse = s.people.NURSE.actor;
    const plan = await inOak(() => health.createPlan(s.people.PARENT.actor, {
      studentId: String(s.rahul.student._id), medicine: { name: 'Cetirizine' }, dose: '5 ml', times: ['00:00'],
      startOn: ymdIn(0), endOn: ymdIn(3), consent: true, prescription: { name: 'rx.pdf', url: '/uploads/rx.pdf' },
    }));
    expect(plan.status).toBe('ACTIVE');
    const onPhone = await mcp(OAK, nurse, 'log_medicine_dose', { studentName: 'Rahul', time: '00:00', status: 'GIVEN' }, { channel: 'WHATSAPP' });
    expect(onPhone.success).toBe(false);
    const proposal = await mcp(OAK, nurse, 'log_medicine_dose', { studentName: 'Rahul', time: '00:00', status: 'GIVEN' });
    expect(proposal.success, JSON.stringify(proposal.error)).toBe(true);
    expect(proposal.action.summary).toMatch(/Rahul Sharma's 00:00 dose of Cetirizine \(5 ml\).*given/);
    const done = await mcp(OAK, nurse, 'log_medicine_dose', {}, { confirmationToken: proposal.action.confirmationToken });
    expect(done.success, JSON.stringify(done.error)).toBe(true);
    expect(await inOak(() => MedicationDose.countDocuments({ status: 'GIVEN' }))).toBe(1);

    // The parent reads their own child's log; another parent cannot reach Rahul.
    const log = await mcp(OAK, s.people.PARENT.actor, 'get_child_medication_log', { childName: 'Rahul' });
    expect(log.success, JSON.stringify(log.error)).toBe(true);
    expect(log.data.doses[0]).toMatchObject({ medicine: 'Cetirizine', status: 'GIVEN' });
    const other = await mcp(OAK, s.people.PARENT2.actor, 'get_child_medication_log', { childName: 'Rahul' });
    expect(other.success).toBe(false);
  });

  it('refuses the tools to roles without the health keys', async () => {
    for (const role of ['ADMIN', 'PRINCIPAL', 'TEACHER']) {
      const r = await mcp(OAK, s.people[role].actor, 'get_health_visits_today', {});
      expect(r.success, role).toBe(false);
      const w = await mcp(OAK, s.people[role].actor, 'log_health_visit', { studentName: 'Rahul', complaint: 'x', outcome: 'REST' });
      expect(w.success, role).toBe(false);
    }
  });
});
