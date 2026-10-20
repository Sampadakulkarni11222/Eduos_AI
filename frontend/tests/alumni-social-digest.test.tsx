import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import type { DirectoryEntry, SocialPostDto } from '@/lib/alumni-social-api';

/**
 * Alumni: the directory shows name and batch and nothing a person kept
 * private; an alumnus sees a community-only notice. Social publishing: a
 * simulated send reads "Simulated — not posted", and only a failed network
 * offers a retry. Digest: feed text renders as text, never markup, and the
 * page never calls itself an alerts integration. Profile links: a guardian
 * gets the consent switch for their child.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/oakridge/alumnus/alumni',
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));
const auth = vi.hoisted(() => ({ role: 'ALUMNUS' }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ me: { profile: { id: 'p1', role: auth.role } } }) }));
const perms = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ permissions: perms.value, hasAccess: () => true }) }));
const alumni = vi.hoisted(() => ({
  me: vi.fn(), updateMe: vi.fn(), myRecord: vi.fn(), directory: vi.fn(), batches: vi.fn(), circles: vi.fn(), posts: vi.fn(), createPost: vi.fn(), moderatePost: vi.fn(),
  events: vi.fn(), createEvent: vi.fn(), cancelEvent: vi.fn(), rsvp: vi.fn(), records: vi.fn(), updateRecord: vi.fn(), transition: vi.fn(), myStudentLinks: vi.fn(), studentLinks: vi.fn(), setStudentLinks: vi.fn(),
}));
const social = vi.hoisted(() => ({ accounts: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), stories: vi.fn(), posts: vi.fn(), compose: vi.fn(), publish: vi.fn() }));
const digest = vi.hoisted(() => ({ today: vi.fn(), interests: vi.fn(), setPreferences: vi.fn(), sources: vi.fn(), addSource: vi.fn(), updateSource: vi.fn(), checkSource: vi.fn(), run: vi.fn() }));
vi.mock('@/lib/alumni-social-api', async (orig) => ({ ...(await orig<typeof import('@/lib/alumni-social-api')>()), alumniApi: alumni, socialApi: social, digestApi: digest }));

const { AlumniView, SocialPublishingView, DigestView, ProfileLinksView } = await import('@/components/ops/alumni-social-views');
const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

const entry = (over: Partial<DirectoryEntry> = {}): DirectoryEntry => ({ id: 'a1', name: 'Sample Ananya Iyer', kind: 'FORMER_STUDENT', batchLabel: 'Class of 2018 · Class 12 B', batchYear: 2018, section: 'Class 12 B', house: null, servedFrom: null, servedTo: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'ALUMNUS';
  perms.value = { 'alumni.directory.read': 'ALL', 'digest.read': 'ALL' };
  alumni.me.mockResolvedValue({ ...entry({ id: 'me', name: 'Demo Alumnus' }), profileId: 'p1', leftReason: 'GRADUATED', listed: true, verified: true, status: 'ACTIVE', profession: '', city: '', links: {}, consent: { profession: false, city: false, links: false }, transitionedAt: '2026-04-01' });
  alumni.circles.mockResolvedValue([{ id: 'c1', name: 'Class of 2018', description: null, members: 3 }]);
  alumni.posts.mockResolvedValue([]);
  alumni.directory.mockResolvedValue({ items: [entry(), entry({ id: 'a2', name: 'Sample Kabir Rao', city: 'Bengaluru', links: { linkedin: 'https://www.linkedin.com/in/kabir-sample', website: 'javascript:alert(1)' } }), entry({ id: 's1', name: 'Sample Mr. D. Kulkarni', kind: 'FORMER_STAFF', batchLabel: 'Staff 2009–2021', batchYear: null, servedFrom: 2009, servedTo: 2021 })], note: '' });
});

describe('alumni', () => {
  it('lists name and batch, only the details people shared, and only https links', async () => {
    inApp(<AlumniView />);
    expect(await screen.findByText(/Alumni see the community, directory and reunions — not student records, marks or fees/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Directory' }));
    expect(await screen.findByText('Sample Ananya Iyer')).toBeTruthy();
    expect(screen.getByText('Class of 2018 · Class 12 B')).toBeTruthy();
    expect(screen.getByText('Staff 2009–2021')).toBeTruthy();
    expect(screen.getByText(/Bengaluru/)).toBeTruthy();
    const link = screen.getByRole('link', { name: 'LinkedIn' });
    expect(link.getAttribute('href')).toBe('https://www.linkedin.com/in/kabir-sample');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.queryByRole('link', { name: 'Personal site' })).toBeNull();
    // Manage tabs are not offered to an alumnus.
    expect(screen.queryByRole('tab', { name: 'Manage alumni' })).toBeNull();
  });

  it('offers HR the manage tab without alumni self-service', async () => {
    auth.role = 'HR';
    perms.value = { 'alumni.manage': 'ALL' };
    alumni.records.mockResolvedValue([]);
    inApp(<AlumniView />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Manage alumni' }));
    expect(await screen.findByRole('button', { name: '+ Move to alumni' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'My profile' })).toBeNull();
    expect(alumni.me).not.toHaveBeenCalled();
  });
});

const outboxPost = (over: Partial<SocialPostDto> = {}): SocialPostDto => ({
  id: 'sp1', text: 'Open day on Saturday (sample)', link: null, networks: ['FACEBOOK', 'X'], studentIds: [], noIdentifiableStudents: true, status: 'DONE', blockedReason: null, createdByName: 'Marketing lead', createdAt: '2026-10-14T05:00:00Z', communityPostId: null,
  outbox: [
    { network: 'FACEBOOK', label: 'Facebook', status: 'SIMULATED', statusReason: 'Simulated — not posted: no Facebook provider credentials are configured.', attempts: 1, lastAttemptAt: null, display: 'Simulated — not posted' },
    { network: 'X', label: 'X', status: 'SIMULATED', statusReason: null, attempts: 1, lastAttemptAt: null, display: 'Simulated — not posted' },
  ],
  ...over,
});

describe('social publishing', () => {
  beforeEach(() => {
    perms.value = { 'social.publish': 'ALL' };
    social.stories.mockResolvedValue([]);
    social.accounts.mockResolvedValue({ accounts: [], networks: [] });
  });

  it('says simulated, not posted, and offers no publish for a finished post', async () => {
    social.posts.mockResolvedValue([outboxPost()]);
    inApp(<SocialPublishingView />);
    const outbox = await screen.findByRole('list', { name: 'Outbox' });
    expect(within(outbox).getAllByText('Simulated — not posted')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Publish|Retry/ })).toBeNull();
    expect(screen.getByText(/Parents and students cannot publish here/)).toBeTruthy();
  });

  it('offers a retry only when a network failed', async () => {
    const failed = outboxPost({ status: 'PUBLISHING', outbox: [outboxPost().outbox[0], { network: 'X', label: 'X', status: 'FAILED', statusReason: 'HTTP 503', attempts: 1, lastAttemptAt: null, display: 'Failed — can be retried' }] });
    social.posts.mockResolvedValue([failed]);
    social.publish.mockResolvedValue(outboxPost());
    inApp(<SocialPublishingView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry failed' }));
    await waitFor(() => expect(social.publish).toHaveBeenCalledWith('sp1'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry failed' })).toBeNull());
  });

  it('needs a network and a no-identifiable-child statement before saving', async () => {
    social.posts.mockResolvedValue([]);
    social.compose.mockResolvedValue(outboxPost());
    inApp(<SocialPublishingView />);
    const save = await screen.findByRole('button', { name: 'Save to outbox' });
    fireEvent.change(screen.getByRole('textbox', { name: /Text/ }), { target: { value: 'Open day' } });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'LinkedIn' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /No child can be identified/ }));
    fireEvent.click(save);
    await waitFor(() => expect(social.compose).toHaveBeenCalledWith(expect.objectContaining({ networks: ['LINKEDIN'], noIdentifiableStudents: true, text: 'Open day' })));
  });
});

describe('digest', () => {
  it('renders feed text as text and never calls itself an alerts integration', async () => {
    digest.interests.mockResolvedValue({ interests: [{ key: 'SCIENCE', label: 'Science' }], mine: { interests: ['SCIENCE'], emailOptIn: false } });
    digest.today.mockResolvedValue({ day: '2026-10-15', interests: ['SCIENCE'], note: 'Headlines from feeds the school approved.', items: [
      { id: 'i1', title: '<img src=x onerror=alert(1)>Comet tonight', link: 'https://science.example.org/comet', summary: '<script>steal()</script>Look east', sourceTitle: 'Sample Science Weekly', publishedAt: null, interest: 'SCIENCE', interestLabel: 'Science' },
      { id: 'i2', title: 'Bad link', link: 'javascript:alert(1)', summary: '', sourceTitle: null, publishedAt: null, interest: 'SCIENCE', interestLabel: 'Science' },
    ] });
    const { container } = inApp(<DigestView />);
    const link = await screen.findByRole('link', { name: '<img src=x onerror=alert(1)>Comet tonight' });
    expect(link.getAttribute('href')).toBe('https://science.example.org/comet');
    expect(container.querySelector('img, script')).toBeNull();
    expect(screen.getByText('<script>steal()</script>Look east')).toBeTruthy();
    expect(screen.getByText('Bad link').closest('a')).toBeNull();
    expect(container.textContent).not.toMatch(/google alerts/i);
    expect(screen.queryByRole('tab', { name: 'Sources' })).toBeNull();
  });

  it('shows sources to digest managers', async () => {
    perms.value = { 'digest.read': 'ALL', 'digest.manage': 'ALL' };
    digest.interests.mockResolvedValue({ interests: [{ key: 'SCIENCE', label: 'Science' }], mine: { interests: [], emailOptIn: false } });
    digest.today.mockResolvedValue({ day: '2026-10-15', interests: [], items: [], note: '' });
    digest.sources.mockResolvedValue([{ id: 's1', title: 'Sample Science Weekly', url: 'https://feeds.example.org/science.xml', interests: ['SCIENCE'], interestLabels: ['Science'], status: 'APPROVED', approvedByName: 'Admin', lastFetchedAt: '2026-10-15T00:30:00Z', lastStatus: 'FAILED', lastError: 'feeds.example.org points inside a private network', lastItemCount: 0 }]);
    const { container } = inApp(<DigestView />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Sources' }));
    expect(await screen.findByText('Could not read')).toBeTruthy();
    expect(screen.getByText(/points inside a private network/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/google alerts/i);
  });
});

describe('profile links', () => {
  it('gives a guardian the consent switch for their minor child', async () => {
    auth.role = 'PARENT';
    alumni.myStudentLinks.mockResolvedValue([{ studentId: 'st1', name: 'Priya Verma', relation: 'GUARDIAN', minor: true, links: { github: 'https://github.com/priya-sample', linkedin: null, instagram: null, website: null }, studentConsent: true, guardianConsent: false, shared: false, rule: 'Other students and parents see these links only when the student and a guardian both agree.' }]);
    alumni.setStudentLinks.mockResolvedValue({ studentId: 'st1', name: 'Priya Verma', relation: 'GUARDIAN', minor: true, links: { github: 'https://github.com/priya-sample' }, studentConsent: true, guardianConsent: true, shared: true });
    inApp(<ProfileLinksView />);
    expect(await screen.findByText('Private: you, guardians and staff')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree these links may be shown/ }));
    await waitFor(() => expect(alumni.setStudentLinks).toHaveBeenCalledWith('st1', { guardianConsent: true }));
    expect(await screen.findByText('Visible to other students and parents')).toBeTruthy();
  });
});
