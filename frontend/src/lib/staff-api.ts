/**
 * Typed client for staff leave balances and substitute cover (backend modules/staff).
 */
import { request } from './api';
import { qs, post, put } from './ops-api';
import type { HistoryEntry } from './ops-types';

type Q = Record<string, string | number | boolean | null | undefined>;
const get = <R>(path: string, params?: Q) => request<R>(`${path}${qs(params)}`);

export interface LeavePolicy { code: string; name: string; yearlyDays: number; carryForwardMax: number; allowHalfDay: boolean; paid: boolean; tracksBalance: boolean; documentAfterDays: number | null; note: string | null; active: boolean }
export interface LeaveBalanceRow { code: string; name: string; tracksBalance: boolean; paid: boolean; allowHalfDay: boolean; entitled: number; carriedForward: number; used: number; pending: number; available: number | null; availableAfterPending: number | null; set: boolean }
export interface StaffLeave {
  id: string; refNo: string; profileId: string; name: string | null; code: string; leaveYear: string; fromDate: string; toDate: string; halfDay: string | null; days: number;
  reason: string; status: string; decidedAt: string | null; decisionNote: string | null; decidedByName: string | null; createdAt: string; history: HistoryEntry[];
}
export interface CoverLesson { slotId: string; sectionId: string; className: string; periodNo: number; startTime: string; endTime: string; room: string | null; subject: string | null; teacherId: string | null; cover: { id: string; substituteProfileId: string; substituteName: string | null } | null }
export interface CoverNeeds {
  date: string; rules: { maxPerDay: number; maxPerWeek: number };
  absent: Array<{ profileId: string; name: string | null; half: string | null; source: 'LEAVE' | 'ABSENCE'; ref: string | null; code?: string; reason?: string | null; periods: CoverLesson[]; uncovered: number }>;
  totals: { absentTeachers: number; periods: number; uncovered: number };
}
export interface CoverCandidate { profileId: string; name: string; eligible: boolean; blocked: string[]; overLimit: boolean; sameSubject: boolean; sameClass: boolean; lessonsToday: number; coversToday: number; coversThisWeek: number }
export interface CoverDto { id: string; date: string; sectionId: string; className: string | null; periodNo: number; startTime: string; endTime: string; room: string | null; status: string; absentName: string | null; substituteName: string | null; note: string | null }

export const staffApi = {
  policies: () => get<LeavePolicy[]>('/staff/leave/policies'),
  setPolicy: (code: string, body: Partial<LeavePolicy>) => put<LeavePolicy>(`/staff/leave/policies/${code}`, body),
  balance: (p: Q = {}) => get<{ profileId: string; leaveYear: string; balances: LeaveBalanceRow[] }>('/staff/leave/balance', p),
  allBalances: (p: Q = {}) => get<{ leaveYear: string; people: Array<{ profileId: string; name: string | null; balances: Record<string, { entitled: number; carriedForward: number; used: number; available: number }> }> }>('/staff/leave/balances', p),
  initBalances: (leaveYear?: string) => post<{ leaveYear: string; people: number; created: number }>('/staff/leave/balances/init', { leaveYear }),
  leaves: (p: Q = {}) => get<StaffLeave[]>('/staff/leave', p),
  apply: (body: { code: string; fromDate: string; toDate?: string; halfDay?: string | null; reason: string }) => post<StaffLeave>('/staff/leave', body),
  decide: (id: string, action: 'APPROVE' | 'REJECT', note?: string) => post<StaffLeave>(`/staff/leave/${id}/decide`, { action, note }),
  cancel: (id: string, reason: string) => post<StaffLeave>(`/staff/leave/${id}/cancel`, { reason }),
  lop: (from: string, to: string) => get<{ from: string; to: string; inputs: Array<{ profileId: string; name: string | null; lopDays: number; sources: string[] }>; payrollBody: unknown; definition: string }>('/staff/leave/lop', { from, to }),

  needs: (date: string) => get<CoverNeeds>('/staff/cover/needs', { date }),
  candidates: (date: string, sectionId: string, periodNo: number) => get<{ lesson: CoverLesson; rules: { maxPerDay: number; maxPerWeek: number }; candidates: CoverCandidate[] }>('/staff/cover/candidates', { date, sectionId, periodNo }),
  assign: (body: { date: string; sectionId: string; periodNo: number; substituteProfileId: string; note?: string; overrideReason?: string }) => post<CoverDto>('/staff/cover', body),
  cancelCover: (id: string, reason: string) => post<CoverDto>(`/staff/cover/${id}/cancel`, { reason }),
  markAbsent: (body: { profileId: string; date: string; halfDay?: string | null; reason?: string; lop?: boolean }) => post<unknown>('/staff/cover/absences', body),
  absences: (date: string) => get<Array<{ id: string; profileId: string; name: string | null; date: string; halfDay: string | null; reason: string | null; lop: boolean }>>('/staff/cover/absences', { date }),
  withdrawAbsence: (id: string) => post<unknown>(`/staff/cover/absences/${id}/withdraw`),
  rules: () => get<{ maxPerDay: number; maxPerWeek: number }>('/staff/cover/rules'),
  setRules: (body: { maxPerDay?: number; maxPerWeek?: number }) => put<{ maxPerDay: number; maxPerWeek: number }>('/staff/cover/rules', body),
  myCovers: () => get<CoverDto[]>('/staff/cover/mine'),
  coverFor: (date?: string) => get<{ date: string; covers: Array<{ key: string; sectionId: string; className: string | null; periodNo: number; substituteName: string | null; absentName: string | null }> }>('/staff/cover/for', { date }),
};
