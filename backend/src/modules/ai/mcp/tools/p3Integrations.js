import * as connectors from '../../../marketing/connectors.service.js';
import * as newsroomSocial from '../../../social/newsroom-social.service.js';
import { CommunityPost } from '../../../../models/community.model.js';
import { NETWORKS } from '../../../../models/social.model.js';
import { PLATFORM_PROVIDER } from '../../../integrations/providers.js';
import { localDate } from '../../../../utils/periods.js';
import { FEATURES } from '../../../../constants/features.js';
import { featureEnabled } from '../../../../utils/features.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import { RISK, rupees, theNamed } from './_shared.js';

/**
 * Ad-platform and social-network integrations, through the assistant.
 *
 *   sync_ad_data                  "sync ad data now": pulls daily campaign
 *                                 metrics from each connected ad account
 *                                 (confirmed; a re-sync replaces, never doubles)
 *   get_ad_campaign_performance   "how did the Meta campaign do last week"
 *   share_news_to_social          "post this news to Facebook and LinkedIn":
 *                                 a published public newsroom story to the
 *                                 chosen networks (HIGH, confirmed on the
 *                                 website only; consent re-checked; live where
 *                                 the account is connected, SIMULATED otherwise)
 *
 * Each calls the same service the Connectors / newsroom screens call, with the
 * caller's own actor, so permissions, staff-only rules and consent are the
 * REST API's. Connecting or disconnecting an account is not offered here: it
 * needs the provider's own sign-in page in the browser.
 */

const text = (max, description) => ({ type: 'string', maxLength: max, ...(description && { description }) });
const closed = (properties, required = []) => ({ type: 'object', properties, ...(required.length && { required }), additionalProperties: false });
const DATE = '^\\d{4}-\\d{2}-\\d{2}$';
const AD_PLATFORMS = Object.keys(PLATFORM_PROVIDER); // META_ADS, GOOGLE_ADS, GA4, YOUTUBE, LINKEDIN
const LABEL = { META_ADS: 'Meta ads', GOOGLE_ADS: 'Google Ads', GA4: 'Google Analytics', YOUTUBE: 'YouTube ads', LINKEDIN: 'LinkedIn ads' };
const NET = { FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', X: 'X', LINKEDIN: 'LinkedIn', YOUTUBE: 'YouTube' };
const DAY = 86_400_000;

function behind(feature, tool) {
  const { run, prepare } = tool;
  const check = async () => {
    if (!(await featureEnabled(feature))) throw new AppError(`${FEATURES[feature]?.label ?? feature} is switched off for this school.`, 403, [], 'FEATURE_OFF');
  };
  return {
    ...tool, feature,
    async run(ctx, args, prepared) { await check(); return run.call(this, ctx, args, prepared); },
    ...(prepare && { async prepare(ctx, args) { await check(); return prepare.call(this, ctx, args); } }),
  };
}

const ymd = (d) => `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
/** A named period in the school's time zone: last week is the previous Monday to Sunday. */
export function periodOf(name, now = new Date()) {
  const today = localDate(now);
  const t = Date.UTC(today.y, today.m - 1, today.d);
  const at = (ms) => new Date(ms).toISOString().slice(0, 10);
  const monday = t - ((today.dow + 6) % 7) * DAY;
  switch (name) {
    case 'this_week': return { from: at(monday), to: ymd(today) };
    case 'last_7_days': return { from: at(t - 6 * DAY), to: ymd(today) };
    case 'last_30_days': return { from: at(t - 29 * DAY), to: ymd(today) };
    case 'this_month': return { from: `${ymd(today).slice(0, 8)}01`, to: ymd(today) };
    case 'yesterday': return { from: at(t - DAY), to: at(t - DAY) };
    case 'last_week':
    default: return { from: at(monday - 7 * DAY), to: at(monday - DAY) };
  }
}

export const integrationTools = {
  sync_ad_data: {
    module: 'Marketing', operation: 'ACTION', risk: RISK.LOW, confirm: true,
    description: 'Sync ad data now: pull daily campaign spend, impressions, clicks, leads and conversions from the school\'s connected ad accounts (Meta, Google Ads, YouTube, Google Analytics 4, LinkedIn) for a date range (default the last 7 days). Re-syncing replaces those days, never doubles them. A platform that is not connected is reported as such (nothing is fetched; its figures come from CSV imports). Needs confirmation.',
    inputSchema: closed({
      platform: { type: 'string', enum: [...AD_PLATFORMS, 'ALL'], description: 'Default ALL connected platforms' },
      from: { type: 'string', pattern: DATE }, to: { type: 'string', pattern: DATE },
    }),
    permission: 'marketing.manage',
    service: 'connectors.service.sync() → integrations/adsync.service.syncPlatform()',
    summarise: (a) => `Sync ${a.platform && a.platform !== 'ALL' ? LABEL[a.platform] : 'every connected ad platform'} for ${a.from && a.to ? `${a.from} to ${a.to}` : 'the last 7 days'} (existing days are replaced, not doubled)`,
    async run(ctx, args) {
      const list = args.platform && args.platform !== 'ALL' ? [args.platform] : AD_PLATFORMS;
      const range = args.from || args.to ? { from: args.from, to: args.to } : {};
      const results = [];
      for (const p of list) {
        // eslint-disable-next-line no-await-in-loop
        const r = await connectors.sync(ctx.actor, p, range, { trigger: 'ASSISTANT' });
        results.push({ platform: p, label: LABEL[p], mode: r.mode, synced: r.synced, ok: r.ok ?? null, partial: r.partial ?? false, rows: r.rows ?? 0, message: r.message });
      }
      const live = results.filter((r) => r.mode === 'LIVE' && r.ok !== null);
      const speak = live.length
        ? live.map((r) => `${r.label}: ${r.ok ? `${r.rows} rows synced` : r.partial ? `partly synced (${r.rows} rows)` : 'failed'}`).join('; ') + (results.length > live.length ? `. Not connected: ${results.filter((r) => !live.includes(r)).map((r) => r.label).join(', ')}.` : '.')
        : `Nothing was fetched: ${results[0]?.message ?? 'no ad platform is connected.'}`;
      return action({ type: 'ad_data_synced', data: { results }, speak });
    },
  },

  get_ad_campaign_performance: {
    module: 'Marketing', operation: 'GET', risk: RISK.LOW, resultShape: 'SUMMARY',
    description: 'How ad campaigns did over a period ("how did the Meta campaign do last week"): spend, impressions, clicks, platform-reported leads, cost per lead and CTR per platform campaign, from the live sync or imported CSV exports, plus when each platform was last synced. Simulated sample rows are labelled. Read-only.',
    inputSchema: closed({
      platform: { type: 'string', enum: AD_PLATFORMS },
      campaign: text(120, 'Words from the campaign name or its code, e.g. "ADM27" or "open day"'),
      period: { type: 'string', enum: ['last_week', 'this_week', 'yesterday', 'last_7_days', 'last_30_days', 'this_month'], description: 'Default last_week (Monday to Sunday)' },
      from: { type: 'string', pattern: DATE }, to: { type: 'string', pattern: DATE },
    }),
    permission: 'marketing.read',
    service: 'connectors.service.metricsSummary() + listConnectors()',
    async run(ctx, args) {
      const range = args.from && args.to ? { from: args.from, to: args.to } : periodOf(args.period ?? 'last_week');
      const toExclusive = new Date(new Date(`${range.to}T00:00:00Z`).getTime() + DAY).toISOString();
      let rows = await connectors.metricsSummary(ctx.actor, { ...(args.platform && { platform: args.platform }), from: `${range.from}T00:00:00Z`, to: toExclusive });
      if (args.campaign) {
        const words = args.campaign.toLowerCase().split(/\s+/).filter(Boolean);
        rows = rows.filter((r) => words.every((w) => r.campaignName.toLowerCase().includes(w)));
      }
      const status = (await connectors.listConnectors(ctx.actor)).filter((c) => !args.platform || c.platform === args.platform)
        .filter((c) => c.platform !== 'CSV').map((c) => ({ platform: c.platform, mode: c.live?.mode ?? 'SIMULATED', lastSyncAt: c.live?.lastSync?.at ?? null, lastSyncOk: c.live?.lastSync?.ok ?? null, lastImportAt: c.lastImport?.at ?? null }));
      const items = rows.map((r) => ({
        platform: r.platformLabel, campaign: r.campaignName, simulated: r.simulated, spend: rupees(r.spendPaise), impressions: r.impressions, clicks: r.clicks, leads: r.leads,
        costPerLead: r.costPerLeadPaise === null ? null : rupees(r.costPerLeadPaise), ctrPct: r.ctrPct, days: r.days,
      }));
      const real = rows.filter((r) => !r.simulated);
      const spend = real.reduce((s, r) => s + r.spendPaise, 0);
      const leads = real.reduce((s, r) => s + r.leads, 0);
      const speak = !rows.length
        ? `No ad figures${args.campaign ? ` for a campaign matching "${args.campaign}"` : ''} for ${range.from} to ${range.to}. ${status.some((x2) => x2.mode === 'LIVE') ? 'Try syncing ad data now.' : 'No ad account is connected; import the platform\'s CSV export on the Connectors page.'}`
        : `${range.from} to ${range.to}: ${items.slice(0, 4).map((i) => `${i.campaign}${i.simulated ? ' (simulated sample)' : ''} — ${i.spend} spent, ${i.clicks} clicks, ${i.leads} leads${i.costPerLead ? `, ${i.costPerLead} per lead` : ''}`).join('; ')}.${real.length > 1 ? ` Total ${rupees(spend)} for ${leads} leads.` : ''}`;
      return ok({ range, items, totals: { spend: rupees(spend), leads }, connectors: status, note: 'Leads here are what the platform reports; enquiries in the CRM are counted separately in the attribution report.' }, { speak });
    },
  },

  share_news_to_social: behind('socialPublishing', {
    module: 'Social', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true,
    description: "Post a published, public newsroom story to the school's social accounts on the networks the staff member names (\"post this news to Facebook and LinkedIn\"), only at their explicit request. Every pictured child's public consent is checked again first. Each network is posted at most once per story; networks whose account is connected are posted for real, others are recorded as Simulated — not posted; YouTube community posts are not supported by YouTube's API. Confirmed on the website only.",
    inputSchema: closed({
      story: text(160, 'Words from the story title; default the latest published public story'),
      networks: { type: 'array', minItems: 1, maxItems: NETWORKS.length, items: { type: 'string', enum: NETWORKS } },
    }, ['networks']),
    permission: 'social.publish', minScope: 'ALL',
    service: 'newsroom-social.service.shareStory()',
    async prepare(ctx, args) {
      const opts = await newsroomSocial.options(ctx.actor);
      if (!opts.available) throw new AppError(opts.hint ?? 'Sharing to social media is not available to you.', 403, [], 'FORBIDDEN');
      const stories = (await CommunityPost.find({ status: 'PUBLISHED', audience: 'PUBLIC' }).sort({ publishedAt: -1 }).limit(30).select('title body publishedAt').lean())
        .map((p) => ({ id: String(p._id), title: p.title || String(p.body ?? '').slice(0, 60) }));
      if (!stories.length) throw new AppError('There is no published public story to share. Publish it in the newsroom first (audience: Public).', 404, [], 'NOT_FOUND');
      const story = args.story ? await theNamed(stories, args.story, { label: 'story', nameOf: (r) => r.title }) : stories[0];
      const modes = Object.fromEntries((opts.networks ?? []).map((n) => [n.key, n.state]));
      return { storyId: story.id, title: story.title, modes };
    },
    summarise: (a, _actor, p) => `Post the story "${p?.title ?? a.story}" to ${a.networks.map((n) => `${NET[n]}${n === 'YOUTUBE' ? ' (not supported by YouTube)' : p?.modes?.[n] === 'CONNECTED' ? ' (live)' : ' (simulated — not connected)'}`).join(', ')}. Pictured children's consent is checked again first.`,
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const out = await newsroomSocial.shareStory(ctx.actor, plan.storyId, { networks: args.networks });
      const rows = out.networks.filter((r) => args.networks.includes(r.network));
      return action({ type: 'news_shared_to_social', id: plan.storyId, data: { story: plan.title, networks: rows.map((r) => ({ network: r.label, status: r.status, display: r.display, reason: r.reason })) }, speak: `"${plan.title}": ${rows.map((r) => `${r.label} — ${r.display}`).join('; ')}.` });
    },
  }),
};
