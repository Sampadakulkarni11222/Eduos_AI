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
 *     The portal's AI assistant, reached over WhatsApp. The sender's number is
 *     resolved to their ERP account, and the turn then runs through the same
 *     agent core, permission checks and school scoping as the web assistant.
 *     Webhook endpoints are public per Meta's protocol and are authenticated by
 *     its X-Hub-Signature-256 HMAC instead; /simulate is session-protected and
 *     drives the same path locally. With no WA_* credentials set, outbound
 *     replies are logged rather than sent.
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
 *     description: >
 *       Verifies Meta's signature, then for each message: deduplicates on the
 *       provider message id, resolves the sender to an ERP account, loads the
 *       persisted conversation, answers through the shared agent inside that
 *       account's school scope, and replies. Always answers 200 once the
 *       signature checks out — a non-2xx makes Meta redeliver, which is how a
 *       single message turns into a loop.
 *     tags: [WhatsApp]
 *     security: []
 *     responses:
 *       200:
 *         description: Webhook received
 *       401:
 *         description: Missing or invalid X-Hub-Signature-256
 */
router.get('/webhook', controller.verifyWebhook);
router.post('/webhook', controller.receiveWebhook);

/**
 * @swagger
 * /whatsapp/chatflow/webhook:
 *   post:
 *     summary: Receive a Chatflow-Pro webhook event
 *     description: >
 *       Register this URL (with `?token=<CHATFLOW_WEBHOOK_TOKEN>`) as the
 *       Chatflow-Pro workspace webhook. `message.received` events run through
 *       the same pipeline as Meta's webhook — dedupe on the WhatsApp message id,
 *       phone → ERP account, shared agent + MCP — and the reply is sent back
 *       through Chatflow-Pro's Public API. Other events are acknowledged.
 *       Authenticated by the URL token and, when configured, the
 *       X-ChatFlow-Signature-256 HMAC.
 *     tags: [WhatsApp]
 *     security: []
 *     responses:
 *       200:
 *         description: Event accepted (processed asynchronously)
 *       401:
 *         description: Missing or invalid token / signature
 */
router.post('/chatflow/webhook', controller.receiveChatflowWebhook);

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

/**
 * @swagger
 * /whatsapp/assistant-link:
 *   get:
 *     summary: Deep link handing the signed-in user over to the school's WhatsApp
 *     description: >
 *       Offered to anyone holding `ai.copilot.use` — families and staff alike —
 *       except a Super Admin, who belongs to no single school. Returns
 *       `{ enabled: false, reason }` when WhatsApp is switched off, no number is
 *       configured, or the caller is not eligible, and the client hides the entry
 *       point in each case. The prefilled message is a bare greeting: the
 *       assistant identifies the sender from their number and opens with their
 *       own records, so nothing identifying is put in the user's mouth or
 *       trusted from the client.
 *     tags: [WhatsApp]
 *     responses:
 *       200:
 *         description: Link details, or enabled=false with a reason
 */
router.get('/assistant-link', authenticate, requirePermission('ai.copilot.use'), controller.assistantLink);

/**
 * @swagger
 * /whatsapp/assistant-link/click:
 *   post:
 *     summary: Record that the WhatsApp hand-off was opened (product analytics)
 *     tags: [WhatsApp]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               device: { type: string, enum: [MOBILE, DESKTOP, TABLET] }
 *     responses:
 *       200:
 *         description: Click recorded
 */
router.post('/assistant-link/click', authenticate, requirePermission('ai.copilot.use'), controller.trackAssistantLinkClick);

export default router;
