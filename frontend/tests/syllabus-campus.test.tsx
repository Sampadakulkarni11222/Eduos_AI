import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import type { CampusMapDto, CampusNodeDto, CourseModuleDto, SyllabusOverviewDto, SyllabusPlanDto, SyllabusRowDto } from '@/lib/ops-types';

/**
 * The module tracker and the campus map both show what teachers recorded, so
 * the screens must not invent anything: a subject with no plan is "not
 * planned", a class whose register is not taken is "not taken" (never zero),
 * a lesson is recorded only with what the teacher ticked, and a department
 * links only to pages the reader's portal has.
 */

const nav = vi.hoisted(() => ({ pathname: '/oakridge/principal/syllabus' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => nav.pathname,
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));
const opsApi = vi.hoisted(() => ({ syllabus: vi.fn(), syllabusPlan: vi.fn(), recordModuleProgress: vi.fn(), campusMap: vi.fn(), campusFacility: vi.fn() }));
vi.mock('@/lib/ops-api', () => ({ opsApi }));
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ permissions: {}, hasAccess: () => true }) }));
// jsdom has no WebGL: the map falls back to its list, which carries the same facts.
vi.mock('@/components/campus/campus-scene', () => ({ STATE_COLORS: {}, stateOf: () => 'FREE', webglAvailable: () => false, CampusScene: class {} }));

const { SyllabusView } = await import('@/components/ops/syllabus-view');
const { CampusWorldView } = await import('@/components/campus/campus-world');
const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

const row = (over: Partial<SyllabusRowDto>): SyllabusRowDto => ({
  subjectOfferingId: 'o1', subject: 'Mathematics', class: 'Class 6 A', teacherId: 't1', teacher: 'Asha Rao', canManage: false,
  modulesTotal: 4, modulesDone: 2, coveragePct: 55, health: 'BEHIND', lastUpdateOn: '2026-10-01T00:00:00.000Z',
  current: { id: 'm3', title: 'Fractions', nextTopic: 'Adding fractions', progressPct: 20, expectedPct: 67, pace: 'BEHIND', plannedEnd: '2026-10-25T00:00:00.000Z' },
  ...over,
});
const overview = (rows: SyllabusRowDto[], byTeacher: SyllabusOverviewDto['byTeacher'] = []): SyllabusOverviewDto => ({
  rows, byTeacher, definition: 'On track compares topics done with the planned window.',
  totals: { subjects: rows.length, onTrack: 0, behind: rows.filter((r) => r.health === 'BEHIND').length, noPlan: rows.filter((r) => r.health === 'NO_PLAN').length, noRecentUpdate: 0 },
});
const moduleDto = (over: Partial<CourseModuleDto> = {}): CourseModuleDto => ({
  id: 'm3', subjectOfferingId: 'o1', order: 3, title: 'Fractions', description: null, plannedStart: '2026-10-01T00:00:00.000Z', plannedEnd: '2026-10-25T00:00:00.000Z', plannedPeriods: 12,
  status: 'IN_PROGRESS', startedAt: null, completedAt: null,
  topics: [{ id: 'a', title: 'Equivalent fractions', done: true, doneAt: '2026-10-03T00:00:00.000Z' }, { id: 'b', title: 'Adding fractions', done: false, doneAt: null }],
  updates: [], topicsDone: 1, topicsTotal: 2, progressPct: 50, expectedPct: 67, pace: 'ON_TRACK', daysLeft: 11, lastUpdateOn: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  nav.pathname = '/oakridge/principal/syllabus';
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
});

describe('the principal\'s module tracker', () => {
  it('starts with teachers, and a click narrows the subjects to that teacher', async () => {
    opsApi.syllabus.mockResolvedValue(overview(
      [row({}), row({ subjectOfferingId: 'o2', subject: 'Science', teacherId: 't2', teacher: 'Ravi Menon', health: 'NO_PLAN', coveragePct: null, current: null, modulesTotal: 0, modulesDone: 0, lastUpdateOn: null })],
      [{ teacherId: 't1', teacher: 'Asha Rao', subjects: 1, onTrack: 0, behind: 1, noPlan: 0, noUpdate: 0, coveragePct: 55, lessonsThisWeek: 2, avgScorePct: 71 },
        { teacherId: 't2', teacher: 'Ravi Menon', subjects: 1, onTrack: 0, behind: 0, noPlan: 1, noUpdate: 0, coveragePct: null, lessonsThisWeek: 0, avgScorePct: null }],
    ));
    inApp(<SyllabusView />);
    const asha = (await screen.findByText('Asha Rao')).closest('tr')!;
    expect(within(asha).getByText('71%')).toBeTruthy();
    // No published results and no plan: a dash, never 0%.
    const ravi = screen.getByText('Ravi Menon').closest('tr')!;
    expect(within(ravi).queryByText('0%')).toBeNull();
    expect(within(ravi).getAllByText('—').length).toBe(2);

    fireEvent.click(asha);
    expect(await screen.findByText('Fractions')).toBeTruthy();
    expect(screen.getByText('Next: Adding fractions')).toBeTruthy();
    expect(screen.queryByText('Science')).toBeNull();
    expect(screen.getByText(/Showing 1 of 2/)).toBeTruthy();
  });

  it('calls a subject with no modules "not planned" instead of showing progress', async () => {
    opsApi.syllabus.mockResolvedValue(overview([row({ health: 'NO_PLAN', coveragePct: null, current: null, modulesTotal: 0, modulesDone: 0, lastUpdateOn: null })]));
    inApp(<SyllabusView />);
    expect(await screen.findByText('Not planned')).toBeTruthy();
    expect(screen.getByText('No plan yet', { selector: '.pill, span' })).toBeTruthy();
    expect(screen.getByText('Never')).toBeTruthy();
  });
});

describe('recording a lesson', () => {
  const plan = (canManage: boolean): SyllabusPlanDto => ({ ...row({ canManage }), modules: [moduleDto()] });

  it('sends only the topics the teacher ticked, and says when that completes the module', async () => {
    nav.pathname = '/oakridge/teacher/syllabus';
    opsApi.syllabus.mockResolvedValue(overview([row({ canManage: true })]));
    opsApi.syllabusPlan.mockResolvedValue(plan(true));
    opsApi.recordModuleProgress.mockResolvedValue(moduleDto({ status: 'COMPLETED' }));
    inApp(<SyllabusView />);
    fireEvent.click((await screen.findByText('Fractions')).closest('tr')!);
    fireEvent.click(await screen.findByRole('button', { name: 'Record a lesson' }));
    // Nothing ticked and nothing written: there is nothing to record.
    const send = () => screen.getByRole('button', { name: /^Record (lesson|and complete module)$/ });
    expect(send()).toBeDisabled();
    // Only the open topic is offered; the one already taught is not.
    const dialog = screen.getByRole('dialog', { name: /Record a lesson/ });
    expect(within(dialog).queryByLabelText('Equivalent fractions')).toBeNull();
    fireEvent.click(within(dialog).getByLabelText('Adding fractions'));
    expect(send().textContent).toBe('Record and complete module');
    fireEvent.click(send());
    await waitFor(() => expect(opsApi.recordModuleProgress).toHaveBeenCalledTimes(1));
    expect(opsApi.recordModuleProgress.mock.calls[0][0]).toBe('m3');
    expect(opsApi.recordModuleProgress.mock.calls[0][1]).toMatchObject({ topicIds: ['b'] });
  });

  it('gives a reader of the plan no way to change it', async () => {
    nav.pathname = '/oakridge/parent/syllabus';
    opsApi.syllabus.mockResolvedValue(overview([row({})]));
    opsApi.syllabusPlan.mockResolvedValue(plan(false));
    inApp(<SyllabusView />);
    fireEvent.click((await screen.findByText('Fractions')).closest('tr')!);
    expect(await screen.findByText('Equivalent fractions')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record a lesson' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a module' })).toBeNull();
    expect(screen.queryByText('reopen')).toBeNull();
  });
});

describe('the campus map', () => {
  const node = (over: Partial<CampusNodeDto>): CampusNodeDto => ({
    id: 'x', code: 'X', name: 'X', kind: 'CLASSROOM', parentId: null, campusCode: 'MAIN', floorNo: 0, capacity: 40, accessible: true, status: 'ACTIVE', restricted: false,
    layout: { x: 0, z: 0, w: 10, d: 10, h: 3 } as CampusNodeDto['layout'], sampleLayout: true, now: [], ...over,
  });
  const map = (): CampusMapDto => ({
    institution: 'Oakridge Academy', institutionType: 'SCHOOL', campuses: [], sampleLayout: true, layers: { schedule: true }, asOf: new Date().toISOString(), localTime: '10:30',
    kpis: { rooms: 2, roomsInUse: 1, roomsFree: 1, classesNow: 1, examsNow: 0, studentsPresent: 34, studentsMarked: 36, sectionsMarked: 1, sections: 2, eventsToday: 0, outOfUse: 0, definition: 'In use = a timetabled class.' },
    eventsToday: [],
    facilities: [
      node({ id: 'b', code: 'ACB', name: 'Main Block', kind: 'BUILDING', now: null }),
      node({ id: 'f', code: 'ACB-F0', name: 'Main Block · Ground floor', kind: 'FLOOR', parentId: 'b', now: null }),
      node({ id: 'r1', code: 'G01', name: 'Room G01', parentId: 'f', now: [{ type: 'SCHEDULED_CLASS', label: 'Class 6 A · Mathematics', until: '11:00', source: 'TIMETABLE' }],
        live: { class: 'Class 6 A', homeRoom: false, enrolled: 36, present: 34, absent: 2, registerTaken: true, attendancePct: 94, source: "Today's attendance register" },
        lesson: { periodNo: 3, startTime: '10:15', endTime: '11:00', class: 'Class 6 A', subject: 'Mathematics', teacher: 'Asha Rao', module: { title: 'Fractions', nextTopic: 'Adding fractions', progressPct: 50, pace: 'ON_TRACK' } } }),
      node({ id: 'r2', code: 'G02', name: 'Room G02', parentId: 'f',
        live: { class: null, homeRoom: true, enrolled: 38, present: null, absent: null, registerTaken: false, attendancePct: null, source: "Today's attendance register" } }),
    ],
    departments: [
      { code: 'ACADEMICS', name: 'Academics', description: null, head: null, staffCount: 12, facilityIds: ['r1', 'r2'], metrics: [{ value: 1, label: 'classes right now', tone: 'neutral' }], pages: ['syllabus', 'attendance'] },
      { code: 'FINANCE', name: 'Finance & Accounts', description: null, head: { name: 'Meera Shah', title: 'Accounts Officer' }, staffCount: 2, facilityIds: [], metrics: [{ value: 4, label: 'overdue invoices', tone: 'warn' }], pages: ['payroll', 'fees'] },
    ],
  });

  it('shows the register\'s headcount and the teacher, and "not taken" where no register exists', async () => {
    nav.pathname = '/oakridge/teacher/campus';
    opsApi.campusMap.mockResolvedValue(map());
    inApp(<CampusWorldView />);
    // Wait for the list the map falls back to when 3D is unavailable.
    await screen.findByText('Grounds & outdoor');
    const g01 = screen.getByText('Room G01').closest('li')!;
    expect(g01.textContent).toContain('Asha Rao');
    expect(g01.textContent).toContain('34 of 36 present');
    const g02 = screen.getByText('Room G02').closest('li')!;
    expect(g02.textContent).toContain('38 on roll · register not taken');
    expect(g02.textContent).not.toMatch(/\b0 of 38/);
  });

  it('lists each department with its figures, linking only to pages this portal has', async () => {
    nav.pathname = '/oakridge/teacher/campus';
    opsApi.campusMap.mockResolvedValue(map());
    inApp(<CampusWorldView />);
    await screen.findByText('Grounds & outdoor');
    const academics = screen.getByText('Academics').closest('li')!;
    expect(academics.textContent).toContain('12 staff');
    expect(academics.textContent).toContain('1 classes right now');
    expect(within(academics).getByRole('link', { name: /Syllabus & Modules/ }).getAttribute('href')).toBe('/oakridge/teacher/syllabus');
    // A teacher's portal has neither payroll nor fees: the department is described, with no link.
    const finance = screen.getByText('Finance & Accounts').closest('li')!;
    expect(finance.textContent).toContain('Accounts Officer: Meera Shah');
    expect(within(finance).queryByRole('link')).toBeNull();
  });
});
