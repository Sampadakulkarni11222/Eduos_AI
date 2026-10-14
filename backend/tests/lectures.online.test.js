import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, seedPerson, inSchool, OAK, RIVER } from './support/mcpSchool.js';
import { Account } from '../src/models/account.model.js';
import { MessageOutbox } from '../src/models/messaging.model.js';
import { Notification } from '../src/models/notification.model.js';
import { OnlineClass } from '../src/models/onlineClass.model.js';
import * as lectures from '../src/modules/lectures/lecture.service.js';
import * as messaging from '../src/modules/messaging/messaging.service.js';

/**
 * Digital lectures: a class reaches exactly the people it is for, the link is
 * handed out one person at a time inside the class window, people are told by
 * every channel with an honest status for each, and a teacher cannot schedule
 * for classes they do not teach.
 */

let school;
const inOak = (fn) => inSchool(OAK, fn);
const soon = (minutes = 10) => new Date(Date.now() + minutes * 60_000).toISOString();
const lesson = (over = {}) => ({ title: 'Fractions revision', sectionIds: [String(school.sectionA._id)], startsAt: soon(), durationMinutes: 40, ...over });

beforeEach(async () => { school = await seedSchool(); });

describe('scheduling', () => {
  it('creates a built-in room without any account or key, and never lists the link', async () => {
    const cls = await inOak(() => lectures.create(school.people.TEACHER.actor, lesson()));
    expect(cls).toMatchObject({ provider: 'JITSI', status: 'SCHEDULED', isHost: true, occurrences: 1 });
    expect(JSON.stringify(cls)).not.toContain('meet.jit.si');
    const stored = await inOak(() => OnlineClass.findById(cls.id).lean());
    expect(stored.joinUrl).toMatch(/^https:\/\/meet\.jit\.si\/eduos-[a-f0-9]{24}$/);
    // The room name says nothing about the school or the class.
    expect(stored.joinUrl).not.toMatch(/oakridge|fraction/i);

    const listed = await inOak(() => lectures.list(school.people.STUDENT.actor, {}));
    expect(listed.map((c) => c.title)).toEqual(['Fractions revision']);
    expect(JSON.stringify(listed)).not.toContain('meet.jit.si');
  });

  it('takes a pasted link for another service, and refuses one that is not https', async () => {
    await expect(inOak(() => lectures.create(school.people.TEACHER.actor, lesson({ provider: 'ZOOM' })))).rejects.toThrow(/joinUrl is required/);
    await expect(inOak(() => lectures.create(school.people.TEACHER.actor, lesson({ provider: 'ZOOM', joinUrl: 'http://zoom.us/j/1' })))).rejects.toMatchObject({ code: 'BAD_LINK' });
    const cls = await inOak(() => lectures.create(school.people.TEACHER.actor, lesson({ provider: 'ZOOM', joinUrl: 'https://zoom.us/j/123456' })));
    expect(cls.provider).toBe('ZOOM');
  });

  it('lets a teacher schedule only for classes they teach, and nobody for nobody', async () => {
    await expect(inOak(() => lectures.create(school.people.TEACHER.actor, lesson({ sectionIds: [String(school.sectionB._id)] })))).rejects.toMatchObject({ code: 'NOT_YOUR_CLASS' });
    await expect(inOak(() => lectures.create(school.people.TEACHER.actor, lesson({ sectionIds: [] })))).rejects.toMatchObject({ code: 'NO_AUDIENCE' });
    await expect(inOak(() => lectures.create(school.people.TEACHER.actor, lesson({ sectionIds: [], inviteeRoles: ['TEACHER'] })))).rejects.toMatchObject({ code: 'ROLE_INVITE_FORBIDDEN' });
    // The principal may schedule for any class and invite a whole staff role.
    const staff = await inOak(() => lectures.create(school.people.PRINCIPAL.actor, lesson({ title: 'Staff meeting', kind: 'STAFF_MEETING', sectionIds: [], inviteeRoles: ['TEACHER'] })));
    expect(staff.inviteeRoles).toEqual(['TEACHER']);
  });

  it('refuses a clash for the host or for the class, and repeats weekly when asked', async () => {
    const at = soon(30);
    await inOak(() => lectures.create(school.people.TEACHER.actor, lesson({ startsAt: at })));
    await expect(inOak(() => lectures.create(school.people.TEACHER.actor, lesson({ title: 'Second', startsAt: at })))).rejects.toMatchObject({ code: 'CLASS_CLASH' });
    await expect(inOak(() => lectures.create(school.people.PRINCIPAL.actor, lesson({ title: 'Assembly', startsAt: at })))).rejects.toMatchObject({ code: 'CLASS_CLASH' });

    const series = await inOak(() => lectures.create(school.people.TEACHER.actor, lesson({ title: 'Weekly doubts', startsAt: soon(24 * 60), repeatWeekly: 4 })));
    expect(series.occurrences).toBe(4);
    const rows = await inOak(() => OnlineClass.find({ seriesId: series.seriesId }).sort({ startsAt: 1 }).lean());
    expect(rows).toHaveLength(4);
    expect(rows[1].startsAt - rows[0].startsAt).toBe(7 * 86_400_000);
    // Each week gets its own room.
    expect(new Set(rows.map((r) => r.joinUrl)).size).toBe(4);
  });
});

describe('who a class is for', () => {
  it('is seen by its students and their parents, and by nobody in another class or school', async () => {
    const cls = await inOak(() => lectures.create(school.people.TEACHER.actor, lesson()));
    const other = await seedPerson({ roleKey: 'TEACHER', roleId: school.roleIds.TEACHER, displayName: 'Other teacher' });
    expect(await inOak(() => lectures.list(school.people.STUDENT.actor, {}))).toHaveLength(1);
    expect(await inOak(() => lectures.list(school.people.PARENT.actor, {}))).toHaveLength(1);
    expect(await inOak(() => lectures.list(other.actor, {}))).toHaveLength(0);
    await expect(inOak(() => lectures.get(other.actor, cls.id))).rejects.toMatchObject({ statusCode: 404 });
    await expect(inOak(() => lectures.join(other.actor, cls.id))).rejects.toMatchObject({ statusCode: 404 });
    expect(await inSchool(RIVER, () => lectures.list(school.people.RIVER_ADMIN.actor, {}))).toHaveLength(0);
    await expect(inSchool(RIVER, () => lectures.join(school.people.RIVER_ADMIN.actor, cls.id))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('gives the link to a student inside the window, and to a parent only when guardians are invited', async () => {
    const cls = await inOak(() => lectures.create(school.people.TEACHER.actor, lesson()));
    const door = await inOak(() => lectures.join(school.people.STUDENT.actor, cls.id));
    expect(door.joinUrl).toMatch(/^https:\/\/meet\.jit\.si\/eduos-/);
    await expect(inOak(() => lectures.join(school.people.PARENT.actor, cls.id))).rejects.toMatchObject({ code: 'STUDENTS_ONLY' });

    const ptm = await inOak(() => lectures.create(school.people.TEACHER.actor, lesson({ title: 'Parent meeting', kind: 'PARENT_MEETING', includeGuardians: true, startsAt: soon(120) })));
    // Two hours away: not open yet for anyone but the host.
    await expect(inOak(() => lectures.join(school.people.PARENT.actor, ptm.id))).rejects.toMatchObject({ code: 'NOT_OPEN_YET' });
    expect((await inOak(() => lectures.join(school.people.TEACHER.actor, ptm.id))).joinUrl).toBeTruthy();
  });

  it('records who opened the link, goes live when the host does, and reports it honestly', async () => {
    const cls = await inOak(() => lectures.create(school.people.TEACHER.actor, lesson()));
    await inOak(() => lectures.join(school.people.STUDENT.actor, cls.id));
    await inOak(() => lectures.join(school.people.STUDENT.actor, cls.id));
    expect((await inOak(() => lectures.get(school.people.STUDENT.actor, cls.id))).status).toBe('SCHEDULED');
    await inOak(() => lectures.join(school.people.TEACHER.actor, cls.id));
    expect((await inOak(() => lectures.get(school.people.STUDENT.actor, cls.id))).status).toBe('LIVE');

    const report = await inOak(() => lectures.attendance(school.people.TEACHER.actor, cls.id));
    // Only Priya has a login among the three students of 6 A.
    expect(report).toMatchObject({ invited: 1, joined: 1 });
    expect(report.rows[0]).toMatchObject({ joined: true, times: 2 });
    expect(report.note).toMatch(/does not show how long/);
    // A student is not shown who else joined.
    expect((await inOak(() => lectures.get(school.people.STUDENT.actor, cls.id))).joins).toBeUndefined();
    await expect(inOak(() => lectures.attendance(school.people.STUDENT.actor, cls.id))).rejects.toMatchObject({ code: 'NOT_HOST' });
  });
});

describe('telling people', () => {
  it('announces in the app, by email and by WhatsApp, with the true status of each', async () => {
    await Account.updateOne({ _id: school.people.STUDENT.account._id }, { $set: { email: 'priya@example.test' } });
    await inOak(() => messaging.updatePreferences(school.people.PARENT.actor, { emailOptOut: true }));
    const cls = await inOak(() => lectures.create(school.people.TEACHER.actor, lesson({ includeGuardians: true })));
    expect(cls.delivery.recipients).toBe(2);

    expect(await inOak(() => Notification.countDocuments({ recipientProfileId: school.people.STUDENT.profile._id }))).toBe(1);
    const rows = await inOak(() => MessageOutbox.find({ relatedEntityId: cls.id }).lean());
    const status = (who, channel) => rows.find((r) => String(r.recipientProfileId) === String(who.profile._id) && r.channel === channel)?.status;
    // No email provider in tests, so a real address is SIMULATED, never "sent".
    expect(status(school.people.STUDENT, 'EMAIL')).toBe('SIMULATED');
    expect(status(school.people.PARENT, 'EMAIL')).toBe('SKIPPED_NO_CONTACT');
    // Nobody has opted in to WhatsApp.
    expect(status(school.people.STUDENT, 'WHATSAPP')).toBe('SKIPPED_NO_CONSENT');
    expect(rows.find((r) => r.channel === 'EMAIL' && r.status === 'SIMULATED').recipientMasked).toBe('p***@example.test');
  });

  it('respects a person who turned email off', async () => {
    await Account.updateOne({ _id: school.people.STUDENT.account._id }, { $set: { email: 'priya@example.test' } });
    await inOak(() => messaging.updatePreferences(school.people.STUDENT.actor, { emailOptOut: true }));
    const cls = await inOak(() => lectures.create(school.people.TEACHER.actor, lesson()));
    const row = await inOak(() => MessageOutbox.findOne({ relatedEntityId: cls.id, channel: 'EMAIL' }).lean());
    expect(row.status).toBe('SKIPPED_NO_CONSENT');
  });

  it('reminds once before the class, tells people when it moves, and when it is cancelled', async () => {
    const cls = await inOak(() => lectures.create(school.people.TEACHER.actor, lesson({ startsAt: soon(15) })));
    const count = (templateKey) => inOak(() => MessageOutbox.countDocuments({ relatedEntityId: cls.id, templateKey, channel: 'WHATSAPP' }));
    expect(await inOak(() => lectures.sendReminders(null))).toMatchObject({ reminded: 1 });
    expect(await inOak(() => lectures.sendReminders(null))).toMatchObject({ reminded: 0 });
    expect(await count('CLASS_REMINDER')).toBe(1);

    const moved = await inOak(() => lectures.update(school.people.TEACHER.actor, cls.id, { startsAt: soon(90) }));
    expect(moved.delivery.recipients).toBe(1);
    expect(await count('CLASS_CHANGED')).toBe(1);
    // A changed title alone is not news worth a message.
    expect((await inOak(() => lectures.update(school.people.TEACHER.actor, cls.id, { title: 'Fractions and decimals' }))).delivery).toBeNull();

    await expect(inOak(() => lectures.cancel(school.people.TEACHER.actor, cls.id, {}))).rejects.toThrow(/reason is required/);
    await expect(inOak(() => lectures.cancel(school.people.STUDENT.actor, cls.id, { reason: 'no' }))).rejects.toMatchObject({ code: 'NOT_HOST' });
    const gone = await inOak(() => lectures.cancel(school.people.TEACHER.actor, cls.id, { reason: 'Teacher unwell' }));
    expect(gone.status).toBe('CANCELLED');
    expect(await count('CLASS_CANCELLED')).toBe(1);
    await expect(inOak(() => lectures.join(school.people.STUDENT.actor, cls.id))).rejects.toMatchObject({ code: 'CLASS_CANCELLED' });
  });
});

describe('after the class', () => {
  it('keeps the recording, notes and material with the class for the people it was for', async () => {
    const cls = await inOak(() => lectures.create(school.people.TEACHER.actor, lesson()));
    await inOak(() => lectures.join(school.people.TEACHER.actor, cls.id));
    const done = await inOak(() => lectures.finish(school.people.TEACHER.actor, cls.id, {
      recordingUrl: 'https://drive.example.test/recording-1', summary: 'Covered equivalent fractions; homework on page 42.',
      materials: [{ name: 'Worksheet.pdf', url: '/uploads/worksheet.pdf' }],
    }));
    expect(done.status).toBe('ENDED');
    const seen = (await inOak(() => lectures.list(school.people.STUDENT.actor, { tab: 'past' })))[0];
    expect(seen).toMatchObject({ recordingUrl: 'https://drive.example.test/recording-1', summary: expect.stringContaining('page 42') });
    expect(seen.materials).toEqual([{ name: 'Worksheet.pdf', url: '/uploads/worksheet.pdf', kind: 'DOCUMENT' }]);
    await expect(inOak(() => lectures.join(school.people.STUDENT.actor, cls.id))).rejects.toMatchObject({ code: 'CLASS_OVER' });
  });
});
