import { Notification } from '../../models/notification.model.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';

const MAX_LIMIT = 100;

/**
 * Fan-out helper used by other modules — not exposed as a public endpoint.
 *
 * Deliberately never throws: a notification is a side effect of some real
 * action (publishing marks, posting an announcement), and a failure to notify
 * must not roll back or 500 the action the user actually asked for. Failures
 * are logged instead.
 */
export async function notify({ recipientProfileIds = [], type = 'SYSTEM', title, body, link, meta }) {
  try {
    const unique = [...new Set(recipientProfileIds.filter(Boolean).map(String))];
    if (!unique.length || !title) return { created: 0 };

    const docs = unique.map((recipientProfileId) => ({
      recipientProfileId, type, title, body, link, meta,
    }));
    await Notification.insertMany(docs, { ordered: false });
    return { created: docs.length };
  } catch (err) {
    logger.error(`Notification fan-out failed (${type}): ${err.message}`);
    return { created: 0, failed: true };
  }
}

/** Inbox for the caller. Always scoped to their own profile — never parameterised. */
export async function list(actor, { unreadOnly, limit = 20, before } = {}) {
  if (!actor?.profileId) throw new AppError('Select a profile first', 403);

  const filter = { recipientProfileId: actor.profileId };
  if (unreadOnly === true || unreadOnly === 'true') filter.readAt = null;
  if (before) filter.createdAt = { $lt: new Date(before) };

  const capped = Math.min(Number(limit) || 20, MAX_LIMIT);
  const items = await Notification.find(filter)
    .sort({ createdAt: -1 })
    .limit(capped + 1)
    .lean();

  const hasMore = items.length > capped;
  const page = hasMore ? items.slice(0, capped) : items;

  return {
    items: page,
    nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
    unreadCount: await unreadCount(actor),
  };
}

export async function unreadCount(actor) {
  if (!actor?.profileId) return 0;
  return Notification.countDocuments({ recipientProfileId: actor.profileId, readAt: null });
}

/**
 * Marks notifications read. The recipient is pinned to the caller in the
 * filter, so passing someone else's notification id silently matches nothing
 * rather than mutating their inbox.
 */
export async function markRead(actor, ids) {
  if (!actor?.profileId) throw new AppError('Select a profile first', 403);
  if (!Array.isArray(ids) || !ids.length) throw new AppError('ids must be a non-empty array', 400);

  const result = await Notification.updateMany(
    { _id: { $in: ids }, recipientProfileId: actor.profileId, readAt: null },
    { $set: { readAt: new Date() } }
  );
  return { updated: result.modifiedCount, unreadCount: await unreadCount(actor) };
}

export async function markAllRead(actor) {
  if (!actor?.profileId) throw new AppError('Select a profile first', 403);
  const result = await Notification.updateMany(
    { recipientProfileId: actor.profileId, readAt: null },
    { $set: { readAt: new Date() } }
  );
  return { updated: result.modifiedCount, unreadCount: 0 };
}
