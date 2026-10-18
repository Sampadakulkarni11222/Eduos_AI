import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { MCP_TOOLS, mcpToolsFor, confirmableOn, validateMcpRegistry } from '../src/modules/ai/mcp/registry.js';
import { tools as academicTools } from '../src/modules/ai/mcp/tools/p6/academic.js';
import { isDecidingToolName } from '../src/modules/ai/mcp/decisions.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import * as quizzes from '../src/modules/quizzes/quiz.service.js';
import * as plans from '../src/modules/teaching/lessonPlans.service.js';
import * as bank from '../src/modules/teaching/questionBank.service.js';
import * as cpd from '../src/modules/teaching/cpd.service.js';
import { SchoolShift } from '../src/models/schoolShift.model.js';
import { Quiz, QuizAttempt } from '../src/models/quiz.model.js';
import { AttendanceDraft } from '../src/models/attendanceDraft.model.js';
import { LessonPlan, QuestionPaper, CpdEntry } from '../src/models/teaching.model.js';
import { TermReportCard } from '../src/models/reportCard.model.js';
import { SupportPlan } from '../src/models/supportPlan.model.js';
import { PortfolioRating } from '../src/models/competencyPortfolio.model.js';
import { inSchool, mcp, actorForRole, OAK } from './support/mcpSchool.js';
import { seedFamilySchool, ymdIn } from './support/familySchool.js';

/**
 * The part-6 academic coverage tools (tools/p6/academic.js): the academic
 * routes that had no assistant tool. Every write is drafted, changes nothing
 * until the same person confirms it, and runs through the module's own service.
 */
const NAMES = Object.keys(academicTools);
const APPROVER = ['record_cpd_verification', 'record_report_card_moderation', 'record_class_report_card_moderation'];
let s;
const inOak = (fn) => inSchool(OAK, fn);

async function confirm(actor, name, args, { unchanged, channel = 'WEB' } = {}) {
  const proposal = await mcp(OAK, actor, name, args, { channel });
  expect(proposal.success, `${name}: ${JSON.stringify(proposal.error)}`).toBe(true);
  expect(proposal.action.status).toBe('confirmation_required');
  if (unchanged) expect(await unchanged()).toBe(true);
  const done = await mcp(OAK, actor, name, {}, { channel, confirmationToken: proposal.action.confirmationToken });
  expect(done.success, `${name}: ${JSON.stringify(done.error)}`).toBe(true);
  return { proposal, done };
}
async function read(actor, name, args = {}) {
  const out = await mcp(OAK, actor, name, args);
  expect(out.success, `${name}: ${JSON.stringify(out.error)}`).toBe(true);
  return out;
}

beforeEach(async () => { s = await seedFamilySchool(); });
afterAll(async () => { await resetMcpClient(); });

describe('the contract', () => {
  it('registers closed, non-deciding tools; writes confirm and summarise; approver tools are HIGH, web-only and need a stated decision', () => {
    expect(NAMES.length).toBe(69);
    for (const n of NAMES) {
      const t = MCP_TOOLS[n];
      expect(t, n).toBe(academicTools[n]);
      expect(t.inputSchema.additionalProperties, n).toBe(false);
      expect(isDecidingToolName(n), n).toBe(false);
      if (t.operation === 'GET') expect(/^(get_|list_|search_)/.test(n), n).toBe(true);
      else {
        expect(t.confirm, n).toBe(true);
        expect(typeof t.summarise, n).toBe('function');
      }
    }
    for (const n of APPROVER) {
      const t = MCP_TOOLS[n];
      expect(t.approverDecision, n).toBe(true);
      expect(t.risk, n).toBe('HIGH');
      expect(confirmableOn(t, 'WHATSAPP'), n).toBe(false);
      expect(t.inputSchema.required, n).toContain('decision');
      expect(t.inputSchema.properties.decision.default, n).toBeUndefined();
    }
    expect(validateMcpRegistry()).toEqual([]);
    for (const n of ['save_attendance_draft', 'start_quiz', 'submit_quiz_answers', 'join_online_class', 'acknowledge_support_plan', 'delete_cpd_entry']) {
      expect(confirmableOn(MCP_TOOLS[n], 'WHATSAPP'), n).toBe(true);
    }
  });

  it('shows each role only what its routes allow', () => {
    const visible = (role) => mcpToolsFor(actorForRole(role)).map((t) => t.name).filter((n) => NAMES.includes(n));
    const student = visible('STUDENT');
    expect(student).toEqual(expect.arrayContaining(['start_quiz', 'submit_quiz_answers', 'get_my_quiz_answers', 'get_quiz_to_take', 'list_support_plans', 'get_student_portfolio']));
    expect(student).not.toContain('create_school_shift');
    const teacher = visible('TEACHER');
    expect(teacher).toEqual(expect.arrayContaining(['get_quiz', 'release_quiz', 'save_attendance_draft', 'open_support_plan', 'generate_term_report_cards']));
    for (const n of ['start_quiz', 'create_school_shift', 'record_cpd_verification']) expect(teacher, n).not.toContain(n);
    expect(visible('HR')).toContain('record_cpd_verification');
    expect(visible('PARENT')).not.toContain('open_support_plan');
  });
});

describe('enrolment, shifts and announcements', () => {
  it('reads the next roll number, sets up a shift on the website and refuses it to a teacher and a family', async () => {
    const admin = s.people.ADMIN.actor;
    expect((await read(admin, 'get_next_roll_number', { className: 'Class 6 A' })).data.nextRollNo).toBe(4);

    const args = { code: 'MORN', name: 'Morning shift', bells: [{ kind: 'PERIOD', periodNo: 1, start: '09:00', end: '09:45' }, { kind: 'PERIOD', periodNo: 2, start: '09:45', end: '10:30' }], classes: ['Class 6 A'] };
    const wa = await mcp(OAK, admin, 'create_school_shift', args, { channel: 'WHATSAPP' });
    expect(wa.success).toBe(false);
    expect(wa.error.details?.reason).toBe('CONFIRM_ON_WEB');
    await confirm(admin, 'create_school_shift', args, { unchanged: async () => (await inOak(() => SchoolShift.countDocuments())) === 0 });
    const shift = await inOak(() => SchoolShift.findOne({ code: 'MORN' }).lean());
    expect(shift.sectionIds.map(String)).toEqual([String(s.sectionA._id)]);

    expect((await read(s.people.TEACHER.actor, 'list_school_shifts')).data.total).toBe(1);
    expect((await mcp(OAK, s.people.PARENT.actor, 'list_school_shifts')).success).toBe(false);
    expect((await mcp(OAK, s.people.TEACHER.actor, 'retire_school_shift', { shift: 'MORN' })).success).toBe(false);
    await confirm(admin, 'retire_school_shift', { shift: 'Morning' });
    expect((await inOak(() => SchoolShift.findById(shift._id).lean())).active).toBe(false);

    const pv = await read(s.people.TEACHER.actor, 'get_announcement_preview', { title: 'Trip', content: 'Bring water', forClass: 'Class 6 A' });
    expect(pv.data.recipientCount).toBe(3);
  }, 120_000);
});

describe('attendance drafts', () => {
  it('saves, reads and discards a teacher\'s own draft register without submitting it', async () => {
    const T = s.people.TEACHER.actor;
    await confirm(T, 'save_attendance_draft', { className: 'Class 6 A', marks: [{ student: 'Rahul', status: 'ABSENT' }], everyoneElse: 'PRESENT' }, { unchanged: async () => (await inOak(() => AttendanceDraft.countDocuments())) === 0 });
    const got = await read(T, 'get_attendance_draft', { className: 'Class 6 A' });
    expect(got.data.marks).toHaveLength(3);
    expect(got.data.marks.find((m) => m.student.startsWith('Rahul')).status).toBe('ABSENT');
    await confirm(T, 'discard_attendance_draft', { className: 'Class 6 A' });
    expect(await inOak(() => AttendanceDraft.countDocuments())).toBe(0);
  }, 120_000);
});

describe('quizzes', () => {
  it('a teacher edits and releases a quiz; the student starts, submits and reads it back; the teacher reads the results', async () => {
    const T = s.people.TEACHER.actor;
    const quiz = await inOak(async () => {
      const q = await quizzes.create(T, 'OWN', { subjectOfferingId: String(s.offerings.engA._id), title: 'Nouns quiz' });
      await quizzes.addQuestion(T, 'OWN', q.id, { text: 'Which is a noun?', marks: 1, options: [{ text: 'Run' }, { text: 'Dog', isCorrect: true }] });
      await quizzes.addQuestion(T, 'OWN', q.id, { text: 'Which is a verb?', marks: 1, options: [{ text: 'Jump', isCorrect: true }, { text: 'Cat' }] });
      return q;
    });
    expect((await read(T, 'get_quiz', { quiz: 'Nouns' })).data.questions).toHaveLength(2);
    await confirm(T, 'update_quiz_question', { quiz: 'Nouns', questionNumber: 2, question: 'Which word is a verb?', options: ['Jump', 'Cat', 'Hat'], correctOption: 1 });
    await confirm(T, 'release_quiz', { quiz: 'Nouns', step: 'RELEASE' }, { unchanged: async () => (await inOak(() => Quiz.findById(quiz.id).lean())).status === 'DRAFT' });

    const ST = s.people.STUDENT.actor;
    expect((await read(ST, 'get_quiz_to_take', { quiz: 'Nouns' })).data.myAttempt).toBeNull();
    await confirm(ST, 'start_quiz', { quiz: 'Nouns' }, { channel: 'WHATSAPP' });
    await confirm(ST, 'submit_quiz_answers', { quiz: 'Nouns', answers: [{ question: 1, option: '2' }, { question: 2, option: 'Cat' }] });
    const attempt = await inOak(() => QuizAttempt.findOne({ quizId: quiz.id }).lean());
    expect(attempt.score).toBe(1);
    expect((await read(ST, 'get_my_quiz_answers', { quiz: 'Nouns' })).data.correctCount).toBe(1);
    // A teacher cannot take a quiz.
    expect((await mcp(OAK, T, 'start_quiz', { quiz: 'Nouns' })).success).toBe(false);

    const results = await read(T, 'get_quiz_results', { quiz: 'Nouns' });
    expect(results.data.summary.attemptedCount).toBe(1);
  }, 120_000);
});

describe('lesson plans, question bank and CPD', () => {
  it('reads, changes and copies a plan; builds and finalises a paper; HR verifies CPD hours on the website only', async () => {
    const T2 = s.people.T2.actor;
    await inOak(async () => {
      await plans.create(T2, { subjectOfferingId: String(s.offerings.mathsA._id), date: ymdIn(1), title: 'Fractions intro' });
      await bank.addQuestion(T2, { subjectId: String(s.subjects.maths._id), gradeId: String(s.grade._id), chapter: 'Fractions', type: 'VSA', marks: 2, text: 'What is half of 10?' });
    });
    expect((await read(T2, 'get_lesson_plan', { title: 'Fractions' })).data.title).toBe('Fractions intro');
    await confirm(T2, 'update_lesson_plan', { title: 'Fractions', newTitle: 'Fractions: halves', status: 'READY' });
    await confirm(T2, 'duplicate_lesson_plan', { title: 'halves', toClass: 'Class 6 B' });
    expect(await inOak(() => LessonPlan.countDocuments({ title: 'Fractions: halves' }))).toBe(2);

    await confirm(T2, 'draft_question_paper', { subject: 'Maths', className: 'Class 6 A', title: 'Unit test 1', sections: [{ questions: ['half of 10'] }] }, { unchanged: async () => (await inOak(() => QuestionPaper.countDocuments())) === 0 });
    await confirm(T2, 'finalise_question_paper', { title: 'Unit test 1' });
    expect((await inOak(() => QuestionPaper.findOne().lean())).status).toBe('FINAL');

    const T = s.people.TEACHER.actor;
    await inOak(() => cpd.add(T, { title: 'Inclusive classrooms', mode: 'EXTERNAL', area: 'CORE_VALUES', hours: 3, date: ymdIn(0) }));
    const HR = s.people.HR.actor;
    const args = { colleague: s.people.TEACHER.profile.displayName, title: 'Inclusive', decision: 'VERIFIED' };
    const wa = await mcp(OAK, HR, 'record_cpd_verification', args, { channel: 'WHATSAPP' });
    expect(wa.error.details?.reason).toBe('CONFIRM_ON_WEB');
    expect((await mcp(OAK, T, 'record_cpd_verification', args)).success).toBe(false);
    await confirm(HR, 'record_cpd_verification', args);
    expect((await inOak(() => CpdEntry.findOne().lean())).verifiedAt).toBeTruthy();
  }, 120_000);
});

describe('report cards, support plans and portfolios', () => {
  it('generates and reads a class\'s cards and returns one to draft', async () => {
    const T = s.people.TEACHER.actor;
    await confirm(T, 'generate_term_report_cards', { className: 'Class 6 A', term: 'Term 1' });
    expect(await inOak(() => TermReportCard.countDocuments())).toBe(3);
    const card = await read(T, 'get_term_report_card', { admissionNo: 'OAK-1', term: 'Term 1' });
    expect(card.data.status).toBe('DRAFT');
    // Another class's cards are not the teacher's to generate.
    expect((await mcp(OAK, s.people.T4.actor, 'generate_term_report_cards', { className: 'Class 6 B', term: 'Term 1' })).success).toBe(false);
    await confirm(T, 'record_report_card_moderation', { admissionNo: 'OAK-1', term: 'Term 1', decision: 'APPROVE', allowIncomplete: true });
    expect((await inOak(() => TermReportCard.findById(card.data.id).lean())).status).toBe('CLASS_TEACHER_APPROVED');
    await confirm(T, 'record_report_card_moderation', { admissionNo: 'OAK-1', term: 'Term 1', decision: 'RETURN_TO_DRAFT', reason: 'Remarks missing' });
    expect((await inOak(() => TermReportCard.findById(card.data.id).lean())).status).toBe('DRAFT');
  }, 120_000);

  it('a teacher opens, extends and shares a plan; the family reads and acknowledges it; portfolios are rated and read', async () => {
    const T = s.people.TEACHER.actor;
    await confirm(T, 'open_support_plan', { admissionNo: 'OAK-1', concernArea: 'ATTENDANCE', summary: 'Help Rahul come to school every day.', goals: [{ title: 'Attendance', measure: 'attendance %', target: 90, reviewOn: ymdIn(14) }] }, { unchanged: async () => (await inOak(() => SupportPlan.countDocuments())) === 0 });
    await confirm(T, 'record_support_plan_progress', { admissionNo: 'OAK-1', goal: 'Attendance', value: 80 });
    await confirm(T, 'add_support_plan_action', { admissionNo: 'OAK-1', action: { title: 'Morning call', ownerKind: 'FAMILY' } });
    await confirm(T, 'share_support_plan_with_family', { admissionNo: 'OAK-1' });
    const P = s.people.PARENT.actor;
    expect((await read(P, 'list_support_plans')).data.total).toBe(1);
    await confirm(P, 'acknowledge_support_plan', { comment: 'Thank you' }, { channel: 'WHATSAPP' });
    expect((await inOak(() => SupportPlan.findOne().lean())).family.acknowledgedAt).toBeTruthy();
    expect((await mcp(OAK, P, 'open_support_plan', { admissionNo: 'OAK-1', concernArea: 'ACADEMIC', summary: 'x', goals: [{ title: 'a', measure: 'b', target: 1, reviewOn: ymdIn(3) }] })).success).toBe(false);
    await confirm(T, 'transition_support_plan', { admissionNo: 'OAK-1', step: 'CLOSE', outcome: 'GOALS_MET', note: 'Attendance recovered' });
    expect((await inOak(() => SupportPlan.findOne().lean())).status).toBe('CLOSED');

    await confirm(T, 'set_portfolio_rating', { admissionNo: 'OAK-1', competency: 'COMMUNICATION', level: 'PROFICIENT', comment: 'Speaks clearly' });
    expect(await inOak(() => PortfolioRating.countDocuments())).toBe(1);
    const pf = await read(P, 'get_student_portfolio', { admissionNo: 'OAK-1' });
    expect(pf.data.counts.rated).toBe(1);
  }, 120_000);
});
