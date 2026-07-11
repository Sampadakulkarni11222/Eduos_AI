import { AuditLog } from '../../models/auditLog.model.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';

export const listLogs = asyncHandler(async (req, res) => {
  const { cursor, action } = req.query;
  const limit = 20;

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
    createdAt: log.createdAt.toISOString(),
  }));


  // Match the Paged<T> structure for the frontend
  sendSuccess(res, { items: dtos, nextCursor }, 'Audit logs fetched successfully');
});
