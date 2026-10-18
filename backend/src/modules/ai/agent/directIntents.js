import { capabilitiesFor } from '../mcp/capabilities.js';
import { classFromText, refersToOwnClasses } from '../../../utils/classNames.js';
import { weekdayDateIn, writtenDatesIn, toIsoDate, localToday } from '../../../utils/naturalDates.js';
import { rangeFromText } from '../../../utils/dateRanges.js';
import { admissionNoFromText } from '../../../utils/studentIdentifiers.js';
import { nameFromText } from '../../../utils/peopleNames.js';
import { dimensionsOf, isWholeMonth, withoutLeadingVerb } from './capabilityResolver.js';
import { ATTENDANCE_SAFE_PCT } from '../../risk/risk.service.js';

/**
 * Requests whose MEANING is fixed by their grammar, read before anything scores.
 *
 * The tiers in intent.js choose a capability by how well its vocabulary and
 * arguments fit a sentence. That works for the long tail and fails, repeatedly,
 * on a short list of everyday questions where two capabilities share their
 * nouns and only the grammar tells them apart:
 *
 *   "show fee collection"                  → the fee STRUCTURES (shares "fee")
 *   "which class has the lowest attendance" → today's school head count
 *   "what is my next class?"               → the whole day's timetable
 *   "update the copies of Clean Code to 5" → an update to a STUDENT
 *   "log a hostel inquiry"                 → the LIST of inquiries
 *   "create a ticket titled Projector in Room 12 ..." → a new hostel ROOM
 *
 * Each was reported from manual testing, and each is the same failure: the
 * distinguishing word ("collection", "which class ... lowest", "next",
 * "copies") carries the meaning and no scorer weighs it. So the meaning is
 * stated here once, as a small table of grammars, each naming the capability
 * that answers it.
 *
 * What this file does NOT do, by design:
 *
 *   - It authorizes nothing. A step is offered only for a capability the caller
 *     already holds (`holds`), and the MCP server authorizes, scopes, validates,
 *     confirms and audits the call exactly as for any other.
 *   - It touches no data. Every step is a named MCP capability; there is no
 *     query, no service call and no model here.
 *   - It never guesses an identity. Where a request needs a student, a class or
 *     a title it could not read, the argument is left out and the tool asks.
 *
 * Two entry points: directStep() chooses a capability for one of the grammars
 * above, and refineStep() corrects the ARGUMENTS of a step some other tier
 * chose -- the full text of an announcement, a leave's dates and reason, a
 * ticket's whole title -- from the sentence as written.
 */

/* ── Shared helpers ───────────────────────────────────────── */

const holdsAny = (actor) => {
  const names = new Set(capabilitiesFor(actor).map((c) => c.name));
  return (tool) => names.has(tool);
};

const scopeOf = (actor, permission) => actor?.permissions?.[permission] ?? null;

/** Trailing punctuation and wrapping quotes off a captured phrase. */
const tidy = (text) => String(text ?? '').trim().replace(/^["'“‘]+|["'”’]+$/g, '').replace(/[\s.?!,;:–—-]+$/, '').replace(/^[\s,;:–—-]+/, '').trim();
const sentenceCase = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

/**
 * The period a sentence names, as the arguments a period-taking read accepts:
 * `{ date }`, `{ month }` or `{ from, to }`. Empty when it names none -- the
 * tool then states the period it used rather than this file inventing one.
 */
export function periodArgs(text, now = new Date()) {
  const named = dimensionsOf(text, now);
  if (named.range) {
    return isWholeMonth(named.range) ? { month: named.range.from.slice(0, 7) } : { from: named.range.from, to: named.range.to };
  }
  if (named.month) return { month: named.month };
  if (named.date) return { date: named.date };
  return {};
}

/** A book or other catalog item named in a sentence: quoted, or what the grammar captured. */
function titleIn(captured) {
  const text = tidy(captured);
  if (!text) return null;
  const quoted = /["“”'‘’]([^"“”'‘’]{2,200})["“”'‘’]/.exec(String(captured))?.[1];
  const title = tidy(quoted ?? text).replace(/^(?:the|a|an)\s+(?=\S+\s)/i, '').replace(/\s+(?:book|novel|textbook)s?$/i, '').replace(/^(?:book|novel|textbook)\s+/i, '');
  return title.length >= 2 ? title : null;
}

/* ── The grammars ─────────────────────────────────────────── */

const NEXT_CLASS = new RegExp([
  String.raw`\b(?:next|upcoming)\s+(?:class|period|lecture|lesson)\b`,
  // "Which class do I have next?", "what period is next", "which lecture is
  // on now" -- a question word, the noun, and "next"/"now". The question word
  // is what keeps "attendance for Class 5 A now" out of this.
  String.raw`\b(?:which|what)\s+(?:class|period|lecture|lesson|subject)\b[^?.!]{0,25}\b(?:next|right\s+now|now)\b`,
  String.raw`\bwhat(?:'s|\s+is|\s+do\s+i\s+have|\s+have\s+i)\s+(?:up\s+)?next\b`,
].join('|'), 'i');

/** Words that make a sentence about a record rather than about the timetable. */
const OTHER_RECORDS = /\battendance\b|\babsen(?:t|ce|tees?)\b|\bmarks?\b|\bresults?\b|\bfees?\b|\bhomework\b|\bassignments?\b|\bleave\b|\bexams?\b/i;

/** A sentence that asks to be SHOWN something: never an instruction to create it. */
const READ_LEAD = /^\s*(?:please\s+)?(?:show|list|display|view|see|get|give\s+me|tell\s+me|fetch|check|find|search|what|which|who|when|where|how\s+many|how\s+much|is|are|do|does|did|any)\b/i;

/** School-wide money that came IN: "fee collection", "how much fee was collected". */
const FEE_COLLECTION = new RegExp([
  String.raw`\bfees?\s+(?:collections?|collected|income|revenue|receipts?\s+total)\b`,
  String.raw`\bcollections?\s+of\s+fees?\b`,
  String.raw`\b(?:collected|received)\b[^?.!]{0,40}\bfees?\b`,
  // "fees collected", "fees received so far" -- but not "fee RECEIPT not
  // received", which is somebody's own paperwork, not the school's takings.
  String.raw`\bfees?\b(?![^?.!]*\breceipts?\b)[^?.!]{0,40}\b(?:collected|received)\b`,
  String.raw`\b(?:total|today'?s?|this\s+month'?s?|monthly|daily)\s+(?:fee\s+)?collections?\b`,
  String.raw`\bcollection\s+report\b`,
].join('|'), 'i');

/** A fee question that names the WHOLE school, whatever else it says. */
const SCHOOL_WIDE_FEES = /\b(?:school(?:'s|[\s-]?wide)?|whole\s+school|entire\s+school|all\s+students'?|every\s+student'?s?|everyone'?s?)\b[^?.!]{0,40}\bfees?\b|\bfees?\b[^?.!]{0,40}\b(?:of|for|across)\s+(?:the\s+)?(?:whole\s+|entire\s+)?school\b/i;

/** Payments already made: "paid invoices", "payment transactions", "payments received". */
const PAYMENTS_MADE = /\bpaid\s+(?:invoices?|fees?|bills?)\b|\bpayments?\s+(?:transactions?|history|received|made|records?|list)\b|\btransactions?\b[^?.!]{0,20}\b(?:payments?|fees?)\b|\b(?:fee|payment)\s+transactions?\b|\b(?:list|show)\b[^?.!]{0,20}\bpayments\b/i;
/** ...and not the payments still waiting on somebody: those are their own lists. */
const PAYMENTS_UNSETTLED = /\b(?:pending|awaiting|unapproved|to\s+approve|approval|change\s+requests?|plans?|links?|due|outstanding|overdue|unpaid|refunds?)\b/i;

const ATTENDANCE_WORD = /\battendance\b|\babsen(?:t|ce|tees?)\b/i;

/** Comparing classes by attendance: a ranking, not one figure. */
const CLASS_ATTENDANCE_RANKING = new RegExp([
  String.raw`\bwhich\s+(?:class|section|grade|division)\b[^?.!]*\b(?:lowest|highest|least|most|best|worst|poorest|top|bottom|lower|higher)\b`,
  String.raw`\b(?:lowest|highest|least|best|worst|poorest|top|bottom)\b[^?.!]{0,30}\b(?:class|section|classes|sections)\b`,
  String.raw`\bclass(?:es)?[\s-]?wise\b`,
  String.raw`\bsection[\s-]?wise\b`,
  String.raw`\b(?:by|per|across|for\s+each|for\s+every|each|every)\s+(?:class|section)(?:es)?\b`,
  String.raw`\brank(?:ing|ed|s)?\b[^?.!]{0,40}\b(?:class|section)(?:es)?\b`,
  String.raw`\b(?:class|section)(?:es)?\b[^?.!]{0,40}\brank(?:ing|ed|s)?\b`,
  String.raw`\bcompar\w*\b[^?.!]{0,60}\b(?:class|section)(?:es)?\b`,
].join('|'), 'i');

/** One figure for everybody together. */
const OVERALL_ATTENDANCE = /\b(?:overall|school(?:'s|[\s-]?wide)?|whole[\s-]school|total|aggregate|average)\s+attendance\b|\battendance\b[^?.!]{0,30}\b(?:of|for|across)\s+(?:the\s+)?(?:whole\s+|entire\s+)?school\b|\boverall\b[^?.!]{0,40}\battendance\b/i;

const LOW_ATTENDANCE = /\b(?:low|poor|short|bad|weak|irregular|insufficient)\s+attendance\b|\battendance\s+(?:shortage|shortfall|defaulters?)\b|\bshort(?:age)?\s+of\s+attendance\b|\b(?:attendance\s+)?defaulters?\b[^?.!]{0,20}\battendance\b/i;

/* Library. */
const BOOK_AVAILABILITY = /^\s*(?:is|are)\s+(?:the\s+book\s+)?(.{2,120}?)\s+(?:currently\s+)?(?:available|in\s+stock|on\s+the\s+shelf)\b|\b(?:availability|available\s+copies)\s+of\s+(.{2,120}?)\s*[?.!]*$|\bhow\s+many\s+copies\s+of\s+(.{2,120}?)\s+(?:are|do|does|is)\b|\bdo\s+(?:we|you)\s+have\s+(?:a\s+copy\s+of\s+|the\s+book\s+)?(.{2,120}?)\s+(?:in\s+(?:the\s+)?library|available)\b/i;
const BOOK_BORROWERS = /\bwho\s+(?:has\s+|have\s+|all\s+)?(?:borrowed|taken|issued|got|checked\s+out)\s+(.{2,120}?)\s*[?.!]*$|\bwho\s+has\s+(?:the\s+book\s+)?(.{2,120}?)\s*[?.!]*$|\bborrowers?\s+of\s+(.{2,120}?)\s*[?.!]*$|\bwho\s+is\s+(?:holding|having)\s+(.{2,120}?)\s*[?.!]*$/i;
const BOOK_COPIES_UPDATE = /\b(?:update|change|set|increase|decrease|reduce|raise|make|correct|edit)\b[^?.!]*?\b(?:(?:total\s+|number\s+of\s+)?copies)\s+(?:of|for)\s+(.{2,120}?)\s+(?:to|as|=)\s+(\d{1,4})\b|\b(?:update|change|set|increase|decrease|reduce|raise|make|correct|edit)\b\s+(.{2,120}?)\s+(?:(?:total\s+)?copies)\s+(?:to|as|=)\s+(\d{1,4})\b|\b(?:update|change|set|make)\b\s+(.{2,120}?)\s+to\s+(\d{1,4})\s+copies\b/i;
const OWN_OVERDUE_BOOKS = /\boverdue\b[^?.!]{0,40}\b(?:books?|library)\b|\b(?:books?|library)\b[^?.!]{0,40}\boverdue\b|\b(?:books?)\b[^?.!]{0,30}\b(?:late|past\s+due|not\s+returned)\b/i;
const OWN_BORROWED_BOOKS = /\b(?:books?)\b[^?.!]{0,30}\b(?:i\s+(?:have\s+)?(?:borrowed|taken|issued)|issued\s+to\s+me|with\s+me|i\s+need\s+to\s+return)\b|\bmy\s+(?:borrowed|issued|library)\s+books?\b|\bmy\s+(?:library\s+)?loans?\b/i;

/* Hostel. */
/** The hostel's residents, named as that. */
const HOSTEL_RESIDENTS = /\bhostel\s+(?:students|residents|boarders|inmates)\b|\b(?:students?|pupils?|residents?|boarders?)\b[^?.!]{0,30}\b(?:in|of|at)\s+(?:my\s+|the\s+)hostel\b|\bhostell?ers\b|\bboarders\b/i;
/** "My students", "the children under my care": whoever the caller is responsible for. */
const OWN_CHARGES = /\b(?:students?|pupils?|residents?|children|kids)\b[^?.!]{0,40}\bunder\s+my\s+(?:responsibility|care|charge|supervision|watch)\b|\bmy\s+(?:students|residents|wards)\b|\b(?:students?|pupils?)\b[^?.!]{0,30}\bi\s+am\s+responsible\s+for\b/i;
const HOSTEL_INQUIRY_CREATE = /\b(?:log|raise|create|open|file|register|add|submit|record|lodge|make)\b[^?.!]{0,30}\bhostel\s+(?:inquiry|enquiry|complaint|issue|request)\b|\bnew\s+hostel\s+(?:inquiry|enquiry|complaint)\b/i;

/* Admissions. */
const ADMISSION_LEAD_CREATE = /\b(?:create|add|log|register|record|enter|open|make|capture)\b[^?.!]{0,30}\b(?:admission\s+(?:lead|enquiry|inquiry)|(?:new\s+)?lead)\b|\bnew\s+admission\s+(?:lead|enquiry|inquiry)\b/i;

/* Tickets. */
const TICKET_CREATE = /\b(?:create|raise|open|log|file|submit|register|lodge|make|new)\b[^?]{0,30}\b(?:support\s+)?ticket\b/i;

/* A parent's own child, asked about as a person. */
const OWN_CHILD_PROFILE = /\bmy\s+(?:child|son|daughter|kid|ward)(?:'s|’s|s)?\s+(?:profile|details?|information|info|record)\b|\b(?:profile|details?|information|info)\s+of\s+my\s+(?:child|son|daughter|kid|ward)\b/i;

/* Homework by deadline. */
const HOMEWORK_WORD = /\b(?:assignments?|homework|worksheets?|tasks?)\b/i;
const DUE_FIRST = /\bdue\s+(?:first|next|soonest|earliest)\b|\b(?:first|next|earliest|soonest|nearest)\b[^?.!]{0,25}\b(?:due|deadline)\b|\b(?:earliest|nearest|next)\s+deadline\b/i;
const DUE_WINDOW = /\bdue\b|\bdeadline\b|\bto\s+(?:submit|hand\s+in)\b/i;

/** A message that asks for something to be CHANGED rather than read. */
const WRITE_LEAD = /^\s*(?:please\s+)?(?:mark|record|set|update|change|edit|correct|create|add|delete|remove|post|send|apply|enter|publish|approve|reject|issue|return|allocate|enrol|enroll)\b/i;

/**
 * The capability a message asks for, when its grammar settles it.
 *
 * @returns {{ tool: string, args: object } | null}
 */
export function directStep(message, actor, now = new Date()) {
  const text = String(message ?? '').trim();
  if (!text || !actor?.permissions?.['ai.copilot.use']) return null;
  const holds = holdsAny(actor);
  const named = dimensionsOf(text, now);
  const person = named.student || named.admissionNo;
  const spokenClass = classFromText(text)?.text ?? null;

  /* Timetable: the next period. */
  if (NEXT_CLASS.test(text) && holds('get_timetable') && !WRITE_LEAD.test(text) && !OTHER_RECORDS.test(text)) {
    return { tool: 'get_timetable', args: { next: true, ...(spokenClass && { className: spokenClass }) } };
  }

  /* Fees. Personal balance, structures, heads and outstanding dues keep the
     capabilities they already reach; what is settled here is the one that had
     none -- money collected -- and the payments list. */
  if (/\bfees?\b|\bcollections?\b|\bpayments?\b|\binvoices?\b|\btransactions?\b/i.test(text) && !WRITE_LEAD.test(text)) {
    const feesScope = scopeOf(actor, 'fees.read');
    // Not when a class is named: collection for ONE class is a narrowing the
    // collection figures cannot express, and it is declined as that by the
    // tiers below rather than answered for the whole school.
    if (FEE_COLLECTION.test(text) && feesScope === 'ALL' && !person && !spokenClass) {
      const period = periodArgs(text, now);
      // A period named: the payments recorded in it. None named: the school's
      // collection position -- collected, billed and outstanding -- which says
      // what it covers.
      if (period.date && holds('get_payment_history')) return { tool: 'get_payment_history', args: { from: period.date, to: period.date } };
      if (period.month && holds('get_payment_history')) {
        const [y, m] = period.month.split('-').map(Number);
        const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
        return { tool: 'get_payment_history', args: { from: `${period.month}-01`, to: last } };
      }
      if (period.from && holds('get_payment_history')) return { tool: 'get_payment_history', args: { from: period.from, to: period.to } };
      if (holds('get_fee_statistics')) return { tool: 'get_fee_statistics', args: {} };
    }
    if (PAYMENTS_MADE.test(text) && feesScope && holds('get_payment_history') && !PAYMENTS_UNSETTLED.test(text)) {
      const period = periodArgs(text, now);
      const range = period.date ? { from: period.date, to: period.date }
        : period.from ? { from: period.from, to: period.to }
          : period.month ? (() => {
            const [y, m] = period.month.split('-').map(Number);
            return { from: `${period.month}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
          })() : {};
      return { tool: 'get_payment_history', args: { ...range, ...(named.admissionNo && feesScope === 'ALL' && { search: named.admissionNo }) } };
    }
  }

  /* Attendance across classes, and for everybody together. */
  if (ATTENDANCE_WORD.test(text) && !WRITE_LEAD.test(text) && !person && holds('get_class_attendance_summary')) {
    const staffView = scopeOf(actor, 'attendance.read') === 'ALL' || actor?.roleKey === 'TEACHER';
    // A comparison ACROSS classes. A sentence that names one class, or asks
    // WHO, is about that class or about students ("who has the lowest
    // attendance in Class 5 A?") and keeps the readers it already has.
    const acrossClasses = !spokenClass && !/\bwho\b|\b(?:which|what)\s+(?:students?|pupils?|child(?:ren)?)\b|\bstudents?\s+(?:with|who|having)\b/i.test(text);
    if (staffView && acrossClasses && CLASS_ATTENDANCE_RANKING.test(text) && !named.self) {
      const highest = /\b(?:highest|best|most|top|higher)\b/i.test(text) && !/\b(?:lowest|least|worst|poorest|bottom)\b/i.test(text);
      const count = /\b(?:top|bottom|lowest|highest|best|worst)\s+(\d{1,2})\b/i.exec(text)?.[1];
      return {
        tool: 'get_class_attendance_summary',
        args: { ...periodArgs(text, now), order: highest ? 'HIGHEST' : 'LOWEST', ...(count && { limit: Number(count) }) },
      };
    }
    // "The school attendance overview" asks for leadership's overview (today, the week, chronic absence),
    // which the leadership capability answers; the per-class summary stays the answer to the rest.
    const asksLeadershipOverview = /\battendance\s+overview\b/i.test(text) && holds('get_school_attendance_overview');
    if (staffView && OVERALL_ATTENDANCE.test(text) && !spokenClass && !refersToOwnClasses(text) && !named.self && !asksLeadershipOverview) {
      return { tool: 'get_class_attendance_summary', args: { ...periodArgs(text, now) } };
    }
  }

  /* Low attendance: the students below the product's own threshold, and only
     the attendance signal -- never the marks and fee flags that share the
     at-risk list. A percentage the person states is theirs to choose. */
  if (LOW_ATTENDANCE.test(text) && !person && !WRITE_LEAD.test(text) && holds('get_at_risk_students')) {
    return {
      tool: 'get_at_risk_students',
      args: { attendanceBelowPct: named.percentage && named.percentage <= 100 ? named.percentage : ATTENDANCE_SAFE_PCT },
    };
  }

  /* Attendance in "my class": the class register, which asks which class when
     the caller has several -- not the caller's own (non-existent) attendance
     record. ("Who is absent today?" with no class in it is left to the tiers
     that already read it.) */
  // Anybody else who says "my class" (a principal) is asked which class too:
  // a school-wide reader has no class of their own, and answering with the
  // whole school dropped the question they then answered ("Class 10 A").
  if (ATTENDANCE_WORD.test(text) && !WRITE_LEAD.test(text) && !person && !spokenClass
    && holds('get_attendance_roster')
    && refersToOwnClasses(text)
    && (actor?.roleKey === 'TEACHER' || scopeOf(actor, 'attendance.read') === 'ALL')
    && !CLASS_ATTENDANCE_RANKING.test(text)) {
    const period = periodArgs(text, now);
    return { tool: 'get_attendance_roster', args: { ...(period.date && { date: period.date }), ...(period.month && { month: period.month }) } };
  }

  /* Library. "Is X available?" and "who has X?" are about a book only when
     something says so: the caller's work is the library, or the sentence has a
     book in it. An administrator asking "who has pending fees?" is not asking
     the catalog. */
  const aboutBooks = /\b(?:books?|librar\w+|novels?|textbooks?|cop(?:y|ies)|borrow\w*|checked\s+out|issued\s+(?:to|out))\b/i.test(text)
    || (Boolean(actor?.permissions?.['library.manage']) && !actor?.permissions?.['students.manage']);
  if (holds('list_books') || holds('list_book_issues')) {
    const copies = BOOK_COPIES_UPDATE.exec(text);
    if (copies && holds('update_book')) {
      const title = titleIn(copies[1] ?? copies[3] ?? copies[5]);
      const count = Number(copies[2] ?? copies[4] ?? copies[6]);
      if (title && Number.isInteger(count)) return { tool: 'update_book', args: { title, totalCopies: count } };
    }
    if (!WRITE_LEAD.test(text)) {
      const libraryScope = scopeOf(actor, 'library.read');
      // A student's (or parent's) own loans.
      if (libraryScope === 'OWN' && holds('list_book_issues')) {
        if (OWN_OVERDUE_BOOKS.test(text)) return { tool: 'list_book_issues', args: { status: 'OVERDUE' } };
        if (OWN_BORROWED_BOOKS.test(text)) return { tool: 'list_book_issues', args: { outstanding: true } };
      }
      const borrowed = aboutBooks ? BOOK_BORROWERS.exec(text) : null;
      if (borrowed && libraryScope === 'ALL' && holds('list_book_issues')) {
        const title = titleIn(borrowed[1] ?? borrowed[2] ?? borrowed[3] ?? borrowed[4]);
        // "Who has overdue books?" is the overdue list, not a title.
        if (title && !/^(?:overdue|late|pending|unreturned|not\s+returned|books?|a\s+book|any|the\s+most)\b/i.test(title)) {
          return { tool: 'list_book_issues', args: { title, outstanding: true } };
        }
      }
      const available = aboutBooks ? BOOK_AVAILABILITY.exec(text) : null;
      if (available && holds('get_book')) {
        const title = titleIn(available[1] ?? available[2] ?? available[3] ?? available[4]);
        if (title && !/^(?:it|this|that|any|some|there)\b/i.test(title)) return { tool: 'get_book', args: { title } };
      }
    }
  }

  /* Hostel. */
  if (HOSTEL_INQUIRY_CREATE.test(text) && !READ_LEAD.test(text) && holds('create_hostel_inquiry')) {
    return { tool: 'create_hostel_inquiry', args: hostelInquiryArgs(text) };
  }
  // "The students under my responsibility", from somebody whose students are
  // the hostel's: the residents, not the school roll. Whose work that is, is
  // read from what they hold -- the hostel, and neither a class register nor
  // the school's records to manage -- never from the name of their role, so a
  // custom "hostel supervisor" role is read the same way and an administrator
  // (who holds everything) is not.
  const hostelIsTheirWork = Boolean(actor?.permissions?.['hostel.manage'])
    && !actor?.permissions?.['attendance.read'] && !actor?.permissions?.['students.manage'];
  if (holds('get_hostel_residents') && !WRITE_LEAD.test(text)
    && (HOSTEL_RESIDENTS.test(text) || (hostelIsTheirWork && OWN_CHARGES.test(text)))) {
    return { tool: 'get_hostel_residents', args: {} };
  }

  /* Admissions. */
  if (ADMISSION_LEAD_CREATE.test(text) && !READ_LEAD.test(text) && holds('create_admission_lead')) {
    return { tool: 'create_admission_lead', args: admissionLeadArgs(text) };
  }

  /* Tickets. A ticket is created by its words, wherever a room or a class
     happens to be mentioned inside them. */
  if (TICKET_CREATE.test(text) && !READ_LEAD.test(text) && holds('create_ticket')
    && !/\b(?:reply|respond|close|resolve|update|assign)\b/i.test(text.split(/\bticket\b/i)[0])) {
    return { tool: 'create_ticket', args: ticketArgs(text) };
  }

  /* A percentage of MARKS. "Percentage" is also how attendance is quoted, and
     the word alone was routing an exam question to the attendance summary (or
     nowhere). What it is a percentage OF is read from the sentence: an exam, a
     test, a subject, "did I get/score". Attendance keeps its own readers; a
     bare "what is my percentage?" is asked about (see PERCENTAGE_QUESTION). */
  if (/\b(?:percentage|percent)\b|\d\s?%|%/i.test(text) && !ATTENDANCE_WORD.test(text) && !WRITE_LEAD.test(text)
    && !/\b(?:fees?|below|under|less\s+than|above|over|more\s+than|at\s+least)\b/i.test(text)) {
    const aboutMarks = /\b(?:marks?|exams?|tests?|results?|scor\w+|grades?|report\s*card|gpa|subjects?)\b/i.test(text)
      || /\b(?:did|do|have)\s+(?:i|he|she|they|we)\s+(?:get|got|score|scored|secure|secured|obtain|obtained)\b/i.test(text)
      || /\b(?:in|for)\s+(?:maths?|mathematics|science|english|hindi|physics|chemistry|biology|history|geography|civics|economics|sanskrit|marathi|computers?|evs|social\s+\w+)\b/i.test(text);
    if (aboutMarks && holds('get_report_card')) {
      const subject = tidy(/\b(?:in|for)\s+([A-Za-z][A-Za-z &]{2,40}?)(?:\s+(?:exam|test|paper|subject)s?)?\s*[?.!]*$/i.exec(text)?.[1] ?? '');
      const isSubject = subject && !/^(?:the|my|this|that|last|all|exams?|tests?|total|overall|class|term)\b/i.test(subject) && !classFromText(subject);
      const isFamily = actor?.roleKey === 'STUDENT' || actor?.roleKey === 'PARENT';
      // A student's question is about themselves; the subject word is never
      // somebody's name ("in Maths" is not a pupil called Maths).
      const who = actor?.roleKey !== 'STUDENT' && named.student
        && named.student.toLowerCase() !== subject.toLowerCase() ? named.student : null;
      if (isFamily || who || named.admissionNo) {
        return {
          tool: 'get_report_card',
          args: {
            ...(named.admissionNo && actor?.roleKey !== 'STUDENT' ? { admissionNo: named.admissionNo } : who ? { studentName: who } : {}),
            ...(isSubject && { subject: sentenceCase(subject) }),
          },
        };
      }
    }
  }

  /* "How many teachers / parents / librarians": the user directory, counted
     for that role. The directory reports its own total, and the role is one
     the schema itself lists. */
  const STAFF_WORD = String.raw`(teachers?|principals?|librarians?|wardens?|parents?|administrators?|admins?|finance\s+staff|accountants?)`;
  const headcount = new RegExp(String.raw`\bhow\s+many\s+${STAFF_WORD}\b`, 'i').exec(text)?.[1]
    ?? new RegExp(String.raw`^\s*(?:please\s+)?(?:show|list|display)\s+(?:me\s+)?(?:all\s+)?(?:the\s+)?${STAFF_WORD}\s*[?.!]*$`, 'i').exec(text)?.[1];
  // ...but "how many teachers are absent / on leave today?" is not a headcount
  // of the directory: answering it with the number of teachers stated a
  // figure for a different question.
  if (headcount && holds('list_users') && !WRITE_LEAD.test(text) && !/\b(?:absent|on\s+leave|away|off\s+today|present|late)\b/i.test(text)) {
    const word = headcount.toLowerCase();
    const ofRole = /^teacher/.test(word) ? 'TEACHER' : /^principal/.test(word) ? 'PRINCIPAL' : /^librarian/.test(word) ? 'LIBRARIAN'
      : /^warden/.test(word) ? 'WARDEN' : /^parent/.test(word) ? 'PARENT' : /^admin/.test(word) ? 'ADMIN' : 'FINANCE';
    return { tool: 'list_users', args: { ofRole } };
  }

  /* A parent's child, as a record. */
  if (actor?.roleKey === 'PARENT' && OWN_CHILD_PROFILE.test(text) && holds('get_student')) {
    return { tool: 'get_student', args: {} };
  }

  /* Homework by deadline. */
  if (HOMEWORK_WORD.test(text) && !WRITE_LEAD.test(text) && holds('get_assignments') && !person) {
    const className = spokenClass ? { className: spokenClass } : {};
    if (DUE_FIRST.test(text)) return { tool: 'get_assignments', args: { ...className, first: true } };
    if (DUE_WINDOW.test(text)) {
      const window = dueWindow(text, now);
      if (window) return { tool: 'get_assignments', args: { ...className, ...window } };
    }
  }

  return null;
}

/** "due this week", "due tomorrow", "due by Friday", "due on 12 October" → a due-date window. */
function dueWindow(text, now) {
  const range = rangeFromText(text, now);
  if (range) return { dueFrom: range.from, dueTo: range.to };
  const written = writtenDatesIn(text, now)[0]?.iso ?? /\b(\d{4}-\d{2}-\d{2})\b/.exec(text)?.[1] ?? null;
  const relative = /\b(day after tomorrow|today|tomorrow|yesterday)\b/i.exec(text)?.[1];
  const day = written ?? (relative ? toIsoDate(relative.toLowerCase(), now) : null)
    ?? weekdayDateIn(text, now, { prefer: 'future' })?.iso ?? null;
  if (!day) return null;
  // "by Friday" / "before Friday": everything due up to then, from today.
  if (/\b(?:by|before|until|till|up\s+to)\b/i.test(text)) return { dueFrom: localToday(now), dueTo: day };
  return { dueFrom: day, dueTo: day };
}

/* ── Argument readers for the writes above ────────────────── */

/** Everything after the words that introduce a subject: "about …", "regarding …", ": …". */
function introducedText(text, noun) {
  const after = new RegExp(String.raw`\b${noun}\b\s*(?:titled|title[d:]?|called|named|with\s+(?:the\s+)?(?:subject|title)|subject\s*[:-]?|about|regarding|concerning|saying|that|for|on|[:—-])\s*(.+)$`, 'is').exec(text)?.[1];
  return tidy(after);
}

function hostelInquiryArgs(text) {
  const said = introducedText(text, String.raw`(?:inquiry|enquiry|complaint|issue|request)`);
  if (!said) return {};
  // A long account is a subject and its detail; a short one is the subject.
  if (said.length <= 200) return { subject: sentenceCase(said) };
  const cut = said.slice(0, 200).lastIndexOf(' ');
  return { subject: sentenceCase(said.slice(0, cut > 80 ? cut : 200)), description: sentenceCase(said) };
}

/**
 * The whole of what a ticket should say.
 *
 * A ticket carries only a subject, so the subject is everything the person
 * wrote after "ticket" -- never a clipped part of it, and never the room or
 * class it happens to mention. If that is longer than a subject may be, the
 * tool's own validation refuses it and says so; nothing is silently cut here.
 */
function ticketArgs(text) {
  const said = introducedText(text, 'ticket');
  // Nothing said about it: the placeholder subject the ticket rule has always
  // used, so "create support ticket" still opens one.
  return { subject: said ? sentenceCase(said) : 'Support Request' };
}

function admissionLeadArgs(text) {
  const args = {};
  const phone = /(?<![\d-])(\+?(?:91[\s-]?)?[6-9]\d{9})(?![\d-])/.exec(text)?.[1]?.replace(/[\s-]/g, '');
  if (phone) args.phone = phone;
  const email = /\b([\w.+-]+@[\w-]+(?:\.[\w-]+)+)\b/.exec(text)?.[1];
  if (email) args.email = email;
  const grade = /\b(?:for|in|to|into)\s+((?:class|grade|std|standard)\s*\d{1,2}(?:st|nd|rd|th)?(?:\s*[-–]?\s*[a-h])?|nursery|lkg|ukg|kg|pre[\s-]?primary|playgroup)\b/i.exec(text)?.[1];
  if (grade) args.gradeApplying = sentenceCase(grade.replace(/\s+/g, ' ').trim());
  const NAME = String.raw`([A-Z][\p{L}'.-]+(?:\s+[A-Z][\p{L}'.-]+){0,3})`;
  const guardian = new RegExp(String.raw`\b(?:guardian|parent|father|mother)(?:'s)?(?:\s+name)?\s*(?:is|:|-|named)?\s*${NAME}`, 'u').exec(text)?.[1];
  if (guardian) args.guardianName = guardian;
  const withoutGuardian = guardian ? text.split(guardian).join(' ') : text;
  const child = new RegExp(String.raw`\b(?:child|student|kid|son|daughter|applicant)(?:'s)?(?:\s+name)?\s*(?:is|:|-|named)?\s*${NAME}`, 'u').exec(withoutGuardian)?.[1]
    ?? new RegExp(String.raw`\b(?:lead|enquiry|inquiry)\s+for\s+${NAME}`, 'u').exec(withoutGuardian)?.[1];
  if (child && !/^(?:Class|Grade|Std|Standard)\b/.test(child)) args.childName = child;
  return args;
}

/* ── Refining a step another tier chose ───────────────────── */

const DATE_WORDS = String.raw`(?:today|tomorrow|yesterday|day\s+after\s+tomorrow|tonight|(?:next|coming|this|last)\s+(?:week|month)|(?:(?:next|coming|this|last)\s+)?(?:mon|tues|wednes|thurs|fri|satur|sun)day)`;
const ONLY_A_DATE = new RegExp(String.raw`^\s*(?:(?:on|from|for|till|until|to)\s+)?${DATE_WORDS}\s*$`, 'i');

/** A reason with the WHEN taken off its ends: "fever tomorrow" → "fever". */
function withoutDates(reason, now) {
  let text = String(reason ?? '');
  for (const written of writtenDatesIn(text, now)) text = text.split(written.text).join(' ');
  text = text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(new RegExp(String.raw`\b(?:on|from|starting|till|until|to|for)?\s*${DATE_WORDS}\b`, 'gi'), ' ')
    .replace(/\bfor\s+(?:\d+|one|two|three|four|five|six|seven)\s+(?:days?|din)\b/gi, ' ')
    .replace(/\s+/g, ' ');
  return tidy(text.replace(/^(?:and|,|-)\s+/i, '').replace(/\s+(?:on|from|for|to|till|until|and)$/i, ''));
}

/**
 * Why somebody wants leave, as they said it.
 *
 * Three ways it is said: after a marker ("because of fever", "due to a family
 * function", "as I am unwell"), after "for" when what follows is not the leave
 * or its dates ("for a family function"), and as the KIND of leave ("sick
 * leave"). The last was being thrown away: "apply sick leave tomorrow" asked
 * "what is the reason?" of somebody who had just given it.
 */
export function leaveReasonFrom(text, now = new Date()) {
  const str = String(text ?? '');
  const marked = /\b(?:because\s+of|because|due\s+to|owing\s+to|on\s+account\s+of|reason\s*(?:is|:|-)?|as\s+(?:i|my|we|he|she)\b|since\s+(?:i|my|we|he|she)\b)\s*(.{3,200})$/i.exec(str);
  if (marked) {
    const lead = /\b(as|since)\s+(i|my|we|he|she)\b/i.exec(marked[0]);
    const reason = withoutDates(lead ? `${lead[2]} ${marked[1]}` : marked[1], now);
    // As the person wrote it: a reason is their words, not a heading.
    if (reason.length >= 3) return reason;
  }
  const forWhat = [...str.matchAll(/\bfor\s+(.{3,200}?)(?=\s+\bfor\b|$)/gi)].map((m) => m[1]);
  for (const candidate of forWhat) {
    if (/^(?:a\s+|an\s+|the\s+|my\s+)?(?:sick\s+|casual\s+|medical\s+)?leaves?\b/i.test(candidate)) continue;
    if (/^(?:\d+|one|two|three|four|five|six|seven)\s+(?:days?|din)\b/i.test(candidate)) continue;
    // "for Rahul" / "for my child" names WHO, not why.
    if (/^(?:my\s+)?(?:child|son|daughter|kid|ward|myself|me)\b/i.test(candidate)) continue;
    if (nameFromText(`for ${candidate}`) && /^[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?\s*(?:on|from|tomorrow|today|$)/u.test(candidate)) continue;
    const reason = withoutDates(candidate, now);
    if (reason.length >= 3 && !ONLY_A_DATE.test(reason)) return reason;
  }
  const kind = /\b(sick|medical|casual|emergency|family|personal|maternity|bereavement|urgent)\s+leave\b/i.exec(str)?.[1];
  if (kind) return `${sentenceCase(kind.toLowerCase())} leave`;
  const state = /\b(?:i\s+am|i'm|he\s+is|she\s+is|(?:my\s+)?(?:child|son|daughter)\s+is)\s+(unwell|sick|ill|not\s+well|having\s+fever|down\s+with\s+[a-z ]{3,30})\b/i.exec(str);
  if (state) return state[0].trim();
  return null;
}

/** The dates a leave request names, each as a day still to come where the wording allows. */
function leaveDatesFrom(text, now) {
  const written = writtenDatesIn(text, now);
  const typed = [...text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((m) => m[1]);
  let iso = [...new Set([...typed, ...written.map((w) => w.iso)])].sort();
  // Leave is for days still to come: "from 5 October to 7 October", written
  // with no year after those days have passed, is the coming October -- the
  // rule the capability resolver already applies to an instruction. A date
  // that gives its year is kept as written, and refused if it is in the past.
  if (iso.length && !typed.length && written.every((w) => !w.yearGiven) && iso[0] < localToday(now)) {
    iso = iso.map((d) => `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`);
  }
  if (iso.length) return iso;
  const relative = /\b(day after tomorrow|today|tomorrow)\b/i.exec(text)?.[1];
  const start = relative ? toIsoDate(relative.toLowerCase(), now) : weekdayDateIn(text, now, { prefer: 'future' })?.iso ?? null;
  return start ? [start] : [];
}

/**
 * The words of an announcement, when the request did not set them apart.
 *
 * "Post an announcement for class 6b science practical on Monday" was proposed
 * as the announcement "Monday": the only reader that found anything was the
 * generic one for text after "on". The notice is everything the person wrote
 * after naming who it is for -- "Science practical on Monday" -- and nothing
 * shorter than that is ever what they meant.
 */
export function announcementTextFrom(text) {
  const str = String(text ?? '').trim();
  // Set apart by the writer: quotes, a colon, "saying", "that". Those are read
  // by the announcement rule already; this only handles the run-on form.
  if (/["“”]/.test(str) || /\bannounce(?:ment)?\b[^:]*(?:\bthat\s+|\bsaying\s+|:\s*)/i.test(str)) return null;
  const spokenClass = classFromText(str)?.text;
  let rest = /\b(?:announcement|notice|circular)\b(.*)$/is.exec(str)?.[1] ?? /^\s*(?:please\s+)?announce\b(.*)$/is.exec(str)?.[1];
  if (rest == null) return null;
  if (spokenClass) {
    rest = rest.replace(new RegExp(String.raw`\b(?:to|for|in|of)\s+(?:my\s+|the\s+)?${spokenClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\b`, 'i'), ' ')
      .split(spokenClass).join(' ');
  }
  rest = rest
    .replace(/\b(?:to|for)\s+(?:the\s+)?(?:whole|entire|all)?\s*(?:school|everyone|everybody|all\s+(?:students|parents|classes|teachers|staff))\b/gi, ' ')
    .replace(/\b(?:to|for)\s+my\s+(?:class(?:es)?|students)\b/gi, ' ')
    .replace(/^\s*(?:about|regarding|on|that|saying|for|to|[:,-])\s+/i, ' ')
    .replace(/\s+/g, ' ');
  const said = tidy(rest);
  return said.length >= 3 ? sentenceCase(said) : null;
}

/**
 * What an assignment request says beyond its class, subject and due date: the
 * work itself. "Create an assignment for class 6th b science chapter 4
 * questions due Friday" → "science chapter 4 questions". The subject is left
 * inside it on purpose: which word is the subject is decided against the
 * teacher's real class-subject records by the tool, not guessed here.
 */
export function assignmentWorkFrom(text) {
  const str = String(text ?? '').trim();
  const spokenClass = classFromText(str, { lenient: true })?.text;
  let rest = /\b(?:assignment|homework|worksheet|project)\b(.*)$/is.exec(str)?.[1];
  if (rest == null) return null;
  rest = rest.replace(/\b(?:due|by|before|deadline)\b.*$/is, ' ')
    // What it is CALLED is its title, read separately (assignmentTitleFrom).
    .replace(new RegExp(TITLED.source, 'i'), ' ')
    .replace(/\b(?:(?:out\s+of|max(?:imum)?\s+marks?(?:\s+of)?|for)\s+)?\d{1,4}\s*marks?\b/gi, ' ');
  if (spokenClass) {
    rest = rest.replace(new RegExp(String.raw`\b(?:to|for|in|of)\s+(?:my\s+|the\s+)?${spokenClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), ' ')
      .split(spokenClass).join(' ');
  }
  rest = rest.replace(/^\s*(?:for|on|about|in|of|[:,-])\s+/i, ' ').replace(/\s+/g, ' ');
  const said = tidy(rest);
  return said.length >= 3 ? said : null;
}

/** "titled Fractions worksheet", "called 'Unit 4 revision'": what a piece of work is named. */
const TITLED = /\b(?:titled|entitled|called|named|with\s+(?:the\s+)?title|title\s*[:-])\s*["“‘']?(.+?)["”’']?(?=\s+(?:due|by|before|for|to|in|on|with|worth|out\s+of)\b|\s*[,.;!?]?\s*$)/i;

/** The title a request gives its assignment, or null: only ever what the person called it. */
export function assignmentTitleFrom(text) {
  const str = String(text ?? '');
  const quoted = /["“”]([^"“”]{2,200})["“”]/.exec(str)?.[1];
  const called = TITLED.exec(str)?.[1];
  const title = tidy(called ?? quoted ?? '');
  return title.length >= 2 ? sentenceCase(title) : null;
}

/** The marks a request says an assignment carries, or null: never a number that merely appears in it. */
function statedMaxMarks(text) {
  const m = /\b(?:out\s+of|max(?:imum)?\s+marks?\s*(?:of|is|:|=)?|worth|for)\s*(\d{1,4})\s*marks?\b|\b(\d{1,4})\s*marks\b|\bmax(?:imum)?\s+marks?\s*(?:of|is|:|=)?\s*(\d{1,4})\b|\bout\s+of\s+(\d{1,4})\b/i.exec(String(text ?? ''));
  const n = m ? Number(m[1] ?? m[2] ?? m[3] ?? m[4]) : null;
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : null;
}

/**
 * A write step checked against everything the caller said across the turns
 * that built it.
 *
 * The generic readers fill a bounded number from any single number a sentence
 * holds. For homework that number is nearly always something else -- "chapter
 * 4", "Assignment 5" -- and it reached the confirmation as "maxMarks: 4". Marks
 * are kept only where the caller said marks.
 */
export function settleStep(step, saidTexts = []) {
  if (step?.tool !== 'create_assignment' || step.args?.maxMarks === undefined) return step;
  const stated = saidTexts.map(statedMaxMarks).find((n) => n !== null) ?? null;
  const { maxMarks, ...rest } = step.args;
  return { ...step, args: stated !== null ? { ...rest, maxMarks: stated } : rest };
}

const REGISTER_STATUS = 'absent|present|late|excused';

/**
 * Every pupil a marking sentence names, each with the status it gives them.
 *
 * "Mark Rahul Sharma and Aman Gupta absent today" names two pupils, and only
 * the last was proposed -- the reader took one name from the sentence. Nobody
 * was marked wrongly (the confirmation showed what would be written), but the
 * teacher asked for two and one was silently left out.
 *
 * The names sit between the verb and the status, joined by "and" or commas. A
 * name with no status of its own takes the next one stated ("Rahul and Aman
 * absent"); each may also carry its own ("Rahul absent and Aman present").
 * Returns null -- leaving the step exactly as it was -- unless there are at
 * least two and every one of them reads as a person's name: this never adds a
 * pupil the sentence did not plainly name, and the tool still resolves each
 * name at the caller's own scope and refuses one it cannot find.
 */
export function studentsToMark(text) {
  const tail = new RegExp(String.raw`^\s*(?:please\s+)?(?:mark|record|set|enter)\s+(?:attendance\s+(?:of|for)\s+)?(.+)$`, 'i').exec(String(text ?? ''))?.[1];
  if (!tail || !/,|\band\b|&/i.test(tail)) return null;
  const NAME = /^[\p{L}][\p{L}.'’-]*(?:\s+[\p{L}][\p{L}.'’-]*){0,2}$/u;
  const NOT_A_PUPIL = /^(?:attendance|students?|pupils?|everyone|everybody|all|the|class|him|her|them|me|today|tomorrow|yesterday)$/i;
  const entries = [];
  for (const segment of tail.split(/\s*(?:,|\band\b|&)\s*/i).map((s) => s.trim()).filter(Boolean)) {
    const stated = new RegExp(String.raw`^(.+?)\s+(?:as\s+)?(${REGISTER_STATUS})\b`, 'i').exec(segment);
    // The verb said again is not part of the name: "mark Rahul absent and
    // mark Aman present" names Aman, not "mark Aman".
    const name = (stated ? stated[1] : segment).replace(/^(?:mark|record|set|enter)\s+/i, '').replace(/['’]s\s+attendance$/i, '').trim();
    if (!NAME.test(name) || NOT_A_PUPIL.test(name) || classFromText(name)) return null;
    entries.push({ studentName: name, status: stated ? stated[2].toUpperCase() : null });
  }
  if (entries.length < 2) return null;
  // A name without a status takes the next one stated after it.
  for (let i = entries.length - 1, next = null; i >= 0; i -= 1) {
    if (entries[i].status) next = entries[i].status;
    else if (next) entries[i].status = next;
    else return null;
  }
  return entries;
}

/**
 * A step with its arguments corrected from the sentence as written.
 *
 * Applied to whatever a tier chose. Each branch knows one capability's
 * arguments better than a generic reader can -- which words are the notice,
 * which are the reason, which are only the date -- and changes nothing about
 * WHICH capability runs, who may run it, or whether it must be confirmed.
 */
export function refineStep(step, message, actor, now = new Date()) {
  if (!step?.tool) return step;
  const text = String(message ?? '');
  const args = { ...(step.args ?? {}) };

  if (step.tool === 'apply_for_leave') {
    const dates = leaveDatesFrom(text, now);
    if (dates.length) {
      args.fromDate = dates[0];
      args.toDate = dates[1] ?? args.toDate ?? dates[0];
      // "for three days" from a single start date.
      const span = /\bfor\s+(\d+|one|two|three|four|five|six|seven)\s+(?:days?|din)\b/i.exec(text)?.[1];
      if (span && dates.length === 1) {
        const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
        const n = Number(span) || WORDS[span.toLowerCase()] || 1;
        const [y, m, d] = dates[0].split('-').map(Number);
        const end = new Date(y, m - 1, d + n - 1);
        args.toDate = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
      } else if (dates.length === 1) {
        args.toDate = dates[0];
      }
    }
    const reason = leaveReasonFrom(text, now);
    if (reason) args.reason = reason;
    // A "reason" that is only the date again ("Monday") is not one: dropped,
    // so the tool asks for the real reason instead of proposing nonsense.
    else if (typeof args.reason === 'string' && (ONLY_A_DATE.test(args.reason) || withoutDates(args.reason, now).length < 3)) delete args.reason;
    return { ...step, args };
  }

  if (step.tool === 'create_announcement') {
    const said = announcementTextFrom(text);
    if (said && (!args.title || said.length > String(args.title).length)) {
      args.title = said;
      args.content = said;
    }
    return { ...step, args };
  }

  if (step.tool === 'create_assignment') {
    const spokenClass = classFromText(text, { lenient: true })?.text;
    if (spokenClass && !args.className) args.className = spokenClass;
    // What the person CALLED it, when they did; and marks only where they
    // said marks.
    const called = assignmentTitleFrom(text);
    if (called) args.title = called;
    const stated = statedMaxMarks(text);
    if (stated !== null) args.maxMarks = stated; else delete args.maxMarks;
    const work = assignmentWorkFrom(text);
    // The work described goes in the description, where the tool reads the
    // subject out of it against the teacher's own classes. A title is only
    // ever what the person CALLED it, so the tool still asks for one.
    const same = (a, b) => String(a ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') === String(b ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    if (work && !args.description && !same(work, args.title) && !same(work, args.subject)) {
      args.description = sentenceCase(work);
    }
    return { ...step, args };
  }

  if (step.tool === 'create_ticket') {
    const said = introducedText(text, 'ticket');
    if (said && said.length >= String(args.subject ?? '').length) args.subject = sentenceCase(said);
    return { ...step, args };
  }

  if (step.tool === 'mark_attendance' && !args.everyone) {
    const several = studentsToMark(text);
    if (several) return { ...step, args: { ...args, students: several } };
    return step;
  }

  if (step.tool === 'get_at_risk_students' && LOW_ATTENDANCE.test(text) && args.attendanceBelowPct === undefined) {
    return { ...step, args: { ...args, attendanceBelowPct: ATTENDANCE_SAFE_PCT } };
  }

  return step;
}

/* ── Things the orchestrator declines before routing ──────── */

/**
 * A request for the school's money as a whole, from somebody who may read only
 * their own.
 *
 * A student or a parent holds `fees.read` at OWN scope: their own invoices.
 * "Show school fee collection" from either was answered with their own balance
 * -- a true figure presented as the answer to a different question. It is
 * declined as what it is, and what they CAN ask is offered.
 */
export function asksSchoolWideFees(message, actor) {
  const text = String(message ?? '');
  if (scopeOf(actor, 'fees.read') !== 'OWN') return false;
  // An instruction that merely mentions fees -- "raise a ticket about my fee
  // receipt" -- is not a question about the school's collection.
  if (WRITE_LEAD.test(text) || TICKET_CREATE.test(text)) return false;
  return FEE_COLLECTION.test(text) || SCHOOL_WIDE_FEES.test(text);
}

const APPLY_LEAVE = /\bapply\b[^?.!]*\bleave\b|\bleave\b[^?.!]*\bapplication\b|\b(?:want|need|require|take|request)\b[^?.!]*\bleave\b|\b(?:sick|medical|casual)\s+leave\b|\bday\s+off\b/i;

/**
 * A leave application from an account that may read leave but not apply for it.
 *
 * In the role matrix as shipped, `leave.apply` is held by the STUDENT (and the
 * administrator); a PARENT holds only `leave.read`. The Web has no parent
 * leave form either, so this is the approved model and not a routing fault --
 * but the refusal used to be the bare "you are not authorized to access this
 * information", which told a parent nothing about what to do instead. Decided
 * by the permissions held, never by the role's name: a school that grants its
 * parents `leave.apply` stops seeing this the same day.
 */
export function asksLeaveWithoutPermission(message, actor) {
  if (actor?.permissions?.['leave.apply'] || !actor?.permissions?.['leave.read']) return false;
  // Part 3: a member of staff (anyone holding staffleave.apply) asking to apply
  // for leave is asking for their OWN staff leave, which they may apply for
  // (apply_staff_leave), whatever words they use. See staffLeaveStep() below.
  if (actor?.permissions?.['staffleave.apply']) return false;
  const text = String(message ?? '');
  return APPLY_LEAVE.test(text) && !/\b(?:status|history|list|show|view|approve|reject|pending|requests?|applications|review)\b/i.test(text);
}

/**
 * "Mark him present", "show his marks": a pronoun where a student has to be.
 * True when the sentence names nobody itself, so only an earlier turn could
 * say who is meant.
 */
export function namesOnlyAPronoun(message) {
  const text = String(message ?? '');
  if (!/\b(?:him|her|his|hers|them|their|he|she|they)\b/i.test(text)) return false;
  const named = dimensionsOf(text);
  return !named.student && !named.admissionNo && !nameFromText(withoutLeadingVerb(text)) && !admissionNoFromText(text);
}

/** "attendance" / "marks" / "exam" on its own: the answer to "which percentage?". */
export const PERCENTAGE_QUESTION = /^\s*(?:(?:what(?:'s|\s+is)|show|tell\s+me|give\s+me)\s+)?(?:my|his|her|(?:my\s+)?(?:child|son|daughter)(?:'s|’s)?)?\s*(?:overall\s+|total\s+|current\s+)?(?:percentage|percent|%)\s*[?.!]*\s*$/i;


/* ── Part 3: a member of staff applying for leave means their own staff leave ── */

/** The staff leave type a sentence names, or null. Codes as staffLeave.service uses them. */
const STAFF_LEAVE_TYPE_WORDS = [
  [/\bcasual\b|\bCL\b/, 'CL'],
  [/\b(?:sick|medical|fever|unwell|ill(?:ness)?)\b|\bSL\b/i, 'SL'],
  [/\b(?:earned|privilege)\b|\bEL\b/, 'EL'],
  [/\bduty\b|\bDL\b/, 'DL'],
  [/\bmaternity\b/i, 'ML'],
  [/\bpaternity\b/i, 'PL'],
  [/\bwithout\s+pay\b|\bunpaid\b|\bLWP\b/i, 'LWP'],
];
export function staffLeaveTypeFrom(text) {
  const t = String(text ?? '');
  for (const [re, code] of STAFF_LEAVE_TYPE_WORDS) if (re.test(t)) return code;
  return null;
}

/**
 * The student-leave step turned into the caller's own staff leave.
 *
 * "Apply for leave", "apply for leave tomorrow", "I need leave on Monday",
 * "take casual leave on 20 Oct": the rule parser (and a model) read these as
 * apply_for_leave, a STUDENT's leave of absence. A member of staff holds
 * staffleave.apply and means their own leave, so the step becomes
 * apply_staff_leave with the same dates and reason, and the leave type read
 * from the sentence. Anything missing (the date, the type, the reason) is left
 * out, so the tool's own schema check asks for it; nothing is guessed.
 *
 * Students and parents do not hold staffleave.apply: their step is returned
 * untouched and keeps the student-leave behaviour.
 */
export function staffLeaveStep(step, message, actor, now = new Date(), { said = [] } = {}) {
  if (step?.tool !== 'apply_for_leave' || !actor?.permissions?.['staffleave.apply']) return step;
  const text = String(message ?? '');
  const refinedArgs = refineStep(step, text, actor, now)?.args ?? step.args ?? {};
  // The kind of leave may have been given in an earlier answer of the same
  // request ("apply for leave" / "tomorrow" / "casual" / "family function").
  const type = staffLeaveTypeFrom(text) ?? [...said].reverse().map(staffLeaveTypeFrom).find(Boolean) ?? null;
  const halfDay = /\bhalf[-\s]?day\b/i.test(text) ? (/\b(?:afternoon|second half|post[-\s]?lunch)\b/i.test(text) ? 'SECOND_HALF' : 'FIRST_HALF') : null;
  let reason = typeof refinedArgs.reason === 'string' ? refinedArgs.reason.trim() : '';
  // A reason that is only the leave type ("casual leave") is not a reason.
  if (/^(?:a\s+)?(?:casual|sick|medical|earned|duty|maternity|paternity|staff|half[-\s]?day)?\s*leaves?$/i.test(reason)) reason = '';
  // A sick-leave sentence's illness is its reason ("leave tomorrow because of fever" already has one).
  const args = {
    ...(type && { type }),
    ...(refinedArgs.fromDate && { fromDate: refinedArgs.fromDate }),
    ...(refinedArgs.toDate && refinedArgs.toDate !== refinedArgs.fromDate && { toDate: refinedArgs.toDate }),
    ...(halfDay && { halfDay }),
    ...(reason && { reason: reason.slice(0, 1000) }),
  };
  return { ...step, tool: 'apply_staff_leave', args };
}

/**
 * What to ask when a staff leave request is missing something, in the order a
 * person would answer: the day first, then the kind of leave, then why.
 * Null when nothing is missing.
 */
export function staffLeaveQuestion(args = {}) {
  if (!args.fromDate) return 'Which day (or days) do you want leave for? For example "tomorrow", "Monday", or "20 to 22 October".';
  if (!args.type) return 'Which kind of leave is it: casual, sick, earned, duty, or leave without pay?';
  if (!args.reason) return 'What is the reason for the leave? A few words are enough.';
  return null;
}

/**
 * True when a member of staff is asking to apply for leave (their own staff
 * leave), as opposed to reading, reviewing or cancelling leave.
 */
export function isStaffLeaveApplication(message, actor) {
  if (!actor?.permissions?.['staffleave.apply']) return false;
  const text = String(message ?? '');
  return APPLY_LEAVE.test(text) && !/\b(?:status|history|list|show|view|approve|reject|pending|balance|requests|applications|review|cancel|withdraw|how\s+many)\b/i.test(text);
}
