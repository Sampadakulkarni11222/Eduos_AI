'use client';
import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '@/lib/api';
import { Button, Spinner, cx } from './ui';
import { useAuth } from '@/lib/auth';
import type { AgentProposedAction, WhatsappAssistantLink } from '@/lib/types';
import { SPEECH_LANGUAGES, isSpeechSupported, startDictation } from '@/lib/speech';

interface Msg {
  role: 'user' | 'assistant';
  text: string;
  tools?: string[];
  /** Set when the assistant is proposing a write that needs confirmation. */
  action?: AgentProposedAction | null;
  /** Once resolved, the buttons are replaced by the outcome. */
  resolved?: 'done' | 'cancelled';
}

export function AskEduOS({ label = 'Ask Agent' }: { label?: string }) {
  const [open, setOpen] = useState(false);
  // Minimising keeps the conversation alive but gets the panel out of the way,
  // which is the whole point: the assistant used to render inside a full-screen
  // scrim, so opening it made the page underneath unclickable — including the
  // assignment Submit button it was most often opened next to.
  const [minimized, setMinimized] = useState(false);
  // The launcher lives inside .topbar, which sets backdrop-filter. That makes
  // the topbar a containing block for position:fixed descendants, so the panel
  // was being positioned against the topbar instead of the viewport — on
  // narrow screens the bottom sheet ended up mostly above the fold. Portalling
  // to <body> puts it back in the viewport's coordinate space.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const portal = (node: ReactNode) => (mounted ? createPortal(node, document.body) : null);

  const { me } = useAuth();

  // WhatsApp hand-off. The server decides whether this is offered at all —
  // it is off unless a number is configured, and only families get it — so the
  // client just renders whatever it is told and hides the option otherwise.
  const [waLink, setWaLink] = useState<WhatsappAssistantLink | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const role = me?.profile?.role;

  // msgs and convId are stored in refs so they persist across open/close cycles
  const msgsRef = useRef<Msg[]>([]);
  const convIdRef = useRef<string | undefined>();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Voice input. `speechLang` drives both the recogniser and the language the
  // assistant replies in, so a parent who speaks Hindi is answered in Hindi
  // without having to set anything twice.
  const [speechLang, setSpeechLang] = useState(SPEECH_LANGUAGES[0]);
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  // Checked in an effect, not at render: the API is absent during SSR and a
  // direct check would desync the server and client markup.
  useEffect(() => { setVoiceAvailable(isSpeechSupported()); }, []);

  // Sync ref → state on open so the panel renders persisted history
  const handleOpen = () => {
    setMsgs([...msgsRef.current]);
    setMinimized(false);
    setOpen(true);
  };

  /**
   * Reserves the docked panel's space on <body> while it is open, so page
   * content reflows beside it instead of hiding underneath. Cleared on close,
   * on minimise, and on unmount — a stale class here would leave every page
   * permanently indented.
   */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const docked = open && !minimized;
    document.body.classList.toggle('ai-docked', docked);
    return () => document.body.classList.remove('ai-docked');
  }, [open, minimized]);

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy, open]);

  // Fetched on first open rather than on mount: most sessions never open the
  // assistant, and this is one request per page load otherwise.
  useEffect(() => {
    if (!open || waLink) return;
    api.whatsappAssistantLink().then(setWaLink).catch(() => setWaLink({ enabled: false, reason: 'UNAVAILABLE' }));
  }, [open, waLink]);

  /**
   * Hands off to WhatsApp. wa.me resolves per platform on its own — the
   * installed app on a phone, WhatsApp Web in a new tab on a desktop — so the
   * same URL is correct everywhere and no user-agent branching is needed to
   * make it work. The device is reported for analytics only.
   */
  const openWhatsapp = () => {
    if (!waLink?.enabled) return;
    const ua = navigator.userAgent;
    const device: 'MOBILE' | 'TABLET' | 'DESKTOP' = /iPad|Tablet/i.test(ua)
      ? 'TABLET'
      : /Android|iPhone|iPod|Mobile/i.test(ua)
        ? 'MOBILE'
        : 'DESKTOP';

    // Opened first, and analytics after: a blocked or slow request must not
    // delay the hand-off, and popup blockers only allow window.open during the
    // click's own task.
    window.open(waLink.url, '_blank', 'noopener,noreferrer');
    void api.trackWhatsappAssistantClick(device).catch(() => {});
  };

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
      // The agent endpoint answers questions AND proposes actions; anything
      // that writes comes back as `action` and is only performed once the
      // user confirms the summary below.
      const res = await api.agentAsk(text, speechLang.lang);
      const aiMsg: Msg = { role: 'assistant', text: res.reply, action: res.action };
      msgsRef.current = [...msgsRef.current, aiMsg];
      setMsgs([...msgsRef.current]);
    } catch (err) {
      // A 403 here is a real answer — the user asked for something their role
      // cannot do — so show the server's reason rather than a generic failure.
      const text = err instanceof ApiError && err.status === 403
        ? err.message
        : 'Sorry — I could not reach the assistant just now.';
      const errMsg: Msg = { role: 'assistant', text };
      msgsRef.current = [...msgsRef.current, errMsg];
      setMsgs([...msgsRef.current]);
    } finally { setBusy(false); }
  };

  /** Confirms or declines a proposed write. */
  const resolveAction = async (idx: number, accept: boolean) => {
    const msg = msgsRef.current[idx];
    if (!msg?.action || busy) return;
    setBusy(true);
    try {
      const res = await api.agentConfirm(msg.action.confirmToken, accept, speechLang.lang);
      msgsRef.current = msgsRef.current.map((m, i) =>
        i === idx ? { ...m, action: null, resolved: accept ? 'done' : 'cancelled' } : m
      );
      msgsRef.current = [...msgsRef.current, { role: 'assistant', text: res.reply }];
      setMsgs([...msgsRef.current]);
    } catch (err) {
      const text = err instanceof ApiError ? err.message : 'That could not be completed.';
      msgsRef.current = msgsRef.current.map((m, i) => (i === idx ? { ...m, action: null } : m));
      msgsRef.current = [...msgsRef.current, { role: 'assistant', text }];
      setMsgs([...msgsRef.current]);
    } finally { setBusy(false); }
  };

  const toggleDictation = () => {
    if (listening) { stopRef.current?.(); return; }
    setVoiceNote(null);
    const stop = startDictation(speechLang.code, {
      onPartial: (t) => setInput(t),
      onFinal: (t) => setInput(t),
      onError: (m) => { setVoiceNote(m); setListening(false); },
      onEnd: () => { setListening(false); stopRef.current = null; },
    });
    if (!stop) { setVoiceNote('Voice input is not available in this browser.'); return; }
    stopRef.current = stop;
    setListening(true);
  };

  // Stop the microphone if the panel closes mid-dictation.
  useEffect(() => {
    if (!open && stopRef.current) { stopRef.current(); stopRef.current = null; setListening(false); }
  }, [open]);

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
      'Do I have any assignments due?',
      'Show my grades',
      'What subjects do I have?'
    ];
  } else if (role === 'PARENT') {
    suggestions = [
      'How is my child doing this month?',
      "What's the attendance and pending homework for my child?",
      "Show my child's grades",
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
  } else if (role === 'PRINCIPAL' || role === 'ADMIN') {
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
      {open && minimized && portal(
        <button
          type="button"
          className="ai-fab"
          onClick={() => setMinimized(false)}
          aria-label={`${label} (minimised — click to reopen)`}
          title={`${label} — click to reopen`}
        >
          <span aria-hidden="true">✨</span>
        </button>
      )}
      {open && !minimized && portal(
        // No scrim and no aria-modal: this is a docked panel, not a modal. The
        // page behind it stays live and focusable on purpose.
        <aside className="ai-dock" aria-label={label}>
          <div className="ai-panel-inner">
            <div className="ai-header">
              <div>
                <div className="ai-title">{label}</div>
                <div className="ai-sub">Answers from your school data</div>
              </div>
              <div className="ai-header-actions">
                <button
                  type="button"
                  className="ai-minimize"
                  onClick={() => setMinimized(true)}
                  aria-label="Minimise assistant"
                  title="Minimise"
                >
                  −
                </button>
                <button type="button" className="modal-close" aria-label="Close dialog" title="Close" onClick={() => setOpen(false)}>×</button>
              </div>
            </div>
            <div className="ai-body" ref={scrollRef}>
              {msgs.length === 0 && waLink?.enabled && (
                <div className="ai-channels">
                  <p className="ai-channels-title">Need quick help?</p>

                  <button type="button" className="ai-channel" onClick={() => inputRef.current?.focus()}>
                    <span className="ai-channel-icon" aria-hidden="true">💬</span>
                    <span className="ai-channel-text">
                      <span className="ai-channel-label">Chat with AI</span>
                      <span className="ai-channel-sub">Continue inside the portal.</span>
                    </span>
                  </button>

                  <div className="ai-channels-or"><span>OR</span></div>

                  <button type="button" className="ai-channel ai-channel-wa" onClick={openWhatsapp}>
                    <span className="ai-channel-icon" aria-hidden="true">
                      {/* Inline so the icon works offline and cannot be blocked. */}
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" role="img" aria-label="WhatsApp">
                        <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.25-.46-2.38-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.14-.14.3-.35.45-.53.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.53.07-.8.38-.28.3-1.05 1.02-1.05 2.5s1.07 2.9 1.22 3.1c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35z"/>
                        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.96L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.13h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.17 8.17 0 0 1-1.25-4.36c0-4.54 3.7-8.24 8.24-8.24a8.18 8.18 0 0 1 5.82 2.42 8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.25 8.23z"/>
                      </svg>
                    </span>
                    <span className="ai-channel-text">
                      <span className="ai-channel-label">Chat on WhatsApp</span>
                      <span className="ai-channel-sub">Continue the conversation on WhatsApp.</span>
                    </span>
                  </button>

                  <p className="ai-channels-note">Available 24×7</p>
                </div>
              )}
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
                          onFocus={(e) => (e.currentTarget.style.background = '#f1f5f9')}
                          onBlur={(e) => (e.currentTarget.style.background = '#f8fafc')}
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

                  {/* Nothing is written until this is confirmed. The summary
                      shown here is the server's, not re-composed on the
                      client, so the user approves exactly what will run. */}
                  {m.action && (
                    <div className="ai-confirm" role="group" aria-label="Confirm action">
                      <div className="ai-confirm-summary">
                        {m.action.affectsOthers && <span className="ai-confirm-warn">Affects other people&apos;s records</span>}
                        {m.action.summary}
                      </div>
                      <div className="ai-confirm-actions">
                        <button type="button" className="ai-confirm-yes" disabled={busy} onClick={() => void resolveAction(i, true)}>
                          Confirm
                        </button>
                        <button type="button" className="ai-confirm-no" disabled={busy} onClick={() => void resolveAction(i, false)}>
                          Cancel
                        </button>
                      </div>
                      <div className="ai-confirm-expiry">Expires in {m.action.expiresInMinutes} min</div>
                    </div>
                  )}
                  {m.resolved && (
                    <div className="ai-tools">{m.resolved === 'done' ? '✓ confirmed' : '✕ cancelled'}</div>
                  )}
                </div>
              ))}
              {busy && <div className="ai-msg assistant"><div className="ai-bubble"><Spinner /></div></div>}
            </div>
            {voiceNote && <div className="ai-voice-note" role="status">{voiceNote}</div>}
            <form className="ai-input" onSubmit={send}>
              {voiceAvailable && (
                <>
                  <label className="sr-only" htmlFor="ai-speech-lang">Voice language</label>
                  <select
                    id="ai-speech-lang"
                    className="ai-lang"
                    value={speechLang.code}
                    disabled={listening}
                    onChange={(e) =>
                      setSpeechLang(SPEECH_LANGUAGES.find((l) => l.code === e.target.value) ?? SPEECH_LANGUAGES[0])
                    }
                  >
                    {SPEECH_LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>{l.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={cx('ai-mic', listening && 'listening')}
                    onClick={toggleDictation}
                    disabled={busy}
                    aria-label={listening ? 'Stop dictation' : `Speak your question in ${speechLang.label}`}
                    aria-pressed={listening}
                  >
                    {listening ? '■' : '🎤'}
                  </button>
                </>
              )}
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={listening ? 'Listening…' : 'Ask anything…'}
                disabled={busy}
                aria-label="Message input"
              />
              <Button type="submit" disabled={busy || !input.trim()}>Send</Button>
            </form>
          </div>
        </aside>
      )}
    </>
  );
}
