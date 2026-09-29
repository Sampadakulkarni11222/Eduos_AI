import { Role } from '../../models/role.model.js';
import { Permission } from '../../models/permission.model.js';
import { SUPER_ADMIN_ONLY } from '../../constants/permissions.js';
import { AppError } from '../../utils/AppError.js';

export const SUPER_ADMIN_ROLE_KEY = 'SUPER_ADMIN';

/**
 * The role hierarchy guard.
 *
 * `roles.manage` lets a school-level admin edit role grants, which would
 * otherwise be a route to granting themselves the platform-level Super Admin
 * keys, or to stripping the Super Admin role. Only a Super Admin may touch the
 * SUPER_ADMIN role or the keys reserved for it; everything else behaves
 * exactly as it did before.
 */
function assertMayGovern(actor, { roleKey, isSystem = false, permissionKey } = {}) {
  if (actor?.roleKey === SUPER_ADMIN_ROLE_KEY) return;
  if (roleKey === SUPER_ADMIN_ROLE_KEY) {
    throw new AppError('Only a Super Admin can modify the Super Admin role', 403, [], 'ROLE_NOT_PERMITTED');
  }
  // Roles are not school-owned: every school's TEACHER is the same TEACHER
  // document. A school admin editing a system role was therefore editing it for
  // every school on the platform — revoking attendance.mark from all teachers,
  // or widening every parent to students.read ALL — so the shared roles are
  // governed by the platform, not by any one school.
  if (isSystem) {
    throw new AppError(
      'System roles are shared by every school on the platform; only a Super Admin can change them',
      403, [], 'ROLE_NOT_PERMITTED',
    );
  }
  if (permissionKey && SUPER_ADMIN_ONLY.includes(permissionKey)) {
    throw new AppError(`Only a Super Admin can grant or revoke ${permissionKey}`, 403, [], 'ROLE_NOT_PERMITTED');
  }
}

export const list = () => Role.find().sort({ key: 1 });

export async function getById(id) {
  const role = await Role.findById(id);
  if (!role) throw new AppError('Role not found', 404);
  return role;
}

export async function create({ key, name, description }) {
  const normalizedKey = key?.toUpperCase().trim();
  const exists = await Role.findOne({ key: normalizedKey });
  if (exists) throw new AppError(`Role '${normalizedKey}' already exists`, 409);
  return Role.create({ key: normalizedKey, name, description });
}

/**
 * What PATCH /roles/:id may change. Grants have their own guarded endpoints
 * (assignPermission / revokePermission); accepting a `permissions` array here
 * let any holder of roles.manage write platform-only keys straight past that
 * guard, and `isSystem` would un-protect a role from deletion.
 */
const ROLE_EDITABLE_FIELDS = ['key', 'name', 'description'];

export async function update(id, updates, actor) {
  const refused = Object.keys(updates ?? {}).filter((field) => !ROLE_EDITABLE_FIELDS.includes(field));
  if (refused.length) {
    throw new AppError(
      `These fields cannot be changed through a role update: ${refused.join(', ')}. ` +
        'Use the role permission endpoints to change grants.',
      400, refused, 'FIELD_NOT_EDITABLE',
    );
  }
  const role = await getById(id);
  assertMayGovern(actor, { roleKey: role.key, isSystem: role.isSystem });
  if (role.isSystem && updates.key && updates.key.toUpperCase() !== role.key) {
    throw new AppError('System role keys cannot be renamed', 403);
  }
  if (updates.key !== undefined) {
    const nextKey = String(updates.key).toUpperCase().trim();
    if (nextKey === SUPER_ADMIN_ROLE_KEY && role.key !== SUPER_ADMIN_ROLE_KEY) {
      throw new AppError('That role key is reserved', 403, [], 'ROLE_NOT_PERMITTED');
    }
    updates = { ...updates, key: nextKey };
  }
  Object.assign(role, updates);
  await role.save();
  return role;
}

export async function remove(id, actor) {
  const role = await getById(id);
  assertMayGovern(actor, { roleKey: role.key, isSystem: role.isSystem });
  if (role.isSystem) throw new AppError('System roles cannot be deleted', 403);
  await role.deleteOne();
}

export async function assignPermission(id, { key, scope = 'ALL' }, actor) {
  const role = await getById(id);
  const normalizedKey = key?.toLowerCase().trim();
  assertMayGovern(actor, { roleKey: role.key, isSystem: role.isSystem, permissionKey: normalizedKey });

  const permission = await Permission.findOne({ key: normalizedKey });
  if (!permission) throw new AppError(`Unknown permission key: ${key}`, 400);

  const existing = role.permissions.find((p) => p.key === permission.key);
  if (existing) {
    existing.scope = scope;
  } else {
    role.permissions.push({ key: permission.key, scope });
  }

  await role.save();
  return role;
}

export async function revokePermission(id, key, actor) {
  const role = await getById(id);
  assertMayGovern(actor, { roleKey: role.key, isSystem: role.isSystem, permissionKey: key?.toLowerCase() });
  role.permissions = role.permissions.filter((p) => p.key !== key.toLowerCase());
  await role.save();
  return role;
}
