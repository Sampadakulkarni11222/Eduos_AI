import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * The daily learning and trends digest: RSS/Atom sources an administrator
 * approved, the items read from them (titles, links and short summaries as
 * plain text), each person's interests, and the digest built for them each day.
 */
export const INTERESTS = ['SCIENCE', 'TECHNOLOGY', 'SPORTS', 'CAREERS', 'EDUCATION_POLICY', 'ARTS', 'ENVIRONMENT', 'MATHEMATICS'];

const sourceSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    interests: [{ type: String, enum: INTERESTS }],
    status: { type: String, enum: ['APPROVED', 'PAUSED'], default: 'APPROVED' },
    approvedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    approvedByName: { type: String, default: null },
    lastFetchedAt: { type: Date, default: null },
    lastStatus: { type: String, enum: ['NEVER', 'OK', 'FAILED'], default: 'NEVER' },
    lastError: { type: String, default: null },
    lastItemCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);
sourceSchema.index({ tenantId: 1, url: 1 }, { unique: true });

const itemSchema = new Schema(
  {
    sourceId: { type: Schema.Types.ObjectId, ref: 'DigestSource', required: true },
    sourceTitle: { type: String, default: null },
    link: { type: String, required: true },
    title: { type: String, required: true },
    summary: { type: String, default: '' },
    interests: [{ type: String, enum: INTERESTS }],
    publishedAt: { type: Date, default: null },
    fetchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
// One item per link per school, however many sources carry it.
itemSchema.index({ tenantId: 1, link: 1 }, { unique: true });
itemSchema.index({ fetchedAt: -1 });

const preferenceSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    interests: [{ type: String, enum: INTERESTS }],
    // Email copy of the daily digest, only if the person asked for it.
    emailOptIn: { type: Boolean, default: false },
  },
  { timestamps: true }
);
preferenceSchema.index({ tenantId: 1, profileId: 1 }, { unique: true });

const editionSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    day: { type: String, required: true }, // YYYY-MM-DD in the school's time zone
    interests: [{ type: String }],
    items: [{
      itemId: { type: Schema.Types.ObjectId, ref: 'DigestItem' },
      title: String, link: String, summary: String, interest: String, sourceTitle: String, publishedAt: Date,
    }],
    emailStatus: { type: String, default: null },
  },
  { timestamps: true }
);
editionSchema.index({ tenantId: 1, profileId: 1, day: 1 }, { unique: true });

for (const s of [sourceSchema, itemSchema, preferenceSchema, editionSchema]) s.plugin(tenantScoped);
export const DigestSource = model('DigestSource', sourceSchema);
export const DigestItem = model('DigestItem', itemSchema);
export const DigestPreference = model('DigestPreference', preferenceSchema);
export const DigestEdition = model('DigestEdition', editionSchema);
