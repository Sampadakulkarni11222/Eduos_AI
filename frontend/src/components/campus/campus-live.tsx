'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { opsApi } from '@/lib/ops-api';
import { useAuth } from '@/lib/auth';
import { usePortalHref, usePortalPage } from '@/lib/school-path';
import type { CampusLiveDetailDto, CampusLiveNowDto, CampusLivePeriodDto, CampusLiveSectionDto, CampusMyViewDto } from '@/lib/ops-types';
import { DataNote, ErrorNote, humanize } from '@/components/ops/kit';
import { TeacherAbout } from './campus-moment';

/**
 * Live details for the campus map, added alongside what the map already shows:
 *   - LiveNowBlock: the "Live now" block under a room's usual details;
 *   - LiveDetailView: one dynamic page (?kind=room|class|teacher|bus|lab|
 *     department|zone|gate&id=…) whose sections come from the server, each with
 *     a link to the dedicated page when the reader's portal has one;
 *   - MyCampusPanel: the reader's own corner (a parent's child's class, a
 *     student's own class, a teacher's current and next class);
 *   - CollapsePanel / usePanelState: fold any panel over the 3D view into a
 *     slim chip, remembered per user on this device.
 * Everything here is what GET /campus/live and /campus/my-view returned for
 * this reader; nothing is filtered or hidden in the browser.
 */

const IST: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false };
export const clock = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat('en-IN', IST).format(new Date(iso)) : '—');
export function ago(iso: string | null | undefined, now: number) {
  if (!iso) return null;
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `at ${clock(iso)}`;
}
const STATUS_TONE: Record<string, string> = { PRESENT: 'good', LATE: 'warn', ABSENT: 'bad', EXCUSED: 'neutral', HALF_DAY: 'warn' };

/** Fetches now and every `seconds` while mounted and the tab is visible. */
export function usePoll<T>(fn: () => Promise<T>, deps: unknown[], seconds = 15, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const run = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const out = await fn();
      if (mine === seq.current) { setData(out); setError(null); }
    } catch (err) {
      if (mine === seq.current) setError(err instanceof Error ? err.message : 'Could not load.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are the caller's
  }, deps);
  useEffect(() => {
    if (!enabled) return undefined;
    setData(null); setError(null);
    void run();
    const t = window.setInterval(() => { if (!document.hidden) void run(); }, Math.max(5, seconds) * 1000);
    return () => window.clearInterval(t);
  }, [run, seconds, enabled]);
  return { data, error, reload: run };
}

/** A ticking clock for countdowns. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), ms); return () => window.clearInterval(t); }, [ms]);
  return now;
}

/** The period's start, end, a progress bar and the time left. */
export function PeriodProgress({ period, now }: { period: CampusLivePeriodDto; now: number }) {
  const start = new Date(period.startsAt).getTime();
  const end = new Date(period.endsAt).getTime();
  const pct = end > start ? Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100))) : 0;
  const left = Math.max(0, Math.round((end - now) / 1000));
  const h = Math.floor(left / 3600);
  const mm = Math.floor((left % 3600) / 60);
  const ss = left % 60;
  const leftText = left === 0 ? 'ending now' : h ? `${h} h ${mm} min left` : `${mm}:${String(ss).padStart(2, '0')} left`;
  return (
    <div className="cwlv-period">
      <div className="cwlv-period-row"><span>Period {period.periodNo} · {period.startTime}–{period.endTime}</span><b>{leftText}</b></div>
      <span className="cwlv-bar" role="progressbar" aria-label={`Period ${period.periodNo} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct}% done, ${leftText}`}><i style={{ width: `${pct}%` }} /></span>
    </div>
  );
}

function liveNote(d: CampusLiveDetailDto) {
  const s = d.sections.find((x) => x.key === 'live' && x.type === 'note');
  return s && s.type === 'note' ? s.text : null;
}

/** The "Live now" block for the room panel. Polls every 15 seconds while open. */
export function LiveNowBlock({ kind = 'room', id }: { kind?: string; id: string | null }) {
  const link = usePortalHref();
  const q = usePoll(() => opsApi.campusLive(kind, id), [kind, id], 15);
  const now = useNow(1000);
  const d = q.data;
  if (!d) return q.error ? null : <div className="cwlv is-loading" aria-live="polite">Checking what is happening now…</div>;
  const l: CampusLiveNowDto | null | undefined = d.live;
  const note = liveNote(d);
  const href = link(`/live?kind=${encodeURIComponent(kind)}${id ? `&id=${encodeURIComponent(id)}` : ''}`);
  const a = l?.attendance;
  return (
    <section className="cwlv" aria-label="Live now">
      <div className="cwlv-head"><span className="cwlv-dot" aria-hidden="true" /><b>Live now</b><span className="cwlv-upd" title={`As of ${clock(d.asOf)}`}>updated {clock(d.asOf)}</span></div>
      {l?.period ? (
        <>
          <dl className="cw-facts">
            <dt>Teacher</dt><dd>{l.period.teacher ?? 'Not recorded'}{l.period.coveringFor ? <span className="cwlv-cover"> · covering for {l.period.coveringFor}</span> : null}</dd>
            {l.className && <><dt>Class</dt><dd>{l.className}</dd></>}
            <dt>Subject</dt><dd>{l.period.subject}</dd>
          </dl>
          <PeriodProgress period={l.period} now={now} />
        </>
      ) : l && (l.className || l.next) ? (
        <p className="ops-muted">No lesson right now{l.next ? ` · next at ${l.next.startTime}: ${l.next.subject}` : ''}.</p>
      ) : null}
      {l?.awayIn && <p className="ops-muted">{l.className} is in {l.awayIn} this period.</p>}
      {a && (
        <dl className="cw-facts">
          <dt>Register</dt><dd>{a.marked ? 'Marked' : 'Not marked yet'}</dd>
          <dt>Present</dt><dd>{a.present === null ? '—' : a.present} / {a.strength}</dd>
          {a.late !== null && a.late !== undefined && <><dt>Came late</dt><dd>{a.late}</dd></>}
          {a.periodRegister && <><dt>This period</dt><dd>{a.periodRegister.present} of {a.periodRegister.marked} marked present</dd></>}
          <dt>Last update</dt><dd>{a.lastUpdatedAt ? ago(a.lastUpdatedAt, now) : 'not today yet'}</dd>
        </dl>
      )}
      {l?.practical && <div className="cwlv-act"><span>Practical</span><b>{l.practical.title}</b>{l.practical.className ? ` · ${l.practical.className}` : ''}</div>}
      {l?.club && <div className="cwlv-act"><span>Club session</span><b>{l.club.title}</b>{l.club.startTime ? ` · ${l.club.startTime}–${l.club.endTime ?? ''}` : ''}</div>}
      {note && <p className="ops-muted">{note}</p>}
      {!note && <Link className="btn btn-soft btn-sm" href={href}>See details →</Link>}
    </section>
  );
}

/** A link to the live page for any kind, used by panels that already have their own data. */
export function SeeDetailsLink({ kind, id, label = 'See details →' }: { kind: string; id?: string | null; label?: string }) {
  const link = usePortalHref();
  return <Link className="btn btn-soft btn-sm" href={link(`/live?kind=${encodeURIComponent(kind)}${id ? `&id=${encodeURIComponent(id)}` : ''}`)}>{label}</Link>;
}

// ── The dynamic page ────────────────────────────────────────────────────

function Roster({ section }: { section: Extract<CampusLiveSectionDto, { type: 'roster' }> }) {
  const [filter, setFilter] = useState<'ALL' | 'PRESENT' | 'ABSENT' | 'LATE' | 'NONE'>('ALL');
  const count = (f: string) => section.items.filter((r) => (f === 'NONE' ? !r.status : f === 'PRESENT' ? r.status === 'PRESENT' : r.status === f)).length;
  const rows = section.items.filter((r) => filter === 'ALL' || (filter === 'NONE' ? !r.status : r.status === filter));
  const chips: Array<[typeof filter, string]> = [['ALL', `All ${section.items.length}`], ['PRESENT', `Present ${count('PRESENT')}`], ['LATE', `Late ${count('LATE')}`], ['ABSENT', `Absent ${count('ABSENT')}`], ['NONE', `Not marked ${count('NONE')}`]];
  return (
    <>
      <div className="lvd-filter" role="group" aria-label="Filter the list">
        {chips.map(([k, label]) => <button key={k} type="button" className={`ops-chip${filter === k ? ' is-on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>)}
      </div>
      <ul className="lvd-roster">
        {rows.map((r) => (
          <li key={r.id}>
            <span className="lvd-avatar" aria-hidden="true">{r.initial}</span>
            <span className="lvd-name"><b>{r.name}</b><small>{[r.admissionNo, r.rollNo !== null ? `Roll ${r.rollNo}` : null].filter(Boolean).join(' · ')}</small></span>
            <span className={`cw-pill lvd-st is-${r.status ? STATUS_TONE[r.status] ?? 'neutral' : 'neutral'}`}>{r.status ? humanize(r.status) : 'Not marked'}</span>
          </li>
        ))}
        {!rows.length && <li className="cw-empty">Nobody in this list.</li>}
      </ul>
    </>
  );
}

function SectionBody({ s, now }: { s: CampusLiveSectionDto; now: number }) {
  const link = usePortalHref();
  switch (s.type) {
    case 'facts':
      return <dl className="cw-facts">{s.rows.map((r, i) => <span key={i} style={{ display: 'contents' }}><dt>{r.label}</dt><dd>{r.format === 'time' ? clock(String(r.value)) : r.value}</dd></span>)}</dl>;
    case 'metrics':
      return (
        <>
          <div className="cw-metrics">{s.items.map((m, i) => <div key={i} className={`cw-metric is-${m.tone ?? 'neutral'}`}><b>{m.value ?? '—'}</b><span>{m.label}</span></div>)}</div>
          {(s.note || s.updatedAt) && <p className="ops-muted">{s.note}{s.updatedAt ? ` Last change ${ago(s.updatedAt, now)}.` : ''}</p>}
        </>
      );
    case 'list':
      return s.items.length ? (
        <ul className="ops-list">{s.items.map((it, i) => (
          <li key={i} className={`ops-row${it.state === 'now' ? ' lvd-now' : ''}`}>
            <div className="ops-row-main">
              {it.go ? <Link className="ops-row-title" href={link(`/live?kind=${it.go.kind}&id=${it.go.id}`)}>{it.title}</Link> : <div className="ops-row-title">{it.title}</div>}
              {(it.sub || it.at) && <div className="ops-row-sub">{[it.sub, it.at ? clock(it.at) : null].filter(Boolean).join(' · ')}</div>}
            </div>
            {it.state === 'now' && <span className="cw-pill is-good">now</span>}
            {it.badge && <span className="cw-pill">{it.badge}</span>}
          </li>
        ))}</ul>
      ) : <p className="ops-muted">{s.empty ?? 'Nothing to show.'}</p>;
    case 'roster':
      return <Roster section={s} />;
    case 'period':
      return (
        <>
          <dl className="cw-facts">
            <dt>Class</dt><dd>{s.className}</dd>
            <dt>Subject</dt><dd>{s.period.subject}</dd>
            <dt>Teacher</dt><dd>{s.period.teacher ?? 'Not recorded'}{s.period.coveringFor ? ` · covering for ${s.period.coveringFor}` : ''}</dd>
            {s.period.room && <><dt>Room</dt><dd>{s.period.room}</dd></>}
          </dl>
          <PeriodProgress period={s.period} now={now} />
          <p className="ops-muted">Register {s.attendance.marked ? `marked · ${s.attendance.present} of ${s.attendance.strength} present` : `not marked yet · ${s.attendance.strength} on roll`}.</p>
        </>
      );
    case 'note':
      return <p className="ops-muted">{s.text}</p>;
    default:
      return null;
  }
}

/** /<portal>/live?kind=…&id=… — every detail the reader may see, refreshed every 15 seconds. */
export function LiveDetailView() {
  const params = useSearchParams();
  const kind = params?.get('kind') ?? 'room';
  const id = params?.get('id') ?? null;
  // Opened from the menu with nothing chosen: show the reader's own corner instead of "Invalid id".
  if (!params?.get('kind') && !id) return <LiveLanding />;
  return <LiveDetail kind={kind} id={id} />;
}

/** /<portal>/live with no choice yet: the reader's own class, classes or department, and where to pick anything else. */
export function LiveLanding() {
  const [studentId, setStudentId] = useState<string | null>(null);
  const [data, setData] = useState<CampusMyViewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const link = usePortalHref();
  const page = usePortalPage();
  const router = useRouter();
  useEffect(() => {
    let live = true;
    opsApi.campusMyView(studentId).then((d) => { if (live) { setData(d); setError(null); } }).catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : 'Live details could not be loaded.'); });
    return () => { live = false; };
  }, [studentId]);
  const campus = page('/campus');
  return (
    <div className="ops-stack">
      <DataNote>Choose what to follow live: your own class or department below, or any room, class, bus or zone from Campus World. Details refresh every 15 seconds and show only what you may see.</DataNote>
      {error ? <ErrorNote error={error} /> : !data ? <p className="ops-muted" aria-live="polite">Loading…</p> : (
        <MyCampusPanel data={data} onGo={(facilityId) => router.push(link(`/live?kind=room&id=${encodeURIComponent(facilityId)}`))} onChild={setStudentId} onDept={(code) => router.push(link(`/live?kind=department&id=${encodeURIComponent(code)}`))} />
      )}
      <div className="ops-inline">
        {campus && <Link className="btn btn-soft btn-sm" href={campus}>Open Campus World →</Link>}
        {page('/gate') && <Link className="btn btn-ghost btn-sm" href={link('/live?kind=gate')}>The gate now →</Link>}
      </div>
    </div>
  );
}

export function LiveDetail({ kind, id }: { kind: string; id: string | null }) {
  const q = usePoll(() => opsApi.campusLive(kind, id), [kind, id], 15);
  const now = useNow(1000);
  const page = usePortalPage();
  const link = usePortalHref();
  const d = q.data;
  if (q.error && !d) return <ErrorNote error={q.error} />;
  if (!d) return <div className="ops-stack"><p className="ops-muted" aria-live="polite">Loading live details…</p></div>;
  const fullPage = (s: CampusLiveSectionDto) => (s.link ? page(`/${s.link.page}${s.link.query ?? ''}`) : null);
  return (
    <div className="ops-stack lvd">
      <div className="ops-inline lvd-top">
        <Link className="btn btn-ghost btn-sm" href={link('/campus')}>← Campus World</Link>
        {d.facilityId && kind !== 'room' && <Link className="btn btn-ghost btn-sm" href={link(`/live?kind=room&id=${d.facilityId}`)}>The room</Link>}
        {d.sectionId && kind !== 'class' && <Link className="btn btn-ghost btn-sm" href={link(`/live?kind=class&id=${d.sectionId}`)}>The class</Link>}
        {d.live?.period?.teacherProfileId && <Link className="btn btn-ghost btn-sm" href={link(`/live?kind=teacher&id=${d.live.period.teacherProfileId}`)}>The teacher</Link>}
        <span className="cw-live lvd-live" title={`Refreshes every ${d.refreshSeconds} seconds`}><i aria-hidden="true" />Live · updated {clock(d.asOf)}</span>
        {q.error && <span className="ops-muted" role="status">Could not refresh: {q.error}</span>}
      </div>
      <div className="lvd-head">
        <div className="cw-eyebrow">{humanize(d.kind)}</div>
        <h2 className="lvd-title">{d.title}</h2>
        {d.subtitle && <div className="ops-row-sub">{d.subtitle}</div>}
      </div>
      <div className="lvd-grid">
        {d.sections.map((s) => {
          const href = fullPage(s);
          return (
            <section key={s.key} className={`card card-pad lvd-sec lvd-${s.type}`} aria-label={s.title}>
              <div className="ops-section-head"><h3 className="ops-section-title">{s.title}</h3>{href && <Link className="btn btn-ghost btn-sm" href={href}>Open full page →</Link>}</div>
              <SectionBody s={s} now={now} />
            </section>
          );
        })}
      </div>
      {d.pages && d.pages.length > 0 && (
        <div className="ops-inline">{d.pages.map((p) => page(`/${p}`)).filter((h): h is string => Boolean(h)).map((h) => <Link key={h} className="btn btn-soft btn-sm" href={h}>{humanize(h.split('/').pop() ?? '')} →</Link>)}</div>
      )}
      <DataNote>From the timetable, today&apos;s attendance register, staff cover and each module&apos;s own records, refreshed every {d.refreshSeconds} seconds. You see only what your role allows; nobody is located or tracked.</DataNote>
    </div>
  );
}

// ── My campus ───────────────────────────────────────────────────────────

const TODAY_LABEL: Record<string, string> = { PRESENT: 'Present', LATE: 'Came late', ABSENT: 'Absent', EXCUSED: 'Excused', HALF_DAY: 'Half day' };

/** The reader's own corner of the campus, above the map's other panels. */
export function MyCampusPanel({ data, onGo, onChild, onDept }: {
  data: CampusMyViewDto | null; onGo: (facilityId: string) => void; onChild?: (studentId: string) => void; onDept?: (code: string) => void;
}) {
  const now = useNow(1000);
  const page = usePortalPage();
  const link = usePortalHref();
  if (!data) return null;
  if (data.role === 'PARENT' || data.role === 'STUDENT') {
    const parent = data.role === 'PARENT';
    const c = data.child;
    const lastCheck = c?.checkpoints?.length ? c.checkpoints[c.checkpoints.length - 1] : null;
    const bus = c?.bus?.find((b) => b.status === 'IN_PROGRESS') ?? c?.bus?.[0] ?? null;
    return (
      <div className="cw-glass cwmy" role="region" aria-label={parent ? 'Your child\'s class' : 'Your class'}>
        <div className="cwmy-head">
          <span className="cw-depts-title">{parent ? 'Your child\'s class' : 'Your class'}</span>
          {parent && (data.children?.length ?? 0) > 1 && (
            <select className="cwmy-switch" aria-label="Choose your child" value={data.selectedStudentId ?? ''} onChange={(e) => onChild?.(e.target.value)}>
              {data.children!.map((k) => <option key={k.studentId} value={k.studentId}>{k.name}{k.className ? ` · ${k.className}` : ''}</option>)}
            </select>
          )}
        </div>
        {!data.focus ? <p className="ops-muted">{data.note ?? 'Nothing to show yet.'}</p> : (
          <>
            <div className="cwmy-title"><b>{data.focus.className}</b>{data.focus.roomName ? <span className="ops-muted"> · {data.focus.roomName}</span> : null}</div>
            {data.now ? (
              <>
                <div className="cwmy-now"><span>Now</span><b>{data.now.subject}</b>{data.teacher ? <> with <b>{data.teacher.name}</b>{data.teacher.coveringFor ? <span className="ops-muted"> (covering for {data.teacher.coveringFor})</span> : null}</> : null}</div>
                <PeriodProgress period={data.now} now={now} />
                <TeacherAbout about={data.teacher?.about} compact />
              </>
            ) : <p className="ops-muted">No lesson right now.</p>}
            {data.classCounts && <div className="cwmy-line">Class strength <b>{data.classCounts.strength}</b> · {data.classCounts.marked ? <>present <b>{data.classCounts.present}</b></> : 'register not taken yet'}</div>}
            {c && (
              <div className="cwmy-line">
                {parent ? c.name : 'You'} today: <b className={`cwmy-st is-${c.today ? STATUS_TONE[c.today] ?? 'neutral' : 'neutral'}`}>{c.today ? TODAY_LABEL[c.today] ?? humanize(c.today) : 'not marked yet'}</b>
                {lastCheck && <span className="ops-muted"> · {lastCheck.label} at {clock(lastCheck.at)}</span>}
              </div>
            )}
            {bus && <div className="cwmy-line">Bus: <b>{bus.title}</b> · {humanize(bus.myStatus || bus.status)}{bus.stop ? ` · ${bus.stop}` : ''}{bus.eta ? ` · ${bus.eta.isEstimate ? 'about ' : ''}${clock(bus.eta.at)}` : ''}</div>}
            {data.next && 'subject' in data.next && <div className="cwmy-line ops-muted">Next: {data.next.startTime} · {data.next.subject}{'teacher' in data.next && data.next.teacher ? ` · ${data.next.teacher}` : ''}</div>}
            {data.timetable && data.timetable.length > 0 && (
              <ol className="cwmy-tt" aria-label="Today's timetable">
                {data.timetable.map((t) => <li key={t.periodNo} className={`is-${t.state}`}><span>{t.startTime}</span>{t.subject}</li>)}
              </ol>
            )}
            <div className="ops-inline">
              {data.focus.facilityId && <button type="button" className="btn btn-soft btn-sm" onClick={() => onGo(data.focus!.facilityId!)}>Show on map</button>}
              <Link className="btn btn-soft btn-sm" href={link(`/live?kind=class&id=${data.focus.sectionId}`)}>See details →</Link>
              {page('/bus-today') && c?.bus && c.bus.length > 0 && <Link className="btn btn-ghost btn-sm" href={page('/bus-today')!}>Bus today →</Link>}
            </div>
          </>
        )}
      </div>
    );
  }
  if (data.role === 'TEACHER') {
    const cur = data.current;
    const nxt = data.next && 'className' in data.next ? data.next : null;
    const att = page('/attendance');
    const row = (k: NonNullable<typeof cur>, label: string) => (
      <div className="cwmy-class">
        <div className="cwmy-now"><span>{label}</span><b>{k.className} · {k.subject}</b>{k.roomName ? <span className="ops-muted"> · {k.roomName}</span> : null}{k.cover ? <span className="ops-muted"> · covering for {k.cover}</span> : null}</div>
        <div className="cwmy-line">{k.startTime}–{k.endTime} · {k.marked ? <>present <b>{k.present}</b> of {k.strength}</> : `${k.strength} on roll · register not taken`}</div>
        <div className="ops-inline">
          {k.facilityId && <button type="button" className="btn btn-soft btn-sm" onClick={() => onGo(k.facilityId!)}>Show on map</button>}
          <Link className="btn btn-soft btn-sm" href={link(`/live?kind=class&id=${k.sectionId}`)}>See details →</Link>
          {att && <Link className="btn btn-ghost btn-sm" href={att}>Attendance →</Link>}
        </div>
      </div>
    );
    return (
      <div className="cw-glass cwmy" role="region" aria-label="Your classes">
        <div className="cwmy-head"><span className="cw-depts-title">Your classes</span></div>
        {cur ? <>{row(cur, 'Now')}{cur.startsAt && cur.endsAt && <PeriodProgress period={{ periodNo: cur.periodNo, startTime: cur.startTime, endTime: cur.endTime, startsAt: cur.startsAt, endsAt: cur.endsAt, subject: cur.subject, teacher: null, coveringFor: null, room: cur.room }} now={now} />}</> : <p className="ops-muted">You are not teaching this period.</p>}
        {nxt ? row(nxt, 'Next') : <p className="ops-muted">No more classes today.</p>}
      </div>
    );
  }
  if (data.role === 'STAFF' && ((data.departments?.length ?? 0) > 0)) {
    return (
      <div className="cw-glass cwmy" role="region" aria-label="Your departments">
        <div className="cwmy-head"><span className="cw-depts-title">Your department</span></div>
        <div className="ops-inline">
          {data.departments!.map((code) => <button key={code} type="button" className="btn btn-soft btn-sm" onClick={() => onDept?.(code)}>{humanize(code)}</button>)}
          {data.departments!.map((code) => <SeeDetailsLink key={`d-${code}`} kind="department" id={code} label={`${humanize(code)} live →`} />)}
        </div>
      </div>
    );
  }
  return null;
}

// ── Collapsible panels ──────────────────────────────────────────────────

function useProfileId(): string | null {
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- always called; only throws outside the provider
    const auth = useAuth() as unknown as { me?: { profile?: { id?: string } } };
    return auth?.me?.profile?.id ?? null;
  } catch {
    return null;
  }
}

export interface PanelState { isOpen: (id: string) => boolean; toggle: (id: string) => void; setAll: (ids: string[], open: boolean) => void; anyClosed: (ids: string[]) => boolean }

/** Which panels are folded, remembered per user on this device. */
export function usePanelState(): PanelState {
  const pid = useProfileId();
  const key = `eduos.campus.panels.${pid ?? 'me'}`;
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try { const raw = localStorage.getItem(key); setClosed(raw ? JSON.parse(raw) as Record<string, boolean> : {}); } catch { setClosed({}); }
  }, [key]);
  const save = useCallback((update: (cur: Record<string, boolean>) => Record<string, boolean>) => {
    setClosed((cur) => {
      const next = update(cur);
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, [key]);
  return {
    isOpen: (id) => !closed[id],
    toggle: (id) => save((cur) => ({ ...cur, [id]: !cur[id] })),
    setAll: (ids, open) => save((cur) => ({ ...cur, ...Object.fromEntries(ids.map((i) => [i, !open])) })),
    anyClosed: (ids) => ids.some((i) => closed[i]),
  };
}

/** A panel over the 3D view that folds into a slim chip and opens again. */
export function CollapsePanel({ id, label, panels, badge, children, className }: { id: string; label: string; panels: PanelState; badge?: ReactNode; children: ReactNode; className?: string }) {
  const domId = `cwc-${id}`;
  if (!panels.isOpen(id)) {
    return (
      <button type="button" className="cw-glass cwc-chip" aria-expanded={false} aria-controls={domId} onClick={() => panels.toggle(id)} title={`Show ${label}`}>
        <span aria-hidden="true">▸</span>{label}{badge !== undefined && badge !== null ? <span className="cwc-badge">{badge}</span> : null}
      </button>
    );
  }
  return (
    <div className={`cwc${className ? ` ${className}` : ''}`} id={domId}>
      <button type="button" className="cwc-fold" aria-expanded aria-controls={domId} aria-label={`Collapse ${label}`} title={`Collapse ${label}`} onClick={() => panels.toggle(id)}>–</button>
      {children}
    </div>
  );
}

/** The fold button for a panel that has its own header (the room and department panels). */
export function FoldButton({ id, label, panels }: { id: string; label: string; panels: PanelState }) {
  return <button type="button" className="modal-close cwc-headfold" aria-expanded={panels.isOpen(id)} aria-label={`Collapse ${label}`} title={`Collapse ${label}`} onClick={() => panels.toggle(id)}>–</button>;
}
