import { describe, it, expect } from 'vitest';
import { getRequiredPermission, ROUTE_PERMISSIONS } from '@/lib/permissions';
import { ROLE_TO_SLUG, portalForRole } from '@/lib/portals';
import type { RoleKey } from '@/lib/types';

/**
 * The client half of the authorization layer.
 *
 * It decides menu and page visibility only — the backend enforces the same
 * keys on every route regardless — so what matters here is that it asks about
 * the *same* keys and never lets a role render another role's portal.
 */

describe('route → permission mapping', () => {
  it('matches a page and everything nested under it', () => {
    expect(getRequiredPermission('/admin/audit')).toBe('audit.read');
    expect(getRequiredPermission('/admin/audit/2026-01')).toBe('audit.read');
  });

  it('does not match a route that merely shares a prefix', () => {
    expect(getRequiredPermission('/admin/auditors')).toBeNull();
  });

  it('leaves unmapped routes to the portal gate and the backend', () => {
    expect(getRequiredPermission('/teacher/attendance')).toBeNull();
  });

  it('guards the platform surface with the Super-Admin-only key', () => {
    expect(getRequiredPermission('/super-admin/schools')).toBe('schools.read');
  });
});

describe('the portal gate', () => {
  const ROLES: RoleKey[] = [
    'SUPER_ADMIN', 'ADMIN', 'PRINCIPAL', 'TEACHER',
    'PARENT', 'STUDENT', 'FINANCE', 'LIBRARIAN', 'WARDEN',
  ];

  it('gives every role exactly one portal', () => {
    for (const role of ROLES) {
      expect(ROLE_TO_SLUG[role], `${role} has no portal`).toBeTruthy();
      expect(portalForRole(role).slug).toBe(ROLE_TO_SLUG[role]);
    }
  });

  it('no two roles share a portal, so a slug names one role', () => {
    const slugs = ROLES.map((r) => ROLE_TO_SLUG[r]);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  /**
   * PortalShell renders only when ROLE_TO_SLUG[role] === expectedSlug, which is
   * what turns a hand-typed cross-portal URL into a redirect home.
   */
  it('admits a role to its own portal and refuses every other', () => {
    const admitted = (role: RoleKey, expectedSlug: string) => ROLE_TO_SLUG[role] === expectedSlug;

    expect(admitted('STUDENT', 'student')).toBe(true);
    expect(admitted('STUDENT', 'teacher')).toBe(false);
    expect(admitted('STUDENT', 'admin')).toBe(false);
    expect(admitted('TEACHER', 'admin')).toBe(false);
    expect(admitted('PARENT', 'principal')).toBe(false);
    expect(admitted('ADMIN', 'super-admin')).toBe(false);
    expect(admitted('SUPER_ADMIN', 'super-admin')).toBe(true);
  });
});

describe('the keys the client asks about', () => {
  it('are dotted catalog keys, never invented snake_case ones', () => {
    // 'assign_leads', 'create_invoice' and 'record_payment' were keys no role
    // could ever hold, so those actions were hidden from everyone.
    for (const key of Object.values(ROUTE_PERMISSIONS)) {
      expect(key, `"${key}" is not a catalog-shaped key`).toMatch(/^[a-z]+(\.[a-z]+)+$/);
    }
  });
});
