import { vi } from 'vitest';
import { IntegrationConnection } from '../../src/models/integration.model.js';
import { encrypt } from '../../src/utils/crypto.js';
import { setSleepForTests } from '../../src/modules/integrations/http.js';

/**
 * A recorded-shape provider API for the integrations suites.
 *
 * Replaces globalThis.fetch with a router over [method, url-regex, responder]
 * routes; anything unmatched fails loudly (so a request to a host the code
 * should never call is a test failure, not a silent pass). Every call is
 * recorded with its method, URL, headers and body. Response bodies are the
 * shapes the providers document (Graph API, Google Ads searchStream, GA4
 * runReport, LinkedIn Rest.li, X API v2) — recorded shapes, not live calls.
 */

export const APP_ENV = {
  META_APP_ID: '1234567890', META_APP_SECRET: 'meta-app-secret-for-tests',
  GOOGLE_APP_CLIENT_ID: 'google-client.apps.googleusercontent.com', GOOGLE_APP_CLIENT_SECRET: 'google-secret-for-tests', GOOGLE_ADS_DEVELOPER_TOKEN: 'dev-token-for-tests',
  LINKEDIN_CLIENT_ID: 'li-client', LINKEDIN_CLIENT_SECRET: 'li-secret-for-tests',
  X_CLIENT_ID: 'x-client', X_CLIENT_SECRET: 'x-secret-for-tests',
  INTEGRATIONS_REDIRECT_URI: 'https://portal.example.test/oauth/callback',
};

export function setAppEnv(on = true) {
  for (const [k, v] of Object.entries(APP_ENV)) {
    if (on) process.env[k] = v; else delete process.env[k];
  }
}

export function json(body, status = 200, headers = {}) {
  return new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** Installs the stub. Returns { calls, routes } — push more routes any time. */
export function stubProviders(routes = []) {
  const state = { calls: [], routes: [...routes] };
  setSleepForTests(async () => {});
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const call = { method, url: String(url), headers: init.headers ?? {}, body: init.body ?? null };
    state.calls.push(call);
    const route = state.routes.find(([m, re]) => m === method && re.test(String(url)));
    if (!route) throw new Error(`Unexpected provider call in test: ${method} ${url}`);
    const r = route[2];
    return typeof r === 'function' ? r(call, state) : r.clone();
  }));
  return state;
}

export function unstubProviders() {
  vi.unstubAllGlobals();
  setSleepForTests(null);
}

/** A connected provider, as completeConnect would leave it (tokens encrypted). */
export async function seedConnection(provider, { tokens = {}, secrets = {}, assets = {}, selected = {}, purposes = ['ads', 'social'], status = 'CONNECTED' } = {}) {
  return IntegrationConnection.create({
    provider, status, purposes, scopes: [], accountName: 'Test account',
    tokenEnc: encrypt({ accessToken: `${provider.toLowerCase()}-access-token`, refreshToken: `${provider.toLowerCase()}-refresh-token`, expiresAt: Date.now() + (provider === 'META' ? 50 * 86_400_000 : 3600_000), ...tokens }),
    secretsEnc: encrypt(secrets), assets, selected, connectedAt: new Date(),
  });
}
