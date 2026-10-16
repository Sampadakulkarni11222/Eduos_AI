import { MarketingConnector, AdMetric, AdImport } from '../../models/marketingGrowth.model.js';
import { AppError } from '../../utils/AppError.js';
import { localDate } from '../../utils/periods.js';
import { logger } from '../../utils/logger.js';
import { requireProfile } from '../ops/common.js';
import { ProviderError } from './http.js';
import { PLATFORM_PROVIDER, PROVIDERS, appConfigured, notConfiguredMessage } from './providers.js';
import { liveConnection, withTokens, metaPageToken } from './oauth.service.js';
import * as meta from './clients/meta.js';
import * as google from './clients/google.js';
import * as linkedin from './clients/linkedin.js';
import { campaignMatcher, ADAPTERS } from '../marketing/connectors.service.js';

/**
 * Live ad sync: daily campaign metrics pulled from each platform's API into
 * the same AdMetric rows the CSV import fills.
 *
 * Idempotent: a row is one platform + day + campaign, and a sync replaces the
 * rows for the days it covers (a re-sync never doubles; a campaign renamed on
 * the platform drops its old-name rows for those days). The range is fetched
 * in windows of up to seven days, so one failed window is reported while the
 * others are kept (partial failure, never all-or-nothing silence). Rate limits
 * are retried with backoff by http.js.
 *
 * Without the provider app configured, or without a connected account, no
 * request is made: the answer says so and points at the CSV import.
 */

const FAMILY = new Set(['PARENT', 'STUDENT', 'ALUMNUS', 'TRUSTEE']);
const DAY = 86_400_000;
const WINDOW_DAYS = 7;
const MAX_DAYS = 90;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const ymdOf = (at) => { const d = localDate(at); return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; };
const utcDay = (ymd) => new Date(`${ymd}T00:00:00.000Z`);
const plus = (ymd, n) => new Date(utcDay(ymd).getTime() + n * DAY).toISOString().slice(0, 10);

/** The default window: the last `days` local days up to today. */
export function defaultRange(now = new Date(), days = 7) {
  const to = ymdOf(now);
  return { from: plus(to, -(days - 1)), to };
}

function cleanRange({ from, to } = {}, now = new Date()) {
  const def = defaultRange(now);
  const f = from ?? def.from;
  const t = to ?? def.to;
  if (!YMD.test(f) || !YMD.test(t) || Number.isNaN(utcDay(f).getTime()) || Number.isNaN(utcDay(t).getTime())) throw new AppError('from and to must be dates like 2026-10-01', 400, [], 'BAD_DATE');
  if (f > t) throw new AppError('from must be on or before to', 400, [], 'BAD_RANGE');
  if ((utcDay(t) - utcDay(f)) / DAY + 1 > MAX_DAYS) throw new AppError(`At most ${MAX_DAYS} days at a time`, 400, [], 'RANGE_TOO_LONG');
  return { from: f, to: t };
}

function windows({ from, to }) {
  const out = [];
  for (let s = from; s <= to; s = plus(s, WINDOW_DAYS)) {
    const e = plus(s, WINDOW_DAYS - 1);
    out.push({ from: s, to: e < to ? e : to });
  }
  return out;
}

/** What the platform needs selected before it can sync, or null when ready. */
function missingAsset(platform, c) {
  const s = c.selected ?? {};
  if (platform === 'META_ADS' && !s.metaAdAccountId) return 'Choose the Meta ad account to sync.';
  if ((platform === 'GOOGLE_ADS' || platform === 'YOUTUBE') && !s.googleCustomerId) return 'Choose the Google Ads customer account to sync.';
  if (platform === 'GA4' && !s.ga4PropertyId) return 'Choose the Google Analytics 4 property to sync.';
  if (platform === 'LINKEDIN' && !s.linkedinAdAccountId) return 'Choose the LinkedIn ad account to sync.';
  return null;
}

function fetcher(platform, c) {
  const s = c.selected ?? {};
  const provider = PLATFORM_PROVIDER[platform];
  return (range) => withTokens(provider, (t) => {
    if (platform === 'META_ADS') return meta.dailyInsights(t, s.metaAdAccountId, range);
    if (platform === 'GOOGLE_ADS') return google.adsDaily(t, s.googleCustomerId, { ...range, video: false, loginCustomerId: s.googleLoginCustomerId });
    if (platform === 'YOUTUBE') return google.adsDaily(t, s.googleCustomerId, { ...range, video: true, loginCustomerId: s.googleLoginCustomerId });
    if (platform === 'GA4') return google.ga4Daily(t, s.ga4PropertyId, range);
    if (platform === 'LINKEDIN') return linkedin.adsDaily(t, s.linkedinAdAccountId, range);
    throw new AppError('No live sync for this connector', 400);
  });
}

const int = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.round(Number(n)) : 0);

/** Writes one window's rows, replacing whatever the API had stored for those days. */
async function writeWindow(platform, range, rows, match, importId) {
  // Two platform campaigns with the same name on the same day are one row: summed, not overwritten.
  const merged = new Map();
  const problems = [];
  for (const r of rows) {
    if (!YMD.test(String(r.date)) || r.date < range.from || r.date > range.to) { problems.push({ scope: `${range.from}..${range.to}`, problem: `A row dated "${String(r.date).slice(0, 20)}" was outside the range and skipped` }); continue; }
    const name = String(r.campaignName ?? '').trim().slice(0, 200) || 'Unnamed campaign';
    const key = `${r.date}|${name.toLowerCase()}`;
    const m = merged.get(key) ?? { date: r.date, campaignName: name, externalCampaignId: r.externalId ?? null, spendPaise: 0, impressions: 0, clicks: 0, leads: 0, conversions: 0 };
    for (const f of ['spendPaise', 'impressions', 'clicks', 'leads', 'conversions']) m[f] += int(r[f]);
    merged.set(key, m);
  }
  const ops = [...merged.values()].map((m) => ({
    updateOne: {
      filter: { platform, date: utcDay(m.date), campaignKey: m.campaignName.toLowerCase(), simulated: false },
      update: { $set: { campaignName: m.campaignName, campaignId: match(m.campaignName), spendPaise: platform === 'GA4' ? 0 : m.spendPaise, impressions: m.impressions, clicks: m.clicks, leads: m.leads, conversions: m.conversions, source: 'API', externalCampaignId: m.externalCampaignId, importId } },
      upsert: true,
    },
  }));
  // Replace: API rows for these days that the platform no longer reports (renamed or removed) go.
  const keep = [...merged.values()].map((m) => `${m.date}|${m.campaignName.toLowerCase()}`);
  const stale = await AdMetric.find({ platform, simulated: false, source: 'API', date: { $gte: utcDay(range.from), $lte: utcDay(range.to) } }).select('date campaignKey').lean();
  const drop = stale.filter((s) => !keep.includes(`${s.date.toISOString().slice(0, 10)}|${s.campaignKey}`)).map((s) => s._id);
  if (drop.length) await AdMetric.deleteMany({ _id: { $in: drop } });
  if (ops.length) await AdMetric.bulkWrite(ops, { ordered: false });
  return { written: ops.length, removed: drop.length, problems };
}

async function recordStatus(platform, status) {
  await MarketingConnector.updateOne(
    { platform },
    { $set: { lastSync: status, ...(status.ok ? { lastSyncOkAt: status.at } : {}) }, $setOnInsert: { platform, status: 'NOT_CONNECTED' } },
    { upsert: true },
  );
}

/**
 * Pulls daily metrics for one connector over `from`..`to` (default the last
 * seven days). Returns what was written and every problem, per window.
 */
export async function syncPlatform(actor, platformRaw, body = {}, { trigger = 'MANUAL', now = new Date() } = {}) {
  if (!actor?.system) {
    requireProfile(actor);
    if (FAMILY.has(actor.roleKey)) throw new AppError('Marketing connectors are for school staff.', 403, [], 'STAFF_ONLY');
  }
  const platform = String(platformRaw ?? '').toUpperCase();
  if (!ADAPTERS[platform]) throw new AppError('Unknown connector', 400, [], 'BAD_PLATFORM');
  const provider = PLATFORM_PROVIDER[platform];
  const label = ADAPTERS[platform].label;
  if (!provider) return { platform, synced: false, mode: 'CSV_ONLY', message: 'The CSV connector has no live sync. Import the file instead.' };
  if (!appConfigured(provider)) return { platform, synced: false, mode: 'SIMULATED', message: `${notConfiguredMessage(provider)} Meanwhile, import the CSV export.` };
  const c = await liveConnection(provider);
  if (!c) return { platform, synced: false, mode: 'NOT_CONNECTED', message: `${label} is not connected. Connect ${PROVIDERS[provider].label.split(' (')[0]} above, or import the CSV export.` };
  if (!(c.purposes ?? []).includes('ads')) return { platform, synced: false, mode: 'NOT_CONNECTED', message: `${PROVIDERS[provider].label.split(' (')[0]} is connected for social posting only. Connect it again with "Ads reporting" to sync ${label}.` };
  const need = missingAsset(platform, c);
  if (need) return { platform, synced: false, mode: 'LIVE', message: need };
  const range = cleanRange(body, now);

  const fetchWindow = fetcher(platform, c);
  const match = await campaignMatcher();
  const imp = new AdImport({ platform, kind: 'METRICS', fileName: `Live sync ${range.from} to ${range.to}`, byProfileId: actor?.profileId ?? null });
  const problems = [];
  let rows = 0;
  let removed = 0;
  let failedWindows = 0;
  let currencyNote = null;
  for (const w of windows(range)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const got = await fetchWindow(w);
      const cur = got.find((r) => r.currency && r.currency !== 'INR')?.currency;
      if (cur) currencyNote = `Spend is reported in ${cur} by the platform and is stored as reported (not converted to rupees).`;
      // eslint-disable-next-line no-await-in-loop
      const out = await writeWindow(platform, w, got, match, imp._id);
      rows += out.written;
      removed += out.removed;
      problems.push(...out.problems);
    } catch (err) {
      failedWindows += 1;
      const message = err instanceof ProviderError || err instanceof AppError ? err.message : 'Unexpected error';
      problems.push({ scope: `${w.from}..${w.to}`, problem: message });
      if (!(err instanceof ProviderError)) logger.error(`[adsync] ${platform}: ${err?.stack ?? err}`);
      if (err instanceof ProviderError && err.auth) break; // reconnecting is needed; the other windows would fail the same way
    }
  }
  if (currencyNote) problems.push({ scope: 'currency', problem: currencyNote });
  const total = windows(range).length;
  const ok = failedWindows === 0;
  const partial = failedWindows > 0 && failedWindows < total;
  imp.rowsTotal = rows;
  imp.accepted = rows;
  imp.rejected = failedWindows;
  imp.problems = problems.slice(0, 200).map((p) => ({ row: 0, problem: `${p.scope}: ${p.problem}` }));
  await imp.save();
  const message = ok
    ? `Synced ${rows} campaign-day row${rows === 1 ? '' : 's'} from ${label} for ${range.from} to ${range.to}.${removed ? ` ${removed} outdated row${removed === 1 ? '' : 's'} replaced.` : ''}`
    : partial
      ? `Partly synced: ${rows} row${rows === 1 ? '' : 's'} saved; ${failedWindows} of ${total} date window${total === 1 ? '' : 's'} failed (see problems). Sync again to retry; saved days are replaced, not doubled.`
      : `Sync failed: ${problems[0]?.problem ?? 'unknown error'}`;
  await recordStatus(platform, { at: new Date(), ok, partial, from: range.from, to: range.to, rows, trigger, message: message.slice(0, 500), problems: problems.slice(0, 50) });
  return { platform, synced: rows > 0 || ok, mode: 'LIVE', ok, partial, from: range.from, to: range.to, rows, removed, windows: total, failedWindows, problems, message, importId: String(imp._id) };
}

/** The scheduled job: every connected ad platform, the last three days (today's figures settle over time). */
export async function syncAllConnected({ now = new Date() } = {}) {
  const SYSTEM = { system: true, profileId: null, displayName: 'Scheduler', roleKey: 'SYSTEM', permissions: {} };
  const results = [];
  for (const platform of Object.keys(PLATFORM_PROVIDER)) {
    const provider = PLATFORM_PROVIDER[platform];
    if (!appConfigured(provider)) continue;
    // eslint-disable-next-line no-await-in-loop
    const c = await liveConnection(provider);
    if (!c || !(c.purposes ?? []).includes('ads') || missingAsset(platform, c)) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await syncPlatform(SYSTEM, platform, defaultRange(now, 3), { trigger: 'SCHEDULED', now });
      results.push({ platform, ok: r.ok, rows: r.rows, failedWindows: r.failedWindows });
    } catch (err) {
      results.push({ platform, ok: false, error: String(err?.message ?? err).slice(0, 200) });
    }
  }
  return { synced: results.length, results };
}

/**
 * Meta lead ads: the webhook carries only the lead id, so the answers are
 * fetched from Graph with the Page's token. Returns the lead in the shape
 * connectors.ingestLead takes, or null when it cannot be fetched.
 */
export async function fetchMetaLead({ leadgenId, pageId }) {
  if (!appConfigured('META')) return null;
  const c = await liveConnection('META');
  if (!c) return null;
  const page = pageId && /^\d+$/.test(String(pageId)) ? String(pageId) : c.selected?.metaPageId;
  if (!page) return null;
  const token = await metaPageToken(page);
  const d = await meta.fetchLead(token, leadgenId);
  return d;
}
