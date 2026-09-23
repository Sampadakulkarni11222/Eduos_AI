import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { parseIntent } from '../src/modules/ai/agent/intent.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { Book } from '../src/models/library.model.js';
import { HostelRoom } from '../src/models/hostel.model.js';
import { seedSchool, mcp, inSchool, OAK } from './support/mcpSchool.js';
import { startApi } from './support/mcpHttp.js';

/**
 * One question, three doors.
 *
 * The requirement the report set out is that the Web assistant, the WhatsApp
 * assistant and a direct MCP call are the same capability reached three ways —
 * not three implementations that happen to agree today. They already share
 * runAgent() and the MCP server, so what is asserted here is that the sharing
 * actually holds for the sentences that were reported broken: the same
 * capability is chosen, and the same authorization decides it.
 *
 * WhatsApp is exercised through the real webhook, signed the way Meta signs it,
 * so the message travels the whole path a phone's message travels.
 */

let school;
let api;

beforeAll(async () => {
  api = await startApi();
});
beforeEach(async () => {
  school = await seedSchool();
  await inSchool(OAK, () => Book.create({
    title: 'Clean Code', author: 'Robert Martin', totalCopies: 3, availableCopies: 3,
  }));
  await inSchool(OAK, () => HostelRoom.create({
    roomNo: '101', block: 'Main', capacity: 2, type: 'GENERAL', status: 'ACTIVE',
  }));
});
afterAll(async () => {
  await api.close();
  await resetMcpClient();
});

/** The last tool the MCP server recorded on a channel, from the audit trail. */
async function lastCall(channel) {
  const entry = await inSchool(OAK, () => AuditLog
    .findOne({ 'after.via': 'MCP', channel })
    .sort({ createdAt: -1, _id: -1 })
    .lean());
  return entry ? { tool: entry.action?.replace(/^agent\./, ''), status: entry.after?.status ?? null } : null;
}

/**
 * The representative set the report named for WhatsApp, one per role, mixing
 * reads and writes.
 */
const SCENARIOS = [
  ['ADMIN', 'Show my students.'],
  ['STUDENT', 'Show my books.'],
  ['STUDENT', 'Show available transport routes.'],
  ['PARENT', 'Show my support tickets.'],
  ['FINANCE', 'Show fee heads.'],
  ['LIBRARIAN', 'Show available books.'],
  ['WARDEN', 'Show available hostel rooms.'],
];

describe('13, 14 — the same question reaches the same capability on every channel', () => {
  for (const [role, message] of SCENARIOS) {
    it(`${role}: "${message}"`, async () => {
      const person = school.people[role];

      // The capability the resolver picks is a property of the message and the
      // caller, not of the door they came through.
      const step = parseIntent(message, person.actor);
      expect(step, `"${message}" reached no capability`).toBeTruthy();

      const web = await api.ask(person, message);
      expect(web.status, JSON.stringify(web.body)).toBe(200);
      const webCall = await lastCall('WEB');
      expect(webCall?.tool, `${role} on the website`).toBe(step.tool);

      const wa = await api.whatsapp(person, message);
      expect(wa.status).toBe(200);
      const waCall = await lastCall('WHATSAPP');
      expect(waCall?.tool, `${role} on WhatsApp`).toBe(step.tool);

      // And the same capability called directly answers the same way.
      const direct = await mcp(OAK, person.actor, step.tool, step.args);
      expect(direct.success || Boolean(direct.action), JSON.stringify(direct.error ?? {})).toBe(true);
    }, 90000);
  }
});

describe('13 — a write asked for on WhatsApp is proposed, not performed', () => {
  it('a librarian adding a book on WhatsApp is asked to confirm first', async () => {
    const wa = await api.whatsapp(school.people.LIBRARIAN, 'Add the book Refactoring by Martin Fowler with 2 copies');
    expect(wa.status).toBe(200);

    const call = await lastCall('WHATSAPP');
    // The property, not a wording. However the message routed -- to the create,
    // to something else, or to a request for more detail -- no write may have
    // COMPLETED, because nobody has said yes yet.
    if (call) expect(call.status, 'a write ran on WhatsApp without confirmation').not.toBe('WRITE');
    const books = await inSchool(OAK, () => Book.find({ title: 'Refactoring' }).lean());
    expect(books, 'a book was created without confirmation').toHaveLength(0);
  }, 90000);
});

describe('12 — SUPER_ADMIN is refused on every channel', () => {
  it('holds no assistant permission, so no channel routes for them', async () => {
    // Built from the role catalogue rather than from a seeded person, because
    // SUPER_ADMIN is deliberately not a member of any school. A real profile id
    // is borrowed so the refusal cannot be an artefact of an absent one: the
    // permission map is what must refuse, not a missing fixture.
    const { SYSTEM_ROLES } = await import('../src/constants/permissions.js');
    const { buildPermissionMap } = await import('../src/utils/buildPermissionMap.js');
    const role = SYSTEM_ROLES.find((r) => r.key === 'SUPER_ADMIN');
    expect(role, 'SUPER_ADMIN is not defined').toBeTruthy();

    const actor = {
      roleKey: 'SUPER_ADMIN',
      profileId: String(school.people.ADMIN.profile._id),
      permissions: buildPermissionMap({ permissions: role.grants }),
      tenantId: OAK,
    };
    expect(actor.permissions['ai.copilot.use']).toBeFalsy();

    for (const message of SCENARIOS.map(([, m]) => m)) {
      expect(parseIntent(message, actor), message).toBeNull();
    }

    // And the tool layer refuses regardless of what was proposed.
    const direct = await mcp(OAK, actor, 'search_students', { query: 'Rahul' });
    expect(direct.success).toBe(false);
    expect(direct.error.code).toMatch(/FORBIDDEN/);
  }, 60000);
});
