import { describe, it, expect, beforeEach } from 'vitest';
import { seedRoles, seedPerson, inSchool, OAK } from './support/mcpSchool.js';
import * as governance from '../src/modules/governance/governance.service.js';
import { BoardMeeting } from '../src/models/governance.model.js';

/**
 * Governance audit fixes.
 *
 * T1: after the chair approved the minutes, resolutions, attendance and
 *     actions could still be rewritten (only the minutes text was locked).
 * T2: vote counts were not checked: 40 "for" on a two-member board passed.
 * T3: a PLANNING meeting set for December accepted attendance, minutes and a
 *     resolution today, and its minutes could be approved.
 * T-UI2: the screen offered "Approve minutes" to every member; the API now
 *     says who may (isChair / canApproveMinutes).
 */

let P;
const oak = (fn) => inSchool(OAK, fn);
const DAY = 86_400_000;

beforeEach(async () => {
  const roles = await seedRoles();
  P = {};
  for (const key of ['PRINCIPAL', 'TRUSTEE']) P[key] = await seedPerson({ roleKey: key, roleId: roles[key], displayName: `${key} person` });
  P.TRUSTEE2 = await seedPerson({ roleKey: 'TRUSTEE', roleId: roles.TRUSTEE, displayName: 'Second trustee' });
});

async function meeting({ scheduledAt } = {}) {
  const m = await oak(() => governance.create(P.PRINCIPAL.actor, {
    body: 'TRUST_BOARD', title: 'Board meeting', quorum: 2,
    memberProfileIds: [P.TRUSTEE.actor.profileId, P.PRINCIPAL.actor.profileId, P.TRUSTEE2.actor.profileId],
    memberRoles: { [P.TRUSTEE.actor.profileId]: 'CHAIR' },
    ...(scheduledAt ? { scheduledAt } : { proposedSlots: [new Date(Date.now() + 60 * DAY).toISOString()] }),
  }));
  const full = await oak(() => governance.get(P.PRINCIPAL.actor, 'ALL', m.id));
  return { m, members: full.members };
}

const attendTwo = (members) => [{ memberId: members[0]._id, attended: true }, { memberId: members[1]._id, attended: true }];

describe('T3: nothing is recorded for a meeting that has not happened', () => {
  it('refuses attendance, minutes and resolutions for a PLANNING meeting', async () => {
    const { m, members } = await meeting();
    await expect(oak(() => governance.record(P.PRINCIPAL.actor, 'ALL', m.id, { attendance: attendTwo(members), minutes: 'Met.' })))
      .rejects.toMatchObject({ statusCode: 409, code: 'MEETING_NOT_HELD' });
  });

  it('refuses them for a scheduled meeting whose time has not come', async () => {
    const { m, members } = await meeting({ scheduledAt: new Date(Date.now() + 5 * DAY).toISOString() });
    await expect(oak(() => governance.record(P.PRINCIPAL.actor, 'ALL', m.id, { attendance: attendTwo(members) })))
      .rejects.toMatchObject({ code: 'MEETING_NOT_HELD' });
    expect((await oak(() => BoardMeeting.findById(m.id).lean())).status).toBe('SCHEDULED');
  });
});

describe('T2: votes are bounded by who was present', () => {
  it('refuses more votes than voting members present', async () => {
    const { m, members } = await meeting({ scheduledAt: new Date(Date.now() - 3_600_000).toISOString() });
    await expect(oak(() => governance.record(P.PRINCIPAL.actor, 'ALL', m.id, {
      attendance: attendTwo(members), resolutions: [{ text: 'Approve the budget', votesFor: 40 }],
    }))).rejects.toMatchObject({ statusCode: 400, code: 'VOTES_EXCEED_PRESENT' });
    await expect(oak(() => governance.record(P.PRINCIPAL.actor, 'ALL', m.id, {
      attendance: attendTwo(members), resolutions: [{ text: 'Approve the budget', votesFor: 2, abstentions: 1 }],
    }))).rejects.toMatchObject({ code: 'VOTES_EXCEED_PRESENT' });
    const ok = await oak(() => governance.record(P.PRINCIPAL.actor, 'ALL', m.id, {
      attendance: attendTwo(members), resolutions: [{ text: 'Approve the budget', votesFor: 1, abstentions: 1 }],
    }));
    expect(ok.resolutions[0].outcome).toBe('PASSED');
  });
});

describe('T1: an approved record is locked', () => {
  it('refuses any change to attendance, resolutions, actions or minutes after approval', async () => {
    const { m, members } = await meeting({ scheduledAt: new Date(Date.now() - 3_600_000).toISOString() });
    await oak(() => governance.record(P.PRINCIPAL.actor, 'ALL', m.id, {
      attendance: attendTwo(members), minutes: 'The board approved the budget.',
      resolutions: [{ text: 'Approve annual budget', votesFor: 2 }],
      actions: [{ title: 'Publish the budget', ownerProfileId: P.PRINCIPAL.actor.profileId }],
    }));
    await oak(() => governance.approveMinutes(P.TRUSTEE.actor, 'OWN', m.id));
    for (const body of [
      { resolutions: [{ text: 'Approve annual budget AND a new bus purchase', votesFor: 2 }] },
      { attendance: [{ memberId: members[2]._id, attended: true }] },
      { actions: [] },
      { minutes: 'rewrite' },
    ]) {
      await expect(oak(() => governance.record(P.PRINCIPAL.actor, 'ALL', m.id, body))).rejects.toMatchObject({ statusCode: 409, code: 'MINUTES_LOCKED' });
    }
    const after = await oak(() => BoardMeeting.findById(m.id).lean());
    expect(after.resolutions[0].text).toBe('Approve annual budget');
    expect(after.actions).toHaveLength(1);
    // Action progress is still tracked.
    const done = await oak(() => governance.updateAction(P.PRINCIPAL.actor, 'ALL', m.id, String(after.actions[0]._id), { status: 'DONE' }));
    expect(done.openActions).toBe(0);
  });
});

describe('T-UI2: who may approve minutes', () => {
  it('flags the chair and the principal only', async () => {
    const { m } = await meeting();
    expect((await oak(() => governance.get(P.TRUSTEE.actor, 'OWN', m.id))).canApproveMinutes).toBe(true);
    expect((await oak(() => governance.get(P.PRINCIPAL.actor, 'ALL', m.id))).canApproveMinutes).toBe(true);
    const member = await oak(() => governance.get(P.TRUSTEE2.actor, 'OWN', m.id));
    expect([member.isChair, member.canApproveMinutes]).toEqual([false, false]);
  });
});
