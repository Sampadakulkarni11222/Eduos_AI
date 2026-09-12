/**
 * Operation × entity × scope, resolved once.
 *
 * Six manual-testing failures had one shape between them: the words that
 * decide WHAT is being asked for (attendance, marks, homework), WHAT is being
 * done to it (show, add), and WHOSE it is (a class, a named pupil, the caller)
 * were each matched by a separate pattern rule, so whichever rule happened to
 * fire first answered — and the rest of the sentence was thrown away:
 *
 *   "Show attendance for July"            → asked "Which student?"
 *   "Show marks for Class 5-A"            → one arbitrary pupil's report card
 *   "Show Mathematics homework"           → the caller's pending homework, in
 *                                            a different subject
 *   "Add Mathematics homework for 5-A: …" → a list of existing homework
 *
 * So the three dimensions are resolved together here, from vocabularies rather
 * than from sentences, and the result names a tool and its arguments with
 * nothing dropped. It deliberately covers only attendance, marks and homework:
 * announcements, the profile categories and the class tools already have their
 * own resolvers, and widening this one to them would mean two places deciding
 * the same thing.
 *
 * It yields (returns null) whenever it cannot see all of what it needs, so the
 * existing rules keep every phrasing they already handled — including every
 * self-referential one, which is why "my attendance" still reaches the caller's
 * own summary rather than a class report.
 *
 * Nothing here authorizes anything. It chooses; the MCP server permits, and
 * the class, subject and student named in the arguments are all re-resolved
 * server-side at the caller's own scope.
 */

import { classFromText } from '../../../utils/classNames.js';
import { monthFromText, toIsoDate } from '../../../utils/naturalDates.js';
import { nameFromText } from '../../../utils/peopleNames.js';

/* ── Operation ────────────────────────────────────────────── */

/**
 * Verb STEMS, so every inflection counts — "adding", "created", "assigns".
 * Whole words are what let "Add Mathematics homework" fall through to a read:
 * the create rule listed generate|create|set|assign|make and not "add".
 */
const OPERATION_VERBS = [
  ['DELETE', /\b(?:delet|remov|cancel|withdraw|clear)\w{0,4}\b/i],
  ['UPDATE', /\b(?:updat|chang|edit|modif|amend|revis|correct|reword|rewrit|reschedul)\w{0,4}\b/i],
  ['CREATE', /\b(?:add|creat|set|assign|giv|make|generat|draft|upload|post|schedul|new)\w{0,4}\b/i],
];

/**
 * Verbs that are writes but share a word with the thing being written.
 *
 * "mark" and "record" are the trap: `mark\w{0,4}` also matches the NOUN
 * "marks", so listing them with the other stems made every marks question a
 * write — "Show marks for Class 5-A" stopped routing at all. They count only
 * when they govern an object, which is what distinguishes "mark attendance"
 * from "marks".
 */
const GOVERNING_WRITE_VERBS =
  /\b(?:mark|record|enter|regulari[sz]e)\w{0,3}\s+(?:the\s+|today'?s\s+)?(?:attendance|register|marks?|scores?|homework|present|absent)\b/i;

export function detectOperation(text) {
  const str = String(text ?? '');
  // "What homework have I given Class 5-A?" is a question about work already
  // set, not an instruction to set more — the caller is the author, not the
  // actor. Without this the stem "giv" in "given" read as CREATE and a read
  // was routed to a write.
  if (BY_THE_CALLER.test(str)) return 'GET';
  if (GOVERNING_WRITE_VERBS.test(str)) return 'CREATE';
  for (const [operation, re] of OPERATION_VERBS) {
    if (re.test(str)) return operation;
  }
  return 'GET';
}

/* ── Entity ───────────────────────────────────────────────── */

const ENTITIES = [
  ['attendance', /\battendance\b|\babsent\b|\bpresent\b|\bregister\b|उपस्थिति/i],
  ['marks', /\bmarks?\b|\bresults?\b|\bgrades?\b|\bscored?\b|\bscores?\b|\breport\s*card\b|\bgpa\b|अंक|परिणाम/i],
  ['homework', /\bhomework\b|\bassignments?\b|\bworksheets?\b|गृहकार्य|होमवर्क/i],
];

export function detectEntity(text) {
  const str = String(text ?? '');
  for (const [entity, re] of ENTITIES) {
    if (re.test(str)) return entity;
  }
  return null;
}

/* ── Scope and arguments ──────────────────────────────────── */

/** The caller is asking about themselves, so their own tools keep the question. */
const SELF = /\b(my|mine|myself|me|i|i'?ve|have\s+i|did\s+i)\b/i;

/** "I gave", "I have given", "have I given" — the teacher as the author. */
const BY_THE_CALLER = /\b(?:i|i'?ve)\s+(?:gave|given|give|set|assigned|posted)\b|\b(?:have|did)\s+i\s+(?:given|give|gave|set|assigned)\b/i;

/**
 * The subject a question is about.
 *
 * A school's subjects live in its own database, so no vocabulary here could
 * list them. What IS reliable is the grammar: a subject sits immediately
 * before the entity word ("Mathematics homework", "Mathematics marks") or is
 * introduced by "in"/"for" ("marks in Mathematics"). Whatever is found is
 * passed to the tool, which matches it against the offerings the caller
 * actually teaches — so a wrong guess becomes an honest "you teach: …" rather
 * than data about the wrong subject.
 */
const NOT_A_SUBJECT = new Set([
  'my', 'the', 'a', 'an', 'this', 'that', 'all', 'any', 'some', 'todays', 'today', 'tomorrow', 'yesterday',
  'class', 'classes', 'section', 'grade', 'std', 'student', 'students', 'pending', 'new', 'latest', 'last', 'recent',
  'show', 'list', 'give', 'given', 'add', 'create', 'assign', 'set', 'what', 'which', 'whose', 'have', 'did', 'do', 'does',
]);

export function subjectFromText(text, entity) {
  const str = String(text ?? '');
  const entityRe = ENTITIES.find(([name]) => name === entity)?.[1];
  if (!entityRe) return null;

  const word = '[\\p{L}][\\p{L}&\'.-]*';
  const ok = (candidate) => {
    const value = String(candidate ?? '').trim();
    if (!value || value.length < 3) return null;
    if (NOT_A_SUBJECT.has(value.toLowerCase())) return null;
    if (monthFromText(value)) return null;
    if (classFromText(value)) return null;
    // A possessive is somebody's name, not a subject: "Aarav Mishra's marks"
    // was yielding the subject "Mishra's".
    if (/['’]s$/.test(value)) return null;
    return value;
  };

  // "Mathematics homework", "Mathematics marks"
  const entitySource = entityRe.source.replace(/\\b/g, '');
  const before = new RegExp(`(${word})\\s+(?:${entitySource})`, 'iu').exec(str);
  if (before) {
    const found = ok(before[1]);
    if (found) return found;
  }

  // "marks in Mathematics", "homework for Mathematics"
  const after = new RegExp(`(?:${entitySource})\\s+(?:in|for|of)\\s+(${word})`, 'iu').exec(str);
  if (after) {
    const found = ok(after[1]);
    if (found) return found;
  }
  return null;
}

/** A single day named in the message: today, yesterday, a weekday, an ISO date. */
export function dateFromText(text, now = new Date()) {
  const str = String(text ?? '');
  const iso = /\b(\d{4}-\d{1,2}-\d{1,2})\b/.exec(str)?.[1];
  if (iso) return toIsoDate(iso, now);

  const relative = /\b(today|tomorrow|yesterday|day after tomorrow)\b/i.exec(str)?.[1];
  if (relative) return toIsoDate(relative.toLowerCase(), now);

  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const named = new RegExp(`\\b(${DAYS.join('|')})\\b`, 'i').exec(str)?.[1];
  if (named) {
    // The most recent one that has happened — a register is about a day that exists.
    const target = DAYS.indexOf(named.toLowerCase());
    const back = (now.getDay() - target + 7) % 7 || 7;
    const d = new Date(now.getTime() - back * 86_400_000);
    return toIsoDate(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`, now);
  }
  return null;
}

/* ── The routing table ────────────────────────────────────── */

/**
 * Resolves a message to one tool call, or null to leave it to the rules.
 *
 * @returns {{ tool: string, args: object } | null}
 */
export function detectEntityIntent(text, _actor, now = new Date()) {
  const str = String(text ?? '');
  if (!str.trim()) return null;

  const entity = detectEntity(str);
  if (!entity) {
    // A message that is nothing but a person's name is a lookup. It carries no
    // verb and no entity, so nothing else claims it and it used to fall
    // through to "I'm not sure what you need" — which is a poor answer to a
    // name typed after being shown a list. The student search is a read, and
    // it presents candidates rather than choosing one, so a misspelling is
    // answered with "did you mean" instead of somebody's record.
    const onlyAName = nameFromText(str);
    if (onlyAName && onlyAName.toLowerCase() === str.trim().toLowerCase().replace(/[.?!]+$/, '')) {
      return { tool: 'search_students', args: { query: onlyAName } };
    }
    return null;
  }

  const operation = detectOperation(str);
  const className = classFromText(str)?.text ?? null;
  const student = nameFromText(str);
  const month = monthFromText(str, now);
  const date = dateFromText(str, now);
  const subject = subjectFromText(str, entity);

  // Self-referential and naming nobody else: the caller's own tools already
  // answer this, and taking it here would change answers that are correct.
  // "What Mathematics homework did I give?" is NOT this case — the caller is
  // the author there, not the subject.
  const aboutTheCaller = SELF.test(str) && !className && !student && !BY_THE_CALLER.test(str);
  if (aboutTheCaller && !(entity === 'homework' && subject)) return null;

  if (entity === 'attendance') {
    // Marking a register is a write with its own rules and restrictions.
    if (operation !== 'GET') return null;
    if (student) {
      return { tool: 'get_student_attendance', args: { studentName: student, ...(month && { month }), ...(date && { date }) } };
    }
    if (className) {
      // A named class stays a class question. Routing "July attendance for
      // Class 5-A" to the school/own-scope summary silently dropped the class
      // and answered something broader than was asked -- the register is the
      // class-level capability, so the class goes to it and the month travels
      // along rather than being discarded.
      return { tool: 'get_attendance_roster', args: { className, ...(date && { date }), ...(month && { month }) } };
    }
    if (month) return { tool: 'get_attendance_statistics', args: { month } };
    return null;
  }

  if (entity === 'marks') {
    if (operation !== 'GET') return null;
    if (student) return { tool: 'get_report_card', args: { studentName: student } };
    if (className) {
      return { tool: 'get_class_marks', args: { className, ...(subject && { subject }) } };
    }
    return null;
  }

  if (entity === 'homework') {
    if (operation === 'CREATE') {
      return {
        tool: 'generate_homework',
        args: {
          ...(subject && { subject }),
          ...(className && { className }),
          ...(topicFromText(str) && { topic: topicFromText(str) }),
          ...(date && { dueAt: date }),
        },
      };
    }
    if (operation !== 'GET') return null;
    if (subject || className) {
      return { tool: 'get_assignments', args: { ...(subject && { subject }), ...(className && { className }) } };
    }
    return null;
  }

  return null;
}

/**
 * What a piece of homework is about.
 *
 * Taken from after a colon ("… for Class 5-A: Solve the linear equations"),
 * from quotes, or from "on"/"about" — the three ways people actually write it.
 * Nothing is invented: with no topic the tool asks, which is the honest
 * outcome for "create Mathematics homework for Class 5-A".
 */
export function topicFromText(text) {
  const str = String(text ?? '');
  const afterColon = /:\s*(.{3,300})$/.exec(str)?.[1];
  if (afterColon) return afterColon.trim().replace(/[.]+$/, '');
  const quoted = /["“”']([^"“”']{3,300})["“”']/.exec(str)?.[1];
  if (quoted) return quoted.trim();
  const introduced = /\b(?:on|about)\s+(.{3,300})$/i.exec(str)?.[1];
  if (introduced) return introduced.trim().replace(/[.?!]+$/, '');
  return null;
}
