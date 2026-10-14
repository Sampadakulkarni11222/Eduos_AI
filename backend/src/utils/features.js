import { School } from '../models/school.model.js';
import { AppError } from './AppError.js';
import { currentTenantId } from '../tenancy/tenantContext.js';
import { FEATURES, FEATURE_KEYS, effectiveFeatures } from '../constants/features.js';

/**
 * A school's feature switches, read through a short cache (they change rarely
 * and are checked on every request to a switchable module).
 */
const cache = new Map();
const CACHE_MS = process.env.NODE_ENV === 'test' ? 0 : 30_000;

export async function featuresFor(tenantId = currentTenantId()) {
  if (!tenantId) return effectiveFeatures({});
  const hit = cache.get(tenantId);
  if (hit && hit.until > Date.now()) return hit.value;
  const school = await School.findOne({ slug: tenantId }).select('features').lean();
  const value = effectiveFeatures(school?.features ?? {});
  if (CACHE_MS) cache.set(tenantId, { value, until: Date.now() + CACHE_MS });
  return value;
}

export async function featureEnabled(key, tenantId = currentTenantId()) {
  return Boolean((await featuresFor(tenantId))[key]);
}

/** Refuses a request to a module the school has switched off (API, not only screen). */
export const requireFeature = (key) => async (req, _res, next) => {
  try {
    if (!FEATURES[key]) throw new Error(`Unknown feature ${key}`);
    if (!(await featureEnabled(key))) {
      throw new AppError(`${FEATURES[key].label} is switched off for this school.`, 403, [], 'FEATURE_OFF');
    }
    next();
  } catch (err) { next(err); }
};

/** For screens: every feature, whether it is on, and what it needs to work. */
export async function describeFeatures(tenantId = currentTenantId()) {
  const on = await featuresFor(tenantId);
  return FEATURE_KEYS.map((key) => ({ key, label: FEATURES[key].label, enabled: on[key], default: FEATURES[key].default, needs: FEATURES[key].needs ?? null }));
}

export async function setFeatures(changes = {}, tenantId = currentTenantId()) {
  if (!tenantId) throw new AppError('Choose a school first', 400);
  const school = await School.findOne({ slug: tenantId });
  if (!school) throw new AppError('School not found', 404);
  for (const [key, value] of Object.entries(changes)) {
    if (!FEATURES[key]) throw new AppError(`Unknown feature: ${key}`, 400, [], 'UNKNOWN_FEATURE');
    if (typeof value !== 'boolean') throw new AppError(`${key} must be true or false`, 400);
    school.features.set(key, value);
  }
  await school.save();
  cache.delete(tenantId);
  return describeFeatures(tenantId);
}
