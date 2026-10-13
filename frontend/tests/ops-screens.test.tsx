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

const opsApi = vi.hoisted(() => ({ decide: vi.fn(), home: vi.fn() }));
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
  it('shows a figure with no data as unavailable rather than as zero, and links the campus map', async () => {
    opsApi.home.mockResolvedValue({
      role: 'TEACHER',
      kpis: [
        { key: 'a', label: 'Open repairs', value: 3, unit: 'count', definition: 'Open work orders.', source: 'Facilities', link: '/facilities', tone: 'warn', status: 'OK' },
        { key: 'b', label: 'Cost per student', value: null, unit: 'paise', definition: 'Spend ÷ enrolment.', source: 'Budgets', link: null, tone: 'neutral', status: 'UNAVAILABLE' },
      ],
      tasks: [],
    });
    inApp(<RoleHome />);
    expect(await screen.findByText('Open repairs')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    const unavailable = screen.getByText('Cost per student').closest('.kpi') as HTMLElement;
    expect(unavailable.textContent).not.toMatch(/\b0\b/);
    expect(screen.getByRole('link', { name: /Campus World/ }).getAttribute('href')).toBe('/oakridge/teacher/campus');
    expect(screen.getByRole('link', { name: /Open repairs/ }).getAttribute('href')).toBe('/oakridge/teacher/facilities');
  });
});
