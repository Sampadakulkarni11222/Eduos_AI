/**
 * The metric catalogue: one definition per figure the analytics workspace,
 * its exports and the quarterly reports show.
 *
 * A metric is registered once, with a stable key, and every screen, CSV and
 * report reads it through here, so the same number agrees everywhere. Each
 * definition says what it counts (definition, numerator/denominator), on
 * which date (dateBasis), from which records (sources), whether it is a flow
 * over the period or a point-in-time count at its end (kind), and its version.
 * Changing what a metric means bumps its version, which changes every cache
 * key and is stamped on every quarterly snapshot, so an old report is never
 * silently recomputed under a new definition.
 *
 * HOW A MODULE ADDS ITS METRICS
 * -----------------------------
 * A module (labs, fleet, PTM, clubs, sustainability, bills...) registers its
 * own metrics from a file of its own, e.g. `modules/labs/labs.metrics.js`:
 *
 *   import { registerMetric } from '../analytics/catalogue.js';
 *   registerMetric({
 *     key: 'labs.stock_expired', department: 'labs', label: 'Expired stock lines',
 *     definition: '...', unit: 'count', kind: 'stock', dateBasis: 'expiry date as of the period end',
 *     sources: ['LabStockItem'], link: '/labs', version: 1,
 *     since: () => earliest(LabStockItem, 'createdAt'),
 *     compute: async (ctx) => ({ value, records }),
 *   });
 *
 * and adds one import line to `modules/analytics/metrics/index.js` (the
 * registration point). A department the catalogue does not list yet is added
 * to DEPARTMENTS below together with the roles that see it at OWN scope
 * (analytics.scope.js). Nothing else changes: the overview, the CSV export
 * and the quarterly reports pick the metric up automatically.
 *
 * compute(ctx) receives:
 *   ctx.period   { start, end, from, to, days, tz }  half-open [start, end)
 *   ctx.scope    { all: boolean, sectionIds: string[] | null }  (null = no class restriction)
 *   ctx.now      the request time (a period never extends past it)
 *   ctx.memo(key, fn)  per-request memo, so metrics can share a query
 * and returns { value: number | null, records: number, detail?: object,
 * breakdown?: [{ label, value }], note?: string }. Money is integer paise
 * with ctx.currency; a null value means "not available", never zero.
 */

/** Workspace departments, in the order the tabs show them. */
export const DEPARTMENTS = [
  { key: 'admissions', label: 'Students & admissions' },
  { key: 'academics', label: 'Academics' },
  { key: 'finance', label: 'Finance' },
  { key: 'procurement', label: 'Procurement' },
  { key: 'people', label: 'People' },
  { key: 'facilities', label: 'Facilities & compliance' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'services', label: 'Library, hostel & transport' },
  // Planned departments register here when their modules land:
  // { key: 'labs', ... }, { key: 'fleet', ... }, { key: 'sustainability', ... }
];

export const UNITS = ['count', 'percent', 'paise', 'days'];
export const KINDS = ['flow', 'stock'];

const registry = new Map();

/**
 * Adds a metric to the catalogue. Throws on a malformed or duplicate
 * definition, so a mistake fails at boot (and in tests), not on a screen.
 */
export function registerMetric(def) {
  const required = ['key', 'department', 'label', 'definition', 'unit', 'kind', 'dateBasis', 'sources', 'compute'];
  for (const f of required) if (def[f] === undefined || def[f] === null) throw new Error(`Metric ${def.key ?? '?'} is missing ${f}`);
  if (!/^[a-z]+(\.[a-z0-9_]+)+$/.test(def.key)) throw new Error(`Metric key ${def.key} must look like department.name`);
  if (!UNITS.includes(def.unit)) throw new Error(`Metric ${def.key}: unknown unit ${def.unit}`);
  if (!KINDS.includes(def.kind)) throw new Error(`Metric ${def.key}: unknown kind ${def.kind}`);
  if (!DEPARTMENTS.some((d) => d.key === def.department)) throw new Error(`Metric ${def.key}: unknown department ${def.department}`);
  if (registry.has(def.key)) throw new Error(`Metric ${def.key} is already registered`);
  registry.set(def.key, {
    version: 1, headline: false, trend: false, currentOnly: false, scopeAware: false, link: null, numerator: null, denominator: null,
    ...def,
  });
}

/** For tests that register a throwaway metric. */
export function unregisterMetric(key) { registry.delete(key); }

export function metric(key) { return registry.get(key) ?? null; }

export function metrics({ departments = null } = {}) {
  const all = [...registry.values()];
  return departments ? all.filter((m) => departments.includes(m.department)) : all;
}

/** A metric as the catalogue endpoint describes it (no functions). */
export function describe(m) {
  return {
    key: m.key, department: m.department, label: m.label, definition: m.definition,
    numerator: m.numerator, denominator: m.denominator, unit: m.unit, kind: m.kind, dateBasis: m.dateBasis,
    sources: m.sources, link: m.link, version: m.version, headline: m.headline, trend: m.trend,
    currentOnly: m.currentOnly,
    history: m.currentOnly ? 'Current state only: the records keep no history, so past periods show "not available".' : 'From the dated source records.',
    scope: m.scopeAware ? 'Restricted to your own classes at OWN scope.' : 'Whole school (department heads see their own department).',
  };
}

/** One fingerprint of every definition in use, for cache keys and report snapshots. */
export function catalogueVersion(list = metrics()) {
  return list.map((m) => `${m.key}@${m.version}`).sort().join(',');
}

/** Short, stable hash of the catalogue version string (for cache keys and snapshot labels). */
export function versionHash(list = metrics()) {
  let h = 2166136261;
  for (const ch of catalogueVersion(list)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
