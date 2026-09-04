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

/**
 * @swagger
 * /leave:
 *   get:
 *     summary: List leave requests a teacher/principal/admin may act on (scoped to own classes for a teacher)
 *     tags: [Leave]
 *     responses:
 *       200:
 *         description: Leave requests fetched
 */
router.get('/', requirePermission('leave.read'), controller.listForReview);

/**
 * @swagger
 * /leave/{id}/review:
 *   post:
 *     summary: Approve or reject a pending leave request
 *     tags: [Leave]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [APPROVED, REJECTED] }
 *               remarks: { type: string }
 *     responses:
 *       200:
 *         description: Leave request reviewed
 */
router.post('/:id/review', requirePermission('leave.review'), controller.review);

export default router;
