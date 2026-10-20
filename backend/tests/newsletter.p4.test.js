import { describe, it, expect, beforeEach } from 'vitest';
import { inSchool, OAK } from './support/mcpSchool.js';
import { seedFamilySchool } from './support/familySchool.js';
import { Account } from '../src/models/account.model.js';
import { Club, ClubMembership } from '../src/models/club.model.js';
import { MessageOutbox } from '../src/models/messaging.model.js';
import { Notification } from '../src/models/notification.model.js';
import {
  Opportunity, NewsletterEdition, NewsletterReader, NewsletterComment, OpportunitySave,
} from '../src/models/newsletter.model.js';
import * as opps from '../src/modules/newsletter/opportunities.service.js';
import * as editions from '../src/modules/newsletter/editions.service.js';
import { checkEligibility, scoreFor, reasonText } from '../src/modules/newsletter/matching.js';
import { renderEditionEmail, escapeHtml } from '../src/modules/newsletter/emailHtml.js';
import { CATALOGUE } from '../src/modules/newsletter/catalogue.js';

/**
 * Opportunities and the weekly / monthly newsletter (part 4): matching with
 * reasons, "Can I enter?", family scoping, the official-link allowlist and
 * review queue, idempotent edition drafts, publishing and email delivery
 * (simulated without a provider), unsubscribe, comment moderation, the quiz
 * board, spaced-repetition flashcards, reminders and email escaping.
 *
 * Fixture (familySchool): Class 6 A (Rahul, Priya = STUDENT, Aman), 6 B (Riya);
 * PARENT is Rahul's and Riya's father; PARENT2 is Aman's mother; PARENT3 has no
 * child here; TEACHER teaches English in 6 A; T3 Science in 6 B; PRINCIPAL edits.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
const DAY = 86_400_000;

async function publishedOpp(fields = {}) {
  const ed = s.people.PRINCIPAL.actor;
  return inOak(() => opps.create(ed, {
    title: 'Junior Robotics Challenge', summary: 'Build a robot that sorts waste.', type: 'COMPETITION', level: 'NATIONAL',
    domains: ['ROBOTICS'], eligibility: { gradeMin: 5, gradeMax: 8 }, officialUrl: 'https://www.cbse.gov.in/robotics', organiser: 'Sample Board',
    typicalMonths: [new Date().getUTCMonth() + 1], publish: true, ...fields,
  }));
}

beforeEach(async () => {
  s = await seedFamilySchool();
});

describe('matching and eligibility (pure rules)', () => {
  const opp = { type: 'OLYMPIAD', audience: 'STUDENTS', domains: ['MATHS'], eligibility: { gradeMin: 8, gradeMax: 12, streams: [] }, datesConfirmed: false };
  it('says YES, NO or CHECK with reasons', () => {
    expect(checkEligibility(opp, { grade: 9 }).verdict).toBe('YES');
    const no = checkEligibility(opp, { grade: 6 });
    expect(no.verdict).toBe('NO');
    expect(no.reasons.join(' ')).toMatch(/Class 8 to Class 12; you are in Class 6/);
    expect(checkEligibility(opp, {}).verdict).toBe('CHECK');
    expect(checkEligibility({ ...opp, eligibility: { gradeMin: 8, gradeMax: 8, note: 'Government schools only' } }, { grade: 8 }).verdict).toBe('CHECK');
    expect(checkEligibility({ ...opp, eligibility: { streams: ['SCIENCE'] } }, { grade: 12, stream: 'COMMERCE' }).verdict).toBe('NO');
    expect(checkEligibility({ ...opp, datesConfirmed: true, registrationCloses: new Date(Date.now() - DAY) }, { grade: 9 }).verdict).toBe('NO');
  });
  it('explains a match in plain words and never matches an ineligible item', () => {
    const ctx = { kind: 'STUDENT', grade: 9, domains: new Set(), clubs: [{ name: 'Robotics club', domains: ['ROBOTICS'] }], strengths: [], pastTypes: new Set() };
    const robo = { type: 'COMPETITION', audience: 'STUDENTS', domains: ['ROBOTICS'], eligibility: { gradeMin: 6, gradeMax: 10 } };
    const out = scoreFor(robo, ctx);
    expect(reasonText(out.reasons)).toBe('Because you are in Class 9 and in the Robotics club');
    expect(scoreFor({ ...robo, eligibility: { gradeMin: 11 } }, ctx).score).toBe(0);
    expect(scoreFor({ ...robo, audience: 'TEACHERS' }, ctx).score).toBe(0);
  });
});

describe('catalogue, allowlist and review queue', () => {
  it('only staff add items; links must be https and on the allowlist; nothing is visible before an editor publishes', async () => {
    await expect(inOak(() => opps.create(s.people.PARENT.actor, { title: 'X', type: 'COMPETITION', level: 'NATIONAL', officialUrl: 'https://www.cbse.gov.in/' }))).rejects.toMatchObject({ code: 'STAFF_ONLY' });
    await expect(inOak(() => opps.create(s.people.TEACHER.actor, { title: 'X', type: 'COMPETITION', level: 'NATIONAL', officialUrl: 'http://www.cbse.gov.in/' }))).rejects.toMatchObject({ code: 'BAD_LINK' });
    await expect(inOak(() => opps.create(s.people.TEACHER.actor, { title: 'X', type: 'COMPETITION', level: 'NATIONAL', officialUrl: 'https://cbse.gov.in.evil.example/' }))).rejects.toMatchObject({ code: 'LINK_NOT_ALLOWED' });
    await expect(inOak(() => opps.create(s.people.TEACHER.actor, { title: 'X', type: 'COMPETITION', level: 'NATIONAL' }))).rejects.toMatchObject({ code: 'LINK_REQUIRED' });
    const item = await inOak(() => opps.create(s.people.TEACHER.actor, { title: 'Science quiz week', summary: 'A quiz.', type: 'COMPETITION', level: 'NATIONAL', officialUrl: 'https://ncert.nic.in/quiz' }));
    expect(item.status).toBe('SUBMITTED');
    expect((await inOak(() => opps.list(s.people.PARENT.actor, {}))).items).toHaveLength(0);
    // A teacher cannot publish; an editor rejects only with a reason, then publishes.
    await expect(inOak(() => opps.review(s.people.TEACHER.actor, item.id, { decision: 'PUBLISH' }))).rejects.toMatchObject({ statusCode: 403 });
    await expect(inOak(() => opps.review(s.people.PRINCIPAL.actor, item.id, { decision: 'REJECT' }))).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await inOak(() => opps.review(s.people.PRINCIPAL.actor, item.id, { decision: 'PUBLISH' }));
    expect((await inOak(() => opps.list(s.people.PARENT.actor, {}))).items.map((i) => i.title)).toEqual(['Science quiz week']);
  });

  it('imports the curated starter list once, unconfirmed and waiting for review', async () => {
    const first = await inOak(() => opps.importCatalogue(s.people.PRINCIPAL.actor));
    expect(first.added).toBe(CATALOGUE.length);
    expect((await inOak(() => opps.importCatalogue(s.people.PRINCIPAL.actor))).added).toBe(0);
    const rows = await inOak(() => Opportunity.find({}).lean());
    expect(rows.every((o) => o.status === 'SUBMITTED' && o.datesConfirmed === false && !o.registrationCloses && o.officialUrl.startsWith('https://'))).toBe(true);
    // Every starter link passes the default allowlist.
    for (const c of CATALOGUE) await expect(inOak(() => opps.checkOfficialUrl(c.officialUrl))).resolves.toBe(new URL(c.officialUrl).toString());
  });

  it('dates are confirmed only by an editor, and moving a date unconfirms it', async () => {
    const item = await publishedOpp({ registrationCloses: new Date(Date.now() + 10 * DAY).toISOString(), datesConfirmed: true });
    expect(item.datesConfirmed).toBe(true);
    expect(item.dateText).toMatch(/Registration closes/);
    const moved = await inOak(() => opps.update(s.people.PRINCIPAL.actor, item.id, { registrationCloses: new Date(Date.now() + 20 * DAY).toISOString() }));
    expect(moved.datesConfirmed).toBe(false);
    expect(moved.dateText).toMatch(/Check dates and rules on the official site/);
  });
});

describe('matches and family scoping', () => {
  beforeEach(async () => {
    await inOak(async () => {
      const club = await Club.create({ code: 'ROBO', name: 'Robotics club', category: 'ACADEMIC', activity: 'ROBOTICS', capacity: 20, coachProfileIds: [s.people.TEACHER.profile._id] });
      await ClubMembership.create({ clubId: club._id, studentId: s.priya.student._id, status: 'ACTIVE', requestedByProfileId: s.people.STUDENT.profile._id });
      await ClubMembership.create({ clubId: club._id, studentId: s.rahul.student._id, status: 'ACTIVE', requestedByProfileId: s.people.PARENT.profile._id });
    });
    await publishedOpp();
    await publishedOpp({ title: 'Senior Physics Olympiad', domains: ['SCIENCE'], eligibility: { gradeMin: 11, gradeMax: 12 }, type: 'OLYMPIAD' });
  });

  it('a student sees their own matches with the reason, never an item they cannot enter', async () => {
    const out = await inOak(() => opps.matches(s.people.STUDENT.actor));
    expect(out.contexts).toHaveLength(1);
    expect(out.contexts[0].items.map((i) => i.title)).toEqual(['Junior Robotics Challenge']);
    expect(out.contexts[0].items[0].reason).toBe('Because you are in Class 6 and in the Robotics club');
  });

  it('a parent sees their own children only, each named to them; another child is refused', async () => {
    const out = await inOak(() => opps.matches(s.people.PARENT.actor));
    expect(out.contexts.map((c) => c.name).sort()).toEqual(['Rahul', 'Riya']);
    const rahul = out.contexts.find((c) => c.name === 'Rahul');
    expect(rahul.items[0].reason).toBe('Because Rahul is in Class 6 and in the Robotics club');
    await expect(inOak(() => opps.matches(s.people.PARENT.actor, { studentId: String(s.aman.student._id) }))).rejects.toMatchObject({ code: 'NOT_YOUR_CHILD' });
    await expect(inOak(() => opps.save(s.people.PARENT.actor, rahul.items[0].id, { studentId: String(s.aman.student._id) }))).rejects.toMatchObject({ code: 'NOT_YOUR_CHILD' });
    expect((await inOak(() => opps.matches(s.people.PARENT3.actor))).contexts).toEqual([]);
  });

  it('"Can I enter?" answers for each child, or for details typed in', async () => {
    const senior = (await inOak(() => Opportunity.findOne({ title: 'Senior Physics Olympiad' }).lean()));
    const out = await inOak(() => opps.eligibility(s.people.PARENT.actor, String(senior._id)));
    expect(out.results.map((r) => r.verdict)).toEqual(['NO', 'NO']);
    const typed = await inOak(() => opps.eligibility(s.people.PARENT3.actor, String(senior._id), { grade: '11' }));
    expect(typed.verdict).toBe('YES');
  });

  it('"Remind me" reminds through the outbox at the lead days, once each', async () => {
    const soon = await publishedOpp({ title: 'District art contest', domains: ['ARTS'], registrationCloses: new Date(Date.now() + 2.5 * DAY).toISOString(), datesConfirmed: true });
    await inOak(() => opps.save(s.people.PARENT.actor, soon.id, { studentId: String(s.rahul.student._id), remind: true }));
    const first = await inOak(() => opps.runReminders());
    expect(first.sent).toBe(1);
    expect((await inOak(() => opps.runReminders())).sent).toBe(0);
    const rows = await inOak(() => MessageOutbox.find({ templateKey: 'OPPORTUNITY_REMINDER' }).lean());
    expect(rows).toHaveLength(1);
    expect(rows[0].preview).toMatch(/District art contest/);
    // Leads 7 and 3 count as passed: no backlog later.
    const save = await inOak(() => OpportunitySave.findOne({}).lean());
    expect(save.remindersSent.map((r) => r.lead).sort()).toEqual([3, 7]);
  });

  it('"Ask a teacher" reaches the class teacher without naming the child', async () => {
    const robo = (await inOak(() => Opportunity.findOne({ title: 'Junior Robotics Challenge' }).lean()));
    const sent = await inOak(() => opps.ask(s.people.STUDENT.actor, String(robo._id), { text: 'Can our club enter as a team?' }));
    expect(sent.sentTo).toContain(s.people.TEACHER.actor.displayName);
    const inbox = await inOak(() => opps.questions(s.people.TEACHER.actor));
    expect(inbox[0].from).toBe('A student in Class 6 A');
    await inOak(() => opps.answer(s.people.TEACHER.actor, inbox[0].id, { answer: 'Yes, up to four per team.' }));
    expect((await inOak(() => opps.questions(s.people.STUDENT.actor)))[0].status).toBe('ANSWERED');
  });
});

describe('editions', () => {
  beforeEach(async () => {
    await publishedOpp();
    await publishedOpp({ title: 'Maths Olympiad <b>2026</b>', type: 'OLYMPIAD', domains: ['MATHS'], organiser: 'Sample Maths Society', facts: [{ front: 'Who described zero?', back: 'Brahmagupta' }] });
    await publishedOpp({ title: 'Young Writers Prize', type: 'ARTS_CONTEST', domains: ['ARTS'], organiser: 'Sample Literary Trust' });
  });

  it('drafts once per period (the scheduler and an editor cannot make two), and force rebuilds only a draft', async () => {
    const now = new Date('2026-10-14T05:00:00Z');
    const a = await inOak(() => editions.generate({ cadence: 'WEEKLY', now }));
    const b = await inOak(() => editions.generate({ cadence: 'WEEKLY', now: new Date(now.getTime() + 2 * DAY) }));
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(a.edition.periodKey).toBe('2026-W42');
    const run1 = await inOak(() => editions.runScheduled({ now }));
    const run2 = await inOak(() => editions.runScheduled({ now }));
    expect(run1.drafted).toEqual(['MONTHLY:2026-10']);
    expect(run2.drafted).toEqual([]);
    expect(await inOak(() => NewsletterEdition.countDocuments())).toBe(2);
    expect(a.edition.quiz).toHaveLength(3);
    expect(a.edition.flashcards.length).toBeGreaterThanOrEqual(3);
    expect(a.edition.poll.options.length).toBeGreaterThanOrEqual(2);
    await expect(inOak(() => editions.generate({ cadence: 'WEEKLY', now, actor: s.people.TEACHER.actor }))).rejects.toMatchObject({ statusCode: 403 });
    const rebuilt = await inOak(() => editions.generate({ cadence: 'WEEKLY', now, actor: s.people.PRINCIPAL.actor, force: true }));
    expect(rebuilt.rebuilt).toBe(true);
    // Readers never see a draft.
    await expect(inOak(() => editions.read(s.people.PARENT.actor, String(a.edition._id)))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('publishing delivers in the app to everyone and by email only to adults who opted in (simulated, escaped, with unsubscribe)', async () => {
    await inOak(() => Account.updateOne({ _id: s.people.PARENT.account._id }, { $set: { email: 'father@example.com' } }));
    await inOak(() => Account.updateOne({ _id: s.people.PARENT2.account._id }, { $set: { email: 'mother@example.com' } }));
    await inOak(() => opps.setPreferences(s.people.PARENT.actor, { email: true }));
    await expect(inOak(() => opps.setPreferences(s.people.STUDENT.actor, { email: true }))).rejects.toMatchObject({ code: 'NO_EMAIL_FOR_STUDENTS' });
    await inOak(() => opps.setPreferences(s.people.TEACHER.actor, { weekly: false }));
    const { edition } = await inOak(() => editions.generate({ cadence: 'WEEKLY' }));
    await expect(inOak(() => editions.publish(s.people.TEACHER.actor, String(edition._id)))).rejects.toMatchObject({ statusCode: 403 });
    const out = await inOak(() => editions.publish(s.people.PRINCIPAL.actor, String(edition._id)));
    expect(out.delivered).toBe(true);
    expect(out.delivery.emailQueued).toBe(1);
    expect(out.delivery.byStatus).toEqual({ SIMULATED: 1 });
    // The teacher turned weekly off: no notice.
    expect(await inOak(() => Notification.countDocuments({ recipientProfileId: s.people.TEACHER.profile._id, link: { $regex: 'edition=' } }))).toBe(0);
    expect(await inOak(() => Notification.countDocuments({ recipientProfileId: s.people.STUDENT.profile._id, link: { $regex: 'edition=' } }))).toBe(1);
    const row = await inOak(() => MessageOutbox.findOne({ templateKey: 'NEWSLETTER_EDITION' }).lean());
    expect(String(row.recipientProfileId)).toBe(String(s.people.PARENT.profile._id));
    expect(row.status).toBe('SIMULATED');

    // One-click unsubscribe with the reader's token turns the email off.
    const reader = await inOak(() => NewsletterReader.findOne({ profileId: s.people.PARENT.profile._id }).lean());
    await expect(inOak(() => opps.unsubscribeByToken('nope'))).rejects.toMatchObject({ code: 'BAD_TOKEN' });
    await inOak(() => opps.unsubscribeByToken(reader.unsubscribeToken));
    expect((await inOak(() => opps.myPreferences(s.people.PARENT.actor))).email).toBe(false);

    // Withdraw and publish again: nothing is sent twice.
    await inOak(() => editions.withdraw(s.people.PRINCIPAL.actor, String(edition._id)));
    expect((await inOak(() => editions.publish(s.people.PRINCIPAL.actor, String(edition._id)))).delivered).toBe(false);
    expect(await inOak(() => MessageOutbox.countDocuments({ templateKey: 'NEWSLETTER_EDITION' }))).toBe(1);
  });

  it('the email is escaped, has a plain-text twin, no tracking pixel, no unsafe links', () => {
    const out = renderEditionEmail({
      schoolName: 'Oak <School>', edition: { title: 'Week <script>alert(1)</script>', periodLabel: 'x', hook: { text: '"Quoted" & <b>bold</b>', question: null } },
      items: [{ title: '<img src=x onerror=alert(1)>', summary: 'a', typeLabel: 'Competition', levelLabel: 'National', officialUrl: 'javascript:alert(1)', typicalWindow: null },
        { title: 'Safe', summary: 'b', officialUrl: 'https://www.cbse.gov.in/?a="b"' }],
      deadlines: [], editionUrl: 'https://app.example/oakridge/parent/opportunities?edition=1', unsubscribeUrl: 'https://app.example/public/newsletter/oakridge/unsubscribe?t=abc',
    });
    expect(out.html).not.toMatch(/<script|<img|javascript:/i);
    expect(out.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(out.html).toContain('&lt;script&gt;');
    expect(out.html).toContain('&quot;Quoted&quot; &amp; &lt;b&gt;bold&lt;/b&gt;');
    expect(out.html).toContain('href="https://www.cbse.gov.in/?a=%22b%22"');
    expect(out.html).toContain('Unsubscribe');
    expect(out.text).toContain('Unsubscribe: https://app.example/public/newsletter/oakridge/unsubscribe?t=abc');
    expect(escapeHtml(`<'&">`)).toBe('&lt;&#39;&amp;&quot;&gt;');
  });

  it('comments: families wait for staff; a student shows as "A student in Class 6"; teachers moderate students only', async () => {
    const { edition } = await inOak(() => editions.generate({ cadence: 'WEEKLY' }));
    await inOak(() => editions.publish(s.people.PRINCIPAL.actor, String(edition._id)));
    const id = String(edition._id);
    const st = await inOak(() => editions.comment(s.people.STUDENT.actor, id, { text: 'Our club wants to try the robotics one!' }));
    const pa = await inOak(() => editions.comment(s.people.PARENT.actor, id, { text: 'Is there a fee?' }));
    const te = await inOak(() => editions.comment(s.people.TEACHER.actor, id, { text: 'Robotics club meets Tuesday to plan.' }));
    expect([st.status, pa.status, te.status]).toEqual(['PENDING', 'PENDING', 'APPROVED']);
    expect(st.displayName).toBe('A student in Class 6');
    const parentView = await inOak(() => editions.read(s.people.PARENT2.actor, id));
    expect(parentView.comments.map((c) => c.text)).toEqual(['Robotics club meets Tuesday to plan.']);
    // The teacher's queue has the student's comment only; the parent's is the editor's.
    const queue = await inOak(() => editions.pendingComments(s.people.TEACHER.actor));
    expect(queue.map((c) => c.id)).toEqual([st.id]);
    await expect(inOak(() => editions.moderate(s.people.TEACHER.actor, pa.id, { decision: 'APPROVE' }))).rejects.toMatchObject({ statusCode: 404 });
    await expect(inOak(() => editions.pendingComments(s.people.PARENT.actor))).rejects.toMatchObject({ statusCode: 403 });
    await inOak(() => editions.moderate(s.people.TEACHER.actor, st.id, { decision: 'APPROVE' }));
    await expect(inOak(() => editions.moderate(s.people.PRINCIPAL.actor, pa.id, { decision: 'REJECT' }))).rejects.toThrow(/reason/);
    await inOak(() => editions.moderate(s.people.PRINCIPAL.actor, pa.id, { decision: 'REJECT', reason: 'The fee is on the official site.' }));
    const after = await inOak(() => editions.read(s.people.PARENT2.actor, id));
    expect(after.comments.map((c) => c.displayName)).toEqual(['A student in Class 6', `${s.people.TEACHER.actor.displayName} (Teacher)`]);
    expect(after.comments.some((c) => /Priya|Verma/.test(c.displayName))).toBe(false);
    expect(await inOak(() => NewsletterComment.countDocuments({ status: 'REJECTED' }))).toBe(1);
  });

  it('quiz once with instant feedback; poll once with live results; flashcards move boxes and keep a streak', async () => {
    const { edition } = await inOak(() => editions.generate({ cadence: 'WEEKLY' }));
    await inOak(() => editions.publish(s.people.PRINCIPAL.actor, String(edition._id)));
    const id = String(edition._id);
    const view = await inOak(() => editions.read(s.people.STUDENT.actor, id));
    expect(view.quiz.questions[0].answerIndex).toBeUndefined();
    expect(view.poll.results).toBeNull();
    await inOak(() => opps.setPreferences(s.people.STUDENT.actor, { leaderboardOptIn: true }));
    const res = await inOak(() => editions.answerQuiz(s.people.STUDENT.actor, id, { answers: edition.quiz.map((q) => q.answerIndex) }));
    expect(res.score).toBe(3);
    expect(res.onBoard).toBe(true);
    await expect(inOak(() => editions.answerQuiz(s.people.STUDENT.actor, id, { answers: [0, 0, 0] }))).rejects.toMatchObject({ code: 'ALREADY_ANSWERED' });
    // One player is not a group: the board shows nothing rather than a person.
    const after = await inOak(() => editions.read(s.people.STUDENT.actor, id));
    expect(after.leaderboard.byClass).toEqual([]);
    expect(after.quiz.questions[0].answerIndex).toBe(edition.quiz[0].answerIndex);

    const poll = await inOak(() => editions.vote(s.people.PARENT.actor, id, { option: edition.poll.options[0].key }));
    expect(poll.total).toBe(1);
    await expect(inOak(() => editions.vote(s.people.PARENT.actor, id, { option: edition.poll.options[1].key }))).rejects.toMatchObject({ code: 'ALREADY_VOTED' });

    const card = view.flashcards[0].key;
    const now = new Date();
    const r1 = await inOak(() => editions.reviewCard(s.people.STUDENT.actor, { cardKey: card, result: 'KNEW' }, { now }));
    expect(r1.box).toBe(2);
    const r2 = await inOak(() => editions.reviewCard(s.people.STUDENT.actor, { cardKey: card, result: 'KNEW' }, { now: new Date(now.getTime() + DAY) }));
    expect(r2.box).toBe(3);
    expect(new Date(r2.dueAt).getTime() - (now.getTime() + DAY)).toBe(7 * DAY);
    expect(r2.streak.count).toBe(2);
    const r3 = await inOak(() => editions.reviewCard(s.people.STUDENT.actor, { cardKey: card, result: 'REVIEW' }, { now: new Date(now.getTime() + 2 * DAY) }));
    expect(r3.box).toBe(1);
    const deck = await inOak(() => editions.flashcardDeck(s.people.STUDENT.actor, { now: new Date(now.getTime() + 4 * DAY) }));
    expect(deck.due.map((c) => c.key)).toEqual([card]);

    const prog = await inOak(() => editions.progress(s.people.STUDENT.actor, id, { pct: 100, section: 'quiz' }));
    expect(prog.completed).toBe(true);
    const stats = await inOak(() => editions.analytics(s.people.PRINCIPAL.actor));
    expect(stats.editions[0]).toMatchObject({ quizParticipants: 1, pollVotes: 1 });
    await expect(inOak(() => editions.analytics(s.people.TEACHER.actor))).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('sample data', () => {
  it('seeds the starter list, school events, two weekly and one monthly edition with flashcards and a quiz', async () => {
    const { seedP4Newsletter } = await import('../src/seed/seed_p4_newsletter.js');
    const failures = [];
    const notes = [];
    const section = async (name, Model, fn) => { notes.push(await fn()); };
    const attempt = async (label, fn) => { try { return await fn(); } catch (err) { failures.push(`${label}: ${err.message}`); return null; } };
    const who = Object.fromEntries(['PRINCIPAL', 'PARENT', 'TEACHER', 'STUDENT'].map((k) => [k, s.people[k]]));
    await inOak(() => seedP4Newsletter({ section, attempt, who }));
    expect(failures).toEqual([]);
    const eds = await inOak(() => NewsletterEdition.find({ status: 'PUBLISHED' }).lean());
    expect(eds.filter((e) => e.cadence === 'WEEKLY')).toHaveLength(2);
    expect(eds.filter((e) => e.cadence === 'MONTHLY')).toHaveLength(1);
    for (const e of eds) { expect(e.quiz.length).toBe(3); expect(e.flashcards.length).toBeGreaterThan(3); expect(e.opportunityIds.length).toBeGreaterThan(3); }
    expect(await inOak(() => Opportunity.countDocuments({ status: 'PUBLISHED', datesConfirmed: true }))).toBe(3);
    expect(await inOak(() => Opportunity.countDocuments({ status: 'SUBMITTED' }))).toBe(2);
    expect(await inOak(() => NewsletterComment.countDocuments({ status: 'PENDING' }))).toBe(1);
  });
});
