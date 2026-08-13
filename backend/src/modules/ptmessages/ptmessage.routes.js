import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './ptmessage.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: PTMessages
 *   description: Parent-Teacher direct messaging threads
 */

/**
 * @swagger
 * /pt-messages/threads:
 *   get:
 *     summary: List all message threads for the caller (parent sees own, teacher sees own)
 *     tags: [PTMessages]
 *     responses:
 *       200:
 *         description: Thread list fetched
 *   post:
 *     summary: Parent starts a new thread with the student's class teacher
 *     tags: [PTMessages]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [studentId]
 *             properties:
 *               studentId: { type: string }
 *               subject: { type: string }
 *     responses:
 *       201:
 *         description: Thread created or returned
 */
router.get('/student-teachers/:studentId', requirePermission('pt.messages.read'), controller.listStudentTeachers);
router.get('/threads', requirePermission('pt.messages.read'), controller.listThreads);
router.post('/threads', requirePermission('pt.messages.create'), controller.startThread);

/**
 * @swagger
 * /pt-messages/threads/{id}:
 *   get:
 *     summary: Get a thread with its full message history
 *     tags: [PTMessages]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Thread and messages fetched
 */
router.get('/threads/:id', requirePermission('pt.messages.read'), controller.getThread);

/**
 * @swagger
 * /pt-messages/send:
 *   post:
 *     summary: Send a message into an existing thread
 *     tags: [PTMessages]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [threadId, body]
 *             properties:
 *               threadId: { type: string }
 *               body: { type: string }
 *     responses:
 *       201:
 *         description: Message sent
 */
router.post('/send', requirePermission('pt.messages.send'), controller.sendMessage);

export default router;
