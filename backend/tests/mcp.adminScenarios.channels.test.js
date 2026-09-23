import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { parseIntent } from '../src/modules/ai/agent/intent.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { Assignment } from '../src/models/assignment.model.js';
import { Student, Enrollment } from '../src/models/student.model.js';
import { Subject, SubjectOffering, Term } from '../src/models/academics.model.js';
import { TimetableSlot } from '../src/models/timetableSlot.model.js';
import { seedSchool, mcp, inSchool, proposeAndConfirm, todayKey, OAK } from './support/mcpSchool.js';
import { startApi } from './support/mcpHttp.js';

/**
 * The reported ADMIN scenarios, through both doors.
 *
 * The requirement is not that the Web assistant works. It is that the Web
 * assistant, the WhatsApp assistant and a direct MCP call are one capability
 * reached three ways -- so a sentence fixed for the website is fixed for a
 * parent's phone at the same moment, because there is only one thing to fix.
 *
 * What is compared is the CAPABILITY, the ACTOR, the TENANT and the kind of
 * ACCESS, all taken from the MCP server's own audit entry. The two channels
 * are allowed to word an answer differently; they are not allowed to run
 * different code, reach a different service, or decide authorization
 * separately.
 *
 * The class and the names are fixture details. The SHAPE of each sentence is
 * what was reported, and nothing in src/ knows any of these strings.
 */

let api;
let school;
let fixture;

beforeAll(async () => {
  api = await startApi();
});
afterAll(async () => {
  await api.close();
  await resetMcpClient();
});

beforeEach(async () => {
  resetAgentThrottle();
  school = await seedSchool();
  fixture = await inSchool(OAK, async () => {
    const enrol = async (admissionNo, firstName, lastName, section, rollNo) => {
      const student = await Student.create({ admissionNo, firstName, lastName });
      const enrollment = await Enrollment.create({
        studentId: student._id, sectionId: section._id, academicYearId: school.year._id, status: 'ACTIVE', rollNo,
      });
      return { student, enrollment };
    };

    // The names the manual report used, and an account-shaped one.
    const arnav = await enrol('OAK-20', 'Arnav', 'Patel', school.sectionA, 20);
    const diya = await enrol('OAK-21', 'Diya', 'Patel', school.sectionA, 21);
    const testStud = await enrol('OAK-22', 'test_Stud', 'Demo', school.sectionA, 22);

    // A subject taught in 6-A, so homework has somewhere to go, and a
    // timetable slot so the timetable has something to show.
    const term = await Term.create({
      academicYearId: school.year._id, name: 'Term 1', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31'),
    });
    const maths = await Subject.create({ name: 'Mathematics' });
    const offering = await SubjectOffering.create({
      sectionId: school.sectionA._id,
      subjectId: maths._id,
      termId: term._id,
      teacherId: school.people.TEACHER.profile._id,
    });
    for (const dayOfWeek of [1, 2, 3, 4, 5, 6, 7]) {
      // Every weekday, so "today's timetable" has something to show whichever
      // day the suite runs on.
      await TimetableSlot.create({
        sectionId: school.sectionA._id,
        subjectOfferingId: offering._id,
        dayOfWeek,
        periodNo: 1,
        startTime: '09:00',
        endTime: '09:45',
      });
    }
    return { arnav, diya, testStud, maths, offering, term };
  });
});

/** The class as this fixture names it. The sentence shape is what is reported. */
const CLASS = 'Class 6-A';

/** The last tool the MCP server recorded on a channel, with who ran it. */
async function lastCall(channel) {
  const entry = await inSchool(OAK, () => AuditLog
    .findOne({ 'after.via': 'MCP', channel })
    .sort({ createdAt: -1, _id: -1 })
    .lean());
  return entry
    ? {
      tool: entry.action?.replace(/^agent\./, ''),
      status: entry.after?.status ?? null,
      actor: String(entry.actorProfileId ?? ''),
      tenant: String(entry.tenantId ?? ''),
    }
    : null;
}

const web = (person, message) => api.ask(person, message);
const whatsapp = (person, message) => api.whatsapp(person, message);
const replyOf = (res) => res.reply ?? res.body?.message ?? '';

/**
 * One sentence, both channels: same capability, same actor, same school, same
 * kind of access -- and the same capability answers when called directly.
 */
async function bothChannelsAgree(message, { expectTool = null } = {}) {
  const person = school.people.ADMIN;

  const step = parseIntent(message, person.actor);
  expect(step, `"${message}" reached no capability`).toBeTruthy();
  if (expectTool) expect(step.tool, message).toBe(expectTool);

  const onWeb = await web(person, message);
  expect(onWeb.status, `${message}: ${JSON.stringify(onWeb.body)}`).toBe(200);
  const webCall = await lastCall('WEB');
  expect(webCall?.tool, `${message} on the website`).toBe(step.tool);

  const onWhatsApp = await whatsapp(person, message);
  expect(onWhatsApp.status, message).toBe(200);
  const waCall = await lastCall('WHATSAPP');
  expect(waCall?.tool, `${message} on WhatsApp`).toBe(step.tool);

  expect(waCall.actor, 'a different actor on WhatsApp').toBe(webCall.actor);
  expect(waCall.tenant, 'a different school on WhatsApp').toBe(webCall.tenant);
  expect(waCall.status, 'a different kind of access on WhatsApp').toBe(webCall.status);

  const direct = await mcp(OAK, person.actor, step.tool, step.args);
  expect(direct.success || Boolean(direct.action), JSON.stringify(direct.error ?? {})).toBe(true);

  return { step, web: replyOf(onWeb), whatsapp: onWhatsApp.reply ?? '' };
}

/* ── 1-5. Students ────────────────────────────────────────── */

describe('students', () => {
  it('1 — "Show the details of Arnav Patel" returns Arnav Patel, on both channels', async () => {
    const said = await bothChannelsAgree('Show the details of Arnav Patel', { expectTool: 'get_student' });
    for (const [channel, reply] of [['web', said.web], ['whatsapp', said.whatsapp]]) {
      expect(reply, `${channel} did not answer about the student asked for`).toMatch(/Arnav Patel/);
      expect(reply, `${channel} disclosed a different student`).not.toMatch(/Diya|test_Stud/i);
    }
  }, 180000);

  it('2 — "Find student Diya sharma" finds nobody, and names nobody else', async () => {
    // Correct behaviour, not a defect: there is a Diya Patel and no Diya
    // Sharma, and a search that quietly widened to the nearest surname would
    // be the wrong-student disclosure in a friendlier place.
    const said = await bothChannelsAgree('Find student Diya sharma', { expectTool: 'search_students' });
    for (const [channel, reply] of [['web', said.web], ['whatsapp', said.whatsapp]]) {
      expect(reply, `${channel} named somebody who was not asked for`).not.toMatch(/Diya Patel/);
    }
  }, 180000);

  it('3 — "Find student DiyaPatel" finds Diya Patel, spacing being typing', async () => {
    const said = await bothChannelsAgree('Find student DiyaPatel', { expectTool: 'search_students' });
    expect(said.web).toMatch(/Diya Patel/);
    expect(said.whatsapp).toMatch(/Diya Patel/);
  }, 180000);

  it('4 — "Find student Diya Patel" finds Diya Patel', async () => {
    const said = await bothChannelsAgree('Find student Diya Patel', { expectTool: 'search_students' });
    expect(said.web).toMatch(/Diya Patel/);
    expect(said.whatsapp).toMatch(/Diya Patel/);
  }, 180000);

  it('5 — "Show details of Diya Patel" reaches the record, not the fallback', async () => {
    const said = await bothChannelsAgree('Show details of Diya Patel', { expectTool: 'get_student' });
    for (const [channel, reply] of [['web', said.web], ['whatsapp', said.whatsapp]]) {
      expect(reply, `${channel} fell through`).not.toMatch(/I'm not sure what you need/i);
      expect(reply, channel).toMatch(/Diya Patel/);
      expect(reply, `${channel} disclosed a similar name instead`).not.toMatch(/Arnav/);
    }
  }, 180000);
});

/* ── 6-7. Attendance ──────────────────────────────────────── */

describe('attendance', () => {
  it(`6 — "Mark attendance for ${CLASS}" asks who and as what, and writes nothing`, async () => {
    const before = await inSchool(OAK, () => AttendanceRecord.countDocuments());
    const person = school.people.ADMIN;
    const message = `Mark attendance for ${CLASS}`;

    const step = parseIntent(message, person.actor);
    expect(step?.tool).toBe('mark_attendance');
    expect(step.args.className).toMatch(/6-?A/i);
    expect(step.args.students, 'students were invented from a sentence that named none').toBeUndefined();

    for (const [channel, ask] of [['web', () => web(person, message)], ['whatsapp', () => whatsapp(person, message)]]) {
      const res = await ask();
      expect(res.status, channel).toBe(200);
      // A question, not a refusal and not a write.
      expect(replyOf(res), `${channel} did not ask who to mark`).toMatch(/which students|who|status|present or absent/i);
    }
    expect(await inSchool(OAK, () => AttendanceRecord.countDocuments()), 'a register was written').toBe(before);
  }, 180000);

  it('7 — "Mark test_Stud present in class today" is proposed, confirmed, written and audited, on both channels', async () => {
    const mark = () => inSchool(OAK, () => AttendanceRecord
      .findOne({ enrollmentId: fixture.testStud.enrollment._id, date: todayKey() })
      .lean());
    const message = 'Mark test_Stud present in class today';

    const step = parseIntent(message, school.people.ADMIN.actor);
    expect(step.tool).toBe('mark_attendance');
    expect(step.args.students).toEqual([{ studentName: 'test_Stud', status: 'PRESENT' }]);

    // Website: propose, nothing written, confirm, written, audited.
    expect(await mark()).toBeNull();
    const said = await web(school.people.ADMIN, message);
    expect(said.status).toBe(200);
    expect(said.action?.confirmToken, 'a register was marked without asking').toBeTruthy();
    expect(await mark(), 'the register changed before anybody confirmed').toBeNull();

    await api.confirm(school.people.ADMIN, said.action.confirmToken);
    expect((await mark())?.status).toBe('PRESENT');
    expect(await lastCall('WEB')).toMatchObject({ tool: 'mark_attendance', status: 'EXECUTED' });

    // WhatsApp: the same chain, from a fresh register.
    await inSchool(OAK, () => AttendanceRecord.deleteOne({ enrollmentId: fixture.testStud.enrollment._id, date: todayKey() }));
    expect(await mark()).toBeNull();

    const proposed = await whatsapp(school.people.ADMIN, message);
    expect(proposed.status).toBe(200);
    expect(await mark(), 'WhatsApp wrote without confirmation').toBeNull();

    await whatsapp(school.people.ADMIN, 'YES');
    expect((await mark())?.status).toBe('PRESENT');
    expect(await lastCall('WHATSAPP')).toMatchObject({ tool: 'mark_attendance', status: 'EXECUTED' });
  }, 240000);
});

/* ── 8-9. Homework ────────────────────────────────────────── */

describe('homework', () => {
  it(`8 — "Create Mathematics homework for ${CLASS}." keeps the class and subject and asks for what is missing`, async () => {
    const message = `Create Mathematics homework for ${CLASS}.`;
    const person = school.people.ADMIN;

    const step = parseIntent(message, person.actor);
    expect(step.tool).toBe('create_assignment');
    expect(step.args.className).toBe(CLASS);
    expect(step.args.subject).toBe('Mathematics');

    const before = await inSchool(OAK, () => Assignment.countDocuments());
    for (const [channel, ask] of [['web', () => web(person, message)], ['whatsapp', () => whatsapp(person, message)]]) {
      const res = await ask();
      expect(res.status, channel).toBe(200);
      // What is missing is a title and a due date, and it says so in words a
      // person can answer -- not "I need a bit more to do that".
      expect(replyOf(res), `${channel} did not say what it needed`).toMatch(/due|hand|title|what the work is/i);
    }
    expect(await inSchool(OAK, () => Assignment.countDocuments()), 'homework was set without confirmation').toBe(before);
  }, 180000);

  it(`9 — "Create Mathematics homework for ${CLASS}: <task>" carries the task, and sets it after a yes`, async () => {
    const task = 'Solve the linear equations examples';
    const message = `Create Mathematics homework for ${CLASS}: ${task}.`;
    const person = school.people.ADMIN;

    const step = parseIntent(message, person.actor);
    expect(step.tool).toBe('create_assignment');
    expect(step.args.className).toBe(CLASS);
    expect(step.args.subject).toBe('Mathematics');
    expect(step.args.title).toBe(task);

    // The one argument no sentence carries is the due date, so the call is
    // completed the way a person would complete it, and then confirmed.
    const count = () => inSchool(OAK, () => Assignment.countDocuments({ title: task }));
    expect(await count()).toBe(0);

    const { proposal, done } = await proposeAndConfirm(OAK, person.actor, 'create_assignment', {
      ...step.args, dueAt: '2026-10-02',
    });
    expect(proposal.action?.status, 'homework was set without asking').toBe('confirmation_required');
    expect(done, 'the confirmation never ran').toBeTruthy();
    expect(done.success || done.action, JSON.stringify(done.error ?? {})).toBeTruthy();
    expect(await count(), 'the homework was not set after a yes').toBe(1);

    const created = await inSchool(OAK, () => Assignment.findOne({ title: task }).lean());
    expect(String(created.subjectOfferingId), 'set for the wrong class or subject')
      .toBe(String(fixture.offering._id));
  }, 240000);
});

/* ── 10-12. Timetable and the calendar ────────────────────── */

describe('timetable and calendar', () => {
  it(`10 — "Show today's timetable for ${CLASS}"`, async () => {
    const said = await bothChannelsAgree(`Show today's timetable for ${CLASS}`, { expectTool: 'get_timetable' });
    expect(said.step.args.className).toMatch(/6-?A/i);
  }, 180000);

  it(`11 — "Show ${CLASS} timetable with teacher names"`, async () => {
    const said = await bothChannelsAgree(`Show ${CLASS} timetable with teacher names`, { expectTool: 'get_timetable' });
    expect(said.step.args.className).toMatch(/6-?A/i);
  }, 180000);

  it('12 — "What is scheduled for day after tomorrow?" resolves the day and asks the calendar', async () => {
    const said = await bothChannelsAgree('What is scheduled for day after tomorrow?', {
      expectTool: 'get_calendar_events',
    });
    const now = new Date();
    const expected = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 2)).toISOString().slice(0, 10);
    expect(said.step.args.from).toBe(expected);
    expect(said.step.args.to).toBe(expected);
    for (const [channel, reply] of [['web', said.web], ['whatsapp', said.whatsapp]]) {
      expect(reply, `${channel} fell through`).not.toMatch(/I'm not sure what you need/i);
    }
  }, 180000);
});

/* ── 13. The aggregate no service can produce ─────────────── */

describe('an aggregate EduOS does not keep', () => {
  it('13 — is declined on both channels, and no other figure is offered in its place', async () => {
    const message = `Show attendance statistics for ${CLASS} for the last 1 year`;
    const person = school.people.ADMIN;

    // Nothing is reached, which is correct: /attendance/summary takes one
    // enrolment and /attendance/roster takes one date, so neither the Web nor
    // this can break a year down by class.
    expect(parseIntent(message, person.actor)).toBeNull();

    for (const [channel, ask] of [['web', () => web(person, message)], ['whatsapp', () => whatsapp(person, message)]]) {
      const res = await ask();
      expect(res.status, channel).toBe(200);
      const reply = replyOf(res);
      expect(reply, `${channel} answered with a percentage`).not.toMatch(/\d+\s?%/);
      expect(reply, `${channel} answered with a count of students`).not.toMatch(/\d+ student\(s\)/);
    }
  }, 180000);
});
