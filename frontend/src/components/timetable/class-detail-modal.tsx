'use client';
import { Button, subjectColor } from '../ui';
import { formatDuration } from '@/lib/timetable-dates';
import type { TimetableSlotDto } from '@/lib/types';

export function ClassDetailModal({
  slot, division, onClose,
}: {
  slot: TimetableSlotDto;
  division: string;
  onClose: () => void;
}) {
  const color = subjectColor(slot.subject);

  const rows: Array<[string, string]> = [
    ['Teacher', slot.teacher ?? '—'],
    ['Room Number', slot.room ?? 'Not assigned'],
    ['Start Time', slot.startTime],
    ['End Time', slot.endTime],
    ['Duration', formatDuration(slot.startTime, slot.endTime)],
    ['Division', division || '—'],
  ];

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: color.dot, flexShrink: 0 }} />
            {slot.subject ?? 'Class'}
          </div>
          <button className="modal-close" aria-label="Close dialog" title="Close" onClick={onClose}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {rows.map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: '1px solid var(--hairline)' }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{label}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', textAlign: 'right' }}>{value}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 18 }}>
          {slot.liveClassLink && (
            <Button type="button" onClick={() => window.open(slot.liveClassLink!, '_blank', 'noopener,noreferrer')}>
              Join Live Class
            </Button>
          )}
          <Button variant="ghost" type="button" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}
