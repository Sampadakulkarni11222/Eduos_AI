'use client';
import { useEffect, useState } from 'react';
import { buildWeekDates, isToday } from '@/lib/timetable-dates';
import { TimeGrid } from './time-grid';
import type { TimetableSlotDto } from '@/lib/types';

/**
 * Week view, laid out on a real time axis like Google Calendar: a scrollable
 * hour grid with events positioned and sized by their actual start/end times,
 * rather than the fixed-height period rows this used to be.
 *
 * Mobile narrows to a single day column with a date strip, which is what Google
 * Calendar does too — seven time columns is unreadable on a phone.
 */
export function WeekView({
  anchorDate, slots, canEdit, onSlotClick, onCellClick,
}: {
  anchorDate: Date;
  slots: TimetableSlotDto[];
  canEdit: boolean;
  onSlotClick: (slot: TimetableSlotDto) => void;
  onCellClick: (dayOfWeek: number, periodNo: number, existing: TimetableSlotDto | null, startTime?: string, endTime?: string) => void;
}) {
  const dates = buildWeekDates(anchorDate);

  const [mobileIdx, setMobileIdx] = useState(() => {
    const idx = dates.findIndex((d) => isToday(d));
    return idx >= 0 ? idx : 0;
  });
  useEffect(() => {
    const idx = dates.findIndex((d) => isToday(d));
    setMobileIdx(idx >= 0 ? idx : 0);
    // Recompute the focused mobile day whenever the displayed week changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorDate.getTime()]);

  if (slots.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
        No periods configured for this section yet.
      </div>
    );
  }

  // Staff clicking empty space creates a slot; clicking an existing one edits it.
  const handleEmpty = (dayOfWeek: number, periodNo: number, startTime: string, endTime: string) =>
    onCellClick(dayOfWeek, periodNo, null, startTime, endTime);
  const handleSlot = (slot: TimetableSlotDto) => {
    if (canEdit) onCellClick(slot.dayOfWeek, slot.periodNo, slot);
    else if (!slot.isBreak) onSlotClick(slot);
  };

  return (
    <>
      <div className="calendar-desktop-only">
        <TimeGrid
          dates={dates}
          slots={slots}
          canEdit={canEdit}
          onSlotClick={handleSlot}
          onEmptyClick={handleEmpty}
        />
      </div>

      <div className="calendar-mobile-only">
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, overflowX: 'auto' }}>
          {dates.map((d, i) => (
            <button
              key={i}
              onClick={() => setMobileIdx(i)}
              aria-pressed={i === mobileIdx}
              style={{
                flex: '1 0 40px', border: 'none', borderRadius: 8, padding: '6px 4px', cursor: 'pointer',
                background: i === mobileIdx ? 'var(--accent)' : (isToday(d) ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent'),
                color: i === mobileIdx ? 'var(--on-accent)' : 'var(--text-1)',
              }}
            >
              <div style={{ fontSize: 9.5, fontWeight: 700 }}>{d.toLocaleDateString('en-IN', { weekday: 'short' })}</div>
              <div style={{ fontSize: 13, fontWeight: 800 }}>{d.getDate()}</div>
            </button>
          ))}
        </div>

        <TimeGrid
          dates={[dates[mobileIdx]]}
          slots={slots}
          canEdit={canEdit}
          onSlotClick={handleSlot}
          onEmptyClick={handleEmpty}
        />
      </div>
    </>
  );
}
