import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './admission.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Admissions
 *   description: Admission lead pipeline (CRM-style)
 */

/**
 * @swagger
 * /admissions/pipeline:
 *   get:
 *     summary: Get the admissions pipeline grouped by stage
 *     tags: [Admissions]
 *     responses:
 *       200:
 *         description: Pipeline fetched
 */
router.get('/pipeline', requirePermission('admissions.read'), controller.getPipeline);

/**
 * @swagger
 * /admissions/leads:
 *   post:
 *     summary: Create a new admission lead
 *     tags: [Admissions]
 *     responses:
 *       201:
 *         description: Lead created
 */
router.post('/leads', requirePermission('admissions.manage'), controller.createLead);

/**
 * @swagger
 * /admissions/leads/update:
 *   post:
 *     summary: Update a lead's stage/notes/assignee
 *     tags: [Admissions]
 *     responses:
 *       200:
 *         description: Lead updated
 */
router.post('/leads/update', requirePermission('admissions.manage'), controller.updateLead);

export default router;
