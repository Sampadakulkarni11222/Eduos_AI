import { Schema, model } from 'mongoose';

/**
 * Per-tenant school settings stored in MongoDB.
 * Keyed by tenantId so a single deployment can host multiple schools.
 * Most fields are optional overrides; env.SCHOOL_NAME is the fallback for
 * existing PDF renderers until they migrate to reading from this collection.
 */
const schoolSettingsSchema = new Schema(
  {
    tenantId: { type: String, required: true, unique: true },
    schoolName: { type: String, trim: true },
    logoUrl: { type: String, default: null },
    address: { type: String, default: null },
    phone: { type: String, default: null },
    email: { type: String, default: null },
    website: { type: String, default: null },
    currentAcademicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear', default: null },
    timezone: { type: String, default: 'Asia/Kolkata' },
    currency: { type: String, default: 'INR' },
  },
  { timestamps: true }
);

export const SchoolSettings = model('SchoolSettings', schoolSettingsSchema);
