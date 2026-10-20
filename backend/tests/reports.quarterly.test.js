import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { inSchool, OAK } from './support/mcpSchool.js';
import { seedAnalyticsSchool, stamp, ist, NOW } from './support/analyticsSchool.js';
import { QuarterlyReport, QuarterlyDelivery } from '../src/models/quarterlyReport.model.js';
import { MessageOutbox } from '../src/models/messaging.model.js';
import { Profile } from '../src/models/profile.model.js';
import { Invoice } from '../src/models/fee.model.js';
import * as quarterly from '../src/modules/analytics/quarterly.service.js';
import { renderQuarterlyPdf } from '../src/modules/analytics/quarterly.pdf.js';
import { JOBS } from '../src/jobs/scheduler.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { Role } from '../src/models/role.model.js';

/**
 * Quarterly reports are frozen, versioned snapshots delivered once per
 * recipient: a rerun or a crashed worker never duplicates a report or a
 * sent delivery, a regeneration is a new version, and a recipient who lost
 * the authority can neither receive nor download it.
 */
let s;
let calls;
const inOak = (fn) => inSchool(OAK, fn);
const RECIPIENTS = ['ADMIN', 'PRINCIPAL', 'FINANCE', 'HR', 'COMPLIANCE', 'TRUSTEE'];

beforeEach(async () => {
  s = await seedAnalyticsSchool();
  calls = [];
  quarterly.setQuarterlySenderForTests(async (args) => { calls.push(args); return [{ status: 'SIMULATED', channel: 'EMAIL' }]; });
  await inOak(async () => {
    const { enrollment } = await s.enrol('Q-1', s.sectionA, s.year);
    const i = await Invoice.create({ enrollmentId: enrollment._id, invoiceNo: 'Q-INV-1', totalPaise: 500_000, dueOn: new Date('2026-08-01') });
    await stamp(Invoice, i._id, { createdAt: ist('2026-07-15') });
  });
});
afterEach(() => quarterly.setQuarterlySenderForTests(null));

describe('quarters', () => {
  it('finds the previous financial-year quarter in the school calendar', () => {
    expect(quarterly.previousQuarter(NOW, { tz: 'Asia/Kolkata', financialYearStartMonth: 4 })).toMatchObject({ key: 'FY2026-27-Q2', from: '2026-07-01', to: '2026-09-30' });
    expect(quarterly.previousQuarter(new Date('2026-04-02T00:00:00Z'), { tz: 'Asia/Kolkata', financialYearStartMonth: 4 })).toMatchObject({ key: 'FY2025-26-Q4', from: '2026-01-01', to: '2026-03-31' });
    expect(quarterly.quarterFromKey('FY2026-27-Q1')).toMatchObject({ from: '2026-04-01', to: '2026-06-30' });
  });

  it('is scheduled per school behind the analytics feature, with a lease', () => {
    expect(JOBS.find((j) => j.key === 'reports.quarterly')).toMatchObject({ feature: 'analytics', leaseMinutes: 45 });
  });
});

describe('scheduled generation and delivery', () => {
  it('generates once and delivers once per recipient, however often it runs', async () => {
    const first = await inOak(() => quarterly.generateScheduled({ now: NOW }));
    expect(first).toMatchObject({ quarter: 'FY2026-27-Q2', version: 1, status: 'GENERATED', sent: RECIPIENTS.length });
    await inOak(() => quarterly.generateScheduled({ now: new Date(NOW.getTime() + 6 * 3600_000) }));
    await inOak(() => quarterly.generateScheduled({ now: new Date(NOW.getTime() + 12 * 3600_000) }));
    expect(await inOak(() => QuarterlyReport.countDocuments({}))).toBe(1);
    expect(await inOak(() => QuarterlyDelivery.countDocuments({}))).toBe(RECIPIENTS.length);
    expect(calls).toHaveLength(RECIPIENTS.length);
    const report = await inOak(() => QuarterlyReport.findOne({}).lean());
    const billed = report.figures.sections.find((x) => x.key === 'finance').metrics.find((m) => m.key === 'finance.billed');
    expect(billed.value).toBe(500_000);
    expect(billed.priorQuarter.change).toMatchObject({ comparable: false });
    expect(report.catalogueVersion).toBeTruthy();
  });

  it('retries only failed deliveries, never a sent one', async () => {
    const financeId = String(s.people.FINANCE.profile._id);
    quarterly.setQuarterlySenderForTests(async (args) => {
      calls.push(args);
      return [{ status: args.recipientProfileIds[0] === financeId ? 'FAILED' : 'SENT', channel: 'EMAIL', error: 'SMTP down' }];
    });
    const first = await inOak(() => quarterly.generateScheduled({ now: NOW }));
    expect(first).toMatchObject({ sent: RECIPIENTS.length - 1, failed: 1 });
    calls = [];
    quarterly.setQuarterlySenderForTests(async (args) => { calls.push(args); return [{ status: 'SENT', channel: 'EMAIL' }]; });
    const again = await inOak(() => quarterly.generateScheduled({ now: new Date(NOW.getTime() + 6 * 3600_000) }));
    expect(again).toMatchObject({ sent: 1, failed: 0 });
    expect(calls.map((c) => c.recipientProfileIds[0])).toEqual([financeId]);
    // Each attempt has its own idempotency key, so the outbox does not swallow the retry.
    expect(calls[0].idempotencyKey).toMatch(/:a2$/);
    const rows = await inOak(() => QuarterlyDelivery.find({}).lean());
    expect(rows.every((r) => r.status === 'SENT')).toBe(true);
  });

  it('recovers from a worker that crashed mid-generation and mid-send without duplicating', async () => {
    // A report left GENERATING by a crashed worker, long ago.
    await inOak(() => QuarterlyReport.create({ quarterKey: 'FY2026-27-Q2', label: 'Q2', version: 1, status: 'GENERATING', startedAt: new Date(NOW.getTime() - 3600_000) }));
    const out = await inOak(() => quarterly.generateScheduled({ now: NOW }));
    expect(out).toMatchObject({ version: 1, status: 'GENERATED' });
    expect(await inOak(() => QuarterlyReport.countDocuments({}))).toBe(1);

    // A delivery whose worker crashed after the message went out but before marking it SENT.
    const report = await inOak(() => QuarterlyReport.findOne({}).lean());
    const row = await inOak(() => QuarterlyDelivery.findOne({ recipientProfileId: s.people.HR.profile._id }));
    await inOak(() => QuarterlyDelivery.updateOne({ _id: row._id }, { $set: { status: 'SENDING', claimedAt: new Date(NOW.getTime() - 3600_000) } }));
    await inOak(() => MessageOutbox.create({
      channel: 'EMAIL', templateKey: 'QUARTERLY_REPORT_READY', recipientProfileId: row.recipientProfileId, preview: 'x', status: 'SENT',
      idempotencyKey: `qreport:${report._id}:${row.recipientProfileId}:a${row.attempts}`, statusHistory: [{ status: 'SENT', at: NOW }],
    }));
    calls = [];
    const res = await inOak(() => quarterly.deliver(report._id, { now: NOW }));
    expect(calls).toHaveLength(0);
    expect(res.sent).toBe(1);
    expect((await inOak(() => QuarterlyDelivery.findById(row._id).lean())).status).toBe('SENT');
  });
});

describe('versions and access', () => {
  it('regenerates as a new version and leaves the first untouched', async () => {
    await inOak(() => quarterly.generateScheduled({ now: NOW }));
    const v1 = await inOak(() => QuarterlyReport.findOne({ version: 1 }).lean());
    const v2 = await inOak(() => quarterly.regenerate(s.people.PRINCIPAL.actor, { quarter: 'FY2026-27-Q2', reason: 'Late invoices entered', deliver: false }, { now: new Date(NOW.getTime() + 3600_000) }));
    expect(v2.version).toBe(2);
    expect(String(v2.supersedesId)).toBe(String(v1._id));
    const again = await inOak(() => QuarterlyReport.findById(v1._id).lean());
    expect(again.generatedAt.toISOString()).toBe(v1.generatedAt.toISOString());
    expect(again.figures).toEqual(v1.figures);
    const listed = await inOak(() => quarterly.list(s.people.PRINCIPAL.actor));
    expect(listed.items.map((r) => [r.version, r.latest])).toEqual([[2, true], [1, false]]);
  });

  it('gives a department head their section only, and refuses a revoked recipient', async () => {
    await inOak(() => quarterly.generateScheduled({ now: NOW }));
    const report = await inOak(() => QuarterlyReport.findOne({}).lean());
    const fin = await inOak(() => quarterly.get(s.people.FINANCE.actor, String(report._id)));
    expect(fin.figures.sections.map((x) => x.key)).toEqual(['finance', 'procurement']);
    expect(fin.figures.summary).toBeNull();
    expect(fin.figures.decisions).toBeNull();
    expect(fin.figures.budget).not.toBeNull();
    const csv = await inOak(() => quarterly.csv(s.people.FINANCE.actor, String(report._id)));
    expect(csv.body).not.toMatch(/people\.payroll_gross|academics\./);
    const pdf = await inOak(() => quarterly.forPdf(s.people.PRINCIPAL.actor, String(report._id)));
    const chunks = [];
    const sink = new PassThrough();
    sink.on('data', (c) => chunks.push(c));
    await new Promise((resolve) => { sink.on('end', resolve); renderQuarterlyPdf(sink, pdf); });
    expect(Buffer.concat(chunks).subarray(0, 5).toString()).toBe('%PDF-');

    // Finance's person moves to the library role: no longer a recipient.
    const librarian = await Role.findOne({ key: 'LIBRARIAN' }).lean();
    await Profile.updateOne({ _id: s.people.FINANCE.profile._id }, { $set: { roleId: librarian._id } });
    const revoked = { ...s.people.FINANCE.actor, roleKey: 'LIBRARIAN', permissions: buildPermissionMap(librarian) };
    await expect(inOak(() => quarterly.get(revoked, String(report._id)))).rejects.toMatchObject({ statusCode: 403 });
    await expect(inOak(() => quarterly.csv(revoked, String(report._id)))).rejects.toMatchObject({ statusCode: 403 });
    // A new version is not delivered to them either.
    await inOak(() => quarterly.regenerate(s.people.PRINCIPAL.actor, { quarter: 'FY2026-27-Q2' }, { now: NOW }));
    const v2 = await inOak(() => QuarterlyReport.findOne({ version: 2 }).lean());
    expect(await inOak(() => QuarterlyDelivery.countDocuments({ reportId: v2._id, recipientProfileId: s.people.FINANCE.profile._id }))).toBe(0);
    // A queued delivery whose recipient lost the authority is revoked, not sent.
    await inOak(() => QuarterlyDelivery.updateOne({ reportId: report._id, recipientProfileId: s.people.FINANCE.profile._id }, { $set: { status: 'FAILED' } }));
    calls = [];
    const res = await inOak(() => quarterly.deliver(report._id, { now: NOW }));
    expect(res.revoked).toBe(1);
    expect(calls).toHaveLength(0);
  });
});
