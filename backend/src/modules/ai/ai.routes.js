import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { aiRateLimiter } from '../../middleware/rateLimiter.js';
import * as controller from './ai.controller.js';

const router = Router();
// authenticate first, so the limiter can key on the resolved profile rather
// than on an IP shared by a whole school.
router.use(authenticate);
router.use(aiRateLimiter);

/**
 * @swagger
 * tags:
 *   name: AI
 *   description: >
 *     AI copilot chat (STAND-IN — rule-based, no LLM key configured).
 *     See docs/ARCHITECTURE.md for how to wire a real model in.
 */

/**
 * @swagger
 * /ai/chat:
 *   post:
 *     summary: Send a message to the AI copilot stand-in
 *     tags: [AI]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string }
 *     responses:
 *       200:
 *         description: AI response generated
 */
router.post('/chat', requirePermission('ai.copilot.use'), controller.chat);

/**
 * @swagger
 * /ai/agent:
 *   post:
 *     summary: Agentic assistant — answers questions and proposes actions
 *     description: >
 *       Shared core behind both the in-app assistant and WhatsApp. Reads run
 *       immediately; anything that writes comes back as a proposal with a
 *       confirmToken and is only performed once /ai/agent/confirm is called.
 *       Every tool is authorized against the caller's live permissions at
 *       execution time — the assistant can never do more than the user could.
 *     tags: [AI]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string }
 *               source: { type: string, enum: [WEB, WHATSAPP] }
 *     responses:
 *       200:
 *         description: Reply, plus an `action` block when confirmation is needed
 */
router.post('/agent', requirePermission('ai.copilot.use'), controller.agent);

/**
 * @swagger
 * /ai/agent/confirm:
 *   post:
 *     summary: Confirm (or decline) an action the agent proposed
 *     tags: [AI]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [confirmToken]
 *             properties:
 *               confirmToken: { type: string }
 *               accept: { type: boolean, default: true }
 *     responses:
 *       200:
 *         description: Action executed or declined
 */
router.post('/agent/confirm', requirePermission('ai.copilot.use'), controller.agentConfirm);

/**
 * @swagger
 * /ai/agent/capabilities:
 *   get:
 *     summary: Tools this caller is actually allowed to use
 *     tags: [AI]
 *     responses:
 *       200:
 *         description: Capability list
 */
router.get('/agent/capabilities', requirePermission('ai.copilot.use'), controller.agentCapabilities);

/**
 * @swagger
 * /ai/tutor/status:
 *   get:
 *     summary: Whether LLM tutoring is configured, and the available modes
 *     tags: [AI]
 *     responses:
 *       200: { description: Tutor status }
 */
router.get('/tutor/status', requirePermission('ai.copilot.use'), controller.tutorStatus);

/**
 * @swagger
 * /ai/tutor/syllabus:
 *   get:
 *     summary: The caller's own subjects, resolved from their enrolment
 *     description: >
 *       There is no parameter for whose syllabus — it is always the caller's
 *       (or, for a parent, their child's).
 *     tags: [AI]
 *     responses:
 *       200: { description: Syllabus fetched }
 */
router.get('/tutor/syllabus', requirePermission('ai.copilot.use'), controller.tutorSyllabus);

/**
 * @swagger
 * /ai/tutor:
 *   post:
 *     summary: Syllabus-aware tutoring grounded in the student's own subjects and results
 *     description: >
 *       A subject outside the student's own syllabus is refused. When no LLM is
 *       configured the response carries `generated: false` and a study scaffold
 *       built from real data rather than a fabricated explanation.
 *     tags: [AI]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [topic]
 *             properties:
 *               topic: { type: string }
 *               subject: { type: string, description: "Must be one of the student's own subjects" }
 *               mode: { type: string, enum: [explain, questions, flashcards, notes, mindmap] }
 *     responses:
 *       200: { description: Tutor response }
 */
router.post('/tutor', requirePermission('ai.copilot.use'), controller.tutor);

/**
 * @swagger
 * /ai/credits:
 *   get:
 *     summary: AI credit balance for the caller (free allowance, purchased balance, reset date)
 *     description: >
 *       Staff are not metered and receive `metered: false`. Students and parents
 *       receive their free monthly allowance, remaining purchased credits, and
 *       the packs they can buy.
 *     tags: [AI]
 *     responses:
 *       200: { description: AI credit status }
 */
router.get('/credits', requirePermission('ai.copilot.use'), controller.creditStatus);

/**
 * @swagger
 * /ai/credits/packs:
 *   get:
 *     summary: Purchasable credit packs and the free monthly allowance
 *     tags: [AI]
 *     responses:
 *       200: { description: Credit packs }
 */
router.get('/credits/packs', requirePermission('ai.copilot.use'), controller.creditPacks);

/**
 * @swagger
 * /ai/credits/orders:
 *   get:
 *     summary: The caller's own top-up history
 *     tags: [AI]
 *     responses:
 *       200: { description: Credit orders fetched }
 */
router.get('/credits/orders', requirePermission('ai.copilot.use'), controller.creditOrders);

/**
 * @swagger
 * /ai/credits/purchase:
 *   post:
 *     summary: Buy a credit pack for your own account
 *     description: >
 *       Credits are added only after the gateway captures the payment. With no
 *       gateway configured the order is created and the caller is told to pay at
 *       the school office — no fake success. Credits are deliberately not billed
 *       through fee invoices, so they never appear in the school's fee ledger or
 *       a family's outstanding dues.
 *     tags: [AI]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [packKey]
 *             properties:
 *               packKey: { type: string, enum: [STARTER, STANDARD, TERM] }
 *     responses:
 *       201: { description: Credits added }
 *       200: { description: Order created, payment pending }
 *       402: { description: Not applicable — see /ai/tutor for the exhausted case }
 */
router.post('/credits/purchase', requirePermission('ai.copilot.use'), controller.buyCredits);

/**
 * @swagger
 * /ai/credits/purchase/verify:
 *   post:
 *     summary: Grant a credit pack after the payer completes gateway checkout
 *     description: >
 *       Verifies Razorpay Checkout's signature, confirms with the gateway that
 *       the payment actually captured, checks the amount against the order, and
 *       then grants the pack through the same idempotent claim the sandbox path
 *       uses — so a resubmitted callback cannot grant twice.
 *     tags: [AI]
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
 *       200:
 *         description: Credits added (or already added)
 *       400:
 *         description: Signature verification failed
 */
router.post('/credits/purchase/verify', requirePermission('ai.copilot.use'), controller.verifyCreditPurchase);

/**
 * @swagger
 * /ai/transcribe:
 *   post:
 *     summary: Transcribe spoken audio and detect language
 *     tags: [AI]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [audioBase64]
 *             properties:
 *               audioBase64: { type: string }
 *               mediaType: { type: string, default: 'audio/webm' }
 *     responses:
 *       200:
 *         description: Audio transcribed
+ */
router.post('/transcribe', requirePermission('ai.copilot.use'), controller.transcribe);

export default router;

