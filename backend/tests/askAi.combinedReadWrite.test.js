import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from 'vitest';
import { AgentAction } from '../src/models/agentAction.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { LeaveApplication } from '../src/models/leaveApplication.model.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { parsePlan, parseIntent } from '../src/modules/ai/agent/intent.js';
import { startApi } from './support/mcpHttp.js';
import { inSchool, OAK } from './support/mcpSchool.js';
import { seedAskAiSchool, conversationAs, INTERNAL_LEAKS } from './support/askAiSchool.js';

/**
 * One sentence that asks a question AND gives an instruction.
 *
 *   "Show attendance of Class 6 A and mark Aman Gupta absent today."
 *
 * It used to be read as a single attendance write that took its class from
 * the question and lost the student -- so the tool refused it ("Which students
 * should I mark?") and the attendance that was asked for was never shown.
 *
 * What is pinned here: both halves are kept; the question is answered in the
 * same turn; the instruction is only ever PROPOSED, and nothing is written
 * until it is confirmed; and when the instruction cannot be prepared, the
 * question is still answered and the reply says what was not done.
 *
 * Every claim about a write is read back from the database.
 */

let api;
let school;

beforeAll(async () => { api = await startApi(); });
afterAll(async () => { await api.close(); await resetMcpClient(); });

beforeEach(async () => {
  resetAgentThrottle();
  school = await seedAskAiSchool();
});

const teacher = () => school.people.TEACHER;
const as = (role, options) => conversationAs(school, role, options);
const count = (Model, filter = {}) => inSchool(OAK, () => Model.countDocuments(filter));
const amansRecords = () => inSchool(OAK, () => AttendanceRecord.find({ enrollmentId: school.aman.enrollment._id }).lean());
const allRecords = () => count(AttendanceRecord);
const expectNoLeak = (reply) => {
  for (const leak of INTERNAL_LEAKS) expect(String(reply), `leaked: ${leak}`).not.toMatch(leak);
};
const ask = async (person, message) => { resetAgentThrottle(); return api.ask(person, message); };
const wa = async (person, text) => { resetAgentThrottle(); return api.whatsapp(person, text); };

const SENTENCE = 'Show attendance of Class 6 A and mark Aman Gupta absent today.';
/** What the question half answers with: the Class 6 A register for today. */
const REGISTER = /Class 6 A on \d{4}-\d{2}-\d{2}: 3 student\(s\)/;
const PROPOSAL = /Mark attendance: Aman Gupta → ABSENT in Class 6 - A/;

/* ── The plan ─────────────────────────────────────────────── */

describe('the plan keeps both halves of the sentence', () => {
  const plan = (message, role = 'TEACHER') => parsePlan(message, school.people[role].actor);

  it('reads the reported sentence as the question, then the instruction with its student', () => {
    const steps = plan(SENTENCE);
    expect(steps.map((s) => s.tool)).toEqual(['get_attendance_roster', 'mark_attendance']);
    expect(steps[0].args).toMatchObject({ className: 'Class 6 A' });
    // The student is the instruction's; the class of the QUESTION is not
    // imposed on it (the tool finds Aman's class itself).
    expect(steps[1].args.students).toEqual([{ studentName: 'Aman Gupta', status: 'ABSENT' }]);
    expect(steps[1].args.className).toBeUndefined();
  });

  it('plans the instruction last whichever half is said first', () => {
    const steps = plan('Mark Aman Gupta absent today and show attendance of Class 6 A');
    expect(steps.map((s) => s.tool)).toEqual(['get_attendance_roster', 'mark_attendance']);
    expect(steps[1].args.students).toEqual([{ studentName: 'Aman Gupta', status: 'ABSENT' }]);
  });

  it('never lends the instruction\'s student to the question', () => {
    const [read] = plan(SENTENCE);
    expect(JSON.stringify(read.args)).not.toMatch(/Aman/);
  });

  it('resolves "him" in the instruction to the one student the question named', () => {
    const steps = plan("Show Aman Gupta's attendance and mark him absent today");
    expect(steps.map((s) => s.tool)).toEqual(['get_student_attendance', 'mark_attendance']);
    expect(steps[0].args).toMatchObject({ studentName: 'Aman Gupta' });
    expect(steps[1].args.students).toEqual([{ studentName: 'Aman Gupta', status: 'ABSENT' }]);
  });

  it('gives an instruction that names nobody the class the question named', () => {
    const steps = plan('Show attendance of Class 6 A and mark everyone present today');
    expect(steps.map((s) => s.tool)).toEqual(['get_attendance_roster', 'mark_attendance']);
    expect(steps[1].args).toMatchObject({ className: 'Class 6 A', everyone: { status: 'PRESENT' } });
  });

  it('reads two markings joined by "and" as ONE instruction, with both students', () => {
    const steps = plan('Show attendance of Class 6 A and mark Aman Gupta absent and mark Rahul Sharma present');
    expect(steps.map((s) => s.tool)).toEqual(['get_attendance_roster', 'mark_attendance']);
    expect(steps[1].args.students).toEqual([
      { studentName: 'Aman Gupta', status: 'ABSENT' },
      { studentName: 'Rahul Sharma', status: 'PRESENT' },
    ]);
  });

  it('never plans more than one write', () => {
    for (const message of [
      SENTENCE,
      'Mark Aman Gupta absent today and show attendance of Class 6 A',
      'Show attendance of Class 6 A and mark Aman Gupta absent and mark Rahul Sharma present',
      'Show my timetable and apply for leave tomorrow because of fever',
    ]) {
      const writes = plan(message).filter((s) => !/^(get|list|search)_/.test(s.tool));
      expect(writes.length, message).toBe(1);
      expect(plan(message).at(-1).tool, message).toBe(writes[0].tool);
    }
  });

  it('works for a write other than attendance', () => {
    const steps = plan('Show my timetable and apply for leave tomorrow because of fever');
    expect(steps.map((s) => s.tool)).toEqual(['get_timetable', 'apply_for_leave']);
    expect(steps[1].args).toMatchObject({ reason: 'fever' });
    expect(steps[1].args.fromDate).toBe(steps[1].args.toDate);
  });
});

describe('existing routing is unchanged: a conjunction inside ONE request is not split', () => {
  const actor = () => school.people.TEACHER.actor;

  it('keeps several students in one marking', () => {
    const steps = parsePlan('Mark Rahul Sharma and Aman Gupta absent today', actor());
    expect(steps).toHaveLength(1);
    expect(steps[0].tool).toBe('mark_attendance');
    expect(steps[0].args.students).toEqual([
      { studentName: 'Rahul Sharma', status: 'ABSENT' },
      { studentName: 'Aman Gupta', status: 'ABSENT' },
    ]);
  });

  it('does not put the repeated verb into a student\'s name', () => {
    const [step] = parsePlan('Mark Rahul Sharma absent and mark Aman Gupta present today', actor());
    expect(step.args.students).toEqual([
      { studentName: 'Rahul Sharma', status: 'ABSENT' },
      { studentName: 'Aman Gupta', status: 'PRESENT' },
    ]);
  });

  it('keeps the words of a notice whole, even when they contain "and" and a verb', () => {
    for (const message of [
      'Post an announcement to Class 6 A: bring your atlas and compass',
      'Post an announcement to Class 6 A saying bring your atlas and show your ID card',
    ]) {
      const steps = parsePlan(message, actor());
      expect(steps, message).toHaveLength(1);
      expect(steps[0].tool).toBe('create_announcement');
    }
    expect(parseIntent('Post an announcement to Class 6 A saying bring your atlas and show your ID card', actor()).args.title)
      .toMatch(/atlas and show your ID card/i);
  });

  it('still answers two questions as two reads', () => {
    const admin = school.people.ADMIN.actor;
    expect(parsePlan("Show Rahul Sharma's attendance and fees", admin).map((s) => s.tool))
      .toEqual(['get_student_attendance', 'get_pending_fees']);
    // "record" opens an instruction, but "record of fees" is a question.
    expect(parsePlan('Show attendance of Class 6 A and record of fees for Rahul Sharma', admin).map((s) => s.tool))
      .toEqual(['get_attendance_roster', 'get_pending_fees']);
  });
});

/* ── Website ─────────────────────────────────────────────── */

describe('website: the question is answered and the instruction is proposed', () => {
  it('shows the register AND asks to confirm the marking, in one reply, writing nothing', async () => {
    const before = await allRecords();
    const res = await ask(teacher(), SENTENCE);
    expect(res.status).toBe(200);
    expect(res.reply).toMatch(REGISTER);
    expect(res.reply).toMatch(PROPOSAL);
    expect(res.reply).toMatch(/Shall I go ahead\?/);
    // The answer comes before the question it is asked to confirm.
    expect(res.reply.search(REGISTER)).toBeLessThan(res.reply.search(PROPOSAL));
    expect(res.action?.confirmToken).toBeTruthy();
    expect(res.action.tool).toBe('mark_attendance');
    expectNoLeak(res.reply);

    expect(await allRecords()).toBe(before);
    expect(await amansRecords()).toHaveLength(0);
    expect(await count(AgentAction, { status: 'PENDING' })).toBe(1);
  });

  it('audits the read as READ and the write as awaiting confirmation -- nothing EXECUTED', async () => {
    const turn = await as('TEACHER').say(SENTENCE);
    expect(turn.calls.map((c) => [c.tool, c.status])).toEqual([
      ['get_attendance_roster', 'READ'],
      ['mark_attendance', 'CONFIRMATION_REQUIRED'],
    ]);
    expect(turn.calls.some((c) => c.status === 'EXECUTED')).toBe(false);
  });

  it('writes exactly once on confirmation, and not again on a second confirm', async () => {
    const res = await ask(teacher(), SENTENCE);
    const done = await api.confirm(teacher(), res.action.confirmToken);
    expect(done.status).toBe(200);
    expect(done.reply).toMatch(/Aman Gupta → ABSENT/);
    const records = await amansRecords();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('ABSENT');

    await api.confirm(teacher(), res.action.confirmToken);
    expect(await amansRecords()).toHaveLength(1);
    expect(await count(AgentAction, { status: 'PENDING' })).toBe(0);
  });

  it('writes nothing when the proposal is cancelled', async () => {
    const before = await allRecords();
    const res = await ask(teacher(), SENTENCE);
    const cancelled = await api.confirm(teacher(), res.action.confirmToken, false);
    expect(cancelled.status).toBe(200);
    expect(await allRecords()).toBe(before);
    expect(await count(AgentAction, { status: 'PENDING' })).toBe(0);
    // A cancelled proposal cannot be confirmed afterwards.
    await api.confirm(teacher(), res.action.confirmToken);
    expect(await allRecords()).toBe(before);
  });

  it('writes nothing when the proposal has expired', async () => {
    const before = await allRecords();
    const res = await ask(teacher(), SENTENCE);
    await inSchool(OAK, () => AgentAction.updateMany({ status: 'PENDING' }, { $set: { expiresAt: new Date(Date.now() - 60_000) } }));
    const late = await api.confirm(teacher(), res.action.confirmToken);
    expect(late.reply ?? late.body?.message ?? '').not.toMatch(/Attendance recorded/);
    expect(await allRecords()).toBe(before);
  });

  it('cannot be confirmed by somebody else', async () => {
    const before = await allRecords();
    const res = await ask(teacher(), SENTENCE);
    const other = await api.confirm(school.people.ADMIN, res.action.confirmToken);
    expect(other.reply ?? '').not.toMatch(/Attendance recorded/);
    expect(await allRecords()).toBe(before);
  });

  it('gives the same result when the instruction is said first', async () => {
    const res = await ask(teacher(), 'Mark Aman Gupta absent today and show attendance of Class 6 A');
    expect(res.reply).toMatch(REGISTER);
    expect(res.reply).toMatch(PROPOSAL);
    expect(res.action?.confirmToken).toBeTruthy();
    expect(await amansRecords()).toHaveLength(0);
  });

  it('proposes a whole-class marking for the class the question named', async () => {
    const before = await allRecords();
    const res = await ask(teacher(), 'Show attendance of Class 6 A and mark everyone present today');
    expect(res.reply).toMatch(REGISTER);
    expect(res.reply).toMatch(/everyone \(3\) → PRESENT in Class 6 A/);
    expect(res.action?.confirmToken).toBeTruthy();
    expect(await allRecords()).toBe(before);
  });
});

/* ── WhatsApp ─────────────────────────────────────────────── */

describe('WhatsApp: the same sentence, the same two halves', () => {
  it('answers the register, and sends the write to the website: a YES writes nothing', async () => {
    // Marking somebody else's attendance is not confirmed over WhatsApp
    // (registry.js confirmableOn): the question is still answered.
    const first = await wa(teacher(), SENTENCE);
    expect(first.reply).toMatch(REGISTER);
    expect(first.reply).toMatch(/EduOS website/);
    expect(first.reply).not.toMatch(/Reply YES to confirm/);
    expectNoLeak(first.reply);
    expect(await amansRecords()).toHaveLength(0);

    await wa(teacher(), 'YES');
    expect(await amansRecords()).toHaveLength(0);
  }, 120_000);

  it('writes nothing on NO, and a later YES confirms nothing', async () => {
    const before = await allRecords();
    await wa(teacher(), SENTENCE);
    await wa(teacher(), 'NO');
    expect(await allRecords()).toBe(before);
    await wa(teacher(), 'YES');
    expect(await allRecords()).toBe(before);
  }, 120_000);

  it('answers both channels alike', async () => {
    const web = await ask(teacher(), SENTENCE);
    const phone = await wa(teacher(), SENTENCE);
    const register = REGISTER.exec(web.reply)[0];
    expect(phone.reply).toContain(register);
    expect(web.reply).toMatch(PROPOSAL);
    expect(phone.reply).toMatch(/EduOS website/);
  }, 120_000);
});

/* ── When the instruction cannot be prepared ──────────────── */

describe('an instruction that cannot be prepared: the question is still answered, and nothing is written', () => {
  const cases = [
    ['an ambiguous student', 'Show attendance of Class 6 A and mark Mishra absent today', /More than one student matches "Mishra".*Which one\?/s],
    ['no student or status at all', 'Show attendance of Class 6 A and mark attendance', /Which students should I mark, and as what\?/],
    ['a student who does not exist', 'Show attendance of Class 6 A and mark Zubin Contractor absent today', /No student named/],
    ['a student outside the teacher\'s classes', 'Show attendance of Class 6 A and mark Rohan Desai absent today', /No student named "Rohan Desai"/],
    ['a marking that changes nothing', 'Show attendance of Class 6 A and mark Rahul Sharma absent today', /already recorded that way.*Nothing to change/s],
  ];

  it.each(cases)('%s', async (_label, message, said) => {
    const before = await allRecords();
    const turn = await as('TEACHER').say(message);
    expect(turn.status).toBe(200);
    expect(turn.reply).toMatch(REGISTER);
    expect(turn.reply).toMatch(said);
    expect(turn.reply).not.toMatch(/Shall I go ahead/);
    expect(turn.action).toBeNull();
    expect(turn.calls.map((c) => [c.tool, c.status])).toEqual([
      ['get_attendance_roster', 'READ'],
      ['mark_attendance', 'PREPARE_FAILED'],
    ]);
    expectNoLeak(turn.reply);
    expect(await allRecords()).toBe(before);
    expect(await count(AgentAction, { status: 'PENDING' })).toBe(0);
  });

  it('an instruction about "him" with nobody named is reported as not done -- never guessed, never dropped', async () => {
    const before = await allRecords();
    const turn = await as('TEACHER').say('Show attendance of Class 6 A and mark him absent');
    expect(turn.reply).toMatch(REGISTER);
    expect(turn.reply).toMatch(/Not done: "mark him absent"/);
    expect(turn.reply).toMatch(/student's name/);
    expect(turn.action).toBeNull();
    expect(turn.tools).toEqual(['get_attendance_roster']);
    expect(await allRecords()).toBe(before);
    expect(await count(AgentAction)).toBe(0);
  });

  it('the same, with the instruction said first', async () => {
    const turn = await as('TEACHER').say('Mark him absent and show attendance of Class 6 A');
    expect(turn.reply).toMatch(REGISTER);
    expect(turn.reply).toMatch(/Not done: "Mark him absent"/i);
    expect(turn.action).toBeNull();
    expect(await count(AgentAction)).toBe(0);
  });

  it('the answer to the tool\'s question completes the instruction, which is then still only proposed', async () => {
    const chat = as('TEACHER');
    const first = await chat.say('Show attendance of Class 6 A and mark attendance');
    expect(first.reply).toMatch(/Which students should I mark/);
    const second = await chat.say('Aman Gupta absent');
    expect(second.calls.map((c) => [c.tool, c.status])).toEqual([['mark_attendance', 'CONFIRMATION_REQUIRED']]);
    expect(second.reply).toMatch(PROPOSAL);
    expect(await amansRecords()).toHaveLength(0);
  });

  it('a new question asked instead of answering is answered, and the open instruction is not carried into it', async () => {
    const chat = as('TEACHER');
    await chat.say('Show attendance of Class 6 A and mark attendance');
    const next = await chat.say('Show my timetable');
    expect(next.tools).toEqual(['get_timetable']);
    expect(next.action).toBeNull();
    expect(await count(AgentAction)).toBe(0);
  });
});

/* ── When the QUESTION is refused ─────────────────────────── */

describe('a refused question does not take the instruction down with it, or the other way round', () => {
  it('says the class is not the teacher\'s, and still proposes the marking that is', async () => {
    const turn = await as('TEACHER').say('Show attendance of Class 10 B and mark Aman Gupta absent today');
    expect(turn.reply).toMatch(/Class 10 B is not one of your classes/);
    expect(turn.reply).not.toMatch(/Rohan|Meera/);
    expect(turn.reply).toMatch(PROPOSAL);
    expect(turn.action?.confirmToken).toBeTruthy();
    expect(await amansRecords()).toHaveLength(0);
  });

  it('a role that may not mark attendance gets its own answer and a refusal -- no proposal', async () => {
    const before = await allRecords();
    const turn = await as('STUDENT').say('Show my attendance and mark Aman Gupta absent today');
    expect(turn.reply).toMatch(/Attendance/);
    expect(turn.reply).toMatch(/not authorized/i);
    expect(turn.action).toBeNull();
    expect(turn.calls.find((c) => c.tool === 'mark_attendance')?.status).toBe('FORBIDDEN');
    expect(turn.calls.some((c) => ['EXECUTED', 'CONFIRMATION_REQUIRED'].includes(c.status))).toBe(false);
    expect(await allRecords()).toBe(before);
    expect(await count(AgentAction)).toBe(0);
  });

  it('a parent cannot mark through a joined sentence either', async () => {
    const before = await allRecords();
    const turn = await as('PARENT').say("Show my child's attendance and mark Aman Gupta absent today");
    expect(turn.action).toBeNull();
    expect(turn.calls.some((c) => ['EXECUTED', 'CONFIRMATION_REQUIRED'].includes(c.status))).toBe(false);
    expect(await allRecords()).toBe(before);
  });
});

/* ── Another write ────────────────────────────────────────── */

describe('the same shape with a different instruction', () => {
  // Staff leave counts school days: on a weekend "tomorrow" would be a Sunday and
  // nothing could be applied for, so these run on a fixed Wednesday (after the seed).
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T04:30:00Z')); });
  afterEach(() => { vi.useRealTimers(); });
  it('shows a student their attendance and proposes their leave; nothing is applied before a yes', async () => {
    const student = school.people.STUDENT;
    const res = await ask(student, 'Show my attendance and apply for leave tomorrow because of fever');
    expect(res.reply).toMatch(/Attendance Summary/);
    expect(res.reply).toMatch(/Apply for leave from \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2} — "fever"\. Shall I go ahead\?/);
    expect(res.action?.tool).toBe('apply_for_leave');
    expect(await count(LeaveApplication)).toBe(0);
    await api.confirm(student, res.action.confirmToken);
    expect(await count(LeaveApplication)).toBe(1);
  });

  it('a member of staff is shown its timetable and their own staff leave is drafted -- not a student leave', async () => {
    // Changed deliberately in part 3: a member of staff (staffleave.apply) asking to apply for leave
    // means their OWN staff leave, so it reaches apply_staff_leave as a draft (or a question for the
    // day, kind and reason) instead of the old "isn't enabled for your account" refusal.
    const turn = await as('TEACHER').say('Show my timetable and apply for leave tomorrow because of fever');
    expect(turn.reply).toMatch(/Timetable/);
    expect(turn.reply).not.toMatch(/not authorized|isn't enabled/i);
    expect(turn.action?.tool).toBe('apply_staff_leave');
    // The student leave of absence is never attempted, and nothing is filed before yes.
    expect(turn.calls.some((c) => c.tool === 'apply_for_leave')).toBe(false);
    expect(await count(LeaveApplication)).toBe(0);
  });
});
