/**
 * The calculation helper: every figure the assistant states that is not read
 * straight off a record is computed HERE, by code, never by the model.
 *
 * Sums, averages, percentages, differences, rates and weighted means each go
 * through one function that returns the value AND records how it was made --
 * the operation, the inputs (with where each came from) and the rounding --
 * in a ledger. The ledger travels with the tool result (`data.calculations`),
 * and the verification engine (agent/verify.js) accepts a figure in a reply
 * only when it is on a record, or in a ledger entry of this turn: the
 * provenance of every number is kept, per figure.
 *
 * Deliberately small and dependency-free: the guarantee is architectural
 * (numbers come from code and are checked on the way out), not a library.
 */

const round = (n, dp = 2) => {
  if (!Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
};

const finite = (values) => (values ?? []).map(Number).filter((v) => Number.isFinite(v));

/** A ledger of calculations for one answer. */
export function createLedger(prefix = 'calc') {
  const entries = [];
  const record = (op, inputs, value, { label = null, dp = 2, formula = null } = {}) => {
    const rounded = value == null ? null : round(value, dp);
    entries.push({
      id: `${prefix}-${entries.length + 1}`,
      op,
      label,
      inputs: inputs.map((i) => (typeof i === 'object' && i !== null ? i : { value: i })),
      value: rounded,
      ...(formula && { formula }),
    });
    return rounded;
  };

  return {
    entries,
    /** Σ values. */
    sum(values, opts = {}) {
      const v = finite(values.map((x) => (typeof x === 'object' ? x?.value : x)));
      return record('sum', values, v.reduce((a, b) => a + b, 0), opts);
    },
    /** Arithmetic mean, or null with nothing to average. */
    mean(values, opts = {}) {
      const v = finite(values.map((x) => (typeof x === 'object' ? x?.value : x)));
      return record('mean', values, v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, opts);
    },
    /** part / whole × 100, or null when the whole is 0. */
    pct(part, whole, opts = {}) {
      const p = Number(typeof part === 'object' ? part?.value : part);
      const w = Number(typeof whole === 'object' ? whole?.value : whole);
      return record('percentage', [part, whole], Number.isFinite(p) && Number.isFinite(w) && w !== 0 ? (p / w) * 100 : null, opts);
    },
    /** a − b. */
    diff(a, b, opts = {}) {
      const x = Number(typeof a === 'object' ? a?.value : a);
      const y = Number(typeof b === 'object' ? b?.value : b);
      return record('difference', [a, b], Number.isFinite(x) && Number.isFinite(y) ? x - y : null, opts);
    },
    /** Population standard deviation, or null with fewer than two values. */
    stdev(values, opts = {}) {
      const v = finite(values.map((x) => (typeof x === 'object' ? x?.value : x)));
      if (v.length < 2) return record('stdev', values, null, opts);
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      return record('stdev', values, Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length), opts);
    },
    /** Σ(wᵢ·sᵢ) / Σwᵢ over the parts that have a score: the renormalised weighted mean. */
    weightedMean(parts, opts = {}) {
      const usable = parts.filter((p) => p.score != null && Number.isFinite(Number(p.score)) && Number(p.weight) > 0);
      const totalWeight = usable.reduce((a, p) => a + Number(p.weight), 0);
      const value = totalWeight ? usable.reduce((a, p) => a + Number(p.weight) * Number(p.score), 0) / totalWeight : null;
      return record('weighted_mean', usable.map((p) => ({ label: p.label ?? p.key, weight: p.weight, value: p.score })), value, opts);
    },
    /** A value held inside [lo, hi]. */
    clamp(value, lo, hi, opts = {}) {
      const v = Number(typeof value === 'object' ? value?.value : value);
      return record('clamp', [value, lo, hi], Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null, opts);
    },
    /** A linear map a·x + b (used by a metric's documented formula). */
    linear(x, a, b, opts = {}) {
      const v = Number(typeof x === 'object' ? x?.value : x);
      return record('linear', [x, a, b], Number.isFinite(v) ? a * v + b : null, opts);
    },
    /** Every value the ledger produced (the figures a reply may state). */
    values() {
      return entries.map((e) => e.value).filter((v) => v != null);
    },
  };
}

/** Plain helpers for code that needs a figure without a ledger (still deterministic). */
export const calc = {
  round,
  pct: (part, whole, dp = 2) => (whole ? round((part / whole) * 100, dp) : null),
  mean: (values, dp = 2) => { const v = finite(values); return v.length ? round(v.reduce((a, b) => a + b, 0) / v.length, dp) : null; },
  sum: (values) => finite(values).reduce((a, b) => a + b, 0),
  diff: (a, b, dp = 2) => (Number.isFinite(a) && Number.isFinite(b) ? round(a - b, dp) : null),
};
