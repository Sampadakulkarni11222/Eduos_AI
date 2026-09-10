import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { REFRESH_COOKIE, refreshCookieOptions } from '@/lib/session-cookie';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:5000';

export async function POST(request: Request) {
  const refreshToken = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (!refreshToken) return NextResponse.json({ error: 'No active session' }, { status: 401 });

  const backend = await fetch(`${BACKEND_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });
  const body = await backend.json().catch(() => ({}));
  if (!backend.ok) {
    const store = await cookies();
    store.set(REFRESH_COOKIE, '', { ...refreshCookieOptions(), maxAge: 0 });
    return NextResponse.json(body, { status: backend.status });
  }

  const tokens = body?.data ?? body;
  const store = await cookies();
  store.set(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions());
  return NextResponse.json({ accessToken: tokens.accessToken });
}
