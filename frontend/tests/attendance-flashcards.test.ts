import { describe, it, expect } from 'vitest';
import {
  type DeckStudent, initDeck, mark, pass, goBack, undo, clear, counts, submission, revisitPassed,
  jumpTo, search, entryOf, draftEntries, initials,
} from '@/components/attendance/flashcard-logic';

const roster = (n: number, recorded: Partial<Record<number, DeckStudent['recorded']>> = {}): DeckStudent[] =>
  Array.from({ length: n }, (_, i) => ({
    enrollmentId: `e${i + 1}`, rollNo: i + 1, studentName: i === 3 ? 'Rahul Sharma' : `Student ${i + 1}`,
    admissionNo: `ADM-${i + 1}`, recorded: recorded[i] ?? null,
  }));

const reconcile = (c: ReturnType<typeof counts>) => c.marked + c.passed + c.unseen === c.total && c.pending === c.passed + c.unseen;

describe('marking', () => {
  it('Present/Absent record a choice and advance', () => {
    let s = initDeck(roster(3));
    s = mark(s, 'PRESENT');
    expect(s.index).toBe(1);
    s = mark(s, 'ABSENT');
    expect(entryOf(s, 'e1').status).toBe('PRESENT');
    expect(entryOf(s, 'e2').status).toBe('ABSENT');
    const c = counts(s);
    expect([c.present, c.absent, c.unseen]).toEqual([1, 1, 1]);
    expect(reconcile(c)).toBe(true);
  });

  it('stays on the last card at the end of the deck', () => {
    let s = initDeck(roster(2));
    s = mark(mark(s, 'PRESENT'), 'PRESENT');
    expect(s.index).toBe(1);
    expect(s.reachedEnd).toBe(true);
  });
});

describe('pass', () => {
  it('defers a card without marking it, and it is never submitted', () => {
    let s = initDeck(roster(3));
    s = pass(s);
    s = mark(s, 'PRESENT');
    expect(entryOf(s, 'e1')).toEqual({ status: null, passed: true });
    expect(submission(s)).toEqual([{ enrollmentId: 'e2', status: 'PRESENT' }]);
    const c = counts(s);
    expect(c.passed).toBe(1);
    expect(reconcile(c)).toBe(true);
  });

  it('passing an already-marked card keeps its mark', () => {
    let s = initDeck(roster(2));
    s = mark(s, 'ABSENT');
    s = goBack(s);
    s = pass(s);
    expect(entryOf(s, 'e1').status).toBe('ABSENT');
  });

  it('revisit jumps to the next passed card', () => {
    let s = initDeck(roster(4));
    s = pass(s); s = mark(s, 'PRESENT'); s = pass(s); s = mark(s, 'PRESENT');
    s = revisitPassed(s);
    expect(s.index).toBe(0);
    s = mark(s, 'ABSENT');
    s = revisitPassed(s);
    expect(s.index).toBe(2);
  });
});

describe('go back and undo', () => {
  it('Go Back shows the previous card and its choice without changing it', () => {
    let s = initDeck(roster(3));
    s = mark(s, 'ABSENT');
    s = goBack(s);
    expect(s.index).toBe(0);
    expect(entryOf(s, 'e1').status).toBe('ABSENT');
    expect(counts(s).absent).toBe(1);
  });

  it('Go Back walks the viewing trail, including jumps', () => {
    let s = initDeck(roster(10));
    s = jumpTo(s, 7);
    s = mark(s, 'PRESENT'); // now on 8
    s = goBack(s);
    expect(s.index).toBe(7);
    s = goBack(s);
    expect(s.index).toBe(0);
  });

  it('Undo reverts the last change and returns to that card', () => {
    let s = initDeck(roster(3));
    s = mark(s, 'PRESENT');
    s = mark(s, 'ABSENT');
    s = undo(s);
    expect(s.index).toBe(1);
    expect(entryOf(s, 'e2').status).toBeNull();
    expect(entryOf(s, 'e1').status).toBe('PRESENT');
  });

  it('Clear makes a card pending again and can be undone', () => {
    let s = initDeck(roster(2));
    s = mark(s, 'PRESENT');
    s = goBack(s);
    s = clear(s);
    expect(entryOf(s, 'e1').status).toBeNull();
    s = undo(s);
    expect(entryOf(s, 'e1').status).toBe('PRESENT');
  });
});

describe('resume and reopen', () => {
  it('a draft restores choices, passes and position', () => {
    const s = initDeck(roster(4), { cursor: 2, entries: [{ enrollmentId: 'e1', status: 'ABSENT', passed: false }, { enrollmentId: 'e2', status: null, passed: true }] });
    expect(s.index).toBe(2);
    expect(entryOf(s, 'e1').status).toBe('ABSENT');
    expect(entryOf(s, 'e2').passed).toBe(true);
  });

  it('reopening a submitted register starts from what it holds', () => {
    const s = initDeck(roster(3, { 0: 'PRESENT', 1: 'ABSENT' }));
    expect(counts(s)).toMatchObject({ present: 1, absent: 1, unseen: 1 });
  });

  it('draft entries from students no longer on the roster are ignored', () => {
    const s = initDeck(roster(2), { entries: [{ enrollmentId: 'gone', status: 'PRESENT', passed: false }] });
    expect(counts(s).marked).toBe(0);
    expect(draftEntries(s)).toEqual([]);
  });

  it('an empty roster is safe', () => {
    let s = initDeck([]);
    s = mark(s, 'PRESENT'); s = pass(s); s = goBack(s); s = undo(s);
    expect(counts(s)).toMatchObject({ total: 0, marked: 0, pending: 0 });
  });
});

describe('search', () => {
  it('finds by name, roll number and admission number — duplicates included', () => {
    const students = roster(5);
    students[4].studentName = 'Rahul Sharma';
    const s = initDeck(students);
    expect(search(s, 'rahul')).toEqual([3, 4]);
    expect(search(s, '2')).toEqual([1]);
    expect(search(s, 'adm-5')).toEqual([4]);
  });

  it('builds initials for the photo fallback', () => {
    expect(initials('Priya Verma')).toBe('PV');
    expect(initials('Aman')).toBe('A');
  });
});
