import crypto from 'crypto';
import express from 'express';
import apiRoutes from '../../src/routes/index.js';
import { errorHandler, notFoundHandler } from '../../src/middleware/errorHandler.js';
import { signAccessToken } from '../../src/utils/jwt.js';
import { env } from '../../src/config/env.js';

/**
 * The real HTTP surface, for suites that test the assistant the way people
 * reach it.
 *
 * Mounts the actual API router — authenticate, the AI rate limiter,
 * requirePermission, the controllers — behind a real listening socket, exactly
 * as app.js does, but without app.js's bootstrap: no database connection of
 * its own (the test setup's in-memory replica set is the only database), no
 * role sync, no port 5000. Not a test file, so vitest runs it only when a suite
 * imports it.
 *
 * WhatsApp messages are delivered as Meta delivers them: a POST to the webhook
 * signed with X-Hub-Signature-256 over the exact bytes, so the signature check
 * runs rather than being skipped in simulation mode.
 */
export async function startApi() {
  const app = express();
  // As app.js: the raw body is kept so the webhook signature can be checked over the bytes Meta signed.
  app.use(express.json({ limit: '10mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use('/api/v1', apiRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;

  const savedSecret = env.WA_APP_SECRET;
  env.WA_APP_SECRET = 'mcp-test-webhook-signing-secret';

  async function post(person, path, body) {
    const token = signAccessToken({ accountId: person.actor.accountId, profileId: person.actor.profileId, door: null });
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  /** The website assistant: POST /ai/agent, as ask-eduos.tsx sends it. */
  async function ask(person, message) {
    const res = await post(person, '/ai/agent', { message, source: 'WEB' });
    return { status: res.status, body: res.body, ...(res.body.data ?? {}) };
  }

  /** The website's confirm / cancel buttons: POST /ai/agent/confirm. */
  async function confirm(person, confirmToken, accept = true) {
    const res = await post(person, '/ai/agent/confirm', { confirmToken, accept });
    return { status: res.status, body: res.body, ...(res.body.data ?? {}) };
  }

  let seq = 0;
  /** A WhatsApp text message from this person's phone, signed as Meta signs it. */
  async function whatsapp(person, text) {
    const payload = {
      entry: [{ changes: [{ value: { messages: [{
        id: `wamid.test.${Date.now()}.${++seq}`, from: person.phone.replace('+', ''), type: 'text', text: { body: text },
      }] } }] }],
    };
    const raw = JSON.stringify(payload);
    const signature = `sha256=${crypto.createHmac('sha256', env.WA_APP_SECRET).update(raw).digest('hex')}`;
    const res = await fetch(`${base}/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
      body: raw,
    });
    const body = await res.json();
    return { status: res.status, reply: body.data?.replies?.[0]?.reply ?? null, body };
  }

  async function close() {
    env.WA_APP_SECRET = savedSecret;
    await new Promise((resolve) => server.close(resolve));
  }

  return { base, post, ask, confirm, whatsapp, close };
}
