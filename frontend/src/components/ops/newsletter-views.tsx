'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, EmptyState, Field, Modal, cx, useToast } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { usePermissions } from '@/lib/permissions';
import { errorMessage } from '@/lib/api';
import {
  newsletterApi, REACTIONS, OPP_TYPES, OPP_LEVELS, OPP_DOMAINS, DOMAIN_LABELS,
  type Edition, type EditionSummary, type Flashcard, type MatchGroup, type Opportunity, type Preferences, type QuizQuestion, type PollResults, type Reaction, type Verdict, type EligibilityOut,
} from '@/lib/newsletter-api';
import { DataNote, ErrorNote, Loadable, PromptModal, SectionCard, StatusPill, Tabs, Tile, fmtDate, fmtDateTime, humanize, useAction, useLoad, useQueryParam } from './kit';
import { SixtySeconds, DeadlineRadar, BadgeStrip, ChallengeBlock, SectionNoteLine, ExtractionDetails, RegenerateBar, DeskAlerts } from './newsletter-ai-views';

/**
 * Opportunities and the weekly / monthly newsletter.
 *
 *   NewsletterView      readers (students, parents, teachers, every portal): the
 *                       interactive edition (hook, matches with reasons, items
 *                       with Save / Remind / Calendar / Can I enter? / Ask a
 *                       teacher, flashcards, quiz, poll, map, spotlight,
 *                       comments), For you, Explore, Flashcards, Saved,
 *                       Questions and Settings.
 *   NewsletterDeskView  the editor (digest.manage): review queue, catalogue,
 *                       editions (draft, edit, publish with one press,
 *                       withdraw), comment moderation, official sites,
 *                       analytics.
 *
 * Everything is checked again by the server; these screens explain refusals.
 */

const isOff = (error: string | null) => Boolean(error && /switched off/i.test(error));
const LABELS = {
  en: {
    forYou: 'Picked for you', closing: 'Closing soon', items: 'This edition', cards: 'Flashcards', quiz: 'Quick quiz', poll: 'Have your say', map: "This month's map",
    spotlight: 'Our school in the spotlight', comments: 'Comments', save: 'Save', saved: 'Saved', remind: 'Remind me', calendar: 'Add to calendar', canEnter: 'Can I enter?',
    ask: 'Ask a teacher', site: 'Official site', knew: 'I knew it', again: 'Review again', flip: 'Tap to flip', submit: 'Check my answers', vote: 'Vote',
    progress: 'read', continue: 'Continue where you left off', days: (n: number) => (n === 0 ? 'Closes today' : `${n} day${n === 1 ? '' : 's'} left`), howTo: 'How to apply',
  },
  hi: {
    forYou: 'आपके लिए चुने गए', closing: 'जल्द बंद हो रहे हैं', items: 'इस अंक में', cards: 'फ़्लैशकार्ड', quiz: 'छोटी प्रश्नोत्तरी', poll: 'अपनी राय दें', map: 'इस महीने का नक्शा',
    spotlight: 'हमारे विद्यालय की उपलब्धियाँ', comments: 'टिप्पणियाँ', save: 'सहेजें', saved: 'सहेजा गया', remind: 'याद दिलाएँ', calendar: 'कैलेंडर में जोड़ें', canEnter: 'क्या मैं भाग ले सकता/सकती हूँ?',
    ask: 'शिक्षक से पूछें', site: 'आधिकारिक वेबसाइट', knew: 'मुझे पता था', again: 'फिर से देखें', flip: 'पलटने के लिए छुएँ', submit: 'उत्तर जाँचें', vote: 'वोट दें',
    progress: 'पढ़ा', continue: 'जहाँ छोड़ा था वहीं से पढ़ें', days: (n: number) => (n === 0 ? 'आज बंद' : `${n} दिन बाकी`), howTo: 'आवेदन कैसे करें',
  },
} as const;
type Lang = keyof typeof LABELS;
type L = (typeof LABELS)[Lang];
const VERDICT_TEXT: Record<Verdict, string> = { YES: 'Yes', NO: 'Not this time', CHECK: 'Check the rules' };
const VERDICT_TONE: Record<Verdict, string> = { YES: 'APPROVED', NO: 'REJECTED', CHECK: 'PENDING' };

function useKids(isParent: boolean) {
  const [kids, setKids] = useState<Array<{ studentId: string; name: string }>>([]);
  useEffect(() => {
    if (!isParent) return;
    newsletterApi.matches().then((m) => setKids(m.contexts.filter((c) => c.studentId).map((c) => ({ studentId: c.studentId as string, name: c.name ?? 'Child' })))).catch(() => setKids([]));
  }, [isParent]);
  return kids;
}

function downloadText(filename: string, text: string, type = 'text/calendar') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function Countdown({ days, l }: { days: number | null; l: L }) {
  if (days === null) return null;
  return <span className={cx('nl-countdown', days <= 3 && 'is-urgent')}>{l.days(days)}</span>;
}

// ── one opportunity ────────────────────────────────────────────────────

function OpportunityCard({ o, l, editionId, kids, reactions, onReact, compact }: {
  o: Opportunity; l: L; editionId?: string; kids: Array<{ studentId: string; name: string }>;
  reactions?: { counts: Record<Reaction, number>; mine: Reaction | null }; onReact?: (kind: Reaction) => void; compact?: boolean;
}) {
  const toast = useToast();
  const { me } = useAuth();
  const role = me?.profile?.role;
  const [saved, setSaved] = useState(Boolean(o.saved));
  const [open, setOpen] = useState(false);
  const [elig, setElig] = useState(false);
  const [ask, setAsk] = useState(false);
  const [forChild, setForChild] = useState(false);
  const { run, busy } = useAction();

  const doSave = (studentId: string | null, remind: boolean) => run(async () => {
    const out = await newsletterApi.save(o.id, { studentId, remind });
    setSaved(true);
    toast(out.reminder ?? 'Saved');
  });
  const pickChild = (remind: boolean) => {
    if (role === 'PARENT' && kids.length > 1) { setForChild(true); return; }
    void doSave(role === 'PARENT' ? kids[0]?.studentId ?? null : null, remind);
  };
  const openSite = () => run(async () => {
    const out = editionId ? await newsletterApi.clickFromEdition(editionId, o.id) : await newsletterApi.click(o.id);
    if (out.officialUrl && /^https:\/\//i.test(out.officialUrl)) window.open(out.officialUrl, '_blank', 'noopener,noreferrer');
  });
  const addCal = () => run(async () => {
    const c = await newsletterApi.calendar(o.id);
    downloadText(c.filename, c.ics);
    toast(c.confirmed ? 'Calendar file downloaded' : 'Dates are not confirmed: the calendar file is a reminder to check them');
  });

  return (
    <article className={cx('nl-opp', compact && 'is-compact')}>
      <div className="nl-opp-head">
        <h3 className="nl-opp-title">{o.title}</h3>
        <Countdown days={o.daysLeft} l={l} />
      </div>
      <p className="nl-opp-meta">{o.typeLabel}, {o.levelLabel.toLowerCase()}{o.organiser ? `, by ${o.organiser}` : ''}</p>
      {o.reason && <p className="nl-reason">{o.reason}</p>}
      {!compact && <p className="nl-opp-summary">{o.summary}</p>}
      <p className={cx('nl-when', !o.datesConfirmed && 'is-unconfirmed')}>{o.dateText}{o.datesConfirmed && o.datesCheckedByName ? ` (checked by ${o.datesCheckedByName})` : ''}</p>
      {!!o.domainLabels.length && <div className="nl-chips">{o.domainLabels.map((d) => <span key={d} className="nl-chip">{d}</span>)}{o.fee && <span className="nl-chip is-plain">Fee: {o.fee}</span>}</div>}
      <div className="nl-actions">
        <Button small variant={saved ? 'soft' : 'accent'} disabled={busy} onClick={() => pickChild(false)}>{saved ? l.saved : l.save}</Button>
        <Button small variant="soft" disabled={busy} onClick={() => pickChild(true)}>{l.remind}</Button>
        <Button small variant="soft" disabled={busy} onClick={() => void addCal()}>{l.calendar}</Button>
        <Button small variant="soft" onClick={() => setElig(true)}>{l.canEnter}</Button>
        {(role === 'STUDENT' || role === 'PARENT') && <Button small variant="soft" onClick={() => setAsk(true)}>{l.ask}</Button>}
        {o.officialUrl && <Button small variant="ghost" disabled={busy} onClick={() => void openSite()}>{l.site}</Button>}
      </div>
      {!compact && (o.howToApply.length > 0 || o.pastWinnerNotes) && (
        <div className="nl-more">
          <button type="button" className="nl-link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? 'Hide details' : l.howTo}</button>
          {open && (
            <div className="nl-more-body">
              {o.howToApply.length > 0 && <ol>{o.howToApply.map((s, i) => <li key={i}>{s}</li>)}</ol>}
              {o.eligibility?.note && <p className="ops-muted">{o.eligibility.note}</p>}
              {o.pastWinnerNotes && <p><b>Past winners:</b> {o.pastWinnerNotes}</p>}
            </div>
          )}
        </div>
      )}
      {reactions && onReact && (
        <div className="nl-reacts" role="group" aria-label="Reactions">
          {REACTIONS.map((r) => (
            <button key={r.key} type="button" className={cx('nl-react', reactions.mine === r.key && 'is-on')} aria-pressed={reactions.mine === r.key} onClick={() => onReact(r.key)}>
              <span aria-hidden="true">{r.icon}</span> {r.label}{reactions.counts[r.key] ? ` ${reactions.counts[r.key]}` : ''}
            </button>
          ))}
        </div>
      )}
      {elig && <EligibilityModal o={o} onClose={() => setElig(false)} />}
      {ask && <AskModal o={o} kids={kids} isParent={role === 'PARENT'} onClose={() => setAsk(false)} />}
      {forChild && (
        <Modal title={`Save "${o.title}" for`} onClose={() => setForChild(false)}>
          <div className="nl-actions">{kids.map((k) => <Button key={k.studentId} onClick={() => { setForChild(false); void doSave(k.studentId, true); }}>{k.name}</Button>)}</div>
        </Modal>
      )}
    </article>
  );
}

function EligibilityModal({ o, onClose }: { o: Opportunity; onClose: () => void }) {
  const auto = useLoad(() => newsletterApi.eligibility(o.id), [o.id]);
  const [grade, setGrade] = useState('');
  const [age, setAge] = useState('');
  const [typed, setTyped] = useState<EligibilityOut | null>(null);
  const { run, busy, error } = useAction();
  const Row = ({ who, verdict, reasons }: { who: string; verdict: Verdict; reasons: string[] }) => (
    <div className="nl-verdict"><div><b>{who}</b> <StatusPill status={VERDICT_TONE[verdict]} label={VERDICT_TEXT[verdict]} /></div><ul>{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
  );
  return (
    <Modal title={`Can I enter "${o.title}"?`} onClose={onClose}>
      <Loadable state={auto}>{(d) => (
        <div className="ops-stack">
          {(d.results ?? (d.verdict ? [{ for: d.for ?? 'you', studentId: null, verdict: d.verdict, reasons: d.reasons ?? [] }] : [])).map((r, i) => <Row key={i} who={r.for} verdict={r.verdict} reasons={r.reasons} />)}
        </div>
      )}</Loadable>
      <div className="ops-form-grid">
        <Field label="Or check a class"><input className="input" inputMode="numeric" value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="e.g. 9" /></Field>
        <Field label="Age"><input className="input" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} placeholder="e.g. 14" /></Field>
      </div>
      <Button small disabled={busy || (!grade && !age)} onClick={() => void run(async () => setTyped(await newsletterApi.eligibility(o.id, { grade: grade || undefined, age: age || undefined })))}>Check</Button>
      {typed?.verdict && <Row who="The details you entered" verdict={typed.verdict} reasons={typed.reasons ?? []} />}
      <ErrorNote error={error} />
      <DataNote>The official rules decide. Ages are usually counted on a cut-off date the organiser sets.</DataNote>
    </Modal>
  );
}

function AskModal({ o, kids, isParent, onClose }: { o: Opportunity; kids: Array<{ studentId: string; name: string }>; isParent: boolean; onClose: () => void }) {
  const toast = useToast();
  const [child, setChild] = useState(kids[0]?.studentId ?? '');
  return (
    <PromptModal title={`Ask a teacher about "${o.title}"`} label="Your question" hint="Your class teacher (and a subject teacher for this topic) will answer in EduOS." confirmLabel="Send question"
      extra={isParent && kids.length > 1 ? <Field label="About"><select className="input" value={child} onChange={(e) => setChild(e.target.value)}>{kids.map((k) => <option key={k.studentId} value={k.studentId}>{k.name}</option>)}</select></Field> : undefined}
      onSubmit={async (text) => { const out = await newsletterApi.ask(o.id, { text, studentId: isParent ? child || null : null }); toast(`Sent to ${out.sentTo.join(', ')}`); }} onClose={onClose} />
  );
}

// ── flashcards ─────────────────────────────────────────────────────────

/** Index cards: tap or press Space to flip; swipe right (or "I knew it") and left (or "Review again"). */
export function FlashcardDeck({ cards, l = LABELS.en, onReviewed }: { cards: Flashcard[]; l?: L; onReviewed?: (streak: { count: number; best: number }) => void }) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [again, setAgain] = useState<Flashcard[]>([]);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const toast = useToast();
  const deck = useMemo(() => [...cards, ...again], [cards, again]);
  const card = deck[i];
  const mark = useCallback(async (result: 'KNEW' | 'REVIEW') => {
    if (!card) return;
    try {
      const out = await newsletterApi.reviewCard(card.key, result);
      onReviewed?.(out.streak);
    } catch (err) { toast(errorMessage(err, 'Could not save that card'), 'error'); }
    if (result === 'REVIEW' && !again.some((c) => c.key === card.key)) setAgain((a) => [...a, card]);
    setFlipped(false); setDrag(0); setI((n) => n + 1);
  }, [card, again, onReviewed, toast]);
  if (!deck.length) return <EmptyState icon="▭" title="No cards yet" sub="Flashcards arrive with each edition. Come back after the next one." />;
  if (!card) {
    return (
      <div className="nl-deck-done">
        <p className="nl-deck-done-title">Deck done.</p>
        <p className="ops-muted">Cards you knew come back later; the ones to review come back tomorrow.</p>
        <Button small variant="soft" onClick={() => { setI(0); setAgain([]); }}>Go through again</Button>
      </div>
    );
  }
  return (
    <div className="nl-deck">
      <p className="nl-deck-count" aria-live="polite">Card {i + 1} of {deck.length}{card.box ? `, box ${card.box} of 5` : ''}</p>
      <div
        className={cx('nl-card', flipped && 'is-flipped')} role="button" tabIndex={0} aria-label={flipped ? `Answer: ${card.back}` : `Question: ${card.front}. ${l.flip}`}
        style={{ transform: drag ? `translateX(${drag}px) rotate(${drag / 30}deg)` : undefined }}
        onClick={() => { if (Math.abs(drag) < 8) setFlipped((f) => !f); }}
        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setFlipped((f) => !f); } if (e.key === 'ArrowRight' && flipped) void mark('KNEW'); if (e.key === 'ArrowLeft' && flipped) void mark('REVIEW'); }}
        onPointerDown={(e) => { start.current = e.clientX; }}
        onPointerMove={(e) => { if (start.current !== null) setDrag(e.clientX - start.current); }}
        onPointerUp={() => { const d = drag; start.current = null; if (d > 90) void mark('KNEW'); else if (d < -90) void mark('REVIEW'); else setDrag(0); }}
        onPointerCancel={() => { start.current = null; setDrag(0); }}
      >
        <div className="nl-card-face nl-card-front"><p>{card.front}</p><span className="nl-card-hint">{l.flip}</span></div>
        <div className="nl-card-face nl-card-back"><p>{card.back}</p>{card.edition && <span className="nl-card-hint">{card.edition}</span>}</div>
      </div>
      <div className="nl-actions nl-deck-actions">
        <Button variant="soft" disabled={!flipped} onClick={() => void mark('REVIEW')}>{l.again}</Button>
        <Button disabled={!flipped} onClick={() => void mark('KNEW')}>{l.knew}</Button>
      </div>
    </div>
  );
}

// ── quiz, poll, comments ───────────────────────────────────────────────

function QuizBlock({ edition, l, onDone }: { edition: Edition; l: L; onDone: () => void }) {
  const [answers, setAnswers] = useState<Array<number | null>>(edition.quiz.questions.map((q) => (q.yourAnswer ?? null)));
  const [result, setResult] = useState<{ score: number; outOf: number; feedback: Array<{ correct: boolean; answerIndex: number; explain: string }> } | null>(null);
  const [optIn, setOptIn] = useState(edition.quiz.boardOptIn);
  const { run, busy, error } = useAction();
  const answered = edition.quiz.answered || Boolean(result);
  const qs: QuizQuestion[] = edition.quiz.questions;
  if (!qs.length) return null;
  const fb = (i: number) => (result ? result.feedback[i] : edition.quiz.answered ? { correct: qs[i].yourAnswer === qs[i].answerIndex, answerIndex: qs[i].answerIndex ?? -1, explain: qs[i].explain ?? '' } : null);
  return (
    <div className="ops-stack">
      {qs.map((q, i) => (
        <fieldset key={q.key} className="nl-q">
          <legend>{i + 1}. {q.question}</legend>
          {q.options.map((opt, j) => {
            const f = fb(i);
            const state = f ? (j === f.answerIndex ? 'is-right' : answers[i] === j ? 'is-wrong' : '') : '';
            return (
              <label key={j} className={cx('nl-opt', state, answers[i] === j && 'is-picked')}>
                <input type="radio" name={`q-${edition.id}-${i}`} disabled={answered} checked={answers[i] === j} onChange={() => setAnswers((a) => a.map((x, k) => (k === i ? j : x)))} />
                <span>{opt}</span>
              </label>
            );
          })}
          {fb(i) && <p className={cx('nl-explain', fb(i)?.correct ? 'is-right' : 'is-wrong')}>{fb(i)?.correct ? 'Right. ' : 'Not quite. '}{fb(i)?.explain}</p>}
        </fieldset>
      ))}
      {!answered && edition.quiz.canJoinBoard && (
        <label className="nl-toggle"><input type="checkbox" checked={optIn} onChange={(e) => { setOptIn(e.target.checked); void newsletterApi.setPreferences({ leaderboardOptIn: e.target.checked }); }} /> Count my score towards my class and house average (no names are shown)</label>
      )}
      {!answered
        ? <Button disabled={busy || answers.some((a) => a === null)} onClick={() => void run(async () => { setResult(await newsletterApi.quiz(edition.id, answers as number[])); onDone(); })}>{l.submit}</Button>
        : <p className="nl-score">You scored {result?.score ?? edition.quiz.score} out of {qs.length}.</p>}
      <ErrorNote error={error} />
      {edition.leaderboard && (edition.leaderboard.byClass.length > 0 || edition.leaderboard.byHouse.length > 0) && (
        <div className="nl-board">
          {[['By class', edition.leaderboard.byClass], ['By house', edition.leaderboard.byHouse]].map(([title, rows]) => (rows as Array<{ group: string; participants: number; averageScore: number }>).length ? (
            <div key={title as string}><h4>{title as string}</h4><ol>{(rows as Array<{ group: string; participants: number; averageScore: number }>).map((r) => <li key={r.group}><span>{r.group}</span><span>{r.averageScore} avg, {r.participants} players</span></li>)}</ol></div>
          ) : null)}
          <DataNote>{edition.leaderboard.note}</DataNote>
        </div>
      )}
    </div>
  );
}

function PollBlock({ edition, l }: { edition: Edition; l: L }) {
  const [results, setResults] = useState<PollResults | null>(edition.poll?.results ?? null);
  const [mine, setMine] = useState<string | null>(edition.poll?.myChoice ?? null);
  const { run, busy, error } = useAction();
  if (!edition.poll) return null;
  return (
    <div className="ops-stack">
      <p className="nl-poll-q">{edition.poll.question}</p>
      {results ? (
        <ul className="nl-poll">
          {results.options.map((o) => (
            <li key={o.key} className={cx(mine === o.key && 'is-mine')}>
              <div className="nl-poll-row"><span>{o.label}</span><span>{o.pct}%</span></div>
              <div className="nl-bar" aria-hidden="true"><span style={{ width: `${o.pct}%` }} /></div>
            </li>
          ))}
          <li className="ops-muted">{results.total} vote{results.total === 1 ? '' : 's'} so far</li>
        </ul>
      ) : (
        <div className="nl-actions">
          {edition.poll.options.map((o) => <Button key={o.key} variant="soft" disabled={busy} onClick={() => void run(async () => { setResults(await newsletterApi.vote(edition.id, o.key)); setMine(o.key); })}>{l.vote}: {o.label}</Button>)}
        </div>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

function CommentsBlock({ edition }: { edition: Edition }) {
  const [rows, setRows] = useState(edition.comments);
  const [text, setText] = useState('');
  const toast = useToast();
  const { run, busy, error } = useAction();
  return (
    <div className="ops-stack">
      {rows.length ? (
        <ul className="nl-comments">
          {rows.map((c) => (
            <li key={c.id} className={cx(c.status !== 'APPROVED' && 'is-pending')}>
              <div className="nl-comment-head"><b>{c.displayName}</b> <span className="ops-muted">{fmtDateTime(c.at)}</span>{c.status !== 'APPROVED' && <StatusPill status={c.status} label={c.status === 'PENDING' ? 'Waiting for staff' : 'Not shown'} />}</div>
              <p>{c.text}</p>
              {c.rejectReason && <p className="ops-muted">Staff note: {c.rejectReason}</p>}
            </li>
          ))}
        </ul>
      ) : <p className="ops-muted">No comments yet.</p>}
      <Field label="Add a comment" hint="Up to 500 characters. Comments from students and parents are checked by staff first; students appear as their class, never by name.">
        <textarea className="input" rows={2} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div><Button small disabled={busy || !text.trim()} onClick={() => void run(async () => {
        const out = await newsletterApi.comment(edition.id, { text: text.trim() });
        setRows((r) => [...r, { id: out.id, opportunityId: null, displayName: out.displayName, text: text.trim(), status: out.status, mine: true, at: new Date().toISOString(), rejectReason: null }]);
        setText('');
        if (out.note) toast(out.note);
      })}>Post comment</Button></div>
      <ErrorNote error={error} />
    </div>
  );
}

function MapBlock() {
  const m = useLoad(() => newsletterApi.map(), []);
  return (
    <Loadable state={m}>{(d) => {
      const max = Math.max(1, ...Object.values(d.byLevel));
      return (
        <div className="nl-map">
          <div className="nl-map-levels" role="list" aria-label="Opportunities this month by level">
            {OPP_LEVELS.map((lv) => (
              <div key={lv} role="listitem" className="nl-map-level">
                <span className="nl-map-bar" style={{ height: `${Math.max(6, (d.byLevel[lv] / max) * 100)}%` }} aria-hidden="true" />
                <b>{d.byLevel[lv]}</b><span>{humanize(lv)}</span>
              </div>
            ))}
          </div>
          <ul className="nl-map-regions">{d.byRegion.map((r) => <li key={r.region}><span>{r.region}</span><b>{r.count}</b></li>)}</ul>
          <DataNote>{d.total} published opportunit{d.total === 1 ? 'y' : 'ies'} open, close or usually run this month.</DataNote>
        </div>
      );
    }}</Loadable>
  );
}

// ── the interactive edition ────────────────────────────────────────────

const SECTIONS = ['hook', 'sixty', 'foryou', 'closing', 'radar', 'items', 'cards', 'quiz', 'poll', 'map', 'spotlight', 'comments'] as const;
// Part 5: which editor's note goes under which section.
const NOTE_FOR: Partial<Record<(typeof SECTIONS)[number], string>> = { items: 'items', closing: 'deadlines', cards: 'flashcards', quiz: 'quiz', poll: 'poll' };

function EditionReader({ id, kids, onChanged }: { id: string; kids: Array<{ studentId: string; name: string }>; onChanged?: () => void }) {
  const ed = useLoad(() => newsletterApi.edition(id), [id]);
  // Part 5: 60-second cards, deadline radar, "because" per item, badges, challenges (optional: the edition reads without them).
  const extras = useLoad(() => Promise.resolve().then(() => newsletterApi.extras(id)).catch(() => null), [id]);
  const [lang, setLang] = useState<Lang>('en');
  const [size, setSize] = useState<'S' | 'M' | 'L'>('M');
  const [reactions, setReactions] = useState<Edition['reactions']>({});
  const [pct, setPct] = useState(0);
  const [streak, setStreak] = useState<{ count: number; best: number } | null>(null);
  const seen = useRef(new Set<string>());
  const sent = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const resumed = useRef(false);

  useEffect(() => {
    if (!ed.data) return;
    setLang(ed.data.reader.language); setSize(ed.data.reader.textSize); setReactions(ed.data.reactions); setPct(ed.data.progress.pct); setStreak(ed.data.reader.streak);
  }, [ed.data]);

  // Continue where you left off: once, on open.
  useEffect(() => {
    const last = ed.data?.progress.lastSection;
    if (!ed.data || resumed.current) return;
    resumed.current = true;
    if (last && last !== 'hook' && !ed.data.progress.completed) document.getElementById(`nl-${id}-${last}`)?.scrollIntoView({ block: 'start' });
  }, [ed.data, id]);

  // Reading progress: the share of sections seen, sent when it grows.
  useEffect(() => {
    if (!ed.data || ed.data.status !== 'PUBLISHED' || typeof IntersectionObserver === 'undefined') return undefined;
    const present = SECTIONS.filter((s) => document.getElementById(`nl-${id}-${s}`));
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) seen.current.add(e.target.getAttribute('data-section') ?? '');
      const p = Math.round((seen.current.size / Math.max(1, present.length)) * 100);
      setPct((old) => Math.max(old, p));
      if (p > sent.current) {
        sent.current = p;
        const last = [...seen.current].pop() ?? 'hook';
        void newsletterApi.progress(id, { pct: p, section: last }).catch(() => undefined);
      }
    }, { threshold: 0.35 });
    present.forEach((s) => { const el = document.getElementById(`nl-${id}-${s}`); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [ed.data, id]);

  const react = async (target: string, kind: Reaction) => {
    try { const out = await newsletterApi.react(id, target, kind); setReactions((r) => ({ ...r, [target]: out })); } catch { /* the server explains on the next load */ }
  };
  const setPref = (body: Partial<Preferences>) => void newsletterApi.setPreferences(body).catch(() => undefined);

  return (
    <Loadable state={ed}>{(e) => {
      const l = LABELS[lang];
      const sec = (key: (typeof SECTIONS)[number], title: string, children: ReactNode, sub?: string) => (
        <section id={`nl-${id}-${key}`} data-section={key} className="nl-section" aria-labelledby={`nl-${id}-${key}-h`}>
          <h2 id={`nl-${id}-${key}-h`} className="nl-section-title">{title}</h2>
          {sub && <p className="nl-section-sub">{sub}</p>}
          {NOTE_FOR[key] && <SectionNoteLine note={e.sectionNotes?.find((n) => n.section === NOTE_FOR[key])} />}
          {children}
        </section>
      );
      const nearest = e.deadlines[0];
      return (
        <div ref={root} className={cx('nl-edition', `nl-size-${size}`)} lang={lang}>
          <div className="nl-toolbar">
            <div className="nl-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${pct}% ${l.progress}`}><span style={{ width: `${pct}%` }} /></div>
            <div className="nl-toolbar-row">
              <span className="ops-muted">{pct}% {l.progress}{streak?.count ? `, streak ${streak.count} day${streak.count === 1 ? '' : 's'}` : ''}</span>
              <div className="nl-toolbar-controls">
                <div className="nl-seg" role="group" aria-label="Language">
                  {(['en', 'hi'] as Lang[]).map((k) => <button key={k} type="button" aria-pressed={lang === k} className={cx(lang === k && 'is-on')} onClick={() => { setLang(k); setPref({ language: k }); }}>{k === 'en' ? 'English' : 'हिन्दी'}</button>)}
                </div>
                <div className="nl-seg" role="group" aria-label="Text size">
                  {(['S', 'M', 'L'] as const).map((k) => <button key={k} type="button" aria-pressed={size === k} aria-label={`Text size ${k === 'S' ? 'small' : k === 'M' ? 'medium' : 'large'}`} className={cx(size === k && 'is-on', `nl-a-${k}`)} onClick={() => { setSize(k); setPref({ textSize: k }); }}>A</button>)}
                </div>
              </div>
            </div>
          </div>
          {e.status !== 'PUBLISHED' && <DataNote>Preview of a {e.status.toLowerCase()} edition. Readers see it once it is published.</DataNote>}

          <section id={`nl-${id}-hook`} data-section="hook" className="nl-hook" aria-label="Opening">
            <div className="nl-hook-stub" aria-hidden="true">
              <span>{e.cadence === 'MONTHLY' ? 'Monthly' : 'Weekly'}</span>
              {nearest ? <b>{nearest.daysLeft}</b> : <b>{e.items.length}</b>}
              <span>{nearest ? (nearest.daysLeft === 1 ? 'day to the next deadline' : 'days to the next deadline') : 'opportunities'}</span>
            </div>
            <div className="nl-hook-main">
              <p className="nl-hook-period">{e.periodLabel && !e.title.includes(e.periodLabel) ? `${e.title}, ${e.periodLabel}` : e.title}</p>
              <p className="nl-hook-text">{lang === 'hi' && e.hook.textHi ? e.hook.textHi : e.hook.text}</p>
              {e.hook.question && <p className="nl-hook-q">{e.hook.question}</p>}
              {e.intro && <p className="nl-hook-intro">{e.intro}</p>}
              {lang === 'hi' && <p className="nl-hook-note">Opportunity details are in English.</p>}
              <div className="nl-reacts">
                {REACTIONS.slice(0, 2).map((r) => (
                  <button key={r.key} type="button" className={cx('nl-react', reactions.hook?.mine === r.key && 'is-on')} aria-pressed={reactions.hook?.mine === r.key} onClick={() => void react('hook', r.key)}>
                    <span aria-hidden="true">{r.icon}</span> {r.label}{reactions.hook?.counts[r.key] ? ` ${reactions.hook.counts[r.key]}` : ''}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {extras.data && extras.data.sixtySeconds.length > 1 && sec('sixty', e.cadence === 'MONTHLY' ? 'This month in 60 seconds' : 'This week in 60 seconds', <SixtySeconds extras={extras.data} />, 'One card per pick. Swipe or use Next.')}

          {e.forYou.some((g) => g.items.length) && sec('foryou', l.forYou, (
            <div className="ops-stack">
              {e.forYou.filter((g) => g.items.length).map((g) => (
                <div key={g.studentId ?? g.kind} className="nl-group">
                  {(g.name || g.kind === 'TEACHER') && <h3 className="nl-group-title">{g.kind === 'TEACHER' ? 'For you and your classes' : `For ${g.name}${g.className ? ` (${g.className})` : ''}`}</h3>}
                  <div className="nl-grid">{g.items.slice(0, 3).map((o) => <OpportunityCard key={o.id} o={o} l={l} kids={kids} compact />)}</div>
                </div>
              ))}
            </div>
          ), 'Matched to class, clubs, portfolio strengths and the interests chosen in Settings.')}

          {e.deadlines.length > 0 && sec('closing', l.closing, (
            <ul className="nl-deadlines">{e.deadlines.map((d) => <li key={d.id}><span>{d.title}{d.saved ? ' (saved)' : ''}</span><Countdown days={d.daysLeft} l={l} /></li>)}</ul>
          ))}

          {extras.data && sec('radar', 'Deadline radar', <DeadlineRadar extras={extras.data} />, 'What closes soon among this edition, your saves and your matches.')}

          {sec('items', l.items, (
            <div className="nl-grid">{e.items.map((o) => (
              <div key={o.id} className="nl-because-wrap">
                {extras.data?.because[o.id] && <p className={cx('nl-because', extras.data.because[o.id].notEligible && 'is-no')}>{extras.data.because[o.id].text}</p>}
                <OpportunityCard o={o} l={l} editionId={id} kids={kids} reactions={reactions[o.id] ?? { counts: { USEFUL: 0, INSPIRING: 0, ENTERING: 0, CURIOUS: 0 }, mine: null }} onReact={(k) => void react(o.id, k)} />
              </div>
            ))}</div>
          ), 'Dates the school has not confirmed say "check": always check the official site before applying.')}

          {e.flashcards.length > 0 && sec('cards', l.cards, <>{extras.data && <BadgeStrip extras={extras.data} />}<FlashcardDeck cards={e.flashcards} l={l} onReviewed={(st) => { setStreak(st); void extras.reload(); }} /></>, 'Swipe right if you knew it, left to see it again. Cards come back on a schedule, so a few minutes a week is enough.')}
          {e.quiz.questions.length > 0 && sec('quiz', l.quiz, <>
            <QuizBlock edition={e} l={l} onDone={() => { void ed.reload(); void extras.reload(); onChanged?.(); }} />
            {extras.data?.challenges && <ChallengeBlock editionId={id} extras={extras.data} onChanged={() => void extras.reload()} />}
          </>)}
          {e.poll && sec('poll', l.poll, <PollBlock edition={e} l={l} />)}
          {sec('map', l.map, <MapBlock />)}
          {e.spotlight.length > 0 && sec('spotlight', l.spotlight, (
            <ul className="nl-spotlight">{e.spotlight.map((s, i) => <li key={i}><b>{s.title}</b>{s.name && <span> {s.name}</span>}{s.detail && <p className="ops-muted">{s.detail}</p>}</li>)}</ul>
          ), 'From the school showcase, only for children whose families agreed.')}
          {e.status === 'PUBLISHED' && sec('comments', l.comments, <CommentsBlock edition={e} />)}
        </div>
      );
    }}</Loadable>
  );
}

// ── reader tabs ────────────────────────────────────────────────────────

function EditionsTab({ kids }: { kids: Array<{ studentId: string; name: string }> }) {
  const fromLink = useQueryParam('edition');
  const list = useLoad(() => newsletterApi.editions({ view: 'reader' }), []);
  const home = useLoad(() => newsletterApi.home(), []);
  const [id, setId] = useState<string | null>(fromLink);
  useEffect(() => { if (!id && list.data?.length) setId(home.data?.continueReading?.id ?? list.data[0].id); }, [id, list.data, home.data]);
  return (
    <div className="ops-stack">
      {home.data && (
        <div className="kpi-grid">
          <Tile label="Streak" value={`${home.data.streak.count ?? 0} day${home.data.streak.count === 1 ? '' : 's'}`} />
          <Tile label="Cards due today" value={home.data.flashcardsDue} tone={home.data.flashcardsDue ? 'warn' : 'neutral'} />
          <Tile label="Saved" value={home.data.savedCount} />
          <Tile label="Closing in 14 days" value={home.data.closingSoon.length} tone={home.data.closingSoon.length ? 'warn' : 'neutral'} />
        </div>
      )}
      {home.data?.continueReading && home.data.continueReading.id !== id && (
        <button type="button" className="nl-continue" onClick={() => setId(home.data?.continueReading?.id ?? null)}>Continue where you left off: {home.data.continueReading.title} ({home.data.continueReading.pct}% read)</button>
      )}
      <Loadable state={list} empty={null}>{(rows) => rows.length ? (
        <>
          <label className="nl-picker">
            <span>Edition</span>
            <select className="input" value={id ?? ''} onChange={(e) => setId(e.target.value)}>
              {rows.map((r) => <option key={r.id} value={r.id}>{r.cadence === 'MONTHLY' ? 'Monthly' : 'Weekly'}: {r.periodLabel}{r.myProgress >= 100 ? ' (read)' : r.myProgress ? ` (${r.myProgress}%)` : ''}</option>)}
            </select>
          </label>
          {id && <EditionReader key={id} id={id} kids={kids} onChanged={() => void home.reload()} />}
        </>
      ) : <EmptyState icon="✉" title="No newsletter yet" sub="The first edition appears here when the school publishes it. Meanwhile, look through Explore." />}</Loadable>
    </div>
  );
}

function ForYouTab({ kids }: { kids: Array<{ studentId: string; name: string }> }) {
  const [month, setMonth] = useState(false);
  const m = useLoad(() => newsletterApi.matches(month ? { month: new Date(Date.now() + 330 * 60_000).getUTCMonth() + 1 } : {}), [month]);
  const l = LABELS.en;
  return (
    <div className="ops-stack">
      <label className="nl-toggle"><input type="checkbox" checked={month} onChange={(e) => setMonth(e.target.checked)} /> Only what opens, closes or usually runs this month</label>
      <Loadable state={m}>{(d) => d.contexts.length ? (
        <>{d.contexts.map((g: MatchGroup) => (
          <SectionCard key={g.studentId ?? g.kind} title={g.kind === 'TEACHER' ? 'For you and your classes' : g.name ? `For ${g.name}${g.className ? ` (${g.className})` : ''}` : 'For you'}>
            {g.items.length ? <div className="nl-grid">{g.items.map((o) => <OpportunityCard key={o.id} o={o} l={l} kids={kids} />)}</div>
              : <p className="ops-muted">Nothing matches yet. Add interests in Settings, or look through Explore.</p>}
          </SectionCard>
        ))}</>
      ) : <EmptyState icon="◎" title="No matches to show" sub="Matches use a student's class and clubs. Explore shows everything the school published." />}</Loadable>
    </div>
  );
}

function ExploreTab({ kids }: { kids: Array<{ studentId: string; name: string }> }) {
  const [f, setF] = useState<{ type?: string; level?: string; domain?: string; q?: string }>({});
  const list = useLoad(() => newsletterApi.opportunities(f), [JSON.stringify(f)]);
  const l = LABELS.en;
  return (
    <div className="ops-stack">
      <SectionCard title={l.map}><MapBlock /></SectionCard>
      <div className="nl-filters">
        <input className="input" placeholder="Search by name" value={f.q ?? ''} onChange={(e) => setF((x) => ({ ...x, q: e.target.value || undefined }))} aria-label="Search opportunities" />
        <select className="input" value={f.type ?? ''} onChange={(e) => setF((x) => ({ ...x, type: e.target.value || undefined }))} aria-label="Type"><option value="">Any type</option>{OPP_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select>
        <select className="input" value={f.level ?? ''} onChange={(e) => setF((x) => ({ ...x, level: e.target.value || undefined }))} aria-label="Level"><option value="">Any level</option>{OPP_LEVELS.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select>
        <select className="input" value={f.domain ?? ''} onChange={(e) => setF((x) => ({ ...x, domain: e.target.value || undefined }))} aria-label="Domain"><option value="">Any domain</option>{OPP_DOMAINS.map((t) => <option key={t} value={t}>{DOMAIN_LABELS[t]}</option>)}</select>
      </div>
      <Loadable state={list}>{(d) => d.items.length ? <div className="nl-grid">{d.items.map((o) => <OpportunityCard key={o.id} o={o} l={l} kids={kids} />)}</div>
        : <EmptyState icon="⌕" title="Nothing found" sub="Try fewer filters." />}</Loadable>
    </div>
  );
}

function CardsTab() {
  const deck = useLoad(() => newsletterApi.flashcards(), []);
  const [streak, setStreak] = useState<{ count: number; best: number } | null>(null);
  return (
    <Loadable state={deck}>{(d) => (
      <div className="ops-stack">
        <div className="kpi-grid">
          <Tile label="Streak" value={`${(streak ?? d.streak).count ?? 0} day${(streak ?? d.streak).count === 1 ? '' : 's'}`} />
          <Tile label="Best streak" value={`${(streak ?? d.streak).best ?? 0}`} />
          <Tile label="Due today" value={d.due.length} tone={d.due.length ? 'warn' : 'neutral'} />
          <Tile label="Mastered" value={d.stats.mastered} tone="good" />
        </div>
        <FlashcardDeck cards={[...d.due, ...d.fresh]} l={LABELS.en} onReviewed={setStreak} />
      </div>
    )}</Loadable>
  );
}

function SavedTab() {
  const rows = useLoad(() => newsletterApi.saved(), []);
  const { run } = useAction();
  return (
    <Loadable state={rows}>{(d) => d.length ? (
      <ul className="nl-saved">
        {d.map((r) => (
          <li key={r.saveId}>
            <div className="nl-saved-main"><b>{r.opportunity.title}</b>{r.forName && <span className="ops-muted"> for {r.forName}</span>}<p className={cx('nl-when', !r.opportunity.datesConfirmed && 'is-unconfirmed')}>{r.opportunity.dateText}</p></div>
            <div className="nl-saved-side">
              <Countdown days={r.opportunity.daysLeft} l={LABELS.en} />
              <span className="ops-muted">{r.remind ? 'Reminders on' : 'No reminders'}</span>
              <Button small variant="ghost" onClick={() => void run(async () => { await newsletterApi.unsave(r.opportunity.id, r.studentId); await rows.reload(); })}>Remove</Button>
            </div>
          </li>
        ))}
      </ul>
    ) : <EmptyState icon="☆" title="Nothing saved yet" sub="Press Save or Remind me on any opportunity to keep it here, soonest deadline first." />}</Loadable>
  );
}

function QuestionsTab({ staff, teacher }: { staff: boolean; teacher: boolean }) {
  const rows = useLoad(() => newsletterApi.questions(), []);
  const pending = useLoad(() => (teacher ? newsletterApi.pendingComments() : Promise.resolve([])), [teacher]);
  const [answering, setAnswering] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const toast = useToast();
  const { run } = useAction();
  return (
    <div className="ops-stack">
      <SectionCard title={staff ? 'Questions from students and parents' : 'Your questions'}>
        <Loadable state={rows}>{(d) => d.length ? (
          <ul className="nl-comments">{d.map((q) => (
            <li key={q.id}>
              <div className="nl-comment-head"><b>{q.opportunity}</b> <StatusPill status={q.status === 'ANSWERED' ? 'RESOLVED' : 'OPEN'} label={humanize(q.status)} /></div>
              {staff && <p className="ops-muted">{q.from}, {fmtDateTime(q.createdAt)}</p>}
              <p>{q.text}</p>
              {q.answer ? <p className="nl-answer"><b>{q.answeredByName}:</b> {q.answer}</p> : staff && <Button small onClick={() => setAnswering(q.id)}>Answer</Button>}
            </li>
          ))}</ul>
        ) : <p className="ops-muted">{staff ? 'No questions yet.' : 'Use "Ask a teacher" on any opportunity.'}</p>}</Loadable>
      </SectionCard>
      {teacher && (
        <SectionCard title="Student comments waiting for you" sub="Students' comments appear to others only after a member of staff approves them.">
          <Loadable state={pending}>{(d) => d.length ? (
            <ul className="nl-comments">{d.map((c) => (
              <li key={c.id}>
                <div className="nl-comment-head"><b>{c.displayName}</b> <span className="ops-muted">{c.edition}</span></div>
                <p>{c.text}</p>
                <div className="nl-actions">
                  <Button small onClick={() => void run(async () => { await newsletterApi.moderate(c.id, { decision: 'APPROVE' }); toast('Approved'); await pending.reload(); })}>Approve</Button>
                  <Button small variant="soft" onClick={() => setRejecting(c.id)}>Do not show</Button>
                </div>
              </li>
            ))}</ul>
          ) : <p className="ops-muted">Nothing waiting.</p>}</Loadable>
        </SectionCard>
      )}
      {answering && <PromptModal title="Answer the question" label="Your answer" confirmLabel="Send answer" onSubmit={async (v) => { await newsletterApi.answer(answering, v); toast('Answer sent'); await rows.reload(); }} onClose={() => setAnswering(null)} />}
      {rejecting && <PromptModal title="Do not show this comment" label="A short note for the student" confirmLabel="Do not show" onSubmit={async (v) => { await newsletterApi.moderate(rejecting, { decision: 'REJECT', reason: v }); await pending.reload(); }} onClose={() => setRejecting(null)} />}
    </div>
  );
}

function SettingsTab({ staff }: { staff: boolean }) {
  const prefs = useLoad(() => newsletterApi.preferences(), []);
  const toast = useToast();
  const { run, error } = useAction();
  const set = (body: Partial<Preferences>) => run(async () => { prefs.setData(await newsletterApi.setPreferences(body)); toast('Saved'); });
  return (
    <Loadable state={prefs}>{(p) => (
      <div className="ops-stack">
        <SectionCard title="Editions">
          <label className="nl-toggle"><input type="checkbox" checked={p.weekly} onChange={(e) => void set({ weekly: e.target.checked })} /> Weekly edition</label>
          <label className="nl-toggle"><input type="checkbox" checked={p.monthly} onChange={(e) => void set({ monthly: e.target.checked })} /> Monthly edition</label>
          {p.emailAllowed
            ? <label className="nl-toggle"><input type="checkbox" checked={p.email} onChange={(e) => void set({ email: e.target.checked })} /> Also send me the email version</label>
            : <DataNote>Students read the newsletter here; the email version goes to parents and staff who turn it on.</DataNote>}
          {p.unsubscribed && <DataNote>You unsubscribed from the email. Turn it on again above if you change your mind.</DataNote>}
          <DataNote>The email has no tracking pixels. If no email service is connected, the school’s outbox records it as simulated and nothing is sent.</DataNote>
        </SectionCard>
        <SectionCard title="Interests" sub="Used with class and clubs to pick matches.">
          <div className="nl-chips">
            {p.options.domains.map((d) => {
              const on = p.domains.includes(d.key);
              return <button key={d.key} type="button" className={cx('nl-chip', 'is-toggle', on && 'is-on')} aria-pressed={on} onClick={() => void set({ domains: on ? p.domains.filter((x) => x !== d.key) : [...p.domains, d.key] })}>{d.label}</button>;
            })}
          </div>
          {!staff && (
            <Field label="Stream (Classes 11 and 12)">
              <select className="input" value={p.stream ?? ''} onChange={(e) => void set({ stream: e.target.value || null })}><option value="">Not set</option>{p.options.streams.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select>
            </Field>
          )}
          {staff && (
            <Field label="Professional development interests" hint="Comma-separated, e.g. assessment, coding">
              <input className="input" defaultValue={p.cpdInterests.join(', ')} onBlur={(e) => void set({ cpdInterests: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
            </Field>
          )}
        </SectionCard>
        <ErrorNote error={error} />
      </div>
    )}</Loadable>
  );
}

export function NewsletterView() {
  const { me } = useAuth();
  const role = me?.profile?.role ?? '';
  const isParent = role === 'PARENT';
  const staff = !['PARENT', 'STUDENT', 'ALUMNUS'].includes(role);
  const kids = useKids(isParent);
  const initial = (useQueryParam('tab') as 'edition' | 'foryou' | 'explore' | 'cards' | 'saved' | 'questions' | 'settings' | null) ?? 'edition';
  const [tab, setTab] = useState(initial);
  const probe = useLoad(() => newsletterApi.preferences(), []);
  if (isOff(probe.error)) return <EmptyState icon="⏻" title="Opportunities and the newsletter are switched off" sub="An administrator can switch them on in Settings, Features." />;
  return (
    <div className="ops-stack nl-root">
      <Tabs
        tabs={[
          { key: 'edition' as const, label: 'Newsletter' }, { key: 'foryou' as const, label: 'For you' }, { key: 'explore' as const, label: 'Explore' },
          { key: 'cards' as const, label: 'Flashcards' }, { key: 'saved' as const, label: 'Saved' }, { key: 'questions' as const, label: 'Questions' }, { key: 'settings' as const, label: 'Settings' },
        ]}
        value={tab} onChange={setTab}
      />
      {tab === 'edition' && <EditionsTab kids={kids} />}
      {tab === 'foryou' && <ForYouTab kids={kids} />}
      {tab === 'explore' && <ExploreTab kids={kids} />}
      {tab === 'cards' && <CardsTab />}
      {tab === 'saved' && <SavedTab />}
      {tab === 'questions' && <QuestionsTab staff={staff} teacher={role === 'TEACHER'} />}
      {tab === 'settings' && <SettingsTab staff={staff} />}
      {staff && tab === 'explore' && <SuggestBox />}
    </div>
  );
}

function SuggestBox() {
  const [open, setOpen] = useState(false);
  return (
    <SectionCard title="Know a good opportunity?" sub="Add it for the editor to check and publish." actions={<Button small onClick={() => setOpen(true)}>Suggest an opportunity</Button>}>
      {open ? <OpportunityForm onClose={() => setOpen(false)} onSaved={() => setOpen(false)} /> : <p className="ops-muted">It needs the organiser’s official https link (a school event can go without one).</p>}
    </SectionCard>
  );
}

// ── the editor's desk ──────────────────────────────────────────────────

type FormState = {
  title: string; summary: string; type: string; level: string; audience: string; domains: string[]; gradeMin: string; gradeMax: string; ageMin: string; ageMax: string; note: string;
  officialUrl: string; organiser: string; fee: string; mode: string; region: string; typicalWindow: string; typicalMonths: string; registrationCloses: string; eventDate: string; datesConfirmed: boolean; howToApply: string;
};
const blank: FormState = { title: '', summary: '', type: 'COMPETITION', level: 'NATIONAL', audience: 'STUDENTS', domains: [], gradeMin: '', gradeMax: '', ageMin: '', ageMax: '', note: '', officialUrl: '', organiser: '', fee: '', mode: 'ONLINE', region: '', typicalWindow: '', typicalMonths: '', registrationCloses: '', eventDate: '', datesConfirmed: false, howToApply: '' };
const fromOpp = (o: Opportunity): FormState => ({
  title: o.title, summary: o.summary, type: o.type, level: o.level, audience: o.audience, domains: o.domains, gradeMin: String(o.eligibility.gradeMin ?? ''), gradeMax: String(o.eligibility.gradeMax ?? ''),
  ageMin: String(o.eligibility.ageMin ?? ''), ageMax: String(o.eligibility.ageMax ?? ''), note: o.eligibility.note ?? '', officialUrl: o.officialUrl ?? '', organiser: o.organiser ?? '', fee: o.fee ?? '', mode: o.mode,
  region: o.region ?? '', typicalWindow: o.typicalWindow ?? '', typicalMonths: o.typicalMonths.join(', '), registrationCloses: o.registrationCloses?.slice(0, 10) ?? '', eventDate: o.eventDate?.slice(0, 10) ?? '', datesConfirmed: o.datesConfirmed, howToApply: o.howToApply.join('\n'),
});
const num = (v: string) => (v.trim() ? Number(v) : null);

function OpportunityForm({ initial, editor, onClose, onSaved }: { initial?: Opportunity; editor?: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<FormState>(initial ? fromOpp(initial) : blank);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const up = (k: keyof FormState) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const body = () => ({
    title: f.title, summary: f.summary, type: f.type, level: f.level, audience: f.audience, domains: f.domains, officialUrl: f.officialUrl || null, organiser: f.organiser || null, fee: f.fee || null, mode: f.mode,
    region: f.region || null, typicalWindow: f.typicalWindow || null, typicalMonths: f.typicalMonths.split(',').map((s) => Number(s.trim())).filter((n) => n >= 1 && n <= 12),
    eligibility: { gradeMin: num(f.gradeMin), gradeMax: num(f.gradeMax), ageMin: num(f.ageMin), ageMax: num(f.ageMax), streams: initial?.eligibility.streams ?? [], note: f.note || null },
    registrationCloses: f.registrationCloses || null, eventDate: f.eventDate || null, howToApply: f.howToApply.split('\n').map((s) => s.trim()).filter(Boolean),
    ...(editor && { datesConfirmed: f.datesConfirmed }),
  });
  return (
    <div className="ops-stack">
      <div className="ops-form-grid">
        <Field label="Title" required><input className="input" value={f.title} onChange={up('title')} /></Field>
        <Field label="Organiser"><input className="input" value={f.organiser} onChange={up('organiser')} /></Field>
        <Field label="Type"><select className="input" value={f.type} onChange={up('type')}>{OPP_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select></Field>
        <Field label="Level"><select className="input" value={f.level} onChange={up('level')}>{OPP_LEVELS.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select></Field>
        <Field label="For"><select className="input" value={f.audience} onChange={up('audience')}><option value="STUDENTS">Students</option><option value="TEACHERS">Teachers</option><option value="BOTH">Both</option></select></Field>
        <Field label="Mode"><select className="input" value={f.mode} onChange={up('mode')}><option value="ONLINE">Online</option><option value="OFFLINE">In person</option><option value="HYBRID">Both</option></select></Field>
        <Field label="Official link" hint="https:// on the organiser's own site"><input className="input" value={f.officialUrl} onChange={up('officialUrl')} /></Field>
        <Field label="Fee"><input className="input" value={f.fee} onChange={up('fee')} placeholder="Free, or the amount" /></Field>
        <Field label="From class"><input className="input" inputMode="numeric" value={f.gradeMin} onChange={up('gradeMin')} /></Field>
        <Field label="To class"><input className="input" inputMode="numeric" value={f.gradeMax} onChange={up('gradeMax')} /></Field>
        <Field label="Minimum age"><input className="input" inputMode="numeric" value={f.ageMin} onChange={up('ageMin')} /></Field>
        <Field label="Maximum age"><input className="input" inputMode="numeric" value={f.ageMax} onChange={up('ageMax')} /></Field>
        <Field label="Usual window" hint='e.g. "Registration usually opens in July"'><input className="input" value={f.typicalWindow} onChange={up('typicalWindow')} /></Field>
        <Field label="Usual months" hint="Numbers, e.g. 7, 8"><input className="input" value={f.typicalMonths} onChange={up('typicalMonths')} /></Field>
        <Field label="Registration closes"><input className="input" type="date" value={f.registrationCloses} onChange={up('registrationCloses')} /></Field>
        <Field label="Event date"><input className="input" type="date" value={f.eventDate} onChange={up('eventDate')} /></Field>
        <Field label="State or region" hint="Leave blank for all-India or international"><input className="input" value={f.region} onChange={up('region')} /></Field>
        <Field label="Eligibility note" hint="A condition the school cannot check, e.g. an income limit"><input className="input" value={f.note} onChange={up('note')} /></Field>
      </div>
      <Field label="Summary" required><textarea className="input" rows={3} value={f.summary} onChange={up('summary')} /></Field>
      <Field label="How to apply" hint="One step per line"><textarea className="input" rows={3} value={f.howToApply} onChange={up('howToApply')} /></Field>
      <div className="nl-chips">{OPP_DOMAINS.map((d) => { const on = f.domains.includes(d); return <button key={d} type="button" className={cx('nl-chip', 'is-toggle', on && 'is-on')} aria-pressed={on} onClick={() => setF((x) => ({ ...x, domains: on ? x.domains.filter((y) => y !== d) : [...x.domains, d] }))}>{DOMAIN_LABELS[d]}</button>; })}</div>
      {editor && <label className="nl-toggle"><input type="checkbox" checked={f.datesConfirmed} onChange={(e) => setF((x) => ({ ...x, datesConfirmed: e.target.checked }))} /> I checked these dates on the official site</label>}
      <ErrorNote error={error} />
      <div className="nl-actions">
        <Button variant="soft" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || !f.title.trim() || !f.summary.trim()} onClick={() => void run(async () => {
          if (initial) await newsletterApi.update(initial.id, body()); else await newsletterApi.create(body());
          toast(initial ? 'Saved' : 'Added to the review queue');
          onSaved();
        })}>{initial ? 'Save changes' : 'Add to review queue'}</Button>
      </div>
    </div>
  );
}

function QueueTab({ status }: { status: 'SUBMITTED' | 'PUBLISHED' }) {
  const list = useLoad(() => newsletterApi.opportunities({ status }), [status]);
  const [editing, setEditing] = useState<Opportunity | 'new' | null>(null);
  const [rejecting, setRejecting] = useState<Opportunity | null>(null);
  const toast = useToast();
  const { run, busy, error } = useAction();
  return (
    <div className="ops-stack">
      {status === 'SUBMITTED' && (
        <div className="nl-actions">
          <Button small onClick={() => setEditing('new')}>Add an opportunity</Button>
          <Button small variant="soft" disabled={busy} onClick={() => void run(async () => { const r = await newsletterApi.importCatalogue(); toast(`${r.added} programme(s) added from the starter list`); await list.reload(); })}>Add the starter list</Button>
          <Button small variant="soft" disabled={busy} onClick={() => void run(async () => { const r = await newsletterApi.scanFeeds(); toast(`${r.added} candidate(s) from approved feeds`); await list.reload(); })}>Look in approved feeds</Button>
        </div>
      )}
      <ErrorNote error={error} />
      {editing && <SectionCard title={editing === 'new' ? 'New opportunity' : `Edit: ${editing.title}`}><OpportunityForm editor initial={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void list.reload(); }} /></SectionCard>}
      <Loadable state={list}>{(d) => d.items.length ? (
        <ul className="nl-desk-list">
          {d.items.map((o) => (
            <li key={o.id}>
              <div className="nl-desk-main">
                <b>{o.title}</b>
                <p className="ops-muted">{o.typeLabel}, {o.levelLabel.toLowerCase()}. From {o.source.kind === 'CATALOGUE' ? 'the starter list' : o.source.kind === 'FEED' ? `a feed (${o.source.sourceTitle ?? 'approved'})` : o.source.kind === 'ALERT' ? `an alert feed (${o.source.sourceTitle ?? 'Google Alert'})` : o.submittedByName ?? 'staff'}{o.clicks ? `. ${o.clicks} ${o.clicks === 1 ? 'click' : 'clicks'}` : ''}</p>
                <p className={cx('nl-when', !o.datesConfirmed && 'is-unconfirmed')}>{o.dateText}</p>
                {o.officialUrl ? <p className="ops-muted nl-break">{o.officialUrl}</p> : <p className="ops-muted">No link (school event)</p>}
                {o.reviewNote && <p className="nl-reason">{o.reviewNote}</p>}
                {o.extraction && <ExtractionDetails x={o.extraction} sourceLink={o.sourceLink} />}
              </div>
              <div className="nl-actions">
                <Button small variant="soft" onClick={() => setEditing(o)}>Edit</Button>
                {status === 'SUBMITTED' && <Button small disabled={busy} onClick={() => void run(async () => { await newsletterApi.review(o.id, { decision: 'PUBLISH' }); toast('Published'); await list.reload(); })}>Publish</Button>}
                {status === 'SUBMITTED' && <Button small variant="ghost" onClick={() => setRejecting(o)}>Reject</Button>}
                {status === 'PUBLISHED' && <Button small variant="ghost" disabled={busy} onClick={() => void run(async () => { await newsletterApi.review(o.id, { decision: 'ARCHIVE' }); toast('Archived'); await list.reload(); })}>Archive</Button>}
              </div>
            </li>
          ))}
        </ul>
      ) : <EmptyState icon="✓" title={status === 'SUBMITTED' ? 'The review queue is empty' : 'Nothing published yet'} sub={status === 'SUBMITTED' ? 'Add an opportunity, add the starter list, or look in the approved feeds.' : 'Publish items from the review queue.'} />}</Loadable>
      {rejecting && <PromptModal title={`Reject "${rejecting.title}"`} label="Why (the person who added it sees this)" confirmLabel="Reject" danger onSubmit={async (v) => { await newsletterApi.review(rejecting.id, { decision: 'REJECT', note: v }); await list.reload(); }} onClose={() => setRejecting(null)} />}
    </div>
  );
}

function DeskEditions() {
  const list = useLoad(() => newsletterApi.editions(), []);
  const fromLink = useQueryParam('id');
  const [preview, setPreview] = useState<string | null>(fromLink);
  const [editing, setEditing] = useState<EditionSummary | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const toast = useToast();
  const { run, busy, error } = useAction();
  return (
    <div className="ops-stack">
      <div className="nl-actions">
        <Button small disabled={busy} onClick={() => void run(async () => { const r = await newsletterApi.generate('WEEKLY'); toast(r.created ? 'Weekly draft ready' : 'This week already has an edition'); await list.reload(); setPreview(r.edition.id); })}>Draft this week’s edition</Button>
        <Button small variant="soft" disabled={busy} onClick={() => void run(async () => { const r = await newsletterApi.generate('MONTHLY'); toast(r.created ? 'Monthly draft ready' : 'This month already has an edition'); await list.reload(); setPreview(r.edition.id); })}>Draft this month’s edition</Button>
      </div>
      <DataNote>Drafts are made automatically each week and month. Nothing reaches readers until you publish it.</DataNote>
      <ErrorNote error={error} />
      <Loadable state={list}>{(rows) => rows.length ? (
        <ul className="nl-desk-list">
          {rows.map((e) => (
            <li key={e.id}>
              <div className="nl-desk-main">
                <b>{e.title}</b> <StatusPill status={e.status} />
                <p className="ops-muted">{e.cadence === 'MONTHLY' ? 'Monthly' : 'Weekly'}, {e.periodLabel}. {e.opportunityIds?.length ?? 0} items, {e.flashcards} cards, {e.quiz} quiz questions{e.publishedAt ? `. Published ${fmtDate(e.publishedAt)}${e.publishedByName ? ` by ${e.publishedByName}` : ''}` : ''}</p>
                {e.delivery && e.status !== 'DRAFT' && <p className="ops-muted">Delivered in the app to {e.delivery.inApp}; email to {e.delivery.emailQueued}{Object.keys(e.delivery.byStatus ?? {}).length ? ` (${Object.entries(e.delivery.byStatus).map(([k, v]) => `${v} ${humanize(k).toLowerCase()}`).join(', ')})` : ''}</p>}
              </div>
              <div className="nl-actions">
                <Button small variant="soft" onClick={() => setPreview(preview === e.id ? null : e.id)}>{preview === e.id ? 'Close preview' : 'Preview'}</Button>
                {e.status === 'DRAFT' && <Button small variant="soft" onClick={() => setEditing(e)}>Edit</Button>}
                {e.status === 'DRAFT' && <Button small variant="soft" disabled={busy} onClick={() => void run(async () => { await newsletterApi.generate(e.cadence, true); toast('Draft rebuilt'); await list.reload(); })}>Rebuild</Button>}
                {e.status !== 'PUBLISHED' && <Button small disabled={busy} onClick={() => void run(async () => { const r = await newsletterApi.publish(e.id); toast(r.delivered ? `Published: ${r.delivery?.inApp ?? 0} readers in the app, ${r.delivery?.emailQueued ?? 0} by email` : 'Published again (not re-sent)'); await list.reload(); })}>Publish</Button>}
                {e.status === 'PUBLISHED' && <Button small variant="ghost" onClick={() => setWithdrawing(e.id)}>Withdraw</Button>}
              </div>
              {preview === e.id && e.status === 'DRAFT' && <RegenerateBar editionId={e.id} writtenBy={e.ai?.sections ?? null} onDone={() => { setRound((n) => n + 1); void list.reload(); }} />}
              {preview === e.id && <div className="nl-preview"><EditionReader key={`${e.id}:${round}`} id={e.id} kids={[]} /></div>}
            </li>
          ))}
        </ul>
      ) : <EmptyState icon="✉" title="No editions yet" sub="Draft this week's edition to start." />}</Loadable>
      {editing && <EditDraftModal e={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void list.reload(); }} />}
      {withdrawing && <PromptModal title="Withdraw this edition" label="Reason (kept in the history)" confirmLabel="Withdraw" danger onSubmit={async (v) => { await newsletterApi.withdraw(withdrawing, v); await list.reload(); }} onClose={() => setWithdrawing(null)} />}
    </div>
  );
}

function EditDraftModal({ e, onClose, onSaved }: { e: EditionSummary; onClose: () => void; onSaved: () => void }) {
  const full = useLoad(() => newsletterApi.edition(e.id), [e.id]);
  const pub = useLoad(() => newsletterApi.opportunities({ status: 'PUBLISHED' }), []);
  const [title, setTitle] = useState(e.title);
  const [hook, setHook] = useState('');
  const [question, setQuestion] = useState('');
  const [ids, setIds] = useState<string[]>(e.opportunityIds ?? []);
  const { run, busy, error } = useAction();
  useEffect(() => { if (full.data) { setHook(full.data.hook.text); setQuestion(full.data.hook.question ?? ''); } }, [full.data]);
  return (
    <Modal wide title={`Edit draft: ${e.periodLabel}`} onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !title.trim() || !hook.trim() || !ids.length} onClick={() => void run(async () => { await newsletterApi.updateDraft(e.id, { title, hook: { text: hook, question: question || null }, opportunityIds: ids }); onSaved(); })}>Save draft</Button>
    </>}>
      <Field label="Title"><input className="input" value={title} onChange={(x) => setTitle(x.target.value)} /></Field>
      <Field label="Opening hook" hint="A striking, checkable fact tied to this edition"><textarea className="input" rows={2} value={hook} onChange={(x) => setHook(x.target.value)} /></Field>
      <Field label="Question under the hook"><input className="input" value={question} onChange={(x) => setQuestion(x.target.value)} /></Field>
      <p className="ops-muted">Items (changing them rebuilds the flashcards, quiz and poll)</p>
      <Loadable state={pub}>{(d) => (
        <div className="nl-pick-list">{d.items.map((o) => (
          <label key={o.id} className="nl-toggle"><input type="checkbox" checked={ids.includes(o.id)} onChange={(x) => setIds((cur) => (x.target.checked ? [...cur, o.id] : cur.filter((y) => y !== o.id)))} /> {o.title}</label>
        ))}</div>
      )}</Loadable>
      <ErrorNote error={error} />
    </Modal>
  );
}

function DeskComments() {
  const rows = useLoad(() => newsletterApi.pendingComments(), []);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const { run } = useAction();
  return (
    <Loadable state={rows}>{(d) => (
      <>
        {d.length ? (
          <ul className="nl-comments">{d.map((c) => (
            <li key={c.id}>
              <div className="nl-comment-head"><b>{c.displayName}</b> <span className="ops-muted">{humanize(c.authorRole)}, {c.edition}, {fmtDateTime(c.at)}</span></div>
              <p>{c.text}</p>
              <div className="nl-actions">
                <Button small onClick={() => void run(async () => { await newsletterApi.moderate(c.id, { decision: 'APPROVE' }); await rows.reload(); })}>Approve</Button>
                <Button small variant="soft" onClick={() => setRejecting(c.id)}>Do not show</Button>
              </div>
            </li>
          ))}</ul>
        ) : <EmptyState icon="✓" title="No comments waiting" sub="Comments from students and parents wait here until staff approve them." />}
        {rejecting && <PromptModal title="Do not show this comment" label="A short note for the author" confirmLabel="Do not show" onSubmit={async (v) => { await newsletterApi.moderate(rejecting, { decision: 'REJECT', reason: v }); await rows.reload(); }} onClose={() => setRejecting(null)} />}
      </>
    )}</Loadable>
  );
}

function DeskSites() {
  const s = useLoad(() => newsletterApi.settings(), []);
  const [text, setText] = useState('');
  const toast = useToast();
  const { run, busy, error } = useAction();
  useEffect(() => { if (s.data) setText(s.data.allowedDomains.join('\n')); }, [s.data]);
  return (
    <SectionCard title="Official sites" sub="An item's link must be on one of these domains (or a sub-domain). Checked when an item is saved and again when it is published.">
      <Field label="Domains, one per line"><textarea className="input" rows={10} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <div className="nl-actions">
        <Button small disabled={busy} onClick={() => void run(async () => { s.setData(await newsletterApi.setSettings(text.split(/\s+/).filter(Boolean))); toast('Official sites saved'); })}>Save</Button>
        <Button small variant="soft" onClick={() => setText((s.data?.defaults ?? []).join('\n'))}>Reset to the defaults</Button>
      </div>
      <ErrorNote error={error} />
    </SectionCard>
  );
}

function DeskAnalytics() {
  const a = useLoad(() => newsletterApi.analytics(), []);
  return (
    <Loadable state={a}>{(d) => (
      <div className="ops-stack">
        <div className="kpi-grid">
          <Tile label="Opens" value={d.totals.opens} /><Tile label="Clicks to official sites" value={d.totals.clicks} />
          <Tile label="Quiz players" value={d.totals.quizParticipants} /><Tile label="Saves" value={d.totals.saves} />
        </div>
        <SectionCard title="By edition">
          <div className="nl-table-wrap">
            <table className="nl-table">
              <thead><tr><th scope="col">Edition</th><th scope="col">Delivered</th><th scope="col">Emailed</th><th scope="col">Opens</th><th scope="col">Read to the end</th><th scope="col">Clicks</th><th scope="col">Quiz</th><th scope="col">Poll</th><th scope="col">Saves</th></tr></thead>
              <tbody>{d.editions.map((e) => (
                <tr key={e.id}><td>{e.periodLabel}<br /><span className="ops-muted">{humanize(e.cadence)}</span></td><td>{e.delivered}</td><td>{e.emailed}{Object.keys(e.emailByStatus).length ? <span className="ops-muted"> ({Object.entries(e.emailByStatus).map(([k, v]) => `${v} ${humanize(k).toLowerCase()}`).join(', ')})</span> : null}</td><td>{e.opens}</td><td>{e.completed}</td><td>{e.clicks}</td><td>{e.quizParticipants}{e.averageQuizScore !== null ? ` (avg ${e.averageQuizScore})` : ''}</td><td>{e.pollVotes}</td><td>{e.saves}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </SectionCard>
        {d.topClicked.length > 0 && <SectionCard title="Most opened official links"><ul className="nl-map-regions">{d.topClicked.map((t) => <li key={t.id}><span>{t.title}</span><b>{t.clicks}</b></li>)}</ul></SectionCard>}
        <DataNote>{d.note}</DataNote>
      </div>
    )}</Loadable>
  );
}

export function NewsletterDeskView() {
  const { permissions } = usePermissions();
  const initial = (useQueryParam('tab') as 'queue' | 'catalogue' | 'editions' | 'alerts' | 'comments' | 'sites' | 'analytics' | null) ?? 'queue';
  const [tab, setTab] = useState(initial);
  const probe = useLoad(() => newsletterApi.opportunities({ status: 'SUBMITTED' }), []);
  if (isOff(probe.error)) return <EmptyState icon="⏻" title="Opportunities and the newsletter are switched off" sub="An administrator can switch them on in Settings, Features." />;
  if (!permissions['digest.manage']) return <EmptyState icon="⚿" title="For the newsletter editor" sub="The principal and administrators edit the newsletter." />;
  return (
    <div className="ops-stack nl-root">
      <Tabs
        tabs={[
          { key: 'queue' as const, label: 'Review queue', count: probe.data?.counts?.SUBMITTED ?? null }, { key: 'catalogue' as const, label: 'Published' }, { key: 'editions' as const, label: 'Editions' }, { key: 'alerts' as const, label: 'Google Alerts' },
          { key: 'comments' as const, label: 'Comments' }, { key: 'sites' as const, label: 'Official sites' }, { key: 'analytics' as const, label: 'Analytics' },
        ]}
        value={tab} onChange={setTab}
      />
      {tab === 'queue' && <QueueTab status="SUBMITTED" />}
      {tab === 'catalogue' && <QueueTab status="PUBLISHED" />}
      {tab === 'editions' && <DeskEditions />}
      {tab === 'alerts' && <DeskAlerts />}
      {tab === 'comments' && <DeskComments />}
      {tab === 'sites' && <DeskSites />}
      {tab === 'analytics' && <DeskAnalytics />}
    </div>
  );
}
