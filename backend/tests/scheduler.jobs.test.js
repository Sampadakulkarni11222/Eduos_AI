import { describe, it, expect, beforeEach } from 'vitest';
import { seedRoles, seedPerson, inSchool, OAK, RIVER } from './support/mcpSchool.js';
import { School } from '../src/models/school.model.js';
import { JobRun } from '../src/models/jobRun.model.js';
import { MessageOutbox } from '../src/models/messaging.model.js';
import { Notification } from '../src/models/notification.model.js';
import { Licence } from '../src/models/compliance.model.js';
import * as messaging from '../src/modules/messaging/messaging.service.js';
import { tick, JOBS } from '../src/jobs/scheduler.js';

/**
 * The scheduler: each job runs once per school per window, a second process
 * cannot repeat it, one school's failure does not stop another's, and the work
 * it does is the same idempotent work an administrator can trigger by hand.
 */

let people;
const inOak = (fn) => inSchool(OAK, fn);

beforeEach(async () => {
  const roles = await seedRoles();
  people = {};
  for (const key of ['ADMIN', 'COMPLIANCE', 'TEACHER']) people[key] = await seedPerson({ roleKey: key, roleId: roles[key] });
  await School.create([{ slug: OAK, name: 'Oakridge Academy' }, { slug: RIVER, name: 'Riverside School' }, { slug: 'closed', name: 'Closed School', status: 'SUSPENDED' }]);
});

describe('scheduler', () => {
  it('runs every job once per active school per window, and not again in the same window', async () => {
    const now = new Date('2026-10-14T05:00:00Z');
    const first = await tick(now);
    expect(first).toHaveLength(JOBS.length * 2);
    expect(first.every((r) => r.ok)).toBe(true);
    expect(first.some((r) => r.tenantId === 'closed')).toBe(false);

    // A second process, or a second tick a moment later, finds the window taken.
    expect(await tick(new Date(now.getTime() + 30_000))).toEqual([]);
    expect(await JobRun.countDocuments()).toBe(JOBS.length * 2);

    // Sixteen minutes on, only the jobs with a window of fifteen minutes or less are due again.
    const later = await tick(new Date(now.getTime() + 16 * 60_000));
    expect([...new Set(later.map((r) => r.job))].sort()).toEqual(['lectures.reminders', 'messaging.release']);
  });

  it('releases a message held for quiet hours without anyone asking', async () => {
    const to = people.TEACHER.actor;
    await inOak(() => messaging.updatePreferences(to, { whatsappOptIn: true }));
    // 18:00 UTC is 23:30 in India: inside the default quiet hours.
    await inOak(() => messaging.sendOperational({
      templateKey: 'GENERAL_NOTICE', recipientProfileIds: [to.profileId], variables: { title: 'Staff meeting', body: 'At 9' },
      idempotencyKey: 'held-1', now: new Date('2026-10-13T18:00:00Z'),
    }));
    expect((await inOak(() => MessageOutbox.findOne({ idempotencyKey: 'held-1' }).lean())).status).toBe('DEFERRED');

    await tick(new Date(Date.now() + 86_400_000));
    // No WhatsApp credentials in tests, so the honest outcome is SIMULATED.
    expect((await inOak(() => MessageOutbox.findOne({ idempotencyKey: 'held-1' }).lean())).status).toBe('SIMULATED');
  });

  it('reminds the compliance officer of a licence about to expire, once a week rather than every day', async () => {
    const soon = new Date(Date.now() + 10 * 86_400_000);
    await inOak(() => Licence.create({ title: 'Fire safety certificate', kind: 'CERTIFICATE', expiresOn: soon, renewalLeadDays: 60 }));
    const day1 = new Date();
    await tick(day1);
    const mine = () => inOak(() => Notification.countDocuments({ recipientProfileId: people.COMPLIANCE.actor.profileId }));
    expect(await mine()).toBe(1);
    // Next day, same week of the reminder cycle: the outbox row exists, so no second announcement.
    const key = (await inOak(() => MessageOutbox.findOne({ relatedEntityType: 'LICENCE' }).lean())).idempotencyKey;
    await inOak(() => messaging.sendOperational({ templateKey: 'DEADLINE_REMINDER', recipientProfileIds: [people.COMPLIANCE.actor.profileId], variables: { title: 'Fire safety certificate expires', dueOn: '2026-10-24' }, idempotencyKey: key }));
    expect(await mine()).toBe(1);
  });

  it('a job that fails for one school is recorded and does not stop the rest', async () => {
    const original = JOBS[0].run;
    JOBS[0].run = async () => { throw new Error('boom'); };
    try {
      const out = await tick(new Date('2026-10-15T05:00:00Z'));
      expect(out.filter((r) => !r.ok)).toHaveLength(2);
      expect(out.filter((r) => r.ok)).toHaveLength((JOBS.length - 1) * 2);
      expect((await JobRun.findOne({ ok: false }).lean()).error).toBe('boom');
    } finally { JOBS[0].run = original; }
  });
});
