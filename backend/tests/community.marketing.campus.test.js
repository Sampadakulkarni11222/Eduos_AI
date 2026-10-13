import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { seedRoles, seedPerson, inSchool, OAK, RIVER } from './support/mcpSchool.js';
import * as community from '../src/modules/community/community.service.js';
import * as marketing from '../src/modules/marketing/marketing.service.js';
import * as campus from '../src/modules/campus/campus.service.js';
import * as facilities from '../src/modules/administration/facility.service.js';
import * as insights from '../src/modules/insights/insights.service.js';
import * as events from '../src/modules/administration/events.service.js';
import { Lead } from '../src/models/lead.model.js';
import { Student, StudentGuardian, Enrollment } from '../src/models/student.model.js';
import { Grade, Section, Subject, SubjectOffering } from '../src/models/academics.model.js';
import { TimetableSlot } from '../src/models/timetableSlot.model.js';
import { Facility } from '../src/models/facility.model.js';
import { IntakeCapacity } from '../src/models/marketing.model.js';

let roles;
let P;
let child;
const inOak = (fn) => inSchool(OAK, fn);

beforeEach(async () => {
  roles = await seedRoles();
  P = {};
  for (const key of ['ADMIN', 'PRINCIPAL', 'MARKETING', 'TEACHER', 'PARENT', 'STUDENT', 'ALUMNUS', 'COMPLIANCE', 'FINANCE']) {
    P[key] = await seedPerson({ roleKey: key, roleId: roles[key], displayName: `${key} person` });
  }
  P.RIVER_PARENT = await seedPerson({ roleKey: 'PARENT', roleId: roles.PARENT, tenantId: RIVER });
  await inOak(async () => {
    const g = await Grade.create({ name: 'Class 8', level: 8 });
    const s = await Section.create({ gradeId: g._id, name: 'A', classTeacherId: P.TEACHER.profile._id });
    child = await Student.create({ admissionNo: 'C-1', firstName: 'Meera', lastName: 'K', profileId: P.STUDENT.profile._id });
    await StudentGuardian.create({ studentId: child._id, guardianProfileId: P.PARENT.profile._id, relation: 'MOTHER' });
    await Enrollment.create({ studentId: child._id, sectionId: s._id, academicYearId: new mongoose.Types.ObjectId(), status: 'ACTIVE' });
  });
});

describe('Scenario: enquiry → counselling → application → offer → fee → enrolment with capacity control', () => {
  it('never allocates the last seat twice; waitlists instead', async () => {
    await inOak(() => marketing.setCapacity(P.MARKETING.actor, { academicYear: '2027-28', gradeOrProgramme: 'Class 1', capacity: 1 }));
    const [a, b] = await inOak(() => Lead.create([
      { childName: 'A', guardianName: 'GA', phone: '+919800000001' },
      { childName: 'B', guardianName: 'GB', phone: '+919800000002' },
    ]));
    const results = await Promise.allSettled([
      inOak(() => marketing.offerSeat(P.MARKETING.actor, { leadId: String(a._id), academicYear: '2027-28', gradeOrProgramme: 'Class 1' })),
      inOak(() => marketing.offerSeat(P.MARKETING.actor, { leadId: String(b._id), academicYear: '2027-28', gradeOrProgramme: 'Class 1' })),
    ]);
    const statuses = results.filter((r) => r.status === 'fulfilled').map((r) => r.value.status).sort();
    expect(statuses).toEqual(['OFFERED', 'WAITLISTED']);
    const cap = await inOak(() => IntakeCapacity.findOne({}).lean());
    expect(cap.offered).toBe(1);
    await expect(inOak(() => marketing.offerSeat(P.MARKETING.actor, { leadId: String(a._id), academicYear: '2027-28', gradeOrProgramme: 'Class 1' }))).rejects.toMatchObject({ code: 'DUPLICATE_OFFER' });
  });

  it('distinguishes accepted, fee paid and enrolled; fee paid needs a paid invoice', async () => {
    await inOak(() => marketing.setCapacity(P.MARKETING.actor, { academicYear: '2027-28', gradeOrProgramme: 'Class 1', capacity: 5 }));
    const lead = await inOak(() => Lead.create({ childName: 'C', guardianName: 'GC', phone: '+919800000003' }));
    const appt = await inOak(() => marketing.bookAppointment(P.MARKETING.actor, { leadId: String(lead._id), kind: 'CAMPUS_TOUR', at: new Date(Date.now() + 86_400_000).toISOString() }));
    expect(appt.kind).toBe('CAMPUS_TOUR');
    expect((await inOak(() => Lead.findById(lead._id).lean())).stage).toBe('TOUR_SCHEDULED');
    await expect(inOak(() => marketing.bookAppointment(P.MARKETING.actor, { leadId: String(lead._id), kind: 'CALL', at: new Date(Date.now() + 86_400_000 + 10 * 60_000).toISOString() }))).rejects.toMatchObject({ code: 'APPOINTMENT_CLASH' });
    const offer = await inOak(() => marketing.offerSeat(P.MARKETING.actor, { leadId: String(lead._id), academicYear: '2027-28', gradeOrProgramme: 'Class 1' }));
    await inOak(() => marketing.moveOffer(P.MARKETING.actor, offer.id, { to: 'ACCEPTED' }));
    await expect(inOak(() => marketing.moveOffer(P.MARKETING.actor, offer.id, { to: 'ENROLLED', studentId: String(child._id) }))).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await expect(inOak(() => marketing.moveOffer(P.MARKETING.actor, offer.id, { to: 'FEE_PAID', invoiceId: String(new mongoose.Types.ObjectId()) }))).rejects.toMatchObject({ statusCode: 404 });
    const cap = await inOak(() => IntakeCapacity.findOne({}).lean());
    expect(cap).toMatchObject({ offered: 0, accepted: 1 });
  });

  it('creative assets need verified claims and a different reviewer', async () => {
    const asset = await inOak(() => marketing.createAsset(P.MARKETING.actor, { kind: 'POSTER', title: 'Admissions open', size: 'A3_POSTER', claims: [{ text: '100% board results' }], altText: 'Students in the library', url: '/uploads/poster-v1.png' }));
    expect(asset.dimensions).toEqual({ w: 297, h: 420, unit: 'mm' });
    await expect(inOak(() => marketing.updateAsset(P.PRINCIPAL.actor, asset.id, { status: 'APPROVED' }))).rejects.toMatchObject({ code: 'CLAIMS_UNVERIFIED' });
    await inOak(() => marketing.updateAsset(P.MARKETING.actor, asset.id, { claims: [{ text: '100% board results', verified: true, evidence: 'CBSE result sheet 2026' }] }));
    await expect(inOak(() => marketing.updateAsset(P.MARKETING.actor, asset.id, { status: 'APPROVED' }))).rejects.toMatchObject({ code: 'SELF_REVIEW' });
    const ok = await inOak(() => marketing.updateAsset(P.PRINCIPAL.actor, asset.id, { status: 'APPROVED' }));
    expect(ok.status).toBe('APPROVED');
  });

  it('funnel analytics name their definitions and keep "no data" distinct from zero', async () => {
    const empty = await inOak(() => marketing.analytics({}));
    expect(empty.conversionPct).toBeNull();
    expect(empty.response.medianHours).toBeNull();
    await inOak(() => Lead.create([{ childName: 'X', guardianName: 'Y', phone: '+919800000009', source: 'WEB', stage: 'ENROLLED' }, { childName: 'Z', guardianName: 'W', phone: '9800000009', source: 'WALK_IN' }]));
    const a = await inOak(() => marketing.analytics({}));
    expect(a.conversionPct).toBe(50);
    expect(a.response.definition).toMatch(/first recorded response/);
    expect(await inOak(() => marketing.duplicateLeads())).toHaveLength(1);
  });
});

describe('Newsroom and circles', () => {
  it('student posts wait for review; consent decides which photos appear where; withdrawal hides at once', async () => {
    const draft = await inOak(() => community.createPost(P.STUDENT.actor, { body: 'Our robotics win!', audience: 'INSTITUTION', submit: true, media: [{ url: '/uploads/robot.jpg', altText: 'Robot on stage' }] }));
    expect(draft.status).toBe('PENDING_REVIEW');
    expect((await inOak(() => community.feed(P.PARENT.actor, {}))).items).toHaveLength(0);
    await inOak(() => community.moderatePost(P.PRINCIPAL.actor, draft.id, { decision: 'PUBLISH' }));
    expect((await inOak(() => community.feed(P.PARENT.actor, {}))).items).toHaveLength(1);

    // A public post picturing a child needs PUBLIC consent and stripped metadata.
    const pub = await inOak(() => community.createPost(P.PRINCIPAL.actor, { body: 'Annual day', audience: 'PUBLIC', media: [{ url: '/uploads/annual.jpg', altText: 'Dance', studentIds: [String(child._id)], metadataStripped: true }] }));
    await expect(inOak(() => community.submitPost(P.PRINCIPAL.actor, pub.id))).rejects.toMatchObject({ code: 'CONSENT_MISSING' });
    await expect(inOak(() => community.setConsent(P.RIVER_PARENT.actor, { studentId: String(child._id), level: 'PUBLIC' }))).rejects.toMatchObject({ statusCode: 403 });
    await inOak(() => community.setConsent(P.PARENT.actor, { studentId: String(child._id), level: 'PUBLIC' }));
    await inOak(() => community.submitPost(P.PRINCIPAL.actor, pub.id));
    let publicFeed = await inOak(() => community.publicFeed({}));
    expect(publicFeed.items[0].media).toHaveLength(1);
    // The parent withdraws: the photo disappears from the published post immediately.
    await inOak(() => community.setConsent(P.PARENT.actor, { studentId: String(child._id), level: 'INTERNAL' }));
    publicFeed = await inOak(() => community.publicFeed({}));
    expect(publicFeed.items[0].media).toHaveLength(0);
    expect(publicFeed.items[0].mediaWithheld).toBe(1);
    // Still visible to the signed-in community at INTERNAL level.
    const inside = await inOak(() => community.feed(P.TEACHER.actor, {}));
    expect(inside.items.find((p) => p.id === pub.id).media).toHaveLength(1);
  });

  it('private-circle posts are not reachable by search, feed or id for non-members, or from another school', async () => {
    const circle = await inOak(() => community.createCircle(P.TEACHER.actor, { name: 'Robotics Club', kind: 'CLUB', joinPolicy: 'APPROVAL' }));
    const post = await inOak(() => community.createPost(P.TEACHER.actor, { body: 'Secret build plan', audience: 'CIRCLE', circleId: circle.id, submit: true }));
    expect(post.status).toBe('PUBLISHED');
    expect((await inOak(() => community.feed(P.PARENT.actor, { q: 'Secret' }))).items).toHaveLength(0);
    await expect(inOak(() => community.getPost(P.PARENT.actor, post.id))).rejects.toMatchObject({ statusCode: 404 });
    await expect(inSchool(RIVER, () => community.getPost(P.RIVER_PARENT.actor, post.id))).rejects.toMatchObject({ statusCode: 404 });
    expect((await inOak(() => community.publicFeed({}))).items).toHaveLength(0);
    // Joining needs approval; once approved the member sees it.
    expect((await inOak(() => community.joinCircle(P.STUDENT.actor, circle.id))).status).toBe('PENDING');
    expect((await inOak(() => community.feed(P.STUDENT.actor, { circleId: circle.id }))).items).toHaveLength(0);
    await inOak(() => community.manageMember(P.TEACHER.actor, circle.id, { profileId: P.STUDENT.actor.profileId, action: 'APPROVE' }));
    expect((await inOak(() => community.feed(P.STUDENT.actor, { circleId: circle.id }))).items).toHaveLength(1);
    await expect(inOak(() => community.manageMember(P.TEACHER.actor, circle.id, { profileId: P.STUDENT.actor.profileId, action: 'MAKE_MODERATOR' }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('alumni circles are adults-only; mentoring a student is always supervised', async () => {
    const alumni = await inOak(() => community.createCircle(P.ALUMNUS.actor, { name: 'Batch of 2015', kind: 'ALUMNI', joinPolicy: 'OPEN' }));
    await expect(inOak(() => community.joinCircle(P.STUDENT.actor, alumni.id))).rejects.toMatchObject({ code: 'ADULTS_ONLY' });
    expect((await inOak(() => community.listCircles(P.STUDENT.actor))).map((c) => c.id)).not.toContain(alumni.id);
    const mp = await inOak(() => community.upsertMentorProfile(P.ALUMNUS.actor, { headline: 'Engineer at a startup', topics: ['engineering'] }));
    expect((await inOak(() => community.listMentors(P.STUDENT.actor))).length).toBe(0);
    await inOak(() => community.verifyMentor(P.PRINCIPAL.actor, mp.id));
    const req = await inOak(() => community.requestMentoring(P.STUDENT.actor, { mentorId: mp.id, topic: 'Choosing engineering' }));
    expect(req.supervised).toBe(true);
    await inOak(() => community.respondMentoring(P.ALUMNUS.actor, req.id, { action: 'ACCEPT' }));
    await expect(inOak(() => community.respondMentoring(P.ALUMNUS.actor, req.id, { action: 'SCHEDULE', at: new Date().toISOString(), mode: 'GROUP_ONLINE' }))).rejects.toMatchObject({ code: 'SUPERVISOR_REQUIRED' });
    await inOak(() => community.respondMentoring(P.PRINCIPAL.actor, req.id, { action: 'ASSIGN_SUPERVISOR' }));
    await expect(inOak(() => community.respondMentoring(P.ALUMNUS.actor, req.id, { action: 'SCHEDULE', at: new Date().toISOString(), mode: 'ONE_TO_ONE' }))).rejects.toMatchObject({ code: 'SUPERVISION_REQUIRED' });
    const ok = await inOak(() => community.respondMentoring(P.ALUMNUS.actor, req.id, { action: 'SCHEDULE', at: new Date().toISOString(), mode: 'GROUP_ONLINE' }));
    expect(ok.status).toBe('SCHEDULED');
  });

  it('a completed event seeds a draft highlight (never auto-published, no attendee list)', async () => {
    const start = new Date(Date.now() - 3 * 86_400_000);
    const ev = await inOak(() => events.proposeEvent(P.TEACHER.actor, { title: 'Sports Day', kind: 'SPORTS', startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3600_000).toISOString() }));
    await inOak(async () => {
      const { InstitutionEvent } = await import('../src/models/administration.model.js');
      await InstitutionEvent.updateOne({ _id: ev.id }, { $set: { status: 'LIVE' } });
    });
    await inOak(() => events.completeEvent(P.TEACHER.actor, ev.id, { summary: 'Red house won', highlights: ['New 100m record'] }));
    const post = await inOak(() => community.draftFromEvent(P.TEACHER.actor, ev.id));
    expect(post.status).toBe('DRAFT');
    expect(post.body).toContain('Red house won');
  });
});

describe('Campus map', () => {
  it('filters layers by role and never sends restricted spaces to families', async () => {
    await inOak(() => facilities.createSampleCampus({}));
    await inOak(async () => {
      const room = await Facility.findOne({ code: 'G01' });
      const sec = await Section.findOne({});
      room.sectionId = sec._id;
      await room.save();
      const subj = await Subject.create({ name: 'Mathematics', code: 'MATH' });
      const off = await SubjectOffering.create({ sectionId: sec._id, subjectId: subj._id, teacherId: P.TEACHER.profile._id, academicYearId: new mongoose.Types.ObjectId(), termId: new mongoose.Types.ObjectId() });
      const dow = ((new Date(Date.now() + 330 * 60_000).getUTCDay() + 6) % 7) + 1;
      await TimetableSlot.create({ sectionId: sec._id, dayOfWeek: dow, periodNo: 1, startTime: '00:00', endTime: '23:59', subjectOfferingId: off._id });
    });
    const asTeacher = await inOak(() => campus.campusMap(P.TEACHER.actor, {}));
    expect(asTeacher.sampleLayout).toBe(true);
    const g01 = asTeacher.facilities.find((f) => f.code === 'G01');
    expect(g01.now[0]).toMatchObject({ type: 'SCHEDULED_CLASS', source: 'TIMETABLE' });
    expect(g01.now[0].teacher).toBe('TEACHER person');
    expect(asTeacher.kpis.definition).toMatch(/not measured occupancy/);
    expect(asTeacher.facilities.find((f) => f.code === 'ADM-SRV').name).toBe('Restricted area');

    const asParent = await inOak(() => campus.campusMap(P.PARENT.actor, {}));
    expect(asParent.layers.schedule).toBe(false);
    expect(asParent.facilities.some((f) => f.code === 'ADM-SRV' || f.code === 'MED-1')).toBe(false);
    expect(JSON.stringify(asParent)).not.toContain('TEACHER person');
    const p = asParent.facilities.find((f) => f.code === 'G01');
    expect(p.now).toEqual([]);
    const srv = await inOak(() => Facility.findOne({ code: 'ADM-SRV' }).lean());
    await expect(inOak(() => campus.facilityDetail(P.PARENT.actor, String(srv._id)))).rejects.toMatchObject({ statusCode: 404 });
    const asAdmin = await inOak(() => campus.facilityDetail(P.ADMIN.actor, String(srv._id)));
    expect(asAdmin.name).toBe('Server Room');
  });
});

describe('Principal briefing', () => {
  it('returns defined, linked KPIs and never fabricates a value', async () => {
    const h = await inOak(() => insights.home(P.PRINCIPAL.actor));
    expect(h.role).toBe('PRINCIPAL');
    for (const k of h.kpis) {
      expect(k.definition).toBeTruthy();
      expect(k.source).toBeTruthy();
      expect(['OK', 'UNAVAILABLE', 'NOT_APPLICABLE']).toContain(k.status);
    }
    // No attendance marked yet: reported unavailable, not 0%.
    expect(h.kpis.find((k) => k.key === 'attendance.today')).toMatchObject({ value: null, status: 'UNAVAILABLE' });
    const sg = h.kpis.find((k) => k.key === 'safeguarding.open');
    expect(sg.link).toBeNull();
    const t = await inOak(() => insights.home(P.TEACHER.actor));
    expect(t.kpis.find((k) => k.key === 'attendance.unmarked').value).toBe(1);
  });
});
