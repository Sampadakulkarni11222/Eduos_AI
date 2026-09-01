import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PortalShell } from '@/components/shell';
import { setActingSchool, clearActingSchool, getActingSchool } from '@/lib/acting-school';

/**
 * Moving around inside a platform view.
 *
 * Opening a school puts a platform admin on that school's portal; every
 * sidebar link then goes to another page of the same portal, each of which
 * mounts its own PortalShell. Those pages must stay put — a guard that only
 * recognises the platform view on the school's dashboard bounces every other
 * tab straight back to the console.
 */

const replace = vi.fn();
const push = vi.fn();
let pathname = '/oakridge/admin';
let params: Record<string, string> = { school: 'oakridge' };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push, prefetch: vi.fn() }),
  usePathname: () => pathname,
  useParams: () => params,
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    loading: false,
    me: {
      profile: {
        id: 'p1', role: 'SUPER_ADMIN', displayName: 'Platform Owner',
        // Production's Super Admin profile carries a school of its own, left
        // over from the seed. It must not decide anything here.
        tenantId: 'oakridge', tenantName: 'Oakridge Academy',
      },
      permissions: {},
    },
    signOut: vi.fn(),
    switchProfile: vi.fn(),
    reload: vi.fn(),
  }),
}));

vi.mock('@/lib/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/permissions')>();
  return {
    ...actual,
    // A Super Admin holds the whole catalogue; the real map comes from the
    // server and is not what is under test here.
    usePermissions: () => ({ permissions: {}, hasAccess: () => true }),
  };
});

// Leaf widgets that would each pull in the API client.
vi.mock('@/components/ask-eduos', () => ({ AskEduOS: () => null }));
vi.mock('@/components/notification-bell', () => ({ NotificationBell: () => null }));

vi.mock('@/lib/api', () => ({
  api: { publicSchool: vi.fn().mockResolvedValue({ slug: 'oakridge', name: 'Oakridge Academy' }) },
  errorMessage: (_e: unknown, fallback: string) => fallback,
}));

const shell = (path: string) => {
  pathname = path;
  params = { school: 'oakridge' };
  return render(
    <PortalShell expectedSlug="admin" topbar={{ title: 'Users' }}>
      <div>page body</div>
    </PortalShell>,
  );
};

beforeEach(() => {
  replace.mockClear();
  push.mockClear();
  setActingSchool({ slug: 'oakridge', name: 'Oakridge Academy' });
});

afterEach(() => clearActingSchool());

describe('a platform admin moving between tabs of an opened school', () => {
  it('stays on the school dashboard', () => {
    shell('/oakridge/admin');
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText('page body')).toBeInTheDocument();
  });

  it('stays on a sub-page reached from the sidebar', () => {
    shell('/oakridge/admin/users');
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText('page body')).toBeInTheDocument();
  });

  it('keeps the platform-view banner on the sub-page', () => {
    shell('/oakridge/admin/users');
    expect(screen.getByText(/Platform view/)).toBeInTheDocument();
  });

  it('opens a sub-page arrived at cold — a refresh, a new tab, a pasted URL', () => {
    // Nothing in the per-tab store: this is the state every hard navigation
    // starts in, and the one that used to bounce straight to the console.
    clearActingSchool();
    shell('/oakridge/admin/users');
    expect(replace).not.toHaveBeenCalled();
  });

  it('puts the school from the address into view, so requests carry it', () => {
    clearActingSchool();
    shell('/oakridge/admin/users');
    expect(getActingSchool()?.slug).toBe('oakridge');
  });

  it('opens the console’s own tabs — schools, dashboards, audit', () => {
    // The console is school-less: /super-admin/schools has no [school] segment.
    // Production's Super Admin profile does carry a tenantId (left over from
    // the seed), and the guard compared that school against the URL's — which
    // on every console page but the dashboard is nothing at all. Result: tab 1
    // stayed put (it redirected to itself) and every other tab bounced to it.
    params = {};
    for (const path of ['/super-admin/schools', '/super-admin/dashboards', '/super-admin/audit']) {
      replace.mockClear();
      pathname = path;
      const { unmount } = render(
        <PortalShell expectedSlug="super-admin" topbar={{ title: 'Console' }}>
          <div>console body</div>
        </PortalShell>,
      );
      expect(replace, `bounced away from ${path}`).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('still sends a platform admin to the console from a per-person portal', () => {
    pathname = '/oakridge/teacher';
    render(
      <PortalShell expectedSlug="teacher" topbar={{ title: 'Teacher' }}>
        <div>page body</div>
      </PortalShell>,
    );
    expect(replace).toHaveBeenCalledWith('/super-admin');
  });
});
