import { AutomationSetting, AutomationRun } from '../../models/automation.model.js';
import { Profile } from '../../models/profile.model.js';
import { School } from '../../models/school.model.js';
import { buildPermissionMap } from '../../utils/buildPermissionMap.js';
import { featureEnabled } from '../../utils/features.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { tzOffsetMinutes, DEFAULT_TZ } from '../../utils/periods.js';
import { workingDaysBetween } from '../staff/staffLeave.service.js';
import { logger } from '../../utils/logger.js';
import { AUTOMATIONS, automationDef, QUIET_START, QUIET_END } from './automations.catalogue.js';

/**
 * What every automation shares: the school's clock, its settings, the quiet
 * window, a once-per-period claim, and acting AS the person a read is for.
 */

const DAY = 86_400_000;

/** The school's local wall clock for an instant. */
export function localClock(now = new Date(), tz = DEFAULT_TZ) {
  const shifted = new Date(now.getTime() + tzOffsetMinutes(now, tz) * 60_000);
  const ymd = shifted.toISOString().slice(0, 10);
  return { ymd, hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes(), dow: shifted.getUTCDay(), day: new Date(`${ymd}T00:00:00.000Z`) };
}

/** Inside the school-wide quiet window (21:00-07:00), when no automation sends. */
export function inQuietWindow(now = new Date()) {
  const { hour } = localClock(now);
  return hour >= QUIET_START || hour < QUIET_END;
}

/** A school's effective setting for one automation: its own choice over the default. */
export async function settingFor(key) {
  const def = automationDef(key);
  if (!def) return null;
  const row = await AutomationSetting.findOne({ key }).lean();
  return {
    key,
    enabled: typeof row?.enabled === 'boolean' ? row.enabled : def.defaultEnabled,
    hour: row?.hour ?? def.defaultHour,
    weekday: def.cadence === 'WEEKLY' ? (row?.weekday ?? def.defaultWeekday ?? 1) : null,
    audience: row?.audience?.length ? row.audience.filter((a) => def.audiences.includes(a)) : def.defaultAudience,
    customised: Boolean(row),
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function allSettings() {
  return Promise.all(AUTOMATIONS.map((def) => settingFor(def.key)));
}

/** Is today a school day (not Sunday, not a holiday)? */
export async function isSchoolDay(now = new Date()) {
  const { day } = localClock(now);
  return (await workingDaysBetween(day, day)).length === 1;
}

/**
 * Why an automation will not run right now, or null when it is due.
 * The period key says which run this is (a date, or a week).
 */
export async function dueCheck(key, now = new Date(), { force = false, hourOffset = 0 } = {}) {
  const def = automationDef(key);
  const setting = await settingFor(key);
  if (!def || !setting) return { skip: 'unknown automation' };
  if (!setting.enabled) return { skip: 'switched off', setting };
  if (def.feature && !(await featureEnabled(def.feature))) return { skip: `${def.feature} is switched off`, setting };
  const clock = localClock(now);
  const periodKey = def.cadence === 'WEEKLY' ? `${clock.ymd}:w` : clock.ymd;
  if (force) return { skip: null, setting, clock, periodKey };
  if (inQuietWindow(now)) return { skip: 'quiet hours', setting };
  if (clock.hour < setting.hour + hourOffset) return { skip: 'not yet time', setting };
  if (def.cadence === 'WEEKLY' && clock.dow !== setting.weekday) return { skip: 'not the day', setting };
  if (def.schoolDaysOnly && !(await isSchoolDay(now))) return { skip: 'not a school day', setting };
  return { skip: null, setting, clock, periodKey };
}

/**
 * Runs `fn` at most once per school per period for an automation. The claim
 * lives in AutomationRun (unique key), so two server processes cannot both run it;
 * a failed run releases its claim and is retried on the next tick.
 */
export async function runOnce(key, now, fn, { force = false, phase = null, hourOffset = 0 } = {}) {
  const check = await dueCheck(key, now, { force, hourOffset });
  if (check.skip) return { key, skipped: check.skip };
  const tenant = currentTenantId() ?? 'platform';
  // A forced run (a manager's "Run now") does not take the day's claim: it may
  // run again after the scheduled one, and still repeats nothing, because every
  // message, task and draft it makes carries its own idempotency key.
  const claimKey = `automation:${key}${phase ? `.${phase}` : ''}:${tenant}:${check.periodKey}${force ? `:manual:${now.getTime()}:${Math.random().toString(36).slice(2, 8)}` : ''}`;
  let claim;
  try {
    claim = await AutomationRun.create({ key: claimKey, automation: key, tenantId: tenant, startedAt: now, manual: force });
  } catch (err) {
    if (err?.code === 11000) return { key, ...(phase && { phase }), skipped: 'already ran' };
    throw err;
  }
  try {
    const result = await fn({ setting: check.setting, clock: check.clock, now });
    claim.ok = true; claim.result = result ?? null; claim.finishedAt = new Date();
    await claim.save();
    return { key, ...(phase && { phase }), ran: true, ...(result ?? {}) };
  } catch (err) {
    logger.error(`Automation ${key} failed for ${tenant}: ${err.message}`);
    await AutomationRun.deleteOne({ _id: claim._id });
    return { key, failed: String(err.message).slice(0, 300) };
  }
}

/** A person as an actor, exactly as sign-in builds one, so a read made for them is limited to what they may see. */
export async function actorFromProfile(profileId) {
  const profile = await Profile.findOne({ _id: profileId, status: 'ACTIVE', deletedAt: null }).populate('roleId').lean();
  if (!profile) return null;
  const tenantId = String(profile.tenantId ?? currentTenantId() ?? '') || null;
  const school = tenantId ? await School.findOne({ slug: tenantId }).select('name').lean() : null;
  return {
    profileId: String(profile._id), accountId: profile.accountId ? String(profile.accountId) : null,
    displayName: profile.displayName, roleId: profile.roleId?._id ? String(profile.roleId._id) : null,
    roleKey: profile.roleId?.key ?? null, permissions: buildPermissionMap(profile.roleId),
    tenantId, tenantName: school?.name ?? null,
  };
}

export const addDays = (d, n) => new Date(d.getTime() + n * DAY);
export const DAY_MS = DAY;
