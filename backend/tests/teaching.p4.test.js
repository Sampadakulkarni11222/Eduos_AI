import { describe, it, expect, beforeEach } from 'vitest';
import { inSchool, OAK } from './support/mcpSchool.js';
import { seedFamilySchool, ymdIn } from './support/familySchool.js';
import { CourseModule } from '../src/models/courseModule.model.js';
import { Assignment } from '../src/models/assignment.model.js';
import { Quiz } from '../src/models/quiz.model.js';
import { TrainingSession } from '../src/models/compliance.model.js';
import { LessonPlan, BankQuestion } from '../src/models/teaching.model.js';
import * as plans from '../src/modules/teaching/lessonPlans.service.js';
import * as bank from '../src/modules/teaching/questionBank.service.js';
import * as cpd from '../src/modules/teaching/cpd.service.js';
import * as syllabus from '../src/modules/syllabus/syllabus.service.js';

/**
 * Part 4, teacher audit: lesson plans that feed the syllabus tracker and set
 * real homework, the shared question bank and blueprint-checked papers, CPD
 * hours against the CBSE 50-hour reference, and the class teacher's read of
 * every subject of their class.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);

async function moduleFor(offering, title = 'Nouns and pronouns', topics = ['Common nouns', 'Proper nouns', 'Pronouns']) {
  return inOak(() => CourseModule.create({
    subjectOfferingId: offering._id, sectionId: offering.sectionId, teacherId: offering.teacherId, order: 1, title,
    plannedStart: new Date(Date.now() - 10 * 86_400_000), plannedEnd: new Date(Date.now() + 20 * 86_400_000), topics: topics.map((t) => ({ title: t })),
  }));
}

beforeEach(async () => { s = await seedFamilySchool(); });

describe('lesson plans', () => {
  it('suggests a draft from the module and the bank, saves it, and refuses another teacher', async () => {
    const T = s.people.TEACHER.actor;
    const m = await moduleFor(s.offerings.engA);
    await inOak(() => bank.addQuestion(T, { subjectId: String(s.subjects.english._id), gradeId: String(s.grade._id), chapter: 'Nouns and pronouns', type: 'CASE_BASED', marks: 4, bloom: 'APPLY', text: 'Read the notice and pick out every proper noun.' }));
    const sug = await inOak(() => plans.suggest(T, { subjectOfferingId: String(s.offerings.engA._id), durationMinutes: 40 }));
    expect(sug.plan.courseModuleId).toBe(String(m._id));
    expect(sug.plan.topicIds).toHaveLength(2);
    expect(sug.plan.steps.reduce((n, x) => n + x.minutes, 0)).toBe(40);
    expect(sug.plan.competencyCheck).toMatch(/proper noun/);
    expect(sug.evidence.join(' ')).toMatch(/question bank/);
    expect(await inOak(() => LessonPlan.countDocuments())).toBe(0); // a suggestion is never saved
    const saved = await inOak(() => plans.create(T, { ...sug.plan, date: ymdIn(0) }));
    expect(saved.status).toBe('DRAFT');
    expect(saved.timingWarning).toBeNull();
    await expect(inOak(() => plans.create(s.people.T2.actor, { ...sug.plan, date: ymdIn(0) }))).rejects.toMatchObject({ code: 'NOT_YOUR_SUBJECT' });
    await expect(inOak(() => plans.get(s.people.T2.actor, saved.id))).rejects.toMatchObject({ statusCode: 404 });
    await expect(inOak(() => plans.create(T, { ...sug.plan, date: '2019-01-01' }))).rejects.toMatchObject({ code: 'PLAN_TOO_OLD' });
    await expect(inOak(() => plans.create(T, { ...sug.plan, date: ymdIn(0), pedagogies: ['MAGIC'] }))).rejects.toMatchObject({ code: 'BAD_PEDAGOGY' });
  });

  it('marking taught ticks the syllabus topics and sets the homework as a real assignment', async () => {
    const T = s.people.TEACHER.actor;
    const m = await moduleFor(s.offerings.engA);
    const p = await inOak(() => plans.create(T, {
      subjectOfferingId: String(s.offerings.engA._id), courseModuleId: String(m._id), topicIds: [String(m.topics[0]._id)],
      date: ymdIn(0), title: 'Common nouns', homework: 'Ten common nouns from your kitchen.',
      steps: [{ phase: 'ENGAGE', minutes: 10, activity: 'Objects in a bag' }, { phase: 'EVALUATE', minutes: 20, activity: 'Exit ticket' }],
    }));
    expect(p.timingWarning).toMatch(/30 minutes/);
    const future = await inOak(() => plans.create(T, { subjectOfferingId: String(s.offerings.engA._id), date: ymdIn(3), title: 'Later' }));
    await expect(inOak(() => plans.markTaught(T, 'OWN', future.id, {}))).rejects.toMatchObject({ code: 'PLAN_IN_FUTURE' });
    const done = await inOak(() => plans.markTaught(T, 'OWN', p.id, { reflection: 'Went well; pronouns tomorrow.', setHomework: { dueAt: ymdIn(2) } }));
    expect(done.status).toBe('TAUGHT');
    expect(done.syllabusRecorded).toBe(true);
    expect(done.assignmentId).toBeTruthy();
    const mod = await inOak(() => CourseModule.findById(m._id).lean());
    expect(mod.topics[0].done).toBe(true);
    expect(mod.status).toBe('IN_PROGRESS');
    expect(await inOak(() => Assignment.countDocuments({ subjectOfferingId: s.offerings.engA._id }))).toBe(1);
    await expect(inOak(() => plans.update(T, p.id, { title: 'changed' }))).rejects.toMatchObject({ code: 'PLAN_TAUGHT' });
    await expect(inOak(() => plans.remove(T, p.id))).rejects.toMatchObject({ code: 'PLAN_TAUGHT' });
    const edited = await inOak(() => plans.update(T, p.id, { reflection: 'Revised note' }));
    expect(edited.reflection).toBe('Revised note');
  });

  it('copies to another section of the same subject only; the principal reads all and leaves feedback', async () => {
    const T2 = s.people.T2.actor;
    const p = await inOak(() => plans.create(T2, { subjectOfferingId: String(s.offerings.mathsA._id), date: ymdIn(1), title: 'Fractions' }));
    const copy = await inOak(() => plans.copyTo(T2, p.id, { subjectOfferingId: String(s.offerings.mathsB._id), date: ymdIn(2) }));
    expect(copy.sectionId).toBe(String(s.sectionB._id));
    await expect(inOak(() => plans.copyTo(T2, p.id, { subjectOfferingId: String(s.offerings.engA._id) }))).rejects.toMatchObject({ code: 'NOT_YOUR_SUBJECT' });
    const P = s.people.PRINCIPAL.actor;
    const all = await inOak(() => plans.list(P, {}));
    expect(all.items).toHaveLength(2);
    expect(all.canReviewAll).toBe(true);
    const fb = await inOak(() => plans.addFeedback(P, p.id, { note: 'Add a toy-based opener.' }));
    expect(fb.feedback[0].note).toMatch(/toy-based/);
    expect(fb.status).toBe('DRAFT'); // feedback never changes the plan
    await expect(inOak(() => plans.addFeedback(s.people.TEACHER.actor, p.id, { note: 'x' }))).rejects.toMatchObject({ code: 'NOT_REVIEWER' });
    const mine = await inOak(() => plans.list(s.people.TEACHER.actor, {}));
    expect(mine.items).toHaveLength(0);
  });
});

describe('question bank and papers', () => {
  async function fill(T) {
    const base = { subjectId: String(s.subjects.maths._id), gradeId: String(s.grade._id) };
    const add = (x) => inOak(() => bank.addQuestion(T, { ...base, ...x }));
    await add({ chapter: 'Fractions', type: 'MCQ', marks: 1, bloom: 'REMEMBER', text: 'Which is a proper fraction?', options: [{ text: '3/2' }, { text: '2/3', isCorrect: true }] });
    await add({ chapter: 'Decimals', type: 'MCQ', marks: 1, bloom: 'UNDERSTAND', text: '0.5 equals?', options: [{ text: '1/2', isCorrect: true }, { text: '1/5' }] });
    await add({ chapter: 'Fractions', type: 'CASE_BASED', marks: 4, bloom: 'APPLY', text: 'A pizza shared among friends...' });
    await add({ chapter: 'Decimals', type: 'SA', marks: 3, bloom: 'ANALYSE', text: 'Compare the two bills.' });
    await add({ chapter: 'Decimals', type: 'SA', marks: 3, bloom: 'REMEMBER', text: 'Write 0.75 as a fraction.' });
    return base;
  }

  it('validates questions, keeps the bank to the subjects a teacher teaches, and edits stay with the author', async () => {
    const T2 = s.people.T2.actor;
    const base = await fill(T2);
    await expect(inOak(() => bank.addQuestion(T2, { ...base, chapter: 'x', type: 'MCQ', marks: 1, text: 'q', options: [{ text: 'a' }, { text: 'b' }] }))).rejects.toMatchObject({ code: 'ONE_CORRECT' });
    await expect(inOak(() => bank.addQuestion(s.people.TEACHER.actor, { ...base, chapter: 'x', type: 'SA', marks: 2, text: 'q' }))).rejects.toMatchObject({ code: 'NOT_YOUR_SUBJECT' });
    const list = await inOak(() => bank.listQuestions(T2, base));
    expect(list.totals.questions).toBe(5);
    expect(list.totals.competencyBased).toBe(2); // the case-based and the analyse question
    const other = await inOak(() => bank.addQuestion(s.people.PRINCIPAL.actor, { ...base, chapter: 'Fractions', type: 'VSA', marks: 1, text: 'Simplify 4/8.' }));
    await expect(inOak(() => bank.updateQuestion(T2, other.id, { text: 'mine now' }))).rejects.toMatchObject({ code: 'NOT_AUTHOR' });
    const scopes = await inOak(() => bank.scopes(T2));
    expect(scopes[0].chapters).toEqual(expect.arrayContaining(['Decimals', 'Fractions']));
  });

  it('builds a paper from a blueprint, flags what a head of department would, and counts use when final', async () => {
    const T2 = s.people.T2.actor;
    const base = await fill(T2);
    const paper = await inOak(() => bank.buildPaper(T2, { ...base, title: 'PT 1', targetMarks: 10, blueprint: [{ type: 'MCQ', count: 2 }, { type: 'SA', count: 1 }, { type: 'CASE_BASED', count: 1 }, { type: 'LA', count: 1 }] }));
    expect(paper.status).toBe('DRAFT');
    expect(paper.analysis.totalMarks).toBe(9);
    // Competency is under target, so the analyse SA is chosen over the recall one.
    expect(paper.sections[1].questions[0].bloom).toBe('ANALYSE');
    expect(paper.analysis.competencyPct).toBe(78);
    expect(paper.shortfalls.join(' ')).toMatch(/0 of the 1 Long answer/);
    expect(paper.analysis.warnings.join(' ')).toMatch(/add up to 9 marks; the paper is for 10/);
    expect(paper.analysis.warnings.join(' ')).toMatch(/Section .* has no questions/);
    const fin = await inOak(() => bank.finalisePaper(T2, paper.id));
    expect(fin.status).toBe('FINAL');
    expect(await inOak(() => BankQuestion.countDocuments({ timesUsed: 1 }))).toBe(4);
    await expect(inOak(() => bank.updatePaper(T2, paper.id, { title: 'x' }))).rejects.toMatchObject({ code: 'PAPER_FINAL' });
    await expect(inOak(() => bank.getPaper(s.people.TEACHER.actor, paper.id))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('pure analysis: the competency share and repeats', () => {
    const q = (id, marks, competencyBased, bloom = 'REMEMBER', chapter = 'A') => ({ _id: id, marks, competencyBased, bloom, chapter, type: 'SA', difficulty: 'EASY' });
    const a = bank.analyse({ competencyTargetPct: 50, sections: [{ title: 'A', questionIds: ['1', '2', '1'] }] }, [q('1', 2, false), q('2', 2, true, 'EVALUATE', 'B')]);
    expect(a.totalMarks).toBe(6);
    expect(a.competencyPct).toBe(33);
    expect(a.warnings.join(' ')).toMatch(/more than once/);
    expect(a.warnings.join(' ')).toMatch(/33%/);
  });

  it('sends the MCQs of a paper to a draft quiz for one of the teacher\'s classes', async () => {
    const T2 = s.people.T2.actor;
    const base = await fill(T2);
    const paper = await inOak(() => bank.buildPaper(T2, { ...base, blueprint: [{ type: 'MCQ', count: 2 }, { type: 'SA', count: 1 }] }));
    const out = await inOak(() => bank.toQuiz(T2, 'OWN', { paperId: paper.id, subjectOfferingId: String(s.offerings.mathsA._id), title: 'Fractions quick check' }));
    expect(out.questions).toBe(2);
    expect(out.skippedNonMcq).toBe(1);
    const quiz = await inOak(() => Quiz.findById(out.quizId).lean());
    expect(quiz.status).toBe('DRAFT');
    expect(quiz.questions).toHaveLength(2);
    await expect(inOak(() => bank.toQuiz(s.people.TEACHER.actor, 'OWN', { paperId: paper.id, subjectOfferingId: String(s.offerings.mathsA._id) }))).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('CPD hours', () => {
  it('adds logged hours to attended trainings, flags the gaps, and only someone else verifies', async () => {
    const T = s.people.TEACHER.actor;
    await inOak(() => TrainingSession.create({ refNo: 'TRN/2026/0001', topic: 'POCSO_CHILD_PROTECTION', title: 'POCSO refresher', audience: 'TEACHING_STAFF', scheduledAt: new Date('2026-06-10'), durationMinutes: 180, status: 'COMPLETED', participants: [{ profileId: s.people.TEACHER.profile._id, name: 'T', status: 'ATTENDED' }, { profileId: s.people.T2.profile._id, name: 'T2', status: 'ABSENT' }] }));
    const e = await inOak(() => cpd.add(T, { title: 'CBSE COE: competency-based assessment', provider: 'CBSE COE Pune', mode: 'EXTERNAL', area: 'KNOWLEDGE_PRACTICE', hours: 12, date: '2026-07-20', online: true }));
    await expect(inOak(() => cpd.add(T, { title: 'x', mode: 'EXTERNAL', area: 'CORE_VALUES', hours: 2, date: ymdIn(5) }))).rejects.toMatchObject({ code: 'FUTURE_CPD' });
    await expect(inOak(() => cpd.add(T, { title: 'x', mode: 'EXTERNAL', area: 'CORE_VALUES', hours: 2, date: '2025-05-01' }))).rejects.toMatchObject({ code: 'CPD_OLD_YEAR' });
    await expect(inOak(() => cpd.add(T, { title: 'x', mode: 'EXTERNAL', area: 'CORE_VALUES', hours: 2, date: '2026-07-01', evidenceUrl: 'javascript:alert(1)' }))).rejects.toMatchObject({ code: 'BAD_EVIDENCE' });
    const me = await inOak(() => cpd.mine(T));
    expect(me.summary.total).toBe(15);
    expect(me.summary.byMode).toEqual({ EXTERNAL: 12, IN_HOUSE: 3 });
    expect(me.summary.unverifiedHours).toBe(12);
    expect(me.summary.gaps.join(' ')).toMatch(/35 more hours to reach 50/);
    expect(me.entries.find((x) => x.source === 'TRAINING').area).toBe('CORE_VALUES');
    const t2 = await inOak(() => cpd.mine(s.people.T2.actor));
    expect(t2.summary.total).toBe(0); // absent from the training: not counted
    await expect(inOak(() => cpd.verify(T, e.id))).rejects.toMatchObject({ statusCode: 403 });
    const v = await inOak(() => cpd.verify(s.people.HR.actor, e.id));
    expect(v.verified).toBe(true);
    await expect(inOak(() => cpd.remove(T, e.id))).rejects.toMatchObject({ code: 'CPD_VERIFIED' });
    const ov = await inOak(() => cpd.overview(s.people.PRINCIPAL.actor));
    expect(ov.rows.find((r) => r.profileId === String(s.people.TEACHER.profile._id)).total).toBe(15);
    await expect(inOak(() => cpd.overview(T))).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('syllabus for the class teacher', () => {
  it('shows every subject of their own class, read-only, and nothing of other classes', async () => {
    await moduleFor(s.offerings.mathsA, 'Fractions', ['Proper', 'Improper']);
    const rows = (await inOak(() => syllabus.overview(s.people.TEACHER.actor))).rows;
    const subjects = rows.map((r) => `${r.class} ${r.subject}`).sort();
    expect(subjects).toEqual(['Class 6 A English', 'Class 6 A Mathematics']);
    expect(rows.find((r) => r.subject === 'Mathematics').canManage).toBe(false);
    const plan = await inOak(() => syllabus.plan(s.people.TEACHER.actor, String(s.offerings.mathsA._id)));
    expect(plan.canManage).toBe(false);
    await expect(inOak(() => syllabus.plan(s.people.TEACHER.actor, String(s.offerings.mathsB._id)))).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('paper results', () => {
  it('summarises a marks grid: averages, CBSE bands, pass share and the suggested remedial group', async () => {
    const { analyseGrid } = await import('../src/modules/teaching/paperResults.service.js');
    const row = (rollNo, marks, absence = null) => ({ rollNo, studentName: `S${rollNo}`, marks, absence, status: 'DRAFT' });
    const a = analyseGrid({ examSubject: { examName: 'PT 1', subject: 'Maths', class: '6 A', maxMarks: 40 }, rows: [row(1, 38), row(2, 30), row(3, 10), row(4, null, 'AB'), row(5, null)] });
    expect(a.entered).toBe(3);
    expect(a.absent).toBe(1);
    expect(a.pending).toBe(1);
    expect(a.average).toBe(65);
    expect(a.highest).toBe(38);
    expect(a.passPct).toBe(67);
    expect(a.bands.find((b) => b.grade === 'A1').count).toBe(1); // 95%
    expect(a.bands.find((b) => b.grade === 'B1').count).toBe(1); // 75%
    expect(a.remedial.map((r) => r.name)).toEqual(['S3']);
    expect(a.notes.join(' ')).toMatch(/1 pupil has no mark yet/);
  });
});
