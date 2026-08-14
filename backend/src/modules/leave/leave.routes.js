import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './leave.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Leave
 *   description: Student leave applications
 */

/**
 * @swagger
 * /leave/apply:
 *   post:
 *     summary: Apply for a leave of absence (own enrollment)
 *     tags: [Leave]
 *     responses:
 *       201:
 *         description: Leave application submitted
 */
router.post('/apply', requirePermission('leave.apply'), controller.apply);

/**
 * @swagger
 * /leave/mine:
 *   get:
 *     summary: List the caller's own leave applications
 *     tags: [Leave]
 *     responses:
 *       200:
 *         description: Leave applications fetched
 */
router.get('/mine', requirePermission('leave.read'), controller.listMine);

export default router;
