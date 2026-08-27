import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './registration.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Registrations
 *   description: Student elective subject registration and staff approval
 */

/**
 * @swagger
 * /registrations/available:
 *   get:
 *     summary: Electives offered to the signed-in student's class, with seats left and their own status
 *     tags: [Registrations]
 *     responses:
 *       200:
 *         description: Available electives fetched
 */
router.get('/available', requirePermission('registrations.apply'), controller.listAvailable);

/**
 * @swagger
 * /registrations/mine:
 *   get:
 *     summary: The signed-in student's own registrations
 *     tags: [Registrations]
 *     responses:
 *       200:
 *         description: Your registrations fetched
 */
router.get('/mine', requirePermission('registrations.apply'), controller.listMine);

/**
 * @swagger
 * /registrations:
 *   post:
 *     summary: Register for an elective (created as PENDING for staff approval)
 *     tags: [Registrations]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subjectOfferingId]
 *             properties:
 *               subjectOfferingId: { type: string }
 *     responses:
 *       201:
 *         description: Registration submitted for approval
 *       409:
 *         description: Already registered, or the elective is full
 */
router.post('/', requirePermission('registrations.apply'), controller.register);

/**
 * @swagger
 * /registrations/{id}/withdraw:
 *   patch:
 *     summary: Withdraw your own pending request, or drop an approved elective
 *     tags: [Registrations]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Registration withdrawn
 */
router.patch('/:id/withdraw', requirePermission('registrations.apply'), controller.withdraw);

// ── Staff review ──
// Separate permission from `registrations.apply`: a student may act on their own
// requests but must never reach the review queue or decide on one.

/**
 * @swagger
 * /registrations/review:
 *   get:
 *     summary: Registration review queue (teachers see only their own sections)
 *     tags: [Registrations]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING, APPROVED, REJECTED, WITHDRAWN, ALL] }
 *     responses:
 *       200:
 *         description: Registrations fetched
 */
router.get('/review', requirePermission('registrations.review'), controller.listForReview);

/**
 * @swagger
 * /registrations/{id}/decision:
 *   patch:
 *     summary: Approve or reject a pending registration
 *     tags: [Registrations]
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
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: Registration decided
 *       409:
 *         description: Already decided, or the elective is full
 */
router.patch('/:id/decision', requirePermission('registrations.review'), controller.decide);

export default router;
