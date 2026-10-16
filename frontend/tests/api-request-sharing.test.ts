import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { request } from '@/lib/api';
import { SESSION_MARKER } from '@/lib/session-cookie';

/**
 * Navigation speed: identical reads in flight together share one request,
 * never across a write, and `/auth/me` waits for the session's token instead
 * of going out bare, failing 401 and being sent again.
 */
let fetchMock: ReturnType<typeof vi.fn>;
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const apiCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/v1/'));

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.removeItem(SESSION_MARKER);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('reads in flight together', () => {
  it('share one network request and each caller gets the data', async () => {
    let release: (r: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => { release = r; }));
    const a = request<{ n: number }>('/tickets');
    const b = request<{ n: number }>('/tickets');
    release(ok({ n: 1 }));
    expect(await a).toEqual({ n: 1 });
    expect(await b).toEqual({ n: 1 });
    expect(apiCalls()).toHaveLength(1);
  });

  it('are not shared once the first has finished (nothing is cached)', async () => {
    fetchMock.mockResolvedValueOnce(ok({ n: 1 })).mockResolvedValueOnce(ok({ n: 2 }));
    expect(await request('/tickets')).toEqual({ n: 1 });
    expect(await request('/tickets')).toEqual({ n: 2 });
    expect(apiCalls()).toHaveLength(2);
  });

  it('are not shared across different paths or with writes', async () => {
    fetchMock.mockImplementation(async () => ok({}));
    await Promise.all([request('/tickets'), request('/tickets?status=OPEN'), request('/tickets', { method: 'POST', body: '{}' }), request('/tickets', { method: 'POST', body: '{}' })]);
    expect(apiCalls()).toHaveLength(4);
  });

  it('a read started after a write does not join one started before it', async () => {
    let releaseOld: (r: Response) => void = () => {};
    fetchMock
      .mockReturnValueOnce(new Promise<Response>((r) => { releaseOld = r; }))
      .mockResolvedValueOnce(ok({ saved: true }))
      .mockResolvedValueOnce(ok({ v: 'new' }));
    const before = request('/tickets');
    await request('/tickets/1', { method: 'PATCH', body: '{}' });
    const after = request('/tickets');
    releaseOld(ok({ v: 'old' }));
    expect(await before).toEqual({ v: 'old' });
    expect(await after).toEqual({ v: 'new' });
  });
});

describe('/auth/me on a page load with a session', () => {
  it('waits for the renewed token instead of going out without one', async () => {
    localStorage.setItem(SESSION_MARKER, '1');
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/session/refresh')) return new Response(JSON.stringify({ accessToken: 'tok-1' }), { status: 200 });
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      return auth ? ok({ id: 'me' }) : new Response('{}', { status: 401 });
    });
    expect(await request('/auth/me')).toEqual({ id: 'me' });
    const me = apiCalls();
    expect(me).toHaveLength(1);
    expect((me[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok-1' });
  });
});
