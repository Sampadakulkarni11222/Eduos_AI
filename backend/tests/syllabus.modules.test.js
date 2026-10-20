import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, seedPerson, inSchool, OAK, RIVER } from './support/mcpSchool.js';
import { Subject, SubjectOffering, Term } from '../src/models/academics.model.js';
import { Exam, ExamSubject, Mark } from '../src/models/exam.model.js';
import { Enrollment } from '../src/models/student.model.js';
import * as syllabus from '../src/modules/syllabus/syllabus.service.js';

/**
 * Module tracking: a teacher plans and records only the subjects they teach,
 * progress is what was recorded and nothing else, "behind" is measured against
 * the planned window, and the principal's tracker adds it up per teacher.
 */

let school;
let maths;
let science;
let other;
const inOak = (fn) => inSchool(OAK, fn);
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

beforeEach(async () => {
  school = await seedSchool();
  other = await seedPerson({ roleKey: 'TEACHER', roleId: school.roleIds.TEACHER, displayName: 'Other teacher' });
  await inOak(async () => {
    const term = await Term.create({ academicYearId: school.year._id, name: 'Term 1', startsOn: new Date('2026-04-01'), endsOn: new Date('2026-12-31') });
    const [m, s] = await Subject.create([{ name: 'Mathematics' }, { name: 'Science' }]);
    maths = await SubjectOffering.create({ sectionId: school.sectionA._id, subjectId: m._id, termId: term._id, teacherId: school.people.TEACHER.profile._id });
    science = await SubjectOffering.create({ sectionId: school.sectionA._id, subjectId: s._id, termId: term._id, teacherId: other.profile._id });
  });
});

const fractions = (over = {}) => ({ subjectOfferingId: String(maths._id), title: 'Fractions', plannedStart: day(-10), plannedEnd: day(10), topics: ['Equivalent fractions', 'Adding fractions', 'Subtracting fractions', 'Word problems'], ...over });

describe('planning', () => {
  it('lets a teacher plan their own subject, in order, and nobody else\'s', async () => {
    const first = await inOak(() => syllabus.createModule(school.people.TEACHER.actor, fractions()));
    const second = await inOak(() => syllabus.createModule(school.people.TEACHER.actor, fractions({ title: 'Decimals', plannedStart: day(11), plannedEnd: day(30), topics: 'Place value\nComparing decimals' })));
    expect([first.order, second.order]).toEqual([1, 2]);
    expect(second.topics.map((t) => t.title)).toEqual(['Place value', 'Comparing decimals']);
    expect(second.pace).toBe('UPCOMING');

    await expect(inOak(() => syllabus.createModule(school.people.TEACHER.actor, fractions({ subjectOfferingId: String(science._id) })))).rejects.toMatchObject({ code: 'NOT_YOUR_SUBJECT' });
    await expect(inOak(() => syllabus.createModule(school.people.TEACHER.actor, fractions({ plannedEnd: day(-20) })))).rejects.toMatchObject({ code: 'BAD_WINDOW' });
    // The principal may plan any subject.
    expect((await inOak(() => syllabus.createModule(school.people.PRINCIPAL.actor, fractions({ subjectOfferingId: String(science._id), title: 'Matter' })))).order).toBe(1);
  });
});

describe('recording what was taught', () => {
  it('starts the module on the first record, ticks topics, and completes on the last', async () => {
    const m = await inOak(() => syllabus.createModule(school.people.TEACHER.actor, fractions()));
    await expect(inOak(() => syllabus.recordProgress(school.people.TEACHER.actor, m.id, {}))).rejects.toMatchObject({ code: 'NOTHING_RECORDED' });
    await expect(inOak(() => syllabus.recordProgress(school.people.TEACHER.actor, m.id, { note: 'x', taughtOn: day(5) }))).rejects.toMatchObject({ code: 'FUTURE_LESSON' });

    const one = await inOak(() => syllabus.recordProgress(school.people.TEACHER.actor, m.id, { topicIds: [m.topics[0].id, m.topics[1].id], note: 'Used fraction strips', homework: 'Exercise 4.2' }));
    expect(one).toMatchObject({ status: 'IN_PROGRESS', topicsDone: 2, topicsTotal: 4, progressPct: 50 });
    expect(one.updates[0]).toMatchObject({ topicsCovered: ['Equivalent fractions', 'Adding fractions'], homework: 'Exercise 4.2', byName: 'TEACHER user' });

    await expect(inOak(() => syllabus.recordProgress(school.people.TEACHER.actor, m.id, { complete: true }))).rejects.toMatchObject({ code: 'TOPICS_OPEN' });
    const done = await inOak(() => syllabus.recordProgress(school.people.TEACHER.actor, m.id, { topicIds: [m.topics[2].id, m.topics[3].id] }));
    expect(done).toMatchObject({ status: 'COMPLETED', progressPct: 100, pace: 'COMPLETED' });
    // A topic added later reopens it.
    const reopened = await inOak(() => syllabus.updateModule(school.people.TEACHER.actor, m.id, { addTopics: ['Mixed numbers'] }));
    expect(reopened.status).toBe('IN_PROGRESS');
    await expect(inOak(() => syllabus.removeModule(school.people.TEACHER.actor, m.id))).rejects.toMatchObject({ code: 'HAS_RECORDS' });
    await expect(inOak(() => syllabus.recordProgress(other.actor, m.id, { note: 'not mine' }))).rejects.toMatchObject({ code: 'NOT_YOUR_SUBJECT' });
  });

  it('measures pace against the planned window, from what was recorded only', async () => {
    // Half-way through its window with nothing recorded: behind.
    const mid = await inOak(() => syllabus.createModule(school.people.TEACHER.actor, fractions()));
    expect(mid).toMatchObject({ expectedPct: expect.any(Number), progressPct: 0, pace: 'BEHIND' });
    expect(mid.expectedPct).toBeGreaterThan(40);
    // Its window is over with topics left: overdue.
    const late = await inOak(() => syllabus.createModule(school.people.TEACHER.actor, fractions({ title: 'Integers', plannedStart: day(-40), plannedEnd: day(-20) })));
    expect(late.pace).toBe('OVERDUE');
    // Everything done early: ahead until it is marked complete by the last topic.
    const quick = await inOak(() => syllabus.createModule(school.people.TEACHER.actor, fractions({ title: 'Ratio', plannedStart: day(-1), plannedEnd: day(30), topics: ['A', 'B'] })));
    const after = await inOak(() => syllabus.recordProgress(school.people.TEACHER.actor, quick.id, { topicIds: [quick.topics[0].id] }));
    expect(after.pace).toBe('AHEAD');
  });
});

describe('who sees the tracker', () => {
  it('shows the principal every subject and adds it up per teacher', async () => {
    await inOak(() => syllabus.createModule(school.people.TEACHER.actor, fractions({ plannedStart: day(-40), plannedEnd: day(-20) })));
    const view = await inOak(() => syllabus.overview(school.people.PRINCIPAL.actor));
    expect(view.rows).toHaveLength(2);
    expect(view.rows.find((r) => r.subject === 'Mathematics')).toMatchObject({ health: 'OVERDUE', teacher: 'TEACHER user', class: 'Class 6 A', current: { title: 'Fractions', pace: 'OVERDUE', nextTopic: 'Equivalent fractions' } });
    expect(view.rows.find((r) => r.subject === 'Science')).toMatchObject({ health: 'NO_PLAN', coveragePct: null });
    expect(view.totals).toMatchObject({ subjects: 2, behind: 1, noPlan: 1 });
    expect(view.byTeacher[0]).toMatchObject({ teacher: 'TEACHER user', behind: 1, lessonsThisWeek: 0, avgScorePct: null });

    // A lesson recorded today and a published result both show against the teacher; a draft mark does not.
    const m = await inOak(() => syllabus.createModule(school.people.TEACHER.actor, fractions({ title: 'Decimals' })));
    await inOak(() => syllabus.recordProgress(school.people.TEACHER.actor, m.id, { topicIds: [m.topics[0].id] }));
    await inOak(async () => {
      const exam = await Exam.create({ termId: maths.termId, name: 'Unit test', startsOn: new Date(), endsOn: new Date() });
      const paper = await ExamSubject.create({ examId: exam._id, subjectOfferingId: maths._id, maxMarks: 50 });
      const enrolments = await Enrollment.find({ sectionId: school.sectionA._id }).limit(2).lean();
      await Mark.create({ examSubjectId: paper._id, enrollmentId: enrolments[0]._id, marks: 40, status: 'PUBLISHED' });
      await Mark.create({ examSubjectId: paper._id, enrollmentId: enrolments[1]._id, marks: 5, status: 'DRAFT' });
    });
    const after = await inOak(() => syllabus.overview(school.people.PRINCIPAL.actor));
    expect(after.byTeacher.find((t) => t.teacher === 'TEACHER user')).toMatchObject({ lessonsThisWeek: 1, avgScorePct: 80 });
    // A teacher's own view carries no table of teachers.
    expect((await inOak(() => syllabus.overview(school.people.TEACHER.actor))).byTeacher).toEqual([]);
  });

  it('shows a teacher their own subjects, a student and a parent their class, and another school nothing', async () => {
    const m = await inOak(() => syllabus.createModule(school.people.TEACHER.actor, fractions()));
    const mine = await inOak(() => syllabus.overview(school.people.TEACHER.actor));
    // TEACHER is also Class 6 A's class teacher, so they follow the class's Science too, read-only (part 4).
    expect(mine.rows.map((r) => r.subject).sort()).toEqual(['Mathematics', 'Science']);
    expect(mine.rows.find((r) => r.subject === 'Science').canManage).toBe(false);
    expect(mine.rows.find((r) => r.subject === 'Mathematics').canManage).toBe(true);
    expect(mine.byTeacher).toEqual([]);

    for (const who of ['STUDENT', 'PARENT']) {
      const seen = await inOak(() => syllabus.overview(school.people[who].actor));
      expect(seen.rows.map((r) => r.subject).sort()).toEqual(['Mathematics', 'Science']);
      expect(seen.rows.every((r) => r.canManage === false)).toBe(true);
      const plan = await inOak(() => syllabus.plan(school.people[who].actor, String(maths._id)));
      expect(plan).toMatchObject({ subject: 'Mathematics', class: 'Class 6 A', canManage: false });
    }
    await expect(inOak(() => syllabus.recordProgress(school.people.STUDENT.actor, m.id, { note: 'x' }))).rejects.toMatchObject({ code: 'NOT_YOUR_SUBJECT' });
    await expect(inOak(() => syllabus.plan(other.actor, String(maths._id)))).rejects.toMatchObject({ statusCode: 404 });
    expect((await inSchool(RIVER, () => syllabus.overview(school.people.RIVER_ADMIN.actor))).rows).toEqual([]);
    await expect(inSchool(RIVER, () => syllabus.plan(school.people.RIVER_ADMIN.actor, String(maths._id)))).rejects.toMatchObject({ statusCode: 404 });
  });
});
