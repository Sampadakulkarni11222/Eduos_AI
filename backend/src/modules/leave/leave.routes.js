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
 *   description: Student and Teacher leave applications
 */

/**
 * @swagger
 * /leave/apply:
 *   post:
 *     summary: Apply for a leave of absence
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

/**
 * @swagger
 * /leave:
 *   get:
 *     summary: List all leave applications for review
 *     tags: [Leave]
 *     responses:
 *       200:
 *         description: Leave applications fetched
 */
router.get('/', requirePermission('leave.manage'), controller.listAll);

/**
 * @swagger
 * /leave/{id}:
 *   patch:
 *     summary: Approve or reject a leave application
 *     tags: [Leave]
 *     responses:
 *       200:
 *         description: Leave application reviewed
 */
router.patch('/:id', requirePermission('leave.manage'), controller.review);

export default router;
