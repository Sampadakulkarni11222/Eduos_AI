import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';

/**
 * Part 4 screens (finance, HR, nurse): the finance reports, the cash close's
 * live variance and note rule, the reminder preview before sending, the
 * recruitment pipeline, the exit worksheet and the nurse's watch list.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/oakridge/finance/finance-reports',
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));
const perms = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ permissions: perms.value, hasAccess: () => true }) }));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), request: vi.fn().mockResolvedValue([{ profileId: 'p9', name: 'Amit Joshi', role: 'Teacher' }]) }));
const api = vi.hoisted(() => ({
  collections: vi.fn(), downloadDayBook: vi.fn(), ageing: vi.fn(), downloadAgeing: vi.fn(), anomalies: vi.fn(), reminderPreview: vi.fn(), sendReminders: vi.fn(),
  cashCloses: vi.fn(), cashExpected: vi.fn(), closeDay: vi.fn(), checkClose: vi.fn(),
  vacancies: vi.fn(), createVacancy: vi.fn(), vacancyStatus: vi.fn(), candidates: vi.fn(), addCandidate: vi.fn(), moveCandidate: vi.fn(), scoreCandidate: vi.fn(), draftOffer: vi.fn(), startVerification: vi.fn(),
  exits: vi.fn(), startExit: vi.fn(), clearance: vi.fn(), interview: vi.fn(), settlement: vi.fn(), settlementToPayroll: vi.fn(), letters: vi.fn(), closeExit: vi.fn(),
  healthWatch: vi.fn(), downloadRegister: vi.fn(),
}));
vi.mock('@/lib/p4-ops-api', async (orig) => ({ ...(await orig<typeof import('@/lib/p4-ops-api')>()), p4Api: api }));

const { FinanceReportsView, RecruitmentView, StaffExitsView, HealthWatchView } = await import('@/components/ops/p4-ops-views');
const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);
const B = (key: string, amountPaise: number, count = 1) => ({ key, label: key, count, amountPaise });

beforeEach(() => { vi.clearAllMocks(); perms.value = {}; });

describe('finance reports', () => {
  it('shows collections by mode, cashier, head and class, and what awaits approval', async () => {
    perms.value = { 'fees.read': 'ALL' };
    api.collections.mockResolvedValue({ range: { from: '2026-10-01', to: '2026-10-17', days: 17 }, totals: { receipts: 3, collectedPaise: 5000000, refundsPaise: 0, netPaise: 5000000 }, pendingApproval: { count: 1, amountPaise: 100000 }, byMode: [B('Cash', 3000000, 2), B('UPI', 2000000)], byDay: [B('2026-10-16', 5000000, 3)], byCashier: [B('Finance Officer', 5000000, 3)], byHead: [B('Tuition', 5000000, 3)], byClass: [B('Class 8 B', 5000000, 3)], refunds: [], notes: ['Collected = payments credited to the ledger.'] });
    inApp(<FinanceReportsView />);
    expect(await screen.findByText('Finance Officer')).toBeInTheDocument();
    expect(screen.getByText('Tuition')).toBeInTheDocument();
    expect(screen.getByText('Awaiting approval (1)')).toBeInTheDocument();
    expect(screen.getByText('Collected = payments credited to the ledger.')).toBeInTheDocument();
  });

  it('asks for a reason when the cash count does not match, then closes the day', async () => {
    perms.value = { 'fees.read': 'ALL', 'fees.pay': 'ALL' };
    api.collections.mockResolvedValue({ range: { from: 'x', to: 'y', days: 1 }, totals: { receipts: 0, collectedPaise: 0, refundsPaise: 0, netPaise: 0 }, pendingApproval: { count: 0, amountPaise: 0 }, byMode: [], byDay: [], byCashier: [], byHead: [], byClass: [], refunds: [], notes: [] });
    api.cashExpected.mockResolvedValue({ day: '2026-10-17', cashReceipts: 2, cashInPaise: 100000, cashRefundsPaise: 0, expectedCashPaise: 100000, awaitingApproval: 0, nonCash: {}, denominations: [50000, 20000, 10000], existing: null });
    api.cashCloses.mockResolvedValue({ items: [] });
    api.closeDay.mockResolvedValue({});
    inApp(<FinanceReportsView />);
    fireEvent.click(screen.getByRole('tab', { name: /Cash close/ }));
    const five = await screen.findByLabelText('Count of ₹500');
    fireEvent.change(five, { target: { value: '1' } });
    expect(screen.getByText(/short by/)).toBeInTheDocument();
    const close = screen.getByRole('button', { name: /^Close / });
    expect(close).toBeDisabled();
    fireEvent.change(five, { target: { value: '2' } });
    expect(screen.getByText('balanced')).toBeInTheDocument();
    expect(close).not.toBeDisabled();
  });

  it('shows who would receive a reminder before anything is sent', async () => {
    perms.value = { 'fees.read': 'ALL', 'fees.manage': 'ALL' };
    api.collections.mockResolvedValue({ range: { from: 'x', to: 'y', days: 1 }, totals: { receipts: 0, collectedPaise: 0, refundsPaise: 0, netPaise: 0 }, pendingApproval: { count: 0, amountPaise: 0 }, byMode: [], byDay: [], byCashier: [], byHead: [], byClass: [], refunds: [], notes: [] });
    api.ageing.mockResolvedValue({ asOf: '2026-10-17', buckets: [{ key: '0-30', students: 1, amountPaise: 800000 }], totals: { students: 1, amountPaise: 800000 }, items: [{ enrollmentId: 'e1', studentId: 's1', name: 'Rahul Sharma', admissionNo: 'OAK-1', className: 'Class 6 A', outstandingPaise: 800000, oldestDue: '2026-09-27', daysOverdue: 20, bucket: '0-30', onPlan: false, lastPaidOn: null, invoices: [{ invoiceNo: 'INV-1001', duePaise: 800000, dueOn: '2026-09-27', daysOverdue: 20 }] }], total: 1 });
    api.reminderPreview.mockResolvedValue({ asOf: '2026-10-17', students: 1, withoutGuardian: 0, amountPaise: 800000, items: [{ studentId: 's1', name: 'Rahul Sharma', className: 'Class 6 A', outstandingPaise: 800000, oldestDue: '2026-09-27', daysOverdue: 20, guardians: 1 }], message: 'A fee payment is due on <oldest due date>.' });
    inApp(<FinanceReportsView />);
    fireEvent.click(screen.getByRole('tab', { name: /Overdue/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send reminders…' }));
    expect(await screen.findByRole('button', { name: 'Send to 1 family(ies)' })).toBeInTheDocument();
    expect(api.sendReminders).not.toHaveBeenCalled();
  });
});

describe('HR', () => {
  it('lists vacancies with the pipeline and candidates with scores', async () => {
    perms.value = { 'org.manage': 'ALL' };
    api.vacancies.mockResolvedValue({ items: [{ id: 'v1', refNo: 'VAC/2026/0001', title: 'TGT Mathematics', department: 'Academics', subject: null, employmentType: 'PERMANENT', positions: 1, childFacing: true, qualifications: 'B.Ed, CTET', salaryBand: null, closesOn: null, status: 'OPEN', createdBy: 'HR', pipeline: { INTERVIEW: 2 } }] });
    api.candidates.mockResolvedValue({ items: [{ id: 'c1', refNo: 'CAN/2026/0001', vacancyId: 'v1', vacancy: { refNo: 'VAC/2026/0001', title: 'TGT Mathematics', childFacing: true }, name: 'Kavya Rao', email: null, phone: null, source: null, experienceYears: 4, qualifications: 'M.Sc, B.Ed', expectedCtcPaise: null, noticeDays: null, stage: 'INTERVIEW', nextStages: ['OFFERED'], averageScore: 4.2, scores: [], offer: null, verificationCaseId: null, verificationStatus: null, rejectionReason: null, history: [] }] });
    inApp(<RecruitmentView />);
    expect(await screen.findByText('Kavya Rao')).toBeInTheDocument();
    expect(screen.getByText('4.2')).toBeInTheDocument();
    expect(screen.getAllByText('TGT Mathematics').length).toBeGreaterThan(0);
  });

  it('shows the full-and-final worksheet with its reasons', async () => {
    perms.value = { 'org.manage': 'ALL', 'payroll.sensitive.read': 'ALL', 'payroll.prepare': 'ALL' };
    const x = { id: 'x1', refNo: 'EXT/2026/0001', profileId: 'p9', name: 'Amit Joshi', kind: 'RESIGNATION', reason: null, noticeOn: '2026-10-01', lastWorkingDay: '2026-10-31', noticeDaysRequired: 30, noticeWaived: false, noticeServedDays: 31, clearances: [{ department: 'LIBRARY', status: 'CLEARED', duesPaise: 0, note: null, by: 'HR' }], clearancesPending: 0, exitInterview: null, payrollRunId: null, status: 'SETTLEMENT', history: [],
      settlement: { lastWorkingDay: '2026-10-31', joiningDate: '2019-06-01', serviceYears: 7.4, wagePaise: 3300000, grossMonthlyPaise: 4200000, lines: [{ name: 'Gratuity', amountPaise: 13326923, reason: '15/26 × ₹33,000 (basic + DA) × 7 year(s)' }], netPaise: 13326923, warnings: ['Salary for the days worked in the last month is paid in that month\'s regular run.'] } };
    api.exits.mockResolvedValue({ items: [x] });
    inApp(<StaffExitsView />);
    fireEvent.click(await screen.findByText('Amit Joshi'));
    expect(await screen.findByText(/15\/26 × ₹33,000/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Put on a full-and-final payroll run' })).toBeInTheDocument();
  });
});

describe('nurse', () => {
  it('shows a possible cluster with its visits, immunisations due and the register export', async () => {
    perms.value = { 'health.manage': 'ALL' };
    api.healthWatch.mockResolvedValue({ rules: { clusterWindowDays: 3, clusterThreshold: 3, frequentVisitsIn30Days: 4, immunisationAheadDays: 30 },
      clusters: [{ className: 'Class 6 A', category: 'FEVER', label: 'Fever / flu-like', children: 3, visits: 3, from: '2026-10-15', to: '2026-10-17', recent: true, suggestion: 'Check whether these children share a cause.', evidence: [{ ref: 'HV/2026/0009', student: 'Rahul Sharma', on: '2026-10-17', at: '10:20', outcome: 'SENT_HOME', complaint: 'High fever' }] }],
      frequentVisitors: [], immunisationsDue: [{ studentId: 's1', student: 'Priya Verma', className: 'Class 6 A', vaccine: 'Td', lastDose: '1', lastOn: '2016-01-01', nextDueOn: '2026-10-01', overdue: true }],
      screening: { academicYear: '2026-27', totalStudents: 4, screened: 1, byClass: [{ className: 'Class 6 A', students: 3, screened: 1, pct: 33 }], followUps: [] }, note: 'Prompts for the nurse.' });
    inApp(<HealthWatchView />);
    expect(await screen.findByText('Class 6 A: Fever / flu-like')).toBeInTheDocument();
    expect(screen.getByText(/HV\/2026\/0009 · Rahul Sharma/)).toBeInTheDocument();
    expect(screen.getByText(/Overdue/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download register (CSV)' })).toBeInTheDocument();
  });
});
