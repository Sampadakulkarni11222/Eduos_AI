import { parseIntent, routingText } from './intent.js';
import { dimensionsOf } from './capabilityResolver.js';
import { classFromText } from '../../../utils/classNames.js';
import { getMcpTool } from '../mcp/registry.js';
import { callTool as callMcpTool } from '../mcp/client.js';
import { entitiesFor, entitiesInTextByPosition } from '../mcp/capabilities.js';
import { presentOf } from './present.js';
import { composeAnswer, answerIsModelWritten } from './response.js';
import { evidenceFor } from './evidence.js';
import { studentsIn } from './memory.js';
import { t } from '../../../utils/language.js';
import { logger } from '../../../utils/logger.js';
import { classFollowUp } from './p7FollowUps.js';
import { crossChildViolation } from './verify.js';
import { Enrollment } from '../../../models/student.model.js';
import { getGuardianStudentIds } from '../../../utils/scope.js';

/**
 * Multi-operation prompts (p7): one message, several asks, every part answered.
 *
 *   "Rahul's score, his performance, assignment updates and who is the class teacher"
 *   "attendance of 6A today, who's absent, and send their parents a message"
 *   "rahul ki attendance aur fees"
 *
 * The AGENT layer of the owner's architecture -- intent detection, PLANNING,
 * tool selection, response generation -- for a message that asks more than
 * one thing:
 *
 *   1. SPLIT into asks at the joins people use: lists and new lines, question
 *      marks, ";", commas, "and", "and also", "as well as", "along with",
 *      "plus", "also", Hinglish "aur". A piece that is not a request on its own
 *      ("mark Rahul | and Aman absent", "name | and class of Rahul") is joined
 *      back to the one before, so a conjunction inside one request is never
 *      split; a write that takes the person's own words swallows the rest.
 *   2. MAKE EACH WHOLE: the person ("his" -> Rahul), the class, the day and
 *      "my child" said once are lent to the asks that lack them.
 *   3. PLAN each ask with the same rule readers a single question uses
 *      (intent.parseIntent), so a part routes exactly as it would alone.
 *   4. RUN: independent reads in parallel through the MCP server (authorized,
 *      scoped and audited per call, as always); then the writes, which may
 *      depend on what the reads found ("their parents" = the absent pupils).
 *      Writes are DRAFTS: the first is proposed for confirmation now (only one
 *      proposal stands per person -- mcp/confirm.js), the rest are queued and
 *      proposed one at a time ("next").
 *   5. ANSWER in sections, one heading per ask, in the order asked. A part
 *      that failed, was not permitted or was not understood says so, and why,
 *      under its own heading; the other parts are answered regardless.
 *
 * Every figure in the sections is the tool's own sentence (agent/present.js);
 * the answer-validation layer (agent/verify.js) then checks the whole reply.
 */

export const MAX_ASKS = 6;
/** The most drafts one message may queue (each still confirmed on its own). */
const MAX_DRAFTS = 10;

/** Strong breaks: new lines (with list markers), ";" and a "?" with more after it. */
const STRONG_BREAK = /\s*(?:\r?\n+|;|\?(?=\s*\S))\s*/;
/** A list marker at the start of a line: "-", "*", "•", "1.", "2)". */
const LIST_MARKER = /^\s*(?:[-*•]|\d{1,2}[.)])\s+/;
/** Weak breaks inside a sentence. */
const WEAK_BREAK = /\s*,\s*(?:and\s+(?:also\s+|then\s+)?|aur\s+|also\s+|plus\s+)?|\s+(?:and\s+also|and\s+then|as\s+well\s+as|along\s+with|and|also|plus|aur|&)\s+/i;
/** A piece that carries its own request: a question word or an opening verb. */
const OWN_LEAD = /^\s*(?:please\s+)?(?:what|which|who|whom|whose|who's|whos|when|where|why|how|is|are|do|does|did|can|could|show|list|display|view|find|get|give|tell|fetch|check|search|send|message|mark|create|add|post|notify|inform|remind|book|apply|record|dikhao|batao|kaun|kya|kitni|kitna)\b/i;
/** The opening a bare piece borrows from the first one. */
const LEAD_PHRASE = /^\s*((?:please\s+)?(?:show(?:\s+me)?|list|display|view|find|get|give\s+me|tell\s+me|fetch|check|how\s+many|how\s+much|what\s+(?:is|are|was|were)|who\s+(?:is|are|was|were)))\b/i;
/** "Send their parents a message", "message the parents", "inform their families". */
const PARENTS_MESSAGE = /\b(?:message|text|sms|inform|notify|tell|write\s+to|send)\b[^.?!]*?\b(?:their|the|his|her|those|these|all)\s+(?:parents?|guardians?|famil(?:y|ies))\b|\b(?:parents?|guardians?)\s+ko\s+(?:message|bata|bhej)/i;
const WORDS_AFTER = /\b(?:saying|that\s+says|with\s+the\s+message|:)\s*["“]?(.+?)["”]?\s*$/i;
const WRITE_LEAD = /^\s*(?:please\s+)?(?:send|message|mark|create|add|post|notify|inform|remind|book|apply|record|update|change|delete|remove|cancel|issue|return|allocate|assign|schedule|text|write)\b/i;
/** An ask about classes in general, or the school: never narrowed to the class another ask names. */
const CROSS_CLASS = /\b(?:which\s+class(?:es)?|classes|class[\s-]wise|school|whole\s+school|every\s+class|all\s+classes)\b/i;
const QUESTION_WORD = /^\s*(?:how|which|who|whom|whose|what|when|where|why)\b/i;
/** A clause that frames the question after it ("according to the policy", "as per the circular"). */
const FRAMING = /^\s*(?:according\s+to|as\s+per|per|based\s+on|going\s+by|in\s+line\s+with|in\s+keeping\s+with|in\s+terms\s+of|under)\b/i;
const FREE_TEXT_ARGS = ['title', 'body', 'message', 'description', 'subject', 'reason', 'content', 'text', 'note', 'notes', 'remarks', 'topic'];

const isWrite = (tool) => getMcpTool(tool)?.operation !== 'GET';
const takesFreeText = (tool) => FREE_TEXT_ARGS.some((k) => k in (getMcpTool(tool)?.inputSchema?.properties ?? {}));
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Quoted text is the person's own words and is never split. */
function shield(message) {
  const quotes = [];
  const text = String(message ?? '').replace(/["“][^"”]*["”]/g, (q) => { quotes.push(q); return `\u0000${quotes.length - 1}\u0000`; });
  return { text, restore: (s) => String(s).replace(/\u0000(\d+)\u0000/g, (_, i) => quotes[Number(i)]) };
}

/** The pieces of a message, before any is judged: `[{ text, joiner }]`. */
export function splitAsks(message) {
  const { text, restore } = shield(message);
  const out = [];
  for (const segment of text.split(STRONG_BREAK)) {
    const clean = segment.replace(LIST_MARKER, '').replace(/[?.!]+\s*$/, '').trim();
    if (!clean) continue;
    const parts = clean.split(WEAK_BREAK).map((p) => p?.trim()).filter(Boolean);
    // "According to the attendance policy, which students are below 75%?": a framing
    // clause is not an ask of its own -- it stays with the question it frames.
    for (let i = parts.length - 2; i >= 0; i -= 1) {
      if (FRAMING.test(parts[i]) && !OWN_LEAD.test(parts[i])) parts.splice(i, 2, `${parts[i]}, ${parts[i + 1]}`);
    }
    parts.forEach((p, i) => out.push({ text: restore(p.replace(LIST_MARKER, '')), joiner: i === 0 ? '; ' : ' and ' }));
  }
  return out;
}

/** What the whole message says once and means for every ask. */
function sharedSubject(message, pieces = []) {
  const english = routingText(message);
  // The person an INSTRUCTION names is that instruction's own and is not lent
  // to the questions beside it ("show my attendance and mark Aman absent").
  const asked = pieces.length ? pieces.filter((p) => !WRITE_LEAD.test(routingText(p.text)) && !PARENTS_MESSAGE.test(p.text)).map((p) => routingText(p.text)).join(' and ') : english;
  const whole = dimensionsOf(asked || english);
  const spokenClass = classFromText(english, { lenient: true })?.gradeOnly ? null : (classFromText(english)?.text ?? null);
  return {
    person: whole.student ?? null,
    spokenClass,
    // Which piece names the class: it is lent forward to the asks after it,
    // and back only to a bare ask before it ("Show attendance and marks for Class 5 A").
    classPiece: spokenClass ? pieces.findIndex((p) => classFromText(routingText(p.text))) : -1,
    day: /\b(today|yesterday|tomorrow)\b/i.exec(english)?.[1] ?? null,
    kin: /\bmy\s+(?:child|son|daughter|kid|ward)\b/i.exec(english)?.[0] ?? null,
  };
}

/** One ask, made whole with what the message said once. */
function wholeAsk(piece, index, shared, lead) {
  let text = routingText(piece);
  const own = OWN_LEAD.test(text) || (index === 0 && !lead);
  if (!own && lead) text = `${lead} ${text}`;
  const has = (phrase) => text.toLowerCase().includes(String(phrase).toLowerCase());
  // "Diya Sharma score": the person said without "'s" before what is asked about.
  if (shared.person) {
    const esc = shared.person.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`\\b(${esc})\\s+(?=(?:score|scores|marks|results?|performance|attendance|homework|assignments?|fees?|report\\s+card|class\\s+teacher|timetable|grades?)\\b)`, 'i'), "$1's ");
  }
  // A piece that names its own person ("Riya's fees and Rahul's attendance") keeps that person.
  const ownPerson = dimensionsOf(text).student;
  const selfAsk = /\b(?:my|me|mine|i)\b/i.test(text) && !/\bmy\s+(?:child|son|daughter|kid|ward)\b/i.test(text);
  if (shared.person && !ownPerson && !selfAsk && !WRITE_LEAD.test(text) && !has(shared.person) && !has(shared.person.split(' ')[0])) {
    if (/\b(?:his|her|their)\b/i.test(text)) text = text.replace(/\b(?:his|her|their)\b/i, `${shared.person}'s`);
    else if (/\bthe\s+(?=class\s+teacher\b|teacher\b|fees?\b|marks?\b|results?\b|attendance\b|homework\b|assignments?\b|performance\b|score\b)/i.test(text)) {
      text = text.replace(/\bthe\s+(?=class\s+teacher\b|teacher\b|fees?\b|marks?\b|results?\b|attendance\b|homework\b|assignments?\b|performance\b|score\b)/i, `${shared.person}'s `);
    } else if (LEAD_PHRASE.test(text)) text = text.replace(LEAD_PHRASE, (m) => `${m} ${shared.person}'s`);
    else if (OWN_LEAD.test(text)) text = `${text} for ${shared.person}`;
    else text = `${shared.person}'s ${text}`;
  } else if (!shared.person && shared.kin && !/\bmy\b/i.test(text)) {
    text = /\b(?:his|her|their)\b/i.test(text) ? text.replace(/\b(?:his|her|their)\b/i, `${shared.kin}'s`) : `${shared.kin}'s ${text}`;
  }
  // A named student is in their own class: never lent another one.
  if (shared.spokenClass && !ownPerson && !classFromText(text) && !CROSS_CLASS.test(text)) {
    const forward = shared.classPiece >= 0 && index > shared.classPiece;
    const backToBare = shared.classPiece >= 0 && index < shared.classPiece && !QUESTION_WORD.test(routingText(piece));
    if (forward || backToBare) text = `${text} in ${shared.spokenClass}`;
  }
  if (shared.day && !/\b(?:today|yesterday|tomorrow|\d{4}-\d{2}-\d{2})\b/i.test(text) && /\b(?:attendance|absent|present|who)\b/i.test(text)) text = `${text} ${shared.day}`;
  return text.replace(/\s+/g, ' ').trim();
}

/** How one ask would be carried out: a read, a write, a message to parents, or nothing understood. */
function readAsk(piece, index, shared, lead, actor) {
  const whole = wholeAsk(piece, index, shared, lead);
  if (PARENTS_MESSAGE.test(piece)) {
    const words = WORDS_AFTER.exec(piece)?.[1]?.trim() ?? null;
    return { kind: 'parents', text: whole, words };
  }
  // A question the school's policy answers (another child's marks, for a family).
  const policy = classFollowUp(whole, { actor });
  if (policy?.reply) return { kind: 'note', text: whole, note: policy.reply };
  const step = parseIntent(whole, actor);
  if (!step || step.steps || step.clarify) return { kind: 'none', text: whole };
  const person = step.args?.studentName ?? step.args?.admissionNo ?? dimensionsOf(whole).student ?? null;
  return { kind: isWrite(step.tool) ? 'write' : 'read', text: whole, step: { tool: step.tool, args: step.args ?? {} }, person };
}

/**
 * The asks of a message, or null when it asks one thing (or cannot be read
 * as several). `[{ ask, heading, kind, step?, words? }]`.
 */
export function planAsks(rawMessage, actor) {
  // A Hinglish READ is translated whole before it is split ("rahul ki
  // attendance aur fees" -> "rahul's attendance and fees"): one "ki" alone is
  // too little for the translator to act on, so pieces are not translated one
  // by one. A message with a write or free text is split as typed.
  const english = routingText(rawMessage);
  const message = english !== String(rawMessage ?? '') ? english : rawMessage;
  const pieces = splitAsks(message);
  if (pieces.length < 2) return null;
  const shared = sharedSubject(message, pieces);
  const lead = LEAD_PHRASE.exec(routingText(pieces[0].text))?.[1] ?? 'Show';

  const asks = [];
  for (const piece of pieces) {
    const prev = asks.at(-1);
    // A write that takes the person's own words keeps everything after it.
    if (prev && (prev.kind === 'parents' || (prev.kind === 'write' && takesFreeText(prev.step.tool)))) {
      prev.ask = `${prev.ask}${piece.joiner}${piece.text}`;
      Object.assign(prev, readAsk(prev.ask, asks.length - 1, shared, lead, actor), { ask: prev.ask });
      continue;
    }
    // "... for Class 5 A and also Class 6 A": a piece that is only a class is
    // the ask before it, for that class.
    const onlyClass = classFromText(routingText(piece.text));
    if (prev?.text && onlyClass && !routingText(piece.text).replace(onlyClass.text, '').replace(/\b(?:for|of|in|class|also|too|the)\b/gi, '').trim()) {
      const prevClass = classFromText(prev.text);
      if (prevClass) {
        const ask = { ...readAsk(prev.text.replace(prevClass.text, onlyClass.text), asks.length, { ...shared, spokenClass: null }, lead, actor), ask: piece.text };
        if (ask.kind !== 'none') { asks.push(ask); continue; }
      }
    }
    const read = readAsk(piece.text, asks.length, shared, lead, actor);
    const standsAlone = read.kind !== 'none' && (!prev || OWN_LEAD.test(routingText(piece.text)) || prev.kind === 'read' || read.kind === 'read');
    // Not a request on its own, or the tail of a write ("mark Rahul | and Aman
    // absent"): joined back to the ask before it.
    if (prev && (!standsAlone || (prev.kind === 'write' && !OWN_LEAD.test(routingText(piece.text))))) {
      const joined = `${prev.ask}${piece.joiner}${piece.text}`;
      const again = readAsk(joined, asks.length - 1, shared, lead, actor);
      if (again.kind !== 'none' || prev.kind === 'none') { Object.assign(prev, again, { ask: joined }); continue; }
    }
    asks.push({ ...read, ask: piece.text });
    if (asks.length > MAX_ASKS) return null;
  }
  // A leave application is shaped by the orchestrator's own staff-leave reader
  // (the kind of leave, the day, the reason): such a message is left to it.
  if (asks.some((a) => /^apply_(?:for_|staff_)leave$/.test(a.step?.tool ?? ''))) return null;
  const understood = asks.filter((a) => a.kind !== 'none');
  if (asks.length < 2 || understood.length < 2) return null;
  // Two asks that are the same request ("attendance of 6A" + "who's absent" both
  // read the 6A register) are still two sections; they share one call.
  return asks.map((a) => ({ ...a, heading: cap(String(a.ask).replace(/^\s*(?:and|also|plus|aur)\s+/i, '').trim()).slice(0, 80) }));
}

/** Topics for "your account doesn't have access to ..." (as orchestrator DENIED_TOPICS). */
const TOPICS = {
  attendance: 'attendance records', marks: 'marks and results', homework: 'homework and assignments', fee: 'fee information',
  library: 'the library', hostel: 'the hostel', transport: 'transport', medical: 'medical records', leave: 'leave applications',
  timetable: 'the timetable', announcement: 'announcements', calendar: 'the school calendar', ticket: 'support tickets',
};
const roleLabel = (actor) => { const k = String(actor?.roleKey ?? '').toLowerCase().replace(/_/g, ' '); return k ? cap(k) : 'current'; };

/** Why an ask could not be planned, in a sentence. */
function whyNot(ask, actor, { calledAndRefused = false } = {}) {
  const held = new Set(entitiesFor(actor));
  // "Mark Aman absent" is about attendance, not marks: the opening verb is not the topic.
  const about = entitiesInTextByPosition(routingText(ask).replace(WRITE_LEAD, ' ')).find((e) => TOPICS[e]);
  if (about && (!held.has(about) || calledAndRefused)) {
    return { topic: TOPICS[about], text: `Not included: ${TOPICS[about]} — your ${roleLabel(actor)} account doesn't have access to that.` };
  }
  if (calledAndRefused) return { text: `Not done: your ${roleLabel(actor)} account is not authorized to do this.` };
  return { text: 'Not answered: I couldn\'t tell what this part asks for — please ask it on its own.' };
}

/** A refused or failed call, said for a person. */
const GENERIC_REFUSAL = /^(?:You do not have permission|You are not authori[sz]ed to (?:access|do)|Missing permission|Forbidden)/i;

function failureOf(result, actor, ask, { write = false } = {}) {
  const err = result?.error ?? {};
  // The generic permission refusal is said as WHICH topic this account lacks;
  // a refusal a tool or the server wrote for a person ("Class 10 B is not one
  // of your classes", "confirm it on the EduOS website") is shown as it is.
  if (GENERIC_REFUSAL.test(err.message ?? '') || (err.code === 'FORBIDDEN' && !err.message)) {
    const why = whyNot(ask, actor, { calledAndRefused: true });
    if (why.topic && !new Set(entitiesFor(actor)).has(Object.keys(TOPICS).find((k) => TOPICS[k] === why.topic))) return why;
    return { text: `Not done: ${err.message || `your ${roleLabel(actor)} account is not authorized to do this.`}` };
  }
  if (Array.isArray(err.details?.errors) && err.details.errors.length) return { text: 'Not answered: I need a bit more detail for this part — please ask it on its own with the missing detail.' };
  return { text: `${write ? 'Not done' : 'Not answered'}: ${err.message || 'it could not be completed.'}` };
}

/** "Absent: Rahul Sharma." for an ask that asked who is absent, from the register's own data. */
function sectionText(entry, result, lang) {
  const data = result?.data;
  if (/\b(?:who(?:'s|\s+is|\s+are|\s+was|\s+were)?\s+absent|absentees|kaun\s+absent)\b/i.test(entry.ask) && data && Array.isArray(data.absent)) {
    const where = [data.class, data.date ? `on ${data.date}` : null].filter(Boolean).join(' ');
    return data.absent.length
      ? `Absent${where ? ` — ${where}` : ''}: ${data.absent.join(', ')}.`
      : `Nobody is marked absent${where ? ` — ${where}` : ''}.`;
  }
  return presentOf(result, lang)?.trim() || 'Done.';
}

/** The default note to a parent about an absence, from the register's own data (a draft the teacher confirms or edits). */
function absenceNote(name, data) {
  const when = data?.date ? ` on ${data.date}` : ' today';
  return `${name} was marked absent${when}${data?.class ? ` (${data.class})` : ''}. Please let us know if everything is all right.`;
}

/**
 * Runs a planned multi-ask turn and composes the sectioned answer.
 *
 * @returns the same shape runMcpPlan returns (reply, data, tools, plan, evidence,
 *   action when a draft awaits confirmation), plus `multiAsk` and `queuedWrites`.
 */
/** A parent's children with their classes, at the parent's own link (StudentGuardian), or []. */
export async function familyOf(actor) {
  if (actor?.roleKey !== 'PARENT' || !actor?.profileId) return [];
  const ids = await getGuardianStudentIds(actor.profileId);
  if (!ids.length) return [];
  const rows = await Enrollment.find({ studentId: { $in: ids }, status: 'ACTIVE' })
    .populate('studentId', 'firstName lastName').populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } }).lean();
  return rows.map((e) => ({
    name: `${e.studentId?.firstName ?? ''} ${e.studentId?.lastName ?? ''}`.trim(),
    class: `${e.sectionId?.gradeId?.name ?? ''} ${e.sectionId?.name ?? ''}`.trim(),
  }));
}

/** The child of `family` a person's words name: the full name, or a word only one child's name has. */
export function childNamedIn(text, family) {
  const said = ` ${String(text ?? '').toLowerCase().replace(/[^\p{L}\s]/gu, ' ')} `;
  const full = family.filter((c) => said.includes(` ${c.name.toLowerCase()} `));
  if (full.length === 1) return full[0];
  const byWord = family.filter((c) => c.name.toLowerCase().split(/\s+/).some((w) => w.length > 2 && said.includes(` ${w} `)
    && family.filter((o) => o.name.toLowerCase().split(/\s+/).includes(w)).length === 1));
  return byWord.length === 1 ? byWord[0] : null;
}

/** A part about ONE child: a per-student capability, or words about a child's records. */
const PER_CHILD = /(?:class\s+teacher|performance|marks|scores?|results?|report\s+card|attendance|homework|assignments?|timetable|grades?|absent|progress)/i;
const perChild = (a) => Boolean(a.step && ['studentName', 'admissionNo', 'studentId'].some((k) => k in (getMcpTool(a.step.tool)?.inputSchema?.properties ?? {})))
  || PER_CHILD.test(a.ask);

export async function runMultiAsk({ mcpSession, asks, actor, source, lang, message = '' }) {
  // A parent of several children who names none: one question for the whole
  // message ("Which child?"), never a different question -- or a different
  // child -- per part. The answer resumes the message (orchestrator).
  const family = await familyOf(actor);
  // A first name two of the children share ("Diya"): asked once, for the whole message.
  const firstOf = (n) => String(n ?? '').toLowerCase().trim().split(/\s+/)[0];
  const shared = family.length > 1 ? asks.find((a) => a.person && !childNamedIn(a.person, family)
    && String(a.person).trim().split(/\s+/).length === 1 && family.filter((c) => firstOf(c.name) === firstOf(a.person)).length > 1) : null;
  if (shared) {
    const names = family.filter((c) => firstOf(c.name) === firstOf(shared.person)).map((c) => c.name);
    return {
      reply: `Which ${shared.person} do you mean — ${names.slice(0, -1).join(', ')} or ${names.at(-1)}? Tell me and I'll answer all ${asks.length} parts for them.`,
      lang, action: null, clarification: true, needsInput: true,
      pendingMultiAsk: { message: String(message).slice(0, 600), term: shared.person },
    };
  }
  if (family.length > 1 && asks.some(perChild) && !asks.some((a) => a.person) && !childNamedIn(message, family)) {
    const names = family.map((c) => c.name);
    return {
      reply: `Which child do you mean — ${names.slice(0, -1).join(', ')} or ${names.at(-1)}? Tell me and I'll answer all ${asks.length} parts for them.`,
      lang, action: null, clarification: true, needsInput: true,
      pendingMultiAsk: { message: String(message).slice(0, 600) },
      multiAsk: { parts: asks.map((a) => ({ ask: a.heading, kind: a.kind })) },
    };
  }
  // Reads first, in parallel, one call per distinct request.
  const key = (s) => `${s.tool}:${JSON.stringify(s.args ?? {})}`;
  const reads = new Map();
  for (const a of asks) if (a.kind === 'read' && !reads.has(key(a.step))) reads.set(key(a.step), a.step);
  const readResults = new Map();
  await Promise.all([...reads.entries()].map(async ([k, step]) => {
    try {
      readResults.set(k, await callMcpTool(mcpSession, step.tool, step.args ?? {}));
    } catch (err) {
      logger.warn(`Multi-ask read ${step.tool} failed: ${err.message}`);
      readResults.set(k, { success: false, error: { message: 'That lookup is not available right now.' } });
    }
  }));
  const calls = [...reads.entries()].map(([k, step]) => ({ tool: step.tool, args: step.args ?? {}, result: readResults.get(k) }));

  // p7 (answer validation): a part about one named child must hold that
  // child's records only -- never a sibling's name or a sibling's class's rows.
  const rejected = new Map();
  if (family.length > 1) {
    for (const [i, a] of asks.entries()) {
      if (a.kind !== 'read' || !a.person) continue;
      const child = childNamedIn(a.person, family);
      const result = readResults.get(key(a.step));
      if (!child || !result?.success) continue;
      const problem = crossChildViolation({ data: result.data, child, siblings: family.filter((c) => c !== child) });
      if (problem) rejected.set(i, problem);
    }
  }

  // What the reads found that a write may point back to ("their parents").
  const absentData = calls.map((c) => c.result?.data).find((d) => d && Array.isArray(d.absent));
  const people = absentData ? absentData.absent : studentsIn(calls.filter((c) => c.result?.success).map((c) => c.result.data));

  // Writes, in the order asked: each becomes one or more drafts.
  const drafts = [];
  const writeNotes = new Map();
  for (const [i, a] of asks.entries()) {
    if (a.kind === 'write') drafts.push({ index: i, step: a.step });
    if (a.kind === 'parents') {
      if (!people.length) {
        writeNotes.set(i, absentData ? 'Nobody is marked absent, so there is no one to message.' : "Whose parents should I write to? Tell me the student's name.");
        continue;
      }
      if (!a.words && !absentData) {
        writeNotes.set(i, `What should the message to the parents of ${people.slice(0, 8).join(', ')} say?`);
        continue;
      }
      for (const name of people.slice(0, MAX_DRAFTS)) {
        drafts.push({ index: i, step: { tool: 'send_conversation_message', args: { studentName: name, message: a.words ?? absenceNote(name, absentData) } } });
      }
    }
  }

  let action = null;
  let draftResult = null;
  const queued = [];
  for (const d of drafts) {
    if (action) { queued.push({ ...d.step, label: asks[d.index].heading }); continue; }
    // eslint-disable-next-line no-await-in-loop -- one proposal at a time
    const result = await callMcpTool(mcpSession, d.step.tool, d.step.args ?? {});
    calls.push({ tool: d.step.tool, args: d.step.args ?? {}, result });
    if (result?.action?.status === 'confirmation_required') {
      action = { ...result.action, tool: d.step.tool };
      draftResult = { index: d.index, result };
    } else {
      writeNotes.set(d.index, `${writeNotes.get(d.index) ? `${writeNotes.get(d.index)} ` : ''}${result?.success ? (presentOf(result, lang) || 'Done.') : failureOf(result, actor, asks[d.index].ask, { write: true }).text}`);
    }
  }

  // The sections, in the order asked.
  const failed = [];
  const sections = asks.map((a, i) => {
    let body;
    if (a.kind === 'none') { const why = whyNot(a.ask, actor); body = `_${why.text}_`; failed.push({ index: i, ask: a.heading, reason: why.text, topic: why.topic }); }
    else if (a.kind === 'note') { body = a.note; failed.push({ index: i, ask: a.heading, reason: 'not shown to your account by school policy' }); }
    else if (a.kind === 'read') {
      const result = readResults.get(key(a.step));
      if (rejected.has(i)) {
        const why = `this answer included another child's records (${rejected.get(i)}), so it is not shown. Ask it on its own for ${a.person}.`;
        body = `_Not shown: ${why}_`; failed.push({ index: i, ask: a.heading, reason: why });
      } else if (result?.success) body = sectionText(a, result, lang);
      else { const why = failureOf(result, actor, a.ask); body = `_${why.text}_`; failed.push({ index: i, ask: a.heading, reason: why.text, topic: why.topic }); }
    } else {
      const notes = writeNotes.get(i);
      const drafted = draftResult?.index === i;
      const queuedHere = queued.filter((q) => q.label === a.heading).length;
      body = [
        drafted ? "Drafted — it is waiting for your confirmation below." : null,
        queuedHere ? `${queuedHere} more draft(s) queued — after you confirm or cancel this one, say "next" for the next.` : null,
        notes ? (drafted ? notes : (/^(?:What|Whose|Which)\b/.test(notes) ? notes : `_${notes}_`)) : null,
      ].filter(Boolean).join('\n') || '_Not done._';
      if (!drafted && notes && !/\?$/.test(notes) && !calls.some((c) => c.result?.action?.status === 'completed')) failed.push({ index: i, ask: a.heading, reason: notes });
    }
    return `**${i + 1}. ${a.heading}**\n${body}`;
  });
  if (failed.length) {
    sections.push(`_Could not be done: ${failed.map((f) => `part ${f.index + 1} ("${f.ask}")${f.topic ? ` — no access to ${f.topic}` : ` — ${f.reason.replace(/^(?:Not (?:answered|done|included):\s*)/, '').replace(/\.$/, '')}`}`).join('; ')}._`);
  }

  const answered = sections.join('\n\n');
  const succeeded = calls.filter((c) => c.result?.success && !c.result?.action);
  const base = {
    lang,
    tool: calls.at(-1)?.tool ?? asks.find((a) => a.step)?.step.tool ?? null,
    tools: calls.map((c) => c.tool),
    plan: calls.map((c) => ({ tool: c.tool, args: c.args ?? {} })),
    via: 'MCP',
    data: succeeded.length === 1 ? succeeded[0].result.data : succeeded.map((c) => ({ tool: c.tool, data: c.result.data })),
    evidence: evidenceFor(calls),
    multiAsk: { parts: asks.map((a, i) => ({ ask: a.heading, kind: a.kind, tool: a.step?.tool ?? (a.kind === 'parents' ? 'send_conversation_message' : null), failed: failed.some((f) => f.index === i) })) },
    queuedWrites: queued,
    ...(failed.length && { unanswered: failed.map((f) => f.topic ?? f.ask) }),
    _calls: calls,
  };
  if (action) {
    const confirm = t('agent.confirm', lang, { summary: action.summary });
    return {
      ...base,
      reply: `${answered}\n\n${confirm}`,
      preface: answered,
      action: {
        id: action.id,
        confirmToken: action.confirmationToken,
        summary: action.summary,
        tool: action.tool,
        risk: action.risk,
        affectsOthers: Boolean(action.affectsOthers),
        expiresInMinutes: action.expiresInMinutes,
      },
    };
  }
  // With a model configured, and every part a read that was answered, the
  // model may PHRASE the joined answer (one heading per part) -- composeAnswer
  // gives it only these results and checks its text; the answer-validation
  // layer (agent/verify.js) checks it again and falls back to the sections
  // above, laid out by code, if anything in it is not in the records.
  const allReadsAnswered = asks.every((a) => a.kind === 'read') && !failed.length;
  if (allReadsAnswered && answerIsModelWritten(calls)) {
    const composed = await composeAnswer({ message, calls, lang });
    if (composed && composed.trim()) return { ...base, reply: composed, modelWritten: true, _deterministic: answered, action: null };
  }
  return { ...base, reply: answered, action: null };
}

/** "next": the next queued draft of an earlier multi-part message. */
export const NEXT_DRAFT = /^\s*(?:next|next\s+(?:one|draft|message|please)|(?:draft|prepare|show)\s+the\s+next(?:\s+(?:one|draft|message))?|continue\s+with\s+the\s+next(?:\s+one)?)\s*[.!]*\s*$/i;

/** The message a "Which child?" was asked about, now about the child named. */
export function withChild(message, name, term = null) {
  const text = String(message ?? '');
  if (term) {
    // Each bare use of the shared first name becomes the full name chosen.
    const words = text.split(/(\s+)/);
    const surname = String(name).split(/\s+/).slice(1).join(' ').toLowerCase();
    let changed = false;
    for (let i = 0; i < words.length; i += 1) {
      const bare = words[i].replace(/['’]s$/i, '');
      if (bare.toLowerCase() !== String(term).toLowerCase()) continue;
      const next = (words[i + 2] ?? '').toLowerCase().replace(/['’]s$/, '');
      if (surname && next === surname.split(' ')[0]) continue;
      words[i] = words[i].replace(bare, name);
      changed = true;
    }
    if (changed) return words.join('');
  }
  const kin = /\b(?:my|our)\s+(?:child|kid|son|daughter|ward)(?:['’]s)?\b/i;
  return kin.test(text) ? text.replace(kin, `${name}'s`) : `${name}'s ${text}`;
}
