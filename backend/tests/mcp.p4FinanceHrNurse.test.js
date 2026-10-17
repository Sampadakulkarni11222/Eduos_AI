import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { MCP_TOOLS, mcpToolsFor, confirmableOn, validateMcpRegistry, requiresConfirmation } from '../src/modules/ai/mcp/registry.js';
import { p4FinanceHrNurseTools } from '../src/modules/ai/mcp/tools/p4FinanceHrNurse.js';
import { isDecidingToolName } from '../src/modules/ai/mcp/decisions.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { Payment } from '../src/models/fee.model.js';
import { CashClose, Vacancy, Candidate } from '../src/models/p4People.model.js';
import { HealthEntry } from '../src/models/health.model.js';
import { MessageOutbox } from '../src/models/messaging.model.js';
import * as health from '../src/modules/health/health.service.js';
import { inSchool, mcp, seedSchool, seedPerson, actorForRole, proposeAndConfirm, OAK } from './support/mcpSchool.js';

/**
 * Part 4 assistant tools for the bursar, HR and the nurse (tools/p4FinanceHrNurse.js):
 * role-scoped discovery, closed schemas, every write a confirmed draft, money and
 * other people's records confirmed on the website only, health the nurse's alone.
 */
const NAMES = Object.keys(p4FinanceHrNurseTools);
const WRITES = NAMES.filter((n) => MCP_TOOLS[n]?.operation !== 'GET');
let s;
const inOak = (fn) => inSchool(OAK, fn);

beforeEach(async () => {
  s = await seedSchool();
  s.people.HR = await seedPerson({ roleKey: 'HR', roleId: s.roleIds.HR, displayName: 'HR officer' });
  s.people.NURSE = await seedPerson({ roleKey: 'NURSE', roleId: s.roleIds.NURSE, displayName: 'Nurse Joy' });
});
afterAll(async () => { await resetMcpClient(); });

describe('the contract', () => {
  it('registers every tool closed, never deciding, every write confirmed; the boot check passes', () => {
    expect(NAMES).toHaveLength(29);
    for (const n of NAMES) {
      expect(MCP_TOOLS[n], n).toBeTruthy();
      expect(MCP_TOOLS[n].inputSchema.additionalProperties, n).toBe(false);
      expect(isDecidingToolName(n), n).toBe(false);
    }
    for (const n of WRITES) expect(requiresConfirmation(MCP_TOOLS[n], {}), n).toBe(true);
    expect(validateMcpRegistry()).toEqual([]);
    for (const n of ['close_cash_day', 'send_fee_reminders', 'update_payroll_inputs', 'start_staff_exit']) expect(confirmableOn(MCP_TOOLS[n], 'WHATSAPP'), n).toBe(false);
    expect(confirmableOn(MCP_TOOLS.add_health_entry, 'WHATSAPP')).toBe(true);
  });

  it('shows each role only its own tools', () => {
    const visible = (role) => new Set(mcpToolsFor(actorForRole(role)).map((t) => t.name).filter((n) => NAMES.includes(n)));
    const fin = visible('FINANCE'); const hr = visible('HR'); const nurse = visible('NURSE');
    for (const n of ['get_fee_collections', 'get_fee_ageing', 'get_fee_receipt_flags', 'get_cash_position', 'close_cash_day', 'send_fee_reminders', 'get_payroll_run', 'update_payroll_inputs', 'calculate_payroll_run']) expect(fin.has(n), `FINANCE ${n}`).toBe(true);
    for (const n of ['list_recruitment_vacancies', 'open_vacancy', 'add_candidate', 'move_candidate', 'add_candidate_scorecard', 'draft_offer_letter', 'start_staff_exit', 'estimate_full_and_final', 'get_staff_leave_balances', 'get_staff_leave_lop', 'list_verification_cases', 'update_payroll_inputs']) expect(hr.has(n), `HR ${n}`).toBe(true);
    for (const n of ['get_health_watchlist', 'list_health_visits', 'close_health_visit', 'list_health_stock', 'update_health_stock', 'add_health_entry']) expect(nurse.has(n), `NURSE ${n}`).toBe(true);
    expect([...fin].some((n) => /health|vacanc|candidate|exit/.test(n))).toBe(false);
    expect([...hr].some((n) => /health|cash|fee_/.test(n))).toBe(false);
    expect([...nurse].some((n) => !/health/.test(n))).toBe(false);
    for (const role of ['ADMIN', 'PRINCIPAL', 'TEACHER', 'PARENT', 'STUDENT']) {
      expect([...visible(role)].filter((n) => /health/.test(n)), role).toEqual([]);
    }
    expect(visible('PARENT').size).toBe(0);
  });
});

describe('through the real MCP server', () => {
  it('reads collections and closes the cash only after confirmation', async () => {
    await inOak(() => Payment.create({ invoiceId: s.inv1._id, amountPaise: 150000, mode: 'CASH', status: 'SUCCESS', recordStatus: 'PUBLISHED', paidOn: new Date(), createdByProfileId: s.people.FINANCE.profile._id }));
    const F = s.people.FINANCE.actor;
    const rep = await mcp(OAK, F, 'get_fee_collections', {});
    expect(rep.success, JSON.stringify(rep.error)).toBe(true);
    expect(rep.data.totals.collectedPaise).toBe(150000);
    const short = await mcp(OAK, F, 'close_cash_day', { counts: [{ note: 500, count: 2 }] });
    expect(short.success).toBe(false);
    expect(JSON.stringify(short.error)).toMatch(/short by/);
    const onPhone = await mcp(OAK, F, 'close_cash_day', { counts: [{ note: 500, count: 3 }] }, { channel: 'WHATSAPP' });
    expect(onPhone.success).toBe(false);
    const { proposal, done } = await proposeAndConfirm(OAK, F, 'close_cash_day', { counts: [{ note: 500, count: 3 }] });
    expect(proposal.action.summary).toMatch(/balanced/);
    expect(done.success, JSON.stringify(done.error)).toBe(true);
    expect(await inOak(() => CashClose.countDocuments())).toBe(1);
  });

  it('sends fee reminders only after the draft names who receives them', async () => {
    const F = s.people.FINANCE.actor;
    const proposal = await mcp(OAK, F, 'send_fee_reminders', {});
    expect(proposal.action.status).toBe('confirmation_required');
    expect(proposal.action.summary).toMatch(/1 overdue student.*Rahul Sharma/);
    expect(await inOak(() => MessageOutbox.countDocuments({ templateKey: 'FEE_REMINDER' }))).toBe(0);
    const done = await mcp(OAK, F, 'send_fee_reminders', {}, { confirmationToken: proposal.action.confirmationToken });
    expect(done.success, JSON.stringify(done.error)).toBe(true);
    expect(await inOak(() => MessageOutbox.countDocuments({ templateKey: 'FEE_REMINDER' }))).toBeGreaterThan(0);
  });

  it('HR opens a vacancy, adds and moves a candidate; finance is refused', async () => {
    const H = s.people.HR.actor;
    const v = await proposeAndConfirm(OAK, H, 'open_vacancy', { title: 'PRT English', department: 'Primary' });
    expect(v.done.success, JSON.stringify(v.done?.error)).toBe(true);
    const c = await proposeAndConfirm(OAK, H, 'add_candidate', { name: 'Meera Iyer', experienceYears: 3 });
    expect(c.proposal.action.summary).toMatch(/Meera Iyer.*PRT English/);
    expect(c.done.success, JSON.stringify(c.done?.error)).toBe(true);
    const bad = await mcp(OAK, H, 'move_candidate', { candidateName: 'Meera', stage: 'OFFERED' });
    expect(bad.success).toBe(false);
    const m = await proposeAndConfirm(OAK, H, 'move_candidate', { candidateName: 'Meera', stage: 'SCREENED' });
    expect(m.done.success, JSON.stringify(m.done?.error)).toBe(true);
    expect((await inOak(() => Candidate.findOne().lean())).stage).toBe('SCREENED');
    const refused = await mcp(OAK, s.people.FINANCE.actor, 'list_recruitment_vacancies', {});
    expect(refused.success).toBe(false);
    expect(await inOak(() => Vacancy.countDocuments())).toBe(1);
  });

  it('the nurse reads the watch list and adds an immunisation once confirmed; others are refused', async () => {
    const N = s.people.NURSE.actor;
    await inOak(() => health.recordVisit(N, { studentId: String(s.rahul.student._id), complaint: 'Cough and cold', outcome: 'REST' }));
    const w = await mcp(OAK, N, 'get_health_watchlist', {});
    expect(w.success, JSON.stringify(w.error)).toBe(true);
    expect(w.data.screening.totalStudents).toBe(4);
    const e = await proposeAndConfirm(OAK, N, 'add_health_entry', { studentName: 'Rahul Sharma', kind: 'IMMUNISATION', vaccine: 'Td', doseNo: 'booster', nextDueOn: '2036-10-01' });
    expect(e.proposal.action.summary).toMatch(/Rahul Sharma's card: Td dose booster/);
    expect(e.done.success, JSON.stringify(e.done?.error)).toBe(true);
    expect(await inOak(() => HealthEntry.countDocuments())).toBe(1);
    for (const who of ['ADMIN', 'PRINCIPAL', 'HR', 'FINANCE']) {
      // eslint-disable-next-line no-await-in-loop
      const r = await mcp(OAK, s.people[who].actor, 'get_health_watchlist', {});
      expect(r.success, who).toBe(false);
    }
  });
});
