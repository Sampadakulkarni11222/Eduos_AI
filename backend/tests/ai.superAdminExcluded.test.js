import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mcpToolsFor } from '../src/modules/ai/mcp/registry.js';
import { capabilitiesFor } from '../src/modules/ai/mcp/capabilities.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { startApi } from './support/mcpHttp.js';
import { seedSchool, seedPerson, inSchool, mcp, OAK } from './support/mcpSchool.js';

/**
 * SUPER_ADMIN cannot use the assistant, and the exclusion is server-side.
 *
 * The platform role acts across schools: a request it makes without naming one
 * runs outside any tenant, where the filter that confines every other caller
 * is simply absent, so an assistant answer could span schools. Writes were
 * already refused in that state (assertSchoolContext), but the honest position
 * is that the assistant is a school-level tool.
 *
 * The exclusion is one withheld permission — `ai.copilot.use` — which every
 * route into the assistant already requires and from which the MCP catalogue
 * is built. So it is enforced by the same authorization layer every other role
 * passes through, with no SUPER_ADMIN branch in the AI code. Hiding the UI
 * button would not have been an exclusion at all, which is why the checks
 * below go through the real HTTP surface.
 */

let api;
let school;
let superAdmin;

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
  superAdmin = await inSchool(OAK, () => seedPerson({
    roleKey: 'SUPER_ADMIN',
    roleId: school.roleIds.SUPER_ADMIN,
    displayName: 'Platform admin',
  }));
});

describe('SUPER_ADMIN is refused the assistant', () => {
  it('does not hold the permission every assistant route requires', () => {
    expect(superAdmin.actor.permissions['ai.copilot.use']).toBeUndefined();
  });

  it('is described no capabilities', () => {
    expect(mcpToolsFor(superAdmin.actor)).toEqual([]);
    expect(capabilitiesFor(superAdmin.actor)).toEqual([]);
  });

  it('is refused POST /ai/agent, whatever it asks', async () => {
    for (const message of [
      'Who is absent today?',
      'Show me the pending fees',
      // A write, and a cross-school question: neither may be answered.
      'Mark Rahul Sharma present today',
      'How many students are there across all schools?',
    ]) {
      const res = await api.ask(superAdmin, message);
      expect(res.status, `"${message}" was not refused`).toBe(403);
      // Nothing about the school may come back with the refusal.
      expect(JSON.stringify(res.body)).not.toMatch(/Rahul|Priya|Oakridge|13,000/);
    }
  }, 60000);

  it('is refused the capability listing, so it cannot even enumerate the catalogue', async () => {
    const token = await api.post(superAdmin, '/ai/agent', { message: 'hello', source: 'WEB' });
    expect(token.status).toBe(403);
    // The GET form too — a different route with the same gate.
    const res = await fetch(`${api.base}/ai/agent/capabilities`, {
      headers: { authorization: `Bearer ${(await import('../src/utils/jwt.js')).signAccessToken({
        accountId: superAdmin.actor.accountId, profileId: superAdmin.actor.profileId, door: null,
      })}` },
    });
    expect(res.status).toBe(403);
  }, 60000);

  it('is refused the confirmation endpoint, so no proposal can be redeemed', async () => {
    const res = await api.confirm(superAdmin, 'any-token-at-all', true);
    expect(res.status).toBe(403);
  }, 60000);

  it('runs no tool and writes no agent audit entry', async () => {
    await api.ask(superAdmin, 'Mark the whole class present today');
    const entry = await inSchool(OAK, () => AuditLog.findOne({ 'after.via': 'MCP' }).lean());
    expect(entry).toBeNull();
  }, 60000);

  it('is refused at the MCP server itself, not merely left out of the catalogue', async () => {
    // The distinction that matters: this role still holds the permission each
    // tool names (students.read, attendance.read, ...), so an empty catalogue
    // alone would leave execution-by-name open. The server refuses first on
    // the assistant permission.
    for (const name of ['get_attendance_roster', 'search_students', 'mark_attendance', 'get_pending_fees']) {
      const res = await mcp(OAK, superAdmin.actor, name, {});
      expect(res.success, `${name} was not refused`).toBe(false);
      expect(res.error?.code, name).toBe('FORBIDDEN');
      expect(JSON.stringify(res)).not.toMatch(/Rahul|Priya|13,000/);
    }
  }, 60000);

  it('keeps every other permission it holds', () => {
    // The exclusion is one permission, not a demotion: the platform console
    // it actually uses is unaffected.
    expect(superAdmin.actor.permissions['schools.manage']).toBe('ALL');
    expect(superAdmin.actor.permissions['schools.read']).toBe('ALL');
    expect(superAdmin.actor.permissions['users.manage']).toBe('ALL');
    expect(superAdmin.actor.permissions['ai.insights.read']).toBe('ALL');
  });
});

describe('every other role is unaffected', () => {
  it('lets an ADMIN use the assistant exactly as before', async () => {
    const res = await api.ask(school.people.ADMIN, 'Who is absent today?');
    expect(res.status).toBe(200);
    expect(String(res.reply ?? res.body?.data?.reply ?? '')).toMatch(/absent today/i);
    expect(mcpToolsFor(school.people.ADMIN.actor).length).toBeGreaterThan(100);
  }, 60000);

  it('lets a STUDENT use the assistant exactly as before', async () => {
    const res = await api.ask(school.people.STUDENT, 'What is my attendance?');
    expect(res.status).toBe(200);
    expect(mcpToolsFor(school.people.STUDENT.actor).length).toBeGreaterThan(0);
  }, 60000);

  it('gives every non-platform role a catalogue', () => {
    for (const role of ['ADMIN', 'PRINCIPAL', 'TEACHER', 'PARENT', 'STUDENT', 'FINANCE', 'LIBRARIAN', 'WARDEN']) {
      expect(
        mcpToolsFor(school.people[role].actor).length,
        `${role} lost its capabilities`,
      ).toBeGreaterThan(0);
    }
  });
});
