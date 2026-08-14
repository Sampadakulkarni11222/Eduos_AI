import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { renderReportCardPdf } from '../../utils/reportCardPdf.js';
import * as service from './exam.service.js';

export const getReportCard = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.getReportCard(req.actor, req.scope, req.query), 'Report card fetched');
});

export const getReportCardPdf = asyncHandler(async (req, res) => {
  const card = await service.getReportCard(req.actor, req.scope, req.query);
  const safeName = String(card.student?.name ?? 'student').replace(/[^a-zA-Z0-9]+/g, '-');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="ReportCard-${safeName}.pdf"`);
  renderReportCardPdf(res, card);
});

export const createExam = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.createExam(req.body), 'Exam created', 201);
});

export const createExamSubject = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.createExamSubject(req.body), 'Exam subject created', 201);
});

export const listExams = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.listExams(req.query.termId), 'Exams fetched');
});

export const listExamSubjects = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.listExamSubjects(req.actor, req.scope, req.query.examId), 'Exam subjects fetched');
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
  sendSuccess(res, await service.enterMarks(req.actor, req.scope, req.body), 'Marks entered', 201);
});

export const publishMarks = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.publishMarks(req.actor, req.scope, req.body.examSubjectId), 'Marks published');
});

export const unpublishMarks = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.unpublishMarks(req.actor, req.scope, req.body.examSubjectId), 'Marks unpublished — they are now in DRAFT and can be corrected');
});
