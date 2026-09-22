import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

/**
 * A model may not name somebody the person never named.
 *
 * This is the file for the worst thing found in manual testing. Asked to "show
 * the details of Arnav Patel", the assistant answered with Aarav Bhatt's
 * admission number, class and roll number: a different, real child.
 *
 * Nothing in the tool layer was broken, which is what makes it worth a file of
 * its own. resolveStudentId() refuses an unknown name and refuses an ambiguous
 * one, and offers near misses rather than taking them -- and it did all of
 * that correctly, on the name it was given. The wrong name was in the CALL. A
 * model that has seen a class list in the conversation, and a name it cannot
 * place, produces the nearest name it knows; every layer below was then
 * perfectly correct about the wrong person.
 *
 * So the rule asserted here is about the boundary between the model and the
 * tools: an argument that decides WHOSE record is read or written has to be
 * traceable to something a person actually wrote. The model is scripted to
 * misbehave exactly as it did, and what must happen is that the substituted
 * name never reaches the tool.
 */

const script = vi.hoisted(() => ({ plans: new Map() }));

vi.mock('../src/providers/ai.provider.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    isLlmEnabled: () => true,
    generate: vi.fn(async ({ system, message }) => {
      if (system.includes("You route a school ERP user's message")) {
        return { generated: true, text: JSON.stringify({ tools: script.plans.get(String(message).trim()) ?? [] }) };
      }
      return { generated: false, text: '' };
    }),
  };
});

const { Student, Enrollment } = await import('../src/models/student.model.js');
const { AuditLog } = await import('../src/models/auditLog.model.js');
const { resetMcpClient } = await import('../src/modules/ai/mcp/client.js');
const { resetAgentThrottle } = await import('../src/modules/ai/agent/throttle.js');
const { startApi } = await import('./support/mcpHttp.js');
const { seedSchool, inSchool, OAK } = await import('./support/mcpSchool.js');

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
  script.plans.clear();
  school = await seedSchool();
  await inSchool(OAK, async () => {
    const enrol = async (admissionNo, firstName, lastName, rollNo) => {
      const student = await Student.create({ admissionNo, firstName, lastName });
      await Enrollment.create({
        studentId: student._id,
        sectionId: school.sectionB._id,
        academicYearId: school.year._id,
        status: 'ACTIVE',
        rollNo,
      });
    };
    // The two real children whose names look alike.
    await enrol('OAK-30', 'Arnav', 'Patel', 30);
    await enrol('OAK-31', 'Aarav', 'Bhatt', 31);
  });
});

/** What the MCP server recorded for the last call on the website. */
const lastCall = () => inSchool(OAK, () => AuditLog
  .findOne({ 'after.via': 'MCP', channel: 'WEB' })
  .sort({ createdAt: -1, _id: -1 })
  .lean());

describe('a name the person did not write never reaches a tool', () => {
  it('does not disclose the similarly-named student the model substituted', async () => {
    const message = 'Show the record of Arnav Patel';
    // The model does exactly what it did in manual testing: it cannot place
    // the name, so it proposes the nearest one it has seen.
    script.plans.set(message, [{ name: 'get_student', args: { studentName: 'Aarav Bhatt' } }]);

    const res = await api.ask(school.people.ADMIN, message);
    expect(res.status).toBe(200);

    const reply = res.reply ?? '';
    expect(reply, 'another student was disclosed').not.toMatch(/Aarav/i);
    expect(reply, 'another student\'s admission number was disclosed').not.toMatch(/OAK-31/);

    // And the substitution did not merely fail to be spoken: it never became
    // an argument. Either nobody was named (so the tool asked who) or the
    // person the WRITER named was.
    const call = await lastCall();
    const used = call?.after?.args ?? call?.before?.args ?? null;
    if (used?.studentName) expect(used.studentName).not.toMatch(/Aarav Bhatt/i);
  }, 120000);

  it('keeps a name the person DID write', async () => {
    const message = 'Show the record of Arnav Patel please';
    script.plans.set(message, [{ name: 'get_student', args: { studentName: 'Arnav Patel' } }]);

    const res = await api.ask(school.people.ADMIN, message);
    expect(res.status).toBe(200);
    expect(res.reply).toMatch(/Arnav Patel/);
    expect(res.reply).toMatch(/OAK-30/);
  }, 120000);

  it('keeps a name the person wrote differently from how the model repeated it', async () => {
    // Spacing and case are the model echoing, not the model inventing. What is
    // compared is letters and digits, so a class written "class 6a" is still
    // the "Class 6-A" the person named.
    const message = 'Show the attendance of class 6a today';
    script.plans.set(message, [{ name: 'get_attendance_roster', args: { className: 'Class 6-A' } }]);

    const res = await api.ask(school.people.ADMIN, message);
    expect(res.status).toBe(200);
    const call = await lastCall();
    expect(call?.action).toBe('agent.get_attendance_roster');
    expect(res.reply, 'the class the person named was dropped').not.toMatch(/which class/i);
  }, 120000);

  it('does not let an invented name reach a WRITE either', async () => {
    const message = 'Mark Arnav Patel absent today';
    script.plans.set(message, [{
      name: 'mark_attendance',
      args: { students: [{ studentName: 'Arnav Patel', status: 'ABSENT' }] },
    }]);
    const res = await api.ask(school.people.ADMIN, message);
    expect(res.status).toBe(200);
    // Whatever was proposed, it is a proposal: nothing is marked until a
    // person says yes, and the name in it is the one they wrote.
    expect(res.reply ?? '', 'another student was named in the proposal').not.toMatch(/Aarav/i);
  }, 120000);
});
