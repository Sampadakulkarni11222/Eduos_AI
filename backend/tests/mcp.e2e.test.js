import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import express from 'express';

/**
 * The whole path, both channels, for real.
 *
 * Website: a real HTTP request to POST /api/v1/ai/agent carrying a signed JWT,
 * through the actual authenticate → aiRateLimiter → requirePermission
 * middleware, the controller, the shared agent, the MCP client, the MCP server,
 * the tool, the EduOS service and MongoDB — and back.
 *
 * WhatsApp: a real HTTP POST to /api/v1/whatsapp/webhook with a Meta-style
 * X-Hub-Signature-256 over the exact body, through signature verification,
 * phone-number identity resolution, the tenant scope, conversation memory, the
 * same shared agent and the same MCP layer.
 *
 * The one thing replaced is the language model, because a test cannot depend
 * on what a model decides. It is scripted per message: given a message the
 * rules do not route, it returns a fixed tool plan, exactly as a model would
 * return one. Everything that plan then causes is real. Messages the rules
 * route never reach the script at all.
 *
 * Proof that MCP — and not some other path — executed each operation: only
 * the MCP server writes audit entries marked `via: 'MCP'`, and the
 * architecture suite proves no other code can execute a tool. So every
 * operation below is checked three ways: the reply, the database, and the
 * MCP server's own audit record of the call.
 */

const script = vi.hoisted(() => ({ plans: new Map(), routing: [], ocrRows: [] }));

vi.mock('../src/providers/ai.provider.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    isLlmEnabled: () => true,
    generate: vi.fn(async ({ system, message }) => {
      // Routing: the model is asked which MCP tools to call.
      if (system.includes("You route a school ERP user's message")) {
        script.routing.push({ message, system });
        return { generated: true, text: JSON.stringify({ tools: script.plans.get(String(message).trim()) ?? [] }) };
      }
      // Retrieval: the model answers from the notices it was given.
      if (system.includes('You are a helpful school assistant')) {
        const context = system.split('Context:')[1]?.trim() ?? '';
        if (!context || context.startsWith('No relevant')) return { generated: true, text: "I don't have anything on that." };
        return { generated: true, text: `From the school's notices: ${context.split('\n')[0]}` };
      }
      // Composition of several results falls back to the deterministic join.
      return { generated: false, text: '' };
    }),
    generateFromImage: vi.fn(async () => ({ generated: true, text: JSON.stringify({ rows: script.ocrRows }) })),
  };
});

const { default: apiRoutes } = await import('../src/routes/index.js');
const { errorHandler, notFoundHandler } = await import('../src/middleware/errorHandler.js');
const { signAccessToken } = await import('../src/utils/jwt.js');
const { env } = await import('../src/config/env.js');
const { Student, Enrollment } = await import('../src/models/student.model.js');
const { Payment } = await import('../src/models/fee.model.js');
const { AttendanceRecord } = await import('../src/models/attendanceRecord.model.js');
const { Announcement } = await import('../src/models/announcement.model.js');
const { AgentAction } = await import('../src/models/agentAction.model.js');
const { AuditLog } = await import('../src/models/auditLog.model.js');
const { resetMcpClient, getMcpClient, listTools } = await import('../src/modules/ai/mcp/client.js');
const { openSession, closeSession } = await import('../src/modules/ai/mcp/session.js');
const { resetAgentThrottle } = await import('../src/modules/ai/agent/throttle.js');
const { confirmAction } = await import('../src/modules/ai/agent/orchestrator.js');
const { draftFromRegisterPhoto } = await import('../src/modules/attendance/ocr.service.js');
const { seedSchool, inSchool, todayKey, OAK } = await import('./support/mcpSchool.js');

let server;
let base;
let savedSecret;
let school;

beforeAll(async () => {
  const app = express();
  // Exactly as app.js: the raw body is kept so the webhook signature can be
  // checked over the bytes Meta signed.
  app.use(express.json({ limit: '10mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use('/api/v1', apiRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api/v1`;

  // A real signing secret, so the webhook is authenticated rather than let
  // through in simulation mode.
  savedSecret = env.WA_APP_SECRET;
  env.WA_APP_SECRET = 'mcp-e2e-webhook-signing-secret';
});

afterAll(async () => {
  env.WA_APP_SECRET = savedSecret;
  await new Promise((resolve) => server.close(resolve));
  await resetMcpClient();
});

beforeEach(async () => {
  resetAgentThrottle();
  script.plans.clear();
  script.routing.length = 0;
  school = await seedSchool();
});

/* ── Channel drivers ──────────────────────────────────────── */

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
const ask = async (person, message) => {
  const res = await post(person, '/ai/agent', { message, source: 'WEB' });
  return { status: res.status, ...(res.body.data ?? {}), error: res.body.success ? null : res.body };
};

/** The website's confirm button: POST /ai/agent/confirm. */
const confirmWeb = async (person, confirmToken, accept = true) =>
  (await post(person, '/ai/agent/confirm', { confirmToken, accept })).body.data;

let waSeq = 0;
/** A WhatsApp message, as Meta delivers it: signed over the exact bytes. */
async function whatsapp(person, text) {
  const payload = {
    entry: [{ changes: [{ value: { messages: [{ id: `wamid.e2e.${Date.now()}.${++waSeq}`, from: person.phone.replace('+', ''), type: 'text', text: { body: text } }] } }] }],
  };
  const raw = JSON.stringify(payload);
  const signature = `sha256=${crypto.createHmac('sha256', env.WA_APP_SECRET).update(raw).digest('hex')}`;
  const res = await fetch(`${base}/whatsapp/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    body: raw,
  });
  const body = await res.json();
  return { status: res.status, reply: body.data?.replies?.[0]?.reply ?? null };
}

/** The MCP server's own record of a call — the proof that MCP executed it. */
const mcpAudit = (tool, channel, status) => inSchool(OAK, () => AuditLog.findOne({
  action: `agent.${tool}`, 'after.via': 'MCP', channel, ...(status && { 'after.status': status }),
}).sort({ createdAt: -1 }).lean());

const rahulToday = () => inSchool(OAK, () => AttendanceRecord.findOne({ enrollmentId: school.rahul.enrollment._id, date: todayKey() }).lean());

/* ── Website ──────────────────────────────────────────────── */

describe('Website: POST /ai/agent → shared agent → MCP → EduOS', () => {
  it('READ — "Which students have pending fees?" runs get_pending_fees', async () => {
    const res = await ask(school.people.ADMIN, 'Which students have pending fees?');
    expect(res.status).toBe(200);
    expect(res.via).toBe('MCP');
    expect(res.tool).toBe('get_pending_fees');
    expect(res.reply).toMatch(/2 student\(s\) have pending fees across 2 invoice\(s\), totalling ₹13,000/);
    expect(await mcpAudit('get_pending_fees', 'WEB', 'READ')).not.toBeNull();
  });

  it('READ — "Who is absent today?" answers from the register', async () => {
    const res = await ask(school.people.ADMIN, 'Who is absent today?');
    expect(res.tool).toBe('get_absent_students');
    expect(res.reply).toMatch(/1 student\(s\) absent today/);
    expect(await mcpAudit('get_absent_students', 'WEB', 'READ')).not.toBeNull();
  });

  it('CREATE — an announcement is proposed, confirmed, then published', async () => {
    const before = await inSchool(OAK, () => Announcement.countDocuments());
    const res = await ask(school.people.ADMIN, 'post an announcement "Sports day on Friday"');
    expect(res.action.tool).toBe('create_announcement');
    expect(res.action.summary).toMatch(/Sports day on Friday.*whole school/);
    expect(await inSchool(OAK, () => Announcement.countDocuments())).toBe(before);

    const done = await confirmWeb(school.people.ADMIN, res.action.confirmToken);
    expect(done.executed).toBe(true);
    expect(done.via).toBe('MCP');
    expect(await inSchool(OAK, () => Announcement.countDocuments({ title: 'Sports day on Friday' }))).toBe(1);
    expect((await mcpAudit('create_announcement', 'WEB', 'EXECUTED')).after.confirmed).toBe(true);
  });

  it('UPDATE — a planned update_student changes only the allowed field', async () => {
    const message = "Change Rahul Sharma's address to 12 MG Road";
    script.plans.set(message, [{ name: 'update_student', args: { studentName: 'Rahul Sharma', fields: { address: '12 MG Road' } } }]);

    const res = await ask(school.people.ADMIN, message);
    expect(res.action.tool).toBe('update_student');
    const done = await confirmWeb(school.people.ADMIN, res.action.confirmToken);
    expect(done.executed).toBe(true);

    const rahul = await inSchool(OAK, () => Student.findById(school.rahul.student._id).lean());
    expect(rahul.address).toBe('12 MG Road');
    expect(rahul.admissionNo).toBe('OAK-1');
    const audit = await mcpAudit('update_student', 'WEB', 'EXECUTED');
    expect(audit.after.state.address).toBe('12 MG Road');
  });

  it('ACTION — "Mark Rahul Sharma present" resolves the student and updates the register', async () => {
    expect((await rahulToday()).status).toBe('ABSENT');
    const res = await ask(school.people.TEACHER, 'Mark Rahul Sharma present');
    expect(res.action.tool).toBe('mark_attendance');
    expect(res.action.summary).toMatch(/Rahul Sharma → PRESENT in Class 6 - A/);

    const done = await confirmWeb(school.people.TEACHER, res.action.confirmToken);
    expect(done.reply).toMatch(/Attendance recorded: Rahul Sharma → PRESENT/);
    expect((await rahulToday()).status).toBe('PRESENT');
    expect(await inSchool(OAK, () => AttendanceRecord.countDocuments({ enrollmentId: school.rahul.enrollment._id }))).toBe(1);
    expect(await mcpAudit('mark_attendance', 'WEB', 'EXECUTED')).not.toBeNull();
  });

  it('FINANCIAL — finance records a payment, an admin approves it', async () => {
    const res = await ask(school.people.FINANCE, 'Record a payment of ₹5,000 against invoice INV-1001 in cash');
    expect(res.action.tool).toBe('record_payment');
    expect(res.action.summary).toBe('Record a ₹5,000 CASH payment against invoice INV-1001');
    expect(await inSchool(OAK, () => Payment.countDocuments())).toBe(0);

    const done = await confirmWeb(school.people.FINANCE, res.action.confirmToken);
    expect(done.reply).toMatch(/pending admin approval/);
    const payment = await inSchool(OAK, () => Payment.findOne({ invoiceId: school.inv1._id }).lean());
    expect(payment.amountPaise).toBe(500000);
    expect(payment.recordStatus).toBe('PENDING_ADMIN_APPROVAL');

    const approveMessage = `Approve ${payment._id}`;
    script.plans.set(approveMessage, [{ name: 'approve_payment', args: { paymentId: String(payment._id) } }]);
    const approval = await ask(school.people.ADMIN, approveMessage);
    expect(approval.action.tool).toBe('approve_payment');
    await confirmWeb(school.people.ADMIN, approval.action.confirmToken);
    expect((await inSchool(OAK, () => Payment.findById(payment._id).lean())).recordStatus).toBe('PUBLISHED');
    expect(await mcpAudit('approve_payment', 'WEB', 'EXECUTED')).not.toBeNull();
  });

  it('DELETE — a planned archive deactivates the student and withdraws the enrolment', async () => {
    const message = "Deactivate Aman Gupta's student record";
    script.plans.set(message, [{ name: 'archive_student', args: { studentName: 'Aman Gupta' } }]);
    const res = await ask(school.people.ADMIN, message);
    expect(res.action.tool).toBe('archive_student');
    await confirmWeb(school.people.ADMIN, res.action.confirmToken);

    const aman = await inSchool(OAK, () => Student.findById(school.aman.student._id).lean());
    expect(aman.deletedAt).not.toBeNull();
    expect((await inSchool(OAK, () => Enrollment.findById(school.aman.enrollment._id).lean())).status).toBe('WITHDRAWN');
  });

  it('HIGH RISK — an irreversible erasure is described as such, and a "no" changes nothing', async () => {
    const message = 'Erase all personal data of Aman Gupta';
    script.plans.set(message, [{ name: 'anonymise_student', args: { studentName: 'Aman Gupta', reason: 'Erasure request from the family' } }]);
    const res = await ask(school.people.ADMIN, message);
    expect(res.action.risk).toBe('CRITICAL');
    expect(res.action.summary).toMatch(/cannot be undone/);

    const declined = await confirmWeb(school.people.ADMIN, res.action.confirmToken, false);
    expect(declined.executed).toBe(false);
    const aman = await inSchool(OAK, () => Student.findById(school.aman.student._id).lean());
    expect(aman.firstName).toBe('Aman');
    expect((await inSchool(OAK, () => AgentAction.findById(res.action.id).lean())).status).toBe('REJECTED');
  });

  it('UNAUTHORIZED — a teacher asking to record a payment is refused with 403 and nothing is written', async () => {
    const res = await ask(school.people.TEACHER, 'Record a payment of ₹500 against invoice INV-1001');
    expect(res.status).toBe(403);
    expect(await inSchool(OAK, () => Payment.countDocuments())).toBe(0);
    expect(await mcpAudit('record_payment', 'WEB', 'FORBIDDEN')).not.toBeNull();
  });

  it('INVALID INPUT — a nonexistent invoice is named in the reply, and no proposal is made', async () => {
    const res = await ask(school.people.FINANCE, 'Record a payment of ₹500 against invoice NOPE-999');
    expect(res.status).toBe(200);
    expect(res.reply).toBe('No invoice numbered "NOPE-999".');
    expect(res.action ?? null).toBeNull();
    expect(await inSchool(OAK, () => AgentAction.countDocuments())).toBe(0);
  });

  it('MULTI-TOOL — two questions in one message run two MCP tools', async () => {
    const res = await ask(school.people.ADMIN, 'who is absent today and what is the fee collection?');
    expect(res.tools).toEqual(['get_absent_students', 'get_fee_statistics']);
    expect(res.reply).toMatch(/1 student\(s\) absent today/);
    expect(res.reply).toMatch(/collection rate/);
    expect(await mcpAudit('get_absent_students', 'WEB', 'READ')).not.toBeNull();
    expect(await mcpAudit('get_fee_statistics', 'WEB', 'READ')).not.toBeNull();
  });

  it('RAG — "what did the announcement about the bus route say" is answered from the notice, with no ERP tool', async () => {
    const res = await ask(school.people.ADMIN, 'What did the announcement about the bus route say?');
    expect(res.knowledge).toBe(true);
    expect(res.sources).toEqual(['RAG']);
    expect(res.tool ?? null).toBeNull();
    expect(res.reply).toMatch(/Bus route 4 changes from Monday/);
    expect(await inSchool(OAK, () => AuditLog.countDocuments({ 'after.via': 'MCP' }))).toBe(0);
  });

  it('RAG + MCP — the policy comes from the notice, the students from the ERP', async () => {
    const res = await ask(school.people.ADMIN, 'According to the attendance policy, which students are below 75% attendance?');
    expect(res.sources).toEqual(['RAG', 'MCP']);
    expect(res.tool).toBe('get_at_risk_students');
    expect(res.reply).toMatch(/Attendance policy/);
    expect(res.reply).toMatch(/Rahul Sharma \(Class 6 A\) — 0%/);
    expect(await mcpAudit('get_at_risk_students', 'WEB', 'READ')).not.toBeNull();
  });
});

/* ── WhatsApp ─────────────────────────────────────────────── */

describe('WhatsApp: signed webhook → phone identity → shared agent → MCP → EduOS', () => {
  it('READ — "Who is absent today?" is answered for the school the number belongs to', async () => {
    const res = await whatsapp(school.people.ADMIN, 'Who is absent today?');
    expect(res.status).toBe(200);
    expect(res.reply).toMatch(/1 student\(s\) absent today/);
    const audit = await mcpAudit('get_absent_students', 'WHATSAPP', 'READ');
    expect(String(audit.actorProfileId)).toBe(school.people.ADMIN.actor.profileId);
    expect(audit.after.tenantId).toBe(OAK);
  });

  it('READ — "Which students have pending fees?" gives the same figures as the website', async () => {
    const res = await whatsapp(school.people.ADMIN, 'Which students have pending fees?');
    expect(res.reply).toMatch(/totalling ₹13,000/);
    expect(await mcpAudit('get_pending_fees', 'WHATSAPP', 'READ')).not.toBeNull();
  });

  it('ACTION — "Mark Rahul Sharma present", then YES', async () => {
    const proposal = await whatsapp(school.people.TEACHER, 'Mark Rahul Sharma present');
    expect(proposal.reply).toMatch(/Rahul Sharma → PRESENT/);
    expect(proposal.reply).toMatch(/Reply YES to confirm/);
    expect((await rahulToday()).status).toBe('ABSENT');

    const yes = await whatsapp(school.people.TEACHER, 'YES');
    expect(yes.reply).toMatch(/Attendance recorded/);
    expect((await rahulToday()).status).toBe('PRESENT');
    expect((await mcpAudit('mark_attendance', 'WHATSAPP', 'EXECUTED')).after.confirmed).toBe(true);
  });

  it('FINANCIAL — "Record this payment", then yes', async () => {
    const proposal = await whatsapp(school.people.FINANCE, 'Record a payment of ₹5,000 against invoice INV-1001 in cash');
    expect(proposal.reply).toMatch(/Record a ₹5,000 CASH payment against invoice INV-1001/);
    const yes = await whatsapp(school.people.FINANCE, 'yes');
    expect(yes.reply).toMatch(/pending admin approval/);
    expect(await inSchool(OAK, () => Payment.countDocuments({ invoiceId: school.inv1._id }))).toBe(1);
    expect(await mcpAudit('record_payment', 'WHATSAPP', 'EXECUTED')).not.toBeNull();
  });

  it('CREATE — "Send this announcement" asks first, then publishes', async () => {
    const proposal = await whatsapp(school.people.ADMIN, 'send an announcement "Holiday tomorrow"');
    expect(proposal.reply).toMatch(/Holiday tomorrow/);
    expect(await inSchool(OAK, () => Announcement.countDocuments({ title: 'Holiday tomorrow' }))).toBe(0);
    await whatsapp(school.people.ADMIN, 'YES');
    expect(await inSchool(OAK, () => Announcement.countDocuments({ title: 'Holiday tomorrow' }))).toBe(1);
  });

  it('UPDATE and DELETE — a "no" leaves the record alone; a "yes" performs it', async () => {
    const message = "Deactivate Aman Gupta's student record";
    script.plans.set(message, [{ name: 'archive_student', args: { studentName: 'Aman Gupta' } }]);

    await whatsapp(school.people.ADMIN, message);
    await whatsapp(school.people.ADMIN, 'no');
    expect((await inSchool(OAK, () => Student.findById(school.aman.student._id).lean())).deletedAt).toBeNull();

    await whatsapp(school.people.ADMIN, message);
    await whatsapp(school.people.ADMIN, 'yes');
    expect((await inSchool(OAK, () => Student.findById(school.aman.student._id).lean())).deletedAt).not.toBeNull();
    expect(await mcpAudit('archive_student', 'WHATSAPP', 'EXECUTED')).not.toBeNull();
  });

  it('UNAUTHORIZED — a teacher is refused a payment on WhatsApp exactly as on the website', async () => {
    const res = await whatsapp(school.people.TEACHER, 'Record a payment of ₹500 against invoice INV-1001');
    expect(res.reply).toMatch(/not authorized/i);
    expect(await inSchool(OAK, () => Payment.countDocuments())).toBe(0);
  });

  it('IDENTITY — an unknown number gets nothing from the ERP', async () => {
    const res = await whatsapp({ phone: '+919000000000' }, 'Who is absent today?');
    expect(res.reply).toMatch(/isn't registered/i);
    expect(await inSchool(OAK, () => AuditLog.countDocuments({ 'after.via': 'MCP' }))).toBe(0);
  });

  it('TENANCY — a number in another school finds only that school\'s Rahul', async () => {
    const res = await whatsapp(school.people.RIVER_ADMIN, 'find student Rahul');
    expect(res.reply).toMatch(/Rahul Riverside/);
    expect(res.reply).not.toMatch(/Sharma/);
  });

  it('MEMORY — "mark him absent" is resolved from the conversation, and authorized as the sender', async () => {
    const first = await whatsapp(school.people.ADMIN, "Show Rahul Sharma's attendance");
    // Rendered by agent/present.js and converted for WhatsApp: "*Attendance:* 0%".
    expect(first.reply).toMatch(/Attendance:\*? 0%/);

    script.plans.set('mark him absent', [{ name: 'mark_attendance', args: { students: [{ studentName: 'Rahul Sharma', status: 'ABSENT' }] } }]);
    const proposal = await whatsapp(school.people.ADMIN, 'mark him absent');
    expect(proposal.reply).toMatch(/Rahul Sharma → ABSENT/);

    // The model was given the earlier turn to resolve "him" — as transcript.
    const routed = script.routing.find((r) => r.message === 'mark him absent');
    expect(routed.system).toMatch(/Earlier turns of this conversation/);
    expect(routed.system).toMatch(/Rahul Sharma/);

    await whatsapp(school.people.ADMIN, 'YES');
    const audit = await mcpAudit('mark_attendance', 'WHATSAPP', 'EXECUTED');
    expect(String(audit.actorProfileId)).toBe(school.people.ADMIN.actor.profileId);
  });
});

/* ── One layer, two channels ──────────────────────────────── */

describe('the website and WhatsApp share one MCP client, server, registry and service layer', () => {
  it('gives the same answer, from the same tool, to the same person on both channels', async () => {
    const web = await ask(school.people.ADMIN, 'Which students have pending fees?');
    const wa = await whatsapp(school.people.ADMIN, 'Which students have pending fees?');
    expect(wa.reply).toBe(web.reply);
    const channels = await inSchool(OAK, () => AuditLog.distinct('channel', { action: 'agent.get_pending_fees', 'after.via': 'MCP' }));
    expect(channels.sort()).toEqual(['WEB', 'WHATSAPP']);
  });

  it('uses one MCP client instance for both channels', async () => {
    const before = await getMcpClient();
    await ask(school.people.ADMIN, 'Who is absent today?');
    await whatsapp(school.people.ADMIN, 'Who is absent today?');
    expect(await getMcpClient()).toBe(before);
  });

  it('discovers the same tool definitions for the same person on either channel', async () => {
    const actor = school.people.TEACHER.actor;
    const names = async (channel) => inSchool(OAK, async () => {
      const id = openSession({ actor, channel });
      try { return (await listTools(id)).map((t) => t.name).sort(); } finally { closeSession(id); }
    });
    expect(await names('WHATSAPP')).toEqual(await names('WEB'));
  });
});

/* ── The register photo: a third producer of actions ──────── */

describe('register-photo drafts are MCP actions too', () => {
  it('proposes through MCP and, once confirmed, writes the register through MCP', async () => {
    script.ocrRows = [
      { rollNo: 1, name: 'Rahul Sharma', mark: 'P', legible: true },
      { rollNo: 2, name: 'Priya Verma', mark: 'A', legible: true },
      { rollNo: 3, name: 'Aman Gupta', mark: '?', legible: false },
    ];
    const teacher = school.people.TEACHER.actor;
    const day = todayKey().toISOString().slice(0, 10);

    const draft = await inSchool(OAK, () => draftFromRegisterPhoto(teacher, 'OWN', {
      sectionId: String(school.sectionA._id), date: day, imageBase64: Buffer.from('photo').toString('base64'), mediaType: 'image/png',
    }));
    expect(draft.committable).toHaveLength(2);
    expect(draft.review).toHaveLength(1);
    expect(await mcpAudit('mark_attendance', 'WEB', 'CONFIRMATION_REQUIRED')).not.toBeNull();

    const done = await inSchool(OAK, () => confirmAction({ confirmToken: draft.action.confirmToken, actor: teacher, source: 'WEB' }));
    expect(done.executed).toBe(true);
    expect(done.via).toBe('MCP');

    expect((await rahulToday()).status).toBe('PRESENT');
    const priya = await inSchool(OAK, () => AttendanceRecord.findOne({ enrollmentId: school.priya.enrollment._id, date: todayKey() }).lean());
    expect(priya.status).toBe('ABSENT');
    expect(priya.note).toBe('Read from register photo');
    // The illegible row was held back for review, never written.
    expect(await inSchool(OAK, () => AttendanceRecord.countDocuments({ enrollmentId: school.aman.enrollment._id }))).toBe(0);
  });
});
