import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import type { Opportunity, PlannerDto } from '@/lib/p4-student-alumnus-api';

/**
 * Part 4, student and alumnus: the planner shows due work, the suggested week
 * with its reasons and (in a board year) the details to check; the give-back
 * board gives a student "I'm interested" through the coordinator and never a
 * link, and gives the coordinator Publish/Reject; an alumnus's certificate
 * list offers Cancel only while pending; a "safety" reply from Study Help
 * offers to tell the school's safeguarding team and sends only on the
 * student's own press.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/oakridge/student/planner',
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));
const auth = vi.hoisted(() => ({ role: 'STUDENT' }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ me: { profile: { id: 'p1', role: auth.role } } }) }));
const perms = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ permissions: perms.value, hasAccess: () => true }) }));
const p4 = vi.hoisted(() => ({
  certificateTypes: vi.fn(), myCertificates: vi.fn(), requestCertificate: vi.fn(), cancelCertificate: vi.fn(), downloadCertificate: vi.fn(),
  opportunities: vi.fn(), myOpportunities: vi.fn(), offer: vi.fn(), withdrawOffer: vi.fn(), reviewOffer: vi.fn(), interest: vi.fn(), planner: vi.fn(),
}));
vi.mock('@/lib/p4-student-alumnus-api', async (orig) => ({ ...(await orig<typeof import('@/lib/p4-student-alumnus-api')>()), p4Api: p4 }));
const ops = vi.hoisted(() => ({ reportConcern: vi.fn() }));
vi.mock('@/lib/ops-api', async (orig) => ({ ...(await orig<typeof import('@/lib/ops-api')>()), opsApi: ops }));

const { StudentPlannerView, GiveBackView, AlumniCertificatesView } = await import('@/components/ops/p4-student-alumnus-views');
const { SafetyHelp } = await import('@/components/study-help/results/safety-help');
const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

const plan = (over: Partial<PlannerDto> = {}): PlannerDto => ({
  student: { name: 'Kiran Das', className: 'Class 10 A', gradeNo: 10, stage: 'SECONDARY' },
  window: { from: '2026-10-17', to: '2026-11-06', days: 21 },
  due: [{ id: 'a1', title: 'Fractions worksheet', subject: 'Mathematics', type: 'WORKSHEET', chapter: null, dueAt: '2026-10-18', daysLeft: 1, status: 'NOT_STARTED' }],
  overdue: [], quizzes: [], exams: [{ exam: 'Unit Test 2', subject: 'Science', date: '2026-10-22', daysLeft: 5, maxMarks: 50 }], events: [],
  strengths: [{ subject: 'Mathematics', percentage: 44, papers: 1 }],
  plan: { dailyMinutes: 90, note: 'A suggestion.', days: [{ date: '2026-10-17', dayOff: false, totalMinutes: 45, blocks: [{ subject: 'Mathematics', minutes: 45, kind: 'HOMEWORK', reason: '“Fractions worksheet” is due tomorrow' }] }] },
  board: { exam: 'Class 10 board examination', guidance: 'Check each one now.', checks: [{ key: 'name', label: "Candidate's name", value: 'Kiran Das', missing: false }, { key: 'father', label: "Father's name", value: null, missing: true }], deadlines: [] },
  ...over,
});
const offer = (over: Partial<Opportunity> = {}): Opportunity => ({
  id: 'o1', kind: 'CAREER_TALK', kindLabel: 'Career talk', title: 'Life as a doctor', description: 'A talk.', organisation: null, location: null, mode: 'ONLINE',
  applyBy: null, audience: 'ALL_STUDENTS', link: null, postedBy: 'Sample Ananya Iyer', batchLabel: 'Class of 2018', status: 'PUBLISHED', createdAt: '2026-10-17', reviewNote: null,
  interested: false, mine: false, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'STUDENT';
  perms.value = { 'alumni.directory.read': 'ALL', 'assignments.read': 'OWN' };
});

describe('student planner', () => {
  it('shows what is due, the reasoned week and the board details with what is missing', async () => {
    p4.planner.mockResolvedValue(plan());
    inApp(<StudentPlannerView />);
    expect(await screen.findByText('Class 10 board examination: check your registration details')).toBeTruthy();
    expect(screen.getByText(/Missing — ask for it to be added/)).toBeTruthy();
    expect(screen.getAllByText('Fractions worksheet').length).toBeGreaterThan(0);
    expect(screen.getByText('“Fractions worksheet” is due tomorrow')).toBeTruthy();
    expect(screen.getByText(/Only your results are used/)).toBeTruthy();
  });

  it('has no board block outside Classes 10 and 12', async () => {
    p4.planner.mockResolvedValue(plan({ board: null, student: { name: 'Diya', className: 'Class 5 A', gradeNo: 5, stage: 'PRIMARY' } }));
    inApp(<StudentPlannerView />);
    await screen.findByText('Suggested week');
    expect(screen.queryByText(/check your registration details/)).toBeNull();
  });
});

describe('give-back board', () => {
  it('lets a student ask for an introduction, never showing a link', async () => {
    p4.opportunities.mockResolvedValue([offer({ link: null })]);
    p4.interest.mockResolvedValue(offer({ interested: true }));
    inApp(<GiveBackView />);
    fireEvent.click(await screen.findByText("I'm interested"));
    expect(screen.getByText(/Your details are not shared with the alumnus/)).toBeTruthy();
    fireEvent.click(screen.getByText('Send to the alumni coordinator'));
    await waitFor(() => expect(p4.interest).toHaveBeenCalledWith('o1', { note: undefined }));
    expect(screen.queryByText('Offer something')).toBeNull();
    expect(screen.queryByText('Link')).toBeNull();
  });

  it('gives the coordinator Publish and Reject on an alumnus offer', async () => {
    auth.role = 'HR';
    perms.value = { 'alumni.directory.read': 'ALL', 'alumni.manage': 'ALL' };
    p4.opportunities.mockResolvedValue([offer({ status: 'PENDING_REVIEW', interestCount: 0, interests: [] })]);
    p4.reviewOffer.mockResolvedValue(offer());
    inApp(<GiveBackView />);
    fireEvent.click(await screen.findByText('Publish'));
    await waitFor(() => expect(p4.reviewOffer).toHaveBeenCalledWith('o1', 'PUBLISH'));
    expect(screen.getByText('Reject')).toBeTruthy();
  });
});

describe('alumni certificates', () => {
  it('lists requests with Cancel only while pending, and Download when issued', async () => {
    auth.role = 'ALUMNUS';
    p4.certificateTypes.mockResolvedValue([{ id: 't1', name: 'Character Certificate', description: '', instructions: '', fields: [] }]);
    const base = { documentTypeId: 't1', purpose: 'Job', additionalInformation: null, requiredBy: null, requestData: [], requestedAt: '2026-10-17', reviewedAt: null, approvedAt: null, rejectedAt: null, rejectionReason: null, adminRemarks: null, cancelledAt: null, issuedAt: null, completedAt: null };
    p4.myCertificates.mockResolvedValue([
      { ...base, id: 'r1', documentTypeName: 'Character Certificate', status: 'PENDING', document: null },
      { ...base, id: 'r2', documentTypeName: 'Leaving Certificate', status: 'READY', document: { version: 1, fileName: 'lc.pdf', mimeType: 'application/pdf', size: 10, uploadedAt: null, remarks: null } },
    ]);
    inApp(<AlumniCertificatesView />);
    expect(await screen.findByText('Character Certificate')).toBeTruthy();
    expect(screen.getAllByText('Cancel')).toHaveLength(1);
    expect(screen.getAllByText('Download')).toHaveLength(1);
    expect(screen.getByText(/issued by the board itself/)).toBeTruthy();
  });
});

describe('study help safety reply', () => {
  it('sends a safeguarding report only when the student presses send', async () => {
    ops.reportConcern.mockResolvedValue({ id: 'c1', refNo: 'SG/2026/0001', status: 'REPORTED', officersNotified: 1, guidance: null });
    inApp(<SafetyHelp />);
    expect(ops.reportConcern).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Tell someone at school'));
    fireEvent.click(screen.getByLabelText('I am not safe right now'));
    fireEvent.click(screen.getByText('Send to the safeguarding team'));
    await waitFor(() => expect(ops.reportConcern).toHaveBeenCalledWith(expect.objectContaining({ category: 'OTHER', urgency: 'IMMEDIATE_DANGER' })));
    expect(await screen.findByText('SG/2026/0001')).toBeTruthy();
  });
});
