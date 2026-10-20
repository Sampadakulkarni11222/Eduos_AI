import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { AppError } from '../../utils/AppError.js';
import * as controller from './leave.controller.js';

const router = Router();
router.use(authenticate);

/**
 * `leave.apply`, or a parent applying for one of their own children.
 *
 * In a K-12 school it is the parent who asks for a child's leave, but the
 * PARENT role holds only `leave.read` (OWN). A parent holding that grant is
 * let through at OWN scope; the service then refuses any child who is not
 * linked to them (StudentGuardian). Once PARENT is granted `leave.apply: OWN`
 * in permissions.js, the first branch covers parents and this fallback is inert.
 */
const leaveApply = (req, res, next) => {
  if (req.actor?.permissions?.['leave.apply']) return requirePermission('leave.apply')(req, res, next);
  if (req.actor?.roleKey === 'PARENT' && req.actor?.permissions?.['leave.read']) {
    req.scope = 'OWN';
    return next();
  }
  throw new AppError('Missing permission: leave.apply', 403);
};

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
router.post('/apply', leaveApply, controller.apply);

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
