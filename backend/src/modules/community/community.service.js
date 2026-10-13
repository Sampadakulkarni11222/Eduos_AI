import { CommunityPost, CommunityComment, Circle, MediaConsent, MentorProfile, MentorshipRequest, CommunityReport, AUDIENCES } from '../../models/community.model.js';
import { InstitutionEvent } from '../../models/administration.model.js';
import { InstitutionProfile } from '../../models/institution.model.js';
import { Enrollment } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { getGuardianStudentIds, getOwnStudentId, getTeacherSectionIds } from '../../utils/scope.js';
import { notify } from '../notifications/notification.service.js';
import {
  requireProfile, assertObjectId, pushHistory, requireText, optionalText, oneOf, dto, pageArgs, profilesWithRoles, escapeRegex,
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
 * community.moderate publish directly. A report is reviewed by a person; an
 * automated flag never removes anything by itself.
 */

const STAFF = new Set(['PRINCIPAL', 'ADMIN', 'TEACHER', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'LIBRARIAN', 'WARDEN', 'SUPER_ADMIN']);
const isModerator = (actor) => Boolean(actor?.permissions?.['community.moderate']);

/** What the viewer belongs to, for audience checks. Computed once per request. */
export async function viewerContext(actor) {
  if (!actor?.profileId) return { anonymous: true, sections: new Set(), circles: new Set() };
  let sections = [];
  if (actor.roleKey === 'TEACHER') sections = await getTeacherSectionIds(actor.profileId);
  if (actor.roleKey === 'STUDENT' || actor.roleKey === 'PARENT') {
    const studentIds = actor.roleKey === 'STUDENT' ? [await getOwnStudentId(actor.profileId)].filter(Boolean) : await getGuardianStudentIds(actor.profileId);
    const ens = await Enrollment.find({ studentId: { $in: studentIds }, status: 'ACTIVE' }).select('sectionId').lean();
    sections = ens.map((e) => String(e.sectionId));
  }
  const circles = await Circle.find({ $or: [{ members: { $elemMatch: { profileId: actor.profileId, status: 'ACTIVE' } } }, { moderatorProfileIds: actor.profileId }] }).select('_id').lean();
  return { anonymous: false, roleKey: actor.roleKey, profileId: String(actor.profileId), moderator: isModerator(actor), sections: new Set(sections.map(String)), circles: new Set(circles.map((c) => String(c._id))) };
}

export function canView(post, ctx) {
  if (post.status !== 'PUBLISHED') {
    if (ctx.anonymous) return false;
    return post.authorProfileId && String(post.authorProfileId) === ctx.profileId || ctx.moderator;
  }
  if (post.audience === 'PUBLIC') return true;
  if (ctx.anonymous) return false;
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
  if (ctx.moderator) return { $or: [{ status: 'PUBLISHED' }, { authorProfileId: ctx.profileId }, { status: 'PENDING_REVIEW' }] };
  return {
    $or: [
      { status: 'PUBLISHED', audience: { $in: ['PUBLIC', 'INSTITUTION', 'CAMPUS'] } },
      { status: 'PUBLISHED', audience: 'ROLE', audienceRef: ctx.roleKey },
      { status: 'PUBLISHED', audience: 'CLASS', audienceRef: { $in: [...ctx.sections] } },
      { status: 'PUBLISHED', audience: 'CIRCLE', circleId: { $in: [...ctx.circles] } },
      { authorProfileId: ctx.profileId },
    ],
  };
}

async function consentLevels(studentIds) {
  const rows = await MediaConsent.find({ studentId: { $in: studentIds }, withdrawnAt: null }).sort({ at: -1 }).lean();
  const level = new Map();
  for (const r of rows) if (!level.has(String(r.studentId))) level.set(String(r.studentId), r.level);
  return level;
}

const needs = (audience) => (audience === 'PUBLIC' ? 'PUBLIC' : 'INTERNAL');
const allows = (have, need) => have === 'PUBLIC' || (have === 'INTERNAL' && need === 'INTERNAL');

/** Presents posts with media filtered by current consent and reaction counts. */
async function present(posts, ctx) {
  const studentIds = [...new Set(posts.flatMap((p) => (p.media ?? []).flatMap((m) => (m.studentIds ?? []).map(String))))];
  const levels = await consentLevels(studentIds);
  return posts.map((p) => {
    // Consent is about who sees the image: the public, or the signed-in community.
    const need = ctx.anonymous ? 'PUBLIC' : 'INTERNAL';
    const media = (p.media ?? []).filter((m) => !m.hidden && (m.studentIds ?? []).every((s) => allows(levels.get(String(s)), need)))
      .map((m) => ({ id: String(m._id), url: m.url, kind: m.kind, caption: m.caption, altText: m.altText }));
    const counts = {};
    for (const r of p.reactions ?? []) counts[r.type] = (counts[r.type] ?? 0) + 1;
    return {
      id: String(p._id), kind: p.kind, title: p.title, body: p.body, tags: p.tags, audience: p.audience,
      circleId: p.circleId ? String(p.circleId) : null, eventId: p.eventId ? String(p.eventId) : null,
      authorName: p.authorName, authorRole: p.authorRole, status: p.status, publishedAt: p.publishedAt, pinned: p.pinned,
      commentsEnabled: p.commentsEnabled, media, mediaWithheld: (p.media ?? []).filter((m) => !m.hidden).length - media.length,
      reactions: counts,
      myReaction: ctx.profileId ? (p.reactions ?? []).find((r) => String(r.profileId) === ctx.profileId)?.type ?? null : null,
      bookmarked: ctx.profileId ? (p.bookmarks ?? []).some((b) => String(b) === ctx.profileId) : false,
      isMine: ctx.profileId ? String(p.authorProfileId) === ctx.profileId : false,
      moderationNote: ctx.profileId && String(p.authorProfileId) === ctx.profileId ? p.moderation?.note ?? null : undefined,
    };
  });
}

function cleanMedia(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 30).map((m) => ({
    url: requireText(m.url, 'media url', { max: 1000 }),
    kind: oneOf(m.kind, ['IMAGE', 'VIDEO', 'DOCUMENT'], 'media kind', 'IMAGE'),
    caption: optionalText(m.caption, { max: 300 }) || null,
    altText: optionalText(m.altText, { max: 300 }) || null,
    studentIds: Array.isArray(m.studentIds) ? m.studentIds.map((s) => assertObjectId(s, 'studentIds')).slice(0, 60) : [],
    metadataStripped: m.metadataStripped === true,
  }));
}

/** Blocks publication of media whose students lack the consent level the audience requires. */
async function assertConsent(post) {
  const need = needs(post.audience);
  const ids = [...new Set(post.media.flatMap((m) => m.studentIds.map(String)))];
  if (!ids.length) return;
  const levels = await consentLevels(ids);
  const missing = ids.filter((s) => !allows(levels.get(s), need));
  if (missing.length) throw new AppError(`${missing.length} pictured student(s) do not have ${need.toLowerCase()} media consent. Remove those images or tag them correctly.`, 409, [], 'CONSENT_MISSING');
  const images = post.media.filter((m) => m.kind === 'IMAGE');
  if (images.some((m) => !m.altText)) throw new AppError('Add alt text to every image.', 400, [], 'ALT_TEXT_REQUIRED');
  if (images.some((m) => m.studentIds.length && !m.metadataStripped)) throw new AppError('Confirm location metadata was removed from photos of students.', 400, [], 'METADATA_NOT_STRIPPED');
}

export async function createPost(actor, body = {}) {
  requireProfile(actor);
  const audience = oneOf(body.audience, AUDIENCES, 'audience');
  if (audience === 'PUBLIC' && !STAFF.has(actor.roleKey)) throw new AppError('Only staff can address the public.', 403);
  let circleId = null;
  if (audience === 'CIRCLE') {
    circleId = assertObjectId(body.circleId, 'circleId');
    const ctx = await viewerContext(actor);
    if (!ctx.circles.has(String(circleId))) throw new AppError('You are not a member of that circle.', 403);
  }
  const post = new CommunityPost({
    kind: oneOf(body.kind, ['STORY', 'EVENT_HIGHLIGHT', 'ACHIEVEMENT', 'CEREMONY', 'GALLERY', 'CLUB_UPDATE', 'ALUMNI_STORY', 'CIRCLE_POST'], 'kind', audience === 'CIRCLE' ? 'CIRCLE_POST' : 'STORY'),
    title: optionalText(body.title, { max: 200 }) || null,
    body: requireText(body.body, 'body', { max: 20000 }),
    media: cleanMedia(body.media),
    tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t).toLowerCase().slice(0, 30)).slice(0, 10) : [],
    audience,
    audienceRef: audience === 'ROLE' ? (body.audienceRef ?? []).map((r) => String(r).toUpperCase()) : audience === 'CLASS' ? (body.audienceRef ?? []).map((s) => assertObjectId(s, 'section')) : null,
    circleId,
    eventId: body.eventId ? assertObjectId(body.eventId, 'eventId') : null,
    authorProfileId: actor.profileId, authorName: actor.displayName, authorRole: actor.roleKey,
    commentsEnabled: body.commentsEnabled !== false,
  });
  pushHistory(post, actor, 'DRAFTED');
  if (body.submit === true) await submitInto(post, actor);
  await post.save();
  return (await present([post.toObject()], await viewerContext(actor)))[0];
}

async function submitInto(post, actor) {
  await assertConsent(post);
  const circle = post.circleId ? await Circle.findById(post.circleId).lean() : null;
  const circleMod = circle && circle.moderatorProfileIds.some((m) => String(m) === String(actor.profileId));
  // Moderators publish their own posts; everyone else's go to review.
  if (isModerator(actor) || circleMod) {
    post.status = 'PUBLISHED'; post.publishedAt = new Date();
    pushHistory(post, actor, 'PUBLISHED');
  } else {
    post.status = 'PENDING_REVIEW';
    pushHistory(post, actor, 'SUBMITTED');
    const mods = circle ? circle.moderatorProfileIds.map(String) : (await profilesWithRoles(['PRINCIPAL', 'ADMIN', 'MARKETING'])).map((p) => String(p._id));
    await notify({ recipientProfileIds: mods.filter((m) => m !== String(actor.profileId)), type: 'SYSTEM', title: 'A post is waiting for review', body: post.title ?? post.body.slice(0, 80), link: '/newsroom?tab=review' });
  }
}

export async function submitPost(actor, id) {
  const post = await CommunityPost.findById(assertObjectId(id));
  if (!post || String(post.authorProfileId) !== String(actor.profileId)) throw new AppError('Post not found', 404);
  if (!['DRAFT', 'REJECTED'].includes(post.status)) throw new AppError('Only a draft can be submitted.', 409);
  await submitInto(post, actor);
  await post.save();
  return (await present([post.toObject()], await viewerContext(actor)))[0];
}

export async function moderatePost(actor, id, body = {}) {
  const post = await CommunityPost.findById(assertObjectId(id));
  if (!post) throw new AppError('Post not found', 404);
  const circle = post.circleId ? await Circle.findById(post.circleId).lean() : null;
  const allowed = isModerator(actor) || (circle && circle.moderatorProfileIds.some((m) => String(m) === String(actor.profileId)));
  if (!allowed) throw new AppError('You cannot moderate this post.', 403);
  const decision = oneOf(body.decision, ['PUBLISH', 'REJECT', 'TAKE_DOWN', 'ARCHIVE', 'PIN', 'UNPIN'], 'decision');
  const note = optionalText(body.note, { max: 1000 }) || null;
  if (decision === 'PUBLISH') { await assertConsent(post); post.status = 'PUBLISHED'; post.publishedAt = new Date(); }
  else if (decision === 'REJECT') { if (!note) throw new AppError('Tell the author why.', 400, [], 'REASON_REQUIRED'); post.status = 'REJECTED'; }
  else if (decision === 'TAKE_DOWN') { if (!note) throw new AppError('Record why it was taken down.', 400, [], 'REASON_REQUIRED'); post.status = 'TAKEN_DOWN'; }
  else if (decision === 'ARCHIVE') post.status = 'ARCHIVED';
  else post.pinned = decision === 'PIN';
  post.moderation = { byProfileId: actor.profileId, at: new Date(), note };
  pushHistory(post, actor, decision, { note });
  await post.save();
  if (['PUBLISH', 'REJECT', 'TAKE_DOWN'].includes(decision) && String(post.authorProfileId) !== String(actor.profileId)) {
    await notify({ recipientProfileIds: [String(post.authorProfileId)], type: 'SYSTEM', title: `Your post was ${decision === 'PUBLISH' ? 'published' : decision === 'REJECT' ? 'not approved' : 'taken down'}`, body: note ?? '', link: '/newsroom?tab=mine' });
  }
  return (await present([post.toObject()], await viewerContext(actor)))[0];
}

export async function feed(actor, query = {}) {
  const ctx = await viewerContext(actor);
  const filter = { ...audienceQuery(ctx) };
  const and = [];
  if (query.circleId) and.push({ circleId: assertObjectId(query.circleId) });
  if (query.kind) and.push({ kind: String(query.kind).toUpperCase() });
  if (query.tab === 'review') and.push({ status: 'PENDING_REVIEW' });
  else if (query.tab === 'mine') and.push({ authorProfileId: actor.profileId });
  else if (query.tab === 'saved') and.push({ bookmarks: actor.profileId, status: 'PUBLISHED' });
  else and.push({ status: 'PUBLISHED' });
  if (query.q) {
    const rx = new RegExp(escapeRegex(String(query.q).slice(0, 80)), 'i');
    and.push({ $or: [{ title: rx }, { body: rx }, { tags: rx }] });
  }
  const { page, pageSize, skip } = pageArgs({ ...query, pageSize: query.pageSize ?? 20 });
  const q = and.length ? { $and: [filter, ...and] } : filter;
  const rows = await CommunityPost.find(q).sort({ pinned: -1, publishedAt: -1, createdAt: -1 }).skip(skip).limit(pageSize).lean();
  // Defence in depth: the query encodes the audience rules, and each row is checked again.
  const visible = rows.filter((p) => canView(p, ctx));
  return { items: await present(visible, ctx), page, pageSize };
}

export async function getPost(actor, id) {
  const ctx = await viewerContext(actor);
  const post = await CommunityPost.findById(assertObjectId(id)).lean();
  if (!post || !canView(post, ctx)) throw new AppError('Post not found', 404);
  const [out] = await present([post], ctx);
  const comments = await CommunityComment.find({ postId: post._id, $or: [{ status: 'VISIBLE' }, ...(ctx.profileId ? [{ authorProfileId: ctx.profileId }] : []), ...(ctx.moderator ? [{ status: 'PENDING' }] : [])] }).sort({ createdAt: 1 }).limit(500).lean();
  out.comments = comments.map((c) => ({ id: String(c._id), authorName: c.authorName, body: c.body, status: c.status, createdAt: c.createdAt, isMine: String(c.authorProfileId) === ctx.profileId }));
  return out;
}

/** Public page: only PUBLIC posts, only media with PUBLIC consent. */
export async function publicFeed(query = {}) {
  const { page, pageSize, skip } = pageArgs({ ...query, pageSize: 12 });
  const rows = await CommunityPost.find({ status: 'PUBLISHED', audience: 'PUBLIC' }).sort({ pinned: -1, publishedAt: -1 }).skip(skip).limit(pageSize).lean();
  const out = await present(rows, { anonymous: true, sections: new Set(), circles: new Set() });
  return { items: out.map(({ myReaction: _m, bookmarked: _b, isMine: _i, moderationNote: _n, ...rest }) => rest), page, pageSize };
}

export async function react(actor, id, { type } = {}) {
  requireProfile(actor);
  const ctx = await viewerContext(actor);
  const post = await CommunityPost.findById(assertObjectId(id));
  if (!post || !canView(post, ctx) || post.status !== 'PUBLISHED') throw new AppError('Post not found', 404);
  const existing = post.reactions.find((r) => String(r.profileId) === String(actor.profileId));
  if (!type || (existing && existing.type === type)) post.reactions = post.reactions.filter((r) => String(r.profileId) !== String(actor.profileId));
  else if (existing) existing.type = oneOf(type, ['CLAP', 'HEART', 'CELEBRATE', 'INSPIRED'], 'type');
  else post.reactions.push({ profileId: actor.profileId, type: oneOf(type, ['CLAP', 'HEART', 'CELEBRATE', 'INSPIRED'], 'type') });
  await post.save();
  return (await present([post.toObject()], ctx))[0];
}

export async function bookmark(actor, id) {
  const ctx = await viewerContext(actor);
  const post = await CommunityPost.findById(assertObjectId(id));
  if (!post || !canView(post, ctx)) throw new AppError('Post not found', 404);
  const has = post.bookmarks.some((b) => String(b) === String(actor.profileId));
  post.bookmarks = has ? post.bookmarks.filter((b) => String(b) !== String(actor.profileId)) : [...post.bookmarks, actor.profileId];
  await post.save();
  return { bookmarked: !has };
}

export async function comment(actor, id, body = {}) {
  requireProfile(actor);
  const ctx = await viewerContext(actor);
  const post = await CommunityPost.findById(assertObjectId(id)).lean();
  if (!post || !canView(post, ctx) || post.status !== 'PUBLISHED') throw new AppError('Post not found', 404);
  if (!post.commentsEnabled) throw new AppError('Comments are closed on this post.', 409);
  // Students' comments wait for a moderator; adults' appear immediately and can be reported.
  const pending = actor.roleKey === 'STUDENT';
  const c = await CommunityComment.create({ postId: post._id, authorProfileId: actor.profileId, authorName: actor.displayName, body: requireText(body.body, 'body', { max: 2000 }), status: pending ? 'PENDING' : 'VISIBLE' });
  return { id: String(c._id), status: c.status };
}

export async function moderateComment(actor, id, { decision, reason } = {}) {
  if (!isModerator(actor)) throw new AppError('Only moderators can do this.', 403);
  const c = await CommunityComment.findById(assertObjectId(id));
  if (!c) throw new AppError('Comment not found', 404);
  const d = oneOf(decision, ['APPROVE', 'HIDE'], 'decision');
  c.status = d === 'APPROVE' ? 'VISIBLE' : 'HIDDEN';
  c.hiddenReason = d === 'HIDE' ? requireText(reason, 'reason', { max: 500 }) : null;
  await c.save();
  return dto(c);
}

export async function pendingComments(actor) {
  if (!isModerator(actor)) throw new AppError('Only moderators can do this.', 403);
  return (await CommunityComment.find({ status: 'PENDING' }).sort({ createdAt: 1 }).limit(200).lean()).map(dto);
}

export async function report(actor, body = {}) {
  requireProfile(actor);
  const r = await CommunityReport.create({
    targetType: oneOf(body.targetType, ['POST', 'COMMENT', 'CIRCLE', 'MENTOR'], 'targetType'),
    targetId: assertObjectId(body.targetId, 'targetId'),
    reason: oneOf(body.reason, ['INAPPROPRIATE', 'BULLYING', 'PRIVACY', 'CONSENT', 'SPAM', 'OTHER'], 'reason'),
    detail: optionalText(body.detail, { max: 1000 }) || null,
    reporterProfileId: actor.profileId,
  });
  // A consent report hides the media at once while it is reviewed.
  if (r.reason === 'CONSENT' && r.targetType === 'POST') await CommunityPost.updateOne({ _id: r.targetId }, { $set: { 'media.$[].hidden': true } });
  const mods = await profilesWithRoles(['PRINCIPAL', 'ADMIN']);
  await notify({ recipientProfileIds: mods.map((p) => String(p._id)), type: 'SYSTEM', title: 'Community report to review', body: r.reason, link: '/newsroom?tab=reports' });
  return { id: String(r._id), status: r.status };
}

export async function listReports(actor) {
  if (!isModerator(actor)) throw new AppError('Only moderators can do this.', 403);
  return (await CommunityReport.find({ status: 'OPEN' }).sort({ createdAt: 1 }).lean()).map(dto);
}

export async function resolveReport(actor, id, body = {}) {
  if (!isModerator(actor)) throw new AppError('Only moderators can do this.', 403);
  const r = await CommunityReport.findById(assertObjectId(id));
  if (!r) throw new AppError('Report not found', 404);
  r.status = oneOf(body.status, ['ACTIONED', 'DISMISSED', 'ESCALATED'], 'status');
  r.resolution = requireText(body.resolution, 'resolution', { max: 1000 });
  r.resolvedByProfileId = actor.profileId;
  await r.save();
  if (r.status === 'DISMISSED' && r.reason === 'CONSENT' && r.targetType === 'POST') await CommunityPost.updateOne({ _id: r.targetId }, { $set: { 'media.$[].hidden': false } });
  return dto(r);
}

// ── Event highlights ─────────────────────────────────────────────────────

/** A completed event seeds a draft story. Outcome summary only — never an attendee list. */
export async function draftFromEvent(actor, eventId) {
  const ev = await InstitutionEvent.findById(assertObjectId(eventId));
  if (!ev) throw new AppError('Event not found', 404);
  if (ev.status !== 'COMPLETED') throw new AppError('Highlights follow a completed event.', 409);
  if (ev.newsroomPostId) throw new AppError('A highlight post already exists for this event.', 409);
  const post = await createPost(actor, {
    kind: 'EVENT_HIGHLIGHT', title: ev.title, audience: 'INSTITUTION', eventId: ev._id,
    body: [ev.outcome?.summary, ...(ev.outcome?.highlights ?? []).map((h) => `• ${h}`)].filter(Boolean).join('\n\n') || ev.description || ev.title,
    tags: [ev.kind.toLowerCase()],
  });
  ev.newsroomPostId = post.id;
  await ev.save();
  return post;
}

// ── Circles ──────────────────────────────────────────────────────────────

export async function createCircle(actor, body = {}) {
  requireProfile(actor);
  const kind = oneOf(body.kind, ['CLASS', 'PROGRAMME', 'CLUB', 'PROJECT', 'INTEREST', 'CAREER', 'ALUMNI', 'PARENTS'], 'kind');
  const mayCreate = STAFF.has(actor.roleKey) || (actor.roleKey === 'ALUMNUS' && kind === 'ALUMNI');
  if (!mayCreate) throw new AppError('Ask a teacher or the institution to create a circle.', 403);
  const adultsOnly = ['ALUMNI', 'PARENTS'].includes(kind) || body.adultsOnly === true;
  const c = await Circle.create({
    name: requireText(body.name, 'name', { max: 120 }), kind, description: optionalText(body.description, { max: 2000 }) || null,
    joinPolicy: oneOf(body.joinPolicy, ['OPEN', 'APPROVAL', 'INVITE'], 'joinPolicy', 'APPROVAL'),
    allowedRoles: Array.isArray(body.allowedRoles) ? body.allowedRoles.map((r) => String(r).toUpperCase()) : [],
    adultsOnly,
    // School circles with student members always have a staff moderator.
    moderatorProfileIds: [actor.profileId],
    members: [{ profileId: actor.profileId, name: actor.displayName, roleKey: actor.roleKey, status: 'ACTIVE' }],
    createdByProfileId: actor.profileId,
  });
  return dto(c);
}

function memberCheck(circle, actor) {
  if (circle.archived) throw new AppError('This circle is archived.', 409);
  if (circle.adultsOnly && actor.roleKey === 'STUDENT') throw new AppError('This circle is for adults only.', 403, [], 'ADULTS_ONLY');
  if (circle.allowedRoles?.length && !circle.allowedRoles.includes(actor.roleKey)) throw new AppError('This circle is not open to your role.', 403);
}

export async function joinCircle(actor, id) {
  requireProfile(actor);
  const c = await Circle.findById(assertObjectId(id));
  if (!c) throw new AppError('Circle not found', 404);
  memberCheck(c, actor);
  const m = c.members.find((x) => String(x.profileId) === String(actor.profileId));
  if (m?.status === 'BLOCKED') throw new AppError('You cannot join this circle.', 403);
  if (c.joinPolicy === 'INVITE' && !m) throw new AppError('This circle is by invitation.', 403);
  const status = c.joinPolicy === 'OPEN' ? 'ACTIVE' : 'PENDING';
  if (m) m.status = m.status === 'ACTIVE' ? 'ACTIVE' : status;
  else c.members.push({ profileId: actor.profileId, name: actor.displayName, roleKey: actor.roleKey, status });
  await c.save();
  if (status === 'PENDING') await notify({ recipientProfileIds: c.moderatorProfileIds.map(String), type: 'SYSTEM', title: `Join request: ${c.name}`, body: actor.displayName ?? '', link: `/newsroom?tab=circles&id=${c._id}` });
  return { status };
}

export async function manageMember(actor, id, body = {}) {
  const c = await Circle.findById(assertObjectId(id));
  if (!c) throw new AppError('Circle not found', 404);
  if (!c.moderatorProfileIds.some((m) => String(m) === String(actor.profileId)) && !isModerator(actor)) throw new AppError('Only the circle\'s moderators can do this.', 403);
  const profileId = assertObjectId(body.profileId, 'profileId');
  const action = oneOf(body.action, ['APPROVE', 'REMOVE', 'BLOCK', 'MAKE_MODERATOR', 'INVITE'], 'action');
  let m = c.members.find((x) => String(x.profileId) === profileId);
  if (action === 'INVITE') {
    const { Profile } = await import('../../models/profile.model.js');
    const p = await Profile.findById(profileId).populate('roleId', 'key').lean();
    if (!p) throw new AppError('Person not found', 404);
    memberCheck(c, { roleKey: p.roleId?.key });
    if (!m) c.members.push({ profileId, name: p.displayName, roleKey: p.roleId?.key, status: 'ACTIVE' });
  } else {
    if (!m) throw new AppError('Not a member', 404);
    if (action === 'APPROVE') m.status = 'ACTIVE';
    if (action === 'REMOVE') m.status = 'REMOVED';
    if (action === 'BLOCK') m.status = 'BLOCKED';
    if (action === 'MAKE_MODERATOR') {
      if (m.roleKey === 'STUDENT') throw new AppError('Students cannot moderate circles.', 403);
      if (!c.moderatorProfileIds.some((x) => String(x) === profileId)) c.moderatorProfileIds.push(profileId);
    }
  }
  await c.save();
  return dto(c);
}

export async function listCircles(actor) {
  const ctx = await viewerContext(actor);
  const rows = await Circle.find({ archived: false }).sort({ name: 1 }).limit(500).lean();
  return rows
    // Students do not see adults-only circles in discovery at all.
    .filter((c) => !(c.adultsOnly && actor.roleKey === 'STUDENT'))
    .filter((c) => !c.allowedRoles?.length || c.allowedRoles.includes(actor.roleKey) || ctx.circles.has(String(c._id)))
    .map((c) => {
      const me = c.members.find((m) => String(m.profileId) === String(actor.profileId));
      const isMod = c.moderatorProfileIds.some((m) => String(m) === String(actor.profileId));
      return {
        id: String(c._id), name: c.name, kind: c.kind, description: c.description, joinPolicy: c.joinPolicy, adultsOnly: c.adultsOnly,
        memberCount: c.members.filter((m) => m.status === 'ACTIVE').length,
        myStatus: me?.status ?? null, isModerator: isMod,
        // Member lists are for members and moderators, and show names only.
        members: me?.status === 'ACTIVE' || isMod ? c.members.filter((m) => m.status === 'ACTIVE' || (isMod && m.status === 'PENDING')).map((m) => ({ profileId: String(m.profileId), name: m.name, roleKey: m.roleKey, status: m.status })) : undefined,
      };
    });
}

// ── Media consent ────────────────────────────────────────────────────────

/** A parent sets consent for a linked child; in a college an adult student sets their own. */
export async function setConsent(actor, body = {}) {
  requireProfile(actor);
  const studentId = assertObjectId(body.studentId, 'studentId');
  const level = oneOf(body.level, ['NONE', 'INTERNAL', 'PUBLIC'], 'level');
  let allowed = false;
  if (actor.roleKey === 'PARENT') allowed = (await getGuardianStudentIds(actor.profileId)).includes(studentId);
  else if (actor.roleKey === 'STUDENT') {
    const inst = await InstitutionProfile.findOne({}).select('institutionType').lean();
    allowed = inst?.institutionType === 'COLLEGE' && (await getOwnStudentId(actor.profileId)) === studentId;
  } else if (isModerator(actor)) {
    // Staff recording a paper consent form must cite it.
    requireText(body.evidence, 'evidence (signed form reference)', { max: 300 });
    allowed = true;
  }
  if (!allowed) throw new AppError('You cannot set consent for this student.', 403);
  await MediaConsent.updateMany({ studentId, withdrawnAt: null }, { $set: { withdrawnAt: new Date() } });
  const row = await MediaConsent.create({ studentId, level, grantedByProfileId: actor.profileId, grantedByRole: actor.roleKey });
  return dto(row);
}

export async function myConsents(actor) {
  requireProfile(actor);
  const ids = actor.roleKey === 'PARENT' ? await getGuardianStudentIds(actor.profileId) : [await getOwnStudentId(actor.profileId)].filter(Boolean);
  const { Student } = await import('../../models/student.model.js');
  const students = await Student.find({ _id: { $in: ids } }).select('firstName lastName').lean();
  const levels = await consentLevels(ids);
  return students.map((s) => ({ studentId: String(s._id), name: `${s.firstName} ${s.lastName ?? ''}`.trim(), level: levels.get(String(s._id)) ?? 'NONE' }));
}

// ── Mentoring ────────────────────────────────────────────────────────────

export async function upsertMentorProfile(actor, body = {}) {
  requireProfile(actor);
  const kind = actor.roleKey === 'ALUMNUS' ? 'ALUMNUS' : actor.roleKey === 'STUDENT' ? 'SENIOR_STUDENT' : 'STAFF';
  const doc = await MentorProfile.findOneAndUpdate(
    { profileId: actor.profileId },
    {
      $set: {
        name: actor.displayName, kind, batch: optionalText(body.batch, { max: 40 }) || null, headline: optionalText(body.headline, { max: 200 }) || null,
        topics: Array.isArray(body.topics) ? body.topics.map((t) => String(t).slice(0, 40)).slice(0, 15) : [],
        availability: optionalText(body.availability, { max: 200 }) || null, optedIn: body.optedIn !== false, adult: kind !== 'SENIOR_STUDENT',
      },
      $setOnInsert: { verifiedAffiliation: kind === 'STAFF' },
    },
    { upsert: true, new: true },
  ).lean();
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
  const r = await MentorshipRequest.create({ mentorProfileId: mentor.profileId, menteeProfileId: actor.profileId, topic: requireText(body.topic, 'topic', { max: 120 }), message: optionalText(body.message, { max: 1000 }) || null, supervised });
  await notify({ recipientProfileIds: [String(mentor.profileId)], type: 'SYSTEM', title: 'New mentoring request', body: r.topic, link: '/mentoring' });
  if (supervised) {
    const staff = await profilesWithRoles(['PRINCIPAL', 'ADMIN']);
    await notify({ recipientProfileIds: staff.map((p) => String(p._id)), type: 'SYSTEM', title: 'Supervised mentoring request needs a supervisor', body: r.topic, link: '/mentoring' });
  }
  return dto(r);
}

export async function respondMentoring(actor, id, body = {}) {
  const r = await MentorshipRequest.findById(assertObjectId(id));
  if (!r) throw new AppError('Request not found', 404);
  const isMentor = String(r.mentorProfileId) === String(actor.profileId);
  const action = oneOf(body.action, ['ACCEPT', 'DECLINE', 'ASSIGN_SUPERVISOR', 'SCHEDULE', 'COMPLETE', 'CANCEL'], 'action');
  if (action === 'ASSIGN_SUPERVISOR') {
    if (!isModerator(actor)) throw new AppError('Only staff assign a supervisor.', 403);
    r.supervisorProfileId = actor.profileId;
  } else if (action === 'SCHEDULE') {
    if (r.supervised && !r.supervisorProfileId) throw new AppError('A staff supervisor must be assigned before a session with a student is scheduled.', 409, [], 'SUPERVISOR_REQUIRED');
    if (!isMentor && String(r.supervisorProfileId) !== String(actor.profileId)) throw new AppError('Not allowed', 403);
    r.sessions.push({ at: new Date(body.at), mode: oneOf(body.mode, ['GROUP_ONLINE', 'GROUP_ON_CAMPUS', 'ONE_TO_ONE_SUPERVISED', 'ONE_TO_ONE'], 'mode'), link: optionalText(body.link, { max: 500 }) || null });
    if (r.supervised && body.mode === 'ONE_TO_ONE') throw new AppError('Sessions with students must be group or supervised.', 409, [], 'SUPERVISION_REQUIRED');
    r.status = 'SCHEDULED';
  } else if (action === 'ACCEPT' || action === 'DECLINE') {
    if (!isMentor) throw new AppError('Only the mentor can respond.', 403);
    r.status = action === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED';
  } else if (action === 'COMPLETE') {
    r.status = 'COMPLETED';
    if (body.feedback) r.sessions.at(-1).feedback = String(body.feedback).slice(0, 1000);
  } else r.status = 'CANCELLED';
  await r.save();
  return dto(r);
}

export async function myMentoring(actor) {
  requireProfile(actor);
  const filter = isModerator(actor) ? { $or: [{ supervised: true }, { mentorProfileId: actor.profileId }, { menteeProfileId: actor.profileId }] } : { $or: [{ mentorProfileId: actor.profileId }, { menteeProfileId: actor.profileId }] };
  return (await MentorshipRequest.find(filter).sort({ createdAt: -1 }).limit(200).lean()).map(dto);
}
