import crypto from 'crypto';
import { handleInboundMessage, converse } from './whatsapp.agent.js';
import { t } from '../../utils/language.js';
import { env, isWhatsappLive, isWhatsappSignatureConfigured } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { Student } from '../../models/student.model.js';
import { Profile } from '../../models/profile.model.js';
import { AuditLog } from '../../models/auditLog.model.js';
import { getOwnStudentId, getGuardianStudentIds } from '../../utils/scope.js';

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

/** True when the "Chat on WhatsApp" entry point should be offered at all. */
export function isAssistantLinkEnabled() {
  return env.WHATSAPP_ENABLED && normaliseWhatsappNumber(env.SCHOOL_WHATSAPP_NUMBER) !== null;
}

/**
 * Builds the deep link that hands a signed-in student or parent over to the
 * school's WhatsApp number, with their identity already typed out.
 *
 * Built on the server rather than in the browser for two reasons: the
 * identifiers (admission number, guardian profile) come from records the
 * client cannot be trusted to assert, and the number itself is configuration
 * the client has no business knowing before it is switched on.
 *
 * The message is a *convenience*, not authentication. The bot re-resolves who
 * the sender is from their phone number when they actually message, so editing
 * this text before sending gains nothing — see resolveActorByPhone.
 */
export async function buildAssistantLink(actor) {
  if (!env.WHATSAPP_ENABLED) {
    return { enabled: false, reason: 'WHATSAPP_DISABLED' };
  }

  const phone = normaliseWhatsappNumber(env.SCHOOL_WHATSAPP_NUMBER);
  if (!phone) {
    return { enabled: false, reason: 'NUMBER_NOT_CONFIGURED' };
  }

  const role = actor?.roleKey;
  if (role !== 'STUDENT' && role !== 'PARENT') {
    // Staff have the in-portal assistant and the tools it fronts; the WhatsApp
    // hand-off exists for families, whose data is scoped to themselves.
    return { enabled: false, reason: 'ROLE_NOT_ELIGIBLE' };
  }

  const name = actor.displayName ?? 'a parent/guardian';
  let message;

  if (role === 'STUDENT') {
    const studentId = await getOwnStudentId(actor.profileId);
    const student = studentId ? await Student.findById(studentId).select('admissionNo').lean() : null;
    // The admission number is what office staff actually look people up by;
    // the internal id would be useless to whoever picks up the conversation.
    const reference = student?.admissionNo ?? actor.profileId;
    message = `Hello,\n\nI am ${name}.\n\nStudent ID: ${reference}\n\nI need assistance.`;
  } else {
    const childIds = await getGuardianStudentIds(actor.profileId);
    const children = await Student.find({ _id: { $in: childIds } }).select('admissionNo firstName lastName').lean();
    const childLine = children.length
      ? `\n\nChild: ${children.map((c) => `${c.firstName} ${c.lastName ?? ''}`.trim() + ` (${c.admissionNo})`).join(', ')}`
      : '';
    message = `Hello,\nI am ${name}.\n\nParent ID: ${actor.profileId}${childLine}\n\nI need assistance regarding my child.`;
  }

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
        // No text to detect from, so English is the only honest default.
        reply: msg.type === 'image' ? t('agent.imageNotSupported', 'en') : t('agent.sendText', 'en'),
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
      const reply = expected ? err.message : t('agent.failed', 'en');
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
