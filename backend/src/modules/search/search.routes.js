import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendError } from '../../utils/response.js';
import { numFromEnv } from '../../config/env.js';
import * as searchService from './search.service.js';

/**
 * @swagger
 * tags:
 *   name: Search
 *   description: Universal search across the records the signed-in person may see (students, staff, classes, notices, newsroom, documents, library, labs, assets, vehicles, tickets, tasks, clubs, enquiries, campaigns)
 */

/**
 * @swagger
 * /search:
 *   get:
 *     summary: Search everything the caller may see
 *     description: Each kind of record is searched only when the caller holds the permission its own page needs, and only within their scope (a parent finds their own children, a teacher the students of the classes they teach). At least 2 characters; at most 6 results per kind.
 *     tags: [Search]
 *     parameters:
 *       - { in: query, name: q, required: true, schema: { type: string, minLength: 2, maxLength: 80 } }
 *       - { in: query, name: types, schema: { type: string }, description: Comma-separated kinds to search (default all) }
 *     responses:
 *       200: { description: Groups of results, each with the pages that can open them }
 *       400: { description: Query shorter than 2 characters }
 *       429: { description: Too many searches }
 */
const router = Router();

// Per person, after sign-in: one fast typist must not starve everyone else on the same network.
const searchLimiter = rateLimit({
  windowMs: 60_000,
  max: numFromEnv('RATE_LIMIT_SEARCH_MAX', 90),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `search:${req.actor?.tenantId ?? ''}:${req.actor?.profileId ?? req.ip}`,
  handler: (_req, res) => sendError(res, 'Too many searches. Wait a moment and try again.', 429, [], 'RATE_LIMITED'),
});

router.get('/', authenticate, searchLimiter, asyncHandler(async (req, res) => {
  const types = typeof req.query.types === 'string' && req.query.types ? req.query.types.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 30) : null;
  sendSuccess(res, await searchService.search(req.actor, req.query.q, { types }));
}));

export default router;
