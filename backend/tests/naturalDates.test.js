import { describe, it, expect } from 'vitest';
import { toIsoMonth, toIsoDate, monthFromText, looksLikeMonth } from '../src/utils/naturalDates.js';

/**
 * Months and dates as people write them.
 *
 * Pure functions, so these are exact rather than approximate. `now` is injected
 * everywhere it matters: a test that depended on today's date would pass in
 * September and fail in January.
 */

// A Thursday in September 2026, matching the fixtures elsewhere.
const NOW = new Date(2026, 8, 12);

describe('toIsoMonth', () => {
  it('passes the ISO form through', () => {
    expect(toIsoMonth('2026-07')).toBe('2026-07');
  });

  it('pads loose digits, in either order', () => {
    expect(toIsoMonth('2026-7')).toBe('2026-07');
    expect(toIsoMonth('2026/7')).toBe('2026-07');
    expect(toIsoMonth('7/2026')).toBe('2026-07');
  });

  it('reads month names, full and abbreviated', () => {
    expect(toIsoMonth('july', NOW)).toBe('2026-07');
    expect(toIsoMonth('July', NOW)).toBe('2026-07');
    expect(toIsoMonth('jul', NOW)).toBe('2026-07');
    expect(toIsoMonth('sept', NOW)).toBe('2026-09');
    expect(toIsoMonth('Feb.', NOW)).toBe('2026-02');
  });

  it('takes an explicit year over the inferred one, in either order', () => {
    expect(toIsoMonth('july 2024', NOW)).toBe('2024-07');
    expect(toIsoMonth('2024 july', NOW)).toBe('2024-07');
  });

  it('reads a bare month name as the most recent one that has happened', () => {
    // Asked in September: July is this year, December is last year — never a
    // month still in the future.
    expect(toIsoMonth('july', NOW)).toBe('2026-07');
    expect(toIsoMonth('september', NOW)).toBe('2026-09');
    expect(toIsoMonth('december', NOW)).toBe('2025-12');
    expect(toIsoMonth('october', NOW)).toBe('2025-10');
  });

  it('reads relative months', () => {
    expect(toIsoMonth('this month', NOW)).toBe('2026-09');
    expect(toIsoMonth('current month', NOW)).toBe('2026-09');
    expect(toIsoMonth('last month', NOW)).toBe('2026-08');
    expect(toIsoMonth('previous month', NOW)).toBe('2026-08');
    expect(toIsoMonth('next month', NOW)).toBe('2026-10');
  });

  it('crosses a year boundary correctly', () => {
    expect(toIsoMonth('last month', new Date(2026, 0, 9))).toBe('2025-12');
    expect(toIsoMonth('next month', new Date(2026, 11, 9))).toBe('2027-01');
  });

  it('refuses what it cannot read rather than guessing', () => {
    // The whole point: an unparseable month must not quietly become "this
    // month" and answer a different question.
    for (const bad of ['bananas', 'ju', '2026-13', '13/2026', '', null, undefined, 'someday']) {
      expect(toIsoMonth(bad, NOW)).toBeNull();
    }
  });
});

describe('toIsoDate', () => {
  it('passes the ISO form through and pads loose digits', () => {
    expect(toIsoDate('2026-07-01')).toBe('2026-07-01');
    expect(toIsoDate('2026-7-1')).toBe('2026-07-01');
  });

  it('reads the relative days a conversation uses', () => {
    expect(toIsoDate('today', NOW)).toBe('2026-09-12');
    expect(toIsoDate('tomorrow', NOW)).toBe('2026-09-13');
    expect(toIsoDate('yesterday', NOW)).toBe('2026-09-11');
    expect(toIsoDate('day after tomorrow', NOW)).toBe('2026-09-14');
  });

  it('reads named dates in both orders, with ordinals', () => {
    expect(toIsoDate('1 July 2026', NOW)).toBe('2026-07-01');
    expect(toIsoDate('1st July 2026', NOW)).toBe('2026-07-01');
    expect(toIsoDate('July 1 2026', NOW)).toBe('2026-07-01');
    expect(toIsoDate('July 1st', NOW)).toBe('2026-07-01');
    expect(toIsoDate('9 sept', NOW)).toBe('2026-09-09');
  });

  it('refuses an all-digit slash date, because it is genuinely ambiguous', () => {
    // 01/07/2026 is 1 July to most of the world and 7 January to some of it. A
    // wrong date recorded confidently is worse than a question.
    expect(toIsoDate('01/07/2026', NOW)).toBeNull();
    expect(toIsoDate('7/1/2026', NOW)).toBeNull();
  });

  it('refuses what it cannot read', () => {
    for (const bad of ['bananas', '', null, 'next tuesday']) {
      expect(toIsoDate(bad, NOW)).toBeNull();
    }
  });
});

describe('monthFromText', () => {
  it('finds the ISO form first', () => {
    expect(monthFromText('my attendance for 2026-08', NOW)).toBe('2026-08');
  });

  it('finds a month name in a sentence', () => {
    expect(monthFromText('show my attendance for july', NOW)).toBe('2026-07');
    expect(monthFromText('attendance in Feb please', NOW)).toBe('2026-02');
    expect(monthFromText('how was August 2024?', NOW)).toBe('2024-08');
  });

  it('finds a relative month', () => {
    expect(monthFromText('what about last month?', NOW)).toBe('2026-08');
    expect(monthFromText('attendance this month', NOW)).toBe('2026-09');
  });

  it('does not mistake the verb "may" for the month', () => {
    // "may" is an ordinary English word, and reading it as a month would answer
    // a question about May that nobody asked.
    expect(monthFromText('may I see my attendance?', NOW)).toBeNull();
    expect(monthFromText('you may show my fees', NOW)).toBeNull();
    // Introduced or dated, it is the month.
    expect(monthFromText('my attendance in may', NOW)).toBe('2026-05');
    expect(monthFromText('attendance for may 2025', NOW)).toBe('2025-05');
  });

  it('returns null when no month is mentioned', () => {
    expect(monthFromText('show my attendance', NOW)).toBeNull();
    expect(monthFromText('', NOW)).toBeNull();
  });
});

describe('looksLikeMonth', () => {
  it('separates month words from names', () => {
    expect(looksLikeMonth('july', NOW)).toBe(true);
    expect(looksLikeMonth('last month', NOW)).toBe(true);
    expect(looksLikeMonth('Rahul', NOW)).toBe(false);
    expect(looksLikeMonth('Priya Verma', NOW)).toBe(false);
  });
});
