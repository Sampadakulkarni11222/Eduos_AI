'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { getRequiredPermission, usePermissions } from '@/lib/permissions';
import type { Portal } from '@/lib/portals';
import { stripSchool, withSchool } from '@/lib/school-path';
import {
  activeItem, bottomBarSpaces, buildNavModel, defaultShortcuts, isSingleLink, spaceOf,
  type NavModel, type NavSpace, type SpaceItem,
} from '@/lib/nav-spaces';
import {
  browserStorage, loadFlags, loadRecent, loadShortcuts, moveShortcut, prefsScope,
  recentToShow, recordRecent, saveFlags, saveShortcuts, togglePin,
} from '@/lib/nav-prefs';
import { openUniversalSearch } from '@/components/universal-search';
import { cx } from '@/components/ui';

/**
 * The sidebar, organised into spaces.
 *
 * Top to bottom: "Jump to…" (universal search), My shortcuts, Recent, then the
 * role's spaces as an accordion, then a small footer (User Guide, collapse).
 * Collapsed, it becomes an icon rail whose space icons open a flyout. On a
 * phone the same spaces fill the drawer, and a bottom bar carries Home, the
 * role's key spaces and "More".
 */

// ── Model and preferences ────────────────────────────────────────────────

/** The portal's menu as this person may see it, sorted into spaces. */
export function useNavModel(portal: Portal): NavModel {
  const { me } = useAuth();
  const { hasAccess } = usePermissions();
  const role = me?.profile?.role;
  // Keyed on what is actually visible, so a fresh hasAccess function (a new
  // permissions object, a re-render) does not rebuild the model and re-run
  // every effect that depends on it.
  const visibleKey = portal.nav
    .flatMap((g) => g.items.map((i) => i.href))
    .filter((href) => { const req = getRequiredPermission(href); return !req || hasAccess(role, req); })
    .join('|');
  return useMemo(() => {
    const visible = new Set(visibleKey.split('|'));
    return buildNavModel(portal, (href) => visible.has(href));
  }, [portal, visibleKey]);
}

function useHere(school: string | null): string {
  const pathname = usePathname() ?? '';
  return stripSchool(pathname, school);
}

/** Matches a CSS media query; false where matchMedia is unavailable (tests, SSR). */
function useMedia(query: string): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(query);
    const update = () => setOn(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, [query]);
  return on;
}

function useNavPrefs(portal: Portal, model: NavModel, school: string | null, current: SpaceItem | null) {
  const { me } = useAuth();
  const scope = prefsScope(school, me?.profile?.id);
  const visible = useMemo(() => new Set(model.all.map((i) => i.href)), [model]);
  const defaults = useMemo(() => defaultShortcuts(portal.slug, model), [portal.slug, model]);
  const activeSpace = spaceOf(model, current?.href)?.id ?? null;

  // Defaults on the first render (server and client agree), stored values after mount.
  const [shortcuts, setShortcuts] = useState<string[]>(defaults);
  const [recent, setRecent] = useState<string[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>(activeSpace ? { [activeSpace]: true } : {});
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const storage = browserStorage();
    setShortcuts(loadShortcuts(storage, scope, defaults, visible));
    const storedOpen = loadFlags(storage, scope, 'open');
    // The space holding the page on screen always opens; the rest stay as left.
    setOpen(activeSpace ? { ...storedOpen, [activeSpace]: true } : storedOpen);
    setShowAll(loadFlags(storage, scope, 'showall'));
    setRecent(current ? recordRecent(storage, scope, current.href) : loadRecent(storage, scope));
  }, [scope, defaults, visible, activeSpace, current]);

  const pin = useCallback((href: string) => {
    setShortcuts((list) => {
      const next = togglePin(list, href);
      saveShortcuts(browserStorage(), scope, next);
      return next;
    });
  }, [scope]);
  const move = useCallback((href: string, dir: -1 | 1) => {
    setShortcuts((list) => {
      const next = moveShortcut(list, href, dir);
      saveShortcuts(browserStorage(), scope, next);
      return next;
    });
  }, [scope]);
  const toggleSpace = useCallback((id: string) => {
    setOpen((flags) => {
      const next = { ...flags, [id]: !flags[id] };
      saveFlags(browserStorage(), scope, 'open', next);
      return next;
    });
  }, [scope]);
  const toggleShowAll = useCallback((id: string) => {
    setShowAll((flags) => {
      const next = { ...flags, [id]: !flags[id] };
      saveFlags(browserStorage(), scope, 'showall', next);
      return next;
    });
  }, [scope]);

  return {
    shortcuts, recent: recentToShow(recent, current?.href ?? null, shortcuts, visible),
    open, showAll, activeSpace, pin, move, toggleSpace, toggleShowAll,
  };
}

// ── Pieces ───────────────────────────────────────────────────────────────

/** Up/Down/Home/End move between the links of one list; Tab still leaves it. */
function onListKey(e: React.KeyboardEvent<HTMLElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const list = (e.currentTarget as HTMLElement).closest('[data-snav-list]');
  if (!list) return;
  const links = Array.from(list.querySelectorAll<HTMLElement>('a.nav-item'));
  const i = links.indexOf(e.currentTarget as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  const j = e.key === 'Home' ? 0 : e.key === 'End' ? links.length - 1 : e.key === 'ArrowDown' ? Math.min(links.length - 1, i + 1) : Math.max(0, i - 1);
  links[j]?.focus();
}

function ItemLink({
  it, school, active, onNavigate, label, icon, className, railLabel,
}: {
  it: SpaceItem; school: string | null; active: boolean; onNavigate?: () => void; label?: string;
  /** Overrides the page's icon (a one-page space shows the space's icon). */
  icon?: string;
  className?: string;
  /** Icon-only rail: the accessible name and tooltip. */
  railLabel?: string;
}) {
  const content = (
    <>
      <span className="nav-icon" aria-hidden>{icon ?? it.icon}</span>
      <span className="nav-label">{label ?? it.label}</span>
      {it.badge && <span className="nav-badge">{it.badge}</span>}
    </>
  );
  if (!it.ready) {
    // Not a link and not focusable: there is nowhere to go yet.
    return (
      <span className="nav-item not-ready">
        {content}
        <span className="nav-soon">Soon</span>
      </span>
    );
  }
  return (
    <Link
      href={withSchool(school, it.href)}
      // Portal pages are client components under the dynamic [school] segment;
      // prefetching them whole makes the switch immediate.
      prefetch
      className={cx('nav-item', className, active && 'active')}
      aria-current={active ? 'page' : undefined}
      aria-label={railLabel}
      data-tooltip={railLabel}
      onClick={onNavigate}
      onKeyDown={onListKey}
    >
      {content}
    </Link>
  );
}

function StarButton({ it, pinned, onToggle }: { it: SpaceItem; pinned: boolean; onToggle: (href: string) => void }) {
  return (
    <button
      type="button"
      className={cx('snav-star', pinned && 'is-pinned')}
      aria-pressed={pinned}
      aria-label={pinned ? `Remove ${it.label} from shortcuts` : `Add ${it.label} to shortcuts`}
      title={pinned ? 'Remove from shortcuts' : 'Add to shortcuts'}
      onClick={() => onToggle(it.href)}
    >
      <span aria-hidden="true">{pinned ? '★' : '☆'}</span>
    </button>
  );
}

/** One space's pages: essentials, then "Show all (n)" for the rest. */
function SpaceList({
  space, school, currentHref, shortcuts, onPin, showAll, onToggleShowAll, onNavigate, idPrefix,
}: {
  space: NavSpace; school: string | null; currentHref: string | null; shortcuts: string[];
  onPin?: (href: string) => void; showAll: boolean; onToggleShowAll: () => void; onNavigate?: () => void; idPrefix: string;
}) {
  // A page on screen that lives behind "Show all" is never hidden.
  const restHasCurrent = space.rest.some((i) => i.href === currentHref);
  const expanded = showAll || restHasCurrent;
  const shown = expanded ? space.items : space.essentials;
  return (
    <>
      <ul className="snav-list" data-snav-list id={`${idPrefix}-list`}>
        {shown.map((it) => (
          <li key={it.href} className="snav-row">
            <ItemLink it={it} school={school} active={it.href === currentHref} onNavigate={onNavigate} />
            {onPin && it.ready && <StarButton it={it} pinned={shortcuts.includes(it.href)} onToggle={onPin} />}
          </li>
        ))}
      </ul>
      {space.rest.length > 0 && !restHasCurrent && (
        <button
          type="button"
          className="snav-more"
          aria-expanded={expanded}
          aria-controls={`${idPrefix}-list`}
          onClick={onToggleShowAll}
        >
          {expanded ? 'Show fewer' : `Show all (${space.items.length})`}
        </button>
      )}
    </>
  );
}

// ── Flyout (icon rail) ───────────────────────────────────────────────────

type FlyState = { id: string; top: number; viaKeyboard: boolean } | null;

function Flyout({
  fly, title, children, onEnter, onLeave, onClose,
}: { fly: NonNullable<FlyState>; title: string; children: React.ReactNode; onEnter: () => void; onLeave: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (fly.viaKeyboard) ref.current?.querySelector<HTMLElement>('a.nav-item, button')?.focus();
  }, [fly]);
  const maxH = typeof window !== 'undefined' ? window.innerHeight - 16 : 600;
  const top = Math.max(8, Math.min(fly.top, maxH - 280));
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- hover keeps the flyout open; Escape closes it for keyboard users
    <div
      ref={ref}
      id={`snav-fly-${fly.id}`}
      className="snav-flyout"
      role="group"
      aria-label={title}
      style={{ top, maxHeight: maxH - top }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
    >
      <div className="snav-flyout-title">{title}</div>
      {children}
    </div>
  );
}

// ── Sidebar ──────────────────────────────────────────────────────────────

export function SidebarNav({
  portal, school, collapsed, toggleCollapsed, onNavigate,
}: {
  portal: Portal;
  school: string | null;
  collapsed: boolean;
  toggleCollapsed: () => void;
  /** Called when a link is followed (closes the phone drawer). */
  onNavigate?: () => void;
}) {
  const model = useNavModel(portal);
  const here = useHere(school);
  const current = useMemo(() => activeItem(model.all, here), [model, here]);
  const prefs = useNavPrefs(portal, model, school, current);
  // The rail is a desktop affordance; the drawer below 900px always has labels.
  const narrow = useMedia('(max-width: 900px)');
  const rail = collapsed && !narrow;
  const [editing, setEditing] = useState(false);
  const uid = useId().replace(/:/g, '');
  const byHref = useMemo(() => new Map(model.all.map((i) => [i.href, i])), [model]);
  const canSearch = portal.slug !== 'super-admin';
  const help = model.footer[0];
  const currentHref = current?.href ?? null;

  // Rail flyout.
  const [fly, setFly] = useState<FlyState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const openFly = (id: string, el: HTMLElement, viaKeyboard = false) => {
    clear();
    setFly({ id, top: el.getBoundingClientRect().top, viaKeyboard });
  };
  const later = (fn: () => void, ms: number) => { clear(); timer.current = setTimeout(fn, ms); };
  const closeFly = useCallback((refocus = false) => {
    setFly((f) => {
      if (refocus && f) document.getElementById(`snav-rail-${f.id}`)?.focus();
      return null;
    });
  }, []);
  useEffect(() => () => clear(), []);
  useEffect(() => {
    if (!fly) return undefined;
    const outside = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest('.snav-flyout') || t?.closest('.snav-rail-btn')) return;
      setFly(null);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [fly]);
  useEffect(() => { if (!rail) setFly(null); }, [rail]);

  const shortcutItems = prefs.shortcuts.map((h) => byHref.get(h)).filter((i): i is SpaceItem => Boolean(i));
  const recentItems = prefs.recent.map((h) => byHref.get(h)).filter((i): i is SpaceItem => Boolean(i));

  const navLabel = `${portal.label} navigation`;

  // Bring the page on screen into view inside its open space: shortcuts and
  // recent pages can push it below the fold of a short sidebar or the drawer.
  //
  // This nav remounts fresh on every navigation (no shared layout wraps the
  // portals), so on mount only the active space is open at first; any other
  // spaces the user had open get restored a moment later from storage. That
  // second reopen can shift everything below it, undoing a scroll we already
  // made. Re-running this once the restored set of open spaces settles (via
  // the `prefs.open` dependency) re-aims the scroll at the final layout
  // instead of a stale one, without changing routing or layout structure.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>('.snav-panel a[aria-current="page"]');
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [currentHref, rail, prefs.open]);

  if (rail) {
    const railButton = (id: string, icon: string, label: string, extra?: string) => (
      <button
        key={id}
        id={`snav-rail-${id}`}
        type="button"
        className={cx('nav-item snav-rail-btn', extra)}
        aria-label={label}
        aria-expanded={fly?.id === id}
        aria-controls={fly?.id === id ? `snav-fly-${id}` : undefined}
        data-tooltip={fly?.id === id ? undefined : label}
        onMouseEnter={(e) => { const el = e.currentTarget; later(() => openFly(id, el), 120); }}
        onMouseLeave={() => later(() => setFly(null), 220)}
        onClick={(e) => (fly?.id === id ? setFly(null) : openFly(id, e.currentTarget, e.detail === 0))}
      >
        <span className="nav-icon" aria-hidden>{icon}</span>
      </button>
    );
    const flySpace = fly ? model.spaces.find((s) => s.id === fly.id) : null;
    return (
      <>
        <nav className="sidebar-nav snav snav-rail" aria-label={navLabel}>
          {canSearch && (
            <button type="button" className="nav-item snav-rail-btn" aria-label="Jump to a page (Ctrl+K)" data-tooltip="Jump to… (Ctrl+K)" onClick={openUniversalSearch}>
              <span className="nav-icon" aria-hidden>⌕</span>
            </button>
          )}
          {shortcutItems.length > 0 && railButton('shortcuts', '★', 'My shortcuts')}
          <div className="snav-rail-sep" aria-hidden="true" />
          {model.spaces.map((s) => (isSingleLink(s) ? (
            // One page: a direct link, no flyout.
            <ItemLink
              key={s.id} it={s.items[0]} school={school} active={s.items[0].href === currentHref}
              icon={s.icon} className="snav-rail-btn snav-single" railLabel={s.items[0].label}
            />
          ) : railButton(s.id, s.icon, `${s.label} (${s.items.length})`, prefs.activeSpace === s.id ? 'active' : undefined)))}
        </nav>
        {fly && (
          <Flyout
            fly={fly}
            title={flySpace ? flySpace.label : 'My shortcuts'}
            onEnter={clear}
            onLeave={() => later(() => setFly(null), 220)}
            onClose={() => closeFly(true)}
          >
            {flySpace ? (
              <SpaceList
                space={flySpace} school={school} currentHref={currentHref} shortcuts={prefs.shortcuts}
                onPin={prefs.pin} showAll={Boolean(prefs.showAll[flySpace.id])} onToggleShowAll={() => prefs.toggleShowAll(flySpace.id)}
                onNavigate={() => setFly(null)} idPrefix={`${uid}-fly-${flySpace.id}`}
              />
            ) : (
              <ul className="snav-list" data-snav-list>
                {shortcutItems.map((it) => (
                  <li key={it.href} className="snav-row">
                    <ItemLink it={it} school={school} active={it.href === currentHref} onNavigate={() => setFly(null)} />
                  </li>
                ))}
              </ul>
            )}
          </Flyout>
        )}
        <div className="snav-foot">
          {help && (
            <Link href={withSchool(school, help.href)} className={cx('nav-item snav-foot-link', currentHref === help.href && 'active')} aria-current={currentHref === help.href ? 'page' : undefined} aria-label={help.label} data-tooltip={help.label}>
              <span className="nav-icon" aria-hidden>{help.icon}</span>
            </Link>
          )}
          <button type="button" className="nav-item snav-foot-link snav-collapse" onClick={toggleCollapsed} aria-label="Expand sidebar" aria-expanded={false} data-tooltip="Expand sidebar">
            <span className="nav-icon" aria-hidden>»</span>
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <nav ref={navRef} className="sidebar-nav snav" aria-label={navLabel}>
        {canSearch && (
          <button type="button" className="snav-jump" onClick={openUniversalSearch} aria-label="Jump to a page or record (Ctrl+K)">
            <span aria-hidden="true" className="snav-jump-glyph">⌕</span>
            <span className="snav-jump-text">Jump to…</span>
            <kbd aria-hidden="true">Ctrl K</kbd>
          </button>
        )}

        <section className="snav-section" aria-labelledby={`${uid}-sc`}>
          <div className="snav-heading">
            <h2 id={`${uid}-sc`}>My shortcuts</h2>
            {shortcutItems.length > 0 && (
              <button type="button" className="snav-edit" aria-pressed={editing} onClick={() => setEditing((v) => !v)}>
                {editing ? 'Done' : 'Edit'}
              </button>
            )}
          </div>
          {shortcutItems.length === 0 ? (
            <p className="snav-hint">Tap ☆ beside any page to keep it here.</p>
          ) : (
            <ul className="snav-list" data-snav-list>
              {shortcutItems.map((it, i) => (
                <li key={it.href} className={cx('snav-row', editing && 'is-editing')}>
                  <ItemLink it={it} school={school} active={it.href === currentHref} onNavigate={onNavigate} />
                  {editing && (
                    <span className="snav-tools">
                      <button type="button" className="snav-tool" aria-label={`Move ${it.label} up`} disabled={i === 0} onClick={() => prefs.move(it.href, -1)}>↑</button>
                      <button type="button" className="snav-tool" aria-label={`Move ${it.label} down`} disabled={i === shortcutItems.length - 1} onClick={() => prefs.move(it.href, 1)}>↓</button>
                      <button type="button" className="snav-tool" aria-label={`Remove ${it.label} from shortcuts`} onClick={() => prefs.pin(it.href)}>✕</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {recentItems.length > 0 && (
          <section className="snav-section" aria-labelledby={`${uid}-rc`}>
            <div className="snav-heading"><h2 id={`${uid}-rc`}>Recent</h2></div>
            <ul className="snav-list" data-snav-list>
              {recentItems.map((it) => (
                <li key={it.href} className="snav-row">
                  <ItemLink it={it} school={school} active={false} onNavigate={onNavigate} />
                  <StarButton it={it} pinned={prefs.shortcuts.includes(it.href)} onToggle={prefs.pin} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="snav-section snav-spaces" aria-labelledby={`${uid}-sp`}>
          <div className="snav-heading"><h2 id={`${uid}-sp`}>Browse</h2></div>
          {model.spaces.map((space) => {
            if (isSingleLink(space)) {
              // A space with one page for this role is just that page.
              const it = space.items[0];
              return (
                <div key={space.id} className="snav-space snav-single">
                  <div className="snav-row">
                    <ItemLink it={it} school={school} active={it.href === currentHref} onNavigate={onNavigate} icon={space.icon} />
                    {it.ready && <StarButton it={it} pinned={prefs.shortcuts.includes(it.href)} onToggle={prefs.pin} />}
                  </div>
                </div>
              );
            }
            const idPrefix = `${uid}-${space.id}`;
            const isOpen = Boolean(prefs.open[space.id]);
            const holdsCurrent = prefs.activeSpace === space.id;
            return (
              <div key={space.id} className={cx('snav-space', isOpen && 'is-open', holdsCurrent && 'holds-current')}>
                <button
                  type="button"
                  className="snav-space-btn"
                  aria-expanded={isOpen}
                  aria-controls={`${idPrefix}-panel`}
                  onClick={() => prefs.toggleSpace(space.id)}
                >
                  <span className="nav-icon" aria-hidden>{space.icon}</span>
                  <span className="snav-space-label">{space.label}</span>
                  <span className="snav-count" aria-label={`${space.items.length} pages`}>{space.items.length}</span>
                  <span className="snav-chev" aria-hidden="true">▸</span>
                </button>
                {isOpen && (
                  <div id={`${idPrefix}-panel`} className="snav-panel">
                    <SpaceList
                      space={space} school={school} currentHref={currentHref} shortcuts={prefs.shortcuts}
                      onPin={prefs.pin} showAll={Boolean(prefs.showAll[space.id])}
                      onToggleShowAll={() => prefs.toggleShowAll(space.id)} onNavigate={onNavigate} idPrefix={idPrefix}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </nav>
      <div className="snav-foot">
        {help && (
          <Link href={withSchool(school, help.href)} onClick={onNavigate} className={cx('nav-item snav-foot-link', currentHref === help.href && 'active')} aria-current={currentHref === help.href ? 'page' : undefined}>
            <span className="nav-icon" aria-hidden>{help.icon}</span>
            <span className="nav-label">{help.label}</span>
          </Link>
        )}
        <button type="button" className="nav-item snav-foot-link snav-collapse" onClick={toggleCollapsed} aria-label="Collapse sidebar" aria-expanded>
          <span className="nav-icon" aria-hidden>«</span>
          <span className="nav-label">Collapse</span>
        </button>
      </div>
    </>
  );
}

// ── Phone bottom bar ─────────────────────────────────────────────────────

/**
 * Home, the role's two or three key spaces and "More" (the drawer). A space
 * opens a sheet of its pages; it is hidden above 768px by CSS.
 */
export function MobileBottomBar({ portal, school, onMore }: { portal: Portal; school: string | null; onMore: () => void }) {
  const model = useNavModel(portal);
  const here = useHere(school);
  const current = useMemo(() => activeItem(model.all, here), [model, here]);
  const spaces = useMemo(() => bottomBarSpaces(portal.slug, model), [portal.slug, model]);
  const currentSpace = spaceOf(model, current?.href)?.id ?? null;
  const [sheet, setSheet] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const home = model.all.find((i) => i.key === '');
  const sheetSpace = spaces.find((s) => s.id === sheet) ?? null;
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!sheet) return undefined;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheet(null); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [sheet]);
  useEffect(() => {
    if (sheet) document.querySelector<HTMLElement>('.snav-sheet a.nav-item')?.focus();
    else openerRef.current?.focus?.();
  }, [sheet]);

  return (
    <>
      {sheetSpace && (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- tapping outside closes; Escape closes for keyboards
        <div className="snav-sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setSheet(null); }}>
          <div className="snav-sheet" role="dialog" aria-modal="true" aria-label={sheetSpace.label}>
            <div className="snav-sheet-head">
              <span className="snav-sheet-title">{sheetSpace.label}</span>
              <button type="button" className="snav-sheet-close" onClick={() => setSheet(null)} aria-label="Close">✕</button>
            </div>
            <SpaceList
              space={sheetSpace} school={school} currentHref={current?.href ?? null} shortcuts={[]}
              showAll={showAll} onToggleShowAll={() => setShowAll((v) => !v)} onNavigate={() => setSheet(null)} idPrefix={`sheet-${sheetSpace.id}`}
            />
          </div>
        </div>
      )}
      <nav className="snav-bottom" aria-label="Quick navigation">
        {home && (
          <Link href={withSchool(school, home.href)} className={cx('snav-bottom-item', currentSpace === 'home' && 'active')} aria-current={current?.href === home.href ? 'page' : undefined}>
            <span aria-hidden="true" className="snav-bottom-icon">⌂</span>
            <span className="snav-bottom-label">Home</span>
          </Link>
        )}
        {spaces.map((s) => (isSingleLink(s) ? (
          <Link
            key={s.id}
            href={withSchool(school, s.items[0].href)}
            className={cx('snav-bottom-item', currentSpace === s.id && 'active')}
            aria-current={current?.href === s.items[0].href ? 'page' : undefined}
          >
            <span aria-hidden="true" className="snav-bottom-icon">{s.icon}</span>
            <span className="snav-bottom-label">{shortLabel(s.items[0].label)}</span>
          </Link>
        ) : (
          <button
            key={s.id}
            type="button"
            className={cx('snav-bottom-item', currentSpace === s.id && 'active')}
            aria-haspopup="dialog"
            aria-expanded={sheet === s.id}
            onClick={(e) => { openerRef.current = e.currentTarget; setShowAll(false); setSheet(sheet === s.id ? null : s.id); }}
          >
            <span aria-hidden="true" className="snav-bottom-icon">{s.icon}</span>
            <span className="snav-bottom-label">{shortLabel(s.label)}</span>
          </button>
        )))}
        <button type="button" className="snav-bottom-item" onClick={() => { setSheet(null); onMore(); }} aria-label="More: open the full menu">
          <span aria-hidden="true" className="snav-bottom-icon">☰</span>
          <span className="snav-bottom-label">More</span>
        </button>
      </nav>
    </>
  );
}

/** "Teaching & Learning" → "Teaching": the bar has room for one word. */
export function shortLabel(label: string): string {
  const first = label.split(/\s*&\s*/)[0];
  return first === 'Administration' ? 'Admin' : first;
}
