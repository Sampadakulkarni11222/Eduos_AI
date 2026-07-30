import { AuditLog } from '../../models/auditLog.model.js';
import { redact } from '../../middleware/auditLogger.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';

const MAX_LIMIT = 200;

export const listLogs = asyncHandler(async (req, res) => {
  const { cursor, action } = req.query;
  // `limit` was hardcoded at 20 and silently ignored the query parameter, so a
  // caller asking for more got 20 with no indication why.
  const requested = Number(req.query.limit);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_LIMIT) : 20;

  const query = {};
  if (action) {
    query.action = action;
  }
  
  if (cursor) {
    query.createdAt = { $lt: new Date(cursor) };
  }

  const logs = await AuditLog.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('actorProfileId', 'displayName email roleKey')
    .lean();

  const nextCursor = logs.length === limit ? logs[logs.length - 1].createdAt.toISOString() : undefined;

  const dtos = logs.map(log => ({
    id: log._id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    actorProfileId: log.actorProfileId?._id,
    actorName: log.actorProfileId?.displayName || 'System',
    channel: log.channel || 'WEB',
    ip: log.ip || null,
    // The state change was being written and then dropped here, so every
    // consumer of this API saw *that* something happened and never *what*
    // changed — which is the question an audit log exists to answer. Passed
    // through the same redactor the request logger uses, because these payloads
    // can carry OTPs, tokens and medical fields.
    before: log.before ? redact(log.before) : null,
    after: log.after ? redact(log.after) : null,
    createdAt: log.createdAt.toISOString(),
  }));


  // Match the Paged<T> structure for the frontend
  sendSuccess(res, { items: dtos, nextCursor }, 'Audit logs fetched successfully');
});
