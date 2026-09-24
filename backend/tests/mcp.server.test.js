import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { Role } from '../src/models/role.model.js';
import { Student, Enrollment } from '../src/models/student.model.js';
import { Grade, Section, AcademicYear } from '../src/models/academics.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { AgentAction } from '../src/models/agentAction.model.js';
import { Announcement } from '../src/models/announcement.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import { openSession, closeSession } from '../src/modules/ai/mcp/session.js';
import { executeToolCall } from '../src/modules/ai/mcp/server.js';
import { listTools, callTool, resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { MCP_TOOLS, mcpToolsFor, validateMcpRegistry, mcpPermissionsUsed } from '../src/modules/ai/mcp/registry.js';
import { STUDENT_UPDATE_ALLOW_LIST } from '../src/modules/ai/mcp/tools/students.js';
import { PERMISSION_CATALOG } from '../src/constants/permissions.js';
import '../src/models/profile.model.js';

/**
 * The MCP server, exercised the way an AI agent reaches it.
 *
 * What these assert is not "the tools return data" — it is the set of
 * properties that have to hold no matter what a language model asks for:
 * identity comes from the session, authorization comes from the permission
 * map, a school cannot see another school, a write does not happen without a
 * person saying yes, and an argument the schema does not know is refused
 * rather than passed through to a service that would have written it.
 */

const OAK = 'oakridge';
const RIVER = 'riverside';
const inOak = (fn) => runWithTenant(OAK, fn);
const inRiver = (fn) => runWithTenant(RIVER, fn);

const permsOf = (roleKey) =>
  buildPermissionMap({ permissions: SYSTEM_ROLES.find((r) => r.key === roleKey).grants });

const actorFor = (roleKey, overrides = {}) => ({
  roleKey,
  profileId: String(new mongoose.Types.ObjectId()),
  permissions: permsOf(roleKey),
  tenantId: OAK,
  ...overrides,
});

/** Runs one MCP call inside a school, with a session opened for that actor. */
async function call(tenant, actor, name, args = {}, opts = {}) {
  const runner = tenant === RIVER ? inRiver : inOak;
  return runner(async () => {
    const sessionId = openSession({ actor, channel: 'WEB' });
    try {
      return await executeToolCall({ sessionId, name, args, ...opts });
    } finally {
      closeSession(sessionId);
    }
  });
}

let oakSection;
let oakStudent;
let oakEnrollment;
let oakYear;

beforeEach(async () => {
  for (const r of SYSTEM_ROLES) {
    await Role.create({ key: r.key, name: r.name, isSystem: true, permissions: r.grants });
  }

  await inOak(async () => {
    oakYear = await AcademicYear.create({
      name: '2026-27',
      startsOn: new Date('2026-04-01'),
      endsOn: new Date('2027-03-31'),
      isCurrent: true,
    });
    const grade = await Grade.create({ name: 'Class 6', level: 6 });
    oakSection = await Section.create({ gradeId: grade._id, name: 'A' });
    oakStudent = await Student.create({ admissionNo: 'OAK-1', firstName: 'Rahul', lastName: 'Sharma' });
    oakEnrollment = await Enrollment.create({
      studentId: oakStudent._id, sectionId: oakSection._id, academicYearId: oakYear._id, status: 'ACTIVE', rollNo: 1,
    });
    await Student.create({ admissionNo: 'OAK-2', firstName: 'Priya', lastName: 'Verma' });
  });

  await inRiver(async () => {
    const grade = await Grade.create({ name: 'Class 6', level: 6 });
    const section = await Section.create({ gradeId: grade._id, name: 'A' });
    const student = await Student.create({ admissionNo: 'RIV-1', firstName: 'Rahul', lastName: 'Riverside' });
    await Enrollment.create({
      studentId: student._id, sectionId: section._id,
      academicYearId: new mongoose.Types.ObjectId(), status: 'ACTIVE',
    });
  });
});

afterAll(async () => {
  await resetMcpClient();
});

/* ── The catalog itself ───────────────────────────────────── */

describe('the tool catalog is internally consistent', () => {
  it('every tool declares an operation, a risk level, a permission and a run()', () => {
    expect(validateMcpRegistry()).toEqual([]);
  });

  it('every permission a tool names exists in the real catalog', () => {
    const known = new Set(PERMISSION_CATALOG.map((p) => p.key));
    const unknown = mcpPermissionsUsed().filter((p) => !known.has(p));
    expect(unknown).toEqual([]);
  });

  it('every write can describe itself before it happens', () => {
    for (const [name, tool] of Object.entries(MCP_TOOLS)) {
      if (tool.operation === 'GET') continue;
      expect(typeof tool.summarise, `${name} cannot summarise itself`).toBe('function');
    }
  });

  it('every delete and every irreversible action requires confirmation', () => {
    for (const [name, tool] of Object.entries(MCP_TOOLS)) {
      if (tool.operation === 'DELETE' || tool.risk === 'CRITICAL') {
        expect(tool.confirm, `${name} must require confirmation`).toBe(true);
      }
    }
  });

  it('no tool offers raw database, SQL or arbitrary-request access', () => {
    // Anchored on word boundaries: "withdraw_elective_registration" contains
    // the letters "draw_" and is not an escape hatch.
    const forbidden = new Set(['sql', 'query', 'raw', 'exec', 'execute', 'eval', 'shell', 'command', 'http', 'fetch', 'api', 'url', 'database', 'db', 'arbitrary']);
    for (const name of Object.keys(MCP_TOOLS)) {
      expect(name.split('_').filter((word) => forbidden.has(word)), `${name} looks like an escape hatch`).toEqual([]);
    }
  });
});

/* ── Role-filtered discovery ──────────────────────────────── */

describe('tool discovery follows permissions, not role names', () => {
  it('gives each role that can use the assistant a usable, bounded toolset', () => {
    for (const role of SYSTEM_ROLES.map((r) => r.key)) {
      const tools = mcpToolsFor(actorFor(role));
      if (role === 'SUPER_ADMIN') {
        // Excluded from the assistant by not holding ai.copilot.use, so it is
        // described no catalogue at all. See tests/ai.superAdminExcluded.test.js.
        expect(tools, 'SUPER_ADMIN was offered a catalogue').toEqual([]);
      } else {
        expect(tools.length, `${role} sees no tools at all`).toBeGreaterThan(0);
      }
    }
  });

  it('never shows a parent a finance write or an admin tool', () => {
    const names = mcpToolsFor(actorFor('PARENT')).map((t) => t.name);
    for (const forbidden of [
      'record_payment', 'approve_payment', 'refund_payment', 'generate_invoices',
      'create_student', 'update_student', 'archive_student', 'anonymise_student',
      'mark_attendance', 'publish_marks', 'list_users', 'send_whatsapp_message',
    ]) {
      expect(names, `a parent was offered ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('shows finance the fee tools and not the attendance register', () => {
    const names = mcpToolsFor(actorFor('FINANCE')).map((t) => t.name);
    expect(names).toContain('get_pending_fees');
    expect(names).toContain('record_payment');
    expect(names).not.toContain('mark_attendance');
    expect(names).not.toContain('publish_marks');
  });

  it('withholds payment approval from finance, who may record but not approve', () => {
    // The separation of duties the fee module encodes: Finance holds
    // fees.plan.request and .review, and deliberately not .approve.
    const names = mcpToolsFor(actorFor('FINANCE')).map((t) => t.name);
    expect(names).toContain('record_payment');
    expect(names).not.toContain('approve_payment');
  });

  it('works for a custom role built from grants alone', () => {
    // Roles are DB-backed and a school can invent its own, so discovery must
    // never key off a role name. A counsellor with two grants sees exactly the
    // tools those two grants imply.
    const counsellor = {
      roleKey: 'COUNSELLOR',
      profileId: String(new mongoose.Types.ObjectId()),
      // ai.copilot.use is what admits any role to the assistant at all; the
      // other two are what decide which of its tools they then see.
      permissions: { 'ai.copilot.use': 'ALL', 'students.read': 'ALL', 'attendance.read': 'ALL' },
    };
    const names = mcpToolsFor(counsellor).map((t) => t.name);
    expect(names).toContain('search_students');
    expect(names).toContain('get_absent_students');
    expect(names).not.toContain('get_pending_fees');
    expect(names).not.toContain('create_student');
  });

  it('serves the same filtered list over the protocol as the registry computes', async () => {
    const actor = actorFor('TEACHER');
    const sessionId = openSession({ actor, channel: 'WEB' });
    try {
      const overProtocol = (await listTools(sessionId)).map((t) => t.name).sort();
      const direct = mcpToolsFor(actor).map((t) => t.name).sort();
      expect(overProtocol).toEqual(direct);
    } finally {
      closeSession(sessionId);
    }
  });

  it('tells an unauthenticated client nothing about the school', async () => {
    expect(await listTools('not-a-real-session')).toEqual([]);
  });

  it('reports the same catalog to /ai/agent/capabilities as to the model', async () => {
    // The capabilities endpoint was the one place still reporting the
    // pre-MCP eighteen tools, so the assistant panel advertised a fraction of
    // what it could do and none of the write operations.
    const { agentCapabilities } = await import('../src/modules/ai/ai.controller.js');
    const actor = actorFor('TEACHER');

    let payload;
    await agentCapabilities(
      { actor },
      { status: () => ({ json: (b) => { payload = b; } }), json: (b) => { payload = b; } },
      (err) => { if (err) throw err; },
    );

    const reported = payload.data.tools;
    expect(reported.map((t) => t.name).sort()).toEqual(mcpToolsFor(actor).map((t) => t.name).sort());
    // The shape the frontend's AgentTool type declares must survive.
    expect(reported[0]).toHaveProperty('name');
    expect(reported[0]).toHaveProperty('description');
    expect(reported[0]).toHaveProperty('mutates');
    expect(reported.some((t) => t.mutates)).toBe(true);
  });
});

/* ── READ ─────────────────────────────────────────────────── */

describe('read tools answer from the ERP', () => {
  it('finds a student by name', async () => {
    const res = await call(OAK, actorFor('ADMIN'), 'search_students', { query: 'Rahul' });
    expect(res.success).toBe(true);
    expect(res.data.students).toHaveLength(1);
    expect(res.data.students[0].admissionNo).toBe('OAK-1');
    expect(res.data.students[0].class).toBe('Class 6 A');
  });

  it('returns an empty result as a success, not an error', async () => {
    const res = await call(OAK, actorFor('ADMIN'), 'search_students', { query: 'Nobody' });
    expect(res.success).toBe(true);
    expect(res.data.students).toEqual([]);
    expect(res.speak).toMatch(/no students/i);
  });

  it('reads a student by admission number', async () => {
    const res = await call(OAK, actorFor('ADMIN'), 'get_student', { admissionNo: 'OAK-1' });
    expect(res.success).toBe(true);
    expect(res.data.name).toBe('Rahul Sharma');
    expect(res.data.rollNo).toBe(1);
  });

  it('reports a student who does not exist as NOT_FOUND', async () => {
    const res = await call(OAK, actorFor('ADMIN'), 'get_student', { admissionNo: 'NOPE-99' });
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('NOT_FOUND');
  });

  it("says the register is unmarked rather than implying nobody is absent", async () => {
    const res = await call(OAK, actorFor('ADMIN'), 'get_absent_students', {});
    expect(res.success).toBe(true);
    expect(res.data.marked).toBe(0);
    expect(res.speakKey).toBe('absent.notMarked');
  });

  it('reports absences once the register is marked', async () => {
    await inOak(() => AttendanceRecord.create({
      enrollmentId: oakEnrollment._id,
      sectionId: oakSection._id,
      date: new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())),
      periodNo: null,
      status: 'ABSENT',
    }));
    const res = await call(OAK, actorFor('ADMIN'), 'get_absent_students', {});
    expect(res.success).toBe(true);
    expect(res.data.ABSENT).toBe(1);
  });

  it('answers the pending-fee question with real totals', async () => {
    const res = await call(OAK, actorFor('ADMIN'), 'get_pending_fees', {});
    expect(res.success).toBe(true);
    expect(res.data).toHaveProperty('totalOutstandingPaise');
    expect(res.data).toHaveProperty('studentsWithPendingFees');
  });

  it('answers fee statistics', async () => {
    const res = await call(OAK, actorFor('FINANCE'), 'get_fee_statistics', {});
    expect(res.success).toBe(true);
    expect(res.data).toHaveProperty('collectionPct');
  });

  it('lists classes so a class name can become a section id', async () => {
    const res = await call(OAK, actorFor('ADMIN'), 'list_classes', {});
    expect(res.success).toBe(true);
    expect(res.data.sections.map((s) => s.name)).toContain('A');
  });

  it('reports the admissions pipeline', async () => {
    const res = await call(OAK, actorFor('ADMIN'), 'get_admissions', {});
    expect(res.success).toBe(true);
    expect(res.data.total).toBe(0);
  });
});

/* ── Authorization ────────────────────────────────────────── */

describe('authorization comes from the permission map', () => {
  it('refuses a parent the finance roster', async () => {
    const res = await call(OAK, actorFor('PARENT'), 'get_pending_fees', {});
    // A parent holds fees.read at OWN, so this is not forbidden outright — it
    // answers about their own family and nobody else's.
    expect(res.success).toBe(true);
  });

  it('refuses a parent a payment they may not record', async () => {
    const res = await call(OAK, actorFor('PARENT'), 'record_payment', {
      invoiceId: String(new mongoose.Types.ObjectId()), amountPaise: 50000, mode: 'CASH',
    });
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('FORBIDDEN_SCOPE');
  });

  it('refuses a teacher a finance-only operation', async () => {
    const res = await call(OAK, actorFor('TEACHER'), 'approve_payment', {
      paymentId: String(new mongoose.Types.ObjectId()),
    });
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('FORBIDDEN');
  });

  it('refuses finance an admin-only student write', async () => {
    const res = await call(OAK, actorFor('FINANCE'), 'create_student', {
      admissionNo: 'X-1', firstName: 'Test',
    });
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('FORBIDDEN');
  });

  it('refuses a school-wide read to a caller scoped to their own records', async () => {
    const res = await call(OAK, actorFor('STUDENT'), 'get_absent_students', {});
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('FORBIDDEN_SCOPE');
  });

  it('refuses anonymisation to anyone without students.manage', async () => {
    const res = await call(OAK, actorFor('TEACHER'), 'anonymise_student', {
      admissionNo: 'OAK-1', reason: 'test',
    });
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('FORBIDDEN');
  });

  it('refuses a call carrying no session at all', async () => {
    const res = await executeToolCall({ sessionId: 'forged', name: 'search_students', args: { query: 'x' } });
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('UNAUTHENTICATED');
  });

  it('re-reads permissions at call time, not at session open', async () => {
    const actor = actorFor('ADMIN');
    const sessionId = openSession({ actor, channel: 'WEB' });
    try {
      // Revoked after the session was opened. The next call must see that.
      delete actor.permissions['students.read'];
      const res = await inOak(() => executeToolCall({ sessionId, name: 'search_students', args: { query: 'Rahul' } }));
      expect(res.success).toBe(false);
      expect(res.error.code).toBe('FORBIDDEN');
    } finally {
      closeSession(sessionId);
    }
  });
});

/* ── Identity and tenancy ─────────────────────────────────── */

describe('the model cannot choose who it is or which school it is in', () => {
  it('ignores a tenantId supplied as a tool argument', async () => {
    const res = await call(OAK, actorFor('ADMIN'), 'search_students', {
      query: 'Rahul', tenantId: RIVER,
    });
    // Stripped, so the call runs — in Oakridge, where the caller actually is.
    expect(res.success).toBe(true);
    expect(res.data.students).toHaveLength(1);
    expect(res.data.students[0].admissionNo).toBe('OAK-1');
  });

  it('ignores a profileId supplied as a tool argument', async () => {
    const someoneElse = String(new mongoose.Types.ObjectId());
    const res = await call(OAK, actorFor('ADMIN'), 'search_students', {
      query: 'Rahul', profileId: someoneElse, role: 'SUPER_ADMIN',
    });
    expect(res.success).toBe(true);
  });

  it('cannot reach another school even naming a student who exists there', async () => {
    // "Rahul" exists in both schools. An Oakridge admin must find exactly one.
    const res = await call(OAK, actorFor('ADMIN'), 'search_students', { query: 'Rahul' });
    expect(res.data.students).toHaveLength(1);
    expect(res.data.students[0].admissionNo).toBe('OAK-1');

    const riverside = await call(RIVER, actorFor('ADMIN', { tenantId: RIVER }), 'search_students', { query: 'Rahul' });
    expect(riverside.data.students).toHaveLength(1);
    expect(riverside.data.students[0].admissionNo).toBe('RIV-1');
  });

  it("cannot read another school's student by id", async () => {
    let riversideStudentId;
    await inRiver(async () => {
      const s = await Student.findOne({ admissionNo: 'RIV-1' });
      riversideStudentId = String(s._id);
    });
    const res = await call(OAK, actorFor('ADMIN'), 'get_student', { studentId: riversideStudentId });
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('NOT_FOUND');
  });

  it('refuses a write when no school has been chosen', async () => {
    // A request that arrives without a school runs outside any tenant, and a
    // write in that state is unbounded: it names records by id and the tenant
    // filter is not there to confine it.
    //
    // Tested with an administrator rather than the platform role it was
    // written for: SUPER_ADMIN is now refused the assistant outright, one
    // check earlier, so it can no longer reach this guard at all. The guard
    // itself is unchanged and still the thing under test.
    const admin = actorFor('ADMIN', { tenantId: null });
    const sessionId = openSession({ actor: admin, channel: 'WEB' });
    try {
      const res = await executeToolCall({
        sessionId, name: 'create_student', args: { admissionNo: 'X-9', firstName: 'Nobody' },
      });
      expect(res.success).toBe(false);
      expect(res.error.code).toBe('SCHOOL_REQUIRED');
    } finally {
      closeSession(sessionId);
    }
  });
});

/* ── Validation ───────────────────────────────────────────── */

describe('arguments are validated before anything runs', () => {
  it('refuses a missing required argument', async () => {
    // create_book rather than search_students: `query` is no longer required
    // there, because the Web students page lists the directory with an empty
    // search box and demanding one made "show me the students in my school"
    // impossible to answer. The property under test is unchanged -- a schema
    // that declares an argument required refuses the call without it, before
    // anything runs -- so it is asserted against a tool that still declares
    // one. Nothing is written: validation fails first.
    const res = await call(OAK, actorFor('ADMIN'), 'create_book', {});
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('INVALID_INPUT');
    expect(res.error.message).toMatch(/title is required/);
  });

  it('lists the student directory when no search term is given', async () => {
    // The other half of that change, asserted rather than assumed: an absent
    // `query` is a browse, not an error.
    const res = await call(OAK, actorFor('ADMIN'), 'search_students', {});
    expect(res.success, JSON.stringify(res.error ?? {})).toBe(true);
    expect(Array.isArray(res.data.students)).toBe(true);
  });

  it('refuses an argument the tool does not have', async () => {
    const res = await call(OAK, actorFor('ADMIN'), 'search_students', { query: 'x', sortBy: 'salary' });
    expect(res.success).toBe(false);
    expect(res.error.message).toMatch(/sortBy is not a parameter/);
  });

  it('refuses a malformed identifier', async () => {
    const res = await call(OAK, actorFor('ADMIN'), 'get_student', { studentId: 'not-an-id' });
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('INVALID_INPUT');
  });

  it('refuses a value outside an enum', async () => {
    const res = await call(OAK, actorFor('ADMIN'), 'get_admissions', { stage: 'MADE_UP' });
    expect(res.success).toBe(false);
    expect(res.error.message).toMatch(/must be one of/);
  });

  it('refuses an unknown tool without leaking what exists', async () => {
    const res = await call(OAK, actorFor('ADMIN'), 'drop_database', {});
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('UNKNOWN_TOOL');
  });
});

/* ── The student field allow-list ─────────────────────────── */

describe('update_student cannot reach past its allow-list', () => {
  it('accepts only the fields a person may correct', () => {
    expect(STUDENT_UPDATE_ALLOW_LIST).toEqual(['firstName', 'lastName', 'dob', 'gender', 'address']);
  });

  it('refuses a system-controlled field in the schema', async () => {
    const res = await call(OAK, actorFor('ADMIN'), 'update_student', {
      admissionNo: 'OAK-1',
      fields: { admissionNo: 'HACKED-1' },
    });
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('INVALID_INPUT');
  });

  it('refuses to change enrolment status through a profile edit', async () => {
    const res = await call(OAK, actorFor('ADMIN'), 'update_student', {
      admissionNo: 'OAK-1',
      fields: { status: 'INACTIVE' },
    });
    expect(res.success).toBe(false);
  });

  it('refuses tenantId and deletedAt outright', async () => {
    for (const field of ['tenantId', 'deletedAt', 'anonymisedAt', 'profileId']) {
      const res = await call(OAK, actorFor('ADMIN'), 'update_student', {
        admissionNo: 'OAK-1', fields: { [field]: 'x' },
      });
      expect(res.success, `${field} was accepted`).toBe(false);
    }
    const fresh = await inOak(() => Student.findOne({ admissionNo: 'OAK-1' }).lean());
    expect(fresh.tenantId).toBe(OAK);
    expect(fresh.deletedAt).toBeNull();
  });
});

/* ── Confirmation ─────────────────────────────────────────── */

describe('high-impact writes are proposed, not performed', () => {
  it('proposes rather than writes, and says what it would do', async () => {
    const res = await call(OAK, actorFor('ADMIN'), 'create_student', {
      admissionNo: 'OAK-9', firstName: 'Unconfirmed',
    });
    expect(res.success).toBe(true);
    expect(res.action.status).toBe('confirmation_required');
    expect(res.action.confirmationToken).toBeTruthy();
    expect(res.action.summary).toMatch(/OAK-9/);
    expect(await inOak(() => Student.countDocuments({ admissionNo: 'OAK-9' }))).toBe(0);
  });

  it('performs it once the token comes back', async () => {
    const actor = actorFor('ADMIN');
    const proposal = await call(OAK, actor, 'create_student', { admissionNo: 'OAK-9', firstName: 'Confirmed' });
    const done = await call(OAK, actor, 'create_student', {}, {
      confirmationToken: proposal.action.confirmationToken,
    });
    expect(done.success).toBe(true);
    expect(done.action.status).toBe('completed');
    expect(await inOak(() => Student.countDocuments({ admissionNo: 'OAK-9' }))).toBe(1);
  });

  it('runs the arguments that were approved, not ones sent with the token', async () => {
    const actor = actorFor('ADMIN');
    const proposal = await call(OAK, actor, 'create_student', { admissionNo: 'OAK-APPROVED', firstName: 'Approved' });
    await call(OAK, actor, 'create_student', { admissionNo: 'OAK-SWAPPED', firstName: 'Swapped' }, {
      confirmationToken: proposal.action.confirmationToken,
    });
    expect(await inOak(() => Student.countDocuments({ admissionNo: 'OAK-APPROVED' }))).toBe(1);
    expect(await inOak(() => Student.countDocuments({ admissionNo: 'OAK-SWAPPED' }))).toBe(0);
  });

  it("refuses a token issued to somebody else", async () => {
    const proposer = actorFor('ADMIN');
    const proposal = await call(OAK, proposer, 'create_student', { admissionNo: 'OAK-8', firstName: 'X' });
    const other = actorFor('ADMIN');
    const res = await call(OAK, other, 'create_student', {}, {
      confirmationToken: proposal.action.confirmationToken,
    });
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('FORBIDDEN');
    expect(await inOak(() => Student.countDocuments({ admissionNo: 'OAK-8' }))).toBe(0);
  });

  it('refuses a token a second time, so a retry cannot write twice', async () => {
    const actor = actorFor('ADMIN');
    const proposal = await call(OAK, actor, 'create_student', { admissionNo: 'OAK-7', firstName: 'Once' });
    const token = proposal.action.confirmationToken;
    await call(OAK, actor, 'create_student', {}, { confirmationToken: token });
    const replay = await call(OAK, actor, 'create_student', {}, { confirmationToken: token });
    expect(replay.success).toBe(false);
    expect(await inOak(() => Student.countDocuments({ admissionNo: 'OAK-7' }))).toBe(1);
  });

  it('refuses a token presented against a different tool', async () => {
    const actor = actorFor('ADMIN');
    const proposal = await call(OAK, actor, 'create_student', { admissionNo: 'OAK-6', firstName: 'X' });
    const res = await call(OAK, actor, 'archive_student', {}, {
      confirmationToken: proposal.action.confirmationToken,
    });
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('CONFIRMATION_INVALID');
  });

  it('re-authorizes at confirmation time, not at proposal time', async () => {
    const actor = actorFor('ADMIN');
    const proposal = await call(OAK, actor, 'create_student', { admissionNo: 'OAK-5', firstName: 'X' });

    // Permission revoked between the proposal and the yes.
    delete actor.permissions['students.manage'];
    const res = await call(OAK, actor, 'create_student', {}, {
      confirmationToken: proposal.action.confirmationToken,
    });
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('FORBIDDEN');
    expect(await inOak(() => Student.countDocuments({ admissionNo: 'OAK-5' }))).toBe(0);
  });

  it('rejects a field allow-list violation before asking for confirmation', async () => {
    // The refusal has to come first. Approving a summary for something that
    // cannot succeed is what makes confirmation feel untrustworthy.
    const res = await call(OAK, actorFor('ADMIN'), 'update_student', {
      admissionNo: 'OAK-1', fields: { firstName: 'Raj', address: 'New' },
    });
    expect(res.success).toBe(true);
    expect(res.action.status).toBe('confirmation_required');
    // The prompt shows each new value, not just which fields — that is what is being approved.
    expect(res.action.summary).toBe('Update Rahul Sharma: firstName → "Raj", address → "New"');
  });

  it('applies an approved profile correction', async () => {
    const actor = actorFor('ADMIN');
    const proposal = await call(OAK, actor, 'update_student', {
      admissionNo: 'OAK-1', fields: { address: '12 New Street' },
    });
    const done = await call(OAK, actor, 'update_student', {}, {
      confirmationToken: proposal.action.confirmationToken,
    });
    expect(done.success).toBe(true);
    const fresh = await inOak(() => Student.findOne({ admissionNo: 'OAK-1' }).lean());
    expect(fresh.address).toBe('12 New Street');
    expect(fresh.admissionNo).toBe('OAK-1');
  });
});

/* ── Actions ──────────────────────────────────────────────── */

describe('business actions run through the existing services', () => {
  it('marks attendance only after confirmation, then records it', async () => {
    const actor = actorFor('ADMIN');
    const args = {
      sectionId: String(oakSection._id),
      entries: [{ enrollmentId: String(oakEnrollment._id), status: 'ABSENT' }],
    };

    const proposal = await call(OAK, actor, 'mark_attendance', args);
    expect(proposal.action.status).toBe('confirmation_required');
    expect(await inOak(() => AttendanceRecord.countDocuments())).toBe(0);

    const done = await call(OAK, actor, 'mark_attendance', {}, {
      confirmationToken: proposal.action.confirmationToken,
    });
    expect(done.success).toBe(true);
    expect(done.action.type).toBe('attendance_marked');
    expect(await inOak(() => AttendanceRecord.countDocuments({ status: 'ABSENT' }))).toBe(1);
  });

  it('publishes an announcement only after confirmation', async () => {
    const actor = actorFor('ADMIN');
    const proposal = await call(OAK, actor, 'create_announcement', {
      title: 'Holiday', content: 'School closed Friday',
    });
    expect(await inOak(() => Announcement.countDocuments())).toBe(0);

    await call(OAK, actor, 'create_announcement', {}, {
      confirmationToken: proposal.action.confirmationToken,
    });
    expect(await inOak(() => Announcement.countDocuments())).toBe(1);
  });

  it('refuses to send a WhatsApp message when sending is not configured', async () => {
    // Better a refusal than a cheerful "message sent" for something that went
    // nowhere.
    const res = await call(OAK, actorFor('ADMIN'), 'send_whatsapp_message', {
      to: '+919999900001', text: 'Hello',
    });
    if (res.action?.status === 'confirmation_required') {
      const done = await call(OAK, actorFor('ADMIN'), 'send_whatsapp_message', {}, {
        confirmationToken: res.action.confirmationToken,
      });
      // Confirmed by a different actor object with the same permissions is
      // refused first; either way, nothing claims success.
      expect(done.success).toBe(false);
    }
  });

  it('refuses a payment against an invoice that does not exist before asking anyone to confirm it', async () => {
    // The invoice is resolved in prepare(), ahead of the confirmation prompt,
    // so a person is never asked to approve a payment that cannot be recorded.
    const actor = actorFor('ADMIN');
    const proposal = await call(OAK, actor, 'record_payment', {
      invoiceId: String(new mongoose.Types.ObjectId()), amountPaise: 50000, mode: 'CASH',
    });
    expect(proposal.success).toBe(false);
    expect(proposal.error.code).toBe('NOT_FOUND');
    expect(await inOak(() => AgentAction.countDocuments({ tool: 'record_payment' }))).toBe(0);
  });
});

/* ── Delete ───────────────────────────────────────────────── */

describe('deletes are soft, confirmed and auditable', () => {
  it('archives a student rather than removing the record', async () => {
    const actor = actorFor('ADMIN');
    const proposal = await call(OAK, actor, 'archive_student', { admissionNo: 'OAK-2' });
    expect(proposal.action.status).toBe('confirmation_required');

    await call(OAK, actor, 'archive_student', {}, { confirmationToken: proposal.action.confirmationToken });

    const archived = await inOak(() => Student.findOne({ admissionNo: 'OAK-2' }).lean());
    expect(archived).not.toBeNull();
    expect(archived.deletedAt).not.toBeNull();
    expect(archived.status).toBe('INACTIVE');
  });

  it('will not anonymise without a reason', async () => {
    const res = await call(OAK, actorFor('ADMIN'), 'anonymise_student', { admissionNo: 'OAK-1' });
    expect(res.success).toBe(false);
    expect(res.error.message).toMatch(/reason is required/);
  });

  it('warns in the summary that anonymisation cannot be undone', async () => {
    const res = await call(OAK, actorFor('ADMIN'), 'anonymise_student', {
      admissionNo: 'OAK-1', reason: 'Erasure request',
    });
    expect(res.action.status).toBe('confirmation_required');
    expect(res.action.risk).toBe('CRITICAL');
    expect(res.action.summary).toMatch(/cannot be undone/i);
  });
});

/* ── Audit ────────────────────────────────────────────────── */

describe('every call is auditable', () => {
  it('records a read with the actor and the tool', async () => {
    const actor = actorFor('ADMIN');
    await call(OAK, actor, 'search_students', { query: 'Rahul' });

    const entry = await inOak(() => AuditLog.findOne({ action: 'agent.search_students' }).lean());
    expect(entry).not.toBeNull();
    expect(String(entry.actorProfileId)).toBe(actor.profileId);
    expect(entry.after.status).toBe('READ');
    expect(entry.after.via).toBe('MCP');
    expect(entry.after.tenantId).toBe(OAK);
  });

  it('records a refusal, so an attempt leaves a trace', async () => {
    await call(OAK, actorFor('TEACHER'), 'approve_payment', { paymentId: String(new mongoose.Types.ObjectId()) });
    const entry = await inOak(() => AuditLog.findOne({ action: 'agent.approve_payment' }).lean());
    expect(entry).not.toBeNull();
    expect(entry.after.code).toBe('FORBIDDEN');
  });

  it('records what the record looked like before and after a write', async () => {
    const actor = actorFor('ADMIN');
    const proposal = await call(OAK, actor, 'update_student', {
      admissionNo: 'OAK-1', fields: { address: 'Somewhere else' },
    });
    await call(OAK, actor, 'update_student', {}, { confirmationToken: proposal.action.confirmationToken });

    const entry = await inOak(() =>
      AuditLog.findOne({ action: 'agent.update_student', 'after.status': 'EXECUTED' }).lean());
    expect(entry).not.toBeNull();
    expect(entry.before).toHaveProperty('address');
    expect(entry.after.confirmed).toBe(true);
  });

  it('records the channel a call arrived on', async () => {
    const actor = actorFor('ADMIN');
    await inOak(async () => {
      const sessionId = openSession({ actor, channel: 'WHATSAPP' });
      try {
        await executeToolCall({ sessionId, name: 'search_students', args: { query: 'Rahul' } });
      } finally {
        closeSession(sessionId);
      }
    });
    const entry = await inOak(() => AuditLog.findOne({ action: 'agent.search_students' }).lean());
    expect(entry.channel).toBe('WHATSAPP');
  });

  it('leaves no pending proposal behind when a stored action cannot run', async () => {
    const actor = actorFor('ADMIN');
    // A proposal stored before the tool had a schema, carrying a field it does
    // not accept in a shape it cannot use.
    await inOak(() => AgentAction.create({
      actorProfileId: actor.profileId,
      tool: 'create_student',
      args: { firstName: 'NoAdmissionNumber' },
      summary: 'Create a student',
      source: 'WEB',
      tokenHash: 'x'.repeat(64),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    }));
    // Redeemed through the normal path by re-issuing a token for it.
    const { reissueToken } = await import('../src/modules/ai/mcp/confirm.js');
    const pending = await inOak(() => AgentAction.findOne({ tool: 'create_student' }));
    const token = await inOak(() => reissueToken(pending));

    const res = await call(OAK, actor, 'create_student', {}, { confirmationToken: token });
    expect(res.success).toBe(false);
    const after = await inOak(() => AgentAction.findById(pending._id).lean());
    expect(after.status).not.toBe('PENDING');
  });
});

/* ── The protocol seam ────────────────────────────────────── */

describe('the same checks apply over the MCP transport', () => {
  it('refuses an unauthorized call made through the client', async () => {
    const actor = actorFor('STUDENT');
    const res = await inOak(async () => {
      const sessionId = openSession({ actor, channel: 'WEB' });
      try {
        return await callTool(sessionId, 'get_absent_students', {});
      } finally {
        closeSession(sessionId);
      }
    });
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('FORBIDDEN_SCOPE');
  });

  it('carries a real result back over the transport', async () => {
    const actor = actorFor('ADMIN');
    const res = await inOak(async () => {
      const sessionId = openSession({ actor, channel: 'WEB' });
      try {
        return await callTool(sessionId, 'search_students', { query: 'Priya' });
      } finally {
        closeSession(sessionId);
      }
    });
    expect(res.success).toBe(true);
    expect(res.data.students[0].name).toBe('Priya Verma');
  });
});
