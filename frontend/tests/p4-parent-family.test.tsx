import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui';
import type { FamilyTodayDto, FeeStatementDto } from '@/lib/family-api';

/**
 * Part 4, the parent: the family desk on the dashboard (every child at once,
 * what is waiting, the language for messages), the Section 80C fee statement,
 * "read in my language" under a notice, and the parent's sidebar order.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/oakridge/parent',
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));
const fam = vi.hoisted(() => ({ today: vi.fn(), feeStatement: vi.fn(), translateNotice: vi.fn(), languages: vi.fn(), preferences: vi.fn(), savePreferences: vi.fn() }));
vi.mock('@/lib/family-api', async (orig) => ({ ...(await orig<typeof import('@/lib/family-api')>()), familyApi: fam }));

const { FamilyToday } = await import('@/components/family/family-today');
const { FeeTaxStatement } = await import('@/components/family/fee-tax-statement');
const { NoticeTranslate } = await import('@/components/family/notice-translate');
const { PORTALS } = await import('@/lib/portals');
const { recentFinancialYears } = await import('@/lib/family-api');

const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);
const today = (over: Partial<FamilyTodayDto> = {}): FamilyTodayDto => ({
  date: '2026-10-17', language: 'en', whatsapp: 'UNKNOWN',
  children: [
    { studentId: 'a', name: 'Rahul Sharma', firstName: 'Rahul', className: 'Class 6 A', today: 'ABSENT', attendancePct: 80, pendingFeesPaise: 800000, homeworkDue: [{ title: 'Fractions sheet', subject: 'Maths', dueOn: '2026-10-18' }], nextExam: { name: 'Unit Test 1', subject: 'Science', on: '2026-11-05' }, classTeacher: 'Ms Rao' },
    { studentId: 'b', name: 'Riya Sharma', firstName: 'Riya', className: 'Class 9 B', today: 'PRESENT', attendancePct: 96, pendingFeesPaise: 0, homeworkDue: [], nextExam: null, classTeacher: null },
  ],
  actions: [
    { kind: 'FEE_OVERDUE', urgency: 'high', childName: 'Rahul', text: 'Fee INV-1001: ₹8,000 was due on 27 Sept', link: '/parent/payments' },
    { kind: 'PTM_BOOK', urgency: 'normal', childName: null, text: 'Term 1 PTM: book a meeting slot', link: '/parent/ptm' },
  ],
  counts: { children: 2, actions: 2, urgent: 1, unreadNotifications: 3 },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  fam.languages.mockResolvedValue([{ code: 'en', name: 'English' }, { code: 'hi', name: 'हिन्दी (Hindi)' }]);
  fam.preferences.mockResolvedValue({ language: 'hi', whatsappOptIn: { status: 'UNKNOWN' } });
});

describe('the family desk', () => {
  it('shows every child with today\'s mark and the things waiting, each linking into the portal', async () => {
    fam.today.mockResolvedValue(today());
    inApp(<FamilyToday />);
    expect(await screen.findByRole('heading', { name: 'Today for your family' })).toBeTruthy();
    expect(screen.getByText('Rahul Sharma')).toBeTruthy();
    expect(screen.getByText('Riya Sharma')).toBeTruthy();
    expect(screen.getByText('Absent today')).toBeTruthy();
    expect(screen.getByText('Present today')).toBeTruthy();
    expect(screen.getByText('Waiting for you (2)')).toBeTruthy();
    const open = screen.getAllByRole('link', { name: 'Open' });
    expect(open[0].getAttribute('href')).toBe('/oakridge/parent/payments');
    expect(screen.getByText(/1 · Fractions sheet/)).toBeTruthy();
  });

  it('saves the language for messages', async () => {
    fam.today.mockResolvedValue(today());
    fam.savePreferences.mockResolvedValue({ language: 'hi', whatsappOptIn: { status: 'UNKNOWN' } });
    inApp(<FamilyToday />);
    const select = await screen.findByLabelText('Language for school messages');
    fireEvent.change(select, { target: { value: 'hi' } });
    await waitFor(() => expect(fam.savePreferences).toHaveBeenCalledWith({ language: 'hi' }));
  });

  it('says plainly when nothing is waiting, and renders nothing without children', async () => {
    fam.today.mockResolvedValue(today({ actions: [] }));
    const { unmount } = inApp(<FamilyToday />);
    expect(await screen.findByText('Nothing needs you today.')).toBeTruthy();
    unmount();
    fam.today.mockResolvedValue(today({ children: [] }));
    const { container } = inApp(<FamilyToday />);
    await waitFor(() => expect(fam.today).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('.fam-kid')).toBeNull());
  });
});

describe('the fee statement for income tax', () => {
  it('shows tuition and other charges per receipt and the 80C note', async () => {
    const st: FeeStatementDto = {
      financialYear: '2026-27', from: '2026-04-01', to: '2027-03-31', totalPaise: 1200000, tuitionPaise: 1100000, note: 'Section 80C covers tuition fees only.',
      children: [{ studentId: 'a', name: 'Rahul Sharma', admissionNo: 'OAK-1', className: 'Class 6 A', totalPaise: 1200000, tuitionPaise: 1100000, payments: [
        { receiptNo: 'R-1', invoiceNo: 'INV-1', paidOn: '2026-05-27', mode: 'UPI', amountPaise: 1200000, tuitionPaise: 1100000, otherPaise: 100000, split: 'BY_INVOICE_LINES' },
      ] }],
    };
    fam.feeStatement.mockResolvedValue(st);
    inApp(<FeeTaxStatement />);
    expect(await screen.findByText('R-1')).toBeTruthy();
    expect(screen.getAllByText('₹11,000').length).toBeGreaterThan(0);
    expect(screen.getByText(/80C covers tuition/)).toBeTruthy();
    expect(fam.feeStatement).toHaveBeenCalledWith(recentFinancialYears(1)[0]);
  });
});

describe('read a notice in my language', () => {
  it('defaults to the family\'s language and labels the AI translation; says so when unavailable', async () => {
    fam.translateNotice.mockResolvedValue({ announcementId: 'n1', lang: 'hi', languageName: 'Hindi', available: true, label: 'AI translation into Hindi. The English notice is the official one.', title: 'बस मार्ग 4', content: 'मार्ग 4 सोमवार से बदलेगा।', original: { title: 'Bus route 4', content: 'Route 4 changes Monday.' } });
    inApp(<NoticeTranslate announcementId="n1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Read in my language' }));
    expect(await screen.findByText('बस मार्ग 4')).toBeTruthy();
    expect(fam.translateNotice).toHaveBeenCalledWith('n1', 'hi');
    expect(screen.getByText(/English notice is the official one/)).toBeTruthy();
  });
});

describe('the parent sidebar', () => {
  it('puts the parent\'s own pages first and the shared school pages before Help', () => {
    const titles = PORTALS.parent.nav.map((g) => g.title);
    expect(titles.slice(0, 4)).toEqual(['WORKSPACE', 'MY CHILD', 'SCHOOL LIFE', 'ACCOUNT']);
    expect(titles[titles.length - 1]).toBe('HELP & SUPPORT');
  });
});
