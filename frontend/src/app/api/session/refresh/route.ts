import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { REFRESH_COOKIE, refreshCookieOptions } from '@/lib/session-cookie';
import { clientAddress, overFailureBudget, recordFailure } from '@/lib/refresh-failures';

// API_URL first, as main's handler and next.config.mjs read it: the server-side
// address of the backend in a deployment, where the public URL may differ.
const BACKEND_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:5000';


/**
 * Exchanges the httpOnly refresh cookie for a fresh access token.
 *
 * The whole point of this route is that the refresh token is read here, on the
 * server, and the *new* one is written straight back into the cookie — the
 * browser only ever sees the access token. The backend rotates refresh tokens
 * on every use and revokes the whole session if an old one is replayed, so
 * failing to persist the rotated token would log the user out on their next
 * refresh; that is why the new cookie is set before responding.
 */
export async function POST(request: Request) {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;

  if (!refreshToken) {
    return NextResponse.json({ error: 'NO_SESSION' }, { status: 401 });
  }

  const client = clientAddress(request);
  if (overFailureBudget(client)) {
    return NextResponse.json({ error: 'REFRESH_UNAVAILABLE' }, { status: 503 });
  }

  // Proves to the backend that this is the portal's own proxy, which limits
  // failures per real client above — see isTrustedFrontendProxy() there.
  const proxySecret = process.env.FRONTEND_PROXY_SECRET;

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(proxySecret ? { 'x-eduos-proxy-secret': proxySecret } : {}),
      },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
  } catch {
    // The backend being unreachable is not proof the session is invalid, so
    // the cookie is left alone rather than signing the user out over a blip.
    return NextResponse.json({ error: 'BACKEND_UNREACHABLE' }, { status: 503 });
  }

  // Throttled or failing is not the same as signed out. Clearing the cookie on
  // a 429 or a 5xx turned a brief backend hiccup into a forced sign-out; the
  // client already treats 503 as "try again later" and keeps the session.
  if (upstream.status === 429 || upstream.status >= 500) {
    return NextResponse.json({ error: 'REFRESH_UNAVAILABLE' }, { status: 503 });
  }

  if (!upstream.ok) {
    recordFailure(client);
    // The token really was rejected (expired, revoked, or reuse detected).
    const dead = new NextResponse(JSON.stringify({ error: 'REFRESH_REJECTED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    dead.cookies.set(REFRESH_COOKIE, '', { ...refreshCookieOptions(), maxAge: 0 });
    return dead;
  }

  const body = await upstream.json().catch(() => null);
  const tokens = body?.data ?? body;

  if (!tokens?.accessToken || !tokens?.refreshToken) {
    return NextResponse.json({ error: 'MALFORMED_REFRESH_RESPONSE' }, { status: 502 });
  }

  const { refreshToken: rotated, ...safe } = tokens;
  const res = NextResponse.json(safe);
  res.cookies.set(REFRESH_COOKIE, rotated, refreshCookieOptions());
  return res;
}
