'use client';
import { useState } from 'react';
import type { CampusLayersDto, CampusOptionalLayerDto } from '@/lib/ops-types';
import { fmtDateTime, humanize } from '@/components/ops/kit';

/**
 * Operational layers over the campus map: labs, the transport bay, substitute
 * cover, tasks, the gate, and (once their modules are installed) sports, arts
 * and greenery. Each comes from GET /campus/layers, which sends a layer only to
 * readers allowed the underlying read; this component shows what arrived and
 * nothing else. The gate is two counts: no visitor or child is named.
 */

export type LayerKey = 'labs' | 'transport' | 'cover' | 'tasks' | 'gate' | 'activities' | 'greenery';
const LABEL: Record<LayerKey, string> = { labs: 'Labs', transport: 'Transport', cover: 'Cover', tasks: 'Tasks', gate: 'Gate', activities: 'Sports & arts', greenery: 'Greenery' };
const ICON: Record<LayerKey, string> = { labs: '⚗', transport: '⛟', cover: '⇄', tasks: '☑', gate: '⛩', activities: '⚽', greenery: '❦' };
const POS_TONE: Record<string, string> = { LIVE: 'good', STALE: 'warn', OFFLINE: 'bad', NO_DATA: 'neutral' };
const POS_LABEL: Record<string, string> = { LIVE: 'Live', STALE: 'Stale', OFFLINE: 'Offline', NO_DATA: 'No GPS' };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The number shown on a layer's chip: what needs attention in it. */
export function layerCount(d: CampusLayersDto, key: LayerKey): number | null {
  switch (key) {
    case 'labs': return (d.labs ?? []).filter((l) => l.practicalNow).length;
    case 'transport': return d.transport?.vehicles.length ?? null;
    case 'cover': return d.cover?.now.length ?? null;
    case 'tasks': return d.tasks?.overdue ?? null;
    case 'gate': return (d.gate?.visitorsOnSite ?? 0) + (d.gate?.studentsOutOnPass ?? 0);
    case 'activities': case 'greenery': return d[key]?.available ? d[key]?.items?.length ?? 0 : null;
    default: return null;
  }
}

/** Layers that arrived for this reader, in a fixed order. */
export function availableLayers(d: CampusLayersDto | null | undefined): LayerKey[] {
  if (!d) return [];
  return (Object.keys(LABEL) as LayerKey[]).filter((k) => d.layers?.[k] && d[k] !== undefined);
}

function OptionalRows({ layer, emptyText, countLabel }: { layer: CampusOptionalLayerDto | null | undefined; emptyText: string; countLabel?: string }) {
  if (!layer) return <li className="cw-empty">Not available right now.</li>;
  if (!layer.available) return <li className="cw-empty">{layer.note ?? 'This module is not installed yet.'}</li>;
  const totals = Object.entries(layer.totals ?? {});
  return (
    <>
      {totals.length > 0 && <li className="cwl-totals">{totals.map(([k, v]) => <span key={k}><b>{v}</b> {humanize(k).toLowerCase()}</span>)}</li>}
      {(layer.items ?? []).length ? (layer.items ?? []).slice(0, 12).map((it, i) => (
        <li key={String(it.id ?? i)} className="cwl-row">
          <b>{String(it.title ?? it.club ?? it.clubName ?? it.activity ?? it.label ?? it.zone ?? 'Activity')}</b>
          <span className="cw-row-sub">{[it.venue ?? it.venueName ?? it.area, it.startTime ? `${it.startTime}${it.endTime ? `–${it.endTime}` : ''}` : null, typeof it.participants === 'number' ? plural(it.participants, 'taking part', 'taking part') : null, it.value !== undefined && it.value !== null ? `${it.value}${it.unit ? ` ${it.unit}` : ''}` : null, countLabel && typeof it.count === 'number' && it.count > 0 ? `${it.count} ${countLabel}` : null, it.label === 'Now' ? 'now' : null].filter(Boolean).join(' · ')}</span>
        </li>
      )) : <li className="cw-empty">{emptyText}</li>}
    </>
  );
}

/** The "Operations now" box over the map. `onGo` moves the camera to a facility. */
export function CampusLayersPanel({ data, onGo }: { data: CampusLayersDto | null | undefined; onGo?: (facilityId: string) => void }) {
  const keys = availableLayers(data);
  const [open, setOpen] = useState<LayerKey | null>(null);
  if (!data || !keys.length) return null;
  const go = (id: string | null | undefined) => (id && onGo ? () => onGo(id) : undefined);
  const d = data;
  return (
    <div className="cw-glass cwl" role="group" aria-label="Operations now">
      <div className="cwl-head">
        <span className="cw-depts-title">Operations now</span>
        <div className="cwl-chips">
          {keys.map((k) => {
            const n = layerCount(d, k);
            const tone = k === 'tasks' && n ? 'bad' : k === 'transport' && (d.transport?.offline || d.transport?.dueSoon) ? 'warn' : 'neutral';
            return (
              <button key={k} type="button" className={`cw-dept${open === k ? ' is-on' : ''}`} aria-pressed={open === k} aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)}>
                <span className="cw-dept-icon" aria-hidden="true">{ICON[k]}</span>
                <span className="cw-dept-name">{LABEL[k]}</span>
                {n !== null && <span className={`cw-dept-num is-${tone}`}>{n}</span>}
              </button>
            );
          })}
        </div>
      </div>
      {d.unavailable.length > 0 && <p className="cwl-note">Not available right now: {d.unavailable.map((k) => LABEL[k as LayerKey] ?? k).join(', ')}.</p>}
      {open && (
        <ul className="cw-rows cwl-list" aria-label={LABEL[open]}>
          {open === 'labs' && ((d.labs ?? []).length ? (d.labs ?? []).map((l) => (
            <li key={l.labId}><button type="button" onClick={go(l.facilityId)} disabled={!l.facilityId}>
              <b>{l.name}</b>
              <span className="cw-row-sub">{l.practicalNow ? `Practical now: ${l.practicalNow.title}${l.practicalNow.className ? ` · ${l.practicalNow.className}` : ''}` : 'No practical in session'}</span>
              <span className={`cw-pill${l.openIncidents ? ' is-orange' : ''}`}>{l.openIncidents === null ? 'not your lab' : [l.openIncidents ? plural(l.openIncidents, 'incident') : null, l.lowStock ? `${l.lowStock} low` : null, l.expiringSoon ? `${l.expiringSoon} expiring` : null].filter(Boolean).join(' · ') || 'all clear'}</span>
              <span aria-hidden="true">›</span>
            </button></li>
          )) : <li className="cw-empty">No labs you can see.</li>)}

          {open === 'transport' && d.transport && (
            <>
              <li className="cwl-totals"><span><b>{d.transport.live}</b> live</span><span><b>{d.transport.stale}</b> stale</span><span><b>{d.transport.offline}</b> offline</span><span><b>{d.transport.dueSoon}</b> with papers or service due</span></li>
              {d.transport.vehicles.length ? d.transport.vehicles.map((v) => {
                const trip = v.trips.find((t) => t.status === 'IN_PROGRESS') ?? v.trips[0];
                const due = [...v.documentsDue.map((x) => humanize(x.kind)), ...v.checksDue.map((x) => humanize(x.kind))];
                return (
                  <li key={v.id}><button type="button" onClick={go(d.transport?.facilityId)} disabled={!d.transport?.facilityId}>
                    <b>{v.registrationNo}{trip ? ` · ${trip.routeName ?? humanize(trip.kind)}` : ''}</b>
                    <span className="cw-row-sub">{[trip ? `${trip.seatsUsed}/${trip.capacity} seats` : 'No trip today', due.length ? `Due: ${due.join(', ')}` : null, v.blocked ? 'Cannot run: papers expired' : null].filter(Boolean).join(' · ')}</span>
                    <span className={`cw-pill cwl-tone-${POS_TONE[v.positionStatus] ?? 'neutral'}`}>{POS_LABEL[v.positionStatus] ?? humanize(v.positionStatus)}</span>
                    <span aria-hidden="true">›</span>
                  </button></li>
                );
              }) : <li className="cw-empty">No vehicles recorded.</li>}
            </>
          )}

          {open === 'cover' && d.cover && (d.cover.now.length ? d.cover.now.map((c, i) => (
            <li key={i}><button type="button" onClick={go(c.facilityId)} disabled={!c.facilityId}>
              <b>{c.room ?? c.className ?? 'Class'}{c.className && c.room ? ` · ${c.className}` : ''}</b>
              <span className="cw-row-sub">{c.label}</span>
              <span className="cw-pill">P{c.periodNo} · {c.startTime}–{c.endTime}</span>
              <span aria-hidden="true">›</span>
            </button></li>
          )) : <li className="cw-empty">No substitute is teaching right now{d.cover.today ? ` (${plural(d.cover.today, 'cover')} today)` : ''}.</li>)}

          {open === 'tasks' && d.tasks && (
            <>
              <li className="cwl-totals"><span><b>{d.tasks.overdue}</b> overdue</span><span><b>{d.tasks.dueThisWeek}</b> due this week</span>{d.tasks.scope !== 'ALL' && <span>yours only</span>}</li>
              {d.tasks.byDepartment.length ? d.tasks.byDepartment.map((r) => (
                <li key={r.department} className="cwl-row"><b>{humanize(r.department)}</b><span className="cw-row-sub">{r.overdue} overdue · {r.dueThisWeek} due this week · {r.open} open</span></li>
              )) : <li className="cw-empty">Nothing open.</li>}
            </>
          )}

          {open === 'gate' && d.gate && (
            <li><button type="button" onClick={go(d.gate.facilityId)} disabled={!d.gate.facilityId}>
              <b>Gate</b>
              <span className="cw-row-sub">{[d.gate.visitorsOnSite !== null ? plural(d.gate.visitorsOnSite, 'visitor') + ' on site' : null, d.gate.studentsOutOnPass !== null ? `${plural(d.gate.studentsOutOnPass, 'student')} out on a pass` : null].filter(Boolean).join(' · ')}</span>
              <span className="cw-pill">counts only</span>
              <span aria-hidden="true">›</span>
            </button></li>
          )}

          {open === 'activities' && <OptionalRows layer={d.activities} emptyText="No club or team session today." />}
          {open === 'greenery' && <OptionalRows layer={d.greenery} emptyText="No green zones recorded yet." countLabel="sanitation tasks open" />}
        </ul>
      )}
      <p className="cwl-note">From each module&apos;s own records, as of {fmtDateTime(d.asOf)}.</p>
    </div>
  );
}

/** What the layers say about one place, for the room panel. */
export function RoomLayerFacts({ data, facilityId }: { data: CampusLayersDto | null | undefined; facilityId: string }) {
  if (!data) return null;
  const lab = data.labs?.find((l) => l.facilityId === facilityId) ?? null;
  const covers = data.cover?.now.filter((c) => c.facilityId === facilityId) ?? [];
  const bay = data.transport && data.transport.facilityId === facilityId ? data.transport : null;
  const gate = data.gate && data.gate.facilityId === facilityId ? data.gate : null;
  if (!lab && !covers.length && !bay && !gate) return null;
  return (
    <div className="cwl-facts" aria-label="Operations here">
      {covers.map((c, i) => <div key={i} className="cwl-cover"><span>Substitute now</span><b>{c.label}</b></div>)}
      {lab && (
        <dl className="cw-facts">
          <dt>Practical now</dt><dd>{lab.practicalNow ? `${lab.practicalNow.title}${lab.practicalNow.className ? ` · ${lab.practicalNow.className}` : ''}` : 'None'}</dd>
          {lab.openIncidents !== null && <><dt>Open incidents</dt><dd>{lab.openIncidents}</dd></>}
          {lab.lowStock !== null && <><dt>Low stock</dt><dd>{lab.lowStock}</dd></>}
          {lab.expiringSoon !== null && <><dt>Expiring or expired</dt><dd>{lab.expiringSoon}</dd></>}
        </dl>
      )}
      {bay && (
        <dl className="cw-facts">
          <dt>Vehicles</dt><dd>{bay.vehicles.length}</dd>
          <dt>Live / stale / offline</dt><dd>{bay.live} / {bay.stale} / {bay.offline}</dd>
          <dt>Papers or service due</dt><dd>{bay.dueSoon}</dd>
        </dl>
      )}
      {gate && (
        <dl className="cw-facts">
          {gate.visitorsOnSite !== null && <><dt>Visitors on site</dt><dd>{gate.visitorsOnSite}</dd></>}
          {gate.studentsOutOnPass !== null && <><dt>Students out on a pass</dt><dd>{gate.studentsOutOnPass}</dd></>}
        </dl>
      )}
    </div>
  );
}

/** A department's open tasks, for the department panel. */
export function DepartmentTasks({ data, code }: { data: CampusLayersDto | null | undefined; code: string }) {
  const rows = data?.tasks?.byDepartment.filter((r) => r.mapDepartment === code) ?? [];
  if (!rows.length) return null;
  const overdue = rows.reduce((n, r) => n + r.overdue, 0);
  const week = rows.reduce((n, r) => n + r.dueThisWeek, 0);
  return (
    <div className="cw-metrics" aria-label="Tasks">
      <div className={`cw-metric is-${overdue ? 'bad' : 'good'}`}><b>{overdue}</b><span>tasks overdue</span></div>
      <div className="cw-metric"><b>{week}</b><span>due this week</span></div>
    </div>
  );
}
