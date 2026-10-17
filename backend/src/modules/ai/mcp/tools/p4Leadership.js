import * as academics from '../../../leadership/academics.service.js';
import * as boardPack from '../../../leadership/boardpack.service.js';
import * as certificates from '../../../leadership/certificates.service.js';
import * as governance from '../../../governance/governance.service.js';
import * as documentRequests from '../../../documentRequests/documentRequest.service.js';
import { profilesWithRoles } from '../../../ops/common.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import { RISK, dateStr, theNamed } from './_shared.js';

/**
 * Principal, administrator and trustee work through the assistant (part 4).
 *
 * Reads: the school's attendance today and over a period (registers not taken,
 * students below 75%), teacher workload, the board pack for a meeting, the
 * open board actions, the certificate requests waiting in the office, a
 * student's no-dues check, the register of issued certificates and checking a
 * certificate by its verification code.
 *
 * Writes, each shown as a draft and run only when the same person confirms:
 * schedule a board/SMC meeting, set or circulate its agenda, freeze the board
 * pack for circulation, answer a meeting invitation, declare a conflict of
 * interest on an agenda item, mark one's own board action done, and generate a
 * certificate for an approved request (website only: it is an official
 * document sent to a family).
 *
 * Every tool calls the same service as the screen, with the caller's actor and
 * scope. Left on the screen on purpose: approving minutes (the chair decides),
 * recording votes and resolutions (the secretary records them from the
 * meeting), approving or rejecting a certificate request (a decision), and
 * downloading files (no file channel in a chat). Names avoid the deciding
 * verbs the registry reserves.
 */

const text = (max, description) => ({ type: 'string', maxLength: max, ...(description && { description }) });
const closed = (properties, required = []) => ({ type: 'object', properties, ...(required.length && { required }), additionalProperties: false });
const TIME = '^([01]\\d|2[0-3]):[0-5]\\d$';
const BODIES = ['TRUST_BOARD', 'SCHOOL_MANAGEMENT_COMMITTEE', 'GOVERNING_BODY', 'ACADEMIC_COUNCIL', 'FINANCE_COMMITTEE', 'PURCHASE_COMMITTEE', 'PTA_EXECUTIVE', 'OTHER'];
const words = (s) => String(s ?? '').replace(/_/g, ' ').toLowerCase();
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }) : 'no date');
const istAt = (ymd, hm) => new Date(`${ymd}T${hm}:00+05:30`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A meeting named in words (title or MTG ref), or the next upcoming one. */
async function meetingNamed(ctx, name) {
  const rows = await governance.list(ctx.actor, ctx.scope, {});
  if (!rows.length) throw new AppError('There are no governance meetings you can see.', 404);
  if (!name) {
    const upcoming = rows.filter((m) => m.status !== 'CANCELLED' && (!m.scheduledAt || new Date(m.scheduledAt) >= new Date()))
      .sort((a, b) => new Date(a.scheduledAt ?? 8.64e15) - new Date(b.scheduledAt ?? 8.64e15));
    return upcoming[0] ?? rows[0];
  }
  const byRef = rows.find((m) => String(m.refNo).toLowerCase() === String(name).trim().toLowerCase());
  return byRef ?? theNamed(rows, name, { label: 'meeting', nameOf: (m) => m.title, describe: (m) => `${m.title} (${m.refNo})` });
}

/** An office certificate request named by student or type. */
async function requestNamed(args, statuses) {
  const rows = await documentRequests.listForSchool({ ...(statuses && { status: statuses }), q: args.studentName ?? undefined });
  const list = args.documentType ? rows.filter((r) => r.documentTypeName.toLowerCase().includes(String(args.documentType).toLowerCase())) : rows;
  if (!list.length) throw new AppError(`No ${statuses ? `${words(statuses).replace(/,/g, ' or ')} ` : ''}certificate request${args.studentName ? ` for ${args.studentName}` : ''}${args.documentType ? ` (${args.documentType})` : ''}.`, 404);
  if (list.length > 1) {
    throw new AppError(`Which one? ${list.slice(0, 6).map((r) => `${r.documentTypeName} for ${r.student?.name ?? 'a student'} (${words(r.status)})`).join('; ')}.`, 400, [], 'AGENT_NEEDS_INPUT');
  }
  return list[0];
}

const certRef = {
  studentName: text(120, 'The student the certificate is for'),
  documentType: text(80, 'Kind of certificate, e.g. "transfer", "bonafide", "character"'),
};

export const leadershipTools = {
  get_school_attendance_overview: {
    module: 'Leadership', operation: 'GET', risk: RISK.LOW,
    description: "School-wide attendance for the principal: each class's percentage over a period (default the last 30 days), the school's overall figure, today's registers not yet taken, and how many students are below the attendance threshold (default 75%, the CBSE board-exam line) with the lowest ones named. Read-only.",
    inputSchema: closed({ from: dateStr('YYYY-MM-DD (default 30 days ago)'), to: dateStr('YYYY-MM-DD (default today)'), threshold: { type: 'integer', minimum: 1, maximum: 100 } }),
    permission: 'attendance.read', minScope: 'ALL',
    service: 'leadership/academics.service.attendanceOverview()',
    async run(ctx, args) {
      const o = await academics.attendanceOverview(ctx.actor, args);
      const worst = [...o.classes].filter((c) => c.pctPresent !== null).sort((a, b) => a.pctPresent - b.pctPresent).slice(0, 3);
      return ok({
        period: o.period, threshold: o.threshold, overallPct: o.overall.pctPresent,
        classes: o.classes.map((c) => ({ class: c.class, pctPresent: c.pctPresent, students: c.students })),
        today: { date: o.today.date, schoolDay: o.today.schoolDay, notMarked: o.today.notMarked.map((r) => ({ class: r.class, classTeacher: r.classTeacher })), partlyMarked: o.today.partlyMarked.map((r) => ({ class: r.class, marked: r.marked, students: r.students })) },
        belowThresholdTotal: o.belowThresholdTotal,
        lowest: o.belowThreshold.slice(0, 10).map((x) => ({ name: x.name, class: x.class, pctPresent: x.pctPresent, daysMarked: x.daysMarked })),
        basis: o.basis,
      }, { speak: `Overall ${o.overall.pctPresent ?? '—'}% from ${o.period.from} to ${o.period.to}. ${worst.length ? `Lowest: ${worst.map((c) => `${c.class} ${c.pctPresent}%`).join(', ')}. ` : ''}${o.today.schoolDay ? `${plural(o.today.notMarked.length, 'register')} not taken today. ` : 'No school today. '}${plural(o.belowThresholdTotal, 'student')} below ${o.threshold}%.` });
    },
  },

  get_teacher_workload: {
    module: 'Leadership', operation: 'GET', risk: RISK.LOW,
    description: 'Teaching load from the timetable: periods a week per teacher (and per day), classes and subjects, class-teacher duty, cover taken in the last 30 days and leave this year, with teachers over a cap (default 30 periods a week) flagged. Name a teacher to see just them. Read-only.',
    inputSchema: closed({ teacherName: text(120), cap: { type: 'integer', minimum: 10, maximum: 48 } }),
    permission: 'timetable.read', minScope: 'ALL',
    service: 'leadership/academics.service.teacherWorkload()',
    async run(ctx, args) {
      const w = await academics.teacherWorkload(ctx.actor, { cap: args.cap });
      const rows = args.teacherName ? [theNamed(w.teachers, args.teacherName, { label: 'teacher', nameOf: (t) => t.name })] : w.teachers;
      const view = rows.map((t) => ({ name: t.name, periodsPerWeek: t.periodsPerWeek, perDay: t.perDay, classes: t.classes, subjects: t.subjects, classTeacherOf: t.classTeacherOf, coversLast30Days: t.coversLast30Days, leaveDaysThisYear: t.leaveDaysThisYear, flags: t.flags }));
      const over = w.teachers.filter((t) => t.flags.includes('OVER_CAP'));
      return ok({ cap: w.cap, summary: w.summary, teachers: view, basis: w.basis }, {
        speak: args.teacherName ? `${view[0].name}: ${view[0].periodsPerWeek} periods a week${view[0].flags.length ? ` (${view[0].flags.map(words).join(', ')})` : ''}.` : `Average ${w.summary.averagePeriods ?? '—'} periods a week across ${plural(w.summary.teachers, 'teacher')}. ${over.length ? `Over ${w.cap}: ${over.map((t) => `${t.name} (${t.periodsPerWeek})`).join(', ')}.` : `Nobody is over ${w.cap}.`}`,
      });
    },
  },

  get_board_pack: {
    module: 'Governance', operation: 'GET', risk: RISK.LOW,
    description: "The board pack for a governance meeting (by title or MTG reference; default the next meeting): agenda, previous minutes and resolutions, open actions, finance and budget figures, compliance exceptions, decisions waiting for trustees, and suggested questions each tied to the figure behind it. Members see the frozen version the secretariat circulated (opening it records a read receipt). Read-only.",
    inputSchema: closed({ meeting: text(200) }),
    permission: 'governance.read',
    service: 'leadership/boardpack.service.getPack()',
    async run(ctx, args) {
      const m = await meetingNamed(ctx, args.meeting);
      const v = await boardPack.getPack(ctx.actor, ctx.scope, m.id);
      const p = v.pack;
      return ok({
        meeting: { title: p.meeting.title, refNo: p.meeting.refNo, when: p.meeting.scheduledAt, agenda: p.meeting.agenda.map((a) => `${a.order}. ${a.title}${a.decisionNeeded ? ' (decision)' : ''}`) },
        version: v.mode === 'FROZEN' ? v.version : 'live preview',
        overdueActions: (p.actions?.items ?? []).filter((a) => a.overdue).map((a) => ({ title: a.title, owner: a.ownerName, due: a.dueOn })),
        finance: p.finance?.available ? p.finance.metrics.map((x) => ({ measure: x.label, value: x.text, lastYear: x.comparisonText, changePct: x.changePct })) : p.finance?.reason,
        budget: p.budget?.available ? { fiscalYear: p.budget.fiscalYear, status: p.budget.status, totals: p.budget.totals, yearElapsedPct: p.budget.yearElapsedPct } : p.budget?.reason,
        complianceOverdue: p.compliance?.available ? p.compliance.overdue.map((i) => i.title) : p.compliance?.reason,
        decisionsWaiting: p.decisions?.available ? p.decisions.items.map((d) => `${d.refNo} ${d.title}`) : p.decisions?.reason,
        questions: p.questions, questionsNote: p.questionsNote,
        link: `/governance?id=${m.id}`,
      }, { speak: `${p.meeting.title}: ${plural(p.meeting.agenda.length, 'agenda item')}, ${plural((p.actions?.items ?? []).filter((a) => a.overdue).length, 'overdue action')}, ${plural(p.compliance?.overdue?.length ?? 0, 'compliance item')} overdue. ${p.questions.length ? `First question to consider: ${p.questions[0].question}` : ''}` });
    },
  },

  list_board_actions: {
    module: 'Governance', operation: 'GET', risk: RISK.LOW,
    description: 'Open actions from governance meetings (board, SMC, committees) you can see, with owner and due date, overdue first. Read-only.',
    inputSchema: closed({}),
    permission: 'governance.read',
    service: 'governance.service.openActions()',
    async run(ctx) {
      const rows = (await governance.openActions(ctx.actor, ctx.scope)).sort((a, b) => Number(b.overdue) - Number(a.overdue));
      return ok({ actions: rows.map((a) => ({ title: a.title, meeting: a.meeting, owner: a.ownerName, due: a.dueOn, overdue: a.overdue })) }, { speak: rows.length ? `${plural(rows.length, 'open action')}, ${rows.filter((a) => a.overdue).length} overdue.` : 'No open board actions.' });
    },
  },

  schedule_board_meeting: {
    module: 'Governance', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: 'Schedule a meeting of the trust board, School Management Committee or a committee on a date and time, inviting the named members (default: every trustee and the principal). Members are notified. Needs confirmation.',
    inputSchema: closed({
      title: text(200), body: { type: 'string', enum: BODIES }, date: dateStr('YYYY-MM-DD'), time: { type: 'string', pattern: TIME, description: 'HH:MM, 24-hour' },
      location: text(200), memberNames: { type: 'array', items: text(120), maxItems: 30 }, quorum: { type: 'integer', minimum: 1, maximum: 30 },
    }, ['title', 'date', 'time']),
    permission: 'governance.manage', minScope: 'ALL',
    service: 'governance.service.create()',
    async prepare(ctx, args) {
      const at = istAt(args.date, args.time);
      if (Number.isNaN(at.getTime()) || at < new Date()) throw new AppError('Choose a date and time in the future.', 400);
      const people = (await profilesWithRoles(['TRUSTEE', 'PRINCIPAL', 'ADMIN', 'FINANCE', 'TEACHER', 'COMPLIANCE', 'HR'])).map((p) => ({ id: String(p._id), name: p.displayName, roleKey: p.roleId?.key }));
      const members = args.memberNames?.length
        ? args.memberNames.map((n) => theNamed(people, n, { label: 'member', nameOf: (p) => p.name }))
        : people.filter((p) => ['TRUSTEE', 'PRINCIPAL'].includes(p.roleKey));
      if (!members.length) throw new AppError('Name the members to invite.', 400, [], 'AGENT_NEEDS_INPUT');
      return { at: at.toISOString(), members: members.map((p) => ({ id: p.id, name: p.name })) };
    },
    summarise: (args, _a, p) => `Schedule "${args.title}" (${words(args.body ?? 'TRUST_BOARD')}) on ${args.date} at ${args.time}${args.location ? `, ${args.location}` : ''}, inviting ${p?.members?.map((m) => m.name).join(', ') ?? 'the members'}`,
    async run(ctx, args, p) {
      const m = await governance.create(ctx.actor, { body: args.body ?? 'TRUST_BOARD', title: args.title, scheduledAt: p.at, location: args.location, quorum: args.quorum, memberProfileIds: p.members.map((x) => x.id) });
      return action({ type: 'board_meeting_scheduled', id: m.id, data: { refNo: m.refNo, title: m.title, when: m.scheduledAt, link: `/governance?id=${m.id}` }, speak: `${m.refNo} "${m.title}" is scheduled for ${fmtDay(m.scheduledAt)}; ${plural(p.members.length, 'member')} invited.` });
    },
  },

  set_board_agenda: {
    module: 'Governance', operation: 'UPDATE', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: "Set a meeting's agenda (items in order; mark those needing a decision), and optionally circulate it to members. Replaces a draft agenda; a circulated agenda is changed on the Governance screen. Needs confirmation.",
    inputSchema: closed({
      meeting: text(200),
      items: { type: 'array', minItems: 1, maxItems: 40, items: closed({ title: text(300), presenter: text(120), decisionNeeded: { type: 'boolean' } }, ['title']) },
      circulate: { type: 'boolean', description: 'Send the agenda to members now' },
    }, ['items']),
    permission: 'governance.manage', minScope: 'ALL',
    service: 'governance.service.setAgenda()',
    async prepare(ctx, args) {
      const m = await meetingNamed(ctx, args.meeting);
      if (m.agendaStatus === 'CIRCULATED') throw new AppError(`The agenda of ${m.refNo} has been circulated; change it on the Governance screen.`, 409);
      return { id: m.id, refNo: m.refNo, title: m.title };
    },
    summarise: (args, _a, p) => `Agenda for ${p?.refNo ?? ''} "${p?.title ?? args.meeting}": ${args.items.map((it, i) => `${i + 1}. ${it.title}${it.decisionNeeded ? ' (decision)' : ''}`).join('; ')}${args.circulate ? ' — and circulate it to members' : ''}`,
    async run(ctx, args, p) {
      await governance.setAgenda(ctx.actor, 'ALL', p.id, { items: args.items });
      const m = args.circulate ? await governance.setAgenda(ctx.actor, 'ALL', p.id, { status: 'CIRCULATED' }) : await governance.get(ctx.actor, 'ALL', p.id);
      return action({ type: 'board_agenda_set', id: p.id, data: { refNo: m.refNo, agendaStatus: m.agendaStatus, items: m.agenda.length }, speak: `${m.refNo}: ${plural(m.agenda.length, 'agenda item')} saved${args.circulate ? ' and circulated' : ''}.` });
    },
  },

  freeze_board_pack: {
    module: 'Governance', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: "Freeze the board pack for a meeting as a new version, so every member reads the same papers (their opens are recorded). The figures are taken from the records as they stand now. Needs confirmation.",
    inputSchema: closed({ meeting: text(200), note: text(500) }),
    permission: 'governance.manage', minScope: 'ALL',
    service: 'leadership/boardpack.service.freezePack()',
    async prepare(ctx, args) {
      const m = await meetingNamed(ctx, args.meeting);
      return { id: m.id, refNo: m.refNo, title: m.title };
    },
    summarise: (args, _a, p) => `Freeze the board pack for ${p?.refNo ?? ''} "${p?.title ?? args.meeting}" as a new version${args.note ? ` (${args.note})` : ''}`,
    async run(ctx, args, p) {
      const v = await boardPack.freezePack(ctx.actor, p.id, { note: args.note });
      return action({ type: 'board_pack_frozen', id: p.id, data: { version: v.version, questions: v.pack.questions.length }, speak: `Board pack for ${p.refNo} frozen as version ${v.version}.` });
    },
  },

  respond_to_board_meeting: {
    module: 'Governance', operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: 'Answer an invitation to a governance meeting you are a member of: accepted, tentative or declined. Needs confirmation.',
    inputSchema: closed({ meeting: text(200), response: { type: 'string', enum: ['ACCEPTED', 'TENTATIVE', 'DECLINED'] } }, ['response']),
    permission: 'governance.read',
    service: 'governance.service.rsvp()',
    async prepare(ctx, args) {
      const m = await meetingNamed(ctx, args.meeting);
      if (!m.isMember) throw new AppError(`You are not a member of ${m.refNo}.`, 403);
      return { id: m.id, refNo: m.refNo, title: m.title };
    },
    summarise: (args, _a, p) => `Reply "${words(args.response)}" to ${p?.refNo ?? ''} "${p?.title ?? args.meeting}"`,
    async run(ctx, args, p) {
      await governance.rsvp(ctx.actor, ctx.scope, p.id, { rsvp: args.response });
      return action({ type: 'board_meeting_rsvp', id: p.id, speak: `Your reply to ${p.refNo} is saved: ${words(args.response)}.` });
    },
  },

  declare_meeting_conflict: {
    module: 'Governance', operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: "Declare a conflict of interest on an agenda item of a meeting you are a member of (e.g. a relative owns the vendor). You stay recorded as present but do not vote on that item. Adds to any declarations you made before. Needs confirmation.",
    inputSchema: closed({ meeting: text(200), agendaItem: { type: 'integer', minimum: 1, maximum: 40, description: 'The agenda item number' }, declaration: text(1000) }, ['agendaItem', 'declaration']),
    permission: 'governance.read',
    service: 'governance.service.rsvp() with conflicts',
    async prepare(ctx, args) {
      const m = await meetingNamed(ctx, args.meeting);
      if (!m.isMember) throw new AppError(`You are not a member of ${m.refNo}.`, 403);
      const item = (m.agenda ?? []).find((a) => Number(a.order) === args.agendaItem);
      if (!item) throw new AppError(`${m.refNo} has no agenda item ${args.agendaItem}.`, 400, [], 'AGENT_NEEDS_INPUT');
      const full = await governance.get(ctx.actor, ctx.scope, m.id);
      return { id: m.id, refNo: m.refNo, item: item.title, existing: full.myConflicts ?? [] };
    },
    summarise: (args, _a, p) => `Declare a conflict on ${p?.refNo ?? ''} item ${args.agendaItem}${p?.item ? ` ("${p.item}")` : ''}: ${args.declaration}`,
    async run(ctx, args, p) {
      const conflicts = [...p.existing.filter((c) => c.agendaOrder !== args.agendaItem), { agendaOrder: args.agendaItem, declaration: args.declaration }];
      await governance.rsvp(ctx.actor, ctx.scope, p.id, { conflicts });
      return action({ type: 'meeting_conflict_declared', id: p.id, speak: `Conflict on item ${args.agendaItem} of ${p.refNo} declared; you will not vote on it.` });
    },
  },

  mark_board_action_done: {
    module: 'Governance', operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: 'Mark an open board action done (its owner, or the secretariat for any action). Name the action. Needs confirmation.',
    inputSchema: closed({ action: text(300) }, ['action']),
    permission: 'governance.read',
    service: 'governance.service.updateAction()',
    async prepare(ctx, args) {
      const rows = await governance.openActions(ctx.actor, ctx.scope);
      const a = theNamed(rows, args.action, { label: 'open action', nameOf: (r) => r.title, describe: (r) => `${r.title} (${r.meeting})` });
      const m = await governance.get(ctx.actor, ctx.scope, a.meetingId);
      if (!m.actions.find((x) => String(x._id) === a.actionId)?.canUpdate) throw new AppError('Only the owner of that action or the secretariat can mark it done.', 403);
      return { meetingId: a.meetingId, actionId: a.actionId, title: a.title, meeting: a.meeting };
    },
    summarise: (_args, _a, p) => `Mark "${p?.title}" (${p?.meeting}) done`,
    async run(ctx, _args, p) {
      await governance.updateAction(ctx.actor, ctx.scope, p.meetingId, p.actionId, { status: 'DONE' });
      return action({ type: 'board_action_done', id: p.actionId, speak: `"${p.title}" is marked done.` });
    },
  },

  list_certificate_requests: {
    module: 'Certificates', operation: 'GET', risk: RISK.LOW,
    description: 'School office: certificate requests (transfer, bonafide, character, fee …) waiting to be reviewed or ready to generate, newest first. Filter by status or student. Read-only.',
    inputSchema: closed({ status: { type: 'string', enum: ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'READY', 'COMPLETED', 'REJECTED'] }, studentName: text(120) }),
    permission: 'students.manage', minScope: 'ALL',
    service: 'documentRequest.service.listForSchool()',
    async run(ctx, args) {
      const rows = await documentRequests.listForSchool({ status: args.status ?? 'PENDING,UNDER_REVIEW,APPROVED', q: args.studentName });
      return ok({ requests: rows.slice(0, 30).map((r) => ({ type: r.documentTypeName, student: r.student?.name, admissionNo: r.student?.admissionNo, class: r.student?.className, status: r.status, requestedAt: r.requestedAt, requiredBy: r.requiredBy })) }, { speak: `${plural(rows.length, 'request')}${args.status ? ` ${words(args.status)}` : ' waiting'}.` });
    },
  },

  get_certificate_clearance: {
    module: 'Certificates', operation: 'GET', risk: RISK.LOW,
    description: "No-dues check for a student's certificate request: fees outstanding, library books not returned or fines due, a hostel bed still allotted. A transfer or leaving certificate needs all clear. Read-only.",
    inputSchema: closed({ ...certRef }, ['studentName']),
    permission: 'students.manage', minScope: 'ALL',
    service: 'leadership/certificates.service.clearance()',
    async run(ctx, args) {
      const r = await requestNamed(args);
      const c = await certificates.clearance(ctx.actor, r.id);
      return ok({ request: `${r.documentTypeName} for ${r.student?.name}`, required: c.required, clear: c.clear, checks: c.checks.map((x) => ({ check: x.label, status: x.status, detail: x.detail })) }, { speak: c.clear ? `${r.student?.name}: all clear.` : `${r.student?.name}: ${c.checks.filter((x) => x.status === 'DUE').map((x) => x.detail).join('; ')}.` });
    },
  },

  generate_certificate: {
    module: 'Certificates', operation: 'CREATE', risk: RISK.HIGH, confirm: true, affectsOthers: true,
    description: "Generate the certificate for an APPROVED request from the student's record (particulars, date of birth in words, first admission, last class, attendance, fee position) with a serial number and verification code, and attach it to the request so the family can download it. A transfer or leaving certificate is refused while dues are open unless you give the reason to issue anyway. Office details such as reason for leaving and conduct are optional. Confirmed on the website only.",
    inputSchema: closed({
      ...certRef,
      reasonForLeaving: text(300), conduct: text(60), promotion: text(200, 'e.g. "Qualified for promotion to Class 8"'), purpose: text(200), remarks: text(500),
      overrideReason: text(500, "Only if dues are open and the school has decided to issue anyway: the reason, in the user's words"),
    }, ['studentName']),
    permission: 'students.manage', minScope: 'ALL',
    service: 'leadership/certificates.service.generate()',
    async prepare(ctx, args) {
      const r = await requestNamed(args, 'APPROVED,READY');
      const c = await certificates.clearance(ctx.actor, r.id);
      if (c.required && !c.clear && !args.overrideReason) {
        throw new AppError(`Dues are open for ${r.student?.name}: ${c.checks.filter((x) => x.status === 'DUE').map((x) => x.detail).join('; ')}. Clear them first, or tell me the reason the school is issuing anyway.`, 409, [], 'AGENT_NEEDS_INPUT');
      }
      return { id: r.id, student: r.student?.name, type: r.documentTypeName, duesOpen: c.required && !c.clear };
    },
    summarise: (args, _a, p) => `Generate the ${p?.type ?? 'certificate'} for ${p?.student ?? args.studentName} from the records and attach it to the request${args.reasonForLeaving ? `; reason for leaving: ${args.reasonForLeaving}` : ''}${p?.duesOpen ? ` — dues are open; issuing anyway because: ${args.overrideReason}` : ''}`,
    async run(ctx, args, p) {
      const out = await certificates.generate(ctx.actor, p.id, args);
      return action({ type: 'certificate_generated', id: p.id, data: { serialNo: out.serialNo, verificationCode: out.verificationCode, title: out.title }, speak: `${out.title} ${out.serialNo} generated for ${p.student} and attached; the family can download it. Print, sign and seal it.` });
    },
  },

  list_issued_certificates: {
    module: 'Certificates', operation: 'GET', risk: RISK.LOW,
    description: 'The register of certificates generated by the office (serial number, student, date, who issued, whether dues were open). Read-only.',
    inputSchema: closed({ kind: { type: 'string', enum: ['TC', 'LEAVING', 'BONAFIDE', 'CHARACTER', 'FEE', 'GENERIC'] } }),
    permission: 'students.manage', minScope: 'ALL',
    service: 'leadership/certificates.service.register()',
    async run(ctx, args) {
      const rows = await certificates.register({ kind: args.kind, limit: 50 });
      return ok({ certificates: rows.map((x) => ({ serialNo: x.serialNo, title: x.title, student: x.studentName, issuedAt: x.issuedAt, issuedBy: x.issuedBy, duesOpen: x.duesOpen })) }, { speak: `${plural(rows.length, 'certificate')} in the register.` });
    },
  },

  check_certificate_code: {
    module: 'Certificates', operation: 'GET', risk: RISK.LOW,
    description: "Check a certificate's verification code (printed at the foot of certificates the office generated) against the register. Read-only.",
    inputSchema: closed({ code: { type: 'string', pattern: '^[0-9A-Fa-f]{10}$' } }, ['code']),
    permission: 'students.manage', minScope: 'ALL',
    service: 'leadership/certificates.service.verify()',
    async run(ctx, args) {
      const v = await certificates.verify(args.code);
      return ok(v, { speak: v.valid ? `Valid: ${v.title} ${v.serialNo} for ${v.studentName}, issued ${fmtDay(v.issuedAt)}.` : (v.message ?? 'Not valid.') });
    },
  },
};
