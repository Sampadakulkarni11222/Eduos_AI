import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

const leadSchema = new Schema(
  {
    childName: { type: String, required: true, trim: true },
    guardianName: { type: String, required: true, trim: true },
    phone: { type: String, required: true },
    email: { type: String },
    gradeApplying: { type: String },
    source: { type: String, default: 'WALK_IN' }, // WHATSAPP | WEB | WALK_IN | REFERRAL
    stage: {
      type: String,
      enum: ['NEW', 'CONTACTED', 'TOUR_SCHEDULED', 'APPLICATION', 'ENROLLED', 'LOST'],
      default: 'NEW',
    },
    assigneeProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    notes: { type: String },
    nextActionAt: { type: Date },
  },
  { timestamps: true }
);
leadSchema.index({ stage: 1 });
leadSchema.index({ assigneeProfileId: 1 });

const leadInteractionSchema = new Schema(
  {
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
    type: { type: String, required: true }, // NOTE | CALL | WHATSAPP | EMAIL | STAGE_CHANGE
    body: { type: String, required: true },
    authorProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true }
);
leadInteractionSchema.index({ leadId: 1 });

leadSchema.plugin(tenantScoped); // school-owned
export const Lead = model('Lead', leadSchema);
leadInteractionSchema.plugin(tenantScoped); // school-owned
export const LeadInteraction = model('LeadInteraction', leadInteractionSchema);
