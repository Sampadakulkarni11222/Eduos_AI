import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Student, Enrollment } from '../src/models/student.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { startApi } from './support/mcpHttp.js';
import { seedSchool, inSchool, OAK } from './support/mcpSchool.js';

/**
 * Named-student attendance, as a teacher asks for it.
 *
 * The bug this pins: for a teacher, "Show Rahul's attendance" used to route to
 * get_attendance — the caller's own summary — because the rule for a named
 * student required school-wide attendance.read, which a teacher (OWN) lacks.
 * The fix lets the rule match at any scope; the student is then resolved at
 * the teacher's own scope, so a pupil outside their classes is not found.
 *
 * Every test reads the MCP server's own audit entry to establish which tool
 * actually ran and with what arguments — not only what the reply says.
 * AI_PROVIDER=rules: no model is involved, so this is the deterministic path.
 */

let api;
let school;
let extra;

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
  // Two pupils called Arjun in the teacher's class, and a second Rahul in a
  // class the teacher does not teach.
  extra = await inSchool(OAK, async () => {
    const enrol = async (admissionNo, firstName, lastName, section, rollNo) => {
      const student = await Student.create({ admissionNo, firstName, lastName });
      const enrollment = await Enrollment.create({
        studentId: student._id, sectionId: section._id, academicYearId: school.year._id, status: 'ACTIVE', rollNo,
      });
      return { student, enrollment };
    };
    return {
      arjunM: await enrol('OAK-4', 'Arjun', 'Mehta', school.sectionA, 4),
      arjunR: await enrol('OAK-5', 'Arjun', 'Rao', school.sectionA, 5),
      rahulV: await enrol('OAK-10', 'Rahul', 'Verma', school.sectionB, 2),
    };
  });
});

/** The newest MCP call on a channel: which tool ran, with which arguments, and how it ended. */
async function lastCall(channel) {
  const entry = await inSchool(OAK, () => AuditLog.findOne({ 'after.via': 'MCP', channel }).sort({ createdAt: -1, _id: -1 }).lean());
  return { tool: entry?.action?.replace(/^agent\./, '') ?? null, args: entry?.after?.request ?? null, status: entry?.after?.status ?? null, actor: String(entry?.actorProfileId ?? '') };
}

describe('a teacher asking about a named student', () => {
  it('1 + 5 — "Show Rahul\'s attendance." answers for the Rahul in their class, through get_student_attendance', async () => {
    const teacher = school.people.TEACHER;
    const res = await api.ask(teacher, "Show Rahul's attendance.");
    expect(res.status).toBe(200);
    expect(res.tool).toBe('get_student_attendance');
    expect(res.data.enrollmentId).toBe(String(school.rahul.enrollment._id));
    expect(res.reply).toMatch(/0%/);
    const call = await lastCall('WEB');
    expect(call).toMatchObject({ tool: 'get_student_attendance', status: 'READ', actor: teacher.actor.profileId });
    expect(call.args).toEqual({ studentName: 'Rahul' });
  });

  it('2 — a student outside the teacher\'s classes is not found, and nothing about them is returned', async () => {
    const res = await api.ask(school.people.TEACHER, "Show Riya's attendance.");
    expect(res.status).toBe(200);
    // Not found at the teacher's scope. The near miss inside their own class
    // (Priya) is offered as a question — it is never answered for instead.
    expect(res.reply).toBe('No student named "Riya". Did you mean: Priya Verma (OAK-2)?');
    expect(res.data ?? null).toBeNull();
    const call = await lastCall('WEB');
    expect(call.tool).toBe('get_student_attendance');
    expect(call.status).not.toBe('READ');
    // She exists: a school-wide reader finds her.
    const admin = await api.ask(school.people.ADMIN, "Show Riya's attendance.");
    expect(admin.tool).toBe('get_student_attendance');
    expect(admin.reply).not.toMatch(/No student named/);
  });

  it('3 — "What is my attendance?" is about the teacher, not a pupil: get_attendance', async () => {
    const res = await api.ask(school.people.TEACHER, 'What is my attendance?');
    expect(res.tool).toBe('get_attendance');
    expect((await lastCall('WEB')).tool).toBe('get_attendance');
    expect(JSON.stringify(res.data ?? null)).not.toContain(String(school.rahul.enrollment._id));
  });

  it('4 — "show my attendance" likewise', async () => {
    const res = await api.ask(school.people.TEACHER, 'show my attendance');
    expect(res.tool).toBe('get_attendance');
    expect((await lastCall('WEB')).tool).toBe('get_attendance');
  });

  it('6 — on WhatsApp, "what is his attendance?" after a named-student question answers for that student', async () => {
    const teacher = school.people.TEACHER;
    const first = await api.whatsapp(teacher, "Show Rahul's attendance.");
    expect(first.reply).toMatch(/0%/);
    expect(await lastCall('WHATSAPP')).toMatchObject({ tool: 'get_student_attendance', args: { studentName: 'Rahul' } });

    const followUp = await api.whatsapp(teacher, 'what is his attendance?');
    expect(followUp.reply).toMatch(/0%/);
    const call = await lastCall('WHATSAPP');
    expect(call).toMatchObject({ tool: 'get_student_attendance', status: 'READ', args: { studentName: 'Rahul' } });
  });

  it('6 — without that context (a fresh website question) "his" names nobody, so the assistant asks', async () => {
    const res = await api.ask(school.people.TEACHER, 'what is his attendance?');
    expect(res.status).toBe(200);
    expect(res.reply).toBe('Which student? Give a name, admission number or id.');
    expect(res.data ?? null).toBeNull();
    expect((await lastCall('WEB')).tool).toBe('get_student_attendance');
  });

  it('7 — an ambiguous name is a question, not a guess', async () => {
    const res = await api.ask(school.people.TEACHER, "Show Arjun's attendance.");
    expect(res.reply).toMatch(/^More than one student matches "Arjun": .*Which one\?$/);
    expect(res.reply).toContain('Arjun Mehta (OAK-4)');
    expect(res.reply).toContain('Arjun Rao (OAK-5)');
    expect(res.data ?? null).toBeNull();
    expect((await lastCall('WEB')).tool).toBe('get_student_attendance');
  });

  it('8 — two Rahuls: the teacher sees only their own, a school-wide reader is asked which', async () => {
    const teacher = await api.ask(school.people.TEACHER, "Show Rahul's attendance.");
    expect(teacher.data.enrollmentId).toBe(String(school.rahul.enrollment._id));

    const admin = await api.ask(school.people.ADMIN, "Show Rahul's attendance.");
    expect(admin.tool).toBeUndefined();
    expect(admin.reply).toMatch(/^More than one student matches "Rahul": /);
    expect(admin.reply).toContain('Rahul Sharma (OAK-1)');
    expect(admin.reply).toContain('Rahul Verma (OAK-10)');
    expect((await lastCall('WEB')).tool).toBe('get_student_attendance');
  });
});

describe('the same question from other roles keeps their own scope', () => {
  it('a parent is answered for their own child', async () => {
    const res = await api.ask(school.people.PARENT, "Show Rahul's attendance.");
    expect(res.tool).toBe('get_student_attendance');
    expect(res.data.enrollmentId).toBe(String(school.rahul.enrollment._id));
  });

  it("a student asking about a classmate is told it is outside their scope", async () => {
    const res = await api.ask(school.people.STUDENT, "Show Rahul's attendance.");
    // The scope is the answer. "No student named Rahul" was false: the school
    // has a Rahul, the student may simply not see him.
    expect(res.reply).toMatch(/only see your own records/i);
    expect(res.refused).toBe('OUT_OF_SCOPE');
    expect((await lastCall('WEB')).tool).toBe('get_student_attendance');
  });

  it('the same tool is chosen on WhatsApp as on the website', async () => {
    await api.ask(school.people.TEACHER, "Show Rahul's attendance.");
    await api.whatsapp(school.people.TEACHER, "Show Rahul's attendance.");
    expect((await lastCall('WEB')).tool).toBe((await lastCall('WHATSAPP')).tool);
  });
});
