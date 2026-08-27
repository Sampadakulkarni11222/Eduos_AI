import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Student, Enrollment } from '../src/models/student.model.js';
import { Grade, Section, Subject, SubjectOffering, AcademicYear, Term } from '../src/models/academics.model.js';
import { SubjectRegistration } from '../src/models/subjectRegistration.model.js';
import { Notification } from '../src/models/notification.model.js';
import { decide } from '../src/modules/registrations/registration.service.js';

/**
 * Students are told when a teacher decides on their elective request.
 * Previously the decision existed only in the audit trail and on a page the
 * student had to remember to revisit.
 */

let reg, studentProfileId, offering;
const staff = { profileId: new mongoose.Types.ObjectId().toString(), roleKey: 'ADMIN', ip: '10.0.0.1' };

beforeEach(async () => {
  studentProfileId = new mongoose.Types.ObjectId();
  const grade = await Grade.create({ name: 'Class 7', level: 7 });
  const section = await Section.create({ gradeId: grade._id, name: 'A' });
  const year = await AcademicYear.create({
    name: '2026-27', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31'),
  });
  const term = await Term.create({
    academicYearId: year._id, name: 'Term 1',
    startsOn: new Date('2026-04-01'), endsOn: new Date('2026-09-30'),
  });
  const subject = await Subject.create({ name: 'French', code: 'FRE' });
  offering = await SubjectOffering.create({
    sectionId: section._id, subjectId: subject._id, termId: term._id, isElective: true, capacity: 5,
  });
  const student = await Student.create({
    admissionNo: 'ADM-N-1', firstName: 'Nina', status: 'ACTIVE', profileId: studentProfileId,
  });
  await Enrollment.create({
    studentId: student._id, sectionId: section._id, academicYearId: year._id, status: 'ACTIVE',
  });
  reg = await SubjectRegistration.create({
    studentId: student._id, subjectOfferingId: offering._id, academicYearId: year._id, status: 'PENDING',
  });
});

describe('registration decisions notify the student', () => {
  it('sends an approval notification naming the subject', async () => {
    await decide(staff, 'ALL', reg._id.toString(), { status: 'APPROVED' });

    const note = await Notification.findOne({ recipientProfileId: studentProfileId }).lean();
    expect(note).toBeTruthy();
    expect(note.type).toBe('REGISTRATION');
    expect(note.title).toMatch(/registered for French/i);
    expect(note.link).toBe('/student/subjects');
    expect(note.meta.status).toBe('APPROVED');
  });

  it('sends a rejection notification carrying the reason', async () => {
    await decide(staff, 'ALL', reg._id.toString(), { status: 'REJECTED', note: 'Clashes with Music' });

    const note = await Notification.findOne({ recipientProfileId: studentProfileId }).lean();
    expect(note.title).toMatch(/not approved/i);
    // The reason the teacher typed is what the student most needs to see.
    expect(note.body).toBe('Clashes with Music');
  });

  it('arrives unread', async () => {
    await decide(staff, 'ALL', reg._id.toString(), { status: 'APPROVED' });
    expect((await Notification.findOne({ recipientProfileId: studentProfileId }).lean()).readAt).toBeNull();
  });

  it('sends exactly one notification per decision', async () => {
    await decide(staff, 'ALL', reg._id.toString(), { status: 'APPROVED' });
    expect(await Notification.countDocuments({ recipientProfileId: studentProfileId })).toBe(1);
  });

  it('does not notify when the decision is refused', async () => {
    await decide(staff, 'ALL', reg._id.toString(), { status: 'APPROVED' });
    await Notification.deleteMany({});
    // Already decided — the second call must throw and send nothing.
    await expect(decide(staff, 'ALL', reg._id.toString(), { status: 'REJECTED' })).rejects.toBeTruthy();
    expect(await Notification.countDocuments({})).toBe(0);
  });

  it('still records the decision when the student has no login profile', async () => {
    await Student.updateOne({ _id: reg.studentId }, { $set: { profileId: null } });
    await expect(decide(staff, 'ALL', reg._id.toString(), { status: 'APPROVED' })).resolves.toBeTruthy();
    expect(await Notification.countDocuments({})).toBe(0);
  });
});
