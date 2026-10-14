import { describe, it, expect } from 'vitest';
import { shortCache, forgetCached, permissionKey } from '../src/utils/shortCache.js';

/** The live boards share a few seconds of answers; these are the rules that keep that safe. */
describe('short cache for live boards', () => {
  it('computes once for concurrent and repeated requests inside the window', async () => {
    let runs = 0;
    const compute = async () => { runs += 1; await new Promise((r) => setTimeout(r, 20)); return { n: runs }; };
    const answers = await Promise.all([1, 2, 3].map(() => shortCache('k1', 1000, compute)));
    expect(runs).toBe(1);
    expect(answers.every((a) => a.n === 1)).toBe(true);
    expect((await shortCache('k1', 1000, compute)).n).toBe(1);
  });

  it('does not remember failures, and forgets on request', async () => {
    let runs = 0;
    await expect(shortCache('k2', 1000, async () => { runs += 1; throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await shortCache('k2', 1000, async () => { runs += 1; return 'ok'; })).toBe('ok');
    forgetCached('k2');
    expect(await shortCache('k2', 1000, async () => { runs += 1; return 'again'; })).toBe('again');
    expect(runs).toBe(3);
  });

  it('is off when the window is zero', async () => {
    let runs = 0;
    await shortCache('k3', 0, async () => { runs += 1; });
    await shortCache('k3', 0, async () => { runs += 1; });
    expect(runs).toBe(2);
  });

  it('gives readers with different grants different keys', () => {
    expect(permissionKey({ 'a.read': 'ALL', 'b.read': 'OWN' })).toBe(permissionKey({ 'b.read': 'OWN', 'a.read': 'ALL' }));
    expect(permissionKey({ 'a.read': 'ALL' })).not.toBe(permissionKey({ 'a.read': 'OWN' }));
  });
});

describe('cached GET responses', () => {
  it('replays a successful answer for the same key, never an error, and never a write', async () => {
    const { cacheGetResponses } = await import('../src/utils/shortCache.js');
    const mw = cacheGetResponses((req) => `t:${req.who}:${req.originalUrl}`, 1000);
    const call = (req, status, body) => new Promise((resolve) => {
      const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b, cached: true }); return this; } };
      mw(req, res, () => { res.status(status); res.json(body); });
    });
    expect((await call({ method: 'GET', who: 'a', originalUrl: '/d' }, 200, { n: 1 })).body).toEqual({ n: 1 });
    expect((await call({ method: 'GET', who: 'a', originalUrl: '/d' }, 200, { n: 2 })).body).toEqual({ n: 1 });
    // Another person, or another address, is computed afresh.
    expect((await call({ method: 'GET', who: 'b', originalUrl: '/d' }, 200, { n: 3 })).body).toEqual({ n: 3 });
    expect((await call({ method: 'GET', who: 'a', originalUrl: '/e' }, 500, { err: 1 })).status).toBe(500);
    expect((await call({ method: 'GET', who: 'a', originalUrl: '/e' }, 200, { n: 4 })).body).toEqual({ n: 4 });
    expect((await call({ method: 'POST', who: 'a', originalUrl: '/d' }, 200, { n: 5 })).body).toEqual({ n: 5 });
  });
});
