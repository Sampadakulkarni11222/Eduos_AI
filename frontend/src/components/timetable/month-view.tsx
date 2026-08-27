'use client';
import { clickable, subjectColor } from '../ui';
import { buildMonthGrid, isSameMonth, isToday, toDow } from '@/lib/timetable-dates';
import type { TimetableSlotDto } from '@/lib/types';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function MonthView({
  anchorDate, slots, onDayClick,
}: {
  anchorDate: Date;
  slots: TimetableSlotDto[];
  onDayClick: (date: Date) => void;
}) {
  const dates = buildMonthGrid(anchorDate);
  const slotsForDow = (dow: number) => slots.filter((s) => s.dayOfWeek === dow && !s.isBreak).sort((a, b) => a.periodNo - b.periodNo);

  return (
    <>
      {/* Desktop: full chip grid */}
      <div className="calendar-desktop-only" style={{ overflowX: 'auto' }}>
        <div className="no-grid-collapse" style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', minWidth: 700 }}>
          {WEEKDAY_LABELS.map((d) => (
            <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-muted)', padding: '8px 0' }}>{d}</div>
          ))}
        </div>
        <div className="no-grid-collapse" style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, minWidth: 700 }}>
          {dates.map((date, i) => {
            const dow = toDow(date);
            const daySlots = slotsForDow(dow);
            const inMonth = isSameMonth(date, anchorDate);
            const today = isToday(date);
            return (
              <div
                key={i}
                {...clickable(() => onDayClick(date), { label: `Classes on ${date.toDateString()}` })}
                className="hover-bg"
                style={{
                  minHeight: 92, borderRadius: 10, padding: 6, cursor: 'pointer',
                  background: today ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                  border: today ? '1.5px solid var(--accent)' : '1px solid var(--hairline)',
                  opacity: inMonth ? 1 : 0.4,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: today ? 800 : 600, color: today ? 'var(--accent)' : 'var(--text-1)', marginBottom: 4 }}>
                  {date.getDate()}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {daySlots.slice(0, 3).map((s) => {
                    const c = subjectColor(s.subject);
                    return (
                      <div key={s.id} style={{ fontSize: 10, fontWeight: 600, color: c.text, background: c.bg, borderRadius: 5, padding: '2px 5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {s.startTime} {s.subject}
                      </div>
                    );
                  })}
                  {daySlots.length > 3 && (
                    <div style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 600 }}>+{daySlots.length - 3} more</div>
                  )}
                  {daySlots.length === 0 && inMonth && (
                    <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>Free day</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile: compact dot-only cells */}
      <div className="calendar-mobile-only">
        <div className="no-grid-collapse" style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
          {WEEKDAY_LABELS.map((d) => (
            <div key={d} style={{ textAlign: 'center', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', padding: '4px 0' }}>{d[0]}</div>
          ))}
        </div>
        <div className="no-grid-collapse" style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3 }}>
          {dates.map((date, i) => {
            const dow = toDow(date);
            const daySlots = slotsForDow(dow);
            const inMonth = isSameMonth(date, anchorDate);
            const today = isToday(date);
            return (
              <div
                key={i}
                {...clickable(() => onDayClick(date), { label: `Classes on ${date.toDateString()}` })}
                style={{
                  aspectRatio: '1', borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, cursor: 'pointer',
                  background: today ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                  border: today ? '1.5px solid var(--accent)' : '1px solid var(--hairline)',
                  opacity: inMonth ? 1 : 0.35,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: today ? 800 : 600, color: today ? 'var(--accent)' : 'var(--text-1)' }}>{date.getDate()}</span>
                <div style={{ display: 'flex', gap: 2 }}>
                  {daySlots.slice(0, 4).map((s) => (
                    <span key={s.id} style={{ width: 5, height: 5, borderRadius: '50%', background: subjectColor(s.subject).dot }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
