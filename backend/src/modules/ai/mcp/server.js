import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getMcpTool, mcpToolsFor, mutates, requiresConfirmation } from './registry.js';
import { resolveSession, STRIPPED_ARGS } from './session.js';
import { validateArgs } from './validate.js';
import { ok, fail, failFromError, needsConfirmation, MCP_ERROR } from './protocol.js';
import {
  proposeAction, peekConfirmation, claimConfirmation, markExecuted, markFailed, canonicalToolName,
} from './confirm.js';
import { runInTenantState } from '../../../tenancy/tenantContext.js';
import { AuditLog } from '../../../models/auditLog.model.js';
import { redact, isMedicalAuditEntry, MEDICAL_PAYLOAD_WITHHELD } from '../../../middleware/auditLogger.js';
import { logger } from '../../../utils/logger.js';
import { AI_ASSISTANT_PERMISSION } from '../../../constants/permissions.js';

/**
 * The EduOS MCP server.
 *
 * This is the controlled boundary between an AI agent and the ERP. Everything
 * on the far side of it is a language model's opinion; everything on this side
 * is checked. In order, on every `tools/call`:
 *
 *   1. IDENTITY       the session handle is exchanged for the actor Express
 *                     authenticated, or the one resolved from the phone number
 *                     Meta verified. Identity is never read from arguments.
 *   2. AUTHORIZATION  the tool's permission is checked against that actor's
 *                     *live* permission map, at the scope the tool declares —
 *                     the same check the REST middleware makes.
 *   3. TENANCY        the call is re-entered in the school the caller was in,
 *                     so every tenant-scoped collection filters exactly as it
 *                     does for their HTTP requests.
 *   4. VALIDATION     arguments are checked against the tool's JSON Schema, and
 *                     identity-shaped keys are dropped before they get there.
 *   5. CONFIRMATION   a write that needs approval is *proposed*, not performed.
 *                     Nothing changes until a person answers yes and the token
 *                     comes back — at which point steps 2 and 3 run again.
 *   6. EXECUTION      the tool calls the existing EduOS service. No SQL, no
 *                     arbitrary URLs, no shell, no direct collection access.
 *   7. AUDIT          the call, its outcome, its actor and — for writes that
 *                     support it — the record's state before and after.
 *
 * The model is treated as an untrusted planner throughout. It chooses; this
 * file permits.
 */

export const SESSION_META_KEY = 'eduos/session';
export const CONFIRM_META_KEY = 'eduos/confirmation';
export const SERVER_NAME = 'eduos-erp';
export const SERVER_VERSION = '1.0.0';

/**
 * Wall-clock ceiling for one tool call, so a stuck query cannot hold a chat open.
 * Read per call rather than once at import, so an operator's change (and a test)
 * takes effect without reloading the module graph.
 */
export function toolTimeoutMs() {
  return Number(process.env.MCP_TOOL_TIMEOUT_MS) || 20_000;
}

/**
 * Keys that never leave this server inside a result, whatever a tool returns.
 *
 * Tools build their results from explicit fields, and that stays the rule —
 * this is the backstop for the day one does not. The tenant id is the server's
 * business, not the model's; the rest are credentials, hashes and the
 * encrypted-at-rest medical fields (`*Enc`), none of which a reply ever needs.
 * Applied to `data` only: the envelope's own `action.confirmationToken` is the
 * one token that is meant to travel.
 */
const REDACTED_KEYS = new Set([
  'tenantId', 'tenant_id', '__v', 'accountId',
  'password', 'passwordHash', 'tokenHash', 'otp', 'otpHash', 'codeHash',
  'accessToken', 'refreshToken', 'apiKey', 'secret', 'confirmationToken',
]);
const REDACTED_PATTERN = /(Enc|Hash|Secret|Password)$/;

export function redactResultData(value, removed = new Set(), depth = 0) {
  if (value === null || typeof value !== 'object' || depth > 25) return value;
  if (value instanceof Date || Buffer.isBuffer(value) || value._bsontype) return value;
  // A hydrated Mongoose document: its own fields, not its internals.
  if (typeof value.toObject === 'function' && value.$__) return redactResultData(value.toObject(), removed, depth);
  if (Array.isArray(value)) return value.map((item) => redactResultData(item, removed, depth + 1));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (REDACTED_KEYS.has(key) || REDACTED_PATTERN.test(key)) {
      removed.add(key);
      continue;
    }
    out[key] = redactResultData(item, removed, depth + 1);
  }
  return out;
}

function asToolResult(envelope) {
  return {
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
    structuredContent: envelope,
    isError: envelope.success === false,
  };
}

/**
 * Drops identity-shaped arguments before a tool ever sees them.
 *
 * Returns what was stripped as well, because a model reaching for `tenantId`
 * is worth a log line: it is either a prompt-injection attempt or a tool
 * description that needs rewording, and both want looking at.
 */
function sanitiseArgs(args) {
  const clean = {};
  const stripped = [];
  for (const [key, value] of Object.entries(args ?? {})) {
    if (STRIPPED_ARGS.has(key)) stripped.push(key);
    else clean[key] = value;
  }
  return { clean, stripped };
}

/**
 * Writes one MCP call to the existing EduOS audit log.
 *
 * `before`/`after` carry the state of the affected record where the tool can
 * supply it, not just the request — that distinction is the point of auditing
 * a write. Knowing `mcp.mark_attendance` was called with some arguments does
 * not answer the question an audit exists to answer, which is what the
 * register said before and what it says now.
 */
async function audit({ session, tool, args, status, code = null, durationMs = null, before = null, after = null, confirmed = null, actionId = null }) {
  // The same redaction the REST trail applies: credentials never, and a
  // medical tool's request and record state not at all (see auditLogger.js).
  const medical = isMedicalAuditEntry({ action: tool });
  args = medical ? MEDICAL_PAYLOAD_WITHHELD : redact(args);
  before = before && (medical ? MEDICAL_PAYLOAD_WITHHELD : redact(before));
  after = after && (medical ? MEDICAL_PAYLOAD_WITHHELD : redact(after));
  try {
    await AuditLog.create({
      actorProfileId: session?.actor?.profileId ?? null,
      // Deliberately `agent.<tool>`, not `mcp.<tool>`. Everything the assistant
      // does has been auditable under that one name since before MCP existed,
      // and an audit trail whose name changed under a refactor is one where the
      // history splits in two — a reviewer asking "what has the assistant done"
      // would get half an answer. Which layer performed it is recorded in the
      // entry body (`via`) instead, where it is information rather than a
      // filter everyone has to know about.
      action: `agent.${tool}`,
      entityType: 'AgentAction',
      entityId: actionId ? String(actionId) : null,
      before,
      after: {
        request: args ?? {},
        status,
        via: 'MCP',
        ...(code && { code }),
        ...(confirmed !== null && { confirmed }),
        ...(after && { state: after }),
        ...(durationMs != null && { durationMs }),
        tenantId: session?.tenant?.tenantId ?? null,
        crossSchool: Boolean(session?.tenant?.bypass),
      },
      channel: session?.channel === 'WHATSAPP' ? 'WHATSAPP' : 'WEB',
      ip: null,
    });
  } catch (err) {
    // An audit failure must never swallow the caller's answer.
    logger.error(`MCP audit log failed for ${tool}: ${err.message}`);
  }
}

const TIMED_OUT = Symbol('mcp-tool-timeout');

/**
 * A tool call that outlived MCP_TOOL_TIMEOUT_MS.
 *
 * A read is simply answered "too slow" — nothing was changed. A write is the
 * case that matters. The service call is already running and cannot be
 * recalled, and the money paths inside it are transactional, so it will either
 * complete or roll back on its own. Declaring it failed at this moment would be
 * a guess, and the wrong one would tell a person their payment did not go
 * through when it did — inviting them to record it again.
 *
 * So the write is left to finish. The person is told the outcome is not yet
 * known. A redeemed proposal stays EXECUTING, so its token cannot run it a
 * second time. When the call does settle, the proposal is marked and the audit
 * trail records what actually happened (EXECUTED_AFTER_TIMEOUT or
 * FAILED_AFTER_TIMEOUT), with the before/after state as usual.
 */
async function handleTimeout({ session, tool, name, toolArgs, prepared, pending, ctx, before, running, started }) {
  logger.warn(`MCP tool ${name} exceeded ${toolTimeoutMs()}ms for profile ${session.actor.profileId}`);

  if (!mutates(tool)) {
    running.catch((err) => logger.warn(`MCP read ${name} failed after its timeout: ${err?.message}`));
    await audit({ session, tool: name, args: toolArgs, status: 'TIMEOUT', code: MCP_ERROR.TIMEOUT, durationMs: Date.now() - started });
    return fail(MCP_ERROR.TIMEOUT, 'That took too long to answer. Please try again in a moment.');
  }

  const confirmed = pending ? true : false;
  const actionId = pending?._id ?? null;
  await audit({
    session, tool: name, args: toolArgs, status: 'TIMEOUT_OUTCOME_PENDING', code: MCP_ERROR.TIMEOUT,
    confirmed, actionId, before, durationMs: Date.now() - started,
  });

  const settle = (fn) => runInTenantState(session.tenant, fn);
  running
    .then(
      async (envelope) => {
        const result = envelope?.success === undefined ? ok(envelope) : envelope;
        if (pending) {
          await settle(() => (result.success ? markExecuted(pending) : markFailed(pending, new Error(result.error?.message ?? 'failed'))));
        }
        const after = result.success ? await settle(() => snapshot(tool, ctx, toolArgs, prepared, 'after')) : null;
        await settle(() => audit({
          session, tool: name, args: toolArgs,
          status: result.success ? 'EXECUTED_AFTER_TIMEOUT' : 'FAILED_AFTER_TIMEOUT',
          code: result.success ? null : result.error?.code, confirmed, actionId, before, after,
          durationMs: Date.now() - started,
        }));
      },
      async (err) => {
        logger.error(`MCP tool ${name} failed after its timeout: ${err?.message}`);
        if (pending) await settle(() => markFailed(pending, err));
        await settle(() => audit({
          session, tool: name, args: toolArgs, status: 'FAILED_AFTER_TIMEOUT', code: failFromError(err).error.code,
          confirmed, actionId, before, durationMs: Date.now() - started,
        }));
      },
    )
    .catch((err) => logger.error(`Settling ${name} after its timeout failed: ${err?.message}`));

  return fail(
    MCP_ERROR.TIMEOUT,
    'This is taking longer than expected. It has not been cancelled and may still complete, so please check before trying it again.',
    { outcome: 'UNKNOWN' },
  );
}

/**
 * Captures a tool's view of what it is about to touch.
 *
 * Failure here must never block the write the user authorized, so a broken
 * snapshot degrades to a recorded null and a log line rather than an error.
 */
async function snapshot(tool, ctx, args, prepared, phase) {
  if (typeof tool.snapshot !== 'function') return null;
  try {
    return await tool.snapshot(ctx, args, prepared);
  } catch (err) {
    logger.warn(`MCP ${phase} snapshot failed: ${err.message}`);
    return null;
  }
}

/**
 * Authorization: the caller's live permissions, at the scope the tool needs.
 *
 * Returns the scope on success, or a failure envelope. Runs on every call and
 * again at confirmation time — permissions can be revoked between a proposal
 * and the "yes" that redeems it, and that is exactly the moment data changes.
 */
function authorize(actor, tool) {
  // The assistant permission first, before the tool's own. It is what admits a
  // caller to the assistant at all, so an actor without it is refused here
  // rather than merely being left out of the catalogue: hiding a tool is not
  // the same as refusing to run it, and every tool names a permission that
  // some catalogue-less actor may still hold. Uniform for every role -- it is
  // the permission that decides, not the name.
  if (!actor?.permissions?.[AI_ASSISTANT_PERMISSION]) {
    return { error: fail(MCP_ERROR.FORBIDDEN, 'You are not authorized to use the assistant.') };
  }

  const scope = actor?.permissions?.[tool.permission];
  if (!scope) {
    return { error: fail(MCP_ERROR.FORBIDDEN, 'You are not authorized to access this information.') };
  }
  if (tool.minScope === 'ALL' && scope !== 'ALL') {
    return {
      error: fail(
        MCP_ERROR.FORBIDDEN_SCOPE,
        'That is limited to your own records, so I cannot do it school-wide.',
      ),
    };
  }
  return { scope };
}

/**
 * A write has to land in exactly one school.
 *
 * Every school-owned collection is filtered by the acting school, but a
 * platform-level Super Admin — signed in with no school chosen — runs with no
 * school at all, and a write in that state is unbounded: it names records by id
 * and the tenant filter is not there to confine it. Reads are deliberately
 * left alone; reading across schools is what the platform-level views are for.
 */
function assertSchoolForWrite(tool, session) {
  if (!mutates(tool)) return null;
  if (session.tenant?.tenantId) return null;
  return fail(MCP_ERROR.SCHOOL_REQUIRED, 'Choose a school before running that action.');
}

/**
 * Runs one tool call, start to finish.
 *
 * Exported separately from the MCP wiring so the same path can be exercised
 * directly in tests, and so a future transport (stdio, HTTP) gets identical
 * checks rather than a second implementation of them.
 *
 * @param {string} [confirmationToken] Present when the user has said yes. Its
 *   presence is never enough on its own — the token must belong to this actor,
 *   be unused and unexpired, and the tool is re-authorized before it runs.
 */
export async function executeToolCall({ sessionId, name, args, confirmationToken = null }) {
  const started = Date.now();
  const session = resolveSession(sessionId);

  /* 1. Identity. */
  if (!session) {
    logger.warn(`MCP call to ${name} with no valid session`);
    return fail(MCP_ERROR.UNAUTHENTICATED, 'This request is not associated with a signed-in user.');
  }
  const { actor } = session;

  const tool = getMcpTool(name);
  if (!tool) {
    await audit({ session, tool: name, args, status: 'UNKNOWN_TOOL', code: MCP_ERROR.UNKNOWN_TOOL });
    return fail(MCP_ERROR.UNKNOWN_TOOL, 'That capability does not exist.');
  }

  /* 2. Authorization — live permissions, not anything cached at session open
        and not anything the model said. */
  const authorized = authorize(actor, tool);
  if (authorized.error) {
    await audit({ session, tool: name, args, status: 'FORBIDDEN', code: authorized.error.error.code });
    return authorized.error;
  }
  const scope = authorized.scope;

  const schoolError = assertSchoolForWrite(tool, session);
  if (schoolError) {
    await audit({ session, tool: name, args, status: 'SCHOOL_REQUIRED', code: MCP_ERROR.SCHOOL_REQUIRED });
    return schoolError;
  }

  const ctx = { actor, scope, channel: session.channel };
  let pending = null;
  let rawArgs = args;

  /* 5a. Redeeming a confirmation, if one was presented.
        Claimed *before* validation, because what has to be validated is what
        will actually run — the stored arguments the person approved — not
        whatever the caller sent along with the token. */
  if (confirmationToken) {
    try {
      // Looked at first, claimed second. A token presented against the wrong
      // tool is refused without being consumed, and the claim itself is the
      // atomic PENDING → EXECUTING update in confirm.js, so two concurrent
      // "yes" requests for one proposal cannot both get past this point.
      // Both run in the caller's school: AgentAction is tenant-scoped, and the
      // lookup must not depend on whatever context the transport carried.
      const peeked = await runInTenantState(session.tenant, () => peekConfirmation({ confirmationToken, actor }));
      if (canonicalToolName(peeked.tool) !== name) {
        logger.warn(`MCP confirmation for "${peeked.tool}" presented against "${name}"`);
        await audit({ session, tool: name, args, status: 'CONFIRMATION_MISMATCH', code: MCP_ERROR.CONFIRMATION_INVALID });
        return fail(MCP_ERROR.CONFIRMATION_INVALID, 'That confirmation was for a different action.');
      }
      pending = await runInTenantState(session.tenant, () => claimConfirmation({ confirmationToken, actor }));
    } catch (err) {
      const result = failFromError(err);
      await audit({ session, tool: name, args, status: 'CONFIRMATION_INVALID', code: result.error.code });
      return result;
    }
    rawArgs = pending.args ?? {};
  }

  /* 4. Validation. Identity keys go first, so they cannot even be validated. */
  const { clean, stripped } = sanitiseArgs(rawArgs);
  if (stripped.length) {
    logger.warn(
      `MCP call to ${name} carried caller-controlled identity argument(s) [${stripped.join(', ')}]. ` +
        `Identity comes from the session for profile ${actor.profileId}.`,
    );
    // A read with a stray `tenantId` is answered for the caller's own school —
    // the key is dropped and cannot widen anything. A WRITE carrying one is
    // refused outright: an action that arrives trying to say who it is for, or
    // which school it lands in, is either an injection attempt or a plan built
    // on a wrong premise, and neither should be executed on a best guess.
    if (mutates(tool) && !pending) {
      await audit({
        session, tool: name, args: clean, status: 'IDENTITY_ARGUMENT_REJECTED', code: MCP_ERROR.INVALID_INPUT,
      });
      return fail(
        MCP_ERROR.INVALID_INPUT,
        `Who is acting and in which school is decided by the server, so ${stripped.join(', ')} cannot be supplied to this action.`,
      );
    }
  }

  // A proposal stored before this tool had a schema can carry a key the schema
  // does not know. Refusing it would strand an action a person already
  // approved, and the pre-MCP tool ignored unknown keys anyway — so on
  // redemption only, an unknown key is dropped with a log line. Everything
  // else (missing required fields, wrong types) still fails, and a fresh call
  // is never treated this leniently.
  let candidate = clean;
  if (pending && tool.inputSchema?.additionalProperties === false) {
    const known = Object.keys(tool.inputSchema.properties ?? {});
    const unknown = Object.keys(clean).filter((k) => !known.includes(k));
    if (unknown.length) {
      logger.warn(`Stored proposal for ${name} carried unknown argument(s) [${unknown.join(', ')}] — dropped.`);
      candidate = Object.fromEntries(Object.entries(clean).filter(([k]) => known.includes(k)));
    }
  }

  const validation = validateArgs(tool.inputSchema, candidate);
  if (!validation.valid) {
    // A claimed proposal that cannot run must not be left PENDING, or the user
    // is stuck with a "yes" that neither happened nor went away.
    if (pending) await runInTenantState(session.tenant, () => markFailed(pending, new Error(validation.errors.join('; '))));
    await audit({
      session, tool: name, args: candidate, status: 'INVALID_INPUT', code: MCP_ERROR.INVALID_INPUT,
      actionId: pending?._id ?? null,
    });
    return fail(MCP_ERROR.INVALID_INPUT, validation.errors.join('; '), { errors: validation.errors });
  }

  let toolArgs = validation.value;
  let prepared = pending?.prepared ?? null;

  /* 5b. Proposing, when this call needs approval and does not carry one. */
  if (!pending && requiresConfirmation(tool, toolArgs)) {
    try {
      // A tool may build its payload now — drafting homework, resolving a
      // student, narrowing a patch to the allow-list — so the summary
      // describes something that already exists in full rather than a promise
      // to work it out later. It also means a refusal (a field that may not be
      // changed) reaches the user before they approve anything.
      prepared = await runInTenantState(session.tenant, () =>
        (typeof tool.prepare === 'function' ? tool.prepare(ctx, toolArgs) : null));
    } catch (err) {
      const result = failFromError(err);
      logger.warn(`MCP prepare failed for ${name}: ${err?.message}`);
      await audit({ session, tool: name, args: toolArgs, status: 'PREPARE_FAILED', code: result.error.code });
      return result;
    }

    const summary = tool.summarise(toolArgs, actor, prepared);
    const proposal = await runInTenantState(session.tenant, () => proposeAction({
      actor, tool: name, args: toolArgs, prepared, summary, source: session.channel,
    }));
    await audit({
      session, tool: name, args: toolArgs, status: 'CONFIRMATION_REQUIRED',
      confirmed: false, actionId: proposal.actionId, durationMs: Date.now() - started,
    });
    return needsConfirmation({
      actionId: proposal.actionId,
      confirmationToken: proposal.confirmationToken,
      summary,
      tool: name,
      risk: tool.risk,
      affectsOthers: Boolean(tool.affectsOthers),
      expiresInMinutes: proposal.expiresInMinutes,
    });
  } else if (mutates(tool) && prepared === null && typeof tool.prepare === 'function') {
    // A write that needs no approval may still prepare — and so may a redeemed
    // proposal whose tool prepared nothing when it was made. A proposal that
    // *did* prepare keeps what it stored, so what runs is what was approved.
    try {
      prepared = await runInTenantState(session.tenant, () => tool.prepare(ctx, toolArgs));
    } catch (err) {
      const result = failFromError(err);
      // A claimed proposal that cannot run is closed, not left EXECUTING.
      if (pending) await runInTenantState(session.tenant, () => markFailed(pending, err));
      await audit({ session, tool: name, args: toolArgs, status: 'PREPARE_FAILED', code: result.error.code });
      return result;
    }
  }

  /* 3 + 6 + 7. Re-enter the caller's school, snapshot, run, audit. */
  const before = mutates(tool)
    ? await runInTenantState(session.tenant, () => snapshot(tool, ctx, toolArgs, prepared, 'before'))
    : null;

  // Started once, then raced against the clock. A timeout does not abandon
  // it — see handleTimeout(): a write that is still running is left to finish
  // and is settled, and audited, when it does.
  const running = runInTenantState(session.tenant, () => tool.run(ctx, toolArgs, prepared));
  let timer;
  const clock = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), toolTimeoutMs()); });

  try {
    const envelope = await Promise.race([running, clock]).finally(() => clearTimeout(timer));
    if (envelope === TIMED_OUT) {
      return await handleTimeout({ session, tool, name, toolArgs, prepared, pending, ctx, before, running, started });
    }

    let result = envelope?.success === undefined ? ok(envelope) : envelope;
    if (result.success && result.data != null) {
      const withheld = new Set();
      result = { ...result, data: redactResultData(result.data, withheld) };
      if (withheld.size) logger.debug(`MCP ${name}: withheld [${[...withheld].join(', ')}] from its result`);
    }

    if (pending) await runInTenantState(session.tenant, () => markExecuted(pending));

    const after = mutates(tool) && result.success
      ? await runInTenantState(session.tenant, () => snapshot(tool, ctx, toolArgs, prepared, 'after'))
      : null;

    await audit({
      session, tool: name, args: toolArgs,
      status: result.success ? (mutates(tool) ? 'EXECUTED' : 'READ') : 'ERROR',
      code: result.success ? null : result.error?.code,
      confirmed: pending ? true : mutates(tool) ? false : null,
      actionId: pending?._id ?? null,
      before, after,
      durationMs: Date.now() - started,
    });
    return result;
  } catch (err) {
    const result = failFromError(err);
    // Logged in full here — the envelope deliberately does not carry an
    // internal message back to the model.
    logger.error(`MCP tool ${name} failed for profile ${actor.profileId}: ${err?.message}`);
    if (pending) await runInTenantState(session.tenant, () => markFailed(pending, err));
    await audit({
      session, tool: name, args: toolArgs, status: 'FAILED', code: result.error.code,
      confirmed: pending ? true : null, actionId: pending?._id ?? null,
      before, durationMs: Date.now() - started,
    });
    return result;
  }
}

/** Builds a fresh MCP server instance bound to the EduOS tool catalog. */
export function createMcpServer() {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    const session = resolveSession(request.params?._meta?.[SESSION_META_KEY]);
    // No session means no caller, and the catalog is not public: an
    // unauthenticated client learns that the server exists and nothing about
    // the school it serves.
    if (!session) return { tools: [] };
    return { tools: mcpToolsFor(session.actor) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const envelope = await executeToolCall({
      sessionId: request.params?._meta?.[SESSION_META_KEY],
      confirmationToken: request.params?._meta?.[CONFIRM_META_KEY] ?? null,
      name: request.params.name,
      args: request.params.arguments ?? {},
    });
    // Returned as a normal result carrying `isError`, not a protocol error: a
    // refusal is something the agent must read and explain, not a transport
    // fault to retry.
    return asToolResult(envelope);
  });

  return server;
}
