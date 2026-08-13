import { extname } from 'path';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './assignment.service.js';

const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
};

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

export const getInstructionFile = asyncHandler(async (req, res) => {
  const attachmentIndex = req.params.attachmentIndex ?? req.query.index ?? 0;
  const file = await service.getInstructionFile(req.actor, req.scope, req.params.id, attachmentIndex);
  if (file.external) {
    return res.redirect(file.external);
  }
  const ext = extname(file.filename).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(file.absolutePath);
});

