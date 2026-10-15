import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { seedTransportSchool, inOak, asDevice } from './support/transportSafety.js';
import { ClassCheckIn } from '../src/models/safety.model.js';
import { TimetableSlot } from '../src/models/timetableSlot.model.js';
import { SubjectOffering } from '../src/models/academics.model.js';
import { MessageOutbox } from '../src/models/messaging.model.js';
import * as camera from '../src/modules/safety/camera.service.js';
import * as devices from '../src/modules/safety/devices.service.js';
import { istWeekday } from '../src/modules/safety/shared.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';

/**
 * The owner's two camera requirements, within the product rules:
 *  - "Is the teacher taking class": presence comes from the teacher's check-in,
 *    or from a "teacher present in room" observation a trained reviewer
 *    confirmed, recorded for the teacher the TIMETABLE names (no face match).
 *  - "Bullying, report to teacher and principal": a possible aggression
 *    observation reaches the class teacher and the principal only after a
 *    person reviewed it and referred it to safeguarding, never before, and
 *    the message names no child.
 */
let s; let compliance; let corridor; let classroom;
beforeEach(async () => {
  s = await seedTransportSchool({ features: { camera: true } });
  compliance = s.people.COMPLIANCE.actor;
  corridor = await inOak(() => devices.create(compliance, { kind: 'CAMERA', label: 'Corridor B (sample)', camera: { purpose: 'CORRIDOR_SAFETY', locationKind: 'CORRIDOR', roomLabel: 'Corridor B', retentionDays: 7, approvalNote: 'Approved by SMC (sample)' } }));
  classroom = await inOak(() => devices.create(compliance, { kind: 'CAMERA', label: 'Room 6A (sample)', camera: { purpose: 'UNATTENDED_CLASSROOM_CHECK', locationKind: 'CLASSROOM', roomLabel: 'R-6A', retentionDays: 3, approvalNote: 'Approved pilot (sample)' } }));
  const offering = await inOak(() => SubjectOffering.create({ sectionId: s.sectionA._id, subjectId: new mongoose.Types.ObjectId(), termId: new mongoose.Types.ObjectId(), teacherId: s.people.TEACHER.profile._id }));
  await inOak(() => TimetableSlot.create({ sectionId: s.sectionA._id, dayOfWeek: istWeekday(), periodNo: 3, startTime: '00:00', endTime: '23:59', subjectOfferingId: offering._id, room: 'R-6A' }));
});

const post = async (dev, body) => {
  const d = await asDevice(dev.deviceKey, dev.secret, body);
  return runWithTenant(d.tenantId, () => camera.ingest(d, body));
};

describe('teacher presence', () => {
  it('records a reviewed "teacher present" observation as the timetabled teacher\'s check-in, never by identification', async () => {
    await expect(post(classroom, { type: 'TEACHER_PRESENT_IN_ROOM', personId: 'face-123' })).rejects.toMatchObject({ code: 'FIELD_NOT_ACCEPTED' });
    await expect(post(corridor, { type: 'TEACHER_PRESENT_IN_ROOM' })).rejects.toMatchObject({ code: 'OUTSIDE_APPROVED_PURPOSE' });
    const o = await post(classroom, { type: 'TEACHER_PRESENT_IN_ROOM', confidence: 0.8, room: 'R-6A' });
    // Unreviewed: nothing is recorded.
    expect(await inOak(() => ClassCheckIn.countDocuments({}))).toBe(0);
    let board = await inOak(() => camera.presenceBoard({}));
    expect(board.rows[0]).toMatchObject({ periodNo: 3, status: 'NOT_CHECKED_IN', checkIn: null });
    const reviewed = await inOak(() => camera.review(compliance, o.id, { decision: 'CONFIRMED', notes: 'Teacher at the board' }));
    expect(reviewed.presence).toMatchObject({ recorded: true, periodNo: 3 });
    const ci = await inOak(() => ClassCheckIn.findOne({}).lean());
    expect(String(ci.profileId)).toBe(String(s.people.TEACHER.profile._id));
    expect(ci.source).toBe('CAMERA_REVIEWED');
    expect(String(ci.reviewedByProfileId)).toBe(String(compliance.profileId));
    board = await inOak(() => camera.presenceBoard({}));
    expect(board.rows[0]).toMatchObject({ status: 'PRESENT', checkIn: expect.objectContaining({ source: 'CAMERA_REVIEWED' }) });
    expect(board.counts).toMatchObject({ lessons: 1, present: 1, viaCamera: 1 });
    // The teacher's own tap afterwards is refused as a duplicate; a false alert records nothing.
    await expect(inOak(() => camera.checkIn(s.people.TEACHER.actor, { periodNo: 3 }))).rejects.toMatchObject({ code: 'ALREADY_CHECKED_IN' });
    const o2 = await post(classroom, { type: 'TEACHER_PRESENT_IN_ROOM', room: 'R-6A' });
    const r2 = await inOak(() => camera.review(compliance, o2.id, { decision: 'FALSE_ALERT', notes: 'Visitor, not the teacher' }));
    expect(r2.presence).toBeUndefined();
    expect(await inOak(() => ClassCheckIn.countDocuments({}))).toBe(1);
  });

  it('shows a tap check-in on the board', async () => {
    await inOak(() => camera.checkIn(s.people.TEACHER.actor, { periodNo: 3 }));
    const board = await inOak(() => camera.presenceBoard({}));
    expect(board.rows[0]).toMatchObject({ status: 'PRESENT', checkIn: expect.objectContaining({ source: 'TAP' }) });
    expect(board.note).toMatch(/not that the class was unattended/);
  });
});

describe('possible bullying', () => {
  it('tells the class teacher and the principal only after a person reviewed and referred it, naming no child', async () => {
    // The corridor outside 6A: the class timetabled there is 6A.
    await inOak(() => TimetableSlot.updateMany({}, { $set: { room: 'Corridor B' } }));
    const o = await post(corridor, { type: 'POSSIBLE_AGGRESSION', confidence: 0.9, room: 'Corridor B', evidenceRef: 'vault://clip/55' });
    const followUps = () => inOak(() => MessageOutbox.find({ templateKey: 'SAFETY_REFERRAL_FOLLOWUP' }).lean());
    expect(await followUps()).toHaveLength(0);
    await inOak(() => camera.review(compliance, o.id, { decision: 'CONFIRMED', notes: 'Pushing near stairs' }));
    expect(await followUps()).toHaveLength(0);
    const linked = await inOak(() => camera.linkCase(compliance, o.id, { category: 'BULLYING' }));
    expect(linked.notified).toMatchObject({ classTeacher: true });
    const msgs = await followUps();
    const to = new Set(msgs.map((m) => String(m.recipientProfileId)));
    expect(to.has(String(s.people.PRINCIPAL.profile._id))).toBe(true);
    expect(to.has(String(s.people.TEACHER.profile._id))).toBe(true);
    expect(to.has(String(s.people.PARENT.profile._id))).toBe(false);
    expect(JSON.stringify(msgs)).not.toMatch(/Corridor B|clip\/55|Pushing|Rahul|Priya|Aman/);
  });
});
