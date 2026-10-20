import { Opportunity, NewsletterEdition } from '../models/newsletter.model.js';
import * as opps from '../modules/newsletter/opportunities.service.js';
import * as editions from '../modules/newsletter/editions.service.js';

/**
 * Sample data for opportunities and the newsletter (part 4):
 *   - the curated starter list of real recurring programmes, imported as the
 *     editor would and most of it published, all with dates UNCONFIRMED
 *     ("check dates on the official site"); two left in the review queue;
 *   - three fictional school-level items (marked "sample") with confirmed
 *     dates, so countdown chips and reminders have something to show;
 *   - two weekly editions (last week's and this week's) and this month's
 *     edition, published by the principal, each with its hook, flashcards,
 *     a three-question quiz and a poll (delivery is in-app, and email only to
 *     opted-in adults, which the outbox records as SIMULATED);
 *   - the demo parent's and teacher's reading choices, saves with reminders,
 *     a quiz taken, a poll vote, a teacher's comment and a student's comment
 *     waiting for staff, a flashcard reviewed and a question to the class teacher.
 */
const DAY = 86_400_000;

export async function seedP4Newsletter({ section, attempt, who }) {
  const ED = who.PRINCIPAL;
  if (!ED) return;

  await section('Opportunities and the weekly / monthly newsletter (sample)', NewsletterEdition, async () => {
    const notes = [];
    const now = new Date();
    const imported = await opps.importCatalogue(ED.actor);
    notes.push(`${imported.added} starter-list programmes`);
    // The editor publishes most of the starter list; two stay in the review queue to show it.
    const queue = await Opportunity.find({ status: 'SUBMITTED', 'source.kind': 'CATALOGUE' }).sort({ createdAt: 1 }).lean();
    const keep = new Set(['economics-olympiad', 'smart-india-hackathon']);
    let published = 0;
    for (const o of queue) {
      if (keep.has(o.catalogueKey)) continue;
      // eslint-disable-next-line no-await-in-loop
      if (await attempt(`publish ${o.title}`, () => opps.review(ED.actor, String(o._id), { decision: 'PUBLISH' }))) published += 1;
    }
    notes.push(`${published} published (dates unconfirmed), ${keep.size} waiting for review`);

    // Fictional school-level items with confirmed dates (the school's own events).
    const school = [
      { title: 'Inter-house science quiz (sample)', summary: 'Teams of three from each house; rounds on space, the human body and everyday chemistry. Winners represent the school at the cluster quiz.', type: 'COMPETITION', level: 'SCHOOL', domains: ['SCIENCE'], eligibility: { gradeMin: 6, gradeMax: 10 }, registrationCloses: new Date(now.getTime() + 5 * DAY), eventDate: new Date(now.getTime() + 12 * DAY), organiser: 'Science department (sample)', mode: 'OFFLINE', howToApply: ['Give your team\'s names to your house master.'] },
      { title: 'School robotics showcase (sample)', summary: 'Bring a robot you built (any kit) and show it to the school and parents. Good practice for national robotics competitions.', type: 'INNOVATION_CHALLENGE', level: 'SCHOOL', domains: ['ROBOTICS', 'CODING_AI'], eligibility: { gradeMin: 4, gradeMax: 12 }, registrationCloses: new Date(now.getTime() + 9 * DAY), eventDate: new Date(now.getTime() + 20 * DAY), organiser: 'Robotics club (sample)', mode: 'OFFLINE', howToApply: ['Register with the Robotics club teacher.', 'Send a photo and two lines about your robot.'] },
      { title: 'Young writers\' week: short story contest (sample)', summary: 'Write a story of up to 800 words on "A door I opened". The best stories are read at assembly and go into the school magazine.', type: 'ARTS_CONTEST', level: 'SCHOOL', domains: ['ARTS', 'HUMANITIES'], eligibility: { gradeMin: 3, gradeMax: 12 }, registrationCloses: new Date(now.getTime() + 2 * DAY), organiser: 'English department (sample)', mode: 'OFFLINE', howToApply: ['Hand your story to your English teacher.'] },
    ];
    for (const item of school) {
      // eslint-disable-next-line no-await-in-loop
      await attempt(`school item ${item.title}`, () => opps.create(ED.actor, { ...item, registrationCloses: item.registrationCloses.toISOString(), eventDate: item.eventDate?.toISOString(), datesConfirmed: true, publish: true }));
    }
    notes.push(`${school.length} school events with confirmed dates`);

    // Reading choices: the parent and teacher get the email copy (simulated without a provider).
    if (who.PARENT) await attempt('parent prefs', () => opps.setPreferences(who.PARENT.actor, { email: true, domains: ['SCIENCE', 'ROBOTICS'] }));
    if (who.TEACHER) await attempt('teacher prefs', () => opps.setPreferences(who.TEACHER.actor, { email: true, cpdInterests: ['assessment', 'coding'] }));
    if (who.STUDENT) await attempt('student prefs', () => opps.setPreferences(who.STUDENT.actor, { domains: ['CODING_AI', 'MATHS'], leaderboardOptIn: true }));

    // Editions: last week's, this week's, and this month's, published by the principal.
    const made = [];
    for (const [cadence, at] of [['WEEKLY', new Date(now.getTime() - 7 * DAY)], ['WEEKLY', now], ['MONTHLY', now]]) {
      // eslint-disable-next-line no-await-in-loop
      const out = await attempt(`${cadence} edition`, () => editions.generate({ cadence, now: at, by: 'SEED' }));
      if (!out) continue;
      // eslint-disable-next-line no-await-in-loop
      await attempt(`publish ${out.edition.title}`, () => editions.publish(ED.actor, String(out.edition._id), { now: at }));
      made.push(out.edition);
    }
    notes.push(`${made.length} editions published`);

    const thisWeek = made[1] ?? made[0];
    if (thisWeek) {
      const id = String(thisWeek._id);
      const items = await Opportunity.find({ _id: { $in: thisWeek.opportunityIds } }).lean();
      if (who.PARENT) {
        await attempt('parent read', () => editions.read(who.PARENT.actor, id));
        await attempt('parent progress', () => editions.progress(who.PARENT.actor, id, { pct: 40, section: 'items' }));
        const kids = await opps.contextsFor(who.PARENT.actor).catch(() => []);
        for (const o of items.slice(0, 2)) {
          // eslint-disable-next-line no-await-in-loop
          await attempt('parent save', () => opps.save(who.PARENT.actor, String(o._id), { studentId: kids[0]?.studentId ?? undefined, remind: true }));
        }
        if (thisWeek.poll?.options?.length) await attempt('parent vote', () => editions.vote(who.PARENT.actor, id, { option: thisWeek.poll.options[0].key }));
      }
      if (who.TEACHER) {
        await attempt('teacher comment', () => editions.comment(who.TEACHER.actor, id, { text: 'The Robotics club will help any team that wants to enter the showcase. Come on Tuesday. (Sample.)' }));
        if (thisWeek.poll?.options?.length > 1) await attempt('teacher vote', () => editions.vote(who.TEACHER.actor, id, { option: thisWeek.poll.options[1].key }));
      }
      if (who.STUDENT) {
        await attempt('student read', () => editions.read(who.STUDENT.actor, id));
        await attempt('student quiz', () => editions.answerQuiz(who.STUDENT.actor, id, { answers: thisWeek.quiz.map((q, i) => (i === 1 ? (q.answerIndex + 1) % q.options.length : q.answerIndex)) }));
        await attempt('student card', () => editions.reviewCard(who.STUDENT.actor, { cardKey: `${id}:${thisWeek.flashcards[0]?.key}`, result: 'KNEW' }));
        await attempt('student comment', () => editions.comment(who.STUDENT.actor, id, { text: 'Can we enter the science quiz as a mixed-class team? (Sample.)' }));
        const quiz = items.find((o) => /science quiz/i.test(o.title)) ?? items[0];
        if (quiz) await attempt('student question', () => opps.ask(who.STUDENT.actor, String(quiz._id), { text: 'Do we need to know Class 10 topics for this? (Sample.)' }));
      }
    }
    return notes.join('; ');
  });
}
