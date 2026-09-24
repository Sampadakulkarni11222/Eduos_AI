import { describe, it, expect } from 'vitest';
import { getRequiredPermission, ROUTE_PERMISSIONS } from '@/lib/permissions';
import { PORTALS } from '@/lib/portals';

/**
 * The client half of the seat feature's authorization.
 *
 * It decides menu and page visibility only — the backend gates every seat route
 * on the same keys — so what matters is that it asks about the *same* keys, and
 * in particular that the platform page asks for a Super-Admin-only one. A seat
 * page that gated itself on `seats.read` would render its approve buttons for a
 * School Admin, who would then be 403'd by the server: correct, but a worse
 * screen than one that never offers the action.
 */

const hrefs = (slug: string) => PORTALS[slug].nav.flatMap((g) => g.items).map((i) => i.href);

describe('seat pages ask for the right permission', () => {
  it('gates the platform seat page on the Super-Admin-only key, not the school one', () => {
    expect(getRequiredPermission('/super-admin/seats')).toBe('seats.manage');
  });

  it('gates the School Admin seat page on seats.read', () => {
    expect(getRequiredPermission('/admin/seats')).toBe('seats.read');
  });

  it('gates the pricing page on the pricing key, which is its own authority', () => {
    // Deliberately not `seats.manage`: selling a school seats and deciding what
    // a seat costs are different permissions server-side, and the page that
    // changes the price must ask for the one that is allowed to.
    expect(getRequiredPermission('/super-admin/pricing')).toBe('seats.pricing.manage');
  });

  it('gives no school-level route a pricing permission', () => {
    for (const route of Object.keys(ROUTE_PERMISSIONS)) {
      if (route.startsWith('/super-admin')) continue;
      expect(ROUTE_PERMISSIONS[route], route).not.toBe('seats.pricing.manage');
    }
  });

  it('does not match a route that merely shares the prefix', () => {
    expect(getRequiredPermission('/admin/seating-plan')).toBeNull();
  });
});

describe('seat pages are reachable from their portals', () => {
  it('the Super Admin console links to seat management and to pricing', () => {
    expect(hrefs('super-admin')).toContain('/super-admin/seats');
    expect(hrefs('super-admin')).toContain('/super-admin/pricing');
  });

  it('no school portal offers a pricing page — pricing is a platform act', () => {
    for (const slug of Object.keys(PORTALS)) {
      if (slug === 'super-admin') continue;
      expect(hrefs(slug).filter((h) => h.includes('pricing')), slug).toEqual([]);
    }
  });

  it('the Admin console links to its own seats', () => {
    expect(hrefs('admin')).toContain('/admin/seats');
  });

  it('no other portal offers a seat page', () => {
    for (const slug of Object.keys(PORTALS)) {
      if (slug === 'admin' || slug === 'super-admin') continue;
      expect(hrefs(slug).filter((h) => h.includes('seat')), slug).toEqual([]);
    }
  });

  it('every seat nav item is mapped to a permission', () => {
    for (const slug of ['admin', 'super-admin']) {
      for (const href of hrefs(slug).filter((h) => h.includes('/seats') || h.includes('/pricing'))) {
        expect(getRequiredPermission(href), href).toBeTruthy();
      }
    }
  });
});
