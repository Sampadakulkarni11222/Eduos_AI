'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { DashChartDto, DashPoint, DashTone, DashUnit } from '@/lib/dashboard-api';
import { usePortalPage } from '@/lib/school-path';
import { money } from './kit';

/**
 * Charts for the role dashboards and the analytics workspace, in the pulse
 * board's visual language: hover or focus a mark for its detail, tap it to
 * open the records behind it, switch between variants (each test, each
 * class), and flip any chart to a table of the same numbers.
 *
 * Colour is never the only signal: a comparison series is dashed and named in
 * the legend, a mark that needs attention is hatched as well as red, and the
 * table spells each status out in words.
 */

export const TONE: Record<DashTone, string> = { good: 'var(--green, #2E7D32)', warn: '#C9821B', bad: 'var(--red, #B3261E)', neutral: 'var(--accent)', muted: '#9a9286' };
const TONE_WORD: Record<DashTone, string> = { good: 'Good', warn: 'Watch', bad: 'Needs attention', neutral: '', muted: '' };
/** Categorical shades for a donut's parts when they carry no tone of their own. */
const SHADES = ['var(--accent)', '#2BA39A', '#5A67D8', '#E0803D', '#3C9BD6', '#7A5BD8', '#9a9286'];

export function fmtDash(unit: DashUnit, v: number | null | undefined, short = false): string {
  if (v === null || v === undefined) return '—';
  if (unit === 'percent') return `${Math.round(v * 10) / 10}%`;
  if (unit === 'paise') {
    if (short && Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(v >= 1e8 ? 0 : 1)}L`;
    if (short && Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(0)}k`;
    return money(v);
  }
  if (unit === 'days') return `${v} day${v === 1 ? '' : 's'}`;
  return v.toLocaleString('en-IN');
}

/** Splits an axis label into at most two short lines. */
function axisLines(label: string, max: number): string[] {
  if (label.length <= max) return [label];
  const words = label.split(/\s+/);
  const first: string[] = [];
  while (words.length && [...first, words[0]].join(' ').length <= max) first.push(words.shift() as string);
  if (!first.length) return [`${label.slice(0, max - 1)}…`];
  const rest = words.join(' ');
  return rest ? [first.join(' '), rest.length > max ? `${rest.slice(0, max - 1)}…` : rest] : [first.join(' ')];
}

/** Opens the page behind a mark: the point's own link, else the chart's. */
function useDrill(c: Pick<DashChartDto, 'link'>) {
  const router = useRouter();
  const page = usePortalPage();
  return {
    href: (p?: DashPoint | null) => page(p?.link ?? c.link),
    go: (p?: DashPoint | null) => { const h = page(p?.link ?? c.link); if (h) router.push(h); },
  };
}

const onKey = (fn: () => void) => (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

/** A hatch over a mark that needs attention, so red is not the only cue. */
function Hatch({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" stroke="#fff" strokeWidth="2" strokeOpacity=".55" />
      </pattern>
    </defs>
  );
}

function LineBars({ c, points, compare, hover, setHover }: { c: DashChartDto; points: DashPoint[]; compare: DashChartDto['compare']; hover: number | null; setHover: (i: number | null) => void }) {
  const drill = useDrill(c);
  const hatch = useId().replace(/:/g, '');
  const W = 340; const H = 170; const P = { l: 34, r: 8, t: 16, b: 34 };
  const vals = [...points.map((p) => p.value ?? 0), ...(compare?.points ?? []).map((p) => p.value ?? 0)];
  const top = c.unit === 'percent' ? 100 : Math.max(1, ...vals) * 1.12;
  const n = Math.max(points.length, 1);
  const isLine = c.type === 'line';
  const x = (i: number) => (isLine ? P.l + (n <= 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (n - 1)) : P.l + ((i + 0.5) * (W - P.l - P.r)) / n);
  const y = (v: number) => P.t + (H - P.t - P.b) * (1 - v / top);
  const bw = Math.max(8, Math.min(40, (W - P.l - P.r) / n - 8));
  const path = (pts: Array<{ value: number | null }>) => {
    // Breaks the line across a blank (null) point instead of dropping to zero.
    let d = ''; let pen = false;
    pts.forEach((p, i) => { if (p.value === null) { pen = false; return; } d += `${pen ? 'L' : 'M'} ${x(i)} ${y(p.value)} `; pen = true; });
    return d.trim();
  };
  const cmpVals = compare?.points ?? [];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pb-svg dc-svg" role="img" aria-label={`${c.title}: ${points.map((p) => `${p.label} ${fmtDash(c.unit, p.value)}`).join(', ')}${compare ? `. ${compare.label}: ${cmpVals.map((p) => `${p.label} ${fmtDash(c.unit, p.value)}`).join(', ')}` : ''}`}>
      <Hatch id={hatch} />
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={P.l} x2={W - P.r} y1={y(top * f)} y2={y(top * f)} className="pb-grid" />
          {f > 0 && <text x={P.l - 4} y={y(top * f) + 3} className="pb-axis" textAnchor="end">{fmtDash(c.unit, Math.round(top * f), true)}</text>}
        </g>
      ))}
      {isLine && (
        <>
          {points.some((p) => p.value !== null) && <path d={`${path(points)}`} className="pb-line" />}
          {compare && <path d={path(cmpVals)} className="dc-compare" />}
        </>
      )}
      {!isLine && points.map((p, i) => {
        const v = p.value ?? 0;
        const tone = (p.tone ?? 'neutral') as DashTone;
        return (
          <g key={i}>
            <rect x={x(i) - bw / 2} y={y(v)} width={bw} height={Math.max(1, y(0) - y(v))} rx={4} fill={TONE[tone]} opacity={hover === null || hover === i ? 0.9 : 0.4} className="pb-bar" />
            {tone === 'bad' && v > 0 && <rect x={x(i) - bw / 2} y={y(v)} width={bw} height={Math.max(1, y(0) - y(v))} rx={4} fill={`url(#${hatch})`} pointerEvents="none" />}
            <text x={x(i)} y={y(v) - 4} className="pb-val" textAnchor="middle">{v ? fmtDash(c.unit, v, true) : ''}</text>
          </g>
        );
      })}
      {!isLine && compare && <path d={path(cmpVals)} className="dc-compare" />}
      {compare && cmpVals.map((p, i) => (p.value === null ? null : <circle key={`c${i}`} cx={x(i)} cy={y(p.value)} r={2.5} className="dc-compare-dot" />))}
      {isLine && points.map((p, i) => (p.value === null ? null : <circle key={i} cx={x(i)} cy={y(p.value)} r={hover === i ? 5.5 : 3.5} className="pb-dot" />))}
      {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} className="an-cross" />}
      {points.map((p, i) => {
        if (n > 8 && i % Math.ceil(n / 7) && i !== n - 1) return null;
        const lines = axisLines(p.label, Math.max(6, Math.floor(((W - P.l - P.r) / Math.min(n, 7)) / 5.4)));
        return (
          <text key={`l${i}`} x={x(i)} y={H - (lines.length > 1 ? 16 : 10)} className="pb-axis" textAnchor="middle">
            {lines.map((line, k) => <tspan key={k} x={x(i)} dy={k ? 10 : 0}>{line}</tspan>)}
          </text>
        );
      })}
      {/* Hit targets: a full-height column per point, focusable, tap to open the records. */}
      {points.map((p, i) => {
        const colW = (W - P.l - P.r) / (isLine ? Math.max(n - 1, 1) : n);
        return (
          <rect key={`h${i}`} x={x(i) - colW / 2} y={0} width={colW} height={H - P.b + 4} fill="transparent" className="dc-hit"
            tabIndex={0} role="button" aria-label={`${p.label}: ${fmtDash(c.unit, p.value)}${p.detail ? `, ${p.detail}` : ''}${compare?.points[i] ? `; ${compare.label} ${fmtDash(c.unit, compare.points[i].value)}` : ''}${drill.href(p) ? '. Open the records' : ''}`}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
            onClick={() => drill.go(p)} onKeyDown={onKey(() => drill.go(p))} />
        );
      })}
    </svg>
  );
}

function HBars({ c, points, compare, hover, setHover }: { c: DashChartDto; points: DashPoint[]; compare: DashChartDto['compare']; hover: number | null; setHover: (i: number | null) => void }) {
  const drill = useDrill(c);
  const top = c.unit === 'percent' ? 100 : Math.max(1, ...points.map((p) => p.value ?? 0), ...(compare?.points ?? []).map((p) => p.value ?? 0));
  return (
    <ul className="dc-hbars" aria-label={c.title}>
      {points.map((p, i) => {
        const v = p.value ?? 0;
        const cmp = compare?.points[i]?.value ?? null;
        const tone = (p.tone ?? 'neutral') as DashTone;
        const href = drill.href(p);
        const body = (
          <>
            <span className="dc-hbar-label">{p.label}</span>
            <span className="dc-hbar-track" aria-hidden="true">
              <span className={`dc-hbar-fill${tone === 'bad' ? ' is-hatched' : ''}`} style={{ width: `${Math.max(0, Math.min(100, (v / top) * 100))}%`, background: TONE[tone] }} />
              {cmp !== null && <span className="dc-hbar-mark" style={{ left: `${Math.max(0, Math.min(100, (cmp / top) * 100))}%` }} title={`${compare!.label}: ${fmtDash(c.unit, cmp)}`} />}
            </span>
            <span className="dc-hbar-val">{fmtDash(c.unit, p.value)}{tone === 'bad' && <span className="sr-only"> (needs attention)</span>}</span>
          </>
        );
        const label = `${p.label}: ${fmtDash(c.unit, p.value)}${p.detail ? `, ${p.detail}` : ''}${cmp !== null ? `; ${compare!.label} ${fmtDash(c.unit, cmp)}` : ''}`;
        return (
          <li key={`${p.label}-${i}`} className={hover === i ? 'is-hover' : ''} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            {href ? <Link href={href} className="dc-hbar" aria-label={label} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>{body}</Link> : <div className="dc-hbar" aria-label={label}>{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

function Donut({ c, points, hover, setHover }: { c: DashChartDto; points: DashPoint[]; hover: number | null; setHover: (i: number | null) => void }) {
  const drill = useDrill(c);
  const total = points.reduce((s, p) => s + Math.max(0, p.value ?? 0), 0);
  const R = 52; const r = 32; const C = 64;
  let acc = 0;
  const colour = (p: DashPoint, i: number) => (p.tone && p.tone !== 'neutral' ? TONE[p.tone] : SHADES[i % SHADES.length]);
  const arc = (a0: number, a1: number) => {
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const pt = (rad: number, a: number) => [C + rad * Math.sin(a), C - rad * Math.cos(a)];
    const [x0, y0] = pt(R, a0); const [x1, y1] = pt(R, a1); const [x2, y2] = pt(r, a1); const [x3, y3] = pt(r, a0);
    return `M ${x0} ${y0} A ${R} ${R} 0 ${big} 1 ${x1} ${y1} L ${x2} ${y2} A ${r} ${r} 0 ${big} 0 ${x3} ${y3} Z`;
  };
  const shown = hover !== null ? points[hover] : null;
  return (
    <div className="dc-donut">
      <svg viewBox="0 0 128 128" className="dc-donut-svg" role="img" aria-label={`${c.title}: ${points.map((p) => `${p.label} ${fmtDash(c.unit, p.value)}`).join(', ')}`}>
        {points.map((p, i) => {
          const v = Math.max(0, p.value ?? 0);
          if (!v || !total) return null;
          const a0 = (acc / total) * 2 * Math.PI; acc += v;
          const a1 = Math.min((acc / total) * 2 * Math.PI, 2 * Math.PI - 0.0001);
          return <path key={i} d={arc(a0, a1)} fill={colour(p, i)} opacity={hover === null || hover === i ? 1 : 0.35} className="dc-slice" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => drill.go(p)} />;
        })}
        <text x={C} y={C - 2} textAnchor="middle" className="dc-donut-big">{shown ? fmtDash(c.unit, shown.value, true) : fmtDash(c.unit, total, true)}</text>
        <text x={C} y={C + 12} textAnchor="middle" className="pb-axis">{shown ? `${total ? Math.round(((shown.value ?? 0) / total) * 100) : 0}%` : 'total'}</text>
      </svg>
      <ul className="dc-legend">
        {points.map((p, i) => {
          const href = drill.href(p);
          const inner = (
            <>
              <span className="dc-swatch" style={{ background: colour(p, i) }} aria-hidden="true" />
              <span className="dc-legend-label">{p.label}</span>
              <b>{fmtDash(c.unit, p.value)}</b>
              <span className="an-muted">{total ? `${Math.round(((p.value ?? 0) / total) * 100)}%` : ''}</span>
            </>
          );
          return (
            <li key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {href ? <Link href={href} className="dc-legend-item" onFocus={() => setHover(i)} onBlur={() => setHover(null)}>{inner}</Link> : <span className="dc-legend-item">{inner}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The same numbers as a table: the text alternative every chart carries. */
export function ChartTable({ c, points, compare }: { c: Pick<DashChartDto, 'title' | 'unit'>; points: DashPoint[]; compare?: DashChartDto['compare'] }) {
  return (
    <div className="an-table-wrap">
      <table className="an-table">
        <caption className="sr-only">{c.title}</caption>
        <thead><tr><th scope="col">Item</th><th scope="col">Value</th>{compare && <th scope="col">{compare.label}</th>}<th scope="col">Detail</th></tr></thead>
        <tbody>{points.map((p, i) => (
          <tr key={`${p.label}-${i}`}>
            <th scope="row">{p.label}</th>
            <td>{fmtDash(c.unit, p.value)}</td>
            {compare && <td>{fmtDash(c.unit, compare.points[i]?.value ?? null)}</td>}
            <td>{[p.tone ? TONE_WORD[p.tone] : '', p.detail ?? ''].filter(Boolean).join(' · ')}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** One dashboard chart card. */
export function DashChart({ c, actions }: { c: DashChartDto; actions?: ReactNode }) {
  const page = usePortalPage();
  const [variant, setVariant] = useState<string>(c.variants?.[0]?.key ?? '');
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const v = c.variants?.find((x) => x.key === variant) ?? null;
  const points = v?.points ?? c.points;
  const compare = v ? (v.compare ?? (variant === c.variants?.[0]?.key ? c.compare : null)) : c.compare;
  const empty = !points.some((p) => p.value !== null && p.value !== 0);
  const shown = hover !== null ? points[hover] : null;
  const cmpShown = hover !== null ? compare?.points[hover] : null;
  const title = page(c.link);
  const selectId = useId();
  return (
    <section className="pb-chart card dc-card" aria-label={c.title}>
      <div className="dc-head">
        {title ? <Link href={title} className="pb-chart-title">{c.title} <span aria-hidden="true">→</span></Link> : <span className="pb-chart-title">{c.title}</span>}
        <div className="dc-tools">
          {c.variants && c.variants.length > 1 && (
            <>
              <label htmlFor={selectId} className="sr-only">Show</label>
              <select id={selectId} className="dc-select" value={variant} onChange={(e) => { setVariant(e.target.value); setHover(null); }}>
                {c.variants.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
            </>
          )}
          {!empty && <button type="button" className="dc-toggle" aria-pressed={table} onClick={() => setTable((t) => !t)}>{table ? 'Show chart' : 'Show table'}</button>}
          {actions}
        </div>
      </div>
      <div className="pb-readout" aria-live="polite">
        {shown ? <><b>{fmtDash(c.unit, shown.value)}</b> {shown.label}{shown.detail ? ` · ${shown.detail}` : ''}{cmpShown && cmpShown.value !== null ? ` · ${compare!.label} ${fmtDash(c.unit, cmpShown.value)}` : ''}</> : (c.footnote ?? '')}
      </div>
      {empty ? <div className="pb-empty">{c.emptyText}</div>
        : table ? <ChartTable c={c} points={points} compare={compare} />
          : c.type === 'donut' ? <Donut c={c} points={points} hover={hover} setHover={setHover} />
            : c.type === 'hbar' ? <HBars c={c} points={points} compare={compare} hover={hover} setHover={setHover} />
              : <LineBars c={c} points={points} compare={compare} hover={hover} setHover={setHover} />}
      {!empty && compare && !table && (
        <div className="dc-legend-row" aria-hidden="true">
          <span><i className="dc-key is-main" /> {v && variant !== c.variants?.[0]?.key ? v.label : 'This'}</span>
          <span><i className="dc-key is-compare" /> {compare.label}</span>
        </div>
      )}
      {!empty && !compare && c.compareNote && <div className="pb-def">{c.compareNote}</div>}
      <div className="pb-def">{c.definition}</div>
    </section>
  );
}

/** A small trend line for a headline card. */
export function Sparkline({ values, label, unit = 'count' }: { values: Array<number | null>; label: string; unit?: DashUnit }) {
  const pts = useMemo(() => values.map((v, i) => ({ v, i })).filter((p) => p.v !== null) as Array<{ v: number; i: number }>, [values]);
  if (pts.length < 2) return null;
  const W = 100; const H = 26;
  const lo = Math.min(...pts.map((p) => p.v)); const hi = Math.max(...pts.map((p) => p.v));
  const x = (i: number) => (i / Math.max(values.length - 1, 1)) * W;
  const y = (v: number) => H - 3 - ((v - lo) / (hi - lo || 1)) * (H - 6);
  const first = pts[0].v; const last = pts[pts.length - 1].v;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="dc-spark" role="img" aria-label={`${label} trend: from ${fmtDash(unit, first)} to ${fmtDash(unit, last)}`} preserveAspectRatio="none">
      <polyline points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')} className="dc-spark-line" />
      <circle cx={x(pts[pts.length - 1].i)} cy={y(last)} r={2.4} className="dc-spark-dot" />
    </svg>
  );
}
