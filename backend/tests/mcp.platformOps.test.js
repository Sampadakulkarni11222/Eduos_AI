import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MCP_TOOLS, getMcpTool, mcpToolsFor, mutates, requiresConfirmation, confirmableOn, validateMcpRegistry } from '../src/modules/ai/mcp/registry.js';
import { platformOpsTools, PLATFORM_APPROVER_TOOLS } from '../src/modules/ai/mcp/tools/platformOps.js';
import { isDecidingToolName, decisionAskedFor, approverMayRecord, APPROVER_CONFIRMED } from '../src/modules/ai/mcp/decisions.js';
import { asksLeaveWithoutPermission } from '../src/modules/ai/agent/directIntents.js';
import { capabilitiesFor } from '../src/modules/ai/mcp/capabilities.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { AgentAction } from '../src/models/agentAction.model.js';
import { DueItem } from '../src/models/dueItem.model.js';
import { Bill } from '../src/models/bill.model.js';
import { Lab, LabBatch } from '../src/models/lab.model.js';
import { StaffLeave } from '../src/models/staffLeave.model.js';
import { OutPass, Visitor } from '../src/models/safety.model.js';
import { HostelAllocation } from '../src/models/hostel.model.js';
import { FeeAdjustment } from '../src/models/feeAdjustment.model.js';
import * as bills from '../src/modules/bills/bills.service.js';
import * as labs from '../src/modules/labs/labs.service.js';
import * as staffLeave from '../src/modules/staff/staffLeave.service.js';
import * as adjustments from '../src/modules/fees/adjustment.service.js';
import { seedSchool, inSchool, mcp, actorForRole, OAK } from './support/mcpSchool.js';

/**
 * The school-platform operations through the assistant (tools/platformOps.js):
 * tasks, bills, labs, fee adjustments, fleet, safety, out-pass, staff leave and
 * cover, analytics. For every tool: refused without its permission, refused
 * school-wide to an OWN-scope holder where it is school-wide only, and every
 * write drafted first and run only on its own person's yes. Then the real
 * flows each module was built for, with OWN vs ALL scope where the module has
 * it, and the approvals that only the approver can confirm.
 */

const NAMES = Object.keys(platformOpsTools);
const DAY = 86_400_000;
const ymd = (d) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** A working Monday at least a week ahead, in the current leave year where possible. */
function nextMonday() {
  const d = new Date(Date.now() + 8 * DAY);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return ymd(d);
}

let school;
beforeEach(async () => {
  school = await seedSchool();
});
afterAll(async () => {
  await resetMcpClient();
});

const person = (role) => school.people[role].actor;
const propose = (role, name, args, opts) => mcp(OAK, person(role), name, args, opts);
const confirm = (actor, name, proposal, opts) => mcp(OAK, actor, name, {}, { ...opts, confirmationToken: proposal.action.confirmationToken });

/** Proposes as `role`, checks nothing ran, confirms as the same person. */
async function draftThenConfirm(role, name, args, { check } = {}) {
  const proposal = await propose(role, name, args);
  expect(proposal.success, `${name}: ${JSON.stringify(proposal.error)}`).toBe(true);
  expect(proposal.action?.status, name).toBe('confirmation_required');
  expect(typeof proposal.action.summary).toBe('string');
  expect(proposal.action.summary).not.toMatch(/undefined|\[object Object\]/);
  if (check) await check('before');
  const done = await confirm(person(role), name, proposal);
  expect(done.success, `${name}: ${JSON.stringify(done.error)}`).toBe(true);
  if (check) await check('after');
  return { proposal, done };
}

/* ── The contract, for every tool ───────────────────────── */

describe('every platform-operations tool keeps the MCP contract', () => {
  it('is registered, and the boot check passes', () => {
    expect(NAMES.length).toBe(76);
    for (const name of NAMES) expect(getMcpTool(name), name).toBe(MCP_TOOLS[name]);
    expect(validateMcpRegistry()).toEqual([]);
  });

  it('declares a permission, a closed schema, and no deciding name', () => {
    for (const name of NAMES) {
      const t = MCP_TOOLS[name];
      expect(typeof t.permission, name).toBe('string');
      expect(t.inputSchema.additionalProperties, name).toBe(false);
      expect(isDecidingToolName(name), name).toBe(false);
    }
  });

  it('asks for confirmation on every write, and can describe it', () => {
    for (const name of NAMES.filter((n) => mutates(MCP_TOOLS[n]))) {
      expect(requiresConfirmation(MCP_TOOLS[name], {}), name).toBe(true);
      expect(typeof MCP_TOOLS[name].summarise, name).toBe('function');
    }
  });

  it('keeps approvals to the approver: required decision, HIGH risk, confirmed on the website only', () => {
    expect([...PLATFORM_APPROVER_TOOLS].sort()).toEqual(['record_concession_decision', 'record_outpass_consent', 'record_outpass_decision', 'record_staff_leave_decision', 'verify_bill_payment']);
    for (const name of PLATFORM_APPROVER_TOOLS) {
      const t = MCP_TOOLS[name];
      expect(t.inputSchema.required, name).toContain('decision');
      expect(t.inputSchema.properties.decision.default, name).toBeUndefined();
      expect(t.risk, name).toBe('HIGH');
      expect(confirmableOn(t, 'WHATSAPP'), name).toBe(false);
      expect(confirmableOn(t, 'WEB'), name).toBe(true);
    }
    // Every approver-confirmed request the orchestrator lets through names a real tool.
    for (const d of APPROVER_CONFIRMED) expect(MCP_TOOLS[d.tool], d.tool).toBeDefined();
  });

  it('is refused, through the server, to an actor without its permission', async () => {
    for (const name of NAMES) {
      const tool = MCP_TOOLS[name];
      const actor = { ...person('ADMIN'), permissions: { ...person('ADMIN').permissions } };
      delete actor.permissions[tool.permission];
      const res = await mcp(OAK, actor, name, {});
      expect(res.success, name).toBe(false);
      expect(res.error.code, name).toBe('FORBIDDEN');
    }
  }, 120_000);

  it('a school-wide-only tool is refused to the same permission held at OWN scope', async () => {
    for (const name of NAMES.filter((n) => MCP_TOOLS[n].minScope === 'ALL')) {
      const tool = MCP_TOOLS[name];
      const actor = { ...person('ADMIN'), permissions: { ...person('ADMIN').permissions, [tool.permission]: 'OWN' } };
      const res = await mcp(OAK, actor, name, {});
      expect(res.error?.code, name).toBe('FORBIDDEN_SCOPE');
    }
  });

  it('is offered only to roles that hold it: a parent sees their child\'s bus and out-pass, never the office tools', () => {
    const parent = mcpToolsFor(actorForRole('PARENT')).map((t) => t.name);
    expect(parent).toEqual(expect.arrayContaining(['get_my_child_bus', 'request_outpass', 'record_outpass_consent', 'request_pickup_delegation']));
    for (const office of ['record_outpass_decision', 'list_bills', 'record_staff_leave_decision', 'get_visitors_on_site', 'issue_lab_stock', 'get_camera_review_count']) expect(parent).not.toContain(office);
    const teacher = mcpToolsFor(actorForRole('TEACHER')).map((t) => t.name);
    expect(teacher).toEqual(expect.arrayContaining(['apply_staff_leave', 'get_staff_leave_balance', 'list_due_items', 'issue_lab_stock', 'record_trip_boarding']));
    expect(teacher).not.toContain('record_staff_leave_decision');
    expect(teacher).not.toContain('assign_cover');
    // The capability index a prompt is built from is the same set.
    expect(capabilitiesFor(actorForRole('TEACHER')).map((c) => c.name).sort()).toEqual([...teacher].sort());
  });
});

/* ── Decisions the approver records, and nothing more ───── */

describe('requests for a decision', () => {
  const role = (k) => actorForRole(k);
  it('go to the tool only for the approver, and only for that kind of record', () => {
    expect(approverMayRecord(role('PRINCIPAL'), decisionAskedFor("approve Ms Rao's casual leave"), "approve Ms Rao's casual leave")).toBe(true);
    // A student's leave stays with the screen; so does a student approving anything.
    expect(approverMayRecord(role('PRINCIPAL'), 'leave', "Please approve Rahul's leave")).toBe(false);
    expect(approverMayRecord(role('STUDENT'), 'leave', 'Approve my own casual leave')).toBe(false);
    expect(approverMayRecord(role('WARDEN'), 'approval', "approve Aarav's out-pass request")).toBe(true);
    expect(approverMayRecord(role('TEACHER'), 'approval', "approve Aarav's out-pass request")).toBe(false);
    // A bill payment is recorded (and checked by someone else); a fee payment never is.
    expect(approverMayRecord(role('FINANCE'), 'payment', 'record a payment of Rs 4500 against the electricity bill')).toBe(true);
    expect(approverMayRecord(role('FINANCE'), 'payment', 'record a payment of Rs 500 against invoice INV-1001')).toBe(false);
    expect(approverMayRecord(role('FINANCE'), 'payment', 'approve the pending payment')).toBe(false);
  });

  it('a teacher naming a staff leave type is not told leave is unavailable', () => {
    expect(asksLeaveWithoutPermission('apply for casual leave on Monday', role('TEACHER'))).toBe(false);
    // Changed deliberately in part 3: any leave request from a holder of staffleave.apply is their
    // own staff leave (apply_staff_leave), so it is never refused as "not enabled".
    expect(asksLeaveWithoutPermission('Apply for leave tomorrow because of fever', role('TEACHER'))).toBe(false);
  });
});

/* ── Tasks: OWN vs ALL, draft then confirm, nobody else's yes ── */

describe('tasks', () => {
  it('a teacher adds and snoozes their own task; only they can confirm it; the admin sees everyone\'s', async () => {
    const dueOn = ymd(new Date(Date.now() + 3 * DAY));
    await draftThenConfirm('TEACHER', 'create_due_item', { title: 'Collect lab manuals', department: 'ACADEMICS', dueOn }, {
      check: async (phase) => expect(await inSchool(OAK, () => DueItem.countDocuments({ title: 'Collect lab manuals' }))).toBe(phase === 'before' ? 0 : 1),
    });
    await inSchool(OAK, () => DueItem.create({ refNo: 'TSK-OTHER', title: 'Renew fire NOC', department: 'COMPLIANCE', dueAt: new Date(Date.now() + DAY), ownerProfileId: person('ADMIN').profileId }));

    const mine = await propose('TEACHER', 'list_due_items', {});
    expect(mine.data.items.map((t) => t.title)).toEqual(['Collect lab manuals']);
    const all = await propose('ADMIN', 'list_due_items', {});
    expect(all.data.items.map((t) => t.title).sort()).toEqual(['Collect lab manuals', 'Renew fire NOC']);
    // A teacher cannot reach someone else's task by naming it.
    const theirs = await propose('TEACHER', 'snooze_due_item', { title: 'Renew fire NOC', until: dueOn, reason: 'x' });
    expect(theirs.success).toBe(false);

    const until = ymd(new Date(Date.now() + 5 * DAY));
    const proposal = await propose('TEACHER', 'snooze_due_item', { title: 'lab manuals', until, reason: 'vendor on leave' });
    expect(proposal.action.summary).toMatch(/Snooze .*Collect lab manuals.* until .*vendor on leave/);
    // Another person presenting the teacher's token is refused, and nothing changes.
    const stolen = await confirm(person('ADMIN'), 'snooze_due_item', proposal);
    expect(stolen.success).toBe(false);
    expect(stolen.error.code).toBe('FORBIDDEN');
    expect((await inSchool(OAK, () => DueItem.findOne({ title: 'Collect lab manuals' }).lean())).status).toBe('OPEN');
    const done = await confirm(person('TEACHER'), 'snooze_due_item', proposal);
    expect(done.success).toBe(true);
    expect((await inSchool(OAK, () => DueItem.findOne({ title: 'Collect lab manuals' }).lean())).status).toBe('SNOOZED');
  });
});

/* ── Bills: a payment is recorded by one person and checked by another ── */

describe('bills', () => {
  async function seedBill() {
    return inSchool(OAK, async () => {
      const account = await bills.createAccount(person('FINANCE'), { name: 'Electricity', category: 'ELECTRICITY', vendorName: 'State DISCOM' });
      const bill = await bills.createBill(person('FINANCE'), { accountId: account.id, amountPaise: 4_820_000, dueOn: new Date(Date.now() + 4 * DAY).toISOString() });
      return { account, bill };
    });
  }

  it('lists what is due this week, records a payment, and refuses the same person checking it', async () => {
    await seedBill();
    const due = await propose('FINANCE', 'list_bills', { dueWithinDays: 7 });
    expect(due.data.bills.map((b) => b.account)).toEqual(['Electricity']);
    expect(due.data.outstanding).toBe('₹48,200');

    // Money: proposed on WhatsApp, it is sent to the website.
    const viaPhone = await propose('FINANCE', 'record_bill_payment', { account: 'electricity', amountRupees: 48200, mode: 'BANK' }, { channel: 'WHATSAPP' });
    expect(viaPhone.success).toBe(false);
    expect(viaPhone.error.details?.reason).toBe('CONFIRM_ON_WEB');

    await draftThenConfirm('FINANCE', 'record_bill_payment', { account: 'electricity', amountRupees: 48200, mode: 'BANK', reference: 'UTR123' }, {
      check: async (phase) => {
        const b = await inSchool(OAK, () => Bill.findOne({}).lean());
        expect(b.payments.length).toBe(phase === 'before' ? 0 : 1);
        expect(b.status).toBe(phase === 'before' ? 'DUE' : 'PAYMENT_RECORDED');
      },
    });

    // The person who recorded it cannot confirm it against the bank.
    const self = await propose('FINANCE', 'verify_bill_payment', { account: 'electricity', decision: 'CONFIRM', bankReference: 'UTR123' });
    expect(self.success).toBe(false);
    expect(self.error.code).toBe('FORBIDDEN');
    // A second person can, with their own yes.
    await draftThenConfirm('ADMIN', 'verify_bill_payment', { account: 'electricity', decision: 'CONFIRM', bankReference: 'UTR123' });
    expect((await inSchool(OAK, () => Bill.findOne({}).lean())).status).toBe('PAID');
  });

  it('is school-wide only: a teacher has no bill tools', async () => {
    const res = await propose('TEACHER', 'list_bills', {});
    expect(res.error.code).toBe('FORBIDDEN');
  });
});

/* ── Labs: OWN = the labs you run ───────────────────────── */

describe('labs', () => {
  async function seedLab() {
    return inSchool(OAK, async () => {
      const lab = await Lab.create({ facilityId: new mongoose.Types.ObjectId(), name: 'Chemistry Lab', type: 'SCIENCE_CHEMISTRY', inChargeProfileIds: [person('TEACHER').profileId] });
      const acid = await labs.createItem(person('ADMIN'), 'ALL', String(lab._id), { name: 'Hydrochloric acid', kind: 'CHEMICAL', unit: 'mL', hazardClasses: ['CORROSIVE'] });
      await labs.receive(person('ADMIN'), 'ALL', acid.id, { quantity: 500, unit: 'mL', expiresOn: new Date(Date.now() + 10 * DAY).toISOString() });
      const beaker = await labs.createItem(person('ADMIN'), 'ALL', String(lab._id), { name: 'Beaker 250 mL', kind: 'GLASSWARE', unit: 'pcs' });
      await labs.receive(person('ADMIN'), 'ALL', beaker.id, { quantity: 20, unit: 'pcs', noExpiry: true });
      return { lab, acid, beaker };
    });
  }

  it('answers which chemicals expire this month, for the in-charge and the school, not for others', async () => {
    await seedLab();
    const inCharge = await propose('TEACHER', 'list_lab_stock', { show: 'expiring', withinDays: 30 });
    expect(inCharge.data.items.map((i) => i.item)).toEqual(['Hydrochloric acid']);
    const school = await propose('PRINCIPAL', 'list_lab_stock', { show: 'expiring' });
    expect(school.data.items.map((i) => i.item)).toEqual(['Hydrochloric acid']);
    // Another teacher-scoped actor who runs no lab sees nothing.
    const other = await mcp(OAK, actorForRole('TEACHER'), 'list_lab_stock', { show: 'expiring' });
    expect(other.data.items).toEqual([]);
  });

  it('issues 2 beakers to the 9A practical on the in-charge\'s yes', async () => {
    const { beaker } = await seedLab();
    await draftThenConfirm('TEACHER', 'issue_lab_stock', { item: 'beaker', quantity: 2, issuedTo: '9A practical' }, {
      check: async (phase) => {
        const b = await inSchool(OAK, () => LabBatch.findOne({ itemId: beaker.id }).lean());
        expect(b.quantity).toBe(phase === 'before' ? 20 : 18);
      },
    });
  });
});

/* ── Staff leave: apply for yourself; the approver decides others' ── */

describe('staff leave', () => {
  it('a teacher applies for casual leave; the principal approves it; nobody approves their own', async () => {
    await inSchool(OAK, () => staffLeave.initBalances(person('PRINCIPAL'), 'ALL', {}));
    const monday = nextMonday();
    const balance = await propose('TEACHER', 'get_staff_leave_balance', {});
    expect(balance.data.balances.find((b) => b.type === 'Casual leave').available).toBe(12);
    // A teacher may not read a colleague's balance.
    expect((await propose('TEACHER', 'get_staff_leave_balance', { staffName: 'PRINCIPAL user' })).success).toBe(false);

    const { proposal } = await draftThenConfirm('TEACHER', 'apply_staff_leave', { type: 'CL', fromDate: monday, reason: 'Family function' }, {
      check: async (phase) => expect(await inSchool(OAK, () => StaffLeave.countDocuments({}))).toBe(phase === 'before' ? 0 : 1),
    });
    expect(proposal.action.summary).toMatch(/casual leave on .* 1 working day/);

    // The teacher has no approval tool at all.
    expect((await propose('TEACHER', 'record_staff_leave_decision', { decision: 'APPROVE' })).error.code).toBe('FORBIDDEN');
    // The principal records their own decision, confirmed on the website.
    const onPhone = await propose('PRINCIPAL', 'record_staff_leave_decision', { staffName: 'TEACHER user', decision: 'APPROVE' }, { channel: 'WHATSAPP' });
    expect(onPhone.error.details?.reason).toBe('CONFIRM_ON_WEB');
    await draftThenConfirm('PRINCIPAL', 'record_staff_leave_decision', { staffName: 'TEACHER user', decision: 'APPROVE' });
    expect((await inSchool(OAK, () => StaffLeave.findOne({}).lean())).status).toBe('APPROVED');

    // The principal's own leave cannot be decided by the principal.
    await inSchool(OAK, () => staffLeave.apply(person('PRINCIPAL'), 'OWN', { code: 'CL', fromDate: monday, reason: 'Travel' }));
    const own = await propose('PRINCIPAL', 'record_staff_leave_decision', { staffName: 'PRINCIPAL user', decision: 'APPROVE' });
    expect(own.success).toBe(false);
    expect(own.error.code).toBe('FORBIDDEN');
  });

  it('cover: a coordinator reads the day; a teacher cannot arrange cover', async () => {
    const needs = await propose('PRINCIPAL', 'get_cover_needs', {});
    expect(needs.success).toBe(true);
    expect((await propose('TEACHER', 'assign_cover', { className: 'Class 6 A', periodNo: 1, substituteName: 'x' })).error.code).toBe('FORBIDDEN');
  });
});

/* ── Hostel out-pass: a parent asks, the warden decides ─── */

describe('hostel out-pass', () => {
  it('a parent requests one for their son; the warden approves it; the parent cannot', async () => {
    await inSchool(OAK, () => HostelAllocation.create({ roomId: new mongoose.Types.ObjectId(), studentId: school.rahul.student._id, status: 'ACTIVE' }));
    const sat = nextMonday();
    await draftThenConfirm('PARENT', 'request_outpass', { fromDate: sat, fromTime: '10:00', toDate: sat, toTime: '18:00', reason: 'Family visit', destination: 'Home' }, {
      check: async (phase) => expect(await inSchool(OAK, () => OutPass.countDocuments({}))).toBe(phase === 'before' ? 0 : 1),
    });
    const mine = await propose('PARENT', 'list_my_outpasses', {});
    expect(mine.data.outpasses[0].status).toBe('PENDING_WARDEN');
    // Only the warden decides; a parent is refused the tool.
    expect((await propose('PARENT', 'record_outpass_decision', { decision: 'APPROVED' })).error.code).toBe('FORBIDDEN');
    await draftThenConfirm('WARDEN', 'record_outpass_decision', { studentName: 'Rahul', decision: 'APPROVED' });
    expect((await inSchool(OAK, () => OutPass.findOne({}).lean())).status).toBe('APPROVED');
  });

  it('a student cannot request one for somebody else\'s child', async () => {
    const res = await propose('STUDENT', 'request_outpass', { childName: 'Rahul', fromDate: nextMonday(), fromTime: '10:00', toDate: nextMonday(), toTime: '18:00', reason: 'x', destination: 'y' });
    expect(res.success).toBe(false);
  });
});

/* ── Safety and fleet ──────────────────────────────────── */

describe('safety and fleet', () => {
  it('the office adds a visitor and counts who is expected today', async () => {
    await draftThenConfirm('ADMIN', 'add_visitor', { name: 'Ravi Menon', purpose: 'Lift inspection', kind: 'VENDOR', organisation: 'LiftCo' }, {
      check: async (phase) => expect(await inSchool(OAK, () => Visitor.countDocuments({}))).toBe(phase === 'before' ? 0 : 1),
    });
    const today = await propose('ADMIN', 'get_visitors_on_site', { view: 'today' });
    expect(today.data.count).toBe(1);
    const onsite = await propose('ADMIN', 'get_visitors_on_site', {});
    expect(onsite.data.count).toBe(0);
    expect((await propose('TEACHER', 'get_visitors_on_site', {})).error.code).toBe('FORBIDDEN');
  });

  it('camera: a count only, and only for a reviewer', async () => {
    expect((await propose('ADMIN', 'get_camera_review_count', {})).error.code).toBe('FORBIDDEN');
    const principal = await propose('PRINCIPAL', 'get_camera_review_count', {});
    expect(principal.success).toBe(true);
    expect(Object.keys(principal.data).sort()).toEqual(['awaitingReview', 'enabled']);
  });

  it("a parent asks where their child's bus is and gets only their own child", async () => {
    const res = await propose('PARENT', 'get_my_child_bus', {});
    expect(res.success).toBe(true);
    expect(JSON.stringify(res.data)).not.toMatch(/Priya|Aman|Riya/);
    expect((await propose('PARENT', 'get_live_bus_status', {})).error.code).toBe('FORBIDDEN_SCOPE');
  });
});

/* ── Fee concessions: requested by finance, decided by the approver ── */

describe('fee concessions', () => {
  it('finance requests a concession; it is decided only from the approver\'s own inbox', async () => {
    await inSchool(OAK, () => adjustments.createConcessionType(person('FINANCE'), { code: 'SIB', name: 'Sibling concession', kind: 'SIBLING', method: 'PERCENT', valueBp: 1000 }).catch(() => adjustments.createConcessionType(person('FINANCE'), { code: 'SIB', name: 'Sibling concession', kind: 'OTHER', method: 'PERCENT', valueBp: 1000 })));
    await draftThenConfirm('FINANCE', 'request_fee_adjustment', { invoiceNo: 'INV-1001', kind: 'CONCESSION', scheme: 'sibling', reason: 'Second child enrolled' }, {
      check: async (phase) => expect(await inSchool(OAK, () => FeeAdjustment.countDocuments({}))).toBe(phase === 'before' ? 0 : 1),
    });
    const pending = await propose('FINANCE', 'list_fee_adjustments', {});
    expect(pending.data.adjustments[0].amount).toBe('₹800');
    // The requester cannot decide it (it is not in their inbox, and never could be).
    const self = await propose('FINANCE', 'record_concession_decision', { decision: 'APPROVE' });
    expect(self.success).toBe(false);
    // A decider whose stage it is records their own decision; the adjustment follows the approvals engine.
    const deciders = ['PRINCIPAL', 'ADMIN'];
    let decided = null;
    for (const role of deciders) {
      // eslint-disable-next-line no-await-in-loop
      const p = await propose(role, 'record_concession_decision', { studentName: 'Rahul', decision: 'APPROVE' });
      if (p.success) { decided = await confirm(person(role), 'record_concession_decision', p); break; }
    }
    expect(decided?.success).toBe(true);
    expect(await inSchool(OAK, () => AgentAction.countDocuments({ status: 'EXECUTED', tool: 'record_concession_decision' }))).toBe(1);
  });
});

/* ── Analytics ─────────────────────────────────────────── */

describe('analytics', () => {
  it('reads the workspace at the caller\'s own scope', async () => {
    const principal = await propose('PRINCIPAL', 'get_analytics_overview', { preset: 'month' });
    expect(principal.success).toBe(true);
    expect(Array.isArray(principal.data.metrics)).toBe(true);
    // A parent holds no analytics workspace.
    expect((await propose('PARENT', 'get_analytics_overview', {})).error.code).toBe('FORBIDDEN');
  });
});
