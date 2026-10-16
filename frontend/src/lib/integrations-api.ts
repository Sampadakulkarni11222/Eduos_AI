import { request } from './api';
import { post, put } from './ops-api';

/**
 * OAuth connections to the provider apps (backend modules/integrations):
 * Meta, Google, LinkedIn and X. Tokens never reach the browser; only status,
 * granted scopes, what the account can reach (names and ids) and errors.
 */

export type ProviderKey = 'META' | 'GOOGLE' | 'LINKEDIN' | 'X';
export type Purpose = 'ads' | 'social';

export interface AssetRef { id?: string; urn?: string; name: string; igUserId?: string | null; igUsername?: string | null; currency?: string | null }
export interface ConnectionDto {
  provider: ProviderKey; status: 'CONNECTED' | 'NEEDS_RECONNECT' | 'DISCONNECTED'; purposes: Purpose[]; scopes: string[]; accountName: string | null;
  assets: {
    metaPages?: AssetRef[]; metaAdAccounts?: AssetRef[]; googleCustomers?: AssetRef[]; ga4Properties?: AssetRef[]; youtubeChannels?: AssetRef[];
    linkedinOrgs?: AssetRef[]; linkedinAdAccounts?: AssetRef[]; xUser?: { id: string; username: string; name: string } | null;
  };
  selected: Record<string, string | null>;
  accessExpiresAt: string | null; lastRefreshAt: string | null; lastError: { at: string; message: string } | null;
  connectedAt: string | null; connectedByName: string | null; revokeResult: string | null;
}
export interface ProviderDto {
  provider: ProviderKey; label: string; appConfigured: boolean; missingEnv: string[]; message: string | null; pkce: boolean;
  products: Record<Purpose, string[]>; scopes: Record<Purpose, string[]>; canConnect: Record<Purpose, boolean>;
  mode: 'LIVE' | 'SIMULATED'; connection: ConnectionDto | null;
}
export interface IntegrationsOverview { redirectUri: string; providers: ProviderDto[] }

const B = '/integrations';
export const OAUTH_STORAGE_KEY = 'eduos.oauth';

export const integrationsApi = {
  overview: () => request<IntegrationsOverview>(B),
  connect: (provider: ProviderKey, body: { purposes: Purpose[]; browserNonce: string; returnPath: string }) =>
    post<{ provider: ProviderKey; authorizeUrl: string; purposes: Purpose[]; scopes: string[] }>(`${B}/${provider}/connect`, body),
  complete: (body: { state: string; code?: string; error?: string; errorDescription?: string; browserNonce: string }) =>
    post<{ provider: ProviderKey; returnPath: string | null; connection: ConnectionDto }>(`${B}/oauth/complete`, body),
  selectAssets: (provider: ProviderKey, body: Record<string, string | null>) => put<ConnectionDto>(`${B}/${provider}/assets`, body),
  refreshAssets: (provider: ProviderKey) => post<ConnectionDto>(`${B}/${provider}/refresh-assets`),
  disconnect: (provider: ProviderKey) => post<ConnectionDto>(`${B}/${provider}/disconnect`),
  engagement: (socialPostId: string) => post<{ updated: number }>(`${B}/social-posts/${socialPostId}/engagement`),
};

/** A random nonce the tab keeps in sessionStorage; the server binds the OAuth state to it. */
export function newBrowserNonce(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Only a same-site path is ever used as the place to return to. */
export function safeReturnPath(p: unknown): string | null {
  return typeof p === 'string' && /^\/[A-Za-z0-9\-_/]{0,200}$/.test(p) && !p.startsWith('//') ? p : null;
}
