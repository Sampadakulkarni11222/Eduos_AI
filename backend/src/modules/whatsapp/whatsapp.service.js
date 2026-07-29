import crypto from 'crypto';
import { chat } from '../ai/ai.service.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * WhatsApp integration.
 *
 * Live mode requires Meta WhatsApp Business Cloud API credentials
 * (WA_PHONE_NUMBER_ID / WA_ACCESS_TOKEN / WA_APP_SECRET) — when absent, the
 * module runs in SIMULATION mode: the webhook verifies per Meta's handshake
 * and logs inbound payloads, and /simulate drives the same copilot brain as
 * the logged-in user so admins can preview the bot without a real number.
 */

export function isLiveMode() {
  return Boolean(process.env.WA_PHONE_NUMBER_ID && process.env.WA_ACCESS_TOKEN);
}

export function verifyWebhook({ mode, token, challenge }) {
  if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
    return challenge;
  }
  return null;
}

/**
 * Validates Meta's X-Hub-Signature-256 over the raw request body.
 *
 * Without this, anyone who learns the webhook URL can POST arbitrary "inbound
 * messages" that appear to come from any phone number. That is only noisy
 * today (the handler logs), but Phase 5 makes webhook payloads drive real
 * actions, so the check belongs here before that lands.
 *
 * Returns true when no WA_APP_SECRET is configured (simulation mode) — the
 * webhook has nothing to impersonate until live credentials exist.
 */
export function verifySignature(rawBody, signatureHeader) {
  const appSecret = process.env.WA_APP_SECRET;
  if (!appSecret) return true;
  if (!signatureHeader || !rawBody) return false;

  const expected =
    'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signatureHeader));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function receiveWebhook(payload) {
  logger.info(`WhatsApp webhook received: ${JSON.stringify(payload).slice(0, 500)}`);
  return { received: true };
}

/** Quick-reply buttons offered after each answer, mirroring WA interactive replies. */
const SUGGESTIONS = [
  { id: 'attendance', title: 'Attendance' },
  { id: 'fees', title: 'Fees' },
  { id: 'assignments', title: 'Assignments' },
];

export async function simulate({ text, message }, actor) {
  const inbound = text ?? message ?? '';
  const result = await chat({ message: inbound }, actor);
  return {
    reply: result.reply,
    buttons: SUGGESTIONS,
    mode: isLiveMode() ? 'LIVE' : 'SIMULATION',
    isStandIn: !isLiveMode(),
  };
}
