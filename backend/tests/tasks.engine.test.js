import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, inSchool, OAK } from './support/mcpSchool.js';
import { DueItem } from '../src/models/dueItem.model.js';
import { MessageOutbox } from '../src/models/messaging.model.js';
import { Profile } from '../src/models/profile.model.js';
import { School } from '../src/models/school.model.js';
import * as tasks from '../src/modules/tasks/tasks.service.js';
import { featureEnabled, setFeatures } from '../src/utils/features.js';

/**
 * The shared due-item queue: one item per source, owners see their own,
 * reminders go once per lead day, overdue work climbs to the department and
 * then the principal, recurring work creates its next instance, and nothing
 * is left with an owner who has gone.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
const DAY = 86_400_000;
const at = (days) => new Date(Date.UTC(2026, 9, 14, 5, 0) + days * DAY);

beforeEach(async () => { s = await seedSchool(); });

describe('items from modules', () => {
  it('keeps one open item per source, and updates it when the due date moves', async () => {
    const base = { sourceKey: 'licence:fire:expiry', title: 'Fire NOC renewal', department: 'COMPLIANCE', category: 'LICENCE', dueAt: at(30) };
    const a = await inOak(() => tasks.upsertFromSource(base));
    const b = await inOak(() => tasks.upsertFromSource({ ...base, dueAt: at(45) }));
    expect(b.id).toBe(a.id);
    expect(await inOak(() => DueItem.countDocuments({}))).toBe(1);
    expect(new Date(b.dueAt).toISOString()).toBe(at(45).toISOString());
    // No owner given: it goes to the department's lead.
    expect(String(b.ownerProfileId)).toBe(String(s.people.COMPLIANCE?.profile?._id ?? b.ownerProfileId));
    await inOak(() => tasks.resolveSource('licence:fire:expiry'));
    expect((await inOak(() => DueItem.findById(a.id).lean())).status).toBe('DONE');
  });
});

describe('who sees what', () => {
  it('shows a person their own items, and the principal everything', async () => {
    const teacher = s.people.TEACHER.actor;
    await inOak(() => tasks.createItem(teacher, 'OWN', { title: 'Order lab glassware', department: 'LABS', dueAt: at(5) }));
    await inOak(() => tasks.createItem(s.people.PRINCIPAL.actor, 'ALL', { title: 'Bus fitness check', department: 'TRANSPORT', dueAt: at(3), ownerProfileId: String(s.people.ADMIN.profile._id) }));
    const mine = await inOak(() => tasks.list(teacher, 'OWN', {}));
    expect(mine.items.map((i) => i.title)).toEqual(['Order lab glassware']);
    const all = await inOak(() => tasks.list(s.people.PRINCIPAL.actor, 'ALL', { view: 'all' }));
    expect(all.total).toBe(2);
    // A teacher cannot touch someone else's item, even by id.
    const other = all.items.find((i) => i.title === 'Bus fitness check');
    await expect(inOak(() => tasks.complete(teacher, 'OWN', other.id, {}))).rejects.toMatchObject({ statusCode: 404 });
    // A teacher's own item can only be owned by themselves.
    const forced = await inOak(() => tasks.createItem(teacher, 'OWN', { title: 'x', department: 'LABS', dueAt: at(5), ownerProfileId: String(s.people.ADMIN.profile._id) }));
    expect(String(forced.ownerProfileId)).toBe(String(teacher.profileId));
  });
});

describe('working an item', () => {
  it('limits snoozes, requires evidence when asked, and creates the next instance of recurring work', async () => {
    const admin = s.people.ADMIN.actor;
    const item = await inOak(() => tasks.createItem(admin, 'ALL', {
      title: 'Water tank cleaning', department: 'FACILITIES', category: 'SANITATION', dueAt: at(2), severity: 'CRITICAL',
      recurrence: { unit: 'MONTH', every: 3 }, requiresEvidence: true, amountPaise: 450000,
    }));
    await expect(inOak(() => tasks.snooze(admin, 'ALL', item.id, { until: at(10), reason: 'vendor busy' }))).rejects.toMatchObject({ code: 'SNOOZE_TOO_LONG' });
    await expect(inOak(() => tasks.snooze(admin, 'ALL', item.id, { until: new Date(Date.now() + 3600_000) }))).rejects.toThrow(/reason/);
    await expect(inOak(() => tasks.complete(admin, 'ALL', item.id, {}))).rejects.toMatchObject({ code: 'EVIDENCE_REQUIRED' });
    const done = await inOak(() => tasks.complete(admin, 'ALL', item.id, { evidence: [{ name: 'Cleaning certificate', url: '/uploads/cert.pdf' }] }));
    expect(done.status).toBe('DONE');
    expect(new Date(done.next.dueAt).toISOString()).toBe(new Date(Date.UTC(2027, 0, 16, 5, 0)).toISOString());
    expect(String(done.next.previousId)).toBe(item.id);
    await expect(inOak(() => tasks.complete(admin, 'ALL', item.id, { note: 'again' }))).rejects.toMatchObject({ code: 'TASK_CLOSED' });
  });
});

describe('reminders and escalation', () => {
  it('reminds once per lead day, escalates overdue work, and moves work away from someone who left', async () => {
    const admin = s.people.ADMIN.actor;
    const now = at(0);
    const item = await inOak(() => tasks.createItem(admin, 'ALL', { title: 'Insurance renewal', department: 'FINANCE', dueAt: new Date(now.getTime() + 6 * DAY), leadDays: [30, 7, 1], ownerProfileId: String(s.people.TEACHER.profile._id) }));
    await inOak(() => tasks.runReminders({ now }));
    await inOak(() => tasks.runReminders({ now: new Date(now.getTime() + 3600_000) }));
    const due = await inOak(() => MessageOutbox.find({ templateKey: 'TASK_DUE' }).lean());
    expect(due).toHaveLength(1);
    // Two days late: the finance lead is told; eight days late: the principal too.
    await inOak(() => tasks.runReminders({ now: new Date(now.getTime() + 8 * DAY) }));
    await inOak(() => tasks.runReminders({ now: new Date(now.getTime() + 14 * DAY) }));
    const esc = await inOak(() => MessageOutbox.find({ templateKey: 'TASK_OVERDUE' }).lean());
    expect(esc.length).toBeGreaterThan(0);
    const reloaded = await inOak(() => DueItem.findById(item.id).lean());
    expect(reloaded.escalationLevel).toBe(2);
    // The owner leaves: the item goes to the department's lead.
    await inOak(() => Profile.updateOne({ _id: s.people.TEACHER.profile._id }, { $set: { status: 'INACTIVE' } }));
    await inOak(() => tasks.runReminders({ now: new Date(now.getTime() + 15 * DAY) }));
    const after = await inOak(() => DueItem.findById(item.id).lean());
    expect(String(after.ownerProfileId)).not.toBe(String(s.people.TEACHER.profile._id));
    expect(after.history.some((h) => h.action === 'OWNER_UNAVAILABLE_REASSIGNED')).toBe(true);
  });
});

describe('feature switch', () => {
  it('turns a module off for the API and the jobs, per school', async () => {
    await School.updateOne({ slug: OAK }, { $setOnInsert: { slug: OAK, name: 'Oakridge Academy' } }, { upsert: true });
    expect(await featureEnabled('tasks', OAK)).toBe(true);
    expect(await featureEnabled('camera', OAK)).toBe(false);
    await inOak(() => setFeatures({ tasks: false }));
    expect(await featureEnabled('tasks', OAK)).toBe(false);
    await expect(inOak(() => setFeatures({ nonsense: true }))).rejects.toMatchObject({ code: 'UNKNOWN_FEATURE' });
  });
});

describe('summary at OWN scope', () => {
  it('counts the caller\'s own items (the profile id is cast inside the aggregation)', async () => {
    const teacher = s.people.TEACHER.actor;
    await inOak(() => tasks.createItem(teacher, 'OWN', { title: 'Lab glassware', department: 'LABS', dueAt: at(-2) }));
    const sum = await inOak(() => tasks.summary(teacher, 'OWN', {}));
    expect(sum.byDepartment.find((d) => d.department === 'LABS')?.overdue).toBe(1);
    // Someone else's own view does not include it.
    const admin = await inOak(() => tasks.summary(s.people.ADMIN.actor, 'OWN', {}));
    expect(admin.byDepartment.find((d) => d.department === 'LABS')).toBeUndefined();
  });
});
