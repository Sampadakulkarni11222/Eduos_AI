import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  platformViewAllowed, PLATFORM_VIEW_PORTALS, setActingSchool, getActingSchool, clearActingSchool,
} from '@/lib/acting-school';
import { invalidateCache } from '@/lib/cache';

let invalidated = 0;
vi.mock('@/lib/cache', () => ({ invalidateCache: vi.fn(() => { invalidated += 1; }) }));
void invalidateCache;

beforeEach(() => { clearActingSchool(); invalidated = 0; });
afterEach(() => clearActingSchool());

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

  it('admits whichever school the address names', () => {
    // The decision is the URL's, so a pasted address, a new tab and a refresh
    // all work — none of them carry the per-tab store that once decided it.
    expect(view({ urlSlug: 'nvmp' })).toBe(true);
  });

  it('refuses a page that names no school at all', () => {
    expect(view({ urlSlug: null })).toBe(false);
    expect(view({ urlSlug: undefined })).toBe(false);
    expect(view({ urlSlug: '' })).toBe(false);
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

describe('switching the school in view', () => {
  it('drops the read cache when the school changes', () => {
    setActingSchool({ slug: 'oakridge', name: 'Oakridge Academy' });
    invalidated = 0;
    setActingSchool({ slug: 'nvmp', name: 'NVMP School' });
    expect(invalidated).toBe(1);
  });

  it('keeps it when only the name is filled in', () => {
    // Arriving by URL, the slug stands in for the name until the API answers.
    // That correction is cosmetic: dropping the cache for it made every page
    // reload its data a second after it had finished loading.
    setActingSchool({ slug: 'oakridge', name: 'oakridge' });
    invalidated = 0;
    setActingSchool({ slug: 'oakridge', name: 'Oakridge Academy' });
    expect(invalidated).toBe(0);
    expect(getActingSchool()?.name).toBe('Oakridge Academy');
  });
});
