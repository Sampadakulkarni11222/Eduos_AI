import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Grade, Section, Subject, SubjectOffering, AcademicYear, Term } from '../src/models/academics.model.js';
import { Student, Enrollment } from '../src/models/student.model.js';
import { TimetableSlot } from '../src/models/timetableSlot.model.js';
// Imported for its side effect: populate() resolves teacherId -> Profile, which
// throws MissingSchemaError unless the model has been registered.
import '../src/models/profile.model.js';
import { getTimetable, upsertSlot } from '../src/modules/timetable/timetable.service.js';

/**
 * Timetable reads and slot upserts.
 * The scoping rules here are the interesting part: a teacher must see only the
 * periods they personally teach, and a student only their own section.
 */

let sectionA, sectionB, offeringMath, offeringSci, teacherA, teacherB, year;

beforeEach(async () => {
  teacherA = new mongoose.Types.ObjectId();
  teacherB = new mongoose.Types.ObjectId();

  const grade = await Grade.create({ name: 'Class 6', level: 6 });
  sectionA = await Section.create({ gradeId: grade._id, name: 'A', classTeacherId: teacherA });
  sectionB = await Section.create({ gradeId: grade._id, name: 'B', classTeacherId: teacherB });

  year = await AcademicYear.create({
    name: '2026-27', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31'), isCurrent: true,
  });
  const term = await Term.create({
    academicYearId: year._id, name: 'Term 1', startsOn: new Date('2026-04-01'), endsOn: new Date('2026-09-30'),
  });

  const math = await Subject.create({ name: 'Mathematics', code: 'MATH' });
  const sci = await Subject.create({ name: 'Science', code: 'SCI' });

  // Both offerings are in section A, but taught by different teachers.
  offeringMath = await SubjectOffering.create({
    sectionId: sectionA._id, subjectId: math._id, termId: term._id, teacherId: teacherA,
  });
  offeringSci = await SubjectOffering.create({
    sectionId: sectionA._id, subjectId: sci._id, termId: term._id, teacherId: teacherB,
  });

  await TimetableSlot.create([
    { sectionId: sectionA._id, dayOfWeek: 1, periodNo: 1, startTime: '09:00', endTime: '09:45', subjectOfferingId: offeringMath._id },
    { sectionId: sectionA._id, dayOfWeek: 1, periodNo: 2, startTime: '09:45', endTime: '10:30', subjectOfferingId: offeringSci._id },
    { sectionId: sectionA._id, dayOfWeek: 1, periodNo: 3, startTime: '10:30', endTime: '10:45', subjectOfferingId: null }, // break
  ]);
});

const staff = { roleKey: 'ADMIN', profileId: new mongoose.Types.ObjectId().toString() };

describe('getTimetable — staff at ALL scope', () => {
  it('returns every slot for a section, breaks included', async () => {
    const slots = await getTimetable(staff, 'ALL', sectionA._id.toString());
    expect(slots).toHaveLength(3);
  });

  it('returns slots ordered by day then period', async () => {
    await TimetableSlot.create({
      sectionId: sectionA._id, dayOfWeek: 2, periodNo: 1, startTime: '09:00', endTime: '09:45', subjectOfferingId: offeringMath._id,
    });
    const slots = await getTimetable(staff, 'ALL', sectionA._id.toString());
    const order = slots.map((s) => `${s.dayOfWeek}.${s.periodNo}`);
    expect(order).toEqual([...order].sort());
  });

  it('populates the subject and teacher for rendering', async () => {
    const slots = await getTimetable(staff, 'ALL', sectionA._id.toString());
    const taught = slots.find((s) => s.subjectOfferingId);
    expect(taught.subjectOfferingId.subjectId.name).toBeTruthy();
  });
});

describe('getTimetable — TEACHER at OWN scope', () => {
  const asTeacher = (profileId) => ({ roleKey: 'TEACHER', profileId: profileId.toString() });

  it('shows only the periods that teacher personally teaches', async () => {
    // teacherA is class teacher of section A but only teaches Maths there —
    // they must not see teacherB's Science period.
    const slots = await getTimetable(asTeacher(teacherA), 'OWN', sectionA._id.toString());
    expect(slots).toHaveLength(1);
    expect(slots[0].subjectOfferingId._id.toString()).toBe(offeringMath._id.toString());
  });

  it('refuses a section the teacher has nothing to do with', async () => {
    await expect(getTimetable(asTeacher(teacherA), 'OWN', sectionB._id.toString())).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('without a sectionId, returns only their own sections', async () => {
    const slots = await getTimetable(asTeacher(teacherB), 'OWN', undefined);
    // teacherB teaches Science in section A.
    expect(slots.every((s) => s.sectionId.toString() === sectionA._id.toString())).toBe(true);
    expect(slots).toHaveLength(1);
  });
});

describe('getTimetable — STUDENT at OWN scope', () => {
  let studentActor;

  beforeEach(async () => {
    const profileId = new mongoose.Types.ObjectId();
    const student = await Student.create({ admissionNo: 'ADM-TT-1', firstName: 'Tara', status: 'ACTIVE', profileId });
    await Enrollment.create({
      studentId: student._id, sectionId: sectionA._id, academicYearId: year._id, status: 'ACTIVE',
    });
    studentActor = { roleKey: 'STUDENT', profileId: profileId.toString() };
  });

  it('sees the full timetable for their own section', async () => {
    const slots = await getTimetable(studentActor, 'OWN', sectionA._id.toString());
    // Unlike a teacher, a student sees every period including other teachers'.
    expect(slots).toHaveLength(3);
  });

  it('is refused another section', async () => {
    await expect(getTimetable(studentActor, 'OWN', sectionB._id.toString())).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('without a sectionId, is scoped to their enrolled sections', async () => {
    const slots = await getTimetable(studentActor, 'OWN', undefined);
    expect(slots).toHaveLength(3);
    expect(slots.every((s) => s.sectionId.toString() === sectionA._id.toString())).toBe(true);
  });
});

describe('upsertSlot', () => {
  it('creates a slot that did not exist', async () => {
    const slot = await upsertSlot({
      sectionId: sectionB._id, dayOfWeek: 3, periodNo: 1, startTime: '09:00', endTime: '09:45', subjectOfferingId: null,
    });
    expect(slot.startTime).toBe('09:00');
    expect(await TimetableSlot.countDocuments({ sectionId: sectionB._id })).toBe(1);
  });

  it('overwrites the existing slot for the same section, day and period', async () => {
    await upsertSlot({
      sectionId: sectionA._id, dayOfWeek: 1, periodNo: 1, startTime: '08:00', endTime: '08:45', subjectOfferingId: offeringSci._id,
    });
    // Upsert, not insert: the section/day/period triple is uniquely indexed, so
    // a second slot there would be a duplicate-key error.
    expect(await TimetableSlot.countDocuments({ sectionId: sectionA._id, dayOfWeek: 1, periodNo: 1 })).toBe(1);
    const slot = await TimetableSlot.findOne({ sectionId: sectionA._id, dayOfWeek: 1, periodNo: 1 });
    expect(slot.startTime).toBe('08:00');
  });

  it('stores a null offering as a break', async () => {
    const slot = await upsertSlot({
      sectionId: sectionB._id, dayOfWeek: 4, periodNo: 5, startTime: '12:00', endTime: '12:30', subjectOfferingId: null,
    });
    expect(slot.subjectOfferingId).toBeNull();
  });

  it('enforces the day-of-week range', async () => {
    await expect(
      upsertSlot({ sectionId: sectionB._id, dayOfWeek: 8, periodNo: 1, startTime: '09:00', endTime: '09:45' })
    ).rejects.toBeTruthy();
  });
});

describe('timetable uniqueness', () => {
  it('refuses two slots in the same section, day and period', async () => {
    await expect(
      TimetableSlot.create({
        sectionId: sectionA._id, dayOfWeek: 1, periodNo: 1, startTime: '11:00', endTime: '11:45', subjectOfferingId: offeringSci._id,
      })
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('allows the same period number in different sections', async () => {
    await expect(
      TimetableSlot.create({
        sectionId: sectionB._id, dayOfWeek: 1, periodNo: 1, startTime: '09:00', endTime: '09:45', subjectOfferingId: null,
      })
    ).resolves.toBeTruthy();
  });
});
