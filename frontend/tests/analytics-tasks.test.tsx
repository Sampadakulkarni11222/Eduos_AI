import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import type { MetricDto, OverviewDto, TaskDto, TaskSummaryDto } from '@/lib/analytics-api';

/**
 * The analytics workspace must never turn "not available" into 0, must say
 * "not comparable" instead of a percentage against nothing, and must give
 * every chart a table. The tasks page shows the summary tiles, offers only
 * the tabs the reader's scope allows, and requires a reason to snooze.
 */

const nav = vi.hoisted(() => ({ pathname: '/oakridge/principal/analytics' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => nav.pathname,
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));
const api = vi.hoisted(() => ({
  overview: vi.fn(), catalogue: vi.fn(), exportCsv: vi.fn(), reports: vi.fn(), report: vi.fn(), regenerate: vi.fn(), deliveries: vi.fn(), retryDeliveries: vi.fn(), downloadReport: vi.fn(),
  tasks: vi.fn(), taskSummary: vi.fn(), createTask: vi.fn(), acknowledgeTask: vi.fn(), snoozeTask: vi.fn(), completeTask: vi.fn(), reassignTask: vi.fn(), cancelTask: vi.fn(),
  features: vi.fn(), setFeatures: vi.fn(),
}));
// Saved views moved to the server in part 3 (they follow the person across devices): an in-memory server here.
const views = vi.hoisted(() => {
  const store: Array<{ id: string; name: string; filters: Record<string, unknown>; tab: string | null; focus: string | null; metricKeys: string[] }> = [];
  const fns = {
    store,
    list: vi.fn(async () => ({ items: [...store] })),
    save: vi.fn(async (b: { name: string; filters: Record<string, unknown>; tab: string; focus: string | null }) => { const v = { id: `v${store.length + 1}`, metricKeys: [], ...b }; store.splice(0, store.length, v, ...store.filter((x) => x.name !== b.name)); return v; }),
    remove: vi.fn(async () => ({ removed: true })),
    importViews: vi.fn(async (list: Array<{ name: string; filters: Record<string, unknown>; tab: string; focus: string | null }>) => { for (const b of list) store.push({ id: `i${store.length + 1}`, metricKeys: [], ...b }); return { imported: list.length, items: [...store] }; }),
  };
  return fns;
});
vi.mock('@/lib/analytics-api', async (orig) => ({ ...(await orig<typeof import('@/lib/analytics-api')>()), analyticsApi: api, savedViewsApi: views }));
vi.mock('@/lib/ops-api', () => ({ opsApi: { orgStaff: vi.fn().mockResolvedValue([]) }, downloadCsv: vi.fn(), qs: () => '' }));
const perms = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ permissions: perms.value, hasAccess: () => true }) }));

const { AnalyticsView } = await import('@/components/ops/analytics-view');
const { TasksView } = await import('@/components/ops/tasks-view');
const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

const metric = (over: Partial<MetricDto>): MetricDto => ({
  key: 'finance.net_collections', department: 'finance', label: 'Net fee collections', definition: 'Receipts less refunds by payment date.',
  numerator: null, denominator: null, unit: 'paise', kind: 'flow', dateBasis: 'Payment date', sources: ['Payment'], link: '/fees', version: 1,
  headline: true, trend: null, currentOnly: false, history: 'From dated records.', scope: '', currency: 'INR',
  current: { value: 480000, records: 3, coverage: 'FULL', note: null }, comparison: { value: 400000, records: 2, coverage: 'FULL', note: null },
  change: { current: 480000, previous: 400000, abs: 80000, pct: 20, comparable: true, reason: null }, ...over,
});
const overview = (metrics: MetricDto[]): OverviewDto => ({
  period: { from: '2026-10-01', to: '2026-10-14', start: '2026-09-30T18:30:00.000Z', end: '2026-10-14T18:30:00.000Z', days: 14, label: 'This month', tz: 'Asia/Kolkata', partial: false },
  comparison: { from: '2026-09-17', to: '2026-09-30', start: '2026-09-16T18:30:00.000Z', end: '2026-09-30T18:30:00.000Z', days: 14, label: 'Previous period', tz: 'Asia/Kolkata', partial: false },
  compare: 'previous', department: 'all', currency: 'INR', departments: [{ key: 'finance', label: 'Finance' }, { key: 'academics', label: 'Academics' }],
  scope: { level: 'ALL', departments: ['finance', 'academics'], classes: null }, metrics, computedAt: '2026-10-14T06:00:00.000Z', cutoff: '2026-10-14T06:00:00.000Z',
  catalogueVersion: 'abc', freshness: 'Kept for 60 seconds.',
});

beforeEach(() => {
  vi.clearAllMocks();
  perms.value = { 'analytics.workspace.read': 'ALL', 'analytics.export': 'ALL', 'reports.quarterly.read': 'ALL', 'tasks.read': 'ALL', 'tasks.manage': 'ALL' };
});

describe('the analytics workspace', () => {
  it('shows change, "not comparable" and "not available" honestly', async () => {
    api.overview.mockResolvedValue(overview([
      metric({}),
      metric({ key: 'finance.billed', label: 'Fees billed', comparison: { value: 0, records: 1, coverage: 'FULL', note: null }, change: { current: 5, previous: 0, abs: 5, pct: null, comparable: false, reason: 'The comparison value is zero' } }),
      metric({ key: 'admissions.strength', label: 'Students on roll', unit: 'count', currency: null, current: { value: null, records: 0, coverage: 'NONE', note: 'No records yet.' }, comparison: null, change: null }),
    ]));
    inApp(<AnalyticsView />);
    const net = await screen.findByRole('article', { name: 'Net fee collections' });
    expect(within(net).getByText(/\+20%/)).toBeTruthy();
    const billed = screen.getByRole('article', { name: 'Fees billed' });
    expect(within(billed).getByText(/Not comparable/)).toBeTruthy();
    expect(within(billed).queryByText(/Infinity|%$/)).toBeNull();
    const roll = screen.getByRole('article', { name: 'Students on roll' });
    expect(within(roll).getByText('Not available')).toBeTruthy();
    expect(within(roll).queryByText('0')).toBeNull();
    // The definition is one tap away.
    fireEvent.click(within(net).getByRole('button', { name: /How "Net fee collections"/ }));
    expect(within(net).getByText(/Receipts less refunds/)).toBeTruthy();
    // The export uses the same query as the screen.
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(api.exportCsv).toHaveBeenCalledWith(expect.objectContaining({ preset: 'month', compare: 'previous', department: 'all' })));
  });

  it('gives every trend a table with the same numbers, and asks the server for a department when its tab is chosen', async () => {
    const trend = { unit: 'day' as const, points: [{ label: '2026-10-01', from: '2026-10-01', to: '2026-10-01', value: 100000 }, { label: '2026-10-02', from: '2026-10-02', to: '2026-10-02', value: null }] };
    api.overview.mockResolvedValue(overview([metric({ trend })]));
    inApp(<AnalyticsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show table' }));
    const table = screen.getByRole('table');
    expect(within(table).getByText('2026-10-01').closest('tr')!.textContent).toMatch(/1,000/);
    expect(within(table).getByText('2026-10-02').closest('tr')!.textContent).toMatch(/Not available/);
    fireEvent.click(screen.getByRole('tab', { name: 'Finance' }));
    await waitFor(() => expect(api.overview).toHaveBeenLastCalledWith(expect.objectContaining({ department: 'finance' })));
  });

  it('hides the export from someone without the export key', async () => {
    perms.value = { 'analytics.workspace.read': 'OWN' };
    api.overview.mockResolvedValue(overview([metric({})]));
    inApp(<AnalyticsView />);
    await screen.findByRole('article', { name: 'Net fee collections' });
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Quarterly reports' })).toBeNull();
  });
});

describe('finding your way around analytics', () => {
  const trend = { unit: 'day' as const, points: [{ label: '1 Oct', from: '2026-10-01', to: '2026-10-01', value: 200000 }, { label: '2 Oct', from: '2026-10-02', to: '2026-10-02', value: 280000 }] };
  const cmpTrend = { unit: 'day' as const, points: [{ label: '17 Sep', from: '2026-09-17', to: '2026-09-17', value: 150000 }, { label: '18 Sep', from: '2026-09-18', to: '2026-09-18', value: 250000 }] };
  beforeEach(() => {
    try { window.localStorage.clear(); } catch { /* none */ }
    api.catalogue.mockResolvedValue({ version: 'abc', departments: [], scope: { level: 'ALL', departments: ['finance'] }, metrics: [metric({}), metric({ key: 'academics.attendance', department: 'academics', label: 'Attendance rate', unit: 'percent' })] });
    api.overview.mockImplementation(async (q: { department: string }) => ({
      ...overview([metric({ trend, comparisonTrend: q.department === 'all' ? null : cmpTrend, current: { value: 480000, records: 3, coverage: 'FULL', note: null, breakdown: [{ label: 'CASH', value: 300000 }, { label: 'UPI', value: 180000 }] } })]),
      department: q.department,
    }));
  });

  it('opens a department from its tile and shows where you are', async () => {
    inApp(<AnalyticsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Finance: open the department' }));
    await waitFor(() => expect(api.overview).toHaveBeenLastCalledWith(expect.objectContaining({ department: 'finance' })));
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText('Finance').getAttribute('aria-current')).toBe('page');
    // Breakdowns are charts with a table view; the parts make a whole, so a donut with shares.
    expect(await screen.findByRole('region', { name: 'Net fee collections: breakdown' })).toBeTruthy();
    expect(screen.getByText('Cash').closest('li')?.textContent).toMatch(/63%/);
    fireEvent.click(within(crumbs).getByRole('button', { name: 'Analytics' }));
    await waitFor(() => expect(api.overview).toHaveBeenLastCalledWith(expect.objectContaining({ department: 'all' })));
  });

  it('finds a measure by search and analyses it against the comparison period', async () => {
    inApp(<AnalyticsView />);
    await screen.findByRole('article', { name: 'Net fee collections' });
    fireEvent.change(await screen.findByLabelText('Find a measure'), { target: { value: 'net fee' } });
    fireEvent.click(within(screen.getByRole('list', { name: 'Matching measures' })).getByRole('button', { name: /Net fee collections/ }));
    await waitFor(() => expect(api.overview).toHaveBeenLastCalledWith(expect.objectContaining({ department: 'finance' })));
    const focus = await screen.findByRole('region', { name: 'Analysis of Net fee collections' });
    fireEvent.click(within(focus).getAllByRole('button', { name: 'Show table' })[0]);
    const table = within(focus).getAllByRole('table')[0];
    expect(within(table).getByText('2 Oct').closest('tr')!.textContent).toMatch(/2,800.*2,500.*18 Sep/);
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('Net fee collections')).toBeTruthy();
  });

  // Changed in part 3: views were kept in localStorage; they now live on the server per person
  // (decision 2), with a one-time import of what a browser still holds.
  it('saves a view on the server and brings it back', async () => {
    views.store.splice(0);
    inApp(<AnalyticsView />);
    await screen.findByRole('article', { name: 'Net fee collections' });
    fireEvent.click(screen.getByRole('tab', { name: 'Finance' }));
    fireEvent.click(screen.getByRole('button', { name: /Save this view/ }));
    fireEvent.change(screen.getByLabelText('Name for this view'), { target: { value: 'Monthly money' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(views.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Monthly money', tab: 'finance' })));
    expect(window.localStorage.getItem('eduos.analytics.views:me')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Monthly money' }));
    await waitFor(() => expect(api.overview).toHaveBeenLastCalledWith(expect.objectContaining({ department: 'finance' })));
  });

  it('imports the views a browser kept before, once, then clears them', async () => {
    views.store.splice(0);
    window.localStorage.setItem('eduos.analytics.views:me', JSON.stringify([{ name: 'Old view', q: { preset: 'this_month', compare: 'previous', department: 'finance' }, tab: 'finance', focus: null }]));
    inApp(<AnalyticsView />);
    expect(await screen.findByRole('button', { name: 'Old view' })).toBeTruthy();
    expect(views.importViews).toHaveBeenCalledWith([expect.objectContaining({ name: 'Old view', tab: 'finance' })]);
    expect(window.localStorage.getItem('eduos.analytics.views:me')).toBeNull();
  });
});

const task = (over: Partial<TaskDto> = {}): TaskDto => ({
  id: 't1', refNo: 'TSK/2026/0001', title: 'Fire NOC renewal', description: '', department: 'COMPLIANCE', category: 'LICENCE', severity: 'HIGH',
  status: 'OPEN', dueAt: '2026-10-10T03:30:00.000Z', overdue: true, daysLeft: -4, ownerProfileId: 'p1', ownerName: 'Compliance One', delegateName: null,
  amountPaise: 1500000, currency: 'INR', snoozedUntil: null, snoozeReason: null, requiresEvidence: true, evidence: [], history: [], ...over,
});
const summary: TaskSummaryDto = { total: { open: 3, overdue: 1, week: 1, month: 2, quarterCostPaise: 2500000, critical: 0, unassigned: 0 }, byDepartment: [], asOf: '2026-10-14T06:00:00.000Z', definition: 'Open = not done or cancelled.' };

describe('my tasks', () => {
  it('shows the summary tiles and the tabs the scope allows', async () => {
    api.taskSummary.mockResolvedValue(summary);
    api.tasks.mockResolvedValue({ items: [task()], total: 1, page: 1, pageSize: 100 });
    nav.pathname = '/oakridge/principal/tasks';
    inApp(<TasksView />);
    expect(await screen.findByText('Fire NOC renewal')).toBeTruthy();
    expect(screen.getByText('Forecast cost, next 90 days')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'All' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Exceptions/ }));
    await waitFor(() => expect(api.tasks).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'exceptions' })));
  });

  it('keeps an OWN holder to Mine, Department and Exceptions, and needs a reason to snooze', async () => {
    perms.value = { 'tasks.read': 'OWN', 'tasks.manage': 'OWN' };
    api.taskSummary.mockResolvedValue(summary);
    api.tasks.mockResolvedValue({ items: [task()], total: 1, page: 1, pageSize: 100 });
    inApp(<TasksView />);
    await screen.findByText('Fire NOC renewal');
    expect(screen.queryByRole('tab', { name: 'All' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reassign' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Snooze' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Snooze' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Inspector visits next week' } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    api.snoozeTask.mockResolvedValue(task({ status: 'SNOOZED' }));
    fireEvent.click(confirm);
    await waitFor(() => expect(api.snoozeTask).toHaveBeenCalledWith('t1', expect.stringMatching(/T09:00:00\+05:30$/), 'Inspector visits next week'));
  });

  it('will not complete an evidence-required task with nothing attached or described', async () => {
    api.taskSummary.mockResolvedValue(summary);
    api.tasks.mockResolvedValue({ items: [task()], total: 1, page: 1, pageSize: 100 });
    inApp(<TasksView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Complete' }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByRole('button', { name: 'Mark complete' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/What was done/), { target: { value: 'Renewed; certificate filed' } });
    expect((within(dialog).getByRole('button', { name: 'Mark complete' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
