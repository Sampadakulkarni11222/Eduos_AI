'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { cctvApi, playbackUrl, type CctvCamera, type CctvManagedCamera, type CctvPlayback, type CctvSettings, type CctvStatus } from '@/lib/cctv-api';
import { DataNote, ErrorNote, Loadable, SectionCard, StatusPill, Tabs, fmtDateTime, humanize, isoDay, useAction, useLoad, useQueryParam } from './kit';

/**
 * Live CCTV (optional; feature cctvLive). View-only for authorised staff:
 * no recording, download or snapshot; the viewer's name and the time are
 * watermarked over the picture; "still watching?" after the school's idle
 * time; every viewing is logged. The page never invents footage: without a
 * connected gateway it says so and shows the setup steps.
 */
const HEALTH_LABEL: Record<string, string> = { ONLINE: 'Online', OFFLINE: 'Offline', UNKNOWN: 'Not checked', NOT_CONNECTED: 'Not connected' };
const HEALTH_PILL: Record<string, string> = { ONLINE: 'CONFIRMED', OFFLINE: 'OVERDUE', UNKNOWN: 'PENDING', NOT_CONNECTED: 'CLOSED' };
const LOCATIONS = ['GATE', 'ENTRANCE', 'PERIMETER', 'PARKING', 'BUS_BAY', 'RECEPTION', 'CORRIDOR', 'STAIRCASE', 'GROUND', 'PLAYGROUND', 'CANTEEN', 'HOSTEL_CORRIDOR', 'LIBRARY', 'LAB', 'CLASSROOM', 'LECTURE_HALL', 'AUDITORIUM', 'STORE', 'SERVER_ROOM'];
const PURPOSES = ['ENTRY_EXIT', 'PERIMETER_SECURITY', 'CORRIDOR_SAFETY', 'TRANSPORT_SAFETY', 'HOSTEL_SAFETY', 'COMMON_AREA_SAFETY', 'ASSET_PROTECTION', 'EVENT_SAFETY'];
const RENEW_MS = 4 * 60_000;

function NoGateway({ steps }: { steps: string[] }) {
  return (
    <SectionCard title="No camera connected: set up your NVR/gateway" sub="EduOS shows live video only from the school's own NVR/VMS or video gateway. Nothing is shown until one is connected.">
      <ol className="cctv-steps">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      <DataNote>RTSP cannot play in a browser. A gateway such as MediaMTX or go2rtc converts each camera to WebRTC (WHEP) or HLS; EduOS plays it through a short-lived, logged link.</DataNote>
    </SectionCard>
  );
}

// ── player ──────────────────────────────────────────────────────────────

function Watermark({ name }: { name: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const text = `${name} · ${now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  return (
    <div className="cctv-watermark" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => <span key={i}>{text}</span>)}
    </div>
  );
}

function Player({ camera, reason, onClose }: { camera: CctvCamera; reason?: string; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const sessionRef = useRef<string | null>(null);
  const [pb, setPb] = useState<CctvPlayback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<'connecting' | 'playing' | 'unsupported' | 'ended'>('connecting');
  const [askStill, setAskStill] = useState(false);

  const stop = useCallback(async (why?: string) => {
    pcRef.current?.close(); pcRef.current = null;
    if (videoRef.current) { videoRef.current.removeAttribute('src'); videoRef.current.srcObject = null; videoRef.current.load(); }
    const sid = sessionRef.current; sessionRef.current = null;
    if (sid) await cctvApi.end(sid).catch(() => undefined);
    setState('ended');
    if (why) setError(why);
  }, []);

  // Start the viewing once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const p = await cctvApi.start(camera.id, reason);
        if (cancelled) { void cctvApi.end(p.sessionId); return; }
        sessionRef.current = p.sessionId;
        setPb(p);
        const video = videoRef.current!;
        if (p.streamType === 'HLS' && p.playbackPath) {
          if (!video.canPlayType('application/vnd.apple.mpegurl')) { setState('unsupported'); return; }
          video.src = playbackUrl(p.playbackPath);
          await video.play().catch(() => undefined);
          setState('playing');
        } else if (p.whepPath) {
          const pc = new RTCPeerConnection();
          pcRef.current = pc;
          pc.addTransceiver('video', { direction: 'recvonly' });
          pc.ontrack = (e) => { video.srcObject = e.streams[0] ?? new MediaStream([e.track]); void video.play().catch(() => undefined); setState('playing'); };
          await pc.setLocalDescription(await pc.createOffer());
          await new Promise<void>((resolve) => {
            if (pc.iceGatheringState === 'complete') { resolve(); return; }
            const t = setTimeout(resolve, 2500);
            pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); } });
          });
          const answer = await cctvApi.whep(p.whepPath, p.token, pc.localDescription!.sdp);
          await pc.setRemoteDescription({ type: 'answer', sdp: answer });
        }
      } catch (err) {
        if (!cancelled) { setError(err instanceof Error ? err.message : 'The camera could not be opened.'); setState('ended'); }
      }
    })();
    return () => { cancelled = true; void stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one viewing per mount
  }, [camera.id]);

  // Renew the short-lived token; ask "still watching?" before the idle limit.
  useEffect(() => {
    if (!pb || state === 'ended') return undefined;
    const renew = setInterval(() => {
      const sid = sessionRef.current; if (!sid) return;
      void cctvApi.renew(sid).then((p) => {
        // Native HLS keeps its first URL: give it the new token.
        if (p.streamType === 'HLS' && p.playbackPath && videoRef.current && state === 'playing') { videoRef.current.src = playbackUrl(p.playbackPath); void videoRef.current.play().catch(() => undefined); }
        setPb((old) => (old ? { ...old, ...p } : p));
      }).catch((err: unknown) => void stop(err instanceof Error ? err.message : 'The viewing ended.'));
    }, RENEW_MS);
    const askAt = new Date(pb.confirmBy).getTime() - 60_000 - Date.now();
    const ask = setTimeout(() => setAskStill(true), Math.max(askAt, 5_000));
    const end = setTimeout(() => void stop('The viewing ended because nobody confirmed "still watching?".'), Math.max(new Date(pb.confirmBy).getTime() + 55_000 - Date.now(), 10_000));
    return () => { clearInterval(renew); clearTimeout(ask); clearTimeout(end); };
  }, [pb, state, stop]);

  const stillWatching = async () => {
    setAskStill(false);
    const sid = sessionRef.current; if (!sid) return;
    try { const p = await cctvApi.renew(sid, true); setPb((old) => (old ? { ...old, ...p } : p)); } catch (err) { void stop(err instanceof Error ? err.message : 'The viewing ended.'); }
  };
  const fullscreen = () => { void boxRef.current?.requestFullscreen?.().catch(() => undefined); };

  return (
    <div className="ops-stack">
      <div className="ops-inline" style={{ justifyContent: 'space-between' }}>
        <div><b>{camera.name}</b> <span className="ops-muted">{camera.zone ?? ''}</span></div>
        <div className="ops-inline">
          <Button variant="soft" small onClick={fullscreen} disabled={state !== 'playing'}>Fullscreen</Button>
          <Button variant="soft" small onClick={() => { void stop(); onClose(); }}>Close</Button>
        </div>
      </div>
      <div ref={boxRef} className="cctv-player" onContextMenu={(e) => e.preventDefault()}>
        <video ref={videoRef} className="cctv-video" muted playsInline autoPlay disablePictureInPicture controlsList="nodownload noremoteplayback noplaybackrate" aria-label={`Live view: ${camera.name}`} />
        {state !== 'ended' && <Watermark name={pb?.watermark?.name ?? 'Staff'} />}
        {state === 'connecting' && <div className="cctv-overlay">Connecting…</div>}
        {state === 'unsupported' && <div className="cctv-overlay">This browser cannot play HLS directly. Ask the safety officer to switch this camera to WebRTC (WHEP), which every modern browser plays, or open it in Safari.</div>}
        {state === 'ended' && <div className="cctv-overlay">{error ?? 'The viewing has ended.'}</div>}
      </div>
      <DataNote>View-only. No recording, download or screenshot is offered. Your name and the time are on the picture and this viewing is in the view log.</DataNote>
      {askStill && (
        <Modal title="Still watching?" onClose={() => void stillWatching()} footer={<><Button variant="soft" onClick={() => { setAskStill(false); void stop(); onClose(); }}>Stop</Button><Button onClick={() => void stillWatching()}>Yes, keep watching</Button></>}>
          <p>The viewing stops in about a minute unless you confirm.</p>
        </Modal>
      )}
    </div>
  );
}

// ── live grid ───────────────────────────────────────────────────────────

function Live({ status }: { status: CctvStatus }) {
  const list = useLoad(() => cctvApi.cameras(), []);
  const wanted = useQueryParam('camera');
  const [open, setOpen] = useState<{ camera: CctvCamera; reason?: string } | null>(null);
  const [asking, setAsking] = useState<CctvCamera | null>(null);
  const [reason, setReason] = useState('');
  const choose = useCallback((c: CctvCamera) => { if (c.reasonRequired) { setReason(''); setAsking(c); } else setOpen({ camera: c }); }, []);
  useEffect(() => {
    const c = wanted ? list.data?.find((x) => x.id === wanted) : null;
    if (c && status.gateway.configured && !open && !asking) choose(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once from the link
  }, [wanted, list.data]);
  const zones = useMemo(() => {
    const m = new Map<string, CctvCamera[]>();
    for (const c of list.data ?? []) { const z = c.zone ?? 'Other'; if (!m.has(z)) m.set(z, []); m.get(z)!.push(c); }
    return [...m.entries()];
  }, [list.data]);
  if (open) return <Player key={open.camera.id} camera={open.camera} reason={open.reason} onClose={() => setOpen(null)} />;
  return (
    <div className="ops-stack">
      {!status.gateway.configured && <NoGateway steps={status.setupSteps} />}
      <Loadable state={list} empty={null}>{(cams) => !cams.length ? (
        <EmptyState icon="◎" title="No cameras for you" sub="No camera is registered in a camera group your role may watch." />
      ) : (
        <>
          {zones.map(([zone, items]) => (
            <SectionCard key={zone} title={zone}>
              <div className="cctv-grid">
                {items.map((c) => (
                  <button key={c.id} type="button" className="cctv-tile" disabled={!status.gateway.configured} onClick={() => choose(c)} aria-label={`Watch ${c.name}`}>
                    <span className="cctv-tile-icon" aria-hidden="true">◎</span>
                    <span className="cctv-tile-name">{c.name}</span>
                    <span className="cctv-tile-sub">{c.facilityName ?? c.roomLabel ?? humanize(c.locationKind)} · {humanize(c.privacyClass)}</span>
                    <StatusPill status={HEALTH_PILL[c.health]} label={HEALTH_LABEL[c.health] ?? c.health} />
                  </button>
                ))}
              </div>
            </SectionCard>
          ))}
        </>
      )}</Loadable>
      {asking && (
        <Modal title={`Open ${asking.name}`} onClose={() => setAsking(null)} footer={<><Button variant="soft" onClick={() => setAsking(null)}>Cancel</Button><Button disabled={reason.trim().length < 5} onClick={() => { setOpen({ camera: asking, reason: reason.trim() }); setAsking(null); }}>Open camera</Button></>}>
          <Field label="Why are you opening this camera?" hint="Recorded in the view log the principal sees." required>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: '100%' }} />
          </Field>
        </Modal>
      )}
    </div>
  );
}

// ── view log ────────────────────────────────────────────────────────────

function ViewLog() {
  const [date, setDate] = useState(isoDay());
  const log = useLoad(() => cctvApi.viewLog(date), [date]);
  return (
    <SectionCard title="View log" sub={log.data?.scope === 'OWN' ? 'Your own viewings' : 'Every live viewing: who, which camera, when and why'} actions={<input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Day" />}>
      <Loadable state={log}>{(l) => !l.items.length ? <p className="ops-muted">No viewings on this day.</p> : (
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead><tr><th>Viewer</th><th>Camera</th><th>Start</th><th>End</th><th>Minutes</th><th>Reason</th></tr></thead>
            <tbody>{l.items.map((i) => (
              <tr key={i.id}><td>{i.viewer ?? '—'} <span className="ops-muted">{humanize(i.role)}</span></td><td>{i.camera}</td><td>{fmtDateTime(i.startedAt)}</td><td>{i.open ? 'Watching now' : `${fmtDateTime(i.endedAt)} (${humanize(i.endReason)})`}</td><td>{i.minutes}</td><td>{i.reason ?? '—'}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}</Loadable>
    </SectionCard>
  );
}

// ── setup (camera.devices.manage) ───────────────────────────────────────

function GatewayForm({ settings, onSaved }: { settings: CctvSettings; onSaved: () => void }) {
  const g = settings.gateway;
  const [baseUrl, setBaseUrl] = useState(g.baseUrl ?? '');
  const [vendor, setVendor] = useState(g.vendor ?? 'MEDIAMTX');
  const [authMode, setAuthMode] = useState(g.authMode ?? 'BASIC');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [reasonRequired, setReasonRequired] = useState(settings.reasonRequired);
  const [idle, setIdle] = useState(String(settings.idleMinutes));
  const [maxMin, setMaxMin] = useState(String(settings.maxSessionMinutes));
  const [grants, setGrants] = useState(settings.groupGrants.map((x) => `${x.roleKey}: ${x.groups.join(', ')}`).join('\n'));
  const { run, busy, error } = useAction();
  const toast = useToast();
  const save = () => run(async () => {
    const groupGrants = grants.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [role, rest = ''] = l.split(':'); return { roleKey: role.trim(), groups: rest.split(',').map((x) => x.trim()).filter(Boolean) }; });
    await cctvApi.saveSettings({
      gateway: { baseUrl: baseUrl.trim() || null, vendor, authMode, ...(authMode === 'BASIC' && username ? { username, password } : {}), ...(authMode === 'BEARER' && token ? { token } : {}) },
      reasonRequired, idleMinutes: Number(idle), maxSessionMinutes: Number(maxMin), groupGrants,
    });
    setPassword(''); setToken('');
    toast('Saved', 'success'); onSaved();
  });
  const test = () => run(async () => { const r = await cctvApi.testGateway(); toast(r.ok ? `Connected. ${r.cameras ? `${r.cameras.online} online, ${r.cameras.offline} offline` : ''}` : r.message, r.ok ? 'success' : 'error'); onSaved(); });
  return (
    <SectionCard title="Gateway" sub="The school's NVR/VMS or video gateway, reachable over https. Credentials are stored encrypted and never shown again.">
      <ErrorNote error={error} />
      <div className="cctv-form">
        <Field label="Gateway address (https)" hint="e.g. https://cctv.yourschool.in/ (MediaMTX WebRTC/HLS behind a TLS proxy or tunnel)"><input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></Field>
        <Field label="Gateway type"><select className="input" value={vendor} onChange={(e) => setVendor(e.target.value)}>{['MEDIAMTX', 'GO2RTC', 'NVR_VMS', 'OTHER'].map((v) => <option key={v} value={v}>{humanize(v)}</option>)}</select></Field>
        <Field label="Sign-in"><select className="input" value={authMode} onChange={(e) => setAuthMode(e.target.value)}><option value="NONE">None</option><option value="BASIC">User and password</option><option value="BEARER">Token</option></select></Field>
        {authMode === 'BASIC' && <><Field label="Read user" hint={g.hasCredentials ? 'Saved (hidden). Enter again only to change.' : undefined}><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" /></Field>
          <Field label="Password"><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field></>}
        {authMode === 'BEARER' && <Field label="Token" hint={g.hasCredentials ? 'Saved (hidden). Enter again only to change.' : undefined}><input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" /></Field>}
        <label className="ops-inline"><input type="checkbox" checked={reasonRequired} onChange={(e) => setReasonRequired(e.target.checked)} /> Ask every viewer for a reason (restricted-area cameras always ask)</label>
        <Field label="Ask &quot;still watching?&quot; after (minutes)"><input className="input" type="number" min={2} max={30} value={idle} onChange={(e) => setIdle(e.target.value)} /></Field>
        <Field label="Longest single viewing (minutes)"><input className="input" type="number" min={5} max={240} value={maxMin} onChange={(e) => setMaxMin(e.target.value)} /></Field>
        <Field label="Camera groups per role" hint="One line per role, e.g. WARDEN: hostel. The role also needs camera.live.view (Access & Permissions). Never parents, students or alumni."><textarea className="input" rows={3} value={grants} onChange={(e) => setGrants(e.target.value)} /></Field>
      </div>
      <div className="ops-inline">
        <Button disabled={busy} onClick={() => void save()}>Save</Button>
        <Button variant="soft" disabled={busy || !g.configured} onClick={() => void test()}>Test connection</Button>
        {g.lastTestAt && <span className="ops-muted">Last test {fmtDateTime(g.lastTestAt)}: {g.lastTestOk ? 'connected' : g.lastTestMessage ?? 'failed'}</span>}
      </div>
    </SectionCard>
  );
}

function CameraForm({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const [f, setF] = useState({ name: '', zone: '', locationKind: 'GATE', purpose: 'ENTRY_EXIT', group: 'general', streamType: 'WHEP', streamPath: '', approvalNote: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const { run, busy, error } = useAction();
  return (
    <Modal title="Register a camera for live view" onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.name || !f.approvalNote} onClick={() => void run(async () => { await cctvApi.createCamera(f); onSaved(); onClose(); })}>Register</Button></>}>
      <ErrorNote error={error} />
      <Field label="Name" required><input className="input" value={f.name} onChange={set('name')} /></Field>
      <Field label="Zone (for the grid)"><input className="input" value={f.zone} onChange={set('zone')} /></Field>
      <Field label="Place"><select className="input" value={f.locationKind} onChange={set('locationKind')}>{LOCATIONS.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</select></Field>
      <Field label="Purpose"><select className="input" value={f.purpose} onChange={set('purpose')}>{PURPOSES.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</select></Field>
      <Field label="Camera group" hint="e.g. main-gate, hostel, bus-bay"><input className="input" value={f.group} onChange={set('group')} /></Field>
      <Field label="Stream type"><select className="input" value={f.streamType} onChange={set('streamType')}><option value="WHEP">WebRTC (WHEP), recommended</option><option value="HLS">HLS (.m3u8)</option></select></Field>
      <Field label="Path on the gateway" hint="e.g. gate-1/whep or gate-1/index.m3u8. Not an RTSP address."><input className="input" value={f.streamPath} onChange={set('streamPath')} /></Field>
      <Field label="Approval (who approved this camera for live viewing, and why)" required><input className="input" value={f.approvalNote} onChange={set('approvalNote')} /></Field>
      <DataNote>Toilets, washrooms, changing rooms, dormitory rooms, the health room and staff private areas are refused. Put up CCTV signage before switching a camera on.</DataNote>
    </Modal>
  );
}

function Setup({ onChanged }: { onChanged: () => void }) {
  const settings = useLoad(() => cctvApi.settings(), []);
  const cams = useLoad(() => cctvApi.managed(), []);
  const [adding, setAdding] = useState(false);
  const { run, busy, error } = useAction();
  const reload = () => { void settings.reload(); void cams.reload(); onChanged(); };
  return (
    <div className="ops-stack">
      <Loadable state={settings}>{(s) => <GatewayForm settings={s} onSaved={reload} />}</Loadable>
      <SectionCard title="Cameras" actions={<div className="ops-inline"><Button small variant="soft" disabled={busy} onClick={() => void run(async () => { await cctvApi.checkCameras(); reload(); })}>Check status</Button><Button small onClick={() => setAdding(true)}>Register camera</Button></div>}>
        <ErrorNote error={error} />
        <Loadable state={cams}>{(rows: CctvManagedCamera[]) => !rows.length ? <p className="ops-muted">No cameras registered yet.</p> : (
          <ul className="ops-list">{rows.map((c) => (
            <li key={c.id} className="ops-row">
              <div className="ops-row-main"><div className="ops-row-title">{c.name} <span className="ops-muted">{c.zone ?? ''}</span></div>
                <div className="ops-row-sub">{humanize(c.locationKind)} · {humanize(c.purpose)} · group {c.group} · {c.streamType} · {c.streamPath ?? 'no path yet'}{c.hasCredentials ? ' · own credentials (hidden)' : ''} · {HEALTH_LABEL[c.health]}{c.lastCheckMessage ? ` (${c.lastCheckMessage})` : ''}</div></div>
              <Button small variant="soft" disabled={busy} onClick={() => void run(async () => { await cctvApi.updateCamera(c.id, { enabled: !c.enabled }); reload(); })}>{c.enabled ? 'Switch off' : 'Switch on'}</Button>
            </li>
          ))}</ul>
        )}</Loadable>
      </SectionCard>
      {adding && <CameraForm onSaved={reload} onClose={() => setAdding(false)} />}
    </div>
  );
}

export function CctvView() {
  const status = useLoad(() => cctvApi.status(), []);
  const [tab, setTab] = useState<'live' | 'log' | 'setup'>('live');
  return (
    <Loadable state={status}>{(s) => {
      if (!s.enabled) return <div className="ops-stack"><EmptyState icon="⏻" title="Live CCTV is switched off" sub="An optional integration. A school switches it on (Settings → Features) after connecting its NVR/gateway, registering cameras at allowed places and putting up signage." />{s.canManage && <NoGateway steps={s.setupSteps} />}</div>;
      const tabs = [
        ...(s.canView ? [{ key: 'live' as const, label: 'Live' }, { key: 'log' as const, label: 'View log' }] : []),
        ...(s.canManage ? [{ key: 'setup' as const, label: 'Setup' }] : []),
      ];
      const current = tabs.some((t) => t.key === tab) ? tab : tabs[0]?.key;
      return (
        <div className="ops-stack">
          <div className="ops-callout">{s.limits}</div>
          {tabs.length > 1 && <Tabs tabs={tabs} value={current ?? 'live'} onChange={setTab} />}
          {current === 'live' && <Live status={s} />}
          {current === 'log' && <ViewLog />}
          {current === 'setup' && <Setup onChanged={() => void status.reload()} />}
        </div>
      );
    }}</Loadable>
  );
}
