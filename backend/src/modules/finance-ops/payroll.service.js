import crypto from 'node:crypto';
import { EmployeeCompensation, StatutoryRule, PayrollRun } from '../../models/finance.model.js';
import { Profile } from '../../models/profile.model.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { AppError } from '../../utils/AppError.js';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { createRequest, registerApprovalHandler } from '../approvals/approval.service.js';
import { notify } from '../notifications/notification.service.js';
import {
  nextRef, requireProfile, assertObjectId, assertTransition, pushHistory, asPaise, parseDate,
  requireText, optionalText, oneOf, dto,
} from '../ops/common.js';

/**
 * Payroll.
 *
 * Calculation is deterministic integer arithmetic on paise with rates in basis
 * points. Statutory parameters are never constants in code: they are
 * StatutoryRule rows with an effective date range, chosen for the last day of
 * the pay period. The ERP does not compute income tax; monthly TDS is entered
 * from the school's tax adviser.
 *
 * Status is what actually happened, step by step: CALCULATED is arithmetic,
 * APPROVED is the principal's decision, BANK_FILE_GENERATED is a file, and only
 * PAYMENT_CONFIRMED (with the bank's reference) means people were paid.
 * Statutory exports and their submissions are recorded separately, each with
 * its own acknowledgement.
 */

const MACHINE = {
  DRAFT: ['CALCULATED'],
  CALCULATED: ['CALCULATED', 'IN_APPROVAL', 'DRAFT'],
  IN_APPROVAL: ['APPROVED', 'CALCULATED'],
  APPROVED: ['BANK_FILE_GENERATED', 'CALCULATED'],
  BANK_FILE_GENERATED: ['PAYMENT_INITIATED', 'BANK_FILE_GENERATED'],
  PAYMENT_INITIATED: ['PAYMENT_CONFIRMED'],
  PAYMENT_CONFIRMED: ['CLOSED'],
  CLOSED: [],
};

/** Rounding helpers. Rates in bp; results in paise. */
export const pct = (paise, bp) => Math.round((paise * bp) / 10000);
export const toRupee = (paise) => Math.round(paise / 100) * 100;

// ── Statutory rules ─────────────────────────────────────────────────────

/**
 * Starting rules, from the source register (docs/research/regulatory-source-register.md).
 * Seeded UNVERIFIED: a payroll adviser confirms each before payroll is approved
 * without acknowledgement. The EPF ceiling change of 17-09-2026 (PAY-002) is
 * represented as two rows, so a September 2026 period after the change uses
 * the new ceiling and earlier periods the old.
 */
export const SEED_RULES = [
  { code: 'WAGE_DEFINITION', effectiveFrom: '2025-11-21', params: { exclusionCapBp: 5000 }, sourceRef: 'PAY-001', note: 'Code on Social Security 2020: excluded components above 50% of remuneration are added back to wages.' },
  { code: 'EPF_EMPLOYEE', effectiveFrom: '2014-09-01', effectiveTo: '2026-09-16', params: { rateBp: 1200, wageCeilingPaise: 1_500_000 }, sourceRef: 'PAY-003', note: 'Employee 12% of EPF wages.' },
  { code: 'EPF_EMPLOYEE', effectiveFrom: '2026-09-17', params: { rateBp: 1200, wageCeilingPaise: 2_500_000 }, sourceRef: 'PAY-002', note: 'Ceiling raised to ₹25,000 (S.O. 5109(E)).' },
  { code: 'EPS', effectiveFrom: '2014-09-01', effectiveTo: '2026-09-16', params: { rateBp: 833, wageCeilingPaise: 1_500_000 }, sourceRef: 'PAY-003', note: 'Employer share to pension, capped at the ceiling.' },
  { code: 'EPS', effectiveFrom: '2026-09-17', params: { rateBp: 833, wageCeilingPaise: 2_500_000 }, sourceRef: 'PAY-002', note: 'Max EPS ₹2,083 per PIB.' },
  { code: 'EPF_EMPLOYER', effectiveFrom: '2014-09-01', effectiveTo: '2026-09-16', params: { rateBp: 1200, wageCeilingPaise: 1_500_000 }, sourceRef: 'PAY-003', note: 'Employer 12%, of which EPS goes to pension and the rest to EPF.' },
  { code: 'EPF_EMPLOYER', effectiveFrom: '2026-09-17', params: { rateBp: 1200, wageCeilingPaise: 2_500_000 }, sourceRef: 'PAY-002' },
  { code: 'EDLI', effectiveFrom: '2014-09-01', effectiveTo: '2026-09-16', params: { rateBp: 50, wageCeilingPaise: 1_500_000 }, sourceRef: 'PAY-003' },
  { code: 'EDLI', effectiveFrom: '2026-09-17', params: { rateBp: 50, wageCeilingPaise: 2_500_000 }, sourceRef: 'PAY-002' },
  { code: 'ESI_EMPLOYEE', effectiveFrom: '2019-07-01', params: { rateBp: 75, eligibilityCeilingPaise: 2_100_000 }, sourceRef: 'PAY-004', note: 'Applies only where the State has notified educational institutions; enable per employee.' },
  { code: 'ESI_EMPLOYER', effectiveFrom: '2019-07-01', params: { rateBp: 325, eligibilityCeilingPaise: 2_100_000 }, sourceRef: 'PAY-004' },
];

export async function seedRules() {
  let added = 0;
  for (const r of SEED_RULES) {
    // eslint-disable-next-line no-await-in-loop
    const res = await StatutoryRule.updateOne(
      { code: r.code, jurisdiction: r.jurisdiction ?? null, effectiveFrom: new Date(r.effectiveFrom) },
      { $setOnInsert: { ...r, jurisdiction: r.jurisdiction ?? null, effectiveFrom: new Date(r.effectiveFrom), effectiveTo: r.effectiveTo ? new Date(r.effectiveTo) : null, verified: false } },
      { upsert: true },
    );
    added += res.upsertedCount ?? 0;
  }
  return { added };
}

export async function listRules() {
  return (await StatutoryRule.find({}).sort({ code: 1, jurisdiction: 1, effectiveFrom: -1 }).lean()).map(dto);
}

export async function upsertRule(actor, body = {}) {
  const code = oneOf(body.code, ['WAGE_DEFINITION', 'EPF_EMPLOYEE', 'EPF_EMPLOYER', 'EPS', 'EDLI', 'ESI_EMPLOYEE', 'ESI_EMPLOYER', 'PROFESSIONAL_TAX'], 'code');
  const params = body.params && typeof body.params === 'object' ? body.params : null;
  if (!params) throw new AppError('params are required', 400);
  for (const [k, v] of Object.entries(params)) {
    if (k === 'slabs') {
      if (!Array.isArray(v) || !v.every((s) => Number.isInteger(s.upToPaise ?? 0) && Number.isInteger(s.amountPaise))) throw new AppError('slabs must be [{ upToPaise|null, amountPaise }]', 400);
    } else if (!Number.isInteger(v) || v < 0) throw new AppError(`${k} must be a whole non-negative number (paise or basis points)`, 400);
  }
  const doc = await StatutoryRule.create({
    code, jurisdiction: code === 'PROFESSIONAL_TAX' ? requireText(body.jurisdiction, 'jurisdiction (state)', { max: 60 }) : null,
    effectiveFrom: parseDate(body.effectiveFrom, 'effectiveFrom', { required: true }), effectiveTo: parseDate(body.effectiveTo, 'effectiveTo'),
    params, sourceRef: optionalText(body.sourceRef, { max: 40 }) || null, sourceUrl: optionalText(body.sourceUrl, { max: 500 }) || null,
    verified: body.verified === true, verifiedByProfileId: body.verified === true ? actor.profileId : null, note: optionalText(body.note, { max: 1000 }) || null,
  });
  return dto(doc);
}

export async function verifyRule(actor, id) {
  const r = await StatutoryRule.findById(assertObjectId(id));
  if (!r) throw new AppError('Rule not found', 404);
  r.verified = true;
  r.verifiedByProfileId = actor.profileId;
  await r.save();
  return dto(r);
}

/** The rule of `code` in force on `at` (and for `jurisdiction` when given). */
export function ruleAt(rules, code, at, jurisdiction = null) {
  return rules
    .filter((r) => r.code === code && (r.jurisdiction ?? null) === (jurisdiction ?? null)
      && new Date(r.effectiveFrom) <= at && (!r.effectiveTo || new Date(r.effectiveTo) >= at))
    .sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom))[0] ?? null;
}

// ── Compensation ─────────────────────────────────────────────────────────

function presentComp(c, { sensitive }) {
  const out = dto(c);
  delete out.bankEnc;
  if (!sensitive) {
    delete out.components; delete out.monthlyTdsPaise; delete out.uan;
    out.bankLast4 = c.bankLast4 ? '••••' : null;
  }
  return out;
}

function cleanComponents(list) {
  if (!Array.isArray(list) || !list.length) throw new AppError('At least one pay component is required', 400);
  const codes = new Set();
  const out = list.slice(0, 40).map((c) => {
    const code = requireText(c.code, 'component code', { max: 20 }).toUpperCase();
    if (codes.has(code)) throw new AppError(`Component ${code} appears twice`, 400);
    codes.add(code);
    const calc = oneOf(c.calc, ['FIXED', 'PERCENT_OF_BASIC'], 'calc', 'FIXED');
    const value = Number(c.value);
    if (!Number.isInteger(value) || value < 0) throw new AppError(`${code}: value must be whole paise (FIXED) or basis points (PERCENT_OF_BASIC)`, 400);
    return { code, name: requireText(c.name, 'component name', { max: 60 }), kind: oneOf(c.kind, ['EARNING', 'DEDUCTION'], 'kind'), calc, value, statutoryWage: c.statutoryWage === true || ['BASIC', 'DA', 'RETAINING'].includes(code), prorate: c.prorate !== false };
  });
  if (!out.some((c) => c.code === 'BASIC' && c.kind === 'EARNING' && c.calc === 'FIXED')) throw new AppError('A fixed BASIC earning is required', 400);
  return out;
}

export async function upsertCompensation(actor, body = {}) {
  requireProfile(actor);
  const profileId = assertObjectId(body.profileId, 'profileId');
  const tenantId = currentTenantId();
  const person = await Profile.findOne({ _id: profileId, deletedAt: null, ...(tenantId ? { tenantId } : {}) }).select('displayName').lean();
  if (!person) throw new AppError('Employee not found in this school', 404);
  let c = await EmployeeCompensation.findOne({ profileId });
  const isNew = !c;
  if (!c) c = new EmployeeCompensation({ profileId, name: person.displayName });
  c.employeeCode = requireText(body.employeeCode ?? c.employeeCode, 'employeeCode', { max: 30 });
  c.joiningDate = parseDate(body.joiningDate ?? c.joiningDate, 'joiningDate', { required: true });
  for (const f of ['designation', 'department', 'workState', 'uan', 'panMasked']) if (body[f] !== undefined) c[f] = optionalText(body[f], { max: 80 }) || null;
  if (body.panMasked && !/^[A-Z•*x]{5}\d{0,4}[•*x]*[A-Z•*x]?$/i.test(body.panMasked)) c.panMasked = `•••••${String(body.panMasked).slice(-4)}`;
  if (body.employmentType !== undefined) c.employmentType = oneOf(body.employmentType, ['PERMANENT', 'PROBATION', 'CONTRACT', 'VISITING', 'PART_TIME'], 'employmentType');
  for (const f of ['pfApplicable', 'esiApplicable', 'pfOnActualWage']) if (body[f] !== undefined) c[f] = body[f] === true;
  if (body.taxRegime !== undefined) c.taxRegime = body.taxRegime ? oneOf(body.taxRegime, ['NEW', 'OLD'], 'taxRegime') : null;
  if (body.monthlyTdsPaise !== undefined) c.monthlyTdsPaise = asPaise(body.monthlyTdsPaise, 'monthlyTdsPaise');
  if (body.components !== undefined) c.components = cleanComponents(body.components);
  if (body.exitDate !== undefined) { c.exitDate = parseDate(body.exitDate, 'exitDate'); if (c.exitDate) c.status = 'EXITED'; }
  if (body.status !== undefined) c.status = oneOf(body.status, ['ACTIVE', 'ON_HOLD', 'EXITED'], 'status');
  if (body.bank && typeof body.bank === 'object') {
    const accountNo = String(body.bank.accountNo ?? '').replace(/\s+/g, '');
    const ifsc = String(body.bank.ifsc ?? '').toUpperCase().trim();
    if (!/^\d{6,20}$/.test(accountNo)) throw new AppError('Bank account number must be 6–20 digits', 400);
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new AppError('IFSC must look like ABCD0123456', 400);
    c.bankEnc = encrypt({ holder: optionalText(body.bank.holder, { max: 120 }) || c.name, accountNo, ifsc });
    c.bankLast4 = accountNo.slice(-4);
  }
  if (!c.components?.length) throw new AppError('Pay components are required', 400);
  pushHistory(c, actor, isNew ? 'CREATED' : 'UPDATED');
  try { await c.save(); } catch (err) { if (err?.code === 11000) throw new AppError('That employee code is already used', 409); throw err; }
  return presentComp(c.toObject(), { sensitive: true });
}

export async function listCompensation(actor) {
  const sensitive = Boolean(actor.permissions?.['payroll.sensitive.read']);
  const rows = await EmployeeCompensation.find({}).sort({ employeeCode: 1 }).lean();
  return rows.map((c) => presentComp(c, { sensitive }));
}

// ── Calculation ──────────────────────────────────────────────────────────

function periodBounds(period) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(period))) throw new AppError('period must be YYYY-MM', 400);
  const [y, m] = period.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0)); // last day
  return { start, end, days: end.getUTCDate() };
}

/**
 * One employee's pay for a period. Pure: same inputs, same result.
 * Exported so the arithmetic is tested directly.
 */
export function computeLine(comp, rules, { period, lopDays = 0, arrearsPaise = 0, adjustments = [] }) {
  const { start, end, days } = periodBounds(period);
  const warnings = [];
  // Days employed in the period (joining/exit mid-month), less loss-of-pay days.
  const from = comp.joiningDate && new Date(comp.joiningDate) > start ? new Date(comp.joiningDate) : start;
  const to = comp.exitDate && new Date(comp.exitDate) < end ? new Date(comp.exitDate) : end;
  const employedDays = Math.max(0, Math.round((to - from) / 86_400_000) + 1);
  if (lopDays < 0 || lopDays > employedDays) throw new AppError(`${comp.name}: LOP days must be between 0 and ${employedDays}`, 400);
  const paidDays = employedDays - lopDays;
  const prorate = (amount, yes) => (yes ? Math.round((amount * paidDays) / days) : amount);

  const basicComp = comp.components.find((c) => c.code === 'BASIC');
  const basic = prorate(basicComp.value, basicComp.prorate);
  const earnings = [];
  const deductions = [];
  for (const c of comp.components) {
    const monthly = c.calc === 'FIXED' ? c.value : pct(basicComp.value, c.value);
    const amount = c.code === 'BASIC' ? basic : prorate(monthly, c.prorate);
    (c.kind === 'EARNING' ? earnings : deductions).push({ code: c.code, name: c.name, amountPaise: amount, statutoryWage: c.statutoryWage });
  }
  const gross = earnings.reduce((n, e) => n + e.amountPaise, 0);

  // Wages for social security.
  let statutoryWage = earnings.filter((e) => e.statutoryWage).reduce((n, e) => n + e.amountPaise, 0);
  const wageRule = ruleAt(rules, 'WAGE_DEFINITION', end);
  if (wageRule) {
    const excluded = gross - statutoryWage;
    const cap = pct(gross, wageRule.params.exclusionCapBp);
    if (excluded > cap) statutoryWage += excluded - cap;
  }
  const employer = [];
  const applied = [];
  const use = (code) => {
    const r = ruleAt(rules, code, end);
    if (r) applied.push({ ruleId: String(r._id ?? ''), code, verified: Boolean(r.verified), effectiveFrom: r.effectiveFrom });
    return r;
  };

  if (comp.pfApplicable) {
    const ee = use('EPF_EMPLOYEE'); const eps = use('EPS'); const er = use('EPF_EMPLOYER'); const edli = use('EDLI');
    if (!ee || !er || !eps) warnings.push('EPF rules are not configured for this period; PF not calculated.');
    else {
      const capped = Math.min(statutoryWage, ee.params.wageCeilingPaise);
      const pfWage = comp.pfOnActualWage ? statutoryWage : capped;
      const eeAmt = toRupee(pct(pfWage, ee.params.rateBp));
      const epsAmt = toRupee(pct(Math.min(statutoryWage, eps.params.wageCeilingPaise), eps.params.rateBp));
      const erTotal = toRupee(pct(comp.pfOnActualWage ? statutoryWage : Math.min(statutoryWage, er.params.wageCeilingPaise), er.params.rateBp));
      deductions.push({ code: 'EPF', name: 'Provident fund (employee)', amountPaise: eeAmt });
      employer.push({ code: 'EPS', name: 'Pension (EPS)', amountPaise: epsAmt });
      employer.push({ code: 'EPF_ER', name: 'Provident fund (employer)', amountPaise: Math.max(0, erTotal - epsAmt) });
      if (edli) employer.push({ code: 'EDLI', name: 'EDLI', amountPaise: toRupee(pct(Math.min(statutoryWage, edli.params.wageCeilingPaise), edli.params.rateBp)) });
    }
  }
  if (comp.esiApplicable) {
    const ee = use('ESI_EMPLOYEE'); const er = use('ESI_EMPLOYER');
    if (!ee || !er) warnings.push('ESI rules are not configured for this period; ESI not calculated.');
    else if (gross <= ee.params.eligibilityCeilingPaise) {
      deductions.push({ code: 'ESI', name: 'ESI (employee)', amountPaise: toRupee(pct(gross, ee.params.rateBp)) });
      employer.push({ code: 'ESI_ER', name: 'ESI (employer)', amountPaise: toRupee(pct(gross, er.params.rateBp)) });
    } else warnings.push('Gross is above the ESI eligibility ceiling; ESI not deducted. Confirm continuation rules for the contribution period.');
  }
  if (comp.workState) {
    const pt = ruleAt(rules, 'PROFESSIONAL_TAX', end, comp.workState);
    if (!pt) warnings.push(`Professional tax rule not configured for ${comp.workState}.`);
    else {
      applied.push({ ruleId: String(pt._id ?? ''), code: 'PROFESSIONAL_TAX', verified: Boolean(pt.verified), effectiveFrom: pt.effectiveFrom });
      const slab = (pt.params.slabs ?? []).find((s) => s.upToPaise === null || s.upToPaise === undefined || gross <= s.upToPaise);
      if (slab?.amountPaise) deductions.push({ code: 'PT', name: 'Professional tax', amountPaise: slab.amountPaise });
    }
  }
  if (comp.monthlyTdsPaise) deductions.push({ code: 'TDS', name: 'Income tax (TDS)', amountPaise: comp.monthlyTdsPaise });

  const adj = (adjustments ?? []).map((a) => ({ name: String(a.name).slice(0, 80), amountPaise: Math.trunc(Number(a.amountPaise) || 0), reason: String(a.reason ?? '').slice(0, 300) }));
  const totalDeductions = deductions.reduce((n, d) => n + d.amountPaise, 0);
  const net = gross + arrearsPaise + adj.reduce((n, a) => n + a.amountPaise, 0) - totalDeductions;
  if (net < 0) warnings.push('Net pay is negative; review deductions and adjustments.');
  if (!comp.bankLast4) warnings.push('No bank account on file; excluded from the bank file.');

  return {
    line: {
      profileId: comp.profileId, employeeCode: comp.employeeCode, name: comp.name,
      daysInPeriod: days, lopDays, paidDays,
      earnings: earnings.map(({ statutoryWage: _s, ...e }) => e), deductions, employerContributions: employer,
      arrearsPaise, adjustments: adj, statutoryWagePaise: statutoryWage,
      grossPaise: gross, totalDeductionsPaise: totalDeductions, netPaise: net,
      bankReady: Boolean(comp.bankLast4) && net > 0, warnings,
    },
    applied,
  };
}

async function load(id) {
  const run = await PayrollRun.findById(assertObjectId(id));
  if (!run) throw new AppError('Payroll run not found', 404);
  return run;
}

function move(run, actor, to, note) {
  assertTransition(MACHINE, run.status, to, 'payroll run');
  pushHistory(run, actor, to, { from: run.status, to, note });
  run.status = to;
}

function presentRun(run, actor, { lines = true } = {}) {
  const out = dto(run);
  const sensitive = Boolean(actor?.permissions?.['payroll.sensitive.read']);
  if (!lines) delete out.lines;
  else if (!sensitive) {
    // Totals for approvers; individual pay only for payroll staff.
    out.lines = (out.lines ?? []).map((l) => ({ name: l.name, employeeCode: l.employeeCode, paidDays: l.paidDays, lopDays: l.lopDays, warnings: l.warnings }));
  }
  out.unverifiedRules = (out.rulesApplied ?? []).filter((r) => !r.verified).map((r) => r.code);
  return out;
}

export async function createRun(actor, body = {}) {
  requireProfile(actor);
  const period = String(body.period ?? '');
  periodBounds(period);
  const kind = oneOf(body.kind, ['REGULAR', 'OFF_CYCLE', 'FULL_AND_FINAL'], 'kind', 'REGULAR');
  if (kind === 'REGULAR' && await PayrollRun.exists({ period, kind: 'REGULAR' })) {
    throw new AppError(`A regular payroll run for ${period} already exists.`, 409, [], 'RUN_EXISTS');
  }
  const run = await PayrollRun.create({ refNo: await nextRef('PAY'), period, kind, preparedByProfileId: actor.profileId, history: [] });
  pushHistory(run, actor, 'CREATED', { to: 'DRAFT' });
  await run.save();
  return presentRun(run.toObject(), actor);
}

export async function setInputs(actor, id, body = {}) {
  const run = await load(id);
  if (!['DRAFT', 'CALCULATED'].includes(run.status)) throw new AppError('Inputs are locked once the run is sent for approval.', 409, [], 'RUN_LOCKED');
  run.inputs = (Array.isArray(body.inputs) ? body.inputs : []).slice(0, 5000).map((i) => ({
    profileId: assertObjectId(i.profileId, 'profileId'),
    lopDays: Math.max(0, Number(i.lopDays) || 0),
    arrearsPaise: asPaise(i.arrearsPaise ?? 0, 'arrearsPaise'),
    adjustments: Array.isArray(i.adjustments) ? i.adjustments.slice(0, 20).map((a) => {
      const amt = Number(a.amountPaise);
      if (!Number.isInteger(amt)) throw new AppError('Adjustment amounts are whole paise (negative for a recovery)', 400);
      return { name: requireText(a.name, 'adjustment name', { max: 80 }), amountPaise: amt, reason: requireText(a.reason, 'adjustment reason', { max: 300 }) };
    }) : [],
  }));
  if (run.status === 'CALCULATED') move(run, actor, 'DRAFT', 'Inputs changed; recalculate');
  else pushHistory(run, actor, 'INPUTS_UPDATED');
  await run.save();
  return presentRun(run.toObject(), actor);
}

export async function calculate(actor, id) {
  const run = await load(id);
  if (!['DRAFT', 'CALCULATED'].includes(run.status)) throw new AppError('An approved or paid run cannot be recalculated.', 409, [], 'RUN_LOCKED');
  const { start, end } = periodBounds(run.period);
  const [comps, rules] = await Promise.all([
    EmployeeCompensation.find({ status: { $ne: 'ON_HOLD' }, joiningDate: { $lte: end }, $or: [{ exitDate: null }, { exitDate: { $gte: start } }] }).lean(),
    StatutoryRule.find({}).lean(),
  ]);
  const inputBy = new Map((run.inputs ?? []).map((i) => [String(i.profileId), i]));
  const lines = [];
  const applied = new Map();
  for (const c of comps) {
    const inp = inputBy.get(String(c.profileId)) ?? {};
    const { line, applied: a } = computeLine(c, rules, { period: run.period, lopDays: inp.lopDays ?? 0, arrearsPaise: inp.arrearsPaise ?? 0, adjustments: inp.adjustments ?? [] });
    lines.push(line);
    for (const r of a) applied.set(`${r.code}:${r.ruleId}`, r);
  }
  run.lines = lines;
  run.rulesApplied = [...applied.values()];
  run.totals = {
    grossPaise: lines.reduce((n, l) => n + l.grossPaise + l.arrearsPaise + l.adjustments.reduce((m, a) => m + a.amountPaise, 0), 0),
    deductionsPaise: lines.reduce((n, l) => n + l.totalDeductionsPaise, 0),
    netPaise: lines.reduce((n, l) => n + l.netPaise, 0),
    employerContributionsPaise: lines.reduce((n, l) => n + l.employerContributions.reduce((m, e) => m + e.amountPaise, 0), 0),
    headcount: lines.length,
  };
  // Reconciliation invariant: gross (incl. arrears/adjustments) − deductions = net.
  if (run.totals.grossPaise - run.totals.deductionsPaise !== run.totals.netPaise) throw new AppError('Payroll totals do not reconcile', 500);
  run.warnings = [
    ...lines.filter((l) => l.warnings.length).map((l) => `${l.name}: ${l.warnings.join(' ')}`),
    ...(run.rulesApplied.some((r) => !r.verified) ? ['Some statutory rules used are not yet verified by the payroll adviser.'] : []),
  ];
  run.calculatedAt = new Date();
  run.unverifiedRulesAcknowledged = false;
  move(run, actor, 'CALCULATED', `${lines.length} employees`);
  await run.save();
  return presentRun(run.toObject(), actor);
}

export async function submitRun(actor, id, body = {}) {
  const run = await load(id);
  if (run.status !== 'CALCULATED') throw new AppError('Calculate the run before sending it for approval.', 409);
  if (run.lines.some((l) => l.netPaise < 0)) throw new AppError('Resolve negative net pay before approval.', 409, [], 'NEGATIVE_NET');
  if (run.rulesApplied.some((r) => !r.verified)) {
    if (body.acknowledgeUnverifiedRules !== true) throw new AppError('Some statutory rules are unverified. Verify them, or acknowledge explicitly.', 409, [], 'UNVERIFIED_RULES');
    run.unverifiedRulesAcknowledged = true;
  }
  move(run, actor, 'IN_APPROVAL');
  await run.save();
  const req = await createRequest(actor, {
    category: run.kind === 'REGULAR' ? 'PAYROLL_RUN' : 'PAYROLL_EXCEPTION',
    title: `Payroll ${run.period}${run.kind !== 'REGULAR' ? ` (${run.kind.replace(/_/g, ' ').toLowerCase()})` : ''}: ${run.totals.headcount} employees`,
    amountPaise: run.totals.netPaise,
    summary: [
      `Gross ₹${(run.totals.grossPaise / 100).toFixed(2)}, deductions ₹${(run.totals.deductionsPaise / 100).toFixed(2)}, net ₹${(run.totals.netPaise / 100).toFixed(2)}.`,
      `Employer contributions ₹${(run.totals.employerContributionsPaise / 100).toFixed(2)}.`,
      run.warnings.length ? `Warnings (${run.warnings.length}): ${run.warnings.slice(0, 5).join(' | ')}` : 'No warnings.',
      run.unverifiedRulesAcknowledged ? 'Preparer acknowledged unverified statutory rules.' : '',
    ].filter(Boolean).join('\n'),
  }, { entityType: 'PayrollRun', entityId: run._id });
  run.approvalRequestId = req.id;
  await run.save();
  return presentRun(run.toObject(), actor);
}

registerApprovalHandler('PayrollRun', {
  async onApproved(req, actor) { const r = await PayrollRun.findById(req.entityId); if (!r) return; move(r, actor, 'APPROVED'); await r.save(); },
  async onRejected(req, actor) { const r = await PayrollRun.findById(req.entityId); if (!r) return; move(r, actor, 'CALCULATED', req.stages[req.currentStage]?.comment); r.approvalRequestId = null; await r.save(); },
  async onReturned(req, actor) { const r = await PayrollRun.findById(req.entityId); if (!r) return; move(r, actor, 'CALCULATED', req.stages[req.currentStage]?.comment); r.approvalRequestId = null; await r.save(); },
});

/** Reopening an approved run voids the approval; only before money moves. */
export async function reopen(actor, id, { reason } = {}) {
  const run = await load(id);
  if (run.status !== 'APPROVED') throw new AppError('Only an approved run that has not gone to the bank can be reopened.', 409);
  move(run, actor, 'CALCULATED', requireText(reason, 'reason', { max: 500 }));
  run.approvalRequestId = null;
  await run.save();
  return presentRun(run.toObject(), actor);
}

/**
 * The bank upload file (CSV). Contains full account numbers, so only roles
 * with payroll.sensitive.read get it. Generating it is not paying anyone.
 */
export async function bankFile(actor, id) {
  const run = await load(id);
  if (!['APPROVED', 'BANK_FILE_GENERATED'].includes(run.status)) throw new AppError('The bank file is available once the run is approved.', 409, [], 'NOT_APPROVED');
  const comps = await EmployeeCompensation.find({ profileId: { $in: run.lines.map((l) => l.profileId) } }).lean();
  const bankBy = new Map(comps.map((c) => [String(c.profileId), c.bankEnc ? decrypt(c.bankEnc) : null]));
  const rows = run.lines.filter((l) => l.bankReady).map((l) => {
    const b = bankBy.get(String(l.profileId));
    return [l.employeeCode, b?.holder ?? l.name, b?.accountNo ?? '', b?.ifsc ?? '', (l.netPaise / 100).toFixed(2), `SALARY ${run.period}`];
  });
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = [['EmployeeCode', 'BeneficiaryName', 'AccountNumber', 'IFSC', 'Amount', 'Narration'], ...rows].map((r) => r.map(esc).join(',')).join('\n');
  const totalPaise = run.lines.filter((l) => l.bankReady).reduce((n, l) => n + l.netPaise, 0);
  run.bankFile = { generatedAt: new Date(), byProfileId: actor.profileId, rows: rows.length, totalPaise, checksum: crypto.createHash('sha256').update(csv).digest('hex') };
  if (run.status === 'APPROVED') move(run, actor, 'BANK_FILE_GENERATED', `${rows.length} rows`);
  else pushHistory(run, actor, 'BANK_FILE_REGENERATED');
  await run.save();
  return { csv, rows: rows.length, totalPaise, excluded: run.lines.length - rows.length, checksum: run.bankFile.checksum };
}

export async function markPaymentInitiated(actor, id, body = {}) {
  const run = await load(id);
  if (run.status !== 'BANK_FILE_GENERATED') throw new AppError('Generate the bank file first.', 409);
  run.payment = { ...(run.payment ?? {}), initiatedAt: new Date(), initiatedByProfileId: actor.profileId, bankReference: requireText(body.bankReference, 'bankReference (batch/upload id)', { max: 120 }) };
  move(run, actor, 'PAYMENT_INITIATED', run.payment.bankReference);
  await run.save();
  return presentRun(run.toObject(), actor);
}

/** Bank confirms. The confirmed amount is reconciled against the file total. */
export async function confirmPayment(actor, id, body = {}) {
  const run = await load(id);
  if (run.status !== 'PAYMENT_INITIATED') throw new AppError('Payment must be initiated first.', 409);
  if (String(run.payment?.initiatedByProfileId) === String(actor.profileId)) throw new AppError('A different person confirms the payment from the bank statement.', 403, [], 'SAME_PERSON');
  const confirmed = asPaise(body.confirmedAmountPaise, 'confirmedAmountPaise');
  run.payment.confirmedAt = parseDate(body.confirmedAt, 'confirmedAt') ?? new Date();
  run.payment.confirmedByProfileId = actor.profileId;
  run.payment.confirmedAmountPaise = confirmed;
  run.payment.mismatchPaise = confirmed - (run.bankFile?.totalPaise ?? 0);
  if (run.payment.mismatchPaise !== 0 && !optionalText(body.note)) throw new AppError(`Confirmed amount differs from the bank file by ₹${(run.payment.mismatchPaise / 100).toFixed(2)}. Explain the difference.`, 409, [], 'PAYMENT_MISMATCH');
  move(run, actor, 'PAYMENT_CONFIRMED', body.note);
  run.markModified('payment');
  await run.save();
  await notify({ recipientProfileIds: run.lines.map((l) => String(l.profileId)), type: 'SYSTEM', title: `Salary for ${run.period} paid`, body: 'Your payslip is available.', link: '/payslips' });
  return presentRun(run.toObject(), actor);
}

const STATUTORY_EXPORTS = ['EPF_ECR', 'ESI', 'PT', 'TDS_24Q'];

/**
 * A statutory export for a run (a summary file to key into, or upload to, the
 * authority's portal) and, separately, the record of its submission.
 */
export async function statutoryExport(actor, id, code) {
  const run = await load(id);
  const kind = oneOf(code, STATUTORY_EXPORTS, 'code');
  if (!['APPROVED', 'BANK_FILE_GENERATED', 'PAYMENT_INITIATED', 'PAYMENT_CONFIRMED', 'CLOSED'].includes(run.status)) throw new AppError('Statutory exports are available once the run is approved.', 409);
  const comps = await EmployeeCompensation.find({ profileId: { $in: run.lines.map((l) => l.profileId) } }).select('profileId uan').lean();
  const uan = new Map(comps.map((c) => [String(c.profileId), c.uan]));
  const val = (l, codeKey, arr = 'deductions') => (l[arr].find((d) => d.code === codeKey)?.amountPaise ?? 0);
  let header; let rows;
  if (kind === 'EPF_ECR') {
    header = ['UAN', 'Name', 'GrossWages', 'EPFWages', 'EPSWages', 'EDLIWages', 'EE_EPF', 'ER_EPS', 'ER_EPF', 'NCPDays'];
    rows = run.lines.filter((l) => val(l, 'EPF') > 0).map((l) => [uan.get(String(l.profileId)) ?? 'MISSING', l.name, l.grossPaise / 100, l.statutoryWagePaise / 100, l.statutoryWagePaise / 100, l.statutoryWagePaise / 100, val(l, 'EPF') / 100, val(l, 'EPS', 'employerContributions') / 100, val(l, 'EPF_ER', 'employerContributions') / 100, l.lopDays]);
  } else if (kind === 'ESI') {
    header = ['Name', 'Days', 'GrossWages', 'EE_ESI', 'ER_ESI'];
    rows = run.lines.filter((l) => val(l, 'ESI') > 0).map((l) => [l.name, l.paidDays, l.grossPaise / 100, val(l, 'ESI') / 100, val(l, 'ESI_ER', 'employerContributions') / 100]);
  } else if (kind === 'PT') {
    header = ['EmployeeCode', 'Name', 'Gross', 'PT'];
    rows = run.lines.filter((l) => val(l, 'PT') > 0).map((l) => [l.employeeCode, l.name, l.grossPaise / 100, val(l, 'PT') / 100]);
  } else {
    header = ['EmployeeCode', 'Name', 'Gross', 'TDS'];
    rows = run.lines.filter((l) => val(l, 'TDS') > 0).map((l) => [l.employeeCode, l.name, l.grossPaise / 100, val(l, 'TDS') / 100]);
  }
  const csv = [`# ${kind} working file for ${run.period} (${run.refNo}). Not a filing — key into / upload to the official portal and record the acknowledgement.`, header.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const entry = run.statutory.find((s) => s.code === kind);
  if (entry) { entry.exportedAt = new Date(); entry.exportedByProfileId = actor.profileId; } else run.statutory.push({ code: kind, exportedAt: new Date(), exportedByProfileId: actor.profileId });
  pushHistory(run, actor, `EXPORT_${kind}`);
  await run.save();
  return { csv, rows: rows.length, missingUan: kind === 'EPF_ECR' ? rows.filter((r) => r[0] === 'MISSING').length : 0 };
}

export async function recordStatutorySubmission(actor, id, body = {}) {
  const run = await load(id);
  const kind = oneOf(body.code, STATUTORY_EXPORTS, 'code');
  const entry = run.statutory.find((s) => s.code === kind);
  if (!entry?.exportedAt) throw new AppError('Export the working file first.', 409);
  const ack = optionalText(body.acknowledgementNo, { max: 120 }) || null;
  const challan = optionalText(body.challanNo, { max: 120 }) || null;
  if (!ack && !challan) throw new AppError('Record the portal acknowledgement or challan number.', 400, [], 'EVIDENCE_REQUIRED');
  entry.submittedAt = parseDate(body.submittedAt, 'submittedAt') ?? new Date();
  entry.acknowledgementNo = ack; entry.challanNo = challan;
  entry.amountPaise = body.amountPaise === undefined ? null : asPaise(body.amountPaise);
  pushHistory(run, actor, `SUBMITTED_${kind}`, { note: ack ?? challan });
  run.markModified('statutory');
  await run.save();
  return presentRun(run.toObject(), actor);
}

export async function closeRun(actor, id) {
  const run = await load(id);
  move(run, actor, 'CLOSED');
  await run.save();
  return presentRun(run.toObject(), actor);
}

export async function listRuns(actor) {
  const rows = await PayrollRun.find({}).sort({ period: -1, createdAt: -1 }).limit(60).select('-lines -inputs').lean();
  return rows.map((r) => presentRun(r, actor, { lines: false }));
}

export async function getRun(actor, id) {
  return presentRun((await load(id)).toObject(), actor);
}

/** An employee's own payslips: approved runs only. */
export async function myPayslips(actor) {
  requireProfile(actor);
  const runs = await PayrollRun.find({ status: { $in: ['APPROVED', 'BANK_FILE_GENERATED', 'PAYMENT_INITIATED', 'PAYMENT_CONFIRMED', 'CLOSED'] }, 'lines.profileId': actor.profileId })
    .sort({ period: -1 }).limit(36).lean();
  return runs.map((r) => {
    const l = r.lines.find((x) => String(x.profileId) === String(actor.profileId));
    return { runId: String(r._id), period: r.period, kind: r.kind, status: r.status === 'PAYMENT_CONFIRMED' || r.status === 'CLOSED' ? 'PAID' : 'APPROVED_NOT_YET_PAID', ...l, _id: undefined, profileId: undefined };
  });
}
