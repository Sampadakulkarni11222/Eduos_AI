'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { opsApi } from '@/lib/ops-api';
import { usePermissions } from '@/lib/permissions';
import { usePathname } from 'next/navigation';
import { usePortalHref, usePortalPage, stripSchool, useSchoolSegment } from '@/lib/school-path';
import { PORTALS } from '@/lib/portals';
import { getActiveSchool } from '@/lib/school';
import type { CampusDepartmentDto, CampusMapDto, CampusNodeDto, FacilityDetailDto, ModuleNowDto } from '@/lib/ops-types';
import { BookRoomModal, ReportIssueModal } from '@/components/ops/operations-views';
import { DataNote, ErrorNote, fmtDate, fmtDateTime, humanize, useLoad } from '@/components/ops/kit';
import type { CampusScene, Level } from './campus-scene';
import { STATE_COLORS, stateOf } from './campus-state';
import { CampusLayersPanel, DepartmentTasks, RoomLayerFacts, availableLayers } from './campus-layers';
import { CollapsePanel, FoldButton, LiveNowBlock, MyCampusPanel, SeeDetailsLink, usePanelState, usePoll } from './campus-live';
import { MomentBanner } from './campus-moment';

/** The panels over the 3D view that fold into chips (remembered per user). */
const PANEL_IDS = ['mine', 'kpis', 'depts', 'ops', 'room', 'dept', 'tracker', 'table'];
/** Spaces whose live detail is not a room's: the gate and the bus bay have their own kinds. */
const LIVE_KIND: Record<string, string | null> = { GATE: 'gate', TRANSPORT_BAY: 'bus', BUILDING: null, FLOOR: null, CAMPUS: null, PARKING: null };

/**
 * Campus World — the 3D view of the institution with what is happening in
 * it, filtered for the viewer on the server. Nested: campus → building →
 * floor → room → the page where the work is done. A classroom shows who is in
 * it from today's attendance register, the lesson and teacher from the
 * timetable and the module from the teacher's plan; a department shows its
 * rooms, its head and its live figures. Every number is labelled with where
 * it comes from; moving figures are illustrative only.
 */

const COLORS_LEGEND: Array<[string, string]> = [
  ['FREE', 'Free now'], ['SCHEDULED_CLASS', 'Class'], ['EXAM', 'Exam'], ['BOOKED', 'Booked'], ['EVENT', 'Event'], ['UNDER_MAINTENANCE', 'Maintenance'], ['CLOSED', 'Closed'], ['RESTRICTED', 'Restricted'],
];
const PACE_LABEL: Record<string, string> = { UPCOMING: 'Upcoming', ON_TRACK: 'On track', AHEAD: 'Ahead of plan', BEHIND: 'Behind plan', OVERDUE: 'Overdue', COMPLETED: 'Completed', COMPLETED_LATE: 'Completed late' };
const paceTone = (pace: string) => (pace === 'OVERDUE' ? 'bad' : pace === 'BEHIND' ? 'warn' : 'good');
const DEPT_ICON: Record<string, string> = { LEADERSHIP: '★', ACADEMICS: '✎', ADMINISTRATION: '▣', FINANCE: '₹', ADMISSIONS: '✦', HR: '☺', COMPLIANCE: '⚖', LIBRARY: '▤', TRANSPORT: '⛟', HOSTEL: '⌂', HEALTH: '✚', EVENTS: '⚑', CANTEEN: '☕' };
/** The school day on the time slider, in minutes from midnight. */
const DAY_START = 6 * 60;
const DAY_END = 20 * 60;
/** Today in the school's time zone, as YYYY-MM-DD. */
const schoolToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const hm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const toMinutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

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

const until = (v: string | undefined) => (v ? ` · until ${String(v).length <= 5 ? v : fmtDateTime(v)}` : '');
function stateLabel(n: CampusNodeDto) {
  if (n.restricted && n.name === 'Restricted area') return 'Restricted';
  if (n.status !== 'ACTIVE') return humanize(n.status);
  const s = n.now?.[0];
  return s ? `${s.type === 'EXAM' ? 'Exam: ' : ''}${s.label}${until(s.until)}` : n.now ? 'Free now' : '';
}
/** "34 of 36 present", or that the register has not been taken: never a guessed number. */
function headcount(live: CampusNodeDto['live']) {
  if (!live) return null;
  if (live.away) return `In ${live.awayIn ?? 'another room'} this period`;
  return live.present === null ? `${live.enrolled} on roll · register not taken` : `${live.present} of ${live.enrolled} present`;
}

/**
 * Pages of the reader's own portal that relate to a kind of space, so a room on
 * the map leads on to the work done there. Only pages in that portal's sidebar
 * are offered, which keeps the buttons inside what the role may open.
 */
const RELATED: Record<string, string[]> = {
  CLASSROOM: ['attendance', 'syllabus', 'timetable', 'classes', 'classrooms', 'assignments'],
  LECTURE_HALL: ['attendance', 'syllabus', 'timetable', 'classes', 'classrooms'],
  LAB: ['syllabus', 'timetable', 'attendance', 'material'],
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
  STORE: ['procurement', 'facilities'],
  BUILDING: ['facilities', 'events'],
};

function pagesOf(portal: string, pages: string[], max = 3): Array<{ href: string; label: string }> {
  const items = (PORTALS[portal]?.nav ?? []).flatMap((g) => g.items);
  return pages.flatMap((page) => {
    const item = items.find((i) => i.href === `/${portal}/${page}`);
    return item ? [{ href: item.href, label: item.label }] : [];
  }).slice(0, max);
}

function Meter({ value, expected, tone = 'good' }: { value: number; expected?: number; tone?: string }) {
  return (
    <span className={`cw-meter is-${tone}`} role="img" aria-label={`${value}%${expected !== undefined ? `, ${expected}% expected by now` : ''}`}>
      <i style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      {expected !== undefined && expected > 0 && expected < 100 && <em style={{ left: `${expected}%` }} />}
    </span>
  );
}

function ModuleBlock({ module: m, href }: { module: ModuleNowDto; href: string | null }) {
  return (
    <div className="cw-module">
      <div className="cw-module-head"><span>Module</span><b className={`cw-pace is-${paceTone(m.pace)}`}>{PACE_LABEL[m.pace] ?? humanize(m.pace)}</b></div>
      <div className="cw-module-title">{m.title}</div>
      <Meter value={m.progressPct} expected={m.expectedPct} tone={paceTone(m.pace)} />
      <div className="cw-module-sub">{m.progressPct}% of topics taught{m.expectedPct !== undefined ? ` · ${m.expectedPct}% expected by today` : ''}{m.plannedEnd ? ` · finish by ${fmtDate(m.plannedEnd)}` : ''}</div>
      {m.nextTopic && <div className="cw-module-next"><span>Next topic</span>{m.nextTopic}</div>}
      {href && <Link className="btn btn-ghost btn-sm" href={href}>Open the module plan →</Link>}
    </div>
  );
}

export function CampusWorldView() {
  const pathname = usePathname() ?? '';
  const { permissions } = usePermissions();
  const link = usePortalHref();
  const portalPage = usePortalPage();
  const portal = stripSchool(pathname, useSchoolSegment()).split('/')[1] ?? '';
  // A time of today to look at instead of now (staff only; the server ignores it for families).
  const [at, setAt] = useState<string | null>(null);
  // Another date of the school year (staff): the calendar, shifts and timetable of that day.
  const [date, setDate] = useState<string | null>(null);
  const map = useLoad(() => opsApi.campusMap(undefined, at, date), [at, date]);
  // Operational layers (labs, transport, cover, tasks, gate…): only what the reader may see; refreshed with the map.
  const ops = useLoad(() => opsApi.campusLayers(), []);
  const reloadOps = ops.reload;
  useEffect(() => { const t = window.setInterval(() => { void reloadOps(); }, 30_000); return () => window.clearInterval(t); }, [reloadOps]);
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
  const [dept, setDept] = useState<string | null>(null);
  const [detail, setDetail] = useState<FacilityDetailDto | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [labels, setLabels] = useState<Array<{ id: string; x: number; y: number; visible: boolean }>>([]);
  const [fps, setFps] = useState(0);
  const [view, setView] = useState<'3d' | 'list'>('3d');
  const [full, setFull] = useState(true);
  const [playing, setPlaying] = useState(false);
  // The panels over the scene can be put away to look at the campus itself.
  const [hud, setHud] = useState(true);
  const [modal, setModal] = useState<null | 'book' | 'issue'>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tableTab, setTableTab] = useState<'classes' | 'inuse' | 'repairs' | 'events'>('classes');
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const t = window.setInterval(() => setClock(new Date()), 15_000); return () => window.clearInterval(t); }, []);
  // Folded panels, and the reader's own corner of the campus (their child's class, their own class, their next class).
  const panels = usePanelState();
  const [childId, setChildId] = useState<string | null>(null);
  const my = usePoll(() => opsApi.campusMyView(childId), [childId], 15);
  useEffect(() => { try { if (localStorage.getItem('eduos.campus.hud') === '0') setHud(false); } catch { /* storage unavailable */ } }, []);
  const toggleHud = useCallback((on: boolean) => { setHud(on); try { localStorage.setItem('eduos.campus.hud', on ? '1' : '0'); } catch { /* ignore */ } }, []);

  useEffect(() => { setReducedMotion(prefersReduced); }, [prefersReduced]);
  useEffect(() => {
    try {
      setLowPower(localStorage.getItem('eduos.campus.lowPower') === '1' || (navigator.hardwareConcurrency ?? 8) <= 4);
      setFull(localStorage.getItem('eduos.campus.full') !== '0' && window.innerWidth > 760);
    } catch { /* storage unavailable */ }
  }, []);
  const toggleFull = useCallback((on: boolean) => {
    setFull(on);
    try { localStorage.setItem('eduos.campus.full', on ? '1' : '0'); } catch { /* ignore */ }
  }, []);
  // Full page covers the portal's own chrome: stop the page behind from scrolling, resize the canvas, Esc leaves.
  useEffect(() => {
    const on = full && view === '3d';
    document.body.classList.toggle('cw-fullpage', on);
    const t = window.setTimeout(() => sceneRef.current?.resize(), 30);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && on && !document.querySelector('.modal-overlay, .ops-drawer')) toggleFull(false); };
    window.addEventListener('keydown', key);
    return () => { document.body.classList.remove('cw-fullpage'); window.clearTimeout(t); window.removeEventListener('keydown', key); };
  }, [full, view, toggleFull]);

  const nodes = useMemo(() => map.data?.facilities ?? [], [map.data]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const buildings = useMemo(() => nodes.filter((n) => n.kind === 'BUILDING'), [nodes]);
  const departments = useMemo(() => map.data?.departments ?? [], [map.data]);
  const buildingOf = useCallback((n: CampusNodeDto) => {
    const floor = n.parentId ? byId.get(n.parentId) : null;
    return floor?.kind === 'FLOOR' && floor.parentId ? byId.get(floor.parentId) ?? null : null;
  }, [byId]);
  /** What the register and the timetable say about a whole building, for its label. */
  const buildingSummary = useMemo(() => {
    const out = new Map<string, { lessons: number; exams: number; present: number; counted: boolean }>();
    for (const n of nodes) {
      const b = buildingOf(n);
      if (!b) continue;
      const s = out.get(b.id) ?? { lessons: 0, exams: 0, present: 0, counted: false };
      if (n.lesson) s.lessons += 1;
      if (n.now?.[0]?.type === 'EXAM') s.exams += 1;
      if (n.live && !n.live.away && n.live.present !== null && n.live.inSession !== false) { s.present += n.live.present; s.counted = true; }
      out.set(b.id, s);
    }
    return out;
  }, [nodes, buildingOf]);

  /** Short badges from the operational layers, drawn on room labels: a substitute teaching, a practical, the gate. */
  const opsBadge = useMemo(() => {
    const out = new Map<string, string>();
    const add = (id: string | null | undefined, text: string) => { if (id) out.set(id, out.has(id) ? `${out.get(id)} · ${text}` : text); };
    for (const c of ops.data?.cover?.now ?? []) add(c.facilityId, `cover: ${c.substituteName ?? 'substitute'}`);
    for (const l of ops.data?.labs ?? []) if (l.practicalNow) add(l.facilityId, `practical: ${l.practicalNow.title}`);
    const g = ops.data?.gate;
    if (g && (g.visitorsOnSite !== null || g.studentsOutOnPass !== null)) add(g.facilityId, [g.visitorsOnSite !== null ? `${g.visitorsOnSite} visitors` : null, g.studentsOutOnPass !== null ? `${g.studentsOutOnPass} out` : null].filter(Boolean).join(', '));
    const t = ops.data?.transport;
    if (t) add(t.facilityId, `${t.live}/${t.vehicles.length} buses live`);
    return out;
  }, [ops.data]);

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
      scene.setMoment(map.data!.moment ?? null);
      sceneRef.current = scene;
    })();
    return () => { disposed = true; scene?.dispose(); sceneRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- options are pushed to the live scene below
  }, [view, hasData]);

  useEffect(() => { sceneRef.current?.applyLighting(night); }, [night]);
  useEffect(() => { sceneRef.current?.setQuality(lowPower); try { localStorage.setItem('eduos.campus.lowPower', lowPower ? '1' : '0'); } catch { /* ignore */ } }, [lowPower]);
  useEffect(() => { sceneRef.current?.setMotion(reducedMotion); }, [reducedMotion]);
  useEffect(() => { sceneRef.current?.setLevel(level); }, [level]);

  // Refresh what is happening every 30 seconds (not decorative: real records), so a
  // register a teacher has just taken shows in the classroom without a reload.
  useEffect(() => {
    if (playing) return undefined;
    const t = window.setInterval(() => { void map.reload(); }, 30_000);
    return () => window.clearInterval(t);
  }, [map, playing]);
  useEffect(() => {
    if (!map.data || !sceneRef.current) return;
    sceneRef.current.setData(map.data.facilities);
    // Who is where at the moment shown: rooms, ground, canteen, gate, buses; empty when the school is closed.
    sceneRef.current.setMoment(map.data.moment ?? null);
  }, [map.data]);

  // "Play the day": step the time forward a quarter of an hour at a time.
  useEffect(() => {
    if (!playing) return undefined;
    const t = window.setInterval(() => {
      setAt((cur) => {
        const next = (cur ? toMinutes(cur) : DAY_START) + 15;
        if (next > DAY_END) { setPlaying(false); return cur; }
        return hm(next);
      });
    }, 1600);
    return () => window.clearInterval(t);
  }, [playing]);

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
    try { setDetail(await opsApi.campusFacility(id, at)); } catch (e) { setDetail(null); setDetailErr(e instanceof Error ? e.message : 'Could not load'); }
  }, [at]);
  useEffect(() => {
    sceneRef.current?.highlight(selected);
    if (selected) { sceneRef.current?.focus(selected); void loadDetail(selected); } else setDetail(null);
  }, [selected, loadDetail]);
  // The selected room's detail follows the minute's refresh too.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only when new map data arrives
  useEffect(() => { if (selected && map.data) void loadDetail(selected); }, [map.data]);

  const activeDept = dept ? departments.find((x) => x.code === dept) ?? null : null;
  useEffect(() => { sceneRef.current?.spotlight(activeDept?.facilityIds ?? []); }, [activeDept, level, hasData]);

  /** Go to a room's floor, then select it (the same as choosing it from the search). */
  const flyTo = useCallback((id: string) => {
    const n = byId.get(id);
    if (!n) return;
    const floor = n.parentId ? byId.get(n.parentId) : null;
    if (floor?.kind === 'FLOOR' && floor.parentId) {
      setLevel({ kind: 'building', buildingId: floor.parentId, floorNo: floor.floorNo ?? 0 });
      window.setTimeout(() => setSelected(n.id), 60);
    } else { setLevel({ kind: 'campus' }); setSelected(n.id); }
  }, [byId]);
  // A parent or student starts at their own classroom (once per child), when the 3D scene is ready.
  const flown = useRef<string | null>(null);
  useEffect(() => {
    const f = my.data?.focus?.facilityId;
    if (!f || !hasData || (my.data?.role !== 'PARENT' && my.data?.role !== 'STUDENT')) return;
    if (view === '3d' && supported !== true) return;
    const key = `${my.data?.selectedStudentId ?? ''}:${f}`;
    if (flown.current === key) return;
    flown.current = key;
    flyTo(f);
  }, [my.data, hasData, supported, view, flyTo]);

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

  if (map.error && !map.data) return <ErrorNote error={map.error} />;
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

  const roomLine = (r: CampusNodeDto) => `${humanize(r.kind)}${r.capacity ? ` · ${r.capacity} seats` : ''} · ${stateLabel(r)}${r.lesson?.teacher ? ` · ${r.lesson.teacher}` : ''}${r.live ? ` · ${headcount(r.live)}` : ''}`;
  const myPanel = <MyCampusPanel data={my.data} onGo={(id) => { setView('3d'); flyTo(id); }} onChild={(id) => setChildId(id)} onDept={(code) => { const x = departments.find((dd) => dd.code === code); if (x && dept !== code) pickDept(x); }} />;
  const listView = (
    <div className="ops-stack">
      <MomentBanner moment={map.data?.moment} />
      {myPanel}
      <CampusLayersPanel data={ops.data} onGo={(id) => setSelected(id)} />
      {buildings.map((b) => (
        <div key={b.id} className="ops-section card card-pad">
          <div className="ops-section-head"><h2 className="ops-section-title">{b.name}</h2><Button small variant="soft" onClick={() => { setView('3d'); enterBuilding(b); }}>Show in 3D</Button></div>
          {nodes.filter((f) => f.parentId === b.id && f.kind === 'FLOOR').sort((a, c) => (a.floorNo ?? 0) - (c.floorNo ?? 0)).map((f) => (
            <div key={f.id}><h3 className="field-label">{f.name}</h3>
              <ul className="ops-list">{nodes.filter((r) => r.parentId === f.id).map((r) => (
                <li key={r.id} className="ops-row"><div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => { setSelected(r.id); }}><div className="ops-row-title">{r.name}</div><div className="ops-row-sub">{roomLine(r)}</div></button></div></li>
              ))}</ul>
            </div>
          ))}
        </div>
      ))}
      <div className="ops-section card card-pad"><h2 className="ops-section-title">Grounds & outdoor</h2><ul className="ops-list">{outdoor.map((n) => <li key={n.id} className="ops-row"><div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setSelected(n.id)}><div className="ops-row-title">{n.name}</div><div className="ops-row-sub">{humanize(n.kind)}{n.capacity ? ` · ${n.capacity}` : ''} · {stateLabel(n)}</div></button></div></li>)}</ul></div>
      {departments.length > 0 && (
        <div className="ops-section card card-pad"><h2 className="ops-section-title">Departments</h2><ul className="ops-list">{departments.map((x) => (
          <li key={x.code} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{x.name}</div><div className="ops-row-sub">{[x.head?.name ? `${x.head.title}: ${x.head.name}` : null, x.staffCount !== null ? `${x.staffCount} staff` : null, ...x.metrics.map((m) => `${m.value} ${m.label}`)].filter(Boolean).join(' · ') || `${x.facilityIds.length} space(s)`}</div></div>
            {pagesOf(portal, x.pages, 2).map((p) => <Link key={p.href} className="btn btn-ghost btn-sm" href={link(p.href)}>{p.label} →</Link>)}
          </li>
        ))}</ul></div>
      )}
    </div>
  );

  const legend: Array<[string, string]> = COLORS_LEGEND;
  // The institution profile's name, or the school's own name until a profile is filled in.
  const siteName = d.institution ?? getActiveSchool()?.name ?? 'Campus';
  const roomLike = nodes.filter((n) => !['CAMPUS', 'FLOOR', 'BUILDING'].includes(n.kind));
  const placeOf = (n: CampusNodeDto) => {
    const floor = n.parentId ? byId.get(n.parentId) : null;
    const b = buildingOf(n);
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
  const pickDept = (x: CampusDepartmentDto) => {
    if (dept === x.code) { setDept(null); return; }
    setDept(x.code); setSelected(null); setLevel({ kind: 'campus' });
    sceneRef.current?.home();
  };
  const matches = query.trim().length < 1 ? [] : nodes
    .filter((n) => n.kind !== 'CAMPUS' && n.kind !== 'FLOOR' && `${n.name} ${n.code} ${n.department ?? ''} ${n.lesson?.teacher ?? ''} ${n.lesson?.module?.title ?? ''} ${n.now?.map((x) => x.label).join(' ') ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 8);
  const lessons = roomLike.filter((n) => n.lesson || n.now?.[0]?.type === 'EXAM');
  const inUse = roomLike.filter((n) => n.now?.some((x) => ['BOOKED', 'EVENT'].includes(x.type)));
  const repairs = roomLike.filter((n) => (n.openWorkOrders ?? 0) > 0 || n.status === 'UNDER_MAINTENANCE');
  const nowHm = at ?? d.localTime ?? new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(clock);
  const schedule = detail && sel && detail.id === sel.id ? detail.scheduleToday ?? [] : [];
  const steps = schedule.map((s) => ({ ...s, state: s.endTime <= nowHm ? 'done' : s.startTime <= nowHm ? 'now' : 'next' }));
  const lessonNow = schedule.find((s) => s.isNow) ?? null;
  const classToday = detail && sel && detail.id === sel.id ? detail.classToday ?? null : null;
  // The room detail carries the plan's dates; the map's own copy is enough until it arrives.
  const lessonModule: ModuleNowDto | null = lessonNow?.module ?? sel?.lesson?.module ?? null;
  const staffView = Boolean(d.layers.schedule);
  const k = d.kpis;
  const syllabusHref = (offeringId?: string) => (offeringId ? portalPage(`/syllabus?offering=${offeringId}`) : null);
  const tableRows = tableTab === 'classes' ? lessons : tableTab === 'inuse' ? inUse : tableTab === 'repairs' ? repairs : [];

  return (
    <div className="ops-stack">
      <div className="ops-inline">
        <div className="seg-toggle" role="group" aria-label="View">
          <button type="button" className={`seg-btn${view === '3d' ? ' is-on' : ''}`} aria-pressed={view === '3d'} onClick={() => setView('3d')}>◈ 3D campus</button>
          <button type="button" className={`seg-btn${view === 'list' ? ' is-on' : ''}`} aria-pressed={view === 'list'} onClick={() => setView('list')}>☰ List</button>
        </div>
        {view === '3d' && supported !== false && <Button small variant="soft" onClick={() => toggleFull(true)}>⛶ Full page</Button>}
        {d.sampleLayout && <span className="ops-chip">Sample layout: replace it in Facilities → Spaces</span>}
      </div>

      {view === 'list' || supported === false ? (
        <>
          {supported === false && <DataNote>3D needs WebGL, which this device or browser does not offer. Here is the same information as a list.</DataNote>}
          {listView}
        </>
      ) : (
        <div className={`cw-wrap${full ? ' is-full' : ''}`}>
          <div ref={holder} className="cw-canvas" />
          {labels.filter((l) => l.visible).map((l) => {
            const n = byId.get(l.id);
            if (!n) return null;
            const st = stateOf(n);
            const sum = n.kind === 'BUILDING' ? buildingSummary.get(n.id) : null;
            const chip = n.kind === 'BUILDING'
              ? [sum?.exams ? `${sum.exams} exam${sum.exams === 1 ? '' : 's'}` : null, sum?.lessons ? `${sum.lessons} class${sum.lessons === 1 ? '' : 'es'}` : null, sum?.counted ? `${sum.present} present` : null].filter(Boolean).join(' · ') || null
              : n.lesson ? `${n.lesson.subject}${n.live && n.live.present !== null ? ` · ${n.live.present}/${n.live.enrolled}` : ''}`
                : n.now?.[0] ? n.now[0].label
                  : n.live && !n.live.away && n.live.present !== null && n.live.inSession !== false ? `${n.live.present}/${n.live.enrolled}` : null;
            return (
              <div key={l.id} className={`cw-label${l.id === selected ? ' is-selected' : ''}${l.id === hovered ? ' is-hover' : ''}${st === 'EXAM' ? ' is-exam' : ''}`} style={{ left: l.x, top: l.y }} aria-hidden="true">
                {n.kind !== 'BUILDING' && <i className="cw-label-dot" style={{ background: STATE_COLORS[st] }} />}
                <b>{n.name}</b>{chip ? <span className="cw-label-sub"> · {chip}</span> : null}{opsBadge.has(n.id) ? <span className="cw-label-sub cwl-badge"> · {opsBadge.get(n.id)}</span> : null}
              </div>
            );
          })}
          <div className="cw-overlay">
            <div className="cw-topbar cw-glass">
              {full && <button type="button" className="cw-exit" onClick={() => toggleFull(false)} title="Back to the portal (Esc)">← Exit full page</button>}
              <div className="cw-search">
                <span aria-hidden="true">⌕</span>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search rooms, classes, teachers, modules…" aria-label="Search the campus" onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) goTo(matches[0]); if (e.key === 'Escape') { e.stopPropagation(); setQuery(''); } }} />
                {matches.length > 0 && (
                  <ul className="cw-results" role="listbox" aria-label="Places">
                    {matches.map((n) => (
                      <li key={n.id}><button type="button" role="option" aria-selected={false} onClick={() => goTo(n)}>
                        <i className="cw-label-dot" style={{ background: STATE_COLORS[stateOf(n)] }} /><b>{n.name}</b><span className="ops-muted"> {placeOf(n)}{n.now?.[0] ? ` · ${n.now[0].label}` : ''}{n.lesson?.teacher ? ` · ${n.lesson.teacher}` : ''}</span>
                      </button></li>
                    ))}
                  </ul>
                )}
              </div>
              <button type="button" className="cw-exit" aria-pressed={!hud} onClick={() => toggleHud(!hud)} title="Show or hide the panels over the map">{hud ? '◻ Hide panels' : '▣ Show panels'}</button>
              {hud && <button type="button" className="cw-exit cwc-all" onClick={() => panels.setAll(PANEL_IDS, panels.anyClosed(PANEL_IDS))} title="Fold every panel into a chip, or open them all again">{panels.anyClosed(PANEL_IDS) ? '⊞ Expand all' : '⊟ Collapse all'}</button>}
              <div className="cw-site">
                <span className="cw-site-badge">{siteName.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
                <span><b>{siteName}</b><span className="cw-site-sub">{k.rooms ? `${Math.round((Number(k.roomsInUse) / Number(k.rooms)) * 100)}% in use · ${k.roomsInUse}/${k.rooms} rooms` : 'No rooms recorded'}</span></span>
              </div>
              {d.preview
                ? <button type="button" className="cw-live is-preview" onClick={() => { setPlaying(false); setAt(null); setDate(null); }} title="You are looking at another time. Click to return to now.">◷ Preview {date && date !== schoolToday() ? `${date} ` : ''}{nowHm} · back to now</button>
                : <span className="cw-live" title={`As of ${fmtDateTime(d.asOf)}; refreshes every 30 seconds`}><i aria-hidden="true" />Live {nowHm}</span>}
            </div>
            <MomentBanner moment={d.moment} />

            <div className="cw-mid">
              <div className="cw-left" hidden={!hud}>
                {my.data && ['PARENT', 'STUDENT', 'TEACHER'].includes(my.data.role) || (my.data?.departments?.length ?? 0) > 0
                  ? <CollapsePanel id="mine" label={my.data?.role === 'PARENT' ? 'Your child\'s class' : my.data?.role === 'STUDENT' ? 'Your class' : my.data?.role === 'TEACHER' ? 'Your classes' : 'Your department'} panels={panels}>{myPanel}</CollapsePanel>
                  : null}
                <CollapsePanel id="kpis" label="Campus now" panels={panels} badge={k.roomsInUse}>
                <div className="cw-kpis" aria-label="Campus now">
                  {staffView && (
                    <div className="cw-kpi cw-glass"><span className="cw-kpi-icon is-green" aria-hidden="true">☺</span><div><span>Students present today</span><b>{k.studentsPresent === null || k.studentsPresent === undefined ? '—' : k.studentsPresent}</b><small>{k.studentsMarked ? `of ${k.studentsMarked} marked · ${k.sectionsMarked}/${k.sections} registers taken` : 'no register taken yet'}</small></div></div>
                  )}
                  {staffView && (
                    <div className="cw-kpi cw-glass"><span className="cw-kpi-icon" aria-hidden="true">✎</span><div><span>Classes right now</span><b>{k.classesNow ?? 0}</b><small>{Number(k.examsNow ?? 0) > 0 ? `${k.examsNow} room${Number(k.examsNow) === 1 ? '' : 's'} in exam` : 'no exam in progress'}</small></div></div>
                  )}
                  <div className="cw-kpi cw-glass"><span className="cw-kpi-icon" aria-hidden="true">▣</span><div><span>Rooms in use</span><b>{k.roomsInUse}</b><small>{k.roomsFree} free now</small></div></div>
                  <div className="cw-kpi cw-glass"><span className="cw-kpi-icon is-gold" aria-hidden="true">✦</span><div><span>Events today</span><b>{k.eventsToday}</b><small>{k.bookingsToday !== undefined ? `${k.bookingsToday} bookings` : 'on campus'}</small></div></div>
                  {k.openWorkOrders !== undefined
                    ? <div className="cw-kpi cw-glass"><span className="cw-kpi-icon is-orange" aria-hidden="true">🔧</span><div><span>Open repairs</span><b>{k.openWorkOrders}</b><small>{k.outOfUse} spaces out of use</small></div></div>
                    : <div className="cw-kpi cw-glass"><span className="cw-kpi-icon is-orange" aria-hidden="true">⛔</span><div><span>Out of use</span><b>{k.outOfUse}</b><small>closed or under repair</small></div></div>}
                </div>
                </CollapsePanel>
                {departments.length > 0 && (
                  <CollapsePanel id="depts" label="Departments" panels={panels} badge={departments.length}>
                  <div className="cw-glass cw-depts" role="group" aria-label="Departments">
                    <div className="cw-depts-title">Departments <span>click one to find it and see its figures</span></div>
                    <div className="cw-dept-list">
                      {departments.map((x) => (
                        <button key={x.code} type="button" className={`cw-dept${dept === x.code ? ' is-on' : ''}`} aria-pressed={dept === x.code} onClick={() => pickDept(x)}>
                          <span className="cw-dept-icon" aria-hidden="true">{DEPT_ICON[x.code] ?? '◆'}</span>
                          <span className="cw-dept-name">{x.name}</span>
                          {x.metrics[0] && <span className={`cw-dept-num is-${x.metrics[0].tone}`}>{x.metrics[0].value}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                  </CollapsePanel>
                )}
                {availableLayers(ops.data).length > 0 && (
                  <CollapsePanel id="ops" label="Operations now" panels={panels}>
                    <CampusLayersPanel data={ops.data} onGo={(id) => { const n = byId.get(id); if (n) goTo(n); }} />
                  </CollapsePanel>
                )}
              </div>
              <div className="cw-right">
                <div className="cw-glass cw-controls" role="group" aria-label="Camera">
                  <button type="button" onClick={() => sceneRef.current?.zoom(0.8)} aria-label="Zoom in">+</button>
                  <button type="button" onClick={() => sceneRef.current?.zoom(1.25)} aria-label="Zoom out">−</button>
                  <button type="button" onClick={() => sceneRef.current?.rotate(Math.PI / 8)} aria-label="Rotate left">⟲</button>
                  <button type="button" onClick={() => sceneRef.current?.rotate(-Math.PI / 8)} aria-label="Rotate right">⟳</button>
                  <button type="button" onClick={() => { setLevel({ kind: 'campus' }); setSelected(null); setDept(null); sceneRef.current?.home(); }} aria-label="Home view">⌂</button>
                </div>
                {!sel && activeDept && !panels.isOpen('dept') && (
                  <button type="button" className="cw-glass cwc-chip" aria-expanded={false} onClick={() => panels.toggle('dept')} title={`Show ${activeDept.name}`}><span aria-hidden="true">▸</span>{activeDept.name}</button>
                )}
                {!sel && activeDept && panels.isOpen('dept') && (
                  <div className="cw-glass cw-panel" role="region" aria-label={`${activeDept.name} department`}>
                    <div className="cw-panel-head">
                      <div><div className="cw-eyebrow">Department</div><div className="cw-panel-title">{activeDept.name}</div>{activeDept.description && <div className="ops-row-sub">{activeDept.description}</div>}</div>
                      <span className="cwc-headbtns"><FoldButton id="dept" label={`${activeDept.name} department`} panels={panels} /><button type="button" className="modal-close" onClick={() => setDept(null)} aria-label="Close department">×</button></span>
                    </div>
                    {(activeDept.head || activeDept.staffCount !== null) && (
                      <dl className="cw-facts">
                        {activeDept.head && <><dt>{activeDept.head.title}</dt><dd>{activeDept.head.name ?? 'Not appointed'}</dd></>}
                        {activeDept.staffCount !== null && <><dt>People</dt><dd>{activeDept.staffCount}</dd></>}
                      </dl>
                    )}
                    {activeDept.metrics.length > 0 && (
                      <div className="cw-metrics">{activeDept.metrics.map((m, i) => <div key={i} className={`cw-metric is-${m.tone}`}><b>{m.value}</b><span>{m.label}</span></div>)}</div>
                    )}
                    <DepartmentTasks data={ops.data} code={activeDept.code} />
                    {activeDept.facilityIds.length > 0 && (
                      <div>
                        <div className="field-label">Where it works</div>
                        <div className="cw-room-chips">{activeDept.facilityIds.map((id) => byId.get(id)).filter((n): n is CampusNodeDto => Boolean(n)).slice(0, 14).map((n) => (
                          <button key={n.id} type="button" onClick={() => goTo(n)}><i className="cw-label-dot" style={{ background: STATE_COLORS[stateOf(n)] }} />{n.name}</button>
                        ))}{activeDept.facilityIds.length > 14 && <span className="ops-muted">+{activeDept.facilityIds.length - 14} more</span>}</div>
                      </div>
                    )}
                    <div className="ops-inline" style={{ marginTop: 8 }}>
                      {pagesOf(portal, activeDept.pages, 4).map((p) => <Link key={p.href} className="btn btn-soft btn-sm" href={link(p.href)}>{p.label} →</Link>)}
                      {staffView && <SeeDetailsLink kind="department" id={activeDept.code} />}
                    </div>
                    {activeDept.metrics.length === 0 && pagesOf(portal, activeDept.pages).length === 0 && <p className="ops-muted">Its figures are kept for the staff who run it.</p>}
                  </div>
                )}
                {sel && !panels.isOpen('room') && (
                  <button type="button" className="cw-glass cwc-chip" aria-expanded={false} onClick={() => panels.toggle('room')} title={`Show ${sel.name}`}><span aria-hidden="true">▸</span>{sel.name}{sel.lesson ? <span className="cwc-badge">{sel.lesson.subject}</span> : null}</button>
                )}
                {sel && panels.isOpen('room') && (
                  <div className="cw-glass cw-panel" role="region" aria-label={`${sel.name} details`}>
                    <div className="cw-panel-head">
                      <div><div className="cw-eyebrow">{humanize(sel.kind)}{sel.code ? ` · ${sel.code}` : ''}{sel.department ? ` · ${sel.department}` : ''}</div><div className="cw-panel-title">{sel.name}</div><div className="ops-row-sub">{placeOf(sel)}</div></div>
                      <span className="cwc-headbtns"><FoldButton id="room" label={`${sel.name} details`} panels={panels} /><button type="button" className="modal-close" onClick={() => setSelected(null)} aria-label="Close details">×</button></span>
                    </div>
                    <div className="ops-inline" style={{ margin: '6px 0' }}>
                      <span className="cw-state" style={{ background: `${STATE_COLORS[stateOf(sel)]}33`, color: '#1f2937' }}><i className="cw-label-dot" style={{ background: STATE_COLORS[stateOf(sel)] }} />{stateLabel(sel) || humanize(sel.status)}</span>
                    </div>

                    {classToday?.exam?.paperToday && <div className="cw-exam">Exam today: <b>{classToday.exam.name}</b>{classToday.exam.subject ? ` · ${classToday.exam.subject}` : ''}</div>}

                    {sel.live && (
                      <div className="cw-head">
                        <div className="cw-head-num">
                          {sel.live.away ? <b>—</b> : sel.live.present === null ? <b>?</b> : <b>{sel.live.present}</b>}
                          <span>/ {sel.live.enrolled}</span>
                        </div>
                        <div className="cw-head-text">
                          <b>{sel.live.class ?? classToday?.class ?? 'This class'}{sel.live.homeRoom ? ' (home room)' : ''}</b>
                          <span>{sel.live.away ? `The class is in ${sel.live.awayIn ?? 'another room'} this period.` : sel.live.present === null ? 'The register has not been taken today.' : `${sel.live.present} present · ${sel.live.absent ?? 0} absent${classToday?.late ? ` · ${classToday.late} came late` : ''}`}</span>
                          {sel.live.attendancePct !== null && !sel.live.away && <Meter value={sel.live.attendancePct} tone={sel.live.attendancePct < 75 ? 'bad' : sel.live.attendancePct < 90 ? 'warn' : 'good'} />}
                        </div>
                      </div>
                    )}
                    {classToday && classToday.week.length > 1 && (
                      <div className="cw-week" aria-label="Attendance over the last school days">
                        {classToday.week.map((w) => <span key={w.date} title={`${fmtDate(w.date)}: ${w.present} of ${w.marked} present`}><i style={{ height: `${Math.max(8, w.pct ?? 0)}%` }} className={(w.pct ?? 0) < 75 ? 'is-bad' : (w.pct ?? 0) < 90 ? 'is-warn' : ''} /><em>{new Date(w.date).getUTCDate()}</em></span>)}
                      </div>
                    )}

                    {sel.lesson && (
                      <div className="cw-lesson">
                        <div className="cw-lesson-row"><span>Lesson now</span><b>{sel.lesson.subject}</b></div>
                        <div className="cw-lesson-row"><span>Class</span><b>{sel.lesson.class}</b></div>
                        {sel.lesson.teacher && <div className="cw-lesson-row"><span>Teacher</span><b>{sel.lesson.teacher}</b></div>}
                        <div className="cw-lesson-row"><span>Period {sel.lesson.periodNo}</span><b>{sel.lesson.startTime} to {sel.lesson.endTime}</b></div>
                      </div>
                    )}
                    {sel.lesson && (lessonModule
                      ? <ModuleBlock module={lessonModule} href={syllabusHref(lessonNow?.subjectOfferingId)} />
                      : <p className="ops-muted">The teacher has not laid out this subject&apos;s modules yet.</p>)}

                    <dl className="cw-facts">
                      {sel.capacity ? <><dt>Capacity</dt><dd>{sel.capacity}</dd></> : null}
                      <dt>Step-free</dt><dd>{sel.accessible ? 'Yes' : 'Not recorded'}</dd>
                      {sel.now?.filter((s) => s.type !== 'SCHEDULED_CLASS').map((s, i) => <span key={i} style={{ display: 'contents' }}><dt>{humanize(s.type)}</dt><dd>{s.label}{until(s.until)}</dd></span>)}
                      {sel.nextScheduled && <><dt>Next</dt><dd>{sel.nextScheduled.at} · {sel.nextScheduled.label}</dd></>}
                      {sel.periodsToday !== undefined && sel.periodsToday > 0 && <><dt>Periods today</dt><dd>{sel.periodsToday}</dd></>}
                      {sel.bookingsToday !== undefined && <><dt>Bookings today</dt><dd>{sel.bookingsToday}</dd></>}
                      {sel.openWorkOrders !== undefined && <><dt>Open repairs</dt><dd>{sel.openWorkOrders}{sel.urgentWorkOrders ? ` (${sel.urgentWorkOrders} urgent)` : ''}</dd></>}
                    </dl>
                    <RoomLayerFacts data={ops.data} facilityId={sel.id} />
                    {sel.kind === 'BUILDING' && (() => {
                      const sum = buildingSummary.get(sel.id);
                      return (
                        <>
                          {sum && (sum.lessons > 0 || sum.counted) && <div className="cw-metrics"><div className="cw-metric"><b>{sum.lessons}</b><span>classes now</span></div>{sum.exams > 0 && <div className="cw-metric is-warn"><b>{sum.exams}</b><span>in exam</span></div>}{sum.counted && <div className="cw-metric is-good"><b>{sum.present}</b><span>students present</span></div>}</div>}
                          <Button small onClick={() => enterBuilding(sel)}>Enter building</Button>
                        </>
                      );
                    })()}
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
                          {pagesOf(portal, RELATED[sel.kind] ?? []).map((p) => <Link key={p.href} className="btn btn-ghost btn-sm" href={link(p.href)}>{p.label} →</Link>)}
                        </div>
                        {sel.live && <p className="cw-source">Headcount: {sel.live.source.toLowerCase()}. It changes here as soon as the teacher marks or corrects it.</p>}
                      </>
                    )}
                    {(() => {
                      // Live now, below everything the panel already shows: refreshed every 15 seconds while open.
                      const liveKind = sel.kind in LIVE_KIND ? LIVE_KIND[sel.kind] : 'room';
                      if (!liveKind) return null;
                      if (liveKind === 'gate' && !ops.data?.gate) return null;
                      if (liveKind === 'bus' && !ops.data?.transport) return null;
                      return <LiveNowBlock key={`${liveKind}:${sel.id}`} kind={liveKind} id={liveKind === 'bus' ? null : sel.id} />;
                    })()}
                  </div>
                )}
              </div>
            </div>

            <div className="cw-bottom" hidden={!hud}>
              <CollapsePanel id="tracker" label={sel && steps.length > 0 ? `${sel.name} today` : 'Places, time and legend'} panels={panels} className="cwc-tracker">
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
                        <li key={i} className={`is-${s.state}`} title={[s.teacher, s.module ? `Module: ${s.module.title}` : null, s.module?.nextTopic ? `Next: ${s.module.nextTopic}` : null].filter(Boolean).join(' · ')}>
                          <span className="cw-step-dot" aria-hidden="true">{s.state === 'done' ? '✓' : s.periodNo ?? i + 1}</span>
                          <span className="cw-step-label">{s.subject}</span>
                          <span className="cw-step-sub">{s.teacher ?? s.section}</span>
                          {s.module && <span className="cw-step-sub cw-step-module">{s.module.title}</span>}
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
                {staffView && (
                  <div className="cw-time" role="group" aria-label="Time of day">
                    <button type="button" className="cw-play" onClick={() => { if (!playing && (!at || toMinutes(at) >= DAY_END)) setAt(hm(DAY_START)); setPlaying(!playing); }} aria-pressed={playing}>{playing ? '❚❚ Pause' : '▶ Play the day'}</button>
                    <input type="range" min={DAY_START} max={DAY_END} step={15} value={Math.min(DAY_END, Math.max(DAY_START, toMinutes(nowHm)))} onChange={(e) => { setPlaying(false); setAt(hm(Number(e.target.value))); }} aria-label="Look at another time of the day" aria-valuetext={nowHm} />
                    <b>{nowHm}</b>
                    <input type="date" className="cw-date" aria-label="Look at another date" value={date ?? schoolToday()} onChange={(e) => { setPlaying(false); setDate(e.target.value || null); if (!at) setAt(nowHm); }} />
                    {(at || date) && <button type="button" className="cw-now" onClick={() => { setPlaying(false); setAt(null); setDate(null); }}>Now</button>}
                  </div>
                )}
                <div className="cw-legend" aria-label="Legend">{legend.map(([key, label]) => <span key={key}><i style={{ background: STATE_COLORS[key] }} />{label}</span>)}</div>
                <div className="cw-toggles">
                  <label className="ops-chip"><input type="checkbox" checked={night} onChange={(e) => setNight(e.target.checked)} />Night</label>
                  <label className="ops-chip"><input type="checkbox" checked={lowPower} onChange={(e) => setLowPower(e.target.checked)} />Low-power</label>
                  <label className="ops-chip"><input type="checkbox" checked={reducedMotion} onChange={(e) => setReducedMotion(e.target.checked)} />Reduce motion</label>
                  <span className="ops-muted" title="Measured frames per second on this device">{fps ? `${fps} fps` : ''}</span>
                </div>
              </div>

              </CollapsePanel>

              <CollapsePanel id="table" label="On campus now" panels={panels} className="cwc-table">
              <div className="cw-glass cw-table">
                <div className="cw-tabs" role="tablist" aria-label="On campus now">
                  {staffView && <button type="button" role="tab" aria-selected={tableTab === 'classes'} className={tableTab === 'classes' ? 'is-on' : ''} onClick={() => setTableTab('classes')}>Classes <span>{lessons.length}</span></button>}
                  <button type="button" role="tab" aria-selected={tableTab === 'inuse' || (!staffView && tableTab === 'classes')} className={tableTab === 'inuse' || (!staffView && tableTab === 'classes') ? 'is-on' : ''} onClick={() => setTableTab('inuse')}>Booked <span>{inUse.length}</span></button>
                  {d.layers.maintenance && <button type="button" role="tab" aria-selected={tableTab === 'repairs'} className={tableTab === 'repairs' ? 'is-on' : ''} onClick={() => setTableTab('repairs')}>Repairs <span>{repairs.length}</span></button>}
                  <button type="button" role="tab" aria-selected={tableTab === 'events'} className={tableTab === 'events' ? 'is-on' : ''} onClick={() => setTableTab('events')}>Events <span>{d.eventsToday.length}</span></button>
                </div>
                <ul className="cw-rows">
                  {tableTab === 'classes' && staffView && (tableRows.length ? tableRows.map((n) => (
                    <li key={n.id}><button type="button" onClick={() => goTo(n)}>
                      <b>{n.name} · {n.lesson ? `${n.lesson.class} ${n.lesson.subject}` : n.now?.[0]?.label}</b>
                      <span className="cw-row-sub">{[n.lesson?.teacher, n.lesson?.module?.title, n.now?.[0]?.type === 'EXAM' ? 'Exam' : null].filter(Boolean).join(' · ') || 'Timetabled'}</span>
                      <span className="cw-pill" style={{ background: `${STATE_COLORS[stateOf(n)]}33` }}>{n.live && n.live.present !== null ? `${n.live.present}/${n.live.enrolled}` : n.live ? 'not marked' : `till ${n.lesson?.endTime ?? ''}`}</span><span aria-hidden="true">›</span>
                    </button></li>
                  )) : <li className="cw-empty">No class is timetabled at {nowHm}. Use the time slider to look at another part of the day.</li>)}
                  {(tableTab === 'inuse' || (!staffView && tableTab === 'classes')) && (inUse.length ? inUse.map((n) => (
                    <li key={n.id}><button type="button" onClick={() => goTo(n)}><b>{n.name}</b><span className="cw-row-sub">{n.now?.find((x) => ['BOOKED', 'EVENT'].includes(x.type))?.label}</span><span className="cw-pill" style={{ background: `${STATE_COLORS[stateOf(n)]}33` }}>{humanize(stateOf(n))}</span><span aria-hidden="true">›</span></button></li>
                  )) : <li className="cw-empty">No room is booked right now.</li>)}
                  {tableTab === 'repairs' && (repairs.length ? repairs.map((n) => (
                    <li key={n.id}><button type="button" onClick={() => goTo(n)}><b>{n.name}</b><span className="cw-row-sub">{placeOf(n)}</span><span className="cw-pill is-orange">{n.openWorkOrders ?? 0} open{n.urgentWorkOrders ? ` · ${n.urgentWorkOrders} urgent` : ''}</span><span aria-hidden="true">›</span></button></li>
                  )) : <li className="cw-empty">No open repairs.</li>)}
                  {tableTab === 'events' && (d.eventsToday.length ? d.eventsToday.slice(0, 8).map((e) => {
                    const venue = e.facilityId ? byId.get(e.facilityId) : null;
                    return <li key={e.id}><button type="button" onClick={() => venue && goTo(venue)} disabled={!venue}><b>{e.title}</b><span className="cw-row-sub">{venue?.name ?? 'Venue not set'} · {fmtDateTime(e.startsAt)}</span><span className="cw-pill is-gold">{humanize(e.status)}</span><span aria-hidden="true">›</span></button></li>;
                  }) : <li className="cw-empty">No events today.</li>)}
                </ul>
              </div>
              </CollapsePanel>
            </div>
          </div>
        </div>
      )}
      <DataNote>{String(k.definition ?? '')} Headcounts come from today&apos;s attendance register and show &quot;not taken&quot; until a teacher marks it; the figures drawn follow the day plan for the time shown (calendar, shifts and bells, timetable): classes in their rooms, lunch in the canteen, games and assembly on the ground, nobody on a holiday or after hours. They are illustrative, and no one is located or tracked. Restricted spaces are hidden or masked for your role before anything reaches this page.</DataNote>
      {modal === 'book' && sel && <BookRoomModal facilityId={sel.id} onClose={() => setModal(null)} onDone={() => void map.reload()} />}
      {modal === 'issue' && sel && <ReportIssueModal facilityId={sel.id} onClose={() => setModal(null)} onDone={() => void map.reload()} />}
    </div>
  );
}
