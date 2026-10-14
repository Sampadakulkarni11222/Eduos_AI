import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Student, Enrollment } from '../src/models/student.model.js';
import { Grade, Section, Subject, SubjectOffering, AcademicYear, Term } from '../src/models/academics.model.js';
import { Exam, ExamSubject, Mark } from '../src/models/exam.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as exams from '../src/modules/exams/exam.service.js';

/**
 * Marks entry and publishing (audit T-EX-2/3/4):
 *   - marks were accepted for a paper not yet sat (Unit Test 1, dated 5 Nov);
 *   - there was no AB / ML code, so an absent student read as "not entered";
 *   - publish sent whatever was drafted to families, gaps and all, and a
 *     published mistake could never be corrected.
 */

const OAK = 'oakridge';
const inOak = (fn) => runWithTenant(OAK, fn);
const DAY = 86_400_000;

const teacherId = new mongoose.Types.ObjectId();
const teacher = { roleKey: 'TEACHER', profileId: String(teacherId), permissions: {} };
let offering;
let held;      // a paper sat yesterday
let upcoming;  // a paper three weeks away
let pupils;

beforeEach(async () => {
  await inOak(async () => {
    const year = await AcademicYear.create({ name: '2026-27', startsOn: new Date(Date.now() - 90 * DAY), endsOn: new Date(Date.now() + 200 * DAY), isCurrent: true });
    const term = await Term.create({ academicYearId: year._id, name: 'Term 1', startsOn: year.startsOn, endsOn: year.endsOn });
    const grade = await Grade.create({ name: 'Class 5', level: 5 });
    const section = await Section.create({ gradeId: grade._id, name: 'A', classTeacherId: teacherId });
    const subject = await Subject.create({ name: 'Mathematics' });
    offering = await SubjectOffering.create({ sectionId: section._id, subjectId: subject._id, teacherId, termId: term._id });
    const exam = await Exam.create({ termId: term._id, name: 'Unit Test 1', startsOn: new Date(Date.now() - 2 * DAY), endsOn: new Date(Date.now() + 30 * DAY) });
    held = await ExamSubject.create({ examId: exam._id, subjectOfferingId: offering._id, maxMarks: 50, examDate: new Date(Date.now() - DAY) });
    const exam2 = await Exam.create({ termId: term._id, name: 'Unit Test 2', startsOn: new Date(Date.now() + 21 * DAY), endsOn: new Date(Date.now() + 25 * DAY) });
    upcoming = await ExamSubject.create({ examId: exam2._id, subjectOfferingId: offering._id, maxMarks: 50, examDate: new Date(Date.now() + 21 * DAY) });
    pupils = [];
    for (const [i, name] of ['Diya', 'Kabir', 'Meera'].entries()) {
      const st = await Student.create({ admissionNo: `M-${i}`, firstName: name, lastName: 'S' });
      pupils.push(await Enrollment.create({ studentId: st._id, sectionId: section._id, academicYearId: year._id, status: 'ACTIVE', rollNo: i + 1 }));
    }
  });
});

const enter = (paper, entries) => inOak(() => exams.enterMarks(teacher, 'OWN', {
  examSubjectId: String(paper._id), entries: entries.map(([p, marks]) => ({ enrollmentId: String(p._id), marks })),
}));

describe('a paper not yet held', () => {
  it('refuses marks before the exam date', async () => {
    await expect(enter(upcoming, [[pupils[0], 40]])).rejects.toMatchObject({ statusCode: 400, code: 'EXAM_NOT_HELD' });
    expect(await inOak(() => Mark.countDocuments())).toBe(0);
    const grid = await inOak(() => exams.getMarksGrid(teacher, 'OWN', String(upcoming._id)));
    expect(grid.examSubject.held).toBe(false);
  });
});

describe('absent and medical-leave codes', () => {
  it('records AB and ML as statuses, not numbers, and leaves them out of grades', async () => {
    await enter(held, [[pupils[0], 'AB'], [pupils[1], 'ml'], [pupils[2], 45]]);
    const rows = await inOak(() => Mark.find().lean());
    const by = Object.fromEntries(rows.map((r) => [String(r.enrollmentId), r]));
    expect(by[pupils[0]._id]).toMatchObject({ marks: null, absence: 'AB', gradeLabel: 'AB' });
    expect(by[pupils[1]._id]).toMatchObject({ marks: null, absence: 'ML' });
    expect(by[pupils[2]._id]).toMatchObject({ marks: 45, absence: null, gradeLabel: 'A2' }) // 90%;

    const grid = await inOak(() => exams.getMarksGrid(teacher, 'OWN', String(held._id)));
    expect(grid.rows.find((r) => String(r.enrollmentId) === String(pupils[0]._id)).absence).toBe('AB');
  });

  it('rejects anything else that is not a number', async () => {
    await expect(enter(held, [[pupils[0], 'XYZ']])).rejects.toMatchObject({ code: 'MARKS_INVALID' });
  });

  it('a draft mark can be cleared back to "not entered"', async () => {
    await enter(held, [[pupils[0], 30]]);
    await enter(held, [[pupils[0], null]]);
    const row = await inOak(() => Mark.findOne({ enrollmentId: pupils[0]._id }).lean());
    expect(row.marks).toBeNull();
    expect(row.absence).toBeNull();
    expect(row.gradeLabel).toBeNull();
  });
});

describe('publishing', () => {
  it('is refused until every student has a score or AB/ML', async () => {
    await enter(held, [[pupils[0], 30], [pupils[1], 'AB']]);
    await expect(inOak(() => exams.publishMarks(teacher, 'OWN', String(held._id))))
      .rejects.toMatchObject({ statusCode: 400, code: 'MARKS_INCOMPLETE', message: expect.stringMatching(/1 student has no marks yet \(Meera S\)/) });
    expect(await inOak(() => Mark.countDocuments({ status: 'PUBLISHED' }))).toBe(0);

    await enter(held, [[pupils[2], 'ML']]);
    const done = await inOak(() => exams.publishMarks(teacher, 'OWN', String(held._id)));
    expect(done.modified).toBe(3);
  });

  it('a published result can be reopened for correction, with a reason, and it is audited', async () => {
    await enter(held, [[pupils[0], 30], [pupils[1], 31], [pupils[2], 32]]);
    await inOak(() => exams.publishMarks(teacher, 'OWN', String(held._id)));

    await expect(inOak(() => exams.unpublishMarks(teacher, 'OWN', { examSubjectId: String(held._id) })))
      .rejects.toMatchObject({ code: 'REASON_REQUIRED' });

    const r = await inOak(() => exams.unpublishMarks(teacher, 'OWN', { examSubjectId: String(held._id), reason: 'Totalling error on Q4' }));
    expect(r.reopened).toBe(3);
    expect(await inOak(() => Mark.countDocuments({ status: 'DRAFT' }))).toBe(3);

    // Now correctable, then publishable again.
    await enter(held, [[pupils[0], 35]]);
    await inOak(() => exams.publishMarks(teacher, 'OWN', String(held._id)));

    const log = await inOak(() => AuditLog.findOne({ action: 'MARKS_UNPUBLISHED' }).lean());
    expect(log.after.reason).toBe('Totalling error on Q4');
    expect(log.before.marks).toHaveLength(3);
  });
});
