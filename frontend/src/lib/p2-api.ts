/**
 * Typed client for student support plans, competency portfolios, scenario
 * planning and the teacher presence board (backend modules/support,
 * modules/portfolios, modules/scenarios, modules/safety camera.service).
 */
import { request, fileHref, getAccessToken } from './api';
import { qs, post, patch, put, del } from './ops-api';
import { getActingSchool } from './acting-school';

type Q = Record<string, string | number | boolean | null | undefined>;
const get = <R>(path: string, params?: Q) => request<R>(`${path}${qs(params)}`);

// ── support plans ──────────────────────────────────────────────────────
export const CONCERN_AREAS = [
  { key: 'ACADEMIC', label: 'Academic' },
  { key: 'ATTENDANCE', label: 'Attendance' },
  { key: 'WELLBEING_REFERRAL', label: 'Wellbeing referral' },
  { key: 'LEARNING_NEEDS', label: 'Learning needs' },
] as const;
export const GOAL_STATUSES = ['OPEN', 'ON_TRACK', 'AT_RISK', 'MET', 'NOT_MET'] as const;
export const PLAN_OUTCOMES = ['GOALS_MET', 'PARTLY_MET', 'NOT_MET', 'MOVED_TO_OTHER_SUPPORT', 'LEFT_SCHOOL', 'OTHER'] as const;

export interface PlanGoal { id: string; title: string; measure: string; unit: string | null; baseline: number | null; target: number; direction?: string; reviewOn: string; status: string; latest: { at: string; value: number | null; note?: string | null } | null; progress?: Array<{ at: string; value: number | null; note: string | null; byName: string | null }> }
export interface PlanAction { id: string; title: string; ownerKind: string; ownerProfileId: string | null; ownerName: string | null; dueOn: string | null; status: string; overdue?: boolean }
export interface PlanReview { id: string; at: string; byName: string | null; familySummary: string; internalNote: string | null; nextReviewOn: string | null }
export interface SupportPlanDto {
  id: string; refNo: string; studentId: string; studentName: string; className: string | null; concernArea: string; areaLabel: string; summary: string; status: string;
  ownerProfileId: string; ownerName: string | null; nextReviewOn: string | null; reviewOverdue?: boolean;
  source: { kind: string; riskType: string | null; riskLevel: string | null; figures: Array<{ label: string; value: string }> };
  goals: PlanGoal[]; actions: PlanAction[]; reviews: PlanReview[];
  internalNotes?: Array<{ at: string; byName: string; text: string }>;
  family: { sharedAt: string | null; acknowledgedAt: string | null; comment: string | null };
  referral?: { referred: boolean; at: string | null };
  closure: { closedAt: string | null; outcome: string | null; note: string | null };
  signalsNow?: Array<{ label: string; value: string }>;
  history?: Array<{ at: string; action: string; actorName: string | null; note: string | null; from: string | null; to: string | null }>;
}
export interface FamilyPlanDto { id: string; refNo: string; studentName: string; className: string | null; areaLabel: string; summary: string; status: string; ownerName: string | null; nextReviewOn: string | null; goals: PlanGoal[]; familyActions: Array<{ id: string; title: string; ownerKind: string; dueOn: string | null; status: string }>; reviews: Array<{ at: string; byName: string | null; summary: string }>; acknowledgedAt: string | null; comment: string | null; closure: { closedAt: string | null; outcome: string | null } | null }
export interface PlanSuggestion { studentId: string; studentName: string; className: string | null; riskType: string; level: string; concernArea: string; evidence: { label: string } | null }

export const supportApi = {
  list: (p: Q = {}) => get<{ items: SupportPlanDto[]; summary: { active: number; closed: number; reviewOverdue: number; byArea: Record<string, number> } }>('/support-plans', p),
  family: () => get<{ items: FamilyPlanDto[] }>('/support-plans/family'),
  acknowledge: (id: string, comment: string) => post<FamilyPlanDto>(`/support-plans/family/${id}/acknowledge`, { comment }),
  suggestions: (refresh = false) => get<{ items: PlanSuggestion[]; note: string }>('/support-plans/suggestions', refresh ? { refresh: 1 } : {}),
  get: (id: string) => get<SupportPlanDto>(`/support-plans/${id}`),
  create: (body: unknown) => post<SupportPlanDto>('/support-plans', body),
  update: (id: string, body: unknown) => patch<SupportPlanDto>(`/support-plans/${id}`, body),
  addGoal: (id: string, body: unknown) => post<SupportPlanDto>(`/support-plans/${id}/goals`, body),
  progress: (id: string, goalId: string, body: unknown) => post<SupportPlanDto>(`/support-plans/${id}/goals/${goalId}/progress`, body),
  addAction: (id: string, body: unknown) => post<SupportPlanDto>(`/support-plans/${id}/actions`, body),
  completeAction: (id: string, actionId: string, body: unknown = {}) => post<SupportPlanDto>(`/support-plans/${id}/actions/${actionId}/complete`, body),
  addNote: (id: string, text: string) => post<SupportPlanDto>(`/support-plans/${id}/notes`, { text }),
  review: (id: string, body: unknown) => post<SupportPlanDto>(`/support-plans/${id}/reviews`, body),
  share: (id: string) => post<SupportPlanDto>(`/support-plans/${id}/share`),
  referral: (id: string) => post<SupportPlanDto>(`/support-plans/${id}/referral`),
  close: (id: string, body: unknown) => post<SupportPlanDto>(`/support-plans/${id}/close`, body),
  reopen: (id: string, body: unknown) => post<SupportPlanDto>(`/support-plans/${id}/reopen`, body),
};

// ── competency portfolios ──────────────────────────────────────────────
export interface PortfolioEvidenceDto { id?: string; kind: string; auto: boolean; title: string; detail?: string | null; description?: string | null; on: string | null; link?: string | null; addedByName?: string | null; addedByProfileId?: string | null }
export interface CompetencyDto { key: string; group: string; label: string; description: string; rating: { term: string; level: string; levelLabel: string; comment: string | null; ratedByName: string | null; ratedAt: string } | null; history: Array<{ term: string; level: string; levelLabel: string; ratedAt: string }>; evidence: PortfolioEvidenceDto[]; reflections: Array<{ id: string; text: string; at: string }> }
export interface PortfolioDto { student: { id: string; name: string; admissionNo: string | null; className: string | null }; term: string; levels: Array<{ key: string; label: string }>; competencies: CompetencyDto[]; generalReflections: Array<{ id: string; text: string; at: string }>; counts: { evidence: number; fromRecords: number; teacherAdded: number; rated: number; reflections: number }; canManage: boolean; canReflect: boolean; note: string }

export const portfolioApi = {
  students: (p: Q = {}) => get<Array<{ studentId: string; name: string; admissionNo: string | null; className: string | null }>>('/portfolios/students', p),
  get: (studentId: string) => get<PortfolioDto>(`/portfolios/${studentId}`),
  addEvidence: (studentId: string, body: unknown) => post<PortfolioEvidenceDto>(`/portfolios/${studentId}/evidence`, body),
  removeEvidence: (studentId: string, id: string) => del<{ removed: boolean }>(`/portfolios/${studentId}/evidence/${id}`),
  rate: (studentId: string, body: unknown) => put<unknown>(`/portfolios/${studentId}/ratings`, body),
  reflect: (studentId: string, body: unknown) => post<unknown>(`/portfolios/${studentId}/reflections`, body),
  /** Opens the PDF through an authorised fetch (no token in the URL). */
  async openPdf(studentId: string) {
    const acting = getActingSchool();
    const res = await fetch(fileHref(`/api/v1/portfolios/${studentId}/pdf`), { headers: { ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}), ...(acting ? { 'X-School-Id': acting.slug } : {}) } });
    if (!res.ok) throw new Error(`Could not prepare the PDF (${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
};

// ── scenario planning ──────────────────────────────────────────────────
export interface AssumptionDto { key: string; label: string; unit: string; value: number; source: 'ACTUAL' | 'DEFAULT' | 'EDITED'; default: number }
export interface ProjectionRow { year: number; label: string; actual: boolean; students: number; byGrade: Array<{ name: string; students: number }>; feePerStudentPaise: number; feeRevenuePaise: number; teachersNeeded: number; newTeachersVsNow: number; studentsPerTeacher: number | null; staffCostPaise: number; riders: number; vehiclesNeeded: number; newVehiclesVsNow: number; transportCostPaise: number; otherCostsPaise: number; totalCostPaise: number; surplusPaise: number }
export interface Baseline { asOf: string; academicYear: string | null; enrolment: { students: number; grades: Array<{ name: string; students: number }> }; fees: { billedPaise: number; collectedPaise: number; perStudentPaise: number | null; concessionPct: number | null; collectionPct: number | null }; staffing: { teachers: number; otherStaff: number; studentsPerTeacher: number | null; monthlyPayrollPaise: number | null; payrollPeriod: string | null }; transport: { riders: number; vehicles: number; usableSeats: number; seatsPerVehicle: number | null }; budget: { fiscalYear: string | null; plannedPaise: number; actualPaise: number }; sources: string[] }
export interface ProjectionDto { label: string; baseline: Baseline; assumptions: AssumptionDto[]; years: number; rows: ProjectionRow[]; scenario?: { id: string; name: string; description: string | null; years: number } }

export const scenarioApi = {
  baseline: () => get<{ label: string; baseline: Baseline; assumptions: AssumptionDto[] }>('/scenarios/baseline'),
  preview: (years: number, assumptions: Record<string, number>) => post<ProjectionDto>('/scenarios/preview', { years, assumptions }),
  list: () => get<Array<{ id: string; name: string; description: string | null; years: number; createdByName: string | null; updatedAt: string; edited: number }>>('/scenarios'),
  get: (id: string) => get<ProjectionDto>(`/scenarios/${id}`),
  create: (body: unknown) => post<ProjectionDto>('/scenarios', body),
  update: (id: string, body: unknown) => patch<ProjectionDto>(`/scenarios/${id}`, body),
  remove: (id: string) => del<unknown>(`/scenarios/${id}`),
  compare: (ids: string[]) => get<{ label: string; baseline: Baseline; scenarios: Array<{ id: string; name: string; years: number; assumptions: AssumptionDto[]; rows: ProjectionRow[] }> }>('/scenarios/compare', { ids: ids.join(',') }),
};

// ── teacher presence board ─────────────────────────────────────────────
export interface PresenceRow { periodNo: number; time: string; room: string | null; sectionId: string; className: string | null; subject: string | null; teacherName: string | null; status: string; checkIn: { name: string | null; at: string; source: string; covering: boolean } | null }
export const presenceApi = {
  board: (date?: string) => get<{ date: string; rows: PresenceRow[]; counts: { lessons: number; present: number; notCheckedIn: number; viaCamera: number }; note: string }>('/class-check-ins/board', date ? { date } : {}),
};
