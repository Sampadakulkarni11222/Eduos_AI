import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './incident.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Incidents
 *   description: Incident and disciplinary reports
 */

/**
 * @swagger
 * /incidents:
 *   post:
 *     summary: File a new incident / disciplinary report
 *     tags: [Incidents]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [studentId, date, type, severity, description]
 *             properties:
 *               studentId:
 *                 type: string
 *               date:
 *                 type: string
 *                 example: "2026-08-09"
 *               type:
 *                 type: string
 *                 enum: [BEHAVIOUR, BULLYING, ATTENDANCE_RELATED, PROPERTY_DAMAGE, SAFETY, OTHER]
 *               severity:
 *                 type: string
 *                 enum: [LOW, MEDIUM, HIGH]
 *               description:
 *                 type: string
 *               actionTaken:
 *                 type: string
 *     responses:
 *       201:
 *         description: Incident report created
 */
router.post('/', requirePermission('incidents.report'), controller.createIncident);

/**
 * @swagger
 * /incidents:
 *   get:
 *     summary: List incident reports (OWN = only your own; ALL = all reports)
 *     tags: [Incidents]
 *     parameters:
 *       - in: query
 *         name: studentId
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [OPEN, REVIEWED, CLOSED]
 *     responses:
 *       200:
 *         description: Incident reports fetched
 */
router.get('/', requirePermission('incidents.read'), controller.listIncidents);

/**
 * @swagger
 * /incidents/{id}:
 *   patch:
 *     summary: Update an incident report status or action taken (admin/principal only)
 *     tags: [Incidents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [OPEN, REVIEWED, CLOSED]
 *               actionTaken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Incident report updated
 */
router.patch('/:id', requirePermission('incidents.manage'), controller.updateIncident);

export default router;
