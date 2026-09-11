import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { MCP_TOOLS } from '../src/modules/ai/mcp/registry.js';
import { Payment } from '../src/models/fee.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { AgentAction } from '../src/models/agentAction.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { env } from '../src/config/env.js';
import { startApi } from './support/mcpHttp.js';
import { seedSchool, mcp, inSchool, todayKey, OAK, RIVER } from './support/mcpSchool.js';

/**
 * Time limits, concurrency and failure, through the real website endpoint.
 *
 * The rule under test throughout: the assistant never says something happened
 * that MCP did not report as happening. A failure is reported as a failure, a
 * timeout as an unknown outcome, and neither is dressed up as an answer.
 *
 * Slowness and faults are injected at one point only — the tool's `run` — with
 * a spy that delays or throws and otherwise calls the real implementation.
 * Everything around it (authorization, confirmation, tenancy, audit, the
 * agent, the HTTP layer, the database) is the real code.
 */

let api;
let school;

beforeAll(async () => {
  api = await startApi();
});
afterAll(async () => {
  await api.close();
  await resetMcpClient();
});
beforeEach(async () => {
  resetAgentThrottle();
  school = await seedSchool();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.MCP_TOOL_TIMEOUT_MS;
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const auditWith = (tool, status) => inSchool(OAK, () => AuditLog.findOne({ action: `agent.${tool}`, 'after.status': status }).lean());
const payments = () => inSchool(OAK, () => Payment.countDocuments({ invoiceId: school.inv1._id }));
const actionRow = (id) => inSchool(OAK, () => AgentAction.findById(id).lean());

async function eventually(fn, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value || Date.now() > end) return value;
    await sleep(50);
  }
}

/** Makes a tool slow, then runs the real implementation. */
function slowDown(name, ms) {
  const tool = MCP_TOOLS[name];
  const original = tool.run;
  return vi.spyOn(tool, 'run').mockImplementation(async function slowed(...args) {
    await sleep(ms);
    return original.apply(this, args);
  });
}

/** Makes a tool's service call fail with `err`. */
const failWith = (name, err) => vi.spyOn(MCP_TOOLS[name], 'run').mockRejectedValue(err);

/* ── Time limits ──────────────────────────────────────────── */

describe('MCP_TOOL_TIMEOUT_MS', () => {
  it('a normal read answers well inside the limit', async () => {
    const res = await api.ask(school.people.ADMIN, 'Which students have pending fees?');
    expect(res.status).toBe(200);
    expect(res.reply).toMatch(/totalling ₹13,000/);
    expect((await auditWith('get_pending_fees', 'READ')).after.durationMs).toBeLessThan(20_000);
  });

  it('a slow read that finishes inside the limit is answered normally', async () => {
    process.env.MCP_TOOL_TIMEOUT_MS = '3000';
    slowDown('get_pending_fees', 200);
    const res = await api.ask(school.people.ADMIN, 'Which students have pending fees?');
    expect(res.reply).toMatch(/totalling ₹13,000/);
  });

  it('a read past the limit says so — and nothing it does not know', async () => {
    process.env.MCP_TOOL_TIMEOUT_MS = '100';
    slowDown('get_pending_fees', 600);
    const res = await api.ask(school.people.ADMIN, 'Which students have pending fees?');
    expect(res.status).toBe(200);
    expect(res.reply).toBe('That took too long to answer. Please try again in a moment.');
    expect(res.outcome).toBe('UNKNOWN');
    expect(res.reply).not.toMatch(/₹/);
    expect(await auditWith('get_pending_fees', 'TIMEOUT')).not.toBeNull();
    await sleep(700); // let the abandoned read finish before the fixture is cleared
  });

  it('a payment past the limit is reported as neither done nor failed, completes once, and is audited when it does', async () => {
    const finance = school.people.FINANCE;
    const proposal = await api.ask(finance, 'Record a payment of ₹5,000 against invoice INV-1001 in cash');
    expect(proposal.action.tool).toBe('record_payment');

    process.env.MCP_TOOL_TIMEOUT_MS = '100';
    slowDown('record_payment', 600);
    const res = await api.confirm(finance, proposal.action.confirmToken);
    expect(res.status).toBe(200);
    expect(res.executed).toBe(false);
    expect(res.outcome).toBe('UNKNOWN');
    expect(res.reply).toMatch(/may still complete/);
    expect(res.reply).not.toMatch(/Recorded|approval/);
    expect(await auditWith('record_payment', 'TIMEOUT_OUTCOME_PENDING')).not.toBeNull();

    // Still running: the proposal is held — not failed, and not redeemable again.
    expect((await actionRow(proposal.action.id)).status).toBe('EXECUTING');
    const retry = await api.confirm(finance, proposal.action.confirmToken);
    expect(retry.status).toBe(409);

    const settled = await eventually(() => auditWith('record_payment', 'EXECUTED_AFTER_TIMEOUT'));
    expect(settled).not.toBeNull();
    expect(settled.after.confirmed).toBe(true);
    // The invoice now lists the payment (pending approval) — the after-state was
    // captured when the write really finished, not when the clock ran out.
    expect(settled.after.state.paymentCount).toBe(1);
    expect(settled.before.paymentCount).toBe(0);
    expect((await actionRow(proposal.action.id)).status).toBe('EXECUTED');
    expect(await payments()).toBe(1);
  });
});

/* ── Concurrency ──────────────────────────────────────────── */

describe('concurrent calls', () => {
  it('twelve simultaneous reads by four people each get their own, correct answer', async () => {
    const calls = [];
    for (let i = 0; i < 3; i++) {
      calls.push(mcp(OAK, school.people.ADMIN.actor, 'get_pending_fees', {}));
      calls.push(mcp(OAK, school.people.PARENT.actor, 'get_pending_fees', {}));
      // A teacher reads their own class's register (who_is_absent_today is the
      // school-wide snapshot, refused to an OWN-scoped teacher — correctly).
      calls.push(mcp(OAK, school.people.TEACHER.actor, 'get_attendance_roster', { sectionId: String(school.sectionA._id) }));
      calls.push(mcp(OAK, school.people.FINANCE.actor, 'get_fee_statistics', {}));
    }
    const results = await Promise.all(calls);
    expect(results.filter((r) => !r.success).map((r) => r.error)).toEqual([]);
    for (let i = 0; i < results.length; i += 4) {
      expect(results[i].data.invoiceCount).toBe(2); // the administrator: the school
      expect(results[i + 1].data.invoices.map((x) => x.invoiceNo)).toEqual(['INV-1001']); // the parent: their child only
    }
  });

  it("two people's confirmations at the same moment both land, each exactly once", async () => {
    const teacher = school.people.TEACHER.actor;
    const finance = school.people.FINANCE.actor;
    const [mark, pay] = await Promise.all([
      mcp(OAK, teacher, 'mark_attendance', { students: [{ studentName: 'Rahul Sharma', status: 'PRESENT' }] }),
      mcp(OAK, finance, 'record_payment', { invoiceNo: 'INV-1001', amountPaise: 100000, mode: 'CASH' }),
    ]);
    const [a, b] = await Promise.all([
      mcp(OAK, teacher, 'mark_attendance', {}, { confirmationToken: mark.action.confirmationToken }),
      mcp(OAK, finance, 'record_payment', {}, { confirmationToken: pay.action.confirmationToken }),
    ]);
    expect([a.success, b.success]).toEqual([true, true]);
    const rahul = await inSchool(OAK, () => AttendanceRecord.findOne({ enrollmentId: school.rahul.enrollment._id, date: todayKey() }).lean());
    expect(rahul.status).toBe('PRESENT');
    expect(await payments()).toBe(1);
  });

  it('one request that needs two MCP calls makes both, and audits both', async () => {
    const res = await api.ask(school.people.ADMIN, 'who is absent today and what is the fee collection?');
    expect(res.tools).toEqual(['who_is_absent_today', 'get_fee_statistics']);
    expect(await auditWith('who_is_absent_today', 'READ')).not.toBeNull();
    expect(await auditWith('get_fee_statistics', 'READ')).not.toBeNull();
  });
});

/* ── Failures ─────────────────────────────────────────────── */

describe('a failure is reported as a failure', () => {
  it('database unreachable: the assistant says it cannot answer, and invents nothing', async () => {
    failWith('get_pending_fees', Object.assign(new Error('connection 3 to 10.2.3.4:27017 closed'), { name: 'MongoNetworkError' }));
    const res = await api.ask(school.people.ADMIN, 'Which students have pending fees?');
    expect(res.status).toBe(200);
    expect(res.degraded).toBe(true);
    expect(res.reply).not.toMatch(/₹|pending fees across|10\.2\.3\.4/);
    expect((await auditWith('get_pending_fees', 'FAILED')).after.code).toBe('DATABASE_ERROR');
  });

  it('a service reporting itself unavailable is handled the same way', async () => {
    failWith('get_pending_fees', Object.assign(new Error('upstream unavailable'), { statusCode: 503 }));
    const res = await api.ask(school.people.ADMIN, 'Which students have pending fees?');
    expect(res.degraded).toBe(true);
    expect(res.reply).not.toMatch(/₹|pending fees across/);
    expect((await auditWith('get_pending_fees', 'FAILED')).after.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('an unexpected error does not leak its message to the person or the model', async () => {
    failWith('get_pending_fees', new Error('TypeError at /srv/app/fee.service.js:1920 — secret shape'));
    const res = await api.ask(school.people.ADMIN, 'Which students have pending fees?');
    expect(res.reply).not.toMatch(/fee\.service|secret shape|TypeError/);
    expect((await auditWith('get_pending_fees', 'FAILED')).after.code).toBe('INTERNAL');
  });

  it('missing arguments: asks for them, proposes nothing', async () => {
    const res = await api.ask(school.people.FINANCE, 'Record a payment against invoice INV-1001');
    expect(res.status).toBe(200);
    expect(res.needsInput).toBe(true);
    expect(res.action ?? null).toBeNull();
    expect(await inSchool(OAK, () => AgentAction.countDocuments())).toBe(0);
  });

  it('permission denied: 403, and nothing written', async () => {
    const res = await api.ask(school.people.TEACHER, 'Record a payment of ₹500 against invoice INV-1001');
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(await payments()).toBe(0);
  });

  it("tenant mismatch: another school's invoice does not exist for this caller", async () => {
    const res = await api.ask(school.people.RIVER_ADMIN, 'Record a payment of ₹500 against invoice INV-1001 in cash');
    expect(res.reply).toBe('No invoice numbered "INV-1001".');
    expect(res.action ?? null).toBeNull();
    const byId = await mcp(RIVER, school.people.RIVER_ADMIN.actor, 'get_student', { studentId: String(school.rahul.student._id) });
    expect(byId.error.code).toBe('NOT_FOUND');
  });

  it('record not found: says which record', async () => {
    const res = await api.ask(school.people.FINANCE, 'Record a payment of ₹500 against invoice NOPE-999');
    expect(res.reply).toBe('No invoice numbered "NOPE-999".');
  });

  it('business rule: an overpayment is refused at execution, and the reply says why — not that it was recorded', async () => {
    const admin = school.people.ADMIN;
    const proposal = await api.ask(admin, 'Record a payment of ₹9,000 against invoice INV-1001 in cash');
    expect(proposal.action.tool).toBe('record_payment');
    const res = await api.confirm(admin, proposal.action.confirmToken);
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/exceeds the outstanding balance/);
    expect(JSON.stringify(res.body)).not.toMatch(/Recorded/);
    expect(await payments()).toBe(0);
    expect((await actionRow(proposal.action.id)).status).toBe('FAILED');
    expect((await auditWith('record_payment', 'FAILED')).after.code).toBe('CONFLICT');
  });

  describe('external messaging failure', () => {
    const saved = {};
    beforeEach(() => {
      saved.id = env.WA_PHONE_NUMBER_ID;
      saved.token = env.WA_ACCESS_TOKEN;
      env.WA_PHONE_NUMBER_ID = '000111222';
      env.WA_ACCESS_TOKEN = 'meta-access-token-for-tests';
      // Meta refuses the message, as it does for a number outside the allowed list.
      vi.stubGlobal('fetch', vi.fn(async (url, init) => {
        if (String(url).startsWith('http://127.0.0.1')) return globalThis.__realFetch(url, init);
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: { message: '(#131030) Recipient phone number not in allowed list' } }),
          text: async () => '(#131030) Recipient phone number not in allowed list',
        };
      }));
    });
    afterEach(() => {
      env.WA_PHONE_NUMBER_ID = saved.id;
      env.WA_ACCESS_TOKEN = saved.token;
    });

    it('a message Meta refused is not reported as sent', async () => {
      const admin = school.people.ADMIN;
      const proposal = await mcp(OAK, admin.actor, 'send_whatsapp_message', { to: '+919999900001', text: 'The bus is late' });
      const res = await api.confirm(admin, proposal.action.confirmationToken);
      expect(res.body.success).toBe(false);
      expect(res.executed ?? false).toBe(false);
      expect((await actionRow(proposal.action.id)).status).toBe('FAILED');
      expect(await auditWith('send_whatsapp_message', 'FAILED')).not.toBeNull();
      expect(await auditWith('send_whatsapp_message', 'EXECUTED')).toBeNull();
    });
  });

  it('when one of two calls fails, the answer keeps the one that worked and claims nothing for the other', async () => {
    failWith('get_fee_statistics', new Error('boom'));
    const res = await api.ask(school.people.ADMIN, 'who is absent today and what is the fee collection?');
    expect(res.status).toBe(200);
    expect(res.reply).toMatch(/1 student\(s\) absent today/);
    expect(res.reply).not.toMatch(/collection rate/);
  });
});

// The external-messaging stub has to let the suite's own HTTP calls through.
globalThis.__realFetch ??= globalThis.fetch;
