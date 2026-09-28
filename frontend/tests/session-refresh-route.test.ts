import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'current-refresh-token' }) }),
}));

import { POST } from '@/app/api/session/refresh/route';
import { __resetRefreshFailures } from '@/lib/refresh-failures';

/**
 * The refresh BFF must only end a session when the backend actually rejects
 * the token. A throttled or failing backend is "try again", not "signed out".
 * It also limits FAILED refreshes per real client address, which the backend
 * cannot do because every refresh reaches it from this server's one address.
 */
const from = (ip = '203.0.113.10') =>
  new Request('http://localhost:3000/api/session/refresh', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
  });

describe('POST /api/session/refresh', () => {
  beforeEach(() => __resetRefreshFailures());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const upstream = (status: number, body: unknown = {}) => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it.each([429, 500, 502, 503])('keeps the session cookie when the backend answers %i', async (status) => {
    upstream(status);
    const res = await POST(from());
    expect(res.status).toBe(503);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('clears the cookie when the backend rejects the token', async () => {
    upstream(401, { message: 'Invalid or expired refresh token' });
    const res = await POST(from());
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
  });

  it('rotates the cookie on success and never returns the refresh token to JS', async () => {
    upstream(200, { data: { accessToken: 'new-access', refreshToken: 'rotated' } });
    const res = await POST(from());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accessToken).toBe('new-access');
    expect(body.refreshToken).toBeUndefined();
    expect(res.headers.get('set-cookie')).toMatch(/rotated/);
  });

  it('identifies itself to the backend when FRONTEND_PROXY_SECRET is set', async () => {
    vi.stubEnv('FRONTEND_PROXY_SECRET', 'shared-secret');
    const fetchMock = upstream(200, { data: { accessToken: 'a', refreshToken: 'r' } });
    await POST(from());
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-eduos-proxy-secret']).toBe('shared-secret');
  });

  it('stops forwarding one client after repeated failures, without signing anyone out', async () => {
    const fetchMock = upstream(401);
    for (let i = 0; i < 30; i++) await POST(from('198.51.100.7'));
    const calls = fetchMock.mock.calls.length;

    const blocked = await POST(from('198.51.100.7'));
    expect(blocked.status).toBe(503);
    expect(blocked.headers.get('set-cookie')).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(calls);

    // Another client — including one behind a different address — is untouched.
    const other = await POST(from('198.51.100.8'));
    expect(other.status).toBe(401);
  });

  it('never counts successful refreshes, however many users share an address', async () => {
    upstream(200, { data: { accessToken: 'a', refreshToken: 'r' } });
    for (let i = 0; i < 100; i++) {
      const res = await POST(from('192.0.2.1'));
      expect(res.status).toBe(200);
    }
  });
});
