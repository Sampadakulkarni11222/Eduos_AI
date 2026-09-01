import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Document } from '../src/models/document.model.js';
import { Student, Enrollment } from '../src/models/student.model.js';
import { Section, Grade } from '../src/models/academics.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { requirePermission } from '../src/middleware/permission.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as documents from '../src/modules/documents/document.service.js';
import { deleteDocument } from '../src/modules/documents/document.controller.js';

/**
 * Who may view course material.
 *
 * The visibility filter used to test the actor's role against the literal
 * string 'ADMIN' rather than the scope of the permission the route is guarded
 * by, so the two other roles holding materials.read at ALL — Principal and
 * Super Admin — matched on `visibleToRoles: 'PRINCIPAL'` / `'SUPER_ADMIN'`, a
 * tag course material never carries, and saw an all-but-empty list.
 */

const OAK = 'oakridge';
const NVMP = 'nvmp';
const inOak = (fn) => runWithTenant(OAK, fn);
const inNvmp = (fn) => runWithTenant(NVMP, fn);

const grantsFor = (roleKey) => SYSTEM_ROLES.find((r) => r.key === roleKey).grants;
const permsOf = (roleKey) => buildPermissionMap({ permissions: grantsFor(roleKey) });
const actorFor = (roleKey, profileId) => ({
  roleKey,
  profileId: profileId?.toString() ?? new mongoose.Types.ObjectId().toString(),
  permissions: permsOf(roleKey),
});
/** The scope requirePermission would put on req.scope for this role. */
const scopeOf = (roleKey, key = 'materials.read') => permsOf(roleKey)[key];

/** Runs the real route guard for a documents route. */
const canReach = (roleKey, permissionKey) => {
  const req = { actor: actorFor(roleKey) };
  try {
    requirePermission(permissionKey)(req, {}, () => {});
    return true;
  } catch {
    return false;
  }
};

/** paginate() returns a bare array unless a pageSize is asked for. */
const rowsOf = (result) => (Array.isArray(result) ? result : result.items);

const listAs = (roleKey, profileId) =>
  documents.listForActor(actorFor(roleKey, profileId), scopeOf(roleKey), undefined, {});

const titlesFor = (roleKey, profileId) => inOak(async () =>
  rowsOf(await listAs(roleKey, profileId)).map((d) => d.title).sort());

const teacherId = new mongoose.Types.ObjectId();
let ownSection;
let studentProfileId;
let nvmpMaterial;

beforeEach(async () => {
  await inOak(async () => {
    const grade = await Grade.create({ name: 'Class 6', level: 6 });
    ownSection = await Section.create({ gradeId: grade._id, name: 'A', classTeacherId: teacherId });

    studentProfileId = new mongoose.Types.ObjectId();
    const student = await Student.create({
      admissionNo: 'ADM-1', firstName: 'A', lastName: 'Student', profileId: studentProfileId,
    });
    await Enrollment.create({
      studentId: student._id, sectionId: ownSection._id,
      academicYearId: new mongoose.Types.ObjectId(), status: 'ACTIVE',
    });

    // Course material a teacher published to their class.
    await Document.create({
      title: 'Algebra notes', type: 'CUSTOM', fileUrl: '/uploads/algebra.pdf',
      visibleToRoles: ['STUDENT'], sectionId: ownSection._id, authorProfileId: teacherId,
    });
    // An official document, not course material.
    await Document.create({
      title: 'Report card', type: 'REPORT_CARD', fileUrl: '/uploads/rc.pdf',
      visibleToRoles: ['STUDENT'], authorProfileId: new mongoose.Types.ObjectId(),
    });
  });

  await inNvmp(async () => {
    nvmpMaterial = await Document.create({
      title: 'NVMP chemistry notes', type: 'CUSTOM', fileUrl: '/uploads/chem.pdf',
      visibleToRoles: ['STUDENT'], authorProfileId: new mongoose.Types.ObjectId(),
    });
  });
});

describe('1 & 3. school-wide readers can view course material', () => {
  it.each(['ADMIN', 'PRINCIPAL', 'SUPER_ADMIN'])('%s sees the school material', async (roleKey) => {
    expect(scopeOf(roleKey)).toBe('ALL');
    expect(await titlesFor(roleKey)).toEqual(['Algebra notes', 'Report card']);
  });

  it('a principal saw almost nothing before, because the check was a role string', () => {
    // The regression this guards: PRINCIPAL holds the permission at ALL but is
    // not literally 'ADMIN'.
    expect(permsOf('PRINCIPAL')['materials.read']).toBe('ALL');
    expect(permsOf('SUPER_ADMIN')['materials.read']).toBe('ALL');
  });

  it('keeps the categories that distinguish material — type, class, subject', async () => {
    const rows = rowsOf(await inOak(() => listAs('ADMIN')));
    const material = rows.find((d) => d.title === 'Algebra notes');
    expect(material.type).toBe('CUSTOM');
    expect(String(material.sectionId)).toBe(ownSection._id.toString());
    expect(material).toHaveProperty('subjectOfferingId');
  });
});

describe('2. a School Admin is confined to their own school', () => {
  it('does not see another school material', async () => {
    expect(await titlesFor('ADMIN')).not.toContain('NVMP chemistry notes');
  });

  it('cannot fetch another school material file by id', async () => {
    await expect(
      inOak(() => documents.getFileForActor(actorFor('ADMIN'), 'ALL', nvmpMaterial._id.toString())),
    ).rejects.toThrow('Document not found');
  });

  it('the other school admin sees only theirs', async () => {
    const rows = rowsOf(await inNvmp(() => listAs('ADMIN')));
    expect(rows.map((d) => d.title)).toEqual(['NVMP chemistry notes']);
  });
});

describe('5. every other role keeps the access it had', () => {
  it('a student still sees only material published to their role and section', async () => {
    expect(await titlesFor('STUDENT', studentProfileId)).toEqual(['Algebra notes', 'Report card']);
  });

  it('a teacher still sees what they authored', async () => {
    expect(await titlesFor('TEACHER', teacherId)).toEqual(['Algebra notes']);
  });

  it('a parent with no linked child sees nothing role-tagged for them', async () => {
    expect(await titlesFor('PARENT')).toEqual([]);
  });

  it('the roles with no materials permission are refused at the route', () => {
    for (const roleKey of ['FINANCE', 'LIBRARIAN', 'WARDEN']) {
      expect(canReach(roleKey, 'materials.read'), roleKey).toBe(false);
    }
  });
});

describe('6 & 7. viewing does not imply modifying', () => {
  it('the read and write routes are guarded by different permissions', () => {
    // Students and parents may view material and hold nothing that edits it.
    for (const roleKey of ['STUDENT', 'PARENT']) {
      expect(canReach(roleKey, 'materials.read'), roleKey).toBe(true);
      expect(canReach(roleKey, 'materials.manage'), roleKey).toBe(false);
    }
  });

  it('widening the view granted no new write permission to anyone', () => {
    // materials.manage is untouched by this change: the same three roles hold
    // it at ALL and a teacher at OWN, exactly as before.
    const manage = Object.fromEntries(
      ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL', 'TEACHER', 'STUDENT', 'PARENT']
        .map((r) => [r, permsOf(r)['materials.manage'] ?? null]),
    );
    expect(manage).toEqual({
      SUPER_ADMIN: 'ALL', ADMIN: 'ALL', PRINCIPAL: 'ALL',
      TEACHER: 'OWN', STUDENT: null, PARENT: null,
    });
  });
});

describe('deleting material follows the manage grant, not a role name', () => {
  /** Invokes the controller the way the route does. */
  const runDelete = async (roleKey, profileId, id) => {
    const req = {
      params: { id }, actor: actorFor(roleKey, profileId), scope: permsOf(roleKey)['materials.manage'],
    };
    let payload;
    const res = { status: () => res, json: (b) => { payload = b; return res; } };
    await deleteDocument(req, res, (err) => { if (err) throw err; });
    return payload;
  };

  const seedMaterial = () => Document.create({
    title: 'Deletable notes', type: 'CUSTOM', fileUrl: '/uploads/d.pdf',
    visibleToRoles: ['STUDENT'], sectionId: ownSection._id, authorProfileId: teacherId,
  });

  it.each(['ADMIN', 'PRINCIPAL', 'SUPER_ADMIN'])(
    '%s may delete, holding materials.manage school-wide', async (roleKey) => {
      const doc = await inOak(seedMaterial);
      expect(permsOf(roleKey)['materials.manage']).toBe('ALL');
      await inOak(() => runDelete(roleKey, undefined, doc._id.toString()));
      expect(await inOak(() => Document.findById(doc._id).lean())).toBeNull();
    });

  it('the author may delete their own', async () => {
    const doc = await inOak(seedMaterial);
    await inOak(() => runDelete('TEACHER', teacherId, doc._id.toString()));
    expect(await inOak(() => Document.findById(doc._id).lean())).toBeNull();
  });

  it('another teacher may not delete it', async () => {
    const doc = await inOak(seedMaterial);
    await expect(
      inOak(() => runDelete('TEACHER', new mongoose.Types.ObjectId(), doc._id.toString())),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await inOak(() => Document.findById(doc._id).lean())).not.toBeNull();
  });

  it('another school material is not reachable to delete', async () => {
    await expect(
      inOak(() => runDelete('ADMIN', undefined, nvmpMaterial._id.toString())),
    ).rejects.toThrow('Document not found');
    expect(await inNvmp(() => Document.findById(nvmpMaterial._id).lean())).not.toBeNull();
  });
});

describe('the categories can be filtered on', () => {
  const listFiltered = (filters) => inOak(async () => rowsOf(
    await documents.listForActor(actorFor('ADMIN'), 'ALL', undefined, filters),
  ));

  it('by document type', async () => {
    expect((await listFiltered({ type: 'CUSTOM' })).map((d) => d.title)).toEqual(['Algebra notes']);
    expect((await listFiltered({ type: 'REPORT_CARD' })).map((d) => d.title)).toEqual(['Report card']);
  });

  it('by class', async () => {
    const rows = await listFiltered({ sectionId: ownSection._id.toString() });
    expect(rows.map((d) => d.title)).toEqual(['Algebra notes']);
  });

  it('a filter narrows but never widens what a role may see', async () => {
    // A student asking for every type still gets only what is published to them.
    const rows = await inOak(async () => rowsOf(
      await documents.listForActor(actorFor('STUDENT', studentProfileId), 'OWN', undefined, { type: 'CUSTOM' }),
    ));
    expect(rows.map((d) => d.title)).toEqual(['Algebra notes']);
  });
});
