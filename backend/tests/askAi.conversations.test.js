import fs from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

/**
 * The multi-turn conversation harness for Ask AI.
 *
 * The product owner's report: "it is losing context memory, it doesn't remember
 * the previous chat; it is hallucinating sometimes." Every scenario in
 * support/askAiConversations.scenarios.js is a real conversation of one role,
 * replayed through the website's own HTTP route exactly as ask-eduos.tsx sends
 * it (the recent turns, and the conversation id the server handed back), or
 * through the signed WhatsApp webhook. Per turn it asserts the capability
 * chosen, the arguments carried over from earlier turns, the caller's scope,
 * and that the reply is GROUNDED: every person named and every figure stated
 * comes from what that turn's tools returned or from what the person typed.
 *
 * No model is configured here (the demo's AI_PROVIDER=rules). The same
 * guarantees with a scripted model are in askAi.conversations.model.test.js.
 *
 * Set HARNESS_REPORT=<file> to write the per-turn pass/fail table (used for
 * the before/after pass rates).
 */

vi.hoisted(() => { process.env.RATE_LIMIT_AI_MAX = '100000'; });

const { AuditLog } = await import('../src/models/auditLog.model.js');
const { Assignment } = await import('../src/models/assignment.model.js');
const { StaffLeave } = await import('../src/models/staffLeave.model.js');
const { resetMcpClient } = await import('../src/modules/ai/mcp/client.js');
const { resetAgentThrottle } = await import('../src/modules/ai/agent/throttle.js');
const { startApi } = await import('./support/mcpHttp.js');
const { inSchool, OAK } = await import('./support/mcpSchool.js');
const { INTERNAL_LEAKS } = await import('./support/askAiSchool.js');
const { seedConversationSchool, FIXTURE_PEOPLE } = await import('./support/askAiConversationSchool.js');
const { SCENARIOS, CHECKS, UNSURE } = await import('./support/askAiConversations.scenarios.js');
const { P7_SETUPS } = await import('./support/askAiP7Scenarios.js');

let api;
let school;
const report = [];

beforeAll(async () => { api = await startApi(); });
afterAll(async () => {
  await api.close();
  await resetMcpClient();
  if (process.env.HARNESS_REPORT) {
    const turns = report.length;
    const passed = report.filter((r) => r.ok).length;
    const scenarios = [...new Set(report.map((r) => r.id))];
    const scenariosPassed = scenarios.filter((id) => report.filter((r) => r.id === id).every((r) => r.ok)).length;
    fs.writeFileSync(process.env.HARNESS_REPORT, JSON.stringify({
      turns, passed, scenarios: scenarios.length, scenariosPassed,
      unsure: report.filter((r) => UNSURE.test(r.reply)).map((r) => ({ id: r.id, say: r.say })),
      rows: report,
    }, null, 1));
  }
});
beforeEach(async () => {
  resetAgentThrottle();
  school = await seedConversationSchool();
});

/* ── The two channels, driven the way people reach them ───────────────── */

/** The website: what ask-eduos.tsx keeps and sends. */
function websiteChat(person) {
  const msgs = [];
  let conversationId;
  return {
    /** A page change or reload: the browser lost its transcript but kept the conversation id. */
    reload() { msgs.length = 0; },
    /** "New chat": both gone. */
    newChat() { msgs.length = 0; conversationId = undefined; },
    async say(text) {
      const history = msgs.slice(-10).map((m) => ({ role: m.role, text: m.text }));
      msgs.push({ role: 'user', text });
      const res = await api.post(person, '/ai/agent', { message: text, source: 'WEB', history, ...(conversationId && { conversationId }) });
      const data = res.body?.data ?? {};
      if (data.conversationId) conversationId = data.conversationId;
      const reply = String(data.reply ?? res.body?.message ?? '');
      msgs.push({ role: 'assistant', text: reply, action: data.action ?? null });
      return { status: res.status, reply, data, action: data.action ?? null };
    },
    async press(accept) {
      const last = [...msgs].reverse().find((m) => m.action);
      if (!last) return { status: 0, reply: '(no draft on screen to press)', data: {} };
      const res = await api.post(person, '/ai/agent/confirm', { confirmToken: last.action.confirmToken, accept, ...(conversationId && { conversationId }) });
      last.action = null;
      const data = res.body?.data ?? {};
      const reply = String(data.reply ?? res.body?.message ?? '');
      msgs.push({ role: 'assistant', text: reply });
      return { status: res.status, reply, data, action: null };
    },
  };
}

/** WhatsApp: the signed webhook, as Meta delivers it. */
function whatsappChat(person) {
  return {
    async say(text) {
      const res = await api.whatsapp(person, text);
      return { status: res.status, reply: String(res.reply ?? ''), data: {}, action: null };
    },
    async press() { throw new Error('WhatsApp has no buttons'); },
    reload() {},
    newChat() {},
  };
}

/* ── Grounding ────────────────────────────────────────────────────────── */

function numbersIn(value, out = new Set()) {
  if (typeof value === 'number' && Number.isFinite(value)) out.add(value);
  else if (Array.isArray(value)) { out.add(value.length); value.forEach((v) => numbersIn(v, out)); }
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => numbersIn(v, out));
  return out;
}

/**
 * The figures and fixture people a reply states that nothing it was based on
 * contains. Sources: the data this turn's tools returned, the draft summary,
 * the "Based on" evidence, what the person typed in this conversation, and --
 * for names only -- what earlier grounded replies already showed.
 */
function ungrounded(reply, { data, sources, earlierReplies, toolAuthored = false }) {
  const text = String(reply ?? '');
  const sourceText = [JSON.stringify(data ?? null), ...sources].join(' \n ');
  const problems = [];
  for (const name of FIXTURE_PEOPLE) {
    if (!text.includes(name)) continue;
    const first = name.split(' ')[0];
    const seen = sourceText.includes(name) || earlierReplies.some((r) => r.includes(name))
      || (sourceText.includes(first) && sourceText.toLowerCase().includes(name.split(' ')[1].toLowerCase()));
    if (!seen && !toolAuthored) problems.push(`names ${name}, which no record of this turn contains`);
  }
  // Figures are checked only where the turn read data (a sentence written by
  // a tool from the database, or the model's composition over it).
  if (data !== undefined && data !== null) {
    const nums = numbersIn(data);
    const digits = sourceText.replace(/,/g, '');
    // A day of the month written beside its month ("due 21 Oct") is the
    // local reading of a stored instant, which may fall on the day before in
    // UTC: any stored date within a day of it grounds it.
    const days = new Set();
    for (const d of sourceText.matchAll(/\d{4}-\d{2}-(\d{2})/g)) [-1, 0, 1].forEach((k) => days.add(Number(d[1]) + k));
    const flat = text.replace(/(\d),(\d)/g, '$1$2');
    for (const m of flat.matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)(?![\w-])/g)) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n <= 12) continue;
      if (digits.includes(m[1])) continue;
      if (days.has(n) && /^\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(flat.slice(m.index + m[1].length))) continue;
      if (nums.has(n) || nums.has(n * 100) || [...nums].some((x) => Math.round(x) === n || Math.round(x * 10) / 10 === n)) continue;
      problems.push(`states ${m[1]}, which no record of this turn contains`);
    }
  }
  return problems;
}

/* ── One turn's expectations ──────────────────────────────────────────── */

const asList = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const matches = (re, s) => (re instanceof RegExp ? re : new RegExp(re.source)).test(String(s));

/** "Class 6 A", "6A", "class 6-a": one class. */
const classKeyOf = (v) => String(v ?? '').toLowerCase().replace(/\bclass\b/g, '').replace(/[\s-]+/g, '');

function argMatches(expected, actual, key) {
  if (key === 'className' && typeof expected === 'string') return classKeyOf(expected) === classKeyOf(actual);
  if (expected && typeof expected === 'object' && 'source' in expected && !(expected instanceof RegExp)) {
    return new RegExp(`^${expected.source}$`, 'i').test(String(actual ?? ''));
  }
  if (expected instanceof RegExp) return expected.test(String(actual ?? ''));
  if (typeof expected === 'string' && typeof actual === 'string') return actual.toLowerCase().includes(expected.toLowerCase());
  return JSON.stringify(expected) === JSON.stringify(actual);
}

function judge(turn, out, calls, scenario, ctx) {
  const problems = [];
  const last = calls.at(-1) ?? null;
  if (turn.tool !== undefined) {
    const want = asList(turn.tool);
    const ok = last && want.some((w) => (w instanceof RegExp ? w.test(last.tool) : w === last.tool));
    if (!ok) problems.push(`expected tool ${want.join('|')}, got ${last ? last.tool : 'none'}`);
  }
  if (turn.args && last) {
    for (const [key, value] of Object.entries(turn.args)) {
      const actual = last.args?.[key];
      if (!argMatches(value, actual, key)) problems.push(`expected ${key}=${value?.source ?? JSON.stringify(value)}, got ${JSON.stringify(actual)}`);
    }
  }
  if (turn.noCall === true && calls.length) problems.push(`expected no tool call, got ${calls.map((c) => c.tool).join(', ')}`);
  for (const re of asList(turn.reply)) if (!matches(re, out.reply)) problems.push(`reply does not match ${re.source ?? re}`);
  for (const re of asList(turn.notReply)) if (matches(re, out.reply)) problems.push(`reply matches forbidden ${re.source ?? re}`);
  if (turn.action === true && !out.action && scenario.channel !== 'WHATSAPP') problems.push('expected a draft awaiting confirmation');
  if (turn.action === false && out.action) problems.push('expected no draft');
  const executed = calls.some((c) => c.status === 'EXECUTED');
  if (turn.executed === true && !executed) problems.push('expected the confirmed write to be carried out');
  if (turn.executed === false && executed) problems.push('a write was carried out');
  for (const name of scenario.forbid ?? []) if (out.reply.includes(name)) problems.push(`mentions ${name}, outside this person's scope`);
  for (const leak of INTERNAL_LEAKS) if (leak.test(out.reply)) problems.push(`leaks internals (${leak.source})`);
  if (out.status >= 500) problems.push(`HTTP ${out.status}`);
  // p7: the answer-validation layer traced every figure, name and claimed action (agent/verify.js).
  if (out.data?.verification?.ok === false) problems.push(`answer validation could not trace ${out.data.verification.unsupported.join(', ')}`);
  problems.push(...ungrounded(out.reply, {
    data: out.data?.data,
    // What the turn's tools were ASKED for (the day "tomorrow" became, a class) is grounded too:
    // "No homework found due 19 Oct" states the question's own date.
    sources: [out.action?.summary ?? '', ...(out.data?.evidence ?? []).map((e) => e.text ?? ''), ...ctx.said, ...calls.map((c) => JSON.stringify(c.args ?? {}))],
    earlierReplies: ctx.replies,
    // No model here: a sentence a tool wrote from the database this turn (a
    // draft's preface, a WhatsApp reply) is grounded by construction even when
    // its rows are not returned to the client. The model suite is strict.
    toolAuthored: calls.some((c) => ['READ', 'CONFIRMATION_REQUIRED', 'EXECUTED'].includes(c.status)),
  }));
  return problems;
}

/** The MCP calls the turn made, from the audit trail (never from the reply). */
async function callsSince(before) {
  const entries = await inSchool(OAK, () => AuditLog.find({}).sort({ _id: 1 }).skip(before).lean());
  return entries
    .filter((e) => e.after?.via === 'MCP')
    .map((e) => ({ tool: e.action.replace(/^agent\./, ''), args: e.after?.request ?? {}, status: e.after?.status }));
}

async function play(scenario) {
  // p7: a scenario that needs people the shared fixture does not have (a parent of two children called Diya).
  if (scenario.setup) await P7_SETUPS[scenario.setup]({ school, inSchool, OAK });
  const person = school.people[scenario.role];
  const chat = scenario.channel === 'WHATSAPP' ? whatsappChat(person) : websiteChat(person);
  const ctx = { said: [], replies: [] };
  const failures = [];
  for (const [i, turn] of scenario.turns.entries()) {
    resetAgentThrottle();
    const before = await inSchool(OAK, () => AuditLog.countDocuments({}));
    if (turn.say) ctx.said.push(turn.say);
    if (turn.reload) chat.reload();
    if (turn.newChat) { chat.newChat(); ctx.replies.length = 0; }
    const out = turn.press ? await chat.press(turn.press === 'confirm') : await chat.say(turn.say);
    const calls = await callsSince(before);
    const problems = judge(turn, out, calls, scenario, ctx);
    if (typeof turn.check === 'string') {
      try { await CHECKS[turn.check]({ inSchool, OAK, models: { Assignment, StaffLeave }, school }); } catch (err) { problems.push(`check ${turn.check}: ${err.message}`); }
    }
    ctx.replies.push(out.reply);
    const row = {
      id: scenario.id, role: scenario.role, channel: scenario.channel ?? 'WEB', turn: i + 1,
      say: turn.say ?? `[${turn.press}]`, ok: problems.length === 0, problems,
      calls: calls.map((c) => `${c.tool}${JSON.stringify(c.args)}:${c.status}`), reply: out.reply.slice(0, 400),
    };
    report.push(row);
    if (problems.length) failures.push(`turn ${i + 1} "${row.say}": ${problems.join('; ')}\n      reply: ${row.reply.replace(/\n/g, ' / ').slice(0, 240)}\n      calls: ${row.calls.join(' | ') || '(none)'}`);
  }
  return failures;
}

describe('the server-side memory belongs to one person in one school', () => {
  const ask = async (person, message, conversationId) => {
    resetAgentThrottle();
    const res = await api.post(person, '/ai/agent', { message, history: [], ...(conversationId && { conversationId }) });
    return res.body?.data ?? {};
  };

  it('another person presenting the same conversation id gets none of it', async () => {
    const first = await ask(school.people.TEACHER, 'show attendance for Class 6 A');
    expect(first.conversationId).toMatch(/^c-[a-f0-9]{24}$/);
    // The teacher's own follow-up resolves from the server's memory...
    const own = await ask(school.people.TEACHER, 'who was absent?', first.conversationId);
    expect(own.reply).toMatch(/Rahul Sharma/);
    // ...the same id from the principal (same school) and from another school's
    // administrator finds nothing: it is a different person's conversation.
    const { AgentConversation } = await import('../src/models/agentConversation.model.js');
    for (const [other, tenant] of [[school.people.PRINCIPAL, OAK], [school.people.RIVER_ADMIN, 'riverside']]) {
      const theirs = await ask(other, 'who was absent?', first.conversationId);
      expect(theirs.reply).not.toMatch(/Rahul Sharma|Class 6 A/);
      const rows = await inSchool(tenant, () => AgentConversation.find({ conversationId: first.conversationId, profileId: other.profile._id }).lean());
      expect(rows).toHaveLength(1);
      expect(rows[0].turns.map((t) => t.text)).not.toContain('show attendance for Class 6 A');
    }
    const mine = await inSchool(OAK, () => AgentConversation.findOne({ conversationId: first.conversationId, profileId: school.people.TEACHER.profile._id }).lean());
    expect(mine.turns).toHaveLength(4);
  });

  it('an id the server could not have issued is ignored', async () => {
    const res = await ask(school.people.TEACHER, 'show attendance for Class 6 A', '{"$ne":null}');
    expect(res.conversationId).toMatch(/^c-[a-f0-9]{24}$/);
  });

  it('a restricted answer is not kept as text in the memory', async () => {
    const { AgentConversation } = await import('../src/models/agentConversation.model.js');
    const first = await ask(school.people.NURSE, "show today's health room visits");
    const row = await inSchool(OAK, () => AgentConversation.findOne({ conversationId: first.conversationId }).lean());
    const assistant = row.turns.filter((t) => t.role === 'assistant').map((t) => t.text).join(' ');
    expect(assistant).toMatch(/not kept in the conversation memory/);
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
  });
});

describe('Ask AI remembers the conversation, stays in scope and says only what the records say', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.role}${scenario.channel ? ` (${scenario.channel})` : ''}: ${scenario.title}`, async () => {
      const failures = await play(scenario);
      expect(failures, failures.join('\n')).toEqual([]);
    }, 180_000);
  }
});
