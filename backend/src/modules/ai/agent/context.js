import { getMcpTool } from '../mcp/registry.js';
import { extractArgument, kindOfProperty, FOUND } from './argumentKinds.js';
import { classFromText } from '../../../utils/classNames.js';

/**
 * Context resolution: the turns whose meaning is in the conversation rather
 * than in their own words, read BEFORE the parser sees them.
 *
 *   "show more", "next"                  the next window of the last long list
 *   "yes" / "no" to a draft              confirm or cancel the draft just shown
 *   "make it Monday instead",            the draft just shown, changed and shown
 *   "change the title to ..."            again for confirmation (never run)
 *   "no, I meant yesterday",             a correction of the last question: asked
 *   "sorry, I meant 6 B"                 again with the new day / class / person
 *   "go back to the 5A attendance"       an earlier question, asked again
 *   "message their parents",             a write about the people the last
 *   "remind them"                        answer listed
 *
 * Everything here only CHOOSES. A draft is changed by proposing it again
 * through the MCP tool, which validates, scopes and asks for confirmation as
 * it did the first time; a confirmation goes through the same token path as
 * the website's button; a carried name is resolved again by the tool at the
 * caller's own scope. Ambiguity is asked about, never guessed.
 */

/* ── "show more" ──────────────────────────────────────────── */

const MORE = /^\s*(?:please\s+)?(?:(?:show|load|see|give\s+me|tell\s+me)\s+(?:me\s+)?(?:some\s+)?more|more(?:\s+please)?|next(?:\s+(?:page|ones?|few|lot))?|continue(?:\s+the\s+list)?|the\s+rest|show\s+the\s+rest|aur|और)\s*[.!?]*\s*$/i;

export function isMoreRequest(message) {
  return MORE.test(String(message ?? ''));
}

/* ── yes / no to a draft ──────────────────────────────────── */

export const AGREES = /^\s*(?:yes|yeah|yep|y|ok(?:ay)?|sure|confirm(?:ed)?|go\s+ahead|do\s+it|proceed|please\s+do|haan|haa|ha|ji|theek\s+hai|thik\s+hai|ठीक है|हाँ)(?:[\s,]+(?:please|go\s+ahead|do\s+it|confirm))?\s*[.!]*\s*$/i;
export const DECLINES = /^\s*(?:no|nope|n|cancel(?:\s+(?:it|that|this))?|don'?t|do\s+not|stop|never\s*mind|forget\s+it|nahi|nahin|नहीं)(?:[\s,]+(?:thanks|thank\s+you|please))?\s*[.!]*\s*$/i;

/** The proposal sentence the website and WhatsApp end a draft with. */
const PROPOSAL = /Shall I go ahead|Reply YES|Reply \*YES\*|क्या मैं आगे/i;

/** True when the assistant's last turn was a draft awaiting a yes. */
export function lastTurnProposed(history = []) {
  const last = [...history].reverse().find((t) => t?.role === 'assistant');
  return Boolean(last && PROPOSAL.test(String(last.text ?? '')));
}

/* ── changing a draft ─────────────────────────────────────── */

/** Words that say the draft is being changed rather than a new request made. */
const EDIT_LEAD = /^\s*(?:(?:no|nope|sorry|oh|wait|actually|hmm)[\s,!.]+)*(?:please\s+)?(?:make\s+(?:it|that|the\s+\w+)|change\s+(?:it|that|this|the\s+[\w ]{1,20}?)(?:\s+to)?|set\s+(?:it|the\s+[\w ]{1,20}?)\s+to|move\s+(?:it|that)\s+to|switch\s+(?:it|that)\s+to|update\s+(?:it|the\s+[\w ]{1,20}?)\s+to|rename\s+it|call\s+it|i\s+meant|i\s+mean|instead|rather|not\s+\w+[\s,]+but)\b/i;
const INSTEAD = /\b(?:instead|rather)\b/i;

/** True when a message reads as a change to the draft just shown. */
export function looksLikeDraftEdit(message) {
  const text = String(message ?? '').trim();
  if (!text || text.split(/\s+/).length > 20) return false;
  return EDIT_LEAD.test(text) || INSTEAD.test(text);
}

/** "make it Monday instead" -> "Monday": the new value, without the edit's own words. */
function editBody(message) {
  return String(message ?? '')
    .replace(/^\s*(?:(?:no|nope|sorry|oh|wait|actually|hmm)[\s,!.]+)*(?:please\s+)?/i, '')
    .replace(/^(?:make\s+(?:it|that)|change\s+(?:it|that|this)(?:\s+to)?|set\s+it\s+to|move\s+(?:it|that)\s+to|switch\s+(?:it|that)\s+to|update\s+it\s+to|i\s+meant|i\s+mean)\s+/i, '')
    .replace(/\b(?:instead|rather)\b/gi, '')
    .replace(/[\s.!?]+$/, '')
    .trim();
}

const TEXT_TARGETS = [
  { re: /\b(?:title|heading|name)\b/i, names: ['title', 'name'] },
  { re: /\b(?:message|text|wording|body|content|announcement)\b/i, names: ['content', 'message', 'body', 'text'] },
  { re: /\breason\b/i, names: ['reason'] },
  { re: /\b(?:description|details)\b/i, names: ['description'] },
  { re: /\bsubject\b/i, names: ['subject'] },
];

/** "change the title to X", "rename it X", "call it X": the field and the new words, or null. */
function textChange(message, properties) {
  const text = String(message ?? '');
  const renamed = /\b(?:rename\s+it|call\s+it)\s+(?:to\s+|as\s+)?["“']?(.+?)["”']?\s*[.!]?\s*$/i.exec(text);
  if (renamed && (properties.title || properties.name)) return { name: properties.title ? 'title' : 'name', value: renamed[1].trim() };
  for (const target of TEXT_TARGETS) {
    const m = new RegExp(`${target.re.source}\\s*(?:to|as|:|=|should\\s+(?:be|say)|says?)\\s*["“']?(.+?)["”']?\\s*[.!]?\\s*$`, 'i').exec(text);
    if (!m) continue;
    const name = target.names.find((n) => properties[n]);
    if (name) return { name, value: m[1].trim() };
  }
  return null;
}

const STATUS_WORD = /\b(present|absent|late|excused)\b/i;

/**
 * The draft's arguments with the change applied: `{ args, changed: [field] }`,
 * or `{ ask }` when the message changes nothing the draft holds. Only fields
 * the draft's own tool accepts are touched, and only fields the change names.
 */
export function applyDraftEdit(pending, message, { now = new Date() } = {}) {
  const tool = getMcpTool(pending?.tool);
  const properties = tool?.inputSchema?.properties ?? {};
  const args = structuredClone(pending?.args ?? {});
  const changed = [];
  const body = editBody(message);

  // Free text the change names: "change the title to Algebra revision".
  const text = textChange(message, properties);
  if (text && text.value) {
    const before = args[text.name];
    args[text.name] = text.value;
    // A notice whose headline was its body keeps them the same.
    if (text.name === 'title' && properties.content && args.content === before) args.content = text.value;
    changed.push(text.name);
  }

  if (!text) {
    // A date: into the date the draft already has (both ends of a one-day span).
    const dateFields = Object.entries(properties)
      .filter(([name, p]) => kindOfProperty(name, p) === 'date' && args[name] !== undefined);
    if (dateFields.length) {
      const [name, property] = dateFields[0];
      const found = extractArgument(name, property, body, { now, write: true });
      if (found.status === FOUND && found.value) {
        const value = found.value;
        const pair = [['fromDate', 'toDate'], ['from', 'to'], ['startsOn', 'endsOn'], ['startDate', 'endDate']]
          .find(([a, b]) => args[a] !== undefined && args[b] !== undefined && String(args[a]).slice(0, 10) === String(args[b]).slice(0, 10));
        if (pair) { args[pair[0]] = value; args[pair[1]] = value; changed.push(pair[0], pair[1]); }
        else {
          // A stored date-time keeps its time of day.
          const old = String(args[name] ?? '');
          args[name] = old.length > 10 && /T/.test(old) ? `${value}${old.slice(10)}` : value;
          changed.push(name);
        }
      }
    }
    // A class.
    const spoken = classFromText(body, { lenient: true });
    if (spoken && !spoken.gradeOnly && properties.className) {
      args.className = spoken.lenient ? `Class ${spoken.key.toUpperCase()}` : spoken.text;
      delete args.sectionId;
      changed.push('className');
    }
    // An attendance status, for every student in the draft.
    const status = STATUS_WORD.exec(body)?.[1];
    if (status && Array.isArray(args.students)) {
      args.students = args.students.map((s) => ({ ...s, status: status.toUpperCase() }));
      changed.push('status');
    }
  }

  if (!changed.length) {
    const editable = Object.keys(properties)
      .filter((n) => args[n] !== undefined && !/Id$|^students$|^type$/.test(n))
      .map((n) => n.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase())
      .slice(0, 5);
    return {
      ask: `What should I change in the draft${editable.length ? ` — ${editable.join(', ')}` : ''}? `
        + 'For example "make it Monday instead" or "change the title to …". Or say "cancel".',
    };
  }
  return { args, changed: [...new Set(changed)] };
}

/* ── corrections and going back ───────────────────────────── */

const CORRECTION = /^\s*(?:(?:no|nope|sorry|oops|wait|actually)[\s,!.]+)*(?:i\s+meant|i\s+mean|i\s+said|make\s+(?:it|that))\s+(.+?)\s*[.!?]*\s*$/i;
const BARE_CORRECTION = /^\s*(?:no|nope|sorry|actually)[\s,!.]+(?:for\s+|in\s+|on\s+)?(.+?)\s*[.!?]*\s*$/i;
const GO_BACK = /^\s*(?:(?:ok(?:ay)?|now|and)[\s,]+)?(?:please\s+)?(?:go\s+back\s+to|back\s+to|return\s+to|show\s+(?:me\s+)?again)\s+(?:the\s+|that\s+)?(.+?)\s*[.!?]*\s*$/i;

/**
 * A correction or a "go back", rewritten as the plain request it is, or null.
 *
 *   "no, I meant yesterday"         -> "what about yesterday"   (a follow-up of the last read)
 *   "sorry, I meant 6 B"            -> "what about 6 B"
 *   "go back to the 5A attendance"  -> "show 5A attendance"
 *
 * Only inside a conversation: with nothing before it a correction corrects
 * nothing, and is left to the ordinary readers.
 */
export function rewriteCorrection(message, history = []) {
  if (!history.length) return null;
  const text = String(message ?? '');
  const back = GO_BACK.exec(text);
  if (back && !NOT_A_SUBJECT.test(back[1])) return `show ${back[1]}`;
  const meant = CORRECTION.exec(text)?.[1];
  const bare = meant ? null : BARE_CORRECTION.exec(text)?.[1];
  const corrected = meant ?? bare;
  if (!corrected || corrected.split(/\s+/).length > 5 || NOT_A_SUBJECT.test(corrected)) return null;
  // "No, thanks" corrects nothing. A bare "no, X" counts only when X is
  // plainly a day, a class or a name -- never an ordinary word.
  if (bare && !(/\d/.test(bare) || WHEN_WORD.test(bare) || /^[A-Z]/.test(bare))) return null;
  return `what about ${corrected}`;
}

const NOT_A_SUBJECT = /^(?:thanks?|thank\s+you|nothing|problem|worries|need|it|that|this|way|idea|sorry|ok(?:ay)?)\b/i;
const WHEN_WORD = /^(?:today|yesterday|tomorrow|(?:last|this|next|previous)\s+\w+|(?:mon|tues|wednes|thurs|fri|satur|sun)day|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

/* ── writes about the people the last answer listed ───────── */

const MESSAGE_THEIR_PARENTS = /^\s*(?:please\s+)?(?:message|text|write\s+to|send\s+(?:a\s+)?(?:message|note)\s+to|contact|inform|tell)\s+(?:their|the(?:ir)?|those|these|his|her|the\s+student'?s)\s+(?:parents?|guardians?|families|family|mother|father)\b(.*)$/i;
const REMIND_THEM = /^\s*(?:please\s+)?(?:remind|nudge|chase|follow\s+up\s+with)\s+(?:them|those|these|all\s+of\s+them|the\s+borrowers|the\s+parents|everyone)\b(.*)$/i;

/** The reminder a read's people can be sent, by the read that listed them. */
const REMINDER_AFTER = {
  get_overdue_books: 'send_library_overdue_reminders',
  list_overdue_loans: 'send_library_overdue_reminders',
  list_book_issues: 'send_library_overdue_reminders',
  get_pending_fees: 'send_fee_reminders',
};

/**
 * "message their parents", "remind them": a plan step about the people the
 * last answer named, or `{ clarify }`, or null when the message is not one.
 *
 * One message per student, as the conversation tool sends it: with one person
 * listed the draft is prepared for them (the tool asks what to say); with
 * several the person chooses -- the assistant never sends a group message
 * nobody asked for.
 */
export function groupWrite(message, { context = {}, heldTools = new Set() } = {}) {
  const text = String(message ?? '');
  const parents = MESSAGE_THEIR_PARENTS.exec(text);
  if (parents && heldTools.has('send_conversation_message')) {
    const students = context.students ?? [];
    const words = parents[2]?.replace(/^\s*(?:saying|that|:)\s*/i, '').trim();
    if (students.length === 1) {
      return { tool: 'send_conversation_message', args: { studentName: students[0], ...(words && { message: words }) } };
    }
    if (students.length > 1) {
      const list = students.slice(0, 8);
      return { clarify: `Which student's parents should I write to — ${list.join(', ')}${students.length > list.length ? ', …' : ''}? `
        + 'I send one message per student, and you confirm each one.' };
    }
    return { clarify: "Whose parents should I write to? Tell me the student's name." };
  }
  // "send reminders" right after the list is the same request as "remind them".
  const remind = REMIND_THEM.exec(text) ?? /^\s*(?:please\s+)?send\s+(?:them\s+)?(?:the\s+|a\s+)?(?:fee\s+|overdue\s+|payment\s+|library\s+)?reminders?\s*(?:to\s+(?:them|all|everyone))?\s*[.!]*\s*$/i.exec(text);
  if (remind) {
    const tool = REMINDER_AFTER[context.lastRead?.tool];
    if (tool && heldTools.has(tool)) return { tool, args: {} };
  }
  return null;
}
