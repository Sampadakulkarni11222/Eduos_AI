import { describe, it, expect, beforeEach } from 'vitest';
import { seedRoles, seedPerson, inSchool, OAK } from './support/mcpSchool.js';
import * as marketing from '../src/modules/marketing/marketing.service.js';
import * as admissions from '../src/modules/admissions/admission.service.js';
import { Lead, LeadInteraction } from '../src/models/lead.model.js';
import { Student, Enrollment } from '../src/models/student.model.js';
import { Grade, Section, AcademicYear } from '../src/models/academics.model.js';
import { IntakeCapacity, SeatOffer, CounsellingAppointment } from '../src/models/marketing.model.js';
import { Notification } from '../src/models/notification.model.js';

/**
 * Marketing audit fixes.
 *
 * M1: promoting a GENERAL waitlistee capped at the raw capacity, so it took a
 *     seat reserved for RTE.
 * M2: offers never expired (offerExpiresOn was written and never read).
 * M4: a lead moved to ENROLLED created an ACTIVE student with no class, and
 *     moving it to LOST left that student active.
 * M5: a second enquiry with the same phone was accepted silently.
 * M8: the counsellor's notification printed the time in UTC.
 */

let P;
const oak = (fn) => inSchool(OAK, fn);
const YEAR = '2027-28';
const CLASS = 'Class 1';

beforeEach(async () => {
  const roles = await seedRoles();
  P = {};
  for (const key of ['MARKETING', 'ADMIN']) P[key] = await seedPerson({ roleKey: key, roleId: roles[key], displayName: `${key} person` });
});

const lead = (childName, phone) => oak(() => Lead.create({ childName, guardianName: `G ${childName}`, phone }));
const offer = (l, category) => oak(() => marketing.offerSeat(P.MARKETING.actor, { leadId: String(l._id), academicYear: YEAR, gradeOrProgramme: CLASS, category }));

describe('M1: reserved seats survive waitlist promotion', () => {
  it('a general waitlistee cannot be promoted into the RTE seat; an RTE applicant still gets it', async () => {
    await oak(() => marketing.setCapacity(P.MARKETING.actor, { academicYear: YEAR, gradeOrProgramme: CLASS, capacity: 2, reserved: [{ category: 'RTE', seats: 1 }] }));
    const a = await offer(await lead('A', '+919811100001'));
    const b = await offer(await lead('B', '+919811100002'));
    expect([a.status, b.status]).toEqual(['OFFERED', 'WAITLISTED']);

    await expect(oak(() => marketing.moveOffer(P.MARKETING.actor, b.id, { to: 'OFFERED' }))).rejects.toMatchObject({ statusCode: 409, code: 'NO_SEAT' });
    const rte = await offer(await lead('R', '+919811100003'), 'RTE');
    expect(rte.status).toBe('OFFERED');
    expect((await oak(() => IntakeCapacity.findOne({}).lean())).offered).toBe(2);
  });

  it('a general waitlistee is promoted when a general seat frees up', async () => {
    await oak(() => marketing.setCapacity(P.MARKETING.actor, { academicYear: YEAR, gradeOrProgramme: CLASS, capacity: 2, reserved: [{ category: 'RTE', seats: 1 }] }));
    const a = await offer(await lead('A', '+919811100011'));
    const b = await offer(await lead('B', '+919811100012'));
    await oak(() => marketing.moveOffer(P.MARKETING.actor, a.id, { to: 'DECLINED' }));
    const promoted = await oak(() => marketing.moveOffer(P.MARKETING.actor, b.id, { to: 'OFFERED' }));
    expect(promoted.status).toBe('OFFERED');
  });
});

describe('M2: expireOffers()', () => {
  it('expires offers past their day, frees the seat once, and leaves current offers alone', async () => {
    await oak(() => marketing.setCapacity(P.MARKETING.actor, { academicYear: YEAR, gradeOrProgramme: CLASS, capacity: 3 }));
    const assignee = P.MARKETING.profile._id;
    const l1 = await lead('Old', '+919811100021');
    const l2 = await lead('Today', '+919811100022');
    await oak(() => Lead.updateMany({}, { $set: { assigneeProfileId: assignee } }));
    const o1 = await offer(l1);
    const o2 = await offer(l2);
    const yesterday = new Date(Date.now() - 86_400_000);
    await oak(() => SeatOffer.updateOne({ _id: o1.id }, { $set: { offerExpiresOn: yesterday } }));
    await oak(() => SeatOffer.updateOne({ _id: o2.id }, { $set: { offerExpiresOn: new Date() } }));

    const [first, second] = [await oak(() => marketing.expireOffers()), await oak(() => marketing.expireOffers())];
    expect(first.expired).toBe(1);
    expect(second.expired).toBe(0);
    expect((await oak(() => SeatOffer.findById(o1.id).lean())).status).toBe('EXPIRED');
    expect((await oak(() => SeatOffer.findById(o2.id).lean())).status).toBe('OFFERED');
    expect((await oak(() => IntakeCapacity.findOne({}).lean())).offered).toBe(1);
    expect(await Notification.countDocuments({ title: /seat offer expired/ })).toBe(1);
  });
});

describe('M4: ENROLLED leads and the student record', () => {
  let section;
  beforeEach(async () => {
    section = await oak(async () => {
      await AcademicYear.create({ name: '2026-27', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31'), isCurrent: true });
      const g = await Grade.create({ name: 'Class 1', level: 1 });
      return Section.create({ gradeId: g._id, name: 'A' });
    });
  });

  it('without a class the record is reserved but not active', async () => {
    const l = await lead('Funnel Kid', '+919811100031');
    const out = await oak(() => admissions.updateLead({ leadId: String(l._id), stage: 'ENROLLED' }));
    expect(out.needsPlacement).toBe(true);
    const s = await oak(() => Student.findOne({ leadId: l._id }).lean());
    expect(s.status).toBe('INACTIVE');
    expect(s.admissionNo).toMatch(/^ADM-/);
  });

  it('with a class the student is active and enrolled in it; placing later works too', async () => {
    const l = await lead('Placed Kid', '+919811100032');
    const out = await oak(() => admissions.updateLead({ leadId: String(l._id), stage: 'ENROLLED', sectionId: String(section._id) }));
    expect(out.needsPlacement).toBe(false);
    const s = await oak(() => Student.findOne({ leadId: l._id }).lean());
    expect(s.status).toBe('ACTIVE');
    const e = await oak(() => Enrollment.findOne({ studentId: s._id }).lean());
    expect(String(e.sectionId)).toBe(String(section._id));

    const later = await lead('Later Kid', '+919811100033');
    await oak(() => admissions.updateLead({ leadId: String(later._id), stage: 'ENROLLED' }));
    await oak(() => admissions.updateLead({ leadId: String(later._id), stage: 'ENROLLED', sectionId: String(section._id) }));
    expect((await oak(() => Student.findOne({ leadId: later._id }).lean())).status).toBe('ACTIVE');
  });

  it('refuses a section that does not exist', async () => {
    const l = await lead('Nowhere Kid', '+919811100034');
    await expect(oak(() => admissions.updateLead({ leadId: String(l._id), stage: 'ENROLLED', sectionId: '64b000000000000000000000' })))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('moving the lead to LOST takes the student off the roll', async () => {
    const l = await lead('Lost Kid', '+919811100035');
    await oak(() => admissions.updateLead({ leadId: String(l._id), stage: 'ENROLLED', sectionId: String(section._id) }));
    await oak(() => admissions.updateLead({ leadId: String(l._id), stage: 'LOST' }));
    const s = await oak(() => Student.findOne({ leadId: l._id }).lean());
    expect(s.status).toBe('INACTIVE');
    expect((await oak(() => Enrollment.findOne({ studentId: s._id }).lean())).status).toBe('WITHDRAWN');
  });
});

describe('M5: duplicate phone numbers', () => {
  it('flags the second enquiry with the same number and notes it on the lead', async () => {
    const first = await oak(() => admissions.createLead({ childName: 'Ira', guardianName: 'Mr Rao', phone: '+919812345678' }));
    expect(first.possibleDuplicate).toBe(false);
    const second = await oak(() => admissions.createLead({ childName: 'Ira Rao', guardianName: 'Mrs Rao', phone: '98123 45678' }));
    expect(second.possibleDuplicate).toBe(true);
    expect(String(second.possibleDuplicates[0].id)).toBe(String(first.id));
    const notes = await oak(() => LeadInteraction.find({ leadId: second.id }).lean());
    expect(notes.some((n) => /Possible duplicate/.test(n.body))).toBe(true);
  });
});

describe('M8: notification times are IST', () => {
  it('formats the appointment time in Asia/Kolkata', async () => {
    expect(marketing.istDateTime(new Date('2026-10-15T04:30:00Z'))).toMatch(/10:00\s?am/i);
    const l = await lead('Tour Kid', '+919811100041');
    await oak(() => marketing.bookAppointment(P.MARKETING.actor, {
      leadId: String(l._id), kind: 'CALL', at: '2026-10-15T04:30:00Z', counsellorProfileId: String(P.ADMIN.profile._id),
    }));
    expect(await oak(() => CounsellingAppointment.countDocuments())).toBe(1);
    const n = await Notification.findOne({}).lean();
    expect(n.body).toMatch(/10:00\s?am/i);
    expect(n.body).not.toMatch(/UTC/);
  });
});
