import {
  Opportunity, NewsletterReader, OpportunitySave, NewsletterEdition, NewsletterRead, FlashcardReview, NewsletterComment, NewsletterReaction, REACTIONS,
} from '../../models/newsletter.model.js';
import { ShowcaseEntry } from '../../models/showcase.model.js';
import { Student } from '../../models/student.model.js';
import { Profile } from '../../models/profile.model.js';
import { School } from '../../models/school.model.js';
import { AppError } from '../../utils/AppError.js';
import { env } from '../../config/env.js';
import { localDate } from '../../utils/periods.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { notify } from '../notifications/notification.service.js';
import { sendOperational } from '../messaging/messaging.service.js';
import { consentedIds } from '../showcase/showcase.service.js';
import { requireProfile, assertObjectId, pushHistory, requireText, optionalText, oneOf, profilesWithRoles } from '../ops/common.js';
import { HOOKS } from './catalogue.js';
import { TYPE_LABELS, LEVEL_LABELS, daysLeft } from './matching.js';
import { renderEditionEmail } from './emailHtml.js';
import * as opps from './opportunities.service.js';

/**
 * Weekly and monthly newsletter editions.
 *
 *   - The scheduler drafts one weekly and one monthly edition per period
 *     (idempotent: the period is a unique key), from published opportunities
 *     only. An editor (digest.manage) reviews it and publishes it with one
 *     press; nothing is sent before that.
 *   - Publishing delivers it in the app to every reader who keeps that
 *     cadence on, and by email (through the messaging outbox) to adults who
 *     turned the email on and have not unsubscribed. Without an email
 *     provider the outbox records SIMULATED: nothing is claimed as sent.
 *   - Every reader gets the shared core (hook, items, flashcards, quiz, poll,
 *     school spotlight) plus their own layer: matches with reasons (a parent:
 *     their own children only), deadlines from what they saved, their progress,
 *     flashcard boxes and streak.
 *   - Interaction is safe for children: no public profiles and no messages
 *     between readers; comments are short and moderated (a student's always by
 *     staff) and shown without a child's name; the class / house quiz board is
 *     opt-in, shows only group averages, and hides groups smaller than three.
 */

const DAY = 86_400_000;
const MIN_GROUP = 3;
const LEITNER_DAYS = [1, 3, 7, 14, 30];
const PORTAL_OF = {
  PARENT: 'parent', STUDENT: 'student', TEACHER: 'teacher', PRINCIPAL: 'principal', ADMIN: 'admin', FINANCE: 'finance', LIBRARIAN: 'librarian',
  WARDEN: 'warden', HR: 'hr', MARKETING: 'marketing', COMPLIANCE: 'compliance', TRUSTEE: 'trustee', ALUMNUS: 'alumnus', NURSE: 'nurse',
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ── periods ────────────────────────────────────────────────────────────

/** ISO week of a calendar date (y, m, d). */
function isoWeek(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dow + 3);
  const year = date.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((date - jan4) / DAY - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return { year, week };
}

/** The school-local week and month an instant falls in. */
export function periodOf(cadence, now = new Date()) {
  const { y, m, d } = localDate(now);
  if (cadence === 'MONTHLY') return { key: `${y}-${String(m).padStart(2, '0')}`, label: `${MONTHS[m - 1]} ${y}`, month: m };
  const { year, week } = isoWeek(y, m, d);
  const today = new Date(Date.UTC(y, m - 1, d));
  const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * DAY);
  const sunday = new Date(monday.getTime() + 6 * DAY);
  const short = (x) => `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()].slice(0, 3)}`;
  return { key: `${year}-W${String(week).padStart(2, '0')}`, label: `${short(monday)} to ${short(sunday)} ${sunday.getUTCFullYear()}`, month: m };
}

const seedOf = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
function shuffled(list, seed) {
  const a = [...list];
  let x = seed || 1;
  for (let i = a.length - 1; i > 0; i -= 1) {
    x = (x * 1103515245 + 12345) >>> 0;
    const j = x % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── building an edition ────────────────────────────────────────────────

async function pickItems(cadence, now) {
  const t = now.getTime();
  const { month } = periodOf(cadence, now);
  const nextMonth = (month % 12) + 1;
  const horizon = (cadence === 'MONTHLY' ? 60 : 30) * DAY;
  const rows = await Opportunity.find({ status: 'PUBLISHED' }).lean();
  const ranked = rows
    .filter((o) => !(o.datesConfirmed && o.registrationCloses && new Date(o.registrationCloses).getTime() < t))
    .map((o) => {
      let rank = 0;
      const closes = o.datesConfirmed && o.registrationCloses ? new Date(o.registrationCloses).getTime() : null;
      if (closes && closes - t <= horizon) rank += 5 - Math.min(4, Math.floor((closes - t) / (7 * DAY)));
      if ((o.typicalMonths ?? []).includes(month)) rank += 3;
      if ((o.typicalMonths ?? []).includes(nextMonth)) rank += 2;
      if (o.publishedAt && t - new Date(o.publishedAt).getTime() < 14 * DAY) rank += 1;
      return { o, rank };
    })
    .filter((x) => x.rank > 0 || cadence === 'MONTHLY')
    .sort((a, b) => b.rank - a.rank || String(a.o.title).localeCompare(b.o.title));
  // Variety: at most three of one type.
  const perType = {};
  const out = [];
  for (const { o } of ranked) {
    if ((perType[o.type] ?? 0) >= 3) continue;
    perType[o.type] = (perType[o.type] ?? 0) + 1;
    out.push(o);
    if (out.length >= (cadence === 'MONTHLY' ? 12 : 8)) break;
  }
  return out;
}

function buildHook(items, periodKey) {
  const count = {};
  for (const o of items) for (const d of o.domains ?? []) if (HOOKS[d]) count[d] = (count[d] ?? 0) + 1;
  const domain = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'SCIENCE';
  const list = HOOKS[domain];
  const h = list[seedOf(periodKey) % list.length];
  return { text: h.text, question: h.question, textHi: h.textHi ?? null };
}

const firstSentence = (s, max = 220) => { const t = String(s ?? '').split(/(?<=[.!?])\s/)[0]; return t.length > max ? `${t.slice(0, max - 1)}…` : t; };

function buildFlashcards(items) {
  const cards = [];
  for (const o of items) {
    cards.push({ key: `o-${o._id}`, front: `What is "${o.title}"?`, back: firstSentence(o.summary), domain: o.domains?.[0] ?? null, opportunityId: o._id });
    (o.facts ?? []).forEach((f, i) => cards.push({ key: `f-${o._id}-${i}`, front: f.front, back: f.back, domain: o.domains?.[0] ?? null, opportunityId: o._id }));
  }
  return cards.slice(0, 12);
}

function buildQuiz(items, periodKey) {
  const seed = seedOf(periodKey);
  const pool = shuffled(items, seed);
  const quiz = [];
  const used = new Set();
  const withOptions = (key, question, right, wrongs, explain) => {
    const options = shuffled([right, ...[...new Set(wrongs.filter((w) => w && w !== right))].slice(0, 3)], seed + quiz.length);
    if (options.length < 3) return false;
    quiz.push({ key, question, options, answerIndex: options.indexOf(right), explain });
    return true;
  };
  // 1. What kind of opportunity is it?
  const a = pool.find((o) => !used.has(String(o._id)));
  if (a) {
    used.add(String(a._id));
    const otherTypes = shuffled(Object.keys(TYPE_LABELS).filter((t) => t !== a.type && t !== 'TEACHER_PROGRAMME'), seed).map((t) => TYPE_LABELS[t]);
    withOptions('q1', `What kind of opportunity is "${a.title}"?`, TYPE_LABELS[a.type], otherTypes, `It is ${TYPE_LABELS[a.type].toLowerCase() === 'olympiad' ? 'an olympiad' : `a ${TYPE_LABELS[a.type].toLowerCase()}`}: ${firstSentence(a.summary, 160)}`);
  }
  // 2. Who runs it?
  const b = pool.find((o) => !used.has(String(o._id)) && o.organiser);
  if (b) {
    const others = pool.filter((o) => o.organiser && o.organiser !== b.organiser).map((o) => o.organiser);
    if (withOptions('q2', `Who runs "${b.title}"?`, b.organiser, others, `${b.organiser} runs it.`)) used.add(String(b._id));
  }
  // 3. A fact from the items, else the level.
  const c = pool.find((o) => !used.has(String(o._id)) && o.facts?.length);
  if (c) {
    const f = c.facts[0];
    const others = items.flatMap((o) => (o.facts ?? []).map((x) => x.back)).filter((x) => x !== f.back);
    if (withOptions('q3', f.front, f.back, others, `${f.back} (from "${c.title}")`)) used.add(String(c._id));
  }
  for (const o of pool) {
    if (quiz.length >= 3) break;
    if (used.has(String(o._id))) continue;
    used.add(String(o._id));
    withOptions(`q${quiz.length + 1}`, `At what level is "${o.title}" held?`, LEVEL_LABELS[o.level], Object.values(LEVEL_LABELS), `It is a ${LEVEL_LABELS[o.level].toLowerCase()}-level opportunity.`);
  }
  return quiz.slice(0, 3).map((q, i) => ({ ...q, key: `q${i + 1}` }));
}

function buildPoll(items) {
  const teamy = ['INNOVATION_CHALLENGE', 'HACKATHON', 'SCIENCE_FAIR', 'COMPETITION', 'MUN_DEBATE', 'OLYMPIAD'];
  const pick = [...items.filter((o) => o.audience !== 'TEACHERS' && teamy.includes(o.type)), ...items.filter((o) => o.audience !== 'TEACHERS' && !teamy.includes(o.type))].slice(0, 3);
  if (pick.length < 2) return { question: null, options: [] };
  return { question: 'Which challenge should our school enter?', options: pick.map((o) => ({ key: String(o._id), label: o.title })) };
}

async function contentFor(cadence, now) {
  const p = periodOf(cadence, now);
  const items = await pickItems(cadence, now);
  const spotlight = await ShowcaseEntry.find({ status: 'PUBLISHED', publishedAt: { $gte: new Date(now.getTime() - 90 * DAY) } }).sort({ publishedAt: -1 }).limit(4).select('_id').lean();
  return {
    title: cadence === 'MONTHLY' ? `Opportunities for ${p.label}` : `This week's opportunities`,
    periodLabel: p.label,
    hook: buildHook(items, p.key),
    intro: cadence === 'MONTHLY'
      ? 'The month ahead: competitions, olympiads, scholarships and programmes our school thinks are worth your time.'
      : 'A few minutes, a few doors: this week\'s picks, a quick quiz and flashcards.',
    opportunityIds: items.map((o) => o._id),
    flashcards: buildFlashcards(items),
    quiz: buildQuiz(items, p.key),
    poll: buildPoll(items),
    spotlightEntryIds: spotlight.map((s) => s._id),
  };
}

/**
 * Drafts the edition for a period. Idempotent: an existing edition is
 * returned untouched; `force` rebuilds a DRAFT's content (never a published one).
 */
export async function generate({ cadence, now = new Date(), by = 'SCHEDULER', actor = null, force = false } = {}) {
  const c = oneOf(cadence, ['WEEKLY', 'MONTHLY'], 'cadence');
  if (actor && !opps.isEditor(actor)) throw new AppError('Only an editor can draft an edition', 403);
  const { key } = periodOf(c, now);
  const existing = await NewsletterEdition.findOne({ cadence: c, periodKey: key });
  if (existing && !(force && existing.status === 'DRAFT')) return { edition: existing.toObject(), created: false };
  const content = await contentFor(c, now);
  if (existing) {
    Object.assign(existing, content);
    pushHistory(existing, actor, 'REBUILT');
    await existing.save();
    return { edition: existing.toObject(), created: false, rebuilt: true };
  }
  try {
    const doc = await NewsletterEdition.create({ cadence: c, periodKey: key, ...content, generatedBy: by, history: [{ action: 'DRAFTED', actorProfileId: actor?.profileId ?? null, actorName: actor?.displayName ?? null, note: by }] });
    return { edition: doc.toObject(), created: true };
  } catch (err) {
    // Two runs at once: the other one made it.
    if (err?.code === 11000) return { edition: (await NewsletterEdition.findOne({ cadence: c, periodKey: key }).lean()), created: false };
    throw err;
  }
}

async function loadEdition(actor, id) {
  const e = await NewsletterEdition.findById(assertObjectId(id));
  if (!e || (e.status !== 'PUBLISHED' && !opps.isEditor(actor))) throw new AppError('Edition not found', 404);
  return e;
}

/** The editor's changes to a draft: title, intro, hook, poll question, and the items (which rebuilds cards, quiz and poll). */
export async function updateDraft(actor, id, body = {}) {
  if (!opps.isEditor(actor)) throw new AppError('Only an editor can change an edition', 403);
  const e = await loadEdition(actor, id);
  if (e.status !== 'DRAFT') throw new AppError('Only a draft can be changed', 409, [], 'NOT_DRAFT');
  if (body.title !== undefined) e.title = requireText(body.title, 'title', { max: 140 });
  if (body.intro !== undefined) e.intro = optionalText(body.intro, { max: 600 }) || null;
  if (body.hook) {
    if (body.hook.text !== undefined) e.hook.text = requireText(body.hook.text, 'hook', { max: 400 });
    if (body.hook.question !== undefined) e.hook.question = optionalText(body.hook.question, { max: 200 }) || null;
  }
  if (Array.isArray(body.opportunityIds)) {
    const ids = [...new Set(body.opportunityIds.map((x) => assertObjectId(x, 'opportunityId')))].slice(0, 15);
    const rows = await Opportunity.find({ _id: { $in: ids }, status: 'PUBLISHED' }).lean();
    const byId = new Map(rows.map((o) => [String(o._id), o]));
    const items = ids.map((x) => byId.get(x)).filter(Boolean);
    if (items.length !== ids.length) throw new AppError('Only published opportunities can go in an edition', 400, [], 'NOT_PUBLISHED');
    e.opportunityIds = items.map((o) => o._id);
    e.flashcards = buildFlashcards(items);
    e.quiz = buildQuiz(items, e.periodKey);
    e.poll = buildPoll(items);
  }
  if (body.pollQuestion !== undefined && e.poll?.options?.length) e.poll.question = requireText(body.pollQuestion, 'pollQuestion', { max: 200 });
  pushHistory(e, actor, 'EDITED');
  await e.save();
  return editorView(e.toObject());
}

// ── publishing and delivery ────────────────────────────────────────────

const appUrl = () => String(process.env.APP_URL || String(env.CORS_ORIGIN ?? '').split(',')[0] || 'http://localhost:3000').replace(/\/$/, '');

async function itemsOf(e) {
  const rows = await Opportunity.find({ _id: { $in: e.opportunityIds }, status: 'PUBLISHED' }).lean();
  const byId = new Map(rows.map((o) => [String(o._id), o]));
  return e.opportunityIds.map((x) => byId.get(String(x))).filter(Boolean);
}

/** Every active person in the school who keeps this cadence on (a person with no choices yet gets both in the app). */
async function readersOf(cadence) {
  const tenantId = currentTenantId();
  const people = await Profile.find({ status: 'ACTIVE', deletedAt: null, ...(tenantId ? { tenantId } : {}) }).select('_id roleId').populate('roleId', 'key').lean();
  const prefs = new Map((await NewsletterReader.find({ profileId: { $in: people.map((p) => p._id) } }).lean()).map((r) => [String(r.profileId), r]));
  const flag = cadence === 'MONTHLY' ? 'monthly' : 'weekly';
  return people
    .filter((p) => p.roleId?.key && p.roleId.key !== 'SUPER_ADMIN')
    .map((p) => ({ profileId: String(p._id), roleKey: p.roleId.key, reader: prefs.get(String(p._id)) ?? null }))
    .filter((r) => (r.reader ? r.reader[flag] !== false : true));
}

export async function publish(actor, id, { now = new Date() } = {}) {
  requireProfile(actor);
  if (!opps.isEditor(actor)) throw new AppError('Only an editor can publish an edition', 403);
  const e = await loadEdition(actor, id);
  if (e.status === 'PUBLISHED') return { edition: editorView(e.toObject()), delivered: false };
  const items = await itemsOf(e);
  if (!items.length) throw new AppError('Add at least one published opportunity before publishing', 400, [], 'EMPTY_EDITION');
  const firstTime = !e.delivery?.inApp && !e.delivery?.emailQueued;
  e.status = 'PUBLISHED'; e.publishedAt = now; e.publishedByProfileId = actor.profileId; e.publishedByName = actor.displayName ?? null;
  pushHistory(e, actor, 'PUBLISHED');
  await e.save();
  if (!firstTime) return { edition: editorView(e.toObject()), delivered: false };

  const readers = await readersOf(e.cadence);
  const emailTo = readers.filter((r) => r.reader?.email && !r.reader.unsubscribedAt && r.roleKey !== 'STUDENT');
  const emailIds = new Set(emailTo.map((r) => r.profileId));
  const inAppOnly = readers.filter((r) => !emailIds.has(r.profileId)).map((r) => r.profileId);
  const hook = (e.hook?.text ?? '').slice(0, 160);
  await notify({ recipientProfileIds: inAppOnly, type: 'SYSTEM', title: `${e.title} is out`.slice(0, 140), body: hook, link: `/opportunities?edition=${e._id}` });

  const school = await School.findOne({ slug: currentTenantId() }).select('name slug').lean();
  const presented = items.map((o) => opps.present(o, { now: now.getTime() }));
  const deadlines = presented.filter((o) => o.daysLeft !== null).slice(0, 6).map((o) => ({ title: o.title, closes: o.registrationCloses }));
  const byStatus = {};
  for (const r of emailTo) {
    const portal = PORTAL_OF[r.roleKey];
    const editionUrl = `${appUrl()}/${school?.slug ?? currentTenantId()}${portal ? `/${portal}/opportunities` : ''}?edition=${e._id}`;
    const unsubscribeUrl = `${appUrl()}/public/newsletter/${school?.slug ?? currentTenantId()}/unsubscribe?t=${r.reader.unsubscribeToken}`;
    const email = renderEditionEmail({ schoolName: school?.name ?? '', edition: e.toObject(), items: presented, deadlines, editionUrl, unsubscribeUrl });
    // eslint-disable-next-line no-await-in-loop -- one outbox row per reader (each has their own unsubscribe link)
    const out = await sendOperational({
      templateKey: 'NEWSLETTER_EDITION', recipientProfileIds: [r.profileId], channels: ['EMAIL'], variables: { title: e.title, period: e.periodLabel ?? '' },
      link: `/opportunities?edition=${e._id}`, idempotencyKey: `newsletter:${e._id}:${r.profileId}`, relatedEntityType: 'NewsletterEdition', relatedEntityId: e._id, now, email,
    });
    for (const x of out) byStatus[x.status] = (byStatus[x.status] ?? 0) + 1;
  }
  e.delivery = { inApp: readers.length, emailQueued: emailTo.length, byStatus };
  await NewsletterEdition.updateOne({ _id: e._id }, { $set: { delivery: e.delivery } });
  return { edition: editorView(e.toObject()), delivered: true, delivery: e.delivery };
}

export async function withdraw(actor, id, body = {}) {
  if (!opps.isEditor(actor)) throw new AppError('Only an editor can withdraw an edition', 403);
  const e = await loadEdition(actor, id);
  if (e.status !== 'PUBLISHED') throw new AppError('Only a published edition can be withdrawn', 409);
  e.status = 'WITHDRAWN';
  pushHistory(e, actor, 'WITHDRAWN', { note: optionalText(body.reason, { max: 300 }) || null });
  await e.save();
  return editorView(e.toObject());
}

// ── reading ────────────────────────────────────────────────────────────

function editorView(e) {
  return {
    id: String(e._id), cadence: e.cadence, periodKey: e.periodKey, periodLabel: e.periodLabel, title: e.title, status: e.status, hook: e.hook, intro: e.intro,
    opportunityIds: (e.opportunityIds ?? []).map(String), flashcards: e.flashcards?.length ?? 0, quiz: e.quiz?.length ?? 0, poll: e.poll?.question ?? null,
    generatedBy: e.generatedBy, publishedAt: e.publishedAt, publishedByName: e.publishedByName ?? null, delivery: e.delivery ?? null, createdAt: e.createdAt, history: e.history ?? [],
  };
}

export async function list(actor, query = {}) {
  requireProfile(actor);
  const editor = opps.isEditor(actor) && query.view !== 'reader';
  const filter = editor ? {} : { status: 'PUBLISHED' };
  if (query.cadence) filter.cadence = oneOf(query.cadence, ['WEEKLY', 'MONTHLY'], 'cadence');
  const rows = await NewsletterEdition.find(filter).sort({ publishedAt: -1, createdAt: -1 }).limit(40).lean();
  const reads = new Map((await NewsletterRead.find({ profileId: actor.profileId, editionId: { $in: rows.map((r) => r._id) } }).lean()).map((r) => [String(r.editionId), r]));
  return rows.map((e) => ({
    ...(editor ? editorView(e) : { id: String(e._id), cadence: e.cadence, periodLabel: e.periodLabel, title: e.title, hook: e.hook?.text ?? '', publishedAt: e.publishedAt, items: e.opportunityIds?.length ?? 0 }),
    myProgress: reads.get(String(e._id))?.progressPct ?? 0, myQuizScore: reads.get(String(e._id))?.quiz?.score ?? null,
  }));
}

async function spotlightOf(e) {
  if (!e.spotlightEntryIds?.length) return [];
  const rows = await ShowcaseEntry.find({ _id: { $in: e.spotlightEntryIds }, status: 'PUBLISHED' }).lean();
  // Consent is read again now: a consent withdrawn since the edition was made hides the entry at once.
  const ok = await consentedIds(rows.map((r) => r.studentId));
  const students = new Map((await Student.find({ _id: { $in: rows.map((r) => r.studentId) } }).select('firstName lastName').lean()).map((s) => [String(s._id), s]));
  return rows.filter((r) => ok.has(String(r.studentId))).map((r) => {
    const s = students.get(String(r.studentId));
    return { title: r.title, detail: r.detail ?? null, category: r.category, level: r.level ?? null, name: s ? `${s.firstName} ${String(s.lastName ?? '').slice(0, 1)}${s.lastName ? '.' : ''}`.trim() : null };
  });
}

async function leaderboardOf(editionId) {
  const reads = await NewsletterRead.find({ editionId, 'quiz.onBoard': true, 'quiz.score': { $ne: null } }).select('quiz').lean();
  const group = (key) => {
    const m = new Map();
    for (const r of reads) {
      const g = r.quiz?.[key];
      if (!g) continue;
      const v = m.get(g) ?? { group: g, participants: 0, total: 0 };
      v.participants += 1; v.total += r.quiz.score;
      m.set(g, v);
    }
    return [...m.values()].filter((v) => v.participants >= MIN_GROUP)
      .map((v) => ({ group: v.group, participants: v.participants, averageScore: Math.round((v.total / v.participants) * 10) / 10 }))
      .sort((a, b) => b.averageScore - a.averageScore || b.participants - a.participants);
  };
  return { byClass: group('sectionLabel'), byHouse: group('houseName'), minGroup: MIN_GROUP, note: `Only students who chose to join, shown as class and house averages. Groups with fewer than ${MIN_GROUP} players are not shown.` };
}

async function pollResults(e) {
  const rows = await NewsletterRead.aggregate([{ $match: { editionId: e._id, pollChoice: { $ne: null } } }, { $group: { _id: '$pollChoice', n: { $sum: 1 } } }]);
  const counts = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const total = rows.reduce((s, r) => s + r.n, 0);
  return { total, options: (e.poll?.options ?? []).map((o) => ({ key: o.key, label: o.label, votes: counts[o.key] ?? 0, pct: total ? Math.round(((counts[o.key] ?? 0) / total) * 100) : 0 })) };
}

async function reactionsOf(e, profileId) {
  const rows = await NewsletterReaction.find({ editionId: e._id }).select('target kind profileId').lean();
  const out = {};
  for (const r of rows) {
    out[r.target] = out[r.target] ?? { counts: Object.fromEntries(REACTIONS.map((k) => [k, 0])), mine: null };
    out[r.target].counts[r.kind] += 1;
    if (String(r.profileId) === String(profileId)) out[r.target].mine = r.kind;
  }
  return out;
}

async function commentsOf(e, actor) {
  const rows = await NewsletterComment.find({ editionId: e._id, $or: [{ status: 'APPROVED' }, { profileId: actor.profileId, status: { $ne: 'APPROVED' } }] }).sort({ createdAt: 1 }).limit(200).lean();
  return rows.map((c) => ({
    id: String(c._id), opportunityId: c.opportunityId ? String(c.opportunityId) : null, displayName: c.displayName, text: c.text, status: c.status,
    mine: String(c.profileId) === String(actor.profileId), at: c.createdAt, rejectReason: String(c.profileId) === String(actor.profileId) ? c.rejectReason ?? null : null,
  }));
}

/** The interactive edition for one reader: the shared core plus their own layer. Opening it counts as an open. */
export async function read(actor, id, query = {}, { now = new Date() } = {}) {
  requireProfile(actor);
  const e = await loadEdition(actor, id);
  const items = await itemsOf(e);
  const t = now.getTime();
  const readRow = e.status === 'PUBLISHED'
    ? await NewsletterRead.findOneAndUpdate({ editionId: e._id, profileId: actor.profileId }, { $setOnInsert: { editionId: e._id, profileId: actor.profileId, roleKey: actor.roleKey, openedAt: now } }, { upsert: true, new: true }).lean()
    : null;
  const reader = await opps.readerFor(actor.profileId);
  const personal = await opps.matches(actor, { studentId: query.studentId }, { now, limit: 5 });
  const inEdition = new Set(items.map((o) => String(o._id)));
  const mySaves = await OpportunitySave.find({ profileId: actor.profileId }).lean();
  const savedIds = new Set(mySaves.map((s) => String(s.opportunityId)));
  const savedOpps = await Opportunity.find({ _id: { $in: [...savedIds] }, status: 'PUBLISHED' }).lean();
  const deadlines = [...new Map([...items, ...savedOpps].map((o) => [String(o._id), o])).values()]
    .map((o) => ({ id: String(o._id), title: o.title, daysLeft: daysLeft(o, t), closes: o.registrationCloses, saved: savedIds.has(String(o._id)) }))
    .filter((d) => d.daysLeft !== null && d.daysLeft <= 30).sort((a, b) => a.daysLeft - b.daysLeft);
  const reviews = new Map((await FlashcardReview.find({ profileId: actor.profileId, editionId: e._id }).lean()).map((r) => [r.cardKey, r]));
  const answered = readRow?.quiz?.score !== null && readRow?.quiz?.score !== undefined;
  const voted = Boolean(readRow?.pollChoice);
  return {
    id: String(e._id), cadence: e.cadence, periodLabel: e.periodLabel, title: e.title, status: e.status, intro: e.intro, publishedAt: e.publishedAt,
    hook: e.hook,
    items: items.map((o) => ({ ...opps.present(o, { now: t }), saved: savedIds.has(String(o._id)) })),
    forYou: personal.contexts.map((c) => ({ ...c, items: c.items.map((i) => ({ ...i, inEdition: inEdition.has(i.id), saved: savedIds.has(i.id) })) })),
    deadlines,
    flashcards: (e.flashcards ?? []).map((c) => {
      const r = reviews.get(`${e._id}:${c.key}`);
      return { key: `${e._id}:${c.key}`, front: c.front, back: c.back, domain: c.domain, box: r?.box ?? null, lastResult: r?.lastResult ?? null };
    }),
    quiz: {
      questions: (e.quiz ?? []).map((q, i) => ({ key: q.key, question: q.question, options: q.options, ...(answered && { answerIndex: q.answerIndex, explain: q.explain, yourAnswer: readRow.quiz.answers?.[i] ?? null }) })),
      answered, score: answered ? readRow.quiz.score : null, onBoard: Boolean(readRow?.quiz?.onBoard),
      canJoinBoard: actor.roleKey === 'STUDENT', boardOptIn: Boolean(reader.leaderboardOptIn),
    },
    poll: e.poll?.question ? { question: e.poll.question, options: e.poll.options, myChoice: readRow?.pollChoice ?? null, results: voted || opps.isEditor(actor) ? await pollResults(e) : null } : null,
    spotlight: await spotlightOf(e),
    reactions: await reactionsOf(e, actor.profileId),
    comments: await commentsOf(e, actor),
    leaderboard: answered || opps.isEditor(actor) ? await leaderboardOf(e._id) : null,
    progress: { pct: readRow?.progressPct ?? 0, lastSection: readRow?.lastSection ?? null, completed: Boolean(readRow?.completedAt) },
    reader: { language: reader.language ?? 'en', textSize: reader.textSize ?? 'M', streak: reader.streak ?? { count: 0, best: 0 } },
  };
}

/** The reader's newsletter home: latest editions, where they left off, cards due, streak and closing saves. */
export async function home(actor, { now = new Date() } = {}) {
  requireProfile(actor);
  const [weekly, monthly] = await Promise.all(['WEEKLY', 'MONTHLY'].map((c) => NewsletterEdition.findOne({ cadence: c, status: 'PUBLISHED' }).sort({ publishedAt: -1 }).select('title periodLabel hook publishedAt cadence').lean()));
  const reads = await NewsletterRead.find({ profileId: actor.profileId, completedAt: null, progressPct: { $gt: 0 } }).sort({ updatedAt: -1 }).limit(1).lean();
  const cont = reads[0] ? await NewsletterEdition.findOne({ _id: reads[0].editionId, status: 'PUBLISHED' }).select('title periodLabel').lean() : null;
  const due = await FlashcardReview.countDocuments({ profileId: actor.profileId, dueAt: { $lte: now } });
  const reader = await opps.readerFor(actor.profileId);
  const savedList = await opps.saved(actor);
  const brief = (e) => (e ? { id: String(e._id), title: e.title, periodLabel: e.periodLabel, hook: e.hook?.text ?? '', publishedAt: e.publishedAt } : null);
  return {
    weekly: brief(weekly), monthly: brief(monthly),
    continueReading: cont ? { id: String(cont._id), title: cont.title, periodLabel: cont.periodLabel, pct: reads[0].progressPct, lastSection: reads[0].lastSection } : null,
    flashcardsDue: due, streak: reader.streak ?? { count: 0, best: 0 },
    closingSoon: savedList.filter((s) => s.opportunity.daysLeft !== null && s.opportunity.daysLeft <= 14).slice(0, 5).map((s) => ({ id: s.opportunity.id, title: s.opportunity.title, daysLeft: s.opportunity.daysLeft, forName: s.forName })),
    savedCount: savedList.length,
  };
}

export async function progress(actor, id, body = {}) {
  requireProfile(actor);
  const e = await loadEdition(actor, id);
  if (e.status !== 'PUBLISHED') throw new AppError('Edition not found', 404);
  const pct = Math.max(0, Math.min(100, Math.round(Number(body.pct) || 0)));
  const section = optionalText(body.section, { max: 40 }) || null;
  const r = await NewsletterRead.findOneAndUpdate(
    { editionId: e._id, profileId: actor.profileId },
    { $max: { progressPct: pct }, $set: { lastSection: section }, $setOnInsert: { editionId: e._id, profileId: actor.profileId, roleKey: actor.roleKey, openedAt: new Date() } },
    { upsert: true, new: true },
  );
  if (r.progressPct >= 100 && !r.completedAt) { r.completedAt = new Date(); await r.save(); }
  return { pct: r.progressPct, lastSection: r.lastSection, completed: Boolean(r.completedAt) };
}

export async function answerQuiz(actor, id, body = {}) {
  requireProfile(actor);
  const e = await loadEdition(actor, id);
  if (e.status !== 'PUBLISHED') throw new AppError('Edition not found', 404);
  if (!e.quiz?.length) throw new AppError('This edition has no quiz', 404);
  if (!Array.isArray(body.answers) || body.answers.length !== e.quiz.length) throw new AppError(`Answer all ${e.quiz.length} questions`, 400, [], 'ANSWERS_REQUIRED');
  const answers = body.answers.map((a, i) => {
    const n = Number(a);
    if (!Number.isInteger(n) || n < 0 || n >= e.quiz[i].options.length) throw new AppError(`Answer ${i + 1} is not one of the options`, 400);
    return n;
  });
  const existing = await NewsletterRead.findOne({ editionId: e._id, profileId: actor.profileId }).lean();
  if (existing?.quiz?.score !== null && existing?.quiz?.score !== undefined) throw new AppError('You have already taken this quiz', 409, [], 'ALREADY_ANSWERED');
  const score = answers.filter((a, i) => a === e.quiz[i].answerIndex).length;
  // Only a student who opted in counts for the class / house board.
  let board = { onBoard: false, sectionLabel: null, houseName: null };
  if (actor.roleKey === 'STUDENT') {
    const reader = await opps.readerFor(actor.profileId);
    if (reader.leaderboardOptIn) {
      const ctx = (await opps.contextsFor(actor))[0];
      board = { onBoard: true, sectionLabel: ctx?.gradeName ?? ctx?.sectionLabel ?? null, houseName: ctx?.houseName ?? null };
    }
  }
  await NewsletterRead.updateOne(
    { editionId: e._id, profileId: actor.profileId },
    { $set: { quiz: { answers, score, at: new Date(), ...board } }, $setOnInsert: { editionId: e._id, profileId: actor.profileId, roleKey: actor.roleKey, openedAt: new Date() } },
    { upsert: true },
  );
  return {
    score, outOf: e.quiz.length, onBoard: board.onBoard,
    feedback: e.quiz.map((q, i) => ({ key: q.key, correct: answers[i] === q.answerIndex, yourAnswer: answers[i], answerIndex: q.answerIndex, explain: q.explain })),
  };
}

export async function vote(actor, id, body = {}) {
  requireProfile(actor);
  const e = await loadEdition(actor, id);
  if (e.status !== 'PUBLISHED' || !e.poll?.question) throw new AppError('This edition has no poll', 404);
  const option = String(body.option ?? '');
  if (!e.poll.options.some((o) => o.key === option)) throw new AppError('Choose one of the options', 400);
  const r = await NewsletterRead.findOneAndUpdate(
    { editionId: e._id, profileId: actor.profileId, pollChoice: null },
    { $set: { pollChoice: option } },
    { new: true },
  );
  if (!r) {
    const existing = await NewsletterRead.findOne({ editionId: e._id, profileId: actor.profileId }).lean();
    if (existing?.pollChoice) throw new AppError('You have already voted', 409, [], 'ALREADY_VOTED');
    await NewsletterRead.create({ editionId: e._id, profileId: actor.profileId, roleKey: actor.roleKey, pollChoice: option });
  }
  return pollResults(e);
}

export async function react(actor, id, body = {}) {
  requireProfile(actor);
  const e = await loadEdition(actor, id);
  if (e.status !== 'PUBLISHED') throw new AppError('Edition not found', 404);
  const target = String(body.target ?? '');
  if (target !== 'hook' && !e.opportunityIds.map(String).includes(target)) throw new AppError('React to the hook or one of this edition\'s items', 400);
  const kind = oneOf(body.kind, REACTIONS, 'kind');
  const existing = await NewsletterReaction.findOne({ editionId: e._id, target, profileId: actor.profileId });
  if (existing && existing.kind === kind) await existing.deleteOne();
  else await NewsletterReaction.updateOne({ editionId: e._id, target, profileId: actor.profileId }, { $set: { kind } }, { upsert: true });
  return (await reactionsOf(e, actor.profileId))[target] ?? { counts: Object.fromEntries(REACTIONS.map((k) => [k, 0])), mine: null };
}

// ── comments ───────────────────────────────────────────────────────────

const ROLE_WORD = { TEACHER: 'Teacher', PRINCIPAL: 'Principal', ADMIN: 'School office', LIBRARIAN: 'Librarian', ALUMNUS: 'An alumnus' };

export async function comment(actor, id, body = {}) {
  requireProfile(actor);
  const e = await loadEdition(actor, id);
  if (e.status !== 'PUBLISHED') throw new AppError('Edition not found', 404);
  // eslint-disable-next-line no-control-regex
  const text = requireText(String(body.text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' '), 'comment', { max: 500 });
  const opportunityId = body.opportunityId ? assertObjectId(body.opportunityId, 'opportunityId') : null;
  if (opportunityId && !e.opportunityIds.map(String).includes(opportunityId)) throw new AppError('Comment on one of this edition\'s items', 400);
  const staff = opps.isStaff(actor);
  let displayName;
  if (staff) displayName = `${actor.displayName ?? 'Staff'}${ROLE_WORD[actor.roleKey] ? ` (${ROLE_WORD[actor.roleKey]})` : ''}`;
  else if (actor.roleKey === 'STUDENT') {
    const ctx = (await opps.contextsFor(actor))[0];
    displayName = ctx?.gradeName ? `A student in ${ctx.gradeName}` : 'A student';
  } else displayName = actor.roleKey === 'PARENT' ? 'A parent' : (ROLE_WORD[actor.roleKey] ?? 'A reader');
  const c = await NewsletterComment.create({
    editionId: e._id, opportunityId, profileId: actor.profileId, authorRole: actor.roleKey, displayName, text,
    // Staff speak as themselves at once; every family comment waits for staff.
    status: staff ? 'APPROVED' : 'PENDING',
    ...(staff && { moderatedByProfileId: actor.profileId, moderatedByName: actor.displayName ?? null, moderatedAt: new Date() }),
  });
  return { id: String(c._id), status: c.status, displayName, note: staff ? null : 'Thanks! A member of staff checks comments before others see them.' };
}

/** Moderators: editors see every pending comment; teachers see students' pending comments. */
function canModerate(actor, c) {
  if (opps.isEditor(actor)) return true;
  return actor.roleKey === 'TEACHER' && c.authorRole === 'STUDENT';
}

export async function pendingComments(actor) {
  requireProfile(actor);
  if (!opps.isEditor(actor) && actor.roleKey !== 'TEACHER') throw new AppError('Only staff moderate comments', 403);
  const filter = { status: 'PENDING', ...(opps.isEditor(actor) ? {} : { authorRole: 'STUDENT' }) };
  const rows = await NewsletterComment.find(filter).sort({ createdAt: 1 }).limit(200).lean();
  const eds = new Map((await NewsletterEdition.find({ _id: { $in: rows.map((r) => r.editionId) } }).select('title').lean()).map((x) => [String(x._id), x.title]));
  return rows.map((c) => ({ id: String(c._id), edition: eds.get(String(c.editionId)) ?? null, editionId: String(c.editionId), displayName: c.displayName, authorRole: c.authorRole, text: c.text, at: c.createdAt }));
}

export async function moderate(actor, commentId, body = {}) {
  requireProfile(actor);
  const c = await NewsletterComment.findById(assertObjectId(commentId));
  if (!c || !canModerate(actor, c)) throw new AppError('Comment not found', 404);
  if (c.status !== 'PENDING') throw new AppError('This comment was already moderated', 409);
  const decision = oneOf(body.decision, ['APPROVE', 'REJECT'], 'decision');
  if (decision === 'REJECT') c.rejectReason = requireText(body.reason, 'reason', { max: 300 });
  c.status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  c.moderatedByProfileId = actor.profileId; c.moderatedByName = actor.displayName ?? null; c.moderatedAt = new Date();
  await c.save();
  return { id: String(c._id), status: c.status };
}

// ── flashcards (spaced repetition across editions) ─────────────────────

const ymd = (now) => { const { y, m, d } = localDate(now); return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };

async function bumpStreak(profileId, now) {
  const r = await opps.readerFor(profileId);
  const today = ymd(now);
  const s = r.streak ?? { count: 0, best: 0, lastDay: null };
  if (s.lastDay === today) return s;
  const yesterday = ymd(new Date(now.getTime() - DAY));
  const count = s.lastDay === yesterday ? (s.count ?? 0) + 1 : 1;
  const next = { count, best: Math.max(s.best ?? 0, count), lastDay: today };
  await NewsletterReader.updateOne({ profileId }, { $set: { streak: next } });
  return next;
}

/** "I knew it" moves a card up a box (seen again later); "Review again" sends it back to box 1 (tomorrow). */
export async function reviewCard(actor, body = {}, { now = new Date() } = {}) {
  requireProfile(actor);
  const cardKey = String(body.cardKey ?? '');
  const [editionId, key] = cardKey.split(':');
  const e = await loadEdition(actor, editionId);
  if (e.status !== 'PUBLISHED' || !(e.flashcards ?? []).some((c) => c.key === key)) throw new AppError('Card not found', 404);
  const result = oneOf(body.result, ['KNEW', 'REVIEW'], 'result');
  const prev = await FlashcardReview.findOne({ profileId: actor.profileId, cardKey }).lean();
  const box = result === 'KNEW' ? Math.min(5, (prev?.box ?? 1) + 1) : 1;
  const dueAt = new Date(now.getTime() + LEITNER_DAYS[box - 1] * DAY);
  await FlashcardReview.updateOne(
    { profileId: actor.profileId, cardKey },
    { $set: { box, dueAt, lastResult: result, editionId: e._id }, $inc: { reviews: 1 }, $setOnInsert: { profileId: actor.profileId, cardKey } },
    { upsert: true },
  );
  const streak = await bumpStreak(actor.profileId, now);
  return { cardKey, box, dueAt, streak };
}

/** Cards due today from every edition, then new cards from the latest editions, and the streak. */
export async function flashcardDeck(actor, { now = new Date(), limit = 15 } = {}) {
  requireProfile(actor);
  const due = await FlashcardReview.find({ profileId: actor.profileId, dueAt: { $lte: now } }).sort({ dueAt: 1 }).limit(limit).lean();
  const recent = await NewsletterEdition.find({ status: 'PUBLISHED' }).sort({ publishedAt: -1 }).limit(4).select('flashcards title').lean();
  const editions = new Map(recent.map((x) => [String(x._id), x]));
  const missing = [...new Set(due.map((r) => String(r.editionId)))].filter((x) => !editions.has(x));
  for (const x of await NewsletterEdition.find({ _id: { $in: missing }, status: 'PUBLISHED' }).select('flashcards title').lean()) editions.set(String(x._id), x);
  const cardOf = (cardKey) => {
    const [eid, key] = cardKey.split(':');
    const ed = editions.get(eid);
    const c = ed?.flashcards?.find((x) => x.key === key);
    return c ? { key: cardKey, front: c.front, back: c.back, domain: c.domain, edition: ed.title } : null;
  };
  const dueCards = due.map((r) => (cardOf(r.cardKey) ? { ...cardOf(r.cardKey), box: r.box } : null)).filter(Boolean);
  const seen = new Set((await FlashcardReview.find({ profileId: actor.profileId }).select('cardKey').lean()).map((r) => r.cardKey));
  const fresh = [];
  for (const ed of recent) for (const c of ed.flashcards ?? []) {
    const k = `${ed._id}:${c.key}`;
    if (!seen.has(k) && fresh.length < Math.max(0, limit - dueCards.length)) fresh.push({ key: k, front: c.front, back: c.back, domain: c.domain, edition: ed.title, box: null });
  }
  const reader = await opps.readerFor(actor.profileId);
  const total = await FlashcardReview.countDocuments({ profileId: actor.profileId });
  const mastered = await FlashcardReview.countDocuments({ profileId: actor.profileId, box: { $gte: 4 } });
  return { due: dueCards, fresh, streak: reader.streak ?? { count: 0, best: 0 }, stats: { learning: total, mastered } };
}

// ── editor analytics ───────────────────────────────────────────────────

export async function analytics(actor) {
  if (!opps.isEditor(actor)) throw new AppError('Only an editor sees newsletter analytics', 403);
  const eds = await NewsletterEdition.find({ status: { $in: ['PUBLISHED', 'WITHDRAWN'] } }).sort({ publishedAt: -1 }).limit(12).lean();
  const rows = [];
  for (const e of eds) {
    /* eslint-disable no-await-in-loop -- a dozen editions at most */
    const reads = await NewsletterRead.find({ editionId: e._id }).select('progressPct completedAt clicks quiz pollChoice roleKey').lean();
    const quizzed = reads.filter((r) => r.quiz?.score !== null && r.quiz?.score !== undefined);
    const saves = await OpportunitySave.countDocuments({ opportunityId: { $in: e.opportunityIds }, createdAt: { $gte: e.publishedAt ?? e.createdAt } });
    const comments = await NewsletterComment.aggregate([{ $match: { editionId: e._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
    /* eslint-enable no-await-in-loop */
    const byRole = {};
    for (const r of reads) byRole[r.roleKey ?? 'OTHER'] = (byRole[r.roleKey ?? 'OTHER'] ?? 0) + 1;
    rows.push({
      id: String(e._id), title: e.title, cadence: e.cadence, periodLabel: e.periodLabel, status: e.status, publishedAt: e.publishedAt,
      delivered: e.delivery?.inApp ?? 0, emailed: e.delivery?.emailQueued ?? 0, emailByStatus: e.delivery?.byStatus ?? {},
      opens: reads.length, opensByRole: byRole, completed: reads.filter((r) => r.completedAt).length,
      clicks: reads.reduce((s, r) => s + (r.clicks?.length ?? 0), 0),
      quizParticipants: quizzed.length, averageQuizScore: quizzed.length ? Math.round((quizzed.reduce((s, r) => s + r.quiz.score, 0) / quizzed.length) * 10) / 10 : null,
      pollVotes: reads.filter((r) => r.pollChoice).length, saves,
      comments: Object.fromEntries(comments.map((c) => [c._id, c.n])),
    });
  }
  const totals = rows.reduce((t, r) => ({ opens: t.opens + r.opens, clicks: t.clicks + r.clicks, quizParticipants: t.quizParticipants + r.quizParticipants, saves: t.saves + r.saves }), { opens: 0, clicks: 0, quizParticipants: 0, saves: 0 });
  const topClicked = (await Opportunity.find({ status: 'PUBLISHED', clicks: { $gt: 0 } }).sort({ clicks: -1 }).limit(5).select('title clicks').lean()).map((o) => ({ id: String(o._id), title: o.title, clicks: o.clicks }));
  return { editions: rows, totals, topClicked, note: 'Opens are counted when someone opens the edition in EduOS. Emails carry no tracking pixels.' };
}

/** Records a click on an item's official link from inside an edition. */
export async function clickFromEdition(actor, id, opportunityId) {
  requireProfile(actor);
  const e = await loadEdition(actor, id);
  const oid = assertObjectId(opportunityId, 'opportunityId');
  if (!e.opportunityIds.map(String).includes(oid)) throw new AppError('Not an item of this edition', 400);
  const out = await opps.click(actor, oid);
  if (e.status === 'PUBLISHED') {
    await NewsletterRead.updateOne({ editionId: e._id, profileId: actor.profileId }, { $push: { clicks: { opportunityId: oid, at: new Date() } }, $setOnInsert: { editionId: e._id, profileId: actor.profileId, roleKey: actor.roleKey, openedAt: new Date() } }, { upsert: true });
  }
  return out;
}

// ── the scheduled run ──────────────────────────────────────────────────

/**
 * Daily: find opportunity candidates in the approved feeds, draft this week's
 * and this month's editions if they do not exist yet (an editor is told once),
 * and send due "Remind me" reminders. Every step is idempotent.
 */
export async function runScheduled({ now = new Date() } = {}) {
  const feeds = await opps.scanFeeds({ now });
  const drafted = [];
  for (const cadence of ['WEEKLY', 'MONTHLY']) {
    // eslint-disable-next-line no-await-in-loop
    const out = await generate({ cadence, now, by: 'SCHEDULER' });
    if (out.created) drafted.push(out.edition);
  }
  if (drafted.length) {
    const editors = (await profilesWithRoles(['PRINCIPAL', 'ADMIN'])).map((p) => String(p._id));
    for (const d of drafted) {
      // eslint-disable-next-line no-await-in-loop
      await notify({ recipientProfileIds: editors, type: 'SYSTEM', title: `Newsletter draft ready: ${d.title}`.slice(0, 140), body: 'Review it and publish it with one press when it is right.', link: `/newsletter-desk?tab=editions&id=${d._id}` });
    }
  }
  const reminders = await opps.runReminders({ now });
  return { feedCandidates: feeds.added, drafted: drafted.map((d) => `${d.cadence}:${d.periodKey}`), reminders: reminders.sent };
}
