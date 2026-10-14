'use client';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { Button, Card, EmptyState, Field, Modal, Select, useToast } from '@/components/ui';
import { analyticsApi, type MetricDto, type OverviewDto, type OverviewQuery, type ReportDto, type ReportMetric, type ReportSummaryDto, type TrendDto } from '@/lib/analytics-api';
import { usePermissions } from '@/lib/permissions';
import { usePortalPage } from '@/lib/school-path';
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

function MetricCard({ m, comparisonLabel }: { m: MetricDto; comparisonLabel: string | null }) {
  const page = usePortalPage();
  const [open, setOpen] = useState(false);
  const href = page(m.link);
  const na = m.current.value === null;
  return (
    <article className={`an-card${na ? ' is-na' : ''}`} aria-label={m.label}>
      <div className="an-card-head">
        <h3 className="an-card-label">{m.label}</h3>
        <button type="button" className="kpi-info" aria-expanded={open} onClick={() => setOpen((v) => !v)} aria-label={`How "${m.label}" is calculated`}>i</button>
      </div>
      <div className="an-card-value">{formatValue(m.current.value, m.unit)}</div>
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
      {href && <Link href={href} className="an-drill">Open the records <span aria-hidden="true">→</span></Link>}
    </article>
  );
}

/** A single-series trend line with hover readout and a table view of the same numbers. */
export function TrendChart({ m, trend }: { m: MetricDto; trend: TrendDto }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const pts = trend.points;
  const W = 520; const H = 160; const P = { l: 8, r: 8, t: 12, b: 24 };
  const vals = pts.map((p) => p.value).filter((v): v is number => v !== null);
  const max = m.unit === 'percent' ? 100 : Math.max(1, ...vals.map((v) => Math.abs(v))) * 1.1;
  const min = Math.min(0, ...vals);
  const x = (i: number) => P.l + (pts.length <= 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (pts.length - 1));
  const y = (v: number) => P.t + (H - P.t - P.b) * (1 - (v - min) / (max - min || 1));
  const line = pts.map((p, i) => (p.value === null ? null : `${x(i)},${y(p.value)}`)).filter(Boolean).join(' ');
  const shown = hover !== null ? pts[hover] : null;
  return (
    <div className="an-trend card">
      <div className="an-trend-head">
        <h3 className="an-card-label">{m.label} by {trend.unit}</h3>
        <span className="pb-readout" aria-live="polite">{shown ? <><b>{formatValue(shown.value, m.unit)}</b> {shown.label}</> : `${pts.length} ${trend.unit}s`}</span>
        <button type="button" className="btn btn-soft btn-sm" aria-pressed={table} onClick={() => setTable((v) => !v)}>{table ? 'Show chart' : 'Show table'}</button>
      </div>
      {table ? (
        <div className="an-table-wrap">
          <table className="an-table">
            <caption className="sr-only">{m.label} by {trend.unit}</caption>
            <thead><tr><th scope="col">{humanize(trend.unit)}</th><th scope="col">{m.label}</th></tr></thead>
            <tbody>{pts.map((p) => <tr key={p.from}><th scope="row">{p.label}</th><td>{formatValue(p.value, m.unit)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="an-svg" role="img" aria-label={`${m.label}: ${pts.map((p) => `${p.label} ${formatValue(p.value, m.unit)}`).join(', ')}`}>
          {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={P.l} x2={W - P.r} y1={y(min + (max - min) * f)} y2={y(min + (max - min) * f)} className="pb-grid" />)}
          {min < 0 && <line x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} className="an-zero" />}
          {line && <polyline points={line} className="an-line" />}
          {pts.map((p, i) => (
            <g key={p.from}>
              {/* A hit target wider than the mark. */}
              <rect x={x(i) - (W / Math.max(pts.length, 1)) / 2} y={0} width={W / Math.max(pts.length, 1)} height={H} fill="transparent" tabIndex={0}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} aria-label={`${p.label}: ${formatValue(p.value, m.unit)}`} />
              {p.value !== null && (hover === i || pts.length <= 14) && <circle cx={x(i)} cy={y(p.value)} r={hover === i ? 5 : 3} className="an-dot" />}
            </g>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} className="an-cross" />}
          <text x={P.l} y={H - 6} className="pb-axis">{pts[0]?.label}</text>
          <text x={W - P.r} y={H - 6} className="pb-axis" textAnchor="end">{pts[pts.length - 1]?.label}</text>
        </svg>
      )}
    </div>
  );
}

function Breakdowns({ metrics }: { metrics: MetricDto[] }) {
  const withRows = metrics.filter((m) => m.current.breakdown?.length);
  if (!withRows.length) return null;
  return (
    <SectionCard title="Breakdowns" sub="The parts behind each figure, from the same records.">
      <div className="an-breakdowns">
        {withRows.map((m) => (
          <div key={m.key} className="an-table-wrap">
            <table className="an-table">
              <caption>{m.label}</caption>
              <thead><tr><th scope="col">Part</th><th scope="col">{m.unit === 'percent' ? 'Value' : 'Amount'}</th></tr></thead>
              <tbody>{m.current.breakdown!.map((b, i) => (
                <tr key={`${b.label}-${i}`}><th scope="row">{humanize(b.label)}</th><td>{formatValue(b.value, m.unit === 'percent' && b.of === undefined ? 'percent' : m.unit === 'percent' ? 'count' : m.unit)}{b.of !== undefined ? ` of ${b.of.toLocaleString('en-IN')}` : ''}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

export function AnalyticsView() {
  const { permissions } = usePermissions();
  const today = isoDay();
  const [q, setQ] = useState<OverviewQuery>({ preset: 'month', compare: 'previous', department: 'all', from: today.slice(0, 8) + '01', to: today, compareFrom: '', compareTo: '' });
  const [tab, setTab] = useState<string>('all');
  const { run, busy, error } = useAction();
  const ready = (q.preset !== 'custom' || (q.from && q.to)) && (q.compare !== 'custom' || (q.compareFrom && q.compareTo));
  const query = { ...q, department: tab === 'reports' ? 'all' : tab };
  const state = useLoad(() => (ready && tab !== 'reports' ? analyticsApi.overview(query) : Promise.resolve(null)), [JSON.stringify(query), ready]);
  const canExport = Boolean(permissions['analytics.export']);
  const canReports = Boolean(permissions['reports.quarterly.read']);
  const set = (patch: Partial<OverviewQuery>) => setQ((cur) => ({ ...cur, ...patch }));
  // The tabs stay while another department loads.
  const known = useRef<Array<{ key: string; label: string }>>([]);
  if (state.data?.departments?.length) known.current = state.data.departments;
  const departments = known.current;

  const tabs = [{ key: 'all', label: 'Overview' }, ...departments.map((d) => ({ key: d.key, label: d.label })), ...(canReports ? [{ key: 'reports', label: 'Quarterly reports' }] : [])];

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

      {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={setTab} />}

      {tab === 'reports' ? <QuarterlyReportsView embedded /> : (
        <Loadable state={state} empty={<EmptyState title="Choose the dates" sub="Pick both dates of a custom period (and of a custom comparison) to see the figures." />}>
          {(d: OverviewDto | null) => d && <Workspace d={d} />}
        </Loadable>
      )}
    </div>
  );
}

function Workspace({ d }: { d: OverviewDto }) {
  const trends = d.metrics.filter((m) => m.trend && typeof m.trend === 'object' && (m.trend as TrendDto).points.length > 1);
  const cmpLabel = d.comparison ? `${d.comparison.label} (${fmtDate(d.comparison.start)} – ${fmtDate(new Date(new Date(d.comparison.end).getTime() - 1))})` : null;
  return (
    <>
      <p className="an-period">
        <b>{d.period.label}</b> · {fmtDate(d.period.start)} to {fmtDate(new Date(new Date(d.period.end).getTime() - 1))}
        {d.comparison && <> · compared with {cmpLabel}</>}
        {d.scope.level === 'OWN' && <> · <span className="an-scope">Your scope: {d.departments.map((x) => x.label).join(', ')}{d.scope.classes !== null ? ` (${d.scope.classes} class${d.scope.classes === 1 ? '' : 'es'})` : ''}</span></>}
      </p>
      {d.metrics.length === 0 ? <EmptyState title="No figures here yet" sub="This department has no measures in the catalogue yet." /> : (
        <div className="an-grid">{d.metrics.map((m) => <MetricCard key={m.key} m={m} comparisonLabel={d.comparison?.label ?? null} />)}</div>
      )}
      {trends.length > 0 && <div className="an-trends">{trends.map((m) => <TrendChart key={m.key} m={m} trend={m.trend as TrendDto} />)}</div>}
      {d.department !== 'all' && <Breakdowns metrics={d.metrics} />}
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
