import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry } from '../modules/ops/common.js';

/**
 * A school's OAuth connection to one provider app (Meta, Google, LinkedIn, X).
 *
 * Tokens are held only through utils/crypto encrypt() in `tokenEnc` and
 * `secretsEnc` (Meta Page tokens), both `select: false`, and are never put in
 * a response or a log. `assets` lists what the connected account can reach
 * (ad accounts, Pages, Instagram accounts, organisations, properties) by id
 * and name only; `selected` is which of those the school uses.
 */
export const INTEGRATION_PROVIDERS = ['META', 'GOOGLE', 'LINKEDIN', 'X'];
export const CONNECTION_STATUSES = ['CONNECTED', 'NEEDS_RECONNECT', 'DISCONNECTED'];

const connectionSchema = new Schema(
  {
    provider: { type: String, enum: INTEGRATION_PROVIDERS, required: true },
    status: { type: String, enum: CONNECTION_STATUSES, default: 'CONNECTED' },
    purposes: [{ type: String, enum: ['ads', 'social'] }],
    scopes: [String], // as granted by the provider
    accountName: { type: String, default: null }, // the person / account that authorised, as the provider names it
    tokenEnc: { type: String, default: null, select: false }, // { accessToken, refreshToken, expiresAt, refreshExpiresAt }
    secretsEnc: { type: String, default: null, select: false }, // { pageTokens: { [pageId]: token } }
    accessExpiresAt: { type: Date, default: null }, // for display and refresh planning only
    assets: { type: Schema.Types.Mixed, default: {} },
    selected: { type: Schema.Types.Mixed, default: {} },
    lastRefreshAt: { type: Date, default: null },
    lastError: { at: { type: Date, default: null }, message: { type: String, default: null } },
    revokeResult: { type: String, default: null }, // what happened when it was disconnected
    connectedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    connectedByName: { type: String, default: null },
    connectedAt: { type: Date, default: null },
    history: [historyEntry],
  },
  { timestamps: true, minimize: false }
);
connectionSchema.index({ tenantId: 1, provider: 1 }, { unique: true });
// The app-level Meta webhook finds the school by the Page id (outside any tenant context).
connectionSchema.index({ provider: 1, 'selected.metaPageId': 1 });

/**
 * One OAuth attempt. The `state` sent to the provider is random; only its
 * SHA-256 is stored. It is bound to the school (tenant plugin), the person
 * (account + profile) and the browser tab (a nonce the tab keeps in
 * sessionStorage, also stored hashed), lives ten minutes and is used once.
 */
const oauthStateSchema = new Schema(
  {
    stateHash: { type: String, required: true },
    provider: { type: String, enum: INTEGRATION_PROVIDERS, required: true },
    purposes: [String],
    scopes: [String],
    accountId: { type: String, required: true },
    profileId: { type: String, required: true },
    browserNonceHash: { type: String, required: true },
    codeVerifierEnc: { type: String, default: null, select: false },
    returnPath: { type: String, default: null },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
oauthStateSchema.index({ stateHash: 1 }, { unique: true });
oauthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

for (const s of [connectionSchema, oauthStateSchema]) s.plugin(tenantScoped);
export const IntegrationConnection = model('IntegrationConnection', connectionSchema);
export const OAuthState = model('OAuthState', oauthStateSchema);
