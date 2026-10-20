import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry, attachmentEntry } from '../modules/ops/common.js';

/**
 * Offline marketing, ad-platform connectors and lead attribution.
 *
 * Builds on the existing Campaign (online, with a code used as utm_campaign)
 * and Lead (enquiry) records. An offline campaign is a banner, pamphlet,
 * radio spot, open house and so on, with its own tracking code: the code is
 * the short link and QR target, the utm_campaign on the online form, and can
 * also be matched from a tracking phone number, a promo code or a "how did
 * you hear about us" answer. Each way an enquiry is traced back to a campaign
 * is one LeadTouch row; the first touch is the one credited.
 *
 * Connectors hold credentials only through utils/crypto encrypt(); without
 * them the working path is a CSV export from the platform, imported here.
 */

export const OFFLINE_CHANNELS = [
  'BANNER_HOARDING', 'PAMPHLET_FLYER', 'POSTER', 'NEWSPAPER_AD', 'RADIO_SPOT', 'LOCAL_TV_CABLE',
  'SCHOOL_EVENT_OPEN_HOUSE', 'SEMINAR', 'REFERRAL_DRIVE', 'SOCIETY_ACTIVATION', 'SCHOOL_FAIR_STALL', 'OTHER_OFFLINE',
];
export const OFFLINE_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'LIVE', 'COMPLETED', 'CANCELLED'];
export const CONNECTOR_PLATFORMS = ['META_ADS', 'GOOGLE_ADS', 'GA4', 'YOUTUBE', 'LINKEDIN', 'CSV'];
export const TOUCH_VIA = ['QR_OR_SHORT_LINK', 'UTM', 'TRACKING_PHONE', 'PROMO_CODE', 'HEARD_FROM', 'LEAD_WEBHOOK', 'LEAD_CSV', 'MANUAL'];

const offlineCampaignSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    // Tracking code: short link, QR target and utm_campaign. Unique per school.
    code: { type: String, required: true, trim: true, uppercase: true },
    channelType: { type: String, enum: OFFLINE_CHANNELS, required: true },
    // The umbrella campaign (e.g. "Admissions 2027-28"), when there is one.
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null },
    placements: [{
      location: { type: String, required: true }, // "Sector 21 market, near the bus stop"
      detail: { type: String, default: null }, // size, slot, page, programme
      quantity: { type: Number, default: null },
    }],
    startsOn: { type: Date, required: true },
    endsOn: { type: Date, required: true },
    quantity: { type: Number, default: null }, // pamphlets printed, spots aired, posters put up
    vendorName: { type: String, default: null },
    costPaise: { type: Number, default: 0, min: 0 },
    billId: { type: Schema.Types.ObjectId, ref: 'Bill', default: null },
    assets: [attachmentEntry],
    trackingPhone: { type: String, default: null }, // a number printed only on this campaign
    promoCode: { type: String, default: null, uppercase: true, trim: true },
    status: { type: String, enum: OFFLINE_STATUSES, default: 'DRAFT' },
    decision: {
      byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      byName: { type: String, default: null },
      at: { type: Date, default: null },
      note: { type: String, default: null },
      // Part 3: decided by the campaign's creator, under single-approver mode.
      singleApprover: { type: Boolean, default: false },
    },
    scans: { type: Number, default: 0 }, // short link / QR opens (not people)
    lastScanAt: { type: Date, default: null },
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
offlineCampaignSchema.index({ tenantId: 1, code: 1 }, { unique: true });
offlineCampaignSchema.index({ tenantId: 1, promoCode: 1 });
offlineCampaignSchema.index({ tenantId: 1, trackingPhone: 1 });

/** Answers offered for "How did you hear about us?", each mapped to a channel and optionally a campaign. */
const heardFromOptionSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    channel: { type: String, required: true }, // an offline channel, or ONLINE_* / WORD_OF_MOUTH / OTHER
    offlineCampaignId: { type: Schema.Types.ObjectId, ref: 'OfflineCampaign', default: null },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

/** One way an enquiry was traced to a channel or campaign. The earliest touch is credited. */
const leadTouchSchema = new Schema(
  {
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
    via: { type: String, enum: TOUCH_VIA, required: true },
    channel: { type: String, required: true }, // e.g. POSTER, RADIO_SPOT, META_ADS, GOOGLE_ADS, WORD_OF_MOUTH
    offlineCampaignId: { type: Schema.Types.ObjectId, ref: 'OfflineCampaign', default: null },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null },
    platform: { type: String, default: null },
    detail: { type: String, default: null },
    utm: { source: String, medium: String, campaign: String, content: String, term: String },
    // A platform's own id for the lead (e.g. Meta leadgen_id); a resend is recognised by it.
    externalId: { type: String, default: null },
    at: { type: Date, default: Date.now },
    recordedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true }
);
leadTouchSchema.index({ leadId: 1, at: 1 });
leadTouchSchema.index({ tenantId: 1, externalId: 1 }, { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } });

const connectorSchema = new Schema(
  {
    platform: { type: String, enum: CONNECTOR_PLATFORMS, required: true },
    // NOT_CONNECTED until someone saves credentials. Saving them does not call the platform:
    // no live API sync is built, so the working path stays the CSV export.
    status: { type: String, enum: ['NOT_CONNECTED', 'CREDENTIALS_SAVED'], default: 'NOT_CONNECTED' },
    accountLabel: { type: String, default: null }, // e.g. ad account name or id the school typed
    credentialEnc: { type: String, default: null, select: false },
    credentialHint: { type: String, default: null }, // last four characters, for recognition only
    webhookSecretEnc: { type: String, default: null, select: false },
    webhookVerifyTokenEnc: { type: String, default: null, select: false },
    lastImportAt: { type: Date, default: null },
    lastWebhookAt: { type: Date, default: null },
    // Live sync through the provider API (modules/integrations/adsync.service.js): the last run, ok or not.
    lastSync: {
      at: { type: Date, default: null },
      ok: { type: Boolean, default: null },
      partial: { type: Boolean, default: false },
      from: { type: String, default: null }, // YYYY-MM-DD
      to: { type: String, default: null },
      rows: { type: Number, default: 0 },
      trigger: { type: String, default: null }, // MANUAL | SCHEDULED | ASSISTANT
      message: { type: String, default: null },
      problems: [{ scope: String, problem: String }],
    },
    lastSyncOkAt: { type: Date, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
connectorSchema.index({ tenantId: 1, platform: 1 }, { unique: true });

/** One platform-reported row: spend and results for one campaign on one day. */
const adMetricSchema = new Schema(
  {
    platform: { type: String, enum: CONNECTOR_PLATFORMS, required: true },
    date: { type: Date, required: true }, // the day, at UTC midnight
    campaignName: { type: String, required: true },
    campaignKey: { type: String, required: true }, // lower-case name, for matching and de-duplication
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null },
    offlineCampaignId: { type: Schema.Types.ObjectId, ref: 'OfflineCampaign', default: null },
    spendPaise: { type: Number, default: 0, min: 0 },
    impressions: { type: Number, default: 0, min: 0 },
    clicks: { type: Number, default: 0, min: 0 },
    leads: { type: Number, default: 0, min: 0 }, // as the platform reports them; CRM enquiries are counted separately
    conversions: { type: Number, default: 0, min: 0 }, // platform-reported conversions (live sync); leads are a subset on most platforms
    source: { type: String, enum: ['CSV', 'API', null], default: null }, // how the row arrived: an imported export or the live API sync
    externalCampaignId: { type: String, default: null }, // the platform's campaign id, when synced live
    simulated: { type: Boolean, default: false },
    importId: { type: Schema.Types.ObjectId, ref: 'AdImport', default: null },
  },
  { timestamps: true }
);
// Importing the same export twice replaces the rows instead of doubling the spend.
adMetricSchema.index({ tenantId: 1, platform: 1, date: 1, campaignKey: 1, simulated: 1 }, { unique: true });

const adImportSchema = new Schema(
  {
    platform: { type: String, enum: CONNECTOR_PLATFORMS, required: true },
    kind: { type: String, enum: ['METRICS', 'LEADS'], default: 'METRICS' },
    fileName: { type: String, default: null },
    rowsTotal: { type: Number, default: 0 },
    accepted: { type: Number, default: 0 },
    rejected: { type: Number, default: 0 },
    created: { type: Number, default: 0 }, // leads: new enquiries
    duplicates: { type: Number, default: 0 }, // leads: matched an existing enquiry
    problems: [{ row: Number, problem: String }],
    simulated: { type: Boolean, default: false },
    byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true }
);

/** School-wide marketing settings: today only the value used for ROI. */
const marketingSettingSchema = new Schema(
  {
    key: { type: String, default: 'default' },
    // What one admission is worth to the school, e.g. first-year fees. ROI is not shown until it is set.
    admissionValuePaise: { type: Number, default: null, min: 0 },
    updatedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true }
);
marketingSettingSchema.index({ tenantId: 1, key: 1 }, { unique: true });

for (const s of [offlineCampaignSchema, heardFromOptionSchema, leadTouchSchema, connectorSchema, adMetricSchema, adImportSchema, marketingSettingSchema]) s.plugin(tenantScoped);
export const OfflineCampaign = model('OfflineCampaign', offlineCampaignSchema);
export const HeardFromOption = model('HeardFromOption', heardFromOptionSchema);
export const LeadTouch = model('LeadTouch', leadTouchSchema);
export const MarketingConnector = model('MarketingConnector', connectorSchema);
export const AdMetric = model('AdMetric', adMetricSchema);
export const AdImport = model('AdImport', adImportSchema);
export const MarketingSetting = model('MarketingSetting', marketingSettingSchema);
