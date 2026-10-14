'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { opsApi } from '@/lib/ops-api';
import { usePermissions } from '@/lib/permissions';
import { usePathname } from 'next/navigation';
import { usePortalHref, stripSchool, useSchoolSegment } from '@/lib/school-path';
import { PORTALS } from '@/lib/portals';
import { getActiveSchool } from '@/lib/school';
import type { CampusMapDto, CampusNodeDto, FacilityDetailDto } from '@/lib/ops-types';
import { BookRoomModal, ReportIssueModal } from '@/components/ops/operations-views';
import { DataNote, ErrorNote, StatusPill, fmtDateTime, humanize, useLoad } from '@/components/ops/kit';
import { STATE_COLORS, stateOf, type CampusScene, type Level } from './campus-scene';

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

/**
 * Pages of the reader's own portal that relate to a kind of space, so a room on
 * the map leads on to the work done there. Only pages in that portal's sidebar
 * are offered, which keeps the buttons inside what the role may open.
 */
const RELATED: Record<string, string[]> = {
  CLASSROOM: ['timetable', 'attendance', 'classes', 'classrooms', 'assignments'],
  LECTURE_HALL: ['timetable', 'attendance', 'classes', 'classrooms'],
  LAB: ['timetable', 'attendance', 'material'],
  LIBRARY: ['library', 'books', 'notes'],
  OFFICE: ['approvals', 'correspondence', 'fees', 'payments', 'admissions'],
  STAFF_ROOM: ['staff', 'organization', 'leave'],
  AUDITORIUM: ['events', 'calendar', 'announcements'],
  GROUND: ['events', 'calendar'],
  COURT: ['events', 'calendar'],
  TRANSPORT_BAY: ['transport', 'transport-requests'],
  PARKING: ['transport'],
  GATE: ['transport', 'safeguarding'],
  HOSTEL: ['rooms', 'leave'],
  CLINIC: ['medical', 'safeguarding'],
  CANTEEN: ['events', 'calendar'],
  BUILDING: ['facilities', 'events'],
};

function relatedPages(portal: string, kind: string): Array<{ href: string; label: string }> {
  const items = (PORTALS[portal]?.nav ?? []).flatMap((g) => g.items);
  return (RELATED[kind] ?? []).flatMap((page) => {
    const item = items.find((i) => i.href === `/${portal}/${page}`);
    return item ? [{ href: item.href, label: item.label }] : [];
  }).slice(0, 3);
}

export function CampusWorldView() {
  const pathname = usePathname() ?? '';
  const { permissions } = usePermissions();
  const link = usePortalHref();
  const portal = stripSchool(pathname, useSchoolSegment()).split('/')[1] ?? '';
  const map = useLoad(() => opsApi.campusMap(), []);
  const holder = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CampusScene | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const prefersReduced = useReducedMotion();
  const [reducedMotion, setReducedMotion] = useState(false);
  const [lowPower, setLowPower] = useState(false);
  // Daylight by default: the map is read for information, and the dusk palette is harder to read.
  const [night, setNight] = useState(false);
  const [level, setLevel] = useState<Level>({ kind: 'campus' });
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<FacilityDetailDto | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [labels, setLabels] = useState<Array<{ id: string; x: number; y: number; visible: boolean }>>([]);
  const [fps, setFps] = useState(0);
  const [view, setView] = useState<'3d' | 'list'>('3d');
  const [modal, setModal] = useState<null | 'book' | 'issue'>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tableTab, setTableTab] = useState<'inuse' | 'repairs' | 'events'>('inuse');
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const t = window.setInterval(() => setClock(new Date()), 15_000); return () => window.clearInterval(t); }, []);

  useEffect(() => { setReducedMotion(prefersReduced); }, [prefersReduced]);
  useEffect(() => {
    try { setLowPower(localStorage.getItem('eduos.campus.lowPower') === '1' || (navigator.hardwareConcurrency ?? 8) <= 4); } catch { /* storage unavailable */ }
  }, []);

  const nodes = useMemo(() => map.data?.facilities ?? [], [map.data]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const buildings = useMemo(() => nodes.filter((n) => n.kind === 'BUILDING'), [nodes]);

  // Mount the scene once data and the container exist; Three.js is loaded only here.
  // Keyed on whether data has arrived, not on each minute's refresh: a refresh
  // only pushes new data into the live scene (below), it does not rebuild it.
  const hasData = Boolean(map.data && map.data.facilities.length);
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
        onHover: (id) => setHovered(id),
      });
      scene.setData(map.data!.facilities);
      sceneRef.current = scene;
    })();
    return () => { disposed = true; scene?.dispose(); sceneRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- options are pushed to the live scene below
  }, [view, hasData]);

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

  const currentFloor = level.kind === 'building' ? floors.find((f) => (f.floorNo ?? 0) === level.floorNo) ?? null : null;
  const roomsHere = currentFloor ? nodes.filter((n) => n.parentId === currentFloor.id) : [];
  const outdoor = nodes.filter((n) => ['GROUND', 'COURT', 'PARKING', 'TRANSPORT_BAY', 'GATE'].includes(n.kind));

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

  const legend: Array<[string, string]> = COLORS_LEGEND;
  // The institution profile's name, or the school's own name until a profile is filled in.
  const siteName = d.institution ?? getActiveSchool()?.name ?? 'Campus';
  const roomLike = nodes.filter((n) => !['CAMPUS', 'FLOOR', 'BUILDING'].includes(n.kind));
  const placeOf = (n: CampusNodeDto) => {
    const floor = n.parentId ? byId.get(n.parentId) : null;
    const b = floor?.kind === 'FLOOR' && floor.parentId ? byId.get(floor.parentId) : null;
    return b ? `${b.name} · ${floor!.floorNo === 0 ? 'Ground' : `Floor ${floor!.floorNo}`}` : humanize(n.kind);
  };
  /** Selecting from the search, the table or a button: go to the room's floor first, then select it. */
  const goTo = (n: CampusNodeDto) => {
    const floor = n.parentId ? byId.get(n.parentId) : null;
    if (n.kind === 'BUILDING') { setLevel({ kind: 'campus' }); setSelected(n.id); }
    else if (floor?.kind === 'FLOOR' && floor.parentId) {
      setLevel({ kind: 'building', buildingId: floor.parentId, floorNo: floor.floorNo ?? 0 });
      window.setTimeout(() => setSelected(n.id), 60);
    } else { setLevel({ kind: 'campus' }); setSelected(n.id); }
    setQuery('');
  };
  const matches = query.trim().length < 1 ? [] : nodes
    .filter((n) => n.kind !== 'CAMPUS' && n.kind !== 'FLOOR' && `${n.name} ${n.code} ${n.now?.map((x) => x.label).join(' ') ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 8);
  const inUse = roomLike.filter((n) => n.now?.some((x) => ['SCHEDULED_CLASS', 'BOOKED', 'EVENT'].includes(x.type)));
  const repairs = roomLike.filter((n) => (n.openWorkOrders ?? 0) > 0 || n.status === 'UNDER_MAINTENANCE');
  const istTime = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(clock);
  const schedule = detail && sel && detail.id === sel.id ? detail.scheduleToday ?? [] : [];
  const nowHm = istTime;
  const steps = schedule.map((s) => ({ ...s, state: s.endTime <= nowHm ? 'done' : s.startTime <= nowHm ? 'now' : 'next' }));

  return (
    <div className="ops-stack">
      <div className="ops-inline">
        <div className="seg-toggle" role="group" aria-label="View">
          <button type="button" className={`seg-btn${view === '3d' ? ' is-on' : ''}`} aria-pressed={view === '3d'} onClick={() => setView('3d')}>◈ 3D campus</button>
          <button type="button" className={`seg-btn${view === 'list' ? ' is-on' : ''}`} aria-pressed={view === 'list'} onClick={() => setView('list')}>☰ List</button>
        </div>
        {d.sampleLayout && <span className="ops-chip">Sample layout: replace it in Facilities → Spaces</span>}
      </div>

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
            const st = stateOf(n);
            const chip = n.kind !== 'BUILDING' && n.now?.[0] ? n.now[0].label : null;
            return (
              <div key={l.id} className={`cw-label${l.id === selected ? ' is-selected' : ''}${l.id === hovered ? ' is-hover' : ''}`} style={{ left: l.x, top: l.y }} aria-hidden="true">
                {n.kind !== 'BUILDING' && <i className="cw-label-dot" style={{ background: STATE_COLORS[st] }} />}
                <b>{n.name}</b>{chip ? <span className="cw-label-sub"> · {chip}</span> : null}
              </div>
            );
          })}
          <div className="cw-overlay">
            <div className="cw-topbar cw-glass">
              <div className="cw-search">
                <span aria-hidden="true">⌕</span>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search rooms, buildings, classes…" aria-label="Search the campus" onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) goTo(matches[0]); if (e.key === 'Escape') setQuery(''); }} />
                {matches.length > 0 && (
                  <ul className="cw-results" role="listbox" aria-label="Places">
                    {matches.map((n) => (
                      <li key={n.id}><button type="button" role="option" aria-selected={false} onClick={() => goTo(n)}>
                        <i className="cw-label-dot" style={{ background: STATE_COLORS[stateOf(n)] }} /><b>{n.name}</b><span className="ops-muted"> {placeOf(n)}{n.now?.[0] ? ` · ${n.now[0].label}` : ''}</span>
                      </button></li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="cw-site">
                <span className="cw-site-badge">{siteName.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
                <span><b>{siteName}</b><span className="cw-site-sub">{d.kpis.rooms ? `${Math.round((Number(d.kpis.roomsInUse) / Number(d.kpis.rooms)) * 100)}% in use · ${d.kpis.roomsInUse}/${d.kpis.rooms} rooms` : 'No rooms recorded'}</span></span>
              </div>
              <span className="cw-live" title={`As of ${fmtDateTime(d.asOf)}; refreshes every minute`}><i aria-hidden="true" />Live {istTime}</span>
            </div>

            <div className="cw-mid">
              <div className="cw-kpis" aria-label="Campus now">
                <div className="cw-kpi cw-glass"><span className="cw-kpi-icon" aria-hidden="true">▣</span><div><span>Rooms in use</span><b>{d.kpis.roomsInUse}</b><small>{d.kpis.roomsFree} free now</small></div></div>
                <div className="cw-kpi cw-glass"><span className="cw-kpi-icon is-gold" aria-hidden="true">✦</span><div><span>Events today</span><b>{d.kpis.eventsToday}</b><small>{d.kpis.bookingsToday !== undefined ? `${d.kpis.bookingsToday} bookings` : 'on campus'}</small></div></div>
                {d.kpis.openWorkOrders !== undefined
                  ? <div className="cw-kpi cw-glass"><span className="cw-kpi-icon is-orange" aria-hidden="true">🔧</span><div><span>Open repairs</span><b>{d.kpis.openWorkOrders}</b><small>{d.kpis.outOfUse} spaces out of use</small></div></div>
                  : <div className="cw-kpi cw-glass"><span className="cw-kpi-icon is-orange" aria-hidden="true">⛔</span><div><span>Out of use</span><b>{d.kpis.outOfUse}</b><small>closed or under repair</small></div></div>}
              </div>
              <div className="cw-right">
                <div className="cw-glass cw-controls" role="group" aria-label="Camera">
                  <button type="button" onClick={() => sceneRef.current?.zoom(0.8)} aria-label="Zoom in">+</button>
                  <button type="button" onClick={() => sceneRef.current?.zoom(1.25)} aria-label="Zoom out">−</button>
                  <button type="button" onClick={() => sceneRef.current?.rotate(Math.PI / 8)} aria-label="Rotate left">⟲</button>
                  <button type="button" onClick={() => sceneRef.current?.rotate(-Math.PI / 8)} aria-label="Rotate right">⟳</button>
                  <button type="button" onClick={() => { setLevel({ kind: 'campus' }); setSelected(null); sceneRef.current?.home(); }} aria-label="Home view">⌂</button>
                </div>
                {sel && (
                  <div className="cw-glass cw-panel" role="region" aria-label={`${sel.name} details`}>
                    <div className="cw-panel-head">
                      <div><div className="cw-eyebrow">{humanize(sel.kind)}{sel.code ? ` · ${sel.code}` : ''}</div><div className="cw-panel-title">{sel.name}</div><div className="ops-row-sub">{placeOf(sel)}</div></div>
                      <button type="button" className="modal-close" onClick={() => setSelected(null)} aria-label="Close details">×</button>
                    </div>
                    <div className="ops-inline" style={{ margin: '6px 0' }}>
                      <span className="cw-state" style={{ background: `${STATE_COLORS[stateOf(sel)]}33`, color: '#1f2937' }}><i className="cw-label-dot" style={{ background: STATE_COLORS[stateOf(sel)] }} />{stateLabel(sel) || humanize(sel.status)}</span>
                    </div>
                    <dl className="cw-facts">
                      {sel.capacity ? <><dt>Capacity</dt><dd>{sel.capacity}</dd></> : null}
                      <dt>Step-free</dt><dd>{sel.accessible ? 'Yes' : 'Not recorded'}</dd>
                      {sel.now?.map((s, i) => <span key={i} style={{ display: 'contents' }}><dt>{s.type === 'SCHEDULED_CLASS' ? 'Class now' : humanize(s.type)}</dt><dd>{s.label}{s.teacher ? ` · ${s.teacher}` : ''}{s.until ? ` · until ${String(s.until).length <= 5 ? s.until : fmtDateTime(s.until)}` : ''}</dd></span>)}
                      {sel.nextScheduled && <><dt>Next</dt><dd>{sel.nextScheduled.at} · {sel.nextScheduled.label}</dd></>}
                      {sel.bookingsToday !== undefined && <><dt>Bookings today</dt><dd>{sel.bookingsToday}</dd></>}
                      {sel.openWorkOrders !== undefined && <><dt>Open repairs</dt><dd>{sel.openWorkOrders}{sel.urgentWorkOrders ? ` (${sel.urgentWorkOrders} urgent)` : ''}</dd></>}
                    </dl>
                    {sel.kind === 'BUILDING' && <Button small onClick={() => enterBuilding(sel)}>Enter building</Button>}
                    {detailErr && <ErrorNote error={detailErr} />}
                    {detail && detail.id === sel.id && (
                      <>
                        {detail.upcomingBookings && detail.upcomingBookings.length > 0 && <div><div className="field-label">Bookings</div><ul className="ops-list">{detail.upcomingBookings.map((b, i) => <li key={i} className="ops-row" style={{ padding: '4px 0' }}>{fmtDateTime(b.startsAt)} · {b.title}</li>)}</ul></div>}
                        {detail.workOrders && detail.workOrders.length > 0 && <div><div className="field-label">Open repairs</div><ul className="ops-list">{detail.workOrders.map((w) => <li key={w.id} className="ops-row" style={{ padding: '4px 0' }}>{w.refNo} · {w.title} {w.overdue && <span className="ops-flag-overdue">late</span>}</li>)}</ul></div>}
                        {detail.children.length > 0 && sel.kind !== 'BUILDING' && <p className="ops-muted">{detail.children.length} space(s) inside.</p>}
                        <div className="ops-inline" style={{ marginTop: 8 }}>
                          {detail.bookable && <Button small onClick={() => setModal('book')}>Book</Button>}
                          {permissions['facilities.request'] && <Button small variant="soft" onClick={() => setModal('issue')}>Report an issue</Button>}
                          {permissions['facilities.read'] && <Link className="btn btn-ghost btn-sm" href={link('/facilities?tab=spaces')}>Open full details →</Link>}
                          {relatedPages(portal, sel.kind).map((p) => <Link key={p.href} className="btn btn-ghost btn-sm" href={link(p.href)}>{p.label} →</Link>)}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="cw-bottom">
              <div className="cw-glass cw-tracker">
                <nav className="cw-crumbs" aria-label="Location">
                  <button type="button" onClick={() => { setLevel({ kind: 'campus' }); setSelected(null); }}>{siteName}</button>
                  {building && <><span aria-hidden="true">›</span><button type="button" onClick={() => setSelected(null)}>{building.name}</button></>}
                  {building && <><span aria-hidden="true">›</span><span>{floors.find((f) => (f.floorNo ?? 0) === (level.kind === 'building' ? level.floorNo : 0))?.name.split('·').pop()?.trim() ?? 'Floor'}</span></>}
                  {sel && sel.kind !== 'BUILDING' && sel.kind !== 'FLOOR' && <><span aria-hidden="true">›</span><b>{sel.name}</b></>}
                </nav>
                {steps.length > 0 ? (
                  <>
                    <div className="cw-tracker-title">{sel?.name} today</div>
                    <ol className="cw-steps" aria-label={`${sel?.name} timetable today`}>
                      {steps.map((s, i) => (
                        <li key={i} className={`is-${s.state}`}>
                          <span className="cw-step-dot" aria-hidden="true">{s.state === 'done' ? '✓' : i + 1}</span>
                          <span className="cw-step-label">{s.subject}</span>
                          <span className="cw-step-sub">{s.section}</span>
                          <span className="cw-step-time">{s.startTime}{s.state === 'now' ? ' · now' : ''}</span>
                        </li>
                      ))}
                    </ol>
                  </>
                ) : (
                  <>
                    {level.kind === 'campus' && <div className="ops-inline" style={{ marginTop: 6 }}>{buildings.map((b) => <Button key={b.id} small variant="soft" onClick={() => enterBuilding(b)}>{b.name}</Button>)}</div>}
                    {building && floors.length > 0 && <div className="ops-inline" style={{ marginTop: 6 }} role="group" aria-label="Floors">{floors.map((f) => <Button key={f.id} small variant={(f.floorNo ?? 0) === (level.kind === 'building' ? level.floorNo : -1) ? 'accent' : 'soft'} aria-pressed={(f.floorNo ?? 0) === (level.kind === 'building' ? level.floorNo : -1)} onClick={() => setLevel({ kind: 'building', buildingId: building.id, floorNo: f.floorNo })}>{f.floorNo === 0 ? 'Ground' : `Floor ${f.floorNo}`}</Button>)}<Button small variant="ghost" onClick={() => { setLevel({ kind: 'campus' }); setSelected(null); }}>← Back to campus</Button></div>}
                    {currentFloor && roomsHere.length > 0 && <div className="ops-inline" style={{ marginTop: 6 }} role="group" aria-label="Rooms on this floor">{roomsHere.map((n) => <Button key={n.id} small variant={n.id === selected ? 'accent' : 'ghost'} aria-pressed={n.id === selected} onClick={() => setSelected(n.id)}>{n.name}</Button>)}</div>}
                    {level.kind === 'campus' && outdoor.length > 0 && <div className="ops-inline" style={{ marginTop: 6 }} role="group" aria-label="Grounds and outdoor spaces">{outdoor.map((n) => <Button key={n.id} small variant={n.id === selected ? 'accent' : 'ghost'} aria-pressed={n.id === selected} onClick={() => setSelected(n.id)}>{n.name}</Button>)}</div>}
                  </>
                )}
                <div className="cw-legend" aria-label="Legend">{legend.map(([k, label]) => <span key={k}><i style={{ background: STATE_COLORS[k] }} />{label}</span>)}</div>
                <div className="cw-toggles">
                  <label className="ops-chip"><input type="checkbox" checked={night} onChange={(e) => setNight(e.target.checked)} />Night</label>
                  <label className="ops-chip"><input type="checkbox" checked={lowPower} onChange={(e) => setLowPower(e.target.checked)} />Low-power</label>
                  <label className="ops-chip"><input type="checkbox" checked={reducedMotion} onChange={(e) => setReducedMotion(e.target.checked)} />Reduce motion</label>
                  <span className="ops-muted" title="Measured frames per second on this device">{fps ? `${fps} fps` : ''}</span>
                </div>
              </div>

              <div className="cw-glass cw-table">
                <div className="cw-tabs" role="tablist" aria-label="On campus now">
                  <button type="button" role="tab" aria-selected={tableTab === 'inuse'} className={tableTab === 'inuse' ? 'is-on' : ''} onClick={() => setTableTab('inuse')}>In use <span>{inUse.length}</span></button>
                  {d.layers.maintenance && <button type="button" role="tab" aria-selected={tableTab === 'repairs'} className={tableTab === 'repairs' ? 'is-on' : ''} onClick={() => setTableTab('repairs')}>Repairs <span>{repairs.length}</span></button>}
                  <button type="button" role="tab" aria-selected={tableTab === 'events'} className={tableTab === 'events' ? 'is-on' : ''} onClick={() => setTableTab('events')}>Events <span>{d.eventsToday.length}</span></button>
                </div>
                <ul className="cw-rows">
                  {tableTab === 'inuse' && (inUse.length ? inUse.slice(0, 6).map((n) => (
                    <li key={n.id}><button type="button" onClick={() => goTo(n)}><b>{n.name}</b><span className="cw-row-sub">{n.now?.[0]?.label}</span><span className="cw-pill" style={{ background: `${STATE_COLORS[stateOf(n)]}33` }}>{n.now?.[0]?.until ? `till ${String(n.now[0].until).length <= 5 ? n.now[0].until : fmtDateTime(n.now[0].until)}` : humanize(stateOf(n))}</span><span aria-hidden="true">›</span></button></li>
                  )) : <li className="cw-empty">No room is in use right now.</li>)}
                  {tableTab === 'repairs' && (repairs.length ? repairs.slice(0, 6).map((n) => (
                    <li key={n.id}><button type="button" onClick={() => goTo(n)}><b>{n.name}</b><span className="cw-row-sub">{placeOf(n)}</span><span className="cw-pill is-orange">{n.openWorkOrders ?? 0} open{n.urgentWorkOrders ? ` · ${n.urgentWorkOrders} urgent` : ''}</span><span aria-hidden="true">›</span></button></li>
                  )) : <li className="cw-empty">No open repairs.</li>)}
                  {tableTab === 'events' && (d.eventsToday.length ? d.eventsToday.slice(0, 6).map((e) => {
                    const venue = e.facilityId ? byId.get(e.facilityId) : null;
                    return <li key={e.id}><button type="button" onClick={() => venue && goTo(venue)} disabled={!venue}><b>{e.title}</b><span className="cw-row-sub">{venue?.name ?? 'Venue not set'} · {fmtDateTime(e.startsAt)}</span><span className="cw-pill is-gold">{humanize(e.status)}</span><span aria-hidden="true">›</span></button></li>;
                  }) : <li className="cw-empty">No events today.</li>)}
                </ul>
              </div>
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
