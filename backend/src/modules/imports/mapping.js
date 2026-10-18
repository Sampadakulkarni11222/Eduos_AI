/**
 * Reading a sheet the way a person wrote it.
 *
 * Header matching: every column of an import schema has a key, a label and
 * aliases (English synonyms, Hindi in Devanagari and in Latin script, the
 * spellings Indian schools use -- "Adm No", "S.R. No", "Std", "Div"). A header
 * is matched by its normalised form: exactly, by containment, by shared words,
 * or by edit distance for a typo ("Admision No", "Studnet Name"). Each header
 * is used once and each column once, best score first.
 *
 * Detection: each schema is scored by how much of it the headers cover
 * (required columns weigh double) less what is left unexplained, plus what the
 * person said ("these are new students", "library books"). The best wins only
 * when it is clearly ahead; otherwise the person is asked.
 *
 * Nothing here reads the database. Values are parsed (phones, dates, numbers,
 * enums) by pure functions the schemas share.
 */

/** "Admission No." / "admission_no" / "AdmissionNo" → "admissionno"; Devanagari letters are kept. */
export function normaliseHeader(text) {
  return String(text ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[।॥]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

const words = (text) => String(text ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Levenshtein distance, capped (the strings here are short). */
export function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** How well one header names one candidate spelling, 0..1. */
function similarity(header, candidate) {
  const h = normaliseHeader(header);
  const c = normaliseHeader(candidate);
  if (!h || !c) return 0;
  if (h === c) return 1;
  // "Student Name (as per records)" contains "studentname". Scored by how
  // much of the longer one the shorter covers, so a bare "class" inside
  // "class applying for" is a weak match, not a strong one.
  if (c.length >= 4 && h.includes(c)) return 0.68 + 0.27 * (c.length / h.length);
  if (h.length >= 4 && c.includes(h)) return 0.66 + 0.24 * (h.length / c.length);
  // Typos: one or two letters off, relative to length.
  const d = editDistance(h, c);
  const longest = Math.max(h.length, c.length);
  const bySpelling = longest >= 5 ? 1 - d / longest : (d === 0 ? 1 : 0);
  // Shared words ("Name of Student" ↔ "student name").
  const hw = new Set(words(header));
  const cw = words(candidate);
  const shared = cw.filter((w) => hw.has(w)).length;
  const byWords = cw.length && hw.size ? (shared / Math.max(cw.length, hw.size)) * 0.85 : 0;
  return Math.max(bySpelling >= 0.78 ? bySpelling * 0.88 : 0, byWords);
}

const MIN_MATCH = 0.62;

/**
 * Maps headers to a schema's columns.
 * Returns `{ mapping: { [columnKey]: headerIndex }, matches: [...], unmapped: [headerIndex] }`.
 */
export function mapHeaders(headers, schema) {
  const pairs = [];
  headers.forEach((header, index) => {
    for (const column of schema.columns) {
      const spellings = [column.key, column.label, ...(column.aliases ?? [])];
      let best = 0;
      for (const s of spellings) best = Math.max(best, similarity(header, s));
      if (best >= MIN_MATCH) pairs.push({ index, key: column.key, score: best });
    }
  });
  pairs.sort((a, b) => b.score - a.score);
  const mapping = {};
  const usedHeaders = new Set();
  const matches = [];
  for (const p of pairs) {
    if (usedHeaders.has(p.index) || mapping[p.key] !== undefined) continue;
    mapping[p.key] = p.index;
    usedHeaders.add(p.index);
    matches.push({ header: headers[p.index], column: p.key, score: Math.round(p.score * 100) / 100, exact: p.score === 1 });
  }
  const unmapped = headers.map((_, i) => i).filter((i) => !usedHeaders.has(i));
  return { mapping, matches, unmapped };
}

/** True when a column is satisfied: mapped, or one of its alternatives is (admission no OR name OR roll no). */
export function requiredSatisfied(schema, mapping, context = {}) {
  const missing = [];
  for (const column of schema.columns) {
    if (!column.required) continue;
    if (mapping[column.key] !== undefined) continue;
    if (column.fromContext && context[column.fromContext] !== undefined && context[column.fromContext] !== null) continue;
    if ((column.orColumns ?? []).some((k) => mapping[k] !== undefined)) continue;
    if (column.derivable && column.derivable(mapping)) continue;
    missing.push(column);
  }
  return missing;
}

/** How well a sheet's headers fit a schema, 0..1. */
export function scoreSchema(headers, schema, context = {}) {
  const { mapping, matches, unmapped } = mapHeaders(headers, schema);
  const required = schema.columns.filter((c) => c.required);
  const optional = schema.columns.filter((c) => !c.required);
  const missing = requiredSatisfied(schema, mapping, context);
  // A required value that may be SAID instead (the class, the date, the exam)
  // does not count against a sheet that lacks it: it is asked for afterwards.
  const sayable = missing.filter((c) => c.fromContext);
  const hardMissing = missing.filter((c) => !c.fromContext);
  const reqWeight = (required.length - sayable.length) * 2;
  // Each matched column counts by how well it matched: a schema whose columns
  // are only loosely echoed by the headers does not beat one they name exactly.
  const scoreOf = new Map(matches.map((m) => [m.column, m.score]));
  const reqGot = required.filter((c) => !missing.includes(c)).reduce((s, c) => s + 2 * (scoreOf.get(c.key) ?? 0.85), 0);
  const optGot = optional.reduce((s, c) => s + (scoreOf.get(c.key) ?? 0), 0);
  const quality = matches.length ? matches.reduce((s, m) => s + m.score, 0) / matches.length : 0;
  const coverage = (reqGot + optGot) / Math.max(1, reqWeight + Math.min(optional.length, 3));
  // Headers this schema cannot explain count against it (a fee sheet's
  // "Amount" and "Due date" are noise to a library-books schema).
  const noise = headers.length ? unmapped.length / headers.length : 0;
  let score = Math.min(1, coverage) * 0.75 + quality * 0.15 - noise * 0.3 + (hardMissing.length ? -0.15 * hardMissing.length : 0.1) - sayable.length * 0.02;
  if (typeof schema.headerBonus === 'function') score += schema.headerBonus(headers, mapping);
  return { score: Math.max(0, Math.min(1, Math.round(score * 1000) / 1000)), mapping, matches, unmapped, missing };
}

/** What the person's words say about the target: a bonus per schema (0..0.5). */
export function wordsBonus(text, schema) {
  const said = String(text ?? '').toLowerCase();
  if (!said.trim()) return 0;
  let bonus = 0;
  for (const re of schema.said ?? []) if (re.test(said)) bonus = Math.max(bonus, 0.5);
  return bonus;
}

/**
 * Ranks the schemas for a sheet.
 * Returns `[{ schema, score, words, total, ...mapResult }]`, best first.
 */
export function rankSchemas(headers, schemas, { text = '', context = {} } = {}) {
  return schemas
    .map((schema) => {
      const fit = scoreSchema(headers, schema, context);
      const said = wordsBonus(text, schema);
      return { schema, ...fit, words: said, total: Math.round((fit.score + said) * 1000) / 1000 };
    })
    .sort((a, b) => b.total - a.total);
}

/* ── Values ───────────────────────────────────────────────────────────── */

/** A phone as E.164: "98765 43210" / "09876543210" / "919876543210" → "+919876543210". */
export function parsePhone(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^\+[1-9]\d{7,14}$/.test(raw.replace(/[\s-]/g, ''))) return raw.replace(/[\s-]/g, '');
  const digits = raw.replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^0[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const ymd = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/**
 * A date as YYYY-MM-DD. Accepts ISO, DD/MM/YYYY and DD-MM-YY (Indian order:
 * day first), "10 June 2026", "June 10, 2026" and an Excel serial number.
 * An impossible date (31/02/2026) is null, never rolled over.
 */
export function parseDate(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return ymd(y, +m[2], +m[1]);
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})[\s,-]+(\d{2,4})$/i.exec(s);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (mon) return ymd(y, mon, +m[1]);
  }
  m = /^([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(s);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon) return ymd(+m[3], mon, +m[2]);
  }
  // An Excel serial (days since 1899-12-30) that came through as a number.
  if (/^\d{5}$/.test(s)) {
    const n = Number(s);
    if (n > 30000 && n < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
  }
  return null;
}

/** An amount in rupees: "₹8,000", "Rs. 8000.50", "8,000/-" → 8000 / 8000.5. */
export function parseAmount(value) {
  const s = String(value ?? '').replace(/₹|rs\.?|inr|\/-|,|\s/gi, '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** A whole number: "12", "12.0" → 12; anything else null. */
export function parseInteger(value) {
  const s = String(value ?? '').trim();
  if (!/^-?\d+(?:\.0+)?$/.test(s)) return null;
  return Number.parseInt(s, 10);
}

/**
 * An enum value from what a person typed, through a synonym table:
 * `{ PRESENT: ['p', 'present', 'उपस्थित'] }`. Returns the canonical value or null.
 */
export function parseEnum(value, table) {
  const v = normaliseHeader(value);
  if (!v) return null;
  for (const [canonical, spellings] of Object.entries(table)) {
    if (normaliseHeader(canonical) === v) return canonical;
    if (spellings.some((s) => normaliseHeader(s) === v)) return canonical;
  }
  // A near miss of a long spelling ("presnt", "absnt").
  for (const [canonical, spellings] of Object.entries(table)) {
    for (const s of [canonical, ...spellings]) {
      const n = normaliseHeader(s);
      if (n.length >= 5 && editDistance(n, v) <= 1) return canonical;
    }
  }
  return null;
}

/** "Class 6 A" → { grade: "Class 6", section: "A" } when a single cell names both. */
export function splitClassCell(text) {
  const s = String(text ?? '').trim();
  const m = /^(.*?\d{1,2})(?:st|nd|rd|th)?\s*[-–/ ]?\s*(?:section\s*|sec\.?\s*|div\.?\s*)?([A-Za-z])$/i.exec(s);
  if (!m) return null;
  const grade = m[1].trim();
  return { grade: /^\d/.test(grade) ? `Class ${grade}` : grade, section: m[2].toUpperCase() };
}
