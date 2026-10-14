import mongoose from 'mongoose';
import { CommunityPost, CommunityComment, Circle, MediaConsent, MentorProfile, MentorshipRequest, CommunityReport, AUDIENCES } from '../../models/community.model.js';
import { InstitutionEvent } from '../../models/administration.model.js';
import { InstitutionProfile } from '../../models/institution.model.js';
import { Enrollment, Student } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { getGuardianStudentIds, getOwnStudentId, getTeacherSectionIds } from '../../utils/scope.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { notify } from '../notifications/notification.service.js';
import {
  requireProfile, assertObjectId, assertTransition, pushHistory, requireText, optionalText, oneOf, dto, pageArgs, parseDate,
  profilesWithRoles, profileNames, escapeRegex,
} from '../ops/common.js';

/**
 * Newsroom and community.
 *
 * "Accessible by everyone" means each post has an explicit audience — public,
 * the whole institution, a role, a class or a circle — and every read path
 * (feed, search, single post, the public page) applies the same check. A
 * student's image appears only where their consent level allows; withdrawing
 * consent hides it immediately, even in posts already published.
 *
 * Moderation: students' posts and comments wait for a moderator; staff with
 * community.moderate (and a circle's own moderators, inside that circle)
 * publish directly. Outside adults' comments wait too wherever students can
 * read them. A report is reviewed by a person; an automated flag never removes
 * anything by itself.
 */

const STAFF = new Set(['PRINCIPAL', 'ADMIN', 'TEACHER', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'LIBRARIAN', 'WARDEN', 'SUPER_ADMIN']);
const isStaff = (roleKey) => STAFF.has(roleKey);
/** Adults from outside the school's staff: parents, alumni, trustees. */
const isOutsideAdult = (roleKey) => Boolean(roleKey) && !STAFF.has(roleKey) && roleKey !== 'STUDENT';
const isModerator = (actor) => Boolean(actor?.permissions?.['community.moderate']);

const POST_KINDS = ['STORY', 'EVENT_HIGHLIGHT', 'ACHIEVEMENT', 'CEREMONY', 'GALLERY', 'CLUB_UPDATE', 'ALUMNI_STORY', 'CIRCLE_POST'];
const REACTION_TYPES = ['CLAP', 'HEART', 'CELEBRATE', 'INSPIRED'];
const COMMENT_POLICIES = ['OFF', 'STAFF_ONLY', 'PRE_MODERATED', 'OPEN'];
const CIRCLE_KINDS = ['CLASS', 'PROGRAMME', 'CLUB', 'PROJECT', 'INTEREST', 'CAREER', 'ALUMNI', 'PARENTS'];
const REPORT_REASONS = ['INAPPROPRIATE', 'BULLYING', 'PRIVACY', 'CONSENT', 'SPAM', 'OTHER'];
// Reports a safeguarding officer must see as well as the principal.
const SAFEGUARDING_REASONS = new Set(['CONSENT', 'PRIVACY', 'BULLYING']);
// Roles told that a post waits for review: people who can actually moderate.
const REVIEWER_ROLES = ['PRINCIPAL', 'ADMIN'];
const OPEN_REPORT = ['OPEN', 'ESCALATED'];
export const REPORTS_PER_HOUR = 10;
const MAX_FEED_PAGE = 50;

/** What the viewer belongs to, for audience checks. Computed once per request. */
export async function viewerContext(actor) {
  if (!actor?.profileId) return { anonymous: true, sections: new Set(), circles: new Set(), modCircles: new Set() };
  let sections = [];
  if (actor.roleKey === 'TEACHER') sections = await getTeacherSectionIds(actor.profileId);
  if (actor.roleKey === 'STUDENT' || actor.roleKey === 'PARENT') {
    const studentIds = actor.roleKey === 'STUDENT' ? [await getOwnStudentId(actor.profileId)].filter(Boolean) : await getGuardianStudentIds(actor.profileId);
    const ens = await Enrollment.find({ studentId: { $in: studentIds }, status: 'ACTIVE' }).select('sectionId').lean();
    sections = ens.map((e) => String(e.sectionId));
  }
  const circles = await Circle.find({ $or: [{ members: { $elemMatch: { profileId: actor.profileId, status: 'ACTIVE' } } }, { moderatorProfileIds: actor.profileId }] }).select('_id moderatorProfileIds').lean();
  const me = String(actor.profileId);
  return {
    anonymous: false, roleKey: actor.roleKey, profileId: me, moderator: isModerator(actor),
    sections: new Set(sections.map(String)),
    circles: new Set(circles.map((c) => String(c._id))),
    // Circles this person moderates: they review what is posted there.
    modCircles: new Set(circles.filter((c) => (c.moderatorProfileIds ?? []).some((m) => String(m) === me)).map((c) => String(c._id))),
  };
}

const isCircleModerator = (post, ctx) => Boolean(post?.circleId) && Boolean(ctx?.modCircles?.has(String(post.circleId)));
/** May this viewer review (publish, reject, see held media of) this post? */
const reviews = (post, ctx) => !ctx.anonymous && (ctx.moderator || isCircleModerator(post, ctx));

export function canView(post, ctx) {
  if (ctx.anonymous) return post.status === 'PUBLISHED' && post.audience === 'PUBLIC';
  const mine = Boolean(post.authorProfileId) && String(post.authorProfileId) === ctx.profileId;
  if (post.status !== 'PUBLISHED') {
    if (mine) return true;
    // A draft is the author's alone; anything submitted is visible to its reviewers.
    if (post.status === 'DRAFT') return false;
    return reviews(post, ctx);
  }
  if (post.audience === 'PUBLIC') return true;
  if (ctx.moderator) return true;
  switch (post.audience) {
    case 'INSTITUTION': case 'CAMPUS': return true;
    case 'ROLE': return Array.isArray(post.audienceRef) && post.audienceRef.includes(ctx.roleKey);
    case 'CLASS': return Array.isArray(post.audienceRef) && post.audienceRef.some((s) => ctx.sections.has(String(s)));
    case 'CIRCLE': return ctx.circles.has(String(post.circleId));
    default: return false;
  }
}

/** The audience filter as a query, so feeds never load what they cannot show. */
function audienceQuery(ctx) {
  if (ctx.anonymous) return { status: 'PUBLISHED', audience: 'PUBLIC' };
  if (ctx.moderator) return { $or: [{ status: { $ne: 'DRAFT' } }, { authorProfileId: ctx.profileId }] };
  const or = [
    { status: 'PUBLISHED', audience: { $in: ['PUBLIC', 'INSTITUTION', 'CAMPUS'] } },
    { status: 'PUBLISHED', audience: 'ROLE', audienceRef: ctx.roleKey },
    { status: 'PUBLISHED', audience: 'CLASS', audienceRef: { $in: [...ctx.sections] } },
    { status: 'PUBLISHED', audience: 'CIRCLE', circleId: { $in: [...ctx.circles] } },
    { authorProfileId: ctx.profileId },
  ];
  if (ctx.modCircles.size) or.push({ circleId: { $in: [...ctx.modCircles] }, status: { $ne: 'DRAFT' } });
  return { $or: or };
}

async function consentLevels(studentIds) {
  const rows = await MediaConsent.find({ studentId: { $in: studentIds }, withdrawnAt: null }).sort({ at: -1 }).lean();
  const level = new Map();
  for (const r of rows) if (!level.has(String(r.studentId))) level.set(String(r.studentId), r.level);
  return level;
}

const needs = (audience) => (audience === 'PUBLIC' ? 'PUBLIC' : 'INTERNAL');
const allows = (have, need) => have === 'PUBLIC' || (have === 'INTERNAL' && need === 'INTERNAL');
const policyOf = (p) => p.commentPolicy ?? (p.commentsEnabled === false ? 'OFF' : 'OPEN');

function countReactions(list) {
  const counts = {};
  for (const r of list ?? []) counts[r.type] = (counts[r.type] ?? 0) + 1;
  return counts;
}

/** Presents posts with media filtered by current consent, counts and the viewer's own flags. */
async function present(posts, ctx) {
  const studentIds = [...new Set(posts.flatMap((p) => (p.media ?? []).flatMap((m) => (m.studentIds ?? []).map(String))))];
  const levels = await consentLevels(studentIds);
  return posts.map((p) => {
    // Consent is about who sees the image: the public, or the signed-in community.
    const need = ctx.anonymous ? 'PUBLIC' : 'INTERNAL';
    // Media held for a consent report stays visible to the people deciding it.
    const reviewer = reviews(p, ctx);
    const all = p.media ?? [];
    const media = all.filter((m) => (!m.hidden || reviewer) && (m.studentIds ?? []).every((s) => allows(levels.get(String(s)), need)))
      .map((m) => ({
        id: String(m._id), url: m.url, kind: m.kind, caption: m.caption, altText: m.altText,
        ...(m.hidden ? { hidden: true } : {}),
        ...(reviewer ? { studentCount: (m.studentIds ?? []).length, noIdentifiableStudents: Boolean(m.noIdentifiableStudents) } : {}),
      }));
    const raw = p.reactionCounts ?? countReactions(p.reactions);
    const reactions = Object.fromEntries(REACTION_TYPES.filter((t) => raw[t] > 0).map((t) => [t, raw[t]]));
    const policy = policyOf(p);
    const mine = ctx.profileId ? String(p.authorProfileId) === ctx.profileId : false;
    return {
      id: String(p._id), kind: p.kind, title: p.title, body: p.body, tags: p.tags, audience: p.audience,
      circleId: p.circleId ? String(p.circleId) : null, eventId: p.eventId ? String(p.eventId) : null,
      authorName: p.authorName, authorRole: p.authorRole, status: p.status, publishedAt: p.publishedAt, pinned: p.pinned,
      commentsEnabled: policy !== 'OFF', commentPolicy: policy,
      canComment: !ctx.anonymous && p.status === 'PUBLISHED' && policy !== 'OFF' && (policy !== 'STAFF_ONLY' || isStaff(ctx.roleKey)),
      canModerate: reviewer,
      media, mediaWithheld: all.length - media.length,
      reactions,
      myReaction: ctx.profileId ? (p._myReaction !== undefined ? p._myReaction : (p.reactions ?? []).find((r) => String(r.profileId) === ctx.profileId)?.type ?? null) : null,
      bookmarked: ctx.profileId ? (p._bookmarked !== undefined ? p._bookmarked : (p.bookmarks ?? []).some((b) => String(b) === ctx.profileId)) : false,
      ...(p._commentCount !== undefined ? { commentCount: p._commentCount } : {}),
      isMine: mine,
      moderationNote: mine || reviewer ? p.moderation?.note ?? null : undefined,
      // The author's own audience details, so an edit can show what was chosen.
      ...(mine ? { audienceRef: p.audienceRef ?? null } : {}),
    };
  });
}

/**
 * Fetches, for a page of trimmed rows, what the full arrays used to carry: the
 * viewer's own reaction and bookmark, visible comment counts, and the counts of
 * posts written before the counters existed.
 */
async function decorate(rows, ctx) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r._id);
  const legacy = rows.filter((r) => !r.reactionCounts).map((r) => r._id);
  const [mine, saved, old, comments] = await Promise.all([
    ctx.profileId ? CommunityPost.find({ _id: { $in: ids }, 'reactions.profileId': ctx.profileId }).select({ 'reactions.$': 1 }).lean() : [],
    ctx.profileId ? CommunityPost.find({ _id: { $in: ids }, bookmarks: ctx.profileId }).select('_id').lean() : [],
    legacy.length ? CommunityPost.find({ _id: { $in: legacy } }).select('reactions.type').lean() : [],
    CommunityComment.aggregate([{ $match: { postId: { $in: ids }, status: 'VISIBLE' } }, { $group: { _id: '$postId', n: { $sum: 1 } } }]),
  ]);
  const myType = new Map(mine.map((p) => [String(p._id), p.reactions?.[0]?.type ?? null]));
  const savedIds = new Set(saved.map((p) => String(p._id)));
  const legacyCounts = new Map(old.map((p) => [String(p._id), countReactions(p.reactions)]));
  const commentCounts = new Map(comments.map((c) => [String(c._id), c.n]));
  return rows.map((r) => ({
    ...r,
    reactionCounts: r.reactionCounts ?? legacyCounts.get(String(r._id)) ?? {},
    _myReaction: myType.get(String(r._id)) ?? null,
    _bookmarked: savedIds.has(String(r._id)),
    _commentCount: commentCounts.get(String(r._id)) ?? 0,
  }));
}

async function presentOne(post, ctx) {
  const plain = typeof post.toObject === 'function' ? post.toObject() : post;
  return (await present([plain], ctx))[0];
}

// ── Media ────────────────────────────────────────────────────────────────

/** Only files this platform stored, or an https link. Never javascript:, data: or http:. */
function safeMediaUrl(raw, label = 'media url') {
  const url = requireText(raw, label, { max: 1000 });
  if (/^\/uploads\/[A-Za-z0-9._\-/]+$/.test(url) && !url.includes('..')) return url;
  let parsed = null;
  try { parsed = new URL(url); } catch { parsed = null; }
  if (parsed && parsed.protocol === 'https:' && !parsed.username && !parsed.password) return parsed.toString();
  throw new AppError('Media must be a file uploaded here or an https:// link.', 400, [], 'MEDIA_URL_INVALID');
}

function cleanMedia(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 30).map((m) => {
    const studentIds = Array.isArray(m.studentIds) ? [...new Set(m.studentIds.map((s) => assertObjectId(s, 'studentIds')))].slice(0, 60) : [];
    return {
      url: safeMediaUrl(m.url),
      kind: oneOf(m.kind, ['IMAGE', 'VIDEO', 'DOCUMENT'], 'media kind', 'IMAGE'),
      caption: optionalText(m.caption, { max: 300 }) || null,
      altText: optionalText(m.altText, { max: 300 }) || null,
      studentIds,
      metadataStripped: m.metadataStripped === true,
      // Tagging students and saying nobody is identifiable contradict each other; the tags win.
      noIdentifiableStudents: !studentIds.length && m.noIdentifiableStudents === true,
    };
  });
}

/**
 * The rules every image meets before anyone else sees it: described (alt
 * text), location data removed, and either the pictured students tagged — so
 * their consent applies — or an explicit statement that nobody is
 * identifiable. Then tagged students must exist and have the consent the
 * audience needs.
 */
async function assertMediaRules(post) {
  const images = post.media.filter((m) => m.kind === 'IMAGE');
  if (images.some((m) => !m.altText)) throw new AppError('Add alt text to every image.', 400, [], 'ALT_TEXT_REQUIRED');
  if (images.some((m) => !m.metadataStripped)) throw new AppError('Confirm location metadata was removed from every photo.', 400, [], 'METADATA_NOT_STRIPPED');
  const visual = post.media.filter((m) => m.kind === 'IMAGE' || m.kind === 'VIDEO');
  if (visual.some((m) => !(m.studentIds ?? []).length && !m.noIdentifiableStudents)) {
    throw new AppError('For every photo or video, tag the pictured students or confirm that no student can be identified.', 400, [], 'PICTURED_STUDENTS_UNCONFIRMED');
  }
  const ids = [...new Set(post.media.flatMap((m) => (m.studentIds ?? []).map(String)))];
  if (!ids.length) return;
  const found = await Student.countDocuments({ _id: { $in: ids } });
  if (found !== ids.length) throw new AppError('A tagged student was not found.', 400, [], 'UNKNOWN_STUDENT');
  const need = needs(post.audience);
  const levels = await consentLevels(ids);
  const missing = ids.filter((s) => !allows(levels.get(s), need));
  if (missing.length) throw new AppError(`${missing.length} pictured student(s) do not have ${need.toLowerCase()} media consent. Remove those images or tag them correctly.`, 409, [], 'CONSENT_MISSING');
}

// ── Posts ────────────────────────────────────────────────────────────────

/** Validated post fields from a request body; on an edit, absent fields keep their value. */
async function postFields(actor, body, existing = null) {
  const has = (k) => !existing || body[k] !== undefined;
  const out = {};
  if (has('audience') || has('circleId') || has('audienceRef')) {
    const audience = oneOf(body.audience ?? existing?.audience, AUDIENCES, 'audience');
    if (['PUBLIC', 'ROLE', 'CAMPUS'].includes(audience) && !isStaff(actor.roleKey)) throw new AppError('Only staff can address that audience.', 403);
    let circleId = null;
    let audienceRef = null;
    if (audience === 'CIRCLE') {
      circleId = assertObjectId(body.circleId ?? existing?.circleId, 'circleId');
      const ctx = await viewerContext(actor);
      if (!ctx.circles.has(String(circleId))) throw new AppError('You are not a member of that circle.', 403);
    } else if (audience === 'ROLE') {
      const refs = Array.isArray(body.audienceRef ?? existing?.audienceRef) ? (body.audienceRef ?? existing.audienceRef) : [];
      audienceRef = [...new Set(refs.map((r) => String(r).toUpperCase()).filter((r) => /^[A-Z_]{2,30}$/.test(r)))].slice(0, 20);
      if (!audienceRef.length) throw new AppError('Choose at least one role.', 400);
    } else if (audience === 'CLASS') {
      const refs = Array.isArray(body.audienceRef ?? existing?.audienceRef) ? (body.audienceRef ?? existing.audienceRef) : [];
      audienceRef = [...new Set(refs.map((s) => assertObjectId(s, 'section')))].slice(0, 50);
      if (!audienceRef.length) throw new AppError('Choose at least one class.', 400);
      if (!isModerator(actor)) {
        const ctx = await viewerContext(actor);
        if (audienceRef.some((s) => !ctx.sections.has(s))) throw new AppError('You can only address your own classes.', 403);
      }
    }
    Object.assign(out, { audience, audienceRef, circleId });
  }
  if (has('kind')) out.kind = oneOf(body.kind, POST_KINDS, 'kind', (out.audience ?? existing?.audience) === 'CIRCLE' ? 'CIRCLE_POST' : 'STORY');
  if (has('title')) out.title = optionalText(body.title, { max: 200 }) || null;
  if (has('body')) out.body = requireText(body.body, 'body', { max: 20000 });
  if (has('tags')) out.tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).toLowerCase().slice(0, 30)).slice(0, 10) : [];
  if (has('media')) out.media = cleanMedia(body.media);
  if (has('commentPolicy') || has('commentsEnabled')) {
    const policy = oneOf(body.commentPolicy, COMMENT_POLICIES, 'commentPolicy', body.commentsEnabled === false ? 'OFF' : existing ? policyOf(existing) : 'OPEN');
    out.commentPolicy = policy;
    out.commentsEnabled = policy !== 'OFF';
  }
  return out;
}

export async function createPost(actor, body = {}, { _id } = {}) {
  requireProfile(actor);
  const fields = await postFields(actor, body);
  const post = new CommunityPost({
    ...(_id ? { _id } : {}),
    ...fields,
    eventId: body.eventId ? assertObjectId(body.eventId, 'eventId') : null,
    authorProfileId: actor.profileId, authorName: actor.displayName, authorRole: actor.roleKey,
  });
  pushHistory(post, actor, 'DRAFTED');
  if (body.submit === true) await submitInto(post, actor);
  await post.save();
  return presentOne(post, await viewerContext(actor));
}

/** Who reviews a post: the circle's moderators, else the principal and admins. */
async function reviewersFor(post, circle) {
  if (circle) return circle.moderatorProfileIds.map(String);
  return (await profilesWithRoles(REVIEWER_ROLES)).map((p) => String(p._id));
}

async function submitInto(post, actor) {
  await assertMediaRules(post);
  const circle = post.circleId ? await Circle.findById(post.circleId).lean() : null;
  const circleMod = circle && circle.moderatorProfileIds.some((m) => String(m) === String(actor.profileId));
  // Moderators publish their own posts; everyone else's go to review.
  if (isModerator(actor) || circleMod) {
    post.status = 'PUBLISHED'; post.publishedAt = post.publishedAt ?? new Date();
    pushHistory(post, actor, 'PUBLISHED');
  } else {
    post.status = 'PENDING_REVIEW';
    pushHistory(post, actor, 'SUBMITTED');
    const mods = await reviewersFor(post, circle);
    await notify({ recipientProfileIds: mods.filter((m) => m !== String(actor.profileId)), type: 'SYSTEM', title: 'A post is waiting for review', body: post.title ?? post.body.slice(0, 80), link: '/newsroom?tab=review' });
  }
}

export async function submitPost(actor, id) {
  const post = await CommunityPost.findById(assertObjectId(id));
  if (!post || String(post.authorProfileId) !== String(actor.profileId)) throw new AppError('Post not found', 404);
  if (!['DRAFT', 'REJECTED'].includes(post.status)) throw new AppError('Only a draft can be submitted.', 409);
  await submitInto(post, actor);
  await post.save();
  return presentOne(post, await viewerContext(actor));
}

/**
 * The author changes a post. Drafts and sent-back posts stay where they are;
 * a published post that was not written by someone who may publish goes back
 * to review, so an approved story cannot be swapped for something else.
 */
export async function updatePost(actor, id, body = {}) {
  requireProfile(actor);
  const post = await CommunityPost.findById(assertObjectId(id));
  if (!post || String(post.authorProfileId) !== String(actor.profileId)) throw new AppError('Post not found', 404);
  if (!['DRAFT', 'REJECTED', 'PENDING_REVIEW', 'PUBLISHED'].includes(post.status)) throw new AppError('This post can no longer be edited.', 409, [], 'NOT_EDITABLE');
  const fields = await postFields(actor, body, post.toObject());
  if (fields.media) {
    // An edit never lifts a consent hold: the same file stays hidden.
    const held = new Set(post.media.filter((m) => m.hidden).map((m) => m.url));
    fields.media = fields.media.map((m) => (held.has(m.url) ? { ...m, hidden: true } : m));
  }
  Object.assign(post, fields);
  pushHistory(post, actor, 'EDITED');
  if (post.status === 'PUBLISHED') {
    post.pinned = false;
    await submitInto(post, actor);
  } else if (post.status === 'PENDING_REVIEW') {
    await assertMediaRules(post);
  } else if (body.submit === true) {
    await submitInto(post, actor);
  }
  await post.save();
  return presentOne(post, await viewerContext(actor));
}

/** The author withdraws a post; it leaves every feed but stays on record. */
export async function withdrawPost(actor, id) {
  requireProfile(actor);
  const post = await CommunityPost.findById(assertObjectId(id));
  if (!post || String(post.authorProfileId) !== String(actor.profileId)) throw new AppError('Post not found', 404);
  if (['WITHDRAWN', 'TAKEN_DOWN'].includes(post.status)) throw new AppError('This post is already off the feed.', 409);
  const from = post.status;
  post.status = 'WITHDRAWN';
  post.pinned = false;
  pushHistory(post, actor, 'WITHDRAWN', { from, to: 'WITHDRAWN' });
  await post.save();
  return { id: String(post._id), status: post.status };
}

/**
 * Moderation as a state machine: a submitted post is published or sent back;
 * a published one is taken down or archived; reinstating a removed post needs
 * a recorded reason. A draft the author never submitted cannot be published.
 */
const MODERATION = {
  PUBLISH: { from: ['PENDING_REVIEW', 'TAKEN_DOWN', 'ARCHIVED'], to: 'PUBLISHED' },
  REJECT: { from: ['PENDING_REVIEW'], to: 'REJECTED', note: 'Tell the author why.' },
  TAKE_DOWN: { from: ['PUBLISHED'], to: 'TAKEN_DOWN', note: 'Record why it was taken down.' },
  ARCHIVE: { from: ['PUBLISHED'], to: 'ARCHIVED' },
  PIN: { from: ['PUBLISHED'] },
  UNPIN: { from: ['PUBLISHED'] },
};

export async function moderatePost(actor, id, body = {}) {
  requireProfile(actor);
  const post = await CommunityPost.findById(assertObjectId(id));
  if (!post) throw new AppError('Post not found', 404);
  const circle = post.circleId ? await Circle.findById(post.circleId).lean() : null;
  const allowed = isModerator(actor) || (circle && circle.moderatorProfileIds.some((m) => String(m) === String(actor.profileId)));
  if (!allowed) throw new AppError('You cannot moderate this post.', 403);
  const decision = oneOf(body.decision, Object.keys(MODERATION), 'decision');
  const rule = MODERATION[decision];
  const note = optionalText(body.note, { max: 1000 }) || null;
  if (!rule.from.includes(post.status)) throw new AppError(`A ${post.status.toLowerCase().replace('_', ' ')} post cannot be ${decision === 'PUBLISH' ? 'published' : decision.toLowerCase().replace('_', ' ')}.`, 409, [], 'INVALID_TRANSITION');
  const reinstating = decision === 'PUBLISH' && post.status !== 'PENDING_REVIEW';
  if (rule.note && !note) throw new AppError(rule.note, 400, [], 'REASON_REQUIRED');
  if (reinstating) {
    if (!note) throw new AppError('Record why this post is being reinstated.', 400, [], 'REASON_REQUIRED');
    if (!isModerator(actor)) throw new AppError('Only a school moderator can reinstate a removed post.', 403);
  }
  const from = post.status;
  if (decision === 'PUBLISH') { await assertMediaRules(post); post.status = 'PUBLISHED'; post.publishedAt = post.publishedAt ?? new Date(); }
  else if (rule.to) { post.status = rule.to; if (rule.to !== 'PUBLISHED') post.pinned = false; }
  else post.pinned = decision === 'PIN';
  post.moderation = { byProfileId: actor.profileId, at: new Date(), note };
  pushHistory(post, actor, reinstating ? 'REINSTATED' : decision, { from, to: post.status, note });
  await post.save();
  if (['PUBLISH', 'REJECT', 'TAKE_DOWN'].includes(decision) && String(post.authorProfileId) !== String(actor.profileId)) {
    await notify({ recipientProfileIds: [String(post.authorProfileId)], type: 'SYSTEM', title: `Your post was ${decision === 'PUBLISH' ? 'published' : decision === 'REJECT' ? 'sent back for changes' : 'taken down'}`, body: note ?? '', link: '/newsroom?tab=mine' });
  }
  return presentOne(post, await viewerContext(actor));
}

export async function feed(actor, query = {}) {
  const ctx = await viewerContext(actor);
  const filter = { ...audienceQuery(ctx) };
  const and = [];
  if (query.circleId) and.push({ circleId: assertObjectId(query.circleId) });
  if (query.kind) and.push({ kind: String(query.kind).toUpperCase() });
  if (query.tab === 'review') and.push({ status: 'PENDING_REVIEW' });
  else if (query.tab === 'mine') and.push({ authorProfileId: actor.profileId, status: { $ne: 'WITHDRAWN' } });
  else if (query.tab === 'saved') and.push({ bookmarks: actor.profileId, status: 'PUBLISHED' });
  else and.push({ status: 'PUBLISHED' });
  if (query.q) {
    const rx = new RegExp(escapeRegex(String(query.q).slice(0, 80)), 'i');
    and.push({ $or: [{ title: rx }, { body: rx }, { tags: rx }] });
  }
  const args = pageArgs({ ...query, pageSize: query.pageSize ?? 20 });
  const pageSize = Math.min(args.pageSize, MAX_FEED_PAGE);
  const skip = (args.page - 1) * pageSize;
  const q = and.length ? { $and: [filter, ...and] } : filter;
  // Rows never carry who reacted or bookmarked: counts and the viewer's own flags are added below.
  const rows = await CommunityPost.find(q).select('-reactions -bookmarks -history').sort({ pinned: -1, publishedAt: -1, createdAt: -1 }).skip(skip).limit(pageSize + 1).lean();
  const hasMore = rows.length > pageSize;
  // Defence in depth: the query encodes the audience rules, and each row is checked again.
  const visible = rows.slice(0, pageSize).filter((p) => canView(p, ctx));
  return { items: await present(await decorate(visible, ctx), ctx), page: args.page, pageSize, hasMore };
}

export async function getPost(actor, id) {
  const ctx = await viewerContext(actor);
  const post = await CommunityPost.findById(assertObjectId(id)).select('-reactions -bookmarks -history').lean();
  if (!post || !canView(post, ctx)) throw new AppError('Post not found', 404);
  const [out] = await present(await decorate([post], ctx), ctx);
  const reviewer = reviews(post, ctx);
  const or = [{ status: 'VISIBLE' }];
  if (ctx.profileId) or.push({ authorProfileId: ctx.profileId, status: { $in: ['PENDING', 'HIDDEN'] } });
  if (reviewer) or.push({ status: 'PENDING' });
  const comments = await CommunityComment.find({ postId: post._id, $or: or }).sort({ createdAt: 1 }).limit(500).lean();
  out.comments = comments.map((c) => ({
    id: String(c._id), authorName: c.authorName, authorRole: c.authorRole ?? null, body: c.body, status: c.status, createdAt: c.createdAt,
    edited: Boolean(c.editedAt), isMine: String(c.authorProfileId) === ctx.profileId,
  }));
  return out;
}

/** Public page: only PUBLIC posts, only media with PUBLIC consent. */
export async function publicFeed(query = {}) {
  const { page, pageSize, skip } = pageArgs({ ...query, pageSize: 12 });
  const rows = await CommunityPost.find({ status: 'PUBLISHED', audience: 'PUBLIC' }).select('-reactions -bookmarks -history').sort({ pinned: -1, publishedAt: -1 }).skip(skip).limit(pageSize).lean();
  const out = await present(rows.map((r) => ({ ...r, reactionCounts: r.reactionCounts ?? {} })), { anonymous: true, sections: new Set(), circles: new Set(), modCircles: new Set() });
  return { items: out.map(({ myReaction: _m, bookmarked: _b, isMine: _i, moderationNote: _n, canComment: _c, canModerate: _cm, ...rest }) => rest), page, pageSize };
}

async function loadViewablePublished(actor, id) {
  const ctx = await viewerContext(actor);
  const post = await CommunityPost.findById(assertObjectId(id)).select('-bookmarks -history').lean();
  if (!post || post.status !== 'PUBLISHED' || !canView(post, ctx)) throw new AppError('Post not found', 404);
  return { ctx, post };
}

/**
 * One reaction per person, changed with atomic array operators and counters,
 * so simultaneous reactions never overwrite each other.
 */
export async function react(actor, id, { type } = {}) {
  requireProfile(actor);
  const next = type ? oneOf(type, REACTION_TYPES, 'type') : null;
  const { ctx, post } = await loadViewablePublished(actor, id);
  const me = new mongoose.Types.ObjectId(String(actor.profileId));
  if (!post.reactionCounts) {
    // Written before the counters existed: count the array once.
    await CommunityPost.updateOne({ _id: post._id, reactionCounts: { $exists: false } }, { $set: { reactionCounts: { CLAP: 0, HEART: 0, CELEBRATE: 0, INSPIRED: 0, ...countReactions(post.reactions) } } });
  }
  const current = (post.reactions ?? []).find((r) => String(r.profileId) === String(me))?.type;
  let removed = null;
  if (current) {
    // Each pull names the type it removes, so the matching counter is decremented exactly once.
    for (const t of [current, ...REACTION_TYPES.filter((x) => x !== current)]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await CommunityPost.updateOne({ _id: post._id, reactions: { $elemMatch: { profileId: me, type: t } } }, { $pull: { reactions: { profileId: me } }, $inc: { [`reactionCounts.${t}`]: -1 } });
      if (res.modifiedCount) { removed = t; break; }
    }
  }
  if (next && next !== removed) {
    await CommunityPost.updateOne({ _id: post._id, status: 'PUBLISHED', 'reactions.profileId': { $ne: me } }, { $push: { reactions: { profileId: me, type: next } }, $inc: { [`reactionCounts.${next}`]: 1 } });
  }
  const fresh = await CommunityPost.findById(post._id).select('-reactions -bookmarks -history').lean();
  return (await present(await decorate([fresh], ctx), ctx))[0];
}

export async function bookmark(actor, id) {
  requireProfile(actor);
  const { post } = await loadViewablePublished(actor, id);
  const me = new mongoose.Types.ObjectId(String(actor.profileId));
  const added = await CommunityPost.updateOne({ _id: post._id, bookmarks: { $ne: me } }, { $addToSet: { bookmarks: me } });
  if (added.modifiedCount) return { bookmarked: true };
  await CommunityPost.updateOne({ _id: post._id }, { $pull: { bookmarks: me } });
  return { bookmarked: false };
}

// ── Comments ─────────────────────────────────────────────────────────────

/** Whether students can read this post (and so outside adults' replies need a moderator). */
async function studentsCanSee(post) {
  if (post.authorRole === 'STUDENT') return true;
  if ((post.media ?? []).some((m) => (m.studentIds ?? []).length)) return true;
  switch (post.audience) {
    case 'ROLE': return Array.isArray(post.audienceRef) && post.audienceRef.includes('STUDENT');
    case 'CIRCLE': {
      const c = post.circleId ? await Circle.findById(post.circleId).select('adultsOnly').lean() : null;
      return !c?.adultsOnly;
    }
    default: return true; // PUBLIC, INSTITUTION, CAMPUS, CLASS
  }
}

async function commentNeedsReview(post, actor, ctx) {
  if (reviews(post, ctx)) return false;
  const policy = policyOf(post);
  if (policy === 'PRE_MODERATED') return true;
  if (actor.roleKey === 'STUDENT') return true;
  if (isOutsideAdult(actor.roleKey)) return studentsCanSee(post);
  return false;
}

function assertMayComment(post, actor) {
  const policy = policyOf(post);
  if (policy === 'OFF') throw new AppError('Comments are closed on this post.', 409, [], 'COMMENTS_OFF');
  if (policy === 'STAFF_ONLY' && !isStaff(actor.roleKey)) throw new AppError('Only staff can reply to this post.', 403, [], 'COMMENTS_STAFF_ONLY');
}

export async function comment(actor, id, body = {}) {
  requireProfile(actor);
  const ctx = await viewerContext(actor);
  const post = await CommunityPost.findById(assertObjectId(id)).select('-reactions -bookmarks -history').lean();
  if (!post || !canView(post, ctx) || post.status !== 'PUBLISHED') throw new AppError('Post not found', 404);
  assertMayComment(post, actor);
  const text = requireText(body.body, 'body', { max: 2000 });
  const pending = await commentNeedsReview(post, actor, ctx);
  const c = await CommunityComment.create({ postId: post._id, authorProfileId: actor.profileId, authorName: actor.displayName, authorRole: actor.roleKey, body: text, status: pending ? 'PENDING' : 'VISIBLE' });
  return { id: String(c._id), status: c.status };
}

async function ownComment(actor, id) {
  requireProfile(actor);
  const c = await CommunityComment.findById(assertObjectId(id));
  if (!c || String(c.authorProfileId) !== String(actor.profileId) || c.status === 'DELETED') throw new AppError('Comment not found', 404);
  return c;
}

/** The author edits a comment; it goes through the same moderation as a new one. */
export async function editComment(actor, id, body = {}) {
  const c = await ownComment(actor, id);
  if (c.status === 'HIDDEN') throw new AppError('A hidden comment cannot be edited.', 409);
  const ctx = await viewerContext(actor);
  const post = await CommunityPost.findById(c.postId).select('-reactions -bookmarks -history').lean();
  if (!post || post.status !== 'PUBLISHED' || !canView(post, ctx)) throw new AppError('Post not found', 404);
  assertMayComment(post, actor);
  c.body = requireText(body.body, 'body', { max: 2000 });
  c.editedAt = new Date();
  c.status = (await commentNeedsReview(post, actor, ctx)) ? 'PENDING' : 'VISIBLE';
  await c.save();
  return { id: String(c._id), status: c.status };
}

export async function deleteComment(actor, id) {
  const c = await ownComment(actor, id);
  c.status = 'DELETED';
  await c.save();
  return { id: String(c._id), status: c.status };
}

/** Circles whose posts' comments this person may moderate (all, for school moderators). */
async function commentScope(actor) {
  if (isModerator(actor)) return {};
  const ctx = await viewerContext(actor);
  if (!ctx.modCircles.size) throw new AppError('Only moderators can do this.', 403);
  const posts = await CommunityPost.find({ circleId: { $in: [...ctx.modCircles] } }).select('_id').lean();
  return { postId: { $in: posts.map((p) => p._id) } };
}

export async function moderateComment(actor, id, { decision, reason } = {}) {
  requireProfile(actor);
  const c = await CommunityComment.findById(assertObjectId(id));
  if (!c) throw new AppError('Comment not found', 404);
  if (!isModerator(actor)) {
    const post = await CommunityPost.findById(c.postId).select('circleId').lean();
    const ctx = await viewerContext(actor);
    if (!post || !isCircleModerator(post, ctx)) throw new AppError('Only moderators can do this.', 403);
  }
  const d = oneOf(decision, ['APPROVE', 'HIDE'], 'decision');
  if (c.status === 'DELETED') throw new AppError('The author deleted this comment.', 409);
  if (d === 'APPROVE' && c.status === 'VISIBLE') throw new AppError('This comment is already visible.', 409, [], 'INVALID_TRANSITION');
  if (d === 'HIDE' && c.status === 'HIDDEN') throw new AppError('This comment is already hidden.', 409, [], 'INVALID_TRANSITION');
  c.status = d === 'APPROVE' ? 'VISIBLE' : 'HIDDEN';
  c.hiddenReason = d === 'HIDE' ? requireText(reason, 'reason', { max: 500 }) : null;
  await c.save();
  return dto(c);
}

export async function pendingComments(actor) {
  requireProfile(actor);
  const scope = await commentScope(actor);
  const rows = await CommunityComment.find({ status: 'PENDING', ...scope }).sort({ createdAt: 1 }).limit(200).lean();
  const posts = await CommunityPost.find({ _id: { $in: rows.map((r) => r.postId) } }).select('title body').lean();
  const titles = new Map(posts.map((p) => [String(p._id), p.title ?? p.body.slice(0, 80)]));
  return rows.map((r) => ({ ...dto(r), postId: String(r.postId), postTitle: titles.get(String(r.postId)) ?? null }));
}

// ── Reports ──────────────────────────────────────────────────────────────

/** Loads what is being reported, as the reporter can see it — or 404. */
async function loadReportTarget(targetType, targetId, ctx, actor) {
  const missing = () => new AppError('What you reported was not found.', 404, [], 'TARGET_NOT_FOUND');
  if (targetType === 'POST') {
    const post = await CommunityPost.findById(targetId).select('-reactions -bookmarks -history').lean();
    if (!post || !canView(post, ctx)) throw missing();
    return { post };
  }
  if (targetType === 'COMMENT') {
    const c = await CommunityComment.findById(targetId).lean();
    if (!c || c.status === 'DELETED') throw missing();
    const post = await CommunityPost.findById(c.postId).select('-reactions -bookmarks -history').lean();
    if (!post || !canView(post, ctx)) throw missing();
    if (c.status !== 'VISIBLE' && String(c.authorProfileId) !== ctx.profileId && !reviews(post, ctx)) throw missing();
    return { comment: c, post };
  }
  if (targetType === 'CIRCLE') {
    const circle = await Circle.findById(targetId).lean();
    if (!circle || circle.archived || (circle.adultsOnly && actor.roleKey === 'STUDENT')) throw missing();
    return { circle };
  }
  const mentor = await MentorProfile.findById(targetId).lean();
  if (!mentor) throw missing();
  return { mentor };
}

/** Only staff, a guardian of a pictured student, or that student may hide photos at once. */
async function mayHoldMedia(actor, post) {
  if (isStaff(actor.roleKey)) return true;
  const tagged = new Set((post.media ?? []).flatMap((m) => (m.studentIds ?? []).map(String)));
  if (!tagged.size) return false;
  if (actor.roleKey === 'PARENT') return (await getGuardianStudentIds(actor.profileId)).some((s) => tagged.has(String(s)));
  if (actor.roleKey === 'STUDENT') return tagged.has(String(await getOwnStudentId(actor.profileId)));
  return false;
}

export async function report(actor, body = {}) {
  requireProfile(actor);
  const targetType = oneOf(body.targetType, ['POST', 'COMMENT', 'CIRCLE', 'MENTOR'], 'targetType');
  const targetId = assertObjectId(body.targetId, 'targetId');
  const reason = oneOf(body.reason, REPORT_REASONS, 'reason');
  const detail = optionalText(body.detail, { max: 1000 }) || null;
  const recent = await CommunityReport.countDocuments({ reporterProfileId: actor.profileId, createdAt: { $gte: new Date(Date.now() - 3_600_000) } });
  if (recent >= REPORTS_PER_HOUR) throw new AppError('You have sent a lot of reports in the last hour. A moderator is reviewing them; please try again later.', 429, [], 'REPORT_RATE_LIMITED');
  const ctx = await viewerContext(actor);
  const target = await loadReportTarget(targetType, targetId, ctx, actor);
  // One open report per person per item: repeating it changes nothing.
  const dup = await CommunityReport.findOne({ reporterProfileId: actor.profileId, targetType, targetId, status: { $in: OPEN_REPORT } }).lean();
  if (dup) return { id: String(dup._id), status: dup.status, duplicate: true, mediaHidden: false };
  let hidMedia = false;
  if (reason === 'CONSENT' && targetType === 'POST' && (target.post.media ?? []).length && await mayHoldMedia(actor, target.post)) {
    // A consent concern from staff or the family holds the photos while it is reviewed.
    await CommunityPost.updateOne({ _id: target.post._id }, { $set: { 'media.$[].hidden': true } });
    hidMedia = true;
  }
  const r = await CommunityReport.create({ targetType, targetId, reason, detail, reporterProfileId: actor.profileId, hidMedia });
  const roles = SAFEGUARDING_REASONS.has(reason) ? [...REVIEWER_ROLES, 'COMPLIANCE'] : REVIEWER_ROLES;
  const mods = (await profilesWithRoles(roles)).map((p) => String(p._id)).filter((p) => p !== String(actor.profileId));
  await notify({ recipientProfileIds: mods, type: 'SYSTEM', title: SAFEGUARDING_REASONS.has(reason) ? 'Safeguarding report to review' : 'Community report to review', body: reason, link: '/newsroom?tab=review' });
  return { id: String(r._id), status: r.status, mediaHidden: hidMedia };
}

/** Open reports with a preview of what each is about, so a moderator can act on it. */
export async function listReports(actor) {
  if (!isModerator(actor)) throw new AppError('Only moderators can do this.', 403);
  const rows = await CommunityReport.find({ status: { $in: OPEN_REPORT } }).sort({ createdAt: 1 }).limit(200).lean();
  const idsOf = (t) => rows.filter((r) => r.targetType === t).map((r) => r.targetId);
  const [posts, comments, circles, mentors, names] = await Promise.all([
    CommunityPost.find({ _id: { $in: idsOf('POST') } }).select('title body status authorName media.hidden').lean(),
    CommunityComment.find({ _id: { $in: idsOf('COMMENT') } }).select('body status authorName postId').lean(),
    Circle.find({ _id: { $in: idsOf('CIRCLE') } }).select('name archived').lean(),
    MentorProfile.find({ _id: { $in: idsOf('MENTOR') } }).select('name verifiedAffiliation').lean(),
    profileNames(rows.map((r) => r.reporterProfileId)),
  ]);
  const by = (list) => new Map(list.map((x) => [String(x._id), x]));
  const P = by(posts); const C = by(comments); const CI = by(circles); const M = by(mentors);
  const perTarget = new Map();
  for (const r of rows) perTarget.set(`${r.targetType}:${r.targetId}`, (perTarget.get(`${r.targetType}:${r.targetId}`) ?? 0) + 1);
  const preview = (r) => {
    if (r.targetType === 'POST') {
      const p = P.get(r.targetId);
      return p ? { exists: true, title: p.title ?? null, excerpt: p.body.slice(0, 200), status: p.status, author: p.authorName, mediaHidden: (p.media ?? []).some((m) => m.hidden), postId: r.targetId, link: `/newsroom?post=${r.targetId}` } : { exists: false };
    }
    if (r.targetType === 'COMMENT') {
      const c = C.get(r.targetId);
      return c ? { exists: true, excerpt: c.body.slice(0, 200), status: c.status, author: c.authorName, postId: String(c.postId), link: `/newsroom?post=${c.postId}` } : { exists: false };
    }
    if (r.targetType === 'CIRCLE') { const c = CI.get(r.targetId); return c ? { exists: true, title: c.name, status: c.archived ? 'ARCHIVED' : 'ACTIVE', link: '/newsroom?tab=circles' } : { exists: false }; }
    const m = M.get(r.targetId);
    return m ? { exists: true, title: m.name, status: m.verifiedAffiliation ? 'VERIFIED' : 'UNVERIFIED', link: '/mentoring' } : { exists: false };
  };
  return rows.map((r) => ({ ...dto(r), reporterName: names.get(String(r.reporterProfileId)) ?? null, openOnTarget: perTarget.get(`${r.targetType}:${r.targetId}`), target: preview(r) }));
}

/** "Actioned" acts on the item: a post comes down, a comment is hidden, a circle archived, a mentor unlisted. */
async function actOnTarget(actor, r, resolution) {
  if (r.targetType === 'POST') {
    const post = await CommunityPost.findById(r.targetId);
    if (!post) return;
    const from = post.status;
    if (from === 'PUBLISHED') post.status = 'TAKEN_DOWN';
    else if (from === 'PENDING_REVIEW') post.status = 'REJECTED';
    else return;
    post.pinned = false;
    post.moderation = { byProfileId: actor.profileId, at: new Date(), note: resolution };
    pushHistory(post, actor, 'TAKE_DOWN', { from, to: post.status, note: `Report ${r._id}: ${resolution}` });
    await post.save();
    await notify({ recipientProfileIds: [String(post.authorProfileId)], type: 'SYSTEM', title: 'Your post was taken down', body: resolution, link: '/newsroom?tab=mine' });
  } else if (r.targetType === 'COMMENT') {
    await CommunityComment.updateOne({ _id: r.targetId, status: { $in: ['VISIBLE', 'PENDING'] } }, { $set: { status: 'HIDDEN', hiddenReason: resolution } });
  } else if (r.targetType === 'CIRCLE') {
    await Circle.updateOne({ _id: r.targetId }, { $set: { archived: true } });
  } else {
    await MentorProfile.updateOne({ _id: r.targetId }, { $set: { verifiedAffiliation: false, optedIn: false } });
  }
}

export async function resolveReport(actor, id, body = {}) {
  if (!isModerator(actor)) throw new AppError('Only moderators can do this.', 403);
  const r = await CommunityReport.findById(assertObjectId(id));
  if (!r) throw new AppError('Report not found', 404);
  if (!OPEN_REPORT.includes(r.status)) throw new AppError('This report is already resolved.', 409, [], 'INVALID_TRANSITION');
  const status = oneOf(body.status, ['ACTIONED', 'DISMISSED', 'ESCALATED'], 'status');
  if (status === r.status) throw new AppError('This report is already escalated.', 409, [], 'INVALID_TRANSITION');
  const resolution = requireText(body.resolution, 'resolution', { max: 1000 });
  if (status === 'ACTIONED' && body.takeDown !== false) await actOnTarget(actor, r, resolution);
  r.status = status;
  r.resolution = resolution;
  r.resolvedByProfileId = actor.profileId;
  await r.save();
  if (status === 'ACTIONED') {
    // Everyone else's report about the same item is answered by the same action.
    await CommunityReport.updateMany({ _id: { $ne: r._id }, targetType: r.targetType, targetId: r.targetId, status: { $in: OPEN_REPORT } }, { $set: { status: 'ACTIONED', resolution: `Closed with another report: ${resolution}`, resolvedByProfileId: actor.profileId } });
  }
  if (status === 'ESCALATED') {
    const officers = (await profilesWithRoles(['COMPLIANCE', 'PRINCIPAL'])).map((p) => String(p._id)).filter((p) => p !== String(actor.profileId));
    await notify({ recipientProfileIds: officers, type: 'SYSTEM', title: 'Community report escalated', body: `${r.reason}: ${resolution}`, link: '/newsroom?tab=review' });
  }
  if (status === 'DISMISSED' && r.reason === 'CONSENT' && r.targetType === 'POST') {
    // Photos come back only when no other consent concern about them is still open.
    const others = await CommunityReport.countDocuments({ _id: { $ne: r._id }, targetType: 'POST', targetId: r.targetId, reason: 'CONSENT', status: { $in: OPEN_REPORT } });
    if (!others) await CommunityPost.updateOne({ _id: r.targetId }, { $set: { 'media.$[].hidden': false } });
  }
  return dto(r);
}

// ── Event highlights ─────────────────────────────────────────────────────

/** A completed event seeds a draft story. Outcome summary only — never an attendee list. */
export async function draftFromEvent(actor, eventId) {
  const ev = await InstitutionEvent.findById(assertObjectId(eventId)).lean();
  if (!ev) throw new AppError('Event not found', 404);
  if (ev.status !== 'COMPLETED') throw new AppError('Highlights follow a completed event.', 409);
  if (ev.newsroomPostId) throw new AppError('A highlight post already exists for this event.', 409);
  // Claim the event first, so two clicks cannot create two drafts.
  const postId = new mongoose.Types.ObjectId();
  const claim = await InstitutionEvent.updateOne({ _id: ev._id, newsroomPostId: null }, { $set: { newsroomPostId: postId } });
  if (!claim.modifiedCount) throw new AppError('A highlight post already exists for this event.', 409);
  try {
    return await createPost(actor, {
      kind: 'EVENT_HIGHLIGHT', title: ev.title, audience: 'INSTITUTION', eventId: ev._id,
      body: [ev.outcome?.summary, ...(ev.outcome?.highlights ?? []).map((h) => `• ${h}`)].filter(Boolean).join('\n\n') || ev.description || ev.title,
      tags: ev.kind ? [String(ev.kind).toLowerCase()] : [],
    }, { _id: postId });
  } catch (err) {
    await InstitutionEvent.updateOne({ _id: ev._id, newsroomPostId: postId }, { $set: { newsroomPostId: null } });
    throw err;
  }
}

// ── Circles ──────────────────────────────────────────────────────────────

export async function createCircle(actor, body = {}) {
  requireProfile(actor);
  const kind = oneOf(body.kind, CIRCLE_KINDS, 'kind');
  const mayCreate = isStaff(actor.roleKey) || (actor.roleKey === 'ALUMNUS' && kind === 'ALUMNI');
  if (!mayCreate) throw new AppError('Ask a teacher or the institution to create a circle.', 403);
  const adultsOnly = ['ALUMNI', 'PARENTS'].includes(kind) || body.adultsOnly === true;
  // A school circle may welcome invited outside adults only if staff say so when creating it.
  const adultsWelcome = !adultsOnly && isStaff(actor.roleKey) && body.adultsWelcome === true;
  let allowedRoles = Array.isArray(body.allowedRoles) ? [...new Set(body.allowedRoles.map((r) => String(r).toUpperCase()).filter((r) => /^[A-Z_]{2,30}$/.test(r)))] : [];
  if (adultsOnly) allowedRoles = allowedRoles.filter((r) => r !== 'STUDENT');
  else {
    // School circles default to students and staff; outside adults come in by invitation only.
    if (!allowedRoles.length) allowedRoles = ['STUDENT', ...STAFF];
    allowedRoles = allowedRoles.filter((r) => !isOutsideAdult(r));
  }
  const c = await Circle.create({
    name: requireText(body.name, 'name', { max: 120 }), kind, description: optionalText(body.description, { max: 2000 }) || null,
    joinPolicy: oneOf(body.joinPolicy, ['OPEN', 'APPROVAL', 'INVITE'], 'joinPolicy', 'APPROVAL'),
    allowedRoles,
    adultsOnly,
    adultsWelcome,
    // School circles with student members always have a staff moderator.
    moderatorProfileIds: [actor.profileId],
    members: [{ profileId: actor.profileId, name: actor.displayName, roleKey: actor.roleKey, status: 'ACTIVE' }],
    createdByProfileId: actor.profileId,
  });
  return dto(c);
}

/**
 * Who may be in a circle. Adults-only circles refuse students. A school
 * circle (students in it) takes outside adults — alumni, parents — only when
 * it was opened to them and a staff member invites them; they never join it
 * by themselves.
 */
function memberCheck(circle, roleKey, { viaInvite = false } = {}) {
  if (circle.archived) throw new AppError('This circle is archived.', 409);
  if (circle.adultsOnly && roleKey === 'STUDENT') throw new AppError('This circle is for adults only.', 403, [], 'ADULTS_ONLY');
  if (!circle.adultsOnly && isOutsideAdult(roleKey)) {
    if (!circle.adultsWelcome) throw new AppError('This circle is for students and staff.', 403, [], 'STUDENT_CIRCLE');
    if (!viaInvite) throw new AppError('Staff invite outside adults to this circle.', 403, [], 'INVITE_ONLY');
    return;
  }
  if (circle.allowedRoles?.length && !circle.allowedRoles.includes(roleKey)) throw new AppError('This circle is not open to your role.', 403);
}

export async function joinCircle(actor, id) {
  requireProfile(actor);
  const c = await Circle.findById(assertObjectId(id));
  if (!c) throw new AppError('Circle not found', 404);
  memberCheck(c, actor.roleKey);
  const m = c.members.find((x) => String(x.profileId) === String(actor.profileId));
  // Removal is a moderator's decision: only a moderator's invitation undoes it.
  if (m && ['BLOCKED', 'REMOVED'].includes(m.status)) throw new AppError('A moderator removed you from this circle. Ask them if you can rejoin.', 403, [], 'REMOVED_FROM_CIRCLE');
  if (m && ['ACTIVE', 'PENDING'].includes(m.status)) return { status: m.status };
  if (c.joinPolicy === 'INVITE') throw new AppError('This circle is by invitation.', 403);
  const status = c.joinPolicy === 'OPEN' ? 'ACTIVE' : 'PENDING';
  if (m) { m.status = status; m.joinedAt = new Date(); }
  else c.members.push({ profileId: actor.profileId, name: actor.displayName, roleKey: actor.roleKey, status });
  await c.save();
  if (status === 'PENDING') await notify({ recipientProfileIds: c.moderatorProfileIds.map(String), type: 'SYSTEM', title: `Join request: ${c.name}`, body: actor.displayName ?? '', link: `/newsroom?tab=circles&id=${c._id}` });
  return { status };
}

export async function leaveCircle(actor, id) {
  requireProfile(actor);
  const c = await Circle.findById(assertObjectId(id));
  if (!c) throw new AppError('Circle not found', 404);
  const me = String(actor.profileId);
  const m = c.members.find((x) => String(x.profileId) === me);
  const isMod = c.moderatorProfileIds.some((x) => String(x) === me);
  if (!m || !['ACTIVE', 'PENDING'].includes(m.status)) {
    if (!isMod) throw new AppError('You are not in this circle.', 404);
  }
  if (isMod) {
    const others = c.moderatorProfileIds.filter((x) => String(x) !== me);
    const activeOthers = c.members.filter((x) => x.status === 'ACTIVE' && String(x.profileId) !== me).length;
    if (!others.length && activeOthers) throw new AppError('Make someone else a moderator before you leave.', 409, [], 'LAST_MODERATOR');
    c.moderatorProfileIds = others;
  }
  if (m) m.status = 'LEFT';
  await c.save();
  return { status: 'LEFT' };
}

export async function manageMember(actor, id, body = {}) {
  requireProfile(actor);
  const c = await Circle.findById(assertObjectId(id));
  if (!c) throw new AppError('Circle not found', 404);
  if (!c.moderatorProfileIds.some((m) => String(m) === String(actor.profileId)) && !isModerator(actor)) throw new AppError('Only the circle\'s moderators can do this.', 403);
  const profileId = assertObjectId(body.profileId, 'profileId');
  const action = oneOf(body.action, ['APPROVE', 'REMOVE', 'BLOCK', 'MAKE_MODERATOR', 'INVITE'], 'action');
  const m = c.members.find((x) => String(x.profileId) === profileId);
  if (action === 'INVITE') {
    const { Profile } = await import('../../models/profile.model.js');
    const p = await Profile.findById(profileId).populate('roleId', 'key').lean();
    const tenant = currentTenantId();
    if (!p || (tenant && p.tenantId && String(p.tenantId) !== tenant)) throw new AppError('Person not found', 404);
    const roleKey = p.roleId?.key;
    if (isOutsideAdult(roleKey) && !c.adultsOnly && !isStaff(actor.roleKey)) throw new AppError('Only staff can invite outside adults to a school circle.', 403, [], 'STAFF_INVITE_ONLY');
    memberCheck(c, roleKey, { viaInvite: true });
    if (!m) c.members.push({ profileId, name: p.displayName, roleKey, status: 'ACTIVE' });
    else { m.status = 'ACTIVE'; m.roleKey = roleKey; }
  } else {
    if (!m) throw new AppError('Not a member', 404);
    if (action === 'APPROVE') {
      if (m.status !== 'PENDING') throw new AppError('Only a pending request can be approved.', 409, [], 'INVALID_TRANSITION');
      memberCheck(c, m.roleKey);
      m.status = 'ACTIVE';
    }
    if (action === 'REMOVE' || action === 'BLOCK') {
      m.status = action === 'REMOVE' ? 'REMOVED' : 'BLOCKED';
      c.moderatorProfileIds = c.moderatorProfileIds.filter((x) => String(x) !== profileId);
    }
    if (action === 'MAKE_MODERATOR') {
      if (m.status !== 'ACTIVE') throw new AppError('Only an active member can moderate.', 409);
      // Students never moderate; in a school circle only staff do.
      if (m.roleKey === 'STUDENT' || (!c.adultsOnly && !isStaff(m.roleKey))) throw new AppError('Students cannot moderate circles; in a school circle only staff can.', 403);
      if (!c.moderatorProfileIds.some((x) => String(x) === profileId)) c.moderatorProfileIds.push(profileId);
    }
  }
  await c.save();
  return dto(c);
}

export async function listCircles(actor) {
  requireProfile(actor);
  const ctx = await viewerContext(actor);
  const rows = await Circle.find({ archived: false }).sort({ name: 1 }).limit(500).lean();
  const outside = isOutsideAdult(actor.roleKey);
  return rows
    // Students do not see adults-only circles in discovery at all.
    .filter((c) => !(c.adultsOnly && actor.roleKey === 'STUDENT'))
    // Outside adults discover adult circles; school circles only once invited.
    .filter((c) => !outside || c.adultsOnly || ctx.circles.has(String(c._id)) || isModerator(actor))
    .filter((c) => !c.allowedRoles?.length || c.allowedRoles.includes(actor.roleKey) || ctx.circles.has(String(c._id)))
    .map((c) => {
      const me = c.members.find((m) => String(m.profileId) === String(actor.profileId));
      const isMod = c.moderatorProfileIds.some((m) => String(m) === String(actor.profileId));
      // Outside adults never get a list of the children in a circle.
      const hideMinors = outside && !isModerator(actor);
      return {
        id: String(c._id), name: c.name, kind: c.kind, description: c.description, joinPolicy: c.joinPolicy, adultsOnly: c.adultsOnly, adultsWelcome: Boolean(c.adultsWelcome),
        memberCount: c.members.filter((m) => m.status === 'ACTIVE').length,
        myStatus: me?.status ?? null, isModerator: isMod,
        canJoin: (!me || me.status === 'LEFT') && c.joinPolicy !== 'INVITE' && !(outside && !c.adultsOnly),
        // Member lists are for members and moderators, and show names only.
        members: me?.status === 'ACTIVE' || isMod
          ? c.members.filter((m) => (m.status === 'ACTIVE' || (isMod && m.status === 'PENDING')) && !(hideMinors && m.roleKey === 'STUDENT')).map((m) => ({ profileId: String(m.profileId), name: m.name, roleKey: m.roleKey, status: m.status }))
          : undefined,
      };
    });
}

/** Students a staff member may tag in a photo, with their current consent. */
export async function taggableStudents(actor, query = {}) {
  requireProfile(actor);
  if (!isStaff(actor.roleKey)) throw new AppError('Only staff tag students in photos.', 403);
  const q = String(query.q ?? '').trim().slice(0, 60);
  if (q.length < 2) return [];
  const rx = new RegExp(escapeRegex(q), 'i');
  const filter = { $or: [{ firstName: rx }, { lastName: rx }, { admissionNo: rx }] };
  if (!isModerator(actor) && actor.roleKey === 'TEACHER') {
    const sections = await getTeacherSectionIds(actor.profileId);
    const ens = await Enrollment.find({ sectionId: { $in: sections }, status: 'ACTIVE' }).select('studentId').lean();
    filter._id = { $in: ens.map((e) => e.studentId) };
  }
  const students = await Student.find(filter).select('firstName lastName').sort({ firstName: 1 }).limit(20).lean();
  const ids = students.map((s) => String(s._id));
  const [levels, ens] = await Promise.all([consentLevels(ids), Enrollment.find({ studentId: { $in: ids }, status: 'ACTIVE' }).select('studentId sectionId').lean()]);
  const { Section, Grade } = await import('../../models/academics.model.js');
  const sections = await Section.find({ _id: { $in: ens.map((e) => e.sectionId) } }).select('name gradeId').lean();
  const grades = await Grade.find({ _id: { $in: sections.map((s) => s.gradeId) } }).select('name').lean();
  const gradeName = new Map(grades.map((g) => [String(g._id), g.name]));
  const sectionName = new Map(sections.map((s) => [String(s._id), `${gradeName.get(String(s.gradeId)) ?? ''}-${s.name}`.replace(/^-/, '')]));
  const classOf = new Map(ens.map((e) => [String(e.studentId), sectionName.get(String(e.sectionId)) ?? null]));
  return students.map((s) => ({ id: String(s._id), name: `${s.firstName} ${s.lastName ?? ''}`.trim(), className: classOf.get(String(s._id)) ?? null, consent: levels.get(String(s._id)) ?? 'NONE' }));
}

// ── Media consent ────────────────────────────────────────────────────────

/** A parent sets consent for a linked child; in a college an adult student sets their own. */
export async function setConsent(actor, body = {}) {
  requireProfile(actor);
  const studentId = assertObjectId(body.studentId, 'studentId');
  const level = oneOf(body.level, ['NONE', 'INTERNAL', 'PUBLIC'], 'level');
  let allowed = false;
  let evidence = null;
  let evidenceFileUrl = null;
  if (actor.roleKey === 'PARENT') allowed = (await getGuardianStudentIds(actor.profileId)).map(String).includes(studentId);
  else if (actor.roleKey === 'STUDENT') {
    const inst = await InstitutionProfile.findOne({}).select('institutionType').lean();
    allowed = inst?.institutionType === 'COLLEGE' && String(await getOwnStudentId(actor.profileId)) === studentId;
  } else if (isModerator(actor)) {
    // Staff recording a paper consent form must cite it, and it is kept with the record.
    evidence = requireText(body.evidence, 'evidence (signed form reference)', { max: 300 });
    if (body.evidenceFileUrl) {
      evidenceFileUrl = requireText(body.evidenceFileUrl, 'evidence file', { max: 1000 });
      if (!/^\/uploads\/[A-Za-z0-9._\-/]+$/.test(evidenceFileUrl) || evidenceFileUrl.includes('..')) throw new AppError('Attach the signed form as an upload.', 400, [], 'MEDIA_URL_INVALID');
    }
    if (!(await Student.exists({ _id: studentId }))) throw new AppError('Student not found', 404);
    allowed = true;
  }
  if (!allowed) throw new AppError('You cannot set consent for this student.', 403);
  await MediaConsent.updateMany({ studentId, withdrawnAt: null }, { $set: { withdrawnAt: new Date() } });
  const row = await MediaConsent.create({ studentId, level, grantedByProfileId: actor.profileId, grantedByRole: actor.roleKey, evidence, evidenceFileUrl });
  return dto(row);
}

export async function myConsents(actor) {
  requireProfile(actor);
  const ids = actor.roleKey === 'PARENT' ? await getGuardianStudentIds(actor.profileId) : [await getOwnStudentId(actor.profileId)].filter(Boolean);
  const students = await Student.find({ _id: { $in: ids } }).select('firstName lastName').lean();
  const levels = await consentLevels(ids);
  return students.map((s) => ({ studentId: String(s._id), name: `${s.firstName} ${s.lastName ?? ''}`.trim(), level: levels.get(String(s._id)) ?? 'NONE' }));
}

// ── Mentoring ────────────────────────────────────────────────────────────

export async function upsertMentorProfile(actor, body = {}) {
  requireProfile(actor);
  const kind = actor.roleKey === 'ALUMNUS' ? 'ALUMNUS' : actor.roleKey === 'STUDENT' ? 'SENIOR_STUDENT' : 'STAFF';
  const next = {
    name: actor.displayName, kind, batch: optionalText(body.batch, { max: 40 }) || null, headline: optionalText(body.headline, { max: 200 }) || null,
    topics: Array.isArray(body.topics) ? body.topics.map((t) => String(t).slice(0, 40)).slice(0, 15) : [],
    availability: optionalText(body.availability, { max: 200 }) || null, optedIn: body.optedIn !== false, adult: kind !== 'SENIOR_STUDENT',
  };
  const existing = await MentorProfile.findOne({ profileId: actor.profileId }).lean();
  const update = { $set: next };
  if (!existing) update.$setOnInsert = { verifiedAffiliation: kind === 'STAFF' };
  else if (kind !== 'STAFF' && existing.verifiedAffiliation) {
    // What staff verified was this batch, headline and topics: a change needs checking again.
    const changed = (existing.batch ?? null) !== next.batch || (existing.headline ?? null) !== next.headline || JSON.stringify(existing.topics ?? []) !== JSON.stringify(next.topics);
    if (changed) Object.assign(next, { verifiedAffiliation: false, verifiedByProfileId: null });
  }
  const doc = await MentorProfile.findOneAndUpdate({ profileId: actor.profileId }, update, { upsert: true, new: true }).lean();
  return dto(doc);
}

export async function verifyMentor(actor, id) {
  if (!isModerator(actor)) throw new AppError('Only moderators can verify mentors.', 403);
  const m = await MentorProfile.findByIdAndUpdate(assertObjectId(id), { $set: { verifiedAffiliation: true, verifiedByProfileId: actor.profileId } }, { new: true }).lean();
  if (!m) throw new AppError('Mentor not found', 404);
  return dto(m);
}

export async function listMentors(actor, query = {}) {
  requireProfile(actor);
  const filter = isModerator(actor) && query.all === 'true' ? {} : { optedIn: true, verifiedAffiliation: true };
  const rows = await MentorProfile.find(filter).sort({ name: 1 }).limit(500).lean();
  // Profiles show what mentors chose to share — no contact details.
  return rows.map((m) => ({ id: String(m._id), profileId: String(m.profileId), name: m.name, kind: m.kind, batch: m.batch, headline: m.headline, topics: m.topics, availability: m.availability, verified: m.verifiedAffiliation }));
}

const OPEN_MENTORING = ['REQUESTED', 'ACCEPTED', 'SCHEDULED'];
const SUPERVISED_MODES = ['GROUP_ONLINE', 'GROUP_ON_CAMPUS', 'ONE_TO_ONE_SUPERVISED'];
const MENTORING_MACHINE = {
  REQUESTED: ['ACCEPTED', 'DECLINED', 'CANCELLED'],
  ACCEPTED: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['SCHEDULED', 'COMPLETED', 'CANCELLED'],
  DECLINED: [], COMPLETED: [], CANCELLED: [],
};
// Phone numbers, e-mail addresses and social handles: no private channel with a minor.
const CONTACT_DETAILS = /(\+?\d[\d\s-]{8,}\d)|([\w.+-]+@[\w-]+\.[\w.]+)|\b(insta(gram)?|whats\s?app|snap(chat)?|telegram|signal|dm me)\b/i;

/**
 * A mentee asks for mentoring. Any request involving a student is supervised:
 * sessions are group or staff-moderated, scheduled through the institution,
 * and there is no private adult-to-minor messaging in the platform.
 */
export async function requestMentoring(actor, body = {}) {
  requireProfile(actor);
  const mentor = await MentorProfile.findById(assertObjectId(body.mentorId, 'mentorId')).lean();
  if (!mentor || !mentor.optedIn || !mentor.verifiedAffiliation) throw new AppError('Mentor not found', 404);
  if (String(mentor.profileId) === String(actor.profileId)) throw new AppError('You cannot mentor yourself.', 400);
  const supervised = actor.roleKey === 'STUDENT' || !mentor.adult;
  const topic = requireText(body.topic, 'topic', { max: 120 });
  const message = optionalText(body.message, { max: 1000 }) || null;
  if (supervised && CONTACT_DETAILS.test(`${topic} ${message ?? ''}`)) throw new AppError('Please leave out phone numbers, e-mail addresses and social handles; sessions are arranged by the school.', 400, [], 'CONTACT_DETAILS');
  if (await MentorshipRequest.exists({ mentorProfileId: mentor.profileId, menteeProfileId: actor.profileId, status: { $in: OPEN_MENTORING } })) {
    throw new AppError('You already have an open request with this mentor.', 409, [], 'DUPLICATE_REQUEST');
  }
  const r = new MentorshipRequest({ mentorProfileId: mentor.profileId, menteeProfileId: actor.profileId, topic, message, supervised });
  pushHistory(r, actor, 'REQUESTED');
  await r.save();
  await notify({ recipientProfileIds: [String(mentor.profileId)], type: 'SYSTEM', title: 'New mentoring request', body: r.topic, link: '/mentoring' });
  if (supervised) {
    const staff = await profilesWithRoles(REVIEWER_ROLES);
    await notify({ recipientProfileIds: staff.map((p) => String(p._id)), type: 'SYSTEM', title: 'Supervised mentoring request needs a supervisor', body: r.topic, link: '/mentoring' });
  }
  return dto(r);
}

/**
 * Mentoring as a state machine (REQUESTED → ACCEPTED → SCHEDULED → COMPLETED,
 * with DECLINED and CANCELLED). Only the people in the request — mentee,
 * mentor, supervisor — or a school moderator can act on it, and a supervised
 * request is only ever scheduled as a group or supervised session.
 */
export async function respondMentoring(actor, id, body = {}) {
  requireProfile(actor);
  const r = await MentorshipRequest.findById(assertObjectId(id));
  if (!r) throw new AppError('Request not found', 404);
  const me = String(actor.profileId);
  const isMentor = String(r.mentorProfileId) === me;
  const isMentee = String(r.menteeProfileId) === me;
  const isSupervisor = Boolean(r.supervisorProfileId) && String(r.supervisorProfileId) === me;
  const mod = isModerator(actor);
  if (!isMentor && !isMentee && !isSupervisor && !mod) throw new AppError('Request not found', 404);
  const action = oneOf(body.action, ['ACCEPT', 'DECLINE', 'ASSIGN_SUPERVISOR', 'SCHEDULE', 'COMPLETE', 'CANCEL'], 'action');
  const from = r.status;
  const label = 'mentoring request';
  let notifyWho = [];
  if (action === 'ASSIGN_SUPERVISOR') {
    if (!mod) throw new AppError('Only staff assign a supervisor.', 403);
    if (!r.supervised) throw new AppError('This request is between adults and has no supervisor.', 409, [], 'NOT_SUPERVISED');
    if (!OPEN_MENTORING.includes(r.status)) throw new AppError(`A ${r.status.toLowerCase()} request cannot be supervised.`, 409, [], 'INVALID_TRANSITION');
    if (isMentor || isMentee) throw new AppError('A supervisor cannot be the mentor or the mentee.', 409);
    if (r.supervisorProfileId && !isSupervisor && body.replace !== true) throw new AppError('A supervisor is already assigned. Confirm to replace them.', 409, [], 'SUPERVISOR_ASSIGNED');
    r.supervisorProfileId = actor.profileId;
    notifyWho = [r.mentorProfileId, r.menteeProfileId];
  } else if (action === 'SCHEDULE') {
    if (!isMentor && !isSupervisor) throw new AppError('Only the mentor or the supervisor schedules sessions.', 403);
    assertTransition(MENTORING_MACHINE, r.status, 'SCHEDULED', label);
    if (r.supervised && !r.supervisorProfileId) throw new AppError('A staff supervisor must be assigned before a session with a student is scheduled.', 409, [], 'SUPERVISOR_REQUIRED');
    // Validate first, on the normalised value, before anything is stored.
    const mode = oneOf(body.mode, [...SUPERVISED_MODES, 'ONE_TO_ONE'], 'mode');
    if (r.supervised && !SUPERVISED_MODES.includes(mode)) throw new AppError('Sessions with students must be group or supervised.', 409, [], 'SUPERVISION_REQUIRED');
    const at = parseDate(body.at, 'at', { required: true });
    if (at.getTime() < Date.now() - 3_600_000) throw new AppError('Choose a time in the future.', 400);
    let link = null;
    if (body.link) {
      link = requireText(body.link, 'link', { max: 500 });
      let u = null;
      try { u = new URL(link); } catch { u = null; }
      if (!u || u.protocol !== 'https:') throw new AppError('The session link must be an https:// link.', 400);
    }
    r.sessions.push({ at, mode, link });
    r.status = 'SCHEDULED';
    notifyWho = [r.mentorProfileId, r.menteeProfileId, r.supervisorProfileId];
  } else if (action === 'ACCEPT' || action === 'DECLINE') {
    if (!isMentor) throw new AppError('Only the mentor can respond.', 403);
    assertTransition(MENTORING_MACHINE, r.status, action === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED', label);
    r.status = action === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED';
    notifyWho = [r.menteeProfileId];
  } else if (action === 'COMPLETE') {
    assertTransition(MENTORING_MACHINE, r.status, 'COMPLETED', label);
    if (!r.sessions.length) throw new AppError('Schedule a session before completing the mentoring.', 409, [], 'NO_SESSION');
    const feedback = optionalText(body.feedback, { max: 1000 }) || null;
    if (feedback) { r.sessions.at(-1).feedback = feedback; r.feedback = feedback; }
    if (body.rating !== undefined && body.rating !== null && body.rating !== '') {
      const rating = Number(body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new AppError('rating must be 1 to 5', 400);
      r.sessions.at(-1).rating = rating;
    }
    r.status = 'COMPLETED';
    notifyWho = [r.mentorProfileId, r.menteeProfileId];
  } else {
    assertTransition(MENTORING_MACHINE, r.status, 'CANCELLED', label);
    r.status = 'CANCELLED';
    notifyWho = [r.mentorProfileId, r.menteeProfileId, r.supervisorProfileId];
  }
  pushHistory(r, actor, action, { from, to: r.status });
  await r.save();
  const recipients = [...new Set(notifyWho.filter(Boolean).map(String))].filter((p) => p !== me);
  if (recipients.length) await notify({ recipientProfileIds: recipients, type: 'SYSTEM', title: `Mentoring: ${r.topic}`, body: `Now ${r.status.toLowerCase()}`, link: '/mentoring' });
  return dto(r);
}

export async function myMentoring(actor) {
  requireProfile(actor);
  const filter = isModerator(actor) ? { $or: [{ supervised: true }, { mentorProfileId: actor.profileId }, { menteeProfileId: actor.profileId }] } : { $or: [{ mentorProfileId: actor.profileId }, { menteeProfileId: actor.profileId }, { supervisorProfileId: actor.profileId }] };
  const rows = await MentorshipRequest.find(filter).select('-history').sort({ createdAt: -1 }).limit(200).lean();
  const names = await profileNames(rows.flatMap((r) => [r.mentorProfileId, r.menteeProfileId, r.supervisorProfileId]));
  return rows.map((r) => ({
    ...dto(r),
    mentorName: names.get(String(r.mentorProfileId)) ?? null,
    menteeName: names.get(String(r.menteeProfileId)) ?? null,
    supervisorName: r.supervisorProfileId ? names.get(String(r.supervisorProfileId)) ?? null : null,
  }));
}
