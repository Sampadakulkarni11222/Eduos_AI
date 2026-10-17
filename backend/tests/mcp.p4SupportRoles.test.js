import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { MCP_TOOLS, mcpToolsFor, confirmableOn, validateMcpRegistry } from '../src/modules/ai/mcp/registry.js';
import { p4LibrarianTools } from '../src/modules/ai/mcp/tools/p4Librarian.js';
import { p4WardenTools } from '../src/modules/ai/mcp/tools/p4Warden.js';
import { p4MarketingTools } from '../src/modules/ai/mcp/tools/p4Marketing.js';
import { p4ComplianceTools } from '../src/modules/ai/mcp/tools/p4Compliance.js';
import { isDecidingToolName } from '../src/modules/ai/mcp/decisions.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { Book, BookIssue } from '../src/models/library.model.js';
import { BookHold, HostelRollCall, HostelIncident, PrivacyRequest, DataBreach } from '../src/models/supportRoles.model.js';
import { HostelRoom, HostelAllocation } from '../src/models/hostel.model.js';
import { Lead, LeadInteraction } from '../src/models/lead.model.js';
import * as library from '../src/modules/library/library.service.js';
import { inSchool, mcp, seedSchool, seedPerson, actorForRole, OAK } from './support/mcpSchool.js';

/**
 * Part 4 support-role tools: librarian, warden, admissions/marketing and
 * compliance. Shown only to the roles whose screens they mirror, never
 * deciding, closed schemas, every write a confirmed draft, writes that reach
 * other people web-only, and the service refusals reach the user.
 */
const SETS = { LIBRARIAN: p4LibrarianTools, WARDEN: p4WardenTools, MARKETING: p4MarketingTools, COMPLIANCE: p4ComplianceTools };
const ALL = Object.values(SETS).flatMap((t) => Object.keys(t));
let s;
const inOak = (fn) => inSchool(OAK, fn);
const DAY = 86_400_000;

beforeEach(async () => {
  s = await seedSchool();
  s.people.MARKETING = await seedPerson({ roleKey: 'MARKETING', roleId: s.roleIds.MARKETING, displayName: 'Admissions head' });
  s.people.COMPLIANCE = await seedPerson({ roleKey: 'COMPLIANCE', roleId: s.roleIds.COMPLIANCE, displayName: 'Compliance officer' });
});
afterAll(async () => { await resetMcpClient(); });

async function confirm(actor, name, args, opts = {}) {
  const proposal = await mcp(OAK, actor, name, args, opts);
  expect(proposal.success, JSON.stringify(proposal.error)).toBe(true);
  expect(proposal.action.status).toBe('confirmation_required');
  const done = await mcp(OAK, actor, name, {}, { ...opts, confirmationToken: proposal.action.confirmationToken });
  expect(done.success, JSON.stringify(done.error)).toBe(true);
  return { proposal, done };
}

describe('the contract', () => {
  it('registered, closed, never deciding, writes summarised and confirmed; the boot check passes', () => {
    expect(ALL.length).toBe(44);
    for (const n of ALL) {
      const t = MCP_TOOLS[n];
      expect(t, n).toBeTruthy();
      expect(t.inputSchema.additionalProperties, n).toBe(false);
      expect(isDecidingToolName(n), n).toBe(false);
      if (t.operation !== 'GET') { expect(t.confirm, n).toBe(true); expect(typeof t.summarise, n).toBe('function'); }
    }
    expect(validateMcpRegistry()).toEqual([]);
    for (const n of ['send_library_overdue_reminders', 'submit_hostel_roll_call', 'log_data_breach', 'update_data_breach', 'schedule_compliance_training']) {
      expect(confirmableOn(MCP_TOOLS[n], 'WHATSAPP'), n).toBe(false);
    }
    expect(confirmableOn(MCP_TOOLS.renew_library_loan, 'WHATSAPP')).toBe(true);
  });

  it('each set is shown to its role, and not to students, parents or teachers', () => {
    const visible = (role) => new Set(mcpToolsFor(actorForRole(role)).map((t) => t.name));
    for (const [role, set] of Object.entries(SETS)) {
      const v = visible(role);
      for (const n of Object.keys(set)) expect(v.has(n), `${role} ${n}`).toBe(true);
    }
    for (const role of ['STUDENT', 'PARENT', 'TEACHER']) {
      const v = visible(role);
      expect(ALL.filter((n) => v.has(n)), role).toEqual([]);
    }
    // The librarian sees no hostel, admissions or compliance registers; the warden no library desk.
    const lib = visible('LIBRARIAN');
    expect([...Object.keys(p4WardenTools), ...Object.keys(p4MarketingTools), ...Object.keys(p4ComplianceTools)].filter((n) => lib.has(n))).toEqual([]);
    const war = visible('WARDEN');
    expect(Object.keys(p4LibrarianTools).filter((n) => war.has(n))).toEqual([]);
    // The registers need compliance.manage: HR (compliance.read) sees the checklist, not the requests.
    const hr = visible('HR');
    expect(hr.has('get_compliance_readiness')).toBe(true);
    expect(hr.has('list_data_requests')).toBe(false);
  });
});

describe('librarian through the real MCP server', () => {
  it('renews a loan and reserves a book only after confirmation; refusals come back', async () => {
    const L = s.people.LIBRARIAN.actor;
    const b = await inOak(() => Book.create({ title: 'Wings of Fire', author: 'A P J Abdul Kalam', totalCopies: 1, availableCopies: 1 }));
    const loan = await inOak(() => library.issueBook({ bookId: String(b._id), studentId: String(s.rahul.student._id), dueAt: new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10) }));
    const { proposal } = await confirm(L, 'renew_library_loan', { bookTitle: 'Wings of Fire', studentName: 'Rahul Sharma' });
    expect(proposal.action.summary).toMatch(/Renew "Wings of Fire" for Rahul Sharma by 7 days/);
    expect((await inOak(() => BookIssue.findById(loan.id).lean())).renewCount).toBe(1);

    const r = await mcp(OAK, L, 'reserve_library_book', { bookTitle: 'Wings of Fire', admissionNo: 'OAK-3' });
    expect(r.action.summary).toMatch(/Reserve "Wings of Fire" for Aman Gupta \(no copy free: joins the queue\)/);
    expect(await inOak(() => BookHold.countDocuments())).toBe(0);
    await mcp(OAK, L, 'reserve_library_book', {}, { confirmationToken: r.action.confirmationToken });
    expect(await inOak(() => BookHold.countDocuments({ status: 'QUEUED' }))).toBe(1);

    // Now someone is waiting and no other copy is free: the renewal is refused at the draft.
    const refused = await mcp(OAK, L, 'renew_library_loan', { bookTitle: 'Wings of Fire', studentName: 'Rahul Sharma' });
    expect(refused.success).toBe(false);
    const brief = await mcp(OAK, L, 'get_library_desk_briefing', {});
    expect(brief.success).toBe(true);
    expect(brief.data.evidence.holdsQueued).toBe(1);
  });

  it('a teacher cannot call the library desk tools', async () => {
    const t = await mcp(OAK, s.people.TEACHER.actor, 'list_overdue_loans', {});
    expect(t.success).toBe(false);
  });
});

describe('warden through the real MCP server', () => {
  it('opens, marks and submits a roll call; logs an incident', async () => {
    const W = s.people.WARDEN.actor;
    await inOak(async () => {
      const room = await HostelRoom.create({ roomNo: '12', block: 'A', capacity: 4 });
      for (const st of [s.rahul, s.aman]) await HostelAllocation.create({ roomId: room._id, studentId: st.student._id });
    });
    await confirm(W, 'start_hostel_roll_call', {});
    await confirm(W, 'mark_hostel_roll_call', { marks: [{ name: 'Rahul Sharma', status: 'PRESENT' }], allPresent: false });
    const sub = await mcp(OAK, W, 'submit_hostel_roll_call', {});
    expect(sub.action.summary).toMatch(/1 not accounted for \(Aman Gupta\)/);
    const phone = await mcp(OAK, W, 'submit_hostel_roll_call', {}, { channel: 'WHATSAPP' });
    expect(phone.success).toBe(false);
    await mcp(OAK, W, 'submit_hostel_roll_call', {}, { confirmationToken: sub.action.confirmationToken });
    expect((await inOak(() => HostelRollCall.findOne().lean())).submittedAt).toBeTruthy();

    await confirm(W, 'log_hostel_incident', { students: ['Aman Gupta'], category: 'LATE_RETURN', description: 'Missed night roll call; found in the common room at 22:10.' });
    await confirm(W, 'log_parent_contact', { summary: 'Called mother; informed.' });
    expect((await inOak(() => HostelIncident.findOne().lean())).parentContacts).toHaveLength(1);
  });

  it('refuses a name that is not a resident', async () => {
    const r = await mcp(OAK, s.people.WARDEN.actor, 'log_hostel_incident', { students: ['Nobody Here'], description: 'x' });
    expect(r.success).toBe(false);
  });
});

describe('admissions through the real MCP server', () => {
  it('reads the queue and logs a follow-up after confirmation; refuses an opted-out family', async () => {
    const M = s.people.MARKETING.actor;
    await inOak(async () => {
      await Lead.create({ childName: 'Kabir Mehta', guardianName: 'Mr Mehta', phone: '+919800000001', stage: 'NEW', createdAt: new Date(Date.now() - 3 * DAY) });
      await Lead.create({ childName: 'Vihaan Rao', guardianName: 'Mr Rao', phone: '+919800000003', stage: 'CONTACTED', contactConsent: { given: true, withdrawnAt: new Date() } });
    });
    const q = await mcp(OAK, M, 'get_followup_queue', {});
    expect(q.success).toBe(true);
    expect(q.data.counts.untouched).toBe(1);
    const { proposal } = await confirm(M, 'log_admission_followup', { childName: 'Kabir', channel: 'CALL', outcome: 'Wants a campus tour', nextActionOn: '2026-12-01' });
    expect(proposal.action.summary).toMatch(/Log a call with Mr Mehta about Kabir Mehta/);
    expect(await inOak(() => LeadInteraction.countDocuments({ type: 'CALL' }))).toBe(1);
    const p = await mcp(OAK, M, 'log_admission_followup', { childName: 'Vihaan', channel: 'WHATSAPP', outcome: 'Brochure' });
    const final = p.action?.confirmationToken ? await mcp(OAK, M, 'log_admission_followup', {}, { confirmationToken: p.action.confirmationToken }) : p;
    expect(final.success).toBe(false);
  });
});

describe('compliance through the real MCP server', () => {
  it('logs a data request and a breach (web only) after confirmation; HR cannot reach the registers', async () => {
    const C = s.people.COMPLIANCE.actor;
    await confirm(C, 'log_data_request', { kind: 'ERASURE', requesterName: 'Ms Iyer', requesterRelation: 'PARENT', details: 'Remove photos from the newsletter archive' });
    expect(await inOak(() => PrivacyRequest.countDocuments())).toBe(1);
    const early = await mcp(OAK, C, 'update_data_request', { status: 'COMPLETED', outcome: 'Done' });
    const out = early.action?.confirmationToken ? await mcp(OAK, C, 'update_data_request', {}, { confirmationToken: early.action.confirmationToken }) : early;
    expect(out.success).toBe(false); // identity not verified
    const b = await mcp(OAK, C, 'log_data_breach', { title: 'Laptop with marks lost' }, { channel: 'WHATSAPP' });
    expect(b.success).toBe(false);
    await confirm(C, 'log_data_breach', { title: 'Laptop with marks lost', affectedCount: 40, childrenAffected: true });
    expect(await inOak(() => DataBreach.countDocuments())).toBe(1);
    const ready = await mcp(OAK, C, 'get_compliance_readiness', {});
    expect(ready.success).toBe(true);
    const hr = actorForRole('HR');
    expect((await mcp(OAK, hr, 'list_data_requests', {})).success).toBe(false);
  });
});
