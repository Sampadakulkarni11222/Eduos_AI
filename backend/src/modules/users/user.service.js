import { Account } from '../../models/account.model.js';
import { Profile } from '../../models/profile.model.js';
import { Role } from '../../models/role.model.js';
import { Student, Enrollment } from '../../models/student.model.js';
import { AcademicYear, Section } from '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import { tenantFilter } from '../../tenancy/tenantContext.js';
import { register } from '../auth/auth.service.js';
import { enroll } from '../students/student.service.js';

/**
 * List all accounts with their linked profiles.
 * Returns a flat structure the admin user-management table can render.
 */
/** Escapes a user-supplied string so it is matched literally inside a $regex. */
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Grades are stored as "Class 5", but nothing forces a CSV author to know
 * that — "Grade 5", "Std 5" and "5" all mean the same thing to a human. This
 * strips the common prefix words so any of those spellings resolve to the
 * same grade instead of silently matching nothing (which is what every "No
 * section found" bulk-upload failure turned out to be).
 */
function normalizeGradeName(name) {
  return String(name ?? '')
    .trim()
    .replace(/^(class|grade|std\.?|standard)\s*/i, '')
    .trim()
    .toLowerCase();
}

/**
 * Lists user accounts with their profiles.
 *
 * Paging happens on the Account query itself (skip/limit), and the role and
 * class filters are resolved to account ids *before* it — so the profile,
 * student and enrollment joins only ever run for the accounts on the page.
 * The previous version loaded all ~1500 accounts plus every related document
 * and sliced in memory, which cost 1.4–2.7s per page request.
 */
export async function listUsers({ search, status, roleKey, sectionId, page, pageSize } = {}) {
  // Accounts are platform-wide (one phone, possibly profiles in two schools),
  // so the visible population is not "all accounts" but "accounts holding a
  // profile in the acting school". Without this a School Admin pages through
  // every other school's staff and families. Unscoped callers (platform Super
  // Admin, seeds) get `{}` back and the query is unchanged.
  const scope = tenantFilter();
  const accountFilter = {};
  if (status) accountFilter.status = status;

  if (scope.tenantId) {
    const inSchool = await Profile.distinct('accountId', { ...scope, deletedAt: null });
    accountFilter.$and = [...(accountFilter.$and ?? []), { _id: { $in: inSchool } }];
  }
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    // The admin table's search box is labelled "search by name", so the
    // display name on the linked profiles has to match too — it lives on
    // Profile, not Account, and so is resolved to account IDs first.
    const named = await Profile.find({ ...scope, displayName: rx, deletedAt: null }).select('accountId');
    accountFilter.$or = [
      { email: rx },
      { phoneE164: rx },
      ...(named.length ? [{ _id: { $in: named.map((p) => p.accountId) } }] : []),
    ];
  }

  // Role filter -> the accounts holding a profile with that role.
  if (roleKey) {
    const role = await Role.findOne({ key: String(roleKey).toUpperCase() }).select('_id').lean();
    const roleProfiles = role
      ? await Profile.find({ ...scope, roleId: role._id, deletedAt: null }).select('accountId').lean()
      : [];
    accountFilter.$and = [
      ...(accountFilter.$and ?? []),
      { _id: { $in: roleProfiles.map((p) => p.accountId) } },
    ];
  }

  // Class filter -> students enrolled in that section -> their accounts.
  if (sectionId) {
    const enrs = await Enrollment.find({ sectionId, status: 'ACTIVE' }).select('studentId').lean();
    const studentsInSection = await Student.find({
      _id: { $in: enrs.map((e) => e.studentId) }, deletedAt: null,
    }).select('profileId').lean();
    const sectionProfiles = await Profile.find({
      ...scope,
      _id: { $in: studentsInSection.map((s) => s.profileId).filter(Boolean) },
    }).select('accountId').lean();
    accountFilter.$and = [
      ...(accountFilter.$and ?? []),
      { _id: { $in: sectionProfiles.map((p) => p.accountId) } },
    ];
  }

  const requestedSize = parseInt(pageSize, 10);
  const size = Number.isFinite(requestedSize) && requestedSize > 0 ? Math.min(requestedSize, 200) : 0;
  const total = size > 0 ? await Account.countDocuments(accountFilter) : 0;
  const totalPages = size > 0 ? Math.max(Math.ceil(total / size), 1) : 1;
  const pageNo = size > 0 ? Math.min(Math.max(parseInt(page, 10) || 1, 1), totalPages) : 1;

  // _id tiebreak keeps paging deterministic when accounts share createdAt.
  let accountQuery = Account.find(accountFilter).sort({ createdAt: -1, _id: -1 });
  if (size > 0) accountQuery = accountQuery.skip((pageNo - 1) * size).limit(size);
  const accounts = await accountQuery.lean();
  const accountIds = accounts.map((a) => a._id);

  // A shared account's profile in another school must not be listed either.
  const profileFilter = { ...scope, accountId: { $in: accountIds }, deletedAt: null };
  const profiles = await Profile.find(profileFilter)
    .populate('roleId', 'key name')
    .lean();

  // Bulk fetch Student/Enrollment details for any STUDENT profiles in the list
  const studentProfileIds = profiles
    .filter((p) => p.roleId?.key === 'STUDENT')
    .map((p) => p._id);

  const students = await Student.find({ profileId: { $in: studentProfileIds }, deletedAt: null }).lean();
  const studentIds = students.map((s) => s._id);

  const enrollments = await Enrollment.find({ studentId: { $in: studentIds }, status: 'ACTIVE' })
    .populate({
      path: 'sectionId',
      populate: { path: 'gradeId' }
    })
    .lean();

  const enrollmentMapByStudent = new Map(enrollments.map((e) => [e.studentId.toString(), e]));
  const studentMapByProfile = new Map(students.map((s) => {
    const e = enrollmentMapByStudent.get(s._id.toString());
    const classDetails = e && e.sectionId
      ? `${e.sectionId.gradeId?.name ?? ''} ${e.sectionId.name}`.trim()
      : null;
    return [
      s.profileId.toString(),
      {
        class: classDetails,
        admissionNo: s.admissionNo,
        rollNo: e?.rollNo ?? null,
        sectionId: e?.sectionId?._id?.toString() ?? null,
      }
    ];
  }));

  // Group profiles by accountId
  const profilesByAccount = {};
  for (const p of profiles) {
    const key = p.accountId.toString();
    if (!profilesByAccount[key]) profilesByAccount[key] = [];
    const details = studentMapByProfile.get(p._id.toString()) ?? null;
    profilesByAccount[key].push({
      profileId: p._id,
      displayName: p.displayName,
      avatarUrl: p.avatarUrl,
      status: p.status,
      role: p.roleId?.key ?? null,
      roleKey: p.roleId?.key ?? null,
      roleName: p.roleId?.name ?? null,
      createdAt: p.createdAt,
      studentDetails: details,
    });
  }

  let users = accounts.map((acc) => {
    const accountProfiles = profilesByAccount[acc._id.toString()] ?? [];
    const primaryProfile = accountProfiles[0] ?? null;
    return {
      id: acc._id.toString(),
      accountId: acc._id,
      phone: acc.phoneE164,
      email: acc.email,
      status: acc.status,
      createdAt: acc.createdAt,
      profiles: accountProfiles,
      // convenience fields — use the first (primary) profile
      displayName: primaryProfile?.displayName ?? null,
      role: primaryProfile?.role ?? null,
      roleKey: primaryProfile?.roleKey ?? null,
      roleName: primaryProfile?.roleName ?? null,
      studentDetails: primaryProfile?.studentDetails ?? null,
    };
  });

  // The role and class filters were applied to the Account query above, so
  // nothing is filtered out here any more — that is what lets the page be
  // fetched with skip/limit instead of slicing a fully-materialised list.
  if (size > 0) {
    return { items: users, total, page: pageNo, pageSize: size, totalPages };
  }

  return users;
}

export async function getUserById(id) {
  const account = await Account.findById(id).lean();
  if (!account) throw new AppError('User not found', 404);

  // Only the profiles this school owns. A shared account (one phone, a profile
  // in two schools) is legitimately reachable by both, but each School Admin
  // sees only its own side of it.
  const scope = tenantFilter();
  const profiles = await Profile.find({ ...scope, accountId: id, deletedAt: null })
    .populate('roleId', 'key name')
    .lean();

  // Guessing an account id from another school must not read back its phone
  // and email. Same 404 as a non-existent id, so the response cannot be used
  // to probe which ids exist on the platform.
  if (scope.tenantId && profiles.length === 0) throw new AppError('User not found', 404);

  const studentProfileIds = profiles
    .filter((p) => p.roleId?.key === 'STUDENT')
    .map((p) => p._id);

  const students = await Student.find({ profileId: { $in: studentProfileIds }, deletedAt: null }).lean();
  const studentIds = students.map((s) => s._id);

  const enrollments = await Enrollment.find({ studentId: { $in: studentIds }, status: 'ACTIVE' })
    .populate({
      path: 'sectionId',
      populate: { path: 'gradeId' }
    })
    .lean();

  const enrollmentMapByStudent = new Map(enrollments.map((e) => [e.studentId.toString(), e]));
  const studentMapByProfile = new Map(students.map((s) => {
    const e = enrollmentMapByStudent.get(s._id.toString());
    const classDetails = e && e.sectionId
      ? `${e.sectionId.gradeId?.name ?? ''} ${e.sectionId.name}`.trim()
      : null;
    return [
      s.profileId.toString(),
      {
        class: classDetails,
        admissionNo: s.admissionNo,
        rollNo: e?.rollNo ?? null,
      }
    ];
  }));

  const primaryProfile = profiles[0];
  const primaryRole = primaryProfile?.roleId?.key ?? null;
  const primaryStudentDetails = primaryProfile ? studentMapByProfile.get(primaryProfile._id.toString()) : null;

  return {
    id: account._id.toString(),
    accountId: account._id,
    phone: account.phoneE164,
    email: account.email,
    status: account.status,
    createdAt: account.createdAt,
    displayName: primaryProfile?.displayName ?? null,
    role: primaryRole,
    roleKey: primaryRole,
    roleName: primaryProfile?.roleId?.name ?? null,
    studentDetails: primaryStudentDetails,
    profiles: profiles.map((p) => {
      const details = studentMapByProfile.get(p._id.toString()) ?? null;
      return {
        profileId: p._id.toString(),
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        status: p.status,
        role: p.roleId?.key ?? null,
        roleKey: p.roleId?.key ?? null,
        roleName: p.roleId?.name ?? null,
        studentDetails: details,
      };
    }),
  };
}

const VALID_ROLE_KEYS = new Set(['ADMIN', 'PRINCIPAL', 'TEACHER', 'PARENT', 'STUDENT', 'FINANCE', 'LIBRARIAN', 'WARDEN']);
const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createUser(data) {
  const { roleKey, displayName, phone, email, password, admissionNo, sectionId } = data;
  if (!roleKey || !displayName || !phone) {
    throw new AppError('roleKey, displayName and phone are required', 400);
  }

  // Field-level validation at the service boundary: the form only marks these
  // `required`, so a direct API call could previously create an account with a
  // one-character name, a non-E.164 phone or a malformed email.
  const name = String(displayName).trim();
  if (name.length < 2 || name.length > 120) {
    throw new AppError('displayName must be between 2 and 120 characters', 400);
  }
  if (!VALID_ROLE_KEYS.has(String(roleKey).toUpperCase())) {
    throw new AppError(`Invalid roleKey "${roleKey}"`, 400);
  }
  if (!E164.test(String(phone).trim())) {
    throw new AppError('phone must be in E.164 format, e.g. +919876543210', 400);
  }
  if (email && !EMAIL_RE.test(String(email).trim())) {
    throw new AppError('email is not a valid email address', 400);
  }
  if (password && String(password).length < 6) {
    throw new AppError('password must be at least 6 characters', 400);
  }

  const { account, profile } = await register({
    name: displayName,
    phone,
    email,
    password,
    roleKey: roleKey.toUpperCase(),
  });

  if (roleKey.toUpperCase() === 'STUDENT') {
    const names = displayName.trim().split(/\s+/);
    const firstName = names[0];
    const lastName = names.slice(1).join(' ') || '';
    const resolvedAdmissionNo = admissionNo || `ADM-${Date.now()}`;

    try {
      const student = await Student.create({
        admissionNo: resolvedAdmissionNo,
        firstName,
        lastName,
        profileId: profile._id,
      });

      if (sectionId) {
        const activeYear = await AcademicYear.findOne({ isCurrent: true });
        if (activeYear) {
          await enroll({
            studentId: student._id.toString(),
            sectionId,
            academicYearId: activeYear._id.toString(),
          });
        }
      }
    } catch (studentErr) {
      // Clean up the created profile if student creation fails (e.g. duplicate admissionNo)
      await Profile.deleteOne({ _id: profile._id });
      throw studentErr;
    }
  }

  return getUserById(account._id);
}

/**
 * Bulk-creates users from parsed CSV rows. Each row is processed through the
 * same createUser() path (so duplicate-phone/email, section validation, etc.
 * all behave identically to the single-user form) — errors from one row
 * don't stop the rest of the batch.
 */
export async function bulkCreateUsers(rows) {
  const results = { imported: 0, failed: 0, errors: [] };

  // Sections aren't globally unique by name alone, so a STUDENT row's
  // "gradeName + sectionName" needs both resolved together. Pre-fetched once
  // for the whole batch rather than re-queried per row.
  const sections = await Section.find().populate('gradeId').lean();
  const sectionMap = new Map(
    sections.map((s) => [`${normalizeGradeName(s.gradeId?.name)}|${s.name.toLowerCase()}`, s._id.toString()]),
  );
  const knownGradeNames = [...new Set(sections.map((s) => s.gradeId?.name).filter(Boolean))].sort();

  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2; // header is row 1
    const row = rows[i];
    const roleKey = row.rolekey?.trim().toUpperCase();
    const displayName = row.displayname?.trim();
    const phone = row.phone?.trim();
    const email = row.email?.trim() || undefined;
    const password = row.password?.trim() || undefined;
    const admissionNo = row.admissionno?.trim() || undefined;
    const gradeName = row.gradename?.trim();
    const sectionName = row.sectionname?.trim();

    if (!roleKey || !displayName || !phone) {
      results.failed++;
      results.errors.push({ row: rowNo, error: 'roleKey, displayName, and phone are required' });
      continue;
    }

    let sectionId;
    if (roleKey === 'STUDENT' && gradeName && sectionName) {
      sectionId = sectionMap.get(`${normalizeGradeName(gradeName)}|${sectionName.toLowerCase()}`);
      if (!sectionId) {
        results.failed++;
        results.errors.push({
          row: rowNo,
          error: `No section "${sectionName}" found in grade "${gradeName}". Known grades: ${knownGradeNames.join(', ') || 'none'}`,
        });
        continue;
      }
    }

    try {
      await createUser({ roleKey, displayName, phone, email, password, admissionNo, sectionId });
      results.imported++;
    } catch (err) {
      results.failed++;
      results.errors.push({ row: rowNo, error: err.message });
    }
  }

  return results;
}

export async function updateUser(id, { status }) {
  const account = await Account.findById(id);
  if (!account) throw new AppError('User not found', 404);

  // Read-side isolation is not enough: suspending an account is a platform-wide
  // act, so a School Admin may only do it to an account its own school holds a
  // profile for. getUserById throws the 404 when it does not.
  await getUserById(id);

  if (status) account.status = status;
  await account.save();
  return getUserById(id);
}
