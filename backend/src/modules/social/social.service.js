import { SocialAccount, SocialPost, SocialOutbox, NETWORKS } from '../../models/social.model.js';
import { CommunityPost, MediaConsent } from '../../models/community.model.js';
import { Student } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { requireProfile, assertObjectId, pushHistory, requireText, oneOf, dto } from '../ops/common.js';
// Live posting through each network's official API once the school connects an account (modules/integrations).
import { publishTo, limitProblems } from '../integrations/social.publishers.js';
import { IntegrationConnection } from '../../models/integration.model.js';
import { NETWORK_PROVIDER, appConfigured } from '../integrations/providers.js';

/**
 * External social publishing for the newsroom.
 *
 * Staff only: a parent, student or alumnus is refused here whatever their role
 * was configured to hold. Each chosen network is one outbox row keyed by
 * post + network; a row that reached SENT or SIMULATED is never attempted
 * again, so a retry cannot double-post. Every child tagged in a post needs
 * PUBLIC media consent, checked when the post is composed and again at the
 * moment of publishing.
 *
 * Each network posts through its official API once the school connects the
 * account (modules/integrations). Without that the outcome is SIMULATED
 * ("Simulated — not posted"); nothing claims to have been posted.
 */

const FAMILY_ROLES = new Set(['STUDENT', 'PARENT', 'ALUMNUS']);
export const NETWORK_LABELS = { FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', X: 'X', LINKEDIN: 'LinkedIn', YOUTUBE: 'YouTube community' };
export const SIMULATED_NOTE = 'Simulated — not posted';
const DONE = new Set(['SENT', 'SIMULATED', 'NOT_SUPPORTED']);

/** Refuses anyone who is not school staff holding `key`, regardless of how their role is set up. */
export function assertStaff(actor, key = 'social.publish') {
  requireProfile(actor);
  if (!actor.roleKey || FAMILY_ROLES.has(actor.roleKey) || actor.roleKey === 'TRUSTEE') {
    throw new AppError('Only school staff can publish to the school\'s social accounts.', 403, [], 'FAMILY_CANNOT_PUBLISH');
  }
  if (!actor.permissions?.[key]) throw new AppError(`Missing permission: ${key}`, 403);
}

// ── adapters ───────────────────────────────────────────────────────────

/**
 * The per-network adapter: live posting through each network's official API
 * once the school has connected its account by OAuth (Social page). Without
 * the provider app configured or the account connected it records the honest
 * outcome, SIMULATED. YouTube community posts have no API: NOT_SUPPORTED.
 * Returns `{ status: 'SENT'|'FAILED'|'SIMULATED'|'NOT_SUPPORTED', reason?, providerPostId?, permalink?, sentText? }`.
 */
async function defaultAdapter(network, post = {}) {
  // The school's OAuth connection decides (integrations/social.publishers.js): SIMULATED without one.
  return publishTo(network, post);
}
let adapter = defaultAdapter;
export function setSocialAdapterForTests(fn) { adapter = fn ?? defaultAdapter; }

// ── consent ────────────────────────────────────────────────────────────

/** Children among `studentIds` without current PUBLIC media consent. */
export async function missingConsent(studentIds) {
  const ids = [...new Set((studentIds ?? []).map(String))];
  if (!ids.length) return [];
  const rows = await MediaConsent.find({ studentId: { $in: ids }, withdrawnAt: null }).sort({ at: -1 }).lean();
  const level = new Map();
  for (const r of rows) if (!level.has(String(r.studentId))) level.set(String(r.studentId), r.level);
  const missing = ids.filter((id) => level.get(id) !== 'PUBLIC');
  if (!missing.length) return [];
  const students = await Student.find({ _id: { $in: missing } }).select('firstName lastName').lean();
  return missing.map((id) => { const s = students.find((x) => String(x._id) === id); return { studentId: id, name: s ? [s.firstName, s.lastName].filter(Boolean).join(' ') : 'A student' }; });
}

function refuseMissing(missing) {
  throw new AppError(
    `${missing.length === 1 ? `${missing[0].name} does` : `${missing.length} children do`} not have consent for public media. Remove them from the post or record consent first.`,
    409, missing.map((m) => m.name), 'CONSENT_MISSING',
  );
}

// ── posts ─────────────────────────────────────────────────────────────

function cleanNetworks(list) {
  if (!Array.isArray(list) || !list.length) throw new AppError('Choose at least one network', 400, [], 'NO_NETWORKS');
  const out = [...new Set(list.map((n) => String(n).toUpperCase()))];
  const bad = out.filter((n) => !NETWORKS.includes(n));
  if (bad.length) throw new AppError(`Unknown network: ${bad.join(', ')}`, 400, [], 'BAD_NETWORK');
  return out;
}

/** Whether this school has a live (OAuth) connection that posts to `network`. */
async function liveFor(network) {
  const provider = NETWORK_PROVIDER[network];
  if (!provider || !appConfigured(provider)) return false;
  return Boolean(await IntegrationConnection.exists({ provider, status: 'CONNECTED', purposes: 'social' }));
}

function cleanImage(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\/uploads\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(s)) return s;
  return cleanUrl(s);
}

function cleanUrl(value) {
  if (!value) return null;
  let u;
  try { u = new URL(String(value).trim()); } catch { throw new AppError('link must be a full https:// address', 400, [], 'BAD_LINK'); }
  if (u.protocol !== 'https:' || u.username || u.password) throw new AppError('link must be a full https:// address', 400, [], 'BAD_LINK');
  return u.toString();
}

async function present(post) {
  const rows = await SocialOutbox.find({ socialPostId: post._id }).lean();
  const p = dto(post);
  return {
    ...p,
    studentIds: (post.studentIds ?? []).map(String),
    outbox: NETWORKS.filter((n) => (post.networks ?? []).includes(n)).map((n) => {
      const r = rows.find((x) => x.network === n);
      return {
        network: n, label: NETWORK_LABELS[n], status: r?.status ?? 'QUEUED', statusReason: r?.statusReason ?? null, attempts: r?.attempts ?? 0, lastAttemptAt: r?.lastAttemptAt ?? null,
        display: r?.status === 'SIMULATED' ? SIMULATED_NOTE : r?.status === 'SENT' ? 'Posted' : r?.status === 'FAILED' ? 'Failed — can be retried' : r?.status === 'SENDING' ? 'Sending' : r?.status === 'NOT_SUPPORTED' ? 'Not supported by this network' : 'Queued',
        providerPostId: r?.providerPostId ?? null, permalink: r?.permalink ?? null, sentText: r?.sentText ?? null,
        engagement: r?.engagement?.at ? r.engagement : null,
      };
    }),
  };
}

async function ensureRows(post) {
  for (const network of post.networks) {
    // eslint-disable-next-line no-await-in-loop
    await SocialOutbox.updateOne(
      { idempotencyKey: `${post._id}:${network}` },
      { $setOnInsert: { socialPostId: post._id, network, idempotencyKey: `${post._id}:${network}`, status: 'QUEUED', statusHistory: [{ status: 'QUEUED', at: new Date() }] } },
      { upsert: true },
    );
  }
}

export async function compose(actor, body = {}) {
  assertStaff(actor);
  const networks = cleanNetworks(body.networks);
  let text = typeof body.text === 'string' ? body.text.trim() : '';
  const studentIds = new Set((Array.isArray(body.studentIds) ? body.studentIds : []).map((id) => assertObjectId(id, 'studentId')));
  let communityPostId = null;
  if (body.communityPostId) {
    const story = await CommunityPost.findById(assertObjectId(body.communityPostId, 'communityPostId')).lean();
    if (!story) throw new AppError('Newsroom story not found', 404);
    if (story.status !== 'PUBLISHED' || story.audience !== 'PUBLIC') throw new AppError('Only a published, public newsroom story can be shared outside the school.', 409, [], 'NOT_PUBLIC');
    communityPostId = story._id;
    for (const m of story.media ?? []) for (const s of m.studentIds ?? []) studentIds.add(String(s));
    if (!text) text = [story.title, story.body].filter(Boolean).join(' — ').slice(0, 2000);
  }
  text = requireText(text, 'text', { max: 2000 });
  // Each network's limits, for the person's own words (a shared story is shortened to fit instead).
  if (!communityPostId) {
    const problems = limitProblems(networks, { text, link: body.link ? cleanUrl(body.link) : null });
    if (problems.length) throw new AppError(problems[0].message, 400, problems.map((p) => p.message), problems[0].code);
  }
  let imageUrl = cleanImage(body.imageUrl);
  if (!imageUrl && communityPostId) {
    const story = await CommunityPost.findById(communityPostId).select('media').lean();
    imageUrl = (story?.media ?? []).find((m) => m.kind === 'IMAGE' && !m.hidden)?.url ?? null;
  }
  const known = await Student.countDocuments({ _id: { $in: [...studentIds] } });
  if (known !== studentIds.size) throw new AppError('A tagged student is not in this school', 404, [], 'UNKNOWN_STUDENT');
  if (!studentIds.size && body.noIdentifiableStudents !== true) {
    throw new AppError('Tag every child who appears, or confirm that no child can be identified in this post.', 400, [], 'TAG_OR_CONFIRM');
  }
  const missing = await missingConsent([...studentIds]);
  if (missing.length) refuseMissing(missing);
  const post = await SocialPost.create({
    communityPostId, text, link: cleanUrl(body.link), imageUrl, networks, studentIds: [...studentIds], noIdentifiableStudents: !studentIds.size,
    createdByProfileId: actor.profileId, createdByName: actor.displayName ?? null,
  });
  pushHistory(post, actor, 'COMPOSED', { note: networks.map((n) => NETWORK_LABELS[n]).join(', ') });
  await post.save();
  await ensureRows(post);
  return present(post);
}

/**
 * Publishes (or retries) every network row that has not been delivered.
 * Consent is re-checked first; a missing consent blocks the whole post.
 */
export async function publish(actor, id) {
  assertStaff(actor);
  const post = await SocialPost.findById(assertObjectId(id));
  if (!post) throw new AppError('Post not found', 404);
  const missing = await missingConsent(post.studentIds);
  if (missing.length) {
    post.status = 'BLOCKED';
    post.blockedReason = 'Consent missing at the moment of publishing';
    pushHistory(post, actor, 'BLOCKED', { note: missing.map((m) => m.name).join(', ') });
    await post.save();
    refuseMissing(missing);
  }
  await ensureRows(post);
  post.status = 'PUBLISHING';
  post.blockedReason = null;
  pushHistory(post, actor, 'PUBLISH_REQUESTED');
  await post.save();

  for (const network of post.networks) {
    const now = new Date();
    // Atomic claim: only a row still QUEUED or FAILED is attempted, by exactly one caller.
    // eslint-disable-next-line no-await-in-loop
    const row = await SocialOutbox.findOneAndUpdate(
      { idempotencyKey: `${post._id}:${network}`, status: { $in: ['QUEUED', 'FAILED'] } },
      { $set: { status: 'SENDING', lastAttemptAt: now }, $inc: { attempts: 1 }, $push: { statusHistory: { status: 'SENDING', at: now } } },
      { new: true },
    );
    if (!row) continue;
    let out;
    try {
      // eslint-disable-next-line no-await-in-loop
      out = await adapter(network, { text: post.text, link: post.link, imageUrl: post.imageUrl, shortenable: Boolean(post.communityPostId), idempotencyKey: row.idempotencyKey });
    } catch (err) {
      out = { status: 'FAILED', reason: String(err?.message ?? err).slice(0, 300) };
    }
    const status = ['SENT', 'FAILED', 'SIMULATED', 'NOT_SUPPORTED'].includes(out?.status) ? out.status : 'FAILED';
    if (status === 'SIMULATED') logger.info(`[Social SIMULATION] ${network}: ${post.text.slice(0, 120)}`);
    // eslint-disable-next-line no-await-in-loop
    await SocialOutbox.updateOne({ _id: row._id, status: 'SENDING' }, {
      $set: { status, statusReason: out?.reason ?? null, providerPostId: out?.providerPostId ?? null, permalink: out?.permalink ?? null, sentText: out?.sentText ?? null },
      $push: { statusHistory: { status, at: new Date(), detail: out?.reason ?? undefined } },
    });
  }
  const rows = await SocialOutbox.find({ socialPostId: post._id }).select('status').lean();
  post.status = rows.every((r) => DONE.has(r.status)) ? 'DONE' : 'PUBLISHING';
  await post.save();
  return present(post);
}

export async function listPosts(actor) {
  assertStaff(actor);
  const posts = await SocialPost.find({}).sort({ createdAt: -1 }).limit(100);
  return Promise.all(posts.map(present));
}

export async function getPost(actor, id) {
  assertStaff(actor);
  const post = await SocialPost.findById(assertObjectId(id));
  if (!post) throw new AppError('Post not found', 404);
  return present(post);
}

/** Public newsroom stories that may be shared, for the composer. */
export async function shareableStories(actor) {
  assertStaff(actor);
  const rows = await CommunityPost.find({ status: 'PUBLISHED', audience: 'PUBLIC' }).sort({ publishedAt: -1 }).limit(30).select('title body publishedAt media').lean();
  return rows.map((p) => ({ id: String(p._id), title: p.title, excerpt: String(p.body ?? '').slice(0, 160), publishedAt: p.publishedAt, taggedStudents: [...new Set((p.media ?? []).flatMap((m) => (m.studentIds ?? []).map(String)))].length }));
}

// ── accounts ──────────────────────────────────────────────────────────

const accountDto = (a) => ({ id: String(a._id), network: a.network, label: NETWORK_LABELS[a.network], handle: a.handle, status: a.status, statusNote: a.statusNote, createdAt: a.createdAt });

export async function listAccounts(actor) {
  requireProfile(actor);
  if (!actor.permissions?.['social.publish'] && !actor.permissions?.['social.connect']) throw new AppError('Missing permission: social.publish', 403);
  assertStaff(actor, actor.permissions['social.connect'] ? 'social.connect' : 'social.publish');
  const rows = await SocialAccount.find({}).sort({ network: 1 }).lean();
  const live = await Promise.all(NETWORKS.map((n) => liveFor(n)));
  return {
    accounts: rows.map(accountDto),
    networks: NETWORKS.map((n, i) => ({
      key: n, label: NETWORK_LABELS[n], credentials: live[i] ? 'configured' : 'not configured',
      provider: NETWORK_PROVIDER[n], mode: live[i] ? 'LIVE' : 'SIMULATED',
      ...(n === 'YOUTUBE' ? { note: 'YouTube has no API for community posts: with a connected Google account the outcome is "Not supported", never a fake post.' } : {}),
    })),
  };
}

/**
 * Records the school's account on a network. Tokens are never accepted here:
 * the official OAuth connection is not built, so the account waits as
 * "connection pending: needs provider credentials".
 */
export async function connectAccount(actor, body = {}) {
  assertStaff(actor, 'social.connect');
  const network = oneOf(body.network, NETWORKS, 'network');
  const handle = requireText(String(body.handle ?? '').replace(/^@/, ''), 'handle', { max: 100 });
  if (!/^[\w.-]+$/.test(handle)) throw new AppError('handle may contain letters, numbers, dots, dashes and underscores', 400);
  const found = await SocialAccount.findOne({ network, handle });
  const a = found ?? new SocialAccount({ network, handle, connectedByProfileId: actor.profileId });
  a.status = 'CONNECTION_PENDING';
  a.statusNote = 'Connection pending: needs provider credentials';
  pushHistory(a, actor, found ? 'RECONNECT_REQUESTED' : 'RECORDED');
  await a.save();
  return accountDto(a);
}

export async function disconnectAccount(actor, id) {
  assertStaff(actor, 'social.connect');
  const a = await SocialAccount.findById(assertObjectId(id)).select('+credentialEnc');
  if (!a) throw new AppError('Account not found', 404);
  a.status = 'DISCONNECTED';
  a.statusNote = 'Disconnected';
  a.credentialEnc = null;
  pushHistory(a, actor, 'DISCONNECTED');
  await a.save();
  return accountDto(a);
}
