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
function assertMayGovern(actor, { roleKey, permissionKey } = {}) {
  if (actor?.roleKey === SUPER_ADMIN_ROLE_KEY) return;
  if (roleKey === SUPER_ADMIN_ROLE_KEY) {
    throw new AppError('Only a Super Admin can modify the Super Admin role', 403, [], 'ROLE_NOT_PERMITTED');
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

export async function update(id, updates, actor) {
  const role = await getById(id);
  assertMayGovern(actor, { roleKey: role.key });
  if (role.isSystem && updates.key && updates.key.toUpperCase() !== role.key) {
    throw new AppError('System role keys cannot be renamed', 403);
  }
  Object.assign(role, updates);
  await role.save();
  return role;
}

export async function remove(id, actor) {
  const role = await getById(id);
  assertMayGovern(actor, { roleKey: role.key });
  if (role.isSystem) throw new AppError('System roles cannot be deleted', 403);
  await role.deleteOne();
}

export async function assignPermission(id, { key, scope = 'ALL' }, actor) {
  const role = await getById(id);
  const normalizedKey = key?.toLowerCase().trim();
  assertMayGovern(actor, { roleKey: role.key, permissionKey: normalizedKey });

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
  assertMayGovern(actor, { roleKey: role.key, permissionKey: key?.toLowerCase() });
  role.permissions = role.permissions.filter((p) => p.key !== key.toLowerCase());
  await role.save();
  return role;
}
