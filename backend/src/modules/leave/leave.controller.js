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

/** List ALL leave applications — for warden / admin. */
export const listAll = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const applications = await service.listAll({ status });
  sendSuccess(res, applications, 'Leave applications fetched');
});

/** Approve or reject a leave application. */
export const review = asyncHandler(async (req, res) => {
  const updated = await service.review(req.params.id, {
    ...req.body,
    reviewerProfileId: req.actor.profileId,
  });
  sendSuccess(res, updated, 'Leave application reviewed');
});
