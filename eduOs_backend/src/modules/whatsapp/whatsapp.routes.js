import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './whatsapp.controller.js';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: WhatsApp
 *   description: >
 *     WhatsApp webhook (STAND-IN â€” no WhatsApp Business credentials
 *     configured). Webhook endpoints are public per Meta's protocol;
 *     /simulate is protected and lets you test the flow locally.
 */

/**
 * @swagger
 * /whatsapp/webhook:
 *   get:
 *     summary: WhatsApp webhook verification handshake
 *     tags: [WhatsApp]
 *     security: []
 *     responses:
 *       200:
 *         description: Challenge echoed back
 *   post:
 *     summary: Receive an inbound WhatsApp webhook event
 *     tags: [WhatsApp]
 *     security: []
 *     responses:
 *       200:
 *         description: Webhook received
 */
router.get('/webhook', controller.verifyWebhook);
router.post('/webhook', controller.receiveWebhook);

/**
 * @swagger
 * /whatsapp/simulate:
 *   post:
 *     summary: Simulate an inbound WhatsApp message without a real WhatsApp number
 *     tags: [WhatsApp]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [from, message]
 *             properties:
 *               from: { type: string, example: "+919999999999" }
 *               message: { type: string, example: "What's my attendance?" }
 *     responses:
 *       200:
 *         description: Simulated WhatsApp exchange
 */
router.post('/simulate', authenticate, requirePermission('ai.copilot.use'), controller.simulate);

export default router;
