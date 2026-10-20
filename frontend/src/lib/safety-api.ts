/**
 * Typed client for ID checkpoints, visitors and pickup, hostel out-pass,
 * class check-in, the device registry and the optional camera review
 * (backend modules/safety and modules/hostel/outpass).
 */
import { request } from './api';
import { qs, post, put } from './ops-api';
import type { AdultsForStudent } from './fleet-api';

type Q = Record<string, string | number | boolean | null | undefined>;
const get = <R>(path: string, params?: Q) => request<R>(`${path}${qs(params)}`);

export interface CardDto { id: string; holderType: string; holderName: string; code: string; codeType: string; status: string; issuedAt: string; statusReason: string | null; replacesCardId: string | null; replacedByCardId: string | null; studentId: string | null }
export interface CheckpointEventDto { id: string; code: string; holderName: string | null; point: string; pointLabel: string; locationLabel: string | null; scannedAt: string; receivedAt: string; source: string; result: string; flags: string[] }
export interface ScanResult { result: string; duplicate?: boolean; holderName?: string; flags?: string[]; message: string }
export interface VisitorDto { id: string; refNo: string; kind: string; name: string; phone: string | null; organisation: string | null; purpose: string; location: string | null; hostName: string | null; hostProfileId: string | null; expectedAt: string | null; status: string; idVerified: boolean; idType: string | null; idLast4: string | null; badge: { number: string | null; expiresAt: string | null }; checkedInAt: string | null; checkedOutAt: string | null; overstaying: boolean }
export interface ReleaseDto { id: string; studentName: string; context: string; receivedByKind: string; receivedByName: string; verification: string; recordedByName: string | null; at: string; note: string | null }
export interface MyPickup {
  children: Array<{ id: string; name: string }>;
  adults: Array<{ id: string; studentId: string; kind: string; name: string; relationship: string | null; status: string; validFrom: string | null; validTo: string | null; validNow: boolean; createdVia: string }>;
  recentReleases: Array<{ id: string; studentId: string; studentName: string; context: string; receivedByKind: string; receivedByName: string; at: string }>;
}
export interface Roster { asOf: string; students: Array<{ studentId: string; name: string; admissionNo: string | null; section: string | null; rollNo: number | null }>; visitors: Array<{ id: string; name: string; kind: string; organisation: string | null; location: string | null; host: string | null; checkedInAt: string | null; badge: string | null }>; releasedToday: number; onOutPass: number; note: string }
export interface OutPassDto { id: string; refNo: string; studentId: string; studentName: string; requestedByRole: string; fromAt: string; toAt: string; reason: string; destination: string; escort: { name: string | null; relationship: string | null; phone: string | null }; status: string; parentDecision?: { decision: string | null; at: string | null; note: string | null }; wardenDecision?: { decision: string | null; at: string | null; note: string | null }; exitAt: string | null; exitVia: string | null; returnAt: string | null; late: boolean; overdue: boolean; history?: Array<{ at: string; action: string; actorName: string | null; note: string | null }> }
export interface DeviceDto { id: string; deviceKey: string; kind: string; label: string; status: string; provider: string | null; lastSeenAt: string | null; secretRotatedAt: string; checkpoint?: { point: string | null; locationLabel: string | null }; camera?: { purpose: string | null; locationKind: string | null; roomLabel: string | null; retentionDays: number; health: string; lastHeartbeatAt: string | null; approvalNote: string | null }; secret?: string; secretNote?: string }
export interface ObservationDto { id: string; deviceLabel: string | null; type: string; confidence: number | null; observedAt: string; receivedAt: string; room: string | null; status: string; evidenceAvailable: boolean; evidenceRef?: string | null; context?: { scheduled: boolean; summary: string; teacherName?: string | null; checkIn?: { name: string | null; at: string } | null; cover?: { substituteName: string | null } | null; leave?: { kind: string } | null } | null; reviews?: Array<{ byName: string; at: string; decision: string; notes: string; correctionOf: string | null }>; safeguardingRef?: string | null; history?: unknown[] }
export interface CameraMetrics { since: string; types: Array<{ type: string; total: number; reviewed: number; unverified: number; confirmed: number; falseAlert: number; needsFollowUp: number; falseAlertRate: number | null; medianMinutesToReview: number | null }>; note: string }

export const safetyApi = {
  // checkpoints
  cards: (p: Q = {}) => get<CardDto[]>('/checkpoints/cards', p),
  issueCard: (body: unknown) => post<CardDto>('/checkpoints/cards', body),
  blockCard: (id: string, status: 'LOST' | 'REVOKED', reason: string) => post<CardDto>(`/checkpoints/cards/${id}/block`, { status, reason }),
  replaceCard: (id: string, reason: string) => post<{ old: CardDto; card: CardDto }>(`/checkpoints/cards/${id}/replace`, { reason }),
  events: (p: Q = {}) => get<{ events: CheckpointEventDto[]; disclaimer: string }>('/checkpoints/events', p),
  scan: (body: { code: string; point: string; locationLabel?: string }) => post<ScanResult>('/checkpoints/scan', body),
  myChildrenCheckpoints: (p: Q = {}) => get<{ children: Array<{ studentId: string; name: string; events: Array<{ id: string; point: string; pointLabel: string; at: string; location: string | null }> }>; disclaimer: string }>('/checkpoints/my-children', p),
  // visitors
  visitors: (p: Q = {}) => get<VisitorDto[]>('/visitors', p),
  hosting: () => get<VisitorDto[]>('/visitors/hosting'),
  createVisitor: (body: unknown) => post<VisitorDto>('/visitors', body),
  visitorAction: (id: string, action: 'host-decision' | 'check-in' | 'check-out' | 'cancel', body: unknown = {}) => post<VisitorDto>(`/visitors/${id}/${action}`, body),
  // pickup
  myPickup: () => get<MyPickup>('/pickup/mine'),
  requestDelegate: (body: unknown) => post<{ id: string; status: string; codeSent: boolean; devOtp?: string }>('/pickup/mine/delegates', body),
  confirmDelegate: (id: string, code: string) => post<unknown>(`/pickup/mine/delegates/${id}/confirm`, { code }),
  revokeMyDelegate: (id: string) => post<unknown>(`/pickup/mine/delegates/${id}/revoke`, {}),
  adultsFor: (studentId: string) => get<AdultsForStudent>(`/pickup/students/${studentId}`),
  addAdult: (body: unknown) => post<unknown>('/pickup/adults', body),
  revokeAdult: (id: string, note?: string) => post<unknown>(`/pickup/adults/${id}/revoke`, { note }),
  release: (body: unknown) => post<ReleaseDto>('/pickup/release', body),
  releases: (p: Q = {}) => get<ReleaseDto[]>('/pickup/releases', p),
  roster: () => get<Roster>('/safety/emergency-roster'),
  // out-pass
  outpasses: (p: Q = {}) => get<OutPassDto[]>('/outpass', p),
  outpass: (id: string) => get<OutPassDto>(`/outpass/${id}`),
  requestOutpass: (body: unknown) => post<OutPassDto>('/outpass', body),
  outpassAction: (id: string, action: 'parent-decision' | 'decision' | 'gate' | 'cancel', body: unknown = {}) => post<OutPassDto>(`/outpass/${id}/${action}`, body),
  // devices
  devices: (p: Q = {}) => get<DeviceDto[]>('/safety/devices', p),
  createDevice: (body: unknown) => post<DeviceDto>('/safety/devices', body),
  rotateSecret: (id: string) => post<DeviceDto>(`/safety/devices/${id}/rotate-secret`, {}),
  deviceStatus: (id: string, status: 'ACTIVE' | 'DISABLED') => post<DeviceDto>(`/safety/devices/${id}/status`, { status }),
  settings: () => get<Record<string, Record<string, number | string | boolean>>>('/safety/settings'),
  saveSettings: (body: unknown) => put<unknown>('/safety/settings', body),
  // camera
  cameraStatus: () => get<{ enabled: boolean; limits: string }>('/camera/status'),
  cameraDevices: () => get<DeviceDto[]>('/camera/devices'),
  observations: (p: Q = {}) => get<{ items: ObservationDto[]; limits: string }>('/camera/observations', p),
  observation: (id: string) => get<ObservationDto>(`/camera/observations/${id}`),
  reviewObservation: (id: string, body: { decision: string; notes: string; correctionReason?: string }) => post<ObservationDto>(`/camera/observations/${id}/review`, body),
  linkCase: (id: string, body: unknown) => post<ObservationDto>(`/camera/observations/${id}/link-case`, body),
  cameraMetrics: () => get<CameraMetrics>('/camera/metrics'),
  // class check-in
  myCheckIns: () => get<Array<{ id: string; periodNo: number; room: string | null; checkedInAt: string; coveringForProfileId: string | null }>>('/class-check-ins/mine'),
  checkIn: (body: { periodNo: number; sectionId?: string; coveringForProfileId?: string; note?: string }) => post<unknown>('/class-check-ins', body),
};
