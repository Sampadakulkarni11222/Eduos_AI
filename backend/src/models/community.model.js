import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry } from '../modules/ops/common.js';

/**
 * Newsroom and community: stories, galleries, circles, mentoring and the
 * consent that governs whether a student may appear in published media.
 */

export const AUDIENCES = ['PUBLIC', 'INSTITUTION', 'CAMPUS', 'ROLE', 'CLASS', 'CIRCLE'];

const mediaSchema = new Schema(
  {
    url: { type: String, required: true },
    kind: { type: String, enum: ['IMAGE', 'VIDEO', 'DOCUMENT'], default: 'IMAGE' },
    caption: { type: String, default: null },
    altText: { type: String, default: null },
    // Students identifiable in this item; their consent decides where it can be shown.
    studentIds: [{ type: Schema.Types.ObjectId, ref: 'Student' }],
    // Set when the uploader confirms location/EXIF metadata was stripped.
    metadataStripped: { type: Boolean, default: false },
    // The uploader's explicit statement that no student can be identified in
    // this item. Every image needs either this or tagged students.
    noIdentifiableStudents: { type: Boolean, default: false },
    // Hidden while a consent report on the post is reviewed. Moderators still see it.
    hidden: { type: Boolean, default: false },
  },
  { _id: true }
);

const reactionCountsSchema = new Schema(
  { CLAP: { type: Number, default: 0 }, HEART: { type: Number, default: 0 }, CELEBRATE: { type: Number, default: 0 }, INSPIRED: { type: Number, default: 0 } },
  { _id: false }
);

const postSchema = new Schema(
  {
    kind: { type: String, enum: ['STORY', 'EVENT_HIGHLIGHT', 'ACHIEVEMENT', 'CEREMONY', 'GALLERY', 'CLUB_UPDATE', 'ALUMNI_STORY', 'CIRCLE_POST'], required: true },
    title: { type: String, default: null, trim: true },
    body: { type: String, required: true },
    media: [mediaSchema],
    tags: [{ type: String }],
    audience: { type: String, enum: AUDIENCES, required: true },
    // CAMPUS: campus code; ROLE: role keys; CLASS: section ids; CIRCLE: circle id.
    audienceRef: { type: Schema.Types.Mixed, default: null },
    circleId: { type: Schema.Types.ObjectId, ref: 'Circle', default: null },
    eventId: { type: Schema.Types.ObjectId, ref: 'InstitutionEvent', default: null },
    authorProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    authorName: { type: String, default: null },
    authorRole: { type: String, default: null },
    status: { type: String, enum: ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'ARCHIVED', 'TAKEN_DOWN', 'WITHDRAWN'], default: 'DRAFT' },
    moderation: {
      byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      at: { type: Date, default: null },
      note: { type: String, default: null },
    },
    publishedAt: { type: Date, default: null },
    commentsEnabled: { type: Boolean, default: true },
    // Who may comment and whether comments wait for a moderator. OFF closes
    // comments; STAFF_ONLY lets only staff reply; PRE_MODERATED holds every
    // comment that is not a moderator's; OPEN still holds students' comments
    // and adults' comments where students are in the audience.
    commentPolicy: { type: String, enum: ['OFF', 'STAFF_ONLY', 'PRE_MODERATED', 'OPEN'], default: 'OPEN' },
    pinned: { type: Boolean, default: false },
    reactions: [{ profileId: { type: Schema.Types.ObjectId, ref: 'Profile' }, type: { type: String, enum: ['CLAP', 'HEART', 'CELEBRATE', 'INSPIRED'] } }],
    bookmarks: [{ type: Schema.Types.ObjectId, ref: 'Profile' }],
    // Kept in step with `reactions` by atomic $inc, so feeds never ship the array.
    // Absent on posts written before the counters existed; those are counted once from the array.
    reactionCounts: { type: reactionCountsSchema, default: () => ({}) },
    history: [historyEntry],
  },
  { timestamps: true }
);
postSchema.index({ status: 1, audience: 1, publishedAt: -1 });
postSchema.index({ circleId: 1, publishedAt: -1 });
postSchema.index({ title: 'text', body: 'text', tags: 'text' });

const commentSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, ref: 'CommunityPost', required: true },
    authorProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    authorName: { type: String, default: null },
    body: { type: String, required: true },
    authorRole: { type: String, default: null },
    status: { type: String, enum: ['VISIBLE', 'PENDING', 'HIDDEN', 'DELETED'], default: 'VISIBLE' },
    hiddenReason: { type: String, default: null },
    editedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
commentSchema.index({ postId: 1, createdAt: 1 });

const circleSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['CLASS', 'PROGRAMME', 'CLUB', 'PROJECT', 'INTEREST', 'CAREER', 'ALUMNI', 'PARENTS'], required: true },
    description: { type: String, default: null },
    joinPolicy: { type: String, enum: ['OPEN', 'APPROVAL', 'INVITE'], default: 'APPROVAL' },
    // Age/role rules: school circles default to students + staff moderators;
    // adults-only circles (alumni, parents) refuse student members.
    allowedRoles: [{ type: String }],
    adultsOnly: { type: Boolean, default: false },
    // A school circle that may include invited outside adults (alumni, parents).
    // They join only by a staff member's invitation, never by themselves.
    adultsWelcome: { type: Boolean, default: false },
    moderatorProfileIds: [{ type: Schema.Types.ObjectId, ref: 'Profile' }],
    members: [{
      profileId: { type: Schema.Types.ObjectId, ref: 'Profile' },
      name: String,
      roleKey: String,
      status: { type: String, enum: ['ACTIVE', 'PENDING', 'REMOVED', 'BLOCKED', 'LEFT'], default: 'ACTIVE' },
      joinedAt: { type: Date, default: Date.now },
    }],
    archived: { type: Boolean, default: false },
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
  },
  { timestamps: true }
);
circleSchema.index({ 'members.profileId': 1 });

/**
 * Consent for a student's image in institution media, given by the parent
 * (or the student if an adult). NONE by default: absence of a record means no
 * consent. INTERNAL = signed-in community only; PUBLIC = also public pages.
 */
const mediaConsentSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    level: { type: String, enum: ['NONE', 'INTERNAL', 'PUBLIC'], required: true },
    grantedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    grantedByRole: { type: String, default: null },
    // Staff recording a paper form cite it (reference and, optionally, the scanned file).
    evidence: { type: String, default: null },
    evidenceFileUrl: { type: String, default: null },
    at: { type: Date, default: Date.now },
    withdrawnAt: { type: Date, default: null },
  },
  { timestamps: true }
);
mediaConsentSchema.index({ studentId: 1, withdrawnAt: 1 });

const mentorProfileSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    name: String,
    kind: { type: String, enum: ['ALUMNUS', 'SENIOR_STUDENT', 'STAFF'], required: true },
    // Affiliation is checked by staff (batch, programme) before the profile is listed.
    verifiedAffiliation: { type: Boolean, default: false },
    verifiedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    batch: { type: String, default: null },
    headline: { type: String, default: null },
    topics: [{ type: String }],
    availability: { type: String, default: null },
    optedIn: { type: Boolean, default: true },
    adult: { type: Boolean, default: true },
  },
  { timestamps: true }
);
mentorProfileSchema.index({ tenantId: 1, profileId: 1 }, { unique: true });

const mentorshipRequestSchema = new Schema(
  {
    mentorProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    menteeProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    topic: { type: String, required: true },
    message: { type: String, default: null },
    // Minors are mentored only in supervised sessions: no private messaging.
    supervised: { type: Boolean, default: true },
    supervisorProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    status: { type: String, enum: ['REQUESTED', 'ACCEPTED', 'DECLINED', 'SCHEDULED', 'COMPLETED', 'CANCELLED'], default: 'REQUESTED' },
    sessions: [{ at: Date, mode: String, link: String, feedback: String, rating: Number }],
    // Feedback given when the mentoring is closed, separate from any one session.
    feedback: { type: String, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);

mentorshipRequestSchema.index({ mentorProfileId: 1, menteeProfileId: 1, status: 1 });

const reportSchema = new Schema(
  {
    targetType: { type: String, enum: ['POST', 'COMMENT', 'CIRCLE', 'MENTOR'], required: true },
    targetId: { type: String, required: true },
    reason: { type: String, enum: ['INAPPROPRIATE', 'BULLYING', 'PRIVACY', 'CONSENT', 'SPAM', 'OTHER'], required: true },
    detail: { type: String, default: null },
    reporterProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    status: { type: String, enum: ['OPEN', 'ACTIONED', 'DISMISSED', 'ESCALATED'], default: 'OPEN' },
    // True when this report hid the post's media while it is reviewed.
    hidMedia: { type: Boolean, default: false },
    resolution: { type: String, default: null },
    resolvedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true }
);

reportSchema.index({ targetType: 1, targetId: 1, status: 1 });
reportSchema.index({ reporterProfileId: 1, createdAt: -1 });

for (const s of [postSchema, commentSchema, circleSchema, mediaConsentSchema, mentorProfileSchema, mentorshipRequestSchema, reportSchema]) s.plugin(tenantScoped);
export const CommunityPost = model('CommunityPost', postSchema);
export const CommunityComment = model('CommunityComment', commentSchema);
export const Circle = model('Circle', circleSchema);
export const MediaConsent = model('MediaConsent', mediaConsentSchema);
export const MentorProfile = model('MentorProfile', mentorProfileSchema);
export const MentorshipRequest = model('MentorshipRequest', mentorshipRequestSchema);
export const CommunityReport = model('CommunityReport', reportSchema);
