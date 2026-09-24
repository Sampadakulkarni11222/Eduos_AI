import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { parseIntent } from '../src/modules/ai/agent/intent.js';
import { getMcpTool } from '../src/modules/ai/mcp/registry.js';
import { capabilitiesFor } from '../src/modules/ai/mcp/capabilities.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { seedSchool, mcp, OAK } from './support/mcpSchool.js';
import { startApi } from './support/mcpHttp.js';

/**
 * "How many students are absent today?" -- asked by somebody who may only see
 * themselves.
 *
 * The question is school-wide in its wording and personal in its permissions,
 * and the two readings have very different answers. A student holds
 * attendance.read at OWN scope, so the only honest answer is about them; the
 * school's roll-call is not theirs to see however they phrase the question.
 *
 * Routing this used to be asserted by NAME -- the message had to reach
 * `get_attendance` -- and the resolver now sometimes reaches
 * `get_attendance_statistics` instead. That is the same authorized answer
 * under a second name: same permission, neither declaring a minScope, the same
 * arguments, the same two services, and both branching on the scope the MCP
 * server derives from the caller rather than from anything in the call.
 *
 * So the name is not the property worth freezing, and this file asserts the
 * property that is: whichever of them runs, a caller scoped to their own
 * records gets their own records, against a real database, through the real
 * MCP server. The static half of the same contract is checked in
 * agent.moduleTools.test.js, which has no database and can be read quickly.
 */

let api;
let school;

beforeAll(async () => {
  api = await startApi();
});
beforeEach(async () => {
  resetAgentThrottle();
  school = await seedSchool();
});
afterAll(async () => {
  await api.close();
  await resetMcpClient();
});

const ASKED = 'How many students are absent today?';

/** The school's own figures, which none of the tests below may return. */
const SCHOOL_WIDE = [
  /\bstudent\(s\) (?:are |were )?absent today\b/i,
  /\b\d+ of \d+ students\b/i,
  /\bacross the school\b/i,
];

const say = async (person, message) => {
  const res = await api.ask(person, message);
  return { status: res.status, reply: res.reply ?? res.body?.message ?? '' };
};

describe('a caller scoped to their own records gets their own records', () => {
  it('a STUDENT asking the school-wide phrasing is answered about themselves', async () => {
    const student = school.people.STUDENT;
    expect(student.actor.permissions['attendance.read']).toBe('OWN');

    const step = parseIntent(ASKED, student.actor);
    expect(step, 'the student reached no capability at all').toBeTruthy();

    // Whichever capability was chosen, it is not one restricted to callers who
    // may see the whole school -- those declare minScope ALL and are not in
    // this caller's catalogue at all.
    const tool = getMcpTool(step.tool);
    expect(tool.minScope ?? 'OWN').not.toBe('ALL');
    const mine = capabilitiesFor(student.actor).map((c) => c.name);
    expect(mine).toContain(step.tool);
    expect(mine, 'a school-wide capability was in a student\'s catalogue').not.toContain('get_absent_students');
    expect(mine).not.toContain('who_is_absent_today');

    // And what it actually returns is their own position, not the school's.
    // The fixture marks Rahul absent and Priya (the student) present today.
    const res = await say(student, ASKED);
    expect(res.status).toBe(200);
    expect(res.reply, 'the school roll-call was disclosed').not.toMatch(/Rahul/);
    for (const shape of SCHOOL_WIDE) expect(res.reply, `disclosed ${shape}`).not.toMatch(shape);
  }, 120000);

  it('a PARENT asking it is answered about their own child, and no other', async () => {
    const parent = school.people.PARENT;
    expect(parent.actor.permissions['attendance.read']).toBe('OWN');

    const res = await say(parent, ASKED);
    expect(res.status).toBe(200);
    // The fixture's parent is guardian to Rahul only. Priya, Aman and Riya are
    // other people's children and must not appear.
    for (const other of ['Priya', 'Aman', 'Riya']) {
      expect(res.reply, `another family's child (${other}) was disclosed`).not.toMatch(new RegExp(other, 'i'));
    }
    for (const shape of SCHOOL_WIDE) expect(res.reply, `disclosed ${shape}`).not.toMatch(shape);
  }, 120000);

  it('the direct MCP call refuses to widen, whichever of the two is called', async () => {
    // The same question asked of the tool layer itself, with no resolver in
    // between: the scope comes from the actor, so neither name can answer
    // about the school for a caller who may not see it.
    for (const name of ['get_attendance', 'get_attendance_statistics']) {
      const res = await mcp(OAK, school.people.STUDENT.actor, name, { date: undefined });
      expect(res.success, `${name}: ${JSON.stringify(res.error ?? {})}`).toBe(true);
      const body = JSON.stringify(res.data ?? {});
      expect(body, `${name} returned the school's own basis`).not.toMatch(/SCHOOL_DAY/);
      expect(res.speak ?? '', `${name} spoke the school's roll-call`).not.toMatch(/Rahul/);
    }
  }, 120000);

  it('a model cannot ask for somebody else by naming them in the call', async () => {
    // Neither capability declares an argument that could say whose records,
    // which school, or at what scope -- so there is nothing to inject.
    for (const name of ['get_attendance', 'get_attendance_statistics']) {
      const properties = Object.keys(getMcpTool(name).inputSchema?.properties ?? {});
      expect(properties.sort()).toEqual(['date', 'month']);
    }

    // And an argument the schema does not declare is refused outright rather
    // than ignored, so a model cannot smuggle one past validation.
    const res = await mcp(OAK, school.people.STUDENT.actor, 'get_attendance_statistics', {
      enrollmentId: String(school.rahul.enrollment._id),
    });
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('INVALID_INPUT');
  }, 120000);

  it('staff asking the same question still get the school\'s figures', async () => {
    // The other half of the contract: the scope decides, so a caller who MAY
    // see the school does. Without this the fix would be a silent downgrade.
    const res = await say(school.people.ADMIN, ASKED);
    expect(res.status).toBe(200);
    expect(res.reply).toMatch(/absent|present|%/i);
  }, 120000);

  it('the caller\'s own attendance questions keep working', async () => {
    for (const message of ['am I absent today?', 'What is my attendance?']) {
      const step = parseIntent(message, school.people.STUDENT.actor);
      expect(step?.tool, message).toBeTruthy();
      const res = await say(school.people.STUDENT, message);
      expect(res.status, message).toBe(200);
      expect(res.reply, message).not.toMatch(/I'm not sure what you need/i);
    }
  }, 120000);
});
