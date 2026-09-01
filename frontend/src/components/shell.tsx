'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@/components/ui';
import { portalForRole, PORTALS, ROLE_TO_SLUG, type Portal } from '@/lib/portals';
import { clearActingSchool, platformViewAllowed, useActingSchool } from '@/lib/acting-school';
import type { RoleKey } from '@/lib/types';
import { Spinner, cx } from './ui';
import { usePermissions, getRequiredPermission } from '@/lib/permissions';
import { portalHome, stripSchool, useSchoolSegment, withSchool } from '@/lib/school-path';
import { AskEduOS } from './ask-eduos';
import { NotificationBell } from './notification-bell';
import { ModalA11yBridge } from './modal-a11y-bridge';

const SIDEBAR_KEY = 'eduos.sidebar.collapsed';

/**
 * Per-role portal shell. Reads the active profile's role, renders that
 * portal's themed sidebar + nav, and exposes role switching limited to
 * profiles the account actually holds (no free links between portals).
 */
export function PortalShell({
  expectedSlug,
  topbar,
  children,
}: {
  expectedSlug: string;
  topbar: { title: string; desc?: string; actions?: React.ReactNode };
  children: React.ReactNode;
}) {
  const { loading, me } = useAuth();
  const { hasAccess } = usePermissions();
  const router = useRouter();
  const pathname = usePathname();
  // The school in the URL. Nav items are written school-less and prefixed here.
  const school = useSchoolSegment();
  // Set when a platform administrator has opened one school from the console.
  const acting = useActingSchool();

  const isPlatformAdmin = me?.profile?.role === 'SUPER_ADMIN';
  /** A platform administrator looking at the one school they opened. */
  const platformView = platformViewAllowed({
    role: me?.profile?.role,
    actingSlug: acting?.slug,
    urlSlug: school,
    portalSlug: expectedSlug,
  });
  // The platform console spans every school, so opening it drops any school
  // still in view — otherwise `X-School-Id` would quietly narrow it to one.
  //
  // Keyed on the portal alone, deliberately not on `acting`. "Open school"
  // sets the acting school and then navigates, and this console page is still
  // mounted for that render — so re-running on `acting` cleared the very
  // school the user had just opened. The school portal then loaded with none
  // set, failed platformViewAllowed(), and bounced straight back here.
  useEffect(() => {
    if (expectedSlug === 'super-admin') clearActingSchool();
  }, [expectedSlug]);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Rail preference is per-device, so it lives in localStorage rather than on
  // the profile. Read after mount to keep the server and client markup equal.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(SIDEBAR_KEY) === '1');
  }, []);

  // The tab says which school you are looking at. These pages are client-side,
  // so the server metadata in layout.tsx cannot know it — the favicon stays the
  // platform's either way.
  const tabSchool = isPlatformAdmin ? (platformView ? acting?.name ?? null : null) : me?.profile?.tenantName;
  useEffect(() => {
    document.title = tabSchool ? `${tabSchool} · EduOS AI` : 'EduOS AI';
  }, [tabSchool]);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
      return next;
    });
  };

  useEffect(() => {
    if (loading) return;
    if (!me) return router.replace('/login');
    if (!me.profile?.id || !me.profile?.role) return router.replace('/login');

    // Two things can be wrong with this URL: the portal (a teacher on /admin)
    // and the school (an Oakridge account on /nvmp/admin). The profile's own
    // school is the authority — the backend serves that school's data whatever
    // the address says, so the address is what gets corrected.
    if (platformView) return;

    const ownSchool = me.profile.tenantId ?? school;
    const slug = ROLE_TO_SLUG[me.profile.role];
    if (slug !== expectedSlug || (ownSchool && school !== ownSchool)) {
      // A platform admin who wandered off their opened school goes back to the
      // console, not to a school portal their profile does not own.
      if (isPlatformAdmin) return router.replace('/super-admin');
      router.replace(portalHome(ownSchool, me.profile.role));
    }
  }, [loading, me, router, expectedSlug, school, platformView, isPlatformAdmin]);

  useEffect(() => {
    if (loading || !me?.profile?.role || (!platformView && ROLE_TO_SLUG[me.profile.role] !== expectedSlug)) return;
    const portal = platformView ? PORTALS[expectedSlug] : portalForRole(me.profile.role);
    const cls = portal.themeClass;
    document.body.classList.add(cls);
    return () => {
      document.body.classList.remove(cls);
    };
  }, [loading, me?.profile?.role, expectedSlug, platformView]);

  if (loading || !me?.profile?.role || (!platformView && ROLE_TO_SLUG[me.profile.role] !== expectedSlug)) {
    return (
      <div className="app-shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Spinner />
      </div>
    );
  }

  const active = me.profile;
  // In a platform view the surface is the school portal being looked at, not
  // the console the signed-in profile would normally get.
  const portal = platformView ? PORTALS[expectedSlug] : portalForRole(me.profile.role);

  // Whose name goes on the sidebar and the browser tab. A Super Admin is on
  // the platform rather than in a school; everyone else is in exactly one, and
  // it must be theirs — this used to say "Oakridge Academy" on every school's
  // pages.
  const isPlatform = me.profile.role === 'SUPER_ADMIN';
  const schoolLabel = platformView
    ? acting?.name ?? 'EduOS AI'
    : isPlatform ? 'EduOS AI' : me.profile.tenantName || 'EduOS AI';

  // Feature Access Check for direct URL navigation
  const reqPerm = getRequiredPermission(stripSchool(pathname, school));
  const permissionDenied = reqPerm ? !hasAccess(active.role, reqPerm) : false;

  return (
    <div className={cx('app-shell', portal.themeClass, collapsed && 'sidebar-collapsed')}>
      <ModalA11yBridge />
      {mobileOpen && (
        // Backdrop dismissal is a mouse convenience; ModalA11yBridge supplies
        // Escape-to-close and a focus trap, and a backdrop must not be a tab stop.
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div className="sidebar-overlay" onMouseDown={(e) => e.target === e.currentTarget && (() => setMobileOpen(false))()} />
      )}
      <Sidebar
        portal={portal}
        school={school}
        schoolName={schoolLabel}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
        collapsed={collapsed}
        toggleCollapsed={toggleCollapsed}
      />
      <div className="main">
        {platformView && acting && (
          <PlatformViewBanner
            school={acting}
            onLeave={() => {
              clearActingSchool();
              router.push('/super-admin/schools');
            }}
          />
        )}
        <div className="topbar">
          <div className="topbar-headrow">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <button className="hamburger-btn" onClick={() => setMobileOpen(true)} aria-label="Open Menu">
                ☰
              </button>
              <div style={{ minWidth: 0 }}>
                {/* The page title is the document's h1 — every portal page
                    previously started at h2 or lower with no h1 at all. */}
                <h1 className="topbar-title">{topbar.title}</h1>
                {topbar.desc && <div className="topbar-desc">{topbar.desc}</div>}
              </div>
            </div>
            <div className="topbar-ask" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <NotificationBell portalSlug={expectedSlug} />
              <AskEduOS label="Ask Agent" />
            </div>
          </div>
          {topbar.actions && <div className="topbar-actions">{topbar.actions}</div>}
        </div>
        <div className="content">
          <div className="content-inner">
            {permissionDenied ? (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: '60px 24px', textAlign: 'center', minHeight: '60vh',
              }}>
                <span style={{ fontSize: 44, marginBottom: 12 }}>🔐</span>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: '#591620', marginBottom: 8 }}>Access Denied</h2>
                <p style={{ fontSize: 13.5, color: '#7a6a60', maxWidth: 360, lineHeight: 1.6 }}>
                  You do not have the required permissions to view this section. Please contact your system administrator.
                </p>
              </div>
            ) : (
              children
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Says whose data is on screen.
 *
 * A platform administrator looking at a school sees that school's portal
 * exactly as its own staff do, which is the point — and precisely why it must
 * never be mistaken for their own console. It stays put above the topbar on
 * every page of the view, and carries the way back out.
 */
function PlatformViewBanner({ school, onLeave }: { school: { slug: string; name: string }; onLeave: () => void }) {
  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        flexWrap: 'wrap', padding: '9px 20px', fontSize: 13,
        background: 'rgba(89,22,32,0.06)', borderBottom: '1px solid rgba(89,22,32,0.16)',
        color: '#591620',
      }}
    >
      <span>
        <strong style={{ fontWeight: 700 }}>Platform view</strong>
        {' — you are looking at '}
        <strong style={{ fontWeight: 700 }}>{school.name}</strong>
        <span style={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.75 }}> /{school.slug}</span>
      </span>
      <button
        type="button"
        onClick={onLeave}
        style={{
          border: '1px solid rgba(89,22,32,0.3)', background: 'transparent', color: 'inherit',
          borderRadius: 8, padding: '5px 12px', fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer',
        }}
      >
        Leave school view
      </button>
    </div>
  );
}

function Sidebar({
  portal,
  school,
  schoolName,
  mobileOpen,
  setMobileOpen,
  collapsed,
  toggleCollapsed,
}: {
  portal: Portal;
  school: string | null;
  schoolName: string;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  collapsed: boolean;
  toggleCollapsed: () => void;
}) {
  const pathname = usePathname();
  const { me } = useAuth();
  const { hasAccess } = usePermissions();
  // Nav hrefs are canonical (`/admin/users`); the school is added on render.
  const here = stripSchool(pathname, school);

  return (
    <aside className={cx('sidebar', mobileOpen && 'mobile-open')}>
      <div className="sidebar-brand">
        <div className="sidebar-logo">{schoolName.trim().charAt(0).toUpperCase() || 'E'}</div>
        <div className="sidebar-school">
          <div className="sidebar-school-name">{schoolName}</div>
          <div className="sidebar-school-sub">{portal.sublabel}</div>
        </div>
        <button className="sidebar-close-btn" onClick={() => setMobileOpen(false)} aria-label="Close Menu">
          ✕
        </button>
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span aria-hidden="true">{collapsed ? '»' : '«'}</span>
        </button>
      </div>
      <nav className="sidebar-nav" aria-label={`${portal.label} navigation`}>
        {portal.nav.map((group) => {
          const visibleItems = group.items.filter((it) => {
            const req = getRequiredPermission(it.href);
            if (!req) return true;
            return hasAccess(me?.profile?.role, req);
          });

          if (visibleItems.length === 0) return null;

          return (
            <div className="nav-group" key={group.title}>
              <div className="nav-group-label">{group.title}</div>
              {visibleItems.map((it) => {
                const isActive = here === it.href;
                const href = withSchool(school, it.href);
                const content = (
                  <>
                    <span className="nav-icon" aria-hidden>{it.icon}</span>
                    <span className="nav-label">{it.label}</span>
                    {it.badge && <span className="nav-badge">{it.badge}</span>}
                  </>
                );
                return it.ready ? (
                  <Link
                    key={it.href}
                    href={href}
                    className={cx('nav-item', isActive && 'active')}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => setMobileOpen(false)}
                    data-tooltip={it.label}
                    // With the label hidden in rail mode the icon alone is not
                    // an accessible name, so supply one explicitly.
                    aria-label={collapsed ? it.label : undefined}
                    title={collapsed ? it.label : undefined}
                  >
                    {content}
                  </Link>
                ) : (
                  // Not a link and not focusable: there is nowhere to go yet.
                  // The "soon" chip replaces a title tooltip that keyboard and
                  // touch users could never see.
                  <span key={it.href} className="nav-item not-ready" data-tooltip={`${it.label} (coming soon)`}>
                    <span className="nav-icon" aria-hidden>{it.icon}</span>
                    <span className="nav-label">{it.label}</span>
                    <span className="nav-soon">Soon</span>
                  </span>
                );
              })}
            </div>
          );
        })}
      </nav>
      <RoleSwitcher />
    </aside>
  );
}

/** Sidebar footer: profile card + logout. */
function RoleSwitcher() {
  const { me, signOut } = useAuth();

  if (!me) return null;
  const active = me.profile;

  return (
    <div className="sidebar-footer">
      <div className="profile-card" data-tooltip={active?.displayName ?? undefined}>
        <Avatar name={active?.displayName ?? ''} className="profile-card-avatar" />
        <div className="profile-card-info">
          <span className="profile-card-name">{active?.displayName}</span>
          <span className="profile-card-role">{roleLabel(active?.role)}</span>
        </div>
      </div>
      <button className="logout-btn" onClick={() => void signOut()} aria-label="Logout" title="Logout" data-tooltip="Logout">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        <span>Logout</span>
      </button>
    </div>
  );
}

const ROLE_GLYPH: Partial<Record<RoleKey, string>> = {
  SUPER_ADMIN: '🛡️', ADMIN: '🏛️', TEACHER: '👩‍🏫', PARENT: '👨‍👩‍👧', STUDENT: '🎒', PRINCIPAL: '🎓',
};
function roleLabel(role?: RoleKey | null): string {
  if (!role) return '';
  // Split on '_' so multi-word keys read as words ("SUPER_ADMIN" → "Super Admin");
  // single-word keys are unaffected.
  return role.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}
