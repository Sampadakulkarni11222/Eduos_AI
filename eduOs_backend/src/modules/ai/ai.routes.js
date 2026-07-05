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

export default router;
