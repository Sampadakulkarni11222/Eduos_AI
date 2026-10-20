import * as plans from '../../../teaching/lessonPlans.service.js';
import * as bank from '../../../teaching/questionBank.service.js';
import * as cpd from '../../../teaching/cpd.service.js';
import * as syllabus from '../../../syllabus/syllabus.service.js';
import * as quizzes from '../../../quizzes/quiz.service.js';
import * as reportcards from '../../../reportcards/reportcards.service.js';
import { SubjectOffering } from '../../../../models/academics.model.js';
import { PEDAGOGIES, QUESTION_TYPES, BLOOM_LEVELS, DIFFICULTIES, CPD_MODES, NPST_AREAS } from '../../../../models/teaching.model.js';
import { AppError } from '../../../../utils/AppError.js';
import { featureEnabled } from '../../../../utils/features.js';
import { ok, action } from '../protocol.js';
import { RISK, theNamed, dateStr, classIdentitySchema, studentIdentitySchema, resolveSection, resolveStudentId } from './_shared.js';

/**
 * The teacher's planning and record-keeping, through the assistant (part 4,
 * teacher audit). Everything a teacher does on the Lesson plans, Question bank,
 * CPD hours, Syllabus, Quizzes and Report cards screens that had no tool:
 *
 *   list_lesson_plans          GET     the week's plans, with what is still to mark taught
 *   get_lesson_plan_suggestion        GET     a starting draft from the syllabus module (nothing saved)
 *   save_lesson_plan           CREATE  save a plan (the suggestion, with the teacher's changes)
 *   mark_lesson_taught         ACTION  the lesson happened: syllabus ticked, homework set
 *   add_lesson_plan_feedback   ACTION  the principal's / coordinator's note on a plan
 *   search_question_bank       GET     questions for a subject and class
 *   add_bank_question          CREATE  a question into the shared bank
 *   build_question_paper       CREATE  a draft paper from a blueprint, with its checks
 *   check_question_paper       GET     a paper's marks, competency share and warnings
 *   make_quiz_from_paper       CREATE  a paper's MCQs into a draft quiz (publishing stays on the page)
 *   create_quiz_draft          CREATE  a draft quiz with MCQs the teacher dictates
 *   plan_syllabus_module       CREATE  a module (chapter) in a class's syllabus plan
 *   get_my_cpd_hours           GET     hours this year against the 50-hour reference
 *   log_cpd_hours              CREATE  log hours from a training
 *   list_staff_cpd_hours     GET     HR / principal: every teacher's hours
 *   save_report_card_component_marks  UPDATE  notebook / subject-enrichment marks on a term card
 *   save_co_scholastic_grades  UPDATE  the class teacher's co-scholastic and discipline grades
 *
 * Every write is drafted and confirmed by the same person (confirm: true).
 * Nothing here publishes, approves or decides: a quiz stays a draft, a paper is
 * not made final, a card is not approved, feedback never changes a plan, CPD
 * hours are verified by someone else on the website.
 */

const text = (max, description) => ({ type: 'string', maxLength: max, ...(description && { description }) });
const closed = (properties, required = []) => ({ type: 'object', properties, ...(required.length && { required }), additionalProperties: false });
const clean = (s) => String(s ?? '').trim().toLowerCase();
const excerpt = (s, n = 100) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}…` : t; };
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const classSubject = { ...classIdentitySchema, subject: text(80, 'The subject, e.g. "Maths"') };

/** What teachers say for a subject, mapped to how timetables usually name it. */
const SUBJECT_ALIASES = { maths: 'mathematics', math: 'mathematics', sst: 'social science', sci: 'science', eng: 'english', comp: 'computer', cs: 'computer science', pe: 'physical education' };

/** One class-and-subject of the caller, from words: "6 A maths". */
async function theOffering(ctx, { className, subject } = {}) {
  let rows = await syllabus.myOfferings(ctx.actor);
  if (className) {
    const section = await resolveSection(ctx, { className });
    if (section) rows = rows.filter((o) => clean(o.label).startsWith(clean(section.label)));
  }
  if (subject) {
    const want = SUBJECT_ALIASES[clean(subject)] ?? clean(subject);
    const sub = (o) => clean(o.label.split('·').pop());
    const exact = rows.filter((o) => sub(o) === want);
    rows = exact.length ? exact : rows.filter((o) => sub(o).includes(want) || want.includes(sub(o)));
  }
  if (!rows.length) throw new AppError(`You do not teach ${subject ?? 'that subject'}${className ? ` in ${className}` : ''}.`, 404, [], 'NOT_FOUND');
  if (rows.length > 1) throw new AppError(`Which class and subject — ${rows.slice(0, 8).map((o) => o.label).join(', ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
  const doc = await SubjectOffering.findById(rows[0].id).populate('sectionId', 'gradeId').lean();
  return { id: rows[0].id, label: rows[0].label, subjectId: String(doc.subjectId), gradeId: String(doc.sectionId?.gradeId) };
}

async function thePlan(ctx, { date, className, subject, title }) {
  const q = { ...(date && { from: date, to: date }) };
  if (className || subject) q.subjectOfferingId = (await theOffering(ctx, { className, subject })).id;
  const rows = (await plans.list(ctx.actor, q)).items;
  if (title) return theNamed(rows, title, { label: 'lesson plan', nameOf: (p) => p.title, describe: (p) => `${p.date} ${p.class} ${p.subject}: ${p.title}` });
  if (!rows.length) throw new AppError('No lesson plan matches. Say the date, class and subject.', 404, [], 'NOT_FOUND');
  if (rows.length > 1) throw new AppError(`Which plan — ${rows.slice(0, 6).map((p) => `${p.date} ${p.class} ${p.subject}: ${p.title}`).join('; ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
  return rows[0];
}

async function thePaper(ctx, title) {
  const rows = await bank.listPapers(ctx.actor, {});
  if (!title) {
    if (rows.length === 1) return rows[0];
    throw new AppError(rows.length ? `Which paper — ${rows.slice(0, 6).map((p) => p.title).join(', ')}?` : 'You have no question papers yet.', rows.length ? 400 : 404, [], rows.length ? 'AGENT_NEEDS_INPUT' : 'NOT_FOUND');
  }
  return theNamed(rows, title, { label: 'question paper', nameOf: (p) => p.title, describe: (p) => `${p.title} (${p.subject} ${p.grade})` });
}

const paperView = (p) => ({
  title: p.title, subject: p.subject, class: p.grade, status: p.status, totalMarks: p.analysis.totalMarks, questions: p.analysis.questions,
  competencyPct: p.analysis.competencyPct, competencyTargetPct: p.analysis.competencyTargetPct, higherOrderPct: p.analysis.higherOrderPct,
  sections: p.sections.map((s) => ({ title: s.title, questions: s.questions.length, marks: s.questions.reduce((n, q) => n + q.marks, 0) })),
  warnings: p.analysis.warnings,
});

async function findCard(ctx, args) {
  const studentId = await resolveStudentId(ctx, args);
  if (!studentId) throw new AppError('Which pupil?', 400, [], 'AGENT_NEEDS_INPUT');
  const rows = (await reportcards.list(ctx.actor, ctx.scope, {})).filter((c) => c.studentId === String(studentId));
  let pool = rows;
  if (args.term) pool = pool.filter((c) => clean(c.termName) === clean(args.term) || clean(c.termKey) === clean(args.term).replace(/\s+/g, '_'));
  if (!pool.length) throw new AppError(rows.length ? `No ${args.term} report card for that pupil yet.` : 'That pupil has no term report card yet. The class teacher prepares the class\'s cards on the Report cards page first.', 404, [], 'NOT_FOUND');
  if (pool.length > 1) {
    const drafts = pool.filter((c) => c.status === 'DRAFT');
    if (drafts.length === 1) return drafts[0];
    throw new AppError(`Which term — ${pool.map((c) => c.termName).join(', ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
  }
  if (pool[0].status === 'PUBLISHED') throw new AppError('This card is already published. A correction goes through the Report cards page.', 409, [], 'CARD_PUBLISHED');
  return pool[0];
}

async function cardsOn() {
  if (!(await featureEnabled('reportCards'))) throw new AppError('Report cards are switched off for this school.', 403, [], 'FEATURE_OFF');
}

const stepSchema = { type: 'array', maxItems: 8, items: closed({ phase: { type: 'string', enum: ['ENGAGE', 'EXPLORE', 'EXPLAIN', 'ELABORATE', 'EVALUATE'] }, minutes: { type: 'integer', minimum: 1, maximum: 120 }, activity: text(600) }, ['phase', 'minutes', 'activity']) };

export const teacherP4Tools = {
  list_lesson_plans: {
    module: 'Lesson plans', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: "A teacher's lesson plans for a day or range (default this week): date, class, subject, title, status (draft, ready, taught) and the ones from past days not yet marked taught. The principal sees every teacher's. Read-only.",
    inputSchema: closed({ from: dateStr('YYYY-MM-DD; default Monday this week'), to: dateStr('YYYY-MM-DD; default Sunday this week'), ...classSubject, status: { type: 'string', enum: ['DRAFT', 'READY', 'TAUGHT'] } }),
    permission: 'syllabus.manage',
    service: 'lessonPlans.service.list()',
    async run(ctx, args) {
      const now = new Date(`${todayIst()}T00:00:00Z`);
      const dow = (now.getUTCDay() + 6) % 7;
      const monday = new Date(now.getTime() - dow * 86_400_000).toISOString().slice(0, 10);
      const sunday = new Date(now.getTime() + (6 - dow) * 86_400_000).toISOString().slice(0, 10);
      const q = { from: args.from ?? monday, to: args.to ?? sunday, ...(args.status && { status: args.status }) };
      if (args.className || args.subject) q.subjectOfferingId = (await theOffering(ctx, args)).id;
      const out = await plans.list(ctx.actor, q);
      const rows = out.items.map((p) => ({ date: p.date, period: p.periodNo, class: p.class, subject: p.subject, title: p.title, status: p.status, teacher: out.canReviewAll ? p.teacher : undefined, feedback: p.feedback.length || undefined }));
      return ok({ from: q.from, to: q.to, plans: rows, totals: out.totals }, {
        speak: rows.length ? `${rows.length} plan(s) ${q.from} to ${q.to}: ${out.totals.taught} taught, ${out.totals.ready} ready, ${out.totals.draft} draft${out.totals.pastNotTaught ? `; ${out.totals.pastNotTaught} past lesson(s) not yet marked taught` : ''}.` : `No lesson plans from ${q.from} to ${q.to}.`,
      });
    },
  },

  get_lesson_plan_suggestion: {
    module: 'Lesson plans', operation: 'GET', risk: RISK.LOW, resultShape: 'DETAIL',
    description: "A suggested lesson plan for one of the teacher's classes, built from the syllabus module's next untaught topics, the subject's usual NEP pedagogies and a competency-based question from the bank when there is one (5E steps with minutes, objectives, differentiation, exit check, homework). Nothing is saved: the teacher edits it and saves it with save_lesson_plan.",
    inputSchema: closed({ ...classSubject, date: dateStr('YYYY-MM-DD'), durationMinutes: { type: 'integer', minimum: 10, maximum: 240 } }, ['subject']),
    permission: 'syllabus.manage',
    service: 'lessonPlans.service.suggest()',
    async run(ctx, args) {
      const o = await theOffering(ctx, args);
      const s = await plans.suggest(ctx.actor, { subjectOfferingId: o.id, date: args.date, durationMinutes: args.durationMinutes });
      const p = s.plan;
      return ok({ label: s.label, basedOn: s.evidence, plan: { class: p.class, subject: p.subject, title: p.title, objectives: p.objectives, pedagogies: p.pedagogies, steps: p.steps, competencyCheck: p.competencyCheck, differentiation: p.differentiation, homework: p.homework }, saved: false }, {
        speak: `${s.label}. "${p.title}": ${p.steps.map((x) => `${x.phase.toLowerCase()} ${x.minutes} min`).join(', ')}. Competency check: ${excerpt(p.competencyCheck, 120)} Say "save it" to keep it as your plan.`,
      });
    },
  },

  save_lesson_plan: {
    module: 'Lesson plans', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: "Save a lesson plan for one of the teacher's classes on a date: by default the suggested plan (from the syllabus module), with any of the teacher's own title, objectives, steps, pedagogies, competency check or homework replacing the suggestion. Saved as DRAFT (or READY). Needs confirmation.",
    inputSchema: closed({
      ...classSubject, date: dateStr('YYYY-MM-DD; default today'), periodNo: { type: 'integer', minimum: 0, maximum: 15 }, durationMinutes: { type: 'integer', minimum: 10, maximum: 240 },
      title: text(200), objectives: { type: 'array', maxItems: 8, items: text(300) }, steps: stepSchema,
      pedagogies: { type: 'array', maxItems: 5, items: { type: 'string', enum: PEDAGOGIES } },
      competencyCheck: text(1500), homework: text(1000), ready: { type: 'boolean', description: 'Save as READY instead of DRAFT' },
      useSuggestion: { type: 'boolean', description: 'Start from the suggested plan (default true)' },
    }, ['subject']),
    permission: 'syllabus.manage',
    service: 'lessonPlans.service.suggest() + create()',
    async prepare(ctx, args) {
      const o = await theOffering(ctx, args);
      const base = args.useSuggestion === false ? { subjectOfferingId: o.id, durationMinutes: args.durationMinutes ?? 40 } : (await plans.suggest(ctx.actor, { subjectOfferingId: o.id, durationMinutes: args.durationMinutes })).plan;
      const body = {
        ...base, date: args.date ?? todayIst(), periodNo: args.periodNo ?? null,
        ...(args.title && { title: args.title }), ...(args.objectives && { objectives: args.objectives }), ...(args.steps && { steps: args.steps }),
        ...(args.pedagogies && { pedagogies: args.pedagogies }), ...(args.competencyCheck && { competencyCheck: args.competencyCheck }), ...(args.homework && { homework: args.homework }),
        status: args.ready ? 'READY' : 'DRAFT',
      };
      if (!body.title) throw new AppError('What is the lesson about? Give it a title.', 400, [], 'AGENT_NEEDS_INPUT');
      delete body.class; delete body.subject;
      return { body, offering: o.label };
    },
    summarise: (_a, _actor, p) => `Save a ${p.body.status.toLowerCase()} lesson plan for ${p.offering} on ${p.body.date}${p.body.periodNo != null ? ` (period ${p.body.periodNo})` : ''}: "${p.body.title}"${p.body.steps?.length ? `, ${p.body.steps.length} steps` : ''}`,
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const saved = await plans.create(ctx.actor, p.body);
      return action({ type: 'lesson_plan_saved', id: saved.id, data: { date: saved.date, class: saved.class, subject: saved.subject, title: saved.title, status: saved.status }, speak: `Saved "${saved.title}" for ${saved.class} on ${saved.date}. Open Lesson plans to adjust it.` });
    },
  },

  mark_lesson_taught: {
    module: 'Lesson plans', operation: 'ACTION', risk: RISK.LOW, confirm: true,
    description: "Mark one of the teacher's lesson plans taught: the planned topics are ticked in the syllabus tracker, the reflection is kept, and (with homeworkDueOn) the plan's homework is set as a real assignment for the class. Identify the plan by date, class/subject or title. Needs confirmation.",
    inputSchema: closed({ date: dateStr('YYYY-MM-DD; default today'), ...classSubject, title: text(200), reflection: text(2000, 'How it went, what to revisit'), homeworkDueOn: dateStr('Set the homework as an assignment due this day') }),
    permission: 'syllabus.manage',
    service: 'lessonPlans.service.markTaught()',
    async prepare(ctx, args) {
      const plan = await thePlan(ctx, { date: args.date ?? (args.title ? undefined : todayIst()), className: args.className, subject: args.subject, title: args.title });
      if (plan.status === 'TAUGHT') throw new AppError('That lesson is already marked taught.', 409, [], 'PLAN_TAUGHT');
      if (args.homeworkDueOn && !plan.homework) throw new AppError('That plan has no homework written; add it on the Lesson plans page first.', 400, [], 'NO_HOMEWORK');
      if (args.homeworkDueOn && !ctx.actor.permissions?.['assignments.manage']) throw new AppError('Setting homework is not part of your role.', 403);
      return { id: plan.id, title: plan.title, date: plan.date, class: plan.class, subject: plan.subject, topics: plan.topicIds.length, homework: plan.homework };
    },
    summarise: (a, _actor, p) => `Mark "${p.title}" (${p.class} ${p.subject}, ${p.date}) taught${p.topics ? `, ticking ${p.topics} topic(s) in the syllabus` : ''}${a.homeworkDueOn ? `, and set the homework "${excerpt(p.homework, 60)}" due ${a.homeworkDueOn}` : ''}${a.reflection ? ` — reflection: ${excerpt(a.reflection, 80)}` : ''}`,
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const out = await plans.markTaught(ctx.actor, ctx.actor.permissions?.['assignments.manage'] ?? 'OWN', p.id, { reflection: args.reflection, ...(args.homeworkDueOn && { setHomework: { dueAt: args.homeworkDueOn } }) });
      return action({ type: 'lesson_marked_taught', id: out.id, data: { title: out.title, syllabusRecorded: out.syllabusRecorded, assignmentId: out.assignmentId }, speak: `Marked "${out.title}" taught${out.syllabusRecorded ? '; the syllabus is updated' : ''}${out.assignmentId ? '; the homework is set for the class' : ''}.` });
    },
  },

  add_lesson_plan_feedback: {
    module: 'Lesson plans', operation: 'ACTION', risk: RISK.LOW, confirm: true, affectsOthers: true,
    description: "The principal or a coordinator: add a feedback note to a teacher's lesson plan (identified by date, class/subject or title). The note never changes the plan or its status. Needs confirmation.",
    inputSchema: closed({ date: dateStr('YYYY-MM-DD'), ...classSubject, title: text(200), note: { type: 'string', minLength: 1, maxLength: 1500 } }, ['note']),
    permission: 'syllabus.manage', minScope: 'ALL',
    service: 'lessonPlans.service.addFeedback()',
    async prepare(ctx, args) {
      const plan = await thePlan(ctx, args);
      return { id: plan.id, title: plan.title, teacher: plan.teacher, class: plan.class, date: plan.date };
    },
    summarise: (a, _actor, p) => `Add feedback to ${p.teacher ?? 'the teacher'}'s plan "${p.title}" (${p.class}, ${p.date}): "${excerpt(a.note, 140)}"`,
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const out = await plans.addFeedback(ctx.actor, p.id, { note: args.note });
      return action({ type: 'lesson_plan_feedback_added', id: out.id, data: { title: out.title }, speak: `Feedback added to "${out.title}".` });
    },
  },

  search_question_bank: {
    module: 'Question bank', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: "Questions in the school's question bank for a subject and class the caller teaches: chapter, type (MCQ, case-based, short answer...), marks, cognitive level and whether competency-based. Filter by chapter, type or competency-based only. Read-only.",
    inputSchema: closed({ ...classSubject, chapter: text(200), type: { type: 'string', enum: QUESTION_TYPES }, competencyOnly: { type: 'boolean' }, search: text(100) }, ['subject']),
    permission: 'syllabus.manage',
    service: 'questionBank.service.listQuestions()',
    async run(ctx, args) {
      const o = await theOffering(ctx, args);
      const out = await bank.listQuestions(ctx.actor, { subjectId: o.subjectId, gradeId: o.gradeId, chapter: args.chapter, type: args.type, competencyBased: args.competencyOnly, q: args.search });
      const rows = out.items.slice(0, 40).map((q) => ({ chapter: q.chapter, type: q.typeLabel, marks: q.marks, level: q.bloom, competencyBased: q.competencyBased, text: excerpt(q.text, 160) }));
      return ok({ questions: rows, totals: out.totals }, { speak: out.totals.questions ? `${out.totals.questions} question(s), ${out.totals.competencyBased} competency-based.` : 'No questions match in the bank yet.' });
    },
  },

  add_bank_question: {
    module: 'Question bank', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: "Add a question to the school's shared question bank for a subject and class the caller teaches: chapter, type, marks, the question, options (MCQ / assertion-reason, with the correct one), answer or marking scheme, cognitive level and difficulty. Needs confirmation.",
    inputSchema: closed({
      ...classSubject, chapter: text(200), type: { type: 'string', enum: QUESTION_TYPES }, marks: { type: 'number', minimum: 0.5, maximum: 20 },
      question: { type: 'string', minLength: 1, maxLength: 3000 }, options: { type: 'array', maxItems: 6, items: text(400) },
      correctOption: { type: 'integer', minimum: 1, maximum: 6, description: 'Which option is correct, counting from 1' },
      answer: text(3000), bloom: { type: 'string', enum: BLOOM_LEVELS }, difficulty: { type: 'string', enum: DIFFICULTIES }, competencyBased: { type: 'boolean' },
    }, ['subject', 'chapter', 'type', 'marks', 'question']),
    permission: 'syllabus.manage',
    service: 'questionBank.service.addQuestion()',
    async prepare(ctx, args) {
      const o = await theOffering(ctx, args);
      if (['MCQ', 'ASSERTION_REASON'].includes(args.type) && (!args.options?.length || !args.correctOption)) throw new AppError('Give the options and say which one is correct.', 400, [], 'AGENT_NEEDS_INPUT');
      return { offering: o.label, subjectId: o.subjectId, gradeId: o.gradeId };
    },
    summarise: (a, _actor, p) => `Add a ${a.marks}-mark ${a.type.replace('_', ' ').toLowerCase()} question on "${a.chapter}" to the ${p.offering.split('·').pop().trim()} bank: "${excerpt(a.question, 120)}"`,
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const q = await bank.addQuestion(ctx.actor, {
        subjectId: p.subjectId, gradeId: p.gradeId, chapter: args.chapter, type: args.type, marks: args.marks, text: args.question,
        options: (args.options ?? []).map((t, i) => ({ text: t, isCorrect: i + 1 === args.correctOption })), answer: args.answer,
        bloom: args.bloom, difficulty: args.difficulty, ...(args.competencyBased !== undefined && { competencyBased: args.competencyBased }),
      });
      return action({ type: 'bank_question_added', id: q.id, data: { chapter: q.chapter, type: q.typeLabel, marks: q.marks, competencyBased: q.competencyBased }, speak: `Added to the bank${q.competencyBased ? ' as competency-based' : ''}.` });
    },
  },

  build_question_paper: {
    module: 'Question bank', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: "Build a draft question paper from the bank for a subject and class the caller teaches, from a blueprint: per section a question type, how many and optionally marks each; optional chapters, total marks and competency-based target (default 50%). Prefers fresh questions, spreads chapters, reports shortfalls and checks. The draft is not final until the teacher makes it final on the page. Needs confirmation.",
    inputSchema: closed({
      ...classSubject, title: text(200), targetMarks: { type: 'integer', minimum: 1, maximum: 200 }, durationMinutes: { type: 'integer', minimum: 10, maximum: 300 },
      competencyTargetPct: { type: 'integer', minimum: 0, maximum: 100 }, chapters: { type: 'array', maxItems: 20, items: text(200) },
      blueprint: { type: 'array', minItems: 1, maxItems: 8, items: closed({ type: { type: 'string', enum: QUESTION_TYPES }, count: { type: 'integer', minimum: 1, maximum: 40 }, marks: { type: 'number', minimum: 0.5, maximum: 20 } }, ['type', 'count']) },
    }, ['subject', 'blueprint']),
    permission: 'syllabus.manage',
    service: 'questionBank.service.buildPaper()',
    async prepare(ctx, args) {
      const o = await theOffering(ctx, args);
      return { offering: o.label, subjectId: o.subjectId, gradeId: o.gradeId };
    },
    summarise: (a, _actor, p) => `Build a draft paper "${a.title ?? 'Question paper (draft)'}" for ${p.offering}: ${a.blueprint.map((b) => `${b.count} × ${b.type.replace('_', ' ').toLowerCase()}${b.marks ? ` (${b.marks} marks)` : ''}`).join(', ')}${a.targetMarks ? `, ${a.targetMarks} marks` : ''}`,
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const paper = await bank.buildPaper(ctx.actor, { subjectId: p.subjectId, gradeId: p.gradeId, title: args.title, targetMarks: args.targetMarks, durationMinutes: args.durationMinutes, competencyTargetPct: args.competencyTargetPct, chapters: args.chapters, blueprint: args.blueprint });
      const v = paperView(paper);
      return action({ type: 'question_paper_built', id: paper.id, data: { ...v, shortfalls: paper.shortfalls }, speak: `Draft "${paper.title}": ${v.totalMarks} marks, ${v.competencyPct}% competency-based.${paper.shortfalls.length ? ` ${paper.shortfalls.join(' ')}` : ''}${v.warnings.length ? ` Check: ${v.warnings.join(' ')}` : ''}` });
    },
  },

  check_question_paper: {
    module: 'Question bank', operation: 'GET', risk: RISK.LOW, resultShape: 'DETAIL',
    description: "The checks on one of the caller's question papers (by title): total marks, share of competency-based and higher-order questions, sections, and warnings (marks mismatch, competency below target, repeats, a chapter over-weighted). Read-only.",
    inputSchema: closed({ title: text(200) }),
    permission: 'syllabus.manage',
    service: 'questionBank.service.listPapers()',
    async run(ctx, args) {
      const v = paperView(await thePaper(ctx, args.title));
      return ok(v, { speak: `"${v.title}" (${v.status.toLowerCase()}): ${v.totalMarks} marks, ${v.competencyPct}% competency-based (target ${v.competencyTargetPct}%), ${v.higherOrderPct}% higher-order. ${v.warnings.length ? v.warnings.join(' ') : 'No warnings.'}` });
    },
  },

  make_quiz_from_paper: {
    module: 'Quizzes', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: "Turn the MCQs of one of the caller's question papers into a draft online quiz for one of their classes (same subject and grade). The quiz stays a draft; publishing it to students is the teacher's step on the Quizzes page. Needs confirmation.",
    inputSchema: closed({ paperTitle: text(200), ...classSubject, title: text(200), durationMinutes: { type: 'integer', minimum: 1, maximum: 180 } }, ['subject']),
    permission: 'assignments.manage',
    service: 'questionBank.service.toQuiz()',
    async prepare(ctx, args) {
      if (!ctx.actor.permissions?.['syllabus.manage']) throw new AppError('The question bank is not part of your role.', 403);
      const paper = await thePaper(ctx, args.paperTitle);
      const o = await theOffering(ctx, args);
      const mcqs = paper.sections.flatMap((s) => s.questions).filter((q) => q.type === 'MCQ').length;
      if (!mcqs) throw new AppError(`"${paper.title}" has no MCQs; a quiz takes multiple-choice questions.`, 400, [], 'NO_MCQ');
      return { paperId: paper.id, paper: paper.title, offeringId: o.id, offering: o.label, mcqs };
    },
    summarise: (a, _actor, p) => `Create a draft quiz "${a.title ?? `${p.paper} (quiz)`}" for ${p.offering} with the ${p.mcqs} MCQ(s) from "${p.paper}"`,
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const out = await bank.toQuiz(ctx.actor, ctx.scope, { paperId: p.paperId, subjectOfferingId: p.offeringId, title: args.title ?? `${p.paper} (quiz)`, durationMinutes: args.durationMinutes });
      return action({ type: 'quiz_drafted', id: out.quizId, data: { title: out.title, questions: out.questions, status: 'DRAFT' }, speak: `Draft quiz "${out.title}" with ${out.questions} question(s). Publish it from Quizzes when you are ready.` });
    },
  },

  create_quiz_draft: {
    module: 'Quizzes', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: "Create a draft online quiz for one of the teacher's classes with the multiple-choice questions they dictate (question, options, which is correct, marks). The quiz stays a draft; publishing it is the teacher's step on the Quizzes page. Needs confirmation.",
    inputSchema: closed({
      ...classSubject, title: { type: 'string', minLength: 1, maxLength: 200 }, durationMinutes: { type: 'integer', minimum: 1, maximum: 180 },
      questions: { type: 'array', minItems: 1, maxItems: 30, items: closed({ question: { type: 'string', minLength: 1, maxLength: 1000 }, options: { type: 'array', minItems: 2, maxItems: 6, items: text(300) }, correctOption: { type: 'integer', minimum: 1, maximum: 6 }, marks: { type: 'number', minimum: 0.5, maximum: 20 } }, ['question', 'options', 'correctOption']) },
    }, ['subject', 'title', 'questions']),
    permission: 'assignments.manage',
    service: 'quiz.service.create() + addQuestion()',
    async prepare(ctx, args) {
      const o = await theOffering(ctx, args);
      for (const [i, q] of args.questions.entries()) if (q.correctOption > q.options.length) throw new AppError(`Question ${i + 1}: the correct option is not one of its options.`, 400, [], 'AGENT_NEEDS_INPUT');
      return { offeringId: o.id, offering: o.label };
    },
    summarise: (a, _actor, p) => `Create a draft quiz "${a.title}" for ${p.offering} with ${a.questions.length} question(s)${a.durationMinutes ? `, ${a.durationMinutes} minutes` : ''}`,
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const quiz = await quizzes.create(ctx.actor, ctx.scope, { subjectOfferingId: p.offeringId, title: args.title, durationMinutes: args.durationMinutes });
      for (const q of args.questions) await quizzes.addQuestion(ctx.actor, ctx.scope, quiz.id, { text: q.question, marks: q.marks ?? 1, options: q.options.map((t, i) => ({ text: t, isCorrect: i + 1 === q.correctOption })) });
      return action({ type: 'quiz_drafted', id: quiz.id, data: { title: quiz.title, questions: args.questions.length, status: 'DRAFT' }, speak: `Draft quiz "${quiz.title}" saved with ${args.questions.length} question(s). Publish it from Quizzes when you are ready.` });
    },
  },

  plan_syllabus_module: {
    module: 'Syllabus', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: "Add a module (chapter or unit) to the syllabus plan of one of the teacher's classes: title, planned start and end dates, planned periods and its topics. Needs confirmation.",
    inputSchema: closed({ ...classSubject, title: { type: 'string', minLength: 1, maxLength: 200 }, plannedStart: dateStr('YYYY-MM-DD'), plannedEnd: dateStr('YYYY-MM-DD'), plannedPeriods: { type: 'integer', minimum: 1, maximum: 200 }, topics: { type: 'array', maxItems: 40, items: text(200) } }, ['subject', 'title', 'plannedStart', 'plannedEnd']),
    permission: 'syllabus.manage',
    service: 'syllabus.service.createModule()',
    async prepare(ctx, args) {
      if (args.plannedEnd < args.plannedStart) throw new AppError('The module cannot end before it starts.', 400, [], 'AGENT_NEEDS_INPUT');
      const o = await theOffering(ctx, args);
      return { offeringId: o.id, offering: o.label };
    },
    summarise: (a, _actor, p) => `Add the module "${a.title}" to ${p.offering}'s syllabus, ${a.plannedStart} to ${a.plannedEnd}${a.topics?.length ? `, ${a.topics.length} topic(s)` : ''}`,
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const m = await syllabus.createModule(ctx.actor, { subjectOfferingId: p.offeringId, title: args.title, plannedStart: args.plannedStart, plannedEnd: args.plannedEnd, plannedPeriods: args.plannedPeriods, topics: args.topics ?? [] });
      return action({ type: 'syllabus_module_added', id: m.id, data: { title: m.title, topics: m.topics?.length ?? 0 }, speak: `Added "${m.title}" to ${p.offering}.` });
    },
  },

  get_my_cpd_hours: {
    module: 'CPD', operation: 'GET', risk: RISK.LOW, resultShape: 'DETAIL',
    description: "The caller's continuing professional development hours this academic year against the CBSE reference of 50 (25 external, 25 in-house, by NPST area): logged entries plus in-house trainings attended, what is unverified, and what is still short. Read-only.",
    inputSchema: closed({}),
    permission: 'staffleave.apply',
    service: 'cpd.service.mine()',
    async run(ctx) {
      const m = await cpd.mine(ctx.actor);
      const s = m.summary;
      return ok({ year: m.year, total: s.total, target: s.target, external: s.byMode.EXTERNAL, inHouse: s.byMode.IN_HOUSE, byArea: s.byArea, unverifiedHours: s.unverifiedHours, stillShort: s.gaps, recent: m.entries.slice(0, 8).map((e) => ({ date: e.date, title: e.title, hours: e.hours, mode: e.mode, verified: e.verified })) }, {
        speak: `${s.total} of ${s.target} CPD hours for ${m.year} (${s.byMode.EXTERNAL} external, ${s.byMode.IN_HOUSE} in-house).${s.gaps.length ? ` Still short: ${s.gaps.slice(0, 3).join(' ')}` : ' All reference targets met.'}`,
      });
    },
  },

  log_cpd_hours: {
    module: 'CPD', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: "Log hours of professional development the caller completed: title, provider, external (CBSE / government institute) or in-house, NPST area, hours, date, online or not, and a certificate link. HR or the principal verifies it later. Needs confirmation.",
    inputSchema: closed({ title: { type: 'string', minLength: 1, maxLength: 200 }, provider: text(200), mode: { type: 'string', enum: CPD_MODES }, area: { type: 'string', enum: NPST_AREAS }, hours: { type: 'number', minimum: 0.5, maximum: 100 }, date: dateStr('YYYY-MM-DD; default today'), online: { type: 'boolean' }, certificateUrl: text(500, 'https:// link to the certificate') }, ['title', 'mode', 'area', 'hours']),
    permission: 'staffleave.apply',
    service: 'cpd.service.add()',
    summarise: (a) => `Log ${a.hours} ${a.mode === 'EXTERNAL' ? 'external' : 'in-house'} CPD hour(s) for "${excerpt(a.title, 80)}"${a.provider ? ` (${a.provider})` : ''} on ${a.date ?? 'today'}, under ${cpd.AREA_LABELS[a.area].toLowerCase()}`,
    async run(ctx, args) {
      const e = await cpd.add(ctx.actor, { title: args.title, provider: args.provider, mode: args.mode, area: args.area, hours: args.hours, date: args.date ?? todayIst(), online: args.online, evidenceUrl: args.certificateUrl });
      return action({ type: 'cpd_hours_logged', id: e.id, data: { title: e.title, hours: e.hours, verified: false }, speak: `Logged ${e.hours} hour(s). HR verifies it against the certificate.` });
    },
  },

  list_staff_cpd_hours: {
    module: 'CPD', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: "HR and the principal: every teacher's CPD hours this year (total, external, in-house), who has met the 50-hour reference, who is under 25, and entries waiting to be verified. Read-only.",
    inputSchema: closed({}),
    permission: 'staffleave.manage', minScope: 'ALL',
    service: 'cpd.service.overview()',
    async run(ctx) {
      const o = await cpd.overview(ctx.actor);
      return ok({ year: o.year, totals: o.totals, staff: o.rows.map((r) => ({ name: r.name, total: r.total, external: r.external, inHouse: r.inHouse, met: r.met })), pendingVerification: o.pendingVerification.length }, {
        speak: `${o.totals.met} of ${o.totals.staff} staff have met the CPD reference for ${o.year}; ${o.totals.under25} are under 25 hours; ${o.pendingVerification.length} entr${o.pendingVerification.length === 1 ? 'y waits' : 'ies wait'} for verification.`,
      });
    },
  },

  save_report_card_component_marks: {
    module: 'Report cards', operation: 'UPDATE', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: "A subject teacher: enter a hand-entered component (e.g. notebook, subject enrichment) on one pupil's term report card for a subject they teach. An approved card goes back to draft for re-approval. Needs confirmation.",
    inputSchema: closed({ ...studentIdentitySchema, term: text(40), subject: text(80), component: text(60, 'e.g. "Notebook" or "Subject enrichment"'), marks: { type: 'number', minimum: 0, maximum: 100 } }, ['subject', 'component', 'marks']),
    permission: 'reportcards.manage',
    service: 'reportcards.service.list() + update()',
    async prepare(ctx, args) {
      await cardsOn();
      const card = await findCard(ctx, args);
      const subj = theNamed(card.scholastic ?? [], args.subject, { label: 'subject on this card', nameOf: (x) => x.subject, describe: (x) => x.subject });
      const comp = theNamed((card.components ?? []).filter((c) => c.source === 'MANUAL'), args.component, { label: 'hand-entered component', nameOf: (c) => c.label, describe: (c) => `${c.label} (out of ${c.maxMarks})` });
      if (args.marks > comp.maxMarks) throw new AppError(`${comp.label} is out of ${comp.maxMarks}.`, 400, [], 'AGENT_NEEDS_INPUT');
      // Refused before the draft, not after the confirmation: only the subject's teacher (or school-wide) enters its marks.
      if (ctx.scope !== 'ALL') {
        const o = await SubjectOffering.findById(subj.subjectOfferingId).select('teacherId').lean();
        if (String(o?.teacherId ?? '') !== String(ctx.actor.profileId)) throw new AppError(`You do not teach ${subj.subject} in this class.`, 403, [], 'NOT_YOUR_SUBJECT');
      }
      return { cardId: card.id, student: card.studentName, term: card.termName, status: card.status, offeringId: subj.subjectOfferingId, subject: subj.subject, key: comp.key, label: comp.label, max: comp.maxMarks };
    },
    summarise: (a, _actor, p) => `Enter ${p.label} ${a.marks}/${p.max} in ${p.subject} on ${p.student}'s ${p.term} card${p.status !== 'DRAFT' ? ' (it goes back to draft for re-approval)' : ''}`,
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const c = await reportcards.update(ctx.actor, ctx.scope, p.cardId, { manualMarks: { [p.offeringId]: { [p.key]: args.marks } } });
      return action({ type: 'report_card_marks_saved', id: c.id, data: { student: c.studentName, term: c.termName, status: c.status }, speak: `Saved ${p.label} for ${c.studentName}.` });
    },
  },

  save_co_scholastic_grades: {
    module: 'Report cards', operation: 'UPDATE', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: "The class teacher: set co-scholastic grades (e.g. work education, art education, health and PE) and the discipline grade on one pupil's term report card, using the card's grade scale (e.g. A, B, C). An approved card goes back to draft. Needs confirmation.",
    inputSchema: closed({ ...studentIdentitySchema, term: text(40), grades: { type: 'array', maxItems: 10, items: closed({ area: text(80, 'e.g. "Art education"'), grade: text(4, 'e.g. "A"') }, ['area', 'grade']), description: 'Each co-scholastic area and its grade' }, discipline: text(4) }),
    permission: 'reportcards.manage',
    service: 'reportcards.service.list() + update()',
    async prepare(ctx, args) {
      await cardsOn();
      if (!args.grades?.length && !args.discipline) throw new AppError('Which grades? Name the area and the grade.', 400, [], 'AGENT_NEEDS_INPUT');
      const card = await findCard(ctx, args);
      const full = await reportcards.get(ctx.actor, ctx.scope, card.id);
      const areas = full.coScholasticAreas ?? full.template?.coScholasticAreas ?? [];
      const coScholastic = {};
      const words = [];
      for (const { area: name, grade } of args.grades ?? []) {
        const area = theNamed(areas, name, { label: 'co-scholastic area', nameOf: (a) => a.label, describe: (a) => a.label });
        coScholastic[area.key] = String(grade).toUpperCase();
        words.push(`${area.label} ${String(grade).toUpperCase()}`);
      }
      if (args.discipline) words.push(`discipline ${args.discipline.toUpperCase()}`);
      return { cardId: card.id, student: card.studentName, term: card.termName, status: card.status, coScholastic, words };
    },
    summarise: (_a, _actor, p) => `Set ${p.words.join(', ')} on ${p.student}'s ${p.term} card${p.status !== 'DRAFT' ? ' (it goes back to draft for re-approval)' : ''}`,
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const c = await reportcards.update(ctx.actor, ctx.scope, p.cardId, { ...(Object.keys(p.coScholastic).length && { coScholastic: p.coScholastic }), ...(args.discipline && { discipline: args.discipline }) });
      return action({ type: 'report_card_grades_saved', id: c.id, data: { student: c.studentName, term: c.termName, status: c.status }, speak: `Saved on ${c.studentName}'s ${c.termName} card.` });
    },
  },
};
