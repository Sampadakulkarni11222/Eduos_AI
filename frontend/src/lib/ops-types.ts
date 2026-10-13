/** Response shapes of the institution-operations APIs. */

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number; totalPages: number }

export interface HistoryEntry { at: string; actorName: string | null; action: string; from: string | null; to: string | null; note: string | null }
export interface Attachment { name: string; url: string; kind?: string; addedAt?: string }

export interface AttendanceDraftDto {
  id: string;
  sectionId: string;
  date: string;
  periodNo: number | null;
  cursor: number;
  version: number;
  updatedAt: string;
  entries: Array<{ enrollmentId: string; status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | null; passed: boolean }>;
  rosterChanges: { added: string[]; removed: string[] };
}
