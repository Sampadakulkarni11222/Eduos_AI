'use client';
import { Pill } from '@/components/ui';
import type { LearnResult } from '@/lib/types';
import { Box, Label, Reveal, Text, bodyStyle, stack } from './shared';

type Exam = Extract<LearnResult, { type: 'exam' }>;

/**
 * Exam-style practice: the formal model answer stays hidden until asked for,
 * and the friendly explanation sits apart from it. The disclaimer is fixed text
 * from the page, not the model — the package forbids presenting generated
 * questions as past papers or promising marks.
 */
export function ExamView({ result }: { result: Exam }) {
  return (
    <div style={{ ...stack(16), ...bodyStyle }}>
      <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>
        Generated practice questions — not from a past paper. The model answers are a guide, not an official
        marking scheme, and no marks are guaranteed.
      </p>

      {result.questions.map((q, i) => (
        <Box key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
            <p style={{ fontWeight: 600 }}>{i + 1}. <Text>{q.prompt}</Text></p>
            {q.marks != null && <Pill tone="gray">{q.marks} {q.marks === 1 ? 'mark' : 'marks'}</Pill>}
          </div>
          <Reveal label="Show model answer" hideLabel="Hide model answer">
            <div style={stack(8)}>
              <Box tone="good">
                <Label>Model answer</Label>
                <Text>{q.formalAnswer}</Text>
              </Box>
              <Box tone="soft">
                <Label>Why this answer works</Label>
                <Text>{q.plainExplanation}</Text>
              </Box>
            </div>
          </Reveal>
        </Box>
      ))}
    </div>
  );
}
