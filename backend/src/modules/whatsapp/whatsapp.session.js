import crypto from 'crypto';
import { WhatsappConversation, WhatsappMessage } from '../../models/whatsappConversation.model.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * Conversation state for WhatsApp.
 *
 * Everything here is storage and trimming; there is no authorization in this
 * file and there must not be. What it buys is the thing a webhook cannot have
 * for free: a message arriving now knowing what the message twenty minutes ago
 * was about, across restarts and across instances.
 */

/**
 * The one canonical phone form: digits only, no '+', no spaces.
 *
 * Meta sends `919999999999`; the ERP stores `+919999999999`; a human typing
 * into the admin UI produces `+91 99999 99999`. Comparing any two of those as
 * strings gives the wrong answer, so every comparison in this module goes
 * through here first.
 */
export function normalisePhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  // E.164 tops out at 15 digits; under 8 cannot be a real number with a
  // country code in front of it.
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/**
 * How long a thread may sit idle before the next message starts a fresh
 * session.
 *
 * Not a security boundary — identity is re-resolved every single turn either
 * way. It is a relevance boundary: carrying yesterday's "which one is due
 * first?" into an unrelated question tomorrow makes the assistant worse, not
 * better.
 */
const IDLE_MINUTES = Number(env.WHATSAPP_SESSION_IDLE_MINUTES ?? 120);

/** Turns of history handed to the model. See buildHistory() for why it is small. */
const HISTORY_TURNS = Number(env.WHATSAPP_HISTORY_TURNS ?? 10);

const newSessionId = () => `wa-${crypto.randomBytes(8).toString('hex')}`;

/**
 * Finds or creates the thread for a number, rotating the session if it has
 * gone cold.
 *
 * The upsert is keyed on the phone alone, so two webhooks delivered in
 * parallel for the same sender cannot create two threads for it.
 */
export async function loadConversation(phone) {
  const key = normalisePhone(phone);
  if (!key) return null;

  const now = new Date();
  let conversation = await WhatsappConversation.findOne({ phone: key });

  if (!conversation) {
    conversation = await WhatsappConversation.findOneAndUpdate(
      { phone: key },
      {
        $setOnInsert: {
          phone: key,
          sessionId: newSessionId(),
          sessionStartedAt: now,
          lastMessageAt: now,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return conversation;
  }

  const idleMs = now.getTime() - new Date(conversation.lastMessageAt ?? now).getTime();
  if (idleMs > IDLE_MINUTES * 60 * 1000) {
    conversation.sessionId = newSessionId();
    conversation.sessionStartedAt = now;
    await conversation.save();
  }

  return conversation;
}

/**
 * Records who the number resolved to on this turn.
 *
 * Written after resolution rather than trusted before it — this row is a
 * record of what happened, never an input to the next authorization decision.
 */
export async function attachIdentity(conversation, resolved) {
  if (!conversation) return conversation;

  const actor = resolved?.actor ?? null;
  conversation.accountId = actor?.accountId ?? null;
  conversation.erpProfileId = actor?.profileId ?? null;
  conversation.role = actor?.roleKey ?? null;
  conversation.tenantId = actor?.tenantId ?? null;
  conversation.displayName = actor?.displayName ?? null;
  conversation.status = actor ? 'ACTIVE' : 'UNLINKED';
  await conversation.save();
  return conversation;
}

/**
 * Records an inbound message, refusing a provider id already seen.
 *
 * This is the duplicate-webhook defence, and it is a unique index rather than
 * a lookup-then-insert because the redeliveries that matter are the concurrent
 * ones. Returns `{ duplicate: true }` when the id is already stored, and the
 * caller answers 200 without processing it again — a redelivered "YES" must
 * not execute a pending write twice.
 */
export async function recordInbound(conversation, { providerMessageId, type = 'text', text }) {
  try {
    const doc = await WhatsappMessage.create({
      conversationId: conversation._id,
      sessionId: conversation.sessionId,
      providerMessageId: providerMessageId ?? null,
      direction: 'INBOUND',
      messageType: type,
      text: text ?? '',
      processingStatus: 'RECEIVED',
    });
    return { duplicate: false, message: doc };
  } catch (err) {
    if (err?.code === 11000) {
      logger.info(`Ignoring duplicate WhatsApp delivery ${providerMessageId}`);
      return { duplicate: true, message: null };
    }
    throw err;
  }
}

/** Records what we said back, plus how the turn was resolved. */
export async function recordOutbound(conversation, { text, metadata = null, status = 'SENT' }) {
  try {
    await WhatsappMessage.create({
      conversationId: conversation._id,
      sessionId: conversation.sessionId,
      direction: 'OUTBOUND',
      messageType: 'text',
      text: text ?? '',
      metadata,
      processingStatus: status,
    });
    conversation.lastMessageAt = new Date();
    conversation.messageCount = (conversation.messageCount ?? 0) + 1;
    await conversation.save();
  } catch (err) {
    // Losing the transcript must never cost the user their answer.
    logger.warn(`Could not persist WhatsApp outbound message: ${err.message}`);
  }
}

export async function markProcessed(messageDoc, { status, metadata = null }) {
  if (!messageDoc) return;
  try {
    messageDoc.processingStatus = status;
    if (metadata) messageDoc.metadata = metadata;
    await messageDoc.save();
  } catch (err) {
    logger.warn(`Could not update WhatsApp message status: ${err.message}`);
  }
}

/**
 * The recent turns of this session, oldest first.
 *
 * Bounded on purpose, and bounded twice: to the current session (an unrelated
 * conversation from last week is noise, not context) and to HISTORY_TURNS
 * messages within it. Sending the whole transcript would grow every request
 * without bound and make the model's job harder, not easier — the follow-ups
 * this exists to resolve ("what about last month?", "which one is due first?")
 * only ever refer a turn or two back.
 *
 * Text is truncated because history is here to supply *reference*, not to be
 * re-read in full.
 */
export async function buildHistory(conversation) {
  if (!conversation) return [];
  const rows = await WhatsappMessage.find({
    conversationId: conversation._id,
    sessionId: conversation.sessionId,
    processingStatus: { $ne: 'SKIPPED_DUPLICATE' },
  })
    .sort({ createdAt: -1 })
    .limit(HISTORY_TURNS)
    .lean();

  return rows
    .reverse()
    .map((row) => ({
      role: row.direction === 'INBOUND' ? 'user' : 'assistant',
      text: String(row.text ?? '').slice(0, 500),
    }))
    .filter((turn) => turn.text.length > 0);
}
