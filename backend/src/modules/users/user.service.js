import { Account } from '../../models/account.model.js';
import { Profile } from '../../models/profile.model.js';
import { Student, Enrollment } from '../../models/student.model.js';
import { AcademicYear, Section } from '../../models/academics.model.js';
import { RefreshToken } from '../../models/refreshToken.model.js';
import { AppError } from '../../utils/AppError.js';
import { register } from '../auth/auth.service.js';
import { enroll } from '../students/student.service.js';

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

export async function createUser(data) {
  const { roleKey, displayName, phone, email, password, admissionNo, sectionId } = data;
  if (!roleKey || !displayName || !phone) {
    throw new AppError('roleKey, displayName and phone are required', 400);
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
    sections.map((s) => [`${(s.gradeId?.name ?? '').toLowerCase()}|${s.name.toLowerCase()}`, s._id.toString()]),
  );

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
      sectionId = sectionMap.get(`${gradeName.toLowerCase()}|${sectionName.toLowerCase()}`);
      if (!sectionId) {
        results.failed++;
        results.errors.push({ row: rowNo, error: `No section "${sectionName}" found in grade "${gradeName}"` });
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

export async function updateUser(id, payload = {}) {
  const account = await Account.findById(id);
  if (!account) throw new AppError('User not found', 404);

  // Explicitly extract only allowed fields
  const { displayName, phone, phoneE164, email, status } = payload;

  const targetPhone = (phoneE164 || phone)?.trim();
  if (targetPhone && targetPhone !== account.phoneE164) {
    const existingPhone = await Account.findOne({
      phoneE164: targetPhone,
      _id: { $ne: account._id },
    });
    if (existingPhone) {
      throw new AppError('An account with this phone number already exists', 409);
    }
    account.phoneE164 = targetPhone;
  }

  if (email !== undefined) {
    const normalizedEmail = email ? email.trim().toLowerCase() : null;
    if (normalizedEmail && normalizedEmail !== account.email) {
      const existingEmail = await Account.findOne({
        email: normalizedEmail,
        _id: { $ne: account._id },
      });
      if (existingEmail) {
        throw new AppError('An account with this email address already exists', 409);
      }
      account.email = normalizedEmail;
    } else if (normalizedEmail === null || normalizedEmail === '') {
      account.email = undefined;
    }
  }

  if (status) {
    const validStatuses = ['ACTIVE', 'INACTIVE', 'SUSPENDED'];
    const uppercaseStatus = status.toString().toUpperCase();
    if (!validStatuses.includes(uppercaseStatus)) {
      throw new AppError(`Invalid status: ${status}. Must be ACTIVE, INACTIVE, or SUSPENDED`, 400);
    }
    account.status = uppercaseStatus;

    // Sync status to all active/non-deleted profiles linked to this account
    await Profile.updateMany(
      { accountId: account._id, deletedAt: null },
      { status: uppercaseStatus }
    );

    // If deactivating or suspending, revoke active refresh tokens to terminate sessions
    if (uppercaseStatus === 'INACTIVE' || uppercaseStatus === 'SUSPENDED') {
      await RefreshToken.updateMany(
        { accountId: account._id, revokedAt: null },
        { revokedAt: new Date() }
      );
    }
  }

  await account.save();

  if (displayName && displayName.trim()) {
    const cleanName = displayName.trim();

    // Update display name on all linked non-deleted profiles
    const profiles = await Profile.find({ accountId: account._id, deletedAt: null });
    for (const p of profiles) {
      p.displayName = cleanName;
      await p.save();
    }

    // Also sync Student record firstName and lastName if a student profile exists
    const profileIds = profiles.map((p) => p._id);
    const students = await Student.find({ profileId: { $in: profileIds }, deletedAt: null });
    for (const s of students) {
      const names = cleanName.split(/\s+/);
      s.firstName = names[0];
      s.lastName = names.slice(1).join(' ') || '';
      await s.save();
    }
  }

  return getUserById(id);
}
