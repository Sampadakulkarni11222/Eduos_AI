import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './announcement.service.js';

export const list = asyncHandler(async (req, res) => {
  // The actor decides which announcements were addressed to them; holding
  // announcements.read only decides whether the list opens at all.
  sendSuccess(res, await service.list(req.actor), 'Announcements fetched');
});

export const create = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.create(req.actor, req.scope, req.body), 'Announcement published', 201);
});

/**
 * The preview step: what would be sent, and to whom, without sending it.
 *
 * Guarded by the same permission as publishing — resolving an audience is
 * itself a read of who is reachable, so it is not open to someone who could
 * not send.
 */
export const preview = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.preview(req.actor, req.scope, req.body), 'Announcement preview');
});
