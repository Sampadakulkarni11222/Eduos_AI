import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { Role } from '../src/models/role.model.js';
import { Student } from '../src/models/student.model.js';
import { AgentAction } from '../src/models/agentAction.model.js';
import { WhatsappConversation, WhatsappMessage } from '../src/models/whatsappConversation.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import { env, productionConfigProblems, isChatflowLive } from '../src/config/env.js';
import { logger } from '../src/utils/logger.js';
import * as service from '../src/modules/whatsapp/whatsapp.service.js';
import * as orchestrator from '../src/modules/ai/agent/orchestrator.js';
import * as mcpClient from '../src/modules/ai/mcp/client.js';
import { resolveActorByPhone, runInActorScope } from '../src/modules/whatsapp/whatsapp.agent.js';
import { parseChatflowEvent, verifyChatflowRequest } from '../src/modules/whatsapp/chatflow.inbound.js';
import { sendText, splitMessage } from '../src/modules/whatsapp/chatflow.client.js';
import { receiveChatflowWebhook } from '../src/modules/whatsapp/whatsapp.controller.js';
import { maskPhone } from '../src/modules/whatsapp/whatsapp.session.js';
import { t } from '../src/utils/language.js';

/**
 * WhatsApp through Chatflow-Pro.
 *
 * Chatflow is only a transport: its webhook is normalised into the same
 * message shape Meta's is, and from there the turn runs through the one
 * pipeline — dedupe, phone → ERP actor, shared agent, MCP — before the reply
 * goes back out through Chatflow's Public API. These tests hold that line,
 * using the real MCP server and an in-memory database; only Chatflow's HTTP
 * API is replaced (by a fetch stub), since it is a third-party service.
 */

const OAK = 'oakridge';
const FAKE_KEY = 'cfp_' + 'a'.repeat(64);
const API = 'https://chatflow.test/api/v1/public';
const CHATFLOW_KEYS = [
  'CHATFLOW_API_URL', 'CHATFLOW_API_KEY', 'CHATFLOW_WA_NUMBER_ID',
  'CHATFLOW_WEBHOOK_TOKEN', 'CHATFLOW_WEBHOOK_SECRET', 'CHATFLOW_MAX_RETRIES',
];
let saved;
let fetchSpy;

/** A Chatflow-Pro `message.received` envelope, as outgoingWebhook.service.js builds it. */
function event({ id, from, body, type = 'TEXT', deliveryId = crypto.randomUUID(), conversationId = 'conv_1' }) {
  return {
    id: deliveryId,
    event: 'message.received',
    workspaceId: 'ws_1',
    sentAt: new Date().toISOString(),
    data: {
      conversationId,
      contact: { id: 'ct_1', name: 'Someone', phoneNumber: from },
      message: { id, type, body, from, timestamp: new Date().toISOString() },
    },
  };
}

/** Chatflow's POST /messages, answering with Meta's send response. */
function stubChatflow(responder = () => ({ status: 200, body: { messages: [{ id: `wamid.out.${crypto.randomUUID()}` }] } })) {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const { status, body, headers = {} } = await responder(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      json: async () => body,
    };
  });
  return fetchSpy;
}
const sentBodies = () => fetchSpy.mock.calls.map(([, init]) => JSON.parse(init.body));

async function seedRoles() {
  for (const r of SYSTEM_ROLES) {
    await Role.create({ key: r.key, name: r.name, isSystem: true, permissions: r.grants });
  }
}

async function seedUser({ roleKey, phone }) {
  const role = await Role.findOne({ key: roleKey });
  const account = await Account.create({ phoneE164: phone, status: 'ACTIVE' });
  const profile = await Profile.create({
    accountId: account._id, roleId: role._id, displayName: `${roleKey} User`,
    status: 'ACTIVE', tenantId: OAK, tenantName: 'Oakridge Academy',
  });
  return { account, profile };
}

beforeEach(async () => {
  saved = Object.fromEntries(CHATFLOW_KEYS.map((k) => [k, env[k]]));
  env.CHATFLOW_API_URL = API;
  env.CHATFLOW_API_KEY = FAKE_KEY;
  env.CHATFLOW_WA_NUMBER_ID = '';
  env.CHATFLOW_WEBHOOK_TOKEN = 't'.repeat(32);
  env.CHATFLOW_WEBHOOK_SECRET = '';
  env.CHATFLOW_MAX_RETRIES = 2;
  await seedRoles();
});

afterEach(() => {
  for (const k of CHATFLOW_KEYS) env[k] = saved[k];
  vi.restoreAllMocks();
});

/* ── 1. Parsing ───────────────────────────────────────────── */

describe('Chatflow event parsing', () => {
  it('normalises message.received into the channel-neutral shape', () => {
    const [m] = parseChatflowEvent(event({ id: 'wamid.p1', from: '919999800001', body: 'show my attendance', deliveryId: 'd1' }));
    expect(m).toMatchObject({
      messageId: 'wamid.p1',
      phoneNumber: '+919999800001',
      text: 'show my attendance',
      type: 'text',
      projectId: 'ws_1',
      conversationId: 'conv_1',
      metadata: { deliveryId: 'd1', event: 'message.received' },
    });
    expect(m.timestamp).toBeTruthy();
  });

  it('does not hand Chatflow\'s media placeholder to the agent as if the user typed it', () => {
    const [m] = parseChatflowEvent(event({ id: 'wamid.p2', from: '919999800001', body: '[Image]', type: 'IMAGE' }));
    expect(m.text).toBeNull();
    expect(m.type).toBe('image');
  });

  it('treats button and list replies as text', () => {
    expect(parseChatflowEvent(event({ id: 'b', from: '919999800001', body: 'YES', type: 'BUTTON' }))[0].text).toBe('YES');
    expect(parseChatflowEvent(event({ id: 'i', from: '919999800001', body: 'Fees', type: 'INTERACTIVE' }))[0].text).toBe('Fees');
  });

  it('ignores every event that is not an inbound message, and malformed ones', () => {
    expect(parseChatflowEvent({ event: 'message.status', data: {} })).toEqual([]);
    expect(parseChatflowEvent({ event: 'campaign.completed', data: {} })).toEqual([]);
    expect(parseChatflowEvent(null)).toEqual([]);
    expect(parseChatflowEvent({ event: 'message.received', data: { message: { body: 'no id' } } })).toEqual([]);
  });
});

/* ── 12. Webhook authentication + configuration validation ── */

describe('webhook authentication', () => {
  const body = JSON.stringify(event({ id: 'wamid.a1', from: '919999800002', body: 'hi' }));
  const raw = Buffer.from(body);

  it('requires the URL token', () => {
    expect(verifyChatflowRequest({ rawBody: raw, query: {} })).toEqual({ ok: false, reason: 'TOKEN_MISMATCH' });
    expect(verifyChatflowRequest({ rawBody: raw, query: { token: 'wrong' } }).ok).toBe(false);
    expect(verifyChatflowRequest({ rawBody: raw, query: { token: env.CHATFLOW_WEBHOOK_TOKEN } })).toEqual({ ok: true, reason: 'VERIFIED' });
  });

  it('also enforces X-ChatFlow-Signature-256 once a secret is configured', () => {
    env.CHATFLOW_WEBHOOK_SECRET = 'workspace-verify-token';
    const sig = 'sha256=' + crypto.createHmac('sha256', 'workspace-verify-token').update(raw).digest('hex');
    const query = { token: env.CHATFLOW_WEBHOOK_TOKEN };
    expect(verifyChatflowRequest({ rawBody: raw, headers: {}, query }).reason).toBe('MISSING_SIGNATURE');
    expect(verifyChatflowRequest({ rawBody: raw, headers: { 'x-chatflow-signature-256': 'sha256=00' }, query }).reason).toBe('SIGNATURE_MISMATCH');
    expect(verifyChatflowRequest({ rawBody: raw, headers: { 'x-chatflow-signature-256': sig }, query }).ok).toBe(true);
    // A tampered body fails even with the right token.
    expect(verifyChatflowRequest({ rawBody: Buffer.from(body + ' '), headers: { 'x-chatflow-signature-256': sig }, query }).ok).toBe(false);
  });

  it('refuses everything outside development when no secret is configured at all', () => {
    env.CHATFLOW_WEBHOOK_TOKEN = '';
    env.CHATFLOW_WEBHOOK_SECRET = '';
    expect(verifyChatflowRequest({ rawBody: raw, query: {} })).toEqual({ ok: false, reason: 'SECRET_NOT_CONFIGURED' });
  });

  it('answers 401 at the controller for a bad token and never processes the event', async () => {
    const spy = vi.spyOn(service, 'receiveChatflowEvent');
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await receiveChatflowWebhook({ rawBody: raw, body: JSON.parse(body), headers: {}, query: { token: 'nope' }, ip: '1.2.3.4' }, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('acknowledges a valid delivery with 200 before the agent turn finishes', async () => {
    let release;
    const spy = vi.spyOn(service, 'receiveChatflowEvent').mockReturnValue(new Promise((r) => { release = r; }));
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await receiveChatflowWebhook({ rawBody: raw, body: JSON.parse(body), headers: {}, query: { token: env.CHATFLOW_WEBHOOK_TOKEN }, ip: '1.2.3.4' }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(200);
    expect(spy).toHaveBeenCalledTimes(1);
    release({ received: true });
  });

  it('blocks a production boot that could not authenticate the webhook', () => {
    const base = { ...env, JWT_SECRET: 'x'.repeat(40), MEDICAL_ENCRYPTION_KEY: 'k', WHATSAPP_VERIFY_TOKEN: 'v', CORS_ORIGIN: 'https://app', PAYMENT_PROVIDER: 'none', SMS_PROVIDER: 'console', EMAIL_PROVIDER: 'console' };
    const live = { ...base, CHATFLOW_API_URL: API, CHATFLOW_API_KEY: FAKE_KEY };
    expect(productionConfigProblems({ ...live, CHATFLOW_WEBHOOK_TOKEN: '' }).fatal.join()).toMatch(/CHATFLOW_WEBHOOK_TOKEN/);
    expect(productionConfigProblems({ ...live, CHATFLOW_WEBHOOK_TOKEN: 'short' }).fatal.join()).toMatch(/CHATFLOW_WEBHOOK_TOKEN/);
    expect(productionConfigProblems({ ...live, CHATFLOW_WEBHOOK_TOKEN: 'x'.repeat(32), CHATFLOW_API_URL: 'http://chatflow.test/api/v1/public' }).fatal.join()).toMatch(/CHATFLOW_API_URL/);
    expect(productionConfigProblems({ ...live, CHATFLOW_WEBHOOK_TOKEN: 'x'.repeat(32) }).fatal.join()).not.toMatch(/CHATFLOW/);
    expect(productionConfigProblems({ ...base, CHATFLOW_API_URL: '', CHATFLOW_API_KEY: FAKE_KEY }).warnings.join()).toMatch(/half-configured/);
    // Not using Chatflow at all is not a problem.
    expect(productionConfigProblems({ ...base, CHATFLOW_API_URL: '', CHATFLOW_API_KEY: '' }).fatal.join()).not.toMatch(/CHATFLOW/);
  });
});

/* ── 6/7. Sending ─────────────────────────────────────────── */

describe('sending through the Chatflow-Pro Public API', () => {
  it('posts the documented request: x-api-key, POST /messages, { to, type: text, body }', async () => {
    stubChatflow();
    env.CHATFLOW_WA_NUMBER_ID = 'num_1';
    const out = await sendText({ to: '+919999800003', text: 'Your attendance is 87.5%.', correlationId: 'wamid.c1' });

    expect(out.sent).toBe(true);
    expect(out.messageIds).toHaveLength(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${API}/messages`);
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe(FAKE_KEY);
    expect(JSON.parse(init.body)).toEqual({ to: '+919999800003', type: 'text', body: 'Your attendance is 87.5%.', waNumberId: 'num_1' });
  });

  it('splits a long answer into WhatsApp-sized messages on word boundaries', async () => {
    const long = Array.from({ length: 1200 }, (_, i) => `word${i}`).join(' ');
    const parts = splitMessage(long, 4096);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
    expect(parts.join(' ')).toBe(long);

    stubChatflow();
    const out = await sendText({ to: '+919999800003', text: long });
    expect(out.parts).toBe(parts.length);
    expect(fetchSpy).toHaveBeenCalledTimes(parts.length);
  });

  it('retries a rate limit or 5xx, then succeeds', async () => {
    let n = 0;
    stubChatflow(() => (++n === 1 ? { status: 429, body: { error: 'slow down' }, headers: { 'retry-after': '0' } } : { status: 200, body: { messages: [{ id: 'wamid.ok' }] } }));
    const out = await sendText({ to: '+919999800003', text: 'hello' });
    expect(out.sent).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not retry an auth or scope failure, and reports it without the key', async () => {
    const logs = [];
    vi.spyOn(logger, 'error').mockImplementation((...a) => logs.push(JSON.stringify(a)));
    stubChatflow(() => ({ status: 403, body: { error: 'This API key does not have the "messages:send" scope.' } }));
    const out = await sendText({ to: '+919999800003', text: 'hello' });
    expect(out).toMatchObject({ sent: false, code: 'CHATFLOW_SCOPE', status: 403 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(logs.join()).not.toContain(FAKE_KEY);
    expect(logs.join()).not.toContain('919999800003');
  });

  it('gives up after bounded retries when Chatflow-Pro is down, without throwing', async () => {
    stubChatflow(() => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); });
    const out = await sendText({ to: '+919999800003', text: 'hello' });
    expect(out).toMatchObject({ sent: false, code: 'CHATFLOW_UNREACHABLE' });
    expect(fetchSpy).toHaveBeenCalledTimes(1 + env.CHATFLOW_MAX_RETRIES);
  });

  it('logs instead of sending when Chatflow-Pro is not configured', async () => {
    env.CHATFLOW_API_URL = '';
    stubChatflow();
    expect(isChatflowLive()).toBe(false);
    const out = await sendText({ to: '+919999800003', text: 'hello' });
    expect(out.simulated).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('masks phone numbers for logs', () => {
    expect(maskPhone('+919876543210')).toBe('+91******3210');
    expect(maskPhone('12')).toBe('***');
  });
});

/* ── 2/3/4/5/9/11. The pipeline end to end ────────────────── */

describe('a Chatflow message runs the shared Ask AI + MCP pipeline', () => {
  it('maps the sender to their ERP account, answers via MCP and replies through Chatflow', async () => {
    const { profile } = await seedUser({ roleKey: 'STUDENT', phone: '+919999800010' });
    stubChatflow();
    const agentSpy = vi.spyOn(orchestrator, 'runAgentSafely');

    const result = await service.receiveChatflowEvent(event({ id: 'wamid.e1', from: '919999800010', body: 'show my attendance' }));

    expect(result.handled).toBe(1);
    // Same Ask AI entry point as the web assistant, as this ERP actor.
    expect(agentSpy).toHaveBeenCalledTimes(1);
    const call = agentSpy.mock.calls[0][0];
    expect(call.source).toBe('WHATSAPP');
    expect(call.actor.profileId).toBe(String(profile._id));
    expect(call.actor.roleKey).toBe('STUDENT');

    // The answer came from an MCP attendance tool, and went out through Chatflow.
    const inbound = await WhatsappMessage.findOne({ providerMessageId: 'wamid.e1' }).lean();
    expect(inbound.processingStatus).toBe('PROCESSED');
    expect(inbound.metadata.channel).toBe('CHATFLOW');
    expect(inbound.metadata.tool).toMatch(/attendance/);
    expect(sentBodies()).toHaveLength(1);
    expect(sentBodies()[0]).toMatchObject({ to: '+919999800010', type: 'text', body: result.replies[0].reply });

    const conv = await WhatsappConversation.findOne({ phone: '919999800010' }).lean();
    expect(String(conv.erpProfileId)).toBe(String(profile._id));
    expect(conv.provider).toBe('CHATFLOW');
    expect(conv.providerConversationId).toBe('conv_1');
    const outbound = await WhatsappMessage.findOne({ direction: 'OUTBOUND' }).lean();
    expect(outbound.processingStatus).toBe('SENT');
    expect(outbound.metadata.providerMessageIds).toHaveLength(1);
  });

  it('refuses an unknown number without touching ERP data or the agent', async () => {
    stubChatflow();
    const agentSpy = vi.spyOn(orchestrator, 'runAgentSafely');

    const result = await service.receiveChatflowEvent(event({ id: 'wamid.u1', from: '919999800099', body: 'show all fees' }));

    expect(agentSpy).not.toHaveBeenCalled();
    expect(result.replies[0].reply).toBe(t('agent.notRegistered', 'en'));
    expect(sentBodies()[0].body).toBe(t('agent.notRegistered', 'en'));
    const conv = await WhatsappConversation.findOne({ phone: '919999800099' }).lean();
    expect(conv.status).toBe('UNLINKED');
    expect(conv.erpProfileId).toBeNull();
  });

  it('carries the conversation into a follow-up ("what about last month?")', async () => {
    await seedUser({ roleKey: 'STUDENT', phone: '+919999800011' });
    stubChatflow();
    const agentSpy = vi.spyOn(orchestrator, 'runAgentSafely');

    await service.receiveChatflowEvent(event({ id: 'wamid.ctx1', from: '919999800011', body: 'show my attendance' }));
    await service.receiveChatflowEvent(event({ id: 'wamid.ctx2', from: '919999800011', body: 'what about last month?' }));

    expect(agentSpy).toHaveBeenCalledTimes(2);
    const history = agentSpy.mock.calls[1][0].history;
    expect(history.some((h) => h.role === 'user' && h.text === 'show my attendance')).toBe(true);
    expect(history.some((h) => h.role === 'assistant')).toBe(true);
    // Same thread, same session: one conversation per number.
    expect(await WhatsappConversation.countDocuments({ phone: '919999800011' })).toBe(1);
  });

  it('shares one conversation memory across Meta and Chatflow for the same number', async () => {
    await seedUser({ roleKey: 'STUDENT', phone: '+919999800012' });
    stubChatflow();
    await service.receiveWebhook({ entry: [{ changes: [{ value: { messages: [{ id: 'wamid.m1', from: '919999800012', type: 'text', text: { body: 'show my attendance' } }] } }] }] });
    const agentSpy = vi.spyOn(orchestrator, 'runAgentSafely');
    await service.receiveChatflowEvent(event({ id: 'wamid.m2', from: '919999800012', body: 'what about last month?' }));
    expect(agentSpy.mock.calls[0][0].history.some((h) => h.text === 'show my attendance')).toBe(true);
  });

  it('answers a non-text message with a request for text', async () => {
    await seedUser({ roleKey: 'STUDENT', phone: '+919999800013' });
    stubChatflow();
    const result = await service.receiveChatflowEvent(event({ id: 'wamid.img', from: '919999800013', body: '[Image]', type: 'IMAGE' }));
    expect(result.replies[0].reply).toMatch(/text/i);
    expect(sentBodies()).toHaveLength(1);
  });

  it('acknowledges events that carry no message', async () => {
    stubChatflow();
    const result = await service.receiveChatflowEvent({ event: 'message.status', data: { status: 'read' } });
    expect(result).toMatchObject({ received: true, handled: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/* ── 7/8. Failures ────────────────────────────────────────── */

describe('failure handling on the Chatflow path', () => {
  it('records a failed Chatflow send and still resolves, so nothing is redelivered', async () => {
    await seedUser({ roleKey: 'STUDENT', phone: '+919999800020' });
    stubChatflow(() => ({ status: 503, body: { error: 'down' } }));

    const result = await service.receiveChatflowEvent(event({ id: 'wamid.f1', from: '919999800020', body: 'show my attendance' }));

    expect(result.received).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1 + env.CHATFLOW_MAX_RETRIES);
    const outbound = await WhatsappMessage.findOne({ direction: 'OUTBOUND' }).lean();
    expect(outbound.processingStatus).toBe('SEND_FAILED');
    expect(outbound.metadata.sendError).toBe('CHATFLOW_HTTP');
  });

  it('never reports success when MCP itself fails, and leaks nothing internal', async () => {
    await seedUser({ roleKey: 'STUDENT', phone: '+919999800021' });
    stubChatflow();
    vi.spyOn(mcpClient, 'callTool').mockRejectedValue(new Error('MCP transport down at mongodb://secret-host'));

    const result = await service.receiveChatflowEvent(event({ id: 'wamid.f2', from: '919999800021', body: 'show my attendance' }));

    const reply = result.replies[0].reply;
    expect(reply).toMatch(/unavailable/i);
    expect(reply).not.toMatch(/MCP transport|mongodb|secret-host|%/);
    expect(sentBodies()[0].body).toBe(reply);
  });
});

/* ── 5/10/13. Authorization, duplicates, write idempotency ── */

describe('writes over Chatflow', () => {
  async function proposeCreateStudent(phone, admissionNo) {
    const resolved = await resolveActorByPhone(phone);
    const { openSession, closeSession } = await import('../src/modules/ai/mcp/session.js');
    const { executeToolCall } = await import('../src/modules/ai/mcp/server.js');
    return runInActorScope(resolved, async () => {
      const sid = openSession({ actor: resolved.actor, channel: 'WHATSAPP' });
      try {
        return await executeToolCall({ sessionId: sid, name: 'create_student', args: { admissionNo, firstName: 'Chatflow' } });
      } finally {
        closeSession(sid);
      }
    });
  }

  it('executes a confirmed write exactly once when Chatflow delivers the YES twice', async () => {
    const { profile } = await seedUser({ roleKey: 'ADMIN', phone: '+919999800030' });
    const proposal = await proposeCreateStudent('919999800030', 'OAK-CF-1');
    expect(proposal.action.status).toBe('confirmation_required');
    stubChatflow();

    // Chatflow retries with the same delivery id; a redelivery may even get a
    // new one. Either way the WhatsApp message id is the same.
    const first = await service.receiveChatflowEvent(event({ id: 'wamid.yes', from: '919999800030', body: 'YES', deliveryId: 'd-1' }));
    const retry = await service.receiveChatflowEvent(event({ id: 'wamid.yes', from: '919999800030', body: 'YES', deliveryId: 'd-1' }));
    const redelivery = await service.receiveChatflowEvent(event({ id: 'wamid.yes', from: '919999800030', body: 'YES', deliveryId: 'd-2' }));

    expect(first.handled).toBe(1);
    expect(retry.replies[0].skipped).toBe('DUPLICATE');
    expect(redelivery.replies[0].skipped).toBe('DUPLICATE');
    expect(await runWithTenant(OAK, () => Student.countDocuments({ admissionNo: 'OAK-CF-1' }))).toBe(1);
    expect(await AgentAction.countDocuments({ actorProfileId: profile._id, status: 'PENDING' })).toBe(0);
    // One confirmation reply, not three.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await WhatsappMessage.countDocuments({ providerMessageId: 'wamid.yes' })).toBe(1);
  });

  it('a second, distinct YES finds nothing left to confirm', async () => {
    await seedUser({ roleKey: 'ADMIN', phone: '+919999800031' });
    await proposeCreateStudent('919999800031', 'OAK-CF-2');
    stubChatflow();
    await service.receiveChatflowEvent(event({ id: 'wamid.y1', from: '919999800031', body: 'yes' }));
    const again = await service.receiveChatflowEvent(event({ id: 'wamid.y2', from: '919999800031', body: 'yes' }));
    expect(again.replies[0].reply).toBe(t('agent.nothingPending', 'en'));
    expect(await runWithTenant(OAK, () => Student.countDocuments({ admissionNo: 'OAK-CF-2' }))).toBe(1);
  });

  it('gives a WhatsApp user no more than their role: a student cannot create a student', async () => {
    await seedUser({ roleKey: 'STUDENT', phone: '+919999800032' });
    const proposal = await proposeCreateStudent('919999800032', 'OAK-CF-3');
    expect(proposal.success).toBe(false);
    expect(proposal.action?.status).not.toBe('confirmation_required');

    stubChatflow();
    const yes = await service.receiveChatflowEvent(event({ id: 'wamid.s1', from: '919999800032', body: 'yes' }));
    expect(yes.replies[0].reply).toBe(t('agent.nothingPending', 'en'));
    expect(await runWithTenant(OAK, () => Student.countDocuments({ admissionNo: 'OAK-CF-3' }))).toBe(0);
  });
});
