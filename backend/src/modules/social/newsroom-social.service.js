import { SocialAccount, SocialPost, SocialOutbox, NETWORKS } from '../../models/social.model.js';
import { CommunityPost } from '../../models/community.model.js';
import { AppError } from '../../utils/AppError.js';
import { featureEnabled } from '../../utils/features.js';
import { assertObjectId, requireProfile } from '../ops/common.js';
import * as social from './social.service.js';

/**
 * "Also post to social media" from the newsroom.
 *
 * The newsroom composer and each published story offer the school's social
 * networks to staff holding social.publish. Publishing goes through the
 * social module itself (compose, then publish), so its rules apply unchanged:
 * staff only, every pictured child's PUBLIC consent checked when composed and
 * again at the moment of publishing, one outbox row per network that is never
 * delivered twice, and SIMULATED without provider credentials.
 *
 * Parents, students and alumni never see the option and are refused here.
 * When the school has the feature switched off, an administrator is told where
 * to switch it on; nobody else is offered anything.
 */

const FAMILY = new Set(['PARENT', 'STUDENT', 'ALUMNUS', 'TRUSTEE']);
const SWITCH_HINT = 'Social publishing is switched off for this school. An administrator can switch it on under Tenant Settings → Features ("Publish to the school\'s social media accounts").';

/** What the newsroom composer may offer this person. Never throws for a signed-in user. */
export async function options(actor) {
  requireProfile(actor);
  const staff = actor.roleKey && !FAMILY.has(actor.roleKey);
  const canPublish = Boolean(staff && actor.permissions?.['social.publish']);
  const canSwitch = Boolean(staff && actor.permissions?.['settings.manage']);
  const enabled = await featureEnabled('socialPublishing');
  if (!canPublish && !canSwitch) return { available: false, enabled, canPublish: false };
  if (!enabled) return { available: false, enabled: false, canPublish, canSwitch, hint: canSwitch ? SWITCH_HINT : null };
  if (!canPublish) return { available: false, enabled: true, canPublish: false };
  const [accounts, creds] = await Promise.all([
    SocialAccount.find({ status: { $ne: 'DISCONNECTED' } }).select('network handle status').lean(),
    social.listAccounts(actor).then((r) => r.networks).catch(() => []),
  ]);
  const networks = NETWORKS.map((n) => {
    const account = accounts.find((a) => a.network === n) ?? null;
    const credentials = creds.find((c) => c.key === n)?.credentials === 'configured';
    let state = 'NOT_CONNECTED';
    if (account) state = credentials ? 'CONNECTED' : 'SIMULATED';
    return {
      key: n, label: social.NETWORK_LABELS[n], state, handle: account?.handle ?? null,
      note: state === 'CONNECTED' ? 'Credentials configured' : state === 'SIMULATED' ? `@${account.handle} recorded; no provider credentials, so posts are simulated` : 'No account recorded; posts are simulated',
    };
  });
  return {
    available: true, enabled: true, canPublish: true, canConnect: Boolean(actor.permissions?.['social.connect']),
    networks, simulatedNote: social.SIMULATED_NOTE,
    rules: 'Only a published story whose audience is Public can be shared. Every pictured child needs public media consent, checked again at the moment of posting.',
  };
}

async function assertEnabled() {
  if (!(await featureEnabled('socialPublishing'))) throw new AppError(SWITCH_HINT, 403, [], 'FEATURE_OFF');
}

/**
 * Shares a published, public newsroom story to the chosen networks, then
 * publishes at once. Sharing the same story again reuses its social post for
 * the networks it already has (no second delivery) and adds any new ones as a
 * separate post.
 */
export async function shareStory(actor, postId, body = {}) {
  social.assertStaff(actor);
  await assertEnabled();
  const id = assertObjectId(postId, 'postId');
  const story = await CommunityPost.findById(id).select('status audience media').lean();
  if (!story) throw new AppError('Newsroom story not found', 404);
  if (story.status !== 'PUBLISHED') throw new AppError('The story goes to social media once it is published. It is waiting for review now; share it from the story when it is live.', 409, [], 'NOT_PUBLISHED');
  if (story.audience !== 'PUBLIC') throw new AppError('Only a story whose audience is "Public (anyone)" can be shared outside the school.', 409, [], 'NOT_PUBLIC');
  const wanted = [...new Set((Array.isArray(body.networks) ? body.networks : []).map((n) => String(n).toUpperCase()))];
  if (!wanted.length) throw new AppError('Choose at least one network', 400, [], 'NO_NETWORKS');

  const earlier = await SocialPost.find({ communityPostId: id }).select('networks').lean();
  const already = new Set(earlier.flatMap((p) => p.networks));
  const fresh = wanted.filter((n) => !already.has(n));
  // The author already answered "who is in it" for every photo when the story was written:
  // tagged children carry over (and need public consent); a story whose every photo says
  // "no student can be identified" (or that has no photos) needs no further statement.
  const media = story.media ?? [];
  const noIdentifiableStudents = media.every((m) => (m.studentIds ?? []).length === 0 && (m.noIdentifiableStudents === true || m.kind === 'DOCUMENT'));
  if (fresh.length) {
    const composed = await social.compose(actor, { communityPostId: String(id), networks: fresh, link: body.link || undefined, noIdentifiableStudents });
    await social.publish(actor, composed.id);
  }
  // Networks shared before: retry only rows that failed (publish never re-sends a delivered row).
  for (const p of earlier) {
    if (p.networks.some((n) => wanted.includes(n))) {
      // eslint-disable-next-line no-await-in-loop
      await social.publish(actor, String(p._id));
    }
  }
  return storyStatus(actor, id);
}

/** Per-network status of the social posts made from one story. */
export async function storyStatus(actor, postId) {
  social.assertStaff(actor);
  const posts = await SocialPost.find({ communityPostId: assertObjectId(postId, 'postId') }).sort({ createdAt: 1 }).lean();
  return { postId: String(postId), networks: await networkRows(posts) };
}

async function networkRows(posts) {
  if (!posts.length) return [];
  const rows = await SocialOutbox.find({ socialPostId: { $in: posts.map((p) => p._id) } }).lean();
  const out = [];
  for (const p of posts) {
    for (const n of p.networks) {
      const r = rows.find((x) => String(x.socialPostId) === String(p._id) && x.network === n);
      const status = p.status === 'BLOCKED' && (!r || r.status === 'QUEUED') ? 'BLOCKED' : r?.status ?? 'QUEUED';
      out.push({
        network: n, label: social.NETWORK_LABELS[n], status, socialPostId: String(p._id),
        display: status === 'SIMULATED' ? social.SIMULATED_NOTE : status === 'SENT' ? 'Posted' : status === 'FAILED' ? 'Failed — can be retried' : status === 'BLOCKED' ? `Blocked: ${p.blockedReason ?? 'consent missing'}` : status === 'SENDING' ? 'Sending' : 'Queued',
        reason: r?.statusReason ?? null, at: r?.lastAttemptAt ?? null,
      });
    }
  }
  return out;
}

/** Statuses for many stories at once, for the newsroom feed (staff with social.publish only). */
export async function statusesFor(actor, ids = []) {
  social.assertStaff(actor);
  const clean = [...new Set((Array.isArray(ids) ? ids : String(ids ?? '').split(',')).map((x) => String(x).trim()).filter((x) => /^[a-f0-9]{24}$/i.test(x)))].slice(0, 100);
  if (!clean.length) return {};
  const posts = await SocialPost.find({ communityPostId: { $in: clean } }).sort({ createdAt: 1 }).lean();
  const out = {};
  for (const id of clean) {
    const mine = posts.filter((p) => String(p.communityPostId) === id);
    // eslint-disable-next-line no-await-in-loop
    if (mine.length) out[id] = await networkRows(mine);
  }
  return out;
}
