import { LessonPlan, BankQuestion, CpdEntry } from '../models/teaching.model.js';
import { SubjectOffering } from '../models/academics.model.js';
import { CourseModule } from '../models/courseModule.model.js';
import { Profile } from '../models/profile.model.js';
import { Role } from '../models/role.model.js';
import * as plans from '../modules/teaching/lessonPlans.service.js';
import * as bank from '../modules/teaching/questionBank.service.js';
import * as cpd from '../modules/teaching/cpd.service.js';

/**
 * Sample data for the part-4 teacher features (fictional):
 *   - the demo teacher's lesson plans for the last few school days and the
 *     coming ones (past ones taught with a reflection, one past one left
 *     unmarked so the prompt shows, one with the principal's feedback);
 *   - the question bank for two of the demo teacher's subjects, chapters taken
 *     from the syllabus modules, with a draft periodic-test paper;
 *   - CPD hours for the demo teacher (one verified by HR) and a few colleagues.
 */
const DAY = 86_400_000;
const ymd = (offset) => new Date(Date.now() + 330 * 60_000 + offset * DAY).toISOString().slice(0, 10);
/** The nearest school day (Mon-Sat) at or before / after the offset. */
function schoolDay(offset) {
  let o = offset;
  while (new Date(`${ymd(o)}T00:00:00Z`).getUTCDay() === 0) o += offset <= 0 ? -1 : 1;
  return ymd(o);
}

const BANK = {
  maths: (ch) => [
    ['MCQ', 1, 'REMEMBER', `(${ch}) Which of these is the correct first step? (sample)`, ['Simplify both sides', 'Guess the answer', 'Skip the brackets', 'Change the sign of every term'], 0],
    ['MCQ', 1, 'UNDERSTAND', `(${ch}) Which statement is true? (sample)`, ['Every even number is divisible by 4', 'Zero is neither positive nor negative', 'A negative times a negative is negative', '1 is a prime number'], 1],
    ['ASSERTION_REASON', 1, 'ANALYSE', `(${ch}) Assertion: the sum of two odd numbers is even. Reason: an odd number is one more than an even number. (sample)`, ['Both true; R explains A', 'Both true; R does not explain A', 'A true, R false', 'A false, R true'], 0],
    ['VSA', 2, 'APPLY', `(${ch}) A shopkeeper sells 3 pens for ₹45. How much do 7 pens cost? (sample)`],
    ['SA', 3, 'APPLY', `(${ch}) Riya saves ₹15 more each week than the week before, starting with ₹20. How much has she saved after 6 weeks? Show your working. (sample)`],
    ['SA', 3, 'REMEMBER', `(${ch}) State and explain the rule used in this chapter with one example. (sample)`],
    ['CASE_BASED', 4, 'APPLY', `(${ch}) A school canteen records how many samosas it sells each day for a week. Read the table and answer: (i) the busiest day, (ii) the average, (iii) how many to prepare next Monday and why. (sample)`],
    ['LA', 5, 'EVALUATE', `(${ch}) Two students solved the same problem differently. Check both methods, find any error, and explain which method you would use and why. (sample)`],
  ],
  science: (ch) => [
    ['MCQ', 1, 'REMEMBER', `(${ch}) Which instrument would you use to measure this quantity? (sample)`, ['Thermometer', 'Ammeter', 'Spring balance', 'Measuring cylinder'], 2],
    ['MCQ', 1, 'UNDERSTAND', `(${ch}) Which change is a chemical change? (sample)`, ['Melting ice', 'Rusting iron', 'Dissolving sugar', 'Tearing paper'], 1],
    ['ASSERTION_REASON', 1, 'ANALYSE', `(${ch}) Assertion: we see lightning before we hear thunder. Reason: light travels faster than sound. (sample)`, ['Both true; R explains A', 'Both true; R does not explain A', 'A true, R false', 'A false, R true'], 0],
    ['VSA', 2, 'UNDERSTAND', `(${ch}) Give two examples from your home that show this idea. (sample)`],
    ['SA', 3, 'APPLY', `(${ch}) Plan a simple experiment to test this, naming what you change, what you measure and what you keep the same. (sample)`],
    ['SA', 3, 'REMEMBER', `(${ch}) Define the key term of this chapter and label a diagram. (sample)`],
    ['CASE_BASED', 4, 'ANALYSE', `(${ch}) A farmer notices plants near the wall grow taller but thinner. Read the observations and answer: (i) the likely cause, (ii) a test to confirm it, (iii) one advice for the farmer. (sample)`],
    ['LA', 5, 'EVALUATE', `(${ch}) Is this a fair test? Evaluate the method described and suggest two improvements. (sample)`],
  ],
  english: (ch) => [
    ['MCQ', 1, 'REMEMBER', `(${ch}) Choose the correct form of the verb. (sample)`, ['She go to school', 'She goes to school', 'She going to school', 'She gone to school'], 1],
    ['MCQ', 1, 'UNDERSTAND', `(${ch}) What does the underlined word most nearly mean in the passage? (sample)`, ['Angry', 'Tired', 'Delighted', 'Confused'], 2],
    ['VSA', 2, 'UNDERSTAND', `(${ch}) Why does the narrator change their mind at the end? Answer in 30 words. (sample)`],
    ['SA', 3, 'APPLY', `(${ch}) Rewrite the paragraph in reported speech. (sample)`],
    ['SA', 3, 'REMEMBER', `(${ch}) Identify two figures of speech in the poem and name them. (sample)`],
    ['SOURCE_BASED', 4, 'ANALYSE', `(${ch}) Read the extract and answer: (i) the speaker's mood, (ii) the evidence for it, (iii) what the last line suggests. (sample)`],
    ['CASE_BASED', 4, 'APPLY', `(${ch}) Your school is starting a reading club. Write a notice (50 words) for the notice board using the details given. (sample)`],
    ['LA', 5, 'CREATE', `(${ch}) Write a short story (150 words) that begins with the line given and uses at least two new words from this chapter. (sample)`],
  ],
  generic: (ch) => [
    ['MCQ', 1, 'REMEMBER', `(${ch}) Which term matches the definition given? (sample)`, ['Term A', 'Term B', 'Term C', 'Term D'], 0],
    ['VSA', 2, 'UNDERSTAND', `(${ch}) Explain the key idea of this unit in two sentences. (sample)`],
    ['SA', 3, 'APPLY', `(${ch}) Apply the idea to a situation from your town. (sample)`],
    ['CASE_BASED', 4, 'ANALYSE', `(${ch}) Read the case and answer the three questions that follow. (sample)`],
    ['LA', 5, 'EVALUATE', `(${ch}) Give arguments for and against, and your own view. (sample)`],
  ],
};
const bankFor = (subject) => (/math/i.test(subject) ? BANK.maths : /science|physics|chemistry|biology|evs/i.test(subject) ? BANK.science : /english/i.test(subject) ? BANK.english : BANK.generic);

export async function seedP4Teacher({ section, attempt, who }) {
  const T = who.TEACHER;
  if (!T) return;

  await section('Question bank and a draft paper (sample)', BankQuestion, async () => {
    const scopes = (await bank.scopes(T.actor)).slice(0, 2);
    let n = 0; let papers = 0;
    for (const sc of scopes) {
      const chapters = sc.chapters.slice(0, 3);
      for (const ch of chapters) {
        for (const [type, marks, bloom, text, options, correct] of bankFor(sc.subject)(ch)) {
          const q = await attempt('bank question', () => bank.addQuestion(T.actor, {
            subjectId: sc.subjectId, gradeId: sc.gradeId, chapter: ch, type, marks, bloom, text,
            options: options ? options.map((o, i) => ({ text: o, isCorrect: i === correct })) : [], answer: options ? null : 'See the marking scheme (sample).',
          }));
          if (q) n += 1;
        }
      }
      const p = await attempt('draft paper', () => bank.buildPaper(T.actor, {
        subjectId: sc.subjectId, gradeId: sc.gradeId, title: `${sc.subject} ${sc.grade}: Periodic Test 2 (draft, sample)`, targetMarks: 30, durationMinutes: 60,
        blueprint: [{ type: 'MCQ', count: 4 }, { type: 'VSA', count: 2 }, { type: 'SA', count: 3 }, { type: 'CASE_BASED', count: 2 }, { type: 'LA', count: 1 }],
      }));
      if (p) papers += 1;
    }
    return `${n} questions across ${scopes.length} subject(s), ${papers} draft paper(s)`;
  });

  await section('Lesson plans for the demo teacher (sample)', LessonPlan, async () => {
    const offerings = await SubjectOffering.find({ teacherId: T.profile._id }).select('_id').limit(3).lean();
    const withModules = [];
    for (const o of offerings) if (await CourseModule.exists({ subjectOfferingId: o._id })) withModules.push(o);
    const days = [-4, -3, -2, -1, 0, 1, 2, 3].map(schoolDay).filter((d, i, a) => a.indexOf(d) === i);
    let made = 0; let taught = 0;
    const today = ymd(0);
    for (const [k, o] of withModules.slice(0, 2).entries()) {
      for (const [i, day] of days.entries()) {
        if ((i + k) % 2 === 1) continue; // alternate classes across the week, as a timetable would
        const s = await attempt('suggest plan', () => plans.suggest(T.actor, { subjectOfferingId: String(o._id), date: day, durationMinutes: 40 }));
        if (!s) continue;
        const saved = await attempt('save plan', () => plans.create(T.actor, { ...s.plan, date: day, periodNo: 2 + k, status: day >= today ? 'READY' : 'DRAFT', homework: s.plan.homework }));
        if (!saved) continue;
        made += 1;
        // Past lessons taught, bar the most recent one, which shows the "not yet marked taught" prompt.
        if (day < today && day !== days.filter((d) => d < today).at(-1)) {
          const done = await attempt('mark taught', () => plans.markTaught(T.actor, 'OWN', saved.id, { reflection: i % 2 ? 'Most of the class got it; a recap of the second topic tomorrow (sample).' : 'Pair work ran over time; shorten the explore step next time (sample).' }));
          if (done) taught += 1;
        }
      }
    }
    const one = await LessonPlan.findOne({ teacherId: T.profile._id }).sort({ date: -1 });
    if (one && who.PRINCIPAL) await attempt('plan feedback', () => plans.addFeedback(who.PRINCIPAL.actor, String(one._id), { note: 'Good use of a real-life opener. Try one toy-based or art-integrated activity in this unit (sample).' }));
    return `${made} plans (${taught} taught), one with the principal's feedback`;
  });

  await section('CPD hours (sample)', CpdEntry, async () => {
    const win = await cpd.yearWindow();
    const inYear = (monthsIn) => {
      const d = new Date(win.from.getTime() + monthsIn * 30 * DAY);
      return (d > new Date() ? new Date(Date.now() - 7 * DAY) : d).toISOString().slice(0, 10);
    };
    const rows = [
      ['CBSE COE workshop: competency-based assessment and question design (sample)', 'CBSE Centre of Excellence', 'EXTERNAL', 'KNOWLEDGE_PRACTICE', 12, 1, false],
      ['POCSO and child safeguarding refresher (sample)', 'School (in-house)', 'IN_HOUSE', 'CORE_VALUES', 3, 2, false],
      ['NISHTHA online module: art-integrated learning (sample)', 'NCERT / DIKSHA', 'EXTERNAL', 'PROFESSIONAL_GROWTH', 5, 3, true],
      ['Peer observation and feedback circle (sample)', 'School (in-house)', 'IN_HOUSE', 'KNOWLEDGE_PRACTICE', 4, 4, false],
    ];
    let n = 0;
    const mine = [];
    for (const [title, provider, mode, area, hours, m, online] of rows) {
      const e = await attempt('cpd entry', () => cpd.add(T.actor, { title, provider, mode, area, hours, date: inYear(m), online }));
      if (e) { n += 1; mine.push(e); }
    }
    if (mine[0] && who.HR) await attempt('cpd verify', () => cpd.verify(who.HR.actor, mine[0].id));
    // A few colleagues, so HR's overview has a spread.
    const role = await Role.findOne({ key: 'TEACHER' }).select('_id').lean();
    const others = role ? await Profile.find({ roleId: role._id, _id: { $ne: T.profile._id }, status: 'ACTIVE' }).select('_id displayName').limit(5).lean() : [];
    for (const [i, p] of others.entries()) {
      const hours = [8, 26, 51, 14, 32][i];
      await attempt('colleague cpd', () => CpdEntry.create({ profileId: p._id, title: 'CBSE capacity-building programme (sample)', provider: 'CBSE regional office', mode: 'EXTERNAL', area: 'KNOWLEDGE_PRACTICE', hours: Math.min(hours, 25), date: new Date(`${inYear(2)}T00:00:00Z`) }));
      if (hours > 25) await attempt('colleague cpd', () => CpdEntry.create({ profileId: p._id, title: 'In-house workshop series (sample)', provider: 'School (in-house)', mode: 'IN_HOUSE', area: 'PROFESSIONAL_GROWTH', hours: hours - 25, date: new Date(`${inYear(3)}T00:00:00Z`) }));
      n += 1;
    }
    return `${n} entries (one verified), ${others.length} colleague(s)`;
  });
}
