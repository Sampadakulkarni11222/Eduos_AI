'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, SkeletonRows } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { PtMessageDto, PtThreadDetailDto, PtThreadDto, StudentListItem, StudentTeacherDto } from '@/lib/types';

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}

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
            {t.teacherName ?? 'Teacher'}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>
            Re: {t.studentName ?? '--'}
          </div>
          {t.lastMessageSnippet && (
            <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {t.lastMessageSnippet}
            </div>
          )}
        </button>
      ))}
    </Card>
  );
}

function ChatPanel({ threadId, onNewMessage }: { threadId: string; onNewMessage: () => void }) {
  const [detail, setDetail] = useState<PtThreadDetailDto | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = () =>
    api.ptGetThread(threadId).then((d) => { setDetail(d); }).catch(() => setDetail(null));

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
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)' }}>
        <div style={{ fontFamily: 'Newsreader, serif', fontSize: 17, fontWeight: 600 }}>
          {thread.teacherName ?? 'Teacher'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
          Re: {thread.studentName ?? '--'}{thread.subject ? ` · ${thread.subject}` : ''}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 13, marginTop: 32 }}>
            No messages yet. Start the conversation below.
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
          placeholder="Type a message..."
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !text.trim()}>Send</Button>
      </form>
    </Card>
  );
}

function StartThreadForm({ students, onStarted }: { students: StudentListItem[]; onStarted: (id: string) => void }) {
  const [studentId, setStudentId] = useState(students[0]?.id ?? '');
  const [teachers, setTeachers] = useState<StudentTeacherDto[] | null>(null);
  const [teacherProfileId, setTeacherProfileId] = useState('');
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!studentId) {
      setTeachers([]);
      setTeacherProfileId('');
      return;
    }
    setLoadingTeachers(true);
    api.ptStudentTeachers(studentId)
      .then((res) => {
        setTeachers(res);
        setTeacherProfileId(res[0]?.profileId ?? '');
      })
      .catch(() => {
        setTeachers([]);
        setTeacherProfileId('');
      })
      .finally(() => setLoadingTeachers(false));
  }, [studentId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!studentId) { setErr('Select a child first.'); return; }
    if (!teacherProfileId) { setErr('Select a teacher to contact.'); return; }
    setErr(null);
    setBusy(true);
    try {
      const thread = await api.ptStartThread({
        studentId,
        teacherProfileId,
        subject: subject.trim() || undefined,
      });
      onStarted(thread.id);
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'Could not start conversation.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Start a new conversation</div>
      <form onSubmit={submit}>
        <div className="field-label">Child</div>
        <select
          className="field-input"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
        >
          {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <div className="field-label">Teacher</div>
        <select
          className="field-input"
          value={teacherProfileId}
          onChange={(e) => setTeacherProfileId(e.target.value)}
          disabled={loadingTeachers || !teachers || teachers.length === 0}
        >
          {loadingTeachers && <option value="">Loading teachers...</option>}
          {!loadingTeachers && (!teachers || teachers.length === 0) && (
            <option value="">No teachers found for this student</option>
          )}
          {!loadingTeachers && teachers && teachers.map((t) => (
            <option key={t.profileId} value={t.profileId}>{t.label}</option>
          ))}
        </select>

        <div className="field-label">Subject (optional)</div>
        <input className="field-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Progress update, homework concern..." />
        {err && <div style={{ color: 'var(--red, #c0392b)', fontSize: 13, marginBottom: 8 }}>{err}</div>}
        <Button type="submit" disabled={busy || loadingTeachers || !teacherProfileId}>{busy ? 'Starting...' : 'Start conversation'}</Button>
      </form>
    </Card>
  );
}

export default function ParentMessages() {
  const [threads, setThreads] = useState<PtThreadDto[] | null>(null);
  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const reload = () =>
    api.ptListThreads().then(setThreads).catch(() => setThreads([]));

  useEffect(() => {
    void reload();
    api.students().then((r) => setStudents(r.items)).catch(() => setStudents([]));
  }, []);

  const loading = threads === null || students === null;

  function handleStarted(id: string) {
    setShowForm(false);
    void reload();
    setActiveId(id);
  }

  return (
    <PortalShell expectedSlug="parent" topbar={{ title: 'Messages', desc: "Direct conversations with your child's class teacher." }}>
      <div style={{ display: 'grid', gridTemplateColumns: activeId ? '300px 1fr' : '1fr', gap: 16 }}>
        <div>
          <div style={{ marginBottom: 12 }}>
            <Button small onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Cancel' : '+ New conversation'}
            </Button>
          </div>

          {showForm && students && students.length > 0 && (
            <StartThreadForm students={students} onStarted={handleStarted} />
          )}
          {showForm && students && students.length === 0 && (
            <EmptyState icon="◌" title="No children linked" sub="No student records are linked to your account." />
          )}

          {loading && <Card><SkeletonRows rows={4} /></Card>}
          {!loading && threads.length === 0 && !showForm && (
            <EmptyState
              icon="✉"
              title="No conversations yet"
              sub="Start a new conversation with your child's class teacher using the button above."
            />
          )}
          {!loading && <ThreadList threads={threads} activeId={activeId} onSelect={setActiveId} />}
        </div>

        {activeId && (
          <ChatPanel threadId={activeId} onNewMessage={reload} />
        )}
        {!activeId && threads !== null && threads.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <EmptyState icon="✉" title="Select a conversation" sub="Choose a thread from the left to read messages." />
          </div>
        )}
      </div>
    </PortalShell>
  );
}
