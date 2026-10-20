import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';

/**
 * Part 4 support-role screens: the library desk, hostel life, admissions
 * follow-ups and data protection. Each renders what the API returns, shows
 * the reasons behind a score, and calls the endpoint its action names.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/oakridge/librarian/library-desk',
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));
const http = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), request: http.request, api: { students: vi.fn().mockResolvedValue({ items: [] }), allSections: vi.fn().mockResolvedValue([]) } }));
vi.mock('@/lib/ops-api', async (orig) => ({ ...(await orig<typeof import('@/lib/ops-api')>()), post: (p: string, b: unknown) => http.request(p, { method: 'POST', body: JSON.stringify(b) }), patch: (p: string, b: unknown) => http.request(p, { method: 'PATCH', body: JSON.stringify(b) }), put: (p: string, b: unknown) => http.request(p, { method: 'PUT', body: JSON.stringify(b) }) }));

const { LibraryDeskView, HostelLifeView, FollowupsView, DataProtectionView } = await import('@/components/ops/p4-support-views');
const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);
const route = (map: Record<string, unknown>) => http.request.mockImplementation(async (path: string) => {
  const key = Object.keys(map).find((k) => path.startsWith(k));
  if (!key) throw new Error(`unexpected ${path}`);
  return map[key];
});

beforeEach(() => { vi.clearAllMocks(); });

describe('library desk', () => {
  it('shows the briefing counts and lines', async () => {
    route({ '/library/desk/briefing': { lines: ['3 loan(s) overdue.', '1 reservation(s) waiting on the hold shelf.'], evidence: { overdue: 3, holdsReady: 1, holdsQueued: 2, finesDueRupees: 40, loans30d: 120, idleTitles: 5 } } });
    inApp(<LibraryDeskView />);
    expect(await screen.findByText('3 loan(s) overdue.')).toBeInTheDocument();
    expect(screen.getByText('₹40')).toBeInTheDocument();
  });

  it('reminds overdue borrowers through the desk endpoint', async () => {
    route({
      '/library/desk/briefing': { lines: [], evidence: { overdue: 1, holdsReady: 0, holdsQueued: 0, finesDueRupees: 0, loans30d: 0, idleTitles: 0 } },
      '/library/desk/overdue/remind': { reminded: 1, alreadyToday: 0 },
      '/library/desk/overdue': [{ id: 'l1', bookTitle: 'Wings of Fire', studentName: 'Rahul Sharma', admissionNo: 'OAK-1', className: 'Class 6 A', dueAt: '2026-10-10T18:29:59Z', daysLate: 6, fineSoFarRupees: 30, remindedOn: null }],
    });
    inApp(<LibraryDeskView />);
    fireEvent.click(await screen.findByRole('tab', { name: /Overdue/ }));
    expect(await screen.findByText('Wings of Fire')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Remind borrowers'));
    await vi.waitFor(() => expect(http.request).toHaveBeenCalledWith('/library/desk/overdue/remind', expect.objectContaining({ method: 'POST' })));
  });
});

describe('hostel life', () => {
  it('shows tonight in numbers', async () => {
    route({ '/hostel/life/briefing': { lines: ['42 resident(s); 3 away on an out-pass tonight; 39 dinner(s) to cook.'], tonightTaken: false, evidence: { residents: 42, away: 3, meals: 39, lateReturns: 1, outpassesPending: 2, openIncidents: 1 } } });
    inApp(<HostelLifeView />);
    expect(await screen.findByText(/39 dinner\(s\) to cook/)).toBeInTheDocument();
    expect(screen.getByText('Open roll call')).toBeInTheDocument();
  });
});

describe('admissions follow-ups', () => {
  it('lists enquiries with their warmth and explains a score', async () => {
    const row = { id: 'e1', childName: 'Kabir Mehta', guardianName: 'Mr Mehta', phone: '+91', gradeApplying: 'Class 1', source: 'WEB', stage: 'CONTACTED', nextActionAt: '2026-10-14T05:00:00Z', createdAt: '2026-10-01T05:00:00Z', assignee: null, doNotContact: false, score: 72, band: 'HOT', reasons: ['+10 stage contacted', '+16 2 visit/counselling session(s) done'], lastTouchAt: null, nextAppointmentAt: null };
    route({ '/admissions/followups': { counts: { overdue: 1, today: 0, untouched: 0, noNextAction: 0 }, overdue: [row], today: [], untouched: [], noNextAction: [], rules: { firstResponseHours: 24, scoring: 'Each point has a reason.' } } });
    inApp(<FollowupsView />);
    expect(await screen.findByText('Kabir Mehta')).toBeInTheDocument();
    fireEvent.click(screen.getByText('72 Hot'));
    expect(await screen.findByText('+16 2 visit/counselling session(s) done')).toBeInTheDocument();
    expect(screen.getByText(/does not move, drop or prioritise/)).toBeInTheDocument();
  });
});

describe('data protection', () => {
  it('shows the readiness checklist with what was found', async () => {
    route({
      '/compliance/privacy/overview': { openRequests: 2, overdueRequests: 1, openBreaches: 0, breachesPastClock: 0, committees: 3, committeesReviewOverdue: 1 },
      '/compliance/privacy/readiness': { checkedAt: '2026-10-17T05:00:00Z', tally: { OK: 1, MISSING: 1 }, note: 'OK means a record exists and is in date; the compliance officer decides whether the school is compliant.', items: [
        { area: 'Certificates', item: 'Fire safety certificate', state: 'OK', evidence: 'Fire NOC, expires 2027-03-31', where: '/compliance/compliance?tab=licences' },
        { area: 'Committees', item: 'School Management Committee', state: 'MISSING', evidence: 'Not recorded (RTE Act 2009, s.21)', where: '/compliance/data-protection?tab=committees' },
      ] },
    });
    inApp(<DataProtectionView />);
    expect(await screen.findByText('Fire safety certificate')).toBeInTheDocument();
    expect(screen.getByText('Not recorded (RTE Act 2009, s.21)')).toBeInTheDocument();
    expect(screen.getByText(/the compliance officer decides/)).toBeInTheDocument();
  });
});

describe('a parent asks for a book for their child', () => {
  it('sends the selected child with the request', async () => {
    const { AskBookButton } = await import('@/components/family-requests');
    http.request.mockResolvedValue({ id: 'r1', status: 'PENDING' });
    inApp(<AskBookButton studentId="kid-2" bookId="b9" firstName="Riya" />);
    fireEvent.click(screen.getByText('Ask for it'));
    await vi.waitFor(() => expect(http.request).toHaveBeenCalledWith('/library/requests', expect.objectContaining({ method: 'POST', body: JSON.stringify({ bookId: 'b9', studentId: 'kid-2' }) })));
    expect(await screen.findByText('Requested')).toBeInTheDocument();
  });
});
