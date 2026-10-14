import { describe, it, expect, beforeEach } from 'vitest';
import { seedTransportSchool, inOak } from './support/transportSafety.js';
import { Visitor, SafetyAlert, PickupAdult, ReleaseLog } from '../src/models/safety.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import * as visitors from '../src/modules/safety/visitors.service.js';
import * as pickup from '../src/modules/safety/pickup.service.js';
import { schoolDay } from '../src/modules/safety/shared.js';
import { hashOtp } from '../src/utils/otp.js';

/**
 * Visitors (host approval, ID check, badge expiry, overstay once) and child
 * pickup (guardian delegations confirmed by a one-time code, custody
 * restrictions flagged, release log, emergency roster).
 */
let s; let admin;
beforeEach(async () => { s = await seedTransportSchool(); admin = s.people.ADMIN.actor; });

describe('visitors', () => {
  it('needs the host\'s approval, a checked ID, and alerts an overstay once', async () => {
    const v = await inOak(() => visitors.create(admin, { name: 'Sample Visitor', purpose: 'Meet class teacher', hostProfileId: String(s.people.TEACHER.profile._id), expectedHours: 1 }));
    expect(v.status).toBe('PENDING_HOST');
    await expect(inOak(() => visitors.checkIn(admin, v.id, { idVerified: true }))).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    // Someone who is neither host nor office cannot decide.
    await expect(inOak(() => visitors.hostDecision(s.people.LIBRARIAN.actor, v.id, { decision: 'APPROVED' }))).rejects.toMatchObject({ statusCode: 404 });
    await inOak(() => visitors.hostDecision(s.people.TEACHER.actor, v.id, { decision: 'APPROVED' }));
    await expect(inOak(() => visitors.checkIn(admin, v.id, {}))).rejects.toMatchObject({ code: 'ID_NOT_VERIFIED' });
    const inside = await inOak(() => visitors.checkIn(admin, v.id, { idVerified: true, idType: 'Driving licence', idLast4: 'DL-1234-5678' }));
    expect(inside.idLast4).toBe('5678');
    expect(inside.badge.expiresAt).toBeTruthy();
    const later = new Date(Date.now() + 3 * 3600_000);
    await inOak(() => visitors.alertOverstays({ now: later }));
    await inOak(() => visitors.alertOverstays({ now: new Date(later.getTime() + 3600_000) }));
    expect(await inOak(() => SafetyAlert.countDocuments({ kind: 'VISITOR_OVERSTAY' }))).toBe(1);
    const out = await inOak(() => visitors.checkOut(admin, v.id, {}));
    expect(out.status).toBe('CHECKED_OUT');
  });

  it('a contractor needs the check recorded; a host registering their own visitor approves it', async () => {
    await expect(inOak(() => visitors.create(admin, { kind: 'CONTRACTOR', name: 'Sample Electrician', purpose: 'Wiring' }))).rejects.toThrow(/contractor/i);
    const own = await inOak(() => visitors.create(s.people.TEACHER.actor, { name: 'Guest speaker', purpose: 'Career talk' }));
    expect(own.status).toBe('APPROVED');
  });
});

describe('pickup', () => {
  it('a guardian\'s delegation becomes active only with the right code, and expires', async () => {
    const parent = s.people.PARENT.actor;
    const validTo = new Date(Date.now() + 2 * 86_400_000);
    const req = await inOak(() => pickup.guardianRequest(parent, { studentId: String(s.rahul.student._id), name: 'Uncle Raj', relationship: 'Uncle', validTo }));
    expect(req.status).toBe('PENDING_OTP');
    // Use a known code regardless of the SMS provider configured for tests.
    await inOak(async () => PickupAdult.updateOne({ _id: req.id }, { $set: { otpHash: await hashOtp('246810') } }));
    await expect(inOak(() => pickup.guardianConfirm(parent, req.id, { code: '000000' }))).rejects.toMatchObject({ code: 'OTP_WRONG' });
    const ok = await inOak(() => pickup.guardianConfirm(parent, req.id, { code: '246810' }));
    expect(ok.status).toBe('ACTIVE');
    // Another family's guardian cannot request for this child.
    await expect(inOak(() => pickup.guardianRequest(s.people.TEACHER.actor, { studentId: String(s.rahul.student._id), name: 'X', relationship: 'Y', validTo }))).rejects.toMatchObject({ statusCode: 404 });
    // The guardian's own list never shows restrictions.
    await inOak(() => pickup.staffCreate(admin, { studentId: String(s.rahul.student._id), kind: 'RESTRICTED', name: 'Restricted Adult', restrictionNote: 'Order no. SAMPLE/1' }));
    const mine = await inOak(() => pickup.guardianList(parent));
    expect(mine.adults.map((a) => a.name)).toEqual(['Uncle Raj']);
    expect(JSON.stringify(mine)).not.toContain('Restricted');
    await inOak(() => pickup.expireDelegations(new Date(Date.now() + 3 * 86_400_000)));
    expect((await inOak(() => PickupAdult.findById(req.id).lean())).status).toBe('EXPIRED');
  });

  it('flags a custody restriction at the gate (even by name) and logs authorised releases', async () => {
    await inOak(() => pickup.staffCreate(admin, { studentId: String(s.rahul.student._id), kind: 'RESTRICTED', name: 'Restricted Adult', restrictionNote: 'Order no. SAMPLE/2' }));
    await expect(inOak(() => pickup.release(admin, { studentId: String(s.rahul.student._id), receiver: { name: 'restricted adult' } }))).rejects.toMatchObject({ code: 'CUSTODY_RESTRICTED' });
    expect(await inOak(() => SafetyAlert.countDocuments({ kind: 'CUSTODY_RESTRICTION', severity: 'CRITICAL' }))).toBe(1);
    // A restriction on a linked guardian overrides their pickup authority.
    await inOak(() => pickup.staffCreate(admin, { studentId: String(s.aman.student._id), kind: 'RESTRICTED', name: 'Parent profile', guardianProfileId: String(s.people.PARENT.profile._id), restrictionNote: 'Order no. SAMPLE/3' }));
    await expect(inOak(() => pickup.release(admin, { studentId: String(s.aman.student._id), receiver: { guardianProfileId: String(s.people.PARENT.profile._id) } }))).rejects.toMatchObject({ code: 'CUSTODY_RESTRICTED' });
    const log = await inOak(() => pickup.release(admin, { studentId: String(s.rahul.student._id), receiver: { guardianProfileId: String(s.people.PARENT.profile._id) }, verification: 'ID_CHECKED' }));
    expect(log).toMatchObject({ context: 'GATE', receivedByKind: 'GUARDIAN', recordedByProfileId: s.people.ADMIN.profile._id });
    expect(await inOak(() => ReleaseLog.countDocuments({}))).toBe(1);
  });

  it('the emergency roster lists students present and not released, and visitors on site', async () => {
    const day = schoolDay();
    await inOak(() => AttendanceRecord.deleteMany({}));
    for (const st of [s.rahul, s.priya, s.aman]) await inOak(() => AttendanceRecord.create({ enrollmentId: st.enrollment._id, date: day, periodNo: null, status: 'PRESENT' }));
    await inOak(() => pickup.release(admin, { studentId: String(s.rahul.student._id), receiver: { guardianProfileId: String(s.people.PARENT.profile._id) } }));
    const v = await inOak(() => visitors.create(admin, { name: 'Sample Auditor', purpose: 'Audit' }));
    await inOak(() => visitors.checkIn(admin, v.id, { idVerified: true }));
    const r = await inOak(() => pickup.emergencyRoster());
    expect(r.students.map((x) => x.name).sort()).toEqual(['Aman Gupta', 'Priya Verma']);
    expect(r.visitors.map((x) => x.name)).toEqual(['Sample Auditor']);
    expect(r.releasedToday).toBe(1);
    const csv = pickup.rosterCsv(r);
    expect(csv).toContain('Sample Auditor');
    expect(csv).toContain('not proof');
    expect(await inOak(() => Visitor.countDocuments({ status: 'CHECKED_IN' }))).toBe(1);
  });
});
