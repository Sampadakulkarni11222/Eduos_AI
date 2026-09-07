import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Role } from '../src/models/role.model.js';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { Student, Enrollment } from '../src/models/student.model.js';
import { Grade, Section } from '../src/models/academics.model.js';
import { Document } from '../src/models/document.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as students from '../src/modules/students/student.service.js';
import * as documents from '../src/modules/documents/document.service.js';
import * as library from '../src/modules/library/library.service.js';

/**
 * "No selection" means everything the caller may see — never nothing.
 *
 * The QA report flags this as a thing to check rather than a known bug: a
 * class filter left unset must widen the list to every class the caller is
 * entitled to, and must not be mistaken for "the empty class". The failure
 * mode is quiet — an empty table looks like a school with no records — so it
 * is asserted here per list rather than eyeballed per screen.
 */

const SCHOOL = 'oakridge';
const inSchool = (fn) => runWithTenant(SCHOOL, fn);

const permsOf = (roleKey) =>
  buildPermissionMap({ permissions: SYSTEM_ROLES.find((r) => r.key === roleKey).grants });

const actorFor = (roleKey, profileId) => ({
  roleKey,
  profileId: String(profileId ?? new mongoose.Types.ObjectId()),
  permissions: permsOf(roleKey),
});

let sectionA;
let sectionB;
let adminProfile;

const rows = (res) => (Array.isArray(res) ? res : res.items);

beforeEach(async () => {
  for (const r of SYSTEM_ROLES) {
    await Role.create({ key: r.key, name: r.name, isSystem: true, permissions: r.grants });
  }

  await inSchool(async () => {
    const account = await Account.create({ phoneE164: '+919810000123' });
    adminProfile = await Profile.create({
      accountId: account._id,
      roleId: (await Role.findOne({ key: 'ADMIN' }))._id,
      displayName: 'An Admin',
      tenantId: SCHOOL,
      tenantName: SCHOOL,
    });

    const grade = await Grade.create({ name: 'Class 7', level: 7 });
    sectionA = await Section.create({ gradeId: grade._id, name: 'A' });
    sectionB = await Section.create({ gradeId: grade._id, name: 'B' });

    for (const [admissionNo, section] of [['OAK-A1', sectionA], ['OAK-B1', sectionB]]) {
      const student = await Student.create({ admissionNo, firstName: 'Kid', lastName: admissionNo });
      await Enrollment.create({
        studentId: student._id, sectionId: section._id,
        academicYearId: new mongoose.Types.ObjectId(), status: 'ACTIVE',
      });
    }
  });
});

describe('the student list', () => {
  const admin = () => actorFor('ADMIN', adminProfile._id);

  it('returns every class when no class is chosen', async () => {
    const res = await inSchool(() => students.list(admin(), 'ALL', {}));
    expect(rows(res)).toHaveLength(2);
  });

  it('treats an empty string the way the picker sends it — as no filter', async () => {
    // This is the exact shape the "All classes" option produces.
    const res = await inSchool(() => students.list(admin(), 'ALL', { sectionId: '' }));
    expect(rows(res)).toHaveLength(2);
  });

  it('narrows to one class when one is chosen', async () => {
    const res = await inSchool(() =>
      students.list(admin(), 'ALL', { sectionId: sectionA._id.toString() }));
    expect(rows(res).map((s) => s.admissionNo)).toEqual(['OAK-A1']);
  });
});

describe('course material', () => {
  const admin = () => actorFor('ADMIN', adminProfile._id);

  beforeEach(async () => {
    await inSchool(async () => {
      await Document.create({
        title: 'Chapter 1 notes', type: 'CUSTOM', fileUrl: '/uploads/c1.pdf',
        visibleToRoles: ['ADMIN', 'STUDENT'], sectionId: sectionA._id, authorProfileId: adminProfile._id,
      });
      await Document.create({
        title: 'Chapter 2 notes', type: 'CUSTOM', fileUrl: '/uploads/c2.pdf',
        visibleToRoles: ['ADMIN', 'STUDENT'], sectionId: sectionB._id, authorProfileId: adminProfile._id,
      });
    });
  });

  it('shows every section when no class is chosen', async () => {
    const res = await inSchool(() => documents.listForActor(admin(), 'ALL', null, {}));
    expect(rows(res)).toHaveLength(2);
  });

  it('narrows to one section when one is chosen', async () => {
    const res = await inSchool(() =>
      documents.listForActor(admin(), 'ALL', null, { sectionId: sectionA._id.toString() }));
    expect(rows(res).map((d) => d.title)).toEqual(['Chapter 1 notes']);
  });
});

describe('the library catalogue', () => {
  beforeEach(async () => {
    await inSchool(async () => {
      await library.createBook({ title: 'Book A', author: 'A', totalCopies: 1 }, actorFor('LIBRARIAN'));
      await library.createBook({
        title: 'Paper A', author: 'Exams', resourceKind: 'QUESTION_PAPER',
        resourceUrl: '/uploads/p.pdf', gradeId: sectionA.gradeId,
      }, actorFor('LIBRARIAN'));
    });
  });

  it('an unset class filter does not empty the shelf', async () => {
    const res = await inSchool(() => library.listBooks({ resourceKind: 'QUESTION_PAPER', gradeId: '' }));
    expect(rows(res)).toHaveLength(1);
  });

  it('"ALL" is honoured as no filter, not matched literally', async () => {
    // Several pickers send the string ALL rather than an empty value; matching
    // it literally against an id field is how a filter silently empties a list.
    const res = await inSchool(() => library.listBooks({ resourceKind: 'ALL', gradeId: 'ALL' }));
    expect(rows(res)).toHaveLength(2);
  });
});
