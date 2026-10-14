import { plural, countLabel } from '../../utils/plural.js';
import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { Enrollment } from '../../models/student.model.js';
import { Payment, Invoice } from '../../models/fee.model.js';
import { ApprovalRequest } from '../../models/approval.model.js';
import { WorkOrder } from '../../models/facility.model.js';
import { CommunityPost } from '../../models/community.model.js';
import { Correspondence, InstitutionEvent } from '../../models/administration.model.js';
import { Lead } from '../../models/lead.model.js';
import { OnlineClass } from '../../models/onlineClass.model.js';
import { getTeacherSectionIds } from '../../utils/scope.js';
import { logger } from '../../utils/logger.js';
import * as compliance from '../compliance/compliance.service.js';
import * as lectures from '../lectures/lecture.service.js';
import { startOfDayUtc } from '../ops/common.js';
import { localDate, localMidnight } from '../../utils/periods.js';

/**
 * The interactive part of every role's home: charts, a live activity feed,
 * department tiles and a short spoken briefing.
 *
 * Each piece is offered only to a role that may read the records behind it,
 * and computed from those records: a chart with no data says so rather than
 * drawing a flat line, and a piece that fails is left out with a note instead
 * of taking the screen down. Every chart and tile links to the page behind it.
 */

const DAY = 86_400_000;
const can = (actor, key, scope = null) => {
  const held = actor.permissions?.[key];
  return Boolean(held) && (!scope || held === scope);
};
const ist = (d) => new Date(new Date(d).getTime() + 330 * 60_000);
// Formatters are built once: constructing one costs far more than using it, and these run per chart point.
const DAY_FMT = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const MONTH_FMT = new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit', timeZone: 'Asia/Kolkata' });
const WEEKDAY_FMT = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' });
const dayLabel = (d) => DAY_FMT.format(new Date(d));
const monthLabel = (d) => MONTH_FMT.format(new Date(d));

async function attempt(name, fn) {
  try {
    return await fn();
  } catch (err) {
    logger.warn(`Pulse ${name} unavailable: ${err.message}`);
    return null;
  }
}

const chart = (key, title, type, points, { unit = 'count', link = null, definition, empty = 'No data yet' } = {}) => ({
  key, title, type, unit, link, definition,
  points,
  status: points.some((p) => p.value !== null && p.value !== 0) ? 'OK' : 'EMPTY',
  emptyText: empty,
});

// ── charts ───────────────────────────────────────────────────────────────

async function attendanceTrend(actor) {
  let enrollmentFilter = {};
  if (!can(actor, 'attendance.read', 'ALL')) {
    if (actor.roleKey !== 'TEACHER') return null;
    const sections = await getTeacherSectionIds(actor.profileId);
    if (!sections.length) return null;
    const ids = await Enrollment.find({ sectionId: { $in: sections } }).distinct('_id');
    enrollmentFilter = { enrollmentId: { $in: ids } };
  }
  const from = new Date(startOfDayUtc().getTime() - 27 * DAY);
  const rows = await AttendanceRecord.aggregate([
    { $match: { date: { $gte: from }, periodNo: null, ...enrollmentFilter } },
    { $group: { _id: '$date', marked: { $sum: 1 }, present: { $sum: { $cond: [{ $in: ['$status', ['PRESENT', 'LATE']] }, 1, 0] } } } },
    { $sort: { _id: 1 } },
  ]);
  // School days only: a day with no register taken is not a 0% day.
  const points = rows.slice(-14).map((r) => ({ label: dayLabel(r._id), value: r.marked ? Math.round((r.present / r.marked) * 1000) / 10 : null, detail: `${r.present} of ${r.marked} present` }));
  return chart('attendance', can(actor, 'attendance.read', 'ALL') ? 'Attendance, last school days' : 'Attendance in my classes', 'line', points, {
    unit: 'percent', link: actor.roleKey === 'TEACHER' ? '/attendance' : '/attendance', definition: 'Present or late ÷ students marked, whole-day register, for each day a register was taken.', empty: 'No register has been taken in the last four weeks.',
  });
}

async function feeCollection(actor) {
  if (!can(actor, 'fees.read', 'ALL')) return null;
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const rows = await Payment.aggregate([
    { $match: { createdAt: { $gte: start }, status: 'SUCCESS', recordStatus: 'PUBLISHED' } },
    { $group: { _id: { y: { $year: '$createdAt' }, m: { $month: '$createdAt' } }, paise: { $sum: '$amountPaise' }, n: { $sum: 1 } } },
  ]);
  const points = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const r = rows.find((x) => x._id.y === d.getUTCFullYear() && x._id.m === d.getUTCMonth() + 1);
    return { label: monthLabel(d), value: r ? r.paise : 0, detail: r ? plural(r.n, 'payment') : 'No payments' };
  });
  const overdue = await Invoice.countDocuments({ dueOn: { $lt: now }, $expr: { $lt: ['$paidPaise', '$totalPaise'] }, status: { $ne: 'CANCELLED' } });
  return { ...chart('fees', 'Fees collected, last six months', 'bar', points, { unit: 'paise', link: '/fees', definition: 'Successful, published payments by the month they were recorded.' }), footnote: `${overdue} invoice(s) overdue` };
}

async function enquiryFunnel(actor) {
  if (!can(actor, 'marketing.read')) return null;
  const order = ['NEW', 'CONTACTED', 'TOUR_SCHEDULED', 'APPLICATION', 'ENROLLED'];
  const rows = await Lead.aggregate([{ $group: { _id: '$stage', n: { $sum: 1 } } }]);
  const at = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  // "Reached" a stage counts everyone at it or beyond, so the funnel only narrows.
  const points = order.map((s, i) => ({ label: s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' '), value: order.slice(i).reduce((n, k) => n + (at[k] ?? 0), 0) }));
  return chart('funnel', 'Admissions funnel', 'funnel', points, { link: '/marketing', definition: 'Enquiries that reached each stage or went beyond it. Lost enquiries are not counted.', empty: 'No enquiries recorded yet.' });
}

async function repairAgeing(actor) {
  if (!can(actor, 'facilities.read', 'ALL') || !['ADMIN', 'PRINCIPAL', 'SUPER_ADMIN'].includes(actor.roleKey)) return null;
  const open = await WorkOrder.find({ status: { $in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] } }).select('createdAt priority').lean();
  const age = (w) => (Date.now() - new Date(w.createdAt).getTime()) / DAY;
  const buckets = [['Under 3 days', 0, 3], ['3–7 days', 3, 7], ['1–4 weeks', 7, 30], ['Over a month', 30, Infinity]];
  const points = buckets.map(([label, lo, hi]) => {
    const inIt = open.filter((w) => age(w) >= lo && age(w) < hi);
    return { label, value: inIt.length, detail: `${inIt.filter((w) => w.priority === 'URGENT').length} urgent`, tone: lo >= 7 && inIt.length ? 'bad' : 'neutral' };
  });
  return chart('repairs', 'Open repairs by age', 'ageing', points, { link: '/facilities?tab=work', definition: 'Open maintenance work orders, by days since they were reported.', empty: 'No open repairs.' });
}

async function approvalsFlow(actor) {
  if (!can(actor, 'approvals.read', 'ALL')) return null;
  const since = new Date(Date.now() - 30 * DAY);
  const rows = await ApprovalRequest.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  const at = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const points = [['Waiting', 'PENDING'], ['Returned', 'RETURNED'], ['Approved', 'APPROVED'], ['Rejected', 'REJECTED'], ['Withdrawn', 'WITHDRAWN']]
    .map(([label, k]) => ({ label, value: at[k] ?? 0, tone: k === 'PENDING' ? 'warn' : k === 'REJECTED' ? 'bad' : k === 'APPROVED' ? 'good' : 'neutral' }));
  return chart('approvals', 'Requests in the last 30 days', 'bar', points, { link: '/approvals', definition: 'Approval requests raised in the last 30 days, by where they stand now.', empty: 'No requests in the last 30 days.' });
}

async function classesAhead(actor) {
  if (!can(actor, 'lectures.read')) return null;
  const mine = await lectures.list(actor, {});
  // Local midnight in the school's zone: UTC midnight is 05:30 in India, so
  // between midnight and 05:30 "today" would otherwise be yesterday.
  const local = localDate(new Date());
  const today = localMidnight(local.y, local.m, local.d);
  const points = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(today.getTime() + i * DAY);
    const n = mine.filter((c) => {
      const d = ist(c.startsAt);
      const t = ist(day);
      return d.getUTCFullYear() === t.getUTCFullYear() && d.getUTCMonth() === t.getUTCMonth() && d.getUTCDate() === t.getUTCDate();
    });
    return { label: i === 0 ? 'Today' : WEEKDAY_FMT.format(day), value: n.length, detail: n.map((c) => c.title).slice(0, 3).join(', ') || 'Nothing' };
  });
  return chart('classes', 'Online classes this week', 'bar', points, { link: '/lectures', definition: 'Online classes and meetings you host or are invited to, by day.', empty: 'No online classes this week.' });
}

async function complianceAhead(actor) {
  if (!can(actor, 'compliance.read')) return null;
  const items = await compliance.calendar({ days: 90 });
  const overdue = items.filter((i) => i.overdue).length;
  const now = new Date();
  const points = [
    { label: 'Overdue', value: overdue, tone: overdue ? 'bad' : 'good' },
    ...Array.from({ length: 3 }, (_, i) => {
      const from = new Date(now.getTime() + i * 30 * DAY);
      const to = new Date(from.getTime() + 30 * DAY);
      return { label: i === 0 ? 'Next 30 days' : `${i * 30 + 1}–${(i + 1) * 30} days`, value: items.filter((x) => !x.overdue && new Date(x.renewBy ?? x.date) >= from && new Date(x.renewBy ?? x.date) < to).length, tone: 'neutral' };
    }),
  ];
  return chart('compliance', 'Compliance deadlines', 'bar', points, { link: '/compliance', definition: 'Returns, renewals, policy reviews, trainings and agreement notice dates.', empty: 'Nothing falls due in the next 90 days.' });
}

// ── activity ─────────────────────────────────────────────────────────────

async function activity(actor) {
  const since = new Date(Date.now() - 14 * DAY);
  const items = [];
  const push = (at, kind, text, link) => { if (at) items.push({ at, kind, text, link }); };
  const tasks = [];

  if (can(actor, 'approvals.read', 'ALL')) {
    tasks.push(ApprovalRequest.find({ $or: [{ createdAt: { $gte: since } }, { decidedAt: { $gte: since } }] }).sort({ updatedAt: -1 }).limit(10).select('title status requesterName createdAt decidedAt').lean()
      .then((rows) => rows.forEach((r) => (r.decidedAt
        ? push(r.decidedAt, r.status === 'APPROVED' ? 'approved' : 'decided', `"${r.title}" was ${String(r.status).toLowerCase()}`, `/approvals?id=${r._id}`)
        : push(r.createdAt, 'request', `${r.requesterName ?? 'Someone'} asked for approval: "${r.title}"`, `/approvals?id=${r._id}`)))));
  } else if (can(actor, 'approvals.read')) {
    tasks.push(ApprovalRequest.find({ requesterProfileId: actor.profileId, decidedAt: { $gte: since } }).limit(5).select('title status decidedAt').lean()
      .then((rows) => rows.forEach((r) => push(r.decidedAt, r.status === 'APPROVED' ? 'approved' : 'decided', `Your request "${r.title}" was ${String(r.status).toLowerCase()}`, `/approvals?id=${r._id}`))));
  }
  if (can(actor, 'facilities.read', 'ALL') && ['ADMIN', 'PRINCIPAL', 'SUPER_ADMIN'].includes(actor.roleKey)) {
    tasks.push(WorkOrder.find({ $or: [{ createdAt: { $gte: since } }, { resolvedAt: { $gte: since } }] }).sort({ updatedAt: -1 }).limit(8).select('title facilityId createdAt resolvedAt priority').populate('facilityId', 'name').lean()
      .then((rows) => rows.forEach((w) => (w.resolvedAt
        ? push(w.resolvedAt, 'fixed', `Repaired: ${w.title}${w.facilityId?.name ? ` (${w.facilityId.name})` : ''}`, `/facilities?tab=work&id=${w._id}`)
        : push(w.createdAt, w.priority === 'URGENT' ? 'urgent' : 'repair', `Reported: ${w.title}${w.facilityId?.name ? ` (${w.facilityId.name})` : ''}`, `/facilities?tab=work&id=${w._id}`)))));
  }
  if (can(actor, 'correspondence.read', 'ALL')) {
    tasks.push(Correspondence.find({ createdAt: { $gte: since }, direction: 'INWARD' }).sort({ createdAt: -1 }).limit(6).select('subject counterpartyName createdAt').lean()
      .then((rows) => rows.forEach((c) => push(c.createdAt, 'letter', `Letter from ${c.counterpartyName}: ${c.subject}`, `/correspondence?id=${c._id}`))));
  }
  if (can(actor, 'events.read')) {
    tasks.push(InstitutionEvent.find({ updatedAt: { $gte: since }, status: { $in: ['APPROVED', 'IN_PREPARATION', 'LIVE', 'COMPLETED'] } }).sort({ updatedAt: -1 }).limit(5).select('title status startsAt updatedAt').lean()
      .then((rows) => rows.forEach((e) => push(e.updatedAt, 'event', `${e.title}: ${String(e.status).toLowerCase().replace(/_/g, ' ')}`, `/events?id=${e._id}`))));
  }
  if (can(actor, 'community.read')) {
    // Published posts only, and only the ones this person's newsroom shows.
    tasks.push(CommunityPost.find({ status: 'PUBLISHED', publishedAt: { $gte: since }, audience: { $in: ['PUBLIC', 'INSTITUTION', 'CAMPUS'] } }).sort({ publishedAt: -1 }).limit(5).select('title body publishedAt').lean()
      .then((rows) => rows.forEach((p) => push(p.publishedAt, 'post', `Newsroom: ${p.title ?? String(p.body ?? '').slice(0, 60)}`, '/newsroom'))));
  }
  if (can(actor, 'lectures.read')) {
    tasks.push(OnlineClass.find({ status: 'LIVE' }).select('_id').lean().then(async (live) => {
      if (!live.length) return;
      const mine = (await lectures.list(actor, {})).filter((c) => c.status === 'LIVE');
      mine.forEach((c) => push(new Date(), 'live', `Live now: ${c.title}`, `/lectures?id=${c.id}`));
    }));
  }
  await Promise.all(tasks.map((t) => t.catch((err) => logger.warn(`Pulse activity source failed: ${err.message}`))));
  return items.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 15);
}

// ── departments ──────────────────────────────────────────────────────────

async function departments(actor) {
  const tiles = [];
  const now = new Date();
  const add = async (name, key, need, fn) => {
    if (!need) return;
    const out = await attempt(`department ${key}`, fn);
    if (out) tiles.push({ key, name, ...out });
  };
  await Promise.all([
    add('Administration', 'administration', can(actor, 'correspondence.read', 'ALL') || can(actor, 'facilities.manage'), async () => {
      const [letters, repairs, events] = await Promise.all([
        Correspondence.countDocuments({ status: { $nin: ['CLOSED', 'NO_ACTION', 'DISPATCHED'] } }),
        WorkOrder.countDocuments({ status: { $in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] } }),
        InstitutionEvent.countDocuments({ startsAt: { $gte: now, $lt: new Date(now.getTime() + 14 * DAY) }, status: { $nin: ['CANCELLED', 'REJECTED'] } }),
      ]);
      return { link: '/correspondence', lines: [[letters, 'open letters'], [repairs, 'open repairs'], [events, 'events in 2 weeks']], attention: repairs > 10 || letters > 10 };
    }),
    add('Finance', 'finance', can(actor, 'fees.read', 'ALL') || can(actor, 'procurement.read', 'ALL'), async () => {
      const [overdue, purchases] = await Promise.all([
        can(actor, 'fees.read', 'ALL') ? Invoice.countDocuments({ dueOn: { $lt: now }, $expr: { $lt: ['$paidPaise', '$totalPaise'] }, status: { $ne: 'CANCELLED' } }) : null,
        can(actor, 'approvals.read', 'ALL') ? ApprovalRequest.countDocuments({ status: 'PENDING', category: { $in: ['PROCUREMENT', 'PAYMENT', 'BUDGET', 'CAPEX', 'PAYROLL_RUN', 'PAYROLL_EXCEPTION', 'FUNDING', 'FEE_REFUND'] } }) : null,
      ]);
      return { link: can(actor, 'fees.read', 'ALL') ? '/fees' : '/procurement', lines: [[overdue, 'overdue invoices'], [purchases, 'money decisions waiting']].filter(([v]) => v !== null), attention: Boolean(overdue) };
    }),
    add('Admissions', 'admissions', can(actor, 'marketing.read'), async () => {
      const fresh = await Lead.countDocuments({ createdAt: { $gte: new Date(now.getTime() - 7 * DAY) } });
      const waiting = await Lead.countDocuments({ stage: 'NEW' });
      return { link: '/marketing', lines: [[fresh, 'enquiries this week'], [waiting, 'not yet contacted']], attention: waiting > 5 };
    }),
    add('Compliance', 'compliance', can(actor, 'compliance.read'), async () => {
      const items = await compliance.calendar({ days: 30 });
      const overdue = items.filter((i) => i.overdue).length;
      return { link: '/compliance', lines: [[overdue, 'overdue'], [items.length - overdue, 'due within 30 days']], attention: overdue > 0 };
    }),
    add('Learning', 'learning', can(actor, 'lectures.read'), async () => {
      const s = await lectures.stats(actor);
      return { link: '/lectures', lines: [[s.liveNow, 'live now'], [s.next24Hours, 'in the next 24 hours']], attention: false };
    }),
    add('Community', 'community', can(actor, 'community.moderate'), async () => {
      const pending = await CommunityPost.countDocuments({ status: 'PENDING_REVIEW' });
      return { link: '/newsroom?tab=review', lines: [[pending, 'posts to review']], attention: pending > 0 };
    }),
  ]);
  const order = ['administration', 'finance', 'admissions', 'compliance', 'learning', 'community'];
  return tiles.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

// ── briefing ─────────────────────────────────────────────────────────────

function briefing(actor, { charts, departments: tiles, decisions }) {
  const hour = ist(new Date()).getUTCHours();
  const lines = [`Good ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}${actor.displayName ? `, ${actor.displayName.split(' ')[0]}` : ''}.`];
  if (decisions) lines.push(`${decisions} decision${decisions === 1 ? ' is' : 's are'} waiting on you.`);
  const att = charts.find((c) => c.key === 'attendance' && c.status === 'OK');
  const last = att?.points.at(-1);
  if (last?.value != null) lines.push(`Attendance on ${last.label} was ${last.value} percent.`);
  for (const t of tiles.filter((x) => x.attention)) {
    const [n, what] = t.lines.find(([v]) => v) ?? [];
    if (n) lines.push(`${t.name}: ${n} ${what}.`);
  }
  const classes = charts.find((c) => c.key === 'classes');
  if (classes?.points[0]?.value) lines.push(`You have ${classes.points[0].value} online class${classes.points[0].value === 1 ? '' : 'es'} today.`);
  if (lines.length === 1) lines.push('Nothing needs your attention right now.');
  return lines;
}

export async function pulse(actor, { decisions = 0 } = {}) {
  const charts = (await Promise.all([
    attempt('attendance', () => attendanceTrend(actor)),
    attempt('fees', () => feeCollection(actor)),
    attempt('approvals', () => approvalsFlow(actor)),
    attempt('classes', () => classesAhead(actor)),
    attempt('compliance', () => complianceAhead(actor)),
    attempt('funnel', () => enquiryFunnel(actor)),
    attempt('repairs', () => repairAgeing(actor)),
  ])).filter(Boolean);
  const [feed, tiles] = await Promise.all([attempt('activity', () => activity(actor)), attempt('departments', () => departments(actor))]);
  // Each tile line reads in the right number ("1 open letter", "2 open letters").
  const worded = (tiles ?? []).map((t) => ({ ...t, lines: (t.lines ?? []).map(([n, label]) => [n, countLabel(n, label)]) }));
  const out = { charts, activity: feed ?? [], departments: worded, asOf: new Date().toISOString() };
  out.briefing = briefing(actor, { ...out, decisions });
  return out;
}
