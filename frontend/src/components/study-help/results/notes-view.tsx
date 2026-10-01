'use client';
import type { LearnResult } from '@/lib/types';
import { Box, Label, Reveal, Text, bodyStyle, stack } from './shared';

type Notes = Extract<LearnResult, { type: 'notes' }>;

/** Key ideas, the common confusion, then recall prompts whose answers stay hidden until asked for. */
export function NotesView({ result }: { result: Notes }) {
  return (
    <div style={{ ...stack(16), ...bodyStyle }}>
      {result.sections.map((s, i) => (
        <section key={i}>
          <h3 style={{ fontFamily: 'Newsreader, serif', fontSize: 16, marginBottom: 4 }}><Text>{s.heading}</Text></h3>
          <ul style={{ paddingLeft: 20, margin: 0, ...stack(4) }}>
            {s.points.map((p, j) => <li key={j}><Text>{p}</Text></li>)}
          </ul>
        </section>
      ))}

      {result.commonConfusion && (
        <Box tone="soft">
          <Label>Common confusion</Label>
          <Text>{result.commonConfusion}</Text>
        </Box>
      )}

      <div>
        <Label>Test yourself</Label>
        <ol style={{ paddingLeft: 20, margin: 0, ...stack(10) }}>
          {result.recallPrompts.map((r, i) => (
            <li key={i}>
              <Text>{r.prompt}</Text>
              <Reveal label="Show answer" hideLabel="Hide answer">
                <Box tone="good"><Text>{r.answer}</Text></Box>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
