/**
 * Typed clients for sustainability (/sustainability), the public online
 * admission form (/public/admissions, no session), the admissions team's list
 * of online applications (/admissions/online), library accession numbers and
 * scanning (/library/copies) and AI drafts (/ai/drafts).
 */
import { request } from './api';
import { qs, post, patch, downloadCsv } from './ops-api';
import type { Attachment, HistoryEntry } from './ops-types';

type Q = Record<string, string | number | boolean | null | undefined>;
const get = <R>(path: string, params?: Q) => request<R>(`${path}${qs(params)}`);
type Ev = Array<{ name: string; url: string }>;

// ── sustainability ──────────────────────────────────────────────────────

export const ZONE_KINDS = ['GARDEN', 'GROUND', 'BLOCK', 'KITCHEN', 'TOILET_BLOCK', 'ROOFTOP', 'WATER_TANK', 'NURSERY', 'OTHER'] as const;
export const TEAM_KINDS = ['CLASS', 'HOUSE', 'CLUB'] as const;
export const PLANT_KINDS = ['TREE', 'SHRUB', 'PLANT', 'HERB', 'CLIMBER'] as const;
export const PLANT_STATUSES = ['ALIVE', 'NEEDS_CARE', 'DEAD', 'REPLACED'] as const;
export const WASTE_STREAMS = ['WET', 'DRY', 'E_WASTE', 'SANITARY', 'HAZARDOUS_LAB'] as const;
export const WASTE_DESTINATIONS = ['VENDOR', 'COMPOST', 'MUNICIPAL', 'STORED', 'OTHER'] as const;
export const METER_KINDS = ['WATER', 'ELECTRICITY', 'RAINWATER_HARVESTED', 'SOLAR_GENERATED'] as const;
export const METER_UNITS: Record<string, string> = { WATER: 'kL', ELECTRICITY: 'kWh', RAINWATER_HARVESTED: 'kL', SOLAR_GENERATED: 'kWh' };
export const DUTY_KINDS = ['TOILET_CLEANING', 'PAD_DISPENSER', 'INCINERATOR', 'WATER_TANK_CLEANING'] as const;
export const ACTIVITY_CATEGORIES = ['PLANTING', 'CLEANUP', 'WASTE_SEGREGATION', 'COMPOSTING', 'WATER_SAVING', 'ENERGY_SAVING', 'AWARENESS', 'LIFE_ACTION', 'OTHER'] as const;
export const LIFE_THEMES = ['SAVE_ENERGY', 'SAVE_WATER', 'SAY_NO_TO_SINGLE_USE_PLASTIC', 'ADOPT_SUSTAINABLE_FOOD_SYSTEMS', 'REDUCE_WASTE', 'ADOPT_HEALTHY_LIFESTYLES', 'REDUCE_E_WASTE'] as const;
/** Streams that need the vendor's receipt when handed over. */
export const RECEIPT_STREAMS = ['E_WASTE', 'HAZARDOUS_LAB', 'SANITARY'];

export interface GreenFigures {
  period: { from: string; to: string; label: string };
  students: number;
  waste: { totalKg: number; byStreamKg: Record<string, number>; records: number; segregationPct: number | null; compostedKg: number; perStudentKg: number | null };
  trees: { planted: number; alive: number; survivalPct: number | null; records: number };
  water: { kL: number; months: number; perStudentKL: number | null; rainwaterHarvestedKL: number };
  energy: { kWh: number; months: number; perStudentKWh: number | null; solarKWh: number };
}
export interface GreenOverview extends GreenFigures { pendingVerification: number; sanitation: { duties: number; openTasks: number }; canManageAll: boolean }
export interface ZoneDto { id: string; name: string; kind: string; facilityId: string | null; notes: string | null; active: boolean }
export interface TeamDto { id: string; kind: string; name: string; sectionId: string | null; sectionLabel: string | null; houseValue: string | null; leadNames: string[]; active: boolean }
export interface PlantCheck { _id?: string; at: string; status: string; note: string | null; evidence: Attachment[]; byName: string | null }
export interface PlantDto {
  id: string; code: string; species: string; commonName: string | null; kind: string; zoneId: string | null; zoneName: string | null; locationNote: string | null;
  plantedOn: string; plantedBy: string | null; count: number; status: string; lastCheck: PlantCheck | null; checkCount: number; lastCheckedAt: string | null; checks?: PlantCheck[];
}
export interface WasteDto { id: string; refNo: string; date: string; stream: string; weightKg: number; segregated: boolean; destination: string; vendorName: string | null; receiptNo: string | null; receipts: Attachment[]; zoneName: string | null; notes: string | null }
export interface CompostDto { id: string; code: string; startedOn: string; inputKg: number; status: string; maturedOn: string | null; outputKg: number | null; history: HistoryEntry[] }
export interface MeterDto { id: string; kind: string; meterLabel: string; period: string; startReading: number | null; endReading: number | null; quantity: number; unit: string; evidence: Attachment[] }
export interface DutyDto {
  id: string; kind: string; title: string; zoneName: string | null; blockLabel: string | null; checklist: string[]; frequency: string; every: number; ownerName: string | null; ownerProfileId: string | null;
  nextDueAt: string; lastDoneAt: string | null; stockLevel: number | null; reorderLevel: number | null; active: boolean; overdue: boolean; lowStock: boolean; openTask: { refNo: string; dueAt: string } | null;
}
export interface ActivityDto {
  id: string; refNo: string; teamId: string; teamName: string | null; teamKind: string | null; title: string; category: string; lifeTheme: string | null; date: string; participants: number;
  description: string | null; evidence: Attachment[]; status: string; points: number; loggedByProfileId: string | null; loggedByName: string | null; verifiedByName: string | null; decisionNote: string | null;
}
export interface EcoBoard {
  schoolPoints: number; verifiedActivities: number; note: string;
  teams: Array<{ id: string; kind: string; name: string; sectionLabel: string | null; points: number; activities: number; mine: boolean }>;
  recent: Array<{ id: string; title: string; teamName: string | null; category: string; points: number; date: string }>;
}
export interface PackMeta { key: string; title: string; fieldsNote: string }
export interface PackDto extends PackMeta {
  disclaimer: string; period: { from: string; to: string; label: string }; students: number; generatedAt: string;
  sections: Array<{ key: string; title: string; rows: Array<[string, string]>; evidence: Array<{ name: string; url: string }>; gaps: string[]; evidenceCount: number }>;
}

export const greenApi = {
  overview: (params?: Q) => get<GreenOverview>('/sustainability/overview', params),
  ecoPoints: () => get<EcoBoard>('/sustainability/eco-points'),
  zones: () => get<ZoneDto[]>('/sustainability/zones'),
  createZone: (body: { name: string; kind: string; notes?: string }) => post<ZoneDto>('/sustainability/zones', body),
  teams: () => get<TeamDto[]>('/sustainability/teams'),
  createTeam: (body: { kind: string; name: string; sectionId?: string; houseValue?: string }) => post<TeamDto>('/sustainability/teams', body),
  plants: (params?: Q) => get<PlantDto[]>('/sustainability/plants', params),
  plant: (id: string) => get<PlantDto>(`/sustainability/plants/${id}`),
  createPlant: (body: Record<string, unknown>) => post<PlantDto>('/sustainability/plants', body),
  checkPlant: (id: string, body: { status: string; note?: string; evidence: Ev }) => post<PlantDto>(`/sustainability/plants/${id}/checks`, body),
  waste: (params?: Q) => get<WasteDto[]>('/sustainability/waste', params),
  createWaste: (body: Record<string, unknown>) => post<WasteDto>('/sustainability/waste', body),
  compost: () => get<CompostDto[]>('/sustainability/compost'),
  createCompost: (body: Record<string, unknown>) => post<CompostDto>('/sustainability/compost', body),
  updateCompost: (id: string, body: Record<string, unknown>) => patch<CompostDto>(`/sustainability/compost/${id}`, body),
  meters: (params?: Q) => get<MeterDto[]>('/sustainability/meters', params),
  recordMeter: (body: Record<string, unknown>) => post<MeterDto>('/sustainability/meters', body),
  duties: () => get<DutyDto[]>('/sustainability/sanitation'),
  createDuty: (body: Record<string, unknown>) => post<DutyDto>('/sustainability/sanitation', body),
  recordCheck: (id: string, body: { itemsDone: string[]; note?: string; evidence: Ev; stockAfter?: number | null; serviced?: boolean }) => post<{ duty: DutyDto }>(`/sustainability/sanitation/${id}/checks`, body),
  activities: (params?: Q) => get<ActivityDto[]>('/sustainability/activities', params),
  logActivity: (body: Record<string, unknown>) => post<ActivityDto>('/sustainability/activities', body),
  decide: (id: string, body: { decision: 'VERIFY' | 'REJECT'; points?: number; note?: string; evidenceSeen?: boolean }) => post<ActivityDto>(`/sustainability/activities/${id}/decision`, body),
  packs: () => get<PackMeta[]>('/sustainability/packs'),
  pack: (key: string, params?: Q) => get<PackDto>(`/sustainability/packs/${key}`, params),
  packCsv: (key: string, params: Q, filename: string) => downloadCsv(`/sustainability/packs/${key}/csv${qs(params)}`, filename),
};

// ── online admission (public) ───────────────────────────────────────────

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:5000';

export class PublicApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

async function publicCall<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BACKEND_URL}/api/v1/public/admissions${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) }, credentials: 'omit' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new PublicApiError(res.status, body?.error?.code ?? body?.code ?? 'ERROR', body?.message ?? body?.error?.message ?? 'Something went wrong. Please try again.');
  return (body?.data ?? body) as T;
}

export interface AdmissionFormConfig {
  school: { slug: string; name: string }; grades: string[]; documentKinds: string[];
  files: { extensions: string[]; maxBytes: number; maxFiles: number }; captcha: { required: boolean; siteKey: string | null }; feePayment: false; notice: string;
}
export interface ApplicationReceipt { refNo: string; status: string; message: string; acknowledgement: Array<{ channel: string; status: string }> }
export interface ApplicationStatus { refNo: string; childName: string; gradeApplying: string | null; submittedAt: string; status: string; stage: string; updatedAt: string; documents: Array<{ kind: string; name: string }> }

export const admissionPublicApi = {
  form: (school: string) => publicCall<AdmissionFormConfig>(`/${encodeURIComponent(school)}/form`),
  upload: (school: string, file: File) => publicCall<{ fileToken: string; name: string; size: number }>(`/${encodeURIComponent(school)}/files`, {
    method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(file.name) },
  }),
  submit: (school: string, body: Record<string, unknown>) => publicCall<ApplicationReceipt>(`/${encodeURIComponent(school)}/applications`, { method: 'POST', body: JSON.stringify(body) }),
  requestCode: (school: string, body: { refNo: string; phone: string }) => publicCall<{ message: string; devOtp?: string }>(`/${encodeURIComponent(school)}/status/code`, { method: 'POST', body: JSON.stringify(body) }),
  status: (school: string, body: { refNo: string; phone: string; code: string }) => publicCall<ApplicationStatus>(`/${encodeURIComponent(school)}/status`, { method: 'POST', body: JSON.stringify(body) }),
};

export interface OnlineApplicationDto {
  id: string; refNo: string; leadId: string; childName: string; dateOfBirth: string | null; gradeApplying: string | null; guardianName: string; relation: string | null;
  phone: string; email: string | null; address: string | null; previousSchool: string | null; message: string | null; createdAt: string; stage: string | null; publicStatus: string | null;
  documents: Array<{ kind: string; name: string; size: number; url: string }>;
}
export const onlineApplicationsApi = {
  list: (params?: Q) => get<{ items: OnlineApplicationDto[]; total: number; page: number; pageSize: number }>('/admissions/online', params),
};

// ── library accession numbers and scanning ──────────────────────────────

export interface CopyDto { id: string; bookId: string; accessionNo: string; barcode: string; status: string; currentIssueId: string | null; shelf: string | null; title?: string; author?: string; category?: string | null; labelPrintedAt: string | null }
export interface ScanDto extends CopyDto { loan: { id: string; borrowerName: string | null; dueDate: string; status: string } | null }
export interface IssueResult { issue: { id: string; bookTitle: string; studentName: string; dueAt: string; status: string; finePaise: number }; copy: CopyDto }

export const libraryCopiesApi = {
  list: (params?: Q) => get<CopyDto[]>('/library/copies', params),
  generate: (body: { bookId: string; count?: number; prefix?: string; shelf?: string }) => post<{ created: CopyDto[]; addedToCatalogue?: number; message?: string }>('/library/copies/generate', body),
  labels: (params?: Q) => get<{ school: string | null; labels: CopyDto[] }>('/library/copies/labels', params),
  markPrinted: (ids: string[]) => post<{ marked: number }>('/library/copies/labels/printed', { ids }),
  scan: (code: string) => post<ScanDto>('/library/copies/scan', { code }),
  issue: (body: { code: string; student: string; dueAt?: string }) => post<IssueResult>('/library/copies/scan/issue', body),
  ret: (code: string) => post<IssueResult>('/library/copies/scan/return', { code }),
};

// ── AI drafts ───────────────────────────────────────────────────────────

export const DRAFT_KINDS = ['LETTER', 'CIRCULAR', 'MINUTES', 'LESSON_PLAN', 'REPORT_REMARK'] as const;
export type DraftKind = typeof DRAFT_KINDS[number];
export interface DraftResult { kind: DraftKind; text: string; source: 'AI' | 'TEMPLATE'; label: string; redactions: number; saved: false; note: string }
export const aiDraftsApi = {
  status: () => get<{ aiConfigured: boolean; kinds: DraftKind[]; bands: string[]; label: string }>('/ai/drafts'),
  draft: (body: Record<string, unknown>) => post<DraftResult>('/ai/drafts', body),
};
