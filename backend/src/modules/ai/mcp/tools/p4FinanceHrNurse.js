import * as collections from '../../../p4ops/collections.service.js';
import * as people from '../../../p4ops/people.service.js';
import * as watch from '../../../p4ops/healthInsights.service.js';
import * as health from '../../../health/health.service.js';
import * as payroll from '../../../finance-ops/payroll.service.js';
import * as staffLeave from '../../../staff/staffLeave.service.js';
import * as verification from '../../../administration/verification.service.js';
import { EmployeeCompensation } from '../../../../models/finance.model.js';
import { Profile } from '../../../../models/profile.model.js';
import { Role } from '../../../../models/role.model.js';
import { CANDIDATE_STAGES, EXIT_KINDS, CLEARANCE_DEPARTMENTS, DENOMINATIONS } from '../../../../models/p4People.model.js';
import { VISIT_OUTCOMES } from '../../../../models/health.model.js';
import { featureEnabled } from '../../../../utils/features.js';
import { AppError } from '../../../../utils/AppError.js';
import { escapeRegex } from '../../../ops/common.js';
import { ok, action } from '../protocol.js';
import { RISK, rupees, theNamed } from './_shared.js';

/**
 * Part 4: the bursar's, HR's and the nurse's own work through the assistant
 * (Ask AI and WhatsApp), one tool per action on their screens that had none.
 *
 * Every tool calls the same service as the screen, so the permission, the
 * second-person rules and the audit trail are the screen's. Writes are shown
 * as a concrete draft and run only when the same person confirms; anything
 * that touches money, another person's record or a family is HIGH risk (or
 * affectsOthers) and therefore confirmed on the website, never by a bare
 * WhatsApp "yes". Nothing here approves, pays, refunds or decides: a payroll
 * run still goes to the principal, a cash count is checked by a second
 * person on the website, a settlement waits on payroll approval.
 *
 * Health: the nurse only (health.manage at ALL), like the Health page.
 */

const text = (max, description) => ({ type: 'string', maxLength: max, ...(description && { description }) });
const closed = (properties, required = []) => ({ type: 'object', properties, ...(required.length && { required }), additionalProperties: false });
const DATE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const MONTH = { type: 'string', pattern: '^\\d{4}-\\d{2}$' };
const date = (description) => ({ ...DATE, description });
const rupeeAmount = (description) => ({ type: 'number', minimum: 0, maximum: 100000000, description });
const toPaise = (r) => (r === undefined || r === null ? undefined : Math.round(Number(r) * 100));

function healthOn(tool) {
  const { run, prepare } = tool;
  const check = async () => { if (!(await featureEnabled('healthRoom'))) throw new AppError('The health room is switched off for this school.', 403, [], 'FEATURE_OFF'); };
  return {
    ...tool, feature: 'healthRoom',
    async run(ctx, args, p) { await check(); return run.call(this, ctx, args, p); },
    ...(prepare && { async prepare(ctx, args) { await check(); return prepare.call(this, ctx, args); } }),
  };
}

/** A member of staff named in words (never a family account). */
async function staffNamed(ctx, name) {
  const q = String(name ?? '').trim();
  if (q.length < 2) throw new AppError('Which member of staff? Name them.', 400, [], 'AGENT_NEEDS_INPUT');
  const roles = await Role.find({ key: { $nin: ['PARENT', 'STUDENT', 'ALUMNUS', 'SUPER_ADMIN'] } }).select('_id').lean();
  const rows = await Profile.find({ displayName: new RegExp(escapeRegex(q), 'i'), roleId: { $in: roles.map((r) => r._id) }, deletedAt: null, ...(ctx.actor.tenantId ? { tenantId: ctx.actor.tenantId } : {}) }).select('displayName').limit(8).lean();
  return theNamed(rows.map((r) => ({ id: String(r._id), name: r.displayName })), q, { label: 'member of staff', nameOf: (r) => r.name });
}

async function vacancyNamed(ctx, term) {
  const { items } = await people.listVacancies(ctx.actor, {});
  const open = items.filter((v) => v.status === 'OPEN');
  if (!term) {
    if (open.length === 1) return open[0];
    throw new AppError(`Which vacancy? ${open.map((v) => `${v.title} (${v.refNo})`).join(', ') || 'None is open.'}`, 400, [], 'AGENT_NEEDS_INPUT');
  }
  const t = String(term).trim().toLowerCase();
  const byRef = items.find((v) => v.refNo.toLowerCase() === t);
  return byRef ?? theNamed(items, term, { label: 'vacancy', nameOf: (v) => v.title, describe: (v) => `${v.title} (${v.refNo})` });
}

async function candidateNamed(ctx, name, vacancy) {
  const { items } = await people.listCandidates(ctx.actor, { q: name, ...(vacancy && { vacancyId: vacancy.id }) });
  return theNamed(items, name, { label: 'candidate', nameOf: (c) => c.name, describe: (c) => `${c.name} (${c.vacancy?.title ?? c.refNo}, ${c.stage.toLowerCase()})` });
}

async function exitFor(ctx, name) {
  const { items } = await people.listExits(ctx.actor, {});
  return theNamed(items, name, { label: 'open exit', nameOf: (x) => x.name, describe: (x) => `${x.name} (${x.refNo})` });
}

async function runFor(ctx, { run: term }) {
  const runs = await payroll.listRuns(ctx.actor);
  if (term) {
    const t = String(term).trim().toUpperCase();
    const hit = runs.find((r) => String(r.refNo).toUpperCase() === t) ?? runs.find((r) => r.period === term && r.kind === 'REGULAR');
    if (!hit) throw new AppError(`No payroll run matches "${term}".`, 404, [], 'NOT_FOUND');
    return hit;
  }
  const open = runs.find((r) => ['DRAFT', 'CALCULATED'].includes(r.status));
  if (!open) throw new AppError('There is no payroll run in draft. Create one on the Payroll page.', 404, [], 'NOT_FOUND');
  return open;
}

async function employeeNamed(name) {
  const rows = await EmployeeCompensation.find({ name: new RegExp(escapeRegex(String(name ?? '').trim()), 'i') }).select('profileId name employeeCode').limit(8).lean();
  return theNamed(rows.map((r) => ({ profileId: String(r.profileId), name: r.name, code: r.employeeCode })), name, { label: 'employee', nameOf: (r) => r.name, describe: (r) => `${r.name} (${r.code})` });
}

async function studentFor(ctx, name) {
  const found = await health.findStudents(ctx.actor, { q: name });
  return theNamed(found.items, name, { label: 'student', nameOf: (r) => r.name, describe: (r) => `${r.name} (${r.className ?? r.admissionNo})` });
}

const finance = {
  get_fee_collections: {
    module: 'Fees', operation: 'GET', risk: RISK.LOW,
    description: 'Fee collections for a date range (default this month): total received, refunds and net, by mode (cash, UPI, card, cheque), by day, by cashier, by fee category and by class, and receipts not yet confirmed. E.g. "collection today by mode", "how much cash did we take this week".',
    inputSchema: closed({ from: date('YYYY-MM-DD; default the 1st of this month'), to: date('YYYY-MM-DD; default today') }),
    permission: 'fees.read', minScope: 'ALL',
    service: 'p4ops/collections.collectionReport()',
    async run(ctx, args) {
      const r = await collections.collectionReport(ctx.actor, args);
      return ok({ range: r.range, totals: r.totals, pendingApproval: r.pendingApproval, byMode: r.byMode, byCashier: r.byCashier, byHead: r.byHead.slice(0, 12), byClass: r.byClass.slice(0, 20), byDay: r.byDay, refunds: r.refunds.length }, {
        speak: `${r.range.from} to ${r.range.to}: ${rupees(r.totals.collectedPaise)} from ${r.totals.receipts} receipt(s)${r.totals.refundsPaise ? `, less ${rupees(r.totals.refundsPaise)} refunded` : ''}. ${r.byMode.map((m) => `${m.label} ${rupees(m.amountPaise)}`).join(', ') || 'Nothing received.'}${r.pendingApproval.count ? ` ${r.pendingApproval.count} payment(s) of ${rupees(r.pendingApproval.amountPaise)} await approval.` : ''}`,
      });
    },
  },

  get_fee_ageing: {
    module: 'Fees', operation: 'GET', risk: RISK.LOW,
    description: 'Overdue fees per student in ageing buckets (0-30, 31-60, 61-90, 90+ days past due), with the oldest due date, the last payment and whether the family is on a fee plan. Optional bucket or class filter.',
    inputSchema: closed({ bucket: { type: 'string', enum: ['0-30', '31-60', '61-90', '90+'] }, className: text(40, 'e.g. "Class 8 B"'), limit: { type: 'integer', minimum: 1, maximum: 200 } }),
    permission: 'fees.read', minScope: 'ALL',
    service: 'p4ops/collections.ageing()',
    async run(ctx, args) {
      const a = await collections.ageing(ctx.actor, { ...args, limit: args.limit ?? 25 });
      return ok({ asOf: a.asOf, buckets: a.buckets, totals: a.totals, students: a.items.map((r) => ({ name: r.name, className: r.className, outstanding: rupees(r.outstandingPaise), oldestDue: r.oldestDue, daysOverdue: r.daysOverdue, bucket: r.bucket, onPlan: r.onPlan, lastPaidOn: r.lastPaidOn })) }, {
        speak: `${a.totals.students} student(s) overdue, ${rupees(a.totals.amountPaise)} in all: ${a.buckets.map((b) => `${b.key} days ${b.students} (${rupees(b.amountPaise)})`).join('; ')}.`,
      });
    },
  },

  get_fee_receipt_flags: {
    module: 'Fees', operation: 'GET', risk: RISK.LOW,
    description: 'Audit flags on fee receipts for a date range, each with the receipts behind it: the same UTR or cheque number used twice, cash at or above the s.269ST ₹2 lakh limit, counter entries out of hours or on Sundays, back-dated entries, large round cash, and cash keyed after the day was closed. Prompts to look, not findings.',
    inputSchema: closed({ from: date('YYYY-MM-DD'), to: date('YYYY-MM-DD') }),
    permission: 'fees.read', minScope: 'ALL',
    service: 'p4ops/collections.anomalies()',
    async run(ctx, args) {
      const r = await collections.anomalies(ctx.actor, args);
      return ok(r, { speak: r.flags.length ? `${r.flags.length} kind(s) of flag over ${r.checked} receipt(s): ${r.flags.map((f) => `${f.title} (${f.count})`).join('; ')}.` : `No flags over ${r.checked} receipt(s) from ${r.range.from} to ${r.range.to}.` });
    },
  },

  get_cash_position: {
    module: 'Finance reports', operation: 'GET', risk: RISK.LOW,
    description: 'The counter cash for a day (default today): cash received less cash refunds, which the drawer should hold, the other modes taken, and whether the day has been closed and checked.',
    inputSchema: closed({ day: date('YYYY-MM-DD; default today') }),
    permission: 'fees.read', minScope: 'ALL',
    service: 'p4ops/collections.expectedForDay()',
    async run(ctx, args) {
      const e = await collections.expectedForDay(ctx.actor, args.day);
      return ok(e, { speak: `${e.day}: ${e.cashReceipts} cash receipt(s), ${rupees(e.cashInPaise)}${e.cashRefundsPaise ? ` less ${rupees(e.cashRefundsPaise)} cash refunds` : ''}; the drawer should hold ${rupees(e.expectedCashPaise)} plus the float. ${e.existing ? `Closed by ${e.existing.closedBy}${e.existing.status === 'CHECKED' ? `, checked by ${e.existing.checkedBy}` : ', not yet checked'}.` : 'Not closed yet.'}` });
    },
  },

  close_cash_day: {
    module: 'Finance reports', operation: 'ACTION', risk: RISK.HIGH, confirm: true,
    description: 'Close the counter for a day with the notes and coins counted (e.g. "500 x 12, 200 x 5, 100 x 3"), the opening float and an explanation if the count does not match. A second person then checks it on the website. Confirmed on the website only.',
    inputSchema: closed({
      day: date('YYYY-MM-DD; default today'),
      counts: { type: 'array', maxItems: 9, items: closed({ note: { type: 'integer', enum: DENOMINATIONS.map((d) => d / 100), description: 'Note or coin in rupees' }, count: { type: 'integer', minimum: 0, maximum: 100000 } }, ['note', 'count']) },
      openingFloatRupees: rupeeAmount('Cash kept in the drawer from before'), depositSlipNo: text(60), note: text(1000, 'Why the count differs, if it does'),
    }, ['counts']),
    permission: 'fees.pay', minScope: 'ALL',
    service: 'p4ops/collections.closeDay()',
    async prepare(ctx, args) {
      const e = await collections.expectedForDay(ctx.actor, args.day);
      if (e.existing) throw new AppError(`${e.day} is already closed by ${e.existing.closedBy}.`, 409, [], 'ALREADY_CLOSED');
      const counted = args.counts.reduce((n, c) => n + c.note * 100 * c.count, 0);
      const variance = counted - (toPaise(args.openingFloatRupees) ?? 0) - e.expectedCashPaise;
      if (variance && !args.note) throw new AppError(`The count is ${variance > 0 ? 'over' : 'short'} by ${rupees(Math.abs(variance))}. Tell me why before I close the day.`, 400, [], 'AGENT_NEEDS_INPUT');
      return { day: e.day, counted, expected: e.expectedCashPaise, variance };
    },
    summarise: (args, _a, p) => `Close the cash for ${p?.day}: counted ${rupees(p?.counted)}, system ${rupees(p?.expected)}${args.openingFloatRupees ? ` + float ₹${args.openingFloatRupees}` : ''}${p?.variance ? ` — ${p.variance > 0 ? 'over' : 'short'} by ${rupees(Math.abs(p.variance))} ("${args.note}")` : ' — balanced'}. A second person checks it afterwards.`,
    async run(ctx, args) {
      const c = await collections.closeDay(ctx.actor, { day: args.day, counts: args.counts.map((x) => ({ denominationPaise: x.note * 100, count: x.count })), openingFloatPaise: toPaise(args.openingFloatRupees) ?? 0, depositSlipNo: args.depositSlipNo, note: args.note });
      return action({ type: 'cash_day_closed', id: c.id, data: { day: c.day, variancePaise: c.variancePaise }, speak: `Closed ${c.day}: counted ${rupees(c.countedPaise)}, ${c.variancePaise ? `variance ${rupees(c.variancePaise)}` : 'balanced'}. Ask a second person to check it on the Finance reports page.` });
    },
  },

  send_fee_reminders: {
    module: 'Finance reports', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true,
    description: 'Send the standard fee reminder ("A fee payment is due on <date>. Please check the Payments page") to the guardians of overdue students, chosen by ageing bucket, class or minimum days overdue. Families on an approved fee plan are left out unless asked; each family gets at most one reminder a week. Shows who will receive it first; confirmed on the website only.',
    inputSchema: closed({ bucket: { type: 'string', enum: ['0-30', '31-60', '61-90', '90+'] }, className: text(40), minDays: { type: 'integer', minimum: 1, maximum: 365 }, includePlans: { type: 'boolean' } }),
    permission: 'fees.manage', minScope: 'ALL',
    service: 'p4ops/collections.sendReminders()',
    async prepare(ctx, args) {
      const p = await collections.reminderPreview(ctx.actor, args);
      if (!p.students) throw new AppError('No overdue family matches that choice.', 404, [], 'NOT_FOUND');
      return { students: p.students, withoutGuardian: p.withoutGuardian, amount: p.amountPaise, sample: p.items.slice(0, 5).map((i) => `${i.name} (${i.className})`) };
    },
    summarise: (args, _a, p) => `Send the fee reminder to the guardians of ${p?.students} overdue student(s) (${rupees(p?.amount)} outstanding${args.bucket ? `, ${args.bucket} days` : ''}${args.className ? `, ${args.className}` : ''}), e.g. ${p?.sample?.join(', ')}${p?.withoutGuardian ? `; ${p.withoutGuardian} have no guardian on file and are skipped` : ''}.`,
    async run(ctx, args) {
      const r = await collections.sendReminders(ctx.actor, args);
      return action({ type: 'fee_reminders_sent', data: r, speak: `Reminders sent to ${r.sent} family(ies)${r.skippedNoGuardian ? `; ${r.skippedNoGuardian} skipped (no guardian on file)` : ''}.` });
    },
  },

  get_payroll_run: {
    module: 'Payroll', operation: 'GET', risk: RISK.LOW,
    description: 'One payroll run (by reference, e.g. PAY/2026/0004, or month "2026-09"; default the run in draft): status, totals, headcount and warnings; with payroll access, each employee\'s gross, deductions and net.',
    inputSchema: closed({ run: text(30, 'PAY/2026/0004 or 2026-09') }),
    permission: 'payroll.read', minScope: 'ALL',
    service: 'payroll.getRun()',
    async run(ctx, args) {
      const r = await payroll.getRun(ctx.actor, (await runFor(ctx, args)).id);
      const lines = (r.lines ?? []).slice(0, 60).map((l) => ({ name: l.name, paidDays: l.paidDays, lopDays: l.lopDays, ...(l.netPaise !== undefined && { gross: rupees(l.grossPaise), deductions: rupees(l.totalDeductionsPaise), net: rupees(l.netPaise) }) }));
      return ok({ refNo: r.refNo, period: r.period, kind: r.kind, status: r.status, totals: r.totals, warnings: (r.warnings ?? []).slice(0, 10), lines }, {
        speak: `${r.refNo} (${r.period}, ${String(r.kind).toLowerCase().replace(/_/g, ' ')}) is ${String(r.status).toLowerCase().replace(/_/g, ' ')}${r.totals?.netPaise ? `: net ${rupees(r.totals.netPaise)} for ${r.totals.headcount} employee(s)` : ''}${r.warnings?.length ? `; ${r.warnings.length} warning(s)` : ''}.`,
      });
    },
  },

  update_payroll_inputs: {
    module: 'Payroll', operation: 'UPDATE', risk: RISK.HIGH, confirm: true, affectsOthers: true,
    description: "Enter one employee's loss-of-pay days and/or arrears on the payroll run in draft (other employees' inputs are kept). Nobody can put arrears on their own line. Recalculate afterwards. Confirmed on the website only.",
    inputSchema: closed({ employeeName: text(80), run: text(30), lopDays: { type: 'number', minimum: 0, maximum: 31 }, arrearsRupees: rupeeAmount('Arrears to pay this month') }, ['employeeName']),
    permission: 'payroll.prepare', minScope: 'ALL',
    service: 'payroll.setInputs()',
    async prepare(ctx, args) {
      if (args.lopDays === undefined && args.arrearsRupees === undefined) throw new AppError('Give the LOP days or the arrears to enter.', 400, [], 'AGENT_NEEDS_INPUT');
      const run = await runFor(ctx, args);
      const e = await employeeNamed(args.employeeName);
      return { runId: run.id, refNo: run.refNo, period: run.period, profileId: e.profileId, name: e.name };
    },
    summarise: (args, _a, p) => `On ${p?.refNo} (${p?.period}) for ${p?.name}: ${[args.lopDays !== undefined && `LOP ${args.lopDays} day(s)`, args.arrearsRupees !== undefined && `arrears ₹${Number(args.arrearsRupees).toLocaleString('en-IN')}`].filter(Boolean).join(', ')}. Recalculate the run afterwards.`,
    async run(ctx, args, p) {
      await payroll.setInputs(ctx.actor, p.runId, { inputs: [{ profileId: p.profileId, ...(args.lopDays !== undefined && { lopDays: args.lopDays }), ...(args.arrearsRupees !== undefined && { arrearsPaise: toPaise(args.arrearsRupees) }) }] });
      return action({ type: 'payroll_inputs_saved', id: p.runId, speak: `Saved for ${p.name} on ${p.refNo}. Recalculate the run before sending it for approval.` });
    },
  },

  calculate_payroll_run: {
    module: 'Payroll', operation: 'ACTION', risk: RISK.MEDIUM, confirm: true,
    description: 'Recalculate the payroll run in draft (or the one named) from the pay structures, the statutory rules and the inputs. It does not send it for approval.',
    inputSchema: closed({ run: text(30) }),
    permission: 'payroll.prepare', minScope: 'ALL',
    service: 'payroll.calculate()',
    async prepare(ctx, args) { const r = await runFor(ctx, args); return { id: r.id, refNo: r.refNo, period: r.period }; },
    summarise: (_args, _a, p) => `Recalculate payroll ${p?.refNo} (${p?.period}).`,
    async run(ctx, _args, p) {
      const r = await payroll.calculate(ctx.actor, p.id);
      return action({ type: 'payroll_calculated', id: p.id, data: { totals: r.totals }, speak: `${r.refNo} calculated: net ${rupees(r.totals?.netPaise)} for ${r.totals?.headcount} employee(s)${r.warnings?.length ? `, ${r.warnings.length} warning(s) to read` : ''}.` });
    },
  },
};

const hr = {
  get_staff_leave_balances: {
    module: 'Staff leave', operation: 'GET', risk: RISK.LOW,
    description: "Every staff member's leave balances this leave year (CL, SL, EL and others): entitled, used and available. Optional name filter.",
    inputSchema: closed({ name: text(80) }),
    permission: 'staffleave.manage', minScope: 'ALL',
    service: 'staffLeave.allBalances()',
    async run(ctx, args) {
      const r = await staffLeave.allBalances(ctx.actor, 'ALL', {});
      const want = String(args.name ?? '').toLowerCase();
      const rows = r.people.filter((p) => !want || String(p.name).toLowerCase().includes(want)).slice(0, 60)
        .map((p) => ({ name: p.name, balances: Object.fromEntries(Object.entries(p.balances).map(([k, v]) => [k, v.available])) }));
      return ok({ leaveYear: r.leaveYear, people: rows }, { speak: `${rows.length} staff member(s) in ${r.leaveYear}${rows.length === 1 ? `: ${Object.entries(rows[0].balances).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}.` });
    },
  },

  get_staff_leave_lop: {
    module: 'Staff leave', operation: 'GET', risk: RISK.LOW,
    description: 'Loss-of-pay days per staff member for a month (approved unpaid leave and absences marked LOP, on working days), ready for the payroll run.',
    inputSchema: closed({ month: { ...MONTH, description: 'YYYY-MM; default this month' } }, []),
    permission: 'staffleave.manage', minScope: 'ALL',
    service: 'staffLeave.lopSummary()',
    async run(ctx, args) {
      const m = args.month ?? new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
      const [y, mo] = m.split('-').map(Number);
      const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      const r = await staffLeave.lopSummary(ctx.actor, 'ALL', { from: `${m}-01`, to: `${m}-${String(last).padStart(2, '0')}` });
      return ok({ from: r.from, to: r.to, inputs: r.inputs }, { speak: r.inputs.length ? `${r.inputs.length} person(s) with LOP in ${m}: ${r.inputs.slice(0, 6).map((i) => `${i.name} ${i.lopDays}`).join(', ')}.` : `No loss-of-pay days in ${m}.` });
    },
  },

  list_verification_cases: {
    module: 'Verification', operation: 'GET', risk: RISK.LOW,
    description: 'Background-verification cases (staff, drivers, vendors) with their status and the checks still open. Optional status: INITIATED, IN_PROGRESS, HR_REVIEW, AWAITING_DECISION, CLEARED, NOT_CLEARED, EXPIRED.',
    inputSchema: closed({ status: { type: 'string', enum: ['INITIATED', 'IN_PROGRESS', 'HR_REVIEW', 'AWAITING_DECISION', 'CLEARED', 'CLEARED_WITH_CONDITIONS', 'NOT_CLEARED', 'EXPIRED', 'DISPUTED'] } }),
    permission: 'verification.read', minScope: 'ALL',
    service: 'verification.list()',
    async run(ctx, args) {
      const rows = (await verification.list(ctx.actor, args)).slice(0, 40).map((c) => ({ refNo: c.refNo, name: c.subjectName, type: c.subjectType, position: c.positionTitle, status: c.status, openChecks: (c.checks ?? []).filter((k) => k.required && !['CLEAR', 'ADVERSE', 'UNABLE_TO_VERIFY'].includes(k.status)).map((k) => k.type) }));
      return ok({ cases: rows }, { speak: `${rows.length} case(s)${args.status ? ` ${args.status.toLowerCase().replace(/_/g, ' ')}` : ''}: ${rows.slice(0, 5).map((r) => `${r.name} (${r.status.toLowerCase().replace(/_/g, ' ')})`).join(', ')}.` });
    },
  },

  list_recruitment_vacancies: {
    module: 'Recruitment', operation: 'GET', risk: RISK.LOW,
    description: 'Vacancies with how many candidates are at each stage (applied, screened, demo lesson, interview, offered, accepted, joined).',
    inputSchema: closed({ status: { type: 'string', enum: ['OPEN', 'ON_HOLD', 'FILLED', 'CLOSED'] } }),
    permission: 'org.manage', minScope: 'ALL',
    service: 'p4ops/people.listVacancies()',
    async run(ctx, args) {
      const { items } = await people.listVacancies(ctx.actor, args);
      return ok({ vacancies: items.map((v) => ({ refNo: v.refNo, title: v.title, department: v.department, status: v.status, closesOn: v.closesOn, pipeline: v.pipeline })) }, { speak: `${items.length} vacancy(ies): ${items.slice(0, 6).map((v) => `${v.title} (${Object.values(v.pipeline).reduce((a, b) => a + b, 0)} candidate(s))`).join(', ')}.` });
    },
  },

  open_vacancy: {
    module: 'Recruitment', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true,
    description: 'Open a vacancy: post title, department, subject, positions, qualifications (e.g. "B.Ed, CTET"), salary band and closing date. Child-facing posts (the default) need background verification before joining.',
    inputSchema: closed({ title: text(120), department: text(80), subject: text(80), positions: { type: 'integer', minimum: 1, maximum: 50 }, qualifications: text(500), salaryBand: text(80), closesOn: date('YYYY-MM-DD'), childFacing: { type: 'boolean' }, employmentType: { type: 'string', enum: ['PERMANENT', 'PROBATION', 'CONTRACT', 'VISITING', 'PART_TIME'] } }, ['title']),
    permission: 'org.manage', minScope: 'ALL',
    service: 'p4ops/people.createVacancy()',
    summarise: (a) => `Open a vacancy: ${a.title}${a.department ? `, ${a.department}` : ''}${a.positions > 1 ? ` (${a.positions} posts)` : ''}${a.closesOn ? `, closing ${a.closesOn}` : ''}.`,
    async run(ctx, args) {
      const v = await people.createVacancy(ctx.actor, args);
      return action({ type: 'vacancy_opened', id: v.id, data: { refNo: v.refNo }, speak: `Opened ${v.refNo}: ${v.title}.` });
    },
  },

  list_candidates: {
    module: 'Recruitment', operation: 'GET', risk: RISK.LOW,
    description: 'Candidates, optionally for one vacancy or at one stage, with their average interview score and verification status.',
    inputSchema: closed({ vacancy: text(120, 'Title or reference'), stage: { type: 'string', enum: CANDIDATE_STAGES } }),
    permission: 'org.manage', minScope: 'ALL',
    service: 'p4ops/people.listCandidates()',
    async run(ctx, args) {
      const v = args.vacancy ? await vacancyNamed(ctx, args.vacancy) : null;
      const { items } = await people.listCandidates(ctx.actor, { ...(v && { vacancyId: v.id }), ...(args.stage && { stage: args.stage }) });
      const rows = items.slice(0, 40).map((c) => ({ name: c.name, vacancy: c.vacancy?.title, stage: c.stage, averageScore: c.averageScore, experienceYears: c.experienceYears, verification: c.verificationStatus }));
      return ok({ candidates: rows }, { speak: `${items.length} candidate(s)${v ? ` for ${v.title}` : ''}: ${rows.slice(0, 6).map((r) => `${r.name} (${r.stage.toLowerCase()}${r.averageScore ? `, ${r.averageScore}/5` : ''})`).join(', ')}.` });
    },
  },

  add_candidate: {
    module: 'Recruitment', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true,
    description: 'Add an applicant to an open vacancy: name, email, phone, source (referral, portal, walk-in), years of experience, qualifications, expected CTC and notice period.',
    inputSchema: closed({ vacancy: text(120), name: text(120), email: text(160), phone: text(20), source: text(60), experienceYears: { type: 'number', minimum: 0, maximum: 50 }, qualifications: text(500), expectedCtcRupees: rupeeAmount('Annual'), noticeDays: { type: 'integer', minimum: 0, maximum: 365 } }, ['name']),
    permission: 'org.manage', minScope: 'ALL',
    service: 'p4ops/people.addCandidate()',
    async prepare(ctx, args) { const v = await vacancyNamed(ctx, args.vacancy); return { vacancyId: v.id, title: v.title, refNo: v.refNo }; },
    summarise: (a, _x, p) => `Add ${a.name} as a candidate for ${p?.title} (${p?.refNo})${a.experienceYears !== undefined ? `, ${a.experienceYears} years' experience` : ''}.`,
    async run(ctx, args, p) {
      const { vacancy: _v, expectedCtcRupees, ...rest } = args;
      const c = await people.addCandidate(ctx.actor, { ...rest, vacancyId: p.vacancyId, expectedCtcPaise: toPaise(expectedCtcRupees) });
      return action({ type: 'candidate_added', id: c.id, data: { refNo: c.refNo }, speak: `Added ${c.name} (${c.refNo}) to ${p.title}.` });
    },
  },

  move_candidate: {
    module: 'Recruitment', operation: 'UPDATE', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: 'Move a candidate to the next stage: SCREENED, DEMO_LESSON, INTERVIEW, OFFERED (needs the offer drafted), ACCEPTED, JOINED (a child-facing post needs cleared verification), REJECTED (with a reason) or WITHDRAWN.',
    inputSchema: closed({ candidateName: text(120), vacancy: text(120), stage: { type: 'string', enum: CANDIDATE_STAGES.filter((st) => st !== 'APPLIED') }, note: text(500) }, ['candidateName', 'stage']),
    permission: 'org.manage', minScope: 'ALL',
    service: 'p4ops/people.moveCandidate()',
    async prepare(ctx, args) {
      const v = args.vacancy ? await vacancyNamed(ctx, args.vacancy) : null;
      const c = await candidateNamed(ctx, args.candidateName, v);
      if (!c.nextStages.includes(args.stage)) throw new AppError(`${c.name} is at ${c.stage.toLowerCase()}; next can be ${c.nextStages.map((x) => x.toLowerCase()).join(', ') || 'nothing'}.`, 409, [], 'INVALID_TRANSITION');
      if (args.stage === 'REJECTED' && !args.note) throw new AppError(`Why is ${c.name} not going forward? It stays on file.`, 400, [], 'AGENT_NEEDS_INPUT');
      return { id: c.id, name: c.name, from: c.stage, vacancy: c.vacancy?.title };
    },
    summarise: (a, _x, p) => `Move ${p?.name} (${p?.vacancy}) from ${String(p?.from).toLowerCase()} to ${a.stage.toLowerCase().replace('_', ' ')}${a.note ? ` — "${a.note}"` : ''}.`,
    async run(ctx, args, p) {
      const c = await people.moveCandidate(ctx.actor, p.id, { stage: args.stage, note: args.note });
      return action({ type: 'candidate_moved', id: c.id, data: { stage: c.stage }, speak: `${c.name} is now ${c.stage.toLowerCase().replace('_', ' ')}.` });
    },
  },

  add_candidate_scorecard: {
    module: 'Recruitment', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: 'Add your interview scorecard for a candidate, 1-5 on subject knowledge, teaching method, communication, classroom management, child safeguarding awareness and values/fit, with a recommendation (STRONG_YES, YES, MAYBE, NO).',
    inputSchema: closed({
      candidateName: text(120),
      subjectKnowledge: { type: 'integer', minimum: 1, maximum: 5 }, pedagogy: { type: 'integer', minimum: 1, maximum: 5 }, communication: { type: 'integer', minimum: 1, maximum: 5 },
      classroomManagement: { type: 'integer', minimum: 1, maximum: 5 }, childSafeguarding: { type: 'integer', minimum: 1, maximum: 5 }, valuesFit: { type: 'integer', minimum: 1, maximum: 5 },
      recommendation: { type: 'string', enum: ['STRONG_YES', 'YES', 'MAYBE', 'NO'] }, note: text(1000),
    }, ['candidateName']),
    permission: 'org.manage', minScope: 'ALL',
    service: 'p4ops/people.scoreCandidate()',
    async prepare(ctx, args) { const c = await candidateNamed(ctx, args.candidateName); return { id: c.id, name: c.name }; },
    summarise: (a, _x, p) => `Scorecard for ${p?.name}: ${['subjectKnowledge', 'pedagogy', 'communication', 'classroomManagement', 'childSafeguarding', 'valuesFit'].filter((k) => a[k]).map((k) => `${k} ${a[k]}`).join(', ')}${a.recommendation ? `; ${a.recommendation.toLowerCase().replace('_', ' ')}` : ''}.`,
    async run(ctx, args, p) {
      const { candidateName: _c, recommendation, note, ...ratings } = args;
      const c = await people.scoreCandidate(ctx.actor, p.id, { ratings, recommendation, note });
      return action({ type: 'candidate_scored', id: c.id, data: { averageScore: c.averageScore }, speak: `Saved. ${c.name}'s average is now ${c.averageScore}/5 over ${c.scores.length} scorecard(s).` });
    },
  },

  draft_offer_letter: {
    module: 'Recruitment', operation: 'ACTION', risk: RISK.MEDIUM, confirm: true,
    description: 'Draft the offer letter for a candidate from the vacancy and the CTC and joining date given; saved on the candidate for HR to edit, print and sign. Nothing is sent.',
    inputSchema: closed({ candidateName: text(120), ctcRupees: rupeeAmount('Annual CTC'), joiningOn: date('YYYY-MM-DD'), probationMonths: { type: 'integer', minimum: 0, maximum: 24 }, schoolName: text(160) }, ['candidateName', 'ctcRupees', 'joiningOn']),
    permission: 'org.manage', minScope: 'ALL',
    service: 'p4ops/people.draftOffer()',
    async prepare(ctx, args) { const c = await candidateNamed(ctx, args.candidateName); return { id: c.id, name: c.name, vacancy: c.vacancy?.title }; },
    summarise: (a, _x, p) => `Draft an offer for ${p?.name} (${p?.vacancy}): CTC ₹${Number(a.ctcRupees).toLocaleString('en-IN')} a year, joining ${a.joiningOn}.`,
    async run(ctx, args, p) {
      const r = await people.draftOffer(ctx.actor, p.id, { ctcPaise: toPaise(args.ctcRupees), joiningOn: args.joiningOn, probationMonths: args.probationMonths, schoolName: args.schoolName });
      return action({ type: 'offer_drafted', id: p.id, data: { letter: r.letter }, speak: `Drafted the offer for ${p.name}. ${r.note}` });
    },
  },

  list_staff_exits: {
    module: 'Exits', operation: 'GET', risk: RISK.LOW,
    description: 'Open staff exits (resignations, retirements, contract ends): last working day, notice served, department clearances pending and whether the full-and-final has gone to payroll.',
    inputSchema: closed({}),
    permission: 'org.manage', minScope: 'ALL',
    service: 'p4ops/people.listExits()',
    async run(ctx) {
      const { items } = await people.listExits(ctx.actor, {});
      return ok({ exits: items.map((x) => ({ refNo: x.refNo, name: x.name, kind: x.kind, lastWorkingDay: x.lastWorkingDay, status: x.status, clearancesPending: x.clearancesPending, onPayroll: Boolean(x.payrollRunId) })) }, { speak: items.length ? `${items.length} open exit(s): ${items.map((x) => `${x.name}, last day ${x.lastWorkingDay}${x.clearancesPending ? `, ${x.clearancesPending} clearance(s) pending` : ''}`).join('; ')}.` : 'No open exits.' });
    },
  },

  start_staff_exit: {
    module: 'Exits', operation: 'CREATE', risk: RISK.HIGH, confirm: true, affectsOthers: true,
    description: "Start a staff member's exit: the kind (RESIGNATION, RETIREMENT, TERMINATION, CONTRACT_END, DEATH), the notice date, the last working day, the notice period required and the departments to clear (ACADEMICS, LIBRARY, IT, ACCOUNTS, ADMIN, TRANSPORT, LABS, HOSTEL). Not your own. Confirmed on the website only.",
    inputSchema: closed({ staffName: text(80), kind: { type: 'string', enum: EXIT_KINDS }, noticeOn: date('YYYY-MM-DD; default today'), lastWorkingDay: date('YYYY-MM-DD'), noticeDaysRequired: { type: 'integer', minimum: 0, maximum: 180 }, reason: text(1000), departments: { type: 'array', maxItems: 8, items: { type: 'string', enum: CLEARANCE_DEPARTMENTS } } }, ['staffName', 'kind', 'lastWorkingDay']),
    permission: 'org.manage', minScope: 'ALL',
    service: 'p4ops/people.startExit()',
    async prepare(ctx, args) { const p = await staffNamed(ctx, args.staffName); return { profileId: p.id, name: p.name }; },
    summarise: (a, _x, p) => `Start the ${a.kind.toLowerCase().replace('_', ' ')} of ${p?.name}: notice ${a.noticeOn ?? 'today'}, last working day ${a.lastWorkingDay}${a.noticeDaysRequired !== undefined ? `, ${a.noticeDaysRequired} days' notice required` : ''}.`,
    async run(ctx, args, p) {
      const { staffName: _s, ...rest } = args;
      const x = await people.startExit(ctx.actor, { ...rest, profileId: p.profileId });
      return action({ type: 'exit_started', id: x.id, data: { refNo: x.refNo }, speak: `Started ${x.refNo} for ${x.name}; ${x.clearancesPending} department clearance(s) to collect.` });
    },
  },

  update_exit_clearance: {
    module: 'Exits', operation: 'UPDATE', risk: RISK.MEDIUM, confirm: true,
    description: "Record a department's clearance for a leaving staff member: CLEARED, or DUES with the amount or what is outstanding (e.g. two library books).",
    inputSchema: closed({ staffName: text(80), department: { type: 'string', enum: CLEARANCE_DEPARTMENTS }, status: { type: 'string', enum: ['CLEARED', 'DUES', 'PENDING'] }, duesRupees: rupeeAmount(), note: text(300) }, ['staffName', 'department', 'status']),
    permission: 'org.manage', minScope: 'ALL',
    service: 'p4ops/people.updateClearance()',
    async prepare(ctx, args) { const x = await exitFor(ctx, args.staffName); return { id: x.id, name: x.name, refNo: x.refNo }; },
    summarise: (a, _x, p) => `${p?.name} (${p?.refNo}): ${a.department.toLowerCase()} ${a.status.toLowerCase()}${a.duesRupees ? ` ₹${a.duesRupees}` : ''}${a.note ? ` — ${a.note}` : ''}.`,
    async run(ctx, args, p) {
      const x = await people.updateClearance(ctx.actor, p.id, { department: args.department, status: args.status, duesPaise: toPaise(args.duesRupees), note: args.note });
      return action({ type: 'exit_clearance_updated', id: x.id, speak: `Saved. ${x.clearancesPending} clearance(s) still pending for ${x.name}.` });
    },
  },

  estimate_full_and_final: {
    module: 'Exits', operation: 'ACTION', risk: RISK.MEDIUM, confirm: true,
    description: "Work out a leaving staff member's full-and-final worksheet: gratuity (15/26 × basic+DA × years, after 5 years), earned-leave encashment, notice-period recovery and clearance dues. Saved on the exit for HR; it pays nothing.",
    inputSchema: closed({ staffName: text(80), elDays: { type: 'number', minimum: 0, maximum: 400, description: 'Earned-leave days to encash; default the balance on file' }, encashmentDivisor: { type: 'integer', enum: [26, 30] } }, ['staffName']),
    permission: 'payroll.sensitive.read', minScope: 'ALL',
    service: 'p4ops/people.settlementEstimate()',
    async prepare(ctx, args) {
      if (ctx.actor.permissions?.['org.manage'] !== 'ALL') throw new AppError('Exits are HR\'s.', 403);
      const x = await exitFor(ctx, args.staffName); return { id: x.id, name: x.name, refNo: x.refNo };
    },
    summarise: (_a, _x, p) => `Work out the full-and-final for ${p?.name} (${p?.refNo}).`,
    async run(ctx, args, p) {
      const { settlement } = await people.settlementEstimate(ctx.actor, p.id, { elDays: args.elDays, encashmentDivisor: args.encashmentDivisor });
      return action({ type: 'settlement_estimated', id: p.id, data: settlement, speak: `${p.name}: ${settlement.lines.map((l) => `${l.name} ${rupees(l.amountPaise)}`).join(', ')}; net ${rupees(settlement.netPaise)}. ${settlement.warnings[0] ?? ''}` });
    },
  },
};

const nurse = {
  get_health_watchlist: healthOn({
    module: 'Health room', operation: 'GET', risk: RISK.LOW,
    description: 'School nurse only: the watch list from the health-room records: possible clusters (3+ children in one class with a similar complaint within a few days), children seen 4+ times in 30 days, immunisations due or overdue, and screening coverage by class with follow-ups. Prompts, not diagnoses; every read is audited.',
    inputSchema: closed({}),
    permission: 'health.manage', minScope: 'ALL', forRoles: ['NURSE'],
    service: 'p4ops/healthInsights.insights()',
    async run(ctx) {
      const w = await watch.insights(ctx.actor, {});
      return ok({ clusters: w.clusters.map(({ evidence, ...c }) => ({ ...c, students: evidence.map((e) => e.student) })), frequentVisitors: w.frequentVisitors, immunisationsDue: w.immunisationsDue.slice(0, 30), screening: { ...w.screening, byClass: w.screening.byClass.slice(0, 12), followUps: w.screening.followUps.slice(0, 20) } }, {
        speak: `${w.clusters.length ? `${w.clusters.length} possible cluster(s): ${w.clusters.map((c) => `${c.className} ${c.label.toLowerCase()} (${c.children} children)`).join('; ')}. ` : 'No clusters. '}${w.frequentVisitors.length} frequent visitor(s); ${w.immunisationsDue.filter((i) => i.overdue).length} immunisation(s) overdue, ${w.immunisationsDue.filter((i) => !i.overdue).length} due soon; screened ${w.screening.screened} of ${w.screening.totalStudents} this year.`,
      });
    },
  }),

  list_health_visits: healthOn({
    module: 'Health room', operation: 'GET', risk: RISK.LOW,
    description: 'School nurse only: health-room visits for a date range, a student or an outcome (complaint, outcome, time in and out, whether the parents were told). Every read is audited.',
    inputSchema: closed({ from: date('YYYY-MM-DD'), to: date('YYYY-MM-DD'), studentName: text(80), outcome: { type: 'string', enum: VISIT_OUTCOMES } }),
    permission: 'health.manage', minScope: 'ALL', forRoles: ['NURSE'],
    service: 'health.service.listVisits()',
    async run(ctx, args) {
      const st = args.studentName ? await studentFor(ctx, args.studentName) : null;
      const r = await health.listVisits(ctx.actor, { from: args.from, to: args.to, outcome: args.outcome, ...(st && { studentId: st.id }), limit: 50 });
      const rows = r.items.map((v) => ({ ref: v.refNo, student: v.studentName, className: v.className, in: v.arrivedAt, out: v.leftAt, complaint: v.complaint, outcome: v.outcomeLabel, parentTold: Boolean(v.parentNotified) }));
      return ok({ visits: rows }, { speak: `${rows.length} visit(s)${st ? ` for ${st.name}` : ''}.` });
    },
  }),

  close_health_visit: healthOn({
    module: 'Health room', operation: 'UPDATE', risk: RISK.MEDIUM, confirm: true,
    description: "School nurse only: finish today's open visit for a student: the time out (default now), and optionally a changed outcome or what was done. Parents are told if the new outcome is one the school notifies.",
    inputSchema: closed({ studentName: text(80), leftAt: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: 'HH:MM today; default now' }, outcome: { type: 'string', enum: VISIT_OUTCOMES }, action: text(1000) }, ['studentName']),
    permission: 'health.manage', minScope: 'ALL', forRoles: ['NURSE'],
    service: 'health.service.updateVisit()',
    async prepare(ctx, args) {
      const st = await studentFor(ctx, args.studentName);
      const t = await health.today(ctx.actor);
      const open = t.visits.filter((v) => v.studentId === st.id && !v.leftAt);
      if (!open.length) throw new AppError(`${st.name} has no open visit today.`, 404, [], 'NOT_FOUND');
      return { id: open[0].id, ref: open[0].refNo, name: st.name };
    },
    summarise: (a, _x, p) => `Close ${p?.ref} for ${p?.name}: out at ${a.leftAt ?? 'now'}${a.outcome ? `, outcome ${a.outcome.toLowerCase().replace(/_/g, ' ')}` : ''}.`,
    async run(ctx, args, p) {
      const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
      const v = await health.updateVisit(ctx.actor, p.id, { leftAt: args.leftAt ? `${today}T${args.leftAt}:00+05:30` : new Date().toISOString(), ...(args.outcome && { outcome: args.outcome }), ...(args.action && { action: args.action }) });
      return action({ type: 'health_visit_closed', id: v.id, speak: `${v.refNo} closed: ${v.outcomeLabel}.` });
    },
  }),

  list_health_stock: healthOn({
    module: 'Health room', operation: 'GET', risk: RISK.LOW,
    description: 'School nurse only: first-aid stock, medicines and equipment with quantity, reorder level and expiry; which are low, expiring or expired.',
    inputSchema: closed({}),
    permission: 'health.manage', minScope: 'ALL', forRoles: ['NURSE'],
    service: 'health.service.listStock()',
    async run(ctx) {
      const r = await health.listStock(ctx.actor);
      const rows = r.items.filter((i) => i.active).map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit, reorderLevel: i.reorderLevel, expiresOn: i.expiresOn, low: i.low, expiringSoon: i.expiringSoon, expired: i.expired }));
      const flag = rows.filter((i) => i.low || i.expiringSoon || i.expired);
      return ok({ items: rows }, { speak: `${rows.length} item(s); ${flag.length ? `needs attention: ${flag.map((i) => `${i.name}${i.expired ? ' (expired)' : i.expiringSoon ? ' (expiring)' : ' (low)'}`).join(', ')}` : 'nothing low or expiring'}.` });
    },
  }),

  update_health_stock: healthOn({
    module: 'Health room', operation: 'UPDATE', risk: RISK.MEDIUM, confirm: true,
    description: 'School nurse only: set the quantity on hand of a stock item after a count or a delivery (and optionally the new expiry date or batch).',
    inputSchema: closed({ itemName: text(120), quantity: { type: 'number', minimum: 0, maximum: 100000 }, expiresOn: date('YYYY-MM-DD'), batchNo: text(60), note: text(300) }, ['itemName', 'quantity']),
    permission: 'health.manage', minScope: 'ALL', forRoles: ['NURSE'],
    service: 'health.service.updateStock()',
    async prepare(ctx, args) {
      const r = await health.listStock(ctx.actor);
      const it = theNamed(r.items.filter((i) => i.active), args.itemName, { label: 'stock item', nameOf: (i) => i.name });
      return { id: it.id, name: it.name, from: it.quantity, unit: it.unit };
    },
    summarise: (a, _x, p) => `${p?.name}: ${p?.from} → ${a.quantity} ${p?.unit}${a.expiresOn ? `, expires ${a.expiresOn}` : ''}.`,
    async run(ctx, args, p) {
      const s = await health.updateStock(ctx.actor, p.id, { quantity: args.quantity, ...(args.expiresOn && { expiresOn: args.expiresOn }), ...(args.batchNo && { batchNo: args.batchNo }), note: args.note });
      return action({ type: 'health_stock_updated', id: s.id, speak: `${s.name} now ${s.quantity} ${s.unit}${s.low ? ' (below the reorder level)' : ''}.` });
    },
  }),

  add_health_entry: healthOn({
    module: 'Health room', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true,
    description: "School nurse only: add an immunisation (vaccine, dose number, where given, next dose due) or a screening (height cm, weight kg, vision e.g. 6/6, dental, hearing, remarks) to a student's health card.",
    inputSchema: closed({
      studentName: text(80), kind: { type: 'string', enum: ['IMMUNISATION', 'SCREENING'] }, on: date('YYYY-MM-DD; default today'),
      vaccine: text(120), doseNo: text(20), givenAt: text(120), nextDueOn: date('YYYY-MM-DD'),
      heightCm: { type: 'number', minimum: 40, maximum: 230 }, weightKg: { type: 'number', minimum: 5, maximum: 200 }, visionLeft: text(20), visionRight: text(20), dental: text(200), hearing: text(100), remarks: text(500),
    }, ['studentName', 'kind']),
    permission: 'health.manage', minScope: 'ALL', forRoles: ['NURSE'],
    service: 'health.service.addEntry()',
    async prepare(ctx, args) {
      if (args.kind === 'IMMUNISATION' && !args.vaccine) throw new AppError('Which vaccine?', 400, [], 'AGENT_NEEDS_INPUT');
      const st = await studentFor(ctx, args.studentName); return { studentId: st.id, name: st.name, className: st.className };
    },
    summarise: (a, _x, p) => (a.kind === 'IMMUNISATION'
      ? `Add to ${p?.name}'s card: ${a.vaccine}${a.doseNo ? ` dose ${a.doseNo}` : ''} on ${a.on ?? 'today'}${a.nextDueOn ? `, next due ${a.nextDueOn}` : ''}.`
      : `Add a screening to ${p?.name}'s card: ${[a.heightCm && `${a.heightCm} cm`, a.weightKg && `${a.weightKg} kg`, a.visionLeft && `vision L ${a.visionLeft}`, a.visionRight && `R ${a.visionRight}`, a.dental && `dental ${a.dental}`].filter(Boolean).join(', ')}.`),
    async run(ctx, args, p) {
      const { studentName: _s, ...rest } = args;
      const e = await health.addEntry(ctx.actor, { ...rest, studentId: p.studentId });
      return action({ type: 'health_entry_added', id: e.id, speak: `Added to ${p.name}'s health card${e.data?.bmi ? ` (BMI ${e.data.bmi})` : ''}.` });
    },
  }),
};

export const p4FinanceHrNurseTools = { ...finance, ...hr, ...nurse };
