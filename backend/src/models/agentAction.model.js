import { Schema, model } from 'mongoose';

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
    summary: { type: String, required: true },
    source: { type: String, enum: ['WEB', 'WHATSAPP'], default: 'WEB' },
    status: {
      type: String,
      enum: ['PENDING', 'EXECUTED', 'REJECTED', 'EXPIRED', 'FAILED'],
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

export const AgentAction = model('AgentAction', agentActionSchema);
