/**
 * Typed client for PTM booking, parent review calls and parent–teacher
 * conversations (backend modules/ptm and modules/conversations).
 */
import { request } from './api';
import { qs, post, patch, put } from './ops-api';
import type { HistoryEntry, Attachment } from './ops-types';

type Q = Record<string, string | number | boolean | null | undefined>;
const get = <R>(path: string, params?: Q) => request<R>(`${path}${qs(params)}`);

export type PtmMode = 'IN_PERSON' | 'ONLINE' | 'BOTH';
export interface PtmRound {
  id: string; refNo: string; title: string; description: string | null; startsOn: string; endsOn: string; mode: PtmMode; sectionIds: string[];
  slotMinutes: number; bufferMinutes: number; bookingOpensAt: string; bookingClosesAt: string; changeCutoffHours: number; defaultVenue: string | null;
  status: 'DRAFT' | 'OPEN' | 'CLOSED' | 'CANCELLED'; bookingOpen: boolean; bookings?: number; slots?: number; openSlots?: number;
}
export interface PtmSlot { id: string; roundId: string; teacherProfileId: string; teacherName: string | null; startsAt: string; endsAt: string; date: string; time: string; when: string; mode: PtmMode; venue: string | null; status: string; heldUntil: string | null }
export interface PtmAction { id: string; title: string; ownerType: 'STAFF' | 'PARENT'; ownerName: string | null; dueOn: string | null; status: string; taskId: string | null }
export interface PtmBooking {
  id: string; refNo: string; roundId: string; slotId: string; teacherProfileId: string; teacherName: string | null; parentProfileId: string; parentName: string | null;
  studentId: string; studentName: string | null; startsAt: string; endsAt: string; when: string; time: string; date: string; mode: 'IN_PERSON' | 'ONLINE'; venue: string | null;
  online: boolean; onlineClassId: string | null; status: string; active: boolean; assisted: boolean;
  preferences: { language?: string | null; interpreter?: boolean; accessibility?: string | null }; parentNote: string | null; checkedInAt: string | null; cancelReason: string | null;
  outcome: { summary: string; nextFollowUpOn: string | null; recordedAt: string; actions: PtmAction[] } | null; history?: HistoryEntry[]; className?: string | null;
}
export interface PtmTeacherOption {
  profileId: string; name: string; roles: string[]; subjects: string[]; slots: PtmSlot[]; hasSlots: boolean; full: boolean; booking: PtmBooking | null;
  waitlist: { id: string; status: string; offeredSlotId: string | null; offerExpiresAt: string | null } | null;
}
export interface PtmOptions { round: PtmRound; children: Array<{ studentId: string; name: string; className: string | null; sectionId: string | null; teachers: PtmTeacherOption[] }> }
export interface PtmSheet { round: PtmRound; rows: Array<{ slot: PtmSlot; booking: PtmBooking | null }>; totals: { slots: number; booked: number; checkedIn: number; completed: number; noShow: number; free: number } }
export interface Briefing {
  student: { id: string; name: string; admissionNo: string; className: string | null }; asOf: string;
  attendance: { workingDays: number; pctExact: number | null; ABSENT: number; LATE: number; definition: string } | null;
  recentMarks: Array<{ exam: string | null; subject: string | null; marks: number | null; maxMarks: number | null; percentage: number | null; absence: string | null }>;
  syllabus: Array<{ subject: string; coveragePct: number | null; health: string; currentModule: string | null; pace: string | null }>;
  homework: { due: number; submitted: number; late: number; completionPct: number | null; definition: string } | null;
  coCurricular: Array<{ name: string; category: string; level: string; achievement: string | null; on: string }>;
  fees: { outstandingPaise: number; overdueInvoices: number; openInvoices: number } | null; feesShown: boolean;
  previousMeetings?: Array<{ when: string; teacherName: string | null; summary: string | null; openActions: number }>;
  safeguardingNote?: string; guardianCount?: number;
}
export interface PtmMetrics { booked: number; cancelled: number; completed: number; noShow: number; families: number; attendancePct: number | null; actionsAgreed: number; actionsOpen: number; actionsOverdue: number; actionsDone: number; waiting: number; definition: string }
export interface UnbookedFamily { studentId: string; studentName: string; className: string; guardians: Array<{ profileId: string; name: string | null }> }

export const ptmApi = {
  rounds: (p: Q = {}) => get<PtmRound[]>('/ptm/rounds', p),
  createRound: (body: Record<string, unknown>) => post<PtmRound>('/ptm/rounds', body),
  updateRound: (id: string, body: Record<string, unknown>) => patch<PtmRound>(`/ptm/rounds/${id}`, body),
  cancelRound: (id: string, reason: string) => post<PtmRound>(`/ptm/rounds/${id}/cancel`, { reason }),
  addAvailability: (id: string, body: { teacherProfileId?: string; windows: Array<{ date: string; from: string; to: string; mode?: string; venue?: string }> }) =>
    post<{ created: number; skipped: Array<{ startsAt: string; reason: string }> }>(`/ptm/rounds/${id}/availability`, body),
  slots: (id: string, p: Q = {}) => get<PtmSlot[]>(`/ptm/rounds/${id}/slots`, p),
  blockSlot: (id: string) => post<PtmSlot>(`/ptm/slots/${id}/block`),
  unblockSlot: (id: string) => post<PtmSlot>(`/ptm/slots/${id}/unblock`),
  options: (id: string, p: Q = {}) => get<PtmOptions>(`/ptm/rounds/${id}/options`, p),
  sheet: (id: string, p: Q = {}) => get<PtmSheet>(`/ptm/rounds/${id}/sheet`, p),
  unbooked: (id: string, p: Q = {}) => get<UnbookedFamily[]>(`/ptm/rounds/${id}/unbooked`, p),
  bookings: (p: Q = {}) => get<PtmBooking[]>('/ptm/bookings', p),
  book: (body: { slotId: string; studentId: string; parentProfileId?: string; mode?: string; preferences?: Record<string, unknown>; parentNote?: string }) => post<PtmBooking>('/ptm/bookings', body),
  cancel: (id: string, reason: string) => post<PtmBooking>(`/ptm/bookings/${id}/cancel`, { reason }),
  reschedule: (id: string, slotId: string, reason: string) => post<PtmBooking>(`/ptm/bookings/${id}/reschedule`, { slotId, reason }),
  checkIn: (id: string) => post<PtmBooking>(`/ptm/bookings/${id}/check-in`),
  noShow: (id: string) => post<PtmBooking>(`/ptm/bookings/${id}/no-show`),
  outcome: (id: string, body: { summary: string; actions: Array<{ title: string; ownerType: string; dueOn?: string }>; nextFollowUpOn?: string | null }) => post<PtmBooking>(`/ptm/bookings/${id}/outcome`, body),
  briefing: (id: string) => get<Briefing>(`/ptm/bookings/${id}/briefing`),
  joinWaitlist: (body: { roundId: string; teacherProfileId: string; studentId: string }) => post<{ id: string; position: number }>('/ptm/waitlist', body),
  leaveWaitlist: (id: string) => post<{ id: string }>(`/ptm/waitlist/${id}/leave`),
  acceptOffer: (id: string) => post<PtmBooking>(`/ptm/waitlist/${id}/accept`, {}),
  metrics: (p: Q = {}) => get<PtmMetrics>('/ptm/metrics', p),
};

// ── review calls ──────────────────────────────────────────────────────

export const REVIEW_REASONS = ['ATTENDANCE', 'ACADEMICS', 'BEHAVIOUR_SUPPORT', 'FEES', 'WELLBEING', 'OTHER'] as const;
export const CALL_CHANNELS = ['PHONE', 'WHATSAPP', 'VIDEO', 'IN_PERSON', 'EMAIL', 'SMS'] as const;
export interface ReviewCase {
  id: string; refNo: string; studentId: string; studentName: string; admissionNo: string | null; className: string | null; reason: string; summary: string | null;
  priority: string; status: string; assignedProfileId: string; assignedName: string | null; scheduledAt: string | null; scheduledChannel: string | null;
  attemptsCount: number; notReachedStreak: number; lastReachedAt: string | null; nextFollowUpOn: string | null; followUpOverdue: boolean;
  actions: Array<PtmAction & { overdue: boolean; ownerProfileId: string | null }>; openActions: number; overdueActions: number;
  outcome: string | null; closureNote: string | null; closedAt: string | null; createdAt: string;
  attempts?: Array<{ at: string; channel: string; reached: boolean; note: string | null; byName: string | null }>;
  notes?: Array<{ at: string; kind: string; text: string; byName: string | null }>;
  history?: HistoryEntry[]; suggestion?: { notReached: number; tried: string[]; tryNext: string[]; text: string } | null; safeguardingNote?: string;
}
export interface ReviewMetrics {
  openCases: number; byReason: Record<string, number>; overdueActions: number; openActions: number; followUpsOverdue: number; notReachedThreshold: number;
  familiesNotReached: Array<{ id: string; refNo: string; studentName: string; notReached: number; tryNext: string[]; text: string }>;
  closedLast90Days: number; resolvedLast90Days: number; definition: string;
}

export const reviewApi = {
  list: (p: Q = {}) => get<{ items: ReviewCase[]; total: number }>('/review-calls', p),
  get: (id: string) => get<ReviewCase>(`/review-calls/${id}`),
  create: (body: Record<string, unknown>) => post<ReviewCase>('/review-calls', body),
  update: (id: string, body: Record<string, unknown>) => patch<ReviewCase>(`/review-calls/${id}`, body),
  schedule: (id: string, body: { scheduledAt: string; channel: string }) => post<ReviewCase>(`/review-calls/${id}/schedule`, body),
  attempt: (id: string, body: { channel: string; reached: boolean; note?: string }) => post<ReviewCase>(`/review-calls/${id}/attempts`, body),
  note: (id: string, body: { kind: string; text: string }) => post<ReviewCase>(`/review-calls/${id}/notes`, body),
  action: (id: string, body: { title: string; ownerType: string; dueOn: string }) => post<ReviewCase>(`/review-calls/${id}/actions`, body),
  completeAction: (id: string, actionId: string) => post<ReviewCase>(`/review-calls/${id}/actions/${actionId}/complete`, {}),
  close: (id: string, body: { outcome: string; note: string }) => post<ReviewCase>(`/review-calls/${id}/close`, body),
  reopen: (id: string, reason: string) => post<ReviewCase>(`/review-calls/${id}/reopen`, { reason }),
  briefing: (id: string) => get<Briefing>(`/review-calls/${id}/briefing`),
  metrics: (p: Q = {}) => get<ReviewMetrics>('/review-calls/metrics', p),
};

// ── conversations ─────────────────────────────────────────────────────

export interface ThreadSummary {
  id: string; studentId: string; studentName: string; subject: string; status: 'OPEN' | 'CLOSED'; parentProfileId: string; parentName: string | null;
  staffProfileId: string; staffName: string | null; staffRole: string; lastMessageAt: string | null; lastMessageSide: string | null; awaitingStaffSince: string | null;
  messageCount: number; unread: number; mySide: 'PARENT' | 'STAFF' | null; closedAt: string | null; waitingHours?: number;
}
export interface ThreadDetail extends ThreadSummary {
  officeHoursNote: string | null; oversight: boolean; canReply: boolean; canClose: boolean;
  messages: Array<{ id: string; side: string; senderName: string | null; body: string; at: string; attachments: Attachment[]; mine: boolean; readByOther: boolean; readAt: string | null }>;
}
export type Contacts =
  | { kind: 'PARENT'; children: Array<{ studentId: string; name: string; className: string | null; staff: Array<{ profileId: string; name: string; roles: string[]; subjects: string[]; officeHoursNote: string | null }> }> }
  | { kind: 'STAFF'; pupils: Array<{ studentId: string; name: string; className: string; guardians: Array<{ profileId: string; name: string | null; relation: string }> }> };

export const conversationsApi = {
  list: (p: Q = {}) => get<{ items: ThreadSummary[]; total: number }>('/conversations', p),
  get: (id: string) => get<ThreadDetail>(`/conversations/${id}`),
  start: (body: { studentId: string; staffProfileId?: string; parentProfileId?: string; subject?: string; body: string; attachments?: Attachment[] }) => post<ThreadDetail>('/conversations', body),
  reply: (id: string, body: { body: string; attachments?: Attachment[] }) => post<ThreadDetail>(`/conversations/${id}/messages`, body),
  close: (id: string, note?: string) => post<ThreadSummary>(`/conversations/${id}/close`, { note }),
  queue: (p: Q = {}) => get<{ hours: number; items: ThreadSummary[]; total: number }>('/conversations/queue', p),
  contacts: (p: Q = {}) => get<Contacts>('/conversations/contacts', p),
  settings: () => get<{ officeHoursNote: string | null }>('/conversations/settings'),
  saveSettings: (officeHoursNote: string) => put<{ officeHoursNote: string | null }>('/conversations/settings', { officeHoursNote }),
};
