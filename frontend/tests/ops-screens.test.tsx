import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import type { ApprovalDto } from '@/lib/ops-types';

/**
 * The operations screens are shared by every portal, so three things have to
 * hold wherever one is mounted: its links stay inside the reader's own portal,
 * a decision is an explicit press that sends exactly one decision, and a
 * rejection cannot be sent without a reason.
 */

const nav = vi.hoisted(() => ({ pathname: '/oakridge/teacher/today' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => nav.pathname,
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));

const opsApi = vi.hoisted(() => ({ decide: vi.fn(), home: vi.fn(), pulse: vi.fn(), campusMap: vi.fn() }));
vi.mock('@/lib/ops-api', () => ({ opsApi }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ me: { profile: { id: 'p1', role: 'TEACHER', displayName: 'Asha Rao' } } }) }));
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ permissions: {}, hasAccess: () => true }) }));

const { usePortalHref } = await import('@/lib/school-path');
const { ApprovalDecisionButtons } = await import('@/components/ops/approvals-view');
const { RoleHome } = await import('@/components/ops/role-home');

const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);
const hrefFor = (pathname: string, href: string) => {
  nav.pathname = pathname;
  return renderHook(() => usePortalHref()).result.current(href);
};

beforeEach(() => { vi.clearAllMocks(); nav.pathname = '/oakridge/teacher/today'; });

describe('links on shared operations screens stay in the reader\'s portal', () => {
  it('adds the school and the portal to a portal-relative link, keeping the query', () => {
    expect(hrefFor('/oakridge/teacher/today', '/approvals?id=42')).toBe('/oakridge/teacher/approvals?id=42');
    expect(hrefFor('/oakridge/principal/compliance', '/compliance?tab=returns&id=7')).toBe('/oakridge/principal/compliance?tab=returns&id=7');
    expect(hrefFor('/oakridge/student', '/campus')).toBe('/oakridge/student/campus');
    // "compliance" and "marketing" are page names as well as portal names: the page wins.
    expect(hrefFor('/oakridge/compliance', '/compliance?tab=licences')).toBe('/oakridge/compliance/compliance?tab=licences');
    expect(hrefFor('/oakridge/marketing', '/marketing?tab=offers')).toBe('/oakridge/marketing/marketing?tab=offers');
    // A page that is not in the sidebar (a hidden alias) is still a page of this portal.
    expect(hrefFor('/oakridge/hr', '/trainings')).toBe('/oakridge/hr/trainings');
  });

  it('moves a link that names another portal to the reader\'s own when it has that page', () => {
    // The API links the admission CRM as /admin/admissions; marketing staff have it in their own portal.
    expect(hrefFor('/oakridge/marketing/marketing', '/admin/admissions')).toBe('/oakridge/marketing/admissions');
    // A principal has no admissions page of their own, so the link is left as written.
    expect(hrefFor('/oakridge/principal/marketing', '/admin/admissions')).toBe('/oakridge/admin/admissions');
  });

  it('never rewrites links that belong to no school', () => {
    expect(hrefFor('/oakridge/teacher/today', '/login')).toBe('/login');
    expect(hrefFor('/oakridge/teacher/today', '/super-admin/schools')).toBe('/super-admin/schools');
  });
});

const request = (over: Partial<ApprovalDto> = {}) => ({ id: 'a1', title: 'Lab equipment', canDecide: true, ...over } as ApprovalDto);

describe('deciding an approval', () => {
  it('offers no decision to someone who may not decide', () => {
    inApp(<ApprovalDecisionButtons req={request({ canDecide: false })} onDone={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('sends one APPROVE for one press, and hands back the updated request', async () => {
    const updated = request({ status: 'APPROVED' } as Partial<ApprovalDto>);
    opsApi.decide.mockResolvedValue(updated);
    const onDone = vi.fn();
    inApp(<ApprovalDecisionButtons req={request()} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(updated));
    expect(opsApi.decide).toHaveBeenCalledTimes(1);
    expect(opsApi.decide).toHaveBeenCalledWith('a1', 'APPROVE');
  });

  it('asks for a reason before a rejection is sent', async () => {
    inApp(<ApprovalDecisionButtons req={request()} onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('Reject "Lab equipment"')).toBeTruthy();
    // Opening the prompt has decided nothing.
    expect(opsApi.decide).not.toHaveBeenCalled();
  });

  it('shows the server\'s refusal instead of pretending the decision went through', async () => {
    opsApi.decide.mockRejectedValue(new Error('You cannot decide a request you raised.'));
    const onDone = vi.fn();
    inApp(<ApprovalDecisionButtons req={request()} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect((await screen.findByRole('alert')).textContent).toContain('You cannot decide a request you raised.');
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('the role home', () => {
  it('shows a figure with no data as unavailable rather than as zero, beside the interactive board', async () => {
    opsApi.home.mockResolvedValue({
      role: 'TEACHER',
      kpis: [
        { key: 'a', label: 'Open repairs', value: 3, unit: 'count', definition: 'Open work orders.', source: 'Facilities', link: '/facilities', tone: 'warn', status: 'OK' },
        { key: 'b', label: 'Cost per student', value: null, unit: 'paise', definition: 'Spend ÷ enrolment.', source: 'Budgets', link: null, tone: 'neutral', status: 'UNAVAILABLE' },
      ],
      tasks: [],
    });
    opsApi.pulse.mockResolvedValue({ charts: [], activity: [], departments: [], briefing: ['Good morning.'], asOf: new Date().toISOString() });
    inApp(<RoleHome />);
    expect(await screen.findByText('Open repairs')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    const unavailable = screen.getByText('Cost per student').closest('.kpi') as HTMLElement;
    expect(unavailable.textContent).not.toMatch(/\b0\b/);
    expect(screen.getByRole('link', { name: /Open repairs/ }).getAttribute('href')).toBe('/oakridge/teacher/facilities');
  });
});

describe('the interactive board', () => {
  it("links every department tile and chart to its records, inside the reader's portal", async () => {
    const { PulseBoard } = await import('@/components/ops/pulse-board');
    opsApi.pulse.mockResolvedValue({
      briefing: ['Good morning, Asha.', '2 decisions are waiting on you.'],
      departments: [{ key: 'finance', name: 'Finance', link: '/fees', lines: [[4, 'overdue invoices']], attention: true }],
      charts: [{ key: 'attendance', title: 'Attendance in my classes', type: 'line', unit: 'percent', link: '/attendance', definition: 'Present ÷ marked.', status: 'OK', emptyText: '', points: [{ label: '13 Oct', value: 92.5, detail: '37 of 40 present' }, { label: '14 Oct', value: 95, detail: '38 of 40 present' }] }],
      activity: [{ at: new Date().toISOString(), kind: 'approved', text: '"Lab kit" was approved', link: '/approvals?id=9' }],
      asOf: new Date().toISOString(),
    });
    inApp(<PulseBoard />);
    expect(await screen.findByText('Good morning, Asha.')).toBeTruthy();
    // A teacher's portal has no fees page, so the Finance tile is shown without a link rather than leading to "not found".
    expect(screen.getByText('Finance').closest('a')).toBeNull();
    expect(screen.getByText(/Attendance in my classes/).closest('a')!.getAttribute('href')).toBe('/oakridge/teacher/attendance');
    expect(screen.getByText('"Lab kit" was approved').closest('a')!.getAttribute('href')).toBe('/oakridge/teacher/approvals?id=9');
    // The chart describes itself for people who cannot see it.
    expect(screen.getByRole('img', { name: /Attendance in my classes: 13 Oct 92.5%, 14 Oct 95%/ })).toBeTruthy();
  });

  it('says a chart is empty instead of drawing it', async () => {
    const { PulseBoard } = await import('@/components/ops/pulse-board');
    opsApi.pulse.mockResolvedValue({ briefing: ['Hello.'], departments: [], activity: [], asOf: new Date().toISOString(),
      charts: [{ key: 'repairs', title: 'Open repairs by age', type: 'ageing', unit: 'count', link: '/facilities', definition: 'd', status: 'EMPTY', emptyText: 'No open repairs.', points: [{ label: 'Under 3 days', value: 0 }] }] });
    inApp(<PulseBoard />);
    expect(await screen.findByText('No open repairs.')).toBeTruthy();
    expect(screen.queryByRole('img', { name: /Open repairs by age/ })).toBeNull();
  });
});

describe('dashboard links only go to pages the portal has', () => {
  it('uses the portal\'s own name for the page, and gives no link when there is none', async () => {
    const { usePortalPage } = await import('@/lib/school-path');
    const pageFor = (pathname: string, href: string) => { nav.pathname = pathname; return renderHook(() => usePortalPage()).result.current(href); };
    expect(pageFor('/oakridge/principal', '/fees')).toBe('/oakridge/principal/fees');
    // Finance and admin call the same records "Payments".
    expect(pageFor('/oakridge/finance', '/fees')).toBe('/oakridge/finance/payments');
    expect(pageFor('/oakridge/admin', '/fees')).toBe('/oakridge/admin/payments');
    expect(pageFor('/oakridge/teacher', '/fees')).toBeNull();
    expect(pageFor('/oakridge/teacher', '/approvals?id=9')).toBe('/oakridge/teacher/approvals?id=9');
  });
});

describe('signing in again goes back to the right door', () => {
  it('names the school from the address, and the platform for platform pages', async () => {
    const { schoolDoorOf, signInPathFor } = await import('@/lib/school-path');
    expect(schoolDoorOf('/oakridge/principal/today')).toBe('oakridge');
    expect(schoolDoorOf('/oakridge')).toBe('oakridge');
    // Platform pages and bare portal paths belong to no school.
    expect(schoolDoorOf('/login')).toBeNull();
    expect(schoolDoorOf('/super-admin/schools')).toBeNull();
    expect(schoolDoorOf('/admin/users')).toBeNull();
    expect(schoolDoorOf('/')).toBeNull();
    // A school's people never land on the platform sign-in, which admits platform administrators only.
    expect(signInPathFor('oakridge')).toBe('/oakridge');
    expect(signInPathFor(null)).toBe('/login');
  });
});
