import { describe, it, expect } from 'vitest';
import { platformViewAllowed, PLATFORM_VIEW_PORTALS } from '@/lib/acting-school';

/**
 * Who may look at a school through a school portal.
 *
 * A platform administrator belongs to no school, so the ordinary portal test
 * ("this portal is your role's, and this school is yours") cannot admit them
 * to the screens the console sends them to. This is what stands in for it —
 * and, just as importantly, what it must never admit: a school account
 * cannot reach another school by setting a school in view, because the
 * backend derives their school from their own profile and never reads the
 * header (see backend/tests/platformView.scope.test.js).
 */

const view = (over: Partial<Parameters<typeof platformViewAllowed>[0]> = {}) =>
  platformViewAllowed({
    role: 'SUPER_ADMIN',
    actingSlug: 'oakridge',
    urlSlug: 'oakridge',
    portalSlug: 'admin',
    ...over,
  });

describe('platform view', () => {
  it('admits a platform admin to the school they opened', () => {
    expect(view()).toBe(true);
  });

  it('covers every school-wide portal', () => {
    for (const portalSlug of PLATFORM_VIEW_PORTALS) {
      expect(view({ portalSlug })).toBe(true);
    }
  });

  it('refuses the per-person portals, which hold one signed-in person’s own data', () => {
    for (const portalSlug of ['teacher', 'student', 'parent']) {
      expect(view({ portalSlug })).toBe(false);
    }
  });

  it('refuses a school whose address is not the one that was opened', () => {
    expect(view({ urlSlug: 'nvmp' })).toBe(false);
  });

  it('refuses when no school has been opened', () => {
    expect(view({ actingSlug: null })).toBe(false);
    expect(view({ actingSlug: undefined })).toBe(false);
  });

  it('refuses every school-level role, whatever school is in view', () => {
    for (const role of ['ADMIN', 'PRINCIPAL', 'TEACHER', 'FINANCE', 'WARDEN', 'LIBRARIAN']) {
      expect(view({ role })).toBe(false);
    }
  });

  it('refuses a signed-out visitor', () => {
    expect(view({ role: null })).toBe(false);
    expect(view({ role: undefined })).toBe(false);
  });
});
