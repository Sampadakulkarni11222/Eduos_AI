import { DueItem } from '../../models/dueItem.model.js';
import { upsertFromSource, resolveSource } from '../tasks/tasks.service.js';
import { escapeRegex } from '../ops/common.js';
import { logger } from '../../utils/logger.js';

/**
 * Keeps one open task per obligation of a record, for modules whose due dates
 * recur (a calibration every year, a bill every month, a licence renewal).
 *
 * The tasks engine keeps one item per source key and never reopens a completed
 * one, so the key carries the due date: `lab:equipment:<id>:calibration:2027-03-01`.
 * When the date moves (the instrument was calibrated, the bill was paid and
 * the next one is due), the previous key's open item is resolved and a new one
 * opens; the history of both stays in the queue.
 *
 *   syncDue('lab:equipment:<id>:calibration', { title, department, category, dueAt, ... })
 *   syncDue('lab:equipment:<id>:calibration', null)   // nothing due any more
 */
const OPEN = ['OPEN', 'ACKNOWLEDGED', 'SNOOZED'];
const ymd = (d) => new Date(d).toISOString().slice(0, 10);

export async function syncDue(prefix, spec, { note = 'Superseded in its module' } = {}) {
  const key = spec?.dueAt ? `${prefix}:${ymd(spec.dueAt)}` : null;
  const stale = await DueItem.find({ sourceKey: { $regex: `^${escapeRegex(prefix)}:` }, status: { $in: OPEN } }).select('sourceKey').lean();
  for (const s of stale) {
    // eslint-disable-next-line no-await-in-loop
    if (s.sourceKey !== key) await resolveSource(s.sourceKey, { note });
  }
  if (!key) return null;
  return upsertFromSource({ ...spec, sourceKey: key });
}

/** Never lets a reminder failure break the business write that triggered it. */
export async function syncDueSafely(prefix, spec, opts) {
  try {
    return await syncDue(prefix, spec, opts);
  } catch (err) {
    logger.error(`Task sync for ${prefix} failed: ${err.message}`);
    return null;
  }
}

/**
 * Several open tasks under one prefix at once (one per date), e.g. devices
 * whose warranties end on different days. Opens a task per spec and resolves
 * any open task under the prefix whose date is no longer in the set.
 */
export async function syncDueSet(prefix, specs = [], { note = 'Superseded in its module' } = {}) {
  const keys = new Map(specs.filter((s) => s?.dueAt).map((s) => [`${prefix}:${ymd(s.dueAt)}`, s]));
  const stale = await DueItem.find({ sourceKey: { $regex: `^${escapeRegex(prefix)}:` }, status: { $in: OPEN } }).select('sourceKey').lean();
  for (const s of stale) {
    // eslint-disable-next-line no-await-in-loop
    if (!keys.has(s.sourceKey)) await resolveSource(s.sourceKey, { note });
  }
  const out = [];
  for (const [key, spec] of keys) {
    // eslint-disable-next-line no-await-in-loop
    out.push(await upsertFromSource({ ...spec, sourceKey: key }));
  }
  return out;
}
