import crypto from 'crypto';
import { handleInboundMessage, resolveActorByPhone, converse } from './whatsapp.agent.js';
import { t } from '../../utils/language.js';
import { env, isWhatsappLive, isWhatsappSignatureConfigured } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { sendText as sendChatflowText } from './chatflow.client.js';
import { parseChatflowEvent } from './chatflow.inbound.js';
import { chunkForWhatsApp } from '../ai/agent/present.js';
import { Profile } from '../../models/profile.model.js';
import { AuditLog } from '../../models/auditLog.model.js';
import {
  loadConversation,
  attachIdentity,
  recordInbound,
  recordOutbound,
  markProcessed,
  buildHistory,
  latestContinuation,
  maskPhone,
} from './whatsapp.session.js';

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
  return isWhatsappLive();
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
 * messages" that appear to come from any phone number — and those payloads now
 * drive real agent actions, not just log lines.
 *
 * Two failure modes this had to grow out of:
 *
 *   1. It returned true whenever WA_APP_SECRET was empty, so the shipped
 *      `.env.example` (which leaves it blank) produced an unauthenticated
 *      webhook. Absence of a secret is no longer permission — outside
 *      development it is a refusal, and production will not boot that way.
 *   2. `.env` carried `change-this-app-secret`, which is truthy, so every
 *      genuine webhook was checked against a secret Meta had never seen and
 *      rejected 401. Inbound WhatsApp was dead and nothing said so. Shipped
 *      placeholders now count as "not configured" rather than as a real key.
 *
 * Returns { ok, reason } rather than a bare boolean so the caller can log why
 * a webhook was refused — "no secret configured" and "bad signature" need very
 * different responses from whoever is on call.
 */
export function verifySignature(rawBody, signatureHeader) {
  if (!isWhatsappSignatureConfigured()) {
    // Fail closed anywhere that could plausibly be reachable from the internet.
    if (!env.isDev) {
      return { ok: false, reason: 'SECRET_NOT_CONFIGURED' };
    }
    return { ok: true, reason: 'SIMULATION_UNVERIFIED' };
  }

  if (!signatureHeader || !rawBody) return { ok: false, reason: 'MISSING_SIGNATURE' };

  const expected =
    'sha256=' + crypto.createHmac('sha256', env.WA_APP_SECRET).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signatureHeader));
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  return ok ? { ok: true, reason: 'VERIFIED' } : { ok: false, reason: 'SIGNATURE_MISMATCH' };
}

/**
 * Normalises a configured number into the digits-only form wa.me requires.
 *
 * wa.me rejects "+", spaces and punctuation, so `+91 99999 99999` silently
 * produces a broken link rather than an error. Returns null when what is left
 * cannot be a real international number.
 */
export function normaliseWhatsappNumber(raw) {
  const digits = String(raw ?? '').replace(/[^\d]/g, '');
  // E.164 allows up to 15 digits; anything under 8 is not a reachable number
  // with a country code in front of it.
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/**
 * The permission that decides who is offered the hand-off.
 *
 * Deliberately the same key the assistant routes require and the same one
 * resolveActorByPhone() checks, so a role that loses the assistant loses the
 * WhatsApp entry point in the same breath.
 */
const COPILOT_PERMISSION = 'ai.copilot.use';

/** Platform-level role: no school of its own, so no WhatsApp hand-off. */
const SUPER_ADMIN_ROLE_KEY = 'SUPER_ADMIN';

/** True when the "Chat on WhatsApp" entry point should be offered at all. */
export function isAssistantLinkEnabled() {
  return env.WHATSAPP_ENABLED && normaliseWhatsappNumber(env.SCHOOL_WHATSAPP_NUMBER) !== null;
}

/**
 * Builds the deep link that hands a signed-in user over to the school's
 * WhatsApp number.
 *
 * The prefill is a bare "Hi", and that is the whole design. It used to be a
 * form the user sent about themselves -- name, admission number, "I need
 * assistance" -- which asked people to introduce themselves to a bot that
 * already knows exactly who they are from the number they are messaging from.
 * It also read as a support ticket, when what is on the other end is an
 * assistant that can answer straight away.
 *
 * So the opener is now just an opener, and whatsapp.briefing.js answers it by
 * fetching that user's own records and replying with them -- which leaves
 * their next message free to be a real question.
 *
 * Built on the server rather than in the browser because the number is
 * configuration the client has no business knowing before it is switched on.
 * Nothing in the link authenticates anything: the bot resolves the sender from
 * their phone number on every turn, so editing this text before sending gains
 * nothing -- see resolveActorByPhone.
 */
export async function buildAssistantLink(actor) {
  if (!env.WHATSAPP_ENABLED) {
    return { enabled: false, reason: 'WHATSAPP_DISABLED' };
  }

  const phone = normaliseWhatsappNumber(env.SCHOOL_WHATSAPP_NUMBER);
  if (!phone) {
    return { enabled: false, reason: 'NUMBER_NOT_CONFIGURED' };
  }

  // Eligibility is the assistant permission, not a list of roles.
  //
  // This used to be `role === 'STUDENT' || role === 'PARENT'`, on the reasoning
  // that staff have the portal. But a teacher between periods and a parent on a
  // bus are in the same situation -- away from the laptop, wanting one answer --
  // and a second, hand-maintained idea of who may use the assistant is exactly
  // how the WhatsApp surface drifts out of step with the web one. `ai.copilot.use`
  // is what the route already requires and what resolveActorByPhone() re-checks
  // when the message actually arrives, so making it the gate here means the
  // three agree by construction.
  //
  // Nothing widens: a teacher's briefing and answers are built from their own
  // OWN-scoped tools, the same ones the portal gives them.
  if (!actor?.permissions?.[COPILOT_PERMISSION]) {
    return { enabled: false, reason: 'ASSISTANT_NOT_PERMITTED' };
  }

  // The exception, and it is not about seniority. A Super Admin belongs to no
  // school, so their turn runs cross-school (runInActorScope) -- an opening
  // briefing would read every school on the platform at once, and the
  // orchestrator refuses their writes anyway. Platform administration stays in
  // the portal.
  if (actor.roleKey === SUPER_ADMIN_ROLE_KEY) {
    return { enabled: false, reason: 'ROLE_NOT_ELIGIBLE' };
  }

  // One word, and it is the user's to change. Anything longer is a script
  // being put in their mouth; anything empty leaves them staring at a blank
  // compose box wondering what the bot expects. isOpeningMessage() in
  // whatsapp.briefing.js recognises this and every ordinary variant of it.
  const message = 'Hi';

  return {
    enabled: true,
    phone,
    message,
    // wa.me is the documented short form and resolves correctly on both
    // desktop (WhatsApp Web) and mobile (the installed app).
    url: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
  };
}

/**
 * Records a WhatsApp hand-off click for product analytics.
 *
 * Reuses AuditLog rather than adding a collection: it already carries actor,
 * channel, timestamp and IP, and keeping one trail means "what did this family
 * do" is a single query. `after` holds the analytics dimensions — role, school
 * and device — so they can be grouped without joins.
 */
export async function recordAssistantLinkClick(actor, { device = 'UNKNOWN', ip } = {}) {
  const profile = await Profile.findById(actor.profileId).select('tenantId').lean();
  try {
    await AuditLog.create({
      actorProfileId: actor.profileId,
      action: 'whatsapp.assistant.click',
      entityType: 'WhatsappAssistant',
      entityId: actor.profileId,
      channel: 'WHATSAPP',
      ip,
      after: {
        role: actor.roleKey ?? null,
        schoolId: profile?.tenantId ?? null,
        device,
        at: new Date().toISOString(),
      },
    });
  } catch (err) {
    // Analytics must never be the reason a parent cannot reach the school.
    logger.warn(`Could not record WhatsApp assistant click: ${err.message}`);
  }
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
 * Handles one inbound message: dedupe, resolve, answer, persist, reply.
 *
 * Each message is isolated from the others in the batch. Meta can deliver
 * several at once, and one sender's failure must not stop the rest of the
 * batch being answered.
 */
/**
 * The two ways a WhatsApp message can reach us. Each channel replies through
 * the provider it arrived from; everything between — dedupe, identity, agent,
 * MCP — is shared and has no idea which one it is serving.
 */
const META_CHANNEL = { name: 'META', send: (to, text) => sendMessage(to, text) };

function chatflowChannel(normalised) {
  return {
    name: 'CHATFLOW',
    providerConversationId: normalised.conversationId ?? null,
    send: (to, text) => sendChatflowText({ to, text, correlationId: normalised.messageId }),
  };
}

async function handleOne(msg, channel = META_CHANNEL) {
  const conversation = await loadConversation(msg.from);
  if (!conversation) {
    logger.warn('Ignoring a WhatsApp message with an unusable sender number', { channel: channel.name });
    return { to: msg.from, reply: null, skipped: 'INVALID_NUMBER' };
  }
  if (channel.providerConversationId && conversation.providerConversationId !== channel.providerConversationId) {
    conversation.provider = channel.name;
    conversation.providerConversationId = channel.providerConversationId;
  }

  // Dedupe FIRST, before anything is resolved or executed. Meta redelivers any
  // webhook it did not get a 200 for, and a redelivered "YES" would otherwise
  // execute a pending write a second time. The uniqueness lives on an index,
  // so two concurrent redeliveries race into it rather than past it.
  const { duplicate, message: inboundDoc } = await recordInbound(conversation, {
    providerMessageId: msg.id,
    type: msg.type,
    text: msg.text ?? '',
  });
  if (duplicate) {
    logger.info('WhatsApp duplicate delivery ignored', { channel: channel.name, messageId: msg.id, from: maskPhone(msg.from) });
    return { to: msg.from, reply: null, skipped: 'DUPLICATE' };
  }
  logger.info('WhatsApp inbound message', {
    channel: channel.name,
    messageId: msg.id,
    conversationId: String(conversation._id),
    providerConversationId: channel.providerConversationId ?? null,
    sessionId: conversation.sessionId,
    from: maskPhone(msg.from),
    type: msg.type,
  });

  if (!msg.text) {
    // No text to detect a language from, so English is the only honest default.
    const reply =
      msg.type === 'image' ? t('agent.imageNotSupported', 'en') : t('agent.sendText', 'en');
    await markProcessed(inboundDoc, { status: 'PROCESSED', metadata: { unsupportedType: msg.type, channel: channel.name } });
    await deliver(conversation, msg.from, reply, { unsupportedType: msg.type }, channel);
    return { to: msg.from, reply };
  }

  try {
    const result = await handleInboundMessage({
      from: msg.from,
      text: msg.text,
      conversation,
      inboundMessageId: inboundDoc?._id ?? null,
    });

    // Recorded after the turn, from what the number actually resolved to.
    // Cached for auditing only -- the next turn re-resolves from live records.
    await attachIdentity(conversation, result.unknownSender ? null : await resolveActorByPhone(msg.from));

    logger.info('WhatsApp turn answered', {
      channel: channel.name,
      messageId: msg.id,
      erpProfileId: conversation.erpProfileId ? String(conversation.erpProfileId) : null,
      tool: result.tool ?? null,
      unknownSender: Boolean(result.unknownSender),
      reason: result.reason ?? null,
      awaitingConfirmation: Boolean(result.awaitingConfirmation),
      degraded: Boolean(result.degraded),
    });

    await markProcessed(inboundDoc, {
      status: 'PROCESSED',
      metadata: {
        channel: channel.name,
        tool: result.tool ?? null,
        lang: result.lang ?? null,
        unknownSender: Boolean(result.unknownSender),
        reason: result.reason ?? null,
      },
    });
    await deliver(conversation, msg.from, result.reply, {
      tool: result.tool ?? null,
      // Kept so a following "MORE" can continue this list (whatsapp.session latestContinuation).
      ...(result.continuationToken && { continuationToken: result.continuationToken }),
    }, channel);
    // `parts` is what the person receives: the reply as WhatsApp-sized messages.
    return { to: msg.from, reply: result.reply, parts: chunkForWhatsApp(result.reply) };
  } catch (err) {
    // A refusal ("you don't have permission to do that", "you are out of AI
    // credits") is a legitimate, expected answer and must reach the user as
    // itself -- burying it under a generic failure leaves people retrying
    // something that will never work. Only genuinely unexpected errors get the
    // vague message, and none of them get a stack trace.
    const expected = err?.statusCode >= 400 && err?.statusCode < 500;
    const reply = expected ? err.message : t('agent.failed', 'en');
    if (!expected) logger.error(`WhatsApp agent failed for a sender: ${err.message}`, { channel: channel.name, messageId: msg.id });
    await markProcessed(inboundDoc, {
      status: 'FAILED',
      metadata: { channel: channel.name, code: err?.code ?? null, status: err?.statusCode ?? null },
    });
    await deliver(conversation, msg.from, reply, { error: err?.code ?? 'UNEXPECTED' }, channel);
    return { to: msg.from, reply };
  }
}

/**
 * Sends a reply and records it, in that order.
 *
 * The transcript is written whether or not the send succeeded, with the
 * outcome on the row: a reply Meta rejected still happened as far as the
 * conversation's context is concerned, and losing it would leave the next
 * follow-up with a hole in the middle of the thread.
 */
async function deliver(conversation, to, text, metadata = null, channel = META_CHANNEL) {
  const sent = await channel.send(to, text);
  await recordOutbound(conversation, {
    text,
    metadata: {
      ...(metadata ?? {}),
      channel: channel.name,
      ...(sent.messageIds?.length ? { providerMessageIds: sent.messageIds } : {}),
      ...(sent.code ? { sendError: sent.code } : {}),
    },
    status: sent.sent === false && sent.error ? 'SEND_FAILED' : 'SENT',
  });
  return sent;
}

/**
 * Processes an inbound webhook: every text message is answered by the shared
 * agent core, so WhatsApp is not a second implementation of anything.
 *
 * Always resolves. Meta retries any webhook that does not return 2xx, so
 * throwing here turns one bad message into an indefinite redelivery loop.
 */
export async function receiveWebhook(payload) {
  const messages = extractMessages(payload);
  if (!messages.length) {
    // Delivery receipts and status callbacks land here too; acknowledge them.
    return { received: true, handled: 0 };
  }

  const replies = [];
  for (const msg of messages) {
    try {
      const outcome = await handleOne(msg);
      if (outcome.reply !== null) replies.push({ to: outcome.to, reply: outcome.reply, ...(outcome.parts && { parts: outcome.parts }) });
      else replies.push({ to: outcome.to, skipped: outcome.skipped });
    } catch (err) {
      // Reaching here means the session store itself failed. Acknowledge the
      // delivery anyway rather than inviting Meta to redeliver forever.
      logger.error(`WhatsApp message could not be processed at all: ${err.message}`);
      replies.push({ to: msg.from, skipped: 'INTERNAL_ERROR' });
    }
  }

  return {
    received: true,
    handled: replies.filter((r) => r.reply).length,
    skipped: replies.filter((r) => r.skipped).length,
    replies,
  };
}

/**
 * Processes one Chatflow-Pro webhook event through the same pipeline as Meta's.
 *
 * Dedupe keys on the WhatsApp message id Chatflow forwards (Meta's `wamid`),
 * not on Chatflow's delivery id, so a retried delivery, a redelivery and even
 * the same message arriving over both providers are processed once.
 *
 * Always resolves, for the same reason receiveWebhook() does.
 */
export async function receiveChatflowEvent(payload) {
  const messages = parseChatflowEvent(payload);
  if (!messages.length) {
    return { received: true, handled: 0, event: payload?.event ?? null };
  }

  const replies = [];
  for (const normalised of messages) {
    const msg = { from: normalised.phoneNumber, id: normalised.messageId, type: normalised.type, text: normalised.text };
    try {
      const outcome = await handleOne(msg, chatflowChannel(normalised));
      if (outcome.reply !== null) replies.push({ to: outcome.to, reply: outcome.reply, ...(outcome.parts && { parts: outcome.parts }) });
      else replies.push({ to: outcome.to, skipped: outcome.skipped });
    } catch (err) {
      logger.error(`Chatflow message could not be processed at all: ${err.message}`, { messageId: normalised.messageId });
      replies.push({ to: msg.from, skipped: 'INTERNAL_ERROR' });
    }
  }

  return {
    received: true,
    handled: replies.filter((r) => r.reply).length,
    skipped: replies.filter((r) => r.skipped).length,
    replies,
  };
}

/**
 * Outbound send. In simulation mode this logs rather than calling Meta, so the
 * whole flow can be exercised without credentials.
 */
export async function sendMessage(to, text) {
  // A long reply is sent as numbered parts (agent/present.js). This used to be
  // `text.slice(0, 4096)`: everything past Meta's limit was silently dropped,
  // so a long list arrived with most of it missing.
  const parts = chunkForWhatsApp(text);
  if (!isLiveMode()) {
    logger.info(`[WhatsApp SIMULATION] → ${to} (${parts.length} part(s)): ${String(parts[0] ?? '').slice(0, 200)}`);
    return { sent: false, simulated: true, parts: parts.length };
  }
  try {
    // In order, one at a time, so the parts arrive in sequence.
    for (const body of parts) {
      // eslint-disable-next-line no-await-in-loop -- parts must arrive in order
      const res = await fetch(
        // Read through `env` rather than process.env: config.env.js is the one
        // place these are validated and defaulted, and reading around it is how
        // a deployment ends up "live" against `undefined`.
        `https://graph.facebook.com/v20.0/${env.WA_PHONE_NUMBER_ID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.WA_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: to.replace(/^\+/, ''),
            type: 'text',
            text: { body },
          }),
        }
      );
      if (!res.ok) throw new Error(`WhatsApp send failed: ${res.status}`);
    }
    return { sent: true, parts: parts.length };
  } catch (err) {
    // Never rethrown. A Meta outage must not turn into a 500 on the webhook,
    // because Meta answers a 500 by redelivering the same message -- which
    // would re-run the agent, and for a confirmation, re-run the write.
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
  const body = text ?? message ?? '';

  // The simulator shares the real thread for this person's number, so a
  // preview exercises the same persisted memory a real conversation would --
  // including follow-ups like "what about last month?". Without this it could
  // only ever demonstrate single-turn behaviour, which is precisely the part
  // that needs checking. Falls back to a scratch turn when the account has no
  // usable number.
  const conversation = await loadConversation(actor?.phone);
  let history = [];
  let inboundDoc = null;
  if (conversation) {
    history = await buildHistory(conversation);
    ({ message: inboundDoc } = await recordInbound(conversation, {
      // No provider id: this did not come from Meta, and giving it one would
      // let a simulated turn suppress a real delivery through the dedupe index.
      providerMessageId: null,
      type: 'text',
      text: body,
    }));
  }

  // "MORE" continues the last long list exactly as on a real phone: the same
  // lookup (the latest reply's stored continuation token, in this same
  // thread), the same converse() branch, the same signed-token redemption.
  // The token is never taken from the request -- only the server's own stored
  // copy is used, so nothing typed can move the position.
  const continuationToken = await latestContinuation(conversation);

  // No tenant wrapper here: /simulate arrives through `authenticate`, which
  // has already scoped the request to the caller's school.
  const result = await converse({ actor, text: body, history, continuationToken });

  if (conversation) {
    await markProcessed(inboundDoc, { status: 'PROCESSED', metadata: { simulated: true } });
    await recordOutbound(conversation, {
      text: result.reply,
      metadata: {
        simulated: true,
        tool: result.tool ?? null,
        // Stored the way deliver() stores it for a real reply, so the next
        // "MORE" -- simulated or real -- finds it.
        ...(result.continuationToken && { continuationToken: result.continuationToken }),
      },
      status: 'SENT',
    });
  }

  return {
    reply: result.reply,
    // The messages a phone would receive, so the preview shows the parts too.
    messages: chunkForWhatsApp(result.reply),
    buttons: result.awaitingConfirmation
      ? [{ id: 'yes', title: 'YES' }, { id: 'no', title: 'NO' }]
      : SUGGESTIONS,
    awaitingConfirmation: Boolean(result.awaitingConfirmation),
    mode: isLiveMode() ? 'LIVE' : 'SIMULATION',
    isStandIn: !isLiveMode(),
  };
}
