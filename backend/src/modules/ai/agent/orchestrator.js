import { AuditLog } from '../../../models/auditLog.model.js';
import { checkAgentRate, recordInjectionAttempt } from './throttle.js';
import { AppError } from '../../../utils/AppError.js';
import { logger } from '../../../utils/logger.js';
import { parseIntentWithLlm, parseIntent, MAX_PLAN_STEPS } from './intent.js';
import { detectLanguage, t } from '../../../utils/language.js';
import { currentTenantId } from '../../../tenancy/tenantContext.js';
import { handleRagFallback } from './rag.js';
import { composeAnswer } from './response.js';
import { withMcpSession, listTools as listMcpTools, callTool as callMcpTool } from '../mcp/client.js';
import { getMcpTool, mcpToolsFor } from '../mcp/registry.js';
import { errorToAppError } from '../mcp/protocol.js';
import { peekConfirmation, rejectConfirmation, markFailed, canonicalToolName } from '../mcp/confirm.js';

/**
 * Shared agent orchestration core.
 *
 * Both surfaces — the in-app assistant and WhatsApp — call runAgent(), so the
 * behaviour, the authorization and the audit trail are identical regardless of
 * where the message arrived from. The only thing that differs is `source`.
 *
 * The security model in one line: **the language layer chooses, the tool layer
 * authorizes.** Intent parsing (rules, or a model given the MCP tool schemas)
 * may propose any tool with any arguments; nothing happens until the MCP server
 * has validated that proposal against the caller's live permission map, and no
 * high-impact write happens until a human confirms the exact summary they were
 * shown.
 *
 * Where the tool layer lives, since MCP:
 *
 *   EVERY ERP CALL goes out through the MCP client to the EduOS MCP server
 *          (src/modules/ai/mcp/), which authorizes it, re-enters the caller's
 *          school, validates the arguments, asks for confirmation when the
 *          operation warrants it, calls the same EduOS service the REST API
 *          calls, and audits the result. This file does not authorize a tool
 *          call, because it does not perform one.
 *   KNOWLEDGE questions that match no tool fall through to rag.js, which
 *          retrieves from the school's own written material. RAG answers what
 *          is written down; MCP answers what is currently true.
 *   LEGACY a pre-MCP proposal stored in AgentAction still resolves through the
 *          old path, so a "yes" to something proposed before the migration is
 *          not a dead end.
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
 * Renders a tool result in the caller's language.
 *
 * Tools return a message key plus parameters rather than a finished sentence,
 * so the same result reads correctly in every catalogued language. A tool that
 * still returns a literal `speak` string keeps working — it just stays English.
 *
 * Exported because the WhatsApp opening briefing renders tool results the same
 * way this file does; a second copy would drift the moment a key changed.
 */
export function speakOf(result, lang) {
  if (result?.speakKey) {
    const rendered = t(result.speakKey, lang, result.params ?? {});
    if (rendered) return rendered;
  }
  return result?.speak ?? '';
}

/**
 * Error codes written for a person to read.
 *
 * Everything the agent itself raises is phrased as an answer -- "you may not do
 * that", "which student?" -- and can be shown as-is. Anything else arriving as a
 * 4xx came from a service being asked a question by an HTTP client, and is
 * phrased for one.
 */
const AGENT_AUTHORED = new Set(['AGENT_FORBIDDEN', 'AGENT_FORBIDDEN_SCOPE', 'AGENT_NEEDS_INPUT']);

/**
 * Keeps service-layer validation errors out of the conversation.
 *
 * The surfaces below treat any 4xx as a "meaningful refusal" and show its
 * message to the user. That is right for the refusals the agent writes and
 * wrong for the ones the services do. A real example, from an administrator who
 * asked the WhatsApp bot for their attendance percentage:
 *
 *     enrollmentId is required
 *
 * A correct 400 for a REST caller that omitted a query parameter, and
 * meaningless to a person on WhatsApp -- as well as a small leak of internal
 * shape: field names, and which ones a request is missing.
 *
 * So an unrecognised 4xx becomes a sentence saying what the assistant can do
 * instead, and the original is logged for whoever fixes the tool. Deliberately
 * logged at warn: this firing means a tool asked the caller for something the
 * conversation has no way to supply, which is a bug in that tool.
 */
function humaniseToolError(err, { actor, lang, tool }) {
  if (!isMeaningfulRefusal(err)) return err;
  if (AGENT_AUTHORED.has(err?.code)) return err;

  logger.warn(
    `Tool ${tool} refused with a service-level message ("${err.message}") -- ` +
      'the tool should answer this case itself rather than leave it to the caller.'
  );

  const capabilities = mcpToolsFor(actor)
    .map((entry) => entry.description.toLowerCase())
    .slice(0, 5)
    .join('; ');

  return new AppError(t('agent.cannotAnswer', lang, { capabilities }), 400, [], 'AGENT_CANNOT_ANSWER');
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

    const { message, actor, lang: langOverride, source = 'WEB' } = opts ?? {};
    // detectLanguage() returns `{ lang }`; the fallback used to keep the whole
    // object as the language, so its replies silently ignored the caller's.
    const lang = langOverride ?? detectLanguage(message ?? '').lang;
    logger.error(`Agent failed, falling back to rules: ${err?.message}`);

    // The fallback answers through MCP, like everything else. What it drops is
    // the model, not the tool layer: the rules choose a tool, and the MCP
    // server still authorizes, scopes, validates and audits the call. It used
    // to call the tool directly — the one path on which a read skipped all of
    // that, the audit entry included. If MCP itself is what failed, this call
    // fails too, and the reply below says plainly what is unavailable.
    try {
      const intent = actor?.profileId ? parseIntent(message ?? '', actor) : null;
      const tool = intent ? getMcpTool(intent.tool) : null;

      // Reads only. A write needs a confirmation round-trip, and proposing one
      // while the system is already misbehaving is how a bad state gets
      // committed.
      if (tool && tool.operation === 'GET') {
        const result = await withMcpSession({ actor, channel: source }, (mcpSession) =>
          callMcpTool(mcpSession, intent.tool, intent.args ?? {}));
        if (result?.success) {
          return {
            reply: speakOf(result, lang),
            data: result.data,
            lang,
            action: null,
            tool: intent.tool,
            degraded: true,
            via: 'MCP',
          };
        }
      }
    } catch (fallbackErr) {
      logger.error(`Rule-based fallback also failed: ${fallbackErr?.message}`);
    }

    const available = actor?.profileId ? mcpToolsFor(actor) : [];
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

/**
 * @param {object[]} [history] Recent turns of the same conversation, oldest
 *   first, as `{ role: 'user' | 'assistant', text }`. Used only to resolve what
 *   a follow-up refers to. It is transcript, never authority: identity, role
 *   and permissions come from `actor` on every single turn, so nothing said
 *   earlier in a thread can widen what this one may do. Empty by default, so
 *   callers that pass none (the web assistant) behave exactly as before.
 */
export async function runAgent({ message, actor, source = 'WEB', lang: langOverride, history = [] } = {}) {
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
    // is somebody probing — so attempts are counted per actor and the surface
    // closes for them on the third.
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

  // Everything from here runs with an MCP session open. The handle is the only
  // thing that lets a tool call reach the ERP; it exists for this turn alone,
  // and it — not anything in the message or the model's output — is what tells
  // the MCP server who is asking.
  return withMcpSession({ actor, channel: source }, (mcpSession) =>
    routeTurn({ mcpSession, message, actor, source, lang, history })
  );
}

/**
 * The routing half of a turn, with an MCP session already open.
 *
 * Split out from runAgent so the session's lifetime is one visible
 * `withMcpSession` block rather than a handle threaded through early returns.
 */
async function routeTurn({ mcpSession, message, actor, source, lang, history }) {
  // The tool definitions come from the MCP server's own tools/list, which the
  // server filters to this caller's permissions. The agent therefore reasons
  // about exactly the capabilities the protocol says exist — one catalog, not
  // a prompt's idea of one and a registry's.
  let mcpTools = [];
  try {
    mcpTools = await listMcpTools(mcpSession);
  } catch (err) {
    // A dead MCP transport is an infrastructure fault. Falling through with an
    // empty list would look like "you have no permissions", which is a lie.
    logger.error(`MCP tools/list failed: ${err.message}`);
    throw err;
  }

  const intent = await parseIntentWithLlm(message, actor, { history, tools: mcpTools });
  if (!intent) {
    // No ERP tool fits. This is the case RAG is *for*: the school's own written
    // material — notices, policies — which is unstructured and has no tool to
    // call. See rag.js.
    const ragReply = await handleRagFallback(message, actor, lang);
    if (ragReply) {
      return { reply: ragReply, lang, action: null, knowledge: true, sources: ['RAG'] };
    }

    const available = mcpTools;
    return {
      reply: t('agent.unsure', lang, {
        capabilities: available.map((tool) => tool.description.toLowerCase()).slice(0, 5).join('; '),
      }),
      lang,
      action: null,
      suggestions: available.slice(0, 5).map((tool) => tool.name),
    };
  }

  const steps = (intent.steps ?? [intent]).slice(0, MAX_PLAN_STEPS);

  // Every tool a plan can name is an MCP tool: the rule parser's tool names are
  // all MCP names, and a model's proposal is filtered against the MCP
  // tools/list before it gets here. So this is a guard, not a route — there is
  // no second execution path behind it.
  const unknown = steps.find((step) => !getMcpTool(step.tool));
  if (unknown) {
    logger.error(`Agent plan named "${unknown.tool}", which is not an MCP tool`);
    throw new AppError('That capability is not available.', 400);
  }

  const result = await runMcpPlan({ mcpSession, steps, message, actor, source, lang });
  return withKnowledge({ result, message, actor, lang });
}

/** Phrasings that ask about a written rule or document as well as live data. */
const KNOWLEDGE_CUE = /\b(policy|policies|according to|as per|rules?|handbook|guidelines?|circular|regulations?)\b/i;

/**
 * Adds the school's own written material to an answer built from live data.
 *
 * "According to the attendance policy, who is below the threshold?" is two
 * questions: what the policy says (text — retrieval) and who is below it
 * (records — MCP). The MCP answer stays the one about records; retrieved text
 * is added beside it and never replaces or adjusts a number. Nothing is added
 * to a proposal awaiting confirmation, or when retrieval finds nothing.
 */
async function withKnowledge({ result, message, actor, lang }) {
  if (!KNOWLEDGE_CUE.test(String(message ?? '')) || result.action || result.via !== 'MCP') return result;
  let knowledge = null;
  try {
    knowledge = await handleRagFallback(message, actor, lang);
  } catch (err) {
    logger.warn(`Knowledge retrieval alongside MCP failed: ${err.message}`);
  }
  if (!knowledge) return result;
  return { ...result, reply: `${knowledge}\n\n${result.reply}`, knowledge: true, sources: ['RAG', 'MCP'] };
}

/**
 * Runs a plan of MCP calls and composes one answer from the results.
 *
 * Authorization, tenant scoping, argument validation, confirmation and the
 * audit entry all happen inside the MCP server — this side only decides what
 * to ask for and how to say the answer. That is the point of the split: the
 * agent cannot forget a check it does not perform.
 */
async function runMcpPlan({ mcpSession, steps, message, actor, source, lang }) {
  const calls = [];
  for (const step of steps) {
    const result = await callMcpTool(mcpSession, step.tool, step.args ?? {});

    // A write that needs approval stops the plan. The user is being asked a
    // question, and running the rest of the plan underneath that question would
    // mean answering something they have not agreed to yet.
    if (result?.action?.status === 'confirmation_required') {
      return {
        reply: t('agent.confirm', lang, { summary: result.action.summary }),
        lang,
        action: {
          id: result.action.id,
          confirmToken: result.action.confirmationToken,
          summary: result.action.summary,
          tool: step.tool,
          risk: result.action.risk,
          affectsOthers: Boolean(result.action.affectsOthers),
          expiresInMinutes: result.action.expiresInMinutes,
        },
        tool: step.tool,
        via: 'MCP',
      };
    }
    calls.push({ tool: step.tool, result });
  }

  const succeeded = calls.filter((c) => c.result?.success);

  // One call, and it was refused: surface it the way the agent always has — a
  // 403 stays a 403, a missing detail becomes a question — so the channels'
  // existing handling of refusals is unchanged.
  if (!succeeded.length && calls.length === 1) {
    const { result, tool } = calls[0];
    const err = errorToAppError(result);
    // Schema validation failures carry the list of what was wrong ("sectionId is
    // required") — phrased for a program, so the person is asked in the tool's
    // own words instead. A refusal raised by a tool or service ("Those students
    // are in different classes", "Which invoice?") is already phrased for a
    // person and is shown as it is.
    const schemaErrors = Array.isArray(result?.error?.details?.errors);
    // An argument the tool does not accept at all ("change Rahul's phone
    // number" → fields.phone) is not a missing detail: no amount of further
    // information makes it possible. Said plainly, with what *is* accepted,
    // rather than "I need a bit more".
    const unsupported = unsupportedParameters(result?.error?.details?.errors);
    if (unsupported.length) {
      return { reply: unsupportedReply(tool, unsupported), lang, action: null, tool, refused: 'UNSUPPORTED_FIELD', via: 'MCP' };
    }
    if (err.code === 'AGENT_NEEDS_INPUT' || err.mcpCode === 'INVALID_INPUT') {
      return {
        reply: schemaErrors ? needsInputReply(tool, err, lang) : err.message,
        lang,
        action: null,
        needsInput: true,
        intendedTool: tool,
        via: 'MCP',
      };
    }
    // A record that does not exist, or a business rule that stopped the change
    // ("No invoice numbered NOPE-999", "Already returned"), is the answer. It
    // used to be flattened into a generic apology, which told the person
    // nothing about what to fix.
    if (err.mcpCode === 'NOT_FOUND' || err.mcpCode === 'CONFLICT') {
      return { reply: err.message, lang, action: null, tool, refused: err.mcpCode, via: 'MCP' };
    }
    // A timeout is neither a refusal nor a failure: the operation may still be
    // running. Saying it failed would be as wrong as saying it worked, so the
    // server's own words — which say exactly that — are what the person hears.
    if (err.mcpCode === 'TIMEOUT') {
      return { reply: err.message, lang, action: null, tool, refused: 'TIMEOUT', outcome: 'UNKNOWN', via: 'MCP' };
    }
    throw humaniseToolError(err, { actor, lang, tool });
  }

  const reply = await composeAnswer({ message, calls, lang });
  const performed = calls.filter((c) => c.result?.action?.status === 'completed');

  return {
    reply,
    // One result keeps the flat `data` shape existing callers read; several are
    // reported per tool, because merging them would invent a structure.
    data: succeeded.length === 1
      ? succeeded[0].result.data
      : succeeded.map((c) => ({ tool: c.tool, data: c.result.data })),
    lang,
    action: null,
    executed: performed.length ? performed.map((c) => c.result.action) : undefined,
    // `tool` names the capability that answered — kept for the single-tool case
    // every existing caller and test reads.
    tool: calls[0].tool,
    tools: calls.map((c) => c.tool),
    via: 'MCP',
  };
}

/** The parameters a validation failure names as not accepted by the tool ("fields.phone"). */
function unsupportedParameters(errors) {
  if (!Array.isArray(errors)) return [];
  return errors
    .map((e) => /^([\w.[\]]+) is not a parameter of this tool$/.exec(String(e))?.[1])
    .filter(Boolean);
}

/**
 * "I can't do that: "phone" is not something this action accepts. It accepts
 * only: firstName, lastName, dob, gender, address."
 *
 * The accepted list comes from the tool's own schema, so it is always the
 * truth about what the tool will take.
 */
function unsupportedReply(toolName, paths) {
  const tool = getMcpTool(toolName);
  const names = paths.map((p) => p.split('.').pop());
  const parent = paths[0].includes('.') ? paths[0].split('.')[0] : null;
  const accepted = parent
    ? Object.keys(tool?.inputSchema?.properties?.[parent]?.properties ?? {})
    : [];
  return `I can't do that: ${names.map((n) => `"${n}"`).join(', ')} ${names.length === 1 ? 'is' : 'are'} not something this action accepts` +
    (accepted.length ? `. It accepts only: ${accepted.join(', ')}.` : '.');
}

/**
 * Turns a validation refusal into a question rather than an error message.
 *
 * "sectionId is required; entries is required" is a correct thing to say to a
 * program and a useless thing to say to a person on WhatsApp. The tool's own
 * description says what it needs in words a human wrote, so that is what gets
 * asked.
 */
function needsInputReply(toolName, err, lang) {
  const tool = getMcpTool(toolName);
  if (err.code === 'AGENT_NEEDS_INPUT' || !tool) return err.message;
  return t('agent.needsDetail', lang, { description: tool.description }) ||
    `I need a bit more to do that. ${tool.description}`;
}

/**
 * Executes a previously proposed write after the human confirms it — through
 * the MCP server, like every other tool call.
 *
 * This function executes, authorizes and claims nothing itself. It looks the
 * proposal up to learn which tool the token belongs to and hands the token to
 * that MCP tool. The MCP server then does the whole job at the moment data
 * changes: re-authorizes against live permissions, re-enters the caller's
 * school, claims the proposal atomically so a double-tap cannot run it twice,
 * runs the arguments that were approved, snapshots before and after, and
 * audits.
 *
 * A decline is recorded here, because declining changes no ERP data — it only
 * closes the proposal, atomically, so a "no" cannot race a "yes".
 */
export async function confirmAction({ confirmToken, actor, source = 'WEB', accept = true, lang = 'en' }) {
  if (!actor?.profileId) throw new AppError('Select a profile first', 403);
  if (!confirmToken) throw new AppError('Nothing to confirm.', 400);

  const pending = await peekConfirmation({ confirmationToken: confirmToken, actor });
  const toolName = canonicalToolName(pending.tool);

  if (!accept) {
    await rejectConfirmation(pending);
    await auditAgentAction({
      actor, tool: toolName, args: pending.args, source, status: 'REJECTED', resultId: pending._id,
    });
    return { reply: t('agent.cancelled', lang), lang, executed: false };
  }

  if (!getMcpTool(toolName)) {
    // A stored row naming a tool that no longer exists. It cannot run, so it is
    // closed rather than left pending forever.
    await markFailed(pending, new Error(`"${pending.tool}" is no longer available`));
    throw new AppError('That action is no longer available. Please ask again.', 410, [], 'AGENT_ACTION_EXPIRED');
  }

  return withMcpSession({ actor, channel: source }, async (mcpSession) => {
    const result = await callMcpTool(mcpSession, toolName, {}, { confirmationToken: confirmToken });
    // Still running past its time limit: not done, and not failed either. The
    // person is told exactly that, and `executed` stays false.
    if (!result.success && result.error?.code === 'TIMEOUT') {
      return { reply: result.error.message, lang, executed: false, outcome: 'UNKNOWN', tool: toolName, via: 'MCP' };
    }
    if (!result.success) throw errorToAppError(result);
    return {
      reply: speakOf(result, lang) || 'Done.',
      data: result.data,
      action: result.action ?? null,
      lang,
      executed: true,
      tool: toolName,
      via: 'MCP',
    };
  });
}
