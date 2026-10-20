'use client';
import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Button, EmptyState, Field, Modal, SearchInput, useToast } from '@/components/ui';
import { AttachUpload } from './attach';
import { opsApi } from '@/lib/ops-api';
import { printHref } from './print-link';
import { usePermissions } from '@/lib/permissions';
import type { CorrespondenceDto, ExtractDto } from '@/lib/ops-types';
import { Drawer } from './drawer';
import {
  Attachments, DataNote, ErrorNote, KeyValues, Loadable, PromptModal, SectionCard, StatusPill, Stepper, Tabs, Tile, Timeline,
  fmtDate, humanize, useAction, useLoad, useQueryParam,
} from './kit';

/**
 * Correspondence register (Administration). Inward letters from the board,
 * government, university or district office are registered, assigned,
 * answered with principal approval, dispatched and closed with evidence.
 */

const COUNTERPARTIES = ['BOARD', 'GOVERNMENT', 'UNIVERSITY', 'REGULATOR', 'DISTRICT_OFFICE', 'LOCAL_AUTHORITY', 'TRUSTEE', 'VENDOR', 'PARENT', 'INTERNAL', 'OTHER'];
const CHANNELS = ['POST', 'EMAIL', 'PORTAL', 'HAND', 'COURIER', 'WHATSAPP', 'OTHER'];
const INWARD_STEPS = [
  { key: 'RECEIVED', label: 'Received' }, { key: 'ACKNOWLEDGED', label: 'Acknowledged' }, { key: 'IN_PROGRESS', label: 'In progress' },
  { key: 'REPLY_DRAFTED', label: 'Reply drafted' }, { key: 'AWAITING_APPROVAL', label: 'With principal' }, { key: 'APPROVED', label: 'Approved' },
  { key: 'DISPATCHED', label: 'Dispatched' }, { key: 'CLOSED', label: 'Closed' },
];
const OUTWARD_STEPS = [{ key: 'DRAFT', label: 'Draft' }, { key: 'AWAITING_APPROVAL', label: 'With principal' }, { key: 'APPROVED', label: 'Approved' }, { key: 'DISPATCHED', label: 'Dispatched' }, { key: 'CLOSED', label: 'Closed' }];

function RegisterModal({ onClose, onDone }: { onClose: () => void; onDone: (c: CorrespondenceDto) => void }) {
  const [f, setF] = useState({ direction: 'INWARD', counterpartyType: 'BOARD', counterpartyName: '', theirReference: '', subject: '', summary: '', receivedOn: '', dueOn: '', channel: 'POST', confidentiality: 'NORMAL', verified: false, method: '' });
  const [files, setFiles] = useState<Array<{ name: string; url: string }>>([]);
  const [hints, setHints] = useState<ExtractDto | null>(null);
  const { run, busy, error } = useAction();
  const set = (k: string, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal title="Register correspondence" onClose={onClose} wide footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !f.counterpartyName || !f.subject} onClick={() => void run(async () => {
        const c = await opsApi.registerLetter({ ...f, receivedOn: f.receivedOn || undefined, dueOn: f.dueOn || undefined, attachments: files, source: f.verified ? { verified: true, method: f.method } : undefined });
        onDone(c); onClose();
      })}>Register</Button>
    </>}>
      <div className="ops-form-grid">
        <Field label="Direction"><select className="input" value={f.direction} onChange={(e) => set('direction', e.target.value)}><option value="INWARD">Inward (received)</option><option value="OUTWARD">Outward (we send)</option></select></Field>
        <Field label="From / to (type)"><select className="input" value={f.counterpartyType} onChange={(e) => set('counterpartyType', e.target.value)}>{COUNTERPARTIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></Field>
        <Field label="Organisation / person" required><input className="input" value={f.counterpartyName} onChange={(e) => set('counterpartyName', e.target.value)} placeholder="e.g. CBSE Regional Office, Pune" /></Field>
        <Field label="Their reference no."><input className="input" value={f.theirReference} onChange={(e) => set('theirReference', e.target.value)} /></Field>
        <Field label="Channel"><select className="input" value={f.channel} onChange={(e) => set('channel', e.target.value)}>{CHANNELS.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></Field>
        {f.direction === 'INWARD' && <Field label="Received on"><input type="date" className="input" value={f.receivedOn} onChange={(e) => set('receivedOn', e.target.value)} /></Field>}
        <Field label="Reply / action due"><input type="date" className="input" value={f.dueOn} onChange={(e) => set('dueOn', e.target.value)} /></Field>
        <Field label="Confidentiality" hint="Restricted: only the owner, assignees and the principal"><select className="input" value={f.confidentiality} onChange={(e) => set('confidentiality', e.target.value)}><option value="NORMAL">Normal</option><option value="CONFIDENTIAL">Confidential</option><option value="RESTRICTED">Restricted</option></select></Field>
      </div>
      <Field label="Subject" required><input className="input" value={f.subject} onChange={(e) => set('subject', e.target.value)} style={{ width: '100%' }} /></Field>
      <Field label="Summary / text" hint="Paste the letter's text to have deadlines and action lines suggested.">
        <textarea className="input" rows={5} value={f.summary} onChange={(e) => set('summary', e.target.value)} style={{ width: '100%' }} />
      </Field>
      <div className="ops-inline">
        <Button small variant="soft" disabled={!f.summary.trim()} onClick={() => void run(async () => setHints(await opsApi.extract(f.summary)))}>Find deadlines &amp; actions</Button>
        {hints?.suggestedDueOn && <Button small variant="ghost" onClick={() => set('dueOn', hints.suggestedDueOn!)}>Use {fmtDate(hints.suggestedDueOn)} as due date</Button>}
      </div>
      {hints && (
        <div className="ops-callout">
          <b>Suggested (review before applying)</b>
          {hints.deadlines.length ? <ul>{hints.deadlines.map((d, i) => <li key={i}>{fmtDate(d.date)} — “…{d.context}…”</li>)}</ul> : <p>No dates found.</p>}
          {hints.actions.length > 0 && <><b>Action lines</b><ul>{hints.actions.map((a, i) => <li key={i}>{a}</li>)}</ul></>}
          <p className="ops-muted">{hints.method}</p>
        </div>
      )}
      <label className="ops-inline" style={{ margin: '8px 0' }}><input type="checkbox" checked={f.verified} onChange={(e) => set('verified', e.target.checked)} /> Sender verified as genuine</label>
      {f.verified && <Field label="How it was verified"><input className="input" value={f.method} onChange={(e) => set('method', e.target.value)} placeholder="Official portal / known email domain / signed letter / phone confirmation" /></Field>}
      <AttachUpload label="Attach the letter" onUploaded={(r) => setFiles((x) => [...x, { name: r.name, url: r.url }])} />
      {files.length > 0 && <Attachments items={files} />}
      <ErrorNote error={error} />
    </Modal>
  );
}

function LetterDetail({ id, onClose, onChanged, canManage }: { id: string; onClose: () => void; onChanged: () => void; canManage: boolean }) {
  const state = useLoad(() => Promise.all([opsApi.letter(id), opsApi.orgStaff().catch(() => [])]), [id]);
  const toast = useToast();
  const { run, busy, error } = useAction();
  const [draft, setDraft] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<null | 'noaction' | 'close' | 'ack' | 'dispatch' | 'reminder'>(null);
  const [dispatchChannel, setDispatchChannel] = useState('EMAIL');
  const reload = async () => { await state.reload(); onChanged(); };
  const c = state.data?.[0];
  const act = (action: string, body: unknown = {}, msg = 'Updated') => run(async () => { await opsApi.letterAction(id, action, body); toast(msg, 'success'); await reload(); });
  return (
    <Drawer title={c?.subject ?? 'Correspondence'} sub={c ? `${c.refNo} · ${humanize(c.direction)} · ${c.counterpartyName}` : undefined} onClose={onClose}>
      <Loadable state={state}>{([d, staff]) => (
        <>
          <Stepper steps={d.direction === 'INWARD' ? INWARD_STEPS : OUTWARD_STEPS} current={d.status === 'NO_ACTION' ? 'CLOSED' : d.status} />
          <div className="ops-inline"><StatusPill status={d.status} />{d.isOverdue && <span className="ops-flag-overdue">PAST DEADLINE</span>}<StatusPill status={d.confidentiality === 'NORMAL' ? 'DRAFT' : 'DISPUTED'} label={humanize(d.confidentiality)} />{d.source.verified ? <StatusPill status="CLEARED" label={`Verified: ${d.source.method}`} /> : <StatusPill status="PENDING" label="Sender not verified" />}{d.legalHold && <StatusPill status="BLOCKED" label="Legal hold" />}</div>
          <KeyValues rows={[['Their ref.', d.theirReference], ['Received', fmtDate(d.receivedOn)], ['Due', d.dueOn ? `${fmtDate(d.dueOn)}${d.daysToDue !== null ? ` (${d.daysToDue < 0 ? `${-d.daysToDue} days late` : `${d.daysToDue} days left`})` : ''}` : '—'], ['Channel', humanize(d.channel)], ['From/To', humanize(d.counterpartyType)]]} />
          {d.summary && <div className="ops-callout" style={{ whiteSpace: 'pre-wrap' }}>{d.summary}</div>}
          <div><h3 className="ops-section-title">Documents</h3><Attachments items={d.attachments} /></div>

          {canManage && d.isOpen && (
            <SectionCard title="Owner & assignees">
              <div className="ops-form-grid">
                <Field label="Owner"><select className="input" defaultValue={d.ownerProfileId ?? ''} onChange={(e) => void act('assign', { ownerProfileId: e.target.value }, 'Owner changed')}>{staff.map((s) => <option key={s.profileId} value={s.profileId}>{s.name}</option>)}</select></Field>
                <Field label="Due date"><input type="date" className="input" defaultValue={d.dueOn?.slice(0, 10) ?? ''} onBlur={(e) => e.target.value !== (d.dueOn?.slice(0, 10) ?? '') && void act('assign', { dueOn: e.target.value || null }, 'Due date set')} /></Field>
              </div>
            </SectionCard>
          )}

          {['RECEIVED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'REPLY_DRAFTED', 'DRAFT', 'APPROVED'].includes(d.status) && (
            <SectionCard title={d.direction === 'INWARD' ? 'Reply' : 'Letter'} sub={d.latestDraft ? `Version ${d.latestDraft.version}${d.status === 'APPROVED' ? ' — approved. Editing it will need approval again.' : ''}` : 'No draft yet.'}>
              <textarea className="input" rows={8} style={{ width: '100%' }} value={draft ?? d.latestDraft?.body ?? ''} onChange={(e) => setDraft(e.target.value)} placeholder="Write the reply here." />
              <div className="ops-inline">
                <Button small variant="soft" disabled={busy || !(draft ?? '').trim()} onClick={() => void run(async () => { await opsApi.letterAction(id, 'draft', { body: draft }); setDraft(null); toast('Draft saved', 'success'); await reload(); })}>Save draft</Button>
                {d.latestDraft && <Button small variant="ghost" onClick={() => window.open(printHref('letter', id), '_blank', 'noopener')}>Print on letterhead</Button>}
                {d.status !== 'APPROVED' && <Button small disabled={busy || (!d.latestDraft && !(draft ?? '').trim())} onClick={() => void run(async () => { if (draft) await opsApi.letterAction(id, 'draft', { body: draft }); await opsApi.letterAction(id, 'submit'); setDraft(null); toast('Sent to the principal for approval', 'success'); await reload(); })}>Send for approval</Button>}
              </div>
            </SectionCard>
          )}

          <div className="ops-inline">
            {d.status === 'RECEIVED' && <Button small variant="soft" onClick={() => void act('transition', { to: 'ACKNOWLEDGED' }, 'Acknowledged')}>Acknowledge</Button>}
            {['RECEIVED', 'ACKNOWLEDGED'].includes(d.status) && <Button small variant="soft" onClick={() => void act('transition', { to: 'IN_PROGRESS' })}>Start work</Button>}
            {['RECEIVED', 'ACKNOWLEDGED', 'IN_PROGRESS'].includes(d.status) && <Button small variant="ghost" onClick={() => setPrompt('noaction')}>No action needed</Button>}
            {!d.source.verified && <Button small variant="ghost" onClick={() => setPrompt('reminder')}>Set reminder</Button>}
            {d.status === 'APPROVED' && canManage && <Button small onClick={() => setPrompt('dispatch')}>Record dispatch</Button>}
            {d.status === 'DISPATCHED' && !d.dispatch.acknowledgement && canManage && <Button small variant="soft" onClick={() => setPrompt('ack')}>Record acknowledgement</Button>}
            {['DISPATCHED', 'IN_PROGRESS'].includes(d.status) && <Button small variant="soft" onClick={() => setPrompt('close')}>Close</Button>}
          </div>
          {d.dispatch?.at && <KeyValues rows={[['Dispatched', `${fmtDate(d.dispatch.at)} via ${humanize(d.dispatch.channel)}`], ['Tracking', d.dispatch.trackingNo], ['Acknowledgement', d.dispatch.acknowledgement ?? 'Not yet recorded']]} />}
          {d.resolution && <p><b>Resolution:</b> {d.resolution}</p>}
          <ErrorNote error={error} />
          <div><h3 className="ops-section-title">History</h3><Timeline items={d.history} /></div>
        </>
      )}</Loadable>
      {prompt === 'noaction' && <PromptModal title="Close without action" label="Why no action is needed" onClose={() => setPrompt(null)} onSubmit={(v) => opsApi.letterAction(id, 'transition', { to: 'NO_ACTION', note: v }).then(reload)} />}
      {prompt === 'close' && <PromptModal title="Close this item" label="Resolution" onClose={() => setPrompt(null)} onSubmit={(v) => opsApi.letterAction(id, 'close', { resolution: v, withoutAcknowledgement: !c?.dispatch?.acknowledgement }).then(reload)} extra={!c?.dispatch?.acknowledgement && c?.status === 'DISPATCHED' ? <p className="ops-callout is-warn">No delivery acknowledgement is recorded. Closing will note that.</p> : undefined} />}
      {prompt === 'ack' && <PromptModal title="Delivery / acknowledgement" label="Acknowledgement (e.g. receipt email, inward no. at their office, signed copy)" multiline={false} onClose={() => setPrompt(null)} onSubmit={(v) => opsApi.letterAction(id, 'acknowledgement', { acknowledgement: v }).then(reload)} />}
      {prompt === 'reminder' && <PromptModal title="Remind me" label="Reminder date (YYYY-MM-DD)" multiline={false} onClose={() => setPrompt(null)} onSubmit={(v) => opsApi.letterAction(id, 'reminders', { at: new Date(`${v}T09:00:00+05:30`).toISOString(), note: c?.subject }).then(reload)} />}
      {prompt === 'dispatch' && <PromptModal title="Record dispatch" label="Tracking / reference (courier no., email message id, portal ref.)" multiline={false} required={false} onClose={() => setPrompt(null)} extra={<Field label="Sent via"><select className="input" value={dispatchChannel} onChange={(e) => setDispatchChannel(e.target.value)}>{CHANNELS.map((ch) => <option key={ch} value={ch}>{humanize(ch)}</option>)}</select></Field>} onSubmit={(v) => opsApi.letterAction(id, 'dispatch', { channel: dispatchChannel, trackingNo: v || undefined }).then(reload)} />}
    </Drawer>
  );
}

type Tab = 'open' | 'overdue' | 'approval' | 'all';

export function CorrespondenceView() {
  const { permissions } = usePermissions();
  const canManage = Boolean(permissions['correspondence.manage']);
  const [tab, setTab] = useState<Tab>('open');
  const [q, setQ] = useState('');
  const [dir, setDir] = useState('');
  const openId = useQueryParam('id');
  const [selected, setSelected] = useState<string | null>(openId);
  const [registering, setRegistering] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const stats = useLoad(() => opsApi.letterStats(), []);
  const list = useLoad(() => opsApi.letters({ status: tab === 'open' ? 'OPEN' : tab === 'approval' ? 'AWAITING_APPROVAL' : undefined, overdue: tab === 'overdue' ? 'true' : undefined, q, direction: dir || undefined, pageSize: 100 }), [tab, q, dir]);
  const toast = useToast();
  const { run } = useAction();
  const refresh = () => { void stats.reload(); void list.reload(); };
  return (
    <div className="ops-stack">
      <Loadable state={stats}>{(s) => (
        <div className="kpi-grid">
          <Tile label="Open" value={s.open} />
          <Tile label="Past deadline" value={s.overdue} tone={s.overdue ? 'bad' : 'good'} />
          <Tile label="Due within 7 days" value={s.dueSoon} tone={s.dueSoon ? 'warn' : 'neutral'} />
          <Tile label="With the principal" value={s.awaitingApproval} />
          <Tile label="Approved, to dispatch" value={s.toDispatch} tone={s.toDispatch ? 'warn' : 'neutral'} />
        </div>
      )}</Loadable>
      <div className="ops-inline">
        <Tabs tabs={[{ key: 'open', label: 'Open' }, { key: 'overdue', label: 'Past deadline' }, { key: 'approval', label: 'Awaiting approval' }, { key: 'all', label: 'All' }]} value={tab} onChange={setTab} />
      </div>
      <div className="ops-inline">
        <SearchInput value={q} onChange={setQ} placeholder="Search subject, sender, reference…" />
        <select className="input" value={dir} onChange={(e) => setDir(e.target.value)} aria-label="Direction"><option value="">Inward & outward</option><option value="INWARD">Inward</option><option value="OUTWARD">Outward</option></select>
        {canManage && <Button onClick={() => setRegistering(true)}>+ Register</Button>}
        {canManage && <Button variant="soft" onClick={() => void run(async () => { const r = await opsApi.runLetterReminders(); toast(`${r.itemsDue} item(s) due; ${r.notified} reminder(s) sent`, 'info'); })}>Send due reminders</Button>}
      </div>
      <Loadable state={list}>{(d) => !d.items.length ? <EmptyState title="No correspondence" sub="Register a letter, circular or notice to start tracking it." /> : (
        <SectionCard title={`${d.total} item(s)`}>
          <ul className="ops-list">{d.items.map((c) => (
            <li key={c.id} className="ops-row">
              <div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setSelected(c.id)}>
                <div className="ops-row-title">{c.subject}</div>
                <div className="ops-row-sub">{c.refNo} · {c.direction === 'INWARD' ? 'from' : 'to'} {c.counterpartyName}{c.theirReference ? ` · ref ${c.theirReference}` : ''}{c.dueOn ? ` · due ${fmtDate(c.dueOn)}` : ''}</div>
              </button></div>
              {c.isOverdue && <span className="ops-flag-overdue">PAST DEADLINE</span>}
              {!c.source.verified && c.direction === 'INWARD' && <span className="ops-chip" title="Sender not verified">unverified</span>}
              <StatusPill status={c.status} />
            </li>
          ))}</ul>
        </SectionCard>
      )}</Loadable>
      <DataNote>Replies go to the principal for approval before dispatch. Messages to people link back here; letters themselves are never sent over WhatsApp.</DataNote>
      {registering && <RegisterModal onClose={() => setRegistering(false)} onDone={(c) => { refresh(); setSelected(c.id); }} />}
      {selected && <LetterDetail id={selected} canManage={canManage} onClose={() => { setSelected(null); if (openId) router.replace(pathname); }} onChanged={refresh} />}
    </div>
  );
}
