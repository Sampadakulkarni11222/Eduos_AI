import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './leave.service.js';

export const apply = asyncHandler(async (req, res) => {
  const application = await service.apply(req.actor, req.body);
  sendSuccess(res, application, 'Leave application submitted', 201);
});

export const listMine = asyncHandler(async (req, res) => {
  const applications = await service.listMine(req.actor, { page: req.query.page, pageSize: req.query.pageSize });
  sendSuccess(res, applications, 'Leave applications fetched');
});

export const listForReview = asyncHandler(async (req, res) => {
  const applications = await service.listForReview(req.actor, req.scope, {
    status: req.query.status, page: req.query.page, pageSize: req.query.pageSize,
  });
  sendSuccess(res, applications, 'Leave requests fetched');
});

export const review = asyncHandler(async (req, res) => {
  const application = await service.review(req.actor, req.scope, { id: req.params.id, ...req.body });
  sendSuccess(res, application, 'Leave request reviewed');
});
