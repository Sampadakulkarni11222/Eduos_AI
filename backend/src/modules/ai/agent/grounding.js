/**
 * Grounding: is every fact in a model-written sentence in the material it was
 * given?
 *
 * The model is allowed to phrase, order and join. It is not allowed to supply
 * a figure, a name or a deed. Nothing a prompt says can guarantee that, so the
 * text that comes back is checked before anybody sees it -- the same rule the
 * generated-UI composer applies to a panel (genui/compose.js): every number in
 * it must be one of ours. A sentence that fails is not shown; the caller falls
 * back to the deterministic answer laid out from the records themselves.
 *
 * Deliberately strict and simple. It can reject a faithful paraphrase that
 * spells a figure differently, which costs a stiffer answer; it must never let
 * an invented one through, which would cost a parent a wrong fee or a teacher
 * a wrong name.
 */

/** Every finite number anywhere in a value (and each array's length, a count the reply may state). */
export function numbersIn(value, out = new Set(), depth = 0) {
  if (depth > 8) return out;
  if (typeof value === 'number' && Number.isFinite(value)) out.add(value);
  else if (Array.isArray(value)) { out.add(value.length); value.forEach((v) => numbersIn(v, out, depth + 1)); }
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => numbersIn(v, out, depth + 1));
  return out;
}

export const MONTH_AFTER = /^\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
/** Two or three capitalised words in a row: the shape of a person's name. */
export const NAME_SHAPE = /\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})(?:\s+([A-Z][a-z]{2,}))?\b/g;
/** Words that start a sentence or a heading and are not names. */
export const COMMON = new Set(['The', 'This', 'That', 'These', 'Those', 'Your', 'You', 'Our', 'Class', 'Grade', 'Section', 'Term',
  'Unit', 'Test', 'Total', 'Attendance', 'Timetable', 'Fees', 'Fee', 'Pending', 'Paid', 'Due', 'Overdue', 'Present', 'Absent',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'January', 'February', 'March', 'April', 'May',
  'June', 'July', 'August', 'September', 'October', 'November', 'December', 'Mathematics', 'Science', 'English', 'Hindi',
  'Homework', 'Assignment', 'Assignments', 'Results', 'Marks', 'Report', 'Card', 'Summary', 'Library', 'Hostel', 'Transport',
  'Route', 'Bus', 'School', 'Principal', 'Teacher', 'Student', 'Students', 'Parent', 'Parents', 'Not', 'Available', 'None',
  'Still', 'Submit', 'Here', 'There', 'Based', 'Today', 'Tomorrow', 'Yesterday', 'Week', 'Month', 'Year', 'Leave', 'Staff']);

/** Claims of having done something. Only a tool result may say a thing was done. */
export const CLAIMS_A_DEED = /\bI(?:'ve|\s+have|\s+just|\s+went\s+ahead\s+and)?\s+(?:booked|sent|scheduled|paid|approved|rejected|created|registered|cancelled|canceled|submitted|applied|marked|updated|posted|published|notified|messaged|emailed|reserved|recorded|deleted|refunded)\b|\b(?:has|have)\s+been\s+(?:booked|scheduled|reserved|registered)\s+for\s+you\b/i;

/** "ranked 3rd", "rank 2", "3rd in the class", "the topper". */
export const RANK_CLAIM = /\brank(?:ed)?\s*(?:is\s+|of\s+|#\s*)?\d+(?:st|nd|rd|th)?\b|\b\d+(?:st|nd|rd|th)\s+(?:in|of)\s+(?:the\s+|your\s+|his\s+|her\s+|my\s+)?class\b|\b(?:class\s+)?topper\b|\bfirst\s+in\s+(?:the\s+)?class\b/i;

/**
 * The facts in `text` that the sources do not contain: `[]` when grounded.
 *
 * @param {string} text           what the model wrote
 * @param {object} sources
 * @param {unknown} [sources.data]  the tool results (numbers are read from them)
 * @param {string[]} [sources.texts] text the model was given (records, notices, the deterministic answer)
 * @param {boolean} [sources.deeds] whether a deed may be reported (a tool performed one)
 * @param {boolean} [sources.strictNumbers] no small-number allowance (a notice's times and dates)
 */
export function ungroundedFacts(text, { data = null, texts = [], deeds = false, strictNumbers = false } = {}) {
  const reply = String(text ?? '');
  const sourceText = [JSON.stringify(data ?? null), ...texts.map((t) => String(t ?? ''))].join('\n');
  const sourceDigits = sourceText.replace(/(\d),(\d)/g, '$1$2');
  const sourceLower = sourceText.toLowerCase();
  const nums = numbersIn(data);
  const days = new Set();
  for (const d of sourceText.matchAll(/\d{4}-\d{2}-(\d{2})/g)) [-1, 0, 1].forEach((k) => days.add(Number(d[1]) + k));
  const problems = [];

  const flat = reply.replace(/(\d),(\d)/g, '$1$2');
  for (const m of flat.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w])/g)) {
    const raw = m[1];
    const n = Number(raw);
    // Structural small numbers ("top 5") are let through -- except where the
    // text is a notice's answer, whose every time and date matters.
    if (!strictNumbers && Number.isInteger(n) && n <= 12) continue;
    if (new RegExp(`(?<![\\d.])${raw.replace('.', '\\.')}(?![\\d])`).test(sourceDigits)) continue;
    if (nums.has(n) || nums.has(n * 100) || [...nums].some((x) => Math.round(x) === n || Math.round(x / 100) === n)) continue;
    if (days.has(n) && MONTH_AFTER.test(flat.slice(m.index + raw.length))) continue;
    problems.push(`the figure ${raw}`);
  }

  for (const m of reply.matchAll(NAME_SHAPE)) {
    const words = m.slice(1).filter(Boolean);
    if (words.some((w) => COMMON.has(w))) continue;
    if (sourceLower.includes(m[0].toLowerCase())) continue;
    // A name is invented when none of its words appears in anything given.
    if (words.every((w) => !sourceLower.includes(w.toLowerCase()))) problems.push(`the name ${m[0]}`);
  }

  if (!deeds && CLAIMS_A_DEED.test(reply)) problems.push('a claim that something was done');
  // A class rank is a small number the structural allowance above would let
  // through ("ranked 3rd"), and EduOS keeps none: only a source may state one.
  const rank = RANK_CLAIM.exec(reply);
  if (rank && !RANK_CLAIM.test(sourceText)) problems.push(`the rank "${rank[0]}"`);
  return problems;
}

/** True when nothing in `text` is outside its sources. */
export function isGrounded(text, sources) {
  return ungroundedFacts(text, sources).length === 0;
}

/* ── Provenance (p7): WHERE a figure or a name in an answer came from ──────
   The checks above answer "is it in the sources?". The verification engine
   (agent/verify.js) also needs "which source, and where in it", so every
   figure in a final answer can be stored with its provenance. Same matching
   rules as ungroundedFacts -- a paise amount said in rupees, a rounded
   percentage -- so the two never disagree about what counts as grounded. */

/** True when the stated figure `n` is the value `x` as a person would say it. */
export function sameFigure(n, x) {
  if (!Number.isFinite(n) || !Number.isFinite(x)) return false;
  return x === n || x === n * 100 || Math.round(x) === n || Math.round(x / 100) === n
    || Math.round(x * 10) / 10 === n || Math.round(x * 100) / 100 === n || Math.round(x / 10) / 10 === n;
}

/**
 * The first place in `value` holding the figure `n`, as a path ("subjects[0].averagePct",
 * "students.length"), or null.
 */
export function locateNumber(n, value, path = '', depth = 0) {
  if (depth > 8 || value == null) return null;
  if (typeof value === 'number') return sameFigure(n, value) ? (path || '(value)') : null;
  if (typeof value === 'string') {
    const digits = value.replace(/(\d),(\d)/g, '$1$2');
    return new RegExp(`(?<![\\d.])${String(n).replace('.', '\\.')}(?![\\d])`).test(digits) ? (path || '(text)') : null;
  }
  if (Array.isArray(value)) {
    if (value.length === n) return `${path}.length`;
    for (let i = 0; i < value.length; i += 1) {
      const hit = locateNumber(n, value[i], `${path}[${i}]`, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const hit = locateNumber(n, v, path ? `${path}.${k}` : k, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** The first string field in `value` that contains `needle` (case-insensitive), as a path, or null. */
export function locateText(needle, value, path = '', depth = 0) {
  if (depth > 8 || value == null) return null;
  const want = String(needle).toLowerCase();
  if (typeof value === 'string') return value.toLowerCase().includes(want) ? (path || '(text)') : null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = locateText(needle, value[i], `${path}[${i}]`, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const hit = locateText(needle, v, path ? `${path}.${k}` : k, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}
