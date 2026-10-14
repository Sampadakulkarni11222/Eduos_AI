import { describe, it, expect, beforeEach } from 'vitest';
import { inSchool, OAK } from './support/mcpSchool.js';
import { seedFamilySchool, ymdIn } from './support/familySchool.js';
import { PtmBooking, PtmSlot, PtmWaitlist } from '../src/models/ptm.model.js';
import { OnlineClass } from '../src/models/onlineClass.model.js';
import { DueItem } from '../src/models/dueItem.model.js';
import { MessageOutbox } from '../src/models/messaging.model.js';
import { CalendarEvent } from '../src/models/calendarEvent.model.js';
import * as ptm from '../src/modules/ptm/ptm.service.js';
import * as tasks from '../src/modules/tasks/tasks.service.js';

/**
 * PTM booking: rounds and availability, a parent booking two children's
 * teachers back to back but never overlapping, atomic slots under concurrent
 * booking, the waiting list, online rooms, reminders, the child briefing
 * (fees only for those allowed) and an outcome whose action a teacher closes.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
const scopesOf = (actor) => Object.fromEntries(['ptm.read', 'ptm.manage', 'ptm.book'].map((k) => [k, actor.permissions[k]]).filter(([, v]) => v));
const day = ymdIn(7);

async function setUp({ mode = 'IN_PERSON' } = {}) {
  const P = s.people.PRINCIPAL.actor;
  const round = await inOak(() => ptm.createRound(P, 'ALL', { title: 'Term 1 PTM', startsOn: day, endsOn: day, mode, slotMinutes: 10, bufferMinutes: 2, sectionIds: [String(s.sectionA._id), String(s.sectionB._id)], defaultVenue: 'Room 6A' }));
  return round;
}
const avail = (actor, roundId, from, to, extra = {}) => inOak(() => ptm.addAvailability(actor, 'OWN', roundId, { windows: [{ date: day, from, to, ...extra }] }));
const book = (actor, body) => inOak(() => ptm.book(actor, scopesOf(actor), body));

beforeEach(async () => { s = await seedFamilySchool(); });

describe('rounds and availability', () => {
  it('creates a round on the calendar and generates slots with buffers; families cannot create rounds', async () => {
    const round = await setUp();
    expect(round.status).toBe('OPEN');
    expect(await inOak(() => CalendarEvent.countDocuments({ type: 'PTM' }))).toBe(1);
    const out = await avail(s.people.TEACHER.actor, round.id, '10:00', '10:40');
    // 10:00, 10:12, 10:24 fit (10:36 would end 10:46).
    expect(out.created).toBe(3);
    expect(out.slots.map((x) => x.time)).toEqual(['10:00–10:10', '10:12–10:22', '10:24–10:34']);
    const again = await avail(s.people.TEACHER.actor, round.id, '10:00', '10:40');
    expect(again.created).toBe(0);
    await expect(inOak(() => ptm.createRound(s.people.TEACHER.actor, 'OWN', { title: 'x', startsOn: day }))).rejects.toMatchObject({ statusCode: 403 });
    // A teacher of no class in the round cannot offer slots.
    await expect(avail(s.people.T4.actor, round.id, '10:00', '10:30')).rejects.toMatchObject({ code: 'NOT_A_TEACHER' });
  });
});

describe('a parent with two children', () => {
  it('books both children back to back and is refused an overlapping meeting', async () => {
    const round = await setUp();
    const a = await avail(s.people.TEACHER.actor, round.id, '10:00', '10:30'); // Rahul's class teacher
    const b = await avail(s.people.T3.actor, round.id, '10:00', '10:30'); // Riya's class teacher
    const m = await avail(s.people.T2.actor, round.id, '10:12', '10:40'); // teaches both
    const parent = s.people.PARENT.actor;
    const r1 = await book(parent, { slotId: a.slots[0].id, studentId: String(s.rahul.student._id), preferences: { language: 'Marathi', interpreter: true } });
    expect(r1.status).toBe('BOOKED');
    expect(r1.preferences.language).toBe('Marathi');
    // Back to back: 10:12 with the Maths teacher about Riya.
    const r2 = await book(parent, { slotId: m.slots[0].id, studentId: String(s.riya.student._id) });
    expect(r2.time).toBe('10:12–10:22');
    // Overlapping 10:00 with Riya's class teacher: refused, the parent cannot be in two places.
    await expect(book(parent, { slotId: b.slots[0].id, studentId: String(s.riya.student._id) })).rejects.toMatchObject({ code: 'PARENT_CLASH' });
    // The child already has a meeting with the Maths teacher.
    await expect(book(parent, { slotId: m.slots[1].id, studentId: String(s.riya.student._id) })).rejects.toMatchObject({ code: 'ALREADY_BOOKED' });
    // A teacher who does not teach the child, and a child who is not theirs.
    await expect(book(parent, { slotId: b.slots[1].id, studentId: String(s.rahul.student._id) })).rejects.toMatchObject({ code: 'NOT_CHILDS_TEACHER' });
    await expect(book(s.people.PARENT3.actor, { slotId: a.slots[1].id, studentId: String(s.rahul.student._id) })).rejects.toMatchObject({ code: 'NOT_YOUR_CHILD' });
    const options = await inOak(() => ptm.bookingOptions(parent, scopesOf(parent), round.id));
    expect(options.children.map((c) => c.name).sort()).toEqual(['Rahul Sharma', 'Riya Kapoor']);
    expect(await inOak(() => MessageOutbox.countDocuments({ templateKey: 'PTM_BOOKED' }))).toBeGreaterThan(0);
  });

  it('lets exactly one of two families win the same slot when they book at once', async () => {
    const round = await setUp();
    const a = await avail(s.people.TEACHER.actor, round.id, '10:00', '10:10');
    const results = await Promise.allSettled([
      book(s.people.PARENT.actor, { slotId: a.slots[0].id, studentId: String(s.rahul.student._id) }),
      book(s.people.PARENT2.actor, { slotId: a.slots[0].id, studentId: String(s.aman.student._id) }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected');
    expect(lost.reason.code).toBe('SLOT_TAKEN');
    expect(await inOak(() => PtmBooking.countDocuments({ active: true }))).toBe(1);
    expect((await inOak(() => PtmSlot.findById(a.slots[0].id).lean())).status).toBe('BOOKED');
  });

  it('offers a freed slot to the waiting list and holds it for that family', async () => {
    const round = await setUp();
    const m = await avail(s.people.T2.actor, round.id, '11:00', '11:10'); // one Maths slot
    const taken = await book(s.people.PARENT2.actor, { slotId: m.slots[0].id, studentId: String(s.aman.student._id) });
    const w = await inOak(() => ptm.joinWaitlist(s.people.PARENT.actor, scopesOf(s.people.PARENT.actor), { roundId: round.id, teacherProfileId: String(s.people.T2.profile._id), studentId: String(s.rahul.student._id) }));
    expect(w.position).toBe(1);
    await inOak(() => ptm.cancelBooking(s.people.PARENT2.actor, scopesOf(s.people.PARENT2.actor), taken.id, { reason: 'Travelling' }));
    const slot = await inOak(() => PtmSlot.findById(m.slots[0].id).lean());
    expect(slot.status).toBe('HELD');
    expect(String(slot.heldForProfileId)).toBe(String(s.people.PARENT.profile._id));
    expect(await inOak(() => MessageOutbox.countDocuments({ templateKey: 'PTM_SLOT_OFFERED' }))).toBeGreaterThan(0);
    // Someone else cannot take the held slot.
    await expect(book(s.people.PARENT2.actor, { slotId: m.slots[0].id, studentId: String(s.aman.student._id) })).rejects.toMatchObject({ code: 'SLOT_HELD' });
    const accepted = await inOak(() => ptm.acceptOffer(s.people.PARENT.actor, scopesOf(s.people.PARENT.actor), w.id, {}));
    expect(accepted.studentId).toBe(String(s.rahul.student._id));
    expect((await inOak(() => PtmWaitlist.findById(w.id).lean())).status).toBe('BOOKED');
  });

  it('reschedules to another slot of the same teacher and enforces the family cut-off', async () => {
    const round = await setUp();
    const a = await avail(s.people.TEACHER.actor, round.id, '10:00', '10:30');
    const b1 = await book(s.people.PARENT.actor, { slotId: a.slots[0].id, studentId: String(s.rahul.student._id) });
    const moved = await inOak(() => ptm.reschedule(s.people.PARENT.actor, scopesOf(s.people.PARENT.actor), b1.id, { slotId: a.slots[1].id, reason: 'Clash with work' }));
    expect(moved.time).toBe('10:12–10:22');
    expect((await inOak(() => PtmBooking.findById(b1.id).lean())).status).toBe('RESCHEDULED');
    expect((await inOak(() => PtmSlot.findById(a.slots[0].id).lean())).status).toBe('OPEN');
    // Within the cut-off, a family cannot cancel; staff can.
    await inOak(() => PtmBooking.updateOne({ _id: moved.id }, { $set: { startsAt: new Date(Date.now() + 3_600_000) } }));
    await expect(inOak(() => ptm.cancelBooking(s.people.PARENT.actor, scopesOf(s.people.PARENT.actor), moved.id, { reason: 'x' }))).rejects.toMatchObject({ code: 'CHANGE_CUTOFF' });
    const staff = await inOak(() => ptm.cancelBooking(s.people.TEACHER.actor, scopesOf(s.people.TEACHER.actor), moved.id, { reason: 'Teacher unwell' }));
    expect(staff.status).toBe('CANCELLED');
  });
});

describe('online meetings, reminders and staff-assisted booking', () => {
  it('creates a private Jitsi room for an online slot and reminds the family once a day before and once an hour before', async () => {
    const round = await setUp({ mode: 'ONLINE' });
    const a = await avail(s.people.TEACHER.actor, round.id, '18:00', '18:10');
    // Staff book on the family's behalf.
    const b = await book(s.people.TEACHER.actor, { slotId: a.slots[0].id, studentId: String(s.rahul.student._id), parentProfileId: String(s.people.PARENT.profile._id) });
    expect(b.assisted).toBe(true);
    expect(b.online).toBe(true);
    expect(JSON.stringify(b)).not.toMatch(/meet\.jit\.si/);
    const cls = await inOak(() => OnlineClass.findById(b.onlineClassId).lean());
    expect(cls.kind).toBe('PARENT_MEETING');
    expect(cls.inviteeProfileIds.map(String)).toEqual([String(s.people.PARENT.profile._id)]);
    expect(cls.recordingUrl).toBeNull();
    const startsAt = new Date(b.startsAt).getTime();
    await inOak(() => PtmBooking.updateOne({ _id: b.id }, { $set: { createdAt: new Date(startsAt - 3 * 86_400_000) } }));
    const dayBefore = new Date(startsAt - 20 * 3_600_000);
    await inOak(() => ptm.runReminders({ now: dayBefore }));
    await inOak(() => ptm.runReminders({ now: new Date(dayBefore.getTime() + 900_000) }));
    await inOak(() => ptm.runReminders({ now: new Date(startsAt - 30 * 60_000) }));
    const sent = await inOak(() => MessageOutbox.find({ templateKey: 'PTM_REMINDER', channel: 'EMAIL' }).lean());
    expect(sent.map((m) => m.idempotencyKey).sort()).toEqual([`ptm:${b.id}:reminder:DAY`, `ptm:${b.id}:reminder:HOUR`]);
    // Cancelling the booking cancels the room.
    await inOak(() => ptm.cancelBooking(s.people.TEACHER.actor, scopesOf(s.people.TEACHER.actor), b.id, { reason: 'Moved to school' }));
    expect((await inOak(() => OnlineClass.findById(b.onlineClassId).lean())).status).toBe('CANCELLED');
  });
});

describe('the meeting itself', () => {
  it('gives the teacher a briefing without fees, the principal one with fees, and nobody else any', async () => {
    const round = await setUp();
    const a = await avail(s.people.TEACHER.actor, round.id, '10:00', '10:10');
    const b = await book(s.people.PARENT.actor, { slotId: a.slots[0].id, studentId: String(s.rahul.student._id) });
    const teacherView = await inOak(() => ptm.briefing(s.people.TEACHER.actor, scopesOf(s.people.TEACHER.actor), b.id));
    expect(teacherView.feesShown).toBe(false);
    expect(teacherView.fees).toBeNull();
    expect(teacherView.attendance.workingDays).toBe(1);
    expect(teacherView.syllabus.map((x) => x.subject)).toEqual(['English', 'Mathematics']);
    const principalView = await inOak(() => ptm.briefing(s.people.PRINCIPAL.actor, scopesOf(s.people.PRINCIPAL.actor), b.id));
    expect(principalView.feesShown).toBe(true);
    expect(principalView.fees.outstandingPaise).toBe(800000);
    await expect(inOak(() => ptm.briefing(s.people.T3.actor, scopesOf(s.people.T3.actor), b.id))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('records an outcome whose staff action becomes a task the teacher closes; safeguarding notes are refused', async () => {
    const round = await setUp();
    const a = await avail(s.people.TEACHER.actor, round.id, '10:00', '10:10');
    const b = await book(s.people.PARENT.actor, { slotId: a.slots[0].id, studentId: String(s.rahul.student._id) });
    const teacher = s.people.TEACHER.actor;
    await expect(inOak(() => ptm.recordOutcome(teacher, scopesOf(teacher), b.id, { summary: 'x' }))).rejects.toMatchObject({ code: 'TOO_EARLY' });
    await inOak(() => PtmBooking.updateOne({ _id: b.id }, { $set: { startsAt: new Date(Date.now() - 600_000), endsAt: new Date(Date.now() - 60_000) } }));
    await inOak(() => ptm.checkIn(teacher, scopesOf(teacher), b.id));
    await expect(inOak(() => ptm.recordOutcome(teacher, scopesOf(teacher), b.id, { summary: 'x', safeguardingConcern: 'y' }))).rejects.toMatchObject({ code: 'USE_SAFEGUARDING' });
    const due = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const out = await inOak(() => ptm.recordOutcome(teacher, scopesOf(teacher), b.id, {
      summary: 'Reading is improving; agreed a daily 20-minute routine.',
      actions: [{ title: 'Send a graded reading list', ownerType: 'STAFF', dueOn: due }, { title: 'Read with Rahul daily', ownerType: 'PARENT' }],
      nextFollowUpOn: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    }));
    expect(out.status).toBe('COMPLETED');
    const task = await inOak(() => DueItem.findOne({ sourceKey: `ptm:${b.id}:action:0` }).lean());
    expect(task).toMatchObject({ category: 'PTM_FOLLOWUP', department: 'ENGAGEMENT' });
    expect(String(task.ownerProfileId)).toBe(teacher.profileId);
    expect(await inOak(() => DueItem.countDocuments({ category: 'PTM_FOLLOWUP' }))).toBe(2); // the action and the follow-up
    await inOak(() => tasks.complete(teacher, 'OWN', String(task._id), { note: 'Sent' }));
    const m = await inOak(() => ptm.metrics(s.people.PRINCIPAL.actor, scopesOf(s.people.PRINCIPAL.actor), { roundId: round.id }));
    expect(m).toMatchObject({ completed: 1, actionsAgreed: 1, actionsDone: 1, actionsOpen: 0 });
    const sheet = await inOak(() => ptm.meetingSheet(teacher, scopesOf(teacher), round.id));
    expect(sheet.totals).toMatchObject({ slots: 1, booked: 1, completed: 1 });
  });
});
