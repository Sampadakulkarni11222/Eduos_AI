import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './ai.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: AI
 *   description: >
 *     AI copilot chat (STAND-IN â€” rule-based, no LLM key configured).
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

export default router;
