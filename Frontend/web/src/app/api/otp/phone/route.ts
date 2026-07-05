/**
 * Next.js API Route — Phone OTP Proxy
 * Forwards OTP requests to the backend and logs the generated OTP
 * to the Next.js server terminal for dev/testing purposes.
 */
import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:5000';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { phone } = body;

    if (!phone) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
    }

    // Forward to backend
    const backendRes = await fetch(`${BACKEND_URL}/api/v1/auth/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });

    const data = await backendRes.json();

    // Extract OTP from response (backend returns devOtp in dev mode)
    const otp = data?.data?.devOtp ?? data?.devOtp ?? data?.data?.otp ?? data?.otp;

    // ── Log OTP to terminal ────────────────────────────────────────────
    console.log('\n┌──────────────────────────────────────────────────┐');
    console.log('│         📱 PHONE OTP — Development Mode           │');
    console.log('├──────────────────────────────────────────────────┤');
    console.log(`│  Phone  : ${String(phone).padEnd(39)}│`);
    console.log(`│  OTP    : ${String(otp ?? '(check backend logs)').padEnd(39)}│`);
    console.log('└──────────────────────────────────────────────────┘\n');
    // ──────────────────────────────────────────────────────────────────

    // Return the backend response as-is
    return NextResponse.json(data, { status: backendRes.status });
  } catch (err) {
    console.error('[Phone OTP Proxy] Error:', err);
    return NextResponse.json({ error: 'Failed to reach auth server' }, { status: 502 });
  }
}
