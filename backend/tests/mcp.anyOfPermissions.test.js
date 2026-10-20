import { describe, it, expect, afterAll } from 'vitest';
import {
  MCP_TOOLS, mcpToolsFor, toolGrants, toolScope, anyOfProblems, validateMcpRegistry, mcpPermissionsUsed,
} from '../src/modules/ai/mcp/registry.js';
import { PERMISSION_CATALOG } from '../src/constants/permissions.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { mcp, actorForRole, OAK } from './support/mcpSchool.js';

/**
 * `anyOf`: a tool mirrors a route that accepts any of several keys
 * (requireAnyOf). The principal reads trips by transport.tracking.read at ALL,
 * the transport office by transport.fleet.manage, a teacher on bus duty by
 * transport.trips.operate -- one tool, the same three doors as the screen,
 * and the scope the service receives is what req.scope would be.
 */
afterAll(async () => { await resetMcpClient(); });

const fake = (over) => ({ permission: 'a.read', ...over });
const actor = (permissions) => ({ roleKey: 'X', profileId: 'p', permissions: { 'ai.copilot.use': 'ALL', ...permissions } });

describe('toolScope', () => {
  it('a plain tool keeps its one grant and minimum scope', () => {
    expect(toolGrants(fake({ minScope: 'ALL' }))).toEqual([['a.read', 'ALL']]);
    expect(toolScope(actor({ 'a.read': 'ALL' }), fake({ minScope: 'ALL' }))).toEqual({ scope: 'ALL', reason: null });
    expect(toolScope(actor({ 'a.read': 'OWN' }), fake({ minScope: 'ALL' }))).toEqual({ scope: null, reason: 'SCOPE' });
    expect(toolScope(actor({}), fake({}))).toEqual({ scope: null, reason: 'MISSING' });
  });

  it('any one grant admits; ALL beats OWN; a grant held below its minimum does not count', () => {
    const t = fake({ anyOf: [['a.read'], ['b.manage', 'ALL']] });
    expect(toolScope(actor({ 'a.read': 'OWN' }), t)).toEqual({ scope: 'OWN', reason: null });
    expect(toolScope(actor({ 'a.read': 'OWN', 'b.manage': 'ALL' }), t)).toEqual({ scope: 'ALL', reason: null });
    expect(toolScope(actor({ 'b.manage': 'OWN' }), t)).toEqual({ scope: null, reason: 'SCOPE' });
    expect(toolScope(actor({ 'c.other': 'ALL' }), t)).toEqual({ scope: null, reason: 'MISSING' });
  });
});

describe('validation stays strict', () => {
  it('refuses a malformed anyOf, a primary permission outside it, and a disagreeing minScope', () => {
    expect(anyOfProblems('x', fake({ anyOf: [['a.read']] }))[0]).toMatch(/malformed/);
    expect(anyOfProblems('x', fake({ anyOf: [['a.read'], ['b', 'OWN']] }))[0]).toMatch(/malformed/);
    expect(anyOfProblems('x', fake({ anyOf: 'a.read' }))[0]).toMatch(/malformed/);
    expect(anyOfProblems('x', fake({ anyOf: [['b.read'], ['c.read']] }))[0]).toMatch(/not one of its anyOf/);
    expect(anyOfProblems('x', fake({ minScope: 'ALL', anyOf: [['a.read'], ['c.read']] }))[0]).toMatch(/disagrees/);
    expect(anyOfProblems('x', fake({ anyOf: [['a.read'], ['c.read', 'ALL']] }))).toEqual([]);
  });

  it('the real catalogue passes, and every anyOf key is a real permission', () => {
    expect(validateMcpRegistry()).toEqual([]);
    const known = new Set(PERMISSION_CATALOG.map((p) => p.key));
    expect(mcpPermissionsUsed().filter((k) => !known.has(k))).toEqual([]);
    const withAnyOf = Object.entries(MCP_TOOLS).filter(([, t]) => t.anyOf);
    expect(withAnyOf.length).toBeGreaterThan(5);
  });
});

describe('discovery and execution follow the route\'s alternatives', () => {
  it('list_trips is shown to the transport office, the principal (tracking at ALL) and a teacher on bus duty', () => {
    for (const role of ['ADMIN', 'PRINCIPAL', 'TEACHER']) {
      expect(mcpToolsFor(actorForRole(role)).map((t) => t.name), role).toContain('list_trips');
    }
    expect(mcpToolsFor(actorForRole('PARENT')).map((t) => t.name)).not.toContain('list_trips');
  });

  it('get_emergency_roster mirrors requireAnyOf(visitors.manage, checkpoints.read ALL)', () => {
    const t = MCP_TOOLS.get_emergency_roster;
    expect(t.anyOf).toEqual([['visitors.manage'], ['checkpoints.read', 'ALL']]);
    for (const role of ['ADMIN', 'PRINCIPAL', 'COMPLIANCE', 'WARDEN', 'PARENT', 'TEACHER']) {
      const a = actorForRole(role);
      const routeAdmits = Boolean(a.permissions['visitors.manage']) || a.permissions['checkpoints.read'] === 'ALL';
      expect(mcpToolsFor(a).some((x) => x.name === 'get_emergency_roster'), role).toBe(routeAdmits);
    }
  });

  it('the server refuses a caller none of whose keys admit them, before anything runs', async () => {
    const res = await mcp(OAK, actorForRole('PARENT'), 'list_vehicles', {});
    expect(res.success).toBe(false);
    expect(res.error.code).toMatch(/^FORBIDDEN(_SCOPE)?$/); // a parent holds transport.read only at OWN
  });

  it('the server admits a caller through a second key', async () => {
    const principal = actorForRole('PRINCIPAL');
    expect(principal.permissions['transport.fleet.manage']).toBeFalsy();
    const res = await mcp(OAK, principal, 'list_trips', {});
    // Admitted: it either answers or reports the module switched off -- never "not authorized".
    if (!res.success) expect(res.error.message).not.toMatch(/not authorized/i);
  });
});
