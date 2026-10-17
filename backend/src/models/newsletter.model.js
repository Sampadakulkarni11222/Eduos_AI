import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry } from '../modules/ops/common.js';

/**
 * Opportunities and the weekly / monthly newsletter (part 4), built on the
 * daily digest's approved feeds.
 *
 *   Opportunity          a structured competition, olympiad, scholarship, exam,
 *                        hackathon, fair, research programme... with its level,
 *                        eligibility, domains, dates (confirmed or "check on the
 *                        official site"), official https link and how to apply.
 *                        Nothing reaches readers until an editor publishes it.
 *   NewsletterSetting    the school's allowlist of official link domains.
 *   NewsletterReader     one person's newsletter choices: weekly / monthly,
 *                        email copy, domains, stream, leaderboard opt-in,
 *                        language, text size, unsubscribe token, streak.
 *   OpportunitySave      "Save" / "Remind me" (a parent saves for a child).
 *   OpportunityQuestion  "Ask a teacher" about an opportunity.
 *   NewsletterEdition    one weekly or monthly edition (one per period): hook,
 *                        items, flashcards, quiz, poll, school spotlight.
 *   NewsletterRead       a reader's progress, clicks, quiz answers and poll vote.
 *   FlashcardReview      spaced repetition (Leitner boxes) across editions.
 *   NewsletterComment    short comments, moderated (students' always by staff).
 *   NewsletterReaction   one reaction per reader per item.
 */
export const OPP_TYPES = [
  'COMPETITION', 'OLYMPIAD', 'SCHOLARSHIP', 'ENTRANCE_EXAM', 'HACKATHON', 'SCIENCE_FAIR', 'RESEARCH_PROGRAMME',
  'INNOVATION_CHALLENGE', 'SPORTS_TRIAL', 'ARTS_CONTEST', 'MUN_DEBATE', 'GOVT_SCHEME', 'TEACHER_PROGRAMME',
];
export const OPP_LEVELS = ['SCHOOL', 'DISTRICT', 'STATE', 'NATIONAL', 'INTERNATIONAL'];
export const OPP_DOMAINS = ['SCIENCE', 'MATHS', 'CODING_AI', 'ROBOTICS', 'ENVIRONMENT', 'ARTS', 'SPORTS', 'COMMERCE', 'HUMANITIES', 'ENTREPRENEURSHIP'];
export const OPP_STREAMS = ['SCIENCE', 'COMMERCE', 'HUMANITIES'];
export const OPP_MODES = ['ONLINE', 'OFFLINE', 'HYBRID'];
export const OPP_AUDIENCES = ['STUDENTS', 'TEACHERS', 'BOTH'];
export const OPP_STATUSES = ['SUBMITTED', 'PUBLISHED', 'REJECTED', 'ARCHIVED'];
export const OPP_SOURCES = ['CATALOGUE', 'FEED', 'STAFF'];
export const REACTIONS = ['USEFUL', 'INSPIRING', 'ENTERING', 'CURIOUS'];

const opportunitySchema = new Schema(
  {
    // A stable key for catalogue entries, so re-seeding updates rather than duplicates.
    catalogueKey: { type: String, default: null },
    title: { type: String, required: true, trim: true },
    summary: { type: String, default: '' },
    type: { type: String, enum: OPP_TYPES, required: true },
    level: { type: String, enum: OPP_LEVELS, required: true },
    audience: { type: String, enum: OPP_AUDIENCES, default: 'STUDENTS' },
    domains: [{ type: String, enum: OPP_DOMAINS }],
    eligibility: {
      gradeMin: { type: Number, default: null, min: 1, max: 16 },
      gradeMax: { type: Number, default: null, min: 1, max: 16 },
      ageMin: { type: Number, default: null, min: 3, max: 30 },
      ageMax: { type: Number, default: null, min: 3, max: 30 },
      streams: [{ type: String, enum: OPP_STREAMS }],
      note: { type: String, default: null },
    },
    // Teacher programmes: the subjects they suit (free text, matched loosely).
    teacherSubjects: [{ type: String }],
    registrationOpens: { type: Date, default: null },
    registrationCloses: { type: Date, default: null },
    eventDate: { type: Date, default: null },
    // Dates are shown as confirmed only when someone checked them on the official site.
    datesConfirmed: { type: Boolean, default: false },
    datesCheckedByName: { type: String, default: null },
    datesCheckedAt: { type: Date, default: null },
    // "Usually opens in July" — the honest wording for an unconfirmed cycle.
    typicalWindow: { type: String, default: null },
    typicalMonths: [{ type: Number, min: 1, max: 12 }],
    fee: { type: String, default: null },
    mode: { type: String, enum: OPP_MODES, default: 'ONLINE' },
    officialUrl: { type: String, default: null },
    organiser: { type: String, default: null },
    // For "this month's map": a state for state-level items, otherwise all-India / international.
    region: { type: String, default: null },
    howToApply: [{ type: String }],
    pastWinnerNotes: { type: String, default: null },
    // A domain fact or two, used for the edition's flashcards.
    facts: [{ _id: false, front: String, back: String }],
    source: {
      kind: { type: String, enum: OPP_SOURCES, default: 'STAFF' },
      digestItemId: { type: Schema.Types.ObjectId, ref: 'DigestItem', default: null },
      sourceTitle: { type: String, default: null },
    },
    status: { type: String, enum: OPP_STATUSES, default: 'SUBMITTED' },
    submittedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    submittedByName: { type: String, default: null },
    reviewedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    reviewedByName: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: null },
    publishedAt: { type: Date, default: null },
    clicks: { type: Number, default: 0 },
    history: [historyEntry],
  },
  { timestamps: true },
);
opportunitySchema.index({ tenantId: 1, catalogueKey: 1 }, { unique: true, partialFilterExpression: { catalogueKey: { $type: 'string' } } });
opportunitySchema.index({ tenantId: 1, 'source.digestItemId': 1 }, { unique: true, partialFilterExpression: { 'source.digestItemId': { $type: 'objectId' } } });
opportunitySchema.index({ status: 1, registrationCloses: 1 });

const settingSchema = new Schema(
  {
    key: { type: String, default: 'default' },
    allowedDomains: [{ type: String }],
    updatedByName: { type: String, default: null },
  },
  { timestamps: true },
);
settingSchema.index({ tenantId: 1, key: 1 }, { unique: true });

const readerSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    weekly: { type: Boolean, default: true },
    monthly: { type: Boolean, default: true },
    // Email copy: off until the person turns it on (parents and staff only).
    email: { type: Boolean, default: false },
    domains: [{ type: String, enum: OPP_DOMAINS }],
    stream: { type: String, enum: [...OPP_STREAMS, null], default: null },
    cpdInterests: [{ type: String }],
    leaderboardOptIn: { type: Boolean, default: false },
    language: { type: String, enum: ['en', 'hi'], default: 'en' },
    textSize: { type: String, enum: ['S', 'M', 'L'], default: 'M' },
    unsubscribeToken: { type: String, required: true },
    unsubscribedAt: { type: Date, default: null },
    streak: { count: { type: Number, default: 0 }, best: { type: Number, default: 0 }, lastDay: { type: String, default: null } },
  },
  { timestamps: true },
);
readerSchema.index({ tenantId: 1, profileId: 1 }, { unique: true });
readerSchema.index({ unsubscribeToken: 1 }, { unique: true });

const saveSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    opportunityId: { type: Schema.Types.ObjectId, ref: 'Opportunity', required: true },
    // A parent saving for one of their children; null for a student's or teacher's own save.
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    remind: { type: Boolean, default: false },
    remindersSent: [{ _id: false, lead: Number, at: Date }],
    note: { type: String, default: null },
  },
  { timestamps: true },
);
saveSchema.index({ tenantId: 1, profileId: 1, opportunityId: 1, studentId: 1 }, { unique: true });

const questionSchema = new Schema(
  {
    opportunityId: { type: Schema.Types.ObjectId, ref: 'Opportunity', required: true },
    askerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    askerRole: { type: String, default: null },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', default: null },
    text: { type: String, required: true },
    toProfileIds: [{ type: Schema.Types.ObjectId, ref: 'Profile' }],
    answer: { type: String, default: null },
    answeredByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    answeredByName: { type: String, default: null },
    answeredAt: { type: Date, default: null },
    status: { type: String, enum: ['OPEN', 'ANSWERED'], default: 'OPEN' },
  },
  { timestamps: true },
);
questionSchema.index({ toProfileIds: 1, status: 1 });

const editionSchema = new Schema(
  {
    cadence: { type: String, enum: ['WEEKLY', 'MONTHLY'], required: true },
    periodKey: { type: String, required: true }, // 2026-W42 or 2026-10
    title: { type: String, required: true },
    periodLabel: { type: String, default: null },
    hook: {
      text: { type: String, default: '' },
      question: { type: String, default: null },
      textHi: { type: String, default: null },
    },
    intro: { type: String, default: null },
    opportunityIds: [{ type: Schema.Types.ObjectId, ref: 'Opportunity' }],
    flashcards: [{ _id: false, key: String, front: String, back: String, domain: String, opportunityId: { type: Schema.Types.ObjectId, default: null } }],
    quiz: [{ _id: false, key: String, question: String, options: [String], answerIndex: Number, explain: String }],
    poll: {
      question: { type: String, default: null },
      options: [{ _id: false, key: String, label: String }],
    },
    // Our students' wins, from the published (consented) showcase; consent is re-checked at every read.
    spotlightEntryIds: [{ type: Schema.Types.ObjectId, ref: 'ShowcaseEntry' }],
    status: { type: String, enum: ['DRAFT', 'PUBLISHED', 'WITHDRAWN'], default: 'DRAFT' },
    generatedBy: { type: String, enum: ['SCHEDULER', 'EDITOR', 'ASSISTANT', 'SEED'], default: 'SCHEDULER' },
    publishedAt: { type: Date, default: null },
    publishedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    publishedByName: { type: String, default: null },
    delivery: {
      inApp: { type: Number, default: 0 },
      emailQueued: { type: Number, default: 0 },
      byStatus: { type: Schema.Types.Mixed, default: {} },
    },
    history: [historyEntry],
  },
  { timestamps: true },
);
editionSchema.index({ tenantId: 1, cadence: 1, periodKey: 1 }, { unique: true });
editionSchema.index({ status: 1, publishedAt: -1 });

const readSchema = new Schema(
  {
    editionId: { type: Schema.Types.ObjectId, ref: 'NewsletterEdition', required: true },
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    roleKey: { type: String, default: null },
    openedAt: { type: Date, default: Date.now },
    lastSection: { type: String, default: null },
    progressPct: { type: Number, default: 0, min: 0, max: 100 },
    completedAt: { type: Date, default: null },
    clicks: [{ _id: false, opportunityId: Schema.Types.ObjectId, at: Date }],
    quiz: {
      answers: [Number],
      score: { type: Number, default: null },
      at: { type: Date, default: null },
      // Group for the class / house board (students who opted in only).
      sectionLabel: { type: String, default: null },
      houseName: { type: String, default: null },
      onBoard: { type: Boolean, default: false },
    },
    pollChoice: { type: String, default: null },
  },
  { timestamps: true },
);
readSchema.index({ tenantId: 1, editionId: 1, profileId: 1 }, { unique: true });

const reviewSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    cardKey: { type: String, required: true }, // <editionId>:<card key>
    editionId: { type: Schema.Types.ObjectId, ref: 'NewsletterEdition', required: true },
    box: { type: Number, default: 1, min: 1, max: 5 },
    dueAt: { type: Date, required: true },
    lastResult: { type: String, enum: ['KNEW', 'REVIEW'], required: true },
    reviews: { type: Number, default: 1 },
  },
  { timestamps: true },
);
reviewSchema.index({ tenantId: 1, profileId: 1, cardKey: 1 }, { unique: true });
reviewSchema.index({ profileId: 1, dueAt: 1 });

const commentSchema = new Schema(
  {
    editionId: { type: Schema.Types.ObjectId, ref: 'NewsletterEdition', required: true },
    opportunityId: { type: Schema.Types.ObjectId, ref: 'Opportunity', default: null },
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    authorRole: { type: String, default: null },
    // What other readers see: staff by name; a student as "A student in Class 9"; a parent as "A parent".
    displayName: { type: String, required: true },
    text: { type: String, required: true },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    moderatedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    moderatedByName: { type: String, default: null },
    moderatedAt: { type: Date, default: null },
    rejectReason: { type: String, default: null },
  },
  { timestamps: true },
);
commentSchema.index({ editionId: 1, status: 1, createdAt: -1 });

const reactionSchema = new Schema(
  {
    editionId: { type: Schema.Types.ObjectId, ref: 'NewsletterEdition', required: true },
    target: { type: String, required: true }, // 'hook' or an opportunity id
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    kind: { type: String, enum: REACTIONS, required: true },
  },
  { timestamps: true },
);
reactionSchema.index({ tenantId: 1, editionId: 1, target: 1, profileId: 1 }, { unique: true });

for (const s of [opportunitySchema, settingSchema, readerSchema, saveSchema, questionSchema, editionSchema, readSchema, reviewSchema, commentSchema, reactionSchema]) s.plugin(tenantScoped);

export const Opportunity = model('Opportunity', opportunitySchema);
export const NewsletterSetting = model('NewsletterSetting', settingSchema);
export const NewsletterReader = model('NewsletterReader', readerSchema);
export const OpportunitySave = model('OpportunitySave', saveSchema);
export const OpportunityQuestion = model('OpportunityQuestion', questionSchema);
export const NewsletterEdition = model('NewsletterEdition', editionSchema);
export const NewsletterRead = model('NewsletterRead', readSchema);
export const FlashcardReview = model('FlashcardReview', reviewSchema);
export const NewsletterComment = model('NewsletterComment', commentSchema);
export const NewsletterReaction = model('NewsletterReaction', reactionSchema);
