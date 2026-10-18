/**
 * Part 7 harness conversations: MULTI-PART messages, per role, on the website
 * and WhatsApp. Spread into SCENARIOS (askAiConversations.scenarios.js) and
 * replayed by askAi.conversations.test.js, so every turn is also checked for
 * grounding (every name and figure from what the turn's tools returned) and
 * for leaks.
 *
 * What each asserts: every ask is answered under its own numbered heading, in
 * the order asked; a part that cannot be done says which and why while the
 * others are answered; reads touch only what the person may see; a write is a
 * draft awaiting the same person's confirmation.
 *
 * Reads run in parallel, so the "last call" the harness sees is not
 * deterministic for read-only turns: those turns assert the reply, not `tool`.
 */

const NOT_TEACHERS = ['Ishaan Bose', 'Tara Iyer', 'Dev Sharma', 'Meera Nair', 'Rohan Desai', 'Rahul Riverside'];
const NOT_PARENTS = ['Aman Gupta', 'Priya Verma', 'Aarav Mishra', 'Ananya Mishra', 'Tara Iyer', 'Dev Sharma', 'Meera Nair', 'Rohan Desai', 'Ishaan Bose', 'Rahul Riverside'];
const NOT_STUDENT = ['Rahul Sharma', 'Aman Gupta', 'Riya Kapoor', 'Aarav Mishra', 'Ananya Mishra', 'Tara Iyer', 'Dev Sharma', 'Meera Nair', 'Rohan Desai', 'Ishaan Bose', 'Rahul Riverside'];
const OTHER_SCHOOL = ['Rahul Riverside'];
const UNSURE = /I'm not sure what you need/;
const heading = (n, text) => new RegExp(`\\*\\*${n}\\. ${text}`, 'i');
const wa = (n, text) => new RegExp(`\\*${n}\\. ${text}`, 'i');

export const P7_SCENARIOS = [
  /* ── PARENT ── */
  {
    id: 'p7-parent-four-asks',
    role: 'PARENT',
    title: 'multi-ask: "Rahul\'s score, his performance, assignment updates and who is the class teacher" -- four sections',
    forbid: NOT_PARENTS,
    turns: [{
      say: "Rahul's score, his performance, assignment updates and who is the class teacher",
      action: false,
      reply: [heading(1, "Rahul's score"), /Rahul Sharma scored 70%/, heading(2, 'His performance'), /performance score 38\.18\/100 · Needs support/,
        /How it's calculated/, /1 of 1 test paper\(s\) recorded/, heading(3, 'Assignment updates'), /Algebra set 1/, heading(4, 'Who is the class teacher'), /class teacher is TEACHER user/],
      notReply: [UNSURE, /Could not be done/],
    }],
  },
  {
    id: 'p7-parent-two-children',
    role: 'PARENT',
    title: "multi-ask: each child keeps their own name (\"Riya's fees and Rahul's attendance\")",
    forbid: NOT_PARENTS,
    turns: [{
      say: "Riya's fees and Rahul's attendance",
      reply: [heading(1, "Riya's fees"), /2,500/, heading(2, "Rahul's attendance"), /Rahul Sharma/],
      notReply: [/8,000|10,500/, UNSURE],
    }],
  },
  {
    id: 'p7-parent-policy-part',
    role: 'PARENT',
    title: 'multi-ask: one part is a policy answer (who scored the highest), the other is answered',
    forbid: NOT_PARENTS,
    turns: [{
      say: "Rahul's marks and who scored the highest in his class",
      reply: [heading(1, "Rahul's marks"), /Rahul Sharma scored 70%/, heading(2, 'Who scored the highest'), /aren't shown to parents/, /Could not be done: part 2/],
      notReply: [/Priya Verma/],
    }],
  },
  {
    id: 'p7-parent-hinglish',
    role: 'PARENT',
    title: 'multi-ask (Hinglish): "rahul ki attendance aur fees"',
    forbid: NOT_PARENTS,
    turns: [{ say: 'rahul ki attendance aur fees', reply: [/\*\*1\. /, /\*\*2\. /, /Rahul Sharma/], notReply: [UNSURE, /Which child/] }],
  },
  {
    id: 'p7-parent-whatsapp',
    role: 'PARENT',
    channel: 'WHATSAPP',
    title: 'WhatsApp multi-ask: "Rahul\'s marks and his class teacher" in WhatsApp format',
    forbid: NOT_PARENTS,
    turns: [{ say: "Rahul's marks and his class teacher", reply: [wa(1, "Rahul's marks"), /70%/, wa(2, 'His class teacher'), /TEACHER user/], notReply: [/\*\*/, UNSURE] }],
  },
  /* ── TEACHER ── */
  {
    id: 'p7-teacher-read-read-draft',
    role: 'TEACHER',
    title: 'multi-ask: "attendance of 6A today, who\'s absent, and send their parents a message" -- read + read + drafted message, then confirm',
    forbid: NOT_TEACHERS,
    turns: [
      {
        say: "attendance of 6A today, who's absent, and send their parents a message",
        tool: 'send_conversation_message',
        args: { studentName: 'Rahul Sharma' },
        action: true,
        reply: [heading(1, 'Attendance of 6A today'), /3 student\(s\), 2 marked/, heading(2, "Who's absent"), /Absent — Class 6 A on .*: Rahul Sharma/, heading(3, 'Send their parents a message'), /Shall I go ahead/],
      },
      { press: 'confirm', executed: true },
    ],
  },
  {
    id: 'p7-teacher-refused-part',
    role: 'TEACHER',
    title: 'multi-ask: one part not permitted (fees) -- the others answered, and why that part was not',
    forbid: NOT_TEACHERS,
    turns: [{
      say: "Aarav Mishra's attendance, his marks and his fees",
      reply: [heading(1, "Aarav Mishra's attendance"), /100%/, heading(2, 'His marks'), /Aarav Mishra scored 90%/, heading(3, 'His fees'), /Not included: fee information — your Teacher account doesn't have access to that/],
      notReply: [/₹/],
    }],
  },
  {
    id: 'p7-teacher-list',
    role: 'TEACHER',
    title: 'multi-ask as a numbered list: three asks, three sections',
    forbid: NOT_TEACHERS,
    turns: [{
      say: '1. who is absent in 5A today\n2. Class 6 A marks\n3. my timetable',
      reply: [heading(1, 'Who is absent in 5A today'), /Ananya Mishra/, heading(2, 'Class 6 A marks'), /average 75%/, heading(3, 'My timetable')],
      notReply: [UNSURE],
    }],
  },
  {
    id: 'p7-teacher-and-also',
    role: 'TEACHER',
    title: 'multi-ask joined with "and also": two class registers',
    forbid: NOT_TEACHERS,
    turns: [{ say: 'show attendance for Class 5 A and also Class 6 A', reply: [/\*\*1\. /, /Ananya Mishra/, /\*\*2\. /, /Rahul Sharma/] }],
  },
  {
    id: 'p7-teacher-hinglish-aur',
    role: 'TEACHER',
    title: 'multi-ask (Hinglish "aur"): "5A ki attendance aur 6A ki attendance"',
    forbid: NOT_TEACHERS,
    turns: [{ say: '5A ki attendance aur 6A ki attendance', reply: [/Ananya Mishra/, /Rahul Sharma/], notReply: [UNSURE] }],
  },
  {
    id: 'p7-teacher-whatsapp',
    role: 'TEACHER',
    channel: 'WHATSAPP',
    title: 'WhatsApp multi-ask: "attendance of 6A today and who scored the highest in Class 6 A"',
    forbid: NOT_TEACHERS,
    turns: [{ say: 'attendance of 6A today and who scored the highest in Class 6 A', reply: [wa(1, 'Attendance of 6A today'), /Rahul Sharma/, wa(2, 'Who scored the highest'), /Priya Verma/] }],
  },
  /* ── STUDENT ── */
  {
    id: 'p7-student-three',
    role: 'STUDENT',
    title: 'multi-ask: "my attendance, my marks and my homework"',
    forbid: NOT_STUDENT,
    turns: [{ say: 'my attendance, my marks and my homework', reply: [heading(1, 'My attendance'), heading(2, 'My marks'), /Priya Verma scored 80%/, heading(3, 'My homework'), /Algebra set 1/] }],
  },
  {
    id: 'p7-student-policy',
    role: 'STUDENT',
    title: 'multi-ask: own performance score, and who topped (policy)',
    forbid: NOT_STUDENT,
    turns: [{ say: 'my performance score and who scored the highest in my class', reply: [heading(1, 'My performance score'), /performance score/, /aren't shown to students/], notReply: [/Rahul Sharma/] }],
  },
  /* ── PRINCIPAL ── */
  {
    id: 'p7-principal-three',
    role: 'PRINCIPAL',
    title: 'multi-ask: student count, lowest-attendance class and Class 10 A top scorer',
    forbid: OTHER_SCHOOL,
    turns: [{
      say: 'how many students are there, which class has the lowest attendance and who scored the highest in Class 10 A',
      reply: [heading(1, 'How many students are there'), /11 students/, heading(2, 'Which class has the lowest attendance'), /Class 10 B/, heading(3, 'Who scored the highest in Class 10 A'), /highest 48\/50 \(Tara Iyer\)/],
    }],
  },
  {
    id: 'p7-principal-student',
    role: 'PRINCIPAL',
    title: "multi-ask: a pupil's performance and class teacher",
    forbid: OTHER_SCHOOL,
    turns: [{ say: "Aarav Mishra's performance and who is his class teacher", reply: [/performance score 94\.55\/100 · Excellent/, /Aarav Mishra is in Class 5 A/, /TEACHER user/] }],
  },
  /* ── ADMIN / HR / FINANCE ── */
  {
    id: 'p7-admin-mixed',
    role: 'ADMIN',
    title: "multi-ask: a pupil's class and another pupil's fees",
    forbid: OTHER_SCHOOL,
    turns: [{ say: "Riya Kapoor's class and Aman Gupta's fees", reply: [heading(1, "Riya Kapoor's class"), /Class 6 B/, heading(2, "Aman Gupta's fees"), /5,000/] }],
  },
  {
    id: 'p7-hr-staff',
    role: 'HR',
    title: 'multi-ask: staff count and pending staff leave',
    forbid: OTHER_SCHOOL,
    turns: [{ say: 'how many staff are there and show pending staff leave', reply: [heading(1, 'How many staff are there'), /8 active staff/, heading(2, 'Show pending staff leave')], notReply: [/PARENT|STUDENT user/] }],
  },
  {
    id: 'p7-finance',
    role: 'FINANCE',
    title: 'multi-ask: pending fees and fee collection',
    forbid: OTHER_SCHOOL,
    turns: [{ say: 'show pending fees and the fee collection', reply: [/\*\*1\. /, /\*\*2\. /, /8,000/] }],
  },
];
