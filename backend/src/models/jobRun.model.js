import { Schema, model } from 'mongoose';

/**
 * One run of one scheduled job for one school in one time window.
 *
 * The unique `key` is what makes the scheduler safe to run in more than one
 * server process: each process tries to insert the same key for the window,
 * and only the one that succeeds does the work. It is platform data, not a
 * school's, so it is not tenant-scoped.
 */
const jobRunSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    job: { type: String, required: true },
    tenantId: { type: String, required: true },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
    ok: { type: Boolean, default: null },
    result: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    // Times a crashed run was taken over after its lease ran out.
    attempts: { type: Number, default: 1 },
  },
  { versionKey: false },
);

// History is for diagnosis, not record-keeping: a month is plenty.
jobRunSchema.index({ startedAt: 1 }, { expireAfterSeconds: 30 * 86_400 });
jobRunSchema.index({ job: 1, tenantId: 1, startedAt: -1 });

export const JobRun = model('JobRun', jobRunSchema);
