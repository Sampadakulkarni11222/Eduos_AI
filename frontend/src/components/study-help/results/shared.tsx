'use client';
import { ReactNode, useId, useState } from 'react';
import { Button } from '@/components/ui';

/**
 * Building blocks shared by the Study Help result views.
 *
 * Every string these render is model output, shaped by whatever the student
 * typed. It is rendered as React text — never through dangerouslySetInnerHTML —
 * so markup in it shows up as literal characters instead of running. That rule
 * is the reason `Text` exists: one component, `white-space: pre-wrap`, used for
 * every model string.
 */

export function Text({ children, style }: { children: string; style?: React.CSSProperties }) {
  return <span style={{ whiteSpace: 'pre-wrap', ...style }}>{children}</span>;
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-2b)', marginBottom: 6 }}>
      {children}
    </div>
  );
}

export function Box({ children, tone = 'plain', style }: { children: ReactNode; tone?: 'plain' | 'soft' | 'good' | 'bad'; style?: React.CSSProperties }) {
  const tones = {
    plain: { background: 'transparent', border: '1px solid var(--hairline-2)' },
    soft: { background: 'var(--panel-bg)', border: '1px solid var(--hairline-2)' },
    good: { background: '#E3EFE6', border: '1px solid #bcd8c5' },
    bad: { background: '#F6E1DF', border: '1px solid #e6c1bd' },
  } as const;
  return <div style={{ borderRadius: 12, padding: '12px 14px', ...tones[tone], ...style }}>{children}</div>;
}

/**
 * A button that shows hidden content — an answer, a hint, a model answer.
 * The student decides when to look, which is the point: the package asks that
 * answers stay out of sight until the learner has tried.
 */
export function Reveal({ label, hideLabel, children }: { label: string; hideLabel?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div style={{ marginTop: 8 }}>
      <Button variant="soft" small aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {open ? hideLabel ?? 'Hide' : label}
      </Button>
      {open && <div id={id} style={{ marginTop: 8 }}>{children}</div>}
    </div>
  );
}

export const bodyStyle: React.CSSProperties = { fontSize: 14, lineHeight: 1.7, color: 'var(--text-1)' };
export const stack = (gap = 14): React.CSSProperties => ({ display: 'flex', flexDirection: 'column', gap });
