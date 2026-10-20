import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import type { Edition, Opportunity } from '@/lib/newsletter-api';

/**
 * The newsletter screens: flashcards flip and send "I knew it" / "Review
 * again" (the second comes back in the same session); an edition shows the
 * hook, says "check dates" for unconfirmed dates, renders comments as text,
 * and sends quiz answers once; a student sees no email switch; the editor's
 * desk is refused without the editor permission.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/oakridge/student/opportunities',
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));
const auth = vi.hoisted(() => ({ role: 'STUDENT' }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ me: { profile: { id: 'p1', role: auth.role } } }) }));
const perms = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ permissions: perms.value, hasAccess: () => true }) }));
const api = vi.hoisted(() => ({
  home: vi.fn(), preferences: vi.fn(), setPreferences: vi.fn(), opportunities: vi.fn(), map: vi.fn(), matches: vi.fn(), editions: vi.fn(), edition: vi.fn(),
  progress: vi.fn(), quiz: vi.fn(), vote: vi.fn(), react: vi.fn(), comment: vi.fn(), reviewCard: vi.fn(), flashcards: vi.fn(), saved: vi.fn(), questions: vi.fn(),
}));
vi.mock('@/lib/newsletter-api', async (orig) => ({ ...(await orig<typeof import('@/lib/newsletter-api')>()), newsletterApi: api }));

const { FlashcardDeck, NewsletterView, NewsletterDeskView } = await import('@/components/ops/newsletter-views');
const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

const opp: Opportunity = {
  id: 'o1', title: 'Junior Science Olympiad', summary: 'An olympiad.', type: 'OLYMPIAD', typeLabel: 'Olympiad', level: 'NATIONAL', levelLabel: 'National', audience: 'STUDENTS',
  domains: ['SCIENCE'], domainLabels: ['Science'], eligibility: { gradeMin: 6, gradeMax: 8 }, registrationOpens: null, registrationCloses: null, eventDate: null,
  datesConfirmed: false, datesCheckedByName: null, typicalWindow: 'Usually in August.', typicalMonths: [8], dateText: 'Usually in August. Check dates and rules on the official site.',
  daysLeft: null, closingSoon: false, fee: null, mode: 'OFFLINE', officialUrl: 'https://olympiads.hbcse.tifr.res.in/', organiser: 'HBCSE', region: null, howToApply: [], pastWinnerNotes: null, facts: [],
  status: 'PUBLISHED', publishedAt: null, source: { kind: 'CATALOGUE', sourceTitle: null },
};
const edition: Edition = {
  id: 'e1', cadence: 'WEEKLY', periodLabel: '12 Oct to 18 Oct 2026', title: "This week's opportunities", status: 'PUBLISHED', intro: null, publishedAt: null,
  hook: { text: 'Zero was described by Brahmagupta.', question: 'Which puzzle will you crack?', textHi: null },
  items: [opp], forYou: [], deadlines: [],
  flashcards: [{ key: 'e1:o-1', front: 'Front?', back: 'Back.', domain: 'SCIENCE', box: null }],
  quiz: { questions: [{ key: 'q1', question: 'What kind?', options: ['Olympiad', 'Hackathon', 'Fair'] }], answered: false, score: null, onBoard: false, canJoinBoard: true, boardOptIn: false },
  poll: null, spotlight: [], reactions: {},
  comments: [{ id: 'c1', opportunityId: null, displayName: 'A student in Class 6', text: '<b>not bold</b>', status: 'APPROVED', mine: false, at: new Date().toISOString(), rejectReason: null }],
  leaderboard: null, progress: { pct: 0, lastSection: null, completed: false }, reader: { language: 'en', textSize: 'M', streak: { count: 0, best: 0 } },
};
const prefs = { weekly: true, monthly: true, email: false, emailAllowed: false, domains: [], stream: null, cpdInterests: [], leaderboardOptIn: false, language: 'en', textSize: 'M', unsubscribed: false, streak: { count: 0, best: 0 }, options: { domains: [{ key: 'SCIENCE', label: 'Science' }], streams: ['SCIENCE'] } };

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'STUDENT';
  perms.value = { 'digest.read': 'ALL' };
  api.preferences.mockResolvedValue(prefs);
  api.home.mockResolvedValue({ weekly: null, monthly: null, continueReading: null, flashcardsDue: 0, streak: { count: 0, best: 0 }, closingSoon: [], savedCount: 0 });
  api.editions.mockResolvedValue([{ id: 'e1', cadence: 'WEEKLY', periodLabel: edition.periodLabel, title: edition.title, publishedAt: null, myProgress: 0, myQuizScore: null }]);
  api.edition.mockResolvedValue(edition);
  api.map.mockResolvedValue({ month: 10, total: 0, byLevel: { SCHOOL: 0, DISTRICT: 0, STATE: 0, NATIONAL: 0, INTERNATIONAL: 0 }, byRegion: [], items: [] });
  api.progress.mockResolvedValue({ pct: 10, lastSection: 'hook', completed: false });
  api.reviewCard.mockResolvedValue({ cardKey: 'k', box: 2, dueAt: new Date().toISOString(), streak: { count: 1, best: 1 } });
});

describe('flashcards', () => {
  it('flips, then "I knew it" and "Review again" are sent; a card to review comes back this session', async () => {
    inApp(<FlashcardDeck cards={[{ key: 'k1', front: 'Q1', back: 'A1', domain: null, box: null }, { key: 'k2', front: 'Q2', back: 'A2', domain: null, box: null }]} />);
    expect(screen.getByRole('button', { name: 'I knew it' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Question: Q1/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Review again' }));
    await waitFor(() => expect(api.reviewCard).toHaveBeenCalledWith('k1', 'REVIEW'));
    await screen.findByText('Card 2 of 3');
    fireEvent.click(screen.getByRole('button', { name: /Question: Q2/ }));
    fireEvent.click(screen.getByRole('button', { name: 'I knew it' }));
    await waitFor(() => expect(api.reviewCard).toHaveBeenCalledWith('k2', 'KNEW'));
    expect(await screen.findByText('Card 3 of 3')).toBeTruthy();
  });
});

describe('the edition', () => {
  it('shows the hook, "check dates" for unconfirmed dates, comments as text, and sends the quiz once', async () => {
    api.quiz.mockResolvedValue({ score: 1, outOf: 1, onBoard: false, feedback: [{ key: 'q1', correct: true, yourAnswer: 0, answerIndex: 0, explain: 'It is an olympiad.' }] });
    inApp(<NewsletterView />);
    expect(await screen.findByText('Zero was described by Brahmagupta.')).toBeTruthy();
    expect(screen.getByText(/Check dates and rules on the official site/)).toBeTruthy();
    expect(screen.getByText('<b>not bold</b>')).toBeTruthy();
    expect(document.querySelector('.nl-comments b')?.textContent).not.toBe('not bold');
    fireEvent.click(screen.getByLabelText('Olympiad'));
    fireEvent.click(screen.getByRole('button', { name: 'Check my answers' }));
    await waitFor(() => expect(api.quiz).toHaveBeenCalledWith('e1', [0]));
    expect(await screen.findByText(/It is an olympiad/)).toBeTruthy();
  });

  it('a student has no email switch in Settings', async () => {
    inApp(<NewsletterView />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Settings' }));
    expect(await screen.findByText(/Students read the newsletter here/)).toBeTruthy();
    expect(screen.queryByLabelText(/Also send me the email version/)).toBeNull();
  });
});

describe('the desk', () => {
  it('is refused without the editor permission', async () => {
    api.opportunities.mockResolvedValue({ items: [], counts: {} });
    inApp(<NewsletterDeskView />);
    expect(await screen.findByText('For the newsletter editor')).toBeTruthy();
  });
});
