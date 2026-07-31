import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import * as service from './whatsapp.service.js';

export const verifyWebhook = asyncHandler(async (req, res) => {
  const challenge = service.verifyWebhook({
    mode: req.query['hub.mode'],
    token: req.query['hub.verify_token'],
    challenge: req.query['hub.challenge'],
  });
  if (challenge === null) throw new AppError('Webhook verification failed', 403);
  res.status(200).send(challenge);
});

export const receiveWebhook = asyncHandler(async (req, res) => {
  const check = service.verifySignature(req.rawBody, req.headers['x-hub-signature-256']);

  if (!check.ok) {
    // The reason is logged, never returned: telling an unauthenticated caller
    // whether we hold a secret at all is free reconnaissance.
    logger.warn(`Rejected WhatsApp webhook from ${req.ip} — ${check.reason}`);
    if (check.reason === 'SECRET_NOT_CONFIGURED') {
      logger.error(
        'WA_APP_SECRET is unset or still a shipped placeholder, so inbound WhatsApp webhooks ' +
          'cannot be authenticated and are being refused. Set it to the App Secret from the ' +
          'Meta app dashboard.'
      );
    }
    throw new AppError('Invalid webhook signature', 401, [], 'WEBHOOK_SIGNATURE_INVALID');
  }

  if (check.reason === 'SIMULATION_UNVERIFIED') {
    logger.warn('Accepting an UNVERIFIED WhatsApp webhook — development only, no WA_APP_SECRET set.');
  }

  sendSuccess(res, await service.receiveWebhook(req.body), 'Webhook received');
});

export const simulate = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.simulate(req.body, req.actor), 'Simulated WhatsApp exchange');
});
