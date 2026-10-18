import { NewsletterFeedSource, NewsletterFeedItem } from '../../models/newsletterAi.model.js';
import { Opportunity, OPP_DOMAINS, OPP_LEVELS, OPP_TYPES } from '../../models/newsletter.model.js';
import { InstitutionProfile } from '../../models/institution.model.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { notify } from '../notifications/notification.service.js';
import { requireProfile, assertObjectId, requireText, optionalText, oneOf, dto, profilesWithRoles } from '../ops/common.js';
import { safeFetchText, assertFeedUrl, FetchRefused } from '../digest/safeFetch.js';
import { parseFeed } from '../digest/feedParser.js';
import { allowedDomains, hostAllowed, isEditor } from './opportunities.service.js';
import { TYPE_LABELS, LEVEL_LABELS, DOMAIN_LABELS } from './matching.js';
import { assertGoogleAlertFeedUrl, unwrapGoogleLink, suggestedQueries, GUIDE_STEPS, GUIDE_NOTES, GOOGLE_ALERT_HOSTS } from './ai/googleAlerts.js';
import { readOfficialPage, pageAllowed } from './ai/pageReader.js';
import { extractCandidate } from './ai/extractor.js';
import { findDuplicate } from './ai/dedupe.js';
import { llmOn } from './ai/llm.js';

/**
 * Alert feeds for the newsletter (part 5): Google Alerts through its RSS
 * delivery, and other approved feeds, turned into opportunity candidates.
 *
 *   1. An editor (digest.manage, whole school) adds a feed: for Google Alerts,
 *      the alert's RSS address (https://www.google.com/alerts/feeds/...), with
 *      tags for domain, level and region. Google Alerts has no API; this is its
 *      RSS delivery, read like any approved feed.
 *   2. Every hour the due feeds are read through the SSRF-safe fetcher. Each
 *      item is kept once, by its real article link (Google's redirect is
 *      unwrapped). A failing feed waits 2h, 4h, 8h ... up to a day.
 *   3. New items are checked against what we already have (link or similar
 *      title), the official page is read when its site is on the
 *      official-sites list and robots.txt allows it, and the item becomes a
 *      structured candidate: by the AI provider when one is configured (every
 *      field with the snippet it came from), otherwise by patterns, labelled
 *      "auto-extracted, check before publishing".
 *   4. Candidates wait in the editor's review queue. Nothing is published here.
 *
 * Every step is idempotent: items are unique by link, candidates by item.
 */
const HOUR = 3_600_000;
const MAX_BACKOFF = 24 * HOUR;
const MAX_ATTEMPTS = 3;
export const EXTRACT_PER_RUN = 15;
export const PAGES_PER_RUN = 8;

let fetchOptions = {};
/** Injects `{ resolve, request }` into every feed and page fetch (tests only). */
export function setAlertFetchOptionsForTests(opts) { fetchOptions = opts ?? {}; }

function requireEditor(actor) {
  requireProfile(actor);
  if (!isEditor(actor)) throw new AppError('Only a newsletter editor can manage alert feeds', 403);
}

const listOf = (v, allowed, label) => {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new AppError(`${label} must be a list`, 400);
  const out = [...new Set(v.map((x) => String(x).toUpperCase()))];
  const bad = out.filter((x) => !allowed.includes(x));
  if (bad.length) throw new AppError(`Unknown ${label}: ${bad.join(', ')}`, 400);
  return out;
};

function tagsFrom(body = {}, prev = {}) {
  const t = body.tags ?? {};
  return {
    domains: listOf(t.domains, OPP_DOMAINS, 'domain') ?? prev.domains ?? [],
    level: t.level === undefined ? (prev.level ?? null) : (t.level ? oneOf(t.level, OPP_LEVELS, 'level') : null),
    region: t.region === undefined ? (prev.region ?? null) : (optionalText(t.region, { max: 80 }) || null),
    types: listOf(t.types, OPP_TYPES, 'type') ?? prev.types ?? [],
  };
}

const sourceDto = (s) => {
  const d = dto(s);
  return {
    ...d,
    tagLabels: { domains: (s.tags?.domains ?? []).map((x) => DOMAIN_LABELS[x] ?? x), level: s.tags?.level ? LEVEL_LABELS[s.tags.level] : null, region: s.tags?.region ?? null, types: (s.tags?.types ?? []).map((x) => TYPE_LABELS[x] ?? x) },
    kindLabel: s.kind === 'GOOGLE_ALERT' ? 'Google Alert (RSS delivery)' : 'RSS / Atom feed',
  };
};

// ── the guide ──────────────────────────────────────────────────────────

async function schoolState() {
  try {
    const p = await InstitutionProfile.findOne({}).select('campuses').lean();
    return (p?.campuses ?? []).find((c) => c?.state)?.state ?? null;
  } catch { return null; }
}

/** The "Add a Google Alert" panel: steps, suggested queries per domain and level, and how it works. */
export async function guide() {
  const state = await schoolState();
  return {
    title: 'Add a Google Alert',
    steps: GUIDE_STEPS, notes: GUIDE_NOTES, state,
    suggestions: suggestedQueries({ state }),
    domains: OPP_DOMAINS.map((k) => ({ key: k, label: DOMAIN_LABELS[k] })),
    levels: OPP_LEVELS.map((k) => ({ key: k, label: LEVEL_LABELS[k] })),
    aiExtraction: llmOn() ? 'AI extraction is on: candidates show each detail with the text it came from.' : 'No AI key is set: candidates are auto-extracted with patterns and labelled "check before publishing".',
    urlPattern: 'https://www.google.com/alerts/feeds/<number>/<number>',
  };
}

// ── sources ────────────────────────────────────────────────────────────

export async function listSources(actor) {
  requireEditor(actor);
  const rows = await NewsletterFeedSource.find({}).sort({ createdAt: -1 }).lean();
  return rows.map(sourceDto);
}

export async function addSource(actor, body = {}) {
  requireEditor(actor);
  const kind = oneOf(body.kind, ['GOOGLE_ALERT', 'RSS'], 'kind', 'GOOGLE_ALERT');
  let url;
  try { url = (kind === 'GOOGLE_ALERT' ? assertGoogleAlertFeedUrl(body.url) : assertFeedUrl(body.url)).toString(); } catch (err) {
    if (err instanceof FetchRefused) throw new AppError(err.message, 400, [], err.code);
    throw err;
  }
  if (await NewsletterFeedSource.exists({ url })) throw new AppError('That feed is already on the list', 409, [], 'DUPLICATE_SOURCE');
  const s = await NewsletterFeedSource.create({
    kind, url, title: requireText(body.title, 'title', { max: 120 }), query: optionalText(body.query, { max: 200 }) || null,
    tags: tagsFrom(body), addedByProfileId: actor.profileId, addedByName: actor.displayName ?? null,
  });
  return sourceDto(s.toObject());
}

export async function updateSource(actor, id, body = {}) {
  requireEditor(actor);
  const s = await NewsletterFeedSource.findById(assertObjectId(id));
  if (!s) throw new AppError('Feed not found', 404);
  if (body.title !== undefined) s.title = requireText(body.title, 'title', { max: 120 });
  if (body.query !== undefined) s.query = optionalText(body.query, { max: 200 }) || null;
  if (body.tags !== undefined) s.tags = tagsFrom(body, s.tags?.toObject?.() ?? s.tags ?? {});
  if (body.status !== undefined) {
    s.status = oneOf(body.status, ['APPROVED', 'PAUSED'], 'status');
    if (s.status === 'APPROVED') { s.failures = 0; s.nextFetchAt = null; }
  }
  await s.save();
  return sourceDto(s.toObject());
}

// ── polling ────────────────────────────────────────────────────────────

const backoffMs = (failures) => Math.min(MAX_BACKOFF, HOUR * 2 ** Math.max(0, failures));

/** Reads one feed and stores its new items. Never throws: a failure is recorded on the source with its backoff. */
export async function pollSource(source, { now = new Date() } = {}) {
  const s = source._id ? source : await NewsletterFeedSource.findById(source);
  if (s.sample) return { source: sourceDto(s.toObject()), added: 0, skipped: 'sample feed: never fetched' };
  let added = 0;
  try {
    const checkUrl = s.kind === 'GOOGLE_ALERT'
      ? (u) => { if (!GOOGLE_ALERT_HOSTS.includes(u.hostname.toLowerCase())) throw new FetchRefused('The Google Alerts feed redirected away from google.com', 'BAD_REDIRECT'); }
      : null;
    const { text, url } = await safeFetchText(s.url, { ...fetchOptions, checkUrl });
    const feed = parseFeed(text, { baseUrl: url, summaryMax: 600 });
    for (const item of feed.items) {
      const link = unwrapGoogleLink(item.link);
      if (!link) continue;
      // eslint-disable-next-line no-await-in-loop -- one small upsert per item
      const r = await NewsletterFeedItem.updateOne(
        { link },
        { $setOnInsert: { sourceId: s._id, sourceTitle: s.title, sourceKind: s.kind, link, rawLink: item.link === link ? null : item.link, title: item.title, snippet: item.summary ?? '', publishedAt: item.publishedAt, fetchedAt: now, status: 'NEW' } },
        { upsert: true },
      ).catch((err) => { if (err?.code === 11000) return { upsertedCount: 0 }; throw err; });
      added += r.upsertedCount ?? 0;
    }
    s.lastStatus = 'OK'; s.lastError = null; s.lastItemCount = feed.items.length; s.failures = 0;
    s.nextFetchAt = new Date(now.getTime() + HOUR - 5 * 60_000);
    s.itemsFound = (s.itemsFound ?? 0) + added;
  } catch (err) {
    s.lastStatus = 'FAILED';
    s.lastError = String(err?.message ?? err).slice(0, 300);
    s.failures = (s.failures ?? 0) + 1;
    s.nextFetchAt = new Date(now.getTime() + backoffMs(s.failures));
    logger.warn(`Newsletter feed ${s.url} failed (${s.failures} in a row): ${s.lastError}`);
  }
  s.lastFetchedAt = now;
  await s.save();
  return { source: sourceDto(s.toObject()), added };
}

/** The hourly run: every approved, real feed whose time has come. */
export async function pollFeeds({ now = new Date() } = {}) {
  const due = await NewsletterFeedSource.find({ status: 'APPROVED', sample: { $ne: true }, $or: [{ nextFetchAt: null }, { nextFetchAt: { $lte: now } }] });
  let added = 0; let failed = 0;
  for (const s of due) {
    // eslint-disable-next-line no-await-in-loop -- one outbound request at a time, by design
    const out = await pollSource(s, { now });
    added += out.added;
    if (out.source.lastStatus === 'FAILED') failed += 1;
  }
  return { checked: due.length, failed, added };
}

// ── extraction ─────────────────────────────────────────────────────────

const ymd = (iso) => (iso ? new Date(`${iso}T00:00:00+05:30`) : null);

function opportunityFields(values, source) {
  const tags = source?.tags ?? {};
  const defaults = [];
  const type = values.type ?? tags.types?.[0] ?? (defaults.push('type'), 'COMPETITION');
  const level = values.level ?? tags.level ?? (defaults.push('level'), 'NATIONAL');
  return {
    fields: {
      title: values.title, summary: values.summary ?? '', type, level,
      region: values.region ?? tags.region ?? null,
      domains: values.domains ?? tags.domains ?? [],
      eligibility: { gradeMin: values.gradeMin ?? null, gradeMax: values.gradeMax ?? null, ageMin: values.ageMin ?? null, ageMax: values.ageMax ?? null, streams: values.streams ?? [], note: null },
      registrationOpens: ymd(values.registrationOpens), registrationCloses: ymd(values.registrationCloses), eventDate: ymd(values.eventDate),
      fee: values.fee ?? null, mode: values.mode ?? 'ONLINE', organiser: values.organiser ?? null, howToApply: values.howToApply ?? [],
    },
    defaults,
  };
}

/** The values an editor can change, in a comparable form (for "fields edited before publishing"). */
export function comparable(o) {
  const day = (d) => (d ? new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 10) : null);
  const e = o.eligibility ?? {};
  return {
    title: o.title ?? null, summary: o.summary || null, type: o.type ?? null, level: o.level ?? null, region: o.region ?? null,
    domains: [...(o.domains ?? [])].sort().join(',') || null, gradeMin: e.gradeMin ?? null, gradeMax: e.gradeMax ?? null, ageMin: e.ageMin ?? null, ageMax: e.ageMax ?? null,
    streams: [...(e.streams ?? [])].sort().join(',') || null,
    registrationOpens: day(o.registrationOpens), registrationCloses: day(o.registrationCloses), eventDate: day(o.eventDate),
    fee: o.fee ?? null, mode: o.mode ?? null, officialUrl: o.officialUrl ?? null, organiser: o.organiser ?? null,
    howToApply: (o.howToApply ?? []).join(' | ') || null,
  };
}

async function existingPool() {
  return Opportunity.find({ status: { $ne: 'ARCHIVED' } }).select('title officialUrl source.link status').sort({ createdAt: -1 }).limit(3000).lean();
}

/**
 * Turns one NEW item into a candidate, a duplicate or a skip. `state` carries
 * the run's page budget, the allowlist and the duplicate pool.
 */
async function processItem(item, state, now) {
  const source = state.sources.get(String(item.sourceId)) ?? null;
  const dup = findDuplicate({ title: item.title, link: item.link }, state.pool);
  if (dup) {
    await NewsletterFeedItem.updateOne({ _id: item._id }, { $set: { status: 'DUPLICATE', duplicateOfId: dup.opportunity._id, note: `Already have "${dup.opportunity.title}" (${dup.why})`, processedAt: now } });
    return 'DUPLICATE';
  }
  let page = { fetched: false, note: 'The page was not read' };
  let host = null;
  try { host = new URL(item.link).hostname; } catch { /* checked below */ }
  if (host && pageAllowed(host, state.domains)) {
    if (state.pagesLeft > 0) { state.pagesLeft -= 1; page = await readOfficialPage(item.link, { schoolDomains: state.domains, opts: fetchOptions, now: now.getTime() }); }
    else page = { fetched: false, note: state.pageNote ?? 'Page budget for this run used: only the feed text was used' };
  } else if (host) page = { fetched: false, note: `${host} is not on the official-sites list, so only the feed text was used` };

  const x = await extractCandidate({ title: item.title, snippet: item.snippet, link: item.link, pageText: page.fetched ? page.text : '', tags: source?.tags ?? {}, allowedDomains: state.domains, now });
  if (x.notAnOpportunity || !x.values.title) {
    await NewsletterFeedItem.updateOne({ _id: item._id }, { $set: { status: 'SKIPPED', note: x.method === 'AI' ? 'The AI read it as news, not an opportunity' : 'No opportunity words or dates found', processedAt: now } });
    return 'SKIPPED';
  }
  if (x.values.title !== item.title) {
    const dup2 = findDuplicate({ title: x.values.title, link: x.values.officialUrl ?? null }, state.pool);
    if (dup2) {
      await NewsletterFeedItem.updateOne({ _id: item._id }, { $set: { status: 'DUPLICATE', duplicateOfId: dup2.opportunity._id, note: `Already have "${dup2.opportunity.title}" (${dup2.why})`, processedAt: now } });
      return 'DUPLICATE';
    }
  }
  const { fields, defaults } = opportunityFields(x.values, source);
  // The official link: the extracted one (the item's own link or an allowlisted page), else the item's
  // https link kept for the editor to replace if its site is not on the list.
  let officialUrl = x.values.officialUrl ?? null;
  if (!officialUrl) { try { const u = new URL(item.link); if (u.protocol === 'https:') officialUrl = u.toString(); } catch { /* none */ } }
  const linkAllowed = officialUrl ? hostAllowed(new URL(officialUrl).hostname, state.domains) : false;
  const notes = [x.label];
  if (!linkAllowed) notes.push('The link is not on the official-sites list: replace it with the organiser\'s official page before publishing.');
  if (defaults.length) notes.push(`Not stated in the text, set to a default: ${defaults.join(', ')}.`);
  if (x.values.registrationCloses || x.values.eventDate || x.values.registrationOpens) notes.push('Dates are unconfirmed: check them on the official site, then mark them confirmed.');
  const doc = { ...fields, officialUrl };
  try {
    const o = await Opportunity.create({
      ...doc, audience: 'STUDENTS', datesConfirmed: false, status: 'SUBMITTED',
      source: { kind: 'ALERT', feedItemId: item._id, feedSourceId: item.sourceId, sourceTitle: item.sourceTitle ?? null, link: item.link },
      submittedByName: `${item.sourceKind === 'GOOGLE_ALERT' ? 'Google Alert' : 'Feed'}: ${item.sourceTitle ?? 'alert feed'}`,
      reviewNote: notes.join(' '),
      extraction: {
        method: x.method, label: x.label, model: x.model ?? null, fields: x.fields, dropped: x.dropped,
        original: comparable(doc), page: { fetched: Boolean(page.fetched), url: page.fetched ? (page.url ?? item.link) : null, note: page.note ?? null }, at: now,
      },
      history: [{ action: 'SUBMITTED', note: `Found by an alert feed; ${x.method === 'AI' ? 'AI' : 'auto'}-extracted` }],
    });
    state.pool.unshift({ _id: o._id, title: o.title, officialUrl: o.officialUrl, source: { link: item.link } });
    await NewsletterFeedItem.updateOne({ _id: item._id }, { $set: { status: 'CANDIDATE', opportunityId: o._id, note: null, processedAt: now } });
    return 'CANDIDATE';
  } catch (err) {
    if (err?.code === 11000) {
      // Another run made it first.
      const o = await Opportunity.findOne({ 'source.feedItemId': item._id }).select('_id').lean();
      await NewsletterFeedItem.updateOne({ _id: item._id }, { $set: { status: 'CANDIDATE', opportunityId: o?._id ?? null, processedAt: now } });
      return 'CANDIDATE';
    }
    throw err;
  }
}

/** Processes up to `limit` NEW items (oldest first). Idempotent; a failing item is retried, at most three times. */
export async function extractPending({ now = new Date(), limit = EXTRACT_PER_RUN, pages = PAGES_PER_RUN, pageNote = null } = {}) {
  const state = {
    domains: await allowedDomains(), pool: await existingPool(), pagesLeft: pages, pageNote,
    sources: new Map((await NewsletterFeedSource.find({}).lean()).map((s) => [String(s._id), s])),
  };
  const counts = { CANDIDATE: 0, DUPLICATE: 0, SKIPPED: 0, FAILED: 0 };
  for (let i = 0; i < limit; i += 1) {
    // Claim one item at a time, so two runs never work on the same one.
    // eslint-disable-next-line no-await-in-loop
    const item = await NewsletterFeedItem.findOneAndUpdate({ status: 'NEW', attempts: { $lt: MAX_ATTEMPTS }, $or: [{ processedAt: null }, { processedAt: { $lt: new Date(now.getTime() - 10 * 60_000) } }] }, { $inc: { attempts: 1 }, $set: { processedAt: now } }, { sort: { fetchedAt: 1 }, new: true }).lean();
    if (!item) break;
    try {
      // eslint-disable-next-line no-await-in-loop
      counts[await processItem(item, state, now)] += 1;
    } catch (err) {
      const last = item.attempts >= MAX_ATTEMPTS;
      // eslint-disable-next-line no-await-in-loop
      await NewsletterFeedItem.updateOne({ _id: item._id }, { $set: { status: last ? 'FAILED' : 'NEW', note: String(err?.message ?? err).slice(0, 200) } });
      if (last) counts.FAILED += 1;
      logger.warn(`Newsletter alert item ${item.link} failed: ${err?.message}`);
    }
  }
  if (counts.CANDIDATE) {
    const editors = (await profilesWithRoles(['PRINCIPAL', 'ADMIN'])).map((p) => String(p._id));
    await notify({ recipientProfileIds: editors, type: 'SYSTEM', title: `${counts.CANDIDATE} new opportunit${counts.CANDIDATE === 1 ? 'y' : 'ies'} from alert feeds to review`, body: 'They wait in the newsletter review queue with the text each detail came from.', link: '/newsletter-desk?tab=queue' });
  }
  return { processed: counts.CANDIDATE + counts.DUPLICATE + counts.SKIPPED + counts.FAILED, ...counts, ai: llmOn() };
}

/** Feeds then extraction: the editor's "Check now" and the scheduler's runs. */
export async function runAlerts({ now = new Date() } = {}) {
  const feeds = await pollFeeds({ now });
  const extracted = await extractPending({ now });
  return { feeds, extracted };
}

export async function checkSource(actor, id, { now = new Date() } = {}) {
  requireEditor(actor);
  const s = await NewsletterFeedSource.findById(assertObjectId(id));
  if (!s) throw new AppError('Feed not found', 404);
  if (s.sample) throw new AppError('This is a sample feed with a made-up address; it is never fetched. Add a real Google Alert RSS link to try it.', 400, [], 'SAMPLE_FEED');
  const polled = await pollSource(s, { now });
  const extracted = await extractPending({ now });
  return { ...polled, extracted };
}

// ── the queue and analytics ────────────────────────────────────────────

/** What waits in the review queue, by where it came from, with the newest alert candidates. */
export async function reviewQueue(actor, { limit = 10 } = {}) {
  requireEditor(actor);
  const bySource = await Opportunity.aggregate([{ $match: { status: 'SUBMITTED' } }, { $group: { _id: '$source.kind', n: { $sum: 1 } } }]);
  const counts = Object.fromEntries(bySource.map((r) => [r._id ?? 'STAFF', r.n]));
  const rows = await Opportunity.find({ status: 'SUBMITTED' }).sort({ createdAt: -1 }).limit(Math.min(limit, 50)).lean();
  const waitingItems = await NewsletterFeedItem.countDocuments({ status: 'NEW' });
  return {
    total: Object.values(counts).reduce((a, b) => a + b, 0), bySource: counts, feedItemsWaiting: waitingItems,
    items: rows.map((o) => ({
      id: String(o._id), title: o.title, type: TYPE_LABELS[o.type] ?? o.type, level: LEVEL_LABELS[o.level] ?? o.level, source: o.source?.kind ?? 'STAFF',
      from: o.submittedByName ?? null, extraction: o.extraction?.method ? { method: o.extraction.method, label: o.extraction.label, fields: (o.extraction.fields ?? []).length } : null,
      note: o.reviewNote ?? null, createdAt: o.createdAt,
    })),
  };
}

/** Recent feed items for the panel (what each feed found and what became of it). */
export async function recentItems(actor, query = {}) {
  requireEditor(actor);
  const filter = {};
  if (query.sourceId) filter.sourceId = assertObjectId(query.sourceId, 'sourceId');
  if (query.status) filter.status = oneOf(query.status, ['NEW', 'CANDIDATE', 'DUPLICATE', 'SKIPPED', 'FAILED'], 'status');
  const rows = await NewsletterFeedItem.find(filter).sort({ fetchedAt: -1 }).limit(60).lean();
  return rows.map((i) => ({ id: String(i._id), title: i.title, link: i.link, sourceTitle: i.sourceTitle, status: i.status, note: i.note, opportunityId: i.opportunityId ? String(i.opportunityId) : null, duplicateOfId: i.duplicateOfId ? String(i.duplicateOfId) : null, fetchedAt: i.fetchedAt }));
}

/**
 * Editor analytics: items found per feed, what became of them (candidates,
 * duplicates, skipped; accepted = published, rejected), and extraction
 * accuracy: of the details extracted, how many the editor changed before
 * (or since) publishing.
 */
export async function analytics(actor) {
  requireEditor(actor);
  const sources = await NewsletterFeedSource.find({}).lean();
  const itemCounts = await NewsletterFeedItem.aggregate([{ $group: { _id: { s: '$sourceId', st: '$status' }, n: { $sum: 1 } } }]);
  const opps = await Opportunity.find({ 'source.kind': 'ALERT' }).select('status source.feedSourceId extraction title summary type level region domains eligibility registrationOpens registrationCloses eventDate fee mode officialUrl organiser howToApply').lean();
  const per = new Map(sources.map((s) => [String(s._id), { id: String(s._id), title: s.title, kind: s.kind, sample: Boolean(s.sample), lastStatus: s.lastStatus, found: 0, candidates: 0, duplicates: 0, skipped: 0, failed: 0, waiting: 0, accepted: 0, rejected: 0, pending: 0 }]));
  for (const r of itemCounts) {
    const row = per.get(String(r._id.s));
    if (!row) continue;
    row.found += r.n;
    if (r._id.st === 'CANDIDATE') row.candidates += r.n;
    else if (r._id.st === 'DUPLICATE') row.duplicates += r.n;
    else if (r._id.st === 'SKIPPED') row.skipped += r.n;
    else if (r._id.st === 'FAILED') row.failed += r.n;
    else row.waiting += r.n;
  }
  const fieldTotals = {}; let extracted = 0; let edited = 0;
  const byMethod = { AI: { extracted: 0, edited: 0 }, AUTO: { extracted: 0, edited: 0 } };
  for (const o of opps) {
    const row = per.get(String(o.source?.feedSourceId));
    if (row) {
      if (o.status === 'PUBLISHED') row.accepted += 1;
      else if (o.status === 'REJECTED') row.rejected += 1;
      else if (o.status === 'SUBMITTED') row.pending += 1;
    }
    if (o.status !== 'PUBLISHED' || !o.extraction?.original) continue;
    const current = comparable(o);
    for (const f of (o.extraction.fields ?? []).map((x) => x.field)) {
      const key = f;
      if (!(key in current)) continue;
      const changed = String(current[key] ?? '') !== String(o.extraction.original[key] ?? '');
      fieldTotals[key] = fieldTotals[key] ?? { extracted: 0, edited: 0 };
      fieldTotals[key].extracted += 1; extracted += 1;
      const m = byMethod[o.extraction.method] ?? null;
      if (m) m.extracted += 1;
      if (changed) { fieldTotals[key].edited += 1; edited += 1; if (m) m.edited += 1; }
    }
  }
  const pct = (a, b) => (b ? Math.round(((b - a) / b) * 100) : null);
  return {
    sources: [...per.values()],
    totals: [...per.values()].reduce((t, r) => ({ found: t.found + r.found, candidates: t.candidates + r.candidates, duplicates: t.duplicates + r.duplicates, accepted: t.accepted + r.accepted, rejected: t.rejected + r.rejected }), { found: 0, candidates: 0, duplicates: 0, accepted: 0, rejected: 0 }),
    accuracy: {
      fieldsExtracted: extracted, fieldsEdited: edited, keptAsExtractedPct: pct(edited, extracted),
      byMethod: Object.fromEntries(Object.entries(byMethod).map(([k, v]) => [k, { ...v, keptAsExtractedPct: pct(v.edited, v.extracted) }])),
      byField: Object.entries(fieldTotals).map(([field, v]) => ({ field, ...v, keptAsExtractedPct: pct(v.edited, v.extracted) })).sort((a, b) => b.edited - a.edited),
      note: 'Counts the extracted details of published alert candidates that differ from what was extracted (edits before or after publishing).',
    },
  };
}
