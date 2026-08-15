import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './leave.service.js';

export const apply = asyncHandler(async (req, res) => {
  const application = await service.apply(req.actor, req.body);
  sendSuccess(res, application, 'Leave application submitted', 201);
});

export const listMine = asyncHandler(async (req, res) => {
  const applications = await service.listMine(req.actor);
  sendSuccess(res, applications, 'Leave applications fetched');
});

export const review = asyncHandler(async (req, res) => {
  const application = await service.review(req.actor, req.params.id, req.body);
  sendSuccess(res, application, `Leave application ${req.body.status?.toLowerCase() ?? 'updated'}`);
});
