import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';

/**
 * The newsroom screen: what each person is offered must match what the API
 * lets them do — circle moderators review their circle, comments can be
 * reported, mentoring is only shown to people who can use it, drafts can be
 * saved, and long feeds page.
 */

const nav = vi.hoisted(() => ({ search: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/oakridge/teacher/newsroom',
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => nav.search,
}));

const opsApi = vi.hoisted(() => ({
  feed: vi.fn(), postById: vi.fn(), createPost: vi.fn(), submitPost: vi.fn(), moderatePost: vi.fn(), react: vi.fn(), bookmark: vi.fn(), comment: vi.fn(),
  pendingComments: vi.fn(), moderateComment: vi.fn(), reportContent: vi.fn(), communityReports: vi.fn(), resolveReport: vi.fn(),
  circles: vi.fn(), createCircle: vi.fn(), joinCircle: vi.fn(), circleMember: vi.fn(), consents: vi.fn(), setConsent: vi.fn(),
  mentors: vi.fn(), saveMentorProfile: vi.fn(), verifyMentor: vi.fn(), mentoring: vi.fn(), requestMentoring: vi.fn(), mentoringAction: vi.fn(),
}));
const rest = vi.hoisted(() => ({ patch: vi.fn(), del: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/ops-api', () => ({ opsApi, patch: rest.patch, del: rest.del, post: rest.post }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, request: vi.fn().mockResolvedValue([]), api: { ...actual.api, allSections: vi.fn().mockResolvedValue([]), mySections: vi.fn().mockResolvedValue([]) } };
});
const who = vi.hoisted(() => ({ role: 'TEACHER', permissions: {} as Record<string, string> }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ me: { profile: { id: 'me', role: who.role, displayName: 'Asha Rao' } } }) }));
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ permissions: who.permissions, hasAccess: () => true }) }));

const { NewsroomView, PostCard } = await import('@/components/ops/newsroom-view');
type Post = Parameters<typeof PostCard>[0]['p'];

const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);
const post = (over: Partial<Post> = {}): Post => ({
  id: 'p1', kind: 'STORY', title: 'Robot day', body: 'We built a robot', tags: [], audience: 'INSTITUTION', circleId: null, eventId: null,
  authorName: 'Ravi', authorRole: 'STUDENT', status: 'PUBLISHED', publishedAt: '2026-10-01T10:00:00Z', pinned: false, commentsEnabled: true,
  media: [], mediaWithheld: 0, reactions: {}, myReaction: null, bookmarked: false, isMine: false, ...over,
} as Post);

beforeEach(() => {
  vi.clearAllMocks();
  nav.search = new URLSearchParams();
  who.role = 'TEACHER';
  who.permissions = { 'community.read': 'ALL', 'community.post': 'OWN' };
  opsApi.feed.mockResolvedValue({ items: [], page: 1, pageSize: 20, hasMore: false });
  opsApi.circles.mockResolvedValue([]);
  opsApi.pendingComments.mockResolvedValue([]);
  opsApi.communityReports.mockResolvedValue([]);
  opsApi.consents.mockResolvedValue([]);
});

describe('moderation controls follow what the API allows', () => {
  it('a circle moderator without the school-wide permission can publish or send back a post in their circle', () => {
    inApp(<PostCard p={post({ status: 'PENDING_REVIEW', canModerate: true })} moderator={false} onChanged={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send back' })).toBeInTheDocument();
  });

  it('others see no moderation buttons on a pending post', () => {
    inApp(<PostCard p={post({ status: 'PENDING_REVIEW' })} moderator={false} onChanged={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  });

  it('photos held for a consent report are marked for the moderator', () => {
    inApp(<PostCard p={post({ media: [{ id: 'm1', url: '/uploads/a.jpg', kind: 'IMAGE', caption: null, altText: 'Kids', hidden: true }], canModerate: true })} moderator onChanged={vi.fn()} />);
    expect(screen.getByText(/held for a consent report/i)).toBeInTheDocument();
  });

  it('authors can edit and withdraw their own post but not report it', () => {
    inApp(<PostCard p={post({ isMine: true })} moderator={false} onChanged={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Report/ })).toBeNull();
  });
});

describe('comments', () => {
  it('shows the comment count, and a comment can be reported', async () => {
    opsApi.postById.mockResolvedValue({ ...post(), comments: [{ id: 'c1', authorName: 'Visitor', authorRole: 'ALUMNUS', body: 'Unkind words', status: 'VISIBLE', createdAt: '2026-10-01T10:00:00Z', isMine: false }] });
    opsApi.reportContent.mockResolvedValue({ id: 'r1', status: 'OPEN' });
    inApp(<PostCard p={post({ commentCount: 1, canComment: true })} moderator={false} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /1 comment/ }));
    await screen.findByText('Unkind words');
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(opsApi.reportContent).toHaveBeenCalledWith(expect.objectContaining({ targetType: 'COMMENT', targetId: 'c1' })));
  });

  it('does not offer a comment box when only staff may reply', async () => {
    opsApi.postById.mockResolvedValue({ ...post(), comments: [] });
    inApp(<PostCard p={post({ commentPolicy: 'STAFF_ONLY', canComment: false })} moderator={false} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Comments/ }));
    expect(await screen.findByText('Only staff can reply to this post.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Comment' })).toBeNull();
  });
});

describe('the newsroom screen', () => {
  it('hides the Mentoring tab from people who cannot mentor or supervise', async () => {
    who.role = 'PARENT';
    who.permissions = { 'community.read': 'OWN' };
    inApp(<NewsroomView />);
    await waitFor(() => expect(opsApi.feed).toHaveBeenCalled());
    expect(screen.queryByRole('tab', { name: 'Mentoring' })).toBeNull();
  });

  it('opens the moderation tab from an older "reports" link and counts what is waiting', async () => {
    who.permissions = { 'community.read': 'ALL', 'community.moderate': 'ALL' };
    nav.search = new URLSearchParams('tab=reports');
    opsApi.communityReports.mockResolvedValue([{ id: 'r1', targetType: 'POST', targetId: 'p1', reason: 'SPAM', detail: null, status: 'OPEN', createdAt: '2026-10-01T10:00:00Z', target: { exists: true, title: 'Robot day', excerpt: 'We built', postId: 'p1' } }]);
    inApp(<NewsroomView />);
    expect(await screen.findByText('Reports (1)')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Moderation/ })).toHaveTextContent('1');
    expect(screen.getByText('Robot day')).toBeInTheDocument();
  });

  it('saves a draft without submitting it', async () => {
    opsApi.createPost.mockResolvedValue({ ...post(), status: 'DRAFT' });
    inApp(<NewsroomView />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Share a story' }));
    fireEvent.change(screen.getByLabelText(/Story/), { target: { value: 'Draft text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(opsApi.createPost).toHaveBeenCalledWith(expect.objectContaining({ body: 'Draft text', submit: false, commentPolicy: 'OPEN' })));
  });

  it('loads the next page with "Load more"', async () => {
    opsApi.feed.mockImplementation(async (q: { page?: number }) => (q.page === 2
      ? { items: [post({ id: 'p2', title: 'Second page story' })], page: 2, pageSize: 20, hasMore: false }
      : { items: [post()], page: 1, pageSize: 20, hasMore: true }));
    inApp(<NewsroomView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Second page story')).toBeInTheDocument();
    expect(screen.getByText('Robot day')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('shows a message on the Consent tab when there is nothing to set', async () => {
    who.role = 'ALUMNUS';
    inApp(<NewsroomView initialTab="consent" />);
    expect(await screen.findByText('No consent settings for you')).toBeInTheDocument();
  });
});
