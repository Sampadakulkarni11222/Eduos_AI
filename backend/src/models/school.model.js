import { Schema, model } from 'mongoose';

/**
 * A school — now a record of its own rather than a label on its profiles.
 *
 * `slug` is the identity everything else uses: it is the `tenantId` stamped on
 * every school-owned document, and it is the first segment of the portal URL
 * (`/oakridge/admin`, `/nvmp/admin`). Renaming a school changes `name`; the
 * slug is fixed, because changing it would orphan every document carrying it.
 *
 * Not tenant-scoped itself: the Super Admin reads the whole list.
 */
const schoolSchema = new Schema(
  {
    slug: {
      type: String, required: true, unique: true, lowercase: true, trim: true,
      match: [/^[a-z0-9][a-z0-9-]{1,63}$/, 'slug must be 2-64 lowercase letters, digits or hyphens'],
    },
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
  },
  { timestamps: true }
);

export const School = model('School', schoolSchema);
