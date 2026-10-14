import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { seedTransportSchool, inOak, asDevice } from './support/transportSafety.js';
import { CameraObservation, SafetyAlert } from '../src/models/safety.model.js';
import { SafeguardingCase } from '../src/models/compliance.model.js';
import { Facility } from '../src/models/facility.model.js';
import { TimetableSlot } from '../src/models/timetableSlot.model.js';
import { SubjectOffering } from '../src/models/academics.model.js';
import { Notification } from '../src/models/notification.model.js';
import { MessageOutbox } from '../src/models/messaging.model.js';
import * as camera from '../src/modules/safety/camera.service.js';
import * as devices from '../src/modules/safety/devices.service.js';
import { istWeekday } from '../src/modules/safety/shared.js';
import { requireFeature, setFeatures } from '../src/utils/features.js';
import { requirePermission } from '../src/middleware/permission.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';

/**
 * Optional camera review: forbidden places and purposes are refused at
 * registration; identities, images and scores are refused at ingestion;
 * every observation stays UNVERIFIED until a reviewer decides; corrections
 * keep history; an aggression observation can be referred to safeguarding;
 * the room context comes from timetable, check-in and cover; and nothing
 * leaks into alerts, notifications, the campus map or other roles.
 */
let s; let compliance; let principal; let corridor; let classroom;
beforeEach(async () => {
  s = await seedTransportSchool({ features: { camera: true } });
  compliance = s.people.COMPLIANCE.actor;
  principal = s.people.PRINCIPAL.actor;
  corridor = await inOak(() => devices.create(compliance, { kind: 'CAMERA', label: 'Corridor B (sample)', camera: { purpose: 'CORRIDOR_SAFETY', locationKind: 'CORRIDOR', roomLabel: 'Corridor B', retentionDays: 7, approvalNote: 'Approved by SMC (sample)' } }));
  classroom = await inOak(() => devices.create(compliance, { kind: 'CAMERA', label: 'Room 6A (sample)', camera: { purpose: 'UNATTENDED_CLASSROOM_CHECK', locationKind: 'CLASSROOM', roomLabel: 'R-6A', retentionDays: 3, approvalNote: 'Approved pilot (sample)' } }));
});

const post = async (dev, body) => {
  const d = await asDevice(dev.deviceKey, dev.secret, body);
  return runWithTenant(d.tenantId, () => camera.ingest(d, body));
};

describe('registry', () => {
  it('refuses cameras in toilets or changing rooms and outside the approved purpose', async () => {
    await expect(inOak(() => devices.create(compliance, { kind: 'CAMERA', label: 'x', camera: { purpose: 'CORRIDOR_SAFETY', locationKind: 'TOILET', approvalNote: 'n' } }))).rejects.toMatchObject({ code: 'FORBIDDEN_CAMERA_LOCATION' });
    await expect(inOak(() => devices.create(compliance, { kind: 'CAMERA', label: 'x', camera: { purpose: 'CORRIDOR_SAFETY', locationKind: 'CORRIDOR', roomLabel: 'Corridor near girls changing room', approvalNote: 'n' } }))).rejects.toMatchObject({ code: 'FORBIDDEN_CAMERA_LOCATION' });
    const wc = await inOak(() => Facility.create({ code: 'WC1', name: 'Block A', kind: 'TOILET' }));
    await expect(inOak(() => devices.create(compliance, { kind: 'CAMERA', label: 'x', camera: { purpose: 'CORRIDOR_SAFETY', locationKind: 'CORRIDOR', facilityId: String(wc._id), approvalNote: 'n' } }))).rejects.toMatchObject({ code: 'FORBIDDEN_CAMERA_LOCATION' });
    await expect(inOak(() => devices.create(compliance, { kind: 'CAMERA', label: 'x', camera: { purpose: 'UNATTENDED_CLASSROOM_CHECK', locationKind: 'CORRIDOR', approvalNote: 'n' } }))).rejects.toMatchObject({ code: 'PURPOSE_LOCATION_MISMATCH' });
    // A principal (no camera.devices.manage) cannot register one.
    await expect(inOak(() => devices.create(principal, { kind: 'CAMERA', label: 'x', camera: { purpose: 'CORRIDOR_SAFETY', locationKind: 'CORRIDOR', approvalNote: 'n' } }))).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('observations', () => {
  it('refuses identities, images and scores, and observation types outside the camera\'s purpose', async () => {
    await expect(post(corridor, { type: 'POSSIBLE_AGGRESSION', confidence: 0.8, studentIds: ['x'] })).rejects.toMatchObject({ code: 'FIELD_NOT_ACCEPTED' });
    await expect(post(corridor, { type: 'POSSIBLE_AGGRESSION', confidence: 0.8, emotion: 'angry' })).rejects.toMatchObject({ code: 'FIELD_NOT_ACCEPTED' });
    await expect(post(corridor, { type: 'POSSIBLE_AGGRESSION', evidenceRef: 'data:image/png;base64,AAAA' })).rejects.toMatchObject({ code: 'EVIDENCE_NOT_A_REFERENCE' });
    await expect(post(classroom, { type: 'POSSIBLE_AGGRESSION', confidence: 0.9 })).rejects.toMatchObject({ code: 'OUTSIDE_APPROVED_PURPOSE' });
  });

  it('stays UNVERIFIED until reviewed; a second decision is a recorded correction; dedupes provider events', async () => {
    const o = await post(corridor, { type: 'POSSIBLE_AGGRESSION', confidence: 0.82, timestamp: new Date().toISOString(), evidenceRef: 'vault://clip/123', eventId: 'evt-1' });
    expect(o.status).toBe('UNVERIFIED');
    expect((await post(corridor, { type: 'POSSIBLE_AGGRESSION', confidence: 0.82, eventId: 'evt-1' })).duplicate).toBe(true);
    const q = await inOak(() => camera.queue({}));
    expect(q.items.map((i) => i.status)).toEqual(['UNVERIFIED']);
    await expect(inOak(() => camera.linkCase(principal, o.id, {}))).rejects.toMatchObject({ code: 'NOT_REVIEWED' });
    await inOak(() => camera.review(principal, o.id, { decision: 'FALSE_ALERT', notes: 'Two students playing tag' }));
    await expect(inOak(() => camera.review(compliance, o.id, { decision: 'CONFIRMED', notes: 'Clip reviewed again' }))).rejects.toThrow(/correctionReason/);
    const corrected = await inOak(() => camera.review(compliance, o.id, { decision: 'CONFIRMED', notes: 'Pushing seen; needs officer follow-up', correctionReason: 'Second reviewer saw the full clip' }));
    expect(corrected.status).toBe('CONFIRMED');
    expect(corrected.reviews).toHaveLength(2);
    expect(corrected.reviews[1].correctionOf).toMatch(/FALSE_ALERT/);
  });

  it('refers a confirmed aggression observation to a new encrypted safeguarding case, naming no child', async () => {
    const o = await post(corridor, { type: 'POSSIBLE_AGGRESSION', confidence: 0.9, evidenceRef: 'vault://clip/9' });
    await inOak(() => camera.review(principal, o.id, { decision: 'CONFIRMED', notes: 'Pushing near stairs' }));
    const linked = await inOak(() => camera.linkCase(principal, o.id, { category: 'BULLYING', urgency: 'URGENT' }));
    expect(linked.safeguardingRef).toMatch(/^SG\//);
    const c = await inOak(() => SafeguardingCase.findById(linked.safeguardingCaseId).lean());
    expect(c.descriptionEnc).toBeTruthy();
    expect(c.description).toBeUndefined();
    // Adding to an existing case needs the safeguarding officer.
    const o2 = await post(corridor, { type: 'POSSIBLE_AGGRESSION', confidence: 0.7 });
    await inOak(() => camera.review(principal, o2.id, { decision: 'NEEDS_FOLLOW_UP', notes: 'Unclear' }));
    await expect(inOak(() => camera.linkCase(principal, o2.id, { caseId: String(c._id) }))).rejects.toMatchObject({ code: 'NEEDS_SAFEGUARDING_OFFICER' });
    // Evidence on a referred observation is held past retention; others are purged.
    await inOak(() => camera.purgeEvidence({ now: new Date(Date.now() + 30 * 86_400_000) }));
    expect((await inOak(() => CameraObservation.findById(o.id).lean())).evidenceRef).toBe('vault://clip/9');
  });

  it('puts a possibly unattended room next to the timetable, the teacher\'s check-in and cover', async () => {
    const offering = await inOak(() => SubjectOffering.create({ sectionId: s.sectionA._id, subjectId: new mongoose.Types.ObjectId(), termId: new mongoose.Types.ObjectId(), teacherId: s.people.TEACHER.profile._id }));
    await inOak(() => TimetableSlot.create({ sectionId: s.sectionA._id, dayOfWeek: istWeekday(), periodNo: 3, startTime: '00:00', endTime: '23:59', subjectOfferingId: offering._id, room: 'R-6A' }));
    const before = await post(classroom, { type: 'POSSIBLE_UNATTENDED_ROOM', confidence: 0.7, room: 'R-6A' });
    let o = await inOak(() => camera.get(principal, before.id));
    expect(o.context).toMatchObject({ scheduled: true, periodNo: 3, checkIn: null });
    expect(o.context.summary).toMatch(/No teacher check-in/);
    // The teacher checks in; the same observation now shows it. Nothing was decided automatically.
    await inOak(() => camera.checkIn(s.people.TEACHER.actor, { periodNo: 3 }));
    await expect(inOak(() => camera.checkIn(s.people.TEACHER.actor, { periodNo: 3 }))).rejects.toMatchObject({ code: 'ALREADY_CHECKED_IN' });
    await expect(inOak(() => camera.checkIn(s.people.LIBRARIAN.actor, { periodNo: 3 }))).rejects.toMatchObject({ code: 'NO_CLASS' });
    o = await inOak(() => camera.get(principal, before.id));
    expect(o.context.checkIn).toBeTruthy();
    expect(o.status).toBe('UNVERIFIED');
  });

  it('reports a false-alert rate only when there are reviews', async () => {
    let m = await inOak(() => camera.metrics({}));
    expect(m.types.find((t) => t.type === 'POSSIBLE_AGGRESSION').falseAlertRate).toBe(null);
    const a = await post(corridor, { type: 'POSSIBLE_AGGRESSION', confidence: 0.9 });
    const b = await post(corridor, { type: 'POSSIBLE_AGGRESSION', confidence: 0.9 });
    await inOak(() => camera.review(principal, a.id, { decision: 'FALSE_ALERT', notes: 'Play' }));
    await inOak(() => camera.review(principal, b.id, { decision: 'CONFIRMED', notes: 'Pushing' }));
    m = await inOak(() => camera.metrics({}));
    expect(m.types.find((t) => t.type === 'POSSIBLE_AGGRESSION')).toMatchObject({ reviewed: 2, falseAlertRate: 50 });
  });
});

describe('restricted', () => {
  it('never reaches alerts, notification text, the campus map or roles without the review key', async () => {
    const o = await post(corridor, { type: 'POSSIBLE_AGGRESSION', confidence: 0.95, room: 'Corridor B', evidenceRef: 'vault://clip/secret-77' });
    expect(await inOak(() => SafetyAlert.countDocuments({}))).toBe(0);
    const notes = await inOak(() => Notification.find({}).lean());
    const outbox = await inOak(() => MessageOutbox.find({ templateKey: 'CAMERA_REVIEW_PENDING' }).lean());
    expect(outbox.length).toBeGreaterThan(0);
    const text = JSON.stringify([notes, outbox]);
    expect(text).not.toMatch(/Corridor B|secret-77|AGGRESSION/i);
    // Reviewers notified are only holders of camera.events.review.
    const recipients = new Set(outbox.map((m) => String(m.recipientProfileId)));
    expect(recipients.has(String(s.people.ADMIN.profile._id))).toBe(false);
    expect(recipients.has(String(s.people.PARENT.profile._id))).toBe(false);

    const { campusMap } = await import('../src/modules/campus/campus.service.js');
    const map = await inOak(() => campusMap(principal, {}).catch((e) => ({ error: e.message })));
    expect(JSON.stringify(map)).not.toMatch(/secret-77|POSSIBLE_AGGRESSION|CameraObservation/);

    const can = (actor) => { try { requirePermission('camera.events.review')({ actor }, {}, () => {}); return true; } catch { return false; } };
    expect(can(s.people.PARENT.actor)).toBe(false);
    expect(can(s.people.TEACHER.actor)).toBe(false);
    expect(can(s.people.ADMIN.actor)).toBe(false);
    expect(can(principal)).toBe(true);
    expect(can(compliance)).toBe(true);
    expect(o.status).toBe('UNVERIFIED');
  });

  it('the camera API is off until the school switches it on', async () => {
    await inOak(() => setFeatures({ camera: false }));
    const err = await inOak(() => new Promise((resolve) => requireFeature('camera')({}, {}, resolve)));
    expect(err).toMatchObject({ code: 'FEATURE_OFF' });
  });
});
