'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { opsApi } from '@/lib/ops-api';
import { usePermissions } from '@/lib/permissions';
import { useSchoolHref } from '@/lib/school-path';
import type { CampusMapDto, CampusNodeDto, FacilityDetailDto } from '@/lib/ops-types';
import { BookRoomModal, ReportIssueModal } from '@/components/ops/operations-views';
import { DataNote, ErrorNote, StatusPill, fmtDateTime, humanize, useLoad } from '@/components/ops/kit';
import type { CampusScene, Level } from './campus-scene';

/**
 * Campus World — the 3D view of the institution with what is happening in
 * it, filtered for the viewer on the server. Nested: campus → building →
 * floor → room → "Open full details". Every number and colour is labelled
 * with where it comes from; moving figures are illustrative only.
 */

const COLORS_LEGEND: Array<[string, string]> = [
  ['FREE', 'Free now'], ['SCHEDULED_CLASS', 'Class (timetable)'], ['BOOKED', 'Booked'], ['EVENT', 'Event'], ['UNDER_MAINTENANCE', 'Maintenance'], ['CLOSED', 'Closed'], ['RESTRICTED', 'Restricted'],
];

function useReducedMotion() {
  const [rm, setRm] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setRm(mq.matches);
    const on = (e: MediaQueryListEvent) => setRm(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return rm;
}

function stateLabel(n: CampusNodeDto) {
  if (n.restricted && n.name === 'Restricted area') return 'Restricted';
  if (n.status !== 'ACTIVE') return humanize(n.status);
  const s = n.now?.[0];
  return s ? `${s.label}${s.until ? ` · until ${String(s.until).length <= 5 ? s.until : fmtDateTime(s.until)}` : ''}` : n.now ? 'Free now' : '';
}

export function CampusWorldView() {
  const { permissions } = usePermissions();
  const link = useSchoolHref();
  const map = useLoad(() => opsApi.campusMap(), []);
  const holder = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CampusScene | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const prefersReduced = useReducedMotion();
  const [reducedMotion, setReducedMotion] = useState(false);
  const [lowPower, setLowPower] = useState(false);
  const [night, setNight] = useState(() => { const h = new Date(Date.now() + 330 * 60_000).getUTCHours(); return h >= 19 || h < 6; });
  const [level, setLevel] = useState<Level>({ kind: 'campus' });
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<FacilityDetailDto | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [labels, setLabels] = useState<Array<{ id: string; x: number; y: number; visible: boolean }>>([]);
  const [fps, setFps] = useState(0);
  const [view, setView] = useState<'3d' | 'list'>('3d');
  const [modal, setModal] = useState<null | 'book' | 'issue'>(null);

  useEffect(() => { setReducedMotion(prefersReduced); }, [prefersReduced]);
  useEffect(() => {
    try { setLowPower(localStorage.getItem('eduos.campus.lowPower') === '1' || (navigator.hardwareConcurrency ?? 8) <= 4); } catch { /* storage unavailable */ }
  }, []);

  const nodes = useMemo(() => map.data?.facilities ?? [], [map.data]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const buildings = useMemo(() => nodes.filter((n) => n.kind === 'BUILDING'), [nodes]);

  // Mount the scene once data and the container exist; Three.js is loaded only here.
  useEffect(() => {
    if (view !== '3d' || !holder.current || !map.data) return;
    let disposed = false;
    let scene: CampusScene | null = null;
    void (async () => {
      const mod = await import('./campus-scene');
      if (disposed || !holder.current) return;
      if (!mod.webglAvailable()) { setSupported(false); return; }
      setSupported(true);
      scene = new mod.CampusScene(holder.current, {
        lowPower, reducedMotion, night,
        onSelect: (id) => setSelected(id),
      });
      scene.setData(map.data!.facilities);
      sceneRef.current = scene;
    })();
    return () => { disposed = true; scene?.dispose(); sceneRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- options are pushed to the live scene below
  }, [view, map.data]);

  useEffect(() => { sceneRef.current?.applyLighting(night); }, [night]);
  useEffect(() => { sceneRef.current?.setQuality(lowPower); try { localStorage.setItem('eduos.campus.lowPower', lowPower ? '1' : '0'); } catch { /* ignore */ } }, [lowPower]);
  useEffect(() => { sceneRef.current?.setMotion(reducedMotion); }, [reducedMotion]);
  useEffect(() => { sceneRef.current?.setLevel(level); }, [level]);

  // Refresh what is happening every minute (not decorative: real records).
  useEffect(() => {
    const t = window.setInterval(() => { void map.reload(); }, 60_000);
    return () => window.clearInterval(t);
  }, [map]);
  useEffect(() => { if (map.data && sceneRef.current) sceneRef.current.setData(map.data.facilities); }, [map.data]);

  // Labels for buildings (campus level) or rooms on the floor (building level), plus the selection.
  useEffect(() => {
    const t = window.setInterval(() => {
      const s = sceneRef.current;
      if (!s) return;
      const ids = level.kind === 'campus'
        ? buildings.map((b) => b.id)
        : nodes.filter((n) => byId.get(n.parentId ?? '')?.kind === 'FLOOR' && byId.get(n.parentId ?? '')?.parentId === level.buildingId && (byId.get(n.parentId ?? '')?.floorNo ?? 0) === (level.floorNo ?? 0)).map((n) => n.id);
      setLabels(s.project(selected && !ids.includes(selected) ? [...ids, selected] : ids));
      setFps(s.fps);
    }, reducedMotion ? 600 : 200);
    return () => window.clearInterval(t);
  }, [level, buildings, nodes, byId, selected, reducedMotion]);

  // Selection: ring + glide + the room's detail from the API.
  const loadDetail = useCallback(async (id: string) => {
    setDetailErr(null);
    try { setDetail(await opsApi.campusFacility(id)); } catch (e) { setDetail(null); setDetailErr(e instanceof Error ? e.message : 'Could not load'); }
  }, []);
  useEffect(() => {
    sceneRef.current?.highlight(selected);
    if (selected) { sceneRef.current?.focus(selected); void loadDetail(selected); } else setDetail(null);
  }, [selected, loadDetail]);

  const sel = selected ? byId.get(selected) : null;
  const enterBuilding = (b: CampusNodeDto) => {
    const floors = nodes.filter((n) => n.parentId === b.id && n.kind === 'FLOOR').sort((a, c) => (a.floorNo ?? 0) - (c.floorNo ?? 0));
    setLevel({ kind: 'building', buildingId: b.id, floorNo: floors[0]?.floorNo ?? 0 });
    setSelected(null);
  };
  const building = level.kind === 'building' ? byId.get(level.buildingId) : null;
  const floors = building ? nodes.filter((n) => n.parentId === building.id && n.kind === 'FLOOR').sort((a, c) => (a.floorNo ?? 0) - (c.floorNo ?? 0)) : [];

  if (map.error) return <ErrorNote error={map.error} />;
  if (!map.data) return <div className="cw-wrap"><div className="cw-fallback">Loading campus…</div></div>;
  const d: CampusMapDto = map.data;

  if (!nodes.length) {
    return (
      <div className="ops-stack">
        <DataNote>No buildings or rooms are recorded yet. {permissions['facilities.manage'] ? 'Add your facilities, or create a labelled sample campus from Facilities → Spaces to try the view.' : 'Ask the administration office to add the campus facilities.'}</DataNote>
        {permissions['facilities.manage'] && <Link className="btn btn-accent" href={link('/facilities?tab=spaces')}>Go to Facilities</Link>}
      </div>
    );
  }

  const listView = (
    <div className="ops-stack">
      {buildings.map((b) => (
        <div key={b.id} className="ops-section card card-pad">
          <div className="ops-section-head"><h2 className="ops-section-title">{b.name}</h2><Button small variant="soft" onClick={() => { setView('3d'); enterBuilding(b); }}>Show in 3D</Button></div>
          {nodes.filter((f) => f.parentId === b.id && f.kind === 'FLOOR').sort((a, c) => (a.floorNo ?? 0) - (c.floorNo ?? 0)).map((f) => (
            <div key={f.id}><h3 className="field-label">{f.name}</h3>
              <ul className="ops-list">{nodes.filter((r) => r.parentId === f.id).map((r) => (
                <li key={r.id} className="ops-row"><div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => { setSelected(r.id); }}><div className="ops-row-title">{r.name}</div><div className="ops-row-sub">{humanize(r.kind)}{r.capacity ? ` · ${r.capacity} seats` : ''} · {stateLabel(r)}</div></button></div></li>
              ))}</ul>
            </div>
          ))}
        </div>
      ))}
      <div className="ops-section card card-pad"><h2 className="ops-section-title">Grounds & outdoor</h2><ul className="ops-list">{nodes.filter((n) => ['GROUND', 'COURT', 'PARKING', 'TRANSPORT_BAY', 'GATE'].includes(n.kind)).map((n) => <li key={n.id} className="ops-row"><div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setSelected(n.id)}><div className="ops-row-title">{n.name}</div><div className="ops-row-sub">{humanize(n.kind)}{n.capacity ? ` · ${n.capacity}` : ''} · {stateLabel(n)}</div></button></div></li>)}</ul></div>
    </div>
  );

  return (
    <div className="ops-stack">
      <div className="ops-inline">
        <div className="seg-toggle" role="group" aria-label="View">
          <button type="button" className={`seg-btn${view === '3d' ? ' is-on' : ''}`} aria-pressed={view === '3d'} onClick={() => setView('3d')}>◈ 3D campus</button>
          <button type="button" className={`seg-btn${view === 'list' ? ' is-on' : ''}`} aria-pressed={view === 'list'} onClick={() => setView('list')}>☰ List</button>
        </div>
        {d.campuses.length > 1 && <span className="ops-muted">{d.campuses.length} campuses</span>}
        <span className="ops-muted">As of {fmtDateTime(d.asOf)} (IST {d.localTime}) · refreshes every minute</span>
      </div>
      {d.sampleLayout && <div className="ops-callout is-warn">This is a <b>sample layout</b>, not a survey of your campus. Replace it with your buildings and rooms in Facilities → Spaces.</div>}

      {view === 'list' || supported === false ? (
        <>
          {supported === false && <DataNote>3D needs WebGL, which this device or browser does not offer. Here is the same information as a list.</DataNote>}
          {listView}
        </>
      ) : (
        <div className="cw-wrap">
          <div ref={holder} className="cw-canvas" />
          {labels.filter((l) => l.visible).map((l) => {
            const n = byId.get(l.id);
            if (!n) return null;
            return <div key={l.id} className={`cw-label${l.id === selected ? ' is-selected' : ''}`} style={{ left: l.x, top: l.y }} aria-hidden="true">{n.name}{n.kind !== 'BUILDING' && n.now?.[0] ? ` · ${n.now[0].type === 'SCHEDULED_CLASS' ? 'class' : n.now[0].type.toLowerCase()}` : ''}</div>;
          })}
          <div className="cw-overlay">
            <div className="cw-top">
              <div className="cw-glass cw-kpis" aria-label="Campus now">
                <div className="cw-kpi"><b>{d.kpis.roomsInUse}</b><span>rooms in use</span></div>
                <div className="cw-kpi"><b>{d.kpis.roomsFree}</b><span>rooms free</span></div>
                <div className="cw-kpi"><b>{d.kpis.outOfUse}</b><span>out of use</span></div>
                <div className="cw-kpi"><b>{d.kpis.eventsToday}</b><span>events today</span></div>
                {d.kpis.openWorkOrders !== undefined && <div className="cw-kpi"><b>{d.kpis.openWorkOrders}</b><span>open repairs</span></div>}
              </div>
              <div className="cw-glass cw-controls" role="group" aria-label="Camera">
                <button type="button" onClick={() => sceneRef.current?.zoom(0.8)} aria-label="Zoom in">+</button>
                <button type="button" onClick={() => sceneRef.current?.zoom(1.25)} aria-label="Zoom out">−</button>
                <button type="button" onClick={() => sceneRef.current?.rotate(Math.PI / 8)} aria-label="Rotate left">⟲</button>
                <button type="button" onClick={() => sceneRef.current?.rotate(-Math.PI / 8)} aria-label="Rotate right">⟳</button>
                <button type="button" onClick={() => { setLevel({ kind: 'campus' }); setSelected(null); sceneRef.current?.home(); }} aria-label="Home view">⌂</button>
              </div>
            </div>
            <div className="cw-bottom">
              <div className="cw-glass" style={{ maxWidth: 560 }}>
                <nav className="cw-crumbs" aria-label="Location">
                  <button type="button" onClick={() => { setLevel({ kind: 'campus' }); setSelected(null); }}>{d.institution ?? 'Campus'}</button>
                  {building && <><span aria-hidden="true">›</span><button type="button" onClick={() => setSelected(null)}>{building.name}</button></>}
                  {building && <><span aria-hidden="true">›</span><span>{floors.find((f) => (f.floorNo ?? 0) === (level.kind === 'building' ? level.floorNo : 0))?.name.split('·').pop()?.trim() ?? 'Floor'}</span></>}
                  {sel && sel.kind !== 'BUILDING' && sel.kind !== 'FLOOR' && <><span aria-hidden="true">›</span><b>{sel.name}</b></>}
                </nav>
                {level.kind === 'campus' && <div className="ops-inline" style={{ marginTop: 6 }}>{buildings.map((b) => <Button key={b.id} small variant="soft" onClick={() => enterBuilding(b)}>{b.name}</Button>)}</div>}
                {building && floors.length > 0 && <div className="ops-inline" style={{ marginTop: 6 }} role="group" aria-label="Floors">{floors.map((f) => <Button key={f.id} small variant={(f.floorNo ?? 0) === (level.kind === 'building' ? level.floorNo : -1) ? 'accent' : 'soft'} aria-pressed={(f.floorNo ?? 0) === (level.kind === 'building' ? level.floorNo : -1)} onClick={() => setLevel({ kind: 'building', buildingId: building.id, floorNo: f.floorNo })}>{f.floorNo === 0 ? 'Ground' : `Floor ${f.floorNo}`}</Button>)}<Button small variant="ghost" onClick={() => { setLevel({ kind: 'campus' }); setSelected(null); }}>← Back to campus</Button></div>}
                <div className="cw-legend" style={{ marginTop: 8 }} aria-label="Legend">{COLORS_LEGEND.map(([k, label]) => <span key={k}><i style={{ background: ({ FREE: '#9CC9A4', SCHEDULED_CLASS: '#6F96C9', BOOKED: '#9A86C9', EVENT: '#E2B04C', UNDER_MAINTENANCE: '#E39A55', CLOSED: '#A9A39A', RESTRICTED: '#5C5650' } as Record<string, string>)[k] }} />{label}</span>)}</div>
                <div className="ops-inline" style={{ marginTop: 6, fontSize: 12 }}>
                  <label className="ops-chip"><input type="checkbox" checked={night} onChange={(e) => setNight(e.target.checked)} />Night (decorative)</label>
                  <label className="ops-chip"><input type="checkbox" checked={lowPower} onChange={(e) => setLowPower(e.target.checked)} />Low-power</label>
                  <label className="ops-chip"><input type="checkbox" checked={reducedMotion} onChange={(e) => setReducedMotion(e.target.checked)} />Reduce motion</label>
                  <span className="ops-muted" title="Measured frames per second on this device">{fps ? `${fps} fps` : ''}</span>
                </div>
              </div>
              {sel && (
                <div className="cw-glass cw-panel" role="region" aria-label={`${sel.name} details`}>
                  <div className="ops-section-head"><div><div className="ops-row-title" style={{ fontSize: 15 }}>{sel.name}</div><div className="ops-row-sub">{humanize(sel.kind)}{sel.capacity ? ` · ${sel.capacity} capacity` : ''}{sel.accessible ? ' · step-free' : ''}</div></div><button type="button" className="modal-close" onClick={() => setSelected(null)} aria-label="Close details">×</button></div>
                  <div className="ops-inline" style={{ margin: '6px 0' }}><StatusPill status={sel.status} />{sel.now?.map((s, i) => <span key={i} className="ops-chip">{s.label}{s.teacher ? ` · ${s.teacher}` : ''}<span className="ops-muted"> ({s.source === 'TIMETABLE' ? 'scheduled' : s.source.toLowerCase()})</span></span>)}</div>
                  {sel.kind === 'BUILDING' && <Button small onClick={() => enterBuilding(sel)}>Enter building</Button>}
                  {detailErr && <ErrorNote error={detailErr} />}
                  {detail && detail.id === sel.id && (
                    <>
                      {detail.scheduleToday && detail.scheduleToday.length > 0 && <div><div className="field-label">Today (timetable)</div><ul className="ops-list">{detail.scheduleToday.map((s, i) => <li key={i} className="ops-row" style={{ padding: '4px 0' }}>{s.startTime}–{s.endTime} · {s.section} · {s.subject}{s.teacher ? ` · ${s.teacher}` : ''}</li>)}</ul></div>}
                      {detail.upcomingBookings && detail.upcomingBookings.length > 0 && <div><div className="field-label">Bookings</div><ul className="ops-list">{detail.upcomingBookings.map((b, i) => <li key={i} className="ops-row" style={{ padding: '4px 0' }}>{fmtDateTime(b.startsAt)} · {b.title}</li>)}</ul></div>}
                      {detail.workOrders && detail.workOrders.length > 0 && <div><div className="field-label">Open repairs</div><ul className="ops-list">{detail.workOrders.map((w) => <li key={w.id} className="ops-row" style={{ padding: '4px 0' }}>{w.refNo} · {w.title} {w.overdue && <span className="ops-flag-overdue">late</span>}</li>)}</ul></div>}
                      {detail.children.length > 0 && sel.kind !== 'BUILDING' && <p className="ops-muted">{detail.children.length} space(s) inside.</p>}
                      <div className="ops-inline" style={{ marginTop: 8 }}>
                        {detail.bookable && <Button small onClick={() => setModal('book')}>Book</Button>}
                        {permissions['facilities.request'] && <Button small variant="soft" onClick={() => setModal('issue')}>Report an issue</Button>}
                        {permissions['facilities.read'] && <Link className="btn btn-ghost btn-sm" href={link('/facilities?tab=spaces')}>Open full details →</Link>}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <DataNote>{String(d.kpis.definition ?? '')} Moving figures and the bus are illustrative — no one is tracked. Restricted spaces are hidden or masked for your role before anything reaches this page.</DataNote>
      {modal === 'book' && sel && <BookRoomModal facilityId={sel.id} onClose={() => setModal(null)} onDone={() => void map.reload()} />}
      {modal === 'issue' && sel && <ReportIssueModal facilityId={sel.id} onClose={() => setModal(null)} onDone={() => void map.reload()} />}
    </div>
  );
}
