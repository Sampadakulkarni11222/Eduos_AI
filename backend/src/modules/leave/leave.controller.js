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

/** List ALL student leave applications — for warden / admin. */
export const listAll = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const applications = await service.listAll({ status });
  sendSuccess(res, applications, 'Leave applications fetched');
});

/** Approve or reject a student leave application. */
export const review = asyncHandler(async (req, res) => {
  const updated = await service.review(req.params.id, {
    ...req.body,
    reviewerProfileId: req.actor.profileId,
  });
  sendSuccess(res, updated, 'Leave application reviewed');
});

/** List ALL staff leave applications — for admin / principal. */
export const listAllStaff = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const applications = await service.listAllStaff({ status });
  sendSuccess(res, applications, 'Staff leave applications fetched');
});

/** Approve or reject a staff leave application. */
export const reviewStaff = asyncHandler(async (req, res) => {
  const updated = await service.reviewStaff(req.params.id, {
    ...req.body,
    reviewerProfileId: req.actor.profileId,
  });
  sendSuccess(res, updated, 'Staff leave application reviewed');
});
