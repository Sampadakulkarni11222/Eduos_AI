import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Grade, Section, Subject, SubjectOffering, AcademicYear, Term } from '../src/models/academics.model.js';
import { Student, Enrollment } from '../src/models/student.model.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as assignments from '../src/modules/assignments/assignment.service.js';

/**
 * ISSUE-04 — the "create assignment" form had no way to attach a new
 * document: only a fixed Chapter 1..20 dropdown. The Assignment schema
 * already had an `attachments` field but nothing wrote or read it. Confirms
 * create() persists attachments and list() surfaces them back.
 *
 * ISSUE-03 — teachers reportedly saw only submission status, not the
 * uploaded file. listSubmissions() already returned `attachments` per row;
 * this is a regression test proving that stays true (the frontend "Open"
 * link change is what actually made these downloadable in the browser).
 */

const OAK = 'oakridge';
const inOak = (fn) => runWithTenant(OAK, fn);

const teacherId = new mongoose.Types.ObjectId();
let offering;
let section;
let enrolment;

const teacherActor = { roleKey: 'TEACHER', profileId: teacherId.toString(), permissions: {} };

beforeEach(async () => {
  await inOak(async () => {
    const grade = await Grade.create({ name: 'Class 7', level: 7 });
    section = await Section.create({ gradeId: grade._id, name: 'A' });
    const year = await AcademicYear.create({ name: '2026-27', startsOn: new Date(), endsOn: new Date(), isCurrent: true });
    const term = await Term.create({ academicYearId: year._id, name: 'Term 1', startsOn: new Date(), endsOn: new Date() });
    const subject = await Subject.create({ name: 'English' });
    offering = await SubjectOffering.create({ sectionId: section._id, subjectId: subject._id, termId: term._id, teacherId });

    const student = await Student.create({ admissionNo: 'ATT-1', firstName: 'Kid', lastName: 'One' });
    enrolment = await Enrollment.create({ studentId: student._id, sectionId: section._id, academicYearId: year._id, status: 'ACTIVE' });
  });
});

it('persists attachments supplied when creating an assignment', async () => {
  const created = await inOak(() => assignments.create(teacherActor, 'OWN', {
    subjectOfferingId: offering._id.toString(),
    title: 'Worksheet 1',
    dueAt: new Date(Date.now() + 86400000),
    attachments: ['/uploads/worksheet-1.pdf'],
  }));
  expect(created.attachments).toEqual(['/uploads/worksheet-1.pdf']);

  const list = await inOak(() => assignments.list(teacherActor, 'OWN', {}));
  expect(list[0].attachments).toEqual(['/uploads/worksheet-1.pdf']);
});

it('defaults to no attachments when none are supplied', async () => {
  const created = await inOak(() => assignments.create(teacherActor, 'OWN', {
    subjectOfferingId: offering._id.toString(),
    title: 'No attachment',
    dueAt: new Date(Date.now() + 86400000),
  }));
  expect(created.attachments).toEqual([]);
});

it('a teacher can see the file a student submitted', async () => {
  const created = await inOak(() => assignments.create(teacherActor, 'OWN', {
    subjectOfferingId: offering._id.toString(),
    title: 'Homework',
    dueAt: new Date(Date.now() + 86400000),
  }));

  const studentActor = { roleKey: 'STUDENT', profileId: new mongoose.Types.ObjectId().toString(), permissions: {} };
  // submit() resolves the student's own enrollment via getOwnEnrollmentIds when
  // scope is OWN, which needs a Student.profileId match — simplest to submit
  // with an explicit enrollmentId under ALL scope instead, mirroring how the
  // roster read is exercised below.
  await inOak(() => assignments.submit(studentActor, 'ALL', {
    assignmentId: created._id.toString(),
    enrollmentId: enrolment._id.toString(),
    attachments: ['/uploads/my-solution.pdf'],
  }));

  const roster = await inOak(() => assignments.listSubmissions(teacherActor, 'OWN', created._id.toString()));
  const row = roster.rows.find((r) => r.enrollmentId.toString() === enrolment._id.toString());
  expect(row.attachments).toEqual(['/uploads/my-solution.pdf']);
  expect(row.status).toBe('SUBMITTED');
});
