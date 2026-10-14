import { QuarterlyReport, QuarterlyDelivery } from '../../models/quarterlyReport.model.js';
import { Role } from '../../models/role.model.js';
import { Profile } from '../../models/profile.model.js';
import { Budget } from '../../models/finance.model.js';
import { DueItem } from '../../models/dueItem.model.js';
import { MessageOutbox } from '../../models/messaging.model.js';
import { CommunityPost } from '../../models/community.model.js';
import { ApprovalRequest } from '../../models/approval.model.js';
import { AppError } from '../../utils/AppError.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { periodFromDates, comparisonPeriod, change, localDate } from '../../utils/periods.js';
import { logger } from '../../utils/logger.js';
import { sendOperational } from '../messaging/messaging.service.js';
import { assertObjectId, dto, optionalText, pageArgs } from '../ops/common.js';
import { DEPARTMENTS, versionHash } from './catalogue.js';
import { OWN_DEPARTMENTS, ALL_DEPARTMENT_KEYS } from './analytics.scope.js';
import { computeOverview, schoolCalendar, CURRENCY, toCsv } from './analytics.service.js';
import { fiscalYearName } from './metrics/finance.js';

/**
 * Quarterly decision reports.
 *
 * Generation is deterministic: the figures are the catalogue's metrics for
 * the quarter, the prior quarter and the same quarter a year earlier, plus
 * budget variance, the renewal forecast from the tasks queue, achievements
 * and the decisions waiting. No AI writes or changes any number.
 *
 * Every version is a snapshot. The scheduled job generates version 1 of the
 * previous quarter once per school (quarterKey + version is unique, so a
 * repeated or concurrent tick cannot make two); a manual regeneration adds
 * version n+1 and leaves the earlier ones untouched.
 *
 * Recipients are everyone whose role holds reports.quarterly.read: at ALL
 * scope the whole report, at OWN scope only their department's section.
 * Each recipient gets a durable delivery record (QUEUED, SENDING, SENT,
 * FAILED, REVOKED). A retry sends only what is not SENT, and authority is
 * checked again at delivery and at every download.
 */

const DAY = 86_400_000;
const GENERATING_LEASE_MS = 30 * 60_000;
const SENDING_LEASE_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

/** Sections a recipient with OWN scope may read. TRUSTEE gets the consolidated summary only. */
export const REPORT_OWN_SECTIONS = {
  FINANCE: [...OWN_DEPARTMENTS.FINANCE, 'budget'],
  HR: OWN_DEPARTMENTS.HR,
  MARKETING: OWN_DEPARTMENTS.MARKETING,
  COMPLIANCE: [...OWN_DEPARTMENTS.COMPLIANCE, 'renewals'],
  TRUSTEE: ['summary', 'budget'],
};
const ALL_SECTIONS = () => ['summary', ...ALL_DEPARTMENT_KEYS(), 'budget', 'renewals', 'achievements', 'decisions', 'missing'];

/** Sections a person may read now (null when none). */
export function sectionsFor(actor) {
  const scope = actor?.permissions?.['reports.quarterly.read'];
  if (scope === 'ALL') return ALL_SECTIONS();
  if (scope === 'OWN') return REPORT_OWN_SECTIONS[actor.roleKey] ?? null;
  return null;
}

// ── quarters ───────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0');
const addMonths = (y, m, n) => { const t = (y * 12 + (m - 1)) + n; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; };
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The financial-year quarter containing a local date. */
export function quarterContaining({ y, m }, fyStartMonth = 4) {
  const offset = (m - fyStartMonth + 12) % 12;
  const q = Math.floor(offset / 3) + 1;
  const fyStartYear = m >= fyStartMonth ? y : y - 1;
  const start = addMonths(fyStartYear, fyStartMonth, (q - 1) * 3);
  const last = addMonths(start.y, start.m, 2);
  const fy = fyStartMonth === 1 ? String(fyStartYear) : `${fyStartYear}-${pad((fyStartYear + 1) % 100)}`;
  return {
    key: `FY${fy}-Q${q}`, q, fy,
    from: `${start.y}-${pad(start.m)}-01`, to: `${last.y}-${pad(last.m)}-${pad(daysIn(last.y, last.m))}`,
  };
}

/** The quarter that ended most recently before `now`, in the school's calendar. */
export function previousQuarter(now, { tz, financialYearStartMonth = 4 }) {
  const today = localDate(now, tz);
  const cur = quarterContaining(today, financialYearStartMonth);
  const [y, m] = cur.from.split('-').map(Number);
  const before = addMonths(y, m, -1);
  return quarterContaining(before, financialYearStartMonth);
}

export function quarterFromKey(key, financialYearStartMonth = 4) {
  const match = /^FY(\d{4})(?:-\d{2})?-Q([1-4])$/.exec(String(key ?? ''));
  if (!match) throw new AppError('quarter must look like FY2026-27-Q2', 400, [], 'BAD_QUARTER');
  const start = addMonths(Number(match[1]), financialYearStartMonth, (Number(match[2]) - 1) * 3);
  return quarterContaining(start, financialYearStartMonth);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const human = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const quarterLabel = (q) => `Q${q.q} ${q.fy} (${human(q.from)} – ${human(q.to)})`;

// ── figures ────────────────────────────────────────────────────────────

const slim = (m, prior, lastYear) => ({
  key: m.key, label: m.label, department: m.department, unit: m.unit, currency: m.currency, definition: m.definition, version: m.version,
  dateBasis: m.dateBasis, value: m.current.value, coverage: m.current.coverage, note: m.current.note, records: m.current.records,
  detail: m.current.detail, breakdown: (m.current.breakdown ?? []).slice(0, 12),
  priorQuarter: prior ? { value: prior.current.value, coverage: prior.current.coverage, change: change(m.current.value, prior.current.value) } : null,
  lastYear: lastYear ? { value: lastYear.current.value, coverage: lastYear.current.coverage, change: change(m.current.value, lastYear.current.value) } : null,
});

/** Computes every figure of a report for a quarter, as of `now`. Pure reads. */
export async function buildFigures(quarter, { now = new Date() } = {}) {
  const calendar = await schoolCalendar();
  const period = periodFromDates(quarter.from, quarter.to, { tz: calendar.tz, label: quarterLabel(quarter) });
  const priorQ = quarterContaining(addMonths(...quarter.from.split('-').map(Number).slice(0, 2), -1), calendar.financialYearStartMonth);
  const prior = periodFromDates(priorQ.from, priorQ.to, { tz: calendar.tz });
  const lastYear = comparisonPeriod(period, { mode: 'lastYear' });
  const scope = { level: 'ALL', all: true, departments: ALL_DEPARTMENT_KEYS(), sectionIds: null };
  const base = { scope, departments: scope.departments, calendar, now, withTrend: false };
  const [cur, pq, ly] = await Promise.all([
    computeOverview({ ...base, period, comparison: null }),
    computeOverview({ ...base, period: prior, comparison: null }),
    computeOverview({ ...base, period: lastYear, comparison: null }),
  ]);
  const byKey = (list) => new Map(list.map((m) => [m.key, m]));
  const pqm = byKey(pq); const lym = byKey(ly);
  const all = cur.map((m) => slim(m, pqm.get(m.key), lym.get(m.key)));

  const sections = DEPARTMENTS.map((d) => ({ key: d.key, label: d.label, metrics: all.filter((m) => m.department === d.key) })).filter((s) => s.metrics.length);
  const summary = all.filter((m) => cur.find((c) => c.key === m.key)?.headline);

  // Budget variance for the financial year of the quarter end (running totals at generation time).
  const fy = fiscalYearName(new Date(period.end.getTime() - 1), calendar.financialYearStartMonth, calendar.tz);
  const budgets = await Budget.find({ fiscalYear: fy, status: { $in: ['APPROVED', 'LOCKED'] } }).select('name lines').lean();
  const lines = budgets.flatMap((b) => (b.lines ?? []).map((l) => ({
    budget: b.name, code: l.code, head: l.head, department: l.department ?? null, plannedPaise: l.plannedPaise ?? 0, committedPaise: l.committedPaise ?? 0, actualPaise: l.actualPaise ?? 0,
    variancePaise: (l.actualPaise ?? 0) - (l.plannedPaise ?? 0), explanation: l.varianceExplanation ?? null,
  })));
  const tot = (k) => lines.reduce((t, l) => t + l[k], 0);
  const budget = {
    fiscalYear: fy, currency: CURRENCY, basis: 'Running totals at generation time; commitments are separate from actual spend.',
    lines, totals: { plannedPaise: tot('plannedPaise'), committedPaise: tot('committedPaise'), actualPaise: tot('actualPaise'), variancePaise: tot('variancePaise') },
    available: lines.length > 0,
  };

  // Renewal forecast: open items due in the 90 days after the quarter, and anything already overdue.
  const horizon = new Date(period.end.getTime() + 90 * DAY);
  const due = await DueItem.find({ status: { $in: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED'] }, dueAt: { $lt: horizon } }).sort({ dueAt: 1 }).limit(200).select('title department category dueAt amountPaise currency severity ownerProfileId').lean();
  const names = new Map((await Profile.find({ _id: { $in: due.map((d) => d.ownerProfileId).filter(Boolean) } }).select('displayName').lean()).map((p) => [String(p._id), p.displayName]));
  const sameCurrency = due.filter((d) => (d.currency ?? CURRENCY) === CURRENCY);
  const renewals = {
    horizon: horizon.toISOString(), currency: CURRENCY,
    items: due.map((d) => ({ title: d.title, department: d.department, category: d.category, dueAt: d.dueAt, amountPaise: d.amountPaise, currency: d.currency ?? CURRENCY, severity: d.severity, owner: names.get(String(d.ownerProfileId)) ?? 'Unassigned', overdue: d.dueAt < now })),
    totals: { count: due.length, overdue: due.filter((d) => d.dueAt < now).length, forecastPaise: sameCurrency.reduce((t, d) => t + (d.amountPaise ?? 0), 0), otherCurrencyItems: due.length - sameCurrency.length },
  };

  const posts = await CommunityPost.find({ status: 'PUBLISHED', kind: 'ACHIEVEMENT', publishedAt: { $gte: period.start, $lt: period.end } }).sort({ publishedAt: 1 }).limit(50).select('title publishedAt').lean();
  const achievements = posts.map((p) => ({ title: p.title ?? 'Achievement', at: p.publishedAt }));

  // Decisions: approvals waiting (by category; titles can name people, so they stay in the approvals inbox) and overdue or critical tasks with their owner.
  const pending = await ApprovalRequest.aggregate([{ $match: { status: 'PENDING' } }, { $group: { _id: '$category', count: { $sum: 1 }, oldestDue: { $min: '$dueAt' } } }, { $sort: { count: -1 } }]);
  const decisions = {
    approvals: pending.map((r) => ({ category: r._id, count: r.count, oldestDue: r.oldestDue ?? null })),
    actions: renewals.items.filter((i) => i.overdue || i.severity === 'CRITICAL').slice(0, 30).map((i) => ({ title: i.title, owner: i.owner, reviewBy: i.dueAt, department: i.department })),
  };

  const missing = all.filter((m) => m.coverage === 'NONE' || m.coverage === 'ERROR').map((m) => ({ key: m.key, label: m.label, note: m.note }));
  return {
    quarter: { key: quarter.key, label: quarterLabel(quarter), from: quarter.from, to: quarter.to },
    comparisons: { priorQuarter: { from: prior.from, to: prior.to }, lastYear: { from: lastYear.from, to: lastYear.to } },
    cutoff: now.toISOString(), currency: CURRENCY, timezone: calendar.tz,
    summary, sections, budget, renewals, achievements, decisions, missing,
  };
}

// ── generation ─────────────────────────────────────────────────────────

async function fill(report, quarter, now) {
  try {
    report.figures = await buildFigures(quarter, { now });
    report.status = 'GENERATED';
    report.generatedAt = new Date();
    report.error = null;
  } catch (err) {
    report.status = 'FAILED';
    report.error = String(err?.message ?? err).slice(0, 500);
    logger.error(`Quarterly report ${report.quarterKey} v${report.version} failed: ${report.error}`);
  }
  report.markModified('figures');
  await report.save();
  return report;
}

/**
 * Scheduled: version 1 of the previous quarter, once. A crashed attempt (a
 * report left GENERATING past its lease, or FAILED) is completed in place:
 * it was never a finished snapshot, so filling it is not a rewrite.
 */
export async function generateScheduled({ now = new Date() } = {}) {
  const calendar = await schoolCalendar();
  const quarter = previousQuarter(now, calendar);
  let report = await QuarterlyReport.findOne({ quarterKey: quarter.key, version: 1 });
  if (!report) {
    try {
      report = await QuarterlyReport.create({ quarterKey: quarter.key, label: quarterLabel(quarter), period: { from: quarter.from, to: quarter.to, tz: calendar.tz }, version: 1, catalogueVersion: versionHash(), trigger: 'SCHEDULED', startedAt: now });
    } catch (err) {
      if (err?.code === 11000) return { quarter: quarter.key, skipped: 'Another worker created it' };
      throw err;
    }
  } else if (report.status === 'GENERATED') {
    const delivered = await deliver(report._id, { now });
    return { quarter: quarter.key, version: 1, existing: true, ...delivered };
  } else if (report.status === 'GENERATING' && now.getTime() - new Date(report.startedAt).getTime() < GENERATING_LEASE_MS) {
    return { quarter: quarter.key, skipped: 'Generation in progress' };
  } else {
    report.startedAt = now;
    report.status = 'GENERATING';
    await report.save();
  }
  await fill(report, quarter, now);
  if (report.status !== 'GENERATED') return { quarter: quarter.key, version: report.version, status: report.status };
  await queueDeliveries(report);
  const delivered = await deliver(report._id, { now });
  return { quarter: quarter.key, version: report.version, status: report.status, ...delivered };
}

/** Manual: always a new version; earlier versions are left as they were. */
export async function regenerate(actor, body = {}, { now = new Date() } = {}) {
  const calendar = await schoolCalendar();
  const quarter = body.quarter ? quarterFromKey(body.quarter, calendar.financialYearStartMonth) : previousQuarter(now, calendar);
  const reason = optionalText(body.reason, { max: 500 }) || null;
  let report;
  for (let i = 0; i < 5 && !report; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const latest = await QuarterlyReport.findOne({ quarterKey: quarter.key }).sort({ version: -1 }).select('_id version').lean();
    try {
      // eslint-disable-next-line no-await-in-loop
      report = await QuarterlyReport.create({
        quarterKey: quarter.key, label: quarterLabel(quarter), period: { from: quarter.from, to: quarter.to, tz: calendar.tz },
        version: (latest?.version ?? 0) + 1, catalogueVersion: versionHash(), trigger: 'MANUAL', reason,
        requestedByProfileId: actor?.profileId ?? null, supersedesId: latest?._id ?? null, startedAt: now,
      });
    } catch (err) {
      if (err?.code !== 11000) throw err; // someone else took that version number; take the next
    }
  }
  if (!report) throw new AppError('Could not allocate a report version; try again.', 409);
  await fill(report, quarter, now);
  if (report.status === 'GENERATED' && body.deliver !== false) {
    await queueDeliveries(report);
    await deliver(report._id, { now });
  }
  return present(report.toObject(), sectionsFor(actor));
}

// ── recipients and delivery ────────────────────────────────────────────

/** Everyone in the school whose role can read quarterly reports, with the sections they may see. */
export async function recipients() {
  const roles = await Role.find({ 'permissions.key': 'reports.quarterly.read' }).select('key permissions').lean();
  const sectionsByRole = new Map();
  for (const r of roles) {
    const scope = r.permissions.find((p) => p.key === 'reports.quarterly.read')?.scope;
    const sections = sectionsFor({ roleKey: r.key, permissions: { 'reports.quarterly.read': scope } });
    if (sections?.length && r.key !== 'SUPER_ADMIN') sectionsByRole.set(String(r._id), { key: r.key, sections });
  }
  if (!sectionsByRole.size) return [];
  const people = await Profile.find({ tenantId: currentTenantId(), roleId: { $in: [...sectionsByRole.keys()] }, status: 'ACTIVE', deletedAt: null }).select('displayName roleId').lean();
  return people.map((p) => ({ profileId: p._id, name: p.displayName, roleKey: sectionsByRole.get(String(p.roleId)).key, sections: sectionsByRole.get(String(p.roleId)).sections }));
}

export async function queueDeliveries(report) {
  const list = await recipients();
  for (const r of list) {
    // eslint-disable-next-line no-await-in-loop -- upsert: a rerun never adds a second row for the same person
    await QuarterlyDelivery.updateOne(
      { reportId: report._id, recipientProfileId: r.profileId },
      { $setOnInsert: { reportId: report._id, recipientProfileId: r.profileId, recipientName: r.name, roleKey: r.roleKey, sections: r.sections, status: 'QUEUED' } },
      { upsert: true },
    );
  }
  return list.length;
}

/** The sending step, replaceable in tests. Returns the outbox results of sendOperational. */
let sender = (args) => sendOperational(args);
export function setQuarterlySenderForTests(fn) { sender = fn ?? ((args) => sendOperational(args)); }

const OK = ['SENT', 'SIMULATED', 'SKIPPED_NO_CONTACT', 'SKIPPED_NO_CONSENT', 'DEFERRED'];

/** Is this person still allowed to receive (read) the report? Read live from their role. */
async function stillAuthorised(profileId) {
  const p = await Profile.findOne({ _id: profileId, status: 'ACTIVE', deletedAt: null }).select('roleId').lean();
  if (!p) return null;
  const role = await Role.findById(p.roleId).select('key permissions').lean();
  const scope = role?.permissions?.find((x) => x.key === 'reports.quarterly.read')?.scope;
  return sectionsFor({ roleKey: role?.key, permissions: { 'reports.quarterly.read': scope } });
}

/**
 * Sends every QUEUED or FAILED delivery of a report (and recovers ones left
 * SENDING by a crashed worker). Each row is claimed atomically, so two workers
 * never send the same row; a row already SENT is never touched.
 */
export async function deliver(reportId, { now = new Date() } = {}) {
  const report = await QuarterlyReport.findById(reportId).select('quarterKey label version status').lean();
  if (!report || report.status !== 'GENERATED') return { sent: 0, failed: 0, revoked: 0 };
  const rows = await QuarterlyDelivery.find({ reportId, status: { $in: ['QUEUED', 'FAILED', 'SENDING'] }, attempts: { $lt: MAX_ATTEMPTS } }).select('_id').lean();
  let sent = 0; let failed = 0; let revoked = 0;
  for (const { _id } of rows) {
    /* eslint-disable no-await-in-loop -- one recipient at a time */
    const row = await QuarterlyDelivery.findOneAndUpdate(
      { _id, $or: [{ status: { $in: ['QUEUED', 'FAILED'] } }, { status: 'SENDING', claimedAt: { $lt: new Date(now.getTime() - SENDING_LEASE_MS) } }] },
      { $set: { status: 'SENDING', claimedAt: now } },
      { new: true },
    );
    if (!row) continue;
    const sections = await stillAuthorised(row.recipientProfileId);
    if (!sections?.length) {
      row.status = 'REVOKED'; row.lastError = 'The recipient no longer holds reports.quarterly.read'; row.claimedAt = null;
      await row.save(); revoked += 1; continue;
    }
    // A crashed worker may have sent its last attempt already: that attempt's outbox row is the receipt.
    const keyOf = (n) => `qreport:${reportId}:${row.recipientProfileId}:a${n}`;
    const prior = row.attempts > 0 ? await MessageOutbox.findOne({ idempotencyKey: keyOf(row.attempts) }).select('status channel').lean() : null;
    let results;
    if (prior && OK.includes(prior.status)) results = [{ status: prior.status, channel: prior.channel, recovered: true }];
    else {
      // The attempt number is saved before sending, so a crash mid-send is recognised on recovery.
      await QuarterlyDelivery.updateOne({ _id: row._id }, { $inc: { attempts: 1 } });
      row.attempts += 1;
      try {
        results = await sender({
          templateKey: 'QUARTERLY_REPORT_READY', recipientProfileIds: [String(row.recipientProfileId)], channels: ['EMAIL'],
          variables: { quarter: report.label, version: report.version },
          link: `/reports?id=${reportId}`, idempotencyKey: keyOf(row.attempts),
          relatedEntityType: 'QuarterlyReport', relatedEntityId: reportId, now,
        });
      } catch (err) {
        results = [{ status: 'FAILED', error: String(err?.message ?? err) }];
      }
    }
    const statuses = (results ?? []).map((r) => r.status);
    const good = statuses.length > 0 && statuses.every((s) => OK.includes(s));
    row.channels.push(...(results ?? []).map((r) => ({ channel: r.channel ?? 'EMAIL', status: r.status, at: now })));
    row.status = good ? 'SENT' : 'FAILED';
    row.sentAt = good ? now : null;
    row.lastError = good ? null : (results?.find((r) => r.error)?.error ?? `Delivery status ${statuses.join(', ') || 'none'}`);
    row.claimedAt = null;
    await row.save();
    if (good) sent += 1; else failed += 1;
    /* eslint-enable no-await-in-loop */
  }
  return { sent, failed, revoked };
}

/** Manual retry of failed deliveries (reports.quarterly.manage). */
export async function retryDeliveries(actor, id, { now = new Date() } = {}) {
  const report = await QuarterlyReport.findById(assertObjectId(id)).lean();
  if (!report) throw new AppError('Report not found', 404);
  // Recipients who gained the authority since are added; existing rows are untouched.
  if (report.status === 'GENERATED') await queueDeliveries(report);
  return deliver(report._id, { now });
}

export async function deliveries(actor, id) {
  const report = await QuarterlyReport.findById(assertObjectId(id)).select('_id').lean();
  if (!report) throw new AppError('Report not found', 404);
  const rows = await QuarterlyDelivery.find({ reportId: report._id }).sort({ recipientName: 1 }).lean();
  return rows.map((r) => ({ ...dto(r), channels: r.channels }));
}

// ── reading ────────────────────────────────────────────────────────────

/** Strips a report to the sections a reader may see. */
export function present(report, sections) {
  const out = dto(report);
  if (!out.figures) return out;
  const allow = new Set(sections ?? []);
  const f = out.figures;
  out.figures = {
    quarter: f.quarter, comparisons: f.comparisons, cutoff: f.cutoff, currency: f.currency, timezone: f.timezone,
    summary: allow.has('summary') ? f.summary : null,
    sections: (f.sections ?? []).filter((s) => allow.has(s.key)),
    budget: allow.has('budget') ? f.budget : null,
    renewals: allow.has('renewals') ? f.renewals : null,
    achievements: allow.has('achievements') ? f.achievements : null,
    decisions: allow.has('decisions') ? f.decisions : null,
    missing: allow.has('missing') ? f.missing : (f.missing ?? []).filter((m) => (f.sections ?? []).some((s) => allow.has(s.key) && s.metrics.some((x) => x.key === m.key))),
  };
  out.sectionsShown = [...allow];
  return out;
}

function readerSections(actor) {
  const sections = sectionsFor(actor);
  if (!sections?.length) throw new AppError('You are not a recipient of quarterly reports.', 403, [], 'NOT_A_RECIPIENT');
  return sections;
}

export async function list(actor, query = {}) {
  readerSections(actor);
  const { page, pageSize, skip } = pageArgs(query);
  const [rows, total] = await Promise.all([
    QuarterlyReport.find({}).sort({ 'period.from': -1, version: -1 }).skip(skip).limit(pageSize).select('-figures').lean(),
    QuarterlyReport.countDocuments({}),
  ]);
  const latest = new Map();
  for (const r of rows) if (!latest.has(r.quarterKey) || latest.get(r.quarterKey) < r.version) latest.set(r.quarterKey, r.version);
  return { items: rows.map((r) => ({ ...dto(r), latest: latest.get(r.quarterKey) === r.version })), total, page, pageSize };
}

/** One report, filtered to what the reader may see now (authority re-checked on every read). */
export async function get(actor, id) {
  const sections = readerSections(actor);
  const report = await QuarterlyReport.findById(assertObjectId(id)).lean();
  if (!report) throw new AppError('Report not found', 404);
  return present(report, sections);
}

const valueText = (v, unit, currency) => {
  if (v === null || v === undefined) return 'not available';
  if (unit === 'paise') return `${currency ?? CURRENCY} ${(v / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (unit === 'percent') return `${v}%`;
  if (unit === 'days') return `${v} days`;
  return String(v);
};
const changeText = (c) => (!c ? '' : c.comparable ? `${c.pct > 0 ? '+' : ''}${c.pct}%` : 'not comparable');
export { valueText, changeText };

/** CSV of a report version, filtered to the reader's sections. */
export async function csv(actor, id) {
  const r = await get(actor, id);
  if (r.status !== 'GENERATED') throw new AppError('This report version has no figures.', 409, [], 'NOT_GENERATED');
  const f = r.figures;
  const rows = [['report', 'version', 'quarter_from', 'quarter_to', 'cutoff', 'section', 'metric_key', 'label', 'unit', 'currency', 'value', 'coverage', 'prior_quarter_value', 'prior_quarter_change_pct', 'last_year_value', 'last_year_change_pct', 'note', 'definition', 'metric_version']];
  const add = (section, m) => rows.push([r.quarterKey, r.version, f.quarter.from, f.quarter.to, f.cutoff, section, m.key, m.label, m.unit, m.currency, m.value, m.coverage, m.priorQuarter?.value, m.priorQuarter?.change?.comparable ? m.priorQuarter.change.pct : 'not comparable', m.lastYear?.value, m.lastYear?.change?.comparable ? m.lastYear.change.pct : 'not comparable', m.note, m.definition, m.version]);
  for (const m of f.summary ?? []) add('summary', m);
  for (const s of f.sections) for (const m of s.metrics) add(s.key, m);
  if (f.budget) for (const l of f.budget.lines) rows.push([r.quarterKey, r.version, f.quarter.from, f.quarter.to, f.cutoff, 'budget', l.code, `${l.budget}: ${l.head}`, 'paise', f.budget.currency, l.actualPaise, 'FULL', '', '', '', '', `planned ${l.plannedPaise}; committed ${l.committedPaise}; variance ${l.variancePaise}`, f.budget.basis, '']);
  return { filename: `quarterly-${r.quarterKey}-v${r.version}.csv`, body: toCsv(rows) };
}

/** The report for the PDF renderer (filtered the same way). */
export async function forPdf(actor, id) {
  const r = await get(actor, id);
  if (r.status !== 'GENERATED') throw new AppError('This report version has no figures.', 409, [], 'NOT_GENERATED');
  return r;
}
