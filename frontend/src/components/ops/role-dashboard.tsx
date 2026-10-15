'use client';
import Link from 'next/link';
import { useState } from 'react';
import { dashboardApi, type DashKpi, type DashList, type DashListItem, type RoleDashboardDto } from '@/lib/dashboard-api';
import { usePortalPage } from '@/lib/school-path';
import { DashChart, Sparkline, fmtDash } from './dash-charts';
import { Loadable, fmtDateTime, useLoad } from './kit';

/**
 * The signed-in person's own dashboard, under the pulse board: a teacher's
 * classes, a parent's child (switch between children), a student's record, or
 * the queue a finance, HR, library, hostel, admissions, compliance or trustee
 * role runs. Every tile, chart mark and list row opens the page behind it.
 * Roles without one (principal, admin, alumni) render nothing here.
 */

const TONE_MARK: Record<string, string> = { bad: '⚠', warn: '●', good: '✓' };
const TONE_WORD: Record<string, string> = { bad: 'needs attention', warn: 'worth a look', good: 'on track' };

function Kpi({ k }: { k: DashKpi }) {
  const page = usePortalPage();
  const href = page(k.link);
  const body = (
    <>
      <span className="rd-kpi-label">{k.label}</span>
      <span className="rd-kpi-value">{fmtDash(k.unit, k.value)}</span>
      {k.spark && <Sparkline values={k.spark} label={k.label} unit={k.unit} />}
      <span className="rd-kpi-detail">
        {TONE_MARK[k.tone] && <span aria-hidden="true" className="rd-kpi-mark">{TONE_MARK[k.tone]} </span>}
        {k.detail}
        {TONE_WORD[k.tone] && <span className="sr-only"> ({TONE_WORD[k.tone]})</span>}
      </span>
    </>
  );
  return href
    ? <Link href={href} className={`rd-kpi tone-${k.tone}`} role="listitem">{body}</Link>
    : <div className={`rd-kpi tone-${k.tone}`} role="listitem">{body}</div>;
}

/** "Now" for a timetable row whose period is running (school time zone). */
function isNow(item: DashListItem) {
  if (!item.start || !item.end) return false;
  const hm = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
  return hm >= item.start && hm < item.end;
}

function ListCard({ l }: { l: DashList }) {
  const page = usePortalPage();
  const head = page(l.link);
  return (
    <section className="card rd-list" aria-label={l.title}>
      <div className="rd-list-head">
        {head ? <Link href={head} className="pb-chart-title">{l.title} <span aria-hidden="true">→</span></Link> : <span className="pb-chart-title">{l.title}</span>}
        {l.items.length > 0 && <span className="rd-count">{l.items.length}</span>}
      </div>
      {!l.items.length ? <p className="pb-empty rd-empty">{l.empty}</p> : (
        <ul className="rd-items">
          {l.items.map((i, n) => {
            const now = isNow(i);
            const inner = (
              <>
                <span className="rd-item-main">
                  <span className="rd-item-text">{i.text}</span>
                  {i.sub && <span className="rd-item-sub">{i.sub}</span>}
                </span>
                {(now || i.badge) && <span className={`rd-badge tone-${now ? 'good' : i.tone ?? 'neutral'}`}>{now ? 'Now' : i.badge}</span>}
              </>
            );
            // A digest item links out to its source; everything else opens a page in the portal.
            const internal = page(i.link ?? null);
            return (
              <li key={n} className={`rd-item tone-${i.tone ?? 'neutral'}${now ? ' is-now' : ''}`}>
                {i.href ? <a href={i.href} target="_blank" rel="noopener noreferrer nofollow" className="rd-item-link">{inner}<span className="sr-only"> (opens the source in a new tab)</span></a>
                  : internal ? <Link href={internal} className="rd-item-link">{inner}</Link>
                    : <div className="rd-item-link">{inner}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * `childId`/`onChildChange` let a page that already has a child switcher (the
 * parent home) drive this one, so the two never show different children.
 */
export function RoleDashboard({ childId, onChildChange }: { childId?: string | null; onChildChange?: (id: string) => void } = {}) {
  const [days, setDays] = useState<number | null>(null);
  const [own, setOwn] = useState<string | null>(null);
  const child = childId !== undefined ? childId : own;
  const setChild = (id: string) => (onChildChange ? onChildChange(id) : setOwn(id));
  const state = useLoad(() => dashboardApi.get({ days, child }), [days, child]);
  return (
    <Loadable state={state}>{(d: RoleDashboardDto) => {
      if (!d.view) return null;
      return (
        <div className="rd-root" aria-busy={state.loading}>
          <div className="rd-bar card">
            <div className="rd-title">
              <h2>{d.title ?? 'My dashboard'}</h2>
              {d.child && <span className="an-muted">{d.child.className}{d.child.classSize ? ` · class of ${d.child.classSize}` : ''}</span>}
            </div>
            {d.children && d.children.length > 1 && (
              <div className="rd-chips" role="radiogroup" aria-label="Child">
                {d.children.map((c) => (
                  <button key={c.id} type="button" role="radio" aria-checked={d.child?.id === c.id} className={`rd-chip${d.child?.id === c.id ? ' is-on' : ''}`} onClick={() => setChild(c.id)}>
                    {c.name}{c.className ? <span className="an-muted"> · {c.className}</span> : null}
                  </button>
                ))}
              </div>
            )}
            {d.period.options.length > 1 && (
              <div className="rd-seg" role="group" aria-label="Period">
                {d.period.options.map((o) => (
                  <button key={o.days} type="button" aria-pressed={d.period.days === o.days} className={`rd-seg-btn${d.period.days === o.days ? ' is-on' : ''}`} onClick={() => setDays(o.days)}>{o.label}</button>
                ))}
              </div>
            )}
            <button type="button" className="btn btn-soft btn-sm" onClick={() => void state.reload()} disabled={state.loading}>{state.loading ? 'Updating…' : '↻ Refresh'}</button>
          </div>
          {d.kpis.length > 0 && <div className="rd-kpis" role="list" aria-label="Key figures">{d.kpis.map((k) => <Kpi key={k.key} k={k} />)}</div>}
          {d.charts.length > 0 && <div className="rd-charts">{d.charts.map((c) => <DashChart key={`${c.key}-${d.period.days}-${d.child?.id ?? ''}`} c={c} />)}</div>}
          {d.lists.length > 0 && <div className="rd-lists">{d.lists.map((l) => <ListCard key={l.key} l={l} />)}</div>}
          {d.notes.length > 0 && <div className="rd-notes">{d.notes.map((n, i) => <p key={i} className="pb-def">{n}</p>)}</div>}
          <p className="pb-def">Updated {fmtDateTime(d.asOf)}. Tap any figure, bar or row to open the records behind it; every chart has a table view.</p>
        </div>
      );
    }}</Loadable>
  );
}
