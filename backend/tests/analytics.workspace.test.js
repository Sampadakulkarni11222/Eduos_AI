import { describe, it, expect, beforeEach } from 'vitest';
import { inSchool, OAK } from './support/mcpSchool.js';
import { seedAnalyticsSchool, stamp, ist, NOW } from './support/analyticsSchool.js';
import { Invoice, InvoiceLine, Payment } from '../src/models/fee.model.js';
import { Enrollment } from '../src/models/student.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { Lead } from '../src/models/lead.model.js';
import * as analytics from '../src/modules/analytics/analytics.service.js';
import { registerMetric, unregisterMetric, metric, describe as describeMetric } from '../src/modules/analytics/catalogue.js';
import { requirePermission } from '../src/middleware/permission.js';
import { requireFeature, setFeatures } from '../src/utils/features.js';

/**
 * The analytics workspace must agree with its source records: cash by payment
 * date, refunds subtracted, billing by invoice date, strength from enrolment
 * history rather than today's status; a zero or missing baseline is "not
 * comparable"; and a teacher at OWN scope sees only their own classes'
 * academics, never finance.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
const SEPT = { preset: 'custom', from: '2026-09-01', to: '2026-09-30' };
const metricOf = (data, key) => data.metrics.find((m) => m.key === key);
const overview = (who, scope, query) => inOak(() => analytics.overview(s.people[who].actor, scope, query, { now: NOW }));

beforeEach(async () => { s = await seedAnalyticsSchool(); });

async function seedMoney() {
  return inOak(async () => {
    const { enrollment } = await s.enrol('A-1', s.sectionA, s.year);
    const inv = async (no, total, createdAt, status = 'PENDING', concession = 0) => {
      const i = await Invoice.create({ enrollmentId: enrollment._id, invoiceNo: no, totalPaise: total, dueOn: new Date('2026-09-15'), status });
      await InvoiceLine.create({ invoiceId: i._id, description: 'Tuition', amountPaise: total + concession, concessionPaise: concession });
      await stamp(Invoice, i._id, { createdAt });
      return i;
    };
    const septA = await inv('INV-1', 1_000_000, ist('2026-09-02'), 'PENDING', 50_000);
    const septB = await inv('INV-2', 400_000, ist('2026-09-20'));
    await inv('INV-X', 999_999, ist('2026-09-05'), 'CANCELLED');
    const aug = await inv('INV-0', 300_000, ist('2026-08-10'));
    const pay = async (invoice, amount, paidOn, createdAt, extra = {}) => {
      const p = await Payment.create({ invoiceId: invoice._id, amountPaise: amount, mode: 'CASH', paidOn, ...extra });
      await stamp(Payment, p._id, { createdAt });
      return p;
    };
    // Recorded on 2 October but paid on 29 September: September cash.
    await pay(septA, 600_000, ist('2026-09-29'), ist('2026-10-02'));
    // 00:30 on 1 October in India is 19:00 UTC on 30 September: October, not September.
    await pay(septB, 100_000, ist('2026-10-01', 0.5), ist('2026-10-01', 0.5));
    // Awaiting approval: not cash yet.
    await pay(septB, 50_000, ist('2026-09-10'), ist('2026-09-10'), { recordStatus: 'PENDING_ADMIN_APPROVAL' });
    // Paid in August, refunded (completed) on 20 September.
    await pay(aug, 300_000, ist('2026-08-12'), ist('2026-08-12'), {
      status: 'REFUNDED', refundedPaise: 120_000,
      refunds: [{ amountPaise: 120_000, reason: 'Withdrawal', mode: 'BANK', status: 'COMPLETED', decidedAt: ist('2026-09-20') },
        { amountPaise: 10_000, reason: 'Pending one', mode: 'BANK', status: 'PENDING_APPROVAL' }],
    });
    return { septA, septB, aug, enrollment };
  });
}

describe('finance figures reconcile with their records', () => {
  it('counts billing by invoice date, cash by payment date, and subtracts completed refunds', async () => {
    await seedMoney();
    const data = await overview('FINANCE', 'OWN', { ...SEPT, department: 'finance', compare: 'previous' });
    // Billed: the two September invoices; the cancelled one and August's are out.
    expect(metricOf(data, 'finance.billed').current.value).toBe(1_400_000);
    expect(metricOf(data, 'finance.concessions').current.value).toBe(50_000);

    // Independent reconciliation against the raw records.
    const raw = await inOak(() => Payment.find({ status: { $in: ['SUCCESS', 'REFUNDED'] }, recordStatus: 'PUBLISHED' }).lean());
    const start = new Date(data.period.start); const end = new Date(data.period.end);
    const expectGross = raw.filter((p) => { const d = p.paidOn ?? p.createdAt; return d >= start && d < end; }).reduce((t, p) => t + p.amountPaise, 0);
    expect(metricOf(data, 'finance.collections_gross').current.value).toBe(expectGross);
    expect(expectGross).toBe(600_000);
    expect(metricOf(data, 'finance.refunds').current.value).toBe(120_000);
    const net = metricOf(data, 'finance.net_collections');
    expect(net.current.value).toBe(480_000);
    expect(net.current.detail).toMatchObject({ grossPaise: 600_000, refundsPaise: 120_000 });
    expect(net.currency).toBe('INR');

    // October holds the 00:30 IST payment.
    const oct = await overview('FINANCE', 'OWN', { preset: 'custom', from: '2026-10-01', to: '2026-10-13', department: 'finance' });
    expect(metricOf(oct, 'finance.collections_gross').current.value).toBe(100_000);

    // Outstanding at the end of September: INV-1 10,00,000 − 6,00,000; INV-2 4,00,000; INV-0 3,00,000 − (3,00,000 − 1,20,000).
    const out = metricOf(data, 'finance.outstanding');
    expect(out.current.value).toBe(400_000 + 400_000 + 120_000);
    expect(out.current.breakdown.reduce((t, b) => t + b.value, 0)).toBe(out.current.value);

    // The trend sums to the period total.
    expect(net.trend.points.reduce((t, p) => t + (p.value ?? 0), 0)).toBe(480_000);
  });

  it('exports the same figures as the screen, escaping spreadsheet formulas', async () => {
    await seedMoney();
    const screen = await overview('FINANCE', 'OWN', { ...SEPT, department: 'finance' });
    const { body } = await inOak(() => analytics.exportCsv(s.people.FINANCE.actor, 'OWN', { ...SEPT, department: 'finance' }, { now: NOW }));
    const line = body.split('\r\n').find((l) => l.startsWith('finance.net_collections,'));
    expect(line.split(',')[7]).toBe(String(metricOf(screen, 'finance.net_collections').current.value));
    expect(analytics.csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(analytics.csvCell('+91 98')).toBe("'+91 98");
    expect(analytics.csvCell('-cmd')).toBe("'-cmd");
    expect(analytics.csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(analytics.csvCell(-500)).toBe('-500');
  });
});

describe('comparisons', () => {
  it('reports a zero baseline as not comparable, and missing history as not available', async () => {
    await seedMoney();
    // August had no billing apart from INV-0... compare September with a custom window holding none.
    const data = await overview('FINANCE', 'OWN', { ...SEPT, department: 'finance', compare: 'custom', compareFrom: '2026-07-01', compareTo: '2026-07-31' });
    const billed = metricOf(data, 'finance.billed');
    // Invoices begin in August, so July is "not available", not zero.
    expect(billed.comparison.value).toBeNull();
    expect(billed.comparison.coverage).toBe('NONE');
    expect(billed.change).toMatchObject({ comparable: false, pct: null });

    // A window with records but a zero value: a zero baseline, not infinity.
    const zero = await overview('FINANCE', 'OWN', { ...SEPT, department: 'finance', compare: 'custom', compareFrom: '2026-08-15', compareTo: '2026-08-31' });
    const z = metricOf(zero, 'finance.billed');
    expect(z.comparison.value).toBe(0);
    expect(z.change).toMatchObject({ comparable: false, reason: 'The comparison value is zero', pct: null });
    expect(Number.isFinite(z.change.abs)).toBe(true);
  });

  it('draws the trend of the comparison period under a department view, and not on the overview', async () => {
    await seedMoney();
    const data = await overview('FINANCE', 'OWN', { ...SEPT, department: 'finance', compare: 'previous' });
    const withTrend = data.metrics.filter((m) => m.trend);
    expect(withTrend.length).toBeGreaterThan(0);
    for (const m of withTrend) {
      expect(m.comparisonTrend).toBeTruthy();
      expect(m.comparisonTrend.points.length).toBeGreaterThan(0);
    }
    // August (the previous equal period) billed INV-0 only: its trend sums to the August figure.
    const billed = metricOf(data, 'finance.billed');
    if (billed.trend) {
      const sum = billed.comparisonTrend.points.reduce((t, p) => t + (p.value ?? 0), 0);
      expect(sum).toBe(billed.comparison.value);
    }
    const all = await overview('FINANCE', 'OWN', { ...SEPT, department: 'all', compare: 'previous' });
    expect(all.metrics.every((m) => m.comparisonTrend === null)).toBe(true);
  });

  it('shows current-only figures as not available for past periods', async () => {
    const data = await overview('PRINCIPAL', 'ALL', { preset: 'month', department: 'admissions', compare: 'lastYear' });
    const wait = metricOf(data, 'admissions.waitlist');
    expect(wait.current.value).toBe(0);
    expect(wait.comparison.value).toBeNull();
    expect(wait.change.comparable).toBe(false);
  });
});

describe('student strength comes from enrolment history', () => {
  it('counts last year\'s graduates in last year, and a withdrawn pupil until they left', async () => {
    await inOak(async () => {
      // Last year: two pupils, both graduated (today's status), still on roll during 2025-26.
      await s.enrol('L-1', s.sectionA, s.lastYear, 'GRADUATED');
      await s.enrol('L-2', s.sectionA, s.lastYear, 'GRADUATED');
      // This year: three active, one withdrawn on 10 September.
      await s.enrol('T-1', s.sectionA, s.year);
      await s.enrol('T-2', s.sectionA, s.year);
      await s.enrol('T-3', s.sectionB, s.year);
      const { enrollment } = await s.enrol('T-4', s.sectionB, s.year, 'WITHDRAWN');
      await stamp(Enrollment, enrollment._id, { updatedAt: ist('2026-09-10') });
    });
    const lastYear = await overview('PRINCIPAL', 'ALL', { preset: 'custom', from: '2026-03-01', to: '2026-03-15', department: 'admissions' });
    // Today no 2025-26 enrolment is ACTIVE; history still has two pupils on roll.
    expect(metricOf(lastYear, 'admissions.strength').current.value).toBe(2);
    const early = await overview('PRINCIPAL', 'ALL', { preset: 'custom', from: '2026-09-01', to: '2026-09-05', department: 'admissions' });
    expect(metricOf(early, 'admissions.strength').current.value).toBe(4);
    const late = await overview('PRINCIPAL', 'ALL', { ...SEPT, department: 'admissions' });
    expect(metricOf(late, 'admissions.strength').current.value).toBe(3);
    expect(metricOf(late, 'admissions.opening_strength').current.value).toBe(4);
    expect(metricOf(late, 'admissions.withdrawals').current.value).toBe(1);
    // Before any enrolment history: not available.
    const before = await overview('PRINCIPAL', 'ALL', { preset: 'custom', from: '2025-01-01', to: '2025-01-31', department: 'admissions' });
    expect(metricOf(before, 'admissions.strength').current).toMatchObject({ value: null, coverage: 'NONE' });
  });
});

describe('scope', () => {
  it('keeps a teacher to their own classes\' academics and away from finance', async () => {
    await seedMoney();
    await inOak(async () => {
      const a = await s.enrol('A-2', s.sectionA, s.year);
      const b = await s.enrol('B-1', s.sectionB, s.year);
      const day = (d) => new Date(`2026-09-${d}T00:00:00.000Z`);
      for (const d of ['01', '02', '03', '04']) {
        // eslint-disable-next-line no-await-in-loop
        await AttendanceRecord.create({ enrollmentId: a.enrollment._id, date: day(d), status: d === '04' ? 'ABSENT' : 'PRESENT' });
        // eslint-disable-next-line no-await-in-loop
        await AttendanceRecord.create({ enrollmentId: b.enrollment._id, date: day(d), status: 'ABSENT' });
      }
      await AttendanceRecord.create({ enrollmentId: a.enrollment._id, date: day('05'), status: 'EXCUSED' });
    });
    const teacher = s.people.TEACHER.actor;
    await expect(inOak(() => analytics.overview(teacher, 'OWN', { ...SEPT, department: 'finance' }, { now: NOW }))).rejects.toMatchObject({ statusCode: 403, code: 'DEPARTMENT_FORBIDDEN' });
    const all = await inOak(() => analytics.overview(teacher, 'OWN', SEPT, { now: NOW }));
    expect(all.departments.map((d) => d.key)).toEqual(['academics']);
    expect(all.metrics.every((m) => m.department === 'academics')).toBe(true);
    const mine = await inOak(() => analytics.overview(teacher, 'OWN', { ...SEPT, department: 'academics' }, { now: NOW }));
    // Only 6 A: 3 of 4 eligible days (the excused day is left out of both sides).
    expect(metricOf(mine, 'academics.attendance_rate').current).toMatchObject({ value: 75, detail: { attended: 3, eligible: 4 } });
    const principal = await overview('PRINCIPAL', 'ALL', { ...SEPT, department: 'academics' });
    expect(metricOf(principal, 'academics.attendance_rate').current.value).toBe(37.5);
    // The catalogue at OWN scope lists only academics.
    const cat = await inOak(() => analytics.catalogue(teacher, 'OWN'));
    expect(cat.metrics.some((m) => m.department === 'finance')).toBe(false);
    // Teachers hold no export key: the route refuses before any figure is computed.
    expect(() => requirePermission('analytics.export')({ actor: teacher }, {}, () => {})).toThrow(/analytics.export/);
    // Finance at OWN sees finance and procurement only.
    const fin = await overview('FINANCE', 'OWN', SEPT);
    expect(fin.departments.map((d) => d.key)).toEqual(['finance', 'procurement']);
    // A role with no department gets nothing rather than everything.
    await expect(inOak(() => analytics.overview(s.people.LIBRARIAN.actor, 'OWN', SEPT, { now: NOW }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('refuses the API when the school has switched analytics off', async () => {
    await inOak(() => setFeatures({ analytics: false }));
    let error;
    await inOak(() => requireFeature('analytics')({}, {}, (e) => { error = e; }));
    expect(error).toMatchObject({ statusCode: 403, code: 'FEATURE_OFF' });
  });
});

describe('the catalogue', () => {
  it('lets a module register a metric that the overview then reports', async () => {
    registerMetric({
      key: 'engagement.test_metric', department: 'engagement', label: 'Test metric', definition: 'Leads, counted by a module.',
      unit: 'count', kind: 'flow', dateBasis: 'Created', sources: ['Lead'], headline: true, compute: async () => ({ value: 7, records: 7 }),
    });
    try {
      expect(() => registerMetric({ ...metric('engagement.test_metric') })).toThrow(/already registered/);
      expect(() => registerMetric({ key: 'bad', department: 'engagement' })).toThrow(/missing/);
      const data = await overview('PRINCIPAL', 'ALL', SEPT);
      expect(metricOf(data, 'engagement.test_metric').current.value).toBe(7);
      expect(describeMetric(metric('engagement.test_metric')).version).toBe(1);
    } finally { unregisterMetric('engagement.test_metric'); }
  });

  it('measures enquiry conversion over one cohort', async () => {
    await inOak(async () => {
      for (const [i, stage] of ['NEW', 'ENROLLED', 'APPLICATION', 'ENROLLED'].entries()) {
        // eslint-disable-next-line no-await-in-loop
        const l = await Lead.create({ childName: `C${i}`, guardianName: 'G', phone: `+9190000000${i}`, stage, source: 'WEB' });
        // eslint-disable-next-line no-await-in-loop
        await stamp(Lead, l._id, { createdAt: ist('2026-09-10') });
      }
    });
    const data = await overview('MARKETING', 'OWN', { ...SEPT, department: 'admissions' });
    expect(metricOf(data, 'admissions.enquiries').current.value).toBe(4);
    expect(metricOf(data, 'admissions.conversion').current.value).toBe(50);
    expect(metricOf(data, 'admissions.applications').current.value).toBe(3);
  });
});
