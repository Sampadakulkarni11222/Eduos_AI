/**
 * State for attendance flashcards, kept free of React so every rule is
 * unit-tested directly (tests/attendance-flashcards.test.ts).
 *
 * The rules this file exists to hold:
 *   - Present/Absent records a choice on the current card and advances.
 *   - Pass defers a card into the pending queue. It never becomes Present or
 *     Absent by itself, and nothing here ever defaults an unseen card.
 *   - Go Back moves to the previously viewed card and shows its choice; it
 *     does not change it. Clearing or changing a choice is a separate action.
 *   - Undo reverts the last change (a mark, a pass or a clear), whichever card
 *     it was on, and returns to that card.
 *   - The counts always reconcile: marked + passed + unseen === total.
 */

export type CardStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';

export interface DeckStudent {
  enrollmentId: string;
  rollNo: number | null;
  studentName: string;
  admissionNo?: string | null;
  photoUrl?: string | null;
  /** What the submitted register already holds for this student, if anything. */
  recorded: CardStatus | 'HALF_DAY' | null;
}

export interface CardEntry { status: CardStatus | null; passed: boolean }

interface Change { enrollmentId: string; before: CardEntry; index: number }

export interface DeckState {
  students: DeckStudent[];
  entries: Record<string, CardEntry>;
  index: number;
  /** Indices viewed, most recent last — what Go Back walks. */
  trail: number[];
  undo: Change[];
  /** True once the teacher has reached the end of the deck at least once. */
  reachedEnd: boolean;
}

const EMPTY: CardEntry = { status: null, passed: false };

export function entryOf(state: DeckState, enrollmentId: string): CardEntry {
  return state.entries[enrollmentId] ?? EMPTY;
}

/**
 * A new deck. A draft's entries win; otherwise a student already present in
 * the submitted register starts with that status, so reopening a finished
 * register shows what it holds rather than a blank deck.
 */
export function initDeck(
  students: DeckStudent[],
  draft?: { entries: Array<{ enrollmentId: string; status: CardStatus | null; passed: boolean }>; cursor?: number } | null,
): DeckState {
  const entries: Record<string, CardEntry> = {};
  for (const s of students) {
    if (s.recorded && s.recorded !== 'HALF_DAY') entries[s.enrollmentId] = { status: s.recorded, passed: false };
  }
  const known = new Set(students.map((s) => s.enrollmentId));
  for (const e of draft?.entries ?? []) {
    if (known.has(e.enrollmentId)) entries[e.enrollmentId] = { status: e.passed ? null : e.status, passed: Boolean(e.passed) && !e.status };
  }
  const index = Math.min(Math.max(draft?.cursor ?? 0, 0), Math.max(students.length - 1, 0));
  return { students, entries, index, trail: [], undo: [], reachedEnd: false };
}

function goTo(state: DeckState, index: number): DeckState {
  if (index === state.index) return state;
  return { ...state, trail: [...state.trail, state.index].slice(-500), index };
}

/** The next card that still needs a decision, searching forward and wrapping. */
export function nextUnresolved(state: DeckState, from = state.index): number | null {
  const n = state.students.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    const e = entryOf(state, state.students[i].enrollmentId);
    if (!e.status) return i;
  }
  return null;
}

function advance(state: DeckState): DeckState {
  const n = state.students.length;
  if (state.index < n - 1) return goTo(state, state.index + 1);
  // At the end of the deck: stay put and let the UI offer review / revisit.
  return { ...state, reachedEnd: true };
}

function change(state: DeckState, next: CardEntry): DeckState {
  const s = state.students[state.index];
  if (!s) return state;
  const before = entryOf(state, s.enrollmentId);
  if (before.status === next.status && before.passed === next.passed) return state;
  return {
    ...state,
    entries: { ...state.entries, [s.enrollmentId]: next },
    undo: [...state.undo, { enrollmentId: s.enrollmentId, before, index: state.index }].slice(-200),
  };
}

export function mark(state: DeckState, status: CardStatus): DeckState {
  if (!state.students.length) return state;
  return advance(change(state, { status, passed: false }));
}

export function pass(state: DeckState): DeckState {
  if (!state.students.length) return state;
  const s = state.students[state.index];
  // Passing an already-marked card would silently drop the mark; the UI
  // offers "Clear" for that, so pass on a decided card only moves on.
  if (entryOf(state, s.enrollmentId).status) return advance(state);
  return advance(change(state, { status: null, passed: true }));
}

/** Clear the current card's choice (it becomes pending again). */
export function clear(state: DeckState): DeckState {
  return change(state, { status: null, passed: false });
}

export function goBack(state: DeckState): DeckState {
  if (!state.trail.length) {
    return state.index > 0 ? { ...state, index: state.index - 1 } : state;
  }
  const trail = state.trail.slice(0, -1);
  return { ...state, trail, index: state.trail[state.trail.length - 1] };
}

export function jumpTo(state: DeckState, index: number): DeckState {
  if (index < 0 || index >= state.students.length) return state;
  return goTo(state, index);
}

export function undo(state: DeckState): DeckState {
  const last = state.undo[state.undo.length - 1];
  if (!last) return state;
  const entries = { ...state.entries };
  if (!last.before.status && !last.before.passed) delete entries[last.enrollmentId];
  else entries[last.enrollmentId] = last.before;
  return { ...state, entries, undo: state.undo.slice(0, -1), index: last.index };
}

/** Jump to the first passed card after the current one (wrapping). */
export function revisitPassed(state: DeckState): DeckState {
  const n = state.students.length;
  for (let step = 1; step <= n; step++) {
    const i = (state.index + step) % n;
    if (entryOf(state, state.students[i].enrollmentId).passed) return goTo(state, i);
  }
  return state;
}

export interface DeckCounts {
  total: number;
  marked: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  passed: number;
  unseen: number;
  /** passed + unseen: everyone without a decision. */
  pending: number;
}

export function counts(state: DeckState): DeckCounts {
  const c: DeckCounts = { total: state.students.length, marked: 0, present: 0, absent: 0, late: 0, excused: 0, passed: 0, unseen: 0, pending: 0 };
  for (const s of state.students) {
    const e = entryOf(state, s.enrollmentId);
    if (e.status) {
      c.marked += 1;
      if (e.status === 'PRESENT') c.present += 1;
      else if (e.status === 'ABSENT') c.absent += 1;
      else if (e.status === 'LATE') c.late += 1;
      else c.excused += 1;
    } else if (e.passed) c.passed += 1;
    else c.unseen += 1;
  }
  c.pending = c.passed + c.unseen;
  return c;
}

/** Exactly the entries that would be submitted — decided cards only. */
export function submission(state: DeckState): Array<{ enrollmentId: string; status: CardStatus }> {
  return state.students
    .map((s) => ({ enrollmentId: s.enrollmentId, status: entryOf(state, s.enrollmentId).status }))
    .filter((e): e is { enrollmentId: string; status: CardStatus } => Boolean(e.status));
}

/** The draft as the server stores it. */
export function draftEntries(state: DeckState) {
  return state.students
    .map((s) => ({ enrollmentId: s.enrollmentId, ...entryOf(state, s.enrollmentId) }))
    .filter((e) => e.status || e.passed);
}

/** Search by name, roll number or admission number; returns matching indices. */
export function search(state: DeckState, query: string): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return state.students
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.studentName.toLowerCase().includes(q)
      || (s.rollNo !== null && String(s.rollNo) === q)
      || (s.admissionNo ?? '').toLowerCase().includes(q))
    .map(({ i }) => i);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}
