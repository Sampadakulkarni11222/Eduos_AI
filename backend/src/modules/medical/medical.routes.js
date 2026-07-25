import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './medical.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Medical
 *   description: Encrypted student medical records
 */

/**
 * @swagger
 * /medical/{studentId}:
 *   get:
 *     summary: Get a student's medical record (decrypted server-side)
 *     tags: [Medical]
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Medical record fetched
 *   put:
 *     summary: Create or update a student's medical record
 *     tags: [Medical]
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Medical record saved
 */
router.get('/:studentId', requirePermission('medical.read'), controller.getByStudentId);
router.put('/:studentId', requirePermission('medical.manage'), controller.upsert);
router.delete('/:studentId', requirePermission('medical.manage'), controller.remove);

export default router;
