'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Button, Spinner } from './ui';
import { useAuth } from '@/lib/auth';

interface Msg { role: 'user' | 'assistant'; text: string; tools?: string[] }

export function AskEduOS({ label = 'Ask Agent' }: { label?: string }) {
  const [open, setOpen] = useState(false);
  const { me } = useAuth();
  const role = me?.profile?.role;

  // msgs and convId are stored in refs so they persist across open/close cycles
  const msgsRef = useRef<Msg[]>([]);
  const convIdRef = useRef<string | undefined>();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Sync ref → state on open so the panel renders persisted history
  const handleOpen = () => {
    setMsgs([...msgsRef.current]);
    setOpen(true);
  };

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy, open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    const userMsg: Msg = { role: 'user', text };
    msgsRef.current = [...msgsRef.current, userMsg];
    setInput(''); setMsgs([...msgsRef.current]); setBusy(true);
    try {
      const res = await api.aiChat(text, convIdRef.current);
      convIdRef.current = res.conversationId;
      const aiMsg: Msg = { role: 'assistant', text: res.reply, tools: res.toolsUsed };
      msgsRef.current = [...msgsRef.current, aiMsg];
      setMsgs([...msgsRef.current]);
    } catch {
      const errMsg: Msg = { role: 'assistant', text: 'Sorry — I could not reach the assistant just now.' };
      msgsRef.current = [...msgsRef.current, errMsg];
      setMsgs([...msgsRef.current]);
    } finally { setBusy(false); }
  };

  // Determine suggestions based on the user's profile role
  let suggestions: string[] = [
    'How is my child doing this month?',
    "What's the attendance and any pending homework?",
    'Show the growth score and explain it'
  ];

  if (role === 'TEACHER') {
    suggestions = [
      'What is my teaching schedule for today?',
      'List any students with low attendance in my sections',
      'Which assignments are currently pending evaluation?'
    ];
  } else if (role === 'STUDENT') {
    suggestions = [
      "What's my attendance percentage?",
      'Do I have any pending assignments due soon?',
      'Show my midterm exam marks'
    ];
  } else if (role === 'PARENT') {
    suggestions = [
      'How is my child doing this month?',
      "What's the attendance and pending homework for my child?",
      'Are there any pending fee payments?'
    ];
  } else if (role === 'LIBRARIAN') {
    suggestions = [
      'Which books are currently overdue?',
      'List all issued books and their due dates',
      'Are there any pending library tickets?'
    ];
  } else if (role === 'WARDEN') {
    suggestions = [
      'Show all empty hostel rooms in Block A',
      "List student allocations in the girls' block",
      'Are there any pending hostel tickets?'
    ];
  } else if (role === 'FINANCE') {
    suggestions = [
      'Show total collected fees vs pending fees',
      'List recently paid fee invoices',
      'Show all overdue invoices'
    ];
  } else if (role === 'PRINCIPAL' || role === 'OWNER' || role === 'ADMIN') {
    suggestions = [
      'What is the overall attendance rate of the school?',
      'Show the budget health and collected fees summary',
      'Show risk analysis summary of at-risk students'
    ];
  }

  const handleSuggestionClick = (sText: string) => {
    setInput(sText);
  };

  return (
    <>
      <Button onClick={handleOpen} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 14 }}>✨</span> {label}
      </Button>
      {open && (
        <div className="ai-overlay" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label={label}>
          <aside className="ai-panel" onClick={(e) => e.stopPropagation()}>
            <div className="ai-header">
              <div>
                <div className="ai-title">{label}</div>
                <div className="ai-sub">Answers from your school data</div>
              </div>
              <button className="modal-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
            </div>
            <div className="ai-body" ref={scrollRef}>
              {msgs.length === 0 && (
                <div className="ai-empty">
                  <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)', marginBottom: 8 }}>Suggested queries for you:</p>
                  <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {suggestions.map((sText, idx) => (
                      <li key={idx}>
                        <button
                          type="button"
                          onClick={() => handleSuggestionClick(sText)}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            background: '#f8fafc',
                            border: '1px solid #e2e8f0',
                            borderRadius: 8,
                            padding: '8px 12px',
                            fontSize: 12.5,
                            color: 'var(--accent)',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                          onMouseOver={(e) => (e.currentTarget.style.background = '#f1f5f9')}
                          onMouseOut={(e) => (e.currentTarget.style.background = '#f8fafc')}
                        >
                          💬 &nbsp; {sText}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={`ai-msg ${m.role}`}>
                  <div className="ai-bubble">{m.text}</div>
                  {m.tools && m.tools.length > 0 && <div className="ai-tools">used: {Array.from(new Set(m.tools)).join(', ')}</div>}
                </div>
              ))}
              {busy && <div className="ai-msg assistant"><div className="ai-bubble"><Spinner /></div></div>}
            </div>
            <form className="ai-input" onSubmit={send}>
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything…" disabled={busy} aria-label="Message input" />
              <Button type="submit" disabled={busy || !input.trim()}>Send</Button>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}
