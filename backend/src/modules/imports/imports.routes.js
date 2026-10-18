import { Router, raw } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { uploadRateLimiter } from '../../middleware/rateLimiter.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import { AI_ASSISTANT_PERMISSION } from '../../constants/permissions.js';
import { MAX_FILE_BYTES } from './sheet.js';
import { SCHEMA_BY_KEY, mayImport, schemasFor } from './schemas.js';
import * as service from './imports.service.js';

/**
 * Bulk import through Ask AI (the file side; the conversation side is the MCP
 * tools in ai/mcp/tools/p7BulkImport.js).
 *
 *   POST /imports/files                 the sheet's raw bytes (x-filename header), like /uploads
 *   GET  /imports/formats               what this person can import, with columns
 *   GET  /imports/templates/:key.:fmt   a sample sheet (csv | xlsx)
 *   GET  /imports/files/:id             a file's preview / outcome
 *   GET  /imports/files/:id/errors.:fmt the rows to fix, with an Errors column
 *
 * Previewing and importing happen in the chat (draft → confirm). Every route
 * needs the assistant, and a person who can import nothing at all can upload
 * nothing here.
 */
const router = Router();
router.use(authenticate);
router.use(requirePermission(AI_ASSISTANT_PERMISSION));

function canImportSomething(req) {
  if (!schemasFor(req.actor).length) throw new AppError('Your account cannot import anything in bulk.', 403, [], 'FORBIDDEN');
}

router.post(
  '/files',
  uploadRateLimiter,
  raw({ type: () => true, limit: MAX_FILE_BYTES }),
  asyncHandler(async (req, res) => {
    canImportSomething(req);
    const rawName = req.headers['x-filename'];
    if (!rawName) throw new AppError('x-filename header is required', 400);
    let name;
    try {
      name = decodeURIComponent(String(rawName));
    } catch {
      throw new AppError('x-filename header is not a valid URI-encoded filename', 400, [], 'INVALID_FILENAME');
    }
    const stored = await service.storeFile({ actor: req.actor, channel: 'WEB', name, buffer: req.body });
    sendSuccess(res, stored, 'File received', 201);
  }),
);

router.get('/formats', asyncHandler(async (req, res) => {
  sendSuccess(res, service.describeFormats(req.actor, { target: req.query.target ?? null }));
}));

function sendFile(res, file) {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename.replace(/[^\w.-]/g, '_')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(file.body);
}

router.get('/templates/:name', asyncHandler(async (req, res) => {
  const [key, fmt = 'xlsx'] = String(req.params.name).split('.');
  const schema = SCHEMA_BY_KEY[key];
  if (!schema) throw new AppError('No such import template.', 404, [], 'NOT_FOUND');
  if (!mayImport(req.actor, schema)) throw new AppError(`Your account cannot import ${schema.label.toLowerCase()}.`, 403, [], 'FORBIDDEN');
  sendFile(res, service.template(key, fmt === 'csv' ? 'csv' : 'xlsx'));
}));

router.get('/files/:id', asyncHandler(async (req, res) => {
  sendSuccess(res, await service.getResult(req.actor, { fileId: req.params.id }));
}));

router.get('/files/:id/:report', asyncHandler(async (req, res) => {
  const [kind, fmt = 'xlsx'] = String(req.params.report).split('.');
  if (kind !== 'errors') throw new AppError('Not found', 404, [], 'NOT_FOUND');
  const ctx = { actor: req.actor, scope: req.scope ?? null };
  sendFile(res, await service.errorReport(ctx, { fileId: req.params.id, format: fmt === 'csv' ? 'csv' : 'xlsx' }));
}));

export default router;
