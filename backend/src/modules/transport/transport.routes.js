import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { csvUploadSingle } from '../../utils/csvImport.js';
import * as controller from './transport.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Transport
 *   description: Transport management (routes, stops, bus enrollment)
 */

router.get('/routes', requirePermission('transport.read'), controller.listRoutes);
router.post('/routes', requirePermission('transport.manage'), controller.createRoute);
router.post('/routes/bulk', requirePermission('transport.manage'), csvUploadSingle('file'), controller.bulkCreateRoutes);

router.get('/routes/:routeId/stops', requirePermission('transport.read'), controller.listStops);
router.post('/stops', requirePermission('transport.manage'), controller.createStop);
router.post('/stops/bulk', requirePermission('transport.manage'), csvUploadSingle('file'), controller.bulkCreateStops);

// /my-bus is self-service (student/parent viewing their own bus assignment)
// and deliberately has no transport.* permission gate — those roles are
// never granted transport.read, only staff manage the routes themselves.
router.get('/my-bus', controller.myBus);

/**
 * @swagger
 * /transport/roster:
 *   get:
 *     summary: Travel arrangements for every student the caller is authorized to see
 *     tags: [Transport]
 *     parameters:
 *       - in: query
 *         name: sectionId
 *         schema: { type: string }
 *         description: Narrows the list to one section. It can never widen it.
 *     responses:
 *       200: { description: Roster fetched }
 */
router.get('/roster', controller.roster);
router.post('/enroll', requirePermission('transport.manage'), controller.enrollStudent);
router.post('/enroll/bulk', requirePermission('transport.manage'), csvUploadSingle('file'), controller.bulkEnrollStudents);

export default router;
