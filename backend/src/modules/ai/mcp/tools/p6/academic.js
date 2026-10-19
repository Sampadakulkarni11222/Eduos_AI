// Part-6 coverage tools: academic. See ./_kit.js and ../p6Coverage.js.
import * as studentsSvc from '../../../../students/student.service.js';
import * as shifts from '../../../../shifts/shifts.service.js';
import * as drafts from '../../../../attendance/draft.service.js';
import * as quizzes from '../../../../quizzes/quiz.service.js';
import * as announcements from '../../../../announcements/announcement.service.js';
import * as lectures from '../../../../lectures/lecture.service.js';
import * as plans from '../../../../teaching/lessonPlans.service.js';
import * as bank from '../../../../teaching/questionBank.service.js';
import * as cpd from '../../../../teaching/cpd.service.js';
import { paperResults } from '../../../../teaching/paperResults.service.js';
import * as exams from '../../../../exams/exam.service.js';
import * as syllabus from '../../../../syllabus/syllabus.service.js';
import * as reportcards from '../../../../reportcards/reportcards.service.js';
import * as support from '../../../../support/support.service.js';
import * as portfolios from '../../../../portfolios/portfolios.service.js';
import { profilesWithRoles } from '../../../../ops/common.js';
import { AcademicYear, SubjectOffering } from '../../../../../models/academics.model.js';
import { BELL_KINDS } from '../../../../../models/schoolShift.model.js';
import { PEDAGOGIES, QUESTION_TYPES, BLOOM_LEVELS, DIFFICULTIES } from '../../../../../models/teaching.model.js';
import { CONCERN_AREAS, GOAL_STATUSES, PLAN_OUTCOMES, ACTION_OWNER_KINDS } from '../../../../../models/supportPlan.model.js';
import { RUBRIC_LEVELS } from '../../../../../models/competencyPortfolio.model.js';
import { classKey } from '../../../../../utils/classNames.js';
import { resolveSection, resolveStudentId, studentIdentitySchema, classIdentitySchema } from '../_shared.js';
import {
  RISK, tool, closed, text, int, num, bool, oneOf, list, hm, dateStr, decisionArg,
  ask, notFound, forbidden, pick, listed, shown, did, needAny, rowsOf, lower, words, excerpt, todayIst, stripTitle,
} from './_kit.js';

/**
 * The academic routes that had no assistant tool (coverage map, part 6):
 *
 *   enrolment      the next free roll number of a class
 *   shifts         list, create, change and retire school shifts and their bells
 *   attendance     a teacher's saved, unsubmitted flashcard register (read, save, discard)
 *   quizzes        read a quiz with its key, edit or delete a question, open or withdraw it,
 *                  the class's results; a student reads, starts and submits a quiz and reads
 *                  their answers back
 *   announcements  a preview of who an announcement would reach (nothing is sent)
 *   online classes the scheduling options, counts, one class, joining, who joined
 *   lesson plans   read, change, remove and copy a plan
 *   question bank  the subjects and chapters a teacher may use; edit or remove a question;
 *                  create, read, change, finalise and remove a paper; a paper's results
 *   CPD            remove one's own entry; HR or the principal verifies a colleague's
 *   report cards   templates, the classes a teacher prepares cards for, a published
 *                  version, generating a class's cards, one card and its versions, and the
 *                  class teacher's / principal's moderation (publishing stays on screen)
 *   support plans  the whole lifecycle (the safeguarding referral flag stays on screen)
 *   portfolios     framework, students, a portfolio, teacher evidence and rubric ratings
 *   syllabus       one class-and-subject's module plan
 *
 * Every tool is the route's own service call with the route's own guard; the
 * service keeps its own rules (own classes, own child, own paper, class teacher
 * stage, self-verification refused). Names are resolved from the caller's own
 * lists and asked about when several match.
 */

/* ── helpers ──────────────────────────────────────────────── */

const FAMILY = ['PARENT', 'STUDENT', 'ALUMNUS'];
const STAFF_ROLES = ['ADMIN', 'PRINCIPAL', 'TEACHER', 'FINANCE', 'LIBRARIAN', 'WARDEN', 'NURSE', 'HR', 'MARKETING', 'COMPLIANCE'];
const SUBJECT_ALIASES = { maths: 'mathematics', math: 'mathematics', sst: 'social science', sci: 'science', eng: 'english', comp: 'computer', cs: 'computer science', pe: 'physical education' };
const subjectWord = (s) => SUBJECT_ALIASES[lower(s)] ?? lower(s);

/** A class the caller may act on, by name; asked for when missing. */
async function sectionOf(ctx, className, label = 'class') {
  if (!className) throw ask(`Which ${label}? Name it, e.g. "Class 6 A".`);
  const s = await resolveSection(ctx, { className });
  if (!s) throw ask(`Which ${label}? Name it, e.g. "Class 6 A".`);
  return s;
}

/** A member of staff by name (owners of plans and actions). */
async function staffNamed(name, label = 'member of staff') {
  const rows = (await profilesWithRoles(STAFF_ROLES)).map((p) => ({ id: String(p._id), name: p.displayName }));
  return pick(rows, stripTitle(name), { label, nameOf: (r) => r.name, refOf: () => '', describe: (r) => r.name });
}

/** One class-and-subject of the caller's (teaching), from words: "6 A maths". */
async function offeringOf(ctx, { className, subject } = {}) {
  let rows = await syllabus.myOfferings(ctx.actor);
  if (className) {
    const section = await resolveSection(ctx, { className });
    if (section) rows = rows.filter((o) => classKey(o.label.split('·')[0]) === classKey(section.label));
  }
  if (subject) {
    const want = subjectWord(subject);
    const sub = (o) => lower(o.label.split('·').pop());
    const exact = rows.filter((o) => sub(o) === want);
    rows = exact.length ? exact : rows.filter((o) => sub(o).includes(want) || want.includes(sub(o)));
  }
  if (!rows.length) throw notFound(`You do not teach ${subject ?? 'that subject'}${className ? ` in ${className}` : ''}.`);
  if (rows.length > 1) throw ask(`Which class and subject: ${rows.slice(0, 8).map((o) => o.label).join(', ')}?`);
  const doc = await SubjectOffering.findById(rows[0].id).populate('sectionId', 'gradeId').lean();
  return { id: rows[0].id, label: rows[0].label, subjectId: String(doc.subjectId), gradeId: String(doc.sectionId?.gradeId) };
}

const classSubject = { ...classIdentitySchema, subject: text(80, 'The subject, e.g. "Maths"') };

/* ── Enrolment and shifts ─────────────────────────────────── */

const BELL = closed({
  kind: oneOf(BELL_KINDS), label: text(60), periodNo: int(1, 20, 'For a PERIOD bell: its number'), start: hm('HH:MM'), end: hm('HH:MM'),
}, ['kind', 'start', 'end']);
const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const dayNumbers = (days) => (days ?? []).map((d) => DAY_NAMES.indexOf(lower(d)) + 1).filter((n) => n > 0);

const notFamily = (ctx) => { if (FAMILY.includes(ctx.actor?.roleKey)) throw forbidden('Shifts are kept for staff.'); };

async function shiftOf(term) {
  const out = await shifts.list();
  return pick(out.shifts, term, { label: 'shift', nameOf: (s) => s.name, refOf: (s) => s.code, describe: (s) => `${s.code} ${s.name}` });
}

async function sectionIdsOf(ctx, classNames) {
  const out = [];
  for (const c of classNames ?? []) out.push(await sectionOf(ctx, c)); // eslint-disable-line no-await-in-loop
  return out;
}

const shiftSchema = {
  code: text(20, 'A short code, e.g. "MORN"'), name: text(80, 'e.g. "Morning shift"'),
  days: list(oneOf(DAY_NAMES), 7, 'The days it runs (default Monday to Saturday)'),
  bells: list(BELL, 40, 'The full bell schedule: arrival, assembly, numbered periods, breaks, lunch, dispersal, clubs'),
  classes: list(text(60), 60, 'The classes in this shift, e.g. ["Class 6 A", "Class 6 B"] (replaces the list)'),
  moveClasses: bool('Move a class here from another shift (otherwise a class already in a shift is refused)'),
  note: text(400),
};
function shiftBody(args, prepared) {
  return {
    ...(args.code !== undefined && { code: args.code }), ...(args.name !== undefined && { name: args.name }),
    ...(args.days && { daysOfWeek: dayNumbers(args.days) }), ...(args.bells && { bells: args.bells }),
    ...(prepared?.sectionIds && { sectionIds: prepared.sectionIds }), ...(args.note !== undefined && { note: args.note }),
    ...(args.moveClasses && { moveSections: true }),
  };
}
const shiftSpeak = (s) => `${s.name} (${s.code}): ${s.startsAt ?? '?'}-${s.endsAt ?? '?'}, ${s.periods} period(s), ${s.sections.length} class(es)${s.retimedPeriods ? `; ${s.retimedPeriods} timetable period(s) retimed` : ''}${s.moved?.length ? `; moved ${s.moved.join(', ')}` : ''}.`;

const enrolmentShiftTools = {
  get_next_roll_number: tool({
    module: 'Students', operation: 'GET',
    description: 'For the office enrolling a pupil: the next free roll number in a class this academic year. Read-only.',
    inputSchema: closed({ ...classIdentitySchema }, ['className']),
    permission: 'students.read', minScope: 'ALL',
    service: 'student.service.nextRollNo()',
    async run(ctx, args) {
      const section = await sectionOf(ctx, args.className);
      const year = await AcademicYear.findOne({ isCurrent: true }).select('_id name').lean();
      const next = year ? await studentsSvc.nextRollNo(section.sectionId, year._id) : 1;
      return shown({ class: section.label, academicYear: year?.name ?? null, nextRollNo: next }, `The next roll number in ${section.label}${year ? ` for ${year.name}` : ''} is ${next}.`);
    },
  }),

  list_school_shifts: tool({
    module: 'Academics', operation: 'GET',
    description: 'For staff: the school\'s shifts (morning, afternoon...) with their days, bell schedules and classes, the classes in no shift, and any room clash between shifts. Read-only.',
    inputSchema: closed({}),
    permission: 'timetable.read',
    service: 'shifts.service.list()',
    guard: notFamily,
    async run() {
      const out = await shifts.list();
      return listed(out.shifts, (s) => `${s.name} (${s.code}) ${s.startsAt ?? ''}-${s.endsAt ?? ''}, ${s.sections.length} class(es)`, {
        noun: 'shift',
        extra: { unassigned: out.unassigned, conflicts: out.conflicts, note: out.note },
        speak: out.shifts.length ? `${out.shifts.length} shift(s): ${out.shifts.map((s) => `${s.name} ${s.startsAt ?? ''}-${s.endsAt ?? ''} (${s.sections.length} classes)`).join('; ')}.${out.unassigned.length ? ` ${out.unassigned.length} class(es) in no shift.` : ''}${out.conflicts.length ? ` ${out.conflicts.length} room clash(es) between shifts.` : ''}` : 'No shifts are set up yet.',
      });
    },
  }),

  create_school_shift: tool({
    module: 'Academics', operation: 'CREATE', risk: RISK.HIGH, affectsOthers: true,
    description: 'For administration or the principal: set up a school shift with its code, name, days, full bell schedule and classes. Saving retimes those classes\' timetable periods to the shift\'s bells; a class already in another shift or a room clash with another shift is refused. Confirmed on the website.',
    inputSchema: closed(shiftSchema, ['code', 'name', 'bells']),
    permission: 'timetable.manage', minScope: 'ALL',
    service: 'shifts.service.create()',
    async prepare(ctx, args) {
      const secs = await sectionIdsOf(ctx, args.classes);
      return { sectionIds: secs.map((s) => s.sectionId), classes: secs.map((s) => s.label) };
    },
    summarise: (a, _actor, p) => `Create the shift ${a.name} (${a.code}) with ${a.bells.length} bell(s)${a.days?.length ? ` on ${a.days.join(', ')}` : ''}${p?.classes?.length ? ` for ${p.classes.join(', ')} (their timetable periods are retimed)` : ''}`,
    async run(ctx, args, p) {
      const s = await shifts.create(ctx.actor, shiftBody(args, p));
      return did('school_shift_created', s, `Created ${shiftSpeak(s)}`);
    },
  }),

  update_school_shift: tool({
    module: 'Academics', operation: 'UPDATE', risk: RISK.HIGH, affectsOthers: true,
    description: 'For administration or the principal: change a school shift (by name or code): its name, days, bell schedule or the classes in it. Its classes\' timetable periods follow the new bells. Confirmed on the website.',
    inputSchema: closed({ shift: text(80, 'The shift by name or code'), ...shiftSchema }, ['shift']),
    permission: 'timetable.manage', minScope: 'ALL',
    service: 'shifts.service.list() + update()',
    async prepare(ctx, args) {
      const s = await shiftOf(args.shift);
      const secs = args.classes ? await sectionIdsOf(ctx, args.classes) : null;
      if (!args.code && !args.name && !args.days && !args.bells && !secs && args.note === undefined) throw ask('What should change: the name, days, bells or classes?');
      return { shiftId: s.id, shift: `${s.name} (${s.code})`, ...(secs && { sectionIds: secs.map((x) => x.sectionId), classes: secs.map((x) => x.label) }) };
    },
    summarise: (a, _actor, p) => `Change ${p?.shift ?? a.shift}: ${[a.name && `name to ${a.name}`, a.code && `code to ${a.code}`, a.days && `days to ${a.days.join(', ')}`, a.bells && `${a.bells.length} new bell(s)`, p?.classes && `classes to ${p.classes.join(', ') || 'none'}`, a.note !== undefined && 'the note'].filter(Boolean).join(', ')}`,
    async run(ctx, args, p) {
      const s = await shifts.update(ctx.actor, p.shiftId, shiftBody(args, p));
      return did('school_shift_updated', s, `Saved ${shiftSpeak(s)}`);
    },
  }),

  retire_school_shift: tool({
    module: 'Academics', operation: 'DELETE', risk: RISK.HIGH, affectsOthers: true,
    description: 'For administration or the principal: retire a school shift (by name or code). Its classes go back to the timetable\'s own times. Confirmed on the website.',
    inputSchema: closed({ shift: text(80) }, ['shift']),
    permission: 'timetable.manage', minScope: 'ALL',
    service: 'shifts.service.list() + remove()',
    async prepare(_ctx, args) {
      const s = await shiftOf(args.shift);
      return { shiftId: s.id, shift: `${s.name} (${s.code})`, classes: s.sections.length };
    },
    summarise: (a, _actor, p) => `Retire the shift ${p?.shift ?? a.shift}${p?.classes ? `; its ${p.classes} class(es) go back to the timetable's own times` : ''}`,
    async run(ctx, _args, p) {
      const out = await shifts.remove(ctx.actor, p.shiftId);
      return did('school_shift_retired', out, `Retired ${p.shift}.`);
    },
  }),
};

/* ── Attendance drafts ────────────────────────────────────── */

const draftKey = { ...classIdentitySchema, date: dateStr('YYYY-MM-DD; default today'), period: int(0, 15, 'The period, for a period register; omit for the whole-day register') };

async function registerOf(ctx, args) {
  const section = await sectionOf(ctx, args.className);
  return { sectionId: section.sectionId, label: section.label, date: args.date ?? todayIst(), periodNo: args.period ?? null };
}
const registerLabel = (r) => `${r.label} on ${r.date}${r.periodNo !== null && r.periodNo !== undefined ? `, period ${r.periodNo}` : ' (whole day)'}`;

async function rosterOf(sectionId) {
  return studentsSvc.listEnrollments({ sectionId, status: 'ACTIVE' });
}

const attendanceDraftTools = {
  get_attendance_draft: tool({
    module: 'Attendance', operation: 'GET',
    description: "A teacher's saved, not yet submitted attendance register for a class, date and period: who is marked present, absent, late or excused so far and who is still to mark. Read-only.",
    inputSchema: closed(draftKey, ['className']),
    permission: 'attendance.mark',
    service: 'draft.service.getDraft()',
    async run(ctx, args) {
      const r = await registerOf(ctx, args);
      const d = await drafts.getDraft(ctx.actor, ctx.scope, { sectionId: r.sectionId, date: r.date, periodNo: r.periodNo });
      if (!d) return shown({ register: registerLabel(r), draft: null }, `There is no saved draft for ${registerLabel(r)}.`);
      const roster = await rosterOf(r.sectionId);
      const name = new Map(roster.map((e) => [e.id, e.studentName]));
      const marks = d.entries.filter((e) => e.status).map((e) => ({ student: name.get(e.enrollmentId) ?? 'Student', status: e.status }));
      const left = roster.filter((e) => !d.entries.some((x) => x.enrollmentId === e.id && x.status)).map((e) => e.studentName);
      return shown({ register: registerLabel(r), version: d.version, marks, stillToMark: left, rosterChanges: d.rosterChanges }, `Draft for ${registerLabel(r)}: ${marks.length} marked, ${left.length} still to mark.${marks.filter((m) => m.status !== 'PRESENT').length ? ` Not present: ${marks.filter((m) => m.status !== 'PRESENT').map((m) => `${m.student} ${words(m.status)}`).join(', ')}.` : ''}`);
    },
  }),

  save_attendance_draft: tool({
    module: 'Attendance', operation: 'UPDATE', risk: RISK.LOW,
    description: "Save marks into the teacher's draft register for a class, date and period without submitting it (students by name or roll number, each present, absent, late or excused). Marks are added to what is already saved. Submitting the register is a separate step. Needs confirmation.",
    inputSchema: closed({
      ...draftKey,
      marks: list(closed({ student: text(80, 'Name or roll number'), status: oneOf(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']) }, ['student', 'status']), 80),
      everyoneElse: oneOf(['PRESENT', 'ABSENT'], 'Mark everybody not named this way'),
    }, ['className']),
    permission: 'attendance.mark',
    service: 'draft.service.getDraft() + saveDraft()',
    async prepare(ctx, args) {
      if (!args.marks?.length && !args.everyoneElse) throw ask('Who should be marked, and how?');
      const r = await registerOf(ctx, args);
      const existing = await drafts.getDraft(ctx.actor, ctx.scope, { sectionId: r.sectionId, date: r.date, periodNo: r.periodNo });
      const roster = await rosterOf(r.sectionId);
      const entries = new Map((existing?.entries ?? []).map((e) => [e.enrollmentId, { enrollmentId: e.enrollmentId, status: e.status, passed: e.passed }]));
      const said = [];
      const named = new Set();
      for (const m of args.marks ?? []) {
        const e = /^\d+$/.test(String(m.student).trim())
          ? pick(roster.filter((x) => String(x.rollNo) === String(m.student).trim()), '', { label: `student with roll number ${m.student}`, nameOf: (x) => x.studentName })
          : pick(roster, m.student, { label: 'student in this class', nameOf: (x) => x.studentName, refOf: (x) => String(x.rollNo ?? ''), describe: (x) => `${x.rollNo ?? '-'} ${x.studentName}` });
        entries.set(e.id, { enrollmentId: e.id, status: m.status, passed: false });
        named.add(e.id);
        said.push(`${e.studentName} ${words(m.status)}`);
      }
      if (args.everyoneElse) {
        for (const e of roster) if (!named.has(e.id)) entries.set(e.id, { enrollmentId: e.id, status: args.everyoneElse, passed: false });
      }
      return { ...r, version: existing?.version ?? 0, entries: [...entries.values()], said, total: roster.length };
    },
    summarise: (a, _actor, p) => `Save to the draft register for ${p ? registerLabel(p) : a.className}: ${p?.said?.join(', ') || 'no named marks'}${a.everyoneElse ? `; everyone else ${words(a.everyoneElse)}` : ''} (not submitted)`,
    async run(ctx, _args, p) {
      const d = await drafts.saveDraft(ctx.actor, ctx.scope, { sectionId: p.sectionId, date: p.date, periodNo: p.periodNo, entries: p.entries, version: p.version });
      const marked = d.entries.filter((e) => e.status).length;
      return did('attendance_draft_saved', d, `Draft saved for ${registerLabel(p)}: ${marked} of ${p.total} marked. Submit the register when it is complete.`);
    },
  }),

  discard_attendance_draft: tool({
    module: 'Attendance', operation: 'DELETE', risk: RISK.LOW,
    description: "Throw away the teacher's saved draft register for a class, date and period (to start over). Nothing submitted is touched. Needs confirmation.",
    inputSchema: closed(draftKey, ['className']),
    permission: 'attendance.mark',
    service: 'draft.service.discardDraft()',
    async prepare(ctx, args) { return registerOf(ctx, args); },
    summarise: (a, _actor, p) => `Discard the draft register for ${p ? registerLabel(p) : a.className}`,
    async run(ctx, _args, p) {
      const out = await drafts.discardDraft(ctx.actor, ctx.scope, { sectionId: p.sectionId, date: p.date, periodNo: p.periodNo });
      return did('attendance_draft_discarded', null, out.deleted ? `Discarded the draft for ${registerLabel(p)}.` : `There was no draft for ${registerLabel(p)}.`);
    },
  }),
};

/* ── Quizzes ──────────────────────────────────────────────── */

async function quizOf(ctx, title, scope = ctx.scope) {
  const rows = await quizzes.list(ctx.actor, scope);
  return pick(rows, title, { label: 'quiz', nameOf: (q) => q.title, refOf: () => '', describe: (q) => `"${q.title}" (${q.class}, ${words(q.status)})` });
}

function questionAt(quiz, n) {
  const q = quiz.questions[Number(n) - 1];
  if (!q) throw ask(`"${quiz.title}" has ${quiz.questions.length} question(s). Which number?`);
  return q;
}

const QUESTION_FIELDS = { question: { type: 'string', minLength: 1, maxLength: 1000 }, options: { type: 'array', minItems: 2, maxItems: 6, items: text(300) }, correctOption: int(1, 6, 'Which option is correct, counting from 1'), marks: num(0.5, 20) };

const quizTools = {
  get_quiz: tool({
    module: 'Quizzes', operation: 'GET',
    description: "For the teacher who set it (or school-wide staff): one quiz with every question, its options and the correct answer, marks, time limit, status and how many have attempted it. Read-only.",
    inputSchema: closed({ quiz: text(200, 'The quiz title') }, ['quiz']),
    permission: 'assignments.manage',
    service: 'quiz.service.list() + getForManage()',
    async run(ctx, args) {
      const q = await quizzes.getForManage(ctx.actor, ctx.scope, (await quizOf(ctx, args.quiz)).id);
      return shown(q, `"${q.title}" (${q.class}, ${words(q.status)}): ${q.questionCount} question(s), ${q.totalMarks} marks${q.durationMinutes ? `, ${q.durationMinutes} min` : ''}; ${q.attemptCount} submitted.${q.questions.length ? ` ${q.questions.map((x, i) => `${i + 1}. ${excerpt(x.text, 60)} (answer: ${x.options.find((o) => o.isCorrect)?.text ?? 'none marked'})`).join(' ')}` : ''}`);
    },
  }),

  update_quiz_question: tool({
    module: 'Quizzes', operation: 'UPDATE', risk: RISK.LOW,
    description: "Rewrite one question (by its number) of a teacher's quiz nobody has attempted yet: the question, its options, which is correct and its marks. Needs confirmation.",
    inputSchema: closed({ quiz: text(200), questionNumber: int(1, 100), ...QUESTION_FIELDS }, ['quiz', 'questionNumber', 'question', 'options', 'correctOption']),
    permission: 'assignments.manage',
    service: 'quiz.service.getForManage() + updateQuestion()',
    async prepare(ctx, args) {
      if (args.correctOption > args.options.length) throw ask('The correct option is not one of its options.');
      const quiz = await quizzes.getForManage(ctx.actor, ctx.scope, (await quizOf(ctx, args.quiz)).id);
      const q = questionAt(quiz, args.questionNumber);
      return { quizId: quiz.id, title: quiz.title, questionId: q.id, before: excerpt(q.text, 60) };
    },
    summarise: (a, _actor, p) => `Rewrite question ${a.questionNumber} of "${p?.title ?? a.quiz}" as "${excerpt(a.question, 80)}" with ${a.options.length} options (correct: ${a.options[a.correctOption - 1]})`,
    async run(ctx, args, p) {
      const q = await quizzes.updateQuestion(ctx.actor, ctx.scope, p.quizId, p.questionId, { text: args.question, marks: args.marks ?? 1, options: args.options.map((t, i) => ({ text: t, isCorrect: i + 1 === args.correctOption })) });
      return did('quiz_question_updated', q, `Question ${args.questionNumber} of "${q.title}" is updated.`);
    },
  }),

  delete_quiz_question: tool({
    module: 'Quizzes', operation: 'DELETE', risk: RISK.LOW,
    description: "Remove one question (by its number) from a teacher's draft quiz nobody has attempted; the rest are renumbered. Needs confirmation.",
    inputSchema: closed({ quiz: text(200), questionNumber: int(1, 100) }, ['quiz', 'questionNumber']),
    permission: 'assignments.manage',
    service: 'quiz.service.getForManage() + deleteQuestion()',
    async prepare(ctx, args) {
      const quiz = await quizzes.getForManage(ctx.actor, ctx.scope, (await quizOf(ctx, args.quiz)).id);
      const q = questionAt(quiz, args.questionNumber);
      return { quizId: quiz.id, title: quiz.title, questionId: q.id, text: excerpt(q.text, 80) };
    },
    summarise: (a, _actor, p) => `Remove question ${a.questionNumber} ("${p?.text ?? ''}") from "${p?.title ?? a.quiz}"`,
    async run(ctx, args, p) {
      const q = await quizzes.deleteQuestion(ctx.actor, ctx.scope, p.quizId, p.questionId);
      return did('quiz_question_deleted', q, `Removed question ${args.questionNumber}; "${q.title}" now has ${q.questionCount} question(s).`);
    },
  }),

  release_quiz: tool({
    module: 'Quizzes', operation: 'ACTION', risk: RISK.MEDIUM, affectsOthers: true,
    description: "For the teacher who set it: open a quiz to the class's students (step RELEASE; every question must be complete) or withdraw it from them (step WITHDRAW; attempts already made and their results are kept). Confirmed on the website.",
    inputSchema: closed({ quiz: text(200), step: oneOf(['RELEASE', 'WITHDRAW'], 'RELEASE opens it to students, WITHDRAW hides it again') }, ['quiz', 'step']),
    permission: 'assignments.manage',
    service: 'quiz.service.publish() / unpublish()',
    async prepare(ctx, args) {
      const q = await quizOf(ctx, args.quiz);
      if (args.step === 'RELEASE' && q.status === 'PUBLISHED') throw ask(`"${q.title}" is already open to students.`);
      if (args.step === 'WITHDRAW' && q.status !== 'PUBLISHED') throw ask(`"${q.title}" is not open to students.`);
      return { quizId: q.id, title: q.title, class: q.class, questions: q.questionCount };
    },
    summarise: (a, _actor, p) => (a.step === 'RELEASE' ? `Open "${p?.title ?? a.quiz}" (${p?.questions ?? '?'} questions) to the students of ${p?.class ?? 'its class'}` : `Withdraw "${p?.title ?? a.quiz}" from the students of ${p?.class ?? 'its class'} (results already made are kept)`),
    async run(ctx, args, p) {
      const q = args.step === 'RELEASE' ? await quizzes.publish(ctx.actor, ctx.scope, p.quizId) : await quizzes.unpublish(ctx.actor, ctx.scope, p.quizId);
      return did(args.step === 'RELEASE' ? 'quiz_released' : 'quiz_withdrawn', q, args.step === 'RELEASE' ? `"${q.title}" is open to ${q.class}.` : `"${q.title}" is withdrawn from students.`);
    },
  }),

  get_quiz_results: tool({
    module: 'Quizzes', operation: 'GET',
    description: "For the teacher: a quiz's results for the class: each pupil's score and percentage or not attempted, and the average, highest and lowest. Read-only.",
    // `subject` as well as the title: "show the maths quiz results" names the
    // quiz by its subject, and a quiz is often only known that way.
    inputSchema: closed({ quiz: text(200, 'Its title'), subject: text(60, 'Its school subject, when the title is not known') }),
    permission: 'submissions.grade',
    service: 'quiz.service.list() + results()',
    async run(ctx, args) {
      const scope = ctx.actor.permissions?.['assignments.manage'] ?? ctx.scope;
      let quiz;
      if (args.quiz || !args.subject) quiz = await quizOf(ctx, args.quiz, scope);
      else {
        const rows = (await quizzes.list(ctx.actor, scope)).filter((q) => lower(q.subject ?? q.subjectName).includes(lower(args.subject)));
        quiz = pick(rows, null, { label: `${args.subject} quiz`, nameOf: (q) => q.title, refOf: () => '', describe: (q) => `"${q.title}" (${q.class})` });
      }
      const r = await quizzes.results(ctx.actor, ctx.scope, quiz.id);
      const s = r.summary;
      return listed(r.rows, (x) => `${x.studentName}: ${x.status === 'NOT_ATTEMPTED' ? 'not attempted' : x.score !== null ? `${x.score}/${x.totalMarks}` : words(x.status)}`, {
        noun: 'pupil', extra: { quiz: r.quiz.title, summary: s },
        speak: `"${r.quiz.title}": ${s.attemptedCount} of ${s.rosterSize} attempted${s.averagePercentage !== null ? `, average ${s.averagePercentage}%, highest ${s.highestScore}, lowest ${s.lowestScore}` : ''}.`,
      });
    },
  }),

  get_quiz_to_take: tool({
    module: 'Quizzes', operation: 'GET',
    description: "For a student: one quiz open to them (by title): subject, number of questions, marks, time limit and whether they have started or submitted it. The questions are given when they start it. Read-only.",
    inputSchema: closed({ quiz: text(200) }),
    permission: 'submissions.submit', forRoles: ['STUDENT'],
    service: 'quiz.service.list() + overviewForStudent()',
    async run(ctx, args) {
      const q = await quizOf(ctx, args.quiz);
      const o = await quizzes.overviewForStudent(ctx.actor, q.id);
      const a = o.myAttempt;
      return shown(o, `"${o.quiz.title}" (${o.quiz.subject}): ${o.quiz.questionCount} question(s), ${o.quiz.totalMarks} marks${o.quiz.durationMinutes ? `, ${o.quiz.durationMinutes} minutes once started` : ''}. ${a ? (a.status === 'IN_PROGRESS' ? 'You have started it.' : `You submitted it: ${a.score}/${a.totalMarks}.`) : 'Not started yet.'}`);
    },
  }),

  start_quiz: tool({
    module: 'Quizzes', operation: 'ACTION', risk: RISK.LOW,
    description: "For a student: start (or resume) a quiz open to them and get its questions and options; the time limit, if any, starts now. The assistant shows the questions and records only the student's own choices; it never suggests answers. Needs confirmation.",
    inputSchema: closed({ quiz: text(200) }),
    permission: 'submissions.submit', forRoles: ['STUDENT'],
    service: 'quiz.service.list() + start()',
    async prepare(ctx, args) {
      const q = await quizOf(ctx, args.quiz);
      if (q.myAttempt && q.myAttempt.status !== 'IN_PROGRESS') throw ask(`You have already submitted "${q.title}".`);
      return { quizId: q.id, title: q.title, minutes: q.durationMinutes ?? null, resuming: q.myAttempt?.status === 'IN_PROGRESS' };
    },
    summarise: (a, _actor, p) => `${p?.resuming ? 'Resume' : 'Start'} the quiz "${p?.title ?? a.quiz}"${p?.minutes && !p.resuming ? `; the ${p.minutes}-minute timer starts now` : ''}`,
    async run(ctx, _args, p) {
      const s = await quizzes.start(ctx.actor, p.quizId);
      const paper = s.questions.map((q, i) => `${i + 1}. ${q.text} ${q.options.map((o, j) => `(${j + 1}) ${o.text}`).join(' ')}`).join('\n');
      return did('quiz_started', s.attempt, `"${s.quiz.title}"${s.deadline ? `, due by ${s.deadline.slice(11, 16)} UTC` : ''}:\n${paper}\nTell me your answer to each question by number.`);
    },
  }),

  submit_quiz_answers: tool({
    module: 'Quizzes', operation: 'ACTION', risk: RISK.MEDIUM,
    description: "For a student who has started a quiz: submit their own answers (question number and the option they chose, by number or text). It is marked at once and cannot be changed afterwards. Needs confirmation.",
    inputSchema: closed({
      quiz: text(200),
      answers: list(closed({ question: int(1, 100), option: text(300, 'The option number (1, 2, ...) or its text') }, ['question', 'option']), 100),
    }, ['answers']),
    permission: 'submissions.submit', forRoles: ['STUDENT'],
    service: 'quiz.service.start() (resume) + submit()',
    async prepare(ctx, args) {
      const q = await quizOf(ctx, args.quiz);
      if (q.myAttempt?.status !== 'IN_PROGRESS') throw ask(q.myAttempt ? `You have already submitted "${q.title}".` : `Start "${q.title}" first, then give your answers.`);
      const s = await quizzes.start(ctx.actor, q.id);
      const sheet = [];
      for (const a of args.answers) {
        const question = s.questions[a.question - 1];
        if (!question) throw ask(`"${q.title}" has ${s.questions.length} question(s); there is no question ${a.question}.`);
        const raw = String(a.option).trim();
        const opt = /^\d+$/.test(raw) ? question.options[Number(raw) - 1] : question.options.find((o) => lower(o.text) === lower(raw));
        if (!opt) throw ask(`Question ${a.question}: which option? ${question.options.map((o, j) => `(${j + 1}) ${o.text}`).join(' ')}`);
        sheet.push({ questionId: question.id, optionId: opt.id, n: a.question, choice: opt.text });
      }
      return { quizId: q.id, title: q.title, total: s.questions.length, sheet };
    },
    summarise: (a, _actor, p) => `Submit ${p?.sheet?.length ?? a.answers.length} of ${p?.total ?? '?'} answers for "${p?.title ?? a.quiz}"${p?.sheet ? `: ${p.sheet.map((x) => `${x.n}. ${excerpt(x.choice, 30)}`).join(', ')}` : ''}. It cannot be changed after this`,
    async run(ctx, _args, p) {
      const r = await quizzes.submit(ctx.actor, p.quizId, { answers: p.sheet.map((x) => ({ questionId: x.questionId, optionId: x.optionId })) });
      return did('quiz_submitted', { id: r.attemptId }, `Submitted "${r.quizTitle}": ${r.score}/${r.totalMarks} (${r.percentage}%), ${r.correctCount} correct, ${r.wrongCount} wrong, ${r.unansweredCount} unanswered.`);
    },
  }),

  get_my_quiz_answers: tool({
    module: 'Quizzes', operation: 'GET',
    description: "For a student: their own result for one submitted quiz, question by question: what they chose and what each earned (never the answer key). Read-only.",
    inputSchema: closed({ quiz: text(200) }),
    permission: 'submissions.submit', forRoles: ['STUDENT'],
    service: 'quiz.service.list() + myResult()',
    async run(ctx, args) {
      const q = await quizOf(ctx, args.quiz);
      const r = await quizzes.myResult(ctx.actor, q.id);
      return shown(r, `"${r.quizTitle}": ${r.score}/${r.totalMarks} (${r.percentage}%). ${r.answers.map((a, i) => `${i + 1}. ${a.selectedOptionText ?? 'not answered'} ${a.isCorrect ? 'correct' : 'not correct'}`).join('; ')}.`);
    },
  }),
};

/* ── Announcement preview ─────────────────────────────────── */

const announcementTools = {
  get_announcement_preview: tool({
    module: 'Communication', operation: 'GET', resultShape: 'SUMMARY',
    description: 'Before posting an announcement: who it would reach (the audience the school\'s rules allow this publisher, or one named class) and how many people, with the email and WhatsApp wording. Nothing is posted or sent. Read-only.',
    // `forClass`, not className: the class narrows an audience being tried out, it is not the record asked about.
    inputSchema: closed({ title: text(200), content: text(5000), forClass: text(60, 'Only this class, e.g. "Class 6 A"'), email: bool('Also by email'), whatsapp: bool('Also on WhatsApp') }, ['title']),
    permission: 'announcements.publish',
    service: 'announcement.service.preview()',
    async run(ctx, args) {
      const section = args.forClass ? await sectionOf(ctx, args.forClass) : null;
      const p = await announcements.preview(ctx.actor, ctx.scope, {
        title: args.title, content: args.content ?? '', channels: { app: true, email: Boolean(args.email), whatsapp: Boolean(args.whatsapp) },
        ...(section && { audience: { all: false, sectionIds: [section.sectionId] } }),
      });
      return shown(p, `"${p.title}" would reach ${p.audienceLabel ?? 'its audience'}: about ${p.recipientCount} ${p.recipientCount === 1 ? 'person' : 'people'} in the app${p.channels.email ? ', by email' : ''}${p.channels.whatsapp ? ' and on WhatsApp' : ''}. Nothing has been posted.`);
    },
  }),
};

/* ── Online classes ───────────────────────────────────────── */

async function onlineClassOf(ctx, term) {
  const rows = await lectures.list(ctx.actor, { tab: 'all' });
  const live = rows.filter((c) => ['SCHEDULED', 'LIVE'].includes(c.status));
  const pool = term ? rows : live;
  try {
    return pick(pool, term, { label: 'online class', nameOf: (c) => c.title, refOf: (c) => c.refNo, describe: (c) => `${c.refNo} ${c.title} (${c.when})` });
  } catch (err) {
    // Several by the same title: the upcoming or live one is meant.
    const near = live.filter((c) => lower(c.title).includes(lower(term)) || lower(c.refNo) === lower(term));
    if (term && err.code === 'AGENT_NEEDS_INPUT' && near.length === 1) return near[0];
    throw err;
  }
}

const lectureTools = {
  get_online_class_options: tool({
    module: 'Lectures', operation: 'GET',
    description: 'For staff who schedule online classes: the classes they may schedule for, the kinds of session, whether they may invite staff roles, and the meeting services available (built-in room, Google Meet, Zoom, Teams). Read-only.',
    inputSchema: closed({}),
    permission: 'lectures.manage',
    service: 'lecture.service.options()',
    async run(ctx) {
      const o = await lectures.options(ctx.actor);
      return shown(o, `You can schedule for ${o.sections.length} class(es)${o.sections.length ? ` (${o.sections.slice(0, 8).map((s) => s.label).join(', ')}${o.sections.length > 8 ? ', ...' : ''})` : ''}; meetings by ${o.providers.map((p) => p.label).join(', ')}.${o.canInviteRoles ? ' You may invite staff roles.' : ''}`);
    },
  }),

  get_online_class_stats: tool({
    module: 'Lectures', operation: 'GET',
    description: 'How many online classes are live now, in the next 24 hours and in the next 7 days (the school\'s for administration, the caller\'s own as host otherwise). Read-only.',
    inputSchema: closed({}),
    permission: 'lectures.read',
    service: 'lecture.service.stats()',
    async run(ctx) {
      const s = await lectures.stats(ctx.actor);
      return shown(s, `${s.liveNow} online class(es) live now, ${s.next24Hours} in the next 24 hours, ${s.next7Days} in the next 7 days.`);
    },
  }),

  get_online_class: tool({
    module: 'Lectures', operation: 'GET',
    description: 'One online class or meeting the caller is part of (by title or reference): when, host, subject, status, whether the room is open, materials, recording and summary; the host also sees who joined. Read-only.',
    inputSchema: closed({ onlineClass: text(200, 'Its title or reference, e.g. "CLS-0012"') }),
    permission: 'lectures.read',
    service: 'lecture.service.list() + get()',
    async run(ctx, args) {
      const c = await lectures.get(ctx.actor, (await onlineClassOf(ctx, args.onlineClass)).id);
      return shown(c, `${c.refNo} "${c.title}" ${c.when} (${c.durationMinutes} min), ${words(c.status)}${c.hostName ? `, host ${c.hostName}` : ''}${c.joinOpen ? '; the room is open now' : ''}${c.recordingUrl ? '; recording available' : ''}.`);
    },
  }),

  join_online_class: tool({
    module: 'Lectures', operation: 'ACTION', risk: RISK.LOW,
    description: 'Join an online class or meeting the caller is part of (by title or reference): returns the meeting link (and passcode) once the room is open, and records that they joined; the host joining starts the class. Needs confirmation.',
    inputSchema: closed({ onlineClass: text(200) }),
    permission: 'lectures.read',
    service: 'lecture.service.list() + join()',
    async prepare(ctx, args) {
      const c = await onlineClassOf(ctx, args.onlineClass);
      return { classId: c.id, title: c.title, when: c.when, host: c.isHost };
    },
    summarise: (a, _actor, p) => `Join "${p?.title ?? a.onlineClass}" (${p?.when ?? ''})${p?.host ? '; as host this starts the class' : ''}`,
    async run(ctx, _args, p) {
      const j = await lectures.join(ctx.actor, p.classId);
      return did('online_class_joined', { id: p.classId, ...j }, `Join "${j.title}" here: ${j.joinUrl}${j.passcode ? ` (passcode ${j.passcode})` : ''}`);
    },
  }),

  get_online_class_attendance: tool({
    module: 'Lectures', operation: 'GET',
    description: 'For the host (or administration): who was invited to an online class and who opened the link, with when and how often. Read-only.',
    inputSchema: closed({ onlineClass: text(200) }),
    permission: 'lectures.manage',
    service: 'lecture.service.list() + attendance()',
    async run(ctx, args) {
      const a = await lectures.attendance(ctx.actor, (await onlineClassOf(ctx, args.onlineClass)).id);
      return listed(a.rows, (r) => `${r.name}${r.joined ? ' joined' : ' did not join'}`, { noun: 'invitee', extra: { title: a.title, when: a.when, note: a.note }, speak: `"${a.title}" (${a.when}): ${a.joined} of ${a.invited} joined.${a.rows.filter((r) => !r.joined).length ? ` Not joined: ${a.rows.filter((r) => !r.joined).slice(0, 12).map((r) => r.name).join(', ')}.` : ''}` });
    },
  }),
};

/* ── Lesson plans ─────────────────────────────────────────── */

async function planOf(ctx, { date, className, subject, title }) {
  const q = { ...(date && { from: date, to: date }) };
  if (className || subject) q.subjectOfferingId = (await offeringOf(ctx, { className, subject })).id;
  const rows = (await plans.list(ctx.actor, q)).items;
  return pick(rows, title, { label: 'lesson plan', nameOf: (p) => p.title, refOf: () => '', describe: (p) => `${p.date} ${p.class} ${p.subject}: ${p.title}` });
}
const planIdent = { date: dateStr('The lesson date, YYYY-MM-DD'), ...classSubject, title: text(200, 'The plan title') };
const STEP = closed({ phase: oneOf(['ENGAGE', 'EXPLORE', 'EXPLAIN', 'ELABORATE', 'EVALUATE']), minutes: int(1, 120), activity: text(600) }, ['phase', 'minutes', 'activity']);

const lessonPlanTools = {
  get_lesson_plan: tool({
    module: 'Lesson plans', operation: 'GET',
    description: "One lesson plan in full (by date, class/subject or title): objectives, pedagogies, steps with minutes, materials, differentiation, assessment, homework, status, reflection and feedback. A teacher reads their own; the principal any. Read-only.",
    inputSchema: closed(planIdent),
    permission: 'syllabus.manage',
    service: 'lessonPlans.service.list() + get()',
    async run(ctx, args) {
      const p = await plans.get(ctx.actor, (await planOf(ctx, args)).id);
      return shown(p, `"${p.title}" (${p.class} ${p.subject}, ${p.date}${p.periodNo !== null ? `, period ${p.periodNo}` : ''}), ${words(p.status)}: ${p.steps.map((s) => `${words(s.phase)} ${s.minutes} min`).join(', ') || 'no steps'}${p.homework ? `; homework: ${excerpt(p.homework, 80)}` : ''}${p.timingWarning ? ` ${p.timingWarning}` : ''}${p.feedback.length ? ` ${p.feedback.length} feedback note(s).` : ''}`);
    },
  }),

  update_lesson_plan: tool({
    module: 'Lesson plans', operation: 'UPDATE', risk: RISK.LOW,
    description: "Change one of the teacher's lesson plans (by date, class/subject or title): its title, date, period, length, objectives, pedagogies, steps, materials, differentiation, assessment, homework or status (draft / ready). After the lesson only the reflection can change. Needs confirmation.",
    inputSchema: closed({
      ...planIdent, newTitle: text(200), newDate: dateStr('Move it to this date'), periodNo: int(0, 15), durationMinutes: int(10, 240),
      objectives: list(text(300), 12), pedagogies: list(oneOf(PEDAGOGIES), 6), steps: list(STEP, 12), materials: text(2000),
      differentiation: text(2000), assessment: text(2000), homework: text(1000), status: oneOf(['DRAFT', 'READY']), reflection: text(3000),
    }),
    permission: 'syllabus.manage',
    service: 'lessonPlans.service.list() + update()',
    async prepare(ctx, args) {
      const p = await planOf(ctx, args);
      const body = {};
      if (args.newTitle) body.title = args.newTitle;
      if (args.newDate) body.date = args.newDate;
      for (const k of ['periodNo', 'durationMinutes', 'objectives', 'pedagogies', 'steps', 'materials', 'differentiation', 'assessment', 'homework', 'status', 'reflection']) if (args[k] !== undefined) body[k] = args[k];
      if (!Object.keys(body).length) throw ask('What should change in the plan?');
      return { planId: p.id, title: p.title, label: `${p.class} ${p.subject}, ${p.date}`, body };
    },
    summarise: (a, _actor, p) => `Change the lesson plan "${p?.title ?? a.title}" (${p?.label ?? ''}): ${Object.keys(p?.body ?? {}).map((k) => words(k)).join(', ')}`,
    async run(ctx, _args, p) {
      const out = await plans.update(ctx.actor, p.planId, p.body);
      return did('lesson_plan_updated', out, `Saved "${out.title}" (${out.class}, ${out.date}).${out.timingWarning ? ` ${out.timingWarning}` : ''}`);
    },
  }),

  delete_lesson_plan: tool({
    module: 'Lesson plans', operation: 'DELETE', risk: RISK.LOW,
    description: "Remove one of the teacher's lesson plans that has not been taught (a taught lesson stays on record). Needs confirmation.",
    inputSchema: closed(planIdent),
    permission: 'syllabus.manage',
    service: 'lessonPlans.service.list() + remove()',
    async prepare(ctx, args) {
      const p = await planOf(ctx, args);
      if (p.status === 'TAUGHT') throw ask('That lesson has been taught; it stays on record.');
      return { planId: p.id, title: p.title, label: `${p.class} ${p.subject}, ${p.date}` };
    },
    summarise: (a, _actor, p) => `Remove the lesson plan "${p?.title ?? a.title}" (${p?.label ?? ''})`,
    async run(ctx, _args, p) {
      await plans.remove(ctx.actor, p.planId);
      return did('lesson_plan_removed', { id: p.planId }, `Removed "${p.title}".`);
    },
  }),

  duplicate_lesson_plan: tool({
    module: 'Lesson plans', operation: 'CREATE', risk: RISK.LOW,
    description: "Copy one of the teacher's lesson plans to another class taking the same subject (e.g. 6 A maths to 6 B), as a draft, optionally on another date. Needs confirmation.",
    inputSchema: closed({ ...planIdent, toClass: text(60, 'The class to copy it to'), toDate: dateStr('Its date there (default the same date)') }, ['toClass']),
    permission: 'syllabus.manage',
    service: 'lessonPlans.service.list() + copyTo()',
    async prepare(ctx, args) {
      const p = await planOf(ctx, args);
      const target = await offeringOf(ctx, { className: args.toClass, subject: p.subject });
      return { planId: p.id, title: p.title, from: p.class, offeringId: target.id, to: target.label };
    },
    summarise: (a, _actor, p) => `Copy "${p?.title ?? a.title}" from ${p?.from ?? ''} to ${p?.to ?? a.toClass}${a.toDate ? ` on ${a.toDate}` : ''} as a draft`,
    async run(ctx, args, p) {
      const out = await plans.copyTo(ctx.actor, p.planId, { subjectOfferingId: p.offeringId, ...(args.toDate && { date: args.toDate }) });
      return did('lesson_plan_copied', out, `Copied "${out.title}" to ${out.class} for ${out.date} (draft).`);
    },
  }),
};

/* ── Question bank and papers ─────────────────────────────── */

async function bankQuestionOf(ctx, args) {
  const o = await offeringOf(ctx, args);
  const out = await bank.listQuestions(ctx.actor, { subjectId: o.subjectId, gradeId: o.gradeId, ...(args.chapter && { chapter: args.chapter }) });
  const q = pick(out.items, args.question, { label: 'question in the bank', nameOf: (x) => x.text, refOf: () => '', describe: (x) => `"${excerpt(x.text, 60)}" (${x.chapter})` });
  return { q, offering: o };
}

async function paperOf(ctx, title) {
  const rows = await bank.listPapers(ctx.actor, {});
  return pick(rows, title, { label: 'question paper', nameOf: (p) => p.title, refOf: () => '', describe: (p) => `${p.title} (${p.subject} ${p.grade}, ${words(p.status)})` });
}

/** Paper sections written as words: each question named by a phrase from its text. */
async function sectionsFrom(ctx, sections, subjectId, gradeId) {
  const pool = (await bank.listQuestions(ctx.actor, { subjectId, gradeId })).items;
  return sections.map((s, i) => ({
    title: s.title ?? `Section ${String.fromCharCode(65 + i)}`, instructions: s.instructions,
    questionIds: (s.questions ?? []).map((t) => pick(pool, t, { label: 'question in the bank', nameOf: (x) => x.text, refOf: () => '', describe: (x) => `"${excerpt(x.text, 60)}" (${x.chapter})` }).id),
  }));
}
const PAPER_SECTION = closed({ title: text(120), instructions: text(1000), questions: list(text(300, 'A phrase from the question\'s text'), 80) }, ['questions']);
const paperView = (p) => `"${p.title}" (${p.subject} ${p.grade}, ${words(p.status)}): ${p.analysis.totalMarks} marks, ${p.analysis.questions} question(s), ${p.analysis.competencyPct}% competency-based${p.analysis.warnings.length ? `. Check: ${p.analysis.warnings.join(' ')}` : ''}`;

const bankTools = {
  list_question_bank_scopes: tool({
    module: 'Question bank', operation: 'GET',
    description: 'The subjects and classes the caller may use the question bank for, with the chapters known for each and how many questions the bank holds. Read-only.',
    inputSchema: closed({}),
    permission: 'syllabus.manage',
    service: 'questionBank.service.scopes()',
    async run(ctx) {
      const rows = await bank.scopes(ctx.actor);
      return listed(rows, (r) => `${r.subject} ${r.grade} (${r.questions} question(s), ${r.chapters.length} chapter(s))`, { noun: 'subject' });
    },
  }),

  update_bank_question: tool({
    module: 'Question bank', operation: 'UPDATE', risk: RISK.LOW,
    description: "Change a question the caller wrote in the question bank (found by subject, class and a phrase from its text): chapter, type, marks, the text, options and the correct one, answer, marking scheme, cognitive level, difficulty, competency-based. Needs confirmation.",
    inputSchema: closed({
      ...classSubject, chapter: text(200, 'Its chapter, to narrow the search'), question: text(300, 'A phrase from the question as it is now'),
      newChapter: text(200), type: oneOf(QUESTION_TYPES), marks: num(0.5, 20), newText: text(3000), options: list(text(400), 6), correctOption: int(1, 6),
      answer: text(3000), markingScheme: text(3000), bloom: oneOf(BLOOM_LEVELS), difficulty: oneOf(DIFFICULTIES), competencyBased: bool(),
    }, ['subject', 'question']),
    permission: 'syllabus.manage',
    service: 'questionBank.service.listQuestions() + updateQuestion()',
    async prepare(ctx, args) {
      const { q } = await bankQuestionOf(ctx, args);
      const body = {};
      if (args.newChapter) body.chapter = args.newChapter;
      if (args.newText) body.text = args.newText;
      for (const k of ['type', 'marks', 'answer', 'markingScheme', 'bloom', 'difficulty', 'competencyBased']) if (args[k] !== undefined) body[k] = args[k];
      if (args.options) {
        if (!args.correctOption || args.correctOption > args.options.length) throw ask('Say which of the options is correct.');
        body.options = args.options.map((t, i) => ({ text: t, isCorrect: i + 1 === args.correctOption }));
      } else if (args.correctOption) {
        if (args.correctOption > q.options.length) throw ask('That option number is not one of its options.');
        body.options = q.options.map((o, i) => ({ text: o.text, isCorrect: i + 1 === args.correctOption }));
      }
      if (!Object.keys(body).length) throw ask('What should change in the question?');
      return { questionId: q.id, text: excerpt(q.text, 80), body };
    },
    summarise: (a, _actor, p) => `Change the bank question "${p?.text ?? a.question}": ${Object.keys(p?.body ?? {}).map((k) => words(k)).join(', ')}`,
    async run(ctx, _args, p) {
      const q = await bank.updateQuestion(ctx.actor, p.questionId, p.body);
      return did('bank_question_updated', q, `Saved the question "${excerpt(q.text, 60)}".`);
    },
  }),

  archive_bank_question: tool({
    module: 'Question bank', operation: 'DELETE', risk: RISK.LOW,
    description: "Remove a question the caller wrote from the question bank (found by subject, class and a phrase from its text). Papers already made keep it. Needs confirmation.",
    inputSchema: closed({ ...classSubject, chapter: text(200), question: text(300) }, ['subject', 'question']),
    permission: 'syllabus.manage',
    service: 'questionBank.service.listQuestions() + archiveQuestion()',
    async prepare(ctx, args) {
      const { q } = await bankQuestionOf(ctx, args);
      return { questionId: q.id, text: excerpt(q.text, 80), chapter: q.chapter };
    },
    summarise: (a, _actor, p) => `Remove "${p?.text ?? a.question}" (${p?.chapter ?? ''}) from the question bank`,
    async run(ctx, _args, p) {
      await bank.archiveQuestion(ctx.actor, p.questionId);
      return did('bank_question_archived', { id: p.questionId }, `Removed "${p.text}" from the bank.`);
    },
  }),

  draft_question_paper: tool({
    module: 'Question bank', operation: 'CREATE', risk: RISK.LOW,
    description: "Make a question paper by hand for a subject and class the caller teaches: title, time, target marks, instructions, and sections each listing bank questions by a phrase from their text. It stays a draft until made final. Needs confirmation.",
    inputSchema: closed({
      ...classSubject, title: { type: 'string', minLength: 1, maxLength: 200 }, durationMinutes: int(10, 300), targetMarks: int(1, 200),
      competencyTargetPct: int(0, 100), instructions: text(2000), sections: { type: 'array', minItems: 1, maxItems: 10, items: PAPER_SECTION },
    }, ['subject', 'title', 'sections']),
    permission: 'syllabus.manage',
    service: 'questionBank.service.listQuestions() + createPaper()',
    async prepare(ctx, args) {
      const o = await offeringOf(ctx, args);
      const sections = await sectionsFrom(ctx, args.sections, o.subjectId, o.gradeId);
      return { subjectId: o.subjectId, gradeId: o.gradeId, offering: o.label, sections, questions: sections.reduce((n, s) => n + s.questionIds.length, 0) };
    },
    summarise: (a, _actor, p) => `Make the draft paper "${a.title}" for ${p?.offering ?? a.subject}: ${a.sections.length} section(s), ${p?.questions ?? '?'} question(s)${a.targetMarks ? `, ${a.targetMarks} marks` : ''}`,
    async run(ctx, args, p) {
      const paper = await bank.createPaper(ctx.actor, { subjectId: p.subjectId, gradeId: p.gradeId, title: args.title, durationMinutes: args.durationMinutes, targetMarks: args.targetMarks, competencyTargetPct: args.competencyTargetPct, instructions: args.instructions, sections: p.sections });
      return did('question_paper_created', paper, `Saved ${paperView(paper)}.`);
    },
  }),

  get_question_paper: tool({
    module: 'Question bank', operation: 'GET',
    description: "One of the caller's question papers in full (by title): sections with every question, marks, options and answers, and its checks. Read-only.",
    inputSchema: closed({ title: text(200) }),
    permission: 'syllabus.manage',
    service: 'questionBank.service.listPapers() + getPaper()',
    async run(ctx, args) {
      const p = await bank.getPaper(ctx.actor, (await paperOf(ctx, args.title)).id);
      return shown(p, `${paperView(p)}. ${p.sections.map((s) => `${s.title}: ${s.questions.map((q) => `${excerpt(q.text, 50)} (${q.marks})`).join('; ')}`).join(' | ')}`);
    },
  }),

  update_question_paper: tool({
    module: 'Question bank', operation: 'UPDATE', risk: RISK.LOW,
    description: "Change one of the caller's draft question papers (by title): its title, time, target marks, competency target, instructions, or its sections (replaced, with questions named by a phrase from their text). A final paper cannot change. Needs confirmation.",
    inputSchema: closed({
      title: text(200, 'The paper as it is called now'), newTitle: text(200), durationMinutes: int(10, 300), targetMarks: int(1, 200),
      competencyTargetPct: int(0, 100), instructions: text(2000), sections: { type: 'array', minItems: 1, maxItems: 10, items: PAPER_SECTION },
    }, ['title']),
    permission: 'syllabus.manage',
    service: 'questionBank.service.listPapers() + updatePaper()',
    async prepare(ctx, args) {
      const paper = await paperOf(ctx, args.title);
      if (paper.status === 'FINAL') throw ask(`"${paper.title}" is final and cannot change.`);
      const body = {};
      if (args.newTitle) body.title = args.newTitle;
      for (const k of ['durationMinutes', 'targetMarks', 'competencyTargetPct', 'instructions']) if (args[k] !== undefined) body[k] = args[k];
      if (args.sections) body.sections = await sectionsFrom(ctx, args.sections, paper.subjectId, paper.gradeId);
      if (!Object.keys(body).length) throw ask('What should change in the paper?');
      return { paperId: paper.id, title: paper.title, body };
    },
    summarise: (a, _actor, p) => `Change the paper "${p?.title ?? a.title}": ${Object.keys(p?.body ?? {}).map((k) => words(k)).join(', ')}`,
    async run(ctx, _args, p) {
      const paper = await bank.updatePaper(ctx.actor, p.paperId, p.body);
      return did('question_paper_updated', paper, `Saved ${paperView(paper)}.`);
    },
  }),

  finalise_question_paper: tool({
    module: 'Question bank', operation: 'ACTION', risk: RISK.LOW,
    description: "Make one of the caller's question papers final (by title): it is locked for printing and each question's use is counted so the next paper prefers fresh ones. Needs confirmation.",
    inputSchema: closed({ title: text(200) }, ['title']),
    permission: 'syllabus.manage',
    service: 'questionBank.service.listPapers() + finalisePaper()',
    async prepare(ctx, args) {
      const paper = await paperOf(ctx, args.title);
      if (paper.status === 'FINAL') throw ask(`"${paper.title}" is already final.`);
      return { paperId: paper.id, title: paper.title, marks: paper.analysis.totalMarks, warnings: paper.analysis.warnings };
    },
    summarise: (a, _actor, p) => `Make "${p?.title ?? a.title}" final (${p?.marks ?? '?'} marks); it can no longer change${p?.warnings?.length ? `. Open checks: ${p.warnings.join(' ')}` : ''}`,
    async run(ctx, _args, p) {
      const paper = await bank.finalisePaper(ctx.actor, p.paperId);
      return did('question_paper_finalised', paper, `"${paper.title}" is final.`);
    },
  }),

  delete_question_paper: tool({
    module: 'Question bank', operation: 'DELETE', risk: RISK.LOW,
    description: "Remove one of the caller's draft question papers (by title); a final paper stays on record. Needs confirmation.",
    inputSchema: closed({ title: text(200) }, ['title']),
    permission: 'syllabus.manage',
    service: 'questionBank.service.listPapers() + removePaper()',
    async prepare(ctx, args) {
      const paper = await paperOf(ctx, args.title);
      if (paper.status === 'FINAL') throw ask(`"${paper.title}" is final and stays on record.`);
      return { paperId: paper.id, title: paper.title };
    },
    summarise: (a, _actor, p) => `Remove the draft paper "${p?.title ?? a.title}"`,
    async run(ctx, _args, p) {
      await bank.removePaper(ctx.actor, p.paperId);
      return did('question_paper_removed', { id: p.paperId }, `Removed "${p.title}".`);
    },
  }),

  get_paper_results: tool({
    module: 'Exams', operation: 'GET',
    description: "For the subject teacher (or school-wide staff): the analysis of one exam paper's marks (by class, subject and exam): average, highest, lowest, pass percentage, CBSE grade bands and the pupils who need remedial help. Read-only.",
    inputSchema: closed({ ...classSubject, exam: text(60, 'The exam, e.g. "Unit Test 2"') }),
    permission: 'marks.read',
    service: 'exam.service.listExamSubjects() + paperResults.service.paperResults()',
    async run(ctx, args) {
      if (!args.className && !args.subject && !args.exam) throw ask('Which exam paper? Name the class, the subject and the exam.');
      const section = args.className ? await resolveSection(ctx, { className: args.className }) : null;
      const papers = (await exams.listExamSubjects(ctx.actor, ctx.scope, null)) ?? [];
      const has = (v, w) => !w || lower(v).includes(lower(w));
      const matching = papers.filter((p) => (!section || classKey(p.class) === classKey(section.label)) && (!args.subject || has(p.subject, subjectWord(args.subject)) || has(p.subject, args.subject)) && (!args.exam || has(p.examName, args.exam) || has(args.exam, p.examName)));
      const paper = pick(matching, '', { label: `exam paper${[args.subject, args.exam, section?.label].filter(Boolean).length ? ` matching ${[args.subject, args.exam, section?.label].filter(Boolean).join(', ')}` : ''}`, describe: (p) => `${p.subject} (${p.examName}) for ${p.class}` });
      const r = await paperResults(ctx.actor, ctx.scope, String(paper.id));
      return shown({ paper: `${paper.subject} (${paper.examName}) for ${paper.class}`, ...r }, `${paper.subject} ${paper.examName}, ${paper.class}: ${r.average !== null ? `average ${r.average}%, highest ${r.highest}, lowest ${r.lowest}, pass ${r.passPct}%` : 'no marks yet'}${r.remedial?.length ? `; ${r.remedial.length} pupil(s) need support` : ''}.`);
    },
  }),
};

/* ── CPD ──────────────────────────────────────────────────── */

const cpdTools = {
  delete_cpd_entry: tool({
    module: 'CPD', operation: 'DELETE', risk: RISK.LOW,
    description: "Remove a CPD entry the caller logged this year and that is not yet verified (by its title, and date when several share it). Needs confirmation.",
    inputSchema: closed({ title: text(200), date: dateStr('YYYY-MM-DD, when several entries share a title') }, ['title']),
    permission: 'staffleave.apply',
    service: 'cpd.service.mine() + remove()',
    anyOf: [['staffleave.apply'], ['staffleave.manage']],
    guard: (ctx) => needAny(ctx, [['staffleave.apply'], ['staffleave.manage']]),
    async prepare(ctx, args) {
      const m = await cpd.mine(ctx.actor);
      const pool = m.entries.filter((e) => e.source === 'LOGGED' && (!args.date || e.date === args.date));
      const e = pick(pool, args.title, { label: 'CPD entry of yours', nameOf: (x) => x.title, refOf: () => '', describe: (x) => `${x.title} (${x.date}, ${x.hours} h)` });
      if (e.verified) throw ask('That entry is verified and stays on record; ask HR to correct it.');
      return { entryId: e.id, title: e.title, date: e.date, hours: e.hours };
    },
    summarise: (a, _actor, p) => `Remove your CPD entry "${p?.title ?? a.title}" (${p?.date ?? ''}, ${p?.hours ?? '?'} h)`,
    async run(ctx, _args, p) {
      await cpd.remove(ctx.actor, p.entryId);
      return did('cpd_entry_removed', { id: p.entryId }, `Removed "${p.title}".`);
    },
  }),

  record_cpd_verification: tool({
    module: 'CPD', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true,
    description: "For HR or the principal: verify a colleague's logged CPD hours against their certificate (by the colleague's name and the training title). Recorded only when the approver states it in their own words; never suggested. Confirmed on the website.",
    inputSchema: closed({ colleague: text(80, 'Whose hours'), title: text(200, 'The training title'), decision: decisionArg(['VERIFIED'], 'HR or the principal') }, ['colleague', 'title', 'decision']),
    permission: 'staffleave.manage', minScope: 'ALL',
    service: 'cpd.service.overview() + verify()',
    async prepare(ctx, args) {
      const o = await cpd.overview(ctx.actor);
      const theirs = o.pendingVerification.filter((e) => lower(e.name).includes(lower(stripTitle(args.colleague))));
      if (!theirs.length) throw notFound(`No unverified CPD entry from ${args.colleague}.`);
      const e = pick(theirs, args.title, { label: 'CPD entry', nameOf: (x) => x.title, refOf: () => '', describe: (x) => `${x.name}: ${x.title} (${x.date}, ${x.hours} h)` });
      return { entryId: e.id, who: e.name, title: e.title, hours: e.hours, date: e.date, evidence: Boolean(e.evidenceUrl) };
    },
    summarise: (a, _actor, p) => `Verify ${p?.who ?? a.colleague}'s ${p?.hours ?? '?'} CPD hour(s) for "${p?.title ?? a.title}" (${p?.date ?? ''})${p && !p.evidence ? ' (no certificate link was given)' : ''}`,
    async run(ctx, _args, p) {
      const e = await cpd.verify(ctx.actor, p.entryId);
      return did('cpd_verified', e, `Verified ${p.who}'s ${e.hours} hour(s) for "${e.title}".`);
    },
  }),
};

/* ── Term report cards ────────────────────────────────────── */

async function templateOf(name) {
  const rows = await reportcards.listTemplates();
  if (!name) return rows[0];
  return pick(rows, name, { label: 'report-card template', nameOf: (t) => t.name, refOf: () => '', describe: (t) => t.name });
}

function termOf(tpl, term) {
  if (!term) {
    if (tpl.terms.length === 1) return tpl.terms[0];
    throw ask(`Which term: ${tpl.terms.map((t) => t.name).join(', ')}?`);
  }
  return pick(tpl.terms, term, { label: 'term', nameOf: (t) => t.name, refOf: (t) => t.key, describe: (t) => t.name });
}

async function cardOf(ctx, args) {
  const studentId = await resolveStudentId(ctx, args);
  if (!studentId) throw ask('Which pupil? Give their name or admission number.');
  const rows = (await reportcards.list(ctx.actor, ctx.scope, {})).filter((c) => c.studentId === String(studentId));
  if (!rows.length) throw notFound('That pupil has no term report card yet; the class teacher prepares the class\'s cards first.');
  const pool = args.term ? rows.filter((c) => lower(c.termName) === lower(args.term) || lower(c.termKey) === lower(args.term).replace(/\s+/g, '_')) : rows;
  return pick(pool, '', { label: `${args.term ?? ''} report card`.trim(), describe: (c) => `${c.studentName} ${c.termName} (${words(c.status)})` });
}
const cardIdent = { ...studentIdentitySchema, term: text(40, 'e.g. "Term 1"') };
const cardSpeak = (c) => `${c.studentName}'s ${c.termName} card (${c.className}) is ${words(c.status)}`;

const TEMPLATE_TERM = closed({
  key: text(20), name: text(60),
  components: list(closed({ key: text(20), label: text(60), maxMarks: num(1, 1000), source: oneOf(['EXAM', 'MANUAL']), examName: text(80, 'For an EXAM component: the exam it draws on') }, ['key', 'label', 'maxMarks', 'source']), 10),
}, ['key', 'name', 'components']);
const templateFields = {
  board: text(40), passPercent: num(0, 100), terms: list(TEMPLATE_TERM, 6, 'The terms and their components (default: copied)'),
  coScholasticAreas: list(text(60), 12, 'The co-scholastic areas, e.g. ["Work education", "Art education"]'),
  coScholasticGrades: list(text(4), 8, 'e.g. ["A", "B", "C"]'), disciplineLabel: text(40),
};
function templateBody(args) {
  const out = {};
  for (const k of ['board', 'passPercent', 'terms', 'coScholasticGrades', 'disciplineLabel']) if (args[k] !== undefined) out[k] = args[k];
  if (args.coScholasticAreas) out.coScholasticAreas = args.coScholasticAreas.map((label) => ({ key: label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30), label }));
  return out;
}

const reportCardTools = {
  list_report_card_templates: tool({
    module: 'Report cards', operation: 'GET', feature: 'reportCards',
    description: 'The school\'s term report-card templates: their terms, each subject component and its marks and source (exam or entered by hand), co-scholastic areas, grade scale and pass mark. Read-only.',
    inputSchema: closed({}),
    permission: 'reportcards.manage',
    service: 'reportcards.service.listTemplates()',
    async run() {
      const rows = await reportcards.listTemplates();
      return listed(rows, (t) => `${t.name}: ${t.terms.map((x) => `${x.name} (${x.components.map((c) => `${c.label} ${c.maxMarks}`).join(', ')})`).join('; ')}`, { noun: 'template' });
    },
  }),

  create_report_card_template: tool({
    module: 'Report cards', operation: 'CREATE', risk: RISK.HIGH, feature: 'reportCards',
    description: 'For the principal or administration: create a term report-card template, copied from an existing one (default the shipped CBSE-style template) with the changes given: name, board, terms and components, co-scholastic areas and grades, discipline label, pass mark. Confirmed on the website.',
    inputSchema: closed({ name: { type: 'string', minLength: 1, maxLength: 120 }, copyFrom: text(120, 'The template to start from'), ...templateFields }, ['name']),
    permission: 'reportcards.manage',
    service: 'reportcards.service.listTemplates() + createTemplate()',
    async prepare(_ctx, args) {
      const base = await templateOf(args.copyFrom);
      return { base: base.name, body: { ...base, id: undefined, name: args.name, ...templateBody(args) } };
    },
    summarise: (a, _actor, p) => `Create the report-card template "${a.name}" from "${p?.base ?? a.copyFrom ?? 'the default'}"${Object.keys(templateBody(a)).length ? `, changing ${Object.keys(templateBody(a)).map((k) => words(k)).join(', ')}` : ''}`,
    async run(ctx, _args, p) {
      const t = await reportcards.createTemplate(ctx.actor, ctx.scope, p.body);
      return did('report_card_template_created', t, `Created the template "${t.name}" with ${t.terms.length} term(s).`);
    },
  }),

  update_report_card_template: tool({
    module: 'Report cards', operation: 'UPDATE', risk: RISK.HIGH, feature: 'reportCards',
    description: 'For the principal or administration: change a report-card template no published card uses yet: its name, board, terms and components, co-scholastic areas and grades, discipline label or pass mark. Confirmed on the website.',
    inputSchema: closed({ template: text(120, 'The template as it is called now'), newName: text(120), ...templateFields }, ['template']),
    permission: 'reportcards.manage',
    service: 'reportcards.service.listTemplates() + updateTemplate()',
    async prepare(_ctx, args) {
      const t = await templateOf(args.template);
      const body = { ...templateBody(args), ...(args.newName && { name: args.newName }) };
      if (!Object.keys(body).length) throw ask('What should change in the template?');
      return { templateId: t.id, name: t.name, body };
    },
    summarise: (a, _actor, p) => `Change the report-card template "${p?.name ?? a.template}": ${Object.keys(p?.body ?? {}).map((k) => words(k)).join(', ')}`,
    async run(ctx, _args, p) {
      const t = await reportcards.updateTemplate(ctx.actor, ctx.scope, p.templateId, p.body);
      return did('report_card_template_updated', t, `Saved the template "${t.name}".`);
    },
  }),

  list_term_report_classes: tool({
    module: 'Report cards', operation: 'GET', feature: 'reportCards',
    description: 'The classes a member of staff prepares term report cards for, and their part in each (class teacher, subject teacher, or school-wide). Read-only.',
    inputSchema: closed({}),
    permission: 'reportcards.manage',
    service: 'reportcards.service.mySections()',
    async run(ctx) {
      const rows = await reportcards.mySections(ctx.actor, ctx.scope);
      return listed(rows, (r) => `${r.label} (${words(r.role)})`, { noun: 'class' });
    },
  }),

  get_published_term_report_card: tool({
    module: 'Report cards', operation: 'GET', feature: 'reportCards',
    description: "A published term report card for a parent's own child, a student's own, or (school-wide) any pupil: the latest version or an earlier one by number, with subjects, grades, attendance, remarks and result. Read-only.",
    inputSchema: closed({ ...cardIdent, version: int(1, 50, 'An earlier version number; default the latest') }),
    permission: 'reportcards.read',
    service: 'reportcards.service.published() + getVersion()',
    anyOf: [['reportcards.read'], ['reportcards.manage']],
    guard: (ctx) => needAny(ctx, [['reportcards.read'], ['reportcards.manage']]),
    async run(ctx, args) {
      const studentId = (args.studentId || args.admissionNo || args.studentName) ? await resolveStudentId(ctx, args) : null;
      const cards = await reportcards.published(ctx.actor, ctx.scope, studentId ? { studentId } : {});
      const pool = args.term ? cards.filter((c) => lower(c.card?.termName) === lower(args.term)) : cards;
      const card = pick(pool, '', { label: 'published report card', describe: (c) => `${c.card?.studentName} ${c.card?.termName} v${c.version}` });
      const versionId = args.version && args.version !== card.version ? card.olderVersions.find((o) => o.version === args.version)?.versionId : card.versionId;
      if (!versionId) throw notFound(`There is no version ${args.version} of that card.`);
      const v = await reportcards.getVersion(ctx.actor, ctx.actor.permissions, versionId);
      const c = v.card;
      return shown(v, `${c.studentName}'s ${c.termName} report card (version ${v.version}${v.supersededAt ? ', replaced by a later version' : ''}): ${(c.scholastic ?? []).map((s) => `${s.subject} ${s.grade ?? s.total ?? ''}`.trim()).join(', ')}${c.resultLine ? `. ${c.resultLine}` : ''}`);
    },
  }),

  generate_term_report_cards: tool({
    module: 'Report cards', operation: 'ACTION', risk: RISK.MEDIUM, affectsOthers: true, feature: 'reportCards',
    description: "For the class teacher or principal: prepare (or refresh) the draft term report cards of every pupil in a class from published marks, for a term of a template (default the school's first template). Nothing is approved or published. Confirmed on the website.",
    inputSchema: closed({ ...classIdentitySchema, term: text(40, 'e.g. "Term 1"'), template: text(120) }, ['className']),
    permission: 'reportcards.manage',
    service: 'reportcards.service.listTemplates() + generate()',
    async prepare(ctx, args) {
      const section = await sectionOf(ctx, args.className);
      const tpl = await templateOf(args.template);
      const term = termOf(tpl, args.term);
      return { sectionId: section.sectionId, label: section.label, templateId: tpl.id, template: tpl.name, termKey: term.key, term: term.name };
    },
    summarise: (a, _actor, p) => `Prepare the draft ${p?.term ?? a.term ?? ''} report cards for every pupil in ${p?.label ?? a.className} from published marks (${p?.template ?? 'default template'})`,
    async run(ctx, _args, p) {
      const out = await reportcards.generate(ctx.actor, ctx.scope, { sectionId: p.sectionId, templateId: p.templateId, termKey: p.termKey });
      return did('term_report_cards_generated', { id: p.sectionId, ...out }, `${out.className} ${p.term}: ${out.created} card(s) prepared, ${out.refreshed} refreshed, for ${out.students} pupil(s).`);
    },
  }),

  record_class_report_card_moderation: tool({
    module: 'Report cards', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true, feature: 'reportCards',
    description: "For the class teacher (class teacher stage) or the principal (principal stage): approve every term report card of a class waiting at that stage. Recorded only when the approver states it in their own words; never suggested. Publishing to families stays on the Report cards page. Confirmed on the website.",
    inputSchema: closed({ ...classIdentitySchema, term: text(40), stage: oneOf(['CLASS_TEACHER', 'PRINCIPAL']), decision: decisionArg(['APPROVE'], 'the class teacher or principal'), note: text(500) }, ['className', 'stage', 'decision']),
    permission: 'reportcards.manage',
    service: 'reportcards.service.list() + bulk()',
    async prepare(ctx, args) {
      const section = await sectionOf(ctx, args.className);
      const cards = await reportcards.list(ctx.actor, ctx.scope, { sectionId: section.sectionId });
      const terms = [...new Map(cards.map((c) => [c.termKey, { key: c.termKey, name: c.termName }])).values()];
      if (!terms.length) throw notFound(`${section.label} has no term report cards yet.`);
      const term = args.term ? pick(terms, args.term, { label: 'term', nameOf: (t) => t.name, refOf: (t) => t.key, describe: (t) => t.name }) : pick(terms, '', { label: 'term', describe: (t) => t.name });
      const waiting = cards.filter((c) => c.termKey === term.key && c.status === (args.stage === 'CLASS_TEACHER' ? 'DRAFT' : 'CLASS_TEACHER_APPROVED')).length;
      if (!waiting) throw notFound(`No ${term.name} card in ${section.label} is waiting at the ${words(args.stage)} stage.`);
      return { sectionId: section.sectionId, label: section.label, termKey: term.key, term: term.name, waiting };
    },
    summarise: (a, _actor, p) => `Approve at the ${words(a.stage)} stage the ${p?.waiting ?? ''} ${p?.term ?? a.term ?? ''} report card(s) of ${p?.label ?? a.className} waiting there`,
    async run(ctx, args, p) {
      const out = await reportcards.bulk(ctx.actor, ctx.scope, { action: args.stage === 'CLASS_TEACHER' ? 'CLASS_TEACHER_APPROVE' : 'PRINCIPAL_APPROVE', sectionId: p.sectionId, termKey: p.termKey, note: args.note });
      return did('class_report_cards_moderated', { id: p.sectionId, ...out }, `${out.done} card(s) approved at the ${words(args.stage)} stage.${out.failed.length ? ` Not approved: ${out.failed.slice(0, 5).map((f) => f.reason).join('; ')}.` : ''}`);
    },
  }),

  get_term_report_card: tool({
    module: 'Report cards', operation: 'GET', feature: 'reportCards',
    description: "For staff preparing cards: one pupil's term report card in full: each subject's components and grade, co-scholastic grades, discipline, remarks, attendance, result, what is missing and its approval stage. Read-only.",
    inputSchema: closed(cardIdent),
    permission: 'reportcards.manage',
    service: 'reportcards.service.list() + get()',
    async run(ctx, args) {
      const c = await reportcards.get(ctx.actor, ctx.scope, (await cardOf(ctx, args)).id);
      return shown(c, `${cardSpeak(c)}: ${(c.scholastic ?? []).map((s) => `${s.subject} ${s.grade ?? 'pending'}`).join(', ')}${c.summary?.pendingSubjects?.length ? `; pending marks in ${c.summary.pendingSubjects.join(', ')}` : ''}${c.classTeacherRemarks ? `; remarks: ${excerpt(c.classTeacherRemarks, 80)}` : ''}.`);
    },
  }),

  record_report_card_moderation: tool({
    module: 'Report cards', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true, feature: 'reportCards',
    description: "For the class teacher or the principal: approve one pupil's term report card at its stage (class teacher, then principal), or return it to draft with a reason. Recorded only when the approver states it in their own words; never suggested. Publishing to families stays on the Report cards page. Confirmed on the website.",
    inputSchema: closed({
      ...cardIdent, decision: decisionArg(['APPROVE', 'RETURN_TO_DRAFT'], 'the class teacher or principal'), reason: text(500, 'Why it goes back to draft (required for that)'),
      note: text(500), allowIncomplete: bool('Approve although something is missing'), selfModerationReason: text(500, 'When the principal also approved it as class teacher'),
    }, ['decision']),
    permission: 'reportcards.manage',
    service: 'reportcards.service.list() + moderate() / returnToDraft()',
    async prepare(ctx, args) {
      if (args.decision === 'RETURN_TO_DRAFT' && !args.reason) throw ask('Why does it go back to draft?');
      const c = await cardOf(ctx, args);
      let stage = null;
      if (args.decision === 'APPROVE') {
        stage = c.status === 'DRAFT' ? 'CLASS_TEACHER' : c.status === 'CLASS_TEACHER_APPROVED' ? 'PRINCIPAL' : null;
        if (!stage) throw ask(`${cardSpeak(c)}; there is no approval stage left. Publishing is on the Report cards page.`);
      } else if (c.status === 'DRAFT') throw ask(`${cardSpeak(c)} already.`);
      return { cardId: c.id, student: c.studentName, term: c.termName, status: c.status, stage };
    },
    summarise: (a, _actor, p) => (a.decision === 'APPROVE' ? `Approve ${p?.student ?? 'the pupil'}'s ${p?.term ?? ''} report card at the ${words(p?.stage ?? '')} stage` : `Return ${p?.student ?? 'the pupil'}'s ${p?.term ?? ''} report card to draft: ${excerpt(a.reason, 80)}`),
    async run(ctx, args, p) {
      const c = args.decision === 'APPROVE'
        ? await reportcards.moderate(ctx.actor, ctx.scope, p.cardId, { stage: p.stage, note: args.note, allowIncomplete: args.allowIncomplete === true, ...(args.selfModerationReason && { selfModerationReason: args.selfModerationReason }) })
        : await reportcards.returnToDraft(ctx.actor, ctx.scope, p.cardId, { reason: args.reason });
      return did(args.decision === 'APPROVE' ? 'report_card_approved' : 'report_card_returned', c, `${cardSpeak(c)}.`);
    },
  }),

  list_term_report_card_versions: tool({
    module: 'Report cards', operation: 'GET', feature: 'reportCards',
    description: "For staff: the published versions of one pupil's term report card, with when each was published, which were replaced and the correction notes. Read-only.",
    inputSchema: closed(cardIdent),
    permission: 'reportcards.manage',
    service: 'reportcards.service.list() + versionsOf()',
    async run(ctx, args) {
      const card = await cardOf(ctx, args);
      const rows = await reportcards.versionsOf(ctx.actor, ctx.scope, card.id);
      return listed(rows, (v) => `version ${v.version}${v.supersededAt ? ' (replaced)' : ''}${v.correctionNote ? `: ${excerpt(v.correctionNote, 60)}` : ''}`, { noun: 'version', speak: rows.length ? `${card.studentName}'s ${card.termName} card: ${rows.length} published version(s); latest is version ${rows[0].version}.` : `${card.studentName}'s ${card.termName} card has not been published.` });
    },
  }),
};

/* ── Support plans ────────────────────────────────────────── */

async function supportPlanOf(ctx, args, { status = 'ALL' } = {}) {
  const studentId = (args.studentId || args.admissionNo || args.studentName) ? await resolveStudentId(ctx, args) : null;
  const out = await support.list(ctx.actor, ctx.scope, { status, ...(studentId && { studentId }), ...(args.concernArea && { concernArea: args.concernArea }) });
  const rows = rowsOf(out);
  return pick(rows, args.plan, { label: 'support plan', nameOf: (p) => p.studentName, refOf: (p) => p.refNo, describe: (p) => `${p.refNo} ${p.studentName} (${p.areaLabel ?? words(p.concernArea)}, ${words(p.status)})` });
}
const planPick = { ...studentIdentitySchema, plan: text(40, 'The plan reference, e.g. "SSP-0003"'), concernArea: oneOf(CONCERN_AREAS) };

const GOAL = closed({
  title: text(200), measure: text(200, 'How progress is measured, e.g. "attendance %"'), unit: text(20), baseline: num(-100000, 100000), target: num(-100000, 100000),
  direction: oneOf(['UP', 'DOWN'], 'Whether higher (UP) or lower (DOWN) is better'), reviewOn: dateStr('YYYY-MM-DD'),
}, ['title', 'measure', 'target', 'reviewOn']);
const ACTION = closed({ title: text(300), ownerKind: oneOf(ACTION_OWNER_KINDS), owner: text(80, 'The member of staff who owns it (a staff action)'), dueOn: dateStr('YYYY-MM-DD') }, ['title']);

async function actionBody(a) {
  const kind = a.ownerKind ?? 'STAFF';
  if (kind !== 'STAFF') return { title: a.title, ownerKind: kind, dueOn: a.dueOn };
  if (!a.owner) throw ask(`Who on the staff owns "${a.title}"?`);
  const s = await staffNamed(a.owner, 'action owner');
  return { title: a.title, ownerKind: kind, ownerProfileId: s.id, dueOn: a.dueOn, ownerLabel: s.name };
}
const stripLabel = ({ ownerLabel, ...rest }) => rest;
const planSpeak = (p) => `${p.refNo} for ${p.studentName} (${p.areaLabel ?? words(p.concernArea)}), ${words(p.status)}`;
const goalOf = (plan, term) => pick(plan.goals, term, { label: 'goal in this plan', nameOf: (g) => g.title, refOf: () => '', describe: (g) => g.title });

const supportTools = {
  list_support_plans: tool({
    module: 'Support plans', operation: 'GET', feature: 'supportPlans',
    description: "Student support plans: for staff, the plans for pupils they teach or own (default active) with goals, next review and overdue reviews; for a parent or student, the plans the school has shared about their own child (summary, goals, agreed actions, review notes). Read-only.",
    inputSchema: closed({ ...studentIdentitySchema, status: oneOf(['ACTIVE', 'CLOSED', 'ALL']), concernArea: oneOf(CONCERN_AREAS) }),
    permission: 'supportplans.read',
    service: 'support.service.list() / familyPlans()',
    async run(ctx, args) {
      const family = ['PARENT', 'STUDENT'].includes(ctx.actor.roleKey);
      const studentId = !family && (args.studentId || args.admissionNo || args.studentName) ? await resolveStudentId(ctx, args) : null;
      const out = await support.list(ctx.actor, ctx.scope, { ...(args.status && { status: args.status }), ...(args.concernArea && { concernArea: args.concernArea }), ...(studentId && { studentId }) });
      return listed(out.items, (p) => `${p.refNo} ${p.studentName} (${p.areaLabel}, ${words(p.status)}${p.nextReviewOn ? `, review ${String(p.nextReviewOn).slice(0, 10)}` : ''})`, { noun: 'support plan', extra: out.summary ? { summary: out.summary } : {} });
    },
  }),

  list_support_plan_suggestions: tool({
    module: 'Support plans', operation: 'GET', feature: 'supportPlans',
    description: 'For staff: pupils the rule-based risk signals flag on attendance or marks (medium or high) who have no active support plan, with the evidence. A prompt to look, not a judgement. Read-only.',
    inputSchema: closed({}),
    permission: 'supportplans.manage',
    service: 'support.service.suggestions()',
    async run(ctx) {
      const out = await support.suggestions(ctx.actor, ctx.scope, {});
      return listed(out.items, (s) => `${s.studentName} (${s.className}): ${s.evidence?.label ?? words(s.riskType)}, ${words(s.level)}`, { noun: 'pupil', extra: { note: out.note } });
    },
  }),

  acknowledge_support_plan: tool({
    module: 'Support plans', operation: 'ACTION', risk: RISK.LOW, feature: 'supportPlans',
    description: "For a parent or student: tell the school they have read a support plan it shared about their own child (by reference when there are several), with an optional comment. Needs confirmation.",
    inputSchema: closed({ plan: text(40), comment: text(1000) }),
    permission: 'supportplans.read',
    service: 'support.service.familyPlans() + acknowledge()',
    async prepare(ctx, args) {
      const out = await support.familyPlans(ctx.actor);
      const p = pick(out.items, args.plan, { label: 'shared support plan', nameOf: (x) => x.studentName, refOf: (x) => x.refNo, describe: (x) => `${x.refNo} ${x.studentName} (${x.areaLabel})` });
      return { planId: p.id, ref: p.refNo, student: p.studentName };
    },
    summarise: (a, _actor, p) => `Tell the school you have read ${p?.student ?? 'the'}'s support plan ${p?.ref ?? a.plan ?? ''}${a.comment ? `, with the comment "${excerpt(a.comment, 80)}"` : ''}`,
    async run(ctx, args, p) {
      const out = await support.acknowledge(ctx.actor, p.planId, { comment: args.comment });
      return did('support_plan_acknowledged', out, `Thank you, the school can see you have read ${p.ref}.`);
    },
  }),

  open_support_plan: tool({
    module: 'Support plans', operation: 'CREATE', risk: RISK.MEDIUM, affectsOthers: true, feature: 'supportPlans',
    description: "For staff: open a support plan for a pupil they teach (school-wide: any pupil): concern area, a summary a family can read, measurable goals with review dates, optional actions with owners, and the plan's owner. No diagnoses, medication or clinical detail. Confirmed on the website.",
    inputSchema: closed({
      ...studentIdentitySchema, concernArea: oneOf(CONCERN_AREAS), summary: text(2000, 'What the plan is for, in words a family can read'),
      goals: { type: 'array', minItems: 1, maxItems: 10, items: GOAL }, actions: list(ACTION, 20), owner: text(80, 'The member of staff who owns the plan (default the caller)'), nextReviewOn: dateStr('YYYY-MM-DD'),
    }, ['concernArea', 'summary', 'goals']),
    permission: 'supportplans.manage',
    service: 'support.service.create()',
    async prepare(ctx, args) {
      const studentId = await resolveStudentId(ctx, args);
      if (!studentId) throw ask('Which pupil is the plan for?');
      const actions = [];
      for (const a of args.actions ?? []) actions.push(await actionBody(a)); // eslint-disable-line no-await-in-loop
      const owner = args.owner ? await staffNamed(args.owner, 'plan owner') : null;
      return { studentId, who: args.studentName ?? args.admissionNo ?? 'the pupil', actions, ownerProfileId: owner?.id ?? null, owner: owner?.name ?? null };
    },
    summarise: (a, _actor, p) => `Open a ${words(a.concernArea)} support plan for ${p?.who ?? 'the pupil'} with ${a.goals.length} goal(s) (${a.goals.map((g) => g.title).join(', ')})${p?.actions?.length ? ` and ${p.actions.length} action(s)` : ''}${p?.owner ? `, owned by ${p.owner}` : ''}`,
    async run(ctx, args, p) {
      const out = await support.create(ctx.actor, ctx.scope, { studentId: p.studentId, concernArea: args.concernArea, summary: args.summary, goals: args.goals, actions: p.actions.map(stripLabel), ...(p.ownerProfileId && { ownerProfileId: p.ownerProfileId }), ...(args.nextReviewOn && { nextReviewOn: args.nextReviewOn }) });
      return did('support_plan_opened', out, `Opened ${planSpeak(out)}; first review ${String(out.nextReviewOn ?? '').slice(0, 10)}.`);
    },
  }),

  get_support_plan: tool({
    module: 'Support plans', operation: 'GET', feature: 'supportPlans',
    description: "For staff: one support plan in full (by pupil or reference): summary, goals with progress, actions and owners, reviews, internal notes, family sharing, and the pupil's current attendance and marks. Read-only.",
    inputSchema: closed(planPick),
    permission: 'supportplans.read',
    service: 'support.service.list() + get()',
    async run(ctx, args) {
      const p = await support.get(ctx.actor, ctx.scope, (await supportPlanOf(ctx, args)).id);
      return shown(p, `${planSpeak(p)}: ${p.goals.map((g) => `${g.title} (${words(g.status)}${g.latest ? `, latest ${g.latest.value}` : ''})`).join('; ')}. ${p.actions.filter((a) => a.status === 'OPEN').length} open action(s)${p.reviewOverdue ? '; the review is overdue' : ''}.`);
    },
  }),

  update_support_plan: tool({
    module: 'Support plans', operation: 'UPDATE', risk: RISK.MEDIUM, affectsOthers: true, feature: 'supportPlans',
    description: "For staff: change an active support plan's summary, next review date or owner. Confirmed on the website.",
    inputSchema: closed({ ...planPick, summary: text(2000), nextReviewOn: dateStr('YYYY-MM-DD'), owner: text(80) }),
    permission: 'supportplans.manage',
    service: 'support.service.list() + update()',
    async prepare(ctx, args) {
      if (!args.summary && !args.nextReviewOn && !args.owner) throw ask('What should change: the summary, the next review date or the owner?');
      const p = await supportPlanOf(ctx, args, { status: 'ACTIVE' });
      const owner = args.owner ? await staffNamed(args.owner, 'plan owner') : null;
      return { planId: p.id, label: planSpeak(p), ownerProfileId: owner?.id ?? null, owner: owner?.name ?? null };
    },
    summarise: (a, _actor, p) => `Change ${p?.label ?? 'the support plan'}: ${[a.summary && 'the summary', a.nextReviewOn && `next review ${a.nextReviewOn}`, p?.owner && `owner ${p.owner}`].filter(Boolean).join(', ')}`,
    async run(ctx, args, p) {
      const out = await support.update(ctx.actor, ctx.scope, p.planId, { ...(args.summary && { summary: args.summary }), ...(args.nextReviewOn && { nextReviewOn: args.nextReviewOn }), ...(p.ownerProfileId && { ownerProfileId: p.ownerProfileId }) });
      return did('support_plan_updated', out, `Saved ${planSpeak(out)}.`);
    },
  }),

  add_support_plan_goal: tool({
    module: 'Support plans', operation: 'CREATE', risk: RISK.MEDIUM, affectsOthers: true, feature: 'supportPlans',
    description: 'For staff: add a measurable goal (title, how it is measured, baseline, target, direction, review date) to an active support plan. Confirmed on the website.',
    inputSchema: closed({ ...planPick, goal: GOAL }, ['goal']),
    permission: 'supportplans.manage',
    service: 'support.service.list() + addGoal()',
    async prepare(ctx, args) { const p = await supportPlanOf(ctx, args, { status: 'ACTIVE' }); return { planId: p.id, label: planSpeak(p) }; },
    summarise: (a, _actor, p) => `Add the goal "${a.goal.title}" (target ${a.goal.target}${a.goal.unit ? ` ${a.goal.unit}` : ''}, review ${a.goal.reviewOn}) to ${p?.label ?? 'the support plan'}`,
    async run(ctx, args, p) {
      const out = await support.addGoal(ctx.actor, ctx.scope, p.planId, args.goal);
      return did('support_plan_goal_added', out, `Added "${args.goal.title}" to ${out.refNo}.`);
    },
  }),

  record_support_plan_progress: tool({
    module: 'Support plans', operation: 'UPDATE', risk: RISK.MEDIUM, affectsOthers: true, feature: 'supportPlans',
    description: "For staff: record progress on one goal of an active support plan: the measured value, a note, and optionally the goal's status (open, on track, at risk, met, not met). Confirmed on the website.",
    inputSchema: closed({ ...planPick, goal: text(200, 'The goal title'), value: num(-100000, 100000), note: text(1000), status: oneOf(GOAL_STATUSES) }, ['goal']),
    permission: 'supportplans.manage',
    service: 'support.service.get() + recordProgress()',
    async prepare(ctx, args) {
      if (args.value === undefined && !args.note && !args.status) throw ask('What progress: a measured value, a note or a status?');
      const plan = await support.get(ctx.actor, ctx.scope, (await supportPlanOf(ctx, args, { status: 'ACTIVE' })).id);
      const g = goalOf(plan, args.goal);
      return { planId: plan.id, goalId: g.id, goal: g.title, label: planSpeak(plan) };
    },
    summarise: (a, _actor, p) => `Record on "${p?.goal ?? a.goal}" (${p?.label ?? ''})${a.value !== undefined ? `: ${a.value}` : ''}${a.status ? `, status ${words(a.status)}` : ''}${a.note ? ` — ${excerpt(a.note, 80)}` : ''}`,
    async run(ctx, args, p) {
      const out = await support.recordProgress(ctx.actor, ctx.scope, p.planId, p.goalId, { value: args.value, note: args.note, status: args.status });
      const g = out.goals.find((x) => x.id === p.goalId);
      return did('support_plan_progress_recorded', out, `Recorded on "${p.goal}"; it is ${words(g?.status ?? '')}.`);
    },
  }),

  add_support_plan_action: tool({
    module: 'Support plans', operation: 'CREATE', risk: RISK.MEDIUM, affectsOthers: true, feature: 'supportPlans',
    description: 'For staff: add an action to an active support plan, owned by a named member of staff (it becomes their task and they are told), the family or the student, with a due date. Confirmed on the website.',
    inputSchema: closed({ ...planPick, action: ACTION }, ['action']),
    permission: 'supportplans.manage',
    service: 'support.service.list() + addAction()',
    async prepare(ctx, args) {
      const p = await supportPlanOf(ctx, args, { status: 'ACTIVE' });
      return { planId: p.id, label: planSpeak(p), body: await actionBody(args.action) };
    },
    summarise: (a, _actor, p) => `Add the action "${a.action.title}" for ${p?.body?.ownerLabel ?? words(a.action.ownerKind ?? 'STAFF')}${a.action.dueOn ? ` by ${a.action.dueOn}` : ''} to ${p?.label ?? 'the support plan'}`,
    async run(ctx, _args, p) {
      const out = await support.addAction(ctx.actor, ctx.scope, p.planId, stripLabel(p.body));
      return did('support_plan_action_added', out, `Added "${p.body.title}" to ${out.refNo}.`);
    },
  }),

  complete_support_plan_action: tool({
    module: 'Support plans', operation: 'UPDATE', risk: RISK.MEDIUM, affectsOthers: true, feature: 'supportPlans',
    description: "For staff: mark an open action of a support plan done (or cancelled), with a note. Confirmed on the website.",
    inputSchema: closed({ ...planPick, action: text(300, 'The action title'), cancel: bool('Cancel it instead of marking it done'), note: text(1000) }, ['action']),
    permission: 'supportplans.manage',
    service: 'support.service.get() + completeAction()',
    async prepare(ctx, args) {
      const plan = await support.get(ctx.actor, ctx.scope, (await supportPlanOf(ctx, args)).id);
      const a = pick(plan.actions.filter((x) => x.status === 'OPEN'), args.action, { label: 'open action in this plan', nameOf: (x) => x.title, refOf: () => '', describe: (x) => x.title });
      return { planId: plan.id, actionId: a.id, action: a.title, label: planSpeak(plan) };
    },
    summarise: (a, _actor, p) => `${a.cancel ? 'Cancel' : 'Mark done'} the action "${p?.action ?? a.action}" of ${p?.label ?? 'the support plan'}${a.note ? ` — ${excerpt(a.note, 80)}` : ''}`,
    async run(ctx, args, p) {
      const out = await support.completeAction(ctx.actor, ctx.scope, p.planId, p.actionId, { cancel: args.cancel === true, note: args.note });
      return did('support_plan_action_completed', out, `"${p.action}" is ${args.cancel ? 'cancelled' : 'done'}.`);
    },
  }),

  add_support_plan_note: tool({
    module: 'Support plans', operation: 'CREATE', risk: RISK.LOW, affectsOthers: true, feature: 'supportPlans',
    description: 'For staff: add an internal note to a support plan (never shown to the family; no clinical detail). Confirmed on the website.',
    inputSchema: closed({ ...planPick, note: { type: 'string', minLength: 1, maxLength: 4000 } }, ['note']),
    permission: 'supportplans.manage',
    service: 'support.service.list() + addNote()',
    async prepare(ctx, args) { const p = await supportPlanOf(ctx, args); return { planId: p.id, label: planSpeak(p) }; },
    summarise: (a, _actor, p) => `Add an internal note to ${p?.label ?? 'the support plan'}: "${excerpt(a.note, 100)}"`,
    async run(ctx, args, p) {
      const out = await support.addNote(ctx.actor, ctx.scope, p.planId, { text: args.note });
      return did('support_plan_note_added', out, `Note added to ${out.refNo}.`);
    },
  }),

  record_support_plan_review: tool({
    module: 'Support plans', operation: 'CREATE', risk: RISK.MEDIUM, affectsOthers: true, feature: 'supportPlans',
    description: "For staff: record a progress review of an active support plan: a summary written for the family (they are told when the plan is shared), an optional internal note, each goal's status, and the next review date. Confirmed on the website.",
    inputSchema: closed({
      ...planPick, familySummary: text(2000, 'What you would tell the family'), internalNote: text(4000),
      goalStatuses: list(closed({ goal: text(200), status: oneOf(GOAL_STATUSES) }, ['goal', 'status']), 10), nextReviewOn: dateStr('YYYY-MM-DD'),
    }, ['familySummary']),
    permission: 'supportplans.manage',
    service: 'support.service.get() + addReview()',
    async prepare(ctx, args) {
      const plan = await support.get(ctx.actor, ctx.scope, (await supportPlanOf(ctx, args, { status: 'ACTIVE' })).id);
      const goalStatuses = (args.goalStatuses ?? []).map((g) => { const goal = goalOf(plan, g.goal); return { goalId: goal.id, status: g.status, title: goal.title }; });
      return { planId: plan.id, label: planSpeak(plan), goalStatuses, shared: Boolean(plan.family?.sharedAt) };
    },
    summarise: (a, _actor, p) => `Record a review of ${p?.label ?? 'the support plan'}: "${excerpt(a.familySummary, 80)}"${p?.goalStatuses?.length ? `; ${p.goalStatuses.map((g) => `${g.title} ${words(g.status)}`).join(', ')}` : ''}${a.nextReviewOn ? `; next review ${a.nextReviewOn}` : ''}${p?.shared ? ' (the family is told)' : ''}`,
    async run(ctx, args, p) {
      const out = await support.addReview(ctx.actor, ctx.scope, p.planId, { familySummary: args.familySummary, internalNote: args.internalNote, goalStatuses: p.goalStatuses.map(({ goalId, status }) => ({ goalId, status })), nextReviewOn: args.nextReviewOn });
      return did('support_plan_reviewed', out, `Review recorded on ${out.refNo}${out.nextReviewOn ? `; next review ${String(out.nextReviewOn).slice(0, 10)}` : ''}.`);
    },
  }),

  share_support_plan_with_family: tool({
    module: 'Support plans', operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true, feature: 'supportPlans',
    description: "For staff: share a support plan's summary and goals with the pupil's guardians (and the student), who are told by message. Internal notes are never shared. Confirmed on the website.",
    inputSchema: closed(planPick),
    permission: 'supportplans.manage',
    service: 'support.service.list() + share()',
    async prepare(ctx, args) { const p = await supportPlanOf(ctx, args); return { planId: p.id, label: planSpeak(p), student: p.studentName }; },
    summarise: (a, _actor, p) => `Share ${p?.label ?? 'the support plan'} (summary and goals) with ${p?.student ?? 'the pupil'}'s family and send them a message`,
    async run(ctx, _args, p) {
      const out = await support.share(ctx.actor, ctx.scope, p.planId);
      return did('support_plan_shared', out, `${out.refNo} is shared with ${p.student}'s family.`);
    },
  }),

  transition_support_plan: tool({
    module: 'Support plans', operation: 'ACTION', risk: RISK.MEDIUM, affectsOthers: true, feature: 'supportPlans',
    description: "For staff: close a support plan with its outcome and what changed (step CLOSE; open actions are cancelled), or reopen a closed one with a new review date (step REOPEN). Confirmed on the website.",
    inputSchema: closed({
      ...planPick, step: oneOf(['CLOSE', 'REOPEN']), outcome: oneOf(PLAN_OUTCOMES, 'For CLOSE'), note: text(2000, 'For CLOSE: what changed and why it is closing'),
      nextReviewOn: dateStr('For REOPEN: the next review date'), reason: text(500, 'For REOPEN: why'),
    }, ['step']),
    permission: 'supportplans.manage',
    service: 'support.service.list() + close() / reopen()',
    async prepare(ctx, args) {
      if (args.step === 'CLOSE' && (!args.outcome || !args.note)) throw ask('What is the outcome, and what changed?');
      if (args.step === 'REOPEN' && !args.nextReviewOn) throw ask('When is the next review?');
      const p = await supportPlanOf(ctx, args, { status: args.step === 'CLOSE' ? 'ACTIVE' : 'CLOSED' });
      return { planId: p.id, label: planSpeak(p) };
    },
    summarise: (a, _actor, p) => (a.step === 'CLOSE' ? `Close ${p?.label ?? 'the support plan'} as ${words(a.outcome ?? '')}: ${excerpt(a.note, 80)}` : `Reopen ${p?.label ?? 'the support plan'} with the next review on ${a.nextReviewOn}${a.reason ? ` (${excerpt(a.reason, 60)})` : ''}`),
    async run(ctx, args, p) {
      const out = args.step === 'CLOSE'
        ? await support.close(ctx.actor, ctx.scope, p.planId, { outcome: args.outcome, note: args.note })
        : await support.reopen(ctx.actor, ctx.scope, p.planId, { nextReviewOn: args.nextReviewOn, reason: args.reason });
      return did(args.step === 'CLOSE' ? 'support_plan_closed' : 'support_plan_reopened', out, `${planSpeak(out)}.`);
    },
  }),
};

/* ── Portfolios ───────────────────────────────────────────── */

const COMPETENCIES = portfolios.FRAMEWORK.map((c) => c.key);
async function portfolioStudent(ctx, args) {
  const studentId = await resolveStudentId(ctx, args);
  if (!studentId) throw ask('Whose portfolio? Give the pupil\'s name or admission number.');
  return studentId;
}

const portfolioTools = {
  get_portfolio_framework: tool({
    module: 'Portfolios', operation: 'GET', feature: 'portfolios',
    description: 'The competency framework portfolios use (communication, critical thinking, collaboration, creativity, digital literacy, life skills and the subject competencies) and the three rubric levels. Read-only.',
    inputSchema: closed({}),
    permission: 'portfolios.read',
    service: 'portfolios.service.framework()',
    async run() {
      const f = portfolios.framework();
      return listed(f.competencies, (c) => `${c.label} (${c.group})`, { noun: 'competency', extra: { levels: f.levels } });
    },
  }),

  list_portfolio_students: tool({
    module: 'Portfolios', operation: 'GET', feature: 'portfolios',
    description: "The pupils whose competency portfolios the caller can open: a teacher's own classes, school-wide staff a class or the school, a parent their children, a student themselves. Read-only.",
    inputSchema: closed({ ...classIdentitySchema, search: text(80) }),
    permission: 'portfolios.read',
    service: 'portfolios.service.students()',
    async run(ctx, args) {
      const section = args.className ? await sectionOf(ctx, args.className) : null;
      const rows = await portfolios.students(ctx.actor, ctx.scope, { ...(section && { sectionId: section.sectionId }), ...(args.search && { search: args.search }) });
      return listed(rows, (s) => `${s.name} (${s.className ?? 'no class'})`, { noun: 'pupil' });
    },
  }),

  get_student_portfolio: tool({
    module: 'Portfolios', operation: 'GET', feature: 'portfolios',
    description: "One pupil's competency portfolio: for each competency the latest rubric level and comment, the evidence from school records and teachers, and the pupil's reflections. Parents and students see only their own. Read-only.",
    inputSchema: closed({ ...studentIdentitySchema }),
    permission: 'portfolios.read',
    service: 'portfolios.service.portfolio()',
    async run(ctx, args) {
      const p = await portfolios.portfolio(ctx.actor, ctx.scope, await portfolioStudent(ctx, args));
      return shown(p, `${p.student.name}'s portfolio (${p.term}): ${p.counts.evidence} piece(s) of evidence, ${p.counts.rated} competencies rated, ${p.counts.reflections} reflection(s). ${p.competencies.filter((c) => c.rating).map((c) => `${c.label}: ${c.rating.levelLabel}`).join('; ')}`);
    },
  }),

  add_portfolio_evidence: tool({
    module: 'Portfolios', operation: 'CREATE', risk: RISK.LOW, affectsOthers: true, feature: 'portfolios',
    description: "For a teacher: add evidence to a pupil's competency portfolio under a competency: title, description, date and an optional https link (files are attached on the Portfolios page). Confirmed on the website.",
    inputSchema: closed({ ...studentIdentitySchema, competency: oneOf(COMPETENCIES), title: { type: 'string', minLength: 1, maxLength: 200 }, description: text(2000), on: dateStr('YYYY-MM-DD'), link: text(500, 'https:// link') }, ['competency', 'title']),
    permission: 'portfolios.manage',
    service: 'portfolios.service.addEvidence()',
    async prepare(ctx, args) { return { studentId: await portfolioStudent(ctx, args), who: args.studentName ?? args.admissionNo ?? 'the pupil' }; },
    summarise: (a, _actor, p) => `Add the evidence "${a.title}" under ${words(a.competency)} to ${p?.who ?? 'the pupil'}'s portfolio`,
    async run(ctx, args, p) {
      const e = await portfolios.addEvidence(ctx.actor, ctx.scope, p.studentId, { competencyKey: args.competency, title: args.title, description: args.description, on: args.on, link: args.link });
      return did('portfolio_evidence_added', e, `Added "${e.title}" under ${words(e.competencyKey)}.`);
    },
  }),

  remove_portfolio_evidence: tool({
    module: 'Portfolios', operation: 'DELETE', risk: RISK.LOW, affectsOthers: true, feature: 'portfolios',
    description: "For the teacher who added it (or the principal): remove a piece of teacher-added evidence from a pupil's portfolio (by its title). Evidence from school records cannot be removed. Confirmed on the website.",
    inputSchema: closed({ ...studentIdentitySchema, title: text(200) }, ['title']),
    permission: 'portfolios.manage',
    service: 'portfolios.service.portfolio() + removeEvidence()',
    async prepare(ctx, args) {
      const studentId = await portfolioStudent(ctx, args);
      const p = await portfolios.portfolio(ctx.actor, ctx.scope, studentId);
      const pool = p.competencies.flatMap((c) => c.evidence.filter((e) => e.kind === 'TEACHER').map((e) => ({ ...e, competency: c.label })));
      const e = pick(pool, args.title, { label: 'teacher evidence', nameOf: (x) => x.title, refOf: () => '', describe: (x) => `${x.title} (${x.competency})` });
      return { studentId, evidenceId: e.id, title: e.title, who: p.student.name };
    },
    summarise: (a, _actor, p) => `Remove the evidence "${p?.title ?? a.title}" from ${p?.who ?? 'the pupil'}'s portfolio`,
    async run(ctx, _args, p) {
      await portfolios.removeEvidence(ctx.actor, ctx.scope, p.studentId, p.evidenceId);
      return did('portfolio_evidence_removed', { id: p.evidenceId }, `Removed "${p.title}".`);
    },
  }),

  set_portfolio_rating: tool({
    module: 'Portfolios', operation: 'UPDATE', risk: RISK.LOW, affectsOthers: true, feature: 'portfolios',
    description: "For a teacher: rate one competency in a pupil's portfolio on the three-level rubric (developing, proficient, advanced) for a term, with a comment. No scores and nothing about behaviour. Confirmed on the website.",
    inputSchema: closed({ ...studentIdentitySchema, competency: oneOf(COMPETENCIES), level: oneOf(RUBRIC_LEVELS), comment: text(1000), term: text(40, 'Default the current year') }, ['competency', 'level']),
    permission: 'portfolios.manage',
    service: 'portfolios.service.rate()',
    async prepare(ctx, args) { return { studentId: await portfolioStudent(ctx, args), who: args.studentName ?? args.admissionNo ?? 'the pupil' }; },
    summarise: (a, _actor, p) => `Rate ${p?.who ?? 'the pupil'}'s ${words(a.competency)} as ${words(a.level)}${a.term ? ` for ${a.term}` : ''}${a.comment ? `: "${excerpt(a.comment, 80)}"` : ''}`,
    async run(ctx, args, p) {
      const r = await portfolios.rate(ctx.actor, ctx.scope, p.studentId, { competencyKey: args.competency, level: args.level, comment: args.comment, term: args.term });
      return did('portfolio_rating_saved', r, `Saved: ${words(r.competencyKey)} ${r.levelLabel}.`);
    },
  }),
};

/* ── Syllabus plan ────────────────────────────────────────── */

const syllabusTools = {
  get_syllabus_plan: tool({
    module: 'Syllabus', operation: 'GET',
    description: "One class-and-subject's syllabus plan: every module (chapter) with its planned dates, topics done and to do, pace, and the latest lessons recorded. A teacher sees their subjects, a parent or student their own class's, the principal any. Read-only.",
    inputSchema: closed({ ...classSubject }, ['subject']),
    permission: 'syllabus.read',
    service: 'syllabus.service.overview() + plan()',
    async run(ctx, args) {
      const rows = (await syllabus.overview(ctx.actor, {})).rows;
      const want = subjectWord(args.subject);
      let pool = rows.filter((r) => lower(r.subject) === want || lower(r.subject).includes(want) || want.includes(lower(r.subject)));
      if (args.className) pool = pool.filter((r) => classKey(r.class) === classKey(args.className) || classKey(r.class).startsWith(`${classKey(args.className)} `));
      const row = pick(pool, '', { label: `${args.subject} syllabus${args.className ? ` in ${args.className}` : ''}`, describe: (r) => `${r.class} ${r.subject}` });
      const p = await syllabus.plan(ctx.actor, row.subjectOfferingId);
      return shown(p, `${p.class} ${p.subject}${p.teacher ? ` (${p.teacher})` : ''}: ${p.modulesDone} of ${p.modulesTotal} module(s) done${p.coveragePct !== null ? `, ${p.coveragePct}% of topics` : ''}, ${words(p.health)}. ${p.modules.map((m) => `${m.title} (${words(m.status)})`).join('; ')}`);
    },
  }),
};

export const tools = {
  ...enrolmentShiftTools,
  ...attendanceDraftTools,
  ...quizTools,
  ...announcementTools,
  ...lectureTools,
  ...lessonPlanTools,
  ...bankTools,
  ...cpdTools,
  ...reportCardTools,
  ...supportTools,
  ...portfolioTools,
  ...syllabusTools,
};

