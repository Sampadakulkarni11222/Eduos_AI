import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { AgentAction } from '../src/models/agentAction.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { LeaveApplication } from '../src/models/leaveApplication.model.js';
import { StaffLeave } from '../src/models/staffLeave.model.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { parsePlan } from '../src/modules/ai/agent/intent.js';
import { validateArgs } from '../src/modules/ai/mcp/validate.js';
import { impossibleDatesIn, isCalendarIsoDate } from '../src/utils/naturalDates.js';
import { nameFromText } from '../src/utils/peopleNames.js';
import { startApi } from './support/mcpHttp.js';
import { inSchool, OAK } from './support/mcpSchool.js';
import { seedAskAiSchool, conversationAs, INTERNAL_LEAKS } from './support/askAiSchool.js';

/**
 * Four defects confirmed while testing the earlier Ask AI fixes, each of which
 * was present on the code before those fixes too:
 *
 *   A. "Mark Aman Gupta absent on 31 February" was proposed for TODAY.
 *   B. After "More than one student matches ... Which one?", the answer
 *      "Aarav Mishra" ran a student search and the marking was forgotten.
 *   C. "Show Aman Gupta attendance" (no possessive) returned a class register
 *      -- and, for a student or a parent, their OWN record.
 *   D. A teacher's leave request inside a joined sentence was answered with
 *      the bare "You are not authorized to access this information".
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

const as = (role, options) => conversationAs(school, role, options);
const count = (Model, filter = {}) => inSchool(OAK, () => Model.countDocuments(filter));
const recordsOf = (who) => inSchool(OAK, () => AttendanceRecord.find({ enrollmentId: who.enrollment._id }).lean());
const expectNoLeak = (reply) => {
  for (const leak of INTERNAL_LEAKS) expect(String(reply), `leaked: ${leak}`).not.toMatch(leak);
};
const wa = async (person, text) => { resetAgentThrottle(); return api.whatsapp(person, text); };
const ask = async (person, message) => { resetAgentThrottle(); return api.ask(person, message); };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => iso(new Date());

/* ════════════════════════════════════════════════════════════
   A. Impossible dates
   ════════════════════════════════════════════════════════════ */

describe('A — the detector: a date that names no day', () => {
  // A fixed "now" in the school's timezone, so the year a bare month is read
  // in does not depend on the day the suite runs.
  const NOW = new Date(2026, 9, 12);
  const found = (text, now = NOW) => impossibleDatesIn(text, now);

  it.each([
    ['Mark Aman Gupta absent on 31 February', ['31 February']],
    ['absent on 30 Feb 2028', ['30 Feb 2028']],
    ['on February 30', ['February 30']],
    ['31st of April', ['31st of April']],
    ['April 31, 2026', ['April 31, 2026']],
    ['who was absent on 31 Nov?', ['31 Nov']],
    ['31 June to 2 July', ['31 June']],
    ['leave from 30 to 31 June', ['30 to 31 June']],
    ['Sept 31', ['Sept 31']],
    ['31-02-2026', ['31-02-2026']],
    ['31/04/2026', ['31/04/2026']],
    ['2026-02-31', ['2026-02-31']],
    ['2026-13-01', ['2026-13-01']],
    ['32 May 2026', ['32 May 2026']],
  ])('%s', (text, expected) => {
    expect(found(text)).toEqual(expected);
  });

  it('knows leap years', () => {
    expect(found('29 February 2028')).toEqual([]);
    expect(found('29 Feb 2024')).toEqual([]);
    expect(found('29 February 2027')).toEqual(['29 February 2027']);
    expect(found('29-02-2028')).toEqual([]);
    expect(found('29-02-2027')).toEqual(['29-02-2027']);
    expect(found('2028-02-29')).toEqual([]);
    expect(found('2027-02-29')).toEqual(['2027-02-29']);
    // 1900 and 2100 are divisible by four and are NOT leap years; 2000 is.
    expect(found('29-02-2100')).toEqual(['29-02-2100']);
    expect(found('29-02-2000')).toEqual([]);
  });

  it('judges a date written with no year in the year it would be read in', () => {
    // October 2026: February is this year's, which has no 29th.
    expect(found('29 February')).toEqual(['29 February']);
    // October 2028: February 2028 does.
    expect(found('29 February', new Date(2028, 9, 12))).toEqual([]);
  });

  it('accepts every real month boundary, and a range across the year end', () => {
    for (const real of [
      '31 January', '28 February', '31 March', '30 April', '31 May 2026', '30 June', '31 July', '31 August',
      '30 September', '31 October', '30 November', '31 December', '1 January', '31 December 2026',
      'leave from 30 December to 2 January', 'from 2026-12-31 to 2027-01-01', '31-12-2026', '01-01-2027',
    ]) expect(found(real), real).toEqual([]);
  });

  it('does not take a number that is not a day for a date', () => {
    for (const notADate of [
      'Give April 31 marks', 'Give June 45 marks for the test', 'show 45 marks', 'top 50 Dec defaulters',
      'Class 12 March attendance', '31 may be absent', 'show 30 students', 'phone 98-76-5432', 'INV-2026-02-31',
      'February 2026', 'June 2026 fees', 'attendance on 5th August 2026',
    ]) expect(found(notADate), notADate).toEqual([]);
  });

  it('isCalendarIsoDate tells a shape from a day', () => {
    expect(isCalendarIsoDate('2026-12-31')).toBe(true);
    expect(isCalendarIsoDate('2028-02-29')).toBe(true);
    expect(isCalendarIsoDate('2027-02-29')).toBe(false);
    expect(isCalendarIsoDate('2026-02-31')).toBe(false);
    expect(isCalendarIsoDate('2026-00-10')).toBe(false);
    expect(isCalendarIsoDate('2026-13-01')).toBe(false);
    expect(isCalendarIsoDate('2026-2-3')).toBe(false);
  });
});

describe('A — the MCP validator refuses a date-shaped value that is not a day, for every tool', () => {
  const schema = {
    type: 'object',
    properties: { date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, month: { type: 'string', pattern: '^\\d{4}-\\d{2}$' } },
  };

  it('whoever supplied it', () => {
    for (const bad of ['2026-02-31', '2027-02-29', '2026-04-31', '2026-13-01', '2026-00-00']) {
      const result = validateArgs(schema, { date: bad });
      expect(result.errors?.join(' ') ?? '', bad).toMatch(/date is not in the expected format/);
    }
  });

  it('and still accepts real ones, written either way', () => {
    expect(validateArgs(schema, { date: '2026-02-28' }).value.date).toBe('2026-02-28');
    expect(validateArgs(schema, { date: '2028-02-29' }).value.date).toBe('2028-02-29');
    expect(validateArgs(schema, { date: '31-12-2026' }).value.date).toBe('2026-12-31');
    expect(validateArgs(schema, { month: '2026-02' }).value.month).toBe('2026-02');
  });
});

describe('A — the assistant asks for a real date and does nothing else', () => {
  const REQUEST = 'Mark Aman Gupta absent on 31 February';

  it('never proposes today in its place: no tool is called, nothing is proposed or written', async () => {
    const turn = await as('TEACHER').say(REQUEST);
    expect(turn.status).toBe(200);
    expect(turn.reply).toMatch(/"31 February" is not a calendar date/);
    expect(turn.reply).toMatch(/Please give a valid date/);
    expect(turn.reply).not.toMatch(/Shall I go ahead/);
    expect(turn.refused).toBe('INVALID_DATE');
    expect(turn.action).toBeNull();
    expect(turn.calls).toEqual([]);
    expectNoLeak(turn.reply);
    expect(await recordsOf(school.aman)).toHaveLength(0);
    expect(await count(AgentAction)).toBe(0);
    const entry = await inSchool(OAK, () => AuditLog.findOne({ action: 'agent.invalid_date' }).lean());
    expect(entry?.after?.status).toBe('REFUSED');
  });

  it.each([
    'Mark Aman Gupta absent on 30 Feb',
    'Mark Aman Gupta absent on February 30',
    'Mark Aman Gupta absent on 31-02-2026',
    'Mark Aman Gupta absent on 2026-02-31',
    'Mark Aman Gupta absent on 29 February 2027',
    'Mark Aman Gupta absent on 31 April',
    'Show attendance of Class 6 A and mark Aman Gupta absent on 31 February',
    'Who was absent in Class 6 A on 31 November?',
  ])('%s', async (message) => {
    const before = await count(AttendanceRecord);
    const turn = await as('TEACHER').say(message);
    expect(turn.refused).toBe('INVALID_DATE');
    expect(turn.reply).toMatch(/not a calendar date/);
    expect(turn.calls).toEqual([]);
    expect(turn.action).toBeNull();
    expect(await count(AttendanceRecord)).toBe(before);
  });

  it('a real date is still read: the last day of February, and a leap day', async () => {
    const turn = await as('TEACHER').say('Mark Aman Gupta absent on 28 February 2026');
    expect(turn.calls.at(-1)).toMatchObject({ tool: 'mark_attendance', status: 'CONFIRMATION_REQUIRED' });
    expect(turn.calls.at(-1).args.date).toBe('2026-02-28');
    const leap = await as('TEACHER').say('Mark Aman Gupta absent on 29 February 2024');
    expect(leap.calls.at(-1).args.date).toBe('2024-02-29');
  });

  it('the valid date given in answer resumes the same marking, still only proposed', async () => {
    const chat = as('TEACHER');
    await chat.say(REQUEST);
    const next = await chat.say('28 February');
    expect(next.calls).toHaveLength(1);
    expect(next.calls[0]).toMatchObject({ tool: 'mark_attendance', status: 'CONFIRMATION_REQUIRED' });
    expect(next.calls[0].args).toMatchObject({ students: [{ studentName: 'Aman Gupta', status: 'ABSENT' }], date: '2026-02-28' });
    expect(next.reply).toMatch(/Aman Gupta → ABSENT in Class 6 - A on 2026-02-28\. Shall I go ahead\?/);
    expect(await recordsOf(school.aman)).toHaveLength(0);
  });

  it('"today" in answer is today in the school\'s timezone', async () => {
    const chat = as('TEACHER');
    await chat.say(REQUEST);
    const next = await chat.say('today');
    expect(next.calls[0].args.date).toBe(today());
  });

  it('a second impossible date is asked about again, not accepted', async () => {
    const chat = as('TEACHER');
    await chat.say(REQUEST);
    const next = await chat.say('30 February');
    expect(next.refused).toBe('INVALID_DATE');
    expect(next.calls).toEqual([]);
    expect(await count(AgentAction)).toBe(0);
  });

  it('"yes" gives no date: it is asked for again, never taken as "use today"', async () => {
    const chat = as('TEACHER');
    await chat.say(REQUEST);
    for (const agreement of ['yes', 'ok', 'go ahead']) {
      const next = await chat.say(agreement);
      expect(next.reply, agreement).toMatch(/I still need a valid date/);
      expect(next.calls, agreement).toEqual([]);
      expect(next.action, agreement).toBeNull();
    }
    expect(await count(AgentAction)).toBe(0);
    // The date, when it does come, still finishes the request.
    const dated = await chat.say('28 February');
    expect(dated.calls[0]).toMatchObject({ tool: 'mark_attendance', status: 'CONFIRMATION_REQUIRED' });
    expect(dated.calls[0].args.date).toBe('2026-02-28');
  });

  it('"cancel" drops it, and the request is not resumed by a later date', async () => {
    const chat = as('TEACHER');
    await chat.say(REQUEST);
    const cancelled = await chat.say('cancel');
    expect(cancelled.reply).toMatch(/I have not made any changes/);
    expect(cancelled.calls).toEqual([]);
    const later = await chat.say('28 February');
    expect(later.calls.some((c) => c.tool === 'mark_attendance')).toBe(false);
    expect(await count(AgentAction)).toBe(0);
    expect(await recordsOf(school.aman)).toHaveLength(0);
  });

  it('is refused for a leave application too, and for a range with one bad end', async () => {
    for (const message of [
      'Apply for leave on 31 February because of fever',
      'Apply for leave from 30 February to 2 March because of fever',
      'Apply for leave from 30 to 31 June because of travel',
    ]) {
      const turn = await as('STUDENT').say(message);
      expect(turn.refused, message).toBe('INVALID_DATE');
      expect(turn.action, message).toBeNull();
    }
    expect(await count(LeaveApplication)).toBe(0);
    expect(await count(AgentAction)).toBe(0);
  });

  it('behaves the same on WhatsApp and on the website', async () => {
    const web = await ask(school.people.TEACHER, REQUEST);
    expect(web.status).toBe(200);
    expect(web.reply).toMatch(/"31 February" is not a calendar date/);
    expect(web.action ?? null).toBeNull();
    const phone = await wa(school.people.TEACHER, REQUEST);
    expect(phone.reply).toMatch(/"31 February" is not a calendar date/);
    expect(phone.reply).not.toMatch(/Reply YES/);
    // A YES now has nothing to confirm.
    await wa(school.people.TEACHER, 'YES');
    expect(await recordsOf(school.aman)).toHaveLength(0);
    expect(await count(AgentAction)).toBe(0);
  }, 120_000);
});

/* ════════════════════════════════════════════════════════════
   B. Choosing between the students offered
   ════════════════════════════════════════════════════════════ */

describe('B — the choice resumes the request it was asked about', () => {
  const REQUEST = 'Mark Mishra absent today';
  const WHICH = /More than one student matches "Mishra": Ananya Mishra \(OAK-52\), Aarav Mishra \(OAK-51\)\. Which one\?/;
  const PROPOSES_AARAV = /Mark attendance: Aarav Mishra → ABSENT in Class 5 - A on \d{4}-\d{2}-\d{2}\. Shall I go ahead\?/;

  const opened = async () => {
    const chat = as('TEACHER');
    const first = await chat.say(REQUEST);
    expect(first.reply).toMatch(WHICH);
    expect(first.calls).toEqual([expect.objectContaining({ tool: 'mark_attendance', status: 'PREPARE_FAILED' })]);
    return chat;
  };

  it.each([
    ['the full name', 'Aarav Mishra'],
    ['the full name, loosely', 'aarav mishra please'],
    ['the first name only one of them has', 'Aarav'],
    ['the admission number', 'OAK-51'],
    ['the position', 'the second one'],
    ['"last"', 'last'],
  ])('by %s', async (_label, answer) => {
    const chat = await opened();
    const before = await count(AttendanceRecord);
    const next = await chat.say(answer);
    // The ORIGINAL operation, with its status and its date -- not a search.
    expect(next.calls).toHaveLength(1);
    expect(next.calls[0]).toMatchObject({ tool: 'mark_attendance', status: 'CONFIRMATION_REQUIRED' });
    expect(next.calls[0].args).toEqual({ students: [{ studentName: 'Aarav Mishra', status: 'ABSENT' }], date: today() });
    expect(next.reply).toMatch(PROPOSES_AARAV);
    expect(next.tools).not.toContain('search_students');
    // Proposed, not written.
    expect(await count(AttendanceRecord)).toBe(before);
    expect(await count(AgentAction, { status: 'PENDING' })).toBe(1);
  });

  it('writes once on confirmation, for the student chosen and nobody else', async () => {
    const person = school.people.TEACHER;
    const history = [];
    const say = async (message) => {
      resetAgentThrottle();
      const res = await api.post(person, '/ai/agent', { message, source: 'WEB', history: [...history] });
      const data = res.body.data ?? {};
      history.push({ role: 'user', text: message }, { role: 'assistant', text: String(data.reply ?? '') });
      return data;
    };
    await say(REQUEST);
    const proposal = await say('Aarav Mishra');
    expect(proposal.action?.confirmToken).toBeTruthy();
    const aaravBefore = (await recordsOf(school.aarav)).filter((r) => r.status === 'ABSENT').length;
    const ananyaBefore = await recordsOf(school.ananya);

    const done = await api.confirm(person, proposal.action.confirmToken);
    expect(done.reply).toMatch(/Aarav Mishra → ABSENT/);
    expect((await recordsOf(school.aarav)).filter((r) => r.status === 'ABSENT')).toHaveLength(aaravBefore + 1);
    expect(await recordsOf(school.ananya)).toEqual(ananyaBefore);

    // A second confirmation of the same proposal writes nothing more.
    await api.confirm(person, proposal.action.confirmToken);
    expect((await recordsOf(school.aarav)).filter((r) => r.status === 'ABSENT')).toHaveLength(aaravBefore + 1);
  });

  it('a name that was not offered is not taken: the same question is asked again', async () => {
    const chat = await opened();
    for (const answer of ['Rohit Mishra', 'Mishra', 'Aman Gupta']) {
      const next = await chat.say(answer);
      expect(next.reply, answer).toMatch(WHICH);
      expect(next.action, answer).toBeNull();
      expect(next.calls.map((c) => [c.tool, c.status]), answer).toEqual([['mark_attendance', 'PREPARE_FAILED']]);
    }
    expect(await count(AgentAction)).toBe(0);
    // ...and a valid choice after the wrong ones still works.
    const picked = await chat.say('Aarav Mishra');
    expect(picked.reply).toMatch(PROPOSES_AARAV);
  });

  it('the chosen student is revalidated: one already marked that way changes nothing', async () => {
    const chat = await opened();
    const before = await count(AttendanceRecord);
    // Ananya is ALREADY absent today in the fixture.
    const next = await chat.say('Ananya Mishra');
    expect(next.calls[0]).toMatchObject({ tool: 'mark_attendance', status: 'PREPARE_FAILED' });
    expect(next.reply).toMatch(/already recorded that way.*Ananya Mishra → ABSENT.*Nothing to change/s);
    expect(next.action).toBeNull();
    expect(await count(AttendanceRecord)).toBe(before);
  });

  it('"cancel" drops the request, and the name said afterwards does not revive it', async () => {
    const chat = await opened();
    const before = await count(AttendanceRecord);
    const cancelled = await chat.say('cancel');
    expect(cancelled.reply).toMatch(/I have not made any changes/);
    expect(cancelled.calls).toEqual([]);
    const later = await chat.say('Aarav Mishra');
    expect(later.calls.some((c) => c.tool === 'mark_attendance')).toBe(false);
    expect(later.action).toBeNull();
    expect(await count(AttendanceRecord)).toBe(before);
    expect(await count(AgentAction)).toBe(0);
  });

  it('a different question asked instead closes it: the stale request is not acted on', async () => {
    const chat = await opened();
    const other = await chat.say('Show my timetable');
    expect(other.tools).toEqual(['get_timetable']);
    const later = await chat.say('Aarav Mishra');
    expect(later.calls.some((c) => c.tool === 'mark_attendance')).toBe(false);
    expect(await count(AgentAction)).toBe(0);
  });

  it('a new request said in full replaces the open one rather than being read as the choice', async () => {
    const chat = await opened();
    const next = await chat.say('Mark Aman Gupta late today');
    expect(next.calls.at(-1)).toMatchObject({ tool: 'mark_attendance', status: 'CONFIRMATION_REQUIRED' });
    expect(next.calls.at(-1).args.students).toEqual([{ studentName: 'Aman Gupta', status: 'LATE' }]);
  });

  it('resumes after a misspelling too ("Did you mean ...?")', async () => {
    const chat = as('TEACHER');
    const first = await chat.say('Mark Arav Mishra absent today');
    expect(first.reply).toMatch(/No student named "Arav Mishra"\. Did you mean: Aarav Mishra \(OAK-51\)\?/);
    const next = await chat.say('Aarav Mishra');
    expect(next.calls[0]).toMatchObject({ tool: 'mark_attendance', status: 'CONFIRMATION_REQUIRED' });
    expect(next.reply).toMatch(PROPOSES_AARAV);
  });

  it('resumes a READ the same way, and returns only the chosen student', async () => {
    const chat = as('TEACHER');
    const first = await chat.say("Show Mishra's attendance");
    expect(first.reply).toMatch(WHICH);
    const next = await chat.say('Aarav Mishra');
    expect(next.calls).toEqual([expect.objectContaining({ tool: 'get_student_attendance', status: 'READ' })]);
    expect(next.calls[0].args).toEqual({ studentName: 'Aarav Mishra' });
    expect(next.reply).toMatch(/Aarav Mishra — Attendance Summary/);
    expect(next.reply).not.toMatch(/Ananya/);
  });

  it('a student outside the caller\'s classes cannot be chosen into scope', async () => {
    // The options are only ever the caller's own students; naming one who is
    // not among them re-asks, and the tool would refuse the name regardless.
    const chat = await opened();
    const next = await chat.say('Rohan Desai');
    expect(next.reply).toMatch(WHICH);
    expect(next.reply).not.toMatch(/Rohan/);
    expect(next.action).toBeNull();
  });

  it('on WhatsApp, the choice is asked, then the mark is sent to the website, and YES writes nothing', async () => {
    const teacher = school.people.TEACHER;
    // The choice is asked for exactly as on the website; only the proposal
    // itself is sent to the website (registry.js confirmableOn).
    const first = await wa(teacher, REQUEST);
    expect(first.reply).toMatch(/More than one student matches "Mishra"/);
    const second = await wa(teacher, 'Aarav Mishra');
    expect(second.reply).toMatch(/EduOS website/);
    await wa(teacher, 'YES');
    expect((await recordsOf(school.aarav)).filter((r) => r.status === 'ABSENT')).toHaveLength(0);
    expect(await count(AgentAction)).toBe(0);
  }, 120_000);

  it('on WhatsApp, NO after the choice writes nothing', async () => {
    const teacher = school.people.TEACHER;
    await wa(teacher, REQUEST);
    await wa(teacher, 'Aarav Mishra');
    await wa(teacher, 'NO');
    expect((await recordsOf(school.aarav)).filter((r) => r.status === 'ABSENT')).toHaveLength(0);
    expect(await count(AgentAction, { status: 'PENDING' })).toBe(0);
  }, 120_000);
});

/* ════════════════════════════════════════════════════════════
   C. "Show Aman Gupta attendance"
   ════════════════════════════════════════════════════════════ */

describe('C — the name reader: a name straight before "attendance"', () => {
  it('reads a first name and surname written with capitals', () => {
    expect(nameFromText('Show Aman Gupta attendance')).toBe('Aman Gupta');
    expect(nameFromText('Aman Gupta attendance this month')).toBe('Aman Gupta');
    expect(nameFromText('What is Rahul Sharma attendance percentage')).toBe('Rahul Sharma');
  });

  it('takes no class-wide, period or summary phrasing for a person', () => {
    for (const text of [
      'show class wise attendance', 'show last month attendance', 'show my attendance', 'what is overall attendance',
      'show today attendance', 'show low attendance students', 'Show Class 6 A attendance', 'show monthly attendance report',
      'mark attendance', 'student attendance', 'show my child attendance', 'show whole school attendance',
      'view subject wise attendance', 'check staff attendance', 'daily attendance', 'show per day attendance',
      'show date wise attendance', 'show morning shift attendance', 'need complete attendance', 'show average attendance',
      'show his attendance', 'show section B attendance', 'show week wise attendance', 'show Maths attendance',
      // All lower case: nothing tells a name from "morning shift", so the
      // possessive or "attendance of ..." is still needed.
      'show aman gupta attendance',
    ]) expect(nameFromText(text), text).toBeNull();
  });
});

describe('C — a student-specific attendance question is answered about that student', () => {
  const plan = (message, role) => parsePlan(message, school.people[role].actor);

  it('routes to the student\'s attendance for staff, not to a register', () => {
    for (const role of ['TEACHER', 'ADMIN', 'PRINCIPAL']) {
      const steps = plan('Show Aman Gupta attendance', role);
      expect(steps.map((s) => s.tool), role).toEqual(['get_student_attendance']);
      expect(steps[0].args, role).toMatchObject({ studentName: 'Aman Gupta' });
    }
  });

  it('class-wide questions still reach the class register', () => {
    for (const message of ['Show Class 6 A attendance', 'Show attendance of Class 6 A', 'Who is absent in Class 6 A today?']) {
      const steps = plan(message, 'TEACHER');
      expect(steps.map((s) => s.tool), message).not.toContain('get_student_attendance');
      expect(JSON.stringify(steps), message).toMatch(/Class 6 A/);
    }
    expect(plan('Show Class 6 A attendance', 'TEACHER')[0].tool).toBe('get_attendance_roster');
  });

  it('TEACHER: sees only that student, from their own class', async () => {
    const turn = await as('TEACHER').say('Show Aarav Mishra attendance');
    expect(turn.calls).toEqual([expect.objectContaining({ tool: 'get_student_attendance', status: 'READ' })]);
    expect(turn.reply).toMatch(/Aarav Mishra — Attendance Summary/);
    expect(turn.reply).toMatch(/100%/);
    // Not the register, and nobody else from the class.
    expect(turn.reply).not.toMatch(/Ananya|student\(s\)/);
    expectNoLeak(turn.reply);
  });

  it('TEACHER: a student in a class that is not theirs is not found, exactly like one who does not exist', async () => {
    const outside = await as('TEACHER').say('Show Rohan Desai attendance');
    const nobody = await as('TEACHER').say('Show Zubin Contractor attendance');
    expect(outside.reply).toBe('No student named "Rohan Desai".');
    expect(nobody.reply).toBe('No student named "Zubin Contractor".');
    expect(outside.reply).not.toMatch(/Class 10|absent|present|%/i);
  });

  it('TEACHER: an ambiguous name is asked about, and the answer finishes the read', async () => {
    const chat = as('TEACHER');
    const first = await chat.say("Show Mishra's attendance");
    expect(first.reply).toMatch(/More than one student matches "Mishra"/);
    expect(first.reply).not.toMatch(/%/);
    const next = await chat.say('Ananya Mishra');
    expect(next.reply).toMatch(/Ananya Mishra — Attendance Summary/);
  });

  it('ADMIN: any student in the school', async () => {
    const turn = await as('ADMIN').say('Show Tara Iyer attendance');
    expect(turn.calls[0]).toMatchObject({ tool: 'get_student_attendance', status: 'READ' });
    expect(turn.reply).toMatch(/Tara Iyer — Attendance Summary/);
  });

  it('STUDENT: another student is refused -- never answered with the student\'s own record', async () => {
    const turn = await as('STUDENT').say('Show Aman Gupta attendance');
    expect(turn.reply).toBe("You can only see your own records — I can't look up another student's.");
    expect(turn.refused).toBe('OUT_OF_SCOPE');
    expect(turn.reply).not.toMatch(/%|Present|Absent/);
    expect(turn.calls.some((c) => c.status === 'READ')).toBe(false);
  });

  it('STUDENT: their own name is their own record', async () => {
    const turn = await as('STUDENT').say('Show Priya Verma attendance');
    expect(turn.reply).toMatch(/Priya Verma — Attendance Summary/);
  });

  it('PARENT: another child is refused, the same whether or not that child exists', async () => {
    const other = await as('PARENT').say('Show Aman Gupta attendance');
    const nobody = await as('PARENT').say('Show Zubin Contractor attendance');
    const refusal = "You can only see your own child's records — I can't look up another student's.";
    expect(other.reply).toBe(refusal);
    expect(nobody.reply).toBe(refusal);
    expect(other.calls.some((c) => c.status === 'READ')).toBe(false);
  });

  it('PARENT: their own child is shown', async () => {
    const turn = await as('PARENT').say('Show Rahul Sharma attendance');
    expect(turn.calls[0]).toMatchObject({ tool: 'get_student_attendance', status: 'READ' });
    expect(turn.reply).toMatch(/Rahul Sharma — Attendance Summary/);
  });

  it('another school\'s student is not found', async () => {
    const turn = await conversationAs(school, 'RIVER_ADMIN', { tenant: school.people.RIVER_ADMIN.actor.tenantId }).say('Show Aman Gupta attendance')
      .catch((err) => ({ reply: String(err?.message ?? ''), calls: [] }));
    expect(turn.reply).not.toMatch(/Attendance Summary|Attendance Not Available/);
  });

  it('is the same on WhatsApp', async () => {
    const phone = await wa(school.people.TEACHER, 'Show Aarav Mishra attendance');
    expect(phone.reply).toMatch(/Aarav Mishra — Attendance Summary/);
    expect(phone.reply).not.toMatch(/Ananya/);
    const student = await wa(school.people.STUDENT, 'Show Aman Gupta attendance');
    expect(student.reply).toMatch(/only see your own records/);
  }, 120_000);
});

/* ════════════════════════════════════════════════════════════
   D. A leave request from an account that cannot apply
   ════════════════════════════════════════════════════════════ */

describe('D — a leave application from staff is their own staff leave, alone or in a joined sentence', () => {
  // Changed deliberately in part 3: a member of staff (staffleave.apply) asking to apply for leave
  // means their OWN staff leave, so it reaches apply_staff_leave as a draft (or a question for the
  // day, kind and reason) instead of the old "isn't enabled for your account" refusal.
  const DRAFT = /Apply for sick leave on \d{4}-\d{2}-\d{2}: 1 working day\(s\).*fever.*Shall I go ahead\?/s;

  it('TEACHER, alone: drafted as their own sick leave, nothing filed before yes', async () => {
    const turn = await as('TEACHER').say('Apply for leave tomorrow because of fever');
    expect(turn.reply).toMatch(DRAFT);
    expect(turn.refused).toBeNull();
    expect(turn.action?.tool).toBe('apply_staff_leave');
    expect(turn.reply).not.toMatch(/not authorized to access this information|isn't enabled/i);
    expect(await count(LeaveApplication)).toBe(0);
    expect(await count(StaffLeave)).toBe(0);
  });

  it('TEACHER, joined to a question: the question is answered and the staff leave is drafted -- not "not authorized"', async () => {
    const turn = await as('TEACHER').say('Show my timetable and apply for leave tomorrow because of fever');
    expect(turn.reply).toMatch(/Timetable/);
    expect(turn.reply).toMatch(DRAFT);
    expect(turn.reply).not.toMatch(/not authorized to access this information|isn't enabled/i);
    expect(turn.action?.tool).toBe('apply_staff_leave');
    // The read ran; the leave waits for a yes.
    expect(await count(LeaveApplication)).toBe(0);
    expect(await count(StaffLeave)).toBe(0);
    expectNoLeak(turn.reply);
  });

  it('TEACHER, with the leave said first', async () => {
    const turn = await as('TEACHER').say('Apply for leave tomorrow because of fever and show my timetable');
    expect(turn.reply).not.toMatch(/isn't enabled for your account|not authorized to access this information/i);
    expect(turn.action?.tool).toBe('apply_staff_leave');
    expect(await count(LeaveApplication)).toBe(0);
    expect(await count(StaffLeave)).toBe(0);
  });

  it('the account that reviews leave can still see the requests it was pointed to', async () => {
    const turn = await as('TEACHER').say('Show pending leave requests');
    expect(turn.status).toBe(200);
    expect(turn.calls.at(-1)).toMatchObject({ tool: 'get_leave_requests', status: 'READ' });
  });

  it('PARENT (who now holds leave.apply for their own child) is not told applying is unavailable, and nothing is filed without a yes', async () => {
    // The role matrix grants a parent leave.apply at OWN scope
    // (constants/permissions.js), so the "not enabled" wording no longer applies.
    const alone = await as('PARENT').say('Apply for leave tomorrow because of fever');
    expect(alone.reply).not.toMatch(/isn't enabled for your account/);
    expect(await count(LeaveApplication)).toBe(0);
  });

  it('STUDENT (who holds leave.apply) is unaffected: proposed alone and joined, written only on yes', async () => {
    const student = school.people.STUDENT;
    const alone = await ask(student, 'Apply for leave tomorrow because of fever');
    expect(alone.action?.tool).toBe('apply_for_leave');
    await api.confirm(student, alone.action.confirmToken, false);
    expect(await count(LeaveApplication)).toBe(0);

    const joined = await ask(student, 'Show my attendance and apply for leave tomorrow because of fever');
    expect(joined.reply).toMatch(/Attendance Summary/);
    expect(joined.action?.tool).toBe('apply_for_leave');
    expect(await count(LeaveApplication)).toBe(0);
    await api.confirm(student, joined.action.confirmToken);
    expect(await count(LeaveApplication)).toBe(1);
  });

  it('a genuine authorization failure keeps its own wording: a teacher asked to record a payment', async () => {
    const res = await ask(school.people.TEACHER, 'Record a payment of ₹500 against invoice INV-1001');
    expect(JSON.stringify(res.body)).toMatch(/can't approve, record or refund payments/i);
    expect(JSON.stringify(res.body)).not.toMatch(/isn't enabled for your account/);
  });

  it('a validation error keeps ITS wording: a student applying with no dates is asked for them', async () => {
    const turn = await as('STUDENT').say('Apply for leave.');
    expect(turn.action).toBeNull();
    expect(turn.reply).not.toMatch(/isn't enabled|not authorized/i);
    expect(turn.reply).toMatch(/\?|date/i);
  });
});
