import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

const growthScoreSchema = new Schema(
  {
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true },
    period: { type: String, required: true }, // "2026-06"
    score: { type: Number, required: true },
    breakdown: { type: Schema.Types.Mixed, default: [] }, // [{component, raw, normalized, weight, points}]
    computedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
growthScoreSchema.index({ enrollmentId: 1, period: 1 }, { unique: true });

const riskPredictionSchema = new Schema(
  {
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true },
    type: { type: String, required: true }, // ACADEMIC_DECLINE | DROPOUT | FEE_DEFAULT | ATTENDANCE
    level: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], required: true },
    probability: { type: Number, required: true },
    topFeatures: { type: Schema.Types.Mixed, default: [] }, // [{feature, value, contribution}]
    modelVersion: { type: String, default: 'heuristic-v1' },
    computedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
riskPredictionSchema.index({ enrollmentId: 1, type: 1 }, { unique: true });

growthScoreSchema.plugin(tenantScoped); // school-owned
export const GrowthScore = model('GrowthScore', growthScoreSchema);
riskPredictionSchema.plugin(tenantScoped); // school-owned
export const RiskPrediction = model('RiskPrediction', riskPredictionSchema);
