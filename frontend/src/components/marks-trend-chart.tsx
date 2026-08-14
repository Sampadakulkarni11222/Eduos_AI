'use client';
import { useState } from 'react';

const CHART_H = 120;

function pctColor(p: number) {
  if (p >= 75) return 'var(--green)';
  if (p >= 50) return 'var(--amber)';
  return 'var(--red)';
}

export interface ExamResultRow {
  exam?: string | null;
  subject?: string | null;
  marks?: number | null;
  maxMarks?: number;
  pct?: number | null;
  percentage?: number | null;
}

export function MarksTrendChart({ results }: { results?: ExamResultRow[] | null }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Group by exam while maintaining exam appearance order
  const examMap = new Map<string, { totalPct: number; count: number }>();
  if (Array.isArray(results)) {
    for (const r of results) {
      const pctVal = r.pct ?? r.percentage ?? (r.marks != null && r.maxMarks ? Math.round((r.marks / r.maxMarks) * 100) : null);
      if (pctVal === null || pctVal === undefined) continue;
      const examName = r.exam?.trim() || 'Exam';
      const existing = examMap.get(examName) ?? { totalPct: 0, count: 0 };
      examMap.set(examName, {
        totalPct: existing.totalPct + pctVal,
        count: existing.count + 1,
      });
    }
  }

  const points = Array.from(examMap.entries()).map(([exam, { totalPct, count }]) => ({
    exam,
    avgPct: Math.round(totalPct / count),
    subjectCount: count,
  }));

  if (points.length === 0) {
    return <p style={{ fontSize: 12.5, color: 'var(--text-2b)', padding: '8px 0' }}>No exam trend data available yet.</p>;
  }

  const COL_W = 80;
  const BAR_GAP = 16;
  const width = points.length * COL_W;
  const hovered = hoverIdx !== null ? points[hoverIdx] : null;

  return (
    <div>
      <div style={{ fontSize: 12.5, color: 'var(--text-2b)', marginBottom: 12, minHeight: 18 }}>
        {hovered
          ? `${hovered.exam} — ${hovered.avgPct}% average (${hovered.subjectCount} subject${hovered.subjectCount === 1 ? '' : 's'})`
          : 'Average percentage per exam paper'}
      </div>
      <svg
        viewBox={`0 0 ${width} ${CHART_H + 30}`}
        style={{ width: '100%', height: 160, overflow: 'visible', display: 'block' }}
        role="img"
        aria-label="Marks trend across exams"
      >
        <line x1={0} x2={width} y1={CHART_H - (75 / 100) * CHART_H} y2={CHART_H - (75 / 100) * CHART_H} stroke="var(--hairline-2, #d8cfc0)" strokeDasharray="4 4" strokeWidth={1} />
        {points.map((p, i) => {
          const barH = Math.max((p.avgPct / 100) * CHART_H, 4);
          const x = i * COL_W + BAR_GAP / 2;
          const barW = COL_W - BAR_GAP;
          const color = pctColor(p.avgPct);
          const dimmed = hoverIdx !== null && hoverIdx !== i;

          return (
            <g
              key={p.exam}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{ cursor: 'pointer' }}
            >
              <rect x={x} y={0} width={barW} height={CHART_H} fill="transparent" />
              <rect x={x} y={CHART_H - barH} width={barW} height={barH} rx={4} fill={color} opacity={dimmed ? 0.45 : 1} />
              <text x={x + barW / 2} y={CHART_H - barH - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text-1)">
                {p.avgPct}%
              </text>
              <text x={x + barW / 2} y={CHART_H + 18} textAnchor="middle" fontSize="11" fill="var(--text-faint)">
                {p.exam}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
