import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import express from 'express';
import { seedRoles, seedPerson, inSchool, OAK } from './support/mcpSchool.js';
import { stubProviders, unstubProviders, setAppEnv, json, seedConnection } from './support/integrationsStub.js';
import { Campaign } from '../src/models/marketing.model.js';
import { Lead } from '../src/models/lead.model.js';
import { AdMetric, AdImport, MarketingConnector } from '../src/models/marketingGrowth.model.js';
import { IntegrationConnection } from '../src/models/integration.model.js';
import { School } from '../src/models/school.model.js';
import * as connectors from '../src/modules/marketing/connectors.service.js';
import { syncAllConnected } from '../src/modules/integrations/adsync.service.js';

/**
 * Live ad sync and Meta lead ads, against recorded API shapes (fetch stubbed):
 * mapping into AdMetric, replace-per-day idempotency, rate-limit retry,
 * partial failures, last-synced status, and nothing sent without credentials.
 */
let P;
let net;
const inOak = (fn) => inSchool(OAK, fn);
const RANGE = { from: '2026-10-01', to: '2026-10-03' };

const metaInsights = (rows, paging) => json({ data: rows, ...(paging ? { paging } : {}) });
const metaRow = (date, name, spend, extra = {}) => ({
  campaign_id: '2385', campaign_name: name, date_start: date, date_stop: date, spend: String(spend), impressions: '10000', clicks: '250', account_currency: 'INR',
  actions: [{ action_type: 'lead', value: '4' }, { action_type: 'link_click', value: '250' }, { action_type: 'complete_registration', value: '1' }], ...extra,
});

beforeEach(async () => {
  const roles = await seedRoles();
  P = {};
  for (const key of ['ADMIN', 'MARKETING', 'PARENT']) P[key] = await seedPerson({ roleKey: key, roleId: roles[key], displayName: `${key} person` });
  net = stubProviders();
  await inOak(() => Campaign.create({ name: 'Admissions 2027', code: 'ADM27', startsOn: new Date('2026-10-01'), endsOn: new Date('2026-10-31') }));
});
afterEach(() => { unstubProviders(); setAppEnv(false); });

describe('without credentials', () => {
  it('sends nothing and says Simulated; the scheduled job makes no request', async () => {
    const out = await inOak(() => connectors.sync(P.MARKETING.actor, 'META_ADS', RANGE));
    expect(out).toMatchObject({ synced: false, mode: 'SIMULATED' });
    expect(out.message).toMatch(/platform administrator must set META_APP_ID/);
    setAppEnv(true);
    const notConnected = await inOak(() => connectors.sync(P.MARKETING.actor, 'GOOGLE_ADS', RANGE));
    expect(notConnected).toMatchObject({ synced: false, mode: 'NOT_CONNECTED' });
    expect(await inOak(() => syncAllConnected({ now: new Date('2026-10-04T06:00:00Z') }))).toEqual({ synced: 0, results: [] });
    const list = await inOak(() => connectors.listConnectors(P.MARKETING.actor));
    expect(list.find((c) => c.platform === 'META_ADS').live).toMatchObject({ provider: 'META', appConfigured: true, connected: false, mode: 'SIMULATED' });
    expect(net.calls).toHaveLength(0);
  });
});

describe('Meta Marketing API insights', () => {
  beforeEach(async () => {
    setAppEnv(true);
    await inOak(() => seedConnection('META', { assets: { metaAdAccounts: [{ id: '555', name: 'Oakridge ads' }] }, selected: { metaAdAccountId: '555' } }));
  });

  it('maps daily campaign rows into AdMetric and matches the school campaign by its code', async () => {
    net.routes.push(['GET', /graph\.facebook\.com\/v21\.0\/act_555\/insights/, metaInsights([metaRow('2026-10-01', 'ADM27 Open day', 1250.5), metaRow('2026-10-02', 'ADM27 Open day', 980)])]);
    const out = await inOak(() => connectors.sync(P.MARKETING.actor, 'META_ADS', RANGE));
    expect(out).toMatchObject({ mode: 'LIVE', ok: true, rows: 2, partial: false });
    const call = new URL(net.calls[0].url);
    expect(call.searchParams.get('level')).toBe('campaign');
    expect(call.searchParams.get('time_increment')).toBe('1');
    expect(JSON.parse(call.searchParams.get('time_range'))).toEqual({ since: '2026-10-01', until: '2026-10-03' });
    expect(call.searchParams.get('access_token')).toBeNull(); // the token travels in the header
    expect(net.calls[0].headers.Authorization).toBe('Bearer meta-access-token');
    const rows = await inOak(() => AdMetric.find({}).sort({ date: 1 }).lean());
    expect(rows.map((r) => [r.date.toISOString().slice(0, 10), r.spendPaise, r.impressions, r.clicks, r.leads, r.conversions, r.source])).toEqual([
      ['2026-10-01', 125050, 10000, 250, 4, 5, 'API'],
      ['2026-10-02', 98000, 10000, 250, 4, 5, 'API'],
    ]);
    expect(rows.every((r) => r.campaignId)).toBe(true);
    const status = (await inOak(() => connectors.listConnectors(P.MARKETING.actor))).find((c) => c.platform === 'META_ADS');
    expect(status.live).toMatchObject({ connected: true, mode: 'LIVE' });
    expect(status.live.lastSync).toMatchObject({ ok: true, rows: 2, from: '2026-10-01', to: '2026-10-03', trigger: 'MANUAL' });
  });

  it('re-syncing replaces each day and campaign instead of doubling, and drops a renamed campaign', async () => {
    net.routes.push(['GET', /act_555\/insights/, metaInsights([metaRow('2026-10-01', 'ADM27 Open day', 100)])]);
    await inOak(() => connectors.sync(P.MARKETING.actor, 'META_ADS', RANGE));
    await inOak(() => connectors.sync(P.MARKETING.actor, 'META_ADS', RANGE));
    expect(await inOak(() => AdMetric.countDocuments({}))).toBe(1);
    expect((await inOak(() => AdMetric.findOne({}).lean())).spendPaise).toBe(10000);
    // The platform now reports the campaign under a new name: the old-name row for that day goes.
    net.routes.unshift(['GET', /act_555\/insights/, metaInsights([metaRow('2026-10-01', 'ADM27 Open day (new)', 120)])]);
    const out = await inOak(() => connectors.sync(P.MARKETING.actor, 'META_ADS', RANGE));
    expect(out.removed).toBe(1);
    const rows = await inOak(() => AdMetric.find({}).lean());
    expect(rows.map((r) => [r.campaignName, r.spendPaise])).toEqual([['ADM27 Open day (new)', 12000]]);
  });

  it('a CSV import and the live sync share one row per day and campaign', async () => {
    await inOak(() => connectors.importMetrics(P.MARKETING.actor, 'META_ADS', { csv: 'Campaign name,Day,Amount spent (INR),Impressions,Link clicks,Leads\nADM27 Open day,2026-10-01,50.00,100,5,1' }));
    net.routes.push(['GET', /act_555\/insights/, metaInsights([metaRow('2026-10-01', 'ADM27 Open day', 75)])]);
    await inOak(() => connectors.sync(P.MARKETING.actor, 'META_ADS', RANGE));
    const rows = await inOak(() => AdMetric.find({}).lean());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ spendPaise: 7500, source: 'API' });
  });

  it('follows paging only on the official host, and retries a rate limit', async () => {
    let first = true;
    net.routes.push(
      ['GET', /act_555\/insights\?/, () => {
        if (first) { first = false; return json({ error: { message: 'User request limit reached', code: 17 } }, 400); }
        return metaInsights([metaRow('2026-10-01', 'ADM27 A', 10)], { next: 'https://graph.facebook.com/v21.0/act_555/insights/page2?after=x' });
      }],
      ['GET', /act_555\/insights\/page2/, metaInsights([metaRow('2026-10-02', 'ADM27 B', 20)])],
    );
    const out = await inOak(() => connectors.sync(P.MARKETING.actor, 'META_ADS', RANGE));
    expect(out).toMatchObject({ ok: true, rows: 2 });
    expect(net.calls).toHaveLength(3); // throttled, retried, then page 2

    net.routes.unshift(['GET', /act_555\/insights\?/, metaInsights([metaRow('2026-10-01', 'ADM27 A', 10)], { next: 'https://evil.example/steal?x=1' })]);
    const bad = await inOak(() => connectors.sync(P.MARKETING.actor, 'META_ADS', RANGE));
    expect(bad.ok).toBe(false);
    expect(bad.problems[0].problem).toMatch(/not an official provider API host/);
    expect(net.calls.some((c) => c.url.includes('evil.example'))).toBe(false);
  });

  it('reports a partial failure per date window and keeps the windows that worked', async () => {
    net.routes.push(['GET', /act_555\/insights/, (call) => {
      const since = JSON.parse(new URL(call.url).searchParams.get('time_range')).since;
      return since === '2026-10-01' ? metaInsights([metaRow('2026-10-01', 'ADM27 Open day', 10)]) : json({ error: { message: 'An unexpected error has occurred', code: 2 } }, 500);
    }]);
    const out = await inOak(() => connectors.sync(P.MARKETING.actor, 'META_ADS', { from: '2026-10-01', to: '2026-10-14' }));
    expect(out).toMatchObject({ ok: false, partial: true, rows: 1, windows: 2, failedWindows: 1 });
    expect(out.problems[0]).toMatchObject({ scope: '2026-10-08..2026-10-14' });
    expect(await inOak(() => AdMetric.countDocuments({}))).toBe(1);
    const c = await inOak(() => MarketingConnector.findOne({ platform: 'META_ADS' }).lean());
    expect(c.lastSync).toMatchObject({ ok: false, partial: true });
    expect(c.lastSyncOkAt).toBeNull();
    const imp = await inOak(() => AdImport.findOne({}).lean());
    expect(imp.fileName).toBe('Live sync 2026-10-01 to 2026-10-14');
  });

  it('marks the connection for reconnecting when Meta refuses the token', async () => {
    net.routes.push(
      ['GET', /act_555\/insights/, json({ error: { message: 'Error validating access token: Session has expired', code: 190 } }, 400)],
      ['POST', /oauth\/access_token$/, json({ error: { message: 'Error validating access token', code: 190 } }, 400)],
    );
    const out = await inOak(() => connectors.sync(P.MARKETING.actor, 'META_ADS', RANGE));
    expect(out.ok).toBe(false);
    expect((await inOak(() => IntegrationConnection.findOne({ provider: 'META' }).lean())).status).toBe('NEEDS_RECONNECT');
  });

  it('refuses parents and a range that is too long', async () => {
    await expect(inOak(() => connectors.sync(P.PARENT.actor, 'META_ADS', RANGE))).rejects.toMatchObject({ statusCode: 403 });
    await expect(inOak(() => connectors.sync(P.MARKETING.actor, 'META_ADS', { from: '2026-01-01', to: '2026-10-01' }))).rejects.toMatchObject({ code: 'RANGE_TOO_LONG' });
  });

  it('runs on the schedule for every connected account, idempotently', async () => {
    net.routes.push(['GET', /act_555\/insights/, metaInsights([metaRow('2026-10-02', 'ADM27 Open day', 10)])]);
    const now = new Date('2026-10-03T06:00:00Z');
    const a = await inOak(() => syncAllConnected({ now }));
    const b = await inOak(() => syncAllConnected({ now }));
    expect(a.results).toEqual([{ platform: 'META_ADS', ok: true, rows: 1, failedWindows: 0 }]);
    expect(b.results[0].rows).toBe(1);
    expect(await inOak(() => AdMetric.countDocuments({}))).toBe(1);
    expect((await inOak(() => MarketingConnector.findOne({ platform: 'META_ADS' }).lean())).lastSync.trigger).toBe('SCHEDULED');
  });
});

describe('Google Ads, GA4 and LinkedIn', () => {
  beforeEach(() => setAppEnv(true));

  it('Google Ads: GAQL through searchStream, cost in micros, video campaigns for YouTube', async () => {
    await inOak(() => seedConnection('GOOGLE', { selected: { googleCustomerId: '1234567890', ga4PropertyId: '987654' } }));
    net.routes.push(['POST', /googleads\.googleapis\.com\/v21\/customers\/1234567890\/googleAds:searchStream$/, (call) => {
      const q = JSON.parse(call.body).query;
      const video = !q.includes("!= 'VIDEO'");
      return json([{ results: [{ campaign: { id: video ? '2' : '1', name: video ? 'ADM27 Campus film' : 'ADM27 Search' }, segments: { date: '2026-10-01' }, metrics: { costMicros: '980500000', impressions: '5120', clicks: '233', conversions: 7.0 } }] }]);
    }]);
    const g = await inOak(() => connectors.sync(P.MARKETING.actor, 'GOOGLE_ADS', RANGE));
    const y = await inOak(() => connectors.sync(P.MARKETING.actor, 'YOUTUBE', RANGE));
    expect([g.rows, y.rows]).toEqual([1, 1]);
    expect(net.calls[0].headers['developer-token']).toBe('dev-token-for-tests');
    expect(JSON.parse(net.calls[0].body).query).toMatch(/segments\.date BETWEEN '2026-10-01' AND '2026-10-03'/);
    const rows = await inOak(() => AdMetric.find({}).sort({ platform: 1 }).lean());
    expect(rows.map((r) => [r.platform, r.campaignName, r.spendPaise, r.leads, r.conversions])).toEqual([
      ['GOOGLE_ADS', 'ADM27 Search', 98050, 7, 7],
      ['YOUTUBE', 'ADM27 Campus film', 98050, 7, 7],
    ]);
  });

  it('GA4: runReport sessions and key events per campaign, no spend', async () => {
    await inOak(() => seedConnection('GOOGLE', { selected: { ga4PropertyId: '987654' } }));
    net.routes.push(['POST', /analyticsdata\.googleapis\.com\/v1beta\/properties\/987654:runReport$/, json({
      rowCount: 2,
      rows: [
        { dimensionValues: [{ value: 'ADM27' }, { value: '20261001' }], metricValues: [{ value: '412' }, { value: '9' }] },
        { dimensionValues: [{ value: '(direct)' }, { value: '20261001' }], metricValues: [{ value: '900' }, { value: '3' }] },
      ],
    })]);
    const out = await inOak(() => connectors.sync(P.MARKETING.actor, 'GA4', RANGE));
    expect(out.rows).toBe(1);
    expect(await inOak(() => AdMetric.findOne({}).lean())).toMatchObject({ platform: 'GA4', campaignName: 'ADM27', spendPaise: 0, clicks: 412, leads: 9 });
  });

  it('LinkedIn: daily ad analytics pivoted by campaign, named from the campaign list', async () => {
    await inOak(() => seedConnection('LINKEDIN', { selected: { linkedinAdAccountId: '50001' } }));
    net.routes.push(
      ['GET', /api\.linkedin\.com\/rest\/adAnalytics\?q=analytics&pivot=CAMPAIGN&timeGranularity=DAILY/, json({ elements: [{ pivotValues: ['urn:li:sponsoredCampaign:777'], dateRange: { start: { year: 2026, month: 10, day: 2 }, end: { year: 2026, month: 10, day: 2 } }, costInLocalCurrency: '700.25', impressions: 3000, clicks: 45, oneClickLeads: 3, externalWebsiteConversions: 1 }] })],
      ['GET', /rest\/adAccounts\/50001\/adCampaigns/, json({ elements: [{ id: 777, name: 'ADM27 Teachers hiring' }] })],
    );
    const out = await inOak(() => connectors.sync(P.MARKETING.actor, 'LINKEDIN', RANGE));
    expect(out.rows).toBe(1);
    expect(net.calls[0].url).toContain('accounts=List(urn%3Ali%3AsponsoredAccount%3A50001)');
    expect(net.calls[0].headers['LinkedIn-Version']).toBe('202409');
    expect(await inOak(() => AdMetric.findOne({}).lean())).toMatchObject({ campaignName: 'ADM27 Teachers hiring', spendPaise: 70025, leads: 3, conversions: 4 });
  });

  it('asks for the account to be chosen before syncing', async () => {
    await inOak(() => seedConnection('LINKEDIN', { selected: {} }));
    const out = await inOak(() => connectors.sync(P.MARKETING.actor, 'LINKEDIN', RANGE));
    expect(out).toMatchObject({ synced: false, message: 'Choose the LinkedIn ad account to sync.' });
    expect(net.calls).toHaveLength(0);
  });
});

describe('Meta lead ads webhook', () => {
  const sign = (secret, raw) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  const body = { object: 'page', entry: [{ id: '111', time: 1760000000, changes: [{ field: 'leadgen', value: { leadgen_id: '444555', page_id: '111', form_id: '9', created_time: 1760000000 } }] }] };

  beforeEach(async () => {
    setAppEnv(true);
    await School.create({ name: 'Oakridge', slug: OAK, status: 'ACTIVE' }).catch(() => {});
    await inOak(() => seedConnection('META', { secrets: { pageTokens: { 111: 'page-token-111' } }, assets: { metaPages: [{ id: '111', name: 'Oakridge' }] }, selected: { metaPageId: '111' } }));
    net.routes.push(['GET', /graph\.facebook\.com\/v21\.0\/444555\?/, json({
      id: '444555', created_time: '2026-10-01T10:00:00+0000', campaign_name: 'ADM27 Lead form',
      field_data: [{ name: 'full_name', values: ['Asha Rao'] }, { name: 'phone_number', values: ['+919812345678'] }, { name: 'which_class', values: ['Class 1'] }],
    })]);
  });

  it('verifies the app-secret signature, fetches the answers with the Page token and creates the enquiry once', async () => {
    const raw = Buffer.from(JSON.stringify(body));
    await expect(inOak(() => connectors.receiveWebhook('META_ADS', raw, 'sha256=00', body))).rejects.toMatchObject({ code: 'BAD_SIGNATURE' });
    const out = await inOak(() => connectors.receiveWebhook('META_ADS', raw, sign('meta-app-secret-for-tests', raw), body));
    expect(out).toMatchObject({ received: 1, fetched: 1, created: 1 });
    expect(net.calls[0].headers.Authorization).toBe('Bearer page-token-111');
    const lead = await inOak(() => Lead.findOne({}).lean());
    expect(lead).toMatchObject({ guardianName: 'Asha Rao', gradeApplying: 'Class 1' });
    // Meta redelivers: recognised by the lead id without asking Graph again.
    const again = await inOak(() => connectors.receiveWebhook('META_ADS', raw, sign('meta-app-secret-for-tests', raw), body));
    expect(again).toMatchObject({ duplicates: 1, created: 0 });
    expect(net.calls).toHaveLength(1);
  });

  it('routes the app-level webhook to the school by Page id', async () => {
    const { publicIntegrationsRouter } = await import('../src/modules/integrations/integrations.routes.js');
    const app = express();
    app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
    app.use('/public/integrations', publicIntegrationsRouter);
    const server = app.listen(0);
    const port = server.address().port;
    const realFetch = globalThis.fetch;
    try {
      // The handler's own Graph call goes through the stub; the test's call to the local server does not.
      const local = (await import('node:http'));
      const post = (payload, sig) => new Promise((resolve) => {
        const req = local.request({ port, path: '/public/integrations/meta/webhook', method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig } }, (res) => {
          let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d || '{}') }));
        });
        req.end(payload);
      });
      const raw = JSON.stringify(body);
      expect((await post(raw, 'sha256=bad')).status).toBe(401);
      const ok = await post(raw, sign('meta-app-secret-for-tests', Buffer.from(raw)));
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({ entries: 1, routed: 1, created: 1 });
      expect(await inOak(() => Lead.countDocuments({}))).toBe(1);
    } finally {
      server.close();
      expect(globalThis.fetch).toBe(realFetch);
    }
  });

  it('without a connected Meta account a bare lead id is reported, not invented', async () => {
    await inOak(() => IntegrationConnection.deleteMany({}));
    const raw = Buffer.from(JSON.stringify(body));
    const out = await inOak(() => connectors.receiveWebhook('META_ADS', raw, sign('meta-app-secret-for-tests', raw), body));
    expect(out).toMatchObject({ received: 1, created: 0, rejected: 1 });
    expect(out.problems[0]).toMatch(/connected Meta Page/);
    expect(net.calls).toHaveLength(0);
  });
});
