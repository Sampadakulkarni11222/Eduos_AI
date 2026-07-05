import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './exam.service.js';

export const createExam = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.createExam(req.body), 'Exam created', 201);
});

export const createExamSubject = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.createExamSubject(req.body), 'Exam subject created', 201);
});

export const listExamSubjects = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.listExamSubjects(req.query.examId), 'Exam subjects fetched');
});

export const getMarksGrid = asyncHandler(async (req, res) => {
  const grid = await service.getMarksGrid(req.actor, req.scope, req.query.examSubjectId);
  sendSuccess(res, grid, 'Marks grid fetched');
});

export const getPerformance = asyncHandler(async (req, res) => {
  const performance = await service.getPerformance(req.actor, req.scope, req.query);
  sendSuccess(res, performance, 'Performance fetched');
});

export const enterMarks = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.enterMarks(req.actor, req.body), 'Marks entered', 201);
});

export const publishMarks = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.publishMarks(req.body.examSubjectId), 'Marks published');
});
