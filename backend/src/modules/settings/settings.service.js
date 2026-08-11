import { SchoolSettings } from '../../models/schoolSettings.model.js';
import { AcademicYear } from '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';

/**
 * Retrieve the settings document for the caller's tenant.
 * Upserts a default document on first read so there is always something to
 * display, even for tenants that haven't configured anything yet.
 */
export async function getSettings(actor) {
  const tenantId = actor.tenantId ?? 'eduos-demo-tenant';
  let settings = await SchoolSettings.findOne({ tenantId })
    .populate('currentAcademicYearId', 'name isCurrent')
    .lean();

  if (!settings) {
    settings = await SchoolSettings.create({ tenantId });
    settings = settings.toObject();
  }

  const academicYears = await AcademicYear.find().sort({ startsOn: -1 }).select('name isCurrent').lean();
  return { ...settings, academicYears };
}

/**
 * Persist updated settings. Only the fields explicitly passed are changed;
 * omitted fields are left as they are.
 */
export async function updateSettings(actor, updates) {
  const tenantId = actor.tenantId ?? 'eduos-demo-tenant';
  const allowed = ['schoolName', 'logoUrl', 'address', 'phone', 'email', 'website', 'currentAcademicYearId', 'timezone', 'currency'];
  const sanitized = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) sanitized[key] = updates[key];
  }

  if (!Object.keys(sanitized).length) throw new AppError('No valid fields to update', 400);

  const settings = await SchoolSettings.findOneAndUpdate(
    { tenantId },
    { $set: sanitized },
    { upsert: true, new: true }
  ).populate('currentAcademicYearId', 'name isCurrent');

  return settings;
}
