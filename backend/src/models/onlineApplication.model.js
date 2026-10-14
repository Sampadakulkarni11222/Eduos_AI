import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * An application made through a school's public admission form.
 *
 * The CRM record is the Lead it created (stage NEW, source WEB); this keeps
 * what the family submitted, the documents they uploaded, the reference number
 * they were given and the one-time code used to show them their own status.
 * The code is stored only as a bcrypt hash, exactly as sign-in codes are.
 */
const applicationSchema = new Schema(
  {
    refNo: { type: String, required: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
    childName: { type: String, required: true, trim: true },
    dateOfBirth: { type: Date, default: null },
    gender: { type: String, default: null },
    gradeApplying: { type: String, default: null },
    academicYear: { type: String, default: null },
    previousSchool: { type: String, default: null },
    guardianName: { type: String, required: true, trim: true },
    relation: { type: String, default: null },
    phone: { type: String, required: true },
    email: { type: String, default: null },
    address: { type: String, default: null },
    message: { type: String, default: null },
    contactConsent: { type: Boolean, default: false },
    documents: [{
      _id: false,
      kind: { type: String, default: 'OTHER' },
      name: { type: String, required: true },
      storedName: { type: String, required: true },
      size: { type: Number, default: 0 },
    }],
    otp: {
      codeHash: { type: String, default: null },
      expiresAt: { type: Date, default: null },
      attempts: { type: Number, default: 0 },
      issued: { type: [Date], default: [] },
    },
    lastViewedAt: { type: Date, default: null },
    submittedFrom: { type: String, default: null }, // hashed client address, for abuse review only
  },
  { timestamps: true }
);
applicationSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
applicationSchema.index({ tenantId: 1, leadId: 1 });

applicationSchema.plugin(tenantScoped);
export const OnlineApplication = model('OnlineApplication', applicationSchema);
