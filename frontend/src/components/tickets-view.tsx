'use client';
import { FormEvent, useEffect, useState } from 'react';
import { Button, Card, EmptyState, Pill, SkeletonRows } from './ui';
import { api, ApiError } from '@/lib/api';
import type { StudentListItem, TicketDto, TicketThread } from '@/lib/types';

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'gray' | 'blue'> = {
  NEW: 'blue', OPEN: 'amber', WAITING: 'gray', RESOLVED: 'green', CLOSED: 'gray',
};

const PRIORITY_COLOR: Record<string, string> = {
  CRITICAL: 'var(--red)', HIGH: 'var(--red)', MEDIUM: 'var(--amber)', LOW: 'var(--green)',
};
function PriorityDot({ priority }: { priority?: string | null }) {
  const p = (priority || 'MEDIUM').toUpperCase();
  const color = PRIORITY_COLOR[p] ?? '#ccc';
  return (
    <span
      style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0, marginRight: 6 }}
      title={`Priority: ${p.toLowerCase()}`}
    />
  );
}

const SEVERITY_TONE: Record<string, 'red' | 'amber' | 'green' | 'gray'> = {
  CRITICAL: 'red', HIGH: 'red', MEDIUM: 'amber', LOW: 'green',
};

export function TicketsView({ canCreate, canRespond }: { canCreate: boolean; canRespond: boolean }) {
  const [items, setItems] = useState<TicketDto[] | null>(null);
  const [err, setErr] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const reload = () => {
    setErr(false);
    api.tickets().then((r) => { setItems(r); setErr(false); }).catch(() => { setErr(true); setItems(null); });
  };
  useEffect(() => { void reload(); }, []);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: openId ? '1fr 1.2fr' : '1fr', gap: 16 }}>
      <div>
        {canCreate && <div style={{ marginBottom: 14 }}><Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Close' : '+ New ticket'}</Button></div>}
        {showForm && <NewTicket onDone={() => { setShowForm(false); void reload(); }} />}
        {items === null && !err && <Card><SkeletonRows rows={4} /></Card>}
        {err && <EmptyState title="Couldn't load tickets" sub="The server didn't respond. Reload the page to try again." />}
        {!err && items !== null && items.length === 0 && <EmptyState title="No tickets" sub="Support requests appear here." />}
        {items && items.length > 0 && (
          <Card pad={false}>
            {items.map((t, i) => (
              <button key={t.id} onClick={() => setOpenId(t.id)}
                style={{ width: '100%', textAlign: 'left', background: openId === t.id ? 'var(--panel-bg)' : 'transparent', border: 'none', borderTop: i ? '1px solid var(--hairline)' : 'none', padding: '12px 18px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <PriorityDot priority={t.priority} />
                    <span style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</span>
                  </span>
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
                    <Pill tone={SEVERITY_TONE[t.severity?.toUpperCase()] ?? 'gray'}>{(t.severity ?? 'medium').toLowerCase()}</Pill>
                    <Pill tone={STATUS_TONE[t.status] ?? 'gray'}>{t.status.toLowerCase()}</Pill>
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 3 }}>
                  {t.raisedBy && t.raisedBy !== 'Unknown' ? t.raisedBy : (t.routedToRoleKey ? t.routedToRoleKey.replace('_', ' ').toLowerCase() : 'Support request')}
                  {t.studentName ? ` · Re: ${t.studentName}` : ''}
                  {' · '}{t.messageCount} msg{t.messageCount === 1 ? '' : 's'}
                </div>
              </button>
            ))}
          </Card>
        )}
      </div>
      {openId && <ThreadPanel ticketId={openId} canRespond={canRespond} onChanged={reload} />}
    </div>
  );
}

function ThreadPanel({ ticketId, canRespond, onChanged }: { ticketId: string; canRespond: boolean; onChanged: () => void }) {
  const [thread, setThread] = useState<any | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api.ticketThread(ticketId).then(setThread).catch(() => setThread(null));
  useEffect(() => { setThread(null); load(); }, [ticketId]);

  const [replyErr, setReplyErr] = useState<string | null>(null);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    const text = reply.trim();
    if (!text) return;
    
    setReply('');
    setReplyErr(null);
    setBusy(true);

    const previousThread = thread;
    const optimisticMessage = {
      id: `optimistic-${Date.now()}`,
      body: text,
      mine: true,
      channel: 'WEB',
      createdAt: new Date().toISOString(),
      sending: true
    };

    if (thread) {
      setThread({
        ...thread,
        messages: [...thread.messages, optimisticMessage]
      });
    }

    try {
      await api.replyTicket({ ticketId, body: text });
      await load();
      onChanged();
    } catch {
      setThread(previousThread);
      setReply(text);
      setReplyErr('Failed to send reply. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!thread) return <Card><SkeletonRows rows={5} /></Card>;
  return (
    <Card pad={false} style={{ display: 'flex', flexDirection: 'column', maxHeight: '70vh' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)' }}>
        <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>{thread.subject}</strong>
        {thread.studentName && <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>Re: {thread.studentName}</div>}
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <Pill tone={SEVERITY_TONE[(thread.severity ?? 'MEDIUM').toUpperCase()] ?? 'gray'}>Severity: {(thread.severity ?? 'medium').toLowerCase()}</Pill>
          <Pill tone={STATUS_TONE[thread.status] ?? 'gray'}>{thread.status?.toLowerCase()}</Pill>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {thread.messages.map((m: any) => (
          <div key={m.id} 
               className={`chat-bubble ${m.mine ? 'me' : 'them'}`} 
               style={{ 
                 alignSelf: m.mine ? 'flex-end' : 'flex-start',
                 opacity: m.sending ? 0.6 : 1
               }}>
            {m.body}
            {m.sending && (
              <span style={{ display: 'block', fontSize: '9px', opacity: 0.7, textAlign: 'right', marginTop: 2 }}>
                Sending...
              </span>
            )}
            {m.channel === 'WHATSAPP' && <div className="wa-note">via WhatsApp</div>}
          </div>
        ))}
      </div>
      {replyErr && <div style={{ padding: '4px 18px', color: 'var(--red)', fontSize: 12.5 }}>{replyErr}</div>}
      <form onSubmit={send} style={{ padding: 12, borderTop: '1px solid var(--hairline)', display: 'flex', gap: 8 }}>
        <input className="input" style={{ flex: 1 }} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type a reply…" />
        <Button type="submit" disabled={busy}>Send</Button>
      </form>
    </Card>
  );
}

function NewTicket({ onDone }: { onDone: () => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [routedToRoleKey, setRoute] = useState('ADMIN');
  const [priority, setPriority] = useState('MEDIUM');
  const [severity, setSeverity] = useState('MEDIUM');
  const [studentId, setStudentId] = useState('');
  const [kids, setKids] = useState<StudentListItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.students().then((r) => { setKids(r.items); if (r.items[0]) setStudentId(r.items[0].id); }).catch(() => setKids([])); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api.createTicket({
        subject, body, routedToRoleKey, priority, severity,
        studentId: routedToRoleKey === 'CLASS_TEACHER' ? studentId : undefined,
      });
      onDone();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Failed to raise ticket. Please try again.');
    } finally { setBusy(false); }
  };
  return (
    <Card style={{ marginBottom: 14 }}>
      <form onSubmit={submit}>
        <div className="field-label">Subject</div>
        <input className="field-input" value={subject} onChange={(e) => setSubject(e.target.value)} required />
        <div className="field-label">Message</div>
        <textarea className="field-input" rows={2} value={body} onChange={(e) => setBody(e.target.value)} required />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div className="field-label">Priority</div>
            <select className="field-input" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </div>
          <div>
            <div className="field-label">Severity</div>
            <select className="field-input" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </div>
        </div>
        <div className="field-label">Route to</div>
        <select className="field-input" value={routedToRoleKey} onChange={(e) => setRoute(e.target.value)}>
          {kids && kids.length > 0 && <option value="CLASS_TEACHER">Class teacher</option>}
          <option value="ADMIN">Admin office</option><option value="WARDEN">Warden</option><option value="LIBRARIAN">Librarian</option><option value="PRINCIPAL">Principal</option>
        </select>
        {routedToRoleKey === 'CLASS_TEACHER' && kids && kids.length > 0 && (
          <>
            <div className="field-label">Regarding</div>
            <select className="field-input" value={studentId} onChange={(e) => setStudentId(e.target.value)} required>
              {kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </>
        )}
        {err && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>{err}</p>}
        <Button type="submit" disabled={busy}>{busy ? 'Raising…' : 'Raise ticket'}</Button>
      </form>
    </Card>
  );
}
