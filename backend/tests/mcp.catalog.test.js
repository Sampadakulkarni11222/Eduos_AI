import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { MCP_TOOLS, mcpToolsFor, mcpCatalogStats } from '../src/modules/ai/mcp/registry.js';
import { LEGACY_TOOL_ALIASES } from '../src/modules/ai/mcp/confirm.js';
import { listTools, resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { openSession, closeSession } from '../src/modules/ai/mcp/session.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { startApi } from './support/mcpHttp.js';
import { seedSchool, inSchool, OAK } from './support/mcpSchool.js';

/**
 * One catalog, three views of it, all the same.
 *
 *   GET /api/v1/ai/agent/capabilities   what the website's assistant panel shows
 *   MCP tools/list (through the client) what the model is shown
 *   mcpToolsFor(actor)                  the registry's own permission filter
 *
 * And the generated docs/mcp-tools.json must describe exactly the registry
 * that is running — the same tools, statuses, aliases and blocked list.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'docs', 'mcp-tools.json'), 'utf8'));

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
  school = await seedSchool();
});

async function capabilitiesFor(person) {
  const token = signAccessToken({ accountId: person.actor.accountId, profileId: person.actor.profileId, door: null });
  const res = await fetch(`${api.base}/ai/agent/capabilities`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
}

async function toolsListFor(actor) {
  return inSchool(OAK, async () => {
    const sessionId = openSession({ actor, channel: 'WEB' });
    try {
      return await listTools(sessionId);
    } finally {
      closeSession(sessionId);
    }
  });
}

describe('the capabilities endpoint and MCP tools/list return the same role-filtered catalog', () => {
  const ROLES = ['ADMIN', 'PRINCIPAL', 'FINANCE', 'TEACHER', 'LIBRARIAN', 'WARDEN', 'PARENT', 'STUDENT'];

  it.each(ROLES)('as %s', async (roleKey) => {
    const person = school.people[roleKey];
    const http = await capabilitiesFor(person);
    expect(http.status).toBe(200);
    const fromHttp = http.body.data.tools.map((t) => t.name).sort();
    const fromMcp = (await toolsListFor(person.actor)).map((t) => t.name).sort();
    const fromRegistry = mcpToolsFor(person.actor).map((t) => t.name).sort();

    expect(fromHttp).toEqual(fromMcp);
    expect(fromMcp).toEqual(fromRegistry);
    expect(fromMcp.length).toBe(catalog.roleMatrix.find((r) => r.role === roleKey).total);

    // The frontend's AgentTool shape — { name, description, mutates } — is intact.
    for (const t of http.body.data.tools) {
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(typeof t.mutates).toBe('boolean');
      expect(t.mutates).toBe(MCP_TOOLS[t.name].operation !== 'GET');
    }
  });

  it('shows nothing to an unauthenticated caller', async () => {
    const res = await fetch(`${api.base}/ai/agent/capabilities`);
    expect(res.status).toBe(401);
    expect(await listTools('no-such-session')).toEqual([]);
  });
});

describe('the generated catalog matches the running registry', () => {
  it('has the same tools, with the same operation, permission, scope, risk and confirmation', () => {
    const stats = mcpCatalogStats();
    // Moves when the catalog does; the assertions below are what keep the
    // generated docs and the running registry describing the same thing.
    expect(stats.total).toBe(167);
    expect(catalog.stats).toEqual(stats);
    expect(catalog.tools.map((t) => t.name).sort()).toEqual(Object.keys(MCP_TOOLS).sort());
    for (const t of catalog.tools) {
      const live = MCP_TOOLS[t.name];
      expect(t.operation, t.name).toBe(live.operation);
      expect(t.permission, t.name).toBe(live.permission);
      expect(t.scope, t.name).toBe(live.minScope === 'ALL' ? 'ALL' : 'OWN or ALL');
      expect(t.risk, t.name).toBe(live.risk);
      expect(t.confirmation, t.name).toBe(live.confirmWhen ? 'CONDITIONAL' : live.confirm ? 'REQUIRED' : 'NOT_REQUIRED');
    }
  });

  it('reports statuses, aliases, deprecated and blocked entries as they are', () => {
    const byStatus = catalog.tools.reduce((acc, t) => ({ ...acc, [t.status]: (acc[t.status] ?? 0) + 1 }), {});
    expect(byStatus).toEqual({ AVAILABLE: 165, PARTIAL: 2 });
    expect(catalog.compatibilityAliases.map((a) => [a.legacyName, a.mcpTool])).toEqual(Object.entries(LEGACY_TOOL_ALIASES));
    expect(catalog.deprecated.map((d) => d.name)).toEqual(['record_fee_payment']);
    expect(catalog.deprecated.every((d) => !MCP_TOOLS[d.name])).toBe(true);
    expect(catalog.blocked.length).toBe(13);
    // A blocked capability has no tool.
    expect(catalog.blocked.every((b) => !MCP_TOOLS[b.capability])).toBe(true);
  });
});

describe('GET /health', () => {
  it('reports the database, and nothing about it', async () => {
    const res = await fetch(`${api.base}/health`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ status: 'ok', database: 'ok' });
    expect(JSON.stringify(body)).not.toMatch(/mongodb|127\.0\.0\.1|eduos-test|localhost/i);
  });

  it('answers 503 when the database does not respond', async () => {
    const admin = mongoose.connection.db.admin();
    const spy = vi.spyOn(Object.getPrototypeOf(admin), 'ping').mockRejectedValue(new Error('connection reset by 10.1.2.3'));
    try {
      const res = await fetch(`${api.base}/health`);
      const body = await res.json();
      expect(res.status).toBe(503);
      expect(body.data).toMatchObject({ status: 'degraded', database: 'unavailable' });
      expect(JSON.stringify(body)).not.toMatch(/10\.1\.2\.3|connection reset/);
    } finally {
      spy.mockRestore();
    }
  });
});
