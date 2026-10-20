import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * One write made with an `Idempotency-Key` header (offline queues replay
 * their writes with the key they were queued under). The first request runs
 * and its response is kept; a replay with the same key gets the same response
 * back and changes nothing. Kept for seven days.
 */
const idempotencyRecordSchema = new Schema(
  {
    key: { type: String, required: true },
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    method: { type: String, required: true },
    path: { type: String, required: true },
    bodyHash: { type: String, required: true },
    state: { type: String, enum: ['IN_PROGRESS', 'DONE'], default: 'IN_PROGRESS' },
    responseStatus: { type: Number, default: null },
    responseBody: { type: Schema.Types.Mixed, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, minimize: false },
);
idempotencyRecordSchema.index({ tenantId: 1, profileId: 1, key: 1 }, { unique: true });
idempotencyRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
idempotencyRecordSchema.plugin(tenantScoped);

export const IdempotencyRecord = model('IdempotencyRecord', idempotencyRecordSchema);
