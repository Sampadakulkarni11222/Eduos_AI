import * as docRequests from '../../../documentRequests/documentRequest.service.js';
import * as docTypes from '../../../documentRequests/documentType.service.js';
import * as assignments from '../../../assignments/assignment.service.js';
import * as quizzes from '../../../quizzes/quiz.service.js';
import * as syllabus from '../../../syllabus/syllabus.service.js';
import * as lectures from '../../../lectures/lecture.service.js';
import * as facilities from '../../../administration/facility.service.js';
import * as procurement from '../../../finance-ops/procurement.service.js';
import { getGuardianStudentIds } from '../../../../utils/scope.js';
import { Student } from '../../../../models/student.model.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import {
  RISK, dateStr, noArgs, summarise, shortDate, theNamed, resolveSection, classIdentitySchema,
} from './_shared.js';

/**
 * Everyday actions from the older modules that had a screen and no assistant
 * capability (see docs/erp-operations/MCP-AUTOMATION-GAPS.md):
 *
 *   certificates   a student or parent lists, requests and cancels a
 *                  certificate (bonafide, transfer, character ...). Issuing one
 *                  stays with the office.
 *   homework       a teacher changes or withdraws homework they set.
 *   quizzes        a student's quizzes and results; a teacher's quizzes.
 *   syllabus       a teacher records what was taught in a lesson.
 *   online classes a teacher schedules or cancels an online class for a class
 *                  they teach.
 *   facilities     anyone on staff reports a repair, sees their own reports,
 *                  and asks to book a room or hall (the manager confirms it).
 *   purchasing     a member of staff drafts a purchase request. Submitting it
 *                  for approval and every approval stay on the screen.
 *
 * Same contract as every other tool file: the module's own service with the
 * caller's actor and scope, names resolved from the caller's own lists, and
 * every write proposed, summarised and run only on the same person's "yes".
 */

const rowsOf = (out) => (Array.isArray(out) ? out : out?.items ?? []);
const clean = (s) => String(s ?? '').trim().toLowerCase();
const excerpt = (s, n = 100) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}…` : t; };
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

function clockOf(raw, label = 'time') {
  const m = String(raw ?? '').trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  let h = m ? Number(m[1]) : NaN;
  const min = m ? Number(m[2] ?? 0) : NaN;
  if (m?.[3] === 'pm' && h < 12) h += 12;
  if (m?.[3] === 'am' && h === 12) h = 0;
  if (!m || h > 23 || min > 59) throw new AppError(`Give the ${label} as a clock time, e.g. 10:30 or 2:15 pm.`, 400, [], 'AGENT_NEEDS_INPUT');
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
/** A school-local date and time as an instant (the school runs on India time). */
const instant = (date, time) => `${date}T${time}:00+05:30`;

const FAMILY = ['STUDENT', 'PARENT'];
function familyOnly(ctx, what) {
  if (!FAMILY.includes(ctx.actor?.roleKey)) throw new AppError(`${what} is for students and parents; the office handles certificates on the Document requests page.`, 403, [], 'ROLE_NOT_PERMITTED');
}

/** A parent's child by name (or their only child); a student is always themselves. */
async function familyChildId(ctx, studentName) {
  if (ctx.actor.roleKey !== 'PARENT') return null;
  const ids = (await getGuardianStudentIds(ctx.actor.profileId)).map(String);
  const kids = await Student.find({ _id: { $in: ids }, deletedAt: null }).select('firstName lastName').lean();
  const named = kids.map((k) => ({ id: String(k._id), name: `${k.firstName ?? ''} ${k.lastName ?? ''}`.trim() }));
  if (studentName) return theNamed(named, studentName, { label: 'child of yours', nameOf: (k) => k.name, describe: (k) => k.name }).id;
  if (named.length === 1) return named[0].id;
  throw new AppError(`Which child — ${named.map((k) => k.name).join(', ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
}

/* ── Certificates ─────────────────────────────────────────── */

const certificateTools = {
  list_certificate_types: {
    module: 'Certificates',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'The certificates and documents a student or parent can request from the school office (bonafide, transfer, character certificate and so on), with what each needs. Read-only.',
    inputSchema: noArgs,
    permission: 'students.read',
    forRoles: ['STUDENT', 'PARENT'],
    service: 'documentType.service.listRequestable()',
    async run(ctx) {
      familyOnly(ctx, 'Requesting a certificate');
      const rows = (await docTypes.listRequestable()).map((t) => ({ name: t.name, description: t.description, needs: t.fields.filter((f) => f.required).map((f) => f.label) }));
      return ok({ types: rows, count: rows.length }, { speak: rows.length ? `You can request: ${rows.map((r) => r.name).join(', ')}.` : 'The school has not opened any certificate for requests yet.' });
    },
  },

  get_my_certificate_requests: {
    module: 'Certificates',
    operation: 'GET',
    risk: RISK.LOW,
    description: "A student's own, or a parent's children's, certificate requests and where each stands (pending, in review, approved, issued, rejected, cancelled). Read-only.",
    inputSchema: noArgs,
    permission: 'students.read',
    forRoles: ['STUDENT', 'PARENT'],
    service: 'documentRequest.service.listMine()',
    async run(ctx) {
      familyOnly(ctx, 'Certificate requests');
      const rows = (await docRequests.listMine(ctx.actor, {})).map((r) => ({
        document: r.documentTypeName ?? r.documentType ?? null, child: r.studentName ?? null, status: r.status, purpose: r.purpose ?? null,
        requestedAt: r.createdAt ?? null, requiredBy: r.requiredBy ?? null, reason: r.rejectionReason ?? null,
      }));
      const view = summarise(rows, (r) => `${r.document}${r.child ? ` for ${r.child}` : ''} (${String(r.status).toLowerCase().replace(/_/g, ' ')})`);
      return ok({ requests: rows, count: rows.length }, { speak: rows.length ? `${rows.length} request(s): ${view.list}.` : 'You have no certificate requests.' });
    },
  },

  request_certificate: {
    module: 'Certificates',
    operation: 'CREATE',
    risk: RISK.LOW,
    confirm: true,
    description: 'For a student or parent: ask the school office for a certificate (bonafide, transfer, character certificate ...) with the purpose it is for. The office reviews and issues it. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        document: { type: 'string', maxLength: 120, description: 'Which certificate, e.g. "Bonafide certificate"' },
        purpose: { type: 'string', minLength: 1, maxLength: 500 },
        studentName: { type: 'string', maxLength: 80, description: 'For a parent with several children' },
        requiredBy: dateStr('When it is needed by'),
        additionalInformation: { type: 'string', maxLength: 2000 },
      },
      required: ['document', 'purpose'],
      additionalProperties: false,
    },
    permission: 'students.read',
    forRoles: ['STUDENT', 'PARENT'],
    service: 'documentType.service.listRequestable() + documentRequest.service.createRequest()',
    summarise: (a, _actor, p) => `Request a ${p.type} for "${excerpt(a.purpose, 80)}"${a.requiredBy ? `, needed by ${a.requiredBy}` : ''}`,
    async prepare(ctx, args) {
      familyOnly(ctx, 'Requesting a certificate');
      const types = await docTypes.listRequestable();
      const type = theNamed(types, args.document, { label: 'certificate', nameOf: (t) => t.name, describe: (t) => t.name });
      const missing = type.fields.filter((f) => f.required);
      if (missing.length) throw new AppError(`A ${type.name} needs details only the form takes (${missing.map((f) => f.label).join(', ')}). Request it on the Documents page.`, 400, [], 'FORM_FIELDS_REQUIRED');
      return { typeId: type.id, type: type.name, studentId: await familyChildId(ctx, args.studentName) };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const r = await docRequests.createRequest(ctx.actor, {
        documentTypeId: plan.typeId, purpose: args.purpose, requiredBy: args.requiredBy, additionalInformation: args.additionalInformation, ...(plan.studentId && { studentId: plan.studentId }),
      });
      return action({ type: 'certificate_requested', id: r.id, data: { document: plan.type, status: r.status }, speak: `Your ${plan.type} request has been sent to the school office.` });
    },
  },

  cancel_certificate_request: {
    module: 'Certificates',
    operation: 'DELETE',
    risk: RISK.LOW,
    confirm: true,
    description: 'Cancel one of the caller\'s own certificate requests that the office has not started on yet. Needs confirmation.',
    inputSchema: { type: 'object', properties: { document: { type: 'string', maxLength: 120 } }, additionalProperties: false },
    permission: 'students.read',
    forRoles: ['STUDENT', 'PARENT'],
    service: 'documentRequest.service.listMine() + cancelMine()',
    summarise: (_a, _actor, p) => `Cancel the ${p.document} request${p.child ? ` for ${p.child}` : ''}`,
    async prepare(ctx, args) {
      familyOnly(ctx, 'Certificate requests');
      const open = (await docRequests.listMine(ctx.actor, {})).filter((r) => r.status === 'PENDING');
      const pool = args.document ? open.filter((r) => clean(r.documentTypeName).includes(clean(args.document))) : open;
      if (!pool.length) throw new AppError('No pending certificate request matches that.', 404, [], 'NOT_FOUND');
      if (pool.length > 1) throw new AppError(`Which request — ${pool.map((r) => `${r.documentTypeName}${r.studentName ? ` for ${r.studentName}` : ''}`).join('; ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
      return { requestId: pool[0].id, document: pool[0].documentTypeName, child: pool[0].studentName ?? null };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      await docRequests.cancelMine(ctx.actor, plan.requestId);
      return action({ type: 'certificate_request_cancelled', id: plan.requestId, data: { document: plan.document }, speak: `Cancelled the ${plan.document} request.` });
    },
  },
};

/* ── Homework, quizzes, syllabus ──────────────────────────── */

/** One piece of homework the caller set, by its title (and class). */
async function myHomework(ctx, { homework, className }) {
  let rows = rowsOf(await assignments.list(ctx.actor, ctx.scope, {}));
  if (className) {
    const section = await resolveSection(ctx, { className });
    rows = rows.filter((a) => String(a.sectionId) === section.sectionId);
  }
  const describe = (a) => `"${a.title}" (${a.class}, due ${shortDate(a.dueAt)})`;
  if (!homework) {
    // Nobody named which: one piece of homework is that one; several are asked about.
    if (rows.length === 1) return rows[0];
    if (!rows.length) throw new AppError('You have no homework set that could be changed.', 404, [], 'NOT_FOUND');
    throw new AppError(`Which homework — ${rows.slice(0, 8).map(describe).join('; ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
  }
  return theNamed(rows, homework, { label: 'homework', nameOf: (a) => a.title, describe });
}

const teachingTools = {
  update_assignment: {
    module: 'Assignments',
    operation: 'UPDATE',
    risk: RISK.MEDIUM,
    confirm: true,
    affectsOthers: true,
    description: 'Change homework the caller set: its title, instructions, chapter or due date (to extend a deadline, say). The class sees the change. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        homework: { type: 'string', maxLength: 200, description: 'The title of the homework to change' },
        ...classIdentitySchema,
        title: { type: 'string', maxLength: 200, description: 'The new title' },
        description: { type: 'string', maxLength: 4000 },
        chapter: { type: 'string', maxLength: 200 },
        dueAt: dateStr('The new due date'),
      },
      additionalProperties: false,
    },
    permission: 'assignments.manage',
    service: 'assignment.service.list() + update()',
    summarise: (a, _actor, p) => `Change "${p.title}" (${p.class}): ${[a.title && `title to "${a.title}"`, a.dueAt && `due date to ${a.dueAt}`, a.chapter && `chapter to ${a.chapter}`, a.description && 'the instructions'].filter(Boolean).join(', ')}`,
    async prepare(ctx, args) {
      if (!args.title && !args.description && !args.chapter && !args.dueAt) throw new AppError('What should change: the title, the instructions, the chapter or the due date?', 400, [], 'AGENT_NEEDS_INPUT');
      const a = await myHomework(ctx, args);
      return { assignmentId: String(a.id), title: a.title, class: a.class };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const fields = Object.fromEntries(['title', 'description', 'chapter'].filter((k) => args[k] !== undefined).map((k) => [k, args[k]]));
      if (args.dueAt) fields.dueAt = new Date(`${args.dueAt}T23:59:00+05:30`);
      const a = await assignments.update(ctx.actor, ctx.scope, plan.assignmentId, fields);
      return action({ type: 'assignment_updated', id: plan.assignmentId, data: { title: a.title, dueAt: a.dueAt }, speak: `Updated "${a.title}"${args.dueAt ? `; now due ${args.dueAt}` : ''}.` });
    },
  },

  delete_assignment: {
    module: 'Assignments',
    operation: 'DELETE',
    risk: RISK.MEDIUM,
    confirm: true,
    affectsOthers: true,
    description: 'Withdraw homework the caller set: it leaves every list; work already submitted is kept. Needs confirmation.',
    inputSchema: { type: 'object', properties: { homework: { type: 'string', maxLength: 200 }, ...classIdentitySchema }, additionalProperties: false },
    permission: 'assignments.manage',
    service: 'assignment.service.list() + remove()',
    summarise: (_a, _actor, p) => `Withdraw "${p.title}" (${p.class})`,
    async prepare(ctx, args) {
      const a = await myHomework(ctx, args);
      return { assignmentId: String(a.id), title: a.title, class: a.class };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      await assignments.remove(ctx.actor, ctx.scope, plan.assignmentId);
      return action({ type: 'assignment_withdrawn', id: plan.assignmentId, data: { title: plan.title }, speak: `Withdrawn: "${plan.title}".` });
    },
  },

  list_quizzes: {
    module: 'Quizzes',
    operation: 'GET',
    risk: RISK.LOW,
    description: "Quizzes: for a student, the ones open to them with their own attempt and score; for a teacher, the quizzes they set with how many have attempted. Taking a quiz happens on the Quizzes page. Read-only.",
    inputSchema: noArgs,
    permission: 'assignments.read',
    service: 'quiz.service.list()',
    async run(ctx) {
      const rows = (await quizzes.list(ctx.actor, ctx.scope)).map((q) => ({
        title: q.title, subject: q.subject ?? q.subjectName ?? null, status: q.status ?? null, closesAt: q.closesAt ?? q.dueAt ?? null,
        attempts: q.attemptCount ?? null, myAttempt: q.myAttempt ? { status: q.myAttempt.status ?? null, score: q.myAttempt.score ?? null, maxScore: q.myAttempt.maxScore ?? null } : null,
      }));
      const view = summarise(rows, (q) => `${q.title}${q.myAttempt?.score != null ? ` (${q.myAttempt.score}/${q.myAttempt.maxScore ?? '?'})` : ''}`);
      return ok({ quizzes: rows, count: rows.length }, { speak: rows.length ? `${rows.length} quiz(zes): ${view.list}.` : 'There are no quizzes for you.' });
    },
  },

  get_my_quiz_results: {
    module: 'Quizzes',
    operation: 'GET',
    risk: RISK.LOW,
    description: "A student's own submitted quiz attempts: score, right and wrong answers, subject and when. Read-only.",
    inputSchema: noArgs,
    permission: 'submissions.submit',
    forRoles: ['STUDENT'],
    service: 'quiz.service.myAttempts()',
    async run(ctx) {
      if (ctx.actor.roleKey !== 'STUDENT') throw new AppError('Quiz results are a student\'s own record.', 403, [], 'ROLE_NOT_PERMITTED');
      const rows = (await quizzes.myAttempts(ctx.actor)).map((a) => ({ quiz: a.quizTitle, subject: a.subject, score: a.score ?? null, maxScore: a.maxScore ?? null, correct: a.correctCount, wrong: a.wrongCount, submittedAt: a.submittedAt ?? null }));
      const view = summarise(rows, (a) => `${a.quiz}: ${a.score ?? '—'}/${a.maxScore ?? '—'}`);
      return ok({ results: rows, count: rows.length }, { speak: rows.length ? view.list + '.' : 'You have not submitted any quiz yet.' });
    },
  },

  log_syllabus_progress: {
    module: 'Syllabus',
    operation: 'ACTION',
    risk: RISK.LOW,
    confirm: true,
    description: "For the teacher of a subject: record what was taught in a lesson — the topics covered in the current module (or a named one), a note and any homework given. Updates the class's syllabus progress. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        ...classIdentitySchema,
        subject: { type: 'string', maxLength: 80 },
        module: { type: 'string', maxLength: 200, description: 'Default the module being taught now' },
        topics: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 200 }, description: 'The topics covered' },
        note: { type: 'string', maxLength: 2000 },
        homework: { type: 'string', maxLength: 1000 },
        taughtOn: dateStr('Default today'),
      },
      required: ['subject'],
      additionalProperties: false,
    },
    permission: 'syllabus.manage',
    service: 'syllabus.service.myOfferings() + plan() + recordProgress()',
    summarise: (a, _actor, p) => `Record a ${p.offering} lesson on ${a.taughtOn ?? 'today'} in "${p.module}"${p.topics.length ? `: covered ${p.topics.join(', ')}` : ''}${a.note ? ` — ${excerpt(a.note, 80)}` : ''}`,
    async prepare(ctx, args) {
      if (!args.topics?.length && !args.note && !args.homework) throw new AppError('Which topics did you cover, or what was taught?', 400, [], 'AGENT_NEEDS_INPUT');
      let offerings = await syllabus.myOfferings(ctx.actor);
      if (args.className) {
        const section = await resolveSection(ctx, args);
        offerings = offerings.filter((o) => o.label.toLowerCase().startsWith(section.label.toLowerCase()));
      }
      offerings = offerings.filter((o) => clean(o.label.split('·').pop()) === clean(args.subject) || clean(o.label).includes(clean(args.subject)));
      if (!offerings.length) throw new AppError(`You do not teach ${args.subject}${args.className ? ` in ${args.className}` : ''}.`, 404, [], 'NOT_FOUND');
      if (offerings.length > 1) throw new AppError(`Which class — ${offerings.map((o) => o.label).join(', ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
      const p = await syllabus.plan(ctx.actor, offerings[0].id);
      if (!p.modules.length) throw new AppError(`${offerings[0].label} has no syllabus plan yet. Add its modules on the Syllabus page.`, 404, [], 'NOT_FOUND');
      const mod = args.module
        ? theNamed(p.modules, args.module, { label: 'module', nameOf: (m) => m.title, describe: (m) => m.title })
        : (p.modules.find((m) => m.id === p.current?.id) ?? p.modules.find((m) => m.status !== 'COMPLETED'));
      if (!mod) throw new AppError('Every module is complete. Name the module the lesson was in.', 400, [], 'AGENT_NEEDS_INPUT');
      const topicIds = [];
      const topics = [];
      for (const t of args.topics ?? []) {
        const found = theNamed(mod.topics, t, { label: `topic of "${mod.title}"`, nameOf: (x) => x.title, describe: (x) => x.title });
        topicIds.push(found.id);
        topics.push(found.title);
      }
      return { moduleId: mod.id, module: mod.title, offering: offerings[0].label, topicIds, topics };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const m = await syllabus.recordProgress(ctx.actor, plan.moduleId, { topicIds: plan.topicIds, note: args.note, homework: args.homework, taughtOn: args.taughtOn });
      return action({ type: 'syllabus_progress', id: plan.moduleId, data: { module: m.title, status: m.status, progressPct: m.progressPct ?? null }, speak: `Recorded in "${m.title}"${m.progressPct != null ? ` (${m.progressPct}% covered)` : ''}.` });
    },
  },
};

/* ── Online classes ───────────────────────────────────────── */

const lectureTools = {
  schedule_online_class: {
    module: 'Lectures',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    affectsOthers: true,
    description: 'Schedule an online class (or a doubt session) for a class the caller teaches, on a day and time; the class is told and a meeting room is made. Weekly repeats are possible. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 200 },
        ...classIdentitySchema,
        date: dateStr('The day'),
        time: { type: 'string', maxLength: 12, description: 'Start time, e.g. 17:00' },
        durationMinutes: { type: 'integer', minimum: 5, maximum: 480 },
        kind: { type: 'string', enum: ['LECTURE', 'DOUBT_SESSION', 'WEBINAR', 'OTHER'] },
        repeatWeekly: { type: 'integer', minimum: 1, maximum: 20, description: 'How many weeks in a row (default 1)' },
        includeGuardians: { type: 'boolean' },
      },
      required: ['title', 'className', 'date', 'time'],
      additionalProperties: false,
    },
    permission: 'lectures.manage',
    service: 'lecture.service.create()',
    summarise: (a, _actor, p) => `Schedule "${a.title}" for ${p.class} on ${a.date} at ${p.time} (${a.durationMinutes ?? 45} min${a.repeatWeekly > 1 ? `, weekly ×${a.repeatWeekly}` : ''})`,
    async prepare(ctx, args) {
      // Resolved at the caller's own reach: a teacher names only a class they teach.
      const section = await resolveSection({ ...ctx, scope: ctx.actor.permissions?.['lectures.manage'] === 'ALL' ? 'ALL' : 'OWN' }, args);
      if (!section) throw new AppError('Which class is it for?', 400, [], 'AGENT_NEEDS_INPUT');
      return { sectionId: section.sectionId, class: section.label, time: clockOf(args.time, 'start time') };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const c = await lectures.create(ctx.actor, {
        title: args.title, kind: args.kind ?? 'LECTURE', sectionIds: [plan.sectionId], startsAt: instant(args.date, plan.time),
        durationMinutes: args.durationMinutes ?? 45, repeatWeekly: args.repeatWeekly ?? 1, includeGuardians: args.includeGuardians === true,
      });
      return action({ type: 'online_class_scheduled', id: c.id, data: { refNo: c.refNo, title: c.title, when: c.when, occurrences: c.occurrences }, speak: `Scheduled "${c.title}" for ${plan.class}, ${c.when}. The class has been told.` });
    },
  },

  cancel_online_class: {
    module: 'Lectures',
    operation: 'DELETE',
    risk: RISK.MEDIUM,
    confirm: true,
    affectsOthers: true,
    description: 'Cancel an online class the caller hosts that has not finished; everyone invited is told the reason. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string', maxLength: 200 }, date: dateStr(), reason: { type: 'string', minLength: 1, maxLength: 300 } },
      required: ['title', 'reason'],
      additionalProperties: false,
    },
    permission: 'lectures.manage',
    service: 'lecture.service.list() + cancel()',
    summarise: (a, _actor, p) => `Cancel "${p.title}" (${p.when}): ${excerpt(a.reason, 80)}`,
    async prepare(ctx, args) {
      let rows = (await lectures.list(ctx.actor, {})).filter((c) => ['SCHEDULED', 'LIVE'].includes(c.status) && (c.isHost || c.canManage));
      if (args.date) rows = rows.filter((c) => String(c.startsAt ?? '').slice(0, 10) === args.date || new Date(c.startsAt).toISOString().slice(0, 10) === args.date);
      const c = theNamed(rows, args.title, { label: 'upcoming online class', nameOf: (x) => x.title, describe: (x) => `"${x.title}" (${x.when})` });
      return { classId: c.id, title: c.title, when: c.when };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      await lectures.cancel(ctx.actor, plan.classId, { reason: args.reason });
      return action({ type: 'online_class_cancelled', id: plan.classId, data: { title: plan.title }, speak: `Cancelled "${plan.title}"; everyone invited has been told.` });
    },
  },
};

/* ── Facilities and purchasing ────────────────────────────── */

const WO_CATEGORIES = ['ELECTRICAL', 'PLUMBING', 'IT', 'CLEANING', 'CIVIL', 'FURNITURE', 'SAFETY', 'HVAC', 'OTHER'];

async function namedPlace(ctx, place, { bookable = false } = {}) {
  const rows = (await facilities.listFacilities(ctx.actor, {})).filter((f) => !bookable || (f.bookable && f.status === 'ACTIVE'));
  return theNamed(rows, place, { label: bookable ? 'bookable room or space' : 'place', nameOf: (f) => f.name, describe: (f) => `${f.name}${f.code ? ` (${f.code})` : ''}` });
}

const facilityTools = {
  report_repair: {
    module: 'Facilities',
    operation: 'CREATE',
    risk: RISK.LOW,
    confirm: true,
    description: 'Report something that needs repair or attention (a broken fan, a leaking tap, a projector not working): what, where, the kind of work and how urgent. It becomes a work order for the facilities team. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 160 },
        category: { type: 'string', enum: WO_CATEGORIES },
        place: { type: 'string', maxLength: 120, description: 'The room or building, as listed on the campus' },
        priority: { type: 'string', enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] },
        description: { type: 'string', maxLength: 4000 },
      },
      required: ['title', 'category'],
      additionalProperties: false,
    },
    permission: 'facilities.request',
    service: 'facility.service.reportIssue()',
    summarise: (a, _actor, p) => `Report "${a.title}" (${String(a.category).toLowerCase()}, ${String(a.priority ?? 'NORMAL').toLowerCase()})${p?.place ? ` at ${p.place}` : ''}`,
    async prepare(ctx, args) {
      if (!args.place) return { facilityId: null, place: null };
      const f = await namedPlace(ctx, args.place);
      return { facilityId: f.id, place: f.name };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const wo = await facilities.reportIssue(ctx.actor, { title: args.title, category: args.category, priority: args.priority, description: args.description, facilityId: plan.facilityId });
      return action({ type: 'maintenance_reported', id: wo.id, data: { refNo: wo.refNo, status: wo.status, dueAt: wo.dueAt }, speak: `Reported as ${wo.refNo}; the facilities team will take it up.` });
    },
  },

  list_my_maintenance_reports: {
    module: 'Facilities',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'The repairs the caller has reported and where each stands (facilities managers see every work order). Read-only.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['OPEN', 'DONE', 'CLOSED', 'CANCELLED'] } }, additionalProperties: false },
    permission: 'facilities.request',
    service: 'facility.service.listWorkOrders()',
    async run(ctx, args) {
      const rows = rowsOf(await facilities.listWorkOrders(ctx.actor, { status: args.status, pageSize: 100 })).map((w) => ({ refNo: w.refNo, title: w.title, place: w.facilityName, priority: w.priority, status: w.status, overdue: Boolean(w.isOverdue) }));
      const view = summarise(rows, (w) => `${w.refNo} ${w.title} (${String(w.status).toLowerCase().replace(/_/g, ' ')})`);
      return ok({ workOrders: rows, count: rows.length }, { speak: rows.length ? `${rows.length} repair report(s): ${view.list}.` : 'You have not reported any repairs.' });
    },
  },

  request_facility_reservation: {
    module: 'Facilities',
    operation: 'CREATE',
    risk: RISK.LOW,
    confirm: true,
    description: 'Ask to book a room, hall, lab or ground for a time slot (a meeting, a rehearsal). A clash with another booking is refused; the facilities manager confirms the request. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        place: { type: 'string', minLength: 1, maxLength: 120 },
        title: { type: 'string', minLength: 1, maxLength: 160, description: 'What it is for' },
        date: dateStr('The day'),
        from: { type: 'string', maxLength: 12, description: 'Start time' },
        to: { type: 'string', maxLength: 12, description: 'End time' },
        attendees: { type: 'integer', minimum: 1, maximum: 5000 },
      },
      required: ['place', 'title', 'date', 'from', 'to'],
      additionalProperties: false,
    },
    permission: 'facilities.request',
    service: 'facility.service.listFacilities() + requestBooking()',
    summarise: (a, _actor, p) => `Ask to book ${p.place} on ${a.date} from ${p.from} to ${p.to} for "${a.title}"${a.attendees ? ` (${a.attendees} people)` : ''}`,
    async prepare(ctx, args) {
      const f = await namedPlace(ctx, args.place, { bookable: true });
      return { facilityId: f.id, place: f.name, from: clockOf(args.from, 'start time'), to: clockOf(args.to, 'end time') };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const b = await facilities.requestBooking(ctx.actor, { facilityId: plan.facilityId, title: args.title, startsAt: instant(args.date, plan.from), endsAt: instant(args.date, plan.to), attendees: args.attendees });
      return action({ type: 'facility_booking_requested', id: b.id, data: { place: b.facilityName, status: b.status }, speak: b.status === 'CONFIRMED' ? `${b.facilityName} is booked.` : `Booking request for ${b.facilityName} sent; the facilities manager confirms it.` });
    },
  },

  create_purchase_request: {
    module: 'Procurement',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Draft a purchase request: a title, the items with quantity and estimated unit price in rupees, and why. It is saved as a draft; adding quotes, submitting it for approval and every approval happen on the Purchasing page. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 200 },
        items: {
          type: 'array', minItems: 1, maxItems: 50,
          items: {
            type: 'object',
            properties: {
              description: { type: 'string', minLength: 1, maxLength: 300 },
              qty: { type: 'number', minimum: 0.01, maximum: 100000 },
              unit: { type: 'string', maxLength: 20 },
              estUnitPrice: { type: 'number', minimum: 0, maximum: 100000000, description: 'Estimated price of one unit, in rupees' },
            },
            required: ['description', 'qty'],
            additionalProperties: false,
          },
        },
        justification: { type: 'string', maxLength: 4000 },
        department: { type: 'string', maxLength: 80 },
      },
      required: ['title', 'items'],
      additionalProperties: false,
    },
    permission: 'procurement.request',
    service: 'procurement.service.createRequestDraft()',
    summarise: (a) => {
      const total = a.items.reduce((n, i) => n + i.qty * (i.estUnitPrice ?? 0), 0);
      return `Draft a purchase request "${a.title}": ${a.items.map((i) => `${i.qty} ${i.unit ?? 'nos'} ${i.description}`).join(', ')} (about ₹${total.toLocaleString('en-IN')})`;
    },
    async run(ctx, args) {
      const pr = await procurement.createRequestDraft(ctx.actor, {
        title: args.title, justification: args.justification, department: args.department,
        items: args.items.map((i) => ({ description: i.description, qty: i.qty, unit: i.unit, estUnitPaise: Math.round((i.estUnitPrice ?? 0) * 100) })),
      });
      return action({ type: 'purchase_request_drafted', id: pr.id, data: { refNo: pr.refNo, status: pr.status }, speak: `Drafted ${pr.refNo}. Add quotes and submit it for approval on the Purchasing page.` });
    },
  },
};

export const platformGapTools = {
  ...certificateTools,
  ...teachingTools,
  ...lectureTools,
  ...facilityTools,
};
