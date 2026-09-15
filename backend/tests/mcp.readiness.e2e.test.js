import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

/**
 * The production-readiness scenarios, on both channels, through identical code.
 *
 *   Website:  POST /api/v1/ai/agent (signed JWT) → authenticate → rate limit →
 *             requirePermission → controller → shared agent → MCP client →
 *             MCP server → tool → EduOS service → MongoDB → reply
 *   WhatsApp: POST /api/v1/whatsapp/webhook (X-Hub-Signature-256) → signature
 *             check → phone → actor → tenant scope → memory → shared agent →
 *             MCP client → MCP server → tool → EduOS service → MongoDB → reply
 *
 * Each scenario is written once and driven through both channels by the same
 * driver interface (say / yes). For every one, three things are checked: what
 * the assistant said, what the database now holds, and the MCP server's own
 * audit entry for the call — which also names the tool that ran. A final test
 * compares those tool names across the two channels.
 *
 * The language model is the only thing replaced, and only for messages the
 * rules do not route: it returns a fixed plan, as a model would. Everything
 * the plan then causes is real. Meta's Graph API is stubbed for the one
 * scenario that sends a WhatsApp message to a third party.
 */

// Each scenario is a real HTTP round trip — and on WhatsApp a signed webhook,
// conversation memory and several writes. Alone, each takes a second or two;
// inside the full 60-file run on a loaded laptop one brushed past vitest's
// 30 s default. The limit is raised for this file only; it bounds a hang, it
// is not a performance target.
vi.setConfig({ testTimeout: 60_000 });

const script = vi.hoisted(() => ({ plans: new Map() }));

vi.mock('../src/providers/ai.provider.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    isLlmEnabled: () => true,
    generate: vi.fn(async ({ system, message }) => {
      if (system.includes("You route a school ERP user's message")) {
        return { generated: true, text: JSON.stringify({ tools: script.plans.get(String(message).trim()) ?? [] }) };
      }
      if (system.includes('You are a helpful school assistant')) {
        const context = system.split('Context:')[1]?.trim() ?? '';
        if (!context || context.startsWith('No relevant')) return { generated: true, text: "I don't have anything on that." };
        return { generated: true, text: `From the school's notices: ${context.split('\n')[0]}` };
      }
      return { generated: false, text: '' };
    }),
  };
});

const { Student } = await import('../src/models/student.model.js');
const { Payment, Invoice } = await import('../src/models/fee.model.js');
const { AttendanceRecord } = await import('../src/models/attendanceRecord.model.js');
const { Announcement } = await import('../src/models/announcement.model.js');
const { Document } = await import('../src/models/document.model.js');
const { AgentAction } = await import('../src/models/agentAction.model.js');
const { AuditLog } = await import('../src/models/auditLog.model.js');
const { resetMcpClient } = await import('../src/modules/ai/mcp/client.js');
const { resetAgentThrottle } = await import('../src/modules/ai/agent/throttle.js');
const { env } = await import('../src/config/env.js');
const { startApi } = await import('./support/mcpHttp.js');
const { seedSchool, inSchool, todayKey, OAK } = await import('./support/mcpSchool.js');

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
  script.plans.clear();
  school = await seedSchool();
});

/* ── The two channels behind one interface ────────────────── */

const CHANNELS = {
  WEB: {
    say: async (person, text) => {
      const res = await api.ask(person, text);
      return { reply: res.reply ?? res.body?.message ?? null, token: res.action?.confirmToken ?? null, risk: res.action?.risk ?? null };
    },
    yes: async (person, said) => (await api.confirm(person, said.token)).reply ?? null,
  },
  WHATSAPP: {
    say: async (person, text) => ({ reply: (await api.whatsapp(person, text)).reply, token: null, risk: null }),
    yes: async (person) => (await api.whatsapp(person, 'YES')).reply,
  },
};

/** The MCP server's latest audit entry on a channel, and the tool it names. */
async function lastMcpCall(channel) {
  const entry = await inSchool(OAK, () => AuditLog.findOne({ 'after.via': 'MCP', channel }).sort({ createdAt: -1, _id: -1 }).lean());
  return { entry, tool: entry?.action?.replace(/^agent\./, '') ?? null, status: entry?.after?.status ?? null };
}
const executedOn = (channel, tool) => inSchool(OAK, () => AuditLog.findOne({
  'after.via': 'MCP', channel, action: `agent.${tool}`, 'after.status': 'EXECUTED',
}).lean());
const writesOn = (channel) => inSchool(OAK, () => AuditLog.countDocuments({ 'after.via': 'MCP', channel, 'after.status': 'EXECUTED' }));
const proposals = () => inSchool(OAK, () => AgentAction.countDocuments());
const rahul = () => inSchool(OAK, () => Student.findById(school.rahul.student._id).lean());
const rahulToday = () => inSchool(OAK, () => AttendanceRecord.findOne({ enrollmentId: school.rahul.enrollment._id, date: todayKey() }).lean());

/** Which tool each scenario ran on each channel — compared at the end. */
const toolsUsed = { WEB: {}, WHATSAPP: {} };

/* ── The scenarios ────────────────────────────────────────── */

describe.each([['Website', 'WEB'], ['WhatsApp', 'WHATSAPP']])('%s', (_label, channel) => {
  const { say, yes } = CHANNELS[channel];

  it('READ — "Which students have pending fees?"', async () => {
    const said = await say(school.people.ADMIN, 'Which students have pending fees?');
    expect(said.reply).toMatch(/2 student\(s\) have pending fees across 2 invoice\(s\), totalling ₹13,000/);
    expect(await inSchool(OAK, () => Invoice.countDocuments())).toBe(2);
    expect(await inSchool(OAK, () => Payment.countDocuments())).toBe(0);
    const call = await lastMcpCall(channel);
    expect(call).toMatchObject({ tool: 'get_pending_fees', status: 'READ' });
    expect(String(call.entry.actorProfileId)).toBe(school.people.ADMIN.actor.profileId);
    toolsUsed[channel].readFees = call.tool;
  });

  it('READ — "Show Rahul\'s attendance."', async () => {
    const said = await say(school.people.ADMIN, "Show Rahul's attendance.");
    expect(said.reply).toMatch(/0%/);
    expect(await writesOn(channel)).toBe(0);
    const call = await lastMcpCall(channel);
    expect(call).toMatchObject({ tool: 'get_student_attendance', status: 'READ' });
    toolsUsed[channel].readAttendance = call.tool;
  });

  it('CREATE — "Create an announcement saying tomorrow is a holiday."', async () => {
    const count = () => inSchool(OAK, () => Announcement.countDocuments({ title: /tomorrow is a holiday/i }));
    const said = await say(school.people.ADMIN, 'Create an announcement saying tomorrow is a holiday.');
    expect(said.reply).toMatch(/tomorrow is a holiday/i);
    expect(await count()).toBe(0);

    await yes(school.people.ADMIN, said);
    expect(await count()).toBe(1);
    const audit = await executedOn(channel, 'create_announcement');
    expect(audit.after.confirmed).toBe(true);
    toolsUsed[channel].create = 'create_announcement';
  });

  it('UPDATE — "Update Rahul\'s phone number." has no tool to run: nothing changes and nothing is claimed', async () => {
    // No EduOS service can change a phone number (MCP-AUDIT.md §L), so no
    // tool fits and the model proposes none.
    const before = await rahul();
    const said = await say(school.people.ADMIN, "Update Rahul's phone number.");
    expect(said.reply).not.toMatch(/\b(updated|changed|done|saved)\b/i);
    expect(await rahul()).toEqual(before);
    expect(await proposals()).toBe(0);
    expect(await writesOn(channel)).toBe(0);
    toolsUsed[channel].updatePhone = null;
  });

  it('UPDATE — a model that tries to write a phone number anyway is refused by MCP before anything is proposed', async () => {
    const message = "Update Rahul's phone number to 9812345678";
    script.plans.set(message, [{ name: 'update_student', args: { studentName: 'Rahul', fields: { phone: '9812345678' } } }]);
    const before = await rahul();
    const said = await say(school.people.ADMIN, message);
    // Refused in plain words, naming what is and is not accepted — not "done",
    // and not "I need a bit more", which no further detail could satisfy.
    expect(said.reply).toBe('I can\'t do that: "phone" is not something this action accepts. It accepts only: firstName, lastName, dob, gender, address.');
    expect(await rahul()).toEqual(before);
    expect(await proposals()).toBe(0);
    const call = await lastMcpCall(channel);
    expect(call).toMatchObject({ tool: 'update_student', status: 'INVALID_INPUT' });
    toolsUsed[channel].updatePhoneRefused = call.tool;
  });

  it('UPDATE — an allowed field changes after a yes, and the audit keeps before and after', async () => {
    const message = "Change Rahul's address to 12 MG Road";
    script.plans.set(message, [{ name: 'update_student', args: { studentName: 'Rahul', fields: { address: '12 MG Road' } } }]);
    const said = await say(school.people.ADMIN, message);
    expect(said.reply).toMatch(/12 MG Road/);
    expect((await rahul()).address ?? null).toBeNull();

    await yes(school.people.ADMIN, said);
    expect((await rahul()).address).toBe('12 MG Road');
    const audit = await executedOn(channel, 'update_student');
    expect(audit.before.address ?? null).toBeNull();
    expect(audit.after.state.address).toBe('12 MG Road');
    toolsUsed[channel].update = 'update_student';
  });

  it('ACTION — "Mark Rahul absent."', async () => {
    await inSchool(OAK, () => AttendanceRecord.updateOne({ enrollmentId: school.rahul.enrollment._id, date: todayKey() }, { $set: { status: 'PRESENT' } }));
    const said = await say(school.people.TEACHER, 'Mark Rahul absent.');
    expect(said.reply).toMatch(/Rahul Sharma → ABSENT/);
    expect((await rahulToday()).status).toBe('PRESENT');

    const done = await yes(school.people.TEACHER, said);
    expect(done).toMatch(/Attendance recorded/);
    expect((await rahulToday()).status).toBe('ABSENT');
    const audit = await executedOn(channel, 'mark_attendance');
    expect(audit.before.rows).toEqual([{ enrollmentId: String(school.rahul.enrollment._id), status: 'PRESENT' }]);
    expect(audit.after.state.rows).toEqual([{ enrollmentId: String(school.rahul.enrollment._id), status: 'ABSENT' }]);
    toolsUsed[channel].action = 'mark_attendance';
  });

  it('FINANCIAL — "Record Rahul\'s payment." asks how much and against which invoice, and records nothing', async () => {
    const said = await say(school.people.FINANCE, "Record Rahul's payment.");
    // It asks (in the tool's own words) — and does not claim anything was recorded.
    expect(said.reply).toMatch(/^I need a bit more to do that\./);
    expect(said.reply).not.toMatch(/Recorded ₹|It is pending admin approval\./);
    expect(await proposals()).toBe(0);
    expect(await inSchool(OAK, () => Payment.countDocuments())).toBe(0);
    const call = await lastMcpCall(channel);
    expect(call).toMatchObject({ tool: 'record_payment', status: 'INVALID_INPUT' });
    toolsUsed[channel].financialIncomplete = call.tool;
  });

  it('FINANCIAL — a complete payment is proposed, confirmed and recorded pending approval', async () => {
    const said = await say(school.people.FINANCE, 'Record a payment of ₹5,000 against invoice INV-1001 in cash');
    expect(said.reply).toMatch(/Record a ₹5,000 CASH payment against invoice INV-1001/);
    expect(await inSchool(OAK, () => Payment.countDocuments())).toBe(0);

    const done = await yes(school.people.FINANCE, said);
    expect(done).toMatch(/pending admin approval/);
    const payment = await inSchool(OAK, () => Payment.findOne({ invoiceId: school.inv1._id }).lean());
    expect(payment).toMatchObject({ amountPaise: 500000, mode: 'CASH', recordStatus: 'PENDING_ADMIN_APPROVAL' });
    expect((await executedOn(channel, 'record_payment')).after.confirmed).toBe(true);
    toolsUsed[channel].financial = 'record_payment';
  });

  describe('HIGH RISK — external messages', () => {
    const saved = {};
    const toMeta = [];
    beforeEach(() => {
      saved.id = env.WA_PHONE_NUMBER_ID;
      saved.token = env.WA_ACCESS_TOKEN;
      env.WA_PHONE_NUMBER_ID = '000111222';
      env.WA_ACCESS_TOKEN = 'meta-access-token-for-tests';
      toMeta.length = 0;
      const realFetch = globalThis.fetch;
      // Meta's Graph API is stubbed; the suite's own HTTP calls go through.
      vi.stubGlobal('fetch', vi.fn(async (url, init) => {
        if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, init);
        let body = null;
        try { body = JSON.parse(init?.body ?? 'null'); } catch { /* not JSON */ }
        toMeta.push({ url: String(url), body });
        return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.stub' }] }), text: async () => '{}' };
      }));
    });
    afterEach(() => {
      env.WA_PHONE_NUMBER_ID = saved.id;
      env.WA_ACCESS_TOKEN = saved.token;
      vi.unstubAllGlobals();
    });

    const digits = (phone) => String(phone ?? '').replace(/\D/g, '');
    const sentTo = (phone) => toMeta.filter((c) => digits(c.body?.to) === digits(phone));

    it('"Send a WhatsApp message to all parents." — there is no bulk send, so nothing is sent or claimed', async () => {
      const said = await say(school.people.ADMIN, 'Send a WhatsApp message to all parents.');
      expect(said.reply).not.toMatch(/\b(sent|delivered)\b/i);
      expect(sentTo(school.people.PARENT.phone)).toEqual([]);
      expect(await proposals()).toBe(0);
      expect(await writesOn(channel)).toBe(0);
      toolsUsed[channel].bulkMessage = null;
    });

    it('a message to one parent waits for a yes, then goes to exactly that number, once', async () => {
      const message = "Send a WhatsApp message to Rahul's father saying the bus is late today";
      script.plans.set(message, [{
        name: 'send_whatsapp_message', args: { to: school.people.PARENT.phone, text: 'The bus is late today.' },
      }]);
      const said = await say(school.people.ADMIN, message);
      if (channel === 'WEB') expect(said.risk).toBe('HIGH');
      expect(sentTo(school.people.PARENT.phone)).toEqual([]);

      await yes(school.people.ADMIN, said);
      const delivered = sentTo(school.people.PARENT.phone);
      expect(delivered).toHaveLength(1);
      expect(JSON.stringify(delivered[0].body)).toContain('The bus is late today.');
      const audit = await executedOn(channel, 'send_whatsapp_message');
      expect(audit.after.confirmed).toBe(true);
      expect(JSON.stringify(audit)).not.toContain('meta-access-token-for-tests');
      toolsUsed[channel].singleMessage = 'send_whatsapp_message';
    });
  });

  it('DELETE — a document is named, confirmed, deleted, and its details kept in the audit', async () => {
    const doc = await inSchool(OAK, () => Document.create({
      title: 'Old bus circular', type: 'CUSTOM', fileUrl: '/uploads/old-bus.pdf',
      authorProfileId: school.people.ADMIN.profile._id, visibleToRoles: ['PARENT'],
    }));
    const message = 'Delete the old bus circular document';
    script.plans.set(message, [{ name: 'delete_document', args: { documentId: String(doc._id) } }]);

    const said = await say(school.people.ADMIN, message);
    expect(said.reply).toMatch(/Permanently delete .*"Old bus circular"/);
    if (channel === 'WEB') expect(said.risk).toBe('HIGH');
    expect(await inSchool(OAK, () => Document.countDocuments())).toBe(1);

    await yes(school.people.ADMIN, said);
    expect(await inSchool(OAK, () => Document.countDocuments())).toBe(0);
    const audit = await executedOn(channel, 'delete_document');
    expect(audit.before).toMatchObject({ exists: true, title: 'Old bus circular' });
    expect(audit.after.confirmed).toBe(true);
    toolsUsed[channel].delete = 'delete_document';
  });
});

describe('both channels', () => {
  it('ran the same MCP tool for every scenario', () => {
    expect(Object.keys(toolsUsed.WEB).length).toBeGreaterThanOrEqual(12);
    expect(toolsUsed.WHATSAPP).toEqual(toolsUsed.WEB);
  });
});
