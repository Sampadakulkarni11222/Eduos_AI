import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MCP_TOOLS, mcpToolsFor } from '../src/modules/ai/mcp/registry.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { FeeHead, FeeStructure } from '../src/models/fee.model.js';
import { Book } from '../src/models/library.model.js';
import { BookRequest } from '../src/models/bookRequest.model.js';
import { TransportRequest } from '../src/models/transportRequest.model.js';
import { CoCurricularActivity } from '../src/models/coCurricular.model.js';
import { ProfileEditRequest } from '../src/models/profileEditRequest.model.js';
import { Grade } from '../src/models/academics.model.js';
import * as cocurricular from '../src/modules/studentRequests/cocurricular.service.js';
import * as profileEdit from '../src/modules/studentRequests/profileEdit.service.js';
import { seedSchool, mcp, proposeAndConfirm, inSchool, OAK, RIVER } from './support/mcpSchool.js';

/**
 * The parity gaps the role audit found, closed and held closed.
 *
 * Two kinds. Four self-service requests could be MADE through the assistant
 * but not withdrawn, and a student could not list their own profile-correction
 * requests — while the web offered all five. And fee configuration could not
 * be reached at all, because the services behind it were raw Model.create
 * pass-throughs with no actor, scope, tenant check, validation or audit.
 *
 * Every case here calls the capability DIRECTLY, because that is the surface
 * an audit has to hold: the natural-language path chooses among these, it does
 * not define what they permit.
 */

let school;
beforeEach(async () => {
  school = await seedSchool();
});
afterAll(async () => {
  await resetMcpClient();
});

const student = () => school.people.STUDENT;
/** The fixture's student, as the services see them (Priya owns that profile). */
const priyaActor = () => ({ profileId: String(school.people.STUDENT.profile._id), roleKey: 'STUDENT', ip: '10.0.0.9' });

/* ── The four withdrawals ─────────────────────────────────── */

describe('a request made through the assistant can be withdrawn through it', () => {
  it('withdraws the caller\'s own book request, once confirmed', async () => {
    const book = await inSchool(OAK, () => Book.create({
      title: 'Panchatantra', author: 'Vishnu Sharma', totalCopies: 2, availableCopies: 2,
    }));
    const made = await mcp(OAK, student().actor, 'request_book', { bookId: String(book._id) });
    expect(made.success, JSON.stringify(made.error ?? {})).toBe(true);

    const { proposal, done } = await proposeAndConfirm(
      OAK, student().actor, 'cancel_book_request', { requestId: made.data.id },
    );
    // Withdrawing is not reversible, so it is proposed before it runs.
    expect(proposal.action?.status).toBe('confirmation_required');
    expect(done.success, JSON.stringify(done.error ?? {})).toBe(true);
    expect((await inSchool(OAK, () => BookRequest.findById(made.data.id).lean())).status).toBe('CANCELLED');
  }, 60000);

  it('withdraws the caller\'s own transport request, once confirmed', async () => {
    const view = await mcp(OAK, student().actor, 'get_transport_routes', {});
    expect(view.success).toBe(true);

    const route = await inSchool(OAK, async () => {
      const { TransportRoute, TransportStop } = await import('../src/models/transport.model.js');
      const r = await TransportRoute.create({ name: 'Route 2', status: 'ACTIVE', fareAmountPaise: 0 });
      const stop = await TransportStop.create({ routeId: r._id, name: 'Gate', sequenceNo: 1 });
      return { r, stop };
    });
    const made = await mcp(OAK, student().actor, 'request_transport_route', {
      routeId: String(route.r._id), stopId: String(route.stop._id),
    });
    expect(made.success, JSON.stringify(made.error ?? {})).toBe(true);

    const { done } = await proposeAndConfirm(
      OAK, student().actor, 'cancel_transport_request', { requestId: made.data.id },
    );
    expect(done.success, JSON.stringify(done.error ?? {})).toBe(true);
    expect((await inSchool(OAK, () => TransportRequest.findById(made.data.id).lean())).status).toBe('CANCELLED');
  }, 60000);

  it('withdraws the caller\'s own co-curricular request, once confirmed', async () => {
    const made = await inSchool(OAK, () => cocurricular.request(priyaActor(), {
      name: 'Debate', activityDate: '2026-08-02',
    }));
    const { done } = await proposeAndConfirm(
      OAK, student().actor, 'cancel_cocurricular_request', { requestId: made.id },
    );
    expect(done.success, JSON.stringify(done.error ?? {})).toBe(true);
    expect(await inSchool(OAK, () => CoCurricularActivity.countDocuments({ _id: made.id }))).toBe(0);
  }, 60000);

  it('withdraws the caller\'s own profile-correction request, once confirmed', async () => {
    const made = await inSchool(OAK, () => profileEdit.request(priyaActor(), {
      changes: { address: '5 Hill Road' },
    }));
    const { done } = await proposeAndConfirm(
      OAK, student().actor, 'cancel_profile_edit_request', { requestId: made.id },
    );
    expect(done.success, JSON.stringify(done.error ?? {})).toBe(true);
    expect(await inSchool(OAK, () => ProfileEditRequest.countDocuments({ _id: made.id }))).toBe(0);
  }, 60000);
});

describe('a withdrawal cannot reach anybody else\'s request', () => {
  it('refuses another student\'s book request', async () => {
    const theirs = await inSchool(OAK, () => BookRequest.create({
      bookId: new mongoose.Types.ObjectId(), studentId: school.aman.student._id, status: 'PENDING',
    }));
    const { proposal, done } = await proposeAndConfirm(
      OAK, student().actor, 'cancel_book_request', { requestId: String(theirs._id) },
    );
    expect((done ?? proposal).success).toBe(false);
    expect((await inSchool(OAK, () => BookRequest.findById(theirs._id).lean())).status).toBe('PENDING');
  }, 60000);

  it('refuses a co-curricular request belonging to someone else', async () => {
    const theirs = await inSchool(OAK, () => CoCurricularActivity.create({
      studentId: school.aman.student._id, name: 'Chess club',
      activityDate: new Date('2026-08-01'), status: 'PENDING',
    }));
    const { proposal, done } = await proposeAndConfirm(
      OAK, student().actor, 'cancel_cocurricular_request', { requestId: String(theirs._id) },
    );
    expect((done ?? proposal).success).toBe(false);
    expect(await inSchool(OAK, () => CoCurricularActivity.countDocuments({ _id: theirs._id }))).toBe(1);
  }, 60000);

  it('refuses a profile-correction request belonging to someone else', async () => {
    const theirs = await inSchool(OAK, () => ProfileEditRequest.create({
      studentId: school.aman.student._id,
      changes: [{ field: 'address', label: 'Address', oldValue: null, newValue: 'Elsewhere' }],
      status: 'PENDING',
    }));
    const { proposal, done } = await proposeAndConfirm(
      OAK, student().actor, 'cancel_profile_edit_request', { requestId: String(theirs._id) },
    );
    expect((done ?? proposal).success).toBe(false);
    expect(await inSchool(OAK, () => ProfileEditRequest.countDocuments({ _id: theirs._id }))).toBe(1);
  }, 60000);

  it('refuses a transport request from another school', async () => {
    const theirs = await inSchool(RIVER, () => TransportRequest.create({
      studentId: school.river.student._id, routeId: new mongoose.Types.ObjectId(),
      stopId: new mongoose.Types.ObjectId(), academicYearId: school.river.year._id, status: 'PENDING',
    }));
    const { proposal, done } = await proposeAndConfirm(
      OAK, student().actor, 'cancel_transport_request', { requestId: String(theirs._id) },
    );
    expect((done ?? proposal).success).toBe(false);
    expect((await inSchool(RIVER, () => TransportRequest.findById(theirs._id).lean())).status).toBe('PENDING');
  }, 60000);

  it('preserves the workflow rule: a decided request cannot be withdrawn', async () => {
    const made = await inSchool(OAK, () => cocurricular.request(priyaActor(), {
      name: 'Quiz', activityDate: '2026-08-03',
    }));
    await inSchool(OAK, () => CoCurricularActivity.findByIdAndUpdate(made.id, { status: 'APPROVED' }));

    const { proposal, done } = await proposeAndConfirm(
      OAK, student().actor, 'cancel_cocurricular_request', { requestId: made.id },
    );
    expect((done ?? proposal).success).toBe(false);
    expect((await inSchool(OAK, () => CoCurricularActivity.findById(made.id).lean())).status).toBe('APPROVED');
  }, 60000);

  it('names no person, accepts nothing undeclared, and is confirmed', () => {
    // The property is that a withdrawal cannot be pointed at somebody else --
    // not that its schema has exactly one key. It now also accepts a hint at
    // WHICH of the caller's own pending requests is meant ("my football
    // activity request"), because the request id is an ObjectId nobody types
    // and requiring one made these unreachable from a sentence. That hint
    // filters a list the service already scoped to the caller, so it cannot
    // reach another person's request; an identity argument could, and there is
    // none.
    const IDENTITY = ['studentId', 'admissionNo', 'studentName', 'profileId', 'accountId', 'userId'];
    for (const name of [
      'cancel_book_request', 'cancel_transport_request',
      'cancel_cocurricular_request', 'cancel_profile_edit_request',
    ]) {
      const properties = Object.keys(MCP_TOOLS[name].inputSchema.properties);
      expect(properties, name).toContain('requestId');
      expect(properties.filter((p) => IDENTITY.includes(p)), name).toEqual([]);
      expect(MCP_TOOLS[name].inputSchema.required ?? [], `${name} must not demand an id nobody types`).toEqual([]);
      expect(MCP_TOOLS[name].inputSchema.additionalProperties, name).toBe(false);
      expect(Boolean(MCP_TOOLS[name].confirm), name).toBe(true);
    }
  });
});

/* ── The student's own profile-edit requests ──────────────── */

describe('a student can list their own profile-correction requests', () => {
  it('returns their own, and only their own', async () => {
    await inSchool(OAK, () => profileEdit.request(priyaActor(), { changes: { address: '5 Hill Road' } }));
    await inSchool(OAK, () => ProfileEditRequest.create({
      studentId: school.aman.student._id,
      changes: [{ field: 'address', label: 'Address', oldValue: null, newValue: 'Somewhere else' }],
      status: 'PENDING',
    }));

    const res = await mcp(OAK, student().actor, 'get_my_profile_edit_requests', {});
    expect(res.success, JSON.stringify(res.error ?? {})).toBe(true);
    expect(res.data.count).toBe(1);
    expect(JSON.stringify(res.data)).not.toMatch(/Somewhere else/);
  }, 60000);

  it('takes no studentId argument at all', () => {
    expect(Object.keys(MCP_TOOLS.get_my_profile_edit_requests.inputSchema.properties ?? {})).toEqual([]);
    expect(MCP_TOOLS.get_my_profile_edit_requests.operation).toBe('GET');
  });
});

/* ── Fee configuration ────────────────────────────────────── */

describe('fee configuration is reachable, and only safely', () => {
  it('is offered to the roles that hold it on the web, and no others', () => {
    for (const role of ['ADMIN', 'FINANCE']) {
      const names = mcpToolsFor(school.people[role].actor).map((t) => t.name);
      expect(names, role).toContain('create_fee_head');
      expect(names, role).toContain('create_fee_structure');
    }
    for (const role of ['PRINCIPAL', 'TEACHER', 'PARENT', 'STUDENT', 'LIBRARIAN', 'WARDEN']) {
      const names = mcpToolsFor(school.people[role].actor).map((t) => t.name);
      expect(names, role).not.toContain('create_fee_head');
      expect(names, role).not.toContain('create_fee_structure');
    }
  });

  it('creates a fee head, confirmed, and audits who did it', async () => {
    const { proposal, done } = await proposeAndConfirm(
      OAK, school.people.FINANCE.actor, 'create_fee_head', { name: 'Laboratory' },
    );
    expect(proposal.action?.status).toBe('confirmation_required');
    expect(done.success, JSON.stringify(done.error ?? {})).toBe(true);
    expect(await inSchool(OAK, () => FeeHead.countDocuments({ name: 'Laboratory' }))).toBe(1);

    const entry = await inSchool(OAK, () => AuditLog.findOne({ action: 'agent.create_fee_head' }).lean());
    expect(entry, 'no audit entry for the fee head').toBeTruthy();
    expect(String(entry.actorProfileId)).toBe(String(school.people.FINANCE.profile._id));
  }, 60000);

  it('creates a fee structure, confirmed, against this school\'s own year', async () => {
    const head = await inSchool(OAK, () => FeeHead.create({ name: 'Tuition' }));
    const { done } = await proposeAndConfirm(OAK, school.people.FINANCE.actor, 'create_fee_structure', {
      feeHeadId: String(head._id), academicYearId: String(school.year._id),
      name: 'Tuition — Term 1', amountPaise: 400000, dueOn: '2026-12-01',
    });
    expect(done.success, JSON.stringify(done.error ?? {})).toBe(true);

    const row = await inSchool(OAK, () => FeeStructure.findOne({ name: 'Tuition — Term 1' }).lean());
    expect(row.amountPaise).toBe(400000);
    expect(String(row.academicYearId)).toBe(String(school.year._id));
    expect(row.gradeId).toBeNull();
  }, 60000);

  it('refuses a duplicate fee head at the proposal, before anyone confirms', async () => {
    await inSchool(OAK, () => FeeHead.create({ name: 'Tuition' }));
    const res = await mcp(OAK, school.people.FINANCE.actor, 'create_fee_head', { name: 'Tuition' });
    expect(res.success).toBe(false);
    expect(res.action?.status).not.toBe('confirmation_required');
    expect(await inSchool(OAK, () => FeeHead.countDocuments({ name: 'Tuition' }))).toBe(1);
  }, 60000);

  it('refuses an unknown or identity-shaped field instead of writing it', async () => {
    const res = await mcp(OAK, school.people.FINANCE.actor, 'create_fee_head', {
      name: 'Sports', category: 'TUITION', somethingElse: 1,
    });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('INVALID_INPUT');
    expect(await inSchool(OAK, () => FeeHead.countDocuments({ name: 'Sports' }))).toBe(0);
  }, 60000);

  it('refuses it to every role without the permission', async () => {
    for (const role of ['PRINCIPAL', 'TEACHER', 'STUDENT', 'PARENT', 'LIBRARIAN', 'WARDEN']) {
      const res = await mcp(OAK, school.people[role].actor, 'create_fee_head', { name: `From ${role}` });
      expect(res.success, role).toBe(false);
      expect(['FORBIDDEN', 'FORBIDDEN_SCOPE'], role).toContain(res.error?.code);
    }
    expect(await inSchool(OAK, () => FeeHead.countDocuments({}))).toBe(0);
  }, 60000);

  it('refuses a structure referencing another school\'s year or grade, at the proposal', async () => {
    const head = await inSchool(OAK, () => FeeHead.create({ name: 'Tuition' }));
    const foreignGrade = await inSchool(RIVER, () => Grade.create({ name: 'Class 9', level: 9 }));

    for (const args of [
      { academicYearId: String(school.river.year._id) },
      { academicYearId: String(school.year._id), gradeId: String(foreignGrade._id) },
    ]) {
      const res = await mcp(OAK, school.people.FINANCE.actor, 'create_fee_structure', {
        feeHeadId: String(head._id),
        ...args,
        name: 'Foreign reference', amountPaise: 100000, dueOn: '2026-12-01',
      });
      // prepare() resolves the references, so this never reaches a person.
      expect(res.success, JSON.stringify(args)).toBe(false);
      expect(res.action?.status).not.toBe('confirmation_required');
    }
    expect(await inSchool(OAK, () => FeeStructure.countDocuments({ name: 'Foreign reference' }))).toBe(0);
  }, 60000);

  it('rejects a non-positive or fractional amount', async () => {
    const head = await inSchool(OAK, () => FeeHead.create({ name: 'Tuition' }));
    for (const amountPaise of [0, -500, 1.5]) {
      const res = await mcp(OAK, school.people.FINANCE.actor, 'create_fee_structure', {
        feeHeadId: String(head._id), academicYearId: String(school.year._id),
        name: 'Bad amount', amountPaise, dueOn: '2026-12-01',
      });
      expect(res.success, String(amountPaise)).toBe(false);
    }
    expect(await inSchool(OAK, () => FeeStructure.countDocuments({ name: 'Bad amount' }))).toBe(0);
  }, 60000);

  it('cannot be aimed at another school by argument', async () => {
    const head = await inSchool(OAK, () => FeeHead.create({ name: 'Tuition' }));
    const res = await mcp(OAK, school.people.FINANCE.actor, 'create_fee_structure', {
      feeHeadId: String(head._id), academicYearId: String(school.year._id),
      name: 'Tenant injection', amountPaise: 100000, dueOn: '2026-12-01',
      tenantId: RIVER,
    });
    // tenantId is neither a declared property nor readable: the schema is
    // closed and the server strips identity-shaped arguments regardless.
    expect(res.success).toBe(false);
    expect(await inSchool(RIVER, () => FeeStructure.countDocuments({ name: 'Tenant injection' }))).toBe(0);
    expect(await inSchool(OAK, () => FeeStructure.countDocuments({ name: 'Tenant injection' }))).toBe(0);
  }, 60000);
});
