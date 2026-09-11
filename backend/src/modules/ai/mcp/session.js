import crypto from 'crypto';
import { currentTenantState } from '../../../tenancy/tenantContext.js';

/**
 * Trusted identity for MCP tool calls.
 *
 * The one rule this file exists to enforce: **who the caller is never travels
 * in the tool arguments.** An MCP `tools/call` carries an opaque handle and
 * nothing else about identity; the server exchanges that handle for the actor
 * and school scope captured server-side — from the Express session the
 * authenticate middleware built (website), or from the phone number Meta
 * verified (WhatsApp).
 *
 * That matters because the arguments are the one part of the call a language
 * model writes. If `tenantId` or `role` were parameters, a model could be
 * talked into supplying different ones, and the tool would have no way to tell
 * the model's opinion from the truth. Here it cannot: the server drops every
 * identity-shaped key it is handed (STRIPPED_ARGS) and reads identity only
 * from this store.
 *
 * Sessions are per-turn and short-lived: opened by the channel immediately
 * before the agent runs, closed in a `finally` afterwards. A leaked handle is
 * useless a moment later.
 */

const sessions = new Map();

/** A turn is long, but not this long. Reaped even when a caller forgets to close. */
const SESSION_TTL_MS = 5 * 60 * 1000;

/**
 * Argument names the server refuses to accept from the caller.
 *
 * Not a denylist standing in for authorization — the authorization is the
 * permission check in server.js, which reads only from the session. This is
 * the second thing: it stops a model's guess at `user_id` from reaching a
 * service that would have believed it, and it makes the attempt visible in the
 * logs rather than silent.
 */
export const STRIPPED_ARGS = new Set([
  'actor', 'actorId', 'actorProfileId', 'profileId', 'accountId', 'userId', 'user_id',
  'role', 'roleKey', 'role_key', 'permissions', 'scope',
  'tenantId', 'tenant_id', 'schoolId', 'school_id', 'institutionId', 'institution_id',
  '__session', 'sessionId', 'session_id', 'confirmationToken',
]);

function reap() {
  const now = Date.now();
  for (const [id, s] of sessions) if (s.expiresAt <= now) sessions.delete(id);
}

/**
 * Registers the caller's verified identity and returns an opaque handle.
 *
 * The school scope is captured from the *ambient* tenant context rather than
 * passed in, because that context is what the authenticate middleware (or
 * whatsapp.agent's runInActorScope) already established. Reading it here means
 * an MCP call runs in exactly the school the rest of the request runs in, with
 * no second source of truth able to disagree with it.
 */
export function openSession({ actor, channel = 'WEB' }) {
  if (!actor?.profileId) throw new Error('An MCP session needs an authenticated actor.');
  reap();
  const id = crypto.randomBytes(24).toString('hex');
  sessions.set(id, {
    actor,
    channel: channel === 'WHATSAPP' ? 'WHATSAPP' : 'WEB',
    tenant: currentTenantState(),
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return id;
}

export function resolveSession(id) {
  if (!id) return null;
  const session = sessions.get(id);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(id);
    return null;
  }
  return session;
}

export function closeSession(id) {
  if (id) sessions.delete(id);
}

/** Opens a session for the duration of `fn`, and always closes it. */
export async function withSession({ actor, channel }, fn) {
  const id = openSession({ actor, channel });
  try {
    return await fn(id);
  } finally {
    closeSession(id);
  }
}

/** Test/diagnostic helper — never used on a request path. */
export function activeSessionCount() {
  reap();
  return sessions.size;
}
