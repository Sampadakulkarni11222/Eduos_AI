import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { AgentAction } from '../src/models/agentAction.model.js';
import { Exam } from '../src/models/exam.model.js';
import { Term } from '../src/models/academics.model.js';
import {
  MCP_TOOLS, getMcpTool, mcpToolsFor, mutates, requiresConfirmation, validateMcpRegistry, confirmableOn,
} from '../src/modules/ai/mcp/registry.js';
import {
  isDecidingToolName, decisionAskedFor, humanDecisionReply, HUMAN_DECISIONS,
} from '../src/modules/ai/mcp/decisions.js';
import { latestPendingFor } from '../src/modules/ai/mcp/confirm.js';
import { converse } from '../src/modules/whatsapp/whatsapp.agent.js';
import { runAgent } from '../src/modules/ai/agent/orchestrator.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { seedSchool, inSchool, OAK, mcp, actorForRole } from './support/mcpSchool.js';
import { startApi } from './support/mcpHttp.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';

/**
 * The product rule: the assistant never approves, rejects, publishes, refunds
 * or records money -- a person does that on the screen. And a write is only
 * ever confirmed by a person, on the channel it was proposed on.
 */

/** The naming rule, stated independently of decisions.js so the two cannot drift together. */
const DECIDING = /^(?:approve|reject|decide|review|publish|refund)_|^record_payment$/;

const REMOVED = [
  'approve_payment', 'reject_payment', 'refund_payment', 'decide_payment_change_request', 'publish_fee_plan',
  'publish_marks', 'review_leave', 'decide_registration', 'decide_cocurricular', 'decide_profile_edit',
  'decide_book_request', 'decide_transport_request', 'record_payment',
];

describe('the registry holds no deciding tool', () => {
  it('no executable tool is named approve_/reject_/decide_/review_/publish_/refund_ or record_payment', () => {
    const deciding = Object.keys(MCP_TOOLS).filter((name) => DECIDING.test(name) || isDecidingToolName(name));
    expect(deciding).toEqual([]);
  });

  it('each removed decision is neither resolvable nor listed for any role', () => {
    for (const name of REMOVED) expect(getMcpTool(name), name).toBeNull();
    for (const role of SYSTEM_ROLES) {
      const listed = mcpToolsFor(actorForRole(role.key)).map((t) => t.name);
      expect(listed.filter((n) => DECIDING.test(n)), role.key).toEqual([]);
    }
  });

  it('the boot check passes, so it would catch a deciding tool coming back', () => {
    expect(validateMcpRegistry()).toEqual([]);
  });

  it('transition_fee_plan only passes a plan on; it cannot review, approve or reject', () => {
    const steps = MCP_TOOLS.transition_fee_plan.inputSchema.properties.step.enum;
    expect(steps.sort()).toEqual(['requestApproval', 'submit']);
  });

  it('update_admission_lead cannot admit (ENROLLED) or turn down (LOST) an applicant', () => {
    const stages = MCP_TOOLS.update_admission_lead.inputSchema.properties.stage.enum;
    expect(stages).not.toContain('ENROLLED');
    expect(stages).not.toContain('LOST');
  });

  it('every CREATE needs a person to confirm it', () => {
    const unconfirmed = Object.entries(MCP_TOOLS)
      .filter(([, tool]) => tool.operation === 'CREATE' && !requiresConfirmation(tool, {}))
      .map(([name]) => name);
    expect(unconfirmed).toEqual([]);
    for (const name of ['create_ticket', 'request_cocurricular', 'request_profile_edit', 'request_book', 'request_transport_route', 'create_hostel_inquiry']) {
      expect(MCP_TOOLS[name].confirm, name).toBe(true);
    }
  });

  it('get_pending_items_for_me is a read on approvals.read', () => {
    const tool = MCP_TOOLS.get_pending_items_for_me;
    expect(tool.operation).toBe('GET');
    expect(mutates(tool)).toBe(false);
    expect(tool.permission).toBe('approvals.read');
  });

  it('get_growth_score is school-wide only', () => {
    expect(MCP_TOOLS.get_growth_score.minScope).toBe('ALL');
  });
});

describe('a request for a decision is handed back to the person who decides', () => {
  it.each([
    ['approve the pending payment', 'payment'],
    ['Please approve Rahul\'s leave', 'leave'],
    ['record a payment of Rs 500 against invoice INV-1001', 'payment'],
    ['refund payment 6acf25a9e2d96c1c6c9a7301', 'payment'],
    ['publish the marks for Class 6 A maths', 'marks'],
    ['reject the fee plan for Aman', 'feePlan'],
    ['approve the book request from Priya', 'bookRequest'],
    ['go ahead and decline the transport request', 'transportRequest'],
    ['approve my cocurricular request', 'studentRequest'],
    ['admit Kabir Kapoor', 'admission'],
    ['can you approve the purchase request', 'approval'],
  ])('"%s" is a %s decision', (message, kind) => {
    expect(decisionAskedFor(message)).toBe(kind);
  });

  it.each([
    'which payments are pending approval?',
    'what is pending my approval',
    'publish an announcement that school is closed',
    'record attendance for Class 6 A',
    'show leave requests',
    'enter marks for Rahul',
  ])('"%s" is not a decision', (message) => {
    expect(decisionAskedFor(message)).toBeNull();
  });

  it('the decider is told the screen; anyone else is told it is not theirs', () => {
    const finance = actorForRole('FINANCE');
    const mine = humanDecisionReply(finance, 'payment');
    expect(mine.refused).toBe('HUMAN_DECISION');
    expect(mine.link).toBe(HUMAN_DECISIONS.payment.links.FINANCE);
    expect(mine.reply).toMatch(/Payments screen/);
    const theirs = humanDecisionReply(actorForRole('STUDENT'), 'payment');
    expect(theirs.refused).toBe('NOT_PERMITTED');
    expect(theirs.link).toBeNull();
    // WhatsApp has no screen to open: the website is named instead.
    expect(humanDecisionReply(finance, 'payment', { channel: 'WHATSAPP' }).reply).toMatch(/website/);
  });
});

describe('WhatsApp confirms only low-impact writes of its own', () => {
  it('HIGH / CRITICAL risk and writes on other people are not confirmable on WhatsApp', () => {
    expect(confirmableOn(MCP_TOOLS.create_ticket, 'WHATSAPP')).toBe(true);
    expect(confirmableOn(MCP_TOOLS.mark_attendance, 'WHATSAPP')).toBe(false);
    expect(confirmableOn(MCP_TOOLS.anonymise_student, 'WHATSAPP')).toBe(false);
    expect(confirmableOn(MCP_TOOLS.anonymise_student, 'WEB')).toBe(true);
  });
});

describe('with a school', () => {
  let school;
  beforeEach(async () => {
    resetAgentThrottle();
    school = await seedSchool();
  });

  it('the assistant answers "approve the pending payment" with the screen, and runs nothing', async () => {
    const { actor } = school.people.FINANCE;
    const out = await inSchool(OAK, () => runAgent({ message: 'approve the pending payment', actor }));
    expect(out.refused).toBe('HUMAN_DECISION');
    expect(out.action).toBeNull();
    expect(out.reply).toMatch(/Payments screen/);
    expect(await inSchool(OAK, () => AgentAction.countDocuments({}))).toBe(0);
  });

  it('a WhatsApp "yes" does not confirm a proposal made on the website', async () => {
    const { actor } = school.people.PARENT;
    const proposal = await mcp(OAK, actor, 'create_ticket', { subject: 'Bus was late today' }, { channel: 'WEB' });
    expect(proposal.action?.status).toBe('confirmation_required');

    expect(await inSchool(OAK, () => latestPendingFor(actor))).toBeNull();
    const out = await inSchool(OAK, () => converse({ actor, text: 'yes' }));
    expect(out.executed).toBeFalsy();
    const row = await inSchool(OAK, () => AgentAction.findById(proposal.action.id).lean());
    expect(row.status).toBe('PENDING');
  });

  it('a website token is not redeemed on a WhatsApp session, and the proposal survives', async () => {
    const { actor } = school.people.PARENT;
    const proposal = await mcp(OAK, actor, 'create_ticket', { subject: 'Bus was late today' }, { channel: 'WEB' });
    const redeemed = await mcp(OAK, actor, 'create_ticket', {}, { channel: 'WHATSAPP', confirmationToken: proposal.action.confirmationToken });
    expect(redeemed.success).toBe(false);
    expect(redeemed.error.details?.reason).toBe('CONFIRM_ON_WEB');
  });

  it('a proposal made on WhatsApp is found by its "yes"', async () => {
    const { actor } = school.people.PARENT;
    const proposal = await mcp(OAK, actor, 'create_ticket', { subject: 'Bus was late today' }, { channel: 'WHATSAPP' });
    expect(proposal.action?.status).toBe('confirmation_required');
    const found = await inSchool(OAK, () => latestPendingFor(actor));
    expect(String(found?._id)).toBe(String(proposal.action.id));
  });

  it('a high-impact write is not even proposed over WhatsApp', async () => {
    const { actor } = school.people.ADMIN;
    const out = await mcp(OAK, actor, 'create_announcement', { title: 'School closed tomorrow', content: 'Rain holiday.' }, { channel: 'WHATSAPP' });
    expect(out.success).toBe(false);
    expect(out.error.details?.reason).toBe('CONFIRM_ON_WEB');
    expect(await inSchool(OAK, () => AgentAction.countDocuments({}))).toBe(0);
  });

  it('get_pending_items_for_me lists only the queues the caller decides, with where to decide them', async () => {
    const finance = await mcp(OAK, school.people.FINANCE.actor, 'get_pending_items_for_me', {});
    expect(finance.success).toBe(true);
    for (const item of finance.data.items) {
      expect(['payment', 'feePlan', 'approval']).toContain(item.kind);
      expect(item.screen).toBeTruthy();
    }
    const teacher = await mcp(OAK, school.people.TEACHER.actor, 'get_pending_items_for_me', {});
    expect(teacher.success).toBe(true);
    expect(teacher.data.items.map((i) => i.kind).every((k) => ['leave', 'registration', 'studentRequest', 'approval'].includes(k))).toBe(true);
  });

  it('bulk_mark_attendance refuses a class the teacher does not teach before proposing anything', async () => {
    const out = await mcp(OAK, school.people.TEACHER.actor, 'bulk_mark_attendance', {
      sectionId: String(school.sectionB._id), rows: [{ admissionNo: 'OAK-9', status: 'PRESENT' }],
    });
    expect(out.success).toBe(false);
    expect(out.error.code).toBe('FORBIDDEN');
    expect(await inSchool(OAK, () => AgentAction.countDocuments({}))).toBe(0);
  });

  it('bulk_mark_attendance names the class in its proposal for one the teacher teaches', async () => {
    const out = await mcp(OAK, school.people.TEACHER.actor, 'bulk_mark_attendance', {
      sectionId: String(school.sectionA._id), rows: [{ admissionNo: 'OAK-3', status: 'PRESENT' }],
    });
    expect(out.action?.status).toBe('confirmation_required');
    expect(out.action.summary).toMatch(/Class 6/);
  });

  it('a profile id that is not a teacher is refused as a class teacher, not proposed', async () => {
    const out = await mcp(OAK, school.people.ADMIN.actor, 'update_section', {
      className: 'Class 6 B', classTeacherId: String(school.people.STUDENT.profile._id),
    });
    expect(out.success).toBe(false);
    expect(out.error.code).toBe('NOT_FOUND');
  });

  it('a guardian id that is not a parent is refused', async () => {
    const out = await mcp(OAK, school.people.ADMIN.actor, 'add_guardian', {
      studentId: String(school.aman.student._id), guardianProfileId: String(school.people.TEACHER.profile._id), relation: 'GUARDIAN',
    });
    expect(out.success).toBe(false);
    expect(out.error.code).toBe('NOT_FOUND');
  });

  it('list_exams carries real exam ids', async () => {
    await inSchool(OAK, async () => {
      const term = await Term.create({ academicYearId: school.year._id, name: 'Term 1', startsOn: new Date('2026-04-01'), endsOn: new Date('2026-09-30') });
      await Exam.create({ termId: term._id, name: 'Unit Test 1', startsOn: new Date('2026-06-01'), endsOn: new Date('2026-06-05') });
    });
    const out = await mcp(OAK, school.people.ADMIN.actor, 'list_exams', {});
    expect(out.success).toBe(true);
    expect(out.data.exams.length).toBeGreaterThan(0);
    for (const e of out.data.exams) expect(mongoose.isValidObjectId(e.examId)).toBe(true);
  });

  it('get_payment_history and get_pending_fees answer one window with a range', async () => {
    const pending = await mcp(OAK, school.people.ADMIN.actor, 'get_pending_fees', {});
    expect(pending.success).toBe(true);
    expect(pending.range).toMatchObject({ from: 1, to: pending.data.invoices.length, total: pending.data.invoiceCount });
    const payments = await mcp(OAK, school.people.ADMIN.actor, 'get_payment_history', { limit: 1 });
    expect(payments.success).toBe(true);
    expect(payments.data.payments.length).toBeLessThanOrEqual(1);
  });
});

describe('the website routes are always the website channel', () => {
  let api;
  let school;
  beforeAll(async () => { api = await startApi(); });
  afterAll(async () => { await api.close(); await resetMcpClient(); });
  beforeEach(async () => { resetAgentThrottle(); school = await seedSchool(); });

  it('a body claiming source WHATSAPP is ignored: the proposal is recorded as WEB', async () => {
    const res = await api.post(school.people.PARENT, '/ai/agent', { message: 'raise a ticket: bus was late today', source: 'WHATSAPP' });
    expect(res.status).toBe(200);
    const rows = await inSchool(OAK, () => AgentAction.find({}).lean());
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.source).toBe('WEB');
  });
});
