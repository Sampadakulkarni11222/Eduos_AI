import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { MCP_TOOLS, mcpToolsFor, confirmableOn, validateMcpRegistry } from '../src/modules/ai/mcp/registry.js';
import { tools as marketingTools } from '../src/modules/ai/mcp/tools/p6/marketing.js';
import { isDecidingToolName } from '../src/modules/ai/mcp/decisions.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import * as marketing from '../src/modules/marketing/marketing.service.js';
import { Lead } from '../src/models/lead.model.js';
import { Campaign, CreativeAsset, IntakeCapacity, SeatOffer } from '../src/models/marketing.model.js';
import { OfflineCampaign, HeardFromOption, LeadTouch, MarketingSetting } from '../src/models/marketingGrowth.model.js';
import { inSchool, mcp, actorForRole, seedSchool, seedPerson, OAK } from './support/mcpSchool.js';

/**
 * Part-6 marketing coverage tools (tools/p6/marketing.js). Drafts change
 * nothing until the same person confirms; money and changes that reach
 * families are confirmed on the website; an asset's and an offline campaign's
 * approval are the approver's own stated decision, never the creator's.
 */
const NAMES = Object.keys(marketingTools);
let s;
let MK;
const inOak = (fn) => inSchool(OAK, fn);

async function confirm(actor, name, args, { unchanged } = {}) {
  const proposal = await mcp(OAK, actor, name, args);
  expect(proposal.success, `${name}: ${JSON.stringify(proposal.error)}`).toBe(true);
  expect(proposal.action.status).toBe('confirmation_required');
  if (unchanged) expect(await unchanged()).toBe(true);
  const done = await mcp(OAK, actor, name, {}, { confirmationToken: proposal.action.confirmationToken });
  return { proposal, done };
}
async function confirmOk(actor, name, args, opts) {
  const out = await confirm(actor, name, args, opts);
  expect(out.done.success, `${name}: ${JSON.stringify(out.done.error)}`).toBe(true);
  return out;
}
async function read(actor, name, args = {}) {
  const res = await mcp(OAK, actor, name, args);
  expect(res.success, `${name}: ${JSON.stringify(res.error)}`).toBe(true);
  return res;
}

beforeEach(async () => {
  s = await seedSchool();
  MK = (await seedPerson({ roleKey: 'MARKETING', roleId: s.roleIds.MARKETING, displayName: 'Marketing lead' })).actor;
});
afterAll(async () => { await resetMcpClient(); });

describe('the contract', () => {
  it('registers closed, non-deciding tools; writes confirm and summarise; decisions are HIGH, web-only and stated', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(28);
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
      }
    }
    expect(NAMES.filter((n) => MCP_TOOLS[n].approverDecision).sort()).toEqual(['record_marketing_asset_decision', 'record_offline_campaign_decision']);
    expect(validateMcpRegistry()).toEqual([]);
    for (const n of ['update_marketing_campaign', 'set_admission_capacity', 'update_seat_offer', 'update_offline_campaign', 'update_enquiry_marketing_details']) {
      expect(confirmableOn(MCP_TOOLS[n], 'WHATSAPP'), n).toBe(false);
    }
    for (const n of ['create_marketing_asset', 'record_enquiry_source', 'update_counselling_appointment', 'set_ad_sample_data']) {
      expect(confirmableOn(MCP_TOOLS[n], 'WHATSAPP'), n).toBe(true);
    }
  });

  it('shows each role only what its permissions allow', () => {
    const visible = (role) => mcpToolsFor(actorForRole(role)).map((t) => t.name).filter((n) => NAMES.includes(n));
    expect(visible('MARKETING')).toEqual(expect.arrayContaining(['update_marketing_campaign', 'set_admission_capacity', 'create_offline_campaign', 'get_online_application']));
    const principal = visible('PRINCIPAL');
    expect(principal).toEqual(expect.arrayContaining(['list_marketing_assets', 'record_marketing_asset_decision', 'record_offline_campaign_decision', 'get_integration_connections']));
    for (const n of ['create_offline_campaign', 'set_admission_capacity', 'get_online_application']) expect(principal, n).not.toContain(n);
    for (const role of ['TEACHER', 'PARENT', 'STUDENT', 'FINANCE']) expect(visible(role), role).toEqual([]);
  });
});

describe('campaigns and creative', () => {
  it('spend is web-only; an asset is drafted, worked on and approved by a second person, never its last editor', async () => {
    await inOak(() => Campaign.create({ name: 'Open day 2027', code: 'OPEN27', startsOn: new Date('2026-10-01'), endsOn: new Date('2026-12-31'), budgetPaise: 5_000_000 }));
    const onPhone = await mcp(OAK, MK, 'update_marketing_campaign', { campaign: 'OPEN27', spentRupees: 12000 }, { channel: 'WHATSAPP' });
    expect(onPhone.success).toBe(false);
    expect(onPhone.error.details?.reason).toBe('CONFIRM_ON_WEB');
    await confirmOk(MK, 'update_marketing_campaign', { campaign: 'Open day', spentRupees: 12000, status: 'ACTIVE' }, { unchanged: async () => (await inOak(() => Campaign.findOne().lean())).spentPaise === 0 });
    expect((await inOak(() => Campaign.findOne().lean())).spentPaise).toBe(1_200_000);

    const refused = await mcp(OAK, s.people.TEACHER.actor, 'list_marketing_assets', {});
    expect(refused.success).toBe(false);

    await confirmOk(MK, 'create_marketing_asset', { kind: 'POSTER', title: 'Open day poster', size: 'A4_POSTER', campaign: 'OPEN27', claims: ['100% board results 2025'] });
    await confirmOk(MK, 'update_marketing_asset', {
      asset: 'Open day poster', altText: 'Children at the science fair', fileLink: 'https://example.org/poster-v1.png',
      claims: [{ text: '100% board results 2025', verified: true, evidence: 'Board result sheet 2025' }], status: 'IN_REVIEW',
    });
    expect((await inOak(() => CreativeAsset.findOne().lean())).status).toBe('IN_REVIEW');

    // No decision, no tool call; the last editor cannot approve their own asset.
    expect((await mcp(OAK, MK, 'record_marketing_asset_decision', { asset: 'Open day poster' })).success).toBe(false);
    const own = await confirm(MK, 'record_marketing_asset_decision', { asset: 'Open day poster', decision: 'APPROVE' });
    expect(own.done.success).toBe(false);
    expect((await inOak(() => CreativeAsset.findOne().lean())).status).toBe('IN_REVIEW');
    await confirmOk(s.people.PRINCIPAL.actor, 'record_marketing_asset_decision', { asset: 'Open day poster', decision: 'APPROVE' });
    expect((await inOak(() => CreativeAsset.findOne().lean())).status).toBe('APPROVED');

    const assets = await read(s.people.PRINCIPAL.actor, 'list_marketing_assets', { status: 'APPROVED' });
    expect(assets.data.items).toHaveLength(1);
    await read(MK, 'list_marketing_asset_sizes');
  }, 120_000);
});

describe('enquiries, capacity and offers', () => {
  it('records marketing details and the source, finds duplicates, sets capacity and records the family accepting an offer', async () => {
    await inOak(() => Campaign.create({ name: 'Search ads', code: 'SRCH', startsOn: new Date('2026-10-01'), endsOn: new Date('2026-12-31') }));
    const lead = await inOak(() => Lead.create({ childName: 'Ishaan Mehta', guardianName: 'Neha Mehta', phone: '+919811100001' }));
    await inOak(() => Lead.create({ childName: 'Ishaan M', guardianName: 'Neha Mehta', phone: '9811100001' }));

    await confirmOk(MK, 'update_enquiry_marketing_details', { childName: 'Ishaan Mehta', campaign: 'SRCH', sourceDetail: 'Google search', responded: true });
    const after = await inOak(() => Lead.findById(lead._id).lean());
    expect(String(after.campaignId)).toBeTruthy();
    expect(after.firstResponseAt).toBeTruthy();

    const dups = await read(MK, 'list_duplicate_enquiries');
    expect(dups.data.items).toHaveLength(1);

    await confirmOk(MK, 'record_enquiry_source', { childName: 'Ishaan Mehta', campaign: 'SRCH' });
    expect(await inOak(() => LeadTouch.countDocuments({ leadId: lead._id }))).toBe(1);
    const attribution = await read(MK, 'get_enquiry_attribution', { childName: 'Ishaan Mehta' });
    expect(attribution.data.credited.channel).toBe('ONLINE_CAMPAIGN');

    await confirmOk(MK, 'set_admission_capacity', { academicYear: '2027-28', gradeOrProgramme: 'Class 1', capacity: 40, reserved: [{ category: 'RTE', seats: 10 }] }, { unchanged: async () => (await inOak(() => IntakeCapacity.countDocuments())) === 0 });
    await inOak(() => marketing.offerSeat(MK, { leadId: String(lead._id), academicYear: '2027-28', gradeOrProgramme: 'Class 1' }));
    const offers = await read(MK, 'list_admission_offers', { academicYear: '2027-28' });
    expect(offers.data.items.map((o) => o.status)).toEqual(['OFFERED']);
    await confirmOk(MK, 'update_seat_offer', { childName: 'Ishaan Mehta', to: 'ACCEPTED' });
    expect((await inOak(() => SeatOffer.findOne().lean())).status).toBe('ACCEPTED');
    expect((await inOak(() => IntakeCapacity.findOne().lean())).accepted).toBe(1);
  }, 120_000);
});

describe('offline campaigns, settings and connectors', () => {
  it('a draft goes for approval, the creator cannot approve it, the principal does, and it goes live', async () => {
    await confirmOk(MK, 'create_offline_campaign', {
      name: 'Sector 21 banners', code: 'BAN21', channelType: 'BANNER_HOARDING', startsOn: '2026-11-01', endsOn: '2026-11-30',
      placements: [{ location: 'Sector 21 market', quantity: 4 }], costRupees: 18000,
    }, { unchanged: async () => (await inOak(() => OfflineCampaign.countDocuments())) === 0 });
    await confirmOk(MK, 'update_offline_campaign', { campaign: 'BAN21', vendorName: 'City Flex' });
    await confirmOk(MK, 'transition_offline_campaign', { campaign: 'BAN21', step: 'SUBMIT' });
    expect((await inOak(() => OfflineCampaign.findOne().lean())).status).toBe('PENDING_APPROVAL');

    const own = await confirm(MK, 'record_offline_campaign_decision', { campaign: 'BAN21', decision: 'APPROVE' });
    expect(own.done.success).toBe(false);
    await confirmOk(s.people.PRINCIPAL.actor, 'record_offline_campaign_decision', { campaign: 'BAN21', decision: 'APPROVE' });
    await confirmOk(MK, 'transition_offline_campaign', { campaign: 'Sector 21', step: 'GO_LIVE' });
    expect((await inOak(() => OfflineCampaign.findOne().lean())).status).toBe('LIVE');
    const one = await read(s.people.PRINCIPAL.actor, 'get_offline_campaign', { campaign: 'BAN21' });
    expect(one.data.vendorName).toBe('City Flex');
    expect((await read(MK, 'list_offline_campaigns', {})).data.items).toHaveLength(1);

    await confirmOk(MK, 'save_heard_from_option', { label: 'Banner near the market', channel: 'BANNER_HOARDING', offlineCampaign: 'BAN21' });
    expect((await inOak(() => HeardFromOption.findOne().lean())).label).toBe('Banner near the market');
    expect((await read(MK, 'list_heard_from_options')).data.items).toHaveLength(1);

    await confirmOk(MK, 'save_marketing_settings', { admissionValueRupees: 150000 });
    expect((await inOak(() => MarketingSetting.findOne().lean())).admissionValuePaise).toBe(15_000_000);
    expect((await read(s.people.PRINCIPAL.actor, 'get_marketing_settings')).data.admissionValuePaise).toBe(15_000_000);
    await read(MK, 'get_marketing_attribution', {});

    await confirmOk(MK, 'set_ad_sample_data', { platform: 'META_ADS', on: true });
    const imports = await read(MK, 'list_ad_imports', {});
    expect(imports.data.items[0].simulated).toBe(true);
    await read(MK, 'get_integration_connections');
  }, 120_000);
});
