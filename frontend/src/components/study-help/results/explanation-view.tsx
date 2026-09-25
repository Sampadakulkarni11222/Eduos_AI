'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import type { LearnResult } from '@/lib/types';
import { Box, Label, Text, bodyStyle, stack } from './shared';

type Explain = Extract<LearnResult, { type: 'explain' }>;

/** Idea → example → why it works → takeaway, then an optional comprehension check. */
export function ExplanationView({ result }: { result: Explain }) {
  return (
    <div style={{ ...stack(), ...bodyStyle }}>
      <p style={{ fontSize: 15.5, fontWeight: 600 }}><Text>{result.idea}</Text></p>

      <Box tone="soft">
        <Label>Example</Label>
        <Text>{result.example}</Text>
      </Box>

      <div>
        <Label>Why it works</Label>
        <ol style={{ paddingLeft: 20, margin: 0, ...stack(6) }}>
          {result.steps.map((s, i) => <li key={i}><Text>{s}</Text></li>)}
        </ol>
      </div>

      <p><strong>In short:</strong> <Text>{result.takeaway}</Text></p>

      {result.checkQuestion && <CheckQuestion prompt={result.checkQuestion.prompt} answer={result.checkQuestion.answer} />}
    </div>
  );
}

/**
 * The comprehension check. The student's attempt stays in the browser — it is
 * compared by the student against the answer, not sent to the AI.
 */
function CheckQuestion({ prompt, answer }: { prompt: string; answer: string }) {
  const [attempt, setAttempt] = useState('');
  const [shown, setShown] = useState(false);
  return (
    <Box>
      <Label>Check your understanding</Label>
      <p style={{ marginBottom: 8 }}><Text>{prompt}</Text></p>
      <textarea
        aria-label="Your answer"
        value={attempt}
        onChange={(e) => setAttempt(e.target.value)}
        rows={2}
        placeholder="Try it yourself first (optional)"
        style={{ width: '100%', resize: 'vertical' }}
      />
      {!shown ? (
        <div style={{ marginTop: 8 }}>
          <Button small onClick={() => setShown(true)}>Check answer</Button>
        </div>
      ) : (
        <Box tone="good" style={{ marginTop: 8 }}>
          <Label>Answer</Label>
          <Text>{answer}</Text>
          {attempt.trim() && (
            <p style={{ marginTop: 8, fontSize: 12.5, color: 'var(--text-2b)' }}>
              Compare it with what you wrote: <Text>{attempt.trim()}</Text>
            </p>
          )}
        </Box>
      )}
    </Box>
  );
}
