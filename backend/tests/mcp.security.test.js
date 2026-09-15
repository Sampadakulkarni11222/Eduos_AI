import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { Role } from '../src/models/role.model.js';
import { Student, Enrollment } from '../src/models/student.model.js';
import { Invoice, Payment, FeeHead, FeeStructure } from '../src/models/fee.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { AgentAction } from '../src/models/agentAction.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { MCP_TOOLS, mcpToolsFor, mutates, requiresConfirmation } from '../src/modules/ai/mcp/registry.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resolveActorByPhone, runInActorScope, converse } from '../src/modules/whatsapp/whatsapp.agent.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { env } from '../src/config/env.js';
import {
  seedSchool, seedPerson, actorForRole, mcp, proposeAndConfirm, inSchool, todayKey, OAK, RIVER,
} from './support/mcpSchool.js';

/**
 * The security properties of the MCP layer, against a real school.
 *
 * Every test here asks the same underlying question: can a caller — or a
 * model acting for one — reach data or change records the ERP would not let
 * that same person reach through the screens? Each answer is checked in the
 * database, not only in the reply.
 */

let school;

beforeEach(async () => {
  resetAgentThrottle();
  school = await seedSchool();
});

afterAll(async () => {
  await resetMcpClient();
});

/* ── Visible ⇔ executable, for every role ─────────────────── */

describe('discovery and execution agree for every role', () => {
  const PROBE = { __probe__: 1 };

  /**
   * A probe call carries one argument no tool accepts. The server checks
   * authorization before it validates arguments, so a permitted tool answers
   * INVALID_INPUT (it got past authorization and nothing ran) and a
   * forbidden one answers FORBIDDEN or FORBIDDEN_SCOPE. That lets every tool
   * be tested for every role without executing any of them.
   */
  async function matrix(actor) {
    const visible = new Set(mcpToolsFor(actor).map((t) => t.name));
    const mismatches = [];
    for (const name of Object.keys(MCP_TOOLS)) {
      const res = await mcp(OAK, actor, name, PROBE);
      const passedAuth = res.error?.code === 'INVALID_INPUT';
      const refused = ['FORBIDDEN', 'FORBIDDEN_SCOPE'].includes(res.error?.code);
      if (visible.has(name) && !passedAuth) mismatches.push(`${name}: visible but ${res.error?.code ?? 'ran'}`);
      if (!visible.has(name) && !refused) mismatches.push(`${name}: hidden but ${res.error?.code ?? 'ran'}`);
    }
    return { visible: visible.size, mismatches };
  }

  it.each(SYSTEM_ROLES.map((r) => r.key))('%s: every visible tool is executable and every hidden one is refused', async (roleKey) => {
    const { visible, mismatches } = await matrix(actorForRole(roleKey));
    expect(mismatches).toEqual([]);

    // SUPER_ADMIN is excluded from the assistant: it does not hold
    // ai.copilot.use, so it is described no catalogue AND refused every tool.
    // The matrix above is what proves the second half — hiding a tool is not
    // the same as refusing to run it, and this role still holds the permission
    // each tool names.
    if (roleKey === 'SUPER_ADMIN') expect(visible).toBe(0);
    else expect(visible).toBeGreaterThan(0);
  }, 60_000);

  it('a custom role gets exactly the tools its grants imply, and is refused the rest', async () => {
    const counsellor = actorForRole('ADMIN', {
      roleKey: 'COUNSELLOR',
      permissions: { 'students.read': 'ALL', 'attendance.read': 'ALL', 'ai.copilot.use': 'ALL' },
    });
    const { visible, mismatches } = await matrix(counsellor);
    expect(mismatches).toEqual([]);
    expect(visible).toBe(mcpToolsFor(counsellor).length);
  }, 60_000);

  it('nothing ran during the probes', async () => {
    await matrix(actorForRole('SUPER_ADMIN'));
    const executed = await inSchool(OAK, () => AuditLog.countDocuments({ 'after.status': { $in: ['READ', 'EXECUTED'] } }));
    expect(executed).toBe(0);
  }, 60_000);
});

describe('a DB-backed custom role works end to end, not only in the registry', () => {
  it('resolves over WhatsApp, sees its tools, and is refused what it lacks', async () => {
    const role = await Role.create({
      key: 'COUNSELLOR',
      name: 'Counsellor',
      permissions: [
        { key: 'students.read', scope: 'ALL' },
        { key: 'attendance.read', scope: 'ALL' },
        { key: 'ai.copilot.use', scope: 'ALL' },
      ],
    });
    const person = await seedPerson({ roleKey: 'COUNSELLOR', roleId: role._id });
    const resolved = await resolveActorByPhone(person.phone.replace('+', ''));
    expect(resolved.actor.roleKey).toBe('COUNSELLOR');

    const names = mcpToolsFor(resolved.actor).map((t) => t.name);
    expect(names).toContain('get_absent_students');
    expect(names).not.toContain('get_pending_fees');

    const absent = await runInActorScope(resolved, () => converse({ actor: resolved.actor, text: 'who is absent today?' }));
    expect(absent.reply).toMatch(/1 student\(s\) absent/);

    const fees = await mcp(OAK, resolved.actor, 'get_pending_fees', {});
    expect(fees.error.code).toBe('FORBIDDEN');
  });
});

/* ── OWN versus ALL ───────────────────────────────────────── */

describe('OWN scope is enforced by the services, through MCP', () => {
  it("a parent's pending fees are their own child's, not the school's", async () => {
    const res = await mcp(OAK, school.people.PARENT.actor, 'get_pending_fees', {});
    expect(res.success).toBe(true);
    expect(res.data.invoices.map((i) => i.invoiceNo)).toEqual(['INV-1001']);
    expect(res.data.totalsCover).toBe('OWN');
  });

  it("a teacher reads their own class's student but not another class's", async () => {
    const own = await mcp(OAK, school.people.TEACHER.actor, 'get_student', { admissionNo: 'OAK-1' });
    expect(own.success).toBe(true);
    const other = await mcp(OAK, school.people.TEACHER.actor, 'get_student', { admissionNo: 'OAK-9' });
    expect(other.success).toBe(false);
    expect(other.error.code).toBe('NOT_FOUND');
  });

  it('a teacher cannot mark a student outside their classes, even by name', async () => {
    const res = await mcp(OAK, school.people.TEACHER.actor, 'mark_attendance', {
      students: [{ studentName: 'Riya Kapoor', status: 'PRESENT' }],
    });
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('NOT_FOUND');
    expect(await inSchool(OAK, () => AgentAction.countDocuments())).toBe(0);
  });

  it('a school-wide read is refused to a caller scoped to their own records', async () => {
    const res = await mcp(OAK, school.people.TEACHER.actor, 'get_absent_students', {});
    expect(res.error.code).toBe('FORBIDDEN_SCOPE');
  });
});

/* ── Tenancy ──────────────────────────────────────────────── */

describe('a school cannot reach another school', () => {
  it('never finds the other school\'s student, though both are called Rahul', async () => {
    const oak = await mcp(OAK, school.people.ADMIN.actor, 'search_students', { query: 'Rahul' });
    expect(oak.data.students.map((s) => s.admissionNo)).toEqual(['OAK-1']);
    const river = await mcp(RIVER, school.people.RIVER_ADMIN.actor, 'search_students', { query: 'Rahul' });
    expect(river.data.students.map((s) => s.admissionNo)).toEqual(['RIV-1']);
  });

  it('cannot read, pay or change another school\'s records by id', async () => {
    const admin = school.people.ADMIN.actor;
    const read = await mcp(OAK, admin, 'get_student', { studentId: String(school.river.student._id) });
    expect(read.error.code).toBe('NOT_FOUND');

    const pay = await mcp(OAK, admin, 'record_payment', { invoiceId: String(school.river.invoice._id), amountPaise: 100, mode: 'CASH' });
    expect(pay.error.code).toBe('NOT_FOUND');
    expect(await inSchool(RIVER, () => Payment.countDocuments())).toBe(0);
  });

  it('refuses a write whose arguments try to name a school or a person', async () => {
    const admin = school.people.ADMIN.actor;
    for (const smuggled of [{ tenantId: RIVER }, { schoolId: RIVER }, { profileId: 'x' }, { role: 'SUPER_ADMIN' }, { permissions: {} }, { user_id: 'x' }]) {
      const res = await mcp(OAK, admin, 'update_student', { admissionNo: 'OAK-1', fields: { address: 'x' }, ...smuggled });
      expect(res.success, JSON.stringify(smuggled)).toBe(false);
      expect(res.error.code).toBe('INVALID_INPUT');
      expect(res.error.message).toMatch(/decided by the server/);
    }
    expect(await inSchool(OAK, () => AgentAction.countDocuments())).toBe(0);
  });

  it("will not redeem another school's confirmation token", async () => {
    const riverProposal = await mcp(RIVER, school.people.RIVER_ADMIN.actor, 'update_student', {
      admissionNo: 'RIV-1', fields: { address: 'Riverside Road' },
    });
    const stolen = await mcp(OAK, school.people.ADMIN.actor, 'update_student', {}, {
      confirmationToken: riverProposal.action.confirmationToken,
    });
    expect(stolen.success).toBe(false);
    const student = await inSchool(RIVER, () => Student.findById(school.river.student._id).lean());
    expect(student.address ?? null).toBeNull();
  });
});

/* ── The unbounded student update ─────────────────────────── */

describe('update_student cannot write a dangerous field', () => {
  const DANGEROUS = [
    'tenantId', 'deletedAt', 'admissionNo', 'status', 'role', 'permissions', 'accountId', 'profileId',
    'leadId', 'anonymisedAt', 'photoUrl', '_id', '__v', 'createdAt', 'updatedAt',
  ];

  it.each(DANGEROUS)('refuses %s inside fields, and leaves the record untouched', async (field) => {
    const res = await mcp(OAK, school.people.ADMIN.actor, 'update_student', {
      admissionNo: 'OAK-1', fields: { [field]: 'overwritten' },
    });
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('INVALID_INPUT');
    const rahul = await inSchool(OAK, () => Student.findById(school.rahul.student._id).lean());
    expect(rahul.admissionNo).toBe('OAK-1');
    expect(rahul.tenantId).toBe(OAK);
    expect(rahul.deletedAt).toBeNull();
    expect(rahul.status).toBe('ACTIVE');
  });

  it('accepts an allowed field and writes only that', async () => {
    const { done } = await proposeAndConfirm(OAK, school.people.ADMIN.actor, 'update_student', {
      admissionNo: 'OAK-1', fields: { address: '12 MG Road' },
    });
    expect(done.success).toBe(true);
    const rahul = await inSchool(OAK, () => Student.findById(school.rahul.student._id).lean());
    expect(rahul.address).toBe('12 MG Road');
    expect(rahul.admissionNo).toBe('OAK-1');
  });
});

/* ── Confirmation is enforced by the server ───────────────── */

describe('high-impact actions are proposed by the server, never performed on the first call', () => {
  const CASES = [
    ['DELETE', 'archive_student', () => ({ admissionNo: 'OAK-3' })],
    ['IRREVERSIBLE', 'anonymise_student', () => ({ admissionNo: 'OAK-3', reason: 'Erasure request' })],
    ['FINANCIAL', 'record_payment', () => ({ invoiceNo: 'INV-1001', amountPaise: 50000, mode: 'CASH' })],
    // A real captured payment: refunding needs something to refund.
    ['FINANCIAL', 'refund_payment', async () => {
      const paid = await inSchool(OAK, () => Payment.create({ invoiceId: school.inv1._id, amountPaise: 100000, mode: 'CASH' }));
      return { paymentId: String(paid._id) };
    }],
    ['BULK', 'bulk_mark_attendance', () => ({ sectionId: String(school.sectionA._id), rows: [{ rollNo: 3, status: 'PRESENT' }] })],
    ['BULK', 'generate_invoices', () => ({ academicYearId: String(school.year._id) })],
    ['EXTERNAL', 'send_whatsapp_message', () => ({ to: '+919999900001', text: 'Hello' })],
    ['EXTERNAL', 'notify_users', () => ({ recipientProfileIds: [school.people.PARENT.actor.profileId], title: 't', body: 'b' })],
  ];

  it.each(CASES)('%s — %s waits for a person', async (_category, tool, args) => {
    // Each case runs as a role that holds the permission: Finance records and
    // refunds (an administrator deliberately cannot refund), Admin the rest.
    const actor = ['record_payment', 'refund_payment'].includes(tool) ? school.people.FINANCE.actor : school.people.ADMIN.actor;
    const input = await args();
    const before = await inSchool(OAK, () => Promise.all([
      Student.countDocuments({ deletedAt: null }), Payment.countDocuments(), Invoice.countDocuments(), AttendanceRecord.countDocuments(),
    ]));

    // Straight to the server, bypassing the agent: if confirmation lived in the
    // agent's prompt, this call would run. It does not.
    const res = await mcp(OAK, actor, tool, input);
    expect(res.success, JSON.stringify(res.error)).toBe(true);
    expect(res.action.status).toBe('confirmation_required');

    const after = await inSchool(OAK, () => Promise.all([
      Student.countDocuments({ deletedAt: null }), Payment.countDocuments(), Invoice.countDocuments(), AttendanceRecord.countDocuments(),
    ]));
    expect(after).toEqual(before);
    const pending = await inSchool(OAK, () => AgentAction.findById(res.action.id).lean());
    expect(pending.status).toBe('PENDING');
    expect(pending.tool).toBe(tool);
  });

  it('every destructive, financial, external, bulk or irreversible tool is declared as needing confirmation', () => {
    for (const [name, tool] of Object.entries(MCP_TOOLS)) {
      if (!mutates(tool)) continue;
      const highImpact = tool.risk === 'HIGH' || tool.risk === 'CRITICAL' || tool.operation === 'DELETE' || tool.affectsOthers;
      if (highImpact) expect(tool.confirm || typeof tool.confirmWhen === 'function', `${name} runs without confirmation`).toBeTruthy();
    }
  });

  it('a dry run writes nothing and so needs no confirmation', () => {
    expect(requiresConfirmation(MCP_TOOLS.generate_invoices, { academicYearId: 'x', dryRun: true })).toBe(false);
    expect(requiresConfirmation(MCP_TOOLS.generate_invoices, { academicYearId: 'x' })).toBe(true);
  });

  it('refuses payment actions to roles without the permission', async () => {
    const teacherPays = await mcp(OAK, school.people.TEACHER.actor, 'record_payment', { invoiceNo: 'INV-1001', amountPaise: 100, mode: 'CASH' });
    expect(teacherPays.error.code).toBe('FORBIDDEN');
    // Finance may record but deliberately may not approve.
    const financeApproves = await mcp(OAK, school.people.FINANCE.actor, 'approve_payment', { paymentId: String(school.inv1._id) });
    expect(financeApproves.error.code).toBe('FORBIDDEN');
    const teacherErases = await mcp(OAK, school.people.TEACHER.actor, 'anonymise_student', { admissionNo: 'OAK-1', reason: 'x' });
    expect(teacherErases.error.code).toBe('FORBIDDEN');
  });
});

/* ── Audit ────────────────────────────────────────────────── */

describe('MCP actions are audited', () => {
  const auditFor = (tool) => inSchool(OAK, () => AuditLog.findOne({ action: `agent.${tool}`, 'after.status': 'EXECUTED' }).lean());

  function expectCompleteEntry(entry, actor) {
    expect(entry, 'no EXECUTED audit entry').not.toBeNull();
    expect(String(entry.actorProfileId)).toBe(actor.profileId);
    expect(entry.after.via).toBe('MCP');
    expect(entry.after.confirmed).toBe(true);
    expect(entry.after.tenantId).toBe(OAK);
    expect(entry.entityId).toBeTruthy(); // the AgentAction the person approved
    expect(entry.createdAt).toBeInstanceOf(Date);
  }

  it('update_student records the fields before and after', async () => {
    const admin = school.people.ADMIN.actor;
    await proposeAndConfirm(OAK, admin, 'update_student', { admissionNo: 'OAK-1', fields: { address: 'New Street' } });
    const entry = await auditFor('update_student');
    expectCompleteEntry(entry, admin);
    expect(entry.before.address ?? null).toBeNull();
    expect(entry.after.state.address).toBe('New Street');
  });

  it('mark_attendance records the register before and after', async () => {
    const teacher = school.people.TEACHER.actor;
    await proposeAndConfirm(OAK, teacher, 'mark_attendance', { students: [{ studentName: 'Rahul Sharma', status: 'PRESENT' }] });
    const entry = await auditFor('mark_attendance');
    expectCompleteEntry(entry, teacher);
    expect(entry.before.rows).toEqual([{ enrollmentId: String(school.rahul.enrollment._id), status: 'ABSENT' }]);
    expect(entry.after.state.rows).toEqual([{ enrollmentId: String(school.rahul.enrollment._id), status: 'PRESENT' }]);
  });

  it('record_payment by finance, then approve_payment by an admin, are each audited', async () => {
    const finance = school.people.FINANCE.actor;
    const { done } = await proposeAndConfirm(OAK, finance, 'record_payment', { invoiceNo: 'INV-1001', amountPaise: 250000, mode: 'CASH' });
    expect(done.data.recordStatus).toBe('PENDING_ADMIN_APPROVAL');
    const recorded = await auditFor('record_payment');
    expectCompleteEntry(recorded, finance);
    expect(recorded.before.invoiceNo).toBe('INV-1001');

    const admin = school.people.ADMIN.actor;
    const approved = await proposeAndConfirm(OAK, admin, 'approve_payment', { paymentId: done.data.paymentId });
    expect(approved.done, `proposal was: ${JSON.stringify(approved.proposal)}`).not.toBeNull();
    expect(approved.done.success, JSON.stringify(approved.done.error)).toBe(true);
    const payment = await inSchool(OAK, () => Payment.findById(done.data.paymentId).lean());
    expect(payment.recordStatus).toBe('PUBLISHED');
    expectCompleteEntry(await auditFor('approve_payment'), admin);
  });

  it('archive_student records what the record was before it was deactivated', async () => {
    const admin = school.people.ADMIN.actor;
    await proposeAndConfirm(OAK, admin, 'archive_student', { admissionNo: 'OAK-3' });
    const entry = await auditFor('archive_student');
    expectCompleteEntry(entry, admin);
    expect(entry.before.status).toBe('ACTIVE');
    expect(entry.before.deletedAt).toBeNull();
  });

  describe('external messaging', () => {
    const saved = {};
    beforeEach(() => {
      saved.id = env.WA_PHONE_NUMBER_ID;
      saved.token = env.WA_ACCESS_TOKEN;
      env.WA_PHONE_NUMBER_ID = '000111222';
      env.WA_ACCESS_TOKEN = 'meta-access-token-DO-NOT-LOG';
      // Meta's API is the one thing stubbed: a real send cannot happen in a test.
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    });
    afterEach(() => {
      env.WA_PHONE_NUMBER_ID = saved.id;
      env.WA_ACCESS_TOKEN = saved.token;
      vi.unstubAllGlobals();
    });

    it('send_whatsapp_message is audited without the access token or the confirmation token', async () => {
      const admin = school.people.ADMIN.actor;
      const { proposal, done } = await proposeAndConfirm(OAK, admin, 'send_whatsapp_message', { to: '+919999900001', text: 'Hello from school' });
      expect(done.success).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);

      const entry = await auditFor('send_whatsapp_message');
      expectCompleteEntry(entry, admin);
      const serialised = JSON.stringify(await inSchool(OAK, () => AuditLog.find().lean()));
      expect(serialised).not.toContain('meta-access-token-DO-NOT-LOG');
      expect(serialised).not.toContain(proposal.action.confirmationToken);
      expect(serialised).not.toContain('tokenHash');
    });

    it('a replayed confirmation does not send the message twice', async () => {
      const admin = school.people.ADMIN.actor;
      const proposal = await mcp(OAK, admin, 'send_whatsapp_message', { to: '+919999900001', text: 'Once only' });
      const token = proposal.action.confirmationToken;
      await mcp(OAK, admin, 'send_whatsapp_message', {}, { confirmationToken: token });
      const replay = await mcp(OAK, admin, 'send_whatsapp_message', {}, { confirmationToken: token });
      expect(replay.success).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
});

/* ── Duplicate execution ──────────────────────────────────── */

describe('a retried or doubled action cannot run twice', () => {
  it('two simultaneous confirmations of one payment record it once', async () => {
    const finance = school.people.FINANCE.actor;
    const proposal = await mcp(OAK, finance, 'record_payment', { invoiceNo: 'INV-1001', amountPaise: 100000, mode: 'CASH' });
    const token = proposal.action.confirmationToken;

    const [a, b] = await Promise.all([
      mcp(OAK, finance, 'record_payment', {}, { confirmationToken: token }),
      mcp(OAK, finance, 'record_payment', {}, { confirmationToken: token }),
    ]);
    expect([a.success, b.success].filter(Boolean)).toHaveLength(1);
    expect(await inSchool(OAK, () => Payment.countDocuments({ invoiceId: school.inv1._id }))).toBe(1);
  });

  it('marking the same student twice leaves one register entry', async () => {
    const teacher = school.people.TEACHER.actor;
    await proposeAndConfirm(OAK, teacher, 'mark_attendance', { students: [{ admissionNo: 'OAK-3', status: 'PRESENT' }] });
    await proposeAndConfirm(OAK, teacher, 'mark_attendance', { students: [{ admissionNo: 'OAK-3', status: 'LATE' }] });
    const rows = await inSchool(OAK, () => AttendanceRecord.find({ enrollmentId: school.aman.enrollment._id }).lean());
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('LATE');
  });

  it('an invoice number that already exists is refused, not duplicated', async () => {
    const { done } = await proposeAndConfirm(OAK, school.people.ADMIN.actor, 'create_invoice', {
      enrollmentId: String(school.priya.enrollment._id), invoiceNo: 'INV-1001', dueOn: '2026-12-01',
      lines: [{ description: 'Duplicate', amountPaise: 100 }],
    });
    expect(done.success).toBe(false);
    expect(done.error.code).toBe('CONFLICT');
    expect(await inSchool(OAK, () => Invoice.countDocuments({ invoiceNo: 'INV-1001' }))).toBe(1);
  });

  it('generating invoices twice bills nobody twice', async () => {
    const admin = school.people.ADMIN.actor;
    await inSchool(OAK, async () => {
      const head = await FeeHead.create({ name: 'Activity fee' });
      await FeeStructure.create({
        feeHeadId: head._id, academicYearId: school.year._id, gradeId: school.grade._id,
        name: 'Activity fee', amountPaise: 20000, dueOn: new Date('2026-12-01'),
      });
    });
    const preview = await mcp(OAK, admin, 'generate_invoices', { academicYearId: String(school.year._id), dryRun: true });
    expect(preview.action.status).toBe('completed'); // no confirmation for a dry run
    const expected = preview.data.generated;
    expect(expected).toBeGreaterThan(0);

    const first = await proposeAndConfirm(OAK, admin, 'generate_invoices', { academicYearId: String(school.year._id) });
    expect(first.done.data.generated).toBe(expected);
    const second = await proposeAndConfirm(OAK, admin, 'generate_invoices', { academicYearId: String(school.year._id) });
    expect(second.done.data.generated).toBe(0);
    expect(second.done.data.skipped).toBe(expected);
  });
});

/* ── The same guard at the service boundary ───────────────── */

describe('student.service.update() refuses system fields for every caller, not only the assistant', () => {
  it.each(['tenantId', 'deletedAt', 'anonymisedAt', 'status', 'profileId', 'leadId', 'photoUrl'])(
    'refuses %s even when called directly, as the REST route does',
    async (field) => {
      const students = await import('../src/modules/students/student.service.js');
      await expect(inSchool(OAK, () => students.update(String(school.rahul.student._id), { [field]: 'x' })))
        .rejects.toMatchObject({ statusCode: 400, code: 'FIELD_NOT_EDITABLE' });
      const rahul = await inSchool(OAK, () => Student.findById(school.rahul.student._id).lean());
      expect(rahul.tenantId).toBe(OAK);
      expect(rahul.deletedAt).toBeNull();
      expect(rahul.status).toBe('ACTIVE');
    },
  );

  it('still lets an administrator correct an editable field through the service', async () => {
    const students = await import('../src/modules/students/student.service.js');
    await inSchool(OAK, () => students.update(String(school.rahul.student._id), { admissionNo: 'OAK-1A', address: 'x' }));
    const rahul = await inSchool(OAK, () => Student.findById(school.rahul.student._id).lean());
    expect(rahul.admissionNo).toBe('OAK-1A');
  });
});
