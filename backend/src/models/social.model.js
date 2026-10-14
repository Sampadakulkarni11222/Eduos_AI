import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry } from '../modules/ops/common.js';

/**
 * External social publishing for the newsroom (staff only).
 *
 * A post chooses its networks; each network is one outbox row, keyed by
 * post + network, so a retry can never post twice. Without provider
 * credentials the honest outcome is SIMULATED: nothing left the server.
 */
export const NETWORKS = ['FACEBOOK', 'INSTAGRAM', 'X', 'LINKEDIN', 'YOUTUBE'];
export const OUTBOX_STATUSES = ['QUEUED', 'SENDING', 'SENT', 'FAILED', 'SIMULATED'];

const socialAccountSchema = new Schema(
  {
    network: { type: String, enum: NETWORKS, required: true },
    handle: { type: String, required: true, trim: true },
    // Connecting needs the network's official OAuth flow, which is not built:
    // an account is recorded and waits for provider credentials.
    status: { type: String, enum: ['CONNECTION_PENDING', 'DISCONNECTED'], default: 'CONNECTION_PENDING' },
    statusNote: { type: String, default: 'Connection pending: needs provider credentials' },
    // Reserved for a provider token, held only through utils/crypto encrypt(). Never set from a request body.
    credentialEnc: { type: String, default: null, select: false },
    connectedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    history: [historyEntry],
  },
  { timestamps: true }
);
socialAccountSchema.index({ tenantId: 1, network: 1, handle: 1 }, { unique: true });

const socialPostSchema = new Schema(
  {
    // The newsroom story this shares, if any.
    communityPostId: { type: Schema.Types.ObjectId, ref: 'CommunityPost', default: null },
    text: { type: String, required: true },
    link: { type: String, default: null },
    networks: [{ type: String, enum: NETWORKS }],
    // Every child who appears: their public-media consent is checked when the
    // post is composed and again at the moment of publishing.
    studentIds: [{ type: Schema.Types.ObjectId, ref: 'Student' }],
    noIdentifiableStudents: { type: Boolean, default: false },
    status: { type: String, enum: ['DRAFT', 'PUBLISHING', 'DONE', 'BLOCKED'], default: 'DRAFT' },
    blockedReason: { type: String, default: null },
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    createdByName: { type: String, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
socialPostSchema.index({ createdAt: -1 });

const socialOutboxSchema = new Schema(
  {
    socialPostId: { type: Schema.Types.ObjectId, ref: 'SocialPost', required: true },
    network: { type: String, enum: NETWORKS, required: true },
    // `${socialPostId}:${network}` — one row, and at most one delivery, per post and network.
    idempotencyKey: { type: String, required: true },
    status: { type: String, enum: OUTBOX_STATUSES, default: 'QUEUED' },
    statusReason: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    providerPostId: { type: String, default: null },
    lastAttemptAt: { type: Date, default: null },
    statusHistory: [{ status: String, at: { type: Date, default: Date.now }, detail: String }],
  },
  { timestamps: true }
);
socialOutboxSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
socialOutboxSchema.index({ socialPostId: 1 });

for (const s of [socialAccountSchema, socialPostSchema, socialOutboxSchema]) s.plugin(tenantScoped);
export const SocialAccount = model('SocialAccount', socialAccountSchema);
export const SocialPost = model('SocialPost', socialPostSchema);
export const SocialOutbox = model('SocialOutbox', socialOutboxSchema);
