import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { Ticket } from '../src/models/ticket.model.js';
import { HostelInquiry } from '../src/models/hostel.model.js';
import { BookIssue } from '../src/models/library.model.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { parseIntent, parsePlan } from '../src/modules/ai/agent/intent.js';
import { confirmAction } from '../src/modules/ai/agent/orchestrator.js';
import * as library from '../src/modules/library/library.service.js';
import * as dashboard from '../src/modules/dashboard/dashboard.service.js';
import * as attendance from '../src/modules/attendance/attendance.service.js';
import { inSchool, mcp, OAK } from './support/mcpSchool.js';
import { seedAskAiSchool, conversationAs, INTERNAL_LEAKS } from './support/askAiSchool.js';

/**
 * Natural-language routing: each reported sentence reaches the capability that
 * answers it, with the arguments it named -- asserted on the MCP call actually
 * made, and on a figure in the answer that only the right capability produces.
 *
 * BUG-006 low attendance · BUG-008 / BUG-011 timetable · BUG-012 class marks ·
 * BUG-013 fee collection · BUG-014 class ranking · BUG-016 profile ·
 * BUG-018 percentage · BUG-020 teacher assignments · BUG-021 library ·
 * BUG-022 role messaging · BUG-025 overall attendance · BUG-026 phrasing,
 * and the exploratory findings A–L.
 */

let school;

beforeEach(async () => {
  resetAgentThrottle();
  school = await seedAskAiSchool();
});
afterEach(() => { vi.useRealTimers(); });
afterAll(async () => { await resetMcpClient(); });

const as = (role, opts) => conversationAs(school, role, opts);

/** A CREATE is proposed first (registry.js); this is the person saying yes. */
async function confirmTurn(role, turn) {
  expect(turn.action?.confirmToken, `nothing was proposed: ${turn.reply}`).toBeTruthy();
  resetAgentThrottle();
  return inSchool(OAK, () => confirmAction({ confirmToken: turn.action.confirmToken, actor: school.people[role].actor }));
}
const expectNoLeak = (reply) => {
  for (const leak of INTERNAL_LEAKS) expect(reply, `leaked: ${leak}`).not.toMatch(leak);
};

/* ── Fees (BUG-013, BUG-024) ─────────────────────────────── */

describe('BUG-013 — the fee questions are different questions', () => {
  it.each([
    ['Show fee collection', 'get_fee_statistics'],
    ['fee collection report', 'get_fee_statistics'],
    ['What is the total fee collection?', 'get_fee_statistics'],
    ['How much fee has been collected?', 'get_fee_statistics'],
    ['Show outstanding fees', 'get_pending_fees'],
    ['Show pending fees', 'get_pending_fees'],
    ['Show fee structures', 'get_fee_structures'],
    ['Show fee heads', 'get_fee_structures'],
    ['Show paid invoices', 'get_payment_history'],
    ['Show payment transactions', 'get_payment_history'],
    ['Show payment history', 'get_payment_history'],
  ])('%j reaches %s', async (message, tool) => {
    for (const role of ['ADMIN', 'FINANCE', 'PRINCIPAL']) {
      const turn = await as(role).say(message);
      expect(turn.tool, `${role}: ${message}`).toBe(tool);
      expect(turn.calls.at(-1).status, `${role}: ${message}`).toBe('READ');
    }
  });

  it('answers "fee collection" with what was collected, not with the fee structure', async () => {
    const turn = await as('ADMIN').say('Show fee collection');
    expect(turn.reply).toMatch(/collected of ₹13,000 billed/);
    expect(turn.reply).not.toMatch(/fee head|fee structure/i);
  });

  it('gives a named period the payments recorded in it', async () => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const turn = await as('FINANCE').say("Show today's fee collection");
    expect(turn.tool).toBe('get_payment_history');
    expect(turn.args).toEqual({ from: today, to: today });
    const month = await as('FINANCE').say('How much fee was collected this month?');
    expect(month.tool).toBe('get_payment_history');
    expect(month.args.from).toBe(`${today.slice(0, 7)}-01`);
  });

  it('routes the same intent for every role, and lets authorization decide separately', async () => {
    // The INTENT is read alike; what differs is what each may see.
    expect((await as('ADMIN').say('Show fee collection')).tool).toBe('get_fee_statistics');
    const teacher = await as('TEACHER').say('Show fee collection');
    expect(teacher.refused).toBe('NOT_PERMITTED');
    expect(teacher.calls).toHaveLength(0);
    const student = await as('STUDENT').say('Show fee collection');
    expect(student.refused).toBe('OUT_OF_SCOPE');
    expect(student.calls).toHaveLength(0);
  });
});

/* ── Attendance (BUG-006, BUG-014, BUG-025) ──────────────── */

describe('BUG-014 — which class has the lowest attendance', () => {
  it.each([
    'Which class has the lowest attendance?',
    'Rank classes by attendance',
    'class wise attendance',
    'Compare attendance across classes',
    'Show attendance for each class',
  ])('%j is answered with a ranking of classes', async (message) => {
    const turn = await as('PRINCIPAL').say(message);
    expect(turn.tool).toBe('get_class_attendance_summary');
    const ranked = turn.result.data.ranked.map((c) => c.class);
    // Class 10 B (one pupil absent every day, the other every second day) is lowest.
    expect(ranked[0]).toBe('Class 10 B');
    expect(turn.reply).toMatch(/Class 10 B has the lowest attendance/);
    // Ascending, by the percentage the answer shows.
    const pcts = turn.result.data.ranked.map((c) => c.pctExact);
    expect(pcts).toEqual([...pcts].sort((a, b) => a - b));
  });

  it('ranks from the top when asked for the highest', async () => {
    const turn = await as('ADMIN').say('Which class has the highest attendance?');
    expect(turn.args.order).toBe('HIGHEST');
    const pcts = turn.result.data.ranked.map((c) => c.pctExact);
    expect(pcts).toEqual([...pcts].sort((a, b) => b - a));
    expect(turn.reply).toMatch(/has the highest attendance/);
  });

  it('computes each class with the attendance module\'s own formula, over the period it states', async () => {
    const turn = await as('ADMIN').say('Which class has the lowest attendance?');
    const data = turn.result.data;
    expect(data.period.basis).toBe('MONTH_TO_DATE');
    expect(turn.reply).toMatch(/this month so far/);
    for (const row of data.classes.filter((c) => c.marked > 0)) {
      const expected = attendance.attendanceFigures(row);
      expect(row.pctExact, row.class).toBe(expected.pctExact);
      // A class with marks is never reported as 0% unless everybody was absent.
      if (row.PRESENT > 0) expect(row.pctExact).toBeGreaterThan(0);
    }
    // A class with nothing marked has no percentage, and is not ranked last as 0%.
    const unmarked = data.classes.filter((c) => c.marked === 0);
    for (const row of unmarked) {
      expect(row.pctExact).toBeNull();
      expect(data.ranked.map((c) => c.class)).not.toContain(row.class);
    }
  });

  it('a teacher sees only the classes they teach', async () => {
    const turn = await as('TEACHER').say('Which class has the lowest attendance?');
    expect(turn.tool).toBe('get_class_attendance_summary');
    const classes = turn.result.data.classes.map((c) => c.class).sort();
    expect(classes).toEqual(['Class 5 A', 'Class 6 A', 'Class 6 B']);
    expect(turn.reply).not.toMatch(/Class 10|Class 9/);
    expect(turn.reply).toMatch(/your classes/);
  });

  it('honours a named period', async () => {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const month = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}`;
    const turn = await as('PRINCIPAL').say('Which class had the lowest attendance last month?');
    expect(turn.args).toMatchObject({ month });
    expect(turn.result.data.period.from).toBe(`${month}-01`);
  });
});

describe('BUG-025 — overall attendance is never a daily head count in disguise', () => {
  it.each([
    'Show overall attendance',
    'What is the overall attendance percentage?',
    'Show overall attendance of the school',
    'What is the school attendance?',
  ])('%j states its period and the figure for everyone together', async (message) => {
    const turn = await as('PRINCIPAL').say(message);
    expect(turn.tool).toBe('get_class_attendance_summary');
    expect(turn.reply).toMatch(/Overall for the school: \*\*[\d.]+%\*\*/);
    // The period is on the page, in words and dates.
    expect(turn.reply).toMatch(/\d{1,2} \w{3} \d{4} to \d{1,2} \w{3} \d{4}/);
    expect(turn.reply).not.toMatch(/absent today/);
    // ...and it is the sum of the classes, by the same formula.
    const { overall, classes } = turn.result.data;
    const marked = classes.reduce((n, c) => n + c.marked, 0);
    expect(overall.marked).toBe(marked);
  });

  it('a single day is said to be a single day', async () => {
    const turn = await as('ADMIN').say('Show overall attendance for today');
    expect(turn.result.data.period.basis).toBe('DAY');
    expect(turn.reply).not.toMatch(/this month so far/);
  });

  it('a student asking for "overall attendance" is asking about themselves', async () => {
    const turn = await as('STUDENT').say('Show my overall attendance');
    expect(turn.tool).not.toBe('get_class_attendance_summary');
    expect(turn.reply).toMatch(/Attendance/);
  });
});

describe('BUG-006 — low attendance', () => {
  it.each([
    'Show students with low attendance',
    'Who has low attendance?',
    'Which students have poor attendance?',
    'List attendance defaulters',
  ])('%j lists only students below the defined threshold, by attendance alone', async (message) => {
    const turn = await as('PRINCIPAL').say(message);
    expect(turn.tool).toBe('get_at_risk_students');
    expect(turn.args).toEqual({ attendanceBelowPct: 75 });
    const students = turn.result.data.students;
    expect(students.length).toBeGreaterThan(0);
    for (const s of students) {
      expect(s.type, s.studentName).toBe('ATTENDANCE');
      expect(s.attendancePct, s.studentName).toBeLessThan(75);
    }
    // Nobody at 100% is in a list of low attendance.
    expect(students.map((s) => s.studentName)).not.toContain('Tara Iyer');
    expect(students.map((s) => s.studentName)).not.toContain('Aarav Mishra');
    expect(turn.reply).not.toMatch(/100%|ACADEMIC_DECLINE|FEE_DEFAULT|low marks|overdue fees/);
    expect(turn.reply).toMatch(/below 75% attendance over the last 30 days/);
  });

  it('keeps a threshold the person states', async () => {
    const turn = await as('PRINCIPAL').say('Which students have attendance below 60%?');
    expect(turn.args.attendanceBelowPct).toBe(60);
    for (const s of turn.result.data.students) expect(s.attendancePct).toBeLessThan(60);
  });

  it('the at-risk list no longer presents unflagged students as flagged', async () => {
    const result = await mcp(OAK, school.people.PRINCIPAL.actor, 'get_at_risk_students', {});
    for (const s of result.data.students) expect(s.level, s.studentName).not.toBe('LOW');
    expect(result.speak ?? '').not.toMatch(/— 100%|attendance 100%/);
  });
});

/* ── Timetable (BUG-008, BUG-011) ────────────────────────── */

describe('BUG-008 / BUG-011 — my timetable, and my next class', () => {
  it('a teacher\'s timetable is the periods they teach, never the school\'s', async () => {
    const turn = await as('TEACHER').say('Show my timetable');
    expect(turn.tool).toBe('get_timetable');
    expect(turn.reply).toMatch(/Class 5 A/);
    expect(turn.reply).toMatch(/Class 6 B/);
    // Class 10 A and the English period in 6 B belong to somebody else.
    expect(turn.reply).not.toMatch(/Class 10 A|English/);
    const slots = turn.result.data.slots;
    expect(slots.every((s) => String(s.subjectOfferingId?.teacherId?._id ?? s.subjectOfferingId?.teacherId) === String(school.people.TEACHER.profile._id))).toBe(true);
  });

  it('refuses a teacher a class that is not theirs, and keeps a class filter that is', async () => {
    const other = await as('TEACHER').say('Show timetable for Class 10 A');
    expect(other.reply).toMatch(/Class 10 A is not one of your classes/);
    const own = await as('TEACHER').say('Show timetable for Class 5 A');
    expect(own.args).toMatchObject({ className: 'Class 5 A' });
    expect(own.reply).not.toMatch(/Class 6/);
  });

  it.each([
    'What is my next class?',
    'When is my next period?',
    'Which class do I have next?',
    "What's next?",
  ])('%j is answered with one period, from the current time', async (message) => {
    // Monday 12 October 2026, 09:50: period 2 (6 B Science, 09:45–10:30) is
    // under way and period 6 (6 A Mathematics, 14:00) is the next to start.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 12, 9, 50, 0));
    const turn = await as('TEACHER').say(message);
    expect(turn.tool).toBe('get_timetable');
    expect(turn.args).toEqual({ next: true });
    expect(turn.reply).toMatch(/The next class is Mathematics with Class 6 A — period 6, 14:00–14:45, today/);
    expect(turn.reply).toMatch(/Right now: Science with Class 6 B/);
    // One period, not the day's table.
    expect(turn.reply).not.toMatch(/\| Period \|/);
    expect(turn.reply).not.toMatch(/09:00–09:45/);
  });

  it('says so when today is over, and gives the first class of the next day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 12, 18, 0, 0));
    const turn = await as('TEACHER').say('What is my next class?');
    expect(turn.reply).toMatch(/There are no more classes today\. The next class is Mathematics with Class 5 A — period 1, 09:00–09:45, tomorrow/);
  });

  it('a student\'s next class is their own section\'s, and a parent\'s is their child\'s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 12, 8, 0, 0));
    const student = await as('STUDENT').say('What is my next class?');
    expect(student.reply).toMatch(/The next class is Mathematics/);
    expect(student.reply).not.toMatch(/Class 5 A|Class 10 A/);
    const parent = await as('PARENT').say("What is my child's next class?");
    expect(parent.tool).toBe('get_timetable');
    expect(parent.reply).toMatch(/The next class is Mathematics/);
  });

  it('a school-wide reader is asked which class, not shown every class\'s next period', async () => {
    const turn = await as('ADMIN').say('What is the next class?');
    expect(turn.reply).toMatch(/for which class/i);
    const named = await as('ADMIN').say('What is the next class for Class 10 A?');
    expect(named.args).toMatchObject({ next: true, className: 'Class 10 A' });
  });

  it('says there is nothing when nothing is scheduled', async () => {
    const turn = await as('LIBRARIAN').say('What is my next class?');
    expect(turn.reply).not.toMatch(/The next class is/);
  });
});

/* ── Marks (BUG-012, BUG-018) ────────────────────────────── */

describe('BUG-012 / BUG-018 — marks, and percentages of marks', () => {
  it.each([
    'Show marks for Class 10 A',
    'Class 10 A marks',
    'Show results of Class 10 A',
    'How did Class 10 A score?',
  ])('%j is the class\'s marks sheet, not the class\'s details', async (message) => {
    const turn = await as('PRINCIPAL').say(message);
    expect(turn.tool).toBe('get_class_marks');
    expect(turn.args).toMatchObject({ className: 'Class 10 A' });
    expect(turn.reply).toMatch(/highest 48\/50/);
    expect(turn.reply).not.toMatch(/subject\(s\) you teach/);
  });

  it('authorizes separately: a teacher is refused a class that is not theirs', async () => {
    const turn = await as('TEACHER').say('Show marks for Class 10 A');
    expect(turn.status).toBe(403);
    expect(turn.reply).not.toMatch(/48|21/);
  });

  it('"what percentage did I get in Maths?" is a marks question', async () => {
    const turn = await as('STUDENT').say('What percentage did I get in Maths?');
    expect(turn.tool).toBe('get_report_card');
    expect(turn.args).toEqual({ subject: 'Maths' });
    // Priya: 40 of 50 in Mathematics.
    expect(turn.reply).toMatch(/Mathematics marks: Unit Test 2 40\/50 \(80%\)/);
    expect(turn.reply).not.toMatch(/Present|Absent|Total Marked/);
  });

  it('"attendance percentage" stays an attendance question', async () => {
    const turn = await as('STUDENT').say('What is my attendance percentage?');
    expect(turn.tool).toMatch(/attendance/);
    expect(turn.reply).not.toMatch(/Unit Test|\/50/);
  });

  it('a bare "percentage" is asked about, and one word settles it', async () => {
    const marks = as('STUDENT');
    const asked = await marks.say('What is my percentage?');
    expect(asked.calls).toHaveLength(0);
    expect(asked.reply).toMatch(/attendance percentage, or your exam \(marks\) percentage/);
    const answered = await marks.say('marks');
    expect(answered.tool).toBe('get_report_card');
    expect(answered.reply).toMatch(/Priya Verma scored 80% in exams/);

    const attend = as('STUDENT');
    await attend.say('What is my percentage?');
    expect((await attend.say('attendance')).tool).toBe('get_attendance');
  });

  it('a staff member\'s percentage question about a named student is that student\'s marks', async () => {
    const turn = await as('TEACHER').say("What percentage did Aarav Mishra get in Mathematics?");
    expect(turn.tool).toBe('get_report_card');
    expect(turn.args).toMatchObject({ studentName: 'Aarav Mishra' });
    expect(turn.reply).toMatch(/45\/50 \(90%\)/);
  });
});

/* ── Assignments (BUG-020) ───────────────────────────────── */

describe('BUG-020 — a teacher\'s assignments are their own', () => {
  it('lists only the work set for classes and subjects this teacher teaches', async () => {
    const turn = await as('TEACHER').say('Show assignments');
    expect(turn.tool).toBe('get_assignments');
    const titles = turn.result.data.assignments.map((a) => a.title).sort();
    expect(titles).toEqual(['Algebra set 1', 'Fractions worksheet', 'Plant cell diagram']);
    expect(turn.reply).not.toMatch(/UNRELATED/);
  });

  it('narrows by class and by subject without widening', async () => {
    const byClass = await as('TEACHER').say('Show my assignments for Class 5 A');
    expect(byClass.result.data.assignments.map((a) => a.title).sort()).toEqual(['Fractions worksheet', 'Plant cell diagram']);
    const bySubject = await as('TEACHER').say('Show Maths homework');
    expect(bySubject.result.data.assignments.every((a) => a.subject === 'Mathematics')).toBe(true);
    const outside = await as('TEACHER').say('Show assignments for Class 9 B');
    expect(outside.reply).not.toMatch(/UNRELATED/);
  });

  it('filters by a due-date window instead of refusing it', async () => {
    const day = (n) => {
      const d = new Date(Date.now() + n * 86_400_000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const result = await mcp(OAK, school.people.TEACHER.actor, 'get_assignments', { dueFrom: day(0), dueTo: day(1) });
    expect(result.data.assignments.map((a) => a.title)).toEqual(['Plant cell diagram']);
    const tomorrow = await as('TEACHER').say('Show assignments due tomorrow');
    expect(tomorrow.tool).toBe('get_assignments');
    expect(tomorrow.args).toEqual({ dueFrom: day(1), dueTo: day(1) });
    expect(tomorrow.result.data.assignments.map((a) => a.title)).toEqual(['Plant cell diagram']);
    expect((await as('TEACHER').say('Show assignments due this week')).refused).not.toBe('CANNOT_NARROW');
  });

  it('answers "which assignment is due first" with the earliest one', async () => {
    const turn = await as('TEACHER').say('Which assignment is due first?');
    expect(turn.args).toEqual({ first: true });
    expect(turn.reply).toMatch(/Due first: Plant cell diagram \(Science, Class 5/);
    expect(turn.result.data.assignments).toHaveLength(1);
  });

  it('a principal\'s list is not limited to this teacher\'s work, and a student\'s is their own class\'s', async () => {
    const principal = await as('PRINCIPAL').say('Show assignments');
    expect(principal.result.data.assignments.length).toBe(5);
    const student = await as('STUDENT').say('Show my assignments');
    expect(student.reply).toMatch(/Algebra set 1/);
    expect(student.reply).not.toMatch(/UNRELATED|Plant cell/);
  });
});

/* ── Library (BUG-021, findings F, J, K) ─────────────────── */

describe('BUG-021 — library questions go to the library', () => {
  it.each([
    ['Search book Clean Code', 'list_books'],
    ['Find books by Robert Martin', 'list_books'],
    ['Is Clean Code available?', 'get_book'],
    ['How many copies of Clean Code are available?', 'get_book'],
    ['Who borrowed Clean Code?', 'list_book_issues'],
    ['Who has Wings of Fire?', 'list_book_issues'],
    ['Show overdue books', 'get_overdue_books'],
    ['Show library summary', 'get_library_summary'],
  ])('%j reaches %s for the librarian', async (message, tool) => {
    const turn = await as('LIBRARIAN').say(message);
    expect(turn.tool, message).toBe(tool);
    expect(turn.tools, message).not.toContain('search_students');
    expect(turn.calls.at(-1).status).toBe('READ');
  });

  it('answers availability and borrowers from the catalog', async () => {
    const lib = as('LIBRARIAN');
    expect((await lib.say('Is Clean Code available?')).reply).toMatch(/Clean Code by Robert Martin — 2 of 3 copies available/);
    const who = await lib.say('Who borrowed Clean Code?');
    expect(who.args).toEqual({ title: 'Clean Code', outstanding: true });
    expect(who.reply).toMatch(/Clean Code → Priya Verma/);
    expect(who.reply).not.toMatch(/Wings of Fire/);
    expect((await lib.say('Is Harry Potter available?')).reply).toMatch(/Nothing in the catalog matches "Harry Potter"/);
  });

  it('F — "update the copies of Clean Code to 5" updates the book, never a student', async () => {
    for (const role of ['LIBRARIAN', 'ADMIN']) {
      const turn = await as(role).say('Update the copies of Clean Code to 5');
      expect(turn.tool, role).toBe('update_book');
      expect(turn.args, role).toEqual({ title: 'Clean Code', totalCopies: 5 });
      expect(turn.action?.summary, role).toMatch(/Update totalCopies on "Clean Code"/);
      expect(turn.tools, role).not.toContain('update_student');
    }
    for (const message of ['Set Clean Code copies to 5', 'Change the total copies of Clean Code to 5']) {
      expect((await as('LIBRARIAN').say(message)).args).toEqual({ title: 'Clean Code', totalCopies: 5 });
    }
  });

  it('validates the count and the permission', async () => {
    const tooMany = await mcp(OAK, school.people.LIBRARIAN.actor, 'update_book', { title: 'Clean Code', totalCopies: 5000 });
    expect(tooMany.success).toBe(false);
    const teacher = await mcp(OAK, school.people.TEACHER.actor, 'update_book', { title: 'Clean Code', totalCopies: 5 });
    expect(teacher.error.code).toBe('FORBIDDEN');
    const student = await mcp(OAK, school.people.STUDENT.actor, 'update_book', { title: 'Clean Code', totalCopies: 5 });
    expect(student.error.code).toMatch(/^FORBIDDEN/);
  });

  it('K — a student\'s overdue-book question reads their own loans, not their book requests', async () => {
    for (const message of ['Do I have any overdue books?', 'Which books are overdue for me?', 'Are any of my library books overdue?']) {
      const turn = await as('STUDENT').say(message);
      expect(turn.tool, message).toBe('list_book_issues');
      expect(turn.args, message).toEqual({ status: 'OVERDUE' });
      expect(turn.reply, message).toMatch(/1 book\(s\) overdue: Clean Code/);
      // Only their own: the teacher's loan of Wings of Fire is not theirs to see.
      expect(turn.reply, message).not.toMatch(/Wings of Fire|TEACHER user/);
      expect(turn.tools, message).not.toContain('get_my_book_requests');
    }
  });

  it('a student cannot ask who else has a book', async () => {
    const turn = await as('STUDENT').say('Who borrowed Wings of Fire?');
    expect(turn.reply).not.toMatch(/TEACHER user/);
    const direct = await mcp(OAK, school.people.STUDENT.actor, 'list_book_issues', { title: 'Wings of Fire', outstanding: true });
    expect(JSON.stringify(direct.data ?? {})).not.toMatch(/TEACHER user/);
  });

  it('J — the summary agrees with the librarian dashboard, figure for figure', async () => {
    // One loan is past its due date but still stored as ACTIVE: the state the
    // two screens used to count differently.
    expect(await inSchool(OAK, () => BookIssue.countDocuments({ status: 'OVERDUE' }))).toBe(0);
    const summary = await inSchool(OAK, () => library.getSummary());
    const board = await inSchool(OAK, () => dashboard.getLibrarianDashboard());
    expect(summary.overdueReturns).toBe(board.overdueBooks);
    expect(summary.activeBookIssues).toBe(board.issuedBooks);
    expect(summary.totalCatalogBooks).toBe(board.totalBooks);
    expect(summary.totalCopies).toBe(board.totalCopies);
    expect(summary.availableCopies).toBe(board.availableBooks);
    expect(summary.overdueReturns).toBe(1);

    const turn = await as('LIBRARIAN').say('How many books are there in the library?');
    expect(turn.tool).toBe('get_library_summary');
    expect(turn.reply).toMatch(/2 book\(s\) in the catalog \(2 titles\) with 5 copies of which 3 are on the shelf/);
    expect(turn.reply).toMatch(/1 on loan and not yet due, 1 overdue/);
  });
});

/* ── Role messaging (BUG-022) ────────────────────────────── */

describe('BUG-022 — "not permitted" is said as that, not as "I did not understand"', () => {
  it.each([
    ['LIBRARIAN', 'Show attendance of Class 6 A', /attendance records/],
    ['LIBRARIAN', 'Show hostel rooms', /the hostel/],
    ['WARDEN', 'Show marks for Class 6 A', /marks and results/],
    ['WARDEN', 'Search book Clean Code', /the library/],
    ['TEACHER', 'Search book Clean Code', /the library/],
    ['TEACHER', 'Show hostel rooms', /the hostel/],
    ['FINANCE', 'Show attendance of Class 6 A', /attendance records/],
  ])('%s asking %j is told they have no access to it', async (role, message, topic) => {
    const turn = await as(role).say(message);
    expect(turn.refused, `${role}: ${message} → ${turn.reply}`).toBe('NOT_PERMITTED');
    expect(turn.reply).toMatch(/You don't have access to/);
    expect(turn.reply).toMatch(topic);
    // Not the two answers it used to get.
    expect(turn.reply).not.toMatch(/I'm not sure what you need|I can't narrow that/);
    expect(turn.calls.filter((c) => c.status === 'READ')).toHaveLength(0);
    expectNoLeak(turn.reply);
  });

  it('each role still reaches its own module', async () => {
    expect((await as('LIBRARIAN').say('Show overdue books')).tool).toBe('get_overdue_books');
    expect((await as('WARDEN').say('Show hostel rooms')).tool).toBe('list_hostel_rooms');
    expect((await as('WARDEN').say('Show hostel students')).tool).toMatch(/hostel/);
  });

  it('something genuinely not understood is still said to be not understood', async () => {
    const turn = await as('TEACHER').say('purple monkey dishwasher');
    expect(turn.refused).not.toBe('NOT_PERMITTED');
  });
});

/* ── Warden scope (finding L) ────────────────────────────── */

describe('L — a warden\'s own students are the hostel\'s residents', () => {
  it.each([
    'Show students under my responsibility',
    'Show my students',
    'List the students under my care',
    'Show hostel students',
  ])('%j lists residents, not the school', async (message) => {
    const turn = await as('WARDEN').say(message);
    expect(turn.tool).toMatch(/^(get_hostel_residents|list_hostel_allocations)$/);
    expect(turn.reply).toMatch(/Rahul Sharma/);
    // The one resident -- nobody else on the school roll.
    for (const other of ['Priya Verma', 'Tara Iyer', 'Ishaan Bose', 'Meera Nair']) expect(turn.reply).not.toContain(other);
    expect(turn.tools).not.toContain('search_students');
  });
});

/* ── Profile (BUG-016, finding M) ────────────────────────── */

describe('BUG-016 — a profile reads as the role it belongs to', () => {
  const STAFF_WORDS = /employee|designation|department|reporting manager|teach \d+ subject|assigned to \d+ class/i;

  it('a student\'s profile is a student\'s: class, roll number, admission number -- no staff fields', async () => {
    const turn = await as('STUDENT').say('Show my profile');
    expect(turn.tool).toBe('get_my_profile');
    expect(turn.reply).toMatch(/registered as a Student/);
    expect(turn.reply).toMatch(/You are in Class 6 A, roll no 2, admission no OAK-2/);
    expect(turn.reply).not.toMatch(STAFF_WORDS);
    expect(turn.result.data.classesTaught).toBeUndefined();
    expect(turn.result.data.unavailable).toBeUndefined();
  });

  it('a parent\'s profile names their own child and nobody else', async () => {
    const turn = await as('PARENT').say('Show my profile');
    expect(turn.reply).toMatch(/Your child: Rahul Sharma, Class 6 A, roll no 1, admission no OAK-1/);
    expect(turn.reply).not.toMatch(STAFF_WORDS);
    expect(turn.reply).not.toMatch(/Priya|Aman/);
  });

  it('a staff detail asked by a student is said not to apply, never filled in', async () => {
    for (const message of ['What is my employee id?', 'What is my designation?', 'Who is my reporting manager?']) {
      const turn = await as('STUDENT').say(message);
      expect(turn.reply, message).toMatch(/staff detail — it does not apply/);
    }
  });

  it('a teacher\'s profile keeps its staff shape', async () => {
    const turn = await as('TEACHER').say('Show my profile');
    expect(turn.reply).toMatch(/registered as a Teacher/);
    expect(turn.reply).toMatch(/assigned to \d+ class/);
  });

  it('M — "my child\'s profile" is the linked child\'s record', async () => {
    const turn = await as('PARENT').say("Show my child's profile");
    expect(turn.tool).toBe('get_student');
    expect(turn.reply).toMatch(/Rahul Sharma \(OAK-1\), Class 6 - A, roll no 1/);
  });
});

/* ── The exploratory findings: writes that went elsewhere ── */

describe('B — enrolment is not academic-year creation', () => {
  it('"Enroll Rohan Desai in Class 6 A" proposes the enrolment, for confirmation', async () => {
    const turn = await as('ADMIN').say('Enroll Rohan Desai in Class 6 A');
    expect(turn.tool).toBe('enroll_student');
    expect(turn.tools).not.toContain('create_academic_year');
    expect(turn.action?.summary).toMatch(/Enrol Rohan Desai into Class 6 A for 2026-27/);
  });

  it('is refused to a role without the permission', async () => {
    const turn = await as('TEACHER').say('Enroll Rohan Desai in Class 6 A');
    expect(turn.action).toBeNull();
    expect(turn.calls.every((c) => c.status !== 'CONFIRMATION_REQUIRED')).toBe(true);
  });
});

describe('D — admission leads and hostel inquiries', () => {
  it('"create an admission lead" asks for exactly what is missing', async () => {
    const turn = await as('ADMIN').say('Create an admission lead');
    expect(turn.tool).toBe('create_admission_lead');
    expect(turn.reply).toMatch(/the child's name, the parent or guardian's name and the guardian's phone number/);
  });

  it('reads the details it is given and proposes the lead', async () => {
    const turn = await as('ADMIN').say('Create an admission lead for Kiran Rao, guardian Suresh Rao, phone 9876543210, for Class 6');
    expect(turn.tool).toBe('create_admission_lead');
    expect(turn.args).toEqual({ childName: 'Kiran Rao', guardianName: 'Suresh Rao', phone: '9876543210', gradeApplying: 'Class 6' });
    expect(turn.action?.summary).toMatch(/Record an admission enquiry for Kiran Rao \(Class 6\)/);
  });

  it('"log a hostel inquiry" creates one, with its subject kept whole', async () => {
    const warden = as('WARDEN');
    const first = await warden.say('Log a hostel inquiry');
    expect(first.tool).toBe('create_hostel_inquiry');
    expect(first.tools).not.toContain('list_hostel_inquiries');
    expect(first.reply).toMatch(/Tell me a subject/);

    const made = await as('WARDEN').say('Log a hostel inquiry about broken fan in room H-101');
    expect(made.tool).toBe('create_hostel_inquiry');
    expect(made.args).toEqual({ subject: 'Broken fan in room H-101' });
    expect(made.tools).not.toContain('list_hostel_rooms');
    await confirmTurn('WARDEN', made);
    const stored = await inSchool(OAK, () => HostelInquiry.find({}).lean());
    expect(stored.map((i) => i.subject)).toEqual(['Broken fan in room H-101']);
    expect(String(stored[0].raisedByProfileId)).toBe(String(school.people.WARDEN.profile._id));
  });

  it('answers the question it asked: the next message is the subject', async () => {
    const warden = as('WARDEN');
    await warden.say('Log a hostel inquiry');
    const turn = await warden.say('Water leakage in block A bathroom');
    expect(turn.tool).toBe('create_hostel_inquiry');
    expect(turn.args).toEqual({ subject: 'Water leakage in block A bathroom' });
  });
});

describe('E — payment decisions are handed back to the Payments screen', () => {
  it.each([
    'Reject the payment change request',
    'Approve the payment change request',
    'Approve the payment',
  ])('%j runs no capability and says where it is decided', async (message) => {
    const turn = await as('ADMIN').say(message);
    expect(turn.action).toBeNull();
    expect(turn.calls).toEqual([]);
    expect(turn.refused).toBe('HUMAN_DECISION');
    expect(turn.reply).toMatch(/Payments screen/);
  });

  it('reading the change requests is unaffected', async () => {
    const turn = await as('ADMIN').say('Show payment change requests');
    expect(turn.tool).toBe('get_payment_change_requests');
  });

  it('a role that may not decide payments is told so, and nothing runs', async () => {
    for (const message of ['Reject the payment change request', 'Approve the payment']) {
      const turn = await as('TEACHER').say(message);
      expect(turn.action).toBeNull();
      expect(turn.calls).toEqual([]);
      expect(turn.refused, message).toBe('NOT_PERMITTED');
    }
  });
});

describe('G — a ticket keeps its whole title', () => {
  const LONG = 'Projector in Room 12 is not working since Monday and needs urgent replacement before the science exhibition';

  it('creates the ticket with every word, and never a hostel room', async () => {
    const turn = await as('ADMIN').say(`Create a ticket titled ${LONG}`);
    expect(turn.tool).toBe('create_ticket');
    expect(turn.tools).not.toContain('create_hostel_room');
    expect(turn.args).toEqual({ subject: LONG });
    await confirmTurn('ADMIN', turn);
    const stored = await inSchool(OAK, () => Ticket.find({}).lean());
    expect(stored.map((t) => t.subject)).toEqual([LONG]);
  });

  it.each([
    ['Raise a ticket about the broken water cooler near Class 6 A', 'The broken water cooler near Class 6 A'],
    ['Open a ticket: bus route 4 arrives late every morning', 'Bus route 4 arrives late every morning'],
    ['Create a support ticket regarding fee receipt not received for INV-1001', 'Fee receipt not received for INV-1001'],
  ])('%j → %j', async (message, subject) => {
    const turn = await as('PARENT').say(message);
    expect(turn.tool).toBe('create_ticket');
    expect(turn.args.subject).toBe(subject);
  });

  it('refuses a title over the limit, says the limit, and creates nothing -- it is never cut to fit', async () => {
    const tooLong = `${LONG}. ${LONG}. ${LONG}.`;
    expect(tooLong.length).toBeGreaterThan(200);
    const turn = await as('ADMIN').say(`Create a ticket titled ${tooLong}`);
    expect(turn.refused).toBe('TOO_LONG');
    expect(turn.reply).toMatch(/The title is too long: \d+ characters, and the most it can hold is 200/);
    expect(turn.reply).toMatch(/nothing was saved/);
    expect(await inSchool(OAK, () => Ticket.countDocuments({}))).toBe(0);
  });
});

/* ── Multi-part questions (finding A) ────────────────────── */

describe('A — a sentence that asks two things is answered twice', () => {
  it('answers both halves of two questions', async () => {
    const turn = await as('ADMIN').say("Show today's absent students and fee collection");
    // p7: independent reads run in parallel, so the audit order is not the order asked.
    expect([...turn.tools].sort()).toEqual(['get_absent_students', 'get_fee_statistics']);
    expect(turn.reply).toMatch(/absent today/);
    expect(turn.reply).toMatch(/collected of ₹13,000 billed/);
  });

  it('carries the person the first half named into the second', async () => {
    const turn = await as('ADMIN').say("Show Rahul Sharma's attendance and fees");
    expect([...turn.tools].sort()).toEqual(['get_pending_fees', 'get_student_attendance']);
    expect(turn.calls.find((c) => c.tool === 'get_pending_fees').args).toEqual({ search: 'Rahul Sharma' });
    expect(turn.reply).toMatch(/Rahul Sharma — Attendance Summary/);
    expect(turn.reply).toMatch(/8,000/);
  });

  it('gives every part the person or the class the sentence names, wherever it names them', async () => {
    // Named at the END: it is still who both halves are about.
    const pupil = await as('TEACHER').say('Show attendance and marks of Aarav Mishra');
    const byTool = (turn) => turn.calls.map((c) => [c.tool, c.args]).sort((a, b) => a[0].localeCompare(b[0]));
    expect(byTool(pupil)).toEqual([
      ['get_report_card', { studentName: 'Aarav Mishra' }],
      ['get_student_attendance', { studentName: 'Aarav Mishra' }],
    ]);
    expect(pupil.reply).toMatch(/Aarav Mishra — Attendance Summary/);
    expect(pupil.reply).toMatch(/Aarav Mishra scored 90%/);

    const klass = await as('TEACHER').say('Show attendance and marks for Class 5 A');
    expect(byTool(klass)).toEqual([
      ['get_attendance_roster', { className: 'Class 5 A' }],
      ['get_class_marks', { className: 'Class 5 A' }],
    ]);

    // A pronoun in the second half is the person named in the first.
    const pronoun = await as('ADMIN').say("What is Rahul Sharma's attendance and what are his fees?");
    expect(pronoun.calls.map((c) => c.tool).sort()).toEqual(['get_pending_fees', 'get_student_attendance']);
    expect(pronoun.calls.find((c) => c.tool === 'get_pending_fees').args).toEqual({ search: 'Rahul Sharma' });
  });

  it('counts both populations of "how many students and how many teachers"', async () => {
    const turn = await as('ADMIN').say('How many students are there and how many teachers?');
    expect([...turn.tools].sort()).toEqual(['list_users', 'search_students']);
    expect(turn.calls.find((c) => c.tool === 'list_users').args).toEqual({ ofRole: 'TEACHER' });
    expect(turn.reply).toMatch(/11 students/);
    expect(turn.reply).toMatch(/1 user\(s\) with the teacher role/);
  });

  it('says which part was refused instead of leaving it out', async () => {
    // A teacher may read the attendance and holds nothing in fees.
    const turn = await as('TEACHER').say("Show Aarav Mishra's attendance and fees");
    expect(turn.tools).toContain('get_student_attendance');
    expect(turn.calls.filter((c) => /fee|payment|invoice/.test(c.tool)).every((c) => c.status === 'FORBIDDEN')).toBe(true);
    expect(turn.reply).toMatch(/Aarav Mishra — Attendance Summary/);
    expect(turn.reply).toMatch(/Not included: fee information — your Teacher account doesn't have access to that/);
    expect(turn.result.unanswered).toEqual(['fee information']);
    expect(turn.reply).not.toMatch(/₹/);

    // Nothing is appended when every part was answered, or when there is one part.
    const whole = await as('ADMIN').say("Show Rahul Sharma's attendance and fees");
    expect(whole.reply).not.toMatch(/Not included/);
    const single = await as('TEACHER').say("Show Aarav Mishra's attendance");
    expect(single.reply).not.toMatch(/Not included/);
  });

  it('does not split one request that merely contains "and"', () => {
    const teacher = school.people.TEACHER.actor;
    expect(parsePlan('Mark Rahul Sharma and Aman Gupta absent today', teacher).map((s) => s.tool)).toEqual(['mark_attendance']);
    expect(parsePlan('Show the name and class of Rahul Sharma', teacher)).toHaveLength(1);
    expect(parseIntent('Post an announcement to Class 6 A: bring your atlas and compass', teacher).tool).toBe('create_announcement');
  });

  it('never performs a write off a conjunction without its own confirmation', async () => {
    const turn = await as('TEACHER').say('Show attendance of Class 6 A and mark Aman Gupta absent today');
    expect(turn.calls.some((c) => c.status === 'EXECUTED')).toBe(false);
    // The marking keeps its student and is proposed -- never performed, and
    // never refused for want of the student the sentence named
    // (askAi.combinedReadWrite covers the whole flow).
    const marking = turn.calls.filter((c) => c.tool === 'mark_attendance');
    expect(marking).toHaveLength(1);
    expect(marking[0].status).toBe('CONFIRMATION_REQUIRED');
    expect(turn.tools).toContain('get_attendance_roster');
  });
});

/* ── Phrasing (BUG-026) ──────────────────────────────────── */

describe('the grammars are narrow: a nearby sentence is not swallowed by them', () => {
  it.each([
    // A class and the word "now" is not a question about the timetable.
    ['ADMIN', 'Show attendance for Class 5 A now', 'get_attendance_roster'],
    // "Who has ..." is a library question only when it is about a book.
    ['ADMIN', 'Who has pending fees?', 'get_pending_fees'],
    ['ADMIN', 'Who has taken leave today?', 'get_leave_requests'],
    // Asking to SEE a ticket is not asking to create one.
    ['ADMIN', 'Show my new ticket', 'list_tickets'],
    ['PARENT', 'Show my tickets', 'list_tickets'],
    // Payments waiting on a decision are not the payments already made.
    ['ADMIN', 'Show payments pending approval', 'get_payment_change_requests'],
    // The lowest attendance IN one class is a question about that class.
    ['PRINCIPAL', 'Who has the lowest attendance in Class 5 A?', 'get_attendance_roster'],
    // "My students" is the hostel's residents only for somebody whose work is the hostel.
    ['ADMIN', 'Show my students', 'search_students'],
    ['TEACHER', 'Show my students', 'search_students'],
    // A named student's fees are that student's, not the school's collection.
    ['FINANCE', "Show Rahul Sharma's fees", 'get_pending_fees'],
  ])('%s: %j stays with %s', (role, message, tool) => {
    const plan = parsePlan(message, school.people[role].actor);
    expect(plan.map((s) => s.tool), message).toEqual([tool]);
  });

  it('a question about the school is not refused as a request for records', async () => {
    // A teacher holds nothing in the library, but "when does the library
    // close?" is something a notice may answer -- it is not "show me books".
    const turn = await as('TEACHER').say('When does the library close?');
    expect(turn.refused).not.toBe('NOT_PERMITTED');
  });
});

describe('BUG-026 — the same request, said differently, reaches the same place', () => {
  it.each([
    [['Show attendance for Class 6 B', 'Attendance for Class 6 B', 'attendance of 6-B', 'Class 6 B attendance', 'show me the attendance for class 6b'], 'get_attendance_roster', { className: expect.stringMatching(/6\s*-?\s*b/i) }],
    [['Show my class attendance', 'Attendance for my class', 'Show attendance for my class'], 'get_attendance_roster', {}],
    [['Show my timetable', 'my time table', 'What is my schedule today?'], 'get_timetable', {}],
    [['Show my assignments', 'What homework have I set?', 'Show homework'], 'get_assignments', {}],
  ])('%j', async (messages, tool, args) => {
    for (const message of messages) {
      const step = parseIntent(message, school.people.TEACHER.actor);
      expect(step?.tool, message).toBe(tool);
      expect(step?.args ?? {}, message).toMatchObject(args);
    }
  });

  it.each([
    ['Create assignment for Class 6 B Science'],
    ['Create a Science assignment for 6th B'],
    ['Make an assignment for Science - Class 6 B'],
    ['Set Science homework for class 6b'],
    ['Add a Science assignment for Class 6-B'],
  ])('%j is a Science assignment for Class 6 B', (message) => {
    const step = parseIntent(message, school.people.TEACHER.actor);
    expect(step?.tool, message).toBe('create_assignment');
    expect(step.args.subject?.toLowerCase(), message).toBe('science');
    expect(step.args.className, message).toMatch(/6\s*(?:th)?\s*-?\s*b/i);
  });

  it('asks rather than guesses when a request names no student', async () => {
    for (const message of ['Mark him present', 'Show his marks', 'What is her attendance?']) {
      const turn = await as('TEACHER').say(message);
      expect(turn.reply, message).toMatch(/which student/i);
      expect(turn.action, message).toBeNull();
    }
  });
});
