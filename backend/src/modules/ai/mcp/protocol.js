import { AppError } from '../../../utils/AppError.js';

/**
 * The result envelope every MCP tool speaks.
 *
 * Tools return `{ success: true, ... }` or `{ success: false, error }` and
 * nothing else, because the model on the other side has to be able to tell
 * "no students matched" from "you may not ask that" from "the database is
 * down" — and it can only do that if those are different *values* rather than
 * three differently-worded sentences. An empty result is a success carrying an
 * empty list, never an error.
 *
 * Three success shapes:
 *   ok()        a read, or a completed write. `data` is the payload.
 *   action()    a write that happened. Adds `action.status = 'completed'` and
 *               the id of what changed, so the agent can say what was done
 *               without inferring it from the data.
 *   needsConfirmation()  a write that has NOT happened. Carries the token the
 *               user's "yes" will redeem. See mcp/confirm.js.
 */

export const MCP_ERROR = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  FORBIDDEN_SCOPE: 'FORBIDDEN_SCOPE',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_INPUT: 'INVALID_INPUT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  MISSING_PARAMETER: 'MISSING_PARAMETER',
  NEEDS_INPUT: 'NEEDS_INPUT',
  CONFLICT: 'CONFLICT',
  UNKNOWN_TOOL: 'UNKNOWN_TOOL',
  SCHOOL_REQUIRED: 'SCHOOL_REQUIRED',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  CONFIRMATION_INVALID: 'CONFIRMATION_INVALID',
  TIMEOUT: 'TIMEOUT',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  DATABASE_ERROR: 'DATABASE_ERROR',
  ACTION_FAILED: 'ACTION_FAILED',
  INTERNAL: 'INTERNAL',
};

/** HTTP status each code maps back to, so a refusal keeps its meaning. */
const STATUS_FOR = {
  [MCP_ERROR.UNAUTHENTICATED]: 401,
  [MCP_ERROR.UNAUTHORIZED]: 401,
  [MCP_ERROR.FORBIDDEN]: 403,
  [MCP_ERROR.FORBIDDEN_SCOPE]: 403,
  [MCP_ERROR.NOT_FOUND]: 404,
  [MCP_ERROR.INVALID_INPUT]: 400,
  [MCP_ERROR.VALIDATION_ERROR]: 400,
  [MCP_ERROR.MISSING_PARAMETER]: 400,
  [MCP_ERROR.NEEDS_INPUT]: 400,
  [MCP_ERROR.CONFLICT]: 409,
  [MCP_ERROR.UNKNOWN_TOOL]: 400,
  [MCP_ERROR.SCHOOL_REQUIRED]: 400,
  [MCP_ERROR.CONFIRMATION_INVALID]: 410,
  [MCP_ERROR.TIMEOUT]: 504,
  [MCP_ERROR.SERVICE_UNAVAILABLE]: 503,
  [MCP_ERROR.DATABASE_ERROR]: 500,
  [MCP_ERROR.ACTION_FAILED]: 500,
  [MCP_ERROR.INTERNAL]: 500,
};

/**
 * A success envelope.
 *
 * `speakKey`/`params` ride alongside `data` rather than inside it: they are a
 * rendering hint for the agent (see utils/language.js), not part of the ERP
 * record, and a caller that only wants the facts can ignore them.
 */
export function ok(data, { speakKey = null, params = null, speak = null } = {}) {
  return {
    success: true,
    data: data ?? null,
    ...(speakKey && { speakKey }),
    ...(params && { params }),
    ...(speak && { speak }),
  };
}

/** A write that actually happened. */
export function action({ type, id = null, status = 'completed', data = null, speak = null, speakKey = null, params = null }) {
  return {
    success: true,
    action: { type, ...(id && { id: String(id) }), status },
    data: data ?? null,
    ...(speak && { speak }),
    ...(speakKey && { speakKey }),
    ...(params && { params }),
  };
}

/**
 * A write that has NOT happened, and what it would take to make it happen.
 *
 * Deliberately `success: true`: nothing failed. The tool did exactly what it
 * should — it stopped and asked. Reporting this as an error would push the
 * agent onto its failure path and, worse, might make it tell the user the
 * operation could not be done, when in fact it is one "yes" away.
 */
export function needsConfirmation({ actionId, confirmationToken, summary, tool, risk, expiresInMinutes, affectsOthers = false }) {
  return {
    success: true,
    action: {
      id: String(actionId),
      type: tool,
      status: 'confirmation_required',
      confirmationToken,
      summary,
      risk,
      affectsOthers,
      expiresInMinutes,
    },
    data: null,
  };
}

export function fail(code, message, details = null) {
  return { success: false, error: { code, message, ...(details && { details }) } };
}

/**
 * Classifies anything thrown inside a tool.
 *
 * Service errors already carry the right status — `students.getById` throws
 * 404 for a record the caller may not see, `fee.listPayments` throws 403 for
 * someone else's invoice — so the mapping runs off the status rather than off
 * message text, which would be a guess.
 */
export function failFromError(err) {
  const status = err?.statusCode ?? err?.status ?? null;
  if (err?.code === 'AGENT_NEEDS_INPUT') return fail(MCP_ERROR.NEEDS_INPUT, err.message);
  if (status === 401) return fail(MCP_ERROR.UNAUTHENTICATED, err.message);
  if (status === 403) return fail(MCP_ERROR.FORBIDDEN, err.message);
  if (status === 404) return fail(MCP_ERROR.NOT_FOUND, err.message);
  if (status === 409) return fail(MCP_ERROR.CONFLICT, err.message);
  if (status === 410) return fail(MCP_ERROR.CONFIRMATION_INVALID, err.message);
  if (status === 400 || status === 422) return fail(MCP_ERROR.INVALID_INPUT, err.message);
  if (status === 504) return fail(MCP_ERROR.TIMEOUT, err.message);
  // An outside system refused the action (Meta declined a WhatsApp message).
  // The tool's own message says so in words a person can act on — "did not
  // accept the message" — and saying less would leave them guessing whether it
  // went out.
  if (status === 502 && err?.code) return fail(MCP_ERROR.ACTION_FAILED, err.message);
  if (status === 503) return fail(MCP_ERROR.SERVICE_UNAVAILABLE, err.message);
  // Mongoose reports connectivity and cast problems as plain Errors; naming
  // them separately is the difference between "the school has no such student"
  // and "the database is unreachable", which want different answers.
  if (err?.name === 'MongoNetworkError' || err?.name === 'MongooseServerSelectionError') {
    return fail(MCP_ERROR.DATABASE_ERROR, 'The school database is not reachable right now.');
  }
  if (err?.name === 'CastError') return fail(MCP_ERROR.INVALID_INPUT, 'That identifier is not valid.');
  if (err?.name === 'ValidationError') return fail(MCP_ERROR.VALIDATION_ERROR, 'That record was rejected as invalid.');
  if (err?.code === 11000) return fail(MCP_ERROR.CONFLICT, 'A record with those details already exists.');
  // Deliberately does NOT pass err.message through: an unexpected failure's
  // message is written for a developer and can carry internal shape. The full
  // error is logged server-side by the caller.
  return fail(MCP_ERROR.INTERNAL, 'Something went wrong performing that in the school system.');
}

/**
 * Turns a failure envelope back into the AppError the agent already handles.
 *
 * The orchestrator's existing distinction between "a refusal is an answer"
 * (4xx, shown to the user) and "a fault is not" (5xx, degraded) is worth
 * keeping, so an MCP error re-enters that machinery rather than bypassing it.
 */
export function errorToAppError(envelope) {
  const { code, message } = envelope?.error ?? {};
  const appCode =
    code === MCP_ERROR.FORBIDDEN || code === MCP_ERROR.FORBIDDEN_SCOPE
      ? 'AGENT_FORBIDDEN'
      : code === MCP_ERROR.NEEDS_INPUT
        ? 'AGENT_NEEDS_INPUT'
        : `MCP_${code ?? 'INTERNAL'}`;
  const err = new AppError(message ?? 'That could not be completed.', STATUS_FOR[code] ?? 500, [], appCode);
  err.mcpCode = code ?? MCP_ERROR.INTERNAL;
  return err;
}
