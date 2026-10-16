/**
 * The school day as a plan, computed for any date and time: is the school
 * open that day (holiday, vacation, closure, weekly off, exam-only day), and
 * where is each shift in its bell schedule (arrival, assembly, period N,
 * break, lunch, dispersal, clubs, closed). Pure functions only: the data is
 * loaded by moment.service.js, and these are tested without a database.
 *
 * Times are minutes after local midnight in the school's time zone; dates are
 * local calendar dates "YYYY-MM-DD". Nothing here reads the clock.
 */
import { DEFAULT_TZ, tzOffsetMinutes, localMidnight } from '../../utils/periods.js';

const DAY = 86_400_000;
export const toMin = (s) => { const [h, m] = String(s ?? '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/** "7:45 am" — how a banner says a time. */
export function fmt12(min) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
const DOW_NAME = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The local date, weekday (1 = Monday … 7 = Sunday) and minute of an instant. */
export function localParts(at, tz = DEFAULT_TZ) {
  const t = new Date(at.getTime() + tzOffsetMinutes(at, tz) * 60_000);
  const d = t.getUTCDay();
  const ymd = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
  return { ymd, dow: d === 0 ? 7 : d, minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}
/** The instant of a local date and minute. */
export function instantOf(ymd, minutes, tz = DEFAULT_TZ) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(localMidnight(y, m, d, tz).getTime() + minutes * 60_000);
}
export function addDaysYmd(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
export function dowOfYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}
const shortDate = (ymd) => { const [, m, d] = ymd.split('-').map(Number); return `${DOW_NAME[dowOfYmd(ymd)].slice(0, 3)} ${d} ${MONTH[m - 1]}`; };

/** The local date of a calendar event's edge. Dates saved as UTC midnight and as local midnight both land on the intended day. */
function eventYmd(date, tz) {
  const d = new Date(date);
  // A date-only value (UTC midnight) is that calendar date wherever the school is.
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) return d.toISOString().slice(0, 10);
  return localParts(d, tz).ymd;
}

/** Calendar types that keep the school shut, and how a banner names them. */
export const CLOSED_TYPES = { HOLIDAY: 'Holiday', VACATION: 'Vacation', CLOSURE: 'School closed' };
/** A calendar entry that turns a day into an exam-only day: only exam rooms are in use. */
export const EXAM_ONLY_TYPE = 'EXAM_ONLY';

/**
 * What kind of day a date is.
 *  - HOLIDAY / VACATION / CLOSURE: a calendar entry of that type covers it;
 *  - WEEKLY_OFF: no shift runs on that weekday (Sunday, unless a shift says otherwise);
 *  - EXAM_ONLY: an EXAM_ONLY calendar entry covers it (only classes sitting a paper come in);
 *  - SCHOOL_DAY otherwise.
 * A shift with no days listed runs Monday to Saturday.
 */
export function dayKindFor({ ymd, events = [], shifts = [], tz = DEFAULT_TZ }) {
  const covering = events.filter((e) => !e.deletedAt && eventYmd(e.startsAt, tz) <= ymd && eventYmd(e.endsAt ?? e.startsAt, tz) >= ymd);
  for (const type of Object.keys(CLOSED_TYPES)) {
    const e = covering.find((x) => String(x.type).toUpperCase() === type);
    if (e) return { kind: type, title: e.title, open: false };
  }
  const dow = dowOfYmd(ymd);
  const running = shifts.filter((s) => (s.daysOfWeek?.length ? s.daysOfWeek : [1, 2, 3, 4, 5, 6]).includes(dow));
  if (!running.length) return { kind: 'WEEKLY_OFF', title: DOW_NAME[dow], open: false };
  const exam = covering.find((x) => String(x.type).toUpperCase() === EXAM_ONLY_TYPE);
  if (exam) return { kind: 'EXAM_ONLY', title: exam.title, open: true };
  return { kind: 'SCHOOL_DAY', title: null, open: true };
}

/**
 * A shift's bells, sorted, with an arrival window and a dispersal added when
 * the school has not set them (25 minutes before the first bell; 20 minutes
 * after the last school bell, clubs aside).
 */
export function normaliseBells(bells = []) {
  const list = bells.map((b) => ({ ...b, s: toMin(b.start), e: toMin(b.end) })).filter((b) => b.e > b.s).sort((a, b) => a.s - b.s);
  const school = list.filter((b) => b.kind !== 'CLUBS');
  if (!school.length) return list;
  if (!list.some((b) => b.kind === 'ARRIVAL')) {
    const first = school[0].s;
    list.unshift({ kind: 'ARRIVAL', label: 'Arrival', start: hhmm(Math.max(0, first - 25)), end: hhmm(first), s: Math.max(0, first - 25), e: first });
  }
  if (!list.some((b) => b.kind === 'DISPERSAL')) {
    const last = Math.max(...school.map((b) => b.e));
    list.push({ kind: 'DISPERSAL', label: 'Dispersal', start: hhmm(last), end: hhmm(Math.min(1439, last + 20)), s: last, e: Math.min(1439, last + 20) });
  }
  return list.sort((a, b) => a.s - b.s || (a.kind === 'ARRIVAL' ? -1 : 1));
}

/**
 * Bells read off a timetable, for a school that has not set up shifts: each
 * distinct period becomes a period bell, and a gap between periods becomes a
 * break (45 minutes or more: lunch).
 */
export function bellsFromSlots(slots = []) {
  const seen = new Map();
  for (const s of slots) {
    const key = `${s.periodNo}|${s.startTime}|${s.endTime}`;
    if (!seen.has(key)) seen.set(key, { kind: 'PERIOD', periodNo: s.periodNo, start: s.startTime, end: s.endTime });
  }
  const periods = [...seen.values()].sort((a, b) => toMin(a.start) - toMin(b.start));
  // Several periods with the same number at different times: keep the earliest.
  const byNo = new Map();
  for (const p of periods) if (!byNo.has(p.periodNo)) byNo.set(p.periodNo, p);
  const list = [...byNo.values()].sort((a, b) => toMin(a.start) - toMin(b.start));
  const out = [];
  list.forEach((p, i) => {
    out.push(p);
    const next = list[i + 1];
    if (next && toMin(next.start) - toMin(p.end) >= 10) {
      const lunch = toMin(next.start) - toMin(p.end) >= 45;
      out.push({ kind: lunch ? 'LUNCH' : 'BREAK', label: lunch ? 'Lunch' : 'Break', start: p.end, end: next.start });
    }
  });
  return out;
}

const PHASE_LABEL = { ARRIVAL: 'Arrival', ASSEMBLY: 'Assembly', BREAK: 'Break', LUNCH: 'Lunch break', DISPERSAL: 'Dispersal', CLUBS: 'After-school clubs' };

/**
 * Where a shift is at a minute of its day:
 *   BEFORE · ARRIVAL · ASSEMBLY · PERIOD · BREAK · LUNCH · PASSING (between two
 *   bells) · DISPERSAL · CLUBS · AFTER
 * with the period number, how many periods the day has and the minutes left.
 */
export function phaseOf(shift, minutes) {
  const bells = normaliseBells(shift.bells);
  const periodsTotal = bells.filter((b) => b.kind === 'PERIOD').length;
  const firstSchool = bells.find((b) => b.kind !== 'CLUBS');
  const base = { shiftId: shift.id ?? null, code: shift.code ?? null, name: shift.name ?? null, periodsTotal, opensAt: firstSchool ? firstSchool.start : null, closesAt: null };
  const school = bells.filter((b) => b.kind !== 'CLUBS');
  if (school.length) base.closesAt = hhmm(Math.max(...school.map((b) => b.e)));
  if (!bells.length) return { ...base, phase: 'AFTER', label: 'No bell schedule', minutesLeft: null, periodNo: null };
  const now = bells.filter((b) => b.s <= minutes && b.e > minutes);
  // A clubs bell overlapping dispersal: the school bell wins.
  const bell = now.find((b) => b.kind !== 'CLUBS') ?? now[0];
  if (bell) {
    const left = bell.e - minutes;
    const label = bell.kind === 'PERIOD'
      ? `Period ${bell.periodNo ?? '?'} of ${periodsTotal}, ${left} min left`
      : bell.kind === 'ARRIVAL' ? `Arrival: first bell at ${fmt12(bell.e)}` : `${bell.label || PHASE_LABEL[bell.kind]}${['BREAK', 'LUNCH'].includes(bell.kind) ? `, ${left} min left` : ''}`;
    return { ...base, phase: bell.kind, periodNo: bell.kind === 'PERIOD' ? bell.periodNo ?? null : null, minutesLeft: left, label, until: bell.end };
  }
  if (minutes < bells[0].s) return { ...base, phase: 'BEFORE', periodNo: null, minutesLeft: null, label: `Opens ${fmt12(bells[0].s)}` };
  const lastEnd = Math.max(...bells.map((b) => b.e));
  if (minutes >= lastEnd) return { ...base, phase: 'AFTER', periodNo: null, minutesLeft: null, label: 'Day over' };
  const next = bells.find((b) => b.s > minutes);
  const prev = [...bells].reverse().find((b) => b.e <= minutes);
  // Between dispersal and clubs, or between the last period and dispersal: nobody is timetabled.
  if (prev && ['DISPERSAL'].includes(prev.kind)) return { ...base, phase: 'AFTER', periodNo: null, minutesLeft: null, label: next?.kind === 'CLUBS' ? `Clubs from ${fmt12(next.s)}` : 'Day over' };
  return { ...base, phase: 'PASSING', periodNo: null, minutesLeft: next ? next.s - minutes : null, label: next?.kind === 'PERIOD' ? `Changeover: period ${next.periodNo} at ${fmt12(next.s)}` : 'Changeover', nextPeriodNo: next?.kind === 'PERIOD' ? next.periodNo : null, prevPeriodNo: prev?.kind === 'PERIOD' ? prev.periodNo : null };
}

/** The first bell of the day for the shifts running on a date, or null. */
function openingMinute(shifts, ymd) {
  const dow = dowOfYmd(ymd);
  const starts = shifts.filter((s) => (s.daysOfWeek?.length ? s.daysOfWeek : [1, 2, 3, 4, 5, 6]).includes(dow))
    .map((s) => normaliseBells(s.bells)[0]).filter(Boolean).map((b) => b.s);
  return starts.length ? Math.min(...starts) : null;
}

/** When the campus next opens after a moment: today later, or the next school day (within 60 days). */
export function nextOpening({ ymd, minutes, events = [], shifts = [], tz = DEFAULT_TZ }) {
  for (let i = 0; i <= 60; i++) {
    const day = addDaysYmd(ymd, i);
    const kind = dayKindFor({ ymd: day, events, shifts, tz });
    if (!kind.open) continue;
    const open = openingMinute(shifts, day);
    if (open === null) continue;
    if (i === 0 && open <= minutes) continue;
    return { date: day, time: hhmm(open), label: i === 0 ? fmt12(open) : i === 1 ? `tomorrow, ${fmt12(open)}` : `${shortDate(day)}, ${fmt12(open)}` };
  }
  return null;
}

/**
 * The banner over the map for a moment: "Holiday: Diwali", "School closed:
 * opens 7:45 am", "Break, 10 min left", "Period 3 of 8, 12 min left". With
 * several shifts at different points of their day, each is named.
 * `motion` says whether anyone should be shown moving about the campus.
 */
export function bannerFor({ day, phases = [], next = null }) {
  const opens = next ? `Opens ${next.label}` : null;
  if (!day.open) {
    const text = day.kind === 'WEEKLY_OFF' ? `Weekly off: ${day.title}` : `${CLOSED_TYPES[day.kind] ?? 'Closed'}: ${day.title}`;
    return { text, sub: opens, tone: day.kind === 'WEEKLY_OFF' ? 'closed' : 'holiday', motion: false };
  }
  const active = phases.filter((p) => !['BEFORE', 'AFTER'].includes(p.phase));
  if (!active.length) {
    return { text: `School closed${next ? `: opens ${next.label}` : ''}`, sub: day.kind === 'EXAM_ONLY' ? `Exam day: ${day.title}` : null, tone: 'closed', motion: false };
  }
  const labels = [...new Set(active.map((p) => p.label))];
  const text = labels.length === 1 && (active.length === phases.length || phases.length === 1)
    ? labels[0]
    : active.map((p) => `${p.name ?? 'School'}: ${p.label}`).join(' · ');
  const quiet = phases.filter((p) => ['BEFORE', 'AFTER'].includes(p.phase)).map((p) => `${p.name ?? 'School'}: ${p.phase === 'BEFORE' ? p.label.toLowerCase() : 'day over'}`);
  const kinds = new Set(active.map((p) => p.phase));
  const tone = day.kind === 'EXAM_ONLY' ? 'exam'
    : kinds.has('PERIOD') ? 'class'
      : kinds.has('BREAK') || kinds.has('LUNCH') ? 'break'
        : kinds.has('CLUBS') ? 'clubs' : 'arrival';
  const sub = [day.kind === 'EXAM_ONLY' ? `Exam day: ${day.title}. Only classes sitting a paper are in.` : null, quiet.length ? quiet.join(' · ') : null].filter(Boolean).join(' ') || null;
  return { text, sub, tone, motion: true };
}

/** Whether a subject is taught outdoors (games, sport, PE, yoga): the class goes to the ground. */
export const isOutdoorSubject = (name) => /\b(physical|sport|sports|games|p\.?\s?e\.?|yoga|athletics|drill)\b/i.test(String(name ?? ''));
