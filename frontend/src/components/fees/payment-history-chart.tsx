'use client';
import { useState } from 'react';
import { rupees } from '../ui';
import type { PaymentReceiptDto } from '@/lib/types';

const COL_W = 60;
const CHART_H = 120;
const BAR_GAP = 10;

function monthKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short' });
}
function monthLabelFull(key: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export function PaymentHistoryChart({ payments }: { payments: PaymentReceiptDto[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const now = new Date();
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const sums = new Map<string, number>();
  for (const p of payments) {
    if (p.status !== 'SUCCESS' && p.status !== 'CAPTURED') continue;
    const key = monthKey(p.createdAt);
    sums.set(key, (sums.get(key) ?? 0) + p.amountPaise);
  }
  const points = months.map((m) => ({ month: m, amountPaise: sums.get(m) ?? 0 }));
  const maxAmount = Math.max(...points.map((p) => p.amountPaise), 1);
  const hasData = points.some((p) => p.amountPaise > 0);

  if (!hasData) {
    return <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>No payment history yet.</p>;
  }

  const width = points.length * COL_W;
  const hovered = hoverIdx !== null ? points[hoverIdx] : null;

  return (
    <div>
      <div style={{ fontSize: 12.5, color: 'var(--text-2b)', marginBottom: 8, minHeight: 18 }}>
        {hovered ? `${monthLabelFull(hovered.month)} — ${rupees(hovered.amountPaise)} paid` : 'Amount paid per month'}
      </div>
      <svg
        viewBox={`0 0 ${width} ${CHART_H + 26}`}
        style={{ width: '100%', height: 150, overflow: 'visible', display: 'block' }}
        role="img"
        aria-label="Payment history over recent months"
      >
        {points.map((p, i) => {
          const barH = p.amountPaise > 0 ? Math.max((p.amountPaise / maxAmount) * CHART_H, 4) : 0;
          const x = i * COL_W + BAR_GAP / 2;
          const barW = COL_W - BAR_GAP;
          const dimmed = hoverIdx !== null && hoverIdx !== i;
          return (
            <g
              key={p.month}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{ cursor: 'pointer' }}
            >
              <rect x={x} y={0} width={barW} height={CHART_H} fill="transparent" />
              <rect x={x} y={CHART_H - barH} width={barW} height={barH} rx={4} fill="var(--accent)" opacity={dimmed ? 0.4 : 1} />
              <text x={x + barW / 2} y={CHART_H + 18} textAnchor="middle" fontSize="10" fill="var(--text-faint)">
                {monthLabel(p.month)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
