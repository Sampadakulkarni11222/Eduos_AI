'use client';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { api, ApiError, errorMessage, fileHref } from '@/lib/api';
import { opsApi } from '@/lib/ops-api';
import type { AttendanceRoster } from '@/lib/types';
import { Button, Modal, cx } from '@/components/ui';
import {
  type CardStatus, type DeckState, type DeckStudent,
  clear, counts, draftEntries, entryOf, goBack, initDeck, initials, jumpTo, mark, pass,
  revisitPassed, search, submission, undo,
} from './flashcard-logic';

/**
 * Attendance flashcards — an additional way to mark the same register.
 *
 * One student per card with large Present / Absent / Pass / Go back controls,
 * keyboard shortcuts and optional swipes. Progress is saved as a server draft
 * (and mirrored on this device while offline) and becomes attendance only on
 * Review → Submit, through the same /attendance/mark the list view uses.
 */

type Action =
  | { type: 'init'; state: DeckState }
  | { type: 'mark'; status: CardStatus }
  | { type: 'pass' } | { type: 'back' } | { type: 'clear' } | { type: 'undo' } | { type: 'revisit' }
  | { type: 'jump'; index: number };

function reducer(state: DeckState, action: Action): DeckState {
  switch (action.type) {
    case 'init': return action.state;
    case 'mark': return mark(state, action.status);
    case 'pass': return pass(state);
    case 'back': return goBack(state);
    case 'clear': return clear(state);
    case 'undo': return undo(state);
    case 'revisit': return revisitPassed(state);
    case 'jump': return jumpTo(state, action.index);
    default: return state;
  }
}

type SyncState = 'loading' | 'idle' | 'saving' | 'saved' | 'offline' | 'conflict' | 'error';

const LOCAL_TTL_MS = 24 * 3600_000;
const localKey = (sid: string, date: string, p: number | null) => `eduos.attdraft.${sid}.${date}.${p ?? 'day'}`;

interface LocalCopy { savedAt: number; version: number; cursor: number; entries: Array<{ enrollmentId: string; status: CardStatus | null; passed: boolean }> }

function readLocal(key: string): LocalCopy | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as LocalCopy;
    if (!v || Date.now() - v.savedAt > LOCAL_TTL_MS) { localStorage.removeItem(key); return null; }
    return v;
  } catch { return null; }
}
function writeLocal(key: string, v: LocalCopy | null) {
  try { if (v) localStorage.setItem(key, JSON.stringify(v)); else localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

const STATUS_LABEL: Record<string, string> = { PRESENT: 'Present', ABSENT: 'Absent', LATE: 'Late', EXCUSED: 'Excused' };

export function FlashcardDeck({ data, date, periodNo, onSubmitted }: {
  data: AttendanceRoster;
  date: string;
  periodNo: number | null;
  onSubmitted: (roster: AttendanceRoster) => void;
}) {
  const students: DeckStudent[] = useMemo(() => data.roster.map((r) => ({
    enrollmentId: r.enrollmentId, rollNo: r.rollNo, studentName: r.studentName,
    admissionNo: r.admissionNo ?? null, photoUrl: r.photoUrl ?? null,
    recorded: (r.status as DeckStudent['recorded']) ?? null,
  })), [data.roster]);
  const sectionId = data.section.id;
  const readOnly = data.canMark === false;
  const lkey = localKey(sectionId, date, periodNo);

  const [state, dispatch] = useReducer(reducer, students, (s) => initDeck(s));
  const [sync, setSync] = useState<SyncState>('loading');
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [rosterNote, setRosterNote] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [ackPartial, setAckPartial] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const versionRef = useRef(0);
  const readyRef = useRef(false);
  const submittingRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── load: server draft, reconciled with any unsynced copy on this device ──
  const load = useCallback(async () => {
    readyRef.current = false;
    setSync('loading'); setSyncMsg(null);
    const local = readLocal(lkey);
    try {
      const server = await opsApi.attendanceDraft(sectionId, date, periodNo);
      versionRef.current = server?.version ?? 0;
      if (server?.rosterChanges && (server.rosterChanges.added.length || server.rosterChanges.removed.length)) {
        setRosterNote(`The class list changed since this draft began: ${server.rosterChanges.added.length} added, ${server.rosterChanges.removed.length} removed. New students start unmarked.`);
      } else setRosterNote(null);
      // A local copy based on the same server version but saved later holds
      // changes that never reached the server (made offline). Anything else
      // defers to the server, which is the shared truth.
      const useLocal = local && local.version === (server?.version ?? 0) && (!server || local.savedAt > new Date(server.updatedAt).getTime());
      const source = useLocal ? local : server;
      dispatch({ type: 'init', state: initDeck(students, source ? { entries: source.entries, cursor: source.cursor } : null) });
      if (local && !useLocal && server && local.version < server.version) {
        setSyncMsg('A newer copy of this register was saved on another device, so that copy was loaded.');
      }
      setSync(useLocal ? 'idle' : 'saved');
    } catch (err) {
      if (err instanceof ApiError && err.status !== 0 && err.status < 500) {
        setSync('error'); setSyncMsg(errorMessage(err, 'Could not load the draft.'));
        dispatch({ type: 'init', state: initDeck(students, null) });
      } else {
        // Offline / server down: work from this device and sync later.
        dispatch({ type: 'init', state: initDeck(students, local ? { entries: local.entries, cursor: local.cursor } : null) });
        versionRef.current = local?.version ?? 0;
        setSync('offline');
      }
    } finally {
      readyRef.current = true;
    }
  }, [lkey, sectionId, date, periodNo, students]);

  useEffect(() => { void load(); }, [load]);

  // ── autosave (debounced), with a local mirror for offline resilience ──
  const entriesKey = JSON.stringify(draftEntries(state));
  useEffect(() => {
    if (!readyRef.current || readOnly || sync === 'conflict' || submittingRef.current) return;
    const entries = JSON.parse(entriesKey) as LocalCopy['entries'];
    writeLocal(lkey, { savedAt: Date.now(), version: versionRef.current, cursor: state.index, entries });
    const t = window.setTimeout(async () => {
      if (submittingRef.current) return;
      setSync('saving');
      try {
        const saved = await opsApi.saveAttendanceDraft({ sectionId, date, periodNo, version: versionRef.current, cursor: state.index, entries });
        versionRef.current = saved.version;
        writeLocal(lkey, { savedAt: Date.now(), version: saved.version, cursor: state.index, entries });
        setSync('saved');
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setSync('conflict');
          setSyncMsg(errorMessage(err, 'This register changed on another device.'));
        } else if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
          setSync('error'); setSyncMsg(errorMessage(err, 'Draft could not be saved.'));
        } else setSync('offline');
      }
    }, 700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- entriesKey/state.index capture the draft
  }, [entriesKey, state.index]);

  // Retry once connectivity returns.
  useEffect(() => {
    const onOnline = () => { if (sync === 'offline') void load(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [sync, load]);

  const c = counts(state);
  const current = state.students[state.index];
  const currentEntry = current ? entryOf(state, current.enrollmentId) : null;
  const matches = useMemo(() => search(state, query), [state, query]);
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // ── keyboard ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || reviewing || readOnly) return;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); dispatch({ type: 'undo' }); }
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'p') dispatch({ type: 'mark', status: 'PRESENT' });
      else if (k === 'a') dispatch({ type: 'mark', status: 'ABSENT' });
      else if (k === 's' || k === ' ') { e.preventDefault(); dispatch({ type: 'pass' }); }
      else if (k === 'arrowleft' || k === 'backspace' || k === 'b') { e.preventDefault(); dispatch({ type: 'back' }); }
      else if (k === 'arrowright') { e.preventDefault(); dispatch({ type: 'jump', index: state.index + 1 }); }
      else if (k === 'u') dispatch({ type: 'undo' });
      else if (k === 'c') dispatch({ type: 'clear' });
      else if (k === 'r') setReviewing(true);
      else if (k === '/') { e.preventDefault(); searchRef.current?.focus(); }
      else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reviewing, readOnly, state.index]);

  // ── optional swipe: right = Present, left = Absent (buttons remain the primary control) ──
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const [dragX, setDragX] = useState(0);
  const onPointerDown = (e: React.PointerEvent) => { if (!readOnly && e.pointerType !== 'mouse') swipeStart.current = { x: e.clientX, y: e.clientY }; };
  const onPointerMove = (e: React.PointerEvent) => { if (swipeStart.current) setDragX(e.clientX - swipeStart.current.x); };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = swipeStart.current; swipeStart.current = null; setDragX(0);
    if (!start) return;
    const dx = e.clientX - start.x; const dy = e.clientY - start.y;
    if (Math.abs(dx) > 90 && Math.abs(dx) > Math.abs(dy) * 1.5) dispatch({ type: 'mark', status: dx > 0 ? 'PRESENT' : 'ABSENT' });
  };

  const submit = async () => {
    if (submittingRef.current || readOnly) return;
    const entries = submission(state);
    if (!entries.length) { setSubmitErr('Mark at least one student before submitting.'); return; }
    if (c.pending > 0 && !ackPartial) { setSubmitErr('Confirm that the unresolved students will stay unmarked, or go back and mark them.'); return; }
    submittingRef.current = true; setSubmitting(true); setSubmitErr(null);
    try {
      const updated = await api.markAttendance({ sectionId, date, ...(periodNo !== null && { periodNo }), entries });
      await opsApi.discardAttendanceDraft(sectionId, date, periodNo).catch(() => { /* the draft expires on its own */ });
      writeLocal(lkey, null);
      versionRef.current = 0;
      setReviewing(false);
      onSubmitted(updated);
    } catch (err) {
      setSubmitErr(errorMessage(err, 'Submission failed. Your marks are still saved as a draft.'));
    } finally {
      submittingRef.current = false; setSubmitting(false);
    }
  };

  const discard = async () => {
    if (!window.confirm('Discard this draft? Marks already submitted to the register are not affected.')) return;
    await opsApi.discardAttendanceDraft(sectionId, date, periodNo).catch(() => undefined);
    writeLocal(lkey, null);
    versionRef.current = 0;
    dispatch({ type: 'init', state: initDeck(students, null) });
    setSync('saved'); setSyncMsg(null);
  };

  if (!students.length) return null;

  const pct = c.total ? Math.round((c.marked / c.total) * 100) : 0;
  const syncLabel: Record<SyncState, string> = {
    loading: 'Loading draft…', idle: 'Unsaved changes', saving: 'Saving draft…', saved: 'Draft saved',
    offline: 'Offline — saved on this device', conflict: 'Changed on another device', error: 'Not saved',
  };

  return (
    <div className="fc-wrap">
      {/* Progress & counts — mutually consistent: marked + passed + unseen = total. */}
      <div className="fc-progress" role="status" aria-live="polite">
        <div className="fc-progress-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
        <div className="fc-counts">
          <span><b>{c.marked}</b>/{c.total} marked</span>
          <span className="fc-dot fc-dot-present">{c.present} present</span>
          <span className="fc-dot fc-dot-absent">{c.absent} absent</span>
          {(c.late + c.excused) > 0 && <span>{c.late} late · {c.excused} excused</span>}
          <span className="fc-dot fc-dot-pending">{c.pending} pending{c.passed ? ` (${c.passed} passed)` : ''}</span>
          <span className={cx('fc-sync', `fc-sync-${sync}`)}>{syncLabel[sync]}</span>
        </div>
      </div>

      {syncMsg && (
        <p className={cx('fc-banner', sync === 'conflict' || sync === 'error' ? 'is-error' : 'is-info')} role="alert">
          {syncMsg}{' '}
          {sync === 'conflict' && <button type="button" className="fc-link" onClick={() => void load()}>Load the latest copy</button>}
        </p>
      )}
      {rosterNote && <p className="fc-banner is-info">{rosterNote}</p>}
      {readOnly && <p className="att-locked" role="status">You can view this register but only its teacher can mark it.</p>}

      <div className="fc-layout">
        <div className="fc-stage">
          {current && currentEntry && (
            <div
              className={cx('fc-card', currentEntry.status && `is-${currentEntry.status.toLowerCase()}`, currentEntry.passed && 'is-passed')}
              style={{ transform: dragX && !reduceMotion ? `translateX(${dragX}px) rotate(${dragX / 30}deg)` : undefined }}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { swipeStart.current = null; setDragX(0); }}
              aria-label={`Card ${state.index + 1} of ${c.total}: ${current.studentName}`}
            >
              <div className="fc-card-top">
                <span className="fc-pos">{state.index + 1} / {c.total}</span>
                {current.recorded && <span className="fc-recorded" title="Already in the submitted register">Register: {STATUS_LABEL[current.recorded] ?? current.recorded}</span>}
              </div>
              <div className="fc-photo" aria-hidden="true">
                {current.photoUrl ? <img src={fileHref(current.photoUrl)} alt="" /> : <span>{initials(current.studentName)}</span>}
              </div>
              <h2 className="fc-name">{current.studentName}</h2>
              <p className="fc-meta">
                Roll {current.rollNo ?? '—'}
                {current.admissionNo && <> · {current.admissionNo}</>}
                {' · '}{data.section.name}{data.subject ? ` · ${data.subject}` : ''}
              </p>
              <p className="fc-choice" aria-live="polite">
                {currentEntry.status ? <>Marked <b>{STATUS_LABEL[currentEntry.status]}</b></>
                  : currentEntry.passed ? <>Passed — still to mark</> : <>Not marked yet</>}
              </p>
            </div>
          )}

          <div className="fc-controls">
            <button type="button" className="fc-btn fc-btn-back" onClick={() => dispatch({ type: 'back' })} disabled={readOnly && state.index === 0} aria-keyshortcuts="ArrowLeft">
              ← Go back
            </button>
            <button type="button" className="fc-btn fc-btn-absent" onClick={() => dispatch({ type: 'mark', status: 'ABSENT' })} disabled={readOnly} aria-keyshortcuts="A">
              Absent
            </button>
            <button type="button" className="fc-btn fc-btn-present" onClick={() => dispatch({ type: 'mark', status: 'PRESENT' })} disabled={readOnly} aria-keyshortcuts="P">
              Present
            </button>
            <button type="button" className="fc-btn fc-btn-pass" onClick={() => dispatch({ type: 'pass' })} disabled={readOnly} aria-keyshortcuts="S">
              Pass →
            </button>
          </div>
          <div className="fc-secondary">
            <button type="button" className="fc-link" onClick={() => dispatch({ type: 'mark', status: 'LATE' })} disabled={readOnly}>Late</button>
            <button type="button" className="fc-link" onClick={() => dispatch({ type: 'mark', status: 'EXCUSED' })} disabled={readOnly}>Excused</button>
            <button type="button" className="fc-link" onClick={() => dispatch({ type: 'clear' })} disabled={readOnly || !currentEntry?.status}>Clear mark</button>
            <button type="button" className="fc-link" onClick={() => dispatch({ type: 'undo' })} disabled={readOnly || !state.undo.length}>Undo</button>
            {c.passed > 0 && <button type="button" className="fc-link" onClick={() => dispatch({ type: 'revisit' })}>Revisit passed ({c.passed})</button>}
          </div>
          <p className="fc-help">
            Keys: <kbd>P</kbd> present · <kbd>A</kbd> absent · <kbd>S</kbd>/<kbd>Space</kbd> pass · <kbd>←</kbd> go back · <kbd>U</kbd> undo · <kbd>C</kbd> clear · <kbd>/</kbd> search · <kbd>R</kbd> review.
            On touch screens you can also swipe right for present, left for absent.
          </p>
        </div>

        <aside className="fc-side" aria-label="Deck navigation">
          <label className="fc-search">
            <span className="sr-only">Find a student</span>
            <input ref={searchRef} className="input" placeholder="Find by name, roll or admission no." value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && matches[0] !== undefined) { dispatch({ type: 'jump', index: matches[0] }); setQuery(''); (e.target as HTMLInputElement).blur(); } }} />
          </label>
          {query && (
            <ul className="fc-results">
              {matches.slice(0, 8).map((i) => (
                <li key={state.students[i].enrollmentId}>
                  <button type="button" onClick={() => { dispatch({ type: 'jump', index: i }); setQuery(''); }}>
                    {state.students[i].rollNo ?? '—'} · {state.students[i].studentName}
                  </button>
                </li>
              ))}
              {!matches.length && <li className="fc-none">No match</li>}
            </ul>
          )}
          <ol className="fc-strip" aria-label="All students">
            {state.students.map((s, i) => {
              const e = entryOf(state, s.enrollmentId);
              return (
                <li key={s.enrollmentId}>
                  <button type="button" onClick={() => dispatch({ type: 'jump', index: i })}
                    className={cx('fc-chip', i === state.index && 'is-current', e.status && `is-${e.status.toLowerCase()}`, e.passed && 'is-passed')}
                    aria-current={i === state.index ? 'true' : undefined}
                    title={`${s.studentName}: ${e.status ? STATUS_LABEL[e.status] : e.passed ? 'passed' : 'not marked'}`}>
                    {s.rollNo ?? i + 1}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="fc-side-actions">
            <Button onClick={() => setReviewing(true)} disabled={readOnly}>Review &amp; submit</Button>
            <Button variant="soft" small onClick={() => void discard()} disabled={readOnly}>Discard draft</Button>
          </div>
          <p className="fc-note">Nothing is recorded or sent to families until you submit. Passed and unseen students are never marked automatically.</p>
        </aside>
      </div>

      {reviewing && (
        <Modal title="Review before submitting" onClose={() => setReviewing(false)} wide
          footer={<>
            <Button variant="soft" onClick={() => setReviewing(false)}>Keep marking</Button>
            <Button onClick={() => void submit()} disabled={submitting || c.marked === 0 || (c.pending > 0 && !ackPartial)}>
              {submitting ? 'Submitting…' : `Submit ${c.marked} to the register`}
            </Button>
          </>}>
          <p><b>{c.present}</b> present · <b>{c.absent}</b> absent{c.late ? <> · <b>{c.late}</b> late</> : null}{c.excused ? <> · <b>{c.excused}</b> excused</> : null} · <b>{c.pending}</b> unresolved, of {c.total}.</p>
          {c.absent > 0 && (
            <div className="fc-review-block">
              <h3 className="fc-review-h">Absent</h3>
              <ul className="fc-review-list">
                {state.students.filter((s) => entryOf(state, s.enrollmentId).status === 'ABSENT').map((s) => (
                  <li key={s.enrollmentId}>{s.rollNo ?? '—'} · {s.studentName}</li>
                ))}
              </ul>
            </div>
          )}
          {c.pending > 0 && (
            <div className="fc-review-block">
              <h3 className="fc-review-h">Unresolved ({c.pending})</h3>
              <p className="fc-note">These students will <b>not</b> be marked present or absent. Their register entry stays empty until someone marks them.</p>
              <ul className="fc-review-list">
                {state.students.map((s, i) => ({ s, i, e: entryOf(state, s.enrollmentId) })).filter(({ e }) => !e.status).map(({ s, i, e }) => (
                  <li key={s.enrollmentId}>
                    <button type="button" className="fc-link" onClick={() => { dispatch({ type: 'jump', index: i }); setReviewing(false); }}>
                      {s.rollNo ?? '—'} · {s.studentName}
                    </button> <span className="fc-tag">{e.passed ? 'passed' : 'not seen'}</span>
                  </li>
                ))}
              </ul>
              <label className="fc-ack">
                <input type="checkbox" checked={ackPartial} onChange={(e) => setAckPartial(e.target.checked)} />
                Submit the {c.marked} marked students and leave {c.pending} unmarked
              </label>
            </div>
          )}
          {submitErr && <p className="fc-banner is-error" role="alert">{submitErr}</p>}
        </Modal>
      )}
    </div>
  );
}
