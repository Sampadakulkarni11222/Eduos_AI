import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DashChartDto, RoleDashboardDto } from '@/lib/dashboard-api';

/**
 * The role dashboards: figures, charts and lists from the server, each with a
 * table view; a parent switches children through the server (never in the
 * browser); a missing class average is explained, not drawn; a role with no
 * dashboard renders nothing.
 */

const nav = vi.hoisted(() => ({ pathname: '/oakridge/teacher', push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => nav.pathname,
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/dashboard-api', async (orig) => ({ ...(await orig<typeof import('@/lib/dashboard-api')>()), dashboardApi: api }));

const { RoleDashboard } = await import('@/components/ops/role-dashboard');
const { DashChart } = await import('@/components/ops/dash-charts');

const chart = (over: Partial<DashChartDto>): DashChartDto => ({
  key: 'attendance', title: 'Attendance in my classes', type: 'line', unit: 'percent', link: '/attendance', definition: 'Present ÷ marked.',
  points: [{ label: '13 Oct', value: 90, detail: '27 of 30 present' }, { label: '14 Oct', value: 80, detail: '24 of 30 present' }],
  status: 'OK', emptyText: 'No register yet.', ...over,
});
const teacher = (over: Partial<RoleDashboardDto> = {}): RoleDashboardDto => ({
  view: 'teacher', title: 'My classes', period: { days: 30, options: [{ days: 30, label: '30 days' }, { days: 90, label: 'Term (90 days)' }] },
  kpis: [{ key: 'attention', label: 'Need attention', value: 2, unit: 'count', detail: 'by the risk rules', link: '/classes', tone: 'warn' }],
  charts: [chart({
    variants: [
      { key: 'all', label: 'All my classes', points: [{ label: '13 Oct', value: 90 }, { label: '14 Oct', value: 80 }] },
      { key: 's1', label: 'Class 6 A', points: [{ label: '13 Oct', value: 50 }, { label: '14 Oct', value: 100 }] },
    ],
  }), chart({ key: 'submissions', title: 'Assignment hand-in rate', type: 'bar', points: [], status: 'EMPTY', emptyText: 'No assignment of yours fell due in this period.' })],
  lists: [{ key: 'attention', title: 'Students needing attention', link: '/classes', empty: 'Nobody', items: [{ text: 'Aman Gupta', sub: 'Class 6 A · attendance 40% in 30 days', link: '/classes', tone: 'bad', badge: '1 signal' }] }],
  notes: [], asOf: '2026-10-15T05:00:00.000Z', ...over,
});

beforeEach(() => { vi.clearAllMocks(); nav.pathname = '/oakridge/teacher'; });

describe('the teacher dashboard', () => {
  it('shows figures, charts with a table view, variants, empty states and lists', async () => {
    api.get.mockResolvedValue(teacher());
    render(<RoleDashboard />);
    expect(await screen.findByRole('heading', { name: 'My classes' })).toBeTruthy();
    const kpis = screen.getByRole('list', { name: 'Key figures' });
    expect(within(kpis).getByText('Need attention')).toBeTruthy();
    expect(within(kpis).getByText('(worth a look)')).toBeTruthy(); // tone in words, not only colour

    const att = screen.getByRole('region', { name: 'Attendance in my classes' });
    fireEvent.click(within(att).getByRole('button', { name: 'Show table' }));
    const rows = within(within(att).getByRole('table')).getAllByRole('row');
    expect(rows[1].textContent).toMatch(/13 Oct.*90%/);
    fireEvent.change(within(att).getByLabelText('Show'), { target: { value: 's1' } });
    expect(within(within(att).getByRole('table')).getAllByRole('row')[1].textContent).toMatch(/50%/);

    expect(screen.getByText('No assignment of yours fell due in this period.')).toBeTruthy();
    expect(screen.getByText('Aman Gupta').closest('a')?.getAttribute('href')).toBe('/oakridge/teacher/classes');
  });

  it('asks the server for another period', async () => {
    api.get.mockResolvedValue(teacher());
    render(<RoleDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Term (90 days)' }));
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith({ days: 90, child: null }));
  });

  it('opens the records when a mark is tapped', async () => {
    api.get.mockResolvedValue(teacher());
    render(<RoleDashboard />);
    const att = await screen.findByRole('region', { name: 'Attendance in my classes' });
    fireEvent.click(within(att).getByRole('button', { name: /^13 Oct: 90%.*Open the records/ }));
    expect(nav.push).toHaveBeenCalledWith('/oakridge/teacher/attendance');
  });
});

describe('the parent dashboard', () => {
  const parent = (childId: string): RoleDashboardDto => ({
    ...teacher(), view: 'parent', title: childId === 'k2' ? "Riya's progress" : "Rahul's progress",
    children: [{ id: 'k1', name: 'Rahul Sharma', className: 'Class 6 A' }, { id: 'k2', name: 'Riya Sharma', className: 'Class 3 B' }],
    child: { id: childId, name: childId === 'k2' ? 'Riya Sharma' : 'Rahul Sharma', className: 'Class 6 A', classSize: null },
    charts: [chart({ title: 'Attendance by week', compare: null, compareNote: 'The class average appears only for classes of at least 5 students.' })],
    lists: [],
  });

  it('switches child through the server and explains a missing class average', async () => {
    nav.pathname = '/oakridge/parent';
    api.get.mockImplementation(async ({ child }: { child: string | null }) => parent(child ?? 'k1'));
    render(<RoleDashboard />);
    expect(await screen.findByRole('heading', { name: "Rahul's progress" })).toBeTruthy();
    expect(screen.getByText(/at least 5 students/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Riya Sharma/ }));
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith({ days: null, child: 'k2' }));
    expect(await screen.findByRole('heading', { name: "Riya's progress" })).toBeTruthy();
  });

  it('follows a child chosen by the page around it', async () => {
    nav.pathname = '/oakridge/parent';
    api.get.mockImplementation(async ({ child }: { child: string | null }) => parent(child ?? 'k1'));
    const onChange = vi.fn();
    render(<RoleDashboard childId="k2" onChildChange={onChange} />);
    expect(await screen.findByRole('heading', { name: "Riya's progress" })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Rahul Sharma/ }));
    expect(onChange).toHaveBeenCalledWith('k1');
  });
});

it('renders nothing for a role without a dashboard', async () => {
  api.get.mockResolvedValue({ view: null, period: { days: 30, options: [] }, kpis: [], charts: [], lists: [], notes: [], asOf: '' });
  const { container } = render(<RoleDashboard />);
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  await waitFor(() => expect(container.textContent).toBe(''));
});

describe('chart kinds', () => {
  it('gives a donut a legend with amounts and shares', () => {
    render(<DashChart c={chart({ key: 'fees', title: 'Fees', type: 'donut', unit: 'count', points: [{ label: 'Paid', value: 3, tone: 'good' }, { label: 'Overdue', value: 1, tone: 'bad' }] })} />);
    const fees = screen.getByRole('region', { name: 'Fees' });
    expect(within(fees).getByText('Paid').closest('a')?.textContent).toMatch(/Paid3 ?75%/);
    expect(within(fees).getByText('Overdue').closest('a')?.textContent).toMatch(/25%/);
  });

  it('marks the comparison on horizontal bars and names it for screen readers', () => {
    render(<DashChart c={chart({ key: 'syllabus', title: 'Syllabus coverage', type: 'hbar', link: '/syllabus', points: [{ label: 'Maths · 6 A', value: 25, tone: 'bad' }], compare: { label: 'Expected by today', points: [{ label: 'Maths · 6 A', value: 60 }] } })} />);
    const link = screen.getByRole('link', { name: /Maths · 6 A: 25%.*Expected by today 60%/ });
    expect(link.getAttribute('href')).toBe('/oakridge/teacher/syllabus');
    expect(screen.getByText('(needs attention)')).toBeTruthy();
    expect(screen.getByText('Expected by today')).toBeTruthy();
  });
});
