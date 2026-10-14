import type { AttStatus, AttendanceRoster } from '@/lib/types';

/** The flashcard deck's tallies, as it reports them through `onCounts`. */
export interface DeckCounts { present: number; absent: number; late: number; excused: number }

/** Status counts for the list-mode marks. */
export function countStatuses(data: AttendanceRoster, marks: Record<string, AttStatus>) {
  const c = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, HALF_DAY: 0 };
  data.roster.forEach((r) => {
    const s = marks[r.enrollmentId] ?? null;
    if (s) c[s] += 1;
  });
  return c;
}

/**
 * What the filter-row summary shows.
 *
 * List mode and flashcard mode keep separate marks. The summary used to read
 * the list's marks in both modes, so with the deck open it said "0 present ·
 * 0 absent" while the deck itself said "4 present · 1 absent". In card mode it
 * now shows the deck's own counts (or nothing until the deck reports them).
 */
export function toolbarSummary(
  mode: 'list' | 'cards',
  list: ReturnType<typeof countStatuses> | null,
  deck: DeckCounts | null,
): { present: number; absent: number; late: number } | null {
  if (mode === 'cards') return deck ? { present: deck.present, absent: deck.absent, late: deck.late } : null;
  return list ? { present: list.PRESENT, absent: list.ABSENT, late: list.LATE } : null;
}
