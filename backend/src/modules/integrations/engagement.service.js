import { SocialOutbox } from '../../models/social.model.js';
import { AppError } from '../../utils/AppError.js';
import { ProviderError } from './http.js';
import { engagementOf } from './social.publishers.js';
import { assertStaff } from '../social/social.service.js';
import { assertObjectId } from '../ops/common.js';

/**
 * Engagement (likes, comments, shares) read back from each network for posts
 * that were really sent. Posts from the last 30 days, at most every six
 * hours each; a simulated post has no engagement and is never asked about.
 */
const STALE_MS = 6 * 3600_000;
const WINDOW_MS = 30 * 86_400_000;

async function refreshRow(row) {
  try {
    const e = await engagementOf(row.network, row.providerPostId);
    if (!e) return false;
    await SocialOutbox.updateOne({ _id: row._id }, {
      $set: {
        engagement: { likes: e.likes ?? null, comments: e.comments ?? null, shares: e.shares ?? null, impressions: e.impressions ?? null, at: new Date(), error: null },
        ...(e.permalink && !row.permalink ? { permalink: e.permalink } : {}),
      },
    });
    return true;
  } catch (err) {
    await SocialOutbox.updateOne({ _id: row._id }, { $set: { 'engagement.at': new Date(), 'engagement.error': (err instanceof ProviderError ? err.message : 'Could not be read').slice(0, 300) } });
    return false;
  }
}

/** The scheduled job: sent posts whose figures are older than six hours. */
export async function refreshDue({ now = new Date() } = {}) {
  const rows = await SocialOutbox.find({
    status: 'SENT', providerPostId: { $ne: null }, lastAttemptAt: { $gte: new Date(now.getTime() - WINDOW_MS) },
    $or: [{ 'engagement.at': null }, { 'engagement.at': { $lt: new Date(now.getTime() - STALE_MS) } }],
  }).limit(100).lean();
  let updated = 0;
  for (const r of rows) {
    // eslint-disable-next-line no-await-in-loop
    if (await refreshRow(r)) updated += 1;
  }
  return { checked: rows.length, updated };
}

/** "Refresh engagement" for one social post, by a member of staff who publishes. */
export async function refreshPost(actor, socialPostId) {
  assertStaff(actor);
  const rows = await SocialOutbox.find({ socialPostId: assertObjectId(socialPostId), status: 'SENT', providerPostId: { $ne: null } }).lean();
  if (!rows.length) throw new AppError('Nothing was posted for real, so there is no engagement to read (simulated posts have none).', 409, [], 'NOTHING_SENT');
  let updated = 0;
  for (const r of rows) {
    // eslint-disable-next-line no-await-in-loop
    if (await refreshRow(r)) updated += 1;
  }
  const fresh = await SocialOutbox.find({ socialPostId: rows[0].socialPostId }).select('network status permalink engagement').lean();
  return { updated, networks: fresh.map((f) => ({ network: f.network, status: f.status, permalink: f.permalink ?? null, engagement: f.engagement?.at ? f.engagement : null })) };
}
