import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { Account } from '../src/models/account.model.js';
import { RefreshToken } from '../src/models/refreshToken.model.js';
import { generateRefreshToken, hashRefreshToken } from '../src/utils/refreshToken.js';
import { env } from '../src/config/env.js';
import apiRoutes from '../src/routes/index.js';
import { errorHandler, notFoundHandler } from '../src/middleware/errorHandler.js';

/**
 * POST /auth/refresh under load, through the real router.
 *
 * Every refresh reaches the API from the portal's one server address, so the
 * limits here must bound abuse without ever letting honest users sharing an
 * address — or a noisy neighbour on it — sign each other out.
 *
 * `trust proxy` is on in this harness so each test can speak from its own
 * client address via X-Forwarded-For, the way the deployment's proxy reports it.
 */

let server;
let base;
let accountId;

beforeAll(async () => {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use('/api/v1', apiRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  env.FRONTEND_PROXY_SECRET = '';
});

beforeEach(async () => {
  accountId = (await Account.create({ phoneE164: '+919600000001' }))._id;
});

async function session({ expired = false } = {}) {
  const token = generateRefreshToken();
  await RefreshToken.create({
    accountId, tokenHash: hashRefreshToken(token), profileId: null,
    expiresAt: new Date(Date.now() + (expired ? -1 : 1) * 24 * 3600 * 1000),
  });
  return token;
}

const refresh = (token, ip, headers = {}) =>
  fetch(`${base}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
    body: JSON.stringify({ refreshToken: token }),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

describe('honest refreshes', () => {
  it('rotates: the new token works and the old one, replayed later, does not', async () => {
    const first = await refresh(await session(), '10.1.0.1');
    expect(first.status).toBe(200);
    const second = await refresh(first.body.data.refreshToken, '10.1.0.1');
    expect(second.status).toBe(200);
    expect(second.body.data.refreshToken).not.toBe(first.body.data.refreshToken);
  });

  it('lets two tabs refresh the same token at once (rotation grace)', async () => {
    const token = await session();
    const [a, b] = await Promise.all([refresh(token, '10.1.0.2'), refresh(token, '10.1.0.2')]);
    expect([a.status, b.status]).toEqual([200, 200]);
  });

  it('never throttles many users behind one address', async () => {
    const tokens = await Promise.all(Array.from({ length: 150 }, () => session()));
    const statuses = [];
    for (const token of tokens) statuses.push((await refresh(token, '10.1.0.3')).status);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });
});

describe('failed refreshes', () => {
  it('rejects an invalid token and an expired one with 401', async () => {
    expect((await refresh('not-a-token', '10.2.0.1')).status).toBe(401);
    expect((await refresh(await session({ expired: true }), '10.2.0.1')).status).toBe(401);
  });

  it('limits a flood of invalid tokens per address', async () => {
    const statuses = [];
    for (let i = 0; i < 105; i++) statuses.push((await refresh(`bogus-${i}`, '10.2.0.2')).status);
    expect(statuses.slice(0, 100).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    // Another address is unaffected.
    expect((await refresh(await session(), '10.2.0.3')).status).toBe(200);
  });

  it("does not let a flood through the portal's proxy block its honest users", async () => {
    env.FRONTEND_PROXY_SECRET = 'proxy-shared-secret';
    const proxy = { 'x-eduos-proxy-secret': 'proxy-shared-secret' };
    for (let i = 0; i < 105; i++) await refresh(`bogus-proxy-${i}`, '10.3.0.1', proxy);
    // The proxy is trusted, so its (real-client-limited) traffic is not blocked…
    expect((await refresh(await session(), '10.3.0.1', proxy)).status).toBe(200);
    // …while the same address without the secret is an ordinary caller.
    for (let i = 0; i < 105; i++) await refresh(`bogus-direct-${i}`, '10.3.0.1');
    expect((await refresh(await session(), '10.3.0.1')).status).toBe(429);
    // And a wrong secret earns no exemption.
    expect((await refresh(await session(), '10.3.0.1', { 'x-eduos-proxy-secret': 'guess' })).status).toBe(429);
  });
});
