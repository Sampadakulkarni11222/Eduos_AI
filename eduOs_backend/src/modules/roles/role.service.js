import { Role } from '../../models/role.model.js';
import { Permission } from '../../models/permission.model.js';
import { AppError } from '../../utils/AppError.js';

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

export async function update(id, updates) {
  const role = await getById(id);
  if (role.isSystem && updates.key && updates.key.toUpperCase() !== role.key) {
    throw new AppError('System role keys cannot be renamed', 403);
  }
  Object.assign(role, updates);
  await role.save();
  return role;
}

export async function remove(id) {
  const role = await getById(id);
  if (role.isSystem) throw new AppError('System roles cannot be deleted', 403);
  await role.deleteOne();
}

export async function assignPermission(id, { key, scope = 'ALL' }) {
  const role = await getById(id);
  const normalizedKey = key?.toLowerCase().trim();

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

export async function revokePermission(id, key) {
  const role = await getById(id);
  role.permissions = role.permissions.filter((p) => p.key !== key.toLowerCase());
  await role.save();
  return role;
}
