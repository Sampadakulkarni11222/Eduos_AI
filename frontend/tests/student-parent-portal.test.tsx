import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import {
  formatTime12, formatDate, formatDayMonth, humanizeLabel, greetingName,
} from '@/app/[school]/student/_lib/format';

/**
 * Student and parent portal fixes from the audit:
 *  - one time format (12-hour) and one date format (DD Mon YYYY);
 *  - raw enum labels ("CUSTOM", "REPORT_CARD") read as words;
 *  - "Good afternoon, Parent!" for an account named "Parent of Diya";
 *  - the parent Library page said "No books matched" when the API refused;
 *  - the parent Student View went blank when the growth score was refused;
 *  - the student's library shelves asked staff-only endpoints for filters.
 */

const api = vi.hoisted(() => ({
  students: vi.fn(),
  listBooks: vi.fn(),
  listIssued: vi.fn(),
  growthScore: vi.fn(),
  bookFacets: vi.fn(),
  listGrades: vi.fn(),
  listSubjects: vi.fn(),
  academicYears: vi.fn(),
  deleteBook: vi.fn(),
}));

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public code: string, message?: string) { super(message); }
  }
  return {
    api,
    ApiError,
    request: vi.fn(),
    fileHref: (u: string) => u,
    errorMessage: (err: unknown, fallback: string) => (err instanceof Error && err.message) || fallback,
  };
});

vi.mock('@/components/shell', () => ({
  PortalShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const { ApiError } = await import('@/lib/api') as unknown as { ApiError: new (s: number, c: string, m?: string) => Error };
const { default: ParentLibrary } = await import('@/app/[school]/parent/library/page');
const { default: StudentView } = await import('@/app/[school]/parent/student-view/page');
const { LibraryResourceShelf, facetOptions } = await import('@/components/library/resource-shelf');

const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);
const kid = { id: 's1', name: 'Diya Sharma', enrollment: { id: 'e1', class: 'Class 5 A', sectionId: 'sec1', rollNo: 1 } };

beforeEach(() => {
  vi.clearAllMocks();
  api.students.mockResolvedValue({ items: [kid] });
  api.bookFacets.mockResolvedValue({ examTypes: [] });
});

describe('display formats', () => {
  it('shows times on a 12-hour clock', () => {
    expect(formatTime12('13:15')).toBe('1:15 PM');
    expect(formatTime12('09:05')).toBe('9:05 AM');
    expect(formatTime12('00:30')).toBe('12:30 AM');
    expect(formatTime12('12:00')).toBe('12:00 PM');
    expect(formatTime12(null)).toBe('—');
  });

  it('shows dates as DD Mon YYYY, with September as "Sep"', () => {
    expect(formatDate(new Date(2026, 8, 30))).toBe('30 Sep 2026');
    expect(formatDate(new Date(2026, 10, 5))).toBe('05 Nov 2026');
    expect(formatDayMonth(new Date(2026, 10, 5))).toBe('05 Nov');
    expect(formatDate('not a date')).toBe('—');
  });

  it('reads enum labels as words', () => {
    expect(humanizeLabel('CUSTOM')).toBe('Custom');
    expect(humanizeLabel('REPORT_CARD')).toBe('Report card');
    expect(humanizeLabel('HALF_DAY')).toBe('Half day');
    expect(humanizeLabel('TC')).toBe('TC');
  });

  it('greets by a real first name, and by no name for a placeholder', () => {
    expect(greetingName('Parent of Diya')).toBeNull();
    expect(greetingName('Diya Sharma (Class 5–A #1)')).toBe('Diya');
    expect(greetingName('Kavita Reddy')).toBe('Kavita');
    expect(greetingName(undefined)).toBeNull();
  });
});

describe('parent Library page', () => {
  it('shows an error, not "No books matched", when the catalogue is refused', async () => {
    api.listBooks.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Missing permission: library.read'));
    api.listIssued.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Missing permission: library.read'));
    inApp(<ParentLibrary />);
    expect(await screen.findByText("Couldn't load the catalog")).toBeTruthy();
    expect(await screen.findByText("Couldn't load Diya's books")).toBeTruthy();
    expect(screen.queryByText('No books matched')).toBeNull();
    expect(screen.queryByText('No active checkouts')).toBeNull();
  });

  it('shows the books and loans when the API answers', async () => {
    api.listBooks.mockResolvedValue([{ id: 'b1', title: 'Wings of Fire', author: 'Kalam', availableCopies: 2 }]);
    api.listIssued.mockResolvedValue([{ id: 'i1', bookTitle: 'Wonderland', dueAt: '2026-10-20T00:00:00Z', finePaise: 0, status: 'OVERDUE' }]);
    inApp(<ParentLibrary />);
    expect(await screen.findByText('Wings of Fire')).toBeTruthy();
    expect(await screen.findByText('Wonderland')).toBeTruthy();
    expect(screen.getByText('Overdue')).toBeTruthy();
  });
});

describe('parent Student View', () => {
  it('explains itself when the growth score is refused, instead of rendering nothing', async () => {
    api.growthScore.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Missing permission: ai.insights.read'));
    inApp(<StudentView />);
    expect(await screen.findByText("The growth view isn't available for Diya yet")).toBeTruthy();
    expect(screen.getByText(/has not turned on the growth score for parents/)).toBeTruthy();
  });
});

describe('library shelves for students', () => {
  it('builds the filter options from the shelf, without calling the staff-only academics endpoints', async () => {
    api.listBooks.mockResolvedValue([
      { id: 'n1', title: 'Fractions', gradeId: 'g5', grade: 'Class 5', subjectId: 'm', subject: 'Mathematics', academicYearId: 'y1', academicYear: '2026-27' },
      { id: 'n2', title: 'Plants', gradeId: 'g5', grade: 'Class 5', subjectId: 'sc', subject: 'Science', academicYearId: 'y1', academicYear: '2026-27' },
    ]);
    inApp(<LibraryResourceShelf kind="NOTE" title="Notes" canManage={false} />);
    await waitFor(() => expect(screen.getAllByText('Fractions').length).toBeGreaterThan(0));
    expect(api.listGrades).not.toHaveBeenCalled();
    expect(api.listSubjects).not.toHaveBeenCalled();
    expect(api.academicYears).not.toHaveBeenCalled();
    expect(api.listBooks).toHaveBeenCalledWith({ resourceKind: 'NOTE' });
  });

  it('facetOptions lists each class/subject/year once, by name', () => {
    const rows = [
      { subjectId: 'sc', subject: 'Science' }, { subjectId: 'm', subject: 'Mathematics' }, { subjectId: 'sc', subject: 'Science' }, { subjectId: null, subject: null },
    ] as unknown as Parameters<typeof facetOptions>[0];
    expect(facetOptions(rows, 'subjectId', 'subject')).toEqual([
      { value: 'm', label: 'Mathematics' }, { value: 'sc', label: 'Science' },
    ]);
  });
});
