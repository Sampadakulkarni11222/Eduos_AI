'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import type { LearnResult } from '@/lib/types';
import { Box, Label, Text, bodyStyle, stack } from './shared';

type Quiz = Extract<LearnResult, { type: 'quiz' }>;
const LETTERS = ['A', 'B', 'C', 'D'];

/**
 * Single-answer multiple choice, scored in the browser.
 *
 * An answer locks once chosen and is marked immediately with the explanation.
 * Right and wrong are said in words as well as colour, so the result does not
 * depend on telling green from red.
 */
export function QuizView({ result }: { result: Quiz }) {
  const total = result.questions.length;
  const [chosen, setChosen] = useState<Array<number | null>>(() => result.questions.map(() => null));

  const answered = chosen.filter((c) => c !== null).length;
  const score = chosen.filter((c, i) => c === result.questions[i].correctIndex).length;
  const complete = answered === total;

  const choose = (qi: number, oi: number) =>
    setChosen((prev) => (prev[qi] !== null ? prev : prev.map((c, i) => (i === qi ? oi : c))));

  return (
    <div style={{ ...stack(18), ...bodyStyle }}>
      <div aria-live="polite" style={{ fontSize: 13, color: 'var(--text-2b)' }}>
        Score: <strong>{score}</strong> / {answered} answered · {total} questions
      </div>

      {result.questions.map((q, qi) => {
        const pick = chosen[qi];
        const locked = pick !== null;
        const right = pick === q.correctIndex;
        return (
          <fieldset key={qi} style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, marginBottom: 8 }}>
              {qi + 1}. <Text>{q.prompt}</Text>
            </legend>
            <div style={stack(6)}>
              {q.options.map((opt, oi) => {
                const isCorrect = locked && oi === q.correctIndex;
                const isWrongPick = locked && oi === pick && !right;
                return (
                  <button
                    key={oi}
                    type="button"
                    disabled={locked}
                    aria-pressed={pick === oi}
                    onClick={() => choose(qi, oi)}
                    style={{
                      textAlign: 'left',
                      padding: '9px 12px',
                      borderRadius: 10,
                      border: `1px solid ${isCorrect ? '#9cc7aa' : isWrongPick ? '#e0aaa5' : 'var(--input-border)'}`,
                      background: isCorrect ? '#E3EFE6' : isWrongPick ? '#F6E1DF' : 'var(--card-bg)',
                      color: 'var(--text-1)',
                      cursor: locked ? 'default' : 'pointer',
                      font: 'inherit',
                    }}
                  >
                    <strong>{LETTERS[oi]})</strong> <Text>{opt}</Text>
                    {isCorrect && <span style={{ marginLeft: 8, fontWeight: 700, color: 'var(--green)' }}>✓ correct answer</span>}
                    {isWrongPick && <span style={{ marginLeft: 8, fontWeight: 700, color: 'var(--red)' }}>✗ your answer</span>}
                  </button>
                );
              })}
            </div>
            {locked && (
              <Box tone={right ? 'good' : 'bad'} style={{ marginTop: 8 }}>
                <strong>{right ? 'Correct.' : `Not quite — the answer is ${LETTERS[q.correctIndex]}.`}</strong>{' '}
                <Text>{q.explanation}</Text>
              </Box>
            )}
          </fieldset>
        );
      })}

      {complete && (
        <Box tone="soft">
          <Label>Final score</Label>
          <p style={{ fontSize: 16 }}>You scored <strong>{score} out of {total}</strong>.</p>
          <div style={{ marginTop: 8 }}>
            <Button small onClick={() => setChosen(result.questions.map(() => null))}>Try again</Button>
          </div>
        </Box>
      )}
    </div>
  );
}
