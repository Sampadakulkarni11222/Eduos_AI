/**
 * Part 4 (finance, HR, nurse audit): collections reports and the day-end cash
 * close, recruitment, staff exits, and the nurse's watch list.
 */
import { request } from './api';
import { qs, post, downloadCsv } from './ops-api';
import type { HistoryEntry } from './ops-types';

type Q = Record<string, string | number | boolean | null | undefined>;
const get = <R>(path: string, params?: Q) => request<R>(`${path}${qs(params)}`);

export interface Bucket { key: string; label: string; count: number; amountPaise: number }
export interface CollectionReport {
  range: { from: string; to: string; days: number };
  totals: { receipts: number; collectedPaise: number; refundsPaise: number; netPaise: number };
  pendingApproval: { count: number; amountPaise: number };
  byMode: Bucket[]; byDay: Bucket[]; byCashier: Bucket[]; byHead: Bucket[]; byClass: Bucket[];
  refunds: Array<{ receiptNo: string | null; voucherNo: string | null; amountPaise: number; mode: string; on: string; reason: string }>;
  notes: string[];
}
export interface AgeingRow { enrollmentId: string; studentId: string; name: string; admissionNo: string | null; className: string; outstandingPaise: number; oldestDue: string; daysOverdue: number; bucket: string; onPlan: boolean; lastPaidOn: string | null; invoices: Array<{ invoiceNo: string; duePaise: number; dueOn: string; daysOverdue: number }> }
export interface Ageing { asOf: string; buckets: Array<{ key: string; students: number; amountPaise: number }>; totals: { students: number; amountPaise: number }; items: AgeingRow[]; total: number }
export interface ReminderPreview { asOf: string; students: number; withoutGuardian: number; amountPaise: number; items: Array<{ studentId: string; name: string; className: string; outstandingPaise: number; oldestDue: string; daysOverdue: number; guardians: number }>; message: string }
export interface Flag { rule: string; title: string; why: string; count: number; evidence: Array<Record<string, string | number | null>> }
export interface Anomalies { range: { from: string; to: string }; checked: number; flags: Flag[]; note: string }
export interface CashClose { id: string; day: string; status: 'CLOSED' | 'CHECKED'; counts: Array<{ denominationPaise: number; count: number }>; countedPaise: number; openingFloatPaise: number; expectedCashPaise: number; cashRefundsPaise: number; variancePaise: number; receiptCount: number; depositSlipNo: string | null; note: string | null; closedBy: string | null; closedAt: string | null; checkedBy: string | null; checkedAt: string | null; history: HistoryEntry[] }
export interface CashExpected { day: string; cashReceipts: number; cashInPaise: number; cashRefundsPaise: number; expectedCashPaise: number; awaitingApproval: number; nonCash: Record<string, { count: number; amountPaise: number }>; denominations: number[]; existing: CashClose | null }

export interface Vacancy { id: string; refNo: string; title: string; department: string | null; subject: string | null; employmentType: string; positions: number; childFacing: boolean; qualifications: string | null; salaryBand: string | null; closesOn: string | null; status: string; createdBy: string | null; pipeline: Record<string, number> }
export interface Candidate {
  id: string; refNo: string; vacancyId: string; vacancy: { refNo: string; title: string; childFacing: boolean } | null; name: string; email: string | null; phone: string | null; source: string | null;
  experienceYears: number | null; qualifications: string | null; expectedCtcPaise: number | null; noticeDays: number | null; stage: string; nextStages: string[]; averageScore: number | null;
  scores: Array<{ id: string; by: string | null; stage: string; total: number; recommendation: string; note: string | null }>;
  offer: { ctcPaise: number | null; joiningOn: string | null; letterText: string | null } | null; verificationCaseId: string | null; verificationStatus: string | null; rejectionReason: string | null; history: HistoryEntry[];
}
export interface ExitCase {
  id: string; refNo: string; profileId: string; name: string; kind: string; reason: string | null; noticeOn: string; lastWorkingDay: string; noticeDaysRequired: number; noticeWaived: boolean; noticeServedDays: number;
  clearances: Array<{ department: string; status: string; duesPaise: number; note: string | null; by: string | null }>; clearancesPending: number;
  exitInterview: { at: string; note: string } | null; settlement: Settlement | null; payrollRunId: string | null; status: string; history: HistoryEntry[];
}
export interface Settlement { lastWorkingDay: string; joiningDate: string; serviceYears: number; wagePaise: number; grossMonthlyPaise: number; lines: Array<{ name: string; amountPaise: number; reason: string }>; netPaise: number; warnings: string[] }
export interface HealthWatch {
  rules: { clusterWindowDays: number; clusterThreshold: number; frequentVisitsIn30Days: number; immunisationAheadDays: number };
  clusters: Array<{ className: string; category: string; label: string; children: number; visits: number; from: string; to: string; recent: boolean; suggestion: string; evidence: Array<{ ref: string; student: string; on: string; at: string; outcome: string; complaint: string }> }>;
  frequentVisitors: Array<{ studentId: string; student: string; className: string; visits: number; sentHome: number; lastOn: string; complaints: string[]; suggestion: string }>;
  immunisationsDue: Array<{ studentId: string; student: string; className: string; vaccine: string; lastDose: string | null; lastOn: string; nextDueOn: string; overdue: boolean }>;
  screening: { academicYear: string; totalStudents: number; screened: number; byClass: Array<{ className: string; students: number; screened: number; pct: number }>; followUps: Array<{ studentId: string; student: string; className: string; on: string; reasons: string[] }> };
  note: string;
}

export const p4Api = {
  collections: (p: Q) => get<CollectionReport>('/finance-reports/collections', p),
  downloadDayBook: (p: { from: string; to: string }) => downloadCsv(`/finance-reports/day-book.csv${qs(p)}`, `day-book-${p.from}-to-${p.to}.csv`),
  ageing: (p: Q) => get<Ageing>('/finance-reports/ageing', p),
  downloadAgeing: (p: Q) => downloadCsv(`/finance-reports/ageing.csv${qs(p)}`, 'fee-ageing.csv'),
  anomalies: (p: Q) => get<Anomalies>('/finance-reports/anomalies', p),
  reminderPreview: (b: Q) => post<ReminderPreview>('/finance-reports/reminders/preview', b),
  sendReminders: (b: Q) => post<{ sent: number; students: number; skippedNoGuardian: number }>('/finance-reports/reminders/send', b),
  cashCloses: () => get<{ items: CashClose[] }>('/finance-reports/cash-close'),
  cashExpected: (day?: string) => get<CashExpected>('/finance-reports/cash-close/expected', { day }),
  closeDay: (b: unknown) => post<CashClose>('/finance-reports/cash-close', b),
  checkClose: (id: string, note?: string) => post<CashClose>(`/finance-reports/cash-close/${id}/check`, { note }),

  vacancies: (p: Q = {}) => get<{ items: Vacancy[] }>('/recruitment/vacancies', p),
  createVacancy: (b: unknown) => post<Vacancy>('/recruitment/vacancies', b),
  vacancyStatus: (id: string, status: string) => post<Vacancy>(`/recruitment/vacancies/${id}/status`, { status }),
  candidates: (p: Q = {}) => get<{ items: Candidate[] }>('/recruitment/candidates', p),
  addCandidate: (b: unknown) => post<Candidate>('/recruitment/candidates', b),
  moveCandidate: (id: string, stage: string, note?: string) => post<Candidate>(`/recruitment/candidates/${id}/stage`, { stage, note }),
  scoreCandidate: (id: string, b: unknown) => post<Candidate>(`/recruitment/candidates/${id}/scores`, b),
  draftOffer: (id: string, b: unknown) => post<{ candidate: Candidate; letter: string; note: string }>(`/recruitment/candidates/${id}/offer`, b),
  startVerification: (id: string) => post<{ verification: { refNo: string } }>(`/recruitment/candidates/${id}/verification`, {}),

  exits: (p: Q = {}) => get<{ items: ExitCase[] }>('/exits', p),
  startExit: (b: unknown) => post<ExitCase>('/exits', b),
  clearance: (id: string, b: unknown) => post<ExitCase>(`/exits/${id}/clearance`, b),
  interview: (id: string, note: string) => post<ExitCase>(`/exits/${id}/interview`, { note }),
  settlement: (id: string, b: unknown = {}) => post<{ exit: ExitCase; settlement: Settlement }>(`/exits/${id}/settlement`, b),
  settlementToPayroll: (id: string) => post<{ run: { refNo: string } }>(`/exits/${id}/settlement/payroll`, {}),
  letters: (id: string) => get<{ relieving: string; experience: string; note: string }>(`/exits/${id}/letters`),
  closeExit: (id: string, withdraw = false) => post<ExitCase>(`/exits/${id}/close`, { withdraw }),

  healthWatch: () => get<HealthWatch>('/health-insights'),
  downloadRegister: (p: { from: string; to: string }) => downloadCsv(`/health-insights/register.csv${qs(p)}`, `health-register-${p.from}-to-${p.to}.csv`),
};
