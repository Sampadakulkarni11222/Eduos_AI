import { el, toLang, safeHref } from './lang.js';

/**
 * The deterministic generator: an assistant answer's tool results laid out as
 * a panel, by code, with no model.
 *
 * Input is what the orchestrator already returned to this person (`data` --
 * one result's data, or `[{ tool, data }]` for several -- and the "Based on"
 * evidence), so the panel can never show a record the text answer could not.
 * Even so, fields that read as identifiers or personal/restricted details are
 * never laid out (DENY below): a panel is a summary, not a record dump.
 *
 * What it builds, from the shape of the data alone:
 *   top-level numbers           -> KPI tiles (unit from the field name)
 *   a list of rows              -> a bar or line chart when the rows have a
 *                                  label and a figure, a timeline when they are
 *                                  dated, a record list when they carry links,
 *                                  else (and alongside the chart) a table
 *   the evidence                -> the "Based on" footer, with links
 * Nothing is computed that the data does not state: no totals, no averages.
 */

const DENY = /(^_|(^|_)id$|Id$|Ids$|token|secret|password|phone|mobile|email|address|dob|birth|medical|health|diagnos|allerg|medicine|safeguard|payroll|salary|bank|aadhaar|ifsc|otp|^pan$|camera|guardian|password)/i;
const LABEL_KEYS = ['class', 'className', 'name', 'title', 'label', 'student', 'studentName', 'subject', 'month', 'period', 'metric', 'book', 'room', 'route', 'item', 'category', 'department', 'status', 'date'];
const DATE_KEYS = /(^date$|^at$|At$|On$|^on$|^due|^when|^day$|Date$)/;
const MAX_KPIS = 6; const MAX_COLS = 6; const MAX_ROWS = 50; const MAX_CHART = 24; const MAX_TIMELINE = 30;

/** "totalCollectedPaise" -> "Total collected", "pctPresent" -> "Present %". */
export function labelOf(key) {
  let k = String(key);
  if (/^[A-Z][A-Z0-9_]*$/.test(k)) k = k.toLowerCase();
  const pct = /^pct|Pct$|Percent$|^percent/i.test(k);
  k = k.replace(/Paise$|^pct|Pct$|Percent$|^percent/gi, '');
  const words = k.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().toLowerCase();
  const text = words ? words[0].toUpperCase() + words.slice(1) : String(key);
  return pct ? `${text} %` : text;
}

/** The unit a field holds, read from its name. */
export function unitOf(key) {
  const k = String(key);
  if (/Paise$/i.test(k) || /^amount|Amount$/.test(k)) return /Paise$/i.test(k) ? 'paise' : 'count';
  if (/pct|percent|rate$|Rate$/i.test(k)) return 'percent';
  if (/days$|Days$/.test(k)) return 'days';
  return 'count';
}

const isScalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const isRowList = (v) => Array.isArray(v) && v.length > 0 && v.every((r) => r && typeof r === 'object' && !Array.isArray(r));
const isMonthLabel = (s) => /^\d{4}-\d{2}$/.test(String(s)) || /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(String(s));
const looksDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s);
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthText = (s) => { const m = /^(\d{4})-(\d{2})$/.exec(String(s)); return m ? `${SHORT[Number(m[2]) - 1]} ${m[1]}` : String(s); };
const cellOf = (v) => (v === null || v === undefined ? null : typeof v === 'number' ? (Number.isFinite(v) ? v : null) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : typeof v === 'string' ? v.slice(0, 200) : null);
const shown = (k) => !DENY.test(k);

/** Picks the columns of a row list worth showing, label first. */
function columnsOf(rows) {
  const keys = [];
  for (const r of rows.slice(0, 8)) for (const [k, v] of Object.entries(r)) if (!keys.includes(k) && shown(k) && isScalar(v) && k !== 'link' && k !== 'href') keys.push(k);
  const label = LABEL_KEYS.find((k) => keys.includes(k) && rows.some((r) => typeof r[k] === 'string')) ?? keys.find((k) => rows.every((r) => typeof r[k] === 'string')) ?? null;
  const numeric = keys.filter((k) => rows.some((r) => typeof r[k] === 'number'));
  const metric = numeric.find((k) => unitOf(k) === 'percent') ?? numeric.find((k) => /paise|amount|total|count|value|score|marks/i.test(k)) ?? numeric[0] ?? null;
  const ordered = [label, metric, ...keys.filter((k) => k !== label && k !== metric)].filter(Boolean);
  return { label, metric, columns: ordered.slice(0, MAX_COLS) };
}

/** Blocks for one list of rows. */
function rowBlocks(title, rows, { links = true } = {}) {
  const out = [];
  const { label, metric, columns } = columnsOf(rows);
  if (!columns.length) return out;
  const dateKey = columns.find((k) => DATE_KEYS.test(k) && rows.every((r) => r[k] == null || looksDate(r[k])));
  const titleKey = label && label !== dateKey ? label : columns.find((k) => k !== dateKey && rows.some((r) => typeof r[k] === 'string'));
  const linked = links && rows.some((r) => typeof (r.link ?? r.href) === 'string' && safeHref(r.link ?? r.href));

  if (linked && titleKey) {
    out.push(el('RecordList', title, rows.slice(0, MAX_ROWS).map((r) => {
      const sub = columns.filter((k) => k !== titleKey).slice(0, 3).map((k) => (r[k] === null || r[k] === undefined ? null : `${labelOf(k)}: ${cellOf(r[k])}`)).filter(Boolean).join(' · ');
      return el('Record', String(r[titleKey] ?? '—').slice(0, 200), sub || undefined, safeHref(r.link ?? r.href) ?? undefined, typeof r.status === 'string' && titleKey !== 'status' ? r.status : undefined);
    })));
    return out;
  }

  if (dateKey && titleKey && rows.length <= MAX_TIMELINE) {
    const noteKey = columns.find((k) => k !== dateKey && k !== titleKey && rows.some((r) => typeof r[k] === 'string'));
    const events = [...rows].filter((r) => looksDate(r[dateKey])).sort((a, b) => String(a[dateKey]).localeCompare(String(b[dateKey])));
    if (events.length >= 2) {
      out.push(el('Timeline', title, events.map((r) => el('Event', String(r[dateKey]).slice(0, 25), String(r[titleKey]).slice(0, 200), noteKey && r[noteKey] ? String(r[noteKey]).slice(0, 200) : undefined))));
      if (columns.length <= 3) return out;
    }
  }

  if (label && metric && rows.length >= 2 && rows.length <= MAX_CHART && label !== metric) {
    const labels = rows.map((r) => (isMonthLabel(r[label]) ? monthText(r[label]) : String(r[label] ?? '—').slice(0, 40)));
    const values = rows.map((r) => (typeof r[metric] === 'number' && Number.isFinite(r[metric]) ? r[metric] : null));
    const trend = rows.every((r) => isMonthLabel(r[label]) || looksDate(r[label]));
    out.push(el(trend ? 'LineChart' : 'BarChart', `${title}: ${labelOf(metric)}`, labels, [el('Series', labelOf(metric), values)], unitOf(metric)));
  }

  const units = columns.map((k) => (rows.some((r) => typeof r[k] === 'number') ? unitOf(k) : null));
  out.push(el('Table', title, columns.map(labelOf), rows.slice(0, MAX_ROWS).map((r) => columns.map((k) => cellOf(isMonthLabel(r[k]) && k === label ? monthText(r[k]) : r[k]))), units));
  if (rows.length > MAX_ROWS) out.push(el('Callout', 'info', `Showing the first ${MAX_ROWS} of ${rows.length} rows. The full list is in the answer text and on the page linked below.`));
  return out;
}

/** Blocks for one tool's data. */
export function blocksFor(title, data) {
  if (data === null || data === undefined) return [];
  if (isRowList(data)) return rowBlocks(title, data);
  if (typeof data !== 'object' || Array.isArray(data)) return [];
  const out = [];
  const kpis = Object.entries(data)
    .filter(([k, v]) => shown(k) && typeof v === 'number' && Number.isFinite(v))
    .slice(0, MAX_KPIS)
    .map(([k, v]) => el('Kpi', labelOf(k), v, unitOf(k)));
  out.push(...kpis);
  // Labelled figures already formatted by the tool ("planned": "₹30,00,000") read as KPIs too.
  let lists = 0;
  const seen = new Set();
  for (const [k, v] of Object.entries(data)) {
    if (!shown(k)) continue;
    if (isRowList(v) && lists < 3) {
      // The same rows in another order ("classes" and "ranked") are shown once.
      const sig = JSON.stringify(v.map((r) => JSON.stringify(Object.entries(r).sort())).sort());
      if (seen.has(sig)) continue;
      seen.add(sig);
      lists += 1; out.push(...rowBlocks(labelOf(k) === 'Data' ? title : labelOf(k), v)); continue;
    }
    if (v && typeof v === 'object' && !Array.isArray(v) && !lists && !kpis.length) {
      // One nested summary object ({ total: {...} }): its numbers are the headline.
      const inner = Object.entries(v).filter(([ik, iv]) => shown(ik) && typeof iv === 'number' && Number.isFinite(iv)).slice(0, MAX_KPIS);
      out.push(...inner.map(([ik, iv]) => el('Kpi', labelOf(ik), iv, unitOf(ik))));
    }
  }
  const note = typeof data.note === 'string' ? data.note : typeof data.definition === 'string' ? data.definition : null;
  if (out.length && note) out.push(el('Callout', 'info', note.slice(0, 400)));
  return out;
}

/** The subtitle a result states about itself ("1 Oct 2026 to 15 Oct 2026"). */
function periodOf(data) {
  const p = data && !Array.isArray(data) && typeof data === 'object' ? data.period : null;
  if (typeof p === 'string') return p;
  if (p && typeof p === 'object') return p.label ?? (p.from && p.to ? `${p.from} to ${p.to}` : null);
  return null;
}

const toolTitle = (name) => {
  const words = String(name ?? '').replace(/^(get|list|find|search|show|read|view|my)_/, '').replace(/_/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'School records';
};

/** The "Based on" footer from the orchestrator's evidence list. */
export function evidenceBlock(evidence = []) {
  const items = (evidence ?? []).filter((e) => e?.text).slice(0, 8).map((e) => el('Source', String(e.text).slice(0, 200), safeHref(e.link) ?? undefined));
  return items.length ? el('Evidence', items) : null;
}

/**
 * The panel for an assistant answer, as an OpenUI Lang program, or null when
 * the answer holds nothing a panel would add (a sentence, a refusal, a write).
 */
export function programForAnswer(out) {
  if (!out || out.action || out.refused || out.executed || out.data === undefined || out.data === null) return null;
  const parts = Array.isArray(out.data) && (out.tools?.length ?? 0) > 1 && out.data.every((d) => d && typeof d === 'object' && 'tool' in d)
    ? out.data
    : [{ tool: out.tool, data: out.data }];
  // A tool that already built a panel with this pipeline (build_dashboard_panel) hands it over as is.
  if (parts.length === 1 && parts[0].data?.panel?.format === 'openui-lang' && typeof parts[0].data.panel.program === 'string') {
    return parts[0].data.panel.program;
  }
  const children = [];
  for (const p of parts) {
    const blocks = blocksFor(toolTitle(p.tool), p.data);
    if (blocks.length && parts.length > 1) children.push(el('Callout', 'info', toolTitle(p.tool)));
    children.push(...blocks);
  }
  if (!children.length) return null;
  if (out.continuation) children.push(el('Callout', 'info', 'This is part of a longer list: use "Load more" under the answer for the next rows.'));
  const ev = evidenceBlock(out.evidence);
  if (ev) children.push(ev);
  const title = parts.length === 1 ? toolTitle(parts[0].tool) : 'Your answer';
  const sub = parts.length === 1 ? periodOf(parts[0].data) : null;
  return toLang(el('Panel', title, children, sub ?? undefined));
}
