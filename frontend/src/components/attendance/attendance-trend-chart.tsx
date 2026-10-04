'use client';
import { useState } from 'react';
import type { AttendanceTrendPointDto } from '@/lib/types';

const THRESHOLD = 75;

/* Geometry.

   The bars used to be drawn from y=0 to y=CHART_H in a viewBox exactly
   CHART_H tall, with the value label placed at `CHART_H - barHeight - 6`. For
   any month at or near 100% that label sits at a negative y — outside the
   viewBox — and only `overflow: visible` kept it on screen at all, spilling
   over the card and across the threshold line above it. The line itself was
   painted first and then covered by every bar taller than 75%, so the one
   reference the chart exists to show was the thing most reliably hidden.

   The fix is an explicit plot box with padding reserved for what lives outside
   it. Labels are drawn in PAD_TOP, month names in PAD_BOTTOM, the axis in
   PAD_LEFT, and nothing is ever painted outside the viewBox — so `overflow`
   no longer has to rescue anything. */
const PAD_TOP = 20;    // headroom for the value label above a full-height bar
const PAD_BOTTOM = 20; // month labels
const PAD_LEFT = 26;   // percentage axis
const PLOT_H = 112;
const COL_W = 58;
const BAR_GAP = 16;
const VIEW_H = PAD_TOP + PLOT_H + PAD_BOTTOM;

/** Percentage to a y coordinate inside the plot box. Clamped, so a stray
 *  out-of-range value can never draw outside the chart. */
function yFor(pct: number) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  return PAD_TOP + (1 - clamped / 100) * PLOT_H;
}

function pctColor(p: number) {
  return p >= THRESHOLD ? 'var(--green)' : p >= 60 ? 'var(--amber)' : 'var(--red)';
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

  const plotW = points.length * COL_W;
  const viewW = PAD_LEFT + plotW;
  const hovered = hoverIdx !== null ? points[hoverIdx] : null;
  const thresholdY = yFor(THRESHOLD);
  const baselineY = yFor(0);

  return (
    <div style={{ width: '100%', overflow: 'hidden' }}>
      <div style={{ fontSize: 12.5, color: 'var(--text-2b)', marginBottom: 8, minHeight: 32 }}>
        {hovered
          ? (hovered.workingDays > 0 && hovered.pctPresent != null
            ? `${monthLabelFull(hovered.month)} — ${hovered.pctPresent}% present (${hovered.presentDays}/${hovered.workingDays} working days)`
            : `${monthLabelFull(hovered.month)} — no attendance marked`)
          : `Dashed line marks the ${THRESHOLD}% attendance threshold.`}
      </div>
      <svg
        viewBox={`0 0 ${viewW} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        // No `overflow: visible`: everything the chart draws is inside the
        // viewBox by construction, and letting content escape is what put a
        // bar's label on top of the reference line in the first place.
        style={{ width: '100%', height: 'auto', maxHeight: 180, display: 'block' }}
        role="img"
        aria-label={`Attendance percentage over the last ${points.length} months, against a ${THRESHOLD}% threshold`}
      >
        {/* Axis: 0 / 50 / 100, so a bar's height means something without a hover. */}
        {[0, 50, 100].map((tick) => (
          <g key={tick}>
            <line
              x1={PAD_LEFT} x2={viewW} y1={yFor(tick)} y2={yFor(tick)}
              stroke="var(--hairline, #F3ECDC)" strokeWidth={1}
            />
            <text
              x={PAD_LEFT - 6} y={yFor(tick) + 3}
              textAnchor="end" fontSize="9" fill="var(--text-faint)"
            >
              {tick}
            </text>
          </g>
        ))}

        {points.map((p, i) => {
          // An unmarked month has no percentage (null); it draws no bar.
          const top = yFor(p.pctPresent ?? 0);
          // A month with records but a very low percentage still gets a
          // visible sliver; a month with no records at all gets nothing.
          const barH = p.workingDays > 0 ? Math.max(baselineY - top, 2) : 0;
          const barY = baselineY - barH;
          const x = PAD_LEFT + i * COL_W + BAR_GAP / 2;
          const barW = COL_W - BAR_GAP;
          const color = p.workingDays > 0 && p.pctPresent != null ? pctColor(p.pctPresent) : 'var(--hairline)';
          const dimmed = hoverIdx !== null && hoverIdx !== i;
          // Above the bar normally; inside it when the bar is tall enough that
          // "above" would mean over the top of the plot.
          const labelInside = barY < PAD_TOP + 12;
          return (
            <g
              key={p.month}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              onFocus={() => setHoverIdx(i)}
              onBlur={() => setHoverIdx(null)}
              style={{ cursor: 'pointer' }}
            >
              {/* Full-column hit area, so the tooltip does not require hitting
                  a 2px bar. */}
              <rect x={x} y={PAD_TOP} width={barW} height={PLOT_H} fill="transparent" />
              <rect x={x} y={barY} width={barW} height={barH} rx={4} fill={color} opacity={dimmed ? 0.45 : 1} />
              {p.workingDays > 0 && (
                <text
                  x={x + barW / 2}
                  y={labelInside ? barY + 13 : barY - 5}
                  textAnchor="middle" fontSize="10.5" fontWeight="700"
                  fill={labelInside ? '#fff' : 'var(--text-1)'}
                >
                  {p.pctPresent}%
                </text>
              )}
              <text x={x + barW / 2} y={VIEW_H - 6} textAnchor="middle" fontSize="10" fill="var(--text-faint)">
                {monthLabel(p.month)}
              </text>
            </g>
          );
        })}

        {/* Drawn last so the reference line reads over the bars rather than
            being buried by every month above the threshold. */}
        <line
          x1={PAD_LEFT} x2={viewW} y1={thresholdY} y2={thresholdY}
          stroke="var(--red)" strokeDasharray="5 4" strokeWidth={1.25} opacity={0.75}
        />
        <text x={PAD_LEFT - 6} y={thresholdY + 3} textAnchor="end" fontSize="9" fontWeight="700" fill="var(--red)">
          {THRESHOLD}
        </text>
      </svg>
    </div>
  );
}
