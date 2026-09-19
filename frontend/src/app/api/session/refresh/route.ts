import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { REFRESH_COOKIE, refreshCookieOptions } from '@/lib/session-cookie';

const BACKEND_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:5000';

export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;

  if (!refreshToken) {
    return NextResponse.json({ error: 'No refresh token found' }, { status: 401 });
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (res.status === 503) {
      return NextResponse.json({ error: 'Backend unavailable' }, { status: 503 });
    }

    if (!res.ok) {
      cookieStore.delete(REFRESH_COOKIE);
      return NextResponse.json({ error: 'Token refresh failed' }, { status: res.status });
    }

    const data = await res.json().catch(() => ({}));
    const tokens = data?.data ?? data;

    if (!tokens?.accessToken) {
      cookieStore.delete(REFRESH_COOKIE);
      return NextResponse.json({ error: 'Invalid refresh response' }, { status: 500 });
    }

    if (tokens.refreshToken) {
      cookieStore.set(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions());
    }

    return NextResponse.json({ accessToken: tokens.accessToken });
  } catch (err) {
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 503 });
  }
}

