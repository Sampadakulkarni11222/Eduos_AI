import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';

/**
 * PTM booking for a family with two children, and a family's published report
 * cards: the screens show each child, a booking is one explicit confirmation,
 * and a family sees only what the API returns for them.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/oakridge/parent/ptm',
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));
const perms = vi.hoisted(() => ({ current: {} as Record<string, string> }));
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ permissions: perms.current, hasAccess: () => true }) }));
vi.mock('@/lib/ops-api', () => ({ opsApi: {}, qs: () => '', post: vi.fn(), put: vi.fn(), patch: vi.fn(), downloadCsv: vi.fn() }));

const round = { id: 'r1', refNo: 'PTM/2026/0001', title: 'Term 1 PTM', description: null, startsOn: '2026-10-21', endsOn: '2026-10-21', mode: 'IN_PERSON', sectionIds: [], slotMinutes: 10, bufferMinutes: 2, bookingOpensAt: '2026-10-01T00:00:00Z', bookingClosesAt: '2099-01-01T00:00:00Z', changeCutoffHours: 12, defaultVenue: null, status: 'OPEN', bookingOpen: true };
const slot = (id: string, time: string, teacher: string) => ({ id, roundId: 'r1', teacherProfileId: teacher, teacherName: teacher, startsAt: '2026-10-21T04:30:00Z', endsAt: '2026-10-21T04:40:00Z', date: '2026-10-21', time, when: 'Wed 21 Oct, 10:00 am', mode: 'IN_PERSON', venue: 'Room 6A', status: 'OPEN', heldUntil: null });
const teacher = (id: string, name: string, slots: ReturnType<typeof slot>[]) => ({ profileId: id, name, roles: ['CLASS_TEACHER'], subjects: ['English'], slots, hasSlots: true, full: false, booking: null, waitlist: null });

const ptmApi = vi.hoisted(() => ({
  rounds: vi.fn(), options: vi.fn(), bookings: vi.fn(), book: vi.fn(), metrics: vi.fn(),
}));
const reportCardsApi = vi.hoisted(() => ({ published: vi.fn(), version: vi.fn() }));
vi.mock('@/lib/ptm-api', () => ({ ptmApi, reviewApi: {}, conversationsApi: {}, REVIEW_REASONS: [], CALL_CHANNELS: [] }));
vi.mock('@/lib/reportcards-api', () => ({ reportCardsApi, openReportCardPdf: vi.fn() }));

const { PtmView } = await import('@/components/ops/ptm-view');
const { TermReportCardsView } = await import('@/components/ops/term-report-cards-view');
const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => { vi.clearAllMocks(); });

describe('PTM for a family with two children', () => {
  it('lists each child with their teachers and books one slot with one confirmation', async () => {
    perms.current = { 'ptm.read': 'OWN', 'ptm.book': 'OWN' };
    ptmApi.rounds.mockResolvedValue([round]);
    ptmApi.bookings.mockResolvedValue([]);
    ptmApi.options.mockResolvedValue({ round, children: [
      { studentId: 's1', name: 'Rahul Sharma', className: 'Class 6 A', sectionId: 'a', teachers: [teacher('t1', 'Ms Rao', [slot('x1', '10:00–10:10', 't1')])] },
      { studentId: 's2', name: 'Riya Kapoor', className: 'Class 6 B', sectionId: 'b', teachers: [teacher('t3', 'Mr Iyer', [slot('x2', '10:12–10:22', 't3')])] },
    ] });
    ptmApi.book.mockResolvedValue({});
    inApp(<PtmView />);
    expect(await screen.findByText('Rahul Sharma')).toBeTruthy();
    expect(screen.getByText('Riya Kapoor')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /10:12–10:22/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm booking' }));
    await waitFor(() => expect(ptmApi.book).toHaveBeenCalledTimes(1));
    expect(ptmApi.book.mock.calls[0][0]).toMatchObject({ slotId: 'x2', studentId: 's2' });
  });
});

describe('report cards for a family', () => {
  it('shows the published card with its correction note and earlier versions', async () => {
    perms.current = { 'reportcards.read': 'OWN' };
    reportCardsApi.published.mockResolvedValue([{
      versionId: 'v2', cardId: 'c1', version: 2, publishedAt: '2026-10-10T00:00:00Z', correctionNote: 'Mathematics half-yearly added',
      card: { id: 'c1', termName: 'Term 1', termKey: 'TERM_1', studentName: 'Rahul Sharma', className: 'Class 6 A', components: [{ key: 'HY', label: 'Half-yearly exam', maxMarks: 80, source: 'EXAM' }],
        scholastic: [{ subjectOfferingId: 'o1', subject: 'English', components: { HY: { value: 60, status: 'OK', maxMarks: 80 } }, total: 60, maxMarks: 80, percentage: 75, grade: 'B1', complete: true, passed: true }],
        summary: { total: 60, maxMarks: 80, percentage: 75, grade: 'B1', complete: true, pendingSubjects: [], belowPass: [] }, coScholasticAreas: [{ key: 'ART', label: 'Art education' }], coScholastic: { ART: 'A' },
        disciplineLabel: 'Discipline', discipline: 'A', classTeacherRemarks: 'A curious reader.', attendance: { workingDays: 100, present: 95, percentage: 95 }, resultLine: 'Term result.' },
      olderVersions: [{ versionId: 'v1', version: 1, publishedAt: '2026-10-01T00:00:00Z', supersededAt: '2026-10-10T00:00:00Z' }],
    }]);
    inApp(<TermReportCardsView />);
    expect(await screen.findByText(/Rahul Sharma · Term 1/)).toBeTruthy();
    expect(screen.getByText(/Mathematics half-yearly added/)).toBeTruthy();
    expect(screen.getByText('A curious reader.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /version 1/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeTruthy();
  });
});
