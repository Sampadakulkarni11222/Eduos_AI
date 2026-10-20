import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Grade, Section, Subject, SubjectOffering, AcademicYear, Term } from '../src/models/academics.model.js';
import { Assignment } from '../src/models/assignment.model.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as assignments from '../src/modules/assignments/assignment.service.js';

/**
 * Audit T-ASG-1: POST /assignments ran `Assignment.create({...data})`.
 * dueAt 2020-01-01, maxMarks -5 and type "ANYTHING" were all accepted, and a
 * body carrying deletedAt saved the homework as already deleted. There was no
 * way to edit or withdraw homework once set.
 */

const OAK = 'oakridge';
const inOak = (fn) => runWithTenant(OAK, fn);

const teacherId = new mongoose.Types.ObjectId();
const otherTeacherId = new mongoose.Types.ObjectId();
const teacher = { roleKey: 'TEACHER', profileId: String(teacherId), permissions: {} };
const otherTeacher = { roleKey: 'TEACHER', profileId: String(otherTeacherId), permissions: {} };
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();
let offering;

beforeEach(async () => {
  await inOak(async () => {
    const grade = await Grade.create({ name: 'Class 7', level: 7 });
    const section = await Section.create({ gradeId: grade._id, name: 'A' });
    const year = await AcademicYear.create({ name: '2026-27', startsOn: new Date(), endsOn: new Date(), isCurrent: true });
    const term = await Term.create({ academicYearId: year._id, name: 'Term 1', startsOn: new Date(), endsOn: new Date() });
    const subject = await Subject.create({ name: 'Maths' });
    offering = await SubjectOffering.create({ sectionId: section._id, subjectId: subject._id, termId: term._id, teacherId });
  });
});

const create = (body, who = teacher) => inOak(() => assignments.create(who, 'OWN', {
  subjectOfferingId: String(offering._id), title: 'Fractions', dueAt: tomorrow(), maxMarks: 10, ...body,
}));

describe('creating homework', () => {
  it('accepts a valid assignment', async () => {
    const a = await create({ type: 'worksheet' });
    expect(a.type).toBe('WORKSHEET');
    expect(assignments.toView(a)).toMatchObject({ id: String(a._id), title: 'Fractions' });
    expect(assignments.toView(a)).not.toHaveProperty('tenantId');
  });

  it.each([
    ['a past due date', { dueAt: '2020-01-01' }, 'ASSIGNMENT_DUE_PAST'],
    ['no due date', { dueAt: undefined }, 'ASSIGNMENT_DUE_INVALID'],
    ['negative max marks', { maxMarks: -5 }, 'ASSIGNMENT_MAX_MARKS_INVALID'],
    ['zero max marks', { maxMarks: 0 }, 'ASSIGNMENT_MAX_MARKS_INVALID'],
    ['an unknown type', { type: 'ANYTHING' }, 'ASSIGNMENT_TYPE_INVALID'],
    ['a blank title', { title: '   ' }, 'ASSIGNMENT_TITLE_REQUIRED'],
  ])('refuses %s', async (_label, body, code) => {
    await expect(create(body)).rejects.toMatchObject({ statusCode: 400, code });
    expect(await inOak(() => Assignment.countDocuments())).toBe(0);
  });

  it('ignores fields a teacher does not set (deletedAt, createdByProfileId)', async () => {
    const a = await create({ deletedAt: '2026-01-01', createdByProfileId: String(otherTeacherId), tenantId: 'nvmp' });
    const saved = await inOak(() => Assignment.findById(a._id).lean());
    expect(saved.deletedAt).toBeNull();
    expect(String(saved.createdByProfileId)).toBe(String(teacherId));
    const listed = await inOak(() => assignments.list(teacher, 'OWN', {}));
    expect(listed.map((x) => String(x.id))).toContain(String(a._id));
  });
});

describe('editing and withdrawing homework', () => {
  it('the teacher who set it can edit it, with the same checks', async () => {
    const a = await create({});
    const edited = await inOak(() => assignments.update(teacher, 'OWN', String(a._id), { title: 'Fractions II', maxMarks: 20, deletedAt: new Date() }));
    expect(edited.title).toBe('Fractions II');
    expect(edited.maxMarks).toBe(20);
    expect(edited.deletedAt).toBeNull();
    await expect(inOak(() => assignments.update(teacher, 'OWN', String(a._id), { dueAt: '2020-01-01' })))
      .rejects.toMatchObject({ code: 'ASSIGNMENT_DUE_PAST' });
  });

  it('another teacher cannot edit or withdraw it', async () => {
    const a = await create({});
    await expect(inOak(() => assignments.update(otherTeacher, 'OWN', String(a._id), { title: 'x' })))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(inOak(() => assignments.remove(otherTeacher, 'OWN', String(a._id))))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('withdrawing is a soft delete that leaves the list', async () => {
    const a = await create({});
    await inOak(() => assignments.remove(teacher, 'OWN', String(a._id)));
    const saved = await inOak(() => Assignment.findById(a._id).lean());
    expect(saved.deletedAt).toBeInstanceOf(Date);
    expect(await inOak(() => assignments.list(teacher, 'OWN', {}))).toHaveLength(0);
    await expect(inOak(() => assignments.remove(teacher, 'OWN', String(a._id))))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});
