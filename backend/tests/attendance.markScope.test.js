import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Student, Enrollment } from '../src/models/student.model.js';
import { Grade, Section } from '../src/models/academics.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as attendance from '../src/modules/attendance/attendance.service.js';

/**
 * Who may mark a register.
 *
 * markAttendance() called assertSectionAccess() with the scope pinned to 'OWN'.
 * That helper returns early for a school-wide grant and refuses any non-teacher
 * at OWN — so pinning it meant an Admin holding attendance.mark at ALL was
 * refused every section, through the UI, the CSV import and the agent alike,
 * while a teacher was checked correctly. The caller's real scope is passed now.
 */

const OAK = 'oakridge';
const inOak = (fn) => runWithTenant(OAK, fn);

const grantsFor = (roleKey) => SYSTEM_ROLES.find((r) => r.key === roleKey).grants;
const permsOf = (roleKey) => buildPermissionMap({ permissions: grantsFor(roleKey) });
const scopeOf = (roleKey) => permsOf(roleKey)['attendance.mark'];
const actorFor = (roleKey, profileId) => ({
  roleKey,
  profileId: profileId?.toString() ?? new mongoose.Types.ObjectId().toString(),
  permissions: permsOf(roleKey),
});

const teacherId = new mongoose.Types.ObjectId();
let mySection;
let otherSection;
let myEnrolment;
let otherEnrolment;

/** A student enrolled in `section`. */
const enrol = async (section, admissionNo) => {
  const student = await Student.create({ admissionNo, firstName: admissionNo, lastName: 'P' });
  return Enrollment.create({
    studentId: student._id, sectionId: section._id,
    academicYearId: new mongoose.Types.ObjectId(), status: 'ACTIVE',
  });
};

const mark = (roleKey, profileId, section, enrolment) =>
  inOak(() => attendance.markAttendance(actorFor(roleKey, profileId), scopeOf(roleKey), {
    sectionId: section._id.toString(),
    date: '2026-03-10',
    entries: [{ enrollmentId: enrolment._id.toString(), status: 'PRESENT' }],
  }));

beforeEach(async () => {
  await inOak(async () => {
    const grade = await Grade.create({ name: 'Class 6', level: 6 });
    mySection = await Section.create({ gradeId: grade._id, name: 'A', classTeacherId: teacherId });
    otherSection = await Section.create({
      gradeId: grade._id, name: 'B', classTeacherId: new mongoose.Types.ObjectId(),
    });
    myEnrolment = await enrol(mySection, 'IN-6A');
    otherEnrolment = await enrol(otherSection, 'IN-6B');
  });
});

describe('a school-wide grant can mark any section', () => {
  it.each(['ADMIN', 'SUPER_ADMIN'])('%s marks a register it does not teach', async (roleKey) => {
    expect(scopeOf(roleKey)).toBe('ALL');
    await mark(roleKey, undefined, otherSection, otherEnrolment);

    const saved = await inOak(() =>
      AttendanceRecord.findOne({ enrollmentId: otherEnrolment._id }).lean());
    expect(saved.status).toBe('PRESENT');
  });
});

describe('a teacher is still confined to their own sections', () => {
  it('marks their own section', async () => {
    expect(scopeOf('TEACHER')).toBe('OWN');
    await mark('TEACHER', teacherId, mySection, myEnrolment);

    const saved = await inOak(() =>
      AttendanceRecord.findOne({ enrollmentId: myEnrolment._id }).lean());
    expect(saved.status).toBe('PRESENT');
  });

  it('is refused a section they do not teach', async () => {
    await expect(mark('TEACHER', teacherId, otherSection, otherEnrolment))
      .rejects.toThrow(/do not teach this section/i);

    expect(await inOak(() => AttendanceRecord.countDocuments())).toBe(0);
  });

  it('cannot smuggle another section enrolment into its own register', async () => {
    await expect(
      inOak(() => attendance.markAttendance(actorFor('TEACHER', teacherId), 'OWN', {
        sectionId: mySection._id.toString(),
        date: '2026-03-10',
        entries: [{ enrollmentId: otherEnrolment._id.toString(), status: 'PRESENT' }],
      })),
    ).rejects.toThrow(/do not belong to this section/i);
  });
});

describe('roles with no marking grant are refused', () => {
  it.each(['STUDENT', 'PARENT', 'LIBRARIAN'])('%s holds no attendance.mark', (roleKey) => {
    expect(scopeOf(roleKey)).toBeUndefined();
  });

  it('and are refused by the section gate even if they reach the service', async () => {
    await expect(mark('LIBRARIAN', undefined, mySection, myEnrolment))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('school isolation still holds', () => {
  it('another school cannot mark this school register', async () => {
    await expect(
      runWithTenant('nvmp', () => attendance.markAttendance(actorFor('ADMIN'), 'ALL', {
        sectionId: mySection._id.toString(),
        date: '2026-03-10',
        entries: [{ enrollmentId: myEnrolment._id.toString(), status: 'PRESENT' }],
      })),
    ).rejects.toThrow();

    expect(await inOak(() => AttendanceRecord.countDocuments())).toBe(0);
  });
});
