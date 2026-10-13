/**
 * Typed client for the institution-operations APIs (approvals, administration,
 * finance operations, marketing, community, campus). Kept apart from api.ts,
 * which serves the original modules; both share the same request() and its
 * token refresh, cache invalidation and error shape.
 */
import { request } from './api';
import type * as T from './ops-types';

const qs = (params: Record<string, string | number | boolean | null | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};
const post = <R>(path: string, body: unknown = {}) => request<R>(path, { method: 'POST', body: JSON.stringify(body) });
const put = <R>(path: string, body: unknown = {}) => request<R>(path, { method: 'PUT', body: JSON.stringify(body) });
const patch = <R>(path: string, body: unknown = {}) => request<R>(path, { method: 'PATCH', body: JSON.stringify(body) });
const del = <R>(path: string) => request<R>(path, { method: 'DELETE' });

export const opsApi = {
  // ── attendance flashcard drafts ──
  attendanceDraft: (sectionId: string, date: string, periodNo: number | null) =>
    request<T.AttendanceDraftDto | null>(`/attendance/drafts${qs({ sectionId, date, periodNo })}`),
  saveAttendanceDraft: (body: { sectionId: string; date: string; periodNo: number | null; version: number; cursor: number; entries: Array<{ enrollmentId: string; status: string | null; passed: boolean }> }) =>
    put<T.AttendanceDraftDto>('/attendance/drafts', body),
  discardAttendanceDraft: (sectionId: string, date: string, periodNo: number | null) =>
    del<{ deleted: number }>(`/attendance/drafts${qs({ sectionId, date, periodNo })}`),
};

export { qs, post, put, patch, del };
