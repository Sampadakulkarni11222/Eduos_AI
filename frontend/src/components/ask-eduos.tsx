'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Button, Spinner } from './ui';

interface Msg { role: 'user' | 'assistant'; text: string; tools?: string[] }

export function AskEduOS({ label = 'Ask Oakridge' }: { label?: string }) {
  const [open, setOpen] = useState(false);
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

  return (
    <>
      <Button onClick={handleOpen}>+ {label}</Button>
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
                  <p>Ask me things like:</p>
                  <ul>
                    <li>How is my child doing this month?</li>
                    <li>What's the attendance and any pending homework?</li>
                    <li>Show the growth score and explain it</li>
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
