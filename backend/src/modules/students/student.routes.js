import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './student.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Students
 *   description: Student records, guardians, and enrollments
 */

/**
 * @swagger
 * /students:
 *   get:
 *     summary: List students (scoped to OWN classes/children/self depending on role)
 *     tags: [Students]
 *     responses:
 *       200:
 *         description: List of students
 *   post:
 *     summary: Create a student
 *     tags: [Students]
 *     responses:
 *       201:
 *         description: Student created
 */
router.get('/', requirePermission('students.read'), controller.list);
router.post('/', requirePermission('students.manage'), controller.create);

/**
 * @swagger
 * /students/{id}:
 *   get:
 *     summary: Get a single student
 *     tags: [Students]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Student fetched
 *   patch:
 *     summary: Update a student
 *     tags: [Students]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Student updated
 *   delete:
 *     summary: Deactivate (soft-delete) a student
 *     tags: [Students]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Student deactivated
 */
router.get('/:id', requirePermission('students.read'), controller.getById);
/**
 * @swagger
 * /students/{id}/photo:
 *   patch:
 *     summary: Set a student's profile photo (used on their ID card)
 *     description: >
 *       Guarded by `students.read` rather than `students.manage` so a student
 *       can supply their own photo without gaining edit rights over their
 *       admission record. OWN scope restricts it to their own record; the
 *       service accepts only paths from this system's upload endpoint.
 *     tags: [Students]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [photoUrl]
 *             properties:
 *               photoUrl: { type: string, example: /uploads/uuid-photo.jpg }
 *     responses:
 *       200:
 *         description: Profile photo updated
 */
router.patch('/:id/photo', requirePermission('students.read'), controller.setPhoto);

router.patch('/:id', requirePermission('students.manage'), controller.update);
router.delete('/:id', requirePermission('students.manage'), controller.remove);

/**
 * @swagger
 * /students/{id}/overview:
 *   get:
 *     summary: Get a student's full profile in one call (address, guardians+phone, medical, attendance, exam performance, assignments)
 *     tags: [Students]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Student overview fetched
 */
router.get('/:id/overview', requirePermission('students.read'), controller.getOverview);

/**
 * @swagger
 * /students/{id}/guardians:
 *   get:
 *     summary: List a student's guardians
 *     tags: [Students]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Guardians fetched
 *   post:
 *     summary: Link a guardian to a student
 *     tags: [Students]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Guardian linked
 */
router.get('/:id/guardians', requirePermission('students.read'), controller.listGuardians);
router.post('/:id/guardians', requirePermission('students.manage'), controller.addGuardian);

/**
 * @swagger
 * /students/{id}/id-card:
 *   get:
 *     summary: Generate the student's ID card as a PDF (streamed inline)
 *     tags: [Students]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: ID card PDF
 */
router.get('/:id/id-card', requirePermission('students.read'), controller.getIdCard);

export default router;
