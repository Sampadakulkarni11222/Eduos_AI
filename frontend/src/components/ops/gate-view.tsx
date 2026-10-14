'use client';
import { useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { safetyApi, type CardDto, type VisitorDto } from '@/lib/safety-api';
import { downloadCsv } from '@/lib/ops-api';
import { api, errorMessage } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';
import { DataNote, ErrorNote, KeyValues, Loadable, PromptModal, SectionCard, StatusPill, Tabs, fmtDateTime, humanize, isoDay, useAction, useLoad, useQueryParam } from './kit';

/**
 * The gate: visitors and contractors, child pickup and release, ID card
 * checkpoints and the emergency roster. Parents use PickupView for their own
 * children's delegates and the day's gate/bus checkpoints.
 */
const CHECKPOINT_NOTE = 'A checkpoint shows that a card was presented at that place and time. It is not proof of where anyone was before or after.';

function Off({ what }: { what: string }) {
  return <EmptyState icon="⏻" title={`${what} is switched off`} sub="An administrator can switch it on in Settings → Features once the school has the readers or process in place." />;
}
const isOff = (e: string | null) => Boolean(e && /switched off/i.test(e));

/** Finds a student by name or admission number. */
function StudentPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState('');
  const found = useLoad(() => (q.trim().length >= 2 ? api.students({ search: q.trim() }).then((r) => r.items.slice(0, 20)) : Promise.resolve([])), [q]);
  return (
    <div className="ops-inline">
      <Field label="Find student"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or admission no." /></Field>
      <Field label="Student"><select className="input" value={value} onChange={(e) => onChange(e.target.value)}><option value="">{q.trim().length < 2 ? 'Type two letters to search' : 'Choose…'}</option>{(found.data ?? []).map((st) => <option key={st.id} value={st.id}>{st.name} · {st.admissionNo}{st.enrollment ? ` · ${st.enrollment.class}` : ''}</option>)}</select></Field>
    </div>
  );
}

// ── Visitors ─────────────────────────────────────────────────────────────

function VisitorsTab({ canManage }: { canManage: boolean }) {
  const [view, setView] = useState<'today' | 'onsite' | 'ALL'>('today');
  const list = useLoad(() => (canManage ? safetyApi.visitors(view === 'ALL' ? { status: 'ALL' } : { view }) : safetyApi.hosting()), [view, canManage]);
  const [adding, setAdding] = useState(false);
  const [checkingIn, setCheckingIn] = useState<VisitorDto | null>(null);
  const [f, setF] = useState({ name: '', phone: '', organisation: '', purpose: '', location: '', kind: 'VISITOR', expectedHours: '2', contractorCheckNote: '' });
  const [ci, setCi] = useState({ idType: 'Aadhaar / driving licence', idLast4: '', badgeNumber: '' });
  const { run, busy, error } = useAction();
  if (isOff(list.error)) return <Off what="Visitors" />;
  return (
    <div className="ops-stack">
      <div className="ops-inline">
        {canManage && <Tabs tabs={[{ key: 'today', label: 'Today' }, { key: 'onsite', label: 'On site now' }, { key: 'ALL', label: 'All' }]} value={view} onChange={setView} />}
        <Button onClick={() => setAdding(true)}>+ Pre-register a visitor</Button>
      </div>
      <ErrorNote error={error} />
      <Loadable state={list}>{(rows) => !rows.length ? <EmptyState title="No visitors" sub="Pre-register a visitor or contractor; the host approves before check-in." /> : (
        <SectionCard title={`${rows.length} visit(s)`}>
          <ul className="ops-list">{rows.map((v) => (
            <li key={v.id} className="ops-row">
              <div className="ops-row-main"><div className="ops-row-title">{v.name}{v.organisation ? ` · ${v.organisation}` : ''} <span className="ops-muted">({humanize(v.kind)})</span></div>
                <div className="ops-row-sub">{v.purpose}{v.location ? ` · ${v.location}` : ''} · host {v.hostName ?? '—'}{v.badge?.expiresAt ? ` · badge till ${fmtDateTime(v.badge.expiresAt)}` : ''}{v.idVerified ? ` · ID seen (${v.idType ?? ''} …${v.idLast4 ?? ''})` : ''}</div></div>
              <StatusPill status={v.overstaying ? 'OVERDUE' : v.status === 'CHECKED_IN' ? 'LIVE' : v.status === 'PENDING_HOST' ? 'PENDING' : v.status} label={v.overstaying ? 'Overstaying' : humanize(v.status)} />
              <span className="ops-inline">
                {v.status === 'PENDING_HOST' && <><Button small onClick={() => void run(async () => { await safetyApi.visitorAction(v.id, 'host-decision', { decision: 'APPROVED', note: canManage ? 'Host approved by phone' : undefined }); await list.reload(); })}>Approve</Button><Button small variant="ghost" onClick={() => void run(async () => { await safetyApi.visitorAction(v.id, 'host-decision', { decision: 'REJECTED', note: canManage ? 'Host declined by phone' : undefined }); await list.reload(); })}>Decline</Button></>}
                {canManage && v.status === 'APPROVED' && <Button small onClick={() => setCheckingIn(v)}>Check in</Button>}
                {canManage && v.status === 'CHECKED_IN' && <Button small variant="soft" onClick={() => void run(async () => { await safetyApi.visitorAction(v.id, 'check-out'); await list.reload(); })}>Check out</Button>}
              </span>
            </li>
          ))}</ul>
        </SectionCard>
      )}</Loadable>
      {adding && (
        <Modal title="Pre-register a visitor" onClose={() => setAdding(false)} footer={<><Button variant="soft" onClick={() => setAdding(false)}>Cancel</Button><Button disabled={busy || !f.name || !f.purpose} onClick={() => void run(async () => { await safetyApi.createVisitor({ ...f, expectedHours: Number(f.expectedHours) || undefined }); setAdding(false); await list.reload(); })}>Save</Button></>}>
          <div className="ops-form-grid">
            <Field label="Kind"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['VISITOR', 'CONTRACTOR', 'VENDOR', 'PARENT_VISIT', 'OFFICIAL'].map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></Field>
            <Field label="Name" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field label="Organisation"><input className="input" value={f.organisation} onChange={(e) => setF({ ...f, organisation: e.target.value })} /></Field>
            <Field label="Purpose" required><input className="input" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></Field>
            <Field label="Where on campus"><input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
            <Field label="Expected stay (hours)"><input className="input" inputMode="decimal" value={f.expectedHours} onChange={(e) => setF({ ...f, expectedHours: e.target.value })} /></Field>
            {f.kind === 'CONTRACTOR' && <Field label="Work order / check done" required><input className="input" value={f.contractorCheckNote} onChange={(e) => setF({ ...f, contractorCheckNote: e.target.value })} /></Field>}
          </div>
          <DataNote>You are the host. If you register a visitor for someone else, they approve it before check-in.</DataNote>
        </Modal>
      )}
      {checkingIn && (
        <Modal title={`Check in ${checkingIn.name}`} onClose={() => setCheckingIn(null)} footer={<><Button variant="soft" onClick={() => setCheckingIn(null)}>Cancel</Button><Button disabled={busy} onClick={() => void run(async () => { await safetyApi.visitorAction(checkingIn.id, 'check-in', { idVerified: true, ...ci }); setCheckingIn(null); await list.reload(); })}>I have seen their photo ID — check in</Button></>}>
          <div className="ops-form-grid">
            <Field label="ID type"><input className="input" value={ci.idType} onChange={(e) => setCi({ ...ci, idType: e.target.value })} /></Field>
            <Field label="Last 4 characters of the ID" hint="Never the full number"><input className="input" value={ci.idLast4} onChange={(e) => setCi({ ...ci, idLast4: e.target.value })} /></Field>
            <Field label="Badge no."><input className="input" value={ci.badgeNumber} onChange={(e) => setCi({ ...ci, badgeNumber: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Pickup and release ───────────────────────────────────────────────────

function PickupTab() {
  const [studentId, setStudentId] = useState(useQueryParam('student') ?? '');
  const [lookup, setLookup] = useState(studentId);
  const adults = useLoad(() => (lookup ? safetyApi.adultsFor(lookup) : Promise.resolve(null)), [lookup]);
  const releases = useLoad(() => safetyApi.releases({ date: isoDay() }), []);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ kind: 'AUTHORISED', name: '', relationship: '', phone: '', validTo: '', restrictionNote: '', guardianProfileId: '' });
  const [verification, setVerification] = useState('ID_CHECKED');
  const { run, busy, error } = useAction();
  const toast = useToast();
  if (isOff(releases.error)) return <Off what="Visitors and pickup" />;
  return (
    <div className="ops-stack">
      <div className="ops-inline">
        <StudentPicker value={studentId} onChange={(id) => { setStudentId(id); setLookup(id); }} />
      </div>
      <ErrorNote error={error} />
      {lookup && <Loadable state={adults}>{(a) => !a ? null : (
        <SectionCard title={`${a.student.name} (${a.student.admissionNo})`} actions={<Button small onClick={() => setAdding(true)}>+ Add adult or restriction</Button>}>
          <ul className="ops-list">
            {a.guardians.map((g) => (
              <li key={g.guardianProfileId} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{g.name}</div><div className="ops-row-sub">Guardian · {humanize(g.relation)}</div></div>
                {g.restricted ? <StatusPill status="BLOCKED" label="Custody restriction" /> : g.pickupAuthorized ? <Button small disabled={busy} onClick={() => void run(async () => { await safetyApi.release({ studentId: a.student.id, receiver: { guardianProfileId: g.guardianProfileId }, verification }); toast('Release recorded', 'success'); await releases.reload(); })}>Release to {g.name.split(' ')[0]}</Button> : <StatusPill status="REJECTED" label="Not authorised" />}</li>
            ))}
            {a.adults.map((x) => (
              <li key={x.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{x.name}{x.relationship ? ` (${x.relationship})` : ''}</div><div className="ops-row-sub">{humanize(x.kind)} · {humanize(x.status)}{x.validTo ? ` · until ${fmtDateTime(x.validTo)}` : ''}{x.restrictionNote ? ` · ${x.restrictionNote}` : ''}</div></div>
                {x.kind === 'RESTRICTED' ? <StatusPill status="BLOCKED" label="Do not release" /> : x.validNow ? <Button small disabled={busy} onClick={() => void run(async () => { await safetyApi.release({ studentId: a.student.id, receiver: { pickupAdultId: x.id }, verification }); toast('Release recorded', 'success'); await releases.reload(); })}>Release</Button> : <StatusPill status="EXPIRED" label="Not valid now" />}
                <Button small variant="ghost" onClick={() => void run(async () => { await safetyApi.revokeAdult(x.id, 'Revoked at the office'); await adults.reload(); })}>Revoke</Button></li>
            ))}
          </ul>
          <Field label="How the adult was checked"><select className="input" value={verification} onChange={(e) => setVerification(e.target.value)}><option value="ID_CHECKED">Photo ID checked</option><option value="KNOWN_TO_STAFF">Known to staff</option><option value="PHOTO_MATCHED">Matched the photo on record</option><option value="OTP">One-time code</option></select></Field>
          <DataNote>If nobody on this list is here, the child stays with the school. Call the guardian; never release to a name given at the gate.</DataNote>
        </SectionCard>
      )}</Loadable>}
      <Loadable state={releases}>{(rows) => (
        <SectionCard title={`Released today (${rows.length})`}>
          {!rows.length ? <p className="ops-muted">No releases recorded today.</p> : <ul className="ops-list">{rows.map((r) => <li key={r.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{r.studentName} → {r.receivedByName}</div><div className="ops-row-sub">{humanize(r.context)} · {humanize(r.receivedByKind)} · {humanize(r.verification)} · {fmtDateTime(r.at)}{r.recordedByName ? ` · by ${r.recordedByName}` : ''}</div></div></li>)}</ul>}
        </SectionCard>
      )}</Loadable>
      {adding && lookup && (
        <Modal title="Add an adult" onClose={() => setAdding(false)} footer={<><Button variant="soft" onClick={() => setAdding(false)}>Cancel</Button><Button disabled={busy || !f.name} onClick={() => void run(async () => { await safetyApi.addAdult({ studentId: lookup, ...f, validTo: f.validTo || null, guardianProfileId: f.guardianProfileId || null }); setAdding(false); await adults.reload(); })}>Save</Button></>}>
          <div className="ops-form-grid">
            <Field label="Kind"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="AUTHORISED">Authorised (standing)</option><option value="DELEGATE">Delegate (time-limited)</option><option value="RESTRICTED">Custody restriction — must NOT collect</option></select></Field>
            <Field label="Name" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Relationship"><input className="input" value={f.relationship} onChange={(e) => setF({ ...f, relationship: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            {f.kind === 'DELEGATE' && <Field label="Valid until" required><input type="datetime-local" className="input" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} /></Field>}
            {f.kind === 'RESTRICTED' && <Field label="Order or instruction it rests on" required><input className="input" value={f.restrictionNote} onChange={(e) => setF({ ...f, restrictionNote: e.target.value })} /></Field>}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Checkpoints and cards ────────────────────────────────────────────────

function CheckpointsTab({ canManage }: { canManage: boolean }) {
  const [flagged, setFlagged] = useState(false);
  const list = useLoad(() => safetyApi.events({ date: isoDay(), flagged: flagged ? 'true' : undefined }), [flagged]);
  const [code, setCode] = useState('');
  const [point, setPoint] = useState('GATE_IN');
  const [result, setResult] = useState<string | null>(null);
  const { run, busy, error } = useAction();
  if (isOff(list.error)) return <Off what="ID card checkpoints" />;
  return (
    <div className="ops-stack">
      {canManage && (
        <SectionCard title="Scan a card" sub="For staff scanning with a phone or typing a card code. Readers send scans on their own.">
          <div className="ops-inline">
            <Field label="Card code"><input className="input" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
            <Field label="Checkpoint"><select className="input" value={point} onChange={(e) => setPoint(e.target.value)}>{['GATE_IN', 'GATE_OUT', 'LAB', 'LIBRARY'].map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</select></Field>
            <Button disabled={busy || !code} onClick={() => void run(async () => { const r = await safetyApi.scan({ code, point }); setResult(`${r.holderName ? `${r.holderName}: ` : ''}${r.message}`); setCode(''); await list.reload(); })}>Record</Button>
          </div>
          {result && <p className="ops-muted" role="status">{result}</p>}
        </SectionCard>
      )}
      <ErrorNote error={error} />
      <div className="ops-inline"><label><input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} /> Only refused or flagged scans</label></div>
      <Loadable state={list}>{(d) => !d.events.length ? <EmptyState title="No checkpoint events today" sub="Gate, bus, lab and library scans appear here." /> : (
        <SectionCard title={`${d.events.length} event(s) today`}>
          <ul className="ops-list">{d.events.map((e) => (
            <li key={e.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{e.holderName ?? 'Unknown card'} · {e.pointLabel}</div><div className="ops-row-sub">{fmtDateTime(e.scannedAt)} · {e.locationLabel ?? ''} · {humanize(e.source)}{e.flags.length ? ` · ${e.flags.map(humanize).join(', ')}` : ''}</div></div>
              <StatusPill status={e.result === 'ACCEPTED' ? (e.flags.length ? 'PENDING' : 'ACTIVE') : 'REJECTED'} label={e.result === 'ACCEPTED' ? (e.flags.length ? 'Flagged' : 'Recorded') : humanize(e.result.replace('REJECTED_', 'REFUSED_'))} /></li>
          ))}</ul>
        </SectionCard>
      )}</Loadable>
      <DataNote>{CHECKPOINT_NOTE} Gate scans can suggest attendance to class teachers; they never change the register.</DataNote>
    </div>
  );
}

function CardsTab({ canManage }: { canManage: boolean }) {
  const [q, setQ] = useState('');
  const list = useLoad(() => safetyApi.cards({ q: q || undefined }), [q]);
  const [issuing, setIssuing] = useState(false);
  const [studentId, setStudentId] = useState('');
  const [prompt, setPrompt] = useState<null | { card: CardDto; action: 'LOST' | 'REVOKED' | 'REPLACE' }>(null);
  const { run, busy, error } = useAction();
  if (isOff(list.error)) return <Off what="ID card checkpoints" />;
  return (
    <div className="ops-stack">
      <div className="ops-inline"><Field label="Search"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or card code" /></Field>{canManage && <Button onClick={() => setIssuing(true)}>+ Issue card</Button>}</div>
      <ErrorNote error={error} />
      <Loadable state={list}>{(rows) => !rows.length ? <EmptyState title="No cards" sub="Issue a QR or RFID card to each student and staff member who uses a checkpoint." /> : (
        <SectionCard title={`${rows.length} card(s)`}>
          <ul className="ops-list">{rows.map((c) => (
            <li key={c.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{c.holderName} <span className="ops-muted">· {c.code} ({c.codeType})</span></div><div className="ops-row-sub">{humanize(c.holderType)} · issued {fmtDateTime(c.issuedAt)}{c.statusReason ? ` · ${c.statusReason}` : ''}{c.replacesCardId ? ' · replacement card' : ''}</div></div>
              <StatusPill status={c.status === 'ACTIVE' ? 'ACTIVE' : c.status === 'REPLACED' ? 'CLOSED' : 'BLOCKED'} label={humanize(c.status)} />
              {canManage && c.status === 'ACTIVE' && <><Button small variant="soft" onClick={() => setPrompt({ card: c, action: 'LOST' })}>Lost</Button><Button small variant="ghost" onClick={() => setPrompt({ card: c, action: 'REVOKED' })}>Revoke</Button></>}
              {canManage && ['ACTIVE', 'LOST', 'REVOKED'].includes(c.status) && <Button small variant="ghost" onClick={() => setPrompt({ card: c, action: 'REPLACE' })}>Replace</Button>}
            </li>
          ))}</ul>
        </SectionCard>
      )}</Loadable>
      {issuing && <Modal title="Issue a student card" onClose={() => setIssuing(false)} footer={<><Button variant="soft" onClick={() => setIssuing(false)}>Cancel</Button><Button disabled={busy || !studentId} onClick={() => void run(async () => { await safetyApi.issueCard({ holderType: 'STUDENT', studentId }); setIssuing(false); await list.reload(); })}>Issue</Button></>}><StudentPicker value={studentId} onChange={setStudentId} /></Modal>}
      {prompt && <PromptModal title={prompt.action === 'REPLACE' ? `Replace ${prompt.card.holderName}'s card` : `Mark card ${humanize(prompt.action).toLowerCase()}`} label="Reason" danger={prompt.action !== 'REPLACE'} onClose={() => setPrompt(null)} onSubmit={(reason) => (prompt.action === 'REPLACE' ? safetyApi.replaceCard(prompt.card.id, reason) : safetyApi.blockCard(prompt.card.id, prompt.action, reason)).then(() => list.reload())} />}
    </div>
  );
}

function RosterTab() {
  const state = useLoad(() => safetyApi.roster(), []);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Loadable state={state}>{(r) => (
      <div className="ops-stack">
        <div className="ops-inline"><Button variant="soft" onClick={() => void state.reload()}>Refresh</Button><Button onClick={() => void downloadCsv('/safety/emergency-roster?format=csv', `emergency-roster-${isoDay()}.csv`).catch((e) => setErr(errorMessage(e, 'Download failed')))}>Download CSV (print a copy)</Button><span className="ops-muted">As of {fmtDateTime(r.asOf)}</span></div>
        <ErrorNote error={err} />
        <KeyValues rows={[['Students on the register', String(r.students.length)], ['Released today', String(r.releasedToday)], ['On out-pass', String(r.onOutPass)], ['Visitors on site', String(r.visitors.length)]]} />
        <SectionCard title="Visitors on site">{!r.visitors.length ? <p className="ops-muted">None.</p> : <ul className="ops-list">{r.visitors.map((v) => <li key={v.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{v.name}</div><div className="ops-row-sub">{humanize(v.kind)} · {v.location ?? ''} · host {v.host ?? '—'}</div></div></li>)}</ul>}</SectionCard>
        <SectionCard title="Students">{!r.students.length ? <p className="ops-muted">No register marked yet today.</p> : <ul className="ops-list fleet-roster">{r.students.map((s) => <li key={s.studentId}>{s.section ?? ''} {s.rollNo ? `#${s.rollNo}` : ''} {s.name}</li>)}</ul>}</SectionCard>
        <DataNote>{r.note}</DataNote>
      </div>
    )}</Loadable>
  );
}

export function GateView() {
  const { permissions } = usePermissions();
  const canVisitors = Boolean(permissions['visitors.manage']);
  const canCards = Boolean(permissions['checkpoints.manage']);
  const initial = (useQueryParam('tab') as 'visitors' | 'pickup' | 'events' | 'cards' | 'roster' | null) ?? (canVisitors ? 'visitors' : 'events');
  const [tab, setTab] = useState(initial);
  const tabs = [
    ...(canVisitors ? [{ key: 'visitors' as const, label: 'Visitors' }, { key: 'pickup' as const, label: 'Pickup & release' }] : []),
    { key: 'events' as const, label: 'Checkpoints' },
    { key: 'cards' as const, label: 'ID cards' },
    { key: 'roster' as const, label: 'Emergency roster' },
  ];
  return (
    <div className="ops-stack">
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'visitors' && <VisitorsTab canManage={canVisitors} />}
      {tab === 'pickup' && <PickupTab />}
      {tab === 'events' && <CheckpointsTab canManage={canCards} />}
      {tab === 'cards' && <CardsTab canManage={canCards} />}
      {tab === 'roster' && <RosterTab />}
    </div>
  );
}

// ── Parents ──────────────────────────────────────────────────────────────

export function PickupView() {
  const state = useLoad(() => safetyApi.myPickup(), []);
  const checks = useLoad(() => safetyApi.myChildrenCheckpoints({ date: isoDay() }), []);
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState<{ id: string; devOtp?: string } | null>(null);
  const [code, setCode] = useState('');
  const [f, setF] = useState({ studentId: '', name: '', relationship: '', phone: '', validTo: '' });
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <div className="ops-stack">
      <ErrorNote error={error} />
      <Loadable state={state}>{(d) => (
        <>
          <SectionCard title="Who may collect my child" sub="You are always authorised. Add someone else for a set time; you confirm it with a code sent to your phone." actions={<Button onClick={() => { setF({ ...f, studentId: d.children[0]?.id ?? '' }); setAsking(true); }}>+ Let someone collect</Button>}>
            {!d.adults.length ? <p className="ops-muted">Only you and the other guardians on record.</p> : (
              <ul className="ops-list">{d.adults.map((a) => (
                <li key={a.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{a.name}{a.relationship ? ` (${a.relationship})` : ''}</div><div className="ops-row-sub">{d.children.find((c) => c.id === a.studentId)?.name} · {a.validTo ? `until ${fmtDateTime(a.validTo)}` : 'standing'}</div></div>
                  <StatusPill status={a.status === 'ACTIVE' ? (a.validNow ? 'ACTIVE' : 'SCHEDULED') : 'PENDING'} label={a.status === 'PENDING_OTP' ? 'Waiting for your code' : a.validNow ? 'Can collect now' : humanize(a.status)} />
                  {a.status === 'PENDING_OTP' && <Button small onClick={() => setPending({ id: a.id })}>Enter code</Button>}
                  {a.kind === 'DELEGATE' && <Button small variant="ghost" onClick={() => void run(async () => { await safetyApi.revokeMyDelegate(a.id); await state.reload(); })}>Withdraw</Button>}
                </li>
              ))}</ul>
            )}
          </SectionCard>
          <SectionCard title="Recent handovers">
            {!d.recentReleases.length ? <p className="ops-muted">None recorded yet.</p> : <ul className="ops-list">{d.recentReleases.map((r) => <li key={r.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{r.studentName} → {r.receivedByName}</div><div className="ops-row-sub">{humanize(r.context)} · {fmtDateTime(r.at)}</div></div></li>)}</ul>}
          </SectionCard>
          {asking && (
            <Modal title="Let someone collect my child" onClose={() => setAsking(false)} footer={<><Button variant="soft" onClick={() => setAsking(false)}>Cancel</Button><Button disabled={busy || !f.name || !f.relationship || !f.validTo} onClick={() => void run(async () => { const r = await safetyApi.requestDelegate({ ...f, validTo: new Date(f.validTo).toISOString() }); setAsking(false); setPending({ id: r.id, devOtp: r.devOtp }); toast(r.codeSent ? 'A code was sent to your phone' : 'Could not send a code; ask the school office to add this person', r.codeSent ? 'success' : 'error'); await state.reload(); })}>Send me a code</Button></>}>
              <div className="ops-form-grid">
                <Field label="Child"><select className="input" value={f.studentId} onChange={(e) => setF({ ...f, studentId: e.target.value })}>{d.children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
                <Field label="Their name" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
                <Field label="Relationship" required><input className="input" value={f.relationship} onChange={(e) => setF({ ...f, relationship: e.target.value })} /></Field>
                <Field label="Their phone"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
                <Field label="Until" required><input type="datetime-local" className="input" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} /></Field>
              </div>
              <DataNote>They must show photo ID at the gate or bus stop.</DataNote>
            </Modal>
          )}
          {pending && (
            <Modal title="Confirm with your code" onClose={() => setPending(null)} footer={<><Button variant="soft" onClick={() => setPending(null)}>Later</Button><Button disabled={busy || code.length < 6} onClick={() => void run(async () => { await safetyApi.confirmDelegate(pending.id, code); setPending(null); setCode(''); toast('Confirmed', 'success'); await state.reload(); })}>Confirm</Button></>}>
              <Field label="6-digit code sent to your phone"><input className="input" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} /></Field>
              {pending.devOtp && <p className="ops-muted">Demo mode: the code is {pending.devOtp}.</p>}
            </Modal>
          )}
        </>
      )}</Loadable>
      {isOff(checks.error) ? null : <Loadable state={checks} empty={null}>{(c) => (
        <SectionCard title="Today at the gate and on the bus">
          {c.children.map((ch) => (
            <div key={ch.studentId}><b>{ch.name}</b>{!ch.events.length ? <p className="ops-muted">No scans today.</p> : <ul className="ops-list">{ch.events.map((e) => <li key={e.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{e.pointLabel}</div><div className="ops-row-sub">{fmtDateTime(e.at)}{e.location ? ` · ${e.location}` : ''}</div></div></li>)}</ul>}</div>
          ))}
          <DataNote>{c.disclaimer}</DataNote>
        </SectionCard>
      )}</Loadable>}
    </div>
  );
}
