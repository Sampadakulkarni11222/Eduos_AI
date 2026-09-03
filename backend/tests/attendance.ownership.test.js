import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Student, Enrollment } from '../src/models/student.model.js';
import { Grade, Section, Subject, SubjectOffering, AcademicYear, Term } from '../src/models/academics.model.js';
import { TimetableSlot } from '../src/models/timetableSlot.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as attendance from '../src/modules/attendance/attendance.service.js';

/**
 * ISSUE-05 — a teacher who merely teaches *some* subject in a section used to
 * be able to mark or overwrite attendance for the whole section, including
 * periods/subjects that belong to a different teacher. markAttendance() must
 * now check who actually owns the specific period (or the class-teacher slot
 * for whole-day marks) before writing.
 */

const OAK = 'oakridge';
const inOak = (fn) => runWithTenant(OAK, fn);

const permsOf = () => buildPermissionMap({ permissions: SYSTEM_ROLES.find((r) => r.key === 'TEACHER').grants });
const teacherActor = (profileId) => ({ roleKey: 'TEACHER', profileId: profileId.toString(), permissions: permsOf() });

const classTeacher = new mongoose.Types.ObjectId();
const mathTeacher = new mongoose.Types.ObjectId();
const scienceTeacher = new mongoose.Types.ObjectId();
let section;
let enrolment;

// 2026-03-10 is a Tuesday -> dayOfWeek 2 in the timetable's 1=Mon..7=Sun scheme.
const TUESDAY = '2026-03-10';
const DOW = 2;

beforeEach(async () => {
  await inOak(async () => {
    const grade = await Grade.create({ name: 'Class 6', level: 6 });
    section = await Section.create({ gradeId: grade._id, name: 'A', classTeacherId: classTeacher });

    const student = await Student.create({ admissionNo: 'IN-OWN-1', firstName: 'Kid', lastName: 'One' });
    enrolment = await Enrollment.create({
      studentId: student._id, sectionId: section._id,
      academicYearId: new mongoose.Types.ObjectId(), status: 'ACTIVE',
    });

    const year = await AcademicYear.create({ name: '2026-27', startsOn: new Date(), endsOn: new Date(), isCurrent: true });
    const term = await Term.create({ academicYearId: year._id, name: 'Term 1', startsOn: new Date(), endsOn: new Date() });
    const math = await Subject.create({ name: 'Math' });
    const science = await Subject.create({ name: 'Science' });
    const mathOffering = await SubjectOffering.create({ sectionId: section._id, subjectId: math._id, termId: term._id, teacherId: mathTeacher });
    const scienceOffering = await SubjectOffering.create({ sectionId: section._id, subjectId: science._id, termId: term._id, teacherId: scienceTeacher });

    await TimetableSlot.create({ sectionId: section._id, dayOfWeek: DOW, periodNo: 1, startTime: '09:00', endTime: '09:40', subjectOfferingId: mathOffering._id });
    await TimetableSlot.create({ sectionId: section._id, dayOfWeek: DOW, periodNo: 2, startTime: '09:40', endTime: '10:20', subjectOfferingId: scienceOffering._id });
  });
});

const markPeriod = (teacherId, periodNo) =>
  inOak(() => attendance.markAttendance(teacherActor(teacherId), 'OWN', {
    sectionId: section._id.toString(),
    date: TUESDAY,
    periodNo,
    entries: [{ enrollmentId: enrolment._id.toString(), status: 'PRESENT' }],
  }));

const markWholeDay = (teacherId) =>
  inOak(() => attendance.markAttendance(teacherActor(teacherId), 'OWN', {
    sectionId: section._id.toString(),
    date: TUESDAY,
    entries: [{ enrollmentId: enrolment._id.toString(), status: 'PRESENT' }],
  }));

it('the timetabled subject teacher can mark their own period', async () => {
  await markPeriod(mathTeacher, 1);
  const saved = await inOak(() => AttendanceRecord.findOne({ enrollmentId: enrolment._id, periodNo: 1 }).lean());
  expect(saved.status).toBe('PRESENT');
});

it('a different subject teacher of the same section cannot mark or overwrite that period', async () => {
  await markPeriod(mathTeacher, 1);
  await expect(markPeriod(scienceTeacher, 1)).rejects.toThrow(/not the teacher timetabled/i);

  const saved = await inOak(() => AttendanceRecord.findOne({ enrollmentId: enrolment._id, periodNo: 1 }).lean());
  expect(saved.status).toBe('PRESENT'); // untouched by scienceTeacher's attempt
});

it('a subject teacher cannot mark whole-day attendance — only the class teacher can', async () => {
  await expect(markWholeDay(mathTeacher)).rejects.toThrow(/class teacher/i);
  await markWholeDay(classTeacher); // does not throw
  const saved = await inOak(() => AttendanceRecord.findOne({ enrollmentId: enrolment._id, periodNo: null }).lean());
  expect(saved.status).toBe('PRESENT');
});
