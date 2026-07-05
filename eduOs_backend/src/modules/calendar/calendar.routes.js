import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './calendar.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Calendar
 *   description: Holidays, exams, PTMs, and school events
 */

/**
 * @swagger
 * /calendar:
 *   get:
 *     summary: List calendar events (optionally by from/to date query params)
 *     tags: [Calendar]
 *     responses:
 *       200:
 *         description: List of calendar events
 *   post:
 *     summary: Create a calendar event
 *     tags: [Calendar]
 *     responses:
 *       201:
 *         description: Calendar event created
 */
router.get('/', requirePermission('calendar.read'), controller.list);
router.post('/', requirePermission('calendar.manage'), controller.create);

export default router;
