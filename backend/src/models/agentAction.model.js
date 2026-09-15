import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * A write the agent has proposed and is waiting to be confirmed, plus the
 * record of what happened to it.
 *
 * The proposed arguments are stored server-side and the caller only ever gets
 * an opaque token back. If the arguments travelled to the client and back, a
 * user could confirm something different from what they were shown — which is
 * exactly the failure mode confirm-before-commit exists to prevent.
 */
const agentActionSchema = new Schema(
  {
    actorProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true, index: true },
    tool: { type: String, required: true },
    args: { type: Schema.Types.Mixed },
    /**
     * Output of a tool's prepare() step, captured at proposal time.
     *
     * Stored rather than recomputed so that what the user confirmed is exactly
     * what gets written. Regenerating at confirmation time would let an LLM
     * produce different content from the summary the human approved.
     */
    prepared: { type: Schema.Types.Mixed, default: null },
    summary: { type: String, required: true },
    source: { type: String, enum: ['WEB', 'WHATSAPP'], default: 'WEB' },
    status: {
      type: String,
      // EXECUTING is the claimed state between a confirmation being accepted
      // and the write finishing. It exists so the claim can be one atomic
      // PENDING → EXECUTING update: two concurrent "yes" requests for the same
      // proposal race on that update and exactly one wins, instead of both
      // reading PENDING and both performing the write.
      enum: ['PENDING', 'EXECUTING', 'EXECUTED', 'REJECTED', 'EXPIRED', 'FAILED'],
      default: 'PENDING',
    },
    tokenHash: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    executedAt: { type: Date },
    error: { type: String },
  },
  { timestamps: true }
);

// Stale proposals clean themselves up; an unconfirmed action must not sit
// around indefinitely waiting to be triggered.
agentActionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

agentActionSchema.plugin(tenantScoped); // school-owned
export const AgentAction = model('AgentAction', agentActionSchema);
