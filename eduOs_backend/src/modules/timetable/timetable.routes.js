import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './timetable.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Timetable
 *   description: Weekly class timetable
 */

/**
 * @swagger
 * /timetable:
 *   get:
 *     summary: Get the timetable (optionally filtered by sectionId, scoped to OWN for teachers)
 *     tags: [Timetable]
 *     responses:
 *       200:
 *         description: Timetable slots
 */
router.get('/', requirePermission('timetable.read'), controller.getTimetable);

/**
 * @swagger
 * /timetable/slot:
 *   post:
 *     summary: Create or update a single timetable slot
 *     tags: [Timetable]
 *     responses:
 *       201:
 *         description: Slot saved
 */
router.post('/slot', requirePermission('timetable.manage'), controller.upsertSlot);

export default router;
