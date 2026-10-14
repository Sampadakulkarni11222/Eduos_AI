import { describe, it, expect, beforeEach } from 'vitest';
import { seedRoles, seedPerson, inSchool, OAK } from './support/mcpSchool.js';
import * as payroll from '../src/modules/finance-ops/payroll.service.js';
import * as approvals from '../src/modules/approvals/approval.service.js';
import { PayrollRun } from '../src/models/finance.model.js';

/**
 * Payroll audit fixes.
 *
 * F2  OFF_CYCLE / FULL_AND_FINAL runs recomputed a full month for everyone.
 * F24 saving one employee's inputs wiped every other employee's LOP.
 * F4  EPF ECR wrote uncapped EPS/EDLI wages; no #~# ECR text.
 * F5  ESI rounded to the nearest rupee instead of up.
 * F6  PT silently zero when no work state / rule.
 * F7  net pay carried paise.  F8  no warning when TDS is 0 above the exemption.
 * F3  a preparer could add an adjustment to their own line; the approver saw only totals.
 * F13 money in the approval summary had no Indian grouping.
 */

const oak = (fn) => inSchool(OAK, fn);
let P; let roles;

const comp = (over = {}) => ({
  joiningDate: '2020-01-01', pfApplicable: true, bank: { accountNo: '123456789012', ifsc: 'SBIN0001234' },
  components: [
    { code: 'BASIC', name: 'Basic', kind: 'EARNING', calc: 'FIXED', value: 3_000_000, statutoryWage: true },
    { code: 'HRA', name: 'HRA', kind: 'EARNING', calc: 'PERCENT_OF_BASIC', value: 4000 },
  ],
  ...over,
});
const rules = () => payroll.SEED_RULES.map((r, i) => ({ ...r, _id: `r${i}`, jurisdiction: null, effectiveFrom: new Date(r.effectiveFrom), effectiveTo: r.effectiveTo ? new Date(r.effectiveTo) : null, verified: false }));
const line = (c, opts = {}) => payroll.computeLine({
  profileId: 'p', employeeCode: 'E', name: 'Asha', bankLast4: '1', monthlyTdsPaise: 0, pfApplicable: true, joiningDate: new Date('2020-01-01'),
  components: comp().components.map((x) => ({ ...x, prorate: true })),
  ...c,
}, rules(), { period: '2026-10', ...opts }).line;
const find = (arr, code) => arr.find((x) => x.code === code)?.amountPaise ?? 0;

beforeEach(async () => {
  roles = await seedRoles();
  P = {};
  for (const key of ['ADMIN', 'PRINCIPAL', 'FINANCE', 'HR', 'TEACHER', 'LIBRARIAN']) {
    P[key] = await seedPerson({ roleKey: key, roleId: roles[key], displayName: `${key} person` });
  }
  await oak(() => payroll.seedRules());
  await oak(() => payroll.upsertCompensation(P.FINANCE.actor, { profileId: P.TEACHER.actor.profileId, employeeCode: 'T001', ...comp() }));
  await oak(() => payroll.upsertCompensation(P.FINANCE.actor, { profileId: P.LIBRARIAN.actor.profileId, employeeCode: 'L001', ...comp() }));
  await oak(() => payroll.upsertCompensation(P.FINANCE.actor, { profileId: P.HR.actor.profileId, employeeCode: 'H001', ...comp() }));
});

describe('F2: off-cycle and full-and-final runs pay only what was entered', () => {
  it('refuses to calculate with nobody on it, then pays only the entered employee their entered amounts', async () => {
    const run = await oak(() => payroll.createRun(P.FINANCE.actor, { period: '2026-09', kind: 'OFF_CYCLE' }));
    await expect(oak(() => payroll.calculate(P.FINANCE.actor, run.id))).rejects.toMatchObject({ code: 'NO_INPUTS' });

    await oak(() => payroll.setInputs(P.FINANCE.actor, run.id, { inputs: [{
      profileId: P.TEACHER.actor.profileId, arrearsPaise: 250_000,
      adjustments: [{ name: 'Exam duty', amountPaise: 150_000, reason: 'Board exam invigilation' }],
    }] }));
    const calc = await oak(() => payroll.calculate(P.FINANCE.actor, run.id));
    expect(calc.totals.headcount).toBe(1);
    expect(calc.totals.netPaise).toBe(400_000);
    expect(calc.totals.grossPaise).toBe(400_000);
    expect(calc.totals.deductionsPaise).toBe(0);
    const stored = await oak(() => PayrollRun.findById(run.id).lean());
    expect(stored.lines[0]).toMatchObject({ employeeCode: 'T001', grossPaise: 0, netPaise: 400_000, paidDays: 0 });
    expect(stored.lines[0].earnings).toEqual([]);
  });

  it('a full-and-final run likewise never adds a month of salary', async () => {
    const run = await oak(() => payroll.createRun(P.FINANCE.actor, { period: '2026-10', kind: 'FULL_AND_FINAL' }));
    await oak(() => payroll.setInputs(P.FINANCE.actor, run.id, { inputs: [{ profileId: P.LIBRARIAN.actor.profileId, adjustments: [{ name: 'Leave encashment', amountPaise: 4_500_000, reason: '15 days EL' }] }] }));
    const calc = await oak(() => payroll.calculate(P.FINANCE.actor, run.id));
    expect(calc.totals).toMatchObject({ headcount: 1, netPaise: 4_500_000 });
  });
});

describe('F24: saving inputs merges by employee', () => {
  it('two saves keep both employees; a partial row keeps the fields it did not send; removal is explicit', async () => {
    const run = await oak(() => payroll.createRun(P.FINANCE.actor, { period: '2026-10' }));
    await oak(() => payroll.setInputs(P.FINANCE.actor, run.id, { inputs: [{ profileId: P.TEACHER.actor.profileId, lopDays: 2 }] }));
    await oak(() => payroll.setInputs(P.FINANCE.actor, run.id, { inputs: [{ profileId: P.LIBRARIAN.actor.profileId, arrearsPaise: 100_000 }] }));
    let stored = await oak(() => PayrollRun.findById(run.id).lean());
    const by = (s) => Object.fromEntries(s.inputs.map((i) => [String(i.profileId), i]));
    expect(by(stored)[P.TEACHER.actor.profileId].lopDays).toBe(2);
    expect(by(stored)[P.LIBRARIAN.actor.profileId].arrearsPaise).toBe(100_000);

    await oak(() => payroll.setInputs(P.FINANCE.actor, run.id, { inputs: [{ profileId: P.LIBRARIAN.actor.profileId, lopDays: 1 }] }));
    stored = await oak(() => PayrollRun.findById(run.id).lean());
    expect(by(stored)[P.LIBRARIAN.actor.profileId]).toMatchObject({ lopDays: 1, arrearsPaise: 100_000 });

    const calc = await oak(() => payroll.calculate(P.FINANCE.actor, run.id));
    const lines = (await oak(() => PayrollRun.findById(calc.id).lean())).lines;
    expect(lines.find((l) => l.employeeCode === 'T001').lopDays).toBe(2);

    await oak(() => payroll.setInputs(P.FINANCE.actor, run.id, { inputs: [{ profileId: P.TEACHER.actor.profileId, remove: true }] }));
    stored = await oak(() => PayrollRun.findById(run.id).lean());
    expect(stored.inputs.map((i) => String(i.profileId))).toEqual([P.LIBRARIAN.actor.profileId]);
  });
});

describe('F3/F13: adjustments on your own line, and what the approver sees', () => {
  it('administrators no longer prepare payroll by default', () => {
    // permissions.js now withholds payroll.prepare from ADMIN (RESTRICTED_BY_DEFAULT).
    expect(P.ADMIN.actor.permissions['payroll.prepare']).toBeUndefined();
  });

  it('refuses arrears or an adjustment on the preparer\'s own line; lists every adjustment for the approver', async () => {
    const run = await oak(() => payroll.createRun(P.HR.actor, { period: '2026-10' }));
    await expect(oak(() => payroll.setInputs(P.HR.actor, run.id, { inputs: [{ profileId: P.HR.actor.profileId, adjustments: [{ name: 'Festival bonus', amountPaise: 5_000_000, reason: 'Diwali' }] }] })))
      .rejects.toMatchObject({ statusCode: 403, code: 'SELF_ADJUSTMENT' });
    await expect(oak(() => payroll.setInputs(P.HR.actor, run.id, { inputs: [{ profileId: P.HR.actor.profileId, arrearsPaise: 100 }] })))
      .rejects.toMatchObject({ code: 'SELF_ADJUSTMENT' });
    // LOP on your own line is not money to yourself and stays allowed.
    await oak(() => payroll.setInputs(P.HR.actor, run.id, { inputs: [{ profileId: P.HR.actor.profileId, lopDays: 1 }] }));

    await oak(() => payroll.setInputs(P.HR.actor, run.id, { inputs: [{ profileId: P.TEACHER.actor.profileId, arrearsPaise: 117_680_000, adjustments: [{ name: 'Canteen recovery', amountPaise: -50_000, reason: 'September canteen dues' }] }] }));
    await oak(() => payroll.calculate(P.HR.actor, run.id));
    const sent = await oak(() => payroll.submitRun(P.HR.actor, run.id, { acknowledgeUnverifiedRules: true }));
    const req = await oak(() => approvals.getRequest(P.PRINCIPAL.actor, 'ALL', sent.approvalRequestId));
    expect(req.summary).toMatch(/Arrears and adjustments \(2\)/);
    expect(req.summary).toMatch(/TEACHER person \(T001\): arrears ₹11,76,800\.00 — entered by HR person/);
    expect(req.summary).toMatch(/TEACHER person \(T001\): Canteen recovery -₹500\.00 — September canteen dues — entered by HR person/);
    expect(req.summary).not.toMatch(/₹\d{5,}\./); // no ungrouped figures
  });

  it('a self-entered adjustment smuggled into the stored inputs is still refused at calculation', async () => {
    const run = await oak(() => payroll.createRun(P.HR.actor, { period: '2026-10' }));
    await oak(() => PayrollRun.updateOne({ _id: run.id }, { $set: { inputs: [{ profileId: P.HR.actor.profileId, arrearsPaise: 0, lopDays: 0, adjustments: [{ name: 'Bonus', amountPaise: 100, reason: 'x' }], moneyByProfileId: P.HR.actor.profileId }] } }));
    await expect(oak(() => payroll.calculate(P.HR.actor, run.id))).rejects.toMatchObject({ code: 'SELF_ADJUSTMENT' });
  });
});

describe('statutory arithmetic', () => {
  it('F5: ESI rounds up to the next rupee', () => {
    const l = line({ esiApplicable: true, workState: 'KA', components: [{ code: 'BASIC', name: 'Basic', kind: 'EARNING', calc: 'FIXED', value: 1_508_000, statutoryWage: true, prorate: true }] });
    expect(find(l.deductions, 'ESI')).toBe(11_400); // 0.75% × 15,080 = 113.10 → ₹114 (nearest would be ₹113)
    expect(find(l.employerContributions, 'ESI_ER')).toBe(49_100); // 3.25% = 490.10 → ₹491
    expect(payroll.pctCeilRupee(1_800_000, 75)).toBe(13_500); // exact stays exact
  });

  it('F6: warns when no work state is on file instead of silently skipping PT', () => {
    expect(line({}).warnings.join(' ')).toMatch(/No work state on file, so professional tax was not calculated/);
    expect(line({ workState: 'Karnataka' }).warnings.join(' ')).toMatch(/Professional tax rule not configured for Karnataka/);
  });

  it('F7: net pay is whole rupees, with the rounding shown', () => {
    const l = line({ workState: 'KA' }, { lopDays: 3 });
    expect(l.netPaise % 100).toBe(0);
    expect(l.netPaise).toBe(l.grossPaise - l.totalDeductionsPaise + l.roundingPaise);
    expect(Math.abs(l.roundingPaise)).toBeLessThanOrEqual(50);
    expect(l.roundingPaise).not.toBe(0);
  });

  it('F8: warns when TDS is 0 above the basic exemption, not below it or when TDS is entered', () => {
    const high = { workState: 'KA', components: [{ code: 'BASIC', name: 'Basic', kind: 'EARNING', calc: 'FIXED', value: 12_700_000, statutoryWage: true }] };
    expect(line(high).warnings.join(' ')).toMatch(/No TDS entered, but annualised gross ₹15,24,000\.00 is above the ₹4,00,000\.00 basic exemption/);
    expect(line({ ...high, monthlyTdsPaise: 1_000_000 }).warnings.join(' ')).not.toMatch(/No TDS/);
    const low = { workState: 'KA', components: [{ code: 'BASIC', name: 'Basic', kind: 'EARNING', calc: 'FIXED', value: 3_000_000, statutoryWage: true }] };
    expect(line(low).warnings.join(' ')).not.toMatch(/No TDS/);
  });

  it('F4: the ECR caps EPS/EDLI wages at the rule ceiling and is produced as #~# text', async () => {
    await oak(() => payroll.upsertCompensation(P.FINANCE.actor, { profileId: P.TEACHER.actor.profileId, employeeCode: 'T001', uan: '100200300400', ...comp({ components: [{ code: 'BASIC', name: 'Basic', kind: 'EARNING', calc: 'FIXED', value: 9_000_000, statutoryWage: true }] }) }));
    const run = await oak(() => payroll.createRun(P.FINANCE.actor, { period: '2026-10' }));
    await oak(() => payroll.calculate(P.FINANCE.actor, run.id));
    const sent = await oak(() => payroll.submitRun(P.FINANCE.actor, run.id, { acknowledgeUnverifiedRules: true }));
    await oak(() => approvals.decide(P.PRINCIPAL.actor, sent.approvalRequestId, { action: 'APPROVE' }));
    const out = await oak(() => payroll.statutoryExport(P.FINANCE.actor, run.id, 'EPF_ECR'));
    const row = out.csv.split('\n').find((r) => r.startsWith('100200300400'));
    // Gross ₹90,000; EPF/EPS/EDLI wages capped at the ₹25,000 ceiling in force from 17-09-2026.
    expect(row.split(',').slice(2, 6)).toEqual(['90000', '25000', '25000', '25000']);
    const ecr = out.ecr.split('\n').find((r) => r.startsWith('100200300400'));
    expect(ecr.split('#~#')).toEqual(['100200300400', 'TEACHER PERSON', '90000', '25000', '25000', '25000', '3000', '2083', '917', '0', '0']);
  });
});
