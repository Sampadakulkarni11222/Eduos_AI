import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Grade, Section, Subject, SubjectOffering, AcademicYear, Term } from '../src/models/academics.model.js';
import { Student, Enrollment } from '../src/models/student.model.js';
import { TimetableSlot } from '../src/models/timetableSlot.model.js';
import { SubjectRegistration } from '../src/models/subjectRegistration.model.js';
import '../src/models/profile.model.js';
import { getTimetable } from '../src/modules/timetable/timetable.service.js';

/**
 * An approved elective belongs on the student's timetable; the section's other
 * electives, which they did not take, do not. Before this, either every student
 * in the section saw every elective or none did.
 */

let section, year, student, studentActor, coreOffering, frenchOffering, musicOffering;

const slotFor = (offeringId, periodNo) => ({
  sectionId: section._id, dayOfWeek: 1, periodNo,
  startTime: `0${8 + periodNo}:00`, endTime: `0${8 + periodNo}:45`,
  subjectOfferingId: offeringId,
});

beforeEach(async () => {
  const grade = await Grade.create({ name: 'Class 9', level: 9 });
  section = await Section.create({ gradeId: grade._id, name: 'A' });
  year = await AcademicYear.create({
    name: '2026-27', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31'),
  });
  const term = await Term.create({
    academicYearId: year._id, name: 'Term 1',
    startsOn: new Date('2026-04-01'), endsOn: new Date('2026-09-30'),
  });

  const [maths, french, music] = await Promise.all([
    Subject.create({ name: 'Mathematics', code: 'MATH' }),
    Subject.create({ name: 'French', code: 'FRE' }),
    Subject.create({ name: 'Music', code: 'MUS' }),
  ]);

  coreOffering = await SubjectOffering.create({ sectionId: section._id, subjectId: maths._id, termId: term._id });
  frenchOffering = await SubjectOffering.create({
    sectionId: section._id, subjectId: french._id, termId: term._id, isElective: true, capacity: 10,
  });
  musicOffering = await SubjectOffering.create({
    sectionId: section._id, subjectId: music._id, termId: term._id, isElective: true, capacity: 10,
  });

  await TimetableSlot.create([slotFor(coreOffering._id, 1), slotFor(frenchOffering._id, 2), slotFor(musicOffering._id, 3)]);

  const profileId = new mongoose.Types.ObjectId();
  student = await Student.create({ admissionNo: 'ADM-E-1', firstName: 'Eli', status: 'ACTIVE', profileId });
  await Enrollment.create({ studentId: student._id, sectionId: section._id, academicYearId: year._id, status: 'ACTIVE' });
  studentActor = { roleKey: 'STUDENT', profileId: profileId.toString() };
});

const register = (offeringId, status) =>
  SubjectRegistration.create({
    studentId: student._id, subjectOfferingId: offeringId, academicYearId: year._id, status,
  });

const subjectsOn = async () => {
  const slots = await getTimetable(studentActor, 'OWN', section._id.toString());
  return slots.map((s) => s.subjectOfferingId?.subjectId?.name ?? 'Break').sort();
};

describe('student timetable — elective visibility', () => {
  it('hides every elective the student has not registered for', async () => {
    expect(await subjectsOn()).toEqual(['Mathematics']);
  });

  it('shows an elective once the registration is approved', async () => {
    await register(frenchOffering._id, 'APPROVED');
    expect(await subjectsOn()).toEqual(['French', 'Mathematics']);
  });

  it('still hides an elective while the request is only pending', async () => {
    // Pending holds a seat but does not put the class on their schedule.
    await register(frenchOffering._id, 'PENDING');
    expect(await subjectsOn()).toEqual(['Mathematics']);
  });

  it.each(['REJECTED', 'WITHDRAWN'])('hides an elective after %s', async (status) => {
    await register(frenchOffering._id, status);
    expect(await subjectsOn()).toEqual(['Mathematics']);
  });

  it('shows only the approved elective, not the other one', async () => {
    await register(musicOffering._id, 'APPROVED');
    expect(await subjectsOn()).toEqual(['Mathematics', 'Music']);
  });

  it('shows both when both are approved', async () => {
    await register(frenchOffering._id, 'APPROVED');
    await register(musicOffering._id, 'APPROVED');
    expect(await subjectsOn()).toEqual(['French', 'Mathematics', 'Music']);
  });

  it('never hides core subjects', async () => {
    await register(frenchOffering._id, 'REJECTED');
    expect(await subjectsOn()).toContain('Mathematics');
  });

  it('applies the same filter when no sectionId is given', async () => {
    await register(frenchOffering._id, 'APPROVED');
    const slots = await getTimetable(studentActor, 'OWN', undefined);
    const names = slots.map((s) => s.subjectOfferingId?.subjectId?.name).sort();
    expect(names).toEqual(['French', 'Mathematics']);
  });
});

describe('staff timetable — unaffected', () => {
  it('staff at ALL scope still see every elective period', async () => {
    const staff = { roleKey: 'ADMIN', profileId: new mongoose.Types.ObjectId().toString() };
    const slots = await getTimetable(staff, 'ALL', section._id.toString());
    // Whoever builds the timetable must see the whole grid.
    expect(slots).toHaveLength(3);
  });
});
