/**
 * Typed client for the part-4 student and alumnus features: alumni
 * certificate requests, the alumni "give back" board and the student planner.
 * The server enforces every rule (review before anyone sees an offer, students
 * never see an alumnus's contact, a former student's own record only).
 */
import { request } from './api';
import { qs, post, downloadCsv } from './ops-api';
import type { DocumentRequestDto, RequestableDocumentType } from './document-request-types';

type Q = Record<string, string | number | boolean | null | undefined>;
const get = <R>(path: string, params?: Q) => request<R>(`${path}${qs(params)}`);

export type OpportunityKind = 'CAREER_TALK' | 'MENTORING' | 'INTERNSHIP' | 'JOB' | 'SCHOLARSHIP' | 'VOLUNTEER';
export type OpportunityAudience = 'SENIOR_STUDENTS' | 'ALL_STUDENTS' | 'ALUMNI' | 'EVERYONE';
export const KIND_LABELS: Record<OpportunityKind, string> = {
  CAREER_TALK: 'Career talk', MENTORING: 'Mentoring', INTERNSHIP: 'Internship', JOB: 'Job', SCHOLARSHIP: 'Scholarship', VOLUNTEER: 'Volunteering',
};
export const AUDIENCE_LABELS: Record<OpportunityAudience, string> = {
  SENIOR_STUDENTS: 'Students in Classes 9–12', ALL_STUDENTS: 'All students', ALUMNI: 'Alumni', EVERYONE: 'Students and alumni',
};

export interface Opportunity {
  id: string; kind: OpportunityKind; kindLabel: string; title: string; description: string; organisation: string | null; location: string | null;
  mode: 'IN_PERSON' | 'ONLINE' | 'HYBRID'; applyBy: string | null; audience: OpportunityAudience; link: string | null;
  postedBy: string | null; batchLabel: string | null; status: string; createdAt: string; reviewNote: string | null;
  interestCount?: number; interested: boolean; mine: boolean;
  interests?: Array<{ name: string | null; roleKey: string | null; className: string | null; note: string | null; at: string }>;
}

export interface PlannerDto {
  student: { name: string; className: string | null; gradeNo: number | null; stage: string };
  window: { from: string; to: string; days: number };
  due: Array<{ id: string; title: string; subject: string | null; type: string; chapter: string | null; dueAt: string; daysLeft: number; status: string }>;
  overdue: Array<{ id: string; title: string; subject: string | null; dueAt: string; status: string }>;
  quizzes: Array<{ id: string; title: string; subject: string | null; durationMinutes: number | null; totalMarks: number }>;
  exams: Array<{ exam: string; subject: string | null; date: string; daysLeft: number; maxMarks: number }>;
  events: Array<{ title: string; type: string; startsAt: string; endsAt: string }>;
  strengths: Array<{ subject: string; percentage: number | null; papers: number }>;
  plan: { dailyMinutes: number; note: string; days: Array<{ date: string; dayOff: boolean; totalMinutes: number; blocks: Array<{ subject: string | null; minutes: number; kind: string; reason: string }> }> };
  board: null | { exam: string; guidance: string; checks: Array<{ key: string; label: string; value: string | null; missing: boolean }>; deadlines: Array<{ title: string; date: string }> };
}

export const p4Api = {
  certificateTypes: () => get<RequestableDocumentType[]>('/alumni-services/documents/types'),
  myCertificates: () => get<DocumentRequestDto[]>('/alumni-services/documents'),
  requestCertificate: (body: { documentTypeId: string; purpose: string; additionalInformation?: string; requiredBy?: string; fields?: Record<string, string> }) => post<DocumentRequestDto>('/alumni-services/documents', body),
  cancelCertificate: (id: string) => post<DocumentRequestDto>(`/alumni-services/documents/${id}/cancel`),
  downloadCertificate: (id: string, fileName: string) => downloadCsv(`/alumni-services/documents/${id}/file`, fileName),
  opportunities: (p: Q = {}) => get<Opportunity[]>('/alumni-services/opportunities', p),
  myOpportunities: () => get<Opportunity[]>('/alumni-services/opportunities/mine'),
  offer: (body: unknown) => post<Opportunity>('/alumni-services/opportunities', body),
  withdrawOffer: (id: string) => post<Opportunity>(`/alumni-services/opportunities/${id}/withdraw`),
  reviewOffer: (id: string, decision: 'PUBLISH' | 'REJECT', note?: string) => post<Opportunity>(`/alumni-services/opportunities/${id}/review`, { decision, note }),
  interest: (id: string, body: { note?: string; withdraw?: boolean } = {}) => post<Opportunity>(`/alumni-services/opportunities/${id}/interest`, body),
  planner: (p: Q = {}) => get<PlannerDto>('/student-planner/me', p),
};
