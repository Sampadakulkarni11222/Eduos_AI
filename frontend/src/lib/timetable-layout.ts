/**
 * Pure layout maths for the Google-Calendar-style time grid. Kept out of the
 * component so it can be reasoned about (and tested) without rendering.
 */
import { minutesFromHm } from './timetable-dates';
import type { TimetableSlotDto } from './types';

export type PositionedSlot = {
  slot: TimetableSlotDto;
  startMin: number;
  endMin: number;
  /** Column index within its overlap cluster, and how many columns that cluster needs. */
  col: number;
  cols: number;
};

/**
 * Lays out one day's slots the way Google Calendar does: anything overlapping
 * in time is split into side-by-side columns instead of drawn on top of each
 * other. School timetables rarely double-book a section, but a bad import can,
 * and silently hiding one of two classes is the worst failure mode here.
 *
 * Slots with missing or non-positive durations are dropped — they have no
 * height to occupy and would otherwise render as invisible click targets.
 */
export function positionDay(slots: TimetableSlotDto[]): PositionedSlot[] {
  const timed = slots
    .map((slot) => {
      const startMin = minutesFromHm(slot.startTime);
      const endMin = minutesFromHm(slot.endTime);
      if (startMin == null || endMin == null || endMin <= startMin) return null;
      return { slot, startMin, endMin };
    })
    .filter((x): x is { slot: TimetableSlotDto; startMin: number; endMin: number } => x !== null)
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const out: PositionedSlot[] = [];
  // Walk the day accumulating a cluster of mutually overlapping events; when a
  // gap appears, flush the cluster so its members share a final column count.
  let cluster: Array<{ slot: TimetableSlotDto; startMin: number; endMin: number }> = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    const colEnds: number[] = [];
    const assigned = cluster.map((item) => {
      // Reuse the first column that has already finished; otherwise open a new one.
      let col = colEnds.findIndex((end) => end <= item.startMin);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(item.endMin);
      } else {
        colEnds[col] = item.endMin;
      }
      return { ...item, col };
    });
    for (const a of assigned) out.push({ ...a, cols: colEnds.length });
    cluster = [];
    clusterEnd = -1;
  };

  for (const item of timed) {
    if (cluster.length > 0 && item.startMin >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  flush();
  return out;
}

/**
 * The hour window the grid should show: the school day padded an hour either
 * side, rather than a full 24 hours. An empty midnight-to-6am expanse is what
 * makes a naive time grid feel broken. Falls back to 7am–6pm with no slots.
 */
export function gridHourWindow(slots: TimetableSlotDto[]): { startHour: number; endHour: number } {
  const mins = slots
    .flatMap((s) => [minutesFromHm(s.startTime), minutesFromHm(s.endTime)])
    .filter((m): m is number => m != null);
  if (mins.length === 0) return { startHour: 7, endHour: 18 };
  const lo = Math.max(0, Math.floor(Math.min(...mins) / 60) - 1);
  const hi = Math.min(24, Math.ceil(Math.max(...mins) / 60) + 1);
  // Always leave a usable amount of grid, even for a single short slot.
  return { startHour: lo, endHour: Math.max(hi, lo + 4) };
}

/** Lowest period number not yet used on a given weekday — what a new slot gets. */
export function nextPeriodForDay(slots: TimetableSlotDto[], dayOfWeek: number): number {
  const used = new Set(slots.filter((s) => s.dayOfWeek === dayOfWeek).map((s) => s.periodNo));
  let p = 1;
  while (used.has(p)) p += 1;
  return p;
}
