import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './assignment.service.js';

export const list = asyncHandler(async (req, res) => {
  const assignments = await service.list(req.actor, req.scope, req.query);
  const dtos = assignments.map(a => ({
    id: a._id,
    title: a.title,
    type: a.type,
    dueAt: a.dueAt?.toISOString() || null,
    subject: a.subjectOfferingId?.subjectId?.name || 'Subject', // need to ensure subjectId is populated or just fallback if not
  }));
  sendSuccess(res, dtos, 'Assignments fetched');
});

export const create = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.create(req.actor, req.body), 'Assignment created', 201);
});

export const grade = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.gradeSubmission(req.actor, req.body), 'Submission graded');
});

export const submit = asyncHandler(async (req, res) => {
  const { assignmentId, enrollmentId, attachments } = req.body;
  sendSuccess(res, await service.submit(assignmentId, enrollmentId, attachments), 'Assignment submitted', 201);
});
