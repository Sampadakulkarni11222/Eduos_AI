/**
 * What a request arriving on a school's own domain is allowed to reach.
 *
 * The portal is path-routed — `/oakridge/admin`, `/nvmp/admin` — and that does
 * not change. What a school's domain adds is a boundary: on www.abcschool.com
 * the only school that exists is ABC. Its front door is `/`, its portal paths
 * work as they always did, and a path naming any other school, or the platform
 * console, is sent back to ABC's front door rather than served under ABC's
 * address.
 *
 * Kept free of Next.js so the rules can be tested as plain functions; the
 * middleware only supplies the host, the path and the resolved slug.
 */

/** Top-level paths every host serves, because sign-in and the session need them. */
const SHARED_PREFIXES = ['login', 'select-profile', 'api', 'public', '_next'];

/** Hosts that are the platform itself and never a school's domain. */
export function isPlatformHost(host: string, configured: string | undefined): boolean {
  const hostname = normalizeHost(host);
  if (!hostname) return true;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.localhost')) return true;
  const list = String(configured ?? '')
    .split(',')
    .map((h) => normalizeHost(h))
    .filter(Boolean);
  return list.includes(hostname);
}

/** "WWW.AbcSchool.com:443" → "www.abcschool.com"; null for anything that is not a hostname. */
export function normalizeHost(host: string | null | undefined): string {
  const value = String(host ?? '').trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  return /^[a-z0-9.-]+$/.test(value) ? value : '';
}

export type DomainRoute = { action: 'next' } | { action: 'redirect'; to: string };

/**
 * Where a request on a school's domain goes.
 *
 * `slug` is the school the backend resolved the host to, or null when the host
 * serves no active school (in which case nothing is changed).
 */
export function routeForSchoolHost(pathname: string, slug: string | null): DomainRoute {
  if (!slug) return { action: 'next' };
  const segments = pathname.split('/').filter(Boolean);
  const first = (segments[0] ?? '').toLowerCase();

  if (!first) return { action: 'redirect', to: `/${slug}` };
  if (first === slug) return { action: 'next' };
  if (SHARED_PREFIXES.includes(first)) return { action: 'next' };
  // Another school's slug, the platform console, or anything unknown.
  return { action: 'redirect', to: `/${slug}` };
}
