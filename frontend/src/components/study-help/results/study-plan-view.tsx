'use client';
import { Text, bodyStyle } from './shared';

/**
 * Shown when no valid AI answer is available. It says why, and it is a plan
 * built from the student's own class and results — never dressed up as an
 * AI answer, because a student cannot tell a plausible wrong answer from a
 * right one.
 */
export function StudyPlanView({ reasonMessage, scaffold }: { reasonMessage?: string; scaffold?: string }) {
  return (
    <div style={bodyStyle}>
      <p role="status" style={{ fontSize: 13, color: 'var(--text-2b)', marginBottom: 12 }}>
        {reasonMessage ?? 'No AI answer is available right now.'} This is not an AI-written answer, and no credit was used.
      </p>
      <Text style={{ lineHeight: 1.75 }}>{scaffold || 'No study plan could be built.'}</Text>
    </div>
  );
}
