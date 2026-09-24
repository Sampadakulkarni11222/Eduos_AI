import { NextResponse, type NextRequest } from 'next/server';
import { isPlatformHost, normalizeHost, routeForSchoolHost } from '@/lib/domain-routing';

/**
 * Serves a school at its own domain.
 *
 * A request on a host that is not the platform's is resolved against the
 * backend, which answers only for a domain a Super Admin has ACTIVATED — after
 * real DNS verification and a working certificate. Anything else (pending,
 * failed, deactivated, unknown) resolves to nothing and the request is left
 * exactly as it was, so configuring a domain changes no routing on its own.
 *
 * PLATFORM_APP_HOSTS lists the platform's own hostnames (comma-separated) so
 * they skip the lookup; localhost always does.
 */

const BACKEND = process.env.API_URL ?? process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:5000';
const TTL_MS = 60_000;
const LOOKUP_TIMEOUT_MS = 2_000;
const cache = new Map<string, { slug: string | null; at: number }>();

async function schoolForHost(hostname: string): Promise<string | null> {
  const hit = cache.get(hostname);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.slug;

  let slug: string | null = null;
  try {
    const res = await fetch(`${BACKEND}/api/v1/domains/resolve?host=${encodeURIComponent(hostname)}`, {
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (res.ok) {
      const body = await res.json();
      slug = typeof body?.data?.slug === 'string' ? body.data.slug : null;
    }
  } catch {
    // An unreachable resolver leaves the request unrouted rather than failing
    // it. Nothing is exposed by that: every page still authenticates, and a
    // school-level session is confined to its own school by the backend.
    return null;
  }
  cache.set(hostname, { slug, at: Date.now() });
  return slug;
}

export async function middleware(request: NextRequest) {
  const host = request.headers.get('host') ?? '';
  if (isPlatformHost(host, process.env.PLATFORM_APP_HOSTS)) return NextResponse.next();

  const hostname = normalizeHost(host);
  const slug = hostname ? await schoolForHost(hostname) : null;
  const route = routeForSchoolHost(request.nextUrl.pathname, slug);
  if (route.action === 'next') return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = route.to;
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  // Pages only: not Next's own assets, and not files with an extension.
  matcher: ['/((?!_next/|.*\\..*).*)'],
};
