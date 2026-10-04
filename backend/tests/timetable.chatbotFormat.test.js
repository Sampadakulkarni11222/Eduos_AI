import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

/**
 * The timetable, as the assistant answers it.
 *
 * It used to come back as one run-on sentence -- "Monday: P1 08:30-09:15
 * Science (Priya Patel (Science)); P2 09:15-10:00 ..." -- for every role. It is
 * now a period table rendered by the central presentation layer: a student
 * sees who teaches each period, a teacher sees which class (their own name on
 * every row told them nothing), and WhatsApp gets one readable line per period.
 */

const { renderView, toWhatsAppText } = await import('../src/modules/ai/agent/present.js');
const { resetMcpClient } = await import('../src/modules/ai/mcp/client.js');
const { resetAgentThrottle } = await import('../src/modules/ai/agent/throttle.js');
const { TimetableSlot } = await import('../src/models/timetableSlot.model.js');
const { Subject, SubjectOffering, Term } = await import('../src/models/academics.model.js');
const { startApi } = await import('./support/mcpHttp.js');
const { seedSchool, mcp, inSchool, OAK } = await import('./support/mcpSchool.js');

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const tomorrow = DAY[(new Date().getDay() + 1) % 7];

let api;
let school;

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
  // Class 6 A: every day of the week, Science (taught by TEACHER) then a
  // break then English -- so "tomorrow" always has periods, whatever today is.
  await inSchool(OAK, async () => {
    const term = await Term.create({ academicYearId: school.year._id, name: 'Term 1', startsOn: new Date(), endsOn: new Date() });
    const science = await Subject.create({ name: 'Science', code: 'SCI' });
    const english = await Subject.create({ name: 'English', code: 'ENG' });
    const sci = await SubjectOffering.create({
      sectionId: school.sectionA._id, subjectId: science._id, termId: term._id, teacherId: school.people.TEACHER.profile._id,
    });
    const eng = await SubjectOffering.create({ sectionId: school.sectionA._id, subjectId: english._id, termId: term._id });
    for (let dow = 1; dow <= 7; dow++) {
      await TimetableSlot.create({ sectionId: school.sectionA._id, dayOfWeek: dow, periodNo: 1, startTime: '08:30', endTime: '09:15', subjectOfferingId: sci._id, room: 'Lab 2' });
      await TimetableSlot.create({ sectionId: school.sectionA._id, dayOfWeek: dow, periodNo: 2, startTime: '09:15', endTime: '09:30', subjectOfferingId: null });
      await TimetableSlot.create({ sectionId: school.sectionA._id, dayOfWeek: dow, periodNo: 3, startTime: '09:30', endTime: '10:15', subjectOfferingId: eng._id });
    }
  });
});

const say = async (person, message) => {
  const res = await api.ask(person, message);
  expect(res.status, `${message}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.reply ?? '';
};

describe('rendering', () => {
  const periods = [
    { period: 1, start: '08:30', end: '09:15', subject: 'Science', teacher: 'Priya Patel', room: null, class: null },
    { period: 2, start: '09:15', end: '09:30', subject: null, teacher: null, room: null, class: null },
  ];

  it('a student\'s day is a table of period, time, subject and teacher', () => {
    const md = renderView({ type: 'timetable.day', day: 'Tomorrow (Monday)', showTeacher: true, showClass: false, total: 2, periods });
    expect(md).toBe([
      '**Timetable — Tomorrow (Monday)**',
      '',
      '| Period | Time | Subject | Teacher |',
      '| ---: | --- | --- | --- |',
      '| 1 | 08:30–09:15 | **Science** | Priya Patel |',
      '| 2 | 09:15–09:30 | _Break_ |  |',
    ].join('\n'));
  });

  it('a teacher\'s day names the class and not the teacher', () => {
    const md = renderView({
      type: 'timetable.day', day: 'Monday', showTeacher: false, showClass: true, total: 1,
      periods: [{ ...periods[0], teacher: null, class: 'Class 6 A' }],
    });
    expect(md).toMatch(/\| Period \| Time \| Class \| Subject \|/);
    expect(md).toMatch(/\| 1 \| 08:30–09:15 \| Class 6 A \| \*\*Science\*\* \|/);
    expect(md).not.toMatch(/Teacher/);
  });

  it('a long day says how much is shown', () => {
    const md = renderView({ type: 'timetable.day', day: 'Monday', showTeacher: true, total: 14, periods });
    expect(md).toMatch(/Showing the first 2 of 14 periods/);
  });

  it('the week is one table per day', () => {
    const md = renderView({ type: 'timetable.week', showTeacher: true, days: [{ day: 'Monday', periods }, { day: 'Tuesday', periods }] });
    expect(md).toMatch(/^\*\*Weekly Timetable\*\*/);
    expect(md.match(/\| Period \| Time/g)).toHaveLength(2);
    expect(md).toMatch(/\*\*Monday\*\*[\s\S]*\*\*Tuesday\*\*/);
  });

  it('an empty day is said plainly', () => {
    expect(renderView({ type: 'timetable.none', day: 'Sunday' })).toBe('**Timetable — Sunday**\n\nNo classes are scheduled for Sunday.');
  });

  it('WhatsApp gets one line per period, without pipes or **', () => {
    const wa = toWhatsAppText(renderView({ type: 'timetable.day', day: 'Monday', showTeacher: true, total: 2, periods }));
    expect(wa).toBe('*Timetable — Monday*\n\n• 1 · 08:30–09:15 · *Science* · Priya Patel\n• 2 · 09:15–09:30 · _Break_');
  });
});

describe('through the assistant', () => {
  it('a student asking for tomorrow gets a formatted table', async () => {
    const reply = await say(school.people.STUDENT, "what is my tomorrow's timetable?");
    expect(reply).toContain(`**Timetable — Tomorrow (${tomorrow})**`);
    expect(reply).toMatch(/\| Period \| Time \| Subject \| Teacher \| Room \|/);
    expect(reply).toMatch(/\| 1 \| 08:30–09:15 \| \*\*Science\*\* \| TEACHER user \| Lab 2 \|/);
    expect(reply).toMatch(/\| 2 \| 09:15–09:30 \| _Break_ \|/);
    // Not the old run-on sentence.
    expect(reply).not.toMatch(/P1 08:30-09:15/);
  });

  it('a teacher sees the class for each period they teach, not their own name', async () => {
    const reply = await say(school.people.TEACHER, `What is my teaching schedule for ${tomorrow.toLowerCase()}?`);
    expect(reply).toContain(`**Timetable — ${tomorrow}**`);
    expect(reply).toMatch(/\| Period \| Time \| Class \| Subject \| Room \|/);
    expect(reply).toMatch(/\| 1 \| 08:30–09:15 \| Class 6 A \| \*\*Science\*\* \| Lab 2 \|/);
    expect(reply).not.toMatch(/TEACHER user/);
  });

  it('the weekly timetable is grouped by day', async () => {
    const reply = await say(school.people.STUDENT, 'show my weekly timetable');
    expect(reply).toMatch(/^\*\*Weekly Timetable\*\*/);
    expect(reply).toMatch(/\*\*Monday\*\*/);
  });

  it('WhatsApp receives the same timetable in its own format', async () => {
    const res = await api.whatsapp(school.people.STUDENT, "what is my tomorrow's timetable?");
    expect(res.reply).toContain(`*Timetable — Tomorrow (${tomorrow})*`);
    expect(res.reply).toMatch(/• 1 · 08:30–09:15 · \*Science\* · TEACHER user · Lab 2/);
    expect(res.reply).not.toMatch(/\*\*|\|/);
  });

  it('the MCP result carries the view and no internal ids in it', async () => {
    const res = await mcp(OAK, school.people.STUDENT.actor, 'get_timetable', { day: 'tomorrow' });
    expect(res.success).toBe(true);
    expect(res.view.type).toBe('timetable.day');
    expect(JSON.stringify(res.view)).not.toMatch(/[0-9a-f]{24}/);
  });
});
