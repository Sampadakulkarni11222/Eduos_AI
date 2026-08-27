'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { subjectColor } from '../ui';
import {
  formatHourLabel, formatTimeLabel, isToday, minutesFromHm, minutesOfDay, toDow,
} from '@/lib/timetable-dates';
import { hmFromMinutes } from '@/lib/timetable-dates';
import { gridHourWindow, nextPeriodForDay, positionDay } from '@/lib/timetable-layout';
import type { PositionedSlot } from '@/lib/timetable-layout';
import type { TimetableSlotDto } from '@/lib/types';

const GUTTER_PX = 60;
const HEADER_PX = 56;
/** One hour of wall-clock time is this many pixels tall. Drives everything else. */
const PX_PER_HOUR = 56;
const PX_PER_MIN = PX_PER_HOUR / 60;
/** Below this height a chip can only fit one line, so drop the secondary rows. */
const COMPACT_CHIP_PX = 34;
/** Click-to-create snaps to this many minutes, as Google Calendar does. */
const SNAP_MIN = 15;
/** Default length of a slot created by clicking empty space. */
const DEFAULT_SLOT_MIN = 45;

export function TimeGrid({
  dates, slots, canEdit, onSlotClick, onEmptyClick,
}: {
  dates: Date[];
  slots: TimetableSlotDto[];
  canEdit: boolean;
  onSlotClick: (slot: TimetableSlotDto) => void;
  /**
   * Fired when staff click empty space in a day column. `startTime`/`endTime`
   * come from where in the column they clicked, so the editor opens on that
   * time rather than a fixed default.
   */
  onEmptyClick: (dayOfWeek: number, periodNo: number, startTime: string, endTime: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nowMin, setNowMin] = useState(() => minutesOfDay(new Date()));

  // The "now" line only needs minute resolution. Tick on the minute boundary
  // rather than every 60s from mount, so it never drifts a full minute late.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNowMin(minutesOfDay(new Date()));
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000));
    };
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000));
    return () => clearTimeout(timer);
  }, []);

  const byDay = useMemo(() => {
    const map = new Map<number, PositionedSlot[]>();
    for (const d of dates) {
      const dow = toDow(d);
      if (!map.has(dow)) map.set(dow, positionDay(slots.filter((s) => s.dayOfWeek === dow)));
    }
    return map;
  }, [dates, slots]);

  // Window the grid to the school day (padded an hour either side) instead of a
  // full 24 hours — an empty midnight-to-6am expanse is what makes a naive time
  // grid feel broken.
  const { startHour, endHour } = useMemo(() => gridHourWindow(slots), [slots]);

  const startMinOfGrid = startHour * 60;
  const bodyHeight = (endHour - startHour) * PX_PER_HOUR;
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);
  const topFor = (min: number) => (min - startMinOfGrid) * PX_PER_MIN;

  // Open on the first class rather than at the top of the padding hour.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const firstStart = Math.min(
      ...slots.map((s) => minutesFromHm(s.startTime)).filter((m): m is number => m != null),
    );
    if (!Number.isFinite(firstStart)) return;
    el.scrollTop = Math.max(0, topFor(firstStart) - PX_PER_HOUR / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, startHour]);

  const nextPeriodFor = (dow: number) => nextPeriodForDay(slots, dow);

  const showNow = dates.some((d) => isToday(d)) && nowMin >= startMinOfGrid && nowMin <= endHour * 60;
  const gridCols = `${GUTTER_PX}px repeat(${dates.length}, minmax(0, 1fr))`;

  return (
    <div className="cal-grid" style={{ border: '1px solid var(--hairline)', borderRadius: 12, overflow: 'hidden' }}>
      {/* Sticky day header — stays put while the time body scrolls. */}
      <div
        className="no-grid-collapse cal-grid-head"
        style={{ display: 'grid', gridTemplateColumns: gridCols, borderBottom: '1px solid var(--hairline)' }}
      >
        <div style={{ height: HEADER_PX, borderRight: '1px solid var(--hairline)' }} />
        {dates.map((d, i) => {
          const today = isToday(d);
          return (
            <div
              key={i}
              style={{
                height: HEADER_PX, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 2,
                borderRight: i === dates.length - 1 ? 'none' : '1px solid var(--hairline)',
              }}
            >
              <div style={{
                fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
                color: today ? 'var(--accent)' : 'var(--text-muted)',
              }}>
                {d.toLocaleDateString('en-IN', { weekday: 'short' })}
              </div>
              {/* Today's date sits in a filled disc, as in Google Calendar. */}
              <div style={{
                width: 26, height: 26, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: today ? 800 : 600,
                background: today ? 'var(--accent)' : 'transparent',
                color: today ? 'var(--on-accent)' : 'var(--text-1)',
              }}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      <div ref={scrollRef} className="cal-grid-body" style={{ maxHeight: 560, overflowY: 'auto' }}>
        <div className="no-grid-collapse" style={{ display: 'grid', gridTemplateColumns: gridCols, position: 'relative' }}>
          {/* Hour gutter */}
          <div style={{ position: 'relative', height: bodyHeight, borderRight: '1px solid var(--hairline)' }}>
            {hours.slice(0, -1).map((h) => (
              <div
                key={h}
                style={{
                  position: 'absolute', top: topFor(h * 60), right: 6,
                  transform: 'translateY(-50%)', fontSize: 10.5, color: 'var(--text-faint)',
                  whiteSpace: 'nowrap',
                }}
              >
                {h === startHour ? '' : formatHourLabel(h)}
              </div>
            ))}
          </div>

          {/* One column per day */}
          {dates.map((d, i) => {
            const dow = toDow(d);
            const positioned = byDay.get(dow) ?? [];
            const today = isToday(d);
            return (
              // Click-to-create derives the start time from where in the column
              // the pointer landed, which has no keyboard equivalent. Keyboard
              // users reach the same editor through the "Add Timetable Slot"
              // button in the toolbar, and every existing slot below is a real
              // <button>, so nothing here is keyboard-only-unreachable.
              // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
              <div
                key={i}
                onClick={canEdit ? (e) => {
                  // Translate the click's Y offset within the column back into a
                  // wall-clock time, snapped to the nearest quarter hour.
                  const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                  const raw = startMinOfGrid + y / PX_PER_MIN;
                  const snapped = Math.round(raw / SNAP_MIN) * SNAP_MIN;
                  const start = Math.max(startMinOfGrid, Math.min(snapped, endHour * 60 - DEFAULT_SLOT_MIN));
                  onEmptyClick(dow, nextPeriodFor(dow), hmFromMinutes(start), hmFromMinutes(start + DEFAULT_SLOT_MIN));
                } : undefined}
                style={{
                  position: 'relative', height: bodyHeight,
                  borderRight: i === dates.length - 1 ? 'none' : '1px solid var(--hairline)',
                  background: today ? 'color-mix(in srgb, var(--accent) 4%, transparent)' : undefined,
                  cursor: canEdit ? 'copy' : 'default',
                }}
              >
                {/* Hour lines */}
                {hours.slice(1, -1).map((h) => (
                  <div key={h} style={{ position: 'absolute', top: topFor(h * 60), left: 0, right: 0, borderTop: '1px solid var(--hairline)' }} />
                ))}

                {positioned.map(({ slot, startMin, endMin, col, cols }) => {
                  const height = Math.max((endMin - startMin) * PX_PER_MIN, 18);
                  const widthPct = 100 / cols;
                  const compact = height < COMPACT_CHIP_PX;
                  const color = subjectColor(slot.subject);
                  const label = slot.isBreak ? 'Break' : (slot.subject ?? 'Class');
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      className="cal-event"
                      title={`${label} · ${formatTimeLabel(slot.startTime)} – ${formatTimeLabel(slot.endTime)}${slot.room ? ` · ${slot.room}` : ''}`}
                      onClick={(e) => { e.stopPropagation(); onSlotClick(slot); }}
                      style={{
                        position: 'absolute',
                        top: topFor(startMin),
                        height: height - 2,
                        left: `calc(${col * widthPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        textAlign: 'left', border: 'none', cursor: 'pointer',
                        borderRadius: 6, padding: compact ? '1px 6px' : '3px 6px',
                        overflow: 'hidden',
                        // Breaks read as an inactive strip, not a subject block.
                        background: slot.isBreak ? 'var(--hairline-2, rgba(0,0,0,.06))' : color.bg,
                        borderLeft: slot.isBreak ? '3px solid var(--text-faint)' : `3px solid ${color.dot}`,
                        color: slot.isBreak ? 'var(--text-faint)' : color.text,
                        font: 'inherit', lineHeight: 1.25,
                      }}
                    >
                      <div style={{
                        fontWeight: 700, fontSize: compact ? 10 : 11.5,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {label}
                      </div>
                      {!compact && (
                        <>
                          <div style={{ fontSize: 10, opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {formatTimeLabel(slot.startTime)}
                          </div>
                          {height > 58 && !slot.isBreak && (slot.teacher || slot.room) && (
                            <div style={{ fontSize: 9.5, opacity: 0.75, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {[slot.teacher, slot.room].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </>
                      )}
                    </button>
                  );
                })}

                {/* Current-time line, on today's column only. */}
                {today && showNow && (
                  <div
                    aria-hidden
                    style={{ position: 'absolute', top: topFor(nowMin), left: 0, right: 0, height: 0, zIndex: 3, pointerEvents: 'none' }}
                  >
                    <div style={{ position: 'absolute', left: -4, top: -4, width: 8, height: 8, borderRadius: '50%', background: '#d93025' }} />
                    <div style={{ borderTop: '2px solid #d93025' }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
