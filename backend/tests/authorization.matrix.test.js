import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PERMISSION_CATALOG, SYSTEM_ROLES, SUPER_ADMIN_ONLY, AI_ASSISTANT_PERMISSION } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { requirePermission, requireRole } from '../src/middleware/permission.js';

/**
 * The role → permission boundary, asserted through the real route guard.
 *
 * Every case below runs requirePermission()/requireRole() exactly as a request
 * would, so what is proved is the behaviour of the middleware the routes
 * actually mount — not a restatement of the grant tables.
 */

const roleGrants = new Map(SYSTEM_ROLES.map((r) => [r.key, r.grants]));
const CATALOG_KEYS = new Set(PERMISSION_CATALOG.map((p) => p.key));

/** Mirrors what authenticate() puts on req.actor, from the seeded grants. */
const actorFor = (roleKey) => ({
  roleKey,
  permissions: buildPermissionMap({ permissions: roleGrants.get(roleKey) }),
});

/** Runs the real guard and reports allow/deny the way an HTTP call would. */
const can = (roleKey, permissionKey, minScope) => {
  const req = { actor: actorFor(roleKey) };
  try {
    requirePermission(permissionKey, minScope)(req, {}, () => {});
    return true;
  } catch {
    return false;
  }
};

/** The scope the role holds for a key, or null when it holds none. */
const scopeOf = (roleKey, permissionKey) => actorFor(roleKey).permissions[permissionKey] ?? null;

const SCHOOL_ROLES = SYSTEM_ROLES.map((r) => r.key).filter((k) => k !== 'SUPER_ADMIN');

describe('the catalog is internally consistent', () => {
  it('every granted key exists in the catalog — no role grants a phantom key', () => {
    for (const role of SYSTEM_ROLES) {
      for (const g of role.grants) {
        expect(CATALOG_KEYS.has(g.key), `${role.key} grants unknown key "${g.key}"`).toBe(true);
      }
    }
  });

  it('every grant carries a scope the guard understands', () => {
    for (const role of SYSTEM_ROLES) {
      for (const g of role.grants) {
        expect(['ALL', 'OWN'], `${role.key}.${g.key}`).toContain(g.scope);
      }
    }
  });

  it('no role declares the same key twice', () => {
    for (const role of SYSTEM_ROLES) {
      const keys = role.grants.map((g) => g.key);
      expect(new Set(keys).size, `${role.key} has duplicate grants`).toBe(keys.length);
    }
  });
});

describe('platform vs school boundary', () => {
  it('Super Admin holds every key in the catalog except the assistant', () => {
    // One deliberate exception: `ai.copilot.use`. It is the single gate on
    // every route into the AI assistant and on the MCP catalogue, so
    // withholding it is what excludes the platform role from a school-level
    // tool that would otherwise answer across schools. See
    // tests/ai.superAdminExcluded.test.js and the note in constants/permissions.js.
    for (const key of CATALOG_KEYS) {
      if (key === AI_ASSISTANT_PERMISSION) continue;
      expect(can('SUPER_ADMIN', key), `SUPER_ADMIN must hold ${key}`).toBe(true);
    }
    expect(can('SUPER_ADMIN', AI_ASSISTANT_PERMISSION)).toBe(false);
  });

  it('no school-level role can reach the platform keys', () => {
    for (const roleKey of SCHOOL_ROLES) {
      for (const key of SUPER_ADMIN_ONLY) {
        expect(can(roleKey, key), `${roleKey} must not hold ${key}`).toBe(false);
      }
    }
  });
});

describe('authorized operations are allowed', () => {
  const allowed = [
    ['ADMIN', 'users.manage'], ['ADMIN', 'students.manage'], ['ADMIN', 'audit.read'],
    ['ADMIN', 'announcements.publish'], ['ADMIN', 'fees.manage'], ['ADMIN', 'roles.manage'],
    ['PRINCIPAL', 'analytics.school.read'], ['PRINCIPAL', 'marks.publish'], ['PRINCIPAL', 'audit.read'],
    ['TEACHER', 'attendance.mark'], ['TEACHER', 'marks.enter'], ['TEACHER', 'assignments.manage'],
    ['TEACHER', 'submissions.grade'], ['TEACHER', 'materials.manage'],
    ['STUDENT', 'submissions.submit'], ['STUDENT', 'registrations.apply'], ['STUDENT', 'fees.pay'],
    ['PARENT', 'fees.pay'], ['PARENT', 'medical.manage'], ['PARENT', 'analytics.child.read'],
    ['FINANCE', 'fees.structure.manage'], ['FINANCE', 'fees.payments.refund'],
    ['LIBRARIAN', 'library.manage'], ['WARDEN', 'hostel.manage'],
  ];

  it.each(allowed)('%s may %s', (roleKey, key) => {
    expect(can(roleKey, key)).toBe(true);
  });
});

describe('unauthorized operations are rejected', () => {
  const denied = [
    // Teaching staff must not administer the school or the RBAC system itself.
    ['TEACHER', 'users.manage'], ['TEACHER', 'roles.manage'], ['TEACHER', 'audit.read'],
    ['TEACHER', 'fees.manage'], ['TEACHER', 'exams.manage'], ['TEACHER', 'medical.manage'],
    ['PRINCIPAL', 'roles.manage'], ['PRINCIPAL', 'users.manage'], ['PRINCIPAL', 'fees.manage'],
    // Families may read their own records, never write the school's.
    ['STUDENT', 'marks.enter'], ['STUDENT', 'attendance.mark'], ['STUDENT', 'students.manage'],
    ['STUDENT', 'announcements.publish'], ['STUDENT', 'users.read'], ['STUDENT', 'medical.read'],
    ['PARENT', 'marks.enter'], ['PARENT', 'attendance.mark'], ['PARENT', 'users.read'],
    ['PARENT', 'announcements.publish'], ['PARENT', 'academics.read'],
    // Support roles stay in their own domain.
    ['FINANCE', 'users.manage'], ['FINANCE', 'marks.enter'], ['FINANCE', 'medical.read'],
    ['LIBRARIAN', 'fees.manage'], ['LIBRARIAN', 'medical.read'], ['LIBRARIAN', 'users.manage'],
    ['WARDEN', 'fees.manage'], ['WARDEN', 'marks.enter'], ['WARDEN', 'users.manage'],
    // Even the school administrator is not the platform administrator.
    ['ADMIN', 'permissions.manage'], ['ADMIN', 'fees.payments.refund'],
  ];

  it.each(denied)('%s may not %s', (roleKey, key) => {
    expect(can(roleKey, key)).toBe(false);
  });
});

describe('OWN scope cannot be spent as school-wide access', () => {
  it('a teacher holds the class permissions only at OWN scope', () => {
    for (const key of ['students.read', 'attendance.read', 'marks.read', 'analytics.class.read']) {
      expect(scopeOf('TEACHER', key), key).toBe('OWN');
    }
  });

  it('a family holds its record permissions only at OWN scope', () => {
    for (const roleKey of ['STUDENT', 'PARENT']) {
      for (const key of ['students.read', 'attendance.read', 'marks.read', 'fees.read']) {
        expect(scopeOf(roleKey, key), `${roleKey}.${key}`).toBe('OWN');
      }
    }
  });

  it('an OWN grant is refused by a route that demands school-wide scope', () => {
    // This is the guard that stops a parent's students.read:OWN from opening a
    // school-wide report.
    expect(can('PARENT', 'students.read')).toBe(true);
    expect(can('PARENT', 'students.read', 'ALL')).toBe(false);
    expect(can('TEACHER', 'students.read', 'ALL')).toBe(false);
    expect(can('ADMIN', 'students.read', 'ALL')).toBe(true);
  });
});

describe('requireRole gates the role-specific surfaces', () => {
  const reaches = (roleKey, ...allowedRoles) => {
    const req = { actor: { roleKey } };
    try {
      requireRole(...allowedRoles)(req, {}, () => {});
      return true;
    } catch {
      return false;
    }
  };

  it('admits the named roles and refuses the rest', () => {
    expect(reaches('TEACHER', 'TEACHER', 'PRINCIPAL')).toBe(true);
    expect(reaches('PRINCIPAL', 'TEACHER', 'PRINCIPAL')).toBe(true);
    expect(reaches('STUDENT', 'TEACHER', 'PRINCIPAL')).toBe(false);
    expect(reaches('PARENT', 'TEACHER', 'PRINCIPAL')).toBe(false);
  });
});

/**
 * The frontend mirrors the same keys for menu and button visibility. A key that
 * exists only in a component is always false — the button silently disappears
 * for every role, which is how 'assign_leads', 'create_invoice' and
 * 'record_payment' hid the CRM and fee actions from Super Admin included.
 */
describe('the frontend uses the same vocabulary as the backend', () => {
  const frontendSrc = join(process.cwd(), '..', 'frontend', 'src');

  const walk = (dir) => readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });

  const keysUsed = () => {
    const found = new Map();
    for (const file of walk(frontendSrc)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/hasAccess\([^,]+,\s*'([^']+)'\)/g)) found.set(m[1], file);
      for (const m of text.matchAll(/^\s*'\/[^']*':\s*'([^']+)',/gm)) found.set(m[1], file);
    }
    return found;
  };

  it('the scan actually finds keys, so this suite cannot pass vacuously', () => {
    expect(keysUsed().size).toBeGreaterThan(10);
  });

  it('every permission key referenced in the frontend exists in the catalog', () => {
    const unknown = [...keysUsed()]
      .filter(([key]) => !CATALOG_KEYS.has(key))
      .map(([key, file]) => `${key} (${file.split('src').pop()})`);
    expect(unknown).toEqual([]);
  });
});
