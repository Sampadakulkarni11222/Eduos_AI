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


// ── Route requests ──
// A student asks for a place on a route; a transport.manage holder decides,
// and the approval both creates the travel arrangement and raises the invoice
// for the route's fare.

/**
 * @swagger
 * /transport/routes/available:
 *   get:
 *     summary: Routes a student may choose from, with stops and fare
 *     description: >
 *       Self-service, like /my-bus. Students hold no transport.read grant, and
 *       this returns only what choosing a route needs — name, vehicle, stops
 *       and fare. The driver's contact details are not included; a family gets
 *       those for the route they are actually on, from /my-bus.
 *     tags: [Transport]
 *     responses:
 *       200:
 *         description: Routes fetched
 */
router.get('/routes/available', requirePermission('transport.request'), controller.routesForStudent);

/**
 * @swagger
 * /transport/requests/mine:
 *   get:
 *     summary: The signed-in student's own transport requests
 *     tags: [Transport]
 *     responses:
 *       200:
 *         description: Your transport requests fetched
 */
router.get('/requests/mine', requirePermission('transport.request'), controller.listMyTransportRequests);

/**
 * @swagger
 * /transport/requests/review:
 *   get:
 *     summary: Transport staff review queue
 *     tags: [Transport]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, APPROVED, REJECTED, CANCELLED, ALL]
 *     responses:
 *       200:
 *         description: Transport requests fetched
 */
router.get('/requests/review', requirePermission('transport.manage'), controller.listTransportRequestsForReview);

/**
 * @swagger
 * /transport/requests:
 *   post:
 *     summary: Ask for a place on a route (created as PENDING for staff)
 *     tags: [Transport]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [routeId, stopId]
 *             properties:
 *               routeId: { type: string }
 *               stopId: { type: string }
 *               direction: { type: string, enum: [BOTH, PICKUP, DROP] }
 *     responses:
 *       201:
 *         description: Request submitted for approval
 *       409:
 *         description: You already have a transport request for this year
 */
router.post('/requests', requirePermission('transport.request'), controller.requestRoute);

/**
 * @swagger
 * /transport/requests/{id}/cancel:
 *   patch:
 *     summary: Withdraw your own pending transport request
 *     tags: [Transport]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Request cancelled
 */
router.patch('/requests/:id/cancel', requirePermission('transport.request'), controller.cancelTransportRequest);

/**
 * @swagger
 * /transport/requests/{id}/decision:
 *   patch:
 *     summary: Approve or reject a transport request
 *     description: >
 *       An approval creates the bus enrolment and, when the route carries a
 *       fare, raises an invoice for it against the student's enrolment —
 *       payable through the ordinary fees flow.
 *     tags: [Transport]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
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
 *         description: Request decided
 *       409:
 *         description: Already decided
 */
router.patch('/requests/:id/decision', requirePermission('transport.manage'), controller.decideTransportRequest);

export default router;
