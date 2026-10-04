import crypto from 'crypto';
import { env, isPlaceholderSecret } from '../../config/env.js';

/**
 * Inbound Chatflow-Pro webhooks: authenticate, then normalise.
 *
 * Nothing here decides who the sender is or what they may do — that stays in
 * whatsapp.agent.js (phone → ERP actor) and the MCP server. This file only
 * turns Chatflow's envelope into the channel-neutral message shape.
 *
 * Envelope (Chatflow-Pro services/outgoingWebhook.service.js):
 *   headers  X-ChatFlow-Event, X-ChatFlow-Delivery (uuid, same on every retry),
 *            X-ChatFlow-Signature-256: sha256=<hex HMAC of raw body, key = workspace Verify Token>
 *   body     { id, event, workspaceId, sentAt, data }
 *   data (message.received)
 *            { conversationId, contact: { id, name, phoneNumber },
 *              message: { id (the Meta wamid), type: TEXT|BUTTON|INTERACTIVE|IMAGE|…, body, from, timestamp } }
 */

/** Chatflow message types that carry words the customer typed. */
const TEXT_TYPES = new Set(['TEXT', 'BUTTON', 'INTERACTIVE']);

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Authenticates a Chatflow webhook. Returns { ok, reason } like the Meta
 * verifier, so the caller can log why without telling the caller.
 *
 * Two independent checks, each applied when configured:
 *   - CHATFLOW_WEBHOOK_TOKEN: `?token=` on the registered URL;
 *   - CHATFLOW_WEBHOOK_SECRET: X-ChatFlow-Signature-256 over the raw body.
 * With neither configured, development accepts (flagged) and anything else refuses.
 */
export function verifyChatflowRequest({ rawBody, headers = {}, query = {} }) {
  const tokenConfigured = Boolean(env.CHATFLOW_WEBHOOK_TOKEN);
  const secretConfigured = !isPlaceholderSecret(env.CHATFLOW_WEBHOOK_SECRET);

  if (!tokenConfigured && !secretConfigured) {
    return env.isDev ? { ok: true, reason: 'SIMULATION_UNVERIFIED' } : { ok: false, reason: 'SECRET_NOT_CONFIGURED' };
  }

  if (tokenConfigured) {
    const supplied = Array.isArray(query.token) ? query.token[0] : query.token;
    if (!supplied || !safeEqual(supplied, env.CHATFLOW_WEBHOOK_TOKEN)) return { ok: false, reason: 'TOKEN_MISMATCH' };
  }

  if (secretConfigured) {
    const header = headers['x-chatflow-signature-256'];
    if (!header || !rawBody) return { ok: false, reason: 'MISSING_SIGNATURE' };
    const expected = 'sha256=' + crypto.createHmac('sha256', env.CHATFLOW_WEBHOOK_SECRET).update(rawBody).digest('hex');
    if (!safeEqual(expected, header)) return { ok: false, reason: 'SIGNATURE_MISMATCH' };
  }

  return { ok: true, reason: 'VERIFIED' };
}

/**
 * Normalises a Chatflow event into zero or more channel-neutral messages:
 *
 *   { messageId, phoneNumber, text, type, timestamp, projectId, conversationId, metadata }
 *
 * `projectId` is Chatflow's workspace id (the API key's scope). Anything that
 * is not an inbound message — status receipts, template/campaign events —
 * yields an empty list and is simply acknowledged.
 */
export function parseChatflowEvent(payload) {
  if (!payload || payload.event !== 'message.received') return [];
  const data = payload.data ?? {};
  const message = data.message ?? {};
  const rawType = String(message.type ?? '').toUpperCase();
  const phone = message.from ?? data.contact?.phoneNumber ?? null;
  if (!message.id || !phone) return [];

  const hasText = TEXT_TYPES.has(rawType) && typeof message.body === 'string' && message.body.trim() !== '';
  return [
    {
      messageId: String(message.id),
      phoneNumber: String(phone).startsWith('+') ? String(phone) : `+${phone}`,
      // For media Chatflow puts a placeholder of its own in `body`; that is
      // not something the user said, so it is not handed to the agent.
      text: hasText ? message.body : null,
      type: hasText ? 'text' : rawType.toLowerCase() || 'unknown',
      timestamp: message.timestamp ?? payload.sentAt ?? null,
      projectId: payload.workspaceId ?? null,
      conversationId: data.conversationId ?? null,
      metadata: { deliveryId: payload.id ?? null, event: payload.event },
    },
  ];
}
