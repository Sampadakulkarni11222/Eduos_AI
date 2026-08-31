'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, Card, EmptyState, Field, Pill, SkeletonRows } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useSchoolHref } from '@/lib/school-path';
import type { TutorReplyDto, TutorStatusDto, TutorSyllabusDto } from '@/lib/types';

/**
 * Study help, grounded in the student's own class and results.
 *
 * Two deliberate choices worth knowing before editing this:
 *
 * 1. **Model output is rendered as text, never as HTML.** It goes into a
 *    `white-space: pre-wrap` block, not `dangerouslySetInnerHTML`. Piping model
 *    output — which is shaped by whatever the student typed — through an HTML
 *    parser is a self-inflicted XSS.
 * 2. **A study plan is never dressed up as a tutor's answer.** When no model is
 *    configured the API returns `generated: false` with a scaffold built from
 *    real timetable and marks data. It is labelled as exactly that, because a
 *    student cannot tell a plausible wrong answer from a right one.
 *
 * The subject list here is a convenience, not a control: the server resolves
 * what this student is allowed to be taught from their own enrolment, and
 * refuses anything else regardless of what the form sends.
 */
export function TutorPanel({ portalSlug }: { portalSlug: 'student' | 'parent' }) {
  const link = useSchoolHref();
  const [status, setStatus] = useState<TutorStatusDto | null>(null);
  const [syllabus, setSyllabus] = useState<TutorSyllabusDto | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [mode, setMode] = useState('explain');

  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<TutorReplyDto | null>(null);
  const [error, setError] = useState<{ text: string; paywall: boolean } | null>(null);
  const [creditsLeft, setCreditsLeft] = useState<number | null>(null);

  useEffect(() => {
    api.tutorStatus().then(setStatus).catch(() => setStatus({ llmEnabled: false, modes: [] }));
    api.tutorSyllabus()
      .then((s) => { setSyllabus(s); setSubject(s.subjects[0]?.name ?? ''); })
      .catch((e: unknown) => setSetupError(e instanceof Error ? e.message : 'Could not load your class details.'));
    // Staff are not metered and get `metered: false`, so this stays null for them
    // and no balance is shown.
    api.aiCredits()
      .then((c) => setCreditsLeft(c.metered ? c.totalRemaining ?? 0 : null))
      .catch(() => setCreditsLeft(null));
  }, []);

  const modes = useMemo(
    () => (status?.modes?.length ? status.modes : [{ key: 'explain', label: 'Explanation' }]),
    [status]
  );

  const ask = async () => {
    if (!topic.trim()) return;
    setBusy(true);
    setError(null);
    setReply(null);
    try {
      const result = await api.tutor({ topic: topic.trim(), subject: subject || undefined, mode });
      setReply(result);
      if (result.credits) setCreditsLeft(result.credits.remaining);
    } catch (e) {
      const text = e instanceof Error ? e.message : 'Something went wrong.';
      // Distinguishing the paywall from an ordinary failure is the difference
      // between offering a top-up and looking broken. Keyed on the status/code
      // the API actually sends, not on matching words in the message — that
      // would silently stop working the day someone reworded the copy.
      const paywall =
        e instanceof ApiError && (e.status === 402 || e.code === 'AI_CREDITS_EXHAUSTED');
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

  if (syllabus === null) {
    return <Card><SkeletonRows rows={4} /></Card>;
  }

  const answerText = reply?.generated ? reply.content : reply?.scaffold;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, alignItems: 'start' }}>
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

        <Field label="Subject" hint="Only the subjects you actually study are listed.">
          <select value={subject} onChange={(e) => setSubject(e.target.value)}>
            {syllabus.subjects.map((s) => (
              <option key={s.id} value={s.name}>{s.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Topic" required hint="e.g. fractions, photosynthesis, the water cycle">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void ask(); }}
            placeholder="What do you want help with?"
          />
        </Field>

        <Field label="What would help most?">
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            {modes.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </Field>

        <Button onClick={ask} disabled={busy || !topic.trim()} style={{ width: '100%' }}>
          {busy ? 'Thinking…' : 'Get help'}
        </Button>

        {status?.llmEnabled === false && (
          <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 12 }}>
            AI explanations are not switched on for this school yet — you will get a study plan built from
            your own timetable and results instead, and it costs no credits.
          </p>
        )}
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && (
          <Card style={{ borderColor: 'var(--danger, #b42318)' }}>
            {/* Neutral title: the server's message covers both "you used your
                free allowance" and "this school sells credits outright", and a
                hardcoded title would be wrong in one of those cases. */}
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>
              {error.paywall ? 'Credits needed to continue' : 'That did not work'}
            </strong>
            <p role="alert" style={{ fontSize: 13.5, color: 'var(--text-2b)', marginTop: 6 }}>{error.text}</p>
            {error.paywall && (
              <div style={{ marginTop: 12 }}>
                <Link href={link(`/${portalSlug}/ai-credits`)}>
                  <Button small>Add credits</Button>
                </Link>
              </div>
            )}
          </Card>
        )}

        {!reply && !error && (
          <Card>
            <EmptyState
              title="Pick a topic to get started"
              sub="Explanations, practice questions, flashcards, condensed notes or a mind map — grounded in your own syllabus."
            />
          </Card>
        )}

        {reply && (
          <Card pad={false}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>
                  {reply.modeLabel}: {reply.topic}
                </strong>
                <div style={{ fontSize: 12, color: 'var(--text-2b)', marginTop: 2 }}>
                  {[reply.subject, reply.className, reply.languageName].filter(Boolean).join(' · ')}
                </div>
              </div>
              {/* Never let a study plan be mistaken for a tutor's answer. */}
              <Pill tone={reply.generated ? 'green' : 'amber'}>
                {reply.generated ? 'AI answer' : 'study plan'}
              </Pill>
            </div>

            {!reply.generated && (
              <p style={{ padding: '12px 20px 0', fontSize: 12.5, color: 'var(--text-2b)' }}>
                This is not an AI-written answer — it is a plan built from your own class and results.
                Nothing was charged for it.
              </p>
            )}

            {/* Rendered as text, deliberately. See the note at the top of this file. */}
            <div
              style={{
                padding: '16px 20px',
                whiteSpace: 'pre-wrap',
                fontSize: 14,
                lineHeight: 1.75,
                color: 'var(--text-1)',
              }}
            >
              {answerText || 'No content was returned.'}
            </div>

            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, color: 'var(--text-faint)' }}>
              <span>
                Grounded on your subjects
                {reply.groundedOn?.performance?.overall != null && ` · overall ${reply.groundedOn.performance.overall}%`}
              </span>
              {reply.credits && <span>1 credit used · {reply.credits.remaining} left</span>}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
