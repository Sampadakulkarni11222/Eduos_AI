import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './ticket.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Tickets
 *   description: Support ticket queue
 */

/**
 * @swagger
 * /tickets:
 *   get:
 *     summary: List tickets (scoped to OWN raised/assigned for non-managers)
 *     tags: [Tickets]
 *     responses:
 *       200:
 *         description: List of tickets
 *   post:
 *     summary: Raise a support ticket
 *     tags: [Tickets]
 *     responses:
 *       201:
 *         description: Ticket created
 */
router.get('/', requirePermission('tickets.read'), controller.list);
router.post('/', requirePermission('tickets.create'), controller.create);

/**
 * @swagger
 * /tickets/{id}:
 *   get:
 *     summary: Get a ticket with its message thread
 *     tags: [Tickets]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Ticket fetched
 *   patch:
 *     summary: Update a ticket's status/assignee/priority
 *     tags: [Tickets]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Ticket updated
 */
router.get('/:id', requirePermission('tickets.read'), controller.getById);
router.patch('/:id', requirePermission('tickets.manage'), controller.update);

/**
 * @swagger
 * /tickets/reply:
 *   post:
 *     summary: Reply to a ticket
 *     tags: [Tickets]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ticketId, body]
 *             properties:
 *               ticketId: { type: string }
 *               body: { type: string }
 *     responses:
 *       201:
 *         description: Reply added
 */
router.post('/reply', requirePermission('tickets.respond'), controller.reply);

export default router;
