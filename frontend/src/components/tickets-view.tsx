'use client';
import { FormEvent, useEffect, useState } from 'react';
import { Button, Card, EmptyState, Pill, SkeletonRows } from './ui';
import { api } from '@/lib/api';
import type { TicketDto, TicketThread } from '@/lib/types';

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'gray' | 'blue'> = {
  NEW: 'blue', OPEN: 'amber', WAITING: 'gray', RESOLVED: 'green', CLOSED: 'gray',
};

export function TicketsView({ canCreate, canRespond }: { canCreate: boolean; canRespond: boolean }) {
  const [items, setItems] = useState<TicketDto[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const reload = () => api.tickets().then(setItems).catch(() => setItems([]));
  useEffect(() => { void reload(); }, []);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: openId ? '1fr 1.2fr' : '1fr', gap: 16 }}>
      <div>
        {canCreate && <div style={{ marginBottom: 14 }}><Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Close' : '+ New ticket'}</Button></div>}
        {showForm && <NewTicket onDone={() => { setShowForm(false); void reload(); }} />}
        {items === null && <Card><SkeletonRows rows={4} /></Card>}
        {items?.length === 0 && <EmptyState title="No tickets" sub="Support requests appear here." />}
        {items && items.length > 0 && (
          <Card pad={false}>
            {items.map((t, i) => (
              <button key={t.id} onClick={() => setOpenId(t.id)}
                style={{ width: '100%', textAlign: 'left', background: openId === t.id ? 'var(--panel-bg)' : 'transparent', border: 'none', borderTop: i ? '1px solid var(--hairline)' : 'none', padding: '14px 18px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: 13.5 }}>{t.subject}</span>
                  <Pill tone={STATUS_TONE[t.status] ?? 'gray'}>{t.status.toLowerCase()}</Pill>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 3 }}>
                  {t.routedToRoleKey ? `Routed to ${t.routedToRoleKey.toLowerCase()}` : ''} · {t.messageCount} message{t.messageCount === 1 ? '' : 's'}
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api.createTicket({ subject, body, routedToRoleKey }); onDone(); }
    catch { setErr('Failed to raise ticket. Please try again.'); }
    finally { setBusy(false); }
  };
  return (
    <Card style={{ marginBottom: 14 }}>
      <form onSubmit={submit}>
        <div className="field-label">Subject</div>
        <input className="field-input" value={subject} onChange={(e) => setSubject(e.target.value)} required />
        <div className="field-label">Message</div>
        <textarea className="field-input" rows={2} value={body} onChange={(e) => setBody(e.target.value)} required />
        <div className="field-label">Route to</div>
        <select className="field-input" value={routedToRoleKey} onChange={(e) => setRoute(e.target.value)}>
          <option value="ADMIN">Admin office</option><option value="WARDEN">Warden</option><option value="LIBRARIAN">Librarian</option><option value="PRINCIPAL">Principal</option>
        </select>
        {err && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>{err}</p>}
        <Button type="submit" disabled={busy}>{busy ? 'Raising…' : 'Raise ticket'}</Button>
      </form>
    </Card>
  );
}
