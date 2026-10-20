/**
 * Typed client for the role dashboards (GET /insights/dashboard). Kept apart
 * from ops-api.ts, which other modules edit.
 */
import { request } from './api';

export type DashUnit = 'count' | 'percent' | 'paise' | 'days';
export type DashTone = 'good' | 'warn' | 'bad' | 'neutral' | 'muted';
export interface DashPoint { label: string; value: number | null; detail?: string; tone?: DashTone; link?: string }
export interface DashSeries { label: string; points: Array<{ label: string; value: number | null }> }
export interface DashVariant { key: string; label: string; points: DashPoint[]; compare?: DashSeries | null }
export interface DashChartDto {
  key: string; title: string; type: 'line' | 'bar' | 'hbar' | 'donut' | 'funnel' | 'ageing'; unit: DashUnit;
  link: string | null; definition: string; points: DashPoint[];
  compare?: DashSeries | null; variants?: DashVariant[] | null; compareNote?: string | null; footnote?: string | null;
  status: 'OK' | 'EMPTY'; emptyText: string;
}
export interface DashKpi { key: string; label: string; value: number | null; unit: DashUnit; detail: string | null; link: string | null; tone: DashTone; spark?: Array<number | null> | null }
export interface DashListItem { text: string; sub?: string; link?: string; href?: string | null; tone?: DashTone; badge?: string; start?: string; end?: string }
export interface DashList { key: string; title: string; link: string | null; items: DashListItem[]; empty: string }
export interface RoleDashboardDto {
  view: 'teacher' | 'parent' | 'student' | 'finance' | 'hr' | 'librarian' | 'warden' | 'marketing' | 'compliance' | 'trustee' | 'nurse' | null;
  title?: string;
  period: { days: number; options: Array<{ days: number; label: string }> };
  children?: Array<{ id: string; name: string; className: string }>;
  child?: { id: string; name: string; className: string; classSize: number | null };
  kpis: DashKpi[]; charts: DashChartDto[]; lists: DashList[]; notes: string[]; asOf: string;
}

const qs = (p: Record<string, string | number | null | undefined>) => {
  const s = Object.entries(p).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  return s ? `?${s}` : '';
};

export const dashboardApi = {
  get: (q: { days?: number | null; child?: string | null } = {}) => request<RoleDashboardDto>(`/insights/dashboard${qs({ days: q.days, child: q.child })}`),
};
