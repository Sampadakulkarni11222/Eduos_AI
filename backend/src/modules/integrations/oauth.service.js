import crypto from 'node:crypto';
import { IntegrationConnection, OAuthState, INTEGRATION_PROVIDERS } from '../../models/integration.model.js';
import { AppError } from '../../utils/AppError.js';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { logger } from '../../utils/logger.js';
import { requireProfile, pushHistory } from '../ops/common.js';
import { ProviderError } from './http.js';
import { PROVIDERS, PROVIDER_KEYS, appConfigured, missingEnv, notConfiguredMessage, redirectUri, scopesFor } from './providers.js';
import * as meta from './clients/meta.js';
import * as google from './clients/google.js';
import * as linkedin from './clients/linkedin.js';
import * as x from './clients/x.js';

/**
 * OAuth connections between a school and the provider apps.
 *
 * Connect: authorization code flow, PKCE where the provider supports it
 * (Google, X), a random `state` bound to the school, the person and the
 * browser tab, ten minutes, single use. The redirect URI is the one fixed URL
 * configured for the installation (providers.js redirectUri()).
 *
 * Tokens are encrypted with utils/crypto, refreshed before they expire (Meta
 * long-lived tokens are re-extended within a week of expiry), never returned
 * to the browser and never logged. Disconnect revokes at the provider where
 * it offers revocation and always wipes the tokens here.
 *
 * Without the provider app configured (env), nothing can be connected and
 * every outcome stays SIMULATED.
 */

export const CLIENTS = { META: meta, GOOGLE: google, LINKEDIN: linkedin, X: x };
const STATE_TTL_MS = 10 * 60_000;
const REFRESH_AHEAD_MS = 5 * 60_000;
const META_EXTEND_AHEAD_MS = 7 * 24 * 3600_000;
const FAMILY = new Set(['PARENT', 'STUDENT', 'ALUMNUS', 'TRUSTEE']);

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function providerOf(p) {
  const key = String(p ?? '').toUpperCase();
  if (!INTEGRATION_PROVIDERS.includes(key)) throw new AppError(`Unknown provider: ${String(p).slice(0, 30)}`, 400, [], 'BAD_PROVIDER');
  return key;
}

function assertStaff(actor) {
  requireProfile(actor);
  if (!actor.roleKey || FAMILY.has(actor.roleKey)) throw new AppError('Connecting the school\'s accounts is for school staff.', 403, [], 'STAFF_ONLY');
}

/** Who may connect for which purpose: ads → school-wide marketing managers; social → social.connect. */
export function canFor(actor, purpose) {
  if (purpose === 'ads') return actor.permissions?.['marketing.manage'] === 'ALL';
  if (purpose === 'social') return Boolean(actor.permissions?.['social.connect']);
  return false;
}
const canView = (actor) => Boolean(actor.permissions?.['marketing.read'] || actor.permissions?.['social.publish'] || actor.permissions?.['social.connect']);

// ── presentation (never a token) ────────────────────────────────────

export function connectionDto(c) {
  if (!c) return null;
  return {
    provider: c.provider, status: c.status, purposes: c.purposes ?? [], scopes: c.scopes ?? [], accountName: c.accountName ?? null,
    assets: c.assets ?? {}, selected: c.selected ?? {}, accessExpiresAt: c.accessExpiresAt ?? null, lastRefreshAt: c.lastRefreshAt ?? null,
    lastError: c.lastError?.message ? { at: c.lastError.at, message: c.lastError.message } : null,
    connectedAt: c.connectedAt ?? null, connectedByName: c.connectedByName ?? null, revokeResult: c.revokeResult ?? null,
  };
}

/** Each provider: is the app configured, what it serves, and this school's connection. */
export async function overview(actor) {
  assertStaff(actor);
  if (!canView(actor)) throw new AppError('Missing permission: marketing.read or social.publish', 403);
  const rows = await IntegrationConnection.find({}).lean();
  return {
    redirectUri: redirectUri(),
    providers: PROVIDER_KEYS.map((provider) => {
      const p = PROVIDERS[provider];
      const configured = appConfigured(provider);
      const c = rows.find((r) => r.provider === provider);
      return {
        provider, label: p.label, appConfigured: configured,
        missingEnv: configured ? [] : missingEnv(provider),
        message: configured ? null : notConfiguredMessage(provider),
        pkce: p.pkce,
        products: p.products,
        scopes: { ads: p.scopes.ads, social: p.scopes.social },
        canConnect: { ads: canFor(actor, 'ads') && p.scopes.ads.length > 0, social: canFor(actor, 'social') && p.scopes.social.length > 0 },
        mode: configured && c?.status === 'CONNECTED' ? 'LIVE' : 'SIMULATED',
        connection: connectionDto(c),
      };
    }),
  };
}

// ── connect ─────────────────────────────────────────────────────────

function cleanReturnPath(p) {
  const s = String(p ?? '').trim();
  return /^\/[A-Za-z0-9\-_/]{0,200}$/.test(s) && !s.startsWith('//') ? s : null;
}

/**
 * Starts a connection: returns the provider's authorisation URL to send the
 * browser to. The tab keeps `browserNonce` and must present it to complete.
 */
export async function startConnect(actor, providerRaw, body = {}) {
  assertStaff(actor);
  const provider = providerOf(providerRaw);
  const p = PROVIDERS[provider];
  const asked = Array.isArray(body.purposes) && body.purposes.length ? [...new Set(body.purposes.map(String))] : ['ads', 'social'];
  const purposes = asked.filter((x2) => ['ads', 'social'].includes(x2) && p.scopes[x2].length && canFor(actor, x2));
  if (!purposes.length) throw new AppError('You can connect this account only for what your role manages (ads: school-wide marketing managers; social: social.connect).', 403, [], 'NOT_ALLOWED');
  if (!appConfigured(provider)) throw new AppError(notConfiguredMessage(provider), 409, [], 'APP_NOT_CONFIGURED');
  const nonce = String(body.browserNonce ?? '');
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) throw new AppError('browserNonce is required (16 to 128 URL-safe characters kept by the browser tab)', 400, [], 'BAD_NONCE');

  const state = b64url(crypto.randomBytes(32));
  const verifier = p.pkce ? b64url(crypto.randomBytes(48)) : null;
  const scopes = scopesFor(provider, purposes);
  await OAuthState.create({
    stateHash: sha256(state), provider, purposes, scopes, accountId: String(actor.accountId), profileId: String(actor.profileId),
    browserNonceHash: sha256(nonce), codeVerifierEnc: verifier ? encrypt({ verifier }) : null,
    returnPath: cleanReturnPath(body.returnPath), expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });
  const u = new URL(p.authorizeUrl());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', p.clientId());
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('scope', scopes.join(p.scopeSeparator));
  u.searchParams.set('state', state);
  if (verifier) {
    u.searchParams.set('code_challenge', b64url(crypto.createHash('sha256').update(verifier).digest()));
    u.searchParams.set('code_challenge_method', 'S256');
  }
  for (const [k, val] of Object.entries(p.extraAuthorizeParams ?? {})) u.searchParams.set(k, val);
  return { provider, authorizeUrl: u.toString(), purposes, scopes, expiresAt: new Date(Date.now() + STATE_TTL_MS) };
}

/**
 * Completes a connection with the code the provider sent back. The state must
 * be this school's, this person's, from this tab, unexpired and unused.
 */
export async function completeConnect(actor, body = {}) {
  assertStaff(actor);
  const state = String(body.state ?? '');
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(state)) throw new AppError('This connection link is not valid. Start again from the Connectors page.', 400, [], 'BAD_STATE');
  // Atomic single use, inside this school only (the tenant plugin filters by school).
  const row = await OAuthState.findOneAndUpdate(
    { stateHash: sha256(state), usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: true },
  ).select('+codeVerifierEnc');
  if (!row) throw new AppError('This connection link has expired or was already used. Start again from the Connectors page.', 400, [], 'BAD_STATE');
  if (row.accountId !== String(actor.accountId) || row.profileId !== String(actor.profileId)) throw new AppError('This connection was started by someone else.', 403, [], 'STATE_MISMATCH');
  const nonce = String(body.browserNonce ?? '');
  const given = Buffer.from(sha256(nonce));
  if (!crypto.timingSafeEqual(given, Buffer.from(row.browserNonceHash))) throw new AppError('This connection was started in a different browser tab. Start again from the Connectors page.', 403, [], 'STATE_MISMATCH');
  const provider = row.provider;
  if (body.error) {
    const reason = String(body.errorDescription || body.error).slice(0, 200);
    await recordError(provider, `The connection was not authorised: ${reason}`);
    throw new AppError(`${PROVIDERS[provider].label.split(' (')[0]} did not authorise the connection: ${reason}`, 400, [], 'NOT_AUTHORISED');
  }
  const code = String(body.code ?? '');
  if (!code || code.length > 2000) throw new AppError('The provider did not send an authorisation code.', 400, [], 'NO_CODE');
  if (!appConfigured(provider)) throw new AppError(notConfiguredMessage(provider), 409, [], 'APP_NOT_CONFIGURED');

  const client = CLIENTS[provider];
  let tokens;
  let found;
  try {
    tokens = await client.exchangeCode({ code, redirectUri: redirectUri(), codeVerifier: row.codeVerifierEnc ? decrypt(row.codeVerifierEnc)?.verifier : undefined });
    found = await client.discover(tokens);
  } catch (err) {
    const message = err instanceof ProviderError ? err.message : 'The provider could not be reached';
    await recordError(provider, message);
    throw new AppError(`Could not connect: ${message}`, 502, [], 'PROVIDER_ERROR');
  }
  const c = (await IntegrationConnection.findOne({ provider })) ?? new IntegrationConnection({ provider });
  const previous = c.selected ?? {};
  const selected = { ...found.defaults };
  for (const [k, val] of Object.entries(previous)) if (val && assetAllowed(provider, k, val, found.assets)) selected[k] = val;
  c.set({
    status: 'CONNECTED', purposes: [...new Set([...(c.purposes ?? []), ...row.purposes])], scopes: found.scopes?.length ? found.scopes : row.scopes,
    accountName: found.accountName ?? c.accountName ?? null,
    tokenEnc: encrypt(tokens), secretsEnc: encrypt(found.secrets ?? {}), accessExpiresAt: tokens.expiresAt ? new Date(tokens.expiresAt) : null,
    assets: found.assets, selected, lastRefreshAt: new Date(), lastError: { at: found.notes?.length ? new Date() : null, message: found.notes?.length ? found.notes.join(' ').slice(0, 500) : null },
    revokeResult: null, connectedByProfileId: actor.profileId, connectedByName: actor.displayName ?? null, connectedAt: new Date(),
  });
  c.markModified('assets'); c.markModified('selected');
  pushHistory(c, actor, 'CONNECTED', { note: row.purposes.join(', ') });
  await c.save();
  return { provider, returnPath: row.returnPath, connection: connectionDto(c) };
}

// ── assets ──────────────────────────────────────────────────────────

const SELECTABLE = {
  META: { metaPageId: (a) => (a.metaPages ?? []).map((p) => p.id), metaAdAccountId: (a) => (a.metaAdAccounts ?? []).map((p) => p.id) },
  GOOGLE: {
    googleCustomerId: (a) => (a.googleCustomers ?? []).map((p) => p.id), googleLoginCustomerId: (a) => (a.googleCustomers ?? []).map((p) => p.id),
    ga4PropertyId: (a) => (a.ga4Properties ?? []).map((p) => p.id), youtubeChannelId: (a) => (a.youtubeChannels ?? []).map((p) => p.id),
  },
  LINKEDIN: { linkedinOrgUrn: (a) => (a.linkedinOrgs ?? []).map((p) => p.urn), linkedinAdAccountId: (a) => (a.linkedinAdAccounts ?? []).map((p) => p.id) },
  X: { xUserId: (a) => (a.xUser ? [a.xUser.id] : []) },
};
function assetAllowed(provider, key, value, assets) {
  const list = SELECTABLE[provider]?.[key];
  return Boolean(list) && list(assets ?? {}).includes(String(value));
}

/** Chooses which Page / ad account / property / organisation the school uses: only ids the provider listed. */
export async function selectAssets(actor, providerRaw, body = {}) {
  assertStaff(actor);
  const provider = providerOf(providerRaw);
  const c = await IntegrationConnection.findOne({ provider });
  if (!c || c.status === 'DISCONNECTED') throw new AppError('Connect the account first.', 409, [], 'NOT_CONNECTED');
  if (!(c.purposes ?? []).some((p) => canFor(actor, p))) throw new AppError('Missing permission to change this connection', 403);
  const selected = { ...(c.selected ?? {}) };
  for (const [k, val] of Object.entries(body ?? {})) {
    if (!SELECTABLE[provider]?.[k]) throw new AppError(`${k} cannot be chosen for ${provider}`, 400, [], 'BAD_ASSET');
    if (val === null || val === '') { selected[k] = null; continue; }
    if (!assetAllowed(provider, k, val, c.assets)) throw new AppError(`That ${k.replace(/Id$|Urn$/, '')} is not one this connection can reach. Refresh the list and choose again.`, 400, [], 'BAD_ASSET');
    selected[k] = String(val);
  }
  c.selected = selected;
  c.markModified('selected');
  pushHistory(c, actor, 'ASSETS_SELECTED', { note: Object.entries(selected).filter(([, val]) => val).map(([k, val]) => `${k}=${val}`).join(', ').slice(0, 300) });
  await c.save();
  return connectionDto(c);
}

/** Re-reads what the account can reach (new Pages, ad accounts) without reconnecting. */
export async function refreshAssets(actor, providerRaw) {
  assertStaff(actor);
  const provider = providerOf(providerRaw);
  const c = await IntegrationConnection.findOne({ provider });
  if (!c || c.status !== 'CONNECTED') throw new AppError('Connect the account first.', 409, [], 'NOT_CONNECTED');
  if (!(c.purposes ?? []).some((p) => canFor(actor, p))) throw new AppError('Missing permission to change this connection', 403);
  const found = await withTokens(provider, (t) => CLIENTS[provider].discover(t));
  const fresh = await IntegrationConnection.findById(c._id);
  fresh.assets = found.assets;
  fresh.secretsEnc = encrypt(found.secrets ?? {});
  const selected = { ...found.defaults };
  for (const [k, val] of Object.entries(fresh.selected ?? {})) if (val && assetAllowed(provider, k, val, found.assets)) selected[k] = val;
  fresh.selected = selected;
  fresh.markModified('assets'); fresh.markModified('selected');
  await fresh.save();
  return connectionDto(fresh);
}

// ── tokens (server-side only) ───────────────────────────────────────

async function recordError(provider, message) {
  await IntegrationConnection.updateOne({ provider }, { $set: { 'lastError.at': new Date(), 'lastError.message': String(message).slice(0, 500) } });
}

/** The live connection for a provider, or null when the app is not configured or the school has not connected. */
export async function liveConnection(provider) {
  if (!appConfigured(provider)) return null;
  const c = await IntegrationConnection.findOne({ provider, status: 'CONNECTED' }).lean();
  return c ?? null;
}

const inflight = new Map();

/** Decrypted tokens, refreshed first when they are about to expire. */
export async function freshTokens(provider, { force = false } = {}) {
  const c = await IntegrationConnection.findOne({ provider, status: 'CONNECTED' }).select('+tokenEnc');
  if (!c?.tokenEnc) throw new ProviderError(`${provider}: not connected`, { auth: true });
  let tokens;
  try { tokens = decrypt(c.tokenEnc); } catch { throw new ProviderError(`${provider}: stored token cannot be read; reconnect`, { auth: true }); }
  const ahead = provider === 'META' ? META_EXTEND_AHEAD_MS : REFRESH_AHEAD_MS;
  const due = tokens.expiresAt && tokens.expiresAt - Date.now() < ahead;
  if (!force && !due) return tokens;
  if (provider === 'META' && tokens.expiresAt && tokens.expiresAt < Date.now()) {
    await markReconnect(provider, 'The Meta token expired; reconnect the account');
    throw new ProviderError('Meta: the token expired; reconnect the account', { auth: true });
  }
  // One refresh at a time per school and provider (X rotates refresh tokens: two at once would break it).
  const key = `${c.tenantId}:${provider}`;
  if (!inflight.has(key)) {
    inflight.set(key, (async () => {
      try {
        const next = await CLIENTS[provider].refresh(tokens);
        await IntegrationConnection.updateOne({ _id: c._id }, { $set: { tokenEnc: encrypt(next), accessExpiresAt: next.expiresAt ? new Date(next.expiresAt) : null, lastRefreshAt: new Date() } });
        return next;
      } catch (err) {
        if (err instanceof ProviderError && err.auth) await markReconnect(provider, err.message);
        throw err;
      } finally { inflight.delete(key); }
    })());
  }
  return inflight.get(key);
}

async function markReconnect(provider, message) {
  await IntegrationConnection.updateOne({ provider }, { $set: { status: 'NEEDS_RECONNECT', 'lastError.at': new Date(), 'lastError.message': String(message).slice(0, 500) } });
  logger.warn(`[integrations] ${provider} needs reconnecting`);
}

/** Runs `fn(tokens)`; on a refused token, refreshes once and tries again; then marks the connection for reconnecting. */
export async function withTokens(provider, fn) {
  const tokens = await freshTokens(provider);
  try {
    return await fn(tokens);
  } catch (err) {
    if (!(err instanceof ProviderError) || !err.auth) throw err;
    let again;
    try { again = await freshTokens(provider, { force: true }); } catch (e) { await markReconnect(provider, e.message); throw e; }
    try { return await fn(again); } catch (e2) { if (e2 instanceof ProviderError && e2.auth) await markReconnect(provider, e2.message); throw e2; }
  }
}

/** A Meta Page's own token (Page tokens from a long-lived user token do not expire). */
export async function metaPageToken(pageId) {
  const c = await IntegrationConnection.findOne({ provider: 'META', status: 'CONNECTED' }).select('+secretsEnc');
  let secrets = {};
  try { secrets = c?.secretsEnc ? decrypt(c.secretsEnc) ?? {} : {}; } catch { secrets = {}; }
  const t = secrets.pageTokens?.[String(pageId)];
  if (!t) throw new ProviderError('Meta: no token for that Page; refresh the list of Pages or reconnect', { auth: true });
  return t;
}

// ── disconnect ──────────────────────────────────────────────────────

/** Revokes at the provider when it offers that, and always wipes the tokens here. */
export async function disconnect(actor, providerRaw) {
  assertStaff(actor);
  const provider = providerOf(providerRaw);
  const c = await IntegrationConnection.findOne({ provider }).select('+tokenEnc +secretsEnc');
  if (!c || c.status === 'DISCONNECTED') throw new AppError('Not connected.', 409, [], 'NOT_CONNECTED');
  if (!(c.purposes ?? []).every((p) => canFor(actor, p))) throw new AppError('Disconnecting needs permission for everything this connection is used for.', 403, [], 'NOT_ALLOWED');
  let revokeResult = 'Removed here; the provider was not asked';
  if (c.tokenEnc && appConfigured(provider)) {
    try {
      revokeResult = await CLIENTS[provider].revoke(decrypt(c.tokenEnc));
    } catch (err) {
      revokeResult = `Removed here; revoking at the provider failed (${err instanceof ProviderError ? err.message : 'unreachable'}). Remove the app from the account's settings at the provider too.`;
    }
  }
  c.set({ status: 'DISCONNECTED', tokenEnc: null, secretsEnc: null, accessExpiresAt: null, revokeResult: revokeResult.slice(0, 400) });
  pushHistory(c, actor, 'DISCONNECTED', { note: revokeResult.slice(0, 200) });
  await c.save();
  return connectionDto(c);
}
