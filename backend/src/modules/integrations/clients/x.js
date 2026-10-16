import { apiRequest, ProviderError } from '../http.js';
import { PROVIDERS } from '../providers.js';

/** X API v2: OAuth 2.0 with PKCE (confidential client), the signed-in account, posting and public metrics. */
const P = 'X';
const app = () => PROVIDERS.X;
const basic = () => [app().clientId(), app().clientSecret()];

function tokenOut(d, prev = {}) {
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token ?? prev.refreshToken ?? null,
    expiresAt: d.expires_in ? Date.now() + Number(d.expires_in) * 1000 : null,
    refreshExpiresAt: null,
    scopes: d.scope ? String(d.scope).split(' ') : prev.scopes,
  };
}

export async function exchangeCode({ code, redirectUri, codeVerifier }) {
  const r = await apiRequest('https://api.x.com/2/oauth2/token', {
    method: 'POST', provider: P, idempotent: false, basic: basic(),
    form: { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier, client_id: app().clientId() },
  });
  return tokenOut(r.data);
}

export async function refresh(tokens) {
  if (!tokens.refreshToken) throw new ProviderError('X: no refresh token; reconnect the account', { auth: true });
  // X rotates the refresh token on every use; the new one replaces the old.
  const r = await apiRequest('https://api.x.com/2/oauth2/token', {
    method: 'POST', provider: P, idempotent: false, basic: basic(),
    form: { grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: app().clientId() },
  });
  return tokenOut(r.data, tokens);
}

export async function revoke(tokens) {
  for (const [token, hint] of [[tokens.refreshToken, 'refresh_token'], [tokens.accessToken, 'access_token']]) {
    // eslint-disable-next-line no-await-in-loop
    if (token) await apiRequest('https://api.x.com/2/oauth2/revoke', { method: 'POST', provider: P, idempotent: true, retries: 1, basic: basic(), form: { token, token_type_hint: hint } });
  }
  return 'Revoked at X';
}

export async function discover(tokens) {
  const r = await apiRequest('https://api.x.com/2/users/me', { bearer: tokens.accessToken, provider: P, query: { 'user.fields': 'username,name' } });
  const u = r.data?.data ?? {};
  return {
    accountName: u.username ? `@${String(u.username).slice(0, 60)}` : null,
    scopes: tokens.scopes ?? [],
    assets: { xUser: u.id ? { id: String(u.id), username: String(u.username ?? '').slice(0, 60), name: String(u.name ?? '').slice(0, 120) } : null },
    secrets: {},
    defaults: { xUserId: u.id ? String(u.id) : null },
  };
}

export async function publishPost(tokens, { text }) {
  const r = await apiRequest('https://api.x.com/2/tweets', { method: 'POST', bearer: tokens.accessToken, provider: P, idempotent: false, json: { text } });
  const id = r.data?.data?.id;
  if (!id || !/^\d+$/.test(String(id))) throw new ProviderError('X: the post was accepted without an id');
  return { providerPostId: String(id), permalink: `https://x.com/i/web/status/${id}` };
}

export async function postEngagement(tokens, id) {
  if (!/^\d+$/.test(String(id))) throw new ProviderError('X: bad post id');
  const r = await apiRequest(`https://api.x.com/2/tweets/${id}`, { bearer: tokens.accessToken, provider: P, query: { 'tweet.fields': 'public_metrics' } });
  const m = r.data?.data?.public_metrics ?? {};
  return { likes: m.like_count ?? 0, comments: m.reply_count ?? 0, shares: (m.retweet_count ?? 0) + (m.quote_count ?? 0), impressions: m.impression_count ?? null, permalink: null };
}
