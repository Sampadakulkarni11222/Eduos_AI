import * as opps from '../../../newsletter/opportunities.service.js';
import * as editions from '../../../newsletter/editions.service.js';
import { NewsletterEdition, OPP_TYPES, OPP_DOMAINS, OPP_LEVELS } from '../../../../models/newsletter.model.js';
import { TYPE_LABELS } from '../../../newsletter/matching.js';
import { childrenOf } from '../../../ptm/relations.js';
import { AppError } from '../../../../utils/AppError.js';
import { featureEnabled } from '../../../../utils/features.js';
import { ok, action } from '../protocol.js';
import { RISK, theNamed } from './_shared.js';

/**
 * Opportunities and the weekly / monthly newsletter, through the assistant
 * (part 4). The same services the Opportunities and Newsletter desk screens
 * use, so the rules cannot drift:
 *
 *   find_opportunities            GET     matches for me / my child, this month, with the reason
 *   check_opportunity_eligibility GET     "Can I enter?" for me, my child, or a class / age typed in
 *   save_opportunity              CREATE  save an item (for a child) with deadline reminders
 *   list_saved_opportunities      GET     what I saved, soonest deadline first
 *   ask_teacher_about_opportunity CREATE  a student or parent asks the class teacher
 *   suggest_opportunity           CREATE  staff add an item to the editor's review queue
 *   get_newsletter_edition        GET     this week's / this month's edition: hook, items, deadlines
 *   get_newsletter_flashcards     GET     the cards due today and new ones, for a spoken quiz
 *   answer_newsletter_quiz        ACTION  submit the edition's three quiz answers (once)
 *   draft_newsletter              CREATE  editor: draft (or rebuild the draft of) this week's / month's edition
 *   get_newsletter_analytics      GET     editor: opens, clicks, quiz participation, saves
 *
 * Every write is drafted and confirmed by the same person. Nothing here
 * publishes an item or an edition, approves a comment or sends the
 * newsletter: the editor does that on the Newsletter desk.
 */

const text = (max, description) => ({ type: 'string', maxLength: max, ...(description && { description }) });
const closed = (properties, required = []) => ({ type: 'object', properties, ...(required.length && { required }), additionalProperties: false });
const childSchema = { childName: text(60, 'A parent: which child, e.g. "Riya". Omit for all of your children (or yourself).') };
const cadenceSchema = { cadence: { type: 'string', enum: ['WEEKLY', 'MONTHLY'], description: 'Default WEEKLY' } };
const istMonth = () => new Date(Date.now() + 330 * 60_000).getUTCMonth() + 1;

async function requireOn() {
  if (!(await featureEnabled('newsletter'))) throw new AppError('Opportunities and the newsletter are switched off for this school.', 403, [], 'FEATURE_OFF');
}
/** Off means the screen is off, and so is the assistant. */
function behind(tool) {
  const { run, prepare } = tool;
  return {
    ...tool,
    feature: 'newsletter',
    async run(ctx, args, prepared) { await requireOn(); return run.call(this, ctx, args, prepared); },
    ...(prepare && { async prepare(ctx, args) { await requireOn(); return prepare.call(this, ctx, args); } }),
  };
}

/** A parent's child by first name (their own children only), or null when not named. */
async function theChild(ctx, childName) {
  if (!childName) return null;
  if (ctx.actor.roleKey !== 'PARENT') throw new AppError('Only a parent names a child here.', 400, [], 'AGENT_NEEDS_INPUT');
  const kids = await childrenOf(ctx.actor.profileId);
  return theNamed(kids, childName, { label: 'child of yours', nameOf: (k) => k.name.split(' ')[0], describe: (k) => k.name });
}

async function theOpportunity(ctx, title) {
  const rows = (await opps.list(ctx.actor, { q: title })).items;
  const pool = rows.length ? rows : (await opps.list(ctx.actor, {})).items;
  return theNamed(pool, title, { label: 'opportunity', nameOf: (o) => o.title, describe: (o) => `${o.title} (${o.typeLabel})` });
}

async function theEdition(ctx, cadence = 'WEEKLY') {
  const e = await NewsletterEdition.findOne({ cadence, status: 'PUBLISHED' }).sort({ publishedAt: -1 }).select('_id').lean();
  if (!e) throw new AppError(`There is no published ${cadence === 'MONTHLY' ? 'monthly' : 'weekly'} newsletter yet.`, 404, [], 'NOT_FOUND');
  return editions.read(ctx.actor, String(e._id));
}

const brief = (o) => ({ title: o.title, type: o.typeLabel, level: o.levelLabel, when: o.dateText, daysLeft: o.daysLeft, organiser: o.organiser, officialUrl: o.officialUrl });

export const newsletterP4Tools = {
  find_opportunities: behind({
    module: 'Newsletter', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: "Competitions, olympiads, scholarships, exams, hackathons, fairs and programmes the school published that suit the caller (a student), each of a parent's own children, or a teacher's classes, with the reason (\"Because Riya is in Class 9 and in the Robotics club\"). Optional: this month only, a type or a domain. Dates not confirmed by the school say so. Read-only.",
    inputSchema: closed({
      ...childSchema, thisMonth: { type: 'boolean', description: 'Only what opens or closes this month' },
      type: { type: 'string', enum: OPP_TYPES }, domain: { type: 'string', enum: OPP_DOMAINS },
    }),
    permission: 'digest.read',
    service: 'newsletter/opportunities.service.matches()',
    async run(ctx, args) {
      const child = await theChild(ctx, args.childName);
      const out = await opps.matches(ctx.actor, { ...(child && { studentId: child.studentId }), ...(args.thisMonth && { month: istMonth() }) }, { limit: 10 });
      const groups = out.contexts.map((c) => ({
        for: c.kind === 'TEACHER' ? 'your classes and you' : (c.name ?? 'you'),
        items: c.items.filter((i) => (!args.type || i.type === args.type) && (!args.domain || i.domains.includes(args.domain))).map((i) => ({ ...brief(i), reason: i.reason })),
      }));
      const total = groups.reduce((n, g) => n + g.items.length, 0);
      return ok({ groups, note: 'Matches use the class, age, clubs, portfolio strengths and chosen interests the school holds. Always check the official site before applying.' }, {
        speak: total ? groups.map((g) => `For ${g.for}: ${g.items.slice(0, 4).map((i) => `${i.title} (${i.reason ?? i.type})`).join('; ') || 'nothing yet'}`).join('. ') : 'Nothing published matches yet. Try without the month, or ask the school to add items.',
      });
    },
  }),

  check_opportunity_eligibility: behind({
    module: 'Newsletter', operation: 'GET', risk: RISK.LOW,
    description: '"Can I enter?" for one published opportunity (named): YES, NO or CHECK with the reasons, for the caller, each of a parent\'s own children (or one named), or for a class / age / stream given. Read-only.',
    inputSchema: closed({ title: text(200, 'The opportunity, e.g. "science olympiad"'), ...childSchema, grade: { type: 'integer', minimum: 1, maximum: 16 }, age: { type: 'integer', minimum: 3, maximum: 30 }, stream: { type: 'string', enum: ['SCIENCE', 'COMMERCE', 'HUMANITIES'] } }, ['title']),
    permission: 'digest.read',
    service: 'newsletter/opportunities.service.eligibility()',
    async run(ctx, args) {
      const o = await theOpportunity(ctx, args.title);
      const child = await theChild(ctx, args.childName);
      const manual = args.grade !== undefined || args.age !== undefined || args.stream !== undefined;
      const out = await opps.eligibility(ctx.actor, o.id, manual ? { grade: args.grade, age: args.age, stream: args.stream } : { ...(child && { studentId: child.studentId }) });
      const results = out.results ?? [{ for: out.for ?? 'the details given', verdict: out.verdict, reasons: out.reasons }];
      return ok({ opportunity: o.title, results, officialUrl: o.officialUrl }, { speak: results.map((r) => `${r.for}: ${r.verdict === 'YES' ? 'yes' : r.verdict === 'NO' ? 'no' : 'check'} — ${r.reasons[0]}`).join('. ') });
    },
  }),

  save_opportunity: behind({
    module: 'Newsletter', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: 'Save a published opportunity (named) to the caller\'s list, for themselves or (a parent) for one of their own children, with deadline reminders by default (7, 3 and 1 day before a confirmed closing date; or when its usual month comes if dates are not confirmed). Needs confirmation.',
    inputSchema: closed({ title: text(200, 'The opportunity, e.g. "science olympiad"'), ...childSchema, remind: { type: 'boolean', description: 'Default true' } }, ['title']),
    permission: 'digest.read',
    service: 'newsletter/opportunities.service.save()',
    async prepare(ctx, args) {
      const o = await theOpportunity(ctx, args.title);
      const child = await theChild(ctx, args.childName);
      return { id: o.id, title: o.title, when: o.dateText, studentId: child?.studentId ?? null, childName: child?.name ?? null, remind: args.remind !== false };
    },
    summarise: (_a, _actor, p) => `Save "${p.title}"${p.childName ? ` for ${p.childName}` : ''}${p.remind ? ' and remind you before it closes' : ''} (${p.when})`,
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const out = await opps.save(ctx.actor, p.id, { studentId: p.studentId, remind: p.remind });
      return action({ type: 'opportunity_saved', id: out.id, data: { title: p.title, remind: out.remind, reminder: out.reminder }, speak: `Saved "${p.title}". ${out.reminder ?? ''}`.trim() });
    },
  }),

  list_saved_opportunities: behind({
    module: 'Newsletter', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: "What the caller saved (a parent: for which child), soonest confirmed deadline first, with whether reminders are on. Read-only.",
    inputSchema: closed({}),
    permission: 'digest.read',
    service: 'newsletter/opportunities.service.saved()',
    async run(ctx) {
      const rows = await opps.saved(ctx.actor);
      const items = rows.map((r) => ({ ...brief(r.opportunity), for: r.forName ?? null, remind: r.remind }));
      return ok({ items }, { speak: items.length ? items.slice(0, 6).map((i) => `${i.title}${i.for ? ` (${i.for})` : ''}: ${i.daysLeft !== null ? `${i.daysLeft} day(s) left` : 'dates to check'}`).join('; ') : 'Nothing saved yet.' });
    },
  }),

  ask_teacher_about_opportunity: behind({
    module: 'Newsletter', operation: 'CREATE', risk: RISK.LOW, confirm: true, forRoles: ['STUDENT', 'PARENT'],
    description: 'A student or parent asks about a published opportunity (named): the question goes to the class teacher (and a subject teacher of that domain) in EduOS, who answers there. The teacher sees "a student / parent in Class 6 A", not a name in the notice. Needs confirmation.',
    inputSchema: closed({ title: text(200), question: text(600), ...childSchema }, ['title', 'question']),
    permission: 'digest.read',
    service: 'newsletter/opportunities.service.ask()',
    async prepare(ctx, args) {
      const o = await theOpportunity(ctx, args.title);
      const child = await theChild(ctx, args.childName);
      return { id: o.id, title: o.title, studentId: child?.studentId ?? null, childName: child?.name ?? null, question: args.question.trim() };
    },
    summarise: (_a, _actor, p) => `Ask the class teacher about "${p.title}"${p.childName ? ` (for ${p.childName})` : ''}: "${p.question}"`,
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const out = await opps.ask(ctx.actor, p.id, { text: p.question, studentId: p.studentId });
      return action({ type: 'opportunity_question_sent', id: out.id, data: out, speak: `Sent to ${out.sentTo.join(', ')}. You will see the answer under Opportunities → Questions.` });
    },
  }),

  suggest_opportunity: behind({
    module: 'Newsletter', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    forRoles: ['ADMIN', 'PRINCIPAL', 'TEACHER', 'LIBRARIAN', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'WARDEN', 'NURSE', 'TRUSTEE'],
    description: "Staff: add an opportunity to the newsletter's review queue (an editor publishes it): title, summary, type, level, domains, classes, official https link (must be an allowed official site; a school-level item may have none), organiser and the usual months. Dates are left unconfirmed. Needs confirmation.",
    inputSchema: closed({
      title: text(200), summary: text(1500), type: { type: 'string', enum: OPP_TYPES }, level: { type: 'string', enum: OPP_LEVELS },
      domains: { type: 'array', maxItems: 5, items: { type: 'string', enum: OPP_DOMAINS } }, gradeMin: { type: 'integer', minimum: 1, maximum: 16 }, gradeMax: { type: 'integer', minimum: 1, maximum: 16 },
      officialUrl: text(500, 'https://… on the organiser\'s official site'), organiser: text(200), typicalMonths: { type: 'array', maxItems: 12, items: { type: 'integer', minimum: 1, maximum: 12 } },
    }, ['title', 'summary', 'type', 'level']),
    permission: 'digest.read',
    service: 'newsletter/opportunities.service.create()',
    async prepare(ctx, args) {
      if (args.officialUrl) await opps.checkOfficialUrl(args.officialUrl);
      else if (args.level !== 'SCHOOL') throw new AppError('What is the official https link? (Only a school-level item may have none.)', 400, [], 'AGENT_NEEDS_INPUT');
      return {
        title: args.title, summary: args.summary, type: args.type, level: args.level, domains: args.domains ?? [], officialUrl: args.officialUrl ?? null, organiser: args.organiser ?? null,
        eligibility: { gradeMin: args.gradeMin ?? null, gradeMax: args.gradeMax ?? null }, typicalMonths: args.typicalMonths ?? [],
      };
    },
    summarise: (_a, _actor, p) => `Add "${p.title}" (${TYPE_LABELS[p.type]}, ${p.level.toLowerCase()}) to the newsletter review queue${p.officialUrl ? `, link ${p.officialUrl}` : ''}`,
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const out = await opps.create(ctx.actor, p);
      return action({ type: 'opportunity_suggested', id: out.id, data: { title: out.title, status: out.status }, speak: `"${out.title}" is in the review queue. An editor publishes it from the Newsletter desk.` });
    },
  }),

  get_newsletter_edition: behind({
    module: 'Newsletter', operation: 'GET', risk: RISK.LOW,
    description: "The latest published weekly (default) or monthly newsletter, as the caller sees it: the opening hook, the items with dates (or \"check dates\"), deadlines closing soon, the caller's matches with reasons, the quiz (answers hidden until taken) and the poll. Opening it counts as reading it. Read-only.",
    inputSchema: closed({ ...cadenceSchema }),
    permission: 'digest.read',
    service: 'newsletter/editions.service.read()',
    async run(ctx, args) {
      const e = await theEdition(ctx, args.cadence ?? 'WEEKLY');
      const data = {
        title: e.title, period: e.periodLabel, hook: e.hook?.text, question: e.hook?.question, items: e.items.map(brief),
        deadlines: e.deadlines.map((d) => ({ title: d.title, daysLeft: d.daysLeft })), forYou: e.forYou.map((c) => ({ for: c.name ?? 'you', items: c.items.slice(0, 3).map((i) => ({ title: i.title, reason: i.reason })) })),
        quiz: { questions: e.quiz.questions.length, answered: e.quiz.answered, score: e.quiz.score }, poll: e.poll ? { question: e.poll.question, voted: Boolean(e.poll.myChoice) } : null,
        flashcards: e.flashcards.length, link: `/opportunities?edition=${e.id}`,
      };
      return ok(data, { speak: `${e.title} (${e.periodLabel}). ${e.hook?.text ?? ''} ${e.items.length} item(s): ${e.items.slice(0, 4).map((i) => i.title).join('; ')}.${e.deadlines.length ? ` Closing soon: ${e.deadlines.slice(0, 3).map((d) => `${d.title} in ${d.daysLeft} day(s)`).join('; ')}.` : ''}` });
    },
  }),

  get_newsletter_flashcards: behind({
    module: 'Newsletter', operation: 'GET', risk: RISK.LOW,
    description: "The caller's newsletter flashcards for a quick spoken quiz: the cards due for review today (spaced repetition across editions) and new ones from the latest editions, front and back, with the caller's streak. Ask the front, wait for the answer, then reveal the back. Marking cards known happens on the Flashcards screen. Read-only.",
    inputSchema: closed({ limit: { type: 'integer', minimum: 1, maximum: 15 } }),
    permission: 'digest.read',
    service: 'newsletter/editions.service.flashcardDeck()',
    async run(ctx, args) {
      const d = await editions.flashcardDeck(ctx.actor, { limit: args.limit ?? 8 });
      const cards = [...d.due, ...d.fresh].map((c) => ({ front: c.front, back: c.back, due: c.box !== null, edition: c.edition }));
      return ok({ cards, streak: d.streak, stats: d.stats }, { speak: cards.length ? `${cards.length} card(s). Streak: ${d.streak.count ?? 0} day(s). First: ${cards[0].front}` : 'No flashcards yet: they come with each newsletter edition.' });
    },
  }),

  answer_newsletter_quiz: behind({
    module: 'Newsletter', operation: 'ACTION', risk: RISK.LOW, confirm: true,
    description: "Submit the caller's answers to the latest weekly (default) or monthly edition's three-question quiz (option numbers from 1), once; the result and explanations come straight back. A student who joined the class / house board counts only towards group averages. Needs confirmation.",
    inputSchema: closed({ ...cadenceSchema, answers: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'integer', minimum: 1, maximum: 6 } } }, ['answers']),
    permission: 'digest.read',
    service: 'newsletter/editions.service.answerQuiz()',
    async prepare(ctx, args) {
      const e = await theEdition(ctx, args.cadence ?? 'WEEKLY');
      if (e.quiz.answered) throw new AppError('You have already taken this quiz.', 409, [], 'ALREADY_ANSWERED');
      if (e.quiz.questions.length !== args.answers.length) throw new AppError(`This quiz has ${e.quiz.questions.length} questions.`, 400, [], 'AGENT_NEEDS_INPUT');
      const picks = args.answers.map((a, i) => {
        const opt = e.quiz.questions[i].options[a - 1];
        if (!opt) throw new AppError(`Question ${i + 1} has ${e.quiz.questions[i].options.length} options.`, 400, [], 'AGENT_NEEDS_INPUT');
        return opt;
      });
      return { editionId: e.id, title: e.title, answers: args.answers.map((a) => a - 1), picks };
    },
    summarise: (_a, _actor, p) => `Submit your quiz answers for ${p.title}: ${p.picks.map((x, i) => `${i + 1}. ${x}`).join('; ')}`,
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const out = await editions.answerQuiz(ctx.actor, p.editionId, { answers: p.answers });
      return action({ type: 'newsletter_quiz_answered', data: out, speak: `You scored ${out.score} out of ${out.outOf}. ${out.feedback.map((f, i) => `${i + 1}: ${f.correct ? 'right' : 'not quite'} — ${f.explain}`).join(' ')}` });
    },
  }),

  draft_newsletter: behind({
    module: 'Newsletter', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: "Editor: draft this week's (default) or this month's newsletter from the published opportunities: hook, items, flashcards, a three-question quiz and a poll. If a draft already exists it is kept, unless rebuild is true (a published edition is never changed). The draft is not sent: the editor reviews and publishes it on the Newsletter desk. Needs confirmation.",
    inputSchema: closed({ ...cadenceSchema, rebuild: { type: 'boolean', description: 'Rebuild an existing draft' } }),
    permission: 'digest.manage', minScope: 'ALL',
    service: 'newsletter/editions.service.generate()',
    summarise: (a) => `${a.rebuild ? 'Rebuild' : 'Draft'} ${a.cadence === 'MONTHLY' ? "this month's" : "this week's"} newsletter (not sent until you publish it on the Newsletter desk)`,
    async run(ctx, args) {
      const out = await editions.generate({ cadence: args.cadence ?? 'WEEKLY', by: 'ASSISTANT', actor: ctx.actor, force: args.rebuild === true });
      const e = out.edition;
      const state = out.created ? 'drafted' : out.rebuilt ? 'rebuilt' : `already exists (${e.status.toLowerCase()})`;
      return action({ type: 'newsletter_drafted', id: e._id, data: { title: e.title, period: e.periodLabel, status: e.status, items: e.opportunityIds.length, quiz: e.quiz.length, flashcards: e.flashcards.length, link: `/newsletter-desk?tab=editions&id=${e._id}` }, speak: `${e.title} (${e.periodLabel}) ${state}: ${e.opportunityIds.length} item(s), ${e.quiz.length} quiz question(s), ${e.flashcards.length} flashcard(s). Review and publish it on the Newsletter desk.` });
    },
  }),

  get_newsletter_analytics: behind({
    module: 'Newsletter', operation: 'GET', risk: RISK.LOW,
    description: 'Editor: how the newsletter is doing, per edition: delivered, emailed (and how: sent or simulated), opens in EduOS, completed, clicks to official sites, quiz participants and average, poll votes, saves and comments. No tracking pixels: opens are counted in the app only. Read-only.',
    inputSchema: closed({}),
    permission: 'digest.manage', minScope: 'ALL',
    service: 'newsletter/editions.service.analytics()',
    async run(ctx) {
      const a = await editions.analytics(ctx.actor);
      return ok(a, { speak: a.editions.length ? `${a.editions.length} edition(s): ${a.totals.opens} open(s), ${a.totals.clicks} click(s), ${a.totals.quizParticipants} quiz player(s), ${a.totals.saves} save(s). Latest: ${a.editions[0].title}, ${a.editions[0].opens} open(s).` : 'No published editions yet.' });
    },
  }),
};
