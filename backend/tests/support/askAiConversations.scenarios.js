import { toIsoDate, weekdayDateIn } from '../../src/utils/naturalDates.js';

/**
 * Realistic multi-turn Ask AI conversations, one role at a time, replayed by
 * tests/askAi.conversations.test.js through the website's own HTTP route (and,
 * where marked, WhatsApp). Each turn says what a correct assistant does:
 *
 *   say        what the person types
 *   tool       the capability the turn must end on (a name, a list of acceptable names, or a RegExp)
 *   args       arguments that must have been carried into that call (subset match)
 *   noCall     true when the turn must NOT read or write anything (a question back, a refusal)
 *   action     true: a draft is waiting for this person's confirmation; false: none is
 *   press      'confirm' | 'cancel': press the website's button on the draft instead of typing
 *   reply      RegExp(s) the reply must match;   notReply  RegExp(s) it must not
 *   executed   true when the turn must have carried out a confirmed write
 *   check      async ({ school, inSchool }) => void: database assertions after the turn
 *
 * Every turn is also checked for GROUNDING by the harness: every name of a
 * person in the fixture and every figure in the reply must come from what the
 * turn's tools returned (or from what the person typed). And `forbid` names
 * people the conversation must never mention at all (outside the caller's scope).
 *
 * Dates are computed, never written in, so the suite runs on any day.
 */

const today = () => toIsoDate('today');
const yesterday = () => toIsoDate('yesterday');
const nextWeekday = (name) => weekdayDateIn(name, new Date(), { prefer: 'future' }).iso;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const date = (fn) => ({ get source() { return escape(fn()); } });

/** People outside every Oakridge teacher's/parent's reach, and the other school. */
const OTHER_SCHOOL = ['Rahul Riverside'];
const NOT_TEACHERS = ['Ishaan Bose', 'Tara Iyer', 'Dev Sharma', 'Meera Nair', 'Rohan Desai', ...OTHER_SCHOOL];
const NOT_PARENTS = ['Aman Gupta', 'Priya Verma', 'Aarav Mishra', 'Ananya Mishra', 'Tara Iyer', 'Dev Sharma', 'Meera Nair', 'Rohan Desai', 'Ishaan Bose', ...OTHER_SCHOOL];
const NOT_STUDENT = ['Rahul Sharma', 'Aman Gupta', 'Riya Kapoor', 'Aarav Mishra', 'Ananya Mishra', 'Tara Iyer', 'Dev Sharma', 'Meera Nair', 'Rohan Desai', 'Ishaan Bose', ...OTHER_SCHOOL];

/** A reply that asks the person something. */
const ASKS = /\?/;
/** A reply that honestly says there is nothing / it is not available. */
const NOTHING = /\bno\b|\bnot\b|\bnone\b|\bnothing\b|n't|\b0\b|isn't|aren't|don't|can't/i;
/** A question back, or a child's name in the answer. */
const ASKS_OR_NAME = /\?|Name a student|Rahul|Riya/;
/** "I'm not sure what you need" -- the coverage failure Step 3 counts. */
export const UNSURE = /I'm not sure what you need|मुझे यकीन नहीं/;

export const SCENARIOS = [
  /* ───────────────────────────── TEACHER ───────────────────────────── */
  {
    id: 'teacher-ellipsis-absent-message',
    role: 'TEACHER',
    title: 'class attendance → "and 6A?" → "who was absent?" → "message their parents" → text → confirm',
    forbid: NOT_TEACHERS,
    turns: [
      { say: 'show attendance for Class 5 A', tool: 'get_attendance_roster', args: { className: 'Class 5 A' }, reply: /Ananya Mishra/ },
      { say: 'and 6A?', tool: 'get_attendance_roster', args: { className: 'Class 6 A' }, reply: /Rahul Sharma/ },
      { say: 'who was absent?', tool: 'get_attendance_roster', args: { className: 'Class 6 A' }, reply: /Rahul Sharma/, notReply: /Which class/ },
      { say: 'message their parents', tool: 'send_conversation_message', args: { studentName: 'Rahul Sharma' }, reply: /what the message should say|\?/i, notReply: /Which student\?/ },
      { say: 'Rahul was absent today, please let me know if all is well.', tool: 'send_conversation_message', action: true, reply: /Rahul/ },
      { press: 'confirm', executed: true },
    ],
  },
  {
    id: 'teacher-message-several',
    role: 'TEACHER',
    title: '"message their parents" after an answer naming several students asks which, never sends to a group',
    forbid: NOT_TEACHERS,
    turns: [
      { say: 'show students of Class 6 A', tool: 'search_students' },
      { say: 'message their parents', noCall: true, action: false, reply: [/Rahul Sharma/, /Aman Gupta/, /one message per student/] },
    ],
  },
  {
    id: 'teacher-compact-class',
    role: 'TEACHER',
    title: '"show 6A attendance" names the class without the word "Class"',
    forbid: NOT_TEACHERS,
    turns: [
      { say: 'show 6A attendance', tool: 'get_attendance_roster', args: { className: 'Class 6 A' }, notReply: /Which class/ },
      { say: 'and 6B?', tool: 'get_attendance_roster', args: { className: 'Class 6 B' } },
    ],
  },
  {
    id: 'teacher-correction-yesterday',
    role: 'TEACHER',
    title: 'a correction: "no, I meant yesterday" re-asks the same read for yesterday',
    forbid: NOT_TEACHERS,
    turns: [
      { say: 'who was absent in Class 5 A today?', tool: 'get_attendance_roster', args: { className: 'Class 5 A' }, reply: /Ananya Mishra/ },
      { say: 'no, I meant yesterday', tool: 'get_attendance_roster', args: { className: 'Class 5 A', date: date(yesterday) }, notReply: /Timetable/ },
    ],
  },
  {
    id: 'teacher-correction-class',
    role: 'TEACHER',
    title: 'a correction of the class: "sorry, I meant 6 B"',
    forbid: NOT_TEACHERS,
    turns: [
      { say: 'show attendance for Class 6 A', tool: 'get_attendance_roster', args: { className: 'Class 6 A' } },
      { say: 'sorry, I meant 6 B', tool: 'get_attendance_roster', args: { className: 'Class 6 B' }, reply: /Riya Kapoor|6 B/ },
    ],
  },
  {
    id: 'teacher-draft-edit',
    role: 'TEACHER',
    title: 'continuing a draft: "make it Monday instead", then "yes"',
    forbid: NOT_TEACHERS,
    turns: [
      { say: 'create homework for Class 6 A Mathematics titled Algebra set 2 due Friday', tool: 'create_assignment', action: true, reply: date(() => nextWeekday('Friday')) },
      { say: 'make it Monday instead', tool: 'create_assignment', action: true, args: { title: 'Algebra set 2', dueAt: date(() => nextWeekday('Monday')) }, reply: date(() => nextWeekday('Monday')) },
      { say: 'yes', executed: true, reply: /Algebra set 2/, check: 'assignmentDueMonday' },
    ],
  },
  {
    id: 'teacher-draft-retitle',
    role: 'TEACHER',
    title: 'editing a draft\'s title, then cancelling by typing "no"',
    forbid: NOT_TEACHERS,
    turns: [
      { say: 'create homework for Class 6 A Mathematics titled Algebra set 2 due Friday', tool: 'create_assignment', action: true },
      { say: 'change the title to Algebra revision', tool: 'create_assignment', action: true, args: { title: 'Algebra revision' }, reply: /Algebra revision/ },
      { say: 'no', action: false, reply: /not made any changes|cancel/i, check: 'noAssignmentCreated' },
    ],
  },
  {
    id: 'teacher-clarification-next-turn',
    role: 'TEACHER',
    title: 'a clarification answered in the next turn',
    forbid: NOT_TEACHERS,
    turns: [
      { say: 'Show attendance for my class', noCall: false, reply: /Which class\?/ },
      { say: '5 A', tool: 'get_attendance_roster', args: { className: 'Class 5 A' }, reply: /Ananya Mishra/ },
    ],
  },
  {
    id: 'teacher-student-pronoun-write',
    role: 'TEACHER',
    title: 'a student, then "his marks", then "mark him absent yesterday", then "no"',
    forbid: NOT_TEACHERS,
    turns: [
      { say: 'show Rahul Sharma attendance', tool: 'get_student_attendance', args: { studentName: 'Rahul Sharma' } },
      { say: 'and his marks?', tool: 'get_report_card', args: { studentName: 'Rahul Sharma' }, reply: /Rahul Sharma/ },
      { say: 'mark him absent yesterday', tool: 'mark_attendance', action: true, reply: /Rahul Sharma/ },
      { say: 'no', action: false, reply: /not made any changes|cancel/i },
    ],
  },
  {
    id: 'teacher-back-to-earlier-topic',
    role: 'TEACHER',
    title: 'going back to an earlier topic after something else',
    forbid: NOT_TEACHERS,
    turns: [
      { say: 'show attendance for Class 5 A', tool: 'get_attendance_roster', args: { className: 'Class 5 A' } },
      { say: 'show my timetable', tool: 'get_timetable' },
      { say: 'go back to the 5A attendance', tool: 'get_attendance_roster', args: { className: 'Class 5 A' }, reply: /Ananya Mishra/ },
    ],
  },
  {
    id: 'teacher-data-and-action',
    role: 'TEACHER',
    title: 'one message mixing a question and an action',
    forbid: NOT_TEACHERS,
    turns: [
      { say: 'show attendance of Class 6 A and mark Aman Gupta absent', tool: 'mark_attendance', action: true, reply: [/Rahul Sharma/, /Aman Gupta/] },
      { press: 'cancel', executed: false },
    ],
  },
  {
    id: 'teacher-scope',
    role: 'TEACHER',
    title: 'another teacher\'s class is refused, and a follow-up does not get around it',
    forbid: NOT_TEACHERS,
    turns: [
      { say: 'show attendance for Class 9 B', reply: /not one of your classes/ },
      { say: 'and 10 A?', reply: /not one of your classes/ },
    ],
  },
  {
    id: 'teacher-show-more-nothing',
    role: 'TEACHER',
    title: '"show more" after a complete answer says so honestly',
    forbid: NOT_TEACHERS,
    turns: [
      { say: 'show attendance for Class 5 A', tool: 'get_attendance_roster' },
      { say: 'show more', noCall: true, reply: /all|everything|nothing more|no more/i, notReply: UNSURE },
    ],
  },
  {
    id: 'teacher-honest-missing',
    role: 'TEACHER',
    title: 'a question with no data behind it is answered honestly, never invented',
    forbid: NOT_TEACHERS,
    turns: [
      { say: 'show homework for Class 6 B', reply: NOTHING },
    ],
  },

  /* ───────────────────────────── PARENT (two children) ───────────────────────────── */
  {
    id: 'parent-which-child',
    role: 'PARENT',
    title: 'two children: the assistant asks which, and the answer finishes the question',
    forbid: NOT_PARENTS,
    turns: [
      { say: "show my child's attendance", reply: ASKS },
      { say: 'Riya', tool: 'get_student_attendance', args: { studentName: 'Riya' }, reply: /Riya Kapoor/, notReply: /Rahul/ },
    ],
  },
  {
    id: 'parent-switch-child-fees',
    role: 'PARENT',
    title: 'switching child: "what about Riya?" after Rahul\'s fees',
    forbid: NOT_PARENTS,
    turns: [
      { say: "show Rahul's fees", reply: /8,000/ },
      { say: 'what about Riya?', reply: /2,500/, notReply: /8,000/ },
    ],
  },
  {
    id: 'parent-her-fees',
    role: 'PARENT',
    title: '"and her fees?" after Riya\'s attendance is Riya\'s fees, never Rahul\'s',
    forbid: NOT_PARENTS,
    turns: [
      { say: "how is Riya's attendance?", tool: 'get_student_attendance', args: { studentName: 'Riya' } },
      { say: 'and her fees?', reply: /2,500/, notReply: /8,000/ },
      { say: 'what about Rahul?', reply: /8,000/ },
    ],
  },
  {
    id: 'parent-scope',
    role: 'PARENT',
    title: 'another family\'s child is refused, and context never carries it',
    forbid: NOT_PARENTS.filter((n) => n !== 'Aman Gupta'),
    turns: [
      { say: "show Aman Gupta's attendance", notReply: [/\d+%/, /Present/] },
      { say: 'and his fees?', notReply: [/5,000/, /INV-1002/] },
    ],
  },
  {
    id: 'parent-show-more-nothing',
    role: 'PARENT',
    title: '"show more" with nothing before it',
    forbid: NOT_PARENTS,
    turns: [
      { say: 'show more', noCall: true, notReply: UNSURE },
    ],
  },

  /* ───────────────────────────── STUDENT ───────────────────────────── */
  {
    id: 'student-period-followups',
    role: 'STUDENT',
    title: 'own attendance, "last month", marks, and a question about others refused',
    forbid: NOT_STUDENT,
    turns: [
      { say: 'my attendance', tool: 'get_attendance' },
      { say: 'what about last month?', tool: 'get_attendance', args: { month: { source: '\\d{4}-\\d{2}' } } },
      { say: 'and my marks?', tool: 'get_report_card', reply: /Priya Verma/ },
      { say: 'who was absent today in my class?', noCall: true, reply: /own records/ },
    ],
  },
  {
    id: 'student-due-first',
    role: 'STUDENT',
    title: 'homework, then "which one is due first?"',
    forbid: NOT_STUDENT,
    turns: [
      { say: 'show my homework', tool: 'get_assignments' },
      { say: 'which one is due first?', tool: 'get_assignments', reply: /Algebra set 1/ },
    ],
  },
  {
    id: 'student-scope',
    role: 'STUDENT',
    title: 'another student\'s marks are refused',
    forbid: NOT_STUDENT.filter((n) => n !== 'Rahul Sharma'),
    turns: [
      { say: "show Rahul Sharma's marks", notReply: [/70%/, /B2/] },
    ],
  },

  /* ───────────────────────────── PRINCIPAL ───────────────────────────── */
  {
    id: 'principal-clarify-then-class',
    role: 'PRINCIPAL',
    title: 'a clarification answered next turn, then another class by ellipsis',
    forbid: OTHER_SCHOOL,
    turns: [
      { say: 'Show highest scores.', reply: /Which class\?/ },
      { say: 'Class 10 A', tool: 'get_class_marks', args: { className: 'Class 10 A' }, reply: /Tara Iyer|48/ },
      { say: 'and 5 A?', tool: 'get_class_marks', args: { className: 'Class 5 A' } },
    ],
  },
  {
    id: 'principal-risk-show-more',
    role: 'PRINCIPAL',
    title: 'at-risk students, then "show more" (all already shown), then a class by name',
    forbid: OTHER_SCHOOL,
    turns: [
      { say: 'show at risk students', tool: 'get_at_risk_students', reply: /Rohan Desai/ },
      { say: 'show more', noCall: true, notReply: UNSURE },
      { say: 'what about Class 10 B attendance?', tool: 'get_attendance_roster', args: { className: 'Class 10 B' } },
    ],
  },

  /* ───────────────────────────── ADMIN ───────────────────────────── */
  {
    id: 'admin-students-ellipsis',
    role: 'ADMIN',
    title: 'student count, then "in 6A?", then "and 6B?"',
    forbid: OTHER_SCHOOL,
    turns: [
      { say: 'how many students are there?', tool: 'search_students', reply: /11/ },
      { say: 'in 6A?', tool: 'search_students', reply: /Aman Gupta/, notReply: /Ishaan Bose/ },
      { say: 'and 6B?', tool: 'search_students', reply: /Riya Kapoor/, notReply: /Aman Gupta/ },
    ],
  },
  {
    id: 'admin-fees-person-switch',
    role: 'ADMIN',
    title: 'one student\'s fees, then another by name',
    forbid: OTHER_SCHOOL,
    turns: [
      { say: 'show pending fees for Rahul Sharma', tool: 'get_pending_fees', reply: /8,000/ },
      { say: 'and Aman Gupta?', tool: 'get_pending_fees', reply: /5,000/, notReply: /8,000/ },
    ],
  },

  /* ───────────────────────────── FINANCE ───────────────────────────── */
  {
    id: 'finance-overdue-then-invoice',
    role: 'FINANCE',
    title: 'overdue invoices, then one invoice by number',
    forbid: OTHER_SCHOOL,
    turns: [
      { say: 'show overdue invoices', tool: 'get_pending_fees', reply: [/overdue/i, /8,000/] },
      { say: 'what about INV-1002?', tool: 'get_invoice', args: { invoiceNo: 'INV-1002' }, reply: /5,000/ },
    ],
  },
  {
    id: 'finance-never-decides',
    role: 'FINANCE',
    title: 'recording a payment is never done by the assistant on its own',
    forbid: OTHER_SCHOOL,
    turns: [
      { say: 'mark INV-1001 as paid', executed: false, notReply: /has been (recorded|marked)/i },
    ],
  },

  /* ───────────────────────────── LIBRARIAN ───────────────────────────── */
  {
    id: 'librarian-overdue-who',
    role: 'LIBRARIAN',
    title: 'overdue books, who has one, and "show more"',
    forbid: OTHER_SCHOOL,
    turns: [
      { say: 'which books are overdue?', tool: ['get_overdue_books', 'list_overdue_loans'], reply: /Clean Code/ },
      { say: 'who has Clean Code?', tool: 'list_book_issues', reply: /Priya Verma/ },
      { say: 'show more', noCall: true, notReply: UNSURE },
    ],
  },
  {
    id: 'librarian-remind',
    role: 'LIBRARIAN',
    title: '"remind them" after the overdue list drafts the overdue reminders',
    forbid: OTHER_SCHOOL,
    turns: [
      { say: 'which books are overdue?', tool: ['get_overdue_books', 'list_overdue_loans'] },
      { say: 'remind them', tool: 'send_library_overdue_reminders', notReply: [/Which student\?/, UNSURE] },
    ],
  },

  /* ───────────────────────────── WARDEN ───────────────────────────── */
  {
    id: 'warden-room-occupants',
    role: 'WARDEN',
    title: 'rooms with free beds, then who is in one of them',
    forbid: OTHER_SCHOOL,
    turns: [
      { say: 'show hostel rooms with free beds', tool: 'list_hostel_rooms', reply: /H-101/ },
      { say: 'who is in H-101?', tool: ['list_hostel_allocations', 'get_hostel_residents'], reply: /Rahul Sharma/, notReply: UNSURE },
    ],
  },

  /* ───────────────────────────── HR ───────────────────────────── */
  {
    id: 'hr-leave-never-decides',
    role: 'HR',
    title: 'pending staff leave, then "approve it" is never decided by the assistant alone',
    forbid: OTHER_SCHOOL,
    turns: [
      { say: 'show pending staff leave', tool: 'list_staff_leave', reply: /Family function|1/ },
      { say: 'approve it', executed: false, notReply: /has been approved/i },
    ],
  },

  /* ───────────────────────────── NURSE ───────────────────────────── */
  {
    id: 'nurse-visits-period',
    role: 'NURSE',
    title: 'today\'s health-room visits, then "what about yesterday?"',
    forbid: OTHER_SCHOOL,
    turns: [
      { say: "show today's health room visits", tool: ['list_health_visits', 'get_health_visits_today'], reply: NOTHING },
      { say: 'what about yesterday?', tool: 'list_health_visits', args: { from: date(yesterday) }, reply: NOTHING },
    ],
  },

  /* ───────────────────────────── ALUMNUS ───────────────────────────── */
  {
    id: 'alumnus-events-jobs',
    role: 'ALUMNUS',
    title: 'alumni events, then job opportunities -- honest when there are none',
    forbid: OTHER_SCHOOL,
    turns: [
      { say: 'show alumni events', tool: 'list_alumni_events', reply: NOTHING },
      { say: 'what jobs are posted?', tool: 'list_alumni_opportunities', reply: NOTHING, notReply: UNSURE },
    ],
  },

  /* ───────────────────────────── Coverage: questions once answered "I'm not sure" ───────────────────────────── */
  ...[
    ['TEACHER', 'how did Class 5 A do in Unit Test 2?', 'get_class_marks', /average/],
    ['TEACHER', 'any messages from parents?', 'list_conversations', NOTHING],
    ['TEACHER', 'show my leave balance', 'get_staff_leave_balance'],
    ['PARENT', 'how is my child doing this month?', 'get_student_overview', ASKS_OR_NAME],
    ['STUDENT', 'who teaches me maths?', 'get_subjects', /Mathematics/],
    ['ADMIN', "show today's visitors", 'get_visitors_on_site', NOTHING],
    ['WARDEN', 'who is on outpass today?', 'list_outpasses', NOTHING],
    ['WARDEN', "show tonight's roll call", 'get_hostel_roll_call'],
    ['HR', 'who is on leave today?', 'list_staff_leave', NOTHING],
    ['HR', 'show the staff directory', 'list_users'],
    ['HR', 'show leave balances', 'get_staff_leave_balances'],
    ['HR', 'show CPD hours', 'list_staff_cpd_hours'],
    ['PRINCIPAL', 'how many teachers are absent today?', 'list_staff_leave', NOTHING],
    ['FINANCE', 'show the fee structure for Class 6', 'get_fee_structures'],
    ['PRINCIPAL', 'how many students visited the health room this week?', 'get_health_room_summary', /Counts only/],
  ].map(([role, say, tool, reply]) => ({
    id: `coverage-${role.toLowerCase()}-${say.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    role,
    title: `coverage: "${say}"`,
    forbid: OTHER_SCHOOL,
    turns: [{ say, tool, notReply: UNSURE, ...(reply && { reply }) }],
  })),

  /* ───────────────────────────── The website after a page change or reload ─────────────────────────────
     `reload: true` drops the transcript the browser was holding (a page change used to remount the
     assistant and lose it) but keeps the conversation id; `newChat: true` drops both. */
  {
    id: 'web-memory-after-reload',
    role: 'TEACHER',
    title: 'the conversation survives a page change: the server remembers it',
    forbid: NOT_TEACHERS,
    turns: [
      { say: 'show attendance for Class 6 A', tool: 'get_attendance_roster', args: { className: 'Class 6 A' } },
      { reload: true, say: 'and 5A?', tool: 'get_attendance_roster', args: { className: 'Class 5 A' }, reply: /Ananya Mishra/ },
      { reload: true, say: 'who was absent?', tool: 'get_attendance_roster', args: { className: 'Class 5 A' }, reply: /Ananya Mishra/ },
    ],
  },
  {
    id: 'web-draft-after-reload',
    role: 'TEACHER',
    title: 'a draft stays editable after a reload, and "yes" confirms it',
    forbid: NOT_TEACHERS,
    turns: [
      { say: 'create homework for Class 6 A Mathematics titled Algebra set 2 due Friday', tool: 'create_assignment', action: true },
      { reload: true, say: 'make it Monday instead', tool: 'create_assignment', action: true, reply: date(() => nextWeekday('Monday')) },
      { reload: true, say: 'yes', executed: true, check: 'assignmentDueMonday' },
    ],
  },
  {
    id: 'web-new-chat-forgets',
    role: 'TEACHER',
    title: 'a new chat starts fresh: nothing is carried into it',
    forbid: NOT_TEACHERS,
    turns: [
      { say: 'show attendance for Class 6 A', tool: 'get_attendance_roster' },
      { newChat: true, say: 'who was absent?', notReply: /Rahul Sharma/ },
    ],
  },

  /* ───────────────────────────── WhatsApp (same core) ───────────────────────────── */
  {
    id: 'whatsapp-draft-edit',
    role: 'TEACHER',
    channel: 'WHATSAPP',
    title: 'WhatsApp: the person\'s own leave drafted, edited by "make it Tuesday instead", then YES',
    forbid: NOT_TEACHERS,
    turns: [
      { say: 'apply for casual leave on Monday for a family function', reply: [/YES/, date(() => nextWeekday('Monday'))] },
      { say: 'make it Tuesday instead', reply: [/YES/, date(() => nextWeekday('Tuesday'))] },
      { say: 'yes', notReply: /nothing waiting/i, check: 'staffLeaveTuesday' },
    ],
  },
  {
    id: 'whatsapp-ellipsis',
    role: 'TEACHER',
    channel: 'WHATSAPP',
    title: 'WhatsApp: "and 5A?" then "who was absent?"',
    forbid: NOT_TEACHERS,
    turns: [
      { say: 'show attendance for Class 6 A', reply: /Rahul Sharma/ },
      { say: 'and 5A?', reply: /Ananya Mishra/ },
      { say: 'who was absent?', reply: /Ananya Mishra/, notReply: /Which class/ },
    ],
  },
];

/** Database checks named by scenarios. */
export const CHECKS = {
  async assignmentDueMonday({ inSchool, OAK, models }) {
    const rows = await inSchool(OAK, () => models.Assignment.find({ title: 'Algebra set 2' }).lean());
    if (rows.length !== 1) throw new Error(`expected one "Algebra set 2", found ${rows.length}`);
    const due = new Date(rows[0].dueAt);
    const iso = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
    const monday = nextWeekday('Monday');
    // The due day is stored at the end of the school day; compare the calendar day either way.
    if (iso !== monday && due.toISOString().slice(0, 10) !== monday) throw new Error(`due ${due.toISOString()} is not ${monday}`);
  },
  async staffLeaveTuesday({ inSchool, OAK, models, school }) {
    const rows = await inSchool(OAK, () => models.StaffLeave.find({ profileId: school.people.TEACHER.profile._id, status: 'PENDING', refNo: { $ne: 'SL-0001' } }).lean());
    if (rows.length !== 1) throw new Error(`expected one new leave application, found ${rows.length}`);
    const tuesday = nextWeekday('Tuesday');
    const from = new Date(rows[0].fromDate);
    const iso = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
    if (iso !== tuesday && from.toISOString().slice(0, 10) !== tuesday) throw new Error(`leave from ${from.toISOString()} is not ${tuesday}`);
  },
  async noAssignmentCreated({ inSchool, OAK, models }) {
    const n = await inSchool(OAK, () => models.Assignment.countDocuments({ title: { $in: ['Algebra set 2', 'Algebra revision'] } }));
    if (n !== 0) throw new Error(`expected no Algebra assignment, found ${n}`);
  },
};

export { today };
