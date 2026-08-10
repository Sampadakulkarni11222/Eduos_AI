import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './ptmessage.service.js';

export const listStudentTeachers = asyncHandler(async (req, res) => {
  const teachers = await service.listStudentTeachers(req.actor, req.params.studentId);
  sendSuccess(res, teachers, 'Student teachers fetched');
});

export const startThread = asyncHandler(async (req, res) => {
  const thread = await service.startThread(req.actor, req.body);
  sendSuccess(res, thread, 'Thread started', 201);
});

export const listThreads = asyncHandler(async (req, res) => {
  const threads = await service.listThreads(req.actor, req.scope);
  sendSuccess(res, threads, 'Threads fetched');
});

export const getThread = asyncHandler(async (req, res) => {
  const data = await service.getThread(req.actor, req.scope, req.params.id);
  sendSuccess(res, data, 'Thread fetched');
});

export const sendMessage = asyncHandler(async (req, res) => {
  const message = await service.sendMessage(req.actor, req.body);
  sendSuccess(res, message, 'Message sent', 201);
});
