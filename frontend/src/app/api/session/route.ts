import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { REFRESH_COOKIE, refreshCookieOptions } from '@/lib/session-cookie';

export async function POST(req: Request) {
  try {
    const { refreshToken } = await req.json().catch(() => ({}));
    if (!refreshToken || typeof refreshToken !== 'string') {
      return NextResponse.json({ error: 'Missing refreshToken' }, { status: 400 });
    }

    const cookieStore = await cookies();
    cookieStore.set(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to set session' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const cookieStore = await cookies();
    cookieStore.delete(REFRESH_COOKIE);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to clear session' }, { status: 500 });
  }
}
