import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './announcement.service.js';

export const list = asyncHandler(async (_req, res) => {
  sendSuccess(res, await service.list(), 'Announcements fetched');
});

export const create = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.create(req.actor, req.scope, req.body), 'Announcement published', 201);
});
