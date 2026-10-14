import { describe, it, expect, beforeEach } from 'vitest';
import { seedTransportSchool, inOak } from './support/transportSafety.js';
import { HostelRoom, HostelAllocation } from '../src/models/hostel.model.js';
import { OutPass, SafetyAlert } from '../src/models/safety.model.js';
import { MessageOutbox } from '../src/models/messaging.model.js';
import * as outpass from '../src/modules/hostel/outpass.service.js';
import * as checkpoints from '../src/modules/safety/checkpoints.service.js';
import { setFeatures } from '../src/utils/features.js';

/**
 * Hostel out-pass: a student's request waits for the guardian, then the
 * warden; exit and return are recorded (by a gate scan or by hand); a late
 * return alerts the warden and the guardians once; non-residents and other
 * families are refused.
 */
let s;
const H = 3600_000;
beforeEach(async () => {
  s = await seedTransportSchool({ features: { idCheckpoints: true } });
  await inOak(async () => {
    const room = await HostelRoom.create({ roomNo: 'B-101', capacity: 4, type: 'BOYS' });
    // Rahul (the PARENT's child) and Priya (the STUDENT) live in the hostel.
    await HostelAllocation.create({ roomId: room._id, studentId: s.rahul.student._id, status: 'ACTIVE' });
    await HostelAllocation.create({ roomId: room._id, studentId: s.priya.student._id, status: 'ACTIVE' });
  });
});

const body = (extra = {}) => ({ fromAt: new Date(Date.now() + H), toAt: new Date(Date.now() + 26 * H), reason: 'Family function', destination: 'Home (sample town)', escort: { name: 'Father', relationship: 'Father' }, ...extra });

describe('out-pass', () => {
  it('student request → guardian → warden → exit by gate scan → late return alert once', async () => {
    const student = s.people.STUDENT.actor;
    const p = await inOak(() => outpass.request(student, 'OWN', body()));
    expect(p.status).toBe('PENDING_PARENT');
    // The STUDENT's guardian is not the demo PARENT; the demo parent cannot confirm.
    await expect(inOak(() => outpass.parentDecision(s.people.PARENT.actor, p.id, { decision: 'APPROVED' }))).rejects.toMatchObject({ statusCode: 404 });
    await expect(inOak(() => outpass.wardenDecision(s.people.WARDEN.actor, p.id, { decision: 'APPROVED' }))).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    // The demo parent's own child: a guardian request skips straight to the warden.
    const q = await inOak(() => outpass.request(s.people.PARENT.actor, 'OWN', body({ studentId: String(s.rahul.student._id), fromAt: new Date(Date.now() - H), toAt: new Date(Date.now() + 2 * H) })));
    expect(q.status).toBe('PENDING_WARDEN');
    await expect(inOak(() => outpass.wardenDecision(s.people.WARDEN.actor, q.id, { decision: 'REJECTED' }))).rejects.toThrow(/note/);
    await inOak(() => outpass.wardenDecision(s.people.WARDEN.actor, q.id, { decision: 'APPROVED' }));
    const card = await inOak(() => checkpoints.issueCard(s.people.ADMIN.actor, { studentId: String(s.rahul.student._id), code: 'QR-OAK-1' }));
    const scan = await inOak(() => checkpoints.scan({ actor: s.people.ADMIN.actor }, { code: card.code, point: 'GATE_OUT' }));
    expect(scan.flags).toEqual([]);
    expect((await inOak(() => OutPass.findById(q.id).lean())).status).toBe('OUT');

    const late = new Date(Date.now() + 4 * H);
    await inOak(() => outpass.alertLate({ now: late }));
    await inOak(() => outpass.alertLate({ now: new Date(late.getTime() + H) }));
    expect(await inOak(() => SafetyAlert.countDocuments({ kind: 'OUTPASS_LATE' }))).toBe(1);
    const told = await inOak(() => MessageOutbox.distinct('recipientProfileId', { templateKey: 'OUTPASS_UPDATE', preview: /past the expected return/ }));
    expect(told.map(String)).toContain(String(s.people.PARENT.profile._id));

    const back = await inOak(() => outpass.recordManual(s.people.WARDEN.actor, q.id, { event: 'RETURN', at: late }));
    expect(back).toMatchObject({ status: 'RETURNED', late: true });
  });

  it('refuses a non-resident, overlapping dates and another family\'s child', async () => {
    await expect(inOak(() => outpass.request(s.people.WARDEN.actor, 'ALL', body({ studentId: String(s.aman.student._id) })))).rejects.toMatchObject({ code: 'NOT_A_RESIDENT' });
    await inOak(() => outpass.request(s.people.PARENT.actor, 'OWN', body({ studentId: String(s.rahul.student._id) })));
    await expect(inOak(() => outpass.request(s.people.PARENT.actor, 'OWN', body({ studentId: String(s.rahul.student._id) })))).rejects.toMatchObject({ code: 'OVERLAP' });
    await expect(inOak(() => outpass.request(s.people.PARENT.actor, 'OWN', body({ studentId: String(s.priya.student._id) })))).rejects.toMatchObject({ statusCode: 404 });
    const list = await inOak(() => outpass.list(s.people.STUDENT.actor, 'OWN', {}));
    expect(list).toEqual([]);
  });

  it('a manual exit and an on-time return are not late', async () => {
    const q = await inOak(() => outpass.request(s.people.PARENT.actor, 'OWN', body({ studentId: String(s.rahul.student._id) })));
    await inOak(() => outpass.wardenDecision(s.people.WARDEN.actor, q.id, { decision: 'APPROVED' }));
    await inOak(() => outpass.recordManual(s.people.WARDEN.actor, q.id, { event: 'EXIT' }));
    const back = await inOak(() => outpass.recordManual(s.people.WARDEN.actor, q.id, { event: 'RETURN' }));
    expect(back.late).toBe(false);
    expect(back.history.map((h) => h.action)).toEqual(['REQUESTED', 'APPROVED', 'OUT', 'RETURNED']);
  });

  it('the feature switch is honoured by the API', async () => {
    const { requireFeature } = await import('../src/utils/features.js');
    await inOak(() => setFeatures({ hostelOutpass: false }));
    const err = await inOak(() => new Promise((resolve) => requireFeature('hostelOutpass')({}, {}, resolve)));
    expect(err).toMatchObject({ code: 'FEATURE_OFF' });
  });
});
