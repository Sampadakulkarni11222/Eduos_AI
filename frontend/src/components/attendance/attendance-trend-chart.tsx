'use client';
import { useState } from 'react';
import type { AttendanceTrendPointDto } from '@/lib/types';

const THRESHOLD = 75;
const CHART_H = 120;
const COL_W = 60;
const BAR_GAP = 10;

function pctColor(p: number) {
  return p >= 75 ? 'var(--green)' : p >= 60 ? 'var(--amber)' : 'var(--red)';
}

function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short' });
}

function monthLabelFull(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export function AttendanceTrendChart({ points }: { points: AttendanceTrendPointDto[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const hasData = points.some((p) => p.workingDays > 0);
  if (!hasData) {
    return <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>No attendance history yet.</p>;
  }

  const width = points.length * COL_W;
  const hovered = hoverIdx !== null ? points[hoverIdx] : null;
  const thresholdY = CHART_H - (THRESHOLD / 100) * CHART_H;

  return (
    <div>
      <div style={{ fontSize: 12.5, color: 'var(--text-2b)', marginBottom: 8, minHeight: 18 }}>
        {hovered
          ? `${monthLabelFull(hovered.month)} — ${hovered.pctPresent}% present (${hovered.presentDays}/${hovered.workingDays} working days)`
          : `Dashed line marks the ${THRESHOLD}% attendance threshold.`}
      </div>
      <svg
        viewBox={`0 0 ${width} ${CHART_H + 26}`}
        style={{ width: '100%', height: 150, overflow: 'visible', display: 'block' }}
        role="img"
        aria-label="Attendance percentage trend over recent months"
      >
        <line x1={0} x2={width} y1={thresholdY} y2={thresholdY} stroke="var(--hairline-2, #d8cfc0)" strokeDasharray="4 4" strokeWidth={1} />
        {points.map((p, i) => {
          const barH = Math.max((p.pctPresent / 100) * CHART_H, p.workingDays > 0 ? 2 : 0);
          const x = i * COL_W + BAR_GAP / 2;
          const barW = COL_W - BAR_GAP;
          const color = p.workingDays > 0 ? pctColor(p.pctPresent) : 'var(--hairline)';
          const dimmed = hoverIdx !== null && hoverIdx !== i;
          return (
            <g
              key={p.month}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{ cursor: 'pointer' }}
            >
              <rect x={x} y={0} width={barW} height={CHART_H} fill="transparent" />
              <rect x={x} y={CHART_H - barH} width={barW} height={barH} rx={4} fill={color} opacity={dimmed ? 0.45 : 1} />
              {p.workingDays > 0 && (
                <text x={x + barW / 2} y={CHART_H - barH - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text-1)">
                  {p.pctPresent}%
                </text>
              )}
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
