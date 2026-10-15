import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CampusLiveDetailDto, CampusMyViewDto } from '@/lib/ops-types';

/**
 * Campus live details, added beside the existing map:
 *   - every panel over the 3D view folds into a chip and opens again, and the
 *     choice is remembered per user (and survives storage being unavailable);
 *   - one dynamic page renders the server's sections by kind, with "Open full
 *     page" only where the reader's portal has that page;
 *   - the room panel's Live now block shows teacher, cover, period countdown,
 *     register and last update; a family outside the class gets only a note;
 *   - a parent's panel shows their child's class and child only.
 */

const nav = vi.hoisted(() => ({ pathname: '/oakridge/teacher/campus', search: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => nav.pathname,
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => nav.search,
}));
const opsApi = vi.hoisted(() => ({ campusLive: vi.fn(), campusMyView: vi.fn() }));
vi.mock('@/lib/ops-api', () => ({ opsApi }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ me: { profile: { id: 'p1', role: 'TEACHER' } } }) }));
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ permissions: {}, hasAccess: () => true }) }));

const { CollapsePanel, usePanelState, LiveDetailView, LiveNowBlock, MyCampusPanel } = await import('@/components/campus/campus-live');

const inHour = () => {
  const now = Date.now();
  return { startsAt: new Date(now - 20 * 60_000).toISOString(), endsAt: new Date(now + 25 * 60_000).toISOString() };
};
const period = () => ({ periodNo: 3, startTime: '10:15', endTime: '11:00', ...inHour(), subject: 'Mathematics', teacher: 'Ms Rao', coveringFor: 'Mr Menon', room: null, teacherProfileId: 't1' });
const attendance = { marked: true, strength: 36, present: 34, absent: 2, late: 1, lastUpdatedAt: new Date().toISOString() };

function Panels() {
  const panels = usePanelState();
  return (
    <>
      <CollapsePanel id="kpis" label="Campus now" panels={panels}><div>KPI content</div></CollapsePanel>
      <CollapsePanel id="depts" label="Departments" panels={panels}><div>Dept content</div></CollapsePanel>
      <button type="button" onClick={() => panels.setAll(['kpis', 'depts'], false)}>collapse all</button>
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  nav.pathname = '/oakridge/teacher/campus';
  nav.search = new URLSearchParams();
});

describe('collapsible panels', () => {
  it('folds a panel into a chip and opens it again, and remembers the choice for this user', () => {
    const { unmount } = render(<Panels />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Campus now' }));
    expect(screen.queryByText('KPI content')).toBeNull();
    const chip = screen.getByRole('button', { name: /Campus now/ });
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect(JSON.parse(localStorage.getItem('eduos.campus.panels.p1')!)).toEqual({ kpis: true });
    unmount();
    render(<Panels />);
    expect(screen.queryByText('KPI content')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Campus now/ }));
    expect(screen.getByText('KPI content')).toBeInTheDocument();
  });

  it('collapses all panels at once', () => {
    render(<Panels />);
    fireEvent.click(screen.getByText('collapse all'));
    expect(screen.queryByText('KPI content')).toBeNull();
    expect(screen.queryByText('Dept content')).toBeNull();
  });

  it('still works when storage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<Panels />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Departments' }));
    expect(screen.queryByText('Dept content')).toBeNull();
    spy.mockRestore();
  });
});

const roomDetail = (): CampusLiveDetailDto => ({
  asOf: new Date().toISOString(), refreshSeconds: 15, kind: 'room', id: 'f1', title: 'Room G01', subtitle: 'classroom', facilityId: 'f1', sectionId: 's1',
  live: { className: 'Class 6 A', sectionId: 's1', period: period(), next: null, attendance, practical: { labId: 'l', title: 'Titration', subject: null, className: 'Class 6 A', teacher: null, until: null, status: 'IN_PROGRESS' }, club: null, updatedAt: attendance.lastUpdatedAt },
  sections: [
    { key: 'period', title: 'Right now', type: 'period', period: period(), attendance, className: 'Class 6 A', link: { page: 'timetable', label: 'Timetable', query: '' } },
    { key: 'roster', title: 'Present, absent and late', type: 'roster', counts: attendance, link: { page: 'attendance', label: 'Open the register', query: '?section=s1' }, items: [
      { id: 'e1', name: 'Rahul Sharma', initial: 'R', admissionNo: 'OAK-1', rollNo: 1, status: 'ABSENT' },
      { id: 'e2', name: 'Priya Verma', initial: 'P', admissionNo: 'OAK-2', rollNo: 2, status: 'PRESENT' },
      { id: 'e3', name: 'Aman Gupta', initial: 'A', admissionNo: 'OAK-3', rollNo: 3, status: 'LATE' },
    ] },
    { key: 'notices', title: 'Recent notices', type: 'list', items: [{ title: 'Sports day on Friday' }], link: { page: 'no-such-page', label: 'X', query: '' } },
  ],
});

describe('the dynamic live page', () => {
  it('renders a room by kind: period with countdown, the register with filters, and full-page links only where they exist', async () => {
    nav.search = new URLSearchParams('kind=room&id=f1');
    opsApi.campusLive.mockResolvedValue(roomDetail());
    render(<LiveDetailView />);
    expect(await screen.findByRole('heading', { name: 'Room G01' })).toBeInTheDocument();
    expect(opsApi.campusLive).toHaveBeenCalledWith('room', 'f1');
    expect(screen.getByRole('progressbar', { name: 'Period 3 progress' })).toBeInTheDocument();
    expect(screen.getByText(/covering for Mr Menon/)).toBeInTheDocument();
    expect(screen.getByText('Rahul Sharma')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Late 1' }));
    expect(screen.queryByText('Rahul Sharma')).toBeNull();
    expect(screen.getByText('Aman Gupta')).toBeInTheDocument();
    // attendance and timetable are teacher pages; "no-such-page" is not, so no link for notices.
    const full = screen.getAllByRole('link', { name: 'Open full page →' }).map((a) => a.getAttribute('href'));
    expect(full).toContain('/oakridge/teacher/attendance?section=s1');
    expect(full).toContain('/oakridge/teacher/timetable');
    expect(full).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'The teacher' })).toHaveAttribute('href', '/oakridge/teacher/live?kind=teacher&id=t1');
  });

  it('renders other kinds from their sections (a department with metrics and rooms)', async () => {
    nav.search = new URLSearchParams('kind=department&id=FINANCE');
    opsApi.campusLive.mockResolvedValue({ asOf: new Date().toISOString(), refreshSeconds: 15, kind: 'department', id: 'FINANCE', title: 'Finance & Accounts', sections: [
      { key: 'figures', title: 'Live figures', type: 'metrics', items: [{ label: 'overdue invoices', value: 4, tone: 'warn' }] },
      { key: 'rooms', title: 'Where it works', type: 'list', items: [{ title: 'Accounts Office', sub: 'office', go: { kind: 'room', id: 'f9' } }] },
    ] } satisfies CampusLiveDetailDto);
    render(<LiveDetailView />);
    expect(await screen.findByText('overdue invoices')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Accounts Office' })).toHaveAttribute('href', '/oakridge/teacher/live?kind=room&id=f9');
  });

  it('shows the server\'s refusal instead of any data', async () => {
    nav.search = new URLSearchParams('kind=class&id=s2');
    opsApi.campusLive.mockRejectedValue(new Error('Live details are shown for your own class only.'));
    render(<LiveDetailView />);
    expect(await screen.findByText(/your own class only/)).toBeInTheDocument();
  });
});

describe('the Live now block in the room panel', () => {
  it('shows teacher and cover, class, subject, countdown, register, late and the practical, with See details', async () => {
    opsApi.campusLive.mockResolvedValue(roomDetail());
    render(<LiveNowBlock kind="room" id="f1" />);
    expect(await screen.findByText('Live now')).toBeInTheDocument();
    expect(screen.getByText('Ms Rao')).toBeInTheDocument();
    expect(screen.getByText(/covering for Mr Menon/)).toBeInTheDocument();
    expect(screen.getByText('34 / 36', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Marked')).toBeInTheDocument();
    expect(screen.getByText('Titration')).toBeInTheDocument();
    expect(screen.getByText(/min left|:\d\d left/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See details →' })).toHaveAttribute('href', '/oakridge/teacher/live?kind=room&id=f1');
  });

  it('gives a family outside the class only the server\'s note, and no details link', async () => {
    opsApi.campusLive.mockResolvedValue({ asOf: new Date().toISOString(), refreshSeconds: 15, kind: 'room', id: 'f2', title: 'Room G02', live: null, sections: [{ key: 'live', title: 'Live now', type: 'note', text: 'Live details are shown for your own class only.' }] });
    render(<LiveNowBlock kind="room" id="f2" />);
    expect(await screen.findByText('Live details are shown for your own class only.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'See details →' })).toBeNull();
  });
});

describe('a parent\'s campus panel', () => {
  const view: CampusMyViewDto = {
    role: 'PARENT', asOf: new Date().toISOString(), refreshSeconds: 15,
    children: [{ studentId: 'k1', name: 'Rahul Sharma', className: 'Class 6 A' }, { studentId: 'k2', name: 'Meera Sharma', className: 'Class 6 B' }], selectedStudentId: 'k1',
    focus: { sectionId: 's1', className: 'Class 6 A', facilityId: 'f1', roomName: 'Room G01' },
    now: period(), teacher: { name: 'Ms Rao', subject: 'Mathematics', coveringFor: null },
    next: { periodNo: 4, startTime: '11:00', endTime: '11:45', subject: 'Science', teacher: 'Mr Iyer', room: null },
    timetable: [{ periodNo: 3, startTime: '10:15', endTime: '11:00', subject: 'Mathematics', teacher: 'Ms Rao', room: null, state: 'now' }],
    classCounts: { strength: 36, present: 34, marked: true, lastUpdatedAt: null },
    child: { studentId: 'k1', name: 'Rahul Sharma', today: 'LATE', markedAt: null, checkpoints: [{ point: 'GATE_IN', label: 'Gate — in', at: new Date().toISOString() }], bus: [] },
  };

  it('shows the child\'s class, the teacher, counts and the child\'s own status, and switches children', async () => {
    nav.pathname = '/oakridge/parent/campus';
    const onGo = vi.fn();
    const onChild = vi.fn();
    render(<MyCampusPanel data={view} onGo={onGo} onChild={onChild} />);
    expect(screen.getByText('Class 6 A')).toBeInTheDocument();
    expect(screen.getByText('Ms Rao')).toBeInTheDocument();
    expect(screen.getByText('Came late')).toBeInTheDocument();
    expect(screen.getByText(/Gate — in at/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show on map' }));
    expect(onGo).toHaveBeenCalledWith('f1');
    fireEvent.change(screen.getByRole('combobox', { name: 'Choose your child' }), { target: { value: 'k2' } });
    await waitFor(() => expect(onChild).toHaveBeenCalledWith('k2'));
    expect(screen.getByRole('link', { name: 'See details →' })).toHaveAttribute('href', '/oakridge/parent/live?kind=class&id=s1');
  });
});
