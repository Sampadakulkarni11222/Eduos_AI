import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { currentTenantState, runInTenantState } from '../../tenancy/tenantContext.js';
import { logger } from '../../utils/logger.js';
import * as types from './documentType.service.js';
import * as service from './documentRequest.service.js';

/* ── Document types (settings.manage) ───────────────────────── */

export const listTypes = asyncHandler(async (_req, res) => {
  sendSuccess(res, await types.list(), 'Document types fetched');
});
export const createType = asyncHandler(async (req, res) => {
  sendSuccess(res, await types.create(req.actor, req.body), 'Document type created', 201);
});
export const updateType = asyncHandler(async (req, res) => {
  sendSuccess(res, await types.update(req.actor, req.params.id, req.body), 'Document type updated');
});
export const deleteType = asyncHandler(async (req, res) => {
  sendSuccess(res, await types.remove(req.actor, req.params.id), 'Document type deleted');
});
export const addSuggestedTypes = asyncHandler(async (req, res) => {
  sendSuccess(res, await types.addSuggested(req.actor), 'Suggested document types added', 201);
});

/* ── Student ─────────────────────────────────────────────────── */

export const requestableTypes = asyncHandler(async (_req, res) => {
  sendSuccess(res, await types.listRequestable(), 'Document types fetched');
});
export const createRequest = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.createRequest(req.actor, req.body), 'Document request submitted', 201);
});
export const listMine = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.listMine(req.actor), 'Document requests fetched');
});
export const getMine = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.getMine(req.actor, req.params.id), 'Document request fetched');
});
export const cancelMine = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.cancelMine(req.actor, req.params.id), 'Document request cancelled');
});

/* ── Office ──────────────────────────────────────────────────── */

export const listForSchool = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.listForSchool(req.query), 'Document requests fetched');
});
export const getForSchool = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.getForSchool(req.params.id), 'Document request fetched');
});
export const review = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.startReview(req.actor, req.params.id), 'Document request under review');
});
export const approve = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.approve(req.actor, req.params.id, req.body), 'Document request approved');
});
export const reject = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.reject(req.actor, req.params.id, req.body), 'Document request rejected');
});
export const issue = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.issue(req.actor, req.params.id, req.body), 'Document issued', 201);
});

/* ── Downloads ───────────────────────────────────────────────── */

/**
 * Streams an issued file after the service has authorized it. The download is
 * recorded (and a student's first one completes the request) only once the
 * file has actually been sent.
 */
function sendIssuedFile(req, res, next, file, { byStudent }) {
  // sendFile's callback runs after the request's async context may have
  // unwound, so the school it belongs to is carried over explicitly.
  const tenant = currentTenantState();
  res.type(file.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${file.fileName.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(file.absolutePath, (err) => {
    if (err) {
      if (!res.headersSent) return next(err);
      logger.warn(`Document request ${file.request._id} download interrupted: ${err.message}`);
      return undefined;
    }
    runInTenantState(tenant, () => service.recordDownload(req.actor, file.request, file.version, { byStudent }))
      .catch((e) => logger.error(`Could not record document download: ${e.message}`));
    return undefined;
  });
}

export const downloadMine = asyncHandler(async (req, res, next) => {
  const file = await service.fileForStudent(req.actor, req.params.id);
  sendIssuedFile(req, res, next, file, { byStudent: true });
});

export const downloadForSchool = asyncHandler(async (req, res, next) => {
  const file = await service.fileForSchool(req.params.id, req.query.version);
  sendIssuedFile(req, res, next, file, { byStudent: false });
});
