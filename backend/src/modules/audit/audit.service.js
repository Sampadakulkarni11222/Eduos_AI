import { AuditLog } from '../../models/auditLog.model.js';
import { Profile } from '../../models/profile.model.js';
import { Role } from '../../models/role.model.js';
import { redact } from '../../middleware/auditLogger.js';
import { AppError } from '../../utils/AppError.js';
import { tenantFilter } from '../../tenancy/tenantContext.js';
import { SYSTEM_ROLES } from '../../constants/permissions.js';

/**
 * Reading the audit trail.
 *
 * Moved out of audit.controller.js, where every line of it used to live, so
 * the REST route and the assistant's list_audit_logs tool apply one set of
 * rules — which roles the default view covers, who may see import/export
 * entries, and what is redacted — instead of the tool having to copy them.
 */

const MAX_LIMIT = 200;

/**
 * The roles the primary view is about: everyone who acts for the school.
 *
 * The screen calls itself "a complete record of all administrative actions",
 * but it listed every actor — a student opening their timetable sat between
 * two staff actions, and the entries that matter were buried. So the default
 * is staff activity.
 *
 * It was pinned to TEACHER and ADMIN, which quietly excluded the rest of the
 * staff: a payment registered by Finance, a plan approved by the Principal, a
 * book written off by the Librarian, a room reassigned by the Warden — all
 * recorded, none of them shown unless the reader already knew to filter by
 * that role. Money actions being invisible by default is the worst case of it.
 *
 * Derived from the role catalogue, so a school that adds a staff role gets it
 * here without a code change. The two family roles are the only ones left
 * out, and `roleKey` still asks for them by name.
 */
const FAMILY_ROLES = new Set(['STUDENT', 'PARENT']);
export const PRIMARY_VIEW_ROLES = SYSTEM_ROLES.map((r) => r.key).filter((k) => !FAMILY_ROLES.has(k));

/**
 * Reading an import or export entry needs this permission on top of audit.read.
 *
 * A bulk action moves a whole roster in one step, and its audit row names the
 * file and the counts, so it is an administrator's concern rather than
 * something every audit.read holder should see. `users.manage` is the
 * permission the bulk endpoints themselves are guarded by — change this one
 * constant to move the boundary.
 */
export const IMPORT_EXPORT_PERMISSION = 'users.manage';

/** Matches the action names bulk import/export operations are recorded under. */
const IMPORT_EXPORT_ACTION = /\.(import|export)$/;

/** Resolves a role key to the profile ids holding it, inside the acting school. */
async function profileIdsForRole(roleKey) {
  const role = await Role.findOne({ key: String(roleKey).trim().toUpperCase() }).select('_id').lean();
  if (!role) return [];
  const profiles = await Profile.find({ ...tenantFilter(), roleId: role._id })
    .select('_id')
    .lean();
  return profiles.map((p) => p._id);
}

/** Parses a YYYY-MM month or YYYY year into a [start, end) range. */
function historicalRange({ month, year }) {
  if (month) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(month).trim());
    if (!m) throw new AppError('month must be in YYYY-MM format', 400, [], 'INVALID_MONTH');
    const start = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
    if (Number(m[2]) < 1 || Number(m[2]) > 12) {
      throw new AppError('month must be in YYYY-MM format', 400, [], 'INVALID_MONTH');
    }
    return { start, end: new Date(Date.UTC(Number(m[1]), Number(m[2]), 1)) };
  }
  if (year) {
    const y = /^(\d{4})$/.exec(String(year).trim());
    if (!y) throw new AppError('year must be in YYYY format', 400, [], 'INVALID_YEAR');
    return { start: new Date(Date.UTC(Number(y[1]), 0, 1)), end: new Date(Date.UTC(Number(y[1]) + 1, 0, 1)) };
  }
  return null;
}

/**
 * One page of the audit trail, newest first, as the caller may see it.
 *
 * @param {object} actor  The authenticated actor — decides import/export visibility.
 * @param {object} query  { cursor, action, roleKey, actorProfileId, from, to, month, year, limit }
 * @returns {{ items: object[], nextCursor?: string }}
 */
export async function listLogs(actor, query = {}) {
  const { cursor, action, roleKey, actorProfileId, from, to, month, year } = query;
  // `limit` was hardcoded at 20 and silently ignored the query parameter, so a
  // caller asking for more got 20 with no indication why.
  const requested = Number(query.limit);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_LIMIT) : 20;

  const filter = {};
  if (action) filter.action = action;

  // ── who acted ────────────────────────────────────────────────
  // An explicit user filter wins over the role filter; asking for both a
  // person and a role would otherwise silently drop one of them.
  if (actorProfileId) {
    filter.actorProfileId = actorProfileId;
  } else {
    const wanted = roleKey ? [roleKey] : PRIMARY_VIEW_ROLES;
    const ids = (await Promise.all(wanted.map(profileIdsForRole))).flat();
    // No profile holds the role in this school → no rows, rather than an
    // unfiltered list.
    filter.actorProfileId = { $in: ids };
  }

  // ── when ─────────────────────────────────────────────────────
  // month/year drive the historical view; from/to are the free-form range.
  const range = historicalRange({ month, year });
  const createdAt = {};
  if (range) {
    createdAt.$gte = range.start;
    createdAt.$lt = range.end;
  } else {
    if (from) createdAt.$gte = new Date(from);
    if (to) {
      // `to` names a calendar day: include everything up to the end of it.
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      createdAt.$lte = end;
    }
  }
  // The cursor pages backwards through whatever range is in force.
  if (cursor) createdAt.$lt = new Date(cursor);
  if (Object.keys(createdAt).length) filter.createdAt = createdAt;

  // ── what may be read ─────────────────────────────────────────
  const mayReadImportExport = Boolean(actor?.permissions?.[IMPORT_EXPORT_PERMISSION]);
  if (!mayReadImportExport) filter.action = { ...(action ? { $eq: action } : {}), $not: IMPORT_EXPORT_ACTION };

  const logs = await AuditLog.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate({ path: 'actorProfileId', select: 'displayName roleId', populate: { path: 'roleId', select: 'key' } })
    .lean();

  const nextCursor = logs.length === limit ? logs[logs.length - 1].createdAt.toISOString() : undefined;

  const items = logs.map((log) => ({
    id: log._id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    actorProfileId: log.actorProfileId?._id,
    actorName: log.actorProfileId?.displayName || 'System',
    // The previous populate asked Profile for a `roleKey` field it does not
    // have, so the actor's role was always missing — which is also why the view
    // could not be filtered by it.
    actorRole: log.actorProfileId?.roleId?.key ?? null,
    channel: log.channel || 'WEB',
    ip: log.ip || null,
    // The state change was being written and then dropped here, so every
    // consumer saw *that* something happened and never *what* changed — which
    // is the question an audit log exists to answer. Passed through the same
    // redactor the request logger uses, because these payloads can carry OTPs,
    // tokens and medical fields.
    before: log.before ? redact(log.before) : null,
    after: log.after ? redact(log.after) : null,
    createdAt: log.createdAt.toISOString(),
  }));

  return { items, nextCursor };
}
