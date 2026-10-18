/**
 * Part 7 automations: the school's automations (settings, preview, run now),
 * drafts an automation prepared for the person to confirm, opt-ins, personal
 * reminders and reports, and "what needs you today".
 */
import { request } from './api';

const post = <R,>(path: string, body: unknown = {}) => request<R>(path, { method: 'POST', body: JSON.stringify(body) });
const put = <R,>(path: string, body: unknown = {}) => request<R>(path, { method: 'PUT', body: JSON.stringify(body) });
const del = <R,>(path: string) => request<R>(path, { method: 'DELETE' });

export interface AutomationDto {
  key: string; label: string; description: string;
  enabled: boolean; effective: boolean; featureOn: boolean; feature: string | null;
  cadence: 'DAILY' | 'WEEKLY'; hour: number; weekday: number | null; schedule: string;
  audience: string[]; audiences: string[]; familyFacing: boolean; optIn: boolean;
  channels: string; preview: string; defaultEnabled: boolean; customised: boolean;
  lastRun: { at: string; result: Record<string, unknown> | null } | null;
}
export interface BuiltInAutomation { key: string; label: string; where: string; link: string }
export interface AutomationsDto { automations: AutomationDto[]; builtIn: BuiltInAutomation[]; quietHours: { from: number; to: number }; canManage: boolean }

export interface AutomationDraftDto {
  id: string; automationKey: string; title: string; link: string | null; status: string; createdAt: string;
  detail: {
    kind?: 'COVER' | 'PURCHASE'; date?: string; teacher?: string | null;
    periods?: Array<{ periodNo: number; class: string; startTime?: string; subject?: string | null; suggested: { name: string } | null }>;
    items?: Array<{ name: string; quantity: number; reorderLevel: number; unit: string; suggestedQty: number }>;
  };
}

export interface OptInDto { key: string; label: string; optedIn: boolean; schoolEnabled: boolean; preview: string }

export interface PersonalScheduleInput {
  kind: 'REMINDER' | 'REPORT'; text?: string; reportKey?: string;
  frequency: 'ONCE' | 'DAILY' | 'WEEKDAYS' | 'WEEKLY' | 'MONTHLY';
  weekdays?: number[]; dayOfMonth?: number; onDate?: string; hour: number; minute?: number;
}
export interface PersonalReminderDto {
  id: string; kind: 'REMINDER' | 'REPORT'; text: string; reportKey: string | null; when: string;
  active: boolean; nextRunAt: string | null; lastRunAt: string | null; runs: number; createdVia: string;
}

export interface TodayItem { kind: string; title: string; count?: number; examples?: string[]; link?: string; ask?: string }
export interface TodayDto { date: string; items: TodayItem[] }

export const automationsApi = {
  list: () => request<AutomationsDto>('/automations'),
  update: (key: string, body: Partial<Pick<AutomationDto, 'enabled' | 'hour' | 'weekday' | 'audience'>>) => put<AutomationDto>(`/automations/${encodeURIComponent(key)}`, body),
  runNow: (key: string) => post<Record<string, unknown>>(`/automations/${encodeURIComponent(key)}/run`),
  today: () => request<TodayDto>('/automations/me/today'),
  drafts: () => request<AutomationDraftDto[]>('/automations/me/drafts'),
  confirmDraft: (id: string) => post<AutomationDraftDto & { outcome: { created: unknown[]; failed: Array<{ reason: string }> } }>(`/automations/me/drafts/${id}/confirm`),
  dismissDraft: (id: string) => post<AutomationDraftDto>(`/automations/me/drafts/${id}/dismiss`),
  optIns: () => request<OptInDto[]>('/automations/me/opt-ins'),
  setOptIn: (key: string, enabled: boolean) => put<OptInDto>(`/automations/me/opt-ins/${encodeURIComponent(key)}`, { enabled }),
  reminders: () => request<PersonalReminderDto[]>('/automations/me/reminders'),
  addReminder: (body: PersonalScheduleInput) => post<PersonalReminderDto>('/automations/me/reminders', body),
  stopReminder: (id: string) => del<{ stopped: number }>(`/automations/me/reminders/${id}`),
};

export const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Reports a person can schedule for themselves; the server refuses one the person may not see. */
export const REPORT_OPTIONS = [
  { value: 'PENDING_TASKS', label: 'My open tasks' },
  { value: 'TODAY_BRIEFING', label: 'What needs me today' },
  { value: 'PENDING_APPROVALS', label: 'Approvals waiting on me' },
  { value: 'ABSENT_STUDENTS', label: 'Absent students today' },
  { value: 'ABSENT_STAFF', label: 'Absent staff today' },
  { value: 'UNMARKED_REGISTERS', label: 'Registers not marked' },
  { value: 'OVERDUE_FEES', label: 'Overdue fees' },
  { value: 'LIBRARY_OVERDUE', label: 'Overdue library books' },
];
