import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Role } from '../src/models/role.model.js';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { Student, Enrollment, StudentGuardian } from '../src/models/student.model.js';
import { Grade, Section, Subject, SubjectOffering, AcademicYear, Term } from '../src/models/academics.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as students from '../src/modules/students/student.service.js';
import * as academics from '../src/modules/academics/academics.service.js';

/**
 * Role and data segregation, probed at the layer an attacker reaches.
 *
 * The permission matrix (authorization.matrix.test.js) proves which keys each
 * role holds, and the tenancy suites prove one school cannot read another's
 * rows. Neither answers the question this file asks: given a role that
 * legitimately holds a permission at OWN scope, does the *data* layer actually
 * narrow it — including when the caller forges the ids in the request?
 *
 * Every case calls the service the route calls, with the scope the guard would
 * have attached, and where relevant passes ids the UI would never offer.
 */

const SCHOOL = 'oakridge';
const inSchool = (fn) => runWithTenant(SCHOOL, fn);

const roleByKey = new Map();
const actorFor = (roleKey, profileId = null) => ({
  roleKey,
  profileId: profileId ? String(profileId) : null,
  permissions: buildPermissionMap(roleByKey.get(roleKey)),
});

let year;
let sectionTaught; // the teacher's own section
let sectionOther; // a section they have nothing to do with
let ownStudent; // enrolled in sectionTaught
let otherStudent; // enrolled in sectionOther
let teacher;
let parentActor;
let studentActor;

/** A profile of the given role, returned with an actor built from it. */
const makeActor = async (roleKey, displayName) => {
  const account = await Account.create({
    phoneE164: `+9198100${Math.floor(10000 + Math.random() * 89999)}`,
  });
  const profile = await Profile.create({
    accountId: account._id,
    roleId: roleByKey.get(roleKey)._id,
    displayName,
    tenantId: SCHOOL,
    tenantName: SCHOOL,
  });
  return { profile, actor: actorFor(roleKey, profile._id) };
};

beforeEach(async () => {
  roleByKey.clear();
  for (const r of SYSTEM_ROLES) {
    roleByKey.set(r.key, await Role.create({ key: r.key, name: r.name, isSystem: true, permissions: r.grants }));
  }

  await inSchool(async () => {
    year = await AcademicYear.create({ name: '2026-27', startsOn: new Date(), endsOn: new Date() });
    const grade = await Grade.create({ name: 'Class 5', level: 5 });
    sectionTaught = await Section.create({ name: 'A', gradeId: grade._id });
    sectionOther = await Section.create({ name: 'B', gradeId: grade._id });

    const t = await makeActor('TEACHER', 'Asha Teacher');
    teacher = t.actor;

    // The teacher reaches section A through a subject offering, which is the
    // weaker of the two routes — not by being its class teacher.
    const term = await Term.create({
      academicYearId: year._id, name: 'T1', startsOn: new Date(), endsOn: new Date(),
    });
    const subject = await Subject.create({ name: 'Mathematics', code: 'MATH' });
    await SubjectOffering.create({
      sectionId: sectionTaught._id, subjectId: subject._id, termId: term._id, teacherId: t.profile._id,
    });

    ownStudent = await Student.create({ admissionNo: 'OAK-1', firstName: 'Ravi', lastName: 'Kumar' });
    otherStudent = await Student.create({ admissionNo: 'OAK-2', firstName: 'Neha', lastName: 'Singh' });
    await Enrollment.create({
      studentId: ownStudent._id, sectionId: sectionTaught._id, academicYearId: year._id, status: 'ACTIVE',
    });
    await Enrollment.create({
      studentId: otherStudent._id, sectionId: sectionOther._id, academicYearId: year._id, status: 'ACTIVE',
    });

    const p = await makeActor('PARENT', 'Ravi Parent');
    parentActor = p.actor;
    await StudentGuardian.create({
      studentId: ownStudent._id, guardianProfileId: p.profile._id, relation: 'FATHER',
    });

    const s = await makeActor('STUDENT', 'Ravi Kumar');
    studentActor = s.actor;
    await Student.updateOne({ _id: ownStudent._id }, { $set: { profileId: s.profile._id } });
  });
});

/** Student names as the list DTO serves them, sorted so order is not asserted. */
const names = (list) => (list.items ?? list).map((s) => s.name ?? `${s.firstName} ${s.lastName}`).sort();

describe('a teacher reaches only the classes they actually teach', () => {
  it('lists the students of their own section and nobody else', async () => {
    const res = await inSchool(() => students.list(teacher, 'OWN', {}));
    expect(names(res)).toEqual(['Ravi Kumar']);
  });

  it('a forged sectionId does not widen the list — it intersects', async () => {
    // The request a manipulated client would send: their own scope, someone
    // else's section id.
    const res = await inSchool(() => students.list(teacher, 'OWN', { sectionId: sectionOther._id.toString() }));
    expect(names(res)).toEqual([]);
  });

  it('reading a student from another section by id is a 404, not a record', async () => {
    await expect(
      inSchool(() => students.getById(teacher, 'OWN', otherStudent._id.toString(), { audit: false }))
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('the same student is readable once the teacher takes that section', async () => {
    // Proves the refusal above is about the relationship, not about the id
    // being unreadable for some incidental reason.
    await inSchool(() => Section.updateOne(
      { _id: sectionOther._id },
      { $set: { classTeacherId: teacher.profileId } }
    ));
    const found = await inSchool(() => students.getById(teacher, 'OWN', otherStudent._id.toString(), { audit: false }));
    expect(found.firstName).toBe('Neha');
  });

  it('sees only its own sections and offerings on the /mine endpoints', async () => {
    const mine = await inSchool(() => academics.getMySections(teacher));
    expect(mine.map((s) => s.name)).toEqual(['A']);
    const offerings = await inSchool(() => academics.getMyOfferings(teacher));
    expect(offerings).toHaveLength(1);
  });
});

describe('a parent reaches only their own child', () => {
  it('lists exactly the linked children', async () => {
    const res = await inSchool(() => students.list(parentActor, 'OWN', {}));
    expect(names(res)).toEqual(['Ravi Kumar']);
  });

  it('another family child is a 404 by id', async () => {
    await expect(
      inSchool(() => students.getById(parentActor, 'OWN', otherStudent._id.toString(), { audit: false }))
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('cannot widen the list by naming a whole section', async () => {
    const res = await inSchool(() => students.list(parentActor, 'OWN', { sectionId: sectionTaught._id.toString() }));
    expect(names(res)).toEqual(['Ravi Kumar']);
  });
});

describe('a student reaches only themselves', () => {
  it('lists only their own record', async () => {
    const res = await inSchool(() => students.list(studentActor, 'OWN', {}));
    expect(names(res)).toEqual(['Ravi Kumar']);
  });

  it('a classmate is a 404 by id', async () => {
    await expect(
      inSchool(() => students.getById(studentActor, 'OWN', otherStudent._id.toString(), { audit: false }))
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('sees only their own section from the /mine endpoints', async () => {
    const mine = await inSchool(() => academics.getMySections(studentActor));
    expect(mine.map((s) => s.name)).toEqual(['A']);
  });
});

describe('a role with no link to a student, and no permission, gets nothing', () => {
  /**
   * The `/mine` endpoints carry no route guard — they have to stay open to
   * teachers and families, who hold no `academics.read`. So the school-wide
   * fallback has to check that permission itself; a role without it must not
   * be handed the roster.
   */
  it('a custom role without academics.read reads no sections from /mine', async () => {
    const stranger = {
      roleKey: 'CUSTOM_ROLE',
      profileId: new mongoose.Types.ObjectId().toString(),
      permissions: {},
    };
    expect(await inSchool(() => academics.getMySections(stranger))).toEqual([]);
    expect(await inSchool(() => academics.getMyOfferings(stranger))).toEqual([]);
  });

  it('a staff role holding academics.read still gets the school list', async () => {
    const librarian = actorFor('LIBRARIAN');
    const mine = await inSchool(() => academics.getMySections(librarian));
    expect(mine.map((s) => s.name).sort()).toEqual(['A', 'B']);
  });
});
