import { Router, raw } from 'express';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { authenticate } from '../../middleware/auth.js';
import { uploadRateLimiter } from '../../middleware/rateLimiter.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import { env } from '../../config/env.js';

/**
 * File upload endpoint (documents, course material, assignment attachments).
 *
 * Dependency-free: the client PUTs the raw file bytes with the filename in
 * the `x-filename` header. Files land in UPLOAD_DIR (served statically at
 * /uploads) and the returned fileUrl is stored on Document / Submission
 * records. Swapping local disk for object storage (S3/GCS) later only means
 * changing this handler — callers keep the same { fileUrl } contract.
 */

// SVG is deliberately excluded: it is an active-content format (it can carry
// <script>), and these files are served from our own origin.
const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt', 'md',
  'zip', 'mp3', 'mp4',
]);

const uploadDir = resolve(process.cwd(), env.UPLOAD_DIR);

function sanitizeFilename(name) {
  // Keep the basename only and strip anything that isn't filename-safe.
  const base = String(name).split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

const router = Router();
// authenticate first, so the limiter keys on the profile rather than an IP a
// whole school shares.
router.use(authenticate);
router.use(uploadRateLimiter);

/**
 * @swagger
 * /uploads:
 *   post:
 *     summary: Upload a file (raw body; filename in x-filename header)
 *     tags: [Uploads]
 *     responses:
 *       201:
 *         description: File stored; returns its public fileUrl
 */
router.post(
  '/',
  raw({ type: () => true, limit: env.UPLOAD_MAX_BYTES }),
  asyncHandler(async (req, res) => {
    const rawName = req.headers['x-filename'];
    if (!rawName) throw new AppError('x-filename header is required', 400);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new AppError('Request body must contain the raw file bytes', 400);
    }

    const filename = sanitizeFilename(decodeURIComponent(String(rawName)));
    const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new AppError(`File type .${ext || '?'} is not allowed`, 415, [], 'UPLOAD_TYPE_NOT_ALLOWED');
    }

    await mkdir(uploadDir, { recursive: true });
    const stored = `${randomUUID()}-${filename}`;
    await writeFile(join(uploadDir, stored), req.body);

    sendSuccess(
      res,
      {
        fileUrl: `/uploads/${stored}`,
        filename,
        size: req.body.length,
        mimeType: req.headers['content-type'] ?? 'application/octet-stream',
      },
      'File uploaded',
      201
    );
  })
);

export default router;
