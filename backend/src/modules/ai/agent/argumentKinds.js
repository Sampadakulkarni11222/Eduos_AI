/**
 * What kind of value an argument holds, and how to read one out of a sentence.
 *
 * The legacy pattern rules carried an extractor per capability: one that knew
 * `attendanceBelowPct` is a percentage, another that knew `amountPaise` is a
 * sum of money, a third that knew `stage` is one of six admission stages. Thirty
 * rules, thirteen of them doing this, each written against one tool.
 *
 * None of that is a fact about the tool. It is a fact about the ARGUMENT, and
 * the argument already describes itself in its JSON Schema — an ObjectId
 * pattern, a date pattern, an `enum`, an integer with bounds. So the kind is
 * DERIVED from the schema rather than declared anywhere, and one extractor per
 * kind replaces one extractor per capability. A new tool that takes a
 * percentage gets percentage extraction by declaring `type: integer` and a name
 * the codebase already uses for percentages; nobody writes anything here.
 *
 * Two conventions this repository already keeps are read as meaning: a
 * `...Paise` integer is money (see rupees()/paise() in mcp/tools/_shared.js) and
 * a `...Pct` integer is a percentage. They are conventions rather than
 * declarations, and they hold across every module that uses them.
 *
 * Every extractor answers with a STATUS rather than a value alone:
 *
 *   found      a value the schema would accept
 *   missing    the sentence does not carry one — not an error, just absent
 *   ambiguous  more than one candidate, and choosing would be a guess
 *   invalid    something was said but it is not a value this argument accepts
 *
 * The distinction is what keeps a write safe. `missing` lets a tool ask;
 * `ambiguous` must never be resolved by picking the first match, because on a
 * write that means acting on the wrong record. Nothing here authorizes
 * anything, and nothing here decides which capability runs — it only fills in
 * arguments for a capability already chosen, which the MCP server then
 * validates and authorizes again.
 */

import { monthFromText, toIsoDate, writtenDatesIn, unreadableDatesIn } from '../../../utils/naturalDates.js';

export const FOUND = 'found';
export const MISSING = 'missing';
export const AMBIGUOUS = 'ambiguous';
export const INVALID = 'invalid';

const found = (value) => ({ status: FOUND, value });
const missing = () => ({ status: MISSING, value: undefined });
const ambiguous = (candidates) => ({ status: AMBIGUOUS, value: undefined, candidates });
const invalid = (reason) => ({ status: INVALID, value: undefined, reason });

const OBJECT_ID = /^\^?\[a-f0-9\]\{24\}\$?$/;
const isObjectIdPattern = (pattern) => typeof pattern === 'string' && pattern.includes('[a-f0-9]{24}');
const isDatePattern = (pattern) => typeof pattern === 'string' && /\\d\{4\}-\\d\{2\}-\\d\{2\}/.test(pattern);
const isMonthPattern = (pattern) => typeof pattern === 'string' && /\\d\{4\}-\\d\{2\}\$/.test(pattern) && !isDatePattern(pattern);

/**
 * The kind of value one argument holds, from its schema alone.
 *
 * Order matters: the most specific evidence wins. An `enum` is an enum whatever
 * its type, and a pattern says more than a type does.
 */
export function kindOfProperty(name, schema = {}) {
  if (Array.isArray(schema.enum)) return 'enum';
  if (isObjectIdPattern(schema.pattern)) return 'identifier';
  if (isMonthPattern(schema.pattern)) return 'month';
  if (isDatePattern(schema.pattern)) return 'date';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'integer' || schema.type === 'number') {
    // Two naming conventions this codebase already keeps, read as meaning.
    if (/Paise$/.test(name)) return 'money';
    if (/Pct$/.test(name)) return 'percentage';
    return 'number';
  }
  if (schema.type === 'string') return 'text';
  return null;
}

/** Every argument of a capability, by kind. */
export function kindsOfSchema(inputSchema = {}) {
  const out = {};
  for (const [name, schema] of Object.entries(inputSchema.properties ?? {})) {
    const kind = kindOfProperty(name, schema);
    if (kind) out[name] = kind;
  }
  return out;
}

/* ── The extractors ───────────────────────────────────────── */

/**
 * An identifier the caller actually wrote down.
 *
 * Only a literal ObjectId counts. This is the security-sensitive kind: nothing
 * else in a sentence may become an id, because an id is a claim about WHICH
 * record, and inventing one means acting on a record nobody named. Two
 * different ids in one message is ambiguous rather than "the first one".
 *
 * A value found here is still only a proposal: the server re-resolves it at the
 * caller's own scope, so a real id belonging to someone else is refused there.
 */
export function extractIdentifier(message) {
  const matches = [...String(message ?? '').matchAll(/\b([a-f0-9]{24})\b/gi)].map((m) => m[1].toLowerCase());
  const unique = [...new Set(matches)];
  if (!unique.length) return missing();
  if (unique.length > 1) return ambiguous(unique);
  return found(unique[0]);
}

/**
 * One of the values the schema itself allows.
 *
 * The allowed values come from the schema, so there is no list of words here to
 * fall out of date — a tool that adds a status gets it recognised the same day.
 * Matching is on the value's own spelling, with underscores read as spaces
 * (TOUR_SCHEDULED is written "tour scheduled" by a person), and a value that
 * was clearly meant but is not allowed is INVALID rather than quietly dropped.
 */
export function extractEnum(message, schema = {}) {
  const values = Array.isArray(schema.enum) ? schema.enum : [];
  if (!values.length) return missing();
  const text = String(message ?? '');

  // A person writes the verb, not the stored value: "approve this request"
  // asks for the status APPROVED, and matching the value's own spelling alone
  // found nothing -- so a decision tool could never be reached from the word
  // that asks for it. The value's stem is tried as a prefix, which covers
  // approve/approved/approving without a list of inflections anywhere.
  const stemOf = (word) => String(word).toLowerCase().replace(/(ed|ing|s)$/, '');
  const hits = values.filter((value) => {
    const spelt = String(value).replace(/_/g, '[ _]');
    if (new RegExp(`\\b${spelt}\\b`, 'i').test(text)) return true;
    const root = stemOf(String(value).replace(/_/g, ' '));
    return root.length >= 4 && new RegExp(`\\b${root}(?:e|ed|es|ing|s)?\\b`, 'i').test(text);
  });
  const unique = [...new Set(hits)];
  if (unique.length === 1) return found(unique[0]);
  if (unique.length > 1) return ambiguous(unique);
  return missing();
}

/**
 * A date the sentence names: an ISO date, or a day named relative to today.
 *
 * Uses the same helpers the rest of the application dates things with, so a
 * calendar day means here exactly what it means everywhere else.
 */
/**
 * Every date the sentence names as a calendar date, ISO first, in order:
 * "2026-10-07", "07-10-2026", "7th October", "7th to 9th October". One reader
 * shared by both extractors, so a date written one way is not understood by
 * one capability and missed by the next.
 */
function calendarDatesIn(text, now) {
  const iso = [...text.matchAll(/\b(\d{4}-\d{1,2}-\d{1,2})\b/g)].map((m) => m[1]);
  return [...iso, ...writtenDatesIn(text, now).map((w) => w.iso)];
}

export function extractDate(message, { now = new Date() } = {}) {
  const text = String(message ?? '');
  if (unreadableDatesIn(text).length) return invalid('not a calendar date');
  const uniqueIso = [...new Set(calendarDatesIn(text, now))];
  if (uniqueIso.length > 1) return ambiguous(uniqueIso.map((d) => toIsoDate(d, now)));
  if (uniqueIso.length === 1) {
    const value = toIsoDate(uniqueIso[0], now);
    return value ? found(value) : invalid('not a calendar date');
  }

  const relative = /\b(day after tomorrow|today|tomorrow|yesterday)\b/i.exec(text)?.[1];
  if (relative) {
    const value = toIsoDate(relative.toLowerCase(), now);
    return value ? found(value) : missing();
  }
  return missing();
}

/**
 * A span of days, for a capability that takes two dates rather than one.
 *
 * Whether a capability wants a range is not something anyone declares: it takes
 * two date-kind arguments, which is the same fact. Two named dates are the
 * bounds; one named date plus a length ("for three days") is a start and a
 * span; one date alone is a single day, which is a range of one.
 */
export function extractDateRange(message, { now = new Date() } = {}) {
  const text = String(message ?? '');
  if (unreadableDatesIn(text).length) return invalid('not a calendar date');
  const iso = [...new Set(calendarDatesIn(text, now))]
    .map((d) => toIsoDate(d, now))
    .filter(Boolean)
    .sort();
  if (iso.length > 2) return ambiguous(iso);
  if (iso.length === 2) return found({ from: iso[0], to: iso[1] });

  const start = iso[0] ?? (extractDate(text, { now }).value ?? null);
  if (!start) return missing();

  const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
  const span = /\bfor\s+(\d{1,2}|one|two|three|four|five|six|seven)\s+(?:days?|din)\b/i.exec(text)?.[1];
  if (!span) return found({ from: start, to: start });

  const days = Number(span) || WORDS[String(span).toLowerCase()] || 1;
  if (!Number.isFinite(days) || days < 1) return invalid('not a number of days');
  const to = new Date(new Date(`${start}T00:00:00Z`).getTime() + (days - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return found({ from: start, to });
}

/** A month, in the form the schema asks for. */
export function extractMonth(message, { now = new Date() } = {}) {
  // The month inside a written date belongs to that day: "on 5th August 2026"
  // asks about one day, and a month argument filled from it widened the answer
  // to the whole of August.
  const text = writtenDatesIn(String(message ?? ''), now)
    .reduce((rest, w) => rest.split(w.text).join(' '), String(message ?? ''));
  const month = monthFromText(text, now);
  return month ? found(month) : missing();
}

/**
 * A sum of money, returned in paise — the unit the ERP stores.
 *
 * Written with a currency marker, before or after the figure. Thousands
 * separators are allowed because people write them; a bare number is NOT money,
 * because "record 500" could as easily be a roll number, and guessing wrong
 * here writes a payment.
 */
export function extractMoney(message) {
  const text = String(message ?? '');
  const patterns = [
    /(?:₹|rs\.?|inr)\s*(\d[\d,]*(?:\.\d{1,2})?)/i,
    /(\d[\d,]*(?:\.\d{1,2})?)\s*(?:rupees|rs\b|inr|₹)/i,
  ];
  const hits = [];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) hits.push(m[1].replace(/,/g, ''));
  }
  const unique = [...new Set(hits)];
  if (!unique.length) return missing();
  if (unique.length > 1) return ambiguous(unique);

  const rupees = Number(unique[0]);
  if (!Number.isFinite(rupees) || rupees <= 0) return invalid('not an amount');
  return found(Math.round(rupees * 100));
}

/** A percentage threshold, bounded by whatever the schema allows. */
export function extractPercentage(message, schema = {}) {
  const hits = [...new Set([...String(message ?? '').matchAll(/\b(\d{1,3})\s?%/g)].map((m) => m[1]))];
  if (!hits.length) return missing();
  if (hits.length > 1) return ambiguous(hits.map(Number));
  const value = Number(hits[0]);
  if (schema.minimum !== undefined && value < schema.minimum) return invalid('below the allowed range');
  if (schema.maximum !== undefined && value > schema.maximum) return invalid('above the allowed range');
  return found(value);
}

/**
 * A plain number for a bounded argument.
 *
 * Only when the sentence carries exactly one number that the schema would
 * accept. A sentence full of figures is ambiguous rather than first-wins: a
 * bounded argument is usually a limit or a mark, and the wrong one is a wrong
 * answer given confidently.
 */
export function extractNumber(message, schema = {}) {
  const all = [...String(message ?? '').matchAll(/\b(\d{1,6})\b/g)].map((m) => Number(m[1]));
  const withinBounds = all.filter((n) => {
    if (schema.minimum !== undefined && n < schema.minimum) return false;
    if (schema.maximum !== undefined && n > schema.maximum) return false;
    return true;
  });
  const unique = [...new Set(withinBounds)];
  if (!unique.length) return all.length ? invalid('outside the allowed range') : missing();
  if (unique.length > 1) return ambiguous(unique);
  return found(unique[0]);
}

/**
 * Text a person supplied: what a notice should say, what homework is about.
 *
 * Quotation marks are the only unambiguous signal, so they are tried first.
 * Otherwise text introduced by a colon, or after "saying"/"that", is taken —
 * and nothing else is, because any trailing words would otherwise become a
 * title. Capped to the schema's own maxLength rather than an invented one.
 */
export function extractText(message, schema = {}) {
  const text = String(message ?? '').trim();
  const cap = (value) => {
    const limit = Number(schema.maxLength) || 500;
    const trimmed = String(value).trim().replace(/[\s.?!]+$/, '');
    return trimmed ? found(trimmed.slice(0, limit)) : missing();
  };

  const quoted = /["“”']([^"“”']{2,500})["“”']/.exec(text)?.[1];
  if (quoted) return cap(quoted);

  const afterColon = /:\s*(.{2,500})$/.exec(text)?.[1];
  if (afterColon) return cap(afterColon);

  // "saying" introduces the words themselves; "about" and "on" only what they
  // concern, and often name the RECORD instead: "reply to the ticket about bus
  // timing saying we will check" is a reply that says "we will check".
  const said = /\b(?:saying|says|that reads)\s+(.{2,500})$/i.exec(text)?.[1];
  if (said) return cap(said);
  const introduced = /\b(?:about|on)\s+(.{2,500})$/i.exec(text)?.[1];
  if (introduced) return cap(introduced);

  return missing();
}

/**
 * Every extractor, by the kind it serves.
 *
 * A capability's arguments are filled by looking each one's kind up here — so
 * adding a kind is adding an entry, and no capability is named anywhere.
 */
export const EXTRACTORS = {
  identifier: (message) => extractIdentifier(message),
  enum: (message, { schema }) => extractEnum(message, schema),
  date: (message, { now }) => extractDate(message, { now }),
  dateRange: (message, { now }) => extractDateRange(message, { now }),
  month: (message, { now }) => extractMonth(message, { now }),
  money: (message) => extractMoney(message),
  percentage: (message, { schema }) => extractPercentage(message, schema),
  number: (message, { schema }) => extractNumber(message, schema),
  text: (message, { schema }) => extractText(message, schema),
};

/** Kinds with no generic extractor: a boolean flag is a phrase, not a value. */
export const UNEXTRACTABLE_KINDS = ['boolean'];

/**
 * Reads one argument out of a message, by the kind its schema implies.
 *
 * `write` tightens the result rather than the search: on a capability that
 * changes data, an ambiguous value is refused instead of being narrowed to a
 * best guess, because the cost of guessing is acting on the wrong record.
 */
export function extractArgument(name, schema, message, { now = new Date(), write = false } = {}) {
  const kind = kindOfProperty(name, schema);
  const extractor = kind ? EXTRACTORS[kind] : null;
  if (!extractor) return { status: MISSING, value: undefined, kind };

  const result = extractor(message, { schema, now });
  if (write && result.status === AMBIGUOUS) {
    return { ...result, status: AMBIGUOUS, kind, refusedForWrite: true };
  }
  return { ...result, kind };
}
