import { NextResponse } from 'next/server';
import { REFRESH_COOKIE, refreshCookieOptions } from '@/lib/session-cookie';

/**
 * Backend-for-frontend for the refresh token.
 *
 * The refresh token used to live in `localStorage`, where any successful XSS
 * could read it and mint access tokens indefinitely. It now never reaches
 * JavaScript at all: the browser hands it to this route once, it is stored in
 * an httpOnly cookie, and every later use happens server-side in
 * `/api/session/refresh`.
 *
 * POST   — store the refresh token issued by a completed sign-in.
 * DELETE — clear it on sign-out.
 */
export async function POST(request: Request) {
  // A cross-site <form enctype="text/plain"> can deliver a JSON-shaped body to
  // this route with the victim's cookies, planting someone else's session in
  // their browser. A form cannot send application/json, and a cross-site fetch
  // that tries is preflighted and refused, so requiring it closes that door.
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }

  let refreshToken: unknown;
  try {
    ({ refreshToken } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Malformed body' }, { status: 400 });
  }

  if (typeof refreshToken !== 'string' || !refreshToken) {
    return NextResponse.json({ error: 'refreshToken is required' }, { status: 400 });
  }

  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  return res;
}

export async function DELETE() {
  const res = new NextResponse(null, { status: 204 });
  // maxAge 0 expires it immediately; the other attributes must match the ones
  // it was set with or the browser will not replace the right cookie.
  res.cookies.set(REFRESH_COOKIE, '', { ...refreshCookieOptions(), maxAge: 0 });
  return res;
}
