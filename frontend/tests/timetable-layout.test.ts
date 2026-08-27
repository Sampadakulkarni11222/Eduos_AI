import { describe, it, expect } from 'vitest';
import { positionDay, gridHourWindow, nextPeriodForDay } from '@/lib/timetable-layout';
import { minutesFromHm, hmFromMinutes, formatHourLabel, formatTimeLabel } from '@/lib/timetable-dates';
import type { TimetableSlotDto } from '@/lib/types';

/**
 * Layout maths behind the Google-Calendar-style time grid. This module was
 * extracted from the component specifically so it could be tested without
 * rendering; these cases were originally run ad hoc and are now committed.
 */

const slot = (id: string, startTime: string, endTime: string, over: Partial<TimetableSlotDto> = {}): TimetableSlotDto => ({
  id,
  dayOfWeek: 1,
  periodNo: Number(id.replace(/\D/g, '')) || 1,
  startTime,
  endTime,
  subject: `Subject ${id}`,
  teacher: 'T',
  subjectOfferingId: null,
  isBreak: false,
  room: null,
  liveClassLink: null,
  ...over,
});

describe('time parsing and labels', () => {
  it('parses HH:MM into minutes since midnight', () => {
    expect(minutesFromHm('09:30')).toBe(570);
    expect(minutesFromHm('00:00')).toBe(0);
  });

  it('returns null for unparseable times rather than NaN', () => {
    for (const bad of ['9am', '', null, undefined, 'noon']) {
      expect(minutesFromHm(bad as string)).toBeNull();
    }
  });

  it('round-trips minutes back to HH:MM', () => {
    expect(hmFromMinutes(570)).toBe('09:30');
    expect(hmFromMinutes(0)).toBe('00:00');
  });

  it('clamps out-of-range minutes into a single day', () => {
    expect(hmFromMinutes(-10)).toBe('00:00');
    expect(hmFromMinutes(99_999)).toBe('23:59');
  });

  it('formats hour labels the way Google Calendar does', () => {
    expect(formatHourLabel(0)).toBe('12 AM');
    expect(formatHourLabel(12)).toBe('12 PM');
    expect(formatHourLabel(13)).toBe('1 PM');
  });

  it('formats event times with a meridiem', () => {
    expect(formatTimeLabel('09:05')).toBe('9:05 AM');
    expect(formatTimeLabel('13:00')).toBe('1:00 PM');
    expect(formatTimeLabel('bad')).toBe('—');
  });
});

describe('positionDay — non-overlapping', () => {
  it('gives every slot the full width', () => {
    const laid = positionDay([slot('1', '09:00', '09:45'), slot('2', '10:00', '10:45')]);
    expect(laid).toHaveLength(2);
    expect(laid.every((s) => s.cols === 1 && s.col === 0)).toBe(true);
  });

  it('preserves durations, which is what drives chip height', () => {
    const short = positionDay([slot('1', '09:00', '09:15')])[0];
    const long = positionDay([slot('1', '09:00', '10:30')])[0];
    expect((short.endMin - short.startMin) * 6).toBe(long.endMin - long.startMin);
  });
});

describe('positionDay — overlap', () => {
  it('splits two overlapping slots into side-by-side columns', () => {
    const laid = positionDay([slot('1', '09:00', '10:00'), slot('2', '09:30', '10:30')]);
    expect(laid.every((s) => s.cols === 2)).toBe(true);
    expect(new Set(laid.map((s) => s.col)).size).toBe(2);
  });

  it('widens to three columns for a three-way overlap', () => {
    const laid = positionDay([
      slot('1', '09:00', '12:00'), slot('2', '09:30', '10:30'), slot('3', '09:45', '11:00'),
    ]);
    expect(laid.every((s) => s.cols === 3)).toBe(true);
    expect(new Set(laid.map((s) => s.col)).size).toBe(3);
  });

  it('returns to full width after a gap', () => {
    const laid = positionDay([
      slot('1', '09:00', '10:00'), slot('2', '09:30', '10:30'), slot('3', '11:00', '12:00'),
    ]);
    expect(laid.find((s) => s.slot.id === '3')!.cols).toBe(1);
  });

  it('reuses a column once its event has finished', () => {
    // Without reuse this cluster would needlessly widen to three columns.
    const laid = positionDay([
      slot('1', '09:00', '10:00'), slot('2', '09:00', '11:00'), slot('3', '10:00', '10:45'),
    ]);
    const third = laid.find((s) => s.slot.id === '3')!;
    expect(third.cols).toBe(2);
    expect(third.col).toBe(0);
  });
});

describe('positionDay — bad data', () => {
  it('drops zero, negative and unparseable durations', () => {
    // A zero-height chip would be an invisible click target rather than a
    // visible mistake, so these are discarded instead of rendered.
    const laid = positionDay([
      slot('1', '09:00', '09:00'),
      slot('2', '10:00', '09:00'),
      slot('3', 'x', 'y'),
      slot('4', '11:00', '11:30'),
    ]);
    expect(laid).toHaveLength(1);
    expect(laid[0].slot.id).toBe('4');
  });

  it('returns an empty layout for an empty day', () => {
    expect(positionDay([])).toEqual([]);
  });
});

describe('gridHourWindow', () => {
  it('pads the school day by an hour either side', () => {
    expect(gridHourWindow([slot('1', '08:30', '09:15'), slot('2', '14:00', '14:45')]))
      .toEqual({ startHour: 7, endHour: 16 });
  });

  it('falls back to 7am–6pm with no slots', () => {
    expect(gridHourWindow([])).toEqual({ startHour: 7, endHour: 18 });
  });

  it('keeps a usable window for a single short slot', () => {
    const w = gridHourWindow([slot('1', '09:00', '09:20')]);
    expect(w.endHour - w.startHour).toBeGreaterThanOrEqual(4);
  });

  it('never runs past midnight in either direction', () => {
    const w = gridHourWindow([slot('1', '00:10', '23:50')]);
    expect(w.startHour).toBeGreaterThanOrEqual(0);
    expect(w.endHour).toBeLessThanOrEqual(24);
  });
});

describe('nextPeriodForDay', () => {
  const day = [
    slot('1', '09:00', '10:00', { periodNo: 1 }),
    slot('2', '10:00', '11:00', { periodNo: 2 }),
  ];

  it('picks the next free period number', () => {
    expect(nextPeriodForDay(day, 1)).toBe(3);
  });

  it('fills a gap in the numbering', () => {
    expect(nextPeriodForDay([slot('a', '09:00', '10:00', { periodNo: 2 })], 1)).toBe(1);
  });

  it('starts at 1 on a day with no slots', () => {
    expect(nextPeriodForDay(day, 5)).toBe(1);
  });
});
