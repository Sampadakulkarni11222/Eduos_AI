'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, SkeletonRows, StatCard, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { QuizListItem, QuizMyAttempt, QuizOverview, QuizPaper, QuizResult } from '@/lib/quiz-types';

/**
 * Student quizzes: Available Quizzes → Instructions → Attempt → Result.
 *
 * The server owns everything that matters: which quizzes are visible, the
 * question paper (sent without the answer key), the clock, and the marks.
 * This page only collects one choice per question and shows what comes back.
 */

type View =
  | { kind: 'list' }
  | { kind: 'intro'; id: string }
  | { kind: 'attempt'; paper: QuizPaper }
  | { kind: 'result'; result: QuizResult; fresh: boolean };

const errText = (e: unknown, fallback: string) => (e instanceof ApiError && e.message ? e.message : fallback);
const LETTERS = 'ABCDEF';

export default function StudentQuizzesPage() {
  const [view, setView] = useState<View>({ kind: 'list' });
  const toast = useToast();

  const openResult = async (quizId: string) => {
    try { setView({ kind: 'result', result: await api.myQuizResult(quizId), fresh: false }); } catch (e) { toast(errText(e, 'Could not load the result.'), 'error'); }
  };

  const back = <Button variant="ghost" onClick={() => setView({ kind: 'list' })}>← Back to Quizzes</Button>;

  if (view.kind === 'intro') {
    return (
      <PortalShell expectedSlug="student" topbar={{ title: 'Quiz Instructions', actions: back }}>
        <Intro id={view.id} onStarted={(paper) => setView({ kind: 'attempt', paper })} onViewResult={openResult} />
      </PortalShell>
    );
  }
  if (view.kind === 'attempt') {
    return (
      <PortalShell expectedSlug="student" topbar={{ title: view.paper.quiz.title, desc: `${view.paper.quiz.subject} · ${view.paper.quiz.totalMarks} marks` }}>
        <Attempt paper={view.paper} onSubmitted={(result) => setView({ kind: 'result', result, fresh: true })} />
      </PortalShell>
    );
  }
  if (view.kind === 'result') {
    return (
      <PortalShell expectedSlug="student" topbar={{ title: view.fresh ? 'Quiz Completed' : 'Quiz Result', actions: back }}>
        <ResultView result={view.result} onBack={() => setView({ kind: 'list' })} />
      </PortalShell>
    );
  }

  return (
    <PortalShell expectedSlug="student" topbar={{ title: 'Quizzes', desc: 'Quizzes published by your teachers. Results appear as soon as you submit.' }}>
      <QuizList onOpen={(id) => setView({ kind: 'intro', id })} onViewResult={openResult} />
    </PortalShell>
  );
}

/* ── List ───────────────────────────────────────────────────── */

function QuizList({ onOpen, onViewResult }: { onOpen: (id: string) => void; onViewResult: (id: string) => void }) {
  const [items, setItems] = useState<QuizListItem[] | null>(null);
  const [attempts, setAttempts] = useState<QuizMyAttempt[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.quizzes().then(setItems).catch((e) => { setErr(errText(e, 'Could not load quizzes.')); setItems([]); });
    api.myQuizAttempts().then(setAttempts).catch(() => {});
  }, []);

  const done = (q: QuizListItem) => q.myAttempt?.status === 'SUBMITTED' || q.myAttempt?.status === 'LATE';

  return (
    <>
      <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px' }}>Available Quizzes</h2>
      {items === null && <Card><SkeletonRows rows={3} /></Card>}
      {err && <EmptyState title="Couldn't load quizzes" sub={err} />}
      {!err && items?.length === 0 && <EmptyState title="No quizzes yet" sub="Quizzes your teachers publish for your class will appear here." />}
      {items && items.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
          {items.map((q) => (
            <Card key={q.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ fontWeight: 700, fontSize: 15.5 }}>{q.title}</div>
                {done(q)
                  ? <Pill tone="green">Completed</Pill>
                  : q.myAttempt?.status === 'IN_PROGRESS' ? <Pill tone="amber">In progress</Pill> : <Pill tone="blue">New</Pill>}
              </div>
              <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 10px', fontSize: 13, margin: '10px 0 14px', color: 'var(--text-2)' }}>
                <dt>Subject</dt><dd style={{ margin: 0, color: 'var(--text-1)' }}>{q.subject}</dd>
                <dt>Teacher</dt><dd style={{ margin: 0, color: 'var(--text-1)' }}>{q.teacher ?? '—'}</dd>
                <dt>Questions</dt><dd style={{ margin: 0, color: 'var(--text-1)' }}>{q.questionCount}</dd>
                <dt>Total marks</dt><dd style={{ margin: 0, color: 'var(--text-1)' }}>{q.totalMarks}</dd>
                {q.durationMinutes && <><dt>Duration</dt><dd style={{ margin: 0, color: 'var(--text-1)' }}>{q.durationMinutes} min</dd></>}
                {done(q) && <><dt>Score</dt><dd style={{ margin: 0, color: 'var(--text-1)', fontWeight: 700 }}>{q.myAttempt?.score} / {q.myAttempt?.totalMarks} ({q.myAttempt?.percentage}%)</dd></>}
              </dl>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                {done(q)
                  ? <Button variant="soft" small onClick={() => onViewResult(q.id)}>View Result</Button>
                  : <Button small onClick={() => onOpen(q.id)}>{q.myAttempt?.status === 'IN_PROGRESS' ? 'Resume Quiz' : 'Start Quiz'}</Button>}
              </div>
            </Card>
          ))}
        </div>
      )}

      {attempts.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: '24px 0 12px' }}>Previous Attempts</h2>
          <Card pad={false}>
            <table className="data-table data-table-cards">
              <thead><tr><th>Quiz</th><th>Subject</th><th>Marks</th><th>Percentage</th><th>Submitted</th><th></th></tr></thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.id}>
                    <td className="cell-primary" data-label="Quiz">{a.quizTitle}</td>
                    <td data-label="Subject">{a.subject ?? '—'}</td>
                    <td data-label="Marks">{a.score} / {a.totalMarks}</td>
                    <td data-label="Percentage">{a.percentage}%</td>
                    <td data-label="Submitted" style={{ fontSize: 12.5 }}>{a.submittedAt ? new Date(a.submittedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—'}</td>
                    <td data-label="Actions"><Button variant="ghost" small onClick={() => onViewResult(a.quizId)}>View Result</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}

/* ── Instructions ───────────────────────────────────────────── */

function Intro({ id, onStarted, onViewResult }: { id: string; onStarted: (p: QuizPaper) => void; onViewResult: (id: string) => void }) {
  const [data, setData] = useState<QuizOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.quizOverview(id).then(setData).catch((e) => setErr(errText(e, 'Could not load this quiz.'))); }, [id]);

  if (err) return <EmptyState title="Quiz unavailable" sub={err} />;
  if (!data) return <Card><SkeletonRows rows={3} /></Card>;
  const { quiz, myAttempt } = data;
  const submitted = myAttempt?.status === 'SUBMITTED' || myAttempt?.status === 'LATE';

  const start = async () => {
    setBusy(true); setErr(null);
    try { onStarted(await api.startQuiz(id)); } catch (e) { setErr(errText(e, 'Could not start the quiz.')); setBusy(false); }
  };

  return (
    <Card style={{ maxWidth: 680 }}>
      <div style={{ fontWeight: 700, fontSize: 18 }}>{quiz.title}</div>
      <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
        {quiz.subject}{quiz.teacher ? ` · ${quiz.teacher}` : ''} · {quiz.questionCount} questions · {quiz.totalMarks} marks
        {quiz.durationMinutes ? ` · ${quiz.durationMinutes} minutes` : ''}
      </div>
      {quiz.description && <p style={{ marginTop: 14, whiteSpace: 'pre-wrap', fontSize: 14 }}>{quiz.description}</p>}
      <ul style={{ marginTop: 14, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7 }}>
        <li>Each question has exactly one correct answer.</li>
        <li>You can move between questions and change answers before submitting.</li>
        <li>You have <strong>one attempt</strong>. Your result appears as soon as you submit.</li>
        {quiz.durationMinutes && <li>The timer starts when you press Start and the quiz submits itself when time runs out.</li>}
      </ul>
      <div style={{ marginTop: 18 }}>
        {submitted
          ? <Button variant="soft" onClick={() => onViewResult(quiz.id)}>View Result</Button>
          : <Button onClick={start} disabled={busy}>{busy ? 'Starting…' : myAttempt?.status === 'IN_PROGRESS' ? 'Resume Quiz' : 'Start Quiz'}</Button>}
      </div>
    </Card>
  );
}

/* ── Attempt ────────────────────────────────────────────────── */

function Attempt({ paper, onSubmitted }: { paper: QuizPaper; onSubmitted: (r: QuizResult) => void }) {
  const questions = paper.questions;
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submittedRef = useRef(false);
  const answersRef = useRef(answers);
  answersRef.current = answers;

  // Measure the deadline against the server's clock, not the device's.
  const [skewMs] = useState(() => new Date(paper.serverNow).getTime() - Date.now());
  const deadlineMs = paper.deadline ? new Date(paper.deadline).getTime() : null;
  const [now, setNow] = useState(() => Date.now() + skewMs);
  const remainingMs = deadlineMs ? Math.max(0, deadlineMs - now) : null;

  const submit = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setBusy(true); setErr(null);
    try {
      const sheet = Object.entries(answersRef.current).map(([questionId, optionId]) => ({ questionId, optionId }));
      onSubmitted(await api.submitQuiz(paper.quiz.id, sheet));
    } catch (e) {
      submittedRef.current = false;
      setErr(errText(e, 'Could not submit. Check your connection and try again.'));
      setBusy(false);
    }
  }, [paper.quiz.id, onSubmitted]);

  useEffect(() => {
    if (!deadlineMs) return;
    const t = setInterval(() => setNow(Date.now() + skewMs), 1000);
    return () => clearInterval(t);
  }, [deadlineMs, skewMs]);

  useEffect(() => {
    if (remainingMs === 0) void submit();
  }, [remainingMs, submit]);

  if (questions.length === 0) return <EmptyState title="No questions" sub="This quiz has no questions." />;
  const q = questions[index];
  const answered = Object.keys(answers).length;

  const confirmSubmit = () => {
    const missing = questions.length - answered;
    if (missing > 0 && !window.confirm(`You have ${missing} unanswered question${missing === 1 ? '' : 's'}. Submit anyway?`)) return;
    void submit();
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700 }}>Question {index + 1} of {questions.length}</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{answered}/{questions.length} answered</span>
          {remainingMs !== null && (
            <Pill tone={remainingMs < 60_000 ? 'red' : remainingMs < 5 * 60_000 ? 'amber' : 'blue'}>
              ⏱ {fmtClock(remainingMs)}
            </Pill>
          )}
        </div>
      </div>

      <Card>
        <div style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 600 }}>{q.marks} mark{q.marks === 1 ? '' : 's'}</div>
        <div style={{ fontWeight: 600, fontSize: 16, marginTop: 4, whiteSpace: 'pre-wrap' }} id={`q-${q.id}`}>{q.text}</div>
        <div role="radiogroup" aria-labelledby={`q-${q.id}`} style={{ display: 'grid', gap: 8, marginTop: 14 }}>
          {q.options.map((o, i) => {
            const checked = answers[q.id] === o.id;
            return (
              <label key={o.id} style={{
                display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                border: `1px solid ${checked ? 'var(--accent)' : 'var(--hairline)'}`,
                background: checked ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : undefined,
              }}>
                <input type="radio" name={`q-${q.id}`} checked={checked} disabled={busy}
                  onChange={() => setAnswers((a) => ({ ...a, [q.id]: o.id }))} style={{ accentColor: 'var(--accent)' }} />
                <span style={{ fontWeight: 700 }}>{LETTERS[i]}.</span>
                <span>{o.text}</span>
              </label>
            );
          })}
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '14px 0' }} aria-label="Jump to question">
        {questions.map((item, i) => (
          <button key={item.id} type="button" onClick={() => setIndex(i)} aria-label={`Question ${i + 1}${answers[item.id] ? ', answered' : ''}`}
            aria-current={i === index ? 'step' : undefined}
            style={{
              width: 32, height: 32, borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12.5,
              border: `1px solid ${i === index ? 'var(--accent)' : 'var(--hairline)'}`,
              background: answers[item.id] ? 'var(--accent)' : 'transparent',
              color: answers[item.id] ? '#fff' : 'inherit',
            }}>{i + 1}</button>
        ))}
      </div>

      {err && <p role="alert" style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" disabled={index === 0 || busy} onClick={() => setIndex((i) => i - 1)}>Previous</Button>
          <Button variant="soft" disabled={index === questions.length - 1 || busy} onClick={() => setIndex((i) => i + 1)}>Next</Button>
        </div>
        <Button onClick={confirmSubmit} disabled={busy}>{busy ? 'Submitting…' : 'Submit Quiz'}</Button>
      </div>
    </div>
  );
}

function fmtClock(ms: number) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* ── Result ─────────────────────────────────────────────────── */

function ResultView({ result, onBack }: { result: QuizResult; onBack: () => void }) {
  const [showDetail, setShowDetail] = useState(false);
  return (
    <div style={{ maxWidth: 760 }}>
      <Card style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{result.quizTitle}{result.subject ? ` · ${result.subject}` : ''}</div>
        <div style={{ fontSize: 40, fontWeight: 800, marginTop: 8 }}>{result.score} / {result.totalMarks}</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>{result.percentage}%</div>
        {result.status === 'LATE' && <div style={{ marginTop: 6 }}><Pill tone="amber">Submitted after the time limit</Pill></div>}
      </Card>
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Correct" value={result.correctCount} />
        <StatCard label="Wrong" value={result.wrongCount} />
        <StatCard label="Unanswered" value={result.unansweredCount} />
        <StatCard label="Questions" value={result.totalQuestions} />
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <Button variant="ghost" onClick={onBack}>Back to Quizzes</Button>
        <Button variant="soft" onClick={() => setShowDetail((v) => !v)}>{showDetail ? 'Hide details' : 'View Result'}</Button>
      </div>
      {showDetail && (
        <Card pad={false}>
          <table className="data-table data-table-cards">
            <thead><tr><th>#</th><th>Question</th><th>Your answer</th><th>Result</th><th>Marks</th></tr></thead>
            <tbody>
              {result.answers.map((a, i) => (
                <tr key={a.questionId}>
                  <td data-label="#">{i + 1}</td>
                  <td className="cell-primary" data-label="Question">{a.questionText}</td>
                  <td data-label="Your answer">{a.selectedOptionText ?? <span style={{ color: 'var(--text-faint)' }}>Not answered</span>}</td>
                  <td data-label="Result">
                    {a.selectedOptionId === null ? <Pill tone="gray">Skipped</Pill> : a.isCorrect ? <Pill tone="green">Correct</Pill> : <Pill tone="red">Wrong</Pill>}
                  </td>
                  <td data-label="Marks">{a.marksAwarded}{a.marks != null ? ` / ${a.marks}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
