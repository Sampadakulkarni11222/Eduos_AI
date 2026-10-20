import { registerMetric } from '../catalogue.js';
import { Role } from '../../../models/role.model.js';
import { Profile } from '../../../models/profile.model.js';
import { WorkOrder } from '../../../models/facility.model.js';
import { Licence, ComplianceObligation } from '../../../models/compliance.model.js';
import { DueItem } from '../../../models/dueItem.model.js';
import { CommunityPost } from '../../../models/community.model.js';
import { OnlineClass } from '../../../models/onlineClass.model.js';
import { BookIssue } from '../../../models/library.model.js';
import { HostelRoom, HostelAllocation } from '../../../models/hostel.model.js';
import { BusEnrollment } from '../../../models/transport.model.js';
import { currentTenantId } from '../../../tenancy/tenantContext.js';
import { within, earliest, sum, pct, asOf, onRollAt, DAY } from './helpers.js';
import { payrollTotals } from './finance.js';

/** People, facilities and compliance, engagement, and the library/hostel/transport services. */

// ── people ──────────────────────────────────────────────────────────────
const NOT_STAFF = ['PARENT', 'STUDENT', 'ALUMNUS', 'SUPER_ADMIN'];

registerMetric({
  key: 'people.staff', department: 'people', label: 'Staff accounts', headline: true,
  definition: 'Profiles with a staff role in this school that existed and had not been removed by the cut-off. Parents, students and alumni are not staff.',
  unit: 'count', kind: 'stock', dateBasis: 'As of the last day of the period', sources: ['Profile', 'Role'], link: '/organization', version: 1,
  since: (ctx) => ctx.memo('staffSince', () => earliest(Profile, 'createdAt', { tenantId: currentTenantId() })),
  compute: async (ctx) => {
    const cut = ctx.period.end;
    const roles = await Role.find({ key: { $nin: NOT_STAFF } }).select('_id key').lean();
    const key = new Map(roles.map((r) => [String(r._id), r.key]));
    const rows = await Profile.find({
      tenantId: currentTenantId(), roleId: { $in: roles.map((r) => r._id) }, createdAt: { $lt: cut },
      $or: [{ deletedAt: null, status: 'ACTIVE' }, { deletedAt: { $gte: cut } }],
    }).select('roleId').lean();
    const by = new Map();
    for (const r of rows) { const k = key.get(String(r.roleId)); by.set(k, (by.get(k) ?? 0) + 1); }
    return { value: rows.length, records: rows.length, breakdown: [...by.entries()].map(([label, value]) => ({ label, value })) };
  },
});

registerMetric({
  key: 'people.payroll_gross', department: 'people', label: 'Payroll (gross, school total)',
  definition: 'Gross pay of approved payroll months whose first day falls in the period, as a school total. Individual pay is never shown here.',
  unit: 'paise', kind: 'flow', dateBasis: 'Payroll month', sources: ['PayrollRun.totals'], link: '/payroll', version: 1,
  since: (ctx) => ctx.memo('payrollSince', async () => {
    const { PayrollRun } = await import('../../../models/finance.model.js');
    const first = await PayrollRun.findOne({}).sort({ period: 1 }).select('period').lean();
    if (!first) return null;
    const [y, m] = first.period.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1));
  }),
  compute: async (ctx) => {
    const t = await payrollTotals(ctx.period);
    return { value: t.runs ? t.grossPaise : null, records: t.runs, detail: { netPaise: t.netPaise, employerContributionsPaise: t.employerPaise, headcount: t.headcount }, note: t.runs ? null : 'No approved payroll month starts in the period.' };
  },
});

// ── facilities & compliance ────────────────────────────────────────────
const woSince = (ctx) => ctx.memo('woSince', () => earliest(WorkOrder, 'createdAt'));

registerMetric({
  key: 'facilities.open_work_orders', department: 'facilities', label: 'Open work orders', headline: true,
  definition: 'Maintenance work orders raised by the cut-off and not resolved by then (cancelled ones excluded).',
  unit: 'count', kind: 'stock', dateBasis: 'As of the last day of the period', sources: ['WorkOrder'], link: '/facilities', version: 1,
  since: woSince,
  compute: async (ctx) => {
    const cut = ctx.period.end;
    const rows = await WorkOrder.find({
      createdAt: { $lt: cut }, status: { $ne: 'CANCELLED' },
      $or: [{ resolvedAt: { $gte: cut } }, { resolvedAt: null, status: { $nin: ['RESOLVED', 'CLOSED'] } }],
    }).select('priority').lean();
    const by = ['URGENT', 'HIGH', 'NORMAL', 'LOW'].map((p) => ({ label: p, value: rows.filter((r) => r.priority === p).length }));
    return { value: rows.length, records: rows.length, breakdown: by };
  },
});

registerMetric({
  key: 'facilities.work_orders_resolved', department: 'facilities', label: 'Work orders resolved',
  definition: 'Work orders resolved in the period, with the average days from report to resolution.',
  unit: 'count', kind: 'flow', dateBasis: 'Resolution date', sources: ['WorkOrder'], link: '/facilities', version: 1,
  since: woSince,
  compute: async (ctx) => {
    const rows = await WorkOrder.find(within('resolvedAt', ctx.period)).select('createdAt resolvedAt costPaise').lean();
    const days = rows.map((r) => (r.resolvedAt - r.createdAt) / DAY);
    return { value: rows.length, records: rows.length, detail: { averageDays: days.length ? Math.round((sum(days, (d) => d) / days.length) * 10) / 10 : null, costPaise: sum(rows, (r) => r.costPaise) } };
  },
});

registerMetric({
  key: 'facilities.licences_expiring', department: 'facilities', label: 'Licences expiring in 90 days', currentOnly: true,
  definition: 'Licences, certificates and registrations whose current expiry falls within 90 days after the cut-off and are not marked renewed. A renewal replaces the expiry date, so past periods are not available.',
  unit: 'count', kind: 'stock', dateBasis: 'Current expiry date', sources: ['Licence'], link: '/compliance', version: 1,
  compute: async (ctx) => {
    const cut = ctx.period.end;
    const rows = await Licence.find({ expiresOn: { $gte: cut, $lt: new Date(cut.getTime() + 90 * DAY) }, renewalStatus: { $ne: 'RENEWED' } }).select('title expiresOn renewalCostPaise').lean();
    return { value: rows.length, records: rows.length, detail: { renewalCostPaise: sum(rows, (r) => r.renewalCostPaise) }, breakdown: rows.map((r) => ({ label: r.title, value: r.renewalCostPaise, date: r.expiresOn })) };
  },
});

registerMetric({
  key: 'facilities.licences_lapsed', department: 'facilities', label: 'Licences lapsed', currentOnly: true,
  definition: 'Licences whose current expiry date has passed and that are not marked renewed.',
  unit: 'count', kind: 'stock', dateBasis: 'Current expiry date', sources: ['Licence'], link: '/compliance', version: 1,
  compute: async (ctx) => {
    const n = await Licence.countDocuments({ expiresOn: { $lt: ctx.period.end }, renewalStatus: { $ne: 'RENEWED' } });
    return { value: n, records: n };
  },
});

registerMetric({
  key: 'facilities.obligations_overdue', department: 'facilities', label: 'Statutory obligations overdue', currentOnly: true,
  definition: 'Active obligations that apply to the school whose next due date has passed. The next due date moves on when one is met, so only the current count is kept.',
  unit: 'count', kind: 'stock', dateBasis: 'Current next-due date', sources: ['ComplianceObligation'], link: '/compliance', version: 1,
  compute: async (ctx) => {
    const n = await ComplianceObligation.countDocuments({ active: { $ne: false }, applicability: 'APPLICABLE', nextDueOn: { $lt: ctx.period.end } });
    return { value: n, records: n };
  },
});

const OPEN_TASK = ['OPEN', 'ACKNOWLEDGED', 'SNOOZED'];
registerMetric({
  key: 'facilities.tasks_overdue', department: 'facilities', label: 'Tasks overdue (all departments)', headline: true, currentOnly: true,
  definition: 'Open items in the tasks queue (bills, renewals, services, inspections, follow-ups) whose due date has passed. Counted now; the queue does not keep past overdue counts.',
  unit: 'count', kind: 'stock', dateBasis: 'Due date, now', sources: ['DueItem'], link: '/tasks?view=exceptions', version: 1,
  compute: async (ctx) => {
    const rows = await DueItem.find({ status: { $in: OPEN_TASK }, dueAt: { $lt: ctx.now } }).select('department').lean();
    const by = new Map();
    for (const r of rows) by.set(r.department, (by.get(r.department) ?? 0) + 1);
    return { value: rows.length, records: rows.length, breakdown: [...by.entries()].map(([label, value]) => ({ label, value })) };
  },
});

registerMetric({
  key: 'facilities.tasks_forecast', department: 'facilities', label: 'Forecast cost of tasks due in 90 days', currentOnly: true,
  definition: 'Expected amounts recorded on open tasks due in the next 90 days (overdue ones included). Items in another currency are listed apart, never added.',
  unit: 'paise', kind: 'stock', dateBasis: 'Due date, from now', sources: ['DueItem'], link: '/tasks', version: 1,
  compute: async (ctx) => {
    const rows = await DueItem.find({ status: { $in: OPEN_TASK }, dueAt: { $lt: new Date(ctx.now.getTime() + 90 * DAY) }, amountPaise: { $ne: null } }).select('amountPaise currency').lean();
    const same = rows.filter((r) => (r.currency ?? ctx.currency) === ctx.currency);
    const other = rows.length - same.length;
    return { value: sum(same, (r) => r.amountPaise), records: rows.length, detail: { otherCurrencyItems: other }, note: other ? `${other} item(s) in another currency are not included.` : null };
  },
});

registerMetric({
  key: 'facilities.tasks_completed', department: 'facilities', label: 'Tasks completed',
  definition: 'Items in the tasks queue completed in the period.', unit: 'count', kind: 'flow', dateBasis: 'Completion date',
  sources: ['DueItem'], link: '/tasks', version: 1,
  since: (ctx) => ctx.memo('taskSince', () => earliest(DueItem, 'createdAt')),
  compute: async (ctx) => {
    const n = await DueItem.countDocuments({ status: 'DONE', ...within('completedAt', ctx.period) });
    return { value: n, records: n };
  },
});

// ── engagement ─────────────────────────────────────────────────────────
registerMetric({
  key: 'engagement.posts', department: 'engagement', label: 'Newsroom posts published', headline: true,
  definition: 'Stories, highlights and achievements published to the newsroom in the period.', unit: 'count', kind: 'flow', dateBasis: 'Publication date',
  sources: ['CommunityPost'], link: '/newsroom', version: 1,
  since: (ctx) => ctx.memo('postSince', () => earliest(CommunityPost, 'publishedAt')),
  compute: async (ctx) => {
    const rows = await CommunityPost.find({ status: 'PUBLISHED', ...within('publishedAt', ctx.period) }).select('kind').lean();
    const by = new Map();
    for (const r of rows) by.set(r.kind, (by.get(r.kind) ?? 0) + 1);
    return { value: rows.length, records: rows.length, breakdown: [...by.entries()].map(([label, value]) => ({ label, value })) };
  },
});

registerMetric({
  key: 'engagement.lectures', department: 'engagement', label: 'Online classes and meetings held',
  definition: 'Online lectures, doubt sessions and meetings that took place (ended) and were scheduled in the period. Cancelled ones are excluded.',
  unit: 'count', kind: 'flow', dateBasis: 'Scheduled start', sources: ['OnlineClass'], link: '/lectures', version: 1,
  since: (ctx) => ctx.memo('lecSince', () => earliest(OnlineClass, 'startsAt')),
  compute: async (ctx) => {
    const rows = await OnlineClass.find({ status: { $in: ['ENDED', 'LIVE'] }, ...within('startsAt', ctx.period) }).select('kind').lean();
    const by = new Map();
    for (const r of rows) by.set(r.kind, (by.get(r.kind) ?? 0) + 1);
    return { value: rows.length, records: rows.length, breakdown: [...by.entries()].map(([label, value]) => ({ label, value })) };
  },
});
// PTM bookings, review calls, clubs and achievements register here from their own modules (see catalogue.js).

// ── library, hostel and transport ──────────────────────────────────────
registerMetric({
  key: 'services.library_issues', department: 'services', label: 'Library books issued',
  definition: 'Books issued from the library in the period.', unit: 'count', kind: 'flow', dateBasis: 'Issue date',
  sources: ['BookIssue'], link: '/library', version: 1,
  since: (ctx) => ctx.memo('issueSince', () => earliest(BookIssue, 'issuedAt')),
  compute: async (ctx) => {
    const n = await BookIssue.countDocuments(within('issuedAt', ctx.period));
    return { value: n, records: n };
  },
});

registerMetric({
  key: 'services.library_overdue', department: 'services', label: 'Library loans overdue',
  definition: 'Loans issued by the cut-off, due before it and not returned by then.', unit: 'count', kind: 'stock', dateBasis: 'As of the last day of the period',
  sources: ['BookIssue'], link: '/library', version: 1,
  since: (ctx) => ctx.memo('issueSince', () => earliest(BookIssue, 'issuedAt')),
  compute: async (ctx) => {
    const cut = ctx.period.end;
    const n = await BookIssue.countDocuments({ issuedAt: { $lt: cut }, dueDate: { $lt: cut }, $or: [{ returnedAt: null }, { returnedAt: { $gte: cut } }] });
    return { value: n, records: n };
  },
});

registerMetric({
  key: 'services.hostel_occupancy', department: 'services', label: 'Hostel beds occupied', currentOnly: true,
  definition: 'Active hostel allocations divided by the beds in active rooms. Allocations are counted as they stand now.',
  numerator: 'Active allocations', denominator: 'Beds in active rooms',
  unit: 'percent', kind: 'stock', dateBasis: 'Current allocations', sources: ['HostelAllocation', 'HostelRoom'], link: '/hostel', version: 1,
  compute: async () => {
    const [rooms, beds] = await Promise.all([HostelRoom.find({ status: 'ACTIVE' }).select('capacity').lean(), HostelAllocation.countDocuments({ status: 'ACTIVE' })]);
    const cap = sum(rooms, (r) => r.capacity);
    return { value: pct(beds, cap), records: rooms.length, detail: { occupied: beds, beds: cap }, note: cap ? null : 'No hostel rooms recorded.' };
  },
});

registerMetric({
  key: 'services.transport_riders', department: 'services', label: 'Students using school transport',
  definition: 'Bus enrolments for the academic year containing the period end.', unit: 'count', kind: 'stock', dateBasis: 'Academic year of the period end',
  sources: ['BusEnrollment'], link: '/transport', version: 1,
  since: (ctx) => ctx.memo('busSince', () => earliest(BusEnrollment, 'createdAt')),
  compute: async (ctx) => {
    const { year } = await onRollAt(ctx, asOf(ctx.period));
    if (!year) return { value: null, records: 0, note: 'No academic year covers this date.' };
    const n = await BusEnrollment.countDocuments({ academicYearId: year._id });
    return { value: n, records: n };
  },
});
