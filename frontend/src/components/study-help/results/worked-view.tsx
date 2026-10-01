'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import type { LearnResult } from '@/lib/types';
import { Box, Label, Text, bodyStyle, stack } from './shared';

type Worked = Extract<LearnResult, { type: 'worked' }>;

/**
 * A worked example revealed one step at a time, so the student can try the
 * next step before seeing it. The answer appears only after the last step.
 */
export function WorkedView({ result }: { result: Worked }) {
  const [shown, setShown] = useState(0);
  const total = result.steps.length;
  const done = shown >= total;

  return (
    <div style={{ ...stack(), ...bodyStyle }}>
      <Box tone="soft">
        <Label>Problem</Label>
        <Text>{result.problem}</Text>
      </Box>
      <p><strong>Method:</strong> <Text>{result.method}</Text></p>

      <div>
        <Label>Steps · {Math.min(shown, total)} of {total} shown</Label>
        {shown > 0 && (
          <ol style={{ paddingLeft: 20, margin: 0, ...stack(6) }}>
            {result.steps.slice(0, shown).map((s, i) => <li key={i}><Text>{s}</Text></li>)}
          </ol>
        )}
        {!done && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <Button small onClick={() => setShown((n) => n + 1)}>{shown === 0 ? 'Show first step' : 'Show next step'}</Button>
            <Button small variant="ghost" onClick={() => setShown(total)}>Show all steps</Button>
          </div>
        )}
      </div>

      {done && (
        <Box tone="good">
          <Label>Answer</Label>
          <strong><Text>{result.finalAnswer}</Text></strong>
          {result.verification && (
            <p style={{ marginTop: 6 }}><strong>Check:</strong> <Text>{result.verification}</Text></p>
          )}
        </Box>
      )}
    </div>
  );
}
