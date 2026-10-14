import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import type { Club, Membership, PublishedShowcase } from '@/lib/clubs-api';

/**
 * Clubs: a parent sees a consent request with Give/Refuse and a full club
 * offers the waiting list; a teacher in charge sees the decision buttons.
 * Showcase: families read the published showcase with no "Prepare" tab, and
 * the dashboard card shows nothing when nothing is published.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/oakridge/parent/clubs',
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));
const clubs = vi.hoisted(() => ({
  list: vi.fn(), myStudents: vi.fn(), my: vi.fn(), consent: vi.fn(), options: vi.fn(), approvals: vi.fn(), get: vi.fn(), housePoints: vi.fn(), fixtures: vi.fn(), sessions: vi.fn(), decide: vi.fn(),
}));
const showcase = vi.hoisted(() => ({ published: vi.fn(), editions: vi.fn(), options: vi.fn() }));
vi.mock('@/lib/clubs-api', async (orig) => ({ ...(await orig<typeof import('@/lib/clubs-api')>()), clubsApi: clubs, showcaseApi: showcase }));
const auth = vi.hoisted(() => ({ role: 'PARENT' }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ me: { profile: { id: 'p1', role: auth.role } } }) }));
const perms = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ permissions: perms.value, hasAccess: () => true }) }));

const { ClubsView } = await import('@/components/ops/clubs-view');
const { ShowcaseView, ShowcaseCard } = await import('@/components/ops/showcase-view');
const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

const club = (over: Partial<Club> = {}): Club => ({
  id: 'c1', code: 'CRICKET', name: 'Cricket XI', kind: 'TEAM', category: 'SPORTS', activity: 'CRICKET', description: '', coaches: [{ profileId: 't1', name: 'Mr Rao' }], externalCoachName: null,
  capacity: 2, memberCount: 2, seatsLeft: 0, waitlisted: 1, grades: [], homeFacility: { id: 'f1', name: 'Playground', code: 'GRD-1' }, meetingPattern: 'Mon 15:30', joinOpen: true, status: 'ACTIVE', iCoach: false, ...over,
});
const membership = (over: Partial<Membership> = {}): Membership => ({
  id: 'm1', clubId: 'c1', clubName: 'Cricket XI', category: 'SPORTS', activity: 'CRICKET', studentId: 's1', studentName: 'Rahul Sharma', admissionNo: 'OAK-1',
  status: 'AWAITING_CONSENT', role: 'MEMBER', note: null, consent: { required: true, given: false, givenAt: null, refused: false }, requestedByRole: 'STUDENT', requestedAt: '2026-10-10T05:00:00Z',
  decidedAt: null, declineReason: null, waitlistPosition: null, joinedAt: null, leftAt: null, leftReason: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  clubs.list.mockResolvedValue([club()]);
  clubs.myStudents.mockResolvedValue([{ studentId: 's1', name: 'Rahul Sharma', className: 'Class 6 A', gradeId: 'g6', needsConsent: false }]);
  clubs.my.mockResolvedValue([membership()]);
  clubs.consent.mockResolvedValue(membership({ status: 'AWAITING_APPROVAL', consent: { required: true, given: true, givenAt: 'x', refused: false } }));
  clubs.options.mockResolvedValue({ grades: [], venues: [], categories: ['SPORTS'], activities: ['CRICKET'] });
  clubs.approvals.mockResolvedValue([membership({ id: 'm2', status: 'AWAITING_APPROVAL', consent: { required: true, given: true, givenAt: 'x', refused: false } })]);
});

describe('clubs for a family', () => {
  it('offers the waiting list for a full club, and lets a parent give consent to their child\'s request', async () => {
    auth.role = 'PARENT';
    perms.value = { 'clubs.read': 'OWN', 'clubs.join': 'OWN', 'institution.read': 'ALL' };
    inApp(<ClubsView />);
    expect(await screen.findByRole('button', { name: 'Join the waiting list' })).toBeTruthy();
    expect(screen.getByText(/Full · 1 waiting/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'My requests' }));
    expect(await screen.findByText('Waiting for parent consent')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Give consent' }));
    await waitFor(() => expect(clubs.consent).toHaveBeenCalledWith('m1', 'GIVE'));
    // No staff controls for a family.
    expect(screen.queryByRole('tab', { name: /Requests/ })).toBeNull();
  });

  it('gives a student no consent buttons on their own request', async () => {
    auth.role = 'STUDENT';
    perms.value = { 'clubs.read': 'OWN', 'clubs.join': 'OWN' };
    inApp(<ClubsView />);
    fireEvent.click(await screen.findByRole('tab', { name: 'My requests' }));
    expect(await screen.findByText('Waiting for parent consent')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Give consent' })).toBeNull();
  });
});

describe('clubs for a teacher in charge', () => {
  it('lists requests to decide with Approve and Decline', async () => {
    auth.role = 'TEACHER';
    perms.value = { 'clubs.read': 'ALL', 'clubs.manage': 'OWN' };
    clubs.list.mockResolvedValue([club({ iCoach: true, awaitingApproval: 1, awaitingConsent: 0 })]);
    inApp(<ClubsView />);
    fireEvent.click(await screen.findByRole('tab', { name: /Requests/ }));
    expect(await screen.findByText('Rahul Sharma → Cricket XI')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy();
    // A teacher at OWN scope cannot create clubs.
    fireEvent.click(screen.getByRole('tab', { name: /Clubs & teams/ }));
    await screen.findByText('Cricket XI');
    expect(screen.queryByRole('button', { name: 'New club' })).toBeNull();
  });
});

const published: PublishedShowcase = {
  rankCutoff: 3,
  editions: [{ id: 'e1', title: 'Term 1 toppers', periodLabel: 'Term 1, 2026-27', description: '', publishedAt: '2026-10-01T00:00:00Z', entries: [
    { id: 'x1', editionId: 'e1', kind: 'RANK', category: 'ACADEMIC', studentName: 'Priya Verma', title: '1st in Class 6 A', detail: 'Midterm', level: 'CLASS', rank: 1, publishedAt: '2026-10-01T00:00:00Z' },
    { id: 'x2', editionId: 'e1', kind: 'ACHIEVEMENT', category: 'SPORTS', studentName: 'Riya Kapoor', title: '100 m gold', detail: 'Athletics meet', level: 'SCHOOL', rank: null, publishedAt: '2026-10-01T00:00:00Z' },
  ] }],
  highlights: [],
};

describe('showcase', () => {
  it('shows a parent the published showcase only, with no way to prepare or publish', async () => {
    auth.role = 'PARENT';
    // Even a mis-granted key does not give a family the publishing screen.
    perms.value = { 'institution.read': 'ALL', 'showcase.publish': 'ALL' };
    showcase.published.mockResolvedValue(published);
    inApp(<ShowcaseView />);
    expect(await screen.findByText('Priya Verma')).toBeTruthy();
    expect(screen.getByText('1st in Class 6 A')).toBeTruthy();
    expect(screen.getByText(/Only the top 3 are shown/)).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /Prepare/ })).toBeNull();
    expect(showcase.editions).not.toHaveBeenCalled();
  });

  it('gives the principal a Prepare tab', async () => {
    auth.role = 'PRINCIPAL';
    perms.value = { 'institution.read': 'ALL', 'showcase.publish': 'ALL' };
    showcase.published.mockResolvedValue(published);
    inApp(<ShowcaseView />);
    expect(await screen.findByRole('tab', { name: /Prepare and publish/ })).toBeTruthy();
  });

  it('the dashboard card stays out of the way when nothing is published', async () => {
    perms.value = { 'institution.read': 'ALL' };
    showcase.published.mockResolvedValue({ rankCutoff: 3, editions: [], highlights: [] });
    const { container } = inApp(<ShowcaseCard />);
    await waitFor(() => expect(showcase.published).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('.showcase-card')).toBeNull());
  });
});
