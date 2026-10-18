'use client';
import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '@/lib/api';
import { Button, Spinner, cx } from './ui';
import { useAuth } from '@/lib/auth';
import type { AgentContinuation, AgentDownload, AgentProposedAction, WhatsappAssistantLink } from '@/lib/types';
import { SPEECH_LANGUAGES, isSpeechSupported, startDictation, isSynthesisSupported, speak, stopSpeaking, speechLanguageFor } from '@/lib/speech';
import { familyApi } from '@/lib/family-api';
import { ChatMarkdown } from './chat-markdown';
import { EvidenceFooter } from './evidence-footer';
import dynamic from 'next/dynamic';
import { ASK_EVENT } from './genui/ask-event';
import type { GenUi } from './genui/genui';

/**
 * The generated-UI renderer (with its schema library and charts) is only
 * needed once the assistant answers with a panel, but this component sits on
 * every page; loaded on demand it no longer adds ~35 kB to every route. The
 * chunk is fetched as soon as the assistant is opened, ahead of any answer.
 */
const loadGenUi = () => import('./genui/genui');
const GenUiPanel = dynamic(() => loadGenUi().then((m) => m.GenUiPanel), { ssr: false });

/**
 * Turns of this conversation sent with each message, so a follow-up resolves
 * against what came before. Kept short deliberately: it is a routing aid for
 * the server, and the whole transcript would grow every request without making
 * "what about last month?" any clearer.
 */
const HISTORY_TURNS = 10;

/**
 * The conversation survives page changes and reloads.
 *
 * Every page renders its own shell, and the shell renders this component, so
 * a conversation held only in component state was lost on every navigation --
 * reproduced in the browser: after following a sidebar link the next message
 * went out with no history at all. The server now keeps the conversation
 * (agent/memory.js) under the id it hands back; this tab keeps that id and the
 * messages on screen in sessionStorage, per signed-in profile, so the panel
 * reopens where it was and the next question is understood in context.
 * sessionStorage, not localStorage: it ends with the tab and is never shared
 * with another one. Nothing here is authority -- the server finds the
 * conversation only for this same person in this same school.
 */
const STORE_PREFIX = 'eduos.ask.v1';
const MAX_STORED = 40;

interface StoredChat { conversationId?: string; msgs: Msg[] }

const storeKey = (profileId?: string | null) => (profileId ? `${STORE_PREFIX}.${profileId}` : null);

function readStored(key: string | null): StoredChat | null {
  if (!key || typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredChat;
    return Array.isArray(parsed?.msgs) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStored(key: string | null, value: StoredChat | null) {
  if (!key || typeof window === 'undefined') return;
  try {
    if (!value) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify({ ...value, msgs: value.msgs.slice(-MAX_STORED) }));
  } catch {
    /* storage full or blocked: the conversation still works for this page */
  }
}

interface Msg {
  role: 'user' | 'assistant';
  text: string;
  tools?: string[];
  /** Set when the assistant is proposing a write that needs confirmation. */
  action?: AgentProposedAction | null;
  /** Once resolved, the buttons are replaced by the outcome. */
  resolved?: 'done' | 'cancelled';
  /** Set when this answer holds part of a longer list: loads the next rows. */
  continuation?: AgentContinuation | null;
  /** The records the answer used, shown under it as "Based on". */
  evidence?: Array<{ text: string; link: string | null }>;
  /** A generated panel (OpenUI Lang) for an answer with data; the text stays as the fallback. */
  ui?: GenUi | null;
  /** The person chose the text over the panel for this answer. */
  showText?: boolean;
  /** p7 bulk import: the spreadsheet sent with this message (its name only). */
  attachment?: { name: string } | null;
  /** p7 bulk import: sheets the answer offers (error report, sample template). */
  downloads?: AgentDownload[];
  /** p7 automation: suggested next questions for this answer (sent when tapped; a write still comes back as a draft). */
  nextSteps?: Array<{ label: string; ask: string }>;
}

/** The suggested next steps on a reply, when the server sent any. */
const nextStepsOf = (res: unknown): Array<{ label: string; ask: string }> => {
  const steps = (res as { nextSteps?: unknown })?.nextSteps;
  return Array.isArray(steps)
    ? steps.filter((s): s is { label: string; ask: string } => typeof s?.label === 'string' && typeof s?.ask === 'string').slice(0, 3)
    : [];
};

/** Spreadsheets Ask AI can import: the bulk importers' own types and limit. */
const SHEET_TYPES = '.csv,.xlsx,.xls';
const SHEET_MAX_BYTES = 2 * 1024 * 1024;
const downloadsOf = (res: unknown): AgentDownload[] => {
  const r = res as { downloads?: AgentDownload[]; data?: { downloads?: AgentDownload[] } | null };
  const list = r?.downloads ?? r?.data?.downloads ?? [];
  return Array.isArray(list) ? list.filter((d) => d && typeof d.path === 'string' && d.path.startsWith('/imports/')) : [];
};

/** The generated panel on a reply, when the server sent one. */
const uiOf = (res: unknown): GenUi | null => {
  const ui = (res as { ui?: GenUi | null })?.ui;
  return ui && ui.format === 'openui-lang' && typeof ui.program === 'string' ? ui : null;
};

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
  const profileId = me?.profile?.id ?? null;
  // Set once this profile's stored conversation has been read back, so the
  // first (empty) render never overwrites it.
  const restoredFor = useRef<string | null>(null);

  // Restore this profile's conversation after a page change or reload; a
  // different profile starts with its own (or a fresh) one.
  useEffect(() => {
    if (!profileId || restoredFor.current === profileId) return;
    const stored = readStored(storeKey(profileId));
    msgsRef.current = stored?.msgs ?? [];
    convIdRef.current = stored?.conversationId;
    restoredFor.current = profileId;
    setMsgs([...msgsRef.current]);
  }, [profileId]);

  // Keep it as it changes.
  useEffect(() => {
    if (!profileId || restoredFor.current !== profileId) return;
    writeStored(storeKey(profileId), { conversationId: convIdRef.current, msgs: msgsRef.current });
  }, [msgs, profileId]);

  /** "New chat": forget this conversation here and on the server's side of it. */
  const newChat = () => {
    if (busy) return;
    msgsRef.current = [];
    convIdRef.current = undefined;
    writeStored(storeKey(profileId), null);
    setMsgs([]);
    setInput('');
  };
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // p7 bulk import: the sheet attached to the next message (uploaded already; only its id is sent).
  const [attached, setAttached] = useState<{ fileId: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
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

  // p7: the language starts as the one this person chose for school messages
  // (Settings → language), so a Tamil-speaking parent is heard and answered in
  // Tamil without picking it again here. They can still change it below.
  useEffect(() => {
    if (!profileId) return;
    familyApi.preferences()
      .then((p) => { const pref = speechLanguageFor(p?.language); if (pref) setSpeechLang(pref); })
      .catch(() => { /* no preference readable: English until chosen */ });
  }, [profileId]);

  // The words the microphone produced, so a message sent unchanged is marked
  // as spoken and the server shows back what it heard ("I heard: …").
  const dictatedRef = useRef<string | null>(null);

  // Read-aloud (SpeechSynthesis): a per-message "Listen" button, and an
  // optional switch that reads each new answer. Remembered for this browser.
  const [canSpeak, setCanSpeak] = useState(false);
  const [readAloud, setReadAloud] = useState(false);
  const spokenUpTo = useRef(0);
  useEffect(() => {
    setCanSpeak(isSynthesisSupported());
    try { setReadAloud(window.localStorage.getItem('eduos.ask.readAloud') === '1'); } catch { /* storage blocked */ }
  }, []);
  const toggleReadAloud = () => {
    const next = !readAloud;
    setReadAloud(next);
    if (!next) stopSpeaking();
    try { window.localStorage.setItem('eduos.ask.readAloud', next ? '1' : '0'); } catch { /* storage blocked */ }
  };
  useEffect(() => {
    if (!readAloud || !canSpeak) { spokenUpTo.current = msgs.length; return; }
    const last = msgs[msgs.length - 1];
    if (msgs.length > spokenUpTo.current && last?.role === 'assistant') speak(last.text, speechLang.code);
    spokenUpTo.current = msgs.length;
  }, [msgs, readAloud, canSpeak, speechLang.code]);

  // Sync ref → state on open so the panel renders persisted history
  const handleOpen = () => {
    void loadGenUi();
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

  // An action card on a generated panel (here or on a dashboard) opens the
  // assistant with its question typed in -- never sent. The person sends it,
  // and anything that writes still comes back as a draft to confirm.
  useEffect(() => {
    const onAsk = (e: Event) => {
      const text = (e as CustomEvent<{ text?: unknown }>).detail?.text;
      if (typeof text !== 'string' || !text.trim()) return;
      setInput(text.slice(0, 300));
      setMsgs([...msgsRef.current]);
      setMinimized(false);
      setOpen(true);
      setTimeout(() => inputRef.current?.focus(), 0);
    };
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  /** Uploads a chosen spreadsheet; it is attached to the next message sent. */
  const attachSheet = async (file: File | undefined) => {
    if (!file || busy || uploading) return;
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) {
      setVoiceNote('Only spreadsheets can be attached: .csv, .xlsx or .xls.');
      return;
    }
    if (file.size > SHEET_MAX_BYTES) {
      setVoiceNote('That file is larger than 2 MB. Split it into smaller sheets.');
      return;
    }
    setUploading(true); setVoiceNote(null);
    try {
      const up = await api.importUpload(file);
      setAttached({ fileId: up.fileId, name: up.name });
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch (err) {
      setVoiceNote(err instanceof ApiError ? err.message : 'The file could not be uploaded.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  /** Downloads a sheet an answer offers (with the session; a plain link would be refused). */
  const download = async (d: AgentDownload) => {
    try { await api.downloadProtectedFile(d.path, d.filename); } catch (err) {
      setVoiceNote(err instanceof ApiError ? err.message : 'That file could not be downloaded.');
    }
  };

  /**
   * Sends one message (typed, or a sheet with or without words). Shared by the
   * form and by the website hand-off of a WhatsApp import (?import=<file id>).
   */
  const sendMessage = async (typed: string, sheet: { fileId: string; name: string } | null) => {
    const text = typed.trim() || (sheet ? 'Check this file' : '');
    if (!text || busy) return;
    const userMsg: Msg = { role: 'user', text, ...(sheet && { attachment: { name: sheet.name } }) };
    msgsRef.current = [...msgsRef.current, userMsg];
    setInput(''); setAttached(null); setMsgs([...msgsRef.current]); setBusy(true);
    try {
      const history = msgsRef.current
        .slice(0, -1)
        .slice(-HISTORY_TURNS)
        .map((m) => ({ role: m.role, text: m.text }));
      const res = await api.agentAsk(text, speechLang.lang, history, convIdRef.current, sheet ? { fileId: sheet.fileId } : undefined);
      if (res.conversationId) convIdRef.current = res.conversationId;
      const aiMsg: Msg = { role: 'assistant', text: res.reply, action: res.action, continuation: res.continuation ?? null, evidence: res.evidence ?? [], ui: uiOf(res), downloads: downloadsOf(res), nextSteps: nextStepsOf(res) };
      msgsRef.current = [...msgsRef.current, aiMsg];
      setMsgs([...msgsRef.current]);
    } catch (err) {
      const reason = err instanceof ApiError && err.status === 403
        ? err.message
        : 'Sorry — I could not reach the assistant just now.';
      msgsRef.current = [...msgsRef.current, { role: 'assistant', text: reason }];
      setMsgs([...msgsRef.current]);
    } finally { setBusy(false); }
  };

  // A WhatsApp import is confirmed here: its link opens the assistant with the
  // file attached (?import=<file id>), and the preview comes back as a draft.
  const importHandled = useRef(false);
  useEffect(() => {
    if (importHandled.current || !profileId || restoredFor.current !== profileId || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const fileId = params.get('import');
    if (!fileId || !/^[a-f0-9]{24}$/.test(fileId)) return;
    importHandled.current = true;
    params.delete('import');
    const rest = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
    setMinimized(false);
    setOpen(true);
    void sendMessage('Review the file I sent on WhatsApp', { fileId, name: 'file from WhatsApp' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, msgs]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (attached) { await sendMessage(input, attached); return; }
    const text = input.trim();
    if (!text || busy) return;
    const userMsg: Msg = { role: 'user', text };
    msgsRef.current = [...msgsRef.current, userMsg];
    setInput(''); setMsgs([...msgsRef.current]); setBusy(true);
    try {
      // The agent endpoint answers questions AND proposes actions; anything
      // that writes comes back as `action` and is only performed once the
      // user confirms the summary below.
      // The turns before this one, so "what about last month?" and "mark him
      // present" resolve against what was just said instead of being asked
      // back. `slice(0, -1)` drops the message being sent, which is already in
      // the ref. Identity is not in here and never needs to be: the server
      // knows who is asking from the session.
      const history = msgsRef.current
        .slice(0, -1)
        .slice(-HISTORY_TURNS)
        .map((m) => ({ role: m.role, text: m.text }));
      // Sent exactly as the microphone heard it: marked as spoken (p7).
      const spoken = dictatedRef.current !== null && dictatedRef.current === text;
      dictatedRef.current = null;
      const res = await api.agentAsk(text, speechLang.lang, history, convIdRef.current, undefined, spoken ? { inputMode: 'voice' } : undefined);
      if (res.conversationId) convIdRef.current = res.conversationId;
      const aiMsg: Msg = { role: 'assistant', text: res.reply, action: res.action, continuation: res.continuation ?? null, evidence: res.evidence ?? [], ui: uiOf(res), nextSteps: nextStepsOf(res) };
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

  /**
   * The next rows of a long answer. The server sends a list a window at a time
   * (1–1000, 1001–2000, …); each window arrives as the next message, numbered
   * on from the last, and offers the following one until every row the person
   * may see has been shown. The token is handed back untouched -- the server
   * checks it is this person's and re-authorizes the read.
   */
  const loadMore = async (idx: number) => {
    const msg = msgsRef.current[idx];
    if (!msg?.continuation || busy) return;
    setBusy(true);
    try {
      const res = await api.agentContinue(msg.continuation.token, speechLang.lang);
      msgsRef.current = msgsRef.current.map((m, i) => (i === idx ? { ...m, continuation: null } : m));
      msgsRef.current = [...msgsRef.current, { role: 'assistant', text: res.reply, continuation: res.continuation ?? null, evidence: res.evidence ?? [], ui: uiOf(res) }];
      setMsgs([...msgsRef.current]);
    } catch (err) {
      const text = err instanceof ApiError ? err.message : 'Sorry — I could not load the rest just now.';
      msgsRef.current = [...msgsRef.current, { role: 'assistant', text }];
      setMsgs([...msgsRef.current]);
    } finally { setBusy(false); }
  };

  /** Confirms or declines a proposed write. */
  const resolveAction = async (idx: number, accept: boolean) => {
    const msg = msgsRef.current[idx];
    if (!msg?.action || busy) return;
    setBusy(true);
    try {
      const res = await api.agentConfirm(msg.action.confirmToken, accept, speechLang.lang, convIdRef.current);
      msgsRef.current = msgsRef.current.map((m, i) =>
        i === idx ? { ...m, action: null, resolved: accept ? 'done' : 'cancelled' } : m
      );
      msgsRef.current = [...msgsRef.current, { role: 'assistant', text: res.reply, downloads: downloadsOf(res) }];
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
    stopSpeaking();
    const stop = startDictation(speechLang.code, {
      onPartial: (t) => setInput(t),
      // Placed in the box, not sent: the person sees what was heard and sends it (or corrects it).
      onFinal: (t) => { setInput(t); dictatedRef.current = t.trim(); },
      onError: (m) => { setVoiceNote(m); setListening(false); },
      onEnd: () => { setListening(false); stopRef.current = null; },
    });
    if (!stop) { setVoiceNote('Voice input is not available in this browser. Try Chrome, Edge or Safari, or type your question — you can still choose the reply language here.'); return; }
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

  // p7: every role can start from "what needs me today" (tasks, decisions, registers, drafts, reminders).
  suggestions = ['What needs me today?', ...suggestions].slice(0, 4);

  const handleSuggestionClick = (sText: string) => {
    setInput(sText);
  };

  return (
    <>
      <Button onClick={handleOpen} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 14 }} aria-hidden="true">✨</span> <span className="ask-label">{label}</span>
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
                {msgs.length > 0 && (
                  <button
                    type="button"
                    className="ai-minimize ai-new-chat"
                    onClick={newChat}
                    disabled={busy}
                    aria-label="Start a new chat"
                    title="New chat"
                  >
                    ＋
                  </button>
                )}
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
            <div className="ai-body" ref={scrollRef} role="log" aria-live="polite" aria-relevant="additions">
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
                  <p className="ai-empty-title">Suggested questions</p>
                  <ul className="ai-suggestions">
                    {suggestions.map((sText, idx) => (
                      <li key={idx}>
                        <button type="button" className="ai-suggestion" onClick={() => handleSuggestionClick(sText)}>
                          {sText}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={`ai-msg ${m.role}`}>
                  {/* The assistant's replies are formatted on the server (headings,
                      labelled figures, tables) and rendered here as Markdown --
                      as React elements, never as HTML. The person's own words
                      are shown exactly as typed. */}
                  <div className="ai-bubble">
                    {m.role === 'assistant'
                      ? (m.ui && !m.showText
                        ? <GenUiPanel compact ui={m.ui} fallback={<ChatMarkdown text={m.text} />} onAsk={(t) => { setInput(t.slice(0, 300)); inputRef.current?.focus(); }} />
                        : <ChatMarkdown text={m.text} />)
                      : (<>{m.attachment && <span className="ai-attachment-chip" aria-label={`Attached ${m.attachment.name}`}>📎 {m.attachment.name}</span>}{m.text}</>)}
                  </div>
                  {m.role === 'assistant' && !!m.downloads?.length && (
                    <div className="ai-downloads" role="group" aria-label="Files to download">
                      {m.downloads.map((d) => (
                        <button key={d.path} type="button" className="ai-read-more ai-download" onClick={() => void download(d)}>
                          ⬇ {d.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {m.role === 'assistant' && canSpeak && m.text && (
                    <button
                      type="button"
                      className="ai-read-more"
                      onClick={() => speak(m.text, speechLang.code)}
                      aria-label={`Read this answer aloud in ${speechLang.label}`}
                    >
                      🔈 Listen
                    </button>
                  )}
                  {m.role === 'assistant' && m.ui && (
                    <button
                      type="button"
                      className="ai-read-more genui-toggle"
                      aria-pressed={!!m.showText}
                      onClick={() => { msgsRef.current = msgsRef.current.map((x, j) => (j === i ? { ...x, showText: !x.showText } : x)); setMsgs([...msgsRef.current]); }}
                    >
                      {m.showText ? 'Show as panel' : 'Show as text'}
                    </button>
                  )}
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
                  {/* A generated panel carries its own "Based on" footer. */}
                  {m.role === 'assistant' && !!m.evidence?.length && (!m.ui || m.showText) && <EvidenceFooter items={m.evidence} />}
                  {m.continuation && (
                    <button
                      type="button"
                      className="ai-read-more ai-load-more"
                      disabled={busy}
                      onClick={() => void loadMore(i)}
                    >
                      Load more{' '}
                      <span className="ai-read-more-count">
                        ({m.continuation.next.from}–{m.continuation.next.to}
                        {m.continuation.total != null ? ` of ${m.continuation.total}` : ''})
                      </span>
                    </button>
                  )}
                  {m.resolved && (
                    <div className="ai-tools">{m.resolved === 'done' ? '✓ confirmed' : '✕ cancelled'}</div>
                  )}
                  {/* p7: suggested next steps, on the latest answer only. Tapping sends the question; nothing runs without its own draft. */}
                  {m.role === 'assistant' && i === msgs.length - 1 && !!m.nextSteps?.length && (
                    <div className="ai-next-steps" role="group" aria-label="Suggested next steps">
                      {m.nextSteps.map((s) => (
                        <button key={s.ask} type="button" className="ai-next-step" disabled={busy} onClick={() => void sendMessage(s.ask, null)}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {busy && <div className="ai-msg assistant"><div className="ai-bubble ai-typing"><Spinner /><span className="sr-only">Assistant is replying</span></div></div>}
            </div>
            {voiceNote && <div className="ai-voice-note" role="status">{voiceNote}</div>}
            {attached && (
              <div className="ai-attached" role="status">
                <span>📎 {attached.name} — say what it is, or just send</span>
                <button type="button" className="ai-attached-remove" aria-label={`Remove ${attached.name}`} onClick={() => setAttached(null)}>×</button>
              </div>
            )}
            <form className="ai-input" onSubmit={send}>
              <input
                ref={fileRef}
                type="file"
                accept={SHEET_TYPES}
                hidden
                aria-hidden="true"
                tabIndex={-1}
                onChange={(e) => void attachSheet(e.target.files?.[0])}
              />
              <button
                type="button"
                className="ai-mic ai-attach"
                onClick={() => fileRef.current?.click()}
                disabled={busy || uploading}
                aria-label={uploading ? 'Uploading the spreadsheet' : 'Attach a spreadsheet to import (CSV or Excel)'}
                title="Attach a spreadsheet (CSV or Excel) to import"
              >
                {uploading ? '…' : '📎'}
              </button>
              {/* p7: always offered -- the language also decides the reply
                  language; where the browser has no speech recognition the
                  microphone explains that instead of disappearing. */}
              {(
                <>
                  <label className="sr-only" htmlFor="ai-speech-lang">Voice and reply language</label>
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
                    aria-label={!voiceAvailable ? 'Voice input is not supported in this browser' : listening ? 'Stop dictation' : `Speak your question in ${speechLang.label}`}
                    title={!voiceAvailable ? 'Voice input is not supported in this browser' : undefined}
                    aria-pressed={listening}
                  >
                    {listening ? '■' : '🎤'}
                  </button>
                  {canSpeak && (
                    <button
                      type="button"
                      className={cx('ai-mic', readAloud && 'listening')}
                      onClick={toggleReadAloud}
                      aria-pressed={readAloud}
                      aria-label={readAloud ? 'Stop reading answers aloud' : `Read answers aloud in ${speechLang.label}`}
                      title={readAloud ? 'Reading answers aloud' : 'Read answers aloud'}
                    >
                      {readAloud ? '🔊' : '🔈'}
                    </button>
                  )}
                </>
              )}
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={listening ? 'Listening…' : attached ? 'What is this sheet? (optional)' : 'Ask anything…'}
                disabled={busy}
                aria-label="Message input"
              />
              <Button type="submit" disabled={busy || uploading || (!input.trim() && !attached)}>Send</Button>
            </form>
          </div>
        </aside>
      )}
    </>
  );
}
