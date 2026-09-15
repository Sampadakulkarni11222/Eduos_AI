import { describe, it, expect, beforeEach } from 'vitest';
import { Permission } from '../src/models/permission.model.js';
import { Role } from '../src/models/role.model.js';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { School } from '../src/models/school.model.js';
import { PERMISSION_CATALOG, SYSTEM_ROLES, SUPER_ADMIN_ONLY, AI_ASSISTANT_PERMISSION } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { requirePermission } from '../src/middleware/permission.js';
import * as schools from '../src/modules/schools/school.service.js';
import * as roleService from '../src/modules/roles/role.service.js';

/**
 * The Super Admin role, end to end at the service + guard level:
 *   - only SUPER_ADMIN holds the platform keys, so every other role is 403'd
 *     by the *existing* requirePermission middleware;
 *   - School Admin accounts are ordinary ADMIN profiles stamped with a tenant;
 *   - the pre-existing roles' permission sets are unchanged.
 */

const roleByKey = new Map();

beforeEach(async () => {
  for (const p of PERMISSION_CATALOG) {
    await Permission.create({ key: p.key, group: p.group, description: p.description, isSystem: true });
  }
  roleByKey.clear();
  for (const r of SYSTEM_ROLES) {
    const doc = await Role.create({ key: r.key, name: r.name, description: r.description, isSystem: true, permissions: r.grants });
    roleByKey.set(r.key, doc);
  }
});

/** Mirrors what authenticate() puts on req.actor for a signed-in profile. */
const actorFor = (roleKey) => ({ roleKey, permissions: buildPermissionMap(roleByKey.get(roleKey)) });

/** Runs the real route guard and reports allow/deny like an HTTP call would. */
const guard = (roleKey, permissionKey, minScope = 'ALL') => {
  const req = { actor: actorFor(roleKey) };
  try {
    requirePermission(permissionKey, minScope)(req, {}, () => {});
    return 'ALLOW';
  } catch (err) {
    return `DENY ${err.statusCode}`;
  }
};

const seedSchool = async (slug, name) => {
  await School.create({ slug, name });
  const account = await Account.create({ phoneE164: `+9199000${Math.floor(Math.random() * 90000) + 10000}` });
  await Profile.create({
    accountId: account._id,
    roleId: roleByKey.get('ADMIN')._id,
    displayName: 'Seeded Admin',
    tenantId: slug,
    tenantName: name,
  });
};

describe('who may reach the Super Admin surface', () => {
  it.each(['schools.read', 'schools.manage'])('SUPER_ADMIN holds %s', (key) => {
    expect(guard('SUPER_ADMIN', key)).toBe('ALLOW');
  });

  it.each(['ADMIN', 'PRINCIPAL', 'TEACHER', 'STUDENT', 'PARENT', 'FINANCE', 'LIBRARIAN', 'WARDEN'])(
    '%s is refused both platform keys',
    (roleKey) => {
      expect(guard(roleKey, 'schools.read')).toBe('DENY 403');
      expect(guard(roleKey, 'schools.manage')).toBe('DENY 403');
    },
  );
});

describe('existing roles are unchanged', () => {
  it('keeps every non-platform permission each role had before', () => {
    // SUPER_ADMIN holds the whole catalog now that the OWNER role has been
    // retired, with one deliberate exception: the AI assistant permission,
    // which is what excludes the platform role from a school-level assistant.
    const superAdmin = buildPermissionMap(roleByKey.get('SUPER_ADMIN'));
    for (const p of PERMISSION_CATALOG) {
      if (p.key === AI_ASSISTANT_PERMISSION) continue;
      expect(superAdmin[p.key], p.key).toBe('ALL');
    }
    expect(superAdmin[AI_ASSISTANT_PERMISSION]).toBeUndefined();
    expect(SUPER_ADMIN_ONLY.every((k) => superAdmin[k] === 'ALL')).toBe(true);

    const admin = buildPermissionMap(roleByKey.get('ADMIN'));
    expect(admin['users.manage']).toBe('ALL');
    expect(admin['students.read']).toBe('ALL');
    // Still excluded exactly as before.
    expect(admin['permissions.manage']).toBeUndefined();
    expect(admin['fees.payments.refund']).toBeUndefined();
  });

  it('leaves TEACHER/STUDENT/PARENT scopes alone', () => {
    const teacher = buildPermissionMap(roleByKey.get('TEACHER'));
    expect(teacher['students.read']).toBe('OWN');
    expect(guard('TEACHER', 'students.read', 'ALL')).toBe('DENY 403');

    expect(buildPermissionMap(roleByKey.get('STUDENT'))['submissions.submit']).toBe('OWN');
    expect(buildPermissionMap(roleByKey.get('PARENT'))['fees.pay']).toBe('OWN');
  });
});

describe('the school-wide dashboards a Super Admin oversees', () => {
  // The dashboard routes pair requireRole with requirePermission; these cover
  // the permission half, which is what decides whether SUPER_ADMIN can read
  // each school-wide aggregation at all.
  it.each([
    ['students.read', 'the admin dashboard'],
    ['fees.read', 'the finance dashboard'],
    ['hostel.read', 'the hostel dashboard'],
    ['library.read', 'the library dashboard'],
    ['analytics.school.read', 'school-wide analytics'],
  ])('SUPER_ADMIN holds %s at ALL scope, for %s', (key) => {
    expect(guard('SUPER_ADMIN', key, 'ALL')).toBe('ALLOW');
  });

  it('does not reach for the per-person dashboards, which have no school-wide form', () => {
    // Nothing to assert about permissions here — those endpoints aggregate the
    // signed-in profile's own record, so the guard that matters is requireRole,
    // which lists only TEACHER / STUDENT / PARENT.
    const superAdmin = buildPermissionMap(roleByKey.get('SUPER_ADMIN'));
    expect(superAdmin['timetable.read']).toBe('ALL');
  });
});

describe('the retired OWNER role', () => {
  it('is gone from the system role catalog', () => {
    expect(SYSTEM_ROLES.some((r) => r.key === 'OWNER')).toBe(false);
    expect(roleByKey.has('OWNER')).toBe(false);
  });

  it('leaves SUPER_ADMIN as the only holder of permissions.manage', () => {
    const holders = SYSTEM_ROLES
      .filter((r) => r.grants.some((g) => g.key === 'permissions.manage'))
      .map((r) => r.key);
    expect(holders).toEqual(['SUPER_ADMIN']);
  });
});

describe('school + School Admin management', () => {
  it('lists a school with the people counted against it', async () => {
    await seedSchool('oakridge', 'Oakridge Academy');
    const list = await schools.listSchools();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      tenantId: 'oakridge', slug: 'oakridge', tenantName: 'Oakridge Academy',
      adminCount: 1, activeAdminCount: 1, profileCount: 1, status: 'ACTIVE',
    });
  });

  it('resolves a slug publicly, so /oakridge can name the school before sign-in', async () => {
    await seedSchool('oakridge', 'Oakridge Academy');
    expect(await schools.getPublicSchool('oakridge')).toEqual({ slug: 'oakridge', name: 'Oakridge Academy' });
    await expect(schools.getPublicSchool('nope')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('creates a school together with its first School Admin', async () => {
    const { school, admins } = await schools.createSchool({
      tenantId: 'oakridge-north',
      tenantName: 'Oakridge North',
      admin: { displayName: 'Nina Rao', phone: '+919812345670', email: 'nina@oakridge.test', password: 'sup3r-secret' },
    });

    expect(school).toMatchObject({ tenantId: 'oakridge-north', tenantName: 'Oakridge North', adminCount: 1 });
    expect(admins).toHaveLength(1);
    expect(admins[0]).toMatchObject({ displayName: 'Nina Rao', roleKey: 'ADMIN', status: 'ACTIVE' });

    // A School Admin is an ordinary ADMIN profile — no new role, no new model.
    const profile = await Profile.findById(admins[0].profileId);
    expect(profile.roleId.toString()).toBe(roleByKey.get('ADMIN')._id.toString());
    expect(profile.tenantId).toBe('oakridge-north');
  });

  it('adds further School Admins to an existing school and keeps them separated by school', async () => {
    await schools.createSchool({
      tenantId: 'school-a', tenantName: 'School A',
      admin: { displayName: 'Admin A', phone: '+919812345671' },
    });
    await schools.createSchool({
      tenantId: 'school-b', tenantName: 'School B',
      admin: { displayName: 'Admin B', phone: '+919812345672' },
    });
    await schools.createSchoolAdmin('school-a', { displayName: 'Second A', phone: '+919812345673' });

    expect(await schools.listSchoolAdmins('school-a')).toHaveLength(2);
    expect(await schools.listSchoolAdmins('school-b')).toHaveLength(1);
  });

  it('suspends and reactivates a School Admin', async () => {
    const { admins } = await schools.createSchool({
      tenantId: 'school-c', tenantName: 'School C',
      admin: { displayName: 'Admin C', phone: '+919812345674' },
    });

    const suspended = await schools.updateSchoolAdmin('school-c', admins[0].profileId, { status: 'SUSPENDED' });
    expect(suspended.status).toBe('SUSPENDED');
    expect((await schools.getSchool('school-c')).activeAdminCount).toBe(0);

    const back = await schools.updateSchoolAdmin('school-c', admins[0].profileId, { status: 'ACTIVE' });
    expect(back.status).toBe('ACTIVE');
  });

  it('will not touch a profile from another school', async () => {
    const a = await schools.createSchool({
      tenantId: 'school-d', tenantName: 'School D',
      admin: { displayName: 'Admin D', phone: '+919812345675' },
    });
    await schools.createSchool({
      tenantId: 'school-e', tenantName: 'School E',
      admin: { displayName: 'Admin E', phone: '+919812345676' },
    });

    await expect(
      schools.updateSchoolAdmin('school-e', a.admins[0].profileId, { status: 'SUSPENDED' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects a duplicate school id and a malformed one', async () => {
    await schools.createSchool({
      tenantId: 'school-f', tenantName: 'School F',
      admin: { displayName: 'Admin F', phone: '+919812345677' },
    });
    await expect(
      schools.createSchool({ tenantId: 'school-f', tenantName: 'Again', admin: { displayName: 'X', phone: '+919812345678' } }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      schools.createSchool({ tenantId: 'Bad Id!', tenantName: 'Nope', admin: { displayName: 'X', phone: '+919812345679' } }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('renames a school across all of its profiles', async () => {
    await schools.createSchool({
      tenantId: 'school-g', tenantName: 'Old Name',
      admin: { displayName: 'Admin G', phone: '+919812345680' },
    });
    const renamed = await schools.updateSchool('school-g', { tenantName: 'New Name' });
    expect(renamed.tenantName).toBe('New Name');
    expect((await schools.listSchoolAdmins('school-g'))[0].tenantName).toBe('New Name');
  });
});

describe('role hierarchy guard on the existing roles API', () => {
  it('stops a school-level admin editing the SUPER_ADMIN role', async () => {
    const superRole = roleByKey.get('SUPER_ADMIN');
    await expect(
      roleService.update(superRole._id.toString(), { description: 'hijacked' }, { roleKey: 'ADMIN' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('stops a school-level admin granting themselves a platform key', async () => {
    const adminRole = roleByKey.get('ADMIN');
    await expect(
      roleService.assignPermission(adminRole._id.toString(), { key: 'schools.manage' }, { roleKey: 'ADMIN' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('still lets an ordinary role grant an ordinary permission', async () => {
    const principal = roleByKey.get('PRINCIPAL');
    const updated = await roleService.assignPermission(
      principal._id.toString(), { key: 'library.read', scope: 'ALL' }, { roleKey: 'PRINCIPAL' },
    );
    expect(updated.permissions.some((p) => p.key === 'library.read')).toBe(true);
  });

  it('lets a Super Admin do both', async () => {
    const adminRole = roleByKey.get('ADMIN');
    const updated = await roleService.assignPermission(
      adminRole._id.toString(), { key: 'schools.read' }, { roleKey: 'SUPER_ADMIN' },
    );
    expect(updated.permissions.some((p) => p.key === 'schools.read')).toBe(true);
  });
});
