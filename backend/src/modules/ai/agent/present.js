import { speakOf } from './response.js';

/**
 * The presentation layer: how a tool result reads to a person.
 *
 * Tools return facts (`data`) and, where a richer answer helps, a `view` -- a
 * small descriptor naming what kind of answer this is and carrying only the
 * figures a person needs (never ids, never the raw record). This file is the
 * one place a view becomes Markdown, so every channel and every tool formats
 * percentages, months, dates and tables the same way.
 *
 * Markdown is the website's format. WhatsApp has its own, narrower dialect, so
 * toWhatsAppText() converts at the edge rather than every tool writing twice.
 *
 * A result with no view keeps its one-line sentence (speakOf), so nothing that
 * worked before changes shape.
 */

const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  hi: ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'],
};
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const LABELS = {
  en: {
    summary: 'Attendance Summary',
    monthTitle: (m) => `${m} Attendance`,
    monthly: 'Monthly Attendance',
    notAvailable: 'Attendance Not Available',
    attendance: 'Attendance',
    present: 'Present',
    absent: 'Absent',
    late: 'Late',
    excused: 'Excused',
    halfDay: 'Half Day',
    totalMarked: 'Total Marked',
    status: 'Status',
    days: 'Days',
    month: 'Month',
    notMarked: 'Not marked',
    dayCount: (n) => `${n} ${n === 1 ? 'day' : 'days'}`,
    attendedNote: 'Late and excused days count as attended; a half day counts as half.',
    noneSelf: 'No attendance records have been marked for you yet, so an attendance percentage cannot be calculated.',
    noneOther: (who) => `No attendance records have been marked for ${who} yet, so an attendance percentage cannot be calculated.`,
    noneMonth: (m) => `No attendance records have been marked for ${m}, so an attendance percentage cannot be calculated.`,
    noneMonthOther: (m, who) => `No attendance records have been marked for ${who} in ${m}, so an attendance percentage cannot be calculated.`,
    future: (m) => `${m} hasn't started yet, so there is no attendance to show.`,
    noneTrend: (n) => `No attendance has been marked in the last ${n} month(s), so no monthly percentage can be calculated.`,
    trendNote: 'Months with no marked attendance have no percentage.',
  },
  hi: {
    summary: 'उपस्थिति सारांश',
    monthTitle: (m) => `${m} की उपस्थिति`,
    monthly: 'मासिक उपस्थिति',
    notAvailable: 'उपस्थिति उपलब्ध नहीं',
    attendance: 'उपस्थिति',
    present: 'उपस्थित',
    absent: 'अनुपस्थित',
    late: 'देर से',
    excused: 'अवकाश',
    halfDay: 'आधा दिन',
    totalMarked: 'कुल दर्ज',
    status: 'स्थिति',
    days: 'दिन',
    month: 'महीना',
    notMarked: 'दर्ज नहीं',
    dayCount: (n) => `${n} दिन`,
    attendedNote: 'देर से और अवकाश वाले दिन उपस्थित गिने जाते हैं; आधा दिन आधा गिना जाता है।',
    noneSelf: 'आपकी कोई उपस्थिति अभी तक दर्ज नहीं हुई है, इसलिए उपस्थिति प्रतिशत की गणना नहीं की जा सकती।',
    noneOther: (who) => `${who} की कोई उपस्थिति अभी तक दर्ज नहीं हुई है, इसलिए उपस्थिति प्रतिशत की गणना नहीं की जा सकती।`,
    noneMonth: (m) => `${m} के लिए कोई उपस्थिति दर्ज नहीं हुई है, इसलिए उपस्थिति प्रतिशत की गणना नहीं की जा सकती।`,
    noneMonthOther: (m, who) => `${m} में ${who} की कोई उपस्थिति दर्ज नहीं हुई है, इसलिए प्रतिशत की गणना नहीं की जा सकती।`,
    future: (m) => `${m} अभी शुरू नहीं हुआ है, इसलिए दिखाने को कोई उपस्थिति नहीं है।`,
    noneTrend: (n) => `पिछले ${n} महीनों में कोई उपस्थिति दर्ज नहीं हुई है, इसलिए मासिक प्रतिशत की गणना नहीं की जा सकती।`,
    trendNote: 'जिन महीनों में उपस्थिति दर्ज नहीं हुई, उनका कोई प्रतिशत नहीं है।',
  },
};

const labelsFor = (lang) => LABELS[lang] ?? LABELS.en;

/* ── Value formatting ───────────────────────────────────────── */

/**
 * 81.818… → "81.82%", 82 → "82%". Never invents a value: anything that is not
 * a finite number (null, undefined, NaN) is "—", because a missing percentage
 * must not read as 0%.
 */
export function formatPercent(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(2).replace(/\.?0+$/, '')}%`;
}

/** "2026-09" → "September" this year, "September 2025" otherwise. */
export function formatMonth(ym, lang = 'en', now = new Date()) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? ''));
  if (!m) return String(ym ?? '');
  const name = (MONTHS[lang] ?? MONTHS.en)[Number(m[2]) - 1];
  if (!name) return String(ym);
  return Number(m[1]) === now.getFullYear() ? name : `${name} ${m[1]}`;
}

/** "2026-10-03" (or a Date) → "3 Oct 2026". */
export function formatDate(value) {
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '');
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${SHORT_MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * The question to ask when a month argument is not a real month, else null.
 *
 * The schemas' month pattern (`^\d{4}-\d{2}$`) admits "2026-13", which every
 * date helper then quietly rolls into the next year. Checked by the tools so
 * every MCP consumer gets the same refusal, rather than an answer about a
 * month nobody asked for.
 */
export function unreadableMonthMessage(ym) {
  if (ym === null || ym === undefined || ym === '') return null;
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(ym))) return null;
  return `I could not read "${ym}" as a month. Name a month such as "September", or give it as ${new Date().getFullYear()}-09.`;
}

/** Whether a "YYYY-MM" month lies after the current one. */
export function isFutureMonth(ym, now = new Date()) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? ''));
  if (!m) return false;
  return Number(m[1]) * 12 + Number(m[2]) > now.getFullYear() * 12 + now.getMonth() + 1;
}

/* ── Markdown building blocks ───────────────────────────────── */

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** A GitHub-flavoured table. `align` per column: 'left' | 'right'. */
export function mdTable(headers, rows, align = []) {
  const sep = headers.map((_, i) => (align[i] === 'right' ? '---:' : '---'));
  return [headers, sep, ...rows].map((r, i) => `| ${(i === 1 ? r : r.map(cell)).join(' | ')} |`).join('\n');
}

export const mdBullets = (items) => items.filter(Boolean).map((item) => `- ${item}`).join('\n');
/** "1. a\n2. b" -- for a counted collection, where the position helps the reader. */
export const mdNumbered = (items, start = 1) => items.filter(Boolean).map((item, i) => `${start + i}. ${item}`).join('\n');

/**
 * A person's name as a reader wants it. Staff display names often carry a
 * qualifier ("Priya Patel (Science)"), which inside another parenthesis became
 * "Science (Priya Patel (Science))". Only the trailing qualifier is dropped,
 * and only for display -- the stored name is untouched.
 */
export function personName(name) {
  const text = String(name ?? '').trim();
  const bare = text.replace(/\s*\([^()]*\)\s*$/, '').trim();
  return bare || text;
}
export const mdHeading = (text) => `**${text}**`;
const blocks = (...parts) => parts.filter(Boolean).join('\n\n');
/** "Rahul Sharma — September Attendance"; a generic subject keeps the plain title. */
const titled = (who, title) => (who && who !== 'your child' ? `${who} — ${title}` : title);

/* ── Attendance ─────────────────────────────────────────────── */

/**
 * The answer an attendance summary supports, as `{ speakKey, params, view }`.
 *
 * Shared by every attendance tool that reports one student's figures, so they
 * cannot disagree about when there is a percentage. There is one only when at
 * least one valid mark exists; otherwise the answer says attendance is not
 * available -- never 0%, never a default. A month that has not started yet is
 * said to be in the future rather than "not marked".
 *
 * @param summary  attendance.service getSummary() single-enrolment result
 * @param month    "YYYY-MM" when one month was asked for
 * @param who      null for the caller themselves, else a display name
 */
export function attendanceAnswer(summary, { month = null, who: named = null, child = false, now = new Date() } = {}) {
  // A parent's "my attendance" is their child's; said so in the empty case.
  const who = named ?? (child ? 'your child' : null);
  if (month && isFutureMonth(month, now)) {
    return {
      speakKey: 'attendance.month.future',
      params: { month: formatMonth(month, 'en', now) },
      view: { type: 'attendance.future', month },
    };
  }
  const marked = Number(summary?.workingDays ?? 0);
  if (!summary || !(marked > 0) || summary.pctPresent == null) {
    return month
      ? { speakKey: 'attendance.month.none', params: { month: formatMonth(month, 'en', now) }, view: { type: 'attendance.none', month, who } }
      : { speakKey: 'attendance.none', params: null, view: { type: 'attendance.none', month: null, who } };
  }
  return {
    speakKey: 'attendance.summary',
    params: { pct: summary.pctPresent, present: summary.PRESENT ?? 0, days: marked },
    view: {
      type: 'attendance.summary',
      month,
      who,
      figures: {
        present: summary.PRESENT ?? 0,
        absent: summary.ABSENT ?? 0,
        late: summary.LATE ?? 0,
        excused: summary.EXCUSED ?? 0,
        halfDay: summary.HALF_DAY ?? 0,
        marked,
        pct: summary.pctExact ?? summary.pctPresent,
      },
    },
  };
}

function renderAttendanceSummary(view, lang) {
  const L = labelsFor(lang);
  const f = view.figures ?? {};
  const extras = [
    f.late ? [L.late, f.late] : null,
    f.excused ? [L.excused, f.excused] : null,
    f.halfDay ? [L.halfDay, f.halfDay] : null,
  ].filter(Boolean);
  const note = extras.length ? `_${L.attendedNote}_` : null;

  if (view.month) {
    const title = L.monthTitle(formatMonth(view.month, lang));
    const rows = [
      [L.present, f.present],
      [L.absent, f.absent],
      ...extras,
      [L.totalMarked, f.marked],
      [L.attendance, `**${formatPercent(f.pct)}**`],
    ];
    return blocks(mdHeading(titled(view.who, title)), mdTable([L.status, L.days], rows, ['left', 'right']), note);
  }

  return blocks(
    mdHeading(titled(view.who, L.summary)),
    mdBullets([
      `**${L.attendance}:** ${formatPercent(f.pct)}`,
      `**${L.present}:** ${L.dayCount(f.present)}`,
      `**${L.absent}:** ${L.dayCount(f.absent)}`,
      ...extras.map(([label, n]) => `**${label}:** ${L.dayCount(n)}`),
      `**${L.totalMarked}:** ${L.dayCount(f.marked)}`,
    ]),
    note,
  );
}

function renderAttendanceNone(view, lang) {
  const L = labelsFor(lang);
  if (view.month) {
    const month = formatMonth(view.month, lang);
    const title = L.monthTitle(month);
    return blocks(
      mdHeading(titled(view.who, title)),
      view.who ? L.noneMonthOther(month, view.who) : L.noneMonth(month),
    );
  }
  return blocks(mdHeading(L.notAvailable), view.who ? L.noneOther(view.who) : L.noneSelf);
}

function renderAttendanceFuture(view, lang) {
  const L = labelsFor(lang);
  const month = formatMonth(view.month, lang);
  return blocks(mdHeading(L.monthTitle(month)), L.future(month));
}

function renderAttendanceTrend(view, lang) {
  const L = labelsFor(lang);
  const points = view.points ?? [];
  const title = titled(view.who, L.monthly);
  if (!points.some((p) => p.marked > 0)) return blocks(mdHeading(title), L.noneTrend(points.length || 6));
  const rows = points.map((p) => (p.marked > 0
    ? [formatMonth(p.month, lang), p.present, p.absent, p.marked, `**${formatPercent(p.pct)}**`]
    : [formatMonth(p.month, lang), '—', '—', 0, L.notMarked]));
  return blocks(
    mdHeading(title),
    mdTable([L.month, L.present, L.absent, L.totalMarked, L.attendance], rows, ['left', 'right', 'right', 'right', 'right']),
    points.some((p) => !(p.marked > 0)) ? `_${L.trendNote}_` : null,
  );
}

/* ── Timetable ──────────────────────────────────────────────── */

const TIMETABLE_LABELS = {
  en: {
    title: (day) => `Timetable — ${day}`,
    weekly: 'Weekly Timetable',
    period: 'Period', time: 'Time', subject: 'Subject', teacher: 'Teacher', class: 'Class', room: 'Room',
    break: 'Break',
    none: (day) => `No classes are scheduled for ${day}.`,
    noneWeek: 'Nothing is scheduled in the weekly timetable.',
    more: (shown, total) => `Showing the first ${shown} of ${total} periods.`,
  },
  hi: {
    title: (day) => `समय-सारणी — ${day}`,
    weekly: 'साप्ताहिक समय-सारणी',
    period: 'कालांश', time: 'समय', subject: 'विषय', teacher: 'शिक्षक', class: 'कक्षा', room: 'कमरा',
    break: 'अवकाश',
    none: (day) => `${day} को कोई कक्षा निर्धारित नहीं है।`,
    noneWeek: 'साप्ताहिक समय-सारणी में कुछ भी निर्धारित नहीं है।',
    more: (shown, total) => `कुल ${total} में से पहले ${shown} कालांश दिखाए गए हैं।`,
  },
};

/** "08:30–09:15", or whichever end is known. */
const timeRange = (start, end) => [start, end].filter(Boolean).join('–') || '—';

/**
 * One day's periods as a table. Columns appear only when they carry
 * something: a teacher's own timetable has no teacher column (it would be their
 * own name on every row) and a class column instead; rooms only when recorded.
 */
function periodTable(periods, { showClass, showTeacher }, L) {
  const withRoom = periods.some((p) => p.room);
  const columns = [
    [L.period, 'right', (p) => p.period],
    [L.time, 'left', (p) => timeRange(p.start, p.end)],
    showClass ? [L.class, 'left', (p) => p.class ?? '—'] : null,
    [L.subject, 'left', (p) => (p.subject ? `**${p.subject}**` : `_${L.break}_`)],
    showTeacher ? [L.teacher, 'left', (p) => (p.subject ? (p.teacher ? personName(p.teacher) : '—') : '')] : null,
    withRoom ? [L.room, 'left', (p) => p.room ?? '—'] : null,
  ].filter(Boolean);
  return mdTable(
    columns.map(([label]) => label),
    periods.map((p) => columns.map(([, , value]) => value(p))),
    columns.map(([, align]) => align),
  );
}

function renderTimetableDay(view, lang) {
  const L = TIMETABLE_LABELS[lang] ?? TIMETABLE_LABELS.en;
  const periods = view.periods ?? [];
  if (!periods.length) return renderTimetableNone(view, lang);
  return blocks(
    mdHeading(L.title(view.day)),
    periodTable(periods, view, L),
    view.total > periods.length ? `_${L.more(periods.length, view.total)}_` : null,
  );
}

function renderTimetableWeek(view, lang) {
  const L = TIMETABLE_LABELS[lang] ?? TIMETABLE_LABELS.en;
  const days = (view.days ?? []).filter((d) => d.periods?.length);
  if (!days.length) return blocks(mdHeading(L.weekly), L.noneWeek);
  return blocks(
    mdHeading(L.weekly),
    ...days.map((d) => blocks(mdHeading(d.day), periodTable(d.periods, view, L))),
  );
}

function renderTimetableNone(view, lang) {
  const L = TIMETABLE_LABELS[lang] ?? TIMETABLE_LABELS.en;
  return view.day ? blocks(mdHeading(L.title(view.day)), L.none(view.day)) : blocks(mdHeading(L.weekly), L.noneWeek);
}

const RENDERERS = {
  'attendance.summary': renderAttendanceSummary,
  'attendance.none': renderAttendanceNone,
  'attendance.future': renderAttendanceFuture,
  'attendance.trend': renderAttendanceTrend,
  'timetable.day': renderTimetableDay,
  'timetable.week': renderTimetableWeek,
  'timetable.none': renderTimetableNone,
};

/** A view → Markdown, or null for a view this layer does not know. */
export function renderView(view, lang = 'en') {
  const render = view && RENDERERS[view.type];
  if (!render) return null;
  try {
    return render(view, lang) || null;
  } catch {
    // A malformed view falls back to the tool's own sentence rather than
    // breaking the answer.
    return null;
  }
}

/** The text a person sees for one tool result: its view if it has one, else its sentence. */
export function presentOf(result, lang = 'en') {
  const range = result?.range ?? null;
  const body = renderView(result?.view, lang)
    ?? structureSentence(speakOf(result, lang), { start: range?.from || null });
  return [body, rangeNote(range)].filter(Boolean).join('\n\n');
}

/**
 * "_Showing 1001–2000 of 4500._" -- said whenever an answer holds only part of
 * the whole, so a window is never mistaken for everything. The way to the next
 * rows is offered alongside ("Load more" on the website, "MORE" on WhatsApp).
 */
export function rangeNote(range) {
  if (!range || !range.to) return null;
  if (!(range.from > 1 || range.next)) return null;
  const of = range.total != null ? ` of ${range.total}` : '';
  return `_Showing ${range.from}–${range.to}${of}._`;
}

/* ── Any other list answer ──────────────────────────────────── */

/** "5 homework item(s)" → "5 homework items"; "1 student(s)" → "1 student". */
export function pluralise(text) {
  return String(text ?? '')
    // Up to two words may sit between the number and the noun ("5 homework item(s)").
    .replace(/\b(\d+)((?:\s+[\p{L}-]+){0,2}?)\s+([\p{L}-]+)\(s\)/gu,
      (_, n, between, word) => `${n}${between} ${word}${Number(n) === 1 ? '' : 's'}`)
    .replace(/\b(\d+)\s+entr\(y\|ies\)/g, (_, n) => `${n} entr${Number(n) === 1 ? 'y' : 'ies'}`);
}

/**
 * One list item, made easy to scan: "Title (details)" → "**Title** — details",
 * "Label: value" → "**Label:** value". Anything else is left as written.
 */
function structureItem(item) {
  const paren = /^(.{2,80}?) \(([^()]+(?:\([^()]*\)[^()]*)*)\)$/.exec(item);
  if (paren) return `**${paren[1]}** — ${paren[2]}`;
  const labelled = /^([^:()]{2,40}): (.+)$/.exec(item);
  if (labelled) return `**${labelled[1]}:** ${labelled[2]}`;
  return item;
}

/**
 * A run-on list sentence → a heading and one bullet per item.
 *
 * Most tools answer in one sentence built as "<what>: a; b; c." -- fine for a
 * single fact, unreadable for ten ("5 homework item(s): Science Revision
 * (Science, due 30 Jul); Chapter 1 Assignment (Science, due 15 Aug); …"). Rather
 * than every tool formatting itself, the shape is recognised here once, so
 * every list answer on every channel reads the same way:
 *
 *   **5 homework items**
 *   - **Science Revision** — Science, due 30 Jul
 *   - **Chapter 1 Assignment** — Science, due 15 Aug
 *
 * Only a real list is touched: at least two items separated by "; ". A plain
 * sentence, or text that is already formatted (has line breaks), passes
 * through unchanged, and nothing is added or dropped -- the same facts, laid
 * out.
 */
export function structureSentence(text, { start = null } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw || raw.includes('\n') || !raw.includes('; ')) return raw;
  const parts = raw.split('; ');
  if (parts.length < 2) return raw;

  // Prose before the list ("Class 6 A on 5 Aug: 3 students, 2 marked. 2 absent
  // — Rahul; Aman") stays a sentence; the list starts at its last sentence.
  let first = parts[0];
  let prose = null;
  const lastStop = [...first.matchAll(/\.\s+(?=[\p{Lu}\d])/gu)].pop();
  if (lastStop) {
    prose = first.slice(0, lastStop.index + 1).trim();
    first = first.slice(lastStop.index + lastStop[0].length);
  }

  // "<intro>: item" or "<intro> — item", whichever separator comes first.
  let intro = null;
  const sep = /:\s|\s—\s/.exec(first);
  if (sep) {
    intro = first.slice(0, sep.index).trim();
    first = first.slice(sep.index + sep[0].length);
  }

  // A sentence after the list ("…; Aman. Ask me for more.") is kept after it.
  let last = parts[parts.length - 1];
  let tail = null;
  const after = /\.\s+(?=[\p{Lu}])/u.exec(last);
  if (after) {
    tail = last.slice(after.index + 1).trim();
    last = last.slice(0, after.index);
  }
  last = last.replace(/\.$/, '');
  let more = false;
  if (/,?\s*…$/.test(last)) {
    more = true;
    last = last.replace(/,?\s*…$/, '');
  }

  const items = [first, ...parts.slice(1, -1), last].map((s) => s.trim()).filter(Boolean);
  if (items.length < 2) return raw;

  const heading = intro
    ? (intro.length <= 90 ? mdHeading(pluralise(intro).replace(/^./, (c) => c.toUpperCase())) : `${pluralise(intro)}:`)
    : null;
  // "5 homework items: …" is a counted collection and is numbered, the same
  // way the subjects list is; anything else ("Attendance by subject — …") is
  // bulleted.
  const counted = Boolean(intro && /^\d+\s/.test(intro));
  // A window of a longer list is always numbered from where the window starts
  // (1001, 1002, …), so numbering runs on unbroken across windows.
  const numberFrom = Number.isInteger(start) && start > 0 ? start : (counted ? 1 : null);
  const list = numberFrom ? mdNumbered(items.map(structureItem), numberFrom) : mdBullets(items.map(structureItem));
  return blocks(
    prose ? pluralise(prose) : null,
    heading,
    list + (more ? (numberFrom ? '\n…' : '\n- …') : ''),
    tail,
  );
}

/* ── Assignments ────────────────────────────────────────────── */

const STATUS_WORDS = { PENDING: 'Not submitted', SUBMITTED: 'Submitted', LATE: 'Submitted late', GRADED: 'Graded' };

function renderAssignments(view) {
  const items = view.items ?? [];
  const noun = view.kind === 'pending' ? 'Still to submit'
    : view.kind === 'submitted' ? 'Submitted work'
      : view.audience === 'staff' ? 'Assignments' : 'Homework';
  const title = `${noun}${view.scope ? ` — ${view.scope}` : ''} (${view.total})`;
  const columns = [
    ['Assignment', 'left', (a) => `**${a.title}**`],
    ['Subject', 'left', (a) => a.subject ?? '—'],
    view.showClass ? ['Class', 'left', (a) => a.class ?? '—'] : null,
    ['Due', 'left', (a) => (a.dueAt ? formatDate(a.dueAt) : '—')],
    view.audience === 'staff' ? ['Submissions', 'right', (a) => a.submissions ?? 0] : null,
    view.audience === 'family' && view.kind !== 'pending' ? ['Status', 'left', (a) => STATUS_WORDS[a.status] ?? a.status] : null,
  ].filter(Boolean);
  return blocks(
    mdHeading(title),
    mdTable(columns.map(([h]) => h), items.map((a) => columns.map(([, , v]) => v(a))), columns.map(([, al]) => al)),
    view.total > items.length ? `_Showing the ${items.length} due soonest of ${view.total}._` : null,
  );
}

RENDERERS['assignments.list'] = renderAssignments;

/* ── Subjects ───────────────────────────────────────────────── */

const SUBJECT_LABELS = {
  en: {
    count: (n) => `You have ${n} ${n === 1 ? 'subject' : 'subjects'}:`,
    none: "You currently don't have any subjects assigned.",
  },
  hi: {
    count: (n) => `आपके ${n} विषय हैं:`,
    none: 'आपको अभी कोई विषय आवंटित नहीं है।',
  },
};

/**
 * "You have 11 subjects:" then "1. **Mathematics** — Arjun Sharma", one per
 * line. Built from whatever the tool returned -- any number of subjects -- and
 * a subject with no teacher recorded shows its name alone.
 */
function renderSubjects(view, lang) {
  const L = SUBJECT_LABELS[lang] ?? SUBJECT_LABELS.en;
  const subjects = (view.subjects ?? []).filter((sub) => sub?.name);
  if (!subjects.length) return L.none;
  return blocks(
    L.count(subjects.length),
    mdNumbered(subjects.map((sub) => (view.showTeacher !== false && sub.teacher
      ? `**${sub.name}** — ${personName(sub.teacher)}`
      : `**${sub.name}**`))),
  );
}

RENDERERS['subjects.list'] = renderSubjects;

/**
 * Any counted list in the same shape as the subjects list: an intro line
 * ("You have 3 classes:"), then "1. **label** — detail". Tools pass the
 * words; this decides the layout, so every such list reads alike.
 */
function renderNumberedList(view) {
  const items = (view.items ?? []).filter((item) => item?.label);
  if (!items.length) return view.empty ?? null;
  return blocks(
    view.intro ?? null,
    mdNumbered(items.map((item) => (item.detail ? `**${item.label}** — ${item.detail}` : `**${item.label}**`))),
  );
}

RENDERERS['list.numbered'] = renderNumberedList;

/* ── WhatsApp: long replies as numbered parts ───────────────── */

/**
 * The most characters one WhatsApp part carries. Meta's text limit is 4096;
 * the margin leaves room for the "Part i/n" title without ever reaching it.
 */
export const WHATSAPP_PART_CHARS = 3800;

/**
 * A WhatsApp reply → the messages to send, never losing a line.
 *
 * WhatsApp has no "Read more", and the Meta channel used to send
 * `text.slice(0, 4096)` -- everything after that was silently dropped, which
 * for a list of a hundred students was most of the answer. A reply that fits
 * goes as it is. A longer one is split BETWEEN lines (a numbered item or a
 * table row is never cut in half) into parts titled from the reply's own
 * heading:
 *
 *   *Students — Part 1/3*
 *   1. …
 *
 * Numbering carries across parts because the lines keep their own numbers.
 * Only the text it is given is split, so it can only ever contain what the
 * person was already authorized to receive.
 */
export function chunkForWhatsApp(text, { max = WHATSAPP_PART_CHARS } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return [];
  if (raw.length <= max) return [raw];

  const lines = raw.split('\n');
  // The title is the reply's own heading (*bold* first line) or its first line.
  const firstLine = lines.find((l) => l.trim()) ?? '';
  const heading = /^\*(.+)\*$/.exec(firstLine.trim())?.[1] ?? null;
  const title = (heading ?? firstLine.replace(/[*_]/g, '')).trim().replace(/[:.]$/, '').slice(0, 60) || 'Reply';
  // The heading is repeated in every part's title, so it is not also a body line.
  const body = heading ? lines.slice(lines.indexOf(firstLine) + 1) : lines;

  // Room for "*<title> — Part 99/99*\n\n".
  const budget = Math.max(200, max - title.length - 20);
  const pieces = [];
  let current = [];
  let size = 0;
  const flush = () => {
    const joined = current.join('\n').trim();
    if (joined) pieces.push(joined);
    current = [];
    size = 0;
  };
  for (const line of body) {
    // A single line longer than a part (rare: a very long paragraph) is split
    // at word boundaries rather than cut mid-word or dropped.
    const segments = [];
    if (line.length > budget) {
      let rest = line;
      while (rest.length > budget) {
        let cut = rest.lastIndexOf(' ', budget);
        if (cut < budget * 0.5) cut = budget;
        segments.push(rest.slice(0, cut));
        rest = rest.slice(cut).trimStart();
      }
      if (rest) segments.push(rest);
    } else {
      segments.push(line);
    }
    for (const segment of segments) {
      if (size + segment.length + 1 > budget && current.length) flush();
      current.push(segment);
      size += segment.length + 1;
    }
  }
  flush();

  if (pieces.length === 1) return [heading ? `*${heading}*\n\n${pieces[0]}` : pieces[0]];
  return pieces.map((piece, i) => `*${title} — Part ${i + 1}/${pieces.length}*\n\n${piece}`);
}

/* ── WhatsApp ───────────────────────────────────────────────── */

/**
 * Markdown → WhatsApp's formatting.
 *
 * WhatsApp has *bold* and _italic_ but no tables or headings, and shows `**`
 * and `|` literally. Tables become one line per row ("Present: 18"), headings
 * and **bold** become *bold*, and "- " bullets become "• ". Plain text passes
 * through unchanged.
 */
export function toWhatsAppText(markdown) {
  const text = String(markdown ?? '');
  if (!/[*|#]|^- /m.test(text)) return text;
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isRow = (l) => /^\s*\|.*\|\s*$/.test(l ?? '');
    if (isRow(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      const split = (l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
      // The header row is skipped: the heading above names the table.
      i += 2;
      for (; i < lines.length && isRow(lines[i]); i++) {
        const cells = split(lines[i]);
        if (cells.length === 2) out.push(`• ${cells[0]}: ${cells[1]}`);
        // A wider row reads best as one line of its values ("• 1 · 08:30–09:15
        // · Science · Priya Patel"): the heading above already says what the
        // columns are, and repeating every header on every line buries them.
        else out.push(`• ${cells.filter((c) => c && c !== '—').join(' · ')}`);
      }
      i -= 1;
      continue;
    }
    out.push(line
      .replace(/^#{1,6}\s+(.*)$/, '**$1**')
      .replace(/^- /, '• '));
  }
  return out.join('\n').replace(/\*\*(.+?)\*\*/g, '*$1*');
}
