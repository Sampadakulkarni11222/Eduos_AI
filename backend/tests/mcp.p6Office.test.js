import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { MCP_TOOLS, mcpToolsFor, confirmableOn, validateMcpRegistry } from '../src/modules/ai/mcp/registry.js';
import { tools as officeTools } from '../src/modules/ai/mcp/tools/p6/office.js';
import { isDecidingToolName } from '../src/modules/ai/mcp/decisions.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { School } from '../src/models/school.model.js';
import { DocumentType, DocumentRequest } from '../src/models/documentRequest.model.js';
import { ApprovalRequest, ApprovalPolicy, ApprovalDelegation } from '../src/models/approval.model.js';
import { Correspondence, InstitutionEvent, Contract } from '../src/models/administration.model.js';
import { Facility, FacilityBooking, WorkOrder } from '../src/models/facility.model.js';
import { BoardMeeting } from '../src/models/governance.model.js';
import { AlumniOpportunity } from '../src/models/alumniOpportunity.model.js';
import { SchoolPolicy } from '../src/models/schoolPolicy.model.js';
import * as docRequests from '../src/modules/documentRequests/documentRequest.service.js';
import * as correspondence from '../src/modules/administration/correspondence.service.js';
import * as facilities from '../src/modules/administration/facility.service.js';
import * as governance from '../src/modules/governance/governance.service.js';
import { inSchool, mcp, actorForRole, OAK } from './support/mcpSchool.js';
import { seedFamilySchool, ymdIn } from './support/familySchool.js';

/**
 * Part-6 office coverage (tools/p6/office.js): document requests and types,
 * approvals, messaging, institution settings, correspondence, facilities,
 * events and agreements, governance and the alumni coordinator's board. Every
 * write is a draft that changes nothing until the same person confirms it, and
 * runs through the module's own service.
 */
const NAMES = Object.keys(officeTools);
const DECISIONS = ['record_document_request_decision', 'record_facility_booking_decision', 'record_board_minutes_approval', 'record_alumni_offer_decision'];
let s;
const inOak = (fn) => inSchool(OAK, fn);

async function confirm(actor, name, args, { unchanged } = {}) {
  const proposal = await mcp(OAK, actor, name, args);
  expect(proposal.success, `${name}: ${JSON.stringify(proposal.error)}`).toBe(true);
  expect(proposal.action.status, name).toBe('confirmation_required');
  if (unchanged) expect(await unchanged()).toBe(true);
  const done = await mcp(OAK, actor, name, {}, { confirmationToken: proposal.action.confirmationToken });
  expect(done.success, `${name}: ${JSON.stringify(done.error)}`).toBe(true);
  return { proposal, done };
}
async function read(actor, name, args = {}) {
  const r = await mcp(OAK, actor, name, args);
  expect(r.success, `${name}: ${JSON.stringify(r.error)}`).toBe(true);
  return r;
}

beforeEach(async () => {
  s = await seedFamilySchool();
  await School.create({ slug: OAK, name: 'Oakridge Academy' });
});
afterAll(async () => { await resetMcpClient(); });

describe('the contract', () => {
  it('registers closed, non-deciding tools; writes confirm and summarise; decisions are approver-confirmed; the boot check passes', () => {
    expect(NAMES.length).toBe(75);
    for (const n of NAMES) {
      const t = MCP_TOOLS[n];
      expect(t, n).toBeTruthy();
      expect(t.inputSchema.additionalProperties, n).toBe(false);
      expect(isDecidingToolName(n), n).toBe(false);
      if (t.operation !== 'GET') {
        expect(t.confirm, n).toBe(true);
        expect(typeof t.summarise, n).toBe('function');
        expect(typeof t.summarise({}, {}, undefined), n).toBe('string');
      } else {
        expect(/^(get|list|search)_/.test(n), n).toBe(true);
      }
      if (t.affectsOthers || t.risk === 'HIGH') expect(confirmableOn(t, 'WHATSAPP'), n).toBe(false);
    }
    for (const n of DECISIONS) {
      const t = MCP_TOOLS[n];
      expect(t.approverDecision, n).toBe(true);
      expect(t.risk, n).toBe('HIGH');
      expect(t.affectsOthers, n).toBe(true);
      expect(t.inputSchema.required, n).toContain('decision');
      expect(t.inputSchema.properties.decision.default, n).toBeUndefined();
    }
    expect(validateMcpRegistry()).toEqual([]);
  });

  it('shows each role only what its routes allow', () => {
    const visible = (role) => mcpToolsFor(actorForRole(role)).map((t) => t.name).filter((n) => NAMES.includes(n));
    const parent = visible('PARENT');
    expect(parent).toEqual(expect.arrayContaining(['get_my_document_request', 'get_my_message_preferences', 'get_institution_terminology']));
    for (const n of ['get_document_request', 'record_document_request_decision', 'list_approval_requests', 'set_module_switches', 'get_my_alumni_document_request']) expect(parent, n).not.toContain(n);
    expect(visible('ALUMNUS')).toContain('get_my_alumni_document_request');
    expect(visible('ALUMNUS')).not.toContain('get_my_document_request');
    expect(visible('HR')).toContain('list_alumni_offers_for_school');
    expect(visible('TEACHER')).toEqual(expect.arrayContaining(['submit_approval_request', 'propose_fest_plan', 'cancel_facility_booking']));
    expect(visible('TEACHER')).not.toContain('record_facility_booking_decision');
    expect(visible('TRUSTEE')).toContain('record_board_minutes_approval');
  });
});

describe('document requests and types', () => {
  it('the office configures a type, reads a family request, starts review and records the decision; a family reads its own', async () => {
    const admin = s.people.ADMIN.actor;
    await confirm(admin, 'create_document_type', { name: 'Bonafide Certificate', instructions: 'Say what it is for' }, { unchanged: async () => (await inOak(() => DocumentType.countDocuments())) === 0 });
    const types = await read(admin, 'list_document_types');
    expect(types.data.items.map((t) => t.name)).toContain('Bonafide Certificate');
    await confirm(admin, 'update_document_type', { documentType: 'Bonafide', instructions: 'State the purpose' });
    expect((await inOak(() => DocumentType.findOne().lean())).instructions).toBe('State the purpose');

    const type = await inOak(() => DocumentType.findOne().lean());
    await inOak(() => docRequests.createRequest(s.people.PARENT.actor, { documentTypeId: String(type._id), purpose: 'Bank account', studentId: String(s.rahul.student._id) }));

    const mine = await read(s.people.PARENT.actor, 'get_my_document_request', { document: 'bonafide' });
    expect(mine.data.status).toBe('PENDING');
    const office = await read(admin, 'get_document_request', { studentName: 'Rahul' });
    expect(office.data.purpose).toBe('Bank account');

    // A teacher holds no office scope.
    expect((await mcp(OAK, s.people.TEACHER.actor, 'get_document_request', { studentName: 'Rahul' })).success).toBe(false);

    await confirm(admin, 'start_document_request_review', { studentName: 'Rahul' }, { unchanged: async () => (await inOak(() => DocumentRequest.findOne().lean())).status === 'PENDING' });
    const preview = await read(admin, 'get_certificate_preview', { studentName: 'Rahul' });
    expect(preview.data.title).toBeTruthy();
    // The decision is never assumed.
    expect((await mcp(OAK, admin, 'record_document_request_decision', { studentName: 'Rahul' })).success).toBe(false);
    await confirm(admin, 'record_document_request_decision', { studentName: 'Rahul', decision: 'APPROVE', reason: 'Fine' });
    expect((await inOak(() => DocumentRequest.findOne().lean())).status).toBe('APPROVED');

    await confirm(admin, 'add_suggested_document_types', {});
    expect(await inOak(() => DocumentType.countDocuments())).toBeGreaterThan(1);
    await confirm(admin, 'delete_document_type', { documentType: 'Character Certificate' });
    expect(await inOak(() => DocumentType.countDocuments({ name: 'Character Certificate' }))).toBe(0);
  }, 90_000);

  it('a decision lands on a family, so WhatsApp hands it to the website', async () => {
    const type = await inOak(() => DocumentType.create({ name: 'Study Certificate', isActive: true, requestEnabled: true }));
    await inOak(() => docRequests.createRequest(s.people.PARENT.actor, { documentTypeId: String(type._id), purpose: 'Visa', studentId: String(s.rahul.student._id) }));
    const r = await mcp(OAK, s.people.ADMIN.actor, 'record_document_request_decision', { studentName: 'Rahul', decision: 'APPROVE' }, { channel: 'WHATSAPP' });
    expect(r.success).toBe(false);
    expect(r.error.details?.reason ?? r.error.reason ?? JSON.stringify(r.error)).toMatch(/CONFIRM_ON_WEB/);
    expect((await inOak(() => DocumentRequest.findOne().lean())).status).toBe('PENDING');
  }, 60_000);
});

describe('approvals', () => {
  it('a teacher raises and withdraws a request; the principal sets a route and delegates', async () => {
    const T = s.people.TEACHER.actor;
    await confirm(T, 'submit_approval_request', { category: 'TRAVEL', title: 'Science olympiad travel', amountRupees: 4500 }, { unchanged: async () => (await inOak(() => ApprovalRequest.countDocuments())) === 0 });
    const reg = await read(T, 'list_approval_requests', { mine: true });
    expect(reg.data.items[0].title).toBe('Science olympiad travel');
    const one = await read(T, 'get_approval_request', { request: 'olympiad' });
    expect(one.data.status).toBe('PENDING');
    await read(s.people.PRINCIPAL.actor, 'get_approvals_summary');
    await confirm(T, 'update_my_approval_request', { request: 'olympiad', step: 'WITHDRAW', note: 'Event postponed' });
    expect((await inOak(() => ApprovalRequest.findOne().lean())).status).toBe('WITHDRAWN');

    const P = s.people.PRINCIPAL.actor;
    await confirm(P, 'configure_approval_policy', { category: 'TRAVEL', step: 'SET', stages: [{ name: 'Principal', approverRole: 'PRINCIPAL', fromRupees: 0 }], dueDays: 4 });
    expect((await inOak(() => ApprovalPolicy.findOne({ category: 'TRAVEL' }).lean())).dueDays).toBe(4);
    const pol = await read(P, 'list_approval_policies', { category: 'TRAVEL' });
    expect(pol.data.items[0].custom).toBe(true);

    await confirm(P, 'delegate_approvals', { to: 'ADMIN user', from: ymdIn(0), until: ymdIn(5), reason: 'Leave' });
    expect(await inOak(() => ApprovalDelegation.countDocuments({ revokedAt: null }))).toBe(1);
    await read(P, 'list_approval_delegations');
    await confirm(P, 'revoke_approval_delegation', { to: 'ADMIN user' });
    expect(await inOak(() => ApprovalDelegation.countDocuments({ revokedAt: null }))).toBe(0);
    // A teacher cannot change a route.
    expect((await mcp(OAK, T, 'configure_approval_policy', { category: 'TRAVEL', step: 'RESET_TO_DEFAULT' })).success).toBe(false);
  }, 90_000);
});

describe('settings', () => {
  it('reads preferences, terminology, modules, profile and theme; switches modules, the profile and single-approver mode', async () => {
    const admin = s.people.ADMIN.actor;
    await read(s.people.PARENT.actor, 'get_my_message_preferences');
    const t = await read(s.people.STUDENT.actor, 'get_institution_terminology');
    expect(t.data.grade).toBe('Class');
    await read(admin, 'list_school_features');
    await read(admin, 'get_messaging_channels');
    await read(admin, 'list_message_outbox');
    await read(admin, 'get_school_theme');
    await read(admin, 'get_school_dropdown', { list: 'house' });
    await read(admin, 'get_single_approver_mode');

    await confirm(admin, 'set_module_switches', { turnOff: ['sustainability'] });
    expect((await School.findOne({ slug: OAK }).lean()).features.sustainability).toBe(false);

    await confirm(admin, 'update_institution_profile', { motto: 'Learn to serve', email: 'office@oak.test' });
    const prof = await read(admin, 'get_institution_profile');
    expect(prof.data.motto).toBe('Learn to serve');
    expect(prof.data.contact.email).toBe('office@oak.test');

    expect((await mcp(OAK, admin, 'set_single_approver_mode', { on: true })).success).toBe(false);
    await confirm(admin, 'set_single_approver_mode', { on: true, reason: 'Only one administrator' });
    expect((await inOak(() => SchoolPolicy.findOne().lean())).singleApproverMode.enabled).toBe(true);
    expect((await mcp(OAK, s.people.TEACHER.actor, 'set_module_switches', { turnOn: ['labs'] })).success).toBe(false);
  }, 90_000);
});

describe('correspondence', () => {
  it('reads a letter and its deadlines, assigns it, moves it along and holds it', async () => {
    const admin = s.people.ADMIN.actor;
    await inOak(() => correspondence.register(admin, { direction: 'INWARD', subject: 'Board circular on fire drills', counterpartyName: 'CBSE', counterpartyType: 'BOARD', summary: 'Schools shall submit the drill report within 15 days.' }));
    const stats = await read(admin, 'get_correspondence_stats');
    expect(stats.data.open).toBe(1);
    const letter = await read(admin, 'get_correspondence_letter', { letter: 'fire drills' });
    expect(letter.data.counterparty).toBe('CBSE');
    const dl = await read(admin, 'get_letter_deadlines', { letter: 'fire drills' });
    expect(dl.data.deadlines.length).toBe(1);
    await confirm(admin, 'assign_correspondence', { letter: 'fire drills', assignees: ['TEACHER user'], dueOn: ymdIn(7) });
    expect((await inOak(() => Correspondence.findOne().lean())).assigneeProfileIds.map(String)).toEqual([String(s.people.TEACHER.profile._id)]);
    await confirm(admin, 'move_correspondence_letter', { letter: 'fire drills', step: 'ACKNOWLEDGE' });
    expect((await inOak(() => Correspondence.findOne().lean())).status).toBe('ACKNOWLEDGED');
    await confirm(admin, 'add_correspondence_reminder', { letter: 'fire drills', on: ymdIn(3) });
    await confirm(admin, 'set_correspondence_legal_hold', { letter: 'fire drills', hold: true });
    expect((await inOak(() => Correspondence.findOne().lean())).legalHold).toBe(true);
  }, 90_000);
});

describe('facilities', () => {
  it('the manager adds a hall, decides a booking and works a repair; the requester cancels their own booking', async () => {
    const admin = s.people.ADMIN.actor;
    await confirm(admin, 'create_facility', { code: 'AUD', name: 'Auditorium', kind: 'AUDITORIUM', capacity: 300, bookable: true }, { unchanged: async () => (await inOak(() => Facility.countDocuments())) === 0 });
    const hall = await inOak(() => Facility.findOne().lean());
    const T = s.people.TEACHER.actor;
    const startsAt = new Date(`${ymdIn(3)}T10:00:00+05:30`);
    await inOak(() => facilities.requestBooking(T, { facilityId: String(hall._id), title: 'Debate final', startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString() }));
    const bookings = await read(admin, 'list_facility_bookings', { status: 'REQUESTED' });
    expect(bookings.data.items[0].title).toBe('Debate final');
    await confirm(admin, 'record_facility_booking_decision', { place: 'Auditorium', decision: 'CONFIRM' });
    expect((await inOak(() => FacilityBooking.findOne().lean())).status).toBe('CONFIRMED');
    await confirm(T, 'cancel_facility_booking', { place: 'Auditorium' });
    expect((await inOak(() => FacilityBooking.findOne().lean())).status).toBe('CANCELLED');

    await inOak(() => facilities.reportIssue(T, { title: 'Projector not working', category: 'IT', facilityId: String(hall._id) }));
    await confirm(admin, 'update_work_order', { workOrder: 'Projector', assignTo: 'ADMIN user', status: 'RESOLVED', resolution: 'Cable replaced' });
    expect((await inOak(() => WorkOrder.findOne().lean())).status).toBe('RESOLVED');
    await confirm(admin, 'update_facility', { facility: 'Auditorium', capacity: 350 });
    expect((await inOak(() => Facility.findById(hall._id).lean())).capacity).toBe(350);
    const st = await read(admin, 'get_facility_stats');
    expect(st.data.openWorkOrders).toBe(0);
  }, 90_000);
});

describe('events and agreements', () => {
  it('a teacher proposes an event and sends it for approval; the office runs an agreement', async () => {
    const T = s.people.TEACHER.actor;
    await confirm(T, 'propose_fest_plan', { title: 'Science fair', kind: 'FEST', date: ymdIn(20), from: '09:00', to: '13:00', venue: 'Main lawn', expectedAttendance: 200, budget: [{ head: 'Stalls', rupees: 5000 }] }, { unchanged: async () => (await inOak(() => InstitutionEvent.countDocuments())) === 0 });
    const ev = await read(T, 'get_fest_plan', { event: 'Science fair' });
    expect(ev.data.budget).toMatch(/5,000/);
    await confirm(T, 'update_fest_plan', { event: 'Science fair', addTasks: [{ title: 'Book chairs' }] });
    expect((await inOak(() => InstitutionEvent.findOne().lean())).tasks.map((x) => x.title)).toEqual(['Book chairs']);
    await confirm(T, 'submit_fest_plan', { event: 'Science fair' });
    expect((await inOak(() => InstitutionEvent.findOne().lean())).status).toBe('PENDING_APPROVAL');

    const admin = s.people.ADMIN.actor;
    await confirm(admin, 'create_agreement', { title: 'Bus contract', kind: 'TRANSPORT', counterparty: 'City Travels', valueRupees: 120000, endsOn: ymdIn(300), drafting: true });
    await confirm(admin, 'update_agreement', { agreement: 'City Travels', legalReviewNote: 'Checked', addObligations: [{ title: 'Monthly fitness certificate' }] });
    const ag = await read(admin, 'get_agreement', { agreement: 'Bus contract' });
    expect(ag.data.obligations).toHaveLength(1);
    await confirm(admin, 'submit_agreement_for_approval', { agreement: 'Bus contract' });
    expect((await inOak(() => Contract.findOne().lean())).status).toBe('AWAITING_APPROVAL');
    const listedRows = await read(admin, 'list_agreements');
    expect(listedRows.data.total).toBe(1);
  }, 90_000);
});

describe('governance', () => {
  it('the secretary records a held meeting and the chair approves its minutes; another meeting is cancelled', async () => {
    const admin = s.people.ADMIN.actor;
    const P = s.people.PRINCIPAL.profile;
    await inOak(() => governance.create(admin, { body: 'SCHOOL_MANAGEMENT_COMMITTEE', title: 'SMC October', scheduledAt: new Date(Date.now() - 3_600_000).toISOString(), memberProfileIds: [String(P._id), String(s.people.ADMIN.profile._id)], memberRoles: { [String(P._id)]: 'CHAIR' } }));
    await inOak(() => governance.create(admin, { body: 'FINANCE_COMMITTEE', title: 'Finance review', scheduledAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), memberProfileIds: [String(P._id)] }));
    const m = await read(admin, 'get_board_meeting', { meeting: 'SMC October' });
    expect(m.data.members).toHaveLength(2);
    await confirm(admin, 'record_board_meeting', { meeting: 'SMC October', present: ['PRINCIPAL user', 'ADMIN user'], minutes: 'Discussed the annual plan.', actions: [{ title: 'Share plan with parents', owner: 'PRINCIPAL user' }] });
    const held = await inOak(() => BoardMeeting.findOne({ title: 'SMC October' }).lean());
    expect(held.status).toBe('HELD');
    expect(held.minutes.status).toBe('DRAFT');
    // Only the chair or the principal approves the minutes.
    expect((await mcp(OAK, admin, 'record_board_minutes_approval', { meeting: 'SMC October', decision: 'APPROVE' })).success).toBe(false);
    await confirm(s.people.PRINCIPAL.actor, 'record_board_minutes_approval', { meeting: 'SMC October', decision: 'APPROVE' });
    expect((await inOak(() => BoardMeeting.findOne({ title: 'SMC October' }).lean())).minutes.status).toBe('APPROVED');
    await confirm(admin, 'cancel_board_meeting', { meeting: 'Finance review', reason: 'Clashes with exams' });
    expect((await inOak(() => BoardMeeting.findOne({ title: 'Finance review' }).lean())).status).toBe('CANCELLED');
  }, 90_000);
});

describe('the alumni coordinator', () => {
  it('posts and closes an offer, and records the publish decision on an alumnus offer', async () => {
    const admin = s.people.ADMIN.actor;
    await confirm(admin, 'add_alumni_opportunity', { kind: 'CAREER_TALK', title: 'Careers in design', description: 'A talk on product design careers.' });
    expect((await inOak(() => AlumniOpportunity.findOne().lean())).status).toBe('PUBLISHED');
    await inOak(() => AlumniOpportunity.create({ kind: 'MENTORING', title: 'Coding mentoring', description: 'Weekly mentoring for seniors.', postedByProfileId: s.people.T4.profile._id, postedByName: 'Old student', status: 'PENDING_REVIEW', audience: 'SENIOR_STUDENTS' }));
    const board = await read(s.people.HR.actor, 'list_alumni_offers_for_school', { status: 'PENDING_REVIEW' });
    expect(board.data.items.map((o) => o.title)).toEqual(['Coding mentoring']);
    await confirm(admin, 'record_alumni_offer_decision', { offer: 'Coding mentoring', decision: 'PUBLISH' });
    expect((await inOak(() => AlumniOpportunity.findOne({ title: 'Coding mentoring' }).lean())).status).toBe('PUBLISHED');
    await confirm(admin, 'close_alumni_opportunity', { offer: 'Coding mentoring' });
    expect((await inOak(() => AlumniOpportunity.findOne({ title: 'Coding mentoring' }).lean())).status).toBe('CLOSED');
  }, 60_000);
});
