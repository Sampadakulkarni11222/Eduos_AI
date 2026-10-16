/**
 * Typed client for the school health room (backend modules/health). Health
 * data is restricted: every call is checked server-side against the health.*
 * keys and every read of a child's record is audited there.
 */
import { request } from './api';
import { qs, post, patch, put } from './ops-api';

type Q = Record<string, string | number | boolean | null | undefined>;
const get = <R>(path: string, params?: Q) => request<R>(`${path}${qs(params)}`);

export const VISIT_OUTCOMES = [
  { key: 'RETURNED_TO_CLASS', label: 'Returned to class' },
  { key: 'REST', label: 'Rested in the health room' },
  { key: 'FIRST_AID', label: 'First aid given' },
  { key: 'SENT_HOME', label: 'Sent home' },
  { key: 'REFERRED', label: 'Referred to a doctor or hospital' },
] as const;
export const NOTIFY_TRIGGERS = [
  { key: 'SENT_HOME', label: 'Sent home' },
  { key: 'REFERRED', label: 'Referred' },
  { key: 'INJURY', label: 'Any injury' },
  { key: 'MEDICINE_GIVEN', label: 'Medicine given' },
] as const;

export interface Vitals { temperatureC: number | null; pulse: number | null; bpSystolic: number | null; bpDiastolic: number | null; spo2: number | null }
export interface HealthVisitDto {
  id: string; refNo: string; studentId: string; studentName: string | null; className: string | null;
  arrivedAt: string; leftAt: string | null; outcome: string; outcomeLabel: string; injury: boolean; medicineGiven: boolean;
  complaint: string | null; vitals: Vitals | null; action: string | null; attendedBy: string | null;
  parentNotified: { at: string; reasons: string[] } | null;
}
export interface MedicationPlanDto {
  id: string; refNo: string; studentId: string; studentName: string | null; className: string | null;
  medicine: { name?: string; form?: string | null; strength?: string | null }; dose: string | null; instructions: string | null;
  prescription: { name: string; url: string } | null; times: string[]; startOn: string; endOn: string; controlled: boolean; status: string;
  consent: { byName: string | null; at: string } | null; createdBy: string | null; stoppedReason: string | null;
}
export interface DoseDueDto {
  planId: string; planRef: string; studentId: string; studentName: string | null; className: string | null; medicine: string | null; dose: string | null;
  controlled: boolean; slot: string; date: string; status: string; doseId: string | null; by: string | null; at: string | null; awaitingCountersign: boolean;
}
export interface DoseDto {
  id: string; planId: string; studentId: string; studentName: string | null; medicine: string | null; scheduledFor: string; date: string; slot: string;
  status: string; at: string; by: string | null; note: string | null; controlled: boolean; countersign: { required: boolean; by: string | null; at: string | null } | null;
}
export interface StockDto { id: string; name: string; kind: string; batchNo: string | null; quantity: number; unit: string; reorderLevel: number; expiresOn: string | null; daysToExpiry: number | null; expired: boolean; expiringSoon: boolean; low: boolean; location: string; controlled: boolean }
export interface CareNoteDto { id: string; studentId: string; studentName: string | null; className: string | null; text: string | null; severity: string; shared?: boolean; consent?: { granted: boolean; byName: string | null; at: string } | null; createdBy?: string | null }
export interface HealthEntryDto { id: string; kind: 'IMMUNISATION' | 'SCREENING'; on: string; academicYear: string | null; data: Record<string, string | number | null>; recordedBy: string | null }
export interface HealthCardDto {
  academicYear: string; student: { id: string; name: string; admissionNo: string; className: string | null };
  bloodGroup: string | null; allergies: string[]; latestScreening: Record<string, string | number | null> | null;
  screenings: Array<Record<string, string | number | null>>; immunisations: Array<Record<string, string | number | null>>; visitsThisYear: number;
}
export interface HealthSummaryDto {
  periodDays: number;
  visits: { today: number; inPeriod: number; byOutcome: Record<string, number>; injuries: number };
  medication: { activePlans: number; awaitingConsent: number; missedOrRefusedInPeriod: number; awaitingCountersign: number };
  stock: { expired: number; expiringSoon: number; low: number };
  careNotesShared: number;
}
export interface FamilyChildDto { studentId: string; name: string | null; className: string | null; visits: HealthVisitDto[]; plans: MedicationPlanDto[]; medicationLog: DoseDto[]; careNotes: CareNoteDto[] }

export const healthApi = {
  summary: (days = 30) => get<HealthSummaryDto>('/health/summary', { days }),
  classCareNotes: () => get<{ items: CareNoteDto[] }>('/health/class-care-notes'),
  family: () => get<{ children: FamilyChildDto[] }>('/health/family'),
  today: () => get<{ date: string; visits: HealthVisitDto[]; doses: DoseDueDto[]; stock: { expired: number; expiringSoon: number; low: number } }>('/health/today'),
  students: (q: string) => get<{ items: Array<{ id: string; name: string; admissionNo: string; className: string | null }> }>('/health/students', { q }),
  settings: () => get<{ notifyOn: string[]; expiryLeadDays: number }>('/health/settings'),
  saveSettings: (body: unknown) => put<{ notifyOn: string[]; expiryLeadDays: number }>('/health/settings', body),
  visits: (p: Q = {}) => get<{ items: HealthVisitDto[]; total: number }>('/health/visits', p),
  recordVisit: (body: unknown) => post<HealthVisitDto>('/health/visits', body),
  updateVisit: (id: string, body: unknown) => patch<HealthVisitDto>(`/health/visits/${id}`, body),
  plans: (p: Q = {}) => get<{ items: MedicationPlanDto[] }>('/health/plans', p),
  createPlan: (body: unknown) => post<MedicationPlanDto>('/health/plans', body),
  consentPlan: (id: string, body: unknown) => post<MedicationPlanDto>(`/health/plans/${id}/consent`, body),
  stopPlan: (id: string, reason: string) => post<MedicationPlanDto>(`/health/plans/${id}/stop`, { reason }),
  dosesDue: (date?: string) => get<{ date: string; items: DoseDueDto[] }>('/health/doses/due', { date }),
  recordDose: (body: unknown) => post<DoseDto>('/health/doses', body),
  countersign: (id: string) => post<DoseDto>(`/health/doses/${id}/countersign`),
  medicationLog: (studentId: string) => get<{ items: DoseDto[] }>(`/health/students/${studentId}/medication-log`),
  stock: () => get<{ items: StockDto[] }>('/health/stock'),
  addStock: (body: unknown) => post<StockDto>('/health/stock', body),
  updateStock: (id: string, body: unknown) => patch<StockDto>(`/health/stock/${id}`, body),
  careNotes: (p: Q = {}) => get<{ items: CareNoteDto[] }>('/health/care-notes', p),
  createCareNote: (body: unknown) => post<CareNoteDto>('/health/care-notes', body),
  careNoteConsent: (id: string, share: boolean) => post<CareNoteDto>(`/health/care-notes/${id}/consent`, { share }),
  retireCareNote: (id: string) => post<CareNoteDto>(`/health/care-notes/${id}/retire`),
  entries: (studentId: string) => get<{ items: HealthEntryDto[] }>(`/health/students/${studentId}/entries`),
  addEntry: (body: unknown) => post<HealthEntryDto>('/health/entries', body),
  card: (studentId: string) => get<HealthCardDto>(`/health/students/${studentId}/card`),
};
