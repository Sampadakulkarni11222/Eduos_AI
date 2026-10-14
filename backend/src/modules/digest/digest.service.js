import { DigestSource, DigestItem, DigestPreference, DigestEdition, INTERESTS } from '../../models/digest.model.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { localDate } from '../../utils/periods.js';
import { sendOperational } from '../messaging/messaging.service.js';
import { requireProfile, assertObjectId, requireText, oneOf, dto } from '../ops/common.js';
import { safeFetchText, assertFeedUrl, FetchRefused } from './safeFetch.js';
import { parseFeed } from './feedParser.js';

/**
 * The daily learning and trends digest.
 *
 * Administrators (digest.manage) approve RSS/Atom feed addresses and tag each
 * with interests. Once a day the scheduler fetches the approved feeds through
 * safeFetch (https only, private networks refused, size and time limits),
 * keeps each item once by its link as plain text, and builds every person's
 * digest from the interests they chose. An email copy goes through the
 * messaging outbox only to people who opted in. This is a reader of approved
 * feeds; it is not connected to any alerts service.
 */
export const INTEREST_LABELS = {
  SCIENCE: 'Science', TECHNOLOGY: 'Technology', SPORTS: 'Sports', CAREERS: 'Careers', EDUCATION_POLICY: 'Education policy',
  ARTS: 'Arts and culture', ENVIRONMENT: 'Environment', MATHEMATICS: 'Mathematics',
};
const ITEMS_PER_DIGEST = 12;
const ITEM_WINDOW_DAYS = 3;
const KEEP_ITEMS_DAYS = 30;

let fetchOptions = {};
/** Injects `{ resolve, request }` into every fetch (tests only). */
export function setFetchOptionsForTests(opts) { fetchOptions = opts ?? {}; }

const dayOf = (now = new Date()) => { const { y, m, d } = localDate(now); return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };

function cleanInterests(list, { min = 0 } = {}) {
  if (!Array.isArray(list)) throw new AppError('interests must be a list', 400);
  const out = [...new Set(list.map((i) => String(i).toUpperCase()))];
  const bad = out.filter((i) => !INTERESTS.includes(i));
  if (bad.length) throw new AppError(`Unknown interest: ${bad.join(', ')}`, 400, [], 'BAD_INTEREST');
  if (out.length < min) throw new AppError('Choose at least one interest', 400, [], 'NO_INTEREST');
  return out;
}

// ── a person's interests and digest ───────────────────────────────────

export async function interests(actor) {
  requireProfile(actor);
  const pref = await DigestPreference.findOne({ profileId: actor.profileId }).lean();
  return {
    interests: INTERESTS.map((key) => ({ key, label: INTEREST_LABELS[key] })),
    mine: { interests: pref?.interests ?? [], emailOptIn: Boolean(pref?.emailOptIn) },
  };
}

export async function setPreferences(actor, body = {}) {
  requireProfile(actor);
  const update = {};
  if ('interests' in body) update.interests = cleanInterests(body.interests);
  if ('emailOptIn' in body) update.emailOptIn = Boolean(body.emailOptIn);
  await DigestPreference.updateOne({ profileId: actor.profileId }, { $set: update, $setOnInsert: { profileId: actor.profileId } }, { upsert: true });
  return interests(actor);
}

async function buildEdition(profileId, chosen, day, now) {
  const since = new Date(now.getTime() - ITEM_WINDOW_DAYS * 86_400_000);
  const rows = chosen.length
    ? await DigestItem.find({ interests: { $in: chosen }, fetchedAt: { $gte: since } }).sort({ publishedAt: -1, fetchedAt: -1 }).limit(ITEMS_PER_DIGEST).lean()
    : [];
  const items = rows.map((i) => ({
    itemId: i._id, title: i.title, link: i.link, summary: i.summary, sourceTitle: i.sourceTitle, publishedAt: i.publishedAt,
    interest: (i.interests ?? []).find((x) => chosen.includes(x)) ?? null,
  }));
  return DigestEdition.findOneAndUpdate(
    { profileId, day },
    { $set: { interests: chosen, items }, $setOnInsert: { profileId, day } },
    { upsert: true, new: true },
  ).lean();
}

const editionDto = (e) => ({
  day: e.day, interests: e.interests ?? [],
  items: (e.items ?? []).map((i) => ({ id: String(i.itemId), title: i.title, link: i.link, summary: i.summary, sourceTitle: i.sourceTitle, publishedAt: i.publishedAt, interest: i.interest, interestLabel: INTEREST_LABELS[i.interest] ?? null })),
});

/** Today's digest for the signed-in person, rebuilt from stored items when their interests changed. */
export async function today(actor, { now = new Date() } = {}) {
  requireProfile(actor);
  const pref = await DigestPreference.findOne({ profileId: actor.profileId }).lean();
  const chosen = pref?.interests ?? [];
  const day = dayOf(now);
  let e = await DigestEdition.findOne({ profileId: actor.profileId, day }).lean();
  if (!e || JSON.stringify([...(e.interests ?? [])].sort()) !== JSON.stringify([...chosen].sort())) e = await buildEdition(actor.profileId, chosen, day, now);
  return { ...editionDto(e), note: chosen.length ? 'Headlines from feeds the school approved, matched to your interests. Links open the original site.' : 'Choose your interests to get a daily digest.' };
}

// ── sources (digest.manage) ───────────────────────────────────────────

const sourceDto = (s) => ({ ...dto(s), interestLabels: (s.interests ?? []).map((i) => INTEREST_LABELS[i]) });

export async function listSources() {
  const rows = await DigestSource.find({}).sort({ createdAt: -1 }).lean();
  return rows.map(sourceDto);
}

export async function addSource(actor, body = {}) {
  requireProfile(actor);
  let url;
  try { url = assertFeedUrl(body.url).toString(); } catch (err) {
    if (err instanceof FetchRefused) throw new AppError(err.message, 400, [], err.code);
    throw err;
  }
  if (await DigestSource.exists({ url })) throw new AppError('That feed is already on the list', 409, [], 'DUPLICATE_SOURCE');
  const s = await DigestSource.create({
    title: requireText(body.title, 'title', { max: 120 }), url, interests: cleanInterests(body.interests ?? [], { min: 1 }),
    approvedByProfileId: actor.profileId, approvedByName: actor.displayName ?? null,
  });
  return sourceDto(s.toObject());
}

export async function updateSource(actor, id, body = {}) {
  const s = await DigestSource.findById(assertObjectId(id));
  if (!s) throw new AppError('Source not found', 404);
  if ('title' in body) s.title = requireText(body.title, 'title', { max: 120 });
  if ('interests' in body) s.interests = cleanInterests(body.interests, { min: 1 });
  if ('status' in body) s.status = oneOf(body.status, ['APPROVED', 'PAUSED'], 'status');
  await s.save();
  return sourceDto(s.toObject());
}

/** Fetches one source and stores its new items. Never throws for a bad feed: the failure is recorded on the source. */
export async function ingestSource(source, opts = {}) {
  const s = source._id ? source : await DigestSource.findById(source);
  let added = 0;
  try {
    const { text, url } = await safeFetchText(s.url, { ...fetchOptions, ...opts });
    const feed = parseFeed(text, { baseUrl: url });
    for (const item of feed.items) {
      // eslint-disable-next-line no-await-in-loop -- one small upsert per item
      const r = await DigestItem.updateOne(
        { link: item.link },
        { $setOnInsert: { sourceId: s._id, sourceTitle: s.title, link: item.link, title: item.title, summary: item.summary, publishedAt: item.publishedAt, fetchedAt: new Date() }, $addToSet: { interests: { $each: s.interests ?? [] } } },
        { upsert: true },
      ).catch((err) => { if (err?.code === 11000) return { upsertedCount: 0 }; throw err; });
      added += r.upsertedCount ?? 0;
    }
    s.lastStatus = 'OK'; s.lastError = null; s.lastItemCount = feed.items.length;
  } catch (err) {
    s.lastStatus = 'FAILED';
    s.lastError = String(err?.message ?? err).slice(0, 300);
    logger.warn(`Digest source ${s.url} failed: ${s.lastError}`);
  }
  s.lastFetchedAt = new Date();
  await s.save();
  return { source: sourceDto(s.toObject()), added };
}

export async function checkSource(actor, id) {
  const s = await DigestSource.findById(assertObjectId(id));
  if (!s) throw new AppError('Source not found', 404);
  return ingestSource(s);
}

/**
 * The daily run: fetch approved sources, then build each person's digest and
 * email those who opted in. Idempotent per person per day.
 */
export async function runDaily({ now = new Date() } = {}) {
  const sources = await DigestSource.find({ status: 'APPROVED' });
  let added = 0; let failed = 0;
  for (const s of sources) {
    // eslint-disable-next-line no-await-in-loop -- one outbound request at a time, by design
    const out = await ingestSource(s);
    added += out.added;
    if (out.source.lastStatus === 'FAILED') failed += 1;
  }
  await DigestItem.deleteMany({ fetchedAt: { $lt: new Date(now.getTime() - KEEP_ITEMS_DAYS * 86_400_000) } });
  const day = dayOf(now);
  const prefs = await DigestPreference.find({ 'interests.0': { $exists: true } }).lean();
  let built = 0; let emailed = 0;
  for (const p of prefs) {
    // eslint-disable-next-line no-await-in-loop
    const e = await buildEdition(p.profileId, p.interests, day, now);
    built += 1;
    if (p.emailOptIn && e.items?.length) {
      // eslint-disable-next-line no-await-in-loop
      const r = await sendOperational({
        templateKey: 'DIGEST_READY', recipientProfileIds: [String(p.profileId)], channels: ['EMAIL'],
        variables: { count: e.items.length, day, top: e.items[0]?.title?.slice(0, 120) ?? '' },
        link: '/digest', idempotencyKey: `digest:${p.profileId}:${day}`, relatedEntityType: 'DigestEdition', relatedEntityId: e._id, now,
      });
      // eslint-disable-next-line no-await-in-loop
      await DigestEdition.updateOne({ _id: e._id }, { $set: { emailStatus: r[0]?.status ?? null } });
      emailed += r.filter((x) => !x.duplicate).length;
    }
  }
  return { sources: sources.length, failed, added, built, emailed };
}
