'use client';
import { useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { safetyApi, type ObservationDto } from '@/lib/safety-api';
import { usePermissions } from '@/lib/permissions';
import { Drawer } from './drawer';
import { DataNote, ErrorNote, KeyValues, Loadable, SectionCard, StatusPill, Tabs, Tile, fmtDateTime, humanize, useAction, useLoad, useQueryParam } from './kit';

/**
 * Camera event review (optional pilot, restricted to trained reviewers).
 * Observations are UNVERIFIED until a person decides. No images are shown or
 * stored here, nobody is identified, and nothing from this page reaches
 * feeds, the campus map, analytics or parents.
 */
const TYPE_LABEL: Record<string, string> = { POSSIBLE_UNATTENDED_ROOM: 'Possibly unattended room', POSSIBLE_AGGRESSION: 'Possible aggression', DEVICE_OFFLINE: 'Camera offline' };
const DECISIONS = [{ key: 'CONFIRMED', label: 'Confirmed' }, { key: 'FALSE_ALERT', label: 'False alert' }, { key: 'NEEDS_FOLLOW_UP', label: 'Needs follow-up' }];

function ReviewDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { permissions } = usePermissions();
  const state = useLoad(() => safetyApi.observation(id), [id]);
  const [decision, setDecision] = useState('');
  const [notes, setNotes] = useState('');
  const [correction, setCorrection] = useState('');
  const [linking, setLinking] = useState(false);
  const [category, setCategory] = useState('BULLYING');
  const [caseId, setCaseId] = useState('');
  const { run, busy, error } = useAction();
  const toast = useToast();
  const reload = async () => { await state.reload(); onChanged(); };
  const o = state.data;
  const corrected = Boolean(o?.reviews?.length);
  return (
    <Drawer title={o ? TYPE_LABEL[o.type] ?? humanize(o.type) : 'Observation'} sub={o ? `${o.deviceLabel ?? ''} · ${o.room ?? 'room not recorded'} · ${fmtDateTime(o.observedAt)}` : undefined} onClose={onClose}
      footer={o && o.type !== 'DEVICE_OFFLINE' && <>
        {o.type === 'POSSIBLE_AGGRESSION' && ['CONFIRMED', 'NEEDS_FOLLOW_UP'].includes(o.status) && !o.safeguardingRef && <Button variant="soft" onClick={() => setLinking(true)}>Refer to safeguarding</Button>}
      </>}>
      <ErrorNote error={error} />
      <Loadable state={state}>{(d: ObservationDto) => (
        <>
          <div className="ops-inline"><StatusPill status={d.status === 'UNVERIFIED' ? 'PENDING' : d.status === 'FALSE_ALERT' ? 'CLOSED' : d.status === 'CONFIRMED' ? 'CONFIRMED' : 'IN_REVIEW'} label={humanize(d.status)} />{d.safeguardingRef && <span className="ops-muted">Referred: {d.safeguardingRef}</span>}</div>
          <KeyValues rows={[
            ['Confidence (provider)', d.confidence === null ? '—' : `${Math.round(d.confidence * 100)}%`],
            ['Evidence', d.evidenceAvailable ? `Held in restricted storage (${d.evidenceRef})` : 'Not available or past retention'],
            ['Received', fmtDateTime(d.receivedAt)],
          ]} />
          {d.context && <div className="ops-callout"><b>School records:</b> {d.context.summary}</div>}
          {d.type === 'POSSIBLE_UNATTENDED_ROOM' && <DataNote>The timetable, the teacher&apos;s check-in, cover and leave are the record. A camera cannot tell whether good teaching happened.</DataNote>}
          {!!d.reviews?.length && (
            <SectionCard title="Reviews">
              <ul className="ops-list">{d.reviews.map((r, i) => <li key={i} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{humanize(r.decision)} · {r.byName}</div><div className="ops-row-sub">{fmtDateTime(r.at)} · {r.notes}{r.correctionOf ? ` · correction of ${r.correctionOf}` : ''}</div></div></li>)}</ul>
            </SectionCard>
          )}
          {d.type !== 'DEVICE_OFFLINE' && (
            <SectionCard title={corrected ? 'Correct the decision' : 'Your decision'}>
              <div className="ops-inline" role="radiogroup" aria-label="Decision">{DECISIONS.map((x) => <label key={x.key}><input type="radio" name="decision" checked={decision === x.key} onChange={() => setDecision(x.key)} /> {x.label}</label>)}</div>
              <Field label="Notes (what you saw, what you did)" required><textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: '100%' }} /></Field>
              {corrected && <Field label="Why the earlier decision is changing" required><input className="input" value={correction} onChange={(e) => setCorrection(e.target.value)} style={{ width: '100%' }} /></Field>}
              <Button disabled={busy || !decision || !notes.trim() || (corrected && !correction.trim())} onClick={() => void run(async () => { await safetyApi.reviewObservation(id, { decision, notes, correctionReason: corrected ? correction : undefined }); toast('Decision recorded', 'success'); setDecision(''); setNotes(''); setCorrection(''); await reload(); })}>Record decision</Button>
            </SectionCard>
          )}
        </>
      )}</Loadable>
      {linking && (
        <Modal title="Refer to safeguarding" onClose={() => setLinking(false)} footer={<><Button variant="soft" onClick={() => setLinking(false)}>Cancel</Button><Button disabled={busy} onClick={() => void run(async () => { await safetyApi.linkCase(id, caseId ? { caseId } : { category, urgency: 'URGENT' }); setLinking(false); toast('Referred to the safeguarding officer', 'success'); await reload(); })}>Refer</Button></>}>
          <Field label="New referral category"><select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>{['BULLYING', 'RAGGING', 'CHILD_PROTECTION', 'OTHER'].map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></Field>
          {permissions['safeguarding.manage'] && <Field label="Or add to an existing case (case id)" hint="Officers only"><input className="input" value={caseId} onChange={(e) => setCaseId(e.target.value.trim())} /></Field>}
          <DataNote>The referral carries the observation reference and your notes. It names no child; the designated officer establishes what happened. It is not a finding against anyone.</DataNote>
        </Modal>
      )}
    </Drawer>
  );
}

function Queue() {
  const [status, setStatus] = useState('');
  const list = useLoad(() => safetyApi.observations(status ? { status } : {}), [status]);
  const [selected, setSelected] = useState<string | null>(useQueryParam('id'));
  return (
    <div className="ops-stack">
      <Tabs tabs={[{ key: '', label: 'To review' }, { key: 'CONFIRMED', label: 'Confirmed' }, { key: 'FALSE_ALERT', label: 'False alerts' }, { key: 'ALL', label: 'All' }]} value={status} onChange={setStatus} />
      <Loadable state={list}>{(d) => !d.items.length ? <EmptyState title="Nothing to review" sub="Observations from approved cameras appear here, unverified until a reviewer decides." /> : (
        <SectionCard title={`${d.items.length} observation(s)`}>
          <ul className="ops-list">{d.items.map((o) => (
            <li key={o.id} className="ops-row"><div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setSelected(o.id)}>
              <div className="ops-row-title">{TYPE_LABEL[o.type] ?? humanize(o.type)} · {o.room ?? o.deviceLabel}</div>
              <div className="ops-row-sub">{fmtDateTime(o.observedAt)}{o.confidence !== null ? ` · provider confidence ${Math.round(o.confidence * 100)}%` : ''}</div>
            </button></div><StatusPill status={o.status === 'UNVERIFIED' ? 'PENDING' : o.status === 'FALSE_ALERT' ? 'CLOSED' : 'CONFIRMED'} label={humanize(o.status)} /></li>
          ))}</ul>
        </SectionCard>
      )}</Loadable>
      {selected && <ReviewDrawer id={selected} onClose={() => setSelected(null)} onChanged={() => void list.reload()} />}
    </div>
  );
}

function Devices() {
  const { permissions } = usePermissions();
  const canManage = Boolean(permissions['camera.devices.manage']);
  const list = useLoad(() => safetyApi.cameraDevices(), []);
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [f, setF] = useState({ label: '', purpose: 'UNATTENDED_CLASSROOM_CHECK', locationKind: 'CLASSROOM', roomLabel: '', retentionDays: '7', approvalNote: '' });
  const { run, busy, error } = useAction();
  const locations = f.purpose === 'UNATTENDED_CLASSROOM_CHECK' ? ['CLASSROOM', 'LAB', 'LECTURE_HALL', 'LIBRARY'] : ['CORRIDOR', 'STAIRCASE', 'ENTRANCE', 'GROUND', 'CANTEEN'];
  return (
    <div className="ops-stack">
      {canManage && <div className="ops-inline"><Button onClick={() => setAdding(true)}>+ Register camera</Button></div>}
      <Loadable state={list}>{(rows) => !rows.length ? <EmptyState title="No cameras registered" sub="Register a camera only after the school has approved its purpose, location, retention and reviewers." /> : (
        <SectionCard title={`${rows.length} camera(s)`}>
          <ul className="ops-list">{rows.map((d) => (
            <li key={d.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{d.label} · {d.camera?.roomLabel ?? humanize(d.camera?.locationKind)}</div><div className="ops-row-sub">{humanize(d.camera?.purpose)} · keeps evidence {d.camera?.retentionDays} days · last heard {fmtDateTime(d.camera?.lastHeartbeatAt ?? d.lastSeenAt)} · {d.camera?.approvalNote}</div></div>
              <StatusPill status={d.status !== 'ACTIVE' ? 'CANCELLED' : d.camera?.health === 'ONLINE' ? 'ACTIVE' : d.camera?.health === 'OFFLINE' ? 'EXPIRED' : 'DRAFT'} label={d.status !== 'ACTIVE' ? 'Disabled' : humanize(d.camera?.health)} />
              {canManage && <Button small variant="ghost" onClick={() => void run(async () => { await safetyApi.deviceStatus(d.id, d.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'); await list.reload(); })}>{d.status === 'ACTIVE' ? 'Disable' : 'Enable'}</Button>}
            </li>
          ))}</ul>
        </SectionCard>
      )}</Loadable>
      <ErrorNote error={error} />
      {adding && (
        <Modal title="Register a camera" onClose={() => setAdding(false)} footer={<><Button variant="soft" onClick={() => setAdding(false)}>Cancel</Button><Button disabled={busy || !f.label || !f.approvalNote} onClick={() => void run(async () => { const d = await safetyApi.createDevice({ kind: 'CAMERA', label: f.label, provider: 'generic-http', camera: { ...f, retentionDays: Number(f.retentionDays) } }); setAdding(false); setSecret(`${d.deviceKey}\n${d.secret}`); await list.reload(); })}>Register</Button></>}>
          <div className="ops-form-grid">
            <Field label="Label" required><input className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
            <Field label="Approved purpose"><select className="input" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value, locationKind: e.target.value === 'UNATTENDED_CLASSROOM_CHECK' ? 'CLASSROOM' : 'CORRIDOR' })}><option value="UNATTENDED_CLASSROOM_CHECK">Unattended classroom check</option><option value="CORRIDOR_SAFETY">Corridor safety</option></select></Field>
            <Field label="Kind of place"><select className="input" value={f.locationKind} onChange={(e) => setF({ ...f, locationKind: e.target.value })}>{locations.map((l) => <option key={l} value={l}>{humanize(l)}</option>)}</select></Field>
            <Field label="Room / place name"><input className="input" value={f.roomLabel} onChange={(e) => setF({ ...f, roomLabel: e.target.value })} /></Field>
            <Field label="Keep evidence for (days, 1–30)"><input className="input" inputMode="numeric" value={f.retentionDays} onChange={(e) => setF({ ...f, retentionDays: e.target.value })} /></Field>
            <Field label="Who approved it, and why" required><input className="input" value={f.approvalNote} onChange={(e) => setF({ ...f, approvalNote: e.target.value })} /></Field>
          </div>
          <DataNote>Never in toilets, washrooms, changing rooms, dormitories or medical rooms — the system refuses these.</DataNote>
        </Modal>
      )}
      {secret && <Modal title="Device credentials — copy now" onClose={() => setSecret(null)} footer={<Button onClick={() => setSecret(null)}>Done</Button>}><pre className="fleet-secret">{secret}</pre><DataNote>The secret is shown once. Enter the key and secret in the camera provider&apos;s adapter.</DataNote></Modal>}
    </div>
  );
}

function Metrics() {
  const state = useLoad(() => safetyApi.cameraMetrics(), []);
  return (
    <Loadable state={state}>{(m) => (
      <div className="ops-stack">
        {m.types.filter((t) => t.type !== 'DEVICE_OFFLINE').map((t) => (
          <SectionCard key={t.type} title={TYPE_LABEL[t.type]}>
            <div className="kpi-grid">
              <Tile label="Observations" value={t.total} />
              <Tile label="Waiting for review" value={t.unverified} tone={t.unverified ? 'warn' : 'good'} />
              <Tile label="Confirmed" value={t.confirmed} />
              <Tile label="False alerts" value={t.falseAlert} />
              <Tile label="False-alert rate" value={t.falseAlertRate === null ? 'No reviews yet' : `${t.falseAlertRate}%`} tone={t.falseAlertRate !== null && t.falseAlertRate > 50 ? 'bad' : 'neutral'} />
              <Tile label="Median time to review" value={t.medianMinutesToReview === null ? '—' : `${t.medianMinutesToReview} min`} />
            </div>
          </SectionCard>
        ))}
        <DataNote>{m.note}</DataNote>
      </div>
    )}</Loadable>
  );
}

export function CameraView() {
  const status = useLoad(() => safetyApi.cameraStatus(), []);
  const [tab, setTab] = useState<'queue' | 'devices' | 'metrics'>('queue');
  return (
    <Loadable state={status}>{(s) => !s.enabled ? (
      <EmptyState icon="⏻" title="Camera review is switched off" sub="It is an optional pilot. A school switches it on only after defining purpose, approved locations, retention, trained reviewers and a response process." />
    ) : (
      <div className="ops-stack">
        <div className="ops-callout">{s.limits}</div>
        <Tabs tabs={[{ key: 'queue', label: 'Review queue' }, { key: 'devices', label: 'Cameras' }, { key: 'metrics', label: 'Pilot measures' }]} value={tab} onChange={setTab} />
        {tab === 'queue' && <Queue />}
        {tab === 'devices' && <Devices />}
        {tab === 'metrics' && <Metrics />}
      </div>
    )}</Loadable>
  );
}

/** A teacher marks themselves present in class for a period. */
export function CheckInView() {
  const list = useLoad(() => safetyApi.myCheckIns(), []);
  const [periodNo, setPeriodNo] = useState('1');
  const [covering, setCovering] = useState('');
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <div className="ops-stack">
      <SectionCard title="I am in class" sub="Check in at the start of each period you teach or cover today.">
        <div className="ops-inline">
          <Field label="Period"><select className="input" value={periodNo} onChange={(e) => setPeriodNo(e.target.value)}>{Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></Field>
          <Field label="Covering for (staff id, optional)"><input className="input" value={covering} onChange={(e) => setCovering(e.target.value.trim())} /></Field>
          <Button disabled={busy} onClick={() => void run(async () => { await safetyApi.checkIn({ periodNo: Number(periodNo), coveringForProfileId: covering || undefined }); toast('Checked in', 'success'); await list.reload(); })}>Check in</Button>
        </div>
        <ErrorNote error={error} />
      </SectionCard>
      <Loadable state={list}>{(rows) => (
        <SectionCard title="Today">{!rows.length ? <p className="ops-muted">No check-ins yet today.</p> : <ul className="ops-list">{rows.map((r) => <li key={r.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">Period {r.periodNo}{r.room ? ` · ${r.room}` : ''}</div><div className="ops-row-sub">{fmtDateTime(r.checkedInAt)}{r.coveringForProfileId ? ' · cover' : ''}</div></div></li>)}</ul>}</SectionCard>
      )}</Loadable>
      <DataNote>Your check-in is the school&apos;s record that the class was attended. It is never used to judge teaching.</DataNote>
    </div>
  );
}
