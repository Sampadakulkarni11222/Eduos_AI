import { request, fileHref } from './api';
import { qs, post, put, patch } from './ops-api';
import type { Attachment, HistoryEntry } from './ops-types';

/** Offline campaigns, attribution and ad-platform connectors (backend modules/marketing/growth*, connectors*). */

export const OFFLINE_CHANNELS: Array<[string, string]> = [
  ['BANNER_HOARDING', 'Banner / hoarding'], ['PAMPHLET_FLYER', 'Pamphlet / flyer'], ['POSTER', 'Poster'], ['NEWSPAPER_AD', 'Newspaper ad'],
  ['RADIO_SPOT', 'Radio spot'], ['LOCAL_TV_CABLE', 'Local TV / cable'], ['SCHOOL_EVENT_OPEN_HOUSE', 'School event / open house'], ['SEMINAR', 'Seminar'],
  ['REFERRAL_DRIVE', 'Referral drive'], ['SOCIETY_ACTIVATION', 'Society / apartment activation'], ['SCHOOL_FAIR_STALL', 'School fair stall'], ['OTHER_OFFLINE', 'Other offline'],
];
export const HEARD_FROM_CHANNELS: Array<[string, string]> = [
  ...OFFLINE_CHANNELS, ['ONLINE_SOCIAL', 'Social media (organic)'], ['ONLINE_SEARCH', 'Search engine'], ['ONLINE_WEBSITE', 'School website'], ['WORD_OF_MOUTH', 'Word of mouth / friend'],
  ['WALK_IN', 'Walk-in'], ['META_ADS', 'Meta ads'], ['GOOGLE_ADS', 'Google Ads'], ['YOUTUBE', 'YouTube'], ['LINKEDIN', 'LinkedIn'], ['OTHER', 'Other'],
];

export interface Results { enquiries: number; visits: number; applications: number; admissions: number }
export interface OfflineCampaignDto extends Partial<Results> {
  id: string; name: string; code: string; channelType: string; channelLabel: string; campaignId: string | null;
  placements: Array<{ location: string; detail: string | null; quantity: number | null }>; startsOn: string; endsOn: string; quantity: number | null; vendorName: string | null;
  costPaise: number; billId: string | null; assets: Attachment[]; trackingPhone: string | null; promoCode: string | null; status: string;
  decision?: { byName: string | null; at: string | null; note: string | null }; scans: number; lastScanAt: string | null; createdByProfileId: string | null; history?: HistoryEntry[];
  results: Results;
}
export interface HeardFromDto { id: string; label: string; channel: string; channelLabel: string; offlineCampaignId: string | null; active: boolean; order: number }
export interface ReportRow extends Results {
  id?: string; name?: string; code?: string; channel: string; channelLabel: string; status?: string; costPaise: number; simulatedCostPaise?: number; scans?: number;
  impressions?: number; clicks?: number; platformLeads?: number; platforms?: string[];
  costPerEnquiryPaise: number | null; costPerAdmissionPaise: number | null; conversionPct: number | null; roiPct: number | null;
}
export interface AttributionDto {
  window: { from: string | null; to: string | null }; admissionValuePaise: number | null; totals: ReportRow; offline: ReportRow[]; online: ReportRow[]; channels: ReportRow[];
  simulatedSpendPaise: number; definitions: Record<string, string>;
}
export interface ConnectorDto {
  platform: string; label: string; status: string; statusLabel: string; accountLabel: string | null; credentialHint: string | null; leadWebhook: boolean; webhookConfigured: boolean;
  lastWebhookAt: string | null; csv: { how: string; columns: string[]; example: string }; simulatedRows: number;
  lastImport: { at: string; kind: string; accepted: number; rejected: number; fileName: string | null } | null;
  /** The live-API side (OAuth connection and last sync); absent on older servers. */
  live?: {
    provider: string | null; mode: 'LIVE' | 'SIMULATED' | 'CSV_ONLY'; appConfigured: boolean; connected: boolean; connectionStatus: string | null;
    lastSync: { at: string; ok: boolean | null; partial: boolean; from: string | null; to: string | null; rows: number; trigger: string | null; message: string | null; problems: Array<{ scope: string; problem: string }> } | null;
    lastSyncOkAt: string | null; lastError: string | null;
  };
}
export interface ImportResult { importId: string; platform: string; rows: number; accepted?: number; rejected: number; created?: number; duplicates?: number; matchedToCampaigns?: number; problems: Array<{ row: number; problem: string }> }
export interface ImportDto { id: string; platform: string; kind: string; fileName: string | null; rows: number; accepted: number; rejected: number; created: number; duplicates: number; simulated: boolean; at: string; problems: Array<{ row: number; problem: string }> }
export interface MetricSummaryDto { platform: string; platformLabel: string; campaignName: string; simulated: boolean; campaignId: string | null; spendPaise: number; impressions: number; clicks: number; leads: number; days: number; costPerLeadPaise: number | null; ctrPct: number | null }
export interface WebhookSecretDto { platform: string; secret: string; verifyToken: string; path: string; signature: string; note: string }

type Q = Record<string, string | number | boolean | null | undefined>;
const B = '/marketing-growth';

export const growthApi = {
  offline: (p: Q = {}) => request<OfflineCampaignDto[]>(`${B}/offline${qs(p)}`),
  createOffline: (body: unknown) => post<OfflineCampaignDto>(`${B}/offline`, body),
  updateOffline: (id: string, body: unknown) => patch<OfflineCampaignDto>(`${B}/offline/${id}`, body),
  moveOffline: (id: string, action: string, note?: string) => post<OfflineCampaignDto>(`${B}/offline/${id}/move`, { action, note }),
  heardFrom: () => request<HeardFromDto[]>(`${B}/heard-from`),
  saveHeardFrom: (body: unknown) => post<HeardFromDto>(`${B}/heard-from`, body),
  settings: () => request<{ admissionValuePaise: number | null }>(`${B}/settings`),
  saveSettings: (body: unknown) => put<{ admissionValuePaise: number | null }>(`${B}/settings`, body),
  attribution: (p: Q = {}) => request<AttributionDto>(`${B}/attribution${qs(p)}`),
  attributionCsvPath: (p: Q = {}) => `${B}/attribution.csv${qs(p)}`,
  connectors: () => request<ConnectorDto[]>(`${B}/connectors`),
  imports: (p: Q = {}) => request<ImportDto[]>(`${B}/connectors/imports${qs(p)}`),
  metrics: (p: Q = {}) => request<MetricSummaryDto[]>(`${B}/connectors/metrics${qs(p)}`),
  saveCredentials: (platform: string, body: unknown) => put<ConnectorDto>(`${B}/connectors/${platform}/credentials`, body),
  sync: (platform: string, range: { from?: string; to?: string } = {}) => post<{ synced: boolean; message: string; ok?: boolean; partial?: boolean; rows?: number }>(`${B}/connectors/${platform}/sync`, range),
  rotateWebhook: (platform: string) => post<WebhookSecretDto>(`${B}/connectors/${platform}/webhook-secret`),
  importMetrics: (platform: string, csv: string, fileName?: string) => post<ImportResult>(`${B}/connectors/${platform}/import`, { csv, fileName }),
  importLeads: (platform: string, csv: string, fileName?: string) => post<ImportResult>(`${B}/connectors/${platform}/import-leads`, { csv, fileName }),
  sample: (platform: string, on: boolean) => post<{ platform: string; simulatedRows: number }>(`${B}/connectors/${platform}/sample`, { on }),
  leadAttribution: (leadId: string) => request<{ credited: { channelLabel: string; via: string } | null; touches: Array<{ id: string; via: string; channelLabel: string; detail: string | null; at: string }> }>(`${B}/leads/${leadId}/attribution`),
  attributeLead: (leadId: string, body: unknown) => post<unknown>(`${B}/leads/${leadId}/attribution`, body),
};

/** Where a printed QR code or short link points: the API counts the open and redirects to the form. */
export function shortLink(school: string, code: string) {
  return fileHref(`/api/v1/public/marketing/r/${encodeURIComponent(school)}/${encodeURIComponent(code)}`);
}
/** The online admission form with the campaign's UTM, for digital use (no redirect). */
export function formLink(origin: string, school: string, code: string, channel: string) {
  const u = new URL(`${origin.replace(/\/$/, '')}/public/admission/${encodeURIComponent(school)}`);
  u.searchParams.set('utm_source', 'offline'); u.searchParams.set('utm_medium', channel.toLowerCase()); u.searchParams.set('utm_campaign', code); u.searchParams.set('mc', code);
  return u.toString();
}

/** Public (no sign-in): the "How did you hear about us?" answers for the online admission form. */
export async function publicHeardFrom(school: string): Promise<Array<{ id: string; label: string }>> {
  try {
    const res = await fetch(fileHref(`/api/v1/public/marketing/${encodeURIComponent(school)}/heard-from`), { credentials: 'omit' });
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body?.data) ? body.data : [];
  } catch { return []; }
}

/** Campaign parameters a short link, QR code or ad put on the form's address (utm_*, mc). */
export function attributionFromUrl(search: string): Record<string, string> {
  const p = new URLSearchParams(search);
  const out: Record<string, string> = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'mc']) {
    const v = p.get(k);
    if (v) out[k] = v.slice(0, 120);
  }
  return out;
}
