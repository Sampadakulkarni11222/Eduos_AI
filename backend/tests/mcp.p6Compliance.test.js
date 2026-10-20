import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { MCP_TOOLS, mcpToolsFor, confirmableOn, validateMcpRegistry } from '../src/modules/ai/mcp/registry.js';
import { tools as complianceTools } from '../src/modules/ai/mcp/tools/p6/compliance.js';
import { isDecidingToolName } from '../src/modules/ai/mcp/decisions.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { ComplianceObligation, RegulatoryReturn, Licence, Policy, RegulatoryNotice } from '../src/models/compliance.model.js';
import { AccreditationCycle } from '../src/models/accreditation.model.js';
import { inSchool, mcp, seedPerson, actorForRole, OAK } from './support/mcpSchool.js';
import { seedFamilySchool } from './support/familySchool.js';

/**
 * Part-6 compliance tools (tools/p6/compliance.js): the Compliance Centre's own
 * service calls behind the route guards. Reads for compliance.read, changes for
 * compliance.manage, the accreditation owner's own items for anyone, decisions
 * approver-confirmed and website-only.
 */
const NAMES = Object.keys(complianceTools);
const DECISIONS = ['record_obligation_applicability_decision', 'record_return_review_decision', 'record_notice_applicability_decision'];
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
  s.people.COMPLIANCE = await seedPerson({ roleKey: 'COMPLIANCE', roleId: s.roleIds.COMPLIANCE, displayName: 'Meera Compliance' });
});
afterAll(async () => { await resetMcpClient(); });

describe('the contract', () => {
  it('registers closed, non-deciding tools; writes confirm and summarise; decisions are HIGH, web-only, stated; the boot check passes', () => {
    expect(NAMES.length).toBe(39);
    for (const n of NAMES) {
      const t = MCP_TOOLS[n];
      expect(t, n).toBeTruthy();
      expect(t.inputSchema.additionalProperties, n).toBe(false);
      expect(isDecidingToolName(n), n).toBe(false);
      if (t.operation === 'GET') expect(n, n).toMatch(/^(get|list|search)_/);
      else {
        expect(t.confirm, n).toBe(true);
        expect(typeof t.summarise, n).toBe('function');
      }
      expect(Boolean(t.approverDecision), n).toBe(DECISIONS.includes(n));
    }
    for (const n of DECISIONS) {
      const t = MCP_TOOLS[n];
      expect(t.risk, n).toBe('HIGH');
      expect(t.affectsOthers, n).toBe(true);
      expect(t.inputSchema.required, n).toContain('decision');
      expect(t.inputSchema.properties.decision.default, n).toBeUndefined();
      expect(confirmableOn(t, 'WHATSAPP'), n).toBe(false);
    }
    expect(validateMcpRegistry()).toEqual([]);
  });

  it('shows each role what its routes allow', () => {
    const visible = (role) => mcpToolsFor(actorForRole(role)).map((t) => t.name).filter((n) => NAMES.includes(n)).sort();
    expect(visible('COMPLIANCE')).toEqual([...NAMES].sort());
    const principal = visible('PRINCIPAL');
    expect(principal).toEqual(expect.arrayContaining(['get_compliance_overview', 'list_regulatory_returns', 'get_data_protection_overview', 'list_accreditation_cycles']));
    for (const n of ['get_data_request', 'generate_regulatory_return', 'add_standard_compliance_obligations', ...DECISIONS]) expect(principal, n).not.toContain(n);
    expect(visible('TRUSTEE')).toEqual(expect.arrayContaining(['get_compliance_overview', 'list_compliance_policies']));
    for (const role of ['TEACHER', 'PARENT', 'STUDENT', 'ALUMNUS']) {
      expect(visible(role), role).toEqual(['get_safeguarding_guidance', 'list_my_accreditation_items', 'update_accreditation_item']);
    }
  });
});

describe('through the real MCP server', () => {
  it('loads the catalogue only after confirmation, lists it, and records an applicability decision on the website only', async () => {
    const officer = s.people.COMPLIANCE.actor;
    await confirm(officer, 'add_standard_compliance_obligations', { institutionType: 'SCHOOL' }, { unchanged: async () => (await inOak(() => ComplianceObligation.countDocuments())) === 0 });
    expect(await inOak(() => ComplianceObligation.countDocuments({ applicability: 'UNDER_REVIEW' }))).toBeGreaterThan(5);

    const list = await mcp(OAK, s.people.PRINCIPAL.actor, 'list_compliance_obligations', { category: 'LICENCE' });
    expect(list.success, JSON.stringify(list.error)).toBe(true);
    expect(list.data.items.map((o) => o.code)).toContain('FIRE-SAFETY-CERT');

    const phone = await mcp(OAK, officer, 'record_obligation_applicability_decision', { obligation: 'FIRE-SAFETY-CERT', decision: 'APPLICABLE', note: 'We are a CBSE school' }, { channel: 'WHATSAPP' });
    expect(phone.success).toBe(false);
    expect(phone.error.details?.reason).toBe('CONFIRM_ON_WEB');

    const { proposal } = await confirm(officer, 'record_obligation_applicability_decision', { obligation: 'FIRE-SAFETY-CERT', decision: 'APPLICABLE', note: 'We are a CBSE school' });
    expect(proposal.action.summary).toMatch(/FIRE-SAFETY-CERT.*applicable.*CBSE school/i);
    const o = await inOak(() => ComplianceObligation.findOne({ code: 'FIRE-SAFETY-CERT' }).lean());
    expect(o.applicability).toBe('APPLICABLE');
    expect(o.applicabilityNote).toBe('We are a CBSE school');

    const overview = await mcp(OAK, s.people.HR.actor, 'get_compliance_overview', {});
    expect(overview.success, JSON.stringify(overview.error)).toBe(true);
    expect(overview.data.applicableObligations).toBe(1);
  });

  it('generates a return, sends it to a named reviewer, and the reviewer (never the preparer) passes it on', async () => {
    const officer = s.people.COMPLIANCE.actor;
    await confirm(officer, 'generate_regulatory_return', { template: 'STAFF_STRENGTH', period: '2026-27', dueOn: '2026-12-31' }, { unchanged: async () => (await inOak(() => RegulatoryReturn.countDocuments())) === 0 });
    const r = await inOak(() => RegulatoryReturn.findOne().lean());
    expect(r.status).toBe('DRAFT');

    const got = await mcp(OAK, s.people.PRINCIPAL.actor, 'get_regulatory_return', { return: r.refNo });
    expect(got.success, JSON.stringify(got.error)).toBe(true);
    expect(got.data.status).toBe('DRAFT');

    await confirm(officer, 'edit_regulatory_return_figures', { return: r.refNo, changes: [{ field: 'contractStaff', value: '4' }], note: 'Four contract staff not in the user list' });
    expect((await inOak(() => RegulatoryReturn.findById(r._id).lean())).data.contractStaff).toBe(4);

    await confirm(officer, 'move_regulatory_return', { return: r.refNo, step: 'send_for_review', reviewer: 'ADMIN user', acknowledgeErrors: true });
    const sent = await inOak(() => RegulatoryReturn.findById(r._id).lean());
    expect(sent.status).toBe('IN_REVIEW');
    expect(String(sent.reviewerProfileId)).toBe(s.people.ADMIN.actor.profileId);

    const self = await mcp(OAK, officer, 'record_return_review_decision', { return: r.refNo, decision: 'REQUEST_APPROVAL' });
    expect(self.success).toBe(false);

    await confirm(s.people.ADMIN.actor, 'record_return_review_decision', { return: r.refNo, decision: 'REQUEST_APPROVAL' });
    const reviewed = await inOak(() => RegulatoryReturn.findById(r._id).lean());
    expect(reviewed.approvalRequestId).toBeTruthy();
  });

  it('adds a licence, creates a policy and sends it for approval, logs and decides a notice', async () => {
    const officer = s.people.COMPLIANCE.actor;
    await confirm(officer, 'add_compliance_licence', { kind: 'CERTIFICATE', title: 'Fire NOC', number: 'FIRE/22/118', expiresOn: '2027-03-31', renewalCostRupees: 2500 });
    const l = await inOak(() => Licence.findOne({ title: 'Fire NOC' }).lean());
    expect(l.renewalCostPaise).toBe(250000);
    await confirm(officer, 'update_compliance_licence', { licence: 'FIRE/22/118', renewalStatus: 'IN_PROGRESS' });
    expect((await inOak(() => Licence.findById(l._id).lean())).renewalStatus).toBe('IN_PROGRESS');

    await confirm(officer, 'create_compliance_policy', { code: 'cp-01', title: 'Child protection policy', category: 'SAFEGUARDING', audienceRoles: ['TEACHER'], requiresAcknowledgement: true, body: 'Every adult reports a concern the same day.' });
    const sent = await confirm(officer, 'send_policy_for_approval', { policy: 'CP-01' });
    expect(sent.proposal.action.summary).toMatch(/version 1 of CP-01/);
    const p = await inOak(() => Policy.findOne({ code: 'CP-01' }).lean());
    expect(p.versions[0].status).toBe('AWAITING_APPROVAL');

    await confirm(officer, 'log_regulatory_notice', { source: 'CBSE', title: 'Circular on school bus safety audits', link: 'https://cbse.gov.in/circular.pdf' });
    const n = await inOak(() => RegulatoryNotice.findOne().lean());
    const early = await mcp(OAK, officer, 'record_notice_applicability_decision', { notice: n.refNo, decision: 'APPLICABLE', rationale: 'We run buses' });
    expect(early.success).toBe(false);
    await confirm(officer, 'update_regulatory_notice', { notice: n.refNo, authenticity: 'VERIFIED', authenticityNote: 'On the CBSE site' });
    await confirm(officer, 'record_notice_applicability_decision', { notice: n.refNo, decision: 'APPLICABLE', rationale: 'We run buses' });
    await confirm(officer, 'update_regulatory_notice', { notice: n.refNo, addActions: [{ title: 'Audit every bus', owner: 'ADMIN user', dueOn: '2026-11-30' }] });
    const decided = await inOak(() => RegulatoryNotice.findById(n._id).lean());
    expect(decided.status).toBe('APPLICABLE');
    expect(decided.actions[0]).toMatchObject({ title: 'Audit every bus' });
    expect(String(decided.actions[0].ownerProfileId)).toBe(s.people.ADMIN.actor.profileId);

    const notices = await mcp(OAK, s.people.PRINCIPAL.actor, 'list_regulatory_notices', {});
    expect(notices.success).toBe(true);
    expect(notices.data.items[0].actions).toHaveLength(1);
  });

  it('prepares accreditation evidence; the owner updates only their own item', async () => {
    const officer = s.people.COMPLIANCE.actor;
    await confirm(officer, 'create_accreditation_cycle', { framework: 'BOARD_INSPECTION', title: 'CBSE inspection 2027', targetDate: '2027-01-15' });
    const c = await inOak(() => AccreditationCycle.findOne().lean());
    await confirm(officer, 'add_accreditation_item', { cycle: c.refNo, criterion: 'B', metric: 'Fire drill records for the last year', owner: 'Maths teacher', dueOn: '2026-12-01' });

    const mine = await mcp(OAK, s.people.T2.actor, 'list_my_accreditation_items', {});
    expect(mine.success, JSON.stringify(mine.error)).toBe(true);
    expect(mine.data.items[0]).toMatchObject({ metric: 'Fire drill records for the last year', status: 'NOT_STARTED' });
    const none = await mcp(OAK, s.people.T3.actor, 'update_accreditation_item', { item: 'Fire drill', status: 'IN_PROGRESS' });
    expect(none.success).toBe(false);
    const notHers = await mcp(OAK, s.people.T2.actor, 'update_accreditation_item', { item: 'Fire drill', dueOn: '2027-01-01' });
    expect(notHers.success).toBe(false);

    await confirm(s.people.T2.actor, 'update_accreditation_item', { item: 'Fire drill', status: 'IN_PROGRESS', note: 'Collecting the registers' });
    const after = await inOak(() => AccreditationCycle.findById(c._id).lean());
    const item = after.criteria.flatMap((cr) => cr.items)[0];
    expect(item).toMatchObject({ status: 'IN_PROGRESS', note: 'Collecting the registers' });

    const got = await mcp(OAK, s.people.PRINCIPAL.actor, 'get_accreditation_cycle', { cycle: 'CBSE inspection' });
    expect(got.success).toBe(true);
    expect(got.data.progress ?? got.data.readyPct).not.toBeUndefined();
  });

  it('refuses compliance changes to roles without compliance.manage, and anyone may read the safeguarding guidance', async () => {
    for (const role of ['PRINCIPAL', 'TEACHER', 'PARENT']) {
      const r = await mcp(OAK, s.people[role].actor, 'generate_regulatory_return', { template: 'STAFF_STRENGTH', period: '2026-27' });
      expect(r.success, role).toBe(false);
    }
    const t = await mcp(OAK, s.people.TEACHER.actor, 'get_compliance_overview', {});
    expect(t.success).toBe(false);
    expect(await inOak(() => RegulatoryReturn.countDocuments())).toBe(0);

    const g = await mcp(OAK, s.people.STUDENT.actor, 'get_safeguarding_guidance', { topic: 'CHILD_PROTECTION' });
    expect(g.success, JSON.stringify(g.error)).toBe(true);
    expect(g.data.items[0].guidance).toMatch(/POCSO/);
  });
});
