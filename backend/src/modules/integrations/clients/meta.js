import { apiRequest, ProviderError } from '../http.js';
import { PROVIDERS, META_GRAPH_VERSION } from '../providers.js';

/**
 * Meta Graph API: Facebook Login token exchange, Pages and Instagram Business
 * accounts, Marketing API insights, lead retrieval and publishing.
 *
 * Tokens travel in the Authorization header (never in a query string), and
 * the app secret only in POST bodies, so neither can appear in a URL.
 */
const P = 'Meta';
const graph = (path) => `https://graph.facebook.com/${META_GRAPH_VERSION()}/${String(path).replace(/^\//, '')}`;
const app = () => PROVIDERS.META;
const ID = /^\d{1,30}$/;
const assertId = (id, what) => { if (!ID.test(String(id ?? ''))) throw new ProviderError(`Meta: ${what} is not a valid id`); return String(id); };

function tokenOut(d, extra = {}) {
  return { accessToken: d.access_token, refreshToken: null, expiresAt: d.expires_in ? Date.now() + Number(d.expires_in) * 1000 : null, refreshExpiresAt: null, ...extra };
}

/** Code → short-lived user token → long-lived (about 60 days) user token. */
export async function exchangeCode({ code, redirectUri }) {
  const short = await apiRequest(graph('oauth/access_token'), {
    method: 'POST', provider: P, idempotent: false,
    form: { client_id: app().clientId(), client_secret: app().clientSecret(), redirect_uri: redirectUri, code },
  });
  return extend(short.data.access_token);
}

/** Exchanges a (still valid) user token for a fresh long-lived one. Meta has no refresh tokens. */
export async function extend(accessToken) {
  const long = await apiRequest(graph('oauth/access_token'), {
    method: 'POST', provider: P, idempotent: false,
    form: { grant_type: 'fb_exchange_token', client_id: app().clientId(), client_secret: app().clientSecret(), fb_exchange_token: accessToken },
  });
  return tokenOut(long.data);
}

export async function refresh(tokens) {
  return extend(tokens.accessToken);
}

/** Removes the app's permissions for this user at Meta, which invalidates its tokens. */
export async function revoke(tokens) {
  await apiRequest(graph('me/permissions'), { method: 'DELETE', bearer: tokens.accessToken, provider: P, idempotent: true, retries: 1 });
  return 'Revoked at Meta';
}

async function pages(url, bearer, max = 10) {
  const out = [];
  let next = url;
  for (let i = 0; next && i < max; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await apiRequest(next, { bearer, provider: P });
    out.push(...(r.data?.data ?? []));
    next = r.data?.paging?.next ?? null; // checked against the host allowlist by apiRequest
  }
  return out;
}

/** What the connected person can reach: ad accounts, Pages (with their tokens) and linked Instagram accounts. */
export async function discover(tokens) {
  const bearer = tokens.accessToken;
  const me = await apiRequest(graph('me'), { bearer, provider: P, query: { fields: 'id,name' } });
  const [accounts, adAccounts, perms] = await Promise.all([
    pages(`${graph('me/accounts')}?fields=id,name,access_token,instagram_business_account%7Bid,username%7D&limit=100`, bearer),
    pages(`${graph('me/adaccounts')}?fields=id,account_id,name,currency&limit=100`, bearer).catch(() => []),
    apiRequest(graph('me/permissions'), { bearer, provider: P }).then((r) => r.data?.data ?? []).catch(() => []),
  ]);
  const pageTokens = {};
  const metaPages = accounts.filter((p) => ID.test(String(p.id))).map((p) => {
    if (p.access_token) pageTokens[p.id] = p.access_token;
    const ig = p.instagram_business_account;
    return { id: String(p.id), name: String(p.name ?? p.id).slice(0, 120), igUserId: ig?.id ? String(ig.id) : null, igUsername: ig?.username ? String(ig.username).slice(0, 60) : null };
  });
  const metaAdAccounts = adAccounts.map((a) => ({ id: String(a.account_id ?? String(a.id).replace(/^act_/, '')), name: String(a.name ?? a.id).slice(0, 120), currency: a.currency ?? null })).filter((a) => ID.test(a.id));
  return {
    accountName: me.data?.name ? String(me.data.name).slice(0, 120) : null,
    scopes: perms.filter((x) => x.status === 'granted').map((x) => x.permission),
    assets: { metaPages, metaAdAccounts },
    secrets: { pageTokens },
    defaults: { metaPageId: metaPages[0]?.id ?? null, metaAdAccountId: metaAdAccounts[0]?.id ?? null },
  };
}

// ── Ads insights ─────────────────────────────────────────────────────

const LEAD_ACTIONS = new Set(['lead', 'leadgen_grouped', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead']);
const CONVERSION_ACTIONS = new Set([...LEAD_ACTIONS, 'complete_registration', 'offsite_conversion.fb_pixel_complete_registration', 'contact_total', 'submit_application_total']);
const sumActions = (actions, set) => Math.round((Array.isArray(actions) ? actions : []).filter((a) => set.has(a.action_type)).reduce((s, a) => s + Number(a.value || 0), 0));

/**
 * Daily campaign insights for one ad account, `from`..`to` inclusive (YYYY-MM-DD).
 * Leads are lead-form and pixel lead results; spend is in the account currency.
 */
export async function dailyInsights(tokens, adAccountId, { from, to }) {
  const id = assertId(adAccountId, 'ad account');
  const u = new URL(graph(`act_${id}/insights`));
  u.searchParams.set('level', 'campaign');
  u.searchParams.set('time_increment', '1');
  u.searchParams.set('time_range', JSON.stringify({ since: from, until: to }));
  u.searchParams.set('fields', 'campaign_id,campaign_name,spend,impressions,clicks,actions,date_start,account_currency');
  u.searchParams.set('limit', '500');
  const rows = await pages(u.toString(), tokens.accessToken, 50);
  return rows.map((r) => ({
    campaignName: String(r.campaign_name ?? r.campaign_id ?? 'Unnamed campaign'),
    externalId: r.campaign_id ? String(r.campaign_id) : null,
    date: String(r.date_start),
    spendPaise: Math.round(Number(r.spend || 0) * 100),
    impressions: Math.round(Number(r.impressions || 0)),
    clicks: Math.round(Number(r.clicks || 0)),
    leads: sumActions(r.actions, LEAD_ACTIONS),
    conversions: sumActions(r.actions, CONVERSION_ACTIONS),
    currency: r.account_currency ?? null,
  }));
}

/** A lead's answers from the lead form, fetched with the Page token (lead ads webhooks carry only the id). */
export async function fetchLead(pageToken, leadgenId) {
  const id = assertId(leadgenId, 'lead');
  const r = await apiRequest(graph(id), { bearer: pageToken, provider: P, query: { fields: 'id,created_time,field_data,campaign_name,ad_name,form_id' } });
  return r.data ?? {};
}

// ── Publishing ───────────────────────────────────────────────────────

/** A Page post: text with an optional link, or a photo with the text as its caption. */
export async function publishPagePost(pageToken, pageId, { text, link, imageUrl }) {
  const id = assertId(pageId, 'Page');
  const r = imageUrl
    ? await apiRequest(graph(`${id}/photos`), { method: 'POST', bearer: pageToken, provider: P, idempotent: false, form: { url: imageUrl, caption: link ? `${text}\n\n${link}` : text, published: true } })
    : await apiRequest(graph(`${id}/feed`), { method: 'POST', bearer: pageToken, provider: P, idempotent: false, form: { message: text, link: link ?? undefined } });
  const postId = String(r.data?.post_id ?? r.data?.id ?? '');
  if (!postId) throw new ProviderError('Meta: the post was accepted without an id');
  let permalink = null;
  try {
    const p = await apiRequest(graph(postId.replace(/[^\d_]/g, '')), { bearer: pageToken, provider: P, query: { fields: 'permalink_url' }, retries: 1 });
    permalink = p.data?.permalink_url ?? null;
  } catch { /* the post exists; the link can be fetched later */ }
  return { providerPostId: postId, permalink };
}

/** Instagram: create a media container from a public image URL, wait until it is ready, then publish it. */
export async function publishInstagram(pageToken, igUserId, { caption, imageUrl }, { pollMs = 2000, polls = 5, wait = (ms) => new Promise((r) => { setTimeout(r, ms); }) } = {}) {
  const ig = assertId(igUserId, 'Instagram account');
  const c = await apiRequest(graph(`${ig}/media`), { method: 'POST', bearer: pageToken, provider: P, idempotent: false, form: { image_url: imageUrl, caption } });
  const container = String(c.data?.id ?? '');
  if (!ID.test(container)) throw new ProviderError('Meta: Instagram did not return a media container');
  for (let i = 0; i < polls; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const s = await apiRequest(graph(container), { bearer: pageToken, provider: P, query: { fields: 'status_code' } });
    const code = s.data?.status_code;
    if (code === 'FINISHED' || !code) break;
    if (code === 'ERROR' || code === 'EXPIRED') throw new ProviderError(`Meta: Instagram could not process the image (${code}). It must be a public JPEG under 8 MB.`);
    await wait(pollMs); // eslint-disable-line no-await-in-loop
  }
  const p = await apiRequest(graph(`${ig}/media_publish`), { method: 'POST', bearer: pageToken, provider: P, idempotent: false, form: { creation_id: container } });
  const mediaId = String(p.data?.id ?? '');
  let permalink = null;
  try {
    const m = await apiRequest(graph(assertId(mediaId, 'media')), { bearer: pageToken, provider: P, query: { fields: 'permalink' }, retries: 1 });
    permalink = m.data?.permalink ?? null;
  } catch { /* fetched later */ }
  return { providerPostId: mediaId, permalink };
}

export async function pagePostEngagement(pageToken, postId) {
  const r = await apiRequest(graph(String(postId).replace(/[^\d_]/g, '')), { bearer: pageToken, provider: P, query: { fields: 'permalink_url,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)' } });
  const d = r.data ?? {};
  return { likes: d.reactions?.summary?.total_count ?? 0, comments: d.comments?.summary?.total_count ?? 0, shares: d.shares?.count ?? 0, permalink: d.permalink_url ?? null };
}

export async function instagramEngagement(pageToken, mediaId) {
  const r = await apiRequest(graph(assertId(mediaId, 'media')), { bearer: pageToken, provider: P, query: { fields: 'like_count,comments_count,permalink' } });
  const d = r.data ?? {};
  return { likes: d.like_count ?? 0, comments: d.comments_count ?? 0, shares: null, permalink: d.permalink ?? null };
}
