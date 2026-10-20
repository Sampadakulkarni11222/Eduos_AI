import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry } from '../modules/ops/common.js';

/**
 * Marketing & admissions: campaigns, creative assets, intake capacity, seat
 * offers and counselling appointments. Enquiries themselves are the existing
 * Lead records.
 */
const campaignSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true }, // used as utm_campaign
    objective: { type: String, enum: ['ENQUIRIES', 'EVENT_FOOTFALL', 'OPEN_HOUSE', 'BRAND', 'RE_ENGAGEMENT', 'OTHER'], default: 'ENQUIRIES' },
    channels: [{ type: String, enum: ['SOCIAL', 'SEARCH', 'PRINT', 'OUTDOOR', 'RADIO', 'EVENT', 'REFERRAL', 'WHATSAPP', 'EMAIL', 'WEBSITE', 'OTHER'] }],
    audience: { type: String, default: null }, // description only; no sensitive targeting
    gradesOrProgrammes: [{ type: String }],
    academicYear: { type: String, default: null },
    startsOn: { type: Date, required: true },
    endsOn: { type: Date, required: true },
    budgetPaise: { type: Number, default: 0, min: 0 },
    spentPaise: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'], default: 'PLANNED' },
    ownerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
campaignSchema.index({ tenantId: 1, code: 1 }, { unique: true });

/** Standard print/digital sizes offered when creating an asset. */
export const ASSET_SIZES = {
  A4_POSTER: { w: 210, h: 297, unit: 'mm' },
  A3_POSTER: { w: 297, h: 420, unit: 'mm' },
  FLEX_BANNER_6x3: { w: 6, h: 3, unit: 'ft' },
  STANDEE: { w: 2.5, h: 6, unit: 'ft' },
  INSTAGRAM_POST: { w: 1080, h: 1080, unit: 'px' },
  INSTAGRAM_STORY: { w: 1080, h: 1920, unit: 'px' },
  FACEBOOK_POST: { w: 1200, h: 630, unit: 'px' },
  WHATSAPP_STATUS: { w: 1080, h: 1920, unit: 'px' },
  WEB_BANNER: { w: 1920, h: 600, unit: 'px' },
  BROCHURE: { w: 210, h: 297, unit: 'mm' },
  OTHER: { w: null, h: null, unit: null },
};

const creativeAssetSchema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null },
    kind: { type: String, enum: ['POSTER', 'BANNER', 'SOCIAL_POST', 'BROCHURE', 'VIDEO', 'LANDING_PAGE', 'OTHER'], required: true },
    title: { type: String, required: true, trim: true },
    size: { type: String, enum: Object.keys(ASSET_SIZES), default: 'OTHER' },
    headline: { type: String, default: null },
    copy: { type: String, default: null },
    callToAction: { type: String, default: null },
    altText: { type: String, default: null },
    // Every factual claim (results, rankings, affiliations, testimonials) must be checked.
    claims: [{ text: String, verified: { type: Boolean, default: false }, evidence: String, verifiedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' } }],
    // Students appearing in the artwork need media consent at PUBLIC level.
    featuredStudentIds: [{ type: Schema.Types.ObjectId, ref: 'Student' }],
    versions: [{ version: Number, url: String, note: String, at: { type: Date, default: Date.now }, byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' } }],
    aiAssisted: { type: Boolean, default: false },
    status: { type: String, enum: ['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED'], default: 'DRAFT' },
    publishedTo: [{ channel: String, at: Date, url: String }],
    reviewedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);

/** Seats on offer for a grade (school) or programme (college) in an academic year. */
const intakeCapacitySchema = new Schema(
  {
    academicYear: { type: String, required: true },
    gradeOrProgramme: { type: String, required: true },
    capacity: { type: Number, required: true, min: 0 },
    // Seats held back under configured rules (e.g. RTE 12(1)(c) where applicable,
    // management quota) — configured by the school after verifying applicability.
    reserved: [{ category: String, seats: Number, note: String }],
    offered: { type: Number, default: 0 },
    accepted: { type: Number, default: 0 },
  },
  { timestamps: true }
);
intakeCapacitySchema.index({ tenantId: 1, academicYear: 1, gradeOrProgramme: 1 }, { unique: true });

/**
 * One applicant's offer. The states separate what people often blur: an
 * application, an offer, an accepted offer, a paid fee and an enrolled student.
 */
const seatOfferSchema = new Schema(
  {
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
    academicYear: { type: String, required: true },
    gradeOrProgramme: { type: String, required: true },
    category: { type: String, default: 'GENERAL' },
    status: { type: String, enum: ['WAITLISTED', 'OFFERED', 'ACCEPTED', 'FEE_PAID', 'ENROLLED', 'DECLINED', 'EXPIRED', 'WITHDRAWN'], required: true },
    waitlistPosition: { type: Number, default: null },
    offerExpiresOn: { type: Date, default: null },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
seatOfferSchema.index({ tenantId: 1, leadId: 1, academicYear: 1 }, { unique: true });

const counsellingAppointmentSchema = new Schema(
  {
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
    counsellorProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    kind: { type: String, enum: ['CALL', 'CAMPUS_TOUR', 'COUNSELLING', 'INTERVIEW', 'ENTRANCE_TEST', 'DOCUMENT_CHECK'], required: true },
    at: { type: Date, required: true },
    durationMinutes: { type: Number, default: 30 },
    status: { type: String, enum: ['SCHEDULED', 'DONE', 'NO_SHOW', 'CANCELLED'], default: 'SCHEDULED' },
    outcome: { type: String, default: null },
  },
  { timestamps: true }
);
counsellingAppointmentSchema.index({ counsellorProfileId: 1, at: 1 });

for (const s of [campaignSchema, creativeAssetSchema, intakeCapacitySchema, seatOfferSchema, counsellingAppointmentSchema]) s.plugin(tenantScoped);
export const Campaign = model('Campaign', campaignSchema);
export const CreativeAsset = model('CreativeAsset', creativeAssetSchema);
export const IntakeCapacity = model('IntakeCapacity', intakeCapacitySchema);
export const SeatOffer = model('SeatOffer', seatOfferSchema);
export const CounsellingAppointment = model('CounsellingAppointment', counsellingAppointmentSchema);
