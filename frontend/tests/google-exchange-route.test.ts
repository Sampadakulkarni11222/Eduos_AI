import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/auth/google-exchange/route';

/**
 * The demo Google exchange turns a bare email address into a session by
 * reading the one-time code the backend echoes in development. In production
 * that is a sign-in for any account with no credential, so it must be refused
 * whatever the testing-phase flag says — and must not even ask the backend.
 */
describe('POST /api/auth/google-exchange', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const call = () =>
    POST(new NextRequest('http://localhost:3000/api/auth/google-exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'principal@school.test' }),
    }));

  it('refuses in production even with NEXT_PUBLIC_ALLOW_DEV_OTP=true', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_ALLOW_DEV_OTP', 'true');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await call();
    expect(res.status).toBe(501);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still works in development, where the backend echoes the code', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { devOtp: '123456' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { accessToken: 'a' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await call();
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
