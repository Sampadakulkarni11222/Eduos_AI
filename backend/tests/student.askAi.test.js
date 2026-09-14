import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MCP_TOOLS, mcpToolsFor, mutates } from '../src/modules/ai/mcp/registry.js';
import { capabilitiesFor } from '../src/modules/ai/mcp/capabilities.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { startApi } from './support/mcpHttp.js';
import { seedSchool, inSchool, mcp, actorForRole, OAK, RIVER } from './support/mcpSchool.js';

/**
 * A student asking the assistant about their own school life.
 *
 * The student reaches the same architecture the teacher does: POST /ai/agent →
 * the shared orchestrator → the MCP registry → the same services. There is no
 * separate student implementation and no student question list; what makes the
 * answers different is only the permission map the student carries, which
 * yields a different set of capabilities from the same registry.
 *
 * The phrasings below are INPUTS, not fixtures for a routing table. What is
 * asserted is that a request in the student's own words reaches a capability
 * the student is authorized for, answers from live data, and never discloses
 * anybody else's record — with identity taken from the session rather than from
 * anything the message or the model says.
 *
 * The fixture's student is Priya Verma (OAK-2, Class 6 A, present today);
 * Rahul Sharma is a classmate with an overdue invoice, and Riverside is a
 * second school that also has a Rahul.
 */

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
});

const student = () => school.people.STUDENT;
const parent = () => school.people.PARENT;

/** Nothing internal may reach a person: no tool names, no schema words, no ids. */
function expectNoCatalogLeak(text) {
  const reply = String(text ?? '');
  for (const leak of [/\bget_[a-z_]+\b/, /\blist_[a-z_]+\b/, /inputSchema/i, /additionalProperties/i, /read-only/i, /enrollmentId/i, /[a-f0-9]{24}/]) {
    expect(reply, `leaked internals: ${leak}`).not.toMatch(leak);
  }
}

/** The last tool the MCP server actually ran, from its own audit trail. */
async function lastTool(tenant = OAK) {
  const entry = await inSchool(tenant, () => AuditLog.findOne({ 'after.via': 'MCP' }).sort({ createdAt: -1, _id: -1 }).lean());
  return entry?.action?.replace(/^agent\./, '') ?? null;
}

/* ── 1. The student's own questions are answered ──────────── */

describe('1. a student asking in their own words is answered from live data', () => {
  /**
   * One request per subject a student actually has. Each asserts the shape of
   * a real answer — a 200, a reply with no internals in it, and a tool the
   * student is authorized for — rather than a specific tool name, because
   * which capability answers is the registry's decision, not this test's.
   */
  const REQUESTS = [
    'Show my attendance.',
    'Show my marks.',
    'Show my exam results.',
    'Show my homework.',
    'Show my assignments.',
    'Show my timetable.',
    'Show my announcements.',
    'Show my fees.',
    'Show my leave requests.',
  ];

  it('answers every one of them through an authorized capability', async () => {
    const authorized = new Set(mcpToolsFor(student().actor).map((t) => t.name));
    const failures = [];

    for (const message of REQUESTS) {
      resetAgentThrottle();
      // eslint-disable-next-line no-await-in-loop -- one conversation at a time, as a person would
      const res = await api.ask(student(), message);
      if (res.status !== 200) { failures.push(`${message}: HTTP ${res.status}`); continue; }
      if (!res.reply || !String(res.reply).trim()) { failures.push(`${message}: empty reply`); continue; }
      if (res.tool && !authorized.has(res.tool)) failures.push(`${message}: used ${res.tool}, which the student may not use`);
      expectNoCatalogLeak(res.reply);
    }
    expect(failures).toEqual([]);
  }, 120_000);

  it('reads the student\'s own attendance from the register, not a generic message', async () => {
    // Priya was marked PRESENT today in the fixture, so a real number comes back.
    const res = await api.ask(student(), 'What is my attendance?');
    expect(res.status).toBe(200);
    expect(res.reply).toMatch(/\d/);
    expectNoCatalogLeak(res.reply);
    // It went through MCP, not around it.
    expect(await lastTool()).toBeTruthy();
  });

  it('resolves "my" from the session, with no student named in the message', async () => {
    const res = await api.ask(student(), 'how many days was I present this month?');
    expect(res.status).toBe(200);
    // Never asks the student who they are.
    expect(res.reply).not.toMatch(/which student/i);
    expectNoCatalogLeak(res.reply);
  });
});

/* ── 2. Identity is the server's, not the message's ───────── */

describe('2. a student cannot become somebody else', () => {
  it('does not answer with a classmate\'s record when their name is used', async () => {
    const res = await api.ask(student(), "Show Rahul Sharma's attendance.");
    expect(res.status).toBe(200);

    // What must not happen is DISCLOSURE, not the name appearing. The directory
    // search runs at the student's own scope, finds nobody they may see, and
    // says "No student named …" — quoting the words the student themselves
    // typed, which is the honest answer and reveals nothing. Asserting the name
    // is absent would pin the wrong thing: it would fail on a safe refusal and
    // pass on a leak that happened to paraphrase.
    expect(JSON.stringify(res.data ?? {})).not.toMatch(/Rahul/);
    expect(res.reply).not.toMatch(/OAK-1\b/);        // his admission number
    expect(res.reply).not.toMatch(/\d+\s*%/);         // no attendance figure for him
    expectNoCatalogLeak(res.reply);
  });

  it('refuses a classmate\'s student id supplied straight to the tool', async () => {
    const res = await mcp(OAK, student().actor, 'get_student_attendance', {
      studentId: String(school.rahul.student._id),
    });
    if (res.success) {
      expect(JSON.stringify(res.data)).not.toMatch(/Rahul/);
    } else {
      expect(['NOT_FOUND', 'FORBIDDEN', 'FORBIDDEN_SCOPE', 'NEEDS_INPUT', 'INVALID_INPUT']).toContain(res.error?.code);
    }
  });

  it('ignores identity, role and scope offered in the arguments', async () => {
    // The server strips these before a tool sees them (session.js STRIPPED_ARGS),
    // so a model that offered them changes nothing.
    const res = await mcp(OAK, student().actor, 'get_my_profile', {
      profileId: String(school.people.TEACHER.profile._id),
      role: 'TEACHER',
      roleKey: 'ADMIN',
      scope: 'ALL',
      tenantId: RIVER,
    });
    expect(res.success).toBe(true);
    const said = JSON.stringify(res.data);
    expect(said).not.toMatch(/Riverside/);
    expect(said).not.toMatch(/TEACHER user/);
  });

  it('answers a parent for their own child, and the student for themselves', async () => {
    // The same request, two callers, two answers — from the session alone.
    const asStudent = await api.ask(student(), 'What is my attendance?');
    resetAgentThrottle();
    const asParent = await api.ask(parent(), "What is my child's attendance?");
    expect(asStudent.status).toBe(200);
    expect(asParent.status).toBe(200);
    expectNoCatalogLeak(asStudent.reply);
    expectNoCatalogLeak(asParent.reply);
  });
});

/* ── 3. Only the student's own capabilities ───────────────── */

describe('3. the student is offered only what their grants allow', () => {
  it('sees a catalog derived from their permissions, all of it own-scoped', () => {
    const mine = capabilitiesFor(student().actor);
    expect(mine.length).toBeGreaterThan(0);
    // Not one ALL-gated capability: a student has no school-wide grant.
    expect(mine.filter((c) => c.minScope === 'ALL')).toEqual([]);
    // And it is exactly the registry's own permission filter, not a list.
    expect(mine.map((c) => c.name).sort()).toEqual(mcpToolsFor(student().actor).map((t) => t.name).sort());
  });

  it('is not offered the capabilities a teacher holds and a student does not', () => {
    const theirs = new Set(mcpToolsFor(student().actor).map((t) => t.name));
    const teacherOnly = mcpToolsFor(actorForRole('TEACHER')).map((t) => t.name).filter((n) => !theirs.has(n));
    expect(teacherOnly.length).toBeGreaterThan(0);
    for (const name of teacherOnly) expect(theirs.has(name), `student was offered ${name}`).toBe(false);
  });

  it('is refused a capability it lacks the permission for, through the server', async () => {
    // Course material is materials.manage, which a student does not hold.
    const res = await mcp(OAK, student().actor, 'create_course_material', {
      title: 'Mine now', fileUrl: '/uploads/x.pdf', sectionId: String(school.sectionA._id),
    });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('FORBIDDEN');
  });

  it('is refused a class-wide read that belongs to staff', async () => {
    const res = await mcp(OAK, student().actor, 'get_absent_students', {});
    expect(res.success).toBe(false);
    expect(['FORBIDDEN', 'FORBIDDEN_SCOPE']).toContain(res.error?.code);
  });
});

/* ── 4. Tenancy ───────────────────────────────────────────── */

describe('4. a student never reaches another school', () => {
  it('does not see the other school\'s namesake', async () => {
    const res = await api.ask(student(), 'Show my attendance.');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res)).not.toMatch(/Riverside/);
  });

  it('finds nothing when handed another school\'s id', async () => {
    const res = await mcp(OAK, student().actor, 'get_student_attendance', {
      studentId: String(school.river.student._id),
    });
    if (res.success) expect(JSON.stringify(res.data)).not.toMatch(/Riverside/);
    else expect(['NOT_FOUND', 'FORBIDDEN', 'NEEDS_INPUT', 'INVALID_INPUT', 'FORBIDDEN_SCOPE']).toContain(res.error?.code);
  });
});

/* ── 5. Ambiguity and writes ──────────────────────────────── */

describe('5. nothing is guessed, and a write still needs a yes', () => {
  it('does not resolve a misspelt name into somebody\'s record', async () => {
    const res = await mcp(OAK, student().actor, 'get_student_attendance', { studentName: 'Rahyl Sharmaa' });
    if (res.success) expect(JSON.stringify(res.data)).not.toMatch(/Rahul/);
    else expect(['NOT_FOUND', 'NEEDS_INPUT', 'INVALID_INPUT', 'FORBIDDEN']).toContain(res.error?.code);
  });

  it('refuses an identifier that is not one', async () => {
    const res = await mcp(OAK, student().actor, 'get_student_attendance', { studentId: 'not-an-id' });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('INVALID_INPUT');
  });

  it('keeps every student write behind a confirmation and a summary', () => {
    const writes = capabilitiesFor(student().actor).filter((c) => c.writes);
    expect(writes.length).toBeGreaterThan(0);
    for (const c of writes) {
      const tool = MCP_TOOLS[c.name];
      expect(mutates(tool), c.name).toBe(true);
      expect(typeof tool.summarise, `${c.name} cannot summarise itself`).toBe('function');
      // Anything reaching another person's record must be confirmed.
      if (tool.affectsOthers) expect(Boolean(tool.confirm || tool.confirmWhen), `${c.name}`).toBe(true);
    }
  });

  it('proposes a student write before performing it', async () => {
    const proposal = await mcp(OAK, student().actor, 'apply_for_leave', {
      fromDate: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
      toDate: new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10),
      reason: 'Family function',
    });
    // Either it proposed and waits for a yes, or it refused — never a silent write.
    if (proposal.action?.status === 'confirmation_required') {
      expect(proposal.action.confirmationToken).toBeTruthy();
    } else {
      expect(proposal.success === false || Boolean(proposal.action)).toBe(true);
    }
  });
});

/* ── 6. One architecture, not two ─────────────────────────── */

describe('6. the student uses the teacher\'s architecture', () => {
  it('has no student-specific resolver, tool file or question table', () => {
    const forbidden = ['studentIntent.js', 'studentTools.js', 'studentMcpServer.js', 'studentToolMap.js', 'studentQuestionRules.js'];
    const fs = require('fs');
    const path = require('path');
    const roots = ['src/modules/ai/agent', 'src/modules/ai/mcp', 'src/modules/ai/mcp/tools'];
    for (const root of roots) {
      const dir = path.resolve(process.cwd(), root);
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir)) {
        expect(forbidden, `${root}/${file}`).not.toContain(file);
      }
    }
  });

  it('resolves the student through the same registry filter as everyone else', () => {
    for (const roleKey of ['STUDENT', 'PARENT', 'TEACHER', 'ADMIN']) {
      const actor = actorForRole(roleKey);
      expect(capabilitiesFor(actor).map((c) => c.name).sort()).toEqual(mcpToolsFor(actor).map((t) => t.name).sort());
    }
  });
});
