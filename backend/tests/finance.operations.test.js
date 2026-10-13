import { describe, it, expect, beforeEach } from 'vitest';
import { seedRoles, seedPerson, inSchool, OAK } from './support/mcpSchool.js';
import * as approvals from '../src/modules/approvals/approval.service.js';
import * as payroll from '../src/modules/finance-ops/payroll.service.js';
import * as proc from '../src/modules/finance-ops/procurement.service.js';
import { StatutoryRule, EmployeeCompensation, Asset } from '../src/models/finance.model.js';

/**
 * Payroll arithmetic and controls; the procurement scenario end to end.
 * Statutory parameters come from the seeded (unverified) rule rows, never
 * from constants in the calculation.
 */

let roles;
let P;
const inOak = (fn) => inSchool(OAK, fn);
const approveAll = async (reqId) => {
  for (let i = 0; i < 5; i++) {
    const r = await inOak(() => approvals.getRequest(P.PRINCIPAL.actor, 'ALL', reqId));
    if (r.status !== 'PENDING') return r;
    const who = { PRINCIPAL: P.PRINCIPAL, FINANCE: P.FINANCE, TRUSTEE: P.TRUSTEE }[r.currentApproverRole];
    await inOak(() => approvals.decide(who.actor, reqId, { action: 'APPROVE' }));
  }
  return null;
};

const rules = () => payroll.SEED_RULES.map((r, i) => ({ ...r, _id: `r${i}`, jurisdiction: null, effectiveFrom: new Date(r.effectiveFrom), effectiveTo: r.effectiveTo ? new Date(r.effectiveTo) : null, verified: false }));
const comp = (over = {}) => ({
  profileId: 'p1', employeeCode: 'E1', name: 'Asha', joiningDate: new Date('2020-01-01'), pfApplicable: true, esiApplicable: false,
  bankLast4: '1234', monthlyTdsPaise: 0,
  components: [
    { code: 'BASIC', name: 'Basic', kind: 'EARNING', calc: 'FIXED', value: 3_000_000, statutoryWage: true, prorate: true },
    { code: 'HRA', name: 'HRA', kind: 'EARNING', calc: 'PERCENT_OF_BASIC', value: 4000, statutoryWage: false, prorate: true },
  ],
  ...over,
});
const find = (arr, code) => arr.find((x) => x.code === code)?.amountPaise ?? 0;

describe('payroll arithmetic', () => {
  it('applies the ₹15,000 EPF ceiling before 17-09-2026 and ₹25,000 from it', () => {
    const before = payroll.computeLine(comp(), rules(), { period: '2026-08' }).line;
    const after = payroll.computeLine(comp(), rules(), { period: '2026-10' }).line;
    // Basic ₹30,000, HRA 40% = ₹12,000; gross ₹42,000.
    expect(before.grossPaise).toBe(4_200_000);
    expect(find(before.deductions, 'EPF')).toBe(180_000); // 12% of 15,000
    expect(find(after.deductions, 'EPF')).toBe(300_000); // 12% of 25,000
    expect(find(before.employerContributions, 'EPS')).toBe(125_000); // 8.33% of 15,000 = 1249.5 → ₹1,250
    expect(find(after.employerContributions, 'EPS')).toBe(208_300); // ₹2,082.5 → ₹2,083 (PIB figure)
    expect(find(after.employerContributions, 'EPF_ER')).toBe(300_000 - 208_300);
  });

  it('adds back excluded allowances above 50% of remuneration to wages (Code on Social Security)', () => {
    const c = comp({ components: [
      { code: 'BASIC', name: 'Basic', kind: 'EARNING', calc: 'FIXED', value: 1_000_000, statutoryWage: true, prorate: true },
      { code: 'SPECIAL', name: 'Special', kind: 'EARNING', calc: 'FIXED', value: 3_000_000, statutoryWage: false, prorate: true },
    ] });
    const l = payroll.computeLine(c, rules(), { period: '2026-10' }).line;
    // Gross ₹40,000; excluded ₹30,000 > 50% (₹20,000) → wages = 10,000 + 10,000 = ₹20,000.
    expect(l.statutoryWagePaise).toBe(2_000_000);
    expect(find(l.deductions, 'EPF')).toBe(240_000);
    // Before 21-11-2025 there is no add-back.
    const old = payroll.computeLine(c, rules(), { period: '2025-10' }).line;
    expect(old.statutoryWagePaise).toBe(1_000_000);
  });

  it('prorates for loss of pay and mid-month joining', () => {
    const lop = payroll.computeLine(comp(), rules(), { period: '2026-10', lopDays: 3 }).line;
    expect(lop.paidDays).toBe(28);
    expect(lop.grossPaise).toBe(Math.round((3_000_000 * 28) / 31) + Math.round((1_200_000 * 28) / 31));
    const joiner = payroll.computeLine(comp({ joiningDate: new Date('2026-10-16') }), rules(), { period: '2026-10' }).line;
    expect(joiner.paidDays).toBe(16);
    expect(() => payroll.computeLine(comp(), rules(), { period: '2026-10', lopDays: 40 })).toThrow(/LOP/);
  });

  it('ESI applies only under the eligibility ceiling, PT warns when unconfigured, TDS is as entered', () => {
    const low = comp({ esiApplicable: true, workState: 'Maharashtra', monthlyTdsPaise: 50_000, components: [{ code: 'BASIC', name: 'Basic', kind: 'EARNING', calc: 'FIXED', value: 1_800_000, statutoryWage: true, prorate: true }] });
    const l = payroll.computeLine(low, rules(), { period: '2026-10' }).line;
    expect(find(l.deductions, 'ESI')).toBe(13_500); // 0.75% of 18,000 = 135
    expect(find(l.employerContributions, 'ESI_ER')).toBe(58_500); // 3.25% = 585
    expect(find(l.deductions, 'TDS')).toBe(50_000);
    expect(l.warnings.join(' ')).toMatch(/Professional tax rule not configured for Maharashtra/);
    const high = payroll.computeLine(comp({ esiApplicable: true }), rules(), { period: '2026-10' }).line;
    expect(find(high.deductions, 'ESI')).toBe(0);
  });

  it('net = gross + arrears + adjustments − deductions, exactly', () => {
    const l = payroll.computeLine(comp(), rules(), { period: '2026-10', arrearsPaise: 100_000, adjustments: [{ name: 'Advance recovery', amountPaise: -50_000, reason: 'x' }] }).line;
    expect(l.netPaise).toBe(l.grossPaise + 100_000 - 50_000 - l.totalDeductionsPaise);
  });
});

beforeEach(async () => {
  roles = await seedRoles();
  P = {};
  for (const key of ['ADMIN', 'PRINCIPAL', 'FINANCE', 'HR', 'TEACHER', 'TRUSTEE']) {
    P[key] = await seedPerson({ roleKey: key, roleId: roles[key], displayName: `${key} person` });
  }
});

describe('payroll run lifecycle', () => {
  it('prepare → approve (principal) → bank file → initiated → confirmed by someone else; locked once approved', async () => {
    await inOak(() => payroll.seedRules());
    await inOak(() => payroll.upsertCompensation(P.FINANCE.actor, { profileId: P.TEACHER.actor.profileId, employeeCode: 'T001', joiningDate: '2024-06-01', components: comp().components, bank: { accountNo: '123456789012', ifsc: 'SBIN0001234' } }));
    await inOak(() => payroll.upsertCompensation(P.FINANCE.actor, { profileId: P.HR.actor.profileId, employeeCode: 'H001', joiningDate: '2024-06-01', components: comp().components }));
    const stored = await inOak(() => EmployeeCompensation.findOne({ employeeCode: 'T001' }).lean());
    expect(stored.bankEnc).not.toContain('123456789012');

    const run = await inOak(() => payroll.createRun(P.FINANCE.actor, { period: '2026-10' }));
    await expect(inOak(() => payroll.createRun(P.FINANCE.actor, { period: '2026-10' }))).rejects.toMatchObject({ code: 'RUN_EXISTS' });
    await inOak(() => payroll.setInputs(P.FINANCE.actor, run.id, { inputs: [{ profileId: P.TEACHER.actor.profileId, lopDays: 1 }] }));
    const calc = await inOak(() => payroll.calculate(P.FINANCE.actor, run.id));
    expect(calc.totals.headcount).toBe(2);
    expect(calc.totals.grossPaise - calc.totals.deductionsPaise).toBe(calc.totals.netPaise);
    expect(calc.warnings.join(' ')).toMatch(/No bank account/);
    await expect(inOak(() => payroll.submitRun(P.FINANCE.actor, run.id))).rejects.toMatchObject({ code: 'UNVERIFIED_RULES' });
    const sent = await inOak(() => payroll.submitRun(P.FINANCE.actor, run.id, { acknowledgeUnverifiedRules: true }));
    // Finance cannot approve payroll; the principal does.
    expect(P.FINANCE.actor.permissions['payroll.approve']).toBeUndefined();
    await expect(inOak(() => payroll.bankFile(P.FINANCE.actor, run.id))).rejects.toMatchObject({ code: 'NOT_APPROVED' });
    await approveAll(sent.approvalRequestId);
    await expect(inOak(() => payroll.calculate(P.FINANCE.actor, run.id))).rejects.toMatchObject({ code: 'RUN_LOCKED' });

    const file = await inOak(() => payroll.bankFile(P.FINANCE.actor, run.id));
    expect(file.rows).toBe(1);
    expect(file.excluded).toBe(1);
    expect(file.csv).toContain('123456789012');
    await inOak(() => payroll.markPaymentInitiated(P.FINANCE.actor, run.id, { bankReference: 'BATCH-77' }));
    await expect(inOak(() => payroll.confirmPayment(P.FINANCE.actor, run.id, { confirmedAmountPaise: file.totalPaise }))).rejects.toMatchObject({ code: 'SAME_PERSON' });
    await expect(inOak(() => payroll.confirmPayment(P.HR.actor, run.id, { confirmedAmountPaise: file.totalPaise - 100 }))).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' });
    const paid = await inOak(() => payroll.confirmPayment(P.HR.actor, run.id, { confirmedAmountPaise: file.totalPaise }));
    expect(paid.status).toBe('PAYMENT_CONFIRMED');

    const ecr = await inOak(() => payroll.statutoryExport(P.FINANCE.actor, run.id, 'EPF_ECR'));
    expect(ecr.missingUan).toBe(2);
    await expect(inOak(() => payroll.recordStatutorySubmission(P.FINANCE.actor, run.id, { code: 'EPF_ECR' }))).rejects.toMatchObject({ code: 'EVIDENCE_REQUIRED' });
    await inOak(() => payroll.recordStatutorySubmission(P.FINANCE.actor, run.id, { code: 'EPF_ECR', acknowledgementNo: 'TRRN-123' }));

    const slips = await inOak(() => payroll.myPayslips(P.TEACHER.actor));
    expect(slips).toHaveLength(1);
    expect(slips[0]).toMatchObject({ period: '2026-10', status: 'PAID', lopDays: 1 });
    // An approver without payroll.sensitive.read sees totals, not individual pay.
    const principalView = await inOak(() => payroll.getRun(P.PRINCIPAL.actor, run.id));
    expect(principalView.lines[0].netPaise).toBeUndefined();
    expect(principalView.totals.netPaise).toBeGreaterThan(0);
  });

  it('a newly verified rule clears the unverified gate', async () => {
    await inOak(() => payroll.seedRules());
    const all = await inOak(() => StatutoryRule.find({}).lean());
    for (const r of all) await inOak(() => payroll.verifyRule(P.FINANCE.actor, String(r._id)));
    await inOak(() => payroll.upsertCompensation(P.FINANCE.actor, { profileId: P.TEACHER.actor.profileId, employeeCode: 'T1', joiningDate: '2024-01-01', components: comp().components, bank: { accountNo: '1234567', ifsc: 'HDFC0001234' } }));
    const run = await inOak(() => payroll.createRun(P.FINANCE.actor, { period: '2026-10' }));
    await inOak(() => payroll.calculate(P.FINANCE.actor, run.id));
    const sent = await inOak(() => payroll.submitRun(P.FINANCE.actor, run.id));
    expect(sent.status).toBe('IN_APPROVAL');
  });
});

describe('Scenario: procurement from request to payment, asset and budget reconciliation', () => {
  it('enforces quotes, separation of duties, duplicate invoices and three-way match', async () => {
    const budget = await inOak(() => proc.createBudget(P.FINANCE.actor, { fiscalYear: '2026-27', name: 'Main', lines: [{ code: 'LAB', head: 'Lab equipment', kind: 'CAPEX', plannedPaise: 20_000_000 }] }));
    await approveAll((await inOak(() => proc.submitBudget(P.FINANCE.actor, budget.id))).approvalRequestId);
    const vendors = [];
    for (const name of ['Alpha Scientific', 'Beta Labs', 'Gamma Supplies']) {
      const v = await inOak(() => proc.createVendor(P.FINANCE.actor, { name }));
      await inOak(() => proc.vendorDueDiligence(P.FINANCE.actor, v.id, { status: 'ACTIVE', note: 'GST and references checked' }));
      vendors.push(v);
    }
    const pr = await inOak(() => proc.createRequestDraft(P.TEACHER.actor, { title: 'Microscopes', budgetId: budget.id, budgetLineCode: 'LAB', items: [{ description: 'Compound microscope', qty: 10, estUnitPaise: 800_000, isAsset: true }] }));
    expect(pr.kind).toBe('CAPEX');
    await inOak(() => proc.setQuotes(P.TEACHER.actor, 'OWN', pr.id, { quotes: [{ vendorId: vendors[0].id, amountPaise: 7_800_000, selected: true }] }));
    await expect(inOak(() => proc.submit(P.TEACHER.actor, 'OWN', pr.id))).rejects.toMatchObject({ code: 'QUOTES_REQUIRED' });
    await expect(inOak(() => proc.setQuotes(P.TEACHER.actor, 'OWN', pr.id, { quotes: [
      { vendorId: vendors[0].id, amountPaise: 7_800_000 }, { vendorId: vendors[1].id, amountPaise: 7_500_000 }, { vendorId: vendors[2].id, amountPaise: 8_100_000, selected: true },
    ] }))).rejects.toThrow(/selectionNote/);
    await inOak(() => proc.setQuotes(P.TEACHER.actor, 'OWN', pr.id, { quotes: [
      { vendorId: vendors[0].id, amountPaise: 7_800_000 }, { vendorId: vendors[1].id, amountPaise: 7_500_000, selected: true }, { vendorId: vendors[2].id, amountPaise: 8_100_000 },
    ] }));
    const sub = await inOak(() => proc.submit(P.TEACHER.actor, 'OWN', pr.id));
    const req = await inOak(() => approvals.getRequest(P.PRINCIPAL.actor, 'ALL', sub.approvalRequestId));
    expect(req.category).toBe('CAPEX');
    await approveAll(sub.approvalRequestId);
    let budgets = await inOak(() => proc.listBudgets());
    expect(budgets[0].lines[0].committedPaise).toBe(7_500_000);

    const po = await inOak(() => proc.issuePo(P.FINANCE.actor, 'ALL', pr.id));
    expect(po.po.number).toMatch(/^PO\//);
    // A teacher (requester) cannot receive their own goods even if it were allowed by role.
    await expect(inOak(() => proc.receive({ ...P.TEACHER.actor }, 'ALL', pr.id, { lines: [{ itemIndex: 0, received: 10 }] }))).rejects.toMatchObject({ code: 'SELF_RECEIPT' });
    await expect(inOak(() => proc.receive(P.ADMIN.actor, 'ALL', pr.id, { lines: [{ itemIndex: 0, received: 11 }] }))).rejects.toMatchObject({ code: 'OVER_RECEIPT' });
    await inOak(() => proc.receive(P.ADMIN.actor, 'ALL', pr.id, { lines: [{ itemIndex: 0, received: 10, rejected: 2 }] }));
    // 8 accepted of 10 → expected ₹60,000; an invoice for ₹75,000 is a mismatch.
    const inv = await inOak(() => proc.addInvoice(P.FINANCE.actor, 'ALL', pr.id, { vendorInvoiceNo: 'BL/889', amountPaise: 7_500_000 }));
    expect(inv.invoices[0].matchStatus).toBe('MISMATCH');
    const payReq = await inOak(() => proc.approvePayment(P.FINANCE.actor, 'ALL', pr.id, { reason: 'Vendor will replace the 2 rejected units' }));
    await approveAll(payReq.payment.approvalRequestId);
    await inOak(() => proc.initiatePayment(P.FINANCE.actor, 'ALL', pr.id, { reference: 'NEFT-1' }));
    await expect(inOak(() => proc.confirmPayment(P.FINANCE.actor, 'ALL', pr.id, { bankReference: 'UTR1' }))).rejects.toMatchObject({ code: 'SAME_PERSON' });
    const finAlt = await seedPerson({ roleKey: 'FINANCE', roleId: roles.FINANCE, displayName: 'Accounts 2' });
    const paid = await inOak(() => proc.confirmPayment(finAlt.actor, 'ALL', pr.id, { bankReference: 'UTR1' }));
    expect(paid.status).toBe('PAID');
    budgets = await inOak(() => proc.listBudgets());
    expect(budgets[0].lines[0]).toMatchObject({ committedPaise: 0, actualPaise: 7_500_000 });
    expect(await inOak(() => Asset.countDocuments({}))).toBe(8);

    // The same vendor invoice number cannot be booked again.
    const pr2 = await inOak(() => proc.createRequestDraft(P.TEACHER.actor, { title: 'Slides', items: [{ description: 'Glass slides', qty: 1, estUnitPaise: 100_000 }] }));
    await inOak(() => proc.setQuotes(P.TEACHER.actor, 'OWN', pr2.id, { quotes: [{ vendorId: vendors[1].id, amountPaise: 100_000, selected: true }] }));
    const s2 = await inOak(() => proc.submit(P.TEACHER.actor, 'OWN', pr2.id));
    await approveAll(s2.approvalRequestId);
    await inOak(() => proc.issuePo(P.FINANCE.actor, 'ALL', pr2.id));
    await inOak(() => proc.receive(P.ADMIN.actor, 'ALL', pr2.id, { lines: [{ itemIndex: 0, received: 1 }] }));
    await expect(inOak(() => proc.addInvoice(P.FINANCE.actor, 'ALL', pr2.id, { vendorInvoiceNo: 'bl/889', amountPaise: 100_000 }))).rejects.toMatchObject({ code: 'DUPLICATE_INVOICE' });
  });

  it('flags possible split purchases and vendor conflicts to the approver', async () => {
    const v = await inOak(() => proc.createVendor(P.FINANCE.actor, { name: 'Nephew Traders' }));
    await inOak(() => proc.declareVendorConflict(P.PRINCIPAL.actor, v.id, { declaration: 'Owned by a relative' }));
    for (const amt of [3_000_000, 3_000_000]) {
      const pr = await inOak(() => proc.createRequestDraft(P.TEACHER.actor, { title: 'Chairs', items: [{ description: 'Chair', qty: 1, estUnitPaise: amt }] }));
      await inOak(() => proc.setQuotes(P.TEACHER.actor, 'OWN', pr.id, { quotes: [{ vendorId: v.id, amountPaise: amt, selected: true }] }));
      const sent = await inOak(() => proc.submit(P.TEACHER.actor, 'OWN', pr.id));
      if (amt && sent.checks.some((c) => c.code === 'POSSIBLE_SPLIT')) {
        expect(sent.checks.map((c) => c.code)).toEqual(expect.arrayContaining(['POSSIBLE_SPLIT', 'VENDOR_CONFLICT']));
        // Finance approves the budget stage; the conflicted principal cannot decide.
        await inOak(() => approvals.decide(P.FINANCE.actor, sent.approvalRequestId, { action: 'APPROVE' }));
        await expect(inOak(() => approvals.decide(P.PRINCIPAL.actor, sent.approvalRequestId, { action: 'APPROVE' }))).rejects.toMatchObject({ code: 'NOT_STAGE_APPROVER' });
        return;
      }
    }
    throw new Error('split purchase was not flagged');
  });

  it('EMI comparison for funding offers', () => {
    // ₹10,00,000 at 10% for 12 months → ₹87,916 EMI (standard formula).
    expect(Math.round(proc.emi(100_000_000, 1000, 12) / 100)).toBe(87916);
    expect(proc.emi(1200, 0, 12)).toBe(100);
  });
});
