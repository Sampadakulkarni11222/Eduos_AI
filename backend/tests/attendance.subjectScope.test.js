import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Student, Enrollment } from '../src/models/student.model.js';
import { Grade, Section, Subject, SubjectOffering } from '../src/models/academics.model.js';
import { TimetableSlot } from '../src/models/timetableSlot.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { Role } from '../src/models/role.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as attendance from '../src/modules/attendance/attendance.service.js';

/**
 * Subject-level attendance: who may mark which slot of the day.
 *
 * Marking used to be authorized on the section alone, which made two different
 * mistakes possible and indistinguishable: a subject teacher could mark the
 * *whole day* — the class teacher's register — and could mark a colleague's
 * period in the same class. The section is simply too coarse a unit.
 *
 * The rules under test: the day belongs to the class teacher, a period belongs
 * to whoever teaches the offering timetabled in it, and neither can be reached
 * by passing a different id.
 */

const OAK = 'oakridge';
const inOak = (fn) => runWithTenant(OAK, fn);

// 2026-03-10 is a Tuesday: dayOfWeek 2 in the timetable's 1=Mon..7=Sun.
const DATE = '2026-03-10';
const TUESDAY = 2;

const permsOf = (roleKey) =>
  buildPermissionMap({ permissions: SYSTEM_ROLES.find((r) => r.key === roleKey).grants });

const actorFor = (roleKey, profileId) => ({
  roleKey,
  profileId: String(profileId ?? new mongoose.Types.ObjectId()),
  permissions: permsOf(roleKey),
});

let section;
let enrolment;
let classTeacher;   // class teacher of the section, teaches Maths period 1
let subjectTeacher; // teaches Science period 2 only
let outsider;       // teaches nothing in this section

const makeTeacher = async (name) => {
  const account = await Account.create({
    phoneE164: `+9198200${Math.floor(10000 + Math.random() * 89999)}`,
  });
  return Profile.create({
    accountId: account._id,
    roleId: (await Role.findOne({ key: 'TEACHER' }))._id,
    displayName: name,
    tenantId: OAK,
    tenantName: OAK,
  });
};

/** Marks one student, returning the service's own answer or throwing. */
const mark = (actor, scope, periodNo) => inOak(() => attendance.markAttendance(actor, scope, {
  sectionId: section._id.toString(),
  date: DATE,
  periodNo,
  entries: [{ enrollmentId: enrolment._id.toString(), status: 'PRESENT' }],
}));

beforeEach(async () => {
  for (const r of SYSTEM_ROLES) {
    await Role.create({ key: r.key, name: r.name, isSystem: true, permissions: r.grants });
  }

  await inOak(async () => {
    classTeacher = await makeTeacher('Asha Class-Teacher');
    subjectTeacher = await makeTeacher('Bala Science');
    outsider = await makeTeacher('Chandra Elsewhere');

    const grade = await Grade.create({ name: 'Class 6', level: 6 });
    section = await Section.create({ gradeId: grade._id, name: 'A', classTeacherId: classTeacher._id });

    const maths = await Subject.create({ name: 'Mathematics', code: 'MATH' });
    const science = await Subject.create({ name: 'Science', code: 'SCI' });
    const term = new mongoose.Types.ObjectId();

    const mathsOffering = await SubjectOffering.create({
      sectionId: section._id, subjectId: maths._id, termId: term, teacherId: classTeacher._id,
    });
    const scienceOffering = await SubjectOffering.create({
      sectionId: section._id, subjectId: science._id, termId: term, teacherId: subjectTeacher._id,
    });

    await TimetableSlot.create({
      sectionId: section._id, dayOfWeek: TUESDAY, periodNo: 1,
      startTime: '09:00', endTime: '09:45', subjectOfferingId: mathsOffering._id,
    });
    await TimetableSlot.create({
      sectionId: section._id, dayOfWeek: TUESDAY, periodNo: 2,
      startTime: '09:45', endTime: '10:30', subjectOfferingId: scienceOffering._id,
    });

    const student = await Student.create({ admissionNo: 'OAK-1', firstName: 'Ravi', lastName: 'K' });
    enrolment = await Enrollment.create({
      studentId: student._id, sectionId: section._id,
      academicYearId: new mongoose.Types.ObjectId(), status: 'ACTIVE',
    });
  });
});

describe('a subject teacher marks their own period', () => {
  it('saves the register for the period they teach', async () => {
    await mark(actorFor('TEACHER', subjectTeacher._id), 'OWN', 2);

    const saved = await inOak(() =>
      AttendanceRecord.findOne({ enrollmentId: enrolment._id, periodNo: 2 }).lean());
    expect(saved.status).toBe('PRESENT');
  });

  it('is refused a colleague period in the same class', async () => {
    await expect(mark(actorFor('TEACHER', subjectTeacher._id), 'OWN', 1))
      .rejects.toMatchObject({ statusCode: 403, code: 'NOT_SUBJECT_TEACHER' });

    expect(await inOak(() => AttendanceRecord.countDocuments())).toBe(0);
  });

  it('is refused the whole-day register, which is the class teacher\'s', async () => {
    await expect(mark(actorFor('TEACHER', subjectTeacher._id), 'OWN', null))
      .rejects.toMatchObject({ statusCode: 403, code: 'NOT_CLASS_TEACHER' });

    expect(await inOak(() => AttendanceRecord.countDocuments())).toBe(0);
  });

  it('is refused a period that is not timetabled that day', async () => {
    await expect(mark(actorFor('TEACHER', subjectTeacher._id), 'OWN', 7))
      .rejects.toMatchObject({ code: 'PERIOD_NOT_SCHEDULED' });
  });
});

describe('the class teacher keeps the day', () => {
  it('marks whole-day attendance', async () => {
    await mark(actorFor('TEACHER', classTeacher._id), 'OWN', null);

    const saved = await inOak(() =>
      AttendanceRecord.findOne({ enrollmentId: enrolment._id, periodNo: null }).lean());
    expect(saved.status).toBe('PRESENT');
  });

  it('may also cover a period taught by someone else in their own class', async () => {
    // They answer for the day's roll either way, and covering an absent
    // colleague is ordinary school life.
    await mark(actorFor('TEACHER', classTeacher._id), 'OWN', 2);
    expect(await inOak(() => AttendanceRecord.countDocuments({ periodNo: 2 }))).toBe(1);
  });
});

describe('a teacher with no offering in the section reaches nothing', () => {
  it('is refused the day and every period', async () => {
    const stranger = actorFor('TEACHER', outsider._id);
    await expect(mark(stranger, 'OWN', null)).rejects.toMatchObject({ statusCode: 403 });
    await expect(mark(stranger, 'OWN', 1)).rejects.toMatchObject({ statusCode: 403 });
    await expect(mark(stranger, 'OWN', 2)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('a school-wide grant is unaffected', () => {
  it('an admin marks any period and the whole day', async () => {
    const admin = actorFor('ADMIN');
    await mark(admin, 'ALL', null);
    await mark(admin, 'ALL', 1);
    expect(await inOak(() => AttendanceRecord.countDocuments())).toBe(2);
  });
});

describe('the roster tells the teacher what they may mark', () => {
  const roster = (actor, scope, periodNo = null) =>
    inOak(() => attendance.getRoster(actor, scope, section._id.toString(), DATE, periodNo));

  it('names the class, the class teacher and each period\'s subject teacher', async () => {
    const res = await roster(actorFor('TEACHER', subjectTeacher._id), 'OWN');

    expect(res.section.grade).toBe('Class 6');
    expect(res.section.sectionName).toBe('A');
    expect(res.section.classTeacher).toBe('Asha Class-Teacher');
    expect(res.periods.map((p) => [p.periodNo, p.subject, p.subjectTeacher])).toEqual([
      [1, 'Mathematics', 'Asha Class-Teacher'],
      [2, 'Science', 'Bala Science'],
    ]);
  });

  it('flags only the periods this teacher may mark', async () => {
    const res = await roster(actorFor('TEACHER', subjectTeacher._id), 'OWN');
    expect(res.periods.map((p) => p.canMark)).toEqual([false, true]);
    expect(res.canMarkWholeDay).toBe(false);
  });

  it('gives the class teacher the day and every period', async () => {
    const res = await roster(actorFor('TEACHER', classTeacher._id), 'OWN');
    expect(res.periods.every((p) => p.canMark)).toBe(true);
    expect(res.canMarkWholeDay).toBe(true);
  });

  it('names the subject teacher of the period being viewed', async () => {
    const res = await roster(actorFor('TEACHER', subjectTeacher._id), 'OWN', 2);
    expect(res.subject).toBe('Science');
    expect(res.subjectTeacher).toBe('Bala Science');
    expect(res.canMark).toBe(true);
  });
});
