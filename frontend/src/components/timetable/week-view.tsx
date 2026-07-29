'use client';
import { useEffect, useState } from 'react';
import { Button, subjectColor } from '../ui';
import { buildWeekDates, isToday, toDow } from '@/lib/timetable-dates';
import type { TimetableSlotDto } from '@/lib/types';

export function WeekView({
  anchorDate, slots, canEdit, onSlotClick, onCellClick,
}: {
  anchorDate: Date;
  slots: TimetableSlotDto[];
  canEdit: boolean;
  onSlotClick: (slot: TimetableSlotDto) => void;
  onCellClick: (dayOfWeek: number, periodNo: number, existing: TimetableSlotDto | null) => void;
}) {
  const dates = buildWeekDates(anchorDate);
  const periods = Array.from(new Set(slots.map((s) => s.periodNo))).sort((a, b) => a - b);
  const minP = periods[0];
  const maxP = periods[periods.length - 1];
  const cell = (dow: number, period: number) => slots.find((s) => s.dayOfWeek === dow && s.periodNo === period) ?? null;

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

  const renderCellContent = (c: TimetableSlotDto | null, p: number) => {
    if (c && !c.isBreak) {
      const color = subjectColor(c.subject);
      return (
        <div style={{ background: color.bg, borderRadius: 8, padding: '6px 8px', height: '100%' }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: color.text }}>{c.subject}</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>{c.teacher ?? '—'}</div>
          <div style={{ fontSize: 9.5, color: 'var(--text-faint)' }}>{c.startTime}-{c.endTime}{c.room ? ` · ${c.room}` : ''}</div>
        </div>
      );
    }
    if (c && c.isBreak) {
      return <div style={{ fontSize: 10.5, color: 'var(--text-faint)', textAlign: 'center', padding: '10px 0' }}>Break</div>;
    }
    if (minP != null && p >= minP && p <= maxP) {
      return <div style={{ fontSize: 10.5, color: 'var(--text-faint)', textAlign: 'center', padding: '10px 0', fontStyle: 'italic' }}>Free period</div>;
    }
    return <span style={{ color: 'var(--text-faint)' }}>—</span>;
  };

  if (periods.length === 0) {
    return <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>No periods configured for this section yet.</div>;
  }

  return (
    <>
      {/* Desktop: full week grid (date columns x period rows) */}
      <div className="calendar-desktop-only" style={{ overflowX: 'auto' }}>
        <table className="data-table" style={{ minWidth: 720, tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ width: 60 }}>Period</th>
              {dates.map((d, i) => (
                <th key={i} style={{ textAlign: 'center', color: isToday(d) ? 'var(--accent)' : undefined }}>
                  {d.toLocaleDateString('en-IN', { weekday: 'short' })}
                  <div style={{ fontSize: 15, fontWeight: 800 }}>{d.getDate()}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p}>
                <td className="cell-primary">P{p}</td>
                {dates.map((d, i) => {
                  const dow = toDow(d);
                  const c = cell(dow, p);
                  const clickable = canEdit || !!(c && !c.isBreak);
                  return (
                    <td
                      key={i}
                      onClick={() => {
                        if (canEdit) onCellClick(dow, p, c);
                        else if (c && !c.isBreak) onSlotClick(c);
                      }}
                      style={{
                        cursor: clickable ? 'pointer' : 'default',
                        background: isToday(d) ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : undefined,
                        padding: 4,
                        verticalAlign: 'top',
                      }}
                      className={clickable ? 'hover-bg' : ''}
                    >
                      {renderCellContent(c, p)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: single-day agenda with a date-strip switcher */}
      <div className="calendar-mobile-only">
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, overflowX: 'auto' }}>
          {dates.map((d, i) => (
            <button
              key={i}
              onClick={() => setMobileIdx(i)}
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

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Button variant="ghost" small type="button" onClick={() => setMobileIdx((i) => Math.max(0, i - 1))} disabled={mobileIdx === 0}>‹ Prev Day</Button>
          <Button variant="ghost" small type="button" onClick={() => setMobileIdx((i) => Math.min(6, i + 1))} disabled={mobileIdx === 6}>Next Day ›</Button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {periods.map((p) => {
            const dow = toDow(dates[mobileIdx]);
            const c = cell(dow, p);
            const clickable = canEdit || !!(c && !c.isBreak);
            return (
              <div
                key={p}
                onClick={() => {
                  if (canEdit) onCellClick(dow, p, c);
                  else if (c && !c.isBreak) onSlotClick(c);
                }}
                className={clickable ? 'hover-bg' : ''}
                style={{ display: 'flex', gap: 10, padding: '8px 10px', borderRadius: 8, cursor: clickable ? 'pointer' : 'default', background: 'rgba(0,0,0,.015)' }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', flexShrink: 0, width: 26 }}>P{p}</span>
                <div style={{ flex: 1 }}>{renderCellContent(c, p)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
