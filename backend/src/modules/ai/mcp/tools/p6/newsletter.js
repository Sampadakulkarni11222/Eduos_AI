import * as digest from '../../../../digest/digest.service.js';
import * as opps from '../../../../newsletter/opportunities.service.js';
import * as editions from '../../../../newsletter/editions.service.js';
import * as alerts from '../../../../newsletter/alerts.service.js';
import * as editionsAi from '../../../../newsletter/editionsAi.service.js';
import { INTERESTS } from '../../../../../models/digest.model.js';
import {
  Opportunity, NewsletterEdition, OPP_TYPES, OPP_LEVELS, OPP_DOMAINS, OPP_STREAMS, OPP_MODES, REACTIONS,
} from '../../../../../models/newsletter.model.js';
import { featureEnabled } from '../../../../../utils/features.js';
import {
  tool, closed, text, int, bool, oneOf, list, RISK, AppError, dateStr, ask, notFound, pick, listed, shown, did,
  rowsOf, lower, excerpt, day, decisionArg,
} from './_kit.js';

/**
 * Part-6 coverage: the opportunities newsletter, its editions, the alert
 * feeds and the daily digest. Each tool is the route's own service call
 * (digest.routes.js, newsletter.routes.js) behind the route's own guard:
 *
 *   readers (digest.read)    newsletter home, preferences, the month's map,
 *                            one opportunity, its official link, unsaving,
 *                            editions list, reading progress, poll, reactions,
 *                            comments, flashcard review, edition extras and
 *                            class quiz challenges (students), questions to and
 *                            answers from teachers, comment moderation (staff;
 *                            the service decides who may), digest interests
 *   editor (digest.manage    official-sites list, opportunity decisions
 *   for the whole school)    (publish / reject / archive), starter list, feed
 *                            scan, draft edits, publishing and withdrawing an
 *                            edition, alert feeds (guide, list, edit, check,
 *                            items, analytics, run) and the digest's sources
 *                            and daily run
 *
 * Text that came from outside sites (feed headlines, snippets) is returned as
 * quoted data, marked `external`, and never treated as an instruction.
 * Existing tools in ../p4Newsletter.js, ../p5NewsletterAi.js and the digest
 * tools in ../platformPeople.js are not repeated here.
 */

/** Staff who may answer, moderate or edit (the service refuses families and alumni these acts). */
const NEWS_STAFF = ['ADMIN', 'PRINCIPAL', 'TEACHER', 'LIBRARIAN', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'WARDEN', 'NURSE', 'TRUSTEE'];
const NEWS = 'Newsletter';
const DIGEST = 'Digest';
const CADENCE = oneOf(['WEEKLY', 'MONTHLY'], 'Default WEEKLY');
const EDITION = text(140, 'The edition by its title or period, e.g. "Week 42" or "October 2026". Omit for the latest.');
const OPP = text(200, 'The opportunity by its title, e.g. "science olympiad"');

/** The alert-feed routes sit behind both switches: newsletter and newsletterAlerts. */
async function newsletterOn() {
  if (!(await featureEnabled('newsletter'))) throw new AppError('Opportunities and the newsletter are switched off for this school.', 403, [], 'FEATURE_OFF');
}
function alertsTool(def) {
  const t = tool({ ...def, feature: 'newsletterAlerts' });
  const { run, prepare } = t;
  return {
    ...t,
    async run(ctx, args, prepared) { await newsletterOn(); return run.call(this, ctx, args, prepared); },
    async prepare(ctx, args) { await newsletterOn(); return prepare ? prepare.call(this, ctx, args) : undefined; },
  };
}
const news = (def) => tool({ module: NEWS, feature: 'newsletter', ...def });
const dig = (def) => tool({ module: DIGEST, feature: 'digest', ...def });

/* ── resolvers (the caller's own lists only) ─────────────── */

/** An opportunity the caller may see (an editor: any status), by title. */
async function theOpportunity(ctx, title, { status } = {}) {
  const q = String(title ?? '').trim();
  let rows = rowsOf(await opps.list(ctx.actor, { q, ...(status && opps.isEditor(ctx.actor) && { status }) }));
  if (!rows.length) rows = rowsOf(await opps.list(ctx.actor, { ...(status && opps.isEditor(ctx.actor) && { status }) }));
  return pick(rows, q, { label: 'opportunity', nameOf: (o) => o.title, refOf: (o) => o.id, describe: (o) => `${o.title} (${o.typeLabel}${opps.isEditor(ctx.actor) ? `, ${lower(o.status)}` : ''})` });
}

/** An opportunity the caller may change: an editor's any, otherwise their own item still in review. */
async function theEditableOpportunity(ctx, title) {
  if (opps.isEditor(ctx.actor)) return theOpportunity(ctx, title);
  const own = await Opportunity.find({ submittedByProfileId: ctx.actor.profileId, status: 'SUBMITTED' }).lean();
  return pick(own.map((o) => opps.present(o)), title, { label: 'item of yours waiting for review', nameOf: (o) => o.title, refOf: (o) => o.id });
}

/** An edition the caller can see: by title / period, else the latest of the cadence (optionally of one status). */
async function theEdition(ctx, args, { status } = {}) {
  let rows = rowsOf(await editions.list(ctx.actor, { ...(args.cadence && { cadence: args.cadence }) }));
  if (status) rows = rows.filter((e) => (e.status ?? 'PUBLISHED') === status);
  const word = { DRAFT: 'draft', PUBLISHED: 'published' }[status] ?? '';
  if (!args.edition) {
    if (!rows.length) throw notFound(`There is no ${word ? `${word} ` : ''}${args.cadence === 'MONTHLY' ? 'monthly' : args.cadence === 'WEEKLY' ? 'weekly' : ''} newsletter edition yet.`.replace(/\s+/g, ' '));
    if (!args.cadence) {
      const weekly = rows.find((e) => e.cadence === 'WEEKLY');
      return weekly ?? rows[0];
    }
    return rows[0];
  }
  return pick(rows, args.edition, { label: `${word ? `${word} ` : ''}edition`, nameOf: (e) => e.title, refOf: (e) => e.periodLabel, describe: (e) => `${e.title} (${e.periodLabel})` });
}

const editionDoc = async (id) => {
  const e = await NewsletterEdition.findById(id).lean();
  if (!e) throw notFound('Edition not found');
  return e;
};

/** A published opportunity (for an edition's items), by title. */
async function publishedByTitle(ctx, title) {
  const rows = rowsOf(await opps.list(ctx.actor, { status: 'PUBLISHED' })).filter((o) => o.status === 'PUBLISHED');
  return pick(rows, title, { label: 'published opportunity', nameOf: (o) => o.title, refOf: (o) => o.id });
}

const theDigestSource = async (name) => pick(await digest.listSources(), name, { label: 'digest feed', nameOf: (s) => s.title, refOf: (s) => s.url });
const theAlertFeed = async (ctx, name) => pick(await alerts.listSources(ctx.actor), name, { label: 'alert feed', nameOf: (s) => s.title, refOf: (s) => s.url });

/* ── the daily digest ────────────────────────────────────── */

const digestTools = {
  get_my_digest_interests: dig({
    operation: 'GET', resultShape: 'DETAIL',
    description: "Anyone: the topics the daily digest offers (science, technology, sports, careers, education policy, arts, environment, mathematics), the ones the caller chose and whether their digest is also emailed. Read-only.",
    permission: 'digest.read',
    service: 'digest.service.interests()',
    async run(ctx) {
      const d = await digest.interests(ctx.actor);
      const label = (k) => digest.INTEREST_LABELS[k] ?? k;
      return shown(d, `Your digest topics: ${d.mine.interests.map(label).join(', ') || 'none chosen yet'}; email ${d.mine.emailOptIn ? 'on' : 'off'}. Topics on offer: ${d.interests.map((i) => i.label).join(', ')}.`);
    },
  }),

  list_digest_sources: dig({
    operation: 'GET', resultShape: 'LIST',
    description: "Editor (administration, principal): the news feeds approved for the daily digest, with their topics, whether each is approved or paused, and how its last check went. Read-only.",
    permission: 'digest.manage', minScope: 'ALL',
    service: 'digest.service.listSources()',
    async run() {
      const rows = (await digest.listSources()).map((s) => ({ id: s.id, title: s.title, url: s.url, interests: s.interestLabels, status: s.status, lastStatus: s.lastStatus ?? null, lastFetchedAt: s.lastFetchedAt ?? null, lastItemCount: s.lastItemCount ?? null, lastError: s.lastError ?? null }));
      return listed(rows, (s) => `${s.title} (${s.status.toLowerCase()}${s.lastStatus ? `, last check ${s.lastStatus.toLowerCase()}` : ''})`, { noun: 'digest feed' });
    },
  }),

  add_digest_source: dig({
    operation: 'CREATE', risk: RISK.HIGH, affectsOthers: true,
    description: "Editor: approve a news feed (an https RSS or Atom address) for the whole school's daily digest, tagged with one or more topics; its headlines then reach everyone who chose those topics. Private networks and non-https addresses are refused. Confirmed on the website.",
    inputSchema: closed({
      title: text(120, 'A name for the feed, e.g. "ISRO news"'),
      feedAddress: text(500, 'The https RSS / Atom address'),
      interests: list(oneOf(INTERESTS), INTERESTS.length, 'At least one topic'),
    }, ['title', 'feedAddress', 'interests']),
    permission: 'digest.manage', minScope: 'ALL',
    service: 'digest.service.addSource()',
    summarise: (a) => `Approve the feed "${a.title}" (${a.feedAddress}) for the daily digest under ${(a.interests ?? []).map((i) => digest.INTEREST_LABELS[i] ?? i).join(', ')}; its headlines reach everyone who chose those topics`,
    async run(ctx, args) {
      const s = await digest.addSource(ctx.actor, { title: args.title, url: args.feedAddress, interests: args.interests });
      return did('digest_source_added', s, `Approved "${s.title}" for the daily digest (${s.interestLabels.join(', ')}). It is read with the next daily run.`);
    },
  }),

  update_digest_source: dig({
    operation: 'UPDATE', risk: RISK.HIGH, affectsOthers: true,
    description: "Editor: change one of the daily digest's feeds (named): rename it, change its topics, or pause / resume it. Confirmed on the website.",
    inputSchema: closed({
      feed: text(120, 'The feed by its name or address'),
      newTitle: text(120), interests: list(oneOf(INTERESTS), INTERESTS.length),
      status: oneOf(['APPROVED', 'PAUSED'], 'PAUSED stops reading it; APPROVED resumes'),
    }, ['feed']),
    permission: 'digest.manage', minScope: 'ALL',
    service: 'digest.service.updateSource()',
    async prepare(_ctx, args) {
      if (args.newTitle === undefined && args.interests === undefined && args.status === undefined) throw ask('What should change: the name, the topics, or pause / resume it?');
      const s = await theDigestSource(args.feed);
      return { id: s.id, title: s.title };
    },
    summarise: (a, _actor, p) => `Change the digest feed "${p?.title ?? a.feed}": ${[a.newTitle && `rename to "${a.newTitle}"`, a.interests && `topics ${a.interests.map((i) => digest.INTEREST_LABELS[i] ?? i).join(', ')}`, a.status && (a.status === 'PAUSED' ? 'pause it' : 'resume it')].filter(Boolean).join('; ')}`,
    async run(ctx, args, p) {
      const s = await digest.updateSource(ctx.actor, p.id, { ...(args.newTitle !== undefined && { title: args.newTitle }), ...(args.interests && { interests: args.interests }), ...(args.status && { status: args.status }) });
      return did('digest_source_updated', s, `"${s.title}" is ${s.status.toLowerCase()}, topics ${s.interestLabels.join(', ')}.`);
    },
  }),

  check_digest_source: dig({
    operation: 'ACTION', risk: RISK.MEDIUM,
    description: "Editor: read one of the daily digest's feeds (named) now and store its new headlines, to see whether it works. A failing feed is recorded with the reason. Needs confirmation.",
    inputSchema: closed({ feed: text(120, 'The feed by its name or address') }, ['feed']),
    permission: 'digest.manage', minScope: 'ALL',
    service: 'digest.service.checkSource()',
    async prepare(_ctx, args) { const s = await theDigestSource(args.feed); return { id: s.id, title: s.title }; },
    summarise: (a, _actor, p) => `Read the digest feed "${p?.title ?? a.feed}" now and store its new headlines`,
    async run(ctx, _args, p) {
      const out = await digest.checkSource(ctx.actor, p.id);
      const s = out.source;
      return did('digest_source_checked', s, s.lastStatus === 'OK' ? `"${s.title}" works: ${s.lastItemCount ?? 0} item(s) in the feed, ${out.added} new.` : `"${s.title}" failed: ${s.lastError}`);
    },
  }),

  send_daily_digest: dig({
    operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true,
    description: "Editor: run the daily digest now: read every approved feed, rebuild each person's digest for today and email it to those who opted in (once per person per day). Confirmed on the website.",
    permission: 'digest.manage', minScope: 'ALL',
    service: 'digest.service.runDaily()',
    summarise: () => "Run today's digest now: read every approved feed, rebuild everyone's digest and email those who opted in (once per person per day)",
    async run() {
      const out = await digest.runDaily();
      return did('digest_run', null, `Read ${out.sources} feed(s) (${out.failed} failed), ${out.added} new headline(s); built ${out.built} digest(s), emailed ${out.emailed}.`);
    },
  }),
};

/* ── readers ─────────────────────────────────────────────── */

const readerTools = {
  get_newsletter_home: news({
    operation: 'GET',
    description: "Anyone: the caller's newsletter home: the latest weekly and monthly editions, where they left off reading, flashcards due today, their streak and their saved opportunities closing within two weeks. Read-only.",
    permission: 'digest.read',
    service: 'newsletter/editions.service.home()',
    async run(ctx) {
      const h = await editions.home(ctx.actor);
      return shown(h, [
        h.weekly ? `This week: ${h.weekly.title}.` : 'No weekly edition yet.',
        h.monthly ? `This month: ${h.monthly.title}.` : '',
        h.continueReading ? `You were ${h.continueReading.pct}% through ${h.continueReading.title}.` : '',
        `${h.flashcardsDue} flashcard(s) due; streak ${h.streak?.count ?? 0} day(s).`,
        h.closingSoon.length ? `Closing soon: ${h.closingSoon.map((c) => `${c.title} in ${c.daysLeft} day(s)${c.forName ? ` (${c.forName})` : ''}`).join('; ')}.` : '',
      ].filter(Boolean).join(' '));
    },
  }),

  get_my_newsletter_preferences: news({
    operation: 'GET',
    description: "Anyone: the caller's own newsletter settings: weekly / monthly on or off, email copy (students read in EduOS only), interest domains, stream, teacher CPD interests, class quiz board opt-in, language and text size. Read-only.",
    permission: 'digest.read',
    service: 'newsletter/opportunities.service.myPreferences()',
    async run(ctx) {
      const p = await opps.myPreferences(ctx.actor);
      return shown(p, `Weekly ${p.weekly ? 'on' : 'off'}, monthly ${p.monthly ? 'on' : 'off'}, email ${p.email ? 'on' : 'off'}${p.emailAllowed ? '' : ' (students read in EduOS)'}; domains ${p.domains.join(', ') || 'none'}; language ${p.language}; text size ${p.textSize}.`);
    },
  }),

  update_my_newsletter_preferences: news({
    operation: 'UPDATE', risk: RISK.LOW,
    description: "Anyone: change the caller's own newsletter settings: weekly / monthly on or off, the email copy (not for students), interest domains, stream, CPD interests (teachers), joining the class / house quiz board (students; group averages only), language (EN / HI) and text size. Needs confirmation.",
    inputSchema: closed({
      weekly: bool(), monthly: bool(), email: bool('Email copy (adults only)'),
      domains: list(oneOf(OPP_DOMAINS), OPP_DOMAINS.length), stream: oneOf([...OPP_STREAMS, 'NONE']),
      cpdInterests: list(text(60), 10, 'Teachers: professional-development topics'),
      leaderboardOptIn: bool('Students: count towards the class / house quiz averages'),
      language: oneOf(['EN', 'HI']), textSize: oneOf(['S', 'M', 'L']),
    }),
    permission: 'digest.read',
    service: 'newsletter/opportunities.service.setPreferences()',
    async prepare(_ctx, args) {
      if (!Object.keys(args).length) throw ask('Which setting should change: weekly, monthly, email, domains, stream, quiz board, language or text size?');
      return null;
    },
    summarise: (a) => `Change your newsletter settings: ${Object.entries(a).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(', ') || 'none' : typeof v === 'boolean' ? (v ? 'on' : 'off') : v}`).join('; ')}`,
    async run(ctx, args) {
      const body = { ...args };
      if (body.stream === 'NONE') body.stream = null;
      const p = await opps.setPreferences(ctx.actor, body);
      return did('newsletter_preferences_set', null, `Saved. Weekly ${p.weekly ? 'on' : 'off'}, monthly ${p.monthly ? 'on' : 'off'}, email ${p.email ? 'on' : 'off'}.`);
    },
  }),

  get_opportunities_map: news({
    operation: 'GET',
    description: "Anyone: this month's opportunities map: how many published opportunities open or close this month, by level (school to international) and by region (a state, all India, international), with their titles. Read-only.",
    permission: 'digest.read',
    service: 'newsletter/opportunities.service.map()',
    async run(ctx) {
      const m = await opps.map(ctx.actor);
      return shown(m, m.total ? `${m.total} this month. By region: ${m.byRegion.map((r) => `${r.region} ${r.count}`).join(', ')}.` : 'Nothing published opens or closes this month.');
    },
  }),

  get_opportunity: news({
    operation: 'GET',
    description: "Anyone: one opportunity in full (named): summary, type, level, eligibility, dates (or \"check dates\" when the school has not confirmed them), fee, mode, how to apply, organiser and the official link. An editor also sees items waiting for review and its history. Read-only.",
    inputSchema: closed({ title: OPP }, ['title']),
    permission: 'digest.read',
    service: 'newsletter/opportunities.service.get()',
    async run(ctx, args) {
      const found = await theOpportunity(ctx, args.title);
      const o = await opps.get(ctx.actor, found.id);
      return shown(o, `${o.title} (${o.typeLabel}, ${o.levelLabel}). ${excerpt(o.summary, 200)} ${o.dateText}.${o.officialUrl ? ` Official site: ${o.officialUrl}` : ''}`);
    },
  }),

  get_opportunity_official_link: news({
    operation: 'GET',
    description: "Anyone: the official site of a published opportunity (named), to open and apply; opening it from an edition (give the cadence) is counted for that edition. Counting the click is the only thing it records. Read-only.",
    inputSchema: closed({ title: OPP, fromEdition: bool('Opened from the latest edition'), cadence: CADENCE }, ['title']),
    permission: 'digest.read',
    service: 'newsletter/opportunities.service.click() / editions.service.clickFromEdition()',
    async run(ctx, args) {
      const o = await theOpportunity(ctx, args.title, { status: 'PUBLISHED' });
      let out;
      if (args.fromEdition) {
        const e = await theEdition(ctx, { cadence: args.cadence ?? 'WEEKLY' }, { status: 'PUBLISHED' });
        out = await editions.clickFromEdition(ctx.actor, e.id, o.id);
      } else out = await opps.click(ctx.actor, o.id);
      return shown({ title: o.title, officialUrl: out.officialUrl }, out.officialUrl ? `${o.title}: ${out.officialUrl}` : `${o.title} is a school-level item with no outside link; ask the school.`);
    },
  }),

  remove_saved_opportunity: news({
    operation: 'DELETE', risk: RISK.LOW,
    description: "Anyone: take an opportunity (named) off the caller's saved list (a parent: the one saved for a named child), which also stops its reminders. Needs confirmation.",
    inputSchema: closed({ title: OPP, childName: text(60, 'A parent: which child it was saved for') }, ['title']),
    permission: 'digest.read',
    service: 'newsletter/opportunities.service.unsave()',
    async prepare(ctx, args) {
      const rows = await opps.saved(ctx.actor);
      const pool = args.childName ? rows.filter((r) => lower(r.forName).startsWith(lower(args.childName))) : rows;
      const s = pick(pool, args.title, { label: 'saved opportunity', nameOf: (r) => r.opportunity.title, refOf: (r) => r.saveId, describe: (r) => `${r.opportunity.title}${r.forName ? ` (for ${r.forName})` : ''}` });
      return { id: s.opportunity.id, title: s.opportunity.title, studentId: s.studentId, forName: s.forName };
    },
    summarise: (a, _actor, p) => `Remove "${p?.title ?? a.title}"${p?.forName ? ` (saved for ${p.forName})` : ''} from your saved list and stop its reminders`,
    async run(ctx, _args, p) {
      const out = await opps.unsave(ctx.actor, p.id, { ...(p.studentId && { studentId: p.studentId }) });
      return did('opportunity_unsaved', { id: p.id }, out.removed ? `Removed "${p.title}" from your saved list.` : `"${p.title}" was not on your saved list.`);
    },
  }),

  list_opportunity_questions: news({
    operation: 'GET', resultShape: 'LIST',
    description: "Anyone: questions about opportunities: a teacher sees the questions sent to them (\"a parent in Class 6 A\", never a name), a student or parent sees the ones they asked and the answers. Read-only.",
    inputSchema: closed({ open: bool('Only unanswered ones') }),
    permission: 'digest.read',
    service: 'newsletter/opportunities.service.questions()',
    async run(ctx, args) {
      const rows = (await opps.questions(ctx.actor)).filter((q) => !args.open || q.status === 'OPEN');
      return listed(rows, (q) => `${q.opportunity ?? 'An opportunity'}: "${excerpt(q.text, 80)}" (${q.status === 'ANSWERED' ? `answered: ${excerpt(q.answer, 60)}` : `open, ${q.from}`})`, { noun: 'question' });
    },
  }),

  answer_opportunity_question: news({
    operation: 'CREATE', affectsOthers: true,
    description: "Teacher: answer a question a student or parent sent about an opportunity (named by the opportunity or the question's words); the asker is told in EduOS. Confirmed on the website.",
    inputSchema: closed({ question: text(200, 'The opportunity or words from the question'), answer: text(1500) }, ['question', 'answer']),
    permission: 'digest.read', forRoles: NEWS_STAFF, // the service refuses families: staff act only
    service: 'newsletter/opportunities.service.answer()',
    async prepare(ctx, args) {
      const rows = (await opps.questions(ctx.actor)).filter((q) => q.status === 'OPEN');
      const term = lower(args.question);
      const hits = rows.filter((q) => lower(q.opportunity).includes(term) || lower(q.text).includes(term));
      const q = pick(hits.length ? hits : rows, hits.length === 1 ? undefined : args.question, { label: 'open question to you', nameOf: (r) => `${r.opportunity ?? ''}: ${r.text}`, refOf: (r) => r.id, describe: (r) => `${r.opportunity}: "${excerpt(r.text, 60)}" (${r.from})` });
      return { id: q.id, opportunity: q.opportunity, text: q.text, from: q.from };
    },
    summarise: (a, _actor, p) => `Answer ${p ? `${p.from}'s question about ${p.opportunity} ("${excerpt(p.text, 80)}")` : 'the question'}: "${excerpt(a.answer, 200)}"`,
    async run(ctx, args, p) {
      const out = await opps.answer(ctx.actor, p.id, { answer: args.answer });
      return did('opportunity_question_answered', out, `Answer sent to ${p.from.toLowerCase()}.`);
    },
  }),

  list_newsletter_archive: news({
    operation: 'GET', resultShape: 'LIST',
    description: "Anyone: the newsletter's editions (weekly, monthly or both), newest first, with how far the caller read and their quiz score. An editor also sees drafts and withdrawn editions. Read-only.",
    inputSchema: closed({ cadence: CADENCE }),
    permission: 'digest.read',
    service: 'newsletter/editions.service.list()',
    async run(ctx, args) {
      const rows = await editions.list(ctx.actor, { ...(args.cadence && { cadence: args.cadence }) });
      return listed(rows, (e) => `${e.title} (${e.periodLabel}${e.status ? `, ${lower(e.status)}` : ''}${e.myProgress ? `, read ${e.myProgress}%` : ''})`, { noun: 'edition' });
    },
  }),

  finish_newsletter_edition: news({
    operation: 'UPDATE', risk: RISK.LOW,
    description: "Anyone: mark a published edition (the latest weekly by default) as read by the caller, or record how far they got (a percentage), which keeps their \"continue reading\" place. Needs confirmation.",
    inputSchema: closed({ cadence: CADENCE, edition: EDITION, percent: int(0, 100, 'Default 100 (finished)') }),
    permission: 'digest.read',
    service: 'newsletter/editions.service.progress()',
    async prepare(ctx, args) { const e = await theEdition(ctx, args, { status: 'PUBLISHED' }); return { id: e.id, title: e.title }; },
    summarise: (a, _actor, p) => `Mark ${p?.title ?? 'the edition'} as ${(a.percent ?? 100) >= 100 ? 'read' : `${a.percent}% read`}`,
    async run(ctx, args, p) {
      const out = await editions.progress(ctx.actor, p.id, { pct: args.percent ?? 100, section: 'assistant' });
      return did('newsletter_progress_set', { id: p.id }, out.completed ? `${p.title} marked as read.` : `${p.title}: ${out.pct}% read.`);
    },
  }),

  vote_newsletter_poll: news({
    operation: 'ACTION', risk: RISK.LOW,
    description: "Anyone: vote in the poll of a published edition (the latest weekly by default), once, by the option's words or number; the results come back. Needs confirmation.",
    inputSchema: closed({ cadence: CADENCE, edition: EDITION, choice: text(120, 'The option, by its words or number from 1') }, ['choice']),
    permission: 'digest.read',
    service: 'newsletter/editions.service.vote()',
    async prepare(ctx, args) {
      const e = await editionDoc((await theEdition(ctx, args, { status: 'PUBLISHED' })).id);
      if (!e.poll?.question) throw notFound(`${e.title} has no poll.`);
      const n = Number(args.choice);
      const opt = Number.isInteger(n) && e.poll.options[n - 1] ? e.poll.options[n - 1] : pick(e.poll.options, args.choice, { label: 'poll option', nameOf: (o) => o.label, refOf: (o) => o.key });
      return { id: String(e._id), title: e.title, question: e.poll.question, key: opt.key, label: opt.label };
    },
    summarise: (_a, _actor, p) => `Vote "${p?.label}" in ${p?.title}'s poll ("${p?.question}")`,
    async run(ctx, _args, p) {
      const out = await editions.vote(ctx.actor, p.id, { option: p.key });
      return did('newsletter_poll_voted', { id: p.id }, `Voted. ${out.options.map((o) => `${o.label} ${o.pct}%`).join(', ')} (${out.total} vote(s)).`);
    },
  }),

  react_to_newsletter: news({
    operation: 'ACTION', risk: RISK.LOW,
    description: "Anyone: react to a published edition's hook or one of its items (named): useful, inspiring, entering or curious. The same reaction again takes it back. Needs confirmation.",
    inputSchema: closed({ cadence: CADENCE, edition: EDITION, item: text(200, 'An item of the edition by title; omit for the opening hook'), reaction: oneOf(REACTIONS) }, ['reaction']),
    permission: 'digest.read',
    service: 'newsletter/editions.service.react()',
    async prepare(ctx, args) {
      const e = await editionDoc((await theEdition(ctx, args, { status: 'PUBLISHED' })).id);
      let target = 'hook'; let label = 'the opening hook';
      if (args.item) {
        const items = await editions.itemsOf(e);
        const o = pick(items.map((x) => ({ id: String(x._id), title: x.title })), args.item, { label: 'item of this edition', nameOf: (x) => x.title, refOf: (x) => x.id });
        target = o.id; label = `"${o.title}"`;
      }
      return { id: String(e._id), title: e.title, target, label };
    },
    summarise: (a, _actor, p) => `React "${lower(a.reaction)}" to ${p?.label ?? 'the edition'} in ${p?.title ?? 'the newsletter'}`,
    async run(ctx, args, p) {
      const out = await editions.react(ctx.actor, p.id, { target: p.target, kind: args.reaction });
      return did('newsletter_reacted', { id: p.id }, out.mine ? `Reacted "${lower(out.mine)}" to ${p.label}.` : `Took back your reaction to ${p.label}.`);
    },
  }),

  add_newsletter_comment: news({
    operation: 'CREATE', affectsOthers: true,
    description: "Anyone: comment on a published edition or one of its items (named), up to 500 characters. Staff comments show at once under their name; a family's comment waits for staff and shows without a child's name. Confirmed on the website.",
    inputSchema: closed({ cadence: CADENCE, edition: EDITION, item: text(200, 'An item of the edition by title (optional)'), comment: text(500) }, ['comment']),
    permission: 'digest.read',
    service: 'newsletter/editions.service.comment()',
    async prepare(ctx, args) {
      const e = await editionDoc((await theEdition(ctx, args, { status: 'PUBLISHED' })).id);
      let opportunityId = null; let item = null;
      if (args.item) {
        const items = await editions.itemsOf(e);
        const o = pick(items.map((x) => ({ id: String(x._id), title: x.title })), args.item, { label: 'item of this edition', nameOf: (x) => x.title, refOf: (x) => x.id });
        opportunityId = o.id; item = o.title;
      }
      return { id: String(e._id), title: e.title, opportunityId, item };
    },
    summarise: (a, _actor, p) => `Comment on ${p?.item ? `"${p.item}" in ` : ''}${p?.title ?? 'the newsletter'}: "${excerpt(a.comment, 200)}"`,
    async run(ctx, args, p) {
      const out = await editions.comment(ctx.actor, p.id, { text: args.comment, ...(p.opportunityId && { opportunityId: p.opportunityId }) });
      return did('newsletter_commented', out, out.status === 'APPROVED' ? `Posted as ${out.displayName}.` : out.note);
    },
  }),

  answer_newsletter_flashcard: news({
    operation: 'UPDATE', risk: RISK.LOW,
    description: "Anyone: after a spoken flashcard quiz, mark one card (by its front) as known (seen again later) or to review again (back tomorrow); this keeps the caller's streak. Needs confirmation.",
    inputSchema: closed({ card: text(300, 'Words from the front of the card'), result: oneOf(['KNEW', 'REVIEW']) }, ['card', 'result']),
    permission: 'digest.read',
    service: 'newsletter/editions.service.reviewCard()',
    async prepare(ctx, args) {
      const d = await editions.flashcardDeck(ctx.actor, { limit: 30 });
      const c = pick([...d.due, ...d.fresh], args.card, { label: 'flashcard', nameOf: (x) => x.front, refOf: (x) => x.key, describe: (x) => `"${excerpt(x.front, 60)}"` });
      return { key: c.key, front: c.front };
    },
    summarise: (a, _actor, p) => `Mark the card "${excerpt(p?.front ?? a.card, 80)}" as ${a.result === 'KNEW' ? 'known' : 'review again'}`,
    async run(ctx, args, p) {
      const out = await editions.reviewCard(ctx.actor, { cardKey: p.key, result: args.result });
      return did('newsletter_flashcard_reviewed', null, `Next time: ${day(out.dueAt)}. Streak ${out.streak?.count ?? 0} day(s).`);
    },
  }),

  list_pending_newsletter_comments: news({
    operation: 'GET', resultShape: 'LIST',
    description: "Staff who moderate: newsletter comments waiting to be checked (an editor sees all; a teacher sees students' comments), with the edition and how the author is shown. Read-only.",
    permission: 'digest.read',
    service: 'newsletter/editions.service.pendingComments()',
    async run(ctx) {
      const rows = await editions.pendingComments(ctx.actor);
      return listed(rows, (c) => `${c.displayName} on ${c.edition ?? 'an edition'}: "${excerpt(c.text, 80)}"`, { noun: 'pending comment' });
    },
  }),

  moderate_newsletter_comment: news({
    operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true,
    description: "A moderator (an editor, or a teacher for students' comments): APPROVE a pending newsletter comment so readers see it, or REJECT it with a reason. Recorded only when the moderator states the decision in their own words; never suggested. Confirmed on the website.",
    inputSchema: closed({
      comment: text(200, 'Words from the comment, or its author as shown (e.g. "a student in Class 6")'),
      decision: decisionArg(['APPROVE', 'REJECT'], 'the moderator'),
      reason: text(300, 'Required to reject'),
    }, ['comment', 'decision']),
    permission: 'digest.read', forRoles: NEWS_STAFF, // the service refuses families: staff act only
    service: 'newsletter/editions.service.moderate()',
    async prepare(ctx, args) {
      if (args.decision === 'REJECT' && !args.reason) throw ask('Why is it rejected? The author sees the reason.');
      const rows = await editions.pendingComments(ctx.actor);
      const term = lower(args.comment);
      const hits = rows.filter((c) => lower(c.text).includes(term) || lower(c.displayName).includes(term));
      const c = pick(hits.length ? hits : rows, hits.length === 1 ? undefined : args.comment, { label: 'pending comment', nameOf: (x) => x.text, refOf: (x) => x.id, describe: (x) => `${x.displayName}: "${excerpt(x.text, 60)}"` });
      return { id: c.id, text: c.text, displayName: c.displayName, edition: c.edition };
    },
    summarise: (a, _actor, p) => `${a.decision === 'APPROVE' ? 'Approve' : 'Reject'} the comment by ${p?.displayName ?? 'a reader'} on ${p?.edition ?? 'the newsletter'}: "${excerpt(p?.text ?? a.comment, 120)}"${a.decision === 'REJECT' ? ` (reason: ${a.reason})` : ''}`,
    async run(ctx, args, p) {
      const out = await editions.moderate(ctx.actor, p.id, { decision: args.decision, ...(args.reason && { reason: args.reason }) });
      return did('newsletter_comment_moderated', out, out.status === 'APPROVED' ? 'Approved: readers now see it.' : 'Rejected: the author sees your reason.');
    },
  }),

  get_newsletter_edition_extras: news({
    operation: 'GET', resultShape: 'DETAIL',
    description: "Anyone: the extras of a published edition (the latest weekly by default) for the caller: \"this week in 60 seconds\" cards, the deadline radar (7 / 14 / 30 days, confirmed dates only), why each item suits them, their badges and streak, and (students) their quiz challenges. Read-only.",
    inputSchema: closed({ cadence: CADENCE, edition: EDITION }),
    permission: 'digest.read',
    service: 'newsletter/editionsAi.service.extras()',
    async run(ctx, args) {
      const e = await theEdition(ctx, args);
      const x = await editionsAi.extras(ctx.actor, e.id);
      const r = x.deadlineRadar;
      return shown(x, `${x.sixtySeconds[0]?.text ?? e.title} Closing within 7 days: ${r.in7.map((i) => i.title).join('; ') || 'nothing'}; within 14: ${r.in14.length}; within 30: ${r.in30.length}.`);
    },
  }),

  list_newsletter_challenge_classmates: news({
    operation: 'GET', resultShape: 'LIST',
    description: "Students: the classmates (own class only, first name and initial) who can be challenged to a published edition's quiz. Read-only.",
    inputSchema: closed({ cadence: CADENCE, edition: EDITION }),
    permission: 'digest.read',
    service: 'newsletter/editionsAi.service.classmates()',
    async run(ctx, args) {
      const e = await theEdition(ctx, args, { status: 'PUBLISHED' });
      const rows = await editionsAi.classmates(ctx.actor, e.id);
      return listed(rows, (c) => c.name, { noun: 'classmate' });
    },
  }),

  list_my_newsletter_challenges: news({
    operation: 'GET', resultShape: 'LIST',
    description: "Students: the quiz challenges the caller sent and received for a published edition, with who won once both have played (only the two of them see the scores). Read-only.",
    inputSchema: closed({ cadence: CADENCE, edition: EDITION }),
    permission: 'digest.read',
    service: 'newsletter/editionsAi.service.myChallenges()',
    async run(ctx, args) {
      const e = await theEdition(ctx, args, { status: 'PUBLISHED' });
      const c = await editionsAi.myChallenges(ctx.actor, e.id);
      const rows = [...c.sent, ...c.received];
      return listed(rows, (r) => `${r.direction === 'SENT' ? 'to' : 'from'} ${r.with}: ${r.result}`, { noun: 'challenge', extra: { left: c.left, note: c.note } });
    },
  }),

  send_newsletter_quiz_challenge: news({
    operation: 'CREATE', affectsOthers: true,
    description: "Students: challenge a classmate (named, own class only) to a published edition's quiz; they are told in EduOS and only the two of them see the scores. A few challenges per edition. Confirmed on the website.",
    inputSchema: closed({ classmate: text(60, 'First name, e.g. "Aman"'), cadence: CADENCE, edition: EDITION }, ['classmate']),
    permission: 'digest.read',
    service: 'newsletter/editionsAi.service.challenge()',
    async prepare(ctx, args) {
      const e = await theEdition(ctx, args, { status: 'PUBLISHED' });
      const rows = await editionsAi.classmates(ctx.actor, e.id);
      const c = pick(rows, args.classmate, { label: 'classmate', nameOf: (x) => x.name, refOf: (x) => x.studentId });
      if (lower(c.name) !== lower(args.classmate) && !lower(c.name).startsWith(lower(args.classmate))) throw ask(`Did you mean ${c.name}?`);
      return { id: e.id, title: e.title, studentId: c.studentId, name: c.name };
    },
    summarise: (_a, _actor, p) => `Challenge ${p?.name ?? 'a classmate'} to the quiz in ${p?.title ?? 'the newsletter'}`,
    async run(ctx, _args, p) {
      const out = await editionsAi.challenge(ctx.actor, p.id, { studentId: p.studentId });
      return did('newsletter_challenge_sent', { id: p.id }, out.sent ? `Challenge sent to ${out.to}.` : `You already challenged ${out.to} for this edition.`);
    },
  }),
};

/* ── the editor's desk ───────────────────────────────────── */

const OPP_CHANGES = {
  newTitle: text(200), summary: text(1500), type: oneOf(OPP_TYPES), level: oneOf(OPP_LEVELS),
  domains: list(oneOf(OPP_DOMAINS), 5),
  registrationOpens: dateStr('YYYY-MM-DD'), registrationCloses: dateStr('YYYY-MM-DD'), eventDate: dateStr('YYYY-MM-DD'),
  datesConfirmed: bool('Editor: the dates were checked on the official site'),
  gradeMin: int(1, 16), gradeMax: int(1, 16),
  officialUrl: text(500, 'https://… on an allowed official site'), organiser: text(200), region: text(80), fee: text(200), mode: oneOf(OPP_MODES),
  typicalWindow: text(300, 'e.g. "usually opens in July"'), typicalMonths: list(int(1, 12), 12),
};

const editorTools = {
  update_opportunity: news({
    operation: 'UPDATE', affectsOthers: true,
    description: "Editor (or the member of staff who suggested an item still in review): change an opportunity (named): title, summary, type, level, domains, dates, classes, official link (must be on the official-sites list), organiser, region, fee, mode, usual months. Only an editor marks dates confirmed; a moved date is unconfirmed unless confirmed again. Confirmed on the website.",
    inputSchema: closed({ title: OPP, ...OPP_CHANGES }, ['title']),
    permission: 'digest.read', forRoles: NEWS_STAFF, // the service refuses families: staff act only
    service: 'newsletter/opportunities.service.update()',
    async prepare(ctx, args) {
      const { title, newTitle, gradeMin, gradeMax, ...rest } = args;
      if (newTitle === undefined && gradeMin === undefined && gradeMax === undefined && !Object.keys(rest).length) throw ask('What should change on it?');
      if (rest.datesConfirmed !== undefined && !opps.isEditor(ctx.actor)) throw new AppError('Only an editor can confirm dates', 403, [], 'FORBIDDEN');
      const o = await theEditableOpportunity(ctx, title);
      const body = { ...rest, ...(newTitle !== undefined && { title: newTitle }) };
      if (gradeMin !== undefined || gradeMax !== undefined) body.eligibility = { ...(o.eligibility ?? {}), ...(gradeMin !== undefined && { gradeMin }), ...(gradeMax !== undefined && { gradeMax }) };
      return { id: o.id, title: o.title, status: o.status, body };
    },
    summarise: (_a, _actor, p) => `Change "${p?.title}"${p?.status ? ` (${lower(p.status)})` : ''}: ${Object.entries(p?.body ?? {}).map(([k, v]) => `${k} → ${k === 'eligibility' ? `classes ${v.gradeMin ?? '?'}–${v.gradeMax ?? '?'}` : Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : excerpt(v, 80)}`).join('; ')}`,
    async run(ctx, _args, p) {
      const o = await opps.update(ctx.actor, p.id, p.body);
      return did('opportunity_updated', o, `Saved "${o.title}". ${o.dateText}.`);
    },
  }),

  get_newsletter_official_sites: news({
    operation: 'GET',
    description: "Editor: the list of official sites an opportunity's link must be on (and the defaults EduOS ships with). Read-only.",
    permission: 'digest.manage', minScope: 'ALL',
    service: 'newsletter/opportunities.service.getSettings()',
    async run() {
      const s = await opps.getSettings();
      return shown(s, `${s.allowedDomains.length} official site(s): ${s.allowedDomains.slice(0, 15).join(', ')}${s.allowedDomains.length > 15 ? '…' : ''}.`);
    },
  }),

  update_newsletter_official_sites: news({
    operation: 'UPDATE', risk: RISK.HIGH, affectsOthers: true,
    description: "Editor: add sites to, or remove them from, the school's official-sites list that every opportunity link is checked against (e.g. add \"sciencefair.example.org\"). Confirmed on the website.",
    inputSchema: closed({ add: list(text(190), 50, 'Domains to add'), remove: list(text(190), 50, 'Domains to remove') }),
    permission: 'digest.manage', minScope: 'ALL',
    service: 'newsletter/opportunities.service.updateSettings()',
    async prepare(_ctx, args) {
      if (!args.add?.length && !args.remove?.length) throw ask('Which sites should be added or removed?');
      const now = (await opps.getSettings()).allowedDomains;
      const norm = (d) => String(d).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
      const gone = new Set((args.remove ?? []).map(norm));
      const missing = [...gone].filter((d) => !now.includes(d));
      if (missing.length) throw notFound(`Not on the list: ${missing.join(', ')}`);
      const next = [...new Set([...now.filter((d) => !gone.has(d)), ...(args.add ?? []).map(norm)])];
      return { next, added: (args.add ?? []).map(norm).filter((d) => !now.includes(d)), removed: [...gone] };
    },
    summarise: (_a, _actor, p) => `Official sites: ${[p?.added?.length && `add ${p.added.join(', ')}`, p?.removed?.length && `remove ${p.removed.join(', ')}`].filter(Boolean).join('; ') || 'no change'}`,
    async run(ctx, _args, p) {
      const s = await opps.updateSettings(ctx.actor, { allowedDomains: p.next });
      return did('newsletter_official_sites_set', null, `Saved: ${s.allowedDomains.length} official site(s).`);
    },
  }),

  record_opportunity_decision: news({
    operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true,
    description: "Editor: the decision on an opportunity in the review queue (named): PUBLISH it to readers (its link is checked against the official sites again), REJECT it with a reason (the member of staff who suggested it is told), or ARCHIVE it. Recorded only when the editor states the decision in their own words; never suggested. Confirmed on the website.",
    inputSchema: closed({ title: OPP, decision: decisionArg(['PUBLISH', 'REJECT', 'ARCHIVE'], 'the editor'), note: text(500, 'Required to reject') }, ['title', 'decision']),
    permission: 'digest.manage', minScope: 'ALL',
    service: 'newsletter/opportunities.service.review()',
    async prepare(ctx, args) {
      if (args.decision === 'REJECT' && !args.note) throw ask('Why is it rejected? The person who suggested it is told.');
      const o = await theOpportunity(ctx, args.title, args.decision === 'ARCHIVE' ? {} : { status: 'SUBMITTED' });
      return { id: o.id, title: o.title, status: o.status, from: o.submittedByName ?? null };
    },
    summarise: (a, _actor, p) => `${{ PUBLISH: 'Publish', REJECT: 'Reject', ARCHIVE: 'Archive' }[a.decision]} the opportunity "${p?.title ?? a.title}"${p?.from ? ` (from ${p.from})` : ''}${a.note ? ` — ${a.note}` : ''}`,
    async run(ctx, args, p) {
      const o = await opps.review(ctx.actor, p.id, { decision: args.decision, ...(args.note && { note: args.note }) });
      return did('opportunity_decided', o, `"${o.title}" is ${lower(o.status)}.`);
    },
  }),

  add_opportunity_starter_list: news({
    operation: 'ACTION', risk: RISK.MEDIUM,
    description: "Editor: add EduOS's curated starter list of well-known opportunities (olympiads, scholarships, fairs) that the school does not have yet to the review queue. Nothing is published. Needs confirmation.",
    permission: 'digest.manage', minScope: 'ALL',
    service: 'newsletter/opportunities.service.importCatalogue()',
    summarise: () => "Add EduOS's starter list of opportunities the school does not have yet to the review queue (nothing is published)",
    async run(ctx) {
      const out = await opps.importCatalogue(ctx.actor);
      return did('opportunity_starter_list_imported', null, `${out.added} of ${out.total} starter item(s) added to the review queue.`);
    },
  }),

  sync_newsletter_feeds: news({
    operation: 'ACTION', risk: RISK.MEDIUM,
    description: "Editor: look through the last two weeks of the digest's approved feeds for items that look like opportunities and add them to the review queue as candidates (feed text is kept as plain data; nothing is published). Needs confirmation.",
    permission: 'digest.manage', minScope: 'ALL',
    service: 'newsletter/opportunities.service.scanFeeds()',
    summarise: () => "Scan the approved feeds' recent items for opportunities and add them to the review queue (nothing is published)",
    async run() {
      const out = await opps.scanFeeds();
      return did('newsletter_feeds_scanned', null, `Scanned ${out.scanned} feed item(s): ${out.added} new candidate(s) in the review queue.`);
    },
  }),

  update_newsletter_draft: news({
    operation: 'UPDATE', risk: RISK.MEDIUM,
    description: "Editor: change a DRAFT edition (this week's by default): title, intro, opening hook and its question, the poll question, and its items (add or remove published opportunities by title; the flashcards, quiz and poll are rebuilt from the items). Nothing is published or sent. Needs confirmation.",
    inputSchema: closed({
      cadence: CADENCE, edition: EDITION,
      title: text(140), intro: text(600), hook: text(400), hookQuestion: text(200), pollQuestion: text(200),
      addItems: list(text(200), 15, 'Published opportunities to add, by title'), removeItems: list(text(200), 15, 'Items to remove, by title'),
    }),
    permission: 'digest.manage', minScope: 'ALL',
    service: 'newsletter/editions.service.updateDraft()',
    async prepare(ctx, args) {
      const { cadence, edition, ...change } = args;
      if (!Object.keys(change).length) throw ask('What should change in the draft?');
      const e = await theEdition(ctx, { cadence: cadence ?? 'WEEKLY', edition }, { status: 'DRAFT' });
      const body = {};
      if (args.title !== undefined) body.title = args.title;
      if (args.intro !== undefined) body.intro = args.intro;
      if (args.hook !== undefined || args.hookQuestion !== undefined) body.hook = { ...(args.hook !== undefined && { text: args.hook }), ...(args.hookQuestion !== undefined && { question: args.hookQuestion }) };
      if (args.pollQuestion !== undefined) body.pollQuestion = args.pollQuestion;
      const added = []; const removed = [];
      if (args.addItems?.length || args.removeItems?.length) {
        let ids = [...e.opportunityIds];
        if (args.removeItems?.length) {
          const doc = await editionDoc(e.id);
          const current = (await editions.itemsOf(doc)).map((o) => ({ id: String(o._id), title: o.title }));
          for (const t of args.removeItems) {
            const o = pick(current, t, { label: 'item of this draft', nameOf: (x) => x.title, refOf: (x) => x.id });
            ids = ids.filter((x) => x !== o.id); removed.push(o.title);
          }
        }
        for (const t of args.addItems ?? []) {
          // eslint-disable-next-line no-await-in-loop -- a handful of titles
          const o = await publishedByTitle(ctx, t);
          if (!ids.includes(o.id)) { ids.push(o.id); added.push(o.title); }
        }
        if (ids.length > 15) throw new AppError('An edition holds at most 15 items.', 400, [], 'AGENT_NEEDS_INPUT');
        body.opportunityIds = ids;
      }
      return { id: e.id, title: e.title, body, added, removed };
    },
    summarise: (a, _actor, p) => `Change the draft ${p?.title ?? 'edition'}: ${[
      a.title && `title "${a.title}"`, a.intro && 'new intro', a.hook && `hook "${excerpt(a.hook, 80)}"`, a.hookQuestion && 'hook question', a.pollQuestion && `poll "${a.pollQuestion}"`,
      p?.added?.length && `add ${p.added.join(', ')}`, p?.removed?.length && `remove ${p.removed.join(', ')}`,
    ].filter(Boolean).join('; ')} (nothing is published or sent)`,
    async run(ctx, _args, p) {
      const e = await editions.updateDraft(ctx.actor, p.id, p.body);
      return did('newsletter_draft_updated', e, `Saved the draft ${e.title}: ${e.opportunityIds.length} item(s), ${e.quiz} quiz question(s). Publish it when it is right.`);
    },
  }),

  transition_newsletter_edition: news({
    operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true,
    description: "Editor: move an edition along: publish a DRAFT (this week's by default), which delivers it in EduOS to every reader who keeps that cadence on and emails adults who turned the email on; or withdraw a PUBLISHED edition (with a reason) so readers no longer see it. Confirmed on the website.",
    inputSchema: closed({ step: oneOf(['publish', 'withdraw']), cadence: CADENCE, edition: EDITION, reason: text(300, 'Why it is withdrawn') }, ['step']),
    permission: 'digest.manage', minScope: 'ALL',
    service: 'newsletter/editions.service.publish() / withdraw()',
    async prepare(ctx, args) {
      const e = await theEdition(ctx, { cadence: args.cadence ?? 'WEEKLY', edition: args.edition }, { status: args.step === 'publish' ? 'DRAFT' : 'PUBLISHED' });
      return { id: e.id, title: e.title, period: e.periodLabel, items: e.opportunityIds?.length ?? 0 };
    },
    summarise: (a, _actor, p) => (a.step === 'publish'
      ? `Publish ${p?.title ?? 'the draft'} (${p?.period ?? ''}, ${p?.items ?? 0} item(s)): delivered in EduOS to every reader of this cadence and emailed to adults who turned the email on`
      : `Withdraw ${p?.title ?? 'the edition'} (${p?.period ?? ''}) so readers no longer see it${a.reason ? ` — ${a.reason}` : ''}`),
    async run(ctx, args, p) {
      if (args.step === 'publish') {
        const out = await editions.publish(ctx.actor, p.id);
        const d = out.delivery;
        return did('newsletter_edition_published', out.edition, `${out.edition.title} is published.${d ? ` Delivered in EduOS to ${d.inApp}; ${d.emailQueued} email(s) queued.` : ''}`);
      }
      const e = await editions.withdraw(ctx.actor, p.id, { reason: args.reason });
      return did('newsletter_edition_withdrawn', e, `${e.title} is withdrawn.`);
    },
  }),
};

/* ── alert feeds (Google Alerts RSS and other feeds) ─────── */

const ALERT_STATUSES = ['NEW', 'CANDIDATE', 'DUPLICATE', 'SKIPPED', 'FAILED'];

const alertTools = {
  get_google_alerts_guide: alertsTool({
    module: NEWS, operation: 'GET',
    description: "Editor: how to add a Google Alert to the newsletter (Google Alerts has no API; its RSS delivery is read like any feed): the steps, suggested search words by domain and level (with the school's state), and whether AI extraction is on. Read-only.",
    permission: 'digest.manage', minScope: 'ALL',
    service: 'newsletter/alerts.service.guide()',
    async run() {
      const g = await alerts.guide();
      return shown(g, `${g.steps.map((s, i) => `${i + 1}. ${s}`).join(' ')} The feed address looks like ${g.urlPattern}. ${g.aiExtraction}`);
    },
  }),

  list_newsletter_alert_sources: alertsTool({
    module: NEWS, operation: 'GET', resultShape: 'LIST',
    description: "Editor: the newsletter's alert feeds (Google Alerts RSS and other feeds) with their tags, whether each is approved or paused, its last check and the items it found. Read-only.",
    permission: 'digest.manage', minScope: 'ALL',
    service: 'newsletter/alerts.service.listSources()',
    async run(ctx) {
      const rows = (await alerts.listSources(ctx.actor)).map((s) => ({ id: s.id, title: s.title, kind: s.kindLabel, url: s.url, status: s.status, sample: Boolean(s.sample), lastStatus: s.lastStatus ?? null, lastFetchedAt: s.lastFetchedAt ?? null, itemsFound: s.itemsFound ?? 0, tags: s.tagLabels, lastError: s.lastError ?? null }));
      return listed(rows, (s) => `${s.title} (${s.kind}, ${lower(s.status)}${s.sample ? ', sample' : ''}${s.lastStatus ? `, last check ${lower(s.lastStatus)}` : ''})`, { noun: 'alert feed' });
    },
  }),

  update_newsletter_alert_feed: alertsTool({
    module: NEWS, operation: 'UPDATE', risk: RISK.MEDIUM,
    description: "Editor: change one of the newsletter's alert feeds (named): rename it, change the words it watches or its tags (domains, level, region), or pause / resume it. Items only ever become review-queue candidates. Needs confirmation.",
    inputSchema: closed({
      feed: text(120, 'The feed by its name or address'),
      newTitle: text(120), query: text(200, 'The words the alert watches'),
      domains: list(oneOf(OPP_DOMAINS), 5), level: oneOf(OPP_LEVELS), region: text(80),
      status: oneOf(['APPROVED', 'PAUSED']),
    }, ['feed']),
    permission: 'digest.manage', minScope: 'ALL',
    service: 'newsletter/alerts.service.updateSource()',
    async prepare(ctx, args) {
      const { feed, newTitle, query, domains, level, region, status } = args;
      if ([newTitle, query, domains, level, region, status].every((v) => v === undefined)) throw ask('What should change: the name, the words it watches, its tags, or pause / resume it?');
      const s = await theAlertFeed(ctx, feed);
      const tags = domains !== undefined || level !== undefined || region !== undefined ? { ...(domains !== undefined && { domains }), ...(level !== undefined && { level }), ...(region !== undefined && { region }) } : undefined;
      return { id: s.id, title: s.title, body: { ...(newTitle !== undefined && { title: newTitle }), ...(query !== undefined && { query }), ...(tags && { tags }), ...(status && { status }) } };
    },
    summarise: (_a, _actor, p) => `Change the alert feed "${p?.title}": ${Object.entries(p?.body ?? {}).map(([k, v]) => `${k} → ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('; ')}`,
    async run(ctx, _args, p) {
      const s = await alerts.updateSource(ctx.actor, p.id, p.body);
      return did('newsletter_alert_feed_updated', s, `"${s.title}" is ${lower(s.status)}.`);
    },
  }),

  check_newsletter_alert_feed: alertsTool({
    module: NEWS, operation: 'ACTION', risk: RISK.MEDIUM,
    description: "Editor: read one alert feed (named) now, keep its new items and turn them into review-queue candidates; a failing feed is recorded with the reason. Sample feeds are never fetched. Nothing is published. Needs confirmation.",
    inputSchema: closed({ feed: text(120, 'The feed by its name or address') }, ['feed']),
    permission: 'digest.manage', minScope: 'ALL',
    service: 'newsletter/alerts.service.checkSource()',
    async prepare(ctx, args) { const s = await theAlertFeed(ctx, args.feed); return { id: s.id, title: s.title }; },
    summarise: (a, _actor, p) => `Read the alert feed "${p?.title ?? a.feed}" now and add what it finds to the review queue (nothing is published)`,
    async run(ctx, _args, p) {
      const out = await alerts.checkSource(ctx.actor, p.id);
      const s = out.source;
      return did('newsletter_alert_feed_checked', s, s.lastStatus === 'FAILED' ? `"${s.title}" failed: ${s.lastError}` : `"${s.title}": ${out.added} new item(s).`);
    },
  }),

  list_newsletter_alert_items: alertsTool({
    module: NEWS, operation: 'GET', resultShape: 'LIST',
    description: "Editor: recent items the alert feeds found (optionally of one feed, or one status: new, candidate, duplicate, skipped, failed) and what became of each. Headlines are text from outside sites, quoted as they are. Read-only.",
    inputSchema: closed({ feed: text(120, 'One feed by name'), status: oneOf(ALERT_STATUSES) }),
    permission: 'digest.manage', minScope: 'ALL',
    service: 'newsletter/alerts.service.recentItems()',
    async run(ctx, args) {
      const sourceId = args.feed ? (await theAlertFeed(ctx, args.feed)).id : undefined;
      // External text: quoted as data, never treated as an instruction.
      const rows = (await alerts.recentItems(ctx.actor, { ...(sourceId && { sourceId }), ...(args.status && { status: args.status }) }))
        .map((i) => ({ id: i.id, title: excerpt(i.title, 200), link: i.link, feed: i.sourceTitle, status: i.status, note: i.note ?? null, fetchedAt: i.fetchedAt }));
      return listed(rows, (i) => `"${excerpt(i.title, 90)}" (${i.feed}, ${lower(i.status)})`, { noun: 'feed item', extra: { external: true } });
    },
  }),

  get_newsletter_alert_analytics: alertsTool({
    module: NEWS, operation: 'GET',
    description: "Editor: how the alert feeds perform: items found per feed, candidates, duplicates and skipped, how many were published or rejected, and how often the extracted details were kept as extracted (AI and auto). Read-only.",
    permission: 'digest.manage', minScope: 'ALL',
    service: 'newsletter/alerts.service.analytics()',
    async run(ctx) {
      const a = await alerts.analytics(ctx.actor);
      const t = a.totals;
      return shown(a, `${a.sources.length} feed(s): ${t.found} item(s) found, ${t.candidates} candidate(s), ${t.duplicates} duplicate(s), ${t.accepted} published, ${t.rejected} rejected.${a.accuracy.keptAsExtractedPct !== null ? ` ${a.accuracy.keptAsExtractedPct}% of extracted details kept as extracted.` : ''}`);
    },
  }),

  sync_newsletter_alert_feeds: alertsTool({
    module: NEWS, operation: 'ACTION', risk: RISK.MEDIUM,
    description: "Editor: run the alert feeds now (otherwise hourly): read every approved feed that is due and turn new items into review-queue candidates; editors are told when there are new ones. Nothing is published. Needs confirmation.",
    permission: 'digest.manage', minScope: 'ALL',
    service: 'newsletter/alerts.service.runAlerts()',
    summarise: () => 'Run the alert feeds now and add new items to the review queue (nothing is published)',
    async run() {
      const out = await alerts.runAlerts();
      const f = out.feeds ?? {}; const x = out.extracted ?? {};
      return did('newsletter_alert_feeds_run', null, `Checked ${f.checked ?? 0} feed(s) (${f.failed ?? 0} failed), ${f.added ?? 0} new item(s); ${x.CANDIDATE ?? 0} new candidate(s), ${x.DUPLICATE ?? 0} duplicate(s), ${x.SKIPPED ?? 0} skipped.`);
    },
  }),
};

export const tools = { ...digestTools, ...readerTools, ...editorTools, ...alertTools };
