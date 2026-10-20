import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { MCP_TOOLS, mcpToolsFor, confirmableOn, validateMcpRegistry } from '../src/modules/ai/mcp/registry.js';
import { integrationTools, periodOf } from '../src/modules/ai/mcp/tools/p3Integrations.js';
import { isDecidingToolName } from '../src/modules/ai/mcp/decisions.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { AdMetric } from '../src/models/marketingGrowth.model.js';
import { SocialOutbox } from '../src/models/social.model.js';
import { CommunityPost } from '../src/models/community.model.js';
import { School } from '../src/models/school.model.js';
import { setFeatures } from '../src/utils/features.js';
import { seedSchool, seedPerson, inSchool, mcp, actorForRole, OAK } from './support/mcpSchool.js';
import { stubProviders, unstubProviders, setAppEnv, json, seedConnection } from './support/integrationsStub.js';

/**
 * Integration tools for the assistant (tools/p3Integrations.js): sync ad data
 * (confirmed), campaign performance (read), share news to social (HIGH,
 * confirmed on the website only).
 */
const NAMES = Object.keys(integrationTools);
let s;
let net;
const inOak = (fn) => inSchool(OAK, fn);

beforeEach(async () => {
  s = await seedSchool();
  s.people.MARKETING = await seedPerson({ roleKey: 'MARKETING', roleId: s.roleIds.MARKETING, displayName: 'Marketing lead' });
  await School.create({ slug: OAK, name: 'Oakridge Academy' });
  net = stubProviders();
});
afterEach(() => { unstubProviders(); setAppEnv(false); });
afterAll(async () => { await resetMcpClient(); });

describe('contract', () => {
  it('three closed, non-deciding tools; the boot check passes; sharing is website-only', () => {
    expect(NAMES.sort()).toEqual(['get_ad_campaign_performance', 'share_news_to_social', 'sync_ad_data']);
    for (const n of NAMES) {
      expect(MCP_TOOLS[n], n).toBeTruthy();
      expect(MCP_TOOLS[n].inputSchema.additionalProperties, n).toBe(false);
      expect(isDecidingToolName(n), n).toBe(false);
    }
    expect(validateMcpRegistry()).toEqual([]);
    expect(MCP_TOOLS.sync_ad_data.confirm).toBe(true);
    expect(MCP_TOOLS.share_news_to_social.confirm).toBe(true);
    expect(confirmableOn(MCP_TOOLS.share_news_to_social, 'WHATSAPP')).toBe(false);
  });

  it('are offered to marketing staff, never to families', () => {
    const visible = (role) => mcpToolsFor(actorForRole(role)).map((t) => t.name).filter((n) => NAMES.includes(n)).sort();
    expect(visible('MARKETING')).toEqual(NAMES.sort());
    for (const role of ['PARENT', 'STUDENT', 'TEACHER']) expect(visible(role), role).toEqual([]);
  });

  it('last week is Monday to Sunday in the school time zone', () => {
    expect(periodOf('last_week', new Date('2026-10-15T10:00:00+05:30'))).toEqual({ from: '2026-10-05', to: '2026-10-11' });
  });
});

describe('through the real MCP server', () => {
  it('"sync ad data now": proposes, then syncs the connected Meta account after confirmation', async () => {
    setAppEnv(true);
    await inOak(() => seedConnection('META', { selected: { metaAdAccountId: '555' } }));
    net.routes.push(['GET', /act_555\/insights/, json({ data: [{ campaign_id: '1', campaign_name: 'ADM27 Open day', date_start: '2026-10-06', spend: '500', impressions: '9000', clicks: '120', actions: [{ action_type: 'lead', value: '6' }] }] })]);
    const m = s.people.MARKETING.actor;
    const proposal = await mcp(OAK, m, 'sync_ad_data', { platform: 'META_ADS', from: '2026-10-05', to: '2026-10-11' });
    expect(proposal.success, JSON.stringify(proposal.error)).toBe(true);
    expect(proposal.action.status).toBe('confirmation_required');
    expect(net.calls).toHaveLength(0);
    const done = await mcp(OAK, m, 'sync_ad_data', {}, { confirmationToken: proposal.action.confirmationToken });
    expect(done.success, JSON.stringify(done.error)).toBe(true);
    expect(done.speak).toMatch(/Meta ads: 1 rows synced/);
    expect(await inOak(() => AdMetric.countDocuments())).toBe(1);

    const perf = await mcp(OAK, m, 'get_ad_campaign_performance', { platform: 'META_ADS', campaign: 'open day', from: '2026-10-05', to: '2026-10-11' });
    expect(perf.success, JSON.stringify(perf.error)).toBe(true);
    expect(perf.data.items[0]).toMatchObject({ campaign: 'ADM27 Open day', leads: 6, clicks: 120 });
    expect(perf.speak).toMatch(/ADM27 Open day — ₹500 spent, 120 clicks, 6 leads, ₹83/);
  });

  it('without credentials "sync" fetches nothing and says so', async () => {
    const m = s.people.MARKETING.actor;
    const proposal = await mcp(OAK, m, 'sync_ad_data', {});
    const done = await mcp(OAK, m, 'sync_ad_data', {}, { confirmationToken: proposal.action.confirmationToken });
    expect(done.success).toBe(true);
    expect(done.speak).toMatch(/Nothing was fetched/);
    expect(net.calls).toHaveLength(0);
  });

  it('"post this news to Facebook and LinkedIn": confirmed, simulated where not connected', async () => {
    await inOak(() => setFeatures({ socialPublishing: true }));
    await inOak(() => CommunityPost.create({ kind: 'STORY', title: 'Annual day', body: 'A wonderful annual day', audience: 'PUBLIC', status: 'PUBLISHED', publishedAt: new Date(), authorProfileId: s.people.PRINCIPAL.profile._id }));
    const m = s.people.MARKETING.actor;
    const proposal = await mcp(OAK, m, 'share_news_to_social', { story: 'annual day', networks: ['FACEBOOK', 'LINKEDIN'] });
    expect(proposal.success, JSON.stringify(proposal.error)).toBe(true);
    expect(proposal.action.summary).toMatch(/Annual day.*Facebook \(simulated — not connected\), LinkedIn \(simulated — not connected\)/);
    expect(await inOak(() => SocialOutbox.countDocuments())).toBe(0);
    const done = await mcp(OAK, m, 'share_news_to_social', {}, { confirmationToken: proposal.action.confirmationToken });
    expect(done.success, JSON.stringify(done.error)).toBe(true);
    expect(done.data.networks.map((n) => n.status)).toEqual(['SIMULATED', 'SIMULATED']);
    expect(net.calls).toHaveLength(0);
  });
});
