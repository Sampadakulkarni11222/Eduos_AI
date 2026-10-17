/**
 * Typed client for the family desk (backend modules/family): today across all
 * of a parent's children, the yearly fee statement for income tax, and school
 * notices in the family's language.
 */
import { request } from './api';

export interface FamilyChildToday {
  studentId: string; name: string; firstName: string; className: string | null;
  today: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'HALF_DAY' | 'NOT_MARKED' | 'NOT_ENROLLED' | string;
  attendancePct: number | null; pendingFeesPaise: number;
  homeworkDue: Array<{ title: string; subject: string | null; dueOn: string }>;
  nextExam: { name: string; subject: string; on: string } | null;
  classTeacher: string | null;
}
export interface FamilyAction { kind: string; urgency: 'high' | 'normal'; childName: string | null; text: string; link: string }
export interface FamilyTodayDto {
  date: string; children: FamilyChildToday[]; actions: FamilyAction[]; language: string; whatsapp: string;
  counts: { children: number; actions: number; urgent: number; unreadNotifications: number };
}
export interface FeeStatementRow { receiptNo: string | null; invoiceNo: string | null; paidOn: string; mode: string; amountPaise: number; tuitionPaise: number; otherPaise: number; split: string }
export interface FeeStatementDto {
  financialYear: string; from: string; to: string; totalPaise: number; tuitionPaise: number; note: string;
  children: Array<{ studentId: string; name: string; admissionNo: string | null; className: string | null; payments: FeeStatementRow[]; totalPaise: number; tuitionPaise: number }>;
}
export interface NoticeTranslationDto {
  announcementId: string; lang: string; languageName: string; available: boolean; label: string;
  title?: string; content?: string; original: { title: string; content: string };
}
export interface FamilyLanguage { code: string; name: string }

export const familyApi = {
  today: () => request<FamilyTodayDto>('/family/today'),
  feeStatement: (fy?: string) => request<FeeStatementDto>(`/family/fee-statement${fy ? `?fy=${encodeURIComponent(fy)}` : ''}`),
  translateNotice: (announcementId: string, lang: string) =>
    request<NoticeTranslationDto>('/family/translate-announcement', { method: 'POST', body: JSON.stringify({ announcementId, lang }) }),
  languages: () => request<FamilyLanguage[]>('/family/languages'),
  preferences: () => request<{ language: string; whatsappOptIn: { status: string } }>('/messaging/preferences'),
  savePreferences: (body: { language?: string; whatsappOptIn?: boolean }) =>
    request<{ language: string; whatsappOptIn: { status: string } }>('/messaging/preferences', { method: 'PUT', body: JSON.stringify(body) }),
};

/** The last few Indian financial years, newest first: "2026-27", "2025-26", ... */
export function recentFinancialYears(n = 4, now = new Date()): string[] {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const start = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return Array.from({ length: n }, (_, i) => `${start - i}-${String((start - i + 1) % 100).padStart(2, '0')}`);
}
