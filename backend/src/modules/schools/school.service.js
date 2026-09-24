import { Account } from '../../models/account.model.js';
import { Profile } from '../../models/profile.model.js';
import { Role } from '../../models/role.model.js';
import { School } from '../../models/school.model.js';
import { AppError } from '../../utils/AppError.js';
import { runWithTenant } from '../../tenancy/tenantContext.js';
import { createUser } from '../users/user.service.js';
import { grantSeats, getSeatSummary } from '../seats/seat.service.js';
import { getTheme } from '../customization/customization.service.js';
import { SeatAccount, SeatLedgerEntry } from '../../models/seat.model.js';
import { detectProfileDomainChange } from '../domains/domain.service.js';
import { normalizeWebsite } from '../domains/domain.hostname.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * A School Admin's website as it will be stored: trimmed and as entered, or
 * null. Validated here, on the way in, by the same normaliser domain
 * management reads it with — so a profile can never hold a website the domain
 * configuration would have to refuse later.
 */
function websiteInput(value) {
  if (value === undefined) return undefined;
  if (value === null || (typeof value === 'string' && !value.trim())) return null;
  normalizeWebsite(value, { platformDomain: env.PLATFORM_DOMAIN });
  return value.trim();
}

/**
 * Lets domain management react to a website change. A failure here is logged
 * rather than thrown: the profile itself has been saved correctly, and the
 * domain screen recomputes the profile's domain on every read anyway.
 */
async function syncProfileDomain(actor, slug, previousWebsite) {
  try {
    return await detectProfileDomainChange(actor, slug, { previousWebsite });
  } catch (err) {
    logger.error(`Profile domain detection failed for ${slug}: ${err.message}`);
    return null;
  }
}

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
 * signed in, and now has to look like it too. Deliberately identity and
 * branding only — nothing about who is in the school, and nothing it has
 * configured beyond what every visitor to that address is meant to see.
 */
export async function getPublicSchool(slug) {
  const school = await findSchool(slug);
  if (school.status !== 'ACTIVE') throw new AppError('This school is not active', 403, [], 'SCHOOL_SUSPENDED');

  // The school's own branding, so its sign-in door looks like its portal does.
  // Deliberately the colours and the logo only — a door is the one place a
  // school is recognised before anyone has signed in, and none of this is
  // private: it is what every visitor to that address is meant to see. The
  // option lists and the audit fields stay behind authentication.
  const { branding, cssVariables } = await runWithTenant(school.slug, () => getTheme(school.slug));

  return {
    slug: school.slug,
    name: branding.displayName ?? school.name,
    logoUrl: branding.logoUrl,
    faviconUrl: branding.faviconUrl,
    tagline: branding.tagline,
    cssVariables,
  };
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
      website: p.website ?? null,
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
export async function createSchoolAdmin(slug, { displayName, phone, email, password, website }, actor = null) {
  const school = await findSchool(slug);
  // Refused before an account exists, so a bad website creates nobody.
  const nextWebsite = websiteInput(website);

  const user = await runWithTenant(school.slug, () =>
    createUser({ roleKey: SCHOOL_ADMIN_ROLE_KEY, displayName, phone, email, password }),
  );

  const adminRole = await schoolAdminRole();
  const profile = await Profile.findOne({ accountId: user.accountId, roleId: adminRole._id, deletedAt: null });
  if (!profile) throw new AppError('School Admin profile could not be created', 500);

  profile.tenantId = school.slug;
  profile.tenantName = school.name;
  if (nextWebsite) profile.website = nextWebsite;
  await profile.save();
  if (nextWebsite) await syncProfileDomain(actor, school.slug, null);

  return profile._id.toString();
}

/**
 * Registers a school and its first School Admin — who can then sign in to it.
 *
 * `seats` is the school's purchase: the base seats it has bought, sold and
 * released in one movement because the Super Admin performing this *is* the
 * person who would otherwise approve them. Extra seats bought later are not
 * like this — they go through payment and a separate approval, which is the
 * whole point of seats/seat.service.js.
 */
export async function createSchool({ tenantId, slug, tenantName, name, admin, seats }, actor = null) {
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

  // The school's purchase, if one was made with it. Optional: a deployment that
  // does not sell seats creates schools exactly as it did before, and a school
  // with no seat account is never seat-limited.
  const purchasedSeats = seats === undefined || seats === null || seats === '' ? null : Number(seats);
  if (purchasedSeats !== null && (!Number.isInteger(purchasedSeats) || purchasedSeats < 1)) {
    throw new AppError('seats must be a whole number greater than zero', 400, [], 'INVALID_SEAT_COUNT');
  }

  await School.create({ slug: id, name: displayName });

  try {
    // Before the first admin, so that admin occupies one of the purchased
    // seats rather than arriving before the school has any.
    if (purchasedSeats !== null) {
      await grantSeats(actor, id, { seats: purchasedSeats, note: 'Seats purchased with the school' });
    }
    await createSchoolAdmin(id, admin, actor);
  } catch (err) {
    // A school nobody can sign in to is worse than no school: undo it so the
    // operator can correct the details and try again.
    await School.deleteOne({ slug: id });
    // Along with the seats sold to it a moment ago: a balance belonging to a
    // school that no longer exists would be invisible and would come back to
    // life under the next school registered at the same address.
    await runWithTenant(id, async () => {
      await SeatAccount.deleteMany({ tenantId: id });
      await SeatLedgerEntry.deleteMany({ tenantId: id });
    });
    throw err;
  }

  return {
    school: await getSchool(id),
    admins: await listSchoolAdmins(id),
    seats: await runWithTenant(id, () => getSeatSummary()),
  };
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

export async function updateSchoolAdmin(slug, profileId, { status, displayName, website }, actor = null) {
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
  const nextWebsite = websiteInput(website);
  const previousWebsite = profile.website ?? null;
  const websiteChanged = nextWebsite !== undefined && nextWebsite !== previousWebsite;
  if (websiteChanged) profile.website = nextWebsite;
  // A status change moves the profile in or out of the set domain fetching
  // reads (active School Admins only), so it can change the domain too.
  const statusChanged = status !== undefined && profile.isModified('status');
  await profile.save();
  if (websiteChanged || statusChanged) await syncProfileDomain(actor, school.slug, previousWebsite);

  const admins = await listSchoolAdmins(school.slug);
  return admins.find((a) => a.profileId === profile._id.toString());
}
