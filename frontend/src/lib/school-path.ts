'use client';
import { useParams, usePathname } from 'next/navigation';
import { getActiveSchool } from './school';
import { PORTALS, ROLE_TO_SLUG } from './portals';
import type { RoleKey } from './types';

/**
 * Portal URLs carry the school: `/oakridge/admin/users`, `/nvmp/teacher`.
 *
 * Nav items and page links are still written school-less (`/admin/users`) —
 * that is the canonical form the permission map is keyed by — and get the
 * school prefixed at render time. Keeping one form in the source means a link
 * cannot be written for the wrong school.
 *
 * The Super Admin console is deliberately outside all of this: it spans every
 * school, so it stays at `/super-admin`.
 */

/** Paths that belong to no single school and must never be prefixed. */
const UNSCOPED_PREFIXES = ['/super-admin', '/login', '/select-profile', '/public', '/api'];

export const isUnscopedPath = (href: string) =>
  UNSCOPED_PREFIXES.some((p) => href === p || href.startsWith(`${p}/`));

/** `('oakridge', '/admin/users')` → `/oakridge/admin/users`. */
export function withSchool(school: string | null | undefined, href: string): string {
  if (!school || !href.startsWith('/') || isUnscopedPath(href)) return href;
  if (href === `/${school}` || href.startsWith(`/${school}/`)) return href; // already prefixed
  return `/${school}${href}`;
}

/** `/oakridge/admin/users` → `/admin/users`, for matching against route tables. */
export function stripSchool(pathname: string, school: string | null | undefined): string {
  if (!school) return pathname;
  if (pathname === `/${school}`) return '/';
  return pathname.startsWith(`/${school}/`) ? pathname.slice(school.length + 1) : pathname;
}

/**
 * The school segment of the current URL.
 *
 * Falls back to the school remembered at sign-in, so a link rendered on a page
 * that has not got the segment yet still points somewhere valid.
 */
export function useSchoolSegment(): string | null {
  const params = useParams<{ school?: string }>();
  const fromUrl = typeof params?.school === 'string' ? params.school : null;
  return fromUrl ?? getActiveSchool()?.slug ?? null;
}

/** `const link = useSchoolHref(); link('/admin/tickets')` */
export function useSchoolHref(): (href: string) => string {
  const school = useSchoolSegment();
  return (href: string) => withSchool(school, href);
}

/** Where a role's portal lives for a given school. */
export const portalHome = (school: string | null | undefined, role: RoleKey): string =>
  withSchool(school, `/${ROLE_TO_SLUG[role] ?? 'admin'}`);

/**
 * Links written relative to the portal the reader is in: `/approvals?id=1`
 * becomes `/oakridge/principal/approvals?id=1` for a principal and
 * `/oakridge/teacher/approvals?id=1` for a teacher. The operations screens are
 * shared by every portal, and the API returns links in this portal-relative
 * form, so one component can link correctly wherever it is mounted.
 *
 * A link that names another portal (`/admin/admissions`) is moved to the
 * reader's own portal when that portal has the same page, and left alone
 * otherwise.
 */
export function usePortalHref(): (href: string) => string {
  const school = useSchoolSegment();
  const pathname = usePathname() ?? '';
  const portal = stripSchool(pathname, school).split('/')[1] ?? '';
  return (href: string) => {
    if (!href.startsWith('/') || isUnscopedPath(href) || !PORTALS[portal]) return withSchool(school, href);
    const [path, suffix = ''] = href.split(/(?=[?#])/, 2);
    const [, first, ...rest] = path.split('/');
    const inNav = (p: string) => PORTALS[portal].nav.some((g) => g.items.some((i) => i.href === p));
    // A page of the reader's own portal comes first: "/compliance" is the
    // Compliance Centre page everywhere, even though a portal shares its name.
    if (inNav(`/${portal}${path}`) || !PORTALS[first]) return withSchool(school, `/${portal}${href}`);
    if (first !== portal) {
      const own = `/${[portal, ...rest].join('/')}`;
      if (rest.length && inNav(own)) return withSchool(school, own + suffix);
    }
    return withSchool(school, href);
  };
}

/** The same page under the name another portal gives it. */
const PAGE_ALIASES: Record<string, string[]> = { fees: ['payments', 'reports'], payments: ['fees'] };

/**
 * Like usePortalHref, but only for pages the reader's portal really has: it
 * returns null when the portal has no such page (under its own name or an
 * alias), so a shared dashboard never links to "not found".
 */
export function usePortalPage(): (href: string | null | undefined) => string | null {
  const school = useSchoolSegment();
  const pathname = usePathname() ?? '';
  const portal = stripSchool(pathname, school).split('/')[1] ?? '';
  return (href) => {
    if (!href || !PORTALS[portal]) return null;
    const [path, suffix = ''] = href.split(/(?=[?#])/, 2);
    const page = path.replace(/^\//, '');
    const has = (name: string) => PORTALS[portal].nav.some((g) => g.items.some((i) => i.href === `/${portal}/${name}`));
    const found = [page, ...(PAGE_ALIASES[page] ?? [])].find(has);
    // An alias is a different page, so the original page's query does not carry over.
    return found ? withSchool(school, `/${portal}/${found}${found === page ? suffix : ''}`) : null;
  };
}

/**
 * The school whose door a path belongs to: the first segment of
 * `/oakridge/principal/fees`, or null for the platform's own pages
 * (`/login`, `/super-admin/...`) and for portal paths with no school.
 */
export function schoolDoorOf(pathname: string | null | undefined): string | null {
  const first = String(pathname ?? '').split('/')[1] ?? '';
  if (!first || isUnscopedPath(`/${first}`) || PORTALS[first]) return null;
  return first;
}

/**
 * Where someone with no session should sign in. A school's people go back to
 * their school's own door; sending them to the platform sign-in instead
 * (`/login`) turned them away with "platform administrators only".
 */
export function signInPathFor(school: string | null | undefined): string {
  return school ? `/${school}` : '/login';
}
