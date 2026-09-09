import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateRangeFilter, Select, matchesSearch, withinDateRange } from '@/components/ui';

/**
 * The filtering primitives behind the student list views.
 *
 * These are unit-tested rather than driven through a page because the two
 * things most likely to be wrong about them — a date range that silently drops
 * its own boundary days, and a search that only matches the column you happen
 * to have typed into — are invisible in a rendered page and obvious here.
 */

describe('withinDateRange', () => {
  /** 10am local on 15 September, whatever timezone the test runs in. */
  const sept15 = new Date(2026, 8, 15, 10, 0, 0).toISOString();
  const sept15Midnight = new Date(2026, 8, 15, 0, 0, 0).toISOString();
  const sept15Late = new Date(2026, 8, 15, 23, 30, 0).toISOString();

  it('keeps everything when no bounds are given', () => {
    expect(withinDateRange(sept15, '', '')).toBe(true);
  });

  it('includes both boundary days', () => {
    expect(withinDateRange(sept15, '2026-09-15', '2026-09-30')).toBe(true);
    expect(withinDateRange(sept15, '2026-09-01', '2026-09-15')).toBe(true);
  });

  it('matches a same-day range', () => {
    // The bug this guards: comparing against `new Date('2026-09-15')` keeps
    // only something due at exactly midnight UTC, so a one-day filter returns
    // nothing at all.
    expect(withinDateRange(sept15, '2026-09-15', '2026-09-15')).toBe(true);
    expect(withinDateRange(sept15Midnight, '2026-09-15', '2026-09-15')).toBe(true);
    expect(withinDateRange(sept15Late, '2026-09-15', '2026-09-15')).toBe(true);
  });

  it('excludes days outside the range', () => {
    expect(withinDateRange(sept15, '2026-09-16', '2026-09-30')).toBe(false);
    expect(withinDateRange(sept15, '2026-09-01', '2026-09-14')).toBe(false);
  });

  it('treats an open-ended range as bounded on one side only', () => {
    expect(withinDateRange(sept15, '2026-09-16', '')).toBe(false);
    expect(withinDateRange(sept15, '', '2026-09-16')).toBe(true);
  });

  it('reads a timestamp as the day it falls on in the reader’s own timezone', () => {
    // 23:30 local on the 15th is the 16th in UTC for anyone east of Greenwich.
    // The student picked "15 September" on their own calendar, so that is the
    // day it must be filed under.
    expect(withinDateRange(sept15Late, '2026-09-15', '2026-09-15')).toBe(true);
  });

  it('excludes a row with no date rather than keeping it by accident', () => {
    expect(withinDateRange(null, '2026-09-01', '2026-09-30')).toBe(false);
    expect(withinDateRange('not-a-date', '2026-09-01', '2026-09-30')).toBe(false);
  });
});

describe('matchesSearch', () => {
  const row = ['Chapter 2 Worksheet', 'Computer Science', 'Neha Singh', 'Completed', 15];

  it('matches everything when the query is blank', () => {
    expect(matchesSearch('', row)).toBe(true);
    expect(matchesSearch('   ', row)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesSearch('COMPUTER', row)).toBe(true);
    expect(matchesSearch('neha', row)).toBe(true);
  });

  it('matches partially, not just whole words', () => {
    expect(matchesSearch('worksh', row)).toBe(true);
  });

  it('searches every column, not one nominated field', () => {
    expect(matchesSearch('Neha', row)).toBe(true);      // teacher
    expect(matchesSearch('Completed', row)).toBe(true); // status
    expect(matchesSearch('Chapter', row)).toBe(true);   // title
    expect(matchesSearch('Science', row)).toBe(true);   // subject
  });

  it('coerces non-string columns so numbers are searchable', () => {
    expect(matchesSearch('15', row)).toBe(true);
  });

  it('ignores null and undefined columns', () => {
    expect(matchesSearch('x', [null, undefined])).toBe(false);
  });

  it('returns false when nothing matches', () => {
    expect(matchesSearch('biology', row)).toBe(false);
  });
});

describe('DateRangeFilter', () => {
  it('labels both bounds so the range reads as FROM / TO', () => {
    render(<DateRangeFilter label="Due date" from="" to="" onChange={() => {}} />);
    expect(screen.getByLabelText('FROM')).toBeInTheDocument();
    expect(screen.getByLabelText('TO')).toBeInTheDocument();
  });

  /**
   * Both bounds go through the shared calendar popup rather than a native
   * `input[type=date]`: the trigger is a read-only text box and the value only
   * ever arrives from a day button, so the range is driven the way a user
   * drives it — open the side, click a day.
   */
  const openSide = (side: 'FROM' | 'TO') => fireEvent.mouseDown(screen.getByLabelText(side));

  it('reports both bounds when either changes', () => {
    const onChange = vi.fn();
    render(<DateRangeFilter label="Due date" from="2026-09-01" to="2026-09-20" onChange={onChange} />);
    openSide('TO');
    fireEvent.click(screen.getByRole('button', { name: '15' }));
    expect(onChange).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-15' });
  });

  it('stops FROM being pushed past TO', () => {
    render(<DateRangeFilter label="Due date" from="2026-09-10" to="2026-09-20" onChange={() => {}} />);
    openSide('FROM');
    expect(screen.getByRole('button', { name: '25' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '15' })).toBeEnabled();
  });

  it('stops TO being pulled before FROM', () => {
    render(<DateRangeFilter label="Due date" from="2026-09-10" to="2026-09-20" onChange={() => {}} />);
    openSide('TO');
    // The grid runs Aug 30 - Oct 10, so a single-digit day appears twice; the
    // first in document order is September's.
    expect(screen.getAllByRole('button', { name: '5' })[0]).toBeDisabled();
    expect(screen.getByRole('button', { name: '15' })).toBeEnabled();
  });
});

describe('Select', () => {
  const options = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }];

  it('names the control for assistive technology even with the label hidden', () => {
    render(<Select label="Status" value="" onChange={() => {}} options={options} hideLabel />);
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
  });

  it('carries the class that keeps it inside its container on a phone', () => {
    render(<Select label="Status" value="" onChange={() => {}} options={options} />);
    expect(screen.getByRole('combobox')).toHaveClass('select-field');
  });

  it('offers the placeholder as the empty choice, not as a value', () => {
    render(<Select label="Status" value="" onChange={() => {}} options={options} placeholder="All statuses" />);
    expect(screen.getByRole('option', { name: 'All statuses' })).toHaveValue('');
  });
});
