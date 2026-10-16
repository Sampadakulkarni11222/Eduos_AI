import { SchoolPolicy } from '../../models/schoolPolicy.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';

/**
 * Single-approver mode (part 3, decision 3).
 *
 * The second-person rules (showcase review, fixture results, offline campaign
 * approval, bill payment verification) stay the default. A small school with
 * no second approver may switch this on; then, and only then, a PRINCIPAL or
 * ADMIN may approve a record they made themselves. Each such approval is
 * marked singleApprover: true on the record and written to the audit log.
 */
export const SINGLE_APPROVER_ROLES = ['PRINCIPAL', 'ADMIN'];

export async function getApproverMode() {
  const row = await SchoolPolicy.findOne({ key: 'default' }).lean();
  const m = row?.singleApproverMode ?? {};
  return {
    singleApproverMode: Boolean(m.enabled),
    changedBy: m.changedByName ?? null,
    changedAt: m.changedAt ?? null,
    reason: m.reason ?? null,
    appliesTo: ['Showcase review', 'Fixture results', 'Offline campaign approval', 'Bill payment verification'],
    roles: SINGLE_APPROVER_ROLES,
  };
}

export async function setApproverMode(actor, body = {}) {
  if (actor?.permissions?.['settings.manage'] !== 'ALL') throw new AppError('Changing single-approver mode needs settings.manage for the whole school.', 403);
  if (typeof body.enabled !== 'boolean') throw new AppError('enabled must be true or false', 400);
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  if (body.enabled && !reason) throw new AppError('Say why the school has no second approver.', 400, [], 'REASON_REQUIRED');
  const before = await getApproverMode();
  await SchoolPolicy.findOneAndUpdate(
    { key: 'default' },
    { $set: { singleApproverMode: { enabled: body.enabled, changedByProfileId: actor.profileId ?? null, changedByName: actor.displayName ?? null, changedAt: new Date(), reason: reason || null } } },
    { upsert: true },
  );
  await recordAudit({
    actor, action: body.enabled ? 'policy.single_approver.on' : 'policy.single_approver.off', entityType: 'SchoolPolicy', entityId: 'singleApproverMode',
    before: { enabled: before.singleApproverMode }, after: { enabled: body.enabled, reason: reason || null },
  });
  return getApproverMode();
}

/**
 * Asked where a second-person rule would refuse: true when the school is in
 * single-approver mode and the actor is a principal or administrator. The
 * caller then marks the record and calls noteSingleApprover().
 */
export async function maySelfApprove(actor) {
  if (!SINGLE_APPROVER_ROLES.includes(actor?.roleKey)) return false;
  return (await getApproverMode()).singleApproverMode;
}

export async function noteSingleApprover(actor, { entityType, entityId, what }) {
  await recordAudit({ actor, action: 'policy.single_approver.used', entityType, entityId: String(entityId), after: { what, byRole: actor?.roleKey ?? null } });
}
