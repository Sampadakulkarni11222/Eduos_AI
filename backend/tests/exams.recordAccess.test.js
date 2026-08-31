import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Student, Enrollment, StudentGuardian } from '../src/models/student.model.js';
import { Grade, Section, Subject, SubjectOffering, AcademicYear, Term } from '../src/models/academics.model.js';
import { Exam, ExamSubject, Mark } from '../src/models/exam.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as exams from '../src/modules/exams/exam.service.js';

/**
 * Record-level access to marks, report cards and their PDF export.
 *
 * These are negative tests for a control that already exists: getPerformance()
 * checks an explicitly supplied enrollmentId against the caller's own scope,
 * so `?enrollmentId=<another student>` cannot be used to read their results —
 * nor, through getReportCard/getReportCardPdf, their report card or its PDF.
 * Written during the security audit to hold that control in place.
 */

const OAK = 'oakridge';
const inOak = (fn) => runWithTenant(OAK, fn);

const grantsFor = (roleKey) => SYSTEM_ROLES.find((r) => r.key === roleKey).grants;
const permsOf = (roleKey) => buildPermissionMap({ permissions: grantsFor(roleKey) });
const scopeOf = (roleKey) => permsOf(roleKey)['marks.read'];
const actorFor = (roleKey, profileId) => ({
  roleKey,
  profileId: profileId?.toString() ?? new mongoose.Types.ObjectId().toString(),
  permissions: permsOf(roleKey),
});

const teacherId = new mongoose.Types.ObjectId();
const otherTeacherId = new mongoose.Types.ObjectId();
let mine;       // enrolment in the teacher's own section
let theirs;     // enrolment in a colleague's section
let myProfileId;
let theirProfileId;
let parentProfileId;

/** A student enrolled in `section`, with one published mark. */
const seedStudent = async (section, admissionNo, examSubject) => {
  const profileId = new mongoose.Types.ObjectId();
  const student = await Student.create({
    admissionNo, firstName: admissionNo, lastName: 'Pupil', profileId,
  });
  const enrolment = await Enrollment.create({
    studentId: student._id, sectionId: section._id,
    academicYearId: new mongoose.Types.ObjectId(), status: 'ACTIVE',
  });
  await Mark.create({
    examSubjectId: examSubject._id, enrollmentId: enrolment._id, marksObtained: 91,
  });
  return { profileId, student, enrolment };
};

beforeEach(async () => {
  await inOak(async () => {
    const year = await AcademicYear.create({ name: '2026-27', startsOn: new Date(), endsOn: new Date(), isCurrent: true });
    const term = await Term.create({ academicYearId: year._id, name: 'Term 1', startsOn: new Date(), endsOn: new Date() });
    const grade = await Grade.create({ name: 'Class 6', level: 6 });
    const mySection = await Section.create({ gradeId: grade._id, name: 'A', classTeacherId: teacherId });
    const otherSection = await Section.create({ gradeId: grade._id, name: 'B', classTeacherId: otherTeacherId });
    const subject = await Subject.create({ name: 'Mathematics' });

    const myOffering = await SubjectOffering.create({
      sectionId: mySection._id, subjectId: subject._id, teacherId, termId: term._id,
    });
    const exam = await Exam.create({
      name: 'Midterm', academicYearId: year._id, termId: term._id,
      startsOn: new Date(), endsOn: new Date(), isPublished: true,
    });
    const examSubject = await ExamSubject.create({
      examId: exam._id, subjectOfferingId: myOffering._id, maxMarks: 100, isPublished: true,
    });

    const a = await seedStudent(mySection, 'IN-6A', examSubject);
    const b = await seedStudent(otherSection, 'IN-6B', examSubject);
    mine = a.enrolment;
    theirs = b.enrolment;
    myProfileId = a.profileId;
    theirProfileId = b.profileId;

    parentProfileId = new mongoose.Types.ObjectId();
    await StudentGuardian.create({
      studentId: a.student._id, guardianProfileId: parentProfileId, relation: 'MOTHER',
    });
  });
});

describe('a student reaches only their own results', () => {
  it('reads their own performance without naming an enrolment', async () => {
    const perf = await inOak(() =>
      exams.getPerformance(actorFor('STUDENT', myProfileId), 'OWN', {}));
    expect(perf.student.name).toBe('IN-6A Pupil');
  });

  it('reads their own performance when they do name it', async () => {
    const perf = await inOak(() =>
      exams.getPerformance(actorFor('STUDENT', myProfileId), 'OWN', { enrollmentId: mine._id.toString() }));
    expect(perf.student.name).toBe('IN-6A Pupil');
  });

  it('is refused another student enrolment id', async () => {
    await expect(
      inOak(() => exams.getPerformance(actorFor('STUDENT', myProfileId), 'OWN', {
        enrollmentId: theirs._id.toString(),
      })),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('cannot reach another student report card', async () => {
    await expect(
      inOak(() => exams.getReportCard(actorFor('STUDENT', myProfileId), 'OWN', {
        enrollmentId: theirs._id.toString(),
      })),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('cannot export another student report card as a PDF', async () => {
    // getReportCardPdf renders whatever getReportCard returns, so refusing
    // there closes the export path too.
    await expect(
      inOak(() => exams.getReportCard(actorFor('STUDENT', theirProfileId), 'OWN', {
        enrollmentId: mine._id.toString(),
      })),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('a parent reaches only their own children', () => {
  it('reads their child report card', async () => {
    const card = await inOak(() =>
      exams.getReportCard(actorFor('PARENT', parentProfileId), 'OWN', {
        enrollmentId: mine._id.toString(),
      }));
    expect(card.student.name).toBe('IN-6A Pupil');
  });

  it('is refused a child who is not theirs', async () => {
    await expect(
      inOak(() => exams.getReportCard(actorFor('PARENT', parentProfileId), 'OWN', {
        enrollmentId: theirs._id.toString(),
      })),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('a teacher reaches only the sections they teach', () => {
  it('reads a student in their own section', async () => {
    const perf = await inOak(() =>
      exams.getPerformance(actorFor('TEACHER', teacherId), 'OWN', {
        enrollmentId: mine._id.toString(),
      }));
    expect(perf.student.name).toBe('IN-6A Pupil');
  });

  it('is refused a student in a colleague section', async () => {
    await expect(
      inOak(() => exams.getPerformance(actorFor('TEACHER', teacherId), 'OWN', {
        enrollmentId: theirs._id.toString(),
      })),
    ).rejects.toThrow(/not in your classes/i);
  });
});

describe('school-wide staff are unaffected', () => {
  it.each(['ADMIN', 'PRINCIPAL'])('%s reads any enrolment in their school', async (roleKey) => {
    expect(scopeOf(roleKey)).toBe('ALL');
    const perf = await inOak(() =>
      exams.getPerformance(actorFor(roleKey), scopeOf(roleKey), {
        enrollmentId: theirs._id.toString(),
      }));
    expect(perf.student.name).toBe('IN-6B Pupil');
  });

  it('another school cannot reach this one, id or not', async () => {
    await expect(
      runWithTenant('nvmp', () => exams.getPerformance(actorFor('ADMIN'), 'ALL', {
        enrollmentId: mine._id.toString(),
      })),
    ).rejects.toThrow(/not found/i);
  });
});
