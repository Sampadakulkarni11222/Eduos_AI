import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './seat.controller.js';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Seats
 *   description: Seat purchase, extra-seat requests and platform approval
 */

router.use(authenticate);

/* ── School Admin ─────────────────────────────────────────── */
//
// These carry no school in the path on purpose: middleware/auth.js has already
// pinned the acting school, so a School Admin reads their own seats and cannot
// name another's. `seats.read` and `seats.request` are granted to ADMIN and
// SUPER_ADMIN only; every other role gets the 403 requirePermission gives
// everywhere else.

/**
 * @swagger
 * /seats/summary:
 *   get:
 *     summary: The acting school's seat position
 *     description: Purchased, approved, used and available seats, plus the seat price list.
 *     tags: [Seats]
 *     responses:
 *       200: { description: Seat summary fetched }
 */
router.get('/summary', requirePermission('seats.read', 'ALL'), controller.getSummary);

/**
 * @swagger
 * /seats/history:
 *   get:
 *     summary: The acting school's seat history
 *     tags: [Seats]
 *     responses:
 *       200: { description: Seat history fetched }
 */
router.get('/history', requirePermission('seats.read', 'ALL'), controller.getHistory);

/**
 * @swagger
 * /seats/price:
 *   get:
 *     summary: The per-seat price in force for the acting school
 *     description: >
 *       The rate a new extra-seat request will be quoted at — this school's own
 *       price when the platform has set one, and the platform default otherwise.
 *       Read-only for a School Admin; only a Super Admin can change it.
 *     tags: [Seats]
 *     responses:
 *       200: { description: Seat price fetched }
 */
router.get('/price', requirePermission('seats.read', 'ALL'), controller.getMyPrice);

/**
 * @swagger
 * /seats/price/history:
 *   get:
 *     summary: The acting school's per-seat pricing history
 *     tags: [Seats]
 *     responses:
 *       200: { description: Seat price history fetched }
 */
router.get('/price/history', requirePermission('seats.read', 'ALL'), controller.getMyPriceHistory);

/**
 * @swagger
 * /seats/requests:
 *   get:
 *     summary: Extra-seat requests — this school's, or the platform's for a Super Admin
 *     tags: [Seats]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING_PAYMENT, PAID, APPROVED, REJECTED] }
 *     responses:
 *       200: { description: Seat requests fetched }
 *   post:
 *     summary: Ask for extra seats
 *     description: >
 *       The body carries a seat count and an optional reason. The price is
 *       calculated server-side from the platform price list; any amount in the
 *       body is ignored.
 *     tags: [Seats]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [seats]
 *             properties:
 *               seats: { type: integer, minimum: 1, example: 25 }
 *               reason: { type: string }
 *     responses:
 *       201: { description: Extra seat request created }
 */
router.get('/requests', requirePermission('seats.read', 'ALL'), controller.listRequests);
router.post('/requests', requirePermission('seats.request', 'ALL'), controller.createRequest);

/**
 * @swagger
 * /seats/requests/{id}:
 *   get:
 *     summary: One extra-seat request
 *     tags: [Seats]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Seat request fetched }
 */
router.get('/requests/:id', requirePermission('seats.read', 'ALL'), controller.getRequest);

/**
 * @swagger
 * /seats/requests/{id}/pay:
 *   post:
 *     summary: Start payment for an extra-seat request
 *     description: >
 *       Creates the gateway order for the amount the server calculated. Paying
 *       does not allocate seats — the request becomes PAID and waits for a
 *       Super Admin decision.
 *     tags: [Seats]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Seat payment started }
 */
router.post('/requests/:id/pay', requirePermission('seats.request', 'ALL'), controller.payRequest);

/**
 * @swagger
 * /seats/payments/verify:
 *   post:
 *     summary: Confirm a seat checkout completed in the browser
 *     description: >
 *       Verifies the Checkout signature and settles through the same path the
 *       webhook uses, so it cannot double-credit a request.
 *     tags: [Seats]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId, paymentId, signature]
 *             properties:
 *               orderId: { type: string }
 *               paymentId: { type: string }
 *               signature: { type: string }
 *     responses:
 *       200: { description: Seat payment verified }
 */
router.post('/payments/verify', requirePermission('seats.request', 'ALL'), controller.verifyPayment);

/* ── Platform (Super Admin) ───────────────────────────────── */
//
// `seats.manage` and `seats.approve` are in SUPER_ADMIN_ONLY, so no school-level
// role holds them and none can be granted them through the roles API either
// (see roles/role.service.js).

/**
 * @swagger
 * /seats/schools:
 *   get:
 *     summary: Every school's seat position (Super Admin)
 *     tags: [Seats]
 *     responses:
 *       200: { description: School seat summaries fetched }
 */
router.get('/schools', requirePermission('seats.manage', 'ALL'), controller.listSchoolSeats);

/**
 * @swagger
 * /seats/prices:
 *   get:
 *     summary: Every school's current per-seat price (Super Admin)
 *     tags: [Seats]
 *     responses:
 *       200: { description: School seat prices fetched }
 */
router.get('/prices', requirePermission('seats.pricing.manage', 'ALL'), controller.listSchoolPrices);

/**
 * @swagger
 * /seats/prices/{priceId}:
 *   patch:
 *     summary: Activate or deactivate a price version, or edit its note (Super Admin)
 *     description: >
 *       The only in-place edit there is. It changes whether a version is
 *       resolvable, never what it charged — an amount change is a new version,
 *       raised through POST /seats/schools/{tenantId}/price.
 *     tags: [Seats]
 *     parameters:
 *       - in: path
 *         name: priceId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, enum: [ACTIVE, INACTIVE] }
 *               note: { type: string }
 *     responses:
 *       200: { description: Seat price updated }
 */
router.patch('/prices/:priceId', requirePermission('seats.pricing.manage', 'ALL'), controller.updatePrice);

/**
 * @swagger
 * /seats/schools/{tenantId}/price:
 *   get:
 *     summary: One school's per-seat price in force (Super Admin)
 *     tags: [Seats]
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Seat price fetched }
 *   post:
 *     summary: Set this school's per-seat price (Super Admin)
 *     description: >
 *       Writes a new price version and closes the previous one, so the price a
 *       paid request was quoted at survives the change. `effectiveFrom` may be
 *       dated forward to schedule a rise; it may not be dated into the past.
 *     tags: [Seats]
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [unitPricePaise]
 *             properties:
 *               unitPricePaise: { type: integer, minimum: 1, example: 10000 }
 *               currency: { type: string, example: INR }
 *               effectiveFrom: { type: string, format: date-time }
 *               note: { type: string }
 *     responses:
 *       201: { description: Seat price set }
 *       400: { description: Negative, zero or otherwise invalid price }
 *       409: { description: Repriced concurrently by someone else }
 */
router.get('/schools/:tenantId/price', requirePermission('seats.pricing.manage', 'ALL'), controller.getSchoolPrice);
router.post('/schools/:tenantId/price', requirePermission('seats.pricing.manage', 'ALL'), controller.setSchoolPrice);
router.get('/schools/:tenantId/price/history', requirePermission('seats.pricing.manage', 'ALL'), controller.getSchoolPriceHistory);

/**
 * @swagger
 * /seats/schools/{tenantId}:
 *   get:
 *     summary: One school's seat position (Super Admin)
 *     tags: [Seats]
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Seat summary fetched }
 *   post:
 *     summary: Sell a school seats, or correct its balance (Super Admin)
 *     tags: [Seats]
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [seats]
 *             properties:
 *               seats: { type: integer, example: 200 }
 *               note: { type: string }
 *               event: { type: string, enum: [PURCHASE, ADJUSTMENT] }
 *     responses:
 *       200: { description: Seats granted }
 */
router.get('/schools/:tenantId', requirePermission('seats.manage', 'ALL'), controller.getSchoolSeats);
router.get('/schools/:tenantId/history', requirePermission('seats.manage', 'ALL'), controller.getSchoolSeatHistory);
router.post('/schools/:tenantId', requirePermission('seats.manage', 'ALL'), controller.grantSchoolSeats);

/**
 * @swagger
 * /seats/requests/{id}/decision:
 *   post:
 *     summary: Approve or reject a paid extra-seat request (Super Admin)
 *     description: >
 *       Only a PAID request can be decided, only once, and never by the school
 *       that raised it. Approval is what makes the seats usable.
 *     tags: [Seats]
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
 *             required: [decision]
 *             properties:
 *               decision: { type: string, enum: [APPROVED, REJECTED] }
 *               note: { type: string }
 *     responses:
 *       200: { description: Seat request decided }
 *       409: { description: Unpaid, or already decided }
 */
router.post('/requests/:id/decision', requirePermission('seats.approve', 'ALL'), controller.decideRequest);

export default router;
