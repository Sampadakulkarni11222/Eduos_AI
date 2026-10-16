import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { seedSchool, seedPerson, inSchool, OAK, RIVER } from './support/mcpSchool.js';
import { stubProviders, unstubProviders, setAppEnv, json, seedConnection } from './support/integrationsStub.js';
import { IntegrationConnection, OAuthState } from '../src/models/integration.model.js';
import * as oauth from '../src/modules/integrations/oauth.service.js';
import { apiRequest, assertAllowedUrl, ProviderError } from '../src/modules/integrations/http.js';
import { decrypt } from '../src/utils/crypto.js';

/**
 * OAuth connections: state bound to school, person and browser tab, single
 * use, ten minutes; PKCE where the provider supports it; tokens encrypted,
 * refreshed before expiry, never returned; disconnect revokes at the provider.
 * Built and tested against recorded API shapes (fetch is stubbed).
 */
let s;
let net;
const NONCE = 'tab-nonce-0123456789abcdef';
const inOak = (fn) => inSchool(OAK, fn);
const stateOf = (url) => new URL(url).searchParams.get('state');

beforeEach(async () => {
  s = await seedSchool();
  s.people.MARKETING = await seedPerson({ roleKey: 'MARKETING', roleId: s.roleIds.MARKETING, displayName: 'Marketing lead' });
  net = stubProviders();
});
afterEach(() => { unstubProviders(); setAppEnv(false); });

describe('without the provider apps configured', () => {
  it('explains that the platform admin must configure the app, and sends nothing', async () => {
    const admin = s.people.ADMIN.actor;
    const o = await inOak(() => oauth.overview(admin));
    expect(o.providers.map((p) => [p.provider, p.appConfigured, p.mode])).toEqual([['META', false, 'SIMULATED'], ['GOOGLE', false, 'SIMULATED'], ['LINKEDIN', false, 'SIMULATED'], ['X', false, 'SIMULATED']]);
    expect(o.providers[0].message).toMatch(/platform administrator must set META_APP_ID and META_APP_SECRET/);
    await expect(inOak(() => oauth.startConnect(admin, 'META', { browserNonce: NONCE }))).rejects.toMatchObject({ code: 'APP_NOT_CONFIGURED' });
    expect(net.calls).toHaveLength(0);
  });

  it('refuses parents and students outright', async () => {
    setAppEnv(true);
    await expect(inOak(() => oauth.overview(s.people.PARENT.actor))).rejects.toMatchObject({ code: 'STAFF_ONLY' });
    await expect(inOak(() => oauth.startConnect(s.people.STUDENT.actor, 'X', { browserNonce: NONCE }))).rejects.toMatchObject({ code: 'STAFF_ONLY' });
  });
});

describe('starting a connection', () => {
  beforeEach(() => setAppEnv(true));

  it('builds the authorise URL with the configured redirect URI, scopes and a hashed single-use state', async () => {
    const r = await inOak(() => oauth.startConnect(s.people.ADMIN.actor, 'META', { browserNonce: NONCE, returnPath: '/oakridge/marketing/connectors' }));
    const u = new URL(r.authorizeUrl);
    expect(u.origin + u.pathname).toBe('https://www.facebook.com/v21.0/dialog/oauth');
    expect(u.searchParams.get('redirect_uri')).toBe('https://portal.example.test/oauth/callback');
    expect(u.searchParams.get('client_id')).toBe('1234567890');
    expect(u.searchParams.get('scope')).toContain('ads_read');
    expect(u.searchParams.get('scope')).toContain('pages_manage_posts');
    expect(u.searchParams.get('code_challenge')).toBeNull(); // Meta: client secret + state
    const row = await inOak(() => OAuthState.findOne({}).lean());
    expect(row.stateHash).not.toBe(stateOf(r.authorizeUrl)); // only the hash is stored
    expect(row.tenantId).toBe(OAK);
    expect(row.returnPath).toBe('/oakridge/marketing/connectors');
    expect(net.calls).toHaveLength(0);
  });

  it('uses PKCE (S256) for Google and X', async () => {
    for (const p of ['GOOGLE', 'X']) {
      // eslint-disable-next-line no-await-in-loop
      const r = await inOak(() => oauth.startConnect(s.people.ADMIN.actor, p, { browserNonce: NONCE }));
      const u = new URL(r.authorizeUrl);
      expect(u.searchParams.get('code_challenge_method')).toBe('S256');
      expect(u.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it('connects only for what the role manages, and refuses an unsafe return path', async () => {
    // Marketing holds marketing.manage ALL but not social.connect: ads only.
    const r = await inOak(() => oauth.startConnect(s.people.MARKETING.actor, 'META', { browserNonce: NONCE, returnPath: '//evil.example' }));
    expect(r.purposes).toEqual(['ads']);
    expect(new URL(r.authorizeUrl).searchParams.get('scope')).not.toContain('pages_manage_posts');
    expect((await inOak(() => OAuthState.findOne({}).lean())).returnPath).toBeNull();
    await expect(inOak(() => oauth.startConnect(s.people.MARKETING.actor, 'X', { browserNonce: NONCE }))).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    await expect(inOak(() => oauth.startConnect(s.people.ADMIN.actor, 'META', { browserNonce: 'short' }))).rejects.toMatchObject({ code: 'BAD_NONCE' });
  });
});

describe('completing a connection', () => {
  beforeEach(() => setAppEnv(true));

  const xRoutes = () => {
    net.routes.push(
      ['POST', /^https:\/\/api\.x\.com\/2\/oauth2\/token$/, json({ token_type: 'bearer', access_token: 'X-ACCESS-SECRET-1', refresh_token: 'X-REFRESH-SECRET-1', expires_in: 7200, scope: 'tweet.read tweet.write users.read offline.access' })],
      ['GET', /^https:\/\/api\.x\.com\/2\/users\/me/, json({ data: { id: '2244994945', name: 'Oakridge Academy', username: 'oakridge_sample' } })],
    );
  };

  it('rejects another tab, another person, another school, a reused or an expired state', async () => {
    xRoutes();
    const admin = s.people.ADMIN.actor;
    const start = await inOak(() => oauth.startConnect(admin, 'X', { browserNonce: NONCE }));
    const state = stateOf(start.authorizeUrl);
    // Another school cannot even find the state.
    await expect(inSchool(RIVER, () => oauth.completeConnect(s.people.RIVER_ADMIN.actor, { state, code: 'c', browserNonce: NONCE }))).rejects.toMatchObject({ code: 'BAD_STATE' });
    // A different person in the same school.
    await expect(inOak(() => oauth.completeConnect(s.people.PRINCIPAL.actor, { state, code: 'c', browserNonce: NONCE }))).rejects.toMatchObject({ code: 'STATE_MISMATCH' });
    // The state was consumed by that attempt: single use, even for the right person now.
    await expect(inOak(() => oauth.completeConnect(admin, { state, code: 'c', browserNonce: NONCE }))).rejects.toMatchObject({ code: 'BAD_STATE' });

    const second = await inOak(() => oauth.startConnect(admin, 'X', { browserNonce: NONCE }));
    await expect(inOak(() => oauth.completeConnect(admin, { state: stateOf(second.authorizeUrl), code: 'c', browserNonce: 'another-tab-nonce-000000' }))).rejects.toMatchObject({ code: 'STATE_MISMATCH' });

    const third = await inOak(() => oauth.startConnect(admin, 'X', { browserNonce: NONCE }));
    await inOak(() => OAuthState.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } }));
    await expect(inOak(() => oauth.completeConnect(admin, { state: stateOf(third.authorizeUrl), code: 'c', browserNonce: NONCE }))).rejects.toMatchObject({ code: 'BAD_STATE' });
    expect(net.calls).toHaveLength(0); // nothing reached the provider
  });

  it('exchanges the code with the PKCE verifier, stores tokens encrypted and never returns them', async () => {
    xRoutes();
    const admin = s.people.ADMIN.actor;
    const start = await inOak(() => oauth.startConnect(admin, 'X', { browserNonce: NONCE, returnPath: '/oakridge/admin/social' }));
    const challenge = new URL(start.authorizeUrl).searchParams.get('code_challenge');
    const out = await inOak(() => oauth.completeConnect(admin, { state: stateOf(start.authorizeUrl), code: 'auth-code-1', browserNonce: NONCE }));
    expect(out.returnPath).toBe('/oakridge/admin/social');
    expect(out.connection).toMatchObject({ provider: 'X', status: 'CONNECTED', accountName: '@oakridge_sample', purposes: ['social'] });

    const tokenCall = net.calls[0];
    const form = new URLSearchParams(tokenCall.body);
    expect(form.get('code')).toBe('auth-code-1');
    expect(form.get('redirect_uri')).toBe('https://portal.example.test/oauth/callback');
    const verifier = form.get('code_verifier');
    const crypto = await import('node:crypto');
    expect(crypto.createHash('sha256').update(verifier).digest('base64url')).toBe(challenge);
    expect(tokenCall.headers.Authorization).toMatch(/^Basic /);

    const stored = await inOak(() => IntegrationConnection.findOne({ provider: 'X' }).select('+tokenEnc').lean());
    expect(stored.tokenEnc).not.toContain('X-ACCESS-SECRET-1');
    expect(decrypt(stored.tokenEnc).refreshToken).toBe('X-REFRESH-SECRET-1');
    const seen = JSON.stringify([out, await inOak(() => oauth.overview(admin))]);
    expect(seen).not.toMatch(/X-ACCESS-SECRET|X-REFRESH-SECRET/);
  });

  it('records a refusal at the provider without connecting', async () => {
    const admin = s.people.ADMIN.actor;
    const start = await inOak(() => oauth.startConnect(admin, 'LINKEDIN', { browserNonce: NONCE }));
    await expect(inOak(() => oauth.completeConnect(admin, { state: stateOf(start.authorizeUrl), error: 'user_cancelled_authorize', browserNonce: NONCE }))).rejects.toMatchObject({ code: 'NOT_AUTHORISED' });
    expect(await inOak(() => IntegrationConnection.countDocuments({ status: 'CONNECTED' }))).toBe(0);
  });
});

describe('tokens', () => {
  beforeEach(() => setAppEnv(true));

  it('refreshes before expiry and keeps the rotated refresh token', async () => {
    await inOak(() => seedConnection('X', { tokens: { expiresAt: Date.now() + 60_000 }, purposes: ['social'] }));
    net.routes.push(['POST', /api\.x\.com\/2\/oauth2\/token$/, json({ access_token: 'x-new-access', refresh_token: 'x-new-refresh', expires_in: 7200 })]);
    const t = await inOak(() => oauth.freshTokens('X'));
    expect(t.accessToken).toBe('x-new-access');
    expect(new URLSearchParams(net.calls[0].body).get('refresh_token')).toBe('x-refresh-token');
    const stored = await inOak(() => IntegrationConnection.findOne({ provider: 'X' }).select('+tokenEnc').lean());
    expect(decrypt(stored.tokenEnc).refreshToken).toBe('x-new-refresh');
    // Fresh now: no second refresh.
    await inOak(() => oauth.freshTokens('X'));
    expect(net.calls).toHaveLength(1);
  });

  it('marks the connection for reconnecting when the refresh token is refused', async () => {
    await inOak(() => seedConnection('GOOGLE', { tokens: { expiresAt: Date.now() - 1000 } }));
    net.routes.push(['POST', /oauth2\.googleapis\.com\/token$/, json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400)]);
    await expect(inOak(() => oauth.freshTokens('GOOGLE'))).rejects.toBeInstanceOf(ProviderError);
    const c = await inOak(() => IntegrationConnection.findOne({ provider: 'GOOGLE' }).lean());
    expect(c.status).toBe('NEEDS_RECONNECT');
    expect(c.lastError.message).toMatch(/expired or revoked/);
  });

  it('extends a Meta long-lived token within a week of expiry', async () => {
    await inOak(() => seedConnection('META', { tokens: { expiresAt: Date.now() + 3 * 86_400_000 } }));
    net.routes.push(['POST', /graph\.facebook\.com\/v21\.0\/oauth\/access_token$/, json({ access_token: 'meta-extended', expires_in: 5_184_000 })]);
    const t = await inOak(() => oauth.freshTokens('META'));
    expect(t.accessToken).toBe('meta-extended');
    expect(new URLSearchParams(net.calls[0].body).get('grant_type')).toBe('fb_exchange_token');
  });
});

describe('disconnecting', () => {
  beforeEach(() => setAppEnv(true));

  it('revokes at the provider and wipes the tokens here', async () => {
    await inOak(() => seedConnection('GOOGLE'));
    net.routes.push(['POST', /oauth2\.googleapis\.com\/revoke$/, json({})]);
    const out = await inOak(() => oauth.disconnect(s.people.ADMIN.actor, 'GOOGLE'));
    expect(out).toMatchObject({ status: 'DISCONNECTED', revokeResult: 'Revoked at Google' });
    expect(new URLSearchParams(net.calls[0].body).get('token')).toBe('google-refresh-token');
    const c = await inOak(() => IntegrationConnection.findOne({ provider: 'GOOGLE' }).select('+tokenEnc +secretsEnc').lean());
    expect(c.tokenEnc).toBeNull();
    expect(c.secretsEnc).toBeNull();
  });

  it('still disconnects when the provider cannot be reached, and says so', async () => {
    await inOak(() => seedConnection('LINKEDIN'));
    net.routes.push(['POST', /linkedin\.com\/oauth\/v2\/revoke$/, json({ message: 'Service unavailable' }, 503)]);
    const out = await inOak(() => oauth.disconnect(s.people.ADMIN.actor, 'LINKEDIN'));
    expect(out.status).toBe('DISCONNECTED');
    expect(out.revokeResult).toMatch(/revoking at the provider failed/);
  });

  it('needs permission for every purpose of the connection', async () => {
    await inOak(() => seedConnection('META'));
    await expect(inOak(() => oauth.disconnect(s.people.MARKETING.actor, 'META'))).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
  });
});

describe('selecting assets', () => {
  beforeEach(() => setAppEnv(true));
  it('accepts only ids the provider listed', async () => {
    await inOak(() => seedConnection('META', { assets: { metaPages: [{ id: '111', name: 'Oakridge' }, { id: '222', name: 'Oakridge Sports' }], metaAdAccounts: [{ id: '999', name: 'Ads' }] }, selected: { metaPageId: '111' } }));
    const out = await inOak(() => oauth.selectAssets(s.people.ADMIN.actor, 'META', { metaPageId: '222' }));
    expect(out.selected.metaPageId).toBe('222');
    await expect(inOak(() => oauth.selectAssets(s.people.ADMIN.actor, 'META', { metaPageId: '333' }))).rejects.toMatchObject({ code: 'BAD_ASSET' });
    await expect(inOak(() => oauth.selectAssets(s.people.ADMIN.actor, 'META', { evil: 'x' }))).rejects.toMatchObject({ code: 'BAD_ASSET' });
  });
});

describe('the HTTP client', () => {
  it('calls only official API hosts over HTTPS', () => {
    expect(() => assertAllowedUrl('https://graph.facebook.com/v21.0/me')).not.toThrow();
    for (const bad of ['http://graph.facebook.com/me', 'https://graph.facebook.com.evil.example/me', 'https://169.254.169.254/latest', 'https://user:pw@api.x.com/2', 'https://api.x.com:8443/2', 'file:///etc/passwd', 'https://localhost/']) {
      expect(() => assertAllowedUrl(bad)).toThrow(ProviderError);
    }
  });

  it('retries a rate limit with backoff, but never repeats a post after a server error', async () => {
    let n = 0;
    net.routes.push(['GET', /api\.x\.com\/2\/users\/me/, () => (++n < 3 ? json({ title: 'Too Many Requests' }, 429, { 'retry-after': '1' }) : json({ data: { id: '1' } }))]);
    const r = await apiRequest('https://api.x.com/2/users/me', { provider: 'X' });
    expect(r.data.data.id).toBe('1');
    expect(n).toBe(3);
    net.routes.push(['POST', /api\.x\.com\/2\/tweets$/, json({ title: 'Internal error' }, 500)]);
    await expect(apiRequest('https://api.x.com/2/tweets', { method: 'POST', json: { text: 'hi' }, provider: 'X' })).rejects.toBeInstanceOf(ProviderError);
    expect(net.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('does not follow redirects', async () => {
    net.routes.push(['GET', /graph\.facebook\.com/, new Response('', { status: 302, headers: { location: 'http://169.254.169.254/' } })]);
    await expect(apiRequest('https://graph.facebook.com/v21.0/me', { provider: 'Meta', retries: 0 })).rejects.toThrow(/redirect/);
    expect(net.calls[0].url).toMatch(/^https:\/\/graph\.facebook\.com/);
  });
});
