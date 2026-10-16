import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * A member of staff's professional profile: qualifications, subjects and
 * specialisations, years of experience, certifications (CTET and the like)
 * and a short public bio.
 *
 * Each part has its own "show to families" consent, off by default. Families
 * (parents and students) only ever receive the parts the person has agreed to
 * show, and only for teachers of their own child's class; staff inside the
 * school see the whole record. The person edits their own; HR may edit any
 * (and the consent stays the person's choice, recorded with who changed it).
 */
const qualificationSchema = new Schema(
  {
    degree: { type: String, required: true, trim: true, maxlength: 120 },
    institution: { type: String, trim: true, default: null, maxlength: 160 },
    year: { type: Number, default: null, min: 1950, max: 2100 },
  },
  { _id: false }
);
const certificationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    issuer: { type: String, trim: true, default: null, maxlength: 120 },
    year: { type: Number, default: null, min: 1950, max: 2100 },
  },
  { _id: false }
);

export const CREDENTIAL_PARTS = ['qualifications', 'subjects', 'experience', 'certifications', 'bio'];

const staffCredentialSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    qualifications: { type: [qualificationSchema], default: [] },
    subjects: { type: [String], default: [] },
    specialisations: { type: [String], default: [] },
    experienceYears: { type: Number, default: null, min: 0, max: 60 },
    certifications: { type: [certificationSchema], default: [] },
    bio: { type: String, trim: true, default: null, maxlength: 600 },
    // "Show to families", per part. Off until the person turns it on.
    showToFamilies: {
      qualifications: { type: Boolean, default: false },
      subjects: { type: Boolean, default: false },
      experience: { type: Boolean, default: false },
      certifications: { type: Boolean, default: false },
      bio: { type: Boolean, default: false },
    },
    updatedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true }
);
staffCredentialSchema.index({ tenantId: 1, profileId: 1 }, { unique: true });

staffCredentialSchema.plugin(tenantScoped); // school-owned
export const StaffCredential = model('StaffCredential', staffCredentialSchema);
