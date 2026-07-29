import crypto from 'crypto';
import { handleInboundMessage, converse } from './whatsapp.agent.js';
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

/**
 * Extracts inbound text messages from Meta's webhook envelope.
 * Non-text messages (images, audio) are surfaced with their type so the
 * caller can answer usefully instead of silently ignoring them.
 */
export function extractMessages(payload) {
  const out = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const msg of change?.value?.messages ?? []) {
        out.push({
          from: msg.from?.startsWith('+') ? msg.from : `+${msg.from}`,
          type: msg.type,
          text: msg.text?.body ?? msg.button?.text ?? msg.interactive?.button_reply?.title ?? null,
          id: msg.id,
        });
      }
    }
  }
  return out;
}

/**
 * Processes an inbound webhook: every text message is answered by the shared
 * agent core, so WhatsApp is not a second implementation of anything.
 */
export async function receiveWebhook(payload) {
  const messages = extractMessages(payload);
  if (!messages.length) {
    // Delivery receipts and status callbacks land here too; acknowledge them.
    return { received: true, handled: 0 };
  }

  const replies = [];
  for (const msg of messages) {
    if (!msg.text) {
      replies.push({
        to: msg.from,
        reply:
          msg.type === 'image'
            ? 'I can read photos of attendance registers in the app, but not over WhatsApp yet. Please send your question as text.'
            : 'Please send your question as a text message.',
      });
      continue;
    }
    try {
      const result = await handleInboundMessage({ from: msg.from, text: msg.text });
      replies.push({ to: msg.from, reply: result.reply });
      await sendMessage(msg.from, result.reply);
    } catch (err) {
      // A refusal ("you don't have permission to do that") is a legitimate,
      // expected answer and must reach the user as itself — burying it under
      // a generic failure leaves people retrying something that will never
      // work. Only genuinely unexpected errors get the vague message.
      const expected = err?.statusCode >= 400 && err?.statusCode < 500;
      const reply = expected
        ? err.message
        : 'Something went wrong handling that. Please try again.';
      if (!expected) logger.error(`WhatsApp agent failed for ${msg.from}: ${err.message}`);
      replies.push({ to: msg.from, reply });
      await sendMessage(msg.from, reply);
    }
  }

  return { received: true, handled: replies.length, replies };
}

/**
 * Outbound send. In simulation mode this logs rather than calling Meta, so the
 * whole flow can be exercised without credentials.
 */
export async function sendMessage(to, text) {
  if (!isLiveMode()) {
    logger.info(`[WhatsApp SIMULATION] → ${to}: ${String(text).slice(0, 200)}`);
    return { sent: false, simulated: true };
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${process.env.WA_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: to.replace(/^\+/, ''),
          type: 'text',
          text: { body: String(text).slice(0, 4096) },
        }),
      }
    );
    if (!res.ok) throw new Error(`WhatsApp send failed: ${res.status}`);
    return { sent: true };
  } catch (err) {
    logger.error(`WhatsApp send error: ${err.message}`);
    return { sent: false, error: err.message };
  }
}

/** Quick-reply buttons offered after each answer, mirroring WA interactive replies. */
const SUGGESTIONS = [
  { id: 'attendance', title: 'Attendance' },
  { id: 'fees', title: 'Fees' },
  { id: 'assignments', title: 'Assignments' },
];

/**
 * In-app WhatsApp simulator.
 *
 * Drives the same agent core as the real webhook, as the logged-in user, so
 * what an admin previews here is exactly what a parent would get on their
 * phone — including confirmation prompts for anything that writes.
 */
export async function simulate({ text, message }, actor) {
  const result = await converse({ actor, text: text ?? message ?? '' });

  return {
    reply: result.reply,
    buttons: result.awaitingConfirmation
      ? [{ id: 'yes', title: 'YES' }, { id: 'no', title: 'NO' }]
      : SUGGESTIONS,
    awaitingConfirmation: Boolean(result.awaitingConfirmation),
    mode: isLiveMode() ? 'LIVE' : 'SIMULATION',
    isStandIn: !isLiveMode(),
  };
}
