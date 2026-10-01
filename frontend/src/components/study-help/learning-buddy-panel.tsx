'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Card, EmptyState, Field, Pill, SkeletonRows } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useSchoolHref } from '@/lib/school-path';
import type { LearnModeDto, LearnModeKey, LearnReplyDto, LearnStatusDto, TutorSyllabusDto } from '@/lib/types';
import { ResultView } from './results/result-view';

/**
 * Student Study Help, powered by the Student Learning Buddy skill.
 *
 * Students only. The parent portal keeps the original TutorPanel and the
 * original /ai/tutor endpoint; this panel talks to /ai/tutor/learn, which the
 * server refuses for every other role.
 *
 * The rules carried over from TutorPanel, on purpose:
 *
 * 1. **Model output is rendered as text, never as HTML.** Every result view
 *    goes through React text nodes (see results/shared.tsx); nothing here uses
 *    dangerouslySetInnerHTML.
 * 2. **A study plan is never dressed up as an AI answer.** When no valid answer
 *    is available the server returns `generated: false`, and it is labelled as
 *    a study plan.
 * 3. **The subject list is a convenience, not a control.** The server resolves
 *    what this student may be taught from their own enrolment.
 */

const TOPIC_MAX = 200;

/** Used only if the status call fails, so the form still renders the approved modes. */
const FALLBACK_MODES: LearnModeDto[] = [
  { key: 'explain', label: 'Explanation', description: 'The core idea, an example and why it works.' },
  { key: 'worked', label: 'Step-by-step', description: 'One problem worked through step by step.' },
  { key: 'questions', label: 'Practice', description: 'Questions one at a time, with hints.' },
  { key: 'quiz', label: 'Quiz', description: 'Multiple choice, scored as you go.' },
  { key: 'flashcards', label: 'Flashcards', description: 'Recall, then flip.' },
  { key: 'notes', label: 'Revision notes', description: 'Condensed notes and self-test prompts.' },
  { key: 'mindmap', label: 'Mind map', description: 'The topic as an expandable tree.' },
  { key: 'exam', label: 'Exam answer', description: 'Exam-style questions with model answers.' },
];

const MODE_ICONS: Record<LearnModeKey, string> = {
  explain: '💡', worked: '🪜', questions: '✎', quiz: '☑', flashcards: '🃏', notes: '≣', mindmap: '⌘', exam: '🎓',
};

export const EMPTY_STATE_GROUNDING = 'Grounded in your class, subjects and course material on record.';

export function LearningBuddyPanel() {
  const link = useSchoolHref();
  const [status, setStatus] = useState<LearnStatusDto | null>(null);
  const [syllabus, setSyllabus] = useState<TutorSyllabusDto | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [mode, setMode] = useState<LearnModeKey>('explain');

  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<LearnReplyDto | null>(null);
  const [replyKey, setReplyKey] = useState(0);
  const [error, setError] = useState<{ text: string; paywall: boolean } | null>(null);
  const [creditsLeft, setCreditsLeft] = useState<number | null>(null);

  useEffect(() => {
    api.learnStatus()
      .then(setStatus)
      .catch((e: unknown) => {
        // A 403 means this account is not a student — say so rather than showing a form that will refuse.
        if (e instanceof ApiError && e.status === 403) setSetupError(e.message);
        else setStatus({ llmEnabled: false, modes: FALLBACK_MODES, skill: { name: 'Student Learning Buddy', version: '' } });
      });
    api.tutorSyllabus()
      .then((s) => { setSyllabus(s); setSubject(s.subjects[0]?.name ?? ''); })
      .catch((e: unknown) => setSetupError(e instanceof Error ? e.message : 'Could not load your class details.'));
    api.aiCredits()
      .then((c) => setCreditsLeft(c.metered ? c.totalRemaining ?? 0 : null))
      .catch(() => setCreditsLeft(null));
  }, []);

  const modes = status?.modes?.length ? status.modes : FALLBACK_MODES;
  const activeMode = modes.find((m) => m.key === mode) ?? modes[0];
  const trimmed = topic.trim();
  const canAsk = !busy && !!trimmed && !!subject && trimmed.length <= TOPIC_MAX;

  const ask = async () => {
    if (!canAsk) return;
    setBusy(true);
    setError(null);
    setReply(null);
    try {
      const result = await api.learn({ topic: trimmed, subject, mode });
      setReply(result);
      setReplyKey((k) => k + 1); // fresh interactive state for every new result
      if (result.credits) setCreditsLeft(result.credits.remaining);
    } catch (e) {
      const text = e instanceof Error ? e.message : 'Something went wrong. Please try again.';
      // Keyed on the status/code the API sends, not on the wording of the message.
      const paywall = e instanceof ApiError && (e.status === 402 || e.code === 'AI_CREDITS_EXHAUSTED');
      setError({ text, paywall });
      if (paywall) setCreditsLeft(0);
    } finally {
      setBusy(false);
    }
  };

  if (setupError) {
    return (
      <Card>
        <EmptyState title="Study help is not available yet" sub={setupError} />
      </Card>
    );
  }

  if (syllabus === null || status === null) {
    return <Card><SkeletonRows rows={4} /></Card>;
  }

  const isRedirect = reply?.structured?.type === 'redirect';

  return (
    // Two columns side by side where there is room, stacked on a phone —
    // flex-wrap with a wide grow ratio on the results, no media query needed.
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ flex: '1 1 300px', maxWidth: '100%', minWidth: 0 }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Ask for help</strong>
            {creditsLeft !== null && (
              <Pill tone={creditsLeft > 0 ? 'blue' : 'red'}>{creditsLeft} credits</Pill>
            )}
          </div>

          <p style={{ fontSize: 12.5, color: 'var(--text-2b)', marginBottom: 14 }}>
            {syllabus.className} · answers are pitched to your class and your own results.
          </p>

          {syllabus.subjects.length === 0 ? (
            <p role="alert" style={{ fontSize: 13, color: 'var(--red)', marginBottom: 12 }}>
              No subjects are set up for your class yet. Ask your school office.
            </p>
          ) : (
            <Field label="Subject" hint="Only the subjects you actually study are listed.">
              <select value={subject} onChange={(e) => setSubject(e.target.value)}>
                {syllabus.subjects.map((s) => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
            </Field>
          )}

          <Field
            label="Topic"
            required
            hint="e.g. fractions, photosynthesis, the water cycle"
            error={trimmed.length > TOPIC_MAX ? `Keep it under ${TOPIC_MAX} characters — a few words is best.` : undefined}
          >
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void ask(); }}
              placeholder="What do you want help with?"
            />
          </Field>

          <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
            <legend className="field-label">What would help most?</legend>
            <div role="group" aria-label="Learning mode" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 6 }}>
              {modes.map((m) => {
                const selected = m.key === mode;
                return (
                  <button
                    key={m.key}
                    type="button"
                    aria-pressed={selected}
                    title={m.description}
                    onClick={() => setMode(m.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '8px 10px', borderRadius: 10, font: 'inherit', fontSize: 12.5, textAlign: 'left',
                      fontWeight: selected ? 700 : 500, cursor: 'pointer',
                      border: `1px solid ${selected ? 'var(--accent)' : 'var(--input-border)'}`,
                      background: selected ? 'var(--accent)' : 'var(--card-bg)',
                      color: selected ? 'var(--on-accent, #fff)' : 'var(--text-1)',
                    }}
                  >
                    <span aria-hidden="true">{MODE_ICONS[m.key] ?? '•'}</span>
                    {m.label}
                  </button>
                );
              })}
            </div>
            {activeMode && (
              <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 6 }}>{activeMode.description}</div>
            )}
          </fieldset>

          <Button onClick={ask} disabled={!canAsk} style={{ width: '100%', justifyContent: 'center' }}>
            {busy ? 'Thinking…' : 'Get help'}
          </Button>

          {status.llmEnabled === false && (
            <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 12 }}>
              AI explanations are not switched on for this school yet — you will get a study plan built from
              your own timetable and results instead, and it costs no credits.
            </p>
          )}
        </Card>
      </div>

      <div style={{ flex: '999 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && (
          <Card style={{ borderColor: 'var(--danger, #b42318)' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>
              {error.paywall ? 'Credits needed to continue' : 'That did not work'}
            </strong>
            <p role="alert" style={{ fontSize: 13.5, color: 'var(--text-2b)', marginTop: 6 }}>{error.text}</p>
            {error.paywall && (
              <div style={{ marginTop: 12 }}>
                <Link href={link('/student/ai-credits')}>
                  <Button small>Add credits</Button>
                </Link>
              </div>
            )}
          </Card>
        )}

        {busy && (
          <Card><SkeletonRows rows={5} /></Card>
        )}

        {!reply && !error && !busy && (
          <Card>
            <EmptyState
              title="Pick a topic to get started"
              sub={`Explanations, step-by-step examples, practice, quizzes, flashcards, revision notes, mind maps and exam answers. ${EMPTY_STATE_GROUNDING}`}
            />
          </Card>
        )}

        {reply && (
          <Card pad={false}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17, overflowWrap: 'anywhere' }}>
                  {reply.modeLabel}: {reply.topic}
                </strong>
                <div style={{ fontSize: 12, color: 'var(--text-2b)', marginTop: 2 }}>
                  {[reply.subject, reply.className, reply.languageName].filter(Boolean).join(' · ')}
                </div>
              </div>
              {/* Never let a study plan be mistaken for an AI answer. */}
              <Pill tone={!reply.generated ? 'amber' : isRedirect ? 'gray' : 'green'}>
                {!reply.generated ? 'study plan' : isRedirect ? 'not a lesson' : 'AI answer'}
              </Pill>
            </div>

            <div style={{ padding: '16px 20px' }}>
              <ResultView key={replyKey} reply={reply} />
            </div>

            <GroundingFooter reply={reply} />
          </Card>
        )}
      </div>
    </div>
  );
}

/**
 * What the answer was actually grounded on — and, when nothing is on record
 * for the subject, a plain statement of that rather than a syllabus claim.
 */
function GroundingFooter({ reply }: { reply: LearnReplyDto }) {
  const s = reply.groundedOn.syllabus;
  const parts: string[] = [];
  if (s.chapters.length) parts.push(`chapters: ${s.chapters.slice(0, 3).join(', ')}${s.chapters.length > 3 ? '…' : ''}`);
  if (s.materialCount) parts.push(`${s.materialCount} course material title${s.materialCount === 1 ? '' : 's'}`);

  return (
    <div style={{ padding: '12px 20px', borderTop: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--text-faint)' }}>
      <span style={{ minWidth: 0 }}>
        {s.available
          ? `Grounded on ${reply.className} · ${reply.subject} · ${parts.join(' · ')} (titles on record, not the files' contents)`
          : `No chapters or course material on record for ${reply.subject} yet — this follows the general ${reply.className} level, not your school's syllabus.`}
        {reply.groundedOn.performance?.overall != null && ` · overall ${reply.groundedOn.performance.overall}%`}
        {reply.generated && reply.structured?.type !== 'redirect' && ' · AI-generated: check anything that looks wrong with your teacher.'}
      </span>
      {reply.credits && <span>1 credit used · {reply.credits.remaining} left</span>}
    </div>
  );
}
