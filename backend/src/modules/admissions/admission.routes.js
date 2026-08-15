import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { csvUploadSingle } from '../../utils/csvImport.js';
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
 * /admissions/leads/bulk:
 *   post:
 *     summary: Bulk-import admission leads from a CSV file
 *     tags: [Admissions]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Leads imported (per-row success/failure report)
 */
router.post(
  '/leads/bulk',
  requirePermission('admissions.manage'),
  csvUploadSingle('file'),
  controller.bulkCreateLeads
);

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

/**
 * @swagger
 * /admissions/leads/{id}:
 *   get:
 *     summary: Get a single lead with its interaction history
 *     tags: [Admissions]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Lead fetched
 *       404:
 *         description: Lead not found
 */
router.get('/leads/:id', requirePermission('admissions.read'), controller.getLead);

export default router;
