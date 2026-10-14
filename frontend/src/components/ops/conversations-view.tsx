'use client';
import { useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { usePermissions } from '@/lib/permissions';
import { conversationsApi, type Contacts } from '@/lib/ptm-api';
import type { Attachment } from '@/lib/ops-types';
import { AttachUpload } from './attach';
import {
  Attachments, DataNote, ErrorNote, Loadable, SectionCard, StatusPill, Tabs, Tile, fmtDateTime, humanize, useAction, useLoad, useQueryParam,
} from './kit';

/**
 * Parent–teacher messages about a child. Parents write to their child's
 * teachers and the principal; teachers to the parents of their pupils; the
 * principal can read any thread (each such read is logged). Phone numbers are
 * never shown and are removed from messages.
 */

function NewThread({ contacts, onClose, onDone }: { contacts: Contacts; onClose: () => void; onDone: (id: string) => void }) {
  const [f, setF] = useState({ studentId: '', otherId: '', subject: '', body: '' });
  const [files, setFiles] = useState<Attachment[]>([]);
  const { run, busy, error } = useAction();
  const people = contacts.kind === 'PARENT'
    ? (contacts.children.find((c) => c.studentId === f.studentId)?.staff ?? []).map((s) => ({ id: s.profileId, label: `${s.name} (${[s.roles.includes('CLASS_TEACHER') && 'class teacher', s.subjects.join(', '), s.roles.includes('PRINCIPAL') && 'principal'].filter(Boolean).join(', ')})`, note: s.officeHoursNote }))
    : (contacts.pupils.find((p) => p.studentId === f.studentId)?.guardians ?? []).map((g) => ({ id: g.profileId, label: `${g.name ?? 'Guardian'} (${humanize(g.relation)})`, note: null as string | null }));
  const chosen = people.find((p) => p.id === f.otherId);
  return (
    <Modal title="New message" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.studentId || !f.otherId || !f.body.trim()} onClick={() => void run(async () => {
      const t = await conversationsApi.start({ studentId: f.studentId, ...(contacts.kind === 'PARENT' ? { staffProfileId: f.otherId } : { parentProfileId: f.otherId }), subject: f.subject || undefined, body: f.body, attachments: files });
      onDone(t.id);
    })}>Send</Button></>}>
      <Field label={contacts.kind === 'PARENT' ? 'About which child' : 'Pupil'} required>
        <select className="input" value={f.studentId} onChange={(e) => setF({ ...f, studentId: e.target.value, otherId: '' })}>
          <option value="">Choose…</option>
          {contacts.kind === 'PARENT' ? contacts.children.map((c) => <option key={c.studentId} value={c.studentId}>{c.name}{c.className ? ` · ${c.className}` : ''}</option>)
            : contacts.pupils.map((p) => <option key={p.studentId} value={p.studentId}>{p.name} · {p.className}</option>)}
        </select>
      </Field>
      <Field label={contacts.kind === 'PARENT' ? 'To' : 'Parent'} required>
        <select className="input" value={f.otherId} onChange={(e) => setF({ ...f, otherId: e.target.value })} disabled={!f.studentId}><option value="">Choose…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
      </Field>
      {chosen?.note && <p className="ops-callout">Office hours: {chosen.note}</p>}
      <Field label="Subject"><input className="input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="e.g. Absence on Monday" /></Field>
      <Field label="Message" required><textarea className="input" rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
      <Attachments items={files} />
      <AttachUpload label="Attach a file" onUploaded={(a) => setFiles([...files, { name: a.name, url: a.url }])} />
      <DataNote>Phone numbers are removed from messages: the school&apos;s platform is the channel. For an emergency, call the school office.</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

function ThreadPane({ id, onChanged }: { id: string; onChanged: () => void }) {
  const t = useLoad(() => conversationsApi.get(id), [id]);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <Loadable state={t}>{(d) => (
      <SectionCard title={d.subject} sub={`${d.studentName} · ${d.parentName ?? 'Parent'} and ${d.staffName ?? 'Teacher'} (${humanize(d.staffRole)})`} actions={d.canClose ? <Button small variant="ghost" onClick={() => void run(async () => { await conversationsApi.close(id); await t.reload(); onChanged(); toast('Closed', 'info'); })}>Close conversation</Button> : undefined}>
        {d.oversight && <p className="ops-callout">You are viewing this conversation for oversight. Your view is logged and does not mark messages as read.</p>}
        {d.officeHoursNote && d.mySide === 'PARENT' && <p className="ops-callout">{d.staffName}&apos;s office hours: {d.officeHoursNote}</p>}
        <ol className="conv-messages">{d.messages.map((m) => (
          <li key={m.id} className={m.side === 'PARENT' ? 'conv-msg is-parent' : 'conv-msg is-staff'} data-mine={m.mine || undefined}>
            <div className="conv-meta">{m.senderName} · {fmtDateTime(m.at)}</div>
            <div className="conv-body">{m.body}</div>
            {m.attachments.length > 0 && <Attachments items={m.attachments} />}
            {m.mine && <div className="conv-receipt">{m.readByOther ? `Read ${fmtDateTime(m.readAt)}` : 'Sent'}</div>}
          </li>
        ))}</ol>
        {d.canReply ? (
          <div className="ops-stack">
            <textarea className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Reply" placeholder="Write a reply" />
            <Attachments items={files} />
            <div className="ops-inline"><AttachUpload label="Attach" onUploaded={(a) => setFiles([...files, { name: a.name, url: a.url }])} /><Button disabled={busy || !body.trim()} onClick={() => void run(async () => { await conversationsApi.reply(id, { body, attachments: files }); setBody(''); setFiles([]); await t.reload(); onChanged(); })}>Send</Button></div>
          </div>
        ) : d.status === 'CLOSED' ? <p className="ops-muted">This conversation is closed. Start a new one if you need to.</p> : null}
        <ErrorNote error={error} />
      </SectionCard>
    )}</Loadable>
  );
}

function OfficeHours() {
  const s = useLoad(() => conversationsApi.settings(), []);
  const [v, setV] = useState<string | null>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <SectionCard title="My office hours" sub="Shown to families when they write to you.">
      <Loadable state={s}>{(d) => (
        <div className="ops-inline"><input className="input" value={v ?? d.officeHoursNote ?? ''} onChange={(e) => setV(e.target.value)} placeholder="e.g. I reply on school days between 3 and 5 pm." aria-label="Office hours" />
          <Button small disabled={busy || v === null} onClick={() => void run(async () => { await conversationsApi.saveSettings(v ?? ''); toast('Saved', 'success'); })}>Save</Button></div>
      )}</Loadable>
      <ErrorNote error={error} />
    </SectionCard>
  );
}

export function ConversationsView() {
  const { permissions, } = usePermissions();
  const all = permissions['conversations.use'] === 'ALL';
  const contacts = useLoad(() => conversationsApi.contacts(), []);
  const isParent = contacts.data?.kind === 'PARENT';
  const [tab, setTab] = useState<'mine' | 'queue' | 'all'>('mine');
  const [open, setOpen] = useState<string | null>(useQueryParam('id'));
  const [composing, setComposing] = useState(false);
  const list = useLoad(() => (tab === 'queue' ? conversationsApi.queue().then((q) => ({ items: q.items, total: q.total })) : conversationsApi.list({ view: tab === 'all' ? 'all' : 'mine' })), [tab]);
  const queue = useLoad(() => (isParent ? Promise.resolve(null) : conversationsApi.queue()), [isParent]);
  const tabs: Array<{ key: 'mine' | 'queue' | 'all'; label: string; count?: number | null }> = [
    { key: 'mine', label: 'My conversations' },
    ...(!isParent ? [{ key: 'queue' as const, label: 'Unanswered over 48 h', count: queue.data?.total ?? null }] : []),
    ...(all ? [{ key: 'all' as const, label: 'All (oversight)' }] : []),
  ];
  return (
    <div className="ops-stack">
      {!isParent && queue.data && <div className="kpi-grid"><Tile label="Family messages waiting over 48 hours" value={queue.data.total} tone={queue.data.total ? 'warn' : 'good'} /></div>}
      <div className="ops-inline"><Tabs tabs={tabs} value={tab} onChange={setTab} /><Button disabled={!contacts.data} onClick={() => setComposing(true)}>New message</Button></div>
      <div className="conv-layout">
        <Loadable state={list}>{(d) => !d.items.length ? <EmptyState title={tab === 'queue' ? 'Nothing waiting' : 'No conversations yet'} sub={isParent ? 'Write to your child\'s teachers or the principal.' : 'Messages from families about your pupils appear here.'} /> : (
          <ul className="ops-list card card-pad conv-list">{d.items.map((t) => (
            <li key={t.id} className={open === t.id ? 'ops-row is-selected' : 'ops-row'}>
              <div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setOpen(t.id)}>
                <div className="ops-row-title">{t.subject}{t.unread ? <span className="ops-tab-count">{t.unread}</span> : null}</div>
                <div className="ops-row-sub">{t.studentName} · {t.mySide === 'PARENT' ? t.staffName : t.parentName}{t.waitingHours ? ` · waiting ${t.waitingHours} h` : ''} · {fmtDateTime(t.lastMessageAt)}</div>
              </button></div>
              <StatusPill status={t.status === 'OPEN' ? (t.awaitingStaffSince && !isParent ? 'PENDING' : 'ACTIVE') : 'CLOSED'} label={t.status === 'OPEN' ? (t.awaitingStaffSince && !isParent ? 'Awaiting reply' : 'Open') : 'Closed'} />
            </li>
          ))}</ul>
        )}</Loadable>
        <div>{open ? <ThreadPane id={open} onChanged={() => { void list.reload(); void queue.reload(); }} /> : <p className="ops-muted">Choose a conversation.</p>}</div>
      </div>
      {!isParent && contacts.data && <OfficeHours />}
      {composing && contacts.data && <NewThread contacts={contacts.data} onClose={() => setComposing(false)} onDone={(id) => { setComposing(false); setTab('mine'); void list.reload(); setOpen(id); }} />}
    </div>
  );
}
