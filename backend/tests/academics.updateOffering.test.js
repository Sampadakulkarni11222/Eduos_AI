import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Grade, Section, Subject, SubjectOffering, AcademicYear, Term } from '../src/models/academics.model.js';
import { SubjectRegistration } from '../src/models/subjectRegistration.model.js';
import { updateOffering } from '../src/modules/academics/academics.service.js';

/**
 * Lets staff mark an offering elective and set its seat cap from the UI —
 * previously reachable only at creation time or by re-seeding.
 */

let offering;

beforeEach(async () => {
  const grade = await Grade.create({ name: 'Class 8', level: 8 });
  const section = await Section.create({ gradeId: grade._id, name: 'A' });
  const year = await AcademicYear.create({
    name: '2026-27', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31'),
  });
  const term = await Term.create({
    academicYearId: year._id, name: 'Term 1',
    startsOn: new Date('2026-04-01'), endsOn: new Date('2026-09-30'),
  });
  const subject = await Subject.create({ name: 'Music', code: 'MUS' });
  offering = await SubjectOffering.create({
    sectionId: section._id, subjectId: subject._id, termId: term._id,
  });
});

const takeSeats = (n, status = 'APPROVED') =>
  SubjectRegistration.insertMany(
    Array.from({ length: n }, () => ({
      studentId: new mongoose.Types.ObjectId(),
      subjectOfferingId: offering._id,
      academicYearId: new mongoose.Types.ObjectId(),
      status,
    }))
  );

describe('updateOffering — elective flag', () => {
  it('marks an offering elective', async () => {
    const updated = await updateOffering(offering._id.toString(), { isElective: true });
    expect(updated.isElective).toBe(true);
  });

  it('unmarks it again', async () => {
    await updateOffering(offering._id.toString(), { isElective: true });
    const updated = await updateOffering(offering._id.toString(), { isElective: false });
    expect(updated.isElective).toBe(false);
  });

  it('404s for an unknown offering', async () => {
    await expect(updateOffering(new mongoose.Types.ObjectId().toString(), { isElective: true }))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('updateOffering — capacity', () => {
  it('sets a seat cap', async () => {
    const updated = await updateOffering(offering._id.toString(), { capacity: 20 });
    expect(updated.capacity).toBe(20);
  });

  it('treats null and empty string as unlimited', async () => {
    await updateOffering(offering._id.toString(), { capacity: 20 });
    expect((await updateOffering(offering._id.toString(), { capacity: null })).capacity).toBeNull();

    await updateOffering(offering._id.toString(), { capacity: 20 });
    expect((await updateOffering(offering._id.toString(), { capacity: '' })).capacity).toBeNull();
  });

  it.each([0, -5, 2.5, 'abc'])('rejects an invalid capacity: %s', async (capacity) => {
    await expect(updateOffering(offering._id.toString(), { capacity }))
      .rejects.toMatchObject({ code: 'INVALID_CAPACITY' });
  });

  it('refuses a cap below the seats already taken', async () => {
    await takeSeats(6);
    await expect(updateOffering(offering._id.toString(), { capacity: 3 }))
      .rejects.toMatchObject({ code: 'CAPACITY_BELOW_TAKEN', statusCode: 409 });
    // The offering is left untouched rather than half-applied.
    expect((await SubjectOffering.findById(offering._id)).capacity).toBeNull();
  });

  it('allows a cap exactly equal to the seats taken', async () => {
    await takeSeats(4);
    expect((await updateOffering(offering._id.toString(), { capacity: 4 })).capacity).toBe(4);
  });

  it('counts PENDING requests as holding a seat', async () => {
    // Otherwise lowering the cap could strand students already in the queue.
    await takeSeats(3, 'PENDING');
    await expect(updateOffering(offering._id.toString(), { capacity: 2 }))
      .rejects.toMatchObject({ code: 'CAPACITY_BELOW_TAKEN' });
  });

  it('ignores withdrawn and rejected requests when counting seats', async () => {
    await takeSeats(5, 'WITHDRAWN');
    await expect(updateOffering(offering._id.toString(), { capacity: 1 })).resolves.toBeTruthy();
  });
});

describe('updateOffering — identity fields are not editable', () => {
  it('ignores attempts to move the offering to another section or subject', async () => {
    const otherSection = new mongoose.Types.ObjectId();
    const updated = await updateOffering(offering._id.toString(), {
      sectionId: otherSection, subjectId: otherSection, termId: otherSection, isElective: true,
    });
    // Changing these would silently relocate every timetable slot and
    // registration attached to the offering.
    expect(updated.sectionId.toString()).not.toBe(otherSection.toString());
    expect(updated.isElective).toBe(true);
  });
});
