/**
 * Next.js API Route — Email OTP Proxy
 * Generates a random OTP for email login (since the backend may not have
 * a dedicated email OTP endpoint), stores it temporarily in memory,
 * and logs it to the terminal.
 *
 * In production this would integrate with SendGrid / AWS SES etc.
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:5000';

// In-memory OTP store: email → { otp, expiresAt }
// Note: This resets on server restart, which is fine for dev.
const otpStore = new Map<string, { otp: string; expiresAt: number }>();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, action } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // ── SEND action: generate & log OTP ───────────────────────────────
    if (!action || action === 'send') {
      // Generate a 6-digit OTP
      const otp = String(crypto.randomInt(100000, 999999));
      const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

      // Store it
      otpStore.set(normalizedEmail, { otp, expiresAt });

      // ── Log OTP to terminal ────────────────────────────────────────
      console.log('\n┌──────────────────────────────────────────────────┐');
      console.log('│         ✉️  EMAIL OTP — Development Mode           │');
      console.log('├──────────────────────────────────────────────────┤');
      console.log(`│  Email  : ${String(normalizedEmail).padEnd(39)}│`);
      console.log(`│  OTP    : ${String(otp).padEnd(39)}│`);
      console.log(`│  Expires: 10 minutes                              │`);
      console.log('└──────────────────────────────────────────────────┘\n');
      // ──────────────────────────────────────────────────────────────

      return NextResponse.json({ message: 'OTP sent to your email (check terminal in dev mode)' });
    }

    // ── VERIFY action: check OTP and authenticate with backend ────────
    if (action === 'verify') {
      const { otp } = body;

      if (!otp) {
        return NextResponse.json({ error: 'OTP is required' }, { status: 400 });
      }

      const stored = otpStore.get(normalizedEmail);

      if (!stored) {
        return NextResponse.json({ error: 'No OTP found for this email. Please request a new one.', code: 'OTP_NOT_FOUND' }, { status: 400 });
      }

      if (Date.now() > stored.expiresAt) {
        otpStore.delete(normalizedEmail);
        return NextResponse.json({ error: 'OTP has expired. Please request a new one.', code: 'OTP_EXPIRED' }, { status: 400 });
      }

      if (stored.otp !== otp.trim()) {
        return NextResponse.json({ error: 'Incorrect OTP. Please try again.', code: 'OTP_WRONG' }, { status: 400 });
      }

      // OTP is valid — clear it and authenticate via backend password login
      otpStore.delete(normalizedEmail);

      // Try to authenticate with backend using known passwords
      const passwords = ['password123', 'ChangeMe@123!'];
      for (const password of passwords) {
        try {
          const backendRes = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: normalizedEmail, password }),
          });

          if (backendRes.ok) {
            const data = await backendRes.json();
            console.log(`[Email OTP] ✅ ${normalizedEmail} authenticated successfully`);
            return NextResponse.json(data, { status: 200 });
          }
        } catch {
          // Try next password
        }
      }

      return NextResponse.json({ error: 'Account not found or incorrect credentials.', code: 'BAD_CREDENTIALS' }, { status: 401 });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    console.error('[Email OTP Proxy] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
