import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './announcement.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Announcements
 *   description: School-wide and class-level announcements
 */

/**
 * @swagger
 * /announcements:
 *   get:
 *     summary: List announcements
 *     tags: [Announcements]
 *     responses:
 *       200:
 *         description: List of announcements
 *   post:
 *     summary: Publish an announcement
 *     tags: [Announcements]
 *     responses:
 *       201:
 *         description: Announcement published
 */
router.get('/', requirePermission('announcements.read'), controller.list);
router.post('/', requirePermission('announcements.publish'), controller.create);

/**
 * @swagger
 * /announcements/preview:
 *   post:
 *     summary: Resolve what an announcement would look like and reach, without publishing it
 *     tags: [Announcements]
 *     responses:
 *       200:
 *         description: Preview resolved
 */
router.post('/preview', requirePermission('announcements.publish'), controller.preview);

export default router;
