import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { TransportRoute, TransportStop, BusEnrollment } from '../src/models/transport.model.js';
import { Document } from '../src/models/document.model.js';
import { AgentAction } from '../src/models/agentAction.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import * as transport from '../src/modules/transport/transport.service.js';
import { confirmAction } from '../src/modules/ai/agent/orchestrator.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { seedSchool, mcp, proposeAndConfirm, inSchool, OAK, RIVER } from './support/mcpSchool.js';

/**
 * The transport and document writes, performed through MCP for real.
 *
 * Until this pass these tools were only probed for authorization. Each is now
 * proposed, confirmed, executed and audited, and each check reads the
 * database — the route exists, the stop is on it, the student rides it, the
 * document is gone — and the MCP server's own audit entry for the call.
 */

let school;
beforeEach(async () => {
  school = await seedSchool();
});
afterAll(async () => {
  await resetMcpClient();
});

const executedAudit = (tool) => inSchool(OAK, () => AuditLog.findOne({
  action: `agent.${tool}`, 'after.status': 'EXECUTED', 'after.via': 'MCP',
}).sort({ createdAt: -1 }).lean());

const countIn = (tenant, Model, filter = {}) => inSchool(tenant, () => Model.countDocuments(filter));

/** A route with stops, built through the service the REST API uses. */
async function routeWithStops(name, stopNames) {
  return inSchool(OAK, async () => {
    const route = await transport.createRoute({ name });
    const stops = [];
    for (const [i, stopName] of stopNames.entries()) {
      stops.push(await transport.createStop({ routeId: route._id, name: stopName, sequenceNo: i + 1 }));
    }
    return { route, stops };
  });
}

/* ── Transport ────────────────────────────────────────────── */

describe('transport writes run through MCP', () => {
  it('creates a route, adds a stop and enrols a student — each proposed, confirmed, written and audited', async () => {
    const admin = school.people.ADMIN.actor;

    const route = await proposeAndConfirm(OAK, admin, 'create_transport_route', { name: 'Route 4', vehicleNo: 'MH12AB1234', driverName: 'Ramesh' });
    expect(route.proposal.action.summary).toBe('Create bus route "Route 4" (MH12AB1234)');
    expect(route.done.success, JSON.stringify(route.done.error)).toBe(true);
    const routeId = route.done.data.routeId;
    expect(await countIn(OAK, TransportRoute, { name: 'Route 4' })).toBe(1);
    expect((await executedAudit('create_transport_route')).after.confirmed).toBe(true);

    const stop = await proposeAndConfirm(OAK, admin, 'create_transport_stop', { routeId, name: 'Gandhi Nagar', sequenceNo: 1 });
    expect(stop.proposal.action.summary).toBe('Add stop "Gandhi Nagar" as stop 1 on route "Route 4"');
    const stopId = stop.done.data.stopId;
    expect(await countIn(OAK, TransportStop, { routeId })).toBe(1);

    const enrol = await proposeAndConfirm(OAK, admin, 'enroll_in_transport', { admissionNo: 'OAK-1', routeId, stopId });
    expect(enrol.proposal.action.summary).toBe('Enrol Rahul Sharma on route "Route 4" at stop "Gandhi Nagar" for 2026-27');
    expect(enrol.done.data).toMatchObject({ student: 'Rahul Sharma', route: 'Route 4', stop: 'Gandhi Nagar', direction: 'BOTH' });

    const bus = await inSchool(OAK, () => BusEnrollment.findOne({ studentId: school.rahul.student._id }).lean());
    expect(String(bus.routeId)).toBe(routeId);
    expect(String(bus.stopId)).toBe(stopId);

    const audit = await executedAudit('enroll_in_transport');
    expect(audit.before).toEqual({ route: null });
    expect(audit.after.state).toMatchObject({ route: 'Route 4', stop: 'Gandhi Nagar', direction: 'BOTH' });
  });

  it('moving a student to another stop keeps one enrolment, and the audit keeps where they were', async () => {
    const { route, stops } = await routeWithStops('Route 7', ['Market', 'Temple']);
    await inSchool(OAK, () => transport.enrollStudent({ studentId: school.rahul.student._id, routeId: route._id, stopId: stops[0]._id }));

    const { done } = await proposeAndConfirm(OAK, school.people.ADMIN.actor, 'enroll_in_transport', {
      admissionNo: 'OAK-1', routeId: String(route._id), stopId: String(stops[1]._id),
    });
    expect(done.success).toBe(true);
    expect(await countIn(OAK, BusEnrollment, { studentId: school.rahul.student._id })).toBe(1);
    const audit = await executedAudit('enroll_in_transport');
    expect(audit.before.stop).toBe('Market');
    expect(audit.after.state.stop).toBe('Temple');
  });

  it("refuses a stop on another school's route before anyone is asked to confirm", async () => {
    const riverRoute = await inSchool(RIVER, () => TransportRoute.create({ name: 'River 1' }));
    const res = await mcp(OAK, school.people.ADMIN.actor, 'create_transport_stop', { routeId: String(riverRoute._id), name: 'X', sequenceNo: 1 });
    expect(res.error.code).toBe('NOT_FOUND');
    expect(await countIn(OAK, AgentAction)).toBe(0);
    expect(await countIn(OAK, TransportStop)).toBe(0);
    expect(await countIn(RIVER, TransportStop)).toBe(0);
  });

  it('refuses to enrol a student at a stop that belongs to a different route', async () => {
    const a = await routeWithStops('Route A', ['A1']);
    const b = await routeWithStops('Route B', ['B1']);
    const res = await mcp(OAK, school.people.ADMIN.actor, 'enroll_in_transport', {
      admissionNo: 'OAK-1', routeId: String(b.route._id), stopId: String(a.stops[0]._id),
    });
    expect(res.error.code).toBe('INVALID_INPUT');
    expect(res.error.message).toBe('"A1" is not a stop on route "Route B"');
    expect(await countIn(OAK, BusEnrollment)).toBe(0);
  });

  it("the service refuses the same for the REST routes — it is one implementation", async () => {
    const riverRoute = await inSchool(RIVER, () => TransportRoute.create({ name: 'River 2' }));
    await expect(inSchool(OAK, () => transport.createStop({ routeId: riverRoute._id, name: 'X', sequenceNo: 1 })))
      .rejects.toMatchObject({ statusCode: 404 });
    const riverStop = await inSchool(RIVER, () => TransportStop.create({ routeId: riverRoute._id, name: 'R1', sequenceNo: 1 }));
    await expect(inSchool(OAK, () => transport.enrollStudent({
      studentId: school.rahul.student._id, routeId: riverRoute._id, stopId: riverStop._id,
    }))).rejects.toMatchObject({ statusCode: 404 });
    expect(await countIn(OAK, BusEnrollment)).toBe(0);
  });

  it('is refused to every role that does not manage transport', async () => {
    const { route, stops } = await routeWithStops('Route 9', ['Depot']);
    for (const [roleKey, person] of Object.entries(school.people)) {
      if (roleKey === 'RIVER_ADMIN' || person.actor.permissions['transport.manage'] === 'ALL') continue;
      const res = await mcp(OAK, person.actor, 'enroll_in_transport', {
        admissionNo: 'OAK-1', routeId: String(route._id), stopId: String(stops[0]._id),
      });
      expect(['FORBIDDEN', 'FORBIDDEN_SCOPE'], `${roleKey}: ${res.error?.code}`).toContain(res.error?.code);
    }
    expect(await countIn(OAK, BusEnrollment)).toBe(0);
    expect(await countIn(OAK, AgentAction)).toBe(0);
  });
});

/* ── Documents ────────────────────────────────────────────── */

describe('delete_document runs through MCP', () => {
  const publish = (tenant, authorProfileId, title, extra = {}) => inSchool(tenant, () => Document.create({
    title, type: 'REPORT_CARD', fileUrl: '/uploads/report.pdf', authorProfileId, visibleToRoles: ['PARENT'], ...extra,
  }));

  it('names the document, waits for confirmation, deletes it and audits what it was', async () => {
    const admin = school.people.ADMIN.actor;
    const doc = await publish(OAK, school.people.ADMIN.profile._id, 'Term 1 report card — Rahul', { studentId: school.rahul.student._id });

    const proposal = await mcp(OAK, admin, 'delete_document', { documentId: String(doc._id) });
    expect(proposal.action.status).toBe('confirmation_required');
    expect(proposal.action.summary).toBe('Permanently delete the report card "Term 1 report card — Rahul" — this cannot be undone');
    expect(proposal.action.risk).toBe('HIGH');
    expect(await countIn(OAK, Document)).toBe(1);

    const done = await mcp(OAK, admin, 'delete_document', {}, { confirmationToken: proposal.action.confirmationToken });
    expect(done.success).toBe(true);
    expect(await countIn(OAK, Document)).toBe(0);

    const audit = await executedAudit('delete_document');
    expect(audit.before).toMatchObject({ exists: true, title: 'Term 1 report card — Rahul', type: 'REPORT_CARD', studentId: String(school.rahul.student._id) });
    expect(audit.after.state).toEqual({ exists: false });
    expect(audit.after.confirmed).toBe(true);
  });

  it('lets a teacher delete what they uploaded, and refuses what they did not — before asking', async () => {
    const teacher = school.people.TEACHER.actor;
    expect(teacher.permissions['materials.manage']).toBe('OWN');
    const own = await publish(OAK, school.people.TEACHER.profile._id, 'Fractions notes', { type: 'CUSTOM' });
    const others = await publish(OAK, school.people.ADMIN.profile._id, 'Admission letter');

    const refused = await mcp(OAK, teacher, 'delete_document', { documentId: String(others._id) });
    expect(refused.error.code).toBe('FORBIDDEN');
    expect(await countIn(OAK, AgentAction)).toBe(0);

    const { done } = await proposeAndConfirm(OAK, teacher, 'delete_document', { documentId: String(own._id) });
    expect(done.success).toBe(true);
    expect(await inSchool(OAK, () => Document.findById(own._id).lean())).toBeNull();
    expect(await inSchool(OAK, () => Document.findById(others._id).lean())).not.toBeNull();
  });

  it("cannot find another school's document", async () => {
    const riverDoc = await publish(RIVER, school.people.RIVER_ADMIN.profile._id, 'River report');
    const res = await mcp(OAK, school.people.ADMIN.actor, 'delete_document', { documentId: String(riverDoc._id) });
    expect(res.error.code).toBe('NOT_FOUND');
    expect(await countIn(RIVER, Document)).toBe(1);
  });

  it('is refused to roles without materials.manage', async () => {
    const doc = await publish(OAK, school.people.ADMIN.profile._id, 'Circular');
    for (const [roleKey, person] of Object.entries(school.people)) {
      if (roleKey === 'RIVER_ADMIN' || person.actor.permissions['materials.manage']) continue;
      const res = await mcp(OAK, person.actor, 'delete_document', { documentId: String(doc._id) });
      expect(res.error?.code, roleKey).toBe('FORBIDDEN');
    }
    expect(await countIn(OAK, Document)).toBe(1);
  });

  it('a "no" leaves the document where it was', async () => {
    const admin = school.people.ADMIN.actor;
    const doc = await publish(OAK, school.people.ADMIN.profile._id, 'Keep me');
    const proposal = await mcp(OAK, admin, 'delete_document', { documentId: String(doc._id) });
    const declined = await inSchool(OAK, () => confirmAction({ confirmToken: proposal.action.confirmationToken, actor: admin, accept: false }));
    expect(declined.executed).toBe(false);
    expect(await countIn(OAK, Document)).toBe(1);
    expect((await inSchool(OAK, () => AgentAction.findById(proposal.action.id).lean())).status).toBe('REJECTED');
  });
});

/* ── Fee-plan workflow ────────────────────────────────────── */

describe('transition_fee_plan checks the step before anyone is asked', () => {
  // The tool is reachable with fees.read, as its REST route is; each step's
  // own permission (request / review / approve) is enforced by plan.service.
  async function planAwaitingApproval() {
    const { FeePlan } = await import('../src/models/fee.model.js');
    const plan = await inSchool(OAK, () => FeePlan.create({
      enrollmentId: school.rahul.enrollment._id,
      studentId: school.rahul.student._id,
      academicYearId: school.year._id,
      name: 'Rahul — 3 installments',
      totalPaise: 900000,
      mode: 'INSTALLMENT',
      status: 'PENDING_ADMIN_APPROVAL',
      installments: [1, 2, 3].map((seq) => ({ seq, amountPaise: 300000, dueOn: new Date(Date.now() + seq * 30 * 86_400_000) })),
    }));
    const status = () => inSchool(OAK, () => FeePlan.findById(plan._id).lean()).then((p) => p.status);
    return { plan, status };
  }

  it('finance may not approve: refused at once, with no proposal and no change', async () => {
    const { plan, status } = await planAwaitingApproval();
    const finance = school.people.FINANCE.actor;
    expect(finance.permissions['fees.plan.approve']).toBeUndefined();
    const res = await mcp(OAK, finance, 'transition_fee_plan', { planId: String(plan._id), step: 'approve' });
    expect(res.error.code).toBe('FORBIDDEN');
    expect(await countIn(OAK, AgentAction)).toBe(0);
    expect(await status()).toBe('PENDING_ADMIN_APPROVAL');
  });

  it('an administrator approves after a prompt that names the plan and the change', async () => {
    const { plan, status } = await planAwaitingApproval();
    const { proposal, done } = await proposeAndConfirm(OAK, school.people.ADMIN.actor, 'transition_fee_plan', {
      planId: String(plan._id), step: 'approve',
    });
    expect(proposal.action.summary).toBe('Approve fee plan "Rahul — 3 installments" (PENDING_ADMIN_APPROVAL → APPROVED)');
    expect(done.success, JSON.stringify(done.error)).toBe(true);
    expect(await status()).toBe('APPROVED');
    expect((await executedAudit('transition_fee_plan')).after.confirmed).toBe(true);
  });

  it('a step the plan is not ready for is refused before confirmation, as a conflict', async () => {
    const { plan, status } = await planAwaitingApproval();
    const res = await mcp(OAK, school.people.ADMIN.actor, 'transition_fee_plan', { planId: String(plan._id), step: 'submit' });
    expect(res.error.code).toBe('CONFLICT');
    expect(await countIn(OAK, AgentAction)).toBe(0);
    expect(await status()).toBe('PENDING_ADMIN_APPROVAL');
  });
});
