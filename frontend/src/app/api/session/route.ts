import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { REFRESH_COOKIE, refreshCookieOptions } from '@/lib/session-cookie';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:5000';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const refreshToken = typeof body?.refreshToken === 'string' ? body.refreshToken : '';
  if (!refreshToken) return NextResponse.json({ error: 'refreshToken is required' }, { status: 400 });

  const store = await cookies();
  store.set(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const store = await cookies();
  store.set(REFRESH_COOKIE, '', { ...refreshCookieOptions(), maxAge: 0 });
  return NextResponse.json({ ok: true });
}
