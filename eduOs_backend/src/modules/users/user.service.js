import { Account } from '../../models/account.model.js';
import { Profile } from '../../models/profile.model.js';
import { AppError } from '../../utils/AppError.js';

/**
 * List all accounts with their linked profiles.
 * Returns a flat structure the admin user-management table can render.
 */
export async function listUsers({ search, status, roleKey } = {}) {
  const accountFilter = {};
  if (status) accountFilter.status = status;
  if (search) {
    accountFilter.$or = [
      { email: { $regex: search, $options: 'i' } },
      { phoneE164: { $regex: search, $options: 'i' } },
    ];
  }

  const accounts = await Account.find(accountFilter).sort({ createdAt: -1 }).lean();
  const accountIds = accounts.map((a) => a._id);

  const profileFilter = { accountId: { $in: accountIds }, deletedAt: null };
  if (roleKey) {
    // filter by role later after population
  }

  const profiles = await Profile.find(profileFilter)
    .populate('roleId', 'key name')
    .lean();

  // Group profiles by accountId
  const profilesByAccount = {};
  for (const p of profiles) {
    const key = p.accountId.toString();
    if (!profilesByAccount[key]) profilesByAccount[key] = [];
    profilesByAccount[key].push({
      profileId: p._id,
      displayName: p.displayName,
      avatarUrl: p.avatarUrl,
      status: p.status,
      role: p.roleId?.key ?? null,
      roleName: p.roleId?.name ?? null,
      createdAt: p.createdAt,
    });
  }

  let users = accounts.map((acc) => ({
    accountId: acc._id,
    phone: acc.phoneE164,
    email: acc.email,
    status: acc.status,
    createdAt: acc.createdAt,
    profiles: profilesByAccount[acc._id.toString()] ?? [],
    // convenience fields — use the first (primary) profile
    displayName: (profilesByAccount[acc._id.toString()] ?? [])[0]?.displayName ?? null,
    role: (profilesByAccount[acc._id.toString()] ?? [])[0]?.role ?? null,
    roleName: (profilesByAccount[acc._id.toString()] ?? [])[0]?.roleName ?? null,
  }));

  // Apply optional roleKey filter post-population
  if (roleKey) {
    users = users.filter((u) => u.profiles.some((p) => p.role === roleKey.toUpperCase()));
  }

  return users;
}

export async function getUserById(id) {
  const account = await Account.findById(id).lean();
  if (!account) throw new AppError('User not found', 404);

  const profiles = await Profile.find({ accountId: id, deletedAt: null })
    .populate('roleId', 'key name')
    .lean();

  return {
    accountId: account._id,
    phone: account.phoneE164,
    email: account.email,
    status: account.status,
    createdAt: account.createdAt,
    profiles: profiles.map((p) => ({
      profileId: p._id,
      displayName: p.displayName,
      avatarUrl: p.avatarUrl,
      status: p.status,
      role: p.roleId?.key ?? null,
      roleName: p.roleId?.name ?? null,
    })),
  };
}

export async function updateUser(id, { status }) {
  const account = await Account.findById(id);
  if (!account) throw new AppError('User not found', 404);
  if (status) account.status = status;
  await account.save();
  return getUserById(id);
}
