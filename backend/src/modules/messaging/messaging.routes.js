import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './messaging.service.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Messaging
 *   description: Operational WhatsApp/SMS/email outbox, delivery states and contact preferences
 */

/** Every signed-in person manages their own preferences (opt-in, language, quiet hours). */
router.get('/preferences', asyncHandler(async (req, res) => sendSuccess(res, await service.getPreferences(req.actor))));
router.put('/preferences', asyncHandler(async (req, res) => sendSuccess(res, await service.updatePreferences(req.actor, req.body), 'Preferences saved')));

router.get('/channels', requirePermission('messaging.read'), asyncHandler(async (_req, res) => sendSuccess(res, service.channelStatus())));
router.get('/outbox', requirePermission('messaging.read'), asyncHandler(async (req, res) =>
  sendSuccess(res, await service.listOutbox(req.actor, req.scope, req.query))));

export default router;
