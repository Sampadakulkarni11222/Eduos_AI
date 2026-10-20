import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';

/**
 * Part 5 QA fixes found by browsing the demo:
 *   - the Live details page opened from the menu (no kind, no id) showed
 *     "Invalid id"; it now shows the reader's own corner and where to pick more;
 *   - submitting a hostel roll call with residents unmarked alerts the wardens
 *     and the principal at once, so it now asks first;
 *   - a refund or due shows as −₹450, not ₹-450;
 *   - HR (the alumni coordinator) reaches the alumni offers page with alumni.manage.
 */
const nav = vi.hoisted(() => ({ pathname: '/oakridge/teacher/live', search: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => nav.pathname,
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => nav.search,
}));
const http = vi.hoisted(() => ({ request: vi.fn() }));
const opsApi = vi.hoisted(() => ({ campusLive: vi.fn(), campusMyView: vi.fn() }));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), request: http.request }));
vi.mock('@/lib/ops-api', async (orig) => ({
  ...(await orig<typeof import('@/lib/ops-api')>()),
  opsApi,
  post: (p: string, b: unknown) => http.request(p, { method: 'POST', body: JSON.stringify(b) }),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ me: { profile: { id: 'p1', role: 'TEACHER' } } }) }));

const { LiveDetailView } = await import('@/components/campus/campus-live');
const { HostelLifeView } = await import('@/components/ops/p4-support-views');
const { money } = await import('@/components/ops/kit');
const { getRequiredPermission } = await import('@/lib/permissions');
const { EvidenceFooter } = await import('@/components/evidence-footer');
const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => { vi.clearAllMocks(); nav.search = new URLSearchParams(); nav.pathname = '/oakridge/teacher/live'; });
afterEach(() => { vi.restoreAllMocks(); });

describe('live details opened from the menu', () => {
  it('shows the reader\'s own classes instead of "Invalid id", and never asks for a room with no id', async () => {
    opsApi.campusMyView.mockResolvedValue({ role: 'TEACHER', asOf: new Date().toISOString(), refreshSeconds: 15, current: null, next: null });
    render(<LiveDetailView />);
    expect(await screen.findByText('Your classes')).toBeInTheDocument();
    expect(screen.getByText(/Choose what to follow live/)).toBeInTheDocument();
    expect(opsApi.campusLive).not.toHaveBeenCalled();
    expect(screen.queryByText(/Invalid id/)).toBeNull();
  });

  it('still opens the detail when a kind and id are given', async () => {
    nav.search = new URLSearchParams('kind=class&id=s1');
    opsApi.campusLive.mockResolvedValue({ asOf: new Date().toISOString(), refreshSeconds: 15, kind: 'class', title: 'Class 6 A', sections: [] });
    render(<LiveDetailView />);
    await waitFor(() => expect(opsApi.campusLive).toHaveBeenCalledWith('class', 's1'));
    expect(opsApi.campusMyView).not.toHaveBeenCalled();
  });
});

describe('hostel roll call', () => {
  const roll = { id: 'r1', date: '2026-10-17', session: 'NIGHT', block: 'ALL', submittedAt: null, counts: { PRESENT: 1, UNMARKED: 2, ABSENT: 0, LATE: 0, ON_LEAVE: 0 }, total: 3, unaccounted: 2, entries: [
    { studentId: 's1', name: 'Asha', roomNo: '101', status: 'PRESENT', outPassRef: null },
    { studentId: 's2', name: 'Bela', roomNo: '101', status: 'UNMARKED', outPassRef: null },
    { studentId: 's3', name: 'Chitra', roomNo: '102', status: 'UNMARKED', outPassRef: null },
  ] };
  const routes = () => http.request.mockImplementation(async (path: string) => {
    if (path.startsWith('/hostel/life/briefing')) return { lines: [], tonightTaken: false, evidence: { residents: 3, away: 0, meals: 3, lateReturns: 0, outpassesPending: 0, openIncidents: 0 } };
    if (path === '/hostel/life/rollcalls') return roll;
    if (path.endsWith('/submit')) return { ...roll, submittedAt: new Date().toISOString() };
    throw new Error(`unexpected ${path}`);
  });

  it('asks before submitting with residents unmarked, and sends nothing if the warden says no', async () => {
    routes();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    inApp(<HostelLifeView />);
    fireEvent.click(await screen.findByText('Open roll call'));
    fireEvent.click(await screen.findByRole('button', { name: 'Submit' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('2 residents are not marked present (2 unmarked, 0 absent)'));
    expect(http.request).not.toHaveBeenCalledWith('/hostel/life/rollcalls/r1/submit', expect.anything());
  });

  it('submits once the warden confirms', async () => {
    routes();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    inApp(<HostelLifeView />);
    fireEvent.click(await screen.findByText('Open roll call'));
    fireEvent.click(await screen.findByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(http.request).toHaveBeenCalledWith('/hostel/life/rollcalls/r1/submit', expect.anything()));
  });
});

describe('small fixes', () => {
  it('links a briefing source to the page the portal really has ("/fees" is not a finance page)', () => {
    nav.pathname = '/oakridge/finance';
    render(<EvidenceFooter items={[{ text: 'Finance: 557 overdue invoices', link: '/fees' }]} />);
    const a = screen.getByRole('link', { name: /557 overdue invoices/ });
    expect(a.getAttribute('href')).not.toBe('/oakridge/finance/fees');
    expect(a.getAttribute('href')).toMatch(/^\/oakridge\/finance\//);
  });

  it('writes a negative amount with a leading minus', () => {
    expect(money(-45000)).toBe('−₹450');
    expect(money(45000)).toBe('₹450');
    expect(money(null)).toBe('—');
  });

  it('lets HR, the alumni coordinator, open the alumni offers page with alumni.manage', () => {
    expect(getRequiredPermission('/hr/give-back')).toBe('alumni.manage');
    expect(getRequiredPermission('/student/give-back')).toBe('alumni.directory.read');
  });
});
