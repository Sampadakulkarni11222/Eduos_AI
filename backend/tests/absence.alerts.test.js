import { describe, it, expect, beforeEach } from 'vitest';
import { MessageOutbox, ContactPreference } from '../src/models/messaging.model.js';
import { Notification } from '../src/models/notification.model.js';
import { notifyGuardiansOfAbsence } from '../src/modules/attendance-alerts/alerts.service.js';
import { seedSchool, inSchool, OAK } from './support/mcpSchool.js';

/**
 * Absence / late alerts to guardians (audit: "Diya marked ABSENT today, the
 * parent's /notifications is empty").
 *
 * Fixture: PARENT is Rahul's father; Priya and Aman have no linked guardian
 * in the fixture.
 */

let s;
beforeEach(async () => { s = await seedSchool(); });

// 11:00 IST on a fixed day: outside quiet hours.
const MORNING = new Date('2026-10-14T05:30:00Z');
const DAY = new Date('2026-10-14T00:00:00Z');
const run = (args) => inSchool(OAK, () => notifyGuardiansOfAbsence({ date: DAY, now: MORNING, ...args }));
const outbox = () => inSchool(OAK, () => MessageOutbox.find({}).lean());
const parentNotes = () => inSchool(OAK, () => Notification.find({ recipientProfileId: s.people.PARENT.profile._id }).lean());

describe('notifyGuardiansOfAbsence', () => {
  it('sends the linked guardian an in-app notice and a WhatsApp outbox row for an absence', async () => {
    const r = await run({ entries: [
      { enrollmentId: s.rahul.enrollment._id, status: 'ABSENT' },
      { enrollmentId: s.priya.enrollment._id, status: 'PRESENT' },
    ] });
    expect(r.students).toBe(1);

    const notes = await parentNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain('Rahul Sharma was marked absent');
    expect(notes[0].body).toContain('14 Oct 2026');

    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe('WHATSAPP');
    expect(rows[0].templateKey).toBe('ATTENDANCE_ALERT');
    expect(String(rows[0].recipientProfileId)).toBe(String(s.people.PARENT.profile._id));
    expect(rows[0].idempotencyKey).toBe(`attendance-alert:${s.rahul.student._id}:2026-10-14:ABSENT`);
    // No WhatsApp opt-in on file: consent is respected, nothing is sent.
    expect(rows[0].status).toBe('SKIPPED_NO_CONSENT');
  });

  it('is idempotent per student, date and status', async () => {
    const args = { enrollmentIds: [s.rahul.enrollment._id], status: 'ABSENT' };
    await run(args);
    await run(args);
    expect(await outbox()).toHaveLength(1);
    expect(await parentNotes()).toHaveLength(1);

    // A changed status is a new fact and is sent.
    await run({ enrollmentIds: [s.rahul.enrollment._id], status: 'LATE' });
    const rows = await outbox();
    expect(rows).toHaveLength(2);
    expect(rows.map((m) => m.preview).join(' ')).toContain('marked late');
  });

  it('holds the WhatsApp message during quiet hours for an opted-in guardian', async () => {
    await inSchool(OAK, () => ContactPreference.create({
      profileId: s.people.PARENT.profile._id, whatsappOptIn: { status: 'OPTED_IN', at: new Date(), source: 'test' },
    }));
    const night = new Date('2026-10-14T16:30:00Z'); // 22:00 IST
    await inSchool(OAK, () => notifyGuardiansOfAbsence({ enrollmentIds: [s.rahul.enrollment._id], status: 'ABSENT', date: DAY, now: night }));
    const [row] = await outbox();
    expect(row.status).toBe('DEFERRED');
    expect(row.scheduledFor.getTime()).toBeGreaterThan(night.getTime());
    // The in-app copy is not held back.
    expect(await parentNotes()).toHaveLength(1);
  });

  it('ignores PRESENT/EXCUSED marks, students with no guardian, and marks for an earlier day', async () => {
    await run({ entries: [
      { enrollmentId: s.rahul.enrollment._id, status: 'PRESENT' },
      { enrollmentId: s.rahul.enrollment._id, status: 'EXCUSED' },
      { enrollmentId: s.aman.enrollment._id, status: 'ABSENT' },
    ] });
    const old = await inSchool(OAK, () => notifyGuardiansOfAbsence({
      enrollmentIds: [s.rahul.enrollment._id], status: 'ABSENT', date: new Date('2026-10-07T00:00:00Z'), now: MORNING,
    }));
    expect(old.skipped).toBe('mark is for an earlier day');
    expect(await outbox()).toHaveLength(0);
    expect(await parentNotes()).toHaveLength(0);
  });

  it('never throws, even for nonsense input', async () => {
    const r = await run({ entries: [{ enrollmentId: 'not-an-id', status: 'ABSENT' }] });
    expect(r.queued).toBe(0);
  });
});

describe('marking the day register', () => {
  it('alerts the guardians when the day register marks a child late or absent', async () => {
    const attendance = await import('../src/modules/attendance/attendance.service.js');
    const today = new Date().toISOString().slice(0, 10);
    const admin = s.people.ADMIN.actor;
    await inSchool(OAK, () => attendance.markAttendance(admin, 'ALL', {
      date: today, sectionId: String(s.rahul.enrollment.sectionId),
      entries: [{ enrollmentId: String(s.rahul.enrollment._id), status: 'LATE' }],
    }));
    // The fixture's register already has Rahul absent today; a change to LATE is new and is sent once.
    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0].preview).toContain('marked late');
    expect(rows[0].templateKey).toBe('ATTENDANCE_ALERT');
  });
});
