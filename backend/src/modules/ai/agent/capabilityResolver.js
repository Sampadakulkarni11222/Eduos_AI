/**
 * Choosing a capability from what the registry already declares.
 *
 * WHY THIS EXISTS
 *
 * Routing used to be two tiers: a table of ~30 hand-written phrase rules
 * (`intent.js`), and a model given the whole catalogue. Manual testing of all
 * eight roles found the same two failures over and over, and both are
 * structural rather than a missing phrase:
 *
 *   NOTHING MATCHED  The catalogue holds 167 capabilities and the phrase table
 *                    reached about twenty of them. "Show me the available
 *                    library books", "show my book requests", "show available
 *                    transport routes", "show open hostel inquiries" all fell
 *                    through to "I can help with: ..." -- a capability the
 *                    caller held could not be reached by asking for it.
 *
 *   SOMETHING NEARBY A phrase rule matched on one word and discarded the rest
 *   MATCHED          of the request. "Outstanding fees for Class 5A" matched
 *                    the word "outstanding" and answered school-wide.
 *                    "Return the overdue Harry Potter book" matched "overdue"
 *                    and answered with a list instead of returning anything.
 *                    "Allocate a bed to Diya Sharma" answered with occupancy
 *                    statistics. In every case the assistant BROADENED what was
 *                    asked and answered confidently.
 *
 * Adding phrases would not fix either: the first is a coverage problem that
 * grows with the catalogue, and the second is a precision problem that more
 * phrases make worse. So selection is done from capability METADATA, which the
 * registry already carries and which a new capability brings with it:
 *
 *   entity        what it is about        (module, via capabilities.js)
 *   operation     what it does to it      GET | CREATE | UPDATE | DELETE | ACTION
 *   name          the verb and the nouns  `return_book` -> return, book
 *   targets       what it is about, as arguments
 *   filters       what narrows it
 *   resultShape   SUMMARY | LIST | DETAIL -- what the answer looks like
 *   schema        what it will accept at all
 *
 * A sentence is read for the same dimensions and the best fit wins. The verb
 * vocabulary is not a list anybody maintains: it is derived from the tool names
 * in the registry, so `return_book` teaches the resolver the verb "return" by
 * existing. The same is true of the nouns.
 *
 * THE RULE THAT MATTERS MOST
 *
 * A request that names something a capability cannot express is penalised
 * heavily (SPECIFICITY_PENALTY). Asking about Class 5A must not be answered
 * about the school, and asking about Room 101 must not be answered with the
 * hostel's occupancy. Where that leaves no clear winner the resolver returns
 * `needsClarification` rather than guessing -- an honest question beats a
 * confident answer to a question nobody asked.
 *
 * WHAT THIS IS NOT
 *
 * It is not authorization. Candidates come from `capabilitiesFor(actor)`, which
 * is the same permission-and-scope filter `tools/list` applies, so this can
 * only ever choose among capabilities the caller already holds -- and the MCP
 * server re-authorizes every call regardless. It is not a list of questions:
 * there is no branch, table or constant here naming a phrase, a role or a tool.
 */

import { capabilitiesFor, capabilityIndex, entitiesInText, subjectEntityOf, namesARecord } from '../mcp/capabilities.js';
import { classFromText } from '../../../utils/classNames.js';
import { monthFromText, writtenDatesIn } from '../../../utils/naturalDates.js';
import { rangeFromText, monthBounds } from '../../../utils/dateRanges.js';
import { nameFromText } from '../../../utils/peopleNames.js';
import { extractArgument, kindOfProperty, FOUND } from './argumentKinds.js';
import { dateFromText, detectOperation, subjectFromText, topicFromText } from './entityIntent.js';

/* ── Reading the sentence ─────────────────────────────────── */

/**
 * Words too common to carry meaning, plus the ones that are grammar in a
 * request ("show me the ..."). Nothing domain-specific: a domain word is the
 * signal this file is looking for.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'am', 'do', 'does', 'did',
  'i', 'me', 'we', 'us', 'you', 'it', 'this', 'that', 'these', 'those', 'there', 'here',
  'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'for', 'from', 'by', 'with',
  'as', 'so', 'than', 'then', 'too', 'very', 'can', 'could', 'would', 'should', 'will',
  'shall', 'may', 'might', 'must', 'want', 'need', 'please', 'kindly', 'just', 'now',
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how', 'all', 'any',
  'some', 'each', 'every', 'much', 'many', 'more', 'most', 'out', 'up', 'down', 'about',
  'into', 'over', 'again', 'once', 'have', 'has', 'had', 'not', 'no', 'yes', 'ok',
]);

/**
 * A crude stem, so an inflection is not a different word.
 *
 * Deliberately crude rather than a real stemmer: it only has to make
 * "requests"/"request", "books"/"book" and "allocated"/"allocate" the same
 * token. Over-stemming costs a little precision in the lexical signal, which is
 * one signal of six; a dependency would cost more.
 */
export function stem(word) {
  let w = String(word ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (w === 'catalogue') return 'catalog';
  if (w.length <= 3) return w;
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.endsWith('sses') || w.endsWith('shes') || w.endsWith('ches')) return w.slice(0, -2);
  if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('es') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  return w;
}

/** The words of a sentence, in order, lowercased. */
const wordsOf = (text) =>
  String(text ?? '')
    .toLowerCase()
    // "co-curricular" is one word; splitting it produced the tokens "co" and
    // "curricular", neither of which matches the tool named for it.
    .replace(/([a-z])-([a-z])/g, '$1$2')
    .split(/[^a-z0-9']+/)
    .filter(Boolean);

/** The meaningful stems in a sentence. */
export function tokensOf(text) {
  return new Set(wordsOf(text).filter((w) => !STOPWORDS.has(w)).map(stem).filter(Boolean));
}

/* ── Reading the capability ───────────────────────────────── */

/**
 * Words that say the same thing, as stems.
 *
 * A fact about the language, like the stemmer above -- not a route to any
 * capability. The catalogue names things with one word and people use several:
 * `get_pending_fees` says "pending", a bursar says "outstanding" or "unpaid".
 * Without this, "show outstanding fees for the school" docked the pending-fee
 * read for a noun it did not use, and the fee STRUCTURES -- which nobody asked
 * about -- answered instead.
 *
 * Kept deliberately small: only words that mean the same in every module.
 * "due" is not here, because homework is due without being unpaid.
 */
const EQUIVALENT_WORDS = [
  ['pending', 'outstanding', 'unpaid', 'owed', 'owing', 'unsettled'],
  // A student's "marks" are their "results": get_results answers "show my
  // marks", and without this the class marks sheet -- which a student cannot
  // read -- was preferred for the one word it shares with the question.
  ['mark', 'result'],
  // A library "issue" is a loan. "Show my borrowed books" is a question about
  // loans, and was answered with book REQUESTS for want of the word.
  ['issue', 'borrow', 'borrowed', 'loan', 'lend', 'lent'],
  ['payment', 'pay'],
  // A teacher's "task" is the work they set: "show my tasks" asks for
  // assignments, and scored below every threshold for want of the word.
  ['assignment', 'task'],
  // Where the bus collects a student is their pickup: "show my pickup point"
  // asks for the caller's bus assignment.
  ['bus', 'pickup'],
  // Correcting a record is editing it: "what fields can I CHANGE" and "cancel
  // my profile CHANGE request" name the profile-EDIT capabilities.
  ['edit', 'editable', 'change', 'changeable', 'correction'],
];

const EQUIVALENTS = new Map();
for (const group of EQUIVALENT_WORDS) {
  // Singular and plural both: the stemmer takes "issues" to "issu" and leaves
  // "issue" alone, and a tool NAME is usually plural.
  const stems = [...new Set(group.flatMap((w) => [stem(w), stem(`${w}s`)]))];
  for (const s of stems) EQUIVALENTS.set(s, stems);
}

/** True when the sentence used this word, or one that means the same. */
function spoke(tokens, word) {
  return tokens.has(word) || (EQUIVALENTS.get(word) ?? []).some((w) => tokens.has(w));
}

/**
 * The verb and the nouns a tool name states.
 *
 * `get_my_book_requests` -> verb "get", self-referential, nouns book + request.
 * This is where the resolver's vocabulary comes from: every verb the catalogue
 * can perform is a verb some tool is named after, so declaring a capability is
 * what teaches the resolver to reach it.
 */
const NAME_NOISE = new Set(['my', 'me', 'own', 'all', 'a', 'an', 'the', 'of', 'to', 'for', 'in', 'is', 'and']);

export function nameParts(toolName) {
  const raw = String(toolName ?? '').split('_').filter(Boolean);
  const verb = raw[0] ? stem(raw[0]) : '';
  const self = raw.includes('my');
  const nouns = raw.slice(1).filter((w) => !NAME_NOISE.has(w)).map(stem).filter(Boolean);
  return { verb, nouns, self };
}

/**
 * The words a capability's own description uses.
 *
 * A weak signal, and deliberately so: descriptions are prose written for a
 * model, so a word in one is evidence rather than a declaration. It is what
 * connects "students allocated to the hostel" to `get_hostel_residents`, whose
 * name says "residents" and whose description says "students". Capped, so a
 * long description cannot outvote the tool's own name.
 */
const descriptionTokens = new Map();
function lexiconOf(capability) {
  if (!descriptionTokens.has(capability.name)) {
    descriptionTokens.set(capability.name, tokensOf(String(capability.description ?? '').slice(0, 300)));
  }
  return descriptionTokens.get(capability.name);
}

/**
 * Verbs that only ever mean "show me".
 *
 * These are the verbs the registry uses for its GET entries, and they are the
 * only tool-name verbs that carry no instruction. A message does not have to
 * repeat one for a read to be right -- "my book requests" is a read with no
 * verb in it at all.
 */
const READ_VERBS = new Set(['get', 'list', 'search', 'who', 'find', 'show', 'view']);

/**
 * Every tool-name verb in the WHOLE catalogue, and which operations wear it.
 *
 * Deliberately the whole catalogue rather than the caller's own slice. A verb
 * is a fact about the language, not about who is speaking: "approve" means the
 * same thing said by a librarian as by a finance officer, and deriving the
 * vocabulary from the caller's pool meant a librarian saying "approve Rahul's
 * book request" had no verb recognised at all -- so the request read as a
 * question and was answered with the pending list.
 *
 * It widens nothing. Which capabilities may be CHOSEN is still the caller's
 * own authorized set; this only decides what kind of thing was asked for.
 */
let verbsByOperation = null;
function verbIndex() {
  if (!verbsByOperation) {
    verbsByOperation = new Map();
    for (const c of capabilityIndex()) {
      const { verb } = nameParts(c.name);
      if (!verb) continue;
      if (!verbsByOperation.has(verb)) verbsByOperation.set(verb, new Set());
      verbsByOperation.get(verb).add(c.operation);
    }
  }
  return verbsByOperation;
}

/* ── What the sentence asks to be DONE ────────────────────── */

/**
 * Words that can introduce the verb of a request.
 *
 * Position matters, and getting it wrong was a measured bug: "show my book
 * REQUESTS" was read as the verb "request" and routed to the tool that CREATES
 * one, so a student asking to see their requests would have been offered a new
 * one. A verb is a verb where a verb goes -- at the head of the sentence, or
 * straight after "to", "and", "please" and the handful of words that introduce
 * a second clause.
 */
const VERB_CUES = new Set([
  'to', 'and', 'then', 'also', 'please', 'can', 'could', 'would', 'want', 'wants',
  'wanted', 'like', 'need', 'help', 'let', 'kindly',
]);
// Deliberately NOT 'i', 'me' or 'you'. The word after a pronoun is as often a
// past participle as a verb, and reading one as an instruction was a measured
// bug: "when did I JOIN the school" and "how am I REGISTERED in the school
// system" were both read as requests to create something, which ruled out
// every read -- so two ordinary profile questions routed nowhere at all.

/** The words of a sentence that could be its verb. */
export function verbPositions(text) {
  const words = wordsOf(text);
  const candidates = new Set();
  // An instruction opens with the verb's base form -- "mark", "record" --
  // never its third-person "-s" form. "Marks" at the head of a sentence is the
  // noun, and reading it as the verb made a bare "marks" a request to WRITE
  // marks: the resolver proposed publishing them.
  const add = (word) => {
    if (!word) return;
    if (/[^s]s$/.test(word) && stem(word) !== word) return;
    candidates.add(stem(word));
  };
  add(words[0]);
  for (let i = 0; i < words.length - 1; i += 1) {
    if (VERB_CUES.has(words[i])) add(words[i + 1]);
  }
  return candidates;
}

/**
 * A sentence in the mood of asking for something to happen.
 *
 * Grammar, not vocabulary: "I want to ...", "can I ...", "apply for ...". It is
 * read the same way AGGREGATE_REQUEST is, and it exists because a request is
 * often phrased with a verb the catalogue does not use -- "I want to JOIN the
 * football activity" asks for the same thing `request_cocurricular` does. The
 * negative lookahead keeps "I want to see my fees" a read.
 */
/** A question opening with a question word asks what IS, whatever verb follows. */
const WH_QUESTION = /^\s*(?:what|which|how|when|where|who|whom|whose|why)\b/i;

const REQUEST_MOOD = [
  /\b(?:i\s+want\s+to|i'?d\s+like\s+to|i\s+need\s+to|can\s+i|let\s+me)\s+(?!see|view|show|know|check|look|find|get|read)\w+/i,
  // "apply for leave", "sign up for", "register for" -- each carries its own
  // preposition, and that is what makes it a request rather than a report. A
  // bare "join" or "enrolled" does not: "when did I join the school" is a
  // question about the past.
  /\b(?:apply\s+for|sign\s+up\s+for|register\s+for)\b/i,
];

/* ── The dimensions a request can name ────────────────────── */

/**
 * The caller as the subject of their own question.
 *
 * "my timetable" and "what classes do I teach" are the same request about the
 * same person, and reading only the possessive missed the second -- which then
 * scored a self-named capability DOWN and answered a teacher's question about
 * their own classes with the school's class list. A bare "I" counts only where
 * a pronoun goes, after an auxiliary or before a verb, so an "I" inside a
 * quoted title is not a claim about whose records are wanted.
 */
const SELF_MARKER =
  /\b(my|mine|myself|(?:for|to)\s+me)\b|\b(?:do|did|does|am|have|has|can|should|will|was)\s+i\b|\bi\s+(?:want|need|teach|have|am|took|took|gave|give|set)\b|\bi'?(?:m|ve|d|ll)\b/i;

/**
 * "My school" is not "my record".
 *
 * Everyone in a school can say "my school", and it possesses the institution
 * rather than a record inside it -- so reading it as a self-reference scored
 * every school-wide capability DOWN for a question that was school-wide.
 * "Show me the list of students in my school" is the reported instance.
 *
 * A facility somebody RUNS belongs in the same list. A warden's "my hostel" and
 * a librarian's "my library" are the place they are responsible for, not a
 * record of their own, and reading them as personal penalised exactly the
 * school-wide capabilities those roles exist to use: "which students are
 * currently assigned to my hostel?" came back with the enquiry queue.
 */
const POSSESSED_INSTITUTION =
  // ...unless it only qualifies the noun that follows: "my library REQUESTS"
  // are the caller's own requests, not the library they run.
  /\bmy\s+(?:school|institution|college|campus|organisation|organization|hostel|library|office)\b(?!\s+(?!(?:in|at|of|for|is|are|was|were|and|or|with|to|from|on|now|today)\b)[a-z])/i;

/**
 * "My students" is a set the caller is responsible for; "my attendance" is a
 * record of their own.
 *
 * The distinction is grammatical and holds across the domain: a possessive over
 * a PLURAL is a collection the caller presides over, and a capability that
 * takes a class is exactly the right shape for one. Reading them alike
 * penalised every class-level capability for an administrator asking to see
 * their students, and the question came back answered with guardians.
 */
// A possessive over a POPULATION, not over any plural: "my marks" and "my
// fees" are the caller's own records, and reading them as a set the caller
// presides over excused the class-level capabilities from the self penalty --
// so a student's "show my marks" reached the class marks sheet.
const POSSESSED_SET =
  /\bmy\s+(?:students|pupils|children|kids|classes|sections|divisions|teachers|staff|wards|residents|members|subordinates|team)\b/i;

const asksAboutSelf = (str) => SELF_MARKER.test(String(str).replace(POSSESSED_INSTITUTION, ' '));

/** A question about a figure rather than the records behind it. */
const AGGREGATE_REQUEST =
  /\bhow\s+many\b|\bhow\s+much\b|\bcount\b|\bnumber\s+of\b|\btotal\b|\bsummar(y|ies)\b|\bstatistic|\bstats\b|\bpercentage\b|\bhealth\b|\boverview\b|\bbreakdown\b/i;

/**
 * A request to FIND something, as opposed to read one known thing.
 *
 * "Find student Rahul" asks to be shown who matches -- which is a different
 * answer from one student's record, and importantly a safer one: a search
 * offers both Rahuls, where a record capability has to pick or refuse. The
 * distinction is the verb, so it is read like the verb.
 */
const SEARCH_REQUEST = /\b(find|search|look\s*up|locate)\b/i;

/**
 * A question asking what something SAID, rather than which records exist.
 *
 * The third request shape, alongside "how many" and "show all". "What did the
 * announcement about the bus route say?" wants the notice's words; a list of
 * recent announcements is a different answer, and a worse one, because the
 * thing asked for is the text. Those questions belong to the school's own
 * written material -- which has no tool, and is what the RAG tier is for -- so
 * a capability that returns ROWS is scored down and the turn falls through to
 * it.
 */
const CONTENT_REQUEST =
  /\b(?:say|said|says|saying|mention|mentioned|state|stated|wording|worded)\b|\bcontents?\s+of\b|\bfull\s+text\b/i;

/**
 * A request for one record IN FULL, as opposed to a list or a figure.
 *
 * "Show the details of Arnav Patel" names a person and asks for everything
 * about them. Nothing in that sentence is an entity word -- no "student", no
 * "record" -- so the capability that answers it scored on the person's name
 * alone and finished below the floor, and the turn fell through to "I'm not
 * sure what you need". This is the counterpart of LIST_REQUEST: it says which
 * SHAPE of answer was asked for, and the scorer credits the capabilities whose
 * resultShape is that shape.
 *
 * Deliberately narrow. "record" is left out because it is also a verb -- a
 * request to RECORD a payment is not a request for a record -- and "about"
 * only counts in "tell me about", where it introduces a subject rather than
 * qualifying one. "profile" is left out because it is an ENTITY word: "show my
 * profile edit requests" asks for a LIST of requests, and reading the word as
 * a request for one record in full sent it to the profile itself.
 */
const DETAIL_REQUEST =
  /\bdetails?\b|\binformation\b|\binfo\b|\bparticulars\b|\btell\s+me\s+(?:more\s+)?about\b/i;

/** A question asking for the rows themselves. */
const LIST_REQUEST = /\blist\b|\ball\b|\bevery\b|\bwhich\b|\bavailable\b|\bshow\s+(?:me\s+)?(?:the\s+|my\s+)?\w/i;

/**
 * A room, bay or bus named by number.
 *
 * Generic in the same way a class reference is: a noun followed by a short
 * identifier. It is read as a dimension, never as a route to any capability --
 * what it does is stop "how many beds are free in Room 101" being answered with
 * the whole hostel's occupancy.
 */
const NUMBERED_THING = /\b(room|bed|route|bus|block|ward|floor)\s*(?:no\.?|number|#)?\s*([a-z]?\d{1,4}[a-z]?)\b/i;

export function numberedThingFromText(text) {
  const m = NUMBERED_THING.exec(String(text ?? ''));
  return m ? { kind: m[1].toLowerCase(), value: m[2].toUpperCase() } : null;
}

/**
 * A reference code, as schools write them: letters, then digits, joined by
 * dashes or slashes. ADM-2026-0720 is a student, INV-1001 an invoice, and the
 * shape is the same because schools number things the same way.
 *
 * It is its own dimension because it identifies ONE record -- "show details of
 * student ADM-2026-0720" is a request for a record, not a search, and treating
 * it as free text answered with a list. Which record it names is decided by the
 * capability: a student tool declares `admissionNo`, a fee tool `invoiceNo`,
 * and a tool that declares neither cannot express the code at all.
 */
const ADMISSION_NO = /\b([A-Z]{2,6}[-/]\d{2,4}(?:[-/]\d{1,6})?|[A-Z]{2,6}-\d{1,6})\b/;

export function admissionNoFromText(text) {
  return ADMISSION_NO.exec(String(text ?? ''))?.[1] ?? null;
}

/**
 * A title or proper name the request is about, for capabilities that search.
 *
 * Quoted text first, then the longest run of capitalised words that is not a
 * class, a month, or the sentence's own opening verb. "Introduction to
 * Algorithms" and "Clean Code" are titles; "Class 5A", "September" and "Show"
 * are not.
 */
const TITLE_STOP = new Set([
  // Function words. "Do I owe any fees?" opens with two capitalised-looking
  // words and yielded the title "Do I", which was then written into a search
  // argument and matched nothing -- a filter nobody asked for, silently
  // turning a real answer into "no outstanding fees".
  'do', 'does', 'did', 'is', 'are', 'was', 'were', 'am', 'be', 'can', 'could',
  'should', 'would', 'will', 'shall', 'may', 'might', 'must', 'have', 'has',
  'had', 'a', 'an', 'and', 'or', 'but', 'if', 'it', 'this', 'that', 'there',
  'here', 'you', 'us', 'them', 'all', 'any', 'every', 'some', 'no', 'not',
  'class', 'grade', 'section', 'room', 'route', 'bed',
  'show', 'search', 'list', 'find', 'get', 'give', 'display',
  'add', 'create', 'new', 'update', 'edit', 'change', 'delete', 'remove', 'cancel',
  'issue', 'return', 'renew', 'approve', 'reject', 'request', 'allocate', 'assign',
  'vacate', 'apply', 'mark', 'record', 'enter', 'publish', 'send', 'notify', 'move',
  'enrol', 'enroll', 'submit', 'withdraw', 'grade', 'decide', 'review', 'reply', 'close', 'register', 'join',
  'how', 'when', 'what', 'why', 'who', 'which', 'where', 'i', 'my', 'we', 'please', 'the',
]);

export function titleFromText(text) {
  // A class reference is never part of a title. Taken out before the runs are
  // read, so "for Class 6-A: Science fair" does not yield the title
  // "A: Science" -- the section letter glued to what follows the colon.
  const raw = String(text ?? '');
  const spokenClass = classFromText(raw)?.text;
  const str = spokenClass ? raw.split(spokenClass).join(' , ') : raw;
  const quoted = /["“”']([^"“”']{2,120})["“”']/.exec(str)?.[1];
  if (quoted) return quoted.trim();

  const TITLE_ARTICLES = new Set(['the', 'a', 'an']);
  const runs = [...str.matchAll(/\b([A-Z][\w'-]*(?:(?:\s+(?:to|of|and|the|a|an|in|for|on|with|at|from)\b)+\s+[A-Z][\w'-]*|:\s+[A-Z][\w'-]*|\s+[A-Z][\w'-]*)*)/g)]
    .map((m) => m[1].trim())
    // The sentence's own opening verb is capitalised too. Dropping it here is
    // what makes "Add Clean Code" yield "Clean Code" rather than the whole run.
    .map((run) => {
      const parts = run.split(/\s+/);
      return (TITLE_STOP.has(parts[0].toLowerCase()) && !TITLE_ARTICLES.has(parts[0].toLowerCase())) ? parts.slice(1).join(' ') : run;
    })
    .filter((run) => {
      if (!run) return false;
      const parts = run.split(/\s+/);
      const first = parts[0].toLowerCase();
      if (TITLE_STOP.has(first) && !TITLE_ARTICLES.has(first)) return false;
      // A title has at least one substantial word in it, and no bare initials.
      if (!parts.some((w) => w.length >= 3)) return false;
      if (parts.every((w) => TITLE_STOP.has(w.toLowerCase()))) return false;
      if (monthFromText(run)) return false;
      if (classFromText(run)) return false;
      if (ADMISSION_NO.test(run)) return false;
      return true;
    });

  // The longest run: a title is the most specific thing in the sentence.
  const best = runs.sort((a, b) => b.length - a.length)[0];
  return best && best.split(/\s+/).length >= 2 ? best : null;
}

/**
 * The sentence without its opening instruction.
 *
 * "Vacate Diya Sharma's bed" opens with a capitalised verb, and a name reader
 * looking for capitalised words took the whole of "Vacate Diya Sharma" as the
 * person -- which then found nobody, so the request routed nowhere. The verb is
 * already accounted for separately (verbPositions), so removing it here loses
 * nothing and stops it being read twice.
 */
export function withoutLeadingVerb(text) {
  const str = String(text ?? '').trim();
  const first = str.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
  // An opening word that reads as an act is the verb too: "SCHEDULE a
  // calendar event" is about the calendar, and leaving the verb in made the
  // timetable (whose vocabulary has "schedule") the thing being refused.
  const isVerb = first && (TITLE_STOP.has(first) || detectOperation(first) !== 'GET');
  return isVerb && str.includes(' ') ? str.slice(str.indexOf(' ') + 1) : str;
}

/**
 * A capitalised run that is shaped like somebody's name.
 *
 * "Assign Diya Sharma to Room 101" names a person with no possessive and no
 * preposition to mark them, so the grammatical readers find nobody and the
 * request routed nowhere. Two or three capitalised words, letters only, is what
 * a name looks like; "Introduction to Algorithms" is not (its middle word is
 * lowercase) and neither is anything with a digit in it.
 *
 * It is offered as a candidate, never imposed: it only reaches a capability
 * that declares a student argument, and the tool re-resolves it at the
 * caller's own scope, where an unknown or ambiguous name is refused.
 */
function personShaped(run) {
  if (!run) return null;
  const words = String(run).trim().split(/\s+/);
  // A sentence opens with its verb, capitalised: "Generate Mathematics
  // homework" is an instruction, not a pupil called Generate Mathematics.
  // The verb is set aside and what follows judged on its own -- "Assign Diya
  // Sharma to Room 101" still names Diya Sharma.
  if (words.length && (detectOperation(words[0]) !== 'GET' || TITLE_STOP.has(words[0].toLowerCase()))) words.shift();
  if (words.length < 2 || words.length > 3) return null;
  return words.every((w) => /^[A-Z][a-z'-]+$/.test(w)) ? words.join(' ') : null;
}

/**
 * A name the sentence actually wrote as a name.
 *
 * "show my attendance for bananas" put "bananas" where a month goes, and the
 * name reader -- which accepts anything after "for" that is not a known word --
 * offered it as a student. A per-student capability then won, and a student
 * asking about their own attendance was asked about somebody called bananas.
 * People capitalise names; a word the writer left lowercase is not one.
 */
function capitalisedInText(name, text) {
  if (!name) return null;
  const first = String(name).split(/\s+/)[0];
  const escape = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // A capital ANYWHERE in the word, or a digit or underscore, is the writer
  // typing something on purpose rather than falling into a name-shaped slot.
  // "test_Stud" and "Aarav2" are names schools really hold; requiring an
  // initial capital said they were not, and the register could not be marked
  // for either. "bananas" -- the accident this test exists for -- has none of
  // these marks and is still refused.
  if (/\p{Lu}|[\d_]/u.test(first)) {
    return new RegExp(`\\b${escape(first)}\\b`, 'u').test(String(text)) ? name : null;
  }

  // Case-SENSITIVE on purpose: the question is whether the writer wrote it as
  // a name, and the capital is exactly what says so.
  const capitalised = first.charAt(0).toUpperCase() + first.slice(1);
  return new RegExp(`\\b${escape(capitalised)}\\b`).test(String(text)) ? name : null;
}

/**
 * The entities a SCHOOL SUBJECT can qualify.
 *
 * "Mathematics homework" and "marks in Mathematics" name a subject; "update
 * hostel room" does not, and reading one there took the word before the entity
 * -- "update" -- as the subject, which every hostel capability then failed to
 * express and was penalised for. A subject qualifies academic work, so it is
 * read only where academic work is what is being asked about.
 */
// An elective is a subject, and a co-curricular request names its activity the
// same way: "the Basketball activity", "the Robotics elective".
const SUBJECT_QUALIFIES = new Set(['marks', 'homework', 'attendance', 'subject', 'timetable', 'class', 'material', 'elective', 'studentRequest']);

function subjectOf(str) {
  // Read past the opening verb, for the same reason the entity is: "MARK
  // attendance for Class 5-A" put the verb where a school subject goes, and
  // every capability that could not express a subject was then penalised for
  // one nobody named.
  const spoken = withoutLeadingVerb(str);
  // Each entity the subject could qualify, until one yields it: "register me
  // for the Robotics elective" also reads as the attendance REGISTER, and
  // stopping at that first entity lost the elective's name.
  const qualifying = entitiesInText(spoken).filter((e) => SUBJECT_QUALIFIES.has(e));
  for (const [index, entity] of qualifying.entries()) {
    const found = subjectFromText(spoken, entity);
    if (!found) continue;
    // The first entity's reading stands as it always has. Reading on to a
    // LATER entity is what finds "Robotics" for the elective -- and it must
    // not take a word that names an entity of its own: in "child exam
    // schedule" the word before the timetable's "schedule" is "exam", which
    // is what the sentence is about, not a subject of it.
    if (index === 0 || !entitiesInText(found).length) return found;
  }
  return null;
}

/**
 * A day as the sentence WROTE it: "tomorrow", "friday", "day after tomorrow".
 *
 * Some capabilities take a calendar date (`^\d{4}-\d{2}-\d{2}$`) and some take
 * the word, resolving it themselves against the current date -- get_timetable
 * is the second kind, and writing an ISO date into it was silently wrong: the
 * word list it matches on does not contain dates, so it fell through to its
 * default and answered about TODAY under today's heading.
 *
 * So both forms are carried, and which one is written is decided by the
 * argument's own schema.
 */
const SPOKEN_DAY =
  /\b(day after tomorrow|today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

const spokenDayOf = (text) => SPOKEN_DAY.exec(String(text ?? ''))?.[1]?.toLowerCase() ?? null;

/**
 * A request for records of a school other than the caller's own.
 *
 * "Show students from another school" is not a request any capability can
 * express, and must never become one: the school is not an argument anywhere
 * in the catalogue -- it comes from the session, and the MCP server discards an
 * identity argument if one is sent. Left unread, the sentence scored as a plain
 * directory listing and was answered with the caller's OWN students, presented
 * as though they were the other school's.
 *
 * Grammar, not a list of schools: a preposition that says whose records
 * ("from", "of", "at", "in", "across") before "another/other/different/all
 * schools". "Transferred TO another school" is a statement about a student of
 * this school, and is not matched.
 */
// Also the possessive -- "another school's attendance" says whose records just
// as "attendance from another school" does, and was read as a pupil called
// "school" -- and any request to move the session itself to another school by
// naming its tenant: the tenant is never an argument, so there is no honest
// answer to "change tenant_id to X and show..." other than this refusal.
const OTHER_INSTITUTION =
  /\b(?:from|of|at|in|across|belonging\s+to)\s+(?:(?:an|some|any|a)\s+)?(?:other|another|different|every|all(?:\s+the)?|both(?:\s+the)?)\s+(?:schools?|institutions?|colleges?|campus(?:es)?|branch(?:es)?|tenants?)\b|\b(?:an?other|other|different)\s+(?:schools?|institutions?|colleges?|campus(?:es)?|branch(?:es)?|tenants?)['’]s?(?:\s|$)|\btenant[\s_-]?id\b|\b(?:switch|change|set)\s+(?:the\s+|my\s+)?(?:school|tenant)\b|\b(?:the\s+)?(?:entire|whole|full)\s+platform\b|\bacross\s+(?:the\s+)?platform\b|\bplatform[\s-]?wide\b|\bevery\s+school\b/i;

/**
 * "Change my address to 12 Park Street": which of the caller's own fields, and
 * to what. Grammar, not vocabulary -- the field is whatever the sentence names
 * after "my", and the capability decides whether it can hold it.
 */
const CHANGE_OF_MINE =
  /\b(?:change|update|correct|fix|edit|set)\s+my\s+([a-z][a-z' -]{1,40}?)\s+(?:to|as)\s+(.+?)[.?!]*\s*$/i;

/**
 * "Rename X to Y", "change the title of X to Y": the record's current name and
 * its new one. Two names, two destinations -- read as one title, the current
 * name was proposed as the "change" and the new one was lost.
 */
const RECORD_NOUN = String.raw`(?:course\s+material|study\s+material|material|document|handout|notes)`;
const RENAME = new RegExp(
  String.raw`\b(?:rename|retitle)\s+(?:the\s+)?(?:${RECORD_NOUN}\s+)?(.+?)\s+(?:to|as)\s+(.+?)[.!]?\s*$`, 'i',
);
const TITLE_CHANGE = new RegExp(
  String.raw`\b(?:change|update|edit|correct|fix|set|modify)\s+the\s+(?:title|name)\s+of\s+(?:the\s+)?(?:${RECORD_NOUN}\s+)?(.+?)\s+to\s+(.+?)[.!]?\s*$`, 'i',
);
const unquote = (s) => String(s ?? '').trim().replace(/^["'‘“]+|["'’”]+$/g, '').trim();

export function renameFromText(text) {
  const m = RENAME.exec(String(text ?? '')) ?? TITLE_CHANGE.exec(String(text ?? ''));
  if (!m) return null;
  const from = unquote(m[1]);
  const to = unquote(m[2]);
  return from && to ? { from, to } : null;
}

/**
 * A record named straight after its noun, in an instruction: "delete the course
 * material Test notes", "update the document Fractions notes". The name need
 * not be quoted or capitalised -- people type "Test notes" -- and it runs to
 * the end of the sentence or to the preposition that starts what follows ("for
 * Class 6-A"). Only for an instruction: "show course material for Class 6-A"
 * names no record.
 */
const NAMED_AFTER_NOUN = new RegExp(
  String.raw`\b${RECORD_NOUN}\s+(?!(?:for|to|in|on|of|from|with|about|that|which)\b)([\p{L}\p{N}][\p{L}\p{N}'’\- ]{1,80}?)(?=\s+(?:for|to|in|from)\b|[.!?]?\s*$)`, 'iu',
);

/**
 * A ticket is named by its headline, around its noun: "the Bus timing
 * ticket", "the ticket about bus timing". Whatever the sentence then SAYS --
 * after "saying" or a colon -- is the message, not the name.
 */
const THREAD_NOUN = String.raw`(?:ticket|query|complaint)`;
const NAMED_BEFORE_THREAD = new RegExp(String.raw`\bthe\s+([\p{L}\p{N}][\p{L}\p{N}'’\- ]{1,40}?)\s+${THREAD_NOUN}\b`, 'iu');
const THREAD_ABOUT = new RegExp(
  String.raw`\b${THREAD_NOUN}\s+(?:about|regarding|on)\s+(.+?)(?=\s+(?:saying|that\s+says)\b|\s*:|[.!?]?\s*$)`, 'iu',
);

function recordNamedAfterNoun(text) {
  const str = String(text ?? '').trim();
  const first = str.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
  if (!first) return null;
  // An instruction, by the coarse verb table or by a verb the catalogue names
  // a write after ("reply", "approve").
  const acts = detectOperation(first) !== 'GET'
    || [...(verbIndex().get(stem(first)) ?? [])].some((op) => op !== 'GET');
  if (!acts) return null;
  const head = str.split(':')[0];
  const name = (NAMED_AFTER_NOUN.exec(head) ?? THREAD_ABOUT.exec(head) ?? NAMED_BEFORE_THREAD.exec(head))?.[1]?.trim();
  return name && !/^(?:the|this|that|my|a|an|your|his|her)$/i.test(name) ? name : null;
}

export function changeFromText(text) {
  const m = CHANGE_OF_MINE.exec(String(text ?? ''));
  return m ? { what: m[1].trim(), to: m[2].trim().replace(/^["'“”]|["'“”]$/g, '') } : null;
}

/** A string as a literal inside a regular expression. */
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function asksBeyondOwnSchool(text) {
  return OTHER_INSTITUTION.test(String(text ?? ''));
}

/** Everything the sentence names, in the dimensions capabilities are declared in. */
export function dimensionsOf(text, now = new Date()) {
  const str = String(text ?? '');
  // Dates are read from OUTSIDE quotation marks. Quoted text is the person's
  // own words -- an announcement titled "Holiday tomorrow" is not a request
  // about tomorrow -- and reading a filter out of it penalised every
  // capability that could not express a date nobody was asking to filter by.
  const unquoted = str.replace(/["“”']([^"“”']{2,500})["“”']/g, ' ');
  // A day written in words is read FIRST, and its span taken out before
  // anything reads the sentence for a month or a range. "On 5th August 2026"
  // names one day; the "August 2026" inside it is part of that day, and
  // reading it as a month answered with the whole of August. Two written dates
  // are the two ends of a range.
  const written = writtenDatesIn(unquoted, now);
  const undated = written.reduce((rest, w) => rest.split(w.text).join(' '), unquoted);
  // The new value in "change my address to 12 Park Street" is data. Read for
  // names and titles it became a book called "Park Street", and every
  // capability that could not hold a title was penalised for it.
  const change = changeFromText(str);
  const rename = renameFromText(str);
  // A pasted link is data too -- and its "https:" reads as a colon that
  // introduces a topic, which made the tail of a URL an assignment's title.
  const link = /\bhttps?:\/\/[^\s"'<>]+/i.exec(str)?.[0]?.replace(/[.,;)]+$/, '') ?? null;
  const named = [change?.to, rename?.to, link].filter(Boolean).reduce((rest, span) => rest.split(span).join(' '), str);

  const range = written.length >= 2
    ? {
      from: written[0].iso,
      to: written[written.length - 1].iso,
      // No year written: the dates were placed in the most recent past, which
      // is right for a question and wrong for an instruction -- see the scorer.
      ...(!written.some((w) => w.yearGiven) && { yearless: true }),
    }
    : rangeFromText(undated, now);
  const admissionNo = admissionNoFromText(str);

  // Identity is read FIRST, and the subject is read from what is left.
  //
  // A span can only be one thing. "Mark Rahul Sharma absent today" was read as
  // naming a person AND a school subject called "Sharma", because the subject
  // rule -- the word before the entity word -- fell on the surname. Every
  // attendance capability was then penalised for not being able to express a
  // subject nobody had named, which is how the sentence finished below the
  // floor. Removing what the identity dimensions already claimed is the same
  // rule the entity tier uses (see rank), applied one step earlier.
  const identity = {
    class: classFromText(str)?.text ?? null,
    admissionNo,
    student: admissionNo ? null : capitalisedInText(nameFromText(withoutLeadingVerb(named)), named)
      ?? personShaped(titleFromText(named)),
    numbered: numberedThingFromText(str),
    // Spans that are dates, so nothing reads them a second time as a subject,
    // a topic or a number ("5th" is not period five).
    writtenDates: written.map((w) => w.text),
    range,
    link,
  };

  return {
    class: identity.class,
    admissionNo,
    // A name and an admission number identify the same thing; carrying both
    // would score one request twice.
    student: identity.student,
    // True when the only evidence of a person IS the capitalised run that is
    // also the title candidate. "Return the overdue Harry Potter book" then
    // does not become a request about a student called Harry Potter: a
    // capability that can hold a title takes it as one.
    // Main's reading (a book title that is also the name read out of the
    // sentence is a person), over `named` -- the sentence with a requested
    // new value and any link taken out, so neither is read as a name.
    personFromTitle: !admissionNo && (
      (!nameFromText(withoutLeadingVerb(named)) && Boolean(personShaped(titleFromText(named))))
      || Boolean(
        titleFromText(withoutLeadingVerb(named)) &&
        identity.student &&
        titleFromText(withoutLeadingVerb(named)).toLowerCase() === identity.student.toLowerCase() &&
        // Grammar that says the run is a PERSON, not a book: a possessive, an
        // introducing noun, a preposition, a register status -- or a number
        // of marks given to them ("Give Rahul Sharma 8 marks"), the same
        // evidence peopleNames.nameFromText() reads a person from.
        !/['’]s\b|\b(?:student|pupil|child|borrower|resident)\s+|\b(?:of|for|to)\s+|(?:\bas\s+)?\b(?:absent|present|late|excused)\b|\b\d{1,3}(?:\.\d{1,2})?\s*(?:marks?|points?)\b/i.test(str)
      )
    ),
    numbered: identity.numbered,
    month: range || written.length ? null : monthFromText(undated, now),
    range,
    writtenDates: identity.writtenDates,
    date: range ? null : dateFromText(unquoted, now),
    spokenDay: range ? null : spokenDayOf(unquoted),
    // Read past the opening verb, for the reason the entity and the subject
    // are: "Generate Mathematics homework ..." puts the verb inside the
    // capitalised run, and "Generate Mathematics" was then offered as the
    // title of the homework -- and, being two capitalised words, as a person.
    //
    // A person named with a possessive owns the thing; they are not part of
    // its title. "Grade Priya Verma's Mathematics submission" proposed a
    // submission titled "Priya Verma's Mathematics".
    //
    // When the span was already claimed by grammatical evidence as a person,
    // it is not a title. With no capitalised title at all, a record named
    // straight after its noun ("the course material Test notes") is one.
    title: rename?.from ?? (() => {
      const candidate = titleFromText(withoutLeadingVerb(
        identity.student ? named.split(new RegExp(`${escapeRe(identity.student)}['’]s\\b`, 'g')).join(' ') : named,
      ));
      if (!candidate) return recordNamedAfterNoun(named);
      const personFromGrammar = Boolean(admissionNo || nameFromText(withoutLeadingVerb(named)));
      if (personFromGrammar && identity.student && candidate.toLowerCase() === identity.student.toLowerCase()) {
        return null;
      }
      return candidate;
    })(),
    // A record's current name and its new one; see the scorer.
    rename,
    // The school subject a request is about. Read with the same grammar rule
    // the entity tier uses -- a subject sits just before the entity word, or
    // is introduced by "in"/"for" -- so both tiers understand "Mathematics
    // homework" identically, and a write resolved here does not lose what a
    // read resolved there would have kept.
    subject: subjectOf(residualMessage(str, identity)),
    // What the thing being created is about. Read from what the identity
    // dimensions have NOT already claimed, for the reason the subject is:
    // "show information about Rahul Sharma" says "about", and reading the
    // person's name as a topic docked the student's own record six points for
    // having no `topic` argument -- one span answering as two dimensions.
    topic: topicFromText(residualMessage(str, identity)),
    // A threshold somebody stated. Unlike the others this is matched to an
    // argument by its KIND rather than its name (see argumentKinds.js), because
    // "below 75%" is a fact about the number, not about what any tool calls it.
    // Without it, "which students are below 75% attendance" scored as an
    // ordinary student search -- which cannot express a threshold, and quietly
    // answered with the whole directory.
    percentage: /\b\d{1,3}\s?%/.test(str) ? Number(/\b(\d{1,3})\s?%/.exec(str)[1]) : null,
    self: asksAboutSelf(str),
    possessedSet: POSSESSED_SET.test(str) && !POSSESSED_INSTITUTION.test(str),
    aggregate: AGGREGATE_REQUEST.test(str),
    // A request that names one record is not asking for a list, whatever verb
    // introduced it: "show details of student ADM-2026-0720" is a record, and
    // so is "show Rahul's performance". Counting those as list requests
    // penalised every capability that returns ONE record -- which is exactly
    // the kind a named record calls for -- and let unrelated list capabilities
    // draw level with it.
    list: LIST_REQUEST.test(str) && !admissionNo && !nameFromText(withoutLeadingVerb(str)),
    searching: SEARCH_REQUEST.test(str) && !admissionNo,
    quoting: CONTENT_REQUEST.test(str),
    // Asked for one record in full. Not a list request at the same time: the
    // two describe different answers, and LIST_REQUEST already stands aside
    // for a sentence that names one record.
    detail: DETAIL_REQUEST.test(str),
    // "What profile fields CAN I CHANGE?" asks which fields may be changed --
    // a read. Reading "can I change" as a request to change something ruled
    // out the capability that answers it.
    requestMood: !WH_QUESTION.test(str) && REQUEST_MOOD.some((re) => re.test(str)),
    otherInstitution: asksBeyondOwnSchool(str),
    change,
    // A link somebody pasted: the work being submitted, a reference.
    link,
  };
}

/**
 * The argument names each dimension can be written as, in order of preference.
 *
 * Intersected with what a capability actually accepts, so the same dimension is
 * `className` on one tool and simply not offered to a tool that has neither.
 * Identifier-shaped arguments are excluded by the scorer: a sentence carries a
 * name, never an ObjectId, and writing one would be inventing a record.
 *
 * Deliberately NOT routed through `query`/`search` except where the value
 * really is free text. Feeding "Class 5A" to a student-name search is how
 * "outstanding fees for Class 5A" came back as a school-wide figure with a
 * filter that matched nothing.
 */
const ARG_NAMES = {
  class: ['className', 'class', 'grade', 'query'],
  admissionNo: ['admissionNo', 'invoiceNo', 'receiptNo', 'code'],
  student: ['studentName', 'query', 'search'],
  numbered: ['roomNo', 'roomNumber', 'bedNo', 'routeName', 'number', 'code'],
  // `name` second: a co-curricular activity is named, not given a subject.
  subject: ['subject', 'name'],
  month: ['month', 'period'],
  range: ['from', 'to'],
  date: ['date', 'day', 'on', 'dueAt', 'activityDate'],
  // `subject` last, and only where it is a headline (a ticket's) rather than a
  // school subject -- see acceptsDimension().
  title: ['title', 'query', 'search', 'name', 'stopName', 'subject'],
  // What something is ABOUT, which is not the same as what it is CALLED. Read
  // with the grammar that introduces one -- "about X", "on X", a colon, a
  // quotation -- rather than from the capitalised run a title comes from,
  // because "Generate Mathematics homework about linear equations" has its
  // capitalised run in the verb and its topic at the end.
  //
  // `title` is offered second because for much of the catalogue they are the
  // same words: "create Mathematics homework for Class 5-A: solve the linear
  // equations examples" gives the task, and the capability that simply SETS
  // homework keeps it as the title while the one that DRAFTS it keeps it as
  // the topic. Docking the first for having no `topic` sent a plain creation
  // to the AI drafter.
  topic: ['topic', 'title'],
  // Filled by kind, not by name — see percentageArgOf().
  percentage: [],
  // A field and its new value; written as a pair, see the scorer.
  change: [],
  rename: [],
  link: [],
};

/**
 * The entity one word denotes, or null.
 *
 * Reads the same vocabulary the sentence is read with, so "assignment" and
 * "homework" answer alike without anything restating that they are the same
 * thing. Memoised: the vocabulary is fixed once the registry is built, and
 * this is asked once per tool-name noun per scored capability.
 */
const ENTITY_OF_WORD = new Map();
function entityOfWord(word) {
  if (!ENTITY_OF_WORD.has(word)) ENTITY_OF_WORD.set(word, entitiesInText(String(word))[0] ?? null);
  return ENTITY_OF_WORD.get(word);
}

const isoToday = (now) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const nextYear = (iso) => `${Number(iso.slice(0, 4)) + 1}${iso.slice(4)}`;

/** The two ends of a period, under the names tools actually use. */
export const RANGE_PAIRS = [['from', 'to'], ['fromDate', 'toDate'], ['startDate', 'endDate'], ['startsOn', 'endsOn']];

/**
 * True when a range is exactly one calendar month. Only then can a capability
 * that takes a `month` answer it: "this week" falls inside September, and
 * answering it with the whole of September is a wider answer than was asked.
 */
export function isWholeWeek(range) {
  const from = new Date(`${range?.from}T00:00:00Z`);
  const to = new Date(`${range?.to}T00:00:00Z`);
  return from.getUTCDay() === 1 && (to - from) / 86_400_000 === 6;
}

export function isWholeMonth(range) {
  const bounds = monthBounds(String(range?.from ?? '').slice(0, 7));
  return Boolean(bounds && bounds.from === range.from && bounds.to === range.to);
}

export function rangeArgsOf(properties) {
  return RANGE_PAIRS.find(([a, b]) => properties.includes(a) && properties.includes(b)) ?? null;
}

/** The argument a stated threshold belongs in, whatever the tool calls it. */
function percentageArgOf(capability) {
  const properties = capability.schema?.properties ?? {};
  return Object.entries(properties).find(([name, schema]) => kindOfProperty(name, schema) === 'percentage')?.[0] ?? null;
}

/**
 * Free-text arguments a dimension may legitimately be written into.
 *
 * `query` on search_students documents that it accepts a class; `search` on
 * the fee tools documents that it accepts a student or an invoice number.
 * Writing "Class 5A" into the second matches nothing and turns a question
 * about one class into a school-wide answer with a filter that silently found
 * nothing -- which is worse than refusing, because it looks like an answer.
 *
 * So a dimension enters a general-purpose argument only when that argument's
 * OWN description says it takes one. The schema stays the single statement of
 * what an argument accepts, and no tool is named here.
 */
const GENERAL_PURPOSE_ARGS = new Set(['query', 'search']);

const DIMENSION_WORDS = {
  class: /\bclass|\bgrade|\bsection/i,
  student: /\bstudent|\bname|\badmission|\bpupil/i,
  admissionNo: /\badmission|\bstudent/i,
  numbered: /\broom|\broute|\bbus|\bnumber/i,
  title: /\btitle|\bauthor|\bisbn|\bcatalog|\bsearch|\bname/i,
};

/**
 * "Issue Clean Code to Rahul" -- an item, and the person it goes to.
 *
 * The capitalised-run reader cannot tell that apart from "Introduction to
 * Algorithms", where the "to" is part of the title, so it yields the whole run
 * either way. What decides it is the CAPABILITY: one that holds both a title
 * and a student is a lending, and a "to" inside its argument is a recipient.
 * One that holds only a title has nobody to give anything to, so the run stays
 * whole. Derived from the schema, so no sentence and no tool is named here.
 */
const DATIVE = /^(.*\S)\s+to\s+([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)?)\s*$/;

function splitRecipient(title) {
  const m = DATIVE.exec(String(title ?? '').trim());
  return m ? { title: m[1], student: m[2] } : null;
}

function acceptsDimension(capability, argName, dimension) {
  // A record's name is a ticket's headline, never a school subject: "Unit
  // Test 2" must not become the subject of a marks question.
  if (argName === 'subject' && dimension === 'title') {
    return !namesARecord(capability, 'subject', { type: 'string' });
  }
  if (!GENERAL_PURPOSE_ARGS.has(argName)) return true;
  const described = capability.schema?.properties?.[argName]?.description ?? '';
  const words = DIMENSION_WORDS[dimension];
  return Boolean(words && words.test(described));
}

/* ── Scoring ──────────────────────────────────────────────── */

const WEIGHT = {
  ENTITY_MATCH: 6,
  ENTITY_MISMATCH: -4,
  NOUN_MATCH: 4,
  NOUN_ABSENT: -3,
  VERB_MATCH: 6,
  READ_VERB_DEFAULT: 2,
  OPERATION_MATCH: 3,
  OPERATION_MISMATCH: -7,
  TARGET_FILLED: 3,
  FILTER_FILLED: 2,
  /** The rule that stops a narrow request being answered broadly. */
  SPECIFICITY_PENALTY: -6,
  ABOUT_NOTHING_NAMED: -5,
  ARGUMENT_MATCH: 2,
  ARGUMENT_CAP: 4,
  DESCRIPTION_MATCH: 1,
  DESCRIPTION_CAP: 4,
  SHAPE_MATCH: 3,
  SHAPE_MISMATCH: -3,
  SELF_MATCH: 4,
  SELF_MISMATCH: -4,
  SCHOOL_WIDE_QUESTION: 3,
};

/**
 * Arguments that make a capability about a GROUP rather than a person.
 *
 * This is the signal entityIntent.js recorded as missing: nothing in the
 * registry says whose record a capability answers about, and `minScope`
 * describes the permission required, not the subject of the answer. It turns
 * out the schema does say, in the only way that matters -- a capability that
 * takes a class is about a class.
 *
 * Without it "show my attendance" scored the class ROSTER above the caller's
 * own summary: both are about attendance, both are reads, and the roster's
 * answer is a list, which a sentence beginning "show" faintly asks for. A
 * student would have been shown a register.
 */
const GROUP_ARGS = ['className', 'sectionId', 'gradeId', 'grade'];

/** The floor a winner must clear, and the lead it must hold over the runner-up. */
export const MIN_SCORE = 8;
export const MIN_MARGIN = 3;

/**
 * The score above which a match is acted on without a second opinion.
 *
 * Between MIN_SCORE and this, a capability fits better than anything else but
 * on thin evidence -- one entity word, no verb, nothing named. "How many days
 * was I in class in bananas?" is the worked example: the only domain word in
 * it is "class", so the class list wins, and a student asking about their
 * attendance would be told how many sections they are in.
 *
 * A match below this is TENTATIVE. It is still returned, because a tentative
 * answer beats no answer on a deployment with no model; but the pattern rules
 * are given first refusal, and where a model is configured it is asked. That
 * is what a model is for -- the sentences the deterministic tier cannot read
 * confidently -- and it is a much better use of it than the ones it can.
 */
export const CONFIDENT_SCORE = 14;

/** Which capability operations can satisfy a request of each kind. */
export const OPERATION_FAMILY = {
  GET: ['GET'],
  CREATE: ['CREATE', 'ACTION'],
  UPDATE: ['UPDATE', 'ACTION'],
  DELETE: ['DELETE', 'ACTION'],
  // CREATE included deliberately, and for the reason the registry already
  // gives in the other direction: whether a tool is a CREATE or an ACTION is a
  // distinction about implementation, not about what was asked for.
  // `generate_homework` is an ACTION and `create_assignment` a CREATE, and
  // "add homework" means either. So does "SEND an announcement", which is one
  // act -- writing it and publishing it -- and which reached the capability
  // that EDITS an existing announcement while the one that creates it was
  // ruled out for being declared a CREATE.
  ACTION: ['ACTION', 'UPDATE', 'CREATE'],
};

/**
 * Whether a capability performs one of the operations asked for.
 *
 * The family above, with the one exception it cannot express: an ACTION is a
 * task, and which tasks can stand in for a change or a removal depends on what
 * the task IS. Taking every ACTION as a possible DELETE answered "delete the
 * test homework" with generate_homework -- a request to remove work, proposed
 * as a request to write more -- and, because a homework ACTION existed, the
 * true answer ("deleting homework is not offered") was never given. So an
 * ACTION stands in for a DELETE only when its own verb removes something, and
 * for an UPDATE only when its verb does not create something new.
 */
export function performsAsked(capability, asked) {
  const operations = asked instanceof Set ? [...asked] : [].concat(asked ?? []);
  return operations.some((op) => {
    if (!(OPERATION_FAMILY[op] ?? [op]).includes(capability?.operation)) return false;
    if (capability.operation !== 'ACTION' || op === 'ACTION' || op === 'CREATE') return true;
    const verbReads = detectOperation(nameParts(capability.name).verb ?? '');
    return op === 'DELETE' ? verbReads === 'DELETE' : verbReads !== 'CREATE';
  });
}

/**
 * What the sentence asks to be DONE, from the verbs the catalogue itself uses.
 *
 * A verb is meaningful here only because some capability is named after it, so
 * a new capability widens this by existing. Where the message names no such
 * verb the request is a read, which is the safe default: proposing a write for
 * a sentence with no verb in it is how an assistant does something nobody asked
 * for.
 */
export function operationsNamed(verbCandidates, verbs, { requestMood = false, message = '' } = {}) {
  const operations = new Set();
  for (const [verb, ops] of verbs) {
    if (!verbCandidates.has(verb) || READ_VERBS.has(verb)) continue;
    // A GENERIC verb means its own operation, whatever the catalogue happens to
    // declare under that name: "update" is an UPDATE even though one update_
    // tool is an ACTION, and letting that ACTION through made "update the
    // homework deadline" a request any task could answer -- generate_homework
    // did. The catalogue's declarations decide only for the SPECIFIC verbs
    // ("mark", "publish", "approve"), which have no generic meaning to read.
    const coarse = detectOperation(verb);
    if (coarse !== 'GET') operations.add(coarse);
    else for (const op of ops) operations.add(op);
  }
  if (operations.size) return operations;

  // No tool is named after "assign", but a school says "assign Diya Sharma to
  // Room 101" and means the same as "allocate". The coarse verb-stem
  // classification the codebase already keeps (entityIntent.detectOperation)
  // says what KIND of thing is being asked for when no catalogue verb matched.
  //
  // Only for an IMPERATIVE, though -- a sentence that opens with the verb.
  // "What is my child's exam SCHEDULE?" contains a stem that table reads as a
  // write, and treating the noun as the request's verb ruled out every read,
  // so a question about an exam timetable reached nothing at all.
  // "Give me my complete profile" opens with a verb the stem table reads as a
  // write -- and it is a read, because what follows it is "me". A verb
  // governing the speaker is a request to be shown something, never to create
  // one, and treating it as a write ruled out every read capability.
  if (/^\s*(?:please\s+)?[a-z]+\s+(?:me|us)\b/i.test(String(message ?? ''))) return operations;

  const opensWithAVerb = /^\s*(?:please\s+)?[a-z]+/i.exec(String(message ?? ''))?.[0]?.trim();
  const coarse = opensWithAVerb ? detectOperation(opensWithAVerb) : 'GET';
  if (coarse && coarse !== 'GET') operations.add(coarse);
  if (!operations.size && requestMood) operations.add('CREATE');
  return operations;
}

/**
 * How well one capability fits the request, and the arguments it would run with.
 *
 * Every term is derived from declared metadata. Nothing here knows the name of
 * a capability, a role or a phrase.
 */
export function scoreCapability(
  capability,
  { verbCandidates, tokens, entities, subjects, implied = null, named, wantedOperations, now = new Date() },
) {
  const args = {};
  let score = 0;
  const why = [];
  let targetsFilled = 0;

  const add = (points, reason) => {
    score += points;
    if (points) why.push(`${reason} ${points > 0 ? '+' : ''}${points}`);
  };

  const properties = capability.properties ?? [];
  const ids = new Set(capability.ids ?? []);

  /* Entity: what the request is ABOUT, as opposed to what it merely mentions.
     "Outstanding fees for Class 5A" names two entities, and only one of them is
     the subject -- the other is the target. Reading them alike made a fee
     question resolve to a capability about classes. */
  if (subjects.includes(capability.entity)) add(WEIGHT.ENTITY_MATCH, `entity:${capability.entity}`);
  // Weaker than a word and stronger than a mention, because that is what it
  // is: the sentence named a person, which says what the question is about
  // only as long as it names nothing else. At FULL credit every capability
  // about students drew level with the one the sentence really named -- "show
  // Rahul's performance" ended a margin away from the student record and was
  // answered with neither. At half, the reverse: "show the details of Arnav
  // Patel" could not separate the student's record from the facets of it.
  else if (implied === capability.entity) {
    add(Math.round((WEIGHT.ENTITY_MATCH * 2) / 3), `entity:${capability.entity} implied by the name`);
  } else if (entities.includes(capability.entity)) add(Math.round(WEIGHT.ENTITY_MATCH / 3), `entity:${capability.entity} mentioned`);
  else if (entities.length) add(WEIGHT.ENTITY_MISMATCH, `entity:${capability.entity} not named`);

  /* The tool's own words. */
  const { verb, nouns, self } = nameParts(capability.name);

  // A SYNONYM IS NOT AN ABSENCE -- where the sentence asked for this act by name.
  //
  // "Create Mathematics homework for Class 5-A" says homework, and
  // create_assignment says assignment: one thing under two words, which the
  // entity vocabulary already treats as one (both read as `homework`). Docking
  // the capability for the word the writer did not happen to choose left it a
  // single point ahead of the AI DRAFTING tool -- inside the margin, so the
  // request was answered as tentative.
  //
  // Narrow on purpose, and this is the important part. It applies only when
  // the sentence used THIS capability's own verb and that verb is not a
  // reading word: "CREATE homework" asks to create, and what it names is what
  // create_assignment creates. Without that condition the rule reached every
  // read capability whose entity anybody had mentioned -- "show seat summary"
  // stopped docking get_dashboard for the word "dashboard" nobody said, which
  // drew it level with the capability that had been asked for by name and
  // turned a plain request into a request for clarification.
  const askedByVerb = Boolean(verb && verbCandidates.has(verb) && !READ_VERBS.has(verb));
  // A LONGER NAME IS NOT A WORSE FIT.
  //
  // The penalty is per noun, so a two-word name is docked twice for a sentence
  // that used neither word. "What is scheduled for today?" is about the
  // calendar and says so -- the entity is matched outright -- but
  // get_calendar_events lost six points for saying neither "calendar" nor
  // "event", which left it a point below the floor and the question
  // unanswered. Where the sentence named what the capability is ABOUT, the
  // most that absent words can say is that it used different ones, so the
  // total is capped at a single absence. A capability whose entity was NOT
  // named is unaffected: there the nouns are the only evidence there is.
  const aboutThis = subjects.includes(capability.entity);
  let absentNouns = 0;
  let matchedANoun = false;
  for (const noun of nouns) {
    if (spoke(tokens, noun)) {
      add(WEIGHT.NOUN_MATCH, `noun:${noun}`);
      matchedANoun = true;
    } else if (askedByVerb && aboutThis && entityOfWord(noun) === capability.entity) {
      add(0, `noun:${noun} said another way`);
    } else absentNouns += WEIGHT.NOUN_ABSENT;
  }
  if (absentNouns) {
    // Capped only when NONE of the tool's words was used. Then the absence
    // says one thing -- the sentence called it something else -- however many
    // words the name has. Where SOME word matched and others did not, the
    // missing ones are what make this capability narrower than what was asked
    // for: "show me the list of students" matches the noun in
    // get_at_risk_students and not "risk", and "risk" is the whole difference.
    add(aboutThis && !matchedANoun ? Math.max(absentNouns, WEIGHT.NOUN_ABSENT) : absentNouns, 'nouns absent');
  }
  if (verb && verbCandidates.has(verb) && !READ_VERBS.has(verb)) add(WEIGHT.VERB_MATCH, `verb:${verb}`);
  else if (READ_VERBS.has(verb) && !wantedOperations.size) add(WEIGHT.READ_VERB_DEFAULT, 'read verb');

  /* The arguments it declares, as words.

     "Add Clean Code, ISBN 9780132350884, with 3 copies" names no library and
     no book, so nothing above it says what the request is about -- but it
     names an ISBN and a number of copies, and exactly one capability in the
     catalogue declares `isbn` and `totalCopies`. What a capability can ACCEPT
     is evidence about what is being asked for. Capped, and never negative: an
     argument the sentence does not mention says nothing either way. */
  let fromArguments = 0;
  // Counted once per WORD, not once per property. `studentId`, `studentName`
  // and `admissionNo` are three spellings of one idea, and scoring each of
  // them separately let a capability that merely accepts a student outscore
  // the one that answers about students.
  const countedArguments = new Set();
  for (const property of properties) {
    for (const word of String(property).split(/(?=[A-Z])/)) {
      const token = stem(word);
      // `studentId` on a student capability says nothing the noun "student"
      // has not already said. Counting it twice made every per-student
      // capability outrank the one that answers about students in general.
      if (token.length < 3 || !tokens.has(token)) continue;
      if (nouns.includes(token) || token === stem(capability.entity)) continue;
      if (countedArguments.has(token)) break;
      countedArguments.add(token);
      fromArguments += WEIGHT.ARGUMENT_MATCH;
      break;
    }
  }
  if (fromArguments) add(Math.min(fromArguments, WEIGHT.ARGUMENT_CAP), 'arguments named');

  /* The capability's own description, as a weak tie-breaker. */
  const described = lexiconOf(capability);
  let fromDescription = 0;
  for (const token of tokens) {
    if (!nouns.includes(token) && described.has(token)) fromDescription += WEIGHT.DESCRIPTION_MATCH;
  }
  if (fromDescription) add(Math.min(fromDescription, WEIGHT.DESCRIPTION_CAP), 'description');

  /* Operation. */
  const asked = wantedOperations.size ? [...wantedOperations] : ['GET'];
  if (performsAsked(capability, asked)) add(WEIGHT.OPERATION_MATCH, `operation:${capability.operation}`);
  else add(WEIGHT.OPERATION_MISMATCH, `operation:${capability.operation} not asked`);

  /* Dimensions the sentence named. */
  const filled = new Set();

  // Resolved per capability, because only the capability can say whether a
  // "to" in a title is part of the title or the person it is going to.
  const recipient = named.title && properties.includes('title') && properties.includes('studentName')
    ? splitRecipient(named.title)
    : null;
  const dimensions = {
    ...named,
    ...(recipient && { title: recipient.title, student: recipient.student, personFromTitle: false }),
  };

  for (const [dimension, value] of Object.entries(dimensions)) {
    if (!value || !ARG_NAMES[dimension]) continue;
    // The one capitalised run is a title here, not a person: a capability that
    // can hold it as a title does.
    if (dimension === 'student' && dimensions.personFromTitle && properties.includes('title')) continue;

    // ONE SPAN, ONE DIMENSION -- the converse of the line above.
    //
    // "Show the details of Arnav Patel" carries one capitalised run, and both
    // the person reader and the title reader claim it. A capability that has
    // already taken it as the STUDENT was then penalised a second time for
    // having no `title` argument to put the same two words in. That is how the
    // student-detail capability finished below a directory search, which has a
    // free-text `query` and could hold both. A phrase accounted for once is
    // accounted for.
    if (dimension === 'title' && filled.has('student') && value === dimensions.student) continue;

    // A link goes where a capability declares one, and is never a penalty
    // elsewhere: a URL in a sentence says nothing about which act was meant.
    if (dimension === 'link') {
      const into = ['link', 'url'].find((n) => properties.includes(n));
      if (into) {
        args[into] = value;
        filled.add('link');
        add(WEIGHT.FILTER_FILLED, `link -> ${into}`);
      }
      continue;
    }

    // A field and its new value go into a capability that holds both, and
    // nowhere else. Never a penalty: "change my pickup point to Gandhi Nagar"
    // is said to the transport request, which holds a stop, not a field.
    if (dimension === 'change') {
      if (properties.includes('field') && properties.includes('value')) {
        args.field = value.what;
        args.value = value.to;
        filled.add('change');
        targetsFilled += 1;
        add(WEIGHT.TARGET_FILLED, 'change -> field, value');
      }
      continue;
    }

    // A record's current name and its new one go into a capability that takes
    // a new name beside the identifying one, and are never a penalty
    // elsewhere. The current name is also the `title` dimension, which fills
    // the identifying argument on its own.
    if (dimension === 'rename') {
      if (properties.includes('newTitle') && properties.includes('title')) {
        args.title ??= value.from;
        args.newTitle = value.to;
        filled.add('rename');
        add(WEIGHT.FILTER_FILLED, 'rename -> title, newTitle');
      }
      continue;
    }

    if (dimension === 'range') {
      // A range needs both ends, or it is not a range the tool can honour --
      // under whichever pair of names the tool gives them. Leave is
      // `fromDate`/`toDate`, and "apply for leave from 5 to 7 October" was
      // declined as a range no capability could express.
      const pair = rangeArgsOf(properties);
      if (pair) {
        // "Apply for leave from 5 October to 7 October", said in September,
        // means the coming October. A yearless date defaults to the most
        // recent past -- right for "attendance on 5 October", wrong for an
        // instruction, which is about a date still to come.
        const ahead = capability.operation !== 'GET' && value.yearless && value.from < isoToday(now)
          ? nextYear
          : (d) => d;
        args[pair[0]] = ahead(value.from);
        args[pair[1]] = ahead(value.to);
        filled.add('range');
        add(WEIGHT.FILTER_FILLED, 'range');
      } else if (properties.includes('day') && isWholeWeek(value)
        && /\bweek\b/i.test(String(capability.schema?.properties?.day?.description ?? ''))) {
        // A capability whose `day` says it takes the week (the timetable) is
        // asked for the week, rather than refused for not taking a range.
        args.day = 'week';
        filled.add('range');
        add(WEIGHT.FILTER_FILLED, 'range as week');
      } else if (properties.includes('month') && isWholeMonth(value)) {
        args.month = value.from.slice(0, 7);
        filled.add('range');
        add(WEIGHT.FILTER_FILLED, 'range as month');
      } else {
        add(WEIGHT.SPECIFICITY_PENALTY, 'cannot express the range asked for');
      }
      continue;
    }

    let spoken = dimension === 'numbered' ? value.value : value;
    const argName = dimension === 'percentage'
      ? percentageArgOf(capability)
      : ARG_NAMES[dimension].find(
        (n) => properties.includes(n) && !ids.has(n) && acceptsDimension(capability, n, dimension),
      );

    // ONE DAY IS A RANGE OF ONE DAY.
    //
    // The counterpart of "range as month" above: some capabilities describe a
    // period with `from` and `to` and have no single-date argument at all, and
    // the school calendar is one of them. "What is scheduled for day after
    // tomorrow?" therefore lost six points for naming a day the capability
    // that answers it was said to be unable to express -- when expressing it
    // is simply a matter of both ends being the same day.
    if (!argName && dimension === 'date' && properties.includes('from') && properties.includes('to')) {
      args.from = value;
      args.to = value;
      filled.add('date');
      add(WEIGHT.FILTER_FILLED, 'date as a one-day range');
      continue;
    }

    if (!argName) {
      // A person GUESSED from a capitalised run is not something to dock a
      // capability for. `personFromTitle` says the only evidence of a person
      // is a run that could equally be a title, and "Generate Mathematics
      // homework ..." is exactly that: the run is "Generate Mathematics".
      // Capabilities holding a title were already excused above; this excuses
      // the ones holding neither, which were being penalised six points for
      // failing to express somebody nobody had named.
      if (dimension === 'student' && dimensions.personFromTitle) continue;
      add(WEIGHT.SPECIFICITY_PENALTY, `cannot express the ${dimension} asked for`);
      continue;
    }
    // A day written into an argument that is not date-shaped goes in as the
    // word, because that is what such a tool resolves. The schema decides.
    if (dimension === 'date' && dimensions.spokenDay) {
      const shape = capability.schema?.properties?.[argName];
      if (kindOfProperty(argName, shape ?? {}) !== 'date') spoken = dimensions.spokenDay;
    }

    // One span, one ARGUMENT. `topic` and `title` can both land in `title`,
    // and whichever was read first is the one kept: overwriting it would let
    // the weaker reading of the sentence replace the stronger.
    if (args[argName] !== undefined) continue;

    args[argName] = spoken;
    filled.add(dimension);
    // TARGET_ARGS groups studentId, studentName and admissionNo under one
    // target: "student". A request that gave any of them has named the target,
    // whichever dimension carried it -- but only when the code really went
    // into the student's argument. An invoice number is not a student.
    if (dimension === 'admissionNo' && argName === 'admissionNo') filled.add('student');
    const isTarget = (capability.targets ?? []).includes(dimension)
      || ['class', 'student', 'admissionNo', 'numbered', 'title', 'percentage'].includes(dimension);
    if (isTarget) targetsFilled += 1;
    add(isTarget ? WEIGHT.TARGET_FILLED : WEIGHT.FILTER_FILLED, `${dimension} -> ${argName}`);
  }

  /* A capability ABOUT something, asked with nothing of that kind named.

     Weighted by what it returns. A capability that answers with ONE record
     cannot answer at all without being told which, so a question that names
     nobody is almost never for it. A capability that answers with a LIST is
     perfectly well formed without one -- "show all students" is a real
     question -- so the same penalty there would rule out the right answer. */
  // A capability NAMED for the caller (`get_my_bus`) has its target already:
  // the caller. Docking it for naming nobody penalised exactly the reads a
  // student asks with "my" -- "which bus am I on" lost to the request list.
  if ((capability.targets ?? []).length && !(capability.targets ?? []).some((t) => filled.has(t))
    && !(nameParts(capability.name).self && named.self)) {
    // Weighted by what it RETURNS, not by what it does. An UPDATE is not
    // automatically in the same position as a DETAIL read: several of these
    // capabilities identify their record by NAME rather than by id -- a book
    // by its title, a room by its number -- and `targets` is derived from
    // TARGET_ARGS, which lists only the id. Penalising every unidentified
    // write made those unreachable again.
    add(capability.resultShape === 'DETAIL' ? WEIGHT.ABOUT_NOTHING_NAMED : -1, 'no target named');
  }

  /* The shape of the answer asked for. */
  if (named.quoting && ['LIST', 'SUMMARY'].includes(capability.resultShape)) {
    // Asked for the words, offered the rows.
    add(WEIGHT.SHAPE_MISMATCH, 'content asked, rows offered');
  }
  if (capability.resultShape) {
    if (named.searching) {
      // A search wants candidates. A capability that returns ONE record can
      // only answer by choosing, and choosing whose record to open is exactly
      // what a search is asking not to do.
      add(capability.resultShape === 'DETAIL' ? WEIGHT.SHAPE_MISMATCH : WEIGHT.SHAPE_MATCH, 'search asked');
    } else if (named.aggregate) {
      // A listing that reports its own total carries the figure too.
      const figure = capability.resultShape === 'SUMMARY' || capability.reportsTotal;
      add(figure ? WEIGHT.SHAPE_MATCH : WEIGHT.SHAPE_MISMATCH, 'aggregate asked');
    } else if (named.detail) {
      // One record, in full. A LIST capability can only answer by returning
      // rows nobody asked for, and a SUMMARY by returning a figure.
      add(capability.resultShape === 'DETAIL' ? WEIGHT.SHAPE_MATCH : WEIGHT.SHAPE_MISMATCH, 'detail asked');
    } else if (named.list && capability.resultShape !== 'SUMMARY') {
      add(capability.resultShape === 'LIST' ? WEIGHT.SHAPE_MATCH : WEIGHT.SHAPE_MISMATCH, 'list asked');
    }
  }

  /* Whose records this is about.

     Three signals, all derived. A tool NAMED for the caller (`get_my_...`)
     answers about them. A tool that takes a CLASS answers about a group, so a
     question about the caller that names no class is not for it. And a
     question that names nobody at all -- "who is absent today" -- is a
     school-wide question, which is what a school-wide capability is for. */
  const namesSomebody = Boolean(named.class || named.student || named.admissionNo);
  const aboutAGroup = GROUP_ARGS.some((arg) => properties.includes(arg));

  // A tool named for the caller's OWN something answers only when that
  // something is what is asked about. "Upcoming exams for my classes" and
  // "announcements relevant to my classes" say "my classes" to narrow a
  // question about exams and announcements, and scoring get_my_classes as
  // self-matched answered both with the teacher's list of sections.
  const selfIsTheSubject = aboutThis || !subjects.length;
  if (self) add(named.self && selfIsTheSubject ? WEIGHT.SELF_MATCH : WEIGHT.SELF_MISMATCH, 'self-scoped');
  else if (named.self && capability.minScope === 'ALL') add(WEIGHT.SELF_MISMATCH, 'school-wide, asked about self');

  if (named.self && !named.possessedSet && !namesSomebody && aboutAGroup) {
    add(WEIGHT.SELF_MISMATCH, 'class-level, asked about the caller');
  }
  // Reads only. A question that names nobody is a school-wide QUESTION; an
  // instruction that names nobody is an incomplete instruction, and crediting
  // it here scored "update hostel room" as a bed allocation.
  if (!named.self && !namesSomebody && capability.operation === 'GET' && capability.minScope === 'ALL') {
    add(WEIGHT.SCHOOL_WIDE_QUESTION, 'school-wide question');
  }

  /* A required opaque identifier nothing could supply: not a candidate at all.

     But it is reported, not merely dropped. A capability the sentence clearly
     NAMED -- by its verb, or by every noun in its name -- and which cannot be
     run only because nobody can type an ObjectId is a different situation from
     one nobody asked for, and the resolver must not answer the first by
     quietly choosing the second. "Approve the payment" used to reach
     record_payment, and "enrol Rahul in transport on Route 2" reached the
     capability that RENAMES a route. Both are writes, and both were wrong. */
  const missingId = (capability.required ?? []).some((n) => ids.has(n) && args[n] === undefined);
  if (missingId) {
    const askedForByName = (verb && verbCandidates.has(verb) && !READ_VERBS.has(verb))
      || (nouns.length > 0 && nouns.every((noun) => spoke(tokens, noun)));
    return {
      score: 0,
      // What it WOULD have scored, so the resolver can tell how well the
      // sentence fitted the thing it cannot identify. Without this the veto
      // below could only ask "is anything blocked?", and the answer is yes on
      // almost every sentence -- every verb in the catalogue has some
      // id-bearing capability named after it.
      wouldScore: score,
      args,
      why: ['requires an id nothing in the message supplies'],
      targetsFilled,
      // Only a WRITE can veto the turn. A read that cannot be identified is
      // harmlessly answered by a broader read of the same thing -- the marks
      // grid gives way to the class marks -- whereas a write that cannot be
      // identified must never give way to a DIFFERENT write.
      blocked: askedForByName && capability.operation !== 'GET' ? capability.name : null,
    };
  }

  return { score, args, why, targetsFilled };
}

/* ── Filling the remaining arguments ──────────────────────── */

/**
 * Fills arguments the dimensions did not answer, by the kind each schema
 * implies (see argumentKinds.js). Runs only AFTER the capability is settled, so
 * an incidental value can never decide which capability runs.
 *
 * Free text is used ONCE. A capability with a subject and a body would
 * otherwise get the same sentence in both -- which is what put "my child's ID
 * card is missing" into a ticket's priority as well as its subject.
 */

/**
 * The message with its quoted spans blanked out. Single quotes count only as a
 * pair around words, never as an apostrophe: "Priya's" is not a quotation.
 */
function withoutQuotedText(text) {
  return String(text ?? '')
    .replace(/["“”][^"“”]{1,500}["“”]/g, ' ')
    .replace(/(^|\s)['‘][^'‘’]{1,500}['’](?=[\s.,;:!?]|$)/g, '$1 ');
}

function fillDeclaredArguments(capability, args, message, { now, write, verbatim = message }) {
  const properties = capability.schema?.properties ?? {};
  const required = new Set(capability.required ?? []);
  const filled = { ...args };
  const usedText = new Set(Object.values(filled).filter((v) => typeof v === 'string'));

  // Required text first, so the one phrase the sentence carries lands on the
  // argument the capability cannot run without.
  const order = Object.entries(properties).sort(
    ([a], [b]) => Number(required.has(b)) - Number(required.has(a)),
  );

  for (const [name, propertySchema] of order) {
    if (filled[name] !== undefined) continue;
    if (namesARecord(capability, name, propertySchema)) continue;
    // Free text is read from the sentence as the person wrote it, never from
    // the residual. The residual has had names, classes and possessives cut
    // out of it, which is right for reading a number out of it and wrong for
    // quoting somebody: a ticket subject came back as "my   ID card is
    // missing" because "child's" had been removed as a possessive.
    //
    // Every other kind is read from OUTSIDE quotation marks. Quoted text is
    // somebody's words -- the "3" in an assignment titled "Chapter 3" is part
    // of its title, and was being proposed as its maximum marks.
    const source = kindOfProperty(name, propertySchema) === 'text' ? verbatim : withoutQuotedText(message);
    const result = extractArgument(name, propertySchema, source, { now, write });
    if (result.status !== FOUND) continue;
    if (kindOfProperty(name, propertySchema) === 'text') {
      // Containment, not equality: the same phrase capped at two different
      // maxLengths is still the same phrase used twice.
      const value = String(result.value);
      if ([...usedText].some((used) => used.includes(value) || value.includes(used))) continue;
      usedText.add(value);
    }
    filled[name] = result.value;
  }
  return filled;
}

/**
 * The message with the spans the dimensions already accounted for taken out.
 *
 * Used to tell a question's SUBJECT from its TARGET: "outstanding fees for
 * Class 5A" mentions classes, but with "Class 5A" removed what remains is about
 * fees. Same rule for every dimension, so nothing here is specific to one.
 */
function residualMessage(text, named) {
  let rest = String(text ?? '');
  // The title is deliberately left in. It is the one dimension a text
  // extractor is meant to find -- removing "Activity Fee" from "create a fee
  // head called Activity Fee" left the capability with no name to create.
  const spoken = [named.class, named.student, named.admissionNo, named.numbered?.value];
  for (const value of spoken) {
    if (typeof value === 'string' && value.length >= 2) rest = rest.split(value).join(' ');
  }
  if (named.numbered) rest = rest.replace(NUMBERED_THING, ' ');
  // A class survives being written differently from how it was recognised --
  // "Class 5-A" read as "Class 5 A" leaves the digits behind, and the digits
  // are what a number extractor then picks up.
  if (named.class) rest = rest.replace(/\b(?:class|grade|std)\s*\d{1,2}\s*[-\u2013\u2014]?\s*[a-z]?\b/gi, ' ');
  // "my CHILD'S attendance" is a question about attendance, not about
  // children. A possessive marks the owner of the thing being asked for, so
  // it cannot be the subject -- and reading it as one answered a parent's
  // attendance question with a list of guardians.
  rest = rest.replace(/\b[\p{L}]+['\u2019]s\b/gu, ' ');
  // A stated threshold is already accounted for. Left in, its digits were read
  // a second time as an ordinary bounded number and became limit: 75.
  if (named.percentage != null) rest = rest.replace(/\b\d{1,3}\s?%/g, ' ');
  // A span already accounted for. "the last 1 year" left a 1 behind, which a
  // bounded-integer argument then picked up as a period number.
  if (named.range) {
    // With the preposition that introduces it: "during the previous year" left
    // "during" behind, and the subject reader took it for a school subject.
    rest = rest.replace(
      /\b(?:(?:for|in|during|over|within|from)\s+)?(?:the\s+)?(?:last|past|previous|recent|next|this)\s+\d{0,3}\s*(?:day|week|month|year)s?\b/gi,
      ' ',
    );
  }
  // A day written in words, likewise: its digits are a date, and "on 5th
  // August 2026" left behind as text was read as a topic and a period number.
  for (const span of named.writtenDates ?? []) rest = rest.split(span).join(' ');
  if (named.link) rest = rest.split(named.link).join(' ');
  return rest;
}

/**
 * Whether the caller holds any class a class-level capability could answer
 * about. The same rule allowedSectionIds() applies in the tool layer: a
 * school-wide reader holds every class, a teacher their own, and any other
 * OWN-scoped caller -- a student, a parent -- none at all.
 */
function holdsClasses(actor, capability) {
  const scope = actor?.permissions?.[capability.permission];
  return scope === 'ALL' || actor?.roleKey === 'TEACHER';
}

/* ── The resolver ─────────────────────────────────────────── */

/**
 * Ranks the caller's capabilities against one message.
 *
 * Ties are broken by how much of the request a capability actually absorbed
 * (targets filled), then by how little else it takes -- the simplest capability
 * that answers the question. Only a tie that survives both, across a different
 * entity or operation, is a real ambiguity worth asking about.
 */
function rank(message, actor, { now, candidates }) {
  // Supersession is a fact about the CATALOG; availability is a fact about the
  // caller. An older name is skipped only while the canonical one is actually
  // reachable by this caller -- otherwise narrowing one capability's scope
  // silently took its predecessor away too, and a parent asking "do I owe any
  // fees?" was left with no fee capability at all.
  const authorized = candidates ?? capabilitiesFor(actor);
  const offered = new Set(authorized.map((c) => c.name));
  const pool = authorized
    .filter((c) => !(c.supersededBy && offered.has(c.supersededBy)))
    // A class-level capability cannot answer a caller who holds no class, and
    // proposing it only produced "Class 6 A is not one of your classes" to a
    // student asking for their own marks. Routing preference, not
    // authorization: the tool still refuses on its own if reached.
    .filter((c) => !c.requiresClass || holdsClasses(actor, c));
  if (!pool.length) return [];

  const reading = readingOf(message, now);

  return pool
    .map((capability) => ({ capability, ...scoreCapability(capability, reading) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.targetsFilled - a.targetsFilled ||
        (a.capability.properties?.length ?? 0) - (b.capability.properties?.length ?? 0) ||
        a.capability.name.localeCompare(b.capability.name),
    );
}

/**
 * Everything a sentence says, read once.
 *
 * Split out of rank() so that one capability can be scored on its own --
 * argumentsFor() below does exactly that -- without a second, drifting copy of
 * how a message is read.
 */
function readingOf(message, now) {
  const tokens = tokensOf(message);
  const verbCandidates = verbPositions(message);
  const entities = entitiesInText(message);
  const named = dimensionsOf(message, now);
  // What the request is about, with the things it is about REMOVED: a class,
  // a person and a room number are targets of a question, not its subject.
  // What the request is ABOUT. Not simply the first entity spoken: students and
  // classes lead a sentence whether or not they are its subject, and the
  // opening verb is not an entity at all -- "MARK attendance for Class 5-A"
  // read as a question about MARKS, because `mark` is both the verb and the
  // noun. The sentence's own verb is accounted for separately.
  const subject = subjectEntityOf(withoutLeadingVerb(residualMessage(message, named)));

  // Naming a person IS naming the entity, when the sentence names no other.
  //
  // "Show the details of Arnav Patel" is a question about a student that never
  // uses the word. The dimensions already read the person; this says what
  // reading one MEANS, so the capabilities about students are credited for it
  // exactly as if the word had been there. Where the sentence does name an
  // entity -- "mark Rahul Sharma absent" is about attendance -- that entity
  // stays the subject and this adds nothing.
  //
  // It makes a SUBJECT and never a mention, which is the difference between
  // crediting the capabilities about students and penalising every capability
  // that is about something else. "Show Rahul's performance" names a person
  // and a topic that is in no vocabulary at all; counting the person as an
  // entity MENTIONED docked the performance capability four points for not
  // being about students, and the student record answered a question about
  // marks.
  // `personFromTitle` is the resolver's own statement that the only evidence
  // of a person is a capitalised run that could equally be a title. "Update
  // Clean Code to 5 copies" is the case: implying the student entity from it
  // made a catalogue correction into a question about students, and the book
  // capability -- which held the only thing anybody had named -- was scored
  // down for it.
  // `personFromTitle` says the only evidence of a person is a capitalised run
  // that could equally be a title, and "Update Clean Code to 5 copies" is why
  // that matters: implying a student there made a catalogue correction into a
  // question about students. But it is also true of "Tell me about Diya
  // Patel", where the run really is a person -- so a request for ONE RECORD IN
  // FULL overrides it. Nobody asks for the details of a book by saying "tell
  // me about" and then naming a person-shaped run they want edited.
  const impliedByIdentity = ((named.student && (!named.personFromTitle || named.detail)) || named.admissionNo)
    ? 'student'
    : null;
  const subjects = subject ? [subject] : [];
  const wantedOperations = operationsNamed(verbCandidates, verbIndex(), {
    requestMood: named.requestMood,
    message,
  });

  return { verbCandidates, tokens, entities, subjects, implied: impliedByIdentity, named, wantedOperations, now };
}

/**
 * The arguments one named capability would be called with, from the sentence.
 *
 * WHICH capability runs is decided elsewhere -- by the scorer, by a pattern
 * rule, or by a model. This answers a narrower question: given that this one is
 * going to run, what did the sentence say that its schema can hold?
 *
 * It exists because the tiers used to read the same sentence with different
 * thoroughness. A pattern rule's extractor is written for its own tool and
 * stops at what that rule cared about, so "Mark Diya Patel present in Class
 * 5-A" reached the register with the student and the status but WITHOUT the
 * class -- and a step that drops what the request named is refused, correctly,
 * by respectsSpecificity. The request was answerable; the reading was thin.
 *
 * Nothing here decides or authorizes anything: the value must still be a
 * dimension the sentence really named and an argument the schema really
 * declares, and the MCP server validates and authorizes the call afterwards
 * exactly as before.
 */
export function argumentsFor(capabilityName, message, actor, { now = new Date(), candidates = null } = {}) {
  const capability = (candidates ?? capabilitiesFor(actor)).find((c) => c.name === capabilityName);
  if (!capability) return {};
  return scoreCapability(capability, readingOf(String(message ?? ''), now)).args ?? {};
}

/**
 * Resolves a message to one capability, a request for clarification, or null.
 *
 * @returns {null
 *   | { tool: string, args: object, score: number, why: string[] }
 *   | { needsClarification: true, options: {tool,entity,operation}[] }}
 */
export function resolveCapability(message, actor, { now = new Date(), candidates = null } = {}) {
  const str = String(message ?? '');
  if (!str.trim()) return null;

  // A question about a module the caller holds nothing in is DECLINED, not
  // answered from the nearest module they do hold. "Which invoices are
  // overdue?" asked of a librarian used to come back with overdue BOOKS:
  // both modules speak of things being overdue, and the librarian holds only
  // one of them, so the wrong one won by default.
  const named = dimensionsOf(str, now);

  // Another school's records: no capability can express that, by design, so
  // none is chosen. Scoring it would pick the nearest capability and answer
  // about the caller's own school as though it were the other one.
  if (named.otherInstitution) return null;

  // An act the caller cannot perform is not answered with one they can.
  if (unavailableAction(str, actor)) return null;

  const spoken = entitiesInText(residualMessage(str, named));
  if (spoken.length) {
    const reachable = new Set((candidates ?? capabilitiesFor(actor)).map((c) => c.entity));
    if (!spoken.some((entity) => reachable.has(entity))) return null;
  }

  const ranked = rank(str, actor, { now, candidates });

  const scored = ranked.filter((s) => s.score > 0);
  if (!scored.length || scored[0].score < MIN_SCORE) return null;

  // Named, and unidentifiable. Declining is the honest answer -- and, for a
  // write, the only safe one: the alternative is performing a DIFFERENT
  // operation on a record nobody named. "Approve the payment" used to reach
  // record_payment, and "enrol Rahul in transport on Route 2" reached the
  // capability that renames a route.
  //
  // The veto is comparative, not absolute. Almost every sentence has SOME
  // id-bearing capability that shares its verb, so vetoing whenever one exists
  // would decline nearly everything. It fires only when the thing that cannot
  // be identified fitted the sentence BETTER than the winner did -- which is
  // the case where the winner is not what was asked for.
  // A TIE vetoes too. Where the sentence fitted the unidentifiable capability
  // exactly as well as the winner, there is no evidence for preferring the
  // winner, and the winner is a write.
  const vetoed = ranked.find((s) => s.blocked && s.wouldScore >= scored[0].score);
  if (vetoed) return null;

  // Asked for the words, and the best this catalogue can offer is rows. The
  // school's own written material -- notices, policies -- is unstructured and
  // has no tool; the knowledge tier is what answers from it, and it only runs
  // when nothing here claims the turn. So this yields rather than answering
  // "what did the bus route notice say?" with a list of recent announcements.
  // `named` is already in scope from the unreachable-entity guard above.
  if (named.quoting && ['LIST', 'SUMMARY'].includes(scored[0].capability.resultShape)) return null;

  const best = scored[0];
  const tied = scored.filter(
    (s) =>
      best.score - s.score < MIN_MARGIN &&
      (s.capability.entity !== best.capability.entity || s.capability.operation !== best.capability.operation),
  );
  if (tied.length) {
    // Two genuinely different things fit equally well. Asking which is the
    // honest answer; picking one is how a specific request gets answered
    // broadly.
    return {
      needsClarification: true,
      options: [best, ...tied]
        .slice(0, 4)
        .map((s) => ({ tool: s.capability.name, entity: s.capability.entity, operation: s.capability.operation })),
    };
  }

  const tentative = best.score < CONFIDENT_SCORE;
  const write = best.capability.operation !== 'GET';
  // Read from the RESIDUAL, never the whole sentence. "Class 5-A" carries a 5
  // that is part of a name, and a generic integer extractor reading the whole
  // message turned it into `limit: 5` and `periodNo: 5` -- a question about a
  // class answered about five students of it, and about period five of a
  // register nobody asked for.
  const args = fillDeclaredArguments(
    best.capability,
    best.args,
    residualMessage(str, named),
    { now, write, verbatim: str },
  );
  return { tool: best.capability.name, args, score: best.score, tentative, why: best.why };
}

/**
 * The operations a sentence asks for, from the catalogue's own verbs.
 *
 * Exported so the tiers that do NOT score capabilities -- the self-category
 * tier, the entity tier and the pattern rules -- can be held to the same
 * reading of the sentence. Without it, "cancel my leave request" reached the
 * rule that APPLIES for leave, and a request to withdraw something was
 * answered by proposing to create it.
 */
/**
 * How a dimension is named when explaining that it cannot be honoured.
 *
 * A closed set, because the dimensions are: they are declared once in
 * dimensionsOf() and this names the same ones.
 */
const UNMET_DIMENSION_WORDS = {
  class: 'a class',
  student: 'a student',
  admissionNo: 'an admission number',
  numbered: 'a room or route number',
  range: 'a date range',
  date: 'a date',
  month: 'a month',
  subject: 'a subject',
  title: 'a title',
  percentage: 'a percentage',
};

/**
 * Why the nearest capability could not answer, when none could.
 *
 * "Show attendance statistics for Class 5-A for the last 1 year" reaches
 * nothing, and it SHOULD: the attendance figures this system keeps are the
 * school's for one day, or one pupil's for a month. Neither the Web nor the
 * service behind it can break a year down by class, so inventing an aggregate
 * here would be building something the Web cannot do -- and answering with the
 * nearest capability would quietly return a different figure than the one
 * asked for, which is worse than saying no.
 *
 * What was missing is nonetheless KNOWN: the scorer already records "cannot
 * express the range asked for" against the capability that came closest. This
 * reads that back so the turn can decline in terms of the request, rather than
 * with a list of everything the assistant can do.
 *
 * Reports only; it decides nothing and reaches no service.
 */
export function unmetNarrowing(message, actor, { now = new Date(), candidates = null } = {}) {
  const ranked = rank(String(message ?? ''), actor, { now, candidates }).filter((r) => r.score > 0);
  const best = ranked[0];
  if (!best) return null;

  const missing = [...new Set((best.why ?? [])
    .map((reason) => /^cannot express the (\w+) asked for/.exec(reason)?.[1])
    .filter((dimension) => dimension && UNMET_DIMENSION_WORDS[dimension]))];
  if (!missing.length) return null;

  return {
    tool: best.capability.name,
    entity: best.capability.entity,
    missing,
    words: missing.map((dimension) => UNMET_DIMENSION_WORDS[dimension]),
    description: best.capability.description ?? null,
  };
}

/** The verbs of a decision on somebody's request, as stems. */
const DECISION_VERBS = new Set(['approve', 'reject', 'decide', 'review', 'grant', 'refuse', 'deny', 'accept', 'decline'].map(stem));

/**
 * The verbs a capability's own description opens with: "Record attendance on a
 * date" performs RECORDING, "Publish or send an announcement" both publishing
 * and sending. Only the opening of the first sentence counts -- that is where a
 * description states its act; the rest describes consequences ("changes
 * nothing until approved") and is not an act the caller performs.
 */
function openingVerbs(description) {
  const first = String(description ?? '').split(/(?<=\.)\s/)[0] ?? '';
  const lead = /^\s*([a-z]+(?:(?:\s*,\s*|\s+or\s+|\s+and\s+)[a-z]+)*)/i.exec(first)?.[1] ?? '';
  return lead.split(/\s*,\s*|\s+or\s+|\s+and\s+/i).map((word) => stem(word.toLowerCase())).filter(Boolean);
}

/**
 * True when the caller holds a write on the thing named that states, in its
 * own words, that it performs this act. "Record attendance" is mark_attendance
 * and "record marks" is enter_marks: neither is NAMED record_, so judging by
 * tool names alone told a teacher they could not do the two things a teacher
 * does most. Judged on the subject entity, so a verb one capability opens with
 * never vouches for an act on a different thing.
 */
function actsBy(pool, subject, verb) {
  if (!subject) return false;
  return pool.some((c) => c.writes && c.entity === subject && openingVerbs(c.description).includes(verb));
}

/**
 * An act the sentence asks for that this caller cannot perform -- said plainly,
 * rather than answered with the nearest thing they CAN do.
 *
 * The failure it exists for: a student asking to "approve my own co-curricular
 * request" was resolved to the capability that FILES a co-curricular request,
 * because that was the nearest act they hold -- and it runs without
 * confirmation. "Close my support ticket" listed closed tickets; "reply to my
 * ticket" raised a new one. Each is a different act from the one asked for.
 *
 * Two findings, both derived from the catalogue and the caller's own grants:
 *
 *   NOT_PERMITTED  the verb is one the catalogue uses for an act ("approve",
 *                  "reply", "mark") and the caller holds no capability named
 *                  after it.
 *   NOT_OFFERED    the caller works with the thing named (leave, a transport
 *                  request) but none of their capabilities for it performs the
 *                  kind of act asked for -- there is no cancelling a leave
 *                  application, or editing a transport request, on the Web.
 *
 * A question is never an act: "what fields can I change?" asks what is
 * possible. Nothing here grants, refuses or runs anything; it explains.
 */
/**
 * A verb as it is said in "You can't ___": its base form. "Deleting or
 * updating homework" was answered "You can't deleting homework". The base form
 * is the catalogue's own verb, or a common one, that stems the same way.
 */
const COMMON_VERBS = ['delete', 'update', 'change', 'create', 'remove', 'edit', 'add', 'modify', 'cancel', 'make',
  'generate', 'publish', 'mark', 'record', 'set', 'send', 'post', 'upload', 'schedule', 'rename', 'approve', 'reject'];
function baseVerb(word) {
  const w = String(word ?? '').toLowerCase();
  if (!/(?:ing|ed|es|s)$/.test(w)) return w;
  // The stemmer keeps a base form's final "e" ("delete") and drops it from an
  // inflection ("deleting" -> "delet"), so both spellings of the root count.
  const root = stem(w);
  const found = [...verbIndex().keys(), ...COMMON_VERBS]
    .find((v) => v !== w && (v === root || v === `${root}e` || stem(v) === root));
  return found ?? w;
}

/** Catalogue capability names written out in a message -- "generate_homework". */
const TOOL_NAME_IN_TEXT = /\b[a-z]+(?:_[a-z]+)+\b/g;

export function unavailableAction(message, actor) {
  // Quoted text is the person's own content -- "change its message to 'Submit
  // the books'" -- and a verb inside it is not the act being asked for.
  const str = String(message ?? '').replace(/["“”']([^"“”']{2,500})["“”']/g, ' ');
  if (!str.trim() || WH_QUESTION.test(str)) return null;
  const pool = capabilitiesFor(actor);
  if (!pool.length) return null;

  // A capability asked for BY ITS CATALOGUE NAME that this caller is not
  // offered. "Generate AI homework using generate_homework" from a teacher
  // names an act the Web does not give a teacher; it used to reach the MCP
  // server, which refused it with a sentence about school-wide scope that
  // answered nothing that was asked.
  const offered = new Set(pool.map((c) => c.name));
  const catalogue = new Map(capabilityIndex().map((c) => [c.name, c]));
  for (const [written] of str.toLowerCase().matchAll(TOOL_NAME_IN_TEXT)) {
    const capability = catalogue.get(written);
    if (capability && !offered.has(written)) {
      return { reason: 'NOT_OFFERED', verb: nameParts(written).verb ?? 'use', entity: capability.entity };
    }
  }

  const words = wordsOf(str);
  const surface = (stemmed) => words.find((w) => stem(w) === stemmed) ?? stemmed;
  const verbs = verbIndex();
  const candidates = verbPositions(str);
  // Approving and rejecting are DECIDING: a librarian holds decide_book_request,
  // not an approve_ tool, and "approve Rahul's book request" is theirs to do.
  // One act under several words, like the equivalences above.
  const held = new Set(pool.map((c) => nameParts(c.name).verb));
  if ([...held].some((v) => DECISION_VERBS.has(v))) for (const v of DECISION_VERBS) held.add(v);
  const named = dimensionsOf(str);
  const subject = subjectEntityOf(withoutLeadingVerb(residualMessage(str, named)));

  for (const verb of candidates) {
    if (READ_VERBS.has(verb) || !verbs.has(verb)) continue;
    if ([...verbs.get(verb)].every((op) => op === 'GET')) continue;
    // A GENERIC act -- add, create, update, cancel -- is judged by the check
    // below, on the thing it is done to: "add the Basketball activity" is a
    // co-curricular request the student can make, whoever else's tool happens
    // to be named add_. Only a SPECIFIC act (approve, reply, mark, issue) is
    // refused for its verb alone.
    if (detectOperation(surface(verb)) !== 'GET') continue;
    if (!held.has(verb) && !actsBy(pool, subject, verb)) return { reason: 'NOT_PERMITTED', verb: baseVerb(surface(verb)), entity: subject };
  }

  // What the opening verb itself means, when it is a generic one: "update"
  // is an UPDATE, whatever else the catalogue's update_* tools are declared
  // as. Taking the catalogue's view counted a transport REQUEST as a way to
  // update a transport request.
  const opening = /^\s*(?:please\s+)?([a-z]+)/i.exec(str)?.[1]?.toLowerCase();
  // "Give me the link" governs the speaker, which makes it a read -- the same
  // rule operationsNamed() applies.
  const toTheSpeaker = /^\s*(?:please\s+)?[a-z]+\s+(?:me|us)\b/i.test(str);
  const coarse = opening && !toTheSpeaker ? detectOperation(opening) : 'GET';
  const wanted = coarse !== 'GET'
    ? new Set([coarse])
    : operationsNamed(candidates, verbs, { requestMood: named.requestMood, message: str });
  if (!wanted.size || !subject) return null;
  const ofSubject = pool.filter((c) => c.entity === subject);
  if (!ofSubject.length) return null;
  // The opening verb is the act, not a noun naming a capability: "EDIT my
  // announcement" matched the noun of decide_profile_edit ("profile edit"),
  // and so a teacher was never told announcements cannot be edited -- the
  // request went on to a capability they do not hold.
  const tokens = new Set([...tokensOf(str)].filter((token) => !opening || token !== stem(opening)));
  // A task standing in for a change must be a task on the thing named: grading
  // a SUBMISSION is no way to "update the homework deadline", and counting it
  // hid that changing homework is not offered at all.
  const standsIn = (c) => c.operation === 'ACTION' && !wanted.has('ACTION') && !wanted.has('CREATE');
  // Its own noun, exactly: the equivalence table counts "assignment" as
  // "submission", which is right for reading and wrong for deciding that
  // grading a submission is a way to change an assignment.
  if (ofSubject.some((c) => performsAsked(c, wanted) && (!standsIn(c) || nameParts(c.name).nouns.some((n) => tokens.has(n))))) return null;
  // Nor when the sentence names a capability of that kind by its own words --
  // "create subject" is create_subject, whatever entity the registry filed it
  // under. The finding is only ever that NOTHING offers the act.
  if (pool.some((c) => performsAsked(c, wanted)
    && nameParts(c.name).nouns.some((n) => (standsIn(c) ? tokens.has(n) : spoke(tokens, n))))) return null;
  return { reason: 'NOT_OFFERED', verb: baseVerb(opening ?? [...wanted][0].toLowerCase()), entity: subject };
}

/**
 * A question about OTHER people's records: "who is absent today?", "show all
 * students", "which students failed?".
 *
 * Read as grammar. Asked by somebody who can only see their own records, it
 * cannot be answered -- and answering it with their own record, which is what
 * the nearest capability does, misrepresents what was asked.
 */
const ABOUT_OTHERS =
  /\bwho\s+(?:is|are|was|were)\s+(?:absent|present|late|on\s+leave|failing|top|topping|first)\b|\b(?:all|every|other)\s+(?:the\s+)?(?:students|pupils|classmates)\b|\bclassmates\b|\bwhich\s+(?:students|pupils)\b|\bhow\s+many\s+(?:students|pupils)\b|\beveryone(?:'s)?\b|\b(?:students|pupils)\s+(?:in|of)\s+(?:my|the|this|our)\s+(?:class|school|section)\b/i;

export function asksAboutOthers(message) {
  return ABOUT_OTHERS.test(String(message ?? ''));
}

export function operationsAskedFor(message, actor) {
  const pool = capabilitiesFor(actor);
  if (!pool.length) return new Set();
  const named = dimensionsOf(message);
  return operationsNamed(verbPositions(message), verbIndex(), {
    requestMood: named.requestMood,
    message: String(message ?? ''),
  });
}

/** Test seam: the full ranking, for measuring a change against real sentences. */
export function rankCapabilities(message, actor, { now = new Date(), candidates = null, limit = 5 } = {}) {
  return rank(String(message ?? ''), actor, { now, candidates }).slice(0, limit);
}
