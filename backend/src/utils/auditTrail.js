import { AuditLog } from '../models/auditLog.model.js';
import { logger } from './logger.js';

/**
 * Shared writer for the school audit trail.
 *
 * `middleware/auditLogger.js` covers mutations generically by sniffing the
 * route, but it deliberately skips GETs — so reads of sensitive data were
 * invisible. Read auditing can't be done from a middleware anyway: whether a
 * request actually disclosed a medical record depends on scope checks that only
 * the service layer has resolved. Hence this helper, called from the services
 * that do the disclosing.
 *
 * Never throws. A failed audit write must not break the read that triggered it
 * — the emergency medical lookup in particular is used to find a resident's
 * allergies during an incident, and failing that call closed because Mongo
 * hiccuped would be worse than a gap in the trail. Failures are logged at
 * error level so they surface in monitoring instead of vanishing.
 */
export async function recordAudit({
  actor,
  action,
  entityType = null,
  entityId = null,
  before,
  after,
  channel = 'WEB',
}) {
  try {
    await AuditLog.create({
      actorProfileId: actor?.profileId ?? null,
      action,
      entityType,
      entityId: entityId == null ? null : String(entityId),
      before,
      after,
      channel,
      ip: actor?.ip ?? null,
    });
  } catch (err) {
    logger.error(
      `Audit write failed (action=${action} entity=${entityType}:${entityId} actor=${actor?.profileId ?? 'anonymous'}): ${err.message}`
    );
  }
}

/**
 * Records a read of personal or medical data.
 *
 * `after` holds the access context, never the data itself — an audit trail that
 * copies medical fields into a second, less-guarded collection just doubles the
 * surface area the encryption in medicalRecord.model.js exists to shrink.
 * `fields` names which sensitive keys were disclosed, which is what a privacy
 * review actually needs.
 *
 * @param {object}   p.actor       req.actor (carries profileId, roleKey, ip)
 * @param {string}   p.action      House convention is dotted + lowercase, e.g. "medical.read"
 * @param {string}   p.entityType  Model name, e.g. "MedicalRecord"
 * @param {string}   p.entityId    Subject of the record (the student), not the row id
 * @param {string[]} [p.fields]    Sensitive field names disclosed
 * @param {string}   [p.via]       Which endpoint surfaced it, for reads reachable several ways
 * @param {number}   [p.count]     For list queries: how many records were returned
 */
export function recordPiiRead({ actor, action, entityType, entityId, fields, via, count }) {
  return recordAudit({
    actor,
    action,
    entityType,
    entityId,
    after: {
      pii: true,
      role: actor?.roleKey ?? null,
      ...(via && { via }),
      ...(fields?.length && { fields }),
      ...(count !== undefined && { count }),
      ...(actor?.userAgent && { userAgent: actor.userAgent }),
      at: new Date().toISOString(),
    },
  });
}
