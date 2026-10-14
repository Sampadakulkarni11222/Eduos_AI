import { describe, it, expect, beforeEach } from 'vitest';
import { seedRoles, seedPerson, inSchool, OAK } from './support/mcpSchool.js';
import * as safeguarding from '../src/modules/compliance/safeguarding.service.js';
import { SafeguardingCase } from '../src/models/compliance.model.js';

/**
 * Safeguarding audit fixes.
 *
 * C1: an anonymous report kept the reporter's profile id in history[0], which
 *     officers read, and the list named their role ("reported by Librarian").
 * C2: cases sorted by urgency alphabetically: STANDARD above URGENT.
 * C3: an officer who reported a case could still note, assign and record the
 *     statutory report on it.
 * C4: a case could be assigned to any id, including one that does not exist.
 */

let P;
const oak = (fn) => inSchool(OAK, fn);

beforeEach(async () => {
  const roles = await seedRoles();
  P = {};
  for (const key of ['LIBRARIAN', 'TEACHER', 'COMPLIANCE']) P[key] = await seedPerson({ roleKey: key, roleId: roles[key], displayName: `${key} person` });
  P.OFFICER2 = await seedPerson({ roleKey: 'COMPLIANCE', roleId: roles.COMPLIANCE, displayName: 'Second officer' });
});

describe('C1: anonymous reporters stay anonymous', () => {
  it('neither the case, its history nor the list identifies the reporter', async () => {
    const r = await oak(() => safeguarding.report(P.LIBRARIAN.actor, { category: 'BULLYING', description: 'Name-calling at lunch.', anonymousToStaff: true }));
    const opened = await oak(() => safeguarding.get(P.COMPLIANCE.actor, r.id));
    expect(opened.reportedByProfileId).toBeNull();
    expect(opened.reporterRole).toBeNull();
    const ids = JSON.stringify(opened);
    expect(ids).not.toContain(String(P.LIBRARIAN.actor.profileId));
    expect(opened.history[0]).toMatchObject({ actorProfileId: null, actorName: 'Reporter' });
    const [row] = await oak(() => safeguarding.list(P.COMPLIANCE.actor));
    expect(row.reporterRole).toBeNull();
    expect(JSON.stringify(row)).not.toContain(String(P.LIBRARIAN.actor.profileId));
    // The reporter still sees their own report.
    expect(await oak(() => safeguarding.mine(P.LIBRARIAN.actor))).toHaveLength(1);
  });

  it('a named report still says who reported it', async () => {
    const r = await oak(() => safeguarding.report(P.TEACHER.actor, { category: 'OTHER', description: 'Concern.' }));
    const opened = await oak(() => safeguarding.get(P.COMPLIANCE.actor, r.id));
    expect(opened.reportedByProfileId).toBe(String(P.TEACHER.actor.profileId));
    expect(opened.reporterRole).toBe('TEACHER');
  });
});

describe('C2: most urgent first', () => {
  it('orders IMMEDIATE_DANGER, URGENT, STANDARD regardless of age', async () => {
    for (const urgency of ['URGENT', 'STANDARD', 'IMMEDIATE_DANGER', 'STANDARD', 'URGENT']) {
      await oak(() => safeguarding.report(P.TEACHER.actor, { category: 'OTHER', urgency, description: `case ${urgency}` }));
    }
    const rows = await oak(() => safeguarding.list(P.COMPLIANCE.actor));
    expect(rows.map((r) => r.urgency)).toEqual(['IMMEDIATE_DANGER', 'URGENT', 'URGENT', 'STANDARD', 'STANDARD']);
  });
});

describe('C3/C4: who handles a case', () => {
  it('an officer who reported a case cannot touch it at all', async () => {
    const r = await oak(() => safeguarding.report(P.COMPLIANCE.actor, { category: 'CHILD_PROTECTION', description: 'Disclosure.' }));
    for (const body of [{ note: 'my note' }, { assignedOfficerProfileId: String(P.OFFICER2.actor.profileId) }, { statutoryReport: { required: true, authority: 'SJPU', reportedAt: new Date().toISOString() } }, { status: 'UNDER_REVIEW' }]) {
      await expect(oak(() => safeguarding.update(P.COMPLIANCE.actor, r.id, body))).rejects.toMatchObject({ statusCode: 403, code: 'SELF_HANDLING' });
    }
    const c = await oak(() => SafeguardingCase.findById(r.id).lean());
    expect(c.notesEnc).toHaveLength(0);
    expect(c.assignedOfficerProfileId ?? null).toBeNull();
    // Another officer can, but cannot hand it back to the reporter.
    await expect(oak(() => safeguarding.update(P.OFFICER2.actor, r.id, { assignedOfficerProfileId: String(P.COMPLIANCE.actor.profileId) })))
      .rejects.toMatchObject({ code: 'SELF_HANDLING' });
    const ok = await oak(() => safeguarding.update(P.OFFICER2.actor, r.id, { assignedOfficerProfileId: String(P.OFFICER2.actor.profileId), note: 'Taking this' }));
    expect(ok.assignedOfficerProfileId).toBe(String(P.OFFICER2.actor.profileId));
  });

  it('only a designated officer can be assigned', async () => {
    const r = await oak(() => safeguarding.report(P.TEACHER.actor, { category: 'OTHER', description: 'Concern.' }));
    await expect(oak(() => safeguarding.update(P.COMPLIANCE.actor, r.id, { assignedOfficerProfileId: '64b000000000000000000000' })))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_ASSIGNEE' });
    await expect(oak(() => safeguarding.update(P.COMPLIANCE.actor, r.id, { assignedOfficerProfileId: String(P.LIBRARIAN.actor.profileId) })))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_ASSIGNEE' });
    const ok = await oak(() => safeguarding.update(P.COMPLIANCE.actor, r.id, { assignedOfficerProfileId: String(P.OFFICER2.actor.profileId) }));
    expect(ok.assignedOfficerProfileId).toBe(String(P.OFFICER2.actor.profileId));
  });
});
