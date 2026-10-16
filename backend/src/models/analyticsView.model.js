import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * A saved analytics view: one person's named set of filters, tab, focused
 * metric and metric keys, kept on the server so it follows them across
 * devices (part 3, decision 2). Private to its owner; nothing here is shared.
 */
const analyticsViewSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    filters: {
      preset: { type: String, default: null }, from: { type: String, default: null }, to: { type: String, default: null },
      compare: { type: String, default: null }, compareFrom: { type: String, default: null }, compareTo: { type: String, default: null },
      department: { type: String, default: null },
    },
    tab: { type: String, default: null },
    focus: { type: String, default: null },
    metricKeys: { type: [String], default: [] },
  },
  { timestamps: true },
);
analyticsViewSchema.index({ tenantId: 1, profileId: 1, name: 1 }, { unique: true });
analyticsViewSchema.plugin(tenantScoped);
export const AnalyticsView = model('AnalyticsView', analyticsViewSchema);
