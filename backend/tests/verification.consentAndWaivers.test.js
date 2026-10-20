import { describe, it, expect, beforeEach } from 'vitest';
import { seedRoles, seedPerson, inSchool, OAK } from './support/mcpSchool.js';
import * as verification from '../src/modules/administration/verification.service.js';

/**
 * F14: consent could be recorded at initiation without its evidence (a signed
 *      form), while recordConsent() demanded one; checks then ran on it.
 * F15: HR could waive a DRIVER's police check with only a note.
 */

const oak = (fn) => inSchool(OAK, fn);
let P;

beforeEach(async () => {
  const roles = await seedRoles();
  P = {};
  for (const key of ['HR', 'PRINCIPAL']) P[key] = await seedPerson({ roleKey: key, roleId: roles[key], displayName: `${key} person` });
});

describe('F14: consent at initiation needs its evidence', () => {
  it('refuses consent without the signed form, accepts it with one', async () => {
    await expect(oak(() => verification.initiate(P.HR.actor, { subjectType: 'DRIVER', subjectName: 'Ravi Kumar', consent: { obtained: true } })))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/evidenceUrl/) });
    const c = await oak(() => verification.initiate(P.HR.actor, { subjectType: 'DRIVER', subjectName: 'Ravi Kumar', consent: { obtained: true, evidenceUrl: '/uploads/consent-ravi.pdf' } }));
    expect(c.consent).toMatchObject({ obtained: true, evidenceUrl: '/uploads/consent-ravi.pdf' });
  });

  it('initiating without consent still works, and consent is then recorded with evidence', async () => {
    const c = await oak(() => verification.initiate(P.HR.actor, { subjectType: 'TEACHER', subjectName: 'Anita Rao' }));
    expect(c.consent?.obtained).not.toBe(true);
  });
});

describe('F15: a driver\'s police and licence checks cannot be waived', () => {
  it('refuses to waive POLICE or DRIVING_LICENCE for a driver; other checks can still be waived with a note', async () => {
    const c = await oak(() => verification.initiate(P.HR.actor, { subjectType: 'DRIVER', subjectName: 'Ravi Kumar', consent: { obtained: true, evidenceUrl: '/uploads/c.pdf' } }));
    const byType = Object.fromEntries(c.checks.map((x) => [x.type, String(x._id)]));
    for (const type of ['POLICE', 'DRIVING_LICENCE']) {
      await expect(oak(() => verification.recordCheck(P.HR.actor, c.id, byType[type], { status: 'NOT_STARTED', waive: true, note: 'Driver urgently needed' })))
        .rejects.toMatchObject({ statusCode: 409, code: 'CHECK_NOT_WAIVABLE' });
    }
    const after = await oak(() => verification.recordCheck(P.HR.actor, c.id, byType.REFERENCE, { status: 'NOT_STARTED', waive: true, note: 'Previous employer closed down' }));
    expect(after.checks.find((x) => x.type === 'POLICE').required).toBe(true);
    expect(after.checks.find((x) => x.type === 'REFERENCE').required).toBe(false);
  });

  it('a custom check list for a driver cannot leave the police and licence checks out', async () => {
    const c = await oak(() => verification.initiate(P.HR.actor, { subjectType: 'DRIVER', subjectName: 'Suresh', checks: ['IDENTITY'] }));
    expect(c.checks.map((x) => x.type).sort()).toEqual(['DRIVING_LICENCE', 'IDENTITY', 'POLICE']);
  });
});
