'use client';
import { useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { safetyApi, type OutPassDto } from '@/lib/safety-api';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Drawer } from './drawer';
import { DataNote, ErrorNote, KeyValues, Loadable, PromptModal, SectionCard, StatusPill, Stepper, Tabs, fmtDateTime, humanize, useAction, useLoad, useQueryParam } from './kit';

/**
 * Hostel out-pass. Warden/principal (`mode="manage"`): the queue, approve or
 * decline, record exit and return. Parent/student (`mode="mine"`): request,
 * a guardian confirms a request their child made, follow the status.
 */
const STEPS = [{ key: 'PENDING_PARENT', label: 'Guardian' }, { key: 'PENDING_WARDEN', label: 'Warden' }, { key: 'APPROVED', label: 'Approved' }, { key: 'OUT', label: 'Out' }, { key: 'RETURNED', label: 'Back' }];
const tone = (p: OutPassDto) => (p.overdue ? 'OVERDUE' : p.status === 'OUT' ? 'LIVE' : p.status.startsWith('PENDING') ? 'PENDING' : p.status === 'RETURNED' ? 'DONE' : p.status);
const label = (p: OutPassDto) => (p.overdue ? 'Not back yet' : p.status === 'PENDING_PARENT' ? 'Waiting for guardian' : p.status === 'PENDING_WARDEN' ? 'Waiting for warden' : p.status === 'RETURNED' && p.late ? 'Returned late' : humanize(p.status));

function Detail({ id, mode, onClose, onChanged }: { id: string; mode: 'manage' | 'mine'; onClose: () => void; onChanged: () => void }) {
  const state = useLoad(() => safetyApi.outpass(id), [id]);
  const { me } = useAuth();
  const isParent = me?.profile?.role === 'PARENT';
  const [prompt, setPrompt] = useState<null | 'reject' | 'parent-reject' | 'cancel'>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const reload = async () => { await state.reload(); onChanged(); };
  const act = (action: 'parent-decision' | 'decision' | 'gate', body: unknown, msg: string) => run(async () => { await safetyApi.outpassAction(id, action, body); toast(msg, 'success'); await reload(); });
  const p = state.data;
  return (
    <Drawer title={p ? `${p.studentName} · ${p.refNo}` : 'Out-pass'} sub={p ? `${fmtDateTime(p.fromAt)} → ${fmtDateTime(p.toAt)}` : undefined} onClose={onClose}
      footer={p && <>
        {mode === 'mine' && isParent && p.status === 'PENDING_PARENT' && <><Button disabled={busy} onClick={() => void act('parent-decision', { decision: 'APPROVED' }, 'Confirmed')}>I confirm</Button><Button variant="ghost" onClick={() => setPrompt('parent-reject')}>I do not agree</Button></>}
        {mode === 'manage' && p.status === 'PENDING_WARDEN' && <><Button disabled={busy} onClick={() => void act('decision', { decision: 'APPROVED' }, 'Approved')}>Approve</Button><Button variant="ghost" onClick={() => setPrompt('reject')}>Decline</Button></>}
        {mode === 'manage' && p.status === 'APPROVED' && <Button disabled={busy} onClick={() => void act('gate', { event: 'EXIT' }, 'Exit recorded')}>Record exit</Button>}
        {mode === 'manage' && p.status === 'OUT' && <Button disabled={busy} onClick={() => void act('gate', { event: 'RETURN' }, 'Return recorded')}>Record return</Button>}
        {['PENDING_PARENT', 'PENDING_WARDEN', 'APPROVED'].includes(p.status) && <Button variant="ghost" onClick={() => setPrompt('cancel')}>Cancel out-pass</Button>}
      </>}>
      <ErrorNote error={error} />
      <Loadable state={state}>{(d) => (
        <>
          <Stepper steps={STEPS} current={['REJECTED', 'CANCELLED'].includes(d.status) ? 'PENDING_WARDEN' : d.status} failed={['REJECTED', 'CANCELLED'].includes(d.status)} />
          <div className="ops-inline"><StatusPill status={tone(d)} label={label(d)} /></div>
          <KeyValues rows={[
            ['Reason', d.reason], ['Destination', d.destination],
            ['Escort', d.escort?.name ? `${d.escort.name}${d.escort.relationship ? ` (${d.escort.relationship})` : ''}${d.escort.phone ? ` · ${d.escort.phone}` : ''}` : '—'],
            ['Requested by', humanize(d.requestedByRole)],
            ['Guardian', d.parentDecision?.decision ? `${humanize(d.parentDecision.decision)} ${fmtDateTime(d.parentDecision.at)}` : '—'],
            ['Warden', d.wardenDecision?.decision ? `${humanize(d.wardenDecision.decision)} ${fmtDateTime(d.wardenDecision.at)}${d.wardenDecision.note ? ` — ${d.wardenDecision.note}` : ''}` : '—'],
            ['Left', d.exitAt ? `${fmtDateTime(d.exitAt)} (${humanize(d.exitVia)})` : '—'],
            ['Returned', d.returnAt ? `${fmtDateTime(d.returnAt)}${d.late ? ' — late' : ''}` : '—'],
          ]} />
        </>
      )}</Loadable>
      {prompt === 'reject' && <PromptModal title="Decline out-pass" label="Reason (the family sees it)" danger onClose={() => setPrompt(null)} onSubmit={(note) => safetyApi.outpassAction(id, 'decision', { decision: 'REJECTED', note }).then(reload)} />}
      {prompt === 'parent-reject' && <PromptModal title="Do not agree" label="Note (optional)" required={false} danger onClose={() => setPrompt(null)} onSubmit={(note) => safetyApi.outpassAction(id, 'parent-decision', { decision: 'REJECTED', note }).then(reload)} />}
      {prompt === 'cancel' && <PromptModal title="Cancel out-pass" label="Reason" required={false} onClose={() => setPrompt(null)} onSubmit={(note) => safetyApi.outpassAction(id, 'cancel', { note }).then(reload)} />}
    </Drawer>
  );
}

function RequestForm({ mode, onClose, onSaved }: { mode: 'manage' | 'mine'; onClose: () => void; onSaved: () => void }) {
  const { me } = useAuth();
  const role = me?.profile?.role;
  const children = useLoad(() => (role === 'PARENT' ? safetyApi.myPickup().then((d) => d.children) : mode === 'manage' ? api.hostelStudents().then((rows) => rows.filter((r) => r.status === 'ACTIVE' && r.studentId).map((r) => ({ id: r.studentId!._id, name: [r.studentId!.firstName, r.studentId!.lastName].filter(Boolean).join(' ') }))) : Promise.resolve([])), [role, mode]);
  const [f, setF] = useState({ studentId: '', fromAt: '', toAt: '', reason: '', destination: '', escortName: '', escortRelationship: '', escortPhone: '' });
  const { run, busy, error } = useAction();
  const needsStudent = role === 'PARENT' || mode === 'manage';
  return (
    <Modal title="Request an out-pass" onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.fromAt || !f.toAt || !f.reason || !f.destination || (needsStudent && !f.studentId)} onClick={() => void run(async () => {
      await safetyApi.requestOutpass({ studentId: f.studentId || undefined, fromAt: new Date(f.fromAt).toISOString(), toAt: new Date(f.toAt).toISOString(), reason: f.reason, destination: f.destination, escort: { name: f.escortName, relationship: f.escortRelationship, phone: f.escortPhone } });
      onSaved(); onClose();
    })}>Send request</Button></>}>
      <div className="ops-form-grid">
        {needsStudent && <Field label="Student" required><select className="input" value={f.studentId} onChange={(e) => setF({ ...f, studentId: e.target.value })}><option value="">Choose…</option>{(children.data ?? []).filter((c) => c.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        <Field label="Leaving" required><input type="datetime-local" className="input" value={f.fromAt} onChange={(e) => setF({ ...f, fromAt: e.target.value })} /></Field>
        <Field label="Back by" required><input type="datetime-local" className="input" value={f.toAt} onChange={(e) => setF({ ...f, toAt: e.target.value })} /></Field>
        <Field label="Reason" required><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        <Field label="Destination" required><input className="input" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} /></Field>
        <Field label="Escort name"><input className="input" value={f.escortName} onChange={(e) => setF({ ...f, escortName: e.target.value })} /></Field>
        <Field label="Escort relationship"><input className="input" value={f.escortRelationship} onChange={(e) => setF({ ...f, escortRelationship: e.target.value })} /></Field>
        <Field label="Escort phone"><input className="input" value={f.escortPhone} onChange={(e) => setF({ ...f, escortPhone: e.target.value })} /></Field>
      </div>
      <DataNote>{role === 'STUDENT' ? 'Your guardian confirms your request in the app, then the warden decides.' : 'The warden decides; you will be told at each step, and if the return is late.'}</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

export function OutpassView({ mode = 'manage' }: { mode?: 'manage' | 'mine' }) {
  const [status, setStatus] = useState(mode === 'manage' ? 'PENDING_WARDEN' : 'ALL');
  const list = useLoad(() => safetyApi.outpasses({ status }), [status]);
  const [selected, setSelected] = useState<string | null>(useQueryParam('id'));
  const [asking, setAsking] = useState(false);
  const off = Boolean(list.error && /switched off/i.test(list.error));
  if (off) return <EmptyState icon="⏻" title="Hostel out-pass is switched off" sub="An administrator can switch it on in Settings → Features." />;
  return (
    <div className="ops-stack">
      <div className="ops-inline">
        <Tabs tabs={mode === 'manage'
          ? [{ key: 'PENDING_WARDEN', label: 'To decide' }, { key: 'APPROVED', label: 'Approved' }, { key: 'OUT', label: 'Out now' }, { key: 'PENDING_PARENT', label: 'With guardians' }, { key: 'ALL', label: 'All' }]
          : [{ key: 'ALL', label: 'All' }, { key: 'PENDING_PARENT', label: 'Needs guardian' }, { key: 'OUT', label: 'Out now' }]} value={status} onChange={setStatus} />
        <Button onClick={() => setAsking(true)}>+ Request out-pass</Button>
      </div>
      <Loadable state={list}>{(rows) => !rows.length ? <EmptyState title="No out-passes here" sub={mode === 'manage' ? 'Requests from residents and their guardians appear here.' : 'Request an out-pass for a hostel resident.'} /> : (
        <SectionCard title={`${rows.length} out-pass(es)`}>
          <ul className="ops-list">{rows.map((p) => (
            <li key={p.id} className="ops-row"><div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setSelected(p.id)}>
              <div className="ops-row-title">{p.studentName} · {p.destination}</div>
              <div className="ops-row-sub">{p.refNo} · {fmtDateTime(p.fromAt)} → {fmtDateTime(p.toAt)} · {p.reason}</div>
            </button></div><StatusPill status={tone(p)} label={label(p)} /></li>
          ))}</ul>
        </SectionCard>
      )}</Loadable>
      {asking && <RequestForm mode={mode} onClose={() => setAsking(false)} onSaved={() => void list.reload()} />}
      {selected && <Detail id={selected} mode={mode} onClose={() => setSelected(null)} onChanged={() => void list.reload()} />}
    </div>
  );
}
