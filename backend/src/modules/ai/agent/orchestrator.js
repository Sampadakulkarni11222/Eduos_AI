import crypto from 'crypto';
import { AgentAction } from '../../../models/agentAction.model.js';
import { AuditLog } from '../../../models/auditLog.model.js';
import { AppError } from '../../../utils/AppError.js';
import { logger } from '../../../utils/logger.js';
import { getTool, toolsAvailableTo } from './tools.js';
import { parseIntent } from './intent.js';

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

async function auditAgentAction({ actor, tool, args, source, status, error, resultId }) {
  try {
    await AuditLog.create({
      actorProfileId: actor?.profileId ?? null,
      action: `agent.${tool}`,
      entityType: 'AgentAction',
      entityId: resultId ? String(resultId) : null,
      after: { tool, args, status, ...(error && { error }) },
      channel: source === 'WHATSAPP' ? 'WHATSAPP' : 'WEB',
      ip: null,
    });
  } catch (err) {
    // Never let an audit write failure swallow the user's actual result.
    logger.error(`Agent audit log failed for ${tool}: ${err.message}`);
  }
}

/* ── Entry point ───────────────────────────────────────────── */
export async function runAgent({ message, actor, source = 'WEB' }) {
  if (!actor?.profileId) throw new AppError('Select a profile first', 403);

  const injection = detectInjection(message);
  if (injection.detected) {
    // Logged for monitoring; the request still proceeds through the normal
    // authorization path, which is what actually protects the data.
    logger.warn(
      `Prompt-injection attempt (${injection.count} pattern(s)) from profile ${actor.profileId} via ${source}`
    );
    await auditAgentAction({
      actor, tool: 'injection_attempt', args: { message: String(message).slice(0, 300) },
      source, status: 'BLOCKED',
    });
    return {
      reply:
        "I can only do the things your account is allowed to do, and I can't change those rules. Ask me about attendance, fees, homework or results.",
      action: null,
      flagged: 'PROMPT_INJECTION',
    };
  }

  const intent = parseIntent(message, actor);
  if (!intent) {
    const available = toolsAvailableTo(actor);
    return {
      reply:
        `I'm not sure what you need. I can help with: ${available.map((t) => t.description.toLowerCase()).slice(0, 5).join('; ')}.`,
      action: null,
      suggestions: available.slice(0, 5).map((t) => t.name),
    };
  }

  const tool = getTool(intent.tool);
  if (!tool) throw new AppError('That capability is not available.', 400);

  // Authorize FIRST — before validation, execution, or proposing anything.
  const scope = checkAuthorization(actor, tool);

  if (tool.validate) tool.validate(intent.args ?? {});

  // Reads run straight away.
  if (!tool.mutates) {
    const result = await tool.execute(actor, scope, intent.args ?? {});
    await auditAgentAction({ actor, tool: intent.tool, args: intent.args, source, status: 'READ' });
    return { reply: result.speak, data: result.data, action: null };
  }

  // Writes are proposed, never performed, on the first turn.
  const token = crypto.randomBytes(24).toString('hex');
  const summary = tool.summarise ? tool.summarise(intent.args ?? {}, actor) : tool.description;

  const pending = await AgentAction.create({
    actorProfileId: actor.profileId,
    tool: intent.tool,
    args: intent.args ?? {},
    summary,
    source,
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + CONFIRM_TTL_MINUTES * 60 * 1000),
  });

  return {
    reply: `${summary}. Shall I go ahead?`,
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
export async function confirmAction({ confirmToken, actor, source = 'WEB', accept = true }) {
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
    return { reply: 'No problem — I have not made any changes.', executed: false };
  }

  const tool = getTool(pending.tool);
  if (!tool) throw new AppError('That capability is no longer available.', 400);

  const scope = checkAuthorization(actor, tool);

  try {
    const result = await tool.execute(actor, scope, pending.args ?? {});
    pending.status = 'EXECUTED';
    pending.executedAt = new Date();
    await pending.save();
    await auditAgentAction({
      actor, tool: pending.tool, args: pending.args, source,
      status: 'EXECUTED', resultId: pending._id,
    });
    return { reply: result.speak, data: result.data, executed: true };
  } catch (err) {
    pending.status = 'FAILED';
    pending.error = err.message;
    await pending.save();
    await auditAgentAction({
      actor, tool: pending.tool, args: pending.args, source,
      status: 'FAILED', error: err.message,
    });
    throw err;
  }
}
