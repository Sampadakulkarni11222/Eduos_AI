import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { getRequiredPermission, ROUTE_PERMISSIONS } from '@/lib/permissions';
import { PORTALS } from '@/lib/portals';
import { themeStyle, useFavicon, useSchoolDropdown, useSchoolTheme } from '@/lib/school-theme';
import type { SchoolThemeDto } from '@/lib/types';

/**
 * The client half of school customisation.
 *
 * The server decides the palette; what has to be true here is that the portal
 * applies it to itself and nowhere else, that the platform console is never
 * themed by a school, and that the page which changes a theme asks for the
 * permission that is allowed to.
 */

const schoolTheme = vi.fn();
const schoolDropdown = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    schoolTheme: (...args: unknown[]) => schoolTheme(...args),
    schoolDropdown: (...args: unknown[]) => schoolDropdown(...args),
  },
  errorMessage: (_e: unknown, fallback: string) => fallback,
}));

const themed = (overrides: Partial<SchoolThemeDto> = {}): SchoolThemeDto => ({
  tenantId: 'school-a',
  theme: { primaryColor: '#1f4a3a', secondaryColor: '#2c6049', accentColor: null },
  branding: { displayName: 'School A', tagline: null, logoUrl: null, faviconUrl: null },
  header: { showSchoolName: true, showTagline: false },
  sidebar: { showLogo: true, showPortalLabel: true, defaultCollapsed: false },
  dropdowns: [],
  cssVariables: { '--accent': '#1f4a3a', '--accent-2': '#2c6049', '--on-accent': '#f4e7d2' },
  ...overrides,
});

afterEach(() => {
  schoolTheme.mockReset();
  schoolDropdown.mockReset();
  document.querySelector('link[rel="icon"]')?.remove();
});

/** Exercises the hook the shell uses, and renders what it produced. */
function ThemeProbe({ enabled, schoolKey = null }: { enabled: boolean; schoolKey?: string | null }) {
  const { theme, ready } = useSchoolTheme(enabled, schoolKey);
  return (
    <div data-testid="shell" style={themeStyle(theme.cssVariables)}>
      <span data-testid="ready">{String(ready)}</span>
      <span data-testid="name">{theme.branding.displayName ?? '—'}</span>
    </div>
  );
}

describe('a school portal paints itself with the server\'s variables', () => {
  it('applies them to its own element, not to the document root', async () => {
    schoolTheme.mockResolvedValue(themed());
    render(<ThemeProbe enabled />);

    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'));

    const shell = screen.getByTestId('shell');
    expect(shell.style.getPropertyValue('--accent')).toBe('#1f4a3a');
    expect(shell.style.getPropertyValue('--accent-2')).toBe('#2c6049');
    // Scoped to the portal: one school's colours cannot outlive its subtree.
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('');
  });

  it('asks for nothing on the platform console, which belongs to no school', async () => {
    render(<ThemeProbe enabled={false} />);
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'));

    expect(schoolTheme).not.toHaveBeenCalled();
    expect(screen.getByTestId('shell').style.getPropertyValue('--accent')).toBe('');
  });

  it('renders unthemed when the theme cannot be fetched', async () => {
    schoolTheme.mockRejectedValue(new Error('offline'));
    render(<ThemeProbe enabled />);

    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'));
    // Branding is not worth a broken portal.
    expect(screen.getByTestId('shell').style.getPropertyValue('--accent')).toBe('');
    expect(screen.getByTestId('name')).toHaveTextContent('—');
  });

  it('publishes nothing for a school that has customised nothing', async () => {
    schoolTheme.mockResolvedValue(themed({
      theme: { primaryColor: null, secondaryColor: null, accentColor: null },
      cssVariables: {},
    }));
    render(<ThemeProbe enabled />);

    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'));
    // The role theme in design-system.css stands: no style attribute is
    // rendered at all, so there is nothing to override it with.
    expect(screen.getByTestId('shell').getAttribute('style')).toBeNull();
  });
});

describe('moving from one school to another', () => {
  it("re-fetches, and never paints School B in School A's colours", async () => {
    let resolveB: (t: SchoolThemeDto) => void = () => {};
    schoolTheme
      .mockResolvedValueOnce(themed())
      .mockReturnValueOnce(new Promise<SchoolThemeDto>((r) => { resolveB = r; }));

    const { rerender } = render(<ThemeProbe enabled schoolKey="school-a" />);
    await waitFor(() => expect(screen.getByTestId('shell').style.getPropertyValue('--accent')).toBe('#1f4a3a'));

    rerender(<ThemeProbe enabled schoolKey="school-b" />);
    // While B's theme is still on its way, A's is already gone.
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('false'));
    expect(screen.getByTestId('shell').style.getPropertyValue('--accent')).toBe('');

    resolveB(themed({
      tenantId: 'school-b',
      theme: { primaryColor: '#223366', secondaryColor: null, accentColor: null },
      branding: { displayName: 'School B', tagline: null, logoUrl: null, faviconUrl: null },
      cssVariables: { '--accent': '#223366' },
    }));
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('School B'));
    expect(screen.getByTestId('shell').style.getPropertyValue('--accent')).toBe('#223366');
    expect(schoolTheme).toHaveBeenCalledTimes(2);
  });
});

describe("a form's dropdown comes from the acting school", () => {
  function HouseSelect({ schoolKey }: { schoolKey: string }) {
    const { options, label, ready } = useSchoolDropdown('house', schoolKey);
    return (
      <label>
        {label}
        <select data-testid="house" data-ready={String(ready)}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    );
  }

  const list = (labels: string[]) => ({
    tenantId: 'x', key: 'house', label: 'House',
    options: labels.map((l, order) => ({ value: l, label: l, order })),
  });

  it('shows School A its houses, then School B only its own', async () => {
    schoolDropdown.mockResolvedValueOnce(list(['Red', 'Blue', 'Green']));
    const { rerender } = render(<HouseSelect schoolKey="school-a" />);
    await waitFor(() => expect(screen.getByTestId('house')).toHaveAttribute('data-ready', 'true'));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Red', 'Blue', 'Green']);

    schoolDropdown.mockResolvedValueOnce(list(['Alpha', 'Beta', 'Gamma']));
    rerender(<HouseSelect schoolKey="school-b" />);
    await waitFor(() => expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Alpha', 'Beta', 'Gamma']));
    expect(screen.queryByText('Red')).toBeNull();
    expect(schoolDropdown).toHaveBeenCalledWith('house');
  });

  it('offers no options, rather than stale ones, when the list cannot be fetched', async () => {
    schoolDropdown.mockRejectedValue(new Error('offline'));
    render(<HouseSelect schoolKey="school-a" />);
    await waitFor(() => expect(screen.getByTestId('house')).toHaveAttribute('data-ready', 'true'));
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });
});

describe('the favicon follows the school, and is given back', () => {
  function FaviconProbe({ url }: { url: string | null }) {
    useFavicon(url);
    return null;
  }

  it('points the tab at the school\'s favicon and removes it on the way out', () => {
    const { unmount } = render(<FaviconProbe url="/uploads/a-fav.png" />);
    expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href).toContain('/uploads/a-fav.png');

    unmount();
    // Leaving a school does not leave its mark on the platform console.
    expect(document.querySelector('link[rel="icon"]')).toBeNull();
  });

  it('does nothing at all when a school has set none', () => {
    render(<FaviconProbe url={null} />);
    expect(document.querySelector('link[rel="icon"]')).toBeNull();
  });
});

describe('who may reach the customisation console', () => {
  it('gates it on the platform-only key', () => {
    expect(getRequiredPermission('/super-admin/customization')).toBe('customization.manage');
  });

  it('gives no school-level route the customisation key', () => {
    for (const route of Object.keys(ROUTE_PERMISSIONS)) {
      if (route.startsWith('/super-admin')) continue;
      expect(ROUTE_PERMISSIONS[route], route).not.toBe('customization.manage');
    }
  });

  it('is linked from the platform console and from no school portal', () => {
    const hrefs = (slug: string) => PORTALS[slug].nav.flatMap((g) => g.items).map((i) => i.href);
    expect(hrefs('super-admin')).toContain('/super-admin/customization');

    for (const slug of Object.keys(PORTALS)) {
      if (slug === 'super-admin') continue;
      expect(hrefs(slug).filter((h) => h.includes('customization')), slug).toEqual([]);
    }
  });
});
