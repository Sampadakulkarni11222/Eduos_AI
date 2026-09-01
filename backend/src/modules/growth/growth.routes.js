import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './growth.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Growth
 *   description: >
 *     Growth score (STAND-IN). Computed with a transparent heuristic
 *     (60% marks + 40% attendance) rather than a trained model Ã¢â‚¬” see
 *     docs/ARCHITECTURE.md for what a real implementation would replace.
 */

/**
 * @swagger
 * /growth/score:
 *   get:
 *     summary: Get (and recompute) a student's growth score for a period
 *     tags: [Growth]
 *     parameters:
 *       - in: query
 *         name: enrollmentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: period
 *         required: true
 *         schema: { type: string, example: "2026-06" }
 *     responses:
 *       200:
 *         description: Growth score computed
 */
router.get('/score', requirePermission('ai.insights.read'), controller.getScore);

export default router;
