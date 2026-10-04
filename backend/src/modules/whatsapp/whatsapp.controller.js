import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import * as service from './whatsapp.service.js';
import { verifyChatflowRequest } from './chatflow.inbound.js';

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

/**
 * Chatflow-Pro `message.received` webhook.
 *
 * Authenticated, then acknowledged at once and processed in the background:
 * Chatflow gives up on a delivery after 10s and retries, while an agent turn
 * that consults a model can take longer than that. A retry that does arrive is
 * absorbed by the message-id dedupe, so the early 200 changes latency, never
 * correctness.
 */
export const receiveChatflowWebhook = asyncHandler(async (req, res) => {
  const check = verifyChatflowRequest({ rawBody: req.rawBody, headers: req.headers, query: req.query });
  if (!check.ok) {
    logger.warn(`Rejected Chatflow webhook from ${req.ip} — ${check.reason}`);
    if (check.reason === 'SECRET_NOT_CONFIGURED') {
      logger.error('CHATFLOW_WEBHOOK_TOKEN / CHATFLOW_WEBHOOK_SECRET are unset, so Chatflow webhooks cannot be authenticated and are being refused.');
    }
    throw new AppError('Invalid webhook credentials', 401, [], 'WEBHOOK_SIGNATURE_INVALID');
  }
  if (check.reason === 'SIMULATION_UNVERIFIED') {
    logger.warn('Accepting an UNVERIFIED Chatflow webhook — development only, no CHATFLOW_WEBHOOK_TOKEN/SECRET set.');
  }

  logger.info('Chatflow webhook received', {
    event: req.body?.event ?? null,
    deliveryId: req.headers['x-chatflow-delivery'] ?? req.body?.id ?? null,
  });
  sendSuccess(res, { received: true }, 'Webhook received');

  service.receiveChatflowEvent(req.body).catch((err) => {
    logger.error(`Chatflow event processing failed: ${err.message}`);
  });
});

export const simulate = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.simulate(req.body, req.actor), 'Simulated WhatsApp exchange');
});

export const assistantLink = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.buildAssistantLink(req.actor), 'WhatsApp assistant link');
});

/**
 * Records that a family opened the WhatsApp hand-off.
 *
 * Deliberately fire-and-forget from the client's point of view: this is
 * product analytics, and a logging hiccup must never stop someone getting
 * help. Everything identifying is taken from the session rather than the
 * request body, so the numbers cannot be skewed by a crafted payload.
 */
export const trackAssistantLinkClick = asyncHandler(async (req, res) => {
  const device = String(req.body?.device ?? '').toUpperCase();
  await service.recordAssistantLinkClick(req.actor, {
    device: ['MOBILE', 'DESKTOP', 'TABLET'].includes(device) ? device : 'UNKNOWN',
    ip: req.ip,
  });
  sendSuccess(res, { recorded: true }, 'Click recorded');
});
