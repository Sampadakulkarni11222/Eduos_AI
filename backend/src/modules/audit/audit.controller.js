import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './audit.service.js';

/**
 * The audit trail over HTTP.
 *
 * Every rule — the default staff view, who may see import/export entries, the
 * redaction of sensitive fields — lives in audit.service.js, which the
 * assistant's list_audit_logs tool calls too. This file only adapts HTTP.
 */
export const listLogs = asyncHandler(async (req, res) => {
  // Match the Paged<T> structure the frontend expects: { items, nextCursor }.
  sendSuccess(res, await service.listLogs(req.actor, req.query), 'Audit logs fetched successfully');
});
