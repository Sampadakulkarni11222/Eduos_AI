import { InstitutionProfile } from '../../models/institution.model.js';
import { AppError } from '../../utils/AppError.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { resolvePeriod, comparisonPeriod, change, buckets, localDate, DEFAULT_TZ } from '../../utils/periods.js';
import { shortCache } from '../../utils/shortCache.js';
import { DEPARTMENTS, metrics, describe, versionHash } from './catalogue.js';
import { resolveScope, departmentsFor } from './analytics.scope.js';
import './metrics/index.js';

/**
 * The analytics workspace: every catalogue metric for a period and its
 * comparison, with trend buckets, record counts, freshness and coverage.
 *
 * Coverage is explicit. A metric whose records begin after the period ends is
 * "not available" (value null), not zero; one whose records begin inside the
 * period is "partial"; a metric that keeps only its current state cannot be
 * shown for a past period. A comparison against a missing or zero baseline is
 * reported as not comparable (utils/periods.js change()).
 */

export const CURRENCY = 'INR';
export const ANALYTICS_CACHE_MS = Number(process.env.ANALYTICS_CACHE_MS ?? (process.env.NODE_ENV === 'test' ? 0 : 60_000));
const MAX_BUCKETS = 120;

/** The school's calendar: time zone and the months its academic and financial years start. */
export async function schoolCalendar() {
  const p = await InstitutionProfile.findOne({}).select('academicYearStartMonth financialYearStartMonth campuses.timezone').lean();
  return {
    tz: p?.campuses?.[0]?.timezone || DEFAULT_TZ,
    academicYearStartMonth: p?.academicYearStartMonth ?? 4,
    financialYearStartMonth: p?.financialYearStartMonth ?? 4,
  };
}

/** A per-request evaluation context (see catalogue.js for what metrics receive). */
export function makeContext({ period, scope, calendar, now, memo = new Map() }) {
  return {
    period, scope, now, currency: CURRENCY, tz: calendar.tz, fyStartMonth: calendar.financialYearStartMonth,
    memo: (key, fn) => { if (!memo.has(key)) memo.set(key, Promise.resolve().then(fn)); return memo.get(key); },
    _memo: memo,
  };
}

const ymd = (d) => `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;

/**
 * One metric for one period: { value, records, coverage, note, detail, breakdown }.
 * coverage: FULL | PARTIAL | NONE (not available) | ERROR.
 */
export async function evaluate(m, ctx) {
  const p = ctx.period;
  if (m.currentOnly) {
    // Only a period that runs to today can show a figure kept as current state.
    const today = ymd(localDate(ctx.now, ctx.tz));
    if (p.to < today) return { value: null, records: 0, coverage: 'NONE', note: 'History is not kept for this figure; only the current value is available.' };
  }
  let since = null;
  if (typeof m.since === 'function') {
    since = await m.since(ctx);
    if (!since) return { value: null, records: 0, coverage: 'NONE', note: 'No records yet.' };
    if (since >= p.end) return { value: null, records: 0, coverage: 'NONE', note: `Records begin on ${since.toISOString().slice(0, 10)}, after this period.` };
  }
  try {
    const out = await m.compute(ctx);
    const partial = since && since > p.start;
    return {
      value: out.value ?? null, records: out.records ?? 0, detail: out.detail ?? null, breakdown: out.breakdown ?? null,
      coverage: out.value === null || out.value === undefined ? 'NONE' : partial ? 'PARTIAL' : 'FULL',
      note: [partial ? `Records begin on ${since.toISOString().slice(0, 10)}, part-way through this period.` : null, out.note ?? null].filter(Boolean).join(' ') || null,
    };
  } catch (err) {
    return { value: null, records: 0, coverage: 'ERROR', note: `Could not be calculated: ${String(err?.message ?? err).slice(0, 200)}` };
  }
}

async function trendOf(m, ctx) {
  const list = buckets(ctx.period);
  if (list.length > MAX_BUCKETS) return null;
  let values;
  if (typeof m.series === 'function') values = await m.series(ctx, list);
  else {
    values = [];
    for (const b of list) {
      // eslint-disable-next-line no-await-in-loop -- buckets share the request memo; sequential keeps the database calm
      const r = await evaluate(m, { ...ctx, period: b });
      values.push(r.value);
    }
  }
  return { unit: list[0]?.unit ?? 'day', points: list.map((b, i) => ({ label: b.label, from: b.from, to: b.to, value: values[i] ?? null })) };
}

function parsePeriodQuery(query, calendar, now) {
  const preset = typeof query.preset === 'string' && query.preset ? query.preset : (query.from && query.to ? 'custom' : 'month');
  const period = resolvePeriod({ preset, from: query.from, to: query.to, tz: calendar.tz, academicYearStartMonth: calendar.academicYearStartMonth, financialYearStartMonth: calendar.financialYearStartMonth, now, year: query.year });
  const today = ymd(localDate(now, calendar.tz));
  if (period.to > today) throw new AppError('The period cannot end after today.', 400, [], 'FUTURE_PERIOD');
  const mode = typeof query.compare === 'string' && query.compare ? query.compare : 'previous';
  const comparison = comparisonPeriod(period, { mode, compareFrom: query.compareFrom, compareTo: query.compareTo, years: query.years });
  return { period, comparison, mode };
}

const periodDto = (p) => (p ? { from: p.from, to: p.to, start: p.start.toISOString(), end: p.end.toISOString(), days: p.days, label: p.label, tz: p.tz, partial: p.partial ?? false } : null);

/**
 * Computes the workspace for already-resolved inputs. Used by the overview,
 * the CSV export and the quarterly reports, so all three agree.
 */
export async function computeOverview({ scope, departments, period, comparison, calendar, now = new Date(), withTrend = true, onlyHeadline = false }) {
  const memo = new Map();
  const ctx = makeContext({ period, scope, calendar, now, memo });
  const cmpCtx = comparison ? makeContext({ period: comparison, scope, calendar, now, memo }) : null;
  const list = metrics({ departments }).filter((m) => !onlyHeadline || m.headline);
  const out = [];
  for (const m of list) {
    /* eslint-disable no-await-in-loop -- metrics share the request memo */
    const cur = await evaluate(m, ctx);
    const cmp = cmpCtx ? await evaluate(m, cmpCtx) : null;
    const trend = withTrend && m.trend ? await trendOf(m, ctx) : null;
    /* eslint-enable no-await-in-loop */
    out.push({
      ...describe(m),
      currency: m.unit === 'paise' ? CURRENCY : null,
      current: cur,
      comparison: cmp,
      change: cmp ? change(cur.value, cmp.value) : null,
      trend,
    });
  }
  return out;
}

/** GET /analytics/overview */
export async function overview(actor, permissionScope, query = {}, { now = new Date() } = {}) {
  const scope = await resolveScope(actor, permissionScope);
  const department = typeof query.department === 'string' ? query.department : 'all';
  const departments = departmentsFor(scope, department);
  const calendar = await schoolCalendar();
  const { period, comparison, mode } = parsePeriodQuery(query, calendar, now);
  const version = versionHash();
  const key = [
    'analytics', currentTenantId(), scope.level, actor.roleKey, scope.level === 'OWN' ? actor.profileId : '', (scope.sectionIds ?? []).join('.'),
    department, period.from, period.to, comparison?.from ?? '', comparison?.to ?? '', mode, version,
  ].join('|');
  return shortCache(key, ANALYTICS_CACHE_MS, async () => {
    const onlyHeadline = department === 'all' || department === 'overview';
    const list = await computeOverview({ scope, departments, period, comparison, calendar, now, onlyHeadline });
    return {
      period: periodDto(period), comparison: periodDto(comparison), compare: mode,
      department, currency: CURRENCY,
      departments: DEPARTMENTS.filter((d) => scope.departments.includes(d.key)),
      scope: { level: scope.level, departments: scope.departments, classes: scope.sectionIds ? scope.sectionIds.length : null },
      metrics: list,
      computedAt: now.toISOString(),
      cutoff: new Date(Math.min(period.end.getTime(), now.getTime())).toISOString(),
      catalogueVersion: version,
      freshness: `Figures are computed from the live records at ${now.toISOString()} and kept for at most ${Math.round(ANALYTICS_CACHE_MS / 1000)} seconds.`,
    };
  });
}

/** GET /analytics/catalogue */
export async function catalogue(actor, permissionScope) {
  const scope = await resolveScope(actor, permissionScope);
  return {
    version: versionHash(),
    departments: DEPARTMENTS.filter((d) => scope.departments.includes(d.key)),
    metrics: metrics({ departments: scope.departments }).map(describe),
    scope: { level: scope.level, departments: scope.departments },
  };
}

// ── export ─────────────────────────────────────────────────────────────

/** A spreadsheet cell: strings that a spreadsheet would run as a formula are prefixed with '. */
export function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (rows) => `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

/** Rows for a CSV of a computed overview: one per metric, then one per breakdown item. */
export function overviewRows(data) {
  const head = ['metric_key', 'label', 'department', 'unit', 'currency', 'period_from', 'period_to', 'value', 'comparison_from', 'comparison_to', 'comparison_value', 'change_abs', 'change_pct', 'comparable', 'not_comparable_reason', 'records', 'coverage', 'note', 'definition', 'version', 'breakdown_label', 'breakdown_value'];
  const rows = [head];
  for (const m of data.metrics) {
    const base = [m.key, m.label, m.department, m.unit, m.currency, data.period.from, data.period.to, m.current.value, data.comparison?.from, data.comparison?.to, m.comparison?.value, m.change?.abs, m.change?.pct, m.change ? (m.change.comparable ? 'yes' : 'no') : '', m.change?.reason, m.current.records, m.current.coverage, m.current.note, m.definition, m.version];
    rows.push([...base, '', '']);
    for (const b of m.current.breakdown ?? []) rows.push([m.key, m.label, m.department, m.unit, m.currency, data.period.from, data.period.to, '', '', '', '', '', '', '', '', '', '', '', '', m.version, b.label, b.value]);
  }
  return rows;
}

/** GET /analytics/export.csv — the same scope and figures as the screen, every metric of the chosen department(s). */
export async function exportCsv(actor, permissionScope, query = {}, { now = new Date() } = {}) {
  const scope = await resolveScope(actor, permissionScope);
  const department = typeof query.department === 'string' ? query.department : 'all';
  const departments = departmentsFor(scope, department);
  const calendar = await schoolCalendar();
  const { period, comparison } = parsePeriodQuery(query, calendar, now);
  const list = await computeOverview({ scope, departments, period, comparison, calendar, now, withTrend: false });
  const data = { period: periodDto(period), comparison: periodDto(comparison), metrics: list };
  return { filename: `analytics-${department}-${period.from}-to-${period.to}.csv`, body: toCsv(overviewRows(data)) };
}
