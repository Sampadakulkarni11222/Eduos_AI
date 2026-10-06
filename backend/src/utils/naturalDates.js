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
