import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * School-wide policies that change who may do what, kept apart from feature
 * switches (which say whether a module is on). One row per school.
 *
 * singleApproverMode (decision 3 of part 3): off by default. When a small
 * school has no second approver, the principal or administrator may approve
 * their own showcase entry, fixture result, offline campaign or bill payment;
 * every such record is marked "single-approver". Changing it needs
 * settings.manage at school-wide scope and is audit-logged.
 */
const schoolPolicySchema = new Schema(
  {
    key: { type: String, default: 'default' },
    singleApproverMode: {
      enabled: { type: Boolean, default: false },
      changedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      changedByName: { type: String, default: null },
      changedAt: { type: Date, default: null },
      reason: { type: String, default: null },
    },
  },
  { timestamps: true },
);
schoolPolicySchema.index({ tenantId: 1, key: 1 }, { unique: true });
schoolPolicySchema.plugin(tenantScoped);
export const SchoolPolicy = model('SchoolPolicy', schoolPolicySchema);
