import crypto from 'crypto';
import { AgentAction } from '../../../models/agentAction.model.js';
import { AuditLog } from '../../../models/auditLog.model.js';
import { checkAgentRate, recordInjectionAttempt } from './throttle.js';
import { AppError } from '../../../utils/AppError.js';
import { logger } from '../../../utils/logger.js';
import { getTool, toolsAvailableTo } from './tools.js';
import { parseIntentWithLlm, parseIntent } from './intent.js';
import { detectLanguage, t } from '../../../utils/language.js';
import { currentTenantId } from '../../../tenancy/tenantContext.js';
import { handleRagFallback } from './rag.js';

const CONFIRM_TTL_MINUTES = 10;

/**
 * Shared agent orchestration core.
 *
 * Both surfaces — the in-app assistant and WhatsApp — call runAgent(), so the
 * behaviour, the authorization and the audit trail are identical regardless of
 * where the message arrived from. The only thing that differs is `source`.
 *
 * The security model in one line: **the language layer chooses, the tool layer
 * authorizes.** Intent parsing (rules today, an LLM tomorrow) may propose any
 * tool with any arguments; nothing happens until checkAuthorization() has
 * validated it against the caller's live permission map, and no write happens
 * until a human confirms the exact summary they were shown.
 */

/* ── Prompt-injection detection ──────────────────────────────
   Untrusted free text reaches this surface, so instruction-override attempts
   are logged and stripped of authority. Note this is defence in depth, not the
   defence: even a perfectly successful injection cannot widen permissions,
   because the model never carries the authorization decision. */
const INJECTION_PATTERNS = [
  /ignore (all |any |the )?(previous|prior|above) (instructions|rules|prompts)/i,
  /disregard (your|all|the) (instructions|rules|guidelines|system prompt)/i,
  /you are now (a|an|in) /i,
  /(reveal|show|print|repeat) (me )?(your|the) (system )?(prompt|instructions)/i,
  /pretend (to be|you are)/i,
  /developer mode|jailbreak|DAN mode/i,
  /act as (an? )?(admin|administrator|owner|principal|teacher)/i,
  /bypass (the )?(permission|security|rbac|auth)/i,
];

export function detectInjection(message) {
  const hits = INJECTION_PATTERNS.filter((re) => re.test(String(message ?? '')));
  return { detected: hits.length > 0, count: hits.length };
}

/* ── Authorization ─────────────────────────────────────────── */
export function checkAuthorization(actor, tool) {
  const scope = actor?.permissions?.[tool.permission];
  if (!scope) {
    // Same shape of refusal the REST API gives, so the bot can never be a
    // softer path to the same data than the UI is.
    throw new AppError(
      `You do not have permission to do that (${tool.permission}).`,
      403,
      [],
      'AGENT_FORBIDDEN'
    );
  }
  if (tool.minScope === 'ALL' && scope !== 'ALL') {
    throw new AppError(
      'That action is limited to your own records, so I cannot run it school-wide.',
      403,
      [],
      'AGENT_FORBIDDEN_SCOPE'
    );
  }
  return scope;
}

/**
 * A write has to land in exactly one school.
 *
 * Every school-owned collection is filtered by the acting school, but a
 * platform-level Super Admin — signed in with no `X-School-Id` — runs with no
 * school at all, and a bulk write in that state is unbounded: it names records
 * by id and the tenant filter is not there to confine it. announcement.service
 * already refuses this for its own case; this applies the same rule to every
 * tool that mutates, so no single tool has to remember it.
 *
 * Reads are deliberately left alone: reading across schools is exactly what
 * the platform-level views are for.
 */
export function assertSchoolContext(tool) {
  if (!tool?.mutates) return;
  if (currentTenantId()) return;
  throw new AppError(
    'Choose a school before running that action.',
    400, [], 'AGENT_SCHOOL_REQUIRED',
  );
}

/**
 * Writes one agent action to the Phase 3 audit log.
 *
 * `before`/`after` carry the **state of the affected record**, not the request
 * — that distinction is the whole point of auditing a write. Knowing that
 * `agent.mark_attendance` was called with some arguments does not answer the
 * question an audit exists to answer, which is what the register said before
 * and what it says now. Tools opt in by implementing `snapshot()`; creations
 * legitimately have `before: null` because nothing existed.
 *
 * `request` keeps the arguments alongside, so a reviewer can see what was asked
 * for as well as what changed.
 */
async function auditAgentAction({
  actor, tool, args, source, status, error, resultId, before = null, after = null,
}) {
  try {
    await AuditLog.create({
      actorProfileId: actor?.profileId ?? null,
      action: `agent.${tool}`,
      entityType: 'AgentAction',
      entityId: resultId ? String(resultId) : null,
      before,
      after: { request: args, status, ...(after && { state: after }), ...(error && { error }) },
      channel: source === 'WHATSAPP' ? 'WHATSAPP' : 'WEB',
      ip: null,
    });
  } catch (err) {
    // Never let an audit write failure swallow the user's actual result.
    logger.error(`Agent audit log failed for ${tool}: ${err.message}`);
  }
}

/**
 * Captures a tool's view of the records it is about to touch.
 *
 * Failure here must never block the write the user authorized, so a broken
 * snapshot degrades to a recorded null with a log line rather than an error.
 */
async function snapshotState(tool, actor, scope, args, prepared, phase) {
  if (!tool.snapshot) return null;
  try {
    return await tool.snapshot(actor, scope, args ?? {}, prepared ?? null);
  } catch (err) {
    logger.warn(`Agent ${phase} snapshot failed: ${err.message}`);
    return null;
  }
}

/**
 * Renders a tool result in the caller's language.
 *
 * Tools return a message key plus parameters rather than a finished sentence,
 * so the same result reads correctly in every catalogued language. A tool that
 * still returns a literal `speak` string keeps working — it just stays English.
 */
function speakOf(result, lang) {
  if (result?.speakKey) {
    const rendered = t(result.speakKey, lang, result.params ?? {});
    if (rendered) return rendered;
  }
  return result?.speak ?? '';
}

/* ── Entry point ───────────────────────────────────────────── */
/**
 * Errors that are *answers*, not faults.
 *
 * "You may not do that" and "I need a date" are the assistant working
 * correctly, and must keep their status codes. Everything else — a provider
 * outage, a timeout, a bug — is an infrastructure failure the user should not
 * be made to care about.
 */
function isMeaningfulRefusal(err) {
  const status = err?.statusCode ?? err?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/**
 * runAgent() with a floor under it.
 *
 * The assistant previously surfaced any unexpected failure as a raw 500, which
 * the web client rendered as "Sorry — I could not reach the assistant just
 * now." — a dead end that told the user nothing and offered no way forward,
 * even when the question was one the deterministic rules could have answered
 * without the model at all.
 *
 * So on an infrastructure failure this retries the same message through the
 * rule-based path only (no LLM), and answers from live school data if a read
 * tool matches. Failing that, it says plainly that the AI service is
 * unavailable and lists what still works. Either way the endpoint returns 200:
 * the user's question was received and handled, and a degraded answer is not
 * an HTTP error.
 */
export async function runAgentSafely(opts) {
  try {
    return await runAgent(opts);
  } catch (err) {
    if (isMeaningfulRefusal(err)) throw err;

    const { message, actor, lang: langOverride } = opts ?? {};
    const lang = langOverride ?? detectLanguage(message ?? '');
    logger.error(`Agent failed, falling back to rules: ${err?.message}`);

    try {
      const intent = parseIntent(message ?? '', actor);
      const tool = intent ? getTool(intent.tool) : null;

      // Reads only. A write needs a confirmation round-trip, and proposing one
      // while the system is already misbehaving is how a bad state gets
      // committed.
      if (tool && !tool.mutates) {
        const scope = checkAuthorization(actor, tool);
        const result = await tool.execute(actor, scope, intent.args ?? {});
        return {
          reply: speakOf(result, lang),
          data: result.data,
          lang,
          action: null,
          tool: intent.tool,
          degraded: true,
        };
      }
    } catch (fallbackErr) {
      logger.error(`Rule-based fallback also failed: ${fallbackErr?.message}`);
    }

    const available = toolsAvailableTo(actor);
    return {
      reply: t('agent.degraded', lang, {
        capabilities: available.map((tool) => tool.description.toLowerCase()).slice(0, 5).join('; '),
      }),
      lang,
      action: null,
      degraded: true,
      suggestions: available.slice(0, 5).map((tool) => tool.name),
    };
  }
}

export async function runAgent({ message, actor, source = 'WEB', lang: langOverride } = {}) {
  if (!actor?.profileId) throw new AppError('Select a profile first', 403);

  // An explicit language (from the voice picker or a UI preference) wins over
  // detection — a user who has chosen Hindi should not be flipped back to
  // English by one message they happened to type in English.
  const detected = detectLanguage(message);
  const lang = langOverride ?? detected.lang;

  // Per-actor pace limit, enforced in the core so it holds on every surface.
  // Throws 429, and also refuses an actor currently blocked for repeated
  // injection attempts.
  checkAgentRate(actor.profileId);

  const injection = detectInjection(message);
  if (injection.detected) {
    // Individual attempts were always logged. What was missing was any notion
    // of repetition — one unlucky phrase is not an attack, three in a minute
    // is somebody probing — so attempts are now counted per actor and the
    // surface closes for them on the third.
    const strike = recordInjectionAttempt(actor.profileId, { source });
    logger.warn(
      `Prompt-injection attempt ${strike.count} (${injection.count} pattern(s)) from profile ${actor.profileId} via ${source}`
    );
    await auditAgentAction({
      actor, tool: 'injection_attempt', args: { message: String(message).slice(0, 300) },
      source, status: strike.blocked ? 'BLOCKED_REPEATED' : 'BLOCKED',
      after: { attemptsInWindow: strike.count, surfaceBlocked: strike.blocked },
    });
    return {
      reply: t('agent.injection', lang),
      lang,
      action: null,
      flagged: 'PROMPT_INJECTION',
    };
  }

  const intent = await parseIntentWithLlm(message, actor);
  if (!intent) {
    // Attempt RAG fallback for unstructured queries or generic greetings
    const ragReply = await handleRagFallback(message, actor, lang);
    if (ragReply) {
      return { reply: ragReply, lang, action: null };
    }

    const available = toolsAvailableTo(actor);
    return {
      reply: t('agent.unsure', lang, {
        capabilities: available.map((tool) => tool.description.toLowerCase()).slice(0, 5).join('; '),
      }),
      lang,
      action: null,
      suggestions: available.slice(0, 5).map((tool) => tool.name),
    };
  }

  const tool = getTool(intent.tool);
  if (!tool) throw new AppError('That capability is not available.', 400);

  // Authorize FIRST — before validation, execution, or proposing anything.
  const scope = checkAuthorization(actor, tool);
  assertSchoolContext(tool);

  if (tool.validate) {
    try {
      tool.validate(intent.args ?? {});
    } catch (err) {
      // A missing detail becomes a question, not a failure — the caller stays
      // in the conversation and can just answer it.
      if (err?.code === 'AGENT_NEEDS_INPUT') {
        return {
          reply: (err.speakKey && t(err.speakKey, lang)) || err.message,
          lang,
          action: null,
          needsInput: true,
          intendedTool: intent.tool,
        };
      }
      throw err;
    }
  }

  // Reads run straight away.
  if (!tool.mutates) {
    const result = await tool.execute(actor, scope, intent.args ?? {});
    await auditAgentAction({ actor, tool: intent.tool, args: intent.args, source, status: 'READ' });
    // `tool` is reported so callers (and tests) can see which capability
    // answered, rather than having to infer it from the wording of the reply.
    return { reply: speakOf(result, lang), data: result.data, lang, action: null, tool: intent.tool };
  }

  // Writes are proposed, never performed, on the first turn.
  //
  // A tool may prepare its payload now (drafting homework, for example) so the
  // summary describes something that already exists in full rather than a
  // promise to generate it later. The result is stored with the proposal.
  const prepared = tool.prepare ? await tool.prepare(actor, scope, intent.args ?? {}) : null;

  const token = crypto.randomBytes(24).toString('hex');
  const summary = tool.summarise ? tool.summarise(intent.args ?? {}, actor, prepared) : tool.description;

  // Only ever one proposal outstanding per person. On WhatsApp a bare "yes"
  // resolves whatever is pending, so a forgotten proposal from earlier could
  // otherwise be executed by a "yes" the user meant for something else.
  // Superseding here fixes that for every surface at once.
  await AgentAction.updateMany(
    { actorProfileId: actor.profileId, status: 'PENDING' },
    { $set: { status: 'EXPIRED' } }
  );

  const pending = await AgentAction.create({
    actorProfileId: actor.profileId,
    tool: intent.tool,
    args: intent.args ?? {},
    prepared,
    summary,
    source,
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + CONFIRM_TTL_MINUTES * 60 * 1000),
  });

  return {
    reply: t('agent.confirm', lang, { summary }),
    lang,
    action: {
      id: pending._id,
      confirmToken: token,
      summary,
      tool: intent.tool,
      affectsOthers: Boolean(tool.affectsOthers),
      expiresInMinutes: CONFIRM_TTL_MINUTES,
    },
  };
}

/**
 * Executes a previously proposed write after the human confirms it.
 *
 * Re-authorizes at execution time rather than trusting the earlier check: the
 * caller's permissions may have been revoked between proposal and confirmation,
 * and this is the moment data actually changes.
 */
export async function confirmAction({ confirmToken, actor, source = 'WEB', accept = true, lang = 'en' }) {
  if (!actor?.profileId) throw new AppError('Select a profile first', 403);
  if (!confirmToken) throw new AppError('Nothing to confirm.', 400);

  const tokenHash = crypto.createHash('sha256').update(confirmToken).digest('hex');
  const pending = await AgentAction.findOne({ tokenHash });

  if (!pending) throw new AppError('That confirmation has expired or was already used.', 404, [], 'AGENT_ACTION_NOT_FOUND');

  // The proposal belongs to whoever it was issued to — a leaked token is
  // useless to anyone else.
  if (String(pending.actorProfileId) !== String(actor.profileId)) {
    logger.warn(`Agent confirm token replayed by a different profile (${actor.profileId})`);
    throw new AppError('That confirmation does not belong to you.', 403, [], 'AGENT_ACTION_FORBIDDEN');
  }
  if (pending.status !== 'PENDING') {
    throw new AppError('That action has already been dealt with.', 409, [], 'AGENT_ACTION_CONSUMED');
  }
  if (pending.expiresAt < new Date()) {
    pending.status = 'EXPIRED';
    await pending.save();
    throw new AppError('That confirmation has expired. Please ask again.', 410, [], 'AGENT_ACTION_EXPIRED');
  }

  if (!accept) {
    pending.status = 'REJECTED';
    await pending.save();
    await auditAgentAction({ actor, tool: pending.tool, args: pending.args, source, status: 'REJECTED' });
    return { reply: t('agent.cancelled', lang), lang, executed: false };
  }

  const tool = getTool(pending.tool);
  if (!tool) throw new AppError('That capability is no longer available.', 400);

  const scope = checkAuthorization(actor, tool);
  // Re-checked here for the same reason the permission is: this is the moment
  // data actually changes, and the acting school can differ from the one the
  // proposal was made under.
  assertSchoolContext(tool);

  // Captured before the write, so the audit entry can show what the record
  // looked like beforehand rather than only what was requested.
  const before = await snapshotState(tool, actor, scope, pending.args, pending.prepared, 'before');

  try {
    const result = await tool.execute(actor, scope, pending.args ?? {}, pending.prepared ?? null);
    pending.status = 'EXECUTED';
    pending.executedAt = new Date();
    await pending.save();
    const after = await snapshotState(tool, actor, scope, pending.args, pending.prepared, 'after');
    await auditAgentAction({
      actor, tool: pending.tool, args: pending.args, source,
      status: 'EXECUTED', resultId: pending._id, before, after,
    });
    return { reply: speakOf(result, lang), data: result.data, lang, executed: true };
  } catch (err) {
    pending.status = 'FAILED';
    pending.error = err.message;
    await pending.save();
    // `before` is still worth recording on a failure: it shows the state a
    // half-applied write would have started from.
    await auditAgentAction({
      actor, tool: pending.tool, args: pending.args, source,
      status: 'FAILED', error: err.message, before,
    });
    throw err;
  }
}
