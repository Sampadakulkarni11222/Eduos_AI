import { chat } from '../ai/ai.service.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * STAND-IN implementation. core-api's whatsapp module talks to the WhatsApp
 * Business Cloud API. No WhatsApp credentials are configured here, so the
 * webhook just verifies (per Meta's handshake) and logs inbound payloads,
 * and /simulate lets you exercise the same flow locally without a real
 * WhatsApp number.
 */
export function verifyWebhook({ mode, token, challenge }) {
  if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
    return challenge;
  }
  return null;
}

export function receiveWebhook(payload) {
  logger.info(`WhatsApp webhook received: ${JSON.stringify(payload).slice(0, 500)}`);
  return { received: true };
}

export function simulate({ from, message }) {
  const { reply } = chat({ message });
  return { from, inbound: message, outbound: reply, isStandIn: true };
}
