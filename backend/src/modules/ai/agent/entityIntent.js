/**
 * Operation × entity × target, resolved from capability metadata.
 *
 * This file used to hold one hand-written branch per entity: an `if` for
 * attendance that knew get_attendance_roster took a class, an `if` for marks
 * that knew get_class_marks did, an `if` for homework. Three entities, three
 * branches — and a fourth entity would have meant a fourth branch, which is the
 * growing list of special cases the architecture audit was about.
 *
 * The branches are gone. What replaces them is a scorer over what each
 * capability ALREADY DECLARES in the MCP registry: the entity it belongs to,
 * the operation it performs, which arguments name its subject (targets) and
 * which merely narrow it (filters). The sentence is read for the same
 * dimensions — a class, a person, a subject, a month, a date, a topic — and the
 * capability whose declared shape best fits what was named wins.
 *
 * The consequence is the one the audit asked for: a capability becomes
 * reachable by declaring correct metadata, not by someone adding a branch for
 * it here. Which entities this deterministic tier claims is one list
 * (ROUTABLE_ENTITIES) rather than one code path each, and everything outside it
 * reaches the model tier, which now sees the caller's complete authorized
 * catalog rather than an arbitrary 45 of it.
 *
 * It still yields — returns null — whenever it cannot see enough to be sure, so
 * every phrasing the pattern rules already handled still reaches them.
 *
 * Nothing here authorizes anything. `capabilitiesFor(actor, …)` reads the same
 * permission-and-scope filter the MCP server applies, so this can only choose
 * among capabilities the caller already holds and can never widen one. The
 * server re-authorizes every call regardless, and the class, subject and
 * student named in the arguments are re-resolved server-side at the caller's
 * own scope.
 */

import { classFromText } from '../../../utils/classNames.js';
import { monthFromText, toIsoDate } from '../../../utils/naturalDates.js';
import { nameFromText } from '../../../utils/peopleNames.js';
import { capabilitiesFor, entitiesInText, ENTITY_VOCABULARY } from '../mcp/capabilities.js';
import { extractArgument, FOUND } from './argumentKinds.js';

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
export const GOVERNING_WRITE_VERBS =
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

/**
 * The shared vocabulary, by entity — one table for the whole architecture.
 *
 * Built on first use rather than at module load. There is a genuine import
 * cycle in this repository (agent/tools.js → announcement.service →
 * whatsapp.service → whatsapp.agent → orchestrator → intent.js → here →
 * mcp/capabilities.js), and reading an exported binding while that unwinds
 * finds it uninitialised. Every other use of capabilities.js here is already
 * inside a function body, which is why this was the only one that broke.
 */
let vocabularyByEntity = null;
const vocabulary = () => (vocabularyByEntity ??= new Map(ENTITY_VOCABULARY));

/**
 * The entities this deterministic tier claims.
 *
 * Deliberately a list rather than a set of code paths: what each resolves to
 * is decided by capability metadata below, identically for every one of them,
 * so this is the only thing that changes to claim another entity.
 *
 * It is still three, but no longer for the reason first recorded here.
 *
 * Widening this list to the whole vocabulary was measured again after generic
 * argument extraction landed (argumentKinds.js), against every natural-language
 * string in the test suite -- 2,051 messages across four roles. The result:
 * 223 MORE messages claimed by this tier, every one of them resolving to the
 * same capability with the same arguments the rules produce, ZERO
 * disagreements in either tool or arguments -- and ZERO messages routed that
 * the rules did not already route.
 *
 * So widening is safe and gains nothing, because the blocker moved. It is no
 * longer argument extraction; it is the `claimed` gate below. The rules this
 * tier cannot replace are the ones for requests that name no class, student,
 * subject, month or topic at all -- "show me the library summary", "what
 * announcements are published", "show me the finance dashboard". Those are
 * unnamed requests about an entity, and an unnamed request is genuinely
 * ambiguous between the caller's own record and the whole school: "what is my
 * attendance" and "who is absent today" name the same entity and the same
 * nothing else, and answering the second from a self-scoped capability would
 * narrow a school-wide question into a wrong answer.
 *
 * Resolving that needs a capability to declare whose record it answers about
 * -- itself or the school -- which nothing in the registry says today and
 * which is not derivable from the schema: `minScope` describes the permission
 * scope required, not the subject of the answer. Adding it would mean hand-
 * labelling 145 capabilities, which is capability-specific behaviour wearing
 * the costume of generic metadata. So the rules stay until that abstraction is
 * real. See the Phase 7B report for the earlier measurement.
 */
const ROUTABLE_ENTITIES = ['attendance', 'marks', 'homework'];

export function detectEntity(text) {
  return entitiesInText(text).find((entity) => ROUTABLE_ENTITIES.includes(entity)) ?? null;
}

/* ── Scope and the dimensions a sentence names ────────────── */

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
  // Function words. A subject is a noun; without these, "students are absent"
  // yielded the subject "are", which is the kind of value that would be sent
  // to a tool as though a person had named a subject.
  'are', 'is', 'was', 'were', 'be', 'been', 'being', 'has', 'had', 'not', 'and', 'or', 'but',
  'for', 'with', 'from', 'into', 'than', 'then', 'there', 'here', 'they', 'them', 'their',
  'these', 'those', 'many', 'much', 'more', 'most', 'few', 'less', 'how', 'why', 'when', 'where', 'who',
]);

export function subjectFromText(text, entity) {
  const str = String(text ?? '');
  const entityRe = vocabulary().get(entity);
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

/* ── Capability selection ─────────────────────────────────── */

/**
 * The operations a request of each kind can legitimately resolve to.
 *
 * A request to make something new is satisfied by a capability declared
 * CREATE or ACTION: the registry draws that line by whether a tool writes one
 * record or performs a task, which is a distinction about implementation, not
 * about what was asked for. generate_homework is an ACTION and create_assignment
 * a CREATE, and "add homework" means either.
 */
const OPERATION_FAMILY = {
  GET: ['GET'],
  CREATE: ['CREATE', 'ACTION'],
  UPDATE: ['UPDATE', 'ACTION'],
  DELETE: ['DELETE'],
};

/**
 * The argument names each dimension can be written as.
 *
 * Ordered by preference and intersected with what a capability actually
 * accepts — so the same dimension becomes `className` on one tool, `sectionId`
 * on another, and is simply not offered to a tool that takes neither. The
 * kinds themselves (class, student, subject, month, date, topic) are the ones
 * the registry classifies arguments into; see TARGET_ARGS/FILTER_ARGS.
 */
const ARG_NAMES = {
  // `query` last: a capability that takes free text accepts a class named in
  // words (search_students documents exactly that on its own property). It is
  // reached only when the capability has no class argument of its own, and
  // never for `sectionId`, which the identifier guard below excludes.
  class: ['className', 'sectionId', 'query'],
  student: ['studentName', 'studentId', 'admissionNo'],
  subject: ['subject'],
  month: ['month'],
  date: ['date', 'dueAt', 'from'],
  topic: ['topic'],
};

/**
 * Whether the request asks for a figure ABOUT a group rather than the records
 * in it.
 *
 * A dimension of the request, read like the operation verb is -- not a list of
 * questions, and not a route to any capability. It pairs with the resultShape a
 * capability declares: asking how many is structurally a different question
 * from asking which, and the catalog holds capabilities that answer each.
 */
const AGGREGATE_REQUEST = /\bhow\s+many\b|\bhow\s+much\b|\bcount\b|\bnumber\s+of\b|\btotal\b|\bsummar(y|ies)\b|\bstatistics\b|\bstats\b|\bpercentage\b/i;

/** Everything the sentence names, in the dimensions capabilities are declared in. */
function dimensionsNamed(str, entity, operation, now) {
  return {
    class: classFromText(str)?.text ?? null,
    student: nameFromText(str),
    subject: subjectFromText(str, entity),
    month: monthFromText(str, now),
    date: dateFromText(str, now),
    // A topic is what a piece of work is *about*, which only a write supplies.
    // Reading one from a question would turn "show homework on Friday" into a
    // topic of "Friday".
    topic: operation === 'GET' ? null : topicFromText(str),
    // Not an argument to any tool: a property of the request, matched against
    // what a capability says it returns.
    aggregate: AGGREGATE_REQUEST.test(str),
  };
}

/**
 * How well one capability fits what was named, and the arguments to call it with.
 *
 * Three signals, all from declared metadata:
 *
 *   a named dimension the capability accepts    + 3 when it is the SUBJECT of
 *                                                 the capability (a target),
 *                                                 + 2 when it merely narrows it
 *   a named dimension it cannot express         − 1   the sentence said
 *                                                     something this tool would
 *                                                     silently drop
 *   it is ABOUT something and nothing of that
 *   kind was named                              − 2   a per-student tool for a
 *                                                     question with no student
 *                                                     in it
 *
 * A capability is disqualified only when a required argument it still lacks is
 * an opaque IDENTIFIER. That distinction matters: a tool can reasonably ask a
 * person for a topic or a due date, and answering "which topic?" is a better
 * outcome than falling through to "I am not sure what you need" — so
 * generate_homework, whose topic and dueAt are required, is still the right
 * destination for "create Mathematics homework for Class 5-A". No tool can
 * reasonably ask for an ObjectId, so a capability needing one it could not
 * derive (get_submissions without an assignmentId) is not a candidate at all.
 */
function scoreCapability(capability, named) {
  const args = {};
  const filled = new Set();
  let score = 0;

  for (const [dimension, value] of Object.entries(named)) {
    if (!value || dimension === 'aggregate') continue;
    // Never into an identifier argument. What a sentence carries is a name —
    // "Class 5-A" — and writing that into `sectionId` would be inventing an id
    // for the server to reject. An id-shaped argument is filled only by a
    // resolver that actually looked one up, never from text.
    const argName = ARG_NAMES[dimension]?.find(
      (name) => capability.properties.includes(name) && !(capability.ids ?? []).includes(name),
    );
    if (!argName) {
      score -= 1;
      continue;
    }
    args[argName] = value;
    filled.add(dimension);
    // One named day, on a capability that takes a range rather than a date:
    // "today" is the one-day range today..today. Without this the day landed
    // in `from` alone and meant "from today onwards".
    if (dimension === 'date' && argName === 'from' && capability.properties.includes('to')) args.to = value;
    score += capability.targets.includes(dimension) ? 3 : 2;
  }

  // Judged on what was actually FILLED, not what was merely mentioned: a class
  // named in a sentence that this capability can only accept as an id has not
  // told it anything.
  if (capability.targets.length && !capability.targets.some((target) => filled.has(target))) score -= 2;

  // Answer shape. Only ever additive, and only when the request actually asks
  // for an aggregate: a capability that reports a figure about a group is the
  // right answer to how many, and the rows are the wrong one. A request that
  // asks for neither leaves this alone, so nothing is preferred by default.
  if (named.aggregate && capability.resultShape) {
    score += capability.resultShape === 'SUMMARY' ? 3 : -2;
  }

  const missing = (capability.required ?? []).filter((name) => args[name] === undefined);
  if (missing.some((name) => (capability.ids ?? []).includes(name))) return { score: 0, args };

  return { score, args };
}

/** The best-fitting capability, or null when none fits well enough to be sure. */
function chooseCapability(candidates, named) {
  // Two names for one capability: the catalog says which is canonical (see
  // capabilities.js, where it is derived from a shared service rather than
  // declared), so the older name is not a candidate while the canonical one
  // is available to this caller.
  const offered = new Set(candidates.map((c) => c.name));
  let best = null;
  for (const capability of candidates) {
    if (capability.supersededBy && offered.has(capability.supersededBy)) continue;
    const { score, args } = scoreCapability(capability, named);
    // Strictly greater, so a tie keeps catalog order — the order tools are
    // declared in, which puts the general form of a question first.
    if (score > 0 && (!best || score > best.score)) best = { capability, args, score };
  }
  return best;
}

/* ── Filling the rest of the arguments ────────────────────── */

/**
 * The message with the parts already understood taken out of it.
 *
 * A class is written "Class 5-A", and the 5 in it is part of a name rather than
 * a number anybody said. Left in, a generic integer extractor would read it as
 * a period number and answer about period 5 of a register nobody asked for. So
 * the spans the dimensions above already accounted for are removed before
 * anything else reads the sentence — which is generic: it is the same rule for
 * every dimension and every capability.
 */
function residualMessage(str, named) {
  let rest = String(str ?? '');
  for (const spoken of [named.class, named.student, named.subject]) {
    if (typeof spoken === 'string' && spoken.length) rest = rest.split(spoken).join(' ');
  }
  return rest;
}

/**
 * Fills the arguments a capability declares that the dimensions did not answer.
 *
 * Runs AFTER the capability is chosen, never before: extraction may not
 * influence which capability runs, or an argument that happened to be present
 * would start deciding the answer. Each remaining property is read by the kind
 * its own schema implies (see agent/argumentKinds.js), and only a `found`
 * result is used — `missing` leaves the tool to ask, and `ambiguous` or
 * `invalid` are never resolved by picking one, which is what keeps a write off
 * a guess.
 *
 * Dimension-derived values are never overwritten: those went through entity
 * resolution, and this is the weaker source.
 */
function fillDeclaredArguments(capability, args, message, { now, write }) {
  const properties = capability.schema?.properties ?? {};
  const filled = { ...args };

  for (const [name, propertySchema] of Object.entries(properties)) {
    if (filled[name] !== undefined) continue;
    const result = extractArgument(name, propertySchema, message, { now, write });
    if (result.status === FOUND) filled[name] = result.value;
  }
  return filled;
}

/* ── The resolver ─────────────────────────────────────────── */

/**
 * Resolves a message to one tool call, or null to leave it to the rules.
 *
 * @returns {{ tool: string, args: object } | null}
 */
export function detectEntityIntent(text, actor, now = new Date()) {
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
  const named = dimensionsNamed(str, entity, operation, now);

  // Self-referential and naming nobody else: the caller's own tools already
  // answer this, and taking it here would change answers that are correct.
  // "What Mathematics homework did I give?" is NOT this case — the caller is
  // the author there, not the subject.
  const aboutTheCaller = SELF.test(str) && !named.class && !named.student && !BY_THE_CALLER.test(str);
  if (aboutTheCaller && !(entity === 'homework' && named.subject)) return null;

  // A date alone does not say what a question is ABOUT. Who is absent today
  // names no class and no person, and answering it from a class-level
  // capability would narrow a school-wide question.
  const claimed = named.class || named.student || named.subject || named.month || named.topic;
  if (!claimed) return null;

  // Authorized capabilities only, narrowed by entity and operation before
  // anything is scored. This is the entity-first step: the candidate set comes
  // from the registry and the caller's own permissions, never from a list of
  // sentences.
  const candidates = (OPERATION_FAMILY[operation] ?? [operation])
    .flatMap((op) => capabilitiesFor(actor, { entity, operation: op }));
  const best = chooseCapability(candidates, named);
  if (!best) return null;

  // The capability is settled; only now are its remaining arguments read out of
  // what is left of the sentence. A write is filled under the stricter rule.
  const args = fillDeclaredArguments(
    best.capability,
    best.args,
    residualMessage(str, named),
    { now, write: operation !== 'GET' },
  );

  return { tool: best.capability.name, args };
}
