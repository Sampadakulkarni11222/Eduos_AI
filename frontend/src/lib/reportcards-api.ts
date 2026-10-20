/**
 * Typed client for term report cards (backend modules/reportcards).
 */
import { request, fileHref } from './api';
import { getActingSchool } from './acting-school';
import { qs, post, patch } from './ops-api';
import type { HistoryEntry } from './ops-types';

type Q = Record<string, string | number | boolean | null | undefined>;
const get = <R>(path: string, params?: Q) => request<R>(`${path}${qs(params)}`);

export interface RcTemplate {
  id: string; name: string; board: string; terms: Array<{ key: string; name: string; components: Array<{ key: string; label: string; maxMarks: number; source: 'EXAM' | 'MANUAL'; examName: string | null }> }>;
  coScholasticAreas: Array<{ key: string; label: string }>; coScholasticGrades: string[]; disciplineLabel: string; passPercent: number; finalTermKey: string | null;
}
export interface RcCell { value: number | null; status: 'OK' | 'PENDING' | 'NO_EXAM' | 'ABSENT'; absence?: string | null; maxMarks: number; raw?: string }
export interface RcRow { subjectOfferingId: string; subject: string; components: Record<string, RcCell>; total: number; maxMarks: number; percentage: number | null; grade: string | null; complete: boolean; passed: boolean | null }
export interface RcCard {
  id: string; templateId: string; templateName: string | null; termKey: string; termName: string; studentId: string; studentName: string; admissionNo: string | null; rollNo: number | null;
  sectionId: string; className: string | null; status: 'DRAFT' | 'CLASS_TEACHER_APPROVED' | 'PRINCIPAL_APPROVED' | 'PUBLISHED';
  components: Array<{ key: string; label: string; maxMarks: number; source: 'EXAM' | 'MANUAL' }>; scholastic: RcRow[];
  summary: { total: number; maxMarks: number; percentage: number | null; grade: string | null; complete: boolean; pendingSubjects: string[]; belowPass: string[] } | null;
  resultLine: string | null; coScholasticAreas: Array<{ key: string; label: string }>; coScholasticGrades: string[]; coScholastic: Record<string, string | null>;
  disciplineLabel: string; discipline: string | null; classTeacherRemarks: string | null;
  attendance: { workingDays: number; present: number; percentage: number | null } | null; manualMarks: Record<string, Record<string, number | null>>;
  publishedVersion: number; publishedAt: string | null; history?: HistoryEntry[]; version?: number; correctionNote?: string | null;
}
export interface RcPublished { versionId: string; cardId: string; version: number; publishedAt: string; correctionNote: string | null; card: RcCard; olderVersions: Array<{ versionId: string; version: number; publishedAt: string; supersededAt: string | null }> }

export const reportCardsApi = {
  templates: () => get<RcTemplate[]>('/report-cards/templates'),
  sections: () => get<Array<{ id: string; label: string; role: 'ALL' | 'CLASS_TEACHER' | 'SUBJECT_TEACHER' }>>('/report-cards/sections'),
  list: (p: Q) => get<RcCard[]>('/report-cards', p),
  get: (id: string) => get<RcCard>(`/report-cards/${id}`),
  generate: (body: { sectionId: string; termKey: string; templateId?: string }) => post<{ created: number; refreshed: number; students: number }>('/report-cards/generate', body),
  update: (id: string, body: Record<string, unknown>) => patch<RcCard>(`/report-cards/${id}`, body),
  moderate: (id: string, stage: 'CLASS_TEACHER' | 'PRINCIPAL', extra: Record<string, unknown> = {}) => post<RcCard>(`/report-cards/${id}/moderate`, { stage, ...extra }),
  returnToDraft: (id: string, reason: string) => post<RcCard>(`/report-cards/${id}/return`, { reason }),
  publish: (id: string, correctionNote?: string) => post<RcCard>(`/report-cards/${id}/publish`, { correctionNote }),
  bulk: (body: { action: 'CLASS_TEACHER_APPROVE' | 'PRINCIPAL_APPROVE' | 'PUBLISH'; sectionId: string; termKey: string; templateId?: string; allowIncomplete?: boolean; correctionNote?: string }) =>
    post<{ done: number; failed: Array<{ id: string; reason: string }> }>('/report-cards/bulk', body),
  published: (p: Q = {}) => get<RcPublished[]>('/report-cards/published', p),
  version: (id: string) => get<{ versionId: string; version: number; card: RcCard }>(`/report-cards/versions/${id}`),
};

/** Opens a published version's PDF in a new tab, fetched with the session (never a URL carrying a token). */
export async function openReportCardPdf(versionId: string) {
  const { getAccessToken } = await import('./api');
  const acting = getActingSchool();
  const tab = window.open('about:blank', '_blank');
  try {
    const res = await fetch(fileHref(`/api/v1/report-cards/versions/${versionId}/pdf`), {
      headers: { ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}), ...(acting ? { 'X-School-Id': acting.slug } : {}) },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.message ?? `Could not open the PDF (${res.status})`);
    }
    const url = URL.createObjectURL(await res.blob());
    if (tab) { tab.opener = null; tab.location.href = url; } else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    tab?.close();
    throw err;
  }
}
