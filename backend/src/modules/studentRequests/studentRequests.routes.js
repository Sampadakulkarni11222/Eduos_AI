import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './studentRequests.controller.js';

/**
 * Student-raised requests that a class teacher decides on:
 * co-curricular achievements, and corrections to profile information.
 *
 * Both follow the same shape — the student may only ever create a PENDING
 * row, and only an approval by the reviewer writes anything to the record
 * itself.
 */
const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: StudentRequests
 *   description: Student-raised co-curricular and profile-edit requests
 */

// ── Co-curricular ───────────────────────────────────────────

/**
 * @swagger
 * /student-requests/cocurricular:
 *   get:
 *     summary: Co-curricular activities on a student's record (all states for the student themselves)
 *     tags: [StudentRequests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: studentId
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [ALL, PENDING, APPROVED, REJECTED] }
 *     responses:
 *       200: { description: Activities fetched }
 *   post:
 *     summary: Request that a co-curricular activity be added to the caller's profile
 *     tags: [StudentRequests]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201: { description: Request submitted }
 */
router.get('/cocurricular', requirePermission('cocurricular.read'), controller.listActivities);
router.post('/cocurricular', requirePermission('cocurricular.request'), controller.requestActivity);

/**
 * @swagger
 * /student-requests/cocurricular/review:
 *   get:
 *     summary: The reviewer's co-curricular queue (class teacher = own sections)
 *     tags: [StudentRequests]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Requests fetched }
 */
router.get('/cocurricular/review', requirePermission('cocurricular.review'), controller.listActivityReviews);

/**
 * @swagger
 * /student-requests/cocurricular/{id}/decide:
 *   patch:
 *     summary: Approve or reject a co-curricular request
 *     tags: [StudentRequests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Decision recorded }
 */
router.patch('/cocurricular/:id/decide', requirePermission('cocurricular.review'), controller.decideActivity);
router.delete('/cocurricular/:id', requirePermission('cocurricular.request'), controller.withdrawActivity);

// ── Profile edit requests ───────────────────────────────────

/**
 * @swagger
 * /student-requests/profile-edits/fields:
 *   get:
 *     summary: The profile fields a student is permitted to request changes to
 *     tags: [StudentRequests]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Fields fetched }
 */
router.get('/profile-edits/fields', requirePermission('profile.edit.request'), controller.editableFields);

/**
 * @swagger
 * /student-requests/profile-edits/review:
 *   get:
 *     summary: The class teacher's profile-edit queue
 *     tags: [StudentRequests]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Requests fetched }
 */
router.get('/profile-edits/review', requirePermission('profile.edit.review'), controller.listProfileEditReviews);

/**
 * @swagger
 * /student-requests/profile-edits:
 *   get:
 *     summary: A student's own profile-edit requests and their status
 *     tags: [StudentRequests]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Requests fetched }
 *   post:
 *     summary: Request a correction to permitted profile information
 *     tags: [StudentRequests]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201: { description: Request submitted }
 */
router.get('/profile-edits', requirePermission('profile.edit.request'), controller.listProfileEdits);
router.post('/profile-edits', requirePermission('profile.edit.request'), controller.requestProfileEdit);

router.patch('/profile-edits/:id/decide', requirePermission('profile.edit.review'), controller.decideProfileEdit);
router.delete('/profile-edits/:id', requirePermission('profile.edit.request'), controller.withdrawProfileEdit);

export default router;
