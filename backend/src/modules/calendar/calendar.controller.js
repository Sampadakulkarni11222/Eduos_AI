import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './calendar.service.js';

export const list = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.list(req.query), 'Calendar events fetched');
});

export const create = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.create(req.actor, req.scope, req.body), 'Calendar event created', 201);
});
