import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { DASHBOARD_ACCESS, canReadDashboard } from '../src/modules/dashboard/dashboard.service.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { seedSchool, mcp, OAK } from './support/mcpSchool.js';

/**
 * No role may obtain a dashboard the web application would refuse it.
 *
 * `get_dashboard` takes a `view`, and it used to authorize that view on the
 * permission alone. That was weaker than the REST route, which also requires a
 * role whose job the dashboard is and, for the school-wide views, the
 * permission at ALL scope. Since `students.read` and `fees.read` are held at
 * OWN by families, holding the permission at all was enough: a student asking
 * for `view: 'finance'` received the school's whole fee position, and
 * `view: 'admin'` its roll, ticket count and admissions pipeline.
 *
 * These tests invoke the capability DIRECTLY with an explicit view — the
 * natural-language path never sends a student there, which is exactly why the
 * defect survived a suite that only exercised routing.
 */

const VIEWS = Object.keys(DASHBOARD_ACCESS);
const ROLES = SYSTEM_ROLES.map((r) => r.key);
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

let school;
beforeEach(async () => {
  school = await seedSchool();
});
afterAll(async () => {
  await resetMcpClient();
});

/* ── The table describes the routes it claims to describe ─── */

describe('the access table and the REST routes agree', () => {
  const routes = fs.readFileSync(path.join(SRC, 'modules/dashboard/dashboard.routes.js'), 'utf8');

  it('states, for every view, the same roles and permission the route requires', () => {
    for (const [view, rule] of Object.entries(DASHBOARD_ACCESS)) {
      // router.get('/admin', requireRole('A','B'), requirePermission('k','ALL'), ...)
      const line = new RegExp(`router\\.get\\('/${view}'([^;]*)\\)`).exec(routes);
      expect(line, `no route for the ${view} dashboard`).toBeTruthy();

      const roles = [...line[1].matchAll(/requireRole\(([^)]*)\)/g)]
        .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((r) => r[1]));
      const perm = /requirePermission\(\s*'([^']+)'(?:\s*,\s*'([^']+)')?/.exec(line[1]);

      expect(roles.sort(), `${view}: roles drifted from the route`).toEqual([...rule.roles].sort());
      expect(perm?.[1], `${view}: permission drifted from the route`).toBe(rule.permission);
      expect(perm?.[2] ?? null, `${view}: scope drifted from the route`).toBe(rule.scope);
    }
  });

  it('describes every dashboard route, leaving none unaccounted for', () => {
    const declared = [...routes.matchAll(/router\.get\('\/([a-z]+)'/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual(VIEWS.sort());
  });
});

/* ── The matrix: every role against every view ────────────── */

describe('every role against every dashboard view, called directly', () => {
  /** What the web would answer, computed from the route's own rules. */
  const webAllows = (role, view) => canReadDashboard(
    { roleKey: role, permissions: buildPermissionMap({ permissions: SYSTEM_ROLES.find((r) => r.key === role).grants }) },
    view,
  );

  for (const role of ROLES) {
    it(`${role}: MCP allows exactly what the web allows`, async () => {
      // SUPER_ADMIN holds no assistant permission, so every call is refused
      // before the view is even considered. Asserted in full by
      // tests/ai.superAdminExcluded.test.js; here it must simply never succeed.
      const person = role === 'SUPER_ADMIN' ? null : school.people[role];

      for (const view of VIEWS) {
        const actor = person
          ? person.actor
          : {
            roleKey: 'SUPER_ADMIN',
            profileId: String(school.people.ADMIN.profile._id),
            permissions: buildPermissionMap({ permissions: SYSTEM_ROLES.find((r) => r.key === 'SUPER_ADMIN').grants }),
          };

        const res = await mcp(OAK, actor, 'get_dashboard', { view });
        const expected = role === 'SUPER_ADMIN' ? false : webAllows(role, view);

        expect(res.success, `${role} -> ${view}: MCP said ${res.success}, web says ${expected}`).toBe(expected);
        if (!expected) {
          // A refusal must disclose nothing about the school it refused.
          expect(JSON.stringify(res)).not.toMatch(/totalStudents|pendingAmount|collectedAmount|totalBooks|occupiedBeds/);
        }
      }
    }, 120000);
  }
});

/* ── The specific disclosures that were possible ──────────── */

describe('the school-wide figures a family could reach', () => {
  it('refuses a student the finance dashboard, and its collection figures', async () => {
    const res = await mcp(OAK, school.people.STUDENT.actor, 'get_dashboard', { view: 'finance' });
    expect(res.success).toBe(false);
    // ₹13,000 is the fixture's school-wide outstanding total.
    expect(JSON.stringify(res)).not.toMatch(/13000|pendingAmount/);
  }, 60000);

  it('refuses a student the admin dashboard, and the school roll', async () => {
    const res = await mcp(OAK, school.people.STUDENT.actor, 'get_dashboard', { view: 'admin' });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).not.toMatch(/totalStudents|admissionsPipeline/);
  }, 60000);

  it('refuses a student and a parent the librarian dashboard', async () => {
    for (const role of ['STUDENT', 'PARENT']) {
      const res = await mcp(OAK, school.people[role].actor, 'get_dashboard', { view: 'librarian' });
      expect(res.success, role).toBe(false);
    }
  }, 60000);

  it('refuses a teacher, librarian, warden and finance clerk the admin dashboard', async () => {
    for (const role of ['TEACHER', 'LIBRARIAN', 'WARDEN', 'FINANCE']) {
      const res = await mcp(OAK, school.people[role].actor, 'get_dashboard', { view: 'admin' });
      expect(res.success, role).toBe(false);
    }
  }, 60000);

  it('refuses everyone but a parent the parent dashboard', async () => {
    for (const role of ['TEACHER', 'LIBRARIAN', 'WARDEN', 'FINANCE', 'STUDENT']) {
      const res = await mcp(OAK, school.people[role].actor, 'get_dashboard', { view: 'parent' });
      expect(res.success, role).toBe(false);
    }
    expect((await mcp(OAK, school.people.PARENT.actor, 'get_dashboard', { view: 'parent' })).success).toBe(true);
  }, 60000);
});

/* ── What each role SHOULD still get ──────────────────────── */

describe('each role still reaches its own dashboard', () => {
  const OWN = {
    ADMIN: 'admin', PRINCIPAL: 'admin', FINANCE: 'finance', TEACHER: 'teacher',
    STUDENT: 'student', PARENT: 'parent', WARDEN: 'warden', LIBRARIAN: 'librarian',
  };

  it('with an explicit view', async () => {
    for (const [role, view] of Object.entries(OWN)) {
      const res = await mcp(OAK, school.people[role].actor, 'get_dashboard', { view });
      expect(res.success, `${role} lost its own ${view} dashboard`).toBe(true);
      expect(res.data?.view).toBe(view);
    }
  }, 120000);

  it('and with no view at all, resolved from the session role', async () => {
    for (const [role, view] of Object.entries(OWN)) {
      const res = await mcp(OAK, school.people[role].actor, 'get_dashboard', {});
      expect(res.success, `${role} got no default dashboard`).toBe(true);
      // PRINCIPAL's own view is the admin one, which is the first rule listing it.
      expect(res.data?.view, role).toBe(view);
    }
  }, 120000);
});
