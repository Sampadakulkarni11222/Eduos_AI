import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { seedRoles, seedPerson, inSchool, OAK } from './support/mcpSchool.js';
import * as compliance from '../src/modules/compliance/compliance.service.js';
import { TrainingSession } from '../src/models/compliance.model.js';
import { Notification } from '../src/models/notification.model.js';

/**
 * Compliance audit fixes.
 *
 * C5: POST /compliance/returns/:id/reviewed needed only compliance.read, so a
 *     trustee could review a return and raise the principal's approval.
 * C6: a training dated in December could be marked attended and completed
 *     today, and a completed training could then be cancelled.
 * C7: training notifications printed the time in UTC.
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
  for (const key of ['ADMIN', 'COMPLIANCE', 'TRUSTEE', 'HR', 'TEACHER']) P[key] = await seedPerson({ roleKey: key, roleId: roles[key], displayName: `${key} person` });
  P.COMPLIANCE2 = await seedPerson({ roleKey: 'COMPLIANCE', roleId: roles.COMPLIANCE, displayName: 'Second compliance' });
});

async function call(person, method, path, body) {
  const token = signAccessToken({ accountId: person.actor.accountId, profileId: person.actor.profileId, door: null });
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

async function returnInReview(reviewer) {
  const ret = await oak(() => compliance.createReturn(P.ADMIN.actor, { template: 'UDISE_PLUS_PROFILE', period: '2026-27', dueOn: '2026-12-31' }));
  await oak(() => compliance.sendReturnForReview(P.ADMIN.actor, ret.id, { acknowledgeErrors: true, ...(reviewer ? { reviewerProfileId: reviewer.actor.profileId } : {}) }));
  return ret;
}

describe('C5: reviewing a return', () => {
  it.each(['TRUSTEE', 'HR'])('refuses a %s (compliance.read only) with 403', async (role) => {
    const ret = await returnInReview(null);
    const res = await call(P[role], 'POST', `/compliance/returns/${ret.id}/reviewed`, { decision: 'REQUEST_APPROVAL' });
    expect(res.status).toBe(403);
    expect((await oak(() => compliance.getReturn(ret.id))).status).toBe('IN_REVIEW');
  });

  it('lets the named reviewer review, and nobody else', async () => {
    const ret = await returnInReview(P.COMPLIANCE);
    const other = await call(P.COMPLIANCE2, 'POST', `/compliance/returns/${ret.id}/reviewed`, { decision: 'REQUEST_APPROVAL' });
    expect(other.status).toBe(403);
    expect(other.body.error?.code ?? other.body.code).toBe('NOT_THE_REVIEWER');
    const ok = await call(P.COMPLIANCE, 'POST', `/compliance/returns/${ret.id}/reviewed`, { decision: 'REQUEST_APPROVAL' });
    expect(ok.status).toBe(200);
  });

  it('refuses to name a reviewer who cannot review', async () => {
    const ret = await oak(() => compliance.createReturn(P.ADMIN.actor, { template: 'UDISE_PLUS_PROFILE', period: '2026-27', dueOn: '2026-12-31' }));
    await expect(oak(() => compliance.sendReturnForReview(P.ADMIN.actor, ret.id, { acknowledgeErrors: true, reviewerProfileId: P.TRUSTEE.actor.profileId })))
      .rejects.toMatchObject({ code: 'INVALID_REVIEWER' });
  });
});

describe('C6/C7: trainings', () => {
  const schedule = (at) => oak(() => compliance.scheduleTraining(P.COMPLIANCE.actor, {
    topic: 'POCSO_CHILD_PROTECTION', title: 'POCSO awareness', audience: 'ALL_STAFF', mandatory: true, scheduledAt: at,
  }));

  it('a future training cannot be attended or completed yet', async () => {
    const t = await schedule(new Date(Date.now() + 30 * 86_400_000).toISOString());
    const someone = t.participants[0];
    await expect(oak(() => compliance.recordTrainingAttendance(P.COMPLIANCE.actor, t.id, { attendance: [{ profileId: someone.profileId, status: 'ATTENDED' }] })))
      .rejects.toMatchObject({ statusCode: 409, code: 'TRAINING_NOT_HELD' });
    await expect(oak(() => compliance.recordTrainingAttendance(P.COMPLIANCE.actor, t.id, { complete: true, notes: 'done' })))
      .rejects.toMatchObject({ statusCode: 409, code: 'TRAINING_NOT_HELD' });
    expect((await oak(() => TrainingSession.findById(t.id).lean())).status).not.toBe('COMPLETED');
    // Exempting someone in advance is fine.
    await oak(() => compliance.recordTrainingAttendance(P.COMPLIANCE.actor, t.id, { attendance: [{ profileId: someone.profileId, status: 'EXEMPT' }] }));
  });

  it('a held training completes, and a completed one cannot be cancelled', async () => {
    const t = await schedule(new Date(Date.now() - 3_600_000).toISOString());
    const someone = t.participants[0];
    await oak(() => compliance.recordTrainingAttendance(P.COMPLIANCE.actor, t.id, { attendance: [{ profileId: someone.profileId, status: 'ATTENDED' }], complete: true, notes: 'Sheet signed' }));
    await expect(oak(() => compliance.recordTrainingAttendance(P.COMPLIANCE.actor, t.id, { cancel: true, notes: 'oops' })))
      .rejects.toMatchObject({ statusCode: 409, code: 'TRAINING_COMPLETED' });
    expect((await oak(() => TrainingSession.findById(t.id).lean())).status).toBe('COMPLETED');
  });

  it('the invitation gives the time in IST', async () => {
    await schedule('2026-12-15T04:30:00Z');
    const n = await Notification.findOne({ title: /POCSO awareness/ }).lean();
    expect(n.body).toMatch(/15 Dec/);
    expect(n.body).toMatch(/10:00\s?am/i);
    expect(n.body).not.toMatch(/UTC/);
  });
});
