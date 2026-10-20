import {
  Opportunity, NewsletterEdition, NewsletterRead, FlashcardReview, OpportunitySave,
} from '../../models/newsletter.model.js';
import { NewsletterChallenge } from '../../models/newsletterAi.model.js';
import { Student, Enrollment } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { notify } from '../notifications/notification.service.js';
import { requireProfile, assertObjectId, pushHistory } from '../ops/common.js';
import * as opps from './opportunities.service.js';
import * as editions from './editions.service.js';
import { checkEligibility, scoreFor, reasonText, daysLeft, TYPE_LABELS } from './matching.js';
import { writeWithAi, SECTIONS } from './ai/editionWriter.js';
import { llmOn } from './ai/llm.js';

/**
 * The richer interactive layer of an edition (part 5), all from what the
 * school already holds:
 *
 *   - "Regenerate this section" for the editor, on a draft only: the AI
 *     writes a fresh version (checked against the items like the first one),
 *     or without a key the template writes it again;
 *   - "This week in 60 seconds": swipe cards, one per item, each with its
 *     deadline chip and the reader's own "because you ..." reason;
 *   - a deadline radar: confirmed closing dates in 7, 14 and 30 days, from the
 *     edition, the reader's saves and their matches;
 *   - flashcard badges on top of the existing streak;
 *   - "Challenge a friend": students only, to a classmate in their own class,
 *     in the app only. A fixed invitation (no free text, so no messages
 *     between children), and each sees only the two scores. Nothing is
 *     shareable outside EduOS.
 */
const DAY = 86_400_000;
const MAX_CHALLENGES = 5;

// ── regenerate one section (editor, draft only) ─────────────────────────

export async function regenerateSection(actor, id, body = {}, { now = new Date() } = {}) {
  requireProfile(actor);
  if (!opps.isEditor(actor)) throw new AppError('Only an editor can regenerate a section', 403);
  const section = String(body.section ?? '').toLowerCase();
  if (!SECTIONS.includes(section)) throw new AppError(`section must be one of ${SECTIONS.join(', ')}`, 400);
  const e = await NewsletterEdition.findById(assertObjectId(id));
  if (!e) throw new AppError('Edition not found', 404);
  if (e.status !== 'DRAFT') throw new AppError('Only a draft can be changed', 409, [], 'NOT_DRAFT');
  const items = await editions.itemsOf(e);
  if (!items.length) throw new AppError('The draft has no published items to write from', 400, [], 'EMPTY_EDITION');
  const round = (e.history ?? []).filter((h) => h.action === 'REGENERATED').length + 1;
  // The template's own version of the section (rotated, so "again" can differ without a model).
  const template = {
    hook: { ...editions.buildHook(items, `${e.periodKey}#${round}`), evidence: [] },
    flashcards: editions.buildFlashcards(items),
    quiz: editions.buildQuiz(items, `${e.periodKey}#${round}`),
    poll: editions.buildPoll(items),
  };
  const current = e.toObject();
  const base = { ...current, ...(section === 'notes' ? {} : { [section === 'hook' ? 'hook' : section]: template[section] }) };
  const variation = section === 'hook' ? current.hook?.text : section === 'poll' ? current.poll?.question : section === 'notes' ? (current.sectionNotes ?? []).map((n) => n.note).join(' / ') : null;
  const out = await writeWithAi(base, { items, sections: [section], cadence: e.cadence, variation: variation ? String(variation).slice(0, 400) : null, now });
  if (section === 'hook') e.hook = out.hook;
  else if (section === 'notes') e.sectionNotes = out.sectionNotes;
  else e[section] = out[section];
  e.ai = out.ai;
  e.markModified('ai');
  pushHistory(e, actor, 'REGENERATED', { note: `${section}: ${out.ai.sections[section] === 'AI' ? 'written by AI, checked against the items' : 'template'}` });
  await e.save();
  const rejected = (out.ai.rejected ?? []).filter((r) => r.section === section);
  return {
    section, writtenBy: out.ai.sections[section], ai: llmOn(), rejected,
    message: out.ai.sections[section] === 'AI' ? 'A fresh version, written by AI and checked against the items. Review it before publishing.' : (llmOn() ? `The AI version did not pass the checks (${rejected[0]?.reason ?? 'no answer'}), so the template wrote it.` : 'No AI key is set: the template wrote a fresh version.'),
    edition: editions.editorView(e.toObject()),
    content: { hook: e.hook, sectionNotes: e.sectionNotes, flashcards: e.flashcards, quiz: e.quiz, poll: e.poll },
  };
}

// ── per-reader extras ──────────────────────────────────────────────────

/** "Because ..." for one item and this reader (a parent: their own children only). */
export function becauseFor(o, contexts, { now = Date.now() } = {}) {
  let best = null;
  for (const ctx of contexts) {
    const s = scoreFor(o, ctx, { now });
    const text = reasonText(s.reasons);
    if (s.score > 0 && text && (!best || s.score > best.score)) best = { score: s.score, text, for: ctx.name ?? null };
  }
  if (best) return { text: best.text, for: best.for };
  const student = contexts.find((c) => c.kind === 'STUDENT' && c.grade);
  if (student) {
    const v = checkEligibility(o, { grade: student.grade, age: student.age, stream: student.stream, now });
    if (v.verdict === 'NO') return { text: `Not for ${student.name ?? 'you'} this time: ${v.reasons[0]}`, for: student.name ?? null, notEligible: true };
    return { text: `Because it is open to ${student.name ? `${student.name}'s` : 'your'} class (Class ${student.grade})`, for: student.name ?? null };
  }
  if (contexts.some((c) => c.kind === 'TEACHER')) return { text: o.audience === 'TEACHERS' ? 'Because it is a programme for teachers' : 'Because you may want to tell your classes', for: null };
  return { text: 'Because the school picked it for this edition', for: null };
}

const oneLine = (s, max = 140) => { const t = String(s ?? '').split(/(?<=[.!?])\s/)[0]; return t.length > max ? `${t.slice(0, max - 1)}…` : t; };

/** Editions whose quiz this reader got fully right. */
async function quizAces(profileId) {
  const reads = await NewsletterRead.find({ profileId, 'quiz.score': { $gt: 0 } }).select('editionId quiz.score').lean();
  if (!reads.length) return 0;
  const lengths = new Map((await NewsletterEdition.find({ _id: { $in: reads.map((r) => r.editionId) } }).select('quiz').lean()).map((e) => [String(e._id), e.quiz?.length ?? 0]));
  return reads.filter((r) => r.quiz.score === lengths.get(String(r.editionId))).length;
}

async function badgesFor(actor, reader) {
  const [reviews, mastered, saves, aced, sent] = await Promise.all([
    FlashcardReview.countDocuments({ profileId: actor.profileId }),
    FlashcardReview.countDocuments({ profileId: actor.profileId, box: { $gte: 4 } }),
    OpportunitySave.countDocuments({ profileId: actor.profileId }),
    quizAces(actor.profileId),
    actor.roleKey === 'STUDENT' ? NewsletterChallenge.countDocuments({ fromProfileId: actor.profileId }) : Promise.resolve(0),
  ]);
  const best = reader.streak?.best ?? 0;
  const b = (key, label, have, need, hint) => ({ key, label, earned: have >= need, progress: `${Math.min(have, need)}/${need}`, hint });
  return [
    b('first-flip', 'First flip', reviews, 1, 'Flip your first flashcard'),
    b('card-collector', 'Card collector', reviews, 10, 'Learn 10 cards'),
    b('memory-master', 'Memory master', mastered, 5, 'Know 5 cards well enough to reach box 4'),
    b('streak-3', '3-day streak', best, 3, 'Review cards three days in a row'),
    b('streak-7', 'Week-long streak', best, 7, 'Review cards seven days in a row'),
    b('quiz-ace', 'Quiz ace', aced, 1, 'Get every quiz question right'),
    b('deadline-hunter', 'Deadline hunter', saves, 3, 'Save three opportunities with reminders'),
    ...(actor.roleKey === 'STUDENT' ? [b('challenger', 'Friendly challenger', sent, 1, 'Challenge a classmate to the quiz')] : []),
  ];
}

/**
 * The extras for one edition and reader: 60-second cards, deadline radar,
 * "because" per item, badges and streak, and (students) challenges.
 */
export async function extras(actor, id, { now = new Date() } = {}) {
  requireProfile(actor);
  const e = await NewsletterEdition.findById(assertObjectId(id)).lean();
  if (!e || (e.status !== 'PUBLISHED' && !opps.isEditor(actor))) throw new AppError('Edition not found', 404);
  const items = await editions.itemsOf(e);
  const t = now.getTime();
  const contexts = await opps.contextsFor(actor);
  const because = Object.fromEntries(items.map((o) => [String(o._id), becauseFor(o, contexts, { now: t })]));

  // Deadline radar: the edition's items, the reader's saves and their matches.
  const saves = await OpportunitySave.find({ profileId: actor.profileId }).select('opportunityId').lean();
  const savedIds = new Set(saves.map((s) => String(s.opportunityId)));
  const pool = await Opportunity.find({ status: 'PUBLISHED', datesConfirmed: true, registrationCloses: { $gte: now, $lte: new Date(t + 30 * DAY) } }).lean();
  const inEdition = new Set(items.map((o) => String(o._id)));
  const radarRows = pool
    .map((o) => ({ o, why: inEdition.has(String(o._id)) ? null : becauseFor(o, contexts, { now: t }) }))
    .filter(({ o, why }) => inEdition.has(String(o._id)) || savedIds.has(String(o._id)) || (why && !why.notEligible && !/picked it/.test(why.text)))
    .map(({ o, why }) => ({ id: String(o._id), title: o.title, daysLeft: daysLeft(o, t), closes: o.registrationCloses, saved: savedIds.has(String(o._id)), inEdition: inEdition.has(String(o._id)), because: (why ?? because[String(o._id)])?.text ?? null }))
    .sort((a, b) => a.daysLeft - b.daysLeft);
  const radar = {
    in7: radarRows.filter((r) => r.daysLeft <= 7), in14: radarRows.filter((r) => r.daysLeft > 7 && r.daysLeft <= 14), in30: radarRows.filter((r) => r.daysLeft > 14),
    note: 'Only dates the school confirmed on the official site. Others say "check dates".',
  };

  // This week in 60 seconds.
  const cards = [
    { kind: 'HOOK', title: e.cadence === 'MONTHLY' ? 'This month in 60 seconds' : 'This week in 60 seconds', text: e.hook?.text ?? '', question: e.hook?.question ?? null },
    ...items.slice(0, 6).map((o) => {
      const left = daysLeft(o, t);
      return {
        kind: 'ITEM', id: String(o._id), title: o.title, text: oneLine(o.summary), type: TYPE_LABELS[o.type] ?? o.type,
        chip: left !== null ? (left === 0 ? 'Closes today' : `Closes in ${left} day${left === 1 ? '' : 's'}`) : 'Check dates',
        urgent: left !== null && left <= 7, because: because[String(o._id)]?.text ?? null, officialUrl: o.officialUrl ?? null,
      };
    }),
  ];
  const due = await FlashcardReview.countDocuments({ profileId: actor.profileId, dueAt: { $lte: now } });
  const myRead = await NewsletterRead.findOne({ editionId: e._id, profileId: actor.profileId }).select('quiz').lean();
  cards.push({ kind: 'NEXT', title: 'Your move', text: [myRead?.quiz?.score !== null && myRead?.quiz?.score !== undefined ? `You scored ${myRead.quiz.score}/${e.quiz?.length ?? 3} in the quiz.` : `Try the ${e.quiz?.length ?? 3}-question quiz.`, due ? `${due} flashcard${due === 1 ? '' : 's'} due today.` : 'Flip this edition\'s flashcards.'].join(' ') });

  const reader = await opps.readerFor(actor.profileId);
  return {
    editionId: String(e._id), sixtySeconds: cards, deadlineRadar: radar, because,
    badges: await badgesFor(actor, reader), streak: reader.streak ?? { count: 0, best: 0, lastDay: null },
    challenges: actor.roleKey === 'STUDENT' && e.status === 'PUBLISHED' ? await challengesFor(actor, e) : null,
  };
}

// ── challenge a friend (students, own class only) ───────────────────────

async function myStudentContext(actor) {
  if (actor.roleKey !== 'STUDENT') throw new AppError('Challenges are for students, within their own class.', 403, [], 'STUDENTS_ONLY');
  const ctx = (await opps.contextsFor(actor))[0];
  if (!ctx?.sectionId) throw new AppError('We could not find your class.', 404);
  return ctx;
}

const shortName = (s) => `${s.firstName ?? ''}${s.lastName ? ` ${String(s.lastName).slice(0, 1)}.` : ''}`.trim();

async function publishedWithQuiz(id) {
  const e = await NewsletterEdition.findById(assertObjectId(id)).lean();
  if (!e || e.status !== 'PUBLISHED') throw new AppError('Edition not found', 404);
  if (!e.quiz?.length) throw new AppError('This edition has no quiz', 404);
  return e;
}

/** Classmates who can be challenged: same class, active, with their own EduOS login. First name and initial only. */
export async function classmates(actor, id) {
  requireProfile(actor);
  const ctx = await myStudentContext(actor);
  await publishedWithQuiz(id);
  const ids = (await Enrollment.find({ sectionId: ctx.sectionId, status: 'ACTIVE' }).select('studentId').lean()).map((x) => x.studentId);
  const rows = await Student.find({ _id: { $in: ids }, deletedAt: null, profileId: { $ne: null } }).select('firstName lastName profileId').sort({ firstName: 1 }).lean();
  return rows.filter((s) => String(s._id) !== ctx.studentId).map((s) => ({ studentId: String(s._id), name: shortName(s) }));
}

async function challengesFor(actor, e) {
  const [sent, received] = await Promise.all([
    NewsletterChallenge.find({ editionId: e._id, fromProfileId: actor.profileId }).lean(),
    NewsletterChallenge.find({ editionId: e._id, toProfileId: actor.profileId }).lean(),
  ]);
  const profileIds = [...new Set([...sent, ...received].flatMap((c) => [String(c.fromProfileId), String(c.toProfileId)]))];
  const scores = new Map((await NewsletterRead.find({ editionId: e._id, profileId: { $in: profileIds } }).select('profileId quiz.score').lean()).map((r) => [String(r.profileId), r.quiz?.score ?? null]));
  const studentIds = [...new Set([...sent.map((c) => String(c.toStudentId)), ...received.map((c) => String(c.fromStudentId))])];
  const names = new Map((await Student.find({ _id: { $in: studentIds } }).select('firstName lastName').lean()).map((s) => [String(s._id), shortName(s)]));
  const mine = scores.get(String(actor.profileId)) ?? null;
  const row = (c, otherProfile, otherStudent, direction) => {
    const theirs = scores.get(String(otherProfile)) ?? null;
    const done = mine !== null && theirs !== null;
    return {
      id: String(c._id), direction, with: names.get(String(otherStudent)) ?? 'A classmate',
      status: done ? 'DONE' : 'WAITING', yourScore: mine, theirScore: done ? theirs : null, outOf: e.quiz?.length ?? 3,
      result: done ? (mine > theirs ? 'You won' : mine < theirs ? 'They won' : 'A draw') : (mine === null ? 'Take the quiz to answer' : 'Waiting for them'),
    };
  };
  return {
    sent: sent.map((c) => row(c, c.toProfileId, c.toStudentId, 'SENT')),
    received: received.map((c) => row(c, c.fromProfileId, c.fromStudentId, 'RECEIVED')),
    left: Math.max(0, MAX_CHALLENGES - sent.length),
    note: 'Only you and your classmate see these scores. Challenges stay inside EduOS and your class.',
  };
}

export async function challenge(actor, id, body = {}) {
  requireProfile(actor);
  const ctx = await myStudentContext(actor);
  const e = await publishedWithQuiz(id);
  const toStudentId = assertObjectId(body.studentId, 'studentId');
  if (toStudentId === ctx.studentId) throw new AppError('Challenge a classmate, not yourself.', 400);
  const inClass = await Enrollment.exists({ sectionId: ctx.sectionId, studentId: toStudentId, status: 'ACTIVE' });
  const target = inClass ? await Student.findOne({ _id: toStudentId, deletedAt: null }).select('firstName lastName profileId').lean() : null;
  // Outside the class (or unknown) is refused the same way: no hint about other classes.
  if (!target?.profileId) throw new AppError('You can only challenge a classmate in your own class.', 403, [], 'NOT_CLASSMATE');
  const count = await NewsletterChallenge.countDocuments({ editionId: e._id, fromProfileId: actor.profileId });
  if (count >= MAX_CHALLENGES) throw new AppError(`You can send ${MAX_CHALLENGES} challenges per edition.`, 429, [], 'CHALLENGE_LIMIT');
  let created = true;
  try {
    await NewsletterChallenge.create({ editionId: e._id, fromProfileId: actor.profileId, fromStudentId: ctx.studentId, toStudentId, toProfileId: target.profileId, sectionId: ctx.sectionId });
  } catch (err) {
    if (err?.code !== 11000) throw err;
    created = false;
  }
  if (created) {
    const me = await Student.findById(ctx.studentId).select('firstName lastName').lean();
    await notify({ recipientProfileIds: [String(target.profileId)], type: 'SYSTEM', title: `${shortName(me ?? {}) || 'A classmate'} challenged you to the newsletter quiz`.slice(0, 140), body: `${e.title}: three questions. Only the two of you see the scores.`, link: `/opportunities?edition=${e._id}` });
  }
  return { sent: created, to: shortName(target), challenges: await challengesFor(actor, e) };
}

export async function myChallenges(actor, id) {
  requireProfile(actor);
  await myStudentContext(actor);
  const e = await publishedWithQuiz(id);
  return challengesFor(actor, e);
}
