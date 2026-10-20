/**
 * Reporting periods and comparisons, in the school's own time zone.
 *
 * Every analytics figure and quarterly report is asked for over a period. A
 * period is a half-open range of instants [start, end): the UI's inclusive
 * dates ("1 April to 30 June") are converted at local midnight in the school's
 * time zone, so a payment at 00:30 IST on 1 July is in July, not June.
 *
 * Academic and financial years are configured per school (start month) and are
 * never assumed to be the same thing. Comparisons are explicit about what they
 * compare: the previous equivalent period, the same elapsed part of last year,
 * a prior academic or financial year, or a custom range. A change against a
 * zero baseline is reported as not comparable, never as infinity.
 */
import { AppError } from './AppError.js';

export const DEFAULT_TZ = process.env.SCHOOL_TIMEZONE || 'Asia/Kolkata';
const DAY = 86_400_000;

/** Minutes the zone is ahead of UTC at a given instant (handles zones with DST too). */
export function tzOffsetMinutes(at, tz = DEFAULT_TZ) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(at).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** The instant of local midnight at the start of a calendar date in the zone. */
export function localMidnight(y, m, d, tz = DEFAULT_TZ) {
  const guess = new Date(Date.UTC(y, m - 1, d));
  const offset = tzOffsetMinutes(guess, tz);
  const at = new Date(guess.getTime() - offset * 60_000);
  // Recheck with the offset in force at that instant (a DST change near midnight).
  const offset2 = tzOffsetMinutes(at, tz);
  return offset2 === offset ? at : new Date(guess.getTime() - offset2 * 60_000);
}

/** The local calendar date {y, m, d} of an instant. */
export function localDate(at, tz = DEFAULT_TZ) {
  const shifted = new Date(at.getTime() + tzOffsetMinutes(at, tz) * 60_000);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate(), dow: shifted.getUTCDay() };
}

const parseYmd = (s, label) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (!m) throw new AppError(`${label} must be a date like 2026-04-01`, 400, [], 'BAD_DATE');
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) throw new AppError(`${label} is not a real date`, 400, [], 'BAD_DATE');
  return { y, m: mo, d };
};
const ymd = ({ y, m, d }) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const addDays = ({ y, m, d }, n) => { const t = new Date(Date.UTC(y, m - 1, d) + n * DAY); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** The same calendar date a number of years away; 29 February becomes 28 February in a non-leap year. */
const shiftYears = ({ y, m, d }, n) => ({ y: y + n, m, d: Math.min(d, daysInMonth(y + n, m)) });

/** Build a period from inclusive local dates. */
export function periodFromDates(fromYmd, toYmd, { tz = DEFAULT_TZ, label } = {}) {
  const from = typeof fromYmd === 'string' ? parseYmd(fromYmd, 'from') : fromYmd;
  const to = typeof toYmd === 'string' ? parseYmd(toYmd, 'to') : toYmd;
  const start = localMidnight(from.y, from.m, from.d, tz);
  const endDay = addDays(to, 1);
  const end = localMidnight(endDay.y, endDay.m, endDay.d, tz);
  if (end <= start) throw new AppError('The end date must be on or after the start date.', 400, [], 'BAD_RANGE');
  const days = Math.round((Date.UTC(to.y, to.m - 1, to.d) - Date.UTC(from.y, from.m - 1, from.d)) / DAY) + 1;
  if (days > 3700) throw new AppError('Choose a range of at most ten years.', 400, [], 'RANGE_TOO_LONG');
  return { from: ymd(from), to: ymd(to), start, end, days, tz, label: label ?? `${ymd(from)} to ${ymd(to)}` };
}

/** The year that a start month begins and that contains the given local date (academic or financial year). */
function yearStarting(startMonth, date) {
  const y = date.m >= startMonth ? date.y : date.y - 1;
  return { from: { y, m: startMonth, d: 1 }, to: addDays({ y: y + 1, m: startMonth, d: 1 }, -1), name: startMonth === 1 ? String(y) : `${y}-${String((y + 1) % 100).padStart(2, '0')}` };
}

/**
 * Resolve a requested period.
 *   preset: today | week | month | quarter | year | academicYear | financialYear | custom
 *   from/to: inclusive local dates for custom
 *   academicYearStartMonth / financialYearStartMonth: the school's configuration
 *   now: for tests
 */
export function resolvePeriod({ preset = 'month', from, to, tz = DEFAULT_TZ, academicYearStartMonth = 4, financialYearStartMonth = 4, now = new Date(), year } = {}) {
  const today = localDate(now, tz);
  switch (preset) {
    case 'custom':
      return periodFromDates(from, to, { tz });
    case 'today':
      return periodFromDates(today, today, { tz, label: 'Today' });
    case 'week': {
      // Monday to today.
      const monday = addDays(today, -((today.dow + 6) % 7));
      return periodFromDates(monday, today, { tz, label: 'This week' });
    }
    case 'month':
      return periodFromDates({ y: today.y, m: today.m, d: 1 }, today, { tz, label: 'This month' });
    case 'quarter': {
      // Quarters of the financial year (April-June is Q1 for a school starting in April).
      const fyStart = financialYearStartMonth;
      const offset = (today.m - fyStart + 12) % 12;
      const qStartMonth = ((fyStart - 1 + Math.floor(offset / 3) * 3) % 12) + 1;
      const qYear = qStartMonth > today.m ? today.y - 1 : today.y;
      return periodFromDates({ y: qYear, m: qStartMonth, d: 1 }, today, { tz, label: `Quarter ${Math.floor(offset / 3) + 1} (so far)` });
    }
    case 'year':
      return periodFromDates({ y: today.y, m: 1, d: 1 }, today, { tz, label: `${today.y} (so far)` });
    case 'academicYear':
    case 'financialYear': {
      const startMonth = preset === 'academicYear' ? academicYearStartMonth : financialYearStartMonth;
      const anchor = year ? { y: +year, m: startMonth, d: 1 } : today;
      const yr = yearStarting(startMonth, anchor);
      // The current year runs to today; a past year is complete.
      const toDate = Date.UTC(yr.to.y, yr.to.m - 1, yr.to.d) > Date.UTC(today.y, today.m - 1, today.d) ? today : yr.to;
      const partial = toDate !== yr.to;
      return { ...periodFromDates(yr.from, toDate, { tz, label: `${preset === 'academicYear' ? 'Academic' : 'Financial'} year ${yr.name}${partial ? ' (so far)' : ''}` }), partial };
    }
    default:
      throw new AppError(`Unknown period ${preset}`, 400, [], 'BAD_PERIOD');
  }
}

/**
 * The period to compare with.
 *   previous: the same number of days immediately before
 *   lastYear: the same dates a year earlier (the same elapsed part, for a partial period)
 *   priorYears: n years earlier (for multi-year trends)
 *   custom: compareFrom/compareTo
 */
export function comparisonPeriod(period, { mode = 'previous', compareFrom, compareTo, years = 1 } = {}) {
  const tz = period.tz;
  const from = parseYmd(period.from, 'from');
  const to = parseYmd(period.to, 'to');
  if (mode === 'none') return null;
  if (mode === 'custom') return periodFromDates(compareFrom, compareTo, { tz, label: 'Comparison' });
  if (mode === 'previous') {
    const end = addDays(from, -1);
    return periodFromDates(addDays(end, -(period.days - 1)), end, { tz, label: 'Previous period' });
  }
  if (mode === 'lastYear' || mode === 'priorYears') {
    const n = mode === 'lastYear' ? 1 : Math.max(1, Math.min(Number(years) || 1, 10));
    return periodFromDates(shiftYears(from, -n), shiftYears(to, -n), { tz, label: n === 1 ? 'Same period last year' : `Same period ${n} years earlier` });
  }
  throw new AppError(`Unknown comparison ${mode}`, 400, [], 'BAD_COMPARISON');
}

/** A change between two values; a zero or missing baseline is not comparable. */
export function change(current, previous) {
  if (current === null || current === undefined) return { current: null, previous: previous ?? null, abs: null, pct: null, comparable: false, reason: 'No current value' };
  if (previous === null || previous === undefined) return { current, previous: null, abs: null, pct: null, comparable: false, reason: 'No value for the comparison period' };
  const abs = current - previous;
  if (previous === 0) return { current, previous, abs, pct: null, comparable: false, reason: 'The comparison value is zero' };
  return { current, previous, abs, pct: Math.round((abs / Math.abs(previous)) * 1000) / 10, comparable: true, reason: null };
}

/** Splits a period into buckets (day, week or month) for trend charts. */
export function buckets(period, unit = 'auto') {
  const u = unit === 'auto' ? (period.days <= 31 ? 'day' : period.days <= 120 ? 'week' : 'month') : unit;
  const out = [];
  let cur = parseYmd(period.from, 'from');
  const last = parseYmd(period.to, 'to');
  const lastUtc = Date.UTC(last.y, last.m - 1, last.d);
  while (Date.UTC(cur.y, cur.m - 1, cur.d) <= lastUtc) {
    let next;
    if (u === 'day') next = addDays(cur, 1);
    else if (u === 'week') next = addDays(cur, 7);
    else next = cur.m === 12 ? { y: cur.y + 1, m: 1, d: 1 } : { y: cur.y, m: cur.m + 1, d: 1 };
    const endDay = addDays(next, -1);
    const capped = Date.UTC(endDay.y, endDay.m - 1, endDay.d) > lastUtc ? last : endDay;
    out.push({ ...periodFromDates(cur, capped, { tz: period.tz, label: u === 'month' ? `${cur.y}-${String(cur.m).padStart(2, '0')}` : ymd(cur) }), unit: u });
    cur = next;
  }
  return out;
}
