import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';

/**
 * Part 4 leadership screens: the principal's school-wide attendance and
 * teacher workload, the board pack in a meeting, and certificates generated
 * from the record (no-dues check, reason when dues are open, the register).
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/oakridge/principal/attendance',
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));
const api = vi.hoisted(() => ({
  attendanceOverview: vi.fn(), workload: vi.fn(), boardPack: vi.fn(), freezeBoardPack: vi.fn(), boardPackPdf: vi.fn(),
  clearance: vi.fn(), previewCertificate: vi.fn(), generateCertificate: vi.fn(), certificateRegister: vi.fn(), verifyCertificate: vi.fn(),
}));
vi.mock('@/lib/leadership-api', async (orig) => ({ ...(await orig<typeof import('@/lib/leadership-api')>()), leadershipApi: api }));

const { AttendanceOverviewView } = await import('@/components/leadership/attendance-overview');
const { TeacherWorkloadView } = await import('@/components/leadership/teacher-workload');
const { BoardPackPanel } = await import('@/components/leadership/board-pack');
const { CertificateGenerator, CertificateRegister } = await import('@/components/leadership/certificates');
const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => { vi.clearAllMocks(); });

const overview = {
  period: { from: '2026-09-17', to: '2026-10-16', days: 20 }, threshold: 75,
  overall: { students: 120, marked: 2400, pctPresent: 91 },
  classes: [
    { sectionId: 's1', class: 'Class 5 A', level: 5, students: 60, marked: 1200, pctPresent: 93, belowThreshold: false, ABSENT: 80, LATE: 12 },
    { sectionId: 's2', class: 'Class 10 B', level: 10, students: 60, marked: 0, pctPresent: null, belowThreshold: false, ABSENT: 0, LATE: 0 },
  ],
  today: { date: '2026-10-16', schoolDay: true, registers: 2, notMarked: [{ sectionId: 's2', class: 'Class 10 B', classTeacher: 'Anjali Desai', students: 60, marked: 0 }], partlyMarked: [] },
  trend: [{ date: '2026-10-15', marked: 120, pctPresent: 90, absent: 12 }, { date: '2026-10-16', marked: 60, pctPresent: 92, absent: 5 }],
  belowThreshold: [{ enrollmentId: 'e1', studentId: 'st1', name: 'Diya Sharma', admissionNo: 'ADM-1', class: 'Class 5 A', pctPresent: 61, daysMarked: 18, absent: 7 }],
  belowThresholdTotal: 1, basis: 'Whole-day registers only.',
};

describe('school-wide attendance', () => {
  it('shows the overall figure, the register not taken with its class teacher, and the students below the line', async () => {
    api.attendanceOverview.mockResolvedValue(overview);
    inApp(<AttendanceOverviewView />);
    expect(await screen.findByText('91%')).toBeInTheDocument();
    expect(screen.getByText(/Class teacher: Anjali Desai/)).toBeInTheDocument();
    expect(screen.getByText('NOT TAKEN')).toBeInTheDocument();
    expect(screen.getByText('Diya Sharma')).toBeInTheDocument();
    // A class with nothing marked reads "—", never 0%.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Attendance threshold'), { target: { value: '85' } });
    expect(api.attendanceOverview).toHaveBeenLastCalledWith({ from: undefined, to: undefined, threshold: 85 });
  });
});

describe('teacher workload', () => {
  it('lists teachers busiest first and says in words who is over the cap', async () => {
    api.workload.mockResolvedValue({
      cap: 30, basis: 'From the timetable.',
      summary: { teachers: 2, averagePeriods: 27, overCap: 1, withoutPeriods: 0, periodsWithoutTeacher: 3, classTeachers: 1 },
      teachers: [
        { profileId: 't1', name: 'Amit Joshi', periodsPerWeek: 36, perDay: [6, 6, 6, 6, 6, 6], maxInADay: 6, sections: 12, classes: ['Class 5 A'], subjects: ['English', 'French'], classTeacherOf: ['Class 6 B'], coversLast30Days: 2, leaveDaysThisYear: 1, flags: ['OVER_CAP'] },
        { profileId: 't2', name: 'Deepak Nair', periodsPerWeek: 18, perDay: [3, 3, 3, 3, 3, 3], maxInADay: 3, sections: 4, classes: ['Class 8 A'], subjects: ['Mathematics'], classTeacherOf: [], coversLast30Days: 0, leaveDaysThisYear: 0, flags: [] },
      ],
    });
    inApp(<TeacherWorkloadView />);
    expect(await screen.findByText('Amit Joshi')).toBeInTheDocument();
    expect(screen.getByText('Over the cap')).toBeInTheDocument();
    expect(screen.getByText(/Class teacher · Class 6 B/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search teachers'), { target: { value: 'math' } });
    expect(screen.queryByText('Amit Joshi')).not.toBeInTheDocument();
    expect(screen.getByText('Deepak Nair')).toBeInTheDocument();
  });
});

const pack = {
  meeting: { id: 'm1', refNo: 'MTG/2026/0002', title: 'Quarterly board meeting', body: 'TRUST_BOARD', status: 'SCHEDULED', scheduledAt: '2026-10-25T05:30:00Z', quorum: 2, agenda: [{ order: 1, title: 'Accounts', presenter: null, decisionNeeded: true, papers: [] }], members: [] },
  previous: { available: false, reason: 'No earlier held meeting of this body.' },
  actions: { available: true, items: [{ actionId: 'a1', title: 'Obtain three quotes', meeting: 'AGM', ownerName: 'Demo Admin', dueOn: '2026-10-11', overdue: true }] },
  finance: { available: false, reason: 'Finance figures need access to the analytics workspace.' },
  budget: { available: false, reason: 'No budget recorded for 2026-27.' },
  compliance: { available: true, overdue: [{ kind: 'LICENCE', title: 'Fire safety certificate expires', date: '2026-09-08' }], dueIn30Days: [] },
  decisions: { available: true, items: [], note: 'Requests at a trustee stage.' },
  enrolment: { available: true, studentsOnRoll: 720 },
  questions: [{ question: 'What is blocking "Obtain three quotes", and what is the new date?', basis: '1 action past the due date in the action register.', section: 'actions' }],
  questionsNote: 'Suggested by fixed rules.', builtAt: '2026-10-16T08:00:00Z',
};

describe('board pack', () => {
  it('shows a member the frozen version, who has read it, and questions with the figure behind each', async () => {
    api.boardPack.mockResolvedValue({ mode: 'FROZEN', version: 2, frozenAt: '2026-10-15T08:00:00Z', frozenBy: 'Demo Principal', reads: [{ name: 'Mrs Trustee', at: '2026-10-16T09:00:00Z' }], versions: [{ version: 2, frozenAt: '2026-10-15T08:00:00Z', frozenBy: 'Demo Principal', note: null }], pack });
    inApp(<BoardPackPanel meetingId="m1" canManage={false} />);
    expect(await screen.findByText('Version 2')).toBeInTheDocument();
    expect(screen.getByText(/Read by Mrs Trustee/)).toBeInTheDocument();
    expect(screen.getByText(/What is blocking/)).toBeInTheDocument();
    expect(screen.getByText(/Based on: 1 action past the due date/)).toBeInTheDocument();
    expect(screen.getByText('Fire safety certificate expires')).toBeInTheDocument();
    expect(screen.getByText('720 students on roll.')).toBeInTheDocument();
    expect(screen.queryByText(/Freeze version/)).not.toBeInTheDocument();
  });

  it('lets the secretariat freeze the next version', async () => {
    api.boardPack.mockResolvedValue({ mode: 'LIVE', version: null, versions: [], pack });
    api.freezeBoardPack.mockResolvedValue({ mode: 'FROZEN', version: 1, versions: [], pack });
    inApp(<BoardPackPanel meetingId="m1" canManage />);
    fireEvent.click(await screen.findByText('Freeze version 1'));
    await screen.findByText('Live preview');
    expect(api.freezeBoardPack).toHaveBeenCalledWith('m1', undefined);
  });
});

describe('certificates from the record', () => {
  it('shows the no-dues check and asks for a reason before generating with dues open', async () => {
    api.clearance.mockResolvedValue({ requestId: 'r1', kind: 'TC', title: 'Transfer Certificate', required: true, clear: false, checks: [{ key: 'fees', label: 'Fees', status: 'DUE', detail: 'INR 8,000 outstanding on 1 invoice (INV-1001)', link: '/payments' }, { key: 'library', label: 'Library', status: 'CLEAR', detail: 'No books out, no fines due', link: '/library' }] });
    api.generateCertificate.mockResolvedValue({ serialNo: 'TC/2026/0001', verificationCode: 'ABCDEF1234', title: 'Transfer Certificate' });
    const done = vi.fn();
    inApp(<CertificateGenerator requestId="r1" documentTypeName="Transfer Certificate" onDone={done} onCancel={vi.fn()} />);
    expect(await screen.findByText(/INR 8,000 outstanding/)).toBeInTheDocument();
    expect(screen.getByText('Reason for leaving')).toBeInTheDocument();
    const go = screen.getByText('Generate & attach');
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/Trust waived the dues/), { target: { value: 'Trust waived the dues; letter on file.' } });
    expect(go).not.toBeDisabled();
    fireEvent.click(go);
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    expect(api.generateCertificate).toHaveBeenCalledWith('r1', expect.objectContaining({ overrideReason: 'Trust waived the dues; letter on file.' }));
  });

  it('lists the register and checks a code', async () => {
    api.certificateRegister.mockResolvedValue([{ id: 'c1', serialNo: 'TC/2026/0001', kind: 'TC', title: 'Transfer Certificate', studentName: 'Rahul Sharma', admissionNo: 'OAK-1', issuedAt: '2026-10-16T08:00:00Z', issuedBy: 'Demo Admin', duesOpen: true, overrideReason: 'Waived', status: 'ISSUED', requestId: 'r1' }]);
    api.verifyCertificate.mockResolvedValue({ valid: true, serialNo: 'TC/2026/0001', title: 'Transfer Certificate', studentName: 'Rahul Sharma', issuedAt: '2026-10-16T08:00:00Z' });
    inApp(<CertificateRegister />);
    expect(await screen.findByText('TC/2026/0001')).toBeInTheDocument();
    expect(screen.getByText(/OPEN · reason recorded/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: 'abcdef1234' } });
    fireEvent.click(screen.getByText('Check'));
    expect(await screen.findByText(/Valid: Transfer Certificate TC\/2026\/0001 for Rahul Sharma/)).toBeInTheDocument();
    expect(api.verifyCertificate).toHaveBeenCalledWith('ABCDEF1234');
  });
});
