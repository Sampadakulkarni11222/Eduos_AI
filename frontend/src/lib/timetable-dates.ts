// Pure date-math helpers for the timetable calendar. No external dependency —
// native Date arithmetic, matching how the rest of the app already handles dates.

/** Schema convention: 1=Mon..7=Sun (see backend/src/models/timetableSlot.model.js). */
export function toDow(date: Date): number {
  const jsDay = date.getDay(); // 0=Sun..6=Sat
  return jsDay === 0 ? 7 : jsDay;
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function addWeeks(date: Date, n: number): Date {
  return addDays(date, n * 7);
}

export function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/** Monday-anchored start of the week containing `date`. */
export function startOfWeekMon(date: Date): Date {
  const dow = toDow(date); // 1=Mon..7=Sun
  return startOfDay(addDays(date, -(dow - 1)));
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** "YYYY-MM-DD" from a local Date's own year/month/day (no UTC conversion/shift). */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 6x7 grid of dates covering the full month plus leading/trailing padding days. */
export function buildMonthGrid(anchor: Date): Date[] {
  const gridStart = startOfWeekMon(startOfMonth(anchor));
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

/** Monday..Sunday dates for the week containing `anchor`. */
export function buildWeekDates(anchor: Date): Date[] {
  const start = startOfWeekMon(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export function formatDayLabel(date: Date): string {
  return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatWeekRangeLabel(dates: Date[]): string {
  const first = dates[0];
  const last = dates[dates.length - 1];
  const sameMonth = isSameMonth(first, last);
  const firstStr = first.toLocaleDateString('en-IN', { day: 'numeric', month: sameMonth ? undefined : 'short' });
  const lastStr = last.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${firstStr} – ${lastStr}`;
}

/**
 * Formats a **calendar date** (leave dates, due dates, holidays) — a day on a
 * calendar, not an instant in time.
 *
 * The API stores these at UTC midnight, so rendering them with the viewer's
 * local timezone moves them backwards a day for anyone west of UTC: a leave
 * booked for 15 August displayed as 14 August in New York. Formatting in UTC
 * keeps the date the user picked as the date everyone sees.
 *
 * Use this for date-only values. For real timestamps (createdAt, submittedAt)
 * local time is correct and this is the wrong helper.
 */
export function formatCalendarDate(
  value: string | Date,
  opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' });
}

/** Duration in minutes between "HH:MM" strings, formatted like "45 min" or "1h 15min". */
export function formatDuration(startTime: string, endTime: string): string {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  if (!Number.isFinite(mins) || mins <= 0) return '—';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}
