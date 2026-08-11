import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './settings.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * /settings:
 *   get:
 *     summary: Get school settings (name, logo, academic year, timezone…)
 *     tags: [Settings]
 *     responses:
 *       200: { description: Settings fetched }
 *   patch:
 *     summary: Update school settings
 *     tags: [Settings]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               schoolName: { type: string }
 *               logoUrl: { type: string }
 *               address: { type: string }
 *               phone: { type: string }
 *               email: { type: string }
 *               website: { type: string }
 *               currentAcademicYearId: { type: string }
 *               timezone: { type: string }
 *               currency: { type: string }
 *     responses:
 *       200: { description: Settings updated }
 */
router.get('/', requirePermission('settings.manage'), controller.getSettings);
router.patch('/', requirePermission('settings.manage'), controller.updateSettings);

export default router;
