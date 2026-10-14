/**
 * Typed client for clubs, teams, houses and fixtures (backend modules/clubs)
 * and the achievement and top-ranker showcase (backend modules/showcase).
 */
import { request } from './api';
import { qs, post, put, del } from './ops-api';
import type { HistoryEntry } from './ops-types';

type Q = Record<string, string | number | boolean | null | undefined>;
const get = <R>(path: string, params?: Q) => request<R>(`${path}${qs(params)}`);

export type ClubCategory = 'SPORTS' | 'ARTS' | 'ACADEMIC' | 'SERVICE' | 'OTHER';
export interface Club {
  id: string; code: string; name: string; kind: 'CLUB' | 'TEAM'; category: ClubCategory; activity: string; description: string;
  coaches: Array<{ profileId: string; name: string | null }>; externalCoachName: string | null;
  capacity: number; memberCount: number; seatsLeft: number; waitlisted: number; awaitingApproval?: number; awaitingConsent?: number;
  grades: Array<{ id: string; name: string | null }>; homeFacility: { id: string; name: string; code: string } | null;
  meetingPattern: string | null; joinOpen: boolean; status: 'ACTIVE' | 'ARCHIVED'; iCoach: boolean;
  sessions?: Array<{ id: string; title: string | null; startsAt: string; endsAt: string; status: string; venue: string | null; attendanceTaken?: boolean; present?: number }>;
  members?: Membership[]; myMemberships?: Membership[]; canManage?: boolean;
}
export interface Membership {
  id: string; clubId: string; clubName: string | null; category: string | null; activity: string | null;
  studentId: string; studentName: string | null; admissionNo: string | null; className?: string | null;
  status: 'AWAITING_CONSENT' | 'AWAITING_APPROVAL' | 'PROCESSING' | 'WAITLISTED' | 'ACTIVE' | 'DECLINED' | 'WITHDRAWN' | 'LEFT';
  role: 'MEMBER' | 'CAPTAIN' | 'VICE_CAPTAIN'; note: string | null;
  consent: { required: boolean; given: boolean; givenAt: string | null; refused: boolean };
  requestedByRole: string | null; requestedAt: string; decidedAt: string | null; declineReason: string | null;
  waitlistPosition: number | null; joinedAt: string | null; leftAt: string | null; leftReason: string | null;
}
export interface ClubSession {
  id: string; clubId: string; clubName: string | null; category: string | null; activity: string | null; title: string | null;
  startsAt: string; endsAt: string; status: 'PLANNED' | 'HELD' | 'CANCELLED'; cancelReason: string | null;
  venue: { facilityId: string | null; name: string; code: string | null; kind: string | null } | null;
  bookingStatus: string | null; attendanceTaken: boolean; present?: number; marked?: number; iCoach?: boolean;
}
export interface Register { session: ClubSession; rows: Array<{ studentId: string; name: string | null; admissionNo: string | null; role: string; status: 'PRESENT' | 'ABSENT' | 'EXCUSED' | null }> }
export interface House { id: string; code: string; name: string; colour: string | null; motto: string | null; members: number; masters: Array<{ profileId: string; name: string | null }>; captain?: { studentId: string; name: string | null } | null; myStudents: string[] }
export interface HousePoints { table: Array<{ houseId: string; name: string; colour: string | null; points: number; firsts: number; events: number; position: number }>; approvedResults: number; pendingResults: number; definition: string }
export interface Fixture {
  id: string; refNo: string; kind: 'HOUSE' | 'INTERNAL' | 'EXTERNAL'; title: string; activity: string; category: string; level: string;
  clubId: string | null; clubName: string | null; houses: Array<{ id: string; name: string | null; colour: string | null }>;
  opponent: string | null; organiser: string | null; startsAt: string; endsAt: string | null; status: string; cancelReason: string | null; venue: string | null;
  participantCount: number; participants?: Array<{ studentId: string; name: string | null; houseId: string | null }>; myStudents?: Array<{ studentId: string; name: string | null }>;
  result: null | {
    summary: string | null; outcome: string | null; status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
    placements: Array<{ houseId: string; house: string | null; position: number; points: number }>;
    awards: Array<{ studentId: string; name: string | null; title: string }>;
    recordedBy?: string | null; recordedByMe?: boolean; approvedBy?: string | null; rejectionReason?: string | null;
  };
  canManage: boolean;
}
export interface Equipment { id: string; code: string; name: string; clubId: string | null; clubName: string | null; totalQty: number; availableQty: number; issuedQty: number; notes: string | null }
export interface EquipmentIssue { id: string; equipmentId: string; equipmentName: string | null; studentId: string; studentName: string | null; qty: number; issuedAt: string; dueAt: string | null; status: 'ISSUED' | 'RETURNED' | 'LOST'; overdue: boolean; returnedAt: string | null; returnCondition: string | null }
export interface Portfolio {
  student: { id: string; name: string; className: string | null; admissionNo: string };
  house: string | null;
  summary: { clubs: number; currentClubs: number; fixtures: number; awards: number; attendancePct: number | null };
  clubs: Array<{ clubId: string; name: string | null; kind: string | null; category: string | null; activity: string | null; role: string; joinedAt: string; leftAt: string | null; current: boolean; sessionsMarked: number; sessionsAttended: number }>;
  fixtures: Array<{ fixtureId: string; title: string; kind: string; level: string; activity: string; on: string; opponent: string | null; outcome: string | null; summary: string | null; awards: string[] }>;
  records: Array<{ id: string; name: string; category: string; level: string; achievement: string | null; on: string }>;
  honours: Array<{ title: string; category: string; edition: string; publishedAt: string }>;
  definition: string;
}
export interface ClubOptions { grades: Array<{ id: string; name: string }>; venues: Array<{ id: string; name: string; code: string; kind: string; capacity: number | null }>; categories: string[]; activities: string[]; staff?: Array<{ profileId: string; name: string; role: string | null }> }
export interface MyStudent { studentId: string; name: string; className: string | null; gradeId: string | null; needsConsent: boolean }

export const clubsApi = {
  options: () => get<ClubOptions>('/clubs/options'),
  list: (p: Q = {}) => get<Club[]>('/clubs', p),
  get: (id: string) => get<Club>(`/clubs/${id}`),
  create: (body: Record<string, unknown>) => post<Club>('/clubs', body),
  update: (id: string, body: Record<string, unknown>) => request<Club>(`/clubs/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  my: () => get<Membership[]>('/clubs/my'),
  myStudents: () => get<MyStudent[]>('/clubs/my-students'),
  approvals: () => get<Membership[]>('/clubs/approvals'),
  join: (body: { clubId: string; studentId?: string; note?: string }) => post<Membership>('/clubs/memberships', body),
  consent: (id: string, decision: 'GIVE' | 'REFUSE') => post<Membership>(`/clubs/memberships/${id}/consent`, { decision }),
  decide: (id: string, decision: 'APPROVE' | 'DECLINE', reason?: string) => post<Membership>(`/clubs/memberships/${id}/decision`, { decision, reason }),
  leave: (id: string, reason?: string) => post<Membership>(`/clubs/memberships/${id}/leave`, { reason }),
  setRole: (id: string, role: string) => post<Membership>(`/clubs/memberships/${id}/role`, { role }),
  sessions: (p: Q = {}) => get<ClubSession[]>('/clubs/sessions', p),
  createSessions: (clubId: string, body: Record<string, unknown>) => post<{ created: number; sessions: ClubSession[]; skipped: Array<{ startsAt: string; reason: string }> }>(`/clubs/${clubId}/sessions`, body),
  register: (id: string) => get<Register>(`/clubs/sessions/${id}/register`),
  takeAttendance: (id: string, marks: Array<{ studentId: string; status: string }>) => post<Register>(`/clubs/sessions/${id}/attendance`, { marks }),
  cancelSession: (id: string, reason: string) => post<ClubSession>(`/clubs/sessions/${id}/cancel`, { reason }),
  houses: () => get<House[]>('/clubs/houses'),
  createHouse: (body: Record<string, unknown>) => post<House>('/clubs/houses', body),
  housePoints: (p: Q = {}) => get<HousePoints>('/clubs/house-points', p),
  fixtures: (p: Q = {}) => get<Fixture[]>('/clubs/fixtures', p),
  createFixture: (body: Record<string, unknown>) => post<Fixture>('/clubs/fixtures', body),
  setParticipants: (id: string, studentIds: string[]) => put<Fixture>(`/clubs/fixtures/${id}/participants`, { studentIds }),
  recordResult: (id: string, body: Record<string, unknown>) => post<Fixture>(`/clubs/fixtures/${id}/result`, body),
  decideResult: (id: string, decision: 'APPROVE' | 'REJECT', reason?: string) => post<Fixture>(`/clubs/fixtures/${id}/result/decision`, { decision, reason }),
  cancelFixture: (id: string, reason: string) => post<Fixture>(`/clubs/fixtures/${id}/cancel`, { reason }),
  equipment: (p: Q = {}) => get<Equipment[]>('/clubs/equipment', p),
  addEquipment: (body: Record<string, unknown>) => post<Equipment>('/clubs/equipment', body),
  issues: (p: Q = {}) => get<EquipmentIssue[]>('/clubs/equipment/issues', p),
  issue: (body: Record<string, unknown>) => post<EquipmentIssue>('/clubs/equipment/issues', body),
  returnIssue: (id: string, body: Record<string, unknown>) => post<EquipmentIssue>(`/clubs/equipment/issues/${id}/return`, body),
  portfolio: (studentId: string) => get<Portfolio>(`/clubs/portfolio/${studentId}`),
};

// ── showcase ───────────────────────────────────────────────────────────

export type ShowcaseCategory = 'ACADEMIC' | 'SPORTS' | 'ARTS' | 'OLYMPIAD' | 'SERVICE' | 'OTHER';
export interface PublishedEntry { id: string; editionId: string; kind: 'RANK' | 'ACHIEVEMENT'; category: ShowcaseCategory; studentName: string | null; title: string; detail: string | null; level: string | null; rank: number | null; publishedAt: string }
export interface PublishedShowcase { rankCutoff: number; editions: Array<{ id: string; title: string; periodLabel: string | null; description: string; publishedAt: string; entries: PublishedEntry[] }>; highlights: PublishedEntry[] }
export interface Edition { id: string; title: string; periodLabel: string | null; description: string; status: 'DRAFT' | 'PUBLISHED' | 'WITHDRAWN'; publishedAt: string | null; withdrawnAt: string | null; counts: Record<string, number> }
export interface DraftEntry {
  id: string; editionId: string; kind: 'RANK' | 'ACHIEVEMENT'; category: ShowcaseCategory; studentId: string; studentName: string | null; title: string; detail: string | null; level: string | null;
  rank: number | null; rankScope: string | null; status: 'DRAFT' | 'REVIEWED' | 'PUBLISHED' | 'EXCLUDED' | 'WITHDRAWN'; excludedReason: string | null; withdrawReason: string | null;
  consent: boolean; draftedBy: string | null; reviewedBy: string | null; reviewedAt: string | null; publishedAt: string | null; history: HistoryEntry[]; source: string;
}
export interface EditionDetail extends Edition { history: HistoryEntry[]; entries: DraftEntry[]; settings: { rankCutoff: number } }
export interface Candidate { source: 'COCURRICULAR' | 'FIXTURE'; sourceId: string; studentId: string; studentName: string | null; category: ShowcaseCategory; title: string; detail: string | null; level: string | null; on: string; consent: boolean }
export interface ShowcaseOptions { exams: Array<{ id: string; name: string; startsOn: string }>; sections: Array<{ id: string; label: string }>; grades: Array<{ id: string; name: string }>; settings: { rankCutoff: number } }
export interface RankPreview { exam: { id: string; name: string }; scope: string; label: string; rankCutoff: number; rows: Array<{ studentId: string; name: string | null; rank: number; consent: boolean }>; unranked: number; tieRule: string }

export const showcaseApi = {
  published: (p: Q = {}) => get<PublishedShowcase>('/showcase', p),
  options: () => get<ShowcaseOptions>('/showcase/options'),
  saveSettings: (rankCutoff: number) => put<{ rankCutoff: number }>('/showcase/settings', { rankCutoff }),
  rankPreview: (p: Q) => get<RankPreview>('/showcase/rank-preview', p),
  candidates: () => get<Candidate[]>('/showcase/candidates'),
  editions: () => get<Edition[]>('/showcase/editions'),
  createEdition: (body: Record<string, unknown>) => post<Edition>('/showcase/editions', body),
  edition: (id: string) => get<EditionDetail>(`/showcase/editions/${id}`),
  draftRanks: (id: string, body: Record<string, unknown>) => post<EditionDetail & { created: number }>(`/showcase/editions/${id}/rank-entries`, body),
  addEntry: (id: string, body: Record<string, unknown>) => post<DraftEntry>(`/showcase/editions/${id}/entries`, body),
  publish: (id: string) => post<{ published: number; excluded: Array<{ entryId: string; studentId: string; reason: string }>; edition: EditionDetail }>(`/showcase/editions/${id}/publish`),
  withdrawEdition: (id: string, reason: string) => post<EditionDetail>(`/showcase/editions/${id}/withdraw`, { reason }),
  review: (id: string, decision: 'APPROVE' | 'RETURN', note?: string) => post<DraftEntry>(`/showcase/entries/${id}/review`, { decision, note }),
  withdrawEntry: (id: string, reason: string) => post<DraftEntry>(`/showcase/entries/${id}/withdraw`, { reason }),
  removeEntry: (id: string) => del<{ removed: boolean }>(`/showcase/entries/${id}`),
};
