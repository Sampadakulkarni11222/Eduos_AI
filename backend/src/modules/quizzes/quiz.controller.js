import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './quiz.service.js';

export const list = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.list(req.actor, req.scope), 'Quizzes fetched');
});

export const create = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.create(req.actor, req.scope, req.body), 'Quiz created', 201);
});

export const get = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.getForManage(req.actor, req.scope, req.params.id), 'Quiz fetched');
});

export const update = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.update(req.actor, req.scope, req.params.id, req.body), 'Quiz updated');
});

export const remove = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.remove(req.actor, req.scope, req.params.id), 'Quiz deleted');
});

export const addQuestion = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.addQuestion(req.actor, req.scope, req.params.id, req.body), 'Question added', 201);
});

export const updateQuestion = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await service.updateQuestion(req.actor, req.scope, req.params.id, req.params.questionId, req.body),
    'Question updated',
  );
});

export const deleteQuestion = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.deleteQuestion(req.actor, req.scope, req.params.id, req.params.questionId), 'Question deleted');
});

export const publish = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.publish(req.actor, req.scope, req.params.id), 'Quiz published');
});

export const unpublish = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.unpublish(req.actor, req.scope, req.params.id), 'Quiz unpublished');
});

export const results = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.results(req.actor, req.scope, req.params.id), 'Quiz results fetched');
});

export const overview = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.overviewForStudent(req.actor, req.params.id), 'Quiz fetched');
});

export const start = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.start(req.actor, req.params.id), 'Quiz started');
});

export const submit = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.submit(req.actor, req.params.id, req.body), 'Quiz submitted', 201);
});

export const myResult = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.myResult(req.actor, req.params.id), 'Quiz result fetched');
});

export const myAttempts = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.myAttempts(req.actor), 'Quiz attempts fetched');
});
