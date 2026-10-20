import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { OPP_DOMAINS, OPP_LEVELS, OPP_TYPES } from './newsletter.model.js';

/**
 * The newsletter's alert feeds and AI help (part 5).
 *
 *   NewsletterFeedSource  a feed an editor added for the newsletter: a Google
 *                         Alerts RSS feed (the alert's "Deliver to: RSS feed"
 *                         address, https://www.google.com/alerts/feeds/...) or
 *                         another approved RSS/Atom feed, with topic tags
 *                         (domains, level, region). Read hourly by the
 *                         SSRF-safe fetcher, with per-source backoff on errors.
 *                         Google Alerts has no API: this is its RSS delivery.
 *   NewsletterFeedItem    one item read from such a feed, kept once per real
 *                         article link (Google's redirect links are unwrapped),
 *                         and what became of it: an opportunity candidate in
 *                         the review queue, a duplicate, or skipped.
 *   NewsletterChallenge   "Challenge a friend": a student asks a classmate (same
 *                         class only) to take the edition's quiz. Only the two
 *                         of them see the result; nothing is shared outside.
 */
export const FEED_KINDS = ['GOOGLE_ALERT', 'RSS'];
export const FEED_ITEM_STATUSES = ['NEW', 'CANDIDATE', 'DUPLICATE', 'SKIPPED', 'FAILED'];

const sourceSchema = new Schema(
  {
    kind: { type: String, enum: FEED_KINDS, default: 'GOOGLE_ALERT' },
    title: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    // The words the alert watches, as the editor typed them into Google Alerts (for reference only).
    query: { type: String, default: null },
    tags: {
      domains: [{ type: String, enum: OPP_DOMAINS }],
      level: { type: String, enum: [...OPP_LEVELS, null], default: null },
      region: { type: String, default: null },
      types: [{ type: String, enum: OPP_TYPES }],
    },
    status: { type: String, enum: ['APPROVED', 'PAUSED'], default: 'APPROVED' },
    addedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    addedByName: { type: String, default: null },
    // Seed rows carry a fictional address and are never fetched.
    sample: { type: Boolean, default: false },
    lastFetchedAt: { type: Date, default: null },
    lastStatus: { type: String, enum: ['NEVER', 'OK', 'FAILED'], default: 'NEVER' },
    lastError: { type: String, default: null },
    lastItemCount: { type: Number, default: 0 },
    // Consecutive failures; the next attempt waits 1h, 2h, 4h ... up to a day.
    failures: { type: Number, default: 0 },
    nextFetchAt: { type: Date, default: null },
    itemsFound: { type: Number, default: 0 },
  },
  { timestamps: true },
);
sourceSchema.index({ tenantId: 1, url: 1 }, { unique: true });

const itemSchema = new Schema(
  {
    sourceId: { type: Schema.Types.ObjectId, ref: 'NewsletterFeedSource', required: true },
    sourceTitle: { type: String, default: null },
    sourceKind: { type: String, enum: FEED_KINDS, default: 'GOOGLE_ALERT' },
    // The real article address (a google.com/url?...&url=<target> wrapper is unwrapped).
    link: { type: String, required: true },
    rawLink: { type: String, default: null },
    title: { type: String, required: true },
    snippet: { type: String, default: '' },
    publishedAt: { type: Date, default: null },
    fetchedAt: { type: Date, default: Date.now },
    status: { type: String, enum: FEED_ITEM_STATUSES, default: 'NEW' },
    duplicateOfId: { type: Schema.Types.ObjectId, ref: 'Opportunity', default: null },
    opportunityId: { type: Schema.Types.ObjectId, ref: 'Opportunity', default: null },
    attempts: { type: Number, default: 0 },
    note: { type: String, default: null },
    processedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
itemSchema.index({ tenantId: 1, link: 1 }, { unique: true });
itemSchema.index({ status: 1, fetchedAt: 1 });
itemSchema.index({ sourceId: 1, status: 1 });

const challengeSchema = new Schema(
  {
    editionId: { type: Schema.Types.ObjectId, ref: 'NewsletterEdition', required: true },
    fromProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    fromStudentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    toStudentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    toProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', required: true },
  },
  { timestamps: true },
);
challengeSchema.index({ tenantId: 1, editionId: 1, fromProfileId: 1, toStudentId: 1 }, { unique: true });
challengeSchema.index({ toProfileId: 1, editionId: 1 });

for (const s of [sourceSchema, itemSchema, challengeSchema]) s.plugin(tenantScoped);

export const NewsletterFeedSource = model('NewsletterFeedSource', sourceSchema);
export const NewsletterFeedItem = model('NewsletterFeedItem', itemSchema);
export const NewsletterChallenge = model('NewsletterChallenge', challengeSchema);
