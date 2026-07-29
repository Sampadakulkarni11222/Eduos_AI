import { Account } from '../../models/account.model.js';
import { Profile } from '../../models/profile.model.js';
import { AgentAction } from '../../models/agentAction.model.js';
import { buildPermissionMap } from '../../utils/buildPermissionMap.js';
import { logger } from '../../utils/logger.js';
import { runAgent, confirmAction } from '../ai/agent/orchestrator.js';

/**
 * WhatsApp → agent bridge.
 *
 * The whole point is that this file contains no authorization logic of its
 * own: it turns a phone number into the same `actor` shape the authenticate
 * middleware builds, hands it to the shared orchestrator, and renders the
 * result as text. Every permission check, confirmation step and audit entry
 * therefore behaves identically to the web assistant.
 *
 * SECURITY NOTE — WhatsApp identity is weaker than a logged-in session.
 * Anyone in control of the handset (or the number, after a SIM swap) is
 * treated as that user. That is inherent to phone-number-addressed bots, and
 * it is why: (a) Meta's webhook signature is verified before any of this runs,
 * (b) every write still requires an explicit confirmation, and (c) the
 * capabilities available are exactly the user's own — never more.
 */

const YES = /^(y|yes|yeah|yep|ok|okay|confirm|confirmed|go ahead|do it|haan|haa|ha|ji|thik hai|ठीक है|हाँ)$/i;
const NO = /^(n|no|nope|cancel|stop|don'?t|nahi|nahin|nai|नहीं)$/i;

/** Builds an actor from a phone number, mirroring middleware/auth.js. */
export async function resolveActorByPhone(phoneE164) {
  const account = await Account.findOne({ phoneE164 });
  if (!account || account.status !== 'ACTIVE') return null;

  const profiles = await Profile.find({
    accountId: account._id,
    status: 'ACTIVE',
    deletedAt: null,
  })
    .sort({ createdAt: -1 })
    .populate('roleId');

  if (!profiles.length) return null;

  // WhatsApp has no profile picker. Rather than guess silently for a
  // multi-role account, use the most recent profile and tell the user which
  // one they are acting as, so a teacher-and-parent knows which hat is on.
  const profile = profiles[0];

  return {
    actor: {
      accountId: account._id.toString(),
      phone: account.phoneE164,
      email: account.email,
      profileId: profile._id.toString(),
      displayName: profile.displayName,
      roleId: profile.roleId?._id?.toString() ?? null,
      roleKey: profile.roleId?.key ?? null,
      permissions: buildPermissionMap(profile.roleId),
    },
    multipleProfiles: profiles.length > 1,
    roleLabel: profile.roleId?.name ?? profile.roleId?.key ?? 'your profile',
  };
}

/** Most recent still-valid proposal for this actor, used to resolve "yes"/"no". */
async function latestPending(actor) {
  return AgentAction.findOne({
    actorProfileId: actor.profileId,
    status: 'PENDING',
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });
}

/**
 * Handles one inbound WhatsApp message end to end and returns the text to
 * send back, plus any quick replies.
 */
export async function handleInboundMessage({ from, text }) {
  const resolved = await resolveActorByPhone(from);
  if (!resolved) {
    return {
      reply:
        "This number isn't registered with the school. Please ask the school office to add it to your record.",
      unknownSender: true,
    };
  }
  return converse({ ...resolved, text });
}

/**
 * One conversational turn for an already-resolved actor.
 *
 * Shared by the live webhook (actor resolved from the phone number) and the
 * in-app simulator (actor from the session), so the simulator is a true
 * preview rather than a lookalike.
 */
export async function converse({ actor, multipleProfiles = false, roleLabel = '', text }) {
  const message = String(text ?? '').trim();
  if (!message) return { reply: 'Send me a question — for example "attendance" or "fees".' };

  // A bare yes/no answers the outstanding proposal rather than starting a new
  // request, which is how people actually reply on WhatsApp.
  if (YES.test(message) || NO.test(message)) {
    const pending = await latestPending(actor);
    if (!pending) {
      return { reply: "There's nothing waiting for your confirmation right now." };
    }
    // The stored token is hashed, so re-issuing is not possible; confirm via
    // the action id path instead.
    const result = await confirmActionById({
      actionId: pending._id,
      actor,
      accept: YES.test(message),
    });
    return { reply: result.reply };
  }

  const result = await runAgent({ message, actor, source: 'WHATSAPP' });

  let reply = result.reply;
  if (result.action) {
    // WhatsApp cannot carry a hidden token, so the reply asks for a plain
    // yes/no and the pending action is matched from the actor's own queue.
    reply = `${result.action.summary}.\n\nReply YES to confirm or NO to cancel. (Expires in ${result.action.expiresInMinutes} minutes.)`;
  }

  if (multipleProfiles) {
    reply += `\n\n(You're chatting as ${roleLabel}. To act as another role, use the web portal.)`;
  }

  return {
    reply,
    awaitingConfirmation: Boolean(result.action),
    flagged: result.flagged ?? null,
  };
}

/**
 * Confirmation by action id, for surfaces that cannot hold a token.
 *
 * Ownership is still enforced — the action must belong to this actor — and it
 * still runs through the orchestrator, so authorization is re-checked at
 * execution time exactly as it is on the web.
 */
export async function confirmActionById({ actionId, actor, accept }) {
  const pending = await AgentAction.findById(actionId);
  if (!pending) return { reply: "I couldn't find that request any more. Please ask again." };
  if (String(pending.actorProfileId) !== String(actor.profileId)) {
    logger.warn(`WhatsApp confirm attempted across profiles by ${actor.profileId}`);
    return { reply: "That request doesn't belong to this number." };
  }

  try {
    // Re-issue a token for this single confirmation so the orchestrator stays
    // the only place that executes anything.
    const crypto = await import('crypto');
    const token = crypto.randomBytes(24).toString('hex');
    pending.tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await pending.save();

    const result = await confirmAction({ confirmToken: token, actor, accept, source: 'WHATSAPP' });
    return { reply: result.reply, executed: result.executed };
  } catch (err) {
    return { reply: err.message ?? 'That could not be completed.' };
  }
}
