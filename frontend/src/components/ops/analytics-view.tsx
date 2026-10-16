'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, EmptyState, Field, Modal, Select, useToast } from '@/components/ui';
import { analyticsApi, savedViewsApi, type SavedViewDto, type MetricDto, type OverviewDto, type OverviewQuery, type ReportDto, type ReportMetric, type ReportSummaryDto, type TrendDto } from '@/lib/analytics-api';
import { usePermissions } from '@/lib/permissions';
import { useMaybeAuth } from '@/lib/auth';
import type { DashChartDto, DashUnit } from '@/lib/dashboard-api';
import { DashChart, Sparkline } from './dash-charts';
import { usePortalPage } from '@/lib/school-path';
import { AskDashboard } from '@/components/genui/ask-dashboard';
import { DataNote, ErrorNote, Loadable, SectionCard, StatusPill, Tabs, fmtDate, fmtDateTime, humanize, isoDay, money, useAction, useLoad, useQueryParam } from './kit';

/**
 * The analytics workspace: one period and one comparison for the whole page,
 * an overview of headline figures, then a tab per department the reader may
 * see. Every card says what it counts (tap "i"), how it compares, whether the
 * comparison is meaningful, and links to the records behind it. Every trend
 * has a table with the same numbers. "Not available" is never shown as zero.
 */

const PRESETS = [
  { value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' },
  { value: 'quarter', label: 'This quarter' }, { value: 'year', label: 'This calendar year' }, { value: 'academicYear', label: 'Academic year' },
  { value: 'financialYear', label: 'Financial year' }, { value: 'custom', label: 'Custom dates' },
];
const COMPARES = [
  { value: 'previous', label: 'Previous equal period' }, { value: 'lastYear', label: 'Same period last year' },
  { value: 'custom', label: 'Custom comparison' }, { value: 'none', label: 'No comparison' },
];

export function formatValue(v: number | null | undefined, unit: MetricDto['unit']): string {
  if (v === null || v === undefined) return 'Not available';
  if (unit === 'paise') return money(v);
  if (unit === 'percent') return `${v}%`;
  if (unit === 'days') return `${v} days`;
  return v.toLocaleString('en-IN');
}

export function ChangeBadge({ m }: { m: Pick<MetricDto, 'change' | 'unit'> }) {
  const c = m.change;
  if (!c) return null;
  if (!c.comparable) return <span className="an-change is-na" title={c.reason ?? undefined}>Not comparable{c.reason ? ` · ${c.reason.toLowerCase()}` : ''}</span>;
  const dir = (c.abs ?? 0) > 0 ? 'up' : (c.abs ?? 0) < 0 ? 'down' : 'flat';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';
  const abs = m.unit === 'percent' ? `${c.abs! > 0 ? '+' : ''}${Math.round(c.abs! * 10) / 10} pts` : null;
  return <span className={`an-change is-${dir}`}><span aria-hidden="true">{arrow}</span> {c.pct! > 0 ? '+' : ''}{c.pct}%{abs ? ` (${abs})` : ''}<span className="sr-only"> {dir === 'flat' ? 'no change' : dir === 'up' ? 'increase' : 'decrease'} against the comparison</span></span>;
}

/** An icon per department tile; a department added later gets the generic one. */
const DEPT_ICON: Record<string, string> = {
  admissions: '🎓', academics: '📚', finance: '₹', procurement: '🧾', people: '👥', facilities: '🏛', engagement: '💬',
  services: '🚌', labs: '🧪', fleet: '🚍', sustainability: '🌱',
};
const deptIcon = (key: string) => DEPT_ICON[key] ?? '📊';
const dashUnit = (u: MetricDto['unit']): DashUnit => u;

function MetricCard({ m, comparisonLabel, onOpen }: { m: MetricDto; comparisonLabel: string | null; onOpen?: (key: string) => void }) {
  const page = usePortalPage();
  const [open, setOpen] = useState(false);
  const href = page(m.link);
  const na = m.current.value === null;
  const trend = m.trend && typeof m.trend === 'object' ? (m.trend as TrendDto) : null;
  return (
    <article className={`an-card${na ? ' is-na' : ''}`} aria-label={m.label}>
      <div className="an-card-head">
        <h3 className="an-card-label">{m.label}</h3>
        <button type="button" className="kpi-info" aria-expanded={open} onClick={() => setOpen((v) => !v)} aria-label={`How "${m.label}" is calculated`}>i</button>
      </div>
      <div className="an-card-value">{formatValue(m.current.value, m.unit)}</div>
      {trend && <Sparkline values={trend.points.map((p) => p.value)} label={m.label} unit={dashUnit(m.unit)} />}
      {m.comparison && (
        <div className="an-card-cmp">
          <ChangeBadge m={m} />
          <span className="an-muted">{comparisonLabel ?? 'Comparison'}: {formatValue(m.comparison.value, m.unit)}</span>
        </div>
      )}
      {m.current.note && <p className="an-note">{m.current.note}</p>}
      {open && (
        <div className="kpi-def" role="note">
          <p>{m.definition}</p>
          {m.numerator && <p className="kpi-meta">Numerator: {m.numerator}{m.denominator ? ` · Denominator: ${m.denominator}` : ''}</p>}
          <p className="kpi-meta">Date basis: {m.dateBasis} · Sources: {m.sources.join(', ')} · {m.current.records} record(s) · definition v{m.version}{m.currency ? ` · ${m.currency}` : ''}</p>
          <p className="kpi-meta">{m.history}</p>
        </div>
      )}
      <div className="an-card-foot">
        {onOpen && <button type="button" className="an-open" onClick={() => onOpen(m.key)} aria-label={`Open the analysis of ${m.label}`}>Analyse <span aria-hidden="true">›</span></button>}
        {href && <Link href={href} className="an-drill">Open the records <span aria-hidden="true">→</span></Link>}
      </div>
    </article>
  );
}

/**
 * A trend line with hover readout and a table view of the same numbers. When
 * the comparison period's trend is given it is drawn underneath, dashed and
 * lighter, matched bucket by bucket.
 */
export function TrendChart({ m, trend, comparison = null, comparisonLabel = 'Comparison', big = false }: { m: MetricDto; trend: TrendDto; comparison?: TrendDto | null; comparisonLabel?: string; big?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const pts = trend.points;
  const cmp = comparison?.points ?? [];
  const W = 520; const H = big ? 220 : 160; const P = { l: 8, r: 8, t: 12, b: 24 };
  const vals = [...pts, ...cmp].map((p) => p.value).filter((v): v is number => v !== null);
  const max = m.unit === 'percent' ? 100 : Math.max(1, ...vals.map((v) => Math.abs(v))) * 1.1;
  const min = Math.min(0, ...vals);
  const x = (i: number) => P.l + (pts.length <= 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (pts.length - 1));
  const y = (v: number) => P.t + (H - P.t - P.b) * (1 - (v - min) / (max - min || 1));
  const line = pts.map((p, i) => (p.value === null ? null : `${x(i)},${y(p.value)}`)).filter(Boolean).join(' ');
  const cmpLine = cmp.slice(0, pts.length).map((p, i) => (p.value === null ? null : `${x(i)},${y(p.value)}`)).filter(Boolean).join(' ');
  const shown = hover !== null ? pts[hover] : null;
  const shownCmp = hover !== null ? cmp[hover] : null;
  return (
    <div className={`an-trend card${big ? ' is-big' : ''}`}>
      <div className="an-trend-head">
        <h3 className="an-card-label">{m.label} by {trend.unit}</h3>
        <span className="pb-readout" aria-live="polite">{shown ? <><b>{formatValue(shown.value, m.unit)}</b> {shown.label}{shownCmp ? ` · ${comparisonLabel} ${formatValue(shownCmp.value, m.unit)}` : ''}</> : `${pts.length} ${trend.unit}s`}</span>
        <button type="button" className="btn btn-soft btn-sm" aria-pressed={table} onClick={() => setTable((v) => !v)}>{table ? 'Show chart' : 'Show table'}</button>
      </div>
      {table ? (
        <div className="an-table-wrap">
          <table className="an-table">
            <caption className="sr-only">{m.label} by {trend.unit}</caption>
            <thead><tr><th scope="col">{humanize(trend.unit)}</th><th scope="col">{m.label}</th>{cmp.length > 0 && <th scope="col">{comparisonLabel}</th>}</tr></thead>
            <tbody>{pts.map((p, i) => <tr key={p.from}><th scope="row">{p.label}</th><td>{formatValue(p.value, m.unit)}</td>{cmp.length > 0 && <td>{cmp[i] ? `${formatValue(cmp[i].value, m.unit)} (${cmp[i].label})` : '—'}</td>}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="an-svg" role="img" aria-label={`${m.label}: ${pts.map((p) => `${p.label} ${formatValue(p.value, m.unit)}`).join(', ')}${cmp.length ? `. ${comparisonLabel}: ${cmp.map((p) => `${p.label} ${formatValue(p.value, m.unit)}`).join(', ')}` : ''}`}>
          {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={P.l} x2={W - P.r} y1={y(min + (max - min) * f)} y2={y(min + (max - min) * f)} className="pb-grid" />)}
          {min < 0 && <line x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} className="an-zero" />}
          {cmpLine && <polyline points={cmpLine} className="dc-compare" />}
          {line && <polyline points={line} className="an-line" />}
          {pts.map((p, i) => (
            <g key={p.from}>
              {/* A hit target wider than the mark. */}
              <rect x={x(i) - (W / Math.max(pts.length, 1)) / 2} y={0} width={W / Math.max(pts.length, 1)} height={H} fill="transparent" tabIndex={0}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} aria-label={`${p.label}: ${formatValue(p.value, m.unit)}${cmp[i] ? `; ${comparisonLabel} ${formatValue(cmp[i].value, m.unit)}` : ''}`} />
              {p.value !== null && (hover === i || pts.length <= 14) && <circle cx={x(i)} cy={y(p.value)} r={hover === i ? 5 : 3} className="an-dot" />}
            </g>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} className="an-cross" />}
          <text x={P.l} y={H - 6} className="pb-axis">{pts[0]?.label}</text>
          <text x={W - P.r} y={H - 6} className="pb-axis" textAnchor="end">{pts[pts.length - 1]?.label}</text>
        </svg>
      )}
      {cmp.length > 0 && !table && (
        <div className="dc-legend-row" aria-hidden="true"><span><i className="dc-key is-main" /> This period</span><span><i className="dc-key is-compare" /> {comparisonLabel}</span></div>
      )}
    </div>
  );
}

/** A metric's breakdown as a chart: a donut when the parts make a whole, bars otherwise. */
function breakdownChart(m: MetricDto): DashChartDto | null {
  const rows = m.current.breakdown ?? [];
  if (!rows.length) return null;
  const shares = rows.some((b) => b.of !== undefined);
  const unit: DashUnit = shares ? 'count' : m.unit === 'percent' ? 'percent' : dashUnit(m.unit);
  const whole = !shares && m.unit !== 'percent' && rows.length <= 6 && rows.every((b) => (b.value ?? 0) >= 0);
  return {
    key: `${m.key}-breakdown`, title: `${m.label}: breakdown`, type: whole ? 'donut' : 'hbar', unit, link: m.link, definition: m.definition,
    points: rows.map((b) => ({ label: humanize(b.label), value: b.value, detail: b.of !== undefined ? `of ${b.of.toLocaleString('en-IN')}` : undefined })),
    status: rows.some((b) => b.value) ? 'OK' : 'EMPTY', emptyText: 'Nothing to break down in this period.',
  };
}

function Breakdowns({ metrics }: { metrics: MetricDto[] }) {
  const charts = metrics.map(breakdownChart).filter((c): c is DashChartDto => Boolean(c));
  if (!charts.length) return null;
  return (
    <SectionCard title="Breakdowns" sub="The parts behind each figure, from the same records. Each has a table view.">
      <div className="an-breakdowns">{charts.map((c) => <DashChart key={c.key} c={c} />)}</div>
    </SectionCard>
  );
}

/** Searchable list of every measure in the reader's scope; choosing one opens its analysis. */
function MetricPicker({ options, onPick }: { options: Array<{ key: string; label: string; department: string; deptLabel: string }>; onPick: (o: { key: string; department: string }) => void }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const id = 'an-picker';
  const q = text.trim().toLowerCase();
  const matches = q ? options.filter((o) => `${o.label} ${o.deptLabel} ${o.key}`.toLowerCase().includes(q)).slice(0, 8) : [];
  return (
    <div className="an-picker">
      <label htmlFor={id} className="an-picker-label">Find a measure</label>
      <input id={id} className="input" type="search" role="combobox" aria-autocomplete="list" placeholder="Search, e.g. attendance, fees, enquiries" value={text} autoComplete="off"
        aria-controls={`${id}-list`} aria-expanded={open && matches.length > 0}
        onKeyDown={(e) => { if (e.key === 'Escape') { setText(''); setOpen(false); } }}
        onChange={(e) => { setText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {open && q && (
        <ul id={`${id}-list`} className="an-picker-list" aria-label="Matching measures">
          {!matches.length ? <li className="an-muted an-picker-none">No measure matches “{text}”.</li> : matches.map((o) => (
            <li key={o.key}>
              <button type="button" className="an-picker-item" onClick={() => { onPick(o); setText(''); setOpen(false); }}>
                <span aria-hidden="true">{deptIcon(o.department)}</span> <b>{o.label}</b> <span className="an-muted">{o.deptLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── saved views (per person, on the server: they follow you across devices) ──

interface SavedView { id?: string; name: string; q: OverviewQuery; tab: string; focus: string | null }
/** Where views were kept before they moved to the server; read once, imported, then cleared. */
const viewsKey = (who: string) => `eduos.analytics.views:${who}`;
function readLocalViews(who: string): SavedView[] {
  try { const v = JSON.parse(window.localStorage.getItem(viewsKey(who)) ?? '[]'); return Array.isArray(v) ? v.slice(0, 20) : []; } catch { return []; }
}
function clearLocalViews(who: string) {
  try { window.localStorage.removeItem(viewsKey(who)); } catch { /* storage unavailable: nothing to clear */ }
}
const fromServer = (v: SavedViewDto, fallback: OverviewQuery): SavedView => ({
  id: v.id, name: v.name, tab: v.tab ?? 'ALL', focus: v.focus ?? null,
  q: { ...fallback, ...Object.fromEntries(Object.entries(v.filters ?? {}).filter(([, x]) => x !== null && x !== undefined)) } as OverviewQuery,
});

function SavedViews({ who, current, onApply }: { who: string; current: Omit<SavedView, 'name'>; onApply: (v: SavedView) => void }) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        // One-time import: views this browser kept before they moved to the server.
        const local = readLocalViews(who);
        let list = (await savedViewsApi.list()).items;
        if (local.length) {
          list = (await savedViewsApi.importViews(local.map((v) => ({ name: v.name, filters: v.q, tab: v.tab, focus: v.focus })))).items;
          clearLocalViews(who);
        }
        if (live) setViews(list.map((v) => fromServer(v, current.q)));
      } catch (e) { if (live) setErr(e instanceof Error ? e.message : 'Saved views could not be loaded.'); }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per person
  }, [who]);
  const save = async () => {
    const n = name.trim().slice(0, 60);
    if (!n) return;
    try {
      const saved = await savedViewsApi.save({ name: n, filters: current.q, tab: current.tab, focus: current.focus, metricKeys: current.focus ? [current.focus] : [] });
      setViews([fromServer(saved, current.q), ...views.filter((v) => v.name !== n)]);
      setNaming(false); setName(''); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'The view could not be saved.'); }
  };
  const remove = async (v: SavedView) => {
    try { if (v.id) await savedViewsApi.remove(v.id); setViews(views.filter((x) => x.name !== v.name)); } catch (e) { setErr(e instanceof Error ? e.message : 'The view could not be forgotten.'); }
  };
  return (
    <div className="an-views" role="group" aria-label="Saved views">
      {views.length > 0 && (
        <ul className="an-view-chips">
          {views.map((v) => (
            <li key={v.name} className="an-view-chip">
              <button type="button" className="an-view-apply" onClick={() => onApply(v)}>{v.name}</button>
              <button type="button" className="an-view-x" aria-label={`Forget the view ${v.name}`} onClick={() => void remove(v)}>×</button>
            </li>
          ))}
        </ul>
      )}
      {naming ? (
        <form className="an-view-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label className="sr-only" htmlFor="an-view-name">Name for this view</label>
          <input id="an-view-name" className="input" value={name} maxLength={60} placeholder="Name this view" onChange={(e) => setName(e.target.value)} />
          <Button small type="submit" disabled={!name.trim()}>Save</Button>
          <Button small type="button" variant="ghost" onClick={() => setNaming(false)}>Cancel</Button>
        </form>
      ) : <Button small variant="soft" onClick={() => setNaming(true)}>☆ Save this view</Button>}
      {err && <span className="ops-error" role="alert">⚠ {err}</span>}
    </div>
  );
}

function Breadcrumbs({ trail }: { trail: Array<{ label: string; onClick?: () => void }> }) {
  return (
    <nav aria-label="Breadcrumb" className="an-crumbs">
      <ol>
        {trail.map((t, i) => (
          <li key={`${t.label}-${i}`}>
            {i < trail.length - 1 && t.onClick ? <button type="button" className="an-crumb" onClick={t.onClick}>{t.label}</button> : <span aria-current={i === trail.length - 1 ? 'page' : undefined}>{t.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function AnalyticsView() {
  const { permissions } = usePermissions();
  const auth = useMaybeAuth();
  const who = auth?.me?.profile?.id ?? 'me';
  const today = isoDay();
  const [q, setQ] = useState<OverviewQuery>({ preset: 'month', compare: 'previous', department: 'all', from: today.slice(0, 8) + '01', to: today, compareFrom: '', compareTo: '' });
  const [tab, setTabRaw] = useState<string>('all');
  const [focus, setFocus] = useState<string | null>(null);
  const setTab = (t: string) => { setTabRaw(t); setFocus(null); };
  const { run, busy, error } = useAction();
  const ready = (q.preset !== 'custom' || (q.from && q.to)) && (q.compare !== 'custom' || (q.compareFrom && q.compareTo));
  const query = { ...q, department: tab === 'reports' ? 'all' : tab };
  const state = useLoad(() => (ready && tab !== 'reports' ? analyticsApi.overview(query) : Promise.resolve(null)), [JSON.stringify(query), ready]);
  // Every measure in scope, for the search; the loaded figures stand in if the catalogue cannot be read.
  const cat = useLoad(() => Promise.resolve().then(() => analyticsApi.catalogue()).catch(() => null), []);
  const canExport = Boolean(permissions['analytics.export']);
  const canReports = Boolean(permissions['reports.quarterly.read']);
  const set = (patch: Partial<OverviewQuery>) => setQ((cur) => ({ ...cur, ...patch }));
  // The tabs stay while another department loads.
  const known = useRef<Array<{ key: string; label: string }>>([]);
  if (state.data?.departments?.length) known.current = state.data.departments;
  const departments = known.current;
  const deptLabel = (k: string) => departments.find((x) => x.key === k)?.label ?? humanize(k);

  const tabs = [{ key: 'all', label: 'Overview' }, ...departments.map((d) => ({ key: d.key, label: d.label })), ...(canReports ? [{ key: 'reports', label: 'Quarterly reports' }] : [])];
  const pickerOptions = (cat.data?.metrics ?? state.data?.metrics ?? []).map((m) => ({ key: m.key, label: m.label, department: m.department, deptLabel: deptLabel(m.department) }));
  const focusLabel = focus ? (pickerOptions.find((o) => o.key === focus)?.label ?? focus) : null;
  const trail = [
    { label: 'Analytics', onClick: () => setTab('all') },
    ...(tab !== 'all' ? [{ label: tab === 'reports' ? 'Quarterly reports' : deptLabel(tab), onClick: () => setFocus(null) }] : []),
    ...(focusLabel ? [{ label: focusLabel }] : []),
  ];

  return (
    <div className="an-root">
      <Card className="an-filters">
        <div className="an-filter-row" role="group" aria-label="Period and comparison">
          <Select label="Period" value={q.preset} onChange={(v) => set({ preset: v })} options={PRESETS} />
          {q.preset === 'custom' && (
            <>
              <Field label="From"><input className="input" type="date" value={q.from ?? ''} max={today} onChange={(e) => set({ from: e.target.value })} /></Field>
              <Field label="To"><input className="input" type="date" value={q.to ?? ''} max={today} onChange={(e) => set({ to: e.target.value })} /></Field>
            </>
          )}
          <Select label="Compare with" value={q.compare} onChange={(v) => set({ compare: v })} options={COMPARES} />
          {q.compare === 'custom' && (
            <>
              <Field label="Compare from"><input className="input" type="date" value={q.compareFrom ?? ''} onChange={(e) => set({ compareFrom: e.target.value })} /></Field>
              <Field label="Compare to"><input className="input" type="date" value={q.compareTo ?? ''} onChange={(e) => set({ compareTo: e.target.value })} /></Field>
            </>
          )}
          <div className="an-filter-actions">
            {canExport && tab !== 'reports' && <Button variant="soft" disabled={busy || !ready} onClick={() => void run(() => analyticsApi.exportCsv(query))}>{busy ? 'Preparing…' : 'Export CSV'}</Button>}
            {tab !== 'reports' && <Button variant="soft" onClick={() => window.print()}>Print</Button>}
          </div>
        </div>
        <ErrorNote error={error} />
      </Card>

      <div className="an-nav">
        <Breadcrumbs trail={trail} />
        {pickerOptions.length > 0 && <MetricPicker options={pickerOptions} onPick={(o) => { setTabRaw(o.department); setFocus(o.key); }} />}
      </div>
      <SavedViews who={who} current={{ q, tab, focus }} onApply={(v) => { setQ(v.q); setTabRaw(v.tab); setFocus(v.focus); }} />
      <AskDashboard surface="analytics" />

      {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={setTab} />}

      {tab === 'reports' ? <QuarterlyReportsView embedded /> : (
        <Loadable state={state} empty={<EmptyState title="Choose the dates" sub="Pick both dates of a custom period (and of a custom comparison) to see the figures." />}>
          {(d: OverviewDto | null) => d && <Workspace d={d} focus={focus} onFocus={(k) => { if (d.department === 'all') { const m = d.metrics.find((x) => x.key === k); if (m) setTabRaw(m.department); } setFocus(k); }} onDept={setTab} />}
        </Loadable>
      )}
    </div>
  );
}

function DepartmentTiles({ d, onDept }: { d: OverviewDto; onDept: (key: string) => void }) {
  return (
    <ul className="an-depts" aria-label="Departments">
      {d.departments.map((dep) => {
        const ms = d.metrics.filter((m) => m.department === dep.key);
        const up = ms.filter((m) => m.change?.comparable && (m.change.abs ?? 0) > 0).length;
        const down = ms.filter((m) => m.change?.comparable && (m.change.abs ?? 0) < 0).length;
        return (
          <li key={dep.key}>
            <button type="button" className="an-dept" onClick={() => onDept(dep.key)} aria-label={`${dep.label}: open the department`}>
              <span className="an-dept-icon" aria-hidden="true">{deptIcon(dep.key)}</span>
              <span className="an-dept-name">{dep.label}</span>
              <span className="an-dept-sub">{ms.length ? `${ms.length} headline measure${ms.length === 1 ? '' : 's'}` : 'Open for its measures'}{up || down ? ` · ▲${up} ▼${down}` : ''}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Workspace({ d, focus, onFocus, onDept }: { d: OverviewDto; focus: string | null; onFocus: (key: string) => void; onDept: (key: string) => void }) {
  const trendOf = (m: MetricDto) => (m.trend && typeof m.trend === 'object' && (m.trend as TrendDto).points.length > 1 ? (m.trend as TrendDto) : null);
  const trends = d.metrics.filter((m) => trendOf(m));
  const cmpLabel = d.comparison ? `${d.comparison.label} (${fmtDate(d.comparison.start)} – ${fmtDate(new Date(new Date(d.comparison.end).getTime() - 1))})` : null;
  const focused = focus ? d.metrics.find((m) => m.key === focus) ?? null : null;
  const focusedBreakdown = focused ? breakdownChart(focused) : null;
  const rest = focused ? d.metrics.filter((m) => m.key !== focused.key) : d.metrics;
  return (
    <>
      <p className="an-period">
        <b>{d.period.label}</b> · {fmtDate(d.period.start)} to {fmtDate(new Date(new Date(d.period.end).getTime() - 1))}
        {d.comparison && <> · compared with {cmpLabel}</>}
        {d.scope.level === 'OWN' && <> · <span className="an-scope">Your scope: {d.departments.map((x) => x.label).join(', ')}{d.scope.classes !== null ? ` (${d.scope.classes} class${d.scope.classes === 1 ? '' : 'es'})` : ''}</span></>}
      </p>
      {d.department === 'all' && d.departments.length > 1 && <DepartmentTiles d={d} onDept={onDept} />}
      {focused && (
        <section className="an-focus" aria-label={`Analysis of ${focused.label}`}>
          <div className="an-focus-grid">
            <MetricCard m={focused} comparisonLabel={d.comparison?.label ?? null} />
            {trendOf(focused) ? <TrendChart m={focused} trend={trendOf(focused)!} comparison={focused.comparisonTrend ?? null} comparisonLabel={d.comparison?.label ?? 'Comparison'} big />
              : <div className="card an-trend"><p className="an-muted">This measure has no trend over time{focused.currentOnly ? ': only its current value is kept' : ''}.</p></div>}
          </div>
          {focusedBreakdown && <DashChart c={focusedBreakdown} />}
        </section>
      )}
      {d.metrics.length === 0 ? <EmptyState title="No figures here yet" sub="This department has no measures in the catalogue yet." /> : (
        <>
          {focused && <h3 className="an-sub">Other measures in {d.departments.find((x) => x.key === focused.department)?.label ?? 'this department'}</h3>}
          <div className="an-grid">{rest.map((m) => <MetricCard key={m.key} m={m} comparisonLabel={d.comparison?.label ?? null} onOpen={onFocus} />)}</div>
        </>
      )}
      {trends.filter((m) => m.key !== focused?.key).length > 0 && (
        <div className="an-trends">{trends.filter((m) => m.key !== focused?.key).map((m) => <TrendChart key={m.key} m={m} trend={trendOf(m)!} comparison={m.comparisonTrend ?? null} comparisonLabel={d.comparison?.label ?? 'Comparison'} />)}</div>
      )}
      {d.department !== 'all' && <Breakdowns metrics={rest} />}
      <DataNote>
        Computed {fmtDateTime(d.computedAt)} from live records, cut off at {fmtDateTime(d.cutoff)}; money in {d.currency}. {d.freshness} Definitions version {d.catalogueVersion}.
        &ldquo;Not available&rdquo; means the records do not cover that period; &ldquo;not comparable&rdquo; means the comparison is missing or zero.
      </DataNote>
    </>
  );
}

// ── quarterly reports ──────────────────────────────────────────────────

const reportValue = (m: ReportMetric, v: number | null | undefined) => formatValue(v ?? null, m.unit);

function ReportMetrics({ list }: { list: ReportMetric[] }) {
  return (
    <div className="an-table-wrap">
      <table className="an-table">
        <thead><tr><th scope="col">Measure</th><th scope="col">This quarter</th><th scope="col">Prior quarter</th><th scope="col">Change</th><th scope="col">Same quarter last year</th><th scope="col">Change</th></tr></thead>
        <tbody>{list.map((m) => (
          <tr key={m.key}>
            <th scope="row" title={m.definition}>{m.label}{m.note && <div className="an-note">{m.note}</div>}</th>
            <td>{reportValue(m, m.value)}</td>
            <td>{reportValue(m, m.priorQuarter?.value)}</td>
            <td>{m.priorQuarter ? <ChangeBadge m={{ change: m.priorQuarter.change, unit: m.unit }} /> : '—'}</td>
            <td>{reportValue(m, m.lastYear?.value)}</td>
            <td>{m.lastYear ? <ChangeBadge m={{ change: m.lastYear.change, unit: m.unit }} /> : '—'}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function ReportDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const state = useLoad(() => analyticsApi.report(id), [id]);
  return (
    <Modal title="Quarterly report" onClose={onClose} wide>
      <Loadable state={state}>{(r: ReportDto) => {
        const f = r.figures;
        if (!f) return <p className="ops-muted">{r.status === 'FAILED' ? `Generation failed: ${r.error ?? 'unknown error'}` : 'This version is still being generated.'}</p>;
        return (
          <div className="an-report">
            <p className="an-period"><b>{f.quarter.label}</b> · version {r.version} · figures frozen {fmtDateTime(f.cutoff)} · {f.currency}</p>
            {f.summary && <><h3>Summary</h3><ReportMetrics list={f.summary} /></>}
            {f.sections.map((s) => <div key={s.key}><h3>{s.label}</h3><ReportMetrics list={s.metrics} /></div>)}
            {f.budget && (
              <>
                <h3>Budget variance ({f.budget.fiscalYear})</h3>
                {!f.budget.available ? <p className="ops-muted">No approved budget for this year.</p> : (
                  <p>Planned {money(f.budget.totals.plannedPaise)} · committed {money(f.budget.totals.committedPaise)} · actual {money(f.budget.totals.actualPaise)} · variance {money(f.budget.totals.variancePaise)}. <span className="an-muted">{f.budget.basis}</span></p>
                )}
              </>
            )}
            {f.renewals && <><h3>Renewals in the next 90 days</h3><p>{f.renewals.totals.count} open, {f.renewals.totals.overdue} overdue, forecast {money(f.renewals.totals.forecastPaise)}.</p></>}
            {f.decisions && (
              <>
                <h3>Decisions and actions</h3>
                <ul>
                  {f.decisions.approvals.map((a) => <li key={a.category}>{a.count} {humanize(a.category).toLowerCase()} approval(s) waiting</li>)}
                  {f.decisions.actions.map((a, i) => <li key={i}>{a.title}: {a.owner}, review by {fmtDate(a.reviewBy)}</li>)}
                  {!f.decisions.approvals.length && !f.decisions.actions.length && <li>Nothing is waiting.</li>}
                </ul>
              </>
            )}
            {f.achievements && f.achievements.length > 0 && <><h3>Achievements</h3><ul>{f.achievements.map((a, i) => <li key={i}>{a.title}</li>)}</ul></>}
            {f.missing && f.missing.length > 0 && <><h3>Missing data</h3><ul>{f.missing.map((m) => <li key={m.key}>{m.label}: {m.note ?? 'not available'}</li>)}</ul></>}
          </div>
        );
      }}</Loadable>
    </Modal>
  );
}

export function QuarterlyReportsView({ embedded = false }: { embedded?: boolean }) {
  const { permissions } = usePermissions();
  const canManage = permissions['reports.quarterly.manage'] === 'ALL';
  const state = useLoad(() => analyticsApi.reports(), []);
  const initial = useQueryParam('id');
  const [open, setOpen] = useState<string | null>(initial);
  const [regen, setRegen] = useState(false);
  const toast = useToast();
  const { run, busy, error } = useAction();
  const [deliveriesFor, setDeliveriesFor] = useState<string | null>(null);
  const groups = useMemo(() => {
    const by = new Map<string, ReportSummaryDto[]>();
    for (const r of state.data?.items ?? []) { if (!by.has(r.quarterKey)) by.set(r.quarterKey, []); by.get(r.quarterKey)!.push(r); }
    return [...by.entries()];
  }, [state.data]);
  return (
    <SectionCard
      title={embedded ? 'Quarterly reports' : 'Reports by quarter'}
      sub="Frozen snapshots of the figures for each quarter. A correction is a new version; earlier versions stay as they were."
      actions={canManage ? <Button onClick={() => setRegen(true)}>Generate a version</Button> : undefined}
    >
      <ErrorNote error={error} />
      <Loadable state={state}>{() => groups.length === 0 ? (
        <EmptyState title="No reports yet" sub="The previous quarter's report is generated automatically after the quarter ends." />
      ) : (
        <ul className="an-reports">
          {groups.map(([key, versions]) => (
            <li key={key} className="an-report-row">
              <div className="an-report-title"><b>{versions[0].label}</b></div>
              <ul className="an-versions">
                {versions.map((r) => (
                  <li key={r.id}>
                    <span>Version {r.version}{r.latest ? ' (latest)' : ''}</span> <StatusPill status={r.status} />
                    <span className="an-muted"> {r.trigger === 'MANUAL' ? 'regenerated' : 'scheduled'} {fmtDateTime(r.generatedAt)}{r.reason ? ` · ${r.reason}` : ''}</span>
                    <span className="an-version-actions">
                      <Button small variant="soft" onClick={() => setOpen(r.id)}>Open</Button>
                      {r.status === 'GENERATED' && <Button small variant="soft" disabled={busy} onClick={() => void run(() => analyticsApi.downloadReport(r, 'pdf'))}>PDF</Button>}
                      {r.status === 'GENERATED' && <Button small variant="soft" disabled={busy} onClick={() => void run(() => analyticsApi.downloadReport(r, 'csv'))}>CSV</Button>}
                      {canManage && <Button small variant="soft" onClick={() => setDeliveriesFor(r.id)}>Deliveries</Button>}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}</Loadable>
      {open && <ReportDetail id={open} onClose={() => setOpen(null)} />}
      {deliveriesFor && <Deliveries id={deliveriesFor} onClose={() => setDeliveriesFor(null)} />}
      {regen && (
        <RegenerateModal quarters={groups.map(([k]) => k)} onClose={() => setRegen(false)} onDone={() => { toast('A new version was generated'); void state.reload(); }} />
      )}
    </SectionCard>
  );
}

function RegenerateModal({ quarters, onClose, onDone }: { quarters: string[]; onClose: () => void; onDone: () => void }) {
  const [quarter, setQuarter] = useState(quarters[0] ?? '');
  const [reason, setReason] = useState('');
  const { run, busy, error } = useAction();
  return (
    <Modal title="Generate a new version" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !reason.trim()} onClick={() => void run(async () => { await analyticsApi.regenerate({ quarter: quarter || undefined, reason: reason.trim() }); onDone(); onClose(); })}>{busy ? 'Generating…' : 'Generate'}</Button>
    </>}>
      <Field label="Quarter" hint="Like FY2026-27-Q2. Leave empty for the previous quarter."><input className="input" value={quarter} onChange={(e) => setQuarter(e.target.value)} /></Field>
      <Field label="Why a new version?" required><textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <DataNote>The existing versions are kept unchanged. Recipients are told about the new version.</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

function Deliveries({ id, onClose }: { id: string; onClose: () => void }) {
  const state = useLoad(() => analyticsApi.deliveries(id), [id]);
  const { run, busy, error } = useAction();
  return (
    <Modal title="Deliveries" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Close</Button>
      <Button disabled={busy} onClick={() => void run(async () => { await analyticsApi.retryDeliveries(id); await state.reload(); })}>Retry failed</Button>
    </>}>
      <ErrorNote error={error} />
      <Loadable state={state}>{(rows) => (
        <div className="an-table-wrap"><table className="an-table">
          <thead><tr><th scope="col">Recipient</th><th scope="col">Status</th><th scope="col">Attempts</th><th scope="col">Sent</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><th scope="row">{r.recipientName} <span className="an-muted">{humanize(r.roleKey)}</span></th><td><StatusPill status={r.status} />{r.lastError && <div className="an-note">{r.lastError}</div>}</td><td>{r.attempts}</td><td>{fmtDateTime(r.sentAt)}</td></tr>)}</tbody>
        </table></div>
      )}</Loadable>
    </Modal>
  );
}
