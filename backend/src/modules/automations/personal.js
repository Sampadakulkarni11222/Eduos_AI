import { PersonalAutomation, PERSONAL_FREQUENCIES } from '../../models/automation.model.js';
import { DueItem } from '../../models/dueItem.model.js';
import { Invoice } from '../../models/fee.model.js';
import { Enrollment } from '../../models/student.model.js';
import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { AppError } from '../../utils/AppError.js';
import { localMidnight } from '../../utils/periods.js';
import { writtenDatesIn } from '../../utils/naturalDates.js';
import { getTeacherSectionIds } from '../../utils/scope.js';
import { profileNames } from '../ops/common.js';
import { sendOperational } from '../messaging/messaging.service.js';
import * as insights from '../insights/insights.service.js';
import * as approvals from '../approvals/approval.service.js';
import { absentOn } from '../staff/cover.service.js';
import { overdueList } from '../library/library.desk.js';
import { logger } from '../../utils/logger.js';
import { localClock, actorFromProfile, addDays, DAY_MS } from './automations.runtime.js';
import { unmarkedSections, briefingSummary } from './automations.jobs.js';
import { WEEKDAYS } from './automations.catalogue.js';

/**
 * A person's own scheduled reminders and reports (Part 7).
 *
 * Set up in Ask AI ("remind me every Friday to submit lesson plans", "every
 * morning send me the list of absent staff"), always as a draft the person
 * confirms; managed there too ("show my reminders", "stop the Friday
 * reminder"). A reminder or report reaches only the person who made it.
 *
 * A REPORT is built at send time AS that person (actorFromProfile), from the
 * same reads the screens use, and only if they still hold the permission it
 * needs -- a role change stops a report rather than widening it. Every figure
 * in it is counted from records; nothing is written by a model.
 */

const MAX_PER_PERSON = 20;

/* ── Reports a person can schedule for themselves ─────────────────────── */

const has = (actor, key, scope = null) => Boolean(actor?.permissions?.[key]) && (!scope || actor.permissions[key] === scope);
const listOf = (names, limit = 8) => (names.length > limit ? `${names.slice(0, limit).join(', ')} and ${names.length - limit} more` : names.join(', '));

export const REPORTS = {
  ABSENT_STAFF: {
    label: 'Absent staff today',
    allowed: (a) => has(a, 'cover.manage', 'ALL') || has(a, 'staffleave.manage', 'ALL'),
    async build(_actor, clock) {
      const away = await absentOn(clock.day);
      const names = await profileNames([...away.keys()]);
      const rows = [...away.values()].map((r) => `${names.get(r.profileId) ?? 'Unknown'} (${r.source === 'LEAVE' ? 'on leave' : 'absent'}${r.half ? `, ${r.half.toLowerCase().replace('_', ' ')}` : ''})`);
      return { count: rows.length, summary: rows.length ? `${rows.length} staff away today: ${listOf(rows)}` : 'no staff are on leave or marked absent today' };
    },
  },
  ABSENT_STUDENTS: {
    label: 'Absent students today',
    allowed: (a) => has(a, 'attendance.read', 'ALL') || (has(a, 'attendance.read') && a.roleKey === 'TEACHER'),
    async build(actor, clock) {
      const sectionIds = actor.permissions['attendance.read'] === 'ALL' ? null : await getTeacherSectionIds(actor.profileId);
      const enrolments = await Enrollment.find({ status: 'ACTIVE', ...(sectionIds && { sectionId: { $in: sectionIds } }) }).select('_id studentId').populate('studentId', 'firstName lastName').lean();
      const absent = await AttendanceRecord.find({ enrollmentId: { $in: enrolments.map((e) => e._id) }, periodNo: null, status: 'ABSENT', date: { $gte: clock.day, $lt: addDays(clock.day, 1) } }).select('enrollmentId').lean();
      const nameOf = new Map(enrolments.map((e) => [String(e._id), `${e.studentId?.firstName ?? ''} ${e.studentId?.lastName ?? ''}`.trim()]));
      const names = absent.map((r) => nameOf.get(String(r.enrollmentId))).filter(Boolean);
      const where = sectionIds ? 'in your classes' : 'in school';
      return { count: names.length, summary: names.length ? `${names.length} student(s) absent ${where} today: ${listOf(names)}` : `no student is marked absent ${where} today (so far)` };
    },
  },
  UNMARKED_REGISTERS: {
    label: 'Registers not marked',
    allowed: (a) => has(a, 'attendance.read', 'ALL'),
    async build(_actor, clock) {
      const open = await unmarkedSections(clock.day);
      return { count: open.length, summary: open.length ? `${open.length} class register(s) not marked yet: ${listOf(open.map((s) => s.class))}` : 'every class register has marks today' };
    },
  },
  PENDING_TASKS: {
    label: 'My open tasks',
    allowed: () => true,
    async build(actor, clock) {
      const items = await DueItem.find({ status: { $in: ['OPEN', 'ACKNOWLEDGED'] }, $or: [{ ownerProfileId: actor.profileId }, { delegateProfileId: actor.profileId }] }).select('title dueAt').sort({ dueAt: 1 }).limit(200).lean();
      const overdue = items.filter((i) => new Date(i.dueAt) < clock.day).length;
      return { count: items.length, summary: items.length ? `${items.length} open task(s)${overdue ? `, ${overdue} overdue` : ''}; next: ${listOf(items.slice(0, 3).map((i) => i.title), 3)}` : 'you have no open tasks' };
    },
  },
  PENDING_APPROVALS: {
    label: 'Approvals waiting on me',
    allowed: (a) => has(a, 'approvals.read'),
    async build(actor) {
      const rows = await approvals.inbox(actor);
      const list = Array.isArray(rows) ? rows : (rows?.items ?? rows?.rows ?? []);
      return { count: list.length, summary: list.length ? `${list.length} approval(s) waiting on you` : 'no approvals are waiting on you' };
    },
  },
  TODAY_BRIEFING: {
    label: 'What needs me today',
    allowed: (a) => has(a, 'institution.read'),
    async build(actor) {
      const home = await insights.home(actor);
      return { count: null, summary: briefingSummary(home) };
    },
  },
  OVERDUE_FEES: {
    label: 'Overdue fees',
    allowed: (a) => has(a, 'fees.read', 'ALL'),
    async build(_actor, clock) {
      const rows = await Invoice.find({ status: { $in: ['PENDING', 'PARTIAL', 'OVERDUE'] }, voidedAt: null, dueOn: { $lt: clock.day } }).select('totalPaise paidPaise').lean();
      const owed = rows.filter((r) => (r.totalPaise ?? 0) > (r.paidPaise ?? 0));
      const paise = owed.reduce((n, r) => n + (r.totalPaise - (r.paidPaise ?? 0)), 0);
      return { count: owed.length, summary: owed.length ? `${owed.length} overdue invoice(s), ₹${(paise / 100).toLocaleString('en-IN')} outstanding` : 'no invoice is overdue' };
    },
  },
  LIBRARY_OVERDUE: {
    label: 'Overdue library books',
    allowed: (a) => has(a, 'library.manage', 'ALL') || has(a, 'library.read', 'ALL'),
    async build(_actor, clock) {
      const rows = await overdueList({ now: clock.now });
      return { count: rows.length, summary: rows.length ? `${rows.length} book(s) overdue` : 'no books are overdue' };
    },
  },
};
export const REPORT_KEYS = Object.keys(REPORTS);

/* ── Schedules ─────────────────────────────────────────────────────────── */

const pad = (n) => String(n).padStart(2, '0');
const at12 = (h, m) => `${((h + 11) % 12) + 1}${m ? `:${pad(m)}` : ''} ${h < 12 ? 'am' : 'pm'}`;

/** "every Friday at 9 am", "every weekday at 8 am", "on 2026-10-25 at 3 pm". */
export function describeSchedule(s) {
  const time = at12(s.hour, s.minute ?? 0);
  switch (s.frequency) {
    case 'ONCE': return `on ${s.onDate} at ${time}`;
    case 'DAILY': return `every day at ${time}`;
    case 'WEEKDAYS': return `every weekday (Mon–Fri) at ${time}`;
    case 'WEEKLY': return `every ${(s.weekdays ?? []).map((d) => WEEKDAYS[d]).join(' and ')} at ${time}`;
    case 'MONTHLY': return `on day ${s.dayOfMonth} of every month at ${time}`;
    default: return '';
  }
}

/** The first moment after `after` when the schedule fires, in the school's time zone; null when it never will again. */
export function nextRunAt(s, after = new Date()) {
  const start = localClock(after).day;
  for (let i = 0; i < 400; i += 1) {
    const day = addDays(start, i);
    const ymd = day.toISOString().slice(0, 10);
    const dow = day.getUTCDay();
    const match = s.frequency === 'DAILY'
      || (s.frequency === 'WEEKDAYS' && dow >= 1 && dow <= 5)
      || (s.frequency === 'WEEKLY' && (s.weekdays ?? []).includes(dow))
      || (s.frequency === 'MONTHLY' && day.getUTCDate() === s.dayOfMonth)
      || (s.frequency === 'ONCE' && ymd === s.onDate);
    if (!match) continue;
    const at = new Date(localMidnight(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()).getTime() + (s.hour * 60 + (s.minute ?? 0)) * 60_000);
    if (at > after) return at;
    if (s.frequency === 'ONCE') return null;
  }
  return null;
}

/** Validates a schedule as stored. Throws a person-readable error. */
export function cleanSchedule(raw = {}) {
  const frequency = String(raw.frequency ?? '').toUpperCase();
  if (!PERSONAL_FREQUENCIES.includes(frequency)) throw new AppError('How often? Say every day, every weekday, every Friday, every month on the 5th, or a date.', 400, [], 'AGENT_NEEDS_INPUT');
  const hour = Number.isInteger(raw.hour) ? raw.hour : 9;
  const minute = Number.isInteger(raw.minute) ? raw.minute : 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new AppError('That time is not on the clock.', 400, [], 'AGENT_NEEDS_INPUT');
  const s = { frequency, hour, minute };
  if (frequency === 'WEEKLY') {
    const days = [...new Set((raw.weekdays ?? []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    if (!days.length) throw new AppError('Which day of the week?', 400, [], 'AGENT_NEEDS_INPUT');
    s.weekdays = days;
  }
  if (frequency === 'MONTHLY') {
    const d = Number(raw.dayOfMonth);
    if (!Number.isInteger(d) || d < 1 || d > 28) throw new AppError('Which day of the month (1 to 28)?', 400, [], 'AGENT_NEEDS_INPUT');
    s.dayOfMonth = d;
  }
  if (frequency === 'ONCE') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw.onDate ?? ''))) throw new AppError('On which date?', 400, [], 'AGENT_NEEDS_INPUT');
    s.onDate = raw.onDate;
  }
  return s;
}

/* ── Reading a request in words ────────────────────────────────────────── */

const DAY_WORDS = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
const DAY_RE = '(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)';

const REPORT_WORDS = [
  ['ABSENT_STAFF', /\b(?:absent\s+(?:staff|teachers|employees)|(?:staff|teachers?)\s+(?:who\s+(?:are|is)\s+)?(?:absent|on\s+leave|away)|staff\s+absen(?:ce|t)s?|who(?:'s|\s+is)\s+on\s+leave)\b/i],
  ['UNMARKED_REGISTERS', /\b(?:(?:registers?|attendance)\s+(?:not|un)\s*(?:yet\s+)?marked|unmarked\s+(?:registers?|attendance|classes))\b/i],
  ['ABSENT_STUDENTS', /\b(?:absent\s+(?:students|pupils|children|kids)|absentees|students?\s+(?:who\s+(?:are|is)\s+)?absent|who(?:'s|\s+is)\s+absent)\b/i],
  ['PENDING_APPROVALS', /\b(?:pending\s+approvals?|approvals?\s+(?:waiting|pending))\b/i],
  ['OVERDUE_FEES', /\b(?:overdue\s+fees?|fee\s+defaulters|pending\s+fees?|fees?\s+(?:overdue|pending|outstanding))\b/i],
  ['LIBRARY_OVERDUE', /\b(?:overdue\s+(?:library\s+)?books|library\s+overdues?)\b/i],
  ['PENDING_TASKS', /\b(?:(?:my\s+)?(?:pending|open)\s+tasks|my\s+tasks|tasks\s+(?:due|pending))\b/i],
  ['TODAY_BRIEFING', /\b(?:(?:daily\s+|morning\s+)?briefing|what\s+needs\s+me|my\s+day|today'?s\s+summary|daily\s+summary)\b/i],
];

const SCHEDULE_CUE = new RegExp(`\\b(?:every|each|daily|weekly|monthly|weekdays?|tomorrow|tonight|today\\s+at|on\\s+${DAY_RE}|on\\s+the\\s+\\d{1,2}(?:st|nd|rd|th)?)\\b`, 'i');
// Personal only: "add a reminder for the fire NOC renewal" is a school task (create_due_item), not this.
const CREATE_CUE = /\b(?:remind\s+me|set\s+(?:me\s+)?a\s+reminder\s+to|send\s+me|give\s+me|mail\s+me|message\s+me|notify\s+me|ping\s+me)\b/i;

/** The time of day a sentence names, or a default. */
export function timeIn(text, fallback = { hour: 9, minute: 0 }) {
  const t = String(text ?? '');
  const m = /\bat\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i.exec(t) ?? /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/i.exec(t);
  if (m) {
    let hour = Number(m[1]);
    const minute = m[2] ? Number(m[2]) : 0;
    const mer = (m[3] ?? '').toLowerCase().replace(/\./g, '');
    if (mer === 'pm' && hour < 12) hour += 12;
    if (mer === 'am' && hour === 12) hour = 0;
    // "at 4" with no am/pm: a school-day reading (1-6 are afternoon).
    if (!mer && hour >= 1 && hour <= 6) hour += 12;
    if (hour <= 23 && minute <= 59) return { hour, minute };
  }
  if (/\bnoon\b/i.test(t)) return { hour: 12, minute: 0 };
  if (/\bmorning\b/i.test(t)) return { hour: 8, minute: 0 };
  if (/\bafternoon\b/i.test(t)) return { hour: 14, minute: 0 };
  if (/\bevening\b/i.test(t)) return { hour: 18, minute: 0 };
  if (/\b(?:night|tonight)\b/i.test(t)) return { hour: 20, minute: 0 };
  return fallback;
}

/** The frequency a sentence names: { frequency, weekdays?, dayOfMonth?, onDate? } or null. */
export function frequencyIn(text, now = new Date()) {
  const t = String(text ?? '').toLowerCase();
  if (/\b(?:every\s+weekday|on\s+weekdays|weekdays|monday\s+to\s+friday|mon\s*-\s*fri)\b/.test(t)) return { frequency: 'WEEKDAYS' };
  const every = new RegExp(`\\b(?:every|each|on)\\s+${DAY_RE}((?:\\s*(?:,|and|&)\\s*${DAY_RE})*)s?\\b`, 'i').exec(t);
  if (every && /\b(?:every|each)\b/.test(t)) {
    const days = [every[1], ...((every[2] ?? '').match(new RegExp(DAY_RE, 'gi')) ?? [])].map((d) => DAY_WORDS[d.toLowerCase()]).filter((d) => d !== undefined);
    return { frequency: 'WEEKLY', weekdays: [...new Set(days)] };
  }
  const plural = new RegExp(`\\b(?:on\\s+)?${DAY_RE}s\\b`, 'i').exec(t);
  if (plural && !/\b(?:tomorrow|today)\b/.test(t)) return { frequency: 'WEEKLY', weekdays: [DAY_WORDS[plural[1].toLowerCase()]] };
  const monthly = /\b(?:every\s+month|monthly)\b(?:[^.]*?\bon\s+the\s+(\d{1,2})(?:st|nd|rd|th)?)?|\bon\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\s+of\s+every\s+month\b/.exec(t);
  if (monthly) return { frequency: 'MONTHLY', dayOfMonth: Number(monthly[1] ?? monthly[2] ?? 1) };
  if (/\b(?:every\s+(?:day|morning|evening|afternoon|night)|daily|each\s+(?:day|morning|evening))\b/.test(t)) return { frequency: 'DAILY' };
  if (/\bevery\s+week\b|\bweekly\b/.test(t)) return { frequency: 'WEEKLY', weekdays: [1] };
  const today = localClock(now);
  if (/\btomorrow\b/.test(t)) return { frequency: 'ONCE', onDate: addDays(today.day, 1).toISOString().slice(0, 10) };
  if (/\b(?:today|tonight)\b/.test(t)) return { frequency: 'ONCE', onDate: today.ymd };
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(t)?.[1] ?? writtenDatesIn(text, now)[0]?.iso;
  if (iso) return { frequency: 'ONCE', onDate: iso };
  const once = new RegExp(`\\b(?:on|this|next)\\s+${DAY_RE}\\b`, 'i').exec(t);
  if (once) {
    const want = DAY_WORDS[once[1].toLowerCase()];
    const ahead = ((want - today.dow + 7) % 7) || 7;
    return { frequency: 'ONCE', onDate: addDays(today.day, ahead).toISOString().slice(0, 10) };
  }
  return null;
}

/** What to be reminded of, with the scheduling words taken out. */
function reminderText(text) {
  return String(text ?? '')
    .replace(/^\s*(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:remind\s+me|set\s+(?:me\s+)?a\s+reminder|ping\s+me|notify\s+me)\b\s*/i, '')
    .replace(/\bon\s+the\s+\d{1,2}(?:st|nd|rd|th)?(?:\s+of\s+(?:every|each)\s+month)?\b/gi, ' ')
    .replace(new RegExp(`\\b(?:every|each|on)\\s+${DAY_RE}(?:\\s*(?:,|and|&)\\s*${DAY_RE})*s?\\b`, 'gi'), ' ')
    .replace(/\b(?:every\s+(?:day|morning|evening|afternoon|night|week|weekday|month)|daily|weekly|monthly|on\s+weekdays|weekdays|tomorrow|today|tonight|this\s+\w+day|next\s+\w+day)\b/gi, ' ')
    .replace(/\b(?:at|by)\s+\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?/gi, ' ')
    .replace(/\b\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)\b/gi, ' ')
    .replace(/\b(?:in\s+the\s+)?(?:morning|evening|afternoon|night)\b/gi, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/^\s*(?:,|that|about|of)?\s*(?:to\s+)?/i, '')
    .replace(/\s+(?:to|on|at)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^\s*to\s+/i, '')
    .trim()
    .replace(/[.!?]+$/, '');
}

/**
 * A request to set up a personal reminder or report, read from words.
 * Returns the tool arguments, `{ ask }` when something is missing, or null
 * when the sentence is not such a request.
 */
export function parsePersonalRequest(message, now = new Date()) {
  const text = String(message ?? '').trim();
  if (!text || text.length > 400) return null;
  const freq = frequencyIn(text, now);
  const create = CREATE_CUE.test(text) || (SCHEDULE_CUE.test(text) && /\b(?:send|give|mail|message|show)\s+me\b/i.test(text));
  if (!create) return null;
  const report = REPORT_WORDS.find(([, re]) => re.test(text))?.[0] ?? null;
  const isReminder = /\bremind\s+me\b|\breminder\b/i.test(text) && !(report && /\b(?:send|give|mail|message)\s+me\b/i.test(text));
  // "send me the list of absent staff" with no schedule is a question, not an automation.
  if (!freq && !/\bremind\s+me\b/i.test(text)) return null;
  if (!freq) return { ask: 'When should I remind you? For example "every Friday at 4 pm", "every weekday at 8 am" or "tomorrow at 3 pm".' };
  const time = timeIn(text, report ? { hour: 8, minute: 0 } : { hour: 9, minute: 0 });
  // "send me a weekly summary" names no report this can build: not a personal automation.
  if (!isReminder && !report) return null;
  if (!isReminder && report) {
    return { kind: 'REPORT', reportKey: report, text: REPORTS[report].label, ...freq, ...time };
  }
  const what = reminderText(text);
  if (!what || what.length < 2) return { ask: 'What should I remind you about?' };
  return { kind: 'REMINDER', text: what.slice(0, 300), ...freq, ...time };
}

/* ── The person's own list ─────────────────────────────────────────────── */

export function present(r) {
  return {
    id: String(r._id), kind: r.kind, text: r.text, reportKey: r.reportKey ?? null,
    schedule: r.schedule, when: describeSchedule(r.schedule), active: r.active,
    nextRunAt: r.nextRunAt ?? null, lastRunAt: r.lastRunAt ?? null, runs: r.runs ?? 0, createdVia: r.createdVia,
  };
}

export async function listMine(actor, { includeStopped = false } = {}) {
  if (!actor?.profileId) throw new AppError('Select a profile first', 403);
  const rows = await PersonalAutomation.find({ profileId: actor.profileId, ...(includeStopped ? {} : { active: true }) }).sort({ createdAt: 1 }).lean();
  return rows.map(present);
}

/** Checks a request and returns what would be saved (used for the draft and for the save). */
export function prepareCreate(actor, body = {}, now = new Date()) {
  if (!actor?.profileId) throw new AppError('Select a profile first', 403);
  const kind = String(body.kind ?? 'REMINDER').toUpperCase();
  if (!['REMINDER', 'REPORT'].includes(kind)) throw new AppError('kind must be REMINDER or REPORT', 400);
  let text = String(body.text ?? '').trim().slice(0, 300);
  let reportKey = null;
  if (kind === 'REPORT') {
    reportKey = String(body.reportKey ?? '').toUpperCase();
    const report = REPORTS[reportKey];
    if (!report) throw new AppError(`Which report? I can send: ${Object.values(REPORTS).map((r) => r.label.toLowerCase()).join(', ')}.`, 400, [], 'AGENT_NEEDS_INPUT');
    if (!report.allowed(actor)) throw new AppError(`"${report.label}" is not something your account can see, so I cannot send it to you.`, 403, [], 'AGENT_FORBIDDEN_SCOPE');
    text = report.label;
  } else if (!text) throw new AppError('What should I remind you about?', 400, [], 'AGENT_NEEDS_INPUT');
  const schedule = cleanSchedule(body);
  const next = nextRunAt(schedule, now);
  if (!next) throw new AppError('That time has already passed. Give a time still to come.', 400, [], 'AGENT_NEEDS_INPUT');
  return { kind, text, reportKey, schedule, nextRunAt: next, when: describeSchedule(schedule) };
}

export async function createMine(actor, body = {}, { via = 'WEB', now = new Date() } = {}) {
  const p = prepareCreate(actor, body, now);
  const count = await PersonalAutomation.countDocuments({ profileId: actor.profileId, active: true });
  if (count >= MAX_PER_PERSON) throw new AppError(`You already have ${count} active reminders and reports; stop one first.`, 409, [], 'LIMIT');
  const row = await PersonalAutomation.create({ profileId: actor.profileId, kind: p.kind, text: p.text, reportKey: p.reportKey, schedule: p.schedule, nextRunAt: p.nextRunAt, createdVia: via });
  return present(row.toObject());
}

/**
 * The caller's reminder(s) a phrase points at: "the Friday reminder", "lesson
 * plan reminder", "reminder 2", "the absent staff report", or "all".
 */
export async function findMine(actor, { id, number, match, all = false } = {}) {
  const rows = await PersonalAutomation.find({ profileId: actor.profileId, active: true }).sort({ createdAt: 1 }).lean();
  if (!rows.length) return { rows: [], none: true };
  if (all) return { rows };
  if (id) return { rows: rows.filter((r) => String(r._id) === String(id)) };
  if (Number.isInteger(number)) return { rows: rows[number - 1] ? [rows[number - 1]] : [] };
  const words = String(match ?? '').toLowerCase().replace(/\b(?:the|my|a|reminders?|reports?|automations?|stop|cancel|delete|remove|turn\s+off|please|one|about|for|every|each|scheduled)\b/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  if (!words.length) return { rows: rows.length === 1 ? rows : [], ambiguous: rows.length > 1 };
  const score = (r) => {
    const hay = `${r.text} ${describeSchedule(r.schedule)} ${r.reportKey ?? ''}`.toLowerCase();
    return words.filter((w) => hay.includes(w) || (DAY_WORDS[w] !== undefined && (r.schedule.weekdays ?? []).includes(DAY_WORDS[w]))).length;
  };
  const best = Math.max(...rows.map(score));
  if (!best) return { rows: [] };
  const top = rows.filter((r) => score(r) === best);
  return { rows: top, ambiguous: top.length > 1 };
}

export async function stopMine(actor, rowIds, { now = new Date() } = {}) {
  const res = await PersonalAutomation.updateMany({ _id: { $in: rowIds }, profileId: actor.profileId, active: true }, { $set: { active: false, stoppedAt: now, nextRunAt: null } });
  return { stopped: res.modifiedCount ?? 0 };
}

/* ── Sending what is due ───────────────────────────────────────────────── */

/**
 * Every personal reminder and report whose time has come. Idempotent per run
 * time (the outbox key carries it), and the next time is set before the send
 * is attempted, so a crash never repeats a reminder in a loop.
 */
export async function runPersonalDue({ now = new Date() } = {}) {
  const due = await PersonalAutomation.find({ active: true, nextRunAt: { $ne: null, $lte: now } }).limit(500);
  let sent = 0; let stopped = 0; let skipped = 0;
  for (const row of due) {
    /* eslint-disable no-await-in-loop -- one person at a time */
    const runAt = row.nextRunAt;
    const runKey = runAt.toISOString().slice(0, 16);
    const next = row.schedule.frequency === 'ONCE' ? null : nextRunAt(row.schedule, new Date(Math.max(now.getTime(), runAt.getTime())));
    row.nextRunAt = next;
    row.lastRunAt = now;
    row.runs = (row.runs ?? 0) + 1;
    if (!next) { row.active = false; row.stoppedAt = now; }
    await row.save();
    try {
      if (row.kind === 'REMINDER') {
        await sendOperational({
          templateKey: 'PERSONAL_REMINDER', recipientProfileIds: [String(row.profileId)], variables: { text: row.text },
          link: '/automations', idempotencyKey: `personal:${row._id}:${runKey}`, relatedEntityType: 'PersonalAutomation', relatedEntityId: row._id, now,
        });
        sent += 1;
      } else {
        const actor = await actorFromProfile(row.profileId);
        const report = REPORTS[row.reportKey];
        if (!actor || !report || !report.allowed(actor)) {
          // The person can no longer see this report: it stops rather than widening.
          row.active = false; row.stoppedAt = now; row.nextRunAt = null;
          await row.save();
          stopped += 1;
          continue;
        }
        const clock = { ...localClock(now), now };
        const out = await report.build(actor, clock);
        await sendOperational({
          templateKey: 'PERSONAL_REPORT', recipientProfileIds: [String(row.profileId)], channels: ['EMAIL'],
          variables: { title: `${report.label} (${clock.ymd})`, summary: out.summary },
          link: '/automations', idempotencyKey: `personal:${row._id}:${runKey}`, relatedEntityType: 'PersonalAutomation', relatedEntityId: row._id, now,
        });
        sent += 1;
      }
    } catch (err) {
      logger.error(`Personal automation ${row._id} failed: ${err.message}`);
      skipped += 1;
    }
    /* eslint-enable no-await-in-loop */
  }
  return { due: due.length, sent, stopped, skipped };
}

export { DAY_MS };
