import { env } from '../../config/env.js';

/**
 * The four provider apps a school can connect to, and what each one is for.
 *
 * Each provider is ONE app registered by the platform administrator (the
 * operator of this EduOS installation), whose client id and secret come from
 * the environment. Schools then connect their own accounts to that app
 * through OAuth. When the app is not configured, connecting is impossible and
 * every outcome stays SIMULATED (and is labelled so).
 *
 * Read from process.env at call time, so an operator can add the variables
 * and restart, and tests can set them per case.
 */

const v = (name) => String(process.env[name] ?? '').trim();
export const META_GRAPH_VERSION = () => v('META_GRAPH_VERSION') || 'v21.0';
export const GOOGLE_ADS_VERSION = () => v('GOOGLE_ADS_API_VERSION') || 'v21';
export const LINKEDIN_VERSION = () => v('LINKEDIN_API_VERSION') || '202409';

export const PROVIDER_KEYS = ['META', 'GOOGLE', 'LINKEDIN', 'X'];

export const PROVIDERS = {
  META: {
    label: 'Meta (Facebook Pages, Instagram, Meta Ads)',
    envVars: ['META_APP_ID', 'META_APP_SECRET'],
    clientId: () => v('META_APP_ID'),
    clientSecret: () => v('META_APP_SECRET'),
    authorizeUrl: () => `https://www.facebook.com/${META_GRAPH_VERSION()}/dialog/oauth`,
    pkce: false, // Facebook Login for a server-side (confidential) app: client secret + state.
    scopeSeparator: ',',
    scopes: {
      ads: ['ads_read', 'leads_retrieval', 'pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'business_management'],
      social: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish', 'read_insights', 'business_management'],
    },
    products: { ads: ['META_ADS'], social: ['FACEBOOK', 'INSTAGRAM'] },
  },
  GOOGLE: {
    label: 'Google (Google Ads, Analytics 4, YouTube)',
    envVars: ['GOOGLE_APP_CLIENT_ID', 'GOOGLE_APP_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN'],
    optionalEnv: ['GOOGLE_ADS_DEVELOPER_TOKEN'],
    clientId: () => v('GOOGLE_APP_CLIENT_ID'),
    clientSecret: () => v('GOOGLE_APP_CLIENT_SECRET'),
    authorizeUrl: () => 'https://accounts.google.com/o/oauth2/v2/auth',
    pkce: true,
    scopeSeparator: ' ',
    scopes: {
      ads: ['https://www.googleapis.com/auth/adwords', 'https://www.googleapis.com/auth/analytics.readonly'],
      social: ['https://www.googleapis.com/auth/youtube.readonly'],
    },
    products: { ads: ['GOOGLE_ADS', 'GA4', 'YOUTUBE'], social: ['YOUTUBE'] },
    extraAuthorizeParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
  },
  LINKEDIN: {
    label: 'LinkedIn (Organisation page, Campaign Manager)',
    envVars: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
    clientId: () => v('LINKEDIN_CLIENT_ID'),
    clientSecret: () => v('LINKEDIN_CLIENT_SECRET'),
    authorizeUrl: () => 'https://www.linkedin.com/oauth/v2/authorization',
    pkce: false, // LinkedIn's 3-legged web flow uses the client secret; PKCE is for its native-app flow only.
    scopeSeparator: ' ',
    scopes: {
      ads: ['r_ads', 'r_ads_reporting'],
      social: ['r_organization_social', 'w_organization_social', 'rw_organization_admin'],
    },
    products: { ads: ['LINKEDIN'], social: ['LINKEDIN'] },
  },
  X: {
    label: 'X (posts)',
    envVars: ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
    clientId: () => v('X_CLIENT_ID'),
    clientSecret: () => v('X_CLIENT_SECRET'),
    authorizeUrl: () => 'https://x.com/i/oauth2/authorize',
    pkce: true, // X requires PKCE for OAuth 2.0.
    scopeSeparator: ' ',
    scopes: { ads: [], social: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'] },
    products: { ads: [], social: ['X'] },
  },
};

/** Which provider connection serves each ad connector and each social network. */
export const PLATFORM_PROVIDER = { META_ADS: 'META', GOOGLE_ADS: 'GOOGLE', GA4: 'GOOGLE', YOUTUBE: 'GOOGLE', LINKEDIN: 'LINKEDIN' };
export const NETWORK_PROVIDER = { FACEBOOK: 'META', INSTAGRAM: 'META', LINKEDIN: 'LINKEDIN', X: 'X', YOUTUBE: 'GOOGLE' };

/** True when the platform administrator has configured this provider's app. */
export function appConfigured(provider) {
  const p = PROVIDERS[provider];
  return Boolean(p && p.clientId() && p.clientSecret());
}

/** The env variables still missing for a provider (names only, never values). */
export function missingEnv(provider) {
  const p = PROVIDERS[provider];
  return p ? p.envVars.filter((n) => !v(n) && !(p.optionalEnv ?? []).includes(n)) : [];
}

export function notConfiguredMessage(provider) {
  const p = PROVIDERS[provider];
  return `The ${p.label.split(' (')[0]} app is not configured on this EduOS installation. The platform administrator must set ${p.envVars.filter((n) => !(p.optionalEnv ?? []).includes(n)).join(' and ')} (see docs/erp-operations/INTEGRATIONS-SETUP.md). Until then everything for it stays Simulated.`;
}

/** The redirect URI registered with every provider app: one fixed URL for all schools. */
export function redirectUri() {
  const configured = v('INTEGRATIONS_REDIRECT_URI');
  if (configured) return configured;
  const web = String(v('PUBLIC_WEB_URL') || env.CORS_ORIGIN || 'http://localhost:3000').split(',')[0].trim().replace(/\/$/, '');
  return `${web}/oauth/callback`;
}

/** Scopes to request for the chosen purposes, without duplicates. */
export function scopesFor(provider, purposes) {
  const p = PROVIDERS[provider];
  return [...new Set(purposes.flatMap((x) => p.scopes[x] ?? []))];
}
