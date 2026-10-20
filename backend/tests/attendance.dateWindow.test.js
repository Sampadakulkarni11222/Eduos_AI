import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { Student, Enrollment } from '../src/models/student.model.js';
import { AcademicYear, Grade, Section } from '../src/models/academics.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as attendance from '../src/modules/attendance/attendance.service.js';

/**
 * Which days a register may be written for, and that a child's attendance is
 * one figure everywhere.
 *
 * Audit T-ATT-1: a teacher's POST /attendance/mark was accepted for a date a
 * year ahead and for one seven years back. Audit (student/parent): getSummary
 * counted per-period rows too, so one period's absence became an extra working
 * day — the cards said 80% while the calendar showed a single absence.
 */

const OAK = 'oakridge';
const inOak = (fn) => runWithTenant(OAK, fn);
const permsOf = (roleKey) => buildPermissionMap({ permissions: SYSTEM_ROLES.find((r) => r.key === roleKey).grants });
const actor = (roleKey, profileId = new mongoose.Types.ObjectId()) =>
  ({ roleKey, profileId: String(profileId), permissions: permsOf(roleKey) });

/** A calendar day `offset` days from today, as YYYY-MM-DD in local time. */
const dayFromToday = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const classTeacher = new mongoose.Types.ObjectId();
let section;
let otherSection;
let pupil;

const savedEnv = process.env.ATTENDANCE_BACKDATE_DAYS;

beforeEach(async () => {
  delete process.env.ATTENDANCE_BACKDATE_DAYS;
  await inOak(async () => {
    const grade = await Grade.create({ name: 'Class 5', level: 5 });
    section = await Section.create({ gradeId: grade._id, name: 'A', classTeacherId: classTeacher });
    otherSection = await Section.create({ gradeId: grade._id, name: 'B', classTeacherId: new mongoose.Types.ObjectId() });
    const st = await Student.create({ admissionNo: 'W-1', firstName: 'Diya', lastName: 'S' });
    pupil = await Enrollment.create({
      studentId: st._id, sectionId: section._id, academicYearId: new mongoose.Types.ObjectId(), status: 'ACTIVE', rollNo: 1,
    });
  });
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.ATTENDANCE_BACKDATE_DAYS;
  else process.env.ATTENDANCE_BACKDATE_DAYS = savedEnv;
});

const markAs = (who, date, extra = {}) => inOak(() => attendance.markAttendance(who, who.roleKey === 'TEACHER' ? 'OWN' : 'ALL', {
  sectionId: String(section._id), date, entries: [{ enrollmentId: String(pupil._id), status: 'PRESENT' }], ...extra,
}));

describe('attendance date window', () => {
  it('a teacher marks today and up to three days back', async () => {
    await markAs(actor('TEACHER', classTeacher), dayFromToday(0));
    await markAs(actor('TEACHER', classTeacher), dayFromToday(-3));
    expect(await inOak(() => AttendanceRecord.countDocuments())).toBe(2);
  });

  it('refuses a future date, for anyone', async () => {
    await expect(markAs(actor('TEACHER', classTeacher), dayFromToday(1)))
      .rejects.toMatchObject({ statusCode: 400, code: 'ATTENDANCE_FUTURE_DATE' });
    await expect(markAs(actor('ADMIN'), dayFromToday(30)))
      .rejects.toMatchObject({ statusCode: 400, code: 'ATTENDANCE_FUTURE_DATE' });
    expect(await inOak(() => AttendanceRecord.countDocuments())).toBe(0);
  });

  it('beyond the back-dating window a teacher needs attendance.regularize', async () => {
    expect(permsOf('TEACHER')['attendance.regularize']).toBeUndefined();
    await expect(markAs(actor('TEACHER', classTeacher), dayFromToday(-4)))
      .rejects.toMatchObject({ statusCode: 403, code: 'ATTENDANCE_REGULARIZE_REQUIRED' });

    // The same correction by a role that holds attendance.regularize goes through.
    expect(permsOf('ADMIN')['attendance.regularize']).toBe('ALL');
    await markAs(actor('ADMIN'), dayFromToday(-4));
    expect(await inOak(() => AttendanceRecord.countDocuments())).toBe(1);
  });

  it('the window is configurable with ATTENDANCE_BACKDATE_DAYS', async () => {
    process.env.ATTENDANCE_BACKDATE_DAYS = '7';
    await markAs(actor('TEACHER', classTeacher), dayFromToday(-7));
    process.env.ATTENDANCE_BACKDATE_DAYS = '0';
    await expect(markAs(actor('TEACHER', classTeacher), dayFromToday(-1)))
      .rejects.toMatchObject({ code: 'ATTENDANCE_REGULARIZE_REQUIRED' });
  });

  it('refuses a date before the current academic year began, even with regularize', async () => {
    await inOak(() => AcademicYear.create({
      name: 'Current', startsOn: new Date(`${dayFromToday(-10)}T00:00:00Z`), endsOn: new Date(`${dayFromToday(300)}T00:00:00Z`), isCurrent: true,
    }));
    await expect(markAs(actor('ADMIN'), dayFromToday(-11)))
      .rejects.toMatchObject({ statusCode: 400, code: 'ATTENDANCE_BEFORE_ACADEMIC_YEAR' });
    await markAs(actor('ADMIN'), dayFromToday(-10));
  });
});

describe('CSV import authorizes before it reads the roster', () => {
  it('a teacher of another section learns nothing about who is enrolled', async () => {
    const outsider = actor('TEACHER', classTeacher); // teaches section A, not B
    const err = await inOak(() => attendance.markAttendanceBulk(outsider, 'OWN', {
      sectionId: String(otherSection._id), date: dayFromToday(0), periodNo: null,
      rows: [{ rollno: '1', status: 'PRESENT' }, { admissionno: 'NOPE', status: 'PRESENT' }],
    })).catch((e) => e);
    expect(err.statusCode).toBe(403);
    // No per-row "does not match an active student" detail leaked back.
    expect(JSON.stringify(err.errors ?? [])).not.toMatch(/does not match/);
  });
});

describe('summary and calendar agree', () => {
  it('counts whole-day marks only, the same days the calendar shows', async () => {
    const month = dayFromToday(0).slice(0, 7);
    const days = [];
    // Up to three earlier days in this month plus today.
    for (let i = 0; i <= 3; i += 1) {
      const d = dayFromToday(-i);
      if (d.startsWith(month)) days.push(d);
    }
    await inOak(async () => {
      for (const [i, d] of days.entries()) {
        const date = new Date(`${d}T00:00:00Z`);
        await AttendanceRecord.create({ enrollmentId: pupil._id, date, periodNo: null, status: i === 0 ? 'ABSENT' : 'PRESENT' });
        // Per-period rows on the same day: lecture records, not extra days.
        await AttendanceRecord.create({ enrollmentId: pupil._id, date, periodNo: 1, status: 'ABSENT' });
        await AttendanceRecord.create({ enrollmentId: pupil._id, date, periodNo: 2, status: 'PRESENT' });
      }
    });

    const admin = actor('ADMIN');
    const summary = await inOak(() => attendance.getSummary(admin, 'ALL', { enrollmentId: String(pupil._id), month }));
    const calendar = await inOak(() => attendance.getCalendar(admin, 'ALL', { enrollmentId: String(pupil._id), month }));

    expect(summary.workingDays).toBe(calendar.days.length);
    expect(summary.ABSENT).toBe(calendar.days.filter((d) => d.status === 'ABSENT').length);
    expect(summary.PRESENT).toBe(calendar.days.filter((d) => d.status === 'PRESENT').length);

    // No month (how the report card asks) counts the same whole-day rows.
    const allTime = await inOak(() => attendance.getSummary(admin, 'ALL', { enrollmentId: String(pupil._id) }));
    expect(allTime.workingDays).toBe(days.length);
  });
});
