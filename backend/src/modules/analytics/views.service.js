import { AnalyticsView } from '../../models/analyticsView.model.js';
import { AppError } from '../../utils/AppError.js';
import { requireProfile, assertObjectId } from '../ops/common.js';

/**
 * Saved analytics views, per person and per school. A person only ever lists,
 * saves or forgets their own; at most MAX views each (the oldest is not
 * dropped silently: saving one more is refused with a clear message).
 */
export const MAX_VIEWS = 20;
const FILTER_KEYS = ['preset', 'from', 'to', 'compare', 'compareFrom', 'compareTo', 'department'];
const short = (v, max = 40) => (v === undefined || v === null || v === '' ? null : String(v).slice(0, max));

function clean(body = {}) {
  const name = String(body.name ?? '').trim().slice(0, 60);
  if (!name) throw new AppError('Name the view.', 400);
  const f = body.filters ?? body.q ?? {};
  if (typeof f !== 'object' || Array.isArray(f)) throw new AppError('filters must be an object', 400);
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, short(f[k])]));
  const metricKeys = Array.isArray(body.metricKeys) ? [...new Set(body.metricKeys.map((k) => String(k).slice(0, 80)))].slice(0, 30) : [];
  return { name, filters, tab: short(body.tab), focus: short(body.focus, 80), metricKeys };
}

const view = (v) => ({ id: String(v._id), name: v.name, filters: v.filters, tab: v.tab, focus: v.focus, metricKeys: v.metricKeys ?? [], updatedAt: v.updatedAt });

export async function list(actor) {
  requireProfile(actor);
  const rows = await AnalyticsView.find({ profileId: actor.profileId }).sort({ updatedAt: -1 }).limit(MAX_VIEWS).lean();
  return { items: rows.map(view) };
}

/** Saves a view by name (saving the same name again replaces it). */
export async function save(actor, body = {}) {
  requireProfile(actor);
  const data = clean(body);
  const exists = await AnalyticsView.exists({ profileId: actor.profileId, name: data.name });
  if (!exists && (await AnalyticsView.countDocuments({ profileId: actor.profileId })) >= MAX_VIEWS) {
    throw new AppError(`You can keep ${MAX_VIEWS} saved views. Forget one first.`, 409, [], 'TOO_MANY_VIEWS');
  }
  const row = await AnalyticsView.findOneAndUpdate({ profileId: actor.profileId, name: data.name }, { $set: data }, { upsert: true, new: true }).lean();
  return view(row);
}

export async function remove(actor, id) {
  requireProfile(actor);
  const out = await AnalyticsView.deleteOne({ _id: assertObjectId(id), profileId: actor.profileId });
  if (!out.deletedCount) throw new AppError('View not found', 404);
  return { removed: true };
}

/** One-time import of views kept in a browser before they moved to the server. Existing names win. */
export async function importViews(actor, body = {}) {
  requireProfile(actor);
  const incoming = Array.isArray(body.views) ? body.views.slice(0, MAX_VIEWS) : [];
  let imported = 0;
  for (const v of incoming) {
    let data;
    try { data = clean(v); } catch { continue; }
    // eslint-disable-next-line no-await-in-loop
    if (await AnalyticsView.exists({ profileId: actor.profileId, name: data.name })) continue;
    // eslint-disable-next-line no-await-in-loop
    if ((await AnalyticsView.countDocuments({ profileId: actor.profileId })) >= MAX_VIEWS) break;
    // eslint-disable-next-line no-await-in-loop
    await AnalyticsView.create({ profileId: actor.profileId, ...data });
    imported += 1;
  }
  return { imported, ...(await list(actor)) };
}
