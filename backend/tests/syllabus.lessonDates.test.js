import { it, expect, beforeEach } from 'vitest';
import { seedSchool, inSchool, OAK } from './support/mcpSchool.js';
import { AcademicYear, Subject, SubjectOffering, Term } from '../src/models/academics.model.js';
import * as syllabus from '../src/modules/syllabus/syllabus.service.js';

/**
 * Audit T-SYL-4: recordProgress blocked future dates only, so a lesson dated
 * 2019-10-14 was accepted against this year's module. A lesson may be
 * recorded from a week before the module's planned start, and never before
 * the academic year began.
 */

let school;
let maths;
const inOak = (fn) => inSchool(OAK, fn);
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

beforeEach(async () => {
  school = await seedSchool();
  await inOak(async () => {
    await AcademicYear.updateOne({ _id: school.year._id }, { $set: { startsOn: new Date(`${day(-60)}T00:00:00Z`) } });
    const term = await Term.create({ academicYearId: school.year._id, name: 'Term 1', startsOn: new Date(`${day(-60)}T00:00:00Z`), endsOn: new Date(`${day(200)}T00:00:00Z`) });
    const subject = await Subject.create({ name: 'Mathematics' });
    maths = await SubjectOffering.create({ sectionId: school.sectionA._id, subjectId: subject._id, termId: term._id, teacherId: school.people.TEACHER.profile._id });
  });
});

const plan = (plannedStart, plannedEnd) => inOak(() => syllabus.createModule(school.people.TEACHER.actor, {
  subjectOfferingId: String(maths._id), title: `Unit ${plannedStart}`, plannedStart, plannedEnd, topics: ['A', 'B'],
}));
const record = (m, taughtOn) => inOak(() => syllabus.recordProgress(school.people.TEACHER.actor, m.id, { note: 'Taught', taughtOn }));

it('refuses a lesson years in the past', async () => {
  const m = await plan(day(-10), day(10));
  await expect(record(m, '2019-10-14')).rejects.toMatchObject({ statusCode: 400, code: 'LESSON_TOO_EARLY' });
});

it('allows up to a week before the planned start, not earlier', async () => {
  const m = await plan(day(-10), day(10));
  await expect(record(m, day(-18))).rejects.toMatchObject({ code: 'LESSON_TOO_EARLY' });
  const ok = await record(m, day(-17));
  expect(ok.status).toBe('IN_PROGRESS');
});

it('never before the academic year began, even inside the early-start week', async () => {
  const m = await plan(day(-58), day(-30)); // a week early would be day -65, before the year (day -60)
  await expect(record(m, day(-62))).rejects.toMatchObject({ code: 'LESSON_TOO_EARLY' });
  await record(m, day(-60));
});
