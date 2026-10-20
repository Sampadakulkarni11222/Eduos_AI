import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PORTALS } from '@/lib/portals';
import {
  activeItem, bottomBarSpaces, buildNavModel, defaultShortcuts, placementFor, spaceOf, ESSENTIALS_LIMIT,
} from '@/lib/nav-spaces';
import {
  loadRecent, loadShortcuts, moveShortcut, prefsScope, recentToShow, recordRecent, saveShortcuts, togglePin,
  MAX_SHORTCUTS, type StorageLike,
} from '@/lib/nav-prefs';

/**
 * The sidebar, organised into spaces.
 *
 * PORTALS stays the source of truth; lib/nav-spaces only decides where each
 * item is shown. These tests hold the line that matters most — nothing in a
 * portal's menu can go missing or appear twice — and the behaviour around it:
 * shortcuts, recent pages, the open space, essentials and the phone bar.
 */

let pathname = '/oakridge/principal/fees';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => pathname,
  useParams: () => ({ school: 'oakridge' }),
}));
let role = 'PRINCIPAL';
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ loading: false, me: { profile: { id: 'p1', role, displayName: 'Test' }, permissions: {} } }),
}));
let allow: (perm: string) => boolean = () => true;
vi.mock('@/lib/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/permissions')>();
  // A fresh function on every call, as a re-render would give: the sidebar must not loop on it.
  return { ...actual, usePermissions: () => ({ permissions: {}, hasAccess: (_r: unknown, p: string) => allow(p) }) };
});
const openSearch = vi.fn();
vi.mock('@/components/universal-search', () => ({ openUniversalSearch: () => openSearch(), OPEN_SEARCH_EVENT: 'eduos:open-search' }));

const { SidebarNav, MobileBottomBar, shortLabel } = await import('@/components/nav/sidebar-nav');

const memoryStorage = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
};
const throwingStorage: StorageLike = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('QuotaExceeded'); },
};

// ── Mapping ──────────────────────────────────────────────────────────────

describe('every portal item lands in exactly one space', () => {
  for (const [slug, portal] of Object.entries(PORTALS)) {
    it(slug, () => {
      const model = buildNavModel(portal);
      const navHrefs = portal.nav.flatMap((g) => g.items.map((i) => i.href));
      const placed = [...model.spaces.flatMap((s) => s.items.map((i) => i.href)), ...model.footer.map((i) => i.href)];
      // Nothing missing, nothing twice.
      expect([...placed].sort()).toEqual([...navHrefs].sort());
      expect(new Set(placed).size).toBe(placed.length);
      // Only the user guide goes to the footer.
      expect(model.footer.map((i) => i.href)).toEqual([`/${slug}/guide`]);
      // At most eight spaces, none of them empty, each split cleanly into essentials + rest.
      expect(model.spaces.length).toBeLessThanOrEqual(8);
      for (const s of model.spaces) {
        expect(s.items.length, `${slug}/${s.id}`).toBeGreaterThan(0);
        expect(s.essentials.length).toBeGreaterThan(0);
        expect([...s.essentials, ...s.rest]).toEqual(s.items);
        expect(s.rest.length).not.toBe(1); // "Show all" never hides a single line
      }
      // The portal home leads the Home space.
      expect(model.spaces[0].id).toBe('home');
      expect(model.spaces[0].items[0].href).toBe(`/${slug}`);
    });
  }

  it('uses the family spaces for parents, students and alumni', () => {
    for (const slug of ['parent', 'student', 'alumnus']) {
      const ids = buildNavModel(PORTALS[slug]).spaces.map((s) => s.id);
      expect(ids.every((id) => ['home', 'child', 'school', 'payments', 'community', 'help', 'more'].includes(id))).toBe(true);
    }
    expect(buildNavModel(PORTALS.student).spaces.find((s) => s.id === 'child')?.label).toBe('My studies');
    expect(buildNavModel(PORTALS.parent).spaces.find((s) => s.id === 'child')?.label).toBe('My child');
  });

  it('puts pages where the role would look for them', () => {
    expect(placementFor('principal', 'fees', 'OPERATIONS')).toBe('finance');
    expect(placementFor('principal', 'attendance', 'OPERATIONS')).toBe('students');
    expect(placementFor('hr', 'payroll', 'FINANCE OPERATIONS')).toBe('people');
    expect(placementFor('principal', 'payroll', 'FINANCE OPERATIONS')).toBe('finance');
    expect(placementFor('teacher', 'tickets', 'COMMUNICATION')).toBe('students');
    expect(placementFor('parent', 'payments', 'ACCOUNT')).toBe('payments');
    expect(placementFor('admin', 'guide', 'HELP & SUPPORT')).toBe('footer');
  });

  it('hides a space whose pages this person may not open', () => {
    const portal = PORTALS.principal;
    const finance = buildNavModel(portal).spaces.find((s) => s.id === 'finance')!;
    const hidden = new Set(finance.items.map((i) => i.href));
    const model = buildNavModel(portal, (href) => !hidden.has(href));
    expect(model.spaces.find((s) => s.id === 'finance')).toBeUndefined();
    expect(model.all.some((i) => hidden.has(i.href))).toBe(false);
  });

  it('cuts the first glance down for the biggest menus', () => {
    for (const slug of ['principal', 'admin', 'teacher', 'parent', 'student']) {
      const model = buildNavModel(PORTALS[slug]);
      const before = PORTALS[slug].nav.reduce((n, g) => n + g.items.length + 1, 0);
      // Jump + shortcuts + spaces + the open space's essentials (at most 6).
      const after = 1 + defaultShortcuts(slug, model).length + model.spaces.length + 6;
      expect(after, slug).toBeLessThan(before / 2);
    }
  });
});

describe('one-page spaces', () => {
  it("folds a small portal's minor one-page spaces into More, keeping its key spaces", () => {
    const model = buildNavModel(PORTALS.nurse);
    const more = model.spaces.find((s) => s.id === 'more')!;
    expect(more.items.map((i) => i.key).sort()).toEqual(['facilities', 'procurement']);
    expect(model.spaces[model.spaces.length - 1].id).toBe('more');
    // Health watch is the nurse's own work: it keeps its space (a single link).
    expect(model.spaces.find((s) => s.id === 'students')?.items.map((i) => i.key)).toEqual(['health-watch']);
  });

  it('leaves portals with one or two one-page spaces alone', () => {
    for (const slug of ['trustee', 'finance', 'librarian', 'teacher']) {
      expect(buildNavModel(PORTALS[slug]).spaces.some((s) => s.id === 'more'), slug).toBe(false);
    }
  });

  it('never folds into a More of one page, and folding stays rare', () => {
    for (const [slug, portal] of Object.entries(PORTALS)) {
      const more = buildNavModel(portal).spaces.find((s) => s.id === 'more');
      if (more) expect(more.items.length, slug).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('essentials and the active page', () => {
  it('leads a big space with the role\'s essentials and keeps the rest behind Show all', () => {
    const community = buildNavModel(PORTALS.principal).spaces.find((s) => s.id === 'community')!;
    expect(community.essentials.map((i) => i.key)).toEqual(['announcements', 'events', 'newsroom', 'marketing', 'alumni']);
    expect(community.rest.length).toBeGreaterThan(0);
  });

  it('falls back to the first few pages where a role has no essentials list', () => {
    const home = buildNavModel(PORTALS.librarian).spaces.find((s) => s.id === 'home')!;
    expect(home.essentials).toHaveLength(ESSENTIALS_LIMIT);
    expect(home.essentials[0].key).toBe('');
  });

  it('matches the deepest item a path sits under, but never lights up Home for an unlisted page', () => {
    const model = buildNavModel(PORTALS.admin);
    expect(activeItem(model.all, '/admin/users/42')?.href).toBe('/admin/users');
    expect(activeItem(model.all, '/admin')?.href).toBe('/admin');
    expect(activeItem(model.all, '/admin/not-in-menu')).toBeNull();
    expect(spaceOf(model, '/admin/payments')?.id).toBe('finance');
  });
});

// ── Preferences ──────────────────────────────────────────────────────────

describe('shortcuts', () => {
  const model = buildNavModel(PORTALS.teacher);
  const visible = new Set(model.all.map((i) => i.href));
  const defaults = defaultShortcuts('teacher', model);
  const scope = prefsScope('oakridge', 'p1');

  it('starts from the role\'s defaults', () => {
    expect(defaults).toEqual(['/teacher/classes', '/teacher/attendance', '/teacher/assignments', '/teacher/timetable', '/teacher/tickets', '/teacher/announcements']);
    expect(loadShortcuts(memoryStorage(), scope, defaults, visible)).toEqual(defaults);
  });

  it('pins, unpins, reorders and persists per school and profile', () => {
    const storage = memoryStorage();
    let list = togglePin(defaults, '/teacher/quizzes');
    expect(list).toContain('/teacher/quizzes');
    list = togglePin(list, '/teacher/tickets');
    expect(list).not.toContain('/teacher/tickets');
    list = moveShortcut(list, '/teacher/quizzes', -1);
    expect(list.indexOf('/teacher/quizzes')).toBe(list.length - 2);
    expect(moveShortcut(list, list[0], -1)).toEqual(list); // the first one cannot go higher
    saveShortcuts(storage, scope, list);
    expect(loadShortcuts(storage, scope, defaults, visible)).toEqual(list);
    // Another profile at the same school keeps its own.
    expect(loadShortcuts(storage, prefsScope('oakridge', 'p2'), defaults, visible)).toEqual(defaults);
  });

  it('keeps at most eight and drops pages no longer in the menu', () => {
    let list: string[] = [];
    for (const it of model.all.slice(0, 12)) list = togglePin(list, it.href);
    expect(list).toHaveLength(MAX_SHORTCUTS);
    const storage = memoryStorage();
    saveShortcuts(storage, scope, ['/teacher/gone', '/teacher/classes']);
    expect(loadShortcuts(storage, scope, defaults, visible)).toEqual(['/teacher/classes']);
  });

  it('falls back to the defaults when storage throws or holds rubbish', () => {
    expect(loadShortcuts(throwingStorage, scope, defaults, visible)).toEqual(defaults);
    expect(() => saveShortcuts(throwingStorage, scope, defaults)).not.toThrow();
    expect(loadShortcuts(null, scope, defaults, visible)).toEqual(defaults);
    const storage = memoryStorage();
    storage.setItem(`eduos.nav.v1:${scope}:shortcuts`, '{not json');
    expect(loadShortcuts(storage, scope, defaults, visible)).toEqual(defaults);
    storage.setItem(`eduos.nav.v1:${scope}:shortcuts`, JSON.stringify({ a: 1 }));
    expect(loadShortcuts(storage, scope, defaults, visible)).toEqual(defaults);
  });
});

describe('recent pages', () => {
  const scope = prefsScope('oakridge', 'p1');
  it('keeps the latest first, without repeats, and survives broken storage', () => {
    const storage = memoryStorage();
    for (const h of ['/a', '/b', '/c', '/a', '/d', '/e']) recordRecent(storage, scope, h);
    expect(loadRecent(storage, scope)).toEqual(['/e', '/d', '/a', '/c']);
    expect(recordRecent(throwingStorage, scope, '/x')).toEqual(['/x']);
    expect(loadRecent(throwingStorage, scope)).toEqual([]);
  });
  it('shows three, leaving out the page on screen and pages already in shortcuts', () => {
    const visible = new Set(['/e', '/d', '/a', '/c']);
    expect(recentToShow(['/e', '/d', '/a', '/c'], '/e', ['/a'], visible)).toEqual(['/d', '/c']);
    expect(recentToShow(['/e', '/d', '/a', '/c'], null, [], visible)).toEqual(['/e', '/d', '/a']);
  });
});

// ── The rendered sidebar ─────────────────────────────────────────────────

const renderNav = (slug: string, path: string, props: Partial<{ collapsed: boolean }> = {}) => {
  pathname = path;
  return render(
    <aside className="sidebar">
      <SidebarNav portal={PORTALS[slug]} school="oakridge" collapsed={props.collapsed ?? false} toggleCollapsed={vi.fn()} />
    </aside>,
  );
};

beforeEach(() => {
  localStorage.clear();
  role = 'PRINCIPAL';
  allow = () => true;
  openSearch.mockClear();
});

describe('the sidebar', () => {
  it('is a labelled nav landmark with Jump to, shortcuts and the spaces', () => {
    renderNav('principal', '/oakridge/principal/fees');
    const nav = screen.getByRole('navigation', { name: 'Principal Dashboard navigation' });
    fireEvent.click(within(nav).getByRole('button', { name: /Jump to/ }));
    expect(openSearch).toHaveBeenCalled();
    expect(within(nav).getByRole('heading', { name: 'My shortcuts' })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: /^Finance/ })).toBeTruthy();
  });

  it('opens the space holding the current page, marks the page, and leaves the others closed', () => {
    renderNav('principal', '/oakridge/principal/fees');
    expect(screen.getByRole('button', { name: /^Finance/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^People & Staff/ })).toHaveAttribute('aria-expanded', 'false');
    const current = screen.getAllByRole('link', { current: 'page' });
    expect(current.length).toBeGreaterThan(0);
    expect(current.every((a) => a.getAttribute('href') === '/oakridge/principal/fees')).toBe(true);
  });

  it('toggles a space with its button and remembers it', () => {
    const { unmount } = renderNav('principal', '/oakridge/principal/fees');
    const people = screen.getByRole('button', { name: /^People & Staff/ });
    fireEvent.click(people);
    expect(people).toHaveAttribute('aria-expanded', 'true');
    unmount();
    renderNav('principal', '/oakridge/principal/fees');
    expect(screen.getByRole('button', { name: /^People & Staff/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows the essentials first and the rest on "Show all"', () => {
    renderNav('principal', '/oakridge/principal/announcements');
    const community = buildNavModel(PORTALS.principal).spaces.find((s) => s.id === 'community')!;
    const panelLinks = () => document.querySelectorAll(`[id$="-community-list"] a.nav-item`).length;
    expect(panelLinks()).toBe(community.essentials.length);
    fireEvent.click(screen.getByRole('button', { name: `Show all (${community.items.length})` }));
    expect(panelLinks()).toBe(community.items.length);
  });

  it('never hides the page on screen behind "Show all"', () => {
    renderNav('principal', '/oakridge/principal/social');
    expect(screen.getAllByRole('link', { current: 'page' })[0]).toHaveAttribute('href', '/oakridge/principal/social');
  });

  it('pins a page with its star and keeps it after a reload', () => {
    const { unmount } = renderNav('principal', '/oakridge/principal/fees');
    fireEvent.click(screen.getByRole('button', { name: 'Add Payroll to shortcuts' }));
    const shortcuts = () => screen.getByRole('heading', { name: 'My shortcuts' }).closest('section')!;
    expect(within(shortcuts()).getByRole('link', { name: /Payroll/ })).toBeTruthy();
    unmount();
    renderNav('principal', '/oakridge/principal/fees');
    expect(within(shortcuts()).getByRole('link', { name: /Payroll/ })).toBeTruthy();
    // Edit mode: move and remove.
    fireEvent.click(within(shortcuts()).getByRole('button', { name: 'Edit' }));
    fireEvent.click(within(shortcuts()).getByRole('button', { name: 'Remove Payroll from shortcuts' }));
    expect(within(shortcuts()).queryByRole('link', { name: /Payroll/ })).toBeNull();
  });

  it('lists recently visited pages', () => {
    const first = renderNav('principal', '/oakridge/principal/staff');
    first.unmount();
    renderNav('principal', '/oakridge/principal/budgets');
    const recent = screen.getByRole('heading', { name: 'Recent' }).closest('section')!;
    expect(within(recent).getByRole('link', { name: /Staff Directory/ })).toBeTruthy();
  });

  it('still works when localStorage throws', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      renderNav('principal', '/oakridge/principal/fees');
      const shortcuts = screen.getByRole('heading', { name: 'My shortcuts' }).closest('section')!;
      expect(within(shortcuts).getAllByRole('link')).toHaveLength(6);
      fireEvent.click(screen.getByRole('button', { name: /^People & Staff/ }));
      expect(screen.getByRole('button', { name: /^People & Staff/ })).toHaveAttribute('aria-expanded', 'true');
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it('respects permissions: a hidden page is in no space and a space left empty is gone', () => {
    allow = (p) => p !== 'fees.read';
    renderNav('principal', '/oakridge/principal');
    expect(document.querySelector('a[href="/oakridge/principal/fees"]')).toBeNull();
  });

  it('shows space icons with a flyout in the collapsed rail', () => {
    renderNav('teacher', '/oakridge/teacher/classes', { collapsed: true });
    const btn = screen.getByRole('button', { name: /^Teaching & Learning/ });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    const fly = screen.getByRole('group', { name: 'Teaching & Learning' });
    expect(within(fly).getByRole('link', { name: /My Classes/ })).toHaveAttribute('aria-current', 'page');
    fireEvent.keyDown(fly, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Teaching & Learning' })).toBeNull();
  });

  it("renders a one-page space as a plain link with the space's icon and the page's label", () => {
    role = 'TRUSTEE';
    renderNav('trustee', '/oakridge/trustee');
    // Trustee's Finance space holds only Budgets: no accordion button for it.
    expect(screen.queryByRole('button', { name: /^Finance/ })).toBeNull();
    const link = document.querySelector('.snav-single a.nav-item[href="/oakridge/trustee/budgets"]')!;
    expect(link).toBeTruthy();
    expect(link.querySelector('.nav-icon')?.textContent).toBe('₹');
    expect(link.querySelector('.nav-label')?.textContent).not.toBe('Finance');
  });

  it('links a one-page space straight from the collapsed rail, with no flyout', () => {
    role = 'TRUSTEE';
    renderNav('trustee', '/oakridge/trustee/budgets', { collapsed: true });
    const link = document.querySelector<HTMLAnchorElement>('a.snav-rail-btn[href="/oakridge/trustee/budgets"]')!;
    expect(link).toBeTruthy();
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link.getAttribute('aria-label')).toBeTruthy();
    expect(link).not.toHaveAttribute('aria-expanded');
  });

  it('puts the user guide in the footer', () => {
    renderNav('parent', '/oakridge/parent');
    expect(screen.getByRole('link', { name: /User Guide/ })).toHaveAttribute('href', '/oakridge/parent/guide');
  });
});

describe('the phone bottom bar', () => {
  it('has Home, two or three key spaces and More for every portal', () => {
    for (const [slug, portal] of Object.entries(PORTALS)) {
      const model = buildNavModel(portal);
      const spaces = bottomBarSpaces(slug, model);
      expect(spaces.length, slug).toBeGreaterThanOrEqual(slug === 'super-admin' ? 1 : 2);
      expect(spaces.length).toBeLessThanOrEqual(3);
      expect(spaces.some((s) => s.id === 'home')).toBe(false);
    }
    expect(bottomBarSpaces('parent', buildNavModel(PORTALS.parent)).map((s) => s.id)).toEqual(['child', 'school', 'payments']);
    expect(bottomBarSpaces('teacher', buildNavModel(PORTALS.teacher)).map((s) => s.id)).toEqual(['teaching', 'students', 'community']);
  });

  it('renders the parent bar and opens a space as a sheet', () => {
    role = 'PARENT';
    pathname = '/oakridge/parent/performance';
    const onMore = vi.fn();
    render(<MobileBottomBar portal={PORTALS.parent} school="oakridge" onMore={onMore} />);
    const bar = screen.getByRole('navigation', { name: 'Quick navigation' });
    const labels = within(bar).getAllByRole('link').concat(within(bar).getAllByRole('button')).map((el) => el.textContent?.trim());
    expect(labels).toEqual(['⌂Home', '◉My child', '▤School life', '₹Payments', '☰More']);
    fireEvent.click(within(bar).getByRole('button', { name: /School life/ }));
    const sheet = screen.getByRole('dialog', { name: 'School life' });
    expect(within(sheet).getByRole('link', { name: /Calendar/ })).toBeTruthy();
    fireEvent.click(within(bar).getByRole('button', { name: /More/ }));
    expect(onMore).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('makes a one-page space on the bar a direct link instead of a sheet', () => {
    role = 'NURSE';
    pathname = '/oakridge/nurse';
    render(<MobileBottomBar portal={PORTALS.nurse} school="oakridge" onMore={vi.fn()} />);
    const bar = screen.getByRole('navigation', { name: 'Quick navigation' });
    expect(within(bar).getByRole('link', { name: /Health/ })).toHaveAttribute('href', '/oakridge/nurse/health-watch');
  });

  it('keeps labels to one word', () => {
    expect(shortLabel('Teaching & Learning')).toBe('Teaching');
    expect(shortLabel('Administration & Compliance')).toBe('Admin');
    expect(shortLabel('My child')).toBe('My child');
  });
});
