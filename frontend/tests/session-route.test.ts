import { describe, it, expect } from 'vitest';
import { POST } from '@/app/api/session/route';

/**
 * POST /api/session stores a refresh token in the httpOnly cookie. It must not
 * accept one from a cross-site form, which can only send form or text/plain
 * bodies — otherwise another site could sign a visitor in as someone else.
 */
describe('POST /api/session', () => {
  const post = (contentType: string) =>
    POST(new Request('http://localhost:3000/api/session', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: JSON.stringify({ refreshToken: 'abc' }),
    }));

  it('refuses a text/plain body (the shape a cross-site form can send)', async () => {
    const res = await post('text/plain');
    expect(res.status).toBe(415);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('stores the token from a JSON request', async () => {
    const res = await post('application/json');
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);
  });
});
