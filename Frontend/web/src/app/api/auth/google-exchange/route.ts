/**
 * Next.js API Route — development-only Google demo exchange.
 *
 * Backs the demo "Continue with Google" popup that exists only while no real
 * GOOGLE_CLIENT_ID is configured. It signs the chosen demo account in through
 * the backend's email-OTP flow: request a code (the backend echoes devOtp
 * outside production) and immediately verify it server-side. There are no
 * hardcoded passwords and nothing here works in production — the backend
 * stops echoing devOtp, so this route degrades to 501.
 *
 * Real Google sign-in goes through NextAuth → POST /auth/google, where the
 * backend verifies the Google ID token signature and audience.
 */
import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:5000';

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Demo Google sign-in is disabled in production. Configure GOOGLE_CLIENT_ID for real Google sign-in.', code: 'GOOGLE_NOT_CONFIGURED' },
      { status: 501 }
    );
  }

  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }
    const normalizedEmail = String(email).trim().toLowerCase();

    // 1. Ask the backend for an email OTP (devOtp is echoed outside production)
    const reqRes = await fetch(`${BACKEND_URL}/api/v1/auth/otp/email/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizedEmail }),
    });
    const reqData = await reqRes.json().catch(() => ({}));
    const devOtp = reqData?.data?.devOtp;
    if (!reqRes.ok || !devOtp) {
      return NextResponse.json(
        { error: 'No EduOS account is linked to this Google account.', code: 'USER_NOT_FOUND', email: normalizedEmail },
        { status: 404 }
      );
    }

    // 2. Verify it server-side to mint a real session
    const verRes = await fetch(`${BACKEND_URL}/api/v1/auth/otp/email/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizedEmail, code: devOtp }),
    });
    const verData = await verRes.json().catch(() => ({}));
    if (!verRes.ok) {
      return NextResponse.json(
        { error: verData?.message ?? 'Could not sign in.', code: verData?.error?.code ?? 'ERROR' },
        { status: verRes.status }
      );
    }

    return NextResponse.json(verData, { status: 200 });
  } catch (err) {
    console.error('[Google demo exchange] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
