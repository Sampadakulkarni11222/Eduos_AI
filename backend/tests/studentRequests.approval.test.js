import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Student, Enrollment } from '../src/models/student.model.js';
import { Grade, Section, AcademicYear } from '../src/models/academics.model.js';
// Imported for its side effect: the review queues populate the reviewer's
// Profile, and mongoose can only resolve a ref whose model has been registered.
import '../src/models/profile.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as coCurricular from '../src/modules/studentRequests/cocurricular.service.js';
import * as profileEdit from '../src/modules/studentRequests/profileEdit.service.js';

/**
 * The two student-raised workflows and the one rule they both turn on: a
 * student may only ever create a PENDING row, and only their *class teacher*
 * can turn it into anything else.
 *
 * Most of what is asserted here is what must NOT happen — a student writing to
 * their own record, a subject teacher deciding for a class they merely teach
 * in, a decision being taken twice. Those are the failures that would matter,
 * and none of them are visible from the happy path.
 */

const OAK = 'oakridge';
const inOak = (fn) => runWithTenant(OAK, fn);

const grantsFor = (roleKey) => SYSTEM_ROLES.find((r) => r.key === roleKey).grants;
const permsOf = (roleKey) => buildPermissionMap({ permissions: grantsFor(roleKey) });
const actorFor = (roleKey, profileId) => ({
  roleKey,
  profileId: profileId.toString(),
  permissions: permsOf(roleKey),
});

const classTeacherId = new mongoose.Types.ObjectId();
const subjectTeacherId = new mongoose.Types.ObjectId();
const studentProfileId = new mongoose.Types.ObjectId();

let student;
let section;

beforeEach(async () => {
  await inOak(async () => {
    const year = await AcademicYear.create({ name: '2026-27', startsOn: new Date(), endsOn: new Date(), isCurrent: true });
    const grade = await Grade.create({ name: 'Class 5', level: 5 });
    section = await Section.create({ gradeId: grade._id, name: 'A', classTeacherId });

    student = await Student.create({
      admissionNo: 'ADM-1', firstName: 'Diya', lastName: 'Sharma',
      address: '101 Lake View', profileId: studentProfileId,
    });
    await Enrollment.create({
      studentId: student._id, sectionId: section._id, academicYearId: year._id, status: 'ACTIVE',
    });
  });
});

const asStudent = () => actorFor('STUDENT', studentProfileId);
const asClassTeacher = () => actorFor('TEACHER', classTeacherId);
const asSubjectTeacher = () => actorFor('TEACHER', subjectTeacherId);

describe('co-curricular requests', () => {
  const validRequest = {
    name: 'District chess championship',
    category: 'SPORTS',
    level: 'DISTRICT',
    activityDate: '2026-08-20',
    achievement: 'Runner-up',
  };

  it('a student can only create a PENDING record, never an approved one', async () => {
    await inOak(async () => {
      // Even asked for outright, the status the student sends is ignored.
      const created = await coCurricular.request(asStudent(), { ...validRequest, status: 'APPROVED' });
      expect(created.status).toBe('PENDING');
    });
  });

  it('accepts a request with no supporting document', async () => {
    await inOak(async () => {
      const created = await coCurricular.request(asStudent(), validRequest);
      expect(created.documentUrl).toBeNull();
      expect(created.status).toBe('PENDING');
    });
  });

  it('keeps an uploaded document but rejects a value that is not a file or a link', async () => {
    await inOak(async () => {
      const withDoc = await coCurricular.request(asStudent(), {
        ...validRequest, documentUrl: '/uploads/abc-certificate.pdf', documentName: 'certificate.pdf',
      });
      expect(withDoc.documentUrl).toBe('/uploads/abc-certificate.pdf');

      await expect(
        coCurricular.request(asStudent(), { ...validRequest, documentUrl: 'javascript:alert(1)' })
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  it('refuses an activity dated in the future', async () => {
    await inOak(async () => {
      const nextYear = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      await expect(
        coCurricular.request(asStudent(), { ...validRequest, activityDate: nextYear })
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  it('shows the request to the class teacher and to nobody else', async () => {
    await inOak(async () => {
      await coCurricular.request(asStudent(), validRequest);

      const mine = await coCurricular.listForReview(asClassTeacher(), 'OWN', { status: 'PENDING' });
      expect(mine).toHaveLength(1);
      expect(mine[0].studentName).toBe('Diya Sharma');
      expect(mine[0].class).toBe('Class 5 A');

      // A teacher who is not this section's class teacher sees nothing —
      // teaching a subject in the room is not the same as owning the record.
      const theirs = await coCurricular.listForReview(asSubjectTeacher(), 'OWN', { status: 'PENDING' });
      expect(theirs).toHaveLength(0);
    });
  });

  it('refuses a decision from a teacher who is not the class teacher', async () => {
    await inOak(async () => {
      const created = await coCurricular.request(asStudent(), validRequest);
      await expect(
        coCurricular.decide(asSubjectTeacher(), 'OWN', created.id, { status: 'APPROVED' })
      ).rejects.toMatchObject({ code: 'NOT_CLASS_TEACHER' });
    });
  });

  it('refuses a rejection with no reason', async () => {
    await inOak(async () => {
      const created = await coCurricular.request(asStudent(), validRequest);
      await expect(
        coCurricular.decide(asClassTeacher(), 'OWN', created.id, { status: 'REJECTED' })
      ).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    });
  });

  it('adds the activity to the profile on approval and keeps it off on rejection', async () => {
    await inOak(async () => {
      const approvedReq = await coCurricular.request(asStudent(), validRequest);
      await coCurricular.decide(asClassTeacher(), 'OWN', approvedReq.id, { status: 'APPROVED' });

      const rejectedReq = await coCurricular.request(asStudent(), { ...validRequest, name: 'Unverified marathon' });
      await coCurricular.decide(asClassTeacher(), 'OWN', rejectedReq.id, {
        status: 'REJECTED', rejectionReason: 'No certificate attached.',
      });

      const onProfile = await coCurricular.listForStudent(asStudent(), 'OWN', { status: 'APPROVED' });
      expect(onProfile.map((a) => a.name)).toEqual(['District chess championship']);

      // The student still sees the rejection and why, rather than it vanishing.
      const all = await coCurricular.listForStudent(asStudent(), 'OWN', {});
      const rejected = all.find((a) => a.name === 'Unverified marathon');
      expect(rejected.status).toBe('REJECTED');
      expect(rejected.rejectionReason).toBe('No certificate attached.');
    });
  });

  it('refuses to decide the same request twice', async () => {
    await inOak(async () => {
      const created = await coCurricular.request(asStudent(), validRequest);
      await coCurricular.decide(asClassTeacher(), 'OWN', created.id, { status: 'APPROVED' });
      await expect(
        coCurricular.decide(asClassTeacher(), 'OWN', created.id, { status: 'REJECTED', rejectionReason: 'changed my mind' })
      ).rejects.toMatchObject({ code: 'ALREADY_DECIDED' });
    });
  });

  it('does not let a student read another student’s activities', async () => {
    await inOak(async () => {
      const otherId = new mongoose.Types.ObjectId().toString();
      await expect(
        coCurricular.listForStudent(asStudent(), 'OWN', { studentId: otherId })
      ).rejects.toMatchObject({ statusCode: 403 });
    });
  });
});

describe('profile edit requests', () => {
  it('stores only the fields that actually changed, with their old values', async () => {
    await inOak(async () => {
      const req = await profileEdit.request(asStudent(), {
        // firstName is resubmitted unchanged and must not become a "change".
        changes: { firstName: 'Diya', address: '42 New Street' },
      });
      expect(req.changes).toHaveLength(1);
      expect(req.changes[0]).toMatchObject({
        field: 'address', oldValue: '101 Lake View', newValue: '42 New Street',
      });
    });
  });

  it('refuses a request that changes nothing', async () => {
    await inOak(async () => {
      await expect(
        profileEdit.request(asStudent(), { changes: { firstName: 'Diya' } })
      ).rejects.toMatchObject({ code: 'NO_CHANGES' });
    });
  });

  it('silently drops fields outside the allow-list', async () => {
    await inOak(async () => {
      // admissionNo is the school's own identifier for this person. A request
      // form must not be able to reach it even when asked to.
      const req = await profileEdit.request(asStudent(), {
        changes: { admissionNo: 'ADM-9999', address: '42 New Street' },
      });
      expect(req.changes.map((c) => c.field)).toEqual(['address']);

      await profileEdit.decide(asClassTeacher(), 'OWN', req.id, { status: 'APPROVED' });
      const after = await Student.findById(student._id);
      expect(after.admissionNo).toBe('ADM-1');
    });
  });

  it('leaves the record untouched until an approval, then writes the diff', async () => {
    await inOak(async () => {
      const req = await profileEdit.request(asStudent(), { changes: { address: '42 New Street' } });

      const duringReview = await Student.findById(student._id);
      expect(duringReview.address).toBe('101 Lake View');

      await profileEdit.decide(asClassTeacher(), 'OWN', req.id, { status: 'APPROVED' });

      const afterApproval = await Student.findById(student._id);
      expect(afterApproval.address).toBe('42 New Street');
    });
  });

  it('leaves the record unchanged on rejection and keeps the reason', async () => {
    await inOak(async () => {
      const req = await profileEdit.request(asStudent(), { changes: { address: '42 New Street' } });
      await profileEdit.decide(asClassTeacher(), 'OWN', req.id, {
        status: 'REJECTED', rejectionReason: 'Please attach proof of address.',
      });

      const after = await Student.findById(student._id);
      expect(after.address).toBe('101 Lake View');

      const [mine] = await profileEdit.listMine(asStudent(), 'OWN', {});
      expect(mine.status).toBe('REJECTED');
      expect(mine.rejectionReason).toBe('Please attach proof of address.');
    });
  });

  it('records who reviewed it and when', async () => {
    await inOak(async () => {
      const req = await profileEdit.request(asStudent(), { changes: { address: '42 New Street' } });
      const decided = await profileEdit.decide(asClassTeacher(), 'OWN', req.id, { status: 'APPROVED' });
      expect(decided.reviewedAt).toBeTruthy();
      expect(decided.requestedAt).toBeTruthy();
    });
  });

  it('allows only one pending request at a time', async () => {
    await inOak(async () => {
      await profileEdit.request(asStudent(), { changes: { address: '42 New Street' } });
      await expect(
        profileEdit.request(asStudent(), { changes: { address: '43 New Street' } })
      ).rejects.toMatchObject({ code: 'REQUEST_PENDING' });
    });
  });

  it('refuses a decision from a teacher who is not the class teacher', async () => {
    await inOak(async () => {
      const req = await profileEdit.request(asStudent(), { changes: { address: '42 New Street' } });
      await expect(
        profileEdit.decide(asSubjectTeacher(), 'OWN', req.id, { status: 'APPROVED' })
      ).rejects.toMatchObject({ code: 'NOT_CLASS_TEACHER' });

      const after = await Student.findById(student._id);
      expect(after.address).toBe('101 Lake View');
    });
  });

  it('refuses a date of birth in the future', async () => {
    await inOak(async () => {
      const nextYear = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      await expect(
        profileEdit.request(asStudent(), { changes: { dob: nextYear } })
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });
});
