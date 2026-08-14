import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './assignment.service.js';

export const list = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.list(req.actor, req.scope, req.query), 'Assignments fetched');
});

export const create = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.create(req.actor, req.scope, req.body), 'Assignment created', 201);
});

export const grade = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.gradeSubmission(req.actor, req.scope, req.body), 'Submission graded');
});

export const submit = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.submit(req.actor, req.scope, req.body), 'Assignment submitted', 201);
});

export const listSubmissions = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.listSubmissions(req.actor, req.scope, req.params.id), 'Submissions fetched');
});
