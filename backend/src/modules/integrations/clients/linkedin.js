import { apiRequest, ProviderError } from '../http.js';
import { PROVIDERS, LINKEDIN_VERSION } from '../providers.js';

/**
 * LinkedIn: OAuth 2.0, organisation pages (posts API), Campaign Manager ad
 * accounts and ad analytics (daily, pivoted by campaign).
 */
const P = 'LinkedIn';
const app = () => PROVIDERS.LINKEDIN;
const rest = (path) => `https://api.linkedin.com/rest/${path}`;
const H = () => ({ 'LinkedIn-Version': LINKEDIN_VERSION(), 'X-Restli-Protocol-Version': '2.0.0' });
const NUM = /^\d{1,20}$/;

function tokenOut(d, prev = {}) {
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token ?? prev.refreshToken ?? null,
    expiresAt: d.expires_in ? Date.now() + Number(d.expires_in) * 1000 : null,
    refreshExpiresAt: d.refresh_token_expires_in ? Date.now() + Number(d.refresh_token_expires_in) * 1000 : prev.refreshExpiresAt ?? null,
    scopes: d.scope ? String(d.scope).split(/[ ,]/).filter(Boolean) : prev.scopes,
  };
}

export async function exchangeCode({ code, redirectUri }) {
  const r = await apiRequest('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST', provider: P, idempotent: false,
    form: { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: app().clientId(), client_secret: app().clientSecret() },
  });
  return tokenOut(r.data);
}

/** Refresh tokens exist only for apps LinkedIn has enabled for them; otherwise the school reconnects every 60 days. */
export async function refresh(tokens) {
  if (!tokens.refreshToken) throw new ProviderError('LinkedIn: the access token expired and this app has no refresh token; reconnect the account', { auth: true });
  const r = await apiRequest('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST', provider: P, idempotent: true,
    form: { grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: app().clientId(), client_secret: app().clientSecret() },
  });
  return tokenOut(r.data, tokens);
}

export async function revoke(tokens) {
  await apiRequest('https://www.linkedin.com/oauth/v2/revoke', { method: 'POST', provider: P, idempotent: true, retries: 1, form: { client_id: app().clientId(), client_secret: app().clientSecret(), token: tokens.accessToken } });
  return 'Revoked at LinkedIn';
}

export async function discover(tokens) {
  const bearer = tokens.accessToken;
  const notes = [];
  let linkedinOrgs = [];
  let linkedinAdAccounts = [];
  try {
    const r = await apiRequest(rest('organizationAcls'), { bearer, provider: P, headers: H(), query: { q: 'roleAssignee', role: 'ADMINISTRATOR', state: 'APPROVED', count: 100 } });
    const urns = (r.data?.elements ?? []).map((e) => String(e.organization ?? '')).filter((u) => /^urn:li:organization:\d+$/.test(u));
    linkedinOrgs = await Promise.all(urns.slice(0, 20).map(async (urn) => {
      const id = urn.split(':').pop();
      try {
        const o = await apiRequest(rest(`organizations/${id}`), { bearer, provider: P, headers: H() });
        return { urn, name: String(o.data?.localizedName ?? id).slice(0, 120) };
      } catch { return { urn, name: `Organisation ${id}` }; }
    }));
  } catch (err) { notes.push(`Pages: ${err.message}`); }
  try {
    const r = await apiRequest(rest('adAccounts'), { bearer, provider: P, headers: H(), query: { q: 'search', count: 100 } });
    linkedinAdAccounts = (r.data?.elements ?? []).filter((a) => NUM.test(String(a.id))).map((a) => ({ id: String(a.id), name: String(a.name ?? a.id).slice(0, 120), currency: a.currency ?? null }));
  } catch (err) { notes.push(`Ads: ${err.message}`); }
  return {
    accountName: null,
    scopes: tokens.scopes ?? [],
    assets: { linkedinOrgs, linkedinAdAccounts },
    secrets: {},
    notes,
    defaults: { linkedinOrgUrn: linkedinOrgs[0]?.urn ?? null, linkedinAdAccountId: linkedinAdAccounts[0]?.id ?? null },
  };
}

const ymdParts = (s) => { const [y, m, d] = s.split('-').map(Number); return `(year:${y},month:${m},day:${d})`; };

/** Daily analytics per campaign for one ad account, with the campaigns' names. */
export async function adsDaily(tokens, adAccountId, { from, to }) {
  if (!NUM.test(String(adAccountId ?? ''))) throw new ProviderError('LinkedIn: choose an ad account first');
  const bearer = tokens.accessToken;
  const account = encodeURIComponent(`urn:li:sponsoredAccount:${adAccountId}`);
  // Rest.li query syntax must not be re-encoded, so it is written into the URL directly.
  const url = `${rest('adAnalytics')}?q=analytics&pivot=CAMPAIGN&timeGranularity=DAILY&dateRange=(start:${ymdParts(from)},end:${ymdParts(to)})&accounts=List(${account})&fields=costInLocalCurrency,impressions,clicks,oneClickLeads,externalWebsiteConversions,dateRange,pivotValues`;
  const r = await apiRequest(url, { bearer, provider: P, headers: H(), timeoutMs: 30_000 });
  const names = new Map();
  try {
    const c = await apiRequest(rest(`adAccounts/${adAccountId}/adCampaigns`), { bearer, provider: P, headers: H(), query: { q: 'search', count: 500 } });
    for (const x of c.data?.elements ?? []) names.set(`urn:li:sponsoredCampaign:${x.id}`, String(x.name ?? x.id));
  } catch { /* fall back to the campaign id as its name */ }
  return (r.data?.elements ?? []).map((e) => {
    const urn = String(e.pivotValues?.[0] ?? '');
    const s = e.dateRange?.start ?? {};
    const date = `${s.year}-${String(s.month).padStart(2, '0')}-${String(s.day).padStart(2, '0')}`;
    const leads = Math.round(Number(e.oneClickLeads || 0));
    return {
      campaignName: names.get(urn) ?? (urn ? `LinkedIn campaign ${urn.split(':').pop()}` : 'Unnamed campaign'),
      externalId: urn || null,
      date,
      spendPaise: Math.round(Number(e.costInLocalCurrency || 0) * 100),
      impressions: Math.round(Number(e.impressions || 0)),
      clicks: Math.round(Number(e.clicks || 0)),
      leads,
      conversions: leads + Math.round(Number(e.externalWebsiteConversions || 0)),
    };
  });
}

/** LinkedIn's "little text" format reserves these characters in commentary; they must be escaped. */
export function escapeCommentary(text) {
  return String(text).replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
}

/** An organisation post: text, with the link as an article card when there is one. */
export async function publishOrgPost(tokens, orgUrn, { text, link, title }) {
  if (!/^urn:li:organization:\d+$/.test(String(orgUrn ?? ''))) throw new ProviderError('LinkedIn: choose the organisation page first');
  const r = await apiRequest(rest('posts'), {
    method: 'POST', bearer: tokens.accessToken, provider: P, headers: H(), idempotent: false,
    json: {
      author: orgUrn,
      commentary: escapeCommentary(text),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      ...(link ? { content: { article: { source: link, title: String(title || link).slice(0, 200) } } } : {}),
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    },
  });
  const urn = r.headers?.get?.('x-restli-id') || r.headers?.get?.('x-linkedin-id') || r.data?.id;
  if (!urn) throw new ProviderError('LinkedIn: the post was accepted without an id');
  return { providerPostId: String(urn), permalink: `https://www.linkedin.com/feed/update/${encodeURIComponent(String(urn))}/` };
}

export async function postEngagement(tokens, urn) {
  const r = await apiRequest(rest(`socialActions/${encodeURIComponent(urn)}`), { bearer: tokens.accessToken, provider: P, headers: H() });
  const d = r.data ?? {};
  return { likes: d.likesSummary?.totalLikes ?? 0, comments: d.commentsSummary?.aggregatedTotalComments ?? 0, shares: null, permalink: null };
}
