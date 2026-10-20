import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * Regressions from the teacher / principal audit:
 *   - the marks grid's Grade column is derived from the marks, AB / ML are
 *     statuses, and an emptied draft cell is sent as a clear (T-EX-1, T-EX-2);
 *   - the attendance summary in flashcard mode shows the deck's counts (T-ATT-7);
 *   - a school lookup that fails for any reason but 404 is not "No school at
 *     this address" (X-1).
 */

const { ApiErrorClass, publicSchool } = vi.hoisted(() => {
  class ApiErrorClass extends Error {
    constructor(public status: number, public code: string, message?: string) { super(message ?? code); }
  }
  return { ApiErrorClass, publicSchool: vi.fn() };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ school: 'oakridge' }),
  usePathname: () => '/oakridge',
}));
vi.mock('@/lib/api', () => ({ api: { publicSchool }, ApiError: ApiErrorClass }));
vi.mock('@/components/sign-in', () => ({ SignIn: () => <div>Sign-in form</div> }));
vi.mock('@/lib/school', () => ({ rememberLastSchool: vi.fn(), setActiveSchool: vi.fn() }));
vi.mock('@/lib/school-theme', () => ({ themeStyle: () => ({}), useFavicon: () => {} }));
vi.mock('@/components/ui', () => ({ Spinner: () => <div>Loading…</div> }));

const { buildEntries, derivedGrade, parseMarkInput, cellValue } = await import('@/app/[school]/teacher/exams/marks');
const { toolbarSummary } = await import('@/app/[school]/teacher/attendance/summary');
const { default: SchoolEntryPage } = await import('@/app/[school]/page');

describe('marks grid', () => {
  it('derives the grade from the marks with the CBSE scale', () => {
    expect(derivedGrade('46', 50)).toBe('A1'); // 92%
    expect(derivedGrade('45', 50)).toBe('A2'); // 90%
    expect(derivedGrade('16', 50)).toBe('E'); // 32%
    expect(derivedGrade('', 50)).toBe('');
    expect(derivedGrade('ab', 50)).toBe('AB');
  });

  it('reads AB and ML as statuses and rejects other text', () => {
    expect(parseMarkInput('ml', 50)).toEqual({ kind: 'absence', code: 'ML' });
    expect(parseMarkInput('xyz', 50).kind).toBe('invalid');
    expect(parseMarkInput('51', 50).kind).toBe('invalid');
    expect(cellValue({ marks: null, absence: 'AB' })).toBe('AB');
  });

  it('sends an emptied draft as a clear, AB as an absence, and skips published and unchanged rows', () => {
    const rows = [
      { enrollmentId: 'a', marks: 30, absence: null, remarks: null, status: 'DRAFT' },
      { enrollmentId: 'b', marks: null, absence: null, remarks: null, status: 'PENDING' },
      { enrollmentId: 'c', marks: 40, absence: null, remarks: null, status: 'PUBLISHED' },
      { enrollmentId: 'd', marks: 20, absence: null, remarks: null, status: 'DRAFT' },
    ];
    const draft = {
      a: { marks: '', remarks: '' },
      b: { marks: 'AB', remarks: '' },
      c: { marks: '', remarks: '' },
      d: { marks: '20', remarks: '' },
    };
    const { entries, invalid } = buildEntries(rows, draft, 50);
    expect(invalid).toEqual([]);
    expect(entries).toEqual([
      { enrollmentId: 'a', marks: null, absence: null, remarks: undefined },
      { enrollmentId: 'b', marks: null, absence: 'AB', remarks: undefined },
    ]);
  });
});

describe('attendance summary', () => {
  const list = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, HALF_DAY: 0 };
  it('shows the deck counts in flashcard mode, not the list marks', () => {
    expect(toolbarSummary('cards', list, { present: 4, absent: 1, late: 0, excused: 0 })).toEqual({ present: 4, absent: 1, late: 0 });
    expect(toolbarSummary('list', { ...list, PRESENT: 2 }, { present: 4, absent: 1, late: 0, excused: 0 })).toEqual({ present: 2, absent: 0, late: 0 });
    expect(toolbarSummary('cards', list, null)).toBeNull();
  });
});

describe('school front door', () => {
  beforeEach(() => publicSchool.mockReset());

  it('says "No school at this address" only for a real 404', async () => {
    publicSchool.mockRejectedValueOnce(new ApiErrorClass(404, 'NOT_FOUND', 'School not found'));
    render(<SchoolEntryPage />);
    expect(await screen.findByText('No school at this address')).toBeTruthy();
    expect(screen.queryByText("Can't reach the school right now")).toBeNull();
  });

  it.each([
    ['a rate limit', new ApiErrorClass(429, 'RATE_LIMITED', 'Too many requests'), /Too many requests/],
    ['a server error', new ApiErrorClass(503, 'ERROR', 'Unavailable'), /server had a problem/],
    ['the network', new TypeError('Failed to fetch'), /internet connection/],
  ])('offers a retry after %s', async (_label, err, message) => {
    publicSchool.mockRejectedValueOnce(err).mockResolvedValueOnce({ slug: 'oakridge', name: 'Oakridge', cssVariables: {} });
    render(<SchoolEntryPage />);
    expect(await screen.findByText("Can't reach the school right now")).toBeTruthy();
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByText('No school at this address')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('Sign-in form')).toBeTruthy());
  });
});
