// Part-6 coverage tools: misc. See ./_kit.js and ../p6Coverage.js.
//
// Notifications marked read, the risk scan, the AI drafting options and the
// caller's AI credits, PTM reads and the staff side of PTM booking (a teacher
// or the office booking, moving or cancelling a meeting for a family, and the
// waiting list), review-call reads and changes, the conversation queue and a
// reply, analytics catalogue and saved views, quarterly report deliveries, the
// campus layers, live detail and facility detail, the caller's own dashboard
// and the universal search. Each tool is the route's own service call behind
// the route's own guard; the service still decides what the caller may see.
import * as notifications from '../../../../notifications/notification.service.js';
import * as risk from '../../../../risk/risk.service.js';
import * as drafts from '../../../drafts.service.js';
import * as credits from '../../../aiCredit.service.js';
import * as ptm from '../../../../ptm/ptm.service.js';
import * as calls from '../../../../ptm/reviewcalls.service.js';
import * as conversations from '../../../../conversations/conversations.service.js';
import * as analytics from '../../../../analytics/analytics.service.js';
import * as views from '../../../../analytics/views.service.js';
import * as quarterly from '../../../../analytics/quarterly.service.js';
import * as campus from '../../../../campus/campus.service.js';
import { campusLayers } from '../../../../campus/layers.service.js';
import { liveDetail } from '../../../../campus/live-detail.service.js';
import { departments as campusDepartments } from '../../../../campus/live.service.js';
import { roleDashboard } from '../../../../insights/dashboards.service.js';
import * as search from '../../../../search/search.service.js';
import { profilesWithRoles, profileNames } from '../../../../ops/common.js';
import { ownStudentIds } from '../../../../safety/shared.js';
import { Facility } from '../../../../../models/facility.model.js';
import { Student, StudentGuardian } from '../../../../../models/student.model.js';
import { PtmBooking, PtmWaitlist } from '../../../../../models/ptm.model.js';
import { resolveSection, resolveStudentId } from '../_shared.js';
import {
  tool, text, int, bool, oneOf, list, closed, hm, ask, notFound, pick, listed, shown, did, need, needAny, scopesOf,
  lower, words, day, time, stripTitle, excerpt, RISK, dateStr, AppError,
} from './_kit.js';

const STAFF = ['ADMIN', 'PRINCIPAL', 'TEACHER', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'LIBRARIAN', 'WARDEN', 'NURSE'];
const FAMILY_ROLES = new Set(['PARENT', 'STUDENT', 'ALUMNUS']);
const PTM_KEYS = ['ptm.read', 'ptm.manage', 'ptm.book'];

/* ── Notifications ────────────────────────────────────────── */

const notificationTools = {
  dismiss_unread_notifications: tool({
    module: 'Notifications', operation: 'ACTION', risk: RISK.LOW,
    description: "Mark the caller's own notifications as read: all of them, or only the unread ones whose title mentions some words (e.g. \"the fee reminders\"). Needs confirmation.",
    inputSchema: closed({ about: text(120, 'Only unread notifications whose title contains these words; leave out for all') }),
    permission: 'ai.copilot.use',
    service: 'notification.service.markRead() / markAllRead()',
    summarise: (a, _x, p) => (a.about ? `Mark ${p?.count ?? 'the'} unread notification(s) about "${a.about}" as read` : `Mark all ${p?.count ?? ''} unread notification(s) as read`),
    async prepare(ctx, args) {
      const page = await notifications.list(ctx.actor, { unreadOnly: true, limit: 100 });
      const rows = (page.items ?? []).filter((n) => !args.about || lower(`${n.title} ${n.body ?? ''}`).includes(lower(args.about)));
      if (args.about && !rows.length) throw notFound(`You have no unread notification about "${args.about}".`);
      return { ids: rows.map((n) => String(n._id ?? n.id)), count: args.about ? rows.length : page.unreadCount ?? rows.length };
    },
    async run(ctx, args, p) {
      const out = args.about ? await notifications.markRead(ctx.actor, p.ids) : await notifications.markAllRead(ctx.actor);
      return did('notifications_read', null, `${out.updated} marked read; ${out.unreadCount} unread left.`);
    },
  }),
};

/* ── Risk scan, AI drafting options, AI credits ───────────── */

const aiTools = {
  get_risk_scan: tool({
    module: 'Analytics', operation: 'GET',
    description: "For the principal or administration: the dropout, academic-decline and fee-default risk scan across the school (rule-based, over the last 30 days): how many students are flagged at high and medium risk, by category, and the highest-risk students. refresh recomputes it now. Read-only.",
    inputSchema: closed({ refresh: bool('Recompute now instead of using the last scan'), level: oneOf(['HIGH', 'MEDIUM', 'LOW']), type: oneOf(['ATTENDANCE', 'ACADEMIC_DECLINE', 'FEE_DEFAULT']), className: text(40, 'Only this class, e.g. "Class 6"') }),
    permission: 'ai.insights.read',
    service: 'risk.service.read()',
    async run(_ctx, args) {
      const out = await risk.read({ refresh: args.refresh === true, level: args.level ?? (args.type ? undefined : 'HIGH'), type: args.type, search: args.className, pageSize: 25 });
      const rows = out.items.map((r) => ({ student: r.studentName, class: r.class, type: r.type, level: r.level, probability: r.probability, why: r.summary }));
      const s = out.summary ?? {};
      return listed(rows, (r) => `${r.student} (${r.class}, ${words(r.type)} ${words(r.level)})`, {
        noun: 'flag',
        extra: { summary: s, computedAt: out.computedAt },
        speak: `${s.studentsAtHighRisk ?? 0} student(s) at high risk and ${s.studentsAtMediumRisk ?? 0} at medium risk${rows.length ? `. ${rows.slice(0, 8).map((r) => `${r.student} (${r.class}, ${words(r.type)})`).join('; ')}` : ''}.`,
      });
    },
  }),

  get_available_ai_draft_kinds: tool({
    module: 'AI drafts', operation: 'GET', feature: 'aiDrafts',
    description: 'What the drafting assistant can draft (letters, circulars, minutes, lesson-plan outlines, report-card remarks), the remark bands, and whether the AI service is connected or drafts come from templates. Read-only.',
    permission: 'ai.drafts.use',
    service: 'drafts.service.status()',
    async run() {
      const s = drafts.status();
      return shown(s, `${s.aiConfigured ? 'AI drafting is connected' : 'Drafts come from templates (the AI service is not connected)'}. Kinds: ${s.kinds.map(words).join(', ')}.`);
    },
  }),

  get_my_ai_credits: tool({
    module: 'Profile', operation: 'GET',
    description: "The caller's own AI credits: whether their use is metered (families) or covered by the school (staff), the free monthly allowance and what is left, purchased credits, the packs on offer and (with orders) their top-up history. Buying a pack is done on the screen. Read-only.",
    inputSchema: closed({ orders: bool('Include the top-up history') }),
    permission: 'ai.copilot.use',
    service: 'aiCredit.service.getStatus() + CREDIT_PACKS + listOrders()',
    async run(ctx, args) {
      const status = await credits.getStatus(ctx.actor);
      const packs = credits.CREDIT_PACKS.map((p) => ({ key: p.key, label: p.label, credits: p.credits, price: `₹${(p.amountPaise / 100).toFixed(0)}` }));
      const orders = args.orders ? await credits.listOrders(ctx.actor) : undefined;
      const left = status.metered ? (status.remaining ?? status.total ?? status.available ?? null) : null;
      return shown({ ...status, freeMonthlyCredits: credits.FREE_MONTHLY_CREDITS, packs, ...(orders && { orders }) },
        status.metered ? `You have ${left ?? 'some'} AI credit(s) left (${credits.FREE_MONTHLY_CREDITS} free each month).${orders ? ` ${orders.length} top-up order(s).` : ''}` : status.reason);
    },
  }),
};

/* ── PTM ──────────────────────────────────────────────────── */

const ptmScopes = (ctx) => scopesOf(ctx, PTM_KEYS);
const ptmReadScope = (ctx) => ctx.actor?.permissions?.['ptm.read'] ?? ctx.actor?.permissions?.['ptm.manage'] ?? ctx.scope;

async function roundNamed(ctx, term) {
  const rows = await ptm.listRounds(ctx.actor, ptmReadScope(ctx), {});
  if (!term) {
    const open = rows.filter((r) => r.status === 'OPEN');
    return pick(open.length ? open : rows, null, { label: 'PTM round', nameOf: (r) => r.title, refOf: (r) => r.refNo, describe: (r) => `${r.refNo} ${r.title} (${r.startsOn})` });
  }
  return pick(rows, term, { label: 'PTM round', nameOf: (r) => r.title, refOf: (r) => r.refNo, describe: (r) => `${r.refNo} ${r.title} (${r.startsOn})` });
}

/** A teacher by name for someone who manages every PTM; the caller themself otherwise. */
async function ptmTeacher(ctx, teacherName) {
  if (!teacherName) return { id: String(ctx.actor.profileId), name: ctx.actor.displayName ?? 'you', self: true };
  if (ctx.actor.permissions?.['ptm.manage'] !== 'ALL') throw new AppError('You can act only on your own PTM slots.', 403, [], 'NOT_YOUR_SLOT');
  const rows = (await profilesWithRoles(['TEACHER', 'PRINCIPAL'])).map((p) => ({ id: String(p._id), name: p.displayName }));
  return { ...pick(rows, stripTitle(teacherName), { label: 'teacher', refOf: () => null }), self: false };
}

/** A pupil and one of their guardians, for staff acting on a family's behalf. */
async function pupilAndGuardian(ctx, { admissionNo, studentName, parentName }) {
  if (!admissionNo && !studentName) throw ask('Which pupil (name or admission number)?');
  const studentId = await resolveStudentId(ctx, { admissionNo, studentName });
  const st = await Student.findById(studentId).select('firstName lastName').lean();
  const links = await StudentGuardian.find({ studentId }).select('guardianProfileId isPrimary').lean();
  const names = await profileNames(links.map((l) => l.guardianProfileId));
  const guardians = links.map((l) => ({ id: String(l.guardianProfileId), name: names.get(String(l.guardianProfileId)) ?? 'Guardian', primary: Boolean(l.isPrimary) }));
  if (!guardians.length) throw notFound('That pupil has no guardian on record to book for.');
  const guardian = parentName ? pick(guardians, stripTitle(parentName), { label: 'guardian', refOf: () => null })
    : guardians.length === 1 ? guardians[0] : guardians.find((g) => g.primary) ?? pick(guardians, null, { label: 'guardian', refOf: () => null });
  return { studentId: String(studentId), student: `${st?.firstName ?? ''} ${st?.lastName ?? ''}`.trim(), parentId: guardian.id, parent: guardian.name };
}

/** An open slot by its start time (and day) for a teacher in a round. */
async function openSlot(ctx, roundId, teacherId, at, date) {
  const rows = (await ptm.listSlots(ctx.actor, ctx.scope, roundId, { teacherProfileId: teacherId }))
    .filter((s) => s.status === 'OPEN' && time(s.startsAt) === at && (!date || s.date === date));
  if (!rows.length) throw notFound(`There is no free slot at ${at}${date ? ` on ${date}` : ''}.`);
  if (rows.length > 1) throw ask(`Which day? ${rows.map((s) => s.date).join(', ')}`);
  return rows[0];
}

/** An active booked meeting the caller may act on as staff: their own, or any for a PTM manager. */
async function staffMeeting(ctx, { bookingRef, studentName }) {
  const filter = { active: true, status: 'BOOKED', ...(ctx.scope === 'ALL' ? {} : { teacherProfileId: ctx.actor.profileId }) };
  const rows = await PtmBooking.find(filter).sort({ startsAt: 1 }).limit(500).lean();
  const studs = new Map((await Student.find({ _id: { $in: rows.map((b) => b.studentId) } }).select('firstName lastName').lean()).map((s) => [String(s._id), `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim()]));
  const names = await profileNames(rows.map((b) => b.teacherProfileId));
  const pool = rows.map((b) => ({ id: String(b._id), refNo: b.refNo, roundId: String(b.roundId), teacherId: String(b.teacherProfileId), teacher: names.get(String(b.teacherProfileId)) ?? null, student: studs.get(String(b.studentId)) ?? '', when: `${day(b.startsAt)} ${time(b.startsAt)}` }));
  return pick(pool, bookingRef ?? studentName, { label: 'booked meeting', nameOf: (b) => b.student, refOf: (b) => b.refNo, describe: (b) => `${b.refNo} ${b.student} with ${b.teacher} (${b.when})` });
}

const pupil = { studentName: text(80, 'The pupil'), admissionNo: text(30) };

const ptmTools = {
  get_ptm_round_schedule: tool({
    module: 'PTM', operation: 'GET', feature: 'ptm',
    description: 'One parent-teacher meeting round (the open one by default): its days, mode, slot length, venue, when booking opens and closes and whether booking is open now. Read-only.',
    inputSchema: closed({ round: text(120, 'Title or reference') }),
    permission: 'ptm.read',
    service: 'ptm.service.listRounds() + getRound()',
    async run(ctx, args) {
      const r = await ptm.getRound(ctx.actor, ctx.scope, (await roundNamed(ctx, args.round)).id);
      return shown(r, `${r.refNo} ${r.title}: ${r.startsOn}${r.endsOn !== r.startsOn ? ` to ${r.endsOn}` : ''}, ${words(r.mode)}, ${r.slotMinutes}-minute slots${r.defaultVenue ? ` at ${r.defaultVenue}` : ''}; booking ${r.bookingOpen ? 'open' : 'closed'}, ${words(r.status)}.`);
    },
  }),

  list_my_ptm_slots: tool({
    module: 'PTM', operation: 'GET', feature: 'ptm',
    description: "For a teacher: their own slots in a PTM round with each one's status (open, booked, held, blocked). Someone who manages every PTM may name a teacher. Read-only.",
    inputSchema: closed({ round: text(120), teacherName: text(80, 'For a PTM manager: another teacher') }),
    permission: 'ptm.manage',
    service: 'ptm.service.listSlots()',
    async run(ctx, args) {
      const round = await roundNamed(ctx, args.round);
      const t = await ptmTeacher(ctx, args.teacherName);
      const rows = (await ptm.listSlots(ctx.actor, ctx.scope, round.id, t.self ? {} : { teacherProfileId: t.id })).map((s) => ({ date: s.date, time: s.time, status: s.status, venue: s.venue }));
      return listed(rows, (s) => `${s.date} ${s.time} ${words(s.status)}`, { noun: 'slot', extra: { round: round.title, teacher: t.name } });
    },
  }),

  get_ptm_meeting_sheet: tool({
    module: 'PTM', operation: 'GET', feature: 'ptm',
    description: "For a teacher: their sheet for a PTM round — every slot in time order with the family coming, the pupil's class and what they asked to discuss, and the totals (booked, checked in, done, no-shows, free). A PTM manager may name a teacher. Read-only.",
    inputSchema: closed({ round: text(120), teacherName: text(80) }),
    permission: 'ptm.manage',
    anyOf: [['ptm.manage'], ['ptm.read']],
    guard: (ctx) => needAny(ctx, [['ptm.manage'], ['ptm.read']]),
    service: 'ptm.service.meetingSheet()',
    async run(ctx, args) {
      const round = await roundNamed(ctx, args.round);
      const t = await ptmTeacher(ctx, args.teacherName);
      const out = await ptm.meetingSheet(ctx.actor, ptmScopes(ctx), round.id, t.self ? {} : { teacherProfileId: t.id });
      const rows = out.rows.map((r) => ({ date: r.slot.date, time: r.slot.time, slot: r.slot.status, pupil: r.booking?.studentName ?? null, class: r.booking?.className ?? null, parent: r.booking?.parentName ?? null, status: r.booking?.status ?? null, ref: r.booking?.refNo ?? null }));
      return listed(rows, (r) => `${r.time} ${r.pupil ? `${r.pupil} (${r.class ?? ''}, ${words(r.status)})` : words(r.slot)}`, { noun: 'slot', extra: { round: out.round.title, totals: out.totals } });
    },
  }),

  list_ptm_unbooked_families: tool({
    module: 'PTM', operation: 'GET', feature: 'ptm',
    description: "For a teacher or PTM manager: the families of their classes (or one class) in a PTM round who have not booked any meeting yet, with the guardians' names, so they can be helped to book. Read-only.",
    inputSchema: closed({ round: text(120), className: text(40, 'e.g. "Class 6 A"') }),
    permission: 'ptm.manage',
    service: 'ptm.service.unbookedFamilies()',
    async run(ctx, args) {
      const round = await roundNamed(ctx, args.round);
      const section = args.className ? await resolveSection(ctx, { className: args.className }) : null;
      const rows = await ptm.unbookedFamilies(ctx.actor, { 'ptm.manage': ctx.scope }, round.id, section ? { sectionId: section.sectionId } : {});
      return listed(rows.map((r) => ({ pupil: r.studentName, class: r.className, guardians: r.guardians.map((g) => g.name) })), (r) => `${r.pupil} (${r.class})`, { noun: 'family', extra: { round: round.title } });
    },
  }),

  get_ptm_meeting_briefing: tool({
    module: 'PTM', operation: 'GET', feature: 'ptm',
    description: "For the teacher before one of their PTM meetings: the pupil's briefing — attendance this year, recent published marks, syllabus progress, homework, co-curricular activities and earlier meetings with their open actions. A safeguarding concern is never discussed from here. Read-only.",
    inputSchema: closed({ bookingRef: text(30, 'e.g. PTB-0004'), studentName: text(80) }),
    permission: 'ptm.manage',
    service: 'ptm.service.briefing()',
    async run(ctx, args) {
      const rows = await ptm.myBookings(ctx.actor, { 'ptm.manage': ctx.scope }, {});
      const b = pick(rows, args.bookingRef ?? args.studentName, { label: 'PTM meeting of yours', nameOf: (x) => x.studentName, refOf: (x) => x.refNo, describe: (x) => `${x.refNo} ${x.studentName} (${x.date} ${x.time})` });
      const out = await ptm.briefing(ctx.actor, { 'ptm.manage': ctx.scope }, b.id);
      const att = out.attendance?.percentage ?? out.attendance?.pct ?? null;
      return shown(out, `${out.student?.name} (${out.student?.className ?? ''}): attendance ${att !== null ? `${att}%` : 'not available'}; ${out.recentMarks?.length ?? 0} recent mark(s); ${out.previousMeetings?.length ?? 0} earlier meeting(s).`);
    },
  }),

  get_ptm_metrics: tool({
    module: 'PTM', operation: 'GET', feature: 'ptm',
    description: 'How PTM meetings went (one round or all): booked, cancelled, done, no-shows, families met, attendance, the follow-up actions agreed and how many are open or overdue, and families waiting. Teachers see their own meetings. Read-only.',
    inputSchema: closed({ round: text(120) }),
    permission: 'ptm.read',
    anyOf: [['ptm.manage'], ['ptm.read']],
    guard: (ctx) => needAny(ctx, [['ptm.manage'], ['ptm.read']]),
    service: 'ptm.service.metrics()',
    async run(ctx, args) {
      const round = args.round ? await roundNamed(ctx, args.round) : null;
      const m = await ptm.metrics(ctx.actor, ptmScopes(ctx), round ? { roundId: round.id } : {});
      return shown({ round: round?.title ?? null, ...m }, `${round ? `${round.title}: ` : ''}${m.booked} booked, ${m.completed} done, ${m.noShow} no-show(s)${m.attendancePct !== null ? `, ${m.attendancePct}% attended` : ''}; ${m.actionsOpen} follow-up action(s) open${m.actionsOverdue ? `, ${m.actionsOverdue} overdue` : ''}.`);
    },
  }),

  get_ptm_options_for_pupil: tool({
    module: 'PTM', operation: 'GET', feature: 'ptm',
    description: "For a teacher or the office helping a family: in a PTM round, a pupil's teachers with their free slots, the meetings already booked and any waiting-list place, as the family would see them. Read-only.",
    inputSchema: closed({ round: text(120), ...pupil, parentName: text(80, 'Which guardian, when there are two') }),
    permission: 'ptm.manage',
    service: 'ptm.service.bookingOptions()',
    async run(ctx, args) {
      const round = await roundNamed(ctx, args.round);
      const fam = await pupilAndGuardian(ctx, args);
      const out = await ptm.bookingOptions(ctx.actor, ptmScopes(ctx), round.id, { studentId: fam.studentId, parentProfileId: fam.parentId });
      const child = out.children[0];
      const rows = (child?.teachers ?? []).map((t) => ({ teacher: t.name, subjects: t.subjects, freeSlots: t.slots.map((s) => `${s.date} ${s.time}`), booked: t.booking ? `${t.booking.date} ${t.booking.time}` : null, waiting: t.waitlist?.status ?? null }));
      return listed(rows, (r) => `${r.teacher}: ${r.booked ? `booked ${r.booked}` : r.freeSlots.length ? `${r.freeSlots.length} free` : 'full'}`, { noun: 'teacher', extra: { round: round.title, pupil: fam.student } });
    },
  }),

  reserve_ptm_slot_for_family: tool({
    module: 'PTM', operation: 'CREATE', risk: RISK.MEDIUM, affectsOthers: true, feature: 'ptm',
    description: "For a teacher (into their own slots) or the office (any teacher's): book a PTM meeting for a family that asked for help, by the pupil, the slot time (and day) and, for the office, the teacher. The family is told. Confirmed on the website.",
    inputSchema: closed({ round: text(120), ...pupil, parentName: text(80), teacherName: text(80, 'For a PTM manager: whose slot'), time: hm('Slot start, HH:MM'), date: dateStr() }, ['time']),
    permission: 'ptm.manage',
    service: 'ptm.service.listSlots() + book()',
    summarise: (a, _x, p) => `Book ${p?.when ?? a.time} with ${p?.teacher ?? 'you'} for ${p?.student ?? a.studentName ?? a.admissionNo} (${p?.parent ?? 'their guardian'}) in ${p?.round ?? 'the PTM'}`,
    async prepare(ctx, args) {
      const round = await roundNamed(ctx, args.round);
      const fam = await pupilAndGuardian(ctx, args);
      const t = await ptmTeacher(ctx, args.teacherName);
      const slot = await openSlot(ctx, round.id, t.id, args.time, args.date);
      return { ...fam, round: round.title, teacher: t.name, slotId: slot.id, when: `${slot.date} ${slot.time}` };
    },
    async run(ctx, _args, p) {
      const b = await ptm.book(ctx.actor, ptmScopes(ctx), { slotId: p.slotId, studentId: p.studentId, parentProfileId: p.parentId });
      return did('ptm_booked_for_family', b, `Booked ${b.refNo}: ${p.student} with ${p.teacher} on ${p.when}.`);
    },
  }),

  change_family_ptm_booking: tool({
    module: 'PTM', operation: 'ACTION', risk: RISK.MEDIUM, affectsOthers: true, feature: 'ptm',
    description: "For a teacher (their own meetings) or the office (any): cancel a family's booked PTM meeting (step=cancel) or move it to another free slot with the same teacher (step=reschedule, with the new time), with the reason. The family is told. Confirmed on the website.",
    inputSchema: closed({ step: oneOf(['cancel', 'reschedule']), bookingRef: text(30), studentName: text(80), reason: text(300), time: hm('step=reschedule: the new slot start'), date: dateStr('step=reschedule: the new slot day') }, ['step', 'reason']),
    permission: 'ptm.manage',
    service: 'ptm.service.cancelBooking() / reschedule()',
    summarise: (a, _x, p) => (a.step === 'cancel'
      ? `Cancel ${p?.student ?? a.studentName}'s PTM meeting with ${p?.teacher ?? ''} on ${p?.when ?? ''} — ${a.reason}; the family is told`
      : `Move ${p?.student ?? a.studentName}'s PTM meeting with ${p?.teacher ?? ''} from ${p?.when ?? ''} to ${p?.to ?? a.time} — ${a.reason}; the family is told`),
    async prepare(ctx, args) {
      if (args.step === 'reschedule' && !args.time) throw ask('To which time should the meeting move?');
      const b = await staffMeeting(ctx, args);
      let slot = null;
      if (args.step === 'reschedule') slot = await openSlot(ctx, b.roundId, b.teacherId, args.time, args.date);
      return { id: b.id, student: b.student, teacher: b.teacher, when: b.when, slotId: slot?.id ?? null, to: slot ? `${slot.date} ${slot.time}` : null };
    },
    async run(ctx, args, p) {
      const out = args.step === 'cancel'
        ? await ptm.cancelBooking(ctx.actor, ptmScopes(ctx), p.id, { reason: args.reason })
        : await ptm.reschedule(ctx.actor, ptmScopes(ctx), p.id, { slotId: p.slotId, reason: args.reason });
      return did(args.step === 'cancel' ? 'ptm_booking_cancelled' : 'ptm_booking_moved', out, args.step === 'cancel' ? `Cancelled ${p.student}'s meeting on ${p.when}.` : `Moved ${p.student}'s meeting to ${p.to}.`);
    },
  }),

  manage_family_ptm_waitlist: tool({
    module: 'PTM', operation: 'ACTION', risk: RISK.MEDIUM, affectsOthers: true, feature: 'ptm',
    description: "For a teacher or the office: put a family on a teacher's PTM waiting list when that teacher is full (step=add; a teacher for their own list), or take a family off a waiting list (step=remove; PTM managers only). Confirmed on the website.",
    inputSchema: closed({ step: oneOf(['add', 'remove']), round: text(120), ...pupil, parentName: text(80), teacherName: text(80, 'Whose list (a PTM manager may name any teacher)') }, ['step']),
    permission: 'ptm.manage',
    guard: (ctx, args) => { if (args.step === 'remove') need(ctx, 'ptm.manage', 'ALL'); },
    service: 'ptm.service.joinWaitlist() / leaveWaitlist()',
    summarise: (a, _x, p) => (a.step === 'add' ? `Put ${p?.student ?? a.studentName} (${p?.parent ?? ''}) on ${p?.teacher ?? 'your'} waiting list for ${p?.round ?? 'the PTM'}` : `Take ${p?.student ?? a.studentName} off ${p?.teacher ?? 'the'} waiting list for ${p?.round ?? 'the PTM'}`),
    async prepare(ctx, args) {
      const round = await roundNamed(ctx, args.round);
      if (args.step === 'add') {
        const fam = await pupilAndGuardian(ctx, args);
        const t = await ptmTeacher(ctx, args.teacherName);
        return { step: 'add', roundId: round.id, round: round.title, ...fam, teacherId: t.id, teacher: t.name };
      }
      const studentId = await resolveStudentId(ctx, { admissionNo: args.admissionNo, studentName: args.studentName });
      const filter = { roundId: round.id, studentId, status: { $in: ['WAITING', 'OFFERED'] } };
      const rows = await PtmWaitlist.find(filter).lean();
      const names = await profileNames(rows.map((w) => w.teacherProfileId));
      const pool = rows.map((w) => ({ id: String(w._id), teacher: names.get(String(w.teacherProfileId)) ?? 'the teacher' }));
      const w = pick(pool, args.teacherName ? stripTitle(args.teacherName) : null, { label: 'waiting-list place', nameOf: (x) => x.teacher, refOf: () => null });
      const st = await Student.findById(studentId).select('firstName lastName').lean();
      return { step: 'remove', id: w.id, teacher: w.teacher, round: round.title, student: `${st?.firstName ?? ''} ${st?.lastName ?? ''}`.trim() };
    },
    async run(ctx, _args, p) {
      if (p.step === 'add') {
        const w = await ptm.joinWaitlist(ctx.actor, ptmScopes(ctx), { roundId: p.roundId, teacherProfileId: p.teacherId, studentId: p.studentId, parentProfileId: p.parentId });
        return did('ptm_waitlist_added', w, `${p.student} is number ${w.position} on ${p.teacher}'s waiting list.`);
      }
      const out = await ptm.leaveWaitlist(ctx.actor, ptmScopes(ctx), p.id);
      return did('ptm_waitlist_removed', out, `${p.student} is off ${p.teacher}'s waiting list.`);
    },
  }),
};

/* ── Review calls ─────────────────────────────────────────── */

const caseIdentity = { caseRef: text(30, 'e.g. RVC-0003'), studentName: text(80, 'The pupil the call is about') };

async function aCase(ctx, { caseRef, studentName }) {
  const page = await calls.list(ctx.actor, ctx.scope, { status: 'all', pageSize: 200 });
  const open = page.items.filter((c) => c.status !== 'CLOSED');
  const pool = !caseRef && open.length ? open : page.items;
  return pick(pool, caseRef ?? studentName, { label: 'review call', nameOf: (c) => c.studentName, refOf: (c) => c.refNo, describe: (c) => `${c.refNo} ${c.studentName} (${words(c.reason)}, ${words(c.status)})` });
}

const reviewTools = {
  get_review_call_metrics: tool({
    module: 'Review calls', operation: 'GET', feature: 'ptm',
    description: 'The review-call follow-up picture: open cases by reason, overdue and open actions, overdue follow-ups, families not reached after several attempts (with the channel to try next) and recent outcomes. Read-only.',
    inputSchema: closed({ attempts: int(1, 10, 'Not reached after this many attempts (default 3)') }),
    permission: 'reviewcalls.manage',
    service: 'reviewcalls.service.metrics()',
    async run(ctx, args) {
      const m = await calls.metrics(ctx.actor, ctx.scope, { attempts: args.attempts });
      return shown(m, `${m.openCases} open review call(s); ${m.overdueActions} overdue action(s), ${m.followUpsOverdue} follow-up(s) overdue${m.notReached?.length ? `; not reached: ${m.notReached.map((n) => n.studentName).join(', ')}` : ''}.`);
    },
  }),

  get_review_call: tool({
    module: 'Review calls', operation: 'GET', feature: 'ptm',
    description: 'One review call by reference or pupil: reason, summary, priority, status, who it is assigned to, the attempts, notes, agreed actions, next follow-up and outcome. Read-only.',
    inputSchema: closed(caseIdentity),
    permission: 'reviewcalls.manage',
    service: 'reviewcalls.service.list() + get()',
    async run(ctx, args) {
      const c = await calls.get(ctx.actor, ctx.scope, (await aCase(ctx, args)).id);
      return shown(c, `${c.refNo} ${c.studentName} (${words(c.reason)}): ${words(c.status)}, ${words(c.priority)} priority, assigned to ${c.assignedName ?? 'nobody'}; ${c.attemptsCount} attempt(s), ${c.openActions} open action(s)${c.nextFollowUpOn ? `, follow up ${day(c.nextFollowUpOn)}` : ''}.`);
    },
  }),

  update_review_call: tool({
    module: 'Review calls', operation: 'UPDATE', risk: RISK.MEDIUM, feature: 'ptm',
    description: "Change a review call's priority, summary or next follow-up date, or hand it to the class teacher (a manager may hand it to any member of staff; they are told). Needs confirmation.",
    inputSchema: closed({ ...caseIdentity, priority: oneOf(['LOW', 'NORMAL', 'HIGH', 'URGENT']), summary: text(2000), nextFollowUpOn: dateStr(), assignTo: text(120, 'The colleague to hand it to') }),
    permission: 'reviewcalls.manage',
    service: 'reviewcalls.service.update()',
    summarise: (a, _x, p) => `Change ${p?.refNo ?? a.caseRef ?? ''} (${p?.student ?? a.studentName ?? ''}): ${[a.priority && `priority → ${words(a.priority)}`, a.summary && `summary "${excerpt(a.summary, 60)}"`, a.nextFollowUpOn && `follow up ${a.nextFollowUpOn}`, p?.assignee && `hand to ${p.assignee}`].filter(Boolean).join(', ')}`,
    async prepare(ctx, args) {
      if (![args.priority, args.summary, args.nextFollowUpOn, args.assignTo].some((v) => v !== undefined)) throw ask('What should change on the review call?');
      const c = await aCase(ctx, args);
      let assignee = null;
      if (args.assignTo) {
        const rows = (await profilesWithRoles(STAFF)).map((x) => ({ id: String(x._id), name: x.displayName }));
        assignee = pick(rows, stripTitle(args.assignTo), { label: 'colleague', refOf: () => null });
      }
      return { id: c.id, refNo: c.refNo, student: c.studentName, assigneeId: assignee?.id ?? null, assignee: assignee?.name ?? null };
    },
    async run(ctx, args, p) {
      const body = {};
      for (const k of ['priority', 'summary', 'nextFollowUpOn']) if (args[k] !== undefined) body[k] = args[k];
      if (p.assigneeId) body.assignedProfileId = p.assigneeId;
      const c = await calls.update(ctx.actor, ctx.scope, p.id, body);
      return did('review_call_updated', c, `${c.refNo} updated.`);
    },
  }),

  get_review_call_briefing: tool({
    module: 'Review calls', operation: 'GET', feature: 'ptm',
    description: "Before a review call: the pupil's briefing — attendance this year, recent published marks, syllabus progress, homework, co-curricular activities and how many guardians are on record. Read-only.",
    inputSchema: closed(caseIdentity),
    permission: 'reviewcalls.manage',
    service: 'reviewcalls.service.briefing()',
    async run(ctx, args) {
      const c = await aCase(ctx, args);
      const out = await calls.briefing(ctx.actor, ctx.scope, c.id);
      const att = out.attendance?.percentage ?? out.attendance?.pct ?? null;
      return shown(out, `${out.student?.name} (${out.student?.className ?? ''}): attendance ${att !== null ? `${att}%` : 'not available'}; ${out.recentMarks?.length ?? 0} recent mark(s); ${out.guardianCount} guardian(s) on record.`);
    },
  }),
};

/* ── Conversations ────────────────────────────────────────── */

const conversationTools = {
  list_unanswered_conversations: tool({
    module: 'Conversations', operation: 'GET', feature: 'conversations',
    description: "Parent conversations waiting for a staff reply for longer than a number of hours (default 48): a teacher's own; the principal sees the whole school. Read-only.",
    inputSchema: closed({ hours: int(1, 720) }),
    permission: 'conversations.use',
    service: 'conversations.service.unansweredQueue()',
    async run(ctx, args) {
      const out = await conversations.unansweredQueue(ctx.actor, ctx.scope, { hours: args.hours });
      const rows = out.items.map((t) => ({ parent: t.parentName, staff: t.staffName, pupil: t.studentName, subject: t.subject, waitingHours: t.waitingHours }));
      return listed(rows, (r) => `${r.parent} about ${r.pupil} (${r.waitingHours} h)`, { noun: 'conversation', extra: { hours: out.hours } });
    },
  }),

  get_conversation_office_hours: tool({
    module: 'Conversations', operation: 'GET', feature: 'conversations',
    description: 'The office-hours note parents see when they message the caller. Read-only.',
    permission: 'conversations.use',
    service: 'conversations.service.getSettings()',
    async run(ctx) {
      const s = await conversations.getSettings(ctx.actor);
      return shown(s, s.officeHoursNote ? `Your office-hours note: "${s.officeHoursNote}".` : 'You have no office-hours note.');
    },
  }),

  reply_to_conversation: tool({
    module: 'Conversations', operation: 'CREATE', risk: RISK.MEDIUM, feature: 'conversations',
    description: "Reply in one of the caller's own open parent-teacher conversations, picked by the other person, the child or the subject. Phone numbers typed into it are removed. Needs confirmation.",
    inputSchema: closed({ message: { type: 'string', minLength: 1, maxLength: 4000 }, withName: text(80, 'The parent or teacher on the other side'), studentName: text(80), subject: text(200) }, ['message']),
    permission: 'conversations.use',
    service: 'conversations.service.list() + reply()',
    summarise: (a, _x, p) => `Reply to ${p?.with ?? a.withName ?? 'the conversation'}${p?.child ? ` about ${p.child}` : ''}: "${excerpt(a.message, 120)}"`,
    async prepare(ctx, args) {
      const page = await conversations.list(ctx.actor, ctx.scope, { view: 'mine', status: 'OPEN', pageSize: 200 });
      const rows = (page.items ?? []).filter((t) => t.mySide).map((t) => ({ id: t.id, with: t.mySide === 'PARENT' ? t.staffName : t.parentName, child: t.studentName, subject: t.subject }));
      let pool = rows;
      if (args.withName) pool = pool.filter((t) => lower(t.with).includes(lower(stripTitle(args.withName))));
      if (args.studentName) pool = pool.filter((t) => lower(t.child).includes(lower(args.studentName)));
      if (args.subject) pool = pool.filter((t) => lower(t.subject).includes(lower(args.subject)));
      if (!pool.length) throw notFound(rows.length ? 'None of your open conversations matches that.' : 'You have no open conversations.');
      if (pool.length > 1) throw ask(`Which conversation? ${pool.slice(0, 6).map((t) => `${t.with} about ${t.child} ("${excerpt(t.subject, 40)}")`).join('; ')}`);
      return pool[0];
    },
    async run(ctx, args, p) {
      const t = await conversations.reply(ctx.actor, ctx.scope, p.id, { body: args.message });
      return did('conversation_replied', t, `Sent to ${p.with}.`);
    },
  }),
};

/* ── Analytics catalogue, saved views, quarterly deliveries ── */

const VIEW_FILTERS = {
  preset: oneOf(['today', 'week', 'month', 'quarter', 'year', 'academicYear', 'financialYear', 'custom']),
  from: dateStr(), to: dateStr(), compare: oneOf(['previous', 'lastYear', 'priorYears', 'custom', 'none']), department: text(40),
};

async function latestReport(ctx, quarter) {
  const page = await quarterly.list(ctx.actor, { pageSize: 100 });
  const rows = page.items.filter((r) => r.latest && (!quarter || r.quarterKey === quarter));
  if (!rows.length) throw notFound(quarter ? `There is no report for ${quarter}.` : 'No quarterly report has been generated yet.');
  return rows[0];
}

const analyticsTools = {
  get_analytics_catalogue: tool({
    module: 'Analytics', operation: 'GET', feature: 'analytics',
    description: 'The analytics metric definitions the caller may see: each metric, its definition, unit, date basis and sources, grouped by department, with the definitions version. Read-only.',
    inputSchema: closed({ department: text(40) }),
    permission: 'analytics.workspace.read',
    service: 'analytics.service.catalogue()',
    async run(ctx, args) {
      const c = await analytics.catalogue(ctx.actor, ctx.scope);
      const rows = c.metrics.filter((m) => !args.department || lower(m.department) === lower(args.department));
      return listed(rows, (m) => m.label ?? m.key, { noun: 'metric', extra: { version: c.version, departments: c.departments.map((d) => d.label ?? d.key) } });
    },
  }),

  list_analytics_views: tool({
    module: 'Analytics', operation: 'GET', feature: 'analytics',
    description: "The caller's own saved analytics views (name, period, comparison, department). Read-only.",
    permission: 'analytics.workspace.read',
    service: 'views.service.list()',
    async run(ctx) {
      const { items } = await views.list(ctx.actor);
      return listed(items, (v) => `${v.name}${v.filters?.preset ? ` (${v.filters.preset})` : ''}`, { noun: 'saved view' });
    },
  }),

  save_analytics_view: tool({
    module: 'Analytics', operation: 'CREATE', risk: RISK.LOW, feature: 'analytics',
    description: 'Save (or replace, by name) one of the caller\'s own analytics views: the period, comparison, department, tab and metrics to show. At most 20 per person. Needs confirmation.',
    inputSchema: closed({ name: text(60), ...VIEW_FILTERS, tab: text(40), metricKeys: list(text(80), 30) }, ['name']),
    permission: 'analytics.workspace.read',
    service: 'views.service.save()',
    summarise: (a) => `Save the analytics view "${a.name}"${a.preset ? `: ${a.preset}` : ''}${a.from ? ` ${a.from}–${a.to ?? ''}` : ''}${a.department ? `, ${a.department}` : ''}${a.compare ? `, compared with ${a.compare}` : ''}`,
    async run(ctx, args) {
      const filters = Object.fromEntries(Object.keys(VIEW_FILTERS).filter((k) => args[k] !== undefined).map((k) => [k, args[k]]));
      const v = await views.save(ctx.actor, { name: args.name, filters, tab: args.tab, metricKeys: args.metricKeys });
      return did('analytics_view_saved', v, `Saved the view "${v.name}".`);
    },
  }),

  delete_analytics_view: tool({
    module: 'Analytics', operation: 'DELETE', risk: RISK.LOW, feature: 'analytics',
    description: "Forget one of the caller's own saved analytics views, by name. Needs confirmation.",
    inputSchema: closed({ name: text(60) }, ['name']),
    permission: 'analytics.workspace.read',
    service: 'views.service.list() + remove()',
    summarise: (a, _x, p) => `Forget your saved analytics view "${p?.name ?? a.name}"`,
    async prepare(ctx, args) {
      const { items } = await views.list(ctx.actor);
      const v = pick(items, args.name, { label: 'saved view', refOf: () => null });
      return { id: v.id, name: v.name };
    },
    async run(ctx, _args, p) {
      await views.remove(ctx.actor, p.id);
      return did('analytics_view_removed', { id: p.id }, `Forgot "${p.name}".`);
    },
  }),

  list_quarterly_report_deliveries: tool({
    module: 'Analytics', operation: 'GET', feature: 'analytics',
    description: 'For the principal or administration: who a quarterly report (the latest by default) was sent to, on which channels, and whether each delivery went through or failed. Read-only.',
    inputSchema: closed({ quarter: { type: 'string', pattern: '^FY\\d{4}(-\\d{2})?-Q[1-4]$', description: 'e.g. FY2026-27-Q2' } }),
    permission: 'reports.quarterly.manage', minScope: 'ALL',
    service: 'quarterly.service.deliveries()',
    async run(ctx, args) {
      const r = await latestReport(ctx, args.quarter);
      const rows = (await quarterly.deliveries(ctx.actor, r.id)).map((d) => ({ recipient: d.recipientName, status: d.status, channels: d.channels, error: d.lastError ?? d.error ?? null }));
      return listed(rows, (d) => `${d.recipient} (${words(d.status)})`, { noun: 'delivery', extra: { quarter: r.quarterKey, version: r.version } });
    },
  }),

  send_quarterly_report: tool({
    module: 'Analytics', operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true, feature: 'analytics',
    description: "For the principal or administration: send a generated quarterly report (the latest by default) to its recipients now — failed deliveries are retried and anyone who has since become a recipient is added. Confirmed on the website.",
    inputSchema: closed({ quarter: { type: 'string', pattern: '^FY\\d{4}(-\\d{2})?-Q[1-4]$' } }),
    permission: 'reports.quarterly.manage', minScope: 'ALL',
    service: 'quarterly.service.retryDeliveries()',
    summarise: (a, _x, p) => `Send the ${p?.quarter ?? a.quarter ?? 'latest'} quarterly report (version ${p?.version ?? ''}) to its recipients now, retrying failed deliveries`,
    async prepare(ctx, args) {
      const r = await latestReport(ctx, args.quarter);
      if (r.status !== 'GENERATED') throw new AppError(`The ${r.quarterKey} report is ${words(r.status)}; generate it first.`, 409, [], 'NOT_GENERATED');
      return { id: r.id, quarter: r.quarterKey, version: r.version };
    },
    async run(ctx, _args, p) {
      const out = await quarterly.retryDeliveries(ctx.actor, p.id);
      return did('quarterly_report_delivered', { id: p.id, ...out }, `Sent the ${p.quarter} report${out?.sent !== undefined ? `: ${out.sent} sent${out.failed ? `, ${out.failed} failed` : ''}` : ''}.`);
    },
  }),
};

/* ── Campus, dashboard, search ────────────────────────────── */

const LIVE_KINDS = ['room', 'class', 'teacher', 'bus', 'lab', 'zone', 'department', 'gate'];
const isStaff = (ctx) => !FAMILY_ROLES.has(ctx.actor?.roleKey);

async function facilityNamed(ctx, name) {
  const rows = (await Facility.find({}).select('name code restricted kind').lean()).filter((f) => isStaff(ctx) || !f.restricted).map((f) => ({ id: String(f._id), name: f.name, code: f.code, kind: f.kind }));
  return pick(rows, name, { label: 'place', describe: (f) => `${f.name} (${words(f.kind)})` });
}

async function liveId(ctx, kind, name) {
  if (kind === 'gate') return null;
  if (kind === 'bus' && !isStaff(ctx)) return null;
  if (!name) {
    if (kind === 'bus') return null;
    throw ask(`Which ${kind}?`);
  }
  if (kind === 'room') return (await facilityNamed(ctx, name)).id;
  if (kind === 'class') return (await resolveSection({ ...ctx, scope: 'ALL' }, { className: name }))?.sectionId ?? null;
  if (kind === 'teacher') {
    const rows = (await profilesWithRoles(['TEACHER', 'PRINCIPAL'])).map((p) => ({ id: String(p._id), name: p.displayName }));
    return pick(rows, stripTitle(name), { label: 'teacher', refOf: () => null }).id;
  }
  if (kind === 'department') {
    const rows = (await campusDepartments(ctx.actor, {})).map((d) => ({ id: d.code, name: d.name, code: d.code }));
    return pick(rows, name, { label: 'department' }).id;
  }
  const layers = await campusLayers(ctx.actor, {});
  if (kind === 'lab') return pick((layers.labs ?? []).map((l) => ({ id: l.labId, name: l.name })), name, { label: 'lab', refOf: () => null }).id;
  if (kind === 'bus') return pick((layers.transport?.vehicles ?? []).map((v) => ({ id: v.id, name: v.registrationNo })), name, { label: 'bus', refOf: () => null }).id;
  return pick((layers.greenery?.items ?? []).map((z) => ({ id: String(z.id), name: z.title ?? 'Zone' })), name, { label: 'zone', refOf: () => null }).id;
}

/** A section of the live detail page as one line. */
function sectionLine(s) {
  if (s.type === 'facts') return `${s.title}: ${(s.rows ?? []).map((r) => `${r.label} ${r.value}`).join(', ')}`;
  if (s.type === 'metrics') return `${s.title}: ${(s.items ?? []).map((m) => `${m.value} ${m.label}`).join(', ')}`;
  if (s.type === 'list') return `${s.title}: ${(s.items ?? []).slice(0, 6).map((i) => i.title).join('; ') || s.empty || 'none'}`;
  if (s.type === 'note') return `${s.title}: ${s.text}`;
  return s.title;
}

const campusTools = {
  get_campus_layers: tool({
    module: 'Campus', operation: 'GET',
    description: "The campus map's operational layers the caller may see right now: labs in use, the transport bay, today's cover, open tasks, the gate (counts only), club activities and greenery. Read-only.",
    permission: 'campus.map.read',
    service: 'layers.service.campusLayers()',
    async run(ctx) {
      const out = await campusLayers(ctx.actor);
      const on = Object.entries(out.layers).filter(([, v]) => v).map(([k]) => k);
      return shown(out, on.length ? `Layers you can see: ${on.join(', ')}${out.unavailable.length ? ` (${out.unavailable.join(', ')} unavailable just now)` : ''}.` : 'No operational layers are available to you.');
    },
  }),

  get_campus_live_detail: tool({
    module: 'Campus', operation: 'GET',
    description: "Live detail of one room, class, teacher, bus, lab, green zone, department or the gate: what is happening there now and next. Families see their own class (and their own bus) only. Read-only.",
    inputSchema: closed({ kind: oneOf(LIVE_KINDS), name: text(120, 'The room, class ("7B"), teacher, bus registration, lab, zone or department') }, ['kind']),
    permission: 'campus.map.read',
    service: 'live-detail.service.liveDetail()',
    async run(ctx, args) {
      const id = await liveId(ctx, args.kind, args.name);
      const out = await liveDetail(ctx.actor, { kind: args.kind, id });
      return shown(out, `${out.title}${out.subtitle ? ` (${out.subtitle})` : ''}. ${(out.sections ?? []).map(sectionLine).join('. ')}`);
    },
  }),

  get_facility_detail: tool({
    module: 'Campus', operation: 'GET',
    description: "One place on campus (a room, lab, hall, ground, office) by name: what it is, its capacity and status, the rooms inside it and, for staff, what is timetabled there today. Restricted places are shown to staff only. Read-only.",
    inputSchema: closed({ name: text(120, 'e.g. "Physics lab" or "Room 204"'), at: hm('For staff: another time today, HH:MM') }, ['name']),
    permission: 'campus.map.read',
    service: 'campus.service.facilityDetail()',
    async run(ctx, args) {
      const f = await facilityNamed(ctx, args.name);
      const out = await campus.facilityDetail(ctx.actor, f.id, { at: args.at ?? null });
      return shown(out, `${out.name} (${words(out.kind)})${out.capacity ? `, capacity ${out.capacity}` : ''}${out.status ? `, ${words(out.status)}` : ''}${out.children?.length ? `; contains ${out.children.map((c) => c.name).join(', ')}` : ''}.`);
    },
  }),

  get_role_dashboard: tool({
    module: 'Campus', operation: 'GET',
    description: "The caller's own dashboard figures for a period: a teacher's classes, a parent's child (name which child), a student's own record, or a staff role's queue — the headline numbers and lists. Read-only.",
    inputSchema: closed({ days: int(1, 400, 'The period in days, e.g. 7 or 30'), childName: text(80, "For a parent: which child") }),
    permission: 'ai.copilot.use',
    service: 'dashboards.service.roleDashboard()',
    async run(ctx, args) {
      let child = null;
      if (args.childName) {
        const ids = await ownStudentIds(ctx.actor);
        const rows = (await Student.find({ _id: { $in: ids } }).select('firstName lastName').lean()).map((s) => ({ id: String(s._id), name: `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() }));
        child = pick(rows, args.childName, { label: 'child of yours', refOf: () => null }).id;
      }
      const out = await roleDashboard(ctx.actor, { days: args.days ?? 0, child });
      const kpis = (out.kpis ?? []).map((k) => `${k.label} ${k.value}${k.detail ? ` (${k.detail})` : ''}`);
      return shown(out, out.view ? `${out.title ?? 'Your dashboard'}: ${kpis.join('; ') || 'nothing to show yet'}.` : 'There is no dashboard for your role.');
    },
  }),

  search_everything: tool({
    module: 'Campus', operation: 'GET', resultShape: 'SUMMARY',
    description: "Search everything the caller may see in one go — students, teachers, staff, classes, notices, books, events and more — by a name or words, grouped by kind. Read-only.",
    inputSchema: closed({ query: { type: 'string', minLength: 2, maxLength: 80 }, kinds: list(text(30), 30, 'Only these kinds, e.g. ["students","announcements"]') }, ['query']),
    permission: 'ai.copilot.use',
    service: 'search.service.search()',
    async run(ctx, args) {
      const out = await search.search(ctx.actor, args.query, { types: args.kinds?.length ? args.kinds : null });
      const groups = out.groups.map((g) => ({ kind: g.label, items: g.items.map((i) => ({ title: i.title, subtitle: i.subtitle ?? null })) }));
      return shown({ query: out.q, total: out.total, groups }, out.total ? `${out.total} result(s) for "${out.q}": ${groups.map((g) => `${g.kind}: ${g.items.slice(0, 5).map((i) => i.title).join(', ')}`).join('; ')}.` : `Nothing matches "${out.q}".`);
    },
  }),
};

export const tools = {
  ...notificationTools,
  ...aiTools,
  ...ptmTools,
  ...reviewTools,
  ...conversationTools,
  ...analyticsTools,
  ...campusTools,
};
