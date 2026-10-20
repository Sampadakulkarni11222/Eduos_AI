import { apiRequest, ProviderError } from '../http.js';
import { PROVIDERS, GOOGLE_ADS_VERSION } from '../providers.js';

/**
 * Google: OAuth 2.0 (with PKCE), Google Ads API (GAQL through REST
 * searchStream), GA4 Data API runReport, GA4 Admin account summaries and the
 * YouTube Data API (channel discovery only).
 *
 * YouTube community posts have no public API, and video upload is not offered
 * here; the social publisher says so instead of pretending.
 */
const P = 'Google';
const app = () => PROVIDERS.GOOGLE;
const devToken = () => String(process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '').trim();
const CUSTOMER = /^\d{10}$/;
const PROPERTY = /^\d{1,20}$/;

function tokenOut(d, prev = {}) {
  return {
    accessToken: d.access_token,
    // Google returns a refresh token on the first consent only; keep the earlier one otherwise.
    refreshToken: d.refresh_token ?? prev.refreshToken ?? null,
    expiresAt: d.expires_in ? Date.now() + Number(d.expires_in) * 1000 : null,
    refreshExpiresAt: null,
    scopes: d.scope ? String(d.scope).split(' ') : prev.scopes,
  };
}

export async function exchangeCode({ code, redirectUri, codeVerifier }) {
  const r = await apiRequest('https://oauth2.googleapis.com/token', {
    method: 'POST', provider: P, idempotent: false,
    form: { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: app().clientId(), client_secret: app().clientSecret(), code_verifier: codeVerifier },
  });
  return tokenOut(r.data);
}

export async function refresh(tokens) {
  if (!tokens.refreshToken) throw new ProviderError('Google: no refresh token; reconnect the account', { auth: true });
  const r = await apiRequest('https://oauth2.googleapis.com/token', {
    method: 'POST', provider: P, idempotent: true,
    form: { grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: app().clientId(), client_secret: app().clientSecret() },
  });
  return tokenOut(r.data, tokens);
}

export async function revoke(tokens) {
  await apiRequest('https://oauth2.googleapis.com/revoke', { method: 'POST', provider: P, idempotent: true, retries: 1, form: { token: tokens.refreshToken || tokens.accessToken } });
  return 'Revoked at Google';
}

const adsHeaders = (loginCustomerId) => ({ 'developer-token': devToken(), ...(loginCustomerId && CUSTOMER.test(loginCustomerId) ? { 'login-customer-id': loginCustomerId } : {}) });

export async function discover(tokens) {
  const bearer = tokens.accessToken;
  const assets = { googleCustomers: [], ga4Properties: [], youtubeChannels: [] };
  const notes = [];
  if (devToken()) {
    try {
      const r = await apiRequest(`https://googleads.googleapis.com/${GOOGLE_ADS_VERSION()}/customers:listAccessibleCustomers`, { bearer, provider: P, headers: adsHeaders() });
      assets.googleCustomers = (r.data?.resourceNames ?? []).map((n) => String(n).replace('customers/', '')).filter((id) => CUSTOMER.test(id)).map((id) => ({ id, name: `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` }));
    } catch (err) { notes.push(`Google Ads: ${err.message}`); }
  } else notes.push('Google Ads needs GOOGLE_ADS_DEVELOPER_TOKEN on the server; Analytics and YouTube work without it.');
  try {
    const r = await apiRequest('https://analyticsadmin.googleapis.com/v1beta/accountSummaries', { bearer, provider: P, query: { pageSize: 200 } });
    for (const a of r.data?.accountSummaries ?? []) {
      for (const p of a.propertySummaries ?? []) {
        const id = String(p.property ?? '').replace('properties/', '');
        if (PROPERTY.test(id)) assets.ga4Properties.push({ id, name: `${String(p.displayName ?? id).slice(0, 100)} (${String(a.displayName ?? '').slice(0, 60)})` });
      }
    }
  } catch (err) { notes.push(`Analytics: ${err.message}`); }
  try {
    const r = await apiRequest('https://www.googleapis.com/youtube/v3/channels', { bearer, provider: P, query: { part: 'snippet', mine: 'true' } });
    assets.youtubeChannels = (r.data?.items ?? []).map((c) => ({ id: String(c.id), name: String(c.snippet?.title ?? c.id).slice(0, 100) }));
  } catch (err) { notes.push(`YouTube: ${err.message}`); }
  return {
    accountName: null,
    scopes: tokens.scopes ?? [],
    assets,
    secrets: {},
    notes,
    defaults: { googleCustomerId: assets.googleCustomers[0]?.id ?? null, ga4PropertyId: assets.ga4Properties[0]?.id ?? null, youtubeChannelId: assets.youtubeChannels[0]?.id ?? null },
  };
}

const ymd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;

/**
 * Daily campaign metrics from Google Ads through searchStream (GAQL).
 * `video: true` returns only video (YouTube) campaigns, `false` everything else.
 */
export async function adsDaily(tokens, customerId, { from, to, video = false, loginCustomerId = null }) {
  if (!devToken()) throw new ProviderError('Google Ads: the server has no GOOGLE_ADS_DEVELOPER_TOKEN; the platform administrator must add it');
  if (!CUSTOMER.test(String(customerId ?? ''))) throw new ProviderError('Google Ads: choose a customer account first');
  if (!ymd(from) || !ymd(to)) throw new ProviderError('Google Ads: bad date range');
  const query = [
    'SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions',
    'FROM campaign',
    `WHERE segments.date BETWEEN '${from}' AND '${to}' AND campaign.advertising_channel_type ${video ? '=' : '!='} 'VIDEO'`,
  ].join(' ');
  const r = await apiRequest(`https://googleads.googleapis.com/${GOOGLE_ADS_VERSION()}/customers/${customerId}/googleAds:searchStream`, {
    method: 'POST', bearer: tokens.accessToken, provider: P, idempotent: true, headers: adsHeaders(loginCustomerId), json: { query }, timeoutMs: 30_000,
  });
  // searchStream answers with an array of batches, each { results: [...] }.
  const batches = Array.isArray(r.data) ? r.data : [r.data].filter(Boolean);
  return batches.flatMap((b) => b.results ?? []).map((x) => {
    const conv = Math.round(Number(x.metrics?.conversions || 0));
    return {
      campaignName: String(x.campaign?.name ?? x.campaign?.id ?? 'Unnamed campaign'),
      externalId: x.campaign?.id ? String(x.campaign.id) : null,
      date: String(x.segments?.date),
      spendPaise: Math.round(Number(x.metrics?.costMicros || 0) / 10_000), // micros of the account currency → paise
      impressions: Math.round(Number(x.metrics?.impressions || 0)),
      clicks: Math.round(Number(x.metrics?.clicks || 0)),
      leads: conv,
      conversions: conv,
    };
  });
}

/** GA4 sessions and key events per campaign per day. GA4 has no spend. */
export async function ga4Daily(tokens, propertyId, { from, to }) {
  if (!PROPERTY.test(String(propertyId ?? ''))) throw new ProviderError('Analytics: choose a GA4 property first');
  const out = [];
  for (let offset = 0, page = 0; page < 20; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await apiRequest(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      method: 'POST', bearer: tokens.accessToken, provider: P, idempotent: true,
      json: {
        dateRanges: [{ startDate: from, endDate: to }],
        dimensions: [{ name: 'sessionCampaignName' }, { name: 'date' }],
        metrics: [{ name: 'sessions' }, { name: 'keyEvents' }],
        limit: 10000, offset,
      },
    });
    const rows = r.data?.rows ?? [];
    for (const row of rows) {
      const [name, date] = (row.dimensionValues ?? []).map((d) => d.value);
      const [sessions, keyEvents] = (row.metricValues ?? []).map((m) => Math.round(Number(m.value || 0)));
      if (!name || name === '(not set)' || name === '(direct)' || name === '(organic)') continue;
      out.push({ campaignName: String(name), externalId: null, date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`, spendPaise: 0, impressions: 0, clicks: sessions, leads: keyEvents, conversions: keyEvents });
    }
    offset += rows.length;
    if (!rows.length || offset >= Number(r.data?.rowCount ?? 0)) break;
  }
  return out;
}
