import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, seedPerson, inSchool, OAK } from './support/mcpSchool.js';
import { Role } from '../src/models/role.model.js';
import { Profile } from '../src/models/profile.model.js';
import { Student, StudentGuardian, Enrollment } from '../src/models/student.model.js';
import { AlumniProfile } from '../src/models/alumni.model.js';
import { Circle } from '../src/models/community.model.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { requirePermission } from '../src/middleware/permission.js';
import { getOwnStudentId } from '../src/utils/scope.js';
import * as alumni from '../src/modules/alumni/alumni.service.js';

/**
 * Alumni lifecycle: graduation closes the student profile and opens an
 * ALUMNUS profile with community access only; the directory shows name and
 * batch until a person opts in field by field; a former teacher is listed
 * under the years they served; posts in alumni circles wait for alumni.manage;
 * reunions reach their batch; a student's profile links stay private unless the
 * student and (for a minor) a guardian agree.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);

async function actorFor(profileId) {
  const p = await Profile.findById(profileId).lean();
  const role = await Role.findById(p.roleId);
  return { accountId: String(p.accountId), profileId: String(p._id), displayName: p.displayName, roleKey: role.key, permissions: buildPermissionMap(role), tenantId: OAK };
}

async function graduate(studentId, extra = {}) {
  const out = await inOak(() => alumni.transition(s.people.HR.actor, { studentId: String(studentId), reason: 'GRADUATED', ...extra }));
  return { out, actor: out.profileId ? await actorFor(out.profileId) : null };
}

beforeEach(async () => {
  s = await seedSchool();
  s.people.HR = await seedPerson({ roleKey: 'HR', roleId: s.roleIds.HR, displayName: 'HR officer' });
});

describe('graduation', () => {
  it('closes the student profile and leaves community access only', async () => {
    const { out, actor } = await graduate(s.priya.student._id, { house: 'Tagore' });
    expect(out.kind).toBe('FORMER_STUDENT');
    expect(out.batchYear).toBe(2027); // the 2026-27 academic year ends in 2027
    expect(out.batchLabel).toBe('Class of 2027 · Class 6 A · Tagore house');

    const old = await Profile.findById(s.people.STUDENT.profile._id).lean();
    expect(old.status).toBe('INACTIVE');
    expect(actor.roleKey).toBe('ALUMNUS');
    expect(actor.accountId).toBe(String(s.people.STUDENT.account._id));
    await inOak(async () => {
      expect((await Student.findById(s.priya.student._id).lean()).status).toBe('INACTIVE');
      expect((await Enrollment.findById(s.priya.enrollment._id).lean()).status).toBe('GRADUATED');
      // The new profile owns no student record, so OWN-scoped student reads find nothing.
      expect(await getOwnStudentId(actor.profileId)).toBeNull();
    });

    // Community keys only: no student data, fees or marks.
    for (const key of ['marks.read', 'fees.read', 'fees.pay', 'students.read', 'attendance.read', 'assignments.read', 'reportcards.read', 'medical.read']) {
      expect(actor.permissions[key], key).toBeUndefined();
      expect(() => requirePermission(key)({ actor }, {}, () => {})).toThrow(/Missing permission/);
    }
    for (const key of ['community.read', 'alumni.directory.read', 'mentoring.participate', 'digest.read']) expect(actor.permissions[key], key).toBeTruthy();

    // Their own archived record: enrolment history, never marks or fees.
    const record = await inOak(() => alumni.myRecord(actor));
    expect(record.admissionNo).toBe('OAK-2');
    expect(record.enrolments).toEqual([{ year: '2026-27', class: 'Class 6 A', status: 'GRADUATED' }]);
    expect(Object.keys(record).some((k) => /mark|fee|attendance|medical/i.test(k))).toBe(false);

    // Batch and school-wide alumni circles.
    const circles = await inOak(() => alumni.myCircles(actor));
    expect(circles.map((c) => c.name).sort()).toEqual(['Alumni community', 'Class of 2027']);

    await expect(graduate(s.priya.student._id)).rejects.toMatchObject({ code: 'ALREADY_ALUMNUS' });
    // A current student (or anyone not an alumnus) has no alumni self-service.
    await expect(inOak(() => alumni.me(s.people.TEACHER.actor))).rejects.toMatchObject({ code: 'NOT_ALUMNUS' });
  });

  it('holds alumni posts for alumni.manage, and keeps a batch circle to its batch', async () => {
    const { actor: priya } = await graduate(s.priya.student._id);
    // A second alumnus from another batch, with a login of their own.
    const other = await seedPerson({ roleKey: 'STUDENT', roleId: s.roleIds.STUDENT, displayName: 'Old student' });
    const oldStudent = await inOak(() => Student.create({ admissionNo: 'OAK-OLD', firstName: 'Kabir', lastName: 'Rao', profileId: other.profile._id }));
    const { actor: kabir } = await graduate(oldStudent._id, { batchYear: 2019 });

    const circles = await inOak(() => alumni.myCircles(priya));
    const batch = circles.find((c) => c.name === 'Class of 2027');
    const school = circles.find((c) => c.name === 'Alumni community');
    await expect(inOak(() => alumni.createPost(kabir, { circleId: batch.id, body: 'Not my batch' }))).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });

    const p = await inOak(() => alumni.createPost(priya, { circleId: batch.id, title: 'Reunion idea', body: 'Shall we meet in December?' }));
    expect(p.status).toBe('PENDING_REVIEW');
    expect(await inOak(() => alumni.listPosts(kabir, {}))).toEqual([]);
    const schoolPost = await inOak(() => alumni.createPost(priya, { circleId: school.id, body: 'Hello everyone' }));

    const hr = s.people.HR.actor;
    expect((await inOak(() => alumni.listPosts(hr, {}))).map((x) => x.status)).toEqual(['PENDING_REVIEW', 'PENDING_REVIEW']);
    await expect(inOak(() => alumni.moderatePost(hr, schoolPost.id, { decision: 'REJECT' }))).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await inOak(() => alumni.moderatePost(hr, p.id, { decision: 'PUBLISH' }));
    await inOak(() => alumni.moderatePost(hr, schoolPost.id, { decision: 'PUBLISH' }));
    // The batch post reaches its batch; the school-wide post reaches every alumnus.
    expect((await inOak(() => alumni.listPosts(kabir, {}))).map((x) => x.body)).toEqual(['Hello everyone']);
    expect((await inOak(() => alumni.listPosts(priya, {}))).length).toBe(2);
  });

  it('sends reunions to their batch and takes replies', async () => {
    const { actor: priya } = await graduate(s.priya.student._id);
    const ev = await inOak(() => alumni.createEvent(s.people.HR.actor, { title: 'Class of 2027 reunion', batchYear: 2027, startsAt: '2027-12-20T11:00:00Z', venue: 'School hall' }));
    await inOak(() => alumni.createEvent(s.people.HR.actor, { title: 'Class of 2010 reunion', batchYear: 2010, startsAt: '2027-12-21T11:00:00Z' }));
    const mine = await inOak(() => alumni.listEvents(priya));
    expect(mine.map((e) => e.title)).toEqual(['Class of 2027 reunion']);
    const r = await inOak(() => alumni.rsvp(priya, ev.id, { response: 'YES' }));
    expect(r.rsvp).toMatchObject({ yes: 1, mine: 'YES' });
  });
});

describe('directory consent', () => {
  it('shows name and batch only, and each optional field only after its own consent', async () => {
    const { actor } = await graduate(s.priya.student._id);
    await inOak(() => alumni.updateMe(actor, { profession: 'Doctor', city: 'Pune', links: { linkedin: 'https://www.linkedin.com/in/priya-sample' } }));
    const viewer = s.people.TEACHER.actor;
    let [row] = (await inOak(() => alumni.directory(viewer, {}))).items;
    expect(row).toMatchObject({ name: 'Priya Verma', batchLabel: 'Class of 2027 · Class 6 A' });
    expect(row.profession).toBeUndefined();
    expect(row.city).toBeUndefined();
    expect(row.links).toBeUndefined();

    await inOak(() => alumni.updateMe(actor, { consent: { profession: true } }));
    [row] = (await inOak(() => alumni.directory(viewer, {}))).items;
    expect(row.profession).toBe('Doctor');
    expect(row.city).toBeUndefined();
    expect(row.links).toBeUndefined();

    // A manager sees the consent flags, not the private values.
    const [rec] = await inOak(() => alumni.listAlumni(s.people.HR.actor, {}));
    expect(rec.consent).toEqual({ profession: true, city: false, links: false });
    expect(rec.city).toBeUndefined();

    // Opting out of the directory removes the person entirely.
    await inOak(() => alumni.updateMe(actor, { listed: false }));
    expect((await inOak(() => alumni.directory(viewer, {}))).items).toEqual([]);
  });

  it('accepts only https links on the allowed hosts', async () => {
    const { actor } = await graduate(s.priya.student._id);
    const bad = [
      { linkedin: 'http://www.linkedin.com/in/x' },
      { linkedin: 'https://evil.example.com/in/x' },
      { github: 'https://github.com.evil.example/x' },
      { website: 'https://10.0.0.1/' },
      { website: 'https://localhost/me' },
      { website: 'javascript:alert(1)' },
      { instagram: 'https://user:pw@instagram.com/x' },
      { tiktok: 'https://tiktok.com/@x' },
    ];
    for (const links of bad) await expect(inOak(() => alumni.updateMe(actor, { links })), JSON.stringify(links)).rejects.toMatchObject({ statusCode: 400 });
    const ok = await inOak(() => alumni.updateMe(actor, { links: { github: 'https://github.com/priya-sample', website: 'https://priya.example.org/' } }));
    expect(ok.links).toMatchObject({ github: 'https://github.com/priya-sample', website: 'https://priya.example.org/' });
  });
});

describe('former staff', () => {
  it('lists a former teacher under the years they served', async () => {
    const hr = s.people.HR.actor;
    const out = await inOak(() => alumni.transition(hr, { staffProfileId: String(s.people.TEACHER.profile._id), reason: 'RETIRED', servedFrom: 2015, servedTo: 2020 }));
    expect(out).toMatchObject({ kind: 'FORMER_STAFF', batchLabel: 'Staff 2015–2020' });
    expect((await Profile.findById(s.people.TEACHER.profile._id).lean()).status).toBe('INACTIVE');
    const viewer = s.people.PRINCIPAL.actor;
    const in2018 = await inOak(() => alumni.directory(viewer, { batchYear: 2018 }));
    expect(in2018.items.map((r) => r.batchLabel)).toEqual(['Staff 2015–2020']);
    expect((await inOak(() => alumni.directory(viewer, { batchYear: 2021 }))).items).toEqual([]);
    expect((await inOak(() => alumni.directory(viewer, { batchYear: 2015, kind: 'FORMER_STUDENT' }))).items).toEqual([]);
    const batches = await inOak(() => alumni.batches());
    expect(batches.find((b) => b.year === 2018)).toMatchObject({ staff: 1, students: 0 });
    const staffActor = await actorFor(out.profileId);
    expect((await inOak(() => alumni.myCircles(staffActor))).map((c) => c.name).sort()).toEqual(['Alumni community', 'Former staff']);
    expect(staffActor.permissions['marks.enter']).toBeUndefined();
    expect(staffActor.permissions['attendance.mark']).toBeUndefined();

    await expect(inOak(() => alumni.transition(hr, { staffProfileId: String(hr.profileId) }))).rejects.toMatchObject({ code: 'SELF_TRANSITION' });
    await expect(inOak(() => alumni.transition(hr, { staffProfileId: String(s.people.PARENT.profile._id) }))).rejects.toMatchObject({ code: 'NOT_STAFF' });
    await expect(inOak(() => alumni.transition(hr, { staffProfileId: String(s.people.FINANCE.profile._id), servedFrom: 2020, servedTo: 2010 }))).rejects.toMatchObject({ code: 'BAD_YEAR' });
  });
});

describe('student profile links', () => {
  it('stays private to the student, their guardians and staff until the student and a guardian agree', async () => {
    const mother = await seedPerson({ roleKey: 'PARENT', roleId: s.roleIds.PARENT, displayName: 'Priya\'s mother' });
    await inOak(() => StudentGuardian.create({ studentId: s.priya.student._id, guardianProfileId: mother.profile._id, relation: 'MOTHER' }));
    const id = String(s.priya.student._id);
    const priya = s.people.STUDENT.actor;
    const otherParent = s.people.PARENT.actor; // Rahul's father

    const saved = await inOak(() => alumni.setStudentLinks(priya, id, { links: { github: 'https://github.com/priya-sample' }, studentConsent: true }));
    expect(saved).toMatchObject({ minor: true, studentConsent: true, guardianConsent: false, shared: false });
    expect(await inOak(() => alumni.getStudentLinks(otherParent, id))).toEqual({ studentId: id, links: null, shared: false });
    // Staff and the guardian see them.
    expect((await inOak(() => alumni.getStudentLinks(s.people.TEACHER.actor, id))).links.github).toBe('https://github.com/priya-sample');
    expect((await inOak(() => alumni.getStudentLinks(mother.actor, id))).links.github).toBe('https://github.com/priya-sample');

    await expect(inOak(() => alumni.setStudentLinks(otherParent, id, { guardianConsent: true }))).rejects.toMatchObject({ code: 'NOT_YOUR_STUDENT' });
    await expect(inOak(() => alumni.setStudentLinks(priya, id, { guardianConsent: true }))).rejects.toMatchObject({ code: 'GUARDIAN_ONLY' });
    await inOak(() => alumni.setStudentLinks(mother.actor, id, { guardianConsent: true }));
    expect((await inOak(() => alumni.getStudentLinks(otherParent, id))).links).toEqual({ github: 'https://github.com/priya-sample' });

    // New links need the guardian's agreement again.
    await inOak(() => alumni.setStudentLinks(priya, id, { links: { instagram: 'https://www.instagram.com/priya.sample' } }));
    expect((await inOak(() => alumni.getStudentLinks(otherParent, id))).links).toBeNull();
    await expect(inOak(() => alumni.setStudentLinks(priya, id, { links: { linkedin: 'https://linkedin.evil.example/in/x' } }))).rejects.toMatchObject({ code: 'LINK_HOST_NOT_ALLOWED' });
  });
});

describe('circles', () => {
  it('creates adults-only alumni circles', async () => {
    await graduate(s.priya.student._id);
    const rows = await inOak(() => Circle.find({ kind: 'ALUMNI' }).lean());
    expect(rows.every((c) => c.adultsOnly && c.allowedRoles.includes('ALUMNUS') && c.joinPolicy === 'INVITE')).toBe(true);
    expect(await inOak(() => AlumniProfile.countDocuments())).toBe(1);
  });
});
