/**
 * Typed client for alumni (/alumni), newsroom social publishing (/social) and
 * the daily learning digest (/digest). The server enforces every rule:
 * consent per directory field, staff-only external publishing, consent
 * re-checked at publishing, and SSRF-safe feed fetching.
 */
import { request } from './api';
import { qs, post, put, patch } from './ops-api';

type Q = Record<string, string | number | boolean | null | undefined>;
const get = <R>(path: string, params?: Q) => request<R>(`${path}${qs(params)}`);

export type LinkKey = 'linkedin' | 'instagram' | 'github' | 'website';
export type Links = Partial<Record<LinkKey, string | null>>;
export const LINK_LABELS: Record<LinkKey, string> = { linkedin: 'LinkedIn', instagram: 'Instagram', github: 'GitHub', website: 'Personal site' };
export const LINK_HINTS: Record<LinkKey, string> = {
  linkedin: 'https://www.linkedin.com/in/…', instagram: 'https://www.instagram.com/…', github: 'https://github.com/…', website: 'https://… (a public site)',
};

export interface DirectoryEntry { id: string; name: string; kind: 'FORMER_STUDENT' | 'FORMER_STAFF'; batchLabel: string; batchYear: number | null; section: string | null; house: string | null; servedFrom: number | null; servedTo: number | null; profession?: string; city?: string; links?: Links }
export interface AlumnusMe extends DirectoryEntry { profileId: string | null; leftReason: string; listed: boolean; verified: boolean; status: string; profession: string; city: string; links: Links; consent: { profession: boolean; city: boolean; links: boolean }; transitionedAt: string }
export interface AlumniRecord extends DirectoryEntry { leftReason: string; formerRole: string | null; hasLogin: boolean; listed: boolean; verified: boolean; status: string; consent: { profession: boolean; city: boolean; links: boolean }; transitionedAt: string }
export interface ArchivedRecord { kind: string; name: string; admissionNo?: string | null; batchLabel?: string; role?: string; servedFrom?: number; servedTo?: number; leftReason: string; enrolments?: Array<{ year: string | null; class: string | null; status: string }>; note: string }
export interface BatchRow { year: number; students: number; staff: number }
export interface AlumniCircle { id: string; name: string; description: string | null; members: number }
export interface AlumniPost { id: string; title: string | null; body: string; circleId: string; circle: string | null; authorName: string | null; status: string; publishedAt: string | null; createdAt: string; note: string | null }
export interface AlumniEvent { id: string; title: string; description: string | null; batchYear: number | null; audience: string; startsAt: string; venue: string | null; status: string; rsvp: { yes: number; maybe: number; no: number; mine: string | null } }
export interface StudentLinks { studentId: string; name?: string; relation?: string; minor?: boolean; links: Links | null; studentConsent?: boolean; guardianConsent?: boolean; shared: boolean; rule?: string }

export const alumniApi = {
  me: () => get<AlumnusMe>('/alumni/me'),
  updateMe: (body: unknown) => put<AlumnusMe>('/alumni/me', body),
  myRecord: () => get<ArchivedRecord>('/alumni/me/record'),
  directory: (p: Q = {}) => get<{ items: DirectoryEntry[]; note: string }>('/alumni/directory', p),
  batches: () => get<BatchRow[]>('/alumni/batches'),
  circles: () => get<AlumniCircle[]>('/alumni/circles'),
  posts: (p: Q = {}) => get<AlumniPost[]>('/alumni/posts', p),
  createPost: (body: { circleId: string; title?: string; body: string }) => post<AlumniPost>('/alumni/posts', body),
  moderatePost: (id: string, decision: 'PUBLISH' | 'REJECT' | 'TAKE_DOWN', note?: string) => post<AlumniPost>(`/alumni/posts/${id}/moderate`, { decision, note }),
  events: () => get<AlumniEvent[]>('/alumni/events'),
  createEvent: (body: unknown) => post<AlumniEvent>('/alumni/events', body),
  cancelEvent: (id: string, note?: string) => post<AlumniEvent>(`/alumni/events/${id}/cancel`, { note }),
  rsvp: (id: string, response: 'YES' | 'NO' | 'MAYBE') => post<AlumniEvent>(`/alumni/events/${id}/rsvp`, { response }),
  records: (p: Q = {}) => get<AlumniRecord[]>('/alumni/records', p),
  updateRecord: (id: string, body: unknown) => patch<AlumniRecord>(`/alumni/records/${id}`, body),
  transition: (body: unknown) => post<AlumnusMe>('/alumni/transitions', body),
  myStudentLinks: () => get<StudentLinks[]>('/alumni/student-links/mine'),
  studentLinks: (studentId: string) => get<StudentLinks>(`/alumni/student-links/${studentId}`),
  setStudentLinks: (studentId: string, body: unknown) => put<StudentLinks>(`/alumni/student-links/${studentId}`, body),
};

export const NETWORKS = ['FACEBOOK', 'INSTAGRAM', 'X', 'LINKEDIN', 'YOUTUBE'] as const;
export type Network = (typeof NETWORKS)[number];
export const NETWORK_LABELS: Record<Network, string> = { FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', X: 'X', LINKEDIN: 'LinkedIn', YOUTUBE: 'YouTube community' };
export interface OutboxRow { network: Network; label: string; status: 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'SIMULATED'; statusReason: string | null; attempts: number; lastAttemptAt: string | null; display: string }
export interface SocialPostDto { id: string; text: string; link: string | null; networks: Network[]; studentIds: string[]; noIdentifiableStudents: boolean; status: 'DRAFT' | 'PUBLISHING' | 'DONE' | 'BLOCKED'; blockedReason: string | null; createdByName: string | null; createdAt: string; communityPostId: string | null; outbox: OutboxRow[] }
export interface SocialAccountDto { id: string; network: Network; label: string; handle: string; status: string; statusNote: string; createdAt: string }
export interface ShareableStory { id: string; title: string | null; excerpt: string; publishedAt: string | null; taggedStudents: number }

export const socialApi = {
  accounts: () => get<{ accounts: SocialAccountDto[]; networks: Array<{ key: Network; label: string; credentials: string }> }>('/social/accounts'),
  connect: (body: { network: Network; handle: string }) => post<SocialAccountDto>('/social/accounts', body),
  disconnect: (id: string) => post<SocialAccountDto>(`/social/accounts/${id}/disconnect`),
  stories: () => get<ShareableStory[]>('/social/stories'),
  posts: () => get<SocialPostDto[]>('/social/posts'),
  compose: (body: unknown) => post<SocialPostDto>('/social/posts', body),
  publish: (id: string) => post<SocialPostDto>(`/social/posts/${id}/publish`),
};

export interface DigestItemDto { id: string; title: string; link: string; summary: string; sourceTitle: string | null; publishedAt: string | null; interest: string | null; interestLabel: string | null }
export interface DigestToday { day: string; interests: string[]; items: DigestItemDto[]; note: string }
export interface DigestSourceDto { id: string; title: string; url: string; interests: string[]; interestLabels: string[]; status: 'APPROVED' | 'PAUSED'; approvedByName: string | null; lastFetchedAt: string | null; lastStatus: 'NEVER' | 'OK' | 'FAILED'; lastError: string | null; lastItemCount: number }

export const digestApi = {
  today: () => get<DigestToday>('/digest/today'),
  interests: () => get<{ interests: Array<{ key: string; label: string }>; mine: { interests: string[]; emailOptIn: boolean } }>('/digest/interests'),
  setPreferences: (body: { interests?: string[]; emailOptIn?: boolean }) => put<{ interests: Array<{ key: string; label: string }>; mine: { interests: string[]; emailOptIn: boolean } }>('/digest/preferences', body),
  sources: () => get<DigestSourceDto[]>('/digest/sources'),
  addSource: (body: { title: string; url: string; interests: string[] }) => post<DigestSourceDto>('/digest/sources', body),
  updateSource: (id: string, body: unknown) => patch<DigestSourceDto>(`/digest/sources/${id}`, body),
  checkSource: (id: string) => post<{ source: DigestSourceDto; added: number }>(`/digest/sources/${id}/check`),
  run: () => post<{ sources: number; failed: number; added: number; built: number; emailed: number }>('/digest/run'),
};
