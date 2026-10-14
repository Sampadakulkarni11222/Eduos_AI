import { describe, it, expect } from 'vitest';
import { resolvePeriod, comparisonPeriod, change, buckets, periodFromDates, localMidnight } from '../src/utils/periods.js';

/** Periods are half-open, in the school's time zone, and comparisons say what they compare. */
const NOW = new Date('2026-10-14T05:00:00Z'); // 10:30 IST, Wednesday

describe('periods in the school time zone', () => {
  it('turns inclusive dates into a half-open range at IST midnight', () => {
    const p = periodFromDates('2026-07-01', '2026-07-31');
    expect(p.start.toISOString()).toBe('2026-06-30T18:30:00.000Z');
    expect(p.end.toISOString()).toBe('2026-07-31T18:30:00.000Z');
    expect(p.days).toBe(31);
    // 00:30 IST on 1 August is outside July.
    expect(new Date('2026-07-31T19:00:00Z') < p.end).toBe(false);
  });

  it('refuses impossible and backwards ranges', () => {
    expect(() => periodFromDates('2026-02-30', '2026-03-01')).toThrow(/real date/);
    expect(() => periodFromDates('2026-03-02', '2026-03-01')).toThrow(/on or after/);
  });

  it('knows academic, financial and quarter boundaries without assuming they match', () => {
    const fy = resolvePeriod({ preset: 'financialYear', now: NOW });
    expect([fy.from, fy.to, fy.partial]).toEqual(['2026-04-01', '2026-10-14', true]);
    const ay = resolvePeriod({ preset: 'academicYear', academicYearStartMonth: 6, now: NOW });
    expect(ay.from).toBe('2026-06-01');
    const past = resolvePeriod({ preset: 'academicYear', academicYearStartMonth: 6, year: 2024, now: NOW });
    expect([past.from, past.to, past.partial]).toEqual(['2024-06-01', '2025-05-31', false]);
    expect(resolvePeriod({ preset: 'quarter', now: NOW }).from).toBe('2026-10-01');
    expect(resolvePeriod({ preset: 'week', now: NOW }).from).toBe('2026-10-12');
  });

  it('compares with the previous equal period, the same elapsed part of last year, and handles 29 February', () => {
    const p = periodFromDates('2026-10-01', '2026-10-14');
    expect(comparisonPeriod(p, { mode: 'previous' })).toMatchObject({ from: '2026-09-17', to: '2026-09-30', days: 14 });
    expect(comparisonPeriod(p, { mode: 'lastYear' })).toMatchObject({ from: '2025-10-01', to: '2025-10-14' });
    const leap = periodFromDates('2028-02-01', '2028-02-29');
    expect(comparisonPeriod(leap, { mode: 'lastYear' })).toMatchObject({ from: '2027-02-01', to: '2027-02-28' });
  });

  it('never divides by a zero baseline', () => {
    expect(change(10, 0)).toMatchObject({ abs: 10, pct: null, comparable: false });
    expect(change(12, 10)).toMatchObject({ pct: 20, comparable: true });
    expect(change(5, null)).toMatchObject({ comparable: false });
  });

  it('splits a period into calendar buckets that cover it exactly', () => {
    const p = periodFromDates('2026-04-01', '2026-10-14');
    const b = buckets(p);
    expect(b[0]).toMatchObject({ from: '2026-04-01', to: '2026-04-30', unit: 'month' });
    expect(b.at(-1)).toMatchObject({ from: '2026-10-01', to: '2026-10-14' });
    expect(b.reduce((n, x) => n + x.days, 0)).toBe(p.days);
    expect(localMidnight(2026, 1, 1, 'UTC').toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
