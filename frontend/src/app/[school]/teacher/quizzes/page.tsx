'use client';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, SkeletonRows, StatCard, divisionLabel, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { OfferingDto } from '@/lib/types';
import type { QuizDetail, QuizListItem, QuizQuestion, QuizQuestionInput, QuizResults } from '@/lib/quiz-types';

/**
 * Teacher quiz management: list → create → question builder → results.
 * One page with in-page views, the way the other teacher screens use modals
 * and panels rather than nested routes. Every rule shown here (own classes
 * only, exactly one correct option, no publishing incomplete quizzes) is
 * enforced again by the API.
 */

type View = { kind: 'list' } | { kind: 'edit'; id: string } | { kind: 'results'; id: string };

const STATUS_TONE: Record<string, 'green' | 'gray'> = { PUBLISHED: 'green', DRAFT: 'gray' };
const LETTERS = 'ABCDEF';
const errText = (e: unknown, fallback: string) => (e instanceof ApiError && e.message ? e.message : fallback);

export default function TeacherQuizzesPage() {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [items, setItems] = useState<QuizListItem[] | null>(null);
  const [offerings, setOfferings] = useState<OfferingDto[]>([]);
  const [showForm, setShowForm] = useState(false);

  const reload = () => api.quizzes().then(setItems).catch(() => setItems([]));
  useEffect(() => { void reload(); api.myOfferings().then(setOfferings).catch(() => {}); }, []);

  const backToList = () => { setView({ kind: 'list' }); void reload(); };

  if (view.kind === 'edit') {
    return (
      <PortalShell expectedSlug="teacher" topbar={{ title: 'Quiz Builder', desc: 'Add MCQ questions, then publish to your class.', actions: <Button variant="ghost" onClick={backToList}>← All quizzes</Button> }}>
        <QuizBuilder id={view.id} onDeleted={backToList} onResults={() => setView({ kind: 'results', id: view.id })} />
      </PortalShell>
    );
  }
  if (view.kind === 'results') {
    return (
      <PortalShell expectedSlug="teacher" topbar={{ title: 'Quiz Results', desc: 'Marks for every student in the class.', actions: <Button variant="ghost" onClick={backToList}>← All quizzes</Button> }}>
        <ResultsView id={view.id} />
      </PortalShell>
    );
  }

  return (
    <PortalShell expectedSlug="teacher" topbar={{
      title: 'Quizzes', desc: 'MCQ quizzes for your classes — graded automatically when students submit.',
      actions: <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Close' : '+ Create Quiz'}</Button>,
    }}>
      {showForm && (
        <NewQuiz offerings={offerings} onCreated={(q) => { setShowForm(false); setView({ kind: 'edit', id: q.id }); }} />
      )}

      {items === null && <Card><SkeletonRows rows={4} /></Card>}
      {items?.length === 0 && (
        <EmptyState title="No quizzes yet" sub="Create a quiz for one of your classes, add questions and publish it." />
      )}
      {items && items.length > 0 && (
        <Card pad={false}>
          <table className="data-table data-table-cards">
            <thead><tr><th>Quiz</th><th>Class</th><th>Subject</th><th>Questions</th><th>Marks</th><th>Status</th><th>Attempts</th><th></th></tr></thead>
            <tbody>
              {items.map((q) => (
                <tr key={q.id}>
                  <td className="cell-primary" data-label="Quiz">{q.title}</td>
                  <td data-label="Class">{divisionLabel(q.gradeName, q.sectionName)}</td>
                  <td data-label="Subject">{q.subject}</td>
                  <td data-label="Questions">{q.questionCount}</td>
                  <td data-label="Marks">{q.totalMarks}</td>
                  <td data-label="Status"><Pill tone={STATUS_TONE[q.status] ?? 'gray'}>{q.status === 'PUBLISHED' ? 'Published' : 'Draft'}</Pill></td>
                  <td data-label="Attempts">{q.attemptCount ?? 0}</td>
                  <td data-label="Actions">
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button variant="soft" small onClick={() => setView({ kind: 'edit', id: q.id })}>Manage</Button>
                      <Button variant="ghost" small onClick={() => setView({ kind: 'results', id: q.id })}>Results</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </PortalShell>
  );
}

/* ── Create ─────────────────────────────────────────────────── */

/** Class, then subject — both drawn only from the teacher's own assignments. */
function useClassSubjectPicker(offerings: OfferingDto[], initialOfferingId = '') {
  const initial = offerings.find((o) => o.id === initialOfferingId);
  const [sectionId, setSectionId] = useState(initial?.sectionId ?? '');
  const [offeringId, setOfferingId] = useState(initialOfferingId);

  const classes = useMemo(() => {
    const seen = new Map<string, string>();
    offerings.forEach((o) => seen.set(o.sectionId, divisionLabel(o.gradeName, o.sectionName)));
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }));
  }, [offerings]);
  const subjects = useMemo(() => offerings.filter((o) => o.sectionId === sectionId), [offerings, sectionId]);

  // Default to the first class, and keep the subject valid for the chosen class.
  useEffect(() => { if (!sectionId && classes[0]) setSectionId(classes[0][0]); }, [classes, sectionId]);
  useEffect(() => {
    if (!subjects.some((o) => o.id === offeringId)) setOfferingId(subjects[0]?.id ?? '');
  }, [subjects, offeringId]);

  return { sectionId, setSectionId, offeringId, setOfferingId, classes, subjects };
}

function NewQuiz({ offerings, onCreated }: { offerings: OfferingDto[]; onCreated: (q: QuizDetail) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const picker = useClassSubjectPicker(offerings);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setErr('Quiz title is required.'); return; }
    if (!picker.offeringId) { setErr('Select a class and subject.'); return; }
    setBusy(true); setErr(null);
    try {
      const q = await api.createQuiz({
        title: title.trim(), description: description.trim() || undefined,
        subjectOfferingId: picker.offeringId, durationMinutes: duration ? Number(duration) : null,
      });
      onCreated(q);
    } catch (e2) { setErr(errText(e2, 'Could not create the quiz.')); } finally { setBusy(false); }
  };

  if (offerings.length === 0) {
    return <Card style={{ marginBottom: 16 }}><EmptyState title="No classes assigned" sub="You can create quizzes once an administrator assigns you a class and subject." /></Card>;
  }

  return (
    <Card style={{ marginBottom: 16 }}>
      <form onSubmit={submit}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Create Quiz</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="field-label" htmlFor="quiz-title">Quiz title</label>
            <input id="quiz-title" className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} placeholder="Java Basics" />
          </div>
          <div>
            <label className="field-label" htmlFor="quiz-class">Class</label>
            <select id="quiz-class" className="field-input" value={picker.sectionId} onChange={(e) => picker.setSectionId(e.target.value)} required>
              {picker.classes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="quiz-subject">Subject</label>
            <select id="quiz-subject" className="field-input" value={picker.offeringId} onChange={(e) => picker.setOfferingId(e.target.value)} required>
              {picker.subjects.map((o) => <option key={o.id} value={o.id}>{o.subject}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="quiz-duration">Duration (minutes, optional)</label>
            <input id="quiz-duration" className="field-input" type="number" min={1} max={600} step={1} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="No time limit" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="field-label" htmlFor="quiz-desc">Description / instructions (optional)</label>
            <textarea id="quiz-desc" className="field-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} placeholder="Answer all questions. Each question has one correct answer." />
          </div>
        </div>
        {err && <p role="alert" style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{err}</p>}
        <Button type="submit" disabled={busy || !picker.offeringId} style={{ marginTop: 12 }}>{busy ? 'Saving…' : 'Save & Add Questions'}</Button>
      </form>
    </Card>
  );
}

/* ── Builder ────────────────────────────────────────────────── */

function QuizBuilder({ id, onDeleted, onResults }: { id: string; onDeleted: () => void; onResults: () => void }) {
  const [quiz, setQuiz] = useState<QuizDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<QuizQuestion | 'new' | null>(null);
  const [editingMeta, setEditingMeta] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.quiz(id).then((q) => { setQuiz(q); if (q.questions.length === 0) setEditing('new'); })
      .catch((e) => setErr(errText(e, 'Could not load the quiz.')));
  }, [id]);

  if (err) return <EmptyState title="Couldn't load" sub={err} />;
  if (!quiz) return <Card><SkeletonRows rows={5} /></Card>;

  const published = quiz.status === 'PUBLISHED';
  const run = async (fn: () => Promise<QuizDetail | void>, ok: string) => {
    setBusy(true);
    try {
      const next = await fn();
      if (next) setQuiz(next);
      toast(ok);
    } catch (e) { toast(errText(e, 'Something went wrong.'), 'error'); } finally { setBusy(false); }
  };

  return (
    <>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 17 }}>{quiz.title}</span>
              <Pill tone={STATUS_TONE[quiz.status]}>{published ? 'Published' : 'Draft'}</Pill>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
              {divisionLabel(quiz.gradeName, quiz.sectionName)} · {quiz.subject} · {quiz.questions.length} question{quiz.questions.length === 1 ? '' : 's'} · {quiz.totalMarks} marks
              {quiz.durationMinutes ? ` · ${quiz.durationMinutes} min` : ' · untimed'}
              {quiz.attemptCount > 0 && ` · ${quiz.attemptCount} attempt${quiz.attemptCount === 1 ? '' : 's'}`}
              {quiz.inProgressCount > 0 && ` · ${quiz.inProgressCount} in progress`}
            </div>
            {quiz.description && <p style={{ fontSize: 13, marginTop: 8, whiteSpace: 'pre-wrap' }}>{quiz.description}</p>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="ghost" small onClick={() => setEditingMeta((v) => !v)} disabled={busy}>Edit details</Button>
            <Button variant="soft" small onClick={onResults}>Results</Button>
            {published
              ? <Button small variant="soft" disabled={busy} onClick={() => run(() => api.unpublishQuiz(quiz.id), 'Quiz unpublished — students can no longer see it.')}>Unpublish</Button>
              : <Button small disabled={busy || quiz.questions.length === 0} onClick={() => run(() => api.publishQuiz(quiz.id), 'Quiz published to the class.')}>Publish Quiz</Button>}
            {quiz.editable && (
              <Button variant="ghost" small disabled={busy} onClick={async () => {
                if (!window.confirm('Delete this quiz? This cannot be undone.')) return;
                try { await api.deleteQuiz(quiz.id); toast('Quiz deleted.'); onDeleted(); } catch (e) { toast(errText(e, 'Could not delete the quiz.'), 'error'); }
              }}>Delete</Button>
            )}
          </div>
        </div>
        {!quiz.editable && (
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 10 }}>
            Students have started this quiz, so its questions are locked to keep results fair.
          </p>
        )}
        {editingMeta && (
          <MetaForm quiz={quiz} onCancel={() => setEditingMeta(false)} onSaved={(q) => { setQuiz(q); setEditingMeta(false); toast('Quiz details saved.'); }} />
        )}
      </Card>

      {quiz.questions.map((q, i) => (
        editing !== 'new' && editing?.id === q.id ? (
          <QuestionForm
            key={q.id} index={i} initial={q}
            onCancel={() => setEditing(null)}
            onSave={async (body) => { const next = await api.updateQuizQuestion(quiz.id, q.id, body); setQuiz(next); setEditing(null); toast(`Question ${i + 1} saved.`); }}
          />
        ) : (
          <Card key={q.id} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 600 }}>Question {i + 1} · {q.marks} mark{q.marks === 1 ? '' : 's'}</div>
                <div style={{ fontWeight: 600, marginTop: 4, whiteSpace: 'pre-wrap' }}>{q.text}</div>
                <ol style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: 4 }}>
                  {q.options.map((o, j) => (
                    <li key={o.id} style={{ fontSize: 13.5, color: o.isCorrect ? 'var(--green, #2c6049)' : undefined, fontWeight: o.isCorrect ? 700 : 400 }}>
                      {LETTERS[j]}. {o.text}{o.isCorrect && ' ✓'}
                    </li>
                  ))}
                </ol>
              </div>
              {quiz.editable && (
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <Button variant="soft" small disabled={busy} onClick={() => setEditing(q)}>Edit</Button>
                  {!published && (
                    <Button variant="ghost" small disabled={busy} onClick={() => {
                      if (!window.confirm(`Delete question ${i + 1}?`)) return;
                      void run(() => api.deleteQuizQuestion(quiz.id, q.id), 'Question deleted.');
                    }}>Delete</Button>
                  )}
                </div>
              )}
            </div>
          </Card>
        )
      ))}

      {quiz.editable && (editing === 'new' ? (
        <QuestionForm
          index={quiz.questions.length}
          onCancel={quiz.questions.length > 0 ? () => setEditing(null) : undefined}
          onSave={async (body) => { const next = await api.addQuizQuestion(quiz.id, body); setQuiz(next); setEditing('new'); toast('Question added.'); }}
        />
      ) : (
        <Button onClick={() => setEditing('new')} disabled={busy}>+ Add Question</Button>
      ))}
    </>
  );
}

function MetaForm({ quiz, onSaved, onCancel }: { quiz: QuizDetail; onSaved: (q: QuizDetail) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(quiz.title);
  const [description, setDescription] = useState(quiz.description);
  const [duration, setDuration] = useState(quiz.durationMinutes ? String(quiz.durationMinutes) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setErr('Quiz title is required.'); return; }
    setBusy(true); setErr(null);
    try {
      onSaved(await api.updateQuiz(quiz.id, { title: title.trim(), description, durationMinutes: duration ? Number(duration) : null }));
    } catch (e2) { setErr(errText(e2, 'Could not save.')); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} style={{ borderTop: '1px solid var(--hairline)', marginTop: 12, paddingTop: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <div>
          <label className="field-label" htmlFor="meta-title">Title</label>
          <input id="meta-title" className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
        </div>
        <div>
          <label className="field-label" htmlFor="meta-duration">Duration (minutes, optional)</label>
          <input id="meta-duration" className="field-input" type="number" min={1} max={600} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="No time limit" />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="field-label" htmlFor="meta-desc">Description / instructions</label>
          <textarea id="meta-desc" className="field-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
        </div>
      </div>
      {err && <p role="alert" style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{err}</p>}
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <Button type="submit" small disabled={busy}>{busy ? 'Saving…' : 'Save details'}</Button>
        <Button type="button" variant="ghost" small onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
}

/** Mirrors the server's question rules so mistakes are caught before a round trip. */
function validateQuestion(text: string, options: string[], correct: number | null, marks: string): string | null {
  if (!text.trim()) return 'Question text is required.';
  if (options.length < 2) return 'Add at least two options.';
  const blank = options.findIndex((o) => !o.trim());
  if (blank >= 0) return `Option ${LETTERS[blank]} cannot be empty.`;
  if (new Set(options.map((o) => o.trim().toLowerCase())).size !== options.length) return 'Two options have the same text.';
  if (correct === null || correct < 0 || correct >= options.length) return 'Select the correct answer.';
  const m = Number(marks);
  if (!Number.isFinite(m) || m <= 0 || m > 100 || Math.round(m * 2) !== m * 2) return 'Marks must be a positive number (steps of 0.5, max 100).';
  return null;
}

function QuestionForm({ index, initial, onSave, onCancel }: {
  index: number;
  initial?: QuizQuestion;
  onSave: (body: QuizQuestionInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initial?.text ?? '');
  const [options, setOptions] = useState<string[]>(initial ? initial.options.map((o) => o.text) : ['', '', '', '']);
  const [correct, setCorrect] = useState<number | null>(initial ? initial.options.findIndex((o) => o.isCorrect) : null);
  const [marks, setMarks] = useState(String(initial?.marks ?? 1));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const groupName = `correct-${initial?.id ?? 'new'}`;

  const reset = () => { setText(''); setOptions(['', '', '', '']); setCorrect(null); setMarks('1'); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = validateQuestion(text, options, correct, marks);
    if (problem) { setErr(problem); return; }
    setBusy(true); setErr(null);
    try {
      await onSave({ text: text.trim(), marks: Number(marks), options: options.map((o, i) => ({ text: o.trim(), isCorrect: i === correct })) });
      if (!initial) reset();
    } catch (e2) { setErr(errText(e2, 'Could not save the question.')); } finally { setBusy(false); }
  };

  const removeOption = (i: number) => {
    setOptions((prev) => prev.filter((_, idx) => idx !== i));
    setCorrect((c) => (c === null ? null : c === i ? null : c > i ? c - 1 : c));
  };

  return (
    <Card style={{ marginBottom: 12 }}>
      <form onSubmit={submit}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Question {index + 1}</div>
        <label className="field-label" htmlFor={`${groupName}-text`}>Question</label>
        <textarea id={`${groupName}-text`} className="field-input" rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} required />

        <fieldset style={{ border: 'none', padding: 0, margin: '12px 0 0' }}>
          <legend className="field-label">Options — select the correct answer</legend>
          <div style={{ display: 'grid', gap: 8 }}>
            {options.map((o, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="radio" name={groupName} checked={correct === i} onChange={() => setCorrect(i)}
                  aria-label={`Option ${LETTERS[i]} is correct`} style={{ accentColor: 'var(--accent)' }}
                />
                <span style={{ fontWeight: 700, width: 18 }}>{LETTERS[i]}.</span>
                <input
                  className="field-input" value={o} maxLength={500} aria-label={`Option ${LETTERS[i]}`}
                  onChange={(e) => setOptions((prev) => prev.map((p, idx) => (idx === i ? e.target.value : p)))}
                />
                {options.length > 2 && (
                  <button type="button" onClick={() => removeOption(i)} aria-label={`Remove option ${LETTERS[i]}`}
                    style={{ background: 'none', border: 'none', color: 'var(--red, #b52a2a)', cursor: 'pointer', fontSize: 16 }}>×</button>
                )}
              </div>
            ))}
          </div>
          {options.length < 6 && (
            <Button type="button" variant="ghost" small style={{ marginTop: 8 }} onClick={() => setOptions((p) => [...p, ''])}>+ Add option</Button>
          )}
        </fieldset>

        <div style={{ marginTop: 12, maxWidth: 140 }}>
          <label className="field-label" htmlFor={`${groupName}-marks`}>Marks</label>
          <input id={`${groupName}-marks`} className="field-input" type="number" min={0.5} max={100} step={0.5} value={marks} onChange={(e) => setMarks(e.target.value)} required />
        </div>

        {err && <p role="alert" style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{err}</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <Button type="submit" small disabled={busy}>{busy ? 'Saving…' : 'Save Question'}</Button>
          {onCancel && <Button type="button" variant="ghost" small onClick={onCancel} disabled={busy}>Cancel</Button>}
        </div>
      </form>
    </Card>
  );
}

/* ── Results ────────────────────────────────────────────────── */

const ATTEMPT_LABEL: Record<string, { text: string; tone: 'green' | 'amber' | 'gray' | 'blue' }> = {
  SUBMITTED: { text: 'Submitted', tone: 'green' },
  LATE: { text: 'Submitted late', tone: 'amber' },
  IN_PROGRESS: { text: 'In progress', tone: 'blue' },
  NOT_ATTEMPTED: { text: 'Not attempted', tone: 'gray' },
};

function ResultsView({ id }: { id: string }) {
  const [data, setData] = useState<QuizResults | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.quizResults(id).then(setData).catch((e) => setErr(errText(e, 'Could not load results.'))); }, [id]);

  if (err) return <EmptyState title="Couldn't load" sub={err} />;
  if (!data) return <Card><SkeletonRows rows={5} /></Card>;
  const { quiz, summary } = data;

  return (
    <>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 17 }}>{quiz.title}</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
          Class: {divisionLabel(quiz.gradeName, quiz.sectionName)} · Subject: {quiz.subject} · Total marks: {quiz.totalMarks}
        </div>
      </Card>

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Attempted" value={`${summary.attemptedCount} / ${summary.rosterSize}`} />
        <StatCard label="Average" value={summary.averageScore != null ? `${summary.averageScore}` : '—'} delta={summary.averagePercentage != null ? `${summary.averagePercentage}%` : undefined} />
        <StatCard label="Highest" value={summary.highestScore ?? '—'} />
        <StatCard label="Lowest" value={summary.lowestScore ?? '—'} />
      </div>

      {data.rows.length === 0 ? (
        <EmptyState title="No students" sub="There are no students enrolled in this class." />
      ) : (
        <Card pad={false}>
          <table className="data-table data-table-cards">
            <thead><tr><th>Roll</th><th>Student Name</th><th>Student ID</th><th>Marks</th><th>Percentage</th><th>Status</th><th>Submitted</th></tr></thead>
            <tbody>
              {data.rows.map((r, i) => {
                const label = ATTEMPT_LABEL[r.status] ?? ATTEMPT_LABEL.NOT_ATTEMPTED;
                return (
                  <tr key={r.studentId ?? i}>
                    <td data-label="Roll">{r.rollNo ?? '—'}</td>
                    <td className="cell-primary" data-label="Student Name">{r.studentName}</td>
                    <td data-label="Student ID">{r.admissionNo ?? '—'}</td>
                    <td data-label="Marks">{r.score != null ? `${r.score}/${r.totalMarks}` : '—'}</td>
                    <td data-label="Percentage">{r.percentage != null ? `${r.percentage}%` : '—'}</td>
                    <td data-label="Status"><Pill tone={label.tone}>{label.text}</Pill></td>
                    <td data-label="Submitted" style={{ fontSize: 12.5 }}>{r.submittedAt ? fmtDateTime(r.submittedAt) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
