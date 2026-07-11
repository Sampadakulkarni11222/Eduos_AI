import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './risk.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Risk
 *   description: >
 *     Dropout/academic/fee-default risk (STAND-IN). Rule-based thresholds
 *     over the last 30 days of data, not a trained model â€” see
 *     docs/ARCHITECTURE.md.
 */

/**
 * @swagger
 * /risk/scan:
 *   get:
 *     summary: Recompute risk predictions (optionally for one enrollmentId)
 *     tags: [Risk]
 *     responses:
 *       200:
 *         description: Risk scan complete
 */
router.get('/scan', requirePermission('ai.insights.read'), controller.scan);

export default router;
