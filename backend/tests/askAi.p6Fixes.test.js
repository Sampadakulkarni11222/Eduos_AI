import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { getMcpTool, mcpToolsFor } from '../src/modules/ai/mcp/registry.js';
import { programForAnswer } from '../src/modules/genui/fromResults.js';
import { hinglishToEnglish } from '../src/modules/ai/agent/hinglish.js';
import {
  acknowledgement, ordinalReference, isOrdinalOnly, alumniCertificateTurn, rankTurn, unavailableFigureTurn,
} from '../src/modules/ai/agent/conversationAids.js';
import { ungroundedFacts } from '../src/modules/ai/agent/grounding.js';
import { AgentConversation } from '../src/models/agentConversation.model.js';
import { inSchool, mcp, actorForRole, OAK } from './support/mcpSchool.js';
import { seedConversationSchool } from './support/askAiConversationSchool.js';
import { startApi } from './support/mcpHttp.js';

/**
 * p6 Ask AI fixes, at the level of the pieces: the generated panel, the
 * Hinglish reader, the conversation aids, the two new reads and their scope,
 * and WhatsApp's use of the server-side memory. The conversations that prove
 * each end to end are in support/askAiConversations.scenarios.js (p6-*).
 */
afterAll(async () => { await resetMcpClient(); });

describe('the generated panel does not chart a number that names something', () => {
  const slots = [1, 2, 6].map((periodNo, i) => ({
    dayOfWeek: 2, periodNo, startTime: ['09:00', '09:45', '14:00'][i], endTime: ['09:45', '10:30', '14:45'][i], className: ['Class 5 A', 'Class 6 B', 'Class 6 A'][i], subject: 'Mathematics',
  }));

  it('a timetable follow-up ("what about Tuesday?") has no "Slots: Day of week" chart', () => {
    const program = programForAnswer({ tool: 'get_timetable', data: { day: 'Tuesday', slots } });
    expect(program).toBeTruthy();
    expect(program).not.toMatch(/Slots: Day of week/);
    expect(program).not.toMatch(/BarChart|LineChart/);
    expect(program).toMatch(/Table/);
  });

  it('a figure that differs between rows is still charted', () => {
    const program = programForAnswer({ tool: 'get_class_attendance_summary', data: { ranked: [{ class: 'Class 5 A', pctPresent: 75 }, { class: 'Class 10 B', pctPresent: 25 }] } });
    expect(program).toMatch(/BarChart/);
  });

  it('one value on every row is not charted', () => {
    const program = programForAnswer({ tool: 'x_list', data: [{ name: 'A', count: 3 }, { name: 'B', count: 3 }] });
    expect(program).not.toMatch(/BarChart/);
  });
});

describe('Hinglish is read as the request it is (routing only)', () => {
  it.each([
    ['aaj 6A mein kaun absent hai?', /today/],
    ['kal ki attendance dikhao 5A', /^show yesterday attendance 5A$/],
    ['riya ki attendance kaisi hai', /^how is riya's attendance$/],
    ['meri attendance kitni hai?', /^what is my attendance\?$/],
    ['pichle mahine?', /^last month\?$/],
    ['aur 5A?', /^and 5A\?$/],
  ])('%s', (said, english) => expect(hinglishToEnglish(said)).toMatch(english));

  it('never touches English, a write, or a message to a parent', () => {
    for (const s of ['show Rahul attendance', 'Message Rahul ki mummy: aaj nahi aaya', 'mark Rahul absent kal', 'who is the topper of my class?']) {
      expect(hinglishToEnglish(s)).toBe(s);
    }
  });
});

describe('the conversation aids', () => {
  it('acknowledges "ok" and "thanks" without a question', () => {
    for (const s of ['ok', 'okay', 'thanks', 'thank you', 'theek hai', 'no thanks']) expect(acknowledgement(s), s).toBeTruthy();
    for (const s of ['ok show 6A', 'yes please mark it', 'thanks, now show fees']) expect(acknowledgement(s), s).toBeNull();
    expect(acknowledgement('thanks')).not.toMatch(/\?/);
  });

  it('counts an ordinal only in a list of people, and never a period or a class', () => {
    const listed = ['Aman Gupta', 'Priya Verma', 'Rahul Sharma'];
    expect(ordinalReference('the 2nd one', listed)).toBe('show student Priya Verma');
    expect(ordinalReference('the last one', listed)).toBe('show student Rahul Sharma');
    expect(ordinalReference('the first one attendance', listed)).toBe("show Aman Gupta's attendance");
    expect(ordinalReference('the 5th one', listed)).toBeNull();
    expect(ordinalReference('the 2nd one', ['Only One'])).toBeNull();
    for (const s of ['what about last month?', '5th A', 'last week']) {
      expect(ordinalReference(s, listed), s).toBeNull();
      expect(isOrdinalOnly(s), s).toBe(false);
    }
  });

  it('routes a former student\'s certificate by kind, and explains what is not offered', () => {
    const alumnus = { roleKey: 'ALUMNUS' };
    const held = new Set(['request_alumni_certificate']);
    expect(alumniCertificateTurn('request a transfer certificate', alumnus, held)).toEqual({ step: { tool: 'request_alumni_certificate', args: { certificate: 'Transfer Certificate' } } });
    expect(alumniCertificateTurn('I need my TC for college admission', alumnus, held).step.args).toEqual({ certificate: 'Transfer Certificate', purpose: 'college admission' });
    expect(alumniCertificateTurn('I need a bonafide certificate', alumnus, held).reply).toMatch(/current student/);
    expect(alumniCertificateTurn('I need a migration certificate', alumnus, held).reply).toMatch(/board/);
    expect(alumniCertificateTurn('show my certificate requests', alumnus, held)).toBeNull();
    // Nobody else's sentence is taken over.
    expect(alumniCertificateTurn('request a transfer certificate', { roleKey: 'STUDENT' }, held)).toBeNull();
  });

  it('a rank question from a student or parent is the policy plus their own marks', () => {
    const held = new Set(['get_report_card']);
    const student = rankTurn('what is my rank in class?', { roleKey: 'STUDENT' }, held);
    expect(student.note).toMatch(/ranks aren't shown to students/);
    expect(student.steps).toEqual([{ tool: 'get_report_card', args: {} }]);
    expect(rankTurn('rank the classes by attendance', { roleKey: 'PRINCIPAL' }, held)).toBeNull();
  });

  it('a figure EduOS does not keep is said to be unavailable', () => {
    expect(unavailableFigureTurn("what is the school's pass percentage?")).toMatch(/doesn't keep a pass percentage/);
    expect(unavailableFigureTurn("what is Rahul's phone number?")).toMatch(/don't share phone numbers/);
    expect(unavailableFigureTurn("change Rahul's phone number to 9876543210")).toBeNull();
    expect(unavailableFigureTurn('what is my phone number?')).toBeNull();
  });

  it('a composed sentence may not state a class rank nobody gave', () => {
    expect(ungroundedFacts('You are ranked 3rd in your class.', { data: { percentage: 80 } })).toContainEqual(expect.stringMatching(/rank/));
    expect(ungroundedFacts('Priya Verma scored 80%.', { data: { name: 'Priya Verma', percentage: 80 } })).toEqual([]);
  });
});

describe('the two new reads stay inside the caller\'s scope', () => {
  let school;
  beforeEach(async () => { resetAgentThrottle(); school = await seedConversationSchool(); });

  it('get_low_attendance_students: a teacher sees only their classes; a parent is refused', async () => {
    expect(getMcpTool('get_low_attendance_students')).toMatchObject({ operation: 'GET', permission: 'attendance.read' });
    const mine = await mcp(OAK, school.people.TEACHER.actor, 'get_low_attendance_students', {});
    expect(mine.success).toBe(true);
    const names = mine.data.students.map((s) => s.studentName);
    expect(names).toEqual(expect.arrayContaining(['Rahul Sharma', 'Ananya Mishra']));
    expect(names).not.toContain('Rohan Desai'); // Class 10 B is not the teacher's
    expect(mine.data.scope).toBe('MY_CLASSES');
    const out = await mcp(OAK, school.people.TEACHER.actor, 'get_low_attendance_students', { className: 'Class 10 B' });
    expect(out.success).toBe(false);
    expect(JSON.stringify(out)).not.toMatch(/Rohan Desai|Meera Nair/);
    const parent = await mcp(OAK, school.people.PARENT.actor, 'get_low_attendance_students', {});
    expect(parent.success).toBe(false);
    // The principal sees the whole school.
    const all = await mcp(OAK, school.people.PRINCIPAL.actor, 'get_low_attendance_students', {});
    expect(all.data.students.map((s) => s.studentName)).toContain('Rohan Desai');
  });

  it('get_my_hostel_room: a student\'s own, a parent\'s children\'s, nobody else\'s', async () => {
    expect(mcpToolsFor(actorForRole('TEACHER')).some((t) => t.name === 'get_my_hostel_room')).toBe(false);
    const parent = await mcp(OAK, school.people.PARENT.actor, 'get_my_hostel_room', {});
    expect(parent.data.allocations).toEqual([expect.objectContaining({ student: 'Rahul Sharma', room: 'H-101' })]);
    const student = await mcp(OAK, school.people.STUDENT.actor, 'get_my_hostel_room', {});
    expect(student.data.allocations).toEqual([]);
  });
});

describe('WhatsApp reads the conversation from the server-side memory, like the website', () => {
  let api;
  let school;
  beforeEach(async () => { resetAgentThrottle(); school = await seedConversationSchool(); api = api ?? await startApi(); });
  afterAll(async () => { await api?.close(); });

  it('keeps 24 turns and the structured context for the WhatsApp session, including turns answered without the agent', async () => {
    const teacher = school.people.TEACHER;
    await api.whatsapp(teacher, 'show attendance for Class 6 A');
    resetAgentThrottle();
    await api.whatsapp(teacher, 'ok');
    const row = await inSchool(OAK, () => AgentConversation.findOne({ profileId: teacher.profile._id, channel: 'WHATSAPP' }).lean());
    expect(row).toBeTruthy();
    expect(row.turns.map((t) => t.text)).toEqual(expect.arrayContaining(['show attendance for Class 6 A', 'ok']));
    expect(row.context.lastRead).toMatchObject({ tool: 'get_attendance_roster' });
    expect(row.context.students).toContain('Rahul Sharma');
  });
});
