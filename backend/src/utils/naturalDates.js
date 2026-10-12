/**
 * Months and dates as people write them.
 *
 * The MCP schemas declare `^\d{4}-\d{2}$` for a month and `^\d{4}-\d{2}-\d{2}$`
 * for a date, which is the right contract for a service and the wrong thing to
 * expect from a sentence. Both the rule parser and a language model fill those
 * arguments from what somebody typed -- "july", "last month", "2026-7",
 * "tomorrow" -- and every one of those used to be rejected before any tool ran.
 * The real report this exists to fix: a student asked "show my attendance for
 * july" and was told "I need a bit more to do that", because `month: "july"`
 * failed a pattern.
 *
 * So a value is normalised to the shape the pattern wants and only then
 * checked. What is deliberately *not* here is a guess: a month nobody can parse
 * returns null and the caller is told so, rather than quietly becoming "this
 * month" and answering a different question confidently.
 *
 * Used by mcp/validate.js (arguments arriving from a model) and by
 * agent/intent.js (the deterministic rule parser), so the two paths understand
 * exactly the same phrasings.
 */

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

const pad = (n) => String(n).padStart(2, '0');
const isoMonth = (year, month1) => `${year}-${pad(month1)}`;
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "YYYY-MM-DD" for a day that exists, else null: "31 February" is nobody's date. */
function calendarDate(year, month1, day) {
  if (month1 < 1 || month1 > 12 || day < 1) return null;
  const probe = new Date(year, month1 - 1, day);
  return probe.getMonth() === month1 - 1 ? `${year}-${pad(month1)}-${pad(day)}` : null;
}

/**
 * 0-11 for a full or abbreviated English month name, or -1.
 *
 * Abbreviations are matched as prefixes, so "sep", "sept" and "september" all
 * land on the same month. Three letters is the floor: "ju" is ambiguous between
 * June and July, and picking one would be a guess.
 */
function monthIndex(word) {
  const w = String(word).toLowerCase().replace(/\.$/, '');
  const exact = MONTH_NAMES.indexOf(w);
  if (exact >= 0) return exact;
  if (w.length < 3) return -1;
  const prefixed = MONTH_NAMES.filter((name) => name.startsWith(w));
  return prefixed.length === 1 ? MONTH_NAMES.indexOf(prefixed[0]) : -1;
}

/**
 * The year a bare month name means.
 *
 * "July" asked in September means this July. "December" asked in September
 * means last December, not one that has not happened yet -- a question about
 * attendance or fees is always about a month that exists.
 */
function yearForBareMonth(monthIdx, now) {
  return monthIdx <= now.getMonth() ? now.getFullYear() : now.getFullYear() - 1;
}

/**
 * One value → "YYYY-MM", or null when it cannot be read as a month.
 *
 * Accepts the ISO form unchanged, loose digits ("2026-7", "07/2026"), relative
 * months ("this/last/previous/next month") and names with or without a year
 * ("july", "Jul 2026", "2026 July").
 */
export function toIsoMonth(value, now = new Date()) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  // The ISO form is range-checked rather than waved through: "2026-13" is the
  // right shape and not a month, and passing it back unchanged would hand a
  // service a date it cannot use.
  const iso = /^(\d{4})-(\d{2})$/.exec(text);
  if (iso) return Number(iso[2]) >= 1 && Number(iso[2]) <= 12 ? text : null;

  let m = /^(\d{4})[-/](\d{1,2})$/.exec(text);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return isoMonth(m[1], Number(m[2]));
  m = /^(\d{1,2})[-/](\d{4})$/.exec(text);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return isoMonth(m[2], Number(m[1]));

  const relative = /^(this|current|last|previous|next)\s+month$/.exec(text);
  if (relative) {
    const shift = { this: 0, current: 0, last: -1, previous: -1, next: 1 }[relative[1]];
    const d = new Date(now.getFullYear(), now.getMonth() + shift, 1);
    return isoMonth(d.getFullYear(), d.getMonth() + 1);
  }

  m = /^([a-z]{3,9})\.?(?:\s+(\d{4}))?$/.exec(text) ?? /^(?:(\d{4})\s+)?([a-z]{3,9})\.?$/.exec(text);
  if (m) {
    // Either capture order: "july 2026" or "2026 july".
    const [namePart, yearPart] = /^\d{4}$/.test(m[1] ?? '') ? [m[2], m[1]] : [m[1], m[2]];
    const idx = monthIndex(namePart);
    if (idx >= 0) return isoMonth(yearPart ? Number(yearPart) : yearForBareMonth(idx, now), idx + 1);
  }
  return null;
}

/**
 * One value → "YYYY-MM-DD", or null when it cannot be read as a date.
 *
 * Accepts the ISO form unchanged, loose digits ("2026-9-1"), the three relative
 * days a conversation actually uses, named forms ("1 July 2026",
 * "July 1st"), and all-digit dates with a four-digit year written DAY FIRST
 * ("07-10-2026", "07/10/2026", "7.10.2026" = 7 October 2026).
 *
 * Day-first is a decision, not a guess: these are Indian schools, where
 * DD-MM-YYYY is how every date is written, and refusing it outright meant
 * "Leave from 07-10-2026 to 09-10-2026" was read as no dates at all. It is
 * never read month-first -- "12-13-2026" is not a date -- and a day that does
 * not exist ("31-02-2026") is refused rather than rolled over.
 */
export function toIsoDate(value, now = new Date()) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const dayFirst = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})$/.exec(text);
  if (dayFirst) return calendarDate(Number(dayFirst[4]), Number(dayFirst[3]), Number(dayFirst[1]));

  const day = 86_400_000;
  if (text === 'today') return isoDate(now);
  if (text === 'tomorrow') return isoDate(new Date(now.getTime() + day));
  if (text === 'yesterday') return isoDate(new Date(now.getTime() - day));
  if (text === 'day after tomorrow') return isoDate(new Date(now.getTime() + 2 * day));

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;

  // "1 July 2026", "1 jul"
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?(?:,?\s+(\d{4}))?$/.exec(text);
  if (m) {
    const idx = monthIndex(m[2]);
    if (idx >= 0) return `${m[3] ? Number(m[3]) : yearForBareMonth(idx, now)}-${pad(idx + 1)}-${pad(m[1])}`;
  }
  // "July 1 2026", "July 1st"
  m = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/.exec(text);
  if (m) {
    const idx = monthIndex(m[1]);
    if (idx >= 0) return `${m[3] ? Number(m[3]) : yearForBareMonth(idx, now)}-${pad(idx + 1)}-${pad(m[2])}`;
  }
  return null;
}

/*
 * toIsoDate() reads "5th August 2026" when that is the whole value; a sentence
 * carries it among other words, and nothing looked for it there. So "show
 * attendance for Class 5-A on 5th August 2026" was read for its MONTH alone --
 * "August 2026" -- and answered with the whole of August: a day widened into a
 * month, which is the specificity failure this codebase guards against
 * everywhere else.
 *
 * Returned with the span each date occupies, so a caller can take the date out
 * of the sentence before reading it for anything else. A day number is part of
 * a date, not a period number or a limit, and the month inside a date is not a
 * month being asked about.
 *
 * "may" needs a year, for the reason monthFromText() gives: "5 may be absent"
 * is not the fifth of May.
 */
const DAY_FIRST = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\.?(?:,?\s+(\d{4}))?\b/gi;
const MONTH_FIRST = /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/gi;
// "07-10-2026", "07/10/2026": all digits, four-digit year, day first -- see
// toIsoDate(). Not part of a longer run of digits or separators, so an id or a
// phone number is never read as one.
const NUMERIC_DAY_FIRST = /(?<![\d/.-])(\d{1,2})([-/.])(\d{1,2})\2(\d{4})(?![\d/.-])/g;
// "7th to 9th October", "7-9 Oct 2026": a range whose month is written once,
// after its second day. Without this only "9th October" was a date and the
// "7th" was lost.
const DAY_RANGE_ONE_MONTH = /\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:to|till|until|through|-|–|and)\s*(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\.?(?:,?\s+(\d{4}))?\b/gi;

/**
 * Day-first numeric dates in a sentence that are not real days ("31-02-2026"),
 * as written. A caller that finds one must not take the sentence's OTHER date
 * on its own -- "from 31-02-2026 to 02-03-2026" is not a one-day request for
 * 2 March -- and should ask instead.
 */
export function unreadableDatesIn(text) {
  return [...String(text ?? '').matchAll(NUMERIC_DAY_FIRST)]
    .filter((m) => !calendarDate(Number(m[4]), Number(m[3]), Number(m[1])))
    .map((m) => m[0]);
}

/** True for "YYYY-MM-DD" naming a day that exists: "2026-02-31" is the right shape and no day. */
export function isCalendarIsoDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
  return Boolean(m && calendarDate(Number(m[1]), Number(m[2]), Number(m[3])));
}

const ISO_SHAPED = /(?<![\d-])(\d{4})-(\d{1,2})-(\d{1,2})(?![\d-])/g;
// A number after a month name that is a COUNT, not a day: "give April 31
// marks" is thirty-one marks for a pupil called April.
const COUNTED = /^\s*(?:marks?|points?|students?|pupils?|days?|periods?|copies|books?|rupees|rs\b|%|percent)/i;

/**
 * Every date in a sentence that names a day which does not exist, as written:
 * "31 February", "February 30", "31st of April 2026", "29 Feb 2027",
 * "31-02-2026", "2026-02-31", "30 to 31 June".
 *
 * A date like this used to be skipped by every reader -- none of them could
 * place it -- and the request then ran for whatever the tool's default is.
 * "Mark Aman Gupta absent on 31 February" was proposed for TODAY. A caller
 * that finds one asks for a real date and does nothing else.
 *
 * Written with no year, a date is judged in the year it would be read in
 * (yearForBareMonth) -- so "29 February" is refused in a year with no such
 * day rather than read as nothing; the person is asked for the full date.
 * "may" needs a year, as everywhere in this file.
 */
export function impossibleDatesIn(text, now = new Date()) {
  const str = String(text ?? '');
  const found = [];
  const add = (index, written) => { if (!found.some((f) => f.index === index)) found.push({ index, written }); };

  // Digits are only a date when the year is one: "98-76-5432" is part of a
  // phone number, not the 98th of the 76th month.
  const aYear = (year) => year >= 1900 && year <= 2100;
  for (const m of str.matchAll(NUMERIC_DAY_FIRST)) {
    if (aYear(Number(m[4])) && !calendarDate(Number(m[4]), Number(m[3]), Number(m[1]))) add(m.index, m[0]);
  }
  for (const m of str.matchAll(ISO_SHAPED)) {
    if (aYear(Number(m[1])) && !calendarDate(Number(m[1]), Number(m[2]), Number(m[3]))) add(m.index, m[0]);
  }
  const real = (year, idx, day) => Boolean(calendarDate(year, idx + 1, day));
  // With no year, only a number that could be a day of SOME month is taken
  // for one: "top 50 Dec defaulters" is a count.
  const dayLike = (day, yearGiven) => yearGiven || (day >= 1 && day <= 31);
  for (const m of str.matchAll(DAY_RANGE_ONE_MONTH)) {
    const word = m[3].toLowerCase();
    const idx = monthIndex(word);
    if (idx < 0 || (word === 'may' && !m[4])) continue;
    const year = m[4] ? Number(m[4]) : yearForBareMonth(idx, now);
    if (!dayLike(Number(m[1]), Boolean(m[4])) || !dayLike(Number(m[2]), Boolean(m[4]))) continue;
    if (!real(year, idx, Number(m[1])) || !real(year, idx, Number(m[2]))) add(m.index, m[0]);
  }
  for (const [re, dayAt, monthAt] of [[DAY_FIRST, 1, 2], [MONTH_FIRST, 2, 1]]) {
    for (const m of str.matchAll(re)) {
      const word = m[monthAt].toLowerCase();
      const idx = monthIndex(word);
      if (idx < 0 || (word === 'may' && !m[3])) continue;
      if (re === MONTH_FIRST && !m[3] && COUNTED.test(str.slice(m.index + m[0].length))) continue;
      // Inside a range already judged above ("30 to 31 June").
      if (found.some((f) => m.index >= f.index && m.index < f.index + f.written.length)) continue;
      const year = m[3] ? Number(m[3]) : yearForBareMonth(idx, now);
      if (!dayLike(Number(m[dayAt]), Boolean(m[3]))) continue;
      if (!real(year, idx, Number(m[dayAt]))) add(m.index, m[0]);
    }
  }
  return found.sort((a, b) => a.index - b.index).map((f) => f.written.trim());
}

/**
 * Every calendar date a sentence names -- in words ("5th August 2026"), as a
 * day-first numeric date ("05-08-2026"), or as a one-month range ("7th to 9th
 * October") -- in order.
 */
export function writtenDatesIn(text, now = new Date()) {
  const str = String(text ?? '');
  const found = [];
  const overlaps = (start, end) => found.some((f) => start < f.end && end > f.start);

  for (const m of str.matchAll(NUMERIC_DAY_FIRST)) {
    const iso = calendarDate(Number(m[4]), Number(m[3]), Number(m[1]));
    if (!iso) continue;
    found.push({ text: m[0], iso, start: m.index, end: m.index + m[0].length, yearGiven: true });
  }

  for (const m of str.matchAll(DAY_RANGE_ONE_MONTH)) {
    const monthWord = m[3].toLowerCase();
    const idx = monthIndex(monthWord);
    if (idx < 0 || (monthWord === 'may' && !m[4])) continue;
    const year = m[4] ? Number(m[4]) : yearForBareMonth(idx, now);
    const first = calendarDate(year, idx + 1, Number(m[1]));
    const second = calendarDate(year, idx + 1, Number(m[2]));
    if (!first || !second || overlaps(m.index, m.index + m[0].length)) continue;
    // Two spans, so a caller removing dates from the sentence removes both.
    const firstText = m[0].slice(0, m[0].search(/\s*(?:to|till|until|through|-|–|and)\s*\d/i));
    const secondStart = m.index + m[0].indexOf(m[2], firstText.length);
    found.push({ text: firstText, iso: first, start: m.index, end: m.index + firstText.length, yearGiven: Boolean(m[4]) });
    found.push({ text: str.slice(secondStart, m.index + m[0].length), iso: second, start: secondStart, end: m.index + m[0].length, yearGiven: Boolean(m[4]) });
  }

  for (const [re, dayAt, monthAt] of [[DAY_FIRST, 1, 2], [MONTH_FIRST, 2, 1]]) {
    for (const m of str.matchAll(re)) {
      const monthWord = m[monthAt].toLowerCase();
      const idx = monthIndex(monthWord);
      if (idx < 0) continue;
      if (monthWord === 'may' && !m[3]) continue;
      const day = Number(m[dayAt]);
      const year = m[3] ? Number(m[3]) : yearForBareMonth(idx, now);
      // A real day of that month: "31 June" is nobody's date.
      const probe = new Date(year, idx, day);
      if (day < 1 || probe.getMonth() !== idx) continue;
      const start = m.index;
      const end = start + m[0].length;
      if (overlaps(start, end)) continue;
      found.push({ text: m[0], iso: `${year}-${pad(idx + 1)}-${pad(day)}`, start, end, yearGiven: Boolean(m[3]) });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_IN_TEXT = new RegExp(
  `\\b(?:(next|coming|this coming|upcoming|this|last|previous|past)\\s+)?(${WEEKDAY_NAMES.join('|')})\\b`, 'i',
);

/**
 * Argument names whose date is, by what they mean, still to come: a due date,
 * the days of a leave, when an event or an exam starts. A bare weekday written
 * into one of these is the NEXT such day; written anywhere else (a register
 * date, a payment date) it is the most recent one.
 */
export const FORWARD_DATE_ARGS = new Set([
  'dueAt', 'dueOn', 'fromDate', 'toDate', 'startsAt', 'endsAt', 'startsOn', 'endsOn', 'nextActionAt', 'examDate',
]);

/**
 * The calendar day a weekday name in a sentence means, or null.
 *
 * One definition for every tier, because the same word was being read two ways
 * and one of them was wrong: "apply for leave on Monday", said on a Sunday, was
 * proposed for the Monday six days EARLIER -- the only weekday reader in the
 * codebase was written for attendance registers and always looked back.
 *
 *   "next Monday", "coming Monday"   the first Monday strictly after today
 *   "last Monday", "previous Monday" the most recent Monday strictly before today
 *   "Monday" / "this Monday"         decided by `prefer`:
 *        'future'  the next Monday, today included (an instruction about a day
 *                  still to come: leave, a due date, an event)
 *        'past'    the most recent Monday before today (a question about a day
 *                  that has happened: attendance, a payment)
 *
 * On Saturday 10 October 2026: next Monday is the 12th, last Monday the 5th.
 * The qualifier always wins over `prefer` -- nobody who writes "last Monday"
 * means a day that has not happened. Local calendar days throughout, as every
 * other reader in this file.
 */
export function weekdayDateIn(text, now = new Date(), { prefer = 'past' } = {}) {
  const m = WEEKDAY_IN_TEXT.exec(String(text ?? ''));
  if (!m) return null;
  const qualifier = (m[1] ?? '').toLowerCase().replace(/\s+/g, ' ');
  const target = WEEKDAY_NAMES.indexOf(m[2].toLowerCase());
  const today = now.getDay();
  const ahead = (target - today + 7) % 7;
  const back = (today - target + 7) % 7;
  let offset;
  if (/^(?:next|coming|this coming|upcoming)$/.test(qualifier)) offset = ahead || 7;
  else if (/^(?:last|previous|past)$/.test(qualifier)) offset = -(back || 7);
  else offset = prefer === 'future' ? ahead : -(back || 7);
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return {
    iso: isoDate(day),
    text: m[0],
    weekday: m[2].toLowerCase(),
    qualifier: qualifier || null,
    direction: offset >= 0 ? 'future' : 'past',
  };
}

/** Today's local calendar day as "YYYY-MM-DD" (never the UTC day). */
export function localToday(now = new Date()) {
  return isoDate(now);
}

/**
 * The month a whole sentence is asking about, or null.
 *
 * Different job from toIsoMonth(): that reads one argument, this searches free
 * text. The ISO form is looked for first, so "my attendance for 2026-08" never
 * depends on word matching.
 *
 * "May" is the trap. It is an ordinary English verb ("may I see my
 * attendance?"), so a bare "may" is not treated as a month -- it counts only
 * when a preposition introduces it ("in may") or a year follows ("may 2026").
 * Every other month name is unambiguous enough to match on its own.
 */
export function monthFromText(text, now = new Date()) {
  const str = String(text ?? '');

  const iso = /\b(20\d{2})[-/](\d{1,2})\b/.exec(str);
  if (iso && Number(iso[2]) >= 1 && Number(iso[2]) <= 12) return isoMonth(iso[1], Number(iso[2]));

  const relative = /\b(this|current|last|previous|next)\s+month\b/i.exec(str);
  if (relative) return toIsoMonth(`${relative[1].toLowerCase()} month`, now);

  const names = MONTH_NAMES.join('|');
  const abbrevs = 'jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec';
  // With a year, or introduced by a preposition: "may" qualifies here.
  // The year is optional *inside* the cued form, not a separate branch: "for
  // may 2025" must keep its 2025, and matching "for may" first and stopping
  // threw the year away and inferred the current one instead.
  const cued = new RegExp(`\\b(?:for|in|of|during)\\s+(${names}|${abbrevs})\\.?(?:\\s+(20\\d{2}))?\\b`, 'i').exec(str)
    ?? new RegExp(`\\b(${names}|${abbrevs})\\.?\\s+(20\\d{2})\\b`, 'i').exec(str);
  if (cued) return toIsoMonth(cued[2] ? `${cued[1]} ${cued[2]}` : cued[1], now);

  // Bare name, "may" excluded for the reason above.
  const bare = new RegExp(`\\b(${names.replace('|may|', '|')}|${abbrevs})\\b`, 'i').exec(str);
  if (bare) return toIsoMonth(bare[1], now);

  return null;
}

/** True when a word reads as a month rather than a person's name. */
export function looksLikeMonth(value, now = new Date()) {
  return toIsoMonth(value, now) !== null;
}
