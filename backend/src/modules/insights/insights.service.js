import { plural } from '../../utils/plural.js';
import { Invoice } from '../../models/fee.model.js';
import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { Section } from '../../models/academics.model.js';
import { InstitutionEvent } from '../../models/administration.model.js';
import { PayrollRun } from '../../models/finance.model.js';
import { BoardMeeting } from '../../models/governance.model.js';
import { WorkOrder } from '../../models/facility.model.js';
import { inbox as approvalInbox } from '../approvals/approval.service.js';
import * as correspondence from '../administration/correspondence.service.js';
import * as facilities from '../administration/facility.service.js';
import * as verification from '../administration/verification.service.js';
import * as compliance from '../compliance/compliance.service.js';
import * as safeguarding from '../compliance/safeguarding.service.js';
import * as procurement from '../finance-ops/procurement.service.js';
import * as org from '../institution/org.service.js';
import * as institution from '../institution/institution.service.js';
import * as marketing from '../marketing/marketing.service.js';
import * as governance from '../governance/governance.service.js';
import { getTeacherSectionIds } from '../../utils/scope.js';
import { logger } from '../../utils/logger.js';
import { startOfDayUtc } from '../ops/common.js';

/**
 * Role home screens and the principal's briefing.
 *
 * Every KPI carries its definition, source, the time it was computed and a
 * link to the records behind it. A KPI that cannot be computed is reported as
 * UNAVAILABLE with the reason — never as zero — and one that does not apply to
 * this institution as NOT_APPLICABLE. Nothing here is random or simulated.
 */

const asOf = () => new Date().toISOString();
const kpi = (key, label, value, { unit = 'count', definition, source, link = null, tone = 'neutral', status = 'OK' } = {}) => ({ key, label, value, unit, definition, source, link, tone, status, asOf: asOf() });

/** Runs a KPI computation; a failure becomes UNAVAILABLE rather than breaking the screen. */
async function safe(key, label, fn, meta) {
  try {
    return await fn();
  } catch (err) {
    logger.warn(`Insight ${key} unavailable: ${err.message}`);
    return kpi(key, label, null, { ...meta, status: 'UNAVAILABLE', definition: `${meta?.definition ?? ''} (could not be computed: ${err.message})` });
  }
}

async function attendanceToday(sectionFilter = null) {
  const day = startOfDayUtc();
  const sections = await Section.find(sectionFilter ? { _id: { $in: sectionFilter } } : {}).select('_id').lean();
  const rows = await AttendanceRecord.aggregate([
    { $match: { date: day, periodNo: null } },
    { $lookup: { from: 'enrollments', localField: 'enrollmentId', foreignField: '_id', as: 'en' } },
    { $unwind: '$en' },
    ...(sectionFilter ? [{ $match: { 'en.sectionId': { $in: sections.map((s) => s._id) } } }] : []),
    { $group: { _id: '$en.sectionId', marked: { $sum: 1 }, present: { $sum: { $cond: [{ $in: ['$status', ['PRESENT', 'LATE']] }, 1, 0] } } } },
  ]);
  const marked = rows.reduce((n, r) => n + r.marked, 0);
  const present = rows.reduce((n, r) => n + r.present, 0);
  return { sections: sections.length, sectionsMarked: rows.length, marked, present, pct: marked ? Math.round((present / marked) * 1000) / 10 : null };
}

async function feePosition() {
  const now = new Date();
  const agg = await Invoice.aggregate([
    { $match: { status: { $ne: 'CANCELLED' } } },
    { $group: { _id: null, billed: { $sum: '$totalPaise' }, paid: { $sum: '$paidPaise' }, overdue: { $sum: { $cond: [{ $and: [{ $lt: ['$dueOn', now] }, { $lt: ['$paidPaise', '$totalPaise'] }] }, { $subtract: ['$totalPaise', '$paidPaise'] }, 0] } } } },
  ]);
  return agg[0] ?? { billed: 0, paid: 0, overdue: 0 };
}

async function myTasks(actor) {
  const [letters, wos, ev, mtg] = await Promise.all([
    correspondence.list(actor, 'OWN', { status: 'OPEN', pageSize: 10 }).catch(() => ({ items: [] })),
    WorkOrder.find({ assigneeProfileId: actor.profileId, status: { $in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] } }).select('refNo title dueAt priority').limit(10).lean(),
    InstitutionEvent.find({ 'tasks.ownerProfileId': actor.profileId, status: { $in: ['APPROVED', 'IN_PREPARATION'] } }).select('title tasks').lean(),
    BoardMeeting.find({ actions: { $elemMatch: { ownerProfileId: actor.profileId, status: 'OPEN' } } }).select('title actions').lean(),
  ]);
  return [
    ...letters.items.map((l) => ({ kind: 'LETTER', title: `${l.refNo} ${l.subject}`, dueOn: l.dueOn, overdue: l.isOverdue, link: `/correspondence?id=${l.id}` })),
    ...wos.map((w) => ({ kind: 'WORK_ORDER', title: `${w.refNo} ${w.title}`, dueOn: w.dueAt, overdue: w.dueAt < new Date(), link: `/facilities?tab=work&id=${w._id}` })),
    ...ev.flatMap((e) => e.tasks.filter((t) => String(t.ownerProfileId) === String(actor.profileId) && t.status !== 'DONE').map((t) => ({ kind: 'EVENT_TASK', title: `${e.title}: ${t.title}`, dueOn: t.dueOn, overdue: t.dueOn ? t.dueOn < new Date() : false, link: `/events?id=${e._id}` }))),
    ...mtg.flatMap((m) => m.actions.filter((a) => String(a.ownerProfileId) === String(actor.profileId) && a.status === 'OPEN').map((a) => ({ kind: 'BOARD_ACTION', title: `${m.title}: ${a.title}`, dueOn: a.dueOn, overdue: a.dueOn ? a.dueOn < new Date() : false, link: `/governance?id=${m._id}` }))),
  ].sort((a, b) => new Date(a.dueOn ?? 8.64e15) - new Date(b.dueOn ?? 8.64e15));
}

const money = (paise) => paise;

/** The principal's daily briefing: decisions, deadlines and exceptions, each linked to its records. */
async function principalHome(actor) {
  const [inbox, corr, comp, ver, att, fees, proc, chart, sg, govActions, wo, events7] = await Promise.all([
    approvalInbox(actor),
    correspondence.stats(actor, 'ALL'),
    compliance.overview(),
    verification.stats(),
    attendanceToday(),
    feePosition(),
    procurement.stats(),
    org.chart().catch(() => null),
    safeguarding.counts(),
    governance.openActions(actor, 'ALL'),
    facilities.stats(),
    InstitutionEvent.find({ status: { $in: ['PENDING_APPROVAL', 'APPROVED', 'IN_PREPARATION'] }, startsAt: { $gte: startOfDayUtc(), $lt: new Date(Date.now() + 7 * 86_400_000) } }).select('title startsAt status tasks').lean(),
  ]);
  const kpis = [
    kpi('approvals.waiting', 'Decisions waiting on you', inbox.length, { definition: 'Approval requests whose current stage you may decide.', source: 'Approvals', link: '/approvals', tone: inbox.some((r) => r.isOverdue) ? 'bad' : inbox.length ? 'warn' : 'good' }),
    kpi('attendance.today', 'Attendance today', att.pct, { unit: 'percent', definition: `Present or late ÷ students marked, whole-day registers only. ${att.sectionsMarked} of ${att.sections} sections marked so far.`, source: 'Attendance', link: '/principal/attendance', tone: att.pct === null ? 'neutral' : att.pct < 85 ? 'warn' : 'good', status: att.marked ? 'OK' : 'UNAVAILABLE' }),
    kpi('fees.overdue', 'Fees overdue', money(fees.overdue), { unit: 'paise', definition: 'Unpaid balance of invoices past their due date (excludes cancelled).', source: 'Fees', link: '/principal/fees', tone: fees.overdue ? 'warn' : 'good' }),
    kpi('correspondence.overdue', 'Letters past deadline', corr.overdue, { definition: 'Open correspondence whose due date has passed.', source: 'Correspondence', link: '/correspondence?overdue=true', tone: corr.overdue ? 'bad' : 'good' }),
    kpi('compliance.returnsOverdue', 'Returns overdue', comp.returnsOverdue, { definition: 'Regulatory returns not submitted by their due date.', source: 'Compliance', link: '/compliance?tab=returns', tone: comp.returnsOverdue ? 'bad' : 'good' }),
    kpi('compliance.licences', 'Licences expiring / expired', comp.licencesExpiring + comp.licencesExpired, { definition: `Expiring within their renewal lead time (${comp.licencesExpiring}) or already expired (${comp.licencesExpired}).`, source: 'Licences', link: '/compliance?tab=licences', tone: comp.licencesExpired ? 'bad' : comp.licencesExpiring ? 'warn' : 'good' }),
    kpi('verification.awaiting', 'Clearances awaiting you', ver.awaitingDecision, { definition: 'Background verifications reviewed by HR and awaiting the principal\'s decision.', source: 'Verification', link: '/verification?status=AWAITING_DECISION', tone: ver.awaitingDecision ? 'warn' : 'good' }),
    kpi('org.vacancies', 'Vacant positions', chart?.stats?.vacancies ?? null, { definition: 'Sanctioned positions without a current appointee.', source: 'Organisation structure', link: '/organization', status: chart?.stats?.positions ? 'OK' : 'NOT_APPLICABLE', tone: chart?.stats?.vacancies ? 'warn' : 'good' }),
    kpi('budget.overrun', 'Budget lines over plan', proc.linesOverBudget, { definition: 'Approved budget lines where committed + actual exceed planned.', source: 'Budgets', link: '/budgets', tone: proc.linesOverBudget ? 'warn' : 'good' }),
    kpi('facilities.urgent', 'Urgent maintenance', wo.urgentWorkOrders, { definition: `Open URGENT work orders (${wo.overdueWorkOrders} work orders past SLA).`, source: 'Facilities', link: '/facilities?tab=work', tone: wo.urgentWorkOrders ? 'bad' : 'good' }),
    // Counts only — case details stay with the designated officer.
    kpi('safeguarding.open', 'Open safeguarding cases', sg.open, { definition: `Open cases (${sg.urgent} urgent; ${sg.statutoryPending} child-protection cases without a recorded statutory report). Details are visible only to the designated officer.`, source: 'Safeguarding (counts only)', link: null, tone: sg.statutoryPending ? 'bad' : sg.urgent ? 'warn' : 'neutral' }),
  ];
  const deadlines = (await compliance.calendar({ days: 14 })).slice(0, 12);
  return {
    role: 'PRINCIPAL',
    greeting: `${inbox.length} decision${inbox.length === 1 ? '' : 's'} waiting${deadlines.filter((d) => d.overdue).length ? `, ${plural(deadlines.filter((d) => d.overdue).length, 'overdue item')}` : ''}.`,
    kpis,
    decisions: inbox.slice(0, 8),
    deadlines,
    exceptions: [
      ...(sg.statutoryPending ? [{ severity: 'HIGH', text: `${plural(sg.statutoryPending, 'child-protection case')} ${sg.statutoryPending === 1 ? 'has' : 'have'} no statutory report recorded.`, link: null }] : []),
      ...(comp.noticesToReview ? [{ severity: 'MEDIUM', text: `${plural(comp.noticesToReview, 'official notice')} awaiting applicability review.`, link: '/compliance?tab=notices' }] : []),
      ...(att.sections && att.sectionsMarked < att.sections ? [{ severity: 'LOW', text: `${plural(att.sections - att.sectionsMarked, 'section')} ${att.sections - att.sectionsMarked === 1 ? 'has' : 'have'} not marked whole-day attendance today.`, link: '/principal/attendance' }] : []),
      ...(chart?.stats?.unplaced ? [{ severity: 'LOW', text: `${plural(chart.stats.unplaced, 'staff member')} ${chart.stats.unplaced === 1 ? 'is' : 'are'} not placed in the organisation structure.`, link: '/organization' }] : []),
      ...govActions.filter((a) => a.overdue).slice(0, 3).map((a) => ({ severity: 'MEDIUM', text: `Board action overdue: ${a.title}`, link: `/governance?id=${a.meetingId}` })),
    ],
    upcomingEvents: events7.map((e) => ({ id: String(e._id), title: e.title, startsAt: e.startsAt, status: e.status, readiness: e.tasks?.length ? Math.round((e.tasks.filter((t) => t.status === 'DONE').length / e.tasks.length) * 100) : null })),
    tasks: await myTasks(actor),
  };
}

async function adminHome(actor) {
  const [corr, fac, comp, ver, inbox] = await Promise.all([correspondence.stats(actor, 'ALL'), facilities.stats(), compliance.overview(), verification.stats(), approvalInbox(actor)]);
  return {
    role: actor.roleKey,
    kpis: [
      kpi('correspondence.open', 'Open correspondence', corr.open, { definition: `Open items; ${corr.dueSoon} due within 7 days.`, source: 'Correspondence', link: '/correspondence' }),
      kpi('correspondence.overdue', 'Past deadline', corr.overdue, { definition: 'Open items past their due date.', source: 'Correspondence', link: '/correspondence?overdue=true', tone: corr.overdue ? 'bad' : 'good' }),
      kpi('correspondence.dispatch', 'Approved, to dispatch', corr.toDispatch, { definition: 'Approved replies/letters not yet dispatched.', source: 'Correspondence', link: '/correspondence?status=APPROVED', tone: corr.toDispatch ? 'warn' : 'good' }),
      kpi('facilities.open', 'Open work orders', fac.openWorkOrders, { definition: `${fac.overdueWorkOrders} past SLA, ${fac.urgentWorkOrders} urgent.`, source: 'Facilities', link: '/facilities?tab=work', tone: fac.overdueWorkOrders ? 'bad' : 'neutral' }),
      kpi('facilities.bookings', 'Booking requests', fac.pendingBookings, { definition: 'Room bookings awaiting confirmation.', source: 'Facilities', link: '/facilities?tab=bookings' }),
      kpi('compliance.review', 'Obligations to review', comp.obligationsUnderReview, { definition: 'Catalogue items whose applicability has not been decided.', source: 'Compliance', link: '/compliance?tab=obligations' }),
      kpi('verification.progress', 'Verifications in progress', ver.inProgress, { definition: `${ver.expired} expired; ${ver.recheckWithin30Days} due for re-check within 30 days.`, source: 'Verification', link: '/verification' }),
      kpi('approvals.waiting', 'Decisions waiting on you', inbox.length, { definition: 'Approval stages you may decide.', source: 'Approvals', link: '/approvals' }),
    ],
    deadlines: (await compliance.calendar({ days: 21 })).slice(0, 15),
    tasks: await myTasks(actor),
  };
}

async function financeHome(actor) {
  const [fees, proc, runs, inbox] = await Promise.all([feePosition(), procurement.stats(), PayrollRun.find({}).sort({ period: -1 }).limit(1).select('period status totals').lean(), approvalInbox(actor)]);
  const run = runs[0];
  return {
    role: actor.roleKey,
    kpis: [
      kpi('fees.collected', 'Fees collected', fees.paid, { unit: 'paise', definition: 'Paid amounts across non-cancelled invoices (all time).', source: 'Fees', link: '/finance/payments' }),
      kpi('fees.overdue', 'Fees overdue', fees.overdue, { unit: 'paise', definition: 'Unpaid balance past due date.', source: 'Fees', link: '/finance/payments', tone: fees.overdue ? 'warn' : 'good' }),
      kpi('payroll.latest', `Payroll ${run?.period ?? ''}`.trim(), run ? run.status : null, { unit: 'status', definition: 'Status of the most recent payroll run.', source: 'Payroll', link: '/payroll', status: run ? 'OK' : 'NOT_APPLICABLE' }),
      kpi('procurement.approval', 'Purchases in approval', proc.purchaseRequestsInApproval, { definition: 'Purchase requests awaiting a decision.', source: 'Procurement', link: '/procurement' }),
      kpi('procurement.receipt', 'Orders awaiting receipt', proc.ordersAwaitingReceipt, { definition: 'POs issued and not fully received.', source: 'Procurement', link: '/procurement' }),
      kpi('procurement.pay', 'Invoices to pay', proc.invoicesAwaitingPayment, { definition: 'Invoiced, approved or initiated, not yet confirmed paid.', source: 'Procurement', link: '/procurement' }),
      kpi('budget.utilisation', 'Budget used', proc.budgetPlannedPaise ? Math.round(((proc.budgetActualPaise + proc.budgetCommittedPaise) / proc.budgetPlannedPaise) * 100) : null, { unit: 'percent', definition: '(Actual + committed) ÷ planned, approved budgets.', source: 'Budgets', link: '/budgets', status: proc.budgetPlannedPaise ? 'OK' : 'NOT_APPLICABLE' }),
      kpi('approvals.waiting', 'Decisions waiting on you', inbox.length, { definition: 'Approval stages you may decide (e.g. budget checks).', source: 'Approvals', link: '/approvals' }),
    ],
    tasks: await myTasks(actor),
  };
}

async function hrHome(actor) {
  const [ver, chart, coverage] = await Promise.all([verification.stats(), org.chart().catch(() => null), compliance.trainingCoverage()]);
  return {
    role: actor.roleKey,
    kpis: [
      kpi('verification.progress', 'Verifications in progress', ver.inProgress, { definition: 'Cases being checked or in HR review.', source: 'Verification', link: '/verification' }),
      kpi('verification.expired', 'Clearances expired', ver.expired, { definition: 'Cleared cases whose time-limited check lapsed.', source: 'Verification', link: '/verification?status=EXPIRED', tone: ver.expired ? 'bad' : 'good' }),
      kpi('org.vacancies', 'Vacancies', chart?.stats?.vacancies ?? null, { definition: 'Sanctioned positions without an appointee.', source: 'Organisation', link: '/organization', status: chart?.stats?.positions ? 'OK' : 'NOT_APPLICABLE' }),
      kpi('org.unplaced', 'Staff not in structure', chart?.stats?.unplaced ?? null, { definition: 'Active staff with no position.', source: 'Organisation', link: '/organization' }),
      ...coverage.map((c) => kpi(`training.${c.topic}`, `Trained: ${c.topic.replace(/_/g, ' ').toLowerCase()}`, c.pct, { unit: 'percent', definition: `${c.covered} of ${c.staff} staff attended within ${c.windowMonths} months.`, source: 'Trainings', link: '/compliance?tab=trainings', tone: c.pct < 90 ? 'warn' : 'good' })),
    ],
    tasks: await myTasks(actor),
  };
}

async function marketingHome(actor) {
  const a = await marketing.analytics({});
  return {
    role: actor.roleKey,
    kpis: [
      kpi('admissions.enquiries', 'Enquiries', a.enquiries, { definition: 'All enquiries on record.', source: 'Admissions CRM', link: '/admin/admissions' }),
      kpi('admissions.conversion', 'Enquiry → enrolment', a.conversionPct, { unit: 'percent', definition: 'Enrolled ÷ all enquiries.', source: 'Admissions CRM', link: '/marketing', status: a.enquiries ? 'OK' : 'UNAVAILABLE' }),
      kpi('admissions.response', 'Median first response', a.response.medianHours, { unit: 'hours', definition: a.response.definition, source: 'Admissions CRM', link: '/marketing', status: a.response.medianHours === null ? 'UNAVAILABLE' : 'OK' }),
      kpi('admissions.unresponded', 'Enquiries without a response', a.response.unresponded, { definition: 'Enquiries with no recorded first response.', source: 'Admissions CRM', link: '/admin/admissions', tone: a.response.unresponded ? 'warn' : 'good' }),
      kpi('admissions.waitlisted', 'Waitlisted', a.offers.WAITLISTED ?? 0, { definition: 'Applicants on a waitlist.', source: 'Seat offers', link: '/marketing?tab=offers' }),
    ],
    funnel: a.funnel,
    bySource: a.bySource,
    tasks: await myTasks(actor),
  };
}

async function complianceHome(actor) {
  const [comp, sg] = await Promise.all([compliance.overview(), safeguarding.counts()]);
  return {
    role: actor.roleKey,
    kpis: [
      kpi('safeguarding.open', 'Open safeguarding cases', sg.open, { definition: `${sg.urgent} urgent.`, source: 'Safeguarding', link: '/safeguarding', tone: sg.urgent ? 'bad' : 'neutral' }),
      kpi('safeguarding.statutory', 'Statutory reports to record', sg.statutoryPending, { definition: 'Child-protection cases without a recorded report to SJPU/police or a recorded reason none is required.', source: 'Safeguarding', link: '/safeguarding', tone: sg.statutoryPending ? 'bad' : 'good' }),
      kpi('compliance.notices', 'Notices to review', comp.noticesToReview, { definition: 'Official notices not yet decided.', source: 'Compliance', link: '/compliance?tab=notices' }),
      kpi('compliance.review', 'Obligations to review', comp.obligationsUnderReview, { definition: 'Catalogue items not yet decided.', source: 'Compliance', link: '/compliance?tab=obligations' }),
      kpi('compliance.policies', 'Policy reviews overdue', comp.policiesReviewOverdue, { definition: 'Policies past their review date.', source: 'Policies', link: '/compliance?tab=policies', tone: comp.policiesReviewOverdue ? 'warn' : 'good' }),
      ...comp.trainingCoverage.map((c) => kpi(`training.${c.topic}`, `Trained: ${c.topic.replace(/_/g, ' ').toLowerCase()}`, c.pct, { unit: 'percent', definition: `${c.covered} of ${c.staff} within ${c.windowMonths} months.`, source: 'Trainings', link: '/compliance?tab=trainings', tone: c.pct < 90 ? 'warn' : 'good' })),
    ],
    deadlines: (await compliance.calendar({ days: 30 })).slice(0, 15),
    tasks: await myTasks(actor),
  };
}

async function trusteeHome(actor) {
  const [inbox, meetings, comp, proc, profile] = await Promise.all([
    approvalInbox(actor),
    governance.list(actor, 'OWN', {}),
    compliance.overview(),
    procurement.stats(),
    institution.getProfile(),
  ]);
  return {
    role: 'TRUSTEE',
    kpis: [
      kpi('approvals.waiting', 'Board decisions waiting', inbox.length, { definition: 'Approval stages addressed to the governing body.', source: 'Approvals', link: '/approvals' }),
      kpi('budget.utilisation', 'Budget used', proc.budgetPlannedPaise ? Math.round(((proc.budgetActualPaise + proc.budgetCommittedPaise) / proc.budgetPlannedPaise) * 100) : null, { unit: 'percent', definition: '(Actual + committed) ÷ planned, approved budgets.', source: 'Budgets', link: '/budgets', status: proc.budgetPlannedPaise ? 'OK' : 'NOT_APPLICABLE' }),
      kpi('compliance.risk', 'Compliance exceptions', comp.returnsOverdue + comp.licencesExpired, { definition: `Overdue returns (${comp.returnsOverdue}) + expired licences (${comp.licencesExpired}).`, source: 'Compliance', link: null, tone: comp.returnsOverdue + comp.licencesExpired ? 'bad' : 'good' }),
      kpi('institution.profile', 'Institution profile complete', profile.completeness.percent, { unit: 'percent', definition: `Missing: ${profile.completeness.missing.join(', ') || 'nothing'}.`, source: 'Institution profile', link: '/institution' }),
    ],
    meetings: meetings.slice(0, 6),
    decisions: inbox.slice(0, 6),
    tasks: await myTasks(actor),
  };
}

async function teacherHome(actor) {
  const sectionIds = await getTeacherSectionIds(actor.profileId);
  const att = await attendanceToday(sectionIds);
  return {
    role: 'TEACHER',
    kpis: [
      kpi('attendance.unmarked', 'Your sections not marked today', att.sections - att.sectionsMarked, { definition: 'Sections you teach without a whole-day register today (class teachers mark these).', source: 'Attendance', link: '/teacher/attendance', tone: att.sections - att.sectionsMarked ? 'warn' : 'good' }),
      kpi('attendance.today', 'Attendance in your sections', att.pct, { unit: 'percent', definition: 'Present or late ÷ marked, whole-day registers.', source: 'Attendance', link: '/teacher/attendance', status: att.marked ? 'OK' : 'UNAVAILABLE' }),
    ],
    tasks: await myTasks(actor),
    policies: (await compliance.myPolicies(actor)).filter((p) => p.requiresAcknowledgement && !p.acknowledged),
    trainings: (await compliance.myTrainings(actor)).filter((t) => t.status === 'SCHEDULED'),
  };
}

export async function home(actor) {
  switch (actor.roleKey) {
    case 'PRINCIPAL': return principalHome(actor);
    case 'ADMIN': case 'SUPER_ADMIN': return adminHome(actor);
    case 'FINANCE': return financeHome(actor);
    case 'HR': return hrHome(actor);
    case 'MARKETING': return marketingHome(actor);
    case 'COMPLIANCE': return complianceHome(actor);
    case 'TRUSTEE': return trusteeHome(actor);
    case 'TEACHER': return teacherHome(actor);
    default: return { role: actor.roleKey, kpis: [], tasks: await myTasks(actor).catch(() => []) };
  }
}

export { safe };
