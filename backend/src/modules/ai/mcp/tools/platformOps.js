import * as tasks from '../../../tasks/tasks.service.js';
import * as bills from '../../../bills/bills.service.js';
import * as billReview from '../../../bills/review.service.js';
import { renewals as billRenewals } from '../../../bills/renewals.service.js';
import * as labs from '../../../labs/labs.service.js';
import * as labAssets from '../../../labs/labs.assets.js';
import * as labSessions from '../../../labs/labs.sessions.js';
import * as adjustments from '../../../fees/adjustment.service.js';
import * as accountsExport from '../../../fees/accounts-export.service.js';
import * as approvals from '../../../approvals/approval.service.js';
import * as trips from '../../../fleet/trips.service.js';
import * as vehicles from '../../../fleet/vehicles.service.js';
import * as telemetry from '../../../fleet/telemetry.service.js';
import * as visitors from '../../../safety/visitors.service.js';
import * as pickup from '../../../safety/pickup.service.js';
import * as checkpoints from '../../../safety/checkpoints.service.js';
import * as outpass from '../../../hostel/outpass.service.js';
import * as staffLeave from '../../../staff/staffLeave.service.js';
import * as cover from '../../../staff/cover.service.js';
import * as analytics from '../../../analytics/analytics.service.js';
import * as quarterly from '../../../analytics/quarterly.service.js';
import { ownStudentIds } from '../../../safety/shared.js';
import { profilesWithRoles } from '../../../ops/common.js';
import { istYmd, istHm } from '../../../ptm/relations.js';
import { Lab } from '../../../../models/lab.model.js';
import { Invoice } from '../../../../models/fee.model.js';
import { FeeAdjustment } from '../../../../models/feeAdjustment.model.js';
import { Student } from '../../../../models/student.model.js';
import { CameraObservation } from '../../../../models/safety.model.js';
import { DEPARTMENTS as TASK_DEPARTMENTS, SEVERITIES as TASK_SEVERITIES, CATEGORIES as TASK_CATEGORIES } from '../../../../models/dueItem.model.js';
import { BILL_CATEGORIES } from '../../../../models/bill.model.js';
import { FEATURES } from '../../../../constants/features.js';
import { featureEnabled } from '../../../../utils/features.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import {
  RISK, dateStr, limitSchema, askedLimit, summarise, rupees, theNamed, resolveSection,
  resultWindow, rangeOf, collectPages,
} from './_shared.js';

/**
 * School-platform operations, through the assistant.
 *
 * The product rule for this file: whatever a person can do on these screens --
 * the due-items queue, bills and service contracts, the laboratories, fee
 * concessions and the accounts export, vehicles and trips, the gate (visitors,
 * pickup, ID cards, the emergency roster), hostel out-passes, staff leave and
 * substitute cover, the analytics workspace and quarterly reports -- they can
 * ask for in words, within exactly the access their role gives them.
 *
 * Nothing here is a second implementation. Every tool calls the service the
 * screen calls, with the caller's own actor and scope, so the scope rules, the
 * state machines, the maker-checker rules and the audit trail are the ones the
 * REST API already enforces. What a tool adds is the part a chat needs: a
 * record named in words ("the electricity bill", "Ms Rao", "7B period 3",
 * "the beakers in the chemistry lab") resolved to the one record the caller may
 * act on, or a question back when the name is ambiguous -- never a guess.
 *
 * Every write is confirmed. It is proposed as a concrete draft (what will
 * change, on which record) and runs only when the same person says yes on the
 * channel it was proposed on (server.js / confirm.js). Money, other people's
 * records and every approval are confirmed on the website only.
 *
 * APPROVALS (`approverDecision: true`). The batch-3 product rule: the assistant
 * may RECORD an approval or a rejection, but only one the person who holds the
 * approval authority states themselves and then confirms. It never proposes a
 * decision on its own initiative (the decision is a required argument with no
 * default, and the descriptions say it must be the user's own words), never for
 * somebody else (the actor is the session's person; the services refuse
 * self-approval and check the stage approver), and never on WhatsApp (HIGH risk,
 * confirmed on the website). See APPROVER_CONFIRMED_TOOLS in ../decisions.js.
 *
 * Deliberately left out of chat: camera observations themselves (only a count
 * awaiting review, for those who review), custody restrictions on pickup,
 * loss-of-pay marking (a payroll input), absence reasons, lab incident details
 * about people, and every file download (no file channel in a chat).
 */

/* ── Small helpers ─────────────────────────────────────── */

const DAY = 86_400_000;
const rowsOf = (out) => (Array.isArray(out) ? out : out?.items ?? []);
const day = (d) => (d ? istYmd(d) : null);
const time = (d) => (d ? istHm(d) : null);
const lower = (s) => String(s ?? '').trim().toLowerCase();
const words = (s) => String(s ?? '').toLowerCase().replace(/_/g, ' ');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const HM = '^([01]\\d|2[0-3]):[0-5]\\d$';
const hm = (description) => ({ type: 'string', pattern: HM, description });
const text = (max, description) => ({ type: 'string', maxLength: max, ...(description && { description }) });
const closed = (properties, required = []) => ({ type: 'object', properties, ...(required.length && { required }), additionalProperties: false });

/** An IST wall-clock date (and time) as an instant. */
const istAt = (date, hhmm = '00:00') => new Date(`${date}T${hhmm}:00+05:30`);
const todayIst = () => istYmd(new Date());
const plusDays = (n) => new Date(Date.now() + n * DAY);

/** Whole rupees (or rupees and paise) as paise; refused when it is not a positive amount. */
function paiseOf(amount, label = 'amount') {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new AppError(`${label} must be more than zero.`, 400);
  const p = Math.round(n * 100);
  if (Math.abs(p / 100 - n) > 1e-9) throw new AppError(`${label} can have at most two decimals.`, 400);
  return p;
}

/** Strips a courtesy title, so "Ms Rao" finds "Anita Rao". */
const stripTitle = (s) => String(s ?? '').replace(/^\s*(?:mr|mrs|ms|miss|dr|sir|madam|mx|shri|smt)\.?\s+/i, '').trim();

/** The switch a module is behind: off means the screen is off, and so is the assistant. */
async function requireOn(key) {
  if (!(await featureEnabled(key))) {
    throw new AppError(`${FEATURES[key]?.label ?? key} is switched off for this school.`, 403, [], 'FEATURE_OFF');
  }
}

/** Wraps a tool so its run (and prepare) first check the module's switch. */
function behind(feature, tool) {
  const { run, prepare } = tool;
  return {
    ...tool,
    feature,
    async run(ctx, args, prepared) {
      await requireOn(feature);
      return run.call(this, ctx, args, prepared);
    },
    ...(prepare && {
      async prepare(ctx, args) {
        await requireOn(feature);
        return prepare.call(this, ctx, args);
      },
    }),
  };
}

/** A colleague named in words: an active staff profile in this school. */
async function staffNamed(name, label = 'member of staff') {
  const rows = (await profilesWithRoles(staffLeave.STAFF_ROLES)).map((p) => ({ id: String(p._id), name: p.displayName }));
  return theNamed(rows, stripTitle(name), { label, nameOf: (r) => r.name });
}

/** The caller's own child (or, for a student, themselves), named or the only one. */
async function myChild(ctx, childName) {
  const ids = await ownStudentIds(ctx.actor);
  if (!ids.length) throw new AppError('There is no student linked to your account.', 404, [], 'NOT_FOUND');
  const rows = (await Student.find({ _id: { $in: ids } }).select('_id firstName lastName').lean())
    .map((s) => ({ id: String(s._id), name: `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() }));
  if (childName) return theNamed(rows, childName, { label: 'child of yours', nameOf: (r) => r.name });
  if (rows.length === 1) return rows[0];
  throw new AppError(`Which child — ${rows.map((r) => r.name).join(' or ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
}

/** Picks one row by its reference number, or by the words of its name. */
function byRefOrName(rows, { ref, name }, { label, refOf, nameOf, describe }) {
  if (ref) {
    const hit = rows.find((r) => lower(refOf(r)) === lower(ref) || lower(refOf(r)).endsWith(`/${lower(ref)}`));
    if (!hit) throw new AppError(`I could not find ${label} ${ref}.`, 404, [], 'NOT_FOUND');
    return hit;
  }
  if (name) return theNamed(rows, name, { label, nameOf, describe: describe ?? nameOf });
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new AppError(`There is no ${label} to act on.`, 404, [], 'NOT_FOUND');
  throw new AppError(`Which ${label}? ${rows.slice(0, 5).map(describe ?? nameOf).join(', ')}.`, 400, [], 'AGENT_NEEDS_INPUT');
}

/* ── Tasks: the due-items queue ────────────────────────── */

async function openTasks(ctx) {
  const view = ctx.scope === 'ALL' ? 'all' : 'mine';
  const page = await collectPages((p, pageSize) => tasks.list(ctx.actor, ctx.scope, { status: 'open', view, page: p, pageSize }), undefined, { pageSize: 200 });
  return page.items;
}

async function theTask(ctx, args) {
  const rows = await openTasks(ctx);
  return byRefOrName(rows, { ref: args.taskRef, name: args.title }, {
    label: 'open task', refOf: (t) => t.refNo, nameOf: (t) => t.title, describe: (t) => `${t.refNo} ${t.title}`,
  });
}

const taskRefSchema = {
  taskRef: text(40, 'The task reference, e.g. "TSK-000123"'),
  title: text(200, 'The task named in words, e.g. "AMC visit" — an ambiguous match is asked about'),
};

const presentTask = (t) => ({
  ref: t.refNo, title: t.title, department: t.department, category: t.category, severity: t.severity,
  dueOn: day(t.dueAt), status: t.status, overdue: Boolean(t.overdue), daysLeft: t.daysLeft ?? null,
  owner: t.ownerName ?? null, amount: t.amountPaise ? rupees(t.amountPaise) : null,
  snoozedUntil: t.snoozedUntil ? day(t.snoozedUntil) : null,
});

const taskTools = {
  list_due_items: behind('tasks', {
    module: 'Tasks', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'Due items and reminders: bills to pay, renewals, service visits, inspections, follow-ups and anything else with a due date. The caller sees their own (or, with school-wide access, everybody\'s). Filter by open, overdue or done, by department, or by how many days ahead. Read-only.',
    inputSchema: closed({
      status: { type: 'string', enum: ['open', 'overdue', 'done', 'all'], description: 'Default open' },
      dueWithinDays: { type: 'integer', minimum: 0, maximum: 365, description: 'Only items due within this many days, e.g. 7 for "this week"' },
      department: { type: 'string', enum: TASK_DEPARTMENTS },
      limit: limitSchema(),
    }),
    permission: 'tasks.read',
    service: 'tasks.service.list()',
    async run(ctx, args) {
      const win = resultWindow(ctx, args);
      const status = args.status === 'overdue' ? 'open' : (args.status ?? 'open');
      const query = { status, ...(args.department && { department: args.department }), ...(args.dueWithinDays !== undefined && { to: plusDays(args.dueWithinDays).toISOString() }) };
      const page = await collectPages((p, pageSize) => tasks.list(ctx.actor, ctx.scope, { ...query, page: p, pageSize }), win, { pageSize: 200 });
      let rows = page.items.map(presentTask);
      if (args.status === 'overdue') rows = rows.filter((t) => t.overdue);
      const view = summarise(rows, (t) => `${t.title} (${t.overdue ? 'overdue' : `due ${t.dueOn}`})`);
      return ok({ items: rows, count: rows.length, overdue: rows.filter((t) => t.overdue).length }, {
        speak: rows.length ? `${plural(rows.length, 'item')}: ${view.list}.` : 'Nothing is due in that view.',
        range: args.status === 'overdue' ? null : rangeOf(win, page.items.length, page.total),
      });
    },
  }),

  get_due_items_summary: behind('tasks', {
    module: 'Tasks', operation: 'GET', risk: RISK.LOW, resultShape: 'SUMMARY',
    description: 'How much is due, in totals: open, overdue, due this week and this month, critical and unassigned items, by department, with the expected cost of the next 90 days. Read-only.',
    inputSchema: closed({}),
    permission: 'tasks.read',
    service: 'tasks.service.summary()',
    async run(ctx) {
      const s = await tasks.summary(ctx.actor, ctx.scope);
      const t = s.total;
      return ok({
        total: { ...t, quarterCost: rupees(t.quarterCostPaise) },
        byDepartment: s.byDepartment.map((d) => ({ department: d.department, open: d.open, overdue: d.overdue, week: d.week, critical: d.critical })),
        definition: s.definition,
      }, { speak: `${t.open} open, ${t.overdue} overdue, ${t.week} due this week, ${t.critical} critical.` });
    },
  }),

  create_due_item: behind('tasks', {
    module: 'Tasks', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: 'Add a due item (a reminder with an owner and a due date), e.g. "remind me to renew the fire NOC by 30 November". Owned by the caller; someone who manages every task may give it to a named colleague. Needs confirmation.',
    inputSchema: closed({
      title: text(200),
      department: { type: 'string', enum: TASK_DEPARTMENTS },
      dueOn: dateStr('YYYY-MM-DD'),
      severity: { type: 'string', enum: TASK_SEVERITIES },
      category: { type: 'string', enum: TASK_CATEGORIES },
      description: text(2000),
      amountRupees: { type: 'number', minimum: 0, description: 'Expected cost, if any' },
      repeat: { type: 'string', enum: ['WEEK', 'MONTH', 'YEAR'], description: 'Repeats every week, month or year' },
      ownerName: text(120, 'A colleague to own it (school-wide task managers only)'),
    }, ['title', 'department', 'dueOn']),
    permission: 'tasks.manage',
    service: 'tasks.service.createItem()',
    async prepare(ctx, args) {
      let owner = null;
      if (args.ownerName) {
        if (ctx.scope !== 'ALL') throw new AppError('You can add tasks for yourself; giving one to a colleague needs school-wide task access.', 403);
        owner = await staffNamed(args.ownerName, 'colleague');
      }
      return { owner };
    },
    summarise: (args, _a, p) => `Add task "${args.title}" (${words(args.department)}), due ${args.dueOn}${p?.owner ? `, owned by ${p.owner.name}` : ', owned by you'}${args.repeat ? `, repeating every ${words(args.repeat)}` : ''}`,
    async run(ctx, args, prepared) {
      const item = await tasks.createItem(ctx.actor, ctx.scope, {
        title: args.title, department: args.department, dueAt: istAt(args.dueOn, '09:00').toISOString(),
        severity: args.severity, category: args.category, description: args.description,
        ...(args.amountRupees ? { amountPaise: paiseOf(args.amountRupees, 'amountRupees') } : {}),
        ...(args.repeat && { recurrence: { unit: args.repeat, every: 1 } }),
        ...(prepared?.owner && { ownerProfileId: prepared.owner.id }),
      });
      return action({ type: 'task_created', id: item.id, data: presentTask(item), speak: `Added ${item.refNo}: ${item.title}, due ${day(item.dueAt)}.` });
    },
  }),

  snooze_due_item: behind('tasks', {
    module: 'Tasks', operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: 'Put an open task off until a later date, with the reason (e.g. "snooze the AMC visit to Friday because the vendor is on leave"). A critical task can be put off by one day at most, others by 30 days. Needs confirmation.',
    inputSchema: closed({ ...taskRefSchema, until: dateStr('YYYY-MM-DD, a future day'), reason: text(500) }, ['until', 'reason']),
    permission: 'tasks.manage',
    service: 'tasks.service.snooze()',
    async prepare(ctx, args) {
      const t = await theTask(ctx, args);
      return { id: t.id, refNo: t.refNo, title: t.title };
    },
    summarise: (args, _a, p) => `Snooze ${p?.refNo ?? ''} "${p?.title ?? args.title}" until ${args.until} — reason: ${args.reason}`,
    async run(ctx, args, p) {
      const t = await tasks.snooze(ctx.actor, ctx.scope, p.id, { until: istAt(args.until, '08:00').toISOString(), reason: args.reason });
      return action({ type: 'task_snoozed', id: t.id, data: presentTask(t), speak: `${t.refNo} is snoozed until ${args.until}.` });
    },
  }),

  complete_due_item: behind('tasks', {
    module: 'Tasks', operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: 'Mark an open task done, with a note of what was done (for a task that needs evidence the note describes it; files are attached on the Tasks screen). A repeating task creates its next one. Needs confirmation.',
    inputSchema: closed({ ...taskRefSchema, note: text(2000, 'What was done, e.g. "Paid by NEFT, UTR 1234"') }),
    permission: 'tasks.manage',
    service: 'tasks.service.complete()',
    async prepare(ctx, args) {
      const t = await theTask(ctx, args);
      if (t.requiresEvidence && !args.note) throw new AppError(`${t.refNo} needs evidence: tell me what was done (or attach the file on the Tasks screen).`, 400, [], 'AGENT_NEEDS_INPUT');
      return { id: t.id, refNo: t.refNo, title: t.title };
    },
    summarise: (args, _a, p) => `Mark ${p?.refNo ?? ''} "${p?.title ?? args.title}" done${args.note ? ` — ${args.note}` : ''}`,
    async run(ctx, args, p) {
      const t = await tasks.complete(ctx.actor, ctx.scope, p.id, { note: args.note });
      return action({ type: 'task_completed', id: t.id, data: { ...presentTask(t), next: t.next ? presentTask(t.next) : null }, speak: `${t.refNo} is done.${t.next ? ` The next one is due ${day(t.next.dueAt)}.` : ''}` });
    },
  }),

  reassign_due_item: behind('tasks', {
    module: 'Tasks', operation: 'UPDATE', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: 'Give an open task to a named colleague. For those who manage every task. Needs confirmation.',
    inputSchema: closed({ ...taskRefSchema, ownerName: text(120, 'The colleague, e.g. "Ms Rao"'), note: text(500) }, ['ownerName']),
    permission: 'tasks.manage', minScope: 'ALL',
    service: 'tasks.service.reassign()',
    async prepare(ctx, args) {
      const t = await theTask(ctx, args);
      const owner = await staffNamed(args.ownerName, 'colleague');
      return { id: t.id, refNo: t.refNo, title: t.title, owner };
    },
    summarise: (args, _a, p) => `Give ${p?.refNo ?? ''} "${p?.title ?? args.title}" to ${p?.owner?.name ?? args.ownerName}`,
    async run(ctx, args, p) {
      const t = await tasks.reassign(ctx.actor, ctx.scope, p.id, { ownerProfileId: p.owner.id, note: args.note });
      return action({ type: 'task_reassigned', id: t.id, data: presentTask(t), speak: `${t.refNo} now belongs to ${p.owner.name}.` });
    },
  }),

  cancel_due_item: behind('tasks', {
    module: 'Tasks', operation: 'ACTION', risk: RISK.LOW, confirm: true,
    description: 'Cancel an open task that is no longer needed, with the reason. Needs confirmation.',
    inputSchema: closed({ ...taskRefSchema, reason: text(500) }, ['reason']),
    permission: 'tasks.manage',
    service: 'tasks.service.cancel()',
    async prepare(ctx, args) {
      const t = await theTask(ctx, args);
      return { id: t.id, refNo: t.refNo, title: t.title };
    },
    summarise: (args, _a, p) => `Cancel ${p?.refNo ?? ''} "${p?.title ?? args.title}" — reason: ${args.reason}`,
    async run(ctx, args, p) {
      const t = await tasks.cancel(ctx.actor, ctx.scope, p.id, { reason: args.reason });
      return action({ type: 'task_cancelled', id: t.id, data: presentTask(t), speak: `${t.refNo} is cancelled.` });
    },
  }),
};

/* ── Bills, service contracts, renewals and the review queue ── */

const presentBill = (b) => ({
  ref: b.refNo, account: b.accountName ?? null, category: b.category, billNo: b.billNo ?? null,
  amount: rupees(b.amountPaise), outstanding: rupees(b.outstandingPaise), awaitingBankCheck: b.unconfirmedPaise ? rupees(b.unconfirmedPaise) : null,
  dueOn: day(b.dueOn), status: b.status, overdue: Boolean(b.overdue),
});

async function allBills(ctx, status = 'open') {
  const page = await collectPages((p, pageSize) => bills.listBills(ctx.actor, { status, page: p, pageSize }), undefined, { pageSize: 200 });
  return page.items;
}

/** One bill, by reference, by bill number, or by its account's name. */
async function theBill(ctx, args, { status = 'open', label = 'open bill' } = {}) {
  const rows = await allBills(ctx, status);
  if (args.billNo) {
    const hit = rows.filter((b) => lower(b.billNo) === lower(args.billNo));
    if (hit.length === 1) return hit[0];
  }
  return byRefOrName(rows, { ref: args.billRef, name: args.account }, {
    label, refOf: (b) => b.refNo, nameOf: (b) => `${b.accountName ?? ''} ${words(b.category)}`, describe: (b) => `${b.refNo} ${b.accountName ?? b.category} ${rupees(b.amountPaise)} due ${day(b.dueOn)}`,
  });
}

const billRefSchema = {
  billRef: text(40, 'The bill reference, e.g. "BIL-000042"'),
  billNo: text(60, "The provider's bill number"),
  account: text(160, 'The service named in words, e.g. "electricity" or "lift AMC"'),
};

async function theAccount(ctx, name) {
  const rows = await bills.listAccounts(ctx.actor, {});
  return theNamed(rows.filter((a) => a.status !== 'ENDED'), name, {
    label: 'service account', nameOf: (a) => `${a.name} ${a.vendorName ?? ''} ${words(a.category)}`, describe: (a) => `${a.name}${a.vendorName ? ` (${a.vendorName})` : ''}`,
  });
}

const billTools = {
  list_bills: behind('bills', {
    module: 'Bills', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'Recurring bills (electricity, water, internet, AMC, rent ...) with amount, outstanding, due date and status. Filter: open, overdue, payments awaiting a bank check, paid; and "due within N days" (e.g. 7 for "what bills are due this week"). Read-only.',
    inputSchema: closed({
      status: { type: 'string', enum: ['open', 'overdue', 'unconfirmed', 'PAID', 'all'], description: 'Default open' },
      dueWithinDays: { type: 'integer', minimum: 0, maximum: 365 },
      category: { type: 'string', enum: BILL_CATEGORIES },
      limit: limitSchema(),
    }),
    permission: 'bills.read', minScope: 'ALL',
    service: 'bills.service.listBills()',
    async run(ctx, args) {
      const status = args.status === 'all' ? undefined : (args.status ?? 'open');
      let rows = (await collectPages((p, pageSize) => bills.listBills(ctx.actor, { status, category: args.category, page: p, pageSize }), undefined, { pageSize: 200 })).items;
      if (args.dueWithinDays !== undefined) rows = rows.filter((b) => new Date(b.dueOn) <= plusDays(args.dueWithinDays));
      const shown = rows.slice(0, askedLimit(args) ?? rows.length).map(presentBill);
      const total = rows.reduce((n, b) => n + (b.outstandingPaise ?? 0), 0);
      const view = summarise(shown, (b) => `${b.account ?? b.category} ${b.amount} due ${b.dueOn}${b.overdue ? ' (overdue)' : ''}`);
      return ok({ bills: shown, count: rows.length, outstanding: rupees(total) }, {
        speak: rows.length ? `${plural(rows.length, 'bill')}, ${rupees(total)} outstanding: ${view.list}.` : 'No bills match that.',
      });
    },
  }),

  list_service_visits: behind('bills', {
    module: 'Bills', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'AMC and service-contract visits: scheduled (and overdue) by default, or done, missed or cancelled. Read-only.',
    inputSchema: closed({ status: { type: 'string', enum: ['SCHEDULED', 'DONE', 'MISSED', 'CANCELLED'] }, withinDays: { type: 'integer', minimum: 0, maximum: 365 } }),
    permission: 'bills.read', minScope: 'ALL',
    service: 'bills.service.listVisits()',
    async run(ctx, args) {
      let rows = await bills.listVisits(ctx.actor, { status: args.status ?? 'SCHEDULED' });
      if (args.withinDays !== undefined) rows = rows.filter((v) => new Date(v.scheduledOn) <= plusDays(args.withinDays));
      const out = rows.map((v) => ({ ref: v.refNo, service: v.accountName, vendor: v.vendorName, scheduledOn: day(v.scheduledOn), status: v.status, overdue: Boolean(v.overdue), doneOn: day(v.doneOn) }));
      const view = summarise(out, (v) => `${v.service} on ${v.scheduledOn}${v.overdue ? ' (overdue)' : ''}`);
      return ok({ visits: out, count: out.length }, { speak: out.length ? `${plural(out.length, 'visit')}: ${view.list}.` : 'No service visits match that.' });
    },
  }),

  list_renewals: behind('bills', {
    module: 'Bills', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'Everything up for renewal in one list: licences and certificates, agreements and their notice dates, warranties, service contracts and AMCs, lab calibrations and software. With when a decision is needed, the cost where known, the owner and what happens if nothing is done. Read-only.',
    inputSchema: closed({ withinDays: { type: 'integer', minimum: 7, maximum: 730, description: 'Default 90' } }),
    permission: 'bills.read', minScope: 'ALL',
    service: 'renewals.service.renewals()',
    async run(ctx, args) {
      const r = await billRenewals(ctx.actor, { withinDays: args.withinDays ?? 90 });
      const items = r.items.map((i) => ({ title: i.title, kind: i.source, dueOn: day(i.dueOn), decideBy: day(i.decideBy), owner: i.ownerName, cost: i.costPaise ? rupees(i.costPaise) : null, overdue: Boolean(i.overdue), consequence: i.consequence }));
      const view = summarise(items, (i) => `${i.title} (decide by ${i.decideBy})`);
      return ok({ renewals: items, count: items.length, overdue: r.total.overdue, totalCost: rupees(r.total.costPaise), withinDays: r.withinDays }, {
        speak: items.length ? `${plural(items.length, 'renewal')} in the next ${r.withinDays} days, ${r.total.overdue} overdue: ${view.list}.` : 'Nothing is up for renewal in that window.',
      });
    },
  }),

  get_bill_review_queue: behind('bills', {
    module: 'Bills', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'Bills flagged for a person to check: an amount well above usual, a possible duplicate, a consumption jump, a bill past due, a payment with no evidence or not yet confirmed with the bank, an invoice that does not match its order. Each flag states its rule and numbers; flags are prompts, not findings. Read-only.',
    inputSchema: closed({ show: { type: 'string', enum: ['open', 'reviewed', 'all'] } }),
    permission: 'bills.read', minScope: 'ALL',
    service: 'review.service.reviewQueue()',
    async run(ctx, args) {
      const q = await billReview.reviewQueue(ctx.actor, { show: args.show ?? 'open' });
      const flags = q.items.map((f) => ({ title: f.title, code: f.code, severity: f.severity, explanation: f.explanation, review: f.review ? { status: f.review.status, note: f.review.note } : null }));
      const view = summarise(flags, (f) => `${f.title} (${f.severity.toLowerCase()})`);
      return ok({ flags, count: flags.length, note: q.note }, { speak: flags.length ? `${plural(flags.length, 'flag')} to check: ${view.list}.` : 'Nothing is flagged for review.' });
    },
  }),

  get_bill_costs: behind('bills', {
    module: 'Bills', operation: 'GET', risk: RISK.LOW, resultShape: 'SUMMARY',
    description: 'What the school spends on recurring bills, by category, for a period, compared with the same period last year; plus what is outstanding now. Read-only.',
    inputSchema: closed({ preset: { type: 'string', enum: ['month', 'quarter', 'year', 'financialYear', 'academicYear'], description: 'Default financialYear' } }),
    permission: 'bills.read', minScope: 'ALL',
    service: 'review.service.dashboard()',
    async run(ctx, args) {
      const d = await billReview.dashboard(ctx.actor, { preset: args.preset ?? 'financialYear' });
      const byCategory = d.byCategory.map((c) => ({ category: c.category, amount: rupees(c.amountPaise), bills: c.bills, changePct: c.change?.comparable ? c.change.pct : null }));
      return ok({ period: d.period, total: rupees(d.totalPaise), changePct: d.change?.comparable ? d.change.pct : null, byCategory, outstanding: rupees(d.open.outstandingPaise), overdueBills: d.open.overdue }, {
        speak: `${d.period.label}: ${rupees(d.totalPaise)} on bills${d.change?.comparable ? ` (${d.change.pct > 0 ? '+' : ''}${d.change.pct}% on last year)` : ''}; ${rupees(d.open.outstandingPaise)} outstanding, ${d.open.overdue} overdue.`,
      });
    },
  }),

  record_bill: behind('bills', {
    module: 'Bills', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true,
    description: 'Record a bill that has arrived against a service account (e.g. "the electricity bill for October is ₹48,200, due 25 October"). Its reminder joins the due-items queue. Needs confirmation.',
    inputSchema: closed({
      account: text(160, 'The service, e.g. "electricity"'),
      amountRupees: { type: 'number', minimum: 0.01 },
      dueOn: dateStr('YYYY-MM-DD'),
      billDate: dateStr('YYYY-MM-DD'),
      billNo: text(60),
      units: { type: 'number', minimum: 0, description: 'Consumption, e.g. kWh' },
    }, ['account', 'amountRupees', 'dueOn']),
    permission: 'bills.manage', minScope: 'ALL',
    service: 'bills.service.createBill()',
    async prepare(ctx, args) {
      const a = await theAccount(ctx, args.account);
      return { accountId: a.id, accountName: a.name, amountPaise: paiseOf(args.amountRupees, 'amountRupees') };
    },
    summarise: (args, _a, p) => `Record a ${p?.accountName ?? args.account} bill of ${rupees(p?.amountPaise)}${args.billNo ? ` (no. ${args.billNo})` : ''}, due ${args.dueOn}`,
    async run(ctx, args, p) {
      const b = await bills.createBill(ctx.actor, { accountId: p.accountId, amountPaise: p.amountPaise, dueOn: args.dueOn, billDate: args.billDate, billNo: args.billNo, units: args.units });
      return action({ type: 'bill_recorded', id: b.id, data: presentBill({ ...b, accountName: p.accountName }), speak: `Recorded ${b.refNo}: ${rupees(b.amountPaise)} due ${day(b.dueOn)}.` });
    },
  }),

  record_bill_payment: behind('bills', {
    module: 'Bills', operation: 'CREATE', risk: RISK.HIGH, confirm: true,
    description: 'Record a payment made against a bill (amount, mode, reference). It does NOT settle the bill: a different person confirms it against the bank statement. Money, so it is confirmed on the website. Needs confirmation.',
    inputSchema: closed({
      ...billRefSchema,
      amountRupees: { type: 'number', minimum: 0.01 },
      mode: { type: 'string', enum: ['BANK', 'UPI', 'CHEQUE', 'CASH', 'CARD', 'AUTO_DEBIT', 'OTHER'] },
      reference: text(120, 'UTR, cheque number or transaction id'),
      paidOn: dateStr('YYYY-MM-DD'),
      note: text(500),
    }, ['amountRupees', 'mode']),
    permission: 'bills.manage', minScope: 'ALL',
    service: 'bills.service.recordPayment()',
    async prepare(ctx, args) {
      const b = await theBill(ctx, args);
      return { id: b.id, refNo: b.refNo, accountName: b.accountName, amountPaise: paiseOf(args.amountRupees, 'amountRupees') };
    },
    summarise: (args, _a, p) => `Record a ${words(args.mode)} payment of ${rupees(p?.amountPaise)}${args.reference ? ` (ref ${args.reference})` : ''} against ${p?.refNo ?? ''} ${p?.accountName ?? ''}. It stays unsettled until someone else confirms it with the bank.`,
    async run(ctx, args, p) {
      const b = await bills.recordPayment(ctx.actor, p.id, { amountPaise: p.amountPaise, mode: args.mode, reference: args.reference, paidOn: args.paidOn, note: args.note });
      return action({ type: 'bill_payment_recorded', id: b.id, data: presentBill({ ...b, accountName: p.accountName }), speak: `Recorded ${rupees(p.amountPaise)} against ${b.refNo}. A colleague now confirms it against the bank statement.` });
    },
  }),

  verify_bill_payment: behind('bills', {
    module: 'Bills', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true,
    description: "The bank check of a recorded bill payment: CONFIRM it with the bank reference (UTR / statement line), or REJECT it with a reason. Only when the checker says so in their own words; a person can never check a payment they recorded themselves. Confirmed on the website.",
    inputSchema: closed({
      ...billRefSchema,
      decision: { type: 'string', enum: ['CONFIRM', 'REJECT'], description: "The checker's own decision" },
      bankReference: text(120, 'Required to confirm'),
      reason: text(500, 'Required to reject'),
    }, ['decision']),
    permission: 'bills.manage', minScope: 'ALL',
    service: 'bills.service.confirmPayment()',
    async prepare(ctx, args) {
      const rows = (await allBills(ctx, 'unconfirmed'));
      const b = byRefOrName(rows, { ref: args.billRef, name: args.account }, { label: 'bill with a payment to check', refOf: (x) => x.refNo, nameOf: (x) => `${x.accountName ?? ''} ${words(x.category)}`, describe: (x) => `${x.refNo} ${x.accountName ?? x.category}` });
      const recorded = (b.payments ?? []).filter((x) => x.status === 'RECORDED');
      if (recorded.length !== 1) throw new AppError(recorded.length ? `${b.refNo} has ${recorded.length} payments to check; check them on the Bills screen.` : `${b.refNo} has no payment waiting for a bank check.`, recorded.length ? 400 : 404);
      const pay = recorded[0];
      if (String(pay.recordedByProfileId) === String(ctx.actor.profileId)) throw new AppError('You recorded this payment, so a different person confirms it against the bank statement.', 403, [], 'SAME_PERSON');
      if (args.decision === 'CONFIRM' && !args.bankReference) throw new AppError('Give the bank reference (UTR or statement line) to confirm it.', 400, [], 'AGENT_NEEDS_INPUT');
      if (args.decision === 'REJECT' && !args.reason) throw new AppError('Give the reason for rejecting it.', 400, [], 'AGENT_NEEDS_INPUT');
      return { id: b.id, refNo: b.refNo, accountName: b.accountName, paymentId: String(pay._id ?? pay.id), amountPaise: pay.amountPaise, recordedBy: pay.recordedByName ?? null };
    },
    summarise: (args, _a, p) => (args.decision === 'CONFIRM'
      ? `Confirm the ${rupees(p?.amountPaise)} payment on ${p?.refNo} ${p?.accountName ?? ''} (recorded by ${p?.recordedBy ?? 'a colleague'}) against bank reference ${args.bankReference}`
      : `Reject the ${rupees(p?.amountPaise)} payment on ${p?.refNo} ${p?.accountName ?? ''} — reason: ${args.reason}`),
    async run(ctx, args, p) {
      const b = await bills.confirmPayment(ctx.actor, p.id, p.paymentId, { decision: args.decision, bankReference: args.bankReference, reason: args.reason });
      return action({ type: 'bill_payment_checked', id: b.id, data: presentBill({ ...b, accountName: p.accountName }), speak: `${args.decision === 'CONFIRM' ? 'Confirmed' : 'Rejected'}. ${b.refNo} is now ${words(b.status)}.` });
    },
  }),

  change_bill_status: behind('bills', {
    module: 'Bills', operation: 'UPDATE', risk: RISK.MEDIUM, confirm: true,
    description: 'Dispute a bill, resolve a dispute (optionally with the revised amount), or cancel a wrongly recorded bill — always with a reason; nothing is deleted. Needs confirmation.',
    inputSchema: closed({
      ...billRefSchema,
      step: { type: 'string', enum: ['DISPUTE', 'RESOLVE_DISPUTE', 'CANCEL'] },
      reason: text(1000),
      revisedAmountRupees: { type: 'number', minimum: 0 },
    }, ['step', 'reason']),
    permission: 'bills.manage', minScope: 'ALL',
    service: 'bills.service.setBillStatus()',
    async prepare(ctx, args) {
      const b = await theBill(ctx, args);
      return { id: b.id, refNo: b.refNo, accountName: b.accountName };
    },
    summarise: (args, _a, p) => `${{ DISPUTE: 'Dispute', RESOLVE_DISPUTE: 'Resolve the dispute on', CANCEL: 'Cancel' }[args.step]} ${p?.refNo ?? ''} ${p?.accountName ?? ''}${args.revisedAmountRupees !== undefined ? `, revised to ${rupees(Math.round(args.revisedAmountRupees * 100))}` : ''} — reason: ${args.reason}`,
    async run(ctx, args, p) {
      const b = await bills.setBillStatus(ctx.actor, p.id, { action: args.step, reason: args.reason, ...(args.revisedAmountRupees !== undefined && { revisedAmountPaise: Math.round(args.revisedAmountRupees * 100) }) });
      return action({ type: 'bill_updated', id: b.id, data: presentBill({ ...b, accountName: p.accountName }), speak: `${b.refNo} is now ${words(b.status)}.` });
    },
  }),

  schedule_service_visit: behind('bills', {
    module: 'Bills', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: 'Schedule an AMC or service visit for a service account on a date. Its reminder joins the due-items queue. Needs confirmation.',
    inputSchema: closed({ account: text(160), date: dateStr('YYYY-MM-DD') }, ['account', 'date']),
    permission: 'bills.manage', minScope: 'ALL',
    service: 'bills.service.createVisit()',
    async prepare(ctx, args) {
      const a = await theAccount(ctx, args.account);
      return { accountId: a.id, accountName: a.name };
    },
    summarise: (args, _a, p) => `Schedule a service visit for ${p?.accountName ?? args.account} on ${args.date}`,
    async run(ctx, args, p) {
      const v = await bills.createVisit(ctx.actor, p.accountId, { scheduledOn: istAt(args.date, '10:00').toISOString() });
      return action({ type: 'service_visit_scheduled', id: v.id, data: { ref: v.refNo, service: p.accountName, scheduledOn: args.date }, speak: `Visit ${v.refNo} for ${p.accountName} is scheduled on ${args.date}.` });
    },
  }),

  complete_service_visit: behind('bills', {
    module: 'Bills', operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: "Close a scheduled AMC/service visit: DONE (needs the service report — give a link to it, or attach the file on the Bills screen), MISSED or CANCELLED (with the reason). The next visit is scheduled from it. Needs confirmation.",
    inputSchema: closed({
      account: text(160, 'The service, e.g. "lift AMC"'),
      outcome: { type: 'string', enum: ['DONE', 'MISSED', 'CANCELLED'] },
      reportLink: { type: 'string', maxLength: 1000, pattern: '^https://', description: 'An https link to the service report or photos' },
      technician: text(120),
      findings: text(4000),
      reason: text(1000, 'For MISSED or CANCELLED'),
      doneOn: dateStr('YYYY-MM-DD'),
    }, ['account', 'outcome']),
    permission: 'bills.manage', minScope: 'ALL',
    service: 'bills.service.completeVisit()',
    async prepare(ctx, args) {
      const rows = await bills.listVisits(ctx.actor, { status: 'SCHEDULED' });
      const v = theNamed(rows, args.account, { label: 'scheduled visit', nameOf: (x) => `${x.accountName ?? ''} ${x.vendorName ?? ''}`, describe: (x) => `${x.accountName} on ${day(x.scheduledOn)}` });
      if (args.outcome === 'DONE' && !args.reportLink) throw new AppError('A visit is closed as done with its service report: give me a link to it, or attach the file on the Bills screen.', 400, [], 'AGENT_NEEDS_INPUT');
      if (args.outcome !== 'DONE' && !args.reason) throw new AppError(`Why was the visit ${args.outcome.toLowerCase()}?`, 400, [], 'AGENT_NEEDS_INPUT');
      return { id: v.id, refNo: v.refNo, service: v.accountName, scheduledOn: day(v.scheduledOn) };
    },
    summarise: (args, _a, p) => `Close the ${p?.service ?? args.account} visit of ${p?.scheduledOn ?? ''} as ${args.outcome.toLowerCase()}${args.outcome === 'DONE' ? ' with the linked service report' : ` — ${args.reason}`}`,
    async run(ctx, args, p) {
      const out = await bills.completeVisit(ctx.actor, p.id, {
        outcome: args.outcome, technician: args.technician, findings: args.findings, reason: args.reason, doneOn: args.doneOn,
        ...(args.reportLink && { evidence: [{ name: 'Service report', url: args.reportLink, kind: 'DOCUMENT' }] }),
      });
      return action({ type: 'service_visit_closed', id: out.visit.id, data: { ref: out.visit.refNo, status: out.visit.status, nextVisitOn: out.next ? day(out.next.scheduledOn) : null }, speak: `${p.service} visit closed as ${args.outcome.toLowerCase()}.${out.next ? ` Next visit: ${day(out.next.scheduledOn)}.` : ''}` });
    },
  }),

  note_bill_flag: behind('bills', {
    module: 'Bills', operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: 'Record what was found on a flagged bill in the review queue: EXPLAINED (with the explanation), DISMISSED (with why) or ESCALATED. Name the flag by its words, e.g. "the duplicate water bill". Needs confirmation.',
    inputSchema: closed({ flag: text(300, 'Words from the flag title'), status: { type: 'string', enum: ['EXPLAINED', 'DISMISSED', 'ESCALATED'] }, note: text(2000) }, ['flag', 'status', 'note']),
    permission: 'bills.manage', minScope: 'ALL',
    service: 'review.service.reviewFlag()',
    async prepare(ctx, args) {
      const q = await billReview.reviewQueue(ctx.actor, { show: 'open' });
      const f = theNamed(q.items, args.flag, { label: 'open flag', nameOf: (x) => x.title });
      return { flagKey: f.key, title: f.title };
    },
    summarise: (args, _a, p) => `Mark the flag "${p?.title ?? args.flag}" ${args.status.toLowerCase()} — ${args.note}`,
    async run(ctx, args, p) {
      const r = await billReview.reviewFlag(ctx.actor, { flagKey: p.flagKey, status: args.status, note: args.note });
      return action({ type: 'bill_flag_noted', id: r.id, data: { flag: p.title, status: r.status }, speak: `Recorded: ${p.title} — ${args.status.toLowerCase()}.` });
    },
  }),
};

/* ── Laboratories ──────────────────────────────────────── */

async function labsInView(ctx) {
  return (await labs.listLabs(ctx.actor, ctx.scope)).map((l) => ({ id: l.id, name: l.name }));
}

async function theLabId(ctx, labName) {
  if (!labName) return null;
  const lab = theNamed(await labsInView(ctx), labName, { label: 'lab of yours', nameOf: (l) => l.name });
  return lab.id;
}

async function theLabItem(ctx, { item, labName }) {
  const labId = await theLabId(ctx, labName);
  const names = new Map((await labsInView(ctx)).map((l) => [l.id, l.name]));
  const rows = await labs.listItems(ctx.actor, ctx.scope, { ...(labId && { labId }), q: String(item).slice(0, 60) });
  const pool = rows.length ? rows : await labs.listItems(ctx.actor, ctx.scope, { ...(labId && { labId }) });
  const hit = theNamed(pool, item, { label: 'lab item', nameOf: (i) => i.name, describe: (i) => `${i.name} (${names.get(String(i.labId)) ?? 'lab'})` });
  return { ...hit, labName: names.get(String(hit.labId)) ?? null };
}

const labItemSchema = {
  item: text(160, 'The item as people call it, e.g. "beaker 250 mL" or "hydrochloric acid"'),
  labName: text(120, 'Which lab, when more than one holds it'),
};

const labTools = {
  get_labs_overview: behind('labs', {
    module: 'Labs', operation: 'GET', risk: RISK.LOW, resultShape: 'SUMMARY',
    description: "Each laboratory the caller may see, in figures: items, low stock, expired and expiring batches, quarantined stock, instruments out of service or overdue for calibration, computers in repair, practicals this week and open incidents. Read-only.",
    inputSchema: closed({}),
    permission: 'labs.read',
    service: 'labs.service.overview()',
    async run(ctx) {
      const o = await labs.overview(ctx.actor, ctx.scope);
      const rows = o.labs.map((l) => ({ lab: l.name, type: l.type, ...l.counts }));
      const t = o.total ?? {};
      return ok({ labs: rows, total: t, definitions: o.definitions }, {
        speak: rows.length ? `${plural(rows.length, 'lab')}: ${t.lowStock ?? 0} item(s) low, ${t.expired ?? 0} expired and ${t.expiringSoon ?? 0} expiring batch(es), ${t.calibrationOverdue ?? 0} calibration(s) overdue, ${t.openIncidents ?? 0} open incident(s).` : 'You are not in charge of any lab.',
      });
    },
  }),

  list_lab_stock: behind('labs', {
    module: 'Labs', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'Lab stock: what is on hand, what is low, and which batches have expired or expire soon (e.g. "which chemicals expire this month" = show expiring, withinDays 30). Optionally one lab or one item. Read-only.',
    inputSchema: closed({
      show: { type: 'string', enum: ['expiring', 'low', 'hazardous', 'all'], description: 'Default all' },
      withinDays: { type: 'integer', minimum: 0, maximum: 730, description: 'For show=expiring: how many days ahead (default 30); expired batches are always included' },
      labName: text(120),
      item: text(160),
      limit: limitSchema(),
    }),
    permission: 'labs.read',
    service: 'labs.service.listItems()',
    async run(ctx, args) {
      const labId = await theLabId(ctx, args.labName);
      const names = new Map((await labsInView(ctx)).map((l) => [l.id, l.name]));
      const filter = args.show === 'low' || args.show === 'hazardous' ? args.show : undefined;
      let rows = await labs.listItems(ctx.actor, ctx.scope, { ...(labId && { labId }), ...(args.item && { q: args.item }), ...(filter && { filter }) });
      const within = args.withinDays ?? 30;
      const expiringOf = (i) => (i.batches ?? []).filter((b) => b.daysToExpiry !== null && b.daysToExpiry <= within);
      if (args.show === 'expiring') rows = rows.filter((i) => expiringOf(i).length);
      const out = rows.slice(0, askedLimit(args) ?? rows.length).map((i) => ({
        item: i.name, lab: names.get(String(i.labId)) ?? null, kind: i.kind, onHand: `${i.onHandDisplay} ${i.displayUnit}`,
        lowStock: Boolean(i.lowStock), hazardous: Boolean(i.hazardous),
        expiring: expiringOf(i).map((b) => ({ batch: b.code, expiresOn: day(b.expiresOn), quantity: `${b.quantityDisplay} ${i.displayUnit}`, expired: Boolean(b.expired) })),
      }));
      const view = summarise(out, (i) => (args.show === 'expiring'
        ? `${i.item} (${i.expiring.map((b) => `${b.quantity} ${b.expired ? 'expired' : `expires ${b.expiresOn}`}`).join(', ')})`
        : `${i.item}: ${i.onHand}${i.lowStock ? ' (low)' : ''}`));
      return ok({ items: out, count: rows.length }, { speak: out.length ? `${plural(rows.length, 'item')}: ${view.list}.` : 'No lab stock matches that.' });
    },
  }),

  list_lab_equipment: behind('labs', {
    module: 'Labs', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'Lab instruments with their calibration due dates, overdue calibrations and those out of service. Read-only.',
    inputSchema: closed({ show: { type: 'string', enum: ['calibration_due', 'out_of_service', 'all'] }, withinDays: { type: 'integer', minimum: 0, maximum: 365, description: 'For show=calibration_due (default 30)' }, labName: text(120) }),
    permission: 'labs.read',
    service: 'labs.assets.listEquipment()',
    async run(ctx, args) {
      const labId = await theLabId(ctx, args.labName);
      let rows = await labAssets.listEquipment(ctx.actor, ctx.scope, { ...(labId && { labId }) });
      if (args.show === 'calibration_due') rows = rows.filter((e) => e.calibrationRequired && e.calibrationDaysLeft !== null && e.calibrationDaysLeft <= (args.withinDays ?? 30));
      if (args.show === 'out_of_service') rows = rows.filter((e) => e.outOfService);
      const out = rows.map((e) => ({ instrument: e.name, code: e.code, calibrationDueOn: day(e.calibrationDueOn), calibrationOverdue: Boolean(e.calibrationOverdue), outOfService: Boolean(e.outOfService), usable: Boolean(e.usable) }));
      const view = summarise(out, (e) => `${e.instrument}${e.calibrationOverdue ? ' (calibration overdue)' : e.calibrationDueOn ? ` (calibrate by ${e.calibrationDueOn})` : ''}${e.outOfService ? ' (out of service)' : ''}`);
      return ok({ instruments: out, count: out.length }, { speak: out.length ? `${plural(out.length, 'instrument')}: ${view.list}.` : 'No instruments match that.' });
    },
  }),

  list_practical_sessions: behind('labs', {
    module: 'Labs', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'Practical sessions: the ones the caller teaches or runs the lab for, from a date (default today) for N days (default 7), with class, lab, time and readiness status. Read-only.',
    inputSchema: closed({ from: dateStr('YYYY-MM-DD'), days: { type: 'integer', minimum: 1, maximum: 90 }, status: { type: 'string', enum: ['open', 'COMPLETED', 'CANCELLED'] } }),
    permission: 'labs.read',
    service: 'labs.sessions.listSessions()',
    async run(ctx, args) {
      const from = args.from ?? todayIst();
      const to = istYmd(new Date(istAt(from).getTime() + (args.days ?? 7) * DAY));
      const page = await labSessions.listSessions(ctx.actor, ctx.scope, { from: istAt(from).toISOString(), to: istAt(to).toISOString(), status: args.status ?? 'open', pageSize: 200 });
      const out = rowsOf(page).map((s) => ({ ref: s.refNo, title: s.title, class: s.className, lab: s.labName, date: day(s.startsAt), time: time(s.startsAt), status: s.status, teacher: s.teacherName ?? null }));
      const view = summarise(out, (s) => `${s.title} for ${s.class ?? 'a class'} in ${s.lab} on ${s.date} at ${s.time}`);
      return ok({ sessions: out, count: out.length }, { speak: out.length ? `${plural(out.length, 'practical')}: ${view.list}.` : 'No practicals in that period.' });
    },
  }),

  list_lab_incidents: behind('labs', {
    module: 'Labs', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'Lab incidents (spills, breakages, near misses, equipment failures ...) with their lab, kind, severity and status — open ones by default. The people involved are not given here. Read-only.',
    inputSchema: closed({ status: { type: 'string', enum: ['OPEN', 'CLOSED'] } }),
    permission: 'labs.read',
    service: 'labs.sessions.listIncidents()',
    async run(ctx, args) {
      const rows = await labSessions.listIncidents(ctx.actor, ctx.scope, { status: args.status ?? 'OPEN' });
      const out = rows.map((i) => ({ ref: i.refNo, lab: i.labName, kind: i.kind, severity: i.severity, on: day(i.at), status: i.status }));
      const view = summarise(out, (i) => `${i.ref} ${words(i.kind)} in ${i.lab} (${i.severity.toLowerCase()})`);
      return ok({ incidents: out, count: out.length }, { speak: out.length ? `${plural(out.length, 'incident')}: ${view.list}.` : 'No lab incidents match that.' });
    },
  }),

  issue_lab_stock: behind('labs', {
    module: 'Labs', operation: 'ACTION', risk: RISK.MEDIUM, confirm: true,
    description: 'Issue lab stock for use (e.g. "issue 2 beakers to 9A practical"). Taken from the batches that expire first; expired or quarantined stock is never issued, and hazardous items go to the supervising teacher. Needs confirmation.',
    inputSchema: closed({
      ...labItemSchema,
      quantity: { type: 'number', exclusiveMinimum: 0 },
      unit: text(10, 'g, kg, mg, mL, L or pcs; default the item\'s unit'),
      issuedTo: text(120, 'Who or what it is for, e.g. "9A practical" or "Mr Iyer"'),
      reason: text(500),
    }, ['item', 'quantity']),
    permission: 'labs.manage',
    service: 'labs.service.suggestFefo() + moveOut(ISSUE)',
    async prepare(ctx, args) {
      const it = await theLabItem(ctx, args);
      const plan = await labs.suggestFefo(ctx.actor, ctx.scope, it.id, { quantity: args.quantity, unit: args.unit ?? it.displayUnit });
      if (plan.shortBy > 0) throw new AppError(`Only ${plan.wantedDisplay - plan.shortByDisplay} ${it.displayUnit} of ${it.name} can be issued (unexpired, not quarantined).`, 409, [], 'INSUFFICIENT_STOCK');
      return { itemId: it.id, item: it.name, lab: it.labName, baseUnit: it.baseUnit, displayUnit: it.displayUnit, wanted: plan.wantedDisplay, lines: plan.plan.map((l) => ({ batchId: l.batchId, code: l.code, take: l.take, takeDisplay: l.takeDisplay })) };
    },
    summarise: (args, _a, p) => `Issue ${p?.wanted ?? args.quantity} ${p?.displayUnit ?? args.unit ?? ''} of ${p?.item ?? args.item} from ${p?.lab ?? 'the lab'} (${(p?.lines ?? []).map((l) => `batch ${l.code}: ${l.takeDisplay}`).join(', ')})${args.issuedTo ? ` to ${args.issuedTo}` : ''}`,
    async run(ctx, args, p) {
      const done = [];
      for (const line of p.lines) {
        // eslint-disable-next-line no-await-in-loop -- each batch is its own atomic decrement
        const out = await labs.moveOut(ctx.actor, ctx.scope, 'ISSUE', { batchId: line.batchId, quantity: line.take, unit: p.baseUnit, issuedToName: args.issuedTo, reason: args.reason ?? (args.issuedTo ? `For ${args.issuedTo}` : null) });
        done.push({ batch: line.code, issued: line.takeDisplay, left: out.batch.quantityDisplay });
      }
      return action({ type: 'lab_stock_issued', data: { item: p.item, unit: p.displayUnit, batches: done }, speak: `Issued ${p.wanted} ${p.displayUnit} of ${p.item}${args.issuedTo ? ` to ${args.issuedTo}` : ''}.` });
    },
  }),

  record_lab_stock_use: behind('labs', {
    module: 'Labs', operation: 'ACTION', risk: RISK.MEDIUM, confirm: true,
    description: 'Record lab stock used up (CONSUMED) or broken/spoilt (DAMAGED, with the reason). Disposal needs evidence and is recorded on the Labs screen. Needs confirmation.',
    inputSchema: closed({ ...labItemSchema, kind: { type: 'string', enum: ['CONSUMED', 'DAMAGED'] }, quantity: { type: 'number', exclusiveMinimum: 0 }, unit: text(10), batch: text(40, 'The batch code, when it matters which bottle'), reason: text(1000) }, ['item', 'kind', 'quantity']),
    permission: 'labs.manage',
    service: 'labs.service.moveOut(CONSUMED|DAMAGED)',
    async prepare(ctx, args) {
      if (args.kind === 'DAMAGED' && !args.reason) throw new AppError('What happened to it?', 400, [], 'AGENT_NEEDS_INPUT');
      const it = await theLabItem(ctx, args);
      let batch = null;
      if (args.batch) batch = (it.batches ?? []).find((b) => lower(b.code) === lower(args.batch));
      else if (args.kind === 'CONSUMED') {
        const plan = await labs.suggestFefo(ctx.actor, ctx.scope, it.id, { quantity: args.quantity, unit: args.unit ?? it.displayUnit });
        if (plan.plan.length !== 1) throw new AppError(plan.plan.length ? 'That spans more than one batch; name the batch.' : `No usable ${it.name} is in stock.`, plan.plan.length ? 400 : 409);
        batch = (it.batches ?? []).find((b) => b.id === plan.plan[0].batchId) ?? { id: plan.plan[0].batchId, code: plan.plan[0].code };
      } else if ((it.batches ?? []).length === 1) [batch] = it.batches;
      if (!batch) throw new AppError(`Which batch of ${it.name}? ${(it.batches ?? []).map((b) => b.code).join(', ')}`, 400, [], 'AGENT_NEEDS_INPUT');
      return { item: it.name, lab: it.labName, batchId: batch.id, code: batch.code, displayUnit: it.displayUnit };
    },
    summarise: (args, _a, p) => `Record ${args.quantity} ${args.unit ?? p?.displayUnit ?? ''} of ${p?.item ?? args.item} (batch ${p?.code ?? '?'}) as ${args.kind.toLowerCase()}${args.reason ? ` — ${args.reason}` : ''}`,
    async run(ctx, args, p) {
      const out = await labs.moveOut(ctx.actor, ctx.scope, args.kind, { batchId: p.batchId, quantity: args.quantity, unit: args.unit ?? p.displayUnit, reason: args.reason });
      return action({ type: 'lab_stock_used', data: { item: p.item, batch: p.code, left: `${out.batch.quantityDisplay} ${p.displayUnit}` }, speak: `Recorded. ${out.batch.quantityDisplay} ${p.displayUnit} left in batch ${p.code}.` });
    },
  }),

  receive_lab_stock: behind('labs', {
    module: 'Labs', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: 'Receive new lab stock as a batch (quantity, expiry printed on the container, supplier, lot). A chemical needs its expiry date or "no expiry". Needs confirmation.',
    inputSchema: closed({ ...labItemSchema, quantity: { type: 'number', exclusiveMinimum: 0 }, unit: text(10), expiresOn: dateStr('YYYY-MM-DD'), noExpiry: { type: 'boolean' }, supplier: text(160), lotNo: text(60) }, ['item', 'quantity']),
    permission: 'labs.manage',
    service: 'labs.service.receive()',
    async prepare(ctx, args) {
      const it = await theLabItem(ctx, args);
      if (it.kind === 'CHEMICAL' && !args.expiresOn && args.noExpiry !== true) throw new AppError(`What expiry date is printed on the ${it.name} container (or is there none)?`, 400, [], 'AGENT_NEEDS_INPUT');
      return { itemId: it.id, item: it.name, lab: it.labName, displayUnit: it.displayUnit };
    },
    summarise: (args, _a, p) => `Receive ${args.quantity} ${args.unit ?? p?.displayUnit ?? ''} of ${p?.item ?? args.item} into ${p?.lab ?? 'the lab'}${args.expiresOn ? `, expiring ${args.expiresOn}` : ''}${args.supplier ? ` from ${args.supplier}` : ''}`,
    async run(ctx, args, p) {
      const out = await labs.receive(ctx.actor, ctx.scope, p.itemId, { quantity: args.quantity, unit: args.unit ?? p.displayUnit, expiresOn: args.expiresOn, noExpiry: args.noExpiry, supplierName: args.supplier, lotNo: args.lotNo });
      return action({ type: 'lab_stock_received', id: out.batch.id, data: { item: p.item, batch: out.batch.code, status: out.batch.status }, speak: `Received as batch ${out.batch.code}${out.batch.status === 'QUARANTINED' ? ' (quarantined: already expired)' : ''}.` });
    },
  }),

  record_lab_calibration: behind('labs', {
    module: 'Labs', operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: 'Record that a lab instrument was calibrated: certificate number, date and validity (default: its calibration interval). Needs confirmation.',
    inputSchema: closed({ instrument: text(160, 'Name or code'), labName: text(120), certificateNo: text(80), calibratedOn: dateStr('YYYY-MM-DD'), validUntil: dateStr('YYYY-MM-DD'), by: text(160, 'Who calibrated it') }, ['instrument', 'certificateNo']),
    permission: 'labs.manage',
    service: 'labs.assets.recordCalibration()',
    async prepare(ctx, args) {
      const labId = await theLabId(ctx, args.labName);
      const rows = await labAssets.listEquipment(ctx.actor, ctx.scope, { ...(labId && { labId }) });
      const e = rows.find((x) => lower(x.code) === lower(args.instrument)) ?? theNamed(rows, args.instrument, { label: 'instrument', nameOf: (x) => x.name, describe: (x) => `${x.name} (${x.code})` });
      return { id: e.id, name: e.name, code: e.code };
    },
    summarise: (args, _a, p) => `Record calibration of ${p?.name ?? args.instrument} (${p?.code ?? ''}), certificate ${args.certificateNo}${args.validUntil ? `, valid until ${args.validUntil}` : ''}`,
    async run(ctx, args, p) {
      const e = await labAssets.recordCalibration(ctx.actor, ctx.scope, p.id, { certificateNo: args.certificateNo, calibratedOn: args.calibratedOn, validUntil: args.validUntil, by: args.by });
      return action({ type: 'lab_calibration_recorded', id: e.id, data: { instrument: e.name, calibrationDueOn: day(e.calibrationDueOn) }, speak: `${e.name} is calibrated; next due ${day(e.calibrationDueOn)}.` });
    },
  }),

  plan_practical_session: behind('labs', {
    module: 'Labs', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: 'Plan a practical in a lab for a class at a date and time (the lab is checked for clashes). Materials are added on the Labs screen. Needs confirmation.',
    inputSchema: closed({ labName: text(120), title: text(200), className: text(60, 'e.g. "Class 9 A"'), subject: text(80), date: dateStr('YYYY-MM-DD'), startTime: hm('HH:MM'), durationMinutes: { type: 'integer', minimum: 15, maximum: 240 } }, ['labName', 'title', 'date', 'startTime']),
    permission: 'labs.manage',
    service: 'labs.sessions.createSession()',
    async prepare(ctx, args) {
      const all = (await Lab.find({ status: 'ACTIVE' }).select('_id name').lean()).map((l) => ({ id: String(l._id), name: l.name }));
      const lab = theNamed(all, args.labName, { label: 'lab', nameOf: (l) => l.name });
      const section = args.className ? await resolveSection({ ...ctx, scope: 'ALL' }, { className: args.className }) : null;
      return { labId: lab.id, lab: lab.name, sectionId: section?.sectionId ?? null, className: section?.label ?? null };
    },
    summarise: (args, _a, p) => `Plan "${args.title}"${p?.className ? ` for ${p.className}` : ''} in ${p?.lab ?? args.labName} on ${args.date} at ${args.startTime} (${args.durationMinutes ?? 45} min)`,
    async run(ctx, args, p) {
      const start = istAt(args.date, args.startTime);
      const s = await labSessions.createSession(ctx.actor, ctx.scope, { labId: p.labId, title: args.title, subject: args.subject, sectionId: p.sectionId, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + (args.durationMinutes ?? 45) * 60_000).toISOString() });
      return action({ type: 'practical_planned', id: s.id, data: { ref: s.refNo, title: s.title, lab: s.labName, date: day(s.startsAt), time: time(s.startsAt) }, speak: `Planned ${s.refNo}: ${s.title} in ${s.labName} on ${day(s.startsAt)} at ${time(s.startsAt)}.` });
    },
  }),

  report_lab_incident: behind('labs', {
    module: 'Labs', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true,
    description: "Report a lab incident (spill, injury, breakage, fire, exposure, near miss, equipment failure ...). The lab's in-charge is told; a high-severity incident or injury also goes to the principal and administrator. Needs confirmation.",
    inputSchema: closed({
      labName: text(120),
      kind: { type: 'string', enum: ['SPILL', 'INJURY', 'BREAKAGE', 'FIRE', 'EXPOSURE', 'NEAR_MISS', 'EQUIPMENT_FAILURE', 'DEVICE_DAMAGE', 'OTHER'] },
      severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
      description: text(4000),
      actionsTaken: text(2000),
    }, ['labName', 'kind', 'description']),
    permission: 'labs.manage',
    service: 'labs.sessions.reportIncident()',
    async prepare(ctx, args) {
      const all = (await Lab.find({}).select('_id name').lean()).map((l) => ({ id: String(l._id), name: l.name }));
      const lab = theNamed(all, args.labName, { label: 'lab', nameOf: (l) => l.name });
      return { labId: lab.id, lab: lab.name };
    },
    summarise: (args, _a, p) => `Report a ${(args.severity ?? 'LOW').toLowerCase()}-severity ${words(args.kind)} in ${p?.lab ?? args.labName}: ${args.description}`,
    async run(ctx, args, p) {
      const i = await labSessions.reportIncident(ctx.actor, ctx.scope, { labId: p.labId, kind: args.kind, severity: args.severity, description: args.description, actionsTaken: args.actionsTaken });
      return action({ type: 'lab_incident_reported', id: i.id, data: { ref: i.refNo, lab: p.lab, status: i.status }, speak: `Reported as ${i.refNo}.` });
    },
  }),

  draft_lab_reorder: behind('labs', {
    module: 'Labs', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: 'Draft a purchase request to reorder a lab item (default: its reorder quantity). Only a DRAFT: it is completed and submitted through Procurement by a person. Needs confirmation.',
    inputSchema: closed({ ...labItemSchema, quantity: { type: 'number', exclusiveMinimum: 0 }, unit: text(10) }, ['item']),
    permission: 'labs.manage',
    service: 'labs.service.reorder()',
    async prepare(ctx, args) {
      const it = await theLabItem(ctx, args);
      return { itemId: it.id, item: it.name, lab: it.labName };
    },
    summarise: (args, _a, p) => `Draft a purchase request to reorder ${args.quantity ? `${args.quantity} ${args.unit ?? ''} of ` : ''}${p?.item ?? args.item} (${p?.lab ?? 'lab'}); it stays a draft until submitted in Procurement`,
    async run(ctx, args, p) {
      const out = await labs.reorder(ctx.actor, ctx.scope, p.itemId, { ...(args.quantity && { quantity: args.quantity, unit: args.unit }) });
      return action({ type: 'lab_reorder_drafted', id: out.purchaseRequest?.id, data: { purchaseRequest: out.purchaseRequest?.refNo ?? null, item: p.item }, speak: `Drafted ${out.purchaseRequest?.refNo ?? 'a purchase request'} for ${p.item}. Complete and submit it in Procurement.` });
    },
  }),
};

/* ── Fee concessions, credit notes, voids; the accounts export ── */

const presentAdjustment = (a) => ({ ref: a.refNo, kind: a.kind, invoiceNo: a.invoiceNo, student: a.studentName ?? null, scheme: a.concessionName ?? null, amount: rupees(a.amountPaise), status: a.status, reason: a.reason });

/** Pending fee adjustments the caller is the approver for, from their own approvals inbox. */
async function adjustmentsAwaitingMe(ctx) {
  const inbox = rowsOf(await approvals.inbox(ctx.actor)).filter((r) => r.entityType === 'FeeAdjustment' || r.category === 'FEE_CONCESSION');
  const ids = inbox.map((r) => r.entityId).filter(Boolean);
  const adj = await FeeAdjustment.find({ $or: [{ _id: { $in: ids } }, { approvalRequestId: { $in: inbox.map((r) => r.id) } }], status: 'PENDING_APPROVAL' }).select('-history').lean();
  const out = [];
  for (const a of adj) {
    // eslint-disable-next-line no-await-in-loop
    const shown = (await adjustments.listAdjustments(ctx.actor, { invoiceId: String(a.invoiceId), status: 'PENDING_APPROVAL' })).find((x) => x.id === String(a._id)) ?? { ...a, id: String(a._id) };
    out.push({ ...shown, approvalRequestId: String(a.approvalRequestId), requestedByProfileId: String(a.requestedByProfileId) });
  }
  return out;
}

const feeAdjustmentTools = {
  list_fee_adjustments: behind('accountsExport', {
    module: 'Fees', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'Fee concessions, credit notes and voids on issued invoices, with the student, amount, reason and where each stands (open ones by default). Read-only.',
    inputSchema: closed({ status: { type: 'string', enum: ['PENDING_APPROVAL', 'APPLIED', 'REJECTED', 'WITHDRAWN'] }, kind: { type: 'string', enum: ['CONCESSION', 'CREDIT_NOTE', 'VOID'] } }),
    permission: 'fees.concessions.manage', minScope: 'ALL',
    service: 'adjustment.service.listAdjustments()',
    async run(ctx, args) {
      const rows = (await adjustments.listAdjustments(ctx.actor, { status: args.status ?? 'PENDING_APPROVAL', ...(args.kind && { kind: args.kind }) })).map(presentAdjustment);
      const view = summarise(rows, (a) => `${a.ref} ${words(a.kind)} ${a.amount} on ${a.invoiceNo}${a.student ? ` (${a.student})` : ''}`);
      return ok({ adjustments: rows, count: rows.length }, { speak: rows.length ? `${plural(rows.length, 'adjustment')}: ${view.list}.` : 'No fee adjustments match that.' });
    },
  }),

  list_concession_schemes: behind('accountsExport', {
    module: 'Fees', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: "The school's fee concession schemes (sibling, staff ward, merit ...) with how each is worked out and who is eligible. Read-only.",
    inputSchema: closed({}),
    permission: 'fees.concessions.manage', minScope: 'ALL',
    service: 'adjustment.service.listConcessionTypes()',
    async run() {
      const rows = (await adjustments.listConcessionTypes()).map((t) => ({ code: t.code, name: t.name, kind: t.kind, method: t.method, value: t.method === 'PERCENT' ? `${t.valueBp / 100}%` : t.method === 'FIXED' ? rupees(t.amountPaise) : 'decided per case', appliesTo: t.feeHeadNames, eligibility: t.eligibility, active: t.active }));
      const view = summarise(rows.filter((r) => r.active), (r) => `${r.name} (${r.value})`);
      return ok({ schemes: rows, count: rows.length }, { speak: rows.length ? `Concession schemes: ${view.list}.` : 'No concession schemes are set up.' });
    },
  }),

  request_fee_adjustment: behind('accountsExport', {
    module: 'Fees', operation: 'CREATE', risk: RISK.HIGH, confirm: true, affectsOthers: true,
    description: 'Request a fee concession (under a scheme), a credit note or a void on an issued invoice, with the reason. It goes to the approvals engine and changes nothing until an approver decides. A credit note or void also needs fees.manage. Money, so it is confirmed on the website.',
    inputSchema: closed({
      invoiceNo: text(40, 'e.g. "INV-1001"'),
      kind: { type: 'string', enum: ['CONCESSION', 'CREDIT_NOTE', 'VOID'] },
      scheme: text(120, 'For a concession: the scheme name or code'),
      amountRupees: { type: 'number', minimum: 0.01, description: 'For a credit note, or a discretionary concession' },
      reason: text(2000),
    }, ['invoiceNo', 'kind', 'reason']),
    permission: 'fees.concessions.manage', minScope: 'ALL',
    service: 'adjustment.service.requestAdjustment()',
    async prepare(ctx, args) {
      if (args.kind !== 'CONCESSION' && ctx.actor.permissions?.['fees.manage'] !== 'ALL') throw new AppError('A credit note or a void changes an invoice, so it needs fees.manage at school-wide scope.', 403);
      const inv = await Invoice.findOne({ invoiceNo: String(args.invoiceNo).trim().toUpperCase() }).select('_id invoiceNo totalPaise paidPaise').lean()
        ?? await Invoice.findOne({ invoiceNo: String(args.invoiceNo).trim() }).select('_id invoiceNo totalPaise paidPaise').lean();
      if (!inv) throw new AppError(`No invoice ${args.invoiceNo}.`, 404);
      let scheme = null;
      if (args.kind === 'CONCESSION') {
        if (!args.scheme) throw new AppError('Which concession scheme?', 400, [], 'AGENT_NEEDS_INPUT');
        const types = (await adjustments.listConcessionTypes()).filter((t) => t.active);
        scheme = types.find((t) => lower(t.code) === lower(args.scheme)) ?? theNamed(types, args.scheme, { label: 'concession scheme', nameOf: (t) => t.name });
      }
      return { invoiceId: String(inv._id), invoiceNo: inv.invoiceNo, schemeId: scheme?.id ?? null, scheme: scheme?.name ?? null, amountPaise: args.amountRupees ? paiseOf(args.amountRupees, 'amountRupees') : null };
    },
    summarise: (args, _a, p) => `Request ${args.kind === 'CONCESSION' ? `a ${p?.scheme ?? args.scheme} concession` : args.kind === 'VOID' ? 'a void' : 'a credit note'}${p?.amountPaise ? ` of ${rupees(p.amountPaise)}` : ''} on invoice ${p?.invoiceNo ?? args.invoiceNo} — reason: ${args.reason}. It goes for approval; the invoice changes only if it is approved.`,
    async run(ctx, args, p) {
      const a = await adjustments.requestAdjustment(ctx.actor, { kind: args.kind, invoiceId: p.invoiceId, concessionTypeId: p.schemeId, amountPaise: p.amountPaise ?? undefined, reason: args.reason });
      return action({ type: 'fee_adjustment_requested', id: a.id, data: presentAdjustment(a), speak: `Sent for approval as ${a.refNo}: ${rupees(a.amountPaise)} off ${a.invoiceNo}.` });
    },
  }),

  withdraw_fee_adjustment: behind('accountsExport', {
    module: 'Fees', operation: 'ACTION', risk: RISK.MEDIUM, confirm: true,
    description: 'Withdraw a fee concession, credit note or void that is still waiting for approval. Needs confirmation.',
    inputSchema: closed({ ref: text(40, 'e.g. "CON-000012"'), invoiceNo: text(40), reason: text(500) }),
    permission: 'fees.concessions.manage', minScope: 'ALL',
    service: 'adjustment.service.withdrawAdjustment()',
    async prepare(ctx, args) {
      const rows = await adjustments.listAdjustments(ctx.actor, { status: 'PENDING_APPROVAL' });
      const a = byRefOrName(rows, { ref: args.ref, name: args.invoiceNo }, { label: 'pending adjustment', refOf: (x) => x.refNo, nameOf: (x) => `${x.invoiceNo} ${x.studentName ?? ''}`, describe: (x) => `${x.refNo} on ${x.invoiceNo}` });
      return { id: a.id, refNo: a.refNo, invoiceNo: a.invoiceNo };
    },
    summarise: (args, _a, p) => `Withdraw ${p?.refNo ?? args.ref} on invoice ${p?.invoiceNo ?? args.invoiceNo}${args.reason ? ` — ${args.reason}` : ''}`,
    async run(ctx, args, p) {
      const a = await adjustments.withdrawAdjustment(ctx.actor, p.id, { reason: args.reason });
      return action({ type: 'fee_adjustment_withdrawn', id: a.id, data: presentAdjustment(a), speak: `${a.refNo} is withdrawn.` });
    },
  }),

  record_concession_decision: behind('accountsExport', {
    module: 'Fees', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true,
    description: "Record the approver's own decision on a fee concession, credit note or void waiting at their approval stage: APPROVE, REJECT (with a reason) or RETURN for changes. Only when the approver says so in their own words; never suggested. Nobody decides a request they raised. Confirmed on the website.",
    inputSchema: closed({
      ref: text(40, 'The adjustment reference, e.g. "CON-000012"'),
      studentName: text(80, 'Or the student it is for'),
      decision: { type: 'string', enum: ['APPROVE', 'REJECT', 'RETURN'], description: "The approver's own decision" },
      comment: text(2000, 'Required to reject or return'),
    }, ['decision']),
    permission: 'approvals.decide',
    service: 'approval.service.decide() on a FeeAdjustment request',
    async prepare(ctx, args) {
      if (args.decision !== 'APPROVE' && !args.comment) throw new AppError('Give the reason, so the requester knows what to change.', 400, [], 'AGENT_NEEDS_INPUT');
      const rows = await adjustmentsAwaitingMe(ctx);
      const a = byRefOrName(rows, { ref: args.ref, name: args.studentName }, { label: 'fee adjustment waiting for your decision', refOf: (x) => x.refNo, nameOf: (x) => `${x.studentName ?? ''} ${x.invoiceNo}`, describe: (x) => `${x.refNo} ${x.studentName ?? ''} ${rupees(x.amountPaise)}` });
      if (a.requestedByProfileId === String(ctx.actor.profileId)) throw new AppError('You raised this request, so somebody else decides it.', 403, [], 'SELF_APPROVAL');
      return { approvalRequestId: a.approvalRequestId, refNo: a.refNo, kind: a.kind, invoiceNo: a.invoiceNo, student: a.studentName ?? null, amountPaise: a.amountPaise };
    },
    summarise: (args, _a, p) => `${{ APPROVE: 'Approve', REJECT: 'Reject', RETURN: 'Return for changes' }[args.decision]} ${p?.refNo ?? ''}: ${words(p?.kind ?? '')} of ${rupees(p?.amountPaise)} on ${p?.invoiceNo ?? ''}${p?.student ? ` for ${p.student}` : ''}${args.comment ? ` — ${args.comment}` : ''}`,
    async run(ctx, args, p) {
      const r = await approvals.decide(ctx.actor, p.approvalRequestId, { action: args.decision, comment: args.comment });
      return action({ type: 'fee_adjustment_decided', id: r.id, data: { ref: p.refNo, approval: r.status }, speak: `Recorded your decision on ${p.refNo}: the request is now ${words(r.status)}.` });
    },
  }),

  get_gst_summary: behind('accountsExport', {
    module: 'Fees', operation: 'GET', risk: RISK.LOW, resultShape: 'SUMMARY',
    description: "GST on fee lines for a period, by HSN/SAC and rate (taxable value, CGST, SGST), with untaxed lines and credits on taxed invoices — for the accountant. Not tax advice. The Tally voucher file is downloaded on the Accounts export screen. Read-only.",
    inputSchema: closed({ from: dateStr('YYYY-MM-DD'), to: dateStr('YYYY-MM-DD') }, ['from', 'to']),
    permission: 'accounts.export', minScope: 'ALL',
    service: 'accounts-export.service.gstSummary()',
    async run(ctx, args) {
      const g = await accountsExport.gstSummary(ctx.actor, { from: args.from, to: args.to });
      const rows = g.rows.map((r) => ({ hsnSac: r.hsnSac, ratePct: r.ratePct, taxable: rupees(r.taxablePaise), cgst: rupees(r.cgstPaise), sgst: rupees(r.sgstPaise), invoices: r.invoices }));
      return ok({ period: g.period, rows, totals: { taxable: rupees(g.totals.taxablePaise), tax: rupees(g.totals.taxPaise) }, untaxed: rupees(g.untaxed.amountPaise), disclaimer: g.disclaimer }, {
        speak: `${g.period.from} to ${g.period.to}: taxable ${rupees(g.totals.taxablePaise)}, GST ${rupees(g.totals.taxPaise)}; ${rupees(g.untaxed.amountPaise)} on untaxed lines.`,
      });
    },
  }),
};

/* ── Fleet: vehicles, trips, my child's bus ────────────── */

const fleetTools = {
  get_my_child_bus: behind('fleet', {
    module: 'Transport', operation: 'GET', risk: RISK.LOW, resultShape: 'DETAIL',
    description: "Where my child's bus is today: their trip, its status, their stop, the estimated arrival (an estimate), and whether they have boarded, got off or been handed over. Only the caller's own child (or own trips); never other children. Read-only.",
    inputSchema: closed({ childName: text(80) }),
    permission: 'transport.tracking.read',
    // GET /fleet/my-trips: a parent (tracking.read) or a student (transport.request); the service returns only their own.
    anyOf: [['transport.tracking.read'], ['transport.request']],
    service: 'trips.service.myTrips()',
    async run(ctx, args) {
      const mine = await trips.myTrips(ctx.actor);
      let children = mine.children ?? [];
      if (!children.length) return ok({ children: [] }, { speak: ctx.scope === 'ALL' ? 'You have no child of your own on a bus. Ask for the live bus status to see every vehicle.' : 'No bus trip is planned for your child today.' });
      if (args.childName) children = [theNamed(children, args.childName, { label: 'child of yours', nameOf: (c) => c.name })];
      const out = children.map((c) => ({
        child: c.name,
        trips: c.trips.map((t) => ({
          trip: t.title, kind: t.kindLabel, status: t.status, vehicle: t.vehicle?.registrationNo ?? null, attendant: t.attendantName,
          stop: t.stop?.name ?? null, plannedAt: time(t.stop?.plannedAt), arrivedAt: time(t.stop?.arrivedAt),
          eta: t.eta ? { minutes: t.eta.minutes ?? null, at: time(t.eta.at), label: t.eta.label ?? 'estimate' } : null,
          myStatus: t.myStatus, boardedAt: time(t.boardedAt), alightedAt: time(t.alightedAt), handedOverTo: t.handover?.receivedByKind ?? null,
          liveLocation: t.positionStatus ?? null,
        })),
      }));
      const said = out.map((c) => (c.trips.length
        ? `${c.child}: ${c.trips.map((t) => `${t.kind} ${words(t.status)}${t.eta?.minutes != null ? `, about ${t.eta.minutes} min to ${t.stop ?? 'the stop'} (estimate)` : ''}; ${words(t.myStatus)}`).join('; ')}`
        : `${c.child}: no bus trip today`)).join('. ');
      return ok({ children: out, note: mine.note }, { speak: `${said}.` });
    },
  }),

  get_live_bus_status: behind('fleet', {
    module: 'Transport', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: "Every bus right now: whether its location is live, stale or offline, when it was last seen, and the trip it is running. For the transport office and the principal. The map is on the Fleet screen. Read-only.",
    inputSchema: closed({}),
    permission: 'transport.tracking.read', minScope: 'ALL',
    service: 'telemetry.service.livePositions()',
    async run() {
      const live = await telemetry.livePositions();
      const rows = live.vehicles.map((v) => ({ vehicle: v.registrationNo, type: v.type, vehicleStatus: v.vehicleStatus, location: v.positionStatus, lastSeenMinutes: v.lastSeenMinutes, trip: v.trip ? { ref: v.trip.refNo, kind: v.trip.kind, status: v.trip.status, route: v.trip.routeName } : null }));
      const running = rows.filter((r) => r.trip?.status === 'IN_PROGRESS');
      const offline = rows.filter((r) => r.trip && ['OFFLINE', 'NO_DATA'].includes(r.location));
      const view = summarise(running, (r) => `${r.vehicle} on ${r.trip.route ?? r.trip.ref} (${words(r.location)}${r.lastSeenMinutes != null ? `, ${r.lastSeenMinutes} min ago` : ''})`);
      return ok({ vehicles: rows, running: running.length, offlineOnTrip: offline.length }, {
        speak: running.length ? `${plural(running.length, 'bus', 'buses')} running: ${view.list}.${offline.length ? ` ${offline.length} on a trip without a live location.` : ''}` : 'No bus is on a trip right now.',
      });
    },
  }),

  list_trips: behind('fleet', {
    module: 'Transport', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: "Bus trips on a day (default today): vehicle, status, seats used and free, and how many have boarded, got off or not shown up. A teacher on bus duty sees only their own trips. Read-only.",
    inputSchema: closed({ date: dateStr('YYYY-MM-DD') }),
    permission: 'transport.trips.operate',
    // GET /fleet/trips: requireAnyOf(fleet.manage, tracking.read ALL, trips.operate); ctx.scope is the best of them, as req.scope.
    anyOf: [['transport.fleet.manage'], ['transport.tracking.read', 'ALL'], ['transport.trips.operate']],
    service: 'trips.service.list()',
    async run(ctx, args) {
      const rows = (await trips.list(ctx.actor, ctx.scope, { date: args.date ?? todayIst() })).map((t) => ({ ref: t.refNo, title: t.title, kind: t.kindLabel, status: t.status, vehicle: t.registrationNo, seatsAllocated: t.seatsAllocated ?? 0, seatsFree: t.seatsFree, boarded: t.counts?.BOARDED ?? 0, alighted: t.counts?.ALIGHTED ?? 0, noShow: t.counts?.NO_SHOW ?? 0 }));
      const view = summarise(rows, (t) => `${t.ref} ${t.title} (${words(t.status)}, ${t.vehicle ?? 'no vehicle'})`);
      return ok({ trips: rows, count: rows.length }, { speak: rows.length ? `${plural(rows.length, 'trip')}: ${view.list}.` : 'No trips on that day.' });
    },
  }),

  record_trip_boarding: behind('fleet', {
    module: 'Transport', operation: 'ACTION', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: "Record a student boarding (BOARDED), getting off (ALIGHTED) or not at the stop (NO_SHOW) on a trip the caller runs. A no-show tells the guardians. A wrong vehicle is refused and raised as an alert. Safe handover at a drop is recorded on the Fleet screen. Confirmed on the website.",
    inputSchema: closed({ studentName: text(80), event: { type: 'string', enum: ['BOARDED', 'ALIGHTED', 'NO_SHOW'] }, tripRef: text(40, 'When more than one trip is running'), note: text(300) }, ['studentName', 'event']),
    permission: 'transport.trips.operate',
    service: 'trips.service.board() / alight() / markNoShow()',
    async prepare(ctx, args) {
      const today = await trips.list(ctx.actor, ctx.scope, { date: todayIst() });
      const open = today.filter((t) => ['PLANNED', 'IN_PROGRESS'].includes(t.status));
      const pool = open.filter((t) => t.status === 'IN_PROGRESS').length ? open.filter((t) => t.status === 'IN_PROGRESS') : open;
      const trip = byRefOrName(args.tripRef ? open : pool, { ref: args.tripRef }, { label: 'trip of yours today', refOf: (t) => t.refNo, nameOf: (t) => t.title, describe: (t) => `${t.refNo} ${t.title}` });
      const detail = await trips.get(ctx.actor, ctx.scope, trip.id);
      const alloc = theNamed(detail.allocations.filter((a) => a.status !== 'RELEASED'), args.studentName, { label: 'student on this trip', nameOf: (a) => a.studentName });
      return { tripId: trip.id, tripRef: trip.refNo, trip: trip.title, studentId: String(alloc.studentId), student: alloc.studentName };
    },
    summarise: (args, _a, p) => `Record ${p?.student ?? args.studentName} as ${{ BOARDED: 'boarded', ALIGHTED: 'got off', NO_SHOW: 'not at the stop (guardians are told)' }[args.event]} on ${p?.tripRef ?? ''} ${p?.trip ?? ''}`,
    async run(ctx, args, p) {
      const body = { studentId: p.studentId, note: args.note };
      if (args.event === 'BOARDED') await trips.board(ctx.actor, ctx.scope, p.tripId, body);
      else if (args.event === 'ALIGHTED') await trips.alight(ctx.actor, ctx.scope, p.tripId, body);
      else await trips.markNoShow(ctx.actor, ctx.scope, p.tripId, body);
      return action({ type: 'trip_boarding_recorded', id: p.tripId, data: { trip: p.tripRef, student: p.student, event: args.event }, speak: `Recorded: ${p.student} ${words(args.event)} on ${p.tripRef}.` });
    },
  }),

  list_vehicles: behind('fleet', {
    module: 'Transport', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'School vehicles with status, capacity, and papers (permit, insurance, fitness, PUC) expired or expiring within 30 days, plus safety checks and service due. Read-only.',
    inputSchema: closed({ show: { type: 'string', enum: ['papers_due', 'off_road', 'all'] } }),
    permission: 'transport.fleet.manage',
    // GET /fleet/vehicles: requireAnyOf(fleet.manage, tracking.read ALL, trips.operate ALL, transport.read ALL).
    anyOf: [['transport.fleet.manage'], ['transport.tracking.read', 'ALL'], ['transport.trips.operate', 'ALL'], ['transport.read', 'ALL']],
    service: 'vehicles.service.list()',
    async run(_ctx, args) {
      let rows = (await vehicles.list({})).map((v) => ({
        vehicle: v.registrationNo, type: v.type, status: v.status, seats: v.usableSeats,
        papersDue: (v.documents ?? []).filter((d) => ['EXPIRED', 'EXPIRING'].includes(d.state)).map((d) => ({ kind: d.kind, validTo: day(d.validTo), state: d.state })),
        cannotRun: v.blockingDocuments ?? [], service: v.safetyState?.service ?? null, fireExtinguisher: v.safetyState?.fireExtinguisher ?? null, firstAid: v.safetyState?.firstAid ?? null,
      }));
      if (args.show === 'papers_due') rows = rows.filter((v) => v.papersDue.length || v.cannotRun.length);
      if (args.show === 'off_road') rows = rows.filter((v) => v.status !== 'ACTIVE');
      const view = summarise(rows, (v) => `${v.vehicle} (${words(v.status)}${v.papersDue.length ? `; ${v.papersDue.map((d) => `${words(d.kind)} ${d.state.toLowerCase()}`).join(', ')}` : ''})`);
      return ok({ vehicles: rows, count: rows.length }, { speak: rows.length ? `${plural(rows.length, 'vehicle')}: ${view.list}.` : 'No vehicles match that.' });
    },
  }),

  log_vehicle_event: behind('fleet', {
    module: 'Transport', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true,
    description: "Log a fuel fill, a service, a breakdown (which takes the vehicle off the road unless told otherwise), an odometer reading or a fire-extinguisher / first-aid check for a vehicle. Needs confirmation.",
    inputSchema: closed({
      vehicle: text(20, 'Registration number, e.g. "KA01AB1234"'),
      kind: { type: 'string', enum: ['FUEL', 'SERVICE', 'BREAKDOWN', 'ODOMETER', 'SAFETY_CHECK'] },
      odometerKm: { type: 'number', minimum: 0 },
      litres: { type: 'number', minimum: 0 },
      amountRupees: { type: 'number', minimum: 0 },
      vendor: text(120),
      note: text(2000),
      severity: { type: 'string', enum: ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] },
      check: { type: 'string', enum: ['FIRE_EXTINGUISHER', 'FIRST_AID'] },
      nextDueOn: dateStr('YYYY-MM-DD'),
      keepOnRoad: { type: 'boolean', description: 'For a minor breakdown that does not take the vehicle off the road' },
    }, ['vehicle', 'kind']),
    permission: 'transport.fleet.manage',
    service: 'vehicles.service.addLog()',
    async prepare(_ctx, args) {
      const all = await vehicles.list({});
      const want = String(args.vehicle).toUpperCase().replace(/\s+/g, '');
      const v = all.find((x) => x.registrationNo === want) ?? theNamed(all, want, { label: 'vehicle', nameOf: (x) => x.registrationNo });
      return { id: v.id, reg: v.registrationNo };
    },
    summarise: (args, _a, p) => `Log ${words(args.kind)} for ${p?.reg ?? args.vehicle}${args.litres ? `: ${args.litres} L` : ''}${args.amountRupees ? `, ${rupees(Math.round(args.amountRupees * 100))}` : ''}${args.odometerKm ? `, odometer ${args.odometerKm} km` : ''}${args.note ? ` — ${args.note}` : ''}${args.kind === 'BREAKDOWN' && !args.keepOnRoad ? ' (the vehicle goes off the road)' : ''}`,
    async run(ctx, args, p) {
      const log = await vehicles.addLog(ctx.actor, p.id, {
        kind: args.kind, odometerKm: args.odometerKm, litres: args.litres, vendor: args.vendor, note: args.note, severity: args.severity, check: args.check, nextDueOn: args.nextDueOn,
        ...(args.amountRupees !== undefined && { amountPaise: Math.round(args.amountRupees * 100) }),
        ...(args.keepOnRoad && { takeOffRoad: false }),
      });
      return action({ type: 'vehicle_logged', id: log.id, data: { vehicle: p.reg, kind: args.kind }, speak: `Logged ${words(args.kind)} for ${p.reg}.` });
    },
  }),
};

/* ── Safety: visitors, pickup, ID cards, emergency roster, camera count ── */

const presentVisitor = (v) => ({ ref: v.refNo, name: v.name, kind: v.kind, organisation: v.organisation ?? null, purpose: v.purpose, host: v.hostName ?? null, status: v.status, expected: v.expectedAt ? `${day(v.expectedAt)} ${time(v.expectedAt)}` : null, checkedInAt: time(v.checkedInAt), overstaying: Boolean(v.overstaying) });

/**
 * Pickup delegation has no key of its own: the REST routes (/pickup/mine) admit
 * any signed-in guardian and the service checks the guardian link. The tools
 * gate on transport.tracking.read -- the key a parent holds for their own
 * child's journey, and a student does not -- so the catalogue offers them to
 * families' guardians rather than to every holder of students.read; the
 * service and this check still refuse anyone who is not the child's guardian.
 */
async function guardianOnly(ctx) {
  if (ctx.actor?.roleKey !== 'PARENT') throw new AppError('Pickup delegates are managed by a parent or guardian for their own child.', 403);
}

const safetyTools = {
  get_visitors_on_site: behind('visitors', {
    module: 'Safety', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'Visitors and contractors: on site now (default), expected today, or waiting for their host. With host, purpose, check-in time and overstays. Read-only.',
    inputSchema: closed({ view: { type: 'string', enum: ['onsite', 'today', 'pending'] } }),
    permission: 'visitors.manage',
    service: 'visitors.service.list()',
    async run(_ctx, args) {
      const view = args.view ?? 'onsite';
      const rows = (await visitors.list(view === 'pending' ? { status: 'PENDING_HOST' } : { view })).map(presentVisitor);
      const over = rows.filter((v) => v.overstaying).length;
      const list = summarise(rows, (v) => `${v.name}${v.organisation ? ` (${v.organisation})` : ''} for ${v.host ?? 'the office'}`);
      const what = { onsite: 'on site', today: 'today', pending: 'waiting for their host' }[view];
      return ok({ visitors: rows, count: rows.length, overstaying: over }, { speak: rows.length ? `${plural(rows.length, 'visitor')} ${what}${over ? `, ${over} past their badge time` : ''}: ${list.list}.` : `No visitors ${what}.` });
    },
  }),

  add_visitor: behind('visitors', {
    module: 'Safety', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: "Pre-register a visitor or contractor: name, purpose, host, expected time. A visitor for someone else waits for that host's approval; a contractor needs the work order or check done. Needs confirmation.",
    inputSchema: closed({
      name: text(120), purpose: text(300), kind: { type: 'string', enum: ['VISITOR', 'CONTRACTOR', 'VENDOR', 'PARENT_VISIT', 'OFFICIAL'] },
      organisation: text(160), phone: text(20), hostName: text(120, 'The member of staff they are meeting; default the caller'),
      expectedDate: dateStr('YYYY-MM-DD'), expectedTime: hm('HH:MM'), expectedHours: { type: 'number', minimum: 0.25, maximum: 24 },
      contractorCheckNote: text(500, 'For a contractor: the work order or the check done'),
    }, ['name', 'purpose']),
    permission: 'visitors.manage',
    service: 'visitors.service.create()',
    async prepare(_ctx, args) {
      const host = args.hostName ? await staffNamed(args.hostName, 'host') : null;
      if (args.kind === 'CONTRACTOR' && !args.contractorCheckNote) throw new AppError('For a contractor, what is the work order or the check done?', 400, [], 'AGENT_NEEDS_INPUT');
      return { host };
    },
    summarise: (args, _a, p) => `Register ${words(args.kind ?? 'VISITOR')} ${args.name}${args.organisation ? ` (${args.organisation})` : ''} to see ${p?.host?.name ?? 'you'} for "${args.purpose}"${args.expectedDate ? ` on ${args.expectedDate}${args.expectedTime ? ` at ${args.expectedTime}` : ''}` : ' today'}`,
    async run(ctx, args, p) {
      const v = await visitors.create(ctx.actor, {
        name: args.name, purpose: args.purpose, kind: args.kind, organisation: args.organisation, phone: args.phone, expectedHours: args.expectedHours, contractorCheckNote: args.contractorCheckNote,
        ...(p?.host && { hostProfileId: p.host.id }),
        ...(args.expectedDate && { expectedAt: istAt(args.expectedDate, args.expectedTime ?? '09:00').toISOString() }),
      });
      return action({ type: 'visitor_registered', id: v.id, data: presentVisitor(v), speak: `Registered ${v.name} (${v.refNo})${v.status === 'PENDING_HOST' ? `; waiting for ${v.hostName} to approve` : ''}.` });
    },
  }),

  update_visitor: behind('visitors', {
    module: 'Safety', operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: "Check a visitor in (only after their photo ID has been seen — say so), check them out, or cancel an expected visit. Only the ID's type and last four characters are kept. Needs confirmation.",
    inputSchema: closed({
      visitor: text(120, 'Name or reference'), step: { type: 'string', enum: ['CHECK_IN', 'CHECK_OUT', 'CANCEL'] },
      idVerified: { type: 'boolean', description: 'For check-in: the photo ID was seen' }, idType: text(40), idLast4: text(8), badgeNumber: text(20), note: text(300),
    }, ['visitor', 'step']),
    permission: 'visitors.manage',
    service: 'visitors.service.checkIn() / checkOut() / cancel()',
    async prepare(_ctx, args) {
      if (args.step === 'CHECK_IN' && args.idVerified !== true) throw new AppError("Has their photo ID been checked? Check-in needs that first.", 400, [], 'AGENT_NEEDS_INPUT');
      const statuses = { CHECK_IN: ['APPROVED'], CHECK_OUT: ['CHECKED_IN'], CANCEL: ['PENDING_HOST', 'APPROVED'] }[args.step];
      const rows = (await visitors.list({ status: 'ALL' })).filter((v) => statuses.includes(v.status));
      const v = byRefOrName(rows, { ref: /^VIS/i.test(args.visitor) ? args.visitor : null, name: /^VIS/i.test(args.visitor) ? null : args.visitor }, { label: 'visitor', refOf: (x) => x.refNo, nameOf: (x) => x.name, describe: (x) => `${x.name} (${x.refNo})` });
      return { id: v.id, name: v.name, refNo: v.refNo };
    },
    summarise: (args, _a, p) => `${{ CHECK_IN: 'Check in', CHECK_OUT: 'Check out', CANCEL: 'Cancel the visit of' }[args.step]} ${p?.name ?? args.visitor} (${p?.refNo ?? ''})${args.step === 'CHECK_IN' ? `, photo ID seen${args.idType ? ` (${args.idType})` : ''}` : ''}`,
    async run(ctx, args, p) {
      const body = { idVerified: args.idVerified, idType: args.idType, idLast4: args.idLast4, badgeNumber: args.badgeNumber, note: args.note };
      const fn = { CHECK_IN: visitors.checkIn, CHECK_OUT: visitors.checkOut, CANCEL: visitors.cancel }[args.step];
      const v = await fn(ctx.actor, p.id, body);
      return action({ type: 'visitor_updated', id: v.id, data: presentVisitor(v), speak: `${v.name} is ${words(v.status)}.` });
    },
  }),

  get_emergency_roster: behind('visitors', {
    module: 'Safety', operation: 'GET', risk: RISK.LOW, resultShape: 'SUMMARY',
    description: "Who should be on campus now, for an evacuation or emergency count: students marked present and not released or out on a pass (by class), released today, on out-pass, and visitors checked in. A roster to account for people in person, not a location tracker; the named list is printed from the Gate screen. Read-only.",
    inputSchema: closed({}),
    permission: 'visitors.manage',
    // GET /safety/emergency-roster: requireAnyOf(visitors.manage, checkpoints.read ALL).
    anyOf: [['visitors.manage'], ['checkpoints.read', 'ALL']],
    service: 'pickup.service.emergencyRoster()',
    async run() {
      const r = await pickup.emergencyRoster();
      const bySection = {};
      for (const s of r.students) bySection[s.section ?? '—'] = (bySection[s.section ?? '—'] ?? 0) + 1;
      const onSite = r.visitors.map((v) => ({ name: v.name, kind: v.kind, host: v.host, location: v.location }));
      return ok({ asOf: r.asOf, studentsOnCampus: r.students.length, bySection, releasedToday: r.releasedToday, onOutPass: r.onOutPass, visitors: onSite, note: r.note }, {
        speak: `${r.students.length} student(s) should be on campus, ${r.releasedToday} released today, ${r.onOutPass} on out-pass, and ${plural(onSite.length, 'visitor')} checked in. Account for everyone in person; print the named roster from the Gate screen.`,
      });
    },
  }),

  list_my_child_delegates: behind('visitors', {
    module: 'Safety', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: "For a parent: the adults authorised to collect their own child (standing and time-limited delegates) and the child's recent gate releases. Read-only.",
    inputSchema: closed({}),
    permission: 'transport.tracking.read',
    service: 'pickup.service.guardianList()',
    async run(ctx) {
      await guardianOnly(ctx);
      const g = await pickup.guardianList(ctx.actor);
      const child = new Map(g.children.map((c) => [c.id, c.name]));
      const adults = g.adults.map((a) => ({ name: a.name, relationship: a.relationship, kind: a.kind, child: child.get(String(a.studentId)) ?? null, validFrom: day(a.validFrom), validTo: day(a.validTo), status: a.status, validNow: Boolean(a.validNow) }));
      const view = summarise(adults, (a) => `${a.name} (${a.relationship ?? words(a.kind)}${a.validTo ? ` until ${a.validTo}` : ''}${a.status === 'PENDING_OTP' ? ', waiting for your code' : ''})`);
      return ok({ adults, recentReleases: g.recentReleases.map((r) => ({ child: r.studentName, at: `${day(r.at)} ${time(r.at)}`, to: r.receivedByName, kind: r.receivedByKind })) }, { speak: adults.length ? `Authorised to collect: ${view.list}.` : 'Only you and the other guardians on record can collect your child.' });
    },
  }),

  request_pickup_delegation: behind('visitors', {
    module: 'Safety', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true,
    description: "For a parent: let another adult collect their own child for a while (e.g. \"let my brother Sunil collect Aarav on Friday\"). A one-time code is sent to the parent's phone; the delegation starts once the parent gives that code back. Needs confirmation.",
    inputSchema: closed({ childName: text(80), delegateName: text(120), relationship: text(60), phone: text(20), fromDate: dateStr('YYYY-MM-DD'), toDate: dateStr('YYYY-MM-DD') }, ['delegateName', 'relationship', 'toDate']),
    permission: 'transport.tracking.read',
    service: 'pickup.service.guardianRequest()',
    async prepare(ctx, args) {
      await guardianOnly(ctx);
      const c = await myChild(ctx, args.childName);
      return { studentId: c.id, child: c.name };
    },
    summarise: (args, _a, p) => `Allow ${args.delegateName} (${args.relationship}) to collect ${p?.child ?? 'your child'} from ${args.fromDate ?? 'now'} to ${args.toDate}. A code is sent to your phone to confirm it.`,
    async run(ctx, args, p) {
      const a = await pickup.guardianRequest(ctx.actor, { studentId: p.studentId, name: args.delegateName, relationship: args.relationship, phone: args.phone, ...(args.fromDate && { validFrom: istAt(args.fromDate).toISOString() }), validTo: istAt(args.toDate, '23:59').toISOString() });
      return action({ type: 'pickup_delegation_requested', id: a.id, status: 'pending', data: { delegate: a.name, child: p.child, status: a.status, codeSent: Boolean(a.codeSent) }, speak: `${a.codeSent ? 'A code has been sent to your phone.' : 'The code could not be sent by SMS; confirm it on the Pickup screen.'} Tell me the code to confirm ${a.name}.` });
    },
  }),

  confirm_pickup_delegation: behind('visitors', {
    module: 'Safety', operation: 'UPDATE', risk: RISK.MEDIUM, confirm: true,
    description: "For a parent: confirm a pending pickup delegation with the one-time code sent to their phone. Needs confirmation.",
    inputSchema: closed({ delegateName: text(120), code: { type: 'string', pattern: '^\\d{4,8}$' } }, ['code']),
    permission: 'transport.tracking.read',
    service: 'pickup.service.guardianConfirm()',
    async prepare(ctx, args) {
      await guardianOnly(ctx);
      const pending = (await pickup.guardianList(ctx.actor)).adults.filter((a) => a.status === 'PENDING_OTP');
      const a = byRefOrName(pending, { name: args.delegateName }, { label: 'delegation waiting for a code', refOf: (x) => x.id, nameOf: (x) => x.name });
      return { id: a.id, name: a.name };
    },
    summarise: (_args, _a, p) => `Confirm ${p?.name ?? 'the delegate'} with the code you were sent`,
    async run(ctx, args, p) {
      const a = await pickup.guardianConfirm(ctx.actor, p.id, { code: args.code });
      return action({ type: 'pickup_delegation_confirmed', id: a.id, data: { delegate: a.name, status: a.status, validTo: day(a.validTo) }, speak: `${a.name} may collect your child until ${day(a.validTo)}.` });
    },
  }),

  revoke_pickup_delegation: behind('visitors', {
    module: 'Safety', operation: 'ACTION', risk: RISK.LOW, confirm: true,
    description: "For a parent: end a pickup delegation or authorisation they gave for their own child. Needs confirmation.",
    inputSchema: closed({ delegateName: text(120), note: text(300) }, ['delegateName']),
    permission: 'transport.tracking.read',
    service: 'pickup.service.revoke()',
    async prepare(ctx, args) {
      await guardianOnly(ctx);
      const rows = (await pickup.guardianList(ctx.actor)).adults;
      const a = theNamed(rows, args.delegateName, { label: 'authorised adult', nameOf: (x) => x.name });
      return { id: a.id, name: a.name };
    },
    summarise: (_args, _a, p) => `Stop ${p?.name ?? 'this person'} from collecting your child`,
    async run(ctx, args, p) {
      const a = await pickup.revoke(ctx.actor, p.id, { note: args.note }, { asGuardian: true });
      return action({ type: 'pickup_delegation_revoked', id: a.id, data: { delegate: a.name, status: a.status }, speak: `${a.name} can no longer collect your child.` });
    },
  }),

  get_my_child_checkpoints: behind('idCheckpoints', {
    module: 'Safety', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: "ID-card checkpoints on a day (default today). A parent sees their own child's gate and bus scans; school-wide staff see counts by checkpoint and how many were flagged. A scan shows a card was presented there and then, not where someone is now. Read-only.",
    inputSchema: closed({ date: dateStr('YYYY-MM-DD') }),
    permission: 'checkpoints.read',
    service: 'checkpoints.service.myChildren() / events()',
    async run(ctx, args) {
      const date = args.date ?? todayIst();
      if (ctx.scope === 'ALL') {
        const e = await checkpoints.events({ date });
        const byPoint = {};
        for (const x of e.events) byPoint[x.pointLabel ?? x.point] = (byPoint[x.pointLabel ?? x.point] ?? 0) + 1;
        const flagged = e.events.filter((x) => (x.flags ?? []).length || x.result !== 'ACCEPTED').length;
        return ok({ date, scans: e.events.length, byPoint, flagged, disclaimer: e.disclaimer }, { speak: `${e.events.length} scan(s) on ${date}, ${flagged} flagged. ${e.disclaimer}` });
      }
      const m = await checkpoints.myChildren(ctx.actor, { date });
      const children = m.children.map((c) => ({ child: c.name, scans: c.events.map((x) => ({ point: x.pointLabel, at: time(x.at), location: x.location })) }));
      const said = children.map((c) => `${c.child}: ${c.scans.length ? c.scans.map((s) => `${s.point} ${s.at}`).join(', ') : 'no scans'}`).join('; ');
      return ok({ date, children, disclaimer: m.disclaimer }, { speak: children.length ? `${said}. ${m.disclaimer}` : 'There is no student linked to your account.' });
    },
  }),

  block_id_card: behind('idCheckpoints', {
    module: 'Safety', operation: 'ACTION', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: "Block a student's or staff member's ID card as LOST or REVOKED, so scans of it are refused from now on. A replacement is issued on the Gate screen. Confirmed on the website.",
    inputSchema: closed({ holderName: text(120), status: { type: 'string', enum: ['LOST', 'REVOKED'] }, reason: text(300) }, ['holderName', 'status']),
    permission: 'checkpoints.manage',
    service: 'checkpoints.service.blockCard()',
    async prepare(_ctx, args) {
      const rows = await checkpoints.listCards({ q: stripTitle(args.holderName), status: 'ACTIVE' });
      const c = theNamed(rows, stripTitle(args.holderName), { label: 'active ID card', nameOf: (x) => x.holderName, describe: (x) => `${x.holderName} (${x.code})` });
      return { id: c.id, holder: c.holderName, code: c.code };
    },
    summarise: (args, _a, p) => `Block ${p?.holder ?? args.holderName}'s card ${p?.code ?? ''} as ${args.status.toLowerCase()}${args.reason ? ` — ${args.reason}` : ''}`,
    async run(ctx, args, p) {
      const c = await checkpoints.blockCard(ctx.actor, p.id, { status: args.status, reason: args.reason });
      return action({ type: 'id_card_blocked', id: c.id, data: { holder: c.holderName, status: c.status }, speak: `${c.holderName}'s card is now ${c.status.toLowerCase()}; scans of it will be refused.` });
    },
  }),

  get_camera_review_count: {
    module: 'Safety', operation: 'GET', risk: RISK.LOW, resultShape: 'SUMMARY',
    description: 'For trained camera reviewers only: how many camera observations are waiting for review. A count and nothing else; the observations themselves are reviewed on the Camera review screen. Read-only.',
    inputSchema: closed({}),
    permission: 'camera.events.review',
    service: 'CameraObservation count (status UNVERIFIED or NEEDS_FOLLOW_UP)',
    async run() {
      if (!(await featureEnabled('camera'))) return ok({ enabled: false, awaitingReview: null }, { speak: 'Camera event review is switched off for this school.' });
      const n = await CameraObservation.countDocuments({ status: { $in: ['UNVERIFIED', 'NEEDS_FOLLOW_UP'] } });
      return ok({ enabled: true, awaitingReview: n }, { speak: n ? `${n} camera observation(s) are waiting for review on the Camera review screen.` : 'No camera observations are waiting for review.' });
    },
  },
};

/* ── Hostel out-pass ───────────────────────────────────── */

const presentPass = (p) => ({ ref: p.refNo, student: p.studentName, leaves: `${day(p.fromAt)} ${time(p.fromAt)}`, returns: `${day(p.toAt)} ${time(p.toAt)}`, destination: p.destination, status: p.status, overdue: Boolean(p.overdue), late: Boolean(p.late) });
const OUTPASS_WAITING = { PENDING_PARENT: 'waiting for the guardian', PENDING_WARDEN: 'waiting for the warden' };

async function thePass(ctx, args, statuses, scope) {
  const rows = (await outpass.list(ctx.actor, scope, {})).filter((p) => statuses.includes(p.status));
  return byRefOrName(rows, { ref: args.ref, name: args.studentName }, { label: 'out-pass', refOf: (p) => p.refNo, nameOf: (p) => p.studentName, describe: (p) => `${p.refNo} ${p.studentName} ${day(p.fromAt)}` });
}

const outpassTools = {
  list_my_outpasses: behind('hostelOutpass', {
    module: 'Hostel', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: "The caller's own (a student's) or own children's (a parent's) hostel out-passes and where each stands. Read-only.",
    inputSchema: closed({}),
    permission: 'hostel.outpass.request',
    service: 'outpass.service.list()',
    async run(ctx) {
      const rows = (await outpass.list(ctx.actor, 'OWN', {})).map(presentPass);
      const view = summarise(rows.slice(0, 10), (p) => `${p.ref} ${p.student} ${p.leaves} → ${p.returns} (${OUTPASS_WAITING[p.status] ?? words(p.status)})`);
      return ok({ outpasses: rows, count: rows.length }, { speak: rows.length ? `${plural(rows.length, 'out-pass', 'out-passes')}: ${view.list}.` : 'No out-passes yet.' });
    },
  }),

  list_outpasses: behind('hostelOutpass', {
    module: 'Hostel', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'Hostel out-passes for the warden: waiting for a decision (default), approved, out now, overdue back, or all. Read-only.',
    inputSchema: closed({ view: { type: 'string', enum: ['pending', 'approved', 'out', 'overdue', 'all'] } }),
    permission: 'hostel.outpass.manage',
    service: 'outpass.service.list()',
    async run(ctx, args) {
      const view = args.view ?? 'pending';
      const status = { pending: 'PENDING_WARDEN', approved: 'APPROVED', out: 'OUT', overdue: 'OUT', all: 'ALL' }[view];
      let rows = (await outpass.list(ctx.actor, 'ALL', { status })).map((p) => ({ ...presentPass(p), reason: p.reason }));
      if (view === 'overdue') rows = rows.filter((p) => p.overdue);
      const list = summarise(rows, (p) => `${p.ref} ${p.student} ${p.leaves} → ${p.returns}${p.overdue ? ' (overdue)' : ''}`);
      return ok({ outpasses: rows, count: rows.length }, { speak: rows.length ? `${plural(rows.length, 'out-pass', 'out-passes')} (${view}): ${list.list}.` : `No out-passes ${view === 'all' ? 'yet' : `in "${view}"`}.` });
    },
  }),

  request_outpass: behind('hostelOutpass', {
    module: 'Hostel', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: "Request a hostel out-pass (e.g. \"request an out-pass for my son on Saturday 10 am to Sunday 6 pm to go home\"). A parent's request goes straight to the warden; a student's first goes to their guardian. Needs confirmation.",
    inputSchema: closed({
      childName: text(80, "A parent's child; a student requests for themselves"),
      fromDate: dateStr('YYYY-MM-DD'), fromTime: hm('HH:MM, leaving'), toDate: dateStr('YYYY-MM-DD'), toTime: hm('HH:MM, back'),
      reason: text(1000), destination: text(300), escortName: text(120), escortRelationship: text(60), escortPhone: text(20),
    }, ['fromDate', 'fromTime', 'toDate', 'toTime', 'reason', 'destination']),
    permission: 'hostel.outpass.request',
    service: 'outpass.service.request()',
    async prepare(ctx, args) {
      const c = await myChild(ctx, args.childName);
      return { studentId: c.id, student: c.name };
    },
    summarise: (args, _a, p) => `Request an out-pass for ${p?.student ?? 'you'} from ${args.fromDate} ${args.fromTime} to ${args.toDate} ${args.toTime}, to ${args.destination} — ${args.reason}${args.escortName ? `, escorted by ${args.escortName}` : ''}`,
    async run(ctx, args, p) {
      const pass = await outpass.request(ctx.actor, 'OWN', {
        studentId: p.studentId, fromAt: istAt(args.fromDate, args.fromTime).toISOString(), toAt: istAt(args.toDate, args.toTime).toISOString(), reason: args.reason, destination: args.destination,
        escort: { name: args.escortName, relationship: args.escortRelationship, phone: args.escortPhone },
      });
      return action({ type: 'outpass_requested', id: pass.id, data: presentPass(pass), speak: `Out-pass ${pass.refNo} requested; it is ${OUTPASS_WAITING[pass.status] ?? words(pass.status)}.` });
    },
  }),

  cancel_outpass: behind('hostelOutpass', {
    module: 'Hostel', operation: 'ACTION', risk: RISK.LOW, confirm: true,
    description: 'Cancel an own (or own child\'s) out-pass that has not been used yet. Needs confirmation.',
    inputSchema: closed({ ref: text(40), studentName: text(80), note: text(300) }),
    permission: 'hostel.outpass.request',
    service: 'outpass.service.cancel()',
    async prepare(ctx, args) {
      const p = await thePass(ctx, args, ['PENDING_PARENT', 'PENDING_WARDEN', 'APPROVED'], 'OWN');
      return { id: p.id, refNo: p.refNo, student: p.studentName };
    },
    summarise: (_args, _a, p) => `Cancel out-pass ${p?.refNo ?? ''} for ${p?.student ?? ''}`,
    async run(ctx, args, p) {
      const pass = await outpass.cancel(ctx.actor, 'OWN', p.id, { note: args.note });
      return action({ type: 'outpass_cancelled', id: pass.id, data: presentPass(pass), speak: `${pass.refNo} is cancelled.` });
    },
  }),

  record_outpass_consent: behind('hostelOutpass', {
    module: 'Hostel', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true,
    description: "For a parent: record their own consent (APPROVED) or refusal (REJECTED) for an out-pass their child asked for. Only when the parent says so themselves. Confirmed on the website.",
    inputSchema: closed({ ref: text(40), studentName: text(80), decision: { type: 'string', enum: ['APPROVED', 'REJECTED'], description: "The parent's own decision" }, note: text(500) }, ['decision']),
    permission: 'hostel.outpass.request',
    service: 'outpass.service.parentDecision()',
    async prepare(ctx, args) {
      if (ctx.actor?.roleKey !== 'PARENT') throw new AppError('Only a guardian can confirm an out-pass request.', 403);
      const p = await thePass(ctx, args, ['PENDING_PARENT'], 'OWN');
      return { id: p.id, refNo: p.refNo, student: p.studentName, leaves: `${day(p.fromAt)} ${time(p.fromAt)}`, returns: `${day(p.toAt)} ${time(p.toAt)}`, destination: p.destination };
    },
    summarise: (args, _a, p) => `${args.decision === 'APPROVED' ? 'Consent to' : 'Refuse'} ${p?.student ?? ''}'s out-pass ${p?.refNo ?? ''} (${p?.leaves} → ${p?.returns}, to ${p?.destination})${args.decision === 'APPROVED' ? '; it then goes to the warden' : ''}`,
    async run(ctx, args, p) {
      const pass = await outpass.parentDecision(ctx.actor, p.id, { decision: args.decision, note: args.note });
      return action({ type: 'outpass_consent_recorded', id: pass.id, data: presentPass(pass), speak: `Recorded. ${pass.refNo} is ${OUTPASS_WAITING[pass.status] ?? words(pass.status)}.` });
    },
  }),

  record_outpass_decision: behind('hostelOutpass', {
    module: 'Hostel', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true,
    description: "For the warden: record their own decision on an out-pass waiting for them — APPROVED, or REJECTED with the reason. Only when the warden says so in their own words; never suggested. The guardians are told. Confirmed on the website.",
    inputSchema: closed({ ref: text(40), studentName: text(80), decision: { type: 'string', enum: ['APPROVED', 'REJECTED'], description: "The warden's own decision" }, note: text(500, 'Required to reject') }, ['decision']),
    permission: 'hostel.outpass.manage',
    service: 'outpass.service.wardenDecision()',
    async prepare(ctx, args) {
      if (args.decision === 'REJECTED' && !args.note) throw new AppError('Why is it not approved?', 400, [], 'AGENT_NEEDS_INPUT');
      const p = await thePass(ctx, args, ['PENDING_WARDEN'], 'ALL');
      return { id: p.id, refNo: p.refNo, student: p.studentName, leaves: `${day(p.fromAt)} ${time(p.fromAt)}`, returns: `${day(p.toAt)} ${time(p.toAt)}`, destination: p.destination };
    },
    summarise: (args, _a, p) => `${args.decision === 'APPROVED' ? 'Approve' : 'Reject'} out-pass ${p?.refNo ?? ''} for ${p?.student ?? ''} (${p?.leaves} → ${p?.returns}, to ${p?.destination})${args.note ? ` — ${args.note}` : ''}`,
    async run(ctx, args, p) {
      const pass = await outpass.wardenDecision(ctx.actor, p.id, { decision: args.decision, note: args.note });
      return action({ type: 'outpass_decided', id: pass.id, data: presentPass(pass), speak: `${pass.refNo} is ${words(pass.status)}; the guardians are told.` });
    },
  }),

  record_outpass_gate: behind('hostelOutpass', {
    module: 'Hostel', operation: 'ACTION', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: "Record a resident leaving (EXIT, on an approved out-pass) or coming back (RETURN) at the gate by hand; a late return alerts the wardens. Confirmed on the website.",
    inputSchema: closed({ ref: text(40), studentName: text(80), event: { type: 'string', enum: ['EXIT', 'RETURN'] }, note: text(300) }, ['event']),
    permission: 'hostel.outpass.manage',
    service: 'outpass.service.recordManual()',
    async prepare(ctx, args) {
      const p = await thePass(ctx, args, args.event === 'EXIT' ? ['APPROVED'] : ['OUT'], 'ALL');
      return { id: p.id, refNo: p.refNo, student: p.studentName };
    },
    summarise: (args, _a, p) => `Record ${p?.student ?? ''} ${args.event === 'EXIT' ? 'leaving' : 'back'} now on ${p?.refNo ?? ''}`,
    async run(ctx, args, p) {
      const pass = await outpass.recordManual(ctx.actor, p.id, { event: args.event, note: args.note });
      return action({ type: 'outpass_gate_recorded', id: pass.id, data: presentPass(pass), speak: `${pass.studentName} is ${words(pass.status)}${pass.late ? ' (late)' : ''}.` });
    },
  }),
};

/* ── Staff leave and substitute cover ──────────────────── */

const LEAVE_TYPES = ['CL', 'SL', 'EL', 'ML', 'PL', 'DL', 'LWP'];
const LEAVE_NAMES = { CL: 'casual leave', SL: 'sick leave', EL: 'earned leave', ML: 'maternity leave', PL: 'paternity leave', DL: 'duty leave', LWP: 'leave without pay' };
const manageScope = (ctx) => (ctx.actor?.permissions?.['staffleave.manage'] === 'ALL' ? 'ALL' : 'OWN');
const presentLeave = (l, { withReason = false } = {}) => ({ ref: l.refNo, name: l.name, type: LEAVE_NAMES[l.code] ?? l.code, from: l.fromDate, to: l.toDate, halfDay: l.halfDay, days: l.days, status: l.status, ...(withReason && { reason: l.reason }), decisionNote: l.decisionNote ?? null });

async function theClassLesson(ctx, { className }) {
  // Which class is meant is not private among staff, so it is resolved school-wide.
  return resolveSection({ ...ctx, scope: 'ALL' }, { className });
}

const staffTools = {
  get_staff_leave_balance: behind('staffCover', {
    module: 'Staff leave', operation: 'GET', risk: RISK.LOW, resultShape: 'DETAIL',
    description: "Leave balance for this leave year (April–March): entitled, carried forward, used, pending and available per leave type. The caller's own by default; HR and the principal may name a colleague. Read-only.",
    inputSchema: closed({ staffName: text(120, 'HR / principal only') }),
    permission: 'staffleave.apply',
    service: 'staffLeave.service.balanceFor()',
    async run(ctx, args) {
      let who = null;
      if (args.staffName) {
        if (manageScope(ctx) !== 'ALL') throw new AppError("You can see your own leave balance; a colleague's is for HR and the principal.", 403);
        who = await staffNamed(args.staffName);
      }
      const b = await staffLeave.balanceFor(ctx.actor, who ? 'ALL' : 'OWN', who ? { profileId: who.id } : {});
      const rows = b.balances.filter((x) => x.tracksBalance).map((x) => ({ type: x.name, entitled: x.entitled, carriedForward: x.carriedForward, used: x.used, pending: x.pending, available: x.available, set: x.set }));
      const view = summarise(rows.filter((r) => r.set), (r) => `${r.type} ${r.available}${r.pending ? ` (${r.pending} pending)` : ''}`);
      return ok({ staff: who?.name ?? 'you', leaveYear: b.leaveYear, balances: rows }, { speak: rows.some((r) => r.set) ? `${who ? `${who.name}'s` : 'Your'} leave for ${b.leaveYear}: ${view.list} day(s) available.` : `No leave balances are set up for ${b.leaveYear} yet; HR sets them up.` });
    },
  }),

  list_staff_leave: behind('staffCover', {
    module: 'Staff leave', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: "Staff leave applications: the caller's own, or — for HR and the principal — everyone's (pending by default for them), optionally on a date or for one colleague. Read-only.",
    inputSchema: closed({ status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] }, date: dateStr('YYYY-MM-DD, who is on leave that day'), staffName: text(120) }),
    permission: 'staffleave.apply',
    service: 'staffLeave.service.list()',
    async run(ctx, args) {
      const scope = manageScope(ctx);
      const who = args.staffName && scope === 'ALL' ? await staffNamed(args.staffName) : null;
      const status = args.status ?? (scope === 'ALL' && !args.date ? 'PENDING' : undefined);
      const rows = (await staffLeave.list(ctx.actor, scope, { ...(status && { status }), ...(args.date && { date: args.date }), ...(who && { profileId: who.id }) })).map((l) => presentLeave(l, { withReason: scope === 'ALL' || String(l.profileId) === String(ctx.actor.profileId) }));
      const view = summarise(rows, (l) => `${scope === 'ALL' ? `${l.name}: ` : ''}${l.type} ${l.from}${l.to !== l.from ? ` to ${l.to}` : ''} (${l.days} day(s), ${l.status.toLowerCase()})`);
      return ok({ applications: rows, count: rows.length }, { speak: rows.length ? `${plural(rows.length, 'application')}: ${view.list}.` : 'No staff leave matches that.' });
    },
  }),

  apply_staff_leave: behind('staffCover', {
    module: 'Staff leave', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: "Apply for the caller's own staff leave (e.g. \"apply for casual leave on Monday because of a family function\"): type, dates (or a half day), reason. The draft shows the working days it counts and the balance left. HR and the principal are told. Needs confirmation.",
    inputSchema: closed({
      type: { type: 'string', enum: LEAVE_TYPES, description: 'CL casual, SL sick, EL earned, ML maternity, PL paternity, DL duty, LWP without pay' },
      fromDate: dateStr('YYYY-MM-DD'), toDate: dateStr('YYYY-MM-DD; default the same day'),
      halfDay: { type: 'string', enum: ['FIRST_HALF', 'SECOND_HALF'] }, reason: text(1000),
    }, ['type', 'fromDate', 'reason']),
    permission: 'staffleave.apply',
    service: 'staffLeave.service.apply()',
    async prepare(ctx, args) {
      const from = new Date(`${args.fromDate}T00:00:00Z`);
      const to = new Date(`${args.toDate ?? args.fromDate}T00:00:00Z`);
      if (to < from) throw new AppError('The leave ends before it starts.', 400);
      const working = await staffLeave.workingDaysBetween(from, to);
      if (!working.length) throw new AppError('Those dates are all Sundays or school holidays.', 400);
      const days = args.halfDay ? 0.5 : working.length;
      const bal = (await staffLeave.balanceFor(ctx.actor, 'OWN', { leaveYear: staffLeave.leaveYearOf(from) })).balances.find((b) => b.code === args.type);
      return { days, availableAfter: bal?.tracksBalance && bal.set ? bal.availableAfterPending - days : null };
    },
    summarise: (args, _a, p) => `Apply for ${LEAVE_NAMES[args.type]}${args.halfDay ? ` (${words(args.halfDay)})` : ''} on ${args.fromDate}${args.toDate && args.toDate !== args.fromDate ? ` to ${args.toDate}` : ''}: ${p?.days ?? '?'} working day(s)${p?.availableAfter != null ? `, leaving ${p.availableAfter}` : ''} — ${args.reason}`,
    async run(ctx, args) {
      const l = await staffLeave.apply(ctx.actor, 'OWN', { code: args.type, fromDate: args.fromDate, toDate: args.toDate ?? args.fromDate, halfDay: args.halfDay, reason: args.reason });
      return action({ type: 'staff_leave_applied', id: l.id, data: presentLeave(l, { withReason: true }), speak: `Applied: ${LEAVE_NAMES[l.code]} ${l.fromDate}${l.toDate !== l.fromDate ? ` to ${l.toDate}` : ''} (${l.days} day(s)), ${l.refNo}, waiting for approval.` });
    },
  }),

  cancel_staff_leave: behind('staffCover', {
    module: 'Staff leave', operation: 'ACTION', risk: RISK.LOW, confirm: true,
    description: "Withdraw the caller's own pending leave, or cancel an approved leave that has not started (its balance is restored and cover for the days ahead is cancelled). Needs confirmation.",
    inputSchema: closed({ ref: text(40), fromDate: dateStr('YYYY-MM-DD'), reason: text(500) }, ['reason']),
    permission: 'staffleave.apply',
    service: 'staffLeave.service.cancel()',
    async prepare(ctx, args) {
      const rows = (await staffLeave.list(ctx.actor, 'OWN', {})).filter((l) => ['PENDING', 'APPROVED'].includes(l.status));
      const l = args.fromDate ? (rows.find((x) => x.fromDate === args.fromDate) ?? byRefOrName([], {}, { label: `leave starting ${args.fromDate}` }))
        : byRefOrName(rows, { ref: args.ref }, { label: 'leave of yours', refOf: (x) => x.refNo, nameOf: (x) => x.fromDate, describe: (x) => `${x.refNo} ${LEAVE_NAMES[x.code]} ${x.fromDate}` });
      return { id: l.id, refNo: l.refNo, type: LEAVE_NAMES[l.code], from: l.fromDate, status: l.status };
    },
    summarise: (args, _a, p) => `${p?.status === 'APPROVED' ? 'Cancel' : 'Withdraw'} ${p?.refNo ?? ''} ${p?.type ?? ''} from ${p?.from ?? ''} — ${args.reason}`,
    async run(ctx, args, p) {
      const l = await staffLeave.cancel(ctx.actor, 'OWN', p.id, { reason: args.reason });
      return action({ type: 'staff_leave_cancelled', id: l.id, data: presentLeave(l), speak: `${l.refNo} is cancelled${l.coversCancelled ? `; ${l.coversCancelled} cover arrangement(s) were cancelled too` : ''}.` });
    },
  }),

  record_staff_leave_decision: behind('staffCover', {
    module: 'Staff leave', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true,
    description: "For HR and the principal: record their own decision on a colleague's pending leave — APPROVE (the balance is deducted) or REJECT with the reason. Only when the approver says so in their own words; never suggested. Nobody decides their own leave. Confirmed on the website.",
    inputSchema: closed({ ref: text(40), staffName: text(120), decision: { type: 'string', enum: ['APPROVE', 'REJECT'], description: "The approver's own decision" }, note: text(1000, 'Required to reject') }, ['decision']),
    permission: 'staffleave.manage', minScope: 'ALL',
    service: 'staffLeave.service.decide()',
    async prepare(ctx, args) {
      if (args.decision === 'REJECT' && !args.note) throw new AppError('Give the reason for rejecting it.', 400, [], 'AGENT_NEEDS_INPUT');
      const rows = await staffLeave.list(ctx.actor, 'ALL', { status: 'PENDING' });
      const l = byRefOrName(rows, { ref: args.ref, name: args.staffName ? stripTitle(args.staffName) : null }, { label: 'pending leave application', refOf: (x) => x.refNo, nameOf: (x) => x.name, describe: (x) => `${x.refNo} ${x.name} ${x.fromDate}` });
      if (l.profileId === String(ctx.actor.profileId)) throw new AppError('You cannot decide your own leave.', 403, [], 'SELF_APPROVAL');
      const bal = (await staffLeave.balanceFor(ctx.actor, 'ALL', { profileId: l.profileId, leaveYear: l.leaveYear })).balances.find((b) => b.code === l.code);
      return { id: l.id, refNo: l.refNo, name: l.name, type: LEAVE_NAMES[l.code], from: l.fromDate, to: l.toDate, days: l.days, available: bal?.tracksBalance ? bal.available : null };
    },
    summarise: (args, _a, p) => `${args.decision === 'APPROVE' ? 'Approve' : 'Reject'} ${p?.name ?? ''}'s ${p?.type ?? ''} ${p?.from ?? ''}${p?.to && p.to !== p.from ? ` to ${p.to}` : ''} (${p?.days ?? '?'} day(s)${p?.available != null ? `; ${p.available} available` : ''})${args.note ? ` — ${args.note}` : ''}`,
    async run(ctx, args, p) {
      const l = await staffLeave.decide(ctx.actor, 'ALL', p.id, { action: args.decision, note: args.note });
      return action({ type: 'staff_leave_decided', id: l.id, data: presentLeave(l), speak: `${l.name}'s leave ${l.refNo} is ${l.status.toLowerCase()}; they are told.` });
    },
  }),

  get_cover_arrangements: behind('staffCover', {
    module: 'Cover', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'Substitute cover on a day (default today): who is covering which class and period in place of whom (e.g. "who is covering 7B period 3"), or with mine=true the covers the caller is taking. Read-only.',
    inputSchema: closed({ date: dateStr('YYYY-MM-DD'), className: text(60), periodNo: { type: 'integer', minimum: 0, maximum: 15 }, mine: { type: 'boolean' } }),
    permission: 'staffleave.apply',
    service: 'cover.service.coverFor() / myCovers()',
    async run(ctx, args) {
      if (args.mine) {
        const rows = (await cover.myCovers(ctx.actor, { from: args.date ?? todayIst() })).map((c) => ({ date: c.date, class: c.className, period: c.periodNo, time: `${c.startTime}–${c.endTime}`, room: c.room, inPlaceOf: c.absentName }));
        const view = summarise(rows, (c) => `${c.date} ${c.class} period ${c.period} (${c.time}) for ${c.inPlaceOf}`);
        return ok({ covers: rows, count: rows.length }, { speak: rows.length ? `You are covering: ${view.list}.` : 'You have no cover to take.' });
      }
      const date = args.date ?? todayIst();
      let rows = await cover.coverFor(date);
      if (args.className) {
        const s = await theClassLesson(ctx, args);
        rows = rows.filter((c) => c.sectionId === s.sectionId);
      }
      if (args.periodNo !== undefined) rows = rows.filter((c) => c.periodNo === args.periodNo);
      const out = rows.map((c) => ({ class: c.className, period: c.periodNo, time: `${c.startTime}–${c.endTime}`, room: c.room, substitute: c.substituteName, inPlaceOf: c.absentName }));
      const view = summarise(out, (c) => `${c.class} period ${c.period}: ${c.substitute} (for ${c.inPlaceOf})`);
      return ok({ date, covers: out, count: out.length }, { speak: out.length ? `${view.list}.` : `No cover is arranged for that on ${date}.` });
    },
  }),

  get_cover_needs: behind('staffCover', {
    module: 'Cover', operation: 'GET', risk: RISK.LOW, resultShape: 'SUMMARY',
    description: "For the cover coordinator: who is away on a day (default today) — on approved leave or marked absent — and which of their periods still need cover. Absence reasons are not given. Read-only.",
    inputSchema: closed({ date: dateStr('YYYY-MM-DD') }),
    permission: 'cover.manage',
    service: 'cover.service.needs()',
    async run(ctx, args) {
      const n = await cover.needs(ctx.actor, ctx.scope, { date: args.date ?? todayIst() });
      const people = n.absent.map((a) => ({ teacher: a.name, away: a.source === 'LEAVE' ? 'on leave' : 'absent', half: a.half, uncovered: a.uncovered, periods: a.periods.map((p) => ({ class: p.className, period: p.periodNo, time: `${p.startTime}–${p.endTime}`, subject: p.subject, coveredBy: p.cover?.substituteName ?? null })) }));
      const gaps = people.flatMap((p) => p.periods.filter((x) => !x.coveredBy).map((x) => `${x.class} period ${x.period} (${p.teacher})`));
      return ok({ date: n.date, absent: people, totals: n.totals }, { speak: n.totals.absentTeachers ? `${n.totals.absentTeachers} teacher(s) away on ${n.date}; ${n.totals.uncovered} of ${n.totals.periods} period(s) need cover${gaps.length ? `: ${gaps.join('; ')}` : ''}.` : `Nobody with lessons is away on ${n.date}.` });
    },
  }),

  suggest_cover_teachers: behind('staffCover', {
    module: 'Cover', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: "For the cover coordinator: the best substitutes for one class and period on a day — free then, in school, within the cover limits; same subject and same class first — and who cannot and why. Read-only; nobody is assigned.",
    inputSchema: closed({ className: text(60), periodNo: { type: 'integer', minimum: 0, maximum: 15 }, date: dateStr('YYYY-MM-DD') }, ['className', 'periodNo']),
    permission: 'cover.manage',
    service: 'cover.service.candidates()',
    async run(ctx, args) {
      const s = await theClassLesson(ctx, args);
      const c = await cover.candidates(ctx.actor, ctx.scope, { date: args.date ?? todayIst(), sectionId: s.sectionId, periodNo: args.periodNo });
      const rows = c.candidates.map((x) => ({ teacher: x.name, eligible: x.eligible, sameSubject: x.sameSubject, sameClass: x.sameClass, lessonsToday: x.lessonsToday, coversToday: x.coversToday, coversThisWeek: x.coversThisWeek, overLimit: x.overLimit, cannotBecause: x.blocked }));
      const best = rows.filter((r) => r.eligible).slice(0, 5);
      const view = summarise(best, (r) => `${r.teacher}${r.sameSubject ? ' (same subject)' : r.sameClass ? ' (teaches the class)' : ''}`);
      return ok({ lesson: { class: c.lesson.className, period: c.lesson.periodNo, time: `${c.lesson.startTime}–${c.lesson.endTime}`, subject: c.lesson.subject }, candidates: rows }, { speak: best.length ? `Free for ${c.lesson.className} period ${c.lesson.periodNo}: ${view.list}.` : 'Nobody is free within the limits for that period.' });
    },
  }),

  assign_cover: behind('staffCover', {
    module: 'Cover', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: "For the cover coordinator: confirm a named teacher as the substitute for one class and period (e.g. \"assign Ms Rao to cover 8C period 2\"). Refused when they are busy then; going over the cover limit needs a reason. The absent teacher, the substitute and the class are told. Confirmed on the website.",
    inputSchema: closed({ className: text(60), periodNo: { type: 'integer', minimum: 0, maximum: 15 }, substituteName: text(120), date: dateStr('YYYY-MM-DD'), note: text(500), overrideReason: text(300, 'Only to go over the cover limit') }, ['className', 'periodNo', 'substituteName']),
    permission: 'cover.manage', minScope: 'ALL',
    service: 'cover.service.candidates() + assign()',
    async prepare(ctx, args) {
      const s = await theClassLesson(ctx, args);
      const date = args.date ?? todayIst();
      const c = await cover.candidates(ctx.actor, ctx.scope, { date, sectionId: s.sectionId, periodNo: args.periodNo });
      const who = theNamed(c.candidates, stripTitle(args.substituteName), { label: 'teacher', nameOf: (x) => x.name });
      if (who.blocked.length) throw new AppError(`${who.name} cannot cover it: ${who.blocked.join('; ')}.`, 409, [], 'SUBSTITUTE_BUSY');
      if (who.overLimit && !args.overrideReason) throw new AppError(`${who.name} has reached the cover limit (${who.coversToday} today, ${who.coversThisWeek} this week). Give a reason to go over it, or choose someone else.`, 400, [], 'AGENT_NEEDS_INPUT');
      return { date, sectionId: s.sectionId, className: c.lesson.className, periodNo: c.lesson.periodNo, time: `${c.lesson.startTime}–${c.lesson.endTime}`, substituteId: who.profileId, substitute: who.name };
    },
    summarise: (args, _a, p) => `Confirm ${p?.substitute ?? args.substituteName} to cover ${p?.className ?? args.className} period ${p?.periodNo ?? args.periodNo} (${p?.time ?? ''}) on ${p?.date ?? args.date}; the teachers and the class are told`,
    async run(ctx, args, p) {
      const c = await cover.assign(ctx.actor, ctx.scope, { date: p.date, sectionId: p.sectionId, periodNo: p.periodNo, substituteProfileId: p.substituteId, note: args.note, overrideReason: args.overrideReason });
      return action({ type: 'cover_assigned', id: c.id, data: { class: p.className, period: c.periodNo, date: c.date, substitute: p.substitute }, speak: `${p.substitute} is covering ${p.className} period ${c.periodNo} on ${c.date}.` });
    },
  }),

  cancel_cover: behind('staffCover', {
    module: 'Cover', operation: 'ACTION', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: 'For the cover coordinator: cancel a confirmed cover for a class and period, with the reason. Confirmed on the website.',
    inputSchema: closed({ className: text(60), periodNo: { type: 'integer', minimum: 0, maximum: 15 }, date: dateStr('YYYY-MM-DD'), reason: text(300) }, ['className', 'periodNo', 'reason']),
    permission: 'cover.manage', minScope: 'ALL',
    service: 'cover.service.cancelCover()',
    async prepare(ctx, args) {
      const s = await theClassLesson(ctx, args);
      const date = args.date ?? todayIst();
      const c = (await cover.coverFor(date)).find((x) => x.sectionId === s.sectionId && x.periodNo === args.periodNo);
      if (!c) throw new AppError(`No cover is confirmed for ${s.label} period ${args.periodNo} on ${date}.`, 404);
      const id = (await cover.myCovers({ profileId: c.substituteProfileId }, { from: date })).find((x) => x.sectionId === s.sectionId && x.periodNo === args.periodNo && x.date === date)?.id;
      if (!id) throw new AppError('That cover could not be found.', 404);
      return { id, className: c.className, periodNo: c.periodNo, substitute: c.substituteName, date };
    },
    summarise: (args, _a, p) => `Cancel ${p?.substitute ?? ''}'s cover of ${p?.className ?? args.className} period ${p?.periodNo ?? args.periodNo} on ${p?.date ?? ''} — ${args.reason}`,
    async run(ctx, args, p) {
      const c = await cover.cancelCover(ctx.actor, ctx.scope, p.id, { reason: args.reason });
      return action({ type: 'cover_cancelled', id: c.id, data: { class: p.className, period: p.periodNo, status: c.status }, speak: `Cancelled ${p.substitute}'s cover of ${p.className} period ${p.periodNo}.` });
    },
  }),

  mark_staff_absent: behind('staffCover', {
    module: 'Cover', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: "For the cover coordinator: mark a colleague absent for a day (an unplanned absence) so their lessons show as needing cover. Loss of pay is a payroll input and is set on the Cover screen, not here. Confirmed on the website.",
    inputSchema: closed({ staffName: text(120), date: dateStr('YYYY-MM-DD'), halfDay: { type: 'string', enum: ['FIRST_HALF', 'SECOND_HALF'] } }, ['staffName']),
    permission: 'cover.manage', minScope: 'ALL',
    service: 'cover.service.markAbsent()',
    async prepare(_ctx, args) {
      const who = await staffNamed(args.staffName);
      return { profileId: who.id, name: who.name, date: args.date ?? todayIst() };
    },
    summarise: (args, _a, p) => `Mark ${p?.name ?? args.staffName} absent on ${p?.date ?? args.date}${args.halfDay ? ` (${words(args.halfDay)})` : ''}, so their lessons need cover`,
    async run(ctx, args, p) {
      const a = await cover.markAbsent(ctx.actor, ctx.scope, { profileId: p.profileId, date: p.date, halfDay: args.halfDay });
      return action({ type: 'staff_marked_absent', id: a.id, data: { staff: a.name, date: a.date, halfDay: a.halfDay }, speak: `${a.name} is marked absent on ${a.date}. Ask "what cover is needed" to arrange it.` });
    },
  }),
};

/* ── Analytics workspace and quarterly reports ─────────── */

const metricValue = (m) => quarterly.valueText(m.current?.value ?? m.value ?? null, m.unit, m.currency);

const analyticsTools = {
  get_analytics_overview: behind('analytics', {
    module: 'Analytics', operation: 'GET', risk: RISK.LOW, resultShape: 'SUMMARY',
    description: "The analytics workspace in words: the headline figures (or one department's) for a period — this month, quarter, year, academic or financial year — with the change against the previous period or last year, and how complete each figure is. Within the caller's own departments or classes. The CSV is downloaded on the Analytics screen. Read-only.",
    inputSchema: closed({
      preset: { type: 'string', enum: ['today', 'week', 'month', 'quarter', 'year', 'academicYear', 'financialYear'] },
      department: { type: 'string', maxLength: 40, description: 'e.g. finance, academics, admissions, people, facilities, procurement; default all (headlines)' },
      compare: { type: 'string', enum: ['previous', 'lastYear', 'none'] },
    }),
    permission: 'analytics.workspace.read',
    service: 'analytics.service.overview()',
    async run(ctx, args) {
      const o = await analytics.overview(ctx.actor, ctx.scope, { preset: args.preset ?? 'month', department: args.department ?? 'all', compare: args.compare ?? 'previous' });
      const rows = o.metrics.map((m) => ({ metric: m.label, department: m.department, value: metricValue(m), changePct: m.change?.comparable ? m.change.pct : null, coverage: m.current?.coverage ?? null, note: m.current?.note ?? null }));
      const view = summarise(rows, (r) => `${r.metric} ${r.value}${r.changePct !== null ? ` (${r.changePct > 0 ? '+' : ''}${r.changePct}%)` : ''}`);
      return ok({ period: o.period?.label ?? null, comparison: o.comparison?.label ?? null, metrics: rows, scope: o.scope }, { speak: rows.length ? `${o.period?.label ?? 'This period'}: ${view.list}.` : 'No figures are available for that.' });
    },
  }),

  list_quarterly_reports: behind('analytics', {
    module: 'Analytics', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'The quarterly decision reports addressed to the caller: each quarter and version, its status and when it was generated. Read-only.',
    inputSchema: closed({}),
    permission: 'reports.quarterly.read',
    service: 'quarterly.service.list()',
    async run(ctx) {
      const page = await quarterly.list(ctx.actor, { pageSize: 50 });
      const rows = page.items.map((r) => ({ quarter: r.quarterKey, label: r.label, version: r.version, status: r.status, latest: Boolean(r.latest), generatedAt: day(r.generatedAt ?? r.createdAt) }));
      const view = summarise(rows.filter((r) => r.latest), (r) => `${r.label ?? r.quarter} (v${r.version}, ${words(r.status)})`);
      return ok({ reports: rows, count: rows.length }, { speak: rows.length ? `Quarterly reports: ${view.list}.` : 'No quarterly report has been generated yet.' });
    },
  }),

  get_quarterly_report: behind('analytics', {
    module: 'Analytics', operation: 'GET', risk: RISK.LOW, resultShape: 'DETAIL',
    description: "One quarterly report (the latest by default, or e.g. \"FY2026-27-Q2\"): the summary figures with their change on the prior quarter and last year, limited to the sections the caller receives. The PDF is downloaded on the Reports screen. Read-only.",
    inputSchema: closed({ quarter: { type: 'string', pattern: '^FY\\d{4}(-\\d{2})?-Q[1-4]$', description: 'e.g. FY2026-27-Q2' } }),
    permission: 'reports.quarterly.read',
    service: 'quarterly.service.get()',
    async run(ctx, args) {
      const page = await quarterly.list(ctx.actor, { pageSize: 100 });
      const pick = page.items.filter((r) => r.latest && r.status === 'GENERATED' && (!args.quarter || r.quarterKey === args.quarter))[0];
      if (!pick) throw new AppError(args.quarter ? `There is no generated report for ${args.quarter}.` : 'No quarterly report has been generated yet.', 404);
      const r = await quarterly.get(ctx.actor, pick.id);
      const f = r.figures ?? {};
      const line = (m) => ({ metric: m.label, value: quarterly.valueText(m.value, m.unit, m.currency), priorQuarter: quarterly.changeText(m.priorQuarter?.change), lastYear: quarterly.changeText(m.lastYear?.change) });
      const summary = (f.summary ?? []).map(line);
      const sections = (f.sections ?? []).map((s) => ({ section: s.label ?? s.key, metrics: (s.metrics ?? []).map(line) }));
      const view = summarise(summary.length ? summary : sections.flatMap((s) => s.metrics).slice(0, 8), (m) => `${m.metric} ${m.value}${m.priorQuarter ? ` (${m.priorQuarter} on the prior quarter)` : ''}`);
      return ok({ quarter: r.quarterKey, label: r.label, version: r.version, summary, sections }, { speak: `${r.label ?? r.quarterKey}: ${view.list}.` });
    },
  }),

  regenerate_quarterly_report: behind('analytics', {
    module: 'Analytics', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true,
    description: "Generate a new version of a quarterly report (the previous quarter by default) from the live records, with the reason. Earlier versions stay as they were. It is NOT sent: distribution to the recipients is done on the Reports screen. Needs confirmation.",
    inputSchema: closed({ quarter: { type: 'string', pattern: '^FY\\d{4}(-\\d{2})?-Q[1-4]$' }, reason: text(500) }),
    permission: 'reports.quarterly.manage', minScope: 'ALL',
    service: 'quarterly.service.regenerate(deliver: false)',
    summarise: (args) => `Generate a new version of the ${args.quarter ?? 'previous quarter\'s'} report${args.reason ? ` — ${args.reason}` : ''} (not sent to anyone)`,
    async run(ctx, args) {
      const r = await quarterly.regenerate(ctx.actor, { quarter: args.quarter, reason: args.reason, deliver: false });
      return action({ type: 'quarterly_report_generated', id: r.id, data: { quarter: r.quarterKey, version: r.version, status: r.status }, speak: `${r.label ?? r.quarterKey} version ${r.version} is ${words(r.status)}. Send it from the Reports screen.` });
    },
  }),
};

export const platformOpsTools = {
  ...taskTools,
  ...billTools,
  ...labTools,
  ...feeAdjustmentTools,
  ...fleetTools,
  ...safetyTools,
  ...outpassTools,
  ...staffTools,
  ...analyticsTools,
};

/** The approval tools in this file: each records a decision only its approver states and confirms. */
export const PLATFORM_APPROVER_TOOLS = Object.freeze(Object.entries(platformOpsTools).filter(([, t]) => t.approverDecision).map(([name]) => name));
