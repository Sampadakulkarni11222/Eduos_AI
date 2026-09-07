import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Grade, Section } from '../src/models/academics.model.js';
import { Student, Enrollment } from '../src/models/student.model.js';
import { LeaveApplication } from '../src/models/leaveApplication.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as leave from '../src/modules/leave/leave.service.js';

/**
 * ISSUE-06 — a student's leave application went into resolveOwnActiveEnrollmentId's
 * collection and nowhere else: /leave/mine only ever read the applicant's own
 * record back, and there was no endpoint that queried leave requests by
 * section at all, so a teacher holding leave.read: OWN had a permission grant
 * with no route behind it. listForReview()/review() are the missing half of
 * the workflow the model (status/reviewedBy/remarks) was already built for.
 */

const OAK = 'oakridge';
const inOak = (fn) => runWithTenant(OAK, fn);

const permsOf = (roleKey) => buildPermissionMap({ permissions: SYSTEM_ROLES.find((r) => r.key === roleKey).grants });
const scopeOf = (roleKey, permKey) => permsOf(roleKey)[permKey];
const actorFor = (roleKey, profileId) => ({
  roleKey, profileId: profileId?.toString() ?? new mongoose.Types.ObjectId().toString(), permissions: permsOf(roleKey),
});

const myTeacher = new mongoose.Types.ObjectId();
let mySection;
let otherSection;
let myEnrolment;

beforeEach(async () => {
  await inOak(async () => {
    const grade = await Grade.create({ name: 'Class 9', level: 9 });
    mySection = await Section.create({ gradeId: grade._id, name: 'A', classTeacherId: myTeacher });
    otherSection = await Section.create({ gradeId: grade._id, name: 'B', classTeacherId: new mongoose.Types.ObjectId() });

    const student = await Student.create({ admissionNo: 'LV-1', firstName: 'Kid', lastName: 'One' });
    myEnrolment = await Enrollment.create({
      studentId: student._id, sectionId: mySection._id,
      academicYearId: new mongoose.Types.ObjectId(), status: 'ACTIVE',
    });

    await LeaveApplication.create({
      enrollmentId: myEnrolment._id,
      fromDate: new Date('2026-08-15'), toDate: new Date('2026-08-16'), reason: 'Family function',
    });
  });
});

it('the permission grants line up with a real route (leave.review exists on the roles that need it)', () => {
  expect(scopeOf('TEACHER', 'leave.review')).toBe('OWN');
  expect(scopeOf('PRINCIPAL', 'leave.review')).toBe('ALL');
});

it("a section's teacher sees the leave request in their review queue", async () => {
  const result = await inOak(() => leave.listForReview(actorFor('TEACHER', myTeacher), 'OWN', {}));
  expect(result).toHaveLength(1);
  expect(result[0].studentName).toBe('Kid One');
  expect(result[0].status).toBe('PENDING');
});

it('a teacher of a different section does not see it', async () => {
  const otherTeacher = new mongoose.Types.ObjectId(); // no class-teacher or subject-offering link to mySection
  const result = await inOak(() => leave.listForReview(actorFor('TEACHER', otherTeacher), 'OWN', {}));
  expect(result).toHaveLength(0);
});

it('the class teacher can approve the request', async () => {
  const app = await inOak(() => LeaveApplication.findOne({ enrollmentId: myEnrolment._id }));
  const reviewed = await inOak(() => leave.review(actorFor('TEACHER', myTeacher), 'OWN', {
    id: app._id.toString(), status: 'APPROVED', remarks: 'Approved, enjoy the function',
  }));
  expect(reviewed.status).toBe('APPROVED');
  expect(reviewed.reviewedByProfileId.toString()).toBe(myTeacher.toString());
});

it('a teacher outside the section cannot review it', async () => {
  const app = await inOak(() => LeaveApplication.findOne({ enrollmentId: myEnrolment._id }));
  const otherTeacher = new mongoose.Types.ObjectId();
  await expect(
    inOak(() => leave.review(actorFor('TEACHER', otherTeacher), 'OWN', { id: app._id.toString(), status: 'APPROVED' })),
  ).rejects.toThrow(/not in one of your classes/i);
});

it('an ALL-scope principal sees every request regardless of section', async () => {
  const result = await inOak(() => leave.listForReview(actorFor('PRINCIPAL'), 'ALL', {}));
  expect(result).toHaveLength(1);
});
