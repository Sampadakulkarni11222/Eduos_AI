import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { seedRoles, seedPerson, inSchool, OAK } from './support/mcpSchool.js';
import * as correspondence from '../src/modules/administration/correspondence.service.js';

/**
 * F22: correspondence write actions were gated by correspondence.READ. A
 * compliance officer (read ALL, no manage, not owner or assignee) closed a
 * CBSE letter as NO_ACTION with a 200.
 *
 * Now transition and close need correspondence.manage at the route; drafting,
 * submitting, verifying the source and reminders need manage OR being the
 * letter's owner/assignee (checked in the service, so every caller meets it).
 */

const { default: apiRoutes } = await import('../src/routes/index.js');
const { errorHandler, notFoundHandler } = await import('../src/middleware/errorHandler.js');
const { signAccessToken } = await import('../src/utils/jwt.js');

let server; let base; let P;
const oak = (fn) => inSchool(OAK, fn);

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', apiRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

beforeEach(async () => {
  const roles = await seedRoles();
  P = {};
  for (const key of ['ADMIN', 'COMPLIANCE']) P[key] = await seedPerson({ roleKey: key, roleId: roles[key], displayName: `${key} person` });
});

async function call(person, method, path, body) {
  const token = signAccessToken({ accountId: person.actor.accountId, profileId: person.actor.profileId, door: null });
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

const letter = () => oak(() => correspondence.register(P.ADMIN.actor, {
  direction: 'INWARD', counterpartyType: 'BOARD', counterpartyName: 'CBSE Regional Office', subject: 'Affiliation renewal',
  theirReference: 'CBSE/RO/2026/77', ownerProfileId: P.ADMIN.actor.profileId,
}));

describe('F22: read access does not let you change a letter', () => {
  it('a read-only officer who is not on the letter cannot transition, close, draft, submit or set reminders', async () => {
    expect(P.COMPLIANCE.actor.permissions['correspondence.read']).toBe('ALL');
    expect(P.COMPLIANCE.actor.permissions['correspondence.manage']).toBeUndefined();
    const l = await letter();
    const tries = [
      ['transition', { to: 'NO_ACTION', note: 'Not relevant' }],
      ['close', { resolution: 'Closed' }],
      ['draft', { body: 'Sir, ...' }],
      ['submit', {}],
      ['reminders', { at: new Date(Date.now() + 86_400_000).toISOString() }],
      ['verify-source', { method: 'Phone call' }],
    ];
    for (const [action, body] of tries) {
      const res = await call(P.COMPLIANCE, 'POST', `/correspondence/${l.id}/${action}`, body);
      expect(res.status, action).toBe(403);
    }
    const stored = await oak(() => correspondence.get(P.ADMIN.actor, 'ALL', l.id));
    expect(stored.status).not.toBe('NO_ACTION');
    expect(stored.drafts).toHaveLength(0);
  });

  it('an assignee may draft and set reminders; status changes still need manage', async () => {
    const l = await letter();
    await oak(() => correspondence.assign(P.ADMIN.actor, 'ALL', l.id, { assigneeProfileIds: [P.COMPLIANCE.actor.profileId] }));
    expect((await call(P.COMPLIANCE, 'POST', `/correspondence/${l.id}/draft`, { body: 'Respected Sir, the documents are enclosed.' })).status).toBe(200);
    expect((await call(P.COMPLIANCE, 'POST', `/correspondence/${l.id}/reminders`, { at: new Date(Date.now() + 86_400_000).toISOString() })).status).toBe(200);
    expect((await call(P.COMPLIANCE, 'POST', `/correspondence/${l.id}/close`, { resolution: 'x' })).status).toBe(403);
    // A manager can.
    expect((await call(P.ADMIN, 'POST', `/correspondence/${l.id}/transition`, { to: 'IN_PROGRESS' })).status).not.toBe(403);
  });
});
