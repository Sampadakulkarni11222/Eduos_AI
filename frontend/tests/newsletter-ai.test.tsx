import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import type { EditionExtras, Extraction } from '@/lib/newsletter-api';

/**
 * Part 5 newsletter screens: the 60-second cards show each pick with its
 * deadline and reason; the deadline radar groups by 7 / 14 / 30 days; an
 * extracted candidate shows each detail beside its source text; the Google
 * Alerts desk explains the RSS route (never an "API integration") and sends
 * the feed address the editor pasted.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/oakridge/principal/newsletter-desk',
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));
const api = vi.hoisted(() => ({
  alertGuide: vi.fn(), alertSources: vi.fn(), alertItems: vi.fn(), alertAnalytics: vi.fn(), addAlertSource: vi.fn(), classmates: vi.fn(), challenge: vi.fn(),
}));
vi.mock('@/lib/newsletter-api', async (orig) => ({ ...(await orig<typeof import('@/lib/newsletter-api')>()), newsletterApi: api }));

const { SixtySeconds, DeadlineRadar, ExtractionDetails, DeskAlerts, ChallengeBlock } = await import('@/components/ops/newsletter-ai-views');
const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

const extras: EditionExtras = {
  editionId: 'e1',
  sixtySeconds: [
    { kind: 'HOOK', title: 'This week in 60 seconds', text: 'Robots that sort waste.', question: 'What would yours do?' },
    { kind: 'ITEM', id: 'o1', title: 'Junior Robotics Challenge', text: 'Build a robot.', type: 'Competition', chip: 'Closes in 5 days', urgent: true, because: 'Because Rahul is in Class 6 and chose Robotics' },
    { kind: 'NEXT', title: 'Your move', text: 'Try the 3-question quiz.' },
  ],
  deadlineRadar: { in7: [{ id: 'o1', title: 'Junior Robotics Challenge', daysLeft: 5, closes: '2026-10-22', saved: true, inEdition: true, because: null }], in14: [], in30: [], note: 'Only confirmed dates.' },
  because: {}, badges: [{ key: 'first-flip', label: 'First flip', earned: true, progress: '1/1', hint: 'Flip a card' }], streak: { count: 2, best: 3 },
  challenges: { sent: [{ id: 'c1', direction: 'SENT', with: 'Rahul S.', status: 'DONE', yourScore: 3, theirScore: 2, outOf: 3, result: 'You won' }], received: [], left: 4, note: 'Only you and your classmate see these scores.' },
};

describe('reader extras', () => {
  it('shows the 60-second cards with deadline and reason, and the radar lanes', () => {
    inApp(<><SixtySeconds extras={extras} /><DeadlineRadar extras={extras} /></>);
    expect(screen.getByText('Closes in 5 days')).toBeTruthy();
    expect(screen.getByText(/Because Rahul is in Class 6/)).toBeTruthy();
    expect(screen.getByText('1 of 3')).toBeTruthy();
    expect(screen.getByText('Within 7 days')).toBeTruthy();
    expect(screen.getByText('8 to 14 days')).toBeTruthy();
  });

  it('shows a challenge result to the student and offers classmates only from the server list', async () => {
    api.classmates.mockResolvedValue([{ studentId: 's2', name: 'Aman G.' }]);
    inApp(<ChallengeBlock editionId="e1" extras={extras} onChanged={() => undefined} />);
    expect(screen.getByText(/3\/3 v 2\/3: You won/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Challenge a classmate' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aman G.' })).toBeTruthy());
  });
});

describe('editor', () => {
  it('shows each extracted detail beside the text it came from, and what was dropped', () => {
    const x: Extraction = { method: 'AUTO', label: 'Auto-extracted, check before publishing', fields: [{ field: 'registrationCloses', snippet: 'Last date to register is 30 November 2026', from: 'PAGE' }], dropped: ['officialUrl'], page: { fetched: true, url: 'https://x.gov.in', note: 'Read from the official page' }, at: null };
    inApp(<ExtractionDetails x={x} sourceLink="https://x.gov.in/a" />);
    expect(screen.getByText('Auto-extracted, check before publishing')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText(/Last date to register is 30 November 2026/)).toBeTruthy();
    expect(screen.getByText(/Left out because no source text supported them: Official link/)).toBeTruthy();
  });

  it('the Google Alerts desk explains the RSS route and adds the pasted feed', async () => {
    api.alertGuide.mockResolvedValue({
      title: 'Add a Google Alert', steps: ['Set "Deliver to" to "RSS feed".'], notes: ['Google Alerts has no API.'], state: null,
      suggestions: { byDomain: { SCIENCE: ['national science olympiad registration'] }, byLevel: { NATIONAL: ['CBSE circular competition'], STATE: [], INTERNATIONAL: [] } },
      domains: [], levels: [], aiExtraction: 'No AI key is set.', urlPattern: 'https://www.google.com/alerts/feeds/<number>/<number>',
    });
    api.alertSources.mockResolvedValue([]);
    api.alertItems.mockResolvedValue([]);
    api.alertAnalytics.mockResolvedValue({ sources: [], totals: { found: 0, candidates: 0, duplicates: 0, accepted: 0, rejected: 0 }, accuracy: { fieldsExtracted: 0, fieldsEdited: 0, keptAsExtractedPct: null, byMethod: {}, byField: [], note: 'n' } });
    api.addAlertSource.mockResolvedValue({});
    const { container } = inApp(<DeskAlerts />);
    await waitFor(() => expect(screen.getByText('national science olympiad registration')).toBeTruthy());
    expect(container.textContent).not.toMatch(/API integration/i);
    fireEvent.change(screen.getByPlaceholderText('https://www.google.com/alerts/feeds/…'), { target: { value: 'https://www.google.com/alerts/feeds/123456/654321' } });
    fireEvent.change(screen.getByPlaceholderText('Science olympiads, India'), { target: { value: 'Olympiads' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add the feed' }));
    await waitFor(() => expect(api.addAlertSource).toHaveBeenCalledWith(expect.objectContaining({ kind: 'GOOGLE_ALERT', url: 'https://www.google.com/alerts/feeds/123456/654321', title: 'Olympiads' })));
  });
});
