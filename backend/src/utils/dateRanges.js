/**
 * The span of days a sentence asks about.
 *
 * `naturalDates.js` answers "which month?" and "which day?". Neither is what
 * somebody means by "attendance statistics for the last one year" or "holidays
 * from June to September 2026", and the measured failure was exactly that: a
 * request carrying a range reached a capability that only understood a single
 * day, the range was dropped, and the assistant answered confidently about
 * today. A range that cannot be read must stay null so the request is refused
 * or clarified -- silently substituting today is the bug this file exists to
 * stop.
 *
 * Returns `{ from, to }` as ISO dates, or null. Nothing here decides which
 * capability runs; it reads one dimension out of a sentence, the way
 * `classFromText` reads a class.
 */

import { toIsoDate, toIsoMonth } from './naturalDates.js';

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** The first and last day of a "YYYY-MM" month. */
export function monthBounds(isoMonthValue) {
  const [year, month] = String(isoMonthValue).split('-').map(Number);
  if (!year || !month) return null;
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  return { from: iso(from), to: iso(to) };
}

const UNIT_DAYS = { day: 1, week: 7, month: 30, year: 365 };
const WORD_NUMBERS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const MONTH_WORD = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';

/**
 * A span of days named anywhere in a sentence, or null.
 *
 * Five forms, in order of how specific they are:
 *
 *   two ISO dates          "from 2026-06-01 to 2026-09-30"
 *   month to month         "from June to September 2026" -- the trailing year
 *                          governs both, and a second month earlier than the
 *                          first rolls into the next year
 *   a named academic span  "the last 1 year", "last 6 months", "past 30 days"
 *   this/last month        via toIsoMonth, widened to that month's own bounds
 *   a single named month   "August 2026" -> the whole of August
 *
 * A bare day ("today") is deliberately NOT a range: a capability that wants one
 * day already reads it, and widening a day into a range would let a question
 * about today be answered with a year.
 */
export function rangeFromText(text, now = new Date()) {
  const str = String(text ?? '');

  const isoDates = [...new Set([...str.matchAll(/\b(\d{4}-\d{1,2}-\d{1,2})\b/g)].map((m) => m[1]))]
    .map((d) => toIsoDate(d, now))
    .filter(Boolean)
    .sort();
  if (isoDates.length >= 2) return { from: isoDates[0], to: isoDates[isoDates.length - 1] };

  // "from June to September 2026", "between June and September 2026"
  const spanned = new RegExp(
    `\\b(?:from|between)?\\s*(${MONTH_WORD})\\s*(20\\d{2})?\\s*(?:to|until|till|through|-|and)\\s*(${MONTH_WORD})\\s*(20\\d{2})?\\b`,
    'i',
  ).exec(str);
  if (spanned) {
    const [, firstName, firstYear, secondName, secondYear] = spanned;
    const year = secondYear ?? firstYear ?? null;
    const start = toIsoMonth(year ? `${firstName} ${firstYear ?? year}` : firstName, now);
    let end = toIsoMonth(year ? `${secondName} ${year}` : secondName, now);
    if (start && end) {
      // "November to February" crosses a year end; without this the range came
      // back inverted and matched nothing.
      if (end < start) {
        const [y, m] = end.split('-');
        end = `${Number(y) + 1}-${m}`;
      }
      const a = monthBounds(start);
      const b = monthBounds(end);
      if (a && b) return { from: a.from, to: b.to };
    }
  }

  // "the last 1 year", "last 6 months", "past 30 days", "previous two weeks"
  const relative = new RegExp(
    `\\b(?:last|past|previous|recent)\\s+(\\d{1,3}|${Object.keys(WORD_NUMBERS).join('|')})?\\s*(day|week|month|year)s?\\b`,
    'i',
  ).exec(str);
  if (relative) {
    const count = relative[1]
      ? Number(relative[1]) || WORD_NUMBERS[relative[1].toLowerCase()] || 1
      : 1;
    const unit = UNIT_DAYS[relative[2].toLowerCase()];
    if (unit && count > 0) {
      const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const from = new Date(to.getTime() - (count * unit - 1) * 86_400_000);
      return { from: iso(from), to: iso(to) };
    }
  }

  // "this month", "last month" -- a month, widened to its own bounds.
  const namedMonth = /\b(this|current|last|previous|next)\s+month\b/i.exec(str);
  if (namedMonth) {
    const bounds = monthBounds(toIsoMonth(`${namedMonth[1].toLowerCase()} month`, now));
    if (bounds) return bounds;
  }

  // "August 2026", "in August" -- the whole month. Requires a year or a
  // preposition, so a surname that happens to be a month name is not a range.
  const single = new RegExp(`\\b(?:for|in|of|during)\\s+(${MONTH_WORD})\\s*(20\\d{2})?\\b|\\b(${MONTH_WORD})\\s+(20\\d{2})\\b`, 'i').exec(str);
  if (single) {
    const name = single[1] ?? single[3];
    const year = single[2] ?? single[4];
    const bounds = monthBounds(toIsoMonth(year ? `${name} ${year}` : name, now));
    if (bounds) return bounds;
  }

  // "this year", "this academic year"
  if (/\bthis\s+(?:academic\s+)?year\b/i.test(str)) {
    const year = now.getUTCFullYear();
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }

  return null;
}

/** True when the sentence asks about a span rather than a moment. */
export function namesRange(text, now = new Date()) {
  return rangeFromText(text, now) !== null;
}
