import { CURRENT_ONLY } from '../../p4StudentAlumnus/p4StudentAlumnus.routes.js';
import { hinglishToEnglish } from './hinglish.js';

/**
 * Turns the conversation harness (tests/askAi.conversations.test.js, p6)
 * found answered with something that was not an answer -- each read here,
 * before any tier chooses a capability, and each ending either in a sentence
 * that is true without a tool, or in an ordinary plan step that the MCP server
 * authorizes, scopes and (for a write) asks to confirm like any other.
 *
 *   "ok", "thanks"                    an acknowledgement, not "I'm not sure what you need"
 *   "what is my rank in class?"       the school's policy, said honestly, and the person's own marks instead
 *   "request a transfer certificate"  a former student's certificate request (or why that kind is not offered)
 *   "pay the fees for Rahul"          the assistant cannot pay; what is due, and where to pay
 *   "the 2nd one"                     the person the last answer listed second
 */

/* ── Acknowledgements ─────────────────────────────────────── */

const THANKS = /^\s*(?:thanks?(?:\s+(?:a\s+lot|so\s+much|you(?:\s+so\s+much)?))?|thank\s+you(?:\s+(?:so\s+much|very\s+much))?|thx|ty|tysm|dhanyavaad|dhanyawad|shukriya|thanks?\s+a\s+lot)\s*[.!]*\s*$/i;
const ACK = /^\s*(?:ok(?:ay)?|okk+|k|kk|cool|great|nice|got\s+it|alright|all\s+right|fine|good|perfect|noted|understood|i\s+see|hmm+|accha|achha|acha|theek\s+hai|thik\s+hai|ok\s+thanks?|okay\s+thanks?)\s*[.!]*\s*$/i;

const DONE = /^\s*(?:no|nope|nah|no\s+thanks?|nothing(?:\s+else)?|that'?s\s+(?:all|it)|bas|all\s+good)\s*[.!]*\s*$/i;

/** "ok" / "thanks" after an answer: acknowledged, nothing looked up. Null otherwise. */
export function acknowledgement(message) {
  const text = String(message ?? '');
  if (THANKS.test(text) || /^\s*ok(?:ay)?\s+thanks?\b/i.test(text)) return "You're welcome. I'm here whenever you need something else.";
  if (ACK.test(text)) return "Okay. I'm here if you need anything else.";
  if (DONE.test(text)) return "Okay. I'm here if you need anything else.";
  return null;
}

/**
 * "Is that good?" after a figure: a judgement the records do not hold. Said
 * so, with what can be shown instead -- never "I'm not sure what you need".
 */
export function opinionReply(message) {
  if (!/^\s*(?:(?:so|and|but)\s+)?(?:is|was)\s+(?:that|this|it)\s+(?:good|bad|ok(?:ay)?|enough|fine|low|high|normal|poor|great)\b[^?]{0,20}\??\s*$|^\s*how\s+(?:good|bad)\s+is\s+(?:that|this|it)\s*\??\s*$/i.test(String(message ?? ''))) return null;
  return "I can't judge that from the records — whether it's good depends on what the school and the teachers expect. "
    + 'I can show how it has changed over time (for example "show the performance history" or "attendance month wise"), and the school\'s own rules are in its notices.';
}

/** "the first one" with no list of people before it to count in. */
export function isOrdinalOnly(message) {
  return ORDINAL.test(String(message ?? '')) && !/\b(?:attendance|marks?|fees?|homework|report)\b/i.test(String(message ?? ''));
}

/* ── Class rank ───────────────────────────────────────────── */

const RANK = /\b(?:rank(?:ing)?|position\s+in\s+(?:the\s+|my\s+|his\s+|her\s+)?class|class\s+position|merit\s+(?:list|position)|topper|top(?:ped)?\s+(?:the|my|in)\s+class|first\s+in\s+(?:the\s+|my\s+)?class|stand(?:ing)?\s+in\s+(?:the\s+|my\s+)?class)\b/i;

/**
 * "What is my rank in class?" -- answered with the policy, honestly, and the
 * caller's own results in its place. EduOS shows no class rank to a student
 * or a family: the only ranks anywhere are the top ranks the school chooses to
 * publish in its showcase, for children whose families consented. It used to
 * be answered with the student's list of classes, or their "designation".
 *
 * Staff are given the named student's own marks, with how to see the class's.
 * Returns `{ note, steps, offer }` or null.
 */
export function rankTurn(message, actor, held) {
  const text = hinglishToEnglish(String(message ?? ''));
  if (!RANK.test(text) || /\b(?:rank|sort|order)\s+(?:the\s+)?(?:classes|students|sections)\b|\brank(?:ed)?\s+by\b/i.test(text)) return null;
  const role = actor?.roleKey;
  const named = /\b(?:of|for)\s+(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)?)/u.exec(text)?.[1]
    ?? /\b(\p{Lu}[\p{L}-]+(?:\s+\p{Lu}[\p{L}-]+)?)['’]s\b/u.exec(text)?.[1] ?? null;
  const step = (tool, args = {}) => (held.has(tool) ? [{ tool, args }] : []);
  if (role === 'STUDENT' || role === 'PARENT') {
    const whose = role === 'STUDENT' ? 'students' : 'parents';
    return {
      note: `Class ranks aren't shown to ${whose} — that is the school's policy. The only ranks published anywhere are the top ranks in the school's achievement showcase, and only for students whose families agreed to it. I haven't looked up anyone else's marks.`,
      steps: step('get_report_card', named && role === 'PARENT' ? { studentName: named } : {}),
      offer: role === 'STUDENT'
        ? 'Your own percentage is above. For how it has changed across exams, ask "show my performance history".'
        : 'For how it has changed across exams, ask for the performance history.',
    };
  }
  if (!named) return null;
  return {
    note: `EduOS does not keep a class rank, so I can't give one for ${named}. Here are ${named}'s own marks.`,
    steps: step('get_report_card', { studentName: named }),
    offer: 'To compare with the class, ask for the class marks (for example "show Class 6 A marks").',
  };
}

/* ── A former student's certificate ───────────────────────── */

const CERTIFICATE_KINDS = [
  [/\btransfer\s+certificate\b|\bt\.?c\.?\b/i, 'Transfer Certificate'],
  [/\b(?:school\s+)?leaving\s+certificate\b|\bl\.?c\.?\b/i, 'Leaving Certificate'],
  [/\b(?:character|conduct)\s+certificate\b/i, 'Character Certificate'],
  [/\bstudy\s+certificate\b/i, 'Study Certificate'],
  [/\bbona\s*fide(?:\s+certificate)?\b/i, 'Bonafide Certificate'],
  [/\benrol+ment\s+certificate\b/i, 'Enrollment Certificate'],
  [/\bfee\s+certificate\b/i, 'Fee Certificate'],
];
const BOARD_DOCUMENTS = /\b(?:migration\s+certificate|duplicate\s+(?:board\s+)?mark\s*sheet|board\s+mark\s*sheet|board\s+certificate)\b/i;
const WANTS = /\b(?:request|apply|need|want|get|issue|send|give|require|would\s+like|chahiye|for\s+my)\b/i;

/**
 * "Request a transfer certificate" from a former student: the alumni
 * certificate request, drafted for confirmation. A kind that certifies a
 * CURRENT student (bonafide, enrolment, fee) is not offered to former
 * students -- the same rule the alumni screen applies (CURRENT_ONLY) -- and
 * that is said, with what they can ask for. A board document is the board's.
 *
 * It used to be refused outright ("You can't request certificate from your
 * account") by the pre-routing check, or routed to the jobs board on the word
 * "job" in "for a job application".
 */
export function alumniCertificateTurn(message, actor, held) {
  if (actor?.roleKey !== 'ALUMNUS' || !held.has('request_alumni_certificate')) return null;
  const text = String(message ?? '');
  if (!/\bcertificate\b|\bt\.?c\.?\b|\bl\.?c\.?\b|\bbona\s*fide\b|\bmark\s*sheet\b/i.test(text)) return null;
  if (/\b(?:my|the)\s+(?:certificate|tc|lc)\s+requests?\b|\bstatus\b|\bcancel\b|\bwhich\s+certificates?\b|\bwhat\s+certificates?\b/i.test(text)) return null;
  if (!WANTS.test(text)) return null;
  if (BOARD_DOCUMENTS.test(text)) {
    return { reply: 'A migration certificate or a duplicate board marksheet comes from the examination board itself, not the school, so I can\'t request it here. '
      + 'From the school you can request a transfer, leaving, character or study certificate.' };
  }
  const kind = CERTIFICATE_KINDS.find(([re]) => re.test(text))?.[1] ?? null;
  if (kind && CURRENT_ONLY.test(kind)) {
    return { reply: `A ${kind.toLowerCase()} certifies a current student, so it isn't offered to former students. `
      + 'You can request a transfer, leaving, character or study certificate instead — tell me which, and what it is for.' };
  }
  if (!kind) {
    return { reply: 'Which certificate would you like — a transfer, leaving, character or study certificate? And what is it for?', needsInput: true };
  }
  const purpose = /\bfor\s+(?!me\b|myself\b)(?:my\s+|a\s+|an\s+|the\s+)?([\p{L}][\p{L}\d ,'-]{2,120}?)\s*[.!?]*\s*$/iu.exec(text)?.[1]?.trim() ?? null;
  return { step: { tool: 'request_alumni_certificate', args: { certificate: kind, ...(purpose && { purpose }) } } };
}

/* ── Paying fees ──────────────────────────────────────────── */

/**
 * "Pay the fees for Rahul": the assistant takes no payment and must never
 * sound as if it did. It says so, shows what is due (the caller's own read,
 * for the child named), and where to pay. It used to answer with the payment
 * history ("No payments have been recorded") -- true, and beside the point.
 */
export function payFeesTurn(message, actor, held) {
  if (!['PARENT', 'STUDENT'].includes(actor?.roleKey)) return null;
  const text = String(message ?? '');
  if (!/^\s*(?:please\s+|can\s+you\s+|could\s+you\s+|i\s+want\s+to\s+|i'd\s+like\s+to\s+|help\s+me\s+)?(?:pay|make\s+(?:a\s+|the\s+)?payment|clear)\b[^?]*\b(?:fees?|dues|invoice|balance|amount)\b/i.test(text)) return null;
  const named = /\bfor\s+(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)?)/u.exec(text)?.[1]
    ?? /\b(\p{Lu}[\p{L}-]+)['’]s\b/u.exec(text)?.[1] ?? null;
  const steps = named && held.has('get_pending_fees') ? [{ tool: 'get_pending_fees', args: { search: named } }]
    : held.has('get_fees') ? [{ tool: 'get_fees', args: {} }] : [];
  return {
    note: "I can't take or record a payment — nothing has been paid. You can pay online from the Fees page (Pay now), or at the school office. Here is what is due:",
    steps,
  };
}

/* ── Figures and details the assistant does not have ──────── */

/**
 * Questions whose honest answer is "that is not something I have", which
 * used to be answered with a DIFFERENT figure: "what is the school's pass
 * percentage?" came back as the attendance overview ("Overall 61%") -- a
 * real number presented as the answer to another question -- and "what is
 * Rahul's phone number?" with his class and roll number, as if that were it.
 */
export function unavailableFigureTurn(message) {
  const text = hinglishToEnglish(String(message ?? ''));
  if (/\bpass(?:ing)?\s*(?:percentage|percent|rate|ratio|%)|\bfail(?:ure)?\s+(?:rate|percentage)\b|\bhow\s+many\s+(?:students\s+)?(?:passed|failed)\b/i.test(text)) {
    return "EduOS doesn't keep a pass percentage, so I can't give you one — and I won't put a different figure in its place. "
      + 'I can show how a class did in an exam (for example "how did Class 10 A do in Unit Test 2?"), or a student\'s report card.';
  }
  if (!/\bmy\b/i.test(text) && !/\d{5,}/.test(text) && !/^\s*(?:please\s+)?(?:update|change|set|add|correct|edit|search|find)\b/i.test(text) && /\b(?:phone|mobile|contact|whatsapp)\s*(?:number|no\.?|details)\b|\b(?:phone|mobile)\b[^?]{0,30}\b(?:of|for)\b|\bemail\s+(?:address|id)\b|\b(?:home\s+)?address\s+of\b|['’]s\s+(?:home\s+)?address\b/i.test(text)) {
    return "I don't share phone numbers, email addresses or home addresses through the assistant. "
      + 'To reach a family, send them a message through EduOS (for example "message Rahul Sharma\'s parents"); the office holds the contact details.';
  }
  return null;
}

/* ── Booking a meeting ────────────────────────────────────── */

/**
 * "Book a slot with my class teacher" / "book a PTM slot with Rahul's class
 * teacher". For a parent: the PTM slots of their children (the booking read,
 * from which a slot is then reserved and confirmed). For a student, who books
 * no meetings in EduOS: said so. It used to be read as BOOKS ("you have not
 * asked for any books", or "you can't book a library book").
 */
export function meetingTurn(message, actor, held) {
  const text = String(message ?? '');
  if (!/\b(?:book|schedule|fix|arrange|set\s+up)\b[^?]{0,40}\b(?:slot|meeting|appointment|ptm|parent[\s-]teacher|time\s+with)\b|\bmeet\s+(?:the\s+|my\s+|rahul's\s+)?(?:class\s+)?teacher\b/i.test(text)) return null;
  if (/\blibrary\b|\bbooks?\s+(?:on|about|by|called|titled)\b/i.test(text)) return null;
  if (actor?.roleKey === 'PARENT' && held.has('get_ptm_slots')) return { step: { tool: 'get_ptm_slots', args: {} } };
  if (actor?.roleKey === 'STUDENT') {
    return { reply: "Students can't book meetings with teachers here — parent–teacher meetings are booked by your parent from their account. "
      + 'You can message your class teacher, or see your timetable to find them.' };
  }
  return null;
}

/* ── "issue it to Rahul" ──────────────────────────────────── */

/**
 * "Is Clean Code available?" -> "issue it to Rahul Sharma": "it" is the book
 * the last read was about (its title, kept by the memory with that read's
 * arguments). Returns the message with the title in place of "it", or null.
 */
export function itReference(message, context = {}) {
  const title = context?.lastRead?.args?.title;
  if (!title || typeof title !== 'string') return null;
  const text = String(message ?? '');
  const m = /\b(issue|lend|reserve|renew|return|request|who\s+has|is)\s+it\b/i.exec(text);
  if (!m) return null;
  return `${text.slice(0, m.index)}${m[1]} ${title}${text.slice(m.index + m[0].length)}`;
}

/* ── "the 2nd one" ────────────────────────────────────────── */

const ORDINAL_WORDS = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5, last: -1 };
// "the 2nd one", "the first student's attendance", "second one" -- an ordinal
// with "the" before it or "one/student/child" after it. Never "last month" or
// "5th A" (a period, a class).
const ORD = 'first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last';
const ORDINAL = new RegExp(String.raw`^\s*(?:and\s+|ok(?:ay)?\s+|now\s+)?(?:(?:show|open|what\s+about|tell\s+me\s+about)\s+)?(?:the\s+(${ORD})(?:\s+(?:one|student|child|person|name))?|(${ORD})\s+(?:one|student|child|person))(?:['’]s)?(?!\s+(?:month|week|year|term|time|day|period|class|exam|test|semester)\b)(?![\w-])\s*(.*?)\s*[?.!]*\s*$`, 'i');

/**
 * "The 2nd one", "the first one's attendance": the person the last answer
 * listed in that place (the memory keeps who an answer listed, from the
 * tool's own rows). Returns the message with that person named, or null.
 * A list of one or none, or a place past its end, is not guessed at.
 */
export function ordinalReference(message, students = []) {
  const m = ORDINAL.exec(String(message ?? ''));
  if (!m || !Array.isArray(students) || students.length < 2) return null;
  const place = ORDINAL_WORDS[(m[1] ?? m[2]).toLowerCase()];
  const index = place === -1 ? students.length - 1 : place - 1;
  if (index < 0 || index >= students.length) return null;
  const name = students[index];
  const rest = (m[3] ?? '').replace(/^(?:'s|’s)\s*/i, '').trim();
  return rest ? `show ${name}'s ${rest}` : `show student ${name}`;
}
