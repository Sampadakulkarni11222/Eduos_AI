import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * A saved what-if scenario: a name and the assumptions someone chose
 * (enrolment, fees, staffing, transport, budget) for a 1–5 year projection.
 * The projection itself is recomputed from current actuals each time it is
 * read, so a saved scenario never shows stale actuals; the actuals it was
 * first built on are kept for reference.
 */
const scenarioSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    years: { type: Number, min: 1, max: 5, default: 3 },
    assumptions: { type: Schema.Types.Mixed, default: {} },
    baselineAtSave: { type: Schema.Types.Mixed, default: null },
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    createdByName: { type: String, default: null },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false },
);
scenarioSchema.index({ tenantId: 1, archivedAt: 1, updatedAt: -1 });
scenarioSchema.plugin(tenantScoped);

export const Scenario = model('Scenario', scenarioSchema);
