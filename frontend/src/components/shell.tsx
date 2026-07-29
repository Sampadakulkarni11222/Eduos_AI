'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@/components/ui';
import { portalForRole, ROLE_TO_SLUG, type Portal } from '@/lib/portals';
import type { RoleKey } from '@/lib/types';
import { Spinner, cx } from './ui';
import { usePermissions, getRequiredPermission } from '@/lib/permissions';
import { AskEduOS } from './ask-eduos';
import { NotificationBell } from './notification-bell';

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
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!me) return router.replace('/login');
    if (!me.profile?.id || !me.profile?.role) return router.replace('/login');
    // If the active role's portal differs from this route, send them home.
    const slug = ROLE_TO_SLUG[me.profile.role];
    if (slug !== expectedSlug) router.replace(`/${slug}`);
  }, [loading, me, router, expectedSlug]);

  useEffect(() => {
    if (loading || !me?.profile?.role || ROLE_TO_SLUG[me.profile.role] !== expectedSlug) return;
    const portal = portalForRole(me.profile.role);
    const cls = portal.themeClass;
    document.body.classList.add(cls);
    return () => {
      document.body.classList.remove(cls);
    };
  }, [loading, me?.profile?.role, expectedSlug]);

  if (loading || !me?.profile?.role || ROLE_TO_SLUG[me.profile.role] !== expectedSlug) {
    return (
      <div className="app-shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Spinner />
      </div>
    );
  }

  const active = me.profile;
  const portal = portalForRole(me.profile.role);

  // Feature Access Check for direct URL navigation
  const reqPerm = getRequiredPermission(pathname);
  const permissionDenied = reqPerm ? !hasAccess(active.role, reqPerm) : false;

  return (
    <div className={cx('app-shell', portal.themeClass)}>
      {mobileOpen && (
        <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />
      )}
      <Sidebar portal={portal} schoolName={active?.displayName ?? 'Oakridge'} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
      <div className="main">
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

function Sidebar({
  portal,
  schoolName,
  mobileOpen,
  setMobileOpen,
}: {
  portal: Portal;
  schoolName: string;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}) {
  const pathname = usePathname();
  const { me } = useAuth();
  const { hasAccess } = usePermissions();

  return (
    <aside className={cx('sidebar', mobileOpen && 'mobile-open')}>
      <div className="sidebar-brand">
        <div className="sidebar-logo">O</div>
        <div className="sidebar-school">
          <div className="sidebar-school-name">{schoolName}</div>
          <div className="sidebar-school-sub">Oakridge Academy · {portal.sublabel}</div>
        </div>
        <button className="sidebar-close-btn" onClick={() => setMobileOpen(false)} aria-label="Close Menu">
          ✕
        </button>
      </div>
      <nav className="sidebar-nav">
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
                const isActive = pathname === it.href;
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
                    href={it.href}
                    className={cx('nav-item', isActive && 'active')}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => setMobileOpen(false)}
                  >
                    {content}
                  </Link>
                ) : (
                  // Not a link and not focusable: there is nowhere to go yet.
                  // The "soon" chip replaces a title tooltip that keyboard and
                  // touch users could never see.
                  <span key={it.href} className="nav-item not-ready">
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
      <div className="profile-card">
        <Avatar name={active?.displayName ?? ''} className="profile-card-avatar" />
        <div className="profile-card-info">
          <span className="profile-card-name">{active?.displayName}</span>
          <span className="profile-card-role">{roleLabel(active?.role)}</span>
        </div>
      </div>
      <button className="logout-btn" onClick={() => void signOut()}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Logout
      </button>
    </div>
  );
}

const ROLE_GLYPH: Partial<Record<RoleKey, string>> = {
  ADMIN: '🏛️', OWNER: '🏛️', TEACHER: '👩‍🏫', PARENT: '👨‍👩‍👧', STUDENT: '🎒', PRINCIPAL: '🎓',
};
function roleLabel(role?: RoleKey | null): string {
  if (!role) return '';
  return role.charAt(0) + role.slice(1).toLowerCase();
}
