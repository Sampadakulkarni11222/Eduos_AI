import { Permission } from '../../models/permission.model.js';
import { AppError } from '../../utils/AppError.js';

export const list = () => Permission.find().sort({ group: 1, key: 1 });

export async function getById(id) {
  const permission = await Permission.findById(id);
  if (!permission) throw new AppError('Permission not found', 404);
  return permission;
}

export async function create({ key, group, description }) {
  const normalizedKey = key?.toLowerCase().trim();
  const exists = await Permission.findOne({ key: normalizedKey });
  if (exists) throw new AppError(`Permission '${normalizedKey}' already exists`, 409);
  return Permission.create({ key: normalizedKey, group, description });
}

export async function update(id, updates) {
  const permission = await getById(id);
  if (permission.isSystem && updates.key && updates.key.toLowerCase() !== permission.key) {
    throw new AppError('System permission keys cannot be renamed', 403);
  }
  Object.assign(permission, updates);
  await permission.save();
  return permission;
}

export async function remove(id) {
  const permission = await getById(id);
  if (permission.isSystem) throw new AppError('System permissions cannot be deleted', 403);
  await permission.deleteOne();
}
