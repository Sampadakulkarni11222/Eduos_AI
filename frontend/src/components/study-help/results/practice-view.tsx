'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import type { LearnResult } from '@/lib/types';
import { Box, Label, Text, bodyStyle, stack } from './shared';

type Practice = Extract<LearnResult, { type: 'questions' }>;
type Mark = 'got' | 'not-yet';

/**
 * Practice, one question at a time (the package's "Practise" mode).
 *
 * Each question has a hint ladder — hints one by one, then the full solution —
 * and the student marks their own work against it. Nothing the student writes
 * leaves the browser: AI checking of free-text answers is deliberately not
 * part of this feature yet.
 */
export function PracticeView({ result }: { result: Practice }) {
  const total = result.questions.length;
  const [index, setIndex] = useState(0);
  const [hints, setHints] = useState(0);
  const [solved, setSolved] = useState(false);
  const [work, setWork] = useState('');
  const [marks, setMarks] = useState<Mark[]>([]);

  const finished = index >= total;

  const next = (mark: Mark) => {
    setMarks((m) => [...m, mark]);
    setIndex((i) => i + 1);
    setHints(0);
    setSolved(false);
    setWork('');
  };

  const restart = () => {
    setIndex(0); setHints(0); setSolved(false); setWork(''); setMarks([]);
  };

  if (finished) {
    const got = marks.filter((m) => m === 'got').length;
    return (
      <div style={{ ...stack(), ...bodyStyle }}>
        <Box tone="soft">
          <strong>Practice complete.</strong> You marked {got} of {total} as got it.
          {got < total && ' Have another go at the ones marked "not yet" — a second try is where it sticks.'}
        </Box>
        <div><Button small onClick={restart}>Start again</Button></div>
      </div>
    );
  }

  const q = result.questions[index];
  return (
    <div style={{ ...stack(), ...bodyStyle }}>
      <Label>Question {index + 1} of {total}</Label>
      <p style={{ fontSize: 15, fontWeight: 600 }}><Text>{q.prompt}</Text></p>

      <textarea
        aria-label="Your working"
        value={work}
        onChange={(e) => setWork(e.target.value)}
        rows={3}
        placeholder="Work it out here — only you can see this."
        style={{ width: '100%', resize: 'vertical' }}
      />

      {hints > 0 && (
        <div style={stack(6)}>
          {q.hints.slice(0, hints).map((h, i) => (
            <Box key={i} tone="soft"><Label>Hint {i + 1}</Label><Text>{h}</Text></Box>
          ))}
        </div>
      )}

      {solved && (
        <Box tone="good"><Label>Solution</Label><Text>{q.solution}</Text></Box>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!solved && hints < q.hints.length && (
          <Button small variant="soft" onClick={() => setHints((h) => h + 1)}>
            {hints === 0 ? 'Show a hint' : 'Show another hint'}
          </Button>
        )}
        {!solved && <Button small onClick={() => setSolved(true)}>Show solution</Button>}
        {solved && (
          <>
            <span style={{ alignSelf: 'center', fontSize: 12.5, color: 'var(--text-2b)' }}>Compare with your working:</span>
            <Button small onClick={() => next('got')}>I got it</Button>
            <Button small variant="ghost" onClick={() => next('not-yet')}>Not yet</Button>
          </>
        )}
      </div>
    </div>
  );
}
