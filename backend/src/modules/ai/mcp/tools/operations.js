import * as insights from '../../../insights/insights.service.js';
import * as approvals from '../../../approvals/approval.service.js';
import * as compliance from '../../../compliance/compliance.service.js';
import * as correspondence from '../../../administration/correspondence.service.js';
import * as governance from '../../../governance/governance.service.js';
import * as events from '../../../administration/events.service.js';
import * as facilities from '../../../administration/facility.service.js';
import * as verification from '../../../administration/verification.service.js';
import * as procurement from '../../../finance-ops/procurement.service.js';
import * as payroll from '../../../finance-ops/payroll.service.js';
import * as marketing from '../../../marketing/marketing.service.js';
import * as org from '../../../institution/org.service.js';
import * as community from '../../../community/community.service.js';
import * as campus from '../../../campus/campus.service.js';
import * as lectures from '../../../lectures/lecture.service.js';
import * as syllabus from '../../../syllabus/syllabus.service.js';
import * as fees from '../../../fees/fee.service.js';
import * as feePlans from '../../../fees/plan.service.js';
import * as leave from '../../../leave/leave.service.js';
import * as registrations from '../../../registrations/registration.service.js';
import * as cocurricular from '../../../studentRequests/cocurricular.service.js';
import * as profileEdit from '../../../studentRequests/profileEdit.service.js';
import * as library from '../../../library/library.service.js';
import * as transport from '../../../transport/transport.service.js';
import { logger } from '../../../../utils/logger.js';
import { ok } from '../protocol.js';
import { HUMAN_DECISIONS, decisionLink } from '../decisions.js';
import { RISK, noArgs, rupees, shortDate, summarise, raisedBy } from './_shared.js';

/**
 * Institution operations: approvals, compliance, correspondence, governance,
 * events, maintenance, purchasing, budgets, payroll, admissions, organisation,
 * newsroom and the campus.
 *
 * Every tool here is a READ. That is the whole design, not a first step that
 * happened to stop early: the assistant may tell a person what is waiting,
 * what is due and where things stand, and it may never approve, file, pay,
 * clear or decide. Those acts stay on their own screens, behind the approval
 * engine and its maker-checker rules, where a named person presses the button.
 *
 * Three things are deliberately absent:
 *   - safeguarding cases: child-protection records are not summarised into a
 *     chat transcript for anyone;
 *   - individual pay and bank details: payroll is reported as run totals only;
 *   - background-check contents: verification is reported as counts only.
 *
 * Each tool returns a short, hand-picked shape rather than the record, calls
 * the same service the screen calls with the caller's own actor and scope, and
 * so shows each person exactly what their screen would.
 */

const rowsOf = (out) => (Array.isArray(out) ? out : out?.items ?? []);
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/**
 * Every queue a person may be the decider for, and how to read it.
 *
 * `permission` is the one that makes them the decider, read at their own scope
 * so each source returns exactly what their review screen would. `read` returns
 * { count, rows } -- rows only to name a few examples.
 */
const PENDING_SOURCES = [
  {
    kind: 'approval', label: 'approval request(s)', permission: 'approvals.decide',
    read: async (ctx) => {
      const rows = rowsOf(await approvals.inbox(ctx.actor));
      return { count: rows.length, rows: rows.map((r) => r.title) };
    },
  },
  {
    kind: 'payment', label: 'payment(s) awaiting approval', permission: 'fees.payments.approve', minScope: 'ALL',
    read: async (ctx, scope) => {
      const page = await fees.listPayments(ctx.actor, scope, { recordStatus: 'PENDING_ADMIN_APPROVAL', page: 1, pageSize: 3 });
      const rows = rowsOf(page);
      return { count: page?.total ?? rows.length, rows: rows.map((p) => `${p.studentName ?? p.receiptNo ?? 'payment'} ${rupees(p.amountPaise)}`) };
    },
  },
  {
    kind: 'payment', label: 'payment change request(s)', permission: 'fees.payments.approve', minScope: 'ALL',
    read: async () => {
      const rows = rowsOf(await fees.listPaymentChangeRequests({ status: 'PENDING' }));
      return { count: rows.length, rows: rows.map((r) => `${r.field} on receipt ${r.receiptNo}`) };
    },
  },
  {
    kind: 'feePlan', label: 'fee plan(s) awaiting finance review', permission: 'fees.plan.review', minScope: 'ALL',
    read: async (ctx, scope) => {
      const rows = rowsOf(await feePlans.listFeePlans(ctx.actor, scope, { status: 'PENDING_FINANCE_REVIEW' }));
      return { count: rows.length, rows: rows.map((p) => p.name) };
    },
  },
  {
    kind: 'feePlan', label: 'fee plan(s) awaiting approval', permission: 'fees.plan.approve', minScope: 'ALL',
    read: async (ctx, scope) => {
      const rows = rowsOf(await feePlans.listFeePlans(ctx.actor, scope, { status: 'PENDING_ADMIN_APPROVAL' }));
      return { count: rows.length, rows: rows.map((p) => p.name) };
    },
  },
  {
    kind: 'leave', label: 'leave application(s)', permission: 'leave.review',
    read: async (ctx, scope) => {
      const rows = rowsOf(await leave.listForReview(ctx.actor, scope, { status: 'PENDING' }));
      return { count: rows.length, rows: rows.map(raisedBy) };
    },
  },
  {
    kind: 'registration', label: 'elective registration(s)', permission: 'registrations.review',
    read: async (ctx, scope) => {
      const rows = rowsOf(await registrations.listForReview(ctx.actor, scope, { status: 'PENDING' }));
      return { count: rows.length, rows: rows.map((r) => `${raisedBy(r) ?? '—'} → ${r.subjectName ?? '—'}`) };
    },
  },
  {
    kind: 'studentRequest', label: 'co-curricular request(s)', permission: 'cocurricular.review',
    read: async (ctx, scope) => {
      const rows = rowsOf(await cocurricular.listForReview(ctx.actor, scope, { status: 'PENDING' }));
      return { count: rows.length, rows: rows.map(raisedBy) };
    },
  },
  {
    kind: 'studentRequest', label: 'profile correction request(s)', permission: 'profile.edit.review',
    read: async (ctx, scope) => {
      const rows = rowsOf(await profileEdit.listForReview(ctx.actor, scope, { status: 'PENDING' }));
      return { count: rows.length, rows: rows.map(raisedBy) };
    },
  },
  {
    kind: 'bookRequest', label: 'book request(s)', permission: 'library.manage', minScope: 'ALL',
    read: async (ctx, scope) => {
      const page = await library.listBookRequestsForReview(ctx.actor, scope, { status: 'PENDING', page: 1, pageSize: 3 });
      const rows = rowsOf(page);
      return { count: page?.total ?? rows.length, rows: rows.map(raisedBy) };
    },
  },
  {
    kind: 'transportRequest', label: 'transport request(s)', permission: 'transport.manage', minScope: 'ALL',
    read: async (ctx, scope) => {
      const page = await transport.listTransportRequestsForReview(ctx.actor, scope, { status: 'PENDING', page: 1, pageSize: 3 });
      const rows = rowsOf(page);
      return { count: page?.total ?? rows.length, rows: rows.map(raisedBy) };
    },
  },
];

export const operationsTools = {
  get_my_day: {
    module: 'Operations',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'What needs the caller today: their headline figures, tasks due, deadlines and decisions waiting on them. Read-only.',
    inputSchema: noArgs,
    permission: 'institution.read',
    service: 'insights.service.home()',
    async run(ctx) {
      const home = await insights.home(ctx.actor);
      const kpis = (home.kpis ?? []).map((k) => ({ label: k.label, value: k.status === 'OK' ? k.value : null, unit: k.unit ?? null, available: k.status === 'OK' }));
      const tasks = (home.tasks ?? []).map((t) => ({ title: t.title, kind: t.kind, dueOn: day(t.dueOn), overdue: Boolean(t.overdue) }));
      const decisions = (home.decisions ?? []).map((d) => ({ title: d.title, category: d.category ?? null, overdue: Boolean(d.isOverdue) }));
      const deadlines = (home.deadlines ?? []).map((d) => ({ title: d.title, kind: d.kind, date: day(d.renewBy ?? d.date), overdue: Boolean(d.overdue) }));
      const parts = [];
      if (decisions.length) parts.push(`${decisions.length} decision(s) waiting on you`);
      if (tasks.length) parts.push(`${tasks.length} task(s)`);
      if (deadlines.length) parts.push(`${deadlines.length} deadline(s) coming up`);
      return ok(
        { kpis, tasks, decisions, deadlines },
        { speak: parts.length ? `Today: ${parts.join(', ')}.` : 'Nothing is waiting on you right now.' },
      );
    },
  },

  list_pending_approvals: {
    module: 'Approvals',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Approval requests waiting on the caller to decide right now. Read-only: decisions are made on the Approvals page.',
    inputSchema: noArgs,
    permission: 'approvals.read',
    service: 'approval.service.inbox()',
    async run(ctx) {
      const rows = rowsOf(await approvals.inbox(ctx.actor)).map((r) => ({
        refNo: r.refNo ?? null, title: r.title, category: r.category, requestedBy: r.requesterName ?? null,
        amount: r.amountPaise ? rupees(r.amountPaise) : null, stage: r.currentStageName ?? null, overdue: Boolean(r.isOverdue), dueOn: day(r.dueAt),
      }));
      const view = summarise(rows, (r) => `${r.title}${r.amount ? ` (${r.amount})` : ''}`);
      return ok(
        { approvals: rows, count: rows.length, overdue: rows.filter((r) => r.overdue).length },
        { speak: rows.length ? `${rows.length} request(s) are waiting on you: ${view.list}. Open Approvals to decide.` : 'No approvals are waiting on you.' },
      );
    },
  },

  get_pending_items_for_me: {
    module: 'Approvals',
    operation: 'GET',
    risk: RISK.LOW,
    resultShape: 'LIST',
    description:
      'Everything waiting on the caller to decide: payments and payment changes awaiting approval, fee plans, leave applications, elective registrations, co-curricular and profile-correction requests, book and transport requests, and the approvals inbox. Only the queues the caller is the decider for, each with how many are waiting and the screen to open. Read-only: every decision is made by the caller on that screen, never by the assistant.',
    inputSchema: noArgs,
    permission: 'approvals.read',
    service: 'approval.service.inbox() + each review queue listForReview()',
    async run(ctx) {
      const perms = ctx.actor?.permissions ?? {};
      const mine = PENDING_SOURCES.filter((src) => perms[src.permission] && !(src.minScope === 'ALL' && perms[src.permission] !== 'ALL'));
      const read = await Promise.all(mine.map(async (src) => {
        try {
          return { src, ...(await src.read(ctx, perms[src.permission])) };
        } catch (err) {
          // A queue that cannot be read is reported as unavailable; it does
          // not take the others down with it.
          logger.warn(`get_pending_items_for_me: ${src.label} unavailable: ${err.message}`);
          return { src, count: null, rows: [] };
        }
      }));
      const items = read
        .filter((r) => r.count !== 0)
        .map(({ src, count, rows }) => ({
          kind: src.kind,
          what: src.label,
          count,
          examples: (rows ?? []).filter(Boolean).slice(0, 3),
          screen: HUMAN_DECISIONS[src.kind].screen,
          link: decisionLink(ctx.actor, src.kind),
        }));
      const waiting = items.filter((i) => i.count);
      const view = summarise(waiting, (i) => `${i.count} ${i.what} (${i.screen}${i.link ? `, ${i.link}` : ''})`);
      let speak = 'You are not the one who decides any queue in this school.';
      if (waiting.length) speak = `Waiting on you: ${view.list}. Open each screen to decide; I do not approve or reject anything.`;
      else if (mine.length) speak = 'Nothing is waiting on you to decide right now.';
      return ok({ items, total: waiting.reduce((sum, i) => sum + i.count, 0) }, { speak });
    },
  },

  list_compliance_deadlines: {
    module: 'Compliance',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Dated compliance items coming up or overdue: regulatory returns, licence and certificate renewals, policy reviews, mandatory trainings and agreement notice dates. Read-only.',
    inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 365, description: 'How many days ahead to look (default 60).' } }, additionalProperties: false },
    permission: 'compliance.read',
    service: 'compliance.service.calendar()',
    async run(_ctx, args) {
      const items = (await compliance.calendar({ days: args.days ?? 60 })).map((i) => ({ kind: i.kind, title: i.title, date: day(i.renewBy ?? i.date), status: i.status, overdue: Boolean(i.overdue) }));
      const overdue = items.filter((i) => i.overdue);
      const view = summarise(items.slice(0, 8), (i) => `${i.title} (${i.overdue ? 'overdue' : shortDate(i.date)})`);
      return ok(
        { items, count: items.length, overdue: overdue.length },
        { speak: items.length ? `${items.length} compliance item(s) in the next ${args.days ?? 60} days, ${overdue.length} overdue: ${view.list}.` : 'No compliance items fall due in that period.' },
      );
    },
  },

  list_licences: {
    module: 'Compliance',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Licences, certificates, recognitions and registrations with their expiry dates and renewal status. Read-only.',
    inputSchema: noArgs,
    permission: 'compliance.read',
    service: 'compliance.service.listLicences()',
    async run() {
      const rows = rowsOf(await compliance.listLicences({})).map((l) => ({ title: l.title, kind: l.kind, authority: l.authority ?? null, expiresOn: day(l.expiresOn), status: l.computedStatus ?? l.status ?? null }));
      const view = summarise(rows, (l) => `${l.title} (${l.expiresOn ? `expires ${shortDate(l.expiresOn)}` : 'no expiry'})`);
      return ok({ licences: rows, count: rows.length }, { speak: rows.length ? `${rows.length} licence(s) on record: ${view.list}.` : 'No licences or certificates are recorded yet.' });
    },
  },

  list_open_correspondence: {
    module: 'Correspondence',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Open letters and circulars from boards, government and other bodies, with their due dates and status. Read-only.',
    inputSchema: noArgs,
    permission: 'correspondence.read',
    service: 'correspondence.service.list()',
    async run(ctx) {
      const rows = rowsOf(await correspondence.list(ctx.actor, ctx.scope, { tab: 'open' })).map((c) => ({ refNo: c.refNo, subject: c.subject, from: c.counterpartyName, dueOn: day(c.dueOn), status: c.status, overdue: Boolean(c.isOverdue) }));
      const view = summarise(rows, (c) => `${c.refNo} ${c.subject}${c.overdue ? ' (overdue)' : ''}`);
      return ok({ letters: rows, count: rows.length, overdue: rows.filter((c) => c.overdue).length }, { speak: rows.length ? `${rows.length} open letter(s): ${view.list}.` : 'There is no open correspondence.' });
    },
  },

  list_board_meetings: {
    module: 'Governance',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Board, trustee and committee meetings with their dates and status. Read-only.',
    inputSchema: noArgs,
    permission: 'governance.read',
    service: 'governance.service.list()',
    async run(ctx) {
      const rows = rowsOf(await governance.list(ctx.actor, ctx.scope, {})).map((m) => ({ title: m.title, body: m.body ?? null, scheduledAt: m.scheduledAt ?? null, status: m.status }));
      const view = summarise(rows, (m) => `${m.title} (${shortDate(m.scheduledAt)}, ${String(m.status).toLowerCase()})`);
      return ok({ meetings: rows, count: rows.length }, { speak: rows.length ? `${rows.length} meeting(s): ${view.list}.` : 'No meetings are recorded.' });
    },
  },

  list_fest_plans: {
    module: 'Events',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Events, fests, meetings and visits being planned or held, with dates, status and how ready each one is. Read-only.',
    inputSchema: noArgs,
    permission: 'events.read',
    service: 'events.service.listEvents()',
    async run(ctx) {
      const rows = rowsOf(await events.listEvents(ctx.actor, {})).map((e) => ({ title: e.title, kind: e.kind, startsAt: e.startsAt, status: e.status, readinessPct: e.readiness ?? null }));
      const view = summarise(rows, (e) => `${e.title} (${shortDate(e.startsAt)}, ${String(e.status).toLowerCase().replace(/_/g, ' ')})`);
      return ok({ events: rows, count: rows.length }, { speak: rows.length ? `${rows.length} event(s): ${view.list}.` : 'No events are planned.' });
    },
  },

  list_maintenance_work: {
    module: 'Facilities',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Maintenance work orders that are open, with their place, priority and status. Read-only.',
    inputSchema: noArgs,
    permission: 'facilities.read',
    service: 'facility.service.listWorkOrders()',
    async run(ctx) {
      const open = new Set(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD']);
      const rows = rowsOf(await facilities.listWorkOrders(ctx.actor, {})).filter((w) => open.has(w.status)).map((w) => ({ refNo: w.refNo, title: w.title, place: w.facilityName ?? null, priority: w.priority, status: w.status, overdue: Boolean(w.overdue) }));
      const view = summarise(rows, (w) => `${w.title}${w.place ? ` at ${w.place}` : ''} (${String(w.priority).toLowerCase()})`);
      return ok({ workOrders: rows, count: rows.length, urgent: rows.filter((w) => w.priority === 'URGENT').length }, { speak: rows.length ? `${rows.length} open repair(s): ${view.list}.` : 'There are no open repairs.' });
    },
  },

  get_verification_counts: {
    module: 'Verification',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'How many background verifications are in progress, awaiting the principal, not cleared, expired or due for re-check. Counts only, no person or finding. Read-only.',
    inputSchema: noArgs,
    permission: 'verification.read',
    minScope: 'ALL',
    service: 'verification.service.stats()',
    async run() {
      const s = await verification.stats();
      return ok(s, { speak: `Background verification: ${s.inProgress} in progress, ${s.awaitingDecision} awaiting the principal's decision, ${s.notCleared} not cleared, ${s.expired} expired, ${s.recheckWithin30Days} due for re-check within 30 days.` });
    },
  },

  list_purchase_requests: {
    module: 'Procurement',
    operation: 'GET',
    risk: RISK.LOW,
    description: "Purchase requests with their amount and stage. The caller sees their own, or the whole school's if they manage purchasing. Read-only.",
    inputSchema: noArgs,
    permission: 'procurement.read',
    service: 'procurement.service.listRequests()',
    async run(ctx) {
      const rows = rowsOf(await procurement.listRequests(ctx.actor, ctx.scope, {})).map((p) => ({ refNo: p.refNo, title: p.title, department: p.department ?? null, amount: rupees(p.amountPaise ?? p.estimatedTotalPaise), status: p.status }));
      const view = summarise(rows, (p) => `${p.refNo} ${p.title} (${p.amount}, ${String(p.status).toLowerCase().replace(/_/g, ' ')})`);
      return ok({ requests: rows, count: rows.length }, { speak: rows.length ? `${rows.length} purchase request(s): ${view.list}.` : 'There are no purchase requests.' });
    },
  },

  get_budget_position: {
    module: 'Budgets',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Each budget with what was planned, what is committed to orders and what has been spent. Read-only.',
    inputSchema: noArgs,
    permission: 'budget.read',
    service: 'procurement.service.listBudgets()',
    async run() {
      const rows = rowsOf(await procurement.listBudgets()).map((b) => ({
        name: b.name, fiscalYear: b.fiscalYear, status: b.status,
        planned: rupees(b.totals?.planned), committed: rupees(b.totals?.committed), spent: rupees(b.totals?.actual),
        usedPct: b.totals?.planned ? Math.round(((b.totals.committed + b.totals.actual) / b.totals.planned) * 100) : null,
      }));
      const view = summarise(rows, (b) => `${b.name}: ${b.spent} spent and ${b.committed} committed of ${b.planned}`);
      return ok({ budgets: rows, count: rows.length }, { speak: rows.length ? view.list + '.' : 'No budgets are set up yet.' });
    },
  },

  list_payroll_runs: {
    module: 'Payroll',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Payroll runs by month with their status, headcount and totals. Totals only: nobody\'s individual pay or bank details. Read-only.',
    inputSchema: noArgs,
    permission: 'payroll.read',
    minScope: 'ALL',
    service: 'payroll.service.listRuns()',
    async run(ctx) {
      const rows = rowsOf(await payroll.listRuns(ctx.actor)).map((r) => ({ period: r.period, kind: r.kind, status: r.status, headcount: r.totals?.headcount ?? null, gross: rupees(r.totals?.grossPaise), net: rupees(r.totals?.netPaise) }));
      const view = summarise(rows.slice(0, 6), (r) => `${r.period}: ${String(r.status).toLowerCase().replace(/_/g, ' ')}, net ${r.net}`);
      return ok({ runs: rows, count: rows.length }, { speak: rows.length ? `${rows.length} payroll run(s). ${view.list}.` : 'No payroll runs yet.' });
    },
  },

  get_marketing_funnel: {
    module: 'Marketing',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'The admissions funnel in totals: enquiries by stage and by source, conversion and response time. No enquiry details. Read-only.',
    inputSchema: noArgs,
    permission: 'marketing.read',
    service: 'marketing.service.analytics()',
    async run() {
      const a = await marketing.analytics({});
      return ok(
        { enquiries: a.enquiries, lost: a.lost, conversionPct: a.conversionPct, funnel: a.funnel, bySource: a.bySource, medianFirstResponseHours: a.response?.medianHours ?? null, unresponded: a.response?.unresponded ?? null },
        { speak: a.enquiries ? `${a.enquiries} enquiry(ies) on record; ${a.conversionPct ?? 0}% enrolled; ${a.response?.unresponded ?? 0} without a first response.` : 'No admission enquiries are recorded yet.' },
      );
    },
  },

  get_organisation_structure: {
    module: 'Organisation',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'The organisation in numbers: departments, positions sanctioned and filled, vacancies and staff not yet placed. Read-only.',
    inputSchema: noArgs,
    permission: 'org.read',
    service: 'org.service.chart()',
    async run() {
      const c = await org.chart();
      const s = c.stats ?? {};
      return ok(
        { units: s.units ?? 0, positions: s.positions ?? 0, sanctioned: s.sanctioned ?? 0, filled: s.filled ?? 0, vacancies: s.vacancies ?? 0, unplaced: s.unplaced ?? 0, departments: (c.tree ?? []).map((u) => u.name) },
        { speak: s.positions ? `${s.units} unit(s), ${s.positions} position(s): ${s.filled} filled, ${s.vacancies} vacant; ${s.unplaced} staff not yet placed.` : 'The organisation structure has not been set up yet.' },
      );
    },
  },

  list_newsroom_posts: {
    module: 'Newsroom',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Recent newsroom stories, achievements and event posts the caller may see. Read-only.',
    inputSchema: noArgs,
    permission: 'community.read',
    service: 'community.service.feed()',
    async run(ctx) {
      const rows = rowsOf(await community.feed(ctx.actor, {})).slice(0, 15).map((p) => ({ title: p.title ?? String(p.body ?? '').slice(0, 80), kind: p.kind, author: p.authorName ?? null, publishedAt: p.publishedAt ?? null }));
      const view = summarise(rows, (p) => p.title);
      return ok({ posts: rows, count: rows.length }, { speak: rows.length ? `${rows.length} recent post(s): ${view.list}.` : 'The newsroom has no posts yet.' });
    },
  },

  list_digital_lectures: {
    module: 'Lectures',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Upcoming digital lectures and online meetings the caller hosts or is invited to, with their time and host. The join link is not included: a class is joined from its page. Read-only.',
    inputSchema: noArgs,
    permission: 'lectures.read',
    service: 'lecture.service.list()',
    async run(ctx) {
      const rows = (await lectures.list(ctx.actor, {})).map((c) => ({ title: c.title, kind: c.kind, when: c.when, host: c.hostName, status: c.status, subject: c.subjectName }));
      const view = summarise(rows.slice(0, 8), (c) => `${c.title} (${c.when})`);
      return ok({ classes: rows, count: rows.length }, { speak: rows.length ? `${rows.length} online class(es) coming up: ${view.list}. Join from the Digital Lectures page.` : 'No online classes are coming up.' });
    },
  },

  get_syllabus_progress: {
    module: 'Syllabus',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Syllabus progress by subject and class: the module being taught now, how much is covered, and whether it is on track, behind or has no recent update. A teacher sees their own subjects, a student or parent their class, the principal the whole school. Read-only.',
    inputSchema: noArgs,
    permission: 'syllabus.read',
    service: 'syllabus.service.overview()',
    async run(ctx) {
      const o = await syllabus.overview(ctx.actor, {});
      const rows = o.rows.map((r) => ({ subject: r.subject, class: r.class, teacher: r.teacher, health: r.health, coveragePct: r.coveragePct, currentModule: r.current?.title ?? null, nextTopic: r.current?.nextTopic ?? null }));
      const behind = rows.filter((r) => ['BEHIND', 'OVERDUE'].includes(r.health));
      const view = summarise(behind.slice(0, 6), (r) => `${r.class} ${r.subject}${r.teacher ? ` (${r.teacher})` : ''}`);
      return ok(
        { subjects: rows, totals: o.totals, definition: o.definition },
        { speak: rows.length ? `${o.totals.subjects} subject(s): ${o.totals.onTrack} on track, ${o.totals.behind} behind, ${o.totals.noPlan} with no plan yet.${behind.length ? ` Behind: ${view.list}.` : ''}` : 'No subjects to show.' },
      );
    },
  },

  get_campus_status: {
    module: 'Campus',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'The campus right now: rooms in use and free by the timetable and bookings, spaces out of use, and events today. Scheduled use, not live tracking. Read-only.',
    inputSchema: noArgs,
    permission: 'campus.map.read',
    service: 'campus.service.campusMap()',
    async run(ctx) {
      const m = await campus.campusMap(ctx.actor);
      const k = m.kpis ?? {};
      const buildings = (m.facilities ?? []).filter((f) => f.kind === 'BUILDING').map((f) => f.name);
      return ok(
        { rooms: k.rooms ?? 0, roomsInUse: k.roomsInUse ?? 0, roomsFree: k.roomsFree ?? 0, outOfUse: k.outOfUse ?? 0, eventsToday: (m.eventsToday ?? []).map((e) => ({ title: e.title, startsAt: e.startsAt })), buildings, sampleLayout: Boolean(m.sampleLayout) },
        { speak: `${k.roomsInUse ?? 0} room(s) in use and ${k.roomsFree ?? 0} free by the timetable, ${k.outOfUse ?? 0} out of use, ${(m.eventsToday ?? []).length} event(s) today. Open Campus World for the 3D view.` },
      );
    },
  },
};
