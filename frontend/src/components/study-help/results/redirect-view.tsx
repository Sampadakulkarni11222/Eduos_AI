'use client';
import type { LearnResult } from '@/lib/types';
import { Box, Text, bodyStyle } from './shared';

type Redirect = Extract<LearnResult, { type: 'redirect' }>;

/**
 * A reply that is not a lesson: an off-topic redirect, a clarifying question,
 * or — for a safety disclosure — support. Never charged.
 *
 * The safety case deliberately gets no "try another topic" nudge: pointing a
 * student in distress back at their homework is the one wrong answer.
 */
export function RedirectView({ result }: { result: Redirect }) {
  if (result.kind === 'safety') {
    return (
      <div role="alert" style={bodyStyle}>
        <Box tone="soft" style={{ borderColor: 'var(--amber)' }}>
          <Text>{result.message}</Text>
        </Box>
      </div>
    );
  }
  return (
    <div style={bodyStyle}>
      <p><Text>{result.message}</Text></p>
      <p style={{ marginTop: 10, fontSize: 12.5, color: 'var(--text-2b)' }}>
        {result.kind === 'needs_detail'
          ? 'Add a little more detail to the topic and try again.'
          : 'Try a topic from one of your subjects.'}
        {' '}No credit was used.
      </p>
    </div>
  );
}
