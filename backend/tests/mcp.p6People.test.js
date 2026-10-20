import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { MCP_TOOLS, mcpToolsFor, confirmableOn, validateMcpRegistry } from '../src/modules/ai/mcp/registry.js';
import { tools as peopleTools } from '../src/modules/ai/mcp/tools/p6/people.js';
import { isDecidingToolName } from '../src/modules/ai/mcp/decisions.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { StaffCredential } from '../src/models/staffCredential.model.js';
import { OrgUnit, Position, Appointment } from '../src/models/institution.model.js';
import { VerificationCase } from '../src/models/verification.model.js';
import { DueItem } from '../src/models/dueItem.model.js';
import { LeavePolicy, LeaveBalance, CoverRule, StaffAbsence } from '../src/models/staffLeave.model.js';
import { Vacancy, ExitCase } from '../src/models/p4People.model.js';
import * as tasks from '../src/modules/tasks/tasks.service.js';
import * as cover from '../src/modules/staff/cover.service.js';
import * as hr from '../src/modules/p4ops/people.service.js';
import { inSchool, mcp, actorForRole, OAK } from './support/mcpSchool.js';
import { seedFamilySchool, ymdIn } from './support/familySchool.js';

/**
 * Part-6 coverage, people (tools/p6/people.js): staff profiles, the org chart,
 * background verification, task acknowledgement, staff-leave policies and
 * balances, cover rules and absences, recruitment and exit steps, and a user
 * account read. Every write is drafted, changes nothing until the same person
 * confirms, and runs through the module's own service.
 */
const NAMES = Object.keys(peopleTools);
const APPROVER = ['record_verification_recommendation', 'record_verification_decision', 'record_verification_dispute_resolution'];
let s;
const inOak = (fn) => inSchool(OAK, fn);

async function confirm(actor, name, args, { unchanged } = {}) {
  const proposal = await mcp(OAK, actor, name, args);
  expect(proposal.success, `${name}: ${JSON.stringify(proposal.error)}`).toBe(true);
  expect(proposal.action.status).toBe('confirmation_required');
  if (unchanged) expect(await unchanged()).toBe(true);
  const done = await mcp(OAK, actor, name, {}, { confirmationToken: proposal.action.confirmationToken });
  expect(done.success, `${name}: ${JSON.stringify(done.error)}`).toBe(true);
  return { proposal, done };
}
async function read(actor, name, args = {}) {
  const out = await mcp(OAK, actor, name, args);
  expect(out.success, `${name}: ${JSON.stringify(out.error)}`).toBe(true);
  return out;
}

beforeEach(async () => { s = await seedFamilySchool(); });
afterAll(async () => { await resetMcpClient(); });

describe('the contract', () => {
  it('registers closed, non-deciding tools; writes confirm and summarise; decisions are approver-confirmed; the boot check passes', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(39);
    for (const n of NAMES) {
      const t = MCP_TOOLS[n];
      expect(t, n).toBeTruthy();
      expect(t.inputSchema.additionalProperties, n).toBe(false);
      expect(isDecidingToolName(n), n).toBe(false);
      if (t.operation === 'GET') expect(n, n).toMatch(/^(get|list|search)_/);
      else {
        expect(t.confirm, n).toBe(true);
        expect(typeof t.summarise, n).toBe('function');
        expect(typeof t.summarise({}, {}, undefined), n).toBe('string');
      }
    }
    for (const n of APPROVER) {
      const t = MCP_TOOLS[n];
      expect(t.approverDecision, n).toBe(true);
      expect(t.risk, n).toBe('HIGH');
      expect(t.inputSchema.required, n).toContain('decision');
      expect(t.inputSchema.properties.decision.default, n).toBeUndefined();
      expect(confirmableOn(t, 'WHATSAPP'), n).toBe(false);
    }
    expect(validateMcpRegistry()).toEqual([]);
    for (const n of ['update_my_staff_profile', 'acknowledge_due_item']) expect(confirmableOn(MCP_TOOLS[n], 'WHATSAPP'), n).toBe(true);
  });

  it('shows each role only what its grants allow', () => {
    const visible = (role) => mcpToolsFor(actorForRole(role)).map((t) => t.name).filter((n) => NAMES.includes(n));
    expect(visible('PARENT').sort()).toEqual(['list_my_child_teacher_profiles']);
    expect(visible('TEACHER')).toEqual(expect.arrayContaining(['get_my_staff_profile', 'update_my_staff_profile', 'acknowledge_due_item', 'list_appointable_staff']));
    for (const n of ['create_org_unit', 'start_background_verification', 'set_staff_leave_policy', 'get_candidate']) expect(visible('TEACHER'), n).not.toContain(n);
    expect(visible('PRINCIPAL')).toContain('record_verification_decision');
    expect(visible('ADMIN')).not.toContain('record_verification_decision');
    expect(visible('HR')).toEqual(expect.arrayContaining(['record_verification_recommendation', 'set_vacancy_status', 'close_staff_exit', 'set_staff_leave_policy']));
  });
});

describe('staff profiles and the organisation chart', () => {
  it('a teacher edits their own profile; administration builds the chart and appoints', async () => {
    const T = s.people.TEACHER.actor;
    await confirm(T, 'update_my_staff_profile', { qualifications: [{ degree: 'B.Ed', year: 2015 }], experienceYears: 8, showToFamilies: ['qualifications'] }, { unchanged: async () => (await inOak(() => StaffCredential.countDocuments())) === 0 });
    const mine = await read(T, 'get_my_staff_profile');
    expect(mine.data.experienceYears).toBe(8);
    expect(mine.data.showToFamilies.qualifications).toBe(true);

    // HR corrects a colleague's record, website-confirmed.
    expect(confirmableOn(MCP_TOOLS.update_staff_profile, 'WHATSAPP')).toBe(false);
    await confirm(s.people.HR.actor, 'update_staff_profile', { staffName: s.people.TEACHER.profile.displayName, bio: 'Teaches English.' });
    expect((await inOak(() => StaffCredential.findOne({ profileId: s.people.TEACHER.profile._id }).lean())).bio).toBe('Teaches English.');
    const list = await read(s.people.HR.actor, 'list_staff_profiles');
    // The HR list is refused to a teacher before anything is read.
    expect((await mcp(OAK, T, 'list_staff_profiles', {})).success).toBe(false);
    expect(list.data.total).toBeGreaterThan(0);

    const admin = s.people.ADMIN.actor;
    await confirm(admin, 'create_org_unit', { name: 'Academics', kind: 'DEPARTMENT' }, { unchanged: async () => (await inOak(() => OrgUnit.countDocuments())) === 0 });
    await confirm(admin, 'create_org_unit', { name: 'English team', kind: 'TEAM', parentUnit: 'Academics' });
    await confirm(admin, 'update_org_unit', { unit: 'English team', name: 'Languages team' });
    await confirm(admin, 'create_org_position', { title: 'English teacher', unit: 'Languages team', sanctioned: 2, staffRole: 'TEACHER' });
    await confirm(admin, 'update_org_position', { position: 'English teacher', sanctioned: 3 });
    expect((await inOak(() => Position.findOne().lean())).sanctioned).toBe(3);
    await confirm(admin, 'appoint_to_position', { staffName: s.people.TEACHER.profile.displayName, position: 'English teacher' });
    expect(await inOak(() => Appointment.countDocuments())).toBe(1);
    await confirm(admin, 'close_appointment', { staffName: s.people.TEACHER.profile.displayName, on: ymdIn(-1) });
    await confirm(admin, 'delete_org_position', { position: 'English teacher' });
    await confirm(admin, 'delete_org_unit', { unit: 'Languages team' });
    expect(await inOak(() => OrgUnit.countDocuments())).toBe(1);
    expect((await read(admin, 'list_appointable_staff')).data.total).toBeGreaterThan(0);

    // A teacher holds org.read but not org.manage.
    const refused = await mcp(OAK, T, 'create_org_unit', { name: 'Mine', kind: 'TEAM' });
    expect(refused.success).toBe(false);
  }, 120_000);
});

describe('background verification', () => {
  it('administration starts and works a case, HR-recommends; the principal decides; WhatsApp hands it to the website', async () => {
    const admin = s.people.ADMIN.actor;
    const wa = await mcp(OAK, admin, 'start_background_verification', { name: 'Ramesh Kumar', subjectType: 'VENDOR' }, { channel: 'WHATSAPP' });
    expect(wa.success).toBe(false);
    expect(wa.error.details?.reason).toBe('CONFIRM_ON_WEB');
    expect(await inOak(() => VerificationCase.countDocuments())).toBe(0);

    await confirm(admin, 'start_background_verification', { name: 'Ramesh Kumar', subjectType: 'VENDOR', checks: ['IDENTITY'] });
    const noConsent = await mcp(OAK, admin, 'update_verification_case', { case: 'Ramesh', step: 'consent' });
    expect(noConsent.success).toBe(false);
    await confirm(admin, 'update_verification_case', { case: 'Ramesh', step: 'consent', consentForm: 'HR cabinet, file 12' });
    await confirm(admin, 'update_verification_case', { case: 'Ramesh', step: 'check', checkType: 'IDENTITY', status: 'CLEAR', reference: 'AADHAAR-OK-1' });
    await confirm(admin, 'record_verification_recommendation', { case: 'Ramesh', decision: 'CLEAR', note: 'Identity verified.' });
    expect((await inOak(() => VerificationCase.findOne().lean())).status).toBe('AWAITING_DECISION');

    const P = s.people.PRINCIPAL.actor;
    const got = await read(P, 'get_verification_case', { case: 'Ramesh' });
    expect(got.data.hrReview.recommendation).toBe('CLEAR');
    await confirm(P, 'record_verification_decision', { case: 'Ramesh', decision: 'CLEARED' });
    expect((await inOak(() => VerificationCase.findOne().lean())).status).toBe('CLEARED');
    const clear = await read(P, 'get_verification_clearance', { name: 'Ramesh Kumar' });
    expect(clear.data.cleared).toBe(true);
  }, 120_000);
});

describe('tasks, staff leave and cover', () => {
  it('acknowledges a task, sets a leave rule, adjusts a balance, sets cover limits and withdraws an absence', async () => {
    const admin = s.people.ADMIN.actor;
    await inOak(() => tasks.upsertFromSource({ sourceKey: 'test:amc', title: 'AMC visit', department: 'ADMINISTRATION', dueAt: new Date(Date.now() + 5 * 86_400_000), ownerProfileId: s.people.ADMIN.profile._id }));
    await confirm(admin, 'acknowledge_due_item', { title: 'AMC visit' }, { unchanged: async () => (await inOak(() => DueItem.findOne().lean())).status !== 'ACKNOWLEDGED' });
    expect((await inOak(() => DueItem.findOne().lean())).status).toBe('ACKNOWLEDGED');

    const H = s.people.HR.actor;
    expect((await read(s.people.TEACHER.actor, 'list_staff_leave_policies')).data.total).toBe(7);
    await confirm(H, 'set_staff_leave_policy', { code: 'CL', yearlyDays: 10 });
    expect((await inOak(() => LeavePolicy.findOne({ code: 'CL' }).lean())).yearlyDays).toBe(10);
    await confirm(H, 'set_up_staff_leave_balances', { staffNames: [s.people.TEACHER.profile.displayName] });
    await confirm(H, 'adjust_staff_leave_balance', { staffName: s.people.TEACHER.profile.displayName, code: 'CL', days: 1.5, reason: 'Joined mid-month correction' });
    const bal = await inOak(() => LeaveBalance.findOne({ profileId: s.people.TEACHER.profile._id, code: 'CL' }).lean());
    expect(bal.entitled).toBe(11.5);
    const teacherTry = await mcp(OAK, s.people.TEACHER.actor, 'set_staff_leave_policy', { code: 'CL', yearlyDays: 30 });
    expect(teacherTry.success).toBe(false);

    await confirm(H, 'set_cover_rules', { maxPerDay: 3 });
    expect((await inOak(() => CoverRule.findOne().lean())).maxPerDay).toBe(3);
    expect((await read(H, 'get_cover_assignment_rules')).data.maxPerDay).toBe(3);
    await inOak(() => cover.markAbsent(admin, 'ALL', { profileId: String(s.people.T2.profile._id) }));
    expect((await read(H, 'list_staff_absences')).data.total).toBe(1);
    await confirm(H, 'withdraw_staff_absence', { staffName: s.people.T2.profile.displayName });
    expect((await inOak(() => StaffAbsence.findOne().lean())).status).toBe('WITHDRAWN');
  }, 120_000);
});

describe('recruitment, exits and accounts', () => {
  it('HR moves a vacancy, works an exit to a close, and administration reads an account without contact details', async () => {
    const H = s.people.HR.actor;
    await inOak(() => hr.createVacancy(H, { title: 'Maths teacher' }));
    await confirm(H, 'set_vacancy_status', { vacancy: 'Maths teacher', status: 'ON_HOLD' });
    expect((await inOak(() => Vacancy.findOne().lean())).status).toBe('ON_HOLD');

    await inOak(() => hr.startExit(H, { profileId: String(s.people.T4.profile._id), kind: 'RESIGNATION', lastWorkingDay: ymdIn(20), departments: ['LIBRARY'] }));
    await confirm(H, 'record_exit_interview', { staffName: s.people.T4.profile.displayName, notes: 'Moving cities.' });
    const x = await read(H, 'get_staff_exit', { staffName: s.people.T4.profile.displayName });
    expect(x.data.exitInterview.note).toBe('Moving cities.');
    const letters = await read(H, 'get_exit_letters', { staffName: s.people.T4.profile.displayName, schoolName: 'Oakridge Academy' });
    expect(letters.data.relieving).toMatch(/Oakridge Academy/);
    const early = await mcp(OAK, H, 'close_staff_exit', { staffName: s.people.T4.profile.displayName, step: 'close' });
    expect(early.success).toBe(false);
    await confirm(H, 'close_staff_exit', { staffName: s.people.T4.profile.displayName, step: 'withdraw', note: 'Stayed on' });
    expect((await inOak(() => ExitCase.findOne().lean())).status).toBe('WITHDRAWN');

    const acct = await read(s.people.ADMIN.actor, 'get_user_account', { name: s.people.T2.profile.displayName });
    expect(acct.data.name).toBe(s.people.T2.profile.displayName);
    expect(JSON.stringify(acct.data)).not.toContain(s.people.T2.phone);
  }, 120_000);
});
