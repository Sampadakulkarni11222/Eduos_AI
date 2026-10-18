import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { MCP_TOOLS, mcpToolsFor, confirmableOn, validateMcpRegistry } from '../src/modules/ai/mcp/registry.js';
import { tools as financeTools } from '../src/modules/ai/mcp/tools/p6/finance.js';
import { isDecidingToolName } from '../src/modules/ai/mcp/decisions.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import * as procurement from '../src/modules/finance-ops/procurement.service.js';
import { Vendor, PurchaseRequest, Budget, FundingProposal } from '../src/models/finance.model.js';
import { ServiceAccount } from '../src/models/bill.model.js';
import { ConcessionType } from '../src/models/feeAdjustment.model.js';
import { Scenario } from '../src/models/scenario.model.js';
import { inSchool, mcp, actorForRole, seedSchool, OAK } from './support/mcpSchool.js';

/**
 * Part-6 finance coverage tools (tools/p6/finance.js): the finance routes that
 * had no assistant tool. Every write is a draft that changes nothing until the
 * same person confirms it; money that binds the school is confirmed on the
 * website; the approver's due-diligence decision is recorded only as stated.
 */
const NAMES = Object.keys(financeTools);
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

async function read(actor, name, args = {}) {
  const res = await mcp(OAK, actor, name, args);
  expect(res.success, `${name}: ${JSON.stringify(res.error)}`).toBe(true);
  return res;
}

beforeEach(async () => { s = await seedSchool(); });
afterAll(async () => { await resetMcpClient(); });

describe('the contract', () => {
  it('registers closed, non-deciding tools; writes confirm and summarise; the decision is HIGH, web-only and stated', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(40);
    for (const n of NAMES) {
      const t = MCP_TOOLS[n];
      expect(t, n).toBeTruthy();
      expect(t.inputSchema.additionalProperties, n).toBe(false);
      expect(isDecidingToolName(n), n).toBe(false);
      if (t.operation !== 'GET') {
        expect(t.confirm, n).toBe(true);
        expect(typeof t.summarise, n).toBe('function');
      } else {
        expect(n, n).toMatch(/^(get|list|search)_/);
      }
      if (t.approverDecision) {
        expect(t.risk, n).toBe('HIGH');
        expect(t.affectsOthers, n).toBe(true);
        expect(t.inputSchema.required, n).toContain('decision');
        expect(t.inputSchema.properties.decision.default, n).toBeUndefined();
      }
    }
    expect(validateMcpRegistry()).toEqual([]);
    for (const n of ['create_vendor', 'set_purchase_quotes', 'move_purchase_request', 'submit_budget', 'create_funding_proposal', 'create_concession_scheme', 'set_fee_head_tax']) {
      expect(confirmableOn(MCP_TOOLS[n], 'WHATSAPP'), n).toBe(false);
    }
    for (const n of ['declare_vendor_conflict', 'add_budget_variance_note', 'create_scenario']) {
      expect(confirmableOn(MCP_TOOLS[n], 'WHATSAPP'), n).toBe(true);
    }
  });

  it('shows each role only what its permissions allow', () => {
    const visible = (role) => mcpToolsFor(actorForRole(role)).map((t) => t.name).filter((n) => NAMES.includes(n));
    const parent = visible('PARENT');
    expect(parent).toEqual(expect.arrayContaining(['list_fee_academic_years', 'get_fee_year_statement', 'get_installment_plan_breakdown']));
    for (const n of ['get_payment_audit_trail', 'create_vendor', 'list_vendors', 'list_budget_scenarios']) expect(parent, n).not.toContain(n);
    const teacher = visible('TEACHER');
    expect(teacher).toEqual(expect.arrayContaining(['list_vendors', 'declare_vendor_conflict', 'get_purchase_request', 'set_purchase_quotes', 'transition_purchase_request']));
    for (const n of ['create_vendor', 'move_purchase_request', 'record_vendor_due_diligence']) expect(teacher, n).not.toContain(n);
    expect(visible('PRINCIPAL')).toEqual(expect.arrayContaining(['get_reminder_preview', 'list_cash_closes', 'create_scenario']));
    expect(visible('TRUSTEE')).toEqual(expect.arrayContaining(['list_funding_proposals', 'get_scenario_projection']));
    expect(visible('TRUSTEE')).not.toContain('create_scenario');
    expect(visible('ADMIN')).toEqual(expect.arrayContaining(['list_seat_purchases', 'get_seat_request']));
    expect(visible('FINANCE')).not.toContain('list_seat_purchases');
  });
});

describe('fees', () => {
  it('a parent reads their own years and overview; the principal previews who a reminder would reach', async () => {
    const years = await read(s.people.PARENT.actor, 'list_fee_academic_years');
    expect(years.data.items.map((y) => y.name)).toEqual(['2026-27']);
    const overview = await read(s.people.PARENT.actor, 'get_fee_year_statement', {});
    expect(overview.data.invoices.map((i) => i.invoiceNo)).toEqual(['INV-1001']);
    const preview = await read(s.people.PRINCIPAL.actor, 'get_reminder_preview', {});
    expect(preview.data.students).toBe(1);
    expect(preview.data.guardianIds).toBeUndefined();
    // Reading the reminder preview does not need fees.manage, but sending does.
    expect(mcpToolsFor(s.people.PRINCIPAL.actor).map((t) => t.name)).not.toContain('send_fee_reminders');
  }, 60_000);

  it('a parent cannot reach the school-wide payment audit trail', async () => {
    const res = await mcp(OAK, s.people.PARENT.actor, 'get_payment_audit_trail', { invoiceNo: 'INV-1001' });
    expect(res.success).toBe(false);
  });
});

describe('procurement', () => {
  it('finance adds a vendor (web only), the approver records due diligence, a teacher quotes and submits their own request', async () => {
    const F = s.people.FINANCE.actor;
    const onPhone = await mcp(OAK, F, 'create_vendor', { name: 'Sharma Stationers' }, { channel: 'WHATSAPP' });
    expect(onPhone.success).toBe(false);
    expect(onPhone.error.details?.reason).toBe('CONFIRM_ON_WEB');

    const { proposal } = await confirm(F, 'create_vendor', { name: 'Sharma Stationers', category: 'Stationery', phone: '9876543210' }, { unchanged: async () => (await inOak(() => Vendor.countDocuments())) === 0 });
    expect(proposal.action.summary).toMatch(/Add vendor "Sharma Stationers"/);
    expect((await inOak(() => Vendor.findOne().lean())).status).toBe('PENDING_DUE_DILIGENCE');

    // A teacher may not add vendors.
    const refused = await mcp(OAK, s.people.TEACHER.actor, 'create_vendor', { name: 'Other' });
    expect(refused.success).toBe(false);

    // The decision is required: no default is assumed.
    const noDecision = await mcp(OAK, s.people.ADMIN.actor, 'record_vendor_due_diligence', { vendor: 'Sharma', note: 'GST checked' });
    expect(noDecision.success).toBe(false);
    await confirm(s.people.ADMIN.actor, 'record_vendor_due_diligence', { vendor: 'Sharma', decision: 'CLEARED', note: 'GST certificate and references checked' });
    expect((await inOak(() => Vendor.findOne().lean())).status).toBe('ACTIVE');

    const vendors = await read(s.people.TEACHER.actor, 'list_vendors', {});
    expect(vendors.data.items.map((v) => v.name)).toEqual(['Sharma Stationers']);
    await confirm(s.people.TEACHER.actor, 'declare_vendor_conflict', { vendor: 'Sharma', declaration: 'My cousin owns it' });
    expect((await inOak(() => Vendor.findOne().lean())).conflicts).toHaveLength(1);

    const T = s.people.TEACHER.actor;
    const pr = await inOak(() => procurement.createRequestDraft(T, { title: 'Lab chart paper', items: [{ description: 'Chart paper', qty: 100, estUnitPaise: 1000 }] }));
    await confirm(T, 'set_purchase_quotes', { request: pr.refNo, quotes: [{ vendor: 'Sharma Stationers', amountRupees: 950, selected: true }] });
    expect((await inOak(() => PurchaseRequest.findById(pr.id).lean())).quotes[0].amountPaise).toBe(95000);

    const got = await read(T, 'get_purchase_request', { request: 'chart paper' });
    expect(got.data.refNo).toBe(pr.refNo);

    await confirm(T, 'transition_purchase_request', { request: pr.refNo, step: 'submit' });
    expect((await inOak(() => PurchaseRequest.findById(pr.id).lean())).status).toBe('IN_APPROVAL');

    // Another teacher cannot see it.
    const other = await mcp(OAK, actorForRole('TEACHER'), 'get_purchase_request', { request: pr.refNo });
    expect(other.success).toBe(false);

    const stats = await read(F, 'get_procurement_stats');
    expect(stats.data.purchaseRequestsInApproval).toBe(1);
  }, 120_000);
});

describe('budgets and funding', () => {
  it('a draft budget is submitted, a variance explained, and a funding proposal drafted and submitted', async () => {
    const F = s.people.FINANCE.actor;
    await inOak(() => procurement.createBudget(F, { fiscalYear: '2026-27', name: 'Main budget', lines: [{ code: 'LAB-01', head: 'Lab consumables', plannedPaise: 5_000_000 }] }));
    await confirm(F, 'add_budget_variance_note', { budget: 'Main', line: 'LAB-01', explanation: 'Extra practical sessions' });
    await confirm(F, 'submit_budget', { budget: 'Main budget' }, { unchanged: async () => (await inOak(() => Budget.findOne().lean())).status === 'DRAFT' });
    const b = await inOak(() => Budget.findOne().lean());
    expect(b.status).toBe('IN_APPROVAL');
    expect(b.lines[0].varianceExplanation).toBe('Extra practical sessions');

    await confirm(F, 'create_funding_proposal', { kind: 'LOAN', title: 'Bus purchase', amountRupees: 2_000_000, offers: [{ provider: 'Bank A', annualRatePct: 9.5, tenureMonths: 60, selected: true }] });
    const f = await inOak(() => FundingProposal.findOne().lean());
    expect(f.offers[0].emiPaise).toBeGreaterThan(0);
    await confirm(F, 'transition_funding_proposal', { proposal: 'Bus purchase', step: 'submit' });
    expect((await inOak(() => FundingProposal.findOne().lean())).status).toBe('IN_APPROVAL');
    const listedRows = await read(s.people.PRINCIPAL.actor, 'list_funding_proposals', {});
    expect(listedRows.data.items).toHaveLength(1);
  }, 90_000);
});

describe('bills, concessions and tax', () => {
  it('a service account is added and changed; a concession scheme is added; fee-head tax is listed', async () => {
    const F = s.people.FINANCE.actor;
    await confirm(F, 'create_service_account', { name: 'Electricity main meter', category: 'ELECTRICITY', expectedAmountRupees: 45000, nextDueOn: '2026-11-25' }, { unchanged: async () => (await inOak(() => ServiceAccount.countDocuments())) === 0 });
    await confirm(F, 'update_service_account', { account: 'electricity', expectedAmountRupees: 48000 });
    expect((await inOak(() => ServiceAccount.findOne().lean())).expectedAmountPaise).toBe(4_800_000);
    const accounts = await read(s.people.PRINCIPAL.actor, 'list_service_accounts', {});
    expect(accounts.data.items).toHaveLength(1);
    await confirm(F, 'sync_bill_reminders', {});

    await confirm(F, 'create_concession_scheme', { code: 'SIB', name: 'Sibling concession', kind: 'SIBLING', method: 'PERCENT', percent: 10 });
    expect((await inOak(() => ConcessionType.findOne().lean())).valueBp).toBe(1000);
    await confirm(F, 'update_concession_scheme', { scheme: 'SIB', active: false });
    expect((await inOak(() => ConcessionType.findOne().lean())).active).toBe(false);
    await read(F, 'list_gst_rates');
    const adj = await read(F, 'get_invoice_concession_history', { invoiceNo: 'INV-1001' });
    expect(adj.data.adjustablePaise).toBe(800000);
  }, 90_000);
});

describe('scenarios, seats and cash close', () => {
  it('projects, saves and removes a scenario; reads the seat ledger and the closed days', async () => {
    const P = s.people.PRINCIPAL.actor;
    const proj = await read(P, 'get_scenario_projection', { assumptions: { intake: 40, feeIncreasePct: 10 }, years: 2 });
    expect(proj.data.rows).toHaveLength(3);
    expect(proj.data.baseline.staffing.monthlyPayrollPaise).toBeUndefined();
    await confirm(P, 'create_scenario', { name: 'Growth case', years: 2, assumptions: { intake: 40 } }, { unchanged: async () => (await inOak(() => Scenario.countDocuments())) === 0 });
    expect((await read(P, 'list_budget_scenarios')).data.items.map((x) => x.name)).toEqual(['Growth case']);
    await read(s.people.ADMIN.actor, 'get_scenario', { scenario: 'Growth case' });
    await confirm(P, 'archive_scenario', { scenario: 'Growth case' });
    expect((await read(P, 'list_budget_scenarios')).data.items).toHaveLength(0);

    await read(s.people.ADMIN.actor, 'list_seat_purchases', {});
    await read(s.people.FINANCE.actor, 'list_cash_closes', {});
  }, 90_000);
});
