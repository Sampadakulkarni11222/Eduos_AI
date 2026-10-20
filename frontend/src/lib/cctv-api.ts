/**
 * Typed client for live CCTV viewing (backend modules/cctv, feature cctvLive).
 *
 * The browser never receives the gateway address, a camera path or any
 * credential. Starting a viewing returns a short-lived playback token; media
 * is fetched through the EduOS proxy (HLS) or a server-signed WHEP exchange.
 */
import { request } from './api';
import { post, put, patch, qs } from './ops-api';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:5000';
/** Absolute URL for a playback path returned by the API (e.g. /cctv/play/<id>/index.m3u8?t=…). */
export const playbackUrl = (path: string) => `${BACKEND_URL}/api/v1${path}`;

export type CameraHealth = 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'NOT_CONNECTED';
export interface CctvCamera {
  id: string; name: string; zone: string | null; facilityId: string | null; facilityName: string | null; locationKind: string; roomLabel: string | null;
  purpose: string; group: string; privacyClass: string; streamType: 'WHEP' | 'HLS'; health: CameraHealth; lastCheckedAt: string | null; reasonRequired: boolean;
}
export interface CctvManagedCamera extends CctvCamera { enabled: boolean; streamPath: string | null; hasCredentials: boolean; approvalNote: string | null; lastCheckMessage: string | null }
export interface CctvGateway { configured: boolean; lastTestAt: string | null; lastTestOk: boolean | null; baseUrl?: string | null; vendor?: string; authMode?: string; hasCredentials?: boolean; lastTestMessage?: string | null }
export interface CctvStatus {
  enabled: boolean; canView: boolean; scope: 'ALL' | 'OWN' | null; canManage: boolean; canSeeLog: boolean; gateway: CctvGateway;
  reasonRequired: boolean; idleMinutes: number; maxSessionMinutes: number; limits: string; setupSteps: string[];
}
export interface CctvSettings { gateway: CctvGateway; reasonRequired: boolean; idleMinutes: number; maxSessionMinutes: number; groupGrants: Array<{ roleKey: string; groups: string[] }> }
export interface CctvPlayback {
  sessionId: string; streamType: 'WHEP' | 'HLS'; token: string; tokenExpiresAt: string; playbackPath: string | null; whepPath: string | null;
  confirmBy: string; endsBy: string; camera?: { id: string; name: string; zone: string | null }; watermark?: { name: string; role: string | null }; idleMinutes?: number;
}
export interface CctvViewLog { date: string; scope: 'ALL' | 'OWN'; items: Array<{ id: string; camera: string; streamId: string; zone: string | null; viewer: string | null; role: string | null; reason: string | null; channel: string; startedAt: string; endedAt: string | null; endReason: string | null; open: boolean; minutes: number }> }

export const cctvApi = {
  status: () => request<CctvStatus>('/cctv/status'),
  cameras: () => request<CctvCamera[]>('/cctv/streams'),
  managed: () => request<CctvManagedCamera[]>('/cctv/streams/manage'),
  createCamera: (body: unknown) => post<CctvManagedCamera>('/cctv/streams', body),
  updateCamera: (id: string, body: unknown) => patch<CctvManagedCamera>(`/cctv/streams/${id}`, body),
  checkCameras: () => post<{ checked: number; online: number; offline: number; connected: boolean }>('/cctv/streams/check', {}),
  settings: () => request<CctvSettings>('/cctv/settings'),
  saveSettings: (body: unknown) => put<CctvSettings>('/cctv/settings', body),
  testGateway: () => post<{ ok: boolean; message: string; cameras: { online: number; offline: number } | null }>('/cctv/settings/test', {}),
  start: (cameraId: string, reason?: string) => post<CctvPlayback>(`/cctv/streams/${cameraId}/sessions`, { reason }),
  renew: (sessionId: string, stillWatching = false) => post<CctvPlayback>(`/cctv/sessions/${sessionId}/renew`, { stillWatching }),
  end: (sessionId: string) => post<{ ended: boolean }>(`/cctv/sessions/${sessionId}/end`, {}),
  viewLog: (date?: string) => request<CctvViewLog>(`/cctv/view-log${qs({ date })}`),
  /** WHEP: the offer goes to EduOS with the playback token; EduOS signs the gateway request and returns only the answer. */
  async whep(path: string, token: string, sdp: string): Promise<string> {
    const res = await fetch(playbackUrl(path), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Playback-Token': token }, body: JSON.stringify({ sdp }) });
    const body = await res.json().catch(() => null) as { data?: { sdp?: string }; message?: string } | null;
    if (!res.ok || !body?.data?.sdp) throw new Error(body?.message ?? `The camera could not be connected (HTTP ${res.status}).`);
    return body.data.sdp;
  },
};
