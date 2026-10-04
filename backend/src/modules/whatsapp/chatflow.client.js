import { env, isChatflowLive } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { maskPhone } from './whatsapp.session.js';
import { chunkForWhatsApp } from '../ai/agent/present.js';

/**
 * Chatflow-Pro Public API client — the only file that talks to Chatflow.
 *
 * Contract (Chatflow-Pro backend, routes/public.routes.js):
 *   auth      `x-api-key: cfp_…` (workspace-bound; the key decides the workspace)
 *   GET  /me        → { workspace: {id,name}, apiKey: {name,scopes}, waNumbers: [...] }
 *   POST /messages  { to, type: 'text', body, waNumberId? }   scope messages:send
 *                   → Meta's send response { messages: [{ id }] , ... }
 *                   errors → { error, message? } with an HTTP status
 *   POST /webhooks  { webhookUrl }                           scope webhooks:write
 *
 * The API key is never logged, never put in a URL, and never echoed into an
 * error message: errors carry the HTTP status and Chatflow's `error` text only.
 */

export class ChatflowError extends Error {
  constructor(message, { status = null, code = 'CHATFLOW_ERROR', retryable = false } = {}) {
    super(message);
    this.name = 'ChatflowError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Statuses worth repeating a send for. A timeout is deliberately NOT here:
 * POST /messages has no idempotency key, and a request that timed out may well
 * have been delivered — a duplicate reply is worse than a recorded failure.
 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function backoffMs(attempt, retryAfterHeader) {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 10_000);
  return Math.min(500 * 2 ** attempt, 5_000);
}

/** One HTTP call with a hard timeout. Throws ChatflowError; never leaks the key. */
async function request(method, path, body) {
  if (!isChatflowLive()) {
    throw new ChatflowError('Chatflow-Pro is not configured', { code: 'CHATFLOW_NOT_CONFIGURED' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.CHATFLOW_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${env.CHATFLOW_API_URL}${path}`, {
      method,
      headers: {
        'x-api-key': env.CHATFLOW_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new ChatflowError(`Chatflow-Pro did not answer within ${env.CHATFLOW_TIMEOUT_MS}ms`, {
        code: 'CHATFLOW_TIMEOUT',
        retryable: false,
      });
    }
    // Connection refused / DNS / TLS: the request never reached Chatflow, so a
    // retry cannot double-send.
    throw new ChatflowError(`Chatflow-Pro unreachable: ${err?.cause?.code ?? err?.message ?? 'network error'}`, {
      code: 'CHATFLOW_UNREACHABLE',
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const reason = typeof data?.error === 'string' ? data.error : typeof data?.message === 'string' ? data.message : '';
    const err = new ChatflowError(`Chatflow-Pro ${method} ${path} failed: ${res.status}${reason ? ` ${reason}` : ''}`, {
      status: res.status,
      code: res.status === 401 ? 'CHATFLOW_AUTH' : res.status === 403 ? 'CHATFLOW_SCOPE' : res.status === 429 ? 'CHATFLOW_RATE_LIMITED' : 'CHATFLOW_HTTP',
      retryable: RETRYABLE_STATUS.has(res.status),
    });
    err.retryAfter = res.headers?.get?.('retry-after') ?? null;
    throw err;
  }
  return data;
}

/**
 * Splits a reply into WhatsApp-sized pieces, preferring paragraph, then line,
 * then word boundaries, so a long answer is not cut mid-word.
 */
export function splitMessage(text, max = env.CHATFLOW_MAX_MESSAGE_CHARS) {
  const parts = [];
  let rest = String(text ?? '').trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf('\n\n');
    if (cut < max * 0.5) cut = window.lastIndexOf('\n');
    if (cut < max * 0.5) cut = window.lastIndexOf(' ');
    if (cut < max * 0.5) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** One message with bounded retries on transient failures. */
async function sendOne(payload, attempts) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const data = await request('POST', '/messages', payload);
      return { data, attempts: attempt + 1 };
    } catch (err) {
      if (!(err instanceof ChatflowError) || !err.retryable || attempt >= attempts) {
        err.attempts = attempt + 1;
        throw err;
      }
      await sleep(backoffMs(attempt, err.retryAfter));
    }
  }
}

/**
 * Sends a text reply. Never throws — a Chatflow outage must not fail the
 * webhook, because a non-2xx makes Chatflow redeliver the same event.
 *
 * Without credentials it logs instead of sending (simulation), exactly as the
 * Meta path does, so the flow is exercisable locally.
 *
 * @returns {{ sent: boolean, simulated?: boolean, messageIds?: string[], parts?: number, error?: string, code?: string, status?: number }}
 */
export async function sendText({ to, text, correlationId = null }) {
  const masked = maskPhone(to);
  // The same numbered parts the Meta channel sends (agent/present.js): split
  // between lines, each titled "Part i/n", nothing dropped.
  const parts = chunkForWhatsApp(text, { max: Math.min(env.CHATFLOW_MAX_MESSAGE_CHARS, 4096) - 200 });
  if (!parts.length) return { sent: false, error: 'EMPTY_MESSAGE', code: 'EMPTY_MESSAGE' };

  if (!isChatflowLive()) {
    logger.info(`[Chatflow SIMULATION] → ${masked}: ${parts[0].slice(0, 200)}`, { correlationId, parts: parts.length });
    return { sent: false, simulated: true, parts: parts.length };
  }

  const messageIds = [];
  for (const [i, body] of parts.entries()) {
    const payload = { to: String(to), type: 'text', body };
    if (env.CHATFLOW_WA_NUMBER_ID) payload.waNumberId = env.CHATFLOW_WA_NUMBER_ID;
    try {
      const { data, attempts } = await sendOne(payload, env.CHATFLOW_MAX_RETRIES);
      const id = data?.messages?.[0]?.id ?? null;
      if (id) messageIds.push(id);
      logger.info('Chatflow send ok', { to: masked, correlationId, part: i + 1, of: parts.length, attempts, providerMessageId: id });
    } catch (err) {
      logger.error('Chatflow send failed', {
        to: masked,
        correlationId,
        part: i + 1,
        of: parts.length,
        status: err.status ?? null,
        code: err.code ?? 'CHATFLOW_ERROR',
        attempts: err.attempts ?? 1,
        error: err.message,
      });
      return { sent: false, messageIds, parts: parts.length, error: err.message, code: err.code, status: err.status ?? null };
    }
  }
  return { sent: true, messageIds, parts: parts.length };
}

/** GET /me — which workspace this key belongs to and the numbers it can send from. */
export function getIdentity() {
  return request('GET', '/me');
}

/** POST /webhooks — needs a key holding the `webhooks:write` scope. */
export function registerWebhook(webhookUrl) {
  return request('POST', '/webhooks', { webhookUrl });
}
