import { describe, it, expect, beforeEach } from 'vitest';
import { seedRoles, seedPerson, inSchool, OAK, RIVER } from './support/mcpSchool.js';
import * as approvals from '../src/modules/approvals/approval.service.js';
import { ApprovalRequest } from '../src/models/approval.model.js';
import { MessageOutbox } from '../src/models/messaging.model.js';
import * as messaging from '../src/modules/messaging/messaging.service.js';

/**
 * The approval engine's invariants: stage planning by amount, maker-checker,
 * current-stage-only decisions, return/resubmit, delegation, conflicts,
 * policy overrides and tenant isolation.
 */

let roles;
let people;
const inOak = (fn) => inSchool(OAK, fn);

beforeEach(async () => {
  roles = await seedRoles();
  people = {};
  for (const key of ['ADMIN', 'FINANCE', 'PRINCIPAL', 'TRUSTEE', 'TEACHER', 'HR']) {
    people[key] = await seedPerson({ roleKey: key, roleId: roles[key], displayName: `${key} person` });
  }
  people.PRINCIPAL_B = await seedPerson({ roleKey: 'PRINCIPAL', roleId: roles.PRINCIPAL, displayName: 'Vice principal acting' });
  people.RIVER_PRINCIPAL = await seedPerson({ roleKey: 'PRINCIPAL', roleId: roles.PRINCIPAL, tenantId: RIVER });
});

const raise = (who, body) => inOak(() => approvals.createRequest(people[who].actor, body));

describe('stage planning', () => {
  it('a small purchase needs Finance then the Principal', async () => {
    const r = await raise('TEACHER', { category: 'PROCUREMENT', title: 'Lab glassware', amountPaise: 2_000_000 });
    expect(r.stages.map((s) => s.approverRole)).toEqual(['FINANCE', 'PRINCIPAL']);
    expect(r.currentApproverRole).toBe('FINANCE');
    expect(r.refNo).toMatch(/^APR\/\d{4}\/0001$/);
  });

  it('a large purchase adds the governing body', async () => {
    const r = await raise('TEACHER', { category: 'PROCUREMENT', title: 'Smart boards', amountPaise: 60_000_000 });
    expect(r.stages.map((s) => s.approverRole)).toEqual(['FINANCE', 'PRINCIPAL', 'TRUSTEE']);
  });

  it('a school policy overrides the default', async () => {
    await inOak(() => approvals.setPolicy(people.PRINCIPAL.actor, 'EVENT', {
      stages: [{ name: 'Admin', approverRole: 'ADMIN', minAmountPaise: 0 }, { name: 'Principal', approverRole: 'PRINCIPAL', minAmountPaise: 0 }],
      dueDays: 5,
    }));
    const r = await raise('TEACHER', { category: 'EVENT', title: 'Science fair' });
    expect(r.stages.map((s) => s.approverRole)).toEqual(['ADMIN', 'PRINCIPAL']);
  });
});

describe('who may decide', () => {
  it('only the current stage approver can decide; a requester never can', async () => {
    const r = await raise('FINANCE', { category: 'PAYMENT', title: 'Vendor payment', amountPaise: 100 });
    // Finance raised it; the principal stage is current.
    await expect(inOak(() => approvals.decide(people.FINANCE.actor, r.id, { action: 'APPROVE' })))
      .rejects.toMatchObject({ code: 'SELF_APPROVAL' });
    await expect(inOak(() => approvals.decide(people.TRUSTEE.actor, r.id, { action: 'APPROVE' })))
      .rejects.toMatchObject({ code: 'NOT_STAGE_APPROVER' });
    const done = await inOak(() => approvals.decide(people.PRINCIPAL.actor, r.id, { action: 'APPROVE', comment: 'ok' }));
    expect(done.status).toBe('APPROVED');
  });

  it('the principal cannot skip the finance stage', async () => {
    const r = await raise('TEACHER', { category: 'PROCUREMENT', title: 'Chairs', amountPaise: 500_000 });
    await expect(inOak(() => approvals.decide(people.PRINCIPAL.actor, r.id, { action: 'APPROVE' })))
      .rejects.toMatchObject({ code: 'NOT_STAGE_APPROVER' });
    const afterFinance = await inOak(() => approvals.decide(people.FINANCE.actor, r.id, { action: 'APPROVE' }));
    expect(afterFinance.status).toBe('PENDING');
    expect(afterFinance.currentApproverRole).toBe('PRINCIPAL');
    const final = await inOak(() => approvals.decide(people.PRINCIPAL.actor, r.id, { action: 'APPROVE' }));
    expect(final.status).toBe('APPROVED');
    expect(final.history.map((h) => h.action)).toEqual(expect.arrayContaining(['SUBMITTED']));
  });

  it('reject and return require a reason', async () => {
    const r = await raise('TEACHER', { category: 'TRAVEL', title: 'Workshop travel' });
    await expect(inOak(() => approvals.decide(people.PRINCIPAL.actor, r.id, { action: 'REJECT' })))
      .rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });

  it('a decided request cannot be decided again', async () => {
    const r = await raise('TEACHER', { category: 'TRAVEL', title: 'Workshop travel' });
    await inOak(() => approvals.decide(people.PRINCIPAL.actor, r.id, { action: 'REJECT', comment: 'No budget' }));
    await expect(inOak(() => approvals.decide(people.PRINCIPAL_B.actor, r.id, { action: 'APPROVE' })))
      .rejects.toMatchObject({ code: 'APPROVAL_NOT_PENDING' });
  });

  it('an approver who declared a conflict is excluded', async () => {
    const r = await raise('TEACHER', { category: 'CONTRACT', title: 'Canteen vendor' });
    await inOak(() => approvals.declareConflict(people.PRINCIPAL.actor, r.id, { declaration: 'Vendor is a relative' }));
    await expect(inOak(() => approvals.decide(people.PRINCIPAL.actor, r.id, { action: 'APPROVE' })))
      .rejects.toMatchObject({ code: 'NOT_STAGE_APPROVER' });
    // Another principal-role holder can still decide.
    const ok = await inOak(() => approvals.decide(people.PRINCIPAL_B.actor, r.id, { action: 'APPROVE' }));
    expect(ok.status).toBe('APPROVED');
  });
});

describe('return and resubmit', () => {
  it('returns to the requester and resumes at the same stage with a new version', async () => {
    const r = await raise('TEACHER', { category: 'PROCUREMENT', title: 'Projector', amountPaise: 3_000_000 });
    await inOak(() => approvals.decide(people.FINANCE.actor, r.id, { action: 'APPROVE' }));
    const returned = await inOak(() => approvals.decide(people.PRINCIPAL.actor, r.id, { action: 'RETURN', comment: 'Attach 3 quotes' }));
    expect(returned.status).toBe('RETURNED');
    await expect(inOak(() => approvals.resubmit(people.ADMIN.actor, r.id, { changeNote: 'x' }))).rejects.toThrow(/Only the requester/);
    const again = await inOak(() => approvals.resubmit(people.TEACHER.actor, r.id, { changeNote: 'Quotes attached' }));
    expect(again.status).toBe('PENDING');
    expect(again.version).toBe(2);
    expect(again.currentApproverRole).toBe('PRINCIPAL');
  });
});

describe('delegation', () => {
  it('lets a named delegate decide within the delegated categories and amount', async () => {
    await inOak(() => approvals.createDelegation(people.PRINCIPAL.actor, {
      toProfileId: people.HR.actor.profileId, categories: ['STAFF_LEAVE'], maxAmountPaise: 0,
      startsOn: new Date(Date.now() - 1000).toISOString(), endsOn: new Date(Date.now() + 86_400_000).toISOString(),
    }));
    const leave = await raise('TEACHER', { category: 'STAFF_LEAVE', title: 'Casual leave' });
    const travel = await raise('TEACHER', { category: 'TRAVEL', title: 'Trip' });
    const inbox = await inOak(() => approvals.inbox(people.HR.actor));
    expect(inbox.map((r) => r.id)).toEqual([leave.id]);
    const decided = await inOak(() => approvals.decide(people.HR.actor, leave.id, { action: 'APPROVE' }));
    expect(decided.stages[0].onBehalfOfRole).toBe('PRINCIPAL');
    await expect(inOak(() => approvals.decide(people.HR.actor, travel.id, { action: 'APPROVE' })))
      .rejects.toMatchObject({ code: 'NOT_STAGE_APPROVER' });
  });
});

describe('records, notifications and isolation', () => {
  it('runs the owning module handler inside the decision', async () => {
    const seen = [];
    approvals.registerApprovalHandler('TestThing', { onApproved: async (req) => { seen.push(req.entityId); } });
    const r = await inOak(() => approvals.createRequest(people.TEACHER.actor, { category: 'OTHER', title: 'x' }, { entityType: 'TestThing', entityId: 'abc' }));
    await expect(inOak(() => approvals.createRequest(people.TEACHER.actor, { category: 'OTHER', title: 'dup' }, { entityType: 'TestThing', entityId: 'abc' })))
      .rejects.toMatchObject({ code: 'APPROVAL_ALREADY_OPEN' });
    await inOak(() => approvals.decide(people.PRINCIPAL.actor, r.id, { action: 'APPROVE' }));
    expect(seen).toEqual(['abc']);
  });

  it('a failing handler rolls the decision back', async () => {
    approvals.registerApprovalHandler('Fragile', { onApproved: async () => { throw new Error('downstream refused'); } });
    const r = await inOak(() => approvals.createRequest(people.TEACHER.actor, { category: 'OTHER', title: 'x' }, { entityType: 'Fragile', entityId: '1' }));
    await expect(inOak(() => approvals.decide(people.PRINCIPAL.actor, r.id, { action: 'APPROVE' }))).rejects.toThrow('downstream refused');
    const stored = await inOak(() => ApprovalRequest.findById(r.id).lean());
    expect(stored.status).toBe('PENDING');
  });

  it('principal stages are announced on WhatsApp once per stage, simulated without credentials', async () => {
    await raise('TEACHER', { category: 'TRAVEL', title: 'Trip' });
    const rows = await inOak(() => MessageOutbox.find({}).lean());
    // Two principals in the school; none opted in, so nothing is sent.
    expect(rows).toHaveLength(2);
    expect(rows.every((m) => m.status === 'SKIPPED_NO_CONSENT')).toBe(true);
  });

  it('a message held for quiet hours is released once, when asked, and never sent twice', async () => {
    const to = people.TEACHER.actor;
    await inOak(() => messaging.updatePreferences(to, { whatsappOptIn: true }));
    // 18:00 UTC is 23:30 in India: inside the default quiet hours.
    const night = new Date('2026-10-13T18:00:00Z');
    const [held] = await inOak(() => messaging.sendOperational({
      templateKey: 'GENERAL_NOTICE', recipientProfileIds: [to.profileId], variables: { title: 'Staff meeting', body: 'At 9' },
      idempotencyKey: 'quiet-1', now: night,
    }));
    expect(held.status).toBe('DEFERRED');

    const early = await inOak(() => messaging.releaseDeferred(people.ADMIN.actor, { now: night }));
    expect(early.released).toBe(0);
    const morning = new Date('2026-10-14T03:00:00Z');
    const out = await inOak(() => messaging.releaseDeferred(people.ADMIN.actor, { now: morning }));
    // No WhatsApp credentials in tests, so the honest outcome is SIMULATED.
    expect(out).toEqual({ released: 1, byStatus: { SIMULATED: 1 } });
    const again = await inOak(() => messaging.releaseDeferred(people.ADMIN.actor, { now: morning }));
    expect(again.released).toBe(0);
  });

  it('another school cannot see or decide the request', async () => {
    const r = await raise('TEACHER', { category: 'TRAVEL', title: 'Trip' });
    await expect(inSchool(RIVER, () => approvals.decide(people.RIVER_PRINCIPAL.actor, r.id, { action: 'APPROVE' })))
      .rejects.toMatchObject({ statusCode: 404 });
    const inbox = await inSchool(RIVER, () => approvals.inbox(people.RIVER_PRINCIPAL.actor));
    expect(inbox).toHaveLength(0);
  });

  it('OWN scope lists only the caller\'s own requests', async () => {
    await raise('TEACHER', { category: 'TRAVEL', title: 'Mine' });
    await raise('HR', { category: 'TRAVEL', title: 'Theirs' });
    const mine = await inOak(() => approvals.list(people.TEACHER.actor, 'OWN', {}));
    expect(mine.items.map((r) => r.title)).toEqual(['Mine']);
    const all = await inOak(() => approvals.list(people.PRINCIPAL.actor, 'ALL', {}));
    expect(all.total).toBe(2);
  });
});
