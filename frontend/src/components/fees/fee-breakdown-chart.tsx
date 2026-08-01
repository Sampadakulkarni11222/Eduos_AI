'use client';
import { rupees } from '../ui';

interface Segment { label: string; value: number; color: string; }

const R = 70;
const STROKE = 22;
const CIRC = 2 * Math.PI * R;

export function FeeBreakdownChart({
  paidPaise, pendingPaise, overduePaise,
}: {
  paidPaise: number;
  pendingPaise: number;
  overduePaise: number;
}) {
  // pendingPaise (all outstanding) already includes overduePaise — split them
  // so the three donut segments are mutually exclusive and sum to the total.
  const notYetDuePaise = Math.max(0, pendingPaise - overduePaise);
  const segments: Segment[] = [
    { label: 'Paid', value: paidPaise, color: 'var(--green)' },
    { label: 'Pending', value: notYetDuePaise, color: 'var(--amber)' },
    { label: 'Overdue', value: overduePaise, color: 'var(--red)' },
  ];
  const total = segments.reduce((s, seg) => s + seg.value, 0);

  if (total <= 0) {
    return <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>No fee data yet.</p>;
  }

  let offset = 0;
  const collectedPct = Math.round((paidPaise / total) * 100);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
      <svg width={180} height={180} viewBox="0 0 180 180" role="img" aria-label="Fee collection breakdown">
        <g transform="rotate(-90 90 90)">
          <circle cx={90} cy={90} r={R} fill="none" stroke="var(--hairline)" strokeWidth={STROKE} />
          {segments.filter((s) => s.value > 0).map((seg) => {
            const frac = seg.value / total;
            const dash = frac * CIRC;
            const el = (
              <circle
                key={seg.label}
                cx={90} cy={90} r={R} fill="none" stroke={seg.color} strokeWidth={STROKE}
                strokeDasharray={`${dash} ${CIRC - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return el;
          })}
        </g>
        <text x={90} y={84} textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--text-1)">{collectedPct}%</text>
        <text x={90} y={101} textAnchor="middle" fontSize="9.5" fill="var(--text-faint)">collected</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {segments.map((seg) => (
          <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: seg.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12.5, color: 'var(--text-2)', minWidth: 62 }}>{seg.label}</span>
            <strong style={{ fontSize: 13, color: 'var(--text-1)' }}>{rupees(seg.value)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
