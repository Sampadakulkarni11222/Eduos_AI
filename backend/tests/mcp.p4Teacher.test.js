import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { MCP_TOOLS, mcpToolsFor, confirmableOn, validateMcpRegistry } from '../src/modules/ai/mcp/registry.js';
import { teacherP4Tools } from '../src/modules/ai/mcp/tools/p4Teacher.js';
import { isDecidingToolName } from '../src/modules/ai/mcp/decisions.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { CourseModule } from '../src/models/courseModule.model.js';
import { LessonPlan, BankQuestion, QuestionPaper, CpdEntry } from '../src/models/teaching.model.js';
import { Quiz } from '../src/models/quiz.model.js';
import { Assignment } from '../src/models/assignment.model.js';
import { inSchool, mcp, actorForRole, OAK } from './support/mcpSchool.js';
import { seedFamilySchool, ymdIn } from './support/familySchool.js';

/**
 * The teacher's planning tools for the assistant (tools/p4Teacher.js): every
 * write drafted then confirmed by the same person, nothing that publishes or
 * decides, each scoped to the caller's own classes.
 */
const NAMES = Object.keys(teacherP4Tools);
let s;
const inOak = (fn) => inSchool(OAK, fn);
const confirm = async (actor, name, args) => {
  const proposal = await mcp(OAK, actor, name, args);
  expect(proposal.success, JSON.stringify(proposal.error)).toBe(true);
  expect(proposal.action.status).toBe('confirmation_required');
  const done = await mcp(OAK, actor, name, {}, { confirmationToken: proposal.action.confirmationToken });
  expect(done.success, JSON.stringify(done.error)).toBe(true);
  return { proposal, done };
};

beforeEach(async () => {
  s = await seedFamilySchool();
  await inOak(() => CourseModule.create({
    subjectOfferingId: s.offerings.engA._id, sectionId: s.sectionA._id, teacherId: s.people.TEACHER.profile._id, order: 1, title: 'Nouns',
    plannedStart: new Date(Date.now() - 5 * 86_400_000), plannedEnd: new Date(Date.now() + 20 * 86_400_000), topics: [{ title: 'Common nouns' }, { title: 'Proper nouns' }],
  }));
});
afterAll(async () => { await resetMcpClient(); });

describe('the contract', () => {
  it('registers seventeen closed, non-deciding tools; every write confirms; the boot check passes', () => {
    expect(NAMES).toHaveLength(17);
    for (const n of NAMES) {
      const t = MCP_TOOLS[n];
      expect(t, n).toBeTruthy();
      expect(t.inputSchema.additionalProperties, n).toBe(false);
      expect(isDecidingToolName(n), n).toBe(false);
      if (t.operation !== 'GET') { expect(t.confirm, n).toBe(true); expect(typeof t.summarise, n).toBe('function'); }
    }
    expect(validateMcpRegistry()).toEqual([]);
    // Changes on a pupil's card or another teacher's plan are confirmed on the website only.
    for (const n of ['save_report_card_component_marks', 'save_co_scholastic_grades', 'add_lesson_plan_feedback']) expect(confirmableOn(MCP_TOOLS[n], 'WHATSAPP'), n).toBe(false);
    expect(confirmableOn(MCP_TOOLS.save_lesson_plan, 'WHATSAPP')).toBe(true);
  });

  it('shows the teacher their tools, the principal the oversight ones, and families none', () => {
    const visible = (role) => mcpToolsFor(actorForRole(role)).map((t) => t.name).filter((n) => NAMES.includes(n)).sort();
    const teacher = visible('TEACHER');
    expect(teacher).toEqual(NAMES.filter((n) => !['add_lesson_plan_feedback', 'list_staff_cpd_hours'].includes(n)).sort());
    expect(visible('PRINCIPAL')).toEqual(expect.arrayContaining(['add_lesson_plan_feedback', 'list_staff_cpd_hours', 'list_lesson_plans']));
    expect(visible('HR')).toEqual(['get_my_cpd_hours', 'list_staff_cpd_hours', 'log_cpd_hours']);
    for (const role of ['PARENT', 'STUDENT']) expect(visible(role), role).toEqual([]);
  });
});

describe('through the real MCP server', () => {
  it('suggests, then saves a lesson plan only after confirmation, then marks it taught with homework', async () => {
    const T = s.people.TEACHER.actor;
    const sug = await mcp(OAK, T, 'get_lesson_plan_suggestion', { className: 'Class 6 A', subject: 'English' });
    expect(sug.success, JSON.stringify(sug.error)).toBe(true);
    expect(sug.data.saved).toBe(false);
    expect(sug.data.plan.title).toMatch(/Nouns/);
    const proposal = await mcp(OAK, T, 'save_lesson_plan', { className: '6 A', subject: 'English', homework: 'Five proper nouns from the newspaper.' });
    expect(proposal.action.summary).toMatch(/Class 6 A · English .*Nouns/);
    expect(await inOak(() => LessonPlan.countDocuments())).toBe(0);
    await mcp(OAK, T, 'save_lesson_plan', {}, { confirmationToken: proposal.action.confirmationToken });
    expect(await inOak(() => LessonPlan.countDocuments())).toBe(1);
    const listed = await mcp(OAK, T, 'list_lesson_plans', {});
    expect(listed.data.plans).toHaveLength(1);
    const { done } = await confirm(T, 'mark_lesson_taught', { subject: 'English', reflection: 'Good energy', homeworkDueOn: ymdIn(2) });
    expect(done.data.syllabusRecorded).toBe(true);
    expect(await inOak(() => Assignment.countDocuments())).toBe(1);
    const mod = await inOak(() => CourseModule.findOne().lean());
    expect(mod.topics.every((t) => t.done)).toBe(true);
  });

  it('refuses a class the teacher does not teach, and feedback from a teacher', async () => {
    const T = s.people.TEACHER.actor;
    const r = await mcp(OAK, T, 'save_lesson_plan', { className: '6 B', subject: 'Science' });
    expect(r.success).toBe(false);
    const fb = await mcp(OAK, T, 'add_lesson_plan_feedback', { note: 'x' });
    expect(fb.success).toBe(false);
  });

  it('banks questions, builds a paper with its checks, and turns its MCQs into a draft quiz', async () => {
    const T2 = s.people.T2.actor;
    await confirm(T2, 'add_bank_question', { className: '6 A', subject: 'Maths', chapter: 'Fractions', type: 'MCQ', marks: 1, question: 'Which is a proper fraction?', options: ['3/2', '2/3'], correctOption: 2 });
    await confirm(T2, 'add_bank_question', { className: '6 A', subject: 'Maths', chapter: 'Fractions', type: 'CASE_BASED', marks: 4, question: 'A pizza is shared among four friends...' });
    const missing = await mcp(OAK, T2, 'add_bank_question', { className: '6 A', subject: 'Maths', chapter: 'Fractions', type: 'MCQ', marks: 1, question: 'q' });
    expect(missing.success).toBe(false);
    expect(await inOak(() => BankQuestion.countDocuments())).toBe(2);
    const { done } = await confirm(T2, 'build_question_paper', { className: '6 A', subject: 'Maths', title: 'PT 1 Maths', targetMarks: 5, blueprint: [{ type: 'MCQ', count: 1 }, { type: 'CASE_BASED', count: 1 }] });
    expect(done.data.totalMarks).toBe(5);
    expect(done.data.competencyPct).toBe(80);
    const check = await mcp(OAK, T2, 'check_question_paper', { title: 'PT 1' });
    expect(check.data.warnings).toEqual(['No question asks students to analyse, evaluate or create.']);
    expect((await inOak(() => QuestionPaper.findOne().lean())).status).toBe('DRAFT');
    const q = await confirm(T2, 'make_quiz_from_paper', { paperTitle: 'PT 1', className: '6 B', subject: 'Maths' });
    expect(q.done.data.questions).toBe(1);
    expect((await inOak(() => Quiz.findOne().lean())).status).toBe('DRAFT');
    // The bank is the subject teacher's: the English teacher cannot search Maths.
    const other = await mcp(OAK, s.people.TEACHER.actor, 'search_question_bank', { className: '6 A', subject: 'Maths' });
    expect(other.success).toBe(false);
  });

  it('drafts a quiz and a syllabus module the teacher dictates', async () => {
    const T = s.people.TEACHER.actor;
    await confirm(T, 'create_quiz_draft', { className: '6 A', subject: 'English', title: 'Nouns check', questions: [{ question: 'Pick the proper noun', options: ['city', 'Pune'], correctOption: 2 }] });
    const quiz = await inOak(() => Quiz.findOne().lean());
    expect(quiz.status).toBe('DRAFT');
    expect(quiz.questions).toHaveLength(1);
    await confirm(T, 'plan_syllabus_module', { className: '6 A', subject: 'English', title: 'Verbs', plannedStart: ymdIn(10), plannedEnd: ymdIn(30), topics: ['Action verbs', 'Helping verbs'] });
    expect(await inOak(() => CourseModule.countDocuments())).toBe(2);
  });

  it('logs CPD hours for oneself, and HR reads the staff overview', async () => {
    const T = s.people.TEACHER.actor;
    await confirm(T, 'log_cpd_hours', { title: 'CBSE capacity building: art-integrated learning', mode: 'EXTERNAL', area: 'KNOWLEDGE_PRACTICE', hours: 6, date: '2026-08-10' });
    expect(await inOak(() => CpdEntry.countDocuments({ profileId: s.people.TEACHER.profile._id }))).toBe(1);
    const mine = await mcp(OAK, T, 'get_my_cpd_hours', {});
    expect(mine.data.total).toBe(6);
    const ov = await mcp(OAK, s.people.HR.actor, 'list_staff_cpd_hours', {});
    expect(ov.success, JSON.stringify(ov.error)).toBe(true);
    expect(ov.data.pendingVerification).toBe(1);
    const refused = await mcp(OAK, T, 'list_staff_cpd_hours', {});
    expect(refused.success).toBe(false);
  });
});

describe('report cards and plan feedback through the assistant', () => {
  it('enters a notebook mark (subject teacher) and co-scholastic grades (class teacher) on a draft card, confirmed', async () => {
    const rc = await import('../src/modules/reportcards/reportcards.service.js');
    const { TermReportCard } = await import('../src/models/reportCard.model.js');
    const T = s.people.TEACHER.actor;
    await inOak(async () => { await rc.ensureDefaultTemplate(); await rc.generate(T, 'OWN', { sectionId: String(s.sectionA._id), termKey: 'TERM_1' }); });
    const nb = await confirm(T, 'save_report_card_component_marks', { studentName: 'Rahul Sharma', subject: 'English', component: 'Notebook', marks: 4 });
    expect(nb.proposal.action.summary).toMatch(/Notebook 4\/5 in English on Rahul Sharma/);
    const over = await mcp(OAK, T, 'save_report_card_component_marks', { studentName: 'Rahul Sharma', subject: 'English', component: 'Notebook', marks: 9 });
    expect(over.success).toBe(false);
    // The Maths teacher may not enter English.
    const notMine = await mcp(OAK, s.people.T2.actor, 'save_report_card_component_marks', { studentName: 'Rahul Sharma', subject: 'English', component: 'Notebook', marks: 3 });
    expect(notMine.success).toBe(false);
    await confirm(T, 'save_co_scholastic_grades', { studentName: 'Rahul Sharma', grades: [{ area: 'Art education', grade: 'A' }], discipline: 'B' });
    const card = await inOak(() => TermReportCard.findOne({ studentId: s.rahul.student._id }).lean());
    expect(card.coScholastic.ART_EDUCATION).toBe('A');
    expect(card.discipline).toBe('B');
    expect(card.manualMarks[String(s.offerings.engA._id)].NB).toBe(4);
  });

  it('the principal leaves feedback on a teacher\'s plan; the plan is unchanged', async () => {
    await inOak(() => LessonPlan.create({ teacherId: s.people.TEACHER.profile._id, subjectOfferingId: s.offerings.engA._id, sectionId: s.sectionA._id, date: new Date(`${ymdIn(0)}T00:00:00Z`), title: 'Nouns intro' }));
    const { done } = await confirm(s.people.PRINCIPAL.actor, 'add_lesson_plan_feedback', { title: 'Nouns intro', note: 'Try a toy-based opener.' });
    expect(done.data.title).toBe('Nouns intro');
    const p = await inOak(() => LessonPlan.findOne().lean());
    expect(p.feedback).toHaveLength(1);
    expect(p.status).toBe('DRAFT');
  });
});
