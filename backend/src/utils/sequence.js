import { Counter } from '../models/counter.model.js';

/**
 * Returns the next value of a named sequence. Atomic: concurrent callers are
 * guaranteed distinct, increasing numbers, because the increment happens inside
 * a single MongoDB document update rather than in application memory.
 *
 * @param {string}  key                Sequence name, e.g. "admissionNo:2026".
 * @param {object}  [opts]
 * @param {import('mongoose').ClientSession|null} [opts.session]
 * @param {() => Promise<number>} [opts.seedWith]
 *   Called only when this sequence has never been used, to carry over numbering
 *   that already exists in the data. Without it, a database created before
 *   counters existed would restart at 1 and collide with every historical row.
 * @returns {Promise<number>}
 */
export async function nextSequence(key, { session = null, seedWith = null } = {}) {
  const sessionOpt = session ? { session } : {};

  if (seedWith) {
    const existing = await Counter.findById(key).session(session).lean();
    if (!existing) {
      const seed = await seedWith();
      // $setOnInsert + upsert is itself atomic: if two callers race to seed the
      // same key, exactly one insert wins and the other becomes a no-op. Doing
      // this as a plain create() would throw a duplicate-key error on the loser.
      await Counter.updateOne(
        { _id: key },
        { $setOnInsert: { seq: Number.isFinite(seed) ? seed : 0 } },
        { upsert: true, ...sessionOpt }
      );
    }
  }

  const doc = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, ...sessionOpt }
  );
  return doc.seq;
}
