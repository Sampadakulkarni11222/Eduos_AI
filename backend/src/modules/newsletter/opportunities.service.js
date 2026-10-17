import crypto from 'node:crypto';
import {
  Opportunity, NewsletterSetting, NewsletterReader, OpportunitySave, OpportunityQuestion,
  OPP_TYPES, OPP_LEVELS, OPP_DOMAINS, OPP_STREAMS, OPP_MODES, OPP_AUDIENCES,
} from '../../models/newsletter.model.js';
import { DigestItem, DigestPreference } from '../../models/digest.model.js';
import { Student, Enrollment } from '../../models/student.model.js';
import { Section, SubjectOffering } from '../../models/academics.model.js';
import { Club, ClubMembership, House, HouseMembership } from '../../models/club.model.js';
import { PortfolioRating } from '../../models/competencyPortfolio.model.js';
import { ShowcaseEntry } from '../../models/showcase.model.js';
import { AppError } from '../../utils/AppError.js';
import { notify } from '../notifications/notification.service.js';
import { sendOperational } from '../messaging/messaging.service.js';
import { childrenOf, isGuardianOf, teachersOfSection } from '../ptm/relations.js';
import { requireProfile, assertObjectId, pushHistory, requireText, optionalText, oneOf, parseDate, profilesWithRoles } from '../ops/common.js';
import { CATALOGUE, DEFAULT_ALLOWED_DOMAINS, CHECK_NOTE } from './catalogue.js';
import {
  TYPE_LABELS, LEVEL_LABELS, DOMAIN_LABELS, CLUB_DOMAINS, COMPETENCY_DOMAINS, DIGEST_INTEREST_DOMAINS,
  subjectDomains, gradeNumber, streamFromName, ageOn, checkEligibility, scoreFor, reasonText, daysLeft,
} from './matching.js';

/**
 * Opportunities: the structured catalogue behind the newsletter.
 *
 * Rules, all enforced here:
 *   - nothing reaches readers until an editor (digest.manage) publishes it;
 *     staff may add items, which wait in the review queue; the curated
 *     catalogue and items found in approved feeds wait there too;
 *   - an item's official link is https and its host must be on the school's
 *     allowlist (checked on save and again on publishing); a school-level
 *     item may have no link;
 *   - dates are "confirmed" only when an editor checked them on the official
 *     site; otherwise readers see the usual window and "check dates";
 *   - matches: a student sees their own; a parent sees their own children's
 *     only (each child named to them, never to anyone else); a teacher sees
 *     programmes for teachers and items for the classes they teach;
 *   - "Remind me" sends reminders through the messaging outbox (in-app always,
 *     email only for adults who allow email), idempotent per lead day.
 */

const FAMILY = ['PARENT', 'STUDENT', 'ALUMNUS'];
const DAY = 86_400_000;
export const REMIND_LEADS = [7, 3, 1];
export const isEditor = (actor) => actor?.permissions?.['digest.manage'] === 'ALL';
export const isStaff = (actor) => Boolean(actor?.roleKey) && !FAMILY.includes(actor.roleKey);

// ── allowlist ──────────────────────────────────────────────────────────

export async function allowedDomains() {
  const s = await NewsletterSetting.findOne({ key: 'default' }).lean();
  return s?.allowedDomains?.length ? s.allowedDomains : DEFAULT_ALLOWED_DOMAINS;
}

export async function getSettings() {
  return { allowedDomains: await allowedDomains(), defaults: DEFAULT_ALLOWED_DOMAINS };
}

const DOMAIN_RE = /^(?=.{2,190}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
export async function updateSettings(actor, body = {}) {
  if (!Array.isArray(body.allowedDomains)) throw new AppError('allowedDomains must be a list', 400);
  const list = [...new Set(body.allowedDomains.map((d) => String(d).trim().toLowerCase().replace(/^\.+/, '')).filter(Boolean))];
  const bad = list.filter((d) => !DOMAIN_RE.test(d));
  if (bad.length) throw new AppError(`Not a domain: ${bad.join(', ')}`, 400, [], 'BAD_DOMAIN');
  if (list.length > 200) throw new AppError('At most 200 domains', 400);
  await NewsletterSetting.updateOne({ key: 'default' }, { $set: { allowedDomains: list, updatedByName: actor.displayName ?? null }, $setOnInsert: { key: 'default' } }, { upsert: true });
  return getSettings();
}

export function hostAllowed(host, domains) {
  const h = String(host ?? '').toLowerCase().replace(/\.$/, '');
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
}

/** An https official link whose host is on the allowlist; null when blank (callers decide whether that is allowed). */
export async function checkOfficialUrl(value) {
  const raw = optionalText(value, { max: 500 });
  if (!raw) return null;
  let u;
  try { u = new URL(raw); } catch { throw new AppError('The official link must be a full https:// address', 400, [], 'BAD_LINK'); }
  if (u.protocol !== 'https:' || u.username || u.password) throw new AppError('The official link must be a full https:// address', 400, [], 'BAD_LINK');
  if (!hostAllowed(u.hostname, await allowedDomains())) {
    throw new AppError(`${u.hostname} is not on the school's list of official sites. An editor can add it under Settings, or use the organiser's official address.`, 400, [], 'LINK_NOT_ALLOWED');
  }
  return u.toString();
}

// ── presenting ─────────────────────────────────────────────────────────

const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : null);

export function present(o, { now = Date.now(), editor = false } = {}) {
  const left = daysLeft(o, now);
  return {
    id: String(o._id), title: o.title, summary: o.summary, type: o.type, typeLabel: TYPE_LABELS[o.type] ?? o.type,
    level: o.level, levelLabel: LEVEL_LABELS[o.level] ?? o.level, audience: o.audience,
    domains: o.domains ?? [], domainLabels: (o.domains ?? []).map((d) => DOMAIN_LABELS[d] ?? d),
    eligibility: o.eligibility ?? {}, registrationOpens: o.registrationOpens, registrationCloses: o.registrationCloses, eventDate: o.eventDate,
    datesConfirmed: Boolean(o.datesConfirmed), datesCheckedByName: o.datesCheckedByName ?? null, datesCheckedAt: o.datesCheckedAt ?? null,
    typicalWindow: o.typicalWindow ?? null, typicalMonths: o.typicalMonths ?? [],
    dateText: o.datesConfirmed && o.registrationCloses ? `Registration closes ${fmtDay(o.registrationCloses)}` : `${o.typicalWindow ? `${o.typicalWindow} ` : ''}${CHECK_NOTE}`,
    daysLeft: left, closingSoon: left !== null && left <= 14,
    fee: o.fee, mode: o.mode, officialUrl: o.officialUrl, organiser: o.organiser, region: o.region ?? null,
    howToApply: o.howToApply ?? [], pastWinnerNotes: o.pastWinnerNotes ?? null, facts: o.facts ?? [],
    status: o.status, publishedAt: o.publishedAt ?? null,
    source: { kind: o.source?.kind ?? 'STAFF', sourceTitle: o.source?.sourceTitle ?? null },
    ...(editor && {
      submittedByName: o.submittedByName ?? null, reviewedByName: o.reviewedByName ?? null, reviewedAt: o.reviewedAt ?? null, reviewNote: o.reviewNote ?? null,
      clicks: o.clicks ?? 0, history: o.history ?? [], catalogueKey: o.catalogueKey ?? null,
    }),
  };
}

// ── editing ────────────────────────────────────────────────────────────

const intOrNull = (v, label, min, max) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new AppError(`${label} must be a whole number from ${min} to ${max}`, 400);
  return n;
};
const listOf = (v, allowed, label) => {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new AppError(`${label} must be a list`, 400);
  const out = [...new Set(v.map((x) => String(x).toUpperCase()))];
  const bad = out.filter((x) => !allowed.includes(x));
  if (bad.length) throw new AppError(`Unknown ${label}: ${bad.join(', ')}`, 400);
  return out;
};
const textList = (v, label, { max = 300, items = 10 } = {}) => {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new AppError(`${label} must be a list`, 400);
  return v.map((s) => String(s ?? '').trim().slice(0, max)).filter(Boolean).slice(0, items);
};

async function fieldsFrom(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.title !== undefined) out.title = requireText(body.title, 'title', { max: 200 });
  if (body.summary !== undefined) out.summary = optionalText(body.summary, { max: 1500 }) ?? '';
  if (!partial || body.type !== undefined) out.type = oneOf(body.type, OPP_TYPES, 'type');
  if (!partial || body.level !== undefined) out.level = oneOf(body.level, OPP_LEVELS, 'level');
  if (body.audience !== undefined) out.audience = oneOf(body.audience, OPP_AUDIENCES, 'audience', 'STUDENTS');
  const domains = listOf(body.domains, OPP_DOMAINS, 'domain');
  if (domains) out.domains = domains;
  if (body.eligibility !== undefined) {
    const e = body.eligibility ?? {};
    const elig = {
      gradeMin: intOrNull(e.gradeMin, 'gradeMin', 1, 16), gradeMax: intOrNull(e.gradeMax, 'gradeMax', 1, 16),
      ageMin: intOrNull(e.ageMin, 'ageMin', 3, 30), ageMax: intOrNull(e.ageMax, 'ageMax', 3, 30),
      streams: listOf(e.streams ?? [], OPP_STREAMS, 'stream'), note: optionalText(e.note, { max: 400 }) || null,
    };
    if (elig.gradeMin && elig.gradeMax && elig.gradeMin > elig.gradeMax) throw new AppError('gradeMin is above gradeMax', 400);
    if (elig.ageMin && elig.ageMax && elig.ageMin > elig.ageMax) throw new AppError('ageMin is above ageMax', 400);
    out.eligibility = elig;
  }
  const ts = textList(body.teacherSubjects, 'teacherSubjects', { max: 60 });
  if (ts) out.teacherSubjects = ts;
  for (const k of ['registrationOpens', 'registrationCloses', 'eventDate']) if (body[k] !== undefined) out[k] = parseDate(body[k], k);
  if (body.typicalWindow !== undefined) out.typicalWindow = optionalText(body.typicalWindow, { max: 300 }) || null;
  if (body.typicalMonths !== undefined) {
    if (!Array.isArray(body.typicalMonths)) throw new AppError('typicalMonths must be a list', 400);
    out.typicalMonths = [...new Set(body.typicalMonths.map((m) => intOrNull(m, 'month', 1, 12)).filter(Boolean))];
  }
  if (body.fee !== undefined) out.fee = optionalText(body.fee, { max: 200 }) || null;
  if (body.mode !== undefined) out.mode = oneOf(body.mode, OPP_MODES, 'mode', 'ONLINE');
  if (body.officialUrl !== undefined) out.officialUrl = await checkOfficialUrl(body.officialUrl);
  if (body.organiser !== undefined) out.organiser = optionalText(body.organiser, { max: 200 }) || null;
  if (body.region !== undefined) out.region = optionalText(body.region, { max: 80 }) || null;
  const how = textList(body.howToApply, 'howToApply', { max: 400, items: 10 });
  if (how) out.howToApply = how;
  if (body.pastWinnerNotes !== undefined) out.pastWinnerNotes = optionalText(body.pastWinnerNotes, { max: 1000 }) || null;
  if (body.facts !== undefined) {
    if (!Array.isArray(body.facts)) throw new AppError('facts must be a list', 400);
    out.facts = body.facts.slice(0, 6).map((f) => ({ front: requireText(f?.front, 'fact front', { max: 300 }), back: requireText(f?.back, 'fact back', { max: 400 }) }));
  }
  return out;
}

/** Dates may be marked confirmed only by an editor, and only with a closing or event date. */
function applyDateConfirmation(doc, actor, body) {
  if (body.datesConfirmed === undefined) return;
  if (!isEditor(actor)) throw new AppError('Only an editor can confirm dates', 403);
  if (body.datesConfirmed) {
    if (!doc.registrationCloses && !doc.eventDate) throw new AppError('Add the closing date or the event date before confirming dates', 400, [], 'NO_DATES');
    doc.datesConfirmed = true;
    doc.datesCheckedByName = actor.displayName ?? null;
    doc.datesCheckedAt = new Date();
  } else {
    doc.datesConfirmed = false;
  }
}

export async function create(actor, body = {}) {
  requireProfile(actor);
  if (!isStaff(actor) && !isEditor(actor)) throw new AppError('Only school staff can add opportunities', 403, [], 'STAFF_ONLY');
  const fields = await fieldsFrom(body);
  if (!fields.officialUrl && fields.level !== 'SCHOOL') throw new AppError('Add the official https link (only a school-level item may have none)', 400, [], 'LINK_REQUIRED');
  const doc = new Opportunity({
    ...fields, status: 'SUBMITTED', source: { kind: 'STAFF' },
    submittedByProfileId: actor.profileId, submittedByName: actor.displayName ?? null,
  });
  applyDateConfirmation(doc, actor, body);
  pushHistory(doc, actor, 'SUBMITTED');
  await doc.save();
  if (body.publish === true && isEditor(actor)) return review(actor, String(doc._id), { decision: 'PUBLISH' });
  if (!isEditor(actor)) {
    const editors = (await profilesWithRoles(['PRINCIPAL', 'ADMIN'])).map((p) => String(p._id));
    await notify({ recipientProfileIds: editors, type: 'SYSTEM', title: `New opportunity to review: ${doc.title}`.slice(0, 140), body: `${actor.displayName ?? 'A member of staff'} added it to the newsletter review queue.`, link: '/newsletter-desk?tab=queue' });
  }
  return present(doc.toObject(), { editor: true });
}

async function load(id) {
  const o = await Opportunity.findById(assertObjectId(id));
  if (!o) throw new AppError('Opportunity not found', 404);
  return o;
}

export async function update(actor, id, body = {}) {
  requireProfile(actor);
  const o = await load(id);
  const mine = String(o.submittedByProfileId) === String(actor.profileId);
  if (!isEditor(actor) && !(mine && o.status === 'SUBMITTED')) throw new AppError('Only an editor can change this item', 403);
  Object.assign(o, await fieldsFrom(body, { partial: true }));
  if (!o.officialUrl && o.level !== 'SCHOOL') throw new AppError('Add the official https link (only a school-level item may have none)', 400, [], 'LINK_REQUIRED');
  applyDateConfirmation(o, actor, body);
  // A moved date unconfirms itself unless the same edit confirms it again.
  if (body.datesConfirmed === undefined && ['registrationOpens', 'registrationCloses', 'eventDate'].some((k) => body[k] !== undefined)) o.datesConfirmed = false;
  pushHistory(o, actor, 'EDITED');
  await o.save();
  return present(o.toObject(), { editor: isEditor(actor) });
}

/** The editor's one decision on an item: PUBLISH, REJECT (with a reason) or ARCHIVE. */
export async function review(actor, id, body = {}) {
  requireProfile(actor);
  if (!isEditor(actor)) throw new AppError('Only an editor can publish or reject opportunities', 403);
  const o = await load(id);
  const decision = oneOf(body.decision, ['PUBLISH', 'REJECT', 'ARCHIVE'], 'decision');
  const note = optionalText(body.note, { max: 500 }) || null;
  if (decision === 'PUBLISH') {
    // The link is checked again: the allowlist may have changed since it was saved.
    if (o.officialUrl) o.officialUrl = await checkOfficialUrl(o.officialUrl);
    else if (o.level !== 'SCHOOL') throw new AppError('Add the official https link before publishing', 400, [], 'LINK_REQUIRED');
    if (!o.summary) throw new AppError('Add a short summary before publishing', 400, [], 'SUMMARY_REQUIRED');
    o.status = 'PUBLISHED'; o.publishedAt = o.publishedAt ?? new Date();
  } else if (decision === 'REJECT') {
    if (!note) throw new AppError('Say why it is rejected', 400, [], 'REASON_REQUIRED');
    o.status = 'REJECTED';
  } else o.status = 'ARCHIVED';
  o.reviewedByProfileId = actor.profileId; o.reviewedByName = actor.displayName ?? null; o.reviewedAt = new Date(); o.reviewNote = note;
  pushHistory(o, actor, decision, { note });
  await o.save();
  if (o.submittedByProfileId && String(o.submittedByProfileId) !== String(actor.profileId) && decision !== 'ARCHIVE') {
    await notify({ recipientProfileIds: [String(o.submittedByProfileId)], type: 'SYSTEM', title: `${o.title}: ${decision === 'PUBLISH' ? 'published' : 'not published'}`.slice(0, 140), body: note ?? '', link: '/opportunities' });
  }
  return present(o.toObject(), { editor: true });
}

/** Adds the curated catalogue's entries the school does not have yet (as SUBMITTED, for review). */
export async function importCatalogue(actor) {
  if (actor && !isEditor(actor)) throw new AppError('Only an editor can import the catalogue', 403);
  let added = 0;
  for (const c of CATALOGUE) {
    const { key, ...rest } = c;
    // eslint-disable-next-line no-await-in-loop -- a few dozen upserts, once
    const r = await Opportunity.updateOne(
      { catalogueKey: key },
      { $setOnInsert: { ...rest, audience: rest.audience ?? 'STUDENTS', catalogueKey: key, datesConfirmed: false, status: 'SUBMITTED', source: { kind: 'CATALOGUE' }, submittedByName: 'EduOS starter list', history: [{ action: 'SUBMITTED', note: 'From the curated starter list' }] } },
      { upsert: true },
    ).catch((err) => { if (err?.code === 11000) return { upsertedCount: 0 }; throw err; });
    added += r.upsertedCount ?? 0;
  }
  return { added, total: CATALOGUE.length };
}

const FEED_HINTS = [
  [/olympiad/i, 'OLYMPIAD'], [/hackathon/i, 'HACKATHON'], [/scholarship|fellowship/i, 'SCHOLARSHIP'], [/science fair|exhibition/i, 'SCIENCE_FAIR'],
  [/entrance|admit card|\bexam\b|\bjee\b|\bneet\b|\bcuet\b/i, 'ENTRANCE_EXAM'], [/internship|research programme|summer school/i, 'RESEARCH_PROGRAMME'],
  [/innovation|challenge|ideathon/i, 'INNOVATION_CHALLENGE'], [/debate|model un|\bmun\b|parliament/i, 'MUN_DEBATE'],
  [/essay|painting|poetry|art contest|writing/i, 'ARTS_CONTEST'], [/trial|selection camp|tournament/i, 'SPORTS_TRIAL'],
  [/scheme|yojana/i, 'GOVT_SCHEME'], [/competition|contest|quiz|registration open/i, 'COMPETITION'],
];
const INTEREST_TO_DOMAIN = (interests = []) => [...new Set(interests.flatMap((i) => DIGEST_INTEREST_DOMAINS[i] ?? []))];

/**
 * Items from the admin-approved digest feeds that look like opportunities
 * become candidates in the review queue. Their text is the feed's plain text
 * (already stripped by the digest); nothing in it is followed or run. A link
 * whose host is not on the allowlist is kept but must be fixed before publishing.
 */
export async function scanFeeds({ now = new Date(), sinceDays = 14 } = {}) {
  const rows = await DigestItem.find({ fetchedAt: { $gte: new Date(now.getTime() - sinceDays * DAY) } }).sort({ fetchedAt: -1 }).limit(300).lean();
  const domains = await allowedDomains();
  let added = 0;
  for (const item of rows) {
    const text = `${item.title} ${item.summary ?? ''}`;
    const hit = FEED_HINTS.find(([re]) => re.test(text));
    if (!hit) continue;
    let link = null; let allowed = false;
    try { const u = new URL(item.link); if (u.protocol === 'https:') { link = u.toString(); allowed = hostAllowed(u.hostname, domains); } } catch { /* not a usable link */ }
    // eslint-disable-next-line no-await-in-loop
    const r = await Opportunity.updateOne(
      { 'source.digestItemId': item._id },
      { $setOnInsert: {
        title: String(item.title).slice(0, 200), summary: String(item.summary ?? '').slice(0, 1500), type: hit[1], level: 'NATIONAL',
        domains: INTEREST_TO_DOMAIN(item.interests), officialUrl: link, datesConfirmed: false, status: 'SUBMITTED',
        source: { kind: 'FEED', digestItemId: item._id, sourceTitle: item.sourceTitle ?? null }, submittedByName: `Feed: ${item.sourceTitle ?? 'approved source'}`,
        reviewNote: allowed ? null : 'The feed\'s link is not on the official-sites list: replace it with the organiser\'s official page before publishing.',
        history: [{ action: 'SUBMITTED', note: 'Found in an approved feed' }],
      } },
      { upsert: true },
    ).catch((err) => { if (err?.code === 11000) return { upsertedCount: 0 }; throw err; });
    added += r.upsertedCount ?? 0;
  }
  return { scanned: rows.length, added };
}

// ── reading the catalogue ──────────────────────────────────────────────

export async function list(actor, query = {}) {
  requireProfile(actor);
  const editor = isEditor(actor);
  const filter = {};
  if (editor && query.status) filter.status = oneOf(query.status, ['SUBMITTED', 'PUBLISHED', 'REJECTED', 'ARCHIVED'], 'status');
  else if (!editor) filter.status = 'PUBLISHED';
  if (query.type) filter.type = oneOf(query.type, OPP_TYPES, 'type');
  if (query.level) filter.level = oneOf(query.level, OPP_LEVELS, 'level');
  if (query.domain) filter.domains = oneOf(query.domain, OPP_DOMAINS, 'domain');
  if (query.audience) filter.audience = { $in: [oneOf(query.audience, OPP_AUDIENCES, 'audience'), 'BOTH'] };
  if (query.q) filter.title = { $regex: String(query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 80), $options: 'i' };
  const rows = await Opportunity.find(filter).sort({ status: 1, registrationCloses: 1, publishedAt: -1, createdAt: -1 }).limit(Math.min(Number(query.limit) || 200, 300)).lean();
  const now = Date.now();
  return { items: rows.map((o) => present(o, { now, editor })), counts: editor ? await statusCounts() : undefined };
}

async function statusCounts() {
  const rows = await Opportunity.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map((r) => [r._id, r.n]));
}

export async function get(actor, id) {
  requireProfile(actor);
  const o = await load(id);
  if (o.status !== 'PUBLISHED' && !isEditor(actor) && String(o.submittedByProfileId) !== String(actor.profileId)) throw new AppError('Opportunity not found', 404);
  return present(o.toObject(), { editor: isEditor(actor) });
}

/** "This month's map": published items by level and by region (state, all-India, international). */
export async function map(actor, { now = new Date() } = {}) {
  requireProfile(actor);
  const month = new Date(now.getTime() + 330 * 60_000).getUTCMonth() + 1;
  const rows = await Opportunity.find({ status: 'PUBLISHED' }).lean();
  const thisMonth = rows.filter((o) => (o.typicalMonths ?? []).includes(month)
    || (o.datesConfirmed && [o.registrationCloses, o.eventDate].some((d) => d && new Date(new Date(d).getTime() + 330 * 60_000).getUTCMonth() + 1 === month)));
  const byLevel = Object.fromEntries(OPP_LEVELS.map((l) => [l, 0]));
  const byRegion = {};
  for (const o of thisMonth) {
    byLevel[o.level] += 1;
    const region = o.region ?? (o.level === 'INTERNATIONAL' ? 'International' : o.level === 'SCHOOL' ? 'In school' : 'All India');
    byRegion[region] = (byRegion[region] ?? 0) + 1;
  }
  return { month, total: thisMonth.length, byLevel, byRegion: Object.entries(byRegion).map(([region, count]) => ({ region, count })).sort((a, b) => b.count - a.count), items: thisMonth.slice(0, 40).map((o) => ({ id: String(o._id), title: o.title, level: o.level, region: o.region ?? null })) };
}

// ── readers: preferences and contexts ──────────────────────────────────

export async function readerFor(profileId) {
  let r = await NewsletterReader.findOne({ profileId }).lean();
  if (!r) {
    try {
      r = (await NewsletterReader.create({ profileId, unsubscribeToken: crypto.randomBytes(24).toString('hex') })).toObject();
    } catch (err) {
      if (err?.code !== 11000) throw err;
      r = await NewsletterReader.findOne({ profileId }).lean();
    }
  }
  return r;
}

const prefDto = (r, actor) => ({
  weekly: r.weekly, monthly: r.monthly, email: r.email, emailAllowed: actor.roleKey !== 'STUDENT', domains: r.domains ?? [], stream: r.stream ?? null,
  cpdInterests: r.cpdInterests ?? [], leaderboardOptIn: Boolean(r.leaderboardOptIn), language: r.language ?? 'en', textSize: r.textSize ?? 'M',
  unsubscribed: Boolean(r.unsubscribedAt), streak: r.streak ?? { count: 0, best: 0, lastDay: null },
  options: { domains: OPP_DOMAINS.map((k) => ({ key: k, label: DOMAIN_LABELS[k] })), streams: OPP_STREAMS },
});

export async function myPreferences(actor) {
  requireProfile(actor);
  return prefDto(await readerFor(actor.profileId), actor);
}

export async function setPreferences(actor, body = {}) {
  requireProfile(actor);
  await readerFor(actor.profileId);
  const set = {};
  for (const k of ['weekly', 'monthly', 'leaderboardOptIn']) if (typeof body[k] === 'boolean') set[k] = body[k];
  if (typeof body.email === 'boolean') {
    // Children read the newsletter in the app only.
    if (body.email && actor.roleKey === 'STUDENT') throw new AppError('Students read the newsletter in EduOS; email copies go to parents and staff.', 403, [], 'NO_EMAIL_FOR_STUDENTS');
    set.email = body.email;
    if (body.email) set.unsubscribedAt = null;
  }
  const domains = listOf(body.domains, OPP_DOMAINS, 'domain');
  if (domains) set.domains = domains;
  if (body.stream !== undefined) set.stream = body.stream ? oneOf(body.stream, OPP_STREAMS, 'stream') : null;
  const cpd = textList(body.cpdInterests, 'cpdInterests', { max: 60, items: 10 });
  if (cpd) set.cpdInterests = cpd;
  if (body.language !== undefined) set.language = oneOf(String(body.language).toUpperCase(), ['EN', 'HI'], 'language').toLowerCase();
  if (body.textSize !== undefined) set.textSize = oneOf(body.textSize, ['S', 'M', 'L'], 'textSize');
  const r = await NewsletterReader.findOneAndUpdate({ profileId: actor.profileId }, { $set: set }, { new: true }).lean();
  return prefDto(r, actor);
}

/** One-click unsubscribe from the email copy (public link with the reader's token). */
export async function unsubscribeByToken(token) {
  const t = String(token ?? '');
  if (!/^[a-f0-9]{48}$/.test(t)) throw new AppError('This unsubscribe link is not valid.', 400, [], 'BAD_TOKEN');
  const r = await NewsletterReader.findOneAndUpdate({ unsubscribeToken: t }, { $set: { email: false, unsubscribedAt: new Date() } }, { new: true }).lean();
  if (!r) throw new AppError('This unsubscribe link is not valid.', 404, [], 'BAD_TOKEN');
  return { unsubscribed: true, message: 'You will no longer receive the newsletter by email. You can still read it in EduOS, and turn the email back on there.' };
}

async function studentContext(studentId, { name = null, readerDomains = [] } = {}) {
  const student = await Student.findOne({ _id: studentId, deletedAt: null }).select('firstName lastName dob profileId').lean();
  if (!student) return null;
  const e = await Enrollment.findOne({ studentId, status: 'ACTIVE' }).sort({ createdAt: -1 }).select('sectionId').lean();
  const section = e ? await Section.findById(e.sectionId).populate('gradeId', 'name').select('name gradeId').lean() : null;
  const gradeName = section?.gradeId?.name ?? null;
  const own = student.profileId ? await NewsletterReader.findOne({ profileId: student.profileId }).lean() : null;
  const digest = student.profileId ? await DigestPreference.findOne({ profileId: student.profileId }).lean() : null;
  const domains = new Set([...(own?.domains ?? []), ...readerDomains, ...INTEREST_TO_DOMAIN(digest?.interests ?? [])]);
  const memberships = await ClubMembership.find({ studentId, status: 'ACTIVE' }).select('clubId').lean();
  const clubs = memberships.length ? await Club.find({ _id: { $in: memberships.map((m) => m.clubId) } }).select('name activity category').lean() : [];
  const ratings = await PortfolioRating.find({ studentId, level: { $in: ['PROFICIENT', 'ADVANCED'] } }).sort({ level: 1, ratedAt: -1 }).lean();
  const strengths = [...new Map(ratings.map((r) => [r.competencyKey, { key: r.competencyKey, domains: COMPETENCY_DOMAINS[r.competencyKey] ?? [] }])).values()];
  const entries = await ShowcaseEntry.find({ studentId, status: 'PUBLISHED' }).select('category').lean();
  const pastTypes = new Set(entries.map((x) => ({ OLYMPIAD: 'OLYMPIAD', SPORTS: 'SPORTS_TRIAL', ARTS: 'ARTS_CONTEST', ACADEMIC: 'COMPETITION' }[x.category])).filter(Boolean));
  const hm = await HouseMembership.findOne({ studentId }).select('houseId').lean();
  const house = hm ? await House.findById(hm.houseId).select('name').lean() : null;
  return {
    kind: 'STUDENT', studentId: String(studentId), name, firstName: student.firstName,
    grade: gradeNumber(gradeName), gradeName, sectionLabel: section ? `${gradeName ?? ''} ${section.name}`.trim() : null, sectionId: section ? String(section._id) : null,
    age: ageOn(student.dob), stream: own?.stream ?? streamFromName(`${gradeName ?? ''} ${section?.name ?? ''}`),
    domains, clubs: clubs.map((c) => ({ name: c.name, domains: [...new Set([...(CLUB_DOMAINS[c.activity] ?? []), ...(CLUB_DOMAINS[c.category] ?? [])])] })),
    strengths, pastTypes, houseName: house?.name ?? null,
  };
}

async function teacherContext(actor, reader) {
  const offerings = await SubjectOffering.find({ teacherId: actor.profileId }).populate('subjectId', 'name').populate({ path: 'sectionId', select: 'gradeId', populate: { path: 'gradeId', select: 'name' } }).lean();
  const subjects = [...new Map(offerings.filter((o) => o.subjectId?.name).map((o) => [o.subjectId.name, { name: o.subjectId.name, domains: subjectDomains(o.subjectId.name) }])).values()];
  const gradesTaught = new Set(offerings.map((o) => gradeNumber(o.sectionId?.gradeId?.name)).filter(Boolean));
  return { kind: 'TEACHER', subjects, gradesTaught, cpdInterests: reader?.cpdInterests ?? [] };
}

/** Who this reader is matching for: themselves (student, teacher) or each of their own children (parent). */
export async function contextsFor(actor) {
  const reader = await readerFor(actor.profileId);
  if (actor.roleKey === 'STUDENT') {
    const s = await Student.findOne({ profileId: actor.profileId, deletedAt: null }).select('_id').lean();
    const ctx = s ? await studentContext(s._id, { readerDomains: reader.domains ?? [] }) : null;
    return ctx ? [ctx] : [];
  }
  if (actor.roleKey === 'PARENT') {
    const kids = await childrenOf(actor.profileId);
    const out = [];
    for (const k of kids) {
      // eslint-disable-next-line no-await-in-loop
      const ctx = await studentContext(k.studentId, { name: k.name.split(' ')[0], readerDomains: reader.domains ?? [] });
      if (ctx) out.push(ctx);
    }
    return out;
  }
  if (isStaff(actor)) return [await teacherContext(actor, reader)];
  return [];
}

/** For a parent naming one child: refuses anyone who is not their own child. */
async function assertOwnChild(actor, studentId) {
  if (!studentId) return null;
  const id = assertObjectId(studentId, 'studentId');
  if (actor.roleKey !== 'PARENT' || !(await isGuardianOf(actor.profileId, id))) throw new AppError('You can only see matches for your own children.', 403, [], 'NOT_YOUR_CHILD');
  return id;
}

/** "For you": the best published matches per context, with the reason for each. */
export async function matches(actor, query = {}, { now = new Date(), limit = 8 } = {}) {
  requireProfile(actor);
  const only = await assertOwnChild(actor, query.studentId);
  let contexts = await contextsFor(actor);
  if (only) contexts = contexts.filter((c) => c.studentId === String(only));
  const month = query.month ? intOrNull(query.month, 'month', 1, 12) : null;
  const rows = await Opportunity.find({ status: 'PUBLISHED' }).lean();
  const t = now.getTime();
  return {
    contexts: contexts.map((ctx) => {
      const scored = rows
        .filter((o) => !month || (o.typicalMonths ?? []).includes(month) || (o.datesConfirmed && o.registrationCloses && new Date(new Date(o.registrationCloses).getTime() + 330 * 60_000).getUTCMonth() + 1 === month))
        .map((o) => ({ o, s: scoreFor(o, ctx, { now: t }) }))
        .filter((x) => x.s.score > 1)
        .sort((a, b) => b.s.score - a.s.score || (daysLeft(a.o, t) ?? 999) - (daysLeft(b.o, t) ?? 999))
        .slice(0, limit);
      return {
        kind: ctx.kind, studentId: ctx.studentId ?? null, name: ctx.name ?? null, className: ctx.sectionLabel ?? null,
        items: scored.map(({ o, s }) => ({ ...present(o, { now: t }), reason: reasonText(s.reasons), forStudents: Boolean(s.forStudents), eligibility: s.eligibility?.verdict ?? null })),
      };
    }),
  };
}

/** "Can I enter?" — for the reader, their named child, or a class / age / stream they type. */
export async function eligibility(actor, id, query = {}) {
  requireProfile(actor);
  const o = await load(id);
  if (o.status !== 'PUBLISHED' && !isEditor(actor)) throw new AppError('Opportunity not found', 404);
  const manual = query.grade !== undefined || query.age !== undefined || query.stream !== undefined;
  if (manual) {
    const who = { grade: intOrNull(query.grade, 'grade', 1, 16), age: intOrNull(query.age, 'age', 3, 30), stream: query.stream ? oneOf(query.stream, OPP_STREAMS, 'stream') : null };
    return { opportunity: o.title, for: 'the details you entered', ...checkEligibility(o, who) };
  }
  const only = await assertOwnChild(actor, query.studentId);
  let contexts = await contextsFor(actor);
  if (only) contexts = contexts.filter((c) => c.studentId === String(only));
  if (!contexts.length) return { opportunity: o.title, for: null, verdict: 'CHECK', reasons: ['Enter a class, age or stream to check.'] };
  return {
    opportunity: o.title,
    results: contexts.map((c) => ({
      for: c.kind === 'TEACHER' ? 'you' : (c.name ?? 'you'), studentId: c.studentId ?? null,
      ...checkEligibility(o, c.kind === 'TEACHER' ? { isTeacher: true } : { grade: c.grade, age: c.age, stream: c.stream }),
    })),
  };
}

// ── saves and reminders ────────────────────────────────────────────────

export async function save(actor, id, body = {}) {
  requireProfile(actor);
  const o = await load(id);
  if (o.status !== 'PUBLISHED') throw new AppError('Opportunity not found', 404);
  const studentId = await assertOwnChild(actor, body.studentId);
  const set = { remind: body.remind === undefined ? true : Boolean(body.remind) };
  if (body.note !== undefined) set.note = optionalText(body.note, { max: 300 }) || null;
  const s = await OpportunitySave.findOneAndUpdate(
    { profileId: actor.profileId, opportunityId: o._id, studentId: studentId ?? null },
    { $set: set, $setOnInsert: { profileId: actor.profileId, opportunityId: o._id, studentId: studentId ?? null } },
    { upsert: true, new: true },
  ).lean();
  const left = daysLeft(o);
  return {
    id: String(s._id), saved: true, remind: s.remind,
    reminder: s.remind ? (left !== null ? `We will remind you ${REMIND_LEADS.filter((l) => l < left).map((l) => `${l} day${l > 1 ? 's' : ''}`).join(', ') || 'before'} before it closes (${fmtDay(o.registrationCloses)}).` : `Dates are not confirmed yet: we will remind you when ${o.typicalMonths?.length ? 'its usual month comes round' : 'the school confirms the dates'}.`) : null,
  };
}

export async function unsave(actor, id, query = {}) {
  requireProfile(actor);
  const studentId = await assertOwnChild(actor, query.studentId);
  const r = await OpportunitySave.deleteOne({ profileId: actor.profileId, opportunityId: assertObjectId(id), studentId: studentId ?? null });
  return { removed: r.deletedCount > 0 };
}

export async function saved(actor) {
  requireProfile(actor);
  const rows = await OpportunitySave.find({ profileId: actor.profileId }).sort({ createdAt: -1 }).lean();
  const opps = await Opportunity.find({ _id: { $in: rows.map((r) => r.opportunityId) } }).lean();
  const byId = new Map(opps.map((o) => [String(o._id), o]));
  const kids = actor.roleKey === 'PARENT' ? new Map((await childrenOf(actor.profileId)).map((k) => [k.studentId, k.name.split(' ')[0]])) : new Map();
  const now = Date.now();
  return rows.filter((r) => byId.has(String(r.opportunityId))).map((r) => ({
    saveId: String(r._id), remind: r.remind, note: r.note, studentId: r.studentId ? String(r.studentId) : null, forName: r.studentId ? kids.get(String(r.studentId)) ?? null : null,
    opportunity: present(byId.get(String(r.opportunityId)), { now }),
  })).sort((a, b) => (a.opportunity.daysLeft ?? 999) - (b.opportunity.daysLeft ?? 999));
}

/**
 * Deadline reminders for saved items, through the outbox: 7, 3 and 1 day(s)
 * before a confirmed closing date (a late start sends only the nearest one),
 * or once in an unconfirmed item's usual month. Idempotent per save and lead.
 */
export async function runReminders({ now = new Date() } = {}) {
  const saves = await OpportunitySave.find({ remind: true }).limit(5000);
  const opps = await Opportunity.find({ _id: { $in: [...new Set(saves.map((s) => String(s.opportunityId)))] }, status: 'PUBLISHED' }).lean();
  const byId = new Map(opps.map((o) => [String(o._id), o]));
  const month = new Date(now.getTime() + 330 * 60_000).getUTCMonth() + 1;
  const year = new Date(now.getTime() + 330 * 60_000).getUTCFullYear();
  let sent = 0;
  for (const s of saves) {
    const o = byId.get(String(s.opportunityId));
    if (!o) continue;
    const done = new Set((s.remindersSent ?? []).map((r) => r.lead));
    let lead = null; let variables = null;
    const left = daysLeft(o, now.getTime());
    if (left !== null) {
      lead = [...REMIND_LEADS].sort((a, b) => a - b).find((l) => left <= l && !done.has(l)) ?? null;
      if (lead !== null) variables = { title: o.title.slice(0, 120), when: `closes in ${left} day${left === 1 ? '' : 's'} (${fmtDay(o.registrationCloses)})` };
    } else if (!o.datesConfirmed && (o.typicalMonths ?? []).includes(month)) {
      const key = year * 100 + month; // once per usual month
      if (!done.has(key)) { lead = key; variables = { title: o.title.slice(0, 120), when: 'usually opens around now: check the official site for this year\'s dates' }; }
    }
    if (lead === null) continue;
    // eslint-disable-next-line no-await-in-loop
    await sendOperational({
      templateKey: 'OPPORTUNITY_REMINDER', recipientProfileIds: [String(s.profileId)], channels: ['EMAIL'], variables,
      link: '/opportunities?tab=saved', idempotencyKey: `opp-save:${s._id}:lead:${lead}`, relatedEntityType: 'Opportunity', relatedEntityId: o._id, now,
    });
    // Every lead already passed counts as sent, so a late "Remind me" does not fire a backlog.
    if (left !== null) for (const l of REMIND_LEADS) { if (left <= l && !done.has(l)) s.remindersSent.push({ lead: l, at: now }); }
    else s.remindersSent.push({ lead, at: now });
    // eslint-disable-next-line no-await-in-loop
    await s.save();
    sent += 1;
  }
  return { checked: saves.length, sent };
}

/** "Add to calendar": an .ics event for a confirmed date, or a reminder to check the dates. */
export async function calendar(actor, id) {
  requireProfile(actor);
  const o = await load(id);
  if (o.status !== 'PUBLISHED') throw new AppError('Opportunity not found', 404);
  const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n').slice(0, 900);
  const ymd = (d) => new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 10).replace(/-/g, '');
  const confirmed = o.datesConfirmed && (o.registrationCloses || o.eventDate);
  const day = confirmed ? (o.registrationCloses ?? o.eventDate) : new Date(Date.now() + 7 * DAY);
  const next = new Date(new Date(day).getTime() + DAY);
  const summary = confirmed ? `${o.title}: ${o.registrationCloses ? 'registration closes' : 'event'}` : `Check the dates: ${o.title}`;
  const description = `${o.summary}\n${confirmed ? '' : 'Dates are not confirmed: check them on the official site.\n'}${o.officialUrl ?? ''}`;
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EduOS//Newsletter//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:opp-${o._id}@eduos`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;VALUE=DATE:${ymd(day)}`, `DTEND;VALUE=DATE:${ymd(next)}`, `SUMMARY:${esc(summary)}`, `DESCRIPTION:${esc(description)}`,
    ...(o.officialUrl ? [`URL:${esc(o.officialUrl)}`] : []), 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  return { filename: `${o.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60) || 'opportunity'}.ics`, ics, confirmed: Boolean(confirmed) };
}

/** Counts a reader opening the official link (from the edition or the feed). */
export async function click(actor, id) {
  requireProfile(actor);
  const o = await Opportunity.findOneAndUpdate({ _id: assertObjectId(id), status: 'PUBLISHED' }, { $inc: { clicks: 1 } }, { new: true }).lean();
  if (!o) throw new AppError('Opportunity not found', 404);
  return { officialUrl: o.officialUrl };
}

// ── "Ask a teacher" ────────────────────────────────────────────────────

export async function ask(actor, id, body = {}) {
  requireProfile(actor);
  if (!['STUDENT', 'PARENT'].includes(actor.roleKey)) throw new AppError('Students and parents ask teachers here; staff can talk to colleagues directly.', 403);
  const o = await load(id);
  if (o.status !== 'PUBLISHED') throw new AppError('Opportunity not found', 404);
  const text = requireText(body.text, 'question', { max: 600 });
  let ctx;
  if (actor.roleKey === 'PARENT') {
    const kids = await contextsFor(actor);
    const sid = body.studentId ? await assertOwnChild(actor, body.studentId) : (kids.length === 1 ? kids[0].studentId : null);
    if (!sid) throw new AppError('Which child is this about?', 400, [], 'CHILD_REQUIRED');
    ctx = kids.find((k) => k.studentId === String(sid));
  } else ctx = (await contextsFor(actor))[0];
  if (!ctx?.sectionId) throw new AppError('We could not find the class, so there is no teacher to ask.', 404);
  const teachers = await teachersOfSection(ctx.sectionId, { includePrincipal: false });
  const domains = new Set(o.domains ?? []);
  const to = teachers.filter((t) => t.roles.includes('CLASS_TEACHER') || t.subjects.some((s) => subjectDomains(s).some((d) => domains.has(d))));
  if (!to.length) throw new AppError('No teacher is assigned to this class yet.', 404, [], 'NO_TEACHER');
  const q = await OpportunityQuestion.create({
    opportunityId: o._id, askerProfileId: actor.profileId, askerRole: actor.roleKey, studentId: ctx.studentId, sectionId: ctx.sectionId, text, toProfileIds: to.map((t) => t.profileId),
  });
  await notify({ recipientProfileIds: to.map((t) => t.profileId), type: 'SYSTEM', title: `Question about ${o.title}`.slice(0, 140), body: `A ${actor.roleKey === 'PARENT' ? 'parent' : 'student'} in ${ctx.sectionLabel} asked about this opportunity.`, link: '/opportunities?tab=questions' });
  return { id: String(q._id), sentTo: to.map((t) => t.name), status: 'OPEN' };
}

export async function questions(actor) {
  requireProfile(actor);
  const filter = isStaff(actor) ? { toProfileIds: actor.profileId } : { askerProfileId: actor.profileId };
  const rows = await OpportunityQuestion.find(filter).sort({ status: 1, createdAt: -1 }).limit(100).lean();
  const opps = new Map((await Opportunity.find({ _id: { $in: rows.map((r) => r.opportunityId) } }).select('title').lean()).map((o) => [String(o._id), o.title]));
  const sectionIds = [...new Set(rows.map((r) => String(r.sectionId)).filter((x) => x !== 'null'))];
  const sections = new Map((await Section.find({ _id: { $in: sectionIds } }).populate('gradeId', 'name').select('name gradeId').lean()).map((s) => [String(s._id), `${s.gradeId?.name ?? ''} ${s.name}`.trim()]));
  return rows.map((r) => ({
    id: String(r._id), opportunityId: String(r.opportunityId), opportunity: opps.get(String(r.opportunityId)) ?? null, text: r.text,
    from: r.askerRole === 'PARENT' ? `A parent in ${sections.get(String(r.sectionId)) ?? 'your class'}` : `A student in ${sections.get(String(r.sectionId)) ?? 'your class'}`,
    status: r.status, answer: r.answer, answeredByName: r.answeredByName, answeredAt: r.answeredAt, createdAt: r.createdAt,
  }));
}

export async function answer(actor, qid, body = {}) {
  requireProfile(actor);
  const q = await OpportunityQuestion.findById(assertObjectId(qid));
  if (!q || !q.toProfileIds.map(String).includes(String(actor.profileId))) throw new AppError('Question not found', 404);
  q.answer = requireText(body.answer, 'answer', { max: 1500 });
  q.answeredByProfileId = actor.profileId; q.answeredByName = actor.displayName ?? null; q.answeredAt = new Date(); q.status = 'ANSWERED';
  await q.save();
  await notify({ recipientProfileIds: [String(q.askerProfileId)], type: 'SYSTEM', title: 'Your question about an opportunity was answered', body: q.answer.slice(0, 200), link: '/opportunities?tab=questions' });
  return { id: String(q._id), status: q.status };
}

