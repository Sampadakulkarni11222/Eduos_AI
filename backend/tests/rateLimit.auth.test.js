import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { authRateLimiter, authIdentifier } from '../src/middleware/rateLimiter.js';
import { env, parseTrustProxy } from '../src/config/env.js';

/**
 * X1: the sign-in limiter was keyed on the IP alone (30 per 15 minutes), so a
 * school whose staff share one public address was locked out after thirty
 * sign-ins between them. It is now keyed on address + the email/phone being
 * tried, with a looser ceiling per address.
 *
 * X2: `trust proxy` was hard-wired to 1, so with no proxy in front a forged
 * X-Forwarded-For gave every request a fresh bucket. It now comes from
 * TRUST_PROXY and is off by default.
 */

function harness(trustProxy) {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.use(express.json());
  app.post('/login', authRateLimiter, (_req, res) => res.json({ ok: true }));
  return app;
}

let server; let base;
let proxied; let proxiedBase;

beforeAll(async () => {
  server = await new Promise((r) => { const s = harness(env.TRUST_PROXY).listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  proxied = await new Promise((r) => { const s = harness(1).listen(0, '127.0.0.1', () => r(s)); });
  proxiedBase = `http://127.0.0.1:${proxied.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => proxied.close(r));
});

const login = (url, body, headers = {}) => fetch(`${url}/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

describe('X1: sign-in limiter keyed on address + account', () => {
  it('lets a whole staff room behind one address sign in', async () => {
    const statuses = [];
    for (let i = 0; i < env.RATE_LIMIT_AUTH_MAX + 10; i++) {
      statuses.push((await login(proxiedBase, { email: `teacher${i}@school.test`, password: 'x' }, { 'x-forwarded-for': '203.0.113.5' })).status);
    }
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it('still stops password guessing against one account from one address', async () => {
    let last;
    for (let i = 0; i <= env.RATE_LIMIT_AUTH_MAX; i++) {
      last = await login(proxiedBase, { email: 'Victim@School.test ', password: `guess${i}` }, { 'x-forwarded-for': '203.0.113.6' });
    }
    expect(last.status).toBe(429);
    expect((await last.json()).error?.code ?? 'RATE_LIMITED').toBe('RATE_LIMITED');
    // The same address can still sign in as somebody else.
    const other = await login(proxiedBase, { email: 'colleague@school.test', password: 'x' }, { 'x-forwarded-for': '203.0.113.6' });
    expect(other.status).toBe(200);
  });

  it('caps one address across all accounts at RATE_LIMIT_AUTH_IP_MAX', async () => {
    let last;
    for (let i = 0; i <= env.RATE_LIMIT_AUTH_IP_MAX; i++) {
      last = await login(proxiedBase, { phone: `+9190000${String(i).padStart(5, '0')}` }, { 'x-forwarded-for': '203.0.113.7' });
    }
    expect(last.status).toBe(429);
  });

  it('normalises the identifier', () => {
    expect(authIdentifier({ email: ' A@B.com ' })).toBe('e:a@b.com');
    expect(authIdentifier({ phone: '+91 98765-43210' })).toBe('p:919876543210');
    expect(authIdentifier({ idToken: 'x' })).toBeNull();
    expect(authIdentifier(null)).toBeNull();
  });
});

describe('X2: trust proxy is opt-in', () => {
  it('defaults to off', () => {
    expect(env.TRUST_PROXY).toBe(false);
  });

  it.each([
    [undefined, false], ['', false], ['false', false], ['0', false],
    ['1', 1], ['2', 2], ['true', true], ['loopback, 10.0.0.0/8', 'loopback, 10.0.0.0/8'],
  ])('parses %j as %j', (raw, expected) => {
    expect(parseTrustProxy(raw)).toBe(expected);
  });

  it('a forged X-Forwarded-For does not buy a fresh bucket when no proxy is trusted', async () => {
    for (let i = 0; i < env.RATE_LIMIT_AUTH_MAX; i++) {
      await login(base, { email: 'forger@school.test' }, { 'x-forwarded-for': `10.77.0.${i % 250}` });
    }
    const res = await login(base, { email: 'forger@school.test' }, { 'x-forwarded-for': '10.77.9.9' });
    expect(res.status).toBe(429);
  });
});
