import { Account } from '../../models/account.model.js';
import { Profile } from '../../models/profile.model.js';
import { AgentAction } from '../../models/agentAction.model.js';
import { buildPermissionMap } from '../../utils/buildPermissionMap.js';
import { logger } from '../../utils/logger.js';
import { runAgentSafely, confirmAction, continueAnswer } from '../ai/agent/orchestrator.js';
import { toWhatsAppText } from '../ai/agent/present.js';
import { latestPendingFor, reissueToken } from '../ai/mcp/confirm.js';
import { detectLanguage, t } from '../../utils/language.js';
import { runWithTenant, runAcrossSchools } from '../../tenancy/tenantContext.js';
import { normalisePhone, buildHistory, latestContinuation } from './whatsapp.session.js';
import { isOpeningMessage, buildBriefing } from './whatsapp.briefing.js';

/**
 * WhatsApp -> agent bridge.
 *
 * The whole point is that this file contains no authorization logic of its
 * own: it turns a phone number into the same `actor` shape the authenticate
 * middleware builds, runs the turn inside the same school scope that
 * middleware would have applied, hands it to the shared orchestrator, and
 * renders the result as text. Every permission check, confirmation step and
 * audit entry therefore behaves identically to the web assistant.
 *
 * SECURITY NOTE -- WhatsApp identity is weaker than a logged-in session.
 * Anyone in control of the handset (or the number, after a SIM swap) is
 * treated as that user. That is inherent to phone-number-addressed bots, and
 * it is why: (a) Meta's webhook signature is verified before any of this runs,
 * (b) every write still requires an explicit confirmation, and (c) the
 * capabilities available are exactly the user's own -- never more.
 *
 * What the sender *says* about who they are is never consulted. "I am Admin"
 * and "my ID is 12345" are just text handed to the intent parser; identity
 * comes only from the number Meta verified, and the parser's proposal is
 * filtered to the tools that number's profile actually holds.
 */

const SUPER_ADMIN_ROLE_KEY = 'SUPER_ADMIN';

/**
 * The permission the web assistant's routes require (ai.routes.js).
 *
 * Checked here because a webhook has no route middleware: without this,
 * WhatsApp would be a way to reach the assistant for a role an administrator
 * had deliberately withheld it from, which is exactly the "softer path to the
 * same data" the agent's design exists to prevent.
 */
const COPILOT_PERMISSION = 'ai.copilot.use';

const YES = /^(y|yes|yeah|yep|ok|okay|confirm|confirmed|go ahead|do it|haan|haa|ha|ji|thik hai|ठीक है|हाँ)$/i;
const NO = /^(n|no|nope|cancel|stop|don'?t|nahi|nahin|nai|नहीं)$/i;
/** "MORE" after a long list: the next window of it. */
const MORE = /^(more|next|show more|load more|aur|और)$/i;

/**
 * "Reply *MORE* for 1001–2000 of 4500." -- WhatsApp's equivalent of the
 * website's "Load more". The token itself is never shown; it is kept on the
 * outgoing message (whatsapp.service deliver → metadata) and found again by
 * latestContinuation() when the person replies.
 */
function moreLine(continuation) {
  if (!continuation?.next) return '';
  const { from, to } = continuation.next;
  const of = continuation.total != null ? ` of ${continuation.total}` : '';
  return `\n\nReply *MORE* for ${from}–${to}${of}.`;
}

/**
 * Finds the accounts a WhatsApp sender's number could belong to.
 *
 * Meta delivers `919999999999`; the ERP stores `+919999999999`; a number typed
 * into the admin UI can arrive as `+91 99999 99999`. Comparing any two of
 * those as strings gives the wrong answer, so the match is made on digits.
 *
 * The regex is anchored on the full normalised value rather than used as a
 * suffix search: matching on the last N digits would let a number in one
 * country resolve to an account in another, which is an account takeover
 * dressed up as a convenience.
 */
async function findAccountsByPhone(digits) {
  // Escaped because the value is attacker-influenced; normalisePhone has
  // already stripped everything but digits, and this keeps that guarantee
  // local rather than assumed.
  const safe = digits.replace(/[^\d]/g, '');
  return Account.find({ phoneE164: new RegExp(`^\\+?${safe}$`) });
}

/**
 * Builds an actor from a phone number, mirroring middleware/auth.js.
 *
 * Returns `{ actor, ... }` on success, or `{ reason }` describing why not, so
 * the caller can say something true and specific. Collapsing "your account is
 * suspended" and "this number is unknown" into one message leaves people
 * retrying something that will never work.
 */
export async function resolveActorByPhone(phone) {
  const digits = normalisePhone(phone);
  if (!digits) return { reason: 'INVALID_NUMBER' };

  const accounts = await findAccountsByPhone(digits);
  if (!accounts.length) return { reason: 'UNKNOWN_NUMBER' };

  if (accounts.length > 1) {
    // `phoneE164` is unique, so this means the same number is stored in two
    // different formats. Guessing which one the sender meant is how somebody
    // gets another person's records; refuse and let an administrator fix the
    // duplicate.
    logger.error(
      `WhatsApp number ${digits} matches ${accounts.length} ERP accounts -- refusing to guess. ` +
        'Deduplicate phoneE164 for these accounts.'
    );
    return { reason: 'AMBIGUOUS_NUMBER' };
  }

  const account = accounts[0];
  if (account.status !== 'ACTIVE') return { reason: 'ACCOUNT_INACTIVE' };

  const profiles = await Profile.find({
    accountId: account._id,
    status: 'ACTIVE',
    deletedAt: null,
  })
    .sort({ createdAt: -1 })
    .populate('roleId');

  if (!profiles.length) return { reason: 'NO_PROFILE' };

  // WhatsApp has no profile picker. Rather than guess silently for a
  // multi-role account, use the most recent profile and tell the user which
  // one they are acting as, so a teacher-and-parent knows which hat is on.
  const profile = profiles[0];

  // Mirrors applyTenantScope() in middleware/auth.js: a school-level profile
  // that has lost its school is a broken record, not a permissive one.
  const tenantId = String(profile.tenantId ?? '').trim();
  const isSuperAdmin = profile.roleId?.key === SUPER_ADMIN_ROLE_KEY;
  if (!isSuperAdmin && !tenantId) return { reason: 'NO_SCHOOL_ASSIGNED' };

  const actor = {
    accountId: account._id.toString(),
    phone: account.phoneE164,
    email: account.email,
    profileId: profile._id.toString(),
    displayName: profile.displayName,
    roleId: profile.roleId?._id?.toString() ?? null,
    roleKey: profile.roleId?.key ?? null,
    permissions: buildPermissionMap(profile.roleId),
    tenantId: tenantId || null,
    tenantName: profile.tenantName ?? null,
  };

  if (!actor.permissions[COPILOT_PERMISSION]) {
    return { reason: 'ASSISTANT_NOT_PERMITTED', actor };
  }

  return {
    actor,
    isSuperAdmin,
    multipleProfiles: profiles.length > 1,
    roleLabel: profile.roleId?.name ?? profile.roleId?.key ?? 'your profile',
  };
}

/**
 * Runs `fn` in the school this actor belongs to.
 *
 * This is the piece a webhook does not get for free. Every school-owned
 * collection is filtered by the acting school (see src/tenancy/), and with no
 * context that filter does nothing at all -- so an unscoped WhatsApp turn
 * would read across every school on the platform. A Super Admin runs
 * cross-school exactly as they do signed in with no `X-School-Id`, which also
 * means the orchestrator's assertSchoolContext() refuses their writes, just as
 * it does on the web.
 */
export function runInActorScope(resolved, fn) {
  if (resolved?.isSuperAdmin || !resolved?.actor?.tenantId) return runAcrossSchools(fn);
  return runWithTenant(resolved.actor.tenantId, fn);
}

/** Message shown for each way a number can fail to resolve to a usable account. */
function refusalFor(reason, lang) {
  switch (reason) {
    case 'ACCOUNT_INACTIVE':
    case 'NO_PROFILE':
    case 'NO_SCHOOL_ASSIGNED':
      return t('agent.accountInactive', lang);
    case 'AMBIGUOUS_NUMBER':
      return t('agent.numberAmbiguous', lang);
    case 'ASSISTANT_NOT_PERMITTED':
      return t('agent.assistantNotPermitted', lang);
    default:
      return t('agent.notRegistered', lang);
  }
}

/** Most recent still-valid proposal for this actor, used to resolve "yes"/"no". */
async function latestPending(actor) {
  // The same lookup the confirmation store uses, so there is one definition of
  // "this person's outstanding proposal" rather than two that could drift.
  return latestPendingFor(actor);
}

/**
 * Handles one inbound WhatsApp message end to end and returns the text to
 * send back.
 *
 * `conversation` is the persisted thread (see whatsapp.session.js). It supplies
 * the recent turns that let a follow-up like "what about last month?" resolve,
 * and nothing else: it is never consulted for who the sender is.
 */
export async function handleInboundMessage({ from, text, conversation = null }) {
  const lang = detectLanguage(text).lang;
  const resolved = await resolveActorByPhone(from);

  if (!resolved.actor || resolved.reason) {
    // Logged without the message body: an unresolved number is by definition
    // someone we have no relationship with, and their text is not ours to keep.
    logger.info(`WhatsApp message from an unresolved number (${resolved.reason})`);
    return {
      reply: refusalFor(resolved.reason, lang),
      unknownSender: true,
      reason: resolved.reason,
    };
  }

  const history = await buildHistory(conversation);

  logger.info(
    `WhatsApp turn: profile ${resolved.actor.profileId} (${resolved.actor.roleKey}) ` +
      `school ${resolved.actor.tenantId ?? 'platform'}, ${history.length} prior turn(s)`
  );

  // Every ERP read and write below runs inside the sender's own school.
  // The continuation of the last long list, if the last reply offered one.
  const continuationToken = await latestContinuation(conversation);

  return runInActorScope(resolved, () => converse({ ...resolved, text, history, continuationToken }));
}

/**
 * One conversational turn for an already-resolved actor.
 *
 * Shared by the live webhook (actor resolved from the phone number) and the
 * in-app simulator (actor from the session), so the simulator is a true
 * preview rather than a lookalike.
 */
export async function converse({ actor, multipleProfiles = false, roleLabel = '', text, history = [], continuationToken = null }) {
  const message = String(text ?? '').trim();
  const lang = detectLanguage(message).lang;
  if (!message) return { reply: t('agent.sendText', lang), lang };

  // Arrival. Someone who has just tapped through from the app says "Hi", and
  // the useful answer to that is not "what would you like?" -- it is their own
  // records, already fetched. See whatsapp.briefing.js.
  //
  // Checked before the yes/no branch on purpose: an opener is never an answer
  // to a pending proposal, and before the intent parser because a greeting has
  // no intent in it to find.
  if (isOpeningMessage(message)) {
    const briefing = await buildBriefing({ actor, lang });
    let reply = briefing.reply;
    if (multipleProfiles) reply += `

${t('agent.actingAs', lang, { role: roleLabel })}`;
    return { reply, lang, briefing: true, tools: briefing.tools };
  }

  // "MORE" continues the last long list, through the same authorized read.
  if (MORE.test(message) && continuationToken) {
    try {
      const next = await continueAnswer({ token: continuationToken, actor, source: 'WHATSAPP', lang });
      return {
        reply: toWhatsAppText(next.reply) + moreLine(next.continuation),
        lang,
        tool: next.tool,
        continuationToken: next.continuation?.token ?? null,
      };
    } catch (err) {
      return { reply: err?.message ?? 'That list has expired. Please ask again.', lang };
    }
  }

  // A bare yes/no answers the outstanding proposal rather than starting a new
  // request, which is how people actually reply on WhatsApp.
  if (YES.test(message) || NO.test(message)) {
    const pending = await latestPending(actor);
    if (!pending) {
      return { reply: t('agent.nothingPending', lang), lang };
    }
    // The stored token is hashed, so re-issuing is not possible; confirm via
    // the action id path instead.
    const result = await confirmActionById({
      actionId: pending._id,
      actor,
      accept: YES.test(message),
      lang,
    });
    return { reply: toWhatsAppText(result.reply), lang, executed: result.executed };
  }

  // The safe variant, for the same reason the web route uses it: a provider
  // outage should degrade to a rule-based answer, not to silence on someone's
  // phone.
  const result = await runAgentSafely({ message, actor, source: 'WHATSAPP', lang, history });

  // The assistant answers in Markdown (agent/present.js); WhatsApp shows
  // `**` and table pipes literally, so the reply is put in its own dialect.
  let reply = toWhatsAppText(result.reply) + moreLine(result.continuation);
  if (result.action) {
    // WhatsApp cannot carry a hidden token, so the reply asks for a plain
    // yes/no and the pending action is matched from the actor's own queue.
    reply = t('agent.confirm.whatsapp', lang, {
      summary: result.action.summary,
      minutes: result.action.expiresInMinutes,
    });
  }

  if (multipleProfiles) {
    reply += `\n\n${t('agent.actingAs', lang, { role: roleLabel })}`;
  }

  return {
    reply,
    lang,
    awaitingConfirmation: Boolean(result.action),
    flagged: result.flagged ?? null,
    tool: result.tool ?? null,
    degraded: Boolean(result.degraded),
    continuationToken: result.continuation?.token ?? null,
  };
}

/**
 * Confirmation by action id, for surfaces that cannot hold a token.
 *
 * Ownership is still enforced -- the action must belong to this actor -- and it
 * still runs through the orchestrator, so authorization is re-checked at
 * execution time exactly as it is on the web.
 */
export async function confirmActionById({ actionId, actor, accept, lang = 'en' }) {
  const pending = await AgentAction.findById(actionId);
  if (!pending) return { reply: "I couldn't find that request any more. Please ask again." };
  if (String(pending.actorProfileId) !== String(actor.profileId)) {
    logger.warn(`WhatsApp confirm attempted across profiles by ${actor.profileId}`);
    return { reply: "That request doesn't belong to this number." };
  }

  try {
    // Re-issue a token for this single confirmation, so it is redeemed through
    // exactly the path the website's /ai/agent/confirm uses: the orchestrator
    // hands it to the MCP server, which claims it atomically and re-authorizes.
    const token = await reissueToken(pending);

    const result = await confirmAction({ confirmToken: token, actor, accept, source: 'WHATSAPP', lang });
    return { reply: result.reply, executed: result.executed };
  } catch (err) {
    return { reply: err.message ?? 'That could not be completed.' };
  }
}
