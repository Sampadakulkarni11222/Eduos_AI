import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import * as controller from './notification.controller.js';

const router = Router();

/**
 * Notifications are inherently personal: every query and update is pinned to
 * the caller's own profile inside the service. There is therefore no
 * permission key to check beyond being signed in — and deliberately no
 * endpoint that reads or writes another profile's inbox.
 */
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Notifications
 *   description: In-app notification inbox (per-profile)
 */

/**
 * @swagger
 * /notifications:
 *   get:
 *     summary: List the caller's notifications, newest first
 *     tags: [Notifications]
 *     parameters:
 *       - in: query
 *         name: unreadOnly
 *         schema: { type: boolean }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: before
 *         schema: { type: string, format: date-time }
 *         description: Cursor — pass the previous page's nextCursor
 *     responses:
 *       200:
 *         description: Notifications fetched (with unreadCount)
 */
router.get('/', controller.list);

/**
 * @swagger
 * /notifications/unread-count:
 *   get:
 *     summary: Unread count for the bell badge
 *     tags: [Notifications]
 *     responses:
 *       200:
 *         description: Unread count fetched
 */
router.get('/unread-count', controller.unreadCount);

/**
 * @swagger
 * /notifications/read:
 *   post:
 *     summary: Mark specific notifications as read
 *     tags: [Notifications]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Marked read
 */
router.post('/read', controller.markRead);

/**
 * @swagger
 * /notifications/read-all:
 *   post:
 *     summary: Mark every unread notification as read
 *     tags: [Notifications]
 *     responses:
 *       200:
 *         description: All marked read
 */
router.post('/read-all', controller.markAllRead);

export default router;
