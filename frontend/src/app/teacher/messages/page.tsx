'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, SkeletonRows } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { PtMessageDto, PtThreadDetailDto, PtThreadDto } from '@/lib/types';

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}

// ── Thread list sidebar ──────────────────────────────────────────────────────
function ThreadList({
  threads, activeId, onSelect,
}: {
  threads: PtThreadDto[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  if (threads.length === 0) return null;
  return (
    <Card pad={false}>
      {threads.map((t, i) => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          style={{
            width: '100%', textAlign: 'left',
            background: activeId === t.id ? 'var(--panel-bg)' : 'transparent',
            border: 'none',
            borderTop: i ? '1px solid var(--hairline)' : 'none',
            padding: '14px 18px', cursor: 'pointer',
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-1)' }}>
            {t.parentName ?? 'Parent'}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>
            Re: {t.studentName ?? '—'}
          </div>
          {t.lastMessageSnippet && (
            <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {t.lastMessageSnippet}
            </div>
          )}
          {t.lastMessageAt && (
            <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 3 }}>
              {formatTime(t.lastMessageAt)}
            </div>
          )}
        </button>
      ))}
    </Card>
  );
}

// ── Chat panel ───────────────────────────────────────────────────────────────
function ChatPanel({ threadId, onNewMessage }: { threadId: string; onNewMessage: () => void }) {
  const [detail, setDetail] = useState<PtThreadDetailDto | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = () =>
    api.ptGetThread(threadId).then((d) => setDetail(d)).catch(() => setDetail(null));

  useEffect(() => { setDetail(null); void load(); }, [threadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [detail?.messages]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setSendErr(null);
    setBusy(true);
    setText('');
    const optimistic: PtMessageDto = {
      id: `opt-${Date.now()}`, threadId, senderProfileId: '', senderName: 'You',
      body, mine: true, createdAt: new Date().toISOString(),
    };
    setDetail((prev) => prev ? { ...prev, messages: [...prev.messages, optimistic] } : prev);
    try {
      await api.ptSendMessage({ threadId, body });
      await load();
      onNewMessage();
    } catch (err) {
      setSendErr(err instanceof ApiError ? err.message : 'Failed to send. Try again.');
      setText(body);
    } finally {
      setBusy(false);
    }
  };

  if (!detail) return <Card><SkeletonRows rows={6} /></Card>;

  const { thread, messages } = detail;
  return (
    <Card pad={false} style={{ display: 'flex', flexDirection: 'column', minHeight: 480, maxHeight: '72vh' }}>
      {/* Header */}
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)' }}>
        <div style={{ fontFamily: 'Newsreader, serif', fontSize: 17, fontWeight: 600 }}>
          {thread.parentName ?? 'Parent'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
          Re: {thread.studentName ?? '—'}{thread.subject ? ` · ${thread.subject}` : ''}
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 13, marginTop: 32 }}>
            No messages yet. The parent will start the conversation.
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '75%' }}
          >
            {!m.mine && (
              <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginBottom: 2 }}>{m.senderName}</div>
            )}
            <div className={`chat-bubble ${m.mine ? 'me' : 'them'}`}>
              {m.body}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2, textAlign: m.mine ? 'right' : 'left' }}>
              {formatTime(m.createdAt)}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {sendErr && (
        <div style={{ padding: '4px 18px', color: 'var(--red, #c0392b)', fontSize: 12.5 }}>{sendErr}</div>
      )}
      <form onSubmit={send} style={{ padding: 12, borderTop: '1px solid var(--hairline)', display: 'flex', gap: 8 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Reply to parent…"
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !text.trim()}>Send</Button>
      </form>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function TeacherMessages() {
  const [threads, setThreads] = useState<PtThreadDto[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const reload = () =>
    api.ptListThreads().then(setThreads).catch(() => setThreads([]));

  useEffect(() => { void reload(); }, []);

  return (
    <PortalShell expectedSlug="teacher" topbar={{ title: 'Messages', desc: 'Direct conversations with parents.' }}>
      <div style={{ display: 'grid', gridTemplateColumns: activeId ? '300px 1fr' : '1fr', gap: 16 }}>

        {/* Left: thread list */}
        <div>
          {threads === null && <Card><SkeletonRows rows={5} /></Card>}
          {threads !== null && threads.length === 0 && (
            <EmptyState
              icon="✉"
              title="No messages yet"
              sub="Parents can message you directly through their portal. Conversations will appear here."
            />
          )}
          {threads !== null && (
            <ThreadList threads={threads} activeId={activeId} onSelect={setActiveId} />
          )}
        </div>

        {/* Right: chat panel */}
        {activeId && (
          <ChatPanel threadId={activeId} onNewMessage={reload} />
        )}
        {!activeId && threads !== null && threads.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <EmptyState icon="✉" title="Select a conversation" sub="Choose a thread from the left to read and reply." />
          </div>
        )}
      </div>
    </PortalShell>
  );
}
