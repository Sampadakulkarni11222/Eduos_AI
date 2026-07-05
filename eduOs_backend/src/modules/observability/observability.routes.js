import { Router } from 'express';
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
 *     summary: Readiness probe â€” checks the MongoDB connection is up
 *     tags: [Observability]
 *     security: []
 *     responses:
 *       200: { description: Ready }
 *       503: { description: Not ready }
 */
router.get('/ready', controller.ready);

/**
 * @swagger
 * /observability/metrics:
 *   get:
 *     summary: Basic process metrics (uptime, memory, DB state)
 *     tags: [Observability]
 *     security: []
 *     responses:
 *       200:
 *         description: Metrics fetched
 */
router.get('/metrics', controller.metrics);

export default router;
