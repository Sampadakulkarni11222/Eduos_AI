'use client';
import { TimeGrid } from './time-grid';
import type { TimetableSlotDto } from '@/lib/types';

/**
 * Single-day view — the same time grid as the week, narrowed to one column.
 * Completes the Day / Week / Month switcher Google Calendar users expect.
 */
export function DayView({
  anchorDate, slots, canEdit, onSlotClick, onCellClick,
}: {
  anchorDate: Date;
  slots: TimetableSlotDto[];
  canEdit: boolean;
  onSlotClick: (slot: TimetableSlotDto) => void;
  onCellClick: (dayOfWeek: number, periodNo: number, existing: TimetableSlotDto | null, startTime?: string, endTime?: string) => void;
}) {
  if (slots.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
        No periods configured for this section yet.
      </div>
    );
  }

  return (
    <TimeGrid
      dates={[anchorDate]}
      slots={slots}
      canEdit={canEdit}
      onEmptyClick={(dow, periodNo, startTime, endTime) => onCellClick(dow, periodNo, null, startTime, endTime)}
      onSlotClick={(slot) => {
        if (canEdit) onCellClick(slot.dayOfWeek, slot.periodNo, slot);
        else if (!slot.isBreak) onSlotClick(slot);
      }}
    />
  );
}
