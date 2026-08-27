import { Schema, model } from 'mongoose';

/**
 * Atomic named sequences for human-readable identifiers (admission numbers,
 * and anything else that must be gapless-ish, unique and readable).
 *
 * Exists because deriving such a number from `countDocuments()` is wrong in
 * three ways: it is not monotonic (a delete lowers it), it races (two
 * concurrent callers read the same count), and it costs a full collection scan
 * every time. A single-document `$inc` is atomic, O(1), and cannot collide.
 *
 * `_id` is the sequence name, e.g. "admissionNo:2026".
 */
const counterSchema = new Schema(
  {
    _id: { type: String },
    seq: { type: Number, default: 0 },
  },
  { timestamps: true, _id: false }
);

export const Counter = model('Counter', counterSchema);
