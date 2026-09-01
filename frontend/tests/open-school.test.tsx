import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

/**
 * A platform administrator opening one school from the console.
 *
 * The console clears the school in view when it opens, so a cross-school screen
 * can never be quietly narrowed to one. That clear used to re-run whenever the
 * acting school *changed* — and "Open school" sets the acting school and then
 * navigates, while the console page is still mounted for that render. So the
 * console wiped the school the user had just opened, the school portal loaded
 * with none set, and the portal gate bounced them straight back to
 * /super-admin. These tests drive the real PortalShell; the pure
 * platformViewAllowed() rules are covered in platform-view.test.ts.
 */

const replace = vi.fn();
const push = vi.fn();
let pathname = '/super-admin/schools';
// useSchoolSegment() reads the [school] route param, so the tests set it the
// way the router would for /oakridge/admin.
let params: Record<string, string> = {};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push, prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => pathname,
  useParams: () => params,
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    loading: false,
    me: {
      profile: {
        id: 'p1', role: 'SUPER_ADMIN',
        tenantId: null, tenantName: null, displayName: 'Platform Admin',
      },
      permissions: {},
    },
    logout: vi.fn(),
  }),
}));

vi.mock('@/lib/permissions', () => ({
  usePermissions: () => ({ permissions: {}, hasAccess: () => true }),
  getRequiredPermission: () => null,
}));

// Chrome that reaches the network or needs its own providers; not under test.
vi.mock('@/components/ask-eduos', () => ({ AskEduOS: () => null }));
vi.mock('@/components/notification-bell', () => ({ NotificationBell: () => null }));
vi.mock('@/components/modal-a11y-bridge', () => ({ ModalA11yBridge: () => null }));
vi.mock('@/lib/api', () => ({
  api: { publicSchool: vi.fn().mockImplementation((slug: string) => Promise.resolve({ slug, name: slug })) },
  errorMessage: (_e: unknown, fallback: string) => fallback,
}));

const { PortalShell } = await import('@/components/shell');
const { setActingSchool, getActingSchool, clearActingSchool } =
  await import('@/lib/acting-school');

const shell = (expectedSlug: string) => (
  <PortalShell expectedSlug={expectedSlug} topbar={{ title: 'T' }}>
    <div>content</div>
  </PortalShell>
);

beforeEach(() => {
  replace.mockClear();
  push.mockClear();
  clearActingSchool();
  pathname = '/super-admin/schools';
  params = {};
});

afterEach(() => clearActingSchool());

describe('opening a school from the console', () => {
  it('keeps the school the console just opened', async () => {
    render(shell('super-admin'));
    // The console has mounted and dropped any stale school. Now "Open school".
    setActingSchool({ slug: 'oakridge', name: 'Oakridge' });

    await waitFor(() => {
      expect(getActingSchool()?.slug).toBe('oakridge');
    });
    // Regression: the console used to clear this on the same render.
    expect(getActingSchool()).not.toBeNull();
  });

  it('drops a stale school when the console itself is opened', () => {
    setActingSchool({ slug: 'oakridge', name: 'Oakridge' });
    render(shell('super-admin'));
    expect(getActingSchool()).toBeNull();
  });
});

describe('the school portal accepts the platform view', () => {
  it('does not bounce a platform admin out of the school they opened', async () => {
    setActingSchool({ slug: 'oakridge', name: 'Oakridge' });
    pathname = '/oakridge/admin';
    params = { school: 'oakridge' };

    render(shell('admin'));

    await waitFor(() => expect(replace).not.toHaveBeenCalled());
    expect(getActingSchool()?.slug).toBe('oakridge');
  });

  it('follows the address to another school rather than bouncing', async () => {
    // The URL is the authority now: a platform admin who types, bookmarks or
    // is linked to another school's portal is looking at that school, and the
    // school in view moves to match so its data — not the previous school's —
    // is what loads. Requiring the two to agree in advance is what made every
    // hard navigation (refresh, new tab, pasted link) bounce to the console.
    setActingSchool({ slug: 'oakridge', name: 'Oakridge' });
    pathname = '/nvmp/admin';
    params = { school: 'nvmp' };

    render(shell('admin'));

    await waitFor(() => expect(getActingSchool()?.slug).toBe('nvmp'));
    expect(replace).not.toHaveBeenCalled();
  });

  it('opens a school portal reached cold, with nothing in the per-tab store', async () => {
    clearActingSchool();
    pathname = '/oakridge/admin/users';
    params = { school: 'oakridge' };

    render(shell('admin'));

    await waitFor(() => expect(getActingSchool()?.slug).toBe('oakridge'));
    expect(replace).not.toHaveBeenCalled();
  });
});
