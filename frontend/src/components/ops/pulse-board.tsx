'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { opsApi } from '@/lib/ops-api';
import { usePermissions } from '@/lib/permissions';
import type { CampusMapDto, CampusNodeDto, PulseChartDto, PulseDto } from '@/lib/ops-types';
import { usePortalPage } from '@/lib/school-path';
import { Loadable, fmtDateTime, money, useLoad } from './kit';

/**
 * The interactive half of every home page, after the reference dashboard: a
 * briefing you can have read aloud, a small live map of the campus, charts you
 * can hover and click through, what just happened, and each department's
 * queue. Every number is from the records and every element links to them.
 */

/** The same roof colours as Campus World, so the two read as one place. */
const ROOFS = ['#3D7BE0', '#2BA39A', '#5A67D8', '#E0803D', '#D2455E', '#3C9BD6', '#7A5BD8'];
const fmtValue = (c: PulseChartDto, v: number | null) => (v === null ? '—' : c.unit === 'percent' ? `${v}%` : c.unit === 'paise' ? money(v) : v.toLocaleString('en-IN'));
const TONE: Record<string, string> = { good: 'var(--green, #2E7D32)', warn: '#C9821B', bad: 'var(--red, #B3261E)', neutral: 'var(--accent)' };
const ICON: Record<string, string> = { approved: '✓', decided: '⚖', request: '✋', fixed: '🔧', repair: '🛠', urgent: '⚠', letter: '✉', event: '✦', post: '◉', live: '●' };

function relative(at: string) {
  const mins = Math.round((Date.now() - new Date(at).getTime()) / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** A link when the reader's portal has the page, plain content when it does not. */
function MaybeLink({ href, className, children, role, plain }: { href: string | null; className?: string; children: ReactNode; role?: string; plain?: boolean }) {
  if (!href) return <div className={className} role={role}>{children}</div>;
  return <Link href={href} className={className} role={role}>{children}{!plain && <span aria-hidden="true"> →</span>}</Link>;
}

/** Splits an axis label into at most two lines that fit the column. */
function axisLines(label: string, max: number): string[] {
  if (label.length <= max) return [label];
  const words = label.split(/\s+/);
  const first: string[] = [];
  while (words.length && [...first, words[0]].join(' ').length <= max) first.push(words.shift() as string);
  if (!first.length) return [`${label.slice(0, max - 1)}…`];
  const rest = words.join(' ');
  return rest ? [first.join(' '), rest.length > max ? `${rest.slice(0, max - 1)}…` : rest] : [first.join(' ')];
}

/** A chart drawn in SVG: hover or focus a point for its detail, click the chart to open the records. */
function Chart({ c }: { c: PulseChartDto }) {
  const page = usePortalPage();
  const [hover, setHover] = useState<number | null>(null);
  const W = 320; const H = 156; const P = { l: 8, r: 8, t: 14, b: 32 };
  const values = c.points.map((p) => p.value ?? 0);
  const max = Math.max(1, ...values) * (c.unit === 'percent' ? 1 : 1.1);
  const top = c.unit === 'percent' ? 100 : max;
  const x = (i: number) => P.l + (c.points.length <= 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (c.points.length - 1));
  const y = (v: number) => P.t + (H - P.t - P.b) * (1 - v / top);
  const bw = Math.max(10, Math.min(46, (W - P.l - P.r) / c.points.length - 10));
  const shown = hover !== null ? c.points[hover] : null;
  const body = c.status === 'EMPTY' ? <div className="pb-empty">{c.emptyText}</div> : (
    <svg viewBox={`0 0 ${W} ${H}`} className="pb-svg" role="img" aria-label={`${c.title}: ${c.points.map((p) => `${p.label} ${fmtValue(c, p.value)}`).join(', ')}`}>
      {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={P.l} x2={W - P.r} y1={y(top * f)} y2={y(top * f)} className="pb-grid" />)}
      {c.type === 'line' && (
        <>
          <path d={`M ${c.points.map((p, i) => `${x(i)} ${y(p.value ?? 0)}`).join(' L ')} L ${x(c.points.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`} className="pb-area" />
          <polyline points={c.points.map((p, i) => `${x(i)},${y(p.value ?? 0)}`).join(' ')} className="pb-line" />
          {c.points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value ?? 0)} r={hover === i ? 5.5 : 3.5} className="pb-dot" tabIndex={0} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />)}
        </>
      )}
      {c.type !== 'line' && c.points.map((p, i) => {
        const cx = P.l + ((i + 0.5) * (W - P.l - P.r)) / c.points.length;
        const v = p.value ?? 0;
        // Every bar stays inside its own column. A funnel's narrowing is drawn by
        // height alone; scaling the width too pushed the first bar into its neighbour.
        const w = bw;
        return (
          <g key={i} tabIndex={0} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
            <rect x={cx - w / 2} y={y(v)} width={w} height={Math.max(1, y(0) - y(v))} rx={4} fill={TONE[p.tone ?? 'neutral']} opacity={hover === null || hover === i ? 0.9 : 0.4} className="pb-bar" />
            <text x={cx} y={y(v) - 4} className="pb-val" textAnchor="middle">{v ? fmtValue(c, v).replace('₹', '₹') : ''}</text>
          </g>
        );
      })}
      {c.points.map((p, i) => {
        if (c.type === 'line' && c.points.length > 7 && i % 2) return null;
        const cx = c.type === 'line' ? x(i) : P.l + ((i + 0.5) * (W - P.l - P.r)) / c.points.length;
        // Long labels ("Tour scheduled") wrap onto a second line instead of being cut.
        const lines = axisLines(p.label, Math.max(6, Math.floor(((W - P.l - P.r) / c.points.length) / 5.6)));
        return (
          <text key={`l${i}`} x={cx} y={H - (lines.length > 1 ? 14 : 8)} className="pb-axis" textAnchor="middle">
            {lines.map((line, k) => <tspan key={k} x={cx} dy={k ? 10 : 0}>{line}</tspan>)}
          </text>
        );
      })}
    </svg>
  );
  return (
    <div className="pb-chart card">
      <div className="pb-chart-head">
        <MaybeLink href={page(c.link)} className="pb-chart-title">{c.title}</MaybeLink>
        <span className="pb-readout" aria-live="polite">{shown ? <><b>{fmtValue(c, shown.value)}</b> {shown.label}{shown.detail ? ` · ${shown.detail}` : ''}</> : c.footnote ?? ''}</span>
      </div>
      {body}
      <div className="pb-def">{c.definition}</div>
    </div>
  );
}

/** A small isometric campus drawn from the same map data as Campus World, coloured by what is happening now. */
function MiniCampus() {
  const page = usePortalPage();
  const { permissions } = usePermissions();
  const state = useLoad(() => (permissions['campus.map.read'] ? opsApi.campusMap() : Promise.resolve(null)), [Boolean(permissions['campus.map.read'])]);
  const [hover, setHover] = useState<string | null>(null);
  if (!permissions['campus.map.read']) return null;
  return (
    <Loadable state={state}>{(map: CampusMapDto | null) => {
      if (!map || !map.facilities.length) return null;
      const nodes = map.facilities;
      const buildings = nodes.filter((n) => n.kind === 'BUILDING' && n.layout);
      const grounds = nodes.filter((n) => ['GROUND', 'COURT', 'PARKING', 'TRANSPORT_BAY'].includes(n.kind) && n.layout);
      const roomsIn = (b: CampusNodeDto) => {
        const floors = new Set(nodes.filter((n) => n.parentId === b.id).map((n) => n.id));
        return nodes.filter((n) => n.parentId && floors.has(n.parentId));
      };
      const busy = (b: CampusNodeDto) => roomsIn(b).filter((r) => r.now?.some((s) => ['SCHEDULED_CLASS', 'BOOKED', 'EVENT'].includes(s.type))).length;
      // Isometric projection of the plan (x, z) with height h.
      const S = 1.15;
      const iso = (x: number, z: number, h = 0) => [(x - z) * 0.866 * S, (x + z) * 0.5 * S - h * 1.6];
      const all = [...buildings, ...grounds].flatMap((n) => [iso(n.layout.x - n.layout.w / 2, n.layout.z - n.layout.d / 2), iso(n.layout.x + n.layout.w / 2, n.layout.z + n.layout.d / 2), iso(n.layout.x + n.layout.w / 2, n.layout.z - n.layout.d / 2, n.layout.h), iso(n.layout.x - n.layout.w / 2, n.layout.z + n.layout.d / 2)]);
      const xs = all.map((p) => p[0]); const ys = all.map((p) => p[1]);
      const box = [Math.min(...xs) - 12, Math.min(...ys) - 22, Math.max(...xs) - Math.min(...xs) + 24, Math.max(...ys) - Math.min(...ys) + 34];
      const poly = (pts: number[][]) => pts.map((p) => p.join(',')).join(' ');
      const prism = (n: CampusNodeDto, fillTop: string, h: number) => {
        const { x, z, w, d } = n.layout;
        const [x0, x1, z0, z1] = [x - w / 2, x + w / 2, z - d / 2, z + d / 2];
        return (
          <>
            <polygon points={poly([iso(x0, z1, 0), iso(x1, z1, 0), iso(x1, z1, h), iso(x0, z1, h)])} className="mc-side-a" />
            <polygon points={poly([iso(x1, z0, 0), iso(x1, z1, 0), iso(x1, z1, h), iso(x1, z0, h)])} className="mc-side-b" />
            <polygon points={poly([iso(x0, z0, h), iso(x1, z0, h), iso(x1, z1, h), iso(x0, z1, h)])} fill={fillTop} className="mc-top" />
          </>
        );
      };
      const ordered = [...buildings].sort((a, b) => (a.layout.x + a.layout.z) - (b.layout.x + b.layout.z));
      const hovered = buildings.find((b) => b.id === hover);
      return (
        <div className="pb-campus card">
          <div className="pb-chart-head">
            <MaybeLink href={page('/campus')} className="pb-chart-title">Campus now</MaybeLink>
            <span className="pb-readout" aria-live="polite">{hovered ? <><b>{hovered.name}</b> · {busy(hovered)} of {roomsIn(hovered).length} rooms in use</> : <>{map.kpis.roomsInUse} rooms in use · {map.kpis.roomsFree} free · {map.kpis.eventsToday} events</>}</span>
          </div>
          <Link href={page('/campus') ?? '#'} aria-label="Open Campus World" className="mc-link">
            <svg viewBox={box.join(' ')} className="mc-svg" role="img" aria-label={`Campus: ${buildings.map((b) => `${b.name}, ${busy(b)} rooms in use`).join('; ')}`}>
              {grounds.map((g) => <polygon key={g.id} points={poly([iso(g.layout.x - g.layout.w / 2, g.layout.z - g.layout.d / 2), iso(g.layout.x + g.layout.w / 2, g.layout.z - g.layout.d / 2), iso(g.layout.x + g.layout.w / 2, g.layout.z + g.layout.d / 2), iso(g.layout.x - g.layout.w / 2, g.layout.z + g.layout.d / 2)])} className={`mc-ground mc-${g.kind.toLowerCase()}`} />)}
              {ordered.map((b) => {
                const inUse = busy(b);
                const h = Math.max(4, b.layout.h || 4);
                return (
                  <g key={b.id} onMouseEnter={() => setHover(b.id)} onMouseLeave={() => setHover(null)} className={hover === b.id ? 'mc-b is-hover' : 'mc-b'}>
                    {prism(b, inUse ? '#2F6FE4' : ROOFS[buildings.indexOf(b) % ROOFS.length], h)}
                    {inUse > 0 && <circle cx={iso(b.layout.x, b.layout.z, h)[0]} cy={iso(b.layout.x, b.layout.z, h)[1] - 8} r={6} className="mc-pulse" />}
                  </g>
                );
              })}
            </svg>
          </Link>
          <div className="pb-def">{map.sampleLayout ? 'Sample layout. ' : ''}A pulsing dot marks a building with a class, booking or event right now, by the timetable. Click to walk the campus in 3D.</div>
        </div>
      );
    }}</Loadable>
  );
}

function Briefing({ lines, greet }: { lines: string[]; greet: boolean }) {
  const [speaking, setSpeaking] = useState(false);
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const utter = useRef<SpeechSynthesisUtterance | null>(null);
  useEffect(() => () => { if (canSpeak) window.speechSynthesis.cancel(); }, [canSpeak]);
  const toggle = () => {
    if (!canSpeak) return;
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
    const u = new SpeechSynthesisUtterance(lines.join(' '));
    u.lang = 'en-IN'; u.rate = 1;
    u.onend = () => setSpeaking(false);
    utter.current = u;
    window.speechSynthesis.speak(u);
    setSpeaking(true);
  };
  return (
    <div className="pb-brief">
      <div className="pb-brief-text">
        {greet && <div className="pb-brief-hello">{lines[0]}</div>}
        <div>{lines.slice(1).join(' ')}</div>
      </div>
      {canSpeak && <button type="button" className="btn btn-accent btn-sm" onClick={toggle} aria-pressed={speaking}>{speaking ? '■ Stop' : '▶ Brief me'}</button>}
    </div>
  );
}

/** `greet` is off where the page already greets the person (the role home). */
export function PulseBoard({ showBriefing = true, greet = true }: { showBriefing?: boolean; greet?: boolean }) {
  const state = useLoad(() => opsApi.pulse(), []);
  const page = usePortalPage();
  // Live without reloading the page: the feed and charts refresh every two minutes.
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void state.reload(); }, 120_000);
    return () => window.clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reload is stable for this hook's lifetime
  }, []);
  return (
    <Loadable state={state}>{(p: PulseDto) => (
      <div className="pb-board">
        {showBriefing && <Briefing lines={p.briefing} greet={greet} />}
        {p.departments.length > 0 && (
          <div className="pb-depts" role="list" aria-label="Departments">
            {p.departments.map((d) => (
              <MaybeLink key={d.key} href={page(d.link)} role="listitem" plain className={`pb-dept card${d.attention ? ' is-attention' : ''}`}>
                <div className="pb-dept-name">{d.name}{d.attention && <span className="pb-dot-warn" aria-label="needs attention" />}</div>
                {d.lines.map(([n, what], i) => <div key={i} className="pb-dept-line"><b>{n ?? '—'}</b> {what}</div>)}
              </MaybeLink>
            ))}
          </div>
        )}
        <div className="pb-grid-main">
          <div className="pb-charts">
            <MiniCampus />
            {p.charts.map((c) => <Chart key={c.key} c={c} />)}
          </div>
          <aside className="pb-feed card" aria-label="What just happened">
            <div className="pb-feed-head"><b>What just happened</b><span className="pb-live" aria-hidden="true">● Live</span></div>
            {!p.activity.length ? <p className="ops-muted">Nothing new in the last two weeks.</p> : (
              <ul className="pb-feed-list">
                {p.activity.map((a, i) => (
                  <li key={i}>
                    <MaybeLink href={page(a.link)} plain className={`pb-feed-item k-${a.kind}`}>
                      <span className="pb-feed-icon" aria-hidden="true">{ICON[a.kind] ?? '•'}</span>
                      <span className="pb-feed-text">{a.text}</span>
                      <span className="pb-feed-time">{relative(a.at)}</span>
                    </MaybeLink>
                  </li>
                ))}
              </ul>
            )}
            <div className="pb-def">Updated {fmtDateTime(p.asOf)}. Refreshes every two minutes.</div>
          </aside>
        </div>
      </div>
    )}</Loadable>
  );
}

export function usePulseCount(p: PulseDto | null) {
  return useMemo(() => (p ? p.charts.length + p.departments.length : 0), [p]);
}
