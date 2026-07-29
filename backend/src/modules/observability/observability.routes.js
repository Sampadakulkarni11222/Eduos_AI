import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permission.js';
import * as controller from './observability.controller.js';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Observability
 *   description: Liveness/readiness/metrics for ops tooling
 */

/**
 * @swagger
 * /observability/ready:
 *   get:
 *     summary: Readiness probe — checks the MongoDB connection is up
 *     tags: [Observability]
 *     security: []
 *     responses:
 *       200: { description: Ready }
 *       503: { description: Not ready }
 */
// Deliberately public: a load balancer or platform health check cannot hold a
// session, and the response says only whether the database is reachable.
router.get('/ready', controller.ready);

/**
 * @swagger
 * /observability/metrics:
 *   get:
 *     summary: Basic process metrics (uptime, memory, DB state) — leadership only
 *     tags: [Observability]
 *     responses:
 *       200:
 *         description: Metrics fetched
 *       403:
 *         description: Not permitted for your role
 */
/**
 * Was unauthenticated. Uptime, resident memory and the exact Node build are
 * infrastructure fingerprinting — the Node version in particular tells an
 * attacker which runtime CVEs to try. None of it is needed by a health check,
 * which is what `/ready` is for, so this is now leadership-only.
 *
 * A metrics scraper therefore needs a service account. That is a deliberate
 * trade: adding a shared bearer token here would have meant another secret to
 * rotate, and a half-designed one at that.
 */
router.get('/metrics', authenticate, requireRole('OWNER', 'ADMIN'), controller.metrics);

export default router;
