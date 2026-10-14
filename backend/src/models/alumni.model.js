import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry } from '../modules/ops/common.js';

/**
 * Alumni: former students and former staff, their batch, what they chose to
 * show in the directory, reunions, and the social links a current student may
 * add to their profile.
 *
 * Consent is per field and off by default: the directory shows a person's
 * name and batch (or served years) and nothing else until they opt in.
 */

export const LINK_KEYS = ['linkedin', 'instagram', 'github', 'website'];
const linksSchema = new Schema(
  { linkedin: { type: String, default: null }, instagram: { type: String, default: null }, github: { type: String, default: null }, website: { type: String, default: null } },
  { _id: false }
);

const alumniProfileSchema = new Schema(
  {
    // The ALUMNUS login profile; null when the leaver had no login of their own.
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    // The student or staff profile that was closed at the transition.
    formerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    formerRole: { type: String, default: null },
    kind: { type: String, enum: ['FORMER_STUDENT', 'FORMER_STAFF'], required: true },
    // The archived school record (former students only); read by its owner as their own record.
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    displayName: { type: String, required: true, trim: true },
    // Former students: passing-out (or leaving) year, last section, house.
    batchYear: { type: Number, default: null },
    section: { type: String, default: null },
    house: { type: String, default: null },
    // Former staff: the years they served.
    servedFrom: { type: Number, default: null },
    servedTo: { type: Number, default: null },
    leftReason: { type: String, enum: ['GRADUATED', 'LEFT', 'TRANSFERRED', 'RESIGNED', 'RETIRED'], required: true },
    verified: { type: Boolean, default: true },
    // Listed in the directory (name and batch only) unless the person opts out.
    listed: { type: Boolean, default: true },
    // Optional fields, each shown only with its own consent.
    profession: { type: String, default: null },
    city: { type: String, default: null },
    links: { type: linksSchema, default: () => ({}) },
    consent: {
      profession: { type: Boolean, default: false },
      city: { type: Boolean, default: false },
      links: { type: Boolean, default: false },
      at: { type: Date, default: null },
    },
    status: { type: String, enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
    transitionedAt: { type: Date, default: Date.now },
    transitionedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
alumniProfileSchema.index({ tenantId: 1, profileId: 1 }, { unique: true, partialFilterExpression: { profileId: { $type: 'objectId' } } });
alumniProfileSchema.index({ tenantId: 1, studentId: 1 }, { unique: true, partialFilterExpression: { studentId: { $type: 'objectId' } } });
alumniProfileSchema.index({ tenantId: 1, formerProfileId: 1 }, { unique: true, partialFilterExpression: { formerProfileId: { $type: 'objectId' } } });
alumniProfileSchema.index({ batchYear: 1, kind: 1 });

const alumniEventSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    // null = every alumnus of the school; otherwise one passing-out batch.
    batchYear: { type: Number, default: null },
    startsAt: { type: Date, required: true },
    venue: { type: String, default: null },
    status: { type: String, enum: ['PLANNED', 'CANCELLED', 'DONE'], default: 'PLANNED' },
    rsvps: [{ profileId: { type: Schema.Types.ObjectId, ref: 'Profile' }, name: String, response: { type: String, enum: ['YES', 'NO', 'MAYBE'] }, at: { type: Date, default: Date.now } }],
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    history: [historyEntry],
  },
  { timestamps: true }
);
alumniEventSchema.index({ startsAt: -1 });

/**
 * Social links on a current student's profile. Seen by the student, their
 * guardians and school staff; other students and parents see them only when
 * the student consents and, for a minor, a guardian consents too.
 */
const studentLinksSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    links: { type: linksSchema, default: () => ({}) },
    studentConsent: { given: { type: Boolean, default: false }, at: { type: Date, default: null } },
    guardianConsent: {
      given: { type: Boolean, default: false },
      byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      at: { type: Date, default: null },
    },
    updatedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true }
);
studentLinksSchema.index({ tenantId: 1, studentId: 1 }, { unique: true });

for (const s of [alumniProfileSchema, alumniEventSchema, studentLinksSchema]) s.plugin(tenantScoped);
export const AlumniProfile = model('AlumniProfile', alumniProfileSchema);
export const AlumniEvent = model('AlumniEvent', alumniEventSchema);
export const StudentSocialLinks = model('StudentSocialLinks', studentLinksSchema);
