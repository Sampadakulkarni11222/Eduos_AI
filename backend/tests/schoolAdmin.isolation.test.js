import { describe, it, expect, beforeEach } from 'vitest';
import { Permission } from '../src/models/permission.model.js';
import { Role } from '../src/models/role.model.js';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { School } from '../src/models/school.model.js';
import { Student } from '../src/models/student.model.js';
import { PERMISSION_CATALOG, SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { runWithTenant, runAcrossSchools, currentTenantId } from '../src/tenancy/tenantContext.js';
import { authenticate } from '../src/middleware/auth.js';
import { signAccessToken } from '../src/utils/jwt.js';
import * as users from '../src/modules/users/user.service.js';
import * as students from '../src/modules/students/student.service.js';

/**
 * School Admin data isolation.
 *
 * The plugin layer (tenancy.isolation.test.js) already proves a school-owned
 * collection cannot be read across schools. What is proved here is the layer
 * above it: that the *actor* is pinned to one school, and that the two
 * collections deliberately left unscoped — Account and Profile, which sign-in
 * has to see across schools — are still confined to the acting school on
 * every administrative path.
 */

const roleByKey = new Map();
const OAK = 'oakridge';
const NVMP = 'nvmp';

const inOak = (fn) => runWithTenant(OAK, fn);
const inNvmp = (fn) => runWithTenant(NVMP, fn);

/** An actor shaped the way authenticate() builds it, with real permissions. */
const actorFor = (roleKey) => ({
  roleKey,
  profileId: null,
  permissions: buildPermissionMap(roleByKey.get(roleKey)),
});

let nvmpAccountId;
let oakStudentId;
let nvmpStudentId;

beforeEach(async () => {
  for (const p of PERMISSION_CATALOG) {
    await Permission.create({ key: p.key, group: p.group, description: p.description, isSystem: true });
  }
  roleByKey.clear();
  for (const r of SYSTEM_ROLES) {
    const doc = await Role.create({
      key: r.key, name: r.name, description: r.description, isSystem: true, permissions: r.grants,
    });
    roleByKey.set(r.key, doc);
  }

  await School.create({ slug: OAK, name: 'Oakridge' });
  await School.create({ slug: NVMP, name: 'NVMP' });

  const mkUser = async (slug, phone, name, roleKey) => {
    const account = await Account.create({ phoneE164: phone });
    await Profile.create({
      accountId: account._id, roleId: roleByKey.get(roleKey)._id,
      displayName: name, tenantId: slug, tenantName: slug,
    });
    return account._id;
  };
  await mkUser(OAK, '+919810000001', 'Oak Teacher', 'TEACHER');
  nvmpAccountId = await mkUser(NVMP, '+919810000002', 'NVMP Teacher', 'TEACHER');

  oakStudentId = (await inOak(() =>
    Student.create({ admissionNo: 'A-1', firstName: 'Oak', lastName: 'Kid' }))
  )._id;
  nvmpStudentId = (await inNvmp(() =>
    Student.create({ admissionNo: 'A-1', firstName: 'Nvmp', lastName: 'Kid' }))
  )._id;
});

describe('1. School Admin A accessing School A data — ALLOWED', () => {
  it('lists the users of its own school', async () => {
    const list = await inOak(() => users.listUsers({}));
    expect(list.map((u) => u.displayName)).toEqual(['Oak Teacher']);
  });

  it('reads its own student', async () => {
    const student = await inOak(() =>
      students.getById(actorFor('ADMIN'), 'ALL', oakStudentId.toString(), { audit: false }));
    expect(student.firstName).toBe('Oak');
  });
});

describe('2. School Admin A accessing School B data — DENIED', () => {
  it('the user list excludes every other school', async () => {
    const list = await inOak(() => users.listUsers({}));
    expect(list.some((u) => u.displayName === 'NVMP Teacher')).toBe(false);
  });

  it('the search box cannot pull another school in by name', async () => {
    expect(await inOak(() => users.listUsers({ search: 'NVMP' }))).toHaveLength(0);
  });

  it('a role filter cannot pull another school in', async () => {
    const teachers = await inOak(() => users.listUsers({ roleKey: 'TEACHER' }));
    expect(teachers.map((u) => u.displayName)).toEqual(['Oak Teacher']);
  });

  it('an account id from another school 404s instead of returning its phone', async () => {
    await expect(
      inOak(() => users.getUserById(nvmpAccountId.toString())),
    ).rejects.toThrow('User not found');
  });

  it('a student id from another school 404s', async () => {
    await expect(
      inOak(() => students.getById(actorFor('ADMIN'), 'ALL', nvmpStudentId.toString(), { audit: false })),
    ).rejects.toThrow('Student not found');
  });
});

describe('3. School Admin A modifying School B data — DENIED', () => {
  it('cannot suspend an account belonging to another school', async () => {
    await expect(
      inOak(() => users.updateUser(nvmpAccountId.toString(), { status: 'SUSPENDED' })),
    ).rejects.toThrow('User not found');

    expect((await Account.findById(nvmpAccountId).lean()).status).toBe('ACTIVE');
  });

  it('a blanket update reaches only its own school', async () => {
    await inOak(() => Student.updateMany({}, { $set: { lastName: 'Renamed' } }));
    expect((await Student.findById(nvmpStudentId).lean()).lastName).toBe('Kid');
    expect((await Student.findById(oakStudentId).lean()).lastName).toBe('Renamed');
  });
});

describe('4. School Admin A exporting School B data — DENIED', () => {
  it('the ID-card export cannot render another school student', async () => {
    await expect(
      inOak(() => students.getIdCardData(actorFor('ADMIN'), 'ALL', nvmpStudentId.toString())),
    ).rejects.toThrow();
  });

  it('a paged export of the user table stops at the school boundary', async () => {
    const page = await inOak(() => users.listUsers({ page: 1, pageSize: 200 }));
    expect(page.total).toBe(1);
    expect(page.items.map((u) => u.displayName)).toEqual(['Oak Teacher']);
  });
});

describe('5. Super Admin accessing both schools — ALLOWED', () => {
  it('sees every school when acting at platform level', async () => {
    const all = await runAcrossSchools(() => users.listUsers({}));
    expect(all.map((u) => u.displayName).sort()).toEqual(['NVMP Teacher', 'Oak Teacher']);
  });

  it('sees exactly one school when it opens one', async () => {
    const list = await inNvmp(() => users.listUsers({}));
    expect(list.map((u) => u.displayName)).toEqual(['NVMP Teacher']);
  });
});

describe('6 & 7. existing roles keep the access they had', () => {
  /**
   * Drives the real middleware. `authenticate` is asyncHandler-wrapped, so a
   * rejection arrives as next(err) rather than a throw — which is exactly how
   * Express sees it. Reports the school the request was pinned to, or the
   * error that stopped it.
   */
  const authenticateAs = async (profile) => {
    const token = signAccessToken({
      accountId: profile.accountId.toString(),
      profileId: profile._id.toString(),
    });
    const req = {
      headers: { authorization: `Bearer ${token}` },
      query: {}, socket: {}, ip: '127.0.0.1',
    };
    let outcome;
    await authenticate(req, {}, (err) => {
      outcome = err ? { error: err } : { scopedTo: currentTenantId() };
    });
    return outcome;
  };

  it('a teacher still authenticates, pinned to their own school', async () => {
    const profile = await Profile.findOne({ tenantId: OAK, deletedAt: null });
    expect(await authenticateAs(profile)).toEqual({ scopedTo: OAK });
  });

  it('a student and a parent authenticate exactly as before', async () => {
    for (const [i, roleKey] of ['STUDENT', 'PARENT'].entries()) {
      const account = await Account.create({ phoneE164: `+91981110000${i}` });
      const profile = await Profile.create({
        accountId: account._id, roleId: roleByKey.get(roleKey)._id,
        displayName: roleKey, tenantId: OAK, tenantName: OAK,
      });
      expect(await authenticateAs(profile)).toEqual({ scopedTo: OAK });
    }
  });

  it('a profile with no school is refused rather than given the demo school', async () => {
    const account = await Account.create({ phoneE164: '+919811100099' });
    const profile = await Profile.create({
      accountId: account._id, roleId: roleByKey.get('ADMIN')._id,
      displayName: 'Orphan Admin', tenantId: '',
    });
    const { error } = await authenticateAs(profile);
    expect(error).toMatchObject({ statusCode: 403, code: 'NO_SCHOOL_ASSIGNED' });
  });
});
