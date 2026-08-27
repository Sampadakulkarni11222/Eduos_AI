'use client';
import { buildMonthGrid, isSameMonth, isToday, startOfDay, toISODate } from '@/lib/timetable-dates';
import { clickable } from '../ui';
import { dayStyle, type DayInfo } from './attendance-status';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function AttendanceMonthGrid({
  anchorDate, dayInfoByDate, selectedSubject, onDayClick,
}: {
  anchorDate: Date;
  dayInfoByDate: Map<string, DayInfo>;
  selectedSubject: string | null;
  onDayClick: (date: Date) => void;
}) {
  const dates = buildMonthGrid(anchorDate);
  const today = startOfDay(new Date());

  return (
    <div>
      {/* Desktop: date + status label per cell */}
      <div className="calendar-desktop-only">
        <div className="no-grid-collapse" style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
          {WEEKDAY_LABELS.map((d) => (
            <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-muted)', padding: '8px 0' }}>{d}</div>
          ))}
        </div>
        <div className="no-grid-collapse" style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
          {dates.map((date, i) => {
            const key = toISODate(date);
            const info = dayInfoByDate.get(key);
            const inMonth = isSameMonth(date, anchorDate);
            const isFuture = startOfDay(date) > today;
            const style = dayStyle(info, isFuture);
            const matchesFilter = !selectedSubject || (info?.subjects.includes(selectedSubject) ?? false);
            const todayCell = isToday(date);

            return (
              <div
                key={i}
                {...clickable(() => onDayClick(date), { label: `Attendance on ${date.toDateString()}` })}
                className="hover-bg"
                style={{
                  minHeight: 66, borderRadius: 10, padding: 6, cursor: 'pointer',
                  background: style.bg,
                  border: todayCell ? '1.5px solid var(--accent)' : '1px solid var(--hairline)',
                  opacity: inMonth ? (matchesFilter ? 1 : 0.3) : 0.35,
                  transition: 'opacity 0.15s',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: todayCell ? 800 : 600, color: todayCell ? 'var(--accent)' : 'var(--text-1)' }}>
                  {date.getDate()}
                </div>
                {style.label && (
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: style.text, marginTop: 2 }}>{style.label}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile: compact date + color dot only */}
      <div className="calendar-mobile-only">
        <div className="no-grid-collapse" style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
          {WEEKDAY_LABELS.map((d) => (
            <div key={d} style={{ textAlign: 'center', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', padding: '4px 0' }}>{d[0]}</div>
          ))}
        </div>
        <div className="no-grid-collapse" style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3 }}>
          {dates.map((date, i) => {
            const key = toISODate(date);
            const info = dayInfoByDate.get(key);
            const inMonth = isSameMonth(date, anchorDate);
            const isFuture = startOfDay(date) > today;
            const style = dayStyle(info, isFuture);
            const matchesFilter = !selectedSubject || (info?.subjects.includes(selectedSubject) ?? false);
            const todayCell = isToday(date);

            return (
              <div
                key={i}
                {...clickable(() => onDayClick(date), { label: `Attendance on ${date.toDateString()}` })}
                style={{
                  aspectRatio: '1', borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, cursor: 'pointer',
                  background: style.bg,
                  border: todayCell ? '1.5px solid var(--accent)' : '1px solid var(--hairline)',
                  opacity: inMonth ? (matchesFilter ? 1 : 0.3) : 0.3,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: todayCell ? 800 : 600, color: todayCell ? 'var(--accent)' : 'var(--text-1)' }}>{date.getDate()}</span>
                {style.label && <span style={{ width: 5, height: 5, borderRadius: '50%', background: style.text }} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
