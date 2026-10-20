import { evidenceLine } from '../ai/agent/evidence.js';
import { Account } from '../../models/account.model.js';
import { Profile } from '../../models/profile.model.js';
import { AgentAction } from '../../models/agentAction.model.js';
import { buildPermissionMap } from '../../utils/buildPermissionMap.js';
import { logger } from '../../utils/logger.js';
import { runAgentSafely, confirmAction, continueAnswer } from '../ai/agent/orchestrator.js';
import { hasOpenWrite } from '../ai/agent/intent.js';
import { loadMemory, historyFrom, rememberTurn } from '../ai/agent/memory.js';
import { lastTurnProposed } from '../ai/agent/context.js';
import { toWhatsAppText } from '../ai/agent/present.js';
import { latestPendingFor, reissueToken } from '../ai/mcp/confirm.js';
import { detectLanguage, t, LANGUAGE_NAMES } from '../../utils/language.js';
import { getPreferences } from '../messaging/messaging.service.js';
import { runWithTenant, runAcrossSchools } from '../../tenancy/tenantContext.js';
import { normalisePhone, buildHistory, latestContinuation } from './whatsapp.session.js';
import { isOpeningMessage, buildBriefing } from './whatsapp.briefing.js';
import { downloadWhatsappDocument, downloadMetaMedia, downloadChatflowMedia } from './whatsapp.media.js';
import { transcribe, isSttConfigured } from '../ai/speech/stt.js';
import { nativeToEnglish, indicLanguageOf } from '../ai/agent/language/translate.js';
import { label as replyLabel } from '../ai/agent/language/replies.js';
import { isWhatsappLive } from '../../config/env.js';
import { storeFile } from '../imports/imports.service.js';
import { schemasFor } from '../imports/schemas.js';

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
export async function handleInboundMessage({ from, text, conversation = null, inboundMessageId = null, document = null, voice = null }) {
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

  // The turns BEFORE this message, exactly what the website sends.
  const history = await buildHistory(conversation, { excludeMessageId: inboundMessageId });

  logger.info(
    `WhatsApp turn: profile ${resolved.actor.profileId} (${resolved.actor.roleKey}) ` +
      `school ${resolved.actor.tenantId ?? 'platform'}, ${history.length} prior turn(s)`
  );

  // Every ERP read and write below runs inside the sender's own school.
  // The continuation of the last long list, if the last reply offered one.
  const continuationToken = await latestContinuation(conversation);

  // The session id names the server-side conversation memory (agent/memory.js):
  // what the turns were about -- the draft under discussion, the students the
  // last answer listed -- kept for this person on this channel.
  // p7: a spreadsheet sent as a document goes through the bulk-import pipeline.
  if (document) {
    return runInActorScope(resolved, () => converseWithDocument({ ...resolved, text, document, history, conversationId: conversation?.sessionId ?? null }));
  }
  // p7: a voice note, transcribed through the speech adapter (ai/speech/stt.js)
  // -- only for a sender we know -- and then answered as the words it says,
  // with what was heard shown back. Never a made-up transcript.
  if (voice) {
    return runInActorScope(resolved, async () => {
      const heard = await voiceNoteText(voice, resolved.actor);
      if (heard.reply) return { reply: heard.reply, lang: heard.lang, reason: heard.reason };
      return converse({ ...resolved, text: heard.text, heard: true, history, continuationToken, conversationId: conversation?.sessionId ?? null });
    });
  }
  return runInActorScope(resolved, () => converse({ ...resolved, text, history, continuationToken, conversationId: conversation?.sessionId ?? null }));
}

/**
 * One conversational turn for an already-resolved actor.
 *
 * Shared by the live webhook (actor resolved from the phone number) and the
 * in-app simulator (actor from the session), so the simulator is a true
 * preview rather than a lookalike.
 */
export async function converse({ actor, multipleProfiles = false, roleLabel = '', text, history: sentHistory = [], continuationToken = null, conversationId = null, heard = false }) {
  const spoken = String(text ?? '').trim();
  // p7: "हाँ", "ஆம்", "होय" are YES and "नहीं", "இல்லை" NO, to the confirmation below.
  const nativeYesNo = nativeToEnglish(spoken)?.text;
  const message = nativeYesNo === 'yes' || nativeYesNo === 'no' ? nativeYesNo : spoken;
  // What was heard in a voice note, shown back above the answer.
  const heardLine = (lang) => (heard ? `_${replyLabel(lang, 'heard')}: “${spoken}”_\n\n` : '');
  const lang = await replyLanguage(message, actor);
  if (!message) return { reply: t('agent.sendText', lang), lang };

  // The conversation as the server remembers it (agent/memory.js) -- the same
  // 24 turns and structured context the website uses -- with the WhatsApp
  // thread's own last messages only as the fallback for a session the memory
  // does not hold yet. The turns answered here without the shared agent (the
  // briefing, MORE, a YES/NO) are written into it too, so the next turn reads
  // the conversation exactly as it happened.
  const memory = conversationId ? await loadMemory({ actor, source: 'WHATSAPP', conversationId }) : null;
  const history = memory ? historyFrom(memory, sentHistory) : sentHistory;
  const remember = async (reply, extra = {}) => {
    if (memory) await rememberTurn({ actor, source: 'WHATSAPP', conversationId: memory.conversationId, message, result: { reply, ...extra } });
  };

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
    await remember(reply, { tools: briefing.tools });
    return { reply, lang, briefing: true, tools: briefing.tools };
  }

  // "MORE" continues the last long list, through the same authorized read.
  if (MORE.test(message) && continuationToken) {
    try {
      const next = await continueAnswer({ token: continuationToken, actor, source: 'WHATSAPP', lang });
      await remember(next.reply, { tool: next.tool, continuation: next.continuation });
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
  // ...unless what is outstanding is not a proposal but a QUESTION: "I need a
  // start and end date for the leave." answered "Okay" is still the leave
  // request, so it goes to the shared agent, which asks for the dates again.
  const yesNo = YES.test(message) || NO.test(message);
  const pending = yesNo ? await latestPending(actor) : null;
  // With nothing pending and no draft just shown, "ok" / "no" is said to an
  // answer: the shared agent acknowledges it, exactly as on the website. A
  // plain YES still hears that there is nothing to confirm.
  const saidYes = /^(y|yes|yeah|yep|confirm|confirmed|go ahead|do it|haan|haa|ha|ji)$/i.test(message);
  // A spoken "yes" never confirms a change: speech can be misheard, so the
  // confirmation must be typed (the draft stays pending until it is).
  if (heard && yesNo && pending) {
    const typeIt = `${heardLine(lang)}${replyLabel(lang, 'voiceTypeToConfirm')}`;
    await remember(typeIt);
    return { reply: typeIt, lang, awaitingConfirmation: true };
  }
  if (yesNo && (pending || (!hasOpenWrite(history, message, actor) && (saidYes || lastTurnProposed(history))))) {
    if (!pending) {
      const nothing = t('agent.nothingPending', lang);
      await remember(nothing);
      return { reply: nothing, lang };
    }
    // The stored token is hashed, so re-issuing is not possible; confirm via
    // the action id path instead.
    const result = await confirmActionById({
      actionId: pending._id,
      actor,
      accept: YES.test(message),
      lang,
    });
    await remember(result.reply, { executed: result.executed });
    // p7: more drafts of a multi-part message are waiting, one at a time.
    const queued = Array.isArray(memory?.context?.queuedWrites) ? memory.context.queuedWrites.length : 0;
    const next = queued ? `\n\n${queued} more draft(s) waiting — reply NEXT for the next one.` : '';
    return { reply: `${toWhatsAppText(result.reply)}${next}`, lang, executed: result.executed };
  }

  // The safe variant, for the same reason the web route uses it: a provider
  // outage should degrade to a rule-based answer, not to silence on someone's
  // phone.
  const result = await runAgentSafely({ message, actor, source: 'WHATSAPP', lang, history, conversationId, heard });

  // The assistant answers in Markdown (agent/present.js); WhatsApp shows
  // `**` and table pipes literally, so the reply is put in its own dialect.
  let reply = toWhatsAppText(result.reply) + moreLine(result.continuation);
  // "Based on": when the model wrote the answer, the records it used, so no
  // AI statement arrives without its evidence. An answer laid out from the
  // records themselves is the evidence, and stays identical to the website's.
  if (!result.action && result.modelWritten && result.evidence?.length) reply += `

_${evidenceLine(result.evidence)}_`;
  if (result.action) {
    // WhatsApp cannot carry a hidden token, so the reply asks for a plain
    // yes/no and the pending action is matched from the actor's own queue.
    reply = t('agent.confirm.whatsapp', lang, {
      summary: result.action.summary,
      minutes: result.action.expiresInMinutes,
    });
    // The same message also ASKED something, and that was answered in this
    // turn: said first, as on the website, never replaced by the proposal.
    if (result.preface) reply = `${toWhatsAppText(result.preface)}\n\n${reply}`;
  }

  if (multipleProfiles) {
    reply += `\n\n${t('agent.actingAs', lang, { role: roleLabel })}`;
  }
  reply = heardLine(lang) + reply;

  return {
    reply,
    lang,
    ...(heard && { heard: spoken }),
    awaitingConfirmation: Boolean(result.action),
    flagged: result.flagged ?? null,
    tool: result.tool ?? null,
    degraded: Boolean(result.degraded),
    continuationToken: result.continuation?.token ?? null,
  };
}

/**
 * A spreadsheet sent on WhatsApp (p7 bulk import): downloaded through the
 * provider adapter, kept like a website upload (24 hours at most), and checked
 * by the same Ask AI turn the website's attach button runs. The preview and its
 * problems come back as text; the import itself is confirmed on the website
 * (the reply carries the link), because it writes many records at once.
 */
export async function converseWithDocument({ actor, multipleProfiles = false, roleLabel = '', text = '', document, history = [], conversationId = null }) {
  const message = String(text ?? '').trim();
  const lang = await replyLanguage(message, actor);
  const memory = conversationId ? await loadMemory({ actor, source: 'WHATSAPP', conversationId }) : null;
  const said = message || `[sent a document: ${document?.filename ?? 'file'}]`;
  const remember = async (reply, extra = {}) => {
    if (memory) await rememberTurn({ actor, source: 'WHATSAPP', conversationId: memory.conversationId, message: said, result: { reply, ...extra } });
  };

  if (!schemasFor(actor).length) {
    const reply = 'Your account cannot import spreadsheets. Send your question as a text message instead.';
    await remember(reply);
    return { reply, lang };
  }
  const got = await downloadWhatsappDocument(document);
  if (got.error) {
    await remember(got.message);
    return { reply: got.message, lang, reason: `DOCUMENT_${got.error}` };
  }
  let stored;
  try {
    stored = await storeFile({ actor, channel: 'WHATSAPP', name: got.filename, buffer: got.buffer });
  } catch (err) {
    const reply = err?.statusCode >= 400 && err?.statusCode < 500 ? err.message : t('agent.failed', lang);
    await remember(reply);
    return { reply, lang, reason: 'DOCUMENT_UNREADABLE' };
  }

  const history2 = memory ? historyFrom(memory, history) : history;
  const result = await runAgentSafely({
    message: message || 'Check this file', actor, source: 'WHATSAPP', lang, history: history2, conversationId,
    attachment: { fileId: stored.fileId },
  });
  let reply = toWhatsAppText(result.reply);
  if (multipleProfiles) reply += `\n\n${t('agent.actingAs', lang, { role: roleLabel })}`;
  return { reply, lang, tool: result.tool ?? null, importFileId: stored.fileId, ...(result.link && { link: result.link }), simulated: Boolean(got.simulated) };
}

/**
 * The words of a voice note, or the reply that says why there are none.
 *
 *   - the in-app simulator / a test webhook (never a live number) may carry a
 *     stand-in transcript, labelled simulated;
 *   - otherwise the audio is downloaded through the provider it came from
 *     (whatsapp.media.js) and transcribed by the speech adapter (ai/speech/stt.js);
 *   - no speech service configured -> said plainly, never guessed.
 */
async function voiceNoteText(voice, actor) {
  const lang = await replyLanguage('', actor);
  if (voice?.simulatedTranscript && !isWhatsappLive()) {
    const text = String(voice.simulatedTranscript).trim().slice(0, 1000);
    return text ? { text, simulated: true } : { reply: replyLabel(lang, 'voiceUnclear'), lang, reason: 'VOICE_EMPTY' };
  }
  if (!isSttConfigured()) return { reply: replyLabel(lang, 'voiceNeedsService'), lang, reason: 'VOICE_NOT_CONFIGURED' };
  const media = voice?.chatflowMedia ? await downloadChatflowMedia(voice.chatflowMedia) : await downloadMetaMedia(voice?.id);
  if (!media) return { reply: replyLabel(lang, 'voiceUnclear'), lang, reason: 'VOICE_DOWNLOAD_FAILED' };
  const out = await transcribe({ audio: media.audio, mimeType: media.mimeType, lang: lang === 'en' ? null : lang });
  if (!out.text) return { reply: replyLabel(lang, 'voiceUnclear'), lang, reason: out.error ?? 'VOICE_EMPTY' };
  return { text: out.text, provider: out.provider };
}

/**
 * The language to answer in. What the person wrote decides when it is clear
 * (Devanagari, Tamil, Hinglish...). A message that says nothing about language
 * ("Hi", "ok", a number) is answered in the language they chose for school
 * messages, so a parent who set Hindi is not greeted in English.
 */
async function replyLanguage(message, actor) {
  // p7: Devanagari is Hindi or Marathi -- told apart by their words.
  const indic = indicLanguageOf(message);
  if (indic) return indic;
  const detected = detectLanguage(message);
  if (detected.confident) return detected.lang;
  try {
    const pref = actor?.profileId ? await getPreferences(actor) : null;
    if (pref?.language && LANGUAGE_NAMES[pref.language]) return pref.language;
  } catch { /* preference unreadable: answer in what was detected */ }
  return detected.lang;
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
