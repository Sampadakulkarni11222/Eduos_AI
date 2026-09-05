/**
 * Next.js API Route — development-only Google demo exchange.
 *
 * Backs the demo "Continue with Google" popup that exists only while no real
 * GOOGLE_CLIENT_ID is configured. It signs the chosen demo account in through
 * the backend's email-OTP flow: request a code (the backend echoes devOtp
 * outside production) and immediately verify it server-side. There are no
 * hardcoded passwords, and the route can only work where the backend actually
 * echoes devOtp: development, or a testing-phase deployment that sets
 * ALLOW_DEV_OTP_IN_PRODUCTION on the backend and NEXT_PUBLIC_ALLOW_DEV_OTP
 * here. Anywhere else it degrades to 501.
 *
 * Real Google sign-in goes through NextAuth → POST /auth/google, where the
 * backend verifies the Google ID token signature and audience.
 */
import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:5000';

export async function POST(req: NextRequest) {
  const testingPhase = process.env.NEXT_PUBLIC_ALLOW_DEV_OTP === 'true';
  if (process.env.NODE_ENV === 'production' && !testingPhase) {
    return NextResponse.json(
      { error: 'Demo Google sign-in is disabled in production. Configure GOOGLE_CLIENT_ID for real Google sign-in.', code: 'GOOGLE_NOT_CONFIGURED' },
      { status: 501 }
    );
  }

  try {
    const { email, schoolId } = await req.json();
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    // The door the popup was opened from. Forwarded on both legs so the demo
    // path is held to the same school check as a typed sign-in.
    const door = schoolId ? String(schoolId).trim().toLowerCase() : null;

    // 1. Ask the backend for an email OTP (devOtp is echoed outside production)
    const reqRes = await fetch(`${BACKEND_URL}/api/v1/auth/otp/email/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizedEmail, schoolId: door }),
    });
    const reqData = await reqRes.json().catch(() => ({}));
    const devOtp = reqData?.data?.devOtp;
    if (!reqRes.ok || !devOtp) {
      // A wrong-door refusal is not "no such account" — say which it was, so
      // the screen can tell the user where they should sign in instead.
      if (reqData?.error?.code === 'WRONG_DOOR') {
        return NextResponse.json(
          { error: reqData?.message ?? 'This account is not part of this school.', code: 'WRONG_DOOR' },
          { status: 403 }
        );
      }
      return NextResponse.json(
        { error: 'No EduOS account is linked to this Google account.', code: 'USER_NOT_FOUND', email: normalizedEmail },
        { status: 404 }
      );
    }

    // 2. Verify it server-side to mint a real session
    const verRes = await fetch(`${BACKEND_URL}/api/v1/auth/otp/email/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizedEmail, code: devOtp, schoolId: door }),
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
