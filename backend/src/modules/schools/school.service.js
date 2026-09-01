import { Account } from '../../models/account.model.js';
import { Profile } from '../../models/profile.model.js';
import { Role } from '../../models/role.model.js';
import { School } from '../../models/school.model.js';
import { AppError } from '../../utils/AppError.js';
import { runWithTenant } from '../../tenancy/tenantContext.js';
import { createUser } from '../users/user.service.js';

/**
 * Super Admin — schools and their School Admin accounts.
 *
 * A school is a `School` record whose `slug` is the tenant stamped on every
 * school-owned document and the first segment of the portal URL. A School
 * Admin is an ordinary ADMIN profile carrying that slug in `tenantId`: what an
 * admin can *do* is unchanged, but everything they see is now their own
 * school's.
 */

const SCHOOL_ADMIN_ROLE_KEY = 'ADMIN';
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

async function schoolAdminRole() {
  const role = await Role.findOne({ key: SCHOOL_ADMIN_ROLE_KEY }).select('_id key name').lean();
  if (!role) throw new AppError(`The ${SCHOOL_ADMIN_ROLE_KEY} role is missing from this deployment`, 500);
  return role;
}

/** Per-school profile and admin counts, in one pass over the profiles. */
async function peopleCounts() {
  const adminRole = await schoolAdminRole();
  const rows = await Profile.aggregate([
    { $match: { deletedAt: null } },
    {
      $group: {
        _id: '$tenantId',
        profileCount: { $sum: 1 },
        adminCount: { $sum: { $cond: [{ $eq: ['$roleId', adminRole._id] }, 1, 0] } },
        activeAdminCount: {
          $sum: {
            $cond: [{ $and: [{ $eq: ['$roleId', adminRole._id] }, { $eq: ['$status', 'ACTIVE'] }] }, 1, 0],
          },
        },
      },
    },
  ]);
  return new Map(rows.map((r) => [r._id, r]));
}

const toDto = (school, counts) => ({
  tenantId: school.slug,
  slug: school.slug,
  tenantName: school.name,
  status: school.status,
  profileCount: counts?.profileCount ?? 0,
  adminCount: counts?.adminCount ?? 0,
  activeAdminCount: counts?.activeAdminCount ?? 0,
  createdAt: school.createdAt ?? null,
});

export async function listSchools() {
  const [schools, counts] = await Promise.all([School.find().sort({ slug: 1 }).lean(), peopleCounts()]);
  return schools.map((s) => toDto(s, counts.get(s.slug)));
}

async function findSchool(slug) {
  const school = await School.findOne({ slug: String(slug ?? '').trim().toLowerCase() }).lean();
  if (!school) throw new AppError(`No school with id "${slug}"`, 404, [], 'SCHOOL_NOT_FOUND');
  return school;
}

export async function getSchool(slug) {
  const school = await findSchool(slug);
  const counts = await peopleCounts();
  return toDto(school, counts.get(school.slug));
}

/**
 * The public identity of a school, for the portal URL.
 *
 * Unauthenticated: `/oakridge/login` has to name the school before anyone has
 * signed in. Deliberately only the slug, display name and status — nothing
 * about who is in it.
 */
export async function getPublicSchool(slug) {
  const school = await findSchool(slug);
  if (school.status !== 'ACTIVE') throw new AppError('This school is not active', 403, [], 'SCHOOL_SUSPENDED');
  return { slug: school.slug, name: school.name };
}

export async function listSchoolAdmins(slug) {
  const school = await findSchool(slug);
  const adminRole = await schoolAdminRole();

  const profiles = await Profile.find({ tenantId: school.slug, roleId: adminRole._id, deletedAt: null })
    .sort({ createdAt: 1 })
    .lean();

  const accounts = await Account.find({ _id: { $in: profiles.map((p) => p.accountId) } })
    .select('phoneE164 email status')
    .lean();
  const accountById = new Map(accounts.map((a) => [a._id.toString(), a]));

  return profiles.map((p) => {
    const account = accountById.get(p.accountId.toString());
    return {
      profileId: p._id.toString(),
      accountId: p.accountId.toString(),
      displayName: p.displayName,
      roleKey: SCHOOL_ADMIN_ROLE_KEY,
      tenantId: p.tenantId,
      tenantName: p.tenantName,
      status: p.status,
      accountStatus: account?.status ?? null,
      phone: account?.phoneE164 ?? null,
      email: account?.email ?? null,
      createdAt: p.createdAt,
    };
  });
}

/**
 * Creates a School Admin and binds them to one school.
 *
 * Account creation goes through the same users.service.createUser() the Admin
 * console uses, so validation and duplicate handling are identical. It runs
 * inside the target school's tenant context, so anything it creates along the
 * way belongs to that school and not to whichever school the caller last
 * looked at.
 */
export async function createSchoolAdmin(slug, { displayName, phone, email, password }) {
  const school = await findSchool(slug);

  const user = await runWithTenant(school.slug, () =>
    createUser({ roleKey: SCHOOL_ADMIN_ROLE_KEY, displayName, phone, email, password }),
  );

  const adminRole = await schoolAdminRole();
  const profile = await Profile.findOne({ accountId: user.accountId, roleId: adminRole._id, deletedAt: null });
  if (!profile) throw new AppError('School Admin profile could not be created', 500);

  profile.tenantId = school.slug;
  profile.tenantName = school.name;
  await profile.save();

  return profile._id.toString();
}

/** Registers a school and its first School Admin — who can then sign in to it. */
export async function createSchool({ tenantId, slug, tenantName, name, admin }) {
  const id = String(slug ?? tenantId ?? '').trim().toLowerCase();
  const displayName = String(name ?? tenantName ?? '').trim();

  if (!SLUG_RE.test(id)) {
    throw new AppError('School id must be 2-64 lowercase letters, digits or hyphens', 400);
  }
  if (displayName.length < 2 || displayName.length > 120) {
    throw new AppError('School name must be between 2 and 120 characters', 400);
  }
  if (await School.exists({ slug: id })) {
    throw new AppError(`A school with id "${id}" already exists`, 409);
  }
  if (!admin?.displayName || !admin?.phone) {
    throw new AppError('A first School Admin (displayName, phone) is required to create a school', 400);
  }

  await School.create({ slug: id, name: displayName });

  try {
    await createSchoolAdmin(id, admin);
  } catch (err) {
    // A school nobody can sign in to is worse than no school: undo it so the
    // operator can correct the details and try again.
    await School.deleteOne({ slug: id });
    throw err;
  }

  return { school: await getSchool(id), admins: await listSchoolAdmins(id) };
}

export async function updateSchool(slug, { tenantName, name, status }) {
  const school = await findSchool(slug);
  const updates = {};

  const nextName = name ?? tenantName;
  if (nextName !== undefined) {
    const trimmed = String(nextName).trim();
    if (trimmed.length < 2 || trimmed.length > 120) {
      throw new AppError('School name must be between 2 and 120 characters', 400);
    }
    updates.name = trimmed;
  }
  if (status !== undefined) {
    if (!['ACTIVE', 'SUSPENDED'].includes(status)) {
      throw new AppError('status must be ACTIVE or SUSPENDED', 400);
    }
    updates.status = status;
  }
  if (!Object.keys(updates).length) throw new AppError('Nothing to update', 400);

  await School.updateOne({ slug: school.slug }, { $set: updates });
  // The name is denormalised onto profiles (it is what the portal sidebar
  // shows), so a rename has to reach them too.
  if (updates.name) {
    await Profile.updateMany({ tenantId: school.slug }, { $set: { tenantName: updates.name } });
  }
  return getSchool(school.slug);
}

const PROFILE_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'];

export async function updateSchoolAdmin(slug, profileId, { status, displayName }) {
  const school = await findSchool(slug);
  const adminRole = await schoolAdminRole();
  const profile = await Profile.findOne({
    _id: profileId, tenantId: school.slug, roleId: adminRole._id, deletedAt: null,
  });
  if (!profile) throw new AppError('School Admin not found for this school', 404);

  if (status !== undefined) {
    if (!PROFILE_STATUSES.includes(status)) {
      throw new AppError(`status must be one of ${PROFILE_STATUSES.join(', ')}`, 400);
    }
    profile.status = status;
  }
  if (displayName !== undefined) {
    const trimmed = String(displayName).trim();
    if (trimmed.length < 2 || trimmed.length > 120) {
      throw new AppError('displayName must be between 2 and 120 characters', 400);
    }
    profile.displayName = trimmed;
  }
  await profile.save();

  const admins = await listSchoolAdmins(school.slug);
  return admins.find((a) => a.profileId === profile._id.toString());
}
