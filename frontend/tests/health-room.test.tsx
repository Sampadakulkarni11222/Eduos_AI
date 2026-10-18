import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';

/**
 * The health room screen (part 3): one component, four readers. The principal
 * sees counts and nothing else; a class teacher sees only shared care notes; a
 * role without health keys is told the records are restricted and nothing is
 * fetched; the nurse gets the desk.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/oakridge/principal/health-summary',
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));
const role = vi.hoisted(() => ({ value: 'PRINCIPAL' }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ me: { profile: { id: 'p1', role: role.value } } }) }));
const perms = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ permissions: perms.value, hasAccess: () => true }) }));
const api = vi.hoisted(() => ({
  summary: vi.fn(), classCareNotes: vi.fn(), family: vi.fn(), today: vi.fn(), visits: vi.fn(),
}));
vi.mock('@/lib/health-api', async (orig) => ({ ...(await orig<typeof import('@/lib/health-api')>()), healthApi: api }));

const dash = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/dashboard-api', async (orig) => ({ ...(await orig<typeof import('@/lib/dashboard-api')>()), dashboardApi: dash }));
vi.mock('@/lib/genui-api', async (orig) => ({ ...(await orig<typeof import('@/lib/genui-api')>()), genuiApi: { pinned: vi.fn().mockResolvedValue({ items: [], max: 6 }), ask: vi.fn(), pin: vi.fn(), unpin: vi.fn() } }));

const { HealthView } = await import('@/components/ops/health-view');
const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => { vi.clearAllMocks(); role.value = 'PRINCIPAL'; perms.value = {}; });

describe('health room screen', () => {
  it('shows the principal counts only', async () => {
    perms.value = { 'health.summary.read': 'ALL' };
    api.summary.mockResolvedValue({ periodDays: 30, visits: { today: 3, inPeriod: 41, byOutcome: { SENT_HOME: 4, REST: 20 }, injuries: 6 }, medication: { activePlans: 5, awaitingConsent: 1, missedOrRefusedInPeriod: 2, awaitingCountersign: 1 }, stock: { expired: 0, expiringSoon: 1, low: 2 }, careNotesShared: 7 });
    inApp(<HealthView mode="summary" />);
    expect(await screen.findByText('Visits today')).toBeInTheDocument();
    expect(screen.getByText('41')).toBeInTheDocument();
    expect(screen.getByText(/Counts only/)).toBeInTheDocument();
    expect(api.visits).not.toHaveBeenCalled();
    expect(api.family).not.toHaveBeenCalled();
  });

  it('shows the class teacher only the shared care notes', async () => {
    role.value = 'TEACHER';
    perms.value = { 'health.carenotes.read': 'OWN' };
    api.classCareNotes.mockResolvedValue({ items: [{ id: 'n1', studentId: 's1', studentName: 'Rahul Sharma', className: 'Class 6 A', text: 'Severe nut allergy: EpiPen in the health room', severity: 'SEVERE' }] });
    inApp(<HealthView mode="carenotes" />);
    expect(await screen.findByText('Severe nut allergy: EpiPen in the health room')).toBeInTheDocument();
    expect(api.visits).not.toHaveBeenCalled();
    expect(api.today).not.toHaveBeenCalled();
  });

  it('tells a role without health keys the records are restricted, and fetches nothing', () => {
    role.value = 'ADMIN';
    perms.value = { 'medical.read': 'ALL', 'health.summary.read': 'ALL' };
    inApp(<HealthView />);
    expect(screen.getByText('Health records are restricted')).toBeInTheDocument();
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });

  it('gives the nurse the desk with today\'s visits', async () => {
    role.value = 'NURSE';
    perms.value = { 'health.read': 'ALL', 'health.manage': 'ALL' };
    api.today.mockResolvedValue({ date: '2026-10-16', stock: { expired: 0, expiringSoon: 1, low: 0 }, doses: [], visits: [{ id: 'v1', refNo: 'HV/2026/0001', studentId: 's1', studentName: 'Rahul Sharma', className: 'Class 6 A', arrivedAt: '2026-10-16T04:10:00Z', leftAt: null, outcome: 'REST', outcomeLabel: 'Rested in the health room', injury: false, medicineGiven: false, complaint: 'Headache', vitals: null, action: null, attendedBy: 'Nurse Joy', parentNotified: null }] });
    inApp(<HealthView />);
    expect(await screen.findByText(/Headache/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Record a visit' })).toBeInTheDocument();
  });
});

describe('nurse insights (part 5)', () => {
  it("opens the nurse's own dashboard from an Insights tab", async () => {
    role.value = 'NURSE';
    perms.value = { 'health.manage': 'ALL', 'health.read': 'ALL' };
    api.today.mockResolvedValue({ date: '2026-10-16', stock: { expired: 0, expiringSoon: 0, low: 0 }, doses: [], visits: [] });
    dash.get.mockResolvedValue({ view: 'nurse', title: 'Health room at a glance', period: { days: 30, options: [{ days: 30, label: '30 days' }] }, asOf: new Date().toISOString(),
      kpis: [{ key: 'careDue', label: 'Care notes waiting for consent', value: 1, unit: 'count', detail: 'not yet shared with the class teacher', link: null, tone: 'bad' }],
      charts: [], lists: [], notes: ['Only the school nurse sees this dashboard.'] });
    inApp(<HealthView />);
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.click(await screen.findByRole('tab', { name: 'Insights' }));
    expect(await screen.findByText('Health room at a glance')).toBeInTheDocument();
    expect(screen.getByText('Care notes waiting for consent')).toBeInTheDocument();
    expect(dash.get).toHaveBeenCalled();
  });
});
