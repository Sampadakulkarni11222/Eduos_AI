import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';

/**
 * Part 2 screens: a family sees its child's support plan summary and goals
 * and nothing staff-only; a portfolio shows rubric levels (never scores) and
 * where each piece of evidence came from; scenario planning is labelled as a
 * projection with each assumption's source; the presence board explains that
 * "no check-in" is not "unattended"; an assistant answer carries "Based on".
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/oakridge/parent/support-plans',
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));
const role = vi.hoisted(() => ({ value: 'PARENT' }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ me: { profile: { id: 'p1', role: role.value } } }) }));
const perms = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ permissions: perms.value, hasAccess: () => true }) }));
const api = vi.hoisted(() => ({
  support: { family: vi.fn(), list: vi.fn(), suggestions: vi.fn() },
  portfolio: { students: vi.fn(), get: vi.fn() },
  scenario: { baseline: vi.fn(), preview: vi.fn(), list: vi.fn() },
  presence: { board: vi.fn() },
}));
vi.mock('@/lib/p2-api', async (orig) => ({ ...(await orig<typeof import('@/lib/p2-api')>()), supportApi: api.support, portfolioApi: api.portfolio, scenarioApi: api.scenario, presenceApi: api.presence }));

const { SupportPlansView } = await import('@/components/ops/support-plans-view');
const { PortfolioView } = await import('@/components/ops/portfolio-view');
const { ScenariosView } = await import('@/components/ops/scenarios-view');
const { PresenceView } = await import('@/components/ops/presence-view');
const { EvidenceFooter } = await import('@/components/evidence-footer');
const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => { vi.clearAllMocks(); role.value = 'PARENT'; perms.value = {}; });

describe('support plans, family view', () => {
  it('shows the summary, goals and family review notes only', async () => {
    api.support.family.mockResolvedValue({ items: [{
      id: 'sp1', refNo: 'SSP/2026/0001', studentName: 'Rahul Sharma', className: 'Class 6 A', areaLabel: 'Attendance', summary: 'We will work together on mornings.', status: 'ACTIVE', ownerName: 'Ms Rao', nextReviewOn: '2026-11-10',
      goals: [{ id: 'g1', title: 'Attend every day', measure: 'Attendance % over 4 weeks', unit: '%', baseline: 60, target: 90, reviewOn: '2026-11-10', status: 'ON_TRACK', latest: { at: '2026-10-14', value: 82 } }],
      familyActions: [{ id: 'a1', title: 'Morning routine chart', ownerKind: 'FAMILY', dueOn: null, status: 'OPEN' }],
      reviews: [{ at: '2026-10-14', byName: 'Ms Rao', summary: 'Four of five days this week.' }], acknowledgedAt: null, comment: null, closure: null,
    }] });
    inApp(<SupportPlansView />);
    expect(await screen.findByText('We will work together on mornings.')).toBeInTheDocument();
    expect(screen.getByText('Attend every day')).toBeInTheDocument();
    expect(screen.getByText(/latest 82%/)).toBeInTheDocument();
    expect(screen.getByText('Morning routine chart')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'I have read this' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Staff only|Mark referred|Referred to safeguarding|\+ Note/);
    expect(api.support.list).not.toHaveBeenCalled();
  });
});

describe('support plans, student view (part 5)', () => {
  it('speaks to the student about their own plans, not "your own child"', async () => {
    role.value = 'STUDENT';
    api.support.family.mockResolvedValue({ items: [] });
    inApp(<SupportPlansView />);
    expect(await screen.findByText(/Plans your school has shared with you/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/your own child/);
  });
});

describe('portfolio', () => {
  it('shows rubric levels and the source of each evidence item, with a PDF', async () => {
    api.portfolio.students.mockResolvedValue([{ studentId: 's1', name: 'Rahul Sharma', admissionNo: 'OAK-1', className: 'Class 6 A' }]);
    api.portfolio.get.mockResolvedValue({
      student: { id: 's1', name: 'Rahul Sharma', admissionNo: 'OAK-1', className: 'Class 6 A' }, term: '2026-27',
      levels: [{ key: 'DEVELOPING', label: 'Developing' }, { key: 'PROFICIENT', label: 'Proficient' }, { key: 'ADVANCED', label: 'Advanced' }],
      competencies: [{ key: 'COMMUNICATION', group: 'Core', label: 'Communication', description: 'Expresses ideas.', rating: { term: 'Term 1', level: 'PROFICIENT', levelLabel: 'Proficient', comment: 'Clear speaker', ratedByName: 'Ms Rao', ratedAt: '2026-10-01' }, history: [], evidence: [{ kind: 'CO_CURRICULAR', auto: true, title: 'Inter-school debate', detail: 'Second place', on: '2026-09-01', link: null }], reflections: [] }],
      generalReflections: [], counts: { evidence: 1, fromRecords: 1, teacherAdded: 0, rated: 1, reflections: 0 }, canManage: false, canReflect: false, note: 'No scores.',
    });
    inApp(<PortfolioView />);
    expect(await screen.findByText(/Proficient · Term 1/)).toBeInTheDocument();
    expect(screen.getByText('Co-curricular')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rate' })).toBeNull();
  });
});

describe('scenario planning', () => {
  it('labels the projection and shows where each assumption came from', async () => {
    role.value = 'PRINCIPAL'; perms.value = { 'scenarios.read': 'ALL', 'scenarios.manage': 'ALL' };
    const assumptions = [{ key: 'intake', label: 'New intake each year into Class 1', unit: 'students', value: 60, source: 'ACTUAL', default: 60 }, { key: 'feeIncreasePct', label: 'Fee increase each year', unit: '%', value: 8, source: 'DEFAULT', default: 8 }];
    const baseline = { asOf: '2026-10-15', academicYear: '2026-27', enrolment: { students: 600, grades: [] }, fees: { billedPaise: 1, collectedPaise: 1, perStudentPaise: 1, concessionPct: 0, collectionPct: 100 }, staffing: { teachers: 30, otherStaff: 10, studentsPerTeacher: 20, monthlyPayrollPaise: null, payrollPeriod: null }, transport: { riders: 200, vehicles: 5, usableSeats: 200, seatsPerVehicle: 40 }, budget: { fiscalYear: '2026-27', plannedPaise: 0, actualPaise: 0 }, sources: ['600 active enrolments in 2026-27'] };
    api.scenario.baseline.mockResolvedValue({ label: 'Projection', baseline, assumptions });
    const row = (year: number) => ({ year, label: year ? `Year ${year}` : 'Now', actual: !year, students: 600 + year * 10, byGrade: [], feePerStudentPaise: 100, feeRevenuePaise: 1000, teachersNeeded: 30, newTeachersVsNow: 0, studentsPerTeacher: 20, staffCostPaise: 10, riders: 200, vehiclesNeeded: 5, newVehiclesVsNow: 0, transportCostPaise: 1, otherCostsPaise: 1, totalCostPaise: 12, surplusPaise: 988 });
    api.scenario.preview.mockResolvedValue({ label: 'Projection from the assumptions shown, not a forecast.', baseline, assumptions, years: 1, rows: [row(0), row(1)] });
    inApp(<ScenariosView />);
    expect(await screen.findByText('Projection, not a forecast')).toBeInTheDocument();
    expect(screen.getByText(/Starting value from records/)).toBeInTheDocument();
    expect(screen.getByText(/Starting value default/)).toBeInTheDocument();
    expect(screen.getByText(/Based on: 600 active enrolments/)).toBeInTheDocument();
  });
});

describe('teacher presence and evidence', () => {
  it('explains that no check-in is not an unattended class', async () => {
    role.value = 'PRINCIPAL';
    api.presence.board.mockResolvedValue({ date: '2026-10-15', rows: [{ periodNo: 1, time: '09:00-09:45', room: 'R-6A', sectionId: 'x', className: 'Class 6 A', subject: 'English', teacherName: 'Ms Rao', status: 'PRESENT', checkIn: { name: 'Ms Rao', at: '2026-10-15T03:35:00Z', source: 'CAMERA_REVIEWED', covering: false } }], counts: { lessons: 1, present: 1, notCheckedIn: 0, viaCamera: 1 }, note: '"Not checked in" means no record yet, not that the class was unattended.' });
    inApp(<PresenceView />);
    expect(await screen.findByText(/reviewer-confirmed observation/)).toBeInTheDocument();
    expect(screen.getByText(/not that the class was unattended/)).toBeInTheDocument();
  });

  it('renders "Based on" with links to the records', () => {
    inApp(<EvidenceFooter items={[{ text: 'Attendance roster: 23 records, for 7 B, 1 Oct 2026 to 14 Oct 2026', link: '/attendance' }]} />);
    expect(screen.getByText(/Based on/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /23 records, for 7 B/ })).toHaveAttribute('href', expect.stringContaining('/oakridge/'));
  });
});
