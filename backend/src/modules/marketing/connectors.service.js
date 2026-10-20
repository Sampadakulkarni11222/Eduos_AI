import crypto from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { MarketingConnector, AdMetric, AdImport, LeadTouch, CONNECTOR_PLATFORMS } from '../../models/marketingGrowth.model.js';
import { Campaign } from '../../models/marketing.model.js';
import { Lead, LeadInteraction } from '../../models/lead.model.js';
import { AppError } from '../../utils/AppError.js';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { logger } from '../../utils/logger.js';
import { createLead } from '../admissions/admission.service.js';
import { requireProfile, pushHistory, oneOf, optionalText } from '../ops/common.js';
import { addTouch, CHANNEL_LABELS } from './growth.service.js';
// Live provider APIs (OAuth connections, ad sync, Meta lead retrieval): modules/integrations.
import { IntegrationConnection } from '../../models/integration.model.js';
import { PLATFORM_PROVIDER, appConfigured as providerAppConfigured } from '../integrations/providers.js';
import { syncPlatform, fetchMetaLead } from '../integrations/adsync.service.js';

/**
 * Ad-platform connectors.
 *
 * A registry of adapters — Meta (Facebook and Instagram) Ads, Google Ads,
 * Google Analytics 4, YouTube, LinkedIn and a generic CSV — each describing the
 * columns of the platform's own report export. Without credentials a
 * connector is "Not connected", and the working path is uploading that export
 * here. Credentials, when saved, are held only through utils/crypto encrypt()
 * and never returned; live API sync is not built in this version, and the
 * adapter says so rather than pretending.
 *
 * Imported rows feed campaign spend (matched to a campaign by its code in the
 * platform campaign name, or by the same name) and lead counts. Leads can also
 * arrive by a lead webhook (Meta lead-ads style), verified with an HMAC of the
 * exact body, and are de-duplicated by phone and email before an enquiry is
 * created. "Simulated sample" loads clearly labelled fictional rows that are
 * never counted as real spend.
 */

// Header synonyms, compared after lower-casing and dropping everything but letters and digits.
const FIELD = {
  campaign: ['campaignname', 'campaign', 'sessioncampaign', 'sessionmanualcampaignname', 'campaigngroupname', 'adcampaign'],
  date: ['day', 'date', 'reportingstarts', 'startdateinutc', 'startdate', 'reportingdate'],
  spend: ['amountspentinr', 'amountspent', 'cost', 'costinr', 'totalspent', 'totalspentinr', 'spend', 'spendinr', 'costconverted'],
  impressions: ['impressions', 'impr', 'views', 'videoviews'],
  clicks: ['linkclicks', 'clicksall', 'clicks', 'sessions'],
  leads: ['leads', 'results', 'conversions', 'keyevents', 'leadsonlinkedin', 'leadformcompletions', 'onfacebookleads', 'allconversions'],
};

export const ADAPTERS = {
  META_ADS: {
    label: 'Meta Ads (Facebook & Instagram)', leadWebhook: true,
    export: 'Ads Manager → Reports → Export table data (.csv), broken down by Day, with Campaign name, Amount spent (INR), Impressions, Link clicks and Leads (or Results).',
    columns: ['Campaign name', 'Day', 'Amount spent (INR)', 'Impressions', 'Link clicks', 'Leads'],
    example: 'Campaign name,Day,Amount spent (INR),Impressions,Link clicks,Leads\nADM27 Open day,2026-10-01,1250.50,40211,612,18',
  },
  GOOGLE_ADS: {
    label: 'Google Ads', leadWebhook: true,
    export: 'Google Ads → Campaigns → Download (.csv) with segment Day: Campaign, Day, Cost, Impr., Clicks, Conversions.',
    columns: ['Campaign', 'Day', 'Cost', 'Impr.', 'Clicks', 'Conversions'],
    example: 'Campaign,Day,Cost,Impr.,Clicks,Conversions\nADM27 Search,2026-10-01,980.00,5120,233,7',
  },
  GA4: {
    label: 'Google Analytics 4 (website)', leadWebhook: false,
    export: 'GA4 → Reports → Acquisition → Traffic acquisition, dimension Session campaign plus Date, Share → Download file (.csv): Session campaign, Date, Sessions, Key events. GA4 has no spend.',
    columns: ['Session campaign', 'Date', 'Sessions', 'Key events'],
    example: 'Session campaign,Date,Sessions,Key events\nADM27,20261001,412,9',
  },
  YOUTUBE: {
    label: 'YouTube (video ads)', leadWebhook: false,
    export: 'Google Ads → Video campaigns → Download (.csv) with segment Day: Campaign, Day, Cost, Impr. (or Views), Clicks, Conversions.',
    columns: ['Campaign', 'Day', 'Cost', 'Views', 'Clicks', 'Conversions'],
    example: 'Campaign,Day,Cost,Views,Clicks,Conversions\nADM27 Campus film,2026-10-01,450.00,9800,120,2',
  },
  LINKEDIN: {
    label: 'LinkedIn Campaign Manager', leadWebhook: true,
    export: 'Campaign Manager → Export → Campaign performance (.csv), time breakdown Daily: Campaign Name, Start Date (in UTC), Total Spent, Impressions, Clicks, Leads.',
    columns: ['Campaign Name', 'Start Date (in UTC)', 'Total Spent', 'Impressions', 'Clicks', 'Leads'],
    example: 'Campaign Name,Start Date (in UTC),Total Spent,Impressions,Clicks,Leads\nADM27 Teachers hiring,2026-10-01,700.00,3000,45,3',
  },
  CSV: {
    label: 'Other source (CSV)', leadWebhook: true,
    export: 'Any spreadsheet saved as .csv with the columns campaign, date, spend, impressions, clicks, leads (spend in rupees).',
    columns: ['campaign', 'date', 'spend', 'impressions', 'clicks', 'leads'],
    example: 'campaign,date,spend,impressions,clicks,leads\nADM27 Newspaper insert,2026-10-01,3000,0,0,12',
  },
};

const FAMILY = new Set(['PARENT', 'STUDENT', 'ALUMNUS', 'TRUSTEE']);
function assertStaff(actor) {
  requireProfile(actor);
  if (FAMILY.has(actor.roleKey)) throw new AppError('Marketing connectors are for school staff.', 403, [], 'STAFF_ONLY');
}
const platformOf = (p) => oneOf(p, CONNECTOR_PLATFORMS, 'platform');

async function connectorFor(platform, { secrets = false } = {}) {
  const q = MarketingConnector.findOne({ platform });
  if (secrets) q.select('+credentialEnc +webhookSecretEnc +webhookVerifyTokenEnc');
  return q;
}

/** The registry with each connector's state, last import and how much simulated sample data it holds. */
export async function listConnectors(actor) {
  assertStaff(actor);
  const [rows, sims, imports, conns] = await Promise.all([
    MarketingConnector.find({}).select('+webhookSecretEnc').lean(),
    AdMetric.aggregate([{ $match: { simulated: true } }, { $group: { _id: '$platform', n: { $sum: 1 } } }]),
    AdImport.find({}).sort({ createdAt: -1 }).limit(50).lean(),
    IntegrationConnection.find({}).select('provider status purposes selected lastError').lean(),
  ]);
  return CONNECTOR_PLATFORMS.map((platform) => {
    const c = rows.find((r) => r.platform === platform);
    const a = ADAPTERS[platform];
    const last = imports.find((i) => i.platform === platform && !i.simulated);
    return {
      platform, label: a.label,
      status: c?.status ?? 'NOT_CONNECTED',
      statusLabel: c?.status === 'CREDENTIALS_SAVED' ? 'Credentials saved — live sync not built; import the CSV export' : 'Not connected — import the CSV export',
      accountLabel: c?.accountLabel ?? null, credentialHint: c?.credentialHint ?? null,
      leadWebhook: a.leadWebhook, webhookConfigured: Boolean(c?.webhookSecretEnc), lastWebhookAt: c?.lastWebhookAt ?? null,
      csv: { how: a.export, columns: a.columns, example: a.example },
      simulatedRows: sims.find((s) => s._id === platform)?.n ?? 0,
      lastImport: last ? { at: last.createdAt, kind: last.kind, accepted: last.accepted, rejected: last.rejected, fileName: last.fileName } : null,
      live: liveState(platform, conns, c),
    };
  });
}

/** The live-API side of a connector: provider app, connection and the last sync. Never a token. */
function liveState(platform, conns, c) {
  const provider = PLATFORM_PROVIDER[platform] ?? null;
  if (!provider) return { provider: null, mode: 'CSV_ONLY', appConfigured: false, connected: false, connectionStatus: null, lastSync: null, lastSyncOkAt: null, lastError: null };
  const conn = conns.find((x) => x.provider === provider);
  const configured = providerAppConfigured(provider);
  const connected = configured && conn?.status === 'CONNECTED' && (conn.purposes ?? []).includes('ads');
  return {
    provider, appConfigured: configured, connected, connectionStatus: conn?.status ?? 'NOT_CONNECTED',
    mode: connected ? 'LIVE' : 'SIMULATED',
    lastSync: c?.lastSync?.at ? c.lastSync : null, lastSyncOkAt: c?.lastSyncOkAt ?? null,
    lastError: conn?.lastError?.message ?? null,
  };
}

/** Saves credentials (encrypted). Nothing is sent to the platform. */
export async function saveCredentials(actor, platform, body = {}) {
  assertStaff(actor);
  const p = platformOf(platform);
  if (p === 'CSV') throw new AppError('The CSV connector needs no credentials.', 400);
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const c = (await connectorFor(p, { secrets: true })) ?? new MarketingConnector({ platform: p });
  c.accountLabel = optionalText(body.accountLabel, { max: 120 }) || c.accountLabel || null;
  if (body.clear === true) {
    c.credentialEnc = null; c.credentialHint = null; c.status = 'NOT_CONNECTED';
    pushHistory(c, actor, 'CREDENTIALS_CLEARED');
  } else {
    if (token.length < 8 || token.length > 4000) throw new AppError('Paste the access token or key the platform issued (8 to 4000 characters).', 400, [], 'BAD_TOKEN');
    c.credentialEnc = encrypt({ token });
    c.credentialHint = `…${token.slice(-4)}`;
    c.status = 'CREDENTIALS_SAVED';
    pushHistory(c, actor, 'CREDENTIALS_SAVED', { note: 'Stored encrypted; not sent anywhere' });
  }
  await c.save();
  return (await listConnectors(actor)).find((x) => x.platform === p);
}

/**
 * The live sync, through the provider API (modules/integrations/adsync.service.js).
 * Without the provider app configured or the school's account connected it
 * fetches nothing and says so, pointing to the CSV export. A pasted token
 * (saveCredentials) is not used for sync: live sync needs the OAuth connection.
 */
export async function sync(actor, platform, body = {}, opts = {}) {
  assertStaff(actor);
  const p = platformOf(platform);
  return syncPlatform(actor, p, body ?? {}, opts);
}

/** Issues a new webhook secret (shown once) and verify token for lead webhooks. */
export async function rotateWebhookSecret(actor, platform) {
  assertStaff(actor);
  const p = platformOf(platform);
  if (!ADAPTERS[p].leadWebhook) throw new AppError(`${ADAPTERS[p].label} does not send leads by webhook.`, 400);
  const c = (await connectorFor(p, { secrets: true })) ?? new MarketingConnector({ platform: p });
  const secret = crypto.randomBytes(32).toString('hex');
  const verifyToken = crypto.randomBytes(16).toString('hex');
  c.webhookSecretEnc = encrypt({ secret });
  c.webhookVerifyTokenEnc = encrypt({ verifyToken });
  pushHistory(c, actor, 'WEBHOOK_SECRET_ROTATED');
  await c.save();
  return {
    platform: p, secret, verifyToken,
    path: `/api/v1/public/marketing/leads/${actor.tenantId}/${p.toLowerCase()}`,
    signature: 'Send header X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the exact request body, keyed with the secret>.',
    note: 'Copy the secret now: it is stored encrypted and is not shown again.',
  };
}

// ── CSV parsing ──────────────────────────────────────────────────────

const norm = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const FORMULA = /^[=+\-@\t\r]/;

/** Text from a spreadsheet cell, with a leading formula character neutralised. */
export function safeText(v, max = 200) {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  let s = String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
  if (FORMULA.test(s)) s = `'${s}`;
  return s;
}

/** A number from a report cell: "1,250.50", "₹ 980", "INR 10", "--" (none). Formulas are refused. */
export function reportNumber(v, { money = false } = {}) {
  const raw = String(v ?? '').trim();
  if (!raw || raw === '--' || raw === '-' || raw === '—') return 0;
  if (/^[=+@]/.test(raw)) return NaN;
  const cleaned = raw.replace(/(INR|Rs\.?|₹|\s|,)/gi, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return NaN;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return NaN;
  if (money) return Math.round(n * 100);
  return Number.isInteger(n) ? n : Math.round(n);
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
/** A report date: 2026-10-01, 20261001, 01/10/2026 (day first), 01-10-2026, "Oct 1, 2026", "1 Oct 2026". UTC midnight. */
export function reportDate(v) {
  const s = String(v ?? '').trim();
  let m;
  const at = (y, mo, d) => {
    const dt = new Date(Date.UTC(y, mo, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo && dt.getUTCDate() === d && y > 2000 && y < 2100 ? dt : null;
  };
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return at(+m[1], +m[2] - 1, +m[3]);
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return at(+m[1], +m[2] - 1, +m[3]);
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) return at(+m[3], +m[2] - 1, +m[1]);
  if ((m = s.match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})$/)) && MONTHS[m[1].toLowerCase()] !== undefined) return at(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  if ((m = s.match(/^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/)) && MONTHS[m[2].toLowerCase()] !== undefined) return at(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}

const MAX_CSV_CHARS = 2 * 1024 * 1024;
const MAX_ROWS = 5000;

function readCsv(text) {
  if (typeof text !== 'string' || !text.trim()) throw new AppError('Paste or upload the CSV file.', 400, [], 'NO_CSV');
  if (text.length > MAX_CSV_CHARS) throw new AppError('The file is larger than 2 MB. Export a shorter date range.', 413, [], 'CSV_TOO_LARGE');
  // Ads Manager and Google Ads exports often open with a title line or two before the header.
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/);
  const headerAt = lines.findIndex((l) => l.split(',').filter((c) => c.trim()).length >= 2 && /campaign|lead|name|phone/i.test(l));
  const body = headerAt > 0 ? lines.slice(headerAt).join('\n') : lines.join('\n');
  let rows;
  try {
    rows = parse(body, { columns: (h) => h.map(norm), skip_empty_lines: true, trim: true, relax_column_count: true, bom: true });
  } catch (err) {
    throw new AppError(`Could not read the CSV: ${err.message}`, 400, [], 'BAD_CSV');
  }
  if (rows.length > MAX_ROWS) throw new AppError(`At most ${MAX_ROWS} rows at a time. Export a shorter date range.`, 400, [], 'TOO_MANY_ROWS');
  return rows;
}

const pick = (row, names) => { for (const n of names) if (row[n] !== undefined && row[n] !== '') return row[n]; return undefined; };
const has = (headers, names) => names.some((n) => headers.includes(n));

/** Matches a platform campaign name to a school campaign: its code inside the name, or the same name. */
export async function campaignMatcher() {
  const camps = await Campaign.find({}).select('name code').lean();
  const byCode = camps.filter((c) => c.code && c.code.length >= 3).sort((a, b) => b.code.length - a.code.length);
  return (name) => {
    const upper = String(name).toUpperCase();
    const hit = byCode.find((c) => upper.includes(c.code)) ?? camps.find((c) => c.name.toLowerCase() === String(name).toLowerCase());
    return hit?._id ?? null;
  };
}

/**
 * Imports a platform's performance export. Every row is validated; bad rows
 * are reported with their line number and skipped. Re-importing the same
 * campaign and day replaces the earlier figures (no double counting).
 */
export async function importMetrics(actor, platform, body = {}, { simulated = false } = {}) {
  assertStaff(actor);
  const p = platformOf(platform);
  const rows = readCsv(body.csv);
  const headers = Object.keys(rows[0] ?? {});
  const missing = [['campaign', FIELD.campaign], ['date', FIELD.date]].filter(([, n]) => !has(headers, n)).map(([k]) => k);
  if (!rows.length) throw new AppError('The file has a header but no rows.', 400, [], 'EMPTY_CSV');
  if (missing.length) throw new AppError(`The file has no ${missing.join(' or ')} column. Expected columns like: ${ADAPTERS[p].columns.join(', ')}.`, 400, [], 'MISSING_COLUMNS');
  if (!['spend', 'impressions', 'clicks', 'leads'].some((k) => has(headers, FIELD[k]))) throw new AppError(`The file has no spend, impressions, clicks or leads column. Expected: ${ADAPTERS[p].columns.join(', ')}.`, 400, [], 'MISSING_COLUMNS');

  const match = await campaignMatcher();
  const imp = new AdImport({ platform: p, kind: 'METRICS', fileName: optionalText(body.fileName, { max: 200 }) || null, rowsTotal: rows.length, simulated, byProfileId: actor.profileId });
  const problems = [];
  const ops = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const name = safeText(pick(r, FIELD.campaign), 200);
    if (!name || /^total/i.test(name)) { if (!/^total/i.test(name)) problems.push({ row: line, problem: 'No campaign name' }); return; }
    const date = reportDate(pick(r, FIELD.date));
    if (!date) { problems.push({ row: line, problem: `"${safeText(pick(r, FIELD.date), 40)}" is not a date` }); return; }
    const spendPaise = p === 'GA4' ? 0 : reportNumber(pick(r, FIELD.spend), { money: true });
    const impressions = reportNumber(pick(r, FIELD.impressions));
    const clicks = reportNumber(pick(r, FIELD.clicks));
    const leads = reportNumber(pick(r, FIELD.leads));
    const bad = [['spend', spendPaise], ['impressions', impressions], ['clicks', clicks], ['leads', leads]].filter(([, v]) => Number.isNaN(v)).map(([k]) => k);
    if (bad.length) { problems.push({ row: line, problem: `${bad.join(', ')} must be a plain number` }); return; }
    const campaignKey = name.toLowerCase();
    ops.push({
      updateOne: {
        filter: { platform: p, date, campaignKey, simulated },
        update: { $set: { campaignName: name, campaignId: match(name), spendPaise, impressions, clicks, leads, importId: imp._id } },
        upsert: true,
      },
    });
  });
  if (ops.length) await AdMetric.bulkWrite(ops, { ordered: false });
  imp.accepted = ops.length;
  imp.rejected = problems.length;
  imp.problems = problems.slice(0, 200);
  await imp.save();
  if (!simulated) await MarketingConnector.updateOne({ platform: p }, { $set: { lastImportAt: new Date() }, $setOnInsert: { platform: p, status: 'NOT_CONNECTED' } }, { upsert: true });
  return { importId: String(imp._id), platform: p, rows: rows.length, accepted: imp.accepted, rejected: imp.rejected, problems: imp.problems, matchedToCampaigns: ops.filter((o) => o.updateOne.update.$set.campaignId).length };
}

/** Loads (on) or removes (off) fictional sample rows, labelled simulated everywhere they appear. */
export async function setSample(actor, platform, on) {
  assertStaff(actor);
  const p = platformOf(platform);
  await AdMetric.deleteMany({ platform: p, simulated: true });
  if (!on) return { platform: p, simulatedRows: 0 };
  const camps = await Campaign.find({}).select('name code').limit(2).lean();
  const names = camps.length ? camps.map((c) => `${c.code} (sample)`) : ['SAMPLE-OPEN-DAY (sample)', 'SAMPLE-SEARCH (sample)'];
  const lines = ['campaign,date,spend,impressions,clicks,leads'];
  const today = new Date();
  for (let d = 29; d >= 0; d -= 1) {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - d)).toISOString().slice(0, 10);
    names.forEach((n, k) => {
      // Deterministic, plainly fictional figures.
      const base = 300 + ((d * 37 + k * 101) % 400);
      lines.push(`${n},${day},${base}.00,${base * 30},${Math.round(base / 3)},${(d + k) % 4}`);
    });
  }
  const r = await importMetrics(actor, p, { csv: lines.join('\n'), fileName: 'simulated-sample.csv' }, { simulated: true });
  return { platform: p, simulatedRows: r.accepted };
}

export async function listImports(actor, query = {}) {
  assertStaff(actor);
  const filter = query.platform ? { platform: platformOf(query.platform) } : {};
  const rows = await AdImport.find(filter).sort({ createdAt: -1 }).limit(50).lean();
  return rows.map((r) => ({ id: String(r._id), platform: r.platform, kind: r.kind, fileName: r.fileName, rows: r.rowsTotal, accepted: r.accepted, rejected: r.rejected, created: r.created, duplicates: r.duplicates, simulated: r.simulated, at: r.createdAt, problems: (r.problems ?? []).slice(0, 20) }));
}

/** Spend and results per platform campaign, for the Connectors page. */
export async function metricsSummary(actor, query = {}) {
  assertStaff(actor);
  const match = {};
  if (query.platform) match.platform = platformOf(query.platform);
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;
  if ((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))) match.date = { ...(from && !Number.isNaN(from.getTime()) ? { $gte: from } : {}), ...(to && !Number.isNaN(to.getTime()) ? { $lt: to } : {}) };
  const rows = await AdMetric.aggregate([
    { $match: match },
    { $group: { _id: { platform: '$platform', campaignName: '$campaignName', simulated: '$simulated' }, campaignId: { $first: '$campaignId' }, spendPaise: { $sum: '$spendPaise' }, impressions: { $sum: '$impressions' }, clicks: { $sum: '$clicks' }, leads: { $sum: '$leads' }, days: { $sum: 1 } } },
    { $sort: { spendPaise: -1 } },
    { $limit: 300 },
  ]);
  return rows.map((r) => ({
    platform: r._id.platform, platformLabel: CHANNEL_LABELS[r._id.platform] ?? r._id.platform, campaignName: r._id.campaignName, simulated: r._id.simulated,
    campaignId: r.campaignId ? String(r.campaignId) : null, spendPaise: r.spendPaise, impressions: r.impressions, clicks: r.clicks, leads: r.leads, days: r.days,
    costPerLeadPaise: r.leads ? Math.round(r.spendPaise / r.leads) : null, ctrPct: r.impressions ? Math.round((r.clicks / r.impressions) * 10000) / 100 : null,
  }));
}

// ── leads: CSV and webhook ───────────────────────────────────────────

const LEAD_FIELD = {
  guardian: ['fullname', 'name', 'parentname', 'guardianname', 'firstname'],
  lastName: ['lastname'],
  child: ['childname', 'studentname', 'childsname', 'whatisyourchildsname'],
  phone: ['phonenumber', 'phone', 'mobile', 'mobilenumber', 'whatsappnumber'],
  email: ['email', 'emailaddress', 'workemail'],
  grade: ['grade', 'class', 'classapplying', 'gradeapplying', 'whichclass'],
  campaign: ['campaignname', 'campaign', 'adname', 'formname'],
  id: ['id', 'leadid', 'leadgenid'],
  created: ['createdtime', 'submittedon', 'date'],
};
const digits10 = (p) => String(p ?? '').replace(/\D/g, '').slice(-10);

/**
 * One lead from a platform. Matches an existing enquiry by phone (last ten
 * digits) or email; a match gets a note and the touch, not a second enquiry.
 * A lead the platform already sent (same external id) is ignored.
 */
export async function ingestLead(platform, lead, { recordedByProfileId = null, via = 'LEAD_WEBHOOK' } = {}) {
  const externalId = lead.externalId ? `${platform}:${String(lead.externalId).slice(0, 120)}` : null;
  if (externalId && (await LeadTouch.exists({ externalId }))) return { outcome: 'ALREADY_RECEIVED' };
  const phone10 = digits10(lead.phone);
  const email = lead.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(lead.email).trim()) ? String(lead.email).trim().toLowerCase() : null;
  if (phone10.length !== 10 && !email) return { outcome: 'REJECTED', problem: 'No usable phone number or email' };
  const or = [];
  if (phone10.length === 10) or.push({ phone: new RegExp(`${phone10}$`) });
  if (email) or.push({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
  const existing = await Lead.findOne({ $or: or }).sort({ createdAt: 1 }).select('_id childName').lean();
  const match = lead.campaignName ? await campaignMatcher() : null;
  const campaignId = match ? match(lead.campaignName) : null;
  const touch = { via, channel: platform === 'CSV' ? 'CSV' : platform, platform, campaignId, externalId, detail: lead.campaignName ? safeText(lead.campaignName, 200) : null, recordedByProfileId };
  if (existing) {
    await addTouch(existing._id, touch);
    await LeadInteraction.create({ leadId: existing._id, type: 'NOTE', body: `Same family came in again through ${ADAPTERS[platform]?.label ?? platform}${lead.campaignName ? ` (${safeText(lead.campaignName, 120)})` : ''}. No second enquiry was created.`, authorProfileId: recordedByProfileId });
    return { outcome: 'DUPLICATE', leadId: String(existing._id) };
  }
  if (phone10.length !== 10) return { outcome: 'REJECTED', problem: 'A new enquiry needs a 10-digit phone number' };
  const guardianName = safeText(lead.guardianName, 120) || 'Parent (from ad lead form)';
  const childName = safeText(lead.childName, 120) || `Child of ${guardianName}`;
  const created = await createLead({
    childName, guardianName, phone: `+91${phone10}`, email, gradeApplying: lead.grade ? safeText(lead.grade, 60) : null,
    source: 'WEB', stage: 'NEW', notes: `From ${ADAPTERS[platform]?.label ?? platform} lead form`, actorProfileId: recordedByProfileId,
  });
  await Lead.updateOne({ _id: created.id }, { $set: { sourceDetail: `${platform.toLowerCase()}-lead-form`, ...(campaignId ? { campaignId } : {}) } });
  await addTouch(created.id, touch);
  return { outcome: 'CREATED', leadId: String(created.id) };
}

export async function importLeads(actor, platform, body = {}) {
  assertStaff(actor);
  const p = platformOf(platform);
  const rows = readCsv(body.csv);
  const headers = Object.keys(rows[0] ?? {});
  if (!has(headers, LEAD_FIELD.phone) && !has(headers, LEAD_FIELD.email)) throw new AppError('The leads file needs a phone_number (or email) column.', 400, [], 'MISSING_COLUMNS');
  const imp = new AdImport({ platform: p, kind: 'LEADS', fileName: optionalText(body.fileName, { max: 200 }) || null, rowsTotal: rows.length, byProfileId: actor.profileId });
  const problems = [];
  for (const [i, r] of rows.entries()) {
    const first = pick(r, LEAD_FIELD.guardian);
    const last = pick(r, LEAD_FIELD.lastName);
    try {
      // eslint-disable-next-line no-await-in-loop
      const out = await ingestLead(p, {
        guardianName: [first, last && !String(first ?? '').includes(last) ? last : null].filter(Boolean).join(' '), childName: pick(r, LEAD_FIELD.child),
        phone: pick(r, LEAD_FIELD.phone), email: pick(r, LEAD_FIELD.email), grade: pick(r, LEAD_FIELD.grade), campaignName: pick(r, LEAD_FIELD.campaign), externalId: pick(r, LEAD_FIELD.id),
      }, { recordedByProfileId: actor.profileId, via: 'LEAD_CSV' });
      if (out.outcome === 'CREATED') imp.created += 1;
      else if (out.outcome === 'DUPLICATE' || out.outcome === 'ALREADY_RECEIVED') imp.duplicates += 1;
      else problems.push({ row: i + 2, problem: out.problem });
    } catch (err) {
      problems.push({ row: i + 2, problem: err instanceof AppError ? err.message : 'Could not be saved' });
    }
  }
  imp.accepted = imp.created + imp.duplicates;
  imp.rejected = problems.length;
  imp.problems = problems.slice(0, 200);
  await imp.save();
  return { importId: String(imp._id), platform: p, rows: rows.length, created: imp.created, duplicates: imp.duplicates, rejected: imp.rejected, problems: imp.problems };
}

/** Verifies `sha256=<hex>` against an HMAC-SHA256 of the raw body, in constant time. */
export function verifySignature(secret, rawBody, header) {
  if (!secret || !rawBody || typeof header !== 'string') return false;
  const m = header.trim().match(/^sha256=([a-f0-9]{64})$/i);
  if (!m) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(m[1], 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** Leads in a webhook body: Meta-style entry[].changes[].value.field_data, or { leads: [...] }. */
export function leadsFromPayload(body) {
  const out = [];
  const fromFields = (fields = []) => {
    const f = {};
    for (const x of Array.isArray(fields) ? fields : []) f[norm(x?.name)] = Array.isArray(x?.values) ? x.values[0] : x?.value;
    return f;
  };
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    for (const ch of Array.isArray(entry?.changes) ? entry.changes : []) {
      const v = ch?.value ?? {};
      const f = fromFields(v.field_data);
      out.push({
        // Real Meta lead-ads webhooks carry only ids: the answers are fetched from Graph (ingestPayload).
        pageId: v.page_id ?? entry?.id ?? null, needsFetch: !Array.isArray(v.field_data) && Boolean(v.leadgen_id),
        externalId: v.leadgen_id ?? v.lead_id ?? null, campaignName: v.campaign_name ?? v.ad_name ?? null, guardianName: pick(f, LEAD_FIELD.guardian), childName: pick(f, LEAD_FIELD.child), phone: pick(f, LEAD_FIELD.phone), email: pick(f, LEAD_FIELD.email), grade: pick(f, LEAD_FIELD.grade) });
    }
  }
  for (const l of Array.isArray(body?.leads) ? body.leads : []) {
    out.push({ externalId: l?.id ?? l?.leadId ?? null, campaignName: l?.campaign ?? l?.campaignName ?? null, guardianName: l?.name ?? l?.guardianName ?? null, childName: l?.childName ?? null, phone: l?.phone ?? null, email: l?.email ?? null, grade: l?.grade ?? null });
  }
  return out.slice(0, 200);
}

/** The public webhook, already inside the school's tenant context. */
export async function receiveWebhook(platform, rawBody, signatureHeader, body) {
  const p = platformOf(platform);
  const c = await connectorFor(p, { secrets: true });
  // Meta signs its own deliveries with the app secret; a school's own sender signs with the school's secret.
  const appSecret = p === 'META_ADS' ? String(process.env.META_APP_SECRET ?? '').trim() : '';
  if (!c?.webhookSecretEnc && !appSecret) throw new AppError('Not found', 404);
  let secret;
  try { secret = c?.webhookSecretEnc ? decrypt(c.webhookSecretEnc)?.secret : null; } catch { secret = null; }
  if (!verifySignature(secret, rawBody, signatureHeader) && !verifySignature(appSecret, rawBody, signatureHeader)) throw new AppError('Signature does not match', 401, [], 'BAD_SIGNATURE');
  const result = await ingestPayload(p, body);
  await MarketingConnector.updateOne({ platform: p }, { $set: { lastWebhookAt: new Date() }, $setOnInsert: { platform: p, status: 'NOT_CONNECTED' } }, { upsert: true });
  return result;
}

/** Answers for a Meta lead given only its id, fetched with the connected Page's token. */
async function withMetaAnswers(l) {
  const d = await fetchMetaLead({ leadgenId: l.externalId, pageId: l.pageId });
  if (!d) return { ...l, problem: 'The lead form answers need a connected Meta Page (Connectors, Meta). The lead id was received.' };
  const f = {};
  for (const x of Array.isArray(d.field_data) ? d.field_data : []) f[norm(x?.name)] = Array.isArray(x?.values) ? x.values[0] : x?.value;
  return { ...l, campaignName: d.campaign_name ?? d.ad_name ?? l.campaignName, guardianName: pick(f, LEAD_FIELD.guardian), childName: pick(f, LEAD_FIELD.child), phone: pick(f, LEAD_FIELD.phone), email: pick(f, LEAD_FIELD.email), grade: pick(f, LEAD_FIELD.grade) };
}

/** Ingests every lead in a verified webhook body (already inside the school's tenant context). */
export async function ingestPayload(p, body) {
  const leads = leadsFromPayload(body);
  const result = { received: leads.length, created: 0, duplicates: 0, rejected: 0, fetched: 0, problems: [] };
  for (let l of leads) {
    try {
      if (l.needsFetch && p === 'META_ADS') {
        // eslint-disable-next-line no-await-in-loop
        if (l.externalId && (await LeadTouch.exists({ externalId: `${p}:${String(l.externalId).slice(0, 120)}` }))) { result.duplicates += 1; continue; }
        // eslint-disable-next-line no-await-in-loop
        l = await withMetaAnswers(l);
        if (l.problem) { result.rejected += 1; result.problems.push(l.problem); continue; }
        result.fetched += 1;
      }
      // eslint-disable-next-line no-await-in-loop
      const out = await ingestLead(p, l);
      if (out.outcome === 'CREATED') result.created += 1; else if (out.outcome === 'REJECTED') result.rejected += 1; else result.duplicates += 1;
    } catch (err) {
      result.rejected += 1;
      logger.warn(`[lead webhook] ${p}: ${err.message}`);
    }
  }
  result.problems = [...new Set(result.problems)].slice(0, 5);
  return result;
}

/** Meta's subscription handshake: echo the challenge when the verify token matches. */
export async function verifyHandshake(platform, query = {}) {
  const p = platformOf(platform);
  const c = await connectorFor(p, { secrets: true });
  const appToken = p === 'META_ADS' ? String(process.env.META_WEBHOOK_VERIFY_TOKEN ?? '').trim() : '';
  if ((!c?.webhookVerifyTokenEnc && !appToken) || query['hub.mode'] !== 'subscribe') return null;
  let token;
  try { token = c?.webhookVerifyTokenEnc ? decrypt(c.webhookVerifyTokenEnc)?.verifyToken : null; } catch { token = null; }
  const given = String(query['hub.verify_token'] ?? '');
  const same = (t) => Boolean(t) && given.length === t.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(t));
  if (!same(token) && !same(appToken)) return null;
  return String(query['hub.challenge'] ?? '').slice(0, 200);
}

