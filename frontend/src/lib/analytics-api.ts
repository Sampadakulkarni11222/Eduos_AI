/**
 * Typed client for the analytics workspace, quarterly reports, tasks and the
 * school's feature switches. Kept apart from ops-api.ts (other modules edit
 * that file); both share request() and its session handling.
 */
import { request } from './api';
import { downloadCsv, qs } from './ops-api';
import type { Attachment, HistoryEntry } from './ops-types';

type Q = Record<string, string | number | boolean | null | undefined>;
const get = <R>(path: string, params?: Q) => request<R>(`${path}${qs(params)}`);
const post = <R>(path: string, body: unknown = {}) => request<R>(path, { method: 'POST', body: JSON.stringify(body) });
const put = <R>(path: string, body: unknown = {}) => request<R>(path, { method: 'PUT', body: JSON.stringify(body) });

// ── analytics ──────────────────────────────────────────────────────────

export type MetricUnit = 'count' | 'percent' | 'paise' | 'days';
export type Coverage = 'FULL' | 'PARTIAL' | 'NONE' | 'ERROR';

export interface PeriodDto { from: string; to: string; start: string; end: string; days: number; label: string; tz: string; partial: boolean }
export interface BreakdownItem { label: string; value: number | null; of?: number; count?: number }
export interface MetricValue { value: number | null; records: number; coverage: Coverage; note: string | null; detail?: Record<string, unknown> | null; breakdown?: BreakdownItem[] | null }
export interface ChangeDto { current: number | null; previous: number | null; abs: number | null; pct: number | null; comparable: boolean; reason: string | null }
export interface TrendDto { unit: 'day' | 'week' | 'month'; points: Array<{ label: string; from: string; to: string; value: number | null }> }
export interface MetricDto {
  key: string; department: string; label: string; definition: string; numerator: string | null; denominator: string | null;
  unit: MetricUnit; kind: 'flow' | 'stock'; dateBasis: string; sources: string[]; link: string | null; version: number;
  headline: boolean; trend: TrendDto | null | boolean; currentOnly: boolean; history: string; scope: string; currency: string | null;
  current: MetricValue; comparison: MetricValue | null; change: ChangeDto | null;
}
export interface DepartmentDto { key: string; label: string }
export interface OverviewDto {
  period: PeriodDto; comparison: PeriodDto | null; compare: string; department: string; currency: string;
  departments: DepartmentDto[]; scope: { level: 'ALL' | 'OWN'; departments: string[]; classes: number | null };
  metrics: MetricDto[]; computedAt: string; cutoff: string; catalogueVersion: string; freshness: string;
}
export interface OverviewQuery { preset: string; from?: string; to?: string; compare: string; compareFrom?: string; compareTo?: string; department: string }

// ── quarterly reports ──────────────────────────────────────────────────

export interface ReportMetric {
  key: string; label: string; department: string; unit: MetricUnit; currency: string | null; definition: string; value: number | null; coverage: Coverage; note: string | null;
  priorQuarter: { value: number | null; change: ChangeDto } | null; lastYear: { value: number | null; change: ChangeDto } | null;
}
export interface ReportSummaryDto {
  id: string; quarterKey: string; label: string; version: number; status: 'GENERATING' | 'GENERATED' | 'FAILED'; trigger: 'SCHEDULED' | 'MANUAL';
  reason: string | null; generatedAt: string | null; error: string | null; latest?: boolean; period: { from: string; to: string };
}
export interface ReportDto extends ReportSummaryDto {
  figures: null | {
    quarter: { key: string; label: string; from: string; to: string }; cutoff: string; currency: string; timezone: string;
    summary: ReportMetric[] | null; sections: Array<{ key: string; label: string; metrics: ReportMetric[] }>;
    budget: null | { fiscalYear: string; currency: string; basis: string; available: boolean; lines: Array<{ code: string; head: string; plannedPaise: number; committedPaise: number; actualPaise: number; variancePaise: number }>; totals: { plannedPaise: number; committedPaise: number; actualPaise: number; variancePaise: number } };
    renewals: null | { items: Array<{ title: string; department: string; dueAt: string; amountPaise: number | null; owner: string; overdue: boolean }>; totals: { count: number; overdue: number; forecastPaise: number } };
    achievements: Array<{ title: string; at: string }> | null;
    decisions: null | { approvals: Array<{ category: string; count: number; oldestDue: string | null }>; actions: Array<{ title: string; owner: string; reviewBy: string }> };
    missing: Array<{ key: string; label: string; note: string | null }> | null;
  };
}
export interface DeliveryDto { id: string; recipientName: string; roleKey: string; status: string; attempts: number; sentAt: string | null; lastError: string | null }

// ── tasks ──────────────────────────────────────────────────────────────

export interface TaskDto {
  id: string; refNo: string; title: string; description: string; department: string; category: string; severity: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED' | 'DONE' | 'CANCELLED'; dueAt: string; overdue: boolean; daysLeft: number;
  ownerProfileId: string | null; ownerName: string | null; delegateName: string | null; amountPaise: number | null; currency: string;
  snoozedUntil: string | null; snoozeReason: string | null; requiresEvidence: boolean; evidence: Attachment[]; history: HistoryEntry[];
  source?: { entityType: string | null; link: string | null };
}
export interface TaskSummaryDto {
  total: { open: number; overdue: number; week: number; month: number; quarterCostPaise: number; critical: number; unassigned: number };
  byDepartment: Array<{ department: string; open: number; overdue: number; week: number; month: number; quarterCostPaise: number }>;
  asOf: string; definition: string;
}
export const TASK_DEPARTMENTS = ['ADMINISTRATION', 'FINANCE', 'ACADEMICS', 'LABS', 'TRANSPORT', 'FACILITIES', 'COMPLIANCE', 'HR', 'HOSTEL', 'LIBRARY', 'ENGAGEMENT', 'SUSTAINABILITY', 'HEALTH', 'IT', 'OTHER'];
export const TASK_CATEGORIES = ['BILL', 'LICENCE', 'SERVICE', 'INSPECTION', 'VEHICLE_CHECK', 'LAB_EXPIRY', 'CALIBRATION', 'SANITATION', 'WATER_TEST', 'TRAINING', 'PTM_FOLLOWUP', 'RENEWAL', 'MAINTENANCE', 'OTHER'];

// ── features ───────────────────────────────────────────────────────────

export interface FeatureDto { key: string; label: string; enabled: boolean; default: boolean; needs: string | null }

const clean = (q: OverviewQuery): Q => ({ ...q, from: q.preset === 'custom' ? q.from : undefined, to: q.preset === 'custom' ? q.to : undefined, compareFrom: q.compare === 'custom' ? q.compareFrom : undefined, compareTo: q.compare === 'custom' ? q.compareTo : undefined });

export const analyticsApi = {
  overview: (q: OverviewQuery) => get<OverviewDto>('/analytics/overview', clean(q)),
  exportCsv: (q: OverviewQuery) => downloadCsv(`/analytics/export.csv${qs(clean(q))}`, `analytics-${q.department}.csv`),

  reports: () => get<{ items: ReportSummaryDto[]; total: number }>('/analytics/reports', { pageSize: 100 }),
  report: (id: string) => get<ReportDto>(`/analytics/reports/${id}`),
  regenerate: (body: { quarter?: string; reason?: string }) => post<ReportDto>('/analytics/reports/generate', body),
  deliveries: (id: string) => get<DeliveryDto[]>(`/analytics/reports/${id}/deliveries`),
  retryDeliveries: (id: string) => post<{ sent: number; failed: number; revoked: number }>(`/analytics/reports/${id}/deliver`),
  downloadReport: (r: ReportSummaryDto, kind: 'pdf' | 'csv') => downloadCsv(`/analytics/reports/${r.id}/download.${kind}`, `quarterly-${r.quarterKey}-v${r.version}.${kind}`),

  tasks: (p: Q) => get<{ items: TaskDto[]; total: number; page: number; pageSize: number }>('/tasks', p),
  taskSummary: () => get<TaskSummaryDto>('/tasks/summary'),
  createTask: (body: unknown) => post<TaskDto>('/tasks', body),
  acknowledgeTask: (id: string) => post<TaskDto>(`/tasks/${id}/acknowledge`),
  snoozeTask: (id: string, until: string, reason: string) => post<TaskDto>(`/tasks/${id}/snooze`, { until, reason }),
  completeTask: (id: string, note: string, evidence: Array<{ name: string; url: string }>) => post<TaskDto>(`/tasks/${id}/complete`, { note, evidence }),
  reassignTask: (id: string, ownerProfileId: string, note?: string) => post<TaskDto>(`/tasks/${id}/reassign`, { ownerProfileId, note }),
  cancelTask: (id: string, reason: string) => post<TaskDto>(`/tasks/${id}/cancel`, { reason }),

  features: () => get<FeatureDto[]>('/institution/features'),
  setFeatures: (changes: Record<string, boolean>) => put<FeatureDto[]>('/institution/features', changes),
};
